"""
Warranty data analysis.

Provides conversion of Nevada chart warranty data (shipments and returns
per period) into life data (failures and right-censored suspensions),
and forecasting of expected future warranty returns from a fitted
distribution.
"""

from dataclasses import dataclass
import math

import numpy as np
from scipy import optimize, stats

from reliability.Utils import (
    FitConvergenceError, numerical_hessian, select_best_optimizer_result,
)
from reliability.Grouped_life import (
    grouped_distribution_spec as _shared_grouped_distribution_spec,
    log_interval_probability as _shared_log_interval_probability,
)


def _validate_nevada(quantities, returns):
    """Validate a Nevada chart and return clean integer arrays.

    Returns
    -------
    quantities : np.ndarray (R,) — units shipped per ship period
    returns : np.ndarray (R x C) — returns counts with None mapped to 0
    """
    if len(returns) != len(quantities):
        raise ValueError('returns must have one row per ship period '
                         f'(got {len(returns)} rows for {len(quantities)} quantities).')
    if len(quantities) == 0:
        raise ValueError('quantities must not be empty.')

    quantities = np.asarray(quantities, dtype=float)
    if np.any(~np.isfinite(quantities)) or np.any(quantities < 0):
        raise ValueError('quantities must be finite and non-negative.')

    n_cols = {len(row) for row in returns}
    if len(n_cols) != 1:
        raise ValueError('All rows of returns must have the same number of columns.')
    C = n_cols.pop()
    if C == 0:
        raise ValueError('returns must have at least one return-period column.')

    clean = np.zeros((len(quantities), C), dtype=float)
    for i, row in enumerate(returns):
        for j, cell in enumerate(row):
            v = 0.0 if cell is None else float(cell)
            if not np.isfinite(v) or v < 0:
                raise ValueError(f'returns[{i}][{j}] must be finite and non-negative.')
            age = (j + 1) - i
            if age <= 0 and v > 0:
                raise ValueError(
                    f'returns[{i}][{j}] corresponds to calendar period {j + 1}, '
                    f'which is not after ship period {i}. Cell must be 0 or None.')
            clean[i, j] = v

    row_totals = clean.sum(axis=1)
    for i, (q, tot) in enumerate(zip(quantities, row_totals)):
        if tot > q:
            raise ValueError(
                f'Total returns for ship lot {i} ({tot:g}) exceed the '
                f'quantity shipped ({q:g}).')

    return quantities, clean


def nevada_to_life_data(quantities, returns):
    """Legacy expansion of integral Nevada counts to endpoint ages.

    This compatibility representation treats a period return as if it occurred
    exactly at the period endpoint.  It is not used by the warranty fitter,
    which uses :func:`nevada_to_grouped_life_data` and the correct interval
    likelihood.  Fractional aggregate counts are rejected instead of rounded.

    Parameters
    ----------
    quantities : list of int — units shipped per ship period (length R)
    returns : 2D list (R x C) — returns[i][j] = units from ship-lot i returned
        in return period j, where return period j corresponds to calendar
        period (j + 1) on a timeline where ship period i is at calendar
        period i (0-based). So age of returns[i][j] = (j + 1) - i.
        Cells with (j + 1) <= i are invalid and must be 0/None.

    Returns
    -------
    failures : np.ndarray — one age entry per returned unit
    right_censored : np.ndarray — one age entry per surviving unit
    """
    quantities, returns = _validate_nevada(quantities, returns)
    R, C = returns.shape
    if (np.any(~np.isclose(quantities, np.round(quantities)))
            or np.any(~np.isclose(returns, np.round(returns)))):
        raise ValueError(
            'Exact-age expansion is available only for integral counts; '
            'fractional counts must remain weighted grouped observations.')

    failures = []
    right_censored = []
    for i in range(R):
        for j in range(C):
            count = int(round(returns[i, j]))
            age = (j + 1) - i
            if count > 0 and age > 0:
                failures.extend([float(age)] * count)
        surviving = int(round(quantities[i] - returns[i].sum()))
        censor_age = C - i
        if censor_age <= 0:
            raise ValueError(
                f'Ship lot {i} has censor age {censor_age} <= 0: the chart '
                'has no return periods after this ship period.')
        right_censored.extend([float(censor_age)] * surviving)

    return np.asarray(failures, dtype=float), np.asarray(right_censored, dtype=float)


