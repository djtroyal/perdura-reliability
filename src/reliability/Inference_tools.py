"""Design-aware confidence intervals, discrete probabilities and executed SPRTs.

All interval probabilities use left-tail quantiles. Sequential OC calculations
follow the *same declared stopping rule* as the observed path. Bernoulli OCs
are finite-horizon exact recursions; exponential OCs are seeded Monte Carlo,
with sampling uncertainty reported separately from nominal design risks.
"""
from __future__ import annotations

import math
import numpy as np
from scipy import stats

from reliability.Reliability_testing import one_sample_proportion, sequential_sampling_chart


def _number(value, name, *, positive=False):
    try:
        value = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{name} must be a finite number.") from error
    if not math.isfinite(value) or (positive and value <= 0):
        raise ValueError(f"{name} must be finite" + (" and positive." if positive else "."))
    return value


def _integer(value, name, low=0, high=None):
    value = _number(value, name)
    if not value.is_integer() or value < low or (high is not None and value > high):
        raise ValueError(f"{name} must be an integer from {low}" + (f" to {high}." if high is not None else " upward."))
    return int(value)


def _probability(value, name, inclusive=False):
    value = _number(value, name)
    if not (0 <= value <= 1 if inclusive else 0 < value < 1):
        raise ValueError(f"{name} must be " + ("in [0, 1]." if inclusive else "strictly between 0 and 1."))
    return value


def _sides(sides):
    if sides not in {"two-sided", "lower", "upper"}:
        raise ValueError("sides must be two-sided, lower, or upper.")


def mtbf_interval(*, failures, confidence=.95, termination="time", sides="two-sided",
                  total_exposure=None, exposure_rows=None):
    """Aggregate HPP/replacement or failure-terminated exponential inference.

    Exposure rows are operating durations multiplied by unit count and duty.
    They do not infer censoring design from the numerical values. None denotes
    an unbounded MTBF upper endpoint or zero-failure point estimate.
    """
    r = _integer(failures, "failures")
    c = _probability(confidence, "confidence")
    _sides(sides)
    if termination not in {"time", "failure"}:
        raise ValueError("termination must be time or failure.")
    if termination == "failure" and r == 0:
        raise ValueError("A failure-terminated test needs at least one failure.")
    rows = []
    if total_exposure is not None and exposure_rows:
        raise ValueError("Supply total_exposure or exposure_rows, not both.")
    if exposure_rows:
        for index, row in enumerate(exposure_rows):
            units = _integer(row.get("units", 1), "units", 1)
            duration = _number(row["duration"], "duration", positive=True)
            duty = _probability(row.get("duty", 1), "duty", inclusive=True)
            exposure = _number(units * duration * duty, "row exposure")
            rows.append({"label": str(row.get("label", f"Group {index + 1}")),
                         "units": units, "duration": duration, "duty": duty, "exposure": exposure})
        T = _number(math.fsum(row["exposure"] for row in rows), "total exposure", positive=True)
    else:
        if total_exposure is None:
            raise ValueError("Supply positive total_exposure or exposure_rows.")
        T = _number(total_exposure, "total_exposure", positive=True)
    tail = (1 - c) / (2 if sides == "two-sided" else 1)
    df_lower = 2 * (r + 1) if termination == "time" else 2 * r
    lower = 0.0 if sides == "upper" else float(T / (stats.chi2.isf(tail, df_lower) / 2))
    upper = None if sides == "lower" or r == 0 else float(T / (stats.chi2.ppf(tail, 2 * r) / 2))
    if not math.isfinite(lower) or (upper is not None and not math.isfinite(upper)):
        raise ValueError("MTBF confidence endpoints cannot be represented; rescale exposure units.")
    return {"total_exposure": T, "failures": r, "exposure_rows": rows,
            "confidence": c, "sides": sides, "termination": termination,
            "mtbf_estimate": T / r if r else None, "rate_estimate": r / T,
            "mtbf_lower": lower, "mtbf_upper": upper,
            "rate_lower": 0.0 if upper is None else 1 / upper,
            "rate_upper": None if lower == 0 else 1 / lower,
            "degrees_of_freedom": {"mtbf_lower": df_lower, "mtbf_upper": 2 * r},
            "method": "poisson_garwood" if termination == "time" else "gamma_pivot",
            "assumptions": ["Common constant exponential intensity; independent exposure.",
                "Fixed operating exposure for repairable/replacement testing." if termination == "time"
                else "Testing stops at a predeclared positive number of failures.",
                "Finite-population nonreplacement time censoring is not claimed exact here."],
            "unbounded_point_estimate": r == 0}


