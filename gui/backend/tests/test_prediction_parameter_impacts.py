"""Contracts for input-to-factor highlighting metadata."""

import sys
from pathlib import Path


BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND.parents[1] / "src"))

from routers.prediction import (  # noqa: E402
    _get_217plus, _get_eprd, _get_fides, _get_nprd, _get_nswc,
    _get_telcordia, _predict_standard, predict,
)
from schemas import PredictionPart, PredictionRequest  # noqa: E402


def _row(standard, category, params, environment):
    return _predict_standard(
        standard,
        [PredictionPart(category=category, params=params)],
        environment,
    )["results"][0]


def _assert_valid_references(row):
    factors = set(row["pi_factors"])
    step_count = len(row.get("calculation_steps", []))
    for impact in row["parameter_impacts"].values():
        assert set(impact["direct_factor_keys"]) <= factors
        assert set(impact["downstream_factor_keys"]) <= factors
        assert all(0 <= value < step_count for value in impact["direct_step_indices"])
        assert all(0 <= value < step_count for value in impact["downstream_step_indices"])


def test_resistor_style_highlights_direct_factors_and_final_rate_downstream():
    row = predict(PredictionRequest(
        environment="GB",
        parts=[PredictionPart(category="resistor", params={"style": "RW"})],
    ))["results"][0]

    impact = row["parameter_impacts"]["style"]
    assert impact["direct_factor_keys"] == ["lambda_b", "pi_T", "pi_S"]
    assert [row["calculation_steps"][i]["symbol"] for i in impact["direct_step_indices"]] == [
        "λb", "πT", "πS",
    ]
    assert impact["downstream_step_indices"] == [len(row["calculation_steps"]) - 1]
    assert row["calculation_steps"][impact["downstream_step_indices"][0]]["symbol"] == "λp"


def test_vita_control_highlights_only_changed_and_added_factors():
    row = predict(PredictionRequest(
        environment="GB",
        vita_global=True,
        parts=[PredictionPart(category="resistor", params={"style": "RM", "quality": "commercial"})],
    ))["results"][0]

    impact = row["parameter_impacts"]["apply_vita"]
    assert "pi_Q" in impact["direct_factor_keys"]
    assert "vita_51_1_applied" in impact["direct_factor_keys"]
    assert "vita_rule_count" in impact["direct_factor_keys"]
    assert "lambda_b" not in impact["direct_factor_keys"]
    _assert_valid_references(row)


def test_each_prediction_standard_emits_current_result_factor_references():
    cases = [
        ("Telcordia", "resistor", {"power_stress": 0.5, "quality": "commercial", "temperature": 40}, "GC", "power_stress", "pi_S"),
        ("217Plus", "resistor", {"power_stress": 0.5, "temperature": 40}, "GB", "power_stress", "pi_S"),
        ("FIDES", "passive_resistor", {"power_stress": 0.5, "temperature": 40}, "GB", "power_stress", "pi_S"),
        ("NSWC", "spring", {"wire_diameter_mm": 2, "coil_diameter_mm": 20}, "indoor", "wire_diameter_mm", "C_w"),
        ("EPRD-2014", "eprd_capacitor", {"cap_type": "ceramic", "quality": "commercial"}, "GB", "cap_type", "lambda_base"),
        ("NPRD-2023", "nprd_motor", {"motor_type": "ac_induction", "quality": "commercial"}, "GB", "motor_type", "lambda_base"),
    ]

    for standard, category, params, environment, parameter, factor in cases:
        row = _row(standard, category, params, environment)
        assert row.get("incompatible") is not True, row.get("error")
        assert factor in row["parameter_impacts"][parameter]["direct_factor_keys"]
        _assert_valid_references(row)


def test_conditional_candidates_are_filtered_from_the_current_result():
    row = predict(PredictionRequest(
        environment="GB",
        parts=[PredictionPart(category="microcircuit", params={"device_type": "digital"})],
    ))["results"][0]

    complexity = row["parameter_impacts"]["complexity"]
    assert complexity["direct_factor_keys"] == ["C1", "lambda_cyc"]
    assert "A1" not in complexity["direct_factor_keys"]
    assert "feature_size_nm" not in row["parameter_impacts"]
    _assert_valid_references(row)


def test_detailed_cmos_qml_highlights_qml_life_and_mechanism_chain():
    row = predict(PredictionRequest(
        environment="GB",
        parts=[PredictionPart(category="detailed_cmos", params={"qml": "true"})],
    ))["results"][0]

    impact = row["parameter_impacts"]["qml"]
    assert impact["direct_factor_keys"] == [
        "QML_OX", "QML_MET", "QML_HC",
        "t50_OX", "t50_MET", "t50_HC",
        "lambda_OX", "lambda_MET", "lambda_HC",
    ]
    symbols = {
        row["calculation_steps"][index]["symbol"]
        for index in impact["direct_step_indices"]
    }
    assert symbols == {
        "QML_OX", "QML_MET", "QML_HC",
        "t50OX", "t50MET", "t50HC",
        "λOX", "λMET", "λHC",
    }
    _assert_valid_references(row)


def test_every_non_mil_category_has_at_least_one_highlightable_input():
    standards = [
        ("Telcordia", _get_telcordia(), "GC"),
        ("217Plus", _get_217plus(), "GB"),
        ("FIDES", _get_fides(), "GB"),
        ("NSWC", _get_nswc(), "indoor"),
        ("EPRD-2014", _get_eprd(), "GB"),
        ("NPRD-2023", _get_nprd(), "GB"),
    ]
    for standard, categories, environment in standards:
        for category in categories:
            row = _row(standard, category, {}, environment)
            assert row.get("incompatible") is not True, (standard, category, row.get("error"))
            assert row["parameter_impacts"], (standard, category)
            _assert_valid_references(row)