def nevada_to_grouped_life_data(quantities, returns):
    """Preserve Nevada-chart counts as interval/right-censored groups.

    A return at integer age ``a`` contributes ``count`` observations in
    ``(a-1, a]``.  Units still in service contribute right-censored weight at
    the lot's current age.  Counts are weights and are never rounded or
    expanded into individual pseudo-observations.
    """
    quantities, returns = _validate_nevada(quantities, returns)
    R, C = returns.shape
    interval_failures = []
    right_censored_groups = []
    for i in range(R):
        for j in range(C):
            age = (j + 1) - i
            count = float(returns[i, j])
            if age > 0 and count > 0:
                interval_failures.append({
                    'lower': float(age - 1),
                    'upper': float(age),
                    'count': count,
                    'ship_lot': i,
                    'return_period': j + 1,
                })
        current_age = C - i
        if current_age <= 0:
            raise ValueError(
                f'Ship lot {i} has current age {current_age} <= 0: the chart '
                'has no return periods after this ship period.')
        survivors = float(quantities[i] - returns[i].sum())
        if survivors > 0:
            right_censored_groups.append({
                'time': float(current_age), 'count': survivors, 'ship_lot': i,
            })
    return {
        'interval_failures': interval_failures,
        'right_censored': right_censored_groups,
        'n_failures': float(sum(row['count'] for row in interval_failures)),
        'n_censored': float(sum(row['count'] for row in right_censored_groups)),
        'observation_model': 'period_grouped_interval_censored',
    }


class _CDFAdapter:
    """Small distribution adapter used by ``forecast_returns``."""

    def __init__(self, frozen):
        self._frozen = frozen

    def _cdf(self, x):
        return self._frozen.cdf(np.asarray(x, dtype=float))


@dataclass
class GroupedWarrantyFit:
    distribution_name: str
    params: dict
    distribution: _CDFAdapter
    theta: np.ndarray
    covariance_theta: np.ndarray | None
    loglik: float
    AIC: float
    BIC: float
    converged: bool
    optimizer_message: str
    successful_starts: int
    _builder: object


def _log_interval_probability(frozen, lower, upper):
    """Compatibility alias for the shared stable interval calculation."""
    return _shared_log_interval_probability(frozen, lower, upper)


def _grouped_distribution_spec(name, failure_midpoints, failure_weights):
    """Return the shared transformed-parameter specification for Warranty."""
    spec = _shared_grouped_distribution_spec(
        name,
        np.asarray(failure_midpoints, dtype=float),
        np.asarray(failure_weights, dtype=float),
        allow_threshold=False,
    )

    def build(theta):
        return spec.decode(np.asarray(theta, dtype=float))

    positive = [parameter not in ('mu',) for parameter in spec.names]
    return spec.start, spec.bounds, build, positive


