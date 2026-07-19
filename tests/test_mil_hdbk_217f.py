"""MIL-HDBK-217F Notice 2 handbook-parity and completeness tests."""

import math

import numpy as np
import pytest

import reliability._mil_hdbk_217f_notice2 as mil
from reliability.MIL_HDBK_217F import (
    ENVIRONMENTS,
    Capacitor,
    DetailedCMOSMicrocircuit,
    Diode,
    GaAsMicrocircuit,
    HybridMicrocircuit,
    Microcircuit,
    Motor,
    PartsCountPart,
    PartsCountPrediction,
    Resistor,
    SurfaceMountAssembly,
    SystemFailureRate,
    Transformer,
    arrhenius_pi_T,
    connector_insert_temperature_rise,
    hybrid_die_area,
    hybrid_junction_temperature,
    hybrid_junction_to_case_thermal_resistance,
    junction_temperature,
    microcircuit_custom_screening_pi_q,
    microcircuit_junction_temperature,
    parts_count_catalog,
    semiconductor_junction_temperature,
)


PUBLIC_MODEL_CLASSES = [
    mil.Microcircuit,
    mil.VHSICMicrocircuit,
    mil.GaAsMicrocircuit,
    mil.HybridMicrocircuit,
    mil.SurfaceAcousticWaveDevice,
    mil.MagneticBubbleMemory,
    mil.Diode,
    mil.HFDiode,
    mil.BipolarTransistor,
    mil.FieldEffectTransistor,
    mil.UnijunctionTransistor,
    mil.HFLowNoiseBipolarTransistor,
    mil.HFPowerBipolarTransistor,
    mil.GaAsFET,
    mil.HighFrequencySiliconFET,
    mil.Thyristor,
    mil.Optoelectronic,
    mil.LaserDiode,
    mil.ElectronTube,
    mil.TravelingWaveTube,
    mil.Magnetron,
    mil.GasLaser,
    mil.SealedCO2Laser,
    mil.FlowingCO2Laser,
    mil.SolidStateLaser,
    mil.Resistor,
    mil.Capacitor,
    mil.Transformer,
    mil.InductorCoil,
    mil.Motor,
    mil.SynchroResolver,
    mil.ElapsedTimeMeter,
    mil.Relay,
    mil.SolidStateRelay,
    mil.Switch,
    mil.CircuitBreaker,
    mil.Connector,
    mil.ConnectorSocket,
    mil.PlatedThroughHoleAssembly,
    mil.SurfaceMountAssembly,
    mil.Connection,
    mil.Meter,
    mil.QuartzCrystal,
    mil.Lamp,
    mil.ElectronicFilter,
    mil.Fuse,
    mil.MiscellaneousPart,
    mil.DetailedCMOSMicrocircuit,
]


@pytest.mark.parametrize("model", PUBLIC_MODEL_CLASSES, ids=lambda cls: cls.__name__)
def test_every_public_handbook_model_has_finite_rate_and_long_form(model):
    part = model()
    assert math.isfinite(part.failure_rate)
    assert part.failure_rate >= 0
    assert part.traceability["standard"] == mil.HANDBOOK_EDITION
    assert part.traceability["section"]
    assert part.traceability["handbook_pages"]
    assert part.traceability["equation"]
    assert part.calculation_steps
    assert part.calculation_steps[-1]["value"] == pytest.approx(part._base_failure_rate)
    assert part.long_form["failure_rate"] == pytest.approx(part.failure_rate)


def test_section_5_13_cmos_gate_array_example():
    # Handbook 5-20: 250 CMOS gates, 24-pin glass DIP, Tj=50 C, AIC,
    # custom screening piQ=3.1 and mature production gives 0.15 FPMH.
    part = Microcircuit(
        device_type="digital",
        technology="mos",
        complexity=250,
        pins=24,
        package="glass_dip",
        T_junction=50,
        quality="commercial",
        pi_Q=3.1,
        years_in_production=3,
        environment="AIC",
    )
    assert part.pi_factors["C1"] == .020
    assert part.pi_factors["pi_T"] == pytest.approx(.29, abs=.01)
    assert part.pi_factors["C2"] == pytest.approx(.011, abs=.001)
    assert part.failure_rate == pytest.approx(.15, abs=.01)


def test_section_5_13_flotox_eeprom_example_uses_tabulated_a1():
    # Handbook 5-20/5-21: 128K Flotox, 10K cycles, 28-pin glass DIP,
    # Tj=80 C, AUC, B-1, mature production gives 0.93 FPMH.
    part = Microcircuit(
        device_type="memory",
        technology="mos",
        memory_type="eeprom",
        complexity=131072,
        pins=28,
        package="glass_dip",
        T_junction=80,
        quality="B-1",
        years_in_production=3,
        environment="AUC",
        eeprom_technology="flotox",
        programming_cycles=10000,
    )
    assert part.pi_factors["C1"] == .0034
    assert part.pi_factors["A1"] == .10
    assert part.pi_factors["B1"] == pytest.approx(3.8, abs=.1)
    assert part.pi_factors["lambda_cyc"] == pytest.approx(.38, abs=.02)
    assert part.failure_rate == pytest.approx(.93, abs=.02)


