"""Tests for MIL_HDBK_217F failure rate prediction."""

import numpy as np
import pytest

from reliability.MIL_HDBK_217F import (
    ENVIRONMENTS, Microcircuit, Diode, BipolarTransistor,
    FieldEffectTransistor, Thyristor, Optoelectronic, Resistor, Capacitor,
    InductiveDevice, Relay, Switch, Connector, Connection, RotatingDevice,
    QuartzCrystal, Lamp, ElectronicFilter, Fuse, CustomPart, GenericPart,
    SystemFailureRate, arrhenius_pi_T,
)


class TestMicrocircuit:
    def test_hand_computed_example(self):
        # MOS digital, 8k gates (C1=0.080), 64-pin nonhermetic
        # (C2 = 3.6e-4 * 64^1.08), TJ=50, GB, commercial, mature
        m = Microcircuit(device_type='digital', technology='mos',
                         complexity=8000, pins=64, package='nonhermetic',
                         T_junction=50, quality='commercial',
                         years_in_production=3, environment='GB')
        C2 = 3.6e-4 * 64 ** 1.08
        pi_T = 0.1 * np.exp(-0.35 / 8.617e-5 * (1 / 323.0 - 1 / 298.0))
        expected = (0.080 * pi_T + C2 * 0.5) * 10.0 * 1.0
        assert m.failure_rate == pytest.approx(expected, rel=1e-6)

    def test_pi_T_is_point_one_at_25C(self):
        assert arrhenius_pi_T(25.0, 0.35, scale=0.1) == pytest.approx(0.1)

    def test_hotter_junction_increases_failure_rate(self):
        cool = Microcircuit(T_junction=40).failure_rate
        hot = Microcircuit(T_junction=100).failure_rate
        assert hot > cool

    def test_quality_ordering(self):
        rates = [Microcircuit(quality=q).failure_rate
                 for q in ('S', 'B', 'B-1', 'commercial')]
        assert all(b > a for a, b in zip(rates, rates[1:]))

    def test_learning_factor_for_new_production(self):
        new = Microcircuit(years_in_production=0.5)
        mature = Microcircuit(years_in_production=5)
        assert new.pi_factors['pi_L'] == pytest.approx(1.77, abs=0.02)
        assert mature.pi_factors['pi_L'] == 1.0
        assert new.failure_rate > mature.failure_rate

    def test_vita_mode_reduces_commercial_rate(self):
        f217 = Microcircuit(quality='commercial', years_in_production=0.5)
        vita = Microcircuit(quality='commercial', years_in_production=0.5,
                            standard='VITA-51.1')
        assert vita.pi_factors['pi_Q'] == 2.0
        assert vita.pi_factors['pi_L'] == 1.0
        assert vita.failure_rate < f217.failure_rate

    def test_explicit_pi_Q_override(self):
        m = Microcircuit(quality='commercial', pi_Q=1.7)
        assert m.pi_factors['pi_Q'] == 1.7

    def test_validation(self):
        with pytest.raises(ValueError):
            Microcircuit(environment='XX')
        with pytest.raises(ValueError):
            Microcircuit(complexity=999999)  # beyond C1 table
        with pytest.raises(ValueError):
            Microcircuit(package='bga_unknown')
        with pytest.raises(ValueError):
            Microcircuit(standard='217-G')


class TestDiode:
    def test_hand_computed_example(self):
        # switching diode, TJ=25 (piT=1), Vs=0.5, bonded, JANTX, GB
        d = Diode(diode_type='switching', T_junction=25, voltage_stress=0.5,
                  contact='bonded', quality='JANTX', environment='GB')
        expected = 0.0010 * 1.0 * 0.5 ** 2.43 * 1.0 * 1.0 * 1.0
        assert d.failure_rate == pytest.approx(expected, rel=1e-6)

    def test_low_voltage_stress_floor(self):
        d = Diode(voltage_stress=0.2)
        assert d.pi_factors['pi_S'] == pytest.approx(0.054)

    def test_stress_not_applied_to_zener(self):
        z = Diode(diode_type='zener_regulator', voltage_stress=0.9)
        assert z.pi_factors['pi_S'] == 1.0

    def test_environment_ordering(self):
        gb = Diode(environment='GB').failure_rate
        nu = Diode(environment='NU').failure_rate
        cl = Diode(environment='CL').failure_rate
        assert gb < nu < cl


