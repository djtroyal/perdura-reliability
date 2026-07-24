"""Software reliability-growth models for failure-event and interval-count data.

The models in this module are non-homogeneous Poisson processes (NHPPs).
They estimate failures observed while software is exercised; they do not turn
source-code coverage or static-analysis counts into a reliability probability.

The public entry point :func:`fit_software_reliability` deliberately returns
plain Python containers so the same rigorously validated implementation can be
used by the desktop GUI, REST API, notebooks, and verification tests.
"""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Callable, Iterable

import numpy as np
from scipy.optimize import minimize, brentq
from scipy.stats import chi2, kstest, norm


Array = np.ndarray


@dataclass(frozen=True)
class _Model:
    key: str
    label: str
    parameters: tuple[str, ...]
    finite_fault: bool
    mean: Callable[[Array, Array], Array]
    log_intensity: Callable[[Array, Array], Array]
    start: Callable[[int, float, Array], Array]
    source: str


def _positive_exp(values: Array) -> Array:
    with np.errstate(over="ignore", under="ignore", invalid="ignore"):
        return np.exp(np.clip(values, -700.0, 700.0))


def _hpp_mean(t: Array, p: Array) -> Array:
    return p[0] * t


def _hpp_log_intensity(t: Array, p: Array) -> Array:
    return np.full_like(t, math.log(p[0]), dtype=float)


def _go_mean(t: Array, p: Array) -> Array:
    a, b = p
    return a * (-np.expm1(-b * t))


def _go_log_intensity(t: Array, p: Array) -> Array:
    a, b = p
    return math.log(a) + math.log(b) - b * t


def _musa_mean(t: Array, p: Array) -> Array:
    lambda0, theta = p
    return np.log1p(lambda0 * theta * t) / theta


def _musa_log_intensity(t: Array, p: Array) -> Array:
    lambda0, theta = p
    return math.log(lambda0) - np.log1p(lambda0 * theta * t)


def _power_mean(t: Array, p: Array) -> Array:
    scale, beta = p
    out = np.zeros_like(t, dtype=float)
    positive = t > 0
    out[positive] = _positive_exp(
        math.log(scale) + beta * np.log(t[positive]))
    return out


def _power_log_intensity(t: Array, p: Array) -> Array:
    scale, beta = p
    return math.log(scale) + math.log(beta) + (beta - 1.0) * np.log(t)


def _delayed_mean(t: Array, p: Array) -> Array:
    a, b = p
    x = b * t
    # 1 - (1+x)e^-x, written to retain precision near x=0.
    return a * (-np.expm1(-x) - x * np.exp(-x))


def _delayed_log_intensity(t: Array, p: Array) -> Array:
    a, b = p
    return math.log(a) + 2.0 * math.log(b) + np.log(t) - b * t


def _hpp_start(n: int, T: float, _events: Array) -> Array:
    return np.log([max(n / T, 1e-12)])


def _go_start(n: int, T: float, _events: Array) -> Array:
    a = max(n * 1.5, n + 0.5)
    b = max(-math.log1p(-n / a) / T, 1e-12)
    return np.log([a, b])


def _musa_start(n: int, T: float, _events: Array) -> Array:
    return np.log([max(2.0 * n / T, 1e-12), max(1.0 / max(n, 1), 1e-6)])


def _power_start(n: int, T: float, events: Array) -> Array:
    if events.size:
        denom = float(np.sum(np.log(T / events)))
        beta = n / denom if denom > 1e-12 else 1.0
    else:
        beta = 1.0
    beta = float(np.clip(beta, 0.1, 10.0))
    scale = _positive_exp(np.asarray([math.log(max(n, 1)) - beta * math.log(T)]))[0]
    return np.log([max(float(scale), 1e-30), beta])


def _delayed_start(n: int, T: float, _events: Array) -> Array:
    b = 2.0 / T
    fraction = float(_delayed_mean(np.asarray([T]), np.asarray([1.0, b]))[0])
    return np.log([max(n / max(fraction, 1e-6), n + 0.5), b])


