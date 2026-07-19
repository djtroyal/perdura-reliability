"""Clause-level conformance tests for the historical MIL-STD-975M profile."""

from dataclasses import FrozenInstanceError
import hashlib
import json
import math
from pathlib import Path

import pytest

import reliability.MIL_STD_975M as mil


def _check(result, rule_id):
    return next(check for check in result.checks if check.rule_id == rule_id)


def test_profile_identity_catalog_provenance_and_serializable_schema():
    expected_families = {
        "capacitor", "connector", "crystal", "diode", "filter", "inductor",
        "linear_microcircuit", "digital_microcircuit", "protective_device",
        "relay", "resistor", "switch", "thermistor", "transformer",
        "transistor", "wire_cable",
    }
    assert mil.DOCUMENT_ID == "MIL-STD-975M (NASA)"
    assert mil.DOCUMENT_DATE == "5 August 1994"
    assert "Canceled without replacement" in mil.DOCUMENT_STATUS
    assert len(mil.DOCUMENT_SHA256) == 64
    assert mil.MIL_HDBK_978B_SHA256 == (
        "7ad4d29529fa42b24676fc3e22f178c2d2c099617c15fab15af8db536aa453be"
    )
    assert set(mil.FAMILY_CATALOG) == expected_families
    assert not mil.FAMILY_CATALOG["switch"]["executable"]

    schema = mil.profile_schema()
    assert schema["profile_id"] == "MIL_STD_975M"
    assert schema["historical"] is True
    assert set(schema["families"]) == expected_families
    assert schema["families"]["protective_device"]["selector"]["choices"] == [
        "fuse", "circuit_breaker"
    ]
    json.dumps(schema)


def test_pinned_source_cell_oracle_matches_executable_tables_and_locators():
    oracle = json.loads(
        (Path(__file__).parent / "data" / "mil_std_975m_oracle.json").read_text()
    )
    assert (
        oracle["review"]["independent_second_review"]["status"]
        == "complete_for_declared_numeric_scope"
    )
    assert oracle["source_document"]["sha256"] == mil.DOCUMENT_SHA256
    source_path = Path(__file__).parents[1] / oracle["source_document"][
        "local_file"
    ]
    evidence = json.loads(
        (
            Path(__file__).parents[1]
            / "docs"
            / "standards"
            / "mil-hdbk-217f-evidence.json"
        ).read_text()
    )
    source_record = next(
        document
        for document in evidence["documents"]
        if document["id"] == "mil-std-975m-derating"
    )
    assert source_record["acquisition_status"] == "local_untracked"
    assert any(
        local_file["filename"] == source_path.name
        and local_file["sha256"] == mil.DOCUMENT_SHA256
        for local_file in source_record["local_files"]
    )
    # The reviewed source is intentionally not redistributed.  Verify its bytes
    # in a maintainer checkout, while allowing metadata-only CI checkouts.
    if source_path.is_file():
        assert (
            hashlib.sha256(source_path.read_bytes()).hexdigest()
            == mil.DOCUMENT_SHA256
        )
    tables = oracle["tables"]
    assert all(
        table["source"] and table["printed_pages"]
        and table["pdf_pages"] and table["operator"]
        for table in tables.values()
    )

    capacitor_rows = {
        style: [
            rule.factor_low,
            rule.maximum_temperature_c,
            rule.factor_high,
            rule.transition_temperature_c,
        ]
        for style, rule in mil.CAPACITOR_RULES.items()
    }
    assert capacitor_rows == tables["capacitor"]["rows"]

    def paired_rows(source):
        return {"|".join(key): list(value) for key, value in source.items()}

    assert paired_rows(mil.INDUCTOR_CLASSES) == tables["inductor"]["rows"]
    assert paired_rows(mil.TRANSFORMER_CLASSES) == tables["transformer"]["rows"]
    assert {
        key: list(value.values())
        for key, value in mil.DIGITAL_MICROCIRCUIT_RULES.items()
    } == tables["digital_microcircuit"]["rows"]

    fuse_rows = {
        str(key): value for key, value in mil.FUSE_FACTORS.items()
    }
    assert fuse_rows == {
        key: value for key, value in tables["fuse"]["rows"].items()
        if key != "2_to_15"
    }
    assert dict(mil.CIRCUIT_BREAKER_FACTORS) == tables[
        "circuit_breaker"
    ]["rows"]
    assert {
        style: [
            curve.plateau_factor,
            curve.plateau_temperature_c,
            curve.zero_power_temperature_c,
        ]
        for style, curve in mil.RESISTOR_CURVES.items()
    } == tables["resistor"]["rows"]
    assert dict(mil.WIRE_SINGLE_CURRENT_A) == tables["wire"][
        "single_wire_current_a"
    ]
    assert {
        str(key): value for key, value in mil.WIRE_INSULATION_FACTORS.items()
    } == tables["wire"]["insulation_factors"]

    for family, table_key in (
        ("capacitor", "capacitor"),
        ("inductor", "inductor"),
        ("digital_microcircuit", "digital_microcircuit"),
        ("protective_device", "fuse"),
        ("resistor", "resistor"),
        ("transformer", "transformer"),
        ("wire_cable", "wire"),
    ):
        assert (
            mil.FAMILY_CATALOG[family]["printed_pages"].replace("–", "-")
            == tables[table_key]["printed_pages"]
        )
        assert (
            mil.FAMILY_CATALOG[family]["pdf_pages"].replace("–", "-")
            == tables[table_key]["pdf_pages"]
        )


