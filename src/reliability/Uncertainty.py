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

import numpy as np
from scipy import stats as ss
from scipy.optimize import brentq, minimize
from scipy.special import expit, logit

from reliability.Utils import negative_log_likelihood


class UncertaintyEstimationError(ValueError):
    """Raised when a calibrated interval cannot be estimated reliably."""


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

    profile_cache = {float(estimate): float(nll_minimum)}
    optimizer_failures = []

    def profile_nll(target_value):
        target_value = float(target_value)
        for cached_target, cached_nll in profile_cache.items():
            if math.isclose(target_value, cached_target, rel_tol=1e-12, abs_tol=1e-14):
                return cached_nll

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
            return np.inf
        profile_cache[target_value] = float(best.fun)
        return float(best.fun)

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

    def lr_minus_cutoff(transformed_target):
        candidate_target = inverse(float(transformed_target))
        profiled = profile_nll(candidate_target)
        if not np.isfinite(profiled):
            return 1e6
        return 2.0 * (profiled - nll_minimum) - cutoff

    def endpoint(direction):
        previous = transformed_estimate
        step = initial_step
        for _ in range(24):
            candidate = transformed_estimate + direction * step
            if abs(candidate - transformed_estimate) > maximum_span:
                break
            candidate_value = lr_minus_cutoff(candidate)
            if candidate_value >= 0:
                lo, hi = sorted((previous, candidate))
                try:
                    root = brentq(
                        lr_minus_cutoff, lo, hi, xtol=1e-7, rtol=1e-8,
                        maxiter=100,
                    )
                    return inverse(root)
                except (ValueError, RuntimeError):
                    return inverse(candidate)
            if np.isfinite(candidate_value):
                previous = candidate
            step *= 1.6
        return None

    lower = endpoint(-1)
    upper = endpoint(1)
    complete = lower is not None and upper is not None
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
        "profile_evaluations": len(profile_cache),
        "optimizer_failure_count": len(optimizer_failures),
        "optimizer_failed_targets": optimizer_failures[:10],
    }


def _bootstrap_sample(fit, rng):
    failures = np.asarray(fit._ci_failures, dtype=float)
    rc = (np.asarray(fit._ci_right_censored, dtype=float)
          if fit._ci_right_censored is not None else np.array([], dtype=float))
    n_total = len(failures) + len(rc)
    latent = np.asarray(fit.distribution.random_samples(n_total, seed=rng), dtype=float)
    if len(rc) == 0:
        return latent, None, "complete_sample"

    censor_times = rng.choice(rc, size=n_total, replace=True)
    failed = latent <= censor_times
    return latent[failed], censor_times[~failed], "empirical_censor_time_resampling"


