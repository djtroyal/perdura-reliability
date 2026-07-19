"""Independent table-parity and fail-closed tests for RADC-TR-84-254."""

from dataclasses import FrozenInstanceError
import json
from pathlib import Path

import pytest

from reliability import RADC_TR_84_254 as radc


def _checks(result):
    return {check.parameter: check for check in result.checks}


def _application_defaults():
    """Complete, non-high-reliability application declarations for table tests."""
    return {
        "high_reliability_application": False,
        "supply_voltage_control_verified": True,
        "esd_handling_controls_verified": True,
        "signal_noise_and_supply_controls_verified": True,
        "memory_kind": "rom",
        "device_specification_tolerances_verified": True,
        "dynamic_ram_refresh_verified": True,
        "recommended_voltage_limits_verified": True,
        "transient_esd_safeguards_verified": True,
        "surrounding_thermal_stability_verified": True,
        "frequency_stability_control_verified": True,
        "esd_stress_controls_verified": True,
    }


def _hybrid(**overrides):
    params = {
        **_application_defaults(),
        "junction_temperature_c": 84,
        "film_construction": "none",
        "constituent_checks_complete": True,
        "constituent_checks_passed": True,
    }
    params.update(overrides)
    return params


def _complex(**overrides):
    params = {
        **_application_defaults(),
        "technology": "bipolar",
        "digital": True,
        "junction_temperature_c": 80,
        "supply_voltage_ratio": .70,
        "output_current_ratio": .65,
        "fan_out_ratio": .65,
        "operating_frequency_ratio": .70,
    }
    params.update(overrides)
    return params


def _microwave(**overrides):
    params = {
        **_application_defaults(),
        "junction_temperature_c": 90,
        "power_dissipation_ratio": .45,
        "breakdown_voltage_ratio": .55,
    }
    params.update(overrides)
    return params


def test_profile_identity_is_historical_and_serializable_not_a_standard_claim():
    metadata = radc.get_profile_metadata()
    assert metadata["profile_id"] == "RADC-TR-84-254"
    assert metadata["accession"] == "AD-A153744"
    assert metadata["source_type"] == "Final Technical Report"
    assert metadata["document_sha256"] == radc.DOCUMENT_SHA256
    assert metadata["document_sha256"] == (
        "0c0b17d09e0eb1a5126efa05afc6e33562ae22201382b3ce1191e163f69dea0d"
    )
    assert metadata["conformance_claim"] is False
    assert "not an issued military standard" in metadata["source_status"]
    assert metadata["level_selection"]["mode"] == "manual"
    assert metadata["level_selection"]["environment_guidance"] == {
        "ground": "III", "flight": "II", "space": "I",
    }
    assert "guidance only" in metadata["level_selection"]["guidance_status"]
    json.dumps(metadata)
    json.dumps(radc.get_model_catalog())
    json.dumps(radc.get_input_schema("complex_ic"))

    result = radc.assess("ram_rom", {
        **_application_defaults(),
        "junction_temperature_c": 80,
        "supply_voltage_ratio": .70,
        "output_current_ratio": .65,
    }, "I")
    assert result.traceability["document_sha256"] == radc.DOCUMENT_SHA256


def test_complex_ic_technology_is_required_only_for_digital_rows():
    schema = radc.get_input_schema("complex_ic")["inputs"]
    assert schema["technology"]["required_when"] == "digital is true"
    assert "required" not in schema["technology"]
    assert schema["high_reliability_application"]["required"] is True
    assert schema["quality_screening_verified"]["required_when"] == (
        "high_reliability_application is true"
    )

    nondigital = radc.assess("complex_ic", {
        **_application_defaults(),
        "digital": False,
        "junction_temperature_c": 85,
        "supply_voltage_ratio": .75,
        "output_current_ratio": .70,
    }, "I")
    assert nondigital.status == "ok"
    assert all(check.parameter != "technology" for check in nondigital.checks)

    digital = radc.assess("complex_ic", {
        **_application_defaults(),
        "digital": True,
        "junction_temperature_c": 85,
        "supply_voltage_ratio": .75,
        "output_current_ratio": .70,
    }, "I")
    technology = next(check for check in digital.checks if check.parameter == "technology")
    assert technology.status == "not_evaluated"