MODELS: dict[str, _Model] = {
    "hpp": _Model(
        "hpp", "Homogeneous Poisson process", ("failure_rate",), False,
        _hpp_mean, _hpp_log_intensity, _hpp_start,
        "Baseline constant-intensity Poisson process",
    ),
    "goel_okumoto": _Model(
        "goel_okumoto", "Goel–Okumoto exponential NHPP", ("total_faults", "detection_rate"), True,
        _go_mean, _go_log_intensity, _go_start,
        "Goel and Okumoto (1979); finite-fault exponential NHPP",
    ),
    "musa_okumoto": _Model(
        "musa_okumoto", "Musa–Okumoto logarithmic NHPP", ("initial_intensity", "decay"), False,
        _musa_mean, _musa_log_intensity, _musa_start,
        "Musa and Okumoto (1984); logarithmic Poisson execution-time model",
    ),
    "power_law": _Model(
        "power_law", "Power-law NHPP", ("scale", "shape"), False,
        _power_mean, _power_log_intensity, _power_start,
        "NHPP power-law process; software failure-event application",
    ),
    "delayed_s": _Model(
        "delayed_s", "Delayed S-shaped NHPP", ("total_faults", "detection_rate"), True,
        _delayed_mean, _delayed_log_intensity, _delayed_start,
        "Yamada delayed S-shaped finite-fault NHPP",
    ),
}

MODEL_ALIASES = {
    "go": "goel_okumoto", "goel-okumoto": "goel_okumoto",
    "musa-okumoto": "musa_okumoto", "logarithmic": "musa_okumoto",
    "weibull_nhpp": "power_law", "power-law": "power_law",
    "yamada": "delayed_s", "delayed-s": "delayed_s",
}


def _as_positive_1d(values: Iterable[float], name: str, *, allow_zero: bool = False) -> Array:
    result = np.asarray(list(values), dtype=float)
    if result.ndim != 1 or np.any(~np.isfinite(result)):
        raise ValueError(f"{name} must be a one-dimensional finite numeric sequence.")
    if np.any(result < 0 if allow_zero else result <= 0):
        relation = "non-negative" if allow_zero else "positive"
        raise ValueError(f"{name} values must be {relation}.")
    return result


def _validate_data(
    event_times: Iterable[float] | None,
    observation_end: float,
    interval_endpoints: Iterable[float] | None,
    interval_counts: Iterable[int] | None,
) -> tuple[str, Array, Array, Array, int]:
    T = float(observation_end)
    if not math.isfinite(T) or T <= 0:
        raise ValueError("observation_end must be finite and positive.")
    events = _as_positive_1d(
        [] if event_times is None else event_times, "event_times")
    endpoints = _as_positive_1d(
        [] if interval_endpoints is None else interval_endpoints,
        "interval_endpoints")
    raw_counts = np.asarray(
        list([] if interval_counts is None else interval_counts), dtype=float)
    if events.size and endpoints.size:
        raise ValueError("Provide event_times or interval counts, not both.")
    if events.size:
        if np.any(np.diff(events) < 0) or events[-1] > T:
            raise ValueError("event_times must be nondecreasing and no later than observation_end.")
        return "event_times", events, np.asarray([]), np.asarray([]), int(events.size)
    if not endpoints.size:
        raise ValueError("Provide at least one failure event or one interval-count row.")
    if raw_counts.ndim != 1 or raw_counts.size != endpoints.size:
        raise ValueError("interval_counts must contain one value per interval endpoint.")
    if (np.any(~np.isfinite(raw_counts)) or np.any(raw_counts < 0)
            or np.any(raw_counts != np.floor(raw_counts))):
        raise ValueError("interval_counts must be non-negative integers.")
    if np.any(np.diff(endpoints) <= 0):
        raise ValueError("interval_endpoints must be strictly increasing.")
    if not math.isclose(float(endpoints[-1]), T, rel_tol=1e-10, abs_tol=1e-12):
        raise ValueError("The final interval endpoint must equal observation_end.")
    counts = raw_counts.astype(int)
    if int(np.sum(counts)) < 1:
        raise ValueError("At least one software failure is required for model fitting.")
    return "interval_counts", events, endpoints, counts, int(np.sum(counts))


