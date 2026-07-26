"""Finite-sample Normal/Lognormal confidence-inference contracts."""

import numpy as np
import pytest
from scipy import stats

from reliability.Fitters import (
    Fit_Lognormal_2P, Fit_Normal_2P, Fit_Weibull_2P,
)
from reliability.Grouped_life import FrequencyObservation, fit_grouped_life
from reliability.Uncertainty import parametric_bootstrap_package


def test_complete_normal_parameter_intervals_match_reference_pivots():
    sample = np.asarray([8.0, 9.0, 10.0, 12.0, 16.0])
    fit = Fit_Normal_2P(sample, CI=0.95)
    n = len(sample)
    mean = np.mean(sample)
    centered = np.sum((sample - mean) ** 2)
    standard_deviation = np.sqrt(centered / (n - 1))
    expected_mu = (
        mean - stats.t.ppf(0.975, n - 1) * standard_deviation / np.sqrt(n),
        mean + stats.t.ppf(0.975, n - 1) * standard_deviation / np.sqrt(n),
    )
    expected_sigma = (
        np.sqrt(centered / stats.chi2.ppf(0.975, n - 1)),
        np.sqrt(centered / stats.chi2.ppf(0.025, n - 1)),
    )
    assert fit.mu_lower == pytest.approx(expected_mu[0])
    assert fit.mu_upper == pytest.approx(expected_mu[1])
    assert fit.sigma_lower == pytest.approx(expected_sigma[0])
    assert fit.sigma_upper == pytest.approx(expected_sigma[1])
    assert fit.confidence_metadata["exact"] is True
    assert fit.confidence_metadata["band_scope"] == "pointwise"


def test_lognormal_exact_bounds_are_normal_bounds_on_log_scale():
    logged = np.asarray([1.0, 1.3, 1.8, 2.2, 2.9, 3.1])
    normal = Fit_Normal_2P(logged, CI=0.90)
    lognormal = Fit_Lognormal_2P(np.exp(logged), CI=0.90)
    assert lognormal.mu_lower == pytest.approx(normal.mu_lower)
    assert lognormal.mu_upper == pytest.approx(normal.mu_upper)
    assert lognormal.sigma_lower == pytest.approx(normal.sigma_lower)
    assert lognormal.sigma_upper == pytest.approx(normal.sigma_upper)
    x = np.exp([1.2, 2.0, 2.8])
    _, lognormal_lower, lognormal_upper = lognormal.confidence_bounds(x)
    _, normal_lower, normal_upper = normal.confidence_bounds(np.log(x))
    np.testing.assert_allclose(lognormal_lower, normal_lower)
    np.testing.assert_allclose(lognormal_upper, normal_upper)


def test_censored_normal_uses_labeled_quick_asymptotic_inference():
    fit = Fit_Normal_2P([8, 9, 10, 12], right_censored=[14, 14])
    assert fit.confidence_metadata["exact"] is False
    assert fit.confidence_metadata["primary"] is False
    assert fit.parameter_ci_method == "quick_observed_fisher_wald"


def test_rank_regression_primary_intervals_fail_closed_then_match_estimator():
    sample = 100 * np.random.default_rng(81).weibull(2.0, 40)
    fit = Fit_Weibull_2P(sample, method="RRX")
    assert fit.confidence_metadata["available"] is False
    assert np.isnan(fit.eta_lower)
    package = parametric_bootstrap_package(
        fit, np.linspace(20, 180, 20), CI=0.90, n_bootstrap=20, seed=91,
    )
    assert package["confidence"]["estimator"] == "RRX"
    assert all(
        row["method"] == "estimator_matched_parametric_bootstrap_percentile"
        for row in package["parameters"]
    )


def test_grouped_complete_normal_uses_weighted_exact_pivots():
    grouped = fit_grouped_life(
        "frequency_exact",
        [
            FrequencyObservation(8, "F", 2),
            FrequencyObservation(10, "F", 1),
            FrequencyObservation(12, "F", 2),
        ],
        "Normal_2P",
        CI=0.95,
    )
    expanded = Fit_Normal_2P([8, 8, 10, 12, 12], CI=0.95)
    assert grouped.mu_lower == pytest.approx(expanded.mu_lower)
    assert grouped.mu_upper == pytest.approx(expanded.mu_upper)
    assert grouped.sigma_lower == pytest.approx(expanded.sigma_lower)
    assert grouped.sigma_upper == pytest.approx(expanded.sigma_upper)


@pytest.mark.parametrize(
    "distribution",
    ["Weibull_3P", "Lognormal_3P", "Gamma_3P", "Loglogistic_3P"],
)
def test_grouped_three_parameter_inference_is_unavailable(distribution):
    observations = [
        FrequencyObservation(10, "F", 2),
        FrequencyObservation(20, "F", 2),
        FrequencyObservation(40, "F", 2),
        FrequencyObservation(80, "F", 2),
    ]
    fit = fit_grouped_life(
        "frequency_exact", observations, distribution, CI=0.90,
    )
    assert fit.confidence_metadata["available"] is False
    assert fit.confidence_metadata["reason"] == "nonregular_location_inference"
