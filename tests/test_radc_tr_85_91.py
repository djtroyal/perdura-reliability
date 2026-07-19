"""Independent report-oracle tests for RADC-TR-85-91 Appendix A."""

from dataclasses import FrozenInstanceError
import math

import pytest

from reliability import RADC_TR_85_91 as radc


def test_environment_catalog_is_the_report_catalog_minus_excluded_space_flight():
    assert radc.NONOPERATING_ENVIRONMENTS == (
        "GB", "GF", "GM", "Mp", "NSB", "NS", "NU", "NH", "NUU", "ARW",
        "AIC", "AIT", "AIB", "AIA", "AIF", "AUC", "AUT", "AUB", "AUA",
        "AUF", "MFF", "MFA", "USL", "ML", "CL",
    )
    assert set(radc.NONOPERATING_ENVIRONMENT_DESCRIPTIONS) == set(
        radc.NONOPERATING_ENVIRONMENTS
    )
    assert radc.NONOPERATING_ENVIRONMENT_DESCRIPTIONS["Mp"] == "Manpack"
    assert "SF" not in radc.NONOPERATING_ENVIRONMENTS
    assert set(radc.NONOPERATING_MODEL_CATALOG) == {
        "microelectronic_device", "hybrid_microcircuit", "magnetic_bubble_memory",
        "discrete_semiconductor", "tube", "laser", "resistor", "capacitor",
        "inductive_device", "rotating_device", "relay", "switch", "connector",
        "pth_assembly", "connections", "miscellaneous_part",
    }


def test_section_5_2_1_reliability_and_service_life_equations():
    # Two nonoperating intervals: exp[-(0.2*1000 + 0.4*500)/1e6].
    assert radc.nonoperating_reliability(((.2, 1000), (.4, 500))) == pytest.approx(
        math.exp(-.0004)
    )
    assert radc.service_life_failure_rate(((.25, 4.0),), ((.75, .2),)) == pytest.approx(1.15)
    assert radc.combined_reliability(((4.0, 250),), ((.2, 750),)) == pytest.approx(
        math.exp(-.00115)
    )


@pytest.mark.parametrize(
    "calculator, expected, absolute_tolerance",
    [
        # Appendix A-15, linear microcircuit worked example.
        (lambda: radc.microelectronic_device(
            "linear", "linear", "hermetic", "S", "GF", 20, 1, 32
        ), .00523, .00003),
        # Appendix A-16, bipolar TTL memory worked example.
        (lambda: radc.microelectronic_device(
            "memory", "ttl", "hermetic", "B", "GM", 40, 3
        ), .0140, .0001),
        # Appendix A-17, 36-gate TTL worked example.
        (lambda: radc.microelectronic_device(
            "digital", "ttl", "hermetic", "B", "GM", 60, 2, 36
        ), .00821, .00005),
        # Appendix A-18–A-19, hybrid worked example.
        (lambda: radc.hybrid_microcircuit(18, 15, 3, "B", "GF"), .110, .001),
        # Appendix A-25–A-26, 92K-bit magnetic-bubble example.
        (lambda: radc.magnetic_bubble_memory(144, 3, 1, 144, 25, "GB"), 1.31, .01),
        # Appendix A-27–A-28, silicon NPN example.
        (lambda: radc.discrete_semiconductor("si_npn", "JAN", "GF", 30, 1), .00722, .00004),
        # Appendix A-28–A-29, commercial single opto-isolator example.
        (lambda: radc.discrete_semiconductor("single_isolator", "Plastic", "GB"), .016, .0002),
        # Appendix A-37, pentode receiver example.
        (lambda: radc.tube("receiver_triode_tetrode_pentode", "GM"), .124, 1e-12),
        # Appendix A-44, seven-surface Nd:YAG example.
        (lambda: radc.laser("solid_state", "AUF", 7), 14.8, .05),
        # Appendix A-45–A-49, RCR resistor example.  The report's .00063 prose
        # conflicts with its .000063 table/substitution; expected follows the
        # latter, as the printed final result does.
        (lambda: radc.resistor("RCR", "M", "AIT", 20), .000498, 1e-6),
        # Appendix A-50–A-54, CSR capacitor example.
        (lambda: radc.capacitor("CSR", "R", "GF", 2), .0001312, 1e-7),
        # Appendix A-55–A-56, power transformer example.  Its prose says 5.1,
        # but Table 5.2.8-3 and the printed product use 5.7.
        (lambda: radc.inductive_device(
            "power_transformer", "MIL-SPEC", "GF", 10
        ), .042, .0001),
        # Appendix A-61–A-62 relay example.
        (lambda: radc.relay("nonhermetic", 500, "MIL-SPEC", "GF"), .0046, 1e-12),
        # Appendix A-63–A-64 switch example.
        (lambda: radc.switch(49, "MIL-SPEC", "AIC"), .216, 1e-12),
        # Appendix A-65–A-66 circular connector example.
        (lambda: radc.connector("circular", "GF"), .00101, .00001),
        # Appendix A-67–A-68, 700-PTH multilayer example.
        (lambda: radc.pth_assembly(
            "multilayer_soldered_printed_wiring", 700, "AUF"
        ), .049, 1e-12),
        # Appendix A-69–A-71, solderless-wrap plus reflow example.
        (lambda: radc.connections(
            {"solderless_wrap": 1560, "reflow_solder": 156}, "AIC"
        ), .00129, .00001),
    ],
    ids=(
        "micro-linear", "micro-memory", "micro-digital", "hybrid", "bubble",
        "transistor", "opto", "tube", "laser", "resistor", "capacitor",
        "inductive", "relay", "switch", "connector", "pth", "connections",
    ),
)
def test_every_printed_appendix_worked_example(calculator, expected, absolute_tolerance):
    assert calculator().failure_rate == pytest.approx(expected, abs=absolute_tolerance)


