"""
Regression module for Perdura reliability suite.

Implements OLS, Ridge, Lasso, Logistic, and Polynomial regression
from scratch using only numpy and scipy.
"""

import math
import platform
import time

import numpy as np
import scipy
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


def residual_diagnostics(residuals, fitted, leverage=None, mse=None,
                         n_params: int | None = None) -> dict:
    """Residual diagnostics for a fitted regression model.

    Parameters
    ----------
    residuals, fitted : array-like
        Raw residuals e_i = y_i - yhat_i and the fitted values.
    leverage : array-like, optional
        Hat-matrix diagonal h_ii (exact OLS/polynomial only). When given,
        residuals are internally studentized: r_i = e_i / (s*sqrt(1-h_ii)),
        and Cook's distance is computed. Otherwise residuals are scaled by
        their sample standard deviation.
    mse : float, optional
        Residual mean square s^2 (required with leverage).
    n_params : int, optional
        Number of estimated coefficients incl. intercept (for Cook's D).

    Returns
    -------
    dict with std_residuals, qq {theoretical, sample}, leverage, cooks_d,
    shapiro_p, durbin_watson. Q-Q theoretical quantiles use the Blom
    plotting positions Phi^-1((i - 0.375)/(n + 0.25)).
    """
    e = _to_array(residuals).ravel()
    yhat = _to_array(fitted).ravel()
    n = len(e)

    lev = None
    cooks_d = None
    if leverage is not None and mse is not None and mse > 0:
        lev = np.clip(_to_array(leverage).ravel(), 0.0, 1.0 - 1e-12)
        s = np.sqrt(mse)
        std_res = e / (s * np.sqrt(1.0 - lev))
        if n_params is not None and n_params > 0:
            cooks_d = (std_res ** 2 / n_params) * (lev / (1.0 - lev))
    else:
        sd = np.std(e, ddof=1) if n > 1 else 0.0
        std_res = e / sd if sd > 0 else np.zeros_like(e)

    # Q-Q coordinates on the standardized residuals (sorted)
    order = np.argsort(std_res)
    probs = (np.arange(1, n + 1) - 0.375) / (n + 0.25)
    theoretical = stats.norm.ppf(probs)

    shapiro_p = None
    if 3 <= n <= 5000 and np.ptp(e) > 0:
        try:
            shapiro_p = float(stats.shapiro(e).pvalue)
        except Exception:
            shapiro_p = None

    # Durbin-Watson (meaningful when rows are in run/time order)
    dw = None
    if n > 1:
        denom = float(np.sum(e ** 2))
        if denom > 0:
            dw = float(np.sum(np.diff(e) ** 2) / denom)

    return {
        "std_residuals": std_res.tolist(),
        "qq": {
            "theoretical": theoretical.tolist(),
            "sample": std_res[order].tolist(),
        },
        "leverage": lev.tolist() if lev is not None else None,
        "cooks_d": cooks_d.tolist() if cooks_d is not None else None,
        "shapiro_p": shapiro_p,
        "durbin_watson": dw,
        "fitted": yhat.tolist(),
    }


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

    # A least-squares prediction exists for a rank-deficient matrix, but the
    # individual coefficients and their p-values/CIs are not identifiable.
    # Detect aliases before doing any inferential calculations.
    coeffs, _, rank, singular_values = np.linalg.lstsq(Xd, y_arr, rcond=None)
    term_names = (["Intercept"] if fit_intercept else []) + list(feature_names)
    if rank < n_params:
        from scipy.linalg import qr
        _, _, pivots = qr(Xd, mode="economic", pivoting=True)
        aliased = [term_names[i] for i in pivots[rank:]]
        raise ValueError(
            f"Rank-deficient design matrix (rank {rank} of {n_params}); "
            f"coefficient inference is not identifiable. Aliased term(s): "
            f"{', '.join(aliased)}. Remove duplicate/constant predictors or "
            "change the model before interpreting coefficients."
        )

    fitted = Xd @ coeffs
    residuals = y_arr - fitted
    df_resid = n - rank

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

    # Hat-matrix diagonal for studentized residuals / Cook's distance
    leverage = np.einsum('ij,jk,ik->i', Xd, XtX_inv, Xd)

    condition_number = (
        float(singular_values[0] / singular_values[-1])
        if len(singular_values) and singular_values[-1] > 0 else math.inf
    )
    diagnostics = residual_diagnostics(
        residuals, fitted, leverage=leverage, mse=mse, n_params=rank
    )
    diagnostics.update({
        "matrix_rank": int(rank),
        "n_parameters": int(n_params),
        "rank_deficient": False,
        "aliased_terms": [],
        "condition_number": condition_number,
        "condition_warning": (
            "Severe multicollinearity or numerical ill-conditioning; coefficient inference may be unstable."
            if condition_number > 1000 else
            "Moderate multicollinearity; interpret individual coefficients cautiously."
            if condition_number > 30 else None
        ),
    })

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
        "diagnostics": diagnostics,
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
    if not np.isfinite(alpha) or alpha < 0:
        raise ValueError("alpha must be finite and non-negative for ridge regression.")
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
        "converged": True,
        "n_iter": 1,
        "diagnostics": residual_diagnostics(residuals, fitted),
    }


# ---------------------------------------------------------------------------
# 3. Lasso Regression (coordinate descent)
# ---------------------------------------------------------------------------

def _soft_threshold(x: np.ndarray, lam: float) -> np.ndarray:
    return np.sign(x) * np.maximum(np.abs(x) - lam, 0.0)


