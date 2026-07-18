"""Validation, preprocessing, and calibration guardrails for predictive models."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np

from routers import predictive as P


def _classification_data(n=40):
    x = np.arange(n, dtype=float)
    return {
        "x": x.tolist(),
        "color": (["red", "blue"] * (n // 2)),
        "target": (["no"] * (n // 2) + ["yes"] * (n // 2)),
    }


def test_categorical_features_are_one_hot_in_training_pipeline():
    data = _classification_data()
    result = P.fit(P.FitRequest(
        model="decision_tree", task="classification", data=data,
        target="target", features=["x", "color"], test_size=0.25,
    ))
    prep = result["preprocessing"]
    assert prep["categorical_features"] == ["color"]
    assert prep["categorical_encoding"].startswith("one-hot")
    assert result["validation"]["strategy"] == "stratified"
    assert result["prediction_scope"] == "holdout"


def test_unknown_category_is_accepted_at_prediction_time():
    result = P.predict(P.PredictRequest(
        model="random_forest", task="classification", data=_classification_data(),
        target="target", features=["x", "color"],
        input={"x": 12.0, "color": "previously unseen"},
    ))
    assert result["prediction"] in {"no", "yes"}
    assert result["preprocessing"]["unknown_category_handling"].startswith("ignored")


def test_group_split_has_no_entity_overlap():
    groups = np.repeat(np.arange(12), 2)
    target = np.tile(["no", "yes"], 12)
    data = {
        "x": np.arange(len(groups)).tolist(),
        "target": target.tolist(),
        "asset": groups.tolist(),
    }
    result = P.fit(P.FitRequest(
        model="decision_tree", task="classification", data=data,
        target="target", features=["x"], split_strategy="group",
        group_column="asset", test_size=0.25,
    ))
    assert result["validation"]["strategy"] == "group"
    assert result["validation"]["group_overlap"] is False


def test_time_split_holds_out_latest_rows():
    n = 30
    data = {
        "x": list(range(n)),
        "y": [2 * value for value in range(n)],
        "time": list(range(n)),
    }
    result = P.fit(P.FitRequest(
        model="random_forest", task="regression", data=data,
        target="y", features=["x"], split_strategy="time",
        time_column="time", test_size=0.2,
    ))
    assert result["validation"]["time_order_preserved"] is True
    assert result["actual"] == data["y"][-result["n_test"]:]


def test_probability_calibration_and_imbalance_metrics_are_visible():
    result = P.fit(P.FitRequest(
        model="random_forest", task="classification", data=_classification_data(60),
        target="target", features=["x", "color"], test_size=0.3,
    ))
    metrics = result["metrics"]
    assert 0 <= metrics["balanced_accuracy"] <= 1
    assert metrics["calibration"]["available"] is True
    assert metrics["calibration"]["brier_score"] is not None
    assert metrics["calibration"]["expected_calibration_error"] is not None


def test_calibration_failure_does_not_expose_exception_details():
    class FailingProbabilityModel:
        def predict_proba(self, _values):
            raise RuntimeError("sensitive-internal-calibration-detail")

    metrics = P._classification_metrics(
        np.asarray([0, 1, 0, 1]),
        np.asarray([0, 1, 0, 1]),
        FailingProbabilityModel(),
        np.zeros((4, 1)),
        np.asarray([0, 1]),
    )

    assert metrics["calibration"]["available"] is False
    assert metrics["calibration"]["reason"] == (
        "Calibration diagnostics are unavailable for this fitted model."
    )
    assert "sensitive-internal-calibration-detail" not in str(metrics)


def test_mlp_nonconvergence_is_not_suppressed():
    rng = np.random.default_rng(7)
    n = 80
    data = {
        "x1": rng.normal(size=n).tolist(),
        "x2": rng.normal(size=n).tolist(),
        "y": (rng.normal(size=n) > 0).astype(int).tolist(),
    }
    result = P.fit(P.FitRequest(
        model="mlp", task="classification", data=data,
        target="y", features=["x1", "x2"], test_size=0.25,
        params={"max_iter": 1, "hidden_layer_sizes": [5]},
    ))
    assert result["fit_diagnostics"]["converged"] is False
    assert result["fit_diagnostics"]["warnings"]
