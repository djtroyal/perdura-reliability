"""Decision-grade Regression & ML workflow contracts."""

from __future__ import annotations

import sys
import threading
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from routers import modeling as M


def _regression_request(*, strategy="random", group_column=None, time_column=None,
                        models=("linear",), missing_policy="impute_indicator", tune=False):
    rng = np.random.default_rng(1729)
    n = 72
    x1 = rng.normal(size=n)
    x2 = rng.normal(size=n)
    y = 3.0 * x1 - 1.5 * x2 + rng.normal(scale=0.3, size=n)
    data = {
        "x1": x1.astype(object).tolist(),
        "x2": x2.astype(object).tolist(),
        "y": y.tolist(),
        "group": np.repeat(np.arange(18), 4).tolist(),
        "time": np.arange(n).tolist(),
    }
    data["x1"][5] = None
    return M.EvaluateRequest(
        data=data, target="y", features=["x1", "x2"], task="regression",
        models=[M.ModelSpec(model=model, tune=tune) for model in models],
        missing_policy=missing_policy,
        validation=M.ValidationSpec(
            strategy=strategy, group_column=group_column,
            time_column=time_column, budget="quick", seed=19,
        ),
        selection_metric="rmse", metric_resamples=50,
    )


def _classification_request(false_negative=1.0):
    rng = np.random.default_rng(318)
    n = 120
    x = rng.normal(size=n)
    logits = 1.7 * x - 0.8
    target = np.where(rng.random(n) < 1 / (1 + np.exp(-logits)), "fail", "pass")
    return M.EvaluateRequest(
        data={"x": x.tolist(), "target": target.tolist()},
        target="target", features=["x"], task="classification",
        models=[M.ModelSpec(model="logistic", tune=False)],
        validation=M.ValidationSpec(strategy="stratified", budget="quick", seed=7),
        positive_class="fail", selection_metric="expected_cost",
        costs=M.DecisionCosts(false_positive=1, false_negative=false_negative),
        metric_resamples=50,
    )


def test_all_models_share_outer_fold_observations_and_fold_safe_imputation():
    request = _regression_request(models=("linear", "ridge"))
    progress = []
    result = M.evaluate_models(request, progress=progress.append)

    assert result["validation"]["nested"] is True
    assert result["validation"]["preprocessing_scope"] == "fit_inside_each_training_fold"
    assert result["readiness"]["missing_by_feature"]["x1"] == 1
    assert result["readiness"]["n_rows_eligible"] == 72
    models = {row["model"]: row for row in result["models"]}
    assert models["linear"]["status"] == "eligible"
    assert models["ridge"]["status"] == "eligible"
    assert models["linear"]["oof"]["row_indices"] == models["ridge"]["oof"]["row_indices"]
    assert models["linear"]["metrics"]["rmse"]["value"] < 0.6
    assert models["linear"]["metrics"]["rmse"]["lower"] is not None
    assert progress[0]["models_total"] == 2
    assert progress[-1]["models_done"] == 2
    assert all(event.get("models_total") == 2 for event in progress)


def test_modeling_run_honors_cooperative_cancellation():
    request = _regression_request(models=("linear", "ridge"))
    cancel = threading.Event()

    def stop_after_preparation(event):
        if event.get("type") == "start":
            cancel.set()

    with pytest.raises(M.ModelingCancelled):
        M.evaluate_models(request, progress=stop_after_preparation, cancel=cancel)


def test_fail_soft_modeling_diagnostics_do_not_expose_exception_details(monkeypatch):
    secret = "sensitive-internal-path-/srv/perdura/model.bin"
    request = _regression_request(missing_policy="drop")
    prepared = M._prepare(request)

    def fail(*_args, **_kwargs):
        raise RuntimeError(secret)

    monkeypatch.setattr(M, "permutation_importance", fail)
    importance = M._raw_importances(object(), prepared.X, prepared.y, request)
    assert importance["reason"] == "Permutation importance is unavailable for this fitted model."

    monkeypatch.setattr(M, "partial_dependence", fail)
    dependence = M._dependence(
        object(), prepared,
        {"feature_names": request.features, "mean": [2.0, 1.0]}, request,
    )
    assert dependence
    assert all(item.get("error") ==
               "Partial-dependence diagnostics are unavailable for this feature."
               for item in dependence)

    monkeypatch.setattr(M, "linear_regression", fail)
    inference = M._classical_inference("linear", prepared, request, {})
    assert inference == {
        "status": "unavailable",
        "reason": "Classical inference is unavailable for this fitted model.",
    }

    monkeypatch.setattr(M, "_evaluate_one", fail)
    evaluation = M.evaluate_models(request)
    assert evaluation["models"][0]["reason"] == (
        "Model evaluation failed; use the request ID with server logs for details."
    )
    assert secret not in str([importance, dependence, inference, evaluation])