def _sparse_objective_and_kkt(
    X: np.ndarray,
    y: np.ndarray,
    beta: np.ndarray,
    alpha: float,
    l1_ratio: float,
) -> tuple[float, float]:
    """Return the penalized objective and maximum KKT violation.

    The coordinate updates in this module minimize

        0.5 ||y - X beta||²
        + alpha*l1_ratio*||beta||₁
        + 0.5*alpha*(1-l1_ratio)*||beta||².

    At an optimum, nonzero coordinates have zero signed stationarity
    residual; zero coordinates have a smooth gradient inside the L1
    subgradient interval. The maximum violation gives a scale-aware,
    independently checkable optimality condition.
    """
    residual = y - X @ beta
    l1_penalty = alpha * l1_ratio
    l2_penalty = alpha * (1.0 - l1_ratio)
    objective = (
        0.5 * float(residual @ residual)
        + l1_penalty * float(np.sum(np.abs(beta)))
        + 0.5 * l2_penalty * float(beta @ beta)
    )
    gradient = -(X.T @ residual) + l2_penalty * beta
    active = np.abs(beta) > 1e-12
    violations = np.maximum(np.abs(gradient) - l1_penalty, 0.0)
    if np.any(active):
        violations[active] = np.abs(
            gradient[active] + l1_penalty * np.sign(beta[active]))
    kkt_residual = float(np.max(violations)) if len(violations) else 0.0
    return objective, kkt_residual


def _coordinate_descent_sparse(
    X: np.ndarray,
    y: np.ndarray,
    alpha: float,
    l1_ratio: float,
    max_iter: int,
    tol: float,
    initial_beta: np.ndarray | None = None,
) -> dict:
    """Cyclic coordinate descent with coefficient and KKT stopping tests."""
    p = X.shape[1]
    beta = (np.zeros(p) if initial_beta is None
            else np.asarray(initial_beta, dtype=float).copy())
    residual = y - X @ beta
    col_norms_sq = np.sum(X ** 2, axis=0)
    l1_penalty = alpha * l1_ratio
    l2_penalty = alpha * (1.0 - l1_ratio)
    gradient_scale = float(np.max(np.abs(X.T @ y))) if p else 0.0
    kkt_tolerance = tol * max(1.0, gradient_scale, alpha)

    converged = False
    max_delta = math.inf
    coefficient_tolerance = math.inf
    objective = math.inf
    kkt_residual = math.inf
    n_iter = 0
    previous_active = np.abs(beta) > 1e-10
    stable_sweeps = 0
    active_set_changes = 0

    for iteration in range(max_iter):
        n_iter = iteration + 1
        beta_old = beta.copy()
        for j in range(p):
            norm_sq = col_norms_sq[j]
            if norm_sq == 0:
                new_bj = 0.0
            else:
                rho_j = X[:, j] @ residual + norm_sq * beta[j]
                new_bj = float(
                    _soft_threshold(np.array([rho_j]), l1_penalty)[0]
                    / (norm_sq + l2_penalty)
                )
            if new_bj != beta[j]:
                residual -= X[:, j] * (new_bj - beta[j])
                beta[j] = new_bj

        max_delta = float(np.max(np.abs(beta - beta_old))) if p else 0.0
        coefficient_tolerance = tol * max(
            1.0, float(np.max(np.abs(beta))) if p else 0.0)
        active_threshold = 1e-10 * max(
            1.0, float(np.max(np.abs(beta))) if p else 0.0)
        active = np.abs(beta) > active_threshold
        if np.array_equal(active, previous_active):
            stable_sweeps += 1
        else:
            active_set_changes += 1
            stable_sweeps = 0
        previous_active = active

        objective, kkt_residual = _sparse_objective_and_kkt(
            X, y, beta, alpha, l1_ratio)
        if (max_delta <= coefficient_tolerance
                and kkt_residual <= kkt_tolerance
                and stable_sweeps >= 2):
            converged = True
            break

    return {
        "beta": beta,
        "converged": converged,
        "n_iter": n_iter,
        "max_coefficient_change": max_delta,
        "coefficient_tolerance": coefficient_tolerance,
        "objective": objective,
        "kkt_residual": kkt_residual,
        "kkt_tolerance": kkt_tolerance,
        "active_mask": previous_active,
        "active_set_changes": active_set_changes,
        "active_set_stable_sweeps": stable_sweeps,
    }


