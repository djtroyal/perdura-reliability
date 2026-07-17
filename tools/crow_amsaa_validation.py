#!/usr/bin/env python3
"""Independent Crow-AMSAA benchmark and coverage validation.

This tool intentionally combines published numeric fixtures, likelihood-score
checks, unit-equivariance checks, invalid-input probes, and seeded simulation.
Expected benchmark values are literals from independently worked examples; they
are not recomputed with the production equations under test.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import platform
import subprocess
import sys
import time

import numpy as np
import scipy


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from reliability.Repairable_systems import (  # noqa: E402
    CrowAMSAA,
    CrowAMSAAGrouped,
    MCF_nonparametric,
    MCF_parametric,
)


# MIL-HDBK-189 (1981), Appendix C, individual failure-time example.  These
# 27 printed times must not be mislabeled as the MIL-HDBK-189C section 6.2.2.9
# example: 189C says that example has F=45, but its printed Table VI contains
# only these 27 rows and cannot reproduce the section's published estimates.
MIL_1981_APPENDIX_C_TIMES = [
    2.6, 16.5, 16.5, 17.0, 21.4, 29.1, 33.3, 56.5, 63.1,
    70.6, 73.0, 77.7, 93.9, 95.5, 98.1, 101.1, 132.0, 142.2,
    147.7, 149.0, 167.2, 190.7, 193.0, 198.7, 251.9, 282.5, 286.1,
]
NIST_TIMES = [5, 40, 43, 175, 389, 712, 747, 795, 1299, 1478]
NASA_CROW_TIME_TIMES = [
    .2, 4.2, 4.5, 5.0, 5.4, 6.1, 7.9, 14.8, 19.2, 48.6,
    85.8, 108.9, 127.2, 129.8, 150.1, 159.7, 227.4, 244.7,
    262.7, 315.3, 329.6, 404.3, 486.2,
]


def _close(actual, expected, *, rtol=5e-6, atol=1e-9) -> bool:
    return bool(np.isclose(float(actual), float(expected), rtol=rtol, atol=atol))


def _check(name: str, actual, expected, passed: bool) -> dict:
    return {
        "name": name,
        "actual": actual,
        "expected": expected,
        "passed": bool(passed),
    }


def exact_published_benchmarks() -> list[dict]:
    rows: list[dict] = []

    mil = CrowAMSAA(
        MIL_1981_APPENDIX_C_TIMES, T=300.0, failure_terminated=False,
        CI=.90, estimator="mle",
    )
    for name, actual, expected in (
        ("MIL-HDBK-189 (1981) Appendix C beta", mil.beta, 0.7163392624),
        ("MIL-HDBK-189 (1981) Appendix C Lambda", mil.Lambda, 0.4538418614),
        ("MIL-HDBK-189 (1981) Appendix C endpoint intensity",
         mil.instantaneous_failure_intensity,
         0.0644705336),
        ("MIL-HDBK-189 (1981) Appendix C endpoint MTBF",
         mil.instantaneous_MTBF, 15.5109620),
        ("MIL-HDBK-189 (1981) Appendix C CvM", mil.CvM, 0.0910611),
    ):
        rows.append(_check(name, actual, expected, _close(actual, expected)))
    rows.append(_check(
        "MIL-HDBK-189 (1981) Appendix C rounded tie accepted",
        bool(mil.has_tied_times),
        True, bool(mil.has_tied_times),
    ))

    nasa_crow = CrowAMSAA(
        NASA_CROW_TIME_TIMES, T=500.0, failure_terminated=False, CI=.80)
    for name, actual, expected in (
        ("NASA/Crow time MTBF lower coefficient",
         nasa_crow.instantaneous_MTBF_lower
         / nasa_crow.instantaneous_MTBF_mle, 0.6762),
        ("NASA/Crow time MTBF upper coefficient",
         nasa_crow.instantaneous_MTBF_upper
         / nasa_crow.instantaneous_MTBF_mle, 1.5744),
    ):
        rows.append(_check(
            name, actual, expected,
            _close(actual, expected, rtol=8e-5, atol=5e-5),
        ))

    nasa_n27 = CrowAMSAA(
        np.geomspace(1.0, 900.0, 27), T=1000.0,
        failure_terminated=False, CI=.90)
    for name, actual, expected in (
        ("NASA/Crow n=27 90% lower coefficient",
         nasa_n27.instantaneous_MTBF_lower
         / nasa_n27.instantaneous_MTBF_mle, 0.6361467),
        ("NASA/Crow n=27 90% upper coefficient",
         nasa_n27.instantaneous_MTBF_upper
         / nasa_n27.instantaneous_MTBF_mle, 1.6817864),
    ):
        rows.append(_check(
            name, actual, expected,
            _close(actual, expected, rtol=8e-7, atol=5e-7),
        ))

    nist = CrowAMSAA(
        NIST_TIMES, T=1500.0, failure_terminated=False,
        estimator="modified_mle",
    )
    for name, actual, expected in (
        ("NIST modified beta", nist.beta, 0.483506),
        ("NIST modified Lambda", nist.Lambda, 0.291300),
        ("NIST modified current MTBF", nist.instantaneous_MTBF, 310.234),
    ):
        rows.append(_check(
            name, actual, expected,
            _close(actual, expected, rtol=2e-5, atol=2e-5),
        ))

    return rows


def grouped_published_benchmarks() -> list[dict]:
    rows: list[dict] = []

    grouped = CrowAMSAAGrouped(
        interval_ends=[20, 40, 60, 80, 100],
        failure_counts=[13, 16, 5, 8, 7],
        CI=.90, significance=.10,
    )
    for name, actual, expected in (
        ("MIL grouped beta", grouped.beta, 0.752851),
        ("MIL grouped Lambda", grouped.Lambda, 1.529306),
        ("MIL grouped endpoint intensity",
         grouped.instantaneous_failure_intensity, 0.3688969345),
        ("MIL grouped endpoint MTBF", grouped.instantaneous_MTBF, 2.71078425),
        ("MIL grouped final-interval average intensity",
         grouped.last_interval_average_failure_intensity, 0.3788703065),
        ("MIL grouped final-interval average MTBF",
         grouped.last_interval_average_MTBF, 2.63942564),
    ):
        rows.append(_check(
            name, actual, expected,
            _close(actual, expected, rtol=3e-5, atol=2e-6),
        ))
    rows.append(_check(
        "MIL grouped final-interval MTBF interval available",
        grouped.last_interval_average_MTBF_interval_status,
        "approximate_grouped_handbook_interval",
        grouped.last_interval_average_MTBF_lower
        < grouped.last_interval_average_MTBF
        < grouped.last_interval_average_MTBF_upper,
    ))

    return rows


def published_benchmarks() -> list[dict]:
    """All published Crow fixtures; assurance uses procedure-specific nodes."""
    return exact_published_benchmarks() + grouped_published_benchmarks()


def estimating_equation_checks() -> list[dict]:
    """Synthetic independent-score checks, separate from published fixtures."""
    rows: list[dict] = []
    pooled = MCF_parametric(
        data=[[.5, 1, 1.5, 2, 3], [50]],
        observation_ends=[4, 100],
    )
    for name, key, expected in (
        ("Unequal-exposure pooled beta", "beta", 0.3443837165829547),
        ("Unequal-exposure pooled Lambda", "Lambda", 0.9236718623385327),
        ("Unequal-exposure pooled alpha", "alpha", 1.2592951066203177),
    ):
        actual = pooled[key]
        rows.append(_check(name, actual, expected, _close(actual, expected, rtol=1e-8)))
    pooled_beta = float(pooled["beta"])
    pooled_events = np.array([.5, 1., 1.5, 2., 3., 50.])
    pooled_ends = np.array([4., 100.])
    exposure = pooled_ends ** pooled_beta
    # Recompute the score independently instead of trusting the diagnostic
    # returned by production code.
    score = (
        len(pooled_events) / pooled_beta
        + float(np.sum(np.log(pooled_events)))
        - len(pooled_events) * float(
            np.dot(exposure, np.log(pooled_ends)) / np.sum(exposure)
        )
    )
    rows.append(_check(
        "Independently recomputed unequal-exposure profile score",
        score, "absolute value < 1e-8",
        score is not None and abs(float(score)) < 1e-8,
    ))
    return rows


def numerical_contracts() -> list[dict]:
    rows: list[dict] = []
    base_times = np.array([1.0, 2.0, 4.0, 8.0])
    base = CrowAMSAA(base_times, T=16.0, failure_terminated=False)
    for scale in (1e-6, 1e6):
        scaled = CrowAMSAA(
            base_times * scale, T=16.0 * scale,
            failure_terminated=False,
        )
        passed = (
            _close(scaled.beta, base.beta, rtol=1e-11)
            and _close(scaled.CvM, base.CvM, rtol=1e-11)
            and _close(scaled.instantaneous_MTBF,
                       base.instantaneous_MTBF * scale, rtol=1e-10)
            and _close(scaled.cumulative_MTBF,
                       base.cumulative_MTBF * scale, rtol=1e-10)
        )
        rows.append(_check(
            f"Unit equivariance x{scale:g}",
            {
                "beta": scaled.beta,
                "CvM": scaled.CvM,
                "instantaneous_MTBF": scaled.instantaneous_MTBF,
            },
            "shape/GoF invariant; time metrics scale linearly", passed,
        ))

    invalid_cases = [
        ([1, np.nan, 3], 4),
        ([1, np.inf, 3], 4),
        ([0, 1, 2], 3),
        ([[1, 2], [3, 4]], 5),
        ([1, 3, 2], 4),
    ]
    for index, (times, end) in enumerate(invalid_cases):
        try:
            CrowAMSAA(times, T=end, failure_terminated=False)
        except (TypeError, ValueError):
            passed = True
        else:
            passed = False
        rows.append(_check(
            f"Invalid input case {index + 1} fails closed", passed, True, passed,
        ))

    # A deliberately two-phase history should not receive a silent visual
    # blessing from a single power law. Its statistic exceeds even the most
    # permissive supported 5% CvM critical value (0.220 for large M).
    phase_change = CrowAMSAA(
        list(range(1, 11)) + list(range(900, 910)),
        T=1000, failure_terminated=False,
    )
    rows.append(_check(
        "Gross phase change triggers model-misfit diagnostic",
        phase_change.CvM, "greater than 0.220",
        phase_change.CvM > .220,
    ))

    # Smallest supported exact-event regimes exercise the termination-specific
    # pivots and the modified-MLE boundary without relying on simulation skips.
    for label, fit in (
        ("time-terminated n=2", CrowAMSAA(
            [1.0, 2.0], T=3.0, failure_terminated=False)),
        ("failure-terminated n=2", CrowAMSAA(
            [1.0, 2.0], failure_terminated=True)),
        ("failure-terminated modified-MLE n=3", CrowAMSAA(
            [1.0, 2.0, 4.0], failure_terminated=True,
            estimator="modified_mle")),
    ):
        ordered = (
            np.isfinite(fit.beta_lower)
            and np.isfinite(fit.beta_upper)
            and fit.beta_lower < fit.beta_mle < fit.beta_upper
            and np.isfinite(fit.instantaneous_MTBF_lower)
            and np.isfinite(fit.instantaneous_MTBF_upper)
            and fit.instantaneous_MTBF_lower
            < fit.instantaneous_MTBF_mle
            < fit.instantaneous_MTBF_upper
        )
        rows.append(_check(
            f"Boundary contract {label}", ordered, True, bool(ordered)))
    try:
        CrowAMSAA(
            [1.0, 2.0], failure_terminated=True,
            estimator="modified_mle")
    except ValueError:
        boundary_rejected = True
    else:
        boundary_rejected = False
    rows.append(_check(
        "Failure-terminated modified MLE n=2 fails closed",
        boundary_rejected, True, boundary_rejected))

    return rows


def mcf_numerical_contracts() -> list[dict]:
    """MCF uncertainty fail-closed and profile-likelihood contracts."""
    rows: list[dict] = []
    one_system = MCF_nonparametric(
        [[1.0, 2.0]], observation_ends=[3.0])
    rows.append(_check(
        "One-system MCF uncertainty is unavailable",
        {
            "variance_available": one_system["variance_available"],
            "interval_available": one_system["interval_available"],
        },
        {"variance_available": False, "interval_available": False},
        (one_system["variance_available"] is False
         and one_system["interval_available"] is False
         and all(value is None for value in one_system["MCF_lower"])),
    ))
    try:
        MCF_nonparametric(
            [[1.0], [2.0]], observation_ends=[3.0, 3.0],
            interval_method="cluster_bootstrap", bootstrap_samples=0)
    except ValueError:
        bootstrap_rejected = True
    else:
        bootstrap_rejected = False
    rows.append(_check(
        "Selected MCF bootstrap without replicates fails closed",
        bootstrap_rejected, True, bootstrap_rejected))

    pooled = MCF_parametric(
        data=[[.5, 1, 1.5, 2, 3], [50]],
        observation_ends=[4, 100], CI=.90)
    profile_ordered = (
        pooled["beta_lower"] < pooled["beta"] < pooled["beta_upper"]
        and pooled["endpoint_MCF_lower"]
        < pooled["endpoint_MCF"]
        < pooled["endpoint_MCF_upper"]
    )
    rows.append(_check(
        "Pooled MCF profile intervals bracket their estimates",
        profile_ordered, True, profile_ordered))
    return rows


def _simulate_time_terminated(rng, beta: float, expected_count: float,
                               T: float) -> tuple[np.ndarray, float]:
    # A fixed-time validation must include Poisson count variation; conditioning
    # on n would remove scale information and make the joint intensity interval
    # appear artificially conservative.
    n = int(rng.poisson(expected_count))
    fractions = np.sort(rng.uniform(size=n))
    return T * fractions ** (1 / beta), expected_count / T ** beta


def _simulate_failure_terminated(rng, beta: float, Lambda: float,
                                  n: int) -> tuple[np.ndarray, float]:
    transformed = np.cumsum(rng.exponential(size=n))
    times = (transformed / Lambda) ** (1 / beta)
    return times, float(times[-1])


def coverage_matrix(replicates: int, seed: int) -> list[dict]:
    seed_sequence = np.random.SeedSequence(seed)
    scenarios = [
        ("time", beta, expected_count)
        for beta in (.5, 1.0, 1.8)
        for expected_count in (10, 30)
    ] + [
        ("failure", beta, n)
        for beta in (.5, 1.0, 1.8)
        for n in (5, 20)
    ]
    rows: list[dict] = []
    for (termination, beta, information), child_seed in zip(
            scenarios, seed_sequence.spawn(len(scenarios))):
        rng = np.random.default_rng(child_seed)
        beta_hits = 0
        mtbf_hits = 0
        completed = 0
        for _ in range(replicates):
            if termination == "time":
                T = 100.0
                times, true_Lambda = _simulate_time_terminated(
                    rng, beta, information, T)
                n = len(times)
                if n < 2:
                    continue
                failure_terminated = False
            else:
                n = int(information)
                true_Lambda = .2
                times, T = _simulate_failure_terminated(
                    rng, beta, true_Lambda, n)
                failure_terminated = True
            try:
                fit = CrowAMSAA(
                    times, T=T, failure_terminated=failure_terminated,
                    CI=.95, estimator="mle",
                )
            except (FloatingPointError, OverflowError, ValueError):
                continue
            completed += 1
            beta_hits += int(fit.beta_lower <= beta <= fit.beta_upper)
            true_mtbf = 1 / (true_Lambda * beta * T ** (beta - 1))
            mtbf_hits += int(
                fit.instantaneous_MTBF_lower <= true_mtbf
                <= fit.instantaneous_MTBF_upper
            )
        completion = completed / replicates
        beta_coverage = beta_hits / completed if completed else None
        mtbf_coverage = mtbf_hits / completed if completed else None
        # Exact beta pivots should be close to nominal. Failure-terminated
        # current-MTBF limits use the exact independent-Gamma product pivot;
        # fixed-time limits use Crow's conservative Bessel/Poisson-mixture
        # coefficients and are calibrated here over the Poisson event count.
        beta_pass = bool(
            completion >= .99 and beta_coverage is not None
            and abs(beta_coverage - .95) <= .025
        )
        mtbf_certifying = True
        mtbf_pass = bool(
            not mtbf_certifying or (
                completion >= .99 and mtbf_coverage is not None
                and abs(mtbf_coverage - .95) <= .035
            )
        )
        rows.append({
            "termination": termination,
            "beta_true": beta,
            "information_target": information,
            "information_definition": (
                "expected_count" if termination == "time" else "failure_count"
            ),
            "coverage_population": (
                "unconditional_over_poisson_count_and_event_times"
                if termination == "time"
                else "failure_terminated_fixed_count"
            ),
            "replicates_requested": replicates,
            "replicates_completed": completed,
            "completion_rate": completion,
            "beta_interval_coverage": beta_coverage,
            "instantaneous_mtbf_interval_coverage": mtbf_coverage,
            "mtbf_certifying": mtbf_certifying,
            "passed": beta_pass and mtbf_pass,
        })
    return rows


def grouped_coverage_matrix(replicates: int, seed: int) -> list[dict]:
    """Calibrate grouped beta profile limits and Pearson GOF behavior."""
    # Grouped fitting requires a numerical profile optimization. Two thousand
    # replicates per cell give about 0.5 percentage-point Monte Carlo standard
    # error at 95% coverage without making the release gate impractical.
    grouped_replicates = min(replicates, 2_000)
    ends = np.array([20., 40., 60., 80., 100.])
    starts = np.concatenate(([0.], ends[:-1]))
    scenarios = [
        (beta, expected_count)
        for beta in (.5, 1.0, 1.8)
        for expected_count in (15, 50)
    ]
    rows: list[dict] = []
    seed_sequence = np.random.SeedSequence(seed)
    for (beta, expected_count), child_seed in zip(
            scenarios, seed_sequence.spawn(len(scenarios))):
        rng = np.random.default_rng(child_seed)
        Lambda = expected_count / ends[-1] ** beta
        means = Lambda * (ends ** beta - starts ** beta)
        completed = 0
        beta_hits = 0
        final_interval_mtbf_hits = 0
        final_interval_profile_mtbf_hits = 0
        gof_available = 0
        gof_rejections = 0
        true_final_interval_mtbf = float(
            (ends[-1] - starts[-1])
            / (Lambda * (ends[-1] ** beta - starts[-1] ** beta)))
        for _ in range(grouped_replicates):
            counts = rng.poisson(means)
            try:
                fit = CrowAMSAAGrouped(
                    ends, counts, CI=.95, significance=.10)
            except (FloatingPointError, OverflowError, ValueError):
                continue
            if fit.beta_lower is None or fit.beta_upper is None:
                continue
            completed += 1
            beta_hits += int(fit.beta_lower <= beta <= fit.beta_upper)
            final_interval_mtbf_hits += int(
                fit.last_interval_average_MTBF_lower
                <= true_final_interval_mtbf
                <= fit.last_interval_average_MTBF_upper)
            final_interval_profile_mtbf_hits += int(
                fit.last_interval_average_MTBF_profile_lower
                <= true_final_interval_mtbf
                <= fit.last_interval_average_MTBF_profile_upper)
            if fit.gof_available:
                gof_available += 1
                gof_rejections += int(fit.gof_reject)
        completion = completed / grouped_replicates
        beta_coverage = beta_hits / completed if completed else None
        final_interval_mtbf_coverage = (
            final_interval_mtbf_hits / completed if completed else None)
        final_interval_profile_mtbf_coverage = (
            final_interval_profile_mtbf_hits / completed if completed else None)
        gof_rate = (gof_rejections / gof_available
                    if gof_available else None)
        # GOF is calibrated only in cells where the expected-count pooling
        # leaves enough degrees of freedom in at least 90% of replicates.
        gof_certifying = gof_available >= .90 * grouped_replicates
        passed = bool(
            completion >= .98
            and beta_coverage is not None
            and abs(beta_coverage - .95) <= .035
            # MIL-HDBK-189C labels the grouped final-bin construction
            # approximate; require empirical coverage to stay within five
            # percentage points rather than treating it as an exact pivot.
            and final_interval_mtbf_coverage is not None
            and abs(final_interval_mtbf_coverage - .95) <= .05
            and final_interval_profile_mtbf_coverage is not None
            and abs(final_interval_profile_mtbf_coverage - .95) <= .035
            and (not gof_certifying or (
                gof_rate is not None and abs(gof_rate - .10) <= .04
            ))
        )
        rows.append({
            "termination": "grouped_time",
            "beta_true": beta,
            "expected_total_count": expected_count,
            "replicates_requested": grouped_replicates,
            "replicates_completed": completed,
            "completion_rate": completion,
            "beta_profile_interval_coverage": beta_coverage,
            "final_interval_mtbf_interval_method": (
                "approximate_crow_time_terminated_coefficients"),
            "final_interval_mtbf_coverage": final_interval_mtbf_coverage,
            "final_interval_target_profile_mtbf_coverage": (
                final_interval_profile_mtbf_coverage),
            "gof_available_replicates": gof_available,
            "gof_type_i_error": gof_rate,
            "gof_certifying": gof_certifying,
            "passed": passed,
        })
    return rows


def cvm_calibration(replicates: int, seed: int) -> list[dict]:
    """Check both termination branches and supported significance extremes."""
    calibration_replicates = min(replicates, 5_000)
    # The alpha=.10 rows cover small-to-moderate M.  Alpha=.01 and .20 at
    # representative M=20 explicitly calibrate both newly exposed boundary
    # columns rather than relying only on direct table-lookup tests.
    critical_values = {
        (5, .10): .160,
        (10, .10): .167,
        (20, .10): .172,
        (20, .01): .330,
        (20, .20): .128,
    }
    scenarios = [
        (termination, effective_count, significance, critical)
        for termination in ("time", "failure")
        for (effective_count, significance), critical
        in critical_values.items()
    ]
    seed_sequence = np.random.SeedSequence(seed)
    rows = []
    for (termination, effective_count, significance, critical), child_seed in zip(
            scenarios, seed_sequence.spawn(len(scenarios))):
        rng = np.random.default_rng(child_seed)
        cvm_rejected = 0
        trend_rejected = 0
        for _ in range(calibration_replicates):
            if termination == "time":
                times = np.sort(rng.uniform(size=effective_count)) * 100.0
                fit = CrowAMSAA(
                    times, T=100.0, failure_terminated=False, CI=.95)
            else:
                times = np.concatenate((
                    np.sort(rng.uniform(size=effective_count)) * 100.0,
                    [100.0],
                ))
                fit = CrowAMSAA(
                    times, T=100.0, failure_terminated=True, CI=.95)
            cvm_rejected += int(fit.CvM >= critical)
            trend_rejected += int(fit.trend_p_value < .05)
        cvm_rate = cvm_rejected / calibration_replicates
        trend_rate = trend_rejected / calibration_replicates
        cvm_tolerance = {.01: .012, .10: .035, .20: .04}[significance]
        rows.append({
            "termination": termination,
            "failure_count": (
                effective_count if termination == "time"
                else effective_count + 1
            ),
            "cvm_effective_event_count": effective_count,
            "significance": significance,
            "critical_value": critical,
            "replicates": calibration_replicates,
            "cvm_type_i_error": cvm_rate,
            "cvm_absolute_tolerance": cvm_tolerance,
            "trend_significance": .05,
            "trend_type_i_error": trend_rate,
            "passed": (
                abs(cvm_rate - significance) <= cvm_tolerance
                and abs(trend_rate - .05) <= .03
            ),
        })
    return rows


def trend_power_calibration(replicates: int, seed: int) -> list[dict]:
    """Require the trend test to detect strong growth and deterioration."""
    power_replicates = min(replicates, 2_000)
    scenarios = [
        (termination, beta)
        for termination in ("time", "failure")
        for beta in (.5, 1.8)
    ]
    seed_sequence = np.random.SeedSequence(seed)
    rows = []
    for (termination, beta), child_seed in zip(
            scenarios, seed_sequence.spawn(len(scenarios))):
        rng = np.random.default_rng(child_seed)
        rejected = 0
        correct_direction = 0
        expected_direction = "improving" if beta < 1 else "worsening"
        for _ in range(power_replicates):
            if termination == "time":
                times = np.sort(rng.uniform(size=20) ** (1 / beta)) * 100
                fit = CrowAMSAA(
                    times, T=100.0, failure_terminated=False, CI=.95)
            else:
                times = np.concatenate((
                    np.sort(rng.uniform(size=19) ** (1 / beta)) * 100,
                    [100.0],
                ))
                fit = CrowAMSAA(
                    times, T=100.0, failure_terminated=True, CI=.95)
            rejected += int(fit.trend_p_value < .05)
            correct_direction += int(fit.trend == expected_direction)
        power = rejected / power_replicates
        direction_rate = correct_direction / power_replicates
        rows.append({
            "termination": termination,
            "beta_true": beta,
            "failure_count": 20,
            "replicates": power_replicates,
            "two_sided_power_at_0.05": power,
            "correct_direction_rate": direction_rate,
            "passed": power >= .60 and direction_rate >= .95,
        })
    return rows


def _certification_eligibility(
        *, profile: str, replicates: int, passed: bool,
        git_sha: str | None, git_dirty: bool | None,
        coverage: list[dict], grouped_coverage: list[dict],
        cvm: list[dict], trend_power: list[dict]) -> tuple[bool, list[str]]:
    """Fail-closed release eligibility based on result, provenance and work."""
    reasons: list[str] = []
    if not passed:
        reasons.append("validation report contains one or more failed checks")
    if profile != "release":
        reasons.append("profile is not release")
    if replicates < 20_000:
        reasons.append(
            "release coverage requested fewer than 20000 replicates per "
            "exact-event cell")
    if not git_sha or len(git_sha) < 7:
        reasons.append("git commit SHA is unavailable")
    if git_dirty is not False:
        reasons.append(
            "git worktree cleanliness is unknown" if git_dirty is None
            else "git worktree is dirty")

    actual_requirements = (
        (coverage, "replicates_completed", 19_800, 12,
         "exact-event coverage"),
        (grouped_coverage, "replicates_completed", 1_960, 6,
         "grouped coverage"),
        (cvm, "replicates", 5_000, 10, "CvM calibration"),
        (trend_power, "replicates", 2_000, 4,
         "trend-power calibration"),
    )
    for rows, field, minimum, expected_cells, label in actual_requirements:
        if len(rows) != expected_cells:
            reasons.append(
                f"{label} has {len(rows)} cells; expected {expected_cells}")
            continue
        insufficient = [
            index for index, row in enumerate(rows)
            if int(row.get(field, 0)) < minimum
        ]
        if insufficient:
            reasons.append(
                f"{label} has insufficient actual replicates in cell(s) "
                + ", ".join(str(index) for index in insufficient)
                + f"; minimum is {minimum}")
    return not reasons, reasons


def run(profile: str, replicates: int | None, seed: int) -> dict:
    if replicates is None:
        replicates = 500 if profile == "pr" else 20_000
    started = time.perf_counter()
    try:
        git_sha = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, check=True,
            capture_output=True, text=True,
        ).stdout.strip()
        git_dirty = bool(subprocess.run(
            ["git", "status", "--porcelain"], cwd=ROOT, check=True,
            capture_output=True, text=True,
        ).stdout.strip())
    except (OSError, subprocess.CalledProcessError):
        git_sha = None
        git_dirty = None
    benchmarks = published_benchmarks()
    equation_checks = estimating_equation_checks()
    numerics = numerical_contracts()
    mcf_contracts = mcf_numerical_contracts()
    coverage = coverage_matrix(replicates, seed)
    grouped_coverage = grouped_coverage_matrix(replicates, seed + 1)
    cvm = cvm_calibration(replicates, seed + 2)
    trend_power = trend_power_calibration(replicates, seed + 3)
    passed = (
        all(row["passed"] for row in benchmarks)
        and all(row["passed"] for row in equation_checks)
        and all(row["passed"] for row in numerics)
        and all(row["passed"] for row in mcf_contracts)
        and all(row["passed"] for row in coverage)
        and all(row["passed"] for row in grouped_coverage)
        and all(row["passed"] for row in cvm)
        and all(row["passed"] for row in trend_power)
    )
    certification_eligible, certification_reasons = (
        _certification_eligibility(
            profile=profile,
            replicates=replicates,
            passed=passed,
            git_sha=git_sha,
            git_dirty=git_dirty,
            coverage=coverage,
            grouped_coverage=grouped_coverage,
            cvm=cvm,
            trend_power=trend_power,
        ))
    return {
        "tool": "crow_amsaa_validation",
        "profile": profile,
        "seed": seed,
        "replicates_per_coverage_cell": replicates,
        "passed": passed,
        "published_benchmarks": benchmarks,
        "estimating_equation_checks": equation_checks,
        "numerical_contracts": numerics,
        "mcf_numerical_contracts": mcf_contracts,
        "coverage_matrix": coverage,
        "grouped_coverage_matrix": grouped_coverage,
        "cvm_calibration": cvm,
        "trend_power_calibration": trend_power,
        "certification_eligible": certification_eligible,
        "certification_ineligibility_reasons": certification_reasons,
        "source_metadata": {
            "exact_event_numeric_fixture": (
                "MIL-HDBK-189 (13 February 1981), Appendix C, 27-event "
                "individual-failure-time example"),
            "formula_authority": (
                "MIL-HDBK-189C, section 6.2.2 individual-time and section "
                "6.2.3 grouped-data methods"),
            "time_mtbf_coefficient_fixture": (
                "NASA TM-103511, Tables 1A-1C"),
            "known_source_discrepancy": (
                "MIL-HDBK-189C section 6.2.2.9 states F=45 and publishes "
                "45-event results, but its printed Table VI contains only "
                "27 times. The missing 18 times prevent independent "
                "reproduction; the 27-time fixture is therefore cited to "
                "MIL-HDBK-189 (1981) Appendix C, not to 189C."),
        },
        "provenance": {
            "git_sha": git_sha,
            "git_worktree_dirty": git_dirty,
            "python": platform.python_version(),
            "numpy": np.__version__,
            "scipy": scipy.__version__,
            "elapsed_seconds": time.perf_counter() - started,
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", choices=("pr", "release"), default="pr")
    parser.add_argument("--replicates", type=int)
    parser.add_argument("--seed", type=int, default=20260713)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    if args.replicates is not None and args.replicates < 100:
        parser.error("--replicates must be at least 100")
    report = run(args.profile, args.replicates, args.seed)
    payload = json.dumps(report, indent=2)
    if args.output:
        args.output.write_text(payload + "\n", encoding="utf-8")
    print(payload)
    successful = bool(
        report["passed"]
        and (args.profile != "release" or report["certification_eligible"]))
    return 0 if successful else 1


if __name__ == "__main__":
    sys.exit(main())
