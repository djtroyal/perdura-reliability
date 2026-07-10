"""Tests for confidence intervals on fitted distributions.

Covers the Utils-level covariance/CI/bounds helpers and their integration into
the Fitters (parameter CIs, function confidence bounds, Fit_Everything passthrough).
"""

import numpy as np
import pytest

from reliability.Distributions import Weibull_Distribution, Normal_Distribution
from reliability.Fitters import (
    Fit_Weibull_2P, Fit_Normal_2P, Fit_Lognormal_2P, Fit_Exponential_1P,
    Fit_Everything,
)
from reliability.Utils import (
    numerical_hessian, fisher_information_covariance,
    parameter_confidence_intervals, distribution_confidence_bounds,
)


@pytest.fixture
def weibull_sample():
    return Weibull_Distribution(eta=100, beta=2.0).random_samples(200, seed=7)


# --- Utils-level helpers -----------------------------------------------------

class TestNumericalHessian:
    def test_known_quadratic(self):
        # f(x) = x0^2 + 3*x1^2  ->  Hessian = [[2, 0], [0, 6]]
        f = lambda x: x[0] ** 2 + 3 * x[1] ** 2
        H = numerical_hessian(f, [1.0, 1.0])
        np.testing.assert_allclose(H, [[2, 0], [0, 6]], atol=1e-3)

    def test_returns_none_on_nonfinite(self):
        f = lambda x: np.inf
        assert numerical_hessian(f, [1.0]) is None


class TestParameterConfidenceIntervals:
    def test_none_cov_yields_nan(self):
        ci = parameter_confidence_intervals([1.0, 2.0], None, [True, True])
        assert np.all(np.isnan(ci['se']))
        assert np.all(np.isnan(ci['lower']))
        assert np.all(np.isnan(ci['upper']))

    def test_positive_param_bounds_stay_positive(self):
        cov = np.array([[0.25, 0.0], [0.0, 0.25]])  # SE = 0.5 each
        ci = parameter_confidence_intervals([1.0, 2.0], cov, [True, True], CI=0.95)
        assert np.all(ci['lower'] > 0)
        assert ci['lower'][0] < 1.0 < ci['upper'][0]

    def test_unbounded_param_is_symmetric(self):
        cov = np.array([[4.0, 0.0], [0.0, 0.25]])  # SE = 2.0, 0.5
        ci = parameter_confidence_intervals([10.0, 2.0], cov, [False, True], CI=0.95)
        # mu is unbounded -> symmetric about the estimate
        assert ci['upper'][0] - 10.0 == pytest.approx(10.0 - ci['lower'][0], rel=1e-9)


class TestDistributionConfidenceBounds:
    def test_none_cov_returns_none(self):
        lo, hi = distribution_confidence_bounds(
            Weibull_Distribution, [100.0, 2.0], None, np.array([50.0, 100.0]))
        assert lo is None and hi is None

    def test_bounds_bracket_sf_and_within_unit_interval(self):
        cov = fisher_information_covariance([100.0, 2.0], Weibull_Distribution,
                                            Weibull_Distribution(100, 2).random_samples(150, seed=3))
        x = np.linspace(10, 250, 40)
        lo, hi = distribution_confidence_bounds(Weibull_Distribution, [100.0, 2.0], cov, x)
        sf = Weibull_Distribution(eta=100, beta=2.0)._sf(x)
        assert np.all(lo >= 0) and np.all(hi <= 1)
        assert np.all(lo <= sf + 1e-9) and np.all(sf <= hi + 1e-9)


# --- Fitter integration ------------------------------------------------------

class TestParameterCIsOnFitters:
    def test_weibull_ordering_and_positivity(self, weibull_sample):
        fit = Fit_Weibull_2P(failures=weibull_sample)
        assert fit.eta_lower < fit.eta < fit.eta_upper
        assert fit.beta_lower < fit.beta < fit.beta_upper
        assert fit.eta_lower > 0 and fit.beta_lower > 0
        assert fit.covariance_matrix.shape == (2, 2)

    def test_results_has_ci_columns(self, weibull_sample):
        fit = Fit_Weibull_2P(failures=weibull_sample)
        for col in ('Standard Error', 'Lower CI', 'Upper CI'):
            assert col in fit.results.columns

    def test_normal_mu_can_be_unbounded(self):
        data = Normal_Distribution(mu=100, sigma=10).random_samples(120, seed=5)
        fit = Fit_Normal_2P(failures=data)
        assert fit.mu_lower < fit.mu < fit.mu_upper
        assert fit.sigma_lower > 0

    def test_lognormal_has_cis(self):
        from reliability.Distributions import Lognormal_Distribution
        data = Lognormal_Distribution(mu=4, sigma=0.5).random_samples(120, seed=6)
        fit = Fit_Lognormal_2P(failures=data)
        assert fit.sigma_lower < fit.sigma < fit.sigma_upper
        assert fit.sigma_lower > 0

    def test_exponential_se_matches_analytic(self, weibull_sample):
        # MLE SE(Lambda) for the exponential is Lambda / sqrt(num_failures)
        fit = Fit_Exponential_1P(failures=weibull_sample)
        expected = fit.Lambda / np.sqrt(len(weibull_sample))
        assert fit.Lambda_SE == pytest.approx(expected, rel=1e-3)