def test_onnx_conversion_failure_does_not_expose_exception_details(monkeypatch):
    skl2onnx = pytest.importorskip("skl2onnx")
    pytest.importorskip("onnxruntime")
    request = _regression_request(missing_policy="impute")
    prepared = M._prepare(request)
    secret = "sensitive-internal-onnx-path-/srv/perdura/model.onnx"

    def fail(*_args, **_kwargs):
        raise RuntimeError(secret)

    monkeypatch.setattr(skl2onnx, "convert_sklearn", fail)
    artifact = M._onnx_convert(object(), prepared, request)

    assert artifact == {
        "kind": "recipe",
        "available": False,
        "reason": (
            "ONNX conversion or parity validation failed; the fitted model is retained "
            "as a non-executable recipe."
        ),
    }
    assert secret not in str(artifact)


def test_grouped_nested_validation_never_overlaps_entities():
    request = _regression_request(strategy="group", group_column="group")
    result = M.evaluate_models(request)
    model = result["models"][0]
    groups = np.asarray(request.data["group"])

    assert result["validation"]["metric_interval_method"] == "cluster_bootstrap"
    for fold in model["folds"]:
        train_groups = set(groups[fold["train_row_indices"]])
        test_groups = set(groups[fold["test_row_indices"]])
        assert train_groups.isdisjoint(test_groups)


def test_time_nested_validation_only_predicts_future_rows():
    request = _regression_request(strategy="time", time_column="time")
    result = M.evaluate_models(request)
    model = result["models"][0]
    times = np.asarray(request.data["time"])

    assert result["validation"]["metric_interval_method"] == "moving_block_bootstrap"
    for fold in model["folds"]:
        assert np.max(times[fold["train_row_indices"]]) < np.min(times[fold["test_row_indices"]])


def test_high_false_negative_cost_lowers_inner_selected_threshold():
    symmetric = M.evaluate_models(_classification_request(false_negative=1))["models"][0]
    failure_first = M.evaluate_models(_classification_request(false_negative=12))["models"][0]

    assert symmetric["status"] == "eligible"
    assert failure_first["status"] == "eligible"
    assert failure_first["threshold"] < symmetric["threshold"]
    assert failure_first["metrics"]["expected_cost"]["value"] >= 0


def test_readiness_flags_target_duplicate_and_id_like_predictor():
    n = 30
    labels = ["yes" if i % 2 else "no" for i in range(n)]
    request = M.EvaluateRequest(
        data={"leak": labels, "serial": [f"asset-{i}" for i in range(n)], "target": labels},
        target="target", features=["leak", "serial"], task="classification",
        models=[M.ModelSpec(model="decision_tree", tune=False)],
        validation=M.ValidationSpec(budget="quick"), metric_resamples=50,
    )
    prepared = M._prepare(request)

    assert prepared.readiness["leakage_warnings"]
    assert "serial" in prepared.readiness["id_like_features"]
    assert prepared.readiness["status"] == "warning"


def test_linear_predictive_pipeline_supports_fold_safe_categorical_encoding():
    rng = np.random.default_rng(21)
    n = 60
    category = np.resize(np.asarray(["A", "B", "C"], dtype=object), n)
    y = np.asarray([{"A": 0.0, "B": 2.0, "C": 5.0}[value] for value in category])
    y += rng.normal(scale=0.15, size=n)
    category[4] = None
    request = M.EvaluateRequest(
        data={"category": category.tolist(), "y": y.tolist()},
        target="y", features=["category"], task="regression",
        models=[M.ModelSpec(model="linear", tune=False)],
        validation=M.ValidationSpec(budget="quick", seed=4), metric_resamples=50,
    )
    result = M.evaluate_models(request)["models"][0]

    assert result["status"] == "eligible"
    assert result["metrics"]["rmse"]["value"] < 0.5
    assert result["inference"] is None