def _log_likelihood(model: _Model, log_params: Array, mode: str, events: Array,
                    endpoints: Array, counts: Array, T: float) -> float:
    params = _positive_exp(log_params)
    mean_T = float(model.mean(np.asarray([T]), params)[0])
    if not math.isfinite(mean_T) or mean_T <= 0:
        return -math.inf
    if mode == "event_times":
        log_rates = model.log_intensity(events, params)
        if np.any(~np.isfinite(log_rates)):
            return -math.inf
        return float(np.sum(log_rates) - mean_T)
    starts = np.concatenate(([0.0], endpoints[:-1]))
    increments = model.mean(endpoints, params) - model.mean(starts, params)
    if np.any(~np.isfinite(increments)) or np.any(increments <= 0):
        return -math.inf
    return float(np.sum(counts * np.log(increments) - increments
                        - np.asarray([math.lgamma(int(value) + 1) for value in counts])))


def _numerical_hessian(function: Callable[[Array], float], point: Array) -> Array:
    n = point.size
    h = np.maximum(1e-4, np.abs(point) * 1e-4)
    result = np.zeros((n, n), dtype=float)
    f0 = function(point)
    for i in range(n):
        ei = np.zeros(n); ei[i] = h[i]
        result[i, i] = (function(point + ei) - 2.0 * f0 + function(point - ei)) / h[i] ** 2
        for j in range(i):
            ej = np.zeros(n); ej[j] = h[j]
            value = (function(point + ei + ej) - function(point + ei - ej)
                     - function(point - ei + ej) + function(point - ei - ej)) / (4.0 * h[i] * h[j])
            result[i, j] = result[j, i] = value
    return result