def test_profile_schema_exposes_conditional_inputs_and_verification_duties():
    schema = mil.profile_schema()

    def variant(family, name=None):
        variants = schema["families"][family]["input_variants"]
        return next(
            item for item in variants
            if name is None or item["name"] == name
        )

    def field(family, key, name=None):
        return next(
            item for item in variant(family, name)["fields"]
            if item["name"] == key
        )

    guided_variants = {
        ("capacitor", "capacitor"),
        ("crystal", "crystal_or_oscillator"),
        ("diode", "diode"),
        ("inductor", "inductor"),
        ("linear_microcircuit", "linear_microcircuit"),
        ("digital_microcircuit", "digital_microcircuit"),
        ("protective_device", "fuse"),
        ("protective_device", "circuit_breaker"),
        ("relay", "relay"),
        ("resistor", "resistor"),
        ("thermistor", "thermistor"),
        ("transformer", "transformer"),
        ("transistor", "transistor"),
        ("wire_cable", "wire_and_cable"),
    }
    for family, name in guided_variants:
        definition = variant(family, name)
        assert definition["application"]
        assert definition["verification_obligations"]

    assert "CSR" in field(
        "capacitor", "effective_circuit_resistance_ohm_per_volt"
    )["required_when"]
    diode_help = field("diode", "stresses")["help"]
    assert all(key in diode_help for key in (
        "piv", "surge_current", "forward_current", "reverse_voltage",
        "power_dissipation", "peak_operating_voltage",
    ))
    assert "MIL_C_39010 A/B/F" in field(
        "inductor", "insulation_class"
    )["help"]
    assert "MIL_T_21038 Q/R/S/T/U" in field(
        "transformer", "insulation_class"
    )["help"]
    assert "power_mosfet" in field(
        "transistor", "gate_source_voltage_v"
    )["required_when"]

    op_amp_help = field(
        "linear_microcircuit", "stress_ratios"
    )["help"]
    for key in (
        "supply_voltage", "power_dissipation", "ac_input_voltage",
        "output_voltage", "output_current", "short_circuit_output_current",
        "actual_input_voltage", "actual_supply_voltage",
    ):
        assert key in op_amp_help

    digital_input = field(
        "digital_microcircuit", "actual_input_voltage"
    )
    assert digital_input["required"] is True
    assert "default" not in digital_input
    assert "bipolar has no clock row" in field(
        "digital_microcircuit", "clock_frequency_ratio"
    )["required_when"]
    assert "Radiation Environment is Yes" in field(
        "digital_microcircuit", "radiation_derating_verified"
    )["required_when"]

    waveform = field("resistor", "waveform")
    assert waveform["required"] is True
    assert "default" not in waveform
    assert waveform["choices"] == ["dc", "regular_ac", "pulse", "irregular"]
    assert "Perdura never assumes DC" in waveform["help"]
    assert "RCR, RNC, RNR, RNN, or RLR" in field(
        "resistor", "rated_continuous_working_voltage_v"
    )["required_when"]
    assert "approximately 30–40" in field(
        "resistor", "peak_power_w"
    )["required_when"]
    assert "greater than 40×" in field(
        "resistor", "rcr_peak_power_caution_reviewed"
    )["required_when"]
    assert "pulse or irregular" in field(
        "resistor", "continuous_overpower_fault_precluded"
    )["required_when"]

    for family, name, key in (
        ("protective_device", "fuse", "pcb_mounted"),
        ("protective_device", "fuse", "conformally_coated"),
        ("protective_device", "circuit_breaker", "vendor_trip_curve_verified"),
        ("transistor", "transistor", "safe_operating_area_verified"),
        ("wire_cable", "wire_and_cable", "ambient_temperature_c"),
        ("wire_cable", "wire_and_cable", "pressure_torr"),
        ("wire_cable", "wire_and_cable", "round_single_conductors"),
        ("wire_cable", "wire_and_cable", "helically_wound_bundle"),
    ):
        explicit = field(family, key, name)
        assert explicit["required"] is True
        assert "default" not in explicit

    assert field("thermistor", "rated_power_w")["required"] is True
    assert "Coefficient is NTC" in field(
        "thermistor", "dissipation_constant_w_per_c"
    )["required_when"]


CAPACITOR_LOW_RULES = {
    "CCR": (.60, 110), "CKS": (.60, 110), "CKR": (.60, 110),
    "CDR": (.60, 110), "CYR": (.50, 110), "CRH": (.60, 85),
    "CHS": (.60, 85), "CLR25": (.50, 70), "CLR27": (.50, 70),
    "CLR35": (.50, 70), "CLR37": (.50, 70), "CLR79": (.60, 110),
    "CLR81": (.60, 110), "CSR": (.50, 110), "CSS": (.50, 110),
    "CWR": (.50, 110),
}


@pytest.mark.parametrize("style, expected", CAPACITOR_LOW_RULES.items())
def test_capacitor_table_low_temperature_rows(style, expected):
    factor, maximum = expected
    kwargs = {}
    if style in {"CSR", "CSS", "CWR"}:
        kwargs["effective_circuit_resistance_ohm_per_volt"] = 1
    result = mil.capacitor(
        style,
        rated_voltage=100,
        dc_polarizing_voltage=0,
        ambient_temperature_c=25,
        **kwargs,
    )
    assert _check(result, f"975M.A.3.1.{style}.voltage").allowable == factor * 100
    assert _check(result, f"975M.A.3.1.{style}.temperature").allowable == maximum


@pytest.mark.parametrize(
    "style, temperature, factor",
    [
        ("CLR79", 70, .60), ("CLR79", 90, .50), ("CLR79", 110, .40),
        ("CLR81", 90, .50),
        ("CSR", 70, .50), ("CSR", 90, .40), ("CSR", 110, .30),
        ("CSS", 90, .40), ("CWR", 90, .40),
    ],
)
def test_capacitor_piecewise_temperature_curves(style, temperature, factor):
    result = mil.capacitor(
        style,
        rated_voltage=200,
        dc_polarizing_voltage=0,
        ambient_temperature_c=temperature,
        effective_circuit_resistance_ohm_per_volt=1,
    )
    assert _check(result, f"975M.A.3.1.{style}.voltage").allowable == pytest.approx(
        factor * 200
    )


def test_capacitor_worked_case_low_voltage_and_delegated_conditions():
    result = mil.capacitor(
        "CYR", rated_voltage=100, dc_polarizing_voltage=45,
        peak_ac_ripple_voltage=5, ambient_temperature_c=70,
    )
    assert result.passed
    assert _check(result, "975M.A.3.1.CYR.voltage").allowable == 50

    low_voltage = mil.capacitor(
        "CCR", rated_voltage=50, dc_polarizing_voltage=5,
        ambient_temperature_c=25,
    )
    assert not low_voltage.passed
    assert _check(low_voltage, "975M.A.3.1.CCR.low_voltage_rating").allowable == 100
    specialist_incomplete = mil.capacitor(
        "CSR", rated_voltage=100, dc_polarizing_voltage=10,
        ambient_temperature_c=25,
        effective_circuit_resistance_ohm_per_volt=.5,
    )
    assert specialist_incomplete.status == "not_evaluated"
    assert _check(
        specialist_incomplete, "975M.A.3.1.CSR.effective_resistance"
    ).status == "not_evaluated"

    above_tmax = mil.capacitor(
        "CYR", rated_voltage=100, dc_polarizing_voltage=60,
        ambient_temperature_c=111,
    )
    assert above_tmax.status == "fail"
    assert _check(above_tmax, "975M.A.3.1.CYR.temperature").status == "fail"
    assert _check(above_tmax, "975M.A.3.1.CYR.voltage").status == "fail"