def parametric_bootstrap_interval(fit, target="reliability", value=None,
                                  CI=None, n_bootstrap=200, seed=None,
                                  return_samples=False):
    """Refitted parametric-bootstrap percentile interval for a scalar target."""
    if not getattr(fit, "fit_eligible", False):
        raise UncertaintyEstimationError(
            "Parametric bootstrap requires an eligible converged fit."
        )
    if n_bootstrap < 20:
        raise ValueError("n_bootstrap must be at least 20.")
    CI = float(CI if CI is not None else fit.CI)
    if not 0 < CI < 1:
        raise ValueError("CI must be strictly between 0 and 1.")

    estimate = _target_value(fit.distribution, target, value)
    rng = np.random.default_rng(seed)
    samples = []
    failure_reasons = {"too_few_failures": 0, "refit_failed": 0,
                       "ineligible_refit": 0, "nonfinite_target": 0}
    censoring_model = "complete_sample"
    for _ in range(int(n_bootstrap)):
        simulated_failures, simulated_rc, censoring_model = _bootstrap_sample(fit, rng)
        if len(simulated_failures) < 2:
            failure_reasons["too_few_failures"] += 1
            continue
        try:
            refit = fit.__class__(
                failures=simulated_failures,
                right_censored=simulated_rc,
                method="MLE",
                CI=CI,
                show_probability_plot=False,
            )
        except Exception:
            failure_reasons["refit_failed"] += 1
            continue
        if not getattr(refit, "fit_eligible", False):
            failure_reasons["ineligible_refit"] += 1
            continue
        try:
            target_sample = _target_value(refit.distribution, target, value)
        except (ValueError, RuntimeError, FloatingPointError):
            failure_reasons["nonfinite_target"] += 1
            continue
        if np.isfinite(target_sample):
            samples.append(float(target_sample))
        else:
            failure_reasons["nonfinite_target"] += 1

    minimum_successes = max(15, math.ceil(0.7 * n_bootstrap))
    if len(samples) < minimum_successes:
        raise UncertaintyEstimationError(
            f"Only {len(samples)}/{n_bootstrap} bootstrap refits were eligible; "
            f"at least {minimum_successes} are required."
        )

    samples_array = np.asarray(samples, dtype=float)
    alpha = (1.0 - CI) / 2.0
    lower, upper = np.quantile(samples_array, [alpha, 1.0 - alpha])
    result = {
        "method": "parametric_bootstrap_percentile",
        "target": str(target).lower(),
        "target_value": value,
        "estimate": estimate,
        "lower": float(lower),
        "upper": float(upper),
        "CI": CI,
        "n_requested": int(n_bootstrap),
        "n_successful": len(samples),
        "success_rate": len(samples) / float(n_bootstrap),
        "bootstrap_standard_error": float(np.std(samples_array, ddof=1)),
        "bootstrap_bias": float(np.mean(samples_array) - estimate),
        "censoring_model": censoring_model,
        "failure_reasons": failure_reasons,
        "seed": seed,
    }
    if return_samples:
        result["samples"] = samples_array.tolist()
    return result


def special_model_bootstrap_interval(fit, target="reliability", value=None,
                                     CI=None, n_bootstrap=200, seed=None,
                                     return_samples=False):
    """Refitted bootstrap interval for Weibull mixture/competing-risk SF."""
    if str(target).lower() not in ("reliability", "sf"):
        raise ValueError("Special-model bootstrap currently supports reliability only.")
    if value is None or not np.isfinite(value) or value < 0:
        raise ValueError("A finite non-negative mission time is required.")
    if not getattr(fit, "fit_eligible", False):
        raise UncertaintyEstimationError(
            "Bootstrap requires a converged, identifiable special-model fit."
        )
    if n_bootstrap < 20:
        raise ValueError("n_bootstrap must be at least 20.")
    CI = float(CI if CI is not None else fit.CI)
    rng = np.random.default_rng(seed)
    failures = np.asarray(fit._bootstrap_failures, dtype=float)
    rc = np.asarray(fit._bootstrap_right_censored, dtype=float)
    n_total = len(failures) + len(rc)
    estimate = float(np.asarray(fit.SF([value]))[0])

    samples = []
    failed_refits = 0
    for _ in range(int(n_bootstrap)):
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

        if len(rc):
            censor_times = rng.choice(rc, size=n_total, replace=True)
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
            refit = fit.__class__(
                failures=bootstrap_failures,
                right_censored=bootstrap_rc,
                CI=CI,
            )
        except Exception:
            failed_refits += 1
            continue
        if not getattr(refit, "fit_eligible", False):
            failed_refits += 1
            continue
        samples.append(float(np.asarray(refit.SF([value]))[0]))

    minimum_successes = max(15, math.ceil(0.7 * n_bootstrap))
    if len(samples) < minimum_successes:
        raise UncertaintyEstimationError(
            f"Only {len(samples)}/{n_bootstrap} special-model bootstrap "
            "refits were converged and identifiable."
        )
    samples_array = np.asarray(samples)
    alpha = (1.0 - CI) / 2.0
    lower, upper = np.quantile(samples_array, [alpha, 1.0 - alpha])
    result = {
        "method": "parametric_bootstrap_percentile",
        "target": "reliability",
        "target_value": value,
        "estimate": estimate,
        "lower": float(lower),
        "upper": float(upper),
        "CI": CI,
        "n_requested": int(n_bootstrap),
        "n_successful": len(samples),
        "success_rate": len(samples) / float(n_bootstrap),
        "failed_or_ineligible_refits": failed_refits,
        "seed": seed,
    }
    if return_samples:
        result["samples"] = samples_array.tolist()
    return result
