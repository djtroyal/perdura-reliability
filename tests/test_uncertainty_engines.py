"""Profile, bootstrap, and Weibayes shape-uncertainty validation."""

import numpy as np
import pytest

from reliability.Bayesian import weibayes_fit
from reliability.Distributions import Weibull_Distribution
from reliability.Fitters import Fit_Weibull_2P
from reliability.Special_models import Fit_Weibull_Mixture


def _weibull_sample(seed=1, n=60):
    return Weibull_Distribution(eta=100, beta=2).random_samples(n, seed=seed)


def test_profile_likelihood_reliability_and_life_intervals_are_complete():
    fit = Fit_Weibull_2P(_weibull_sample(seed=2))

    reliability = fit.profile_likelihood_interval(
        target="reliability", value=100.0, CI=0.90
    )
    assert reliability["complete"] is True
    assert reliability["lower"] < reliability["estimate"] < reliability["upper"]
    assert 0 < reliability["lower"] < reliability["upper"] < 1

    b10 = fit.profile_likelihood_interval(
        target="quantile", value=0.10, CI=0.90
    )
    assert b10["complete"] is True
    assert 0 < b10["lower"] < b10["estimate"] < b10["upper"]


def test_parametric_bootstrap_is_refitted_and_reproducible():
    fit = Fit_Weibull_2P(_weibull_sample(seed=3))
    first = fit.parametric_bootstrap_interval(
        target="reliability", value=100.0, CI=0.90,
        n_bootstrap=20, seed=9,
    )
    second = fit.parametric_bootstrap_interval(
        target="reliability", value=100.0, CI=0.90,
        n_bootstrap=20, seed=9,
    )

    assert first["method"] == "parametric_bootstrap_percentile"
    assert first["n_successful"] == 20
    assert first["lower"] < first["upper"]
    assert first["lower"] == pytest.approx(second["lower"])
    assert first["upper"] == pytest.approx(second["upper"])


def test_special_mixture_has_refitted_bootstrap_interval():
    first = Weibull_Distribution(eta=100, beta=3).random_samples(120, seed=11)
    second = Weibull_Distribution(eta=800, beta=2).random_samples(80, seed=12)
    fit = Fit_Weibull_Mixture(np.concatenate([first, second]))

    interval = fit.parametric_bootstrap_interval(
        value=200.0, CI=0.90, n_bootstrap=20, seed=5
    )
    assert interval["n_successful"] >= 15
    assert interval["lower"] <= interval["estimate"] <= interval["upper"]


def test_weibayes_beta_sensitivity_envelopes_nominal_reliability():
    times = [100.0, 150.0, 200.0, 250.0, 300.0, 175.0, 225.0]
    states = ["F"] * 5 + ["S"] * 2
    result = weibayes_fit(
        times, states, beta=2.5, CI=0.90,
        uncertainty_method="sensitivity", beta_lower=2.0, beta_upper=3.0,
    )

    lower = np.asarray(result["curves"]["sf_propagated_lower"])
    central = np.asarray(result["curves"]["sf"])
    upper = np.asarray(result["curves"]["sf_propagated_upper"])
    assert result["beta_assumption"] == "uncertain"
    assert np.all(lower <= central + 1e-12)
    assert np.all(central <= upper + 1e-12)
    assert result["eta_propagated_lower"] < result["eta_propagated_upper"]


def test_weibayes_bayesian_beta_propagation_is_seeded_and_finite():
    times = [100.0, 150.0, 200.0, 250.0, 300.0, 175.0, 225.0]
    states = ["F"] * 5 + ["S"] * 2
    kwargs = dict(
        beta=2.5, CI=0.90, uncertainty_method="bayesian",
        beta_sd=0.3, n_beta_samples=1000, seed=17,
    )
    first = weibayes_fit(times, states, **kwargs)
    second = weibayes_fit(times, states, **kwargs)

    assert first["eta_propagated_lower"] == pytest.approx(
        second["eta_propagated_lower"]
    )
    assert first["eta_propagated_lower"] < first["eta_propagated_upper"]
    uncertainty = first["beta_uncertainty"]
    assert uncertainty["beta_lower"] < uncertainty["beta_median"] < uncertainty["beta_upper"]
    assert uncertainty["importance_effective_sample_size"] > 50


def test_seeded_profile_coverage_smoke_study():
    """A deterministic simulation guard against gross profile undercoverage."""
    true_reliability = float(np.exp(-1.0))
    covered = 0
    for seed in range(8):
        fit = Fit_Weibull_2P(_weibull_sample(seed=100 + seed, n=50))
        interval = fit.profile_likelihood_interval(
            target="reliability", value=100.0, CI=0.90
        )
        covered += interval["lower"] <= true_reliability <= interval["upper"]
    assert covered >= 6
