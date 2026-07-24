"""Verification tests for software reliability-growth models."""

import math

import numpy as np
import pytest

from reliability.Software_reliability import MODELS, fit_software_reliability


def _model(result, key):
    return next(item for item in result["models"] if item["model"] == key)


def test_hpp_recovers_closed_form_rate_and_future_count():
    result = fit_software_reliability(
        event_times=[10, 20, 40, 55, 80, 99],
        observation_end=120,
        models=["hpp"],
        prediction_horizon=30,
        mission_duration=20,
    )
    fit = result["models"][0]
    assert fit["parameter_values"]["failure_rate"] == pytest.approx(6 / 120)
    assert fit["projection"]["expected_future_failures"] == pytest.approx(1.5)
    assert fit["projection"]["mission_reliability"] == pytest.approx(math.exp(-1.0))
    assert fit["projection"]["remaining_faults"] is None
    assert fit["goodness_of_fit"]["method"] == "conditional_time_rescaling_ks_diagnostic"


def test_front_loaded_events_prefer_a_decreasing_intensity_model_to_hpp():
    # Deterministic quantiles of a finite-fault GO process, conditioned on T.
    a, b, T, count = 50.0, 0.012, 300.0, 30
    mean_T = a * (1 - math.exp(-b * T))
    targets = (np.arange(count) + 0.5) / count * mean_T
    events = -np.log1p(-targets / a) / b
    result = fit_software_reliability(
        event_times=events,
        observation_end=T,
        models=["hpp", "goel_okumoto", "musa_okumoto"],
        prediction_horizon=50,
    )
    assert _model(result, "goel_okumoto")["AIC"] < _model(result, "hpp")["AIC"]
    assert _model(result, "musa_okumoto")["AIC"] < _model(result, "hpp")["AIC"]


def test_grouped_counts_use_interval_increments_and_keep_zero_count_exposure():
    result = fit_software_reliability(
        observation_end=50,
        interval_endpoints=[10, 20, 30, 40, 50],
        interval_counts=[5, 3, 2, 1, 0],
        models=["hpp", "goel_okumoto"],
        prediction_horizon=10,
    )
    assert result["data_mode"] == "interval_counts"
    assert result["n_failures"] == 11
    assert result["n_intervals"] == 5
    assert _model(result, "hpp")["parameter_values"]["failure_rate"] == pytest.approx(11 / 50)


def test_remaining_faults_are_only_reported_for_finite_fault_models():
    result = fit_software_reliability(
        event_times=[1, 2, 4, 7, 11, 16, 23, 31, 40, 50],
        observation_end=60,
        models=["goel_okumoto", "delayed_s", "power_law"],
    )
    for key in ("goel_okumoto", "delayed_s"):
        projection = _model(result, key)["projection"]
        assert projection["remaining_faults_available"] is True
        assert projection["remaining_faults"] >= 0
    projection = _model(result, "power_law")["projection"]
    assert projection["remaining_faults_available"] is False
    assert projection["remaining_faults"] is None


def test_parametric_bootstrap_is_seeded_and_reports_successful_refits():
    kwargs = dict(
        event_times=[2, 5, 9, 14, 21, 29, 38, 49, 62, 77, 94, 114],
        observation_end=130,
        models=["hpp"],
        prediction_horizon=20,
        bootstrap_samples=20,
        seed=41,
    )
    first = fit_software_reliability(**kwargs)["models"][0]
    second = fit_software_reliability(**kwargs)["models"][0]
    assert first["bootstrap"] == second["bootstrap"]
    assert first["projection"]["uncertainty"] == second["projection"]["uncertainty"]
    assert first["bootstrap"]["successful"] > 0


@pytest.mark.parametrize("model", MODELS)
def test_every_model_produces_finite_monotone_mean_curve(model):
    result = fit_software_reliability(
        event_times=[2, 5, 9, 14, 21, 29, 38, 49, 62, 77, 94, 114],
        observation_end=130,
        models=[model],
        prediction_horizon=20,
    )
    curve = np.asarray(result["models"][0]["projection"]["curve"]["cumulative_failures"])
    assert np.all(np.isfinite(curve))
    assert np.all(np.diff(curve) >= -1e-10)


def test_invalid_observation_contracts_fail_closed():
    with pytest.raises(ValueError, match="not both"):
        fit_software_reliability(
            event_times=[1, 2], observation_end=3,
            interval_endpoints=[1, 3], interval_counts=[1, 1],
        )
    with pytest.raises(ValueError, match="final interval endpoint"):
        fit_software_reliability(
            observation_end=10, interval_endpoints=[2, 8], interval_counts=[1, 1],
        )
    with pytest.raises(ValueError, match="no later"):
        fit_software_reliability(event_times=[1, 11], observation_end=10)


def test_tied_exact_events_warn_about_measurement_resolution():
    result = fit_software_reliability(
        event_times=[1, 2, 2, 4, 7, 9], observation_end=10, models=["hpp"])
    assert any("Tied event exposures" in warning for warning in result["warnings"])


def test_operational_profile_is_separate_normalized_poisson_context():
    result = fit_software_reliability(
        event_times=[2, 5, 10, 18, 29, 43], observation_end=60,
        models=["hpp"], mission_duration=100,
        operational_profile=[
            {"name": "search", "observed_exposure": 1000, "failures": 2, "planned_share": 3},
            {"name": "checkout", "observed_exposure": 200, "failures": 2, "planned_share": 1},
        ],
    )
    profile = result["operational_profile"]
    assert profile["joint_with_growth_model"] is False
    assert sum(row["planned_share"] for row in profile["rows"]) == pytest.approx(1)
    expected = 100 * (0.75 * 2 / 1000 + 0.25 * 2 / 200)
    assert profile["expected_mission_failures"] == pytest.approx(expected)
    assert profile["mission_reliability"] == pytest.approx(math.exp(-expected))
