"""Tests for reliability.ALT_fitters."""

import numpy as np
import pytest
from reliability.ALT_fitters import (
    Fit_Weibull_Exponential,
    Fit_Weibull_Eyring,
    Fit_Weibull_Power,
    Fit_Normal_Exponential,
    Fit_Lognormal_Power,
    Fit_Exponential_Exponential,
    Fit_Everything_ALT,
)


@pytest.fixture
def arrhenius_data():
    """Weibull-Arrhenius data at two stress levels."""
    rng = np.random.default_rng(0)
    # Low stress: scale=1000, High stress: scale=200 (Arrhenius-like)
    f_low = rng.weibull(2.0, size=10) * 1000.0
    f_high = rng.weibull(2.0, size=10) * 200.0
    stress_low = np.full(10, 350.0)  # e.g. Kelvin
    stress_high = np.full(10, 400.0)
    return (np.concatenate([f_low, f_high]),
            np.concatenate([stress_low, stress_high]))


@pytest.fixture
def power_data():
    """Weibull-Power data at two stress levels."""
    rng = np.random.default_rng(1)
    f_low = rng.weibull(2.0, size=10) * 500.0
    f_high = rng.weibull(2.0, size=10) * 100.0
    s_low = np.full(10, 1.0)
    s_high = np.full(10, 5.0)
    return (np.concatenate([f_low, f_high]),
            np.concatenate([s_low, s_high]))


def test_weibull_exponential_fits(arrhenius_data):
    failures, stresses = arrhenius_data
    fit = Fit_Weibull_Exponential(failures=failures, failure_stress=stresses,
                                  use_level_stress=375.0)
    assert hasattr(fit, 'a')
    assert hasattr(fit, 'b')
    assert hasattr(fit, 'shape')
    assert fit.shape > 0
    assert fit.converged is True
    assert fit.fit_eligible is True
    assert fit.fit_diagnostics['gradient_finite'] is True


def test_weibull_power_fits(power_data):
    failures, stresses = power_data
    fit = Fit_Weibull_Power(failures=failures, failure_stress=stresses,
                            use_level_stress=2.0)
    assert hasattr(fit, 'a')
    assert hasattr(fit, 'b')
    assert fit.shape > 0


def test_weibull_eyring_fits(arrhenius_data):
    failures, stresses = arrhenius_data
    fit = Fit_Weibull_Eyring(failures=failures, failure_stress=stresses,
                             use_level_stress=375.0)
    assert hasattr(fit, 'a')
    assert hasattr(fit, 'b')
    assert fit.shape > 0


def test_normal_exponential_fits(arrhenius_data):
    failures, stresses = arrhenius_data
    fit = Fit_Normal_Exponential(failures=failures, failure_stress=stresses,
                                 use_level_stress=375.0)
    assert hasattr(fit, 'a')
    assert hasattr(fit, 'b')
    assert fit.shape > 0


def test_exponential_exponential_fits(arrhenius_data):
    failures, stresses = arrhenius_data
    fit = Fit_Exponential_Exponential(failures=failures, failure_stress=stresses,
                                      use_level_stress=375.0)
    assert hasattr(fit, 'a')
    assert hasattr(fit, 'b')


def test_fit_everything_alt(arrhenius_data):
    failures, stresses = arrhenius_data
    fe = Fit_Everything_ALT(
        failures=failures,
        failure_stress=stresses,
        use_level_stress=375.0,
        models_to_fit=['Weibull_Exponential', 'Lognormal_Exponential'],
    )
    assert hasattr(fe, 'results')
    assert len(fe.results) > 0
    assert hasattr(fe, 'best_model')
    assert {'Converged', 'Fit Eligible', 'AICc Eligible', 'Diagnostics'} <= set(fe.results.columns)


def test_fit_everything_alt_sorted(arrhenius_data):
    failures, stresses = arrhenius_data
    fe = Fit_Everything_ALT(
        failures=failures,
        failure_stress=stresses,
        use_level_stress=375.0,
        sort_by='BIC',
        models_to_fit=['Weibull_Exponential', 'Normal_Exponential'],
    )
    bics = fe.results['BIC'].tolist()
    assert bics == sorted(bics)
