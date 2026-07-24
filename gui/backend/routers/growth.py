"""Reliability Growth (Crow-AMSAA / Duane) router."""

import sys
import math
import numpy as np
from fastapi import APIRouter, HTTPException
from pathlib import Path
from scipy.stats import chi2, gamma as gamma_distribution, poisson

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.Repairable_systems import (
    CrowAMSAA, CrowAMSAAGrouped, Duane, optimal_replacement_time, ROCOF,
    MCF_nonparametric, MCF_parametric,
)
from reliability.Growth_planning import plan_reliability_growth
from schemas import (
    GrowthRequest, GrowthPlanRequest, OptimalReplacementRequest, ROCOFRequest, MCFRequest,
)

router = APIRouter()


@router.post("/plan", response_model=dict, summary="Plan a reliability-growth trajectory")
def growth_plan(request: GrowthPlanRequest):
    return plan_reliability_growth(**request.model_dump())


# Published Crow-AMSAA Cramer-von Mises critical values.  Columns are
# significance levels and rows are the effective event count M.  Handbook
# guidance calls for linear interpolation between tabulated sample-size rows.
_CVM_CRITICAL_VALUES = {
    2: {0.20: .138, 0.15: .149, 0.10: .162, 0.05: .175, 0.01: .186},
    3: {0.20: .121, 0.15: .135, 0.10: .154, 0.05: .184, 0.01: .230},
    4: {0.20: .121, 0.15: .134, 0.10: .155, 0.05: .191, 0.01: .280},
    5: {0.20: .121, 0.15: .137, 0.10: .160, 0.05: .199, 0.01: .300},
    6: {0.20: .123, 0.15: .139, 0.10: .162, 0.05: .204, 0.01: .310},
    7: {0.20: .124, 0.15: .140, 0.10: .165, 0.05: .208, 0.01: .320},
    8: {0.20: .124, 0.15: .141, 0.10: .165, 0.05: .210, 0.01: .320},
    9: {0.20: .125, 0.15: .142, 0.10: .167, 0.05: .212, 0.01: .320},
    10: {0.20: .125, 0.15: .142, 0.10: .167, 0.05: .212, 0.01: .320},
    11: {0.20: .126, 0.15: .143, 0.10: .169, 0.05: .214, 0.01: .320},
    12: {0.20: .126, 0.15: .144, 0.10: .169, 0.05: .214, 0.01: .320},
    13: {0.20: .126, 0.15: .144, 0.10: .169, 0.05: .214, 0.01: .330},
    14: {0.20: .126, 0.15: .144, 0.10: .169, 0.05: .214, 0.01: .330},
    15: {0.20: .126, 0.15: .144, 0.10: .169, 0.05: .215, 0.01: .330},
    16: {0.20: .127, 0.15: .145, 0.10: .171, 0.05: .216, 0.01: .330},
    17: {0.20: .127, 0.15: .145, 0.10: .171, 0.05: .217, 0.01: .330},
    18: {0.20: .127, 0.15: .146, 0.10: .171, 0.05: .217, 0.01: .330},
    19: {0.20: .127, 0.15: .146, 0.10: .171, 0.05: .217, 0.01: .330},
    20: {0.20: .128, 0.15: .146, 0.10: .172, 0.05: .217, 0.01: .330},
    30: {0.20: .128, 0.15: .146, 0.10: .172, 0.05: .218, 0.01: .330},
    60: {0.20: .128, 0.15: .147, 0.10: .173, 0.05: .220, 0.01: .330},
    100: {0.20: .129, 0.15: .147, 0.10: .173, 0.05: .220, 0.01: .340},
}


def _cvm_critical(m: int, significance: float = .10) -> float:
    """Published CvM critical value for ``m`` and a supported alpha."""
    if m < 2:
        raise ValueError("At least two transformed events are required for CvM.")
    alpha = float(significance)
    if alpha not in _CVM_CRITICAL_VALUES[2]:
        raise ValueError(
            "CvM significance must be one of 0.01, 0.05, 0.10, 0.15, or 0.20."
        )
    sizes = sorted(_CVM_CRITICAL_VALUES)
    if m >= sizes[-1]:
        return _CVM_CRITICAL_VALUES[sizes[-1]][alpha]
    lower = max(size for size in sizes if size <= m)
    upper = min(size for size in sizes if size >= m)
    if lower == upper:
        return _CVM_CRITICAL_VALUES[lower][alpha]
    fraction = (m - lower) / (upper - lower)
    return (_CVM_CRITICAL_VALUES[lower][alpha]
            + fraction * (_CVM_CRITICAL_VALUES[upper][alpha]
                          - _CVM_CRITICAL_VALUES[lower][alpha]))


def _attribute(obj, *names, default=None):
    """Return the first present, non-callable attribute from ``names``."""
    for name in names:
        if hasattr(obj, name):
            value = getattr(obj, name)
            if not callable(value):
                return value
    return default


def _finite_float(value):
    """Convert a numeric scalar to a JSON-safe float or ``None``."""
    if value is None:
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _relative_power(values, reference: float, exponent: float) -> np.ndarray:
    """Stable ``(values / reference) ** exponent`` for positive exponent."""
    values = np.asarray(values, dtype=float)
    output = np.zeros_like(values)
    positive = values > 0
    logs = exponent * (np.log(values[positive]) - math.log(reference))
    with np.errstate(over="ignore", under="ignore", invalid="ignore"):
        powered = np.exp(logs)
    output[positive] = np.nan_to_num(
        powered, nan=0.0, posinf=np.finfo(float).max, neginf=0.0)
    return output


def _expected_failures_values(fit, values) -> np.ndarray:
    """Evaluate the fitted mean using N(T)*(t/T)^beta, avoiding T**beta."""
    return _failure_count(fit) * _relative_power(
        values, float(fit.T), float(fit.beta))


def _failure_count(fit) -> int:
    """Common total-failure count across exact and grouped core objects."""
    value = _attribute(fit, "n", "n_failures")
    if value is None:
        raise ValueError("Crow-AMSAA result does not expose its failure count.")
    return int(value)


def _scale_from_beta(n: int, T: float, beta: float):
    """Compute n/T**beta on the log scale, or None if not representable."""
    log_scale = math.log(n) - beta * math.log(T)
    if not math.log(np.finfo(float).tiny) <= log_scale <= math.log(
            np.finfo(float).max):
        return None
    return math.exp(log_scale)


