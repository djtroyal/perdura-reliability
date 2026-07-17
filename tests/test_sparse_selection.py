"""Focused tests for sparse support-stability selection and its audit matrix."""

import numpy as np
import pytest

from reliability.Regression import (
    complementary_pairs_stability_selection,
    sparse_selection_validation_matrix,
)
from tools.run_sparse_selection_matrix import _classify_evidence


def _strong_sparse_data(seed=17, n=120, p=6):
    rng = np.random.default_rng(seed)
    X = rng.normal(size=(n, p))
    y = 3.0 * X[:, 0] - 2.5 * X[:, 1] + rng.normal(0.0, 0.25, n)
    return X, y, [f"x{index}" for index in range(p)]


def test_complementary_pairs_recovers_strong_support_and_reports_pair_context():
    X, y, names = _strong_sparse_data()
    result = complementary_pairs_stability_selection(
        X,
        y,
        names,
        n_pairs=8,
        n_lambdas=6,
        lambda_min_ratio=0.15,
        selection_threshold=0.9,
        random_seed=2026,
        tol=1e-7,
    )

    assert result["selected_support"] == ["x0", "x1"]
    assert result["selected_indices"] == [0, 1]
    assert result["selection_probabilities"][:2] == [1.0, 1.0]
    assert result["support_eligible"] is True
    assert result["operating_point"]["q_budget_met"] is True
    assert (
        result["operating_point"]["empirical_mean_selected_per_half_sample_q"]
        <= result["operating_point"]["q_budget"]
    )
    assert all(
        0.0 <= probability <= 1.0
        for probability in result["selection_probabilities"]
    )
    assert result["convergence"]["all_fits_converged"] is True
    assert result["convergence"]["total_fits"] == 8 * 2 * 6
    assert result["reproducibility"]["half_sample_size"] == 60
    assert result["reproducibility"]["unassigned_observations_per_pair"] == 0

    for path_result in result["path_results"]:
        marginal = np.asarray(path_result["selection_probabilities"])
        simultaneous = np.asarray(
            path_result["simultaneous_selection_probabilities"]
        )
        assert np.all(simultaneous <= marginal + 1e-12)


def test_complementary_pairs_is_reproducible_and_sorts_explicit_path():
    X, y, names = _strong_sparse_data(seed=44, n=81)
    kwargs = dict(
        model="elastic_net",
        l1_ratio=0.6,
        lambda_path=[0.08, 0.3, 0.08, 0.15],
        selection_threshold=0.7,
        n_pairs=6,
        random_seed=73,
    )
    first = complementary_pairs_stability_selection(X, y, names, **kwargs)
    second = complementary_pairs_stability_selection(X, y, names, **kwargs)

    assert first["lambda_path"] == [0.3, 0.15, 0.08]
    assert first["selection_probabilities"] == second["selection_probabilities"]
    assert first["path_results"] == second["path_results"]
    assert first["selected_support"] == second["selected_support"]
    assert first["reproducibility"]["unassigned_observations_per_pair"] == 1


def test_q_control_is_explicitly_a_plug_in_diagnostic_not_a_bound():
    X, y, names = _strong_sparse_data()
    result = complementary_pairs_stability_selection(
        X,
        y,
        names,
        n_pairs=5,
        n_lambdas=4,
        selection_threshold=0.8,
        random_seed=8,
    )

    diagnostic = result["selection_size_control"]
    assert diagnostic["formal_error_bound"] is False
    assert diagnostic["plug_in_pfer_target"] == 1.0
    assert diagnostic["plug_in_pfer_diagnostic"] <= 1.0 + 1e-12
    assert "not a formal" in diagnostic["diagnostic_note"]
    assert "upper_bound" not in repr(diagnostic)
    assert "confidence intervals" in result["inference_note"]
    assert "conf_int" not in result


def test_default_q_control_does_not_green_select_seeded_null_noise():
    rng = np.random.default_rng(2026)
    X = rng.normal(size=(100, 20))
    y = rng.normal(size=100)
    result = complementary_pairs_stability_selection(
        X, y, [f"x{index}" for index in range(20)], random_seed=1)

    assert result["support_eligible"] is True
    assert result["selected_support"] == []
    assert result["operating_point"]["q_budget"] == 4.0
    assert result["selection_size_control"]["plug_in_pfer_diagnostic"] <= 1.0


def test_nonconverged_base_fits_withhold_eligible_support():
    X, y, names = _strong_sparse_data()
    result = complementary_pairs_stability_selection(
        X, y, names, n_pairs=2, n_lambdas=3, max_iter=1, random_seed=9)

    assert result["convergence"]["all_fits_converged"] is False
    assert result["support_eligible"] is False
    assert result["selected_support"] == []
    assert result["support_status"] == "diagnostic_only_base_fit_nonconvergence"


def test_explicit_path_without_q_feasible_point_withholds_support():
    X, y, names = _strong_sparse_data()
    result = complementary_pairs_stability_selection(
        X, y, names, lambda_path=[1e-8], n_pairs=3, random_seed=1)

    assert result["convergence"]["all_fits_converged"] is True
    assert result["operating_point"]["q_budget_met"] is False
    assert result["support_eligible"] is False
    assert result["selected_support"] == []
    assert result["diagnostic_candidate_support"]
    assert result["support_status"] == "diagnostic_only_q_budget_not_met"