def test_spline_regression_is_fold_safe_and_reports_response_curve():
    rng = np.random.default_rng(402)
    x = np.linspace(-3.0, 3.0, 72)
    y = np.sin(x) + rng.normal(scale=0.08, size=len(x))
    x_values = x.astype(object).tolist()
    x_values[7] = None
    request = M.EvaluateRequest(
        data={"stress": x_values, "response": y.tolist()},
        target="response", features=["stress"], task="regression",
        models=[M.ModelSpec(model="spline", tune=True)],
        validation=M.ValidationSpec(strategy="random", budget="quick", seed=17),
        missing_policy="impute_indicator", metric_resamples=50,
    )

    result = M.evaluate_models(request)["models"][0]

    assert result["status"] == "eligible"
    assert result["inference"] is None
    assert result["partial_dependence"] == []
    assert result["selected_params"]["spline__basis__n_knots"] in {3, 5, 7, 10}
    assert result["selected_params"]["estimator__alpha"] in {
        0.001, 0.01, 0.1, 1.0, 10.0, 100.0,
    }
    assert result["metrics"]["rmse"]["value"] < 0.25
    curve = result["diagnostics"]["spline_curve"]
    assert curve["feature"] == "stress"
    assert len(curve["x_grid"]) == len(curve["y_grid"]) == 200
    assert len(curve["lower"]) == len(curve["upper"]) == 200
    assert len(curve["x_observed"]) == len(curve["y_oof_predicted"]) == 71
    assert curve["omitted_missing_x"] == 1
    assert curve["extrapolation"] == "linear"
    assert any("linear boundary extrapolation" in warning for warning in result["warnings"])

    prepared = M._prepare(request)
    fitted = M._make_model("spline", prepared, request, seed=17)
    fitted.fit(prepared.X, prepared.y)
    transformed = fitted[:-1].transform(prepared.X)
    assert transformed.shape[1] > 1
    assert transformed[:, -1].tolist() == prepared.X["stress"].isna().astype(float).tolist()


@pytest.mark.parametrize(
    ("data", "features", "task", "reason"),
    [
        (
            {"x1": list(range(12)), "x2": list(range(12)), "y": list(range(12))},
            ["x1", "x2"], "regression", "exactly one predictor",
        ),
        (
            {"x": ["a", "b"] * 6, "y": list(range(12))},
            ["x"], "regression", "numeric predictor",
        ),
        (
            {"x": [0, 1, 2] * 4, "y": list(range(12))},
            ["x"], "regression", "at least four distinct",
        ),
        (
            {"x": list(range(12)), "y": ["a", "b"] * 6},
            ["x"], "classification", "does not support classification",
        ),
    ],
)
def test_spline_regression_ineligible_configs_fail_soft(data, features, task, reason):
    request = M.EvaluateRequest(
        data=data, target="y", features=features, task=task,
        models=[M.ModelSpec(model="spline", tune=False)],
        validation=M.ValidationSpec(budget="quick"), metric_resamples=50,
    )
    result = M.evaluate_models(request)["models"][0]

    assert result["status"] == "ineligible"
    assert reason in result["reason"]


def test_spline_finalization_is_an_explicit_rebuild_only_recipe(monkeypatch):
    x = np.linspace(0.0, 6.0, 48)
    request = M.EvaluateRequest(
        data={"x": x.tolist(), "y": np.cos(x).tolist()},
        target="y", features=["x"], task="regression",
        models=[M.ModelSpec(
            model="spline", tune=False, params={"n_knots": 5, "alpha": 0.1},
        )],
        validation=M.ValidationSpec(budget="quick", seed=5), metric_resamples=50,
    )
    fitted = M.evaluate_models(request)["models"][0]

    def unexpected_onnx(*_args, **_kwargs):
        raise AssertionError("Spline v1 must not attempt ONNX conversion.")

    monkeypatch.setattr(M, "_onnx_convert", unexpected_onnx)
    asset = M.finalize(M.FinalizeRequest(
        evaluation=request, model="spline",
        selected_params=fitted["selected_params"], metrics=fitted["metrics"],
        conformal=fitted["conformal"], warnings=fitted["warnings"],
    ))

    assert asset["artifact"]["kind"] == "recipe"
    assert asset["artifact"]["available"] is False
    assert "rebuild-only recipe" in asset["artifact"]["reason"]
    assert asset["rebuild_recipe"]["training_snapshot"]["x"] == request.data["x"]
    assert asset["model_card"]["spline_contract"] == {
        "basis": "cubic_b_spline",
        "degree": 3,
        "knot_placement": "uniform",
        "extrapolation": "linear",
        "coefficient_inference": "not_reported",
    }
    with pytest.raises(Exception, match="rebuild-only recipe"):
        M.score(M.ScoreRequest(asset=asset, rows=[{"x": 1.5}]))


