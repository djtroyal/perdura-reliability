"""Failure rate prediction router (MIL-HDBK-217F / ANSI VITA 51.1)."""

import sys
from fastapi import APIRouter, HTTPException
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.MIL_HDBK_217F import (
    ENVIRONMENTS, ENVIRONMENT_DESCRIPTIONS, STANDARDS,
    Microcircuit, Diode, BipolarTransistor, FieldEffectTransistor,
    Thyristor, Optoelectronic, Resistor, Capacitor, InductiveDevice,
    Relay, Switch, Connector, Connection, RotatingDevice, QuartzCrystal,
    Lamp, ElectronicFilter, Fuse, CustomPart, GenericPart,
    SystemFailureRate,
)
from schemas import PredictionRequest

router = APIRouter()

_PART_CLASSES = {
    "microcircuit": Microcircuit,
    "diode": Diode,
    "bjt": BipolarTransistor,
    "fet": FieldEffectTransistor,
    "thyristor": Thyristor,
    "optoelectronic": Optoelectronic,
    "resistor": Resistor,
    "capacitor": Capacitor,
    "inductive": InductiveDevice,
    "relay": Relay,
    "switch": Switch,
    "connector": Connector,
    "connection": Connection,
    "rotating": RotatingDevice,
    "crystal": QuartzCrystal,
    "lamp": Lamp,
    "filter": ElectronicFilter,
    "fuse": Fuse,
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
        if spec.category not in _NO_ENV_CATEGORIES:
            kwargs["environment"] = req.environment
            kwargs["standard"] = "VITA-51.1" if vita else "MIL-HDBK-217F"
        try:
            parts.append(cls(**kwargs))
        except TypeError as e:
            raise HTTPException(status_code=400,
                                detail=f"Part {i + 1} ({kwargs['name']}): {e}")
        except ValueError as e:
            raise HTTPException(status_code=400,
                                detail=f"Part {i + 1} ({kwargs['name']}): {e}")
        vita_flags.append(vita and spec.category not in _NO_ENV_CATEGORIES)

    try:
        system = SystemFailureRate(parts)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    results = system.results
    for row, vita in zip(results, vita_flags):
        row["vita"] = vita

    return {
        "environment": req.environment,
        "vita_global": req.vita_global,
        "total_failure_rate": round(system.total_failure_rate, 6),
        "mtbf_hours": (None if system.total_failure_rate == 0
                       else round(system.mtbf, 1)),
        "results": results,
    }
