"""Tests for reliability.ALT_fitters."""

import warnings

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
    Fit_Weibull_Dual_Exponential,
    _common_shape_diagnostic,
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


@pytest.mark.filterwarnings("error::RuntimeWarning")
def test_weibull_eyring_fits(arrhenius_data):
    failures, stresses = arrhenius_data
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        fit = Fit_Weibull_Eyring(failures=failures, failure_stress=stresses,
                                 use_level_stress=375.0)
    assert not [item for item in caught
                if issubclass(item.category, RuntimeWarning)]
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


def test_use_stress_extrapolation_and_leverage_are_explicit(arrhenius_data):
    failures, stresses = arrhenius_data
    fit = Fit_Weibull_Exponential(
        failures=failures, failure_stress=stresses, use_level_stress=300.0)
    design = fit.stress_design_diagnostics
    assert design['rank'] == design['required_rank'] == 2
    assert design['tested_range'][0] == {'minimum': 350.0, 'maximum': 400.0}
    assert design['use_level']['is_extrapolation'] is True
    assert design['use_level']['position'] == 'below_tested_range'
    assert design['use_level']['normalized_distance_outside_range'] == pytest.approx(1.0)
    assert design['use_level']['leverage_ratio'] > 1


def test_dual_stress_collinearity_is_rejected():
    # Both stresses move together, so their acceleration coefficients cannot be
    # estimated separately even though each column has multiple values.
    with pytest.raises(ValueError, match='rank'):
        Fit_Weibull_Dual_Exponential(
            failures=[1000, 800, 500, 300, 200, 100],
            failure_stress_1=[300, 300, 350, 350, 400, 400],
            failure_stress_2=[30, 30, 35, 35, 40, 40],
            use_level_stress=(280, 28),
        )


def test_common_shape_lrt_detects_large_shape_change():
    rng = np.random.default_rng(771)
    low = rng.weibull(0.55, 120) * 1000
    high = rng.weibull(5.0, 120) * 250
    diagnostic = _common_shape_diagnostic(
        'Weibull', np.r_[low, high], np.r_[np.repeat(350., len(low)), np.repeat(400., len(high))])
    assert diagnostic['status'] == 'ok'
    assert diagnostic['reject_common_shape'] is True
    assert diagnostic['p_value'] < 0.01


@pytest.mark.filterwarnings("error::RuntimeWarning")
def test_parametric_bootstrap_refits_and_brackets_use_life(arrhenius_data):
    failures, stresses = arrhenius_data
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        fit = Fit_Weibull_Exponential(
            failures=failures, failure_stress=stresses, use_level_stress=325.0)
        progress = []
        interval = fit.parametric_bootstrap_use_life(
            n_bootstrap=20, CI=.90, seed=44,
            progress_callback=lambda done, total: progress.append((done, total)))
    assert not [item for item in caught
                if issubclass(item.category, RuntimeWarning)]
    assert interval['status'] == 'ok'
    assert interval['successful'] >= 10
    assert interval['lower'] < interval['median'] < interval['upper']
    assert progress == [(done, 20) for done in range(21)]


def test_physical_stress_direction_is_constrained(power_data):
    failures, stresses = power_data
    fit = Fit_Weibull_Power(failures=failures, failure_stress=stresses)
    assert fit.b < 0
    assert fit.physical_constraint_diagnostic['passed'] is True
