"""Tests for the MissionProfile module."""

import math
import pytest

from reliability.MissionProfile import (
    MissionPhase,
    MissionProfile,
    MissionCalculationError,
    compute_mission_failure_rate,
    compute_system_mission_rate,
    STANDARD_PROFILES,
)


# ===================================================================
# MissionPhase
# ===================================================================

class TestMissionPhase:
    def test_defaults(self):
        p = MissionPhase('Test', 100)
        assert p.name == 'Test'
        assert p.duration == 100
        assert p.environment == 'GB'
        assert p.temperature == 40.0
        assert p.operating is True
        assert p.duty_cycle == 1.0
        assert p.description == ''

    def test_custom(self):
        p = MissionPhase('Combat', 2.0, 'AIF', 55.0, True, 1.0,
                         'High-g maneuvers')
        assert p.environment == 'AIF'
        assert p.temperature == 55.0
        assert p.description == 'High-g maneuvers'

    def test_non_operating(self):
        p = MissionPhase('Storage', 1000, operating=False, duty_cycle=0.0)
        assert p.operating is False
        assert p.duty_cycle == 0.0

    def test_repr(self):
        p = MissionPhase('Cruise', 1.5, 'AIF', 35.0)
        text = repr(p)
        assert 'Cruise' in text
        assert 'AIF' in text


# ===================================================================
# MissionProfile
# ===================================================================

class TestMissionProfile:
    def test_empty(self):
        mp = MissionProfile('Empty')
        assert mp.total_duration == 0
        assert mp.operating_duration == 0
        assert mp.phase_fractions() == []

    def test_single_phase(self):
        mp = MissionProfile('Single', [MissionPhase('Op', 100)])
        assert mp.total_duration == 100
        assert mp.operating_duration == 100
        assert mp.phase_fractions() == [1.0]

    def test_add_phase(self):
        mp = MissionProfile('Test')
        mp.add_phase(MissionPhase('A', 30))
        mp.add_phase(MissionPhase('B', 70))
        assert len(mp.phases) == 2
        assert mp.total_duration == 100

    def test_phase_fractions(self):
        mp = MissionProfile('Test', [
            MissionPhase('A', 25),
            MissionPhase('B', 75),
        ])
        fracs = mp.phase_fractions()
        assert fracs[0] == pytest.approx(0.25)
        assert fracs[1] == pytest.approx(0.75)

    def test_operating_duration_excludes_dormant(self):
        mp = MissionProfile('Test', [
            MissionPhase('Op', 60, operating=True),
            MissionPhase('Storage', 40, operating=False),
        ])
        assert mp.total_duration == 100
        assert mp.operating_duration == 60

    def test_zero_duration_fractions(self):
        """All-zero durations should return zeros, not NaN."""
        mp = MissionProfile('Zero', [
            MissionPhase('A', 0),
            MissionPhase('B', 0),
        ])
        fracs = mp.phase_fractions()
        assert fracs == [0.0, 0.0]

    def test_repr(self):
        mp = MissionProfile('Test', [MissionPhase('A', 10)])
        text = repr(mp)
        assert 'Test' in text
        assert '1 phases' in text


# ===================================================================
# Standard profiles
# ===================================================================

class TestStandardProfiles:
    def test_all_profiles_exist(self):
        expected = {
            'ground_fixed', 'ground_mobile', 'airborne_fighter',
            'naval_surface', 'space_leo', 'automotive',
        }
        assert set(STANDARD_PROFILES.keys()) == expected

    def test_all_profiles_have_phases(self):
        for name, profile in STANDARD_PROFILES.items():
            assert len(profile.phases) > 0, f"{name} has no phases"
            assert profile.total_duration > 0, f"{name} has zero duration"

    def test_ground_fixed_duration(self):
        p = STANDARD_PROFILES['ground_fixed']
        assert p.total_duration == 8760  # one year

    def test_airborne_fighter_all_operating(self):
        p = STANDARD_PROFILES['airborne_fighter']
        assert all(phase.operating for phase in p.phases)

    def test_automotive_has_dormant_phase(self):
        p = STANDARD_PROFILES['automotive']
        dormant = [ph for ph in p.phases if not ph.operating]
        assert len(dormant) > 0


# ===================================================================
# compute_mission_failure_rate
# ===================================================================