def _fit_one(model: _Model, mode: str, events: Array, endpoints: Array,
             counts: Array, T: float, n_failures: int, CI: float) -> dict:
    representative = events
    if mode == "interval_counts":
        representative = np.repeat(endpoints, counts)
    base = model.start(n_failures, T, representative)
    starts = [base, base + math.log(0.5), base + math.log(2.0)]

    def objective(value: Array) -> float:
        ll = _log_likelihood(model, value, mode, events, endpoints, counts, T)
        return -ll if math.isfinite(ll) else 1e300

    attempts = [minimize(objective, start, method="L-BFGS-B",
                         bounds=[(-60.0, 60.0)] * len(model.parameters)) for start in starts]
    fitted = min(attempts, key=lambda result: float(result.fun))
    log_params = np.asarray(fitted.x, dtype=float)
    params = _positive_exp(log_params)
    loglik = -float(fitted.fun)
    k = len(params)
    aic = 2.0 * k - 2.0 * loglik
    aicc = aic + 2.0 * k * (k + 1.0) / (n_failures - k - 1.0) if n_failures > k + 1 else None
    bic = math.log(max(n_failures, 1)) * k - 2.0 * loglik
    warnings: list[str] = []
    eligible = bool(fitted.success and np.all(np.isfinite(params)) and n_failures >= k + 2)
    if n_failures < k + 2:
        warnings.append(f"At least {k + 2} failures are required for a defensible {k}-parameter comparison.")
    if not fitted.success:
        warnings.append(f"Optimizer did not converge: {fitted.message}")

    covariance = None
    condition = None
    parameter_rows = []
    try:
        hessian = _numerical_hessian(objective, log_params)
        eigenvalues = np.linalg.eigvalsh(hessian)
        condition = float(np.linalg.cond(hessian))
        if np.all(eigenvalues > 1e-9) and math.isfinite(condition):
            covariance = np.linalg.inv(hessian)
        else:
            warnings.append("The likelihood curvature is not positive definite; parameter intervals are unavailable.")
    except (ValueError, np.linalg.LinAlgError, FloatingPointError):
        warnings.append("The likelihood curvature could not be evaluated reliably.")
    if condition is not None and condition > 1e8:
        warnings.append("Parameters are weakly identified (information-matrix condition number exceeds 1e8).")

    z = float(norm.ppf(0.5 + CI / 2.0))
    for index, (name, estimate) in enumerate(zip(model.parameters, params)):
        if covariance is not None and covariance[index, index] >= 0:
            log_se = math.sqrt(float(covariance[index, index]))
            lower_log = float(log_params[index] - z * log_se)
            upper_log = float(log_params[index] + z * log_se)
            lower = math.exp(lower_log) if -745.0 <= lower_log <= 709.0 else None
            upper = math.exp(upper_log) if -745.0 <= upper_log <= 709.0 else None
            relative_se = math.sqrt(math.expm1(min(log_se ** 2, 700.0)))
        else:
            lower = upper = relative_se = None
        parameter_rows.append({
            "name": name, "estimate": float(estimate), "lower": lower,
            "upper": upper, "relative_standard_error": relative_se,
        })

    goodness = _goodness_of_fit(model, params, mode, events, endpoints, counts, T, k)
    return {
        "model": model.key, "label": model.label, "source": model.source,
        "finite_fault_model": model.finite_fault, "parameters": parameter_rows,
        "parameter_values": {name: float(value) for name, value in zip(model.parameters, params)},
        "log_likelihood": loglik, "AIC": aic, "AICc": aicc, "BIC": bic,
        "eligible": eligible, "converged": bool(fitted.success),
        "optimizer_message": str(fitted.message), "information_condition": condition,
        "warnings": warnings, "goodness_of_fit": goodness,
        "_params": params, "_log_params": log_params, "_covariance": covariance,
    }


def _goodness_of_fit(model: _Model, params: Array, mode: str, events: Array,
                     endpoints: Array, counts: Array, T: float, k: int) -> dict:
    if mode == "event_times":
        if events.size < 5:
            return {"available": False, "method": "conditional_time_rescaling_ks_diagnostic",
                    "reason": "At least five events are required for this diagnostic."}
        # Conditional on N(T)=n, transformed NHPP event locations
        # Lambda(t_i)/Lambda(T) are the order statistics of n Uniform(0, 1)
        # values. This retains the event-free tail to T; testing only observed
        # inter-arrivals would omit that terminal information and miscalibrate
        # the diagnostic under fixed observation.
        mean_T = float(model.mean(np.asarray([T]), params)[0])
        uniforms = model.mean(events, params) / mean_T
        statistic, p_value = kstest(uniforms, "uniform")
        return {
            "available": True, "method": "conditional_time_rescaling_ks_diagnostic",
            "statistic": float(statistic), "p_value": float(p_value),
            "calibration": "diagnostic_only_parameters_estimated",
            "interpretation": "Small p-values indicate lack of fit; the nominal p-value is diagnostic because parameters were estimated from the same conditionally transformed events.",
        }
    starts = np.concatenate(([0.0], endpoints[:-1]))
    expected = model.mean(endpoints, params) - model.mean(starts, params)
    degrees = int(len(counts) - k)
    if degrees < 1 or np.any(expected < 5.0):
        return {"available": False, "method": "pearson_interval_count_diagnostic",
                "reason": "Too few intervals or an expected interval count below 5 prevents a stable Pearson diagnostic."}
    statistic = float(np.sum((counts - expected) ** 2 / expected))
    return {
        "available": True, "method": "pearson_interval_count_diagnostic",
        "statistic": statistic, "degrees_of_freedom": degrees,
        "p_value": float(chi2.sf(statistic, degrees)),
        "calibration": "asymptotic_parameters_estimated",
    }


