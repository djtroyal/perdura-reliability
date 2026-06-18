"""Tests for the Telcordia SR-332 failure rate prediction module."""

import math
import pytest

from reliability.Telcordia import (
    IC_Digital, IC_Linear, IC_Memory, IC_Microprocessor,
    Diode, Transistor_BJT, Transistor_FET,
    Resistor, Capacitor, Inductor, Transformer,
    Relay, Switch, Connector, Crystal, Fuse, PCB,
    GenericPart, SystemFailureRate,
    pi_temperature, pi_stress,
    PI_Q, PI_E, ENVIRONMENTS, QUALITY_LEVELS, STANDARDS,
    _fit_to_fpmh,
)


# ===================================================================
# Module-level constants and helper functions
# ===================================================================

class TestConstants:
    def test_standards(self):
        assert 'SR-332' in STANDARDS

    def test_environments_list(self):
        for env in ['GC', 'GF', 'GM', 'CL', 'NU', 'AF', 'AUF']:
            assert env in ENVIRONMENTS

    def test_quality_levels(self):
        for q in ['telcordia', 'commercial_best', 'commercial', 'unknown']:
            assert q in QUALITY_LEVELS


class TestPiTemperature:
    def test_reference_temperature_gives_one(self):
        """At T_ref the acceleration factor should be 1.0."""
        assert pi_temperature(0.35, 40.0, T_ref=40.0) == pytest.approx(1.0)

    def test_higher_temperature_increases_factor(self):
        """Higher operating temperature must produce a larger factor."""
        pi_40 = pi_temperature(0.35, 40.0)
        pi_60 = pi_temperature(0.35, 60.0)
        pi_85 = pi_temperature(0.35, 85.0)
        assert pi_40 < pi_60 < pi_85

    def test_lower_temperature_decreases_factor(self):
        """Below T_ref the factor should be < 1."""
        assert pi_temperature(0.35, 25.0) < 1.0

    def test_zero_activation_energy(self):
        """With Ea=0, factor is always 1 regardless of temperature."""
        assert pi_temperature(0.0, 100.0) == pytest.approx(1.0)


class TestPiStress:
    def test_at_reference(self):
        """At 50% stress ratio the factor should be 1.0."""
        assert pi_stress(0.5) == pytest.approx(1.0)

    def test_low_stress(self):
        """Very low stress is clamped to 0.5."""
        assert pi_stress(0.0) == 0.5
        assert pi_stress(0.1) == 0.5  # (0.1/0.5)^2 = 0.04, clamped

    def test_high_stress(self):
        """High stress should be > 1 (and clamped at 5.0 max)."""
        assert pi_stress(0.9) > 1.0
        assert pi_stress(2.0) == 5.0  # way above 50%, clamped

    def test_custom_exponent(self):
        s = pi_stress(0.75, exponent=3.0)
        expected = (0.75 / 0.5) ** 3.0
        assert s == pytest.approx(expected)


class TestFitToFpmh:
    def test_conversion(self):
        assert _fit_to_fpmh(1000) == pytest.approx(1.0)
        assert _fit_to_fpmh(1) == pytest.approx(0.001)
        assert _fit_to_fpmh(0) == 0.0


# ===================================================================
# Each part class produces positive failure rates
# ===================================================================

class TestPositiveRates:
    """Every part class must produce a positive failure rate with defaults."""

    def test_ic_digital(self):
        p = IC_Digital()
        assert p.failure_rate > 0

    def test_ic_linear(self):
        p = IC_Linear()
        assert p.failure_rate > 0

    def test_ic_memory(self):
        p = IC_Memory()
        assert p.failure_rate > 0

    def test_ic_microprocessor(self):
        p = IC_Microprocessor()
        assert p.failure_rate > 0

    def test_diode(self):
        p = Diode()
        assert p.failure_rate > 0

    def test_transistor_bjt(self):
        p = Transistor_BJT()
        assert p.failure_rate > 0

    def test_transistor_fet(self):
        p = Transistor_FET()
        assert p.failure_rate > 0

    def test_resistor(self):
        p = Resistor()
        assert p.failure_rate > 0

    def test_capacitor(self):
        p = Capacitor()
        assert p.failure_rate > 0

    def test_inductor(self):
        p = Inductor()
        assert p.failure_rate > 0

    def test_transformer(self):
        p = Transformer()
        assert p.failure_rate > 0

    def test_relay(self):
        p = Relay()
        assert p.failure_rate > 0

    def test_switch(self):
        p = Switch()
        assert p.failure_rate > 0

    def test_connector(self):
        p = Connector()
        assert p.failure_rate > 0

    def test_crystal(self):
        p = Crystal()
        assert p.failure_rate > 0

    def test_fuse(self):
        p = Fuse()
        assert p.failure_rate > 0

    def test_pcb(self):
        p = PCB()
        assert p.failure_rate > 0

    def test_generic_part(self):
        p = GenericPart(failure_rate=0.5)
        assert p.failure_rate == pytest.approx(0.5)