def _interval(fit, lower_names, upper_names, method_names=()) -> dict:
    """Normalize an interval and its method metadata from the core model."""
    lower = _finite_float(_attribute(fit, *lower_names))
    upper = _finite_float(_attribute(fit, *upper_names))
    method = _attribute(fit, *method_names) if method_names else None
    return {
        "lower": lower,
        "upper": upper,
        "method": method,
        "available": lower is not None and upper is not None,
    }


def _coverage_status(method, status, available: bool) -> str:
    """Normalize coverage language for intervals and one-sided bounds."""
    if not available:
        return "unavailable"
    status_name = str(status or "").lower()
    method_name = str(method or "").lower()
    if "conservative" in status_name and "exact" in status_name:
        return "exact_under_model_conservative"
    if status_name == "exact" or method_name.startswith("exact_") or (
            "crow_exact" in method_name):
        return "exact_under_model"
    if ("approximate_grouped" in status_name
            or "approximate_crow" in method_name):
        return "approximate_grouped_handbook"
    if "diagnostic" in status_name or "diagnostic" in method_name:
        return "diagnostic_not_target_calibrated"
    if "target_profile" in status_name or "target_profile" in method_name:
        return "asymptotic_target_profile_likelihood"
    if "profile" in status_name or "profile" in method_name:
        return "asymptotic_profile_likelihood"
    return "method_specific"


def _one_sided_lower_bound(
        fit, *, quantity: str, bound_names, confidence_names, method_names,
        status_names) -> dict:
    """Normalize a one-sided LCB without presenting it as a two-sided CI."""
    bound = _finite_float(_attribute(fit, *bound_names))
    confidence = _finite_float(_attribute(fit, *confidence_names))
    method = _attribute(fit, *method_names)
    status = _attribute(fit, *status_names)
    available = bound is not None
    return {
        "quantity": quantity,
        "side": "lower",
        "bound": bound,
        "confidence_level": confidence,
        "method": method,
        "status": status,
        "available": available,
        "coverage_status": _coverage_status(method, status, available),
    }


def _growth_interpretation(beta_like: float, model: str, mtbf_inst,
                           beta_lower=None, beta_upper=None,
                           confidence_level: float = .95) -> dict:
    """Plain-language verdict for a growth fit (mirrors _mcf_trend)."""
    if model == "crow_amsaa":
        if beta_like < 1:
            trend, verdict = "improving", "failure intensity is decreasing — reliability is growing"
        elif beta_like > 1:
            trend, verdict = "worsening", "failure intensity is increasing — reliability is degrading"
        else:
            trend, verdict = "constant", "failure intensity is constant (no growth)"
        detail = f"β = {beta_like:.3f} ({'<' if beta_like < 1 else '>' if beta_like > 1 else '='} 1): {verdict}."
        if beta_lower is not None and beta_upper is not None:
            confidence_pct = 100 * confidence_level
            confidence_label = f"{confidence_pct:g}%"
            if beta_lower > 1 or beta_upper < 1:
                detail += f" The {confidence_label} CI on β [{beta_lower:.3f}, {beta_upper:.3f}] excludes 1 — the trend is statistically significant."
            else:
                detail += f" The {confidence_label} CI on β [{beta_lower:.3f}, {beta_upper:.3f}] includes 1 — the trend is not statistically significant."
    else:   # duane: alpha > 0 means growth
        if beta_like > 0:
            trend, verdict = "improving", "cumulative MTBF is increasing — reliability is growing"
        elif beta_like < 0:
            trend, verdict = "worsening", "cumulative MTBF is decreasing — reliability is degrading"
        else:
            trend, verdict = "constant", "no growth trend"
        detail = f"Duane slope α = {beta_like:.3f}: {verdict}."
    if mtbf_inst is None or not np.isfinite(mtbf_inst):
        detail += (
            " Instantaneous MTBF is withheld outside the valid Duane growth "
            "regime (0 <= alpha < 1); use Crow-AMSAA and assess deterioration "
            "or change points."
        )
    else:
        detail += f" Current (instantaneous) MTBF ≈ {mtbf_inst:.4g}."
    return {"trend": trend, "detail": detail}


def _mcf_trend(times: list, mcf_vals: list) -> dict:
    """Return a descriptive MCF-shape indicator, not a hypothesis test.

    Splits the time series into two halves by index, fits a linear regression
    to each half, and compares the slopes (recurrence rates).
    """
    if len(times) < 4:
        return {
            "trend": "constant",
            "detail": (
                "Insufficient data for the descriptive two-segment shape "
                "indicator. No trend inference was performed."),
            "method": "descriptive_two_segment_slope_ratio",
            "inferential": False,
        }

    t = np.asarray(times, dtype=float)
    m = np.asarray(mcf_vals, dtype=float)

    mid = len(t) // 2
    t1, m1 = t[:mid], m[:mid]
    t2, m2 = t[mid:], m[mid:]

    # Linear regression slope for each half (polyfit degree 1)
    slope1 = float(np.polyfit(t1, m1, 1)[0])
    slope2 = float(np.polyfit(t2, m2, 1)[0])

    # Guard against division by zero / negative slopes
    if slope1 <= 0:
        ratio = 1.0
    else:
        ratio = slope2 / slope1

    if ratio < 0.85:
        trend_str = "improving"
        direction = "decreased"
        verdict = "system appears to be improving (reliability growth)"
    elif ratio > 1.15:
        trend_str = "worsening"
        direction = "increased"
        verdict = "system appears to be worsening (reliability degradation)"
    else:
        trend_str = "constant"
        direction = "remained stable"
        verdict = "recurrence rate is approximately constant"

    detail_str = (
        f"Descriptive segment slopes suggest the recurrence rate {direction} "
        f"from {slope1:.2e} to {slope2:.2e} per unit time (ratio "
        f"{ratio:.2f}) — {verdict}. This is a visual shape indicator, not a "
        "hypothesis test or calibrated trend decision."
    )
    return {
        "trend": trend_str,
        "detail": detail_str,
        "method": "descriptive_two_segment_slope_ratio",
        "inferential": False,
    }


