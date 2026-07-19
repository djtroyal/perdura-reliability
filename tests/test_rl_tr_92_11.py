"""Final-table parity and fail-closed tests for RL-TR-92-11."""

from dataclasses import FrozenInstanceError
import json
import math
from pathlib import Path

import pytest

from reliability import RL_TR_92_11 as rl


_DIGITAL_APPLICATION = {
    "unused_inputs_terminated": True,
    "supply_transient_filtering_verified": True,
    "digital_design_margins_verified": True,
    "reverse_voltage_avoided": True,
    "aluminum_metallization_used": False,
}

_LINEAR_APPLICATION = {
    "linear_performance_envelope_verified": True,
    "linear_design_margins_verified": True,
    "reverse_voltage_avoided": True,
    "aluminum_metallization_used": False,
}


def _find(result, *, parameter=None, description=None, formula=None):
    for check in result.checks:
        if parameter is not None and check.parameter != parameter:
            continue
        if description is not None and description not in check.description:
            continue
        if formula is not None and check.formula != formula:
            continue
        return check
    raise AssertionError(
        f"check not found: parameter={parameter!r}, description={description!r}, "
        f"formula={formula!r}"
    )


def _mos_digital(**overrides):
    params = {
        "gate_count": 10_000,
        "supply_voltage_v": 1,
        "supplier_min_supply_v": 0,
        "supplier_max_supply_v": 20,
        "frequency_pct_of_max": 0,
        "output_current_pct_of_rated": 0,
        "fanout_pct_of_rated": 0,
        "junction_temperature_c": 25,
        "supplier_max_junction_temperature_c": 150,
        **_DIGITAL_APPLICATION,
    }
    params.update(overrides)
    return params


def _mos_linear(**overrides):
    params = {
        "transistor_count": 10_000,
        "supply_voltage_v": 1,
        "supplier_min_supply_v": 0,
        "supplier_max_supply_v": 20,
        "input_voltage_pct_of_rated": 0,
        "frequency_pct_of_max": 0,
        "output_current_pct_of_rated": 0,
        "fanout_pct_of_rated": 0,
        "junction_temperature_c": 25,
        "supplier_max_junction_temperature_c": 150,
        **_LINEAR_APPLICATION,
    }
    params.update(overrides)
    return params


def _bipolar_digital(**overrides):
    params = {
        "gate_count": 10_000,
        "supply_voltage_v": 5,
        "supply_tolerance_pct": 1,
        "supplier_min_supply_v": 4,
        "supplier_max_supply_v": 6,
        "frequency_pct_of_max": 0,
        "output_current_pct_of_rated": 0,
        "fanout_pct_of_rated": 0,
        "junction_temperature_c": 25,
        "supplier_max_junction_temperature_c": 150,
        **_DIGITAL_APPLICATION,
    }
    params.update(overrides)
    return params


def _eeprom(**overrides):
    params = {
        "bit_count": 1_000_000,
        "supply_voltage_v": 1,
        "supplier_min_supply_v": 0,
        "supplier_max_supply_v": 20,
        "frequency_pct_of_max": 0,
        "output_current_pct_of_rated": 0,
        "junction_temperature_c": 25,
        "supplier_max_junction_temperature_c": 150,
        "write_cycles": 0,
        "supplier_max_write_cycles": 1_000_000,
        **_DIGITAL_APPLICATION,
    }
    params.update(overrides)
    return params


def test_profile_identity_catalog_schema_and_ui_shape_are_serializable():
    metadata = rl.get_profile_metadata()
    assert metadata["profile_id"] == "RL-TR-92-11"
    assert metadata["accession"] == "AD-A253334"
    assert metadata["source_type"] == "Final Technical Report"
    assert metadata["conformance_claim"] is False
    assert metadata["level_selection"]["mode"] == "manual"
    assert metadata["document_sha256"] == rl.DOCUMENT_SHA256
    assert len(rl.DOCUMENT_SHA256) == 64
    assert metadata["reviewed_cross_references"]["MIL-STD-198E"][
        "source_sha256"
    ] == dict(rl.MIL_STD_198E_SOURCE_HASHES)
    assert set(rl.MIL_STD_198E_SOURCE_HASHES) == {
        "base", "notice_1", "notice_2", "notice_3",
    }
    assert all(len(value) == 64 for value in rl.MIL_STD_198E_SOURCE_HASHES.values())

    expected_tables = {
        "Table 4-7", "Table 4-11", "Table 4-15", "Table 5-3",
        "Table 6-4", "Table 6-7", "Table 6-9", "Table 7-3",
        "Table 8-2", "Table 9-2", "Table 10-2",
    }
    catalog = rl.get_model_catalog()
    assert set(catalog) == set(rl.SUPPORTED_MODELS)
    assert {entry["source"]["table"] for entry in catalog.values()} == expected_tables
    assert catalog["asic_mos_digital"]["source"] == {
        "section": "4.1", "table": "Table 4-7", "report_page": "54", "pdf_page": 62,
    }
    assert catalog["saw_device"]["source"]["pdf_page"] == 145
    assert not catalog["hybrid_deposited_film_resistor"]["executable"]

    schema = rl.profile_schema()
    assert schema["profile_id"] == "RL-TR-92-11"
    assert isinstance(schema["families"], list)
    assert {family["key"] for family in schema["families"]} == set(rl.SUPPORTED_MODELS)
    asic = next(family for family in schema["families"] if family["key"] == "asic_mos_digital")
    assert asic["category_hints"]
    assert {field["key"] for field in asic["fields"]} >= {
        "gate_count", "supplier_min_supply_v", "supplier_max_junction_temperature_c",
    }
    json.dumps(metadata)
    json.dumps(catalog)
    json.dumps(schema)


