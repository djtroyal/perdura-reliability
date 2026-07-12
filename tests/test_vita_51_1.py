"""ANSI/VITA 51.1-2013 (R2018) clause and equation validation.

Expected values in this file are independently recomputed from the controlled
reference rather than copied from the implementation's intermediate fields.
"""

import math

import pytest

from reliability.MIL_HDBK_217F import (
    Capacitor,
    Connector,
    Diode,
    DetailedCMOSMicrocircuit,
    ElectronicFilter,
    FerriteBead,
    FieldEffectTransistor,
    HFDiode,
    HFLowNoiseBipolarTransistor,
    HighFrequencySiliconFET,
    MEMSOscillator,
    Meter,
    Microcircuit,
    Oscillator,
    PartsCountPart,
    PlatedThroughHoleAssembly,
    QuartzCrystal,
    Relay,
    Resistor,
    SolidStateRelay,
    SurfaceMountAssembly,
    Switch,
    VITA_CATEGORY_RULES,
    VITA_EDITION,
    VITA_PART_CATEGORIES,
    vita_manufacturer_microcircuit_rate,
    vita_parts_count_manufacturer_rate,
    vita_pth_fatigue,
)


def test_controlled_edition_and_category_inventory_are_stable():
    assert VITA_EDITION == "ANSI/VITA 51.1-2013 (R2018)"
    assert set(VITA_PART_CATEGORIES) == set(VITA_CATEGORY_RULES)
    assert {
        "microcircuit", "detailed_cmos", "diode", "fet", "resistor", "capacitor",
        "ferrite_bead", "relay", "ss_relay", "switch", "connector",
        "pth_assembly", "surface_mount_assembly", "meter", "crystal",
        "oscillator", "filter", "mems_oscillator", "parts_count",
    } <= set(VITA_PART_CATEGORIES)


def test_commercial_microcircuit_rules_change_quality_and_package_but_keep_stress_learning():
    part = Microcircuit(
        package="hermetic_dip", quality="commercial",
        years_in_production=.1, standard="VITA-51.1",
    )
    assert part.pi_factors["pi_Q"] == 1
    assert part.pi_factors["pi_L"] == 2
    expected_c2 = 3.6e-4 * 16 ** 1.08
    assert part.pi_factors["C2"] == pytest.approx(expected_c2)
    assert part.traceability["supplement"] == VITA_EDITION
    assert "known pedigree" in " ".join(part.assumptions).lower()


@pytest.mark.parametrize(
    "device_type,technology,complexity,expected",
    [
        ("linear", "bipolar", 30_000, .08),
        ("linear", "mos", 60_000, .10),
        ("pla", "bipolar", 60_000, .336),
        ("pla", "mos", 30_000, .0136),
        ("microprocessor", "bipolar", 64, .48),
        ("microprocessor", "mos", 128, 2.24),
    ],
)
def test_table_2_1_2_1_ic_complexity_extensions(
    device_type, technology, complexity, expected
):
    part = Microcircuit(
        device_type=device_type, technology=technology, complexity=complexity,
        standard="VITA-51.1",
    )
    assert part.pi_factors["C1"] == expected


@pytest.mark.parametrize(
    "technology,memory_type,complexity,expected",
    [
        ("mos", "rom", 4_194_304, .0104),
        ("mos", "prom", 16_777_216, .0272),
        ("mos", "dram", 67_108_864, .080),
        ("mos", "sram", 268_435_456, .992),
        ("bipolar", "rom", 268_435_456, 1.20),
        ("bipolar", "sram", 67_108_864, .336),
    ],
)
def test_table_2_1_2_1_memory_extensions(
    technology, memory_type, complexity, expected
):
    part = Microcircuit(
        device_type="memory", technology=technology, memory_type=memory_type,
        complexity=complexity, standard="VITA-51.1",
    )
    assert part.pi_factors["C1"] == expected


