"""Calibrated uncertainty engines for fitted reliability models.

The fast confidence intervals attached by the fitters use an observed-Fisher
Wald/delta approximation.  This module provides slower, opt-in alternatives:

* likelihood-ratio profile intervals for scalar reliability/life targets;
* refitted parametric-bootstrap percentile intervals;
* refitted bootstrap intervals for Weibull mixture and competing-risk models.

Every routine returns method and convergence diagnostics with the interval so
callers cannot accidentally present an incomplete calculation as calibrated.
"""

from __future__ import annotations

import math
import warnings
from collections.abc import Mapping
from dataclasses import dataclass

import numpy as np
from scipy import stats as ss
from scipy.optimize import brentq, minimize
from scipy.special import expit, logit

from reliability.Utils import negative_log_likelihood


class UncertaintyEstimationError(ValueError):
    """Raised when a calibrated interval cannot be estimated reliably."""


@dataclass(frozen=True)
class _CensoringPlan:
    """Validated bootstrap censoring plan (internal, immutable)."""

    model: str
    calibration_status: str
    assumption: str
    schedule: np.ndarray | None = None
    distribution: str | None = None
    parameters: dict | None = None
    uncertainty_warnings: tuple[str, ...] = ()

    def diagnostics(self):
        result = {
            "type": self.model,
            "calibration_status": self.calibration_status,
            "assumption": self.assumption,
        }
        if self.schedule is not None and self.model == "fixed_administrative":
            result["time"] = float(self.schedule[0])
        elif self.schedule is not None and self.model == "observed_schedule":
            result["schedule_length"] = int(len(self.schedule))
        if self.distribution is not None:
            result["distribution"] = self.distribution
            result["parameters"] = dict(self.parameters or {})
        return result


def _positive_finite(value, label):
    try:
        numeric = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be a positive finite number.") from exc
    if not np.isfinite(numeric) or numeric <= 0:
        raise ValueError(f"{label} must be a positive finite number.")
    return numeric