def test_radc_80_237_ccd_maps_explicitly_to_nmos_dram():
    kwargs = dict(
        device_type="memory",
        technology="mos",
        complexity=262_144,
        pins=18,
        package="nonhermetic",
        T_junction=40,
        quality="B",
        environment="GB",
    )
    ccd = Microcircuit(memory_type="ccd", **kwargs)
    dram = Microcircuit(memory_type="dram", **kwargs)
    assert ccd.failure_rate == pytest.approx(dram.failure_rate)
    assert ccd.pi_factors["C1"] == dram.pi_factors["C1"]
    assert ccd.traceability["model_mapping"] == {
        "requested_model": "CCD memory",
        "effective_model": "NMOS dynamic RAM",
        "source": "RADC-TR-80-237 (July 1980), Section IV.E-F",
    }
    assert "limited Intel 2416" in " ".join(ccd.warnings)
    assert "soft errors" in " ".join(ccd.warnings)

    with pytest.raises(ValueError, match="CCD requires device_type='memory'"):
        Microcircuit(device_type="digital", memory_type="ccd")
    with pytest.raises(ValueError, match="supported only as the NMOS"):
        Microcircuit(
            device_type="memory", technology="bipolar", memory_type="ccd",
        )


def test_ccd_does_not_inherit_vita_dram_complexity_extension():
    with pytest.raises(ValueError, match=r"exceeds handbook model limit 1.04858e\+06"):
        Microcircuit(
            device_type="memory",
            technology="mos",
            memory_type="ccd",
            complexity=4_194_304,
            standard="VITA-51.1",
        )
    assert Microcircuit(
        device_type="memory",
        technology="mos",
        memory_type="dram",
        complexity=4_194_304,
        standard="VITA-51.1",
    ).pi_factors["C1"] == .020


def test_microcircuit_quality_and_result_context_are_traceable():
    part = Microcircuit(quality="B-1")
    assert "§1.2.1-compliant non-JAN screening bucket" in (
        part.traceability["quality_basis"]
    )
    assert "planning estimate" in part.traceability["result_context"]
    assert "field failure rate" in part.traceability["result_context"]

    count_part = PartsCountPart(
        part_type="ic_bipolar_digital_100",
        quality="B-1",
    )
    assert "§1.2.1-compliant non-JAN screening bucket" in (
        count_part.traceability["quality_basis"]
    )


def test_section_5_13_gaas_mmic_example():
    part = GaAsMicrocircuit(
        device_type="mmic",
        active_elements=4,
        application="unknown",
        pins=16,
        package="flatpack",
        T_junction=145,
        quality="B-1",
        years_in_production=1,
        environment="GB",
    )
    assert part.pi_factors["C1"] == 4.5
    assert part.pi_factors["pi_T"] == pytest.approx(.061, abs=.002)
    assert part.pi_factors["C2"] == pytest.approx(.0047, abs=.0002)
    assert part.failure_rate == pytest.approx(2.5, abs=.1)


def test_section_5_13_hybrid_example_rollup():
    # The handbook's component sum is 0.0966 FPMH before hybrid factors.
    part = HybridMicrocircuit(
        sum_Ni_lambda_ci=.0966,
        function="linear",
        quality="B",
        years_in_production=3,
        environment="NU",
    )
    assert part.pi_factors["pi_E"] == 6
    assert part.pi_factors["pi_F"] == 5.8
    assert part.failure_rate == pytest.approx(1.2, abs=.04)


def test_sections_5_6_and_5_7_screening_and_bubble_equations():
    commercial = mil.SurfaceAcousticWaveDevice(screening="commercial", environment="GB")
    screened = mil.SurfaceAcousticWaveDevice(screening="ten_temperature_cycles", environment="GB")
    assert commercial.pi_factors["pi_Q"] == 1
    assert screened.pi_factors["pi_Q"] == .1
    assert commercial.failure_rate == pytest.approx(1.05)
    assert screened.failure_rate == pytest.approx(.105)

    bubble = mil.MagneticBubbleMemory(
        dissipative_elements=100,
        memory_bits=10_000,
        chips_per_package=1,
        data_rate_ratio=.5,
        reads_per_write=100,
        T_junction_1=25,
        T_junction_2=25,
        pins=16,
        package="nonhermetic",
        quality="B",
        years_in_production=2,
        environment="GB",
    )
    c11 = .00095 * 100 ** .40
    c21 = .0001 * 100 ** .226
    c12 = .00007 * 10_000 ** .3
    c22 = .00001 * 10_000 ** .3
    c2 = 3.6e-4 * 16 ** 1.08
    pi_w = 10 * .5 / 100 ** .3
    expected = (c11 * .1 * pi_w + (c21 + c2) * .5) * .55 + c12 * .1 + c22 * .5
    assert bubble.pi_factors["C2"] == pytest.approx(c2)
    assert bubble.pi_factors["pi_W"] == pytest.approx(pi_w)
    assert bubble.failure_rate == pytest.approx(expected)