@pytest.mark.parametrize(
    "alias,underlying",
    [("sdram", "dram"), ("nvsram", "sram"), ("flash", "eeprom")],
)
def test_memory_alias_rules_match_the_underlying_model(alias, underlying):
    kwargs = dict(
        device_type="memory", technology="mos", complexity=1_000_000,
        programming_cycles=0, standard="VITA-51.1",
    )
    alias_part = Microcircuit(memory_type=alias, **kwargs)
    underlying_part = Microcircuit(memory_type=underlying, **kwargs)
    assert alias_part.failure_rate == pytest.approx(underlying_part.failure_rate)
    assert alias.upper() in " ".join(alias_part.assumptions)


def test_source_disclosure_and_sub_130_nm_warning_are_enforced():
    with pytest.raises(ValueError, match="temperature_rise_source"):
        Microcircuit(
            standard="VITA-51.1", temperature_rise_used=True,
            temperature_rise_source="",
        )
    part = Microcircuit(
        standard="VITA-51.1", feature_size_nm=90,
        temperature_rise_used=True, temperature_rise_source="datasheet theta-JC",
    )
    assert "130 nm" in " ".join(part.warnings)
    assert "datasheet theta-JC" in " ".join(part.assumptions)

    detailed = DetailedCMOSMicrocircuit(
        feature_size_microns=.09, package_material="hermetic",
        standard="VITA-51.1",
    )
    assert detailed.pi_factors["pi_Q"] == 1
    assert detailed.pi_factors["lambda_PH"] > 0
    assert "130 nm" in " ".join(detailed.warnings)


def test_permission_2_3_4_1_manufacturer_formula_is_independent():
    expected = (1 + (2 - 1) / 1 + (8 - .5) / .5) * .002
    assert vita_manufacturer_microcircuit_rate(
        .002, pi_T=2, pi_E=8, manufacturer_pi_T=1,
        manufacturer_pi_E=.5,
    ) == pytest.approx(expected)
    with pytest.raises(ValueError, match="negative"):
        vita_manufacturer_microcircuit_rate(
            1, pi_T=.1, pi_E=.1, manufacturer_pi_T=10,
            manufacturer_pi_E=10,
        )


@pytest.mark.parametrize(
    "factory",
    [
        lambda: Diode(standard="VITA-51.1"),
        lambda: HFDiode(standard="VITA-51.1"),
        lambda: HFLowNoiseBipolarTransistor(standard="VITA-51.1"),
    ],
)
def test_commercial_semiconductor_quality_default_is_one(factory):
    assert factory().pi_factors["pi_Q"] == 1


def test_appendix_d_mosfet_base_rate_recommendations():
    low = FieldEffectTransistor(fet_type="mosfet", standard="VITA-51.1")
    high = HighFrequencySiliconFET(fet_type="mosfet", standard="VITA-51.1")
    assert low.pi_factors["lambda_b"] == .0012
    assert high.pi_factors["lambda_b"] == .006
    assert "60% confidence" in " ".join(low.assumptions)
    assert "60% confidence" in " ".join(high.assumptions)


@pytest.mark.parametrize("style,expected", [("RM", .1), ("RZ", .1), ("RL", 1)])
def test_resistor_quality_exceptions(style, expected):
    assert Resistor(style=style, standard="VITA-51.1").pi_factors["pi_Q"] == expected


def test_explicit_noncommercial_quality_levels_are_not_relabelled_as_cots():
    assert Resistor(quality="non-ER", standard="VITA-51.1").pi_factors["pi_Q"] == 3
    assert Capacitor(quality="non-ER", standard="VITA-51.1").pi_factors["pi_Q"] == 3


@pytest.mark.parametrize(
    "style,capacitance,expected",
    [
        ("CDR", 1, .1), ("PS", 1, .1), ("CKR", 1, .1),
        ("CSR", 1, .1), ("CLR", 1, .1), ("CCR", 1, .46),
        ("CWR", .1, .1), ("CWR", .099999, 1), ("CK", 1, 1),
    ],
)
def test_capacitor_quality_exceptions_and_cwr_boundary(style, capacitance, expected):
    part = Capacitor(
        style=style, capacitance_microfarads=capacitance,
        standard="VITA-51.1",
    )
    assert part.pi_factors["pi_Q"] == expected


