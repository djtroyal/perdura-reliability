"""Diagram-connected lifecycle tools; all models use explicit time semantics."""
from __future__ import annotations

import hashlib
import json
from typing import Any, Literal
from fastapi import APIRouter, HTTPException
from api_contract import public_error_message
from pydantic import BaseModel, ConfigDict, Field
from reliability.System_models import redundancy_model, redundancy_reference
from reliability.System_renewal import Lifetime, SystemStructure, system_renewal, _SystemLifecycleInputError
from reliability.System_simulation import simulate_system
from schemas import RBDRequest, validate_distribution_params
from .system_reliability import _rbd_validation
from utils import safe

router = APIRouter()


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Diagram(StrictModel):
    kind: Literal["rbd", "fta"] = "rbd"
    nodes: list[dict[str, Any]] = Field(min_length=1, max_length=300)
    edges: list[dict[str, Any]] = Field(max_length=1000)
    mission_time: float = Field(1000., gt=0)
    overrides: dict[int, bool] = Field(default_factory=dict, max_length=4096)
    source_signature: str = Field("", max_length=500000)


class RedundancyRequest(StrictModel):
    mode: Literal["active", "standby"] = "active"
    required: int = Field(1, ge=1, le=60)
    total: int = Field(2, ge=1, le=60)
    failure_rate: float = Field(.001, ge=0)
    repair_rate: float = Field(.01, ge=0)
    repair_crews: int = Field(1, ge=0, le=60)
    failure_rates: list[float] | None = None
    repair_rates: list[float] | None = None
    dormant_rate: float = Field(0, ge=0)
    coverage: float = Field(1, ge=0, le=1)
    switching: Literal["independent", "common"] = "independent"
    switch_repair_rate: float = Field(.01, ge=0)
    mission_time: float = Field(1000, gt=0)


class RenewalRequest(StrictModel):
    diagram: Diagram
    interval: float = Field(1000, gt=0)
    policy: Literal["scheduled", "age"] = "scheduled"
    downtime: float = Field(0, ge=0)
    include_mttf: bool = True
    rtol: float = Field(1e-7, ge=1e-10, le=1e-3)


class StateRequest(StrictModel):
    diagram: Diagram
    max_states: int = Field(4096, ge=2, le=4096)


class Duration(StrictModel):
    distribution: Literal["exponential", "weibull", "lognormal", "gamma", "normal", "deterministic"] = "exponential"
    params: dict[str, float] = Field(default_factory=lambda: {"mean": 10.})
    condition_positive: bool = False


class ComponentPolicy(StrictModel):
    repair: Duration = Field(default_factory=Duration)
    pm_interval: float | None = Field(None, gt=0)
    pm_duration: Duration = Field(default_factory=lambda: Duration(distribution="deterministic", params={"value": 1.}))
    defer_repair: bool = False
    repair_yield: float = Field(1, ge=0, le=1)
    spares: int | None = Field(None, ge=0, le=1000000)
    supply_lead_time: float = Field(0, ge=0)
    crew_demand: int = Field(1, ge=1, le=64)
    crew_role_id: str | None = Field(None, max_length=200)
    task_source: dict[str, Any] | None = None


class SimulationRequest(StrictModel):
    diagram: Diagram
    policies: dict[str, ComponentPolicy] = Field(default_factory=dict, max_length=64)
    horizon: float = Field(1000, gt=0)
    warmup: float = Field(0, ge=0)
    replications: int = Field(500, ge=20, le=5000)
    repair_crews: int = Field(1, ge=0, le=64)
    clock: Literal["calendar", "operating"] = "calendar"
    seed: int = Field(42, ge=0, le=2**32-1)
    confidence: float = Field(.95, gt=0, lt=1)
    condition_positive_lifetimes: bool = False
    log_limit: int = Field(1000, ge=0, le=10000)


def _structure(diagram):
    nodes = diagram.nodes
    if diagram.kind == "rbd":
        req = RBDRequest(nodes=nodes, edges=diagram.edges, mission_time=diagram.mission_time)
        issues = [item["message"] for item in _rbd_validation(req) if item["severity"] == "error"]
        if issues:
            raise ValueError("; ".join(issues))
        nodes = [node.model_dump() for node in req.nodes]
    else:
        nodes = [{**node, "data": dict(node.get("data") or {})} for node in nodes]
        for node in nodes:
            data = node["data"]
            if data.get("distribution"):
                data["dist_params"] = validate_distribution_params(data["distribution"], data.get("dist_params") or {})
    return SystemStructure(diagram.kind, nodes, diagram.edges, diagram.overrides)


