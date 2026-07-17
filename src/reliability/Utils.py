"""
Utility functions for the reliability engineering suite.

Provides statistical helpers, goodness-of-fit metrics, rank estimation,
and plotting utilities used across all modules.
"""

import numpy as np
from scipy import stats
from scipy.special import expit
import matplotlib.pyplot as plt
import warnings


class FitConvergenceError(RuntimeError):
    """Raised when no optimizer attempt satisfies the fit-validity contract."""

    def __init__(self, message, diagnostics=None):
        super().__init__(message)
        self.diagnostics = diagnostics or []


def median_rank_approximation(j, n):
    """Bernard's approximation for median ranks.

    Parameters
    ----------
    j : int or array-like
        Failure order number(s).
    n : int
        Total sample size.

    Returns
    -------
    float or ndarray
        Median rank estimate(s).
    """
    j = np.asarray(j, dtype=float)
    return (j - 0.3) / (n + 0.4)


def rank_adjustment(failures, right_censored=None):
    """Compute adjusted ranks for data with suspensions (right-censored observations).

    Uses the mean order number method to adjust failure order numbers
    when suspensions are present.

    Parameters
    ----------
    failures : array-like
        Failure times.
    right_censored : array-like, optional
        Suspension (right-censored) times.

    Returns
    -------
    adjusted_ranks : ndarray
        Adjusted rank values for each failure (in sorted order of failures).
    n : int
        Total sample size (failures + suspensions).
    """
    failures = np.sort(np.asarray(failures, dtype=float))
    n = len(failures)
    if right_censored is not None:
        right_censored = np.asarray(right_censored, dtype=float)
        n += len(right_censored)

    if right_censored is None or len(right_censored) == 0:
        ranks = np.arange(1, len(failures) + 1, dtype=float)
        return ranks, n

    # Combine and sort all data, tracking type
    all_times = np.concatenate([failures, right_censored])
    all_types = np.concatenate([
        np.ones(len(failures)),       # 1 = failure
        np.zeros(len(right_censored)) # 0 = suspension
    ])
    sort_idx = np.argsort(all_times, kind='stable')
    sorted_types = all_types[sort_idx]

    # Mean order number method
    adjusted_ranks = []
    prev_order = 0
    reverse_rank = n + 1
    for i in range(len(sort_idx)):
        reverse_rank -= 1
        if sorted_types[i] == 1:  # failure
            increment = (n + 1 - prev_order) / (1 + reverse_rank)
            new_order = prev_order + increment
            adjusted_ranks.append(new_order)
            prev_order = new_order

    return np.array(adjusted_ranks), n


def AICc(loglik, k, n):
    """Corrected Akaike Information Criterion.

    Parameters
    ----------
    loglik : float
        Log-likelihood of the fitted model.
    k : int
        Number of model parameters.
    n : int
        Sample size.

    Returns
    -------
    float
        AICc value. Lower is better.
    """
    if (not np.isfinite(loglik) or not np.isfinite(k) or not np.isfinite(n)
            or k < 0 or n <= k + 1):
        return np.inf
    aic = 2 * k - 2 * loglik
    correction = (2 * k * (k + 1)) / (n - k - 1)
    return float(aic + correction)


def BIC(loglik, k, n):
    """Bayesian Information Criterion.

    Parameters
    ----------
    loglik : float
        Log-likelihood of the fitted model.
    k : int
        Number of model parameters.
    n : int
        Sample size.

    Returns
    -------
    float
        BIC value. Lower is better.
    """
    if (not np.isfinite(loglik) or not np.isfinite(k) or not np.isfinite(n)
            or k < 0 or n <= 0):
        return np.inf
    return float(k * np.log(n) - 2 * loglik)