def _active_set_stability(
    X: np.ndarray,
    y: np.ndarray,
    alpha: float,
    l1_ratio: float,
    max_iter: int,
    tol: float,
    primary: dict,
    feature_names: list[str],
) -> dict:
    """Compare the selected support with a 10x stricter-tolerance refit."""
    comparison_tolerance = max(np.finfo(float).eps, tol / 10.0)
    comparison = _coordinate_descent_sparse(
        X, y, alpha, l1_ratio, max_iter, comparison_tolerance,
        initial_beta=primary["beta"],
    )
    reference_mask = np.asarray(primary["active_mask"], dtype=bool)
    comparison_mask = np.asarray(comparison["active_mask"], dtype=bool)
    union = int(np.sum(reference_mask | comparison_mask))
    intersection = int(np.sum(reference_mask & comparison_mask))
    same_support = bool(np.array_equal(reference_mask, comparison_mask))
    stable = bool(same_support and comparison["converged"])
    return {
        "method": "stricter_tolerance_refit",
        "reference_tolerance": float(tol),
        "comparison_tolerance": float(comparison_tolerance),
        "reference_active_features": [
            name for name, selected in zip(feature_names, reference_mask)
            if selected
        ],
        "comparison_active_features": [
            name for name, selected in zip(feature_names, comparison_mask)
            if selected
        ],
        "same_support": same_support,
        "jaccard_similarity": float(intersection / union) if union else 1.0,
        "comparison_converged": bool(comparison["converged"]),
        "comparison_n_iter": int(comparison["n_iter"]),
        "comparison_kkt_residual": float(comparison["kkt_residual"]),
        "comparison_kkt_tolerance": float(comparison["kkt_tolerance"]),
        "stable": stable,
    }


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
    if not np.isfinite(alpha) or alpha < 0:
        raise ValueError("alpha must be finite and non-negative for lasso regression.")
    if max_iter < 1 or not np.isfinite(tol) or tol <= 0:
        raise ValueError("max_iter must be positive and tol must be finite and positive.")
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

    optimization = _coordinate_descent_sparse(
        Xs, ys, alpha, 1.0, max_iter, tol)
    beta = optimization["beta"]
    stability = _active_set_stability(
        Xs, ys, alpha, 1.0, max_iter, tol, optimization, feature_names)

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
        "converged": bool(optimization["converged"]),
        "n_iter": int(optimization["n_iter"]),
        "max_coefficient_change": float(optimization["max_coefficient_change"]),
        "coefficient_tolerance": float(optimization["coefficient_tolerance"]),
        "objective": float(optimization["objective"]),
        "optimality_checked": True,
        "kkt_residual": float(optimization["kkt_residual"]),
        "kkt_tolerance": float(optimization["kkt_tolerance"]),
        "active_set": stability["reference_active_features"],
        "active_set_stable": stability["stable"],
        "active_set_changes": int(optimization["active_set_changes"]),
        "active_set_stable_sweeps": int(optimization["active_set_stable_sweeps"]),
        "active_set_stability": stability,
        "convergence_warning": (
            None if optimization["converged"] else
            f"Coordinate descent reached max_iter={max_iter} before both "
            f"coefficient-change and KKT tolerances were satisfied."
        ),
        "diagnostics": residual_diagnostics(residuals, fitted),
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
    if not np.isfinite(alpha) or alpha < 0:
        raise ValueError("alpha must be finite and non-negative for elastic net regression.")
    if not np.isfinite(l1_ratio) or not 0 <= l1_ratio <= 1:
        raise ValueError("l1_ratio must be between 0 and 1.")
    if max_iter < 1 or not np.isfinite(tol) or tol <= 0:
        raise ValueError("max_iter must be positive and tol must be finite and positive.")
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

    optimization = _coordinate_descent_sparse(
        Xs, ys, alpha, l1_ratio, max_iter, tol)
    beta = optimization["beta"]
    stability = _active_set_stability(
        Xs, ys, alpha, l1_ratio, max_iter, tol, optimization, feature_names)

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
        "converged": bool(optimization["converged"]),
        "n_iter": int(optimization["n_iter"]),
        "max_coefficient_change": float(optimization["max_coefficient_change"]),
        "coefficient_tolerance": float(optimization["coefficient_tolerance"]),
        "objective": float(optimization["objective"]),
        "optimality_checked": True,
        "kkt_residual": float(optimization["kkt_residual"]),
        "kkt_tolerance": float(optimization["kkt_tolerance"]),
        "active_set": stability["reference_active_features"],
        "active_set_stable": stability["stable"],
        "active_set_changes": int(optimization["active_set_changes"]),
        "active_set_stable_sweeps": int(optimization["active_set_stable_sweeps"]),
        "active_set_stability": stability,
        "convergence_warning": (
            None if optimization["converged"] else
            f"Coordinate descent reached max_iter={max_iter} before both "
            f"coefficient-change and KKT tolerances were satisfied."
        ),
        "diagnostics": residual_diagnostics(residuals, fitted),
    }


# ---------------------------------------------------------------------------
# 3c. Complementary-pairs stability selection and validation
# ---------------------------------------------------------------------------

def _validate_sparse_selection_inputs(
    X,
    y,
    feature_names: list[str],
) -> tuple[np.ndarray, np.ndarray]:
    """Validate and normalize inputs shared by sparse-selection routines."""
    X_arr = _to_array(X)
    if X_arr.ndim == 1:
        X_arr = X_arr.reshape(-1, 1)
    y_arr = _to_array(y).ravel()

    if X_arr.ndim != 2 or X_arr.shape[1] < 1:
        raise ValueError("X must contain at least one predictor column.")
    if X_arr.shape[0] != len(y_arr):
        raise ValueError("X and y must contain the same number of observations.")
    if X_arr.shape[0] < 4:
        raise ValueError(
            "Complementary-pairs stability selection needs at least 4 observations."
        )
    if len(feature_names) != X_arr.shape[1]:
        raise ValueError(
            f"feature_names length ({len(feature_names)}) must equal number "
            f"of columns in X ({X_arr.shape[1]})."
        )
    if len(set(feature_names)) != len(feature_names):
        raise ValueError("feature_names must be unique for support selection.")
    if not np.all(np.isfinite(X_arr)) or not np.all(np.isfinite(y_arr)):
        raise ValueError("X and y must contain only finite values.")
    return X_arr, y_arr


def _sparse_model_l1_ratio(model: str, l1_ratio: float | None) -> float:
    normalized_model = str(model).strip().lower().replace("-", "_")
    if normalized_model == "lasso":
        if l1_ratio is not None and float(l1_ratio) != 1.0:
            raise ValueError("lasso uses l1_ratio=1; omit l1_ratio or set it to 1.")
        return 1.0
    if normalized_model != "elastic_net":
        raise ValueError("model must be 'lasso' or 'elastic_net'.")
    ratio = 0.5 if l1_ratio is None else float(l1_ratio)
    if not np.isfinite(ratio) or not 0.0 < ratio <= 1.0:
        raise ValueError(
            "l1_ratio must be finite and in (0, 1] for sparse stability selection."
        )
    return ratio