def _provenance(request, result):
    content = request.model_dump(mode="json")
    result["input_sha256"] = hashlib.sha256(json.dumps(content, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    result["method_version"] = "system-lifecycle-v1"
    result["source_signature"] = getattr(getattr(request, "diagram", None), "source_signature", "")
    return safe(result)


def _lifecycle_error_message(exc, *, fallback):
    if isinstance(exc, _SystemLifecycleInputError):
        if exc.code == 'positive_conditioning_required':
            return public_error_message(exc, message='A duration model with negative support requires explicit conditioning on positive time; clipping is not allowed.')
        if exc.code == 'dynamic_fta':
            return public_error_message(exc, message='Repairable simulation accepts static FTA success logic; dynamic SPARE/PAND/SEQ/FDEP remains in the existing mission analysis.')
    return public_error_message(exc, message=fallback)


@router.post("/redundancy")
def build_redundancy(req: RedundancyRequest):
    try:
        mc, initial, assumptions = redundancy_model(**req.model_dump(exclude={"mission_time"}))
        reference = (None if req.failure_rates else redundancy_reference(required=req.required, total=req.total,
                     failure_rate=req.failure_rate, time=req.mission_time, mode=req.mode,
                     coverage=req.coverage, switching=req.switching))
        return _provenance(req, {"states": [{"id": s.id, "name": s.name, "state_type": s.state_type,
                                 "description": "Generated redundancy state", "dwell_model": "exponential", "dwell_shape": 1} for s in mc.states],
            "transitions": [{"id": f"tr{i+1}", "from_state": t.from_state, "to_state": t.to_state,
                             "rate": t.rate, "label": t.label, "rate_cv": 0.} for i, t in enumerate(mc.transitions)],
            "initial_probabilities": initial, "assumptions": assumptions, "no_repair_reference": reference})
    except (ValueError, KeyError, OverflowError) as exc:
        raise HTTPException(422, public_error_message(exc, message='The redundancy model is invalid. Check required/total units, failure and repair rates, coverage, and standby settings.')) from exc


@router.post("/renewal")
def analyze_renewal(req: RenewalRequest):
    try:
        structure = _structure(req.diagram)
        life = structure.lifetimes(req.diagram.mission_time)
        result = system_renewal(structure, life, req.interval, policy=req.policy, downtime=req.downtime,
                               include_mttf=req.include_mttf, rtol=req.rtol)
        return _provenance(req, result)
    except (ValueError, KeyError, OverflowError) as exc:
        raise HTTPException(422, _lifecycle_error_message(exc, fallback='The system renewal analysis could not be calculated. Check diagram connectivity, lifetime parameters, renewal policy, interval, and downtime.')) from exc


def _python_expression(structure, life):
    expressions = {}
    densities = {}
    for key, model in life.items():
        p, kind = model.params, model.kind
        t = f"t*{model.exposure_scale!r}"
        loc = p.get("gamma", 0.)
        if kind == "exponential":
            expr = f"stats.expon.sf({t},loc={loc!r},scale={1/p['lambda']!r})"
        elif kind == "weibull":
            expr = f"stats.weibull_min.sf({t},{p['beta']!r},loc={loc!r},scale={p['alpha']!r})"
        elif kind == "lognormal":
            expr = f"stats.lognorm.sf({t},{p['sigma']!r},loc={loc!r},scale=np.exp({p['mu']!r}))"
        elif kind == "gamma":
            expr = f"stats.gamma.sf({t},{p['alpha']!r},loc={loc!r},scale={p['beta']!r})"
        elif kind == "loglogistic":
            expr = f"stats.fisk.sf({t},{p['beta']!r},loc={loc!r},scale={p['alpha']!r})"
        elif kind == "beta":
            expr = f"stats.beta.sf({t},{p['alpha']!r},{p['beta']!r},scale={p.get('support_scale',1)!r})"
        elif kind == "normal":
            expr = f"stats.norm.sf({t},loc={p['mu']!r},scale={p['sigma']!r})"
        elif kind == "gumbel":
            expr = f"stats.gumbel_l.sf({t},loc={p['mu']!r},scale={p['sigma']!r})"
        else:
            raise ValueError("Expression export supports nonnegative exponential, Weibull, lognormal, gamma, loglogistic and beta lifetimes.")
        expressions[key] = expr
        densities[key] = f"({expr.replace('.sf(', '.pdf(')})*{model.exposure_scale!r}" if model.exposure_scale else "0.0"
    pairs = ",\n        ".join(f"{k!r}: {v}" for k, v in expressions.items())
    pdfs = ",\n        ".join(f"{k!r}: {v}" for k, v in densities.items())
    return ("# Generated from the current diagram; t uses the project time unit.\n"
            "# Independent component models; BDD preserves repeated identity.\n"
            "# R(t) is point success probability. First-failure survival requires\n"
            "# coherent logic and initially working nonnegative component lives.\n"
            "import numpy as np\nfrom scipy import stats\nfrom functools import lru_cache\n\n"
            "def _value_and_derivative(t):\n    if t < 0: raise ValueError('t must be nonnegative')\n"
            f"    p = {{{pairs}}}\n    density = {{{pdfs}}}\n    variables = {structure.manager.variables!r}\n"
            f"    nodes = {structure.manager.nodes!r}\n"
            "    @lru_cache(None)\n    def visit(node):\n        if node <= 1: return float(node), 0.0\n"
            "        variable, low, high = nodes[node]\n        r = p[variables[variable]]\n"
            "        a, da = visit(low); b, db = visit(high)\n"
            "        return (1-r)*a+r*b, (1-r)*da+r*db-density[variables[variable]]*(b-a)\n"
            f"    return visit({structure.root})\n\n"
            "def R(t):\n    return _value_and_derivative(t)[0]\n\n"
            "def f(t):\n    # First-failure density only for coherent nonnegative lifetime models.\n    return -_value_and_derivative(t)[1]\n\n"
            "def h(t):\n    r, derivative = _value_and_derivative(t)\n    return -derivative/r if r > 0 else float('nan')\n")


@router.post("/states")
def analyze_states(req: StateRequest):
    try:
        structure = _structure(req.diagram)
        probabilities, failures = {}, {}
        for key, data in structure.components.items():
            if data.get("distribution"):
                life = Lifetime(data["distribution"], data.get("dist_params") or {}, require_positive=False)
                exposure = data.get("mission_time") if req.diagram.kind == "rbd" else data.get("exposure_time")
                time = req.diagram.mission_time if exposure is None else exposure
                probabilities[key] = float(life.sf(time))
                failures[key] = float(life.cdf(time))
            else:
                probabilities[key] = float(data.get("reliability", 1 - data.get("probability", 0)))
                failures[key] = 1 - probabilities[key]
        result = structure.state_table(probabilities, req.max_states, failure_probabilities=failures)
        result["evaluated_overrides"] = req.diagram.overrides
        result["python_expression"] = None
        if all(data.get("distribution") for data in structure.components.values()):
            result["python_expression"] = _python_expression(structure, structure.lifetimes(req.diagram.mission_time, require_positive=False))
        return _provenance(req, result)
    except (ValueError, KeyError, OverflowError) as exc:
        raise HTTPException(422, _lifecycle_error_message(exc, fallback='The system state table could not be calculated. Check diagram connectivity, component distributions, and state overrides.')) from exc


@router.post("/simulate")
def analyze_simulation(req: SimulationRequest):
    try:
        structure = _structure(req.diagram)
        life = structure.lifetimes(req.diagram.mission_time, req.condition_positive_lifetimes)
        result = simulate_system(structure, life, {k: v.model_dump() for k, v in req.policies.items()},
                   **req.model_dump(exclude={"diagram", "policies", "condition_positive_lifetimes"}))
        return _provenance(req, result)
    except (ValueError, KeyError, OverflowError) as exc:
        raise HTTPException(422, _lifecycle_error_message(exc, fallback='The system simulation could not be completed. Check diagram connectivity, lifetime and repair parameters, maintenance policy, and supply constraints.')) from exc
