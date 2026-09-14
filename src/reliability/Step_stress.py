"""Weibull cumulative-exposure inference for a shared step-stress schedule.

The observation is clock time, so an exact failure contributes the density
Jacobian AF(s(t)). All units enter at time zero. Censoring is non-informative;
no recovery, mechanism change, delayed entry, or stress-dependent shape is
modeled. Positive stress must use a ratio scale (absolute temperature if used).
"""

from dataclasses import dataclass
import math

import numpy as np
from scipy import optimize, special, stats

from reliability.Utils import FitConvergenceError, numerical_hessian


_INVALID = 1e100
_SHAPE_BOUNDS = (-7.0, 7.0)
_P_BOUNDS = (0.0, 100.0)


@dataclass(frozen=True)
class StepStressSchedule:
    stresses: np.ndarray
    durations: np.ndarray
    starts: np.ndarray
    ends: np.ndarray
    reference: float

    @classmethod
    def from_steps(cls, steps):
        if not steps or len(steps) > 100:
            raise ValueError("Supply between 1 and 100 stress steps.")
        try:
            stresses = np.asarray([s["stress"] for s in steps], dtype=float)
            durations = np.asarray([s["duration"] for s in steps], dtype=float)
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError("Each step requires numeric stress and duration.") from exc
        if np.any(~np.isfinite(stresses)) or np.any(stresses <= 0):
            raise ValueError("Stress must be finite and positive on a ratio scale.")
        if np.any(~np.isfinite(durations)) or np.any(durations <= 0):
            raise ValueError("Step durations must be finite and positive.")
        if np.any(np.diff(stresses) < 0):
            raise ValueError("Stress must be nondecreasing; equal adjacent steps are allowed.")
        ends = np.cumsum(durations)
        if np.any(~np.isfinite(ends)):
            raise ValueError("Total schedule duration must be finite.")
        return cls(stresses, durations, np.r_[0.0, ends[:-1]], ends,
                   float(stresses[0]))

    def exposure(self, times, exponent):
        """Return log equivalent age and log AF, including the active stage.

        Stage intervals are (start, end]; survival is continuous at transitions.
        Log-sum-exp preserves large acceleration factors without overflow.
        """
        times = np.atleast_1d(np.asarray(times, dtype=float))
        if (np.any(~np.isfinite(times)) or np.any(times < 0)
                or np.any(times > self.ends[-1])):
            raise ValueError("Observation times must be inside the recorded schedule.")
        if not np.isfinite(exponent) or not 0 <= exponent <= _P_BOUNDS[1]:
            raise ValueError("Exponent must be finite and between 0 and 100.")
        elapsed = np.clip(times[:, None] - self.starts, 0.0, self.durations)
        with np.errstate(divide="ignore"):
            log_elapsed = np.log(elapsed)
        log_af = exponent * (np.log(self.stresses) - math.log(self.reference))
        log_age = special.logsumexp(log_elapsed + log_af, axis=1)
        stage = np.searchsorted(self.ends, times, side="left")
        return log_age, log_af[stage]


def _observations(observations, schedule):
    if not observations or len(observations) > 10000:
        raise ValueError("Supply between 1 and 10000 unit observations.")
    times, failed, ids = [], [], set()
    for i, row in enumerate(observations):
        status = row.get("status")
        if status not in {"failure", "right_censored"}:
            raise ValueError("Observation status must be failure or right_censored.")
        try:
            time = float(row["time"])
        except (KeyError, ValueError, TypeError) as exc:
            raise ValueError("Each observation requires a numeric clock time.") from exc
        if not np.isfinite(time) or time <= 0 or time > schedule.ends[-1]:
            raise ValueError("Observation times must be within (0, total schedule duration].")
        unit = row.get("unit_id")
        if unit is not None:
            if not isinstance(unit, str) or not unit.strip() or unit in ids:
                raise ValueError("Supplied unit IDs must be nonempty and unique.")
            ids.add(unit)
        supplied = row.get("stress_at_observation")
        if supplied is not None:
            stage = np.searchsorted(schedule.ends, time, side="left")
            if not np.isclose(float(supplied), schedule.stresses[stage], rtol=1e-9, atol=0):
                raise ValueError(f"Observation {i + 1} stress disagrees with its clock-time stage.")
        times.append(time)
        failed.append(status == "failure")
    return np.asarray(times), np.asarray(failed, dtype=bool)


