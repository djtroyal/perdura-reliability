"""RAM router — Availability, Maintainability, and Spare-parts provisioning.

Closed-form reliability/availability/maintainability/logistics calculations that
complement the state-based Markov module (which covers availability for
hand-built repairable chains). Reuses the library's Lognormal distribution for
repair-time (MTTR) modelling and SciPy's Poisson for spares-to-confidence.
"""

import sys
import math
import heapq
from pathlib import Path
from statistics import NormalDist
from typing import List, Optional

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

# Bootstrap the reliability src package path
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.Distributions import Lognormal_Distribution
from reliability.Fitters import Fit_Lognormal_2P
from scipy.stats import nbinom, poisson

router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class AvailabilityRequest(BaseModel):
    mtbf: Optional[float] = Field(None, gt=0)          # mean time between failures
    mttr: Optional[float] = Field(None, gt=0)          # mean (corrective) time to repair
    mtbm: Optional[float] = Field(None, gt=0)          # mean time between maintenance (incl. preventive)
    mean_maint_time: Optional[float] = Field(None, gt=0)   # M̄ — mean active maintenance time (achieved)
    admin_delay: float = Field(0.0, ge=0)              # mean administrative delay
    logistics_delay: float = Field(0.0, ge=0)          # mean logistics / supply delay


class MaintainabilityRequest(BaseModel):
    mode: str = "lognormal"               # "lognormal" (manual μ,σ) | "data" (fit samples)
    mu: Optional[float] = None            # log-space location (lognormal mode)
    sigma: Optional[float] = Field(None, gt=0)         # log-space scale (lognormal mode)
    samples: Optional[List[float]] = None  # repair-time samples (data mode)
    percentile: float = Field(0.95, gt=0, lt=1)        # percentile for Mmax (e.g. 0.95)


class SparesRequest(BaseModel):
    quantity: int = Field(1, ge=1)                     # number of installed units
    op_hours: float = Field(8760.0, ge=0)             # operating hours over the period
    duty_cycle: float = Field(1.0, ge=0, le=1)        # fraction of op_hours the unit runs
    mtbf: Optional[float] = Field(None, gt=0)          # provide mtbf OR failure_rate
    failure_rate: Optional[float] = Field(None, ge=0)  # failures per hour per unit
    confidence: float = Field(0.95, gt=0, lt=1)        # target P(no stockout)
    max_spares: int = Field(50, ge=1)                 # cap for the protection-level curve
    model: str = "poisson"  # poisson | negative_binomial | renewal_pipeline
    # Negative-binomial size: Var(D)=mean+mean^2/dispersion.
    dispersion: float = Field(10.0, gt=0)
    # Renewal-pipeline alternative. If Weibull is omitted, exponential
    # interarrival times use mtbf/failure_rate.
    weibull_alpha: Optional[float] = Field(None, gt=0)
    weibull_beta: Optional[float] = Field(None, gt=0)
    replenishment_lead_time_mean: float = Field(720.0, ge=0)
    replenishment_lead_time_std: float = Field(168.0, ge=0)
    common_shock_rate: float = Field(0.0, ge=0)  # shocks per calendar hour
    common_shock_size: int = Field(2, ge=1)
    n_simulations: int = Field(5000, ge=200, le=50000)
    seed: Optional[int] = None


# ---------------------------------------------------------------------------
# Sanitizer (mirrors capability.py)
# ---------------------------------------------------------------------------

