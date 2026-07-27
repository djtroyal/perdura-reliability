"""Exact finite-sample inference for exponential life models.

The shifted exponential has a nonregular support parameter: its likelihood is
not differentiable in a neighbourhood of the location MLE.  Observed-Fisher
Wald intervals therefore are not valid for ``gamma``.  This module keeps the
distribution-specific pivotal inference separate from the generic Hessian and
delta-method machinery used by regular life distributions.
"""

from __future__ import annotations

from typing import Iterable

import numpy as np
from scipy import stats


_TYPE_II_RTOL = 1e-9
_TYPE_II_ATOL_FACTOR = 1e-12


def _weighted_sample(
    values: Iterable[float] | np.ndarray | None,
    weights: Iterable[float] | np.ndarray | None,
) -> tuple[np.ndarray, np.ndarray]:
    array = np.asarray([] if values is None else values, dtype=float)
    if array.ndim != 1 or np.any(~np.isfinite(array)):
        raise ValueError("Exponential observations must be a finite one-dimensional array.")
    if weights is None:
        weight_array = np.ones(len(array), dtype=float)
    else:
        weight_array = np.asarray(weights, dtype=float)
    if weight_array.shape != array.shape or np.any(~np.isfinite(weight_array)):
        raise ValueError("Exponential observation weights must match the observations.")
    if np.any(weight_array <= 0):
        raise ValueError("Exponential observation weights must be positive.")
    return array, weight_array


def classify_exponential_censoring(
    failures,
    right_censored=None,
    *,
    failure_weights=None,
    censored_weights=None,
) -> dict:
    """Classify a complete or conventional Type-II exponential sample.

    A Type-II sample has all surviving units suspended at the final observed
    failure time.  Other right-censoring patterns do not use the exact pivots
    implemented here.
    """
    failure, f_weight = _weighted_sample(failures, failure_weights)
    censored, c_weight = _weighted_sample(right_censored, censored_weights)
    if np.any(failure < 0) or (len(censored) and np.any(censored < 0)):
        raise ValueError("Exponential life observations must be nonnegative.")
    r = int(round(float(np.sum(f_weight))))
    n = r + int(round(float(np.sum(c_weight))))
    if len(failure) == 0 or r < 1:
        return {
            "design": "unsupported",
            "reason": "no_failures",
            "r": r,
            "n": n,
        }
    if len(censored) == 0:
        return {"design": "complete", "reason": None, "r": r, "n": n}

    final_failure = float(np.max(failure))
    scale = max(1.0, abs(final_failure), float(np.max(np.abs(censored))))
    is_type_ii = bool(np.all(np.isclose(
        censored,
        final_failure,
        rtol=_TYPE_II_RTOL,
        atol=_TYPE_II_ATOL_FACTOR * scale,
    )))
    return {
        "design": "type_ii" if is_type_ii else "unsupported",
        "reason": None if is_type_ii else "arbitrary_right_censoring",
        "r": r,
        "n": n,
    }


def exponential_1p_mle(
    failures,
    right_censored=None,
    *,
    failure_weights=None,
    censored_weights=None,
) -> tuple[float, float, int]:
    """Return ``(lambda_hat, total_time_on_test, failures)``."""
    failure, f_weight = _weighted_sample(failures, failure_weights)
    censored, c_weight = _weighted_sample(right_censored, censored_weights)
    if np.any(failure < 0) or (len(censored) and np.any(censored < 0)):
        raise ValueError("Exponential life observations must be nonnegative.")
    r = int(round(float(np.sum(f_weight))))
    total_time = float(np.dot(failure, f_weight))
    if len(censored):
        total_time += float(np.dot(censored, c_weight))
    if r < 1:
        raise ValueError("At least one failure is required for an exponential MLE.")
    if total_time <= 0 or not np.isfinite(total_time):
        raise ValueError("Exponential total time on test must be positive.")
    return r / total_time, total_time, r