class TestTransistors:
    def test_bjt_hand_computed(self):
        # TJ=25 (piT=1), switching (0.7), 1W (piR=1), Vs=0.5, JANTX, GB
        t = BipolarTransistor(application='switching', rated_power=1.0,
                              voltage_stress=0.5, T_junction=25,
                              quality='JANTX', environment='GB')
        expected = 0.00074 * 1.0 * 0.7 * 1.0 * 0.045 * np.exp(3.1 * 0.5)
        assert t.failure_rate == pytest.approx(expected, rel=1e-6)

    def test_linear_worse_than_switching(self):
        lin = BipolarTransistor(application='linear').failure_rate
        sw = BipolarTransistor(application='switching').failure_rate
        assert lin > sw

    def test_fet_power_application_ordering(self):
        apps = ['switching', 'linear', 'power_2_5W', 'power_5_50W',
                'power_50_250W', 'power_gt_250W']
        rates = [FieldEffectTransistor(application=a).failure_rate
                 for a in apps]
        assert all(b > a for a, b in zip(rates, rates[1:]))

    def test_jfet_lower_base_rate_than_mosfet(self):
        j = FieldEffectTransistor(fet_type='jfet').failure_rate
        m = FieldEffectTransistor(fet_type='mosfet').failure_rate
        assert j < m


class TestResistor:
    def test_film_base_rate_order_of_magnitude(self):
        # Notice 2 factored model: at 25C / 50% stress / 0.5W rated the
        # film resistor rate is in the low single-digit milli-FPMH range.
        r = Resistor(style='film', T_ambient=25, power_stress=0.5,
                     rated_power=0.5, quality='M', environment='GB')
        assert 0.0005 < r.failure_rate < 0.01

    def test_high_resistance_factor(self):
        low = Resistor(resistance=10e3)
        high = Resistor(resistance=50e6)
        assert low.pi_factors['pi_R'] == 1.0
        assert high.pi_factors['pi_R'] == 2.5

    def test_power_stress_increases_rate(self):
        assert (Resistor(power_stress=0.9).failure_rate
                > Resistor(power_stress=0.1).failure_rate)

    def test_vita_mode_reduces_commercial(self):
        f217 = Resistor(quality='commercial')
        vita = Resistor(quality='commercial', standard='VITA-51.1')
        assert vita.pi_factors['pi_Q'] == 3.0
        assert vita.failure_rate < f217.failure_rate


class TestCapacitor:
    def test_tantalum_series_resistance_factor(self):
        hi = Capacitor(style='tantalum_solid', circuit_resistance=1.0)
        lo = Capacitor(style='tantalum_solid', circuit_resistance=0.05)
        assert hi.pi_factors['pi_SR'] == 0.66
        assert lo.pi_factors['pi_SR'] == 3.3
        assert lo.failure_rate > hi.failure_rate

    def test_pi_SR_only_for_tantalum(self):
        c = Capacitor(style='ceramic', circuit_resistance=0.05)
        assert c.pi_factors['pi_SR'] == 1.0

    def test_voltage_derating_helps(self):
        derated = Capacitor(voltage_stress=0.3).failure_rate
        stressed = Capacitor(voltage_stress=0.9).failure_rate
        assert stressed > derated

    def test_validation(self):
        with pytest.raises(ValueError):
            Capacitor(capacitance=-1)
        with pytest.raises(ValueError):
            Capacitor(voltage_stress=1.5)


class TestSystemFailureRate:
    def _parts(self):
        return [
            Microcircuit(name='CPU', T_junction=60, quantity=1),
            Resistor(name='R network', quantity=20),
            Capacitor(name='decoupling', quantity=15),
            GenericPart(0.5, name='connector (vendor data)', quantity=2),
        ]

    def test_total_is_sum_of_quantity_weighted_rates(self):
        parts = self._parts()
        sys = SystemFailureRate(parts)
        expected = sum(p.failure_rate * p.quantity for p in parts)
        assert sys.total_failure_rate == pytest.approx(expected, rel=1e-12)

    def test_mtbf_and_reliability(self):
        sys = SystemFailureRate(self._parts())
        lam = sys.total_failure_rate
        assert sys.mtbf == pytest.approx(1e6 / lam, rel=1e-12)
        assert sys.reliability(0) == pytest.approx(1.0)
        t = 1000.0
        assert sys.reliability(t) == pytest.approx(np.exp(-lam * t / 1e6))
        R = sys.reliability(np.array([0.0, 1000.0]))
        assert R.shape == (2,)

    def test_contributions_sum_to_one(self):
        sys = SystemFailureRate(self._parts())
        assert sum(r['contribution'] for r in sys.results) == pytest.approx(
            1.0, abs=1e-3)

    def test_empty_parts_rejected(self):
        with pytest.raises(ValueError):
            SystemFailureRate([])

    def test_generic_part_validation(self):
        with pytest.raises(ValueError):
            GenericPart(-0.1)
        with pytest.raises(ValueError):
            GenericPart(1.0, quantity=0)


