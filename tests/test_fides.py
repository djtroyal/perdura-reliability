"""Tests for FIDES Guide 2022 reliability prediction module."""

import pytest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from reliability.FIDES import (
    IC, Discrete, Passive_Resistor, Passive_Capacitor, Passive_Inductor,
    Connector, PCB, Relay, Switch, Crystal,
    SystemFailureRate,
    FIDESMissionPhase, FIDESMissionProfile, compute_fides_prediction,
    pi_process, pi_pm, pi_placement, pi_induced,
)


class TestHelperFunctions:
    def test_pi_process_best_score(self):
        assert pi_process(100.0) == pytest.approx(1.0, rel=1e-3)

    def test_pi_process_worst_score(self):
        assert pi_process(0.0) > 5.0

    def test_pi_process_ordering(self):
        assert pi_process(80.0) < pi_process(50.0) < pi_process(20.0)

    def test_pi_pm_ordering(self):
        assert pi_pm('high') < pi_pm('standard') < pi_pm('low')

    def test_pi_placement_rework(self):
        assert pi_placement('standard', rework=True) > pi_placement('standard', rework=False)

    def test_pi_induced_ordering(self):
        assert pi_induced('fixed') < pi_induced('airborne')


class TestIC:
    def test_default_positive(self):
        ic = IC(name='IC1')
        assert ic.failure_rate > 0

    def test_ic_types(self):
        for t in ('digital', 'analog', 'memory', 'microprocessor', 'fpga', 'asic'):
            ic = IC(name='test', ic_type=t)
            assert ic.failure_rate > 0

    def test_higher_temp_higher_rate(self):
        ic1 = IC(name='a', temperature=40.0)
        ic2 = IC(name='b', temperature=85.0)
        assert ic2.failure_rate > ic1.failure_rate

    def test_better_process_lower_rate(self):
        ic1 = IC(name='a', process_score=90.0)
        ic2 = IC(name='b', process_score=30.0)
        assert ic1.failure_rate < ic2.failure_rate

    def test_higher_complexity_higher_rate(self):
        ic1 = IC(name='a', complexity=1000)
        ic2 = IC(name='b', complexity=200000)
        assert ic2.failure_rate > ic1.failure_rate

    def test_pi_factors_present(self):
        ic = IC(name='IC1')
        pf = ic.pi_factors
        assert 'pi_T' in pf
        assert 'pi_Process' in pf
        assert 'pi_PM' in pf


class TestDiscrete:
    def test_sub_types(self):
        for st in ('diode', 'transistor_npn', 'mosfet', 'thyristor', 'optoelectronic'):
            d = Discrete(name='test', sub_type=st)
            assert d.failure_rate > 0

    def test_voltage_stress_effect(self):
        d1 = Discrete(name='a', voltage_stress=0.3)
        d2 = Discrete(name='b', voltage_stress=0.9)
        assert d2.failure_rate > d1.failure_rate


class TestPassiveComponents:
    def test_resistor_types(self):
        for t in ('film', 'wirewound', 'composition', 'network'):
            r = Passive_Resistor(name='test', resistor_type=t)
            assert r.failure_rate > 0

    def test_capacitor_types(self):
        for t in ('ceramic_mlcc', 'tantalum', 'aluminum', 'film', 'mica'):
            c = Passive_Capacitor(name='test', cap_type=t)
            assert c.failure_rate > 0

    def test_inductor_types(self):
        for t in ('inductor', 'transformer'):
            i = Passive_Inductor(name='test', inductor_type=t)
            assert i.failure_rate > 0


class TestConnectorAndPCB:
    def test_connector_pin_scaling(self):
        c1 = Connector(name='J1', pins=10)
        c2 = Connector(name='J2', pins=100)
        assert c2.failure_rate > c1.failure_rate

    def test_pcb_layer_effect(self):
        p1 = PCB(name='P1', layers=2)
        p2 = PCB(name='P2', layers=8)
        assert p2.failure_rate > p1.failure_rate


class TestElectromechanical:
    def test_relay_types(self):
        for t in ('electromagnetic', 'solid_state', 'reed'):
            r = Relay(name='test', relay_type=t)
            assert r.failure_rate > 0

    def test_switch(self):
        s = Switch(name='SW1')
        assert s.failure_rate > 0

    def test_crystal(self):
        c = Crystal(name='Y1')
        assert c.failure_rate > 0


class TestSystemFailureRate:
    def test_sum(self):
        parts = [IC(name='IC1'), Passive_Resistor(name='R1')]
        s = SystemFailureRate(parts)
        expected = parts[0].total_failure_rate + parts[1].total_failure_rate
        assert s.total_failure_rate == pytest.approx(expected)

    def test_mtbf(self):
        parts = [IC(name='IC1')]
        s = SystemFailureRate(parts)
        assert s.mtbf == pytest.approx(1e6 / s.total_failure_rate)

    def test_empty_raises(self):
        with pytest.raises(ValueError):
            SystemFailureRate([])

    def test_results_structure(self):
        s = SystemFailureRate([IC(name='IC1')])
        r = s.results
        assert len(r) == 1
        assert 'contribution' in r[0]
        assert r[0]['contribution'] == pytest.approx(1.0)


class TestQuantity:
    def test_quantity_multiplier(self):
        ic = IC(name='IC1', quantity=10)
        assert ic.total_failure_rate == pytest.approx(ic.failure_rate * 10)


class TestMissionProfile:
    def test_basic_mission(self):
        profile = FIDESMissionProfile('Test', [
            FIDESMissionPhase('Op', 6000, temperature=50.0),
            FIDESMissionPhase('Standby', 2760, temperature=25.0, operating=False),
        ])
        parts = [IC(name='IC1'), Passive_Resistor(name='R1')]
        result = compute_fides_prediction(parts, profile)
        assert result['system_failure_rate'] > 0
        assert result['system_mtbf'] > 0
        assert 'part_results' in result
        assert len(result['part_results']) == 2

    def test_no_profile_uses_default(self):
        parts = [IC(name='IC1')]
        result = compute_fides_prediction(parts)
        assert 'results' in result
        assert result['system_failure_rate'] > 0

    def test_phase_temperature_effect(self):
        profile_hot = FIDESMissionProfile('Hot', [
            FIDESMissionPhase('Op', 8760, temperature=80.0),
        ])
        profile_cool = FIDESMissionProfile('Cool', [
            FIDESMissionPhase('Op', 8760, temperature=25.0),
        ])
        parts = [IC(name='IC1')]
        r_hot = compute_fides_prediction(parts, profile_hot)
        r_cool = compute_fides_prediction(parts, profile_cool)
        assert r_hot['system_failure_rate'] > r_cool['system_failure_rate']