def test_catalog_contains_exactly_the_ten_table_models_and_source_locators():
    assert radc.SUPPORTED_MODELS == (
        "hybrid",
        "complex_ic",
        "ram_rom",
        "bubble_memory",
        "gaas_fet",
        "microwave_transistor_impatt_gunn",
        "varactor_step_recovery_pin_tunnel",
        "silicon_detector_mixer",
        "germanium_detector_mixer",
        "saw",
    )
    catalog = radc.get_model_catalog()
    assert catalog["hybrid"]["table"] == "Table 1"
    assert catalog["hybrid"]["report_page"] == "5"
    assert catalog["hybrid"]["pdf_page"] == 16
    assert catalog["saw"]["table"] == "Table 10"
    assert catalog["saw"]["report_page"] == "12"
    assert catalog["saw"]["pdf_page"] == 23


def test_catalog_matches_separately_maintained_source_cell_oracle():
    oracle_path = Path(__file__).with_name("fixtures") / "radc_tr_84_254_table_oracle.json"
    oracle = json.loads(oracle_path.read_text(encoding="utf-8"))
    assert oracle["document"]["sha256"] == radc.DOCUMENT_SHA256
    assert oracle["provenance"]["generated_from_implementation"] is False
    assert "second-pass" in oracle["provenance"]["review_method"]

    catalog = radc.get_model_catalog()
    assert {cell["table"] for cell in oracle["cells"]} == {
        f"Table {number}" for number in range(1, 11)
    }
    for cell in oracle["cells"]:
        definition = catalog[cell["model"]]
        assert definition["section"] == cell["section"]
        assert definition["table"] == cell["table"]
        assert definition["report_page"] == cell["report_page"]
        assert definition["pdf_page"] == cell["pdf_page"]
        actual = definition["limits"][cell["parameter"]]
        selector = cell.get("selector")
        if selector:
            actual = actual[selector["technology"]]
        assert actual == cell["limits"], (
            cell["table"], cell["row"], actual, cell["limits"]
        )

    conditional = oracle["conditional_rules"][0]
    assert conditional["model"] == "hybrid"
    assert conditional["operator"] == "<"
    assert "case_temperature_c - 100" in conditional["formula"]


def test_public_metadata_helpers_return_defensive_copies():
    metadata = radc.get_profile_metadata()
    metadata["level_selection"]["mode"] = "automatic"
    assert radc.get_profile_metadata()["level_selection"]["mode"] == "manual"

    catalog = radc.get_model_catalog()
    catalog["ram_rom"]["limits"]["junction_temperature_c"]["I"] = -1
    assert radc.get_model_catalog()["ram_rom"]["limits"][
        "junction_temperature_c"
    ]["I"] == 85


def test_level_is_mandatory_and_manual_for_tables_one_through_nine():
    with pytest.raises(radc.UnsupportedRADC84254ModelError, match="chosen manually"):
        radc.assess("ram_rom", {}, None)
    with pytest.raises(radc.UnsupportedRADC84254ModelError, match="I, II, or III"):
        radc.assess("ram_rom", {}, "ground")
    with pytest.raises(radc.UnsupportedRADC84254ModelError, match="do not apply"):
        radc.assess("saw", {}, "III")
    assert radc.get_input_schema("saw")["selected_level"]["required"] is False


@pytest.mark.parametrize(
    "level, expected",
    [("I", (85, .75, .70)), ("II", (100, .80, .75)), ("III", (125, .85, .80))],
)
def test_table_3_ram_rom_cells_and_inclusive_maxima(level, expected):
    tj, supply, output = expected
    result = radc.assess("ram_rom", {
        **_application_defaults(),
        "junction_temperature_c": tj,
        "supply_voltage_ratio": supply,
        "output_current_ratio": output,
    }, level)
    assert result.status == "ok"
    assert result.passed
    table_checks = [
        check for check in result.checks
        if check.parameter in {
            "junction_temperature_c", "supply_voltage_ratio", "output_current_ratio",
        }
    ]
    assert {check.selected_limit for check in table_checks} == set(expected)
    assert all(check.comparison == "≤" for check in table_checks)