def test_connector_strict_worked_example_requirements():
    result = mil.connector(
        application_voltage=100,
        rated_dwv_sea_level=401,
        ambient_temperature_c=70,
        resistive_heating_rise_c=30,
        insert_temperature_rating_c=151,
    )
    assert result.passed
    equal_boundaries = mil.connector(
        application_voltage=100,
        rated_dwv_sea_level=400,
        ambient_temperature_c=70,
        resistive_heating_rise_c=30,
        insert_temperature_rating_c=150,
    )
    assert not equal_boundaries.passed
    assert {check.comparison for check in equal_boundaries.checks} == {">"}


def test_crystal_fail_closed_and_oscillator_current_rules():
    with pytest.raises(mil.UnsupportedMILSTD975MError, match="no approved crystals"):
        mil.crystal_or_oscillator("crystal")
    incomplete = mil.crystal_or_oscillator(
        "oscillator", actual_crystal_current=.5, rated_crystal_current=1,
    )
    assert incomplete.status == "not_evaluated"
    assert _check(incomplete, "975M.A.3.3.crystal_current").status == "pass"
    assert _check(
        incomplete, "975M.A.3.3.component_derating"
    ).status == "not_evaluated"
    normal = mil.crystal_or_oscillator(
        "oscillator", actual_crystal_current=.5, rated_crystal_current=1,
        individual_components_verified=True,
    )
    critical = mil.crystal_or_oscillator(
        "oscillator", actual_crystal_current=.75, rated_crystal_current=1,
        startup_time_critical=True, individual_components_verified=True,
    )
    assert normal.passed and critical.passed
    assert normal.checks[0].allowable == .5
    assert critical.checks[0].allowable == .75


def test_diode_general_worked_example_and_junction_limit():
    result = mil.diode(
        "general_purpose", junction_temperature_c=124.5,
        stresses={
            "piv": (140, 200),
            "surge_current": (5, 10),
            "forward_current": (.5, 1),
        },
    )
    assert result.passed
    assert len(result.checks) == 4
    failed = mil.diode(
        "rectifier", junction_temperature_c=135,
        stresses={
            "piv": (140, 200),
            "surge_current": (5, 10),
            "forward_current": (.5, 1),
        },
    )
    assert not failed.passed


@pytest.mark.parametrize(
    "diode_type, stresses, extra",
    [
        ("varactor", {"power": (.5, 1), "reverse_voltage": (.75, 1),
                      "forward_current": (.75, 1)}, {}),
        ("voltage_regulator", {"power": (.5, 1)}, {
            "zener_current_actual": 3, "zener_current_maximum": 4,
            "zener_current_nominal": 2,
        }),
        ("voltage_reference", {}, {
            "zener_current_actual": 2, "manufacturer_zener_current": 2,
        }),
        ("zener_voltage_suppressor", {"power_dissipation": (.5, 1)}, {}),
        ("bidirectional_voltage_suppressor", {"power_dissipation": (.5, 1)}, {}),
        ("fet_current_regulator", {"peak_operating_voltage": (.8, 1)}, {}),
    ],
)
def test_diode_specialized_table_rows(diode_type, stresses, extra):
    result = mil.diode(
        diode_type, junction_temperature_c=125, stresses=stresses, **extra,
    )
    assert result.passed


def test_missing_diode_rows_do_not_mask_independent_temperature_failure():
    result = mil.diode(
        "general_purpose", junction_temperature_c=126,
        stresses={"piv": (1, 10)},
    )
    assert result.status == "fail"
    assert _check(
        result, "975M.A.3.4.general.surge_current"
    ).status == "not_evaluated"
    assert _check(
        result, "975M.A.3.4.general.junction_temperature"
    ).status == "fail"


def test_filter_exact_limits():
    result = mil.emi_filter(
        actual_current=5, rated_operating_current=10,
        actual_voltage=110, rated_operating_voltage=220,
        ambient_temperature_c=85,
    )
    assert result.passed
    assert [check.allowable for check in result.checks] == [5, 110, 85]


def test_inclusive_limits_reject_the_next_representable_outside_value():
    above = mil.emi_filter(
        actual_current=math.nextafter(0.5, math.inf),
        rated_operating_current=1,
        actual_voltage=0,
        rated_operating_voltage=1,
        ambient_temperature_c=25,
    )
    assert _check(above, "975M.A.3.5.current").passed is False

    below = mil.wire_and_cable(
        30,
        application_current_a=0,
        number_of_wires=1,
        insulation_temperature_rating_c=200,
        application_voltage_v=1,
        dielectric_withstanding_voltage_rating_v=math.nextafter(2.0, -math.inf),
    )
    assert _check(below, "975M.A.3.16.dwv").passed is False


def test_inductor_class_table_and_worked_example():
    assert dict(mil.INDUCTOR_CLASSES) == {
        ("MIL_C_39010", "A"): (105.0, 85.0),
        ("MIL_C_39010", "B"): (125.0, 105.0),
        ("MIL_C_39010", "F"): (150.0, 130.0),
        ("MIL_C_15305", "O"): (85.0, 65.0),
        ("MIL_C_15305", "A"): (105.0, 85.0),
        ("MIL_C_15305", "B"): (125.0, 105.0),
    }
    rise = mil.winding_temperature_rise(17, 15, 21, 25)
    assert rise == pytest.approx(30.0666666667)
    result = mil.inductor(
        "MIL-C-15305", "O", rated_dwv=100, application_voltage=50,
        application_current=1, rated_current=1, ambient_temperature_c=21,
        hot_resistance=17, initial_resistance=15,
        initial_ambient_temperature_c=21, shutdown_ambient_temperature_c=25,
    )
    assert result.passed
    assert result.checks[0].actual == pytest.approx(61.0666666667)
    with pytest.raises(mil.UnsupportedMILSTD975MError, match="within 5"):
        mil.winding_temperature_rise(17, 15, 21, 27)


def test_winding_temperature_rise_rejects_unphysical_negative_result_at_boundary():
    assert mil.winding_temperature_rise(1, 1, 20, 20) == 0
    with pytest.raises(ValueError, match="computed winding temperature rise"):
        mil.winding_temperature_rise(
            math.nextafter(1.0, 0.0), 1, 20, 20,
        )

    assert mil.winding_temperature_rise(1.1, 1, 20, 25) > 0
    with pytest.raises(mil.UnsupportedMILSTD975MError, match="within 5"):
        mil.winding_temperature_rise(
            1.1, 1, 20, math.nextafter(25.0, math.inf),
        )