def binomial_interval(*, trials, count, confidence=.95, sides="two-sided", orientation="success", method="exact"):
    n, x = _integer(trials, "trials", 1), _integer(count, "count")
    if x > n:
        raise ValueError("count cannot exceed trials.")
    c = _probability(confidence, "confidence")
    _sides(sides)
    if orientation not in {"success", "defect"} or method not in {"exact", "wilson"}:
        raise ValueError("Unknown orientation or interval method.")
    if method == "exact":
        interval = one_sample_proportion(n, x, CI=c, sides=sides)
        lo, hi = interval["lower"], interval["upper"]
    else:
        z = stats.norm.isf((1 - c) / (2 if sides == "two-sided" else 1))
        p, denominator = x / n, 1 + z * z / n
        center = (p + z * z / (2 * n)) / denominator
        radius = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denominator
        lo = 0.0 if sides == "upper" or x == 0 else max(0.0, center - radius)
        hi = 1.0 if sides == "lower" or x == n else min(1.0, center + radius)
    return {"trials": n, "count": x, "confidence": c, "sides": sides,
            "orientation": orientation, "method": "clopper_pearson_exact" if method == "exact" else "wilson_score",
            "estimate": x / n, "lower": float(lo), "upper": float(hi),
            "reliability_estimate": x / n if orientation == "success" else 1 - x / n,
            "reliability_lower": float(lo if orientation == "success" else 1 - hi),
            "reliability_upper": float(hi if orientation == "success" else 1 - lo),
            "assumptions": ["Independent Bernoulli outcomes at the declared mission; fixed sample size.",
                            "Method is selected explicitly and does not switch with sample size."]}


def normal_mean_interval(*, mean, standard_deviation, sample_size, confidence=.95, sides="two-sided", sigma_known=False):
    mean = _number(mean, "mean")
    sd = _number(standard_deviation, "standard_deviation", positive=True)
    n = _integer(sample_size, "sample_size", 1 if sigma_known else 2)
    c = _probability(confidence, "confidence")
    _sides(sides)
    tail = (1 - c) / (2 if sides == "two-sided" else 1)
    critical = float(stats.norm.isf(tail) if sigma_known else stats.t.isf(tail, n - 1))
    se = sd / math.sqrt(n)
    return {"mean": mean, "standard_deviation": sd, "sample_size": n, "confidence": c, "sides": sides,
            "lower": None if sides == "upper" else mean - critical * se,
            "upper": None if sides == "lower" else mean + critical * se,
            "standard_error": se, "critical_value": critical,
            "degrees_of_freedom": None if sigma_known else n - 1,
            "method": "normal_known_sigma" if sigma_known else "student_t_unknown_sigma",
            "assumptions": ["Independent complete Normal observations; no censoring.",
                "Entered deviation is known population sigma." if sigma_known else "Entered deviation is sample SD with n-1 denominator."]}