def test_manually_reviewed_final_table_oracle_matches_catalog_and_source_identity():
    fixture_path = Path(__file__).parent / "data" / "rl_tr_92_11_final_table_oracle.json"
    oracle = json.loads(fixture_path.read_text(encoding="utf-8"))
    assert "not emitted by implementation code" in oracle["review_basis"]
    assert oracle["document"] == {
        "id": rl.DOCUMENT_ID,
        "sha256": rl.DOCUMENT_SHA256,
    }
    catalog = rl.get_model_catalog()
    covered = set()

    def assert_level_rows(value):
        if value is None:
            return
        if isinstance(value, dict) and set(value) == {"I", "II", "III"}:
            return
        assert isinstance(value, dict)
        assert value
        for nested in value.values():
            assert_level_rows(nested)

    for entry in oracle["entries"]:
        assert entry["operator"]
        assert entry["table"].startswith("Table ")
        assert entry["report_page"]
        assert entry["pdf_page"] > 0
        for row, levels in entry["limits"].items():
            assert row
            assert_level_rows(levels)
        for model in entry["models"]:
            covered.add(model)
            assert catalog[model]["source"] == {
                "section": catalog[model]["source"]["section"],
                "table": entry["table"],
                "report_page": entry["report_page"],
                "pdf_page": entry["pdf_page"],
            }
            assert catalog[model]["limits"] == entry["limits"]
    assert covered == {
        model
        for model, definition in catalog.items()
        if definition["executable"]
    }


def test_public_metadata_and_catalog_helpers_return_defensive_copies():
    metadata = rl.get_profile_metadata()
    metadata["level_selection"]["mode"] = "automatic"
    assert rl.get_profile_metadata()["level_selection"]["mode"] == "manual"

    catalog = rl.get_model_catalog()
    catalog["power_silicon_bipolar"]["limits"]["junction_temperature_c"]["I"] = -1
    assert rl.get_model_catalog()["power_silicon_bipolar"]["limits"][
        "junction_temperature_c"
    ]["I"] == 95


def test_result_and_check_dataclasses_and_nested_mappings_are_immutable():
    result = rl.assess("asic_mos_digital", _mos_digital(), "I")
    assert result.status == "ok"
    assert result.assessment_complete
    assert result.long_form["conformance_claim"] is False
    with pytest.raises(FrozenInstanceError):
        result.status = "exceeds"
    with pytest.raises(FrozenInstanceError):
        result.checks[0].status = "exceeds"
    with pytest.raises(TypeError):
        result.inputs["gate_count"] = 1
    with pytest.raises(TypeError):
        result.traceability["table"] = "other"
    json.dumps(result.long_form)


def test_conditional_application_fields_are_exposed_in_profile_schema():
    schema = rl.profile_schema()
    by_model = {family["key"]: family for family in schema["families"]}
    micro_fields = {
        field["key"]: field for field in by_model["asic_mos_digital"]["fields"]
    }
    assert micro_fields["current_density_a_per_cm2"]["required_when"] == (
        "aluminum_metallization_used is true"
    )
    led_fields = {field["key"]: field for field in by_model["opto_led"]["fields"]}
    assert led_fields["peak_forward_current_pct_of_dc_max"]["required_when"] == (
        "rectified_ac_drive is true"
    )
    resistor_fields = {
        field["key"]: field for field in by_model["passive_chip_resistor_rm"]["fields"]
    }
    assert resistor_fields["proper_trimming_verified"]["required_when"] == (
        "low_noise_application is true"
    )
    cdr_fields = {
        field["key"]: field
        for field in by_model["passive_chip_capacitor_cdr"]["fields"]
    }
    assert "mil_std_198e_precautions_verified" not in cdr_fields
    assert cdr_fields[
        "maximum_applied_peak_voltage_including_transients_pct_of_rated"
    ]["required_when"] == "transient_voltage_present is true"
    assert cdr_fields[
        "special_ac_pulse_rating_and_test_evidence_verified"
    ]["required_when"] == "ac_or_pulse_service is true"
    assert cdr_fields[
        "cdr_silver_migration_mitigation_documented"
    ]["required_when"] == (
        "cdr_pure_silver_termination and "
        "simultaneous_high_humidity_and_dc are true"
    )


def test_manual_level_and_supported_model_are_mandatory():
    with pytest.raises(rl.UnsupportedRLTR9211ModelError, match="selected manually"):
        rl.assess("asic_mos_digital", {}, None)
    with pytest.raises(rl.UnsupportedRLTR9211ModelError, match="I, II, or III"):
        rl.assess("asic_mos_digital", {}, "ground")
    with pytest.raises(rl.UnsupportedRLTR9211ModelError, match="device_type"):
        rl.assess("ordinary_resistor", {}, "I")
    assert rl.assess("saw", {
        "frequency_mhz": 100,
        "input_power_dbm": 0,
        "operating_temperature_c": 25,
    }, 1).selected_level == "I"


def test_table_4_7_exact_final_cells():
    catalog = rl.get_model_catalog()
    assert catalog["asic_mos_digital"]["limits"] == {
        "supply_voltage_formula": {
            "I": "129/G^0.320", "II": "173/G^0.347", "III": "157/G^0.323",
        },
        "frequency_pct_of_max": {"I": 80, "II": 80, "III": 80},
        "output_current_pct_of_rated": {"I": 70, "II": 75, "III": 80},
        "fanout_pct_of_rated": {"I": 80, "II": 80, "III": 90},
        "junction_temperature_c": {"I": 80, "II": 121, "III": 125},
        "maximum_gate_count": {"I": 60000, "II": 60000, "III": 60000},
    }
    assert catalog["asic_mos_linear"]["limits"]["junction_temperature_c"] == {
        "I": 83, "II": 109, "III": 125,
    }
    assert catalog["asic_mos_linear"]["limits"]["input_voltage_pct_of_rated"] == {
        "I": 60, "II": 70, "III": 70,
    }
    assert catalog["asic_bipolar_digital"]["limits"] == {
        "supply_tolerance_pct": {"I": 3, "II": 5, "III": 5},
        "frequency_pct_of_max": {"I": 75, "II": 80, "III": 90},
        "output_current_pct_of_rated": {"I": 70, "II": 75, "III": 80},
        "fanout_pct_of_rated": {"I": 70, "II": 75, "III": 80},
        "junction_temperature_c": {"I": 72, "II": 85, "III": 125},
        "maximum_gate_count": {"I": 60000, "II": 26000, "III": 60000},
    }
    assert catalog["asic_bipolar_linear"]["limits"]["maximum_transistor_count"] == {
        "I": 10000, "II": 10000, "III": 10000,
    }