class TestComputeMissionFailureRate:
    def test_single_phase_resistor(self):
        """Single-phase mission should give the same rate as direct instantiation."""
        from reliability.MIL_HDBK_217F import Resistor

        profile = MissionProfile('Test', [
            MissionPhase('Op', 1000, 'GB', 40.0, True, 1.0),
        ])
        params = {'style': 'RL',
                  'power_stress': 0.3, 'rated_power': 0.25}
        result = compute_mission_failure_rate(profile, Resistor, params)

        # Direct instantiation for comparison
        r = Resistor(style='RL', power_stress=0.3,
                     rated_power=0.25, case_temperature_c=40.0, environment='GB')
        expected_lambda = r.total_failure_rate * 1.0  # duty_cycle=1.0

        assert result['mission_failure_rate'] == pytest.approx(
            expected_lambda, rel=1e-4)
        assert result['total_duration'] == 1000
        assert result['n_phases'] == 1
        assert result['mission_mtbf'] is not None
        assert result['mission_mtbf'] > 0

    def test_empty_profile_raises(self):
        from reliability.MIL_HDBK_217F import Resistor
        profile = MissionProfile('Empty', [])
        with pytest.raises(ValueError, match="no phases"):
            compute_mission_failure_rate(profile, Resistor, {})

    def test_zero_total_duration_raises(self):
        from reliability.MIL_HDBK_217F import Resistor
        profile = MissionProfile('Zero', [MissionPhase('Op', 0)])
        with pytest.raises(ValueError, match="total duration"):
            compute_mission_failure_rate(profile, Resistor, {})

    def test_invalid_part_fails_closed_with_structured_context(self):
        from reliability.MIL_HDBK_217F import Resistor

        profile = MissionProfile('Test', [MissionPhase('Hot', 100, 'GB', 80)])
        with pytest.raises(MissionCalculationError) as caught:
            compute_mission_failure_rate(
                profile, Resistor, {'style': 'not-a-resistor-style'})

        detail = caught.value.to_dict()
        assert detail['code'] == 'MISSION_PART_PHASE_CALCULATION_FAILED'
        assert detail['part_class'] == 'Resistor'
        assert detail['phase_name'] == 'Hot'
        assert detail['error_type'] == 'ValueError'
        assert 'style must be one of' in detail['message']

    def test_hotter_phase_increases_rate(self):
        """A profile with a hotter phase should have a higher failure rate."""
        from reliability.MIL_HDBK_217F import Resistor

        cool_profile = MissionProfile('Cool', [
            MissionPhase('Op', 1000, 'GB', 30.0, True, 1.0),
        ])
        hot_profile = MissionProfile('Hot', [
            MissionPhase('Op', 1000, 'GB', 80.0, True, 1.0),
        ])
        params = {'style': 'RL',
                  'power_stress': 0.3, 'rated_power': 0.25}

        cool_result = compute_mission_failure_rate(cool_profile, Resistor, params)
        hot_result = compute_mission_failure_rate(hot_profile, Resistor, params)

        assert hot_result['mission_failure_rate'] > cool_result['mission_failure_rate']

    def test_harsh_environment_increases_rate(self):
        """Fighter environment should yield higher rate than ground benign."""
        from reliability.MIL_HDBK_217F import Resistor

        benign = MissionProfile('Benign', [
            MissionPhase('Op', 1000, 'GB', 40.0, True, 1.0),
        ])
        harsh = MissionProfile('Harsh', [
            MissionPhase('Op', 1000, 'AIF', 40.0, True, 1.0),
        ])
        params = {'style': 'RL',
                  'power_stress': 0.3, 'rated_power': 0.25}

        benign_result = compute_mission_failure_rate(benign, Resistor, params)
        harsh_result = compute_mission_failure_rate(harsh, Resistor, params)

        assert harsh_result['mission_failure_rate'] > benign_result['mission_failure_rate']

    def test_dormant_phase_reduces_contribution(self):
        """Non-operating phase should contribute ~10% of the operating rate."""
        from reliability.MIL_HDBK_217F import Resistor

        operating = MissionProfile('Op', [
            MissionPhase('Op', 1000, 'GB', 40.0, True, 1.0),
        ])
        dormant = MissionProfile('Dorm', [
            MissionPhase('Dorm', 1000, 'GB', 40.0, False, 0.0),
        ])
        params = {'style': 'RL',
                  'power_stress': 0.3, 'rated_power': 0.25}

        op_result = compute_mission_failure_rate(operating, Resistor, params)
        dorm_result = compute_mission_failure_rate(dormant, Resistor, params)

        # Dormant factor is 0.1
        assert dorm_result['mission_failure_rate'] == pytest.approx(
            op_result['mission_failure_rate'] * 0.1, rel=1e-4)

    def test_multi_phase_weighted_average(self):
        """Two-phase mission: verify weighting is correct."""
        from reliability.MIL_HDBK_217F import Resistor

        profile = MissionProfile('TwoPhase', [
            MissionPhase('Cool', 750, 'GB', 30.0, True, 1.0),
            MissionPhase('Hot', 250, 'GB', 80.0, True, 1.0),
        ])
        params = {'style': 'RL',
                  'power_stress': 0.3, 'rated_power': 0.25}

        result = compute_mission_failure_rate(profile, Resistor, params)

        # Manual calculation
        r_cool = Resistor(style='RL', power_stress=0.3,
                          rated_power=0.25, case_temperature_c=30.0, environment='GB')
        r_hot = Resistor(style='RL', power_stress=0.3,
                         rated_power=0.25, case_temperature_c=80.0, environment='GB')
        expected = (r_cool.total_failure_rate * 0.75
                    + r_hot.total_failure_rate * 0.25)

        assert result['mission_failure_rate'] == pytest.approx(expected, rel=1e-4)
        assert result['total_duration'] == 1000
        assert result['operating_duration'] == 1000

    def test_phase_results_structure(self):
        """Each phase result dict should have the expected keys."""
        from reliability.MIL_HDBK_217F import Resistor

        profile = MissionProfile('Test', [
            MissionPhase('Op', 100, 'GB', 40.0),
        ])
        params = {'style': 'RL',
                  'power_stress': 0.3, 'rated_power': 0.25}
        result = compute_mission_failure_rate(profile, Resistor, params)

        pr = result['phase_results'][0]
        assert pr['phase_name'] == 'Op'
        assert pr['duration'] == 100
        assert pr['environment'] == 'GB'
        assert pr['temperature'] == 40.0
        assert pr['operating'] is True
        assert 'failure_rate' in pr
        assert 'total_failure_rate' in pr
        assert 'pi_factors' in pr
        assert 'fraction' in pr
        assert 'weighted_contribution' in pr

    def test_reliability_is_consistent(self):
        """R = exp(-lambda * T) should hold."""
        from reliability.MIL_HDBK_217F import Resistor

        profile = MissionProfile('Test', [
            MissionPhase('Op', 5000, 'GB', 40.0),
        ])
        params = {'style': 'RL',
                  'power_stress': 0.3, 'rated_power': 0.25}
        result = compute_mission_failure_rate(profile, Resistor, params)

        lam = result['mission_failure_rate']  # FPMH
        t = result['total_duration']
        expected_r = math.exp(-lam * 1e-6 * t)
        assert result['mission_reliability'] == pytest.approx(expected_r, rel=1e-4)
        assert result['mission_unreliability'] == pytest.approx(
            1.0 - expected_r, rel=1e-4)

    def test_works_with_capacitor(self):
        """Verify that temperature mapping works for Capacitor (T_ambient)."""
        from reliability.MIL_HDBK_217F import Capacitor

        profile = MissionProfile('Test', [
            MissionPhase('Op', 1000, 'GB', 45.0),
        ])
        params = {'style': 'CK', 'capacitance_microfarads': 0.1,
                  'voltage_stress': 0.5}
        result = compute_mission_failure_rate(profile, Capacitor, params)
        assert result['mission_failure_rate'] > 0

    def test_works_with_microcircuit(self):
        """Verify that temperature mapping works for Microcircuit (T_junction)."""
        from reliability.MIL_HDBK_217F import Microcircuit

        profile = MissionProfile('Test', [
            MissionPhase('Op', 1000, 'GB', 50.0),
        ])
        params = {'device_type': 'digital', 'technology': 'mos',
                  'complexity': 1000, 'pins': 16}
        result = compute_mission_failure_rate(profile, Microcircuit, params)
        assert result['mission_failure_rate'] > 0

    def test_works_with_diode(self):
        """Verify that temperature mapping works for Diode (T_junction)."""
        from reliability.MIL_HDBK_217F import Diode

        profile = MissionProfile('Test', [
            MissionPhase('Op', 1000, 'GB', 40.0),
        ])
        params = {'diode_type': 'general_purpose_analog', 'voltage_stress': 0.5}
        result = compute_mission_failure_rate(profile, Diode, params)
        assert result['mission_failure_rate'] > 0


