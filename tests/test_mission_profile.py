"""Tests for explicit operating/RADC mission-profile calculations."""

import math

import pytest

from reliability.MissionProfile import (
    MissionCalculationError,
    MissionPhase,
    MissionProfile,
    STANDARD_PROFILES,
    compute_mission_failure_rate,
    compute_system_mission_rate,
)
from reliability.RADC_TR_85_91 import resistor as radc_resistor


def mixed_phase(
    *,
    name="Mixed",
    duration=1000,
    environment="GF",
    temperature=40.0,
    operating_fraction=0.4,
    nonoperating_environment="GF",
    nonoperating_temperature_c=25.0,
    cycles=0.0,
):
    return MissionPhase(
        name=name,
        duration=duration,
        environment=environment,
        temperature=temperature,
        operating_fraction=operating_fraction,
        nonoperating_environment=nonoperating_environment,
        nonoperating_temperature_c=nonoperating_temperature_c,
        power_cycles_per_1000_nonoperating_hours=cycles,
    )


def resistor_params(**updates):
    params = {
        "style": "RL",
        "power_stress": 0.3,
        "rated_power": 0.25,
        "quality": "commercial",
    }
    params.update(updates)
    return params


class TestMissionPhase:
    def test_defaults_are_fully_operating(self):
        phase = MissionPhase(name="Test", duration=100)
        assert phase.name == "Test"
        assert phase.duration == 100
        assert phase.environment == "GB"
        assert phase.temperature == 40.0
        assert phase.operating_fraction == 1.0
        assert phase.nonoperating_fraction == 0.0
        assert phase.nonoperating_environment is None
        assert phase.nonoperating_temperature_c is None
        assert phase.power_cycles_per_1000_nonoperating_hours is None

    def test_mixed_phase_preserves_explicit_context(self):
        phase = MissionPhase(
            name="Storage",
            duration=1000,
            environment="GB",
            temperature=45,
            operating_fraction=0.2,
            nonoperating_environment="GF",
            nonoperating_temperature_c=20,
            power_cycles_per_1000_nonoperating_hours=1.5,
            description="Controlled storage",
        )
        assert phase.operating_fraction == 0.2
        assert phase.nonoperating_fraction == pytest.approx(0.8)
        assert phase.nonoperating_environment == "GF"
        assert phase.nonoperating_temperature_c == 20
        assert phase.power_cycles_per_1000_nonoperating_hours == 1.5
        assert phase.description == "Controlled storage"

    @pytest.mark.parametrize(
        "omitted,match",
        [
            ("environment", "nonoperating_environment"),
            ("temperature", "nonoperating_temperature_c"),
            ("cycles", "power_cycles_per_1000_nonoperating_hours"),
        ],
    )
    def test_mixed_phase_requires_complete_radc_context(self, omitted, match):
        kwargs = {
            "name": "Dormant",
            "duration": 100,
            "operating_fraction": 0.0,
            "nonoperating_environment": "GB",
            "nonoperating_temperature_c": 25.0,
            "power_cycles_per_1000_nonoperating_hours": 0.0,
        }
        key = {
            "environment": "nonoperating_environment",
            "temperature": "nonoperating_temperature_c",
            "cycles": "power_cycles_per_1000_nonoperating_hours",
        }[omitted]
        kwargs[key] = None
        with pytest.raises(ValueError, match=match):
            MissionPhase(**kwargs)

    def test_space_flight_is_not_a_radc_nonoperating_environment(self):
        with pytest.raises(ValueError, match="supported RADC-TR-85-91"):
            MissionPhase(
                name="Space dormant",
                duration=10,
                environment="SF",
                operating_fraction=0.5,
                nonoperating_environment="SF",
                nonoperating_temperature_c=0,
                power_cycles_per_1000_nonoperating_hours=0,
            )

    @pytest.mark.parametrize("duration", [0, -1, float("nan"), float("inf")])
    def test_duration_must_be_positive_and_finite(self, duration):
        with pytest.raises(ValueError, match="duration"):
            MissionPhase(name="Bad", duration=duration)

    @pytest.mark.parametrize("fraction", [-0.01, 1.01, float("nan")])
    def test_operating_fraction_is_bounded(self, fraction):
        with pytest.raises(ValueError, match="operating_fraction"):
            MissionPhase(name="Bad", duration=1, operating_fraction=fraction)

    def test_negative_cycle_rate_is_rejected(self):
        with pytest.raises(ValueError, match="must be >= 0"):
            mixed_phase(cycles=-0.1)

    def test_repr_uses_operating_fraction_terminology(self):
        text = repr(MissionPhase(name="Cruise", duration=1.5, environment="AIF"))
        assert "Cruise" in text
        assert "AIF" in text
        assert "operating_fraction" in text
        assert "duty_cycle" not in text


