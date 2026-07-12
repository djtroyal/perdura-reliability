"""Complete MIL-HDBK-217F Notice 2 prediction-router contracts."""

import sys
from pathlib import Path

import pytest


BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND.parents[1] / "src"))

from routers.prediction import (  # noqa: E402
    _PART_CLASSES, _VITA_CATEGORIES,
    get_parts_count_catalog,
    list_standards,
    options,
    predict,
)
from schemas import PredictionPart, PredictionRequest  # noqa: E402


EXPECTED_CATEGORIES = {
    "microcircuit", "vhsic_microcircuit", "gaas_microcircuit",
    "hybrid_microcircuit", "saw_device", "bubble_memory",
    "diode", "hf_diode", "bjt", "fet", "gaas_fet", "unijunction",
    "hf_low_noise_bjt", "hf_power_bjt", "hf_silicon_fet", "thyristor",
    "optoelectronic", "laser_diode", "electron_tube",
    "traveling_wave_tube", "magnetron", "gas_laser", "sealed_co2_laser",
    "flowing_co2_laser", "solid_state_laser", "resistor", "capacitor",
    "transformer", "inductor_coil", "motor", "synchro_resolver",
    "ferrite_bead",
    "elapsed_time_meter", "relay", "ss_relay", "switch", "circuit_breaker",
    "connector", "connector_socket", "pth_assembly", "surface_mount_assembly",
    "connection", "meter", "crystal", "oscillator", "mems_oscillator",
    "lamp", "filter", "fuse",
    "miscellaneous", "detailed_cmos", "parts_count", "custom", "generic",
}


def test_options_expose_every_clause_level_category():
    assert set(_PART_CLASSES) == EXPECTED_CATEGORIES
    assert set(options()["categories"]) == EXPECTED_CATEGORIES
    assert set(list_standards()["MIL-HDBK-217F"]["categories"]) == EXPECTED_CATEGORIES


def test_appendix_a_catalog_endpoint_exposes_all_rows():
    result = get_parts_count_catalog()
    assert result["method"] == "Appendix A parts count"
    assert len(result["parts"]) == 217
    assert len({part["key"] for part in result["parts"]}) == 217
    assert all(part["quality_factors"] for part in result["parts"])
    assert all(
        set(part["quality_options"]) == set(part["quality_factors"])
        for part in result["parts"]
    )


def test_predict_endpoint_runs_every_category_and_returns_long_form():
    special_params = {
        "parts_count": {"part_type": "diode_general", "quality": 1},
        "custom": {"model": "exponential", "failure_rate": .1},
        "generic": {"failure_rate": .1},
    }
    parts = [
        PredictionPart(
            category=category,
            name=category,
            params=special_params.get(category, {}),
            apply_vita=True if category in {"ferrite_bead", "oscillator", "mems_oscillator"} else None,
        )
        for category in _PART_CLASSES
    ]
    result = predict(PredictionRequest(environment="GB", parts=parts))
    assert result["incompatible"] == []
    assert len(result["results"]) == len(parts)
    assert result["total_failure_rate"] > 0
    for expected_category, row in zip(_PART_CLASSES, result["results"]):
        assert row["category"] == expected_category
        assert row["failure_rate"] >= 0
        assert row["traceability"]["equation"]
        assert row["traceability"]["handbook_pages"]
        assert row["calculation_steps"]
        assert row["parameter_impacts"]
        factor_keys = set(row["pi_factors"])
        step_count = len(row["calculation_steps"])
        for impact in row["parameter_impacts"].values():
            assert set(impact["direct_factor_keys"]) <= factor_keys
            assert set(impact["downstream_factor_keys"]) <= factor_keys
            assert all(0 <= index < step_count for index in impact["direct_step_indices"])
            assert all(0 <= index < step_count for index in impact["downstream_step_indices"])


def test_blank_optional_microcircuit_fields_are_omitted_before_calculation():
    """Browser empty-string sentinels must never reach float conversion."""
    result = predict(
        PredictionRequest(
            environment="GB",
            parts=[
                PredictionPart(
                    category="microcircuit",
                    name="U1 memory",
                    params={
                        "device_type": "memory",
                        "technology": "mos",
                        "memory_type": "rom",
                        "complexity": 65536,
                        "c1_override": "",
                        "feature_size_nm": "   ",
                        "temperature_rise_source": "",
                        "manufacturer_rate_fpmh": "",
                    },
                ),
            ],
        )
    )
    assert result["incompatible"] == []
    row = result["results"][0]
    assert row["category"] == "microcircuit"
    assert row["failure_rate"] > 0