@pytest.mark.parametrize(
    "model, params, expected",
    [
        ("asic_mos_digital", _mos_digital(gate_count=60_000),
         (3.815762276673, 3.802135754863, 4.493210845942)),
        ("asic_mos_linear", _mos_linear(transistor_count=10_000),
         (10.990817477152, 10.776104746106, 8.594473854330)),
    ],
)
def test_table_4_7_supply_equations_golden_values(model, params, expected):
    for level, expected_limit in zip(("I", "II", "III"), expected):
        result = rl.assess(model, params, level)
        check = _find(result, parameter="supply_voltage_v", description="Applied")
        assert check.selected_limit == pytest.approx(expected_limit)
        assert "PDF p. 62" in check.source_locator
        assert check.formula and check.substitution


def test_mos_linear_level_iii_source_contradiction_above_10000_fails_closed():
    result = rl.assess(
        "asic_mos_linear", _mos_linear(transistor_count=10_001), "III",
    )
    contradiction = _find(result, parameter="transistor_count")
    assert result.status == "unsupported"
    assert not result.passed
    assert contradiction.status == "unsupported"
    assert "10,000" in contradiction.message and "60,000" in contradiction.message
    assert "Appendix A" in contradiction.source_locator

    unambiguous_level_i = rl.assess(
        "asic_mos_linear", _mos_linear(transistor_count=10_001), "I",
    )
    assert unambiguous_level_i.status == "exceeds"


def test_supplier_voltage_window_is_required_and_calculated_limit_is_not_clamped_up():
    missing = _mos_digital()
    del missing["supplier_min_supply_v"]
    del missing["supplier_max_supply_v"]
    result = rl.assess("asic_mos_digital", missing, "I")
    assert result.status == "not_evaluated"
    assert any(
        check.status == "not_evaluated" and "supplier" in check.message.lower()
        for check in result.checks
    )

    infeasible = rl.assess("asic_mos_digital", _mos_digital(
        gate_count=60_000,
        supply_voltage_v=3.8,
        supplier_min_supply_v=5,
        supplier_max_supply_v=6,
    ), "I")
    formula = _find(infeasible, parameter="supply_voltage_v", description="Applied")
    feasibility = _find(infeasible, parameter="calculated_supply_voltage_limit_v")
    assert formula.selected_limit == pytest.approx(3.815762276673)
    assert feasibility.status == "exceeds"
    assert infeasible.status == "exceeds"


def test_supplier_temperature_limit_is_required_and_applied_separately():
    missing = _mos_digital()
    del missing["supplier_max_junction_temperature_c"]
    result = rl.assess("asic_mos_digital", missing, "I")
    assert result.status == "not_evaluated"
    supplier_check = _find(result, description="Junction temperature versus supplier maximum")
    assert supplier_check.status == "not_evaluated"

    supplier_limited = rl.assess("asic_mos_digital", _mos_digital(
        junction_temperature_c=75,
        supplier_max_junction_temperature_c=70,
    ), "I")
    assert _find(
        supplier_limited,
        description="Junction temperature versus supplier maximum",
    ).status == "exceeds"


def test_microcircuit_application_obligations_and_current_density_are_independent():
    temperature = 60.0
    limit = min(366e6 / (temperature ** 1.67), 5e5)
    passing = rl.assess("asic_mos_digital", _mos_digital(
        junction_temperature_c=temperature,
        aluminum_metallization_used=True,
        current_density_a_per_cm2=limit,
        current_density_duration_hours=10_000,
    ), "I")
    assert passing.status == "ok"
    density = _find(passing, parameter="current_density_a_per_cm2")
    assert density.selected_limit == pytest.approx(limit)
    assert density.formula == "min(366e6/T_C^1.67, 5e5)"
    assert "report p. 88 (PDF p. 96)" in density.source_locator

    failed_obligation = rl.assess("asic_mos_digital", _mos_digital(
        reverse_voltage_avoided=False,
        frequency_pct_of_max=81,
    ), "I")
    assert _find(failed_obligation, parameter="reverse_voltage_avoided").status == "exceeds"
    assert _find(failed_obligation, parameter="frequency_pct_of_max").status == "exceeds"


def test_current_density_source_contradiction_and_duration_fail_closed_without_hiding_failures():
    contradictory = rl.assess("asic_mos_digital", _mos_digital(
        junction_temperature_c=25,
        aluminum_metallization_used=True,
        current_density_a_per_cm2=0,
        current_density_duration_hours=10_000,
    ), "I")
    assert contradictory.status == "unsupported"
    contradiction = _find(
        contradictory,
        description="Figure 4-34 low-temperature source consistency",
    )
    assert "51.913" in contradiction.message

    known_failure = rl.assess("asic_mos_digital", _mos_digital(
        junction_temperature_c=25,
        aluminum_metallization_used=True,
        current_density_a_per_cm2=500_001,
        current_density_duration_hours=10_000,
    ), "I")
    assert known_failure.status == "exceeds"
    assert _find(known_failure, parameter="current_density_a_per_cm2").status == "exceeds"
    assert _find(
        known_failure,
        description="Figure 4-34 low-temperature source consistency",
    ).status == "unsupported"

    other_duration = rl.assess("asic_mos_digital", _mos_digital(
        junction_temperature_c=60,
        aluminum_metallization_used=True,
        current_density_a_per_cm2=0,
        current_density_duration_hours=20_000,
    ), "I")
    assert other_duration.status == "unsupported"
    assert "10,000-hour curve" in _find(
        other_duration,
        parameter="current_density_duration_hours",
    ).message