# ===================================================================
# piQ factors correctly applied: telcordia < commercial < unknown
# ===================================================================

class TestQualityOrdering:
    """Lower quality should give strictly higher failure rates."""

    def _rates_by_quality(self, cls, **extra):
        rates = {}
        for q in ['telcordia', 'commercial_best', 'commercial', 'unknown']:
            p = cls(quality=q, **extra)
            rates[q] = p.failure_rate
        return rates

    def test_ic_digital_quality_ordering(self):
        r = self._rates_by_quality(IC_Digital)
        assert r['telcordia'] < r['commercial_best'] < r['commercial'] < r['unknown']

    def test_resistor_quality_ordering(self):
        r = self._rates_by_quality(Resistor)
        assert r['telcordia'] < r['commercial_best'] < r['commercial'] < r['unknown']

    def test_capacitor_quality_ordering(self):
        r = self._rates_by_quality(Capacitor)
        assert r['telcordia'] < r['commercial_best'] < r['commercial'] < r['unknown']

    def test_diode_quality_ordering(self):
        r = self._rates_by_quality(Diode)
        assert r['telcordia'] < r['commercial_best'] < r['commercial'] < r['unknown']

    def test_connector_quality_ordering(self):
        r = self._rates_by_quality(Connector)
        assert r['telcordia'] < r['commercial_best'] < r['commercial'] < r['unknown']

    def test_relay_quality_ordering(self):
        r = self._rates_by_quality(Relay)
        assert r['telcordia'] < r['commercial_best'] < r['commercial'] < r['unknown']


# ===================================================================
# piE factors: GC < GF < GM
# ===================================================================

class TestEnvironmentOrdering:
    """Harsher environments must give higher failure rates."""

    def test_ic_digital_environment(self):
        gc = IC_Digital(environment='GC').failure_rate
        gf = IC_Digital(environment='GF').failure_rate
        gm = IC_Digital(environment='GM').failure_rate
        assert gc < gf < gm

    def test_resistor_environment(self):
        gc = Resistor(environment='GC').failure_rate
        gf = Resistor(environment='GF').failure_rate
        gm = Resistor(environment='GM').failure_rate
        assert gc < gf < gm

    def test_capacitor_environment(self):
        gc = Capacitor(environment='GC').failure_rate
        gf = Capacitor(environment='GF').failure_rate
        gm = Capacitor(environment='GM').failure_rate
        assert gc < gf < gm

    def test_switch_environment(self):
        gc = Switch(environment='GC').failure_rate
        gf = Switch(environment='GF').failure_rate
        gm = Switch(environment='GM').failure_rate
        assert gc < gf < gm

    def test_fuse_environment(self):
        gc = Fuse(environment='GC').failure_rate
        gf = Fuse(environment='GF').failure_rate
        gm = Fuse(environment='GM').failure_rate
        assert gc < gf < gm


# ===================================================================
# Temperature acceleration: higher T -> higher rate
# ===================================================================

class TestTemperatureAcceleration:
    """Higher operating temperature must increase failure rate."""

    def test_ic_digital_temperature(self):
        lo = IC_Digital(temperature=25.0).failure_rate
        mid = IC_Digital(temperature=55.0).failure_rate
        hi = IC_Digital(temperature=85.0).failure_rate
        assert lo < mid < hi

    def test_diode_temperature(self):
        lo = Diode(temperature=25.0).failure_rate
        hi = Diode(temperature=85.0).failure_rate
        assert lo < hi

    def test_capacitor_temperature(self):
        lo = Capacitor(temperature=25.0).failure_rate
        hi = Capacitor(temperature=85.0).failure_rate
        assert lo < hi

    def test_resistor_temperature(self):
        lo = Resistor(temperature=25.0).failure_rate
        hi = Resistor(temperature=85.0).failure_rate
        assert lo < hi

    def test_connector_temperature(self):
        lo = Connector(temperature=25.0).failure_rate
        hi = Connector(temperature=85.0).failure_rate
        assert lo < hi

    def test_inductor_temperature(self):
        lo = Inductor(temperature=25.0).failure_rate
        hi = Inductor(temperature=85.0).failure_rate
        assert lo < hi

    def test_relay_temperature(self):
        lo = Relay(temperature=25.0).failure_rate
        hi = Relay(temperature=85.0).failure_rate
        assert lo < hi