def test_section_5_3_unknown_esd_uses_zero_volt_handbook_default():
    part = mil.VHSICMicrocircuit()
    expected = -math.log1p(-.00057) / .00876
    assert part.pi_factors["lambda_EOS"] == pytest.approx(expected)
    assert expected == pytest.approx(.065, abs=.001)


def test_section_6_15_dual_transistor_example():
    side_1 = mil.BipolarTransistor(
        application="linear", rated_power=.35, voltage_stress=.5,
        T_junction=62, quality="JAN", environment="NS",
    )
    side_2 = mil.BipolarTransistor(
        application="linear", rated_power=.35, voltage_stress=.3,
        T_junction=59, quality="JAN", environment="NS",
    )
    assert side_1.failure_rate + side_2.failure_rate == pytest.approx(.011, abs=.001)


def test_section_6_applicability_ranges_are_not_silently_extrapolated():
    with pytest.raises(ValueError, match="35 GHz"):
        mil.HFDiode(diode_type="impatt", frequency_ghz=35.1)
    with pytest.raises(ValueError, match="0.2–35 GHz"):
        mil.HFDiode(diode_type="schottky", frequency_ghz=.1)
    with pytest.raises(ValueError, match="3,000 W"):
        mil.HFDiode(diode_type="pin", rated_power=3001)
    with pytest.raises(ValueError, match="200 MHz"):
        mil.BipolarTransistor(frequency_mhz=201)
    with pytest.raises(ValueError, match="400 MHz"):
        mil.FieldEffectTransistor(frequency_mhz=401)
    with pytest.raises(ValueError, match="at or above 2 W"):
        mil.FieldEffectTransistor(application="power", rated_power=1.99)
    with pytest.raises(ValueError, match="above 200 MHz"):
        mil.HFLowNoiseBipolarTransistor(frequency_mhz=200)
    with pytest.raises(ValueError, match="below 1 W"):
        mil.HFLowNoiseBipolarTransistor(rated_power=1)
    with pytest.raises(ValueError, match="below 0.3 W"):
        mil.HighFrequencySiliconFET(average_power_watts=.3)
    with pytest.raises(ValueError, match="above 400 MHz"):
        mil.HighFrequencySiliconFET(frequency_mhz=400)


def test_section_6_7_power_table_temperature_and_duty_endpoints():
    with pytest.raises(ValueError, match="through 5 GHz"):
        mil.HFPowerBipolarTransistor(frequency_ghz=5.01)
    with pytest.raises(ValueError, match="50 W"):
        mil.HFPowerBipolarTransistor(frequency_ghz=5, rated_power_watts=51)
    with pytest.raises(ValueError, match="between 100 and 200"):
        mil.HFPowerBipolarTransistor(T_junction=99)

    low = mil.HFPowerBipolarTransistor(operation="pulsed", duty_cycle=0)
    one_percent = mil.HFPowerBipolarTransistor(operation="pulsed", duty_cycle=.01)
    thirty_percent = mil.HFPowerBipolarTransistor(operation="pulsed", duty_cycle=.30)
    high = mil.HFPowerBipolarTransistor(operation="pulsed", duty_cycle=1)
    assert low.pi_factors["pi_A"] == pytest.approx(.46)
    assert one_percent.pi_factors["pi_A"] == pytest.approx(.46)
    assert thirty_percent.pi_factors["pi_A"] == pytest.approx(2.2)
    assert high.pi_factors["pi_A"] == pytest.approx(2.2)


def test_sections_6_8_and_6_13_use_handbook_physical_inputs():
    gaas = mil.GaAsFET(channel_temperature_c=25)
    assert gaas.pi_factors["pi_T"] == pytest.approx(1)

    laser = mil.LaserDiode(
        T_junction=25,
        forward_peak_current_amps=4,
        optical_flux_density_mw_per_cm2=2.9,
    )
    assert laser.pi_factors["pi_I"] == pytest.approx(4 ** .68)
    assert laser.traceability["handbook_pages"] == "6-21–6-22"
    with pytest.raises(ValueError, match="25 A"):
        mil.LaserDiode(forward_peak_current_amps=25.1)
    with pytest.raises(ValueError, match="below 3 MW"):
        mil.LaserDiode(optical_flux_density_mw_per_cm2=3)
    with pytest.raises(ValueError, match="between 25 and 75"):
        mil.LaserDiode(T_junction=76)