def test_bipolar_supply_tolerance_and_supplier_extremes_are_both_checked():
    passing = rl.assess("asic_bipolar_digital", _bipolar_digital(
        supply_tolerance_pct=3,
        supplier_min_supply_v=4.85,
        supplier_max_supply_v=5.15,
    ), "I")
    assert passing.status == "ok"
    assert _find(passing, parameter="supply_tolerance_pct").selected_limit == 3

    outside = rl.assess("asic_bipolar_digital", _bipolar_digital(
        supply_tolerance_pct=3,
        supplier_min_supply_v=4.9,
        supplier_max_supply_v=5.1,
    ), "I")
    assert outside.status == "exceeds"
    assert _find(outside, description="Worst-case low").actual_value == pytest.approx(4.85)
    assert _find(outside, description="Worst-case high").actual_value == pytest.approx(5.15)


def test_table_4_11_exact_microprocessor_cells_and_golden_equations():
    catalog = rl.get_model_catalog()
    assert catalog["microprocessor_mos_8bit"]["limits"]["supply_voltage"] == {
        "I": 10, "II": 11, "III": 13,
    }
    assert catalog["microprocessor_mos_16bit"]["limits"]["junction_temperature_c"] == {
        "I": 90, "II": 125, "III": 125,
    }
    assert catalog["microprocessor_mos_32bit"]["limits"]["junction_temperature_c"] == {
        "I": 60, "II": 101, "III": 125,
    }
    assert catalog["microprocessor_bipolar_8bit"]["limits"]["junction_temperature_c"] == {
        "I": 80, "II": 85, "III": 125,
    }
    assert catalog["microprocessor_bipolar_16bit"]["limits"]["maximum_gate_count"] == {
        "I": 26000, "II": 26000, "III": 26000,
    }
    assert catalog["microprocessor_bipolar_32bit"]["limits"]["junction_temperature_c"] == {
        "I": 55, "II": 56, "III": 120,
    }

    base = _mos_digital(gate_count=10_000)
    for model, expected in (
        ("microprocessor_mos_16bit", (10.531073022221, 10.784837164837, 12.355360529056)),
        ("microprocessor_mos_32bit", (10.953048937400, 10.122028151302, 12.319958349889)),
    ):
        for level, expected_limit in zip(("I", "II", "III"), expected):
            result = rl.assess(model, base, level)
            assert _find(result, description="Applied supply").selected_limit == pytest.approx(
                expected_limit
            )


def test_table_4_15_exact_prom_cells_equations_and_supplier_write_delegation():
    catalog = rl.get_model_catalog()
    assert catalog["prom_mos_eeprom"]["limits"]["maximum_bit_count"] == {
        "I": 1_000_000, "II": 1_000_000, "III": 1_000_000,
    }
    assert catalog["prom_mos_eeprom"]["limits"]["frequency_pct_of_max"] == {
        "I": 80, "II": 80, "III": 90,
    }
    assert catalog["prom_bipolar"]["limits"]["frequency_pct_of_max"] == {
        "I": 80, "II": 90, "III": 90,
    }
    expected_supply = (5.202925360987, 5.456938146667, 7.293719060906)
    expected_writes = (13815.625271404, 105041.150641473, 300000)
    for level, supply, writes in zip(("I", "II", "III"), expected_supply, expected_writes):
        result = rl.assess("prom_mos_eeprom", _eeprom(), level)
        assert _find(result, description="Applied supply").selected_limit == pytest.approx(supply)
        assert _find(result, parameter="write_cycles", description="EEPROM write cycles").selected_limit == pytest.approx(writes)

    missing_supplier = _eeprom()
    del missing_supplier["supplier_max_write_cycles"]
    result = rl.assess("prom_mos_eeprom", missing_supplier, "III")
    assert result.status == "not_evaluated"
    assert _find(
        result,
        description="EEPROM write cycles versus supplier maximum",
    ).status == "not_evaluated"

    bipolar = {
        "bit_count": 1_000_000,
        "supply_voltage_v": 5,
        "supply_tolerance_pct": 1,
        "supplier_min_supply_v": 4,
        "supplier_max_supply_v": 6,
        "frequency_pct_of_max": 90,
        "output_current_pct_of_rated": 0,
        "junction_temperature_c": 25,
        "supplier_max_junction_temperature_c": 150,
    }
    boundary = rl.assess("prom_bipolar", bipolar, "III")
    assert _find(boundary, parameter="frequency_pct_of_max").status == "ok"
    above = rl.assess(
        "prom_bipolar", {
            **bipolar,
            "frequency_pct_of_max": math.nextafter(90.0, math.inf),
        }, "III",
    )
    assert _find(above, parameter="frequency_pct_of_max").status == "exceeds"


def test_eeprom_cycle_counts_are_exact_integers_not_lossy_floats():
    exact_supplier = 9_007_199_254_740_993
    result = rl.assess("prom_mos_eeprom", _eeprom(
        write_cycles="0",
        supplier_max_write_cycles=str(exact_supplier),
    ), "I")
    supplier = _find(result, description="EEPROM write cycles versus supplier maximum")
    assert supplier.selected_limit == exact_supplier
    assert isinstance(supplier.selected_limit, int)
    with pytest.raises(ValueError, match="integer >= 0"):
        rl.assess("prom_mos_eeprom", _eeprom(write_cycles="1.5"), "I")
    with pytest.raises(ValueError, match="integer >= 0"):
        rl.assess("prom_mos_eeprom", _eeprom(supplier_max_write_cycles=True), "I")


