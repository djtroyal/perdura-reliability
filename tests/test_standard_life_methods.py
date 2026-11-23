"""Independent mathematical contracts for standard lifetime methods."""

import numpy as np
import pytest
from scipy import optimize, stats
from scipy.special import logsumexp

from reliability.Bayesian import weibayes_fit
from reliability.Fitters import (
    _FITTER_MAP, Fit_Everything, Fit_Normal_2P, Fit_Weibull_2P,
)
from reliability.Grouped_life import (
    FrequencyObservation, MixedLifeObservation, fit_grouped_life,
    validate_mixed_observations,
)
from reliability.Uncertainty import parametric_bootstrap_package
from reliability.Probability_plotting import Weibull_probability_plot
from reliability.Utils import PLOTTING_POSITION_METHODS, plotting_positions


@pytest.mark.parametrize('fitter', list(_FITTER_MAP.values()) + [Fit_Everything])
def test_library_rejects_unidentified_and_unknown_estimator_requests(fitter):
    with pytest.raises(ValueError, match='At least one failure'):
        fitter([], right_censored=[10, 20, 30])
    with pytest.raises(ValueError, match='method must'):
        fitter([1, 2, 3], method='banana')
    with pytest.raises(ValueError, match='finite one-dimensional'):
        fitter([1, np.nan, 3])
    with pytest.raises(ValueError, match='Unknown rank_method'):
        fitter([1, 2, 3], rank_method='proprietary')


def test_complete_sample_rank_formulas_and_km_endpoint():
    times = [1, 2, 3, 4]
    ranks = np.arange(1., 5.)
    expected = {
        'benard': (ranks - .3) / 4.4,
        'exact_median': stats.beta.ppf(.5, ranks, 5 - ranks),
        'mean': ranks / 5,
        'hazen': (ranks - .5) / 4,
        'blom': (ranks - .375) / 4.25,
        'kaplan_meier': ranks / 4,
    }
    for method, probabilities in expected.items():
        np.testing.assert_allclose(plotting_positions(times, rank_method=method),
                                   probabilities, rtol=1e-13)


def test_km_ties_keep_simultaneous_withdrawals_in_event_risk_set():
    # At t=1: three of five fail before one tied withdrawal; at t=2 the
    # remaining unit fails. All tied events share the same post-event CDF.
    np.testing.assert_allclose(
        plotting_positions([1, 1, 1, 2], [1], 'kaplan_meier'),
        [.6, .6, .6, 1.],
    )


def test_km_probability_plot_omits_infinite_endpoint_without_misalignment():
    x, y = Weibull_probability_plot([4, 1, 3, 2], show_plot=False,
                                    rank_method='kaplan_meier')
    np.testing.assert_allclose(x, np.log([1, 2, 3]))
    np.testing.assert_allclose(y, np.log(-np.log1p(-np.array([.25, .5, .75]))))


@pytest.mark.parametrize('rank_method', PLOTTING_POSITION_METHODS)
@pytest.mark.parametrize('method', ['RRX', 'RRY'])
def test_rank_fit_matches_independent_transformed_regression(rank_method, method):
    failures = np.array([3., 5, 8, 10, 14, 20])
    probabilities = plotting_positions(failures, [6, 21], rank_method)
    mask = (probabilities > 0) & (probabilities < 1)
    x = np.log(failures[mask])
    y = np.log(-np.log1p(-probabilities[mask]))
    if method == 'RRX':
        slope, intercept, *_ = stats.linregress(y, x)
        beta, eta = 1 / slope, np.exp(intercept)
    else:
        slope, intercept, *_ = stats.linregress(x, y)
        beta, eta = slope, np.exp(-intercept / slope)
    fit = Fit_Weibull_2P(failures, [6, 21], method=method, rank_method=rank_method)
    np.testing.assert_allclose([fit.eta, fit.beta], [eta, beta], rtol=1e-13)
    assert fit.rank_method == rank_method
    scaled = Fit_Weibull_2P(failures * 3600, np.array([6, 21]) * 3600,
                          method=method, rank_method=rank_method)
    np.testing.assert_allclose([scaled.eta / 3600, scaled.beta], [eta, beta], rtol=1e-12)


def test_rank_bootstrap_refits_keep_the_selected_rank_scheme(monkeypatch):
    seen = []
    original = Fit_Normal_2P.__init__

    def record(self, *args, **kwargs):
        seen.append(kwargs.get('rank_method', 'benard'))
        original(self, *args, **kwargs)

    fit = Fit_Normal_2P([1, 2, 3, 4, 5, 8], method='RRY', rank_method='hazen')
    monkeypatch.setattr(Fit_Normal_2P, '__init__', record)
    package = parametric_bootstrap_package(fit, [2, 4, 6], n_bootstrap=20, seed=57)
    assert len(seen) == 20 and set(seen) == {'hazen'}
    assert package['confidence']['n_successful'] == 20


