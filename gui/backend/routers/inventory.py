"""BOM-linked spares and lifetime procurement, using the shared demand engines."""
from typing import Literal
import hashlib
import json
import math
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from reliability.Inventory import lifetime_inventory
import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import lil_matrix
from scipy.stats import poisson
from reliability._demand import NegativeBinomialDemand
from routers.ram import SparesRequest, spares
from utils import safe

router = APIRouter()


class InventoryCohort(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    count: int = Field(ge=1, le=100000)
    age: float = Field(0, ge=0)
    entry: float = Field(0, ge=0)
    exit: float | None = Field(None, ge=0)

    @model_validator(mode="after")
    def ordered(self):
        if self.exit is not None and self.exit < self.entry:
            raise ValueError("Cohort retirement must follow entry.")
        return self


class InventoryItem(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")
    part_number: str = Field(min_length=1, max_length=200)
    source_ids: list[str] = Field(default_factory=list)
    quantity: int = Field(ge=1, le=100000)
    failure_rate: float = Field(ge=0)
    duty_cycle: float = Field(1, ge=0, le=1)
    service_probability: float | None = Field(None, gt=0, lt=1)
    model: Literal["poisson", "negative_binomial", "weibull"] = "poisson"
    dispersion: float = Field(10, gt=0)
    weibull_alpha: float | None = Field(None, gt=0)
    weibull_beta: float | None = Field(None, gt=0)
    initial_stock: int = Field(0, ge=0)
    unit_cost: float = Field(0, ge=0)
    repair_probability: float = Field(0, ge=0, le=1)
    include_pipeline: bool = False
    lead_mean: float = Field(0, ge=0)
    lead_sd: float = Field(0, ge=0)
    storage_failure_rate: float = Field(0, ge=0)
    cohorts: list[InventoryCohort] = Field(default_factory=list, max_length=1000)

    @model_validator(mode="after")
    def consistent(self):
        self.part_number = self.part_number.strip()
        if not self.part_number:
            raise ValueError("Part number cannot be blank.")
        if self.cohorts and sum(c.count for c in self.cohorts) != self.quantity:
            raise ValueError("Cohort counts must sum to the installed quantity.")
        return self


class InventoryRequest(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")
    items: list[InventoryItem] = Field(min_length=1, max_length=500)
    mode: Literal["period", "lifetime"] = "period"
    horizon: float = Field(gt=0)
    service_probability: float = Field(.95, gt=0, lt=1)
    target: Literal["per_part", "joint"] = "per_part"
    dependence: Literal["independent", "unspecified"] = "unspecified"
    simulations: int = Field(1000, ge=200, le=10000)
    seed: int = Field(42, ge=0)
    source_fingerprint: str = ""
    units: str = "hours"
    allocation: Literal["equal_risk", "minimum_cost"] = "equal_risk"
    maximum_stock: int = Field(200, ge=1, le=10000)


def _cost_allocation(req, groups, rows):
    """Globally optimal discrete allocation within explicit stock bounds.

    One binary choice per PN/stock level; independent log protection or a
    conservative union-bound constraint is linear. No heuristic is called exact.
    """
    if req.target != "joint":
        raise ValueError("Minimum-cost allocation requires an all-part-numbers service target.")
    choices = []; distributions = {}
    for row_index, row in enumerate(rows):
        item = groups[row["part_number"]]
        if item["model"] == "weibull" or item["include_pipeline"] or item["storage_failure_rate"]:
            raise ValueError("Cost allocation requires analytic Poisson/negative-binomial demand without pipeline or storage simulation.")
        if item["initial_stock"] > req.maximum_stock:
            raise ValueError("Maximum stock must include existing depot inventory.")
        cohorts = item["cohorts"] or [{"count": item["quantity"], "entry": 0, "exit": None}]
        exposure = sum(c["count"] * max(0, min(req.horizon, c["exit"] if c["exit"] is not None else req.horizon)-c["entry"]) for c in cohorts)
        mu = exposure * item["duty_cycle"] * item["failure_rate"] * (1-item["repair_probability"] if req.mode == "lifetime" else 1)
        dist = poisson(mu) if item["model"] == "poisson" else NegativeBinomialDemand(mu, item["dispersion"])
        distributions[row_index] = dist
        lower = max(item["initial_stock"], int(dist.ppf(req.service_probability)))
        if lower > req.maximum_stock:
            raise ValueError(f"Maximum stock is too small for {row['part_number']}.")
        for stock in range(lower, req.maximum_stock+1):
            protection = float(dist.cdf(stock))
            risk = -math.log(protection) if req.dependence == "independent" else float(dist.sf(stock))
            choices.append((row_index, stock, risk, (stock-item["initial_stock"])*item["unit_cost"]))
    if len(choices) > 20000:
        raise ValueError("Cost allocation exceeds 20,000 candidate stock choices; narrow the stock limit or divide the inventory classes.")
    constraints = lil_matrix((len(rows)+1, len(choices)))
    for j, (row, _, risk, _) in enumerate(choices):
        constraints[row, j] = 1
        constraints[len(rows), j] = risk
    risk_limit = -math.log(req.service_probability) if req.dependence == "independent" else 1-req.service_probability
    solution = milp(np.array([c[3] for c in choices]), integrality=np.ones(len(choices)), bounds=Bounds(0,1),
        constraints=LinearConstraint(constraints.tocsc(), np.r_[np.ones(len(rows)), -np.inf], np.r_[np.ones(len(rows)), risk_limit]),
        options={"time_limit": 15, "mip_rel_gap": 0})
    if not solution.success or solution.x is None:
        raise ValueError("No proven minimum-cost allocation within these stock limits. Increase the limit or use equal-risk allocation.")
    for j, amount in enumerate(solution.x):
        if amount < .5: continue
        i, stock, _, cost = choices[j]
        rows[i].update(required_stock=stock, purchase_quantity=stock-rows[i]["initial_stock"],
                       purchase_cost=cost, achieved_protection=float(distributions[i].cdf(stock)),
                       service_target=None)
    protection = math.prod(r["achieved_protection"] for r in rows) if req.dependence == "independent" else 1-sum(1-r["achieved_protection"] for r in rows)
    if protection + 1e-12 < req.service_probability:
        raise ValueError("The allocation did not meet the requested service probability at full precision.")
    return {"method": "mixed_integer_minimum_cost", "maximum_stock_per_pn": req.maximum_stock, "optimality_gap": float(solution.mip_gap), "candidate_choices": len(choices)}


@router.post("/plan")
def plan(req: InventoryRequest):
    groups = {}
    for item in req.items:
        raw = item.model_dump()
        pn = raw["part_number"]
        if pn not in groups:
            groups[pn] = raw
            continue
        previous = groups[pn]
        varying = {"quantity", "source_ids", "cohorts"}
        if any(previous[k] != raw[k] for k in raw if k not in varying):
            raise HTTPException(422, f"Conflicting assumptions for part number {pn}; use one consistent pooled PN or distinguish the inventory classes.")
        if bool(previous["cohorts"]) != bool(raw["cohorts"]):
            raise HTTPException(422, f"Define cohorts consistently for pooled part number {pn}.")
        previous["quantity"] += raw["quantity"]
        previous["source_ids"] += raw["source_ids"]
        previous["cohorts"] += raw["cohorts"]
    n = len(groups)
    target = req.service_probability
    if req.target == "joint":
        target = math.exp(math.log(target)/n) if req.dependence == "independent" else 1-(1-target)/n
    rows = []
    try:
        for pn, item in sorted(groups.items()):
            service = target if req.target == "joint" else (item["service_probability"] or target)
            seed = (req.seed + int(hashlib.sha256(pn.encode()).hexdigest()[:8], 16)) % (2**32)
            if req.mode == "lifetime":
                result = lifetime_inventory(item, req.horizon, service, trials=req.simulations, seed=seed)
            else:
                if item["cohorts"] or item["storage_failure_rate"] or item["repair_probability"]:
                    raise ValueError("Cohort, repair-yield and storage-loss models require Lifetime procurement mode.")
                if item["model"] == "negative_binomial" and item["include_pipeline"]:
                    raise ValueError("Negative-binomial period demand does not define event times. Choose Poisson or Weibull for pipeline simulation.")
                model = "renewal_pipeline" if item["include_pipeline"] or item["model"] == "weibull" else item["model"]
                r = spares(SparesRequest(quantity=item["quantity"], op_hours=req.horizon, failure_rate=item["failure_rate"],
                    duty_cycle=item["duty_cycle"], confidence=service, model=model, dispersion=item["dispersion"],
                    weibull_alpha=item["weibull_alpha"] if item["model"] == "weibull" else None,
                    weibull_beta=item["weibull_beta"] if item["model"] == "weibull" else None,
                    replenishment_lead_time_mean=item["lead_mean"] if item["include_pipeline"] else req.horizon + 1,
                    replenishment_lead_time_std=item["lead_sd"] if item["include_pipeline"] else 0,
                    n_simulations=req.simulations, seed=seed, max_spares=1, evaluation_stock=item["initial_stock"]))
                result = {"method": r["model"], "required_stock": r["required_spares"],
                          "purchase_quantity": max(0, r["required_spares"] - item["initial_stock"]),
                          "expected_demand": r["expected_demand"], "achieved_protection": r["evaluation_protection"] if item["initial_stock"] >= r["required_spares"] else r["achieved_protection"],
                          "stock_interval": r.get("required_spares_interval"), "assumptions": r["assumptions"],
                          "simulation_trials": r.get("n_simulations", 0)}
            rows.append({**result, "part_number": pn, "quantity": item["quantity"],
                         "source_ids": sorted(set(item["source_ids"])), "service_target": service,
                         "initial_stock": item["initial_stock"], "unit_cost": item["unit_cost"],
                         "purchase_cost": result["purchase_quantity"] * item["unit_cost"]})
    except (ValueError, OverflowError) as exc:
        raise HTTPException(422, str(exc)) from exc
    optimization = None
    if req.allocation == "minimum_cost":
        try:
            optimization = _cost_allocation(req, groups, rows)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
    probabilities = [row["achieved_protection"] for row in rows]
    independent = req.dependence == "independent"
    simultaneous_lower = []
    simultaneous_upper = []
    for row in rows:
        error = math.sqrt(math.log(2*n/.05)/(2*row["simulation_trials"])) if row["simulation_trials"] else 0
        simultaneous_lower.append(max(0., row["achieved_protection"]-error))
        simultaneous_upper.append(min(1., row["achieved_protection"]+error))
    joint_mc = ({"lower": math.prod(simultaneous_lower) if independent else max(0., 1-sum(1-p for p in simultaneous_lower)),
                 "upper": math.prod(simultaneous_upper) if independent else min(simultaneous_upper),
                 "confidence": .95, "method": "simultaneous_dkw_bonferroni"} if any(r["simulation_trials"] for r in rows) else None)
    return safe({"mode": req.mode, "rows": rows, "purchase_quantity": sum(r["purchase_quantity"] for r in rows),
                 "purchase_cost": sum(r["purchase_cost"] for r in rows),
                 "joint_protection": math.prod(probabilities) if independent else None,
                 "joint_protection_lower_bound": max(0., 1-sum(1-p for p in probabilities)),
                 "joint_protection_interval": joint_mc,
                 "joint_method": "independent_product" if independent else "union_bound",
                 "allocation": "minimum_cost_within_stock_limits" if optimization else ("equal_independent_service" if independent else "equal_union_bound_risk"),
                 "optimization": optimization,
                 "simulation_uncertainty": any(r["simulation_trials"] for r in rows),
                 "source_fingerprint": req.source_fingerprint, "units": req.units,
                 "input_fingerprint": hashlib.sha256(json.dumps(req.model_dump(), sort_keys=True).encode()).hexdigest()})