def exponential_2p_mle(
    failures,
    right_censored=None,
    *,
    failure_weights=None,
    censored_weights=None,
) -> tuple[float, float, float, int, int]:
    """Return the support-boundary MLE and adjusted exposure.

    ``gamma_hat`` is the first failure.  Suspensions at or below that boundary
    contribute zero post-threshold exposure.
    """
    failure, f_weight = _weighted_sample(failures, failure_weights)
    censored, c_weight = _weighted_sample(right_censored, censored_weights)
    if len(failure) == 0:
        raise ValueError("At least one failure is required for an exponential MLE.")
    if np.any(failure < 0) or (len(censored) and np.any(censored < 0)):
        raise ValueError("Exponential life observations must be nonnegative.")
    gamma = float(np.min(failure))
    r = int(round(float(np.sum(f_weight))))
    n = r + int(round(float(np.sum(c_weight))))
    exposure = float(np.dot(failure - gamma, f_weight))
    if len(censored):
        exposure += float(np.dot(np.maximum(censored - gamma, 0.0), c_weight))
    if exposure <= 0 or not np.isfinite(exposure):
        raise ValueError(
            "The shifted-exponential adjusted exposure must be positive; "
            "review tied failure times and censoring."
        )
    return r / exposure, gamma, exposure, r, n


def _tie_warning(failures, failure_weights) -> bool:
    failure, weights = _weighted_sample(failures, failure_weights)
    return bool(
        np.any(weights > 1)
        or len(np.unique(failure)) < len(failure)
    )


def _base_metadata(
    *,
    available: bool,
    reason: str | None,
    design: str,
    CI: float,
    parameter_methods: dict[str, str],
    warnings: list[str],
) -> dict:
    return {
        "available": available,
        "reason": reason,
        "sample_design": design,
        "confidence_level": float(CI),
        "estimator": "MLE",
        "exact": available,
        "band_scope": "simultaneous" if available else None,
        "parameter_methods": parameter_methods,
        "function_method": "exact_joint_pivotal" if available else None,
        "assumptions": [
            "independent_identically_distributed_exponential_lifetimes",
            "noninformative_censoring",
            "continuous_failure_times",
        ],
        "warnings": warnings,
        "validation_status": (
            "analytic_finite_sample" if available else "unsupported"
        ),
        "primary": bool(available),
    }


def exponential_1p_exact_inference(
    failures,
    right_censored=None,
    *,
    CI: float = 0.95,
    failure_weights=None,
    censored_weights=None,
) -> dict:
    """Exact rate interval and simultaneous curve-band definition."""
    if not 0 < CI < 1:
        raise ValueError("CI must be between 0 and 1.")
    _, total_time, r = exponential_1p_mle(
        failures,
        right_censored,
        failure_weights=failure_weights,
        censored_weights=censored_weights,
    )
    classification = classify_exponential_censoring(
        failures,
        right_censored,
        failure_weights=failure_weights,
        censored_weights=censored_weights,
    )
    warnings = []
    if _tie_warning(failures, failure_weights):
        warnings.append("continuous_time_ties_or_rounding")
    reason = classification["reason"]
    if r < 2:
        reason = "insufficient_failures"
    available = reason is None
    metadata = _base_metadata(
        available=available,
        reason=reason,
        design=classification["design"],
        CI=CI,
        parameter_methods={"Lambda": "exact_chi_square"} if available else {},
        warnings=warnings,
    )
    result = {
        "model": "Exponential_1P",
        "metadata": metadata,
        "parameter_intervals": {},
        "total_time": total_time,
        "r": r,
    }
    if not available:
        return result
    alpha = 1.0 - CI
    lower = float(stats.chi2.ppf(alpha / 2.0, 2 * r) / (2.0 * total_time))
    upper = float(stats.chi2.ppf(1.0 - alpha / 2.0, 2 * r) / (2.0 * total_time))
    result["parameter_intervals"] = {"Lambda": (lower, upper)}
    result["lambda_band"] = (lower, upper)
    return result


