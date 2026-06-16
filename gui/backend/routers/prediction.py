"""Failure rate prediction router (MIL-HDBK-217F / ANSI VITA 51.1)."""

import sys
from fastapi import APIRouter, HTTPException
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.MIL_HDBK_217F import (
    ENVIRONMENTS, ENVIRONMENT_DESCRIPTIONS, STANDARDS,
    Microcircuit, HybridMicrocircuit,
    Diode, HFDiode, BipolarTransistor, FieldEffectTransistor,
    GaAsFET, UnijunctionTransistor,
    Thyristor, Optoelectronic,
    Tube, Laser,
    Resistor, Capacitor, InductiveDevice,
    RotatingDevice, Relay, SolidStateRelay,
    Switch, CircuitBreaker,
    Connector, PCB, Connection,
    Meter, QuartzCrystal, Lamp,
    ElectronicFilter, Fuse,
    MiscellaneousPart,
    CustomPart, GenericPart,
    SystemFailureRate,
)
from schemas import PredictionRequest

router = APIRouter()

_PART_CLASSES = {
    "microcircuit": Microcircuit,
    "hybrid_microcircuit": HybridMicrocircuit,
    "diode": Diode,
    "hf_diode": HFDiode,
    "bjt": BipolarTransistor,
    "fet": FieldEffectTransistor,
    "gaas_fet": GaAsFET,
    "unijunction": UnijunctionTransistor,
    "thyristor": Thyristor,
    "optoelectronic": Optoelectronic,
    "tube": Tube,
    "laser": Laser,
    "resistor": Resistor,
    "capacitor": Capacitor,
    "inductive": InductiveDevice,
    "rotating": RotatingDevice,
    "relay": Relay,
    "ss_relay": SolidStateRelay,
    "switch": Switch,
    "circuit_breaker": CircuitBreaker,
    "connector": Connector,
    "pcb": PCB,
    "connection": Connection,
    "meter": Meter,
    "crystal": QuartzCrystal,
    "lamp": Lamp,
    "filter": ElectronicFilter,
    "fuse": Fuse,
    "miscellaneous": MiscellaneousPart,
    "custom": CustomPart,
    "generic": GenericPart,
}

# Categories whose models take no environment/standard arguments
_NO_ENV_CATEGORIES = {"custom", "generic"}


@router.get("/options")
def options():
    return {
        "environments": [
            {"code": e, "description": ENVIRONMENT_DESCRIPTIONS[e]}
            for e in ENVIRONMENTS
        ],
        "standards": list(STANDARDS),
        "categories": list(_PART_CLASSES),
    }


@router.post("/predict")
def predict(req: PredictionRequest):
    """MIL-HDBK-217F part stress prediction.

    The base method is always MIL-HDBK-217F; the ANSI/VITA 51.1 supplement
    is applied per part: each part inherits the global ``vita_global`` flag
    unless it carries an explicit ``apply_vita`` override.
    """
    if not req.parts:
        raise HTTPException(status_code=400, detail="At least one part is required.")

    parts = []
    vita_flags = []
    base_parts = []
    for i, spec in enumerate(req.parts):
        cls = _PART_CLASSES.get(spec.category)
        if cls is None:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown part category '{spec.category}' "
                       f"(part {i + 1}). Valid: {list(_PART_CLASSES)}")
        vita = req.vita_global if spec.apply_vita is None else spec.apply_vita
        kwargs = dict(spec.params)
        kwargs["name"] = spec.name or f"{spec.category} {i + 1}"
        kwargs["quantity"] = spec.quantity
        has_env = spec.category not in _NO_ENV_CATEGORIES
        if has_env:
            kwargs["environment"] = spec.environment or req.environment
            kwargs["standard"] = "VITA-51.1" if vita else "MIL-HDBK-217F"
        try:
            parts.append(cls(**kwargs))
        except TypeError as e:
            raise HTTPException(status_code=400,
                                detail=f"Part {i + 1} ({kwargs['name']}): {e}")
        except ValueError as e:
            raise HTTPException(status_code=400,
                                detail=f"Part {i + 1} ({kwargs['name']}): {e}")
        part_vita = vita and has_env
        vita_flags.append(part_vita)
        if part_vita:
            base_kwargs = dict(kwargs)
            base_kwargs["standard"] = "MIL-HDBK-217F"
            try:
                base_parts.append(cls(**base_kwargs))
            except (TypeError, ValueError):
                base_parts.append(None)
        else:
            base_parts.append(None)

    try:
        system = SystemFailureRate(parts)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    results = system.results
    for row, vita, base in zip(results, vita_flags, base_parts):
        row["vita"] = vita
        if vita and base is not None:
            row["base_pi_factors"] = base.pi_factors
            row["base_failure_rate"] = round(base.failure_rate, 6)
            row["base_total_failure_rate"] = round(base.total_failure_rate, 6)

    return {
        "environment": req.environment,
        "vita_global": req.vita_global,
        "total_failure_rate": round(system.total_failure_rate, 6),
        "mtbf_hours": (None if system.total_failure_rate == 0
                       else round(system.mtbf, 1)),
        "results": results,
    }