class TestMissionProfile:
    def test_empty_profile_durations(self):
        profile = MissionProfile("Empty")
        assert profile.total_duration == 0
        assert profile.operating_duration == 0
        assert profile.nonoperating_duration == 0
        assert profile.phase_fractions() == []

    def test_exposure_durations_are_partitioned(self):
        profile = MissionProfile("Exposure", [
            MissionPhase(name="Operate", duration=40),
            mixed_phase(name="Mixed", duration=60, operating_fraction=0.25),
        ])
        assert profile.total_duration == 100
        assert profile.operating_duration == pytest.approx(55)
        assert profile.nonoperating_duration == pytest.approx(45)

    def test_add_phase_and_calendar_fractions(self):
        profile = MissionProfile("Test")
        profile.add_phase(MissionPhase(name="A", duration=25))
        profile.add_phase(MissionPhase(name="B", duration=75))
        assert profile.phase_fractions() == pytest.approx([0.25, 0.75])

    def test_add_phase_rejects_other_objects(self):
        profile = MissionProfile("Test")
        with pytest.raises(TypeError, match="MissionPhase"):
            profile.add_phase({"name": "not a phase"})

    def test_repr(self):
        profile = MissionProfile("Test", [MissionPhase(name="A", duration=10)])
        assert "Test" in repr(profile)
        assert "1 phases" in repr(profile)


class TestStandardProfiles:
    def test_all_profiles_exist_and_have_positive_duration(self):
        expected = {
            "ground_fixed",
            "ground_mobile",
            "airborne_fighter",
            "naval_surface",
            "space_leo",
            "automotive",
        }
        assert set(STANDARD_PROFILES) == expected
        for name, profile in STANDARD_PROFILES.items():
            assert profile.phases, f"{name} has no phases"
            assert profile.total_duration > 0, f"{name} has zero duration"

    def test_every_mixed_preset_has_complete_radc_context(self):
        for profile in STANDARD_PROFILES.values():
            for phase in profile.phases:
                if phase.operating_fraction < 1:
                    assert phase.nonoperating_environment is not None
                    assert phase.nonoperating_temperature_c is not None
                    assert (
                        phase.power_cycles_per_1000_nonoperating_hours
                        is not None
                    )

    def test_space_profile_is_fully_operating_due_radc_exclusion(self):
        profile = STANDARD_PROFILES["space_leo"]
        assert all(phase.environment == "SF" for phase in profile.phases)
        assert all(phase.operating_fraction == 1 for phase in profile.phases)
        assert "excludes SF" in profile.phases[-1].description

    def test_ground_fixed_duration(self):
        assert STANDARD_PROFILES["ground_fixed"].total_duration == 8760

    def test_automotive_contains_explicit_nonoperating_exposure(self):
        profile = STANDARD_PROFILES["automotive"]
        assert any(phase.operating_fraction == 0 for phase in profile.phases)
        assert profile.nonoperating_duration > 0


