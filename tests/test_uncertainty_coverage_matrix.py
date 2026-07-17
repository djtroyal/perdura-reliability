"""Fast structural tests for the configurable uncertainty coverage matrix."""

import json

import pytest

from tools.uncertainty_coverage_matrix import (
    _empty_accumulator,
    _finalize_interval_result,
    classify_coverage,
    load_config,
    run_matrix,
    wilson_interval,
)


def test_matrix_has_two_tiers_and_all_priority_regimes():
    config = load_config()

    assert config["tiers"]["pr"]["replicates"] <= 2
    assert config["tiers"]["nightly"]["replicates"] == 250
    assert config["tiers"]["release"]["replicates"] == 2000
    assert config["tiers"]["release"]["method_replicates"][
        "parametric_bootstrap"
    ] == 1000
    assert config["tiers"]["release"]["bootstrap_resamples"] == 999

    pr_scenarios = [
        scenario for scenario in config["scenarios"]
        if "pr" in scenario.get("tags", [])
    ]
    regimes = {scenario["regime"] for scenario in pr_scenarios}
    kinds = {scenario["kind"] for scenario in config["scenarios"]}
    censoring_types = {
        scenario["censoring"]["type"] for scenario in config["scenarios"]
    }
    assert "small_sample" in regimes
    assert "location_on_boundary" in regimes
    assert "overlapping_components" in regimes
    assert kinds == {
        "weibull_lifetime",
        "lognormal_lifetime",
        "weibull_boundary",
        "weibull_mixture",
        "weibull_competing_risks",
    }
    assert {
        "fixed_administrative", "observed_schedule", "parametric_independent",
    } <= censoring_types
    lognormal = [
        scenario for scenario in config["scenarios"]
        if scenario["kind"] == "lognormal_lifetime"
    ]
    assert {(item["sigma"], item["n"]) for item in lognormal} == {
        (0.5, 10), (0.5, 30), (1.5, 10), (1.5, 30),
    }
    competing = [
        scenario for scenario in config["scenarios"]
        if scenario["kind"] == "weibull_competing_risks"
    ]
    assert {item["expected_identifiable"] for item in competing} == {True, False}
    assert all("pr" not in item.get("tags", []) for item in lognormal + competing)


def test_wilson_classification_accounts_for_monte_carlo_error():
    assert wilson_interval(0, 0) is None
    assert classify_coverage(94, 100, nominal=0.90)["classification"] == "supported"
    assert classify_coverage(70, 100, nominal=0.90)["classification"] == "deficient"
    assert classify_coverage(9, 10, nominal=0.90)["classification"] == "inconclusive"


def test_small_matrix_run_is_seeded_and_json_serializable():
    config = load_config()
    kwargs = dict(
        tier_name="pr",
        scenario_ids=["small_b2_n10"],
        methods=["wald_delta"],
        targets=["r_at_scale"],
        replicate_override=2,
    )
    first = run_matrix(config, **kwargs)
    second = run_matrix(config, **kwargs)

    first_elapsed = first.pop("elapsed_seconds")
    second_elapsed = second.pop("elapsed_seconds")
    assert first_elapsed >= 0
    assert second_elapsed >= 0
    assert first == second
    assert first["scenario_count"] == 1
    interval = first["results"][0]["interval_results"][0]
    assert interval["requested"] == 2
    assert interval["calibration_status"] == "asymptotic_approximation"
    assert interval["classification"] == "functional_guard_only"
    assert interval["conditional_classification"] == "functional_guard_only"
    assert interval["unconditional_classification"] == "functional_guard_only"
    assert first["evidence_mode"] == "functional_guard_only"
    json.dumps(first)


def test_boundary_profile_cell_is_explicitly_unsupported_nonregular():
    result = run_matrix(
        load_config(),
        tier_name="pr",
        scenario_ids=["boundary_g0_n20"],
        methods=["profile_likelihood"],
        targets=["r_at_scale"],
        replicate_override=1,
    )

    interval = result["results"][0]["interval_results"][0]
    assert interval["calibration_status"] == "unsupported_nonregular"
    assert interval["attempted"] == 0
    assert interval["classification"] == "functional_guard_only"
    assert interval["errors"] == {"unsupported_nonregular_boundary": 1}


def test_empirical_support_requires_completion_gate_and_both_denominators():
    accumulator = _empty_accumulator(100)
    accumulator.update({"attempted": 90, "complete": 90, "covered": 90})
    result = _finalize_interval_result(
        accumulator, nominal=0.90, evidence_mode="empirical_coverage",
    )

    assert result["conditional_classification"] == "supported"
    assert result["completion_gate_passed"] is False
    assert result["classification"] == "insufficient_completion"
    assert result["coverage_conditional"] == 1.0
    assert result["coverage_unconditional"] == 0.9


def test_lognormal_second_wave_cell_runs_through_common_matrix_engine():
    result = run_matrix(
        load_config(),
        tier_name="pr",
        scenario_ids=["lognormal_sigma1_5_n10"],
        methods=["wald_delta"],
        targets=["r_at_scale"],
        replicate_override=1,
    )

    interval = result["results"][0]["interval_results"][0]
    assert interval["true_value"] == 0.5
    assert interval["requested"] == 1
    assert interval["complete"] in {0, 1}


def test_planned_schedule_cell_reproduces_declared_unit_schedule():
    result = run_matrix(
        load_config(),
        tier_name="pr",
        scenario_ids=["schedule_b2_n20_heterogeneous"],
        methods=["parametric_bootstrap"],
        targets=["r_at_scale"],
        replicate_override=1,
        bootstrap_override=20,
    )

    interval = result["results"][0]["interval_results"][0]
    assert interval["censoring_design_status"] == "design_reproduced"
    assert interval["attempted"] == 1
    assert interval["complete"] == 0
    assert interval["errors"] == {"partial_bootstrap_interval": 1}
    assert interval["classification"] == "functional_guard_only"
    assert interval["inferential_calibration_status"] == (
        "parametric_bootstrap_low_replication_unverified"
    )


def test_competing_risk_identifiability_cell_reports_diagnostic_rates():
    result = run_matrix(
        load_config(),
        tier_name="pr",
        scenario_ids=["competing_risks_separated"],
        methods=["wald_delta"],
        replicate_override=1,
    )

    diagnostic = result["results"][0]
    assert diagnostic["kind"] == "weibull_competing_risks"
    assert diagnostic["requested"] == 1
    assert diagnostic["expected_identifiable"] is True
    assert diagnostic["eligible"] + diagnostic["false_ineligibility"] == 1
    assert diagnostic["unsupported_interval_methods"] == ["wald_delta"]


def test_unknown_matrix_scenario_fails_closed():
    with pytest.raises(ValueError, match="Unknown scenario ids"):
        run_matrix(load_config(), scenario_ids=["not_a_scenario"])


def test_matrix_rejects_bootstrap_counts_outside_engine_contract():
    with pytest.raises(ValueError, match="20 to 2000"):
        run_matrix(load_config(), bootstrap_override=2001)