def test_custom_inductor_temperature_rule_is_explicit_and_bounded():
    result = mil.inductor(
        "custom", custom_rated_temperature_c=100,
        rated_dwv=100, application_voltage=10,
        application_current=1, rated_current=1, ambient_temperature_c=20,
        hot_resistance=1.1, initial_resistance=1,
        initial_ambient_temperature_c=20, shutdown_ambient_temperature_c=20,
    )
    assert result.checks[0].allowable == 75
    assert any("Celsius" in warning for warning in result.warnings)
    delegated = mil.inductor(
        "custom", custom_rated_temperature_c=140,
        rated_dwv=100, application_voltage=10,
        application_current=1, rated_current=1, ambient_temperature_c=20,
        hot_resistance=1.1, initial_resistance=1,
        initial_ambient_temperature_c=20, shutdown_ambient_temperature_c=20,
    )
    assert delegated.status == "not_evaluated"
    assert delegated.checks[0].status == "not_evaluated"
    assert delegated.checks[1].status == "pass"

    invalid_rise_method_and_voltage_failure = mil.inductor(
        "MIL-C-15305", "O", rated_dwv=100, application_voltage=60,
        application_current=1, rated_current=1, ambient_temperature_c=20,
        hot_resistance=1.1, initial_resistance=1,
        initial_ambient_temperature_c=20, shutdown_ambient_temperature_c=26,
    )
    assert invalid_rise_method_and_voltage_failure.status == "fail"
    assert (
        invalid_rise_method_and_voltage_failure.checks[0].status
        == "not_evaluated"
    )
    assert invalid_rise_method_and_voltage_failure.checks[1].status == "fail"


EXPECTED_LINEAR = {
    "operational_amplifier": (
        ("supply_voltage", .80), ("power_dissipation", .75),
        ("ac_input_voltage", 1.00), ("output_voltage", 1.00),
        ("output_current", .80), ("short_circuit_output_current", .90),
    ),
    "differential_amplifier": (
        ("supply_voltage", .80), ("power_dissipation", .75),
        ("ac_input_voltage", 1.00), ("output_voltage", 1.00),
        ("output_current", .80), ("short_circuit_output_current", .90),
    ),
    "comparator": (
        ("supply_voltage", .90), ("power_dissipation", .75),
        ("ac_input_voltage", 1.00), ("open_collector_output_voltage", .90),
        ("output_current", .80), ("short_circuit_output_current", .90),
    ),
    "sense_amplifier": (
        ("supply_voltage", .80), ("power_dissipation", .75),
        ("ac_input_voltage", 1.00), ("open_collector_output_voltage", .90),
        ("output_current", .80), ("short_circuit_output_current", .90),
    ),
    "current_amplifier": (
        ("supply_voltage", .80), ("power_dissipation", .75),
        ("ac_input_voltage", 1.00), ("output_voltage", 1.00),
        ("output_current", .80), ("short_circuit_output_current", .90),
    ),
    "voltage_regulator": (
        ("input_output_differential_voltage", .80), ("power_dissipation", .80),
        ("output_current", .80), ("short_circuit_output_current", .90),
    ),
    "analog_switch": (
        ("supply_voltage", .90), ("power_dissipation", .80),
        ("output_current", .80),
    ),
}


@pytest.mark.parametrize("device_type, rules", EXPECTED_LINEAR.items())
def test_linear_microcircuit_complete_table(device_type, rules):
    assert mil.LINEAR_MICROCIRCUIT_RULES[device_type] == rules
    kwargs = {}
    if any(name == "ac_input_voltage" for name, _ in rules):
        kwargs = {"actual_input_voltage": 5, "actual_supply_voltage": 5}
    result = mil.linear_microcircuit(
        device_type, stress_ratios=dict(rules), junction_temperature_c=100,
        **kwargs,
    )
    assert result.passed
    assert len(result.checks) == len(rules) + 1 + bool(kwargs)


def test_missing_linear_rows_do_not_mask_independent_temperature_failure():
    result = mil.linear_microcircuit(
        "operational_amplifier",
        stress_ratios={"supply_voltage": .5},
        junction_temperature_c=101,
    )
    assert result.status == "fail"
    assert _check(
        result, "975M.A.3.7.operational_amplifier.power_dissipation"
    ).status == "not_evaluated"
    assert _check(
        result, "975M.A.3.7.operational_amplifier.junction_temperature"
    ).status == "fail"


EXPECTED_DIGITAL = {
    "bipolar": (.80, None, None, .80),
    "mos": (.80, None, .85, None),
    "cmos_4000_ab": (.80, .70, .85, None),
    "cmos_hc_hct": (.80, .79, .85, None),
    "cmos_ac_act": (.80, .92, .85, None),
    "line_driver_receiver": (.80, None, .80, .75),
    "gate_array_bipolar_mos": (.80, None, .80, .80),
}


@pytest.mark.parametrize("technology, expected", EXPECTED_DIGITAL.items())
def test_digital_microcircuit_complete_table(technology, expected):
    rule = mil.DIGITAL_MICROCIRCUIT_RULES[technology]
    assert tuple(rule.values()) == expected
    supply = .999 if rule["supply_voltage"] is None else rule["supply_voltage"]
    kwargs = {}
    if rule["clock_frequency"] is not None:
        kwargs["clock_frequency_ratio"] = rule["clock_frequency"]
    result = mil.digital_microcircuit(
        technology,
        output_current_or_fanout_ratio=.80,
        supply_voltage_ratio=supply,
        junction_temperature_c=100,
        actual_input_voltage=5,
        actual_supply_voltage=5,
        **kwargs,
    )
    assert result.passed


def test_digital_special_rules_fail_closed():
    ttl = mil.digital_microcircuit(
        "bipolar", output_current_or_fanout_ratio=.8,
        supply_voltage_ratio=.99, junction_temperature_c=100,
        open_collector_or_drain=True, ttl_open_collector=True,
        open_collector_output_voltage_ratio=.75,
        actual_input_voltage=5, actual_supply_voltage=5,
    )
    assert ttl.passed
    assert _check(ttl, "975M.A.3.8.bipolar.open_output").allowable == .75
    radiation_incomplete = mil.digital_microcircuit(
        "mos", output_current_or_fanout_ratio=.8,
        supply_voltage_ratio=.99, clock_frequency_ratio=.85,
        junction_temperature_c=100, actual_input_voltage=0,
        actual_supply_voltage=5, radiation_environment=True,
    )
    assert radiation_incomplete.status == "not_evaluated"
    assert _check(
        radiation_incomplete, "975M.A.3.8.mos.radiation_derating"
    ).status == "not_evaluated"

    radiation_and_numeric_failure = mil.digital_microcircuit(
        "mos", output_current_or_fanout_ratio=.81,
        supply_voltage_ratio=.99, clock_frequency_ratio=.85,
        junction_temperature_c=100, actual_input_voltage=0,
        actual_supply_voltage=5, radiation_environment=True,
    )
    assert radiation_and_numeric_failure.status == "fail"
    at_absolute_max = mil.digital_microcircuit(
        "bipolar", output_current_or_fanout_ratio=.8,
        supply_voltage_ratio=1, junction_temperature_c=100,
        actual_input_voltage=0, actual_supply_voltage=5,
    )
    assert not at_absolute_max.passed