@pytest.mark.parametrize(
    "active, passive, expected",
    [
        (100, 10, (95, 130, 150)),
        (101, 10, (95, 130, 150)),
        (100, 11, (90, 130, 150)),
        (101, 11, (90, 125, 150)),
    ],
)
def test_table_5_3_mimic_count_quadrants(active, passive, expected):
    for level, limit in zip(("I", "II", "III"), expected):
        result = rl.assess("mimic_gaas", {
            "active_element_count": active,
            "passive_element_count": passive,
            "channel_temperature_c": limit,
            "supplier_max_channel_temperature_c": 200,
            "inert_package_cavity_verified": True,
            "electrical_test_overstress_controls_verified": True,
        }, level)
        assert result.status == "ok"
        assert _find(result, parameter="channel_temperature_c", description="Maximum").selected_limit == limit


def test_mimic_application_notes_are_explicit_fail_closed_obligations():
    result = rl.assess("mimic_gaas", {
        "active_element_count": 100,
        "passive_element_count": 10,
        "channel_temperature_c": 96,
        "supplier_max_channel_temperature_c": 200,
        "inert_package_cavity_verified": False,
    }, "I")
    assert result.status == "exceeds"
    assert _find(result, parameter="channel_temperature_c", description="Maximum").status == "exceeds"
    assert _find(result, parameter="inert_package_cavity_verified").status == "exceeds"
    assert _find(
        result,
        parameter="electrical_test_overstress_controls_verified",
    ).status == "not_evaluated"
    assert "report p. 96 (PDF p. 104)" in _find(
        result,
        parameter="inert_package_cavity_verified",
    ).source_locator


def test_tables_6_4_6_7_and_6_9_exact_cells_and_external_obligations():
    catalog = rl.get_model_catalog()
    assert catalog["power_silicon_bipolar"]["limits"] == {
        "junction_temperature_c": {"I": 95, "II": 125, "III": 135},
        "power_dissipation_pct_of_rated": {"I": 50, "II": 60, "III": 70},
        "soa_vce_pct_of_rated": {"I": 70, "II": 75, "III": 80},
        "soa_ic_pct_of_rated": {"I": 60, "II": 65, "III": 70},
        "breakdown_voltage_pct_of_rated": {"I": 65, "II": 85, "III": 90},
    }
    assert catalog["power_gaas_mesfet"]["limits"] == {
        "channel_temperature_c": {"I": 85, "II": 100, "III": 125},
        "power_dissipation_pct_of_rated": {"I": 50, "II": 60, "III": 70},
        "breakdown_voltage_pct_of_rated": {"I": 60, "II": 70, "III": 70},
    }
    assert catalog["power_silicon_mosfet"]["limits"] == {
        "junction_temperature_c": {"I": 95, "II": 120, "III": 140},
        "power_dissipation_pct_of_rated": {"I": 50, "II": 65, "III": 75},
        "breakdown_voltage_pct_of_rated": {"I": 60, "II": 70, "III": 75},
    }

    missing = rl.assess("power_silicon_bipolar", {
        "junction_temperature_c": 90,
        "power_dissipation_pct_of_rated": 40,
        "soa_vce_pct_of_rated": 60,
        "soa_ic_pct_of_rated": 50,
        "breakdown_voltage_pct_of_rated": 60,
        "power_design_margins_verified": True,
    }, "I")
    assert missing.status == "not_evaluated"
    assert _find(missing, parameter="supplier_soa_verified").status == "not_evaluated"
    assert _find(missing, parameter="thermal_cycle_profile_verified").status == "not_evaluated"

    verified = dict(missing.inputs)
    verified.update({
        "supplier_soa_verified": True,
        "thermal_cycle_profile_verified": True,
        "power_design_margins_verified": True,
    })
    assert rl.assess("power_silicon_bipolar", verified, "I").status == "ok"

    margins_missing = dict(verified)
    del margins_missing["power_design_margins_verified"]
    result = rl.assess("power_silicon_bipolar", margins_missing, "I")
    assert result.status == "not_evaluated"
    assert "report p. 117 (PDF p. 125)" in _find(
        result,
        parameter="power_design_margins_verified",
    ).source_locator


def test_table_7_3_exact_rf_cells_without_imported_power_soa_or_assembly_gate():
    catalog = rl.get_model_catalog()
    silicon = catalog["rf_silicon_bipolar"]["limits"]
    assert silicon["soa_vce_pct_of_rated"] == {"I": 70, "II": 70, "III": 70}
    assert silicon["soa_ic_pct_of_rated"] == {"I": 60, "II": 60, "III": 60}
    assert silicon["breakdown_voltage_pct_of_rated"] == {"I": 65, "II": 85, "III": 90}
    gaas = catalog["rf_gaas_mesfet"]["limits"]
    assert gaas["channel_temperature_c"] == {"I": 85, "II": 100, "III": 125}
    assert gaas["breakdown_voltage_pct_of_rated"] == {"I": 60, "II": 70, "III": 70}

    params = {
        "junction_temperature_c": 90,
        "power_dissipation_pct_of_rated": 40,
        "soa_vce_pct_of_rated": 60,
        "soa_ic_pct_of_rated": 50,
        "breakdown_voltage_pct_of_rated": 60,
        "thermal_cycle_profile_verified": True,
        "power_design_margins_verified": True,
    }
    single = rl.assess("rf_silicon_bipolar", params, "I")
    assert single.status == "ok"
    package = rl.assess("rf_multitransistor_silicon_bipolar", params, "I")
    assert package.status == "ok"
    assert all(check.parameter != "assembly_thermal_verified" for check in package.checks)
    assert any("heightened assembly" in warning for warning in package.warnings)