@pytest.mark.parametrize(
    "prediction, expected",
    [
        (radc.rotating_device("motor"), .045),
        (radc.rotating_device("synchro"), .14),
        (radc.rotating_device("resolver"), .14),
        (radc.rotating_device("elapsed_time_meter"), 1.2),
        (radc.miscellaneous_part("vibrator"), 3.3),
        (radc.miscellaneous_part("quartz_crystal"), .039),
        (radc.miscellaneous_part("fuse"), .0014),
        (radc.miscellaneous_part("neon_lamp"), .029),
        (radc.miscellaneous_part("incandescent_lamp"), .11),
        (radc.miscellaneous_part("single_fiber_optic_connector"), .014),
        (radc.miscellaneous_part("meter"), 1.4),
        (radc.miscellaneous_part("circuit_breaker"), .29),
        (radc.miscellaneous_part("microwave_fixed_element"), 0.0),
        (radc.miscellaneous_part("microwave_variable_element"), .014),
        (radc.miscellaneous_part("microwave_ferrite_device"), .043),
        (radc.miscellaneous_part("dummy_load"), .011),
        (radc.miscellaneous_part("termination"), .010),
        (radc.miscellaneous_part("fiber_optic_cable", fiber_length_km=2.5), .035),
    ],
)
def test_sections_5_2_9_and_5_2_15_tabulated_rates(prediction, expected):
    assert prediction.failure_rate == pytest.approx(expected)


def test_attenuator_follows_style_rd_resistor_footnote():
    direct = radc.resistor("RD", "MIL-SPEC", "GF", 2)
    attenuator = radc.miscellaneous_part(
        "attenuator", environment="GF", quality="MIL-SPEC",
        power_cycles_per_1000h=2,
    )
    assert attenuator.failure_rate == pytest.approx(direct.failure_rate)
    assert attenuator.traceability["report_section"] == "5.2.15"


def test_table_factor_spot_checks_are_independent_of_operating_models():
    # Monolithic, nonhermetic GF is 4.0; B-1 is 1.4; 1 cycle gives 1.02.
    micro = radc.microelectronic_device(
        "digital", "cmos", "nonhermetic", "B-1", "GF", 25, 1, 100
    )
    assert micro.factors["pi_NE"] == 4.0
    assert micro.factors["pi_NQ"] == 1.4
    assert micro.factors["pi_cyc"] == 1.02

    # Group VII cannon-launch environment factor is 2000.
    microwave = radc.discrete_semiconductor(
        "microwave_detector", "JANTX", "CL", 25, 1
    )
    assert microwave.factors["pi_NE"] == 2000

    # Table 5.2.6-2 spans a different family factor for the same environment.
    fixed_film = radc.resistor("RN", "MIL-SPEC", "GF", 1)
    thermistor = radc.resistor("RTH", "MIL-SPEC", "GF", 1)
    assert fixed_film.factors["pi_NE"] == 2.4
    assert thermistor.factors["pi_NE"] == 4.8

    # Tantalum solid and variable capacitor family factors differ at GF.
    tantalum = radc.capacitor("CSR", "M", "GF", 1)
    variable = radc.capacitor("CV", "M", "GF", 1)
    assert tantalum.factors["pi_NE"] == 2.4
    assert variable.factors["pi_NE"] == 3.3

    # Visual source review: tube NS is 29 (the PDF text layer drops this row).
    assert radc.tube("twt", "NS").factors["pi_NE"] == 29
    # The CG prohibition markers stop at ML; CL retains the printed factor 930.
    assert radc.capacitor("CG", "M", "CL", 1).factors["pi_NE"] == 930