def test_ps_mapping_requires_the_supplement():
    with pytest.raises(ValueError, match="A/V51.1"):
        Capacitor(style="PS", standard="MIL-HDBK-217F")


def test_ferrite_bead_mapping_and_quality_basis():
    with pytest.raises(ValueError, match="A/V51.1"):
        FerriteBead(standard="MIL-HDBK-217F")
    recommended = FerriteBead(quality_basis="recommended")
    reproduction = FerriteBead(quality_basis="appendix_a_reproduction")
    assert recommended.pi_factors["lambda_b"] == 3e-5
    assert recommended.pi_factors["pi_Q"] == 3
    assert reproduction.pi_factors["pi_Q"] == 1


def test_relay_switch_and_connector_defaults():
    assert Relay(standard="VITA-51.1").pi_factors["pi_Q"] == 1.5
    assert SolidStateRelay(standard="VITA-51.1").pi_factors["pi_Q"] == 1
    assert Switch(standard="VITA-51.1").pi_factors["pi_Q"] == 1
    connector = Connector(
        connector_type="circular", assembly="mated_pair",
        matings_per_1000_hours=50, standard="VITA-51.1",
    )
    assert connector.pi_factors["lambda_b"] == .046
    assert connector.pi_factors["assembly_factor"] == .5
    assert connector.pi_factors["pi_K"] == 1
    assert connector.pi_factors["pi_Q"] == 1
    actual = Connector(
        connector_type="circular", assembly="mated_pair",
        matings_per_1000_hours=50, vita_use_standard_defaults=False,
        standard="VITA-51.1",
    )
    assert actual.pi_factors["lambda_b"] == .001
    assert actual.pi_factors["assembly_factor"] == 1
    assert actual.pi_factors["pi_K"] == 3


def test_bga_lead_configuration_factors_require_the_supplement():
    with pytest.raises(ValueError, match="A/V51.1"):
        SurfaceMountAssembly(
            package="plastic", lead_configuration="plastic_bga",
            standard="MIL-HDBK-217F",
        )
    plastic = SurfaceMountAssembly(
        package="plastic", lead_configuration="plastic_bga",
        standard="VITA-51.1",
    )
    ceramic = SurfaceMountAssembly(
        package="ceramic", lead_configuration="ceramic_bga",
        standard="VITA-51.1",
    )
    assert plastic.pi_factors["pi_LC"] == 100
    assert ceramic.pi_factors["pi_LC"] == 50


def _independent_pth_expected():
    alpha1, alpha2, delta_t = 7e-5, 1.8e-5, 100
    E1, E2, E2p = 2.52e6, 1.2e7, .1e6
    sy, su, ductility = 2.5e4, 4e4, .30
    h, d, t = .062, .020, .001
    A1 = math.pi / 4 * ((h + d) ** 2 - d ** 2)
    A2 = math.pi / 4 * (d ** 2 - (d - 2 * t) ** 2)
    mismatch = abs(alpha1 - alpha2) * delta_t
    elastic_trial = mismatch / (1 / E2 + A2 / (A1 * E1))
    assert elastic_trial > sy
    stress = (
        mismatch + sy * (E2 - E2p) / (E2 * E2p)
    ) / (1 / E2p + A2 / (A1 * E1))
    strain = sy / E2 + (stress - sy) / E2p

    def residual(log_n):
        n = 10 ** log_n
        rhs = n ** -.6 * ductility ** .75
        rhs += .9 * su / E2 * (
            math.exp(ductility) / .36
        ) ** (.1785 * math.log10(1e5 / n))
        return rhs - strain

    lo, hi = -6.0, 24.0
    for _ in range(160):
        mid = (lo + hi) / 2
        if residual(mid) > 0:
            lo = mid
        else:
            hi = mid
    cycles = 10 ** ((lo + hi) / 2)
    return A1, A2, stress, strain, cycles, 1e6 / (24 * cycles)