# ===================================================================
# SystemFailureRate sums correctly
# ===================================================================

class TestSystemFailureRate:
    def test_sum_of_parts(self):
        parts = [
            IC_Digital(complexity='low'),
            Resistor(quantity=10),
            Capacitor(quantity=5),
        ]
        sys = SystemFailureRate(parts)
        expected = sum(p.total_failure_rate for p in parts)
        assert sys.total_failure_rate == pytest.approx(expected)

    def test_mtbf(self):
        parts = [IC_Digital()]
        sys = SystemFailureRate(parts)
        assert sys.mtbf == pytest.approx(1e6 / sys.total_failure_rate)

    def test_reliability(self):
        parts = [IC_Digital()]
        sys = SystemFailureRate(parts)
        R = sys.reliability(1000)
        expected = math.exp(-sys.total_failure_rate * 1000 / 1e6)
        assert R == pytest.approx(expected)

    def test_results_length(self):
        parts = [IC_Digital(), Resistor(), Capacitor()]
        sys = SystemFailureRate(parts)
        assert len(sys.results) == 3

    def test_contributions_sum_to_one(self):
        parts = [IC_Digital(), Resistor(), Capacitor()]
        sys = SystemFailureRate(parts)
        total_contrib = sum(r['contribution'] for r in sys.results)
        assert total_contrib == pytest.approx(1.0, abs=0.01)

    def test_empty_parts_raises(self):
        with pytest.raises(ValueError):
            SystemFailureRate([])

    def test_repr(self):
        parts = [IC_Digital()]
        sys = SystemFailureRate(parts)
        r = repr(sys)
        assert 'FPMH' in r
        assert 'MTBF' in r


# ===================================================================
# Connector: rate scales with pin count
# ===================================================================

class TestConnectorPins:
    def test_more_pins_higher_rate(self):
        c10 = Connector(pins=10)
        c50 = Connector(pins=50)
        c100 = Connector(pins=100)
        assert c10.failure_rate < c50.failure_rate < c100.failure_rate

    def test_rate_proportional_to_pins(self):
        c10 = Connector(pins=10)
        c20 = Connector(pins=20)
        # Rate should scale linearly with pins (base = 2 FIT/pin)
        ratio = c20.failure_rate / c10.failure_rate
        assert ratio == pytest.approx(2.0)

    def test_single_pin(self):
        c1 = Connector(pins=1)
        assert c1.failure_rate > 0
        assert c1.pi_factors['pins'] == 1


# ===================================================================
# Part-specific tests
# ===================================================================

class TestICDigital:
    def test_complexity_ordering(self):
        lo = IC_Digital(complexity='low').failure_rate
        med = IC_Digital(complexity='medium').failure_rate
        hi = IC_Digital(complexity='high').failure_rate
        vh = IC_Digital(complexity='very_high').failure_rate
        assert lo < med < hi < vh

    def test_invalid_complexity(self):
        with pytest.raises(ValueError, match='complexity'):
            IC_Digital(complexity='extreme')


class TestICMemory:
    def test_density_ordering(self):
        lo = IC_Memory(density='low').failure_rate
        med = IC_Memory(density='medium').failure_rate
        hi = IC_Memory(density='high').failure_rate
        assert lo < med < hi

    def test_invalid_density(self):
        with pytest.raises(ValueError, match='density'):
            IC_Memory(density='ultra')


class TestICMicroprocessor:
    def test_complexity_ordering(self):
        lo = IC_Microprocessor(complexity='low').failure_rate
        hi = IC_Microprocessor(complexity='very_high').failure_rate
        assert lo < hi


class TestDiode:
    def test_type_differences(self):
        sig = Diode(diode_type='signal').failure_rate
        pwr = Diode(diode_type='power').failure_rate
        assert sig < pwr

    def test_stress_increases_rate(self):
        lo = Diode(voltage_stress=0.2).failure_rate
        hi = Diode(voltage_stress=0.8).failure_rate
        assert lo < hi