def test_punctuation_and_case_normalization_does_not_change_source_choice():
    lower_hermetic = radc.discrete_semiconductor(
        "si_npn", "Lower, Hermetic", "GF", 30, 1
    )
    assert lower_hermetic.factors["pi_NQ"] == 13


def test_result_contract_is_auditable_and_frozen():
    result = radc.tube("twt", "GF")
    assert result.traceability == {
        "source": radc.REPORT_EDITION,
        "document_number": "RADC-TR-85-91",
        "accession": "AD-A158843",
        "report_section": "5.2.4",
        "appendix_pages": "A-37–A-39",
        "tables": ["5.2.4-1", "5.2.4-2"],
        "equation": "lambda_N = lambda_Nb pi_NE",
        "unit": radc.FPMH,
        "authority_role": "related primary nonoperating extension",
        "support_status": "supported",
        "assurance_status": "verified report transcription",
        "conformance_scope": "RADC-TR-85-91 Appendix A; not MIL-HDBK-217F Notice 2",
        "applicability": "nonoperating electronic equipment except satellite applications",
        "source_model_maturity": "mixed empirical, preliminary, theoretical, and extrapolated factors",
    }
    assert result.steps[-1]["value"] == pytest.approx(result.failure_rate)
    assert "report transcription" in " ".join(result.warnings)
    assert result.long_form["failure_rate"] == result.failure_rate
    assert result.nonoperating_failure_rate_fpmh == result.failure_rate
    with pytest.raises(FrozenInstanceError):
        result.failure_rate = 3.0


def test_dispatcher_uses_stable_model_name():
    result = radc.predict_nonoperating(
        "connector", connector_type="coaxial", environment="GF"
    )
    assert result.failure_rate == pytest.approx(.00044 * 2.3)


@pytest.mark.parametrize(
    "call, message",
    [
        (lambda: radc.connector("circular", "SF"), "excludes Space, Flight"),
        (lambda: radc.laser("helium_neon", "CL"), "no factor"),
        (lambda: radc.relay("nonhermetic", 50, "MIL-SPEC", "GF"), "exactly 50"),
        (lambda: radc.switch(50, "MIL-SPEC", "GF"), "exactly 50"),
        (lambda: radc.hybrid_microcircuit(5, 0, 4, "B", "GF"), "exactly 12.2"),
        (lambda: radc.discrete_semiconductor("ge_npn", "JAN", "GF", 91, 1), "0–90"),
        (lambda: radc.resistor("RP", "M", "AUF", 1), "prohibits"),
        (lambda: radc.capacitor("CG", "M", "MFF", 1), "prohibits"),
        (lambda: radc.inductive_device("power_transformer", "M", "GF", 1), "limits S/R/P/M"),
    ],
)
def test_source_boundaries_and_unsupported_regimes_fail_closed(call, message):
    with pytest.raises(radc.UnsupportedRADCModelError, match=message):
        call()


def test_invalid_numerical_inputs_do_not_silently_extrapolate():
    with pytest.raises(radc.UnsupportedRADCModelError, match="0–160"):
        radc.microelectronic_device(
            "digital", "ttl", "hermetic", "B", "GF", 161, 1, 10
        )
    with pytest.raises(radc.UnsupportedRADCModelError, match="0–50"):
        radc.resistor("RN", "M", "GF", 51)
    with pytest.raises(ValueError, match="sum to 1"):
        radc.service_life_failure_rate(((.4, 1.0),), ((.4, .1),))
    with pytest.raises(ValueError, match="at least one connection"):
        radc.connections({"crimp": 0}, "GF")