def discrete_probability(*, sample_size, probability=.05, model="binomial", lot_size=None,
                         lot_defects=None, event="at_most", threshold=0, upper=None,
                         good_quality=None, bad_quality=None):
    n = _integer(sample_size, "sample_size", 1, 1000000)
    k = _integer(threshold, "threshold", 0, n)
    if model == "binomial":
        p = _probability(probability, "defect probability", inclusive=True)
        distribution = stats.binom(n, p)
        quality = np.unique(np.r_[np.linspace(0, 1, 101), p,
            [] if good_quality is None else [good_quality], [] if bad_quality is None else [bad_quality]])
        oc = stats.binom.cdf(k, n, quality)
        support_low, support_high = 0, n
        parameters = {"probability": p}
    elif model == "hypergeometric":
        N = _integer(lot_size, "lot_size", n, 1000000000)
        K = _integer(lot_defects, "lot_defects", 0, N)
        distribution = stats.hypergeom(N, K, n)
        counts = np.unique(np.r_[np.linspace(0, N, min(N + 1, 101)).astype(int), K])
        quality, oc = counts / N, stats.hypergeom.cdf(k, N, counts, n)
        support_low, support_high = max(0, n - (N - K)), min(n, K)
        parameters = {"lot_size": N, "lot_defects": K, "probability": K / N}
    else:
        raise ValueError("model must be binomial or hypergeometric.")
    if event == "at_most":
        value = distribution.cdf(k)
    elif event == "at_least":
        value = distribution.sf(k - 1)
    elif event == "exactly":
        value = distribution.pmf(k)
    elif event == "between":
        upper = _integer(upper, "upper", k, n)
        # Subtract in the better-conditioned tail.
        value = (distribution.sf(k - 1) - distribution.sf(upper) if distribution.cdf(k - 1) > .5
                 else distribution.cdf(upper) - distribution.cdf(k - 1))
    else:
        raise ValueError("event must be at_most, at_least, exactly, or between.")
    if support_high - support_low <= 500:
        xs = np.arange(support_low, support_high + 1)
        complete = True
    else:
        central = np.asarray(distribution.ppf(np.linspace(.00001, .99999, 497)), dtype=int)
        xs = np.unique(np.r_[support_low, support_high, k, central, [] if upper is None else [upper]])
        complete = False
    risk_points = []
    for label, q in (("good", good_quality), ("bad", bad_quality)):
        if q is None:
            continue
        q = _probability(q, label + " quality", inclusive=True)
        if model == "binomial":
            actual, acceptance = q, float(stats.binom.cdf(k, n, q))
            defects = None
        else:
            # Explicit conservative direction at each quality threshold.
            defects = math.floor(q * N) if label == "good" else math.ceil(q * N)
            actual, acceptance = defects / N, float(stats.hypergeom.cdf(k, N, defects, n))
        risk_points.append({"quality": label, "requested_fraction_defective": q,
                            "fraction_defective": actual, "lot_defects": defects,
                            "probability_accept": acceptance,
                            "risk": 1 - acceptance if label == "good" else acceptance})
    if good_quality is not None and bad_quality is not None and good_quality >= bad_quality:
        raise ValueError("Good-quality defect fraction must be below bad-quality fraction.")
    return {"model": model, "sample_size": n, **parameters, "event": event,
            "threshold": k, "upper": upper, "probability": float(np.clip(value, 0, 1)),
            "probability_accept": float(distribution.cdf(k)),
            "mean_defects": float(distribution.mean()), "risk_points": risk_points,
            "table": {"defects": xs.tolist(), "pmf": distribution.pmf(xs).tolist(),
                      "cdf": distribution.cdf(xs).tolist(), "sf": distribution.sf(xs).tolist(),
                      "complete_support": complete},
            "oc_curve": {"fraction_defective": quality.tolist(), "probability_accept": oc.tolist()},
            "assumptions": ["Binomial: independent trials/common defect probability." if model == "binomial"
                            else "Uniform sampling without replacement from the specified finite lot.",
                            "Acceptance OC uses at most threshold defects, independently of the selected probability event.",
                            "Large-support plot is sampled; reported probabilities use exact distribution functions."]}