def _exact_trend_test(fit, times: np.ndarray, confidence_level: float) -> dict:
    """Military-Handbook power-law trend test against an HPP null."""
    statistic = _finite_float(_attribute(
        fit, "trend_statistic", "trend_test_statistic", "trend_Q"))
    degrees_of_freedom = _attribute(
        fit, "trend_df", "trend_degrees_of_freedom")
    if statistic is None:
        statistic = float(2 * np.sum(math.log(float(fit.T)) - np.log(times)))
    if degrees_of_freedom is None:
        degrees_of_freedom = 2 * (
            fit.n - 1 if bool(fit.failure_terminated) else fit.n)
    degrees_of_freedom = int(degrees_of_freedom)

    p_improving = _finite_float(_attribute(
        fit, "trend_p_value_improving", "trend_p_improving"))
    p_worsening = _finite_float(_attribute(
        fit, "trend_p_value_worsening", "trend_p_worsening"))
    p_two_sided = _finite_float(_attribute(
        fit, "trend_p_value_two_sided", "trend_p_two_sided"))
    if p_improving is None:
        p_improving = float(chi2.sf(statistic, degrees_of_freedom))
    if p_worsening is None:
        p_worsening = float(chi2.cdf(statistic, degrees_of_freedom))
    if p_two_sided is None:
        p_two_sided = min(1.0, 2 * min(p_improving, p_worsening))

    alpha = 1 - confidence_level
    # Direction is a property of this hypothesis test, so derive it from the
    # same null distribution and one-sided tails used for its p-values.  A
    # modified-MLE threshold can disagree with those tails in small samples
    # (especially for failure-terminated tests), producing a contradictory
    # direction and directional p-value.  The raw MLE is retained only as
    # useful context for the sufficient statistic.
    direction_beta = _finite_float(_attribute(fit, "beta_mle"))
    tail_tolerance = 8 * np.finfo(float).eps
    if math.isclose(p_improving, p_worsening, rel_tol=0.0,
                    abs_tol=tail_tolerance):
        direction = "constant"
        directional_p = p_two_sided
    elif p_improving < p_worsening:
        direction = "improving"
        directional_p = p_improving
    else:
        direction = "worsening"
        directional_p = p_worsening
    return {
        "available": True,
        "method": "Military Handbook power-law process trend test",
        "null_hypothesis": "beta = 1 (homogeneous Poisson process)",
        "statistic": statistic,
        "distribution": "chi-square",
        "degrees_of_freedom": degrees_of_freedom,
        "significance": alpha,
        "significance_role": "trend-test alpha (1 - confidence level)",
        "p_value_improving": p_improving,
        "p_value_worsening": p_worsening,
        "p_value_two_sided": p_two_sided,
        "shape_for_direction": direction_beta,
        "direction_estimator": "raw MLE (context for the test statistic)",
        "direction_basis": "smaller one-sided chi-square null tail",
        "observed_direction": direction,
        "directional_p_value": directional_p,
        "decision": "reject" if p_two_sided < alpha else "fail_to_reject",
        "decision_text": (
            "Reject the homogeneous-Poisson no-trend hypothesis."
            if p_two_sided < alpha else
            "Fail to reject the homogeneous-Poisson no-trend hypothesis."
        ),
    }