def test_rf_design_required_table_exception_is_visible_and_never_waives_temperature_or_current():
    schema = rl.get_input_schema("rf_silicon_bipolar")
    assert "supplier_soa_verified" not in schema["inputs"]
    assert "assembly_thermal_verified" not in schema["inputs"]
    params = {
        "junction_temperature_c": 90,
        "power_dissipation_pct_of_rated": 80,
        "soa_vce_pct_of_rated": 80,
        "soa_ic_pct_of_rated": 50,
        "breakdown_voltage_pct_of_rated": 80,
        "thermal_cycle_profile_verified": True,
        "power_design_margins_verified": True,
        "rf_table_limit_exception_documented": True,
    }
    result = rl.assess("rf_silicon_bipolar", params, "I")
    assert result.status == "not_evaluated"
    for parameter in (
        "power_dissipation_pct_of_rated",
        "soa_vce_pct_of_rated",
        "breakdown_voltage_pct_of_rated",
    ):
        check = _find(result, parameter=parameter)
        assert check.status == "not_evaluated"
        assert "no alternate numeric limit" in check.message
        assert "Application Note 4" in check.source_locator

    current_failure = rl.assess("rf_silicon_bipolar", {
        **params,
        "soa_ic_pct_of_rated": 61,
    }, "I")
    assert current_failure.status == "exceeds"
    assert _find(current_failure, parameter="soa_ic_pct_of_rated").status == "exceeds"

    temperature_failure = rl.assess("rf_silicon_bipolar", {
        **params,
        "junction_temperature_c": 96,
    }, "I")
    assert temperature_failure.status == "exceeds"
    assert _find(temperature_failure, parameter="junction_temperature_c").status == "exceeds"


def test_table_8_2_exact_opto_cells_and_percent_of_rating_semantics():
    catalog = rl.get_model_catalog()
    eighty = {"I": 55, "II": 70, "III": 80}
    for model in (
        "opto_photo_transistor", "opto_avalanche_photodiode",
        "opto_pin_photodiode", "opto_coupler",
    ):
        assert catalog[model]["limits"]["junction_temperature_pct_of_rated"] == eighty
        assert catalog[model]["inputs"]["junction_temperature_pct_of_rated"]["unit"] == "% of rated"
    assert catalog["opto_pin_photodiode"]["limits"]["reverse_voltage_pct_of_rated"] == {
        "I": 70, "II": 70, "III": 70,
    }
    assert catalog["opto_injection_laser"]["limits"] == {
        "junction_temperature_pct_of_rated": {"I": 55, "II": 70, "III": 75},
        "optical_power_pct_of_rated": {"I": 50, "II": 60, "III": 70},
    }
    assert catalog["opto_led"]["limits"]["average_forward_current_pct_of_rated"] == {
        "I": 50, "II": 65, "III": 75,
    }
    boundary = rl.assess("opto_pin_photodiode", {
        "junction_temperature_pct_of_rated": 55,
        "reverse_voltage_pct_of_rated": 70,
    }, "I")
    assert boundary.status == "ok"


def test_opto_application_margins_and_conditional_controls():
    apd = rl.assess("opto_avalanche_photodiode", {
        "junction_temperature_pct_of_rated": 55,
        "gain_margin_db": 3,
    }, "I")
    assert apd.status == "ok"
    assert _find(apd, parameter="gain_margin_db").comparison == "≥"
    assert rl.assess("opto_avalanche_photodiode", {
        "junction_temperature_pct_of_rated": 55,
        "gain_margin_db": math.nextafter(3.0, -math.inf),
    }, "I").status == "exceeds"

    coupler = rl.assess("opto_coupler", {
        "junction_temperature_pct_of_rated": 55,
        "ctr_degradation_allowance_pct": 15,
        "drive_current_above_turn_on_verified": True,
    }, "I")
    assert coupler.status == "ok"

    ild = rl.assess("opto_injection_laser", {
        "junction_temperature_pct_of_rated": 55,
        "optical_power_pct_of_rated": 50,
        "optical_power_margin_db": 3,
        "current_pulse_protection_verified": True,
        "optical_power_monitored_controlled": True,
        "sio2_glassivated": True,
        "hermetic_seal_integrity_verified": True,
    }, "I")
    assert ild.status == "ok"
    missing_seal = dict(ild.inputs)
    del missing_seal["hermetic_seal_integrity_verified"]
    assert rl.assess("opto_injection_laser", missing_seal, "I").status == "not_evaluated"

    led = rl.assess("opto_led", {
        "junction_temperature_pct_of_rated": 55,
        "average_forward_current_pct_of_rated": 50,
        "current_limiting_verified": True,
        "rectified_ac_drive": True,
        "peak_forward_current_pct_of_dc_max": 100,
    }, "I")
    assert led.status == "ok"
    assert rl.assess("opto_led", {
        **dict(led.inputs),
        "peak_forward_current_pct_of_dc_max": math.nextafter(100.0, math.inf),
    }, "I").status == "exceeds"


def test_table_9_2_exact_passive_cells_and_hybrid_absence_fails_closed():
    catalog = rl.get_model_catalog()
    assert catalog["passive_chip_resistor_rm"]["limits"] == {
        "operating_temperature_pct_of_rated": {"I": 80, "II": 80, "III": 80},
        "power_dissipation_pct_of_rated": {"I": 50, "II": 50, "III": 50},
        "voltage_pct_of_rated": {"I": 75, "II": 75, "III": 75},
    }
    assert catalog["passive_chip_capacitor_cdr"]["limits"] == {
        "operating_temperature_pct_of_rated": {"I": 85, "II": 85, "III": 85},
        "dc_voltage_pct_of_rated": {"I": 60, "II": 60, "III": 60},
    }
    assert catalog["passive_chip_capacitor_cwr"]["limits"] == {
        "operating_temperature_c": {"I": 85, "II": 85, "III": 85},
        "dc_voltage_pct_of_rated": {"I": 60, "II": 60, "III": 60},
    }
    hybrid = rl.assess("hybrid_deposited_film_resistor", {}, "I")
    assert hybrid.status == "unsupported"
    assert not hybrid.passed
    assert "no derating guidelines" in hybrid.checks[0].message
    assert "contains no row" in hybrid.checks[0].source_locator