def _risks(alpha, beta, terminal_rule):
    alpha, beta = _probability(alpha, "alpha"), _probability(beta, "beta")
    if alpha + beta >= 1:
        raise ValueError("alpha + beta must be below 1 for ordered SPRT boundaries.")
    if terminal_rule not in {"inconclusive", "likelihood_ratio"}:
        raise ValueError("terminal_rule must be inconclusive or likelihood_ratio.")
    return alpha, beta, math.log(beta / (1 - alpha)), math.log((1 - beta) / alpha)


def _terminal_decision(ell, terminal_rule):
    return "inconclusive" if terminal_rule == "inconclusive" else "accept" if ell <= 0 else "reject"


def bernoulli_sprt(*, good_probability, bad_probability, alpha=.05, beta=.1,
                   horizon=100, outcomes=None, terminal_rule="inconclusive", oc_points=21):
    good, bad = _probability(good_probability, "good_probability"), _probability(bad_probability, "bad_probability")
    if good >= bad:
        raise ValueError("good_probability must be below bad_probability.")
    horizon = _integer(horizon, "horizon", 1, 2000)
    oc_points = _integer(oc_points, "oc_points", 3, 41)
    alpha, beta, a, b = _risks(alpha, beta, terminal_rule)
    D = math.log(bad / good) + math.log((1 - good) / (1 - bad))
    logq = math.log((1 - bad) / (1 - good))
    boundary = sequential_sampling_chart(good, bad, alpha, beta, horizon)
    rows = []
    for n, accept, reject in zip(boundary["n"], boundary["acceptance_line"], boundary["rejection_line"]):
        # Correct integer-boundary round-off by checking the original log LR.
        ac = -1 if accept is None else math.floor(accept)
        rc = math.ceil(reject)
        while ac >= 0 and ac * D + n * logq > a:
            ac -= 1
        while ac + 1 <= n and (ac + 1) * D + n * logq <= a:
            ac += 1
        while rc <= n and rc * D + n * logq < b:
            rc += 1
        while rc > 0 and (rc - 1) * D + n * logq >= b:
            rc -= 1
        rows.append({"samples": n, "accept_at_most": ac if ac >= 0 else None,
                     "reject_at_least": rc if rc <= n else None,
                     "accept_boundary": accept, "reject_boundary": reject})
    outcomes = [] if outcomes is None else [_integer(x, "Each outcome", 0, 1) for x in outcomes]
    if len(outcomes) > horizon:
        raise ValueError("Observed outcomes exceed the declared horizon.")
    defects, decision, trace, stop = 0, "continue", [], None
    for n, event in enumerate(outcomes, 1):
        defects += event
        ell = defects * D + n * logq
        decision = "accept" if ell <= a else "reject" if ell >= b else "continue"
        if decision == "continue" and n == horizon:
            decision = _terminal_decision(ell, terminal_rule)
        trace.append({"samples": n, "defects": defects, "log_likelihood_ratio": ell, "decision": decision})
        if decision != "continue":
            stop = n
            break
    quality = np.unique(np.r_[np.linspace(0, 1, oc_points), good, bad])
    oc = []
    for p in quality:
        active = np.array([1.0])
        accepted = rejected = unresolved = expected = 0.0
        for n in range(1, horizon + 1):
            expected += float(active.sum())
            next_mass = np.r_[active * (1 - p), 0.0] + np.r_[0.0, active * p]
            ell = np.arange(n + 1) * D + n * logq
            accept, reject = ell <= a, ell >= b
            if n == horizon and terminal_rule == "likelihood_ratio":
                cont = ~(accept | reject)
                accept |= cont & (ell <= 0)
                reject |= cont & (ell > 0)
            accepted += float(next_mass[accept].sum())
            rejected += float(next_mass[reject].sum())
            next_mass[accept | reject] = 0
            active = next_mass
            if not np.any(active):
                break
        unresolved = float(active.sum())
        oc.append({"true_value": float(p), "probability_accept": accepted, "probability_reject": rejected,
                   "probability_inconclusive": unresolved, "expected_duration": expected})
    return {"model": "bernoulli", "good_value": good, "bad_value": bad, "alpha": alpha, "beta": beta,
            "horizon": horizon, "terminal_rule": terminal_rule, "boundaries": rows,
            "log_accept": a, "log_reject": b, "trace": trace,
            "decision": decision, "stopping_time": stop,
            "ignored_observations": len(outcomes) - len(trace), "oc_curve": oc,
            "operating_characteristics_method": "exact_finite_horizon_probability_recursion",
            "risk_check": _risk_check(oc, good, bad, alpha, beta),
            "assumptions": ["Independent Bernoulli inspections; 1 means defective, 0 means good.",
                            "Stop at the first crossing; later supplied observations are ignored and counted.",
                            "OC and average sample number use the declared horizon and terminal rule."]}


