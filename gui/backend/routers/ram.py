"""RAM router — Availability, Maintainability, and Spare-parts provisioning.

Closed-form reliability/availability/maintainability/logistics calculations that
complement the state-based Markov module (which covers availability for
hand-built repairable chains). Reuses the library's Lognormal distribution for
repair-time (MTTR) modelling and SciPy's Poisson for spares-to-confidence.
"""

import sys
import math
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

# Bootstrap the reliability src package path
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.Distributions import Lognormal_Distribution
from reliability.Fitters import Fit_Lognormal_2P
from scipy.stats import poisson

router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class AvailabilityRequest(BaseModel):
    mtbf: Optional[float] = None          # mean time between failures
    mttr: Optional[float] = None          # mean (corrective) time to repair
    mtbm: Optional[float] = None          # mean time between maintenance (incl. preventive)
    mean_maint_time: Optional[float] = None   # M̄ — mean active maintenance time (achieved)
    admin_delay: float = 0.0              # mean administrative delay
    logistics_delay: float = 0.0          # mean logistics / supply delay


class MaintainabilityRequest(BaseModel):
    mode: str = "lognormal"               # "lognormal" (manual μ,σ) | "data" (fit samples)
    mu: Optional[float] = None            # log-space location (lognormal mode)
    sigma: Optional[float] = None         # log-space scale (lognormal mode)
    samples: Optional[List[float]] = None  # repair-time samples (data mode)
    percentile: float = 0.95              # percentile for Mmax (e.g. 0.95)


class SparesRequest(BaseModel):
    quantity: int = 1                     # number of installed units
    op_hours: float = 8760.0              # operating hours over the period
    duty_cycle: float = 1.0               # fraction of op_hours the unit runs
    mtbf: Optional[float] = None          # provide mtbf OR failure_rate
    failure_rate: Optional[float] = None  # failures per hour per unit
    confidence: float = 0.95              # target P(no stockout)
    max_spares: int = 50                  # cap for the protection-level curve


# ---------------------------------------------------------------------------
# Sanitizer (mirrors capability.py)
# ---------------------------------------------------------------------------