from utils import safe as _safe


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
    out["analysis_basis"] = "steady_state_mean_uptime_downtime_ratio"
    out["assumption_note"] = (
        "Closed-form availability uses stationary mean cycles and does not model "
        "finite-horizon initialization or non-exponential state dependence."
    )
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
    """Spares provisioning with analytic and finite-horizon alternatives.

    The default preserves the independent constant-rate Poisson calculation.
    Negative-binomial demand adds aggregate overdispersion. The renewal-pipeline
    simulation supports Weibull renewal, compound-Poisson common shocks, and
    stochastic replenishment turnaround; stock is sized against the maximum
    concurrent outstanding demand over the finite horizon.

    Poisson expected demand over the period:
        λ = quantity · op_hours · duty_cycle · failure_rate
          = quantity · op_hours · duty_cycle / MTBF
    """
    model = req.model.strip().lower()
    if req.failure_rate is not None:
        rate = req.failure_rate
    elif req.mtbf is not None and req.mtbf > 0:
        rate = 1.0 / req.mtbf
    elif (model == "renewal_pipeline" and req.weibull_alpha is not None
          and req.weibull_beta is not None):
        rate = 1.0 / (
            req.weibull_alpha * math.gamma(1.0 + 1.0 / req.weibull_beta))
    else:
        raise HTTPException(status_code=400, detail="Provide either mtbf (>0) or failure_rate.")

    if rate < 0 or req.quantity < 1 or req.op_hours < 0:
        raise HTTPException(status_code=400, detail="quantity, op_hours and rate must be non-negative.")
    if not (0 < req.confidence < 1):
        raise HTTPException(status_code=400, detail="confidence must be between 0 and 1.")

    lam = req.quantity * req.op_hours * req.duty_cycle * rate
    if model == "poisson":
        required = int(poisson.ppf(req.confidence, lam))
        while poisson.cdf(required, lam) < req.confidence:
            required += 1
        kmax = max(min(req.max_spares, required + 10), required)
        levels = list(range(kmax + 1))
        protection = [float(poisson.cdf(k, lam)) for k in levels]
        return _safe({
            "model": "poisson_constant_rate",
            "analysis_basis": "analytic_period_demand",
            "expected_demand": lam,
            "demand_variance": lam,
            "required_spares": required,
            "required_spares_interval": None,
            "achieved_protection": float(poisson.cdf(required, lam)),
            "confidence": req.confidence,
            "curve": {"stock_level": levels, "protection": protection,
                      "protection_lower": None, "protection_upper": None},
            "assumptions": [
                "Independent constant-rate failures with no repair return or replenishment during the period.",
                "Demand is Poisson and the result is a period-demand quantile, not a transient inventory simulation.",
            ],
        })

    if model == "negative_binomial":
        size = req.dispersion
        probability = size / (size + lam) if lam > 0 else 1.0
        required = (0 if lam == 0 else int(nbinom.ppf(
            req.confidence, size, probability)))
        while lam > 0 and nbinom.cdf(required, size, probability) < req.confidence:
            required += 1
        kmax = max(min(req.max_spares, required + 10), required)
        levels = list(range(kmax + 1))
        protection = [
            1.0 if lam == 0 else float(nbinom.cdf(k, size, probability))
            for k in levels
        ]
        return _safe({
            "model": "negative_binomial_overdispersed_demand",
            "analysis_basis": "analytic_period_demand",
            "expected_demand": lam,
            "demand_variance": lam + lam * lam / size,
            "dispersion": size,
            "required_spares": required,
            "required_spares_interval": None,
            "achieved_protection": protection[required],
            "confidence": req.confidence,
            "curve": {"stock_level": levels, "protection": protection,
                      "protection_lower": None, "protection_upper": None},
            "assumptions": [
                "Aggregate period demand is negative binomial with the reported mean and dispersion.",
                "No repair return or replenishment occurs during the period.",
            ],
        })

    if model != "renewal_pipeline":
        raise HTTPException(
            status_code=400,
            detail="model must be poisson, negative_binomial, or renewal_pipeline.")
    if (req.weibull_alpha is None) != (req.weibull_beta is None):
        raise HTTPException(
            status_code=400,
            detail="Provide both weibull_alpha and weibull_beta, or neither.")
    if (req.replenishment_lead_time_mean == 0
            and req.replenishment_lead_time_std > 0):
        raise HTTPException(
            status_code=400,
            detail="Lead-time standard deviation must be zero when its mean is zero.")

    rng = np.random.default_rng(req.seed)
    max_outstanding = np.zeros(req.n_simulations, dtype=int)
    total_demands = np.zeros(req.n_simulations, dtype=int)
    lead_mean = req.replenishment_lead_time_mean
    lead_std = req.replenishment_lead_time_std
    if lead_mean > 0 and lead_std > 0:
        sigma2 = math.log1p((lead_std / lead_mean) ** 2)
        lead_sigma = math.sqrt(sigma2)
        lead_mu = math.log(lead_mean) - sigma2 / 2.0
    else:
        lead_sigma = lead_mu = None

    def draw_lead_time():
        if lead_mean == 0:
            return 0.0
        if lead_std == 0:
            return lead_mean
        return float(rng.lognormal(lead_mu, lead_sigma))

    for simulation in range(req.n_simulations):
        events = []
        if req.duty_cycle > 0 and req.op_hours > 0:
            for _ in range(req.quantity):
                time = 0.0
                guard = 0
                while True:
                    if req.weibull_alpha is not None:
                        operating_gap = float(
                            req.weibull_alpha * rng.weibull(req.weibull_beta))
                    elif rate > 0:
                        operating_gap = float(rng.exponential(1.0 / rate))
                    else:
                        break
                    time += operating_gap / req.duty_cycle
                    if time > req.op_hours:
                        break
                    events.append((time, 1))
                    guard += 1
                    if guard > 1_000_000:
                        raise HTTPException(
                            status_code=400,
                            detail="Renewal simulation generated excessive demand; check failure parameters.")
        if req.common_shock_rate > 0 and req.op_hours > 0:
            n_shocks = int(rng.poisson(req.common_shock_rate * req.op_hours))
            shock_times = rng.uniform(0.0, req.op_hours, size=n_shocks)
            events.extend((float(time), req.common_shock_size)
                          for time in shock_times)
        events.sort(key=lambda event: event[0])

        returns = []
        peak = 0
        demand_count = 0
        for event_time, count in events:
            while returns and returns[0] <= event_time:
                heapq.heappop(returns)
            for _ in range(count):
                heapq.heappush(returns, event_time + draw_lead_time())
            demand_count += count
            peak = max(peak, len(returns))
        max_outstanding[simulation] = peak
        total_demands[simulation] = demand_count

    ordered = np.sort(max_outstanding)
    quantile_index = max(0, int(math.ceil(req.confidence * len(ordered))) - 1)
    required = int(ordered[quantile_index])
    kmax = max(min(req.max_spares, required + 10), required)
    levels = list(range(kmax + 1))
    counts = np.array([np.sum(max_outstanding <= level) for level in levels])
    protection = counts / req.n_simulations
    z = NormalDist().inv_cdf(0.975)
    denominator = 1.0 + z * z / req.n_simulations
    centers = (protection + z * z / (2 * req.n_simulations)) / denominator
    half = z * np.sqrt(
        protection * (1 - protection) / req.n_simulations
        + z * z / (4 * req.n_simulations ** 2)
    ) / denominator
    lower = np.maximum(0.0, centers - half)
    upper = np.minimum(1.0, centers + half)

    bootstrap_required = []
    for _ in range(200):
        sample = np.sort(rng.choice(
            max_outstanding, size=req.n_simulations, replace=True))
        bootstrap_required.append(int(sample[quantile_index]))
    required_interval = {
        "lower": int(np.quantile(bootstrap_required, 0.025, method="lower")),
        "upper": int(np.quantile(bootstrap_required, 0.975, method="higher")),
        "method": "cluster_monte_carlo_quantile_bootstrap",
    }

    return _safe({
        "model": "renewal_replenishment_pipeline_simulation",
        "analysis_basis": "finite_horizon_monte_carlo",
        "failure_process": ("weibull_renewal" if req.weibull_alpha is not None
                            else "exponential_renewal"),
        "expected_demand": float(np.mean(total_demands)),
        "demand_variance": float(np.var(total_demands, ddof=1)),
        "mean_peak_outstanding": float(np.mean(max_outstanding)),
        "required_spares": required,
        "required_spares_interval": required_interval,
        "achieved_protection": float(np.mean(max_outstanding <= required)),
        "confidence": req.confidence,
        "n_simulations": req.n_simulations,
        "curve": {
            "stock_level": levels,
            "protection": protection.tolist(),
            "protection_lower": lower.tolist(),
            "protection_upper": upper.tolist(),
        },
        "pipeline": {
            "lead_time_mean": lead_mean,
            "lead_time_std": lead_std,
            "common_shock_rate": req.common_shock_rate,
            "common_shock_size": req.common_shock_size,
        },
        "assumptions": [
            "Each ordinary failure renews its unit's interarrival clock.",
            "A consumed spare returns after an independent replenishment lead time.",
            "Common shocks add simultaneous compound-Poisson demand and do not reset ordinary renewal clocks.",
            "The requirement controls simulated maximum outstanding demand over the finite horizon.",
        ],
    })
