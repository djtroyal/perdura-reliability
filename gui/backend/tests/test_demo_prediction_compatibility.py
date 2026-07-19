"""Bundled Demo Project compatibility with the current prediction contract."""

import json
import math
import sys
from pathlib import Path

import pytest


BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(ROOT / "src"))

from routers.prediction import predict  # noqa: E402
from schemas import PredictionRequest  # noqa: E402


DEMO_PATHS = (
    ROOT / "gui" / "frontend" / "src" / "data" / "demoProject.json",
    ROOT / "examples" / "demo-project.json",
)


def _active_prediction_state(path: Path) -> dict:
    demo = json.loads(path.read_text(encoding="utf-8"))
    wrapped = demo["modules"]["prediction"]
    active_id = wrapped["activeId"]
    return next(
        folio["state"] for folio in wrapped["folios"]
        if folio["id"] == active_id
    )


def _prediction_request(state: dict) -> PredictionRequest:
    api_parts = [
        {
            **{key: value for key, value in part.items() if key != "parentId"},
            "parent_id": part.get("parentId"),
        }
        for part in state["parts"]
    ]
    api_blocks = [
        {
            "id": block["id"],
            "name": block["name"],
            "parent_id": block.get("parentId"),
            "quantity": block.get("quantity", 1),
            "operating_fraction": block.get("operatingFraction", 1),
            "environment": block.get("environment"),
            "nonoperating_environment": block.get("nonoperatingEnvironment"),
            "nonoperating_temperature_c": block.get("nonoperatingTemperatureC"),
            "power_cycles_per_1000_nonoperating_hours": block.get(
                "powerCyclesPer1000NonoperatingHours"),
            "notes": block.get("notes"),
        }
        for block in state["blocks"]
    ]
    return PredictionRequest(
        environment=state["environment"],
        vita_global=state["vitaGlobal"],
        parts=api_parts,
        blocks=api_blocks,
    )


@pytest.mark.parametrize("demo_path", DEMO_PATHS, ids=lambda path: path.name)
def test_demo_prediction_parts_execute_with_current_mil_contract(demo_path):
    state = _active_prediction_state(demo_path)
    result = predict(_prediction_request(state))

    assert [part["name"] for part in state["parts"]] == [
        "Microprocessor", "Bias Resistors", "Decoupling Caps",
    ]
    assert result["incompatible"] == []
    assert len(result["results"]) == len(state["parts"])
    assert result["service_rate_available"] is True
    assert math.isfinite(result["total_failure_rate"])
    assert result["total_failure_rate"] > 0
    assert math.isfinite(result["mtbf_hours"])
    assert result["mtbf_hours"] > 0

    for row in result["results"]:
        assert math.isfinite(row["failure_rate"])
        assert row["failure_rate"] >= 0
        assert row["effective_operating_fraction"] == pytest.approx(0.75)
        assert row["operating_environment"] == "GF"
        assert row["nonoperating_environment"] == "GB"
        assert row["nonoperating_calculation"]["status"] == "supported"
        assert row["nonoperating_calculation"]["traceability"][
            "document_number"] == "RADC-TR-85-91"
        assert row["service_failure_rate_fpmh"] == pytest.approx(
            0.75 * row["operating_failure_rate_fpmh"]
            + 0.25 * row["nonoperating_failure_rate_fpmh"],
            abs=1e-8,
        )


@pytest.mark.parametrize("demo_path", DEMO_PATHS, ids=lambda path: path.name)
def test_demo_prediction_uses_only_current_parameter_names(demo_path):
    state = _active_prediction_state(demo_path)
    parts = {part["category"]: part for part in state["parts"]}

    assert parts["resistor"]["params"]["style"] == "RL"
    assert "case_temperature_c" in parts["resistor"]["params"]
    assert not ({"resistance", "T_ambient"} & parts["resistor"]["params"].keys())

    assert parts["capacitor"]["params"]["style"] == "CK"
    assert "capacitance_microfarads" in parts["capacitor"]["params"]
    assert "circuit_resistance_ohm_per_volt" in parts["capacitor"]["params"]
    assert not ({"capacitance", "circuit_resistance"} & parts["capacitor"]["params"].keys())

    block = state["blocks"][0]
    assert block["operatingFraction"] == pytest.approx(0.75)
    assert block["nonoperatingEnvironment"] == "GB"
    assert block["nonoperatingTemperatureC"] == 25
    assert block["powerCyclesPer1000NonoperatingHours"] == pytest.approx(0.5)
    assert not ({"dutyCycle", "dormantEnvironment"} & block.keys())

    assert parts["microcircuit"]["nonoperating_params"] == {
        "model": "microelectronic_device",
        "device_type": "digital",
        "technology": "cmos",
        "complexity": 32,
        "package": "nonhermetic",
        "quality": "C-1",
    }
    assert parts["resistor"]["nonoperating_params"]["model"] == "resistor"
    assert parts["capacitor"]["nonoperating_params"]["model"] == "capacitor"
    assert all(part["parentId"] == block["id"] for part in parts.values())