def _risk_check(oc, good, bad, alpha, beta):
    good_row = next(row for row in oc if row["true_value"] == good)
    bad_row = next(row for row in oc if row["true_value"] == bad)
    return {"nominal_producer_risk": alpha, "nominal_consumer_risk": beta,
            "achieved_producer_risk": good_row["probability_reject"],
            "achieved_consumer_risk": bad_row["probability_accept"],
            "inconclusive_at_good": good_row["probability_inconclusive"],
            "inconclusive_at_bad": bad_row["probability_inconclusive"]}


def _exponential_path(times, end, horizon, terminal_rule, logd, delta, a, b):
    trace = [{"time": 0.0, "failures": 0, "log_likelihood_ratio": 0.0, "decision": "continue"}]
    count, decision, stop = 0, "continue", None
    for time in times:
        crossing = (count * logd - a) / delta
        if crossing < time:  # events take precedence at an exact tie
            decision, stop = "accept", crossing
            trace.append({"time": stop, "failures": count, "log_likelihood_ratio": a, "decision": decision})
            break
        count += 1
        ell = count * logd - delta * time
        decision = "reject" if ell >= b else "continue"
        trace.append({"time": time, "failures": count, "log_likelihood_ratio": ell, "decision": decision})
        if decision == "reject":
            stop = time
            break
    if decision == "continue":
        crossing = (count * logd - a) / delta
        if crossing <= end:
            decision, stop = "accept", crossing
        elif end == horizon:
            decision, stop = _terminal_decision(count * logd - delta * end, terminal_rule), end
        time = end if stop is None else stop
        trace.append({"time": time, "failures": count, "log_likelihood_ratio": count * logd - delta * time,
                      "decision": decision})
    return trace, decision, stop, len(times) - count


def _mc_interval(count, n):
    return [0.0 if count == 0 else float(stats.beta.ppf(.025, count, n - count + 1)),
            1.0 if count == n else float(stats.beta.ppf(.975, count + 1, n - count))]


