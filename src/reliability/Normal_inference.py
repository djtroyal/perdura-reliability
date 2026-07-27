"""Finite-sample confidence inference for complete Normal and Lognormal data.

The Normal results use the exact Student-t pivot for ``mu`` and chi-square
pivot for ``sigma``.  Pointwise CDF/SF bounds invert the noncentral-t
distribution.  Lognormal inference applies the same pivots to log lifetimes.

These routines deliberately reject censored and rank-regression samples.  They
are exact only for an iid complete sample fitted by maximum likelihood.
"""

from __future__ import annotations

import math

import numpy as np
from scipy import special, stats


def _metadata(CI, model, available=True, reason=None, warnings=()):
    return {
        "available": bool(available),
        "reason": reason,
        "sample_design": "complete" if available else "unsupported",
        "confidence_level": float(CI),
        "estimator": "MLE",
        "exact": bool(available),
        "band_scope": "pointwise" if available else None,
        "parameter_methods": ({
            "mu": "exact_student_t",
            "sigma": "exact_chi_square",
        } if available else {}),
        "function_method": (
            "exact_noncentral_t_inversion" if available else None
        ),
        "assumptions": [
            "independent_identically_distributed_observations",
            "complete_sample",
            (
                "normal_lifetimes"
                if model == "Normal_2P"
                else "normal_log_lifetimes"
            ),
        ],
        "warnings": list(warnings),
        "validation_status": "analytic_finite_sample",
        "primary": True,
    }


def normal_exact_inference(
    failures,
    right_censored=None,
    *,
    CI=0.95,
    lognormal=False,
    weights=None,
):
    """Return exact marginal parameter inference for a complete sample."""
    failures = np.asarray(failures, dtype=float)
    right_censored = np.asarray(
        [] if right_censored is None else right_censored, dtype=float
    )
    model = "Lognormal_2P" if lognormal else "Normal_2P"
    if not 0 < CI < 1:
        raise ValueError("CI must be strictly between 0 and 1.")
    if len(right_censored):
        return {
            "model": model,
            "parameter_intervals": {},
            "metadata": _metadata(
                CI, model, available=False, reason="right_censored_data"
            ),
        }
    if weights is None:
        weights = np.ones(len(failures), dtype=float)
    else:
        weights = np.asarray(weights, dtype=float)
        if len(weights) != len(failures):
            raise ValueError("weights must match failures.")
        if (
            np.any(~np.isfinite(weights))
            or np.any(weights <= 0)
            or np.any(weights != np.floor(weights))
        ):
            raise ValueError("weights must be positive finite integers.")
    n = int(np.sum(weights))
    if n < 2:
        return {
            "model": model,
            "parameter_intervals": {},
            "metadata": _metadata(
                CI, model, available=False, reason="insufficient_failures"
            ),
        }
    if np.any(~np.isfinite(failures)):
        raise ValueError("Failure times must be finite.")
    if lognormal:
        if np.any(failures <= 0):
            raise ValueError("Lognormal failure times must be positive.")
        sample = np.log(failures)
    else:
        sample = failures

    mean = float(np.average(sample, weights=weights))
    centered_sum = float(np.sum(weights * (sample - mean) ** 2))
    if not np.isfinite(centered_sum) or centered_sum <= 0:
        return {
            "model": model,
            "parameter_intervals": {},
            "metadata": _metadata(
                CI, model, available=False, reason="zero_sample_variance"
            ),
        }
    df = n - 1
    sample_sd = math.sqrt(centered_sum / df)
    alpha = 1.0 - CI
    t_value = float(stats.t.ppf(1.0 - alpha / 2.0, df))
    mu_interval = (
        mean - t_value * sample_sd / math.sqrt(n),
        mean + t_value * sample_sd / math.sqrt(n),
    )
    sigma_interval = (
        math.sqrt(centered_sum / stats.chi2.ppf(1.0 - alpha / 2.0, df)),
        math.sqrt(centered_sum / stats.chi2.ppf(alpha / 2.0, df)),
    )
    return {
        "model": model,
        "sample": sample,
        "n": n,
        "mean": mean,
        "sample_sd": sample_sd,
        "parameter_intervals": {
            "mu": tuple(float(value) for value in mu_interval),
            "sigma": tuple(float(value) for value in sigma_interval),
        },
        "metadata": _metadata(CI, model),
    }


def _nct_noncentrality_endpoint(t_observed, df, probability):
    """Invert ``P(T <= t_observed | nc)=probability`` for ``nc``."""
    result = float(special.nctdtrinc(df, probability, t_observed))
    if not np.isfinite(result):
        raise RuntimeError("Could not invert the noncentral-t probability.")
    return result


def exact_normal_sf_bounds(inference, xvals):
    """Return exact pointwise SF bounds for Normal or Lognormal inference."""
    metadata = inference.get("metadata", {})
    if not metadata.get("available"):
        return None, None
    x = np.asarray(xvals, dtype=float)
    model = inference["model"]
    transformed = x.copy()
    outside = np.zeros(len(x), dtype=bool)
    if model == "Lognormal_2P":
        outside = x <= 0
        transformed = np.where(outside, 1.0, x)
        transformed = np.log(transformed)

    n = int(inference["n"])
    df = n - 1
    mean = float(inference["mean"])
    sample_sd = float(inference["sample_sd"])
    alpha = 1.0 - float(metadata["confidence_level"])
    lower = np.empty(len(x), dtype=float)
    upper = np.empty(len(x), dtype=float)
    for index, candidate in enumerate(transformed):
        if outside[index]:
            lower[index] = 1.0
            upper[index] = 1.0
            continue
        observed = math.sqrt(n) * (mean - float(candidate)) / sample_sd
        delta_lower = _nct_noncentrality_endpoint(
            observed, df, 1.0 - alpha / 2.0
        )
        delta_upper = _nct_noncentrality_endpoint(
            observed, df, alpha / 2.0
        )
        lower[index] = stats.norm.cdf(delta_lower / math.sqrt(n))
        upper[index] = stats.norm.cdf(delta_upper / math.sqrt(n))
    return np.clip(lower, 0.0, 1.0), np.clip(upper, 0.0, 1.0)