def _objective_gradient(objective, x, bounds=None, rel_step=1e-6):
    """Bounds-aware finite-difference gradient used to validate a solution."""
    x = np.asarray(x, dtype=float)
    f0 = float(objective(x))
    if not np.isfinite(f0):
        return np.full_like(x, np.nan)
    if bounds is None:
        bounds = [(None, None)] * len(x)

    gradient = np.full_like(x, np.nan)
    for i, (lo, hi) in enumerate(bounds):
        h = rel_step * max(abs(x[i]), 1.0)
        can_minus = lo is None or x[i] - h >= lo
        can_plus = hi is None or x[i] + h <= hi
        f_minus = f_plus = np.nan
        if can_minus:
            xm = x.copy()
            xm[i] -= h
            f_minus = float(objective(xm))
        if can_plus:
            xp = x.copy()
            xp[i] += h
            f_plus = float(objective(xp))

        if np.isfinite(f_minus) and np.isfinite(f_plus):
            gradient[i] = (f_plus - f_minus) / (2 * h)
        elif np.isfinite(f_plus):
            gradient[i] = (f_plus - f0) / h
        elif np.isfinite(f_minus):
            gradient[i] = (f0 - f_minus) / h
    return gradient


def optimizer_result_diagnostics(result, method, objective, bounds=None,
                                 parameter_scale=None):
    """Evaluate a SciPy optimizer result against a common validity contract.

    A result is converged only when SciPy reports success, the parameters and
    objective are finite, and a bounds-aware gradient can be evaluated. Bound
    contact and a large projected gradient are retained as explicit warnings.
    """
    x = np.asarray(getattr(result, 'x', []), dtype=float)
    fun = float(getattr(result, 'fun', np.nan))
    success = bool(getattr(result, 'success', False))
    finite_parameters = bool(x.size and np.all(np.isfinite(x)))
    finite_objective = bool(np.isfinite(fun))
    if bounds is None:
        bounds = [(None, None)] * len(x)

    gradient = (_objective_gradient(objective, x, bounds)
                if finite_parameters and finite_objective
                else np.full_like(x, np.nan))
    gradient_finite = bool(x.size and np.all(np.isfinite(gradient)))

    boundary_parameters = []
    projected_gradient = gradient.copy()
    if finite_parameters:
        for i, (value, bound) in enumerate(zip(x, bounds)):
            lo, hi = bound
            tol = 1e-6 * max(abs(value), abs(lo or 0.0), abs(hi or 0.0), 1.0)
            at_lower = lo is not None and value <= lo + tol
            at_upper = hi is not None and value >= hi - tol
            if at_lower or at_upper:
                boundary_parameters.append(i)
            if gradient_finite:
                if at_lower and gradient[i] >= 0:
                    projected_gradient[i] = 0.0
                elif at_upper and gradient[i] <= 0:
                    projected_gradient[i] = 0.0

    projected_gradient_raw_norm = (
        float(np.linalg.norm(projected_gradient, ord=np.inf))
        if gradient_finite else None
    )
    gradient_norm = (
        projected_gradient_raw_norm / max(1.0, abs(fun))
        if projected_gradient_raw_norm is not None else None
    )
    raw_gradient_norm = (float(np.linalg.norm(gradient, ord=np.inf))
                         if gradient_finite else None)
    gradient_tolerance = 1e-4
    gradient_acceptable = bool(
        gradient_norm is not None and gradient_norm <= gradient_tolerance
    )
    converged = bool(
        success and finite_parameters and finite_objective
        and gradient_finite and gradient_acceptable
    )

    warnings_ = []
    if boundary_parameters:
        warnings_.append('parameter_on_boundary')
    if gradient_norm is not None and not gradient_acceptable:
        warnings_.append('large_projected_gradient')

    parameter_values = x
    if parameter_scale is not None and len(parameter_scale) == len(x):
        parameter_values = x * np.asarray(parameter_scale, dtype=float)

    return {
        'converged': bool(converged),
        'optimizer': str(method),
        'success': success,
        'status': int(getattr(result, 'status', -1)),
        'message': str(getattr(result, 'message', '')),
        'objective': fun if finite_objective else None,
        'finite_parameters': finite_parameters,
        'finite_objective': finite_objective,
        'gradient_finite': gradient_finite,
        'gradient_norm': gradient_norm,
        'gradient_tolerance': gradient_tolerance,
        'projected_gradient_raw_norm': projected_gradient_raw_norm,
        'raw_gradient_norm': raw_gradient_norm,
        'boundary_parameters': boundary_parameters,
        'parameter_values': parameter_values.tolist(),
        'warnings': warnings_,
    }