def test_protective_device_tables_and_worked_examples():
    assert dict(mil.FUSE_FACTORS) == {
        .125: .25, .25: .30, .375: .35, .5: .40,
        .75: .40, 1.0: .45, 1.5: .45,
    }
    fuse = mil.fuse(
        rated_current=4, application_current=.9, ambient_temperature_c=80,
    )
    assert fuse.passed
    assert fuse.checks[0].allowable == pytest.approx(.9)
    assert dict(mil.CIRCUIT_BREAKER_FACTORS) == {
        "resistive": .75, "capacitive": .75, "inductive": .40,
        "motor": .20, "filament": .10,
    }
    breaker = mil.circuit_breaker(
        "motor", maximum_rated_resistive_contact_current=85,
        application_current=17, specified_maximum_ambient_temperature_c=50,
        application_ambient_temperature_c=30, vendor_trip_curve_verified=True,
    )
    assert breaker.passed
    no_series_resistance = mil.circuit_breaker(
        "capacitive", maximum_rated_resistive_contact_current=10,
        application_current=1, specified_maximum_ambient_temperature_c=50,
        application_ambient_temperature_c=20, vendor_trip_curve_verified=True,
    )
    assert no_series_resistance.status == "not_evaluated"
    assert _check(
        no_series_resistance,
        "975M.A.3.9.circuit_breaker.capacitive.series_resistance",
    ).status == "not_evaluated"

    no_series_and_overcurrent = mil.circuit_breaker(
        "capacitive", maximum_rated_resistive_contact_current=10,
        application_current=8, specified_maximum_ambient_temperature_c=50,
        application_ambient_temperature_c=20, vendor_trip_curve_verified=False,
    )
    assert no_series_and_overcurrent.status == "fail"


@pytest.mark.parametrize(
    "temperature, cycles, load, expected_factor, options",
    [
        (-21, .5, "A", .85 * .85 * 1.0, {}),
        (-20, 1, "A", .90 * .90 * 1.0, {}),
        (40, 10, "B", .85 * .90 * 1.5, {"carry_only": True}),
        (85, 11, "C", .70 * .85 * .8, {}),
    ],
)
def test_relay_temperature_rate_load_tables(
    temperature, cycles, load, expected_factor, options,
):
    result = mil.relay(
        rated_contact_current=10,
        application_contact_current=0,
        ambient_temperature_c=temperature,
        cycles_per_hour=cycles,
        load_class=load,
        on_time_seconds=.5,
        off_time_seconds=1,
        **options,
    )
    assert result.checks[0].allowable == pytest.approx(10 * expected_factor)


def test_relay_load_b_factor_is_not_artificially_capped():
    result = mil.relay(
        rated_contact_current=10, application_contact_current=12,
        ambient_temperature_c=25, cycles_per_hour=5, load_class="B",
        on_time_seconds=10, off_time_seconds=10, carry_only=True,
    )
    assert result.passed
    assert result.checks[0].allowable == pytest.approx(12.15)


def test_relay_numeric_application_constraints_are_failures_not_missing_data():
    result = mil.relay(
        rated_contact_current=10, application_contact_current=1,
        ambient_temperature_c=25, cycles_per_hour=5, load_class="A",
        on_time_seconds=.6, off_time_seconds=.5,
    )
    assert result.status == "fail"
    assert _check(result, "975M.A.3.10.load_A.on_time").status == "fail"
    assert _check(result, "975M.A.3.10.load_A.off_time").status == "fail"


RESISTOR_CURVE_ANCHORS = {
    "RCR": (.60, 70, 110), "RNC": (.60, 125, 155),
    "RNR": (.60, 125, 155), "RNN": (.60, 125, 155),
    "RLR": (.30, 70, 94), "RBR": (.60, 125, 137),
    "RTR": (.60, 85, 125), "RWR": (.60, 30, 175),
    "RER": (.60, 30, 175), "RZO": (.60, 70, 125),
    "RM": (.60, 70, 118),
}


@pytest.mark.parametrize("style, anchors", RESISTOR_CURVE_ANCHORS.items())
def test_resistor_exact_piecewise_linear_curve_anchors(style, anchors):
    factor, plateau, zero = anchors
    assert mil.resistor_power_factor(style, plateau - 1) == factor
    assert mil.resistor_power_factor(style, plateau) == factor
    assert mil.resistor_power_factor(style, (plateau + zero) / 2) == pytest.approx(
        factor / 2
    )
    assert mil.resistor_power_factor(style, zero) == 0
    with pytest.raises(mil.UnsupportedMILSTD975MError, match="endpoint"):
        mil.resistor_power_factor(style, zero + .01)


def test_resistor_worked_examples_and_pulse_delegation():
    first = mil.resistor(
        "RNR", nominal_power_w=.5, actual_power_w=.25,
        ambient_temperature_c=130, specification_maximum_voltage=200,
        actual_voltage=0, active_element_resistance_ohm=1000,
        waveform="dc",
    )
    assert first.passed
    assert first.checks[0].allowable == pytest.approx(.25)
    second = mil.resistor(
        "RNC", nominal_power_w=.1, actual_power_w=.054,
        ambient_temperature_c=100, specification_maximum_voltage=200,
        actual_voltage=160, active_element_resistance_ohm=475_000,
        waveform="regular_ac",
    )
    assert second.passed
    assert second.checks[1].allowable == 160


def _pulse_resistor(style, **overrides):
    params = {
        "nominal_power_w": 1,
        "actual_power_w": .2,
        "ambient_temperature_c": 25,
        "specification_maximum_voltage": 500,
        "actual_voltage": 100,
        "active_element_resistance_ohm": 1000,
        "waveform": "pulse",
        "rated_continuous_working_voltage_v": 100,
        "peak_power_w": 2,
        "low_duty_cycle": True,
        "continuous_overpower_fault_precluded": True,
        "steep_wavefront_compatibility_verified": True,
        "pulse_temperature_rise_acceptable_verified": True,
    }
    params.update(overrides)
    return mil.resistor(style, **params)


