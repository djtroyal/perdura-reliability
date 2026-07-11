"""Tests for reliability.Distributions."""

import numpy as np
import pytest
from reliability.Distributions import (
    Weibull_Distribution,
    Exponential_Distribution,
    Normal_Distribution,
    Lognormal_Distribution,
    Gamma_Distribution,
    Loglogistic_Distribution,
    Beta_Distribution,
    Gumbel_Distribution,
    DISTRIBUTION_CLASSES,
)


# --- Weibull ---

def test_weibull_cdf_bounds():
    d = Weibull_Distribution(eta=100, beta=2)
    t = np.linspace(1, 300, 50)
    cdf = d._cdf(t)
    assert np.all(cdf >= 0) and np.all(cdf <= 1)


def test_weibull_sf_complement():
    d = Weibull_Distribution(eta=100, beta=2)
    t = np.array([50.0, 100.0, 200.0])
    np.testing.assert_allclose(d._cdf(t) + d._sf(t), 1.0)


def test_weibull_pdf_integrates():
    from scipy.integrate import quad
    d = Weibull_Distribution(eta=100, beta=2)
    integral, _ = quad(lambda t: d._pdf(np.array([t]))[0], 0, 1e4)
    assert abs(integral - 1.0) < 0.01


def test_weibull_hf_positive():
    d = Weibull_Distribution(eta=100, beta=2)
    t = np.array([10.0, 50.0, 100.0])
    assert np.all(d._hf(t) > 0)


def test_weibull_extreme_tail_hazard_and_chf_are_not_clipped():
    d = Weibull_Distribution(eta=1, beta=2)
    t = np.array([30.0, 100.0])

    np.testing.assert_allclose(d._hf(t), [60.0, 200.0], rtol=1e-12)
    np.testing.assert_allclose(d._chf(t), [900.0, 10000.0], rtol=1e-12)
    np.testing.assert_allclose(d._logsf(t), [-900.0, -10000.0], rtol=1e-12)
    np.testing.assert_allclose(d.logSF(t), d._logsf(t), rtol=0, atol=0)


def test_weibull_quantile():
    d = Weibull_Distribution(eta=100, beta=2)
    q = d.quantile(0.5)
    # CDF at median should be ~0.5
    assert abs(d._cdf(np.array([q]))[0] - 0.5) < 1e-6


def test_weibull_random_samples():
    d = Weibull_Distribution(eta=100, beta=2)
    s = d.random_samples(50, seed=0)
    assert len(s) == 50
    assert np.all(s > 0)


def test_weibull_gamma_shift():
    d = Weibull_Distribution(eta=100, beta=2, gamma=10)
    # CDF at gamma should be 0
    assert d._cdf(np.array([10.0]))[0] == pytest.approx(0.0, abs=1e-12)


# --- Exponential ---

def test_exponential_memoryless():
    d = Exponential_Distribution(Lambda=0.01)
    t1, t2 = 100.0, 200.0
    # P(T > t1+t2) / P(T > t1) == P(T > t2)
    ratio = d._sf(np.array([t1 + t2]))[0] / d._sf(np.array([t1]))[0]
    assert ratio == pytest.approx(d._sf(np.array([t2]))[0], rel=1e-9)


def test_exponential_gamma():
    d = Exponential_Distribution(Lambda=0.01, gamma=50)
    assert d._cdf(np.array([50.0]))[0] == pytest.approx(0.0, abs=1e-12)
    assert d._cdf(np.array([49.0]))[0] == 0.0  # below gamma


# --- Normal ---

def test_normal_symmetric():
    d = Normal_Distribution(mu=100, sigma=15)
    assert d._cdf(np.array([100.0]))[0] == pytest.approx(0.5, abs=1e-10)


def test_normal_sf_complement():
    d = Normal_Distribution(mu=50, sigma=10)
    t = np.array([30.0, 50.0, 70.0])
    np.testing.assert_allclose(d._cdf(t) + d._sf(t), 1.0)


# --- Lognormal ---

def test_lognormal_positive_support():
    d = Lognormal_Distribution(mu=4, sigma=0.5)
    assert d._cdf(np.array([0.0]))[0] == pytest.approx(0.0, abs=1e-10)


# --- Gamma ---

def test_gamma_sf_complement():
    d = Gamma_Distribution(alpha=2, beta=50)
    t = np.array([10.0, 50.0, 200.0])
    np.testing.assert_allclose(d._cdf(t) + d._sf(t), 1.0)


# --- Loglogistic ---

def test_loglogistic_median():
    alpha = 100.0
    d = Loglogistic_Distribution(alpha=alpha, beta=3)
    # median of loglogistic is alpha
    assert d._cdf(np.array([alpha]))[0] == pytest.approx(0.5, abs=1e-10)


# --- Beta ---

def test_beta_support():
    d = Beta_Distribution(alpha=2, beta=5)
    assert d._cdf(np.array([0.0]))[0] == pytest.approx(0.0, abs=1e-10)
    assert d._cdf(np.array([1.0]))[0] == pytest.approx(1.0, abs=1e-10)


# --- Gumbel ---

def test_gumbel_sf_complement():
    d = Gumbel_Distribution(mu=100, sigma=20)
    t = np.array([50.0, 100.0, 150.0])
    np.testing.assert_allclose(d._cdf(t) + d._sf(t), 1.0)


# --- DISTRIBUTION_CLASSES registry ---

def test_distribution_classes_registry():
    assert 'Weibull_2P' in DISTRIBUTION_CLASSES
    assert 'Normal_2P' in DISTRIBUTION_CLASSES
    assert 'Exponential_1P' in DISTRIBUTION_CLASSES


def test_distribution_from_params():
    cls = DISTRIBUTION_CLASSES['Weibull_2P']
    d = cls._from_params([100.0, 2.0])
    assert isinstance(d, Weibull_Distribution)
