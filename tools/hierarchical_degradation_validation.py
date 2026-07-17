#!/usr/bin/env python3
"""Run the hierarchical degradation recovery and coverage matrix.

The PR profile is intentionally tiny.  Nightly and release profiles expand
the complete unit-count/read-count/error/heterogeneity/censoring factorial and
must be run explicitly; they are not part of pytest.
"""

from __future__ import annotations

import argparse
import datetime as dt
import importlib.metadata
import json
import math
import os
import platform
import sys
import time
from collections import Counter
from itertools import product
from pathlib import Path

import numpy as np
import scipy
from scipy.stats import norm


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "gui" / "backend"
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(ROOT / "src"))
os.environ.setdefault("MPLCONFIGDIR", "/tmp/matplotlib")

from routers.alt import degradation  # noqa: E402
from schemas import DegradationRequest  # noqa: E402


DEFAULT_CONFIG = Path(__file__).with_name("hierarchical_degradation_validation.json")


def load_config(path=DEFAULT_CONFIG):
    with Path(path).open("r", encoding="utf-8") as handle:
        config = json.load(handle)
    validate_config(config)
    return config


def validate_config(config):
    if config.get("schema_version") != 1:
        raise ValueError("Hierarchical validation config schema_version must be 1.")
    profiles = config.get("profiles", {})
    if set(profiles) != {"pr", "nightly", "release"}:
        raise ValueError("Profiles must define pr, nightly, and release tiers.")
    for name, profile in profiles.items():
        if int(profile.get("replicates", 0)) <= 0:
            raise ValueError(f"Profile {name!r} requires positive replicates.")
        if int(profile.get("bootstrap_resamples", -1)) < 0:
            raise ValueError(f"Profile {name!r} requires non-negative bootstrap_resamples.")
        bootstrap_resamples = int(profile["bootstrap_resamples"])
        if 0 < bootstrap_resamples < 20:
            raise ValueError(
                f"Profile {name!r} bootstrap_resamples must be 0 or at least 20.")
        if int(profile.get("monte_carlo_samples", 0)) < 1000:
            raise ValueError(f"Profile {name!r} requires at least 1000 Monte Carlo samples.")
    matrix = config.get("matrix", {})
    if set(matrix.get("models", {})) != {"linear", "exponential"}:
        raise ValueError("Matrix must configure linear and exponential models.")
    if set(matrix.get("right_censoring_targets", [])) != {0.0, 0.5}:
        raise ValueError("Matrix must include 0% and 50% right-censoring targets.")


def expand_scenarios(config):
    matrix = config["matrix"]
    scenarios = []
    axes = product(
        matrix["models"], matrix["unit_counts"], matrix["readings_per_unit"],
        matrix["error_levels"], matrix["heterogeneity_levels"],
        matrix["right_censoring_targets"],
    )
    for index, (model, n_units, readings, error, heterogeneity, censoring) in enumerate(axes):
        model_config = matrix["models"][model]
        censor_label = int(round(100.0 * censoring))
        scenarios.append({
            "id": (f"{model}-u{n_units}-r{readings}-error_{error}-"
                   f"hetero_{heterogeneity}-censor_{censor_label}"),
            "index": index,
            "model": model,
            "n_units": int(n_units),
            "readings_per_unit": int(readings),
            "error_level": error,
            "heterogeneity_level": heterogeneity,
            "right_censoring_target": float(censoring),
            "mean_intercept": float(model_config["mean_intercept"]),
            "mean_log_slope": float(model_config["mean_log_slope"]),
            "threshold": float(model_config["threshold"]),
            "residual_sigma": float(model_config["residual_error"][error]),
            "sd_intercept": float(model_config["intercept_sd"][heterogeneity]),
            "sd_log_slope": float(matrix["log_slope_sd"][heterogeneity]),
            "correlation": float(matrix["random_effect_correlation"]),
        })
    return scenarios


def _population_covariance(scenario):
    return np.asarray([
        [scenario["sd_intercept"] ** 2,
         scenario["correlation"] * scenario["sd_intercept"] * scenario["sd_log_slope"]],
        [scenario["correlation"] * scenario["sd_intercept"] * scenario["sd_log_slope"],
         scenario["sd_log_slope"] ** 2],
    ])


def _life_samples(scenario, rng, size):
    effects = rng.multivariate_normal(
        [scenario["mean_intercept"], scenario["mean_log_slope"]],
        _population_covariance(scenario), size=size)
    threshold = (scenario["threshold"] if scenario["model"] == "linear"
                 else math.log(scenario["threshold"]))
    margin = threshold - effects[:, 0]
    lives = np.zeros(size)
    safe = margin > 0
    lives[safe] = margin[safe] / np.exp(np.clip(effects[safe, 1], -700, 700))
    return lives