def test_section_6_14_thermal_table_and_overstress_rule():
    assert mil.SEMICONDUCTOR_THETA_JC["PT-6B"] == 70
    assert mil.SEMICONDUCTOR_THETA_JC["PY-373"] == 70
    assert mil.semiconductor_junction_temperature(
        1, case_temperature=25, package_type="PY-373"
    ) == pytest.approx(95)
    with pytest.raises(ValueError, match="overstress"):
        mil.semiconductor_junction_temperature(
            1,
            case_temperature=25,
            package_type="PY-373",
            maximum_rated_junction_temperature=90,
        )


def test_section_6_14_requires_a_real_thermal_path_and_reports_provenance():
    with pytest.raises(ValueError, match="theta_jc or a Section 6.14 package_type"):
        mil.semiconductor_junction_temperature(1, case_temperature=25)

    table = mil.semiconductor_junction_temperature(
        .5,
        case_temperature=25,
        package_type="TO-5",
        return_details=True,
    )
    assert isinstance(table, mil.ThermalEstimate)
    assert table.junction_temperature_c == pytest.approx(60)
    assert table.thermal_basis == "handbook_table"
    assert table.preliminary is True
    assert table.junction_temperature_low_c is None

    measured = mil.semiconductor_junction_temperature(
        .5,
        case_temperature=25,
        theta_jc=20,
        thermal_basis="manufacturer",
        thermal_source_note="Device data sheet, revision C",
        theta_jc_low=18,
        theta_jc_high=24,
        return_details=True,
    )
    assert measured.junction_temperature_c == pytest.approx(35)
    assert measured.junction_temperature_low_c == pytest.approx(34)
    assert measured.junction_temperature_high_c == pytest.approx(37)
    assert measured.preliminary is False
    assert measured.source_note == "Device data sheet, revision C"

    with pytest.raises(ValueError, match="source_note is required"):
        mil.semiconductor_junction_temperature(
            .5,
            case_temperature=25,
            theta_jc=20,
            thermal_basis="measured",
            return_details=True,
        )


def test_section_7_3_rejects_construction_operation_mismatch():
    with pytest.raises(ValueError, match="pulsed magnetrons"):
        mil.Magnetron(operation="pulsed", construction="continuous")
    with pytest.raises(ValueError, match="continuous-wave magnetrons"):
        mil.Magnetron(operation="continuous", construction="coaxial_pulsed")
    assert mil.Magnetron(operation="continuous", construction="continuous").pi_factors["pi_C"] == 1


def test_section_10_2_capacitor_example():
    stress = mil.capacitor_voltage_stress(200, 50, 400)
    part = Capacitor(
        style="CQ",
        capacitance_microfarads=.015,
        voltage_stress=stress,
        T_ambient=50,
        quality="non-ER",
        environment="GF",
    )
    assert part.pi_factors["pi_T"] == pytest.approx(1.6, abs=.05)
    assert part.pi_factors["pi_C"] == pytest.approx(.69, abs=.02)
    assert part.pi_factors["pi_V"] == pytest.approx(2.9, abs=.1)
    assert part.failure_rate == pytest.approx(.049, abs=.004)


def test_section_10_voltage_stress_helper_rejects_overstress():
    assert mil.capacitor_voltage_stress(200, 50, 400) == pytest.approx(
        (200 + math.sqrt(2) * 50) / 400
    )
    with pytest.raises(ValueError, match="overstress"):
        mil.capacitor_voltage_stress(400, 1, 400)


def test_section_12_1_motor_example():
    part = Motor(motor_type="general", T_ambient=50, life_cycle_hours=87600)
    assert part.pi_factors["alpha_B"] == pytest.approx(55000, rel=.01)
    assert part.pi_factors["alpha_W"] == pytest.approx(290000, rel=.02)
    assert part.failure_rate == pytest.approx(10.3, abs=.1)


def test_section_12_1_weighted_temperature_profile():
    profile = [(1000, 25), (500, 70)]
    part = Motor(temperature_profile=profile)
    alpha_b_25, alpha_w_25 = mil._motor_characteristic_lives(25)
    alpha_b_70, alpha_w_70 = mil._motor_characteristic_lives(70)
    expected_b = 1500 / (1000 / alpha_b_25 + 500 / alpha_b_70)
    expected_w = 1500 / (1000 / alpha_w_25 + 500 / alpha_w_70)
    assert part.pi_factors["alpha_B"] == pytest.approx(expected_b)
    assert part.pi_factors["alpha_W"] == pytest.approx(expected_w)
    assert "1000 h at 25°C" in part.pi_factors["thermal_basis"]


def test_section_16_2_worked_example_rounds_to_point_four_fpmh():
    part = SurfaceMountAssembly()
    assert part.failure_rate == pytest.approx(.365223966, rel=1e-6)
    assert round(part.failure_rate, 1) == .4


