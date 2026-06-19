"""Tests for NSWC-98/LE1 mechanical reliability prediction module."""

import pytest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from reliability.NSWC import (
    Spring, Bearing, Gear, Seal, Valve, Actuator, Pump, Filter,
    Coupling, BrakeClutch, ElectricMotor, BeltChain,
    Hydraulic_Pneumatic_Line, SystemFailureRate,
    ENVIRONMENTS, PI_E_MECH,
)


class TestSpring:
    def test_default_positive(self):
        s = Spring(name='S1')
        assert s.failure_rate > 0

    def test_types(self):
        for t in ('compression', 'extension', 'torsion', 'leaf', 'belleville'):
            s = Spring(name='test', spring_type=t)
            assert s.failure_rate > 0

    def test_higher_stress_higher_rate(self):
        s1 = Spring(name='a', operating_deflection=0.3, max_deflection=1.0)
        s2 = Spring(name='b', operating_deflection=0.9, max_deflection=1.0)
        assert s2.failure_rate > s1.failure_rate

    def test_quantity(self):
        s = Spring(name='S1', quantity=5)
        assert s.total_failure_rate == pytest.approx(s.failure_rate * 5)


class TestBearing:
    def test_default_positive(self):
        b = Bearing(name='B1')
        assert b.failure_rate > 0

    def test_types(self):
        for t in ('ball', 'roller_cylindrical', 'roller_spherical',
                   'roller_tapered', 'needle', 'journal', 'sleeve'):
            b = Bearing(name='test', bearing_type=t)
            assert b.failure_rate > 0

    def test_load_effect(self):
        b1 = Bearing(name='a', load_kN=5.0, rated_load_kN=10.0,
                     speed_rpm=4000, rated_speed_rpm=5000)
        b2 = Bearing(name='b', load_kN=15.0, rated_load_kN=10.0,
                     speed_rpm=4000, rated_speed_rpm=5000)
        assert b2.failure_rate > b1.failure_rate


class TestGear:
    def test_default_positive(self):
        g = Gear(name='G1')
        assert g.failure_rate > 0

    def test_types(self):
        for t in ('spur', 'helical', 'bevel', 'worm', 'planetary'):
            g = Gear(name='test', gear_type=t)
            assert g.failure_rate > 0


class TestSeal:
    def test_default_positive(self):
        s = Seal(name='SL1')
        assert s.failure_rate > 0

    def test_types(self):
        for t in ('o_ring', 'lip', 'mechanical', 'gasket', 'labyrinth'):
            s = Seal(name='test', seal_type=t)
            assert s.failure_rate > 0


class TestValve:
    def test_default_positive(self):
        v = Valve(name='V1')
        assert v.failure_rate > 0

    def test_types(self):
        for t in ('ball', 'gate', 'globe', 'butterfly', 'check',
                   'relief', 'solenoid', 'pneumatic'):
            v = Valve(name='test', valve_type=t)
            assert v.failure_rate > 0


class TestActuator:
    def test_default_positive(self):
        a = Actuator(name='A1')
        assert a.failure_rate > 0

    def test_types(self):
        for t in ('hydraulic', 'pneumatic', 'electric_linear', 'electric_rotary'):
            a = Actuator(name='test', actuator_type=t)
            assert a.failure_rate > 0


class TestPump:
    def test_default_positive(self):
        p = Pump(name='P1')
        assert p.failure_rate > 0

    def test_types(self):
        for t in ('centrifugal', 'piston', 'gear', 'vane', 'diaphragm', 'peristaltic'):
            p = Pump(name='test', pump_type=t)
            assert p.failure_rate > 0


class TestFilter:
    def test_default_positive(self):
        f = Filter(name='F1')
        assert f.failure_rate > 0

    def test_types(self):
        for t in ('hydraulic', 'fuel', 'air', 'water'):
            f = Filter(name='test', filter_type=t)
            assert f.failure_rate > 0


class TestCoupling:
    def test_default_positive(self):
        c = Coupling(name='C1')
        assert c.failure_rate > 0

    def test_types(self):
        for t in ('rigid', 'flexible', 'fluid', 'gear', 'universal'):
            c = Coupling(name='test', coupling_type=t)
            assert c.failure_rate > 0


class TestBrakeClutch:
    def test_default_positive(self):
        b = BrakeClutch(name='BC1')
        assert b.failure_rate > 0

    def test_types(self):
        for t in ('drum_brake', 'disc_brake', 'band_brake',
                   'friction_clutch', 'magnetic_clutch'):
            b = BrakeClutch(name='test', device_type=t)
            assert b.failure_rate > 0


class TestElectricMotor:
    def test_default_positive(self):
        m = ElectricMotor(name='M1')
        assert m.failure_rate > 0

    def test_types(self):
        for t in ('ac_induction', 'ac_synchronous', 'dc_brushed',
                   'dc_brushless', 'stepper'):
            m = ElectricMotor(name='test', motor_type=t)
            assert m.failure_rate > 0


class TestBeltChain:
    def test_default_positive(self):
        b = BeltChain(name='BC1')
        assert b.failure_rate > 0

    def test_types(self):
        for t in ('v_belt', 'timing_belt', 'flat_belt',
                   'roller_chain', 'silent_chain'):
            b = BeltChain(name='test', type=t)
            assert b.failure_rate > 0


class TestHydraulicLine:
    def test_default_positive(self):
        h = Hydraulic_Pneumatic_Line(name='H1')
        assert h.failure_rate > 0

    def test_types(self):
        for t in ('rigid_pipe', 'flexible_hose', 'tubing', 'fitting'):
            h = Hydraulic_Pneumatic_Line(name='test', line_type=t)
            assert h.failure_rate > 0


class TestEnvironments:
    def test_all_environments(self):
        for env in ENVIRONMENTS:
            s = Spring(name='test', environment=env)
            assert s.failure_rate > 0

    def test_harsher_env_higher_rate(self):
        s1 = Spring(name='a', environment='indoor')
        s2 = Spring(name='b', environment='airborne')
        assert s2.failure_rate > s1.failure_rate


class TestSystemFailureRate:
    def test_sum(self):
        parts = [Spring(name='S1'), Bearing(name='B1'), Pump(name='P1')]
        s = SystemFailureRate(parts)
        expected = sum(p.total_failure_rate for p in parts)
        assert s.total_failure_rate == pytest.approx(expected)

    def test_mtbf(self):
        parts = [Spring(name='S1')]
        s = SystemFailureRate(parts)
        assert s.mtbf == pytest.approx(1e6 / s.total_failure_rate)

    def test_empty_raises(self):
        with pytest.raises(ValueError):
            SystemFailureRate([])

    def test_results_contributions_sum_to_one(self):
        parts = [Spring(name='S1'), Bearing(name='B1'), Pump(name='P1')]
        s = SystemFailureRate(parts)
        total_contrib = sum(r['contribution'] for r in s.results)
        assert total_contrib == pytest.approx(1.0, abs=0.01)

    def test_pi_factors_in_results(self):
        s = SystemFailureRate([Spring(name='S1')])
        assert 'pi_factors' in s.results[0]
