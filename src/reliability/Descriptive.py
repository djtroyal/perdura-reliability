"""
Descriptive statistics module for Perdura reliability web app.

Provides summary statistics, frequency tables, contingency tables, run charts,
boxplot statistics, and histogram computations using numpy/scipy/pandas only.
"""

import math
import numpy as np
import pandas as pd
from scipy import stats


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _to_array(values) -> np.ndarray:
    """Convert input to a clean 1-D float array, dropping NaN/None."""
    arr = np.asarray(values, dtype=float)
    return arr[np.isfinite(arr)]


def _fd_bins(arr: np.ndarray) -> int:
    """Freedman-Diaconis rule for number of histogram bins."""
    n = len(arr)
    if n < 2:
        return 1
    iqr = float(np.percentile(arr, 75) - np.percentile(arr, 25))
    if iqr == 0:
        return int(math.ceil(math.sqrt(n)))
    h = 2.0 * iqr / (n ** (1.0 / 3.0))
    rng = float(arr.max() - arr.min())
    if h == 0:
        return int(math.ceil(math.sqrt(n)))
    return max(1, int(math.ceil(rng / h)))


# ---------------------------------------------------------------------------
# 1. Summary statistics
# ---------------------------------------------------------------------------

def summary_statistics(columns: dict) -> dict:
    """
    Compute descriptive statistics for one or more numeric columns.

    Parameters
    ----------
    columns : dict[str, list[float]]
        Mapping of column name to list of numeric values.

    Returns
    -------
    dict
        Per-column dict of statistics including n, mean, trimmed_mean, median,
        mode, variance, std, sem, min, max, range, sum, Q1, Q2, Q3, IQR,
        p5, p10, p90, p95, skewness, kurtosis, coefficient_of_variation,
        MAD, and normality test result.

    Examples
    --------
    >>> res = summary_statistics({'x': [1, 2, 3, 4, 5]})
    >>> res['x']['mean']
    3.0
    """
    result = {}
    for col_name, values in columns.items():
        arr = _to_array(values)
        n = len(arr)
        if n == 0:
            result[col_name] = {'n': 0, 'error': 'No finite values'}
            continue

        mean_val = float(np.mean(arr))
        median_val = float(np.median(arr))
        var_val = float(np.var(arr, ddof=1)) if n > 1 else float('nan')
        std_val = float(np.std(arr, ddof=1)) if n > 1 else float('nan')
        sem_val = float(std_val / math.sqrt(n)) if n > 1 else float('nan')

        # Trimmed mean (5% each side)
        try:
            trim_mean = float(stats.trim_mean(arr, 0.05))
        except Exception:
            trim_mean = mean_val

        # Mode (smallest mode if multiple)
        mode_res = stats.mode(arr, keepdims=True)
        mode_val = float(mode_res.mode[0]) if len(mode_res.mode) > 0 else float('nan')

        q1 = float(np.percentile(arr, 25))
        q2 = float(np.percentile(arr, 50))
        q3 = float(np.percentile(arr, 75))
        iqr_val = q3 - q1

        # Coefficient of variation
        cv = float(std_val / mean_val) if mean_val != 0 and n > 1 else float('nan')

        # MAD (median absolute deviation)
        mad_val = float(np.median(np.abs(arr - median_val)))

        # Skewness and excess kurtosis
        skew_val = float(stats.skew(arr)) if n > 2 else float('nan')
        kurt_val = float(stats.kurtosis(arr, fisher=True)) if n > 3 else float('nan')

        # Normality test
        if n <= 5000:
            stat_n, p_n = stats.shapiro(arr) if n >= 3 else (float('nan'), float('nan'))
            normality = {'test': 'shapiro', 'stat': float(stat_n), 'p': float(p_n)}
        else:
            ad_res = stats.anderson(arr, dist='norm')
            # Use 5% significance level critical value
            idx_5 = 2  # index for 5% in anderson's significance_level array [15,10,5,2.5,1]
            normality = {
                'test': 'anderson',
                'stat': float(ad_res.statistic),
                'critical_5pct': float(ad_res.critical_values[idx_5]),
                'p': None,
            }

        result[col_name] = {
            'n': int(n),
            'mean': mean_val,
            'trimmed_mean': trim_mean,
            'median': median_val,
            'mode': mode_val,
            'variance': var_val,
            'std': std_val,
            'sem': sem_val,
            'min': float(arr.min()),
            'max': float(arr.max()),
            'range': float(arr.max() - arr.min()),
            'sum': float(arr.sum()),
            'Q1': q1,
            'Q2': q2,
            'Q3': q3,
            'IQR': float(iqr_val),
            'p5': float(np.percentile(arr, 5)),
            'p10': float(np.percentile(arr, 10)),
            'p90': float(np.percentile(arr, 90)),
            'p95': float(np.percentile(arr, 95)),
            'skewness': skew_val,
            'kurtosis': kurt_val,
            'coefficient_of_variation': cv,
            'MAD': mad_val,
            'normality': normality,
        }
    return result