def test_resistor_waveform_is_explicit_at_the_public_source_dispatcher():
    with pytest.raises(
        mil.UnsupportedMILSTD975MError,
        match="resistor requires explicit source input.*waveform",
    ):
        mil.assess("resistor", {
            "style": "RNC",
            "nominal_power_w": 1,
            "actual_power_w": .2,
            "ambient_temperature_c": 25,
            "specification_maximum_voltage": 500,
            "actual_voltage": 100,
            "active_element_resistance_ohm": 1000,
        })


def test_rcr_low_duty_pulse_voltage_is_exact_but_power_caution_is_not_binary():
    boundary = _pulse_resistor(
        "RCR", actual_voltage=200, peak_power_w=35,
    )
    voltage = _check(boundary, "978B.3.2.5.2.RCR.peak_voltage")
    caution = _check(boundary, "978B.3.2.5.2.RCR.peak_power_caution")

    assert voltage.status == "pass"
    assert voltage.allowable == 200
    assert voltage.source.printed_pages == "3-23–3-24"
    assert caution.actual == 35
    assert caution.status == "not_evaluated"
    assert "approximate 30-to-40-times" in caution.notes[0]
    assert boundary.status == "not_evaluated"

    above = _pulse_resistor("RCR", actual_voltage=math.nextafter(200, math.inf))
    assert _check(above, "978B.3.2.5.2.RCR.peak_voltage").status == "fail"
    assert above.status == "fail"


def test_rcr_approximate_peak_power_caution_has_conservative_applicability():
    below = _pulse_resistor("RCR", peak_power_w=30)
    below_caution = _check(
        below, "978B.3.2.5.2.RCR.peak_power_caution"
    )
    assert below_caution.status == "pass"
    assert below_caution.allowable == 30
    assert below.status == "pass"

    for ratio in (math.nextafter(30, math.inf), 35, 40):
        transition = _pulse_resistor("RCR", peak_power_w=ratio)
        assert _check(
            transition, "978B.3.2.5.2.RCR.peak_power_caution"
        ).status == "not_evaluated"
        assert transition.status == "not_evaluated"

    ambiguous_even_if_reviewed = _pulse_resistor(
        "RCR", peak_power_w=35, rcr_peak_power_caution_reviewed=True,
    )
    assert _check(
        ambiguous_even_if_reviewed,
        "978B.3.2.5.2.RCR.peak_power_caution",
    ).status == "not_evaluated"

    above_unreviewed = _pulse_resistor("RCR", peak_power_w=41)
    assert _check(
        above_unreviewed, "978B.3.2.5.2.RCR.peak_power_caution"
    ).status == "not_evaluated"

    above_reviewed = _pulse_resistor(
        "RCR", peak_power_w=41, rcr_peak_power_caution_reviewed=True,
    )
    reviewed = _check(
        above_reviewed, "978B.3.2.5.2.RCR.peak_power_caution"
    )
    assert reviewed.status == "pass"
    assert "does not create an unprinted" in reviewed.notes[-1]
    assert above_reviewed.status == "pass"


@pytest.mark.parametrize("style", ["RNC", "RNR", "RNN", "RLR"])
def test_established_reliability_film_pulse_limits_are_inclusive(style):
    boundary = _pulse_resistor(style, actual_voltage=140, peak_power_w=4)
    voltage = _check(boundary, f"978B.3.3.5.3.{style}.peak_voltage")
    power = _check(boundary, f"978B.3.3.5.3.{style}.peak_power")

    assert voltage.status == "pass"
    assert voltage.allowable == pytest.approx(140)
    assert power.status == "pass"
    assert power.allowable == 4
    assert power.source.printed_pages == "3-31"
    assert boundary.status == "pass"

    above_voltage = _pulse_resistor(
        style, actual_voltage=math.nextafter(140, math.inf), peak_power_w=4,
    )
    assert _check(
        above_voltage, f"978B.3.3.5.3.{style}.peak_voltage"
    ).status == "fail"
    above_power = _pulse_resistor(
        style, actual_voltage=100, peak_power_w=math.nextafter(4, math.inf),
    )
    assert _check(
        above_power, f"978B.3.3.5.3.{style}.peak_power"
    ).status == "fail"


def test_high_duty_pulse_does_not_borrow_low_duty_voltage_factor():
    result = _pulse_resistor("RNC", low_duty_cycle=False, peak_power_w=4)

    assert _check(
        result, "978B.3.3.5.3.RNC.peak_voltage"
    ).status == "not_evaluated"
    assert _check(result, "978B.3.3.5.3.RNC.peak_power").status == "pass"
    assert result.status == "not_evaluated"


def test_pulse_general_duties_and_irregular_or_other_style_envelopes_fail_closed():
    unverified = _pulse_resistor(
        "RNC",
        continuous_overpower_fault_precluded=False,
        steep_wavefront_compatibility_verified=False,
        pulse_temperature_rise_acceptable_verified=False,
    )
    for rule_id in (
        "978B.3.1.6.2.continuous_overpower_fault",
        "978B.3.1.6.2.steep_wavefront",
        "978B.3.1.6.2.pulse_temperature_rise",
    ):
        assert _check(unverified, rule_id).status == "not_evaluated"
    assert unverified.status == "not_evaluated"

    irregular = _pulse_resistor("RNC", waveform="irregular")
    assert _check(irregular, "975M.A.3.11.RNC.power").status == "pass"
    assert _check(
        irregular, "978B.3.1.6.2.irregular_waveform"
    ).status == "not_evaluated"

    other_style = _pulse_resistor("RM")
    assert _check(other_style, "975M.A.3.11.RM.power").status == "pass"
    assert _check(
        other_style, "978B.3.1.6.2.RM.pulse_envelope"
    ).status == "not_evaluated"


def test_pulse_retains_independent_average_power_and_general_maximum_voltage():
    result = _pulse_resistor(
        "RNC", actual_power_w=.7, actual_voltage=501,
        specification_maximum_voltage=500,
    )

    assert _check(result, "975M.A.3.11.RNC.power").status == "fail"
    maximum = _check(result, "978B.3.1.6.2.maximum_voltage")
    assert maximum.status == "fail"
    assert maximum.source.printed_pages == "3-12–3-13"
    assert result.status == "fail"


def test_switch_and_fiber_optic_fail_closed():
    with pytest.raises(mil.UnsupportedMILSTD975MError, match="no numerical"):
        mil.switch()
    with pytest.raises(mil.UnsupportedMILSTD975MError, match="no Appendix A"):
        mil.fiber_optic()
    assert mil.appendices_without_numerical_rules() == (
        "crystal", "switch", "fiber_optic_photonics"
    )


