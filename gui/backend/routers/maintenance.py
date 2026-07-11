"""Maintenance router — replacement policies, PM intervals, cost forecasting,
and availability sensitivity.

Consolidates the suite's maintenance-planning tools. Reuses the library's
repairable-systems math (age vs block replacement, cost forecast) and its
parametric Distributions (for the reliability-target PM interval / MFOP), plus
the closed-form availability model shared with the RAM module.
"""

import sys
import math
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

# Bootstrap the reliability src package path
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.Repairable_systems import (
    replacement_policy_comparison, maintenance_cost_forecast,
    simulate_virtual_age_maintenance,
)
from reliability.Distributions import (
    Weibull_Distribution, Exponential_Distribution, Lognormal_Distribution,
    Normal_Distribution, Gamma_Distribution, Loglogistic_Distribution,
    Gumbel_Distribution, Beta_Distribution,
)

from utils import safe as _safe

router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ReplacementPolicyRequest(BaseModel):
    cost_PM: float = Field(..., gt=0)      # preventive replacement cost
    cost_CM: float = Field(..., gt=0)      # corrective (post-failure) cost
    weibull_alpha: float = Field(..., gt=0)   # scale (characteristic life)
    weibull_beta: float = Field(..., gt=0)    # shape (>1 for a finite optimum)


class PMIntervalRequest(BaseModel):
    dist: str                              # weibull | exponential | lognormal | ...
    dist_params: Dict[str, float]
    target_reliability: float = Field(0.9, gt=0, lt=1)   # keep R(t) >= this
    horizon: float = Field(..., gt=0)      # planning window (for #PMs + sawtooth)


class CostForecastRequest(BaseModel):
    policy: str = "age"                    # corrective | age | block
    cost_PM: float = Field(..., gt=0)
    cost_CM: float = Field(..., gt=0)
    weibull_alpha: float = Field(..., gt=0)
    weibull_beta: float = Field(..., gt=0)
    horizon: float = Field(..., gt=0)
    interval: Optional[float] = Field(None, gt=0)   # None = that policy's optimum


class VirtualAgeSimulationRequest(BaseModel):
    weibull_alpha: float = Field(..., gt=0)
    weibull_beta: float = Field(..., gt=0)
    horizon: float = Field(..., gt=0)
    preventive_interval: Optional[float] = Field(None, gt=0)
    repair_effectiveness: float = Field(0.0, ge=0, le=1)
    preventive_effectiveness: Optional[float] = Field(None, ge=0, le=1)
    cost_CM: float = Field(0.0, ge=0)
    cost_PM: float = Field(0.0, ge=0)
    corrective_downtime: float = Field(0.0, ge=0)
    preventive_downtime: float = Field(0.0, ge=0)
    n_simulations: int = Field(2000, ge=100, le=100000)
    CI: float = Field(0.95, gt=0, lt=1)
    seed: Optional[int] = None


class AvailabilitySensitivityRequest(BaseModel):
    mtbf: float = Field(..., gt=0)
    mttr: float = Field(..., gt=0)
    admin_delay: float = Field(0.0, ge=0)
    logistics_delay: float = Field(0.0, ge=0)
    swing_pct: float = Field(20.0, gt=0, lt=100)     # ± swing for the tornado
    target_availability: Optional[float] = Field(None, gt=0, lt=1)   # solve-for


# ---------------------------------------------------------------------------
# Distribution builder (mirrors the 8 kinds emitted by useReliabilitySources)
# ---------------------------------------------------------------------------

def _build_dist(kind: str, p: Dict[str, float]):
    """Construct a reliability.Distributions object from the frontend's
    {dist, dist_params} shape. The frontend uses `alpha` for the Weibull scale
    and `lambda` for the exponential rate — mapped here to this library's `eta`
    and `Lambda`."""
    k = (kind or "").lower()
    g = float(p.get("gamma", 0.0))
    try:
        if k == "weibull":
            return Weibull_Distribution(eta=float(p["alpha"]), beta=float(p["beta"]), gamma=g)
        if k == "exponential":
            return Exponential_Distribution(Lambda=float(p["lambda"]), gamma=g)
        if k == "lognormal":
            return Lognormal_Distribution(mu=float(p["mu"]), sigma=float(p["sigma"]), gamma=g)
        if k == "normal":
            return Normal_Distribution(mu=float(p["mu"]), sigma=float(p["sigma"]))
        if k == "gamma":
            return Gamma_Distribution(alpha=float(p["alpha"]), beta=float(p["beta"]), gamma=g)
        if k == "loglogistic":
            return Loglogistic_Distribution(alpha=float(p["alpha"]), beta=float(p["beta"]), gamma=g)
        if k == "gumbel":
            return Gumbel_Distribution(mu=float(p["mu"]), sigma=float(p["sigma"]))
        if k == "beta":
            return Beta_Distribution(alpha=float(p["alpha"]), beta=float(p["beta"]))
    except KeyError as exc:
        raise HTTPException(status_code=400,
                            detail=f"Missing parameter {exc} for '{kind}' distribution.")
    raise HTTPException(status_code=400, detail=f"Unsupported distribution '{kind}'.")


def _ao(mtbf: float, mttr: float, admin: float, log: float) -> float:
    """Operational availability Ao = uptime / (uptime + MDT)."""
    mdt = mttr + admin + log
    return mtbf / (mtbf + mdt)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/replacement-policy")
