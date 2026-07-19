#!/usr/bin/env python3
"""Run reproducible uncertainty coverage and identifiability simulations.

The JSON configuration intentionally separates a tiny deterministic PR corpus
from nightly and release-scale Monte Carlo studies.  Results are emitted as
machine-readable JSON and include Monte Carlo completion, conditional and
unconditional coverage, Wilson intervals, and an explicit classification.

This is validation tooling, not a claim that every configured interval is
calibrated.  In particular, ordinary chi-square profile cutoffs are reported
as unsupported for scenarios whose true parameter is on a boundary.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import math
import platform
import sys
import time
import warnings
from pathlib import Path

import numpy as np
import scipy
from scipy import stats as ss
from scipy.special import expit, logit

from reliability.Fitters import (
    Fit_Lognormal_2P,
    Fit_Weibull_2P,
    Fit_Weibull_3P,
)
from reliability.Special_models import Fit_Weibull_CR, Fit_Weibull_Mixture
from reliability.Uncertainty import (
    UncertaintyEstimationError,
    _target_gradient,
    _target_value,
    parametric_bootstrap_intervals,
    special_model_bootstrap_interval,
)


DEFAULT_CONFIG = Path(__file__).with_name("uncertainty_coverage_matrix.json")
SUPPORTED_METHODS = {
    "wald_delta", "profile_likelihood", "parametric_bootstrap",
}


def _scenario_seed_sequence(scenario, seed_offset, replicate, stage):
    """Create non-overlapping deterministic streams keyed by scenario/stage."""
    digest = hashlib.blake2b(
        str(scenario["id"]).encode("utf-8"), digest_size=8,
    ).digest()
    scenario_words = np.frombuffer(digest, dtype=np.uint32).astype(int).tolist()
    return np.random.SeedSequence([
        int(scenario["seed_base"]),
        int(seed_offset),
        int(replicate),
        int(stage),
        *scenario_words,
    ])


def _scenario_rng(scenario, seed_offset, replicate, stage=0):
    return np.random.default_rng(
        _scenario_seed_sequence(scenario, seed_offset, replicate, stage),
    )


def _scenario_seed(scenario, seed_offset, replicate, stage=1):
    return int(
        _scenario_seed_sequence(
            scenario, seed_offset, replicate, stage,
        ).generate_state(1, dtype=np.uint32)[0]
    )


def _software_provenance():
    try:
        perdura_version = importlib.metadata.version("perdura")
    except importlib.metadata.PackageNotFoundError:
        perdura_version = "source_checkout"
    return {
        "python": platform.python_version(),
        "implementation": platform.python_implementation(),
        "platform": platform.platform(),
        "numpy": np.__version__,
        "scipy": scipy.__version__,
        "perdura": perdura_version,
        "executable": sys.executable,
    }


def wilson_interval(successes, trials, confidence=0.95):
    """Return a two-sided Wilson score interval for a binomial proportion."""
    successes = int(successes)
    trials = int(trials)
    if trials <= 0 or not 0 <= successes <= trials:
        return None
    if not 0 < confidence < 1:
        raise ValueError("confidence must be strictly between 0 and 1.")
    z = float(ss.norm.ppf(0.5 + confidence / 2.0))
    estimate = successes / trials
    denominator = 1.0 + z * z / trials
    center = (estimate + z * z / (2.0 * trials)) / denominator
    radius = (
        z
        * math.sqrt(
            estimate * (1.0 - estimate) / trials
            + z * z / (4.0 * trials * trials)
        )
        / denominator
    )
    return [max(0.0, center - radius), min(1.0, center + radius)]


def classify_coverage(successes, trials, nominal, confidence=0.95,
                      supported_tolerance=0.03, deficient_tolerance=0.05):
    """Classify coverage while accounting for Monte Carlo uncertainty."""
    interval = wilson_interval(successes, trials, confidence=confidence)
    if interval is None:
        return {
            "classification": "unavailable",
            "wilson_interval": None,
            "reason": "No complete intervals were available.",
        }
    lower, upper = interval
    if lower >= nominal - supported_tolerance:
        classification = "supported"
    elif upper < nominal - deficient_tolerance:
        classification = "deficient"
    else:
        classification = "inconclusive"
    return {
        "classification": classification,
        "wilson_interval": interval,
        "wilson_confidence": confidence,
        "supported_threshold": nominal - supported_tolerance,
        "deficient_threshold": nominal - deficient_tolerance,
    }


def load_config(path=DEFAULT_CONFIG):
    with Path(path).open("r", encoding="utf-8") as handle:
        config = json.load(handle)
    validate_config(config)
    return config


def validate_config(config):
    if config.get("schema_version") != 1:
        raise ValueError("Coverage matrix schema_version must be 1.")
    tiers = config.get("tiers")
    scenarios = config.get("scenarios")
    if not isinstance(tiers, dict) or not tiers:
        raise ValueError("Coverage matrix requires at least one tier.")
    if not isinstance(scenarios, list) or not scenarios:
        raise ValueError("Coverage matrix requires at least one scenario.")
    ids = [scenario.get("id") for scenario in scenarios]
    if any(not value for value in ids) or len(ids) != len(set(ids)):
        raise ValueError("Scenario ids must be present and unique.")
    for name, tier in tiers.items():
        if int(tier.get("replicates", 0)) <= 0:
            raise ValueError(f"Tier {name!r} requires positive replicates.")
        nominal = float(tier.get("nominal_coverage", 0.0))
        if not 0 < nominal < 1:
            raise ValueError(
                f"Tier {name!r} nominal_coverage must be between 0 and 1."
            )
        methods = set(tier.get("methods", []))
        if not methods or not methods <= SUPPORTED_METHODS:
            raise ValueError(f"Tier {name!r} contains unsupported methods.")
        if "parametric_bootstrap" in methods:
            bootstrap_resamples = int(tier.get("bootstrap_resamples", 0))
            if not 20 <= bootstrap_resamples <= 2000:
                raise ValueError(
                    f"Tier {name!r} requires 20 to 2000 bootstrap resamples."
                )
        for method, count in tier.get("method_replicates", {}).items():
            if method not in SUPPORTED_METHODS or int(count) <= 0:
                raise ValueError(
                    f"Tier {name!r} has invalid method_replicates for {method!r}."
                )
        for method, scheduled_ids in tier.get("method_scenarios", {}).items():
            if method not in SUPPORTED_METHODS:
                raise ValueError(
                    f"Tier {name!r} schedules unsupported method {method!r}."
                )
            unknown = set(scheduled_ids) - set(ids)
            if unknown:
                raise ValueError(
                    f"Tier {name!r} schedules unknown scenarios: "
                    f"{', '.join(sorted(unknown))}."
                )
    for scenario in scenarios:
        if int(scenario.get("n", 0)) <= 0:
            raise ValueError(
                f"Scenario {scenario['id']!r} requires a positive sample size."
            )
        censoring = scenario.get("censoring", {"type": "none"})
        if censoring.get("type") == "observed_schedule":
            times = censoring.get("times")
            if not isinstance(times, list) or len(times) != int(scenario["n"]):
                raise ValueError(
                    f"Scenario {scenario['id']!r} observed schedule length "
                    "must equal n."
                )
    kinds = {scenario.get("kind") for scenario in scenarios}
    required = {
        "weibull_lifetime",
        "lognormal_lifetime",
        "weibull_boundary",
        "weibull_mixture",
        "weibull_competing_risks",
    }
    if not required <= kinds:
        raise ValueError(
            "Matrix must include lifetime, boundary, and weak-identification "
            "scenario families."
        )


def _scenario_censoring(scenario, latent, rng):
    censoring = scenario.get("censoring", {"type": "none"})
    censoring_type = censoring.get("type", "none")
    if censoring_type == "none":
        return latent, None, None
    if censoring_type == "fixed_administrative":
        cutoff = float(censoring["time"])
        censor_times = np.full(len(latent), cutoff)
        bootstrap_design = {
            "type": "fixed_administrative",
            "time": cutoff,
        }
    elif censoring_type == "parametric_independent":
        distribution = censoring["distribution"]
        parameters = censoring["parameters"]
        if distribution != "weibull":
            raise ValueError(
                "Matrix generation currently uses independent Weibull "
                "censoring; the interval engine supports additional families."
            )
        censor_times = float(parameters["scale"]) * rng.weibull(
            float(parameters["shape"]), size=len(latent),
        )
        bootstrap_design = {
            "type": "parametric_independent",
            "distribution": "weibull",
            "parameters": {
                "shape": float(parameters["shape"]),
                "scale": float(parameters["scale"]),
            },
        }
    elif censoring_type == "observed_schedule":
        censor_times = np.asarray(censoring.get("times"), dtype=float)
        if (censor_times.ndim != 1 or len(censor_times) != len(latent)
                or np.any(~np.isfinite(censor_times))
                or np.any(censor_times <= 0)):
            raise ValueError(
                "observed_schedule scenario times must contain one positive "
                "finite planned censor time per simulated unit."
            )
        bootstrap_design = {
            "type": "observed_schedule",
            "times": censor_times.tolist(),
        }
    else:
        raise ValueError(f"Unsupported scenario censoring type {censoring_type!r}.")
    failed = latent <= censor_times
    return latent[failed], censor_times[~failed], bootstrap_design


def _target_specs(scenario):
    if scenario["kind"] == "lognormal_lifetime":
        mu = float(scenario["mu"])
        sigma = float(scenario["sigma"])
        return {
            "r_at_scale": {
                "target": "reliability",
                "value": math.exp(mu),
                "true_value": 0.5,
            },
            "b10_life": {
                "target": "quantile",
                "value": 0.10,
                "true_value": math.exp(mu + sigma * float(ss.norm.ppf(0.10))),
            },
            "r_0_95": {
                "target": "reliability",
                "value": math.exp(mu + sigma * float(ss.norm.ppf(0.05))),
                "true_value": 0.95,
            },
        }
    eta = float(scenario["scale"])
    beta = float(scenario["shape"])
    gamma = float(scenario.get("gamma", 0.0))
    return {
        "r_at_scale": {
            "target": "reliability",
            "value": gamma + eta,
            "true_value": math.exp(-1.0),
        },
        "b10_life": {
            "target": "quantile",
            "value": 0.10,
            "true_value": gamma + eta * (-math.log(0.90)) ** (1.0 / beta),
        },
        "r_0_95": {
            "target": "reliability",
            "value": gamma + eta * (-math.log(0.95)) ** (1.0 / beta),
            "true_value": 0.95,
        },
    }


def _wald_delta_interval(fit, target, value, confidence):
    covariance = getattr(fit, "covariance_matrix", None)
    if covariance is None:
        return None
    estimate = _target_value(fit.distribution, target, value)
    gradient = _target_gradient(fit, target, value)
    if np.any(~np.isfinite(gradient)) or np.any(~np.isfinite(covariance)):
        return None
    variance = float(gradient @ covariance @ gradient)
    if not np.isfinite(variance) or variance <= 0:
        return None
    standard_error = math.sqrt(variance)
    z = float(ss.norm.ppf(0.5 + confidence / 2.0))
    if target in ("reliability", "sf"):
        estimate = float(np.clip(estimate, 1e-12, 1 - 1e-12))
        transformed_se = standard_error / (estimate * (1.0 - estimate))
        lower = expit(logit(estimate) - z * transformed_se)
        upper = expit(logit(estimate) + z * transformed_se)
    elif estimate > 0:
        transformed_se = standard_error / estimate
        lower = estimate * math.exp(-z * transformed_se)
        upper = estimate * math.exp(z * transformed_se)
    else:
        lower = estimate - z * standard_error
        upper = estimate + z * standard_error
    return float(lower), float(upper)


def _empty_accumulator(requested):
    return {
        "_requested": int(requested),
        "attempted": 0,
        "complete": 0,
        "covered": 0,
        "widths": [],
        "errors": {},
    }


def _record_error(accumulator, reason):
    accumulator["errors"][reason] = accumulator["errors"].get(reason, 0) + 1


def _finalize_interval_result(accumulator, nominal, *, evidence_mode,
                              completion_threshold=0.95):
    complete = accumulator["complete"]
    requested = accumulator["_requested"]
    covered = accumulator["covered"]
    completion_rate = complete / requested if requested else None
    conditional = classify_coverage(covered, complete, nominal)
    unconditional = classify_coverage(covered, requested, nominal)
    if evidence_mode == "functional_guard_only":
        overall_classification = "functional_guard_only"
        conditional_classification = "functional_guard_only"
        unconditional_classification = "functional_guard_only"
    else:
        conditional_classification = conditional["classification"]
        unconditional_classification = unconditional["classification"]
        if requested == 0 or complete == 0:
            overall_classification = "unavailable"
        elif completion_rate < completion_threshold:
            overall_classification = "insufficient_completion"
        elif (conditional_classification == "supported"
              and unconditional_classification == "supported"):
            overall_classification = "supported"
        elif (conditional_classification == "deficient"
              or unconditional_classification == "deficient"):
            overall_classification = "deficient"
        else:
            overall_classification = "inconclusive"
    return {
        "requested": requested,
        "attempted": accumulator["attempted"],
        "complete": complete,
        "completion_rate": completion_rate,
        "completion_threshold": completion_threshold,
        "completion_gate_passed": (
            completion_rate >= completion_threshold
            if completion_rate is not None else False
        ),
        "covered": covered,
        "coverage_conditional": covered / complete if complete else None,
        "coverage_unconditional": covered / requested if requested else None,
        "mean_interval_width": (
            float(np.mean(accumulator["widths"]))
            if accumulator["widths"] else None
        ),
        "evidence_mode": evidence_mode,
        "classification": overall_classification,
        "conditional_classification": conditional_classification,
        "unconditional_classification": unconditional_classification,
        "conditional_wilson_interval": conditional["wilson_interval"],
        "unconditional_wilson_interval": unconditional["wilson_interval"],
        "classification_details": {
            "conditional": conditional,
            "unconditional": unconditional,
            "completion_gate": {
                "threshold": completion_threshold,
                "passed": (
                    completion_rate >= completion_threshold
                    if completion_rate is not None else False
                ),
            },
            "evidence_mode": evidence_mode,
        },
        "errors": accumulator["errors"],
    }


def _method_replicates(tier, method, override):
    if override is not None:
        return int(override)
    return int(tier.get("method_replicates", {}).get(method, tier["replicates"]))


def _method_scheduled(tier, method, scenario_id):
    scheduled = tier.get("method_scenarios", {}).get(method)
    return scheduled is None or scenario_id in scheduled


def _run_lifetime_scenario(scenario, tier, methods, targets, seed_offset,
                           replicate_override, bootstrap_override,
                           evidence_mode):
    confidence = float(tier.get("nominal_coverage", 0.90))
    bootstrap_resamples = int(
        bootstrap_override
        if bootstrap_override is not None else tier.get("bootstrap_resamples", 20)
    )
    target_specs = _target_specs(scenario)
    selected_targets = [name for name in targets if name in target_specs]
    method_counts = {
        method: (
            _method_replicates(tier, method, replicate_override)
            if _method_scheduled(tier, method, scenario["id"]) else 0
        )
        for method in methods
    }
    accumulators = {
        (method, target): _empty_accumulator(method_counts[method])
        for method in methods for target in selected_targets
    }
    fit_eligible = 0
    fit_failures = 0
    fit_runtime_warning_count = 0
    maximum_replicates = max(method_counts.values(), default=0)
    boundary_model = scenario["kind"] == "weibull_boundary"
    nonregular_boundary = (
        boundary_model and float(scenario.get("gamma", 0.0)) == 0.0
    )

    def record_interval(accumulator, spec, lower, upper):
        if not np.isfinite(lower) or not np.isfinite(upper) or lower > upper:
            _record_error(accumulator, "nonfinite_or_reversed_interval")
            return
        accumulator["complete"] += 1
        accumulator["covered"] += int(
            lower <= spec["true_value"] <= upper
        )
        accumulator["widths"].append(float(upper - lower))

    for replicate in range(maximum_replicates):
        rng = _scenario_rng(scenario, seed_offset, replicate, stage=0)
        if scenario["kind"] == "lognormal_lifetime":
            latent = rng.lognormal(
                mean=float(scenario["mu"]),
                sigma=float(scenario["sigma"]),
                size=int(scenario["n"]),
            )
        else:
            latent = (
                float(scenario.get("gamma", 0.0))
                + float(scenario["scale"])
                * rng.weibull(float(scenario["shape"]), size=int(scenario["n"]))
            )
        failures, right_censored, censoring_design = _scenario_censoring(
            scenario, latent, rng,
        )
        if len(failures) < 2:
            fit_failures += 1
            for method in methods:
                if replicate < method_counts[method]:
                    for target in selected_targets:
                        _record_error(accumulators[(method, target)], "too_few_failures")
            continue
        try:
            if boundary_model:
                fit_class = Fit_Weibull_3P
            elif scenario["kind"] == "lognormal_lifetime":
                fit_class = Fit_Lognormal_2P
            else:
                fit_class = Fit_Weibull_2P
            with warnings.catch_warnings(record=True) as caught_warnings:
                warnings.simplefilter("always", RuntimeWarning)
                fit = fit_class(
                    failures=failures,
                    right_censored=right_censored,
                    method="MLE",
                    show_probability_plot=False,
                    CI=confidence,
                )
            fit_runtime_warning_count += len(caught_warnings)
        except Exception as exc:
            fit_failures += 1
            reason = f"fit_failed:{type(exc).__name__}"
            for method in methods:
                if replicate < method_counts[method]:
                    for target in selected_targets:
                        _record_error(accumulators[(method, target)], reason)
            continue
        if getattr(fit, "fit_eligible", False):
            fit_eligible += 1

        # A parametric bootstrap refit is independent of the scalar target.
        # Evaluate all requested targets from one paired refit stream.
        if ("parametric_bootstrap" in methods
                and replicate < method_counts["parametric_bootstrap"]):
            bootstrap_accumulators = {
                target_name: accumulators[("parametric_bootstrap", target_name)]
                for target_name in selected_targets
            }
            if not getattr(fit, "fit_eligible", False):
                for accumulator in bootstrap_accumulators.values():
                    _record_error(accumulator, "ineligible_fit")
            else:
                for accumulator in bootstrap_accumulators.values():
                    accumulator["attempted"] += 1
                try:
                    intervals = parametric_bootstrap_intervals(
                        fit,
                        {
                            target_name: {
                                "target": target_specs[target_name]["target"],
                                "value": target_specs[target_name]["value"],
                            }
                            for target_name in selected_targets
                        },
                        CI=confidence,
                        n_bootstrap=bootstrap_resamples,
                        seed=_scenario_seed(
                            scenario, seed_offset, replicate, stage=1,
                        ),
                        censoring_design=censoring_design,
                    )
                except (UncertaintyEstimationError, ValueError, RuntimeError) as exc:
                    for accumulator in bootstrap_accumulators.values():
                        _record_error(
                            accumulator,
                            f"interval_failed:{type(exc).__name__}",
                        )
                else:
                    for target_name, interval in intervals.items():
                        if not interval.get("complete", False):
                            _record_error(
                                bootstrap_accumulators[target_name],
                                "partial_bootstrap_interval",
                            )
                            continue
                        record_interval(
                            bootstrap_accumulators[target_name],
                            target_specs[target_name],
                            interval["lower"],
                            interval["upper"],
                        )

        for method in methods:
            if method == "parametric_bootstrap":
                continue
            if replicate >= method_counts[method]:
                continue
            for target_name in selected_targets:
                accumulator = accumulators[(method, target_name)]
                spec = target_specs[target_name]
                if nonregular_boundary and method == "profile_likelihood":
                    _record_error(accumulator, "unsupported_nonregular_boundary")
                    continue
                if not getattr(fit, "fit_eligible", False):
                    _record_error(accumulator, "ineligible_fit")
                    continue
                accumulator["attempted"] += 1
                try:
                    if method == "wald_delta":
                        interval = _wald_delta_interval(
                            fit, spec["target"], spec["value"], confidence,
                        )
                        if interval is None:
                            _record_error(accumulator, "covariance_unavailable")
                            continue
                        lower, upper = interval
                    elif method == "profile_likelihood":
                        interval = fit.profile_likelihood_interval(
                            target=spec["target"], value=spec["value"], CI=confidence,
                        )
                        if not interval["complete"]:
                            _record_error(accumulator, "incomplete_profile")
                            continue
                        lower, upper = interval["lower"], interval["upper"]
                except (UncertaintyEstimationError, ValueError, RuntimeError) as exc:
                    _record_error(accumulator, f"interval_failed:{type(exc).__name__}")
                    continue
                record_interval(accumulator, spec, lower, upper)

    results = []
    for method in methods:
        for target_name in selected_targets:
            result = _finalize_interval_result(
                accumulators[(method, target_name)], confidence,
                evidence_mode=evidence_mode,
            )
            inferential_status = (
                "unsupported_nonregular"
                if nonregular_boundary and method == "profile_likelihood"
                else "nonregular_boundary_unverified"
                if nonregular_boundary
                else "asymptotic_chi_square_near_boundary"
                if boundary_model and method == "profile_likelihood"
                else "asymptotic_approximation_near_boundary"
                if boundary_model and method == "wald_delta"
                else "asymptotic_chi_square"
                if method == "profile_likelihood"
                else "asymptotic_approximation"
                if method == "wald_delta"
                else "parametric_bootstrap_low_replication_unverified"
                if bootstrap_resamples < 100
                else "parametric_bootstrap_percentile"
            )
            censoring_status = (
                "not_applicable"
                if method != "parametric_bootstrap"
                else "model_based"
                if scenario.get("censoring", {}).get("type") == "parametric_independent"
                else "design_reproduced"
            )
            result.update({
                "method": method,
                "scheduled": method_counts[method] > 0,
                "target": target_name,
                "true_value": target_specs[target_name]["true_value"],
                "calibration_status": inferential_status,
                "inferential_calibration_status": inferential_status,
                "censoring_design_status": censoring_status,
            })
            results.append(result)
    return {
        "scenario_id": scenario["id"],
        "kind": scenario["kind"],
        "regime": scenario["regime"],
        "configuration": dict(scenario),
        "simulated_replicates": maximum_replicates,
        "fit_eligible_replicates": fit_eligible,
        "fit_eligibility_rate": (
            fit_eligible / maximum_replicates if maximum_replicates else None
        ),
        "fit_failures": fit_failures,
        "fit_runtime_warning_count": fit_runtime_warning_count,
        "interval_results": results,
    }


def _special_reliability(scenario, mission):
    first = math.exp(-(mission / float(scenario["scale_1"])) ** float(scenario["shape_1"]))
    second = math.exp(-(mission / float(scenario["scale_2"])) ** float(scenario["shape_2"]))
    if scenario["kind"] == "weibull_competing_risks":
        return first * second
    weight = float(scenario["weight_1"])
    return weight * first + (1.0 - weight) * second


def _run_special_scenario(scenario, tier, methods, seed_offset,
                          replicate_override, bootstrap_override,
                          evidence_mode):
    requested = int(
        replicate_override
        if replicate_override is not None else tier["replicates"]
    )
    bootstrap_requested = _method_replicates(
        tier, "parametric_bootstrap", replicate_override,
    ) if _method_scheduled(
        tier, "parametric_bootstrap", scenario["id"],
    ) else 0
    confidence = float(tier.get("nominal_coverage", 0.90))
    bootstrap_resamples = int(
        bootstrap_override
        if bootstrap_override is not None else tier.get("bootstrap_resamples", 20)
    )
    expected_identifiable = bool(scenario["expected_identifiable"])
    eligible = false_eligibility = false_ineligibility = fit_failures = 0
    fit_runtime_warning_count = 0
    stable_multistart = 0
    bootstrap = _empty_accumulator(bootstrap_requested)
    mission = float(scenario.get("mission_time", scenario["scale_1"]))
    true_reliability = _special_reliability(scenario, mission)

    simulation_replicates = (
        max(requested, bootstrap_requested)
        if "parametric_bootstrap" in methods else requested
    )
    for replicate in range(simulation_replicates):
        rng = _scenario_rng(scenario, seed_offset, replicate, stage=0)
        if scenario["kind"] == "weibull_mixture":
            component_one = (
                rng.random(int(scenario["n"])) < float(scenario["weight_1"])
            )
            latent = np.empty(int(scenario["n"]), dtype=float)
            latent[component_one] = float(scenario["scale_1"]) * rng.weibull(
                float(scenario["shape_1"]), size=int(np.sum(component_one)),
            )
            latent[~component_one] = float(scenario["scale_2"]) * rng.weibull(
                float(scenario["shape_2"]), size=int(np.sum(~component_one)),
            )
            fit_class = Fit_Weibull_Mixture
        else:
            first = float(scenario["scale_1"]) * rng.weibull(
                float(scenario["shape_1"]), size=int(scenario["n"]),
            )
            second = float(scenario["scale_2"]) * rng.weibull(
                float(scenario["shape_2"]), size=int(scenario["n"]),
            )
            latent = np.minimum(first, second)
            fit_class = Fit_Weibull_CR
        failures, right_censored, censoring_design = _scenario_censoring(
            scenario, latent, rng,
        )
        try:
            with warnings.catch_warnings(record=True) as caught_warnings:
                warnings.simplefilter("always", RuntimeWarning)
                fit = fit_class(
                    failures=failures,
                    right_censored=right_censored,
                    CI=confidence,
                )
            fit_runtime_warning_count += len(caught_warnings)
        except Exception:
            if replicate < requested:
                fit_failures += 1
            if ("parametric_bootstrap" in methods
                    and replicate < bootstrap_requested):
                _record_error(bootstrap, "fit_failed")
            continue
        is_eligible = bool(getattr(fit, "fit_eligible", False))
        multistart = getattr(fit, "identifiability_diagnostics", {}).get(
            "multistart", {},
        )
        if replicate < requested:
            eligible += int(is_eligible)
            false_eligibility += int(is_eligible and not expected_identifiable)
            false_ineligibility += int(not is_eligible and expected_identifiable)
            stable_multistart += int(bool(multistart.get("stable", False)))

        if ("parametric_bootstrap" not in methods
                or replicate >= bootstrap_requested):
            continue
        if not is_eligible:
            _record_error(bootstrap, "ineligible_fit")
            continue
        bootstrap["attempted"] += 1
        try:
            interval = special_model_bootstrap_interval(
                fit,
                value=mission,
                CI=confidence,
                n_bootstrap=bootstrap_resamples,
                seed=_scenario_seed(
                    scenario, seed_offset, replicate, stage=1,
                ),
                censoring_design=censoring_design,
            )
        except (UncertaintyEstimationError, ValueError, RuntimeError) as exc:
            _record_error(bootstrap, f"interval_failed:{type(exc).__name__}")
            continue
        if not interval.get("complete", False):
            _record_error(bootstrap, "partial_bootstrap_interval")
            continue
        bootstrap["complete"] += 1
        bootstrap["covered"] += int(
            interval["lower"] <= true_reliability <= interval["upper"]
        )
        bootstrap["widths"].append(interval["upper"] - interval["lower"])

    result = {
        "scenario_id": scenario["id"],
        "kind": scenario["kind"],
        "regime": scenario["regime"],
        "configuration": dict(scenario),
        "requested": requested,
        "expected_identifiable": expected_identifiable,
        "eligible": eligible,
        "eligibility_rate": eligible / requested,
        "false_eligibility": false_eligibility,
        "false_ineligibility": false_ineligibility,
        "stable_multistart": stable_multistart,
        "fit_failures": fit_failures,
        "fit_runtime_warning_count": fit_runtime_warning_count,
        "unsupported_interval_methods": [
            method for method in methods if method != "parametric_bootstrap"
        ],
    }
    if "parametric_bootstrap" in methods:
        result["bootstrap_result"] = _finalize_interval_result(
            bootstrap, confidence,
            evidence_mode=evidence_mode,
        )
        result["bootstrap_result"]["true_value"] = true_reliability
        result["bootstrap_result"].update({
            "scheduled": bootstrap_requested > 0,
            "inferential_calibration_status": (
                "parametric_bootstrap_low_replication_unverified"
                if bootstrap_resamples < 100
                else "parametric_bootstrap_percentile_conditional_on_identifiable_fit"
            ),
            "censoring_design_status": (
                "model_based"
                if scenario.get("censoring", {}).get("type") == "parametric_independent"
                else "design_reproduced"
            ),
        })
    return result


def run_matrix(config, tier_name="pr", scenario_ids=None, methods=None,
               targets=None, seed_offset=0, replicate_override=None,
               bootstrap_override=None):
    """Run selected matrix cells and return a JSON-serializable result."""
    started = time.perf_counter()
    validate_config(config)
    if tier_name not in config["tiers"]:
        raise ValueError(f"Unknown coverage tier {tier_name!r}.")
    tier = config["tiers"][tier_name]
    if bootstrap_override is not None and not 20 <= int(bootstrap_override) <= 2000:
        raise ValueError("bootstrap_override must be from 20 to 2000.")
    evidence_mode = (
        "functional_guard_only"
        if (tier_name == "pr" or replicate_override is not None
            or bootstrap_override is not None)
        else "empirical_coverage"
    )
    selected_methods = list(methods or tier["methods"])
    if not selected_methods or not set(selected_methods) <= SUPPORTED_METHODS:
        raise ValueError("At least one supported interval method is required.")
    selected_targets = list(targets or tier.get("targets", ["r_at_scale"]))
    requested_ids = set(scenario_ids or [])
    execution_tier = tier
    if requested_ids:
        # Explicit scenario selection is also the sharding interface and must
        # be able to run a cell outside the tier's default representative set.
        execution_tier = dict(tier)
        execution_tier["method_scenarios"] = {}
    scenarios = []
    for scenario in config["scenarios"]:
        if requested_ids:
            if scenario["id"] not in requested_ids:
                continue
        elif tier_name == "pr" and "pr" not in scenario.get("tags", []):
            continue
        scenarios.append(scenario)
    missing = requested_ids - {scenario["id"] for scenario in scenarios}
    if missing:
        raise ValueError(f"Unknown scenario ids: {', '.join(sorted(missing))}.")

    results = []
    for scenario in scenarios:
        if scenario["kind"] in {"weibull_mixture", "weibull_competing_risks"}:
            results.append(_run_special_scenario(
                scenario, execution_tier, selected_methods, seed_offset,
                replicate_override, bootstrap_override, evidence_mode,
            ))
        else:
            results.append(_run_lifetime_scenario(
                scenario, execution_tier, selected_methods, selected_targets, seed_offset,
                replicate_override, bootstrap_override, evidence_mode,
            ))
    elapsed_seconds = time.perf_counter() - started
    return {
        "schema_version": 1,
        "tier": tier_name,
        "nominal_coverage": float(tier.get("nominal_coverage", 0.90)),
        "tier_configuration": dict(tier),
        "methods": selected_methods,
        "targets": selected_targets,
        "seed_offset": int(seed_offset),
        "seed_policy": (
            "numpy.SeedSequence keyed by scenario id, configured seed_base, "
            "seed_offset, outer replicate, and simulation stage; methods and "
            "targets share each outer dataset for paired comparisons"
        ),
        "evidence_mode": evidence_mode,
        "replicate_override": (
            int(replicate_override) if replicate_override is not None else None
        ),
        "bootstrap_resample_override": (
            int(bootstrap_override) if bootstrap_override is not None else None
        ),
        "scenario_count": len(results),
        "elapsed_seconds": elapsed_seconds,
        "provenance": _software_provenance(),
        "disclosure": (
            "PR-tier results are deterministic functional guards, not empirical "
            "coverage claims. Coverage classifications require the configured "
            "nightly or release replication counts."
        ),
        "results": results,
    }


def _parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--tier", choices=("pr", "nightly", "release"), default="pr")
    parser.add_argument("--scenario", action="append", dest="scenarios")
    parser.add_argument("--method", action="append", dest="methods",
                        choices=sorted(SUPPORTED_METHODS))
    parser.add_argument("--target", action="append", dest="targets",
                        choices=("r_at_scale", "b10_life", "r_0_95"))
    parser.add_argument("--replicates", type=int)
    parser.add_argument("--bootstrap-resamples", type=int)
    parser.add_argument("--seed-offset", type=int, default=0)
    parser.add_argument("--output", type=Path)
    return parser


def main(argv=None):
    args = _parser().parse_args(argv)
    if args.replicates is not None and args.replicates <= 0:
        raise SystemExit("--replicates must be positive.")
    if (args.bootstrap_resamples is not None
            and not 20 <= args.bootstrap_resamples <= 2000):
        raise SystemExit("--bootstrap-resamples must be from 20 to 2000.")
    result = run_matrix(
        load_config(args.config),
        tier_name=args.tier,
        scenario_ids=args.scenarios,
        methods=args.methods,
        targets=args.targets,
        seed_offset=args.seed_offset,
        replicate_override=args.replicates,
        bootstrap_override=args.bootstrap_resamples,
    )
    payload = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.output is None:
        print(payload, end="")
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload, encoding="utf-8")


if __name__ == "__main__":
    main()
