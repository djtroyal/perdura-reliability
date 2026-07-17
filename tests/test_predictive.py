"""Tests for predictive analytics (sklearn fits + CHAID)."""

import numpy as np
import pytest

from reliability.CHAID import CHAIDTree
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor


def test_classification_accuracy_high_on_separable_data():
    rng = np.random.default_rng(0)
    n = 200
    x1 = np.concatenate([rng.normal(0, 0.5, n), rng.normal(5, 0.5, n)])
    x2 = np.concatenate([rng.normal(0, 0.5, n), rng.normal(5, 0.5, n)])
    y = np.array([0] * n + [1] * n)
    X = np.column_stack([x1, x2])
    clf = DecisionTreeClassifier(random_state=42).fit(X, y)
    assert clf.score(X, y) > 0.95
    # feature importances sum to ~1
    assert abs(clf.feature_importances_.sum() - 1.0) < 1e-9


def test_regression_r2_high_on_linear_data():
    rng = np.random.default_rng(1)
    x1 = rng.uniform(0, 10, 300)
    x2 = rng.uniform(0, 10, 300)
    y = 3 * x1 + 2 * x2 + rng.normal(0, 0.2, 300)
    X = np.column_stack([x1, x2])
    rf = RandomForestRegressor(n_estimators=100, random_state=42).fit(X, y)
    from sklearn.metrics import r2_score
    assert r2_score(y, rf.predict(X)) > 0.9
    assert abs(rf.feature_importances_.sum() - 1.0) < 1e-6


def test_random_forest_importances_sum_to_one():
    rng = np.random.default_rng(2)
    X = rng.normal(0, 1, (100, 3))
    y = (X[:, 0] + X[:, 1] > 0).astype(int)
    rf = RandomForestClassifier(n_estimators=50, random_state=42).fit(X, y)
    assert abs(rf.feature_importances_.sum() - 1.0) < 1e-6


def test_chaid_fits_and_predicts():
    rng = np.random.default_rng(3)
    n = 150
    # Two well-separated groups => CHAID should classify well.
    x1 = np.concatenate([rng.normal(0, 0.5, n), rng.normal(10, 0.5, n)])
    x2 = rng.normal(0, 1, 2 * n)
    y = np.array(["A"] * n + ["B"] * n)
    X = np.column_stack([x1, x2])
    tree = CHAIDTree(max_depth=3, min_samples_split=10).fit(
        X, y, feature_names=["x1", "x2"])
    assert tree.score(X, y) > 0.9
    # importances normalised to ~1
    assert abs(tree.feature_importances_.sum() - 1.0) < 1e-9
    # x1 should dominate
    assert tree.feature_importances_[0] > tree.feature_importances_[1]
    probabilities = tree.predict_proba(X[:10])
    assert probabilities.shape == (10, 2)
    assert np.allclose(probabilities.sum(axis=1), 1.0)
    d = tree.to_dict()
    assert "prediction" in d
    assert "class_probabilities" in d


def test_chaid_serialisable_tree():
    rng = np.random.default_rng(4)
    X = rng.integers(0, 3, (60, 2)).astype(str)
    y = X[:, 0]  # target equals first feature
    tree = CHAIDTree(max_depth=3, min_samples_split=5, alpha=0.9).fit(
        X, y, feature_names=["a", "b"])
    d = tree.to_dict()
    import json
    json.dumps(d)  # must be JSON serialisable