def _confidence_metadata(fit, confidence_level: float) -> dict:
    """Expose point estimates, bounds, and the method for each interval."""
    beta = _interval(
        fit, ("beta_lower", "beta_CI_lower"),
        ("beta_upper", "beta_CI_upper"),
        ("beta_interval_method", "beta_CI_method"))
    beta["estimate"] = _finite_float(fit.beta)

    scale = _interval(
        fit, ("Lambda_lower", "lambda_lower", "scale_lower"),
        ("Lambda_upper", "lambda_upper", "scale_upper"),
        ("Lambda_interval_method", "lambda_interval_method",
         "scale_interval_method"))
    scale_estimate = _finite_float(fit.Lambda)
    # ``_safe_exp`` deliberately returns zero when Lambda underflows.  Zero is
    # not a valid power-law scale and conflicts with the top-level
    # ``scale_representable=False`` contract, so expose it as unavailable while
    # retaining log_Lambda elsewhere in the response.
    scale["estimate"] = (scale_estimate
                         if scale_estimate is not None and scale_estimate > 0
                         else None)

    growth = _interval(
        fit, ("growth_rate_lower",), ("growth_rate_upper",),
        ("growth_rate_interval_method", "beta_interval_method"))
    if not growth["available"] and beta["available"]:
        growth["lower"] = 1 - beta["upper"]
        growth["upper"] = 1 - beta["lower"]
        growth["available"] = True
        growth["method"] = beta["method"]
    growth["estimate"] = _finite_float(_attribute(
        fit, "growth_rate", default=1 - fit.beta))

    intensity = _interval(
        fit,
        ("instantaneous_failure_intensity_lower", "intensity_lower",
         "failure_intensity_lower"),
        ("instantaneous_failure_intensity_upper", "intensity_upper",
         "failure_intensity_upper"),
        ("intensity_interval_method", "failure_intensity_interval_method"))
    n = _failure_count(fit)
    T = float(fit.T)
    intensity["estimate"] = _finite_float(_attribute(
        fit, "instantaneous_failure_intensity",
        "instantaneous_failure_intensity_at_end",
        default=n * fit.beta / T))

    cumulative_mtbf = _interval(
        fit, ("cumulative_MTBF_lower", "mtbf_cumulative_lower"),
        ("cumulative_MTBF_upper", "mtbf_cumulative_upper"),
        ("cumulative_MTBF_interval_method", "mtbf_cumulative_interval_method"))
    cumulative_mtbf["estimate"] = _finite_float(_attribute(
        fit, "cumulative_MTBF", default=T / n))

    instantaneous_mtbf = _interval(
        fit, ("instantaneous_MTBF_lower", "mtbf_instantaneous_lower"),
        ("instantaneous_MTBF_upper", "mtbf_instantaneous_upper"),
        ("instantaneous_MTBF_interval_method",
         "mtbf_instantaneous_interval_method", "intensity_interval_method"))
    instantaneous_mtbf["estimate"] = _finite_float(_attribute(
        fit, "instantaneous_MTBF", "instantaneous_MTBF_at_end",
        default=T / (n * fit.beta)))

    grouped_profile_mtbf = None
    grouped_profile_intensity = None
    grouped_handbook_mtbf = None
    grouped_handbook_intensity = None
    if hasattr(fit, "last_interval_average_MTBF"):
        grouped_profile_mtbf = _interval(
            fit,
            ("last_interval_average_MTBF_profile_lower",),
            ("last_interval_average_MTBF_profile_upper",),
            ("last_interval_average_MTBF_profile_interval_method",))
        grouped_profile_mtbf["estimate"] = _finite_float(
            fit.last_interval_average_MTBF)
        grouped_profile_intensity = _interval(
            fit,
            ("last_interval_average_failure_intensity_profile_lower",),
            ("last_interval_average_failure_intensity_profile_upper",),
            ("last_interval_average_MTBF_profile_interval_method",))
        grouped_profile_intensity["estimate"] = _finite_float(
            fit.last_interval_average_failure_intensity)
        grouped_profile_status = _attribute(
            fit, "last_interval_average_MTBF_profile_interval_status")
        if grouped_profile_status is not None:
            grouped_profile_mtbf["status"] = grouped_profile_status
            grouped_profile_intensity["status"] = grouped_profile_status

        grouped_handbook_mtbf = _interval(
            fit,
            ("last_interval_average_MTBF_lower",),
            ("last_interval_average_MTBF_upper",),
            ("last_interval_average_MTBF_interval_method",))
        grouped_handbook_mtbf["estimate"] = _finite_float(
            fit.last_interval_average_MTBF)
        grouped_handbook_intensity = _interval(
            fit,
            ("last_interval_average_failure_intensity_lower",),
            ("last_interval_average_failure_intensity_upper",),
            ("last_interval_average_MTBF_interval_method",))
        grouped_handbook_intensity["estimate"] = _finite_float(
            fit.last_interval_average_failure_intensity)
        grouped_handbook_status = _attribute(
            fit, "last_interval_average_MTBF_interval_status")
        if grouped_handbook_status is not None:
            grouped_handbook_mtbf["status"] = grouped_handbook_status
            grouped_handbook_intensity["status"] = grouped_handbook_status

    interval_status = _attribute(fit, "instantaneous_MTBF_interval_status")
    if interval_status is not None:
        intensity["status"] = interval_status
        instantaneous_mtbf["status"] = interval_status
    elif "diagnostic" in str(instantaneous_mtbf.get("method", "")).lower():
        intensity["status"] = "diagnostic_not_target_calibrated"
        instantaneous_mtbf["status"] = "diagnostic_not_target_calibrated"

    for interval in (intensity, instantaneous_mtbf):
        method = interval.get("method")
        if (method and "profile" in method.lower()
                and "asymptotic" not in method.lower()):
            interval["method"] = f"asymptotic_{method}"

    warnings = []
    uses_profile = "profile" in str(instantaneous_mtbf.get("method", "")).lower()
    interval_status_name = str(
        instantaneous_mtbf.get("status", "")).lower()
    is_exact = interval_status_name == "exact"
    is_diagnostic = interval_status_name == "diagnostic_not_target_calibrated"
    if n < 20 and uses_profile and not is_exact and not is_diagnostic:
        warning = (
            "Current-intensity/current-MTBF profile intervals are asymptotic. "
            "With fewer than 20 failures, treat them as screening guidance and "
            "review the reported method rather than assuming exact finite-sample "
            "coverage."
        )
        warnings.append(warning)
        for interval in (intensity, instantaneous_mtbf):
            interval["coverage_status"] = "small_sample_asymptotic"
            interval["warning"] = warning
    if is_diagnostic:
        warning = (
            "Grouped endpoint intensity and MTBF bounds map the beta profile "
            "along its profiled-scale ridge; they are diagnostics, not "
            "target-profile confidence intervals for endpoint intensity."
        )
        warnings.append(warning)
        for interval in (intensity, instantaneous_mtbf):
            interval["coverage_status"] = "diagnostic_not_target_calibrated"
            interval["warning"] = warning

    intervals = {
        "beta": beta,
        "Lambda": scale,
        "growth_rate": growth,
        "instantaneous_failure_intensity_at_T": intensity,
        "cumulative_mtbf_at_T": cumulative_mtbf,
        "instantaneous_mtbf_at_T": instantaneous_mtbf,
    }
    if grouped_profile_mtbf is not None and grouped_profile_intensity is not None:
        intervals["final_interval_average_failure_intensity_target_profile"] = (
            grouped_profile_intensity)
        intervals["final_interval_average_mtbf_target_profile"] = (
            grouped_profile_mtbf)
    if (grouped_handbook_mtbf is not None
            and grouped_handbook_intensity is not None):
        intervals[
            "final_interval_average_failure_intensity_handbook_approximate"
        ] = grouped_handbook_intensity
        intervals["final_interval_average_mtbf_handbook_approximate"] = (
            grouped_handbook_mtbf)
    # Normalize the method/status vocabulary for every interval.  The client
    # and report builder consume ``coverage_status``; retaining only the core's
    # historical ``status`` field made exact and large-sample profile results
    # appear to have unknown coverage.
    for interval in intervals.values():
        if "coverage_status" in interval:
            continue
        interval["coverage_status"] = _coverage_status(
            interval.get("method"), interval.get("status"),
            interval["available"])

    # Confidence sets target the underlying parameter, but their finite-sample
    # pivots are constructed from a specific statistic.  When the user reports
    # the modified MLE, keep that selected point in ``estimate`` while exposing
    # the raw-MLE reference used to construct the exact bounds.
    has_exact_raw_mle = hasattr(fit, "beta_mle")
    if has_exact_raw_mle:
        references = {
            "beta": _attribute(
                fit, "beta_interval_reference_estimate", "beta_mle"),
            "Lambda": _attribute(fit, "Lambda_mle"),
            "growth_rate": 1.0 - float(fit.beta_mle),
            "instantaneous_failure_intensity_at_T": _attribute(
                fit, "instantaneous_failure_intensity_mle"),
            "cumulative_mtbf_at_T": _attribute(
                fit, "cumulative_MTBF_interval_reference_estimate",
                "cumulative_MTBF"),
            "instantaneous_mtbf_at_T": _attribute(
                fit, "instantaneous_MTBF_interval_reference_estimate",
                "instantaneous_MTBF_mle"),
        }
        reported_basis = f"selected_{_attribute(fit, 'estimator', default='mle')}"
        reference_basis = (
            f"raw_{_attribute(fit, 'interval_reference_estimator', default='mle')}"
            "_interval_statistic")
    else:
        references = {name: interval.get("estimate")
                      for name, interval in intervals.items()}
        reported_basis = "grouped_mle"
        reference_basis = "grouped_mle_interval_statistic"
    for name, interval in intervals.items():
        interval["reported_estimate_basis"] = (
            "endpoint_count_identity"
            if name == "cumulative_mtbf_at_T" else reported_basis)
        interval["interval_reference_estimate"] = _finite_float(
            references.get(name, interval.get("estimate")))
        method = str(interval.get("method", ""))
        if "target_profile" in method:
            interval["interval_reference_basis"] = (
                "grouped_mle_target_profile_statistic")
        elif "approximate_crow" in method:
            interval["interval_reference_basis"] = (
                "grouped_mle_handbook_crow_coefficient_reference")
        else:
            interval["interval_reference_basis"] = reference_basis

    one_sided_bounds = {}
    if hasattr(fit, "instantaneous_MTBF_one_sided_lower"):
        current_mtbf_lcb = _one_sided_lower_bound(
            fit,
            quantity="instantaneous_mtbf_at_T",
            bound_names=("instantaneous_MTBF_one_sided_lower",),
            confidence_names=("instantaneous_MTBF_one_sided_confidence",),
            method_names=("instantaneous_MTBF_one_sided_lower_method",),
            status_names=("instantaneous_MTBF_one_sided_lower_status",),
        )
        if current_mtbf_lcb["confidence_level"] is None:
            current_mtbf_lcb["confidence_level"] = confidence_level
        current_mtbf_lcb.update({
            "estimate": instantaneous_mtbf.get("estimate"),
            "reported_estimate_basis": reported_basis,
            "interval_reference_estimate": _finite_float(
                references.get("instantaneous_mtbf_at_T")),
            "interval_reference_basis": reference_basis,
        })
        one_sided_bounds["instantaneous_mtbf_at_T_lower"] = current_mtbf_lcb

    if hasattr(fit, "last_interval_average_MTBF_one_sided_lower"):
        final_mtbf_lcb = _one_sided_lower_bound(
            fit,
            quantity="final_interval_average_mtbf",
            bound_names=("last_interval_average_MTBF_one_sided_lower",),
            confidence_names=(
                "last_interval_average_MTBF_one_sided_confidence",),
            method_names=(
                "last_interval_average_MTBF_one_sided_lower_method",),
            status_names=(
                "last_interval_average_MTBF_one_sided_lower_status",),
        )
        if final_mtbf_lcb["confidence_level"] is None:
            final_mtbf_lcb["confidence_level"] = confidence_level
        final_mtbf_lcb.update({
            "estimate": _finite_float(fit.last_interval_average_MTBF),
            "reported_estimate_basis": "grouped_mle",
            "interval_reference_estimate": _finite_float(
                fit.last_interval_average_MTBF),
            "interval_reference_basis": (
                "grouped_mle_handbook_crow_coefficient_reference"),
        })
        one_sided_bounds[
            "final_interval_average_mtbf_handbook_lower"
        ] = final_mtbf_lcb
    return {
        "level": confidence_level,
        "alpha": 1 - confidence_level,
        "intervals": intervals,
        "available_parameters": [
            name for name, interval in intervals.items() if interval["available"]
        ],
        "one_sided_bounds": one_sided_bounds,
        "warnings": warnings,
    }


