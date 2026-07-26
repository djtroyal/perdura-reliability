"""Reference and coverage tests for exact exponential confidence inference."""

import numpy as np
import pytest
from scipy import stats

from reliability.Exponential_inference import classify_exponential_censoring
from reliability.Fitters import Fit_Exponential_1P, Fit_Exponential_2P
from reliability.Grouped_life import FrequencyObservation, fit_grouped_life


def test_exponential_1p_complete_interval_matches_chi_square_reference():
    failures = np.array([4.0, 7.0, 9.0, 12.0, 18.0])
    fit = Fit_Exponential_1P(failures, CI=0.95)
    exposure = failures.sum()
    expected = (
        stats.chi2.ppf(0.025, 10) / (2 * exposure),
        stats.chi2.ppf(0.975, 10) / (2 * exposure),
    )
    assert fit.Lambda_lower == pytest.approx(expected[0])
    assert fit.Lambda_upper == pytest.approx(expected[1])
    assert fit.confidence_metadata["sample_design"] == "complete"
    assert fit.confidence_metadata["band_scope"] == "simultaneous"


def test_exponential_1p_type_ii_uses_total_time_on_test():
    failures = np.array([2.0, 3.0, 6.0])
    censored = np.array([6.0, 6.0])
    fit = Fit_Exponential_1P(failures, censored, CI=0.90)
    exposure = failures.sum() + censored.sum()
    assert fit.Lambda == pytest.approx(3 / exposure)
    assert fit.Lambda_lower == pytest.approx(
        stats.chi2.ppf(0.05, 6) / (2 * exposure)
    )
    assert fit.Lambda_upper == pytest.approx(
        stats.chi2.ppf(0.95, 6) / (2 * exposure)
    )
    assert fit.confidence_metadata["sample_design"] == "type_ii"


def test_exponential_2p_support_boundary_mle_and_exact_marginals():
    failures = np.array([10.0, 14.0, 20.0, 25.0])
    censored = np.array([25.0, 25.0])
    fit = Fit_Exponential_2P(failures, censored, CI=0.95)
    exposure = np.sum(failures - 10.0) + np.sum(censored - 10.0)
    degrees = 2 * (len(failures) - 1)

    assert fit.gamma == 10.0
    assert fit.Lambda == pytest.approx(len(failures) / exposure)
    assert fit.Lambda_lower == pytest.approx(
        stats.chi2.ppf(0.025, degrees) / (2 * exposure)
    )
    assert fit.Lambda_upper == pytest.approx(
        stats.chi2.ppf(0.975, degrees) / (2 * exposure)
    )
    expected_gamma_lower = max(
        0.0,
        10.0 - exposure * stats.f.ppf(0.95, 2, degrees)
        / (len(failures) + len(censored))
        / (len(failures) - 1),
    )
    assert fit.gamma_lower == pytest.approx(expected_gamma_lower)
    assert fit.gamma_upper == 10.0
    assert np.isnan(fit.Lambda_SE)
    assert np.isnan(fit.gamma_SE)
    assert fit.results["CI Method"].tolist() == [
        "exact_chi_square",
        "exact_support_bounded_f",
    ]


def test_exponential_2p_simultaneous_bounds_are_ordered_and_complementary():
    fit = Fit_Exponential_2P(
        [10.0, 14.0, 20.0, 25.0],
        [25.0, 25.0],
        CI=0.95,
    )
    x = np.linspace(0, 80, 161)
    _, sf_lower, sf_upper = fit.confidence_bounds(x, "SF")
    _, cdf_lower, cdf_upper = fit.confidence_bounds(x, "CDF")
    sf = fit.distribution._sf(x)
    assert np.all((0 <= sf_lower) & (sf_lower <= sf))
    assert np.all((sf <= sf_upper) & (sf_upper <= 1))
    np.testing.assert_allclose(cdf_lower, 1 - sf_upper)
    np.testing.assert_allclose(cdf_upper, 1 - sf_lower)


