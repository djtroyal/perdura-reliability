"""
Regression module for Perdura reliability suite.

Implements OLS, Ridge, Lasso, Logistic, and Polynomial regression
from scratch using only numpy and scipy.
"""

import numpy as np
from scipy import stats


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _to_array(data) -> np.ndarray:
    return np.asarray(data, dtype=float)


def _build_X(X_raw, fit_intercept: bool) -> np.ndarray:
    X = _to_array(X_raw)
    if X.ndim == 1:
        X = X.reshape(-1, 1)
    if fit_intercept:
        X = np.column_stack([np.ones(X.shape[0]), X])
    return X


def _r2(y: np.ndarray, fitted: np.ndarray) -> float:
    ss_res = np.sum((y - fitted) ** 2)
    ss_tot = np.sum((y - np.mean(y)) ** 2)
    if ss_tot == 0:
        return 1.0 if ss_res == 0 else 0.0
    return float(1.0 - ss_res / ss_tot)


def _safe_pinv(A: np.ndarray) -> np.ndarray:
    """Pseudo-inverse with fallback to lstsq."""
    return np.linalg.pinv(A)


# ---------------------------------------------------------------------------
# 1. Linear (OLS) Regression
# ---------------------------------------------------------------------------

def linear_regression(X, y, feature_names: list[str], fit_intercept: bool = True,
                      CI: float = 0.95) -> dict:
    """
    Ordinary Least Squares regression via numpy.linalg.lstsq / normal equations.

    Parameters
    ----------
    X : array-like, shape (n, p)
    y : array-like, shape (n,)
    feature_names : list of str, length p (predictor names, without intercept)
    fit_intercept : bool

    Returns
    -------
    dict with keys:
        feature_names, coefficients, intercept (or None),
        std_errors, t_values, p_values, conf_int (list of [lo, hi]),
        r2, adj_r2, f_stat, f_pvalue, rmse,
        residuals, fitted, n, df_resid
    """
    X_arr = _to_array(X)
    if X_arr.ndim == 1:
        X_arr = X_arr.reshape(-1, 1)
    y_arr = _to_array(y).ravel()

    n, p = X_arr.shape
    if n < p + int(fit_intercept):
        raise ValueError(
            f"Fewer observations ({n}) than parameters ({p + int(fit_intercept)}). "
            "Cannot fit OLS."
        )

    if len(feature_names) != p:
        raise ValueError(
            f"feature_names length ({len(feature_names)}) must equal number of columns in X ({p})."
        )

    Xd = _build_X(X_arr, fit_intercept)
    n_params = Xd.shape[1]

    # Solve via lstsq (handles rank-deficient cases gracefully)
    coeffs, _, rank, _ = np.linalg.lstsq(Xd, y_arr, rcond=None)

    fitted = Xd @ coeffs
    residuals = y_arr - fitted
    df_resid = n - n_params

    if df_resid <= 0:
        raise ValueError("No degrees of freedom remaining for residuals.")

    mse = np.sum(residuals ** 2) / df_resid
    rmse = float(np.sqrt(mse))

    # Covariance matrix
    XtX = Xd.T @ Xd
    try:
        XtX_inv = np.linalg.inv(XtX)
    except np.linalg.LinAlgError:
        XtX_inv = _safe_pinv(XtX)

    var_coeffs = mse * np.diag(XtX_inv)
    std_errors = np.sqrt(np.maximum(var_coeffs, 0.0))
    t_values = coeffs / np.where(std_errors == 0, np.nan, std_errors)

    t_dist = stats.t(df=df_resid)
    p_values = 2.0 * (1.0 - t_dist.cdf(np.abs(t_values)))

    t_crit = t_dist.ppf(1.0 - (1.0 - CI) / 2.0)
    conf_int = [[float(c - t_crit * se), float(c + t_crit * se)]
                for c, se in zip(coeffs, std_errors)]

    r2 = _r2(y_arr, fitted)
    adj_r2 = float(1.0 - (1.0 - r2) * (n - 1) / df_resid) if df_resid > 0 else 0.0

    # F-statistic
    p_predictors = n_params - int(fit_intercept)
    if p_predictors > 0:
        ss_reg = np.sum((fitted - np.mean(y_arr)) ** 2)
        ms_reg = ss_reg / p_predictors
        f_stat = float(ms_reg / mse) if mse > 0 else 0.0
        f_pvalue = float(1.0 - stats.f.cdf(f_stat, p_predictors, df_resid))
    else:
        f_stat = 0.0
        f_pvalue = 1.0

    if fit_intercept:
        intercept = float(coeffs[0])
        coef_values = coeffs[1:].tolist()
        se_values = std_errors[1:].tolist()
        t_values_out = t_values[1:].tolist()
        p_values_out = p_values[1:].tolist()
        ci_out = conf_int[1:]
    else:
        intercept = None
        coef_values = coeffs.tolist()
        se_values = std_errors.tolist()
        t_values_out = t_values.tolist()
        p_values_out = p_values.tolist()
        ci_out = conf_int

    return {
        "feature_names": feature_names,
        "coefficients": coef_values,
        "intercept": intercept,
        "std_errors": se_values,
        "t_values": t_values_out,
        "p_values": p_values_out,
        "conf_int": ci_out,
        "CI": float(CI),
        "r2": float(r2),
        "adj_r2": float(adj_r2),
        "f_stat": float(f_stat),
        "f_pvalue": float(f_pvalue),
        "rmse": float(rmse),
        "residuals": residuals.tolist(),
        "fitted": fitted.tolist(),
        "n": int(n),
        "df_resid": int(df_resid),
    }