def _exact_gof(fit, significance: float) -> dict:
    """Cramer-von Mises result with hypothesis-test-safe wording."""
    effective_n = fit.n - 1 if bool(fit.failure_terminated) else fit.n
    available = bool(_attribute(
        fit, "cvm_available", default=effective_n >= 2))
    statistic = _finite_float(_attribute(fit, "CvM", "cvm_statistic"))
    available = available and statistic is not None and effective_n >= 2
    if not available:
        return {
            "available": False,
            "method": "Cramer-von Mises",
            "statistic": None,
            "critical_value": None,
            "significance": significance,
            "decision": "unavailable",
            "decision_text": "Cramer-von Mises requires at least two transformed events.",
            "effective_event_count": effective_n,
            "shape_used": _finite_float(_attribute(fit, "cvm_beta")),
        }

    critical = _cvm_critical(effective_n, significance)
    reject = statistic >= critical
    return {
        "available": True,
        "method": "Cramer-von Mises",
        "statistic": statistic,
        "critical_value": critical,
        "critical_value_method": (
            "published MIL-HDBK-189 table with linear interpolation by sample size"
        ),
        "significance": significance,
        "decision": "reject" if reject else "fail_to_reject",
        "decision_text": (
            "Reject the power-law NHPP model at the selected significance level."
            if reject else
            "Fail to reject the power-law NHPP model at the selected significance level."
        ),
        "effective_event_count": effective_n,
        "shape_used": _finite_float(_attribute(fit, "cvm_beta")),
    }


def _grouped_gof(fit, significance: float) -> dict:
    """Normalize the grouped Pearson chi-square goodness-of-fit result."""
    statistic = _finite_float(_attribute(
        fit, "chi_square_statistic", "pearson_chi_square", "gof_statistic"))
    degrees_of_freedom = _attribute(
        fit, "chi_square_df", "gof_degrees_of_freedom", "gof_df")
    degrees_of_freedom = (int(degrees_of_freedom)
                          if degrees_of_freedom is not None else None)
    p_value = _finite_float(_attribute(
        fit, "chi_square_p_value", "gof_p_value"))
    if (p_value is None and statistic is not None and degrees_of_freedom
            and degrees_of_freedom > 0):
        p_value = float(chi2.sf(statistic, degrees_of_freedom))
    critical = _finite_float(_attribute(
        fit, "chi_square_critical", "gof_critical_value"))
    if critical is None and degrees_of_freedom and degrees_of_freedom > 0:
        critical = float(chi2.ppf(1 - significance, degrees_of_freedom))
    available = bool(_attribute(
        fit, "gof_available", "chi_square_available",
        default=(statistic is not None and p_value is not None)))
    valid = bool(_attribute(
        fit, "gof_valid", "chi_square_valid", default=available))
    if not available or not valid:
        decision = "unavailable"
        decision_text = _attribute(
            fit, "gof_reason", "chi_square_reason",
            default=("Grouped Pearson chi-square is unavailable because the "
                     "degrees of freedom or expected-count conditions are insufficient."))
    else:
        reject = p_value < significance
        decision = "reject" if reject else "fail_to_reject"
        decision_text = (
            "Reject the power-law NHPP model at the selected significance level."
            if reject else
            "Fail to reject the power-law NHPP model at the selected significance level."
        )
    pooled_intervals = _attribute(fit, "gof_pooled_intervals")
    if pooled_intervals is None and hasattr(fit, "pooled_interval_bounds"):
        pooled_intervals = [
            {
                "start": float(bounds[0]),
                "end": float(bounds[1]),
                "observed": int(observed),
                "expected": float(expected),
            }
            for bounds, observed, expected in zip(
                fit.pooled_interval_bounds,
                fit.pooled_observed_counts,
                fit.pooled_expected_counts)
        ]
    return {
        "available": available and valid,
        "method": "Pearson chi-square for grouped interval counts",
        "statistic": statistic,
        "degrees_of_freedom": degrees_of_freedom,
        "p_value": p_value,
        "critical_value": critical,
        "significance": significance,
        "decision": decision,
        "decision_text": decision_text,
        "expected_count_rule": _attribute(
            fit, "gof_expected_count_rule",
            default="adjacent intervals pooled to expected count >= 5"),
        "pooled_intervals": pooled_intervals,
    }


