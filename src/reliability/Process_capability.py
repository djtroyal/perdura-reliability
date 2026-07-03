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
from scipy import stats


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
    if n in _D2:
        return _D2[n]
    # Reasonable fallback for larger subgroups
    return _D2[25]


def process_capability(
    data,
    lsl: Optional[float] = None,
    usl: Optional[float] = None,
    target: Optional[float] = None,
    subgroup_size: int = 1,
    n_bins: Optional[int] = None,
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
    x = x[np.isfinite(x)]
    n = x.size
    if n < 2:
        raise ValueError("Need at least 2 data points.")
    if lsl is None and usl is None:
        raise ValueError("Provide at least one specification limit (LSL or USL).")
    if lsl is not None and usl is not None and lsl >= usl:
        raise ValueError("LSL must be less than USL.")
    if subgroup_size < 1:
        raise ValueError("subgroup_size must be >= 1.")

    mean = float(np.mean(x))
    std_overall = float(np.std(x, ddof=1))

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

    # --- Non-normal capability (ISO 22514-4 percentile method) ---
    # Reported when the normal model is rejected: replace the 6-sigma spread
    # with the empirical 99.865th-0.135th percentile span and the mean with
    # the median. Also suggest a Box-Cox transformation when the data are
    # positive.
    non_normal = None
    if normality["normal"] is False:
        p_lo, p_med, p_hi = (float(v) for v in
                             np.percentile(x, [0.135, 50.0, 99.865]))
        span = p_hi - p_lo
        nn_pp = (usl - lsl) / span if (usl is not None and lsl is not None and span > 0) else None
        nn_ppu = (usl - p_med) / (p_hi - p_med) if (usl is not None and p_hi > p_med) else None
        nn_ppl = (p_med - lsl) / (p_med - p_lo) if (lsl is not None and p_med > p_lo) else None
        if nn_ppu is not None and nn_ppl is not None:
            nn_ppk = min(nn_ppu, nn_ppl)
        else:
            nn_ppk = nn_ppu if nn_ppu is not None else nn_ppl

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

        non_normal = {
            "method": "ISO 22514-4 percentile (empirical quantiles)",
            "p0135": p_lo,
            "median": p_med,
            "p99865": p_hi,
            "Pp": nn_pp,
            "Ppk": nn_ppk,
            "Ppl": nn_ppl,
            "Ppu": nn_ppu,
            "boxcox": boxcox,
            "note": (
                "Percentile indices use the empirical 0.135%/50%/99.865% "
                "quantiles in place of the normal ±3-sigma span; with fewer "
                "than ~100 observations the tail quantiles are imprecise."
                if n < 100 else None
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
        "non_normal": non_normal,
        "min": float(np.min(x)),
        "max": float(np.max(x)),
    }
