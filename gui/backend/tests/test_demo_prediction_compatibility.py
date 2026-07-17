"""Bundled Demo Project compatibility with the current prediction contract."""

import json
import math
import sys
from pathlib import Path


BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(ROOT / "src"))

from routers.prediction import predict  # noqa: E402
from schemas import PredictionRequest  # noqa: E402


DEMO_PATH = ROOT / "gui" / "frontend" / "src" / "data" / "demoProject.json"


def _active_prediction_state() -> dict:
    demo = json.loads(DEMO_PATH.read_text(encoding="utf-8"))
    wrapped = demo["modules"]["prediction"]
    active_id = wrapped["activeId"]
    return next(
        folio["state"] for folio in wrapped["folios"]
        if folio["id"] == active_id
    )


def test_demo_prediction_parts_execute_with_current_mil_contract():
    state = _active_prediction_state()
    api_parts = [
        {
            **{key: value for key, value in part.items() if key != "parentId"},
            "parent_id": part.get("parentId"),
        }
        for part in state["parts"]
    ]
    result = predict(PredictionRequest(
        environment=state["environment"],
        vita_global=state["vitaGlobal"],
        parts=api_parts,
        blocks=state["blocks"],
    ))

    assert [part["name"] for part in state["parts"]] == [
        "Microprocessor", "Bias Resistors", "Decoupling Caps",
    ]
    assert result["incompatible"] == []
    assert len(result["results"]) == len(state["parts"])
    assert math.isfinite(result["total_failure_rate"])
    assert result["total_failure_rate"] > 0
    assert math.isfinite(result["mtbf_hours"])
    assert result["mtbf_hours"] > 0
    assert all(
        math.isfinite(row["failure_rate"]) and row["failure_rate"] >= 0
        for row in result["results"]
    )


def test_demo_prediction_uses_only_current_long_form_parameter_names():
    parts = {part["category"]: part for part in _active_prediction_state()["parts"]}

    assert parts["resistor"]["params"]["style"] == "RL"
    assert "case_temperature_c" in parts["resistor"]["params"]
    assert not ({"resistance", "T_ambient"} & parts["resistor"]["params"].keys())

    assert parts["capacitor"]["params"]["style"] == "CK"
    assert "capacitance_microfarads" in parts["capacitor"]["params"]
    assert "circuit_resistance_ohm_per_volt" in parts["capacitor"]["params"]
    assert not ({"capacitance", "circuit_resistance"} & parts["capacitor"]["params"].keys())