def _bootstrap_count(value):
    if isinstance(value, (bool, np.bool_)):
        raise ValueError("n_bootstrap must be an integer from 20 to 2000.")
    try:
        count = int(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(
            "n_bootstrap must be an integer from 20 to 2000."
        ) from exc
    if count != value or not 20 <= count <= 2000:
        raise ValueError("n_bootstrap must be an integer from 20 to 2000.")
    return count


def _prepare_censoring_plan(failures, right_censored, censoring_design):
    """Validate and normalize the bootstrap censoring-design contract."""
    failures = np.asarray(failures, dtype=float)
    right_censored = np.asarray(
        [] if right_censored is None else right_censored, dtype=float,
    )
    n_total = len(failures) + len(right_censored)

    if censoring_design is None:
        if len(right_censored) == 0:
            return _CensoringPlan(
                model="complete_sample",
                calibration_status="design_reproduced",
                assumption="The observed sample is treated as uncensored.",
            )
        return _CensoringPlan(
            model="empirical_censor_time_resampling",
            calibration_status="approximate_unverified",
            assumption=(
                "No censoring design was supplied; observed censor times are "
                "resampled as an empirical approximation."
            ),
            schedule=right_censored.copy(),
            uncertainty_warnings=(
                "censoring_design_not_supplied",
                "empirical_censor_time_resampling_is_approximate",
            ),
        )

    if not isinstance(censoring_design, Mapping):
        raise TypeError("censoring_design must be a mapping or None.")
    design_type = str(censoring_design.get("type", "")).strip().lower()
    supported = {
        "fixed_administrative", "observed_schedule", "parametric_independent",
    }
    if design_type not in supported:
        choices = ", ".join(sorted(supported))
        raise ValueError(
            f"censoring_design.type must be one of: {choices}."
        )

    if design_type == "fixed_administrative":
        cutoff = _positive_finite(censoring_design.get("time"), "time")
        tolerance = max(1e-10, 1e-9 * cutoff)
        if np.any(failures > cutoff + tolerance):
            raise ValueError(
                "fixed_administrative time cannot precede an observed failure."
            )
        if (len(right_censored) > 0
                and not np.allclose(
                    right_censored, cutoff, rtol=1e-9, atol=tolerance,
                )):
            raise ValueError(
                "fixed_administrative requires every observed censor time to "
                "equal the declared cutoff."
            )
        return _CensoringPlan(
            model=design_type,
            calibration_status="design_reproduced",
            assumption=(
                "Every bootstrap unit is administratively censored at the "
                "declared fixed time."
            ),
            schedule=np.asarray([cutoff], dtype=float),
        )

    if design_type == "observed_schedule":
        try:
            schedule = np.asarray(censoring_design.get("times"), dtype=float)
        except (TypeError, ValueError) as exc:
            raise ValueError("times must be a one-dimensional finite schedule.") from exc
        if schedule.ndim != 1 or len(schedule) != n_total:
            raise ValueError(
                "observed_schedule times must contain one planned censor time "
                f"for each of the {n_total} observed units."
            )
        if np.any(~np.isfinite(schedule)) or np.any(schedule <= 0):
            raise ValueError("observed_schedule times must all be positive and finite.")
        return _CensoringPlan(
            model=design_type,
            calibration_status="design_reproduced",
            assumption=(
                "The declared per-unit censoring schedule is held fixed across "
                "bootstrap refits."
            ),
            schedule=schedule.copy(),
        )

    distribution = str(censoring_design.get("distribution", "")).strip().lower()
    raw_parameters = censoring_design.get("parameters", {})
    if not isinstance(raw_parameters, Mapping):
        raise TypeError("parametric censoring parameters must be a mapping.")
    parameters = dict(raw_parameters)
    if distribution == "exponential":
        normalized = {"scale": _positive_finite(parameters.get("scale"), "scale")}
    elif distribution == "weibull":
        normalized = {
            "shape": _positive_finite(parameters.get("shape"), "shape"),
            "scale": _positive_finite(parameters.get("scale"), "scale"),
        }
    elif distribution == "lognormal":
        try:
            mu = float(parameters.get("mu"))
        except (TypeError, ValueError) as exc:
            raise ValueError("mu must be finite.") from exc
        if not np.isfinite(mu):
            raise ValueError("mu must be finite.")
        normalized = {
            "mu": mu,
            "sigma": _positive_finite(parameters.get("sigma"), "sigma"),
        }
    elif distribution == "uniform":
        try:
            low = float(parameters.get("low"))
            high = float(parameters.get("high"))
        except (TypeError, ValueError) as exc:
            raise ValueError("uniform low and high must be finite numbers.") from exc
        if not np.isfinite(low) or not np.isfinite(high) or low < 0 or high <= low:
            raise ValueError("uniform requires 0 <= low < high with finite bounds.")
        normalized = {"low": low, "high": high}
    else:
        raise ValueError(
            "parametric_independent distribution must be exponential, weibull, "
            "lognormal, or uniform."
        )
    return _CensoringPlan(
        model=design_type,
        calibration_status="model_based",
        assumption=(
            "Censor times are independently generated from the declared "
            "parametric distribution."
        ),
        distribution=distribution,
        parameters=normalized,
    )


def _sample_censor_times(plan, n_total, rng):
    if plan.model == "complete_sample":
        return None
    if plan.model == "fixed_administrative":
        return np.full(n_total, plan.schedule[0], dtype=float)
    if plan.model == "observed_schedule":
        return plan.schedule.copy()
    if plan.model == "empirical_censor_time_resampling":
        return rng.choice(plan.schedule, size=n_total, replace=True)

    parameters = plan.parameters
    if plan.distribution == "exponential":
        return rng.exponential(parameters["scale"], size=n_total)
    if plan.distribution == "weibull":
        return parameters["scale"] * rng.weibull(
            parameters["shape"], size=n_total,
        )
    if plan.distribution == "lognormal":
        return rng.lognormal(
            mean=parameters["mu"], sigma=parameters["sigma"], size=n_total,
        )
    return rng.uniform(parameters["low"], parameters["high"], size=n_total)


def _target_value(dist, target, value=None):
    target = str(target).lower()
    if target in ("reliability", "sf"):
        if value is None or not np.isfinite(value):
            raise ValueError("A finite mission time is required for reliability.")
        return float(np.asarray(dist._sf(np.asarray([value], dtype=float)))[0])
    if target in ("quantile", "life"):
        if value is None or not 0 < value < 1:
            raise ValueError("A quantile probability strictly between 0 and 1 is required.")
        return float(dist.quantile(value))
    if target == "median":
        return float(dist.median)
    if target == "mean":
        return float(dist.mean)
    raise ValueError("target must be reliability, quantile, median, or mean.")


def _profile_parameter_bounds(fit):
    params = np.asarray(fit._ci_params, dtype=float)
    names = list(getattr(fit, "_ci_param_names", [""] * len(params)))
    positive = list(fit._ci_positive_mask)
    failures = np.asarray(fit._ci_failures, dtype=float)
    bounds = []
    for index, (parameter, is_positive) in enumerate(zip(params, positive)):
        name = names[index].lower() if index < len(names) else ""
        if name == "gamma":
            bounds.append((0.0, float(np.min(failures)) * (1.0 - 1e-9)))
        elif is_positive:
            bounds.append((max(np.finfo(float).tiny, abs(parameter) * 1e-10), None))
        else:
            bounds.append((None, None))
    return bounds


def _detected_boundary_parameters(fit, parameter_bounds=None):
    """Return fitted parameters in numerical contact with a hard bound."""
    params = np.asarray(fit._ci_params, dtype=float)
    bounds = parameter_bounds or _profile_parameter_bounds(fit)
    names = list(getattr(fit, "_ci_param_names", []))
    boundary_parameters = []
    for index, ((lo, hi), parameter) in enumerate(zip(bounds, params)):
        scale = max(abs(float(parameter)), 1.0)
        if ((lo is not None
             and math.isclose(parameter, lo, abs_tol=1e-8 * scale))
                or (hi is not None
                    and math.isclose(parameter, hi, abs_tol=1e-8 * scale))):
            boundary_parameters.append(
                names[index] if index < len(names) else f"parameter_{index}"
            )
    return boundary_parameters


def _target_gradient(fit, target, value):
    params = np.asarray(fit._ci_params, dtype=float)
    bounds = _profile_parameter_bounds(fit)
    gradient = np.full(len(params), np.nan)

    def evaluate(theta):
        try:
            return _target_value(fit._ci_dist_class._from_params(theta), target, value)
        except (ValueError, RuntimeError, FloatingPointError):
            return np.nan

    center = evaluate(params)
    for index, (lo, hi) in enumerate(bounds):
        step = 1e-5 * max(abs(params[index]), 1.0)
        can_minus = lo is None or params[index] - step >= lo
        can_plus = hi is None or params[index] + step <= hi
        minus = plus = np.nan
        if can_minus:
            theta = params.copy()
            theta[index] -= step
            minus = evaluate(theta)
        if can_plus:
            theta = params.copy()
            theta[index] += step
            plus = evaluate(theta)
        if np.isfinite(minus) and np.isfinite(plus):
            gradient[index] = (plus - minus) / (2 * step)
        elif np.isfinite(plus) and np.isfinite(center):
            gradient[index] = (plus - center) / step
        elif np.isfinite(minus) and np.isfinite(center):
            gradient[index] = (center - minus) / step
    return gradient


def profile_likelihood_interval(fit, target="reliability", value=None, CI=None):
    """Likelihood-ratio profile interval for a scalar fitted-model target.

    ``target='reliability'`` interprets ``value`` as mission time.
    ``target='quantile'`` interprets it as cumulative probability. ``median``
    and ``mean`` need no value.
    """
    if not getattr(fit, "fit_eligible", False):
        raise UncertaintyEstimationError(
            "Profile likelihood requires an eligible converged fit."
        )
    if not hasattr(fit, "_ci_dist_class"):
        raise UncertaintyEstimationError(
            "Profile likelihood is unavailable for this fitter."
        )

    CI = float(CI if CI is not None else fit.CI)
    if not 0 < CI < 1:
        raise ValueError("CI must be strictly between 0 and 1.")

    target = str(target).lower()
    params = np.asarray(fit._ci_params, dtype=float)
    dist_class = fit._ci_dist_class
    failures = np.asarray(fit._ci_failures, dtype=float)
    right_censored = fit._ci_right_censored
    estimate = _target_value(dist_class._from_params(params), target, value)
    if not np.isfinite(estimate):
        raise UncertaintyEstimationError("The fitted target is not finite.")

    nll_minimum = negative_log_likelihood(
        params, dist_class, failures, right_censored
    )
    if not np.isfinite(nll_minimum):
        raise UncertaintyEstimationError("The fitted likelihood is not finite.")

    parameter_bounds = _profile_parameter_bounds(fit)
    parameter_scale = np.asarray([
        max(abs(parameter), 1.0) if parameter != 0 else 1.0
        for parameter in params
    ])
    scaled_start = params / parameter_scale
    scaled_bounds = [
        ((lo / scale) if lo is not None else None,
         (hi / scale) if hi is not None else None)
        for (lo, hi), scale in zip(parameter_bounds, parameter_scale)
    ]

    def objective(scaled):
        result = negative_log_likelihood(
            np.asarray(scaled) * parameter_scale,
            dist_class,
            failures,
            right_censored,
        )
        return float(result) if np.isfinite(result) else 1e100

    # Cache only *successful* constrained optimizations.  A failed profile
    # evaluation must never be converted into a large LR value: doing so makes
    # an optimizer failure look like a likelihood-ratio crossing and can create
    # a spurious, apparently complete endpoint.
    profile_cache = {
        float(estimate): {
            "nll": float(nll_minimum),
            "constraint_residual": 0.0,
        }
    }
    optimizer_failures = []
    profile_attempt_count = 0

    def profile_nll(target_value):
        nonlocal profile_attempt_count
        target_value = float(target_value)
        for cached_target, cached in profile_cache.items():
            if math.isclose(target_value, cached_target, rel_tol=1e-12, abs_tol=1e-14):
                return cached

        constraint_scale = max(abs(target_value), 0.05)

        def constraint(scaled):
            try:
                theta = np.asarray(scaled) * parameter_scale
                candidate = _target_value(
                    dist_class._from_params(theta), target, value
                )
                return (candidate - target_value) / constraint_scale
            except (ValueError, RuntimeError, FloatingPointError):
                return 1e6

        starts = [scaled_start]
        for multiplier in (0.9, 1.1):
            starts.append(scaled_start * multiplier)

        best = None
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            for start in starts:
                profile_attempt_count += 1
                result = minimize(
                    objective,
                    start,
                    method="SLSQP",
                    bounds=scaled_bounds,
                    constraints={"type": "eq", "fun": constraint},
                    options={"maxiter": 1000, "ftol": 1e-10},
                )
                residual = abs(float(constraint(result.x)))
                if (result.success and np.isfinite(result.fun)
                        and result.fun < 1e99 and residual <= 1e-5
                        and (best is None or result.fun < best.fun)):
                    best = result

        if best is None:
            optimizer_failures.append(target_value)
            return None
        residual = abs(float(constraint(best.x)))
        evaluated = {
            "nll": float(best.fun),
            "constraint_residual": residual,
        }
        profile_cache[target_value] = evaluated
        return evaluated

    cutoff = float(ss.chi2.ppf(CI, df=1))

    if target in ("reliability", "sf"):
        transform = lambda x: float(logit(np.clip(x, 1e-12, 1 - 1e-12)))
        inverse = lambda z: float(expit(z))
        maximum_span = 24.0
    elif estimate > 0:
        transform = lambda x: float(np.log(x))
        inverse = lambda z: float(np.exp(np.clip(z, -700, 700)))
        maximum_span = 20.0
    else:
        transform = lambda x: float(x)
        inverse = lambda z: float(z)
        maximum_span = max(abs(estimate) * 20.0, 100.0)

    transformed_estimate = transform(estimate)
    initial_step = 0.25
    covariance = getattr(fit, "covariance_matrix", None)
    if covariance is not None:
        gradient = _target_gradient(fit, target, value)
        if np.all(np.isfinite(gradient)):
            variance = float(gradient @ covariance @ gradient)
            if np.isfinite(variance) and variance > 0:
                target_se = math.sqrt(variance)
                if target in ("reliability", "sf"):
                    transformed_se = target_se / max(estimate * (1 - estimate), 1e-9)
                elif estimate > 0:
                    transformed_se = target_se / estimate
                else:
                    transformed_se = target_se
                if np.isfinite(transformed_se) and transformed_se > 0:
                    initial_step = float(np.clip(0.5 * transformed_se, 0.1, 1.0))

    def lr_evaluation(transformed_target):
        candidate_target = inverse(float(transformed_target))
        profiled = profile_nll(candidate_target)
        if profiled is None or not np.isfinite(profiled["nll"]):
            return None
        return {
            "value": 2.0 * (profiled["nll"] - nll_minimum) - cutoff,
            "target": candidate_target,
            "constraint_residual": profiled["constraint_residual"],
        }

    lr_residual_tolerance = max(1e-3, 1e-4 * cutoff)

    def verified_root(lo, hi):
        """Solve a finite successful LR bracket and verify the endpoint."""
        lo_eval = lr_evaluation(lo)
        hi_eval = lr_evaluation(hi)
        if (lo_eval is None or hi_eval is None
                or lo_eval["value"] * hi_eval["value"] > 0):
            return None

        class _ProfileEvaluationFailure(RuntimeError):
            pass

        def finite_lr(z):
            evaluated = lr_evaluation(z)
            if evaluated is None:
                raise _ProfileEvaluationFailure
            return evaluated["value"]

        try:
            root = brentq(
                finite_lr, lo, hi, xtol=1e-7, rtol=1e-8, maxiter=100,
            )
        except (ValueError, RuntimeError):
            return None
        verified = lr_evaluation(root)
        if (verified is None
                or abs(verified["value"]) > lr_residual_tolerance
                or verified["constraint_residual"] > 1e-5):
            return None
        return {
            "target": verified["target"],
            "lr_residual": float(verified["value"]),
            "constraint_residual": float(verified["constraint_residual"]),
        }

    def endpoint(direction):
        previous = transformed_estimate
        step = initial_step
        for _ in range(24):
            candidate = transformed_estimate + direction * step
            if abs(candidate - transformed_estimate) > maximum_span:
                break
            candidate_evaluation = lr_evaluation(candidate)
            if candidate_evaluation is None:
                # Search back toward the last successful point.  If no verified
                # crossing exists before the feasibility failure, the endpoint
                # is incomplete rather than guessed at the failure boundary.
                failed_point = candidate
                for _ in range(8):
                    probe = 0.5 * (previous + failed_point)
                    probe_evaluation = lr_evaluation(probe)
                    if probe_evaluation is None:
                        failed_point = probe
                        continue
                    if probe_evaluation["value"] >= 0:
                        lo, hi = sorted((previous, probe))
                        return verified_root(lo, hi)
                    previous = probe
                return None
            if candidate_evaluation["value"] >= 0:
                lo, hi = sorted((previous, candidate))
                return verified_root(lo, hi)
            previous = candidate
            step *= 1.6
        return None

    lower_endpoint = endpoint(-1)
    upper_endpoint = endpoint(1)
    lower = lower_endpoint["target"] if lower_endpoint is not None else None
    upper = upper_endpoint["target"] if upper_endpoint is not None else None
    complete = lower_endpoint is not None and upper_endpoint is not None
    boundary_parameters = _detected_boundary_parameters(
        fit, parameter_bounds=parameter_bounds,
    )
    profile_warnings = []
    if boundary_parameters:
        profile_warnings.append("chi_square_profile_cutoff_not_boundary_calibrated")
    return {
        "method": "profile_likelihood",
        "target": target,
        "target_value": value,
        "estimate": estimate,
        "lower": lower,
        "upper": upper,
        "CI": CI,
        "complete": complete,
        "likelihood_ratio_cutoff": cutoff,
        "calibration_status": (
            "nonregular_boundary_unverified" if boundary_parameters
            else "asymptotic_chi_square"
        ),
        "inferential_calibration_status": (
            "nonregular_boundary_unverified" if boundary_parameters
            else "asymptotic_chi_square"
        ),
        "censoring_design_status": "not_applicable",
        "boundary_parameters": boundary_parameters,
        "uncertainty_warnings": profile_warnings,
        "profile_evaluations": len(profile_cache),
        "profile_optimizer_attempts": profile_attempt_count,
        "optimizer_failure_count": len(optimizer_failures),
        "optimizer_failed_targets": optimizer_failures[:10],
        "endpoint_verification": {
            "lr_residual_tolerance": lr_residual_tolerance,
            "constraint_residual_tolerance": 1e-5,
            "lower": lower_endpoint,
            "upper": upper_endpoint,
        },
    }


def _bootstrap_sample(fit, rng, censoring_plan):
    failures = np.asarray(fit._ci_failures, dtype=float)
    rc = (np.asarray(fit._ci_right_censored, dtype=float)
          if fit._ci_right_censored is not None else np.array([], dtype=float))
    n_total = len(failures) + len(rc)
    latent = np.asarray(fit.distribution.random_samples(n_total, seed=rng), dtype=float)
    censor_times = _sample_censor_times(censoring_plan, n_total, rng)
    if censor_times is None:
        return latent, None
    failed = latent <= censor_times
    return latent[failed], censor_times[~failed]


def parametric_bootstrap_intervals(fit, target_specs, CI=None,
                                   n_bootstrap=200, seed=None,
                                   return_samples=False, progress_callback=None,
                                   censoring_design=None):
    """Refitted percentile intervals for one or more scalar targets.

    ``target_specs`` maps stable result keys to dictionaries containing
    ``target`` and optional ``value`` fields.  All targets are evaluated from
    the same simulated datasets and refits, avoiding redundant fitting while
    preserving paired Monte Carlo draws.

    For censored data, ``censoring_design`` may declare one of:

    * ``{"type": "fixed_administrative", "time": ...}``;
    * ``{"type": "observed_schedule", "times": [...]}``, with one planned
      censor time per observed unit; or
    * ``{"type": "parametric_independent", "distribution": ...,
      "parameters": {...}}``. Supported independent distributions are
      exponential, Weibull, lognormal, and uniform.

    Omitting the design for censored observations retains the historical
    empirical censor-time resampling behavior, but the result is explicitly
    marked ``approximate_unverified`` and carries uncertainty warnings.
    """
    if not getattr(fit, "fit_eligible", False):
        raise UncertaintyEstimationError(
            "Parametric bootstrap requires an eligible converged fit."
        )
    n_bootstrap = _bootstrap_count(n_bootstrap)
    CI = float(CI if CI is not None else fit.CI)
    if not 0 < CI < 1:
        raise ValueError("CI must be strictly between 0 and 1.")

    if not isinstance(target_specs, Mapping) or not target_specs:
        raise ValueError("target_specs must be a non-empty mapping.")
    normalized_specs = {}
    estimates = {}
    for key, spec in target_specs.items():
        if not isinstance(spec, Mapping):
            raise TypeError("Each target specification must be a mapping.")
        normalized = {
            "target": str(spec.get("target", "reliability")).lower(),
            "value": spec.get("value"),
        }
        normalized_specs[str(key)] = normalized
        estimates[str(key)] = _target_value(
            fit.distribution, normalized["target"], normalized["value"],
        )
    rng = np.random.default_rng(seed)
    censoring_plan = _prepare_censoring_plan(
        fit._ci_failures, fit._ci_right_censored, censoring_design,
    )
    samples = {key: [] for key in normalized_specs}
    shared_failure_reasons = {
        "too_few_failures": 0,
        "refit_failed": 0,
        "ineligible_refit": 0,
    }
    target_failure_reasons = {key: 0 for key in normalized_specs}
    refit_runtime_warning_count = 0
    if progress_callback is not None:
        progress_callback(0, int(n_bootstrap))
    for iteration in range(int(n_bootstrap)):
        try:
            simulated_failures, simulated_rc = _bootstrap_sample(
                fit, rng, censoring_plan,
            )
            if len(simulated_failures) < 2:
                shared_failure_reasons["too_few_failures"] += 1
                continue
            try:
                with warnings.catch_warnings(record=True) as caught_warnings:
                    warnings.simplefilter("always", RuntimeWarning)
                    refit = fit.__class__(
                        failures=simulated_failures,
                        right_censored=simulated_rc,
                        method="MLE",
                        CI=CI,
                        show_probability_plot=False,
                    )
                refit_runtime_warning_count += len(caught_warnings)
            except Exception:
                shared_failure_reasons["refit_failed"] += 1
                continue
            if not getattr(refit, "fit_eligible", False):
                shared_failure_reasons["ineligible_refit"] += 1
                continue
            for key, spec in normalized_specs.items():
                try:
                    target_sample = _target_value(
                        refit.distribution, spec["target"], spec["value"],
                    )
                except (ValueError, RuntimeError, FloatingPointError):
                    target_failure_reasons[key] += 1
                    continue
                if np.isfinite(target_sample):
                    samples[key].append(float(target_sample))
                else:
                    target_failure_reasons[key] += 1
        finally:
            if progress_callback is not None:
                progress_callback(iteration + 1, int(n_bootstrap))

    minimum_successes = max(15, math.ceil(0.8 * n_bootstrap))
    incomplete = {
        key: len(target_samples)
        for key, target_samples in samples.items()
        if len(target_samples) < minimum_successes
    }
    if incomplete:
        summary = ", ".join(
            f"{key}={count}" for key, count in sorted(incomplete.items())
        )
        raise UncertaintyEstimationError(
            f"Too few eligible bootstrap refits ({summary}); each target "
            f"requires at least {minimum_successes}/{n_bootstrap}."
        )

    boundary_parameters = _detected_boundary_parameters(fit)
    minimum_success_rate = min(
        len(target_samples) / float(n_bootstrap)
        for target_samples in samples.values()
    )
    inferential_status = (
        "nonregular_boundary_unverified" if boundary_parameters
        else "parametric_bootstrap_low_replication_unverified"
        if n_bootstrap < 100
        else "parametric_bootstrap_conditional_refits_unverified"
        if minimum_success_rate < 0.90
        else "parametric_bootstrap_percentile"
    )
    uncertainty_warnings = list(censoring_plan.uncertainty_warnings)
    if boundary_parameters:
        uncertainty_warnings.append(
            "plug_in_bootstrap_not_boundary_calibrated"
        )
    if n_bootstrap < 100:
        uncertainty_warnings.append(
            "bootstrap_replication_count_below_100_has_unstable_percentile_endpoints"
        )
    if minimum_success_rate < 0.90:
        uncertainty_warnings.append(
            "bootstrap_refit_failures_may_bias_percentile_interval"
        )
    if refit_runtime_warning_count:
        uncertainty_warnings.append(
            "bootstrap_refits_emitted_runtime_warnings"
        )
    results = {}
    for key, spec in normalized_specs.items():
        samples_array = np.asarray(samples[key], dtype=float)
        alpha = (1.0 - CI) / 2.0
        lower, upper = np.quantile(samples_array, [alpha, 1.0 - alpha])
        failure_reasons = dict(shared_failure_reasons)
        failure_reasons["nonfinite_target"] = target_failure_reasons[key]
        result = {
            "method": "parametric_bootstrap_percentile",
            "target": spec["target"],
            "target_value": spec["value"],
            "estimate": estimates[key],
            "lower": float(lower),
            "upper": float(upper),
            "CI": CI,
            "complete": bool(
                n_bootstrap >= 100
                and len(samples[key]) / float(n_bootstrap) >= 0.90
            ),
            "interval_status": (
                "complete"
                if (n_bootstrap >= 100
                    and len(samples[key]) / float(n_bootstrap) >= 0.90)
                else "partial_diagnostic"
            ),
            "n_requested": int(n_bootstrap),
            "n_successful": len(samples[key]),
            "success_rate": len(samples[key]) / float(n_bootstrap),
            "bootstrap_standard_error": float(np.std(samples_array, ddof=1)),
            "bootstrap_bias": float(
                np.mean(samples_array) - estimates[key]
            ),
            "censoring_model": censoring_plan.model,
            "censoring_design": censoring_plan.diagnostics(),
            # Compatibility field: historically this represented only the
            # censoring-design status. Boundary nonregularity takes precedence.
            "calibration_status": (
                inferential_status if boundary_parameters
                else censoring_plan.calibration_status
            ),
            "inferential_calibration_status": inferential_status,
            "censoring_design_status": censoring_plan.calibration_status,
            "boundary_parameters": boundary_parameters,
            "uncertainty_warnings": list(uncertainty_warnings),
            "failure_reasons": failure_reasons,
            "refit_runtime_warning_count": refit_runtime_warning_count,
            "seed": seed,
        }
        if return_samples:
            result["samples"] = samples_array.tolist()
        results[key] = result
    return results


def parametric_bootstrap_interval(fit, target="reliability", value=None,
                                  CI=None, n_bootstrap=200, seed=None,
                                  return_samples=False, progress_callback=None,
                                  censoring_design=None):
    """Refitted parametric-bootstrap percentile interval for one target."""
    return parametric_bootstrap_intervals(
        fit,
        {"interval": {"target": target, "value": value}},
        CI=CI,
        n_bootstrap=n_bootstrap,
        seed=seed,
        return_samples=return_samples,
        progress_callback=progress_callback,
        censoring_design=censoring_design,
    )["interval"]


def special_model_bootstrap_interval(fit, target="reliability", value=None,
                                     CI=None, n_bootstrap=200, seed=None,
                                     return_samples=False, progress_callback=None,
                                     censoring_design=None):
    """Refitted bootstrap interval for Weibull mixture/competing-risk SF.

    ``censoring_design`` uses the same explicit contract documented by
    :func:`parametric_bootstrap_interval`.
    """
    if str(target).lower() not in ("reliability", "sf"):
        raise ValueError("Special-model bootstrap currently supports reliability only.")
    if value is None or not np.isfinite(value) or value < 0:
        raise ValueError("A finite non-negative mission time is required.")
    if not getattr(fit, "fit_eligible", False):
        raise UncertaintyEstimationError(
            "Bootstrap requires a converged, identifiable special-model fit."
        )
    n_bootstrap = _bootstrap_count(n_bootstrap)
    CI = float(CI if CI is not None else fit.CI)
    if not 0 < CI < 1:
        raise ValueError("CI must be strictly between 0 and 1.")
    rng = np.random.default_rng(seed)
    failures = np.asarray(fit._bootstrap_failures, dtype=float)
    rc = np.asarray(fit._bootstrap_right_censored, dtype=float)
    n_total = len(failures) + len(rc)
    estimate = float(np.asarray(fit.SF([value]))[0])
    censoring_plan = _prepare_censoring_plan(
        failures, rc, censoring_design,
    )

    samples = []
    failed_refits = 0
    refit_runtime_warning_count = 0
    if progress_callback is not None:
        progress_callback(0, int(n_bootstrap))
    for iteration in range(int(n_bootstrap)):
        try:
            if hasattr(fit, "proportion_1"):
                component = rng.random(n_total) >= fit.proportion_1
                latent = np.empty(n_total)
                n_first = int(np.sum(~component))
                latent[~component] = ss.weibull_min.rvs(
                    c=fit.beta_1, scale=fit.alpha_1, size=n_first,
                    random_state=rng,
                )
                latent[component] = ss.weibull_min.rvs(
                    c=fit.beta_2, scale=fit.alpha_2,
                    size=n_total - n_first, random_state=rng,
                )
            else:
                first = ss.weibull_min.rvs(
                    c=fit.beta_1, scale=fit.alpha_1, size=n_total,
                    random_state=rng,
                )
                second = ss.weibull_min.rvs(
                    c=fit.beta_2, scale=fit.alpha_2, size=n_total,
                    random_state=rng,
                )
                latent = np.minimum(first, second)

            censor_times = _sample_censor_times(censoring_plan, n_total, rng)
            if censor_times is not None:
                failed = latent <= censor_times
                bootstrap_failures = latent[failed]
                bootstrap_rc = censor_times[~failed]
            else:
                bootstrap_failures = latent
                bootstrap_rc = None
            if len(bootstrap_failures) < 4:
                failed_refits += 1
                continue
            try:
                with warnings.catch_warnings(record=True) as caught_warnings:
                    warnings.simplefilter("always", RuntimeWarning)
                    refit = fit.__class__(
                        failures=bootstrap_failures,
                        right_censored=bootstrap_rc,
                        CI=CI,
                    )
                refit_runtime_warning_count += len(caught_warnings)
            except Exception:
                failed_refits += 1
                continue
            if not getattr(refit, "fit_eligible", False):
                failed_refits += 1
                continue
            target_sample = float(np.asarray(refit.SF([value]))[0])
            if np.isfinite(target_sample):
                samples.append(target_sample)
            else:
                failed_refits += 1
        finally:
            if progress_callback is not None:
                progress_callback(iteration + 1, int(n_bootstrap))

    minimum_successes = max(15, math.ceil(0.8 * n_bootstrap))
    if len(samples) < minimum_successes:
        raise UncertaintyEstimationError(
            f"Only {len(samples)}/{n_bootstrap} special-model bootstrap "
            "refits were converged and identifiable."
        )
    samples_array = np.asarray(samples)
    alpha = (1.0 - CI) / 2.0
    lower, upper = np.quantile(samples_array, [alpha, 1.0 - alpha])
    success_rate = len(samples) / float(n_bootstrap)
    inferential_status = (
        "parametric_bootstrap_low_replication_unverified"
        if n_bootstrap < 100
        else "parametric_bootstrap_conditional_refits_unverified"
        if success_rate < 0.90
        else "parametric_bootstrap_percentile_conditional_on_identifiable_fit"
    )
    uncertainty_warnings = list(censoring_plan.uncertainty_warnings)
    if n_bootstrap < 100:
        uncertainty_warnings.append(
            "bootstrap_replication_count_below_100_has_unstable_percentile_endpoints"
        )
    if success_rate < 0.90:
        uncertainty_warnings.append(
            "bootstrap_refit_failures_may_bias_percentile_interval"
        )
    if refit_runtime_warning_count:
        uncertainty_warnings.append(
            "bootstrap_refits_emitted_runtime_warnings"
        )
    result = {
        "method": "parametric_bootstrap_percentile",
        "target": "reliability",
        "target_value": value,
        "estimate": estimate,
        "lower": float(lower),
        "upper": float(upper),
        "CI": CI,
        "complete": bool(n_bootstrap >= 100 and success_rate >= 0.90),
        "interval_status": (
            "complete" if n_bootstrap >= 100 and success_rate >= 0.90
            else "partial_diagnostic"
        ),
        "n_requested": int(n_bootstrap),
        "n_successful": len(samples),
        "success_rate": success_rate,
        "failed_or_ineligible_refits": failed_refits,
        "refit_runtime_warning_count": refit_runtime_warning_count,
        "censoring_model": censoring_plan.model,
        "censoring_design": censoring_plan.diagnostics(),
        "calibration_status": censoring_plan.calibration_status,
        "inferential_calibration_status": inferential_status,
        "censoring_design_status": censoring_plan.calibration_status,
        "boundary_parameters": [],
        "uncertainty_warnings": uncertainty_warnings,
        "seed": seed,
    }
    if return_samples:
        result["samples"] = samples_array.tolist()
    return result