# ---------------------------------------------------------------------------
# 2. Ridge Regression
# ---------------------------------------------------------------------------

def ridge_regression(X, y, alpha: float, feature_names: list[str]) -> dict:
    """
    Ridge regression: standardize X, solve (X'X + alpha*I)^-1 X'y,
    back-transform to original scale.

    Parameters
    ----------
    X : array-like, shape (n, p)
    y : array-like, shape (n,)
    alpha : float, regularization strength (>= 0)
    feature_names : list of str, length p

    Returns
    -------
    dict with: feature_names, coefficients (original scale), intercept,
               r2, rmse, fitted, residuals, alpha
    """
    X_arr = _to_array(X)
    if X_arr.ndim == 1:
        X_arr = X_arr.reshape(-1, 1)
    y_arr = _to_array(y).ravel()

    n, p = X_arr.shape
    if n < 2:
        raise ValueError("Need at least 2 observations for ridge regression.")
    if len(feature_names) != p:
        raise ValueError(
            f"feature_names length ({len(feature_names)}) must equal number of columns in X ({p})."
        )

    # Standardize X
    X_mean = X_arr.mean(axis=0)
    X_std = X_arr.std(axis=0, ddof=0)
    X_std = np.where(X_std == 0, 1.0, X_std)  # avoid divide-by-zero
    Xs = (X_arr - X_mean) / X_std

    y_mean = y_arr.mean()
    ys = y_arr - y_mean

    # Closed-form ridge: beta_s = (Xs'Xs + alpha*I)^-1 Xs' ys
    A = Xs.T @ Xs + alpha * np.eye(p)
    try:
        A_inv = np.linalg.inv(A)
    except np.linalg.LinAlgError:
        A_inv = _safe_pinv(A)

    beta_s = A_inv @ (Xs.T @ ys)

    # Back-transform to original scale
    coeffs = beta_s / X_std
    intercept = float(y_mean - X_mean @ coeffs)

    fitted = X_arr @ coeffs + intercept
    residuals = y_arr - fitted
    r2 = _r2(y_arr, fitted)
    rmse = float(np.sqrt(np.mean(residuals ** 2)))

    return {
        "feature_names": feature_names,
        "coefficients": coeffs.tolist(),
        "intercept": intercept,
        "r2": float(r2),
        "rmse": float(rmse),
        "fitted": fitted.tolist(),
        "residuals": residuals.tolist(),
        "alpha": float(alpha),
    }


