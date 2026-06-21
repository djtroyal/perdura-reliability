"""Tests for the NPRD-2023 / EPRD-2014 empirical reliability databases."""

import pytest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from reliability.NPRD_EPRD import (
    ENVIRONMENTS, QUALITY_LEVELS, PI_E, PI_Q,
    EPRD_CLASSES, NPRD_CLASSES,
    EPRD_Capacitor, EPRD_Microcircuit, NPRD_Motor, NPRD_Valve, NPRD_Generic,
)


class TestEPRD:
    def test_all_classes_default_positive(self):
        for name, cls in EPRD_CLASSES.items():
            part = cls(name=name)
            assert part.failure_rate > 0, name
            assert part.total_failure_rate == pytest.approx(part.failure_rate)

    def test_quality_scales_rate(self):
        hi = EPRD_Capacitor(quality='high')
        lo = EPRD_Capacitor(quality='lower')
        assert lo.failure_rate > hi.failure_rate

    def test_environment_scales_rate(self):
        benign = EPRD_Microcircuit(environment='GB')
        harsh = EPRD_Microcircuit(environment='CL')
        assert harsh.failure_rate > benign.failure_rate

    def test_quantity_multiplies(self):
        part = EPRD_Capacitor(quantity=4)
        assert part.total_failure_rate == pytest.approx(part.failure_rate * 4)

    def test_pi_factors_present(self):
        part = EPRD_Microcircuit(ic_type='microprocessor')
        for k in ('lambda_base', 'pi_E', 'pi_Q'):
            assert k in part.pi_factors

    def test_invalid_subtype_raises(self):
        with pytest.raises(ValueError):
            EPRD_Capacitor(cap_type='not_a_type')

    def test_invalid_environment_raises(self):
        with pytest.raises(ValueError):
            EPRD_Capacitor(environment='ZZ')

    def test_invalid_quality_raises(self):
        with pytest.raises(ValueError):
            EPRD_Capacitor(quality='gold')


class TestNPRD:
    def test_all_classes_default_positive(self):
        for name, cls in NPRD_CLASSES.items():
            part = cls(name=name)
            assert part.failure_rate > 0, name

    def test_motor_types(self):
        for t in ('ac_induction', 'dc_brushed', 'stepper'):
            assert NPRD_Motor(motor_type=t).failure_rate > 0

    def test_valve_types(self):
        for t in ('ball', 'gate', 'solenoid'):
            assert NPRD_Valve(valve_type=t).failure_rate > 0

    def test_generic_part_classes(self):
        for t in ('spring', 'lamp', 'fuse', 'heater'):
            assert NPRD_Generic(part_class=t).failure_rate > 0

    def test_nonelectronic_rates_higher_than_electronic(self):
        # Mechanical parts characteristically fail far more often than ICs.
        assert NPRD_Motor().failure_rate > EPRD_Microcircuit().failure_rate


class TestRegistries:
    def test_environment_and_quality_tables_consistent(self):
        assert set(PI_E) == set(ENVIRONMENTS)
        assert set(PI_Q) == set(QUALITY_LEVELS)

    def test_class_categories_unique(self):
        cats = [c.category for c in list(EPRD_CLASSES.values()) + list(NPRD_CLASSES.values())]
        assert len(cats) == len(set(cats))