def select_best_optimizer_result(candidates, objective, bounds=None,
                                 parameter_scale=None):
    """Return the lowest-objective optimizer result that passes diagnostics."""
    evaluated = []
    for method, result in candidates:
        if result is None:
            continue
        diagnostics = optimizer_result_diagnostics(
            result, method, objective, bounds=bounds,
            parameter_scale=parameter_scale,
        )
        evaluated.append((result, diagnostics))

    eligible = [(result, diagnostics) for result, diagnostics in evaluated
                if diagnostics['converged']]
    if not eligible:
        attempts = [diagnostics for _, diagnostics in evaluated]
        raise FitConvergenceError(
            'No optimizer attempt converged with a finite objective and gradient.',
            diagnostics=attempts,
        )

    result, diagnostics = min(eligible, key=lambda pair: float(pair[0].fun))
    diagnostics = dict(diagnostics)
    diagnostics['attempts'] = [diag for _, diag in evaluated]
    return result, diagnostics


def anderson_darling(failures, fitted_cdf_func, right_censored=None):
    """Compute the Anderson-Darling statistic (complete samples only).

    Parameters
    ----------
    failures : array-like
        Sorted failure times.
    fitted_cdf_func : callable
        CDF function of the fitted distribution.
    right_censored : array-like, optional
        Right-censored times. The complete-sample A² treats the failures as
        the whole sample; under censoring they are a left-biased subset, so
        the statistic is systematically inflated and reflects the censoring
        fraction, not fit quality. Rather than report a wrong number, this
        returns ``None`` whenever censored observations are present.

    Returns
    -------
    float or None
        Anderson-Darling statistic (lower is better), or None when the sample
        is censored and the statistic is not valid.
    """
    if right_censored is not None and len(right_censored) > 0:
        return None

    failures = np.sort(np.asarray(failures, dtype=float))
    n = len(failures)
    if n == 0:
        return np.inf

    F = fitted_cdf_func(failures)
    F = np.clip(F, 1e-15, 1 - 1e-15)

    i = np.arange(1, n + 1)
    S = np.sum((2 * i - 1) * (np.log(F) + np.log(1 - F[::-1])))
    AD = -n - S / n
    return AD


def negative_log_likelihood(params, dist_class, failures, right_censored=None):
    """Generic negative log-likelihood for censored data.

    Parameters
    ----------
    params : tuple
        Distribution parameters.
    dist_class : class
        Distribution class with _from_params classmethod.
    failures : ndarray
        Failure times.
    right_censored : ndarray, optional
        Suspension (right-censored) times.

    Returns
    -------
    float
        Negative log-likelihood value.
    """
    try:
        dist = dist_class._from_params(params)
    except (ValueError, RuntimeError):
        return np.inf

    logpdf_vals = np.asarray(dist._logpdf(failures), dtype=float)
    if np.any(~np.isfinite(logpdf_vals)):
        return np.inf
    LL = np.sum(logpdf_vals)

    if right_censored is not None and len(right_censored) > 0:
        logsf_vals = np.asarray(dist._logsf(right_censored), dtype=float)
        if np.any(~np.isfinite(logsf_vals)):
            return np.inf
        LL += np.sum(logsf_vals)

    if np.isnan(LL) or np.isinf(LL):
        return np.inf
    return -LL