# ---------------------------------------------------------------------------
# 3. Lasso Regression (coordinate descent)
# ---------------------------------------------------------------------------

def _soft_threshold(x: np.ndarray, lam: float) -> np.ndarray:
    return np.sign(x) * np.maximum(np.abs(x) - lam, 0.0)


def lasso_regression(
    X, y, alpha: float, feature_names: list[str],
    max_iter: int = 1000, tol: float = 1e-6
) -> dict:
    """
    Lasso regression via coordinate descent with soft-thresholding.
    Standardizes X, runs coordinate descent, then back-transforms.

    Parameters
    ----------
    X : array-like, shape (n, p)
    y : array-like, shape (n,)
    alpha : float, regularization strength (>= 0)
    feature_names : list of str, length p
    max_iter : int
    tol : float

    Returns
    -------
    dict with: feature_names, coefficients, intercept, n_nonzero,
               r2, rmse, fitted, residuals, alpha
    """
    X_arr = _to_array(X)
    if X_arr.ndim == 1:
        X_arr = X_arr.reshape(-1, 1)
    y_arr = _to_array(y).ravel()

    n, p = X_arr.shape
    if n < 2:
        raise ValueError("Need at least 2 observations for lasso regression.")
    if len(feature_names) != p:
        raise ValueError(
            f"feature_names length ({len(feature_names)}) must equal number of columns in X ({p})."
        )

    # Standardize
    X_mean = X_arr.mean(axis=0)
    X_std = X_arr.std(axis=0, ddof=0)
    X_std = np.where(X_std == 0, 1.0, X_std)
    Xs = (X_arr - X_mean) / X_std

    y_mean = y_arr.mean()
    ys = y_arr - y_mean

    # Coordinate descent (cyclic)
    beta = np.zeros(p)
    # Precompute column norms squared
    col_norms_sq = np.sum(Xs ** 2, axis=0)  # shape (p,)

    for _ in range(max_iter):
        beta_old = beta.copy()
        for j in range(p):
            # Partial residual excluding j-th feature
            r_j = ys - Xs @ beta + Xs[:, j] * beta[j]
            rho_j = Xs[:, j] @ r_j
            norm_sq = col_norms_sq[j]
            if norm_sq == 0:
                beta[j] = 0.0
            else:
                beta[j] = float(_soft_threshold(np.array([rho_j / norm_sq]), alpha / norm_sq)[0])

        if np.max(np.abs(beta - beta_old)) < tol:
            break

    # Back-transform
    coeffs = beta / X_std
    intercept = float(y_mean - X_mean @ coeffs)

    fitted = X_arr @ coeffs + intercept
    residuals = y_arr - fitted
    r2 = _r2(y_arr, fitted)
    rmse = float(np.sqrt(np.mean(residuals ** 2)))
    n_nonzero = int(np.sum(np.abs(coeffs) > 1e-10))

    return {
        "feature_names": feature_names,
        "coefficients": coeffs.tolist(),
        "intercept": intercept,
        "n_nonzero": n_nonzero,
        "r2": float(r2),
        "rmse": float(rmse),
        "fitted": fitted.tolist(),
        "residuals": residuals.tolist(),
        "alpha": float(alpha),
    }


# ---------------------------------------------------------------------------
# 3b. Elastic Net Regression (coordinate descent, L1+L2)
# ---------------------------------------------------------------------------