@pytest.mark.parametrize(
    ("device_type", "technology", "complexity", "expected"),
    [
        ("digital", "bipolar", 100, .0025),
        ("digital", "bipolar", 101, .0050),
        ("digital", "mos", 60000, .29),
        ("linear", "mos", 10000, .060),
        ("pla", "mos", 500, .00085),
        ("pla", "mos", 1000, .0017),
        ("pla", "bipolar", 5000, .042),
        ("microprocessor", "mos", 32, .56),
    ],
)
def test_section_5_1_complexity_table_boundaries(device_type, technology, complexity, expected):
    part = Microcircuit(
        device_type=device_type,
        technology=technology,
        complexity=complexity,
        quality="B",
        years_in_production=2,
    )
    assert part.pi_factors["C1"] == expected


@pytest.mark.parametrize("style", mil._RESISTOR_STYLES)
def test_every_section_9_resistor_style_is_calculable(style):
    part = Resistor(style=style, quality="M")
    assert part.traceability["model"] == f"{style} resistor"
    assert part.failure_rate > 0


@pytest.mark.parametrize("style", mil._CAPACITOR_STYLES)
def test_every_section_10_capacitor_style_is_calculable(style):
    part = Capacitor(style=style, quality="M")
    assert part.traceability["model"] == f"{style} capacitor"
    assert part.failure_rate > 0


@pytest.mark.parametrize("tube_type", mil._TUBE_BASE_RATES)
def test_every_named_section_7_1_tube_rate_is_available(tube_type):
    part = mil.ElectronTube(tube_type=tube_type)
    assert part.pi_factors["lambda_b"] == mil._TUBE_BASE_RATES[tube_type]


def test_temperature_and_screening_auxiliary_equations():
    assert microcircuit_custom_screening_pi_q(80) == pytest.approx(3.0875)
    assert mil.microcircuit_gate_count(400, "cmos") == pytest.approx(100)
    assert mil.microcircuit_gate_count(300, "bipolar") == pytest.approx(100)
    assert mil.microcircuit_gate_count(300, "other_mos") == pytest.approx(100)
    assert junction_temperature(48, 28, .075) == pytest.approx(50.1)
    assert microcircuit_junction_temperature(
        .075, case_temperature=48, package_type="dual_in_line", die_area_mils2=10000,
    ) == pytest.approx(50.1)
    assert semiconductor_junction_temperature(
        .1, case_temperature=55, package_type="TO-5",
    ) == pytest.approx(62)
    assert connector_insert_temperature_rise(2, 32) == pytest.approx(
        3.256 * 2 ** 1.85
    )


def test_hybrid_thermal_equations():
    area = hybrid_die_area(8)
    assert area == pytest.approx((.00278 * 8 + .0417) ** 2)
    theta = hybrid_junction_to_case_thermal_resistance(
        ["silicon", "epoxy_conductive", "alumina", "solder", "kovar"],
        area,
    )
    expected = (.010 / 2.2 + .0035 / .15 + .025 / .64 + .003 / 1.3 + .020 / .42) / area
    assert theta == pytest.approx(expected)
    assert hybrid_junction_temperature(65, .33, theta_jc=theta) == pytest.approx(65 + theta * .33)


def test_section_11_3_hotspot_temperature_methods_use_pounds_and_input_power():
    assert mil.MIL_T27_CASE_RADIATING_AREAS["GA"] == 43
    assert mil.inductive_hotspot_temperature(40, temperature_rise_c=15) == pytest.approx(56.5)
    assert mil.inductive_hotspot_temperature(40, mil_c_39010_slash_sheet="1C") == pytest.approx(56.5)
    assert mil.inductive_hotspot_temperature(
        40, power_loss_watts=1, case_area_sq_inches=25,
    ) == pytest.approx(45.5)
    assert mil.inductive_hotspot_temperature(
        40, power_loss_watts=1, transformer_weight_pounds=1,
    ) == pytest.approx(52.65)
    assert mil.inductive_hotspot_temperature(
        40, input_power_watts=10, transformer_weight_pounds=1,
    ) == pytest.approx(63.1)
    with pytest.raises(ValueError, match="3 to 150"):
        mil.inductive_hotspot_temperature(
            40, power_loss_watts=1, case_area_sq_inches=2.99,
        )
    with pytest.raises(ValueError, match="dedicated thermal analysis"):
        mil.inductive_hotspot_temperature(
            40, environment="SF", power_loss_watts=1, case_area_sq_inches=25,
        )
    assert mil.inductive_hotspot_temperature(
        40, environment="SF", temperature_rise_c=15,
    ) == pytest.approx(56.5)


def test_section_14_1_inductively_rated_switch_uses_resistive_load_factor():
    ordinary = mil.Switch(
        load_type="inductive", load_stress=.4, rated_by_inductive_load=False,
    )
    inductively_rated = mil.Switch(
        load_type="inductive", load_stress=.4, rated_by_inductive_load=True,
    )
    assert ordinary.pi_factors["pi_L"] == pytest.approx(math.exp(1))
    assert inductively_rated.pi_factors["pi_L"] == pytest.approx(math.exp(.25))


def test_arrhenius_reference_temperature_and_overflow_guard():
    assert arrhenius_pi_T(25, .35) == pytest.approx(1.0)
    with pytest.raises(ValueError, match="floating-point range"):
        arrhenius_pi_T(1e9, 1e6)