def step_stress_log_likelihood(schedule, observations, eta, beta, exponent):
    """Clock-time likelihood, including exact-event Jacobians and censoring."""
    if not isinstance(schedule, StepStressSchedule):
        schedule = StepStressSchedule.from_steps(schedule)
    times, failed = _observations(observations, schedule)
    if not np.isfinite(eta) or eta <= 0 or not np.isfinite(beta) or beta <= 0:
        raise ValueError("Weibull scale and shape must be finite and positive.")
    log_age, log_af = schedule.exposure(times, exponent)
    with np.errstate(over="ignore", invalid="ignore"):
        z = log_age - math.log(eta)
        return float(np.sum(math.log(beta) - math.log(eta)
                            + (beta - 1) * z[failed] + log_af[failed])
                     - np.sum(np.exp(beta * z)))


def fit_step_stress(steps, observations, *, mode="joint", fixed_exponent=None,
                    use_level_stress=None, CI=0.95, profile=True):
    """Fit a Weibull 2P/inverse-power cumulative-exposure model.

    Scale is profiled analytically during the joint point fit. Uncertainty uses
    chi-square(1) likelihood-ratio profiles only for an interior, locally
    identifiable optimum. Every endpoint must have a successful nuisance fit
    and a validated LR crossing. These are asymptotic pointwise intervals,
    conditional on the shared schedule, physical law and censoring assumptions.
    """
    schedule = StepStressSchedule.from_steps(steps)
    times, failed = _observations(observations, schedule)
    d = int(np.sum(failed))
    if d < 2 or len(np.unique(times[failed])) < 2:
        raise ValueError("At least two distinct exact failure times are needed to estimate Weibull shape.")
    if mode not in {"joint", "fixed_exponent"}:
        raise ValueError("Mode must be joint or fixed_exponent.")
    if not np.isfinite(CI) or not 0 < CI < 1:
        raise ValueError("CI must be between 0 and 1.")
    if mode == "fixed_exponent":
        if fixed_exponent is None or not np.isfinite(fixed_exponent) or not 0 <= fixed_exponent <= 100:
            raise ValueError("Fixed-exponent mode requires a finite exponent between 0 and 100.")
        fixed_exponent = float(fixed_exponent)
    elif fixed_exponent is not None:
        raise ValueError("Do not supply a fixed exponent in joint mode.")
    if use_level_stress is not None:
        if not np.isfinite(use_level_stress) or use_level_stress <= 0:
            raise ValueError("Use-level stress must be finite and positive on the same ratio scale.")
        use_level_stress = float(use_level_stress)
    changed_stages = np.flatnonzero(schedule.stresses > schedule.reference)
    if mode == "joint" and (not len(changed_stages)
                             or np.max(times) <= schedule.starts[changed_stages[0]]):
        raise ValueError("Joint acceleration is unidentified without observations exposed to distinct stresses; supply an externally justified fixed exponent.")

    elapsed = np.clip(times[:, None] - schedule.starts, 0.0, schedule.durations)
    with np.errstate(divide="ignore"):
        log_elapsed = np.log(elapsed)
    log_ratios = np.log(schedule.stresses) - math.log(schedule.reference)
    active_log_ratios = log_ratios[np.searchsorted(schedule.ends, times, side="left")]

    def age_derivative(exponent):
        terms = log_elapsed + exponent * log_ratios
        la = special.logsumexp(terms, axis=1)
        derivative = np.sum(np.exp(terms - la[:, None]) * log_ratios, axis=1)
        return la, derivative

    def reduced(y):
        log_beta = float(y[0])
        p = float(y[1]) if mode == "joint" else fixed_exponent
        if not _SHAPE_BOUNDS[0] <= log_beta <= _SHAPE_BOUNDS[1] or not 0 <= p <= 100:
            return _INVALID
        beta = math.exp(log_beta)
        log_age, log_af = schedule.exposure(times, p)
        log_eta = float((special.logsumexp(beta * log_age) - math.log(d)) / beta)
        nll = (-d * log_beta + d * beta * log_eta
               - (beta - 1) * np.sum(log_age[failed]) - np.sum(log_af[failed]) + d)
        return float(nll) if np.isfinite(nll) else _INVALID

    def reduced_gradient(y):
        shape = math.exp(y[0])
        exponent = y[1] if mode == "joint" else fixed_exponent
        la, derivative = age_derivative(exponent)
        weights = special.softmax(shape * la)
        gradient = [-d + shape * (d * np.sum(weights * la) - np.sum(la[failed]))]
        if mode == "joint":
            gradient.append(shape * d * np.sum(weights * derivative)
                            - (shape - 1) * np.sum(derivative[failed])
                            - np.sum(active_log_ratios[failed]))
        return np.asarray(gradient)

    bounds = [_SHAPE_BOUNDS] + ([_P_BOUNDS] if mode == "joint" else [])
    starts = ([np.array([b, p]) for b in (0.0, 1.0) for p in (0.0, 1.0, 3.0, 10.0)]
              if mode == "joint" else [np.array([b]) for b in (-1.0, 0.0, 1.0)])
    candidates = []
    for start in starts:
        result = optimize.minimize(reduced, start, jac=reduced_gradient, method="L-BFGS-B", bounds=bounds,
                                   options={"maxiter": 1000, "ftol": 1e-13, "gtol": 1e-7})
        if result.success and np.isfinite(result.fun) and result.fun < _INVALID / 10:
            candidates.append(result)
    if not candidates:
        raise FitConvergenceError("No eligible converged joint step-stress fit.")
    best = min(candidates, key=lambda r: r.fun)
    log_beta = float(best.x[0])
    beta = math.exp(log_beta)
    p = float(best.x[1]) if mode == "joint" else fixed_exponent
    if min(log_beta - bounds[0][0], bounds[0][1] - log_beta) < 1e-4 or (mode == "joint" and p >= 100 - 1e-4):
        raise FitConvergenceError("Step-stress fit reached a numerical search limit; parameters are not supported.")
    log_age, log_af = schedule.exposure(times, p)
    log_eta = float((special.logsumexp(beta * log_age) - math.log(d)) / beta)
    if not -650 < log_eta < 650 or np.max(log_age) > 650:
        raise FitConvergenceError("Fitted equivalent ages or reference scale exceed the supported numeric range.")
    eta = math.exp(log_eta)
    theta = np.array([log_eta, log_beta] + ([p] if mode == "joint" else []))
    full_bounds = [(-650.0, 650.0), _SHAPE_BOUNDS] + ([_P_BOUNDS] if mode == "joint" else [])

    def full_nll(x):
        if any(not low <= val <= high for val, (low, high) in zip(x, full_bounds)):
            return _INVALID
        shape = math.exp(x[1])
        exponent = x[2] if mode == "joint" else p
        la, laf = schedule.exposure(times, exponent)
        z = la - x[0]
        with np.errstate(over="ignore", invalid="ignore"):
            value = -d * (x[1] - x[0]) - (shape - 1) * np.sum(z[failed]) - np.sum(laf[failed]) + np.sum(np.exp(shape * z))
        return float(value) if np.isfinite(value) and value < _INVALID else _INVALID

    def full_gradient(x):
        shape = math.exp(x[1])
        exponent = x[2] if mode == "joint" else p
        la, derivative = age_derivative(exponent)
        z = la - x[0]
        hazard = np.exp(np.clip(shape * z, -745, 220))
        gradient = [shape * (d - np.sum(hazard)),
                    -d - shape * np.sum(z[failed]) + shape * np.sum(hazard * z)]
        if mode == "joint":
            gradient.append(-(shape - 1) * np.sum(derivative[failed])
                            - np.sum(active_log_ratios[failed])
                            + shape * np.sum(hazard * derivative))
        return np.asarray(gradient)

    optimum = full_nll(theta)
    boundary = mode == "joint" and p < 1e-5
    information_status, condition = "unavailable", None
    if not boundary:
        information = numerical_hessian(full_nll, theta, rel_step=min(2e-4, p / 4) if mode == "joint" else 2e-4)
        eigenvalues = np.linalg.eigvalsh(information) if information is not None else np.array([np.nan])
        if np.all(np.isfinite(eigenvalues)) and eigenvalues[0] > 0:
            condition = float(eigenvalues[-1] / eigenvalues[0])
            information_status = "identified" if condition < 1e10 else "ill_conditioned"
        if information_status != "identified":
            raise FitConvergenceError("Step-stress parameters are not locally identifiable at the fitted optimum.")
    uncertainty = {"method": "profile_likelihood", "CI": float(CI),
                   "status": "not_requested" if not profile else "unavailable",
                   "interpretation": "asymptotic_pointwise_confidence_intervals",
                   "conditional_on": "shared_schedule_inverse_power_common_shape_noninformative_censoring",
                   "excludes": "model_selection_physical_law_and_future_count_uncertainty",
                   "intervals": {}}
    if boundary:
        uncertainty.update(status="unavailable", reason="exponent_on_physical_boundary")
    elif profile:
        cutoff = float(stats.chi2.ppf(CI, 1))

        def interval(index, name, transform=math.exp):
            center = float(theta[index])
            nuisance = [j for j in range(len(theta)) if j != index]
            nuisance_bounds = [full_bounds[j] for j in nuisance]
            cache = {center: optimum}

            def evaluate(target):
                if target in cache:
                    return cache[target]
                def objective(v):
                    x = theta.copy()
                    x[index] = target
                    x[nuisance] = v
                    return full_nll(x)
                def gradient(v):
                    x = theta.copy()
                    x[index] = target
                    x[nuisance] = v
                    return full_gradient(x)[nuisance]
                attempts = []
                for shift in (0.0, 0.15, -0.15):
                    initial = np.clip(theta[nuisance] + shift,
                                      [b[0] for b in nuisance_bounds], [b[1] for b in nuisance_bounds])
                    candidate = optimize.minimize(objective, initial, jac=gradient, method="L-BFGS-B",
                                                  bounds=nuisance_bounds,
                                                  options={"maxiter": 600, "ftol": 1e-12, "gtol": 1e-6})
                    if candidate.success and np.isfinite(candidate.fun) and candidate.fun < _INVALID / 10:
                        attempts.append(candidate)
                if not attempts:
                    raise ValueError("nuisance_optimizer_failed")
                value = float(min(attempts, key=lambda r: r.fun).fun)
                if value < optimum - 1e-5:
                    raise ValueError("profile_found_better_optimum")
                cache[target] = value
                return value

            def crossing(x):
                return 2 * (evaluate(float(x)) - optimum) - cutoff

            endpoints, residuals, reasons = [], [], []
            for direction in (-1, 1):
                span, inside = (max(0.1, p * 0.1) if index == 2 else 0.15), center
                endpoint, residual = None, None
                try:
                    for _ in range(32):
                        edge = float(np.clip(center + direction * span, *full_bounds[index]))
                        value = crossing(edge)
                        if value >= 0:
                            root = optimize.brentq(crossing, min(inside, edge), max(inside, edge), xtol=1e-8)
                            residual = abs(crossing(root))
                            if residual > 1e-4:
                                raise ValueError("likelihood_ratio_residual")
                            endpoint = float(transform(root))
                            break
                        if edge in full_bounds[index]:
                            raise ValueError("profile_reaches_parameter_boundary")
                        inside, span = edge, span * 1.7
                    if endpoint is None:
                        raise ValueError("profile_crossing_not_bracketed")
                    reasons.append(None)
                except (ValueError, RuntimeError, FloatingPointError) as exc:
                    reasons.append(str(exc))
                endpoints.append(endpoint)
                residuals.append(residual)
            return {"estimate": float(transform(center)), "lower": endpoints[0], "upper": endpoints[1],
                    "status": "ok" if all(v is not None for v in endpoints) else "incomplete",
                    "endpoint_reasons": reasons, "lr_residuals": residuals, "lr_cutoff": cutoff,
                    "successful_profile_evaluations": len(cache)}

        for index, name in enumerate(["eta_reference", "beta"] + (["exponent_p"] if mode == "joint" else [])):
            uncertainty["intervals"][name] = interval(index, name, float if index == 2 else math.exp)
        uncertainty["status"] = ("ok" if all(v["status"] == "ok" for v in uncertainty["intervals"].values()) else "incomplete")

    use = schedule.reference if use_level_stress is None else use_level_stress
    log_use_eta = log_eta - p * (math.log(use) - math.log(schedule.reference))
    if not -650 < log_use_eta < 650:
        raise ValueError("Use-stress extrapolation exceeds the supported numeric range.")
    use_eta = math.exp(log_use_eta)
    def summary(scale):
        values = {"mean": float(scale * special.gamma(1 + 1 / beta)),
                  "B50": float(scale * math.log(2) ** (1 / beta)),
                  "B10": float(scale * (-math.log(0.9)) ** (1 / beta))}
        return {key: value if np.isfinite(value) else None for key, value in values.items()}
    log_curve_end = log_eta + math.log(-math.log(0.001)) / beta
    if log_curve_end > 650:
        raise FitConvergenceError("Fitted lifetime quantiles exceed the supported numeric range.")
    curve_x = np.linspace(0, math.exp(log_curve_end), 160)
    curve_time = np.unique(np.r_[np.linspace(0, schedule.ends[-1], 160), schedule.ends])
    curve_log_age, _ = schedule.exposure(curve_time, p)
    with np.errstate(over="ignore", invalid="ignore"):
        survival = np.exp(-np.exp(beta * (curve_log_age - log_eta)))
    risk, cumulative = len(times), 0.0
    km_times, km_cdf = [], []
    for time in np.unique(times):
        at = times == time
        count = int(np.sum(failed[at]))
        cumulative = 1 - (1 - cumulative) * (1 - count / risk)
        if count:
            km_times.append(float(time)); km_cdf.append(float(cumulative))
        risk -= int(np.sum(at))
    log_step_af = p * (np.log(schedule.stresses) - math.log(schedule.reference))
    log_step_ends, _ = schedule.exposure(schedule.ends, p)
    if np.max(log_step_af) > 650 or np.max(log_step_ends) > 650:
        raise FitConvergenceError("Schedule extrapolation exceeds the supported numeric range.")
    eq_ends = np.exp(log_step_ends)
    sources = [{"title": "ReliaSoft Time-Varying Stress Models", "url": "https://help.reliasoft.com/reference/accelerated_life_testing_data_analysis/alt/time-varying_stress_models.html", "locator": "Cumulative Exposure Model and example", "edition": "online reference accessed 2026-09-14"},
               {"title": "ReliaSoft Cumulative Damage General Loglinear", "url": "https://help.reliasoft.com/reference/accelerated_life_testing_data_analysis/alt/cumulative_damage_general_loglinear.html", "locator": "Likelihood with exact failures and suspensions"}]
    return {
        "schema": "perdura.step-stress/v2", "method": "joint_weibull_inverse_power_mle",
        "fit_mode": mode, "status": "boundary" if boundary else "converged",
        "parameters": {"eta_reference": eta, "beta": beta, "exponent_p": p},
        "exponent_p": p, "ref_stress": schedule.reference,
        "log_likelihood": -optimum, "n_failures": d, "n_right_censored": len(times) - d,
        "diagnostics": {"information_status": "physical_boundary" if boundary else information_status,
                        "information_condition": condition, "converged_starts": len(candidates),
                        "searched_starts": len(starts), "exponent_search_bounds": list(_P_BOUNDS)},
        "uncertainty": uncertainty,
        "analysis_metadata": {
            "estimand": "reference_stress_Weibull_scale_shape_and_inverse_power_exponent",
            "observation_design": "independent_units_shared_piecewise_constant_schedule_exact_and_right_censored_zero_entry_age",
            "model": "Weibull_2P_inverse_power_cumulative_exposure",
            "estimator": "joint_MLE" if mode == "joint" else "MLE_conditional_on_external_exponent",
            "assumptions": ["common Weibull shape", "cumulative exposure without recovery or mechanism change", "nonnegative acceleration exponent", "noninformative censoring", "positive ratio-scale stress"],
            "uncertainty": {"kind": "asymptotic_pointwise_confidence", "method": "profile_likelihood", "confidence": float(CI), "status": uncertainty["status"]},
            "convergence": "physical_boundary" if boundary else "converged",
            "identifiability": "boundary_inference_withheld" if boundary else information_status,
            "sources": sources, "engine_revision": 2, "method_version": "step-stress-v2.1",
        },
        "assumptions": ["All units enter at time zero and share the recorded schedule.",
                        "Cumulative exposure; no recovery or failure-mechanism change.",
                        "Weibull shape is common across stresses; inverse-power exponent is nonnegative.",
                        "Stress is a positive ratio-scale quantity; censoring is non-informative."],
        "equivalent_times": np.exp(log_age[failed]).tolist(),
        "equivalent_censored_times": np.exp(log_age[~failed]).tolist(),
        "distribution_fit": {"distribution": "Weibull_2P", "params": {"eta": eta, "beta": beta},
                             "summary": {**summary(eta), "median": summary(eta)["B50"]}, "curve_x": curve_x.tolist(),
                             "cdf": stats.weibull_min.cdf(curve_x, beta, scale=eta).tolist()},
        "use_level_stress": use_level_stress,
        "use_level": {"stress": use, "eta": use_eta, "summary": summary(use_eta),
                      "extrapolated": bool(use < schedule.stresses[0] or use > schedule.stresses[-1]),
                      "uncertainty_status": "not_computed_for_use_level_derived_targets"},
        "cumulative_plot": {"time": km_times, "cum_fraction": km_cdf,
                            "estimator": "kaplan_meier", "step_boundaries": schedule.ends[:-1].tolist()},
        "schedule_curve": {"time": curve_time.tolist(), "survival": survival.tolist()},
        "step_exposure": [{"stress": float(s), "duration": float(dt), "raw_start": float(start),
                           "raw_end": float(end), "acceleration_factor": float(math.exp(laf)),
                           "equivalent_start": float(eqstart), "equivalent_end": float(eqend)}
                          for s, dt, start, end, laf, eqstart, eqend in zip(
                              schedule.stresses, schedule.durations, schedule.starts, schedule.ends,
                              log_step_af, np.r_[0.0, eq_ends[:-1]], eq_ends)],
    }