def test_table_1_hybrid_exact_cells_strict_power_density_and_case_adjustment():
    catalog = radc.get_model_catalog()["hybrid"]["limits"]
    assert catalog["junction_temperature_c"] == {"I": 85, "II": 100, "III": 110}
    assert catalog["thick_film_power_density_w_per_in2"] == {
        "I": 50, "II": 50, "III": 50,
    }
    assert catalog["thin_film_power_density_w_per_in2"] == {
        "I": 40, "II": 40, "III": 40,
    }

    passing = radc.assess("hybrid", _hybrid(
        film_construction="both",
        case_temperature_c=105,
        thick_film_power_density_w_per_in2=44.99,
        thin_film_power_density_w_per_in2=34.99,
    ), "I")
    assert passing.status == "ok"
    assert _checks(passing)["thick_film_power_density_w_per_in2"].selected_limit == 45
    assert _checks(passing)["thin_film_power_density_w_per_in2"].selected_limit == 35
    assert _checks(passing)["thick_film_power_density_w_per_in2"].comparison == "<"

    equality_fails = radc.assess("hybrid", _hybrid(
        film_construction="thick",
        case_temperature_c=105,
        thick_film_power_density_w_per_in2=45,
    ), "I")
    assert equality_fails.status == "exceeds"


def test_hybrid_fails_closed_until_constituent_checks_are_complete_and_pass():
    missing = radc.assess("hybrid", {
        **_application_defaults(),
        "junction_temperature_c": 80,
        "film_construction": "none",
    }, "I")
    assert missing.status == "not_evaluated"
    assert _checks(missing)["constituent_checks_complete"].status == "not_evaluated"
    assert _checks(missing)["constituent_checks_passed"].status == "not_evaluated"

    incomplete = radc.assess("hybrid", _hybrid(
        constituent_checks_complete=False,
    ), "I")
    assert incomplete.status == "not_evaluated"

    failed = radc.assess("hybrid", _hybrid(
        constituent_checks_passed=False,
    ), "I")
    assert failed.status == "exceeds"
    assert not failed.passed
    assert "AFSC Pamphlet 800-27" in " ".join(failed.warnings)


def test_hybrid_film_applicability_and_case_temperature_fail_closed():
    undeclared = radc.assess("hybrid", {
        **_application_defaults(),
        "junction_temperature_c": 80,
        "constituent_checks_complete": True,
        "constituent_checks_passed": True,
    }, "I")
    assert undeclared.status == "not_evaluated"
    assert _checks(undeclared)["film_construction"].status == "not_evaluated"

    no_case = radc.assess("hybrid", _hybrid(
        film_construction="thin",
        thin_film_power_density_w_per_in2=20,
    ), "I")
    check = _checks(no_case)["thin_film_power_density_w_per_in2"]
    assert check.status == "not_evaluated"
    assert check.selected_limit is None
    assert "case_temperature_c" in check.message


@pytest.mark.parametrize(
    "technology, level, fan_limit, frequency_limit",
    [
        ("bipolar", "I", .70, .75),
        ("bipolar", "II", .75, .80),
        ("bipolar", "III", .80, .90),
        ("mos", "I", .80, .80),
        ("mos", "II", .80, .80),
        ("mos", "III", .90, .80),
    ],
)
def test_table_2_exact_digital_technology_rows(
    technology, level, fan_limit, frequency_limit,
):
    result = radc.assess("complex_ic", _complex(
        technology=technology,
        junction_temperature_c={"I": 85, "II": 100, "III": 125}[level],
        supply_voltage_ratio={"I": .75, "II": .80, "III": .85}[level],
        output_current_ratio={"I": .70, "II": .75, "III": .80}[level],
        fan_out_ratio=fan_limit,
        operating_frequency_ratio=frequency_limit,
    ), level)
    checks = _checks(result)
    assert result.status == "ok"
    assert checks["fan_out_ratio"].selected_limit == fan_limit
    assert checks["operating_frequency_ratio"].selected_limit == frequency_limit


def test_complex_ic_cmos_mapping_and_printed_source_defects_are_disclosed():
    result = radc.assess("complex_ic", _complex(
        technology="cmos", fan_out_ratio=.80, operating_frequency_ratio=.80,
    ), "I")
    warning = " ".join(result.warnings)
    assert result.status == "ok"
    assert "Applying that row to CMOS" in warning
    assert "prints LSI twice" in warning
    assert "normative Table 2 value of 125" in warning


