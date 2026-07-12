"""Tests for reliability.Regression module."""
import numpy as np
import pytest
from reliability.Regression import (
    linear_regression,
    ridge_regression,
    lasso_regression,
    elastic_net_regression,
    logistic_regression,
    polynomial_regression,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_xy(slope=2.0, intercept=1.0, n=50, noise=0.05, seed=42):
    rng = np.random.default_rng(seed)
    x = np.linspace(0, 10, n)
    y = slope * x + intercept + rng.normal(0, noise, n)
    return x, y


# ---------------------------------------------------------------------------
# 1. Linear regression
# ---------------------------------------------------------------------------

class TestLinearRegression:
    def test_slope_intercept(self):
        x, y = _make_xy(slope=2.0, intercept=1.0)
        X = x.reshape(-1, 1)
        res = linear_regression(X, y, feature_names=["x"])
        # Intercept ~ 1
        assert abs(res["intercept"] - 1.0) < 0.1, f"intercept={res['intercept']}"
        # Slope ~ 2
        assert abs(res["coefficients"][0] - 2.0) < 0.1, f"coeff={res['coefficients'][0]}"

    def test_r2_near_one(self):
        x, y = _make_xy(noise=0.01)
        X = x.reshape(-1, 1)
        res = linear_regression(X, y, feature_names=["x"])
        assert res["r2"] > 0.999, f"R2={res['r2']}"

    def test_residuals_sum_to_zero(self):
        x, y = _make_xy()
        X = x.reshape(-1, 1)
        res = linear_regression(X, y, feature_names=["x"])
        assert abs(sum(res["residuals"])) < 1e-8

    def test_p_values_significant(self):
        x, y = _make_xy(slope=2.0, noise=0.01)
        X = x.reshape(-1, 1)
        res = linear_regression(X, y, feature_names=["x"])
        # Slope should be highly significant
        assert res["p_values"][0] < 0.05

    def test_output_keys(self):
        x, y = _make_xy()
        X = x.reshape(-1, 1)
        res = linear_regression(X, y, feature_names=["x"])
        for key in [
            "feature_names", "coefficients", "intercept", "std_errors",
            "t_values", "p_values", "conf_int", "r2", "adj_r2",
            "f_stat", "f_pvalue", "rmse", "residuals", "fitted", "n", "df_resid"
        ]:
            assert key in res, f"Missing key: {key}"

    def test_conf_int_contains_true(self):
        x, y = _make_xy(slope=2.0, intercept=1.0, noise=0.01)
        X = x.reshape(-1, 1)
        res = linear_regression(X, y, feature_names=["x"])
        lo, hi = res["conf_int"][0]
        assert lo < 2.0 < hi, f"True slope 2.0 not in CI [{lo}, {hi}]"

    def test_no_intercept(self):
        rng = np.random.default_rng(7)
        x = np.linspace(1, 10, 30)
        y = 3.5 * x + rng.normal(0, 0.1, 30)
        X = x.reshape(-1, 1)
        res = linear_regression(X, y, feature_names=["x"], fit_intercept=False)
        assert res["intercept"] is None
        assert abs(res["coefficients"][0] - 3.5) < 0.2

    def test_too_few_obs_raises(self):
        X = np.ones((2, 3))
        y = np.array([1.0, 2.0])
        with pytest.raises(ValueError):
            linear_regression(X, y, feature_names=["a", "b", "c"])

    def test_fitted_length(self):
        x, y = _make_xy(n=30)
        X = x.reshape(-1, 1)
        res = linear_regression(X, y, feature_names=["x"])
        assert len(res["fitted"]) == 30
        assert len(res["residuals"]) == 30

    def test_rank_deficient_design_blocks_inference(self):
        x = np.linspace(0, 10, 30)
        X = np.column_stack([x, 2 * x])
        y = 1 + 3 * x
        with pytest.raises(ValueError, match="Rank-deficient") as exc:
            linear_regression(X, y, feature_names=["x", "duplicate_x"])
        assert "Aliased term" in str(exc.value)

    def test_condition_diagnostics_are_reported(self):
        x, y = _make_xy()
        res = linear_regression(x.reshape(-1, 1), y, feature_names=["x"])
        d = res["diagnostics"]
        assert d["matrix_rank"] == d["n_parameters"] == 2
        assert d["rank_deficient"] is False
        assert d["condition_number"] >= 1


# ---------------------------------------------------------------------------
# 2. Ridge regression
# ---------------------------------------------------------------------------

class TestRidgeRegression:
    def test_alpha_zero_approx_ols(self):
        """Ridge with alpha=0 should reproduce OLS coefficients and intercept."""
        x, y = _make_xy(slope=2.0, intercept=1.0, n=50, noise=0.05)
        X = x.reshape(-1, 1)
        ols = linear_regression(X, y, feature_names=["x"])
        ridge = ridge_regression(X, y, alpha=0.0, feature_names=["x"])

        assert abs(ridge["intercept"] - ols["intercept"]) < 1e-4, (
            f"intercept OLS={ols['intercept']:.6f} ridge={ridge['intercept']:.6f}"
        )
        assert abs(ridge["coefficients"][0] - ols["coefficients"][0]) < 1e-4, (
            f"coeff OLS={ols['coefficients'][0]:.6f} ridge={ridge['coefficients'][0]:.6f}"
        )

    def test_large_alpha_shrinks_coeff(self):
        x, y = _make_xy(slope=5.0)
        X = x.reshape(-1, 1)
        r_small = ridge_regression(X, y, alpha=1e-6, feature_names=["x"])
        r_large = ridge_regression(X, y, alpha=1e6, feature_names=["x"])
        assert abs(r_large["coefficients"][0]) < abs(r_small["coefficients"][0])

    def test_output_keys(self):
        x, y = _make_xy()
        X = x.reshape(-1, 1)
        res = ridge_regression(X, y, alpha=1.0, feature_names=["x"])
        for key in ["feature_names", "coefficients", "intercept", "r2", "rmse",
                    "fitted", "residuals", "alpha"]:
            assert key in res

    def test_multivariate(self):
        rng = np.random.default_rng(99)
        n = 80
        X = rng.normal(0, 1, (n, 3))
        y = X @ np.array([1.0, -2.0, 0.5]) + rng.normal(0, 0.2, n)
        res = ridge_regression(X, y, alpha=0.01, feature_names=["a", "b", "c"])
        assert res["r2"] > 0.9

    def test_negative_alpha_rejected(self):
        x, y = _make_xy()
        with pytest.raises(ValueError, match="non-negative"):
            ridge_regression(x, y, alpha=-1, feature_names=["x"])


# ---------------------------------------------------------------------------
# 3. Lasso regression
# ---------------------------------------------------------------------------

class TestLassoRegression:
    def test_shrinks_irrelevant_feature(self):
        """Lasso with high alpha should drive a zero-coefficient predictor near zero."""
        rng = np.random.default_rng(123)
        n = 100
        x_rel = rng.normal(0, 1, n)
        x_irr = rng.normal(0, 1, n)
        y = 3.0 * x_rel + rng.normal(0, 0.5, n)
        X = np.column_stack([x_rel, x_irr])
        res = lasso_regression(X, y, alpha=0.5, feature_names=["x_rel", "x_irr"])
        # Relevant feature has a non-trivial coefficient
        assert abs(res["coefficients"][0]) > abs(res["coefficients"][1])

    def test_alpha_zero_approx_ols(self):
        x, y = _make_xy(noise=0.05, n=60)
        X = x.reshape(-1, 1)
        ols = linear_regression(X, y, feature_names=["x"])
        lasso = lasso_regression(X, y, alpha=1e-8, feature_names=["x"],
                                  max_iter=5000, tol=1e-9)
        assert abs(lasso["coefficients"][0] - ols["coefficients"][0]) < 0.05

    def test_n_nonzero(self):
        rng = np.random.default_rng(5)
        n = 100
        X = rng.normal(0, 1, (n, 5))
        y = X[:, 0] * 2 + rng.normal(0, 0.1, n)
        res = lasso_regression(X, y, alpha=1.0, feature_names=list("abcde"))
        # At least one feature should be zeroed out with strong regularization
        assert res["n_nonzero"] < 5

    def test_output_keys(self):
        x, y = _make_xy()
        X = x.reshape(-1, 1)
        res = lasso_regression(X, y, alpha=0.1, feature_names=["x"])
        for key in ["feature_names", "coefficients", "intercept", "n_nonzero",
                    "r2", "rmse", "fitted", "residuals", "alpha"]:
            assert key in res

    def test_convergence_status_is_visible(self):
        x, y = _make_xy()
        res = lasso_regression(x, y, alpha=0.1, feature_names=["x"], max_iter=1)
        assert res["n_iter"] == 1
        assert isinstance(res["converged"], bool)
        assert (res["convergence_warning"] is None) == res["converged"]

    def test_kkt_optimality_and_tolerance_stability_are_reported(self):
        rng = np.random.default_rng(2026)
        X = rng.normal(size=(180, 5))
        y = 2.5 * X[:, 0] - 1.2 * X[:, 2] + rng.normal(0, 0.2, 180)
        result = lasso_regression(
            X, y, alpha=5.0, feature_names=list("abcde"), tol=1e-7)

        assert result["converged"] is True
        assert result["optimality_checked"] is True
        assert result["kkt_residual"] <= result["kkt_tolerance"]
        assert result["objective"] >= 0
        assert result["active_set"] == ["a", "c"]
        assert result["active_set_stable"] is True
        stability = result["active_set_stability"]
        assert stability["method"] == "stricter_tolerance_refit"
        assert stability["comparison_tolerance"] < stability["reference_tolerance"]
        assert stability["same_support"] is True
        assert stability["jaccard_similarity"] == 1.0

    def test_negative_alpha_rejected(self):
        x, y = _make_xy()
        with pytest.raises(ValueError, match="non-negative"):
            lasso_regression(x, y, alpha=-0.1, feature_names=["x"])


def test_elastic_net_validates_l1_ratio_and_reports_convergence():
    x, y = _make_xy()
    with pytest.raises(ValueError, match="l1_ratio"):
        elastic_net_regression(x, y, alpha=0.1, l1_ratio=1.1, feature_names=["x"])
    result = elastic_net_regression(
        x, y, alpha=0.1, l1_ratio=0.5, feature_names=["x"], max_iter=1
    )
    assert result["n_iter"] == 1
    assert isinstance(result["converged"], bool)


def test_elastic_net_reports_kkt_and_active_set_stability():
    rng = np.random.default_rng(480)
    X = rng.normal(size=(160, 4))
    y = 1.8 * X[:, 0] - 0.9 * X[:, 1] + rng.normal(0, 0.25, 160)
    result = elastic_net_regression(
        X, y, alpha=0.6, l1_ratio=0.7,
        feature_names=["x1", "x2", "x3", "x4"], tol=1e-7,
    )
    assert result["converged"] is True
    assert result["optimality_checked"] is True
    assert result["kkt_residual"] <= result["kkt_tolerance"]
    assert result["active_set_stability"]["comparison_converged"] is True
    assert result["active_set_stable"] is True


# ---------------------------------------------------------------------------
# 4. Logistic regression
# ---------------------------------------------------------------------------

class TestLogisticRegression:
    def _make_separable(self, n=100, seed=7):
        """Perfectly separable data: y=1 if x>0, y=0 if x<0."""
        rng = np.random.default_rng(seed)
        x = rng.uniform(-3, 3, n)
        y = (x > 0).astype(float)
        return x.reshape(-1, 1), y

    def test_converges(self):
        X, y = self._make_separable()
        res = logistic_regression(X, y, feature_names=["x"])
        assert res["converged"] or res["n_iter"] > 0

    def test_high_accuracy_separable(self):
        X, y = self._make_separable(n=200)
        res = logistic_regression(X, y, feature_names=["x"])
        assert res["accuracy"] >= 0.95, f"accuracy={res['accuracy']}"

    def test_output_keys(self):
        X, y = self._make_separable()
        res = logistic_regression(X, y, feature_names=["x"])
        for key in [
            "feature_names", "coefficients", "intercept", "std_errors",
            "z_values", "p_values", "odds_ratios", "conf_int",
            "log_likelihood", "null_log_likelihood", "mcfadden_r2",
            "n_iter", "converged", "predicted_probabilities",
            "accuracy", "confusion_matrix", "roc"
        ]:
            assert key in res, f"Missing key: {key}"

    def test_roc_auc_high(self):
        X, y = self._make_separable(n=200)
        res = logistic_regression(X, y, feature_names=["x"])
        assert res["roc"]["auc"] >= 0.95, f"AUC={res['roc']['auc']}"

    def test_non_binary_raises(self):
        X = np.array([[1], [2], [3]])
        y = np.array([0, 1, 2])
        with pytest.raises(ValueError):
            logistic_regression(X, y, feature_names=["x"])

    def test_single_class_raises(self):
        X = np.array([[1], [2], [3]])
        y = np.array([1, 1, 1])
        with pytest.raises(ValueError):
            logistic_regression(X, y, feature_names=["x"])

    def test_probabilities_in_range(self):
        X, y = self._make_separable()
        res = logistic_regression(X, y, feature_names=["x"])
        probs = np.array(res["predicted_probabilities"])
        assert np.all(probs >= 0.0) and np.all(probs <= 1.0)

    def test_mcfadden_r2_positive(self):
        X, y = self._make_separable(n=150)
        res = logistic_regression(X, y, feature_names=["x"])
        assert res["mcfadden_r2"] > 0.0

    def test_confusion_matrix_shape(self):
        X, y = self._make_separable()
        res = logistic_regression(X, y, feature_names=["x"])
        cm = res["confusion_matrix"]
        assert len(cm) == 2
        assert len(cm[0]) == 2 and len(cm[1]) == 2
        # Sum of all cells equals n
        total = sum(cm[0]) + sum(cm[1])
        assert total == len(y)


# ---------------------------------------------------------------------------
# 5. Polynomial regression
# ---------------------------------------------------------------------------

class TestPolynomialRegression:
    def test_degree1_matches_linear(self):
        x, y = _make_xy(slope=2.0, intercept=1.0, noise=0.05)
        X = x.reshape(-1, 1)
        lin = linear_regression(X, y, feature_names=["x"])
        poly = polynomial_regression(x, y, degree=1)
        assert abs(poly["r2"] - lin["r2"]) < 1e-10

    def test_degree2_fits_quadratic(self):
        rng = np.random.default_rng(13)
        x = np.linspace(-3, 3, 80)
        y = 2 * x ** 2 - x + 3 + rng.normal(0, 0.1, 80)
        res = polynomial_regression(x, y, degree=2)
        assert res["r2"] > 0.99

    def test_output_keys(self):
        x, y = _make_xy()
        res = polynomial_regression(x, y, degree=2)
        for key in ["degree", "x_grid", "y_grid", "r2", "rmse",
                    "fitted", "residuals", "coefficients", "intercept"]:
            assert key in res, f"Missing key: {key}"

    def test_smooth_curve_length(self):
        x, y = _make_xy()
        res = polynomial_regression(x, y, degree=3)
        assert len(res["x_grid"]) == 200
        assert len(res["y_grid"]) == 200

    def test_degree_less_than_1_raises(self):
        x, y = _make_xy()
        with pytest.raises(ValueError):
            polynomial_regression(x, y, degree=0)

    def test_too_few_obs_raises(self):
        with pytest.raises(ValueError):
            polynomial_regression([1, 2], [1, 2], degree=3)