@pytest.mark.parametrize(
    "overrides, match",
    [
        ({"selection_threshold": 0.5}, "selection_threshold"),
        ({"n_pairs": 0}, "n_pairs"),
        ({"lambda_path": [0.1, 0.0]}, "lambda_path"),
        ({"model": "ridge"}, "model"),
        ({"model": "lasso", "l1_ratio": 0.5}, "l1_ratio=1"),
        ({"plug_in_pfer_target": 0.0}, "plug_in_pfer_target"),
    ],
)
def test_complementary_pairs_rejects_invalid_controls(overrides, match):
    X, y, names = _strong_sparse_data()
    with pytest.raises(ValueError, match=match):
        complementary_pairs_stability_selection(X, y, names, **overrides)


def test_validation_matrix_has_null_once_and_each_nonnull_signal_regime():
    result = sparse_selection_validation_matrix(
        sample_feature_sizes=[(36, 8)],
        correlations=[0.0],
        signal_multipliers=[0.5, 2.0],
        support_modes=("null", "sparse"),
        support_size=2,
        n_replicates=2,
        test_size=50,
        n_pairs=3,
        n_lambdas=4,
        lambda_min_ratio=0.2,
        selection_threshold=0.75,
        random_seed=91,
    )

    assert len(result["cells"]) == 3
    assert [cell["signal_multiplier"] for cell in result["cells"]] == [
        None,
        0.5,
        2.0,
    ]
    for cell in result["cells"]:
        metrics = cell["metrics"]
        assert 0.0 <= metrics["mean_false_discovery_proportion"] <= 1.0
        assert 0.0 <= metrics["exact_support_rate"] <= 1.0
        assert metrics["mean_prediction_mse"] >= 0.0
        assert len(cell["replicates"]) == 2
        for replicate in cell["replicates"]:
            assert replicate["prediction_mse"] >= 0.0
            assert "data_seed" in replicate
            assert "selection_seed" in replicate
            assert len(replicate["selection_probabilities"]) == 8
            assert all(isinstance(name, str) for name in replicate["selected_support"])
            assert len(replicate["selected_support"]) == len(replicate["selected_indices"])

    assert result["cells"][0]["metrics"]["mean_true_positive_rate"] is None
    assert result["configuration"]["prediction_refit"].endswith(
        "without_coefficient_inference"
    )
    assert "confidence intervals" in result["inference_note"]


def test_validation_matrix_is_reproducible_without_replicate_payloads():
    kwargs = dict(
        sample_feature_sizes=[(30, 6)],
        correlations=[0.5],
        signal_multipliers=[1.0],
        support_modes=("sparse",),
        support_size=2,
        n_replicates=1,
        test_size=30,
        n_pairs=2,
        n_lambdas=3,
        lambda_min_ratio=0.25,
        selection_threshold=0.75,
        random_seed=114,
        include_replicates=False,
    )
    first = sparse_selection_validation_matrix(**kwargs)
    second = sparse_selection_validation_matrix(**kwargs)

    assert {key: value for key, value in first.items() if key != "runtime"} == {
        key: value for key, value in second.items() if key != "runtime"
    }
    assert "replicates" not in first["cells"][0]
    assert first["runtime"]["elapsed_seconds"] >= 0.0
    assert first["reproducibility"]["python_version"]


def test_validation_matrix_shards_are_disjoint_and_keep_cell_seeds():
    kwargs = dict(
        sample_feature_sizes=[(24, 5)],
        correlations=[0.0],
        signal_multipliers=[1.0],
        support_modes=("null", "sparse"),
        support_size=1,
        n_replicates=1,
        test_size=20,
        n_pairs=1,
        n_lambdas=2,
        random_seed=713,
    )
    full = sparse_selection_validation_matrix(**kwargs)
    first = sparse_selection_validation_matrix(**kwargs, shard_count=2, shard_index=0)
    second = sparse_selection_validation_matrix(**kwargs, shard_count=2, shard_index=1)

    sharded = sorted(first["cells"] + second["cells"], key=lambda cell: cell["cell_index"])
    assert [cell["cell_index"] for cell in sharded] == [0, 1]
    assert [cell["replicates"][0]["data_seed"] for cell in sharded] == [
        cell["replicates"][0]["data_seed"] for cell in full["cells"]
    ]
    assert first["configuration"]["total_matrix_cells"] == 2


def test_matrix_evidence_separates_functional_guard_from_mc_acceptance():
    base_metrics = {
        "complete_replicate_rate": 1.0,
        "support_eligibility_rate": 1.0,
        "mean_plug_in_pfer_diagnostic": 0.5,
        "exact_support_rate": 1.0,
    }
    pr_result = {
        "configuration": {"shard_count": 1},
        "cells": [{
            "support_mode": "null", "signal_multiplier": None,
            "n_replicates": 1, "metrics": dict(base_metrics),
        }],
    }
    pr = _classify_evidence(pr_result, "pr")
    assert pr["status"] == "pass"
    assert pr["performance_acceptance_applied"] is False

    mc_result = {
        "configuration": {"shard_count": 1},
        "cells": [
            {
                "support_mode": "null", "signal_multiplier": None,
                "n_replicates": 100, "metrics": dict(base_metrics),
            },
            {
                "support_mode": "sparse", "signal_multiplier": 2.0,
                "n_replicates": 100, "metrics": dict(base_metrics),
            },
        ],
    }
    mc = _classify_evidence(mc_result, "release")
    assert mc["status"] == "accepted"
    assert mc["performance_acceptance_applied"] is True
    assert all(cell["evidence"]["classification"] == "accepted"
               for cell in mc_result["cells"])