def test_complex_ic_nondigital_omits_digital_only_rows_and_low_supply_warns():
    result = radc.assess("complex_ic", _complex(
        digital=False,
        supply_voltage_ratio=.70,
        fan_out_ratio=None,
        operating_frequency_ratio=None,
    ), "I")
    assert result.status == "ok"
    assert "fan_out_ratio" not in _checks(result)
    assert "below 75%" in " ".join(result.warnings)


def test_complex_ic_missing_applicability_inputs_cannot_pass():
    params = _complex()
    del params["technology"]
    del params["digital"]
    result = radc.assess("complex_ic", params, "I")
    assert result.status == "not_evaluated"
    assert _checks(result)["digital"].status == "not_evaluated"
    assert "technology" not in _checks(result)


def test_table_4_bubble_memory_is_incomplete_without_external_support_checks():
    base = {
        **_application_defaults(),
        "ambient_operating_temperature_c": 85,
    }
    missing = radc.assess("bubble_memory", base, "III")
    assert missing.status == "not_evaluated"
    assert _checks(missing)["ambient_operating_temperature_c"].selected_limit == 85

    passed = radc.assess("bubble_memory", {
        **base,
        "support_device_checks_complete": True,
        "support_device_checks_passed": True,
    }, "II")
    assert passed.status == "ok"

    failed = radc.assess("bubble_memory", {
        **base,
        "support_device_checks_complete": True,
        "support_device_checks_passed": False,
    }, "I")
    assert failed.status == "exceeds"
    assert "external support" in " ".join(failed.warnings)


@pytest.mark.parametrize(
    "model, table, breakdown_limits, temperature_limits",
    [
        ("gaas_fet", "Table 5", (.60, .70, .70), (95, 105, 125)),
        ("microwave_transistor_impatt_gunn", "Table 6", (.60, .70, .70), (95, 105, 125)),
        ("varactor_step_recovery_pin_tunnel", "Table 7", (.70, .70, .70), (95, 105, 125)),
        ("silicon_detector_mixer", "Table 8", (.70, .70, .70), (95, 105, 125)),
        ("germanium_detector_mixer", "Table 9", (.70, .70, .70), (75, 90, 105)),
    ],
)
def test_tables_5_through_9_exact_cells(
    model, table, breakdown_limits, temperature_limits,
):
    power_limits = (.50, .60, .70)
    for index, level in enumerate(("I", "II", "III")):
        result = radc.assess(model, {
            **_application_defaults(),
            "junction_temperature_c": temperature_limits[index],
            "power_dissipation_ratio": power_limits[index],
            "breakdown_voltage_ratio": breakdown_limits[index],
        }, level)
        assert result.status == "ok"
        assert result.traceability["table"] == table
        checks = _checks(result)
        assert checks["junction_temperature_c"].selected_limit == temperature_limits[index]
        assert checks["power_dissipation_ratio"].selected_limit == power_limits[index]
        assert checks["breakdown_voltage_ratio"].selected_limit == breakdown_limits[index]


def test_table_9_keeps_limits_but_discloses_germanium_is_not_recommended():
    result = radc.assess("germanium_detector_mixer", _microwave(
        junction_temperature_c=70,
        breakdown_voltage_ratio=.65,
    ), "I")
    assert result.status == "ok"
    assert "not recommended for use" in " ".join(result.warnings)


def test_global_high_reliability_screening_is_explicit_and_fails_closed():
    params = _microwave(high_reliability_application=True)
    missing = radc.assess("gaas_fet", params, "I")
    assert _checks(missing)["quality_screening_verified"].status == "not_evaluated"
    assert missing.coverage_status == "incomplete"

    params["quality_screening_verified"] = False
    failed = radc.assess("gaas_fet", params, "I")
    assert _checks(failed)["quality_screening_verified"].status == "exceeds"

    params["quality_screening_verified"] = True
    passed = radc.assess("gaas_fet", params, "I")
    assert passed.status == "ok"


