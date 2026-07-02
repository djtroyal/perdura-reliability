"""Shared backend helpers.

`safe()` is the JSON sanitizer that was previously copy-pasted into ~11 routers:
it turns NaN/inf floats into None (JSON null) and recurses through dicts/lists so
responses never contain values that break JSON serialisation on the client.

`convergence_series()` is the Monte-Carlo convergence diagnostic shared by the
MC estimator endpoints (life-data mc-equation / cfm-monte-carlo, ALT
test-simulation).
"""

import math

import numpy as np


def safe(obj):
    """Recursively replace NaN/inf floats with None for JSON-safe output."""
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if isinstance(obj, dict):
        return {k: safe(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [safe(v) for v in obj]
    if isinstance(obj, tuple):
        return [safe(v) for v in obj]
    return obj


def convergence_series(samples, max_points=100):
    """Running-mean convergence diagnostic for a Monte-Carlo sample sequence.

    Returns ``{n, mean, ci_lower, ci_upper}`` — the running mean of the first
    n samples with its 95% confidence band (mean ± 1.96·s_n/√n), subsampled to
    at most ``max_points`` points. A flat mean inside a narrowing band shows
    the sample count was sufficient; drift or a wide band shows it was not.
    """
    x = np.asarray(samples, dtype=float)
    x = x[np.isfinite(x)]
    n_total = x.size
    if n_total < 2:
        return None

    idx_all = np.arange(1, n_total + 1, dtype=float)
    cum = np.cumsum(x)
    cum2 = np.cumsum(x * x)
    mean = cum / idx_all
    # Unbiased running variance from the cumulative sums; guard n=1.
    with np.errstate(invalid='ignore', divide='ignore'):
        var = (cum2 - idx_all * mean ** 2) / np.maximum(idx_all - 1.0, 1.0)
    var = np.clip(var, 0.0, None)
    half = 1.96 * np.sqrt(var / idx_all)

    # Subsample evenly (always including the final point).
    if n_total > max_points:
        keep = np.unique(np.linspace(1, n_total - 1, max_points).astype(int))
    else:
        keep = np.arange(1, n_total)          # skip n=1 (no variance)
    return {
        'n': [int(i + 1) for i in keep],
        'mean': [float(mean[i]) for i in keep],
        'ci_lower': [float(mean[i] - half[i]) for i in keep],
        'ci_upper': [float(mean[i] + half[i]) for i in keep],
    }