def _scenario_truth(scenario, base_seed):
    rng = np.random.default_rng(np.random.SeedSequence(
        [base_seed, scenario["index"], 99173]))
    lives = _life_samples(scenario, rng, 200_000)
    censoring_target = scenario["right_censoring_target"]
    # A finite horizon cannot give mathematically exact zero censoring for the
    # log-slope population.  Use a one-in-100,000 tail so the nominal 0% cell
    # is operationally uncensored even at the largest configured unit count.
    horizon_quantile = 0.99999 if censoring_target == 0.0 else 0.5
    horizon = float(np.quantile(lives, horizon_quantile))
    return {
        "mean_intercept": scenario["mean_intercept"],
        "mean_log_slope": scenario["mean_log_slope"],
        "sd_intercept": scenario["sd_intercept"],
        "sd_log_slope": scenario["sd_log_slope"],
        "correlation": scenario["correlation"],
        "residual_sigma": scenario["residual_sigma"],
        "B10": float(np.quantile(lives, 0.10)),
        "B50": float(np.quantile(lives, 0.50)),
        "reliability_at_horizon": float(np.mean(lives > horizon)),
        "observation_horizon": horizon,
    }


def _simulate_request(scenario, truth, rng, *, confidence, n_monte_carlo,
                      n_bootstrap, fit_seed):
    effects = rng.multivariate_normal(
        [scenario["mean_intercept"], scenario["mean_log_slope"]],
        _population_covariance(scenario), size=scenario["n_units"])
    times = np.linspace(
        0.0, truth["observation_horizon"], scenario["readings_per_unit"])
    unit_ids = []
    observation_times = []
    measurements = []
    observed_right_censored = 0
    for index, (intercept, log_slope) in enumerate(effects):
        response = intercept + math.exp(log_slope) * times
        response += rng.normal(0.0, scenario["residual_sigma"], len(times))
        values = response if scenario["model"] == "linear" else np.exp(response)
        crossed = values >= scenario["threshold"]
        if np.any(crossed):
            stop = int(np.flatnonzero(crossed)[0]) + 1
        else:
            stop = len(times)
            observed_right_censored += 1
        unit_ids.extend([f"U{index}"] * stop)
        observation_times.extend(times[:stop].tolist())
        measurements.extend(values[:stop].tolist())
    request = DegradationRequest(
        unit_ids=unit_ids,
        times=observation_times,
        measurements=measurements,
        threshold=scenario["threshold"],
        threshold_direction="above",
        degradation_model=scenario["model"],
        analysis_method="hierarchical_nlme",
        reliability_time=truth["observation_horizon"],
        ci=confidence,
        n_monte_carlo=n_monte_carlo,
        n_bootstrap=n_bootstrap,
        seed=fit_seed,
    )
    return request, observed_right_censored / scenario["n_units"]


def _wilson(successes, trials, confidence=0.95):
    if trials <= 0:
        return None
    estimate = successes / trials
    z = float(norm.ppf(0.5 + confidence / 2.0))
    denominator = 1.0 + z * z / trials
    center = (estimate + z * z / (2.0 * trials)) / denominator
    radius = z * math.sqrt(
        estimate * (1.0 - estimate) / trials + z * z / (4.0 * trials * trials)
    ) / denominator
    return [max(0.0, center - radius), min(1.0, center + radius)]


def _recovery(records, truth):
    output = {}
    for key, true_value in truth.items():
        values = [record[key] for record in records if record.get(key) is not None]
        if not values or not isinstance(true_value, (int, float)):
            continue
        errors = np.asarray(values) - true_value
        output[key] = {
            "truth": float(true_value),
            "mean_estimate": float(np.mean(values)),
            "bias": float(np.mean(errors)),
            "rmse": float(np.sqrt(np.mean(errors ** 2))),
            "completed": len(values),
        }
    return output


def _coverage_classification(covered, denominator, nominal):
    if denominator < 100:
        return "insufficient_replicates"
    interval = _wilson(covered, denominator)
    if interval[0] >= nominal - 0.03:
        return "supported"
    if interval[1] < nominal - 0.05:
        return "deficient"
    return "inconclusive"