def test_appendix_f_pth_solver_independent_recomputation_and_auto_selection():
    expected = _independent_pth_expected()
    result = vita_pth_fatigue(
        temperature_range_c=100, board_thickness_inches=.062,
        drilled_hole_diameter_inches=.020, plating_thickness_inches=.001,
        hours_per_thermal_cycle=24,
    )
    for key, value in zip(("A1", "A2", "sigma", "delta_epsilon", "N_f", "FPMH"), expected):
        assert result[key] == pytest.approx(value, rel=1e-12)
    supplemented = PlatedThroughHoleAssembly(standard="VITA-51.1", method="auto")
    handbook = PlatedThroughHoleAssembly(standard="MIL-HDBK-217F", method="auto")
    vita_handbook = PlatedThroughHoleAssembly(standard="VITA-51.1", method="handbook")
    assert supplemented.failure_rate == pytest.approx(expected[-1])
    assert supplemented.traceability["section"] == "A/V51.1 Appendix F"
    assert handbook.traceability["section"] == "16.1"
    assert vita_handbook.pi_factors["pi_Q"] == 1
    assert "dimensionally inconsistent" in " ".join(supplemented.warnings)


def test_meter_crystal_oscillator_and_filter_quality_rules():
    assert Meter(standard="VITA-51.1").pi_factors["pi_Q"] == 1
    crystal = QuartzCrystal(standard="VITA-51.1")
    oscillator = Oscillator()
    assert crystal.pi_factors["pi_Q"] == 1
    assert oscillator.pi_factors["pi_Q"] == 1
    assert oscillator.failure_rate == pytest.approx(crystal.failure_rate)
    assert ElectronicFilter(standard="VITA-51.1").pi_factors["pi_Q"] == 1


def test_appendix_g_mems_example_reproduces_the_printed_appendix_a_row():
    # Appendix G/H: C1=.01, C2=2.8e-4*14^1.08, Tj=50°C, Ea=.65,
    # GB piE=.5.  The source prints 0.0095 after rounding.
    pi_t = .1 * math.exp(
        -.65 / 8.617e-5 * (1 / (50 + 273) - 1 / 298)
    )
    c2 = 2.8e-4 * 14 ** 1.08
    expected = .01 * pi_t + c2 * .5
    part = MEMSOscillator()
    assert part.failure_rate == pytest.approx(expected, rel=1e-12)
    assert part.failure_rate == pytest.approx(.0095143705, rel=1e-9)


def test_appendix_h_manufacturer_conversion_reproduces_full_precision_example():
    source = PartsCountPart(
        "ic_mos_linear_100", environment="GB", quality=1,
    ).failure_rate
    target = PartsCountPart(
        "ic_mos_linear_100", environment="AUF", quality=1,
    ).failure_rate
    expected = .002 * target / source
    assert vita_parts_count_manufacturer_rate(
        .002, target_generic_rate_fpmh=target,
        reference_generic_rate_fpmh=source,
    ) == pytest.approx(expected)
    converted = PartsCountPart(
        "ic_mos_linear_100", environment="AUF", quality=1,
        standard="VITA-51.1", manufacturer_rate_fpmh=.002,
        manufacturer_reference_environment="GB",
    )
    assert converted.failure_rate == pytest.approx(expected, rel=1e-12)
    assert converted.failure_rate == pytest.approx(.027691175, rel=1e-8)


def test_parts_count_commercial_defaults_apply_only_to_named_families():
    ic = PartsCountPart(
        "ic_bipolar_digital_100", quality="commercial",
        years_in_production=.1, standard="VITA-51.1",
    )
    discrete = PartsCountPart(
        "diode_general", quality="plastic", standard="VITA-51.1",
    )
    resistor = PartsCountPart(
        "resistor_rl", quality="commercial", standard="VITA-51.1",
    )
    assert ic.pi_factors["pi_Q"] == 1
    assert ic.pi_factors["pi_L"] == 1
    assert discrete.pi_factors["pi_Q"] == 1
    # A/V51.1 §2.2 supplies parts-count rules only for microcircuits and
    # discrete semiconductors; resistor quality remains its Appendix A input.
    assert resistor.pi_factors["pi_Q"] == 10
