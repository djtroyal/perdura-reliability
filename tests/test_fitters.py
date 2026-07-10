"""Tests for reliability.Fitters."""

import numpy as np
import pytest
from reliability.Fitters import (
    Fit_Weibull_2P,
    Fit_Weibull_3P,
    Fit_Exponential_1P,
    Fit_Exponential_2P,
    Fit_Normal_2P,
    Fit_Lognormal_2P,
    Fit_Gamma_2P,
    Fit_Loglogistic_2P,
    Fit_Beta_2P,
    Fit_Gumbel_2P,
    Fit_Everything,
)
from reliability.Distributions import Weibull_Distribution


# --- Weibull 2P ---

def test_weibull_2p_mle(weibull_data):
    fit = Fit_Weibull_2P(failures=weibull_data, method='MLE', show_probability_plot=False)
    assert hasattr(fit, 'eta')
    assert hasattr(fit, 'beta')
    assert fit.eta > 0
    assert fit.beta > 0


def test_weibull_2p_ls(weibull_data):
    fit = Fit_Weibull_2P(failures=weibull_data, method='LS', show_probability_plot=False)
    assert fit.eta > 0
    assert fit.beta > 0


def test_weibull_2p_with_censored(weibull_data_with_censored):
    failures, censored = weibull_data_with_censored
    fit = Fit_Weibull_2P(failures=failures, right_censored=censored,
                         method='MLE', show_probability_plot=False)
    assert fit.eta > 0
    assert fit.beta > 0


def test_weibull_2p_has_goodness_of_fit(weibull_data):
    fit = Fit_Weibull_2P(failures=weibull_data, show_probability_plot=False)
    assert hasattr(fit, 'AICc')
    assert hasattr(fit, 'BIC')
    assert hasattr(fit, 'AD')


def test_weibull_2p_distribution_attr(weibull_data):
    fit = Fit_Weibull_2P(failures=weibull_data, show_probability_plot=False)
    assert hasattr(fit, 'distribution')
    assert isinstance(fit.distribution, Weibull_Distribution)


# --- Weibull 3P ---

def test_weibull_3p(weibull_data):
    fit = Fit_Weibull_3P(failures=weibull_data, show_probability_plot=False)
    assert fit.eta > 0
    assert fit.beta > 0
    assert fit.gamma >= 0


# --- Exponential ---

def test_exponential_1p(exponential_data):
    fit = Fit_Exponential_1P(failures=exponential_data, show_probability_plot=False)
    assert fit.Lambda > 0


def test_exponential_2p(exponential_data):
    fit = Fit_Exponential_2P(failures=exponential_data, show_probability_plot=False)
    assert fit.Lambda > 0
    assert fit.gamma >= 0


# --- Normal ---

def test_normal_2p(normal_data):
    fit = Fit_Normal_2P(failures=normal_data, show_probability_plot=False)
    assert fit.mu == pytest.approx(100.0, abs=10)
    assert fit.sigma > 0


# --- Lognormal ---

def test_lognormal_2p(lognormal_data):
    fit = Fit_Lognormal_2P(failures=lognormal_data, show_probability_plot=False)
    assert fit.mu == pytest.approx(4.0, abs=0.5)
    assert fit.sigma > 0


# --- Gamma ---

def test_gamma_2p(weibull_data):
    fit = Fit_Gamma_2P(failures=weibull_data, show_probability_plot=False)
    assert fit.alpha > 0
    assert fit.beta > 0


# --- Loglogistic ---

def test_loglogistic_2p(weibull_data):
    fit = Fit_Loglogistic_2P(failures=weibull_data, show_probability_plot=False)
    assert fit.alpha > 0
    assert fit.beta > 0


# --- Beta ---

def test_beta_2p():
    rng = np.random.default_rng(5)
    data = rng.beta(2.0, 5.0, size=30)
    fit = Fit_Beta_2P(failures=data, show_probability_plot=False)
    assert fit.alpha > 0
    assert fit.beta > 0


# --- Gumbel ---

def test_gumbel_2p(normal_data):
    fit = Fit_Gumbel_2P(failures=normal_data, show_probability_plot=False)
    assert fit.mu is not None
    assert fit.sigma > 0


# --- Fit_Everything ---

def test_fit_everything_returns_results(weibull_data):
    fe = Fit_Everything(failures=weibull_data, show_probability_plot=False,
                        show_histogram_plot=False)
    assert hasattr(fe, 'results')
    assert len(fe.results) > 0


def test_fit_everything_sorted(weibull_data):
    fe = Fit_Everything(failures=weibull_data, show_probability_plot=False,
                        show_histogram_plot=False, sort_by='BIC')
    bics = fe.results['BIC'].tolist()
    assert bics == sorted(bics)


def test_fit_everything_best_distribution(weibull_data):
    fe = Fit_Everything(failures=weibull_data, show_probability_plot=False,
                        show_histogram_plot=False)
    assert hasattr(fe, 'best_distribution')
    assert fe.best_distribution is not None


def test_fit_everything_select_distributions(weibull_data):
    fe = Fit_Everything(failures=weibull_data,
                        distributions_to_fit=['Weibull_2P', 'Normal_2P'],
                        show_probability_plot=False,
                        show_histogram_plot=False)
    dist_names = set(fe.results['Distribution'].tolist())
    assert dist_names == {'Weibull_2P', 'Normal_2P'}


# ---------------------------------------------------------------------------
# Regression: MLE at large parameter scales (issue: L-BFGS-B terminated early
# on hour-scale data because eta ~ 5e4 and beta ~ 3 shared one absolute
# finite-difference step; the "successful" result was visibly off while rank
# regression looked fine). The optimizer now runs in scaled parameter space
# with a simplex polish; the MLE must match scipy's reference optimizer.
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("eta_true,beta_true,n", [
    (100, 2.0, 100),
    (50_000, 3.0, 30),
    (2_000_000, 1.5, 40),
    (0.5, 4.0, 60),
])
def test_weibull_mle_matches_scipy_at_any_scale(eta_true, beta_true, n):
    from scipy import stats
    rng = np.random.default_rng(42)
    data = eta_true * rng.weibull(beta_true, n)
    fit = Fit_Weibull_2P(failures=data, method='MLE', show_probability_plot=False)
    c_ref, _, scale_ref = stats.weibull_min.fit(data, floc=0)
    assert fit.beta == pytest.approx(c_ref, rel=1e-3)
    assert fit.eta == pytest.approx(scale_ref, rel=1e-3)


def test_weibull_mle_large_scale_censored():
    rng = np.random.default_rng(7)
    t = 30_000 * rng.weibull(2.5, 200)
    cutoff = np.quantile(t, 0.6)
    failures = t[t <= cutoff]
    censored = np.full(int((t > cutoff).sum()), cutoff)
    fit = Fit_Weibull_2P(failures=failures, right_censored=censored,
                         method='MLE', show_probability_plot=False)
    assert fit.eta == pytest.approx(30_000, rel=0.10)
    assert fit.beta == pytest.approx(2.5, rel=0.10)