def _standardize_sparse_sample(
    X: np.ndarray,
    y: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    X_mean = X.mean(axis=0)
    X_std = X.std(axis=0, ddof=0)
    X_std = np.where(X_std == 0.0, 1.0, X_std)
    return (X - X_mean) / X_std, y - y.mean()


def _fit_sparse_lambda_path(
    X: np.ndarray,
    y: np.ndarray,
    lambda_path: np.ndarray,
    l1_ratio: float,
    max_iter: int,
    tol: float,
) -> dict:
    """Fit one descending normalized-lambda path on a single half sample."""
    Xs, ys = _standardize_sparse_sample(X, y)
    beta = np.zeros(Xs.shape[1], dtype=float)
    selected = np.zeros((len(lambda_path), Xs.shape[1]), dtype=bool)
    converged = []
    iterations = []
    kkt_residuals = []
    kkt_tolerances = []

    # _coordinate_descent_sparse uses an unnormalized loss.  Multiplying the
    # normalized lambda by the sample size keeps the path comparable across
    # full and half samples.
    for path_index, lambda_value in enumerate(lambda_path):
        fit = _coordinate_descent_sparse(
            Xs,
            ys,
            alpha=float(lambda_value * len(y)),
            l1_ratio=l1_ratio,
            max_iter=max_iter,
            tol=tol,
            initial_beta=beta,
        )
        beta = fit["beta"]
        selected[path_index] = fit["active_mask"]
        converged.append(bool(fit["converged"]))
        iterations.append(int(fit["n_iter"]))
        kkt_residuals.append(float(fit["kkt_residual"]))
        kkt_tolerances.append(float(fit["kkt_tolerance"]))

    return {
        "selected": selected,
        "converged": converged,
        "iterations": iterations,
        "kkt_residuals": kkt_residuals,
        "kkt_tolerances": kkt_tolerances,
    }


def complementary_pairs_stability_selection(
    X,
    y,
    feature_names: list[str],
    *,
    model: str = "lasso",
    l1_ratio: float | None = None,
    lambda_path=None,
    n_lambdas: int = 12,
    lambda_min_ratio: float = 0.05,
    selection_threshold: float = 0.9,
    n_pairs: int = 20,
    random_seed: int = 0,
    max_iter: int = 1000,
    tol: float = 1e-6,
    plug_in_pfer_target: float = 1.0,
) -> dict:
    """Estimate a path-calibrated sparse support from complementary halves.

    Each random permutation produces two disjoint half samples.  Lasso or
    elastic-net supports are evaluated on a common, descending normalized
    lambda path.  One operating lambda is selected by limiting the observed
    mean base-selection size ``q`` to the budget implied by
    ``plug_in_pfer_target``.  A feature is stable only when its selection
    frequency at that one operating lambda reaches ``selection_threshold``.

    The returned PFER quantity is deliberately named a plug-in diagnostic.  It
    substitutes an observed mean for an expectation and does not adjust for
    estimating selection probabilities from finitely many complementary
    pairs, so it is never represented as a formal error bound.  This routine
    deliberately provides no post-selection coefficient confidence intervals.
    """
    started = time.perf_counter()
    X_arr, y_arr = _validate_sparse_selection_inputs(X, y, feature_names)
    n, p = X_arr.shape
    effective_l1_ratio = _sparse_model_l1_ratio(model, l1_ratio)
    normalized_model = "lasso" if str(model).strip().lower() == "lasso" else "elastic_net"

    if isinstance(n_pairs, bool) or int(n_pairs) != n_pairs or n_pairs < 1:
        raise ValueError("n_pairs must be a positive integer.")
    if isinstance(n_lambdas, bool) or int(n_lambdas) != n_lambdas or n_lambdas < 1:
        raise ValueError("n_lambdas must be a positive integer.")
    if not np.isfinite(lambda_min_ratio) or not 0.0 < lambda_min_ratio <= 1.0:
        raise ValueError("lambda_min_ratio must be finite and in (0, 1].")
    if (not np.isfinite(selection_threshold)
            or not 0.5 < selection_threshold <= 1.0):
        raise ValueError("selection_threshold must be finite and in (0.5, 1].")
    if max_iter < 1 or not np.isfinite(tol) or tol <= 0.0:
        raise ValueError("max_iter must be positive and tol must be finite and positive.")
    if (isinstance(random_seed, bool) or int(random_seed) != random_seed
            or random_seed < 0):
        raise ValueError("random_seed must be a non-negative integer.")
    if (not np.isfinite(plug_in_pfer_target)
            or float(plug_in_pfer_target) <= 0.0):
        raise ValueError("plug_in_pfer_target must be finite and positive.")

    half_size = n // 2
    rng = np.random.default_rng(int(random_seed))
    complementary_pairs = []
    for _ in range(int(n_pairs)):
        permutation = rng.permutation(n)
        complementary_pairs.append((
            permutation[:half_size],
            permutation[half_size:2 * half_size],
        ))

    Xs, ys = _standardize_sparse_sample(X_arr, y_arr)
    observed_lambda_max = (
        float(np.max(np.abs(Xs.T @ ys)) / (n * effective_l1_ratio))
        if p else 0.0
    )
    if lambda_path is None:
        # Include the largest lambda-max encountered in the actual half samples
        # so the automatic path always contains a zero-selection operating
        # point.  This makes the q budget enforceable even for small samples.
        half_sample_lambda_max = 0.0
        for pair in complementary_pairs:
            for sample_indices in pair:
                sample_X, sample_y = _standardize_sparse_sample(
                    X_arr[sample_indices], y_arr[sample_indices])
                sample_max = float(
                    np.max(np.abs(sample_X.T @ sample_y))
                    / (half_size * effective_l1_ratio)
                )
                half_sample_lambda_max = max(
                    half_sample_lambda_max, sample_max)
        # A constant response has lambda_max=0.  A machine-scale reference keeps
        # the returned path finite and strictly positive while selecting none.
        path_max = max(
            observed_lambda_max,
            half_sample_lambda_max,
            np.finfo(float).eps,
        )
        path = np.geomspace(
            path_max,
            path_max * float(lambda_min_ratio),
            num=int(n_lambdas),
        )
        path_source = "automatic_geometric"
        path_max_basis = "max_full_and_sampled_half_lambda_max"
    else:
        raw_path = np.asarray(lambda_path, dtype=float).ravel()
        if (len(raw_path) == 0 or not np.all(np.isfinite(raw_path))
                or np.any(raw_path <= 0.0)):
            raise ValueError("lambda_path must contain finite, positive values.")
        path = np.unique(raw_path)[::-1]
        path_source = "explicit_sorted_descending"
        half_sample_lambda_max = None
        path_max_basis = "caller_supplied"

    selection_cube = np.zeros(
        (2 * int(n_pairs), len(path), p), dtype=bool)
    all_converged = []
    all_iterations = []
    all_kkt_residuals = []
    all_kkt_tolerances = []
    for pair_index, complementary_samples in enumerate(complementary_pairs):
        for member_index, sample_indices in enumerate(complementary_samples):
            fit = _fit_sparse_lambda_path(
                X_arr[sample_indices],
                y_arr[sample_indices],
                path,
                effective_l1_ratio,
                int(max_iter),
                float(tol),
            )
            cube_index = 2 * pair_index + member_index
            selection_cube[cube_index] = fit["selected"]
            all_converged.extend(fit["converged"])
            all_iterations.extend(fit["iterations"])
            all_kkt_residuals.extend(fit["kkt_residuals"])
            all_kkt_tolerances.extend(fit["kkt_tolerances"])

    probabilities_by_lambda = selection_cube.mean(axis=0)
    paired = selection_cube.reshape(int(n_pairs), 2, len(path), p)
    simultaneous_by_lambda = np.logical_and(
        paired[:, 0], paired[:, 1]).mean(axis=0)
    selected_counts = selection_cube.sum(axis=2)
    empirical_q_by_lambda = selected_counts.mean(axis=0)
    diagnostic_denominator = (
        (2.0 * float(selection_threshold) - 1.0) * p
    )
    q_budget = float(math.sqrt(
        float(plug_in_pfer_target) * diagnostic_denominator))
    plug_in_pfer_by_lambda = (
        empirical_q_by_lambda ** 2 / diagnostic_denominator)
    feasible_indices = np.flatnonzero(empirical_q_by_lambda <= q_budget + 1e-12)
    if len(feasible_indices):
        # Use as much of the q budget as possible.  For equal q, prefer the
        # less-regularized (later, smaller-lambda) point.
        chosen_path_index = int(max(
            feasible_indices,
            key=lambda index: (empirical_q_by_lambda[index], int(index)),
        ))
        q_budget_met = True
    else:
        # Explicit caller paths need not contain a sufficiently regularized
        # point.  Retain the least-selecting point for diagnostics but decline
        # to return an eligible stable support.
        chosen_path_index = int(np.argmin(empirical_q_by_lambda))
        q_budget_met = False

    chosen_probabilities = probabilities_by_lambda[chosen_path_index]
    diagnostic_candidate_mask = (
        chosen_probabilities >= float(selection_threshold))
    diagnostic_candidate_indices = np.flatnonzero(diagnostic_candidate_mask)
    convergence_complete = bool(all(all_converged))
    support_eligible = bool(q_budget_met and convergence_complete)
    if not q_budget_met:
        support_status = "diagnostic_only_q_budget_not_met"
    elif not convergence_complete:
        support_status = "diagnostic_only_base_fit_nonconvergence"
    else:
        support_status = "eligible_path_calibrated_support"
    selected_indices = (
        diagnostic_candidate_indices
        if support_eligible else np.array([], dtype=int)
    )

    path_results = []
    for path_index, lambda_value in enumerate(path):
        path_results.append({
            "lambda": float(lambda_value),
            "alpha_for_half_sample": float(lambda_value * half_size),
            "selection_probabilities": probabilities_by_lambda[path_index].tolist(),
            "simultaneous_selection_probabilities": (
                simultaneous_by_lambda[path_index].tolist()
            ),
            "empirical_mean_selected_per_half_sample_q": float(
                empirical_q_by_lambda[path_index]
            ),
            "plug_in_pfer_diagnostic": float(
                plug_in_pfer_by_lambda[path_index]
            ),
            "within_q_budget": bool(
                empirical_q_by_lambda[path_index] <= q_budget + 1e-12
            ),
            "chosen_operating_point": bool(path_index == chosen_path_index),
        })

    max_iterations = max(all_iterations) if all_iterations else 0
    max_kkt_ratio = 0.0
    for residual, tolerance in zip(all_kkt_residuals, all_kkt_tolerances):
        if tolerance > 0.0:
            max_kkt_ratio = max(max_kkt_ratio, residual / tolerance)

    return {
        "method": "complementary_pairs_stability_selection",
        "model": normalized_model,
        "l1_ratio": float(effective_l1_ratio),
        "feature_names": list(feature_names),
        "selection_threshold": float(selection_threshold),
        "selection_probabilities": chosen_probabilities.tolist(),
        "selected_support": [
            feature_names[index] for index in selected_indices
        ],
        "selected_indices": selected_indices.astype(int).tolist(),
        "diagnostic_candidate_support": [
            feature_names[index] for index in diagnostic_candidate_indices
        ],
        "diagnostic_candidate_indices": (
            diagnostic_candidate_indices.astype(int).tolist()
        ),
        "support_eligible": support_eligible,
        "support_status": support_status,
        "selection_scope": (
            "separate_path_calibrated_selector_not_the_full_sample_alpha_fit"
        ),
        "lambda_path": path.tolist(),
        "lambda_path_source": path_source,
        "lambda_path_max_basis": path_max_basis,
        "observed_lambda_max": float(observed_lambda_max),
        "sampled_half_lambda_max": (
            float(half_sample_lambda_max)
            if half_sample_lambda_max is not None else None
        ),
        "operating_point": {
            "selection_rule": (
                "largest_empirical_q_within_plug_in_pfer_target_then_"
                "smallest_lambda"
            ),
            "chosen_path_index": chosen_path_index,
            "chosen_lambda": float(path[chosen_path_index]),
            "alpha_for_half_sample": float(
                path[chosen_path_index] * half_size
            ),
            "empirical_mean_selected_per_half_sample_q": float(
                empirical_q_by_lambda[chosen_path_index]
            ),
            "q_budget": q_budget,
            "q_budget_met": q_budget_met,
        },
        "path_results": path_results,
        "selection_size_control": {
            "method": "q_budget_from_plug_in_pfer_diagnostic",
            "formal_error_bound": False,
            "plug_in_pfer_target": float(plug_in_pfer_target),
            "plug_in_pfer_diagnostic": float(
                plug_in_pfer_by_lambda[chosen_path_index]
            ),
            "plug_in_pfer_target_met": q_budget_met,
            "q_budget": q_budget,
            "empirical_mean_selected_per_half_sample_q": float(
                empirical_q_by_lambda[chosen_path_index]
            ),
            "diagnostic_note": (
                "This substitutes observed q for expected q and uses finite-pair "
                "selection-frequency estimates. It calibrates the operating "
                "path point but is not a formal false-selection guarantee."
            ),
        },
        "convergence": {
            "all_fits_converged": convergence_complete,
            "converged_fits": int(sum(all_converged)),
            "total_fits": int(len(all_converged)),
            "max_iterations": int(max_iterations),
            "max_kkt_residual_to_tolerance_ratio": float(max_kkt_ratio),
        },
        "reproducibility": {
            "random_seed": int(random_seed),
            "bit_generator": rng.bit_generator.__class__.__name__,
            "numpy_version": np.__version__,
            "n_observations": int(n),
            "half_sample_size": int(half_size),
            "unassigned_observations_per_pair": int(n - 2 * half_size),
            "n_pairs": int(n_pairs),
            "n_half_samples": int(2 * n_pairs),
            "standardization": "within_each_half_sample",
            "path_scaling": "alpha=lambda*n_half_sample",
            "python_version": platform.python_version(),
            "scipy_version": scipy.__version__,
        },
        "runtime": {
            "elapsed_seconds": float(time.perf_counter() - started),
        },
        "inference_note": (
            "This is a separate path-calibrated support selector, not a "
            "stability assessment of the full-sample alpha fit. Selection "
            "frequencies describe support reproducibility only; no "
            "post-selection coefficient confidence intervals are produced."
        ),
    }


def _equicorrelated_gaussian_design(
    rng: np.random.Generator,
    n: int,
    p: int,
    correlation: float,
) -> np.ndarray:
    common = rng.normal(size=(n, 1))
    independent = rng.normal(size=(n, p))
    return (
        math.sqrt(correlation) * common
        + math.sqrt(1.0 - correlation) * independent
    )


def _stable_support_prediction_mse(
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_test: np.ndarray,
    y_test: np.ndarray,
    selected_indices: list[int],
) -> float:
    if selected_indices:
        train_design = np.column_stack([
            np.ones(len(y_train)), X_train[:, selected_indices]
        ])
        test_design = np.column_stack([
            np.ones(len(y_test)), X_test[:, selected_indices]
        ])
    else:
        train_design = np.ones((len(y_train), 1))
        test_design = np.ones((len(y_test), 1))
    coefficients = np.linalg.lstsq(train_design, y_train, rcond=None)[0]
    residuals = y_test - test_design @ coefficients
    return float(np.mean(residuals ** 2))


def sparse_selection_validation_matrix(
    sample_feature_sizes,
    correlations,
    signal_multipliers,
    *,
    support_modes=("null", "sparse"),
    support_size: int = 5,
    noise_sd: float = 1.0,
    n_replicates: int = 1,
    test_size: int = 200,
    model: str = "lasso",
    l1_ratio: float | None = None,
    selection_threshold: float = 0.9,
    plug_in_pfer_target: float = 1.0,
    n_pairs: int = 10,
    n_lambdas: int = 10,
    lambda_min_ratio: float = 0.05,
    random_seed: int = 0,
    max_iter: int = 1000,
    tol: float = 1e-6,
    include_replicates: bool = True,
    shard_index: int = 0,
    shard_count: int = 1,
) -> dict:
    """Run a configurable sparse-support simulation matrix.

    Non-null coefficients have alternating signs and magnitude
    ``signal_multiplier * noise_sd * sqrt(2*log(p)/n)``.  Prediction MSE is
    evaluated on independent data after a least-squares point refit on the
    stable support; that refit performs no coefficient inference.
    """
    started = time.perf_counter()
    sizes = [tuple(item) for item in sample_feature_sizes]
    rho_values = [float(value) for value in correlations]
    multipliers = [float(value) for value in signal_multipliers]
    modes = [str(value).strip().lower() for value in support_modes]

    if not sizes:
        raise ValueError("sample_feature_sizes must not be empty.")
    for size in sizes:
        if (len(size) != 2 or any(isinstance(value, bool) for value in size)
                or int(size[0]) != size[0] or int(size[1]) != size[1]
                or size[0] < 4 or size[1] < 2):
            raise ValueError(
                "Each sample_feature_sizes entry must be integer (n, p) "
                "with n >= 4 and p >= 2."
            )
    if not rho_values or any(
        not np.isfinite(value) or not 0.0 <= value < 1.0
        for value in rho_values
    ):
        raise ValueError("correlations must contain finite values in [0, 1).")
    if not multipliers or any(
        not np.isfinite(value) or value <= 0.0 for value in multipliers
    ):
        raise ValueError("signal_multipliers must contain finite positive values.")
    if not modes or any(mode not in {"null", "sparse"} for mode in modes):
        raise ValueError("support_modes may contain only 'null' and 'sparse'.")
    if len(set(modes)) != len(modes):
        raise ValueError("support_modes must not contain duplicates.")
    if (isinstance(support_size, bool) or int(support_size) != support_size
            or support_size < 1):
        raise ValueError("support_size must be a positive integer.")
    if not np.isfinite(noise_sd) or noise_sd <= 0.0:
        raise ValueError("noise_sd must be finite and positive.")
    if (not np.isfinite(plug_in_pfer_target)
            or plug_in_pfer_target <= 0.0):
        raise ValueError("plug_in_pfer_target must be finite and positive.")
    if (isinstance(n_replicates, bool) or int(n_replicates) != n_replicates
            or n_replicates < 1):
        raise ValueError("n_replicates must be a positive integer.")
    if (isinstance(test_size, bool) or int(test_size) != test_size
            or test_size < 1):
        raise ValueError("test_size must be a positive integer.")
    if (isinstance(random_seed, bool) or int(random_seed) != random_seed
            or random_seed < 0):
        raise ValueError("random_seed must be a non-negative integer.")
    if (isinstance(shard_count, bool) or int(shard_count) != shard_count
            or shard_count < 1):
        raise ValueError("shard_count must be a positive integer.")
    if (isinstance(shard_index, bool) or int(shard_index) != shard_index
            or not 0 <= shard_index < shard_count):
        raise ValueError("shard_index must be an integer in [0, shard_count).")

    # Validate model-specific arguments before starting a potentially long run.
    effective_l1_ratio = _sparse_model_l1_ratio(model, l1_ratio)
    root_rng = np.random.default_rng(int(random_seed))
    cells = []
    total_cells = 0

    for n_raw, p_raw in sizes:
        n, p = int(n_raw), int(p_raw)
        for correlation in rho_values:
            for support_mode in modes:
                cell_multipliers = [None] if support_mode == "null" else multipliers
                for signal_multiplier in cell_multipliers:
                    cell_index = total_cells
                    total_cells += 1
                    # Draw the entire seed corpus before applying the shard so a
                    # cell receives identical seeds in sharded and unsharded runs.
                    replicate_seeds = [(
                        int(root_rng.integers(0, 2 ** 63 - 1)),
                        int(root_rng.integers(0, 2 ** 63 - 1)),
                    ) for _ in range(int(n_replicates))]
                    if cell_index % int(shard_count) != int(shard_index):
                        continue
                    replicate_results = []
                    for replicate_index, seed_pair in enumerate(replicate_seeds):
                        data_seed, selection_seed = seed_pair
                        rng = np.random.default_rng(data_seed)
                        X_train = _equicorrelated_gaussian_design(
                            rng, n, p, correlation)
                        X_test = _equicorrelated_gaussian_design(
                            rng, int(test_size), p, correlation)
                        beta = np.zeros(p, dtype=float)

                        if support_mode == "sparse":
                            actual_support_size = min(int(support_size), p)
                            true_indices = np.sort(
                                rng.choice(p, size=actual_support_size, replace=False)
                            )
                            signal_amplitude = float(
                                signal_multiplier
                                * noise_sd
                                * math.sqrt(2.0 * math.log(p) / n)
                            )
                            signs = np.where(
                                np.arange(actual_support_size) % 2 == 0,
                                1.0,
                                -1.0,
                            )
                            beta[true_indices] = signal_amplitude * signs
                        else:
                            true_indices = np.array([], dtype=int)
                            signal_amplitude = 0.0

                        y_train = (
                            X_train @ beta + rng.normal(0.0, noise_sd, n)
                        )
                        y_test = (
                            X_test @ beta
                            + rng.normal(0.0, noise_sd, int(test_size))
                        )
                        names = [f"x{index + 1}" for index in range(p)]
                        selection = complementary_pairs_stability_selection(
                            X_train,
                            y_train,
                            names,
                            model=model,
                            l1_ratio=(
                                effective_l1_ratio
                                if str(model).strip().lower() != "lasso"
                                else None
                            ),
                            n_lambdas=int(n_lambdas),
                            lambda_min_ratio=float(lambda_min_ratio),
                            selection_threshold=float(selection_threshold),
                            plug_in_pfer_target=float(plug_in_pfer_target),
                            n_pairs=int(n_pairs),
                            random_seed=selection_seed,
                            max_iter=int(max_iter),
                            tol=float(tol),
                        )
                        selected_indices = selection["selected_indices"]
                        true_set = set(true_indices.tolist())
                        selected_set = set(selected_indices)
                        true_positives = len(true_set & selected_set)
                        false_positives = len(selected_set - true_set)
                        false_negatives = len(true_set - selected_set)
                        selected_count = len(selected_set)
                        fdp = float(false_positives / max(selected_count, 1))
                        tpr = (
                            float(true_positives / len(true_set))
                            if true_set else None
                        )
                        prediction_mse = _stable_support_prediction_mse(
                            X_train,
                            y_train,
                            X_test,
                            y_test,
                            selected_indices,
                        )
                        replicate_results.append({
                            "replicate": int(replicate_index),
                            "data_seed": data_seed,
                            "selection_seed": selection_seed,
                            "true_indices": true_indices.astype(int).tolist(),
                            "true_support": [
                                names[index] for index in true_indices
                            ],
                            "selected_indices": list(selected_indices),
                            "selected_support": [
                                names[index] for index in selected_indices
                            ],
                            "selection_probabilities": list(
                                selection["selection_probabilities"]
                            ),
                            "chosen_lambda": float(
                                selection["operating_point"]["chosen_lambda"]
                            ),
                            "empirical_q": float(
                                selection["operating_point"]
                                ["empirical_mean_selected_per_half_sample_q"]
                            ),
                            "q_budget": float(
                                selection["operating_point"]["q_budget"]
                            ),
                            "plug_in_pfer_diagnostic": float(
                                selection["selection_size_control"]
                                ["plug_in_pfer_diagnostic"]
                            ),
                            "support_eligible": bool(
                                selection["support_eligible"]
                            ),
                            "signal_amplitude": float(signal_amplitude),
                            "true_positives": int(true_positives),
                            "false_positives": int(false_positives),
                            "false_negatives": int(false_negatives),
                            "false_discovery_proportion": fdp,
                            "true_positive_rate": tpr,
                            "exact_support": bool(true_set == selected_set),
                            "prediction_mse": prediction_mse,
                            "prediction_mse_over_noise_variance": float(
                                prediction_mse / noise_sd ** 2
                            ),
                            "all_base_fits_converged": bool(
                                selection["convergence"]["all_fits_converged"]
                            ),
                            "converged_base_fits": int(
                                selection["convergence"]["converged_fits"]
                            ),
                            "total_base_fits": int(
                                selection["convergence"]["total_fits"]
                            ),
                        })

                    tpr_values = [
                        item["true_positive_rate"] for item in replicate_results
                        if item["true_positive_rate"] is not None
                    ]
                    metrics = {
                        "mean_false_discovery_proportion": float(np.mean([
                            item["false_discovery_proportion"]
                            for item in replicate_results
                        ])),
                        "mean_true_positive_rate": (
                            float(np.mean(tpr_values)) if tpr_values else None
                        ),
                        "exact_support_rate": float(np.mean([
                            item["exact_support"] for item in replicate_results
                        ])),
                        "mean_prediction_mse": float(np.mean([
                            item["prediction_mse"] for item in replicate_results
                        ])),
                        "mean_prediction_mse_over_noise_variance": float(np.mean([
                            item["prediction_mse_over_noise_variance"]
                            for item in replicate_results
                        ])),
                        "mean_selected_features": float(np.mean([
                            len(item["selected_support"])
                            for item in replicate_results
                        ])),
                        "mean_empirical_q": float(np.mean([
                            item["empirical_q"] for item in replicate_results
                        ])),
                        "mean_plug_in_pfer_diagnostic": float(np.mean([
                            item["plug_in_pfer_diagnostic"]
                            for item in replicate_results
                        ])),
                        "support_eligibility_rate": float(np.mean([
                            item["support_eligible"]
                            for item in replicate_results
                        ])),
                        "base_fit_convergence_rate": float(
                            sum(
                                item["converged_base_fits"]
                                for item in replicate_results
                            )
                            / sum(
                                item["total_base_fits"]
                                for item in replicate_results
                            )
                        ),
                        "complete_replicate_rate": float(np.mean([
                            item["all_base_fits_converged"]
                            for item in replicate_results
                        ])),
                    }
                    cell = {
                        "n": n,
                        "p": p,
                        "correlation": float(correlation),
                        "support_mode": support_mode,
                        "signal_multiplier": (
                            float(signal_multiplier)
                            if signal_multiplier is not None else None
                        ),
                        "signal_threshold_formula": (
                            "multiplier*noise_sd*sqrt(2*log(p)/n)"
                            if signal_multiplier is not None else None
                        ),
                        "n_replicates": int(n_replicates),
                        "cell_index": int(cell_index),
                        "metrics": metrics,
                    }
                    if include_replicates:
                        cell["replicates"] = replicate_results
                    cells.append(cell)

    return {
        "method": "sparse_selection_validation_matrix",
        "configuration": {
            "sample_feature_sizes": [[int(n), int(p)] for n, p in sizes],
            "correlations": rho_values,
            "support_modes": modes,
            "signal_multipliers": multipliers,
            "support_size": int(support_size),
            "noise_sd": float(noise_sd),
            "n_replicates": int(n_replicates),
            "test_size": int(test_size),
            "model": str(model),
            "l1_ratio": float(effective_l1_ratio),
            "selection_threshold": float(selection_threshold),
            "n_pairs": int(n_pairs),
            "n_lambdas": int(n_lambdas),
            "lambda_min_ratio": float(lambda_min_ratio),
            "plug_in_pfer_target": float(plug_in_pfer_target),
            "shard_index": int(shard_index),
            "shard_count": int(shard_count),
            "total_matrix_cells": int(total_cells),
            "executed_matrix_cells": int(len(cells)),
            "prediction_refit": (
                "least_squares_on_stable_support_without_coefficient_inference"
            ),
        },
        "cells": cells,
        "reproducibility": {
            "random_seed": int(random_seed),
            "bit_generator": root_rng.bit_generator.__class__.__name__,
            "numpy_version": np.__version__,
            "scipy_version": scipy.__version__,
            "python_version": platform.python_version(),
            "cell_order": (
                "sample_feature_size, correlation, support_mode, signal_multiplier"
            ),
        },
        "runtime": {
            "elapsed_seconds": float(time.perf_counter() - started),
        },
        "inference_note": (
            "The matrix evaluates support recovery and prediction; it does not "
            "construct post-selection coefficient confidence intervals."
        ),
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
    rank = int(np.linalg.matrix_rank(Xd))
    if rank < n_params:
        from scipy.linalg import qr
        _, _, pivots = qr(Xd, mode="economic", pivoting=True)
        term_names = (["Intercept"] if fit_intercept else []) + list(feature_names)
        aliased = [term_names[i] for i in pivots[rank:]]
        raise ValueError(
            f"Rank-deficient logistic design matrix (rank {rank} of {n_params}); "
            f"coefficient inference is not identifiable. Aliased term(s): {', '.join(aliased)}."
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

        # Newton step: with H = -X'WX (negative Fisher information), the
        # ascent direction is delta = (-H)^-1 score = (X'WX)^-1 score, so
        # only the positive-definite X'WX ever needs inverting.
        Xw = Xd * W[:, None]
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
        "inference_valid": bool(converged),
        "convergence_warning": (
            None if converged else
            f"IRLS reached max_iter={max_iter}; coefficient p-values and intervals are not reliable."
        ),
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