def _inverse_mean(model: _Model, value: float, params: Array, upper: float) -> float:
    if value <= 0:
        return 0.0
    if model.key == "hpp":
        return value / params[0]
    if model.key == "goel_okumoto":
        return -math.log1p(-min(value / params[0], 1.0 - 1e-14)) / params[1]
    if model.key == "musa_okumoto":
        return math.expm1(params[1] * value) / (params[0] * params[1])
    if model.key == "power_law":
        return (value / params[0]) ** (1.0 / params[1])
    return float(brentq(
        lambda time: float(model.mean(np.asarray([time]), params)[0]) - value,
        0.0, upper, xtol=1e-10, rtol=1e-10))


def _simulate_and_refit(model: _Model, fit: dict, mode: str, events: Array,
                        endpoints: Array, counts: Array, T: float, n_failures: int,
                        CI: float, samples: int, seed: int) -> Array:
    if samples <= 0:
        return np.empty((0, len(model.parameters)))
    rng = np.random.default_rng(seed)
    params = fit["_params"]
    output: list[Array] = []
    mean_T = float(model.mean(np.asarray([T]), params)[0])
    starts = np.concatenate(([0.0], endpoints[:-1])) if endpoints.size else np.asarray([])
    interval_means = model.mean(endpoints, params) - model.mean(starts, params) if endpoints.size else np.asarray([])
    for _ in range(samples):
        if mode == "event_times":
            count = int(rng.poisson(mean_T))
            if count < len(model.parameters) + 2:
                continue
            targets = np.sort(rng.uniform(0.0, mean_T, count))
            simulated_events = np.asarray([_inverse_mean(model, float(value), params, T) for value in targets])
            sim_endpoints, sim_counts = np.asarray([]), np.asarray([])
        else:
            sim_counts = rng.poisson(interval_means).astype(int)
            count = int(np.sum(sim_counts))
            if count < len(model.parameters) + 2:
                continue
            simulated_events, sim_endpoints = np.asarray([]), endpoints
        candidate = _fit_one(model, mode, simulated_events, sim_endpoints, sim_counts,
                             T, count, CI)
        if candidate["eligible"]:
            output.append(candidate["_params"])
    return np.asarray(output, dtype=float) if output else np.empty((0, len(model.parameters)))