def test_thermistor_ptc_and_ntc_rules_and_nameplate_voltage_limit():
    ptc = mil.thermistor(
        "PTC", actual_power_w=.5, rated_power_w=1,
        detailed_specification_power_limit_w=.75,
        resistance_ohm=100, actual_voltage=math.sqrt(32),
    )
    assert ptc.passed
    assert ptc.checks[-1].allowable == pytest.approx(.8 * math.sqrt(1 * 100))
    ntc = mil.thermistor(
        "NTC", actual_power_w=.04, actual_voltage=.8 * math.sqrt(.04 * 50_000),
        resistance_ohm=50_000, rated_power_w=.15,
        dissipation_constant_w_per_c=.0008,
        part_temperature_c=100,
    )
    assert ntc.passed
    assert ntc.checks[0].allowable == pytest.approx(.04)
    assert any("scanned graph" in warning for warning in ntc.warnings)

    incomplete_with_voltage_failure = mil.thermistor(
        "NTC", actual_power_w=.01, actual_voltage=100,
        resistance_ohm=100, rated_power_w=1,
    )
    assert incomplete_with_voltage_failure.status == "fail"
    assert incomplete_with_voltage_failure.checks[0].status == "not_evaluated"
    assert incomplete_with_voltage_failure.checks[1].status == "not_evaluated"
    assert incomplete_with_voltage_failure.checks[2].status == "fail"


def test_transformer_class_table_and_worked_example():
    assert dict(mil.TRANSFORMER_CLASSES) == {
        ("MIL_T_27", "Q"): (85.0, 65.0),
        ("MIL_T_27", "R"): (105.0, 85.0),
        ("MIL_T_27", "S"): (130.0, 105.0),
        ("MIL_T_27", "V"): (155.0, 130.0),
        ("MIL_T_27", "T"): (170.0, 155.0),
        ("MIL_T_21038", "Q"): (85.0, 65.0),
        ("MIL_T_21038", "R"): (105.0, 85.0),
        ("MIL_T_21038", "S"): (130.0, 105.0),
        ("MIL_T_21038", "T"): (155.0, 130.0),
        ("MIL_T_21038", "U"): (170.0, 155.0),
    }
    result = mil.transformer(
        "MIL-T-27", "S", rated_dwv=220, application_voltage=110,
        ambient_temperature_c=40,
        hot_resistance=2.95, initial_resistance=2.5,
        initial_ambient_temperature_c=25, shutdown_ambient_temperature_c=30,
    )
    assert result.passed
    assert result.checks[0].actual == pytest.approx(91.71)
    assert result.checks[0].allowable == 105


def test_transistor_complete_limits_and_power_mosfet_gate_rule():
    result = mil.transistor(
        "power_mosfet", actual_power_w=37.5, rated_power_w=75,
        actual_current_a=10.5, rated_current_a=14,
        dc_voltage_v=70, peak_ac_voltage_v=3, transient_voltage_v=2,
        rated_voltage_v=100, junction_temperature_c=125,
        gate_source_voltage_v=12, rated_gate_source_voltage_v=20,
        safe_operating_area_verified=True,
    )
    assert result.passed
    assert [check.allowable for check in result.checks[:5]] == [
        37.5, 10.5, 75, 125, 12,
    ]
    missing_soa = mil.transistor(
        "bipolar", actual_power_w=1, rated_power_w=10,
        actual_current_a=1, rated_current_a=10, dc_voltage_v=1,
        peak_ac_voltage_v=0, transient_voltage_v=0, rated_voltage_v=10,
        junction_temperature_c=25,
    )
    assert missing_soa.status == "not_evaluated"
    assert _check(
        missing_soa, "975M.A.3.15.safe_operating_area"
    ).status == "not_evaluated"

    missing_soa_and_overpower = mil.transistor(
        "bipolar", actual_power_w=6, rated_power_w=10,
        actual_current_a=1, rated_current_a=10, dc_voltage_v=1,
        peak_ac_voltage_v=0, transient_voltage_v=0, rated_voltage_v=10,
        junction_temperature_c=25,
    )
    assert missing_soa_and_overpower.status == "fail"


def test_wire_tables_bundle_formula_and_worked_selection():
    assert dict(mil.WIRE_SINGLE_CURRENT_A) == {
        "30": 1.3, "28": 1.8, "26": 2.5, "24": 3.3, "22": 4.5,
        "20": 6.5, "18": 9.2, "16": 13.0, "14": 19.0, "12": 25.0,
        "10": 33.0, "8": 44.0, "6": 60.0, "4": 81.0, "2": 108.0,
        "0": 147.0, "00": 169.0,
    }
    assert dict(mil.WIRE_INSULATION_FACTORS) == {
        200: 1.0, 150: .80, 135: .70, 105: .50,
    }
    awg16 = mil.wire_and_cable(
        16, application_current_a=8, number_of_wires=5,
        insulation_temperature_rating_c=200, application_voltage_v=50,
        dielectric_withstanding_voltage_rating_v=100,
    )
    assert awg16.passed
    assert awg16.checks[0].allowable == pytest.approx(13 * 24 / 28)
    awg18 = mil.wire_and_cable(
        18, application_current_a=8, number_of_wires=5,
        insulation_temperature_rating_c=200, application_voltage_v=50,
        dielectric_withstanding_voltage_rating_v=100,
    )
    assert not awg18.passed
    sixteen_plus = mil.wire_and_cable(
        16, application_current_a=6.5, number_of_wires=16,
        insulation_temperature_rating_c=200, application_voltage_v=50,
        dielectric_withstanding_voltage_rating_v=100,
    )
    assert sixteen_plus.checks[0].allowable == 6.5
    outside_table = mil.wire_and_cable(
        16, application_current_a=1, number_of_wires=1,
        insulation_temperature_rating_c=200, application_voltage_v=1,
        dielectric_withstanding_voltage_rating_v=2, pressure_torr=1e-5,
    )
    assert outside_table.status == "not_evaluated"
    assert _check(outside_table, "975M.A.3.16.current").status == "not_evaluated"

    outside_table_bad_dwv = mil.wire_and_cable(
        16, application_current_a=1, number_of_wires=1,
        insulation_temperature_rating_c=200, application_voltage_v=2,
        dielectric_withstanding_voltage_rating_v=3, pressure_torr=1e-5,
    )
    assert outside_table_bad_dwv.status == "fail"
    assert _check(outside_table_bad_dwv, "975M.A.3.16.dwv").status == "fail"