def test_binary_only_metrics_and_cost_contracts_fail_before_fitting():
    multiclass = M.EvaluateRequest(
        data={"x": list(range(18)), "target": ["a", "b", "c"] * 6},
        target="target", features=["x"], task="classification",
        models=[M.ModelSpec(model="decision_tree", tune=False)],
        selection_metric="roc_auc", validation=M.ValidationSpec(budget="quick"),
        metric_resamples=50,
    )
    with pytest.raises(ValueError, match="requires exactly two"):
        M.evaluate_models(multiclass)

    no_costs = _classification_request()
    no_costs.costs = None
    with pytest.raises(ValueError, match="requires false-positive"):
        M.evaluate_models(no_costs)


def test_time_bootstrap_blocks_follow_chronological_order():
    y = np.arange(9, dtype=float)
    times = np.asarray([8, 0, 7, 1, 6, 2, 5, 3, 4], dtype=float)
    request = _regression_request(strategy="time", time_column="time")
    indices = M._resample_indices(y, request, None, times, np.random.default_rng(3))
    chronological_rank = np.argsort(np.argsort(times, kind="mergesort"), kind="mergesort")
    block = max(2, int(round(np.sqrt(len(y)))))
    for start in range(0, len(indices), block):
        ranks = chronological_rank[indices[start:start + block]]
        assert np.all(np.diff(ranks) == 1)


def test_chaid_finalized_asset_scores_without_refitting_live_data():
    rng = np.random.default_rng(8)
    x = np.r_[rng.normal(-2, 0.3, 45), rng.normal(2, 0.3, 45)]
    target = np.asarray(["pass"] * 45 + ["fail"] * 45)
    evaluation = M.EvaluateRequest(
        data={"x": x.tolist(), "target": target.tolist()},
        target="target", features=["x"], task="classification",
        models=[M.ModelSpec(model="chaid", tune=False)],
        validation=M.ValidationSpec(budget="quick"), positive_class="fail",
        metric_resamples=50,
    )
    run = M.evaluate_models(evaluation)
    fitted = run["models"][0]
    asset = M.finalize(M.FinalizeRequest(
        evaluation=evaluation, model="chaid",
        selected_params=fitted["selected_params"], metrics=fitted["metrics"],
    ))
    scored = M.score(M.ScoreRequest(
        asset=asset, rows=[{"x": -2.0}, {"x": 2.0}],
    ))

    assert asset["artifact"]["kind"] == "native_chaid"
    assert asset["artifact"]["available"] is True
    assert scored["predictions"] == ["pass", "fail"]
    assert all(sum(row.values()) == pytest.approx(1.0) for row in scored["probabilities"])
    with pytest.raises(Exception, match="sigmoid calibration"):
        M.score(M.ScoreRequest(
            asset={**asset, "calibration_state": {"method": "sigmoid"}},
            rows=[{"x": -2.0}],
        ))


def test_finalization_refits_probability_policy_instead_of_reusing_outer_diagnostic():
    evaluation = _classification_request(false_negative=4)
    evaluation.calibration = "sigmoid"
    run = M.evaluate_models(evaluation)
    fitted = run["models"][0]
    asset = M.finalize(M.FinalizeRequest(
        evaluation=evaluation, model="logistic",
        selected_params=fitted["selected_params"], metrics=fitted["metrics"],
        threshold=1.0, calibration_state={"method": "none"},
    ))

    assert asset["threshold"] != 1.0
    assert asset["calibration_state"]["method"] == "sigmoid"
    with pytest.raises(Exception, match="outside this evaluation recipe"):
        M.finalize(M.FinalizeRequest(
            evaluation=evaluation, model="logistic",
            selected_params={"estimator__C": 1e12}, metrics=fitted["metrics"],
        ))