def fit_grouped_warranty_distribution(
    quantities, returns, distribution='Weibull_2P', CI=0.95,
) -> GroupedWarrantyFit:
    """Fit a parametric model to weighted interval/right-censored groups."""
    if not 0 < CI < 1:
        raise ValueError('CI must be between 0 and 1.')
    grouped = nevada_to_grouped_life_data(quantities, returns)
    intervals = grouped['interval_failures']
    if not intervals:
        raise ValueError('No failures found in the Nevada chart; cannot fit a distribution.')
    lower = np.asarray([row['lower'] for row in intervals], dtype=float)
    upper = np.asarray([row['upper'] for row in intervals], dtype=float)
    weights = np.asarray([row['count'] for row in intervals], dtype=float)
    rc_time = np.asarray(
        [row['time'] for row in grouped['right_censored']], dtype=float)
    rc_weights = np.asarray(
        [row['count'] for row in grouped['right_censored']], dtype=float)
    midpoint = (lower + upper) / 2.0
    start, bounds, builder, positive = _grouped_distribution_spec(
        distribution, midpoint, weights)

    def objective(theta):
        try:
            with np.errstate(all='ignore'):
                frozen, _ = builder(np.asarray(theta, dtype=float))
                log_interval = _log_interval_probability(frozen, lower, upper)
            if np.any(~np.isfinite(log_interval)):
                return 1e300
            value = float(np.sum(weights * log_interval))
            if len(rc_time):
                with np.errstate(all='ignore'):
                    log_survival = np.asarray(frozen.logsf(rc_time), dtype=float)
                if np.any(~np.isfinite(log_survival)):
                    return 1e300
                value += float(np.sum(rc_weights * log_survival))
            return -value if np.isfinite(value) else 1e300
        except (ValueError, FloatingPointError, OverflowError):
            return 1e300

    rng = np.random.default_rng(1911)
    starts = [start]
    parameter_scale = np.maximum(np.abs(start), 1.0)
    for jitter in (0.15, 0.35, 0.7, 1.0):
        starts.append(
            start + rng.normal(0.0, jitter, len(start)) * parameter_scale)
    attempts = []
    for index, candidate in enumerate(starts):
        result = optimize.minimize(
            objective, candidate, method='L-BFGS-B', bounds=bounds,
            options={'maxiter': 5000, 'ftol': 1e-12, 'gtol': 1e-8},
        )
        attempts.append((f'L-BFGS-B start {index + 1}', result))

    finite_attempts = [
        result for _, result in attempts if np.isfinite(result.fun)
    ]
    if not finite_attempts:
        raise ValueError('Grouped interval-censored likelihood optimization failed.')
    best_seed = min(finite_attempts, key=lambda fit: float(fit.fun))
    polished = optimize.minimize(
        objective, best_seed.x, method='Nelder-Mead', bounds=bounds,
        options={'maxiter': 10000, 'xatol': 1e-9, 'fatol': 1e-9},
    )
    attempts.append(('Nelder-Mead polish', polished))
    try:
        result, _diagnostics = select_best_optimizer_result(
            attempts, objective, bounds=bounds,
        )
    except FitConvergenceError as exc:
        raise ValueError(
            'Grouped interval-censored likelihood did not converge.') from exc
    theta = np.asarray(result.x, dtype=float)
    frozen, natural_params = builder(theta)

    covariance_theta = None
    for rel_step in (3e-3, 1e-3, 3e-4, 1e-4, 3e-5):
        hessian = numerical_hessian(objective, theta, rel_step=rel_step)
        if hessian is None:
            continue
        hessian = 0.5 * (hessian + hessian.T)
        try:
            # Cholesky is a stricter and more stable positive-definiteness
            # check than accepting a noisy inverse based only on its diagonal.
            np.linalg.cholesky(hessian)
            candidate_covariance = np.linalg.solve(
                hessian, np.eye(len(theta), dtype=float))
        except np.linalg.LinAlgError:
            continue
        candidate_covariance = 0.5 * (
            candidate_covariance + candidate_covariance.T)
        if (candidate_covariance.shape == (len(theta), len(theta))
                and np.all(np.isfinite(candidate_covariance))
                and np.all(np.linalg.eigvalsh(candidate_covariance) > 0)):
            covariance_theta = candidate_covariance
            break
    params = dict(natural_params)
    if covariance_theta is not None:
        z = float(stats.norm.ppf(0.5 + CI / 2.0))
        for index, (name, value) in enumerate(natural_params.items()):
            se_theta = math.sqrt(float(covariance_theta[index, index]))
            if positive[index]:
                params[f'{name}_lower'] = float(math.exp(theta[index] - z * se_theta))
                params[f'{name}_upper'] = float(math.exp(theta[index] + z * se_theta))
                params[f'{name}_se'] = float(value * se_theta)
            else:
                params[f'{name}_lower'] = float(value - z * se_theta)
                params[f'{name}_upper'] = float(value + z * se_theta)
                params[f'{name}_se'] = float(se_theta)

    n_effective = grouped['n_failures'] + grouped['n_censored']
    n_params = len(theta)
    loglik = -float(result.fun)
    return GroupedWarrantyFit(
        distribution_name=distribution, params=params,
        distribution=_CDFAdapter(frozen), theta=theta,
        covariance_theta=covariance_theta, loglik=loglik,
        AIC=float(2 * n_params - 2 * loglik),
        BIC=float(math.log(max(n_effective, 1.0)) * n_params - 2 * loglik),
        converged=bool(result.success), optimizer_message=str(result.message),
        successful_starts=sum(
            bool(attempt.success and np.isfinite(attempt.fun))
            for _, attempt in attempts[:-1]
        ), _builder=builder,
    )