class TestComputeMissionFailureRate:
    def test_single_operating_phase_matches_handbook_part(self):
        from reliability.MIL_HDBK_217F import Resistor

        profile = MissionProfile("Test", [
            MissionPhase(
                name="Operate",
                duration=1000,
                environment="GB",
                temperature=40,
            )
        ])
        params = resistor_params()
        result = compute_mission_failure_rate(profile, Resistor, params)
        direct = Resistor(
            **params, case_temperature_c=40, environment="GB"
        )

        assert result["mission_service_failure_rate_fpmh"] == pytest.approx(
            direct.total_failure_rate
        )
        assert result["mission_operating_rate_contribution_fpmh"] == pytest.approx(
            direct.total_failure_rate
        )
        assert result["mission_nonoperating_rate_contribution_fpmh"] == 0
        assert result["operating_duration_hours"] == 1000
        assert result["nonoperating_duration_hours"] == 0
        assert result["mission_service_mtbf_hours"] > 0

    def test_mixed_phase_uses_radc_rate_not_blanket_operating_scalar(self):
        from reliability.MIL_HDBK_217F import Resistor

        phase = mixed_phase(
            operating_fraction=0.25,
            nonoperating_environment="GF",
            nonoperating_temperature_c=20,
            cycles=2.0,
        )
        profile = MissionProfile("Mixed", [phase])
        params = resistor_params()
        result = compute_mission_failure_rate(profile, Resistor, params)

        operating = Resistor(
            **params,
            environment="GF",
            case_temperature_c=40,
        ).total_failure_rate
        nonoperating = radc_resistor(
            style="RL",
            quality="Lower",
            environment="GF",
            power_cycles_per_1000h=2.0,
        ).failure_rate
        expected = 0.25 * operating + 0.75 * nonoperating

        phase_result = result["phase_results"][0]
        assert phase_result["operating_total_failure_rate_fpmh"] == pytest.approx(
            operating
        )
        assert phase_result[
            "nonoperating_total_failure_rate_fpmh"
        ] == pytest.approx(nonoperating)
        assert phase_result["service_failure_rate_fpmh"] == pytest.approx(expected)
        assert result["mission_service_failure_rate_fpmh"] == pytest.approx(expected)
        assert nonoperating != pytest.approx(operating * 0.1)

    def test_operating_and_nonoperating_contributions_sum_to_service_rate(self):
        from reliability.MIL_HDBK_217F import Resistor

        profile = MissionProfile("Two phase", [
            MissionPhase(
                name="Hot operation",
                duration=250,
                environment="AIF",
                temperature=80,
            ),
            mixed_phase(
                name="Storage",
                duration=750,
                environment="GB",
                temperature=30,
                operating_fraction=0.2,
                nonoperating_environment="GF",
                nonoperating_temperature_c=15,
                cycles=0,
            ),
        ])
        result = compute_mission_failure_rate(
            profile, Resistor, resistor_params()
        )
        assert result["mission_service_failure_rate_fpmh"] == pytest.approx(
            result["mission_operating_rate_contribution_fpmh"]
            + result["mission_nonoperating_rate_contribution_fpmh"]
        )
        assert sum(
            phase["mission_weighted_service_contribution_fpmh"]
            for phase in result["phase_results"]
        ) == pytest.approx(result["mission_service_failure_rate_fpmh"])

    def test_pure_nonoperating_phase_service_rate_is_radc_rate(self):
        from reliability.MIL_HDBK_217F import Resistor

        profile = MissionProfile("Stored", [mixed_phase(operating_fraction=0)])
        result = compute_mission_failure_rate(
            profile, Resistor, resistor_params()
        )
        phase = result["phase_results"][0]
        assert phase["service_failure_rate_fpmh"] == pytest.approx(
            phase["nonoperating_total_failure_rate_fpmh"]
        )
        assert result["mission_operating_rate_contribution_fpmh"] == 0

    def test_quantity_applies_to_both_source_rates(self):
        from reliability.MIL_HDBK_217F import Resistor

        profile = MissionProfile("Mixed", [mixed_phase()])
        single = compute_mission_failure_rate(
            profile, Resistor, resistor_params(quantity=1)
        )
        triple = compute_mission_failure_rate(
            profile, Resistor, resistor_params(quantity=3)
        )
        assert triple["mission_service_failure_rate_fpmh"] == pytest.approx(
            3 * single["mission_service_failure_rate_fpmh"]
        )

    def test_operating_multiplier_is_not_silently_applied_to_radc_rate(self):
        from reliability.MIL_HDBK_217F import Resistor

        profile = MissionProfile("Mixed", [mixed_phase()])
        base = compute_mission_failure_rate(
            profile, Resistor, resistor_params(multiplier=1)
        )["phase_results"][0]
        scaled = compute_mission_failure_rate(
            profile, Resistor, resistor_params(multiplier=2)
        )["phase_results"][0]
        assert scaled["operating_total_failure_rate_fpmh"] == pytest.approx(
            2 * base["operating_total_failure_rate_fpmh"]
        )
        assert scaled[
            "nonoperating_total_failure_rate_fpmh"
        ] == pytest.approx(base["nonoperating_total_failure_rate_fpmh"])

    def test_generic_microcircuit_mapping_fails_closed(self):
        from reliability.MIL_HDBK_217F import Microcircuit

        profile = MissionProfile("Mixed", [mixed_phase()])
        with pytest.raises(MissionCalculationError) as caught:
            compute_mission_failure_rate(
                profile,
                Microcircuit,
                {
                    "device_type": "digital",
                    "technology": "mos",
                    "complexity": 1000,
                    "pins": 16,
                },
            )
        detail = caught.value.to_dict()
        assert detail["stage"] == "nonoperating"
        assert "generic MOS/bipolar" in detail["message"]

    def test_explicit_radc_model_resolves_ambiguous_microcircuit(self):
        from reliability.MIL_HDBK_217F import Microcircuit

        profile = MissionProfile("Mixed", [mixed_phase(cycles=1.0)])
        result = compute_mission_failure_rate(
            profile,
            Microcircuit,
            {
                "device_type": "digital",
                "technology": "mos",
                "complexity": 1000,
                "pins": 16,
            },
            nonoperating_params={
                "model": "microelectronic_device",
                "device_type": "digital",
                "technology": "cmos",
                "package": "nonhermetic",
                "quality": "B",
                "complexity": 1000,
            },
        )
        calculation = result["phase_results"][0]["nonoperating_calculation"]
        assert calculation["status"] == "supported"
        assert calculation["model_mapping"] == (
            "explicit RADC model microelectronic_device"
        )
        assert calculation["traceability"]["report_section"] == "5.2.2.1"

    def test_ambiguous_discrete_requires_exact_part_type(self):
        from reliability.MIL_HDBK_217F import BipolarTransistor

        profile = MissionProfile("Mixed", [mixed_phase()])
        params = {"quality": "plastic"}
        with pytest.raises(MissionCalculationError, match="material/polarity/subtype"):
            compute_mission_failure_rate(profile, BipolarTransistor, params)

        resolved = compute_mission_failure_rate(
            profile,
            BipolarTransistor,
            params,
            nonoperating_params={"part_type": "si_npn"},
        )
        assert resolved["phase_results"][0][
            "nonoperating_calculation"
        ]["inputs"]["part_type"] == "si_npn"

    def test_radc_domain_error_is_structured_and_not_zeroed(self):
        from reliability.MIL_HDBK_217F import Resistor

        profile = MissionProfile("Too many cycles", [mixed_phase(cycles=51)])
        with pytest.raises(MissionCalculationError) as caught:
            compute_mission_failure_rate(profile, Resistor, resistor_params())
        detail = caught.value.to_dict()
        assert detail["stage"] == "nonoperating"
        assert detail["error_type"] == "UnsupportedRADCModelError"
        assert "outside the report domain" in detail["message"]

    def test_invalid_operating_part_has_structured_stage_context(self):
        from reliability.MIL_HDBK_217F import Resistor

        profile = MissionProfile("Test", [
            MissionPhase(name="Hot", duration=100, temperature=80)
        ])
        with pytest.raises(MissionCalculationError) as caught:
            compute_mission_failure_rate(
                profile, Resistor, {"style": "not-a-style"}
            )
        detail = caught.value.to_dict()
        assert detail["part_class"] == "Resistor"
        assert detail["phase_name"] == "Hot"
        assert detail["stage"] == "operating"
        assert detail["error_type"] == "ValueError"

    def test_phase_result_contains_both_source_traces_and_service_equation(self):
        from reliability.MIL_HDBK_217F import Resistor

        result = compute_mission_failure_rate(
            MissionProfile("Mixed", [mixed_phase()]),
            Resistor,
            resistor_params(),
        )
        phase = result["phase_results"][0]
        assert phase["operating_calculation"]["traceability"]["standard"].startswith(
            "MIL-HDBK-217F"
        )
        assert phase["nonoperating_calculation"]["traceability"][
            "document_number"
        ] == "RADC-TR-85-91"
        assert "f_operating" in phase["service_calculation"]["equation"]
        assert result["traceability"]["time_basis"] == "calendar time"

    def test_fully_operating_phase_marks_nonoperating_as_not_applicable(self):
        from reliability.MIL_HDBK_217F import Resistor

        profile = MissionProfile("Operating", [
            MissionPhase(name="Operate", duration=100)
        ])
        result = compute_mission_failure_rate(
            profile, Resistor, resistor_params()
        )
        phase = result["phase_results"][0]
        assert phase["nonoperating_calculation"]["status"] == "not_applicable"
        assert phase["nonoperating_total_failure_rate_fpmh"] is None

    def test_reliability_uses_calendar_service_exposure(self):
        from reliability.MIL_HDBK_217F import Resistor

        profile = MissionProfile("Mixed", [mixed_phase(duration=5000)])
        result = compute_mission_failure_rate(
            profile, Resistor, resistor_params()
        )
        expected = math.exp(
            -result["mission_service_failure_rate_fpmh"] * 1e-6 * 5000
        )
        assert result["mission_reliability"] == pytest.approx(expected)
        assert result["mission_unreliability"] == pytest.approx(1 - expected)

    def test_temperature_mapping_for_capacitor_operating_model(self):
        from reliability.MIL_HDBK_217F import Capacitor

        profile = MissionProfile("Test", [
            MissionPhase(name="Operate", duration=1000, temperature=45)
        ])
        result = compute_mission_failure_rate(
            profile,
            Capacitor,
            {
                "style": "CK",
                "capacitance_microfarads": 0.1,
                "voltage_stress": 0.5,
            },
        )
        assert result["mission_service_failure_rate_fpmh"] > 0

    def test_empty_profile_raises(self):
        from reliability.MIL_HDBK_217F import Resistor

        with pytest.raises(ValueError, match="no phases"):
            compute_mission_failure_rate(
                MissionProfile("Empty"), Resistor, resistor_params()
            )

    def test_legacy_ambiguous_rate_keys_are_not_returned(self):
        from reliability.MIL_HDBK_217F import Resistor

        result = compute_mission_failure_rate(
            MissionProfile("Operating", [MissionPhase("Op", 100)]),
            Resistor,
            resistor_params(),
        )
        assert "mission_failure_rate" not in result
        assert "mission_mtbf" not in result
        phase = result["phase_results"][0]
        assert "failure_rate" not in phase
        assert "duty_cycle" not in phase
        assert "operating" not in phase


