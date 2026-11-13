"""Real numerical SSI integration and quantity transformation contracts."""
import math
import warnings

import numpy as np
import pytest
from pydantic import ValidationError
from scipy.stats import norm
from scipy import integrate, stats

from routers.life_data import stress_strength
from ssi_schemas import StressStrengthRequest


def request(**updates):
    return StressStrengthRequest(**{
        'stress_distribution': 'Normal_2P', 'stress_params': {'mu': 100, 'sigma': 10},
        'strength_distribution': 'Normal_2P', 'strength_params': {'mu': 120, 'sigma': 15},
        **updates,
    })


def test_legacy_unitless_normal_matches_analytic_probability():
    result = stress_strength(request())
    expected = norm.cdf((100-120)/math.sqrt(10**2+15**2))
    assert result['probability_of_failure'] == pytest.approx(expected, abs=5e-9)
    assert result['evaluation_quantity'] is None
    assert result['integration_error'] < 1e-8


def test_pressure_conversion_preserves_probability_and_pdf_jacobian():
    mixed = stress_strength(request(
        strength_params={'mu': 120000, 'sigma': 15000},
        stress_quantity={'kind': 'pressure', 'unit': 'MPa'},
        strength_quantity={'kind': 'pressure', 'unit': 'kPa'},
        evaluation_quantity={'kind': 'pressure', 'unit': 'MPa'},
    ))
    same = stress_strength(request())
    assert mixed['probability_of_failure'] == same['probability_of_failure']
    np.testing.assert_allclose(mixed['curves']['x'], same['curves']['x'])
    np.testing.assert_allclose(mixed['curves']['strength_pdf'], same['curves']['strength_pdf'])


def test_scaled_beta_support_is_not_lost_by_parameter_conversion():
    result = stress_strength(request(
        stress_distribution='Beta_2P', stress_params={'alpha': 1, 'beta': 1},
        strength_distribution='Beta_2P', strength_params={'alpha': 1, 'beta': 1},
        stress_quantity={'kind': 'force', 'unit': 'kN'},
        strength_quantity={'kind': 'force', 'unit': 'N'},
    ))
    # Uniform stress[0,1000] N vs Uniform strength[0,1] N.
    assert result['probability_of_failure'] == pytest.approx(.9995, abs=5e-9)


@pytest.mark.parametrize('updates', [
    {'stress_quantity': {'kind': 'pressure', 'unit': 'Pa'}},
    {'stress_quantity': {'kind': 'force', 'unit': 'N'}, 'strength_quantity': {'kind': 'pressure', 'unit': 'Pa'}},
    {'stress_quantity': {'kind': 'custom', 'unit': 'X'}, 'strength_quantity': {'kind': 'custom', 'unit': 'Y'}},
    {'stress_quantity': {'kind': 'pressure', 'unit': 'N'}, 'strength_quantity': {'kind': 'pressure', 'unit': 'Pa'}},
    {'stress_params': {'mu': float('inf'), 'sigma': 10}},
])
def test_incompatible_quantities_and_nonfinite_parameters_are_rejected(updates):
    with pytest.raises(ValidationError):
        request(**updates)


def test_identical_custom_units_remain_supported():
    result = stress_strength(request(stress_quantity={'kind': 'custom', 'unit': 'widget load'},
                                     strength_quantity={'kind': 'custom', 'unit': 'widget load'}))
    assert result['probability_of_failure'] == stress_strength(request())['probability_of_failure']


def test_fitted_normal_weibull_with_near_endpoint_hint_converges_without_warning():
    # Actual LDA fit/adopt/SSI workflow: one strength quantile maps within a
    # few ulps of u=1. Inserting that point used to destabilize quadrature.
    stress = stats.norm(loc=123.25, scale=59.298854)
    strength = stats.weibull_min(c=2.220693, scale=181.321534587)
    expected, _ = integrate.quad(lambda x: stress.pdf(x)*strength.cdf(x),
                                -np.inf, np.inf, epsabs=1e-12, epsrel=1e-12)
    with warnings.catch_warnings():
        warnings.simplefilter('error', integrate.IntegrationWarning)
        result = stress_strength(request(
            stress_params={'mu': 123.25, 'sigma': 59.298854},
            strength_distribution='Weibull_2P',
            strength_params={'eta': 181321.534587, 'beta': 2.220693},
            stress_quantity={'kind': 'pressure', 'unit': 'MPa'},
            strength_quantity={'kind': 'pressure', 'unit': 'kPa'},
        ))
    assert result['probability_of_failure'] == pytest.approx(expected, abs=5e-9)
    assert result['integration_error'] < 1e-8


@pytest.mark.parametrize(('family', 'params', 'scaled'), [
    ('Weibull_2P', {'eta': 100, 'beta': 2}, {'eta': 100000, 'beta': 2}),
    ('Weibull_3P', {'eta': 100, 'beta': 2, 'gamma': 10}, {'eta': 100000, 'beta': 2, 'gamma': 10000}),
    ('Exponential_1P', {'Lambda': .01}, {'Lambda': .00001}),
    ('Exponential_2P', {'Lambda': .01, 'gamma': 10}, {'Lambda': .00001, 'gamma': 10000}),
    ('Normal_2P', {'mu': 100, 'sigma': 10}, {'mu': 100000, 'sigma': 10000}),
    ('Lognormal_2P', {'mu': 4, 'sigma': .3}, {'mu': 4+math.log(1000), 'sigma': .3}),
    ('Lognormal_3P', {'mu': 4, 'sigma': .3, 'gamma': 10}, {'mu': 4+math.log(1000), 'sigma': .3, 'gamma': 10000}),
    ('Gamma_2P', {'alpha': 2, 'beta': 50}, {'alpha': 2, 'beta': 50000}),
    ('Gamma_3P', {'alpha': 2, 'beta': 50, 'gamma': 10}, {'alpha': 2, 'beta': 50000, 'gamma': 10000}),
    ('Loglogistic_2P', {'alpha': 100, 'beta': 3}, {'alpha': 100000, 'beta': 3}),
    ('Loglogistic_3P', {'alpha': 100, 'beta': 3, 'gamma': 10}, {'alpha': 100000, 'beta': 3, 'gamma': 10000}),
    ('Gumbel_2P', {'mu': 100, 'sigma': 10}, {'mu': 100000, 'sigma': 10000}),
])
def test_equivalent_physical_models_across_units_have_half_interference(family, params, scaled):
    result = stress_strength(request(
        stress_distribution=family, stress_params=params,
        strength_distribution=family, strength_params=scaled,
        stress_quantity={'kind': 'pressure', 'unit': 'MPa'},
        strength_quantity={'kind': 'pressure', 'unit': 'kPa'},
    ))
    assert result['probability_of_failure'] == pytest.approx(.5, abs=5e-9)
    assert all(np.isfinite(result['curves'][key]).all() for key in ('x', 'stress_pdf', 'strength_pdf'))