def forecast_parameter_interval(
    quantities, returns, fit: GroupedWarrantyFit, n_forecast_periods,
    n_draws=500, CI=0.95, seed=None,
):
    """Asymptotic parameter-only interval for aggregate forecast totals."""
    n_draws = int(n_draws)
    if n_draws < 100:
        raise ValueError('n_draws must be at least 100.')
    if not 0 < CI < 1:
        raise ValueError('CI must be between 0 and 1.')
    if fit.covariance_theta is None:
        return {
            'status': 'unavailable',
            'reason': 'optimizer_covariance_unavailable',
            'method': 'asymptotic_parameter_draws',
        }
    rng = np.random.default_rng(seed)
    theta_draws = rng.multivariate_normal(
        fit.theta, fit.covariance_theta, size=n_draws, check_valid='ignore')
    totals = []
    for theta in theta_draws:
        try:
            frozen, _ = fit._builder(theta)
            _, candidate_totals = forecast_returns(
                quantities, returns, _CDFAdapter(frozen), n_forecast_periods)
            if np.all(np.isfinite(candidate_totals)):
                totals.append(candidate_totals)
        except (ValueError, FloatingPointError, OverflowError):
            continue
    if len(totals) < n_draws // 2:
        return {
            'status': 'insufficient_draws', 'method': 'asymptotic_parameter_draws',
            'requested': n_draws, 'successful': len(totals),
        }
    values = np.asarray(totals, dtype=float)
    tail = (1.0 - CI) / 2.0
    return {
        'status': 'ok', 'method': 'asymptotic_parameter_draws', 'CI': CI,
        'requested': n_draws, 'successful': len(totals), 'seed': seed,
        'lower': np.quantile(values, tail, axis=0).tolist(),
        'median': np.median(values, axis=0).tolist(),
        'upper': np.quantile(values, 1.0 - tail, axis=0).tolist(),
        'conditional_on': (
            'selected_distribution_grouped_likelihood_and_local_optimizer_covariance'),
        'excludes': 'future_process_count_variation_and_model_selection_uncertainty',
    }


def forecast_returns(quantities, returns, distribution, n_forecast_periods):
    """Forecast expected warranty returns per lot per future period.

    Parameters
    ----------
    quantities : list of int — units shipped per ship period (length R)
    returns : 2D list (R x C) — Nevada chart returns (see nevada_to_life_data)
    distribution : a fitted Distribution object (has a ._cdf method)
    n_forecast_periods : int — number of future periods to forecast

    For lot i with S_i surviving units at current age a_i, the expected
    returns in future period k (k = 1..n_forecast_periods), i.e. between
    ages (a_i + k - 1) and (a_i + k), conditional on survival to a_i:

        E = S_i * (F(a_i + k) - F(a_i + k - 1)) / (1 - F(a_i))

    Returns
    -------
    forecast : np.ndarray (R x n_forecast_periods) of expected returns
    totals : np.ndarray (n_forecast_periods,) column sums
    """
    n_forecast_periods = int(n_forecast_periods)
    if n_forecast_periods < 1:
        raise ValueError('n_forecast_periods must be at least 1.')

    quantities, returns = _validate_nevada(quantities, returns)
    R, C = returns.shape

    forecast = np.zeros((R, n_forecast_periods))
    for i in range(R):
        surviving = quantities[i] - returns[i].sum()
        current_age = C - i
        if current_age <= 0:
            raise ValueError(
                f'Ship lot {i} has current age {current_age} <= 0: the chart '
                'has no return periods after this ship period.')
        if surviving <= 0:
            continue

        ages = current_age + np.arange(n_forecast_periods + 1, dtype=float)
        F = np.clip(np.asarray(distribution._cdf(ages), dtype=float), 0.0, 1.0)
        sf_now = 1.0 - F[0]
        if sf_now <= 0:
            # All units are already expected to have failed; nothing to forecast.
            continue
        forecast[i, :] = surviving * np.diff(F) / sf_now

    forecast = np.clip(forecast, 0.0, None)
    totals = forecast.sum(axis=0)
    return forecast, totals