def test_assess_dispatcher_does_not_mutate_params_and_never_uses_three_levels():
    params = {
        "actual_current": 5,
        "rated_operating_current": 10,
        "actual_voltage": 50,
        "rated_operating_voltage": 100,
        "ambient_temperature_c": 85,
    }
    original = dict(params)
    result = mil.assess("EMI filter", params)
    assert result.family == "filter"
    assert params == original
    fuse_result = mil.assess("protective devices", {
        "device_type": "fuse", "rated_current": 4,
        "application_current": .5, "ambient_temperature_c": 25,
        "pcb_mounted": True, "conformally_coated": True,
    })
    assert fuse_result.subtype == "fuse"
    alias_result = mil.assess("fuse", {
        "rated_current": 4, "application_current": .5,
        "ambient_temperature_c": 25,
        "pcb_mounted": True, "conformally_coated": True,
    })
    assert alias_result.subtype == "fuse"
    with pytest.raises(mil.UnsupportedMILSTD975MError, match="family must"):
        mil.assess("Rome level II", {})


@pytest.mark.parametrize(
    "family, params, missing_name",
    [
        (
            "fuse",
            {
                "rated_current": 4,
                "application_current": .5,
                "ambient_temperature_c": 25,
            },
            "pcb_mounted",
        ),
        (
            "wire_cable",
            {
                "awg": 16,
                "application_current_a": 1,
                "number_of_wires": 1,
                "insulation_temperature_rating_c": 200,
                "application_voltage_v": 1,
                "dielectric_withstanding_voltage_rating_v": 2,
            },
            "round_single_conductors",
        ),
        (
            "digital_microcircuit",
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
    ],
)
def test_public_profile_dispatch_requires_explicit_application_facts(
    family, params, missing_name,
):
    with pytest.raises(
        mil.UnsupportedMILSTD975MError,
        match=missing_name,
    ):
        mil.assess(family, params)


def test_public_profile_dispatch_distinguishes_explicit_false_from_omission():
    result = mil.assess("fuse", {
        "rated_current": 4,
        "application_current": .5,
        "ambient_temperature_c": 25,
        "pcb_mounted": False,
        "conformally_coated": True,
    })
    assert result.status == "not_evaluated"
    assert _check(
        result, "975M.A.3.9.fuse.pcb_mounting"
    ).status == "not_evaluated"


def test_results_constants_and_long_form_provenance_are_immutable_or_copies():
    result = mil.emi_filter(
        actual_current=1, rated_operating_current=10,
        actual_voltage=1, rated_operating_voltage=100,
        ambient_temperature_c=25,
    )
    with pytest.raises(FrozenInstanceError):
        result.family = "changed"
    with pytest.raises(FrozenInstanceError):
        result.checks[0].allowable = 0
    with pytest.raises(TypeError):
        mil.WIRE_SINGLE_CURRENT_A["30"] = 0
    first = result.long_form
    first["checks"][0]["allowable"] = -1
    assert result.checks[0].allowable == 5
    assert first["checks"][0]["source"]["section"] == "Appendix A, 3.5"
    assert "canceled without replacement" in first["warnings"][0]
    assert "detailed-specification" in first["assumptions"][0]
    json.dumps(result.long_form)


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), -float("inf")])
def test_nonfinite_inputs_are_rejected(bad):
    with pytest.raises(ValueError, match="finite"):
        mil.emi_filter(
            actual_current=bad, rated_operating_current=10,
            actual_voltage=1, rated_operating_voltage=100,
            ambient_temperature_c=25,
        )


def test_boolean_is_not_accepted_as_numeric_input():
    with pytest.raises(ValueError, match="numeric, not boolean"):
        mil.emi_filter(
            actual_current=True, rated_operating_current=10,
            actual_voltage=1, rated_operating_voltage=100,
            ambient_temperature_c=25,
        )


@pytest.mark.parametrize("bad_boolean", ["true", 1, 0])
def test_all_public_boolean_parameters_require_actual_booleans(bad_boolean):
    calls = [
        (mil.capacitor, {
            "style": "CYR", "rated_voltage": 100,
            "dc_polarizing_voltage": 1, "ambient_temperature_c": 25,
        }, "parts_specialist_approved"),
        (mil.crystal_or_oscillator, {
            "kind": "oscillator", "actual_crystal_current": .1,
            "rated_crystal_current": 1,
        }, "startup_time_critical"),
        (mil.crystal_or_oscillator, {
            "kind": "oscillator", "actual_crystal_current": .1,
            "rated_crystal_current": 1,
        }, "individual_components_verified"),
        *(
            (mil.digital_microcircuit, {
                "technology": "bipolar",
                "output_current_or_fanout_ratio": .1,
                "supply_voltage_ratio": .5,
                "junction_temperature_c": 25,
                "actual_input_voltage": 1,
                "actual_supply_voltage": 5,
            }, field)
            for field in (
                "open_collector_or_drain", "ttl_open_collector",
                "radiation_environment", "radiation_derating_verified",
            )
        ),
        *(
            (mil.fuse, {
                "rated_current": 4, "application_current": 1,
                "ambient_temperature_c": 25,
            }, field)
            for field in ("pcb_mounted", "conformally_coated")
        ),
        *(
            (mil.circuit_breaker, {
                "load_type": "resistive",
                "maximum_rated_resistive_contact_current": 10,
                "application_current": 1,
                "specified_maximum_ambient_temperature_c": 50,
                "application_ambient_temperature_c": 20,
            }, field)
            for field in (
                "series_resistance_used", "vendor_trip_curve_verified",
                "thermal_breaker", "thermal_effects_verified",
            )
        ),
        (mil.relay, {
            "rated_contact_current": 10, "application_contact_current": 1,
            "ambient_temperature_c": 25, "cycles_per_hour": 1,
            "load_class": "C", "on_time_seconds": 1,
            "off_time_seconds": 1,
        }, "carry_only"),
        (mil.transistor, {
            "transistor_type": "bipolar", "actual_power_w": 1,
            "rated_power_w": 10, "actual_current_a": 1,
            "rated_current_a": 10, "dc_voltage_v": 1,
            "peak_ac_voltage_v": 0, "transient_voltage_v": 0,
            "rated_voltage_v": 10, "junction_temperature_c": 25,
        }, "safe_operating_area_verified"),
        *(
            (mil.wire_and_cable, {
                "awg": 16, "application_current_a": 1,
                "number_of_wires": 1,
                "insulation_temperature_rating_c": 200,
                "application_voltage_v": 1,
                "dielectric_withstanding_voltage_rating_v": 2,
            }, field)
            for field in ("round_single_conductors", "helically_wound_bundle")
        ),
    ]
    for function, kwargs, field in calls:
        with pytest.raises(ValueError, match="must be a boolean"):
            function(**(kwargs | {field: bad_boolean}))