@pytest.mark.parametrize(
    "model, params, parameter",
    [
        ("hybrid", _hybrid(), "supply_voltage_control_verified"),
        ("hybrid", _hybrid(), "esd_handling_controls_verified"),
        ("complex_ic", _complex(), "signal_noise_and_supply_controls_verified"),
        (
            "bubble_memory",
            {
                **_application_defaults(),
                "ambient_operating_temperature_c": 80,
                "support_device_checks_complete": True,
                "support_device_checks_passed": True,
            },
            "device_specification_tolerances_verified",
        ),
        (
            "microwave_transistor_impatt_gunn",
            _microwave(),
            "recommended_voltage_limits_verified",
        ),
        (
            "silicon_detector_mixer",
            _microwave(),
            "transient_esd_safeguards_verified",
        ),
    ],
)
def test_delegated_application_controls_are_gating(model, params, parameter):
    missing_params = dict(params)
    missing_params.pop(parameter)
    missing = radc.assess(model, missing_params, "I")
    assert _checks(missing)[parameter].status == "not_evaluated"

    failed_params = dict(params)
    failed_params[parameter] = False
    failed = radc.assess(model, failed_params, "I")
    assert _checks(failed)[parameter].status == "exceeds"


def test_dynamic_ram_refresh_and_device_tolerances_are_explicit():
    params = {
        **_application_defaults(),
        "memory_kind": "dynamic_ram",
        "junction_temperature_c": 80,
        "supply_voltage_ratio": .70,
        "output_current_ratio": .65,
    }
    params.pop("dynamic_ram_refresh_verified")
    missing = radc.assess("ram_rom", params, "I")
    assert _checks(missing)["dynamic_ram_refresh_verified"].status == "not_evaluated"

    params["dynamic_ram_refresh_verified"] = True
    assert radc.assess("ram_rom", params, "I").status == "ok"


def test_saw_application_controls_are_checked_despite_unresolved_power_unit():
    params = {
        **_application_defaults(),
        "center_frequency_mhz": 600,
        "input_power": 10,
        "input_power_unit": "dB",
        "operating_temperature_c": 100,
    }
    params["frequency_stability_control_verified"] = False
    result = radc.assess("saw", params)
    assert _checks(result)["input_power"].status == "not_evaluated"
    assert _checks(result)["frequency_stability_control_verified"].status == "exceeds"
    assert result.compliance_status == "exceeds"
    assert result.coverage_status == "incomplete"


def test_advisory_application_hazards_are_disclosed():
    gaas = radc.assess("gaas_fet", _microwave(), "I")
    assert "switching transients" in " ".join(gaas.warnings)
    low_stress = radc.assess(
        "varactor_step_recovery_pin_tunnel", _microwave(), "I",
    )
    assert "unusually large power stress" in " ".join(low_stress.warnings)


@pytest.mark.parametrize(
    "frequency, printed_limit",
    [(499.0, 18.0), (501.0, 13.0)],
)
def test_table_10_frequency_branches_preserve_but_do_not_invent_db_reference(
    frequency, printed_limit,
):
    result = radc.assess("saw", {
        **_application_defaults(),
        "center_frequency_mhz": frequency,
        "input_power": 1,
        "input_power_unit": "dB",
        "operating_temperature_c": 125,
    })
    power = _checks(result)["input_power"]
    assert result.selected_level is None
    assert result.status == "not_evaluated"
    assert power.selected_limit == printed_limit
    assert power.status == "not_evaluated"
    assert "unreferenced dB" in power.message
    assert _checks(result)["operating_temperature_c"].status == "ok"


def test_table_10_exactly_500_mhz_and_substituted_dbm_fail_closed():
    exact = radc.assess("saw", {
        **_application_defaults(),
        "center_frequency_mhz": 500,
        "input_power": 13,
        "input_power_unit": "dB",
        "operating_temperature_c": 100,
    })
    power = _checks(exact)["input_power"]
    assert exact.status == "not_evaluated"
    assert power.selected_limit is None
    assert "exactly 500 MHz is undefined" in power.message

    dbm = radc.assess("saw", {
        **_application_defaults(),
        "center_frequency_mhz": 600,
        "input_power": 10,
        "input_power_unit": "dBm",
        "operating_temperature_c": 100,
    })
    assert dbm.status == "not_evaluated"
    assert "alter the source" in _checks(dbm)["input_power"].message