def numerical_hessian(func, x0, rel_step=1e-4):
    """Central-difference Hessian of a scalar function at x0.

    Parameters
    ----------
    func : callable
        Scalar function of a 1-D parameter vector.
    x0 : array-like
        Point at which to evaluate the Hessian.
    rel_step : float
        Relative finite-difference step (scaled by each parameter's magnitude).

    Returns
    -------
    ndarray or None
        k x k Hessian matrix, or None if the function could not be evaluated
        in a neighbourhood of x0 (e.g. it returned inf/nan).
    """
    x0 = np.asarray(x0, dtype=float)
    k = len(x0)
    # Use a unit absolute scale near zero.  Scaling the perturbation directly
    # by a small transformed parameter (for example log(beta) ~= 0) makes the
    # second difference comparable to floating-point cancellation and can
    # spuriously turn an otherwise positive-definite observed-information
    # matrix indefinite.  ``max(abs(x), 1)`` is the standard relative-step
    # convention and remains relative for parameters whose magnitude exceeds
    # one.
    h = rel_step * np.maximum(np.abs(x0), 1.0)

    f0 = func(x0)
    if not np.isfinite(f0):
        return None

    H = np.zeros((k, k))
    for i in range(k):
        for j in range(i, k):
            xi = x0.copy()
            if i == j:
                xi[i] = x0[i] + h[i]
                fp = func(xi)
                xi[i] = x0[i] - h[i]
                fm = func(xi)
                with np.errstate(over='ignore', invalid='ignore', divide='ignore'):
                    val = (fp - 2 * f0 + fm) / (h[i] ** 2)
            else:
                xij = x0.copy()
                xij[i] = x0[i] + h[i]; xij[j] = x0[j] + h[j]
                fpp = func(xij)
                xij = x0.copy()
                xij[i] = x0[i] + h[i]; xij[j] = x0[j] - h[j]
                fpm = func(xij)
                xij = x0.copy()
                xij[i] = x0[i] - h[i]; xij[j] = x0[j] + h[j]
                fmp = func(xij)
                xij = x0.copy()
                xij[i] = x0[i] - h[i]; xij[j] = x0[j] - h[j]
                fmm = func(xij)
                with np.errstate(over='ignore', invalid='ignore', divide='ignore'):
                    val = (fpp - fpm - fmp + fmm) / (4 * h[i] * h[j])
            if not np.isfinite(val):
                return None
            H[i, j] = val
            H[j, i] = val
    return H


def fisher_information_covariance(params, dist_class, failures, right_censored=None):
    """Parameter covariance matrix from the observed Fisher information.

    The covariance is the inverse of the Hessian of the negative log-likelihood
    evaluated at the fitted parameters. Reuses ``negative_log_likelihood`` so no
    per-distribution derivative code is required.

    Returns
    -------
    ndarray or None
        k x k covariance matrix, or None if the Hessian is singular, non-finite,
        or yields negative variances (in which case callers should report NaN CIs).
    """
    params = np.asarray(params, dtype=float)

    def nll(p):
        return negative_log_likelihood(p, dist_class, failures, right_censored)

    # Near a parameter bound the default step can land in the invalid region
    # (nll -> inf) and the Hessian silently fails, losing all uncertainty
    # output. Retry with progressively smaller steps before giving up.
    for rel_step in (1e-4, 1e-5, 1e-6):
        H = numerical_hessian(nll, params, rel_step=rel_step)
        if H is None:
            continue
        try:
            cov = np.linalg.inv(H)
        except np.linalg.LinAlgError:
            continue
        if not np.all(np.isfinite(cov)):
            continue
        if np.any(np.diag(cov) < 0):
            continue
        return cov
    return None


def parameter_confidence_intervals(params, cov, positive_mask, CI=0.95):
    """Confidence intervals for fitted parameters via the normal approximation.

    Positive parameters use a log-transform so the bounds stay strictly positive;
    unbounded parameters (e.g. a Normal mean) use symmetric bounds.

    Parameters
    ----------
    params : array-like
        Fitted parameter values.
    cov : ndarray or None
        Parameter covariance matrix. If None, all results are NaN.
    positive_mask : sequence of bool
        True where the parameter is constrained positive.
    CI : float
        Confidence level (e.g. 0.95).

    Returns
    -------
    dict
        ``{'se': ndarray, 'lower': ndarray, 'upper': ndarray}``.
    """
    params = np.asarray(params, dtype=float)
    k = len(params)
    z = stats.norm.ppf(1 - (1 - CI) / 2)

    if cov is None:
        nan = np.full(k, np.nan)
        return {'se': nan, 'lower': nan.copy(), 'upper': nan.copy()}

    se = np.sqrt(np.clip(np.diag(cov), 0, None))
    lower = np.empty(k)
    upper = np.empty(k)
    for i in range(k):
        p = params[i]
        if positive_mask[i] and p > 0:
            # Log-transform keeps bounds positive: exp(ln p +/- z * SE/p)
            factor = np.exp(z * se[i] / p)
            lower[i] = p / factor
            upper[i] = p * factor
        else:
            lower[i] = p - z * se[i]
            upper[i] = p + z * se[i]
    return {'se': se, 'lower': lower, 'upper': upper}