def _resistor_application_params(**overrides):
    params = {
        "operating_temperature_pct_of_rated": 80,
        "power_dissipation_pct_of_rated": 50,
        "voltage_pct_of_rated": 75,
        "resistance_shift_tolerance_pct": 2,
        "film_temperature_c": math.nextafter(150.0, -math.inf),
        "voltage_stress_v_per_mil": math.nextafter(2.0, -math.inf),
        "power_density_w_per_in2": math.nextafter(200.0, -math.inf),
        "low_noise_application": False,
        "resistor_stacking_avoided": True,
        "pulse_application": False,
        "operating_frequency_mhz": 200,
    }
    params.update(overrides)
    return params


def _cdr_application_params(**overrides):
    params = {
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
    params.update(overrides)
    return params


def _cwr_application_params(**overrides):
    params = {
        "operating_temperature_c": 85,
        "dc_voltage_pct_of_rated": 50,
        "peak_ac_voltage_pct_of_rated": 10,
        "transient_voltage_present": False,
        "ac_or_pulse_service": True,
        "special_ac_pulse_rating_and_test_evidence_verified": True,
        "peak_charge_discharge_current_and_time_constant_reviewed": True,
        "internal_heating_and_ambient_reviewed": True,
        "environmental_conditions_reviewed": True,
        "insulation_resistance_at_temperature_reviewed": True,
        "cwr_ac_component_small_relative_to_dc_attested": True,
        "cwr_supplemental_moisture_protection_available": True,
        "design_tolerance_pct": 8,
    }
    params.update(overrides)
    return params


def test_passive_numeric_boundaries_and_conditional_application_notes():
    resistor = rl.assess(
        "passive_chip_resistor_rm", _resistor_application_params(), "I",
    )
    assert resistor.status == "ok"
    assert _find(resistor, parameter="film_temperature_c").comparison == "<"
    assert rl.assess("passive_chip_resistor_rm", _resistor_application_params(
        film_temperature_c=150,
    ), "I").status == "exceeds"
    assert rl.assess("passive_chip_resistor_rm", _resistor_application_params(
        voltage_stress_v_per_mil=2,
    ), "I").status == "exceeds"
    assert rl.assess("passive_chip_resistor_rm", _resistor_application_params(
        power_density_w_per_in2=200,
    ), "I").status == "exceeds"

    pulse = rl.assess("passive_chip_resistor_rm", _resistor_application_params(
        pulse_application=True,
    ), "I")
    assert pulse.status == "not_evaluated"
    assert _find(pulse, parameter="pulse_average_power_basis_verified").status == (
        "not_evaluated"
    )
    high_frequency = rl.assess(
        "passive_chip_resistor_rm",
        _resistor_application_params(operating_frequency_mhz=201),
        "I",
    )
    assert high_frequency.status == "not_evaluated"

    cdr = _cdr_application_params()
    passing_capacitor = rl.assess("passive_chip_capacitor_cdr", cdr, "I")
    assert passing_capacitor.status == "ok"
    combined = _find(
        passing_capacitor,
        parameter="combined_peak_ac_plus_dc_voltage_pct_of_rated",
    )
    assert combined.actual_value == 60
    assert combined.formula == "VAC,peak + VDC <= Vderated,max"
    assert rl.assess("passive_chip_capacitor_cdr", {
        **cdr,
        "peak_ac_voltage_pct_of_rated": 10.1,
    }, "I").status == "exceeds"


def test_mil_std_198e_capacitor_guidance_affects_coverage_not_compliance():
    unresolved = rl.assess(
        "passive_chip_capacitor_cdr",
        _cdr_application_params(environmental_conditions_reviewed=False),
        "I",
    )
    review = _find(unresolved, parameter="environmental_conditions_reviewed")
    assert review.status == "not_evaluated"
    assert "nonmandatory" in review.source_locator
    assert unresolved.status == "not_evaluated"
    assert unresolved.compliance_status == "within_evaluated_limits"
    assert unresolved.coverage_status == "incomplete"
    assert unresolved.long_form["compliance_status"] == "within_evaluated_limits"
    assert unresolved.long_form["coverage_status"] == "incomplete"

    exceeded_with_unresolved_guidance = rl.assess(
        "passive_chip_capacitor_cdr",
        _cdr_application_params(
            peak_ac_voltage_pct_of_rated=11,
            environmental_conditions_reviewed=False,
        ),
        "I",
    )
    assert exceeded_with_unresolved_guidance.status == "exceeds"
    assert exceeded_with_unresolved_guidance.compliance_status == "exceeds"
    assert exceeded_with_unresolved_guidance.coverage_status == "incomplete"


def test_mil_std_198e_transient_and_ac_pulse_advisories_fail_closed_as_coverage():
    at_rating = rl.assess(
        "passive_chip_capacitor_cdr",
        _cdr_application_params(
            transient_voltage_present=True,
            maximum_applied_peak_voltage_including_transients_pct_of_rated=100,
        ),
        "I",
    )
    transient = _find(
        at_rating,
        parameter="maximum_applied_peak_voltage_including_transients_pct_of_rated",
    )
    assert transient.status == "ok"
    assert transient.formula == "Vpeak,total <= Vrated"
    assert at_rating.status == "ok"

    above_rating = rl.assess(
        "passive_chip_capacitor_cdr",
        _cdr_application_params(
            transient_voltage_present=True,
            maximum_applied_peak_voltage_including_transients_pct_of_rated=100.1,
        ),
        "I",
    )
    assert _find(
        above_rating,
        parameter="maximum_applied_peak_voltage_including_transients_pct_of_rated",
    ).status == "not_evaluated"
    assert above_rating.compliance_status == "within_evaluated_limits"
    assert above_rating.coverage_status == "incomplete"

    contradictory = rl.assess(
        "passive_chip_capacitor_cdr",
        _cdr_application_params(ac_or_pulse_service=False),
        "I",
    )
    assert contradictory.status == "not_evaluated"
    assert any(
        check.parameter == "ac_or_pulse_service"
        and check.status == "not_evaluated"
        and "nonzero" in check.message
        for check in contradictory.checks
    )


def test_cdr_silver_migration_and_cwr_intended_use_are_explicit_advisories():
    cdr = rl.assess(
        "passive_chip_capacitor_cdr",
        _cdr_application_params(
            cdr_pure_silver_termination=True,
            simultaneous_high_humidity_and_dc=True,
        ),
        "I",
    )
    mitigation = _find(
        cdr, parameter="cdr_silver_migration_mitigation_documented",
    )
    assert mitigation.status == "not_evaluated"
    assert "Notice 2" in mitigation.source_locator
    assert cdr.compliance_status == "within_evaluated_limits"

    mitigated = rl.assess(
        "passive_chip_capacitor_cdr",
        _cdr_application_params(
            cdr_pure_silver_termination=True,
            simultaneous_high_humidity_and_dc=True,
            cdr_silver_migration_mitigation_documented=True,
        ),
        "I",
    )
    assert mitigated.status == "ok"

    cwr = rl.assess(
        "passive_chip_capacitor_cwr",
        _cwr_application_params(
            cwr_supplemental_moisture_protection_available=False,
        ),
        "I",
    )
    moisture = _find(
        cwr, parameter="cwr_supplemental_moisture_protection_available",
    )
    assert moisture.status == "not_evaluated"
    assert "§703.1" in moisture.source_locator
    assert cwr.compliance_status == "within_evaluated_limits"
    assert any("55%-at-125°C" in warning for warning in cwr.warnings)


@pytest.mark.parametrize(
    "frequency, power, expected_limit, expected_status",
    [(499.999, 18, 18, "ok"), (500.001, 13, 13, "ok"), (499, 18.1, 18, "exceeds")],
)
def test_table_10_2_saw_frequency_branches(frequency, power, expected_limit, expected_status):
    result = rl.assess("saw_device", {
        "frequency_mhz": frequency,
        "input_power_dbm": power,
        "operating_temperature_c": 125,
        "hermetic_package_integrity_verified": True,
        "shock_below_rated_max_verified": True,
        "vibration_below_rated_max_verified": True,
        "temperature_cycle_below_rated_max_verified": True,
    }, "II")
    check = _find(result, parameter="input_power_dbm")
    assert check.selected_limit == expected_limit
    assert result.status == expected_status
    assert "row 'Input power'" in check.source_locator
    assert "PDF p. 145" in check.source_locator


def test_table_10_2_exactly_500_mhz_is_undefined_and_never_passes():
    result = rl.assess("saw_device", {
        "frequency_mhz": 500,
        "input_power_dbm": -100,
        "operating_temperature_c": 25,
    }, "III")
    assert result.status == "unsupported"
    check = _find(result, parameter="frequency_mhz")
    assert check.status == "unsupported"
    assert "below and above 500 MHz" in check.message


def test_saw_application_obligations_fail_closed_without_hiding_table_checks():
    result = rl.assess("saw_device", {
        "frequency_mhz": 499,
        "input_power_dbm": 18.1,
        "operating_temperature_c": 125,
        "hermetic_package_integrity_verified": False,
        "shock_below_rated_max_verified": True,
        "vibration_below_rated_max_verified": True,
        "temperature_cycle_below_rated_max_verified": True,
    }, "I")
    assert result.status == "exceeds"
    assert _find(result, parameter="input_power_dbm").status == "exceeds"
    hermetic = _find(result, parameter="hermetic_package_integrity_verified")
    assert hermetic.status == "exceeds"
    assert "report p. 135 (PDF p. 143)" in hermetic.source_locator


def test_missing_plain_inputs_and_invalid_numeric_inputs_never_silently_pass():
    missing = rl.assess("opto_led", {}, "I")
    assert missing.status == "not_evaluated"
    assert all(check.status == "not_evaluated" for check in missing.checks)

    with pytest.raises(ValueError, match="integer >= 1"):
        rl.assess("asic_mos_digital", _mos_digital(gate_count=1.5), "I")
    with pytest.raises(ValueError, match="must be <="):
        rl.assess("asic_mos_digital", _mos_digital(
            supplier_min_supply_v=6,
            supplier_max_supply_v=5,
        ), "I")
    with pytest.raises(ValueError, match="must be boolean"):
        rl.assess("power_gaas_mesfet", {
            "channel_temperature_c": 80,
            "power_dissipation_pct_of_rated": 40,
            "breakdown_voltage_pct_of_rated": 50,
            "supplier_soa_verified": "yes",
            "thermal_cycle_profile_verified": True,
        }, "I")


@pytest.mark.parametrize(
    "model",
    [
        model
        for model, definition in rl.get_model_catalog().items()
        if definition["executable"]
    ],
)
def test_every_executable_catalog_model_has_a_working_complete_assessment(model):
    schema = rl.get_input_schema(model)
    params = {}
    for name, field in schema["inputs"].items():
        if field["type"] == "boolean":
            params[name] = True
        elif field.get("integer"):
            params[name] = int(field.get("min", 0))
        else:
            params[name] = 0
    for selector in (
        "aluminum_metallization_used",
        "sio2_glassivated",
        "rectified_ac_drive",
        "low_noise_application",
        "pulse_application",
        "rf_table_limit_exception_documented",
    ):
        if selector in params:
            params[selector] = False
    for parameter, value in (
        ("gain_margin_db", 3),
        ("optical_power_margin_db", 3),
        ("ctr_degradation_allowance_pct", 15),
        ("resistance_shift_tolerance_pct", 2),
        (
            "design_tolerance_pct",
            12 if model == "passive_chip_capacitor_cdr" else 8,
        ),
    ):
        if parameter in params:
            params[parameter] = value
    result = rl.assess(model, params, "I")
    assert result.status == "ok", result.long_form
    assert result.passed
    assert result.checks