def _model_projection(model: _Model, fit: dict, T: float, horizon: float,
                      mission_duration: float, target_intensity: float | None,
                      CI: float, bootstrap_params: Array, seed: int) -> dict:
    params = fit["_params"]
    end = T + horizon
    mean_T = float(model.mean(np.asarray([T]), params)[0])
    mean_end = float(model.mean(np.asarray([end]), params)[0])
    current_log_rate = float(model.log_intensity(np.asarray([T]), params)[0])
    current_rate = math.exp(current_log_rate) if current_log_rate < 709 else math.inf
    mission_end = T + mission_duration
    future_mission_failures = float(model.mean(np.asarray([mission_end]), params)[0] - mean_T)
    mission_reliability = math.exp(-future_mission_failures)
    expected_future = max(mean_end - mean_T, 0.0)

    grid_end = max(end, mission_end)
    grid_start = max(grid_end * 1e-6, np.nextafter(0.0, 1.0))
    grid = np.linspace(grid_start, grid_end, 180)
    mean_curve = model.mean(grid, params)
    log_intensity = model.log_intensity(grid, params)
    intensity_curve = np.exp(np.clip(log_intensity, -745.0, 709.0))

    draws = bootstrap_params
    uncertainty_method = "parametric_bootstrap"
    if draws.size == 0 and fit["_covariance"] is not None:
        rng = np.random.default_rng(seed)
        raw = rng.multivariate_normal(fit["_log_params"], fit["_covariance"], size=2000)
        raw = raw[np.all(np.isfinite(raw), axis=1)]
        draws = _positive_exp(raw)
        uncertainty_method = "asymptotic_log_parameter_monte_carlo"
    alpha = (1.0 - CI) / 2.0
    intervals: dict[str, dict] = {}
    curve_lower = curve_upper = None
    probability_meeting_target = None
    if draws.size:
        current_values = np.asarray([
            math.exp(min(float(model.log_intensity(np.asarray([T]), draw)[0]), 709.0))
            for draw in draws])
        reliability_values = np.asarray([
            math.exp(-max(float(model.mean(np.asarray([mission_end]), draw)[0]
                                - model.mean(np.asarray([T]), draw)[0]), 0.0))
            for draw in draws])
        future_values = np.asarray([
            max(float(model.mean(np.asarray([end]), draw)[0]
                      - model.mean(np.asarray([T]), draw)[0]), 0.0)
            for draw in draws])
        for name, values in (("current_intensity", current_values),
                             ("mission_reliability", reliability_values),
                             ("expected_future_failures", future_values)):
            finite = values[np.isfinite(values)]
            if finite.size:
                intervals[name] = {"lower": float(np.quantile(finite, alpha)),
                                   "upper": float(np.quantile(finite, 1.0 - alpha))}
        if target_intensity is not None:
            probability_meeting_target = float(np.mean(current_values <= target_intensity))
        if len(draws) <= 500:
            curves = np.asarray([model.mean(grid, draw) for draw in draws])
        else:
            sample = draws[np.linspace(0, len(draws) - 1, 500).astype(int)]
            curves = np.asarray([model.mean(grid, draw) for draw in sample])
        curve_lower = np.quantile(curves, alpha, axis=0).tolist()
        curve_upper = np.quantile(curves, 1.0 - alpha, axis=0).tolist()

    additional_test = None
    target_status = None
    if target_intensity is not None:
        if target_intensity <= 0:
            target_status = "Target intensity must be positive."
        elif current_rate <= target_intensity:
            additional_test, target_status = 0.0, "Point estimate already meets the target."
        else:
            def difference(time: float) -> float:
                return float(model.log_intensity(np.asarray([time]), params)[0]) - math.log(target_intensity)
            upper = max(T * 2.0, T + 1.0)
            try:
                while difference(upper) > 0 and upper < T * 1e9:
                    upper *= 2.0
                if difference(upper) <= 0:
                    additional_test = float(brentq(difference, T, upper) - T)
                    target_status = "Point-estimate exposure required; model-form uncertainty is not included."
                else:
                    target_status = "The fitted model does not reach the target within the searchable exposure range."
            except (ValueError, OverflowError):
                target_status = "The fitted intensity is not decreasing toward the requested target."

    remaining = None
    if model.finite_fault:
        total = float(params[0])
        remaining = max(total - mean_T, 0.0)
    return {
        "current_intensity": current_rate,
        "expected_failures_observed_to_T": mean_T,
        "expected_future_failures": expected_future,
        "probability_zero_failures_over_horizon": math.exp(-expected_future),
        "mission_duration": mission_duration,
        "mission_reliability": mission_reliability,
        "remaining_faults": remaining,
        "remaining_faults_available": model.finite_fault,
        "additional_test_exposure_to_target": additional_test,
        "target_status": target_status,
        "probability_current_intensity_meets_target": probability_meeting_target,
        "uncertainty": {"level": CI, "method": uncertainty_method if draws.size else "unavailable",
                        "successful_draws": int(len(draws)), "intervals": intervals},
        "curve": {"time": grid.tolist(), "cumulative_failures": mean_curve.tolist(),
                  "intensity": intensity_curve.tolist(), "cumulative_lower": curve_lower,
                  "cumulative_upper": curve_upper},
    }


