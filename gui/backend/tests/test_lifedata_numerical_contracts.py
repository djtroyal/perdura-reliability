"""Independent numerical contracts across the public life-data boundary."""

import sys
from pathlib import Path

import numpy as np
import pytest
from pydantic import ValidationError
from scipy import stats

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from routers import life_data
from schemas import (CalculatorRequest, EvaluateRequest, GenerateRequest,
                     GroupedLifeFitRequest, LifeDataFitRequest, SingleDistPlotRequest)
from reliability.Distributions import Normal_Distribution
from reliability.Fitters import Fit_Normal_2P, Fit_Exponential_1P


def test_small_fitted_rate_survives_adoption_and_evaluation_roundtrip():
    response = life_data.fit_distributions(LifeDataFitRequest(
        failures=[1e6, 2e6, 3e6, 4e6], distributions_to_fit=['Exponential_1P']))
    row = response['results'][0]
    assert row['fit_eligible']
    rate = row['params']['Lambda']
    assert rate == pytest.approx(4e-7, rel=1e-14)
    evaluated = life_data.evaluate_distribution(EvaluateRequest(
        distribution='Exponential_1P', params={'Lambda': rate}, t=1e6))
    assert evaluated['sf'] == pytest.approx(np.exp(-.4), rel=1e-14)


def test_generated_observations_preserve_small_exposures():
    out = life_data.generate_samples(GenerateRequest(
        distribution='Weibull_2P', params={'eta': 1e-12, 'beta': 2.}, n=20, seed=42))
    expected = stats.weibull_min(c=2., scale=1e-12).rvs(size=20, random_state=42)
    np.testing.assert_array_equal(out['samples'], expected)
    assert len(set(out['samples'])) == 20


def test_fitted_curve_coordinates_follow_observation_units_without_absolute_floor():
    observations = np.array([1., 2., 3., 4.])
    ordinary = life_data._distribution_curves(Fit_Exponential_1P(observations), observations)
    small = observations * 1e-12
    scaled = life_data._distribution_curves(Fit_Exponential_1P(small), small)
    np.testing.assert_allclose(np.asarray(scaled['x']) / 1e-12, ordinary['x'])
    np.testing.assert_allclose(scaled['sf'], ordinary['sf'])
    assert np.all(np.diff(scaled['x']) > 0)


def test_calculator_keeps_small_failure_probability_and_unbounded_hazard():
    out = life_data.calculate_metrics(CalculatorRequest(
        distribution='Weibull_2P', params={'eta': 1., 'beta': 2.}, mission_end=1e-10))
    assert out['prob_failure'] == pytest.approx(1e-20, rel=1e-12)
    boundary = life_data.calculate_metrics(CalculatorRequest(
        distribution='Weibull_2P', params={'eta': 1., 'beta': .5}, mission_end=0))
    assert boundary['failure_rate'] is None
    assert boundary['failure_rate_status'] == 'unbounded'
    assert boundary['pdf'] is None
    assert boundary['pdf_status'] == 'unbounded'


def test_remaining_life_public_calculator_matches_reference():
    result = life_data.calculate_metrics(CalculatorRequest(
        distribution='Weibull_2P', params={'eta': 72., 'beta': 2.6},
        elapsed=24., reliability_target=.95))
    assert result['remaining_life'] == pytest.approx(6.673097508738255, rel=1e-12)
    assert result['total_life_at_target'] == pytest.approx(30.673097508738255)


@pytest.mark.parametrize('offset,scale', [(100., 1.), (0., 1.), (100e6, 1e6), (1e-4, 1e-6)])
def test_normal_lr_grid_includes_mle_and_contour_independent_of_units(offset, scale):
    values = offset + scale * np.tile([-1., -.5, 0., .5, 1.], 4)
    fit = Fit_Normal_2P(values)
    grid = life_data._contour_grid(fit, Normal_Distribution, ['mu', 'sigma'], values, None, .95)
    assert grid is not None
    nll = np.asarray(grid['nll'], dtype=float)
    assert np.nanmin(nll) == pytest.approx(-fit.loglik, abs=1e-6)
    assert np.nanmin(nll) < grid['level'] < np.nanmax(nll)
    assert (max(grid['x']) - min(grid['x'])) / scale == pytest.approx(9 / np.sqrt(40), rel=.003)


def test_invalid_estimator_is_rejected_at_request_boundary():
    with pytest.raises(ValidationError):
        LifeDataFitRequest(failures=[1, 2, 3], method='banana')


def test_selected_plotting_positions_reach_lazy_plot_api():
    common = dict(failures=[1., 2., 3., 4., 5.], distribution='Weibull_2P', method='RRY')
    mean = life_data.single_distribution_plot(SingleDistPlotRequest(**common, rank_method='mean'))
    hazen = life_data.single_distribution_plot(SingleDistPlotRequest(**common, rank_method='hazen'))
    assert mean['plot']['probability']['rank_method'] == 'mean'
    assert mean['plot']['probability']['scatter_y'] != hazen['plot']['probability']['scatter_y']


def test_mixed_likelihood_api_accepts_exact_and_interval_together():
    response = life_data.fit_grouped_distributions(GroupedLifeFitRequest(
        observation_model='mixed', distributions_to_fit=['Exponential_1P'],
        mixed_observations=[{'kind':'failure','time':1.,'count':3},
                            {'kind':'interval_censored','lower':1.,'upper':2.,'count':4},
                            {'kind':'left_censored','upper':1.,'count':2},
                            {'kind':'right_censored','time':3.,'count':2}]))
    row = response['results'][0]
    assert row['fit_eligible']
    assert response['n_failures'] == 9
    assert response['n_censored'] == 2
    rate = row['params']['Lambda']
    # Independent weighted exponential likelihood: density, interval, left, survival.
    ll = 3*(np.log(rate)-rate) + 4*np.log(np.exp(-rate)-np.exp(-2*rate)) + 2*np.log1p(-np.exp(-rate)) - 6*rate
    assert row['LogLik'] == pytest.approx(ll, abs=1e-8)
    assert response['plots']['Exponential_1P']['observation_model'] == 'mixed'
