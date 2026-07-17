"""Censoring-design contracts for refitted parametric bootstrap intervals."""

import numpy as np
import pytest

from reliability.Distributions import Weibull_Distribution
from reliability.Fitters import Fit_Weibull_2P
from reliability.Uncertainty import (
    _prepare_censoring_plan,
    _sample_censor_times,
)


def _censored_fit(seed=123, n=60, cutoff=100.0):
    latent = Weibull_Distribution(eta=100, beta=2).random_samples(n, seed=seed)
    failed = latent <= cutoff
    return Fit_Weibull_2P(
        failures=latent[failed],
        right_censored=np.full(int(np.sum(~failed)), cutoff),
        show_probability_plot=False,
    )


def test_missing_censoring_design_is_retained_but_truthfully_unverified():
    fit = _censored_fit()
    result = fit.parametric_bootstrap_interval(
        value=100.0, CI=0.90, n_bootstrap=20, seed=91,
    )

    assert result["censoring_model"] == "empirical_censor_time_resampling"
    assert result["calibration_status"] == "approximate_unverified"
    assert result["censoring_design"]["calibration_status"] == "approximate_unverified"
    assert "censoring_design_not_supplied" in result["uncertainty_warnings"]
    assert "empirical_censor_time_resampling_is_approximate" in result[
        "uncertainty_warnings"
    ]


def test_fixed_administrative_design_is_forwarded_by_fitter_api():
    fit = _censored_fit(seed=456)
    result = fit.parametric_bootstrap_interval(
        value=100.0,
        CI=0.90,
        n_bootstrap=20,
        seed=92,
        censoring_design={"type": "fixed_administrative", "time": 100.0},
    )

    assert result["n_successful"] >= 15
    assert result["censoring_model"] == "fixed_administrative"
    assert result["calibration_status"] == "design_reproduced"
    assert result["censoring_design"]["time"] == 100.0
    assert result["uncertainty_warnings"] == [
        "bootstrap_replication_count_below_100_has_unstable_percentile_endpoints"
    ]


def test_fixed_administrative_design_rejects_incompatible_observations():
    fit = _censored_fit(seed=456)

    with pytest.raises(ValueError, match="cannot precede an observed failure"):
        fit.parametric_bootstrap_interval(
            value=100.0,
            n_bootstrap=20,
            censoring_design={"type": "fixed_administrative", "time": 50.0},
        )


def test_observed_schedule_requires_one_planned_time_per_unit():
    fit = _censored_fit(seed=789)
    n_total = len(fit._ci_failures) + len(fit._ci_right_censored)

    with pytest.raises(ValueError, match="each of the"):
        fit.parametric_bootstrap_interval(
            value=100.0,
            n_bootstrap=20,
            censoring_design={
                "type": "observed_schedule",
                "times": [100.0] * (n_total - 1),
            },
        )

    plan = _prepare_censoring_plan(
        fit._ci_failures,
        fit._ci_right_censored,
        {"type": "observed_schedule", "times": [100.0] * n_total},
    )
    sampled = _sample_censor_times(plan, n_total, np.random.default_rng(3))
    assert np.array_equal(sampled, np.full(n_total, 100.0))
    assert plan.diagnostics()["schedule_length"] == n_total


def test_observed_schedule_runs_through_public_bootstrap_api():
    fit = _censored_fit(seed=790)
    n_total = len(fit._ci_failures) + len(fit._ci_right_censored)
    schedule = np.linspace(80.0, 140.0, n_total)

    result = fit.parametric_bootstrap_interval(
        value=100.0,
        CI=0.90,
        n_bootstrap=20,
        seed=94,
        censoring_design={
            "type": "observed_schedule",
            "times": schedule.tolist(),
        },
    )

    assert result["complete"] is False
    assert result["interval_status"] == "partial_diagnostic"
    assert result["censoring_design_status"] == "design_reproduced"
    assert result["inferential_calibration_status"] == (
        "parametric_bootstrap_low_replication_unverified"
    )
    assert result["censoring_design"]["schedule_length"] == n_total


@pytest.mark.parametrize(
    ("distribution", "parameters"),
    [
        ("exponential", {"scale": 120.0}),
        ("weibull", {"shape": 2.0, "scale": 120.0}),
        ("lognormal", {"mu": 4.5, "sigma": 0.4}),
        ("uniform", {"low": 20.0, "high": 200.0}),
    ],
)
def test_declared_independent_parametric_censor_models_are_finite(
    distribution, parameters,
):
    fit = _censored_fit(seed=246)
    n_total = len(fit._ci_failures) + len(fit._ci_right_censored)
    plan = _prepare_censoring_plan(
        fit._ci_failures,
        fit._ci_right_censored,
        {
            "type": "parametric_independent",
            "distribution": distribution,
            "parameters": parameters,
        },
    )

    sampled = _sample_censor_times(plan, n_total, np.random.default_rng(4))
    assert len(sampled) == n_total
    assert np.all(np.isfinite(sampled))
    assert np.all(sampled >= 0)
    assert plan.calibration_status == "model_based"


def test_independent_parametric_design_runs_through_public_bootstrap_api():
    fit = _censored_fit(seed=135)
    result = fit.parametric_bootstrap_interval(
        value=100.0,
        CI=0.90,
        n_bootstrap=20,
        seed=93,
        censoring_design={
            "type": "parametric_independent",
            "distribution": "exponential",
            "parameters": {"scale": 200.0},
        },
    )

    assert result["n_successful"] >= 15
    assert result["censoring_model"] == "parametric_independent"
    assert result["calibration_status"] == "model_based"
    assert result["censoring_design"]["distribution"] == "exponential"
    assert result["censoring_design"]["parameters"] == {"scale": 200.0}


def test_uncensored_default_preserves_complete_sample_contract():
    failures = Weibull_Distribution(eta=100, beta=2).random_samples(30, seed=10)
    fit = Fit_Weibull_2P(failures, show_probability_plot=False)
    result = fit.parametric_bootstrap_interval(
        value=100.0, CI=0.90, n_bootstrap=20, seed=11,
    )

    assert result["censoring_model"] == "complete_sample"
    assert result["calibration_status"] == "design_reproduced"
    assert result["uncertainty_warnings"] == [
        "bootstrap_replication_count_below_100_has_unstable_percentile_endpoints"
    ]


def test_declared_plan_is_honored_when_observed_sample_has_no_censors():
    failures = Weibull_Distribution(eta=100, beta=2).random_samples(30, seed=12)
    cutoff = float(np.max(failures) + 1.0)
    fit = Fit_Weibull_2P(failures, show_probability_plot=False)

    result = fit.parametric_bootstrap_interval(
        value=100.0,
        CI=0.90,
        n_bootstrap=20,
        seed=13,
        censoring_design={"type": "fixed_administrative", "time": cutoff},
    )

    assert result["censoring_model"] == "fixed_administrative"
    assert result["censoring_design_status"] == "design_reproduced"
    assert result["censoring_design"]["time"] == cutoff
