"""Independent analytic and distributional oracles for lifetime planning."""
import math
import numpy as np
import pytest
from scipy import stats, integrate
from reliability.Distributions import Weibull_Distribution, Exponential_Distribution, Beta_Distribution, Normal_Distribution, Loglogistic_Distribution
from reliability.Life_metrics import mean_remaining_life
from reliability.Lifetime_tools import survival_matrix, mechanical_equivalent_rate, inspection_failure_prediction
from reliability.Repairable_systems import _age_metrics


def test_conditional_mean_reference_and_distinct_median():
    assert mean_remaining_life(Weibull_Distribution(13, 2), 6.5) == pytest.approx(7.093337689945608, rel=1e-13)
    assert mean_remaining_life(Exponential_Distribution(.2, gamma=5), 2) == pytest.approx(8)
    assert mean_remaining_life(Exponential_Distribution(.2), 1e8) == pytest.approx(5)
    assert mean_remaining_life(Beta_Distribution(1, 1), .8) == pytest.approx(.1)
    assert math.isinf(mean_remaining_life(Loglogistic_Distribution(alpha=1, beta=.8), 2))
    with pytest.raises(ValueError):
        mean_remaining_life(Beta_Distribution(1, 1), 1)


def test_conditional_normal_mean_matches_truncated_normal():
    mu, sigma, age = 10, 2, 12
    z = (age - mu) / sigma
    oracle = mu + sigma * stats.norm.pdf(z) / stats.norm.sf(z) - age
    assert mean_remaining_life(Normal_Distribution(mu, sigma), age) == pytest.approx(oracle, rel=1e-9)


def test_conditional_weibull_deep_tail_and_scale_invariance():
    for scale in [1e-20, 1, 1e20]:
        assert mean_remaining_life(Weibull_Distribution(13*scale, 2), 6.5*scale) / scale == pytest.approx(7.093337689945608)
    # Weibull beta=2 upper-gamma tail agrees with erfcx exactly.
    from scipy.special import erfcx
    assert mean_remaining_life(Weibull_Distribution(1, 2), 1000) == pytest.approx(math.sqrt(math.pi)/2 * erfcx(1000), rel=1e-12)


def test_matrix_preserves_tiny_complement_and_delta_below_age_ulp():
    out = survival_matrix(Weibull_Distribution(1, 4), [1e30], [1e-92])
    assert out['survival'][0][0] == pytest.approx(math.exp(-.04), rel=1e-12)
    assert survival_matrix(Exponential_Distribution(1e-20), [0], [1])['failure'][0][0] == pytest.approx(1e-20)
    with pytest.raises(ValueError, match='2500'):
        survival_matrix(Weibull_Distribution(1, 2), list(range(51)), list(range(51)))


def test_age_replacement_matches_independent_quadrature_and_small_tail():
    eta, beta, interval = 50000, 1.3, 87600
    out = mechanical_equivalent_rate(beta, interval, eta=eta)
    cycle = integrate.quad(lambda t: stats.weibull_min.sf(t, beta, scale=eta), 0, interval)[0]
    oracle = stats.weibull_min.cdf(interval, beta, scale=eta) / cycle
    assert out['cm_per_time'] == pytest.approx(oracle, rel=1e-12)
    assert _age_metrics(1, 10, 1e12, 2, 1)['cm_per_time'] == pytest.approx(1e-24, rel=1e-13, abs=0)


def test_percentile_conversion_and_downtime_basis():
    out = mechanical_equivalent_rate(1.3, 87600, percentile_life=5000, corrective_downtime=20, preventive_downtime=10)
    assert stats.weibull_min.cdf(5000, 1.3, scale=out['eta']) == pytest.approx(.1)
    assert out['calendar_failure_rate'] < out['cm_per_time']
    assert 0 < out['availability'] < 1
    cycles = mechanical_equivalent_rate(2, 100, eta=1000, exposure_basis='non_time')
    assert cycles['calendar_failure_rate'] is None and cycles['availability'] is None
    with pytest.raises(ValueError, match='Downtime'):
        mechanical_equivalent_rate(2, 100, eta=1000, exposure_basis='non_time', corrective_downtime=1)


