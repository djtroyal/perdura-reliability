"""Tests for reliability.Probability_plotting."""

import numpy as np
import pytest
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from reliability.Probability_plotting import (
    Weibull_probability_plot,
    Normal_probability_plot,
    Lognormal_probability_plot,
    Exponential_probability_plot,
    Gamma_probability_plot,
    Loglogistic_probability_plot,
    Beta_probability_plot,
    Gumbel_probability_plot,
)


@pytest.fixture(autouse=True)
def close_plots():
    yield
    plt.close('all')


def test_weibull_plot_returns_arrays(weibull_data):
    x, y = Weibull_probability_plot(weibull_data, show_plot=False)
    assert len(x) == len(weibull_data)
    assert len(y) == len(weibull_data)


def test_normal_plot_returns_arrays(normal_data):
    x, y = Normal_probability_plot(normal_data, show_plot=False)
    assert len(x) == len(normal_data)


def test_lognormal_plot(lognormal_data):
    x, y = Lognormal_probability_plot(lognormal_data, show_plot=False)
    assert len(x) == len(lognormal_data)


def test_exponential_plot(exponential_data):
    x, y = Exponential_probability_plot(exponential_data, show_plot=False)
    assert len(x) == len(exponential_data)


def test_gamma_plot(weibull_data):
    x, y = Gamma_probability_plot(weibull_data, show_plot=False)
    assert len(x) == len(weibull_data)


def test_loglogistic_plot(weibull_data):
    x, y = Loglogistic_probability_plot(weibull_data, show_plot=False)
    assert len(x) == len(weibull_data)


def test_beta_plot():
    rng = np.random.default_rng(5)
    data = rng.beta(2.0, 5.0, size=20)
    x, y = Beta_probability_plot(data, show_plot=False)
    assert len(x) == len(data)


def test_gumbel_plot(normal_data):
    x, y = Gumbel_probability_plot(normal_data, show_plot=False)
    assert len(x) == len(normal_data)


def test_weibull_plot_with_censored(weibull_data_with_censored):
    failures, censored = weibull_data_with_censored
    x, y = Weibull_probability_plot(failures, right_censored=censored, show_plot=False)
    assert len(x) == len(failures)


def test_plot_with_fitted_distribution(weibull_data):
    from reliability.Distributions import Weibull_Distribution
    dist = Weibull_Distribution(eta=100, beta=2)
    fig, ax = plt.subplots()
    x, y = Weibull_probability_plot(weibull_data, dist=dist, show_plot=True)
    assert len(ax.lines) >= 1  # fitted line was drawn
    plt.close('all')


def test_gumbel_plot_is_linear_for_gumbel_data():
    # Regression for the probability-paper fix: Gumbel_Distribution is the
    # minimum-EV form, so gumbel_l data must plot near-linear. On the old
    # (maximum-EV) transform this sample scores R^2 ~ 0.74.
    from scipy import stats as ss
    rng = np.random.default_rng(3)
    data = ss.gumbel_l.rvs(loc=100, scale=10, size=200, random_state=rng)
    x, y = Gumbel_probability_plot(data, show_plot=False)
    r = ss.linregress(x, y).rvalue
    assert r ** 2 > 0.95


def test_probability_plot_shifts_by_gamma_for_3p_fit():
    # A 3P fit is linear on the paper of (t - gamma); the plot must subtract
    # the fitted location shift instead of drawing a curved "perfect fit".
    from scipy import stats as ss
    from reliability.Fitters import Fit_Weibull_3P
    rng = np.random.default_rng(8)
    data = 500 + 100 * rng.weibull(2.0, 120)
    fit = Fit_Weibull_3P(failures=data, show_probability_plot=False)
    x, y = Weibull_probability_plot(data, dist=fit.distribution, show_plot=False)
    r = ss.linregress(x, y).rvalue
    assert r ** 2 > 0.95
    # Shifted x must match ln(t - gamma) for the retained points
    t = np.sort(data)
    t = t[t > fit.distribution.gamma]
    np.testing.assert_allclose(x, np.log(t - fit.distribution.gamma), rtol=1e-12)
