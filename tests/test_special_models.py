"""Tests for the special Weibull models (mixture, CR, DSZI, grouped)."""

import numpy as np
import pytest
from reliability.Special_models import (
    Fit_Weibull_Mixture, Fit_Weibull_CR, Fit_Weibull_DSZI,
    Fit_Weibull_DS, Fit_Weibull_ZI, Fit_Weibull_2P_grouped,
    _component_separation,
)
from reliability.Distributions import Weibull_Distribution


def _mixture_data(seed=0):
    rng = np.random.default_rng(seed)
    a = Weibull_Distribution(eta=100, beta=3).random_samples(120, seed=seed)
    b = Weibull_Distribution(eta=800, beta=2).random_samples(80, seed=seed + 1)
    return np.concatenate([a, b])


# ── Mixture ──────────────────────────────────────────────────────────────────

def test_mixture_recovers_two_scales():
    data = _mixture_data()
    fit = Fit_Weibull_Mixture(failures=data)
    # Components ordered by scale; should straddle the two true scales.
    assert fit.alpha_1 < fit.alpha_2
    assert fit.alpha_1 < 400 < fit.alpha_2
    assert np.isclose(fit.proportion_1 + fit.proportion_2, 1.0)
    assert 0 < fit.proportion_1 < 1
    assert fit.converged is True
    assert fit.identifiable is True
    assert fit.fit_eligible is True
    assert fit.identifiability_diagnostics['multistart']['stable'] is True


def test_component_collapse_has_zero_standardized_separation():
    assert _component_separation(100.0, 2.0, 100.0, 2.0) == pytest.approx(0.0)


def test_mixture_sf_monotone_and_bounded():
    fit = Fit_Weibull_Mixture(failures=_mixture_data())
    t = np.linspace(1, 2000, 200)
    sf = fit.SF(t)
    assert np.all((sf >= -1e-9) & (sf <= 1 + 1e-9))
    assert np.all(np.diff(sf) <= 1e-9)


def test_mixture_beats_single_weibull_on_bimodal():
    from reliability.Fitters import Fit_Weibull_2P
    data = _mixture_data()
    mix = Fit_Weibull_Mixture(failures=data)
    single = Fit_Weibull_2P(failures=data)
    assert mix.loglik > single.loglik   # more flexible model fits better


# ── Competing Risks ──────────────────────────────────────────────────────────

def test_competing_risks_basic():
    rng = np.random.default_rng(1)
    # min of two Weibull failure modes => competing risks
    m1 = Weibull_Distribution(eta=200, beta=2).random_samples(200, seed=1)
    m2 = Weibull_Distribution(eta=300, beta=4).random_samples(200, seed=2)
    data = np.minimum(m1, m2)
    fit = Fit_Weibull_CR(failures=data)
    assert fit.alpha_1 > 0 and fit.alpha_2 > 0
    sf = fit.SF(np.linspace(1, 500, 100))
    assert np.all(np.diff(sf) <= 1e-9)


# ── DSZI / DS / ZI ───────────────────────────────────────────────────────────

def test_ds_defective_subpopulation():
    # 60% fail (Weibull), 40% never fail (censored at end)
    rng = np.random.default_rng(2)
    fails = Weibull_Distribution(eta=100, beta=2).random_samples(60, seed=2)
    rc = np.full(40, fails.max() * 1.5)
    fit = Fit_Weibull_DS(failures=fails, right_censored=rc)
    assert fit.ZI == 0
    assert 0.4 < fit.DS < 0.8     # near the true 0.6 fraction


def test_zi_zero_inflated():
    rng = np.random.default_rng(3)
    fails = Weibull_Distribution(eta=100, beta=2).random_samples(80, seed=3)
    data = np.concatenate([np.zeros(20), fails])   # 20% dead on arrival
    fit = Fit_Weibull_ZI(failures=data)
    assert np.isclose(fit.DS, 1.0)
    assert 0.1 < fit.ZI < 0.35


def test_dszi_general_ordering():
    rng = np.random.default_rng(4)
    fails = Weibull_Distribution(eta=100, beta=2).random_samples(50, seed=4)
    data = np.concatenate([np.zeros(10), fails])
    rc = np.full(40, fails.max() * 1.5)
    fit = Fit_Weibull_DSZI(failures=data, right_censored=rc)
    assert 0 <= fit.ZI <= fit.DS <= 1
    # CDF starts at ZI and asymptotes to DS
    assert np.isclose(float(fit.CDF(0)), fit.ZI, atol=1e-6)
    assert fit.CDF(1e6) <= fit.DS + 1e-6


# ── Grouped Weibull ──────────────────────────────────────────────────────────

def test_grouped_matches_ungrouped():
    from reliability.Fitters import Fit_Weibull_2P
    rng = np.random.default_rng(5)
    raw = np.round(Weibull_Distribution(eta=50, beta=2).random_samples(300, seed=5))
    raw = raw[raw > 0]
    times, counts = np.unique(raw, return_counts=True)
    grouped = Fit_Weibull_2P_grouped(failures=times, failure_quantities=counts)
    ungrouped = Fit_Weibull_2P(failures=raw)
    assert np.isclose(grouped.alpha, ungrouped.eta, rtol=0.02)
    assert np.isclose(grouped.beta, ungrouped.beta, rtol=0.02)


def test_grouped_with_censoring():
    grouped = Fit_Weibull_2P_grouped(
        failures=[10, 20, 30], failure_quantities=[5, 8, 3],
        right_censored=[40], right_censored_quantities=[10])
    assert grouped.alpha > 0 and grouped.beta > 0
    assert grouped.n == 26


def test_grouped_validation():
    with pytest.raises(ValueError):
        Fit_Weibull_2P_grouped(failures=[1, 2], failure_quantities=[1])