def elastic_net_regression(
    X, y, alpha: float, l1_ratio: float, feature_names: list[str],
    max_iter: int = 1000, tol: float = 1e-6
) -> dict:
    X_arr = _to_array(X)
    if X_arr.ndim == 1:
        X_arr = X_arr.reshape(-1, 1)
    y_arr = _to_array(y).ravel()

    n, p = X_arr.shape
    if n < 2:
        raise ValueError("Need at least 2 observations for elastic net regression.")
    if len(feature_names) != p:
        raise ValueError(
            f"feature_names length ({len(feature_names)}) must equal number of columns in X ({p})."
        )

    X_mean = X_arr.mean(axis=0)
    X_std = X_arr.std(axis=0, ddof=0)
    X_std = np.where(X_std == 0, 1.0, X_std)
    Xs = (X_arr - X_mean) / X_std

    y_mean = y_arr.mean()
    ys = y_arr - y_mean

    beta = np.zeros(p)
    col_norms_sq = np.sum(Xs ** 2, axis=0)

    for _ in range(max_iter):
        beta_old = beta.copy()
        for j in range(p):
            r_j = ys - Xs @ beta + Xs[:, j] * beta[j]
            rho_j = Xs[:, j] @ r_j
            norm_sq = col_norms_sq[j]
            if norm_sq == 0:
                beta[j] = 0.0
            else:
                beta[j] = float(
                    _soft_threshold(np.array([rho_j]), alpha * l1_ratio)[0]
                    / (norm_sq + alpha * (1 - l1_ratio))
                )

        if np.max(np.abs(beta - beta_old)) < tol:
            break

    coeffs = beta / X_std
    intercept = float(y_mean - X_mean @ coeffs)

    fitted = X_arr @ coeffs + intercept
    residuals = y_arr - fitted
    r2 = _r2(y_arr, fitted)
    rmse = float(np.sqrt(np.mean(residuals ** 2)))
    n_nonzero = int(np.sum(np.abs(coeffs) > 1e-10))

    return {
        "feature_names": feature_names,
        "coefficients": coeffs.tolist(),
        "intercept": intercept,
        "n_nonzero": n_nonzero,
        "r2": float(r2),
        "rmse": float(rmse),
        "fitted": fitted.tolist(),
        "residuals": residuals.tolist(),
        "alpha": float(alpha),
        "l1_ratio": float(l1_ratio),
    }


# ---------------------------------------------------------------------------
# 4. Logistic Regression (Newton-Raphson / IRLS)
# ---------------------------------------------------------------------------

def _sigmoid(z: np.ndarray) -> np.ndarray:
    z = np.asarray(z, dtype=float)
    out = np.empty_like(z)
    pos = z >= 0
    out[pos] = 1.0 / (1.0 + np.exp(-z[pos]))
    neg = ~pos
    ez = np.exp(z[neg])
    out[neg] = ez / (1.0 + ez)
    return out


def _roc_auc(y_true: np.ndarray, y_score: np.ndarray):
    """Compute ROC curve (fpr, tpr) and AUC via trapezoidal rule."""
    thresholds = np.concatenate([[1.0 + 1e-9], np.sort(np.unique(y_score))[::-1]])
    fpr_list = []
    tpr_list = []
    pos = np.sum(y_true == 1)
    neg = np.sum(y_true == 0)
    if pos == 0 or neg == 0:
        return [0.0, 1.0], [0.0, 1.0], 0.5

    for thresh in thresholds:
        pred = (y_score >= thresh).astype(int)
        tp = np.sum((pred == 1) & (y_true == 1))
        fp = np.sum((pred == 1) & (y_true == 0))
        fpr_list.append(fp / neg)
        tpr_list.append(tp / pos)

    fpr_arr = np.array(fpr_list)
    tpr_arr = np.array(tpr_list)
    auc = float(np.trapezoid(tpr_arr, fpr_arr))  # may be negative if not sorted
    if auc < 0:
        auc = -auc

    return fpr_arr.tolist(), tpr_arr.tolist(), auc