def _coverage(interval_records, truth, nominal, requested):
    output = {}
    for key in ("mean_log_slope", "B10", "B50", "reliability_at_horizon"):
        diagnostic_available = [
            record for record in interval_records if record.get(key) is not None
        ]
        available = [
            record for record in diagnostic_available
            if record.get("interval_status") == "complete"
        ]
        eligible_records = [record for record in interval_records if record["fit_eligible"]]
        eligible_available = [
            record for record in eligible_records
            if record.get(key) is not None
            and record.get("interval_status") == "complete"
        ]
        covered = sum(
            record[key][0] <= truth[key] <= record[key][1] for record in available)
        eligible_covered = sum(
            record[key][0] <= truth[key] <= record[key][1]
            for record in eligible_available)
        output[key] = {
            "nominal": nominal,
            "requested": requested,
            "available": len(available),
            "diagnostic_intervals_available": len(diagnostic_available),
            "covered": covered,
            "conditional_on_available": {
                "denominator": len(available),
                "coverage": covered / len(available) if available else None,
                "wilson_95": _wilson(covered, len(available)),
            },
            "unconditional": {
                "denominator": requested,
                "coverage": covered / requested,
                "wilson_95": _wilson(covered, requested),
                "classification": _coverage_classification(
                    covered, requested, nominal),
            },
            "conditional_on_eligible": {
                "eligible_fits": len(eligible_records),
                "intervals_available": len(eligible_available),
                "covered": eligible_covered,
                "coverage_given_available": (
                    eligible_covered / len(eligible_available)
                    if eligible_available else None),
                "coverage_over_eligible_fits": (
                    eligible_covered / len(eligible_records)
                    if eligible_records else None),
                "wilson_95_given_available": _wilson(
                    eligible_covered, len(eligible_available)),
            },
        }
    return output


def _run_scenario(scenario, *, replicates, bootstrap_resamples,
                  monte_carlo_samples, nominal_coverage, base_seed,
                  include_replicates):
    started = time.perf_counter()
    truth = _scenario_truth(scenario, base_seed)
    point_records = []
    interval_records = []
    details = []
    errors = Counter()
    converged = eligible = bootstrap_success = 0
    censoring = []
    for replicate in range(replicates):
        sequence = np.random.SeedSequence([base_seed, scenario["index"], replicate])
        simulation_seed, fit_seed_sequence = sequence.spawn(2)
        rng = np.random.default_rng(simulation_seed)
        fit_seed = int(fit_seed_sequence.generate_state(1, dtype=np.uint32)[0])
        request, realized_censoring = _simulate_request(
            scenario, truth, rng, confidence=nominal_coverage,
            n_monte_carlo=monte_carlo_samples,
            n_bootstrap=bootstrap_resamples, fit_seed=fit_seed)
        censoring.append(realized_censoring)
        try:
            result = degradation(request)
            fit = result["hierarchical_fit"]
            converged += int(fit["converged"])
            eligible += int(fit["fit_eligible"])
            population = fit["population_parameters"]
            random_effects = fit["random_effects"]
            life = fit["life_distribution"]
            point = {
                "mean_intercept": population["mean_intercept"],
                "mean_log_slope": population["mean_log_slope"],
                "sd_intercept": random_effects["sd_intercept"],
                "sd_log_slope": random_effects["sd_log_slope"],
                "correlation": random_effects["correlation"],
                "residual_sigma": fit["residual_sigma"],
                "B10": life["summary"]["B10"],
                "B50": life["summary"]["B50"],
                "reliability_at_horizon": life["reliability"]["R"],
            }
            point_records.append(point)
            uncertainty = fit["uncertainty"]
            bootstrap_success += uncertainty["diagnostics"]["successful"]
            intervals = {
                "mean_log_slope": uncertainty["parameter_intervals"].get("mean_log_slope"),
                "B10": uncertainty["summary_intervals"].get("B10"),
                "B50": uncertainty["summary_intervals"].get("B50"),
                "reliability_at_horizon": uncertainty["reliability_interval"],
                "fit_eligible": fit["fit_eligible"],
                "interval_status": uncertainty["diagnostics"]["status"],
            }
            interval_records.append(intervals)
            detail = {
                "replicate": replicate,
                "fit_seed": fit_seed,
                "converged": fit["converged"],
                "fit_eligible": fit["fit_eligible"],
                "realized_right_censoring": realized_censoring,
                "point_estimates": point,
                "intervals": intervals,
                "bootstrap_diagnostics": uncertainty["diagnostics"],
                "identifiability_warnings": fit["diagnostics"]["identifiability_warnings"],
            }
            if include_replicates:
                details.append(detail)
        except Exception as exc:  # validation runner records, rather than hides, failures
            errors[f"{type(exc).__name__}: {exc}"] += 1
            if include_replicates:
                details.append({
                    "replicate": replicate, "fit_seed": fit_seed,
                    "realized_right_censoring": realized_censoring,
                    "error": f"{type(exc).__name__}: {exc}",
                })

    result = {
        "scenario": scenario,
        "truth": truth,
        "requested": replicates,
        "completed": len(point_records),
        "completion_rate": len(point_records) / replicates,
        "converged": converged,
        "convergence_rate": converged / replicates,
        "fit_eligible": eligible,
        "fit_eligibility_rate": eligible / replicates,
        "mean_realized_right_censoring": float(np.mean(censoring)),
        "bootstrap_requested": replicates * bootstrap_resamples,
        "bootstrap_successful": bootstrap_success,
        "recovery": _recovery(point_records, truth),
        "coverage": _coverage(
            interval_records, truth, nominal_coverage, replicates),
        "errors": dict(errors),
        "elapsed_seconds": time.perf_counter() - started,
    }
    if include_replicates:
        result["replicates"] = details
    return result


