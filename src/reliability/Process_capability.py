"""
Process Capability analysis.

Computes the standard process-capability indices (Cp, Cpk, Cpl, Cpu, Pp,
Ppk, Cpm), within- and overall-sigma estimates, normal-model defect rates
(ppm / DPMO below LSL, above USL, and total), Z.bench, observed performance,
histogram bins and a Shapiro-Wilk normality test.

Within-subgroup sigma is estimated from the average moving range (subgroup
size 1) or the average subgroup range (subgroup size > 1) divided by the
appropriate d2 constant. Overall sigma is the ordinary sample standard
deviation. One-sided specifications (only LSL or only USL) are supported.

Only numpy and scipy are used.
"""

import math
from typing import Optional

import numpy as np
from scipy import special, stats

from .SPC import control_chart


# ---------------------------------------------------------------------------
# d2 (mean of relative range) constants indexed by subgroup size
# Source: standard SPC tables (Montgomery, Introduction to SQC).
# ---------------------------------------------------------------------------
_D2 = {
    2: 1.128, 3: 1.693, 4: 2.059, 5: 2.326, 6: 2.534, 7: 2.704,
    8: 2.847, 9: 2.970, 10: 3.078, 11: 3.173, 12: 3.258, 13: 3.336,
    14: 3.407, 15: 3.472, 16: 3.532, 17: 3.588, 18: 3.640, 19: 3.689,
    20: 3.735, 21: 3.778, 22: 3.819, 23: 3.858, 24: 3.895, 25: 3.931,
}


def _d2(n: int) -> float:
    if n not in _D2:
        raise ValueError(
            f"subgroup_size {n} is outside the supported d2 table (2 through 25)."
        )
    return _D2[n]


def _quantile_indices(q_lo, median, q_hi, lsl, usl):
    """Capability-like indices based on modeled 0.135%/50%/99.865% points."""
    span = q_hi - q_lo
    pp = ((usl - lsl) / span
          if usl is not None and lsl is not None and span > 0 else None)
    ppu = ((usl - median) / (q_hi - median)
           if usl is not None and q_hi > median else None)
    ppl = ((median - lsl) / (median - q_lo)
           if lsl is not None and median > q_lo else None)
    ppk = min(ppu, ppl) if ppu is not None and ppl is not None else (
        ppu if ppu is not None else ppl
    )
    return {
        "p0135": float(q_lo), "median": float(median), "p99865": float(q_hi),
        "Pp": float(pp) if pp is not None else None,
        "Ppk": float(ppk) if ppk is not None else None,
        "Ppl": float(ppl) if ppl is not None else None,
        "Ppu": float(ppu) if ppu is not None else None,
    }


def _empirical_capability(x, lsl, usl):
    q = np.percentile(x, [0.135, 50.0, 99.865])
    out = _quantile_indices(*q, lsl, usl)
    out.update({"id": "empirical", "label": "Empirical percentiles"})
    return out


def _harrell_davis_capability(x, lsl, usl):
    q = np.asarray(stats.mstats.hdquantiles(x, prob=[0.00135, 0.5, 0.99865]), dtype=float)
    if q.size != 3 or not np.all(np.isfinite(q)):
        raise ValueError("Harrell-Davis quantiles were not finite.")
    out = _quantile_indices(*q, lsl, usl)
    out.update({"id": "harrell_davis", "label": "Harrell-Davis robust quantiles"})
    return out


_POSITIVE_DISTRIBUTIONS = {
    "lognormal": stats.lognorm,
    "weibull": stats.weibull_min,
    "gamma": stats.gamma,
}


def _fitted_capability(x, lsl, usl, distribution=None):
    if not np.all(x > 0):
        raise ValueError("Positive-support fitted models require all observations > 0.")
    candidates = ([distribution] if distribution else list(_POSITIVE_DISTRIBUTIONS))
    fits = []
    for name in candidates:
        dist = _POSITIVE_DISTRIBUTIONS[name]
        try:
            params = tuple(float(v) for v in dist.fit(x, floc=0))
            logpdf = np.asarray(dist.logpdf(x, *params), dtype=float)
            if not np.all(np.isfinite(logpdf)):
                continue
            aic = 2.0 * len(params) - 2.0 * float(np.sum(logpdf))
            q = np.asarray(dist.ppf([0.00135, 0.5, 0.99865], *params), dtype=float)
            if np.all(np.isfinite(q)) and q[0] < q[1] < q[2]:
                fits.append((aic, name, params, q))
        except (ValueError, FloatingPointError, RuntimeError):
            continue
    if not fits:
        raise ValueError("No positive-support distribution fit produced finite tail quantiles.")
    aic, name, params, q = min(fits, key=lambda row: row[0])
    out = _quantile_indices(*q, lsl, usl)
    out.update({
        "id": "fitted_distribution", "label": f"Fitted {name}",
        "distribution": name, "parameters": list(params), "AIC": float(aic),
    })
    return out