class TestComputeSystemMissionRate:
    def test_single_part_matches_individual_service_rate(self):
        from reliability.MIL_HDBK_217F import Resistor

        profile = MissionProfile("Mixed", [mixed_phase()])
        params = resistor_params()
        individual = compute_mission_failure_rate(profile, Resistor, params)
        system = compute_system_mission_rate(profile, [(Resistor, params)])
        assert system["system_service_failure_rate_fpmh"] == pytest.approx(
            individual["mission_service_failure_rate_fpmh"]
        )

    def test_two_parts_sum_all_explicit_contributions(self):
        from reliability.MIL_HDBK_217F import Capacitor, Resistor

        profile = MissionProfile("Mixed", [mixed_phase()])
        resistor = resistor_params()
        capacitor = {
            "style": "CK",
            "capacitance_microfarads": 0.1,
            "voltage_stress": 0.5,
            "quality": "commercial",
        }
        r_result = compute_mission_failure_rate(profile, Resistor, resistor)
        c_result = compute_mission_failure_rate(profile, Capacitor, capacitor)
        system = compute_system_mission_rate(
            profile, [(Resistor, resistor), (Capacitor, capacitor)]
        )

        assert system["system_service_failure_rate_fpmh"] == pytest.approx(
            r_result["mission_service_failure_rate_fpmh"]
            + c_result["mission_service_failure_rate_fpmh"]
        )
        assert system[
            "system_operating_rate_contribution_fpmh"
        ] == pytest.approx(
            r_result["mission_operating_rate_contribution_fpmh"]
            + c_result["mission_operating_rate_contribution_fpmh"]
        )
        assert system[
            "system_nonoperating_rate_contribution_fpmh"
        ] == pytest.approx(
            r_result["mission_nonoperating_rate_contribution_fpmh"]
            + c_result["mission_nonoperating_rate_contribution_fpmh"]
        )
        assert system["n_parts"] == 2

    def test_system_entry_accepts_explicit_nonoperating_mapping(self):
        from reliability.MIL_HDBK_217F import BipolarTransistor

        profile = MissionProfile("Mixed", [mixed_phase()])
        system = compute_system_mission_rate(profile, [
            (
                BipolarTransistor,
                {"quality": "plastic"},
                {"part_type": "si_pnp"},
            )
        ])
        calculation = system["part_results"][0]["phase_results"][0][
            "nonoperating_calculation"
        ]
        assert calculation["inputs"]["part_type"] == "si_pnp"

    def test_system_reliability_and_mtbf_use_fpmh_once(self):
        from reliability.MIL_HDBK_217F import Resistor

        profile = MissionProfile("Test", [
            MissionPhase(name="Operate", duration=5000)
        ])
        params = resistor_params()
        system = compute_system_mission_rate(
            profile, [(Resistor, params), (Resistor, params)]
        )
        rate = system["system_service_failure_rate_fpmh"]
        assert system["system_service_mtbf_hours"] == pytest.approx(
            1 / (rate * 1e-6), abs=0.1
        )
        assert system["system_reliability"] == pytest.approx(
            math.exp(-rate * 1e-6 * profile.total_duration)
        )

    def test_system_error_includes_part_and_stage_context(self):
        from reliability.MIL_HDBK_217F import BipolarTransistor, Resistor

        profile = MissionProfile("Mixed", [mixed_phase()])
        with pytest.raises(MissionCalculationError) as caught:
            compute_system_mission_rate(profile, [
                (Resistor, resistor_params(name="R-good")),
                (BipolarTransistor, {"name": "Q-ambiguous", "quality": "plastic"}),
            ])
        detail = caught.value.to_dict()
        assert detail["part_index"] == 1
        assert detail["part_name"] == "Q-ambiguous"
        assert detail["stage"] == "nonoperating"

    def test_invalid_system_part_tuple_fails(self):
        profile = MissionProfile("Test", [MissionPhase("Op", 100)])
        with pytest.raises(ValueError, match="each parts entry"):
            compute_system_mission_rate(profile, [(object,)])

    def test_empty_series_system_has_zero_rate_and_unit_reliability(self):
        profile = MissionProfile("Test", [MissionPhase("Op", 100)])
        system = compute_system_mission_rate(profile, [])
        assert system["system_service_failure_rate_fpmh"] == 0
        assert system["system_service_mtbf_hours"] is None
        assert system["system_reliability"] == 1