def logistic_regression(
    X, y, feature_names: list[str],
    fit_intercept: bool = True,
    max_iter: int = 100,
    CI: float = 0.95,
) -> dict:
    """
    Logistic regression via Newton-Raphson (IRLS).

    Parameters
    ----------
    X : array-like, shape (n, p)
    y : array-like, shape (n,) — binary 0/1
    feature_names : list of str, length p
    fit_intercept : bool
    max_iter : int

    Returns
    -------
    dict with: feature_names, coefficients, intercept (or None),
               std_errors, z_values, p_values, odds_ratios, conf_int,
               log_likelihood, null_log_likelihood, mcfadden_r2,
               n_iter, converged, predicted_probabilities,
               accuracy, confusion_matrix, roc {fpr, tpr, auc}
    """
    X_arr = _to_array(X)
    if X_arr.ndim == 1:
        X_arr = X_arr.reshape(-1, 1)
    y_arr = _to_array(y).ravel()

    unique_vals = np.unique(y_arr)
    if not set(unique_vals).issubset({0.0, 1.0}):
        raise ValueError("Logistic regression requires binary y with values 0 and 1.")
    if len(unique_vals) < 2:
        raise ValueError("y must contain both class 0 and class 1.")

    n, p = X_arr.shape
    if len(feature_names) != p:
        raise ValueError(
            f"feature_names length ({len(feature_names)}) must equal number of columns in X ({p})."
        )

    Xd = _build_X(X_arr, fit_intercept)
    n_params = Xd.shape[1]

    if n < n_params:
        raise ValueError(
            f"Fewer observations ({n}) than parameters ({n_params})."
        )

    # Initialize coefficients
    beta = np.zeros(n_params)

    converged = False
    n_iter = 0
    tol = 1e-8

    for i in range(max_iter):
        n_iter = i + 1
        mu = _sigmoid(Xd @ beta)
        # Clip to avoid log(0)
        mu = np.clip(mu, 1e-10, 1.0 - 1e-10)
        W = mu * (1.0 - mu)  # weights

        # Score (gradient of log-likelihood)
        score = Xd.T @ (y_arr - mu)

        # Hessian (negative Fisher information)
        # H = -X'WX
        Xw = Xd * W[:, None]
        H = -(Xw.T @ Xd)

        try:
            H_inv = np.linalg.inv(H)
        except np.linalg.LinAlgError:
            H_inv = _safe_pinv(H)

        # Newton step: beta_new = beta - H^-1 * (-score) = beta + H^-1 * score
        # But H = -X'WX, so H^-1 * score means we go: beta_new = beta - (H^-1)(-score)
        # = beta + H^-1 * score ... be careful about sign
        # gradient ascent on log-likelihood: delta = (-H)^-1 * score
        H_pos = Xw.T @ Xd  # X'WX (positive definite)
        try:
            H_pos_inv = np.linalg.inv(H_pos)
        except np.linalg.LinAlgError:
            H_pos_inv = _safe_pinv(H_pos)

        delta = H_pos_inv @ score
        beta_new = beta + delta

        if np.max(np.abs(delta)) < tol:
            beta = beta_new
            converged = True
            break
        beta = beta_new

    # Final probabilities and log-likelihood
    mu = _sigmoid(Xd @ beta)
    mu = np.clip(mu, 1e-10, 1.0 - 1e-10)
    log_likelihood = float(np.sum(y_arr * np.log(mu) + (1 - y_arr) * np.log(1 - mu)))

    # Null log-likelihood (intercept only)
    p_null = float(np.mean(y_arr))
    p_null = np.clip(p_null, 1e-10, 1.0 - 1e-10)
    null_log_likelihood = float(
        n * (p_null * np.log(p_null) + (1 - p_null) * np.log(1 - p_null))
    )

    mcfadden_r2 = float(1.0 - log_likelihood / null_log_likelihood) if null_log_likelihood != 0 else 0.0

    # Standard errors from observed Fisher information
    mu_final = _sigmoid(Xd @ beta)
    mu_final = np.clip(mu_final, 1e-10, 1.0 - 1e-10)
    W_final = mu_final * (1.0 - mu_final)
    XWX = (Xd * W_final[:, None]).T @ Xd
    try:
        cov = np.linalg.inv(XWX)
    except np.linalg.LinAlgError:
        cov = _safe_pinv(XWX)

    std_errors = np.sqrt(np.maximum(np.diag(cov), 0.0))
    z_values = beta / np.where(std_errors == 0, np.nan, std_errors)
    p_values = 2.0 * (1.0 - stats.norm.cdf(np.abs(z_values)))

    z_crit = float(stats.norm.ppf(1.0 - (1.0 - CI) / 2.0))
    conf_int = [[float(b - z_crit * se), float(b + z_crit * se)]
                for b, se in zip(beta, std_errors)]
    odds_ratios = np.exp(beta).tolist()

    # Predictions
    pred_probs = mu_final.tolist()
    pred_class = (mu_final >= 0.5).astype(int)
    accuracy = float(np.mean(pred_class == y_arr))

    TP = int(np.sum((pred_class == 1) & (y_arr == 1)))
    FP = int(np.sum((pred_class == 1) & (y_arr == 0)))
    FN = int(np.sum((pred_class == 0) & (y_arr == 1)))
    TN = int(np.sum((pred_class == 0) & (y_arr == 0)))
    confusion_matrix = [[TN, FP], [FN, TP]]  # [[TN,FP],[FN,TP]]

    fpr, tpr, auc = _roc_auc(y_arr, mu_final)

    if fit_intercept:
        intercept = float(beta[0])
        coef_values = beta[1:].tolist()
        se_out = std_errors[1:].tolist()
        z_out = z_values[1:].tolist()
        p_out = p_values[1:].tolist()
        ci_out = conf_int[1:]
        or_out = np.exp(beta[1:]).tolist()
    else:
        intercept = None
        coef_values = beta.tolist()
        se_out = std_errors.tolist()
        z_out = z_values.tolist()
        p_out = p_values.tolist()
        ci_out = conf_int
        or_out = odds_ratios

    return {
        "feature_names": feature_names,
        "coefficients": coef_values,
        "intercept": intercept,
        "std_errors": se_out,
        "z_values": z_out,
        "p_values": p_out,
        "odds_ratios": or_out,
        "conf_int": ci_out,
        "CI": float(CI),
        "log_likelihood": float(log_likelihood),
        "null_log_likelihood": float(null_log_likelihood),
        "mcfadden_r2": float(mcfadden_r2),
        "n_iter": int(n_iter),
        "converged": bool(converged),
        "predicted_probabilities": pred_probs,
        "accuracy": float(accuracy),
        "confusion_matrix": confusion_matrix,
        "roc": {"fpr": fpr, "tpr": tpr, "auc": float(auc)},
    }