def test_detailed_cmos_rate_is_sum_of_all_appendix_b_mechanisms():
    part = DetailedCMOSMicrocircuit()
    f = part.pi_factors
    expected = sum(f[key] for key in (
        "lambda_OX", "lambda_MET", "lambda_HC", "lambda_CON",
        "lambda_PAC", "lambda_ESD", "lambda_MIS",
    ))
    assert part.failure_rate == pytest.approx(expected)
    assert all(f[key] >= 0 for key in (
        "lambda_OX", "lambda_MET", "lambda_HC", "lambda_CON",
        "lambda_PAC", "lambda_ESD", "lambda_MIS",
    ))


@pytest.mark.parametrize("qml_enabled", [False, True])
def test_appendix_b_mechanism_oracle_and_disclosed_qml_repair(qml_enabled):
    inputs = dict(
        evaluation_time_hours=20_000,
        device_type="logic_custom",
        chip_area_cm2=.30,
        feature_size_microns=1.2,
        T_junction=60,
        screening_temperature=100,
        screening_time_hours=80,
        qml=qml_enabled,
        oxide_defect_density=.7,
        oxide_field_mv_cm=3,
        sigma_oxide=.9,
        metal_defect_density=.8,
        metal_type="al_cu_al_si_cu",
        metal_current_density_million_a_cm2=.6,
        sigma_metal=1.1,
        drain_current_ma=2,
        substrate_current_ma=.0004,
        sigma_hot_carrier=1.2,
        pins=48,
        package_type="dip",
        package_material="hermetic",
        esd_threshold_volts=800,
        quality="B",
        environment="GF",
    )
    part = DetailedCMOSMicrocircuit(**inputs)
    f = part.pi_factors

    k = 8.617e-5
    t = 20_000 / 1e6
    screen_time = 80 / 1e6
    tj = 60 + 273
    ts = 100 + 273

    def accel(ea, temperature, sign=-1):
        return math.exp(sign * ea / k * (1 / temperature - 1 / 298))

    def printed_lognormal_rate(time, median, sigma):
        return .399 / (time * sigma) * math.exp(
            -.5 / sigma ** 2 * (math.log(time) - math.log(median)) ** 2
        )

    q_ox = q_hc = 2.0 if qml_enabled else .5
    q_met = 2.0 if qml_enabled else .5
    q_met_printed = .2 if qml_enabled else .5

    at_ox = accel(.3, tj)
    t0_ox = screen_time * accel(.3, ts)
    av_ox = math.exp(-.192 * (1 / 3 - 1 / 2.5))
    t50_ox = 1.3e22 * q_ox / (at_ox * av_ox)
    lambda_ox = .30 * .77 / .21 * .7 * (
        .0788 * math.exp(-7.7 * t0_ox) * at_ox * math.exp(-7.7 * at_ox * t)
        + printed_lognormal_rate(t + t0_ox, t50_ox, .9)
    )

    at_met = accel(.55, tj)
    t0_met = screen_time * accel(.55, ts)
    metal_early = (
        .30 * .88 / .21 * .8 * .00102 * math.exp(-1.18 * t0_met)
        * at_met * math.exp(-1.18 * at_met * t)
    )
    t50_met = q_met * .388 * 37.5 / (.6 ** 2 * at_met)
    t50_met_printed = q_met_printed * .388 * 37.5 / (.6 ** 2 * at_met)
    lambda_met = metal_early + printed_lognormal_rate(t + t0_met, t50_met, 1.1)
    lambda_met_printed = metal_early + printed_lognormal_rate(
        t + t0_met, t50_met_printed, 1.1
    )

    at_hc = accel(.039, tj, sign=1)
    t0_hc = screen_time * accel(.039, ts, sign=1)
    t50_hc = q_hc * 3.74e-5 / (at_hc * 2) * (.0004 / 2) ** -2.5
    lambda_hc = printed_lognormal_rate(t + t0_hc, t50_hc, 1.2)

    at_con = accel(1.0, tj)
    t0_con = screen_time * accel(1.0, ts)
    lambda_con = .000022 * math.exp(-.0028 * t0_con) * at_con * math.exp(-.0028 * at_con * t)
    lambda_pac = (.0024 + 1.85e-5 * 48) * 2 * 1 * 1
    lambda_esd = -math.log1p(-.00057 * math.exp(-.0002 * 800)) / .00876
    at_mis = accel(.423, tj)
    t0_mis = screen_time * accel(.423, ts)
    lambda_mis = .01 * math.exp(-2.2 * t0_mis) * at_mis * math.exp(-2.2 * at_mis * t)

    expected = sum((
        lambda_ox, lambda_met, lambda_hc, lambda_con,
        lambda_pac, lambda_esd, lambda_mis,
    ))
    assert f["QML_OX"] == q_ox
    assert f["QML_MET"] == q_met
    assert f["QML_HC"] == q_hc
    assert f["t50_OX"] == pytest.approx(t50_ox)
    assert f["t50_MET"] == pytest.approx(t50_met)
    assert f["t50_HC"] == pytest.approx(t50_hc)
    assert f["lambda_OX"] == pytest.approx(lambda_ox)
    assert f["lambda_MET"] == pytest.approx(lambda_met)
    assert f["lambda_HC"] == pytest.approx(lambda_hc)
    assert f["lambda_CON"] == pytest.approx(lambda_con)
    assert f["lambda_PAC"] == pytest.approx(lambda_pac)
    assert f["lambda_ESD"] == pytest.approx(lambda_esd)
    assert f["lambda_MIS"] == pytest.approx(lambda_mis)
    assert part.failure_rate == pytest.approx(expected)

    adjustment = part.traceability["source_adjustments"][0]
    assert adjustment["printed_value"] == q_met_printed
    assert adjustment["adopted_value"] == q_met
    assert adjustment["printed_literal_metallization_fpmh"] == pytest.approx(
        lambda_met_printed
    )
    assert adjustment["printed_literal_total_fpmh"] == pytest.approx(
        expected - lambda_met + lambda_met_printed
    )
    assert bool(part.warnings) is qml_enabled