def _safe(obj):
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if isinstance(obj, dict):
        return {k: _safe(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_safe(v) for v in obj]
    return obj


# ---------------------------------------------------------------------------
# Availability
# ---------------------------------------------------------------------------

@router.post("/availability")
def availability(req: AvailabilityRequest):
    """Inherent / achieved / operational availability from MTBF, MTTR and delays.

    Ai = MTBF / (MTBF + MTTR)
    Aa = MTBM / (MTBM + M̄)
    Ao = MTBM / (MTBM + MDT),  MDT = MTTR + admin_delay + logistics_delay
    """
    out: dict = {}

    # Inherent availability — needs MTBF and MTTR.
    if req.mtbf is not None and req.mttr is not None:
        denom = req.mtbf + req.mttr
        out["inherent"] = req.mtbf / denom if denom > 0 else None

    # Achieved availability — needs MTBM and mean active maintenance time.
    if req.mtbm is not None and req.mean_maint_time is not None:
        denom = req.mtbm + req.mean_maint_time
        out["achieved"] = req.mtbm / denom if denom > 0 else None

    # Operational availability — uptime over uptime + mean down time.
    # MDT includes repair plus administrative and logistics delay. Use MTBM if
    # supplied (preventive + corrective uptime), otherwise fall back to MTBF.
    uptime = req.mtbm if req.mtbm is not None else req.mtbf
    if uptime is not None and req.mttr is not None:
        mdt = req.mttr + req.admin_delay + req.logistics_delay
        denom = uptime + mdt
        out["operational"] = uptime / denom if denom > 0 else None
        out["mean_down_time"] = mdt

    if not out:
        raise HTTPException(
            status_code=400,
            detail="Provide at least MTBF+MTTR (inherent) or MTBM+mean maintenance time (achieved).",
        )

    out["downtime_breakdown"] = {
        "repair": req.mttr,
        "admin_delay": req.admin_delay,
        "logistics_delay": req.logistics_delay,
    }
    return _safe(out)


# ---------------------------------------------------------------------------
# Maintainability
# ---------------------------------------------------------------------------

@router.post("/maintainability")
def maintainability(req: MaintainabilityRequest):
    """Repair-time roll-up: mean corrective time (Mct) and Mmax at a percentile.

    Repair times are modelled as lognormal (the standard maintainability model).
    """
    if not (0 < req.percentile < 1):
        raise HTTPException(status_code=400, detail="percentile must be between 0 and 1.")

    fitted = None
    if req.mode == "data":
        if not req.samples or len(req.samples) < 2:
            raise HTTPException(status_code=400, detail="Provide at least 2 repair-time samples.")
        if any(s <= 0 for s in req.samples):
            raise HTTPException(status_code=400, detail="Repair times must be positive.")
        try:
            fit = Fit_Lognormal_2P(failures=req.samples, show_probability_plot=False)
            mu, sigma = float(fit.mu), float(fit.sigma)
            fitted = {"mu": mu, "sigma": sigma}
        except Exception as exc:  # numerical failure
            raise HTTPException(status_code=500, detail=f"Lognormal fit failed: {exc}") from exc
    else:
        if req.mu is None or req.sigma is None:
            raise HTTPException(status_code=400, detail="Provide mu and sigma for lognormal mode.")
        mu, sigma = float(req.mu), float(req.sigma)

    if sigma <= 0:
        raise HTTPException(status_code=400, detail="sigma must be positive.")

    dist = Lognormal_Distribution(mu=mu, sigma=sigma)
    mct = float(dist.mean)                       # mean corrective maintenance time
    mmax = float(dist.quantile(req.percentile))  # Mmax_ct at the chosen percentile
    median = float(dist.median)

    # SF curve for plotting: probability a repair exceeds time t.
    t_hi = max(mmax * 1.3, mct * 2.0)
    n = 80
    times = [t_hi * i / (n - 1) for i in range(n)]
    sf = [float(v) for v in dist.SF(xvals=times, show_plot=False)]

    return _safe({
        "mu": mu, "sigma": sigma,
        "mct": mct, "mmax": mmax, "median": median,
        "percentile": req.percentile,
        "fitted": fitted,
        "curve": {"time": times, "sf": sf},
    })


# ---------------------------------------------------------------------------
# Spares provisioning (Poisson)
# ---------------------------------------------------------------------------

@router.post("/spares")
def spares(req: SparesRequest):
    """Poisson spare-parts provisioning to a target no-stockout confidence.

    Expected demand over the period:
        λ = quantity · op_hours · duty_cycle · failure_rate
          = quantity · op_hours · duty_cycle / MTBF
    Required spares = smallest k with Poisson.cdf(k, λ) ≥ confidence.
    """
    if req.failure_rate is not None:
        rate = req.failure_rate
    elif req.mtbf is not None and req.mtbf > 0:
        rate = 1.0 / req.mtbf
    else:
        raise HTTPException(status_code=400, detail="Provide either mtbf (>0) or failure_rate.")

    if rate < 0 or req.quantity < 1 or req.op_hours < 0:
        raise HTTPException(status_code=400, detail="quantity, op_hours and rate must be non-negative.")
    if not (0 < req.confidence < 1):
        raise HTTPException(status_code=400, detail="confidence must be between 0 and 1.")

    lam = req.quantity * req.op_hours * req.duty_cycle * rate

    # Smallest stock level meeting the confidence target.
    required = int(poisson.ppf(req.confidence, lam))
    # ppf can land just below target due to discreteness — bump if needed.
    while poisson.cdf(required, lam) < req.confidence:
        required += 1

    kmax = max(min(req.max_spares, required + 10), required)
    levels = list(range(kmax + 1))
    protection = [float(poisson.cdf(k, lam)) for k in levels]

    return _safe({
        "expected_demand": lam,
        "required_spares": required,
        "achieved_protection": float(poisson.cdf(required, lam)),
        "confidence": req.confidence,
        "curve": {"stock_level": levels, "protection": protection},
    })
