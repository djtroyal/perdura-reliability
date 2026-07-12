"""Contracts for interactive numerical values in prediction equations."""

import math
import sys
from pathlib import Path

import pytest


BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND.parents[1] / "src"))

from routers.prediction import _PART_CLASSES, predict  # noqa: E402
from schemas import PredictionPart, PredictionRequest  # noqa: E402


def _bindings_by_symbol(bindings):
    return {binding["symbol"]: binding for binding in bindings}


def test_resistor_equations_bind_current_factors_result_and_numeric_inputs():
    row = predict(PredictionRequest(
        environment="GB",
        parts=[PredictionPart(
            category="resistor",
            params={
                "style": "RW",
                "power_stress": 0.7,
                "rated_power": 2.0,
                "case_temperature_c": 85.0,
            },
        )],
    ))["results"][0]

    trace = _bindings_by_symbol(row["traceability"]["symbol_bindings"])
    assert trace["λp"]["value"] == pytest.approx(row["failure_rate"])
    assert trace["λp"]["source"] == "result"
    for factor in ("λb", "πT", "πP", "πS", "πQ", "πE"):
        assert trace[factor]["source"] == "factor"

    stress_step = next(step for step in row["calculation_steps"] if step["symbol"] == "πS")
    stress = _bindings_by_symbol(stress_step["symbol_bindings"])
    assert stress["πS"]["value"] == pytest.approx(row["pi_factors"]["pi_S"])
    assert stress["πS"]["factor_key"] == "pi_S"
    assert stress["S"] == {
        "id": "input-power_stress-0",
        "symbol": "S",
        "value": 0.7,
        "available": True,
        "unit": "dimensionless",
        "label": "Power stress",
        "source": "input",
    }

    temperature_step = next(step for step in row["calculation_steps"] if step["symbol"] == "πT")
    temperature = _bindings_by_symbol(temperature_step["symbol_bindings"])
    assert temperature["T"]["value"] == 85.0
    assert temperature["T"]["unit"] == "°C"


def test_capacitor_model_authored_latex_has_input_and_factor_bindings():
    row = predict(PredictionRequest(
        environment="GB",
        parts=[PredictionPart(
            category="capacitor",
            params={
                "capacitance_microfarads": 4.7,
                "voltage_stress": 0.35,
                "T_ambient": 70.0,
                "circuit_resistance_ohm_per_volt": 2.5,
            },
        )],
    ))["results"][0]

    expected_inputs = {
        "πT": ("T_A", 70.0, "°C"),
        "πC": ("C", 4.7, "µF"),
        "πV": ("S", 0.35, "dimensionless"),
        "πSR": ("R/V", 2.5, "Ω/V"),
    }
    for step_symbol, (input_symbol, value, unit) in expected_inputs.items():
        step = next(item for item in row["calculation_steps"] if item["symbol"] == step_symbol)
        bindings = _bindings_by_symbol(step["symbol_bindings"])
        assert bindings[step_symbol]["source"] == "factor"
        assert bindings[input_symbol]["value"] == value
        assert bindings[input_symbol]["unit"] == unit


def test_every_mil_equation_has_finite_structured_values():
    special_params = {
        "parts_count": {"part_type": "diode_general", "quality": 1},
        "custom": {"model": "exponential", "failure_rate": 0.1},
        "generic": {"failure_rate": 0.1},
    }
    parts = [
        PredictionPart(
            category=category,
            params=special_params.get(category, {}),
            apply_vita=True if category in {"ferrite_bead", "oscillator", "mems_oscillator"} else None,
        )
        for category in _PART_CLASSES
    ]

    rows = predict(PredictionRequest(environment="GB", parts=parts))["results"]
    for row in rows:
        assert row["traceability"]["symbol_bindings"], row["category"]
        for step in row["calculation_steps"]:
            assert step["symbol_bindings"], (row["category"], step["symbol"])
        for binding in (
            binding
            for equation in (row["traceability"], *row["calculation_steps"])
            for binding in equation["symbol_bindings"]
        ):
            assert binding["source"] in {"input", "factor", "intermediate", "result"}
            assert binding["id"]
            assert binding["label"]
            assert binding["unit"]
            assert binding["available"] is True
            assert math.isfinite(binding["value"])
