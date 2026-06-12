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