# ---------------------------------------------------------------------------
# 2. Frequency table
# ---------------------------------------------------------------------------

def frequency_table(values, bins=None) -> dict:
    """
    Build a frequency table for numeric (binned) or discrete (value counts) data.

    Parameters
    ----------
    values : list[float] or list[str]
        Input data values.
    bins : int or None
        If given and data is numeric, bin the data into this many bins.
        If None, use value-counts mode (discrete/categorical).

    Returns
    -------
    dict
        For binned numeric data: bin_edges, counts, relative_freq, cumulative_freq.
        For discrete data: labels, counts, relative_freq, cumulative_freq.

    Examples
    --------
    >>> res = frequency_table([1, 1, 2, 3, 3, 3], bins=None)
    >>> res['counts']
    [3, 2, 1]
    """
    # Try numeric conversion
    try:
        arr = np.asarray(values, dtype=float)
        is_numeric = True
    except (ValueError, TypeError):
        is_numeric = False

    if is_numeric and bins is not None:
        # Binned mode
        arr_clean = arr[np.isfinite(arr)]
        n_bins = int(bins) if bins else _fd_bins(arr_clean)
        counts, edges = np.histogram(arr_clean, bins=n_bins)
        total = counts.sum()
        rel_freq = counts / total if total > 0 else counts.astype(float)
        cum_freq = np.cumsum(rel_freq)
        bin_labels = [f'[{edges[i]:.4g}, {edges[i+1]:.4g})' for i in range(len(counts))]
        return {
            'mode': 'binned',
            'bin_edges': edges.tolist(),
            'bin_labels': bin_labels,
            'counts': counts.tolist(),
            'relative_freq': rel_freq.tolist(),
            'cumulative_freq': cum_freq.tolist(),
        }
    else:
        # Value counts mode (discrete)
        ser = pd.Series(values)
        vc = ser.value_counts(sort=True, dropna=True)
        total = int(vc.sum())
        rel = (vc / total).tolist() if total > 0 else [0.0] * len(vc)
        cum = np.cumsum(rel).tolist()
        return {
            'mode': 'value_counts',
            'labels': [str(v) for v in vc.index.tolist()],
            'counts': vc.tolist(),
            'relative_freq': rel,
            'cumulative_freq': cum,
        }


# ---------------------------------------------------------------------------
# 3. Contingency table
# ---------------------------------------------------------------------------

def contingency_table(row_values, col_values) -> dict:
    """
    Build a 2-D contingency table and run chi-square independence test.

    Parameters
    ----------
    row_values : list
        Values that form the rows of the table.
    col_values : list
        Values that form the columns of the table.

    Returns
    -------
    dict
        Observed counts (2-D list), expected counts, row/col labels,
        row totals, col totals, grand total, and chi-square test results.

    Examples
    --------
    >>> res = contingency_table(['A','A','B','B'], ['X','Y','X','Y'])
    >>> res['chi2']['dof']
    1
    """
    if len(row_values) != len(col_values):
        raise ValueError("row_values and col_values must have the same length.")

    df = pd.DataFrame({'row': row_values, 'col': col_values})
    ct = pd.crosstab(df['row'], df['col'])
    row_labels = [str(r) for r in ct.index.tolist()]
    col_labels = [str(c) for c in ct.columns.tolist()]
    observed = ct.values.tolist()
    row_totals = ct.sum(axis=1).tolist()
    col_totals = ct.sum(axis=0).tolist()
    grand_total = int(ct.values.sum())

    # Chi-square test
    try:
        chi2_stat, p_val, dof, expected = stats.chi2_contingency(ct.values)
        chi2_result = {
            'chi2': float(chi2_stat),
            'p': float(p_val),
            'dof': int(dof),
        }
        expected_list = expected.tolist()
    except Exception as exc:
        chi2_result = {'chi2': None, 'p': None, 'dof': None, 'error': str(exc)}
        expected_list = []

    return {
        'row_labels': row_labels,
        'col_labels': col_labels,
        'observed': observed,
        'expected': expected_list,
        'row_totals': [int(v) for v in row_totals],
        'col_totals': [int(v) for v in col_totals],
        'grand_total': grand_total,
        'chi2': chi2_result,
    }


# ---------------------------------------------------------------------------
# 4. Run chart
# ---------------------------------------------------------------------------

