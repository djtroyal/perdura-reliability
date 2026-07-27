"""Maintenance router — replacement policies, PM intervals, cost forecasting,
and availability sensitivity.

Consolidates the suite's maintenance-planning tools. Reuses the library's
repairable-systems math (age vs block replacement, cost forecast) and its
parametric Distributions (for the reliability-target PM interval / MFOP), plus
the closed-form availability model shared with the RAM module.
"""

import asyncio
import json
import math
import queue
import sys
import threading
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

import numpy as np
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator

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
from reliability.Maintenance_task_analysis import (
    MaintenanceTaskAnalysisError,
    analyze_maintenance_task_analysis,
)

from api_contract import stream_error_event, stream_result_event
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


class MTAModel(BaseModel):
    """Strict base model for the auditable task-analysis contract."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class MTAWeeklyShift(MTAModel):
    weekday: int = Field(..., ge=0, le=6)
    start_hour: float = Field(..., ge=0, lt=24)
    end_hour: float = Field(..., gt=0, le=24)
    capacity: Optional[int] = Field(None, ge=0)

    @model_validator(mode="after")
    def validate_window(self):
        if self.end_hour <= self.start_hour:
            raise ValueError("Shift end_hour must be greater than start_hour.")
        return self


class MTAPlannedOutage(MTAModel):
    start_hour: float = Field(..., ge=0)
    end_hour: float = Field(..., gt=0)
    capacity: int = Field(0, ge=0)
    note: str = Field("", max_length=500)

    @model_validator(mode="after")
    def validate_window(self):
        if self.end_hour <= self.start_hour:
            raise ValueError("Outage end_hour must be greater than start_hour.")
        return self


class MTAPersonnelRole(MTAModel):
    id: str = Field(..., min_length=1, max_length=120)
    name: str = Field(..., min_length=1, max_length=240)
    skill: str = Field("", max_length=240)
    available_headcount: int = Field(1, ge=0, le=100_000)
    hourly_rate: float = Field(0.0, ge=0)
    overtime_capacity: int = Field(0, ge=0, le=100_000)
    overtime_rate_multiplier: float = Field(1.5, ge=1, le=10)
    weekly_shifts: List[MTAWeeklyShift] = Field(
        default_factory=list, max_length=100)
    planned_outages: List[MTAPlannedOutage] = Field(
        default_factory=list, max_length=500)


class MTAResource(MTAModel):
    id: str = Field(..., min_length=1, max_length=120)
    name: str = Field(..., min_length=1, max_length=240)
    kind: Literal[
        "tool", "test_equipment", "facility", "support_equipment",
        "spare", "repair_part", "consumable", "material", "ppe",
        "transport", "training",
    ] = "tool"
    capacity: int = Field(1, ge=0, le=100_000)
    unit_cost: float = Field(0.0, ge=0)
    use_cost_per_hour: float = Field(0.0, ge=0)
    quantity_on_hand: Optional[float] = Field(None, ge=0)
    replenishment_lead_time_hours: float = Field(0.0, ge=0)
    weekly_shifts: List[MTAWeeklyShift] = Field(
        default_factory=list, max_length=100)
    planned_outages: List[MTAPlannedOutage] = Field(
        default_factory=list, max_length=500)


class MTADurationEstimate(MTAModel):
    mode: Literal["fixed", "uncertain"] = "fixed"
    fixed_hours: float = Field(0.0, ge=0)
    distribution: Literal["pert", "triangular"] = "pert"
    optimistic_hours: float = Field(0.0, ge=0)
    most_likely_hours: float = Field(0.0, ge=0)
    pessimistic_hours: float = Field(0.0, ge=0)


class MTAPersonnelAssignment(MTAModel):
    role_id: str = Field(..., min_length=1, max_length=120)
    headcount: float = Field(1.0, gt=0, le=10_000)
    engagement_fraction: float = Field(1.0, gt=0, le=1)


class MTAResourceAssignment(MTAModel):
    resource_id: str = Field(..., min_length=1, max_length=120)
    quantity: float = Field(1.0, gt=0, le=1_000_000)
    unit_cost_override: Optional[float] = Field(None, ge=0)


class MTATaskStep(MTAModel):
    id: str = Field(..., min_length=1, max_length=120)
    label: str = Field(..., min_length=1, max_length=300)
    description: str = Field("", max_length=4000)
    action_verb: str = Field("", max_length=120)
    object: str = Field("", max_length=300)
    qualifiers: str = Field("", max_length=500)
    phase: Literal[
        "prepare", "access", "isolate", "inspect", "diagnose", "remove",
        "repair", "replace", "install", "adjust", "test", "restore",
        "close_out", "operate", "transport", "package", "train",
        "dispose", "other",
    ] = "other"
    predecessor_step_ids: List[str] = Field(
        default_factory=list, max_length=500)
    duration: MTADurationEstimate = Field(
        default_factory=MTADurationEstimate)
    execution_probability: float = Field(1.0, ge=0, le=1)
    branch_group: str = Field("", max_length=120)
    interruptible: bool = True
    personnel: List[MTAPersonnelAssignment] = Field(
        default_factory=list, max_length=100)
    resources: List[MTAResourceAssignment] = Field(
        default_factory=list, max_length=200)
    safety_precautions: str = Field("", max_length=2000)
    technical_data: str = Field("", max_length=1000)
    acceptance_criteria: str = Field("", max_length=2000)


class MTAPredictionRateSource(MTAModel):
    analysis_id: str = Field(..., min_length=1, max_length=240)
    analysis_name: str = Field("", max_length=300)
    entity_type: Literal["part", "block", "system"]
    entity_id: str = Field(..., min_length=1, max_length=240)
    label: str = Field(..., min_length=1, max_length=500)
    rate_fpmh: float = Field(..., ge=0)
    rate_basis: Literal["service_calendar", "operating"] = "operating"
    represented_quantity: float = Field(1.0, gt=0)
    standard: str = Field("", max_length=300)
    linked_at: str = Field("", max_length=60)


class MTAFrequency(MTAModel):
    model: Literal[
        "manual_per_period", "calendar_interval", "usage_interval",
        "event_list", "poisson_rate", "renewal",
    ] = "manual_per_period"
    occurrences_per_period: float = Field(0.0, ge=0)
    period_hours: float = Field(8760.0, gt=0)
    interval: float = Field(0.0, ge=0)
    interval_unit: Literal[
        "hours", "days", "weeks", "months", "years",
    ] = "hours"
    annual_operating_hours: float = Field(0.0, ge=0)
    first_due_hours: Optional[float] = Field(None, ge=0)
    rate_per_hour: float = Field(0.0, ge=0)
    population: int = Field(1, ge=1, le=10_000_000)
    duty_cycle: float = Field(1.0, ge=0, le=1)
    distribution: Literal["weibull", "exponential"] = "weibull"
    scale_hours: float = Field(0.0, ge=0)
    shape: float = Field(0.0, ge=0)
    event_times_hours: List[float] = Field(
        default_factory=list, max_length=100_000)
    tolerance_before_hours: float = Field(0.0, ge=0)
    tolerance_after_hours: float = Field(0.0, ge=0)
    prediction_source: Optional[MTAPredictionRateSource] = None
    prediction_rate_override_enabled: bool = False

    @model_validator(mode="after")
    def apply_prediction_rate_snapshot(self):
        if self.prediction_source:
            if self.model != "poisson_rate":
                raise ValueError(
                    "Failure Rate Prediction sources require the "
                    "poisson_rate frequency model.")
            # Prediction part/block totals already include their represented
            # quantity; a second population multiplier would double count.
            self.population = 1
            if not self.prediction_rate_override_enabled:
                self.rate_per_hour = (
                    self.prediction_source.rate_fpmh / 1_000_000.0)
                if self.prediction_source.rate_basis == "service_calendar":
                    self.duty_cycle = 1.0
        return self


class MTASourceReference(MTAModel):
    module: str = Field(..., min_length=1, max_length=120)
    analysis_id: str = Field(..., min_length=1, max_length=240)
    record_id: str = Field("", max_length=240)
    revision: str = Field("", max_length=120)
    label: str = Field("", max_length=500)


class MTAValidationRecord(MTAModel):
    id: str = Field(..., min_length=1, max_length=120)
    kind: Literal[
        "desktop_review", "procedure_walkthrough", "physical_demo",
        "simulation", "training_trial", "other",
    ] = "desktop_review"
    date: str = Field("", max_length=40)
    outcome: Literal["planned", "passed", "failed", "conditional"] = "planned"
    evidence: str = Field("", max_length=4000)
    reviewer: str = Field("", max_length=240)


class MTATask(MTAModel):
    id: str = Field(..., min_length=1, max_length=120)
    title: str = Field(..., min_length=1, max_length=300)
    description: str = Field("", max_length=8000)
    task_type: Literal[
        "corrective", "preventive", "condition_based", "inspection",
        "servicing", "operations", "transport", "packaging", "training",
        "logistics", "disposal", "other",
    ] = "corrective"
    maintenance_level: Literal[
        "organizational", "intermediate", "depot", "supplier",
        "field", "shop", "unspecified",
    ] = "unspecified"
    status: Literal[
        "draft", "reviewed", "approved", "demonstrated", "superseded",
    ] = "draft"
    revision: str = Field("A", max_length=40)
    source_refs: List[MTASourceReference] = Field(
        default_factory=list, max_length=500)
    linked_rcm_row_ids: List[str] = Field(
        default_factory=list, max_length=500)
    criticality: Literal[
        "safety", "regulatory", "mission", "operational", "support", "routine",
    ] = "routine"
    priority: int = Field(0, ge=-1000, le=1000)
    frequency: MTAFrequency = Field(default_factory=MTAFrequency)
    steps: List[MTATaskStep] = Field(default_factory=list, max_length=5000)
    takes_asset_out_of_service: bool = True
    affected_asset_count: float = Field(1.0, gt=0)
    fixed_cost: float = Field(0.0, ge=0)
    travel_cost: float = Field(0.0, ge=0)
    downtime_cost_per_hour: float = Field(0.0, ge=0)
    hazards: str = Field("", max_length=4000)
    environment: str = Field("", max_length=4000)
    training_requirements: str = Field("", max_length=4000)
    validation_records: List[MTAValidationRecord] = Field(
        default_factory=list, max_length=1000)
    approval_rationale: str = Field("", max_length=4000)


class MTAPortfolio(MTAModel):
    horizon_hours: float = Field(8760.0, gt=0)
    slot_hours: float = Field(0.25, gt=0)
    start_weekday: int = Field(0, ge=0, le=6)
    allow_overtime: bool = False
    simulation_enabled: bool = True
    n_simulations: int = Field(2000, ge=1, le=20_000)
    confidence: float = Field(0.95, gt=0, lt=1)
    seed: int = 42
    asset_population: float = Field(0.0, ge=0)
    default_downtime_cost_per_hour: float = Field(0.0, ge=0)
    max_generated_jobs: int = Field(100_000, ge=1, le=1_000_000)


class MTAAnalysisRequest(MTAModel):
    tasks: List[MTATask] = Field(default_factory=list, max_length=10_000)
    personnel: List[MTAPersonnelRole] = Field(
        default_factory=list, max_length=10_000)
    resources: List[MTAResource] = Field(
        default_factory=list, max_length=100_000)
    portfolio: MTAPortfolio = Field(default_factory=MTAPortfolio)


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


@router.get("/task-analysis/vocabulary")
def maintenance_task_analysis_vocabulary():
    """Controlled terms for consistent, readable support-task records."""
    return {
        "action_verbs": [
            "access", "adjust", "align", "assemble", "calibrate", "clean",
            "close", "connect", "deactivate", "diagnose", "disconnect",
            "dispose", "drain", "fill", "inspect", "install", "isolate",
            "lubricate", "measure", "open", "operate", "package", "prepare",
            "remove", "repair", "replace", "restore", "secure", "service",
            "test", "train", "transport", "verify",
        ],
        "phases": [
            "prepare", "access", "isolate", "inspect", "diagnose", "remove",
            "repair", "replace", "install", "adjust", "test", "restore",
            "close_out", "operate", "transport", "package", "train",
            "dispose", "other",
        ],
        "task_types": [
            "corrective", "preventive", "condition_based", "inspection",
            "servicing", "operations", "transport", "packaging", "training",
            "logistics", "disposal", "other",
        ],
        "maintenance_levels": [
            "organizational", "intermediate", "depot", "supplier", "field",
            "shop", "unspecified",
        ],
        "resource_kinds": [
            "tool", "test_equipment", "facility", "support_equipment",
            "spare", "repair_part", "consumable", "material", "ppe",
            "transport", "training",
        ],
        "governance_statuses": [
            "draft", "reviewed", "approved", "demonstrated", "superseded",
        ],
        "duration_models": ["fixed", "pert", "triangular"],
        "frequency_models": [
            "manual_per_period", "calendar_interval", "usage_interval",
            "event_list", "poisson_rate", "renewal",
        ],
    }


def _run_task_analysis(
    req: MTAAnalysisRequest,
    *,
    progress_callback=None,
    cancel_check=None,
):
    try:
        return analyze_maintenance_task_analysis(
            req.model_dump(),
            progress_callback=progress_callback,
            cancel_check=cancel_check,
        )
    except MaintenanceTaskAnalysisError as exc:
        raise HTTPException(status_code=400, detail={
            "code": "maintenance_task_analysis_model_error",
            "message": str(exc),
        }) from exc


@router.post("/task-analysis/analyze")
def maintenance_task_analysis(req: MTAAnalysisRequest):
    """Analyze task logic, uncertainty, calendars, resources, and cost."""
    return _safe(_run_task_analysis(req))


@router.post(
    "/task-analysis/analyze/stream",
    response_class=StreamingResponse,
    responses={
        200: {
            "content": {
                "application/x-ndjson": {"schema": {"type": "string"}},
            },
        },
    },
)
def maintenance_task_analysis_stream(
    req: MTAAnalysisRequest,
    request: Request,
):
    """Run the same MTA with progress and cooperative cancellation."""
    total = (
        req.portfolio.n_simulations
        if req.portfolio.simulation_enabled else 1
    )
    request_id_value = getattr(request.state, "request_id", "")

    async def generate():
        events: queue.Queue[dict[str, Any]] = queue.Queue()
        cancel = threading.Event()

        def progress(done: int, count: int) -> None:
            events.put({
                "type": "progress",
                "done": done,
                "total": count,
            })

        def work() -> None:
            try:
                result = _run_task_analysis(
                    req,
                    progress_callback=progress,
                    cancel_check=cancel.is_set,
                )
                events.put(stream_result_event(_safe(result)))
            except InterruptedError:
                events.put(stream_error_event(
                    "Analysis cancelled.",
                    request_id_value=request_id_value,
                    status=499,
                    code="cancelled",
                ))
            except HTTPException as exc:
                events.put(stream_error_event(
                    exc.detail,
                    request_id_value=request_id_value,
                    status=exc.status_code,
                ))
            except BaseException:  # pragma: no cover - stream boundary
                events.put(stream_error_event(
                    "The maintenance task analysis failed. Use the request ID "
                    "when reporting this error.",
                    request_id_value=request_id_value,
                ))

        worker = threading.Thread(target=work, daemon=True)
        worker.start()
        yield json.dumps({"type": "start", "total": total}) + "\n"
        try:
            while True:
                if await request.is_disconnected():
                    cancel.set()
                    return
                try:
                    event = events.get_nowait()
                except queue.Empty:
                    if not worker.is_alive():
                        event = stream_error_event(
                            "Maintenance task analysis worker exited without "
                            "a terminal event.",
                            request_id_value=request_id_value,
                        )
                    else:
                        await asyncio.sleep(0.025)
                        continue
                yield json.dumps(event) + "\n"
                if event["type"] in {"result", "error"}:
                    worker.join(timeout=1.0)
                    return
        finally:
            cancel.set()

    return StreamingResponse(
        generate(),
        media_type="application/x-ndjson",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )
