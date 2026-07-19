"""Fail-closed contracts for Prediction derating analysis."""

import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

import reliability.Derating as derating_module  # noqa: E402
from routers.prediction import analyze_derating  # noqa: E402
from schemas import DeratingRequest, PredictionPart  # noqa: E402


CUSTOM_RESISTOR_RULES = {
    "resistor": [
        {
            "param": "power_stress",
            "desc": "Power dissipation",
            "unit": "ratio",
            "level_I": 0.50,
            "level_II": 0.60,
            "level_III": 0.80,
        }
    ]
}


def _request(
    *, params=None, derating_params=None, level="II", standard="Custom", rules=None,
):
    return DeratingRequest(
        standard=standard,
        derating_level=level,
        custom_rules=rules,
        parts=[PredictionPart(
            name="R1",
            category="resistor",
            params=params or {},
            derating_params=derating_params or {},
        )],
    )


def test_withdrawn_named_profile_never_reports_an_empty_pass():
    result = analyze_derating(_request(
        params={"power_stress": 0.1},
        standard="NAVSEA",
    ))

    assert result["summary"] == {
        "ok": 0,
        "exceeds": 0,
        "not_evaluated": 1,
    }
    part = result["results"][0]
    assert part["overall_status"] == "not_evaluated"
    assert part["coverage"] == {
        "evaluated": 0,
        "required": 1,
        "complete": False,
    }
    assert "unavailable" in part["message"].lower()


def test_derating_error_exposes_only_trusted_field_guidance(monkeypatch):
    secret = "/srv/perdura/private/standards.py: API_TOKEN=do-not-expose"

    def fail_resolution(*_args, **_kwargs):
        raise ValueError(f"waveform failed at {secret}")

    monkeypatch.setattr(
        derating_module, "resolve_source_profile_inputs", fail_resolution,
    )
    row = analyze_derating(DeratingRequest(
        standard="MIL-STD-975M",
        derating_level=None,
        parts=[PredictionPart(
            name="R1",
            category="resistor",
            params={},
            derating_params={
                "profile": "MIL-STD-975M",
                "family": "resistor",
            },
        )],
    ))["results"][0]

    assert row["overall_status"] == "not_evaluated"
    assert "waveform" in row["message"]
    assert secret not in repr(row)


def test_mil_975m_reuses_exact_prediction_inputs_without_duplicate_entry():
    prediction_values = {
        "actual_current": 0.4,
        "rated_operating_current": 1.0,
        "actual_voltage": 20.0,
        "rated_operating_voltage": 50.0,
        "ambient_temperature_c": 70.0,
    }
    request = DeratingRequest(
        standard="MIL-STD-975M",
        derating_level=None,
        parts=[PredictionPart(
            name="FL1",
            category="filter",
            params=prediction_values,
            derating_params={},
        )],
    )
    evaluated = analyze_derating(request)["results"][0]
    assert evaluated["overall_status"] == "ok"
    assert evaluated["coverage"] == {
        "evaluated": 3,
        "required": 3,
        "complete": True,
    }
    assert evaluated["input_resolution"] == {
        "family": "filter",
        "family_source": "automatic",
        "inherited_fields": sorted(prediction_values),
        "explicit_fields": [],
        "ignored_profile": None,
    }
    assert evaluated["derating"][0]["rule_id"] == "975M.A.3.5.current"
    assert evaluated["derating"][0]["allowable_value"] == 0.5
    assert "canceled" in " ".join(evaluated["warnings"]).lower()


def test_mil_975m_resistor_pulse_requires_waveform_and_returns_handbook_checks():
    base = {
        "profile": "MIL-STD-975M",
        "family": "resistor",
        "style": "RNC",
        "nominal_power_w": 1,
        "actual_power_w": .2,
        "ambient_temperature_c": 25,
        "specification_maximum_voltage": 500,
        "actual_voltage": 140,
        "active_element_resistance_ohm": 1000,
    }
    request = DeratingRequest(
        standard="MIL-STD-975M",
        derating_level=None,
        parts=[PredictionPart(
            name="R1", category="resistor", params={}, derating_params=base,
        )],
    )

    missing = analyze_derating(request)["results"][0]
    assert missing["overall_status"] == "not_evaluated"
    assert missing["coverage"] == {
        "evaluated": 0, "required": 1, "complete": False,
    }
    assert "explicit source input(s): waveform" in missing["message"]

    request.parts[0].derating_params = base | {
        "waveform": "pulse",
        "rated_continuous_working_voltage_v": 100,
        "peak_power_w": 4,
        "low_duty_cycle": True,
        "continuous_overpower_fault_precluded": True,
        "steep_wavefront_compatibility_verified": True,
        "pulse_temperature_rise_acceptable_verified": True,
    }
    evaluated = analyze_derating(request)["results"][0]
    assert evaluated["overall_status"] == "ok"
    by_id = {row["rule_id"]: row for row in evaluated["derating"]}
    assert by_id["975M.A.3.11.RNC.power"]["status"] == "ok"
    pulse_voltage = by_id["978B.3.3.5.3.RNC.peak_voltage"]
    assert pulse_voltage["allowable_value"] == pytest.approx(140)
    assert pulse_voltage["source"]["printed_pages"] == "3-31"


def test_mil_975m_backend_keeps_numeric_findings_when_soa_is_unverified():
    source_inputs = {
        "profile": "MIL-STD-975M",
        "family": "transistor",
        "transistor_type": "bipolar",
        "actual_power_w": 1,
        "rated_power_w": 10,
        "actual_current_a": 1,
        "rated_current_a": 10,
        "dc_voltage_v": 1,
        "peak_ac_voltage_v": 0,
        "transient_voltage_v": 0,
        "rated_voltage_v": 10,
        "junction_temperature_c": 25,
        "safe_operating_area_verified": False,
    }

    def analyze(actual_power_w):
        return analyze_derating(DeratingRequest(
            standard="MIL-STD-975M",
            derating_level=None,
            parts=[PredictionPart(
                name="Q1", category="bjt", params={},
                derating_params=source_inputs | {
                    "actual_power_w": actual_power_w,
                },
            )],
        ))["results"][0]

    incomplete = analyze(1)
    assert incomplete["overall_status"] == "not_evaluated"
    assert incomplete["coverage"] == {
        "evaluated": 4,
        "required": 5,
        "complete": False,
    }
    assert any(
        check["status"] == "not_evaluated"
        for check in incomplete["derating"]
    )

    failed = analyze(6)
    assert failed["overall_status"] == "exceeds"
    assert any(check["status"] == "exceeds" for check in failed["derating"])
    assert any(
        check["status"] == "not_evaluated" for check in failed["derating"]
    )


@pytest.mark.parametrize(
    "family, category, source_inputs, missing_name",
    [
        (
            "fuse",
            "fuse",
            {
                "rated_current": 4,
                "application_current": .5,
                "ambient_temperature_c": 25,
            },
            "pcb_mounted",
        ),
        (
            "digital_microcircuit",
            "microcircuit",
            {
                "technology": "bipolar",
                "output_current_or_fanout_ratio": .5,
                "supply_voltage_ratio": .5,
                "junction_temperature_c": 25,
                "actual_input_voltage": 1,
                "actual_supply_voltage": 5,
            },
            "radiation_environment",
        ),
        (
            "circuit_breaker",
            "circuit_breaker",
            {
                "load_type": "resistive",
                "maximum_rated_resistive_contact_current": 10,
                "application_current": 1,
                "specified_maximum_ambient_temperature_c": 50,
                "application_ambient_temperature_c": 25,
                "vendor_trip_curve_verified": True,
            },
            "thermal_breaker",
        ),
        (
            "wire_cable",
            "connection",
            {
                "awg": "16",
                "application_current_a": 1,
                "number_of_wires": 1,
                "insulation_temperature_rating_c": 200,
                "application_voltage_v": 1,
                "dielectric_withstanding_voltage_rating_v": 2,
            },
            "round_single_conductors",
        ),
        (
            "thermistor",
            "resistor",
            {
                "coefficient": "PTC",
                "actual_power_w": .1,
                "actual_voltage": 1,
                "resistance_ohm": 100,
            },
            "rated_power_w",
        ),
    ],
)
def test_mil_975m_missing_application_fact_is_incomplete_backend_coverage(
    family, category, source_inputs, missing_name,
):
    row = analyze_derating(DeratingRequest(
        standard="MIL-STD-975M",
        derating_level=None,
        parts=[PredictionPart(
            name="P1",
            category=category,
            params={},
            derating_params={
                "profile": "MIL-STD-975M",
                "family": family,
                **source_inputs,
            },
        )],
    ))["results"][0]

    assert row["overall_status"] == "not_evaluated"
    assert row["coverage"] == {
        "evaluated": 0,
        "required": 1,
        "complete": False,
    }
    assert missing_name in row["message"]


def test_radc_report_requires_manual_level_and_exposes_table_traceability():
    part = PredictionPart(
        name="U1",
        category="microcircuit",
        params={},
        derating_params={
            "profile": "RADC-TR-84-254",
            "family": "ram_rom",
            "junction_temperature_c": 90,
            "supply_voltage_ratio": 0.7,
            "output_current_ratio": 0.7,
            "high_reliability_application": False,
            "memory_kind": "rom",
            "device_specification_tolerances_verified": True,
        },
    )
    with pytest.raises(HTTPException, match="manual Level"):
        analyze_derating(DeratingRequest(
            standard="RADC-TR-84-254", derating_level=None, parts=[part],
        ))
    result = analyze_derating(DeratingRequest(
        standard="RADC-TR-84-254", derating_level="II", parts=[part],
    ))
    row = result["results"][0]
    assert row["overall_status"] == "ok"
    assert row["traceability"]["table"] == "Table 3"


def test_old_ambiguous_mil_selector_is_rejected_not_aliased():
    with pytest.raises(HTTPException) as exc_info:
        analyze_derating(_request(standard="MIL-STD-975"))
    assert exc_info.value.status_code == 422
    assert "unknown derating profile" in str(exc_info.value.detail).lower()


def test_inputs_from_another_source_profile_are_not_reused():
    part = PredictionPart(
        name="U1",
        category="microcircuit",
        params={
            "device_type": "digital",
            "technology": "mos",
            "T_junction": 50,
        },
        derating_params={
            "profile": "MIL-STD-975M",
            "family": "digital_microcircuit",
            "junction_temperature_c": 80,
        },
    )
    result = analyze_derating(DeratingRequest(
        standard="RADC-TR-84-254",
        derating_level="II",
        parts=[part],
    ))
    row = result["results"][0]
    assert row["overall_status"] == "not_evaluated"
    assert row["coverage"]["complete"] is False
    assert row["input_resolution"]["family"] == "complex_ic"
    assert row["input_resolution"]["family_source"] == "automatic"
    assert row["input_resolution"]["ignored_profile"] == "MIL-STD-975M"
    assert "junction_temperature_c" in row["input_resolution"]["inherited_fields"]
    junction = next(
        check for check in row["derating"]
        if check["parameter"] == "junction_temperature_c"
    )
    assert junction["actual_value"] == 50
    assert any("not used" in warning for warning in row["warnings"])


def test_radc_saw_does_not_inherit_three_level_semantics():
    part = PredictionPart(
        name="Y1",
        category="saw_device",
        params={},
        derating_params={
            "profile": "RADC-TR-84-254",
            "family": "saw",
            "center_frequency_mhz": 400,
            "input_power": 10,
            "input_power_unit": "dB",
            "operating_temperature_c": 100,
            "high_reliability_application": False,
            "surrounding_thermal_stability_verified": True,
            "frequency_stability_control_verified": True,
            "esd_stress_controls_verified": True,
        },
    )
    response = analyze_derating(DeratingRequest(
        standard="RADC-TR-84-254",
        derating_level=None,
        parts=[part],
    ))
    assert response["derating_level"] is None
    row = response["results"][0]
    assert row["selected_level"] is None
    assert row["overall_status"] == "not_evaluated"
    assert row["coverage"] == {
        "evaluated": 5,
        "required": 6,
        "complete": False,
    }
    assert row["derating"][0]["selected_level"] is None


def _rl_mos_digital_params():
    return {
        "profile": "RL-TR-92-11",
        "family": "asic_mos_digital",
        "gate_count": 10_000,
        "supply_voltage_v": 1,
        "supplier_min_supply_v": 0,
        "supplier_max_supply_v": 20,
        "frequency_pct_of_max": 0,
        "output_current_pct_of_rated": 0,
        "fanout_pct_of_rated": 0,
        "junction_temperature_c": 25,
        "supplier_max_junction_temperature_c": 150,
        "unused_inputs_terminated": True,
        "supply_transient_filtering_verified": True,
        "digital_design_margins_verified": True,
        "reverse_voltage_avoided": True,
        "aluminum_metallization_used": False,
    }


def test_rl_report_requires_manual_level_and_exposes_unique_native_equations():
    part = PredictionPart(
        name="U2",
        category="microcircuit",
        params={},
        derating_params=_rl_mos_digital_params(),
    )
    with pytest.raises(HTTPException, match="manual Level"):
        analyze_derating(DeratingRequest(
            standard="RL-TR-92-11", derating_level=None, parts=[part],
        ))

    row = analyze_derating(DeratingRequest(
        standard="RL-TR-92-11", derating_level="I", parts=[part],
    ))["results"][0]
    assert row["overall_status"] == "ok"
    assert row["traceability"]["table"] == "Table 4-7"
    assert len({check["rule_id"] for check in row["derating"]}) == len(
        row["derating"]
    )
    assert any(check["formula"] for check in row["derating"])
    assert any(check["substitution"] for check in row["derating"])


def test_rl_missing_input_and_unsupported_source_row_fail_closed():
    incomplete = _rl_mos_digital_params()
    incomplete.pop("gate_count")
    missing = analyze_derating(DeratingRequest(
        standard="RL-TR-92-11",
        derating_level="I",
        parts=[PredictionPart(
            name="U2", category="microcircuit", params={},
            derating_params=incomplete,
        )],
    ))["results"][0]
    assert missing["overall_status"] == "not_evaluated"
    assert missing["coverage"]["complete"] is False
    assert any(check["status"] == "not_evaluated" for check in missing["derating"])

    unsupported = analyze_derating(DeratingRequest(
        standard="RL-TR-92-11",
        derating_level="I",
        parts=[PredictionPart(
            name="HR1", category="resistor", params={},
            derating_params={
                "profile": "RL-TR-92-11",
                "family": "hybrid_deposited_film_resistor",
            },
        )],
    ))["results"][0]
    assert unsupported["overall_status"] == "not_evaluated"
    assert unsupported["derating"][0]["status"] == "not_evaluated"


def _rl_cdr_params():
    return {
        "profile": "RL-TR-92-11",
        "family": "passive_chip_capacitor_cdr",
        "operating_temperature_pct_of_rated": 85,
        "dc_voltage_pct_of_rated": 50,
        "peak_ac_voltage_pct_of_rated": 10,
        "transient_voltage_present": False,
        "ac_or_pulse_service": True,
        "special_ac_pulse_rating_and_test_evidence_verified": True,
        "peak_charge_discharge_current_and_time_constant_reviewed": True,
        "internal_heating_and_ambient_reviewed": True,
        "environmental_conditions_reviewed": True,
        "insulation_resistance_at_temperature_reviewed": True,
        "cdr_dielectric_environment_effects_reviewed": True,
        "cdr_pure_silver_termination": False,
        "simultaneous_high_humidity_and_dc": False,
        "cdr_substrate_cte_compatibility_reviewed": True,
        "design_tolerance_pct": 12,
    }


def test_rl_mil_std_198e_advisory_is_incomplete_coverage_not_false_failure():
    inputs = _rl_cdr_params()
    inputs["environmental_conditions_reviewed"] = False
    part = PredictionPart(
        name="C1", category="capacitor", params={}, derating_params=inputs,
    )

    unresolved = analyze_derating(DeratingRequest(
        standard="RL-TR-92-11", derating_level="I", parts=[part],
    ))["results"][0]
    assert unresolved["overall_status"] == "not_evaluated"
    assert unresolved["coverage"]["complete"] is False
    assert not any(
        check["status"] == "exceeds" for check in unresolved["derating"]
    )
    assert unresolved["traceability"]["reviewed_cross_reference"][
        "document"
    ] == "MIL-STD-198E with Notices 1–3"

    part.derating_params["peak_ac_voltage_pct_of_rated"] = 11
    exceeded = analyze_derating(DeratingRequest(
        standard="RL-TR-92-11", derating_level="I", parts=[part],
    ))["results"][0]
    assert exceeded["overall_status"] == "exceeds"
    assert exceeded["coverage"]["complete"] is False
    assert any(check["status"] == "exceeds" for check in exceeded["derating"])
    assert any(
        check["status"] == "not_evaluated" for check in exceeded["derating"]
    )


def test_rl_never_reuses_another_profiles_input_bag():
    inputs = _rl_mos_digital_params()
    inputs["profile"] = "MIL-STD-975M"
    row = analyze_derating(DeratingRequest(
        standard="RL-TR-92-11",
        derating_level="I",
        parts=[PredictionPart(
            name="U2", category="microcircuit", params={
                "device_type": "digital",
                "technology": "mos",
                "complexity": 1000,
                "T_junction": 50,
            },
            derating_params=inputs,
        )],
    ))["results"][0]
    assert row["overall_status"] == "not_evaluated"
    assert row["coverage"]["complete"] is False
    assert row["input_resolution"]["family"] == "asic_mos_digital"
    assert row["input_resolution"]["family_source"] == "automatic"
    assert row["input_resolution"]["ignored_profile"] == "MIL-STD-975M"
    assert set(row["input_resolution"]["inherited_fields"]) >= {
        "gate_count", "junction_temperature_c",
    }
    gate_count = next(
        check for check in row["derating"]
        if check["parameter"] == "gate_count"
    )
    assert gate_count["actual_value"] == 1000
    assert any("not used" in warning for warning in row["warnings"])


def test_explicit_unusual_category_to_source_family_mapping_is_disclosed():
    row = analyze_derating(DeratingRequest(
        standard="RL-TR-92-11",
        derating_level="I",
        parts=[PredictionPart(
            name="Explicit mapping",
            category="resistor",
            params={},
            derating_params=_rl_mos_digital_params(),
        )],
    ))["results"][0]
    assert row["overall_status"] == "ok"
    assert any("not a usual mapping" in warning for warning in row["warnings"])


def test_missing_required_custom_input_is_not_evaluated():
    result = analyze_derating(_request(rules=CUSTOM_RESISTOR_RULES))

    part = result["results"][0]
    assert part["overall_status"] == "not_evaluated"
    assert part["coverage"] == {
        "evaluated": 0,
        "required": 1,
        "complete": False,
    }
    assert part["derating"][0]["status"] == "not_evaluated"


@pytest.mark.parametrize(
    ("level", "expected"),
    [("I", "exceeds"), ("II", "ok"), ("III", "ok")],
)
def test_selected_level_is_the_acceptance_threshold(level, expected):
    result = analyze_derating(_request(
        params={"power_stress": 0.55},
        level=level,
        rules=CUSTOM_RESISTOR_RULES,
    ))

    part = result["results"][0]
    assert part["overall_status"] == expected
    assert part["coverage"]["complete"] is True
    assert part["derating"][0]["selected_level"] == level


def test_empty_custom_profile_is_not_evaluated():
    result = analyze_derating(_request(standard="Custom", rules=None))
    assert result["results"][0]["overall_status"] == "not_evaluated"
    assert "requires at least one rule" in result["results"][0]["message"]


def test_invalid_custom_profile_is_a_validation_error():
    with pytest.raises(HTTPException) as exc_info:
        analyze_derating(_request(rules={
            "resistor": [{
                "param": "power_stress",
                "level_I": 0.8,
                "level_II": 0.6,
                "level_III": 0.5,
            }]
        }))

    assert exc_info.value.status_code == 422
    assert "level_i <= level_ii <= level_iii" in str(exc_info.value.detail).lower()


def test_unknown_profile_is_a_validation_error():
    with pytest.raises(HTTPException) as exc_info:
        analyze_derating(_request(standard="NOT-A-PROFILE"))

    assert exc_info.value.status_code == 422
    assert "unknown derating profile" in str(exc_info.value.detail).lower()