def distribution_confidence_bounds(dist_class, params, cov, xvals, CI=0.95):
    """Confidence bounds on the survival function via the delta method.

    For each x, propagates the parameter covariance through the gradient of the
    survival function, then applies a logit transform so the bounds remain in
    (0, 1). CDF bounds are the complement of the returned SF bounds.

    Parameters
    ----------
    dist_class : class
        Distribution class with a ``_from_params`` classmethod and ``_sf`` method.
    params : array-like
        Fitted parameter values.
    cov : ndarray or None
        Parameter covariance matrix. If None, returns (None, None).
    xvals : array-like
        Times at which to evaluate the bounds.
    CI : float
        Confidence level.

    Returns
    -------
    (ndarray, ndarray) or (None, None)
        Lower and upper bounds on the survival function.
    """
    if cov is None:
        return None, None

    params = np.asarray(params, dtype=float)
    x = np.asarray(xvals, dtype=float)
    z = stats.norm.ppf(1 - (1 - CI) / 2)
    k = len(params)
    h = 1e-5 * np.maximum(np.abs(params), 1e-4)

    def sf_of(p):
        return dist_class._from_params(p)._sf(x)

    R = np.clip(sf_of(params), 1e-10, 1 - 1e-10)

    # Numerical gradient of SF wrt each parameter (central difference)
    grad = np.zeros((k, len(x)))
    for i in range(k):
        pp = params.copy(); pp[i] += h[i]
        pm = params.copy(); pm[i] -= h[i]
        grad[i] = (sf_of(pp) - sf_of(pm)) / (2 * h[i])

    var_R = np.einsum('ix,ij,jx->x', grad, cov, grad)
    var_R = np.clip(var_R, 0, None)

    # Per Meeker-Escobar, the band is symmetric in the distribution's own
    # linearizing (plotting) metric, so the drawn band is parallel on that
    # distribution's probability paper and the tails are weighted correctly.
    name = getattr(dist_class, '__name__', '')
    if any(k in name for k in ('Weibull', 'Exponential', 'Gamma', 'Gumbel')):
        # SEV / complementary log-log space: g(R) = ln(-ln R), g'(R) = 1/(R·ln R)
        # (Gumbel here is the minimum-EV form, whose paper metric is cloglog.)
        g = np.log(-np.log(R))
        var_g = var_R / (R * np.log(R)) ** 2
        half = z * np.sqrt(np.clip(var_g, 0, None))
        # Inverse cloglog for SF is exp(-exp(metric)).  Wide bands can put the
        # metric far above log(max_float): the final answer is effectively zero,
        # but evaluating the inner exponential first emits an overflow warning.
        # Clip to the range that maps to normal positive floats; beyond it the
        # inverse is indistinguishable from the corresponding 0/1 endpoint.
        float_tiny = np.finfo(float).tiny
        metric_min = np.log(float_tiny)
        metric_max = np.log(-np.log(float_tiny))

        def inverse_cloglog_sf(metric):
            bounded = np.clip(metric, metric_min, metric_max)
            return np.exp(-np.exp(bounded))

        lower = inverse_cloglog_sf(g + half)
        upper = inverse_cloglog_sf(g - half)
    elif any(k in name for k in ('Normal', 'Lognormal')):
        # Probit space: w = Phi^-1(R), Var(w) = Var(R)/phi(w)^2
        w = stats.norm.ppf(R)
        pdf_w = np.clip(stats.norm.pdf(w), 1e-300, None)
        half = z * np.sqrt(np.clip(var_R, 0, None)) / pdf_w
        lower = stats.norm.cdf(w - half)
        upper = stats.norm.cdf(w + half)
    else:
        # Logit space (Loglogistic — its natural paper metric — and the
        # Beta fallback) — still guaranteed inside (0, 1).
        logit_R = np.log(R / (1 - R))
        var_logit = var_R / (R * (1 - R)) ** 2
        half = z * np.sqrt(var_logit)
        lower = expit(logit_R - half)
        upper = expit(logit_R + half)
    return lower, upper