# ===================================================================
# compute_system_mission_rate
# ===================================================================

class TestComputeSystemMissionRate:
    def test_single_part_matches_individual(self):
        """System with one part should give the same rate."""
        from reliability.MIL_HDBK_217F import Resistor

        profile = MissionProfile('Test', [
            MissionPhase('Op', 1000, 'GB', 40.0),
        ])
        params = {'style': 'RL',
                  'power_stress': 0.3, 'rated_power': 0.25}
        individual = compute_mission_failure_rate(profile, Resistor, params)
        system = compute_system_mission_rate(profile, [(Resistor, params)])

        assert system['system_failure_rate'] == pytest.approx(
            individual['mission_failure_rate'], rel=1e-4)

    def test_two_parts_sum(self):
        """System failure rate should be the sum of part rates."""
        from reliability.MIL_HDBK_217F import Resistor, Capacitor

        profile = MissionProfile('Test', [
            MissionPhase('Op', 1000, 'GB', 40.0),
        ])
        r_params = {'style': 'RL',
                    'power_stress': 0.3, 'rated_power': 0.25}
        c_params = {'style': 'CK', 'capacitance_microfarads': 0.1,
                    'voltage_stress': 0.5}

        r_result = compute_mission_failure_rate(profile, Resistor, r_params)
        c_result = compute_mission_failure_rate(profile, Capacitor, c_params)

        system = compute_system_mission_rate(
            profile, [(Resistor, r_params), (Capacitor, c_params)])

        expected_lambda = (r_result['mission_failure_rate']
                           + c_result['mission_failure_rate'])
        assert system['system_failure_rate'] == pytest.approx(
            expected_lambda, rel=1e-4)
        assert system['n_parts'] == 2
        assert len(system['part_results']) == 2

    def test_system_reliability_consistent(self):
        """System R = exp(-lambda_sys * T) should hold."""
        from reliability.MIL_HDBK_217F import Resistor

        profile = MissionProfile('Test', [
            MissionPhase('Op', 5000, 'GB', 40.0),
        ])
        params = {'style': 'RL',
                  'power_stress': 0.3, 'rated_power': 0.25}
        system = compute_system_mission_rate(
            profile, [(Resistor, params), (Resistor, params)])

        lam = system['system_failure_rate']
        t = system['total_duration']
        expected_r = math.exp(-lam * 1e-6 * t)
        assert system['system_reliability'] == pytest.approx(expected_r, rel=1e-4)

    def test_system_mtbf_uses_fpmh_units(self):
        from reliability.MIL_HDBK_217F import Resistor

        profile = MissionProfile('Test', [MissionPhase('Op', 1000, 'GB', 40)])
        params = {'style': 'RL',
                  'power_stress': 0.3, 'rated_power': 0.25}
        system = compute_system_mission_rate(profile, [(Resistor, params)])

        rate_fpmh = system['system_failure_rate']
        assert system['system_mtbf'] == pytest.approx(
            1.0 / (rate_fpmh * 1e-6), abs=0.1)
        assert system['system_reliability'] == pytest.approx(
            math.exp(-rate_fpmh * 1e-6 * profile.total_duration), rel=1e-7)

    def test_system_error_includes_part_context(self):
        from reliability.MIL_HDBK_217F import Resistor

        profile = MissionProfile('Test', [MissionPhase('Op', 100)])
        params = {'name': 'R-bad', 'style': 'invalid'}
        with pytest.raises(MissionCalculationError) as caught:
            compute_system_mission_rate(profile, [(Resistor, params)])

        detail = caught.value.to_dict()
        assert detail['part_index'] == 0
        assert detail['part_name'] == 'R-bad'


# ===================================================================
# Integration with standard profiles
# ===================================================================

class TestStandardProfileIntegration:
    def test_ground_fixed_resistor(self):
        """Smoke test: resistor through ground_fixed profile."""
        from reliability.MIL_HDBK_217F import Resistor

        profile = STANDARD_PROFILES['ground_fixed']
        params = {'style': 'RL',
                  'power_stress': 0.3, 'rated_power': 0.25}
        result = compute_mission_failure_rate(profile, Resistor, params)
        assert result['mission_failure_rate'] > 0
        assert result['mission_mtbf'] > 0
        assert 0 < result['mission_reliability'] < 1

    def test_ground_mobile_resistor(self):
        """Multi-phase ground_mobile profile."""
        from reliability.MIL_HDBK_217F import Resistor

        profile = STANDARD_PROFILES['ground_mobile']
        params = {'style': 'RL',
                  'power_stress': 0.3, 'rated_power': 0.25}
        result = compute_mission_failure_rate(profile, Resistor, params)
        assert result['n_phases'] == 4
        assert len(result['phase_results']) == 4
        assert result['mission_failure_rate'] > 0