def replacement_policy(req: ReplacementPolicyRequest):
    """Compare age vs block preventive-replacement policies (optimal interval,
    cost per unit time, expected PM/CM events, cheaper policy)."""
    if req.cost_PM >= req.cost_CM:
        raise HTTPException(status_code=400,
                            detail="cost_PM must be less than cost_CM (otherwise "
                                   "preventive maintenance is never worthwhile).")
    res = replacement_policy_comparison(
        cost_PM=req.cost_PM, cost_CM=req.cost_CM,
        weibull_alpha=req.weibull_alpha, weibull_beta=req.weibull_beta,
    )
    return _safe(res)


@router.post("/pm-interval")
def pm_interval(req: PMIntervalRequest):
    """Preventive-maintenance interval that keeps reliability at or above a
    target (the Maintenance-Free Operating Period, MFOP).

    With as-good-as-new PM every `tau`, reliability sawtooths between 1 and the
    target; `tau` is the time at which the failure distribution's reliability
    first drops to the target: tau = quantile(1 - target).
    """
    dist = _build_dist(req.dist, req.dist_params)
    tau = float(dist.quantile(1.0 - req.target_reliability))
    if not np.isfinite(tau) or tau <= 0:
        raise HTTPException(status_code=400,
                            detail="Could not derive a positive PM interval for that "
                                   "distribution and target.")

    n_pm = int(math.floor(req.horizon / tau))

    # Reliability curves over the horizon: sawtooth (with PM resetting age to 0)
    # vs the un-maintained decay, for contrast.
    n = 240
    t = np.linspace(0.0, req.horizon, n)
    phase = t - tau * np.floor(t / tau)            # age since the last PM
    rel_pm = np.atleast_1d(dist.SF(xvals=phase.tolist(), show_plot=False))
    rel_none = np.atleast_1d(dist.SF(xvals=t.tolist(), show_plot=False))

    return _safe({
        "pm_interval": tau,
        "target_reliability": req.target_reliability,
        "n_pm": n_pm,
        "horizon": req.horizon,
        "mttf": float(dist.mean),
        "analysis_basis": "perfect_renewal_reliability_target",
        "assumption_note": (
            "Every preventive action is assumed as-good-as-new; the reliability "
            "curve resets to age zero. Use virtual-age simulation for imperfect maintenance."
        ),
        "curve": {
            "time": t.tolist(),
            "reliability_pm": [float(v) for v in rel_pm],
            "reliability_none": [float(v) for v in rel_none],
        },
    })


@router.post("/cost-forecast")
def cost_forecast(req: CostForecastRequest):
    """Expected PM/CM events and total maintenance cost over a planning horizon
    for a chosen policy (corrective / age / block), with a cumulative-cost curve."""
    res = maintenance_cost_forecast(
        policy=req.policy, cost_PM=req.cost_PM, cost_CM=req.cost_CM,
        weibull_alpha=req.weibull_alpha, weibull_beta=req.weibull_beta,
        horizon=req.horizon, interval=req.interval,
    )
    return _safe(res)


@router.post("/virtual-age-simulation")
def virtual_age_simulation(req: VirtualAgeSimulationRequest):
    """Finite-horizon imperfect-maintenance simulation using Kijima Type II."""
    try:
        result = simulate_virtual_age_maintenance(**req.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _safe(result)


@router.post("/availability-sensitivity")
def availability_sensitivity(req: AvailabilitySensitivityRequest):
    """Sensitivity of operational availability to its drivers (tornado) and,
    optionally, the MTTR / max downtime required to hit a target availability."""
    base = _ao(req.mtbf, req.mttr, req.admin_delay, req.logistics_delay)
    f = req.swing_pct / 100.0

    # Tornado: swing each driver ±swing_pct and record the resulting Ao. A longer
    # bar = availability is more sensitive to that driver.
    drivers = {
        "MTBF": ("mtbf", req.mtbf),
        "MTTR": ("mttr", req.mttr),
        "Admin delay": ("admin_delay", req.admin_delay),
        "Logistics delay": ("logistics_delay", req.logistics_delay),
    }
    tornado: List[dict] = []
    for label, (key, val) in drivers.items():
        if val <= 0:
            continue    # a zero driver has no swing to show
        vals = {"mtbf": req.mtbf, "mttr": req.mttr,
                "admin": req.admin_delay, "log": req.logistics_delay}
        argmap = {"mtbf": "mtbf", "mttr": "mttr",
                  "admin_delay": "admin", "logistics_delay": "log"}
        a = dict(vals); a[argmap[key]] = val * (1 - f)
        low = _ao(a["mtbf"], a["mttr"], a["admin"], a["log"])
        b = dict(vals); b[argmap[key]] = val * (1 + f)
        high = _ao(b["mtbf"], b["mttr"], b["admin"], b["log"])
        tornado.append({
            "driver": label,
            "low": float(low), "high": float(high),
            "range": float(abs(high - low)),
        })
    tornado.sort(key=lambda d: d["range"], reverse=True)

    out = {
        "baseline_availability": float(base),
        "mean_down_time": float(req.mttr + req.admin_delay + req.logistics_delay),
        "swing_pct": req.swing_pct,
        "tornado": tornado,
        "solve": None,
    }

    # Solve-for-target: with MTBF and the delays fixed, what MTTR hits target Ao?
    if req.target_availability is not None:
        ta = req.target_availability
        max_mdt = req.mtbf * (1 - ta) / ta         # Ao = MTBF/(MTBF+MDT)
        required_mttr = max_mdt - req.admin_delay - req.logistics_delay
        out["solve"] = {
            "target_availability": ta,
            "max_down_time": float(max_mdt),
            "required_mttr": float(required_mttr),
            "achievable": bool(required_mttr > 0),
        }

    return _safe(out)