class TestTransistorBJT:
    def test_power_higher_than_signal(self):
        sig = Transistor_BJT(transistor_type='signal').failure_rate
        pwr = Transistor_BJT(transistor_type='power').failure_rate
        assert sig < pwr


class TestTransistorFET:
    def test_types(self):
        sig = Transistor_FET(fet_type='signal_mosfet').failure_rate
        pwr = Transistor_FET(fet_type='power_mosfet').failure_rate
        assert sig < pwr


class TestResistor:
    def test_type_ordering(self):
        film = Resistor(resistor_type='film').failure_rate
        ww = Resistor(resistor_type='wirewound').failure_rate
        assert film < ww


class TestCapacitor:
    def test_type_ordering(self):
        mica = Capacitor(capacitor_type='mica').failure_rate
        alum = Capacitor(capacitor_type='aluminum').failure_rate
        assert mica < alum


class TestTransformer:
    def test_power_higher_than_signal(self):
        sig = Transformer(transformer_type='signal').failure_rate
        pwr = Transformer(transformer_type='power').failure_rate
        assert sig < pwr


class TestRelay:
    def test_cycling_rate(self):
        lo = Relay(cycling_rate=1.0).failure_rate
        hi = Relay(cycling_rate=10.0).failure_rate
        assert lo < hi

    def test_solid_state_lower(self):
        gp = Relay(relay_type='general_purpose').failure_rate
        ss = Relay(relay_type='solid_state').failure_rate
        assert ss < gp


class TestPCB:
    def test_more_layers_higher_rate(self):
        p2 = PCB(layers=2).failure_rate
        p6 = PCB(layers=6).failure_rate
        assert p2 < p6

    def test_larger_area_higher_rate(self):
        small = PCB(area_sqin=10.0).failure_rate
        large = PCB(area_sqin=40.0).failure_rate
        assert small < large


class TestFuse:
    def test_no_quality_factor(self):
        """Fuse should not have piQ in its factors."""
        f = Fuse()
        assert 'pi_Q' not in f.pi_factors


class TestCrystal:
    def test_no_temperature_factor(self):
        """Crystal uses only piQ and piE."""
        c = Crystal()
        assert 'pi_T' not in c.pi_factors


# ===================================================================
# Validation tests
# ===================================================================

class TestValidation:
    def test_invalid_environment(self):
        with pytest.raises(ValueError, match='environment'):
            IC_Digital(environment='XX')

    def test_invalid_quality(self):
        with pytest.raises(ValueError, match='quality'):
            IC_Digital(quality='mil_spec')

    def test_invalid_stress_ratio(self):
        with pytest.raises(ValueError, match='voltage_stress'):
            Diode(voltage_stress=1.5)

    def test_invalid_quantity(self):
        with pytest.raises(ValueError, match='quantity'):
            IC_Digital(quantity=0)

    def test_invalid_connector_pins(self):
        with pytest.raises(ValueError, match='pins'):
            Connector(pins=0)

    def test_invalid_pcb_layers(self):
        with pytest.raises(ValueError, match='layers'):
            PCB(layers=0)

    def test_invalid_pcb_area(self):
        with pytest.raises(ValueError, match='area'):
            PCB(area_sqin=-1)

    def test_generic_part_negative_rate(self):
        with pytest.raises(ValueError, match='failure_rate'):
            GenericPart(failure_rate=-1.0)


# ===================================================================
# Quantity and total_failure_rate
# ===================================================================

class TestQuantity:
    def test_quantity_multiplies(self):
        p1 = IC_Digital(quantity=1)
        p5 = IC_Digital(quantity=5)
        assert p5.total_failure_rate == pytest.approx(
            5 * p1.failure_rate)

    def test_failure_rate_independent_of_quantity(self):
        p1 = IC_Digital(quantity=1)
        p5 = IC_Digital(quantity=5)
        assert p1.failure_rate == pytest.approx(p5.failure_rate)


# ===================================================================
# Repr
# ===================================================================

class TestRepr:
    def test_part_repr(self):
        p = IC_Digital(name='U1')
        r = repr(p)
        assert 'U1' in r
        assert 'FPMH' in r

    def test_default_name(self):
        p = IC_Digital()
        assert p.name == 'IC_Digital'
