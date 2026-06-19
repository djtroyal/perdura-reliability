"""Tests for 217Plus (RIAC) reliability prediction module."""

import pytest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from reliability.MIL_HDBK_217Plus import (
    Microcircuit, Discrete_Semiconductor, Resistor, Capacitor,
    Inductor, Relay, Switch, Connector, PCB, Crystal, Fuse, Rotating,
    SystemFailureRate, ENVIRONMENTS, PROCESS_GRADES,
    pi_temperature, pi_process_grade, pi_duty_cycle,
)


class TestHelperFunctions:
    def test_pi_temperature_higher_temp_higher_factor(self):
        assert pi_temperature(0.4, 80.0) > pi_temperature(0.4, 40.0)

    def test_pi_temperature_ref_equals_one(self):
        assert pi_temperature(0.4, 40.0, 40.0) == pytest.approx(1.0)

    def test_pi_process_grade_ordering(self):
        assert pi_process_grade(1) < pi_process_grade(2)
        assert pi_process_grade(2) < pi_process_grade(3)
        assert pi_process_grade(3) < pi_process_grade(4)

    def test_pi_duty_cycle_floor(self):
        assert pi_duty_cycle(0.0) == 0.1
        assert pi_duty_cycle(0.5) == 0.5
        assert pi_duty_cycle(1.0) == 1.0


class TestMicrocircuit:
    def test_default_positive(self):
        m = Microcircuit(name='IC1')
        assert m.failure_rate > 0
        assert m.total_failure_rate == m.failure_rate

    def test_quantity_multiplier(self):
        m = Microcircuit(name='IC1', quantity=5)
        assert m.total_failure_rate == pytest.approx(m.failure_rate * 5)

    def test_device_types(self):
        for dt in ('digital', 'linear', 'memory', 'microprocessor', 'fpga'):
            m = Microcircuit(name='test', device_type=dt)
            assert m.failure_rate > 0

    def test_higher_temp_higher_rate(self):
        m1 = Microcircuit(name='a', temperature=40.0)
        m2 = Microcircuit(name='b', temperature=85.0)
        assert m2.failure_rate > m1.failure_rate

    def test_better_process_lower_rate(self):
        m1 = Microcircuit(name='a', process_grade=1)
        m2 = Microcircuit(name='b', process_grade=4)
        assert m1.failure_rate < m2.failure_rate

    def test_environment_effect(self):
        m1 = Microcircuit(name='a', environment='GB')
        m2 = Microcircuit(name='b', environment='AIF')
        assert m2.failure_rate > m1.failure_rate


class TestDiscreteSemiconductor:
    def test_all_sub_types(self):
        for st in ('diode', 'bjt', 'mosfet', 'jfet', 'thyristor', 'optoelectronic'):
            d = Discrete_Semiconductor(name='test', sub_type=st)
            assert d.failure_rate > 0

    def test_pi_factors_present(self):
        d = Discrete_Semiconductor(name='D1')
        pf = d.pi_factors
        assert 'pi_T' in pf
        assert 'pi_E' in pf


class TestPassiveComponents:
    def test_resistor_types(self):
        for rt in ('film', 'composition', 'wirewound', 'network'):
            r = Resistor(name='test', resistor_type=rt)
            assert r.failure_rate > 0

    def test_capacitor_types(self):
        for ct in ('ceramic', 'tantalum', 'aluminum_electrolytic', 'film', 'mica'):
            c = Capacitor(name='test', cap_type=ct)
            assert c.failure_rate > 0

    def test_inductor(self):
        i = Inductor(name='L1')
        assert i.failure_rate > 0

    def test_power_stress_effect(self):
        r1 = Resistor(name='a', power_stress=0.3)
        r2 = Resistor(name='b', power_stress=0.9)
        assert r2.failure_rate > r1.failure_rate


class TestElectromechanical:
    def test_relay(self):
        r = Relay(name='K1')
        assert r.failure_rate > 0

    def test_switch(self):
        s = Switch(name='SW1')
        assert s.failure_rate > 0

    def test_connector_scales_with_pins(self):
        c1 = Connector(name='J1', pins=10)
        c2 = Connector(name='J2', pins=100)
        assert c2.failure_rate > c1.failure_rate

    def test_fuse(self):
        f = Fuse(name='F1')
        assert f.failure_rate > 0

    def test_crystal(self):
        c = Crystal(name='Y1')
        assert c.failure_rate > 0


class TestPCBAndRotating:
    def test_pcb(self):
        p = PCB(name='PCB1')
        assert p.failure_rate > 0

    def test_rotating(self):
        r = Rotating(name='M1')
        assert r.failure_rate > 0

    def test_rotating_types(self):
        for rt in ('motor', 'fan_blower'):
            r = Rotating(name='test', device_type=rt)
            assert r.failure_rate > 0


class TestSystemFailureRate:
    def test_sum(self):
        parts = [Microcircuit(name='IC1'), Resistor(name='R1')]
        s = SystemFailureRate(parts)
        expected = parts[0].total_failure_rate + parts[1].total_failure_rate
        assert s.total_failure_rate == pytest.approx(expected)

    def test_mtbf(self):
        parts = [Microcircuit(name='IC1')]
        s = SystemFailureRate(parts)
        expected_mtbf = 1e6 / s.total_failure_rate
        assert s.mtbf == pytest.approx(expected_mtbf)

    def test_results_structure(self):
        parts = [Microcircuit(name='IC1')]
        s = SystemFailureRate(parts)
        r = s.results
        assert len(r) == 1
        assert 'name' in r[0]
        assert 'failure_rate' in r[0]
        assert 'pi_factors' in r[0]
        assert 'contribution' in r[0]

    def test_empty_raises(self):
        with pytest.raises(ValueError):
            SystemFailureRate([])


class TestEnvironments:
    def test_all_environments_valid(self):
        for env in ENVIRONMENTS:
            m = Microcircuit(name='test', environment=env)
            assert m.failure_rate > 0