def _continuation_prediction(fit, horizon, failure_count: int,
                             probability: float, confidence_level: float) -> dict:
    """Conditional NHPP continuation forecast with fixed fitted parameters."""
    T = float(fit.T)
    transformed_increment = float(gamma_distribution.ppf(
        probability, a=failure_count))
    n = _failure_count(fit)
    # Lambda*T**beta = n.  Expressing the inversion relative to T avoids
    # forming either power at potentially extreme time-unit scales.
    future_event_time = T * math.exp(
        math.log1p(transformed_increment / n) / fit.beta)
    output = {
        "model": "power-law NHPP continuation",
        "uncertainty_scope": (
            "conditional process uncertainty with fitted parameters held fixed"
        ),
        "parameter_uncertainty_included": False,
        "future_event": {
            "order": failure_count,
            "quantile_probability": probability,
            "absolute_time": future_event_time,
            "elapsed_time_after_T": future_event_time - T,
        },
        "horizon": None,
    }
    if horizon is None:
        return output

    end_time = T + float(horizon)
    expected = n * math.expm1(
        fit.beta * math.log1p(float(horizon) / T))
    alpha = 1 - confidence_level
    output["horizon"] = {
        "elapsed_time": float(horizon),
        "end_time": end_time,
        "expected_failures": expected,
        "probability_no_failures": math.exp(-expected),
        "failure_count_prediction_interval": {
            "level": confidence_level,
            "lower": int(poisson.ppf(alpha / 2, expected)),
            "upper": int(poisson.ppf(1 - alpha / 2, expected)),
            "method": "Poisson NHPP process-count quantiles",
        },
    }
    return output


def _model_curves(fit, reference_time: float) -> tuple[np.ndarray, ...]:
    """Plot-ready expected count, intensity, and MTBF curves."""
    T = float(fit.T)
    lower = max(min(float(reference_time), T) * .5, T * 1e-6,
                np.nextafter(0.0, 1.0))
    lower = min(lower, T)
    t_grid = np.geomspace(lower, T, 160)
    expected = _expected_failures_values(fit, t_grid)
    # At T, cumulative MTBF=T/n and intensity=n*beta/T.  Scaling those
    # endpoint identities by t/T is stable and independent of Lambda's unit
    # dependent magnitude.
    n = _failure_count(fit)
    intensity = ((n * fit.beta / T)
                 * _relative_power(t_grid, T, fit.beta - 1))
    cumulative_mtbf = ((T / n)
                       * _relative_power(t_grid, T, 1 - fit.beta))
    instantaneous_mtbf = cumulative_mtbf / fit.beta
    return t_grid, expected, intensity, cumulative_mtbf, instantaneous_mtbf


def _parameter_snapshot(beta, Lambda, T, n, log_Lambda=None) -> dict | None:
    """Derived endpoint measures for one Crow-AMSAA parameterization."""
    beta = _finite_float(beta)
    Lambda = _finite_float(Lambda)
    log_Lambda = _finite_float(log_Lambda)
    if beta is None or beta <= 0:
        return None
    if Lambda is not None and Lambda <= 0:
        Lambda = None
    if log_Lambda is None and Lambda is not None:
        log_Lambda = math.log(Lambda)
    intensity = n * beta / T
    cumulative_mtbf = T / n
    return {
        "beta": beta,
        "Lambda": Lambda,
        "log_Lambda": log_Lambda,
        "scale_representable": Lambda is not None,
        "growth_rate": 1 - beta,
        "instantaneous_failure_intensity_at_T": intensity,
        "instantaneous_mtbf_at_T": 1 / intensity,
        "cumulative_mtbf_at_T": cumulative_mtbf,
    }


def _crow_parameter_sets(fit, times: np.ndarray | None,
                         selected_estimator: str) -> dict:
    """Return raw and modified MLEs and identify the curve parameterization."""
    T = float(fit.T)
    raw_beta = _attribute(fit, "beta_mle", "raw_beta", "beta_raw")
    raw_lambda = _attribute(fit, "Lambda_mle", "raw_Lambda", "Lambda_raw")
    raw_log_lambda = _attribute(
        fit, "log_Lambda_mle", "log_lambda_mle", "raw_log_Lambda")
    modified_beta = _attribute(
        fit, "beta_modified_mle", "modified_beta", "beta_bias_corrected")
    modified_lambda = _attribute(
        fit, "Lambda_modified_mle", "modified_Lambda",
        "Lambda_bias_corrected")
    modified_log_lambda = _attribute(
        fit, "log_Lambda_modified_mle", "log_Lambda_bias_corrected",
        "modified_log_Lambda")

    # Exact-event formulas provide a deterministic fallback for cores that
    # expose only the selected point estimate.  Grouped data intentionally do
    # not receive an ad-hoc small-sample correction.
    if times is not None:
        n = len(times)
        log_sum = float(np.sum(math.log(T) - np.log(times)))
        if log_sum > 0:
            raw_beta = n / log_sum if raw_beta is None else raw_beta
            if raw_log_lambda is None:
                raw_log_lambda = math.log(n) - float(raw_beta) * math.log(T)
            raw_lambda = (_scale_from_beta(n, T, float(raw_beta))
                          if raw_lambda is None else raw_lambda)
            correction_numerator = n - (2 if fit.failure_terminated else 1)
            if correction_numerator > 0:
                modified_beta = (correction_numerator / log_sum
                                 if modified_beta is None else modified_beta)
                if modified_log_lambda is None:
                    modified_log_lambda = (
                        math.log(n) - float(modified_beta) * math.log(T))
                modified_lambda = (_scale_from_beta(n, T, float(modified_beta))
                                   if modified_lambda is None else modified_lambda)

    # If only one parameterization is known, it is the selected one.
    if selected_estimator == "mle":
        raw_beta = fit.beta if raw_beta is None else raw_beta
        raw_lambda = fit.Lambda if raw_lambda is None else raw_lambda
        raw_log_lambda = _attribute(
            fit, "log_Lambda", default=raw_log_lambda)
    else:
        modified_beta = fit.beta if modified_beta is None else modified_beta
        modified_lambda = fit.Lambda if modified_lambda is None else modified_lambda
        modified_log_lambda = _attribute(
            fit, "log_Lambda", default=modified_log_lambda)

    return {
        "selected": selected_estimator,
        "curves_use": selected_estimator,
        "mle": _parameter_snapshot(
            raw_beta, raw_lambda, T, _failure_count(fit), raw_log_lambda),
        "modified_mle": _parameter_snapshot(
            modified_beta, modified_lambda, T, _failure_count(fit),
            modified_log_lambda),
    }


