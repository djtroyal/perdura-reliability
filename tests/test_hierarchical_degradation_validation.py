"""Fast structural checks for the hierarchical degradation validation matrix."""

import json

import numpy as np

from tools.hierarchical_degradation_validation import (
    _scenario_truth,
    _simulate_request,
    expand_scenarios,
    load_config,
    run_matrix,
)


def test_hierarchical_matrix_spans_requested_factorial_and_profiles():
    config = load_config()
    scenarios = expand_scenarios(config)

    assert len(scenarios) == 96
    assert {item["model"] for item in scenarios} == {"linear", "exponential"}
    assert {item["n_units"] for item in scenarios} == {10, 30, 100}
    assert {item["readings_per_unit"] for item in scenarios} == {3, 6}
    assert {item["error_level"] for item in scenarios} == {"low", "high"}
    assert {item["heterogeneity_level"] for item in scenarios} == {"low", "high"}
    assert {item["right_censoring_target"] for item in scenarios} == {0.0, 0.5}
    assert config["profiles"]["pr"]["replicates"] == 1
    assert config["profiles"]["pr"]["bootstrap_resamples"] == 20
    assert config["profiles"]["nightly"]["replicates"] == 250
    assert config["profiles"]["nightly"]["bootstrap_resamples"] == 199
    assert config["profiles"]["release"]["replicates"] == 1000
    assert config["profiles"]["release"]["bootstrap_resamples"] == 999


def test_one_no_bootstrap_cell_emits_machine_readable_recovery_metrics():
    result = run_matrix(
        load_config(), profile_name="pr",
        scenario_ids=["linear-u10-r3-error_low-hetero_low-censor_50"],
        replicate_override=1, bootstrap_override=0,
        monte_carlo_override=1000, seed=12345,
        include_replicates=False)

    assert result["scenario_count"] == 1
    cell = result["results"][0]
    assert cell["requested"] == 1
    assert cell["completed"] in {0, 1}
    assert "mean_log_slope" in cell["recovery"] or cell["errors"]
    assert set(cell["coverage"]) == {
        "mean_log_slope", "B10", "B50", "reliability_at_horizon",
    }
    coverage = cell["coverage"]["B10"]
    assert coverage["unconditional"]["denominator"] == 1
    assert coverage["unconditional"]["classification"] == "insufficient_replicates"
    assert "conditional_on_available" in coverage
    assert "conditional_on_eligible" in coverage
    assert "diagnostic_intervals_available" in coverage
    assert result["seed_policy"]
    assert result["validation_status"] == "functional_only"
    assert result["coverage_classification_counts"] == {
        "insufficient_replicates": 4}
    assert set(result["software"]) == {
        "python", "platform", "numpy", "scipy", "reliability"}
    assert result["elapsed_seconds"] >= 0
    json.dumps(result, allow_nan=False)


def test_validation_follow_up_stops_at_first_observed_crossing():
    scenario = next(
        item for item in expand_scenarios(load_config())
        if item["id"] == "linear-u10-r6-error_high-hetero_high-censor_50")
    truth = _scenario_truth(scenario, 20260713)
    request, realized = _simulate_request(
        scenario, truth, np.random.default_rng(456), confidence=0.9,
        n_monte_carlo=1000, n_bootstrap=0, fit_seed=9)

    assert 0 <= realized <= 1
    for unit_id in set(request.unit_ids):
        values = np.asarray([
            value for uid, value in zip(request.unit_ids, request.measurements)
            if uid == unit_id])
        crossings = np.flatnonzero(values >= scenario["threshold"])
        if crossings.size:
            assert crossings[0] == len(values) - 1


def test_effectively_uncensored_horizon_uses_extreme_population_tail():
    scenario = next(
        item for item in expand_scenarios(load_config())
        if item["id"] == "linear-u10-r3-error_low-hetero_low-censor_0")
    truth = _scenario_truth(scenario, 20260713)
    assert truth["reliability_at_horizon"] <= 2e-5