def test_table_10_temperature_can_still_exceed_despite_power_ambiguity():
    result = radc.assess("saw", {
        **_application_defaults(),
        "center_frequency_mhz": 600,
        "input_power": 10,
        "input_power_unit": "dB",
        "operating_temperature_c": 126,
    })
    assert result.status == "exceeds"
    assert _checks(result)["operating_temperature_c"].status == "exceeds"
    assert _checks(result)["input_power"].status == "not_evaluated"
    assert result.compliance_status == "exceeds"
    assert result.coverage_status == "incomplete"


def test_missing_numerical_inputs_are_not_evaluated_never_implicit_zero():
    result = radc.assess("ram_rom", {
        **_application_defaults(),
        "junction_temperature_c": "",
        "supply_voltage_ratio": .5,
        "output_current_ratio": .5,
    }, "I")
    assert result.status == "not_evaluated"
    assert _checks(result)["junction_temperature_c"].actual_value is None
    assert not result.passed


@pytest.mark.parametrize(
    "call, message",
    [
        (lambda: radc.assess("unknown", {}, "I"), "model must be one of"),
        (lambda: radc.assess("hybrid", _hybrid(film_construction="wire"), "I"), "film_construction"),
        (lambda: radc.assess("complex_ic", _complex(technology="gaas"), "I"), "technology"),
        (lambda: radc.assess("ram_rom", {"junction_temperature_c": float("nan")}, "I"), "finite"),
        (lambda: radc.assess("ram_rom", {"supply_voltage_ratio": -.1}, "I"), "non-negative"),
        (lambda: radc.assess("bubble_memory", {
            "ambient_operating_temperature_c": 20,
            "support_device_checks_complete": "yes",
        }, "I"), "boolean"),
    ],
)
def test_unsupported_or_invalid_inputs_do_not_silently_map(call, message):
    with pytest.raises((radc.UnsupportedRADC84254ModelError, ValueError), match=message):
        call()


def test_result_is_auditable_serializable_and_frozen():
    result = radc.assess("gaas_fet", _microwave(), "I")
    assert result.status == "ok"
    assert result.traceability == {
        "source": radc.REPORT_EDITION,
        "document_number": "RADC-TR-84-254",
        "accession": "AD-A153744",
        "document_sha256": radc.DOCUMENT_SHA256,
        "report_status": radc.REPORT_STATUS,
        "report_section": "2.5.1",
        "table": "Table 5",
        "report_page": "8",
        "pdf_page": 19,
        "source_locator": (
            "RADC-TR-84-254 §2.5.1, Table 5, report p. 8 (PDF p. 19)"
        ),
        "authority_role": "related historical primary derating research report",
        "support_status": "supported source-specific historical screening",
        "assurance_status": (
            "verified Tables 1-10 transcription with explicit application-prose "
            "checks and warnings"
        ),
        "conformance_scope": (
            "RADC-TR-84-254 Tables 1-10 and the explicit application controls in "
            "Sections 2.1.2-2.6; no MIL standard conformance claim"
        ),
        "level_selection": "manual; environment mapping is guidance only",
        "model": "gaas_fet",
    }
    table_parameters = {
        "junction_temperature_c", "power_dissipation_ratio", "breakdown_voltage_ratio",
    }
    assert all(
        "Table 5" in check.source_locator
        for check in result.checks
        if check.parameter in table_parameters
    )
    serialized = json.loads(json.dumps(result.long_form))
    assert serialized["status"] == "ok"
    assert serialized["compliance_status"] == "within_evaluated_limits"
    assert serialized["coverage_status"] == "complete"
    with pytest.raises(FrozenInstanceError):
        result.status = "exceeds"
    with pytest.raises(TypeError):
        result.inputs["junction_temperature_c"] = 0
    with pytest.raises(TypeError):
        result.traceability["table"] = "changed"


def test_generic_dispatcher_and_named_entry_point_are_equivalent():
    params = {
        **_application_defaults(),
        "junction_temperature_c": 85,
        "supply_voltage_ratio": .75,
        "output_current_ratio": .70,
    }
    assert radc.assess("ram_rom", params, "I") == radc.analyze_radc_tr_84_254(
        "ram_rom", params, selected_level="I"
    )
