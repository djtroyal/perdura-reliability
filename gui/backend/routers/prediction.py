"""Failure rate prediction router (MIL-HDBK-217F / ANSI VITA 51.1)."""

import sys
from fastapi import APIRouter, HTTPException
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.MIL_HDBK_217F import (
    ENVIRONMENTS, ENVIRONMENT_DESCRIPTIONS, STANDARDS,
    Microcircuit, Diode, BipolarTransistor, FieldEffectTransistor,
    Resistor, Capacitor, GenericPart, SystemFailureRate,
)
from schemas import PredictionRequest

router = APIRouter()

_PART_CLASSES = {
    "microcircuit": Microcircuit,
    "diode": Diode,
    "bjt": BipolarTransistor,
    "fet": FieldEffectTransistor,
    "resistor": Resistor,
    "capacitor": Capacitor,
    "generic": GenericPart,
}


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
    if not req.parts:
        raise HTTPException(status_code=400, detail="At least one part is required.")

    parts = []
    for i, spec in enumerate(req.parts):
        cls = _PART_CLASSES.get(spec.category)
        if cls is None:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown part category '{spec.category}' "
                       f"(part {i + 1}). Valid: {list(_PART_CLASSES)}")
        kwargs = dict(spec.params)
        kwargs["name"] = spec.name or f"{spec.category} {i + 1}"
        kwargs["quantity"] = spec.quantity
        if spec.category != "generic":
            kwargs["environment"] = req.environment
            kwargs["standard"] = req.standard
        try:
            parts.append(cls(**kwargs))
        except TypeError as e:
            raise HTTPException(status_code=400,
                                detail=f"Part {i + 1} ({kwargs['name']}): {e}")
        except ValueError as e:
            raise HTTPException(status_code=400,
                                detail=f"Part {i + 1} ({kwargs['name']}): {e}")

    try:
        system = SystemFailureRate(parts)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {
        "environment": req.environment,
        "standard": req.standard,
        "total_failure_rate": round(system.total_failure_rate, 6),
        "mtbf_hours": (None if system.total_failure_rate == 0
                       else round(system.mtbf, 1)),
        "results": system.results,
    }