def run_matrix(config, *, profile_name="pr", scenario_ids=None,
               replicate_override=None, bootstrap_override=None,
               monte_carlo_override=None, seed=20260713,
               include_replicates=True):
    started = time.perf_counter()
    validate_config(config)
    profile = dict(config["profiles"][profile_name])
    replicates = int(replicate_override or profile["replicates"])
    bootstrap = int(profile["bootstrap_resamples"]
                    if bootstrap_override is None else bootstrap_override)
    monte_carlo = int(monte_carlo_override or profile["monte_carlo_samples"])
    all_scenarios = expand_scenarios(config)
    selected_ids = scenario_ids or profile.get("scenario_ids")
    if selected_ids:
        selected = set(selected_ids)
        scenarios = [item for item in all_scenarios if item["id"] in selected]
        missing = selected - {item["id"] for item in scenarios}
        if missing:
            raise ValueError(f"Unknown scenario ids: {sorted(missing)}")
    else:
        scenarios = all_scenarios

    results = [
        _run_scenario(
            scenario, replicates=replicates,
            bootstrap_resamples=bootstrap,
            monte_carlo_samples=monte_carlo,
            nominal_coverage=config["nominal_coverage"],
            base_seed=seed, include_replicates=include_replicates)
        for scenario in scenarios
    ]
    classification_counts = Counter(
        target["unconditional"]["classification"]
        for result in results
        for target in result["coverage"].values()
    )
    if classification_counts.get("deficient", 0):
        validation_status = "deficient"
    elif classification_counts and set(classification_counts) == {"supported"}:
        validation_status = "supported"
    elif classification_counts and set(classification_counts) == {
            "insufficient_replicates"}:
        validation_status = "functional_only"
    else:
        validation_status = "inconclusive"
    return {
        "schema_version": 1,
        "validation_profile": profile_name,
        "seed": seed,
        "seed_policy": (
            "SeedSequence([base_seed, scenario_index, replicate]); independent "
            "spawned streams for data generation, point Monte Carlo, bootstrap "
            "simulation, and bootstrap life evaluation"),
        "generated_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "software": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "numpy": np.__version__,
            "scipy": scipy.__version__,
            "reliability": importlib.metadata.version("reliability"),
        },
        "configuration": {
            "replicates": replicates,
            "bootstrap_resamples": bootstrap,
            "monte_carlo_samples": monte_carlo,
            "nominal_coverage": config["nominal_coverage"],
        },
        "scenario_count": len(scenarios),
        "results": results,
        "validation_status": validation_status,
        "coverage_classification_counts": dict(classification_counts),
        "elapsed_seconds": time.perf_counter() - started,
    }


def _parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--profile", choices=("pr", "nightly", "release"), default="pr")
    parser.add_argument("--scenario-id", action="append", dest="scenario_ids")
    parser.add_argument("--replicates", type=int)
    parser.add_argument("--bootstrap-resamples", type=int)
    parser.add_argument("--monte-carlo-samples", type=int)
    parser.add_argument("--seed", type=int, default=20260713)
    parser.add_argument("--summary-only", action="store_true")
    parser.add_argument("--output", type=Path)
    return parser


def main():
    args = _parser().parse_args()
    result = run_matrix(
        load_config(args.config), profile_name=args.profile,
        scenario_ids=args.scenario_ids, replicate_override=args.replicates,
        bootstrap_override=args.bootstrap_resamples,
        monte_carlo_override=args.monte_carlo_samples, seed=args.seed,
        include_replicates=not args.summary_only)
    encoded = json.dumps(result, indent=2, allow_nan=False) + "\n"
    if args.output is None:
        print(encoded, end="")
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