@router.post("/fit")
def fit_growth(req: GrowthRequest):
    """Fit a reliability-growth model with an explicit observation design."""
    model_name = req.model.lower().replace("-", "_")
    termination = req.termination or ("time" if req.T is not None else "failure")
    exact_times = (np.asarray(req.times, dtype=float)
                   if req.data_mode == "exact" else None)
    try:
        if model_name == "duane":
            fit = Duane(times=exact_times, T=req.T)
        elif req.data_mode == "exact":
            fit = CrowAMSAA(
                times=exact_times,
                T=req.T,
                failure_terminated=termination == "failure",
                CI=req.CI,
                estimator=req.estimator,
            )
        else:
            fit = CrowAMSAAGrouped(
                interval_ends=req.grouped_endpoints,
                failure_counts=req.grouped_counts,
                CI=req.CI,
                significance=req.gof_significance,
            )
            termination = "time"
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    n = _failure_count(fit)
    T = float(fit.T)
    if model_name == "duane":
        times = np.asarray(exact_times, dtype=float)
        t_grid = np.geomspace(float(times[0]), T, 160)
        # implied cumulative failures: N(t) = t / m_c(t) = t^(1-alpha) / A
        model_n = t_grid ** (1 - fit.alpha) / fit.A
        mtbf_cumulative_curve = fit.MTBF_cumulative(t_grid)
        mtbf_instantaneous_curve = fit.MTBF_instantaneous(t_grid)
        mtbf_inst = fit.DMTBF_I
        interpretation = _growth_interpretation(
            fit.alpha, model_name,
            float(mtbf_inst) if mtbf_inst is not None else None,
            confidence_level=req.CI)
        return {
            "model": model_name,
            "data_mode": "exact",
            "termination": None,
            "alpha": round(fit.alpha, 6),
            "A": float(f"{fit.A:.6g}"),
            "r_squared": round(fit.r_squared, 6),
            "CvM": None,
            "valid_growth_regime": fit.valid_growth_regime,
            "regime_warning": fit.regime_warning,
            "interpretation": interpretation,
            "growth_rate": round(float(fit.alpha), 6),
            "mtbf_instantaneous": (_finite_float(mtbf_inst)
                                   if mtbf_inst is not None else None),
            "mtbf_cumulative": _finite_float(fit.DMTBF_C),
            "n_failures": n,
            "T": T,
            "scatter": {"t": times.tolist(), "n": list(range(1, n + 1))},
            "model_curve": {"t": t_grid.tolist(), "n": model_n.tolist()},
            "mtbf_curve": {
                "t": t_grid.tolist(),
                "cumulative": np.asarray(
                    mtbf_cumulative_curve, dtype=float).tolist(),
                "instantaneous": (
                    np.asarray(mtbf_instantaneous_curve, dtype=float).tolist()
                    if mtbf_inst is not None else [None] * len(t_grid)
                ),
            },
        }

    reference_time = (float(exact_times[0]) if exact_times is not None
                      else float(req.grouped_endpoints[0]))
    (t_grid, model_n, intensity_curve, mtbf_cumulative_curve,
     mtbf_instantaneous_curve) = _model_curves(fit, reference_time)
    confidence = _confidence_metadata(fit, req.CI)
    beta_interval = confidence["intervals"]["beta"]

    if req.data_mode == "exact":
        times = np.asarray(exact_times, dtype=float)
        gof = _exact_gof(fit, req.gof_significance)
        trend_test = _exact_trend_test(fit, times, req.CI)
        scatter_t = times.tolist()
        scatter_n = list(range(1, n + 1))
        observed_cumulative = scatter_n
        expected_at_observations = _expected_failures_values(
            fit, times).astype(float).tolist()
        unique_times, tied_counts = np.unique(times, return_counts=True)
        interval_ends = unique_times.astype(float).tolist()
        interval_counts = tied_counts.astype(int).tolist()
        if termination == "time" and T > float(times[-1]):
            interval_ends.append(T)
            interval_counts.append(0)
        interval_starts = [0.0] + interval_ends[:-1]
        start_arr = np.asarray(interval_starts, dtype=float)
        end_arr = np.asarray(interval_ends, dtype=float)
        expected_counts = np.asarray(
            fit.expected_failures_between(start_arr, end_arr),
            dtype=float).tolist()
        parameter_sets = _crow_parameter_sets(
            fit, times, _attribute(fit, "estimator", default=req.estimator))
    else:
        ends = np.asarray(req.grouped_endpoints, dtype=float)
        interval_starts = [0.0] + req.grouped_endpoints[:-1]
        interval_ends = req.grouped_endpoints
        interval_counts = req.grouped_counts
        expected_counts_core = _attribute(
            fit, "expected_counts", "expected_interval_counts")
        if expected_counts_core is None:
            starts = np.asarray(interval_starts, dtype=float)
            expected_counts_core = (_expected_failures_values(fit, ends)
                                    - _expected_failures_values(fit, starts))
        expected_counts = np.asarray(
            expected_counts_core, dtype=float).tolist()
        scatter_t = ends.tolist()
        scatter_n = np.cumsum(req.grouped_counts).astype(int).tolist()
        observed_cumulative = scatter_n
        expected_at_observations = _expected_failures_values(
            fit, ends).astype(float).tolist()
        gof = _grouped_gof(fit, req.gof_significance)
        trend_test = {
            "available": False,
            "method": "Military Handbook exact-event power-law trend test",
            "decision": "unavailable",
            "decision_text": (
                "The exact-event trend test is unavailable for grouped interval "
                "counts; use the beta interval and grouped goodness-of-fit diagnostics."
            ),
            "significance": 1 - req.CI,
            "significance_role": "trend-test alpha (1 - confidence level)",
        }
        parameter_sets = _crow_parameter_sets(
            fit, None, _attribute(fit, "estimator", default="mle"))

    durations = np.asarray(interval_ends) - np.asarray(interval_starts)
    observed_average_intensity = (
        np.asarray(interval_counts, dtype=float) / durations).tolist()
    expected_average_intensity = (
        np.asarray(expected_counts, dtype=float) / durations).tolist()

    grouped_final_interval = None
    if req.data_mode == "grouped":
        final_intensity = expected_average_intensity[-1]
        final_mtbf = 1.0 / final_intensity
        grouped_final_interval = {
            "start": float(interval_starts[-1]),
            "end": float(interval_ends[-1]),
            "observed_failures": int(interval_counts[-1]),
            "expected_failures": float(expected_counts[-1]),
            "average_failure_intensity": float(final_intensity),
            "average_mtbf": float(final_mtbf),
            "confidence_level": req.CI,
            "target_profile": {
                "average_failure_intensity_interval": confidence[
                    "intervals"].get(
                        "final_interval_average_failure_intensity_target_profile"),
                "average_mtbf_interval": confidence["intervals"].get(
                    "final_interval_average_mtbf_target_profile"),
            },
            "handbook_approximate": {
                "average_failure_intensity_interval": confidence[
                    "intervals"].get(
                        "final_interval_average_failure_intensity_handbook_approximate"),
                "average_mtbf_interval": confidence["intervals"].get(
                    "final_interval_average_mtbf_handbook_approximate"),
                "average_mtbf_one_sided_lower_bound": confidence[
                    "one_sided_bounds"].get(
                        "final_interval_average_mtbf_handbook_lower"),
            },
        }

    selected_estimator = parameter_sets["selected"]
    selected_parameters = parameter_sets[selected_estimator]
    interpretation = _growth_interpretation(
        fit.beta, model_name,
        selected_parameters["instantaneous_mtbf_at_T"],
        beta_interval["lower"], beta_interval["upper"], req.CI)
    prediction = _continuation_prediction(
        fit, req.prediction_horizon, req.prediction_failure_count,
        req.prediction_probability, req.CI)

    warnings = list(confidence.get("warnings", []))
    if exact_times is not None and len(np.unique(exact_times)) < len(exact_times):
        warnings.append(
            "Tied event times were retained as simultaneous failures. Because the "
            "continuous-time NHPP assigns zero probability to exact ties, confirm "
            "that time rounding is appropriate before relying on goodness-of-fit."
        )
    core_warning = _attribute(fit, "warning", "warnings")
    if isinstance(core_warning, str) and core_warning not in warnings:
        warnings.append(core_warning)
    elif isinstance(core_warning, (list, tuple)):
        warnings.extend(str(item) for item in core_warning if str(item) not in warnings)
    return {
        "model": "crow_amsaa",
        "data_mode": req.data_mode,
        "termination": termination,
        "estimator": selected_estimator,
        "parameter_sets": parameter_sets,
        "beta": float(fit.beta),
        "Lambda": selected_parameters["Lambda"],
        "log_Lambda": selected_parameters["log_Lambda"],
        "scale_representable": selected_parameters["scale_representable"],
        "growth_rate": selected_parameters["growth_rate"],
        "instantaneous_failure_intensity": selected_parameters[
            "instantaneous_failure_intensity_at_T"],
        "mtbf_instantaneous": selected_parameters["instantaneous_mtbf_at_T"],
        "mtbf_cumulative": selected_parameters["cumulative_mtbf_at_T"],
        "n_failures": n,
        "T": T,
        "interpretation": interpretation,
        "confidence": confidence,
        "goodness_of_fit": gof,
        "trend_test": trend_test,
        "diagnostics": {"warnings": warnings},
        "prediction": prediction,
        "scatter": {"t": scatter_t, "n": scatter_n},
        "model_curve": {"t": t_grid.tolist(), "n": model_n.tolist()},
        "intensity_curve": {
            "t": t_grid.tolist(),
            "instantaneous": intensity_curve.tolist(),
        },
        "mtbf_curve": {
            "t": t_grid.tolist(),
            "cumulative": mtbf_cumulative_curve.tolist(),
            "instantaneous": mtbf_instantaneous_curve.tolist(),
        },
        "expected_vs_observed": {
            "time": scatter_t,
            "observed_cumulative": observed_cumulative,
            "expected_cumulative": expected_at_observations,
        },
        "interval_context": {
            "interval_start": interval_starts,
            "interval_end": interval_ends,
            "observed_count": interval_counts,
            "expected_count": expected_counts,
            "observed_average_intensity": observed_average_intensity,
            "fitted_average_intensity": expected_average_intensity,
        },
        "grouped_final_interval": grouped_final_interval,
    }