@pytest.mark.parametrize('beta,scale', [(60., 1e6), (12., 1e-30), (2.5, 1e100)])
@pytest.mark.parametrize('states', [['F', 'S', 'S'], ['F', 'F', 'F'], ['S', 'S', 'S']])
def test_weibayes_is_invariant_to_exposure_units_without_power_overflow(beta, scale, states):
    base = weibayes_fit([1, 2, 3], states, beta, CI=.9)
    converted = weibayes_fit(np.array([1, 2, 3]) * scale, states, beta, CI=.9)
    for field in ('eta', 'eta_lower', 'eta_upper'):
        if base[field] is None:
            assert converted[field] is None
        else:
            assert converted[field] / scale == pytest.approx(base[field], rel=2e-13)
    assert converted['confidence']['sample_design'] == base['confidence']['sample_design']
    expected_log_sum = logsumexp(beta * np.log(np.array([1, 2, 3]) * scale))
    assert converted['log_sum_tb'] == pytest.approx(expected_log_sum)


def test_mixed_exponential_matches_an_independent_joint_likelihood():
    rows = [
        MixedLifeObservation('failure', time=2, count=2),
        MixedLifeObservation('failure', time=5),
        MixedLifeObservation('right_censored', time=8, count=3),
        MixedLifeObservation('left_censored', upper=3, count=2),
        MixedLifeObservation('interval_censored', lower=4, upper=7, count=4),
    ]

    def nll(log_rate):
        rate = np.exp(log_rate)
        return -(3 * np.log(rate) - rate * (2 * 2 + 5 + 3 * 8)
                 + 2 * np.log(-np.expm1(-3 * rate))
                 + 4 * (-4 * rate + np.log(-np.expm1(-3 * rate))))

    independent = optimize.minimize_scalar(nll, bounds=(-10, 5), method='bounded',
                                           options={'xatol': 1e-13})
    fit = fit_grouped_life('mixed', rows, 'Exponential_1P')
    assert fit.Lambda == pytest.approx(np.exp(independent.x), rel=1e-6)
    assert fit.loglik == pytest.approx(-independent.fun, rel=1e-11)
    assert (fit.n, fit.n_failures, fit.n_censored) == (12, 9, 3)
    assert fit.fit_eligible
    assert fit.confidence_metadata['available'] is False
    assert fit.confidence_metadata['sample_design'] == 'mixed'


def test_mixed_exact_only_keeps_exact_frequency_estimate_and_inference():
    mixed = [MixedLifeObservation('failure', time=t, count=n)
             for t, n in [(2., 3), (4., 5), (8., 2)]]
    exact = [FrequencyObservation(row.time, 'F', row.count) for row in mixed]
    a = fit_grouped_life('mixed', mixed, 'Exponential_1P')
    b = fit_grouped_life('frequency_exact', exact, 'Exponential_1P')
    assert a.params == b.params
    assert a.loglik == b.loglik
    assert a.confidence_metadata == b.confidence_metadata


def test_mixed_weibull_likelihood_scales_only_exact_density_terms():
    def observations(scale):
        return [MixedLifeObservation('failure', time=3 * scale, count=2),
                MixedLifeObservation('failure', time=8 * scale, count=3),
                MixedLifeObservation('interval_censored', lower=5 * scale, upper=7 * scale, count=2),
                MixedLifeObservation('left_censored', upper=4 * scale),
                MixedLifeObservation('right_censored', time=9 * scale, count=2)]

    base = fit_grouped_life('mixed', observations(1), 'Weibull_2P')
    scaled = fit_grouped_life('mixed', observations(3600), 'Weibull_2P')
    assert base.fit_eligible and scaled.fit_eligible
    np.testing.assert_allclose([scaled.eta / 3600, scaled.beta], [base.eta, base.beta], rtol=2e-5)
    # Exactly five replicated observations contribute densities (unit^-1).
    assert scaled.loglik == pytest.approx(base.loglik - 5 * np.log(3600), abs=1e-8)


@pytest.mark.parametrize('row', [
    MixedLifeObservation('failure', time=2, upper=2),
    MixedLifeObservation('failure', time=0),
    MixedLifeObservation('interval_censored', lower=2, upper=2),
    MixedLifeObservation('left_censored', upper=3, lower=0),
    MixedLifeObservation('right_censored', time=np.inf),
    MixedLifeObservation('failure', time=2, count=1.5),
])
def test_mixed_observation_validation_does_not_approximate_invalid_rows(row):
    with pytest.raises(ValueError):
        validate_mixed_observations([row, MixedLifeObservation('failure', time=3, count=2)])