def test_resistor_trace_exposes_model_authored_latex_equations():
    result = predict(
        PredictionRequest(
            environment="GB",
            parts=[PredictionPart(category="resistor", params={"style": "RW"})],
        )
    )
    steps = result["results"][0]["calculation_steps"]
    assert steps[0]["description"] == "base failure rate for the selected resistor style"
    assert all(step.get("expression_latex") for step in steps)
    stress = next(step for step in steps if step["symbol"] == "πS")
    assert r"0.71\exp(1.1S)" in stress["expression_latex"]


def test_parts_count_vita_rules_only_apply_to_covered_families():
    result = predict(
        PredictionRequest(
            environment="GM",
            vita_global=True,
            parts=[
                PredictionPart(category="motor", params={}),
                PredictionPart(category="parts_count", params={"part_type": "fuse", "quality": 1}),
                PredictionPart(category="parts_count", params={"part_type": "ic_bipolar_digital_100", "quality": "commercial"}),
            ],
        )
    )
    assert result["incompatible"] == []
    assert [row["vita"] for row in result["results"]] == [False, False, True]
    assert result["results"][2]["pi_factors"]["vita_51_1_applied"] is True


def test_vita_is_only_marked_for_a_model_with_an_implemented_adjustment():
    result = predict(
        PredictionRequest(
            environment="GB",
            vita_global=True,
            parts=[
                PredictionPart(category="microcircuit", params={}),
                PredictionPart(category="laser_diode", params={}),
            ],
        )
    )
    assert result["results"][0]["vita"] is True
    assert result["results"][0]["base_pi_factors"]
    assert result["results"][1]["vita"] is False


def test_motor_temperature_profile_reaches_section_12_model():
    result = predict(
        PredictionRequest(
            environment="GB",
            parts=[
                PredictionPart(
                    category="motor",
                    params={
                        "motor_type": "general",
                        "life_cycle_hours": 87600,
                        "temperature_profile": [[1000, 25], [500, 70]],
                    },
                ),
            ],
        )
    )
    assert result["incompatible"] == []
    factors = result["results"][0]["pi_factors"]
    assert factors["alpha_B"] > 0
    assert factors["alpha_W"] > 0
    assert "1000 h at 25°C" in factors["thermal_basis"]


def test_vita_category_set_matches_the_endpoint_disclosure():
    vita = list_standards()["VITA-51.1"]
    assert set(vita["categories"]) == _VITA_CATEGORIES
    assert vita["conformance_tier"] == "verified"
    assert vita["methodology"]["authoritative_example_validation"] == {
        "status": "passed",
        "passed": 2,
        "total": 2,
        "note": vita["methodology"]["authoritative_example_validation"]["note"],
    }


def test_checked_box_selects_appendix_f_and_reports_mixing_guardrail():
    result = predict(
        PredictionRequest(
            environment="GB",
            vita_global=True,
            parts=[
                PredictionPart(category="pth_assembly", params={}),
                PredictionPart(category="resistor", params={}),
            ],
        )
    )
    pth, resistor = result["results"]
    assert pth["traceability"]["section"] == "A/V51.1 Appendix F"
    assert resistor["pi_factors"]["pi_Q"] == 1
    assert result["warnings"]
    assert "VITA 51.2" in result["warnings"][0]


def test_per_part_off_override_keeps_the_handbook_pth_equation():
    result = predict(
        PredictionRequest(
            environment="GB",
            vita_global=True,
            parts=[
                PredictionPart(
                    category="pth_assembly", params={}, apply_vita=False,
                ),
            ],
        )
    )
    row = result["results"][0]
    assert row["vita"] is False
    assert row["traceability"]["section"] == "16.1"


def test_vita_only_categories_are_computable_when_their_box_is_checked():
    result = predict(
        PredictionRequest(
            environment="GB",
            parts=[
                PredictionPart(category="ferrite_bead", apply_vita=True),
                PredictionPart(category="oscillator", apply_vita=True),
                PredictionPart(category="mems_oscillator", apply_vita=True),
            ],
        )
    )
    assert result["incompatible"] == []
    assert all(row["vita"] for row in result["results"])
    assert result["results"][2]["failure_rate"] == pytest.approx(.0095143705)
