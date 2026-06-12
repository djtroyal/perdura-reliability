"""
Warranty data analysis.

Provides conversion of Nevada chart warranty data (shipments and returns
per period) into life data (failures and right-censored suspensions),
and forecasting of expected future warranty returns from a fitted
distribution.
"""

import numpy as np


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
    if np.any(quantities < 0):
        raise ValueError('quantities must be non-negative.')

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
            if v < 0:
                raise ValueError(f'returns[{i}][{j}] is negative.')
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
    """Convert a Nevada chart to failures and right-censored data.

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