def test_appendix_b_plastic_package_uses_percent_relative_humidity():
    part = DetailedCMOSMicrocircuit(
        package_material="plastic",
        evaluation_time_hours=10_000,
        T_junction=75,
        T_ambient=25,
        relative_humidity=50,
        humidity_duty_cycle=.4,
    )
    tj = 75 + 273
    ta = 25 + 273
    t = 10_000 / 1e6
    rh_eff = .4 * 50 * math.exp(5230 * (1 / tj - 1 / ta)) + .6 * 50
    t50 = 86e-6 * math.exp(
        .2 / mil.BOLTZMANN_EV * (1 / ta - 1 / 298)
    ) * math.exp(2.96 / rh_eff)
    expected = .399 / (t * .74) * math.exp(
        -.5 / .74 ** 2 * (math.log(t) - math.log(t50)) ** 2
    )
    assert part.pi_factors["RH_eff"] == pytest.approx(rh_eff)
    assert part.pi_factors["t50_PH"] == pytest.approx(t50)
    assert part.pi_factors["lambda_PH"] == pytest.approx(expected)
    with pytest.raises(ValueError, match="percentage points"):
        DetailedCMOSMicrocircuit(
            package_material="plastic", relative_humidity=100.1,
        )


def test_section_16_2_table_and_custom_sources_are_explicit():
    table = SurfaceMountAssembly(
        environment="GF",
        equipment_type="military_ground",
        cycling_rate_source="table",
        cycling_rate_per_hour=99,
        temperature_difference_source="table",
        temperature_difference=99,
    )
    custom = SurfaceMountAssembly(
        environment="GF",
        equipment_type="military_ground",
        cycling_rate_source="custom",
        cycling_rate_per_hour=.06,
        temperature_difference_source="custom",
        temperature_difference=30,
    )
    assert table.pi_factors["CR"] == pytest.approx(.03)
    assert table.pi_factors["delta_T"] == pytest.approx(21)
    assert custom.pi_factors["CR"] == pytest.approx(.06)
    assert custom.pi_factors["delta_T"] == pytest.approx(30)


def test_sections_21_and_23_preserve_exact_handbook_row_identity():
    mil_f_15733 = mil.ElectronicFilter(
        filter_type="discrete_lc_mil_f_15733", quality="MIL-SPEC",
    )
    composition_1 = mil.ElectronicFilter(
        filter_type="discrete_lc_mil_f_18327_composition_1",
        quality="MIL-SPEC",
    )
    composition_2 = mil.ElectronicFilter(
        filter_type="discrete_lc_crystal_mil_f_18327_composition_2",
        quality="MIL-SPEC",
    )
    assert mil_f_15733.failure_rate == pytest.approx(composition_1.failure_rate)
    assert composition_2.failure_rate > composition_1.failure_rate

    attenuator = mil.MiscellaneousPart(
        part_type="microwave_attenuator",
        attenuator_power_stress=.4,
        attenuator_rated_power_watts=2,
        attenuator_case_temperature_c=55,
        attenuator_quality="M",
        environment="NU",
    )
    resistor = Resistor(
        style="RD",
        power_stress=.4,
        rated_power=2,
        case_temperature_c=55,
        quality="M",
        environment="NU",
    )
    assert attenuator.failure_rate == pytest.approx(resistor.failure_rate)
    assert attenuator.traceability["section"] == "23.1 → 9.1"


def test_section_13_default_rows_and_temperature_scope_are_explicit():
    rates = {
        relay_type: mil.SolidStateRelay(relay_type=relay_type).failure_rate
        for relay_type in ("solid_state", "solid_state_time_delay", "hybrid")
    }
    assert len(set(rates.values())) == 1
    assert all(
        relay_type in mil.SolidStateRelay(relay_type=relay_type).traceability["model"]
        for relay_type in rates
    )
    with pytest.raises(ValueError, match="exceeds"):
        mil.Relay(rated_temperature=85, T_ambient=86)