@pytest.mark.parametrize('n,x', [(20, 0), (20, 2), (20, 18), (20, 20), (20000, 8)])
def test_prediction_exact_beta_binomial_benchmark(n, x):
    # beta=1 and t2=2*t1 gives future conditional failure probability p1.
    # Beta-binomial is an independent exact posterior predictive oracle.
    out = inspection_failure_prediction(n, x, 1, 2, [1], prior_sensitivity=False)
    row = out['rows'][0]; interval = row['predictive_interval']
    remaining = n-x; oracle = stats.betabinom(remaining, x+.5, remaining+.5)
    assert row['posterior_predictive_mean'] == pytest.approx(remaining*(x+.5)/(n+1), rel=2e-9)
    assert interval['lower'] <= oracle.ppf(.025)
    assert interval['upper'] >= oracle.ppf(.975)
    assert oracle.cdf(interval['upper'])-oracle.cdf(interval['lower']-1) >= .95 - 1e-12
    assert interval['cdf_error_bound'] <= .0005
    if remaining:
        assert interval['lower_tail_probability_upper_bound'] <= .025
        assert interval['upper_tail_probability_upper_bound'] <= .025


def test_inspection_example_scale_and_point_prediction():
    out = inspection_failure_prediction(20000, 8, 3, 10, [3, 3.3, 3.6])
    assert out['rows'][0]['expected_additional_failures_mle'] == pytest.approx(286.17071065233415, rel=1e-12)
    assert stats.weibull_min.cdf(3,3,scale=out['rows'][0]['eta_mle']) == pytest.approx(8/20000)
    assert len(out['rows'][0]['prior_sensitivity']) == 2
    assert 'posterior_predictive' in out['interval_kind']
    assert out['rows'][2]['posterior_predictive_mean'] > out['rows'][0]['posterior_predictive_mean']


def test_inspection_zero_and_all_failures_preserve_uncertainty_semantics():
    zero = inspection_failure_prediction(100, 0, 1, 2, [2], prior_sensitivity=True)
    assert zero['rows'][0]['eta_mle'] is None
    assert zero['rows'][0]['posterior_predictive_mean'] > 0
    assert zero['rows'][0]['prior_sensitivity'][0]['mean'] != zero['rows'][0]['prior_sensitivity'][1]['mean']
    all_failed = inspection_failure_prediction(100, 100, 1, 2, [2])
    assert all_failed['rows'][0]['posterior_predictive_mean'] == 0
    assert all_failed['rows'][0]['predictive_interval']['upper'] == 0
    with pytest.raises(ValueError):
        inspection_failure_prediction(100, 101, 1, 2, [2])


def test_predictive_prior_averaged_calibration_by_exact_enumeration():
    # This is Bayesian prior-predictive calibration, not fixed-parameter
    # frequentist coverage. Enumerate both inspection counts under the model;
    # no simulation error is hidden in the acceptance tolerance.
    n, a, b, level = 12, .5, .5, .9
    coverage = 0.
    for observed in range(n+1):
        out = inspection_failure_prediction(n, observed, 1, 2, [1], level=level,
                                           prior_alpha=a, prior_beta=b, prior_sensitivity=False)
        interval = out['rows'][0]['predictive_interval']
        future = stats.betabinom(n-observed, a+observed, b+n-observed)
        conditional = future.cdf(interval['upper']) - future.cdf(interval['lower']-1)
        coverage += stats.betabinom.pmf(observed, n, a, b) * conditional
    assert level <= coverage <= 1 + 1e-12


@pytest.mark.parametrize('shape', [.5, 2, 3])
def test_nonlinear_weibull_predictive_tails_by_independent_quadrature(shape):
    n, observed, a, b, level = 20, 2, 1., 1., .9
    out = inspection_failure_prediction(n, observed, 2, 3, [shape], level=level,
                                       prior_alpha=a, prior_beta=b, prior_sensitivity=False)
    row = out['rows'][0]; interval = row['predictive_interval']; remaining = n-observed
    exponent = (3/2)**shape - 1
    def cdf(k):
        return integrate.quad(lambda p: stats.binom.cdf(k, remaining, -math.expm1(exponent*math.log1p(-p)))
                              * stats.beta.pdf(p, a+observed, b+remaining), 0, 1, epsabs=1e-11)[0]
    assert cdf(interval['lower']-1) <= (1-level)/2 + 1e-10
    assert 1-cdf(interval['upper']) <= (1-level)/2 + 1e-10
    mean = remaining * integrate.quad(lambda p: -math.expm1(exponent*math.log1p(-p))
                                     * stats.beta.pdf(p,a+observed,b+remaining),0,1,epsabs=1e-11)[0]
    assert row['posterior_predictive_mean'] == pytest.approx(mean, rel=1e-10)