def exponential_2p_exact_inference(
    failures,
    right_censored=None,
    *,
    CI: float = 0.95,
    failure_weights=None,
    censored_weights=None,
) -> dict:
    """Exact marginal intervals and an exact joint pivotal confidence set."""
    if not 0 < CI < 1:
        raise ValueError("CI must be between 0 and 1.")
    _, m, exposure, r, n = exponential_2p_mle(
        failures,
        right_censored,
        failure_weights=failure_weights,
        censored_weights=censored_weights,
    )
    classification = classify_exponential_censoring(
        failures,
        right_censored,
        failure_weights=failure_weights,
        censored_weights=censored_weights,
    )
    warnings = []
    if _tie_warning(failures, failure_weights):
        warnings.append("continuous_time_ties_or_rounding")
    reason = classification["reason"]
    if r < 2:
        reason = "insufficient_failures"
    if exposure <= 0:
        reason = "nonpositive_adjusted_exposure"
    available = reason is None
    metadata = _base_metadata(
        available=available,
        reason=reason,
        design=classification["design"],
        CI=CI,
        parameter_methods={
            "Lambda": "exact_chi_square",
            "gamma": "exact_support_bounded_f",
        } if available else {},
        warnings=warnings,
    )
    metadata["assumptions"].append("nonnegative_threshold")
    result = {
        "model": "Exponential_2P",
        "metadata": metadata,
        "parameter_intervals": {},
        "m": m,
        "exposure": exposure,
        "r": r,
        "n": n,
    }
    if not available:
        return result

    alpha = 1.0 - CI
    degrees = 2 * (r - 1)
    lambda_lower = float(stats.chi2.ppf(alpha / 2.0, degrees) / (2.0 * exposure))
    lambda_upper = float(stats.chi2.ppf(1.0 - alpha / 2.0, degrees) / (2.0 * exposure))
    f_quantile = float(stats.f.ppf(CI, 2, degrees))
    gamma_lower = max(0.0, m - exposure * f_quantile / (n * (r - 1)))
    result["parameter_intervals"] = {
        "Lambda": (lambda_lower, lambda_upper),
        "gamma": (float(gamma_lower), float(m)),
    }

    component_coverage = float(np.sqrt(CI))
    joint_alpha = 1.0 - component_coverage
    joint_lambda_lower = float(
        stats.chi2.ppf(joint_alpha / 2.0, degrees) / (2.0 * exposure)
    )
    joint_lambda_upper = float(
        stats.chi2.ppf(1.0 - joint_alpha / 2.0, degrees) / (2.0 * exposure)
    )
    result["joint_set"] = {
        "component_coverage": component_coverage,
        "lambda": (joint_lambda_lower, joint_lambda_upper),
        "location_pivot_upper": float(stats.chi2.ppf(component_coverage, 2)),
    }
    return result


def exact_exponential_sf_bounds(inference: dict, xvals) -> tuple[np.ndarray | None, np.ndarray | None]:
    """Envelope an exact exponential confidence set over the survival curve."""
    if not inference.get("metadata", {}).get("available", False):
        return None, None
    x = np.asarray(xvals, dtype=float)
    if inference["model"] == "Exponential_1P":
        lambda_lower, lambda_upper = inference["lambda_band"]
        nonnegative_x = np.maximum(x, 0.0)
        lower = np.exp(-lambda_upper * nonnegative_x)
        upper = np.exp(-lambda_lower * nonnegative_x)
        return np.clip(lower, 0.0, 1.0), np.clip(upper, 0.0, 1.0)

    m = float(inference["m"])
    n = int(inference["n"])
    joint = inference["joint_set"]
    lambda_lower, lambda_upper = joint["lambda"]
    location_constant = float(joint["location_pivot_upper"]) / (2.0 * n)

    candidates = [float(lambda_lower), float(lambda_upper)]
    if m > 0:
        transition = location_constant / m
        if lambda_lower <= transition <= lambda_upper:
            candidates.append(float(transition))

    maximum_hazard = np.zeros_like(x, dtype=float)
    for rate in candidates:
        gamma_lower = max(0.0, m - location_constant / rate)
        hazard = rate * np.maximum(x - gamma_lower, 0.0)
        maximum_hazard = np.maximum(maximum_hazard, hazard)
    lower = np.exp(-maximum_hazard)
    upper = np.where(x <= m, 1.0, np.exp(-lambda_lower * (x - m)))
    return np.clip(lower, 0.0, 1.0), np.clip(upper, 0.0, 1.0)