def test_appendix_a_catalog_is_complete_and_every_row_runs_in_gb():
    catalog = parts_count_catalog()
    assert len(catalog) == len(mil.PARTS_COUNT_RECIPES) == 217
    assert len({row["key"] for row in catalog}) == 217
    assert {row["section"].split(".")[0] for row in catalog} >= {
        "5", "6", "9", "10", "11", "12", "13", "14", "15",
        "16", "17", "18", "19", "20", "21", "22",
    }
    for row in catalog:
        part = PartsCountPart(row["key"], environment="GB", quality=1)
        assert math.isfinite(part.failure_rate), row["key"]
        assert part.failure_rate >= 0, row["key"]


@pytest.mark.parametrize(
    ("part_type", "published_gb_rate", "relative_tolerance"),
    [
        ("diode_general", .0036, .03),
        ("diode_transient_suppressor", .0029, .03),
        ("hf_diode_pin", .028, .03),
        ("bjt_small_signal", .00015, .05),
        ("gaas_fet_power", .42, .03),
        ("opto_display", .0062, .03),
        ("resistor_rcr", .0022, .03),
        ("capacitor_cy", .0010, .04),
        ("capacitor_ck", .0017, .03),
        ("capacitor_cdr", .0035, .03),
        ("transformer_switching", .00061, .001),
        ("transformer_audio", .015, .03),
        ("coil_fixed", .000032, .03),
        ("motor_general", 6.9, .03),
        ("relay_general", .049, .03),
        ("switch_toggle", .10, .03),
        ("connector_circular", .0011, .03),
        ("pth_board", .022, .03),
        ("quartz_crystal", .032, .03),
        ("lamp_ac", 3.9, .03),
        ("filter_ceramic_ferrite", .022, .03),
        ("fuse", .010, .001),
    ],
)
def test_appendix_a_published_generic_rate_samples(part_type, published_gb_rate, relative_tolerance):
    part = PartsCountPart(part_type, environment="GB", quality=1)
    assert part.failure_rate == pytest.approx(published_gb_rate, rel=relative_tolerance)


def test_parts_count_rollup_quality_learning_and_quantity():
    ic_key = next(row["key"] for row in parts_count_catalog() if row["learning_factor"])
    mature = PartsCountPart(ic_key, quality=1, years_in_production=2, quantity=2)
    new = PartsCountPart(ic_key, quality=1, years_in_production=.1)
    assert new.pi_factors["pi_L"] == 2
    assert mature.pi_factors["pi_L"] == 1
    prediction = PartsCountPrediction([mature, PartsCountPart("fuse", quality=1)])
    assert prediction.total_failure_rate == pytest.approx(sum(p.total_failure_rate for p in prediction.parts))


def test_system_rollup_preserves_traceability_and_multiplier():
    parts = [
        Diode(name="D1", quality="JANTX", quantity=2, multiplier=.5),
        Transformer(name="T1", quality="MIL-SPEC"),
    ]
    system = SystemFailureRate(parts)
    assert system.total_failure_rate == pytest.approx(sum(p.total_failure_rate for p in parts))
    assert system.mtbf == pytest.approx(1e6 / system.total_failure_rate)
    assert system.reliability(1000) == pytest.approx(math.exp(-system.total_failure_rate * 1000 / 1e6))
    assert np.asarray(system.reliability([0, 1000])).shape == (2,)
    assert all(row["traceability"]["equation"] for row in system.results)
    assert all(row["calculation_steps"] for row in system.results)


def test_invalid_domains_are_rejected_instead_of_extrapolated():
    with pytest.raises(ValueError):
        Microcircuit(device_type="digital", complexity=60001)
    with pytest.raises(ValueError):
        Capacitor(voltage_stress=1.01)
    with pytest.raises(ValueError):
        mil.GaAsFET(frequency_ghz=2, rated_power_watts=1)
    with pytest.raises(ValueError):
        mil.MagneticBubbleMemory(dissipative_elements=1001)
    with pytest.raises(ValueError):
        mil.MagneticBubbleMemory(memory_bits=9_000_001)
    with pytest.raises(ValueError):
        mil.TravelingWaveTube(frequency_ghz=19)
    with pytest.raises(ValueError):
        mil.Meter(environment="ML")
    with pytest.raises(ValueError):
        mil.PlatedThroughHoleAssembly(technology="discrete_wiring", circuit_planes=3)
    with pytest.raises(ValueError):
        SystemFailureRate([])


def test_environment_vocabulary_has_all_fourteen_handbook_codes():
    assert ENVIRONMENTS == [
        "GB", "GF", "GM", "NS", "NU", "AIC", "AIF",
        "AUC", "AUF", "ARW", "SF", "MF", "ML", "CL",
    ]