class TestEnvironmentTables:
    def test_all_environments_work_for_all_parts(self):
        for env in ENVIRONMENTS:
            for part in (Microcircuit(environment=env),
                         Diode(environment=env),
                         BipolarTransistor(environment=env),
                         FieldEffectTransistor(environment=env),
                         Thyristor(environment=env),
                         Optoelectronic(environment=env),
                         Resistor(environment=env),
                         Capacitor(environment=env),
                         InductiveDevice(environment=env),
                         Relay(environment=env),
                         Switch(environment=env),
                         Connector(environment=env),
                         Connection(environment=env),
                         RotatingDevice(environment=env),
                         QuartzCrystal(environment=env),
                         Lamp(environment=env),
                         ElectronicFilter(environment=env),
                         Fuse(environment=env)):
                assert part.failure_rate > 0


class TestMultiplier:
    def test_multiplier_scales_rate(self):
        base = Resistor()
        scaled = Resistor(multiplier=0.4)
        assert scaled.failure_rate == pytest.approx(base.failure_rate * 0.4)
        assert scaled.total_failure_rate == pytest.approx(
            base.total_failure_rate * 0.4)

    def test_multiplier_in_results(self):
        sys = SystemFailureRate([Resistor(multiplier=0.4), Capacitor()])
        assert sys.results[0]['multiplier'] == 0.4
        assert sys.results[1]['multiplier'] == 1.0

    def test_multiplier_validation(self):
        with pytest.raises(ValueError):
            Resistor(multiplier=0)
        with pytest.raises(ValueError):
            GenericPart(1.0, multiplier=-1)


class TestNewParts:
    def test_crystal_frequency_model(self):
        c = QuartzCrystal(frequency_mhz=10, quality='MIL-SPEC',
                          environment='GB')
        assert c.failure_rate == pytest.approx(0.013 * 10 ** 0.23, rel=1e-6)

    def test_fuse_is_lambda_b_times_pi_e(self):
        assert Fuse(environment='GB').failure_rate == pytest.approx(0.010)
        assert Fuse(environment='GF').failure_rate == pytest.approx(0.020)

    def test_inductive_hotspot_temperature(self):
        cool = InductiveDevice(T_hotspot=40)
        hot = InductiveDevice(T_hotspot=110)
        assert hot.failure_rate > cool.failure_rate

    def test_relay_cycling(self):
        slow = Relay(cycles_per_hour=0.1)
        fast = Relay(cycles_per_hour=100)
        assert fast.failure_rate > slow.failure_rate

    def test_connector_pins(self):
        small = Connector(pins=9)
        large = Connector(pins=100)
        assert large.failure_rate > small.failure_rate

    def test_connection_types_ordering(self):
        hand = Connection(connection_type='hand_solder')
        reflow = Connection(connection_type='reflow_solder')
        wrap = Connection(connection_type='wire_wrap')
        assert hand.failure_rate > reflow.failure_rate > wrap.failure_rate

    def test_validation(self):
        with pytest.raises(ValueError):
            Optoelectronic(device='maser')
        with pytest.raises(ValueError):
            Switch(switch_type='dip99')
        with pytest.raises(ValueError):
            QuartzCrystal(frequency_mhz=-1)


class TestCustomPart:
    def test_exponential_model(self):
        p = CustomPart(model='exponential', failure_rate=2.5)
        assert p.failure_rate == pytest.approx(2.5)

    def test_weibull_average_rate(self):
        # lambda_avg = 1e6 * (t/eta)^beta / t
        p = CustomPart(model='weibull', eta=50000, beta=2.0, eval_time=10000)
        expected = 1e6 * (10000 / 50000) ** 2 / 10000
        assert p.failure_rate == pytest.approx(expected, rel=1e-9)

    def test_weibull_beta_one_matches_exponential(self):
        # beta=1: average rate = 1e6/eta regardless of eval_time
        p1 = CustomPart(model='weibull', eta=1e5, beta=1.0, eval_time=500)
        p2 = CustomPart(model='weibull', eta=1e5, beta=1.0, eval_time=50000)
        assert p1.failure_rate == pytest.approx(10.0)
        assert p2.failure_rate == pytest.approx(10.0)

    def test_validation(self):
        with pytest.raises(ValueError):
            CustomPart(model='lognormal')
        with pytest.raises(ValueError):
            CustomPart(model='exponential')
        with pytest.raises(ValueError):
            CustomPart(model='weibull', eta=100, beta=2.0)