def fit_software_reliability(
    *,
    event_times: Iterable[float] | None = None,
    observation_end: float,
    interval_endpoints: Iterable[float] | None = None,
    interval_counts: Iterable[int] | None = None,
    models: Iterable[str] | None = None,
    CI: float = 0.95,
    prediction_horizon: float | None = None,
    mission_duration: float | None = None,
    target_failure_intensity: float | None = None,
    bootstrap_samples: int = 0,
    seed: int = 1729,
    operational_profile: Iterable[dict] | None = None,
) -> dict:
    """Fit and compare software NHPP reliability-growth models.

    ``event_times`` are cumulative execution/exposure times at failure. For
    grouped data, ``interval_counts[i]`` is the number of failures in the
    interval ending at ``interval_endpoints[i]``. Exposure must be expressed
    in one consistent unit; calendar time is not silently substituted for CPU,
    transaction, or test-execution exposure.
    """
    CI = float(CI)
    if not 0 < CI < 1:
        raise ValueError("CI must be strictly between 0 and 1.")
    if not 0 <= int(bootstrap_samples) <= 500:
        raise ValueError("bootstrap_samples must be between 0 and 500.")
    T = float(observation_end)
    horizon = float(prediction_horizon if prediction_horizon is not None else T * 0.25)
    mission = float(mission_duration if mission_duration is not None else horizon)
    if not math.isfinite(horizon) or horizon <= 0 or not math.isfinite(mission) or mission <= 0:
        raise ValueError("prediction_horizon and mission_duration must be positive and finite.")
    if target_failure_intensity is not None:
        target_failure_intensity = float(target_failure_intensity)
        if not math.isfinite(target_failure_intensity) or target_failure_intensity <= 0:
            raise ValueError("target_failure_intensity must be positive and finite.")
    mode, events, endpoints, counts, n_failures = _validate_data(
        event_times, T, interval_endpoints, interval_counts)
    profile_result = _operational_profile_summary(
        operational_profile, mission, CI) if operational_profile else None
    requested = list(models) if models is not None else list(MODELS)
    keys: list[str] = []
    for value in requested:
        key = MODEL_ALIASES.get(str(value).lower(), str(value).lower())
        if key not in MODELS:
            raise ValueError(f"Unknown software reliability model '{value}'.")
        if key not in keys:
            keys.append(key)
    if not keys:
        raise ValueError("Select at least one software reliability model.")

    fitted: list[dict] = []
    for index, key in enumerate(keys):
        model = MODELS[key]
        result = _fit_one(model, mode, events, endpoints, counts, T, n_failures, CI)
        bootstrap = _simulate_and_refit(
            model, result, mode, events, endpoints, counts, T, n_failures, CI,
            int(bootstrap_samples), int(seed) + 1009 * index,
        ) if result["eligible"] else np.empty((0, len(model.parameters)))
        result["projection"] = _model_projection(
            model, result, T, horizon, mission, target_failure_intensity,
            CI, bootstrap, int(seed) + 7919 * index,
        )
        result["bootstrap"] = {
            "requested": int(bootstrap_samples), "successful": int(len(bootstrap)),
            "method": "parametric_nhpp_refit" if bootstrap_samples else "not_requested",
        }
        for private in ("_params", "_log_params", "_covariance"):
            result.pop(private, None)
        fitted.append(result)

    comparable = [item for item in fitted if item["eligible"]]
    criterion = "AICc" if comparable and all(item["AICc"] is not None for item in comparable) else "AIC"
    if comparable:
        minimum = min(float(item[criterion]) for item in comparable)
        raw = np.asarray([math.exp(-0.5 * (float(item[criterion]) - minimum)) for item in comparable])
        raw /= np.sum(raw)
        weights = {item["model"]: float(weight) for item, weight in zip(comparable, raw)}
    else:
        weights = {}
    for item in fitted:
        item["comparison_criterion"] = criterion
        item["delta"] = (float(item[criterion]) - min(float(row[criterion]) for row in comparable)
                         if item in comparable else None)
        item["weight"] = weights.get(item["model"])
    fitted.sort(key=lambda item: (not item["eligible"], item[criterion] if item[criterion] is not None else math.inf))

    warnings = [
        "Interpret results for the selected exposure measure and observed test or operating profile.",
        "Model comparison ranks the fitted candidates; release readiness also uses verification evidence and operating context.",
        "Coverage and static-analysis metrics describe assurance activity; reliability projections use the failure and exposure models.",
    ]
    if n_failures < 10:
        warnings.append("Fewer than 10 failures provide weak discrimination among two-parameter growth models.")
    if mode == "event_times" and np.any(np.diff(events) == 0):
        warnings.append(
            "Tied event exposures were treated as exact continuous event times. "
            "Use grouped interval counts when ties reflect measurement resolution."
        )
    return {
        "analysis": "software_reliability_growth",
        "data_mode": mode,
        "exposure_basis": "user_declared_consistent_exposure_unit",
        "observation_end": T,
        "n_failures": n_failures,
        "n_intervals": int(len(endpoints)) if mode == "interval_counts" else None,
        "confidence_level": CI,
        "comparison_criterion": criterion,
        "best_model": fitted[0]["model"] if fitted and fitted[0]["eligible"] else None,
        "models": fitted,
        "warnings": warnings,
        "operational_profile": profile_result,
        "standards_context": {
            "status": "standards_informed_not_certified_conformance",
            "references": [
                "MIL-HDBK-338B §9 (software reliability)",
                "IEEE 1633-2016 (full-text verification pending)",
                "NIST/SEMATECH e-Handbook, reliability growth and NHPP guidance",
            ],
        },
    }