def exponential_sprt(*, good_mtbf, bad_mtbf, alpha=.05, beta=.1, horizon=1000.,
                     failure_times=None, observed_exposure=0., terminal_rule="inconclusive",
                     simulations=2000, seed=42, oc_points=13):
    good, bad = _number(good_mtbf, "good_mtbf", positive=True), _number(bad_mtbf, "bad_mtbf", positive=True)
    if good <= bad:
        raise ValueError("good_mtbf must exceed bad_mtbf.")
    horizon = _number(horizon, "horizon", positive=True)
    end = _number(observed_exposure, "observed_exposure")
    if not 0 <= end <= horizon:
        raise ValueError("observed_exposure must be between zero and horizon.")
    simulations = _integer(simulations, "simulations", 200, 20000)
    seed = _integer(seed, "seed", 0, 2**32 - 1)
    oc_points = _integer(oc_points, "oc_points", 3, 21)
    alpha, beta, a, b = _risks(alpha, beta, terminal_rule)
    logd = math.log1p((good - bad) / bad)
    delta = (1 - bad / good) / bad
    if not math.isfinite(delta) or delta <= 0:
        raise ValueError("MTBF scales cannot represent a finite likelihood slope; rescale units.")
    times = [_number(t, "failure time", positive=True) for t in (failure_times or [])]
    if any(right <= left for left, right in zip(times, times[1:])) or (times and times[-1] > end):
        raise ValueError("Failure times must strictly increase and not exceed observed_exposure.")
    trace, decision, stop, ignored = _exponential_path(times, end, horizon, terminal_rule, logd, delta, a, b)
    ts = np.unique(np.r_[np.linspace(0, horizon, 201), [row["time"] for row in trace]])
    boundaries = [{"time": float(t), "accept_boundary": None if a + delta * t < 0 else float((a + delta * t) / logd),
                   "reject_boundary": float((b + delta * t) / logd)} for t in ts]
    quality = np.unique(np.r_[np.geomspace(bad / 2, good * 2, oc_points), good, bad])
    streams = np.random.SeedSequence(seed).spawn(len(quality))
    oc = []
    for theta, stream in zip(quality, streams):
        rng = np.random.default_rng(stream)
        exposure = np.zeros(simulations)
        counts = np.zeros(simulations, dtype=int)
        state = np.zeros(simulations, dtype=np.int8)  # 0 active,1 accept,2 reject,3 inconclusive
        work = 0
        while np.any(state == 0):
            active = np.flatnonzero(state == 0)
            work += len(active)
            if work > 10000000:
                raise ValueError("Sequential simulation exceeds its event budget; reduce simulations/horizon or separate the quality levels.")
            event = exposure[active] + rng.exponential(float(theta), len(active))
            crossing = (counts[active] * logd - a) / delta
            accept = (crossing < event) & (crossing <= horizon)
            done = active[accept]
            exposure[done], state[done] = crossing[accept], 1
            remaining, event = active[~accept], event[~accept]
            at_end = event > horizon
            ended = remaining[at_end]
            exposure[ended] = horizon
            if terminal_rule == "inconclusive":
                state[ended] = 3
            else:
                ell = counts[ended] * logd - delta * horizon
                state[ended] = np.where(ell <= 0, 1, 2)
            arrived = remaining[~at_end]
            exposure[arrived] = event[~at_end]
            counts[arrived] += 1
            rejected = counts[arrived] * logd - delta * exposure[arrived] >= b
            state[arrived[rejected]] = 2
        na, nr, ni = (int(np.sum(state == code)) for code in (1, 2, 3))
        se = float(np.std(exposure, ddof=1) / math.sqrt(simulations))
        mean = float(np.mean(exposure))
        oc.append({"true_value": float(theta), "probability_accept": na / simulations,
                   "probability_reject": nr / simulations, "probability_inconclusive": ni / simulations,
                   "expected_duration": mean, "accept_interval": _mc_interval(na, simulations),
                   "reject_interval": _mc_interval(nr, simulations),
                   "inconclusive_interval": _mc_interval(ni, simulations),
                   "duration_standard_error": se,
                   "duration_interval": [max(0., mean - 1.96 * se), min(horizon, mean + 1.96 * se)]})
    return {"model": "exponential", "good_value": good, "bad_value": bad, "alpha": alpha, "beta": beta,
            "horizon": horizon, "terminal_rule": terminal_rule, "boundaries": boundaries,
            "log_accept": a, "log_reject": b, "trace": trace, "decision": decision,
            "stopping_time": stop, "ignored_observations": ignored, "oc_curve": oc,
            "simulations": simulations, "seed": seed,
            "operating_characteristics_method": "seeded_monte_carlo_of_declared_stopping_rule",
            "risk_check": _risk_check(oc, good, bad, alpha, beta),
            "assumptions": ["Independent exponential lifetimes / homogeneous Poisson events on total operating exposure.",
                "Acceptance may occur between failures. At exact time ties process the event first.",
                "Stop at first crossing; subsequent supplied events are ignored and counted.",
                "OC probabilities have 95% exact binomial Monte Carlo intervals; duration intervals are approximate Monte Carlo mean intervals.",
                "The horizon and terminal decision change achieved risks; nominal risks are not a finite-horizon guarantee."]}