def _boxcox_capability(x, lsl, usl):
    if not np.all(x > 0):
        raise ValueError("Box-Cox requires all observations > 0.")
    transformed, lam = stats.boxcox(x)
    mu = float(np.mean(transformed))
    sigma = float(np.std(transformed, ddof=1))
    if not np.isfinite(sigma) or sigma <= 0:
        raise ValueError("Box-Cox transformed variation is zero.")
    z = stats.norm.ppf([0.00135, 0.5, 0.99865])
    q = special.inv_boxcox(mu + sigma * z, lam)
    if not np.all(np.isfinite(q)) or not q[0] < q[1] < q[2]:
        raise ValueError("Box-Cox model produced invalid tail quantiles.")
    out = _quantile_indices(*q, lsl, usl)
    out.update({
        "id": "boxcox_normal", "label": "Box-Cox transformed normal",
        "lambda": float(lam),
    })
    return out


def _bootstrap_nonnormal(methods, x, lsl, usl, samples, confidence, seed):
    if samples <= 0:
        return methods
    rng = np.random.default_rng(seed)
    values = {m["id"]: [] for m in methods}
    fitted_name = next((m.get("distribution") for m in methods
                        if m["id"] == "fitted_distribution"), None)
    for _ in range(samples):
        xb = rng.choice(x, size=len(x), replace=True)
        calculators = {
            "empirical": lambda: _empirical_capability(xb, lsl, usl),
            "harrell_davis": lambda: _harrell_davis_capability(xb, lsl, usl),
            "fitted_distribution": lambda: _fitted_capability(
                xb, lsl, usl, distribution=fitted_name
            ),
            "boxcox_normal": lambda: _boxcox_capability(xb, lsl, usl),
        }
        for method in methods:
            try:
                estimate = calculators[method["id"]]()
                if estimate["Ppk"] is not None and np.isfinite(estimate["Ppk"]):
                    values[method["id"]].append(float(estimate["Ppk"]))
            except (ValueError, FloatingPointError, RuntimeError):
                pass
    alpha = 1.0 - confidence
    for method in methods:
        draws = values[method["id"]]
        method["bootstrap_successes"] = len(draws)
        method["Ppk_bootstrap_ci"] = (
            [float(np.quantile(draws, alpha / 2)),
             float(np.quantile(draws, 1 - alpha / 2))]
            if len(draws) >= max(20, samples // 2) else None
        )
    return methods


def _stability_assessment(x, subgroup_size, requested_status):
    allowed = {"assess", "stable", "unstable", "not_assessed"}
    if requested_status not in allowed:
        raise ValueError(f"stability_status must be one of {sorted(allowed)}.")
    if requested_status != "assess":
        stable = requested_status == "stable"
        return {
            "status": requested_status,
            "source": "user_supplied",
            "stable": stable if requested_status != "not_assessed" else None,
            "signals": [],
            "decision_grade": stable,
            "note": ("Capability decision qualified by the supplied stable status."
                     if stable else "Capability decision withheld because stability was not demonstrated."),
        }

    if subgroup_size == 1:
        chart_data = x.tolist()
        chart_name = "i_mr"
    else:
        n_groups = len(x) // subgroup_size
        if n_groups < 2:
            return {
                "status": "not_assessed",
                "source": "computed_phase_i_control_chart",
                "stable": None,
                "signals": [],
                "decision_grade": False,
                "note": "Capability decision withheld: at least two rational subgroups are required to assess stability.",
            }
        chart_data = x[: n_groups * subgroup_size].reshape(n_groups, subgroup_size).tolist()
        chart_name = "xbar_r"
    chart = control_chart(
        chart_name, chart_data, phase="phase_i", phase_i_remove_signals=False
    )
    signals = []
    for subchart in chart["subcharts"]:
        for violation in subchart["violations"]:
            signals.append({"chart": subchart["name"], **violation})
    baseline_points = len(chart_data)
    stable = len(signals) == 0
    if stable and baseline_points < 20:
        return {
            "status": "not_assessed",
            "source": "computed_phase_i_control_chart",
            "chart": chart_name,
            "stable": None,
            "signals": [],
            "baseline_points": baseline_points,
            "decision_grade": False,
            "note": (
                "Capability decision withheld: no signal was detected, but fewer than "
                "20 Phase-I observations/subgroups provide too little baseline evidence."
            ),
        }
    return {
        "status": "stable" if stable else "unstable",
        "source": "computed_phase_i_control_chart",
        "chart": chart_name,
        "stable": stable,
        "signals": signals,
        "baseline_points": baseline_points,
        "decision_grade": stable,
        "note": ("No configured control-chart rule violations were detected."
                 if stable else
                 "Capability decision withheld: investigate and resolve the Phase-I special-cause signals."),
    }


def process_capability(
    data,
    lsl: Optional[float] = None,
    usl: Optional[float] = None,
    target: Optional[float] = None,
    subgroup_size: int = 1,
    n_bins: Optional[int] = None,
    stability_status: str = "assess",
    bootstrap_samples: int = 200,
    bootstrap_confidence: float = 0.95,
    seed: Optional[int] = 12345,
):
    """
    Compute process-capability statistics for a numeric data set.

    Parameters
    ----------
    data : sequence of float
        The measured values (in collection order, so within-subgroup
        variation is estimated correctly).
    lsl, usl : float, optional
        Lower / upper specification limits. At least one is required.
    target : float, optional
        Target value (nominal). Enables Cpm.
    subgroup_size : int
        Rational subgroup size. 1 => I-MR (average moving range). >1 =>
        average subgroup range.
    n_bins : int, optional
        Number of histogram bins (default: Sturges).

    Returns
    -------
    dict with capability indices, sigma estimates, defect rates, histogram
    bins, normality test and observed performance.
    """
    x = np.asarray([float(v) for v in data], dtype=float)
    if not np.all(np.isfinite(x)):
        raise ValueError("data must contain only finite measurements.")
    n = x.size
    if n < 2:
        raise ValueError("Need at least 2 data points.")
    if lsl is None and usl is None:
        raise ValueError("Provide at least one specification limit (LSL or USL).")
    if lsl is not None and usl is not None and lsl >= usl:
        raise ValueError("LSL must be less than USL.")
    if any(value is not None and not np.isfinite(value)
           for value in (lsl, usl, target)):
        raise ValueError("Specification limits and target must be finite.")
    if subgroup_size < 1:
        raise ValueError("subgroup_size must be >= 1.")
    if subgroup_size > 1:
        _d2(subgroup_size)  # fail closed rather than clamp a constants table
    if bootstrap_samples < 0 or bootstrap_samples > 5000:
        raise ValueError("bootstrap_samples must be between 0 and 5000.")
    if not 0.5 < bootstrap_confidence < 1.0:
        raise ValueError("bootstrap_confidence must be between 0.5 and 1.")

    mean = float(np.mean(x))
    std_overall = float(np.std(x, ddof=1))
    if std_overall <= 0:
        raise ValueError("Capability requires non-zero observed process variation.")

    # --- Within-subgroup sigma ---
    if subgroup_size == 1:
        # Average moving range / d2(2)
        mr = np.abs(np.diff(x))
        mr_bar = float(np.mean(mr)) if mr.size else 0.0
        std_within = mr_bar / _D2[2] if mr_bar > 0 else std_overall
        rbar = mr_bar
    else:
        m = n // subgroup_size
        if m < 1:
            raise ValueError("Not enough data for one full subgroup.")
        groups = x[: m * subgroup_size].reshape(m, subgroup_size)
        ranges = groups.max(axis=1) - groups.min(axis=1)
        rbar = float(np.mean(ranges))
        std_within = rbar / _d2(subgroup_size) if rbar > 0 else std_overall

    stability = _stability_assessment(x, subgroup_size, stability_status)

    if std_within <= 0:
        std_within = std_overall

    # --- Capability indices (potential, within sigma) ---
    def _idx(sigma):
        cpu = (usl - mean) / (3 * sigma) if usl is not None else None
        cpl = (mean - lsl) / (3 * sigma) if lsl is not None else None
        if usl is not None and lsl is not None:
            cp = (usl - lsl) / (6 * sigma)
            cpk = min(cpu, cpl)
        elif usl is not None:
            cp = None
            cpk = cpu
        else:
            cp = None
            cpk = cpl
        return cp, cpk, cpl, cpu

    Cp, Cpk, Cpl, Cpu = _idx(std_within)
    Pp, Ppk, Ppl, Ppu = _idx(std_overall)

    # --- Confidence intervals on Pp / Ppk (95%) ---
    # The chi-square interval Pp·sqrt(chi2_{a/2,v}/v) and the Bissell interval
    # for Ppk both assume the sigma estimate has v = n−1 df — true for the
    # OVERALL (sample-SD) sigma, so the CIs attach to Pp/Ppk. The within
    # (range-based) sigma behind Cp/Cpk has a smaller effective df, so naive
    # n−1 intervals there would be over-confident.
    ci_alpha = 0.05
    Pp_lower = Pp_upper = Ppk_lower = Ppk_upper = None
    v = n - 1
    if v > 0:
        if Pp is not None:
            Pp_lower = Pp * math.sqrt(stats.chi2.ppf(ci_alpha / 2, v) / v)
            Pp_upper = Pp * math.sqrt(stats.chi2.ppf(1 - ci_alpha / 2, v) / v)
        if Ppk is not None and Ppk > 0:
            z = stats.norm.isf(ci_alpha / 2)
            half = z * math.sqrt(1.0 / (9.0 * n * Ppk**2) + 1.0 / (2.0 * v))
            Ppk_lower = Ppk * (1 - half)
            Ppk_upper = Ppk * (1 + half)

    # --- Cpm (uses target) ---
    Cpm = None
    if target is not None and usl is not None and lsl is not None:
        denom = math.sqrt(std_overall**2 + (mean - target) ** 2)
        Cpm = (usl - lsl) / (6 * denom) if denom > 0 else None

    # --- Normal-model defect rates ---
    def _ppm(sigma):
        below = float(stats.norm.cdf(lsl, mean, sigma)) if lsl is not None else 0.0
        above = float(stats.norm.sf(usl, mean, sigma)) if usl is not None else 0.0
        return below, above

    below_w, above_w = _ppm(std_within)
    below_o, above_o = _ppm(std_overall)

    ppm_within = {
        "below_lsl": below_w * 1e6,
        "above_usl": above_w * 1e6,
        "total": (below_w + above_w) * 1e6,
    }
    ppm_overall = {
        "below_lsl": below_o * 1e6,
        "above_usl": above_o * 1e6,
        "total": (below_o + above_o) * 1e6,
    }

    # --- Z values (within) ---
    z_lsl = (mean - lsl) / std_within if lsl is not None else None
    z_usl = (usl - mean) / std_within if usl is not None else None
    total_within = below_w + above_w
    # Z.bench: the standard normal quantile such that P(defect) matches total
    z_bench = float(stats.norm.isf(total_within)) if 0 < total_within < 1 else None

    # --- Observed performance ---
    obs_below = int(np.sum(x < lsl)) if lsl is not None else 0
    obs_above = int(np.sum(x > usl)) if usl is not None else 0
    observed = {
        "below_lsl": obs_below / n * 1e6,
        "above_usl": obs_above / n * 1e6,
        "total": (obs_below + obs_above) / n * 1e6,
        "n_below": obs_below,
        "n_above": obs_above,
        "n": n,
    }

    # --- Histogram bins ---
    if n_bins is None:
        n_bins = max(5, int(math.ceil(math.log2(n) + 1)))  # Sturges
    counts, edges = np.histogram(x, bins=n_bins)
    histogram = {
        "counts": [int(c) for c in counts],
        "bin_edges": [float(e) for e in edges],
        "bin_centers": [float((edges[i] + edges[i + 1]) / 2) for i in range(len(edges) - 1)],
        "bin_width": float(edges[1] - edges[0]) if len(edges) > 1 else 0.0,
    }

    # --- Normality (Shapiro-Wilk) ---
    normality = {"test": "shapiro", "statistic": None, "p_value": None, "normal": None}
    if 3 <= n <= 5000:
        try:
            w, p = stats.shapiro(x)
            normality = {
                "test": "shapiro",
                "statistic": float(w),
                "p_value": float(p),
                "normal": bool(p >= 0.05),
            }
        except Exception:
            pass
    elif n > 5000:
        try:
            statistic, p = stats.normaltest(x)
            normality = {
                "test": "dagostino_pearson",
                "statistic": float(statistic),
                "p_value": float(p),
                "normal": bool(p >= 0.05),
            }
        except Exception:
            pass

    # --- Non-normal capability sensitivity analysis ---
    # A normality test is a diagnostic, not a model-selection switch.  When
    # it rejects, compare empirical, robust-quantile, fitted-distribution and
    # transformed-normal estimates.  Bootstrap intervals expose how little
    # information a typical study contains about 0.135% tails.
    non_normal = None
    if normality["normal"] is False:
        methods = []
        for calculator in (
            lambda: _empirical_capability(x, lsl, usl),
            lambda: _harrell_davis_capability(x, lsl, usl),
            lambda: _fitted_capability(x, lsl, usl),
            lambda: _boxcox_capability(x, lsl, usl),
        ):
            try:
                methods.append(calculator())
            except (ValueError, FloatingPointError, RuntimeError):
                pass
        methods = _bootstrap_nonnormal(
            methods, x, lsl, usl, bootstrap_samples, bootstrap_confidence, seed
        )
        empirical = next(m for m in methods if m["id"] == "empirical")
        boxcox = None
        if np.all(x > 0) and n >= 10:
            try:
                _, lam = stats.boxcox(x)
                common = [-2.0, -1.0, -0.5, 0.0, 0.5, 1.0, 2.0]
                lam_r = min(common, key=lambda c: abs(c - lam))
                xt = np.log(x) if lam_r == 0.0 else x ** lam_r
                sp = float(stats.shapiro(xt).pvalue) if 3 <= n <= 5000 else None
                boxcox = {
                    "lambda": float(lam),
                    "lambda_rounded": lam_r,
                    "transform": "log(x)" if lam_r == 0.0 else f"x^{lam_r:g}",
                    "shapiro_p_transformed": sp,
                    "restores_normality": (sp is not None and sp >= 0.05),
                }
            except Exception:
                boxcox = None

        ppk_values = [m["Ppk"] for m in methods
                      if m.get("Ppk") is not None and np.isfinite(m["Ppk"])]
        tail_expected = n * 0.00135
        tail_sufficient = tail_expected >= 5.0

        non_normal = {
            "method": "ISO 22514-4 percentile (empirical quantiles)",
            "p0135": empirical["p0135"],
            "median": empirical["median"],
            "p99865": empirical["p99865"],
            "Pp": empirical["Pp"],
            "Ppk": empirical["Ppk"],
            "Ppl": empirical["Ppl"],
            "Ppu": empirical["Ppu"],
            "boxcox": boxcox,
            "sensitivity": {
                "methods": methods,
                "Ppk_min": float(min(ppk_values)) if ppk_values else None,
                "Ppk_max": float(max(ppk_values)) if ppk_values else None,
                "bootstrap_samples": bootstrap_samples,
                "bootstrap_confidence": bootstrap_confidence,
                "tail_expected_observations_each_side": tail_expected,
                "tail_sufficient": tail_sufficient,
                "recommended_method": (
                    next((m["label"] for m in methods
                          if m["id"] == "fitted_distribution"),
                         "Harrell-Davis robust quantiles")
                ),
            },
            "note": (
                "The study contains fewer than five expected observations in each "
                "0.135% tail. Treat empirical tail capability as unstable and use "
                "the bootstrap/model sensitivity range."
                if not tail_sufficient else None
            ),
        }

    return {
        "n": n,
        "mean": mean,
        "std_within": std_within,
        "std_overall": std_overall,
        "r_bar": rbar,
        "subgroup_size": subgroup_size,
        "lsl": lsl,
        "usl": usl,
        "target": target,
        "Cp": Cp,
        "Cpk": Cpk,
        "Pp_lower": Pp_lower,
        "Pp_upper": Pp_upper,
        "Ppk_lower": Ppk_lower,
        "Ppk_upper": Ppk_upper,
        "ci_level": 1 - ci_alpha,
        "Cpl": Cpl,
        "Cpu": Cpu,
        "Pp": Pp,
        "Ppk": Ppk,
        "Ppl": Ppl,
        "Ppu": Ppu,
        "Cpm": Cpm,
        "Z_lsl": z_lsl,
        "Z_usl": z_usl,
        "Z_bench": z_bench,
        "ppm_within": ppm_within,
        "ppm_overall": ppm_overall,
        "observed": observed,
        "histogram": histogram,
        "normality": normality,
        # The indices and ppm/Z estimates assume normality — flag when the
        # Shapiro-Wilk test rejects it so users don't over-trust them.
        "normality_warning": (normality["normal"] is False),
        "normality_note": (
            "Data appears non-normal (Shapiro-Wilk p < 0.05); normal-model ppm, "
            "Z-bench and capability indices may be unreliable — consider a "
            "transformation or a non-normal capability model."
            if normality["normal"] is False else None
        ),
        "stability": stability,
        "decision_status": "qualified" if stability["decision_grade"] else "withheld",
        "decision_grade": bool(stability["decision_grade"]),
        "decision_note": stability["note"],
        "non_normal": non_normal,
        "min": float(np.min(x)),
        "max": float(np.max(x)),
    }