def run_chart(values) -> dict:
    """
    Compute run-chart statistics and Wald-Wolfowitz runs test.

    Parameters
    ----------
    values : list[float]
        Ordered sequence of numeric measurements.

    Returns
    -------
    dict
        sequence, median, n_runs, expected_runs, longest_run,
        and runs_test with z-score and p-value (two-tailed).

    Examples
    --------
    >>> res = run_chart([1, 5, 1, 5, 1, 5])
    >>> res['n_runs'] >= 5
    True
    """
    arr = _to_array(values)
    n = len(arr)
    if n < 2:
        raise ValueError("At least 2 values are required for a run chart.")

    median_val = float(np.median(arr))

    # Classify each observation relative to the median (exclude ties)
    signs = np.where(arr > median_val, 1, np.where(arr < median_val, -1, 0))
    non_tie = signs[signs != 0]
    n_valid = len(non_tie)

    # Count runs
    if n_valid < 2:
        runs = 0
        longest_run = 0
    else:
        runs = 1
        longest_run = 1
        cur_run = 1
        for i in range(1, n_valid):
            if non_tie[i] == non_tie[i - 1]:
                cur_run += 1
                longest_run = max(longest_run, cur_run)
            else:
                runs += 1
                cur_run = 1
        longest_run = max(longest_run, cur_run)

    n_above = int(np.sum(non_tie == 1))
    n_below = int(np.sum(non_tie == -1))
    n_eff = n_above + n_below

    # Expected runs and variance (Wald-Wolfowitz)
    if n_eff > 1:
        expected_runs = float(2 * n_above * n_below / n_eff + 1)
        if n_eff > 2:
            var_runs = float(
                2 * n_above * n_below * (2 * n_above * n_below - n_eff)
                / (n_eff ** 2 * (n_eff - 1))
            )
            if var_runs > 0:
                z = float((runs - expected_runs) / math.sqrt(var_runs))
                p = float(2 * (1 - stats.norm.cdf(abs(z))))
            else:
                z = 0.0
                p = 1.0
        else:
            z = float('nan')
            p = float('nan')
    else:
        expected_runs = float('nan')
        z = float('nan')
        p = float('nan')

    return {
        'sequence': arr.tolist(),
        'median': median_val,
        'n': n,
        'n_runs': int(runs),
        'n_above': n_above,
        'n_below': n_below,
        'expected_runs': expected_runs,
        'longest_run': int(longest_run),
        'runs_test': {'z': z, 'p': p},
    }


# ---------------------------------------------------------------------------
# 5. Boxplot stats
# ---------------------------------------------------------------------------

def boxplot_stats(values) -> dict:
    """
    Compute Tukey boxplot statistics including outliers.

    Parameters
    ----------
    values : list[float]
        Numeric data values.

    Returns
    -------
    dict
        min, Q1, median, Q3, max, iqr, whisker_low, whisker_high, outliers.

    Examples
    --------
    >>> res = boxplot_stats([1, 2, 3, 4, 5, 100])
    >>> 100 in res['outliers']
    True
    """
    arr = _to_array(values)
    if len(arr) == 0:
        raise ValueError("No finite values provided.")

    q1 = float(np.percentile(arr, 25))
    q3 = float(np.percentile(arr, 75))
    iqr_val = q3 - q1
    median_val = float(np.median(arr))

    whisker_low = float(max(arr.min(), q1 - 1.5 * iqr_val))
    whisker_high = float(min(arr.max(), q3 + 1.5 * iqr_val))

    outliers = arr[(arr < whisker_low) | (arr > whisker_high)].tolist()

    return {
        'min': float(arr.min()),
        'Q1': q1,
        'median': median_val,
        'Q3': q3,
        'max': float(arr.max()),
        'iqr': float(iqr_val),
        'whisker_low': whisker_low,
        'whisker_high': whisker_high,
        'outliers': outliers,
    }


# ---------------------------------------------------------------------------
# 6. Histogram
# ---------------------------------------------------------------------------

def histogram(values, bins=None) -> dict:
    """
    Compute histogram counts and bin edges.

    Parameters
    ----------
    values : list[float]
        Numeric data values.
    bins : int or None
        Number of bins. Defaults to Freedman-Diaconis rule if None.

    Returns
    -------
    dict
        counts (list[int]) and bin_edges (list[float], length = len(counts) + 1).

    Examples
    --------
    >>> res = histogram([1, 2, 3, 4, 5], bins=2)
    >>> len(res['bin_edges']) == len(res['counts']) + 1
    True
    """
    arr = _to_array(values)
    if len(arr) == 0:
        raise ValueError("No finite values provided.")

    n_bins = int(bins) if bins is not None else _fd_bins(arr)
    counts, edges = np.histogram(arr, bins=n_bins)
    return {
        'counts': counts.tolist(),
        'bin_edges': edges.tolist(),
    }