class TestFunctionConfidenceBounds:
    def test_sf_bounds_bracket_curve(self, weibull_sample):
        fit = Fit_Weibull_2P(failures=weibull_sample)
        x, lo, hi = fit.confidence_bounds(func='SF')
        sf = fit.distribution._sf(x)
        assert np.all(lo <= sf + 1e-9) and np.all(sf <= hi + 1e-9)
        assert np.all(lo >= 0) and np.all(hi <= 1)

    def test_cdf_bounds_are_complement(self, weibull_sample):
        fit = Fit_Weibull_2P(failures=weibull_sample)
        x = np.linspace(20, 200, 30)
        _, sf_lo, sf_hi = fit.confidence_bounds(xvals=x, func='SF')
        _, cdf_lo, cdf_hi = fit.confidence_bounds(xvals=x, func='CDF')
        np.testing.assert_allclose(cdf_lo, 1 - sf_hi, atol=1e-9)
        np.testing.assert_allclose(cdf_hi, 1 - sf_lo, atol=1e-9)

    def test_higher_ci_is_wider(self, weibull_sample):
        x = np.linspace(20, 200, 30)
        _, lo90, hi90 = Fit_Weibull_2P(failures=weibull_sample, CI=0.90).confidence_bounds(xvals=x)
        _, lo99, hi99 = Fit_Weibull_2P(failures=weibull_sample, CI=0.99).confidence_bounds(xvals=x)
        assert np.mean(hi99 - lo99) > np.mean(hi90 - lo90)


class TestCoverageAndRobustness:
    def test_true_params_within_ci_large_sample(self):
        # With n=500 the 95% CI should comfortably contain the true parameters.
        data = Weibull_Distribution(eta=100, beta=2.0).random_samples(500, seed=11)
        fit = Fit_Weibull_2P(failures=data, CI=0.95)
        assert fit.eta_lower <= 100 <= fit.eta_upper
        assert fit.beta_lower <= 2.0 <= fit.beta_upper

    def test_degenerate_input_does_not_raise(self):
        # Near-degenerate data may yield an unusable Hessian; CIs become NaN
        # but the fit must not raise. The numerical Hessian probes can overflow
        # scipy's Weibull pdf, which is expected here.
        import warnings
        with warnings.catch_warnings(), np.errstate(over='ignore', invalid='ignore'):
            warnings.simplefilter('ignore')
            fit = Fit_Weibull_2P(failures=[100.0, 100.0, 100.0001])
        assert hasattr(fit, 'covariance_matrix')
        # SE is either finite or NaN, never an exception
        assert np.isnan(fit.eta_SE) or fit.eta_SE >= 0


class TestFitEverythingPassthrough:
    def test_ci_threaded_to_members(self, weibull_sample):
        fe = Fit_Everything(
            failures=weibull_sample, CI=0.9,
            distributions_to_fit=['Weibull_2P', 'Normal_2P'])
        assert fe.CI == 0.9
        assert fe.fitted['Weibull_2P'].CI == 0.9
        assert hasattr(fe.fitted['Weibull_2P'], 'eta_lower')


class TestBandMetricRegrouping:
    """Guard the CI-band linearizing-metric regrouping (Loglogistic -> logit,
    Gumbel -> cloglog): bounds must stay in (0,1) and bracket the SF."""

    def test_loglogistic_bounds_bracket_sf(self):
        from reliability.Fitters import Fit_Loglogistic_2P
        from scipy import stats as ss
        rng = np.random.default_rng(21)
        data = ss.fisk.rvs(c=3.0, scale=50.0, size=80, random_state=rng)
        fit = Fit_Loglogistic_2P(failures=data)
        x, lo, hi = fit.confidence_bounds(xvals=np.linspace(5, 200, 50))
        assert lo is not None
        # The band is built around SF clipped to [1e-10, 1-1e-10]; compare
        # against the same clipped value in the extreme tails.
        sf = np.clip(fit.distribution._sf(x), 1e-10, 1 - 1e-10)
        assert np.all((lo >= 0) & (hi <= 1) & (lo <= sf + 1e-12) & (hi >= sf - 1e-12))

    def test_gumbel_bounds_bracket_sf(self):
        from reliability.Fitters import Fit_Gumbel_2P
        from scipy import stats as ss
        rng = np.random.default_rng(22)
        data = ss.gumbel_l.rvs(loc=100, scale=10, size=80, random_state=rng)
        fit = Fit_Gumbel_2P(failures=data)
        x, lo, hi = fit.confidence_bounds(xvals=np.linspace(50, 130, 50))
        assert lo is not None
        sf = np.clip(fit.distribution._sf(x), 1e-10, 1 - 1e-10)
        assert np.all((lo >= 0) & (hi <= 1) & (lo <= sf + 1e-12) & (hi >= sf - 1e-12))