@router.post("/optimal-replacement")
def optimal_replacement(req: OptimalReplacementRequest):
    """Optimal preventive-maintenance interval from a Weibull cost model."""
    try:
        res = optimal_replacement_time(
            cost_PM=req.cost_PM, cost_CM=req.cost_CM,
            weibull_alpha=req.weibull_alpha, weibull_beta=req.weibull_beta,
            q=req.q,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return res


@router.post("/rocof")
def rocof(req: ROCOFRequest):
    """Rate of occurrence of failures with the Laplace trend test."""
    try:
        res = ROCOF(
            times_between_failures=req.times_between_failures,
            failure_times=req.failure_times,
            test_end=req.test_end, CI=req.CI,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return res


@router.post("/mcf")
def mcf(req: MCFRequest):
    """Mean Cumulative Function (non-parametric, optionally parametric)."""
    try:
        records = ([record.model_dump() for record in req.records]
                   if req.records is not None else None)
        np_res = MCF_nonparametric(
            data=req.data,
            observation_ends=req.observation_ends,
            records=records,
            CI=req.CI,
            interval_method=req.interval_method,
            bootstrap_samples=req.bootstrap_samples,
            seed=req.seed,
        )
        out = {"nonparametric": np_res, "parametric": None}
        if req.parametric:
            par = MCF_parametric(
                data=req.data,
                observation_ends=req.observation_ends,
                records=records,
                CI=req.CI,
            )
            # Drop the nested non-parametric copy to keep the payload small.
            par.pop("np", None)
            out["parametric"] = par
        # This is deliberately descriptive. Parametric beta and its profile
        # interval are returned separately whenever the power-law fit is
        # requested; callers must not present this shape heuristic as a test.
        out["trend"] = _mcf_trend(np_res["time"], np_res["MCF"])
        out["status"] = {
            "nonparametric_estimate": "available",
            "nonparametric_interval": np_res["interval_status"],
            "parametric_fit": "available" if req.parametric else "not_requested",
            "parametric_interval": (
                out["parametric"]["interval_status"]
                if out["parametric"] is not None else "not_requested"),
        }
        out["assumptions"] = [
            "System histories are independent sampling units and censoring is independent of the recurrence process.",
            "Events use a consistent recurrence/repair definition across systems; tied endpoint events occur before censoring.",
            "The Nelson MCF estimates the population mean cumulative recurrence count without imposing a process shape.",
        ]
        if req.parametric:
            out["assumptions"].append(
                "The optional parametric curve assumes a shared power-law NHPP mean function and minimal repair within the modeled phase.")
        return out
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
