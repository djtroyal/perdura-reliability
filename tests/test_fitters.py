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


# ---------------------------------------------------------------------------
# Rank-regression correctness: LS branches for Gumbel/Loglogistic/Exp_2P,
# through-origin Exponential_1P, and honest reporting of the method actually
# used (Gamma/Beta have no linearizing paper and silently used MLE before).
# ---------------------------------------------------------------------------

def test_gumbel_rry_recovers_params():
    from scipy import stats as ss
    rng = np.random.default_rng(11)
    data = ss.gumbel_l.rvs(loc=100, scale=10, size=300, random_state=rng)
    fit = Fit_Gumbel_2P(failures=data, method='RRY', show_probability_plot=False)
    assert fit.method == 'RRY'
    assert fit.mu == pytest.approx(100, rel=0.05)
    assert fit.sigma == pytest.approx(10, rel=0.15)


def test_loglogistic_rrx_recovers_params():
    from scipy import stats as ss
    rng = np.random.default_rng(12)
    data = ss.fisk.rvs(c=3.0, scale=50.0, size=300, random_state=rng)
    fit = Fit_Loglogistic_2P(failures=data, method='RRX', show_probability_plot=False)
    assert fit.method == 'RRX'
    assert fit.alpha == pytest.approx(50, rel=0.10)
    assert fit.beta == pytest.approx(3.0, rel=0.15)


def test_exponential_2p_rry_recovers_params():
    rng = np.random.default_rng(13)
    data = 20 + rng.exponential(50, 400)
    fit = Fit_Exponential_2P(failures=data, method='RRY', show_probability_plot=False)
    assert fit.method == 'RRY'
    assert 1.0 / fit.Lambda == pytest.approx(50, rel=0.15)
    assert fit.gamma == pytest.approx(20, abs=10)


def test_exponential_1p_ls_through_origin():
    # The 1P paper -ln(1-F) = lambda*t has no intercept; the LS slope must be
    # the closed-form through-origin estimate sum(x*y)/sum(x^2).
    from reliability.Utils import rank_adjustment, median_rank_approximation
    rng = np.random.default_rng(14)
    data = rng.exponential(50, 60)
    fit = Fit_Exponential_1P(failures=data, method='RRY', show_probability_plot=False)
    ranks, n = rank_adjustment(data)
    F = np.clip(median_rank_approximation(ranks, n), 1e-10, 1 - 1e-10)
    x = np.sort(data)
    y = -np.log(1 - F)
    assert fit.Lambda == pytest.approx(np.sum(x * y) / np.sum(x * x), rel=1e-12)
    assert fit.method == 'RRY'


def test_gamma_beta_ls_fall_back_to_mle():
    rng = np.random.default_rng(15)
    g = rng.gamma(2.0, 30.0, 60)
    fit_rrx = Fit_Gamma_2P(failures=g, method='RRX', show_probability_plot=False)
    fit_mle = Fit_Gamma_2P(failures=g, method='MLE', show_probability_plot=False)
    assert fit_rrx.method == 'MLE'
    assert fit_rrx.alpha == pytest.approx(fit_mle.alpha)
    b = rng.beta(2.0, 5.0, 60)
    assert Fit_Beta_2P(failures=b, method='RRY', show_probability_plot=False).method == 'MLE'


def test_fit_everything_reports_actual_method():
    rng = np.random.default_rng(16)
    data = 100 * rng.weibull(2.0, 50)
    fe = Fit_Everything(failures=data, method='RRX', show_probability_plot=False,
                        show_histogram_plot=False)
    methods = dict(zip(fe.results['Distribution'], fe.results['Method']))
    assert methods['Weibull_2P'] == 'RRX'
    assert methods['Gumbel_2P'] == 'RRX'
    assert methods['Gamma_2P'] == 'MLE'
    assert methods['Beta_2P'] == 'MLE'
    assert methods['Weibull_3P'] == 'MLE'  # 3P always ends in a full MLE


# ---------------------------------------------------------------------------
# Fit_Everything progress_callback
# ---------------------------------------------------------------------------

def test_fit_everything_progress_callback(weibull_data):
    dists = ['Weibull_2P', 'Normal_2P', 'Lognormal_2P', 'Gamma_2P', 'Gumbel_2P']
    calls = []
    fe = Fit_Everything(failures=weibull_data, distributions_to_fit=dists,
                        show_probability_plot=False, show_histogram_plot=False,
                        progress_callback=lambda d, t, n: calls.append((d, t, n)))
    assert [c[0] for c in calls] == list(range(1, len(dists) + 1))
    assert all(c[1] == len(dists) for c in calls)
    assert sorted(c[2] for c in calls) == sorted(dists)
    # Results are unaffected by the callback (order preserved, all fitted)
    assert set(fe.results['Distribution']) == set(dists)


def test_fit_everything_broken_callback_does_not_raise(weibull_data):
    def bad(done, total, name):
        raise RuntimeError('boom')
    fe = Fit_Everything(failures=weibull_data,
                        distributions_to_fit=['Weibull_2P', 'Normal_2P'],
                        show_probability_plot=False, show_histogram_plot=False,
                        progress_callback=bad)
    assert fe.best_distribution is not None