def xy_transform(dist_name):
    """Return linearizing transform functions for probability plotting.

    Parameters
    ----------
    dist_name : str
        Distribution name (e.g., 'Weibull', 'Normal', 'Lognormal', etc.)

    Returns
    -------
    x_transform : callable
        Transform for x-axis.
    y_transform : callable
        Transform for y-axis (applied to CDF values F).
    x_label : str
        Label for x-axis.
    y_label : str
        Label for y-axis.
    """
    if dist_name in ('Weibull', 'Weibull_2P', 'Weibull_3P'):
        return (
            np.log,
            lambda F: np.log(-np.log(1 - F)),
            'ln(t)',
            'ln(ln(1/(1-F)))'
        )
    elif dist_name in ('Normal', 'Normal_2P'):
        return (
            lambda x: x,
            lambda F: stats.norm.ppf(F),
            't',
            'Standard Normal Quantile'
        )
    elif dist_name in ('Lognormal', 'Lognormal_2P', 'Lognormal_3P'):
        return (
            np.log,
            lambda F: stats.norm.ppf(F),
            'ln(t)',
            'Standard Normal Quantile'
        )
    elif dist_name in ('Exponential', 'Exponential_1P', 'Exponential_2P'):
        return (
            lambda x: x,
            lambda F: -np.log(1 - F),
            't',
            '-ln(1-F)'
        )
    elif dist_name in ('Gamma', 'Gamma_2P', 'Gamma_3P'):
        return (
            np.log,
            lambda F: stats.norm.ppf(F),
            'ln(t)',
            'Standard Normal Quantile'
        )
    elif dist_name in ('Loglogistic', 'Loglogistic_2P', 'Loglogistic_3P'):
        return (
            np.log,
            lambda F: np.log(F / (1 - F)),
            'ln(t)',
            'ln(F/(1-F))'
        )
    elif dist_name in ('Beta', 'Beta_2P'):
        return (
            lambda x: x,
            lambda F: np.log(F / (1 - F)),
            't',
            'ln(F/(1-F))'
        )
    elif dist_name in ('Gumbel', 'Gumbel_2P'):
        # Minimum extreme value (gumbel_l): F = 1 - exp(-exp((t-mu)/sigma)),
        # so ln(-ln(1-F)) = (t-mu)/sigma is the linearizing transform.
        return (
            lambda x: x,
            lambda F: np.log(-np.log(1 - F)),
            't',
            'ln(-ln(1-F))'
        )
    else:
        return (
            lambda x: x,
            lambda F: F,
            't',
            'F(t)'
        )


def generate_X_array(dist, xvals=None, num_points=200):
    """Auto-generate x values for plotting a distribution.

    Parameters
    ----------
    dist : Distribution
        A distribution object with quantile method.
    xvals : array-like, optional
        User-supplied x values. If provided, returned as-is.
    num_points : int
        Number of points to generate.

    Returns
    -------
    ndarray
        Array of x values for plotting.
    """
    if xvals is not None:
        return np.asarray(xvals, dtype=float)

    try:
        q_low = dist.quantile(0.001)
        q_high = dist.quantile(0.999)
    except Exception:
        q_low = 0
        q_high = 100

    if hasattr(dist, 'gamma') and dist.gamma > 0:
        q_low = max(q_low, dist.gamma + 1e-10)

    if q_low >= q_high:
        q_high = q_low + 10

    return np.linspace(q_low, q_high, num_points)


# Color palette for plots
COLORS = [
    '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
    '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
    '#aec7e8', '#ffbb78', '#98df8a'
]