def _operational_profile_summary(rows: Iterable[dict], mission: float, CI: float) -> dict:
    """Independent stratified-Poisson context for an operational profile.

    This deliberately remains separate from the fitted growth curve. Combining
    profile-specific constant rates with an NHPP trend requires a joint model
    and cannot be justified by multiplying the aggregate intensity by usage
    percentages.
    """
    cleaned: list[dict] = []
    for index, raw in enumerate(rows):
        name = str(raw.get("name", "")).strip() or f"Operation {index + 1}"
        exposure = float(raw.get("observed_exposure", 0))
        failures_value = float(raw.get("failures", 0))
        share = float(raw.get("planned_share", 0))
        if (not math.isfinite(exposure) or exposure <= 0
                or not math.isfinite(failures_value) or failures_value < 0
                or failures_value != math.floor(failures_value)
                or not math.isfinite(share) or share < 0):
            raise ValueError(
                "Each operational-profile row requires positive observed_exposure, "
                "a non-negative integer failure count, and a non-negative planned_share."
            )
        cleaned.append({"name": name, "observed_exposure": exposure,
                        "failures": int(failures_value), "planned_share": share})
    if not cleaned:
        return None
    share_total = sum(row["planned_share"] for row in cleaned)
    if share_total <= 0:
        raise ValueError("Operational-profile planned shares must sum to a positive value.")
    tail = (1.0 - CI) / 2.0
    expected = 0.0
    for row in cleaned:
        row["planned_share"] /= share_total
        failures = row["failures"]
        exposure = row["observed_exposure"]
        rate = failures / exposure
        lower = 0.0 if failures == 0 else float(
            0.5 * chi2.ppf(tail, 2 * failures) / exposure)
        upper = float(0.5 * chi2.ppf(1.0 - tail, 2 * (failures + 1)) / exposure)
        contribution = mission * row["planned_share"] * rate
        row.update({
            "failure_rate": rate,
            "failure_rate_lower": lower,
            "failure_rate_upper": upper,
            "expected_mission_failures": contribution,
        })
        expected += contribution
    return {
        "method": "profile_stratified_constant_rate_poisson_context",
        "joint_with_growth_model": False,
        "mission_exposure": mission,
        "expected_mission_failures": expected,
        "mission_reliability": math.exp(-expected),
        "rows": cleaned,
        "warning": (
            "This constant-rate profile baseline is reported separately from the "
            "aggregate NHPP growth curve; combining them requires a joint stratified model."
        ),
    }


__all__ = ["MODELS", "fit_software_reliability"]