def test_tuned_svm_finalizes_after_browser_normalizes_integral_float_params():
    evaluation = _regression_request(
        models=("svm",), missing_policy="impute", tune=True,
    )
    # Keep an integral-float C in every sampled candidate so the regression
    # does not depend on which candidate a scikit-learn release ranks first.
    evaluation.models[0].params = {"C": 10.0}
    fitted = M.evaluate_models(evaluation)["models"][0]
    assert fitted["status"] == "eligible"
    assert isinstance(fitted["selected_params"]["estimator__C"], float)
    assert fitted["selected_params"]["estimator__C"].is_integer()

    # JSON.stringify emits 5 for a JavaScript number whose backend recipe value
    # was 5.0, and Pydantic consequently receives an int on the return trip.
    browser_params = {
        **fitted["selected_params"],
        "estimator__C": int(fitted["selected_params"]["estimator__C"]),
    }
    asset = M.finalize(M.FinalizeRequest(
        evaluation=evaluation, model="svm",
        selected_params=browser_params, metrics=fitted["metrics"],
        conformal=fitted["conformal"],
    ))

    assert asset["model"] == "svm"
    assert isinstance(asset["selected_params"]["estimator__C"], float)
    assert asset["selected_params"] == fitted["selected_params"]


def test_recipe_parameter_matching_is_semantic_but_fail_closed():
    assert M._same_parameter_value(10.0, 10)
    assert M._same_parameter_value((64, 32), [64, 32])
    assert not M._same_parameter_value(True, 1)
    assert not M._same_parameter_value(None, float("nan"))
    assert not M._same_parameter_value({"C": 10.0}, {"C": 10, "gamma": "scale"})


def test_onnx_finalize_parity_and_scoring_when_dependencies_available():
    pytest.importorskip("skl2onnx")
    pytest.importorskip("onnxruntime")
    evaluation = _regression_request(models=("linear",), missing_policy="impute")
    run = M.evaluate_models(evaluation)
    fitted = run["models"][0]
    asset = M.finalize(M.FinalizeRequest(
        evaluation=evaluation, model="linear",
        selected_params=fitted["selected_params"], metrics=fitted["metrics"],
        conformal=fitted["conformal"],
    ))

    assert asset["artifact"]["kind"] == "onnx", asset["artifact"].get("reason")
    assert asset["artifact"]["parity"]["passed"] is True
    scored = M.score(M.ScoreRequest(
        asset=asset, rows=[{"x1": 0.2, "x2": -0.4}],
    ))
    assert len(scored["predictions"]) == 1
    assert len(scored["intervals"]) == 1


def test_onnx_tree_classifier_normalizes_and_validates_probabilities():
    pytest.importorskip("skl2onnx")
    pytest.importorskip("onnxruntime")
    rng = np.random.default_rng(91)
    n = 80
    x = rng.normal(size=n)
    x2 = rng.normal(size=n)
    target = np.where(x + rng.normal(scale=0.2, size=n) > 0, "fail", "pass")
    evaluation = M.EvaluateRequest(
        data={"x": x.tolist(), "x2": x2.tolist(), "target": target.tolist()},
        target="target", features=["x", "x2"], task="classification",
        models=[M.ModelSpec(model="random_forest", tune=False)],
        validation=M.ValidationSpec(strategy="stratified", budget="quick", seed=11),
        positive_class="fail", metric_resamples=50,
    )
    run = M.evaluate_models(evaluation)
    fitted = run["models"][0]
    asset = M.finalize(M.FinalizeRequest(
        evaluation=evaluation, model="random_forest",
        selected_params=fitted["selected_params"], metrics=fitted["metrics"],
    ))

    assert asset["artifact"]["kind"] == "onnx", asset["artifact"].get("reason")
    assert asset["artifact"]["parity"]["probability_max_absolute_error"] < 1e-4
    scored = M.score(M.ScoreRequest(
        asset=asset,
        rows=[{"x": 1.5, "x2": 0.2}, {"x": -1.5, "x2": -0.2}],
    ))
    assert set(scored["predictions"]) <= {"fail", "pass"}
    for row in scored["probabilities"]:
        assert all(0 <= value <= 1 for value in row.values())
        assert sum(row.values()) == pytest.approx(1.0)


def test_onnx_checksum_mismatch_fails_closed_when_dependencies_available():
    pytest.importorskip("onnx")
    pytest.importorskip("onnxruntime")
    asset = {
        "schema_version": 1,
        "task": "regression",
        "model": "linear",
        "schema": {"features": ["x"], "numeric_features": ["x"]},
        "artifact": {
            "kind": "onnx", "available": True,
            "bytes_base64": "AA==", "sha256": "not-the-checksum",
        },
    }
    with pytest.raises(Exception) as exc:
        M.score(M.ScoreRequest(asset=asset, rows=[{"x": 1.0}]))
    assert "checksum" in str(exc.value).lower()