def test_exponential_2p_higher_confidence_is_wider_and_tail_stable():
    data = [10.0, 14.0, 20.0, 25.0, 31.0, 44.0]
    x = np.array([0.0, 10.0, 20.0, 1e4, 1e8])
    fit_90 = Fit_Exponential_2P(data, CI=0.90)
    fit_99 = Fit_Exponential_2P(data, CI=0.99)
    _, lower_90, upper_90 = fit_90.confidence_bounds(x)
    _, lower_99, upper_99 = fit_99.confidence_bounds(x)
    assert np.all(np.isfinite(lower_90)) and np.all(np.isfinite(upper_90))
    assert np.all(lower_99 <= lower_90)
    assert np.all(upper_90 <= upper_99)
    repeated = fit_99.confidence_bounds(x)
    np.testing.assert_array_equal(repeated[1], lower_99)
    np.testing.assert_array_equal(repeated[2], upper_99)


def test_arbitrary_censoring_reports_reason_instead_of_delta_fallback():
    fit = Fit_Exponential_2P(
        [10.0, 14.0, 20.0, 25.0],
        [16.0, 25.0],
        CI=0.95,
    )
    _, lower, upper = fit.confidence_bounds([10.0, 20.0, 30.0])
    assert lower is None and upper is None
    assert fit.confidence_metadata["available"] is False
    assert fit.confidence_metadata["reason"] == "arbitrary_right_censoring"
    assert "exact_inference_unavailable_arbitrary_right_censoring" in (
        fit.uncertainty_warnings
    )


def test_type_ii_classifier_uses_strict_scale_aware_tolerance():
    exact = classify_exponential_censoring(
        [2.0, 4.0, 8.0], [8.0, 8.0 + 5e-10]
    )
    arbitrary = classify_exponential_censoring(
        [2.0, 4.0, 8.0], [8.0, 8.001]
    )
    assert exact["design"] == "type_ii"
    assert arbitrary == {
        "design": "unsupported",
        "reason": "arbitrary_right_censoring",
        "r": 3,
        "n": 5,
    }


def test_grouped_exact_frequency_uses_exact_inference_and_warns_for_ties():
    fit = fit_grouped_life(
        "frequency_exact",
        [
            FrequencyObservation(10.0, "F", 2),
            FrequencyObservation(20.0, "F", 2),
            FrequencyObservation(20.0, "S", 1),
        ],
        "Exponential_2P",
        CI=0.95,
    )
    assert fit.gamma == 10.0
    assert fit.Lambda == pytest.approx(4 / 30)
    assert fit.confidence_metadata["available"] is True
    assert fit.confidence_metadata["sample_design"] == "type_ii"
    assert "continuous_time_ties_or_rounding" in fit.uncertainty_warnings


@pytest.mark.parametrize(
    ("design", "true_gamma", "sample_size", "failure_count", "seed"),
    [
        ("complete", 0.0, 8, 8, 881),
        ("complete", 7.0, 20, 20, 882),
        ("type_ii", 0.0, 12, 5, 883),
        ("type_ii", 7.0, 20, 10, 884),
    ],
)
def test_small_and_moderate_sample_whole_curve_coverage_tracks_nominal(
    design, true_gamma, sample_size, failure_count, seed,
):
    """Seeded coverage probe for the actual boundary-aware plotted envelope."""
    rng = np.random.default_rng(seed)
    true_rate = 0.04
    x = np.linspace(0, 250, 81)
    true_sf = np.where(
        x <= true_gamma, 1.0, np.exp(-true_rate * (x - true_gamma))
    )
    covered = 0
    simulations = 300
    for _ in range(simulations):
        sample = np.sort(
            true_gamma + rng.exponential(1 / true_rate, sample_size)
        )
        if design == "complete":
            failures, censored = sample, None
        else:
            failures = sample[:failure_count]
            censored = np.repeat(
                sample[failure_count - 1], sample_size - failure_count
            )
        fit = Fit_Exponential_2P(failures, censored, CI=0.95)
        _, lower, upper = fit.confidence_bounds(x, "SF")
        covered += int(np.all(lower <= true_sf) and np.all(true_sf <= upper))

    empirical = covered / simulations
    # 0.06 is about 2.8 binomial standard errors at p=.95 and N=300.
    assert empirical == pytest.approx(0.95, abs=0.06)