# ---------------------------------------------------------------------------
# 5. Polynomial Regression
# ---------------------------------------------------------------------------

def polynomial_regression(x, y, degree: int, CI: float = 0.95) -> dict:
    """
    Polynomial regression: expand x into [x, x^2, ..., x^degree] then call OLS.

    Parameters
    ----------
    x : array-like, shape (n,)  — single predictor
    y : array-like, shape (n,)
    degree : int >= 1

    Returns
    -------
    dict: same as linear_regression plus 'degree', 'x_grid', 'y_grid'
          (smooth fitted curve for overlay).
    """
    x_arr = _to_array(x).ravel()
    y_arr = _to_array(y).ravel()

    if degree < 1:
        raise ValueError("Polynomial degree must be at least 1.")
    if len(x_arr) != len(y_arr):
        raise ValueError("x and y must have the same length.")
    if len(x_arr) < degree + 1:
        raise ValueError(
            f"Need at least {degree + 1} observations for degree-{degree} polynomial."
        )

    # Build feature matrix [x, x^2, ..., x^degree]
    X_poly = np.column_stack([x_arr ** d for d in range(1, degree + 1)])
    feature_names = [f"x^{d}" if d > 1 else "x" for d in range(1, degree + 1)]

    result = linear_regression(X_poly, y_arr, feature_names=feature_names, fit_intercept=True, CI=CI)

    # Smooth grid for fitted curve overlay
    x_grid = np.linspace(x_arr.min(), x_arr.max(), 200)
    X_grid = np.column_stack([x_grid ** d for d in range(1, degree + 1)])

    coeffs = np.array(result["coefficients"])
    intercept = result["intercept"]
    y_grid = X_grid @ coeffs + (intercept if intercept is not None else 0.0)

    result["degree"] = int(degree)
    result["x_grid"] = x_grid.tolist()
    result["y_grid"] = y_grid.tolist()
    result["x_data"] = x_arr.tolist()
    result["y_data"] = y_arr.tolist()

    return result