class TestStandardProfileIntegration:
    @pytest.mark.parametrize("profile_name", sorted(STANDARD_PROFILES))
    def test_resistor_calculates_for_every_standard_profile(self, profile_name):
        from reliability.MIL_HDBK_217F import Resistor

        result = compute_mission_failure_rate(
            STANDARD_PROFILES[profile_name],
            Resistor,
            resistor_params(),
        )
        assert result["mission_service_failure_rate_fpmh"] > 0
        assert result["mission_service_mtbf_hours"] > 0
        assert 0 < result["mission_reliability"] <= 1

    def test_ground_mobile_has_four_distinct_phase_results(self):
        from reliability.MIL_HDBK_217F import Resistor

        result = compute_mission_failure_rate(
            STANDARD_PROFILES["ground_mobile"], Resistor, resistor_params()
        )
        assert result["n_phases"] == 4
        assert len(result["phase_results"]) == 4
        assert any(
            phase["nonoperating_calculation"]["status"] == "supported"
            for phase in result["phase_results"]
        )

    def test_space_profile_never_calls_unsupported_radc_sf_model(self):
        from reliability.MIL_HDBK_217F import Resistor

        result = compute_mission_failure_rate(
            STANDARD_PROFILES["space_leo"], Resistor, resistor_params()
        )
        assert all(
            phase["nonoperating_calculation"]["status"] == "not_applicable"
            for phase in result["phase_results"]
        )
