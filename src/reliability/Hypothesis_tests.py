"""
Hypothesis Tests module for Perdura reliability/statistics suite.

All implementations use only numpy, scipy, and pandas.
No sklearn, statsmodels, or patsy dependencies.
"""

from __future__ import annotations

import math
import itertools
from typing import Optional

import numpy as np
import pandas as pd
from scipy import stats


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe(v):
    """Convert numpy scalar to Python float, handling nan/inf gracefully."""
    if v is None:
        return None
    try:
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    except (TypeError, ValueError):
        return None


def _ttest_ci(result, alpha: float):
    """(lower, upper) confidence interval from a scipy t-test result at level
    1−alpha — the CI on the mean (one-sample) or mean difference (two-sample/
    paired). Returns (None, None) if scipy is too old to provide it."""
    try:
        ci = result.confidence_interval(confidence_level=1 - alpha)
        return _safe(float(ci.low)), _safe(float(ci.high))
    except Exception:
        return None, None


def _hedges_g(d: float, n_total: int) -> float:
    """Hedges' g: Cohen's d with the small-sample bias correction
    J = 1 − 3/(4N − 9). Unbiased where d overstates the effect at small N."""
    if not np.isfinite(d) or n_total < 3:
        return d
    return float(d * (1.0 - 3.0 / (4.0 * n_total - 9.0)))


def _cohens_d_1samp(data: np.ndarray, popmean: float) -> float:
    """Cohen's d for one-sample t-test."""
    n = len(data)
    if n < 2:
        return float("nan")
    return float((np.mean(data) - popmean) / np.std(data, ddof=1))


def _cohens_d_2samp(a: np.ndarray, b: np.ndarray) -> float:
    """Cohen's d (pooled SD) for two independent samples."""
    na, nb = len(a), len(b)
    if na < 2 or nb < 2:
        return float("nan")
    pooled_var = ((na - 1) * np.var(a, ddof=1) + (nb - 1) * np.var(b, ddof=1)) / (na + nb - 2)
    return float((np.mean(a) - np.mean(b)) / math.sqrt(pooled_var))


def _rank_biserial(a: np.ndarray, b: np.ndarray, u_stat: float) -> float:
    """Rank-biserial correlation, positive when group ``a`` tends higher.

    SciPy reports the U statistic for its first sample.  That statistic counts
    first-sample wins (with half credit for ties), so the directional mapping
    is ``2 U_a / (n_a n_b) - 1``.
    """
    na, nb = len(a), len(b)
    return float((2.0 * u_stat) / (na * nb) - 1.0)


def _cramers_v(chi2: float, n: int, r: int, c: int) -> float:
    """Cramér's V effect size for chi-square independence."""
    k = min(r, c)
    if k <= 1 or n == 0:
        return float("nan")
    return float(math.sqrt(chi2 / (n * (k - 1))))


def _interpret(reject: bool, test: str) -> str:
    if reject:
        return f"Reject H₀: significant result ({test})."
    return f"Fail to reject H₀: no significant result ({test})."


# ---------------------------------------------------------------------------
# 1. One-sample t-test
# ---------------------------------------------------------------------------

def one_sample_t(
    data: list,
    popmean: float = 0.0,
    alpha: float = 0.05,
    alternative: str = "two-sided",
) -> dict:
    """
    One-sample t-test comparing sample mean to a population mean.

    Parameters
    ----------
    data : list of numeric values
    popmean : hypothesized population mean
    alpha : significance level
    alternative : 'two-sided', 'less', or 'greater'

    Returns
    -------
    dict with test results including Cohen's d effect size.
    """
    arr = np.asarray(data, dtype=float)
    if len(arr) < 2:
        raise ValueError("one_sample_t requires at least 2 observations.")
    result = stats.ttest_1samp(arr, popmean, alternative=alternative)
    statistic = float(result.statistic)
    p_value = float(result.pvalue)
    df = float(len(arr) - 1)
    d = _cohens_d_1samp(arr, popmean)
    reject = p_value < alpha
    ci_lo, ci_hi = _ttest_ci(result, alpha)
    return {
        "test": "One-sample t-test",
        "statistic": _safe(statistic),
        "p_value": _safe(p_value),
        "df": _safe(df),
        "effect_size": _safe(_hedges_g(d, len(arr))),
        "effect_size_name": "Hedges' g",
        "cohens_d": _safe(d),
        "alpha": alpha,
        "reject_null": reject,
        "alternative": alternative,
        "sample_mean": _safe(float(np.mean(arr))),
        "sample_sd": _safe(float(np.std(arr, ddof=1))),
        "n": len(arr),
        "popmean": popmean,
        # CI on the sample mean — the magnitude companion to the p-value.
        "ci_lower": ci_lo, "ci_upper": ci_hi, "ci_level": 1 - alpha,
        "ci_on": "mean",
        "interpretation": _interpret(reject, "one-sample t-test"),
    }


# ---------------------------------------------------------------------------
# 2. Two-sample t-test
# ---------------------------------------------------------------------------

def two_sample_t(
    a: list,
    b: list,
    alpha: float = 0.05,
    equal_var: bool = False,
    alternative: str = "two-sided",
) -> dict:
    """
    Two-sample t-test (Welch's when equal_var=False, Student's when True).

    Parameters
    ----------
    a, b : lists of numeric values (two groups)
    alpha : significance level
    equal_var : if True use Student's t (pooled variance); False = Welch
    alternative : 'two-sided', 'less', or 'greater'

    Returns
    -------
    dict with test results including Cohen's d effect size.
    """
    arr_a = np.asarray(a, dtype=float)
    arr_b = np.asarray(b, dtype=float)
    if len(arr_a) < 2 or len(arr_b) < 2:
        raise ValueError("two_sample_t requires at least 2 observations per group.")
    result = stats.ttest_ind(arr_a, arr_b, equal_var=equal_var, alternative=alternative)
    statistic = float(result.statistic)
    p_value = float(result.pvalue)
    df = _safe(float(result.df)) if hasattr(result, "df") else None
    d = _cohens_d_2samp(arr_a, arr_b)
    reject = p_value < alpha
    test_name = "Two-sample t-test (Student)" if equal_var else "Two-sample t-test (Welch)"
    return {
        "test": test_name,
        "statistic": _safe(statistic),
        "p_value": _safe(p_value),
        "df": df,
        "effect_size": _safe(_hedges_g(d, len(arr_a) + len(arr_b))),
        "effect_size_name": "Hedges' g",
        "cohens_d": _safe(d),
        "alpha": alpha,
        "reject_null": reject,
        "alternative": alternative,
        "equal_var": equal_var,
        "mean_a": _safe(float(np.mean(arr_a))),
        "mean_b": _safe(float(np.mean(arr_b))),
        "sd_a": _safe(float(np.std(arr_a, ddof=1))),
        "sd_b": _safe(float(np.std(arr_b, ddof=1))),
        "n_a": len(arr_a),
        "n_b": len(arr_b),
        # CI on the difference of means (a − b).
        "ci_lower": _ttest_ci(result, alpha)[0],
        "ci_upper": _ttest_ci(result, alpha)[1],
        "ci_level": 1 - alpha,
        "ci_on": "mean difference (a − b)",
        "interpretation": _interpret(reject, test_name),
    }


# ---------------------------------------------------------------------------
# 3. Paired t-test
# ---------------------------------------------------------------------------

def paired_t(
    a: list,
    b: list,
    alpha: float = 0.05,
    alternative: str = "two-sided",
) -> dict:
    """
    Paired t-test (before/after or matched pairs).

    Parameters
    ----------
    a, b : paired lists of equal length
    alpha : significance level
    alternative : 'two-sided', 'less', or 'greater'

    Returns
    -------
    dict with test results including Cohen's d on the differences.
    """
    arr_a = np.asarray(a, dtype=float)
    arr_b = np.asarray(b, dtype=float)
    if len(arr_a) != len(arr_b):
        raise ValueError("paired_t requires equal-length arrays.")
    if len(arr_a) < 2:
        raise ValueError("paired_t requires at least 2 pairs.")
    diffs = arr_a - arr_b
    result = stats.ttest_rel(arr_a, arr_b, alternative=alternative)
    statistic = float(result.statistic)
    p_value = float(result.pvalue)
    df = float(len(arr_a) - 1)
    d = float(np.mean(diffs) / np.std(diffs, ddof=1))
    reject = p_value < alpha
    return {
        "test": "Paired t-test",
        "statistic": _safe(statistic),
        "p_value": _safe(p_value),
        "df": _safe(df),
        "effect_size": _safe(_hedges_g(d, len(arr_a))),
        "effect_size_name": "Hedges' g (on differences)",
        "cohens_d": _safe(d),
        "alpha": alpha,
        "reject_null": reject,
        "alternative": alternative,
        "mean_diff": _safe(float(np.mean(diffs))),
        "sd_diff": _safe(float(np.std(diffs, ddof=1))),
        "n": len(arr_a),
        # CI on the mean of the paired differences.
        "ci_lower": _ttest_ci(result, alpha)[0],
        "ci_upper": _ttest_ci(result, alpha)[1],
        "ci_level": 1 - alpha,
        "ci_on": "mean difference",
        "interpretation": _interpret(reject, "paired t-test"),
    }


# ---------------------------------------------------------------------------
# 4. Mann-Whitney U test
# ---------------------------------------------------------------------------

def mann_whitney(
    a: list,
    b: list,
    alpha: float = 0.05,
    alternative: str = "two-sided",
) -> dict:
    """
    Mann-Whitney U test (nonparametric two-sample location test).

    Parameters
    ----------
    a, b : lists of numeric values
    alpha : significance level
    alternative : 'two-sided', 'less', or 'greater'

    Returns
    -------
    dict with U statistic, p-value, and rank-biserial correlation.
    """
    arr_a = np.asarray(a, dtype=float)
    arr_b = np.asarray(b, dtype=float)
    if len(arr_a) < 1 or len(arr_b) < 1:
        raise ValueError("mann_whitney requires at least 1 observation per group.")
    result = stats.mannwhitneyu(arr_a, arr_b, alternative=alternative)
    u_stat = float(result.statistic)
    p_value = float(result.pvalue)
    rb = _rank_biserial(arr_a, arr_b, u_stat)
    reject = p_value < alpha
    return {
        "test": "Mann-Whitney U",
        "statistic": _safe(u_stat),
        "p_value": _safe(p_value),
        "df": None,
        "effect_size": _safe(rb),
        "effect_size_name": "Rank-biserial correlation",
        "effect_size_direction": (
            "positive means group_a tends to be larger than group_b; "
            "negative means group_a tends to be smaller"
        ),
        "alpha": alpha,
        "reject_null": reject,
        "alternative": alternative,
        "n_a": len(arr_a),
        "n_b": len(arr_b),
        "interpretation": _interpret(reject, "Mann-Whitney U"),
    }


# ---------------------------------------------------------------------------
# 5. Wilcoxon signed-rank test
# ---------------------------------------------------------------------------

def wilcoxon_signed_rank(
    a: list,
    b: list,
    alpha: float = 0.05,
    alternative: str = "two-sided",
) -> dict:
    """
    Wilcoxon signed-rank test for paired samples.

    Parameters
    ----------
    a, b : paired lists of equal length
    alpha : significance level
    alternative : 'two-sided', 'less', or 'greater'

    Returns
    -------
    dict with W statistic and p-value.
    """
    arr_a = np.asarray(a, dtype=float)
    arr_b = np.asarray(b, dtype=float)
    if len(arr_a) != len(arr_b):
        raise ValueError("wilcoxon_signed_rank requires equal-length arrays.")
    if len(arr_a) < 1:
        raise ValueError("wilcoxon_signed_rank requires at least 1 pair.")
    result = stats.wilcoxon(arr_a, arr_b, alternative=alternative)
    statistic = float(result.statistic)
    p_value = float(result.pvalue)
    reject = p_value < alpha
    return {
        "test": "Wilcoxon Signed-Rank",
        "statistic": _safe(statistic),
        "p_value": _safe(p_value),
        "df": None,
        "effect_size": None,
        "alpha": alpha,
        "reject_null": reject,
        "alternative": alternative,
        "n": len(arr_a),
        "interpretation": _interpret(reject, "Wilcoxon signed-rank"),
    }


# ---------------------------------------------------------------------------
# 6. Chi-square goodness-of-fit
# ---------------------------------------------------------------------------

def chi_square_gof(
    observed: list,
    expected: Optional[list] = None,
    alpha: float = 0.05,
    ddof: int = 0,
) -> dict:
    """
    Chi-square goodness-of-fit test.

    Parameters
    ----------
    observed : observed frequencies
    expected : expected frequencies (None = uniform)
    alpha : significance level
    ddof : number of parameters estimated from the data to produce the
        expected frequencies. df = k − 1 − ddof; ignoring this makes the
        test anti-conservative when expecteds come from a fitted model.

    Returns
    -------
    dict with chi2 statistic, df, p-value, and a small-expected-count warning.
    """
    obs = np.asarray(observed, dtype=float)
    if len(obs) < 2:
        raise ValueError("chi_square_gof requires at least 2 categories.")
    if ddof < 0 or ddof > len(obs) - 2:
        raise ValueError("ddof must be between 0 and k-2.")
    exp = np.asarray(expected, dtype=float) if expected is not None else None
    result = stats.chisquare(obs, f_exp=exp, ddof=ddof)
    chi2 = float(result.statistic)
    p_value = float(result.pvalue)
    df = float(len(obs) - 1 - ddof)
    reject = p_value < alpha

    # Cochran's rule: the chi-square approximation degrades when expected
    # counts drop below 5.
    exp_check = exp if exp is not None else np.full(len(obs), obs.sum() / len(obs))
    warning = None
    if np.min(exp_check) < 5:
        warning = ("One or more expected counts are below 5 — the chi-square "
                   "approximation may be unreliable; consider pooling categories.")

    return {
        "test": "Chi-square goodness-of-fit",
        "statistic": _safe(chi2),
        "p_value": _safe(p_value),
        "df": _safe(df),
        "ddof": ddof,
        "effect_size": None,
        "alpha": alpha,
        "reject_null": reject,
        "n_categories": len(obs),
        "warning": warning,
        "interpretation": _interpret(reject, "chi-square goodness-of-fit"),
    }


# ---------------------------------------------------------------------------
# 7. Chi-square test of independence
# ---------------------------------------------------------------------------

def chi_square_independence(
    table: list,
    alpha: float = 0.05,
) -> dict:
    """
    Chi-square test of independence on a contingency table.

    Parameters
    ----------
    table : 2D list (rows x cols) of observed counts
    alpha : significance level

    Returns
    -------
    dict with chi2, df, p-value, and Cramér's V.
    """
    arr = np.asarray(table, dtype=float)
    if arr.ndim != 2:
        raise ValueError("chi_square_independence requires a 2D contingency table.")
    chi2, p_value, df, expected = stats.chi2_contingency(arr)
    # Cramér's V must come from the UNCORRECTED statistic — the Yates
    # continuity correction (applied by scipy to 2x2 tables for the p-value)
    # deflates the effect size.
    chi2_uncorr, _, _, _ = stats.chi2_contingency(arr, correction=False)
    n = int(arr.sum())
    r, c = arr.shape
    v = _cramers_v(float(chi2_uncorr), n, r, c)
    reject = p_value < alpha

    warning = None
    if np.min(expected) < 5:
        warning = ("One or more expected counts are below 5 — prefer Fisher's "
                   "exact test for small 2x2 tables.")

    return {
        "test": "Chi-square test of independence",
        "statistic": _safe(float(chi2)),
        "p_value": _safe(float(p_value)),
        "df": _safe(float(df)),
        "effect_size": _safe(v),
        "effect_size_name": "Cramér's V",
        "alpha": alpha,
        "reject_null": reject,
        "n": n,
        "shape": list(arr.shape),
        "warning": warning,
        "interpretation": _interpret(reject, "chi-square independence"),
    }


# ---------------------------------------------------------------------------
# 8. Binomial test
# ---------------------------------------------------------------------------

def binomial_test(
    successes: int,
    n: int,
    p: float = 0.5,
    alpha: float = 0.05,
    alternative: str = "two-sided",
) -> dict:
    """
    Exact binomial test.

    Parameters
    ----------
    successes : number of successes
    n : number of trials
    p : hypothesized success probability
    alpha : significance level
    alternative : 'two-sided', 'less', or 'greater'

    Returns
    -------
    dict with p-value and observed proportion.
    """
    if n < 1:
        raise ValueError("n must be >= 1.")
    if successes < 0 or successes > n:
        raise ValueError("successes must be between 0 and n.")
    result = stats.binomtest(successes, n, p, alternative=alternative)
    p_value = float(result.pvalue)
    reject = p_value < alpha
    obs_prop = successes / n
    # Exact (Clopper-Pearson) CI on the observed proportion — the magnitude
    # companion to the exact p-value.
    ci = result.proportion_ci(confidence_level=1 - alpha, method="exact")
    return {
        "test": "Binomial test",
        "statistic": _safe(obs_prop),
        "p_value": _safe(p_value),
        "df": None,
        "effect_size": None,
        "alpha": alpha,
        "reject_null": reject,
        "alternative": alternative,
        "successes": successes,
        "n": n,
        "p_null": p,
        "p_observed": _safe(obs_prop),
        "ci_lower": _safe(float(ci.low)),
        "ci_upper": _safe(float(ci.high)),
        "ci_level": 1 - alpha,
        "ci_on": "proportion (Clopper-Pearson exact)",
        "interpretation": _interpret(reject, "binomial test"),
    }


# ---------------------------------------------------------------------------
# 9. One-way ANOVA
# ---------------------------------------------------------------------------

def one_way_anova(
    groups: list,
    alpha: float = 0.05,
) -> dict:
    """
    One-way ANOVA with eta-squared effect size and Bonferroni pairwise comparisons.

    Parameters
    ----------
    groups : list of lists (each inner list is one group)
    alpha : significance level

    Returns
    -------
    dict with F statistic, p-value, eta-squared, group means, and pairwise comparisons.
    """
    arrs = [np.asarray(g, dtype=float) for g in groups]
    if len(arrs) < 2:
        raise ValueError("one_way_anova requires at least 2 groups.")
    for i, g in enumerate(arrs):
        if len(g) < 2:
            raise ValueError(f"Group {i} must have at least 2 observations.")
    f_stat, p_value = stats.f_oneway(*arrs)
    f_stat = float(f_stat)
    p_value = float(p_value)

    # Effect size: eta-squared
    grand_mean = np.mean(np.concatenate(arrs))
    ss_between = float(sum(len(g) * (np.mean(g) - grand_mean) ** 2 for g in arrs))
    ss_within = float(sum(np.sum((g - np.mean(g)) ** 2) for g in arrs))
    ss_total = ss_between + ss_within
    eta_sq = ss_between / ss_total if ss_total > 0 else float("nan")

    k = len(arrs)
    n_total = sum(len(g) for g in arrs)
    df_between = k - 1
    df_within = n_total - k

    group_means = [_safe(float(np.mean(g))) for g in arrs]
    group_sds = [_safe(float(np.std(g, ddof=1))) for g in arrs]
    group_ns = [len(g) for g in arrs]

    # Tukey HSD pairwise comparisons (studentized range on the pooled error
    # term) — the standard all-pairs procedure after a pooled ANOVA; the
    # previous Bonferroni-Welch mixture was over-conservative and
    # inconsistent with the equal-variance omnibus test above.
    ms_within = ss_within / df_within if df_within > 0 else float("nan")
    pairs = list(itertools.combinations(range(k), 2))
    q_crit = float(stats.studentized_range.ppf(1 - alpha, k, df_within)) if df_within > 0 else float("nan")
    pairwise = []
    for i, j in pairs:
        ni, nj = len(arrs[i]), len(arrs[j])
        mean_diff = float(np.mean(arrs[i]) - np.mean(arrs[j]))
        # Tukey-Kramer SE for (possibly) unequal group sizes.
        se_pair = math.sqrt(ms_within / 2.0 * (1.0 / ni + 1.0 / nj))
        if se_pair > 0 and df_within > 0:
            q_stat = abs(mean_diff) / se_pair
            p_adj = float(stats.studentized_range.sf(q_stat, k, df_within))
            half = q_crit * se_pair
            lo, hi = mean_diff - half, mean_diff + half
        else:
            q_stat, p_adj, lo, hi = float("nan"), float("nan"), None, None
        pairwise.append({
            "group_i": i,
            "group_j": j,
            "mean_diff": _safe(mean_diff),
            "q_statistic": _safe(q_stat),
            "p_value_tukey": _safe(p_adj),
            # Back-compat aliases (previously Bonferroni-adjusted values).
            "p_value_raw": _safe(p_adj),
            "p_value_bonferroni": _safe(p_adj),
            "ci_lower": _safe(lo),
            "ci_upper": _safe(hi),
            "significant": bool(p_adj < alpha) if np.isfinite(p_adj) else False,
        })

    reject = p_value < alpha
    return {
        "test": "One-way ANOVA",
        "statistic": _safe(f_stat),
        "p_value": _safe(p_value),
        "df": {"between": df_between, "within": df_within},
        "effect_size": _safe(eta_sq),
        "effect_size_name": "Eta-squared",
        "alpha": alpha,
        "reject_null": reject,
        "ss_between": _safe(ss_between),
        "ss_within": _safe(ss_within),
        "ss_total": _safe(ss_total),
        "ms_between": _safe(ss_between / df_between) if df_between > 0 else None,
        "ms_within": _safe(ss_within / df_within) if df_within > 0 else None,
        "k": k,
        "n_total": n_total,
        "group_means": group_means,
        "group_sds": group_sds,
        "group_ns": group_ns,
        "posthoc_method": "Tukey HSD",
        "pairwise_tukey": pairwise,
        # Back-compat alias — same rows (now Tukey-adjusted).
        "pairwise_bonferroni": pairwise,
        "interpretation": _interpret(reject, "one-way ANOVA"),
    }


# ---------------------------------------------------------------------------
# 10. Kruskal-Wallis test
# ---------------------------------------------------------------------------

def kruskal_wallis(
    groups: list,
    alpha: float = 0.05,
) -> dict:
    """
    Kruskal-Wallis H test (nonparametric one-way ANOVA on ranks).

    Parameters
    ----------
    groups : list of lists
    alpha : significance level

    Returns
    -------
    dict with H statistic and p-value.
    """
    arrs = [np.asarray(g, dtype=float) for g in groups]
    if len(arrs) < 2:
        raise ValueError("kruskal_wallis requires at least 2 groups.")
    h_stat, p_value = stats.kruskal(*arrs)
    k = len(arrs)
    df = k - 1
    n_total = sum(len(g) for g in arrs)
    # Epsilon-squared: the standard rank-based effect size for K-W,
    # ε² = (H − k + 1)/(n − k).
    eps_sq = (float(h_stat) - k + 1) / (n_total - k) if n_total > k else None
    reject = p_value < alpha
    return {
        "test": "Kruskal-Wallis H",
        "statistic": _safe(float(h_stat)),
        "p_value": _safe(float(p_value)),
        "df": _safe(float(df)),
        "effect_size": _safe(eps_sq),
        "effect_size_name": "Epsilon-squared",
        "alpha": alpha,
        "reject_null": reject,
        "k": k,
        "group_ns": [len(g) for g in arrs],
        "group_medians": [_safe(float(np.median(g))) for g in arrs],
        "interpretation": _interpret(reject, "Kruskal-Wallis"),
    }


# ---------------------------------------------------------------------------
# 11. Friedman test
# ---------------------------------------------------------------------------

def friedman(
    groups: list,
    alpha: float = 0.05,
) -> dict:
    """
    Friedman test (nonparametric repeated-measures ANOVA).

    Parameters
    ----------
    groups : list of lists of equal length (each list is one condition/column)
    alpha : significance level

    Returns
    -------
    dict with chi2 statistic and p-value.
    """
    arrs = [np.asarray(g, dtype=float) for g in groups]
    if len(arrs) < 2:
        raise ValueError("friedman requires at least 2 groups.")
    n = len(arrs[0])
    for i, g in enumerate(arrs):
        if len(g) != n:
            raise ValueError(f"All groups must have equal length for Friedman test (group {i} differs).")
    chi2, p_value = stats.friedmanchisquare(*arrs)
    k = len(arrs)
    df = k - 1
    # Kendall's W (coefficient of concordance): W = chi2 / (n·(k−1)).
    kendalls_w = float(chi2) / (n * (k - 1)) if n > 0 and k > 1 else None
    reject = p_value < alpha
    return {
        "test": "Friedman",
        "statistic": _safe(float(chi2)),
        "p_value": _safe(float(p_value)),
        "df": _safe(float(df)),
        "effect_size": _safe(kendalls_w),
        "effect_size_name": "Kendall's W",
        "alpha": alpha,
        "reject_null": reject,
        "k": k,
        "n": n,
        "interpretation": _interpret(reject, "Friedman"),
    }


# ---------------------------------------------------------------------------
# 12. Factorial ANOVA (1-, 2-, or 3-way with interactions)
# ---------------------------------------------------------------------------

def _ss_total(y: np.ndarray) -> float:
    """Total sum of squares."""
    return float(np.sum((y - np.mean(y)) ** 2))


def _ss_factor(df: pd.DataFrame, response: str, factor: str) -> float:
    """SS for a single factor (Type I sequential)."""
    grand_mean = df[response].mean()
    return float(df.groupby(factor)[response].apply(
        lambda g: len(g) * (g.mean() - grand_mean) ** 2
    ).sum())


def _ss_interaction_2way(df: pd.DataFrame, response: str, f1: str, f2: str) -> float:
    """SS for the 2-way interaction A:B (after main effects)."""
    grand_mean = df[response].mean()
    ss_a = _ss_factor(df, response, f1)
    ss_b = _ss_factor(df, response, f2)
    # Cell means
    cell_means = df.groupby([f1, f2])[response].mean()
    cell_ns = df.groupby([f1, f2])[response].count()
    marg_a = df.groupby(f1)[response].mean()
    marg_b = df.groupby(f2)[response].mean()
    ss_cells = float(
        ((cell_means - marg_a.reindex(cell_means.index, level=0)
          - marg_b.reindex(cell_means.index, level=1)
          + grand_mean) ** 2 * cell_ns).sum()
    )
    return ss_cells


def _ss_interaction_3way(
    df: pd.DataFrame, response: str, f1: str, f2: str, f3: str
) -> float:
    """SS for the 3-way interaction A:B:C (after main effects and 2-way interactions)."""
    grand_mean = df[response].mean()
    marg_a = df.groupby(f1)[response].mean()
    marg_b = df.groupby(f2)[response].mean()
    marg_c = df.groupby(f3)[response].mean()
    marg_ab = df.groupby([f1, f2])[response].mean()
    marg_ac = df.groupby([f1, f3])[response].mean()
    marg_bc = df.groupby([f2, f3])[response].mean()

    def _coef(group):
        a_val, b_val, c_val = group.name
        return (
            df.groupby([f1, f2, f3])[response].mean().get((a_val, b_val, c_val), grand_mean)
            - marg_ab.get((a_val, b_val), grand_mean)
            - marg_ac.get((a_val, c_val), grand_mean)
            - marg_bc.get((b_val, c_val), grand_mean)
            + marg_a.get(a_val, grand_mean)
            + marg_b.get(b_val, grand_mean)
            + marg_c.get(c_val, grand_mean)
            - grand_mean
        )

    cell_ns = df.groupby([f1, f2, f3])[response].count()
    cell_groups = df.groupby([f1, f2, f3])
    ss = 0.0
    for name, group in cell_groups:
        a_val, b_val, c_val = name
        cell_mean = group[response].mean()
        n_cell = len(group)
        coeff = (
            cell_mean
            - marg_ab.get((a_val, b_val), grand_mean)
            - marg_ac.get((a_val, c_val), grand_mean)
            - marg_bc.get((b_val, c_val), grand_mean)
            + marg_a.get(a_val, grand_mean)
            + marg_b.get(b_val, grand_mean)
            + marg_c.get(c_val, grand_mean)
            - grand_mean
        )
        ss += n_cell * coeff ** 2
    return float(ss)


def _levels(df: pd.DataFrame, col: str) -> int:
    return df[col].nunique()


def _term_columns(df: pd.DataFrame, term: tuple) -> np.ndarray:
    """Treatment (dummy) coded design columns for an ANOVA term.

    ``term`` is a tuple of factor names; the columns are the products of each
    factor's level indicators (dropping the first level as reference)."""
    blocks = []
    for f in term:
        levels = sorted(df[f].astype(str).unique())
        block = np.column_stack(
            [(df[f].astype(str) == lev).astype(float).values for lev in levels[1:]]
        ) if len(levels) > 1 else np.zeros((len(df), 0))
        blocks.append(block)
    out = blocks[0]
    for b in blocks[1:]:
        if out.shape[1] == 0 or b.shape[1] == 0:
            return np.zeros((len(df), 0))
        out = np.einsum('ni,nj->nij', out, b).reshape(len(df), -1)
    return out


def _sse_of_terms(y: np.ndarray, terms: list, term_cols: dict) -> float:
    """Residual SS of the OLS fit with an intercept plus the given terms."""
    X = [np.ones((len(y), 1))]
    for t in terms:
        X.append(term_cols[t])
    X = np.hstack(X)
    beta, _, _, _ = np.linalg.lstsq(X, y, rcond=None)
    fitted = X @ beta
    return float(np.sum((y - fitted) ** 2))


def _type2_anova(df: pd.DataFrame, response: str, factor_names: list):
    """Type-II ANOVA decomposition via regression (for unbalanced designs).

    For each term T: SS_II(T) = SSE(model without T and without any term
    containing T) − SSE(that model plus T) — the marginality-respecting
    comparison. Returns (rows, ss_res, df_res) with rows = (name, SS, df).
    """
    y = df[response].values.astype(float)
    mains = [(f,) for f in factor_names]
    twoways = [tuple(c) for c in itertools.combinations(factor_names, 2)] if len(factor_names) >= 2 else []
    threeways = [tuple(factor_names)] if len(factor_names) == 3 else []
    all_terms = mains + twoways + threeways

    term_cols = {t: _term_columns(df, t) for t in all_terms}
    term_df = {t: term_cols[t].shape[1] for t in all_terms}

    rows = []
    for t in all_terms:
        containing = [u for u in all_terms if u != t and set(t).issubset(set(u))]
        base = [u for u in all_terms if u != t and u not in containing]
        sse_without = _sse_of_terms(y, base, term_cols)
        sse_with = _sse_of_terms(y, base + [t], term_cols)
        rows.append((':'.join(t), max(sse_without - sse_with, 0.0), term_df[t]))

    ss_res = _sse_of_terms(y, all_terms, term_cols)
    df_res = len(y) - 1 - sum(term_df.values())
    return rows, ss_res, df_res


def anova_factorial(
    response: list,
    factors: dict,
    factor_names: list,
    alpha: float = 0.05,
) -> dict:
    """
    Factorial ANOVA for 1, 2, or 3 factors with all interactions.

    Uses Type I (sequential) SS decomposition via pandas groupby.
    For balanced designs Type I == Type III. For unbalanced designs
    this produces sequential SS — interpretation requires care.

    Parameters
    ----------
    response : list of numeric response values
    factors : dict mapping factor name -> list of factor levels (same length as response)
    factor_names : list of factor names to include (1, 2, or 3)
    alpha : significance level

    Returns
    -------
    dict with ANOVA table rows (each factor, interactions, Residual, Total),
    partial eta-squared, and overall result.
    """
    if len(factor_names) < 1 or len(factor_names) > 3:
        raise ValueError("anova_factorial supports 1, 2, or 3 factors.")
    df_data: dict = {"__response__": list(response)}
    for fn in factor_names:
        if fn not in factors:
            raise ValueError(f"Factor '{fn}' not found in factors dict.")
        df_data[fn] = list(factors[fn])

    df = pd.DataFrame(df_data)
    y = df["__response__"].values.astype(float)
    n = len(y)
    ss_tot = _ss_total(y)

    # Balanced check. For balanced designs the fast groupby (Type I) SS are
    # exact (Type I == II == III). For unbalanced data the sequential SS are
    # non-orthogonal and the F-tests invalid, so switch to the regression-
    # based Type-II decomposition.
    cell_counts = df.groupby(factor_names)["__response__"].count()
    is_balanced = (cell_counts.nunique() == 1)

    if is_balanced:
        balance_note = "balanced"
        rows = []
        ss_explained = 0.0

        if len(factor_names) >= 1:
            f1 = factor_names[0]
            ss_f1 = _ss_factor(df, "__response__", f1)
            df_f1 = _levels(df, f1) - 1
            rows.append((f1, ss_f1, df_f1))
            ss_explained += ss_f1

        if len(factor_names) >= 2:
            f2 = factor_names[1]
            ss_f2 = _ss_factor(df, "__response__", f2)
            df_f2 = _levels(df, f2) - 1
            rows.append((f2, ss_f2, df_f2))
            ss_explained += ss_f2

            # 2-way interaction
            ss_ab = _ss_interaction_2way(df, "__response__", f1, f2)
            df_ab = df_f1 * df_f2
            rows.append((f"{f1}:{f2}", ss_ab, df_ab))
            ss_explained += ss_ab

        if len(factor_names) == 3:
            f3 = factor_names[2]
            ss_f3 = _ss_factor(df, "__response__", f3)
            df_f3 = _levels(df, f3) - 1
            rows.append((f3, ss_f3, df_f3))
            ss_explained += ss_f3

            # Remaining 2-way interactions
            ss_ac = _ss_interaction_2way(df, "__response__", f1, f3)
            df_ac = (rows[0][2]) * df_f3
            rows.append((f"{f1}:{f3}", ss_ac, df_ac))
            ss_explained += ss_ac

            ss_bc = _ss_interaction_2way(df, "__response__", f2, f3)
            df_bc = (rows[1][2]) * df_f3
            rows.append((f"{f2}:{f3}", ss_bc, df_bc))
            ss_explained += ss_bc

            # 3-way interaction
            ss_abc = _ss_interaction_3way(df, "__response__", f1, f2, f3)
            df_abc = (rows[0][2]) * (rows[1][2]) * df_f3
            rows.append((f"{f1}:{f2}:{f3}", ss_abc, df_abc))
            ss_explained += ss_abc

        ss_res = max(ss_tot - ss_explained, 0.0)
        df_res = n - 1 - sum(r[2] for r in rows)
    else:
        balance_note = "unbalanced (Type II SS via regression)"
        rows, ss_res, df_res = _type2_anova(df, "__response__", factor_names)

    if df_res < 1:
        raise ValueError("Not enough degrees of freedom for residual. Check your data.")
    ms_res = ss_res / df_res

    table_rows = []
    for (source, ss, df_src) in rows:
        ms = ss / df_src if df_src > 0 else float("nan")
        f_val = ms / ms_res if ms_res > 0 else float("nan")
        p_val = float(stats.f.sf(f_val, df_src, df_res)) if not math.isnan(f_val) else float("nan")
        partial_eta = ss / (ss + ss_res) if (ss + ss_res) > 0 else float("nan")
        table_rows.append({
            "source": source,
            "SS": _safe(ss),
            "df": int(df_src),
            "MS": _safe(ms),
            "F": _safe(f_val),
            "p_value": _safe(p_val),
            "partial_eta_sq": _safe(partial_eta),
            "significant": p_val < alpha if not math.isnan(p_val) else False,
        })

    table_rows.append({
        "source": "Residual",
        "SS": _safe(ss_res),
        "df": int(df_res),
        "MS": _safe(ms_res),
        "F": None,
        "p_value": None,
        "partial_eta_sq": None,
        "significant": None,
    })
    table_rows.append({
        "source": "Total",
        "SS": _safe(ss_tot),
        "df": int(n - 1),
        "MS": None,
        "F": None,
        "p_value": None,
        "partial_eta_sq": None,
        "significant": None,
    })

    # Top-level statistic is the OMNIBUS model F (all model terms vs residual),
    # not the first main effect — the latter misled callers reading only the
    # headline fields.
    df_model = sum(r[2] for r in rows)
    ss_model = max(ss_tot - ss_res, 0.0)
    if df_model > 0 and ms_res > 0:
        f_model = (ss_model / df_model) / ms_res
        p_model = float(stats.f.sf(f_model, df_model, df_res))
    else:
        f_model, p_model = float("nan"), float("nan")
    reject = (not math.isnan(p_model)) and p_model < alpha

    return {
        "test": f"Factorial ANOVA ({len(factor_names)}-way)",
        "statistic": _safe(f_model),
        "p_value": _safe(p_model),
        "df": {"model": int(df_model), "residual": int(df_res)},
        "effect_size": _safe(ss_model / ss_tot) if ss_tot > 0 else None,
        "effect_size_name": "R-squared (model)",
        "alpha": alpha,
        "reject_null": reject,
        "anova_table": table_rows,
        "n": n,
        "balance_note": balance_note,
        "interpretation": f"Omnibus model F over all terms ({balance_note}). See anova_table for per-term tests.",
    }


# ---------------------------------------------------------------------------
# 13. Repeated-measures ANOVA (one within-subject factor)
# ---------------------------------------------------------------------------

def _sphericity_diagnostics(mat: np.ndarray, alpha: float) -> dict:
    """Mauchly diagnostic and epsilon estimates in contrast space."""
    n_subj, n_cond = mat.shape
    contrast_df = n_cond - 1
    lower_bound = 1.0 / contrast_df
    if n_cond == 2:
        return {
            "status": "not_applicable_two_conditions",
            "W": 1.0, "chi_square": 0.0, "df": 0, "p_value": 1.0,
            "reject_sphericity": False,
            "epsilon_greenhouse_geisser": 1.0,
            "epsilon_huynh_feldt": 1.0,
            "epsilon_lower_bound": 1.0,
        }

    covariance = np.cov(mat, rowvar=False, ddof=1)
    # An orthonormal basis for the centered subspace removes the common-mean
    # direction without relying on a particular named contrast convention.
    centered = np.eye(n_cond) - np.ones((n_cond, n_cond)) / n_cond
    eigenvalues, eigenvectors = np.linalg.eigh(centered)
    Q = eigenvectors[:, eigenvalues > 0.5]
    contrast_cov = Q.T @ covariance @ Q
    trace = float(np.trace(contrast_cov))
    trace_sq = float(np.trace(contrast_cov @ contrast_cov))
    if not np.isfinite(trace) or trace <= 0 or trace_sq <= 0:
        return {
            "status": "inconclusive_zero_variance", "W": None,
            "chi_square": None, "df": int(contrast_df * (contrast_df + 1) / 2 - 1),
            "p_value": None, "reject_sphericity": None,
            "epsilon_greenhouse_geisser": None,
            "epsilon_huynh_feldt": None,
            "epsilon_lower_bound": lower_bound,
        }

    epsilon_gg = float(np.clip(
        trace ** 2 / (contrast_df * trace_sq), lower_bound, 1.0))
    hf_denominator = contrast_df * (
        n_subj - 1.0 - contrast_df * epsilon_gg)
    if hf_denominator > 0:
        epsilon_hf = float(np.clip(
            (n_subj * contrast_df * epsilon_gg - 2.0) / hf_denominator,
            lower_bound, 1.0))
    else:
        epsilon_hf = 1.0

    sign, logdet = np.linalg.slogdet(contrast_cov)
    if sign <= 0:
        W = 0.0
        chi_square = float("inf")
        p_value = 0.0
        status = "singular_covariance"
    else:
        log_w = float(logdet - contrast_df * math.log(trace / contrast_df))
        W = float(np.clip(math.exp(log_w), 0.0, 1.0))
        correction = (
            1.0
            - (2.0 * contrast_df ** 2 + contrast_df + 2.0)
            / (6.0 * contrast_df * (n_subj - 1.0))
        )
        df_mauchly = int(contrast_df * (contrast_df + 1) / 2 - 1)
        if correction <= 0 or df_mauchly <= 0:
            chi_square = float("nan")
            p_value = float("nan")
            status = "inconclusive_small_sample"
        else:
            chi_square = float(-(n_subj - 1.0) * correction * log_w)
            p_value = float(stats.chi2.sf(chi_square, df_mauchly))
            status = "ok"

    df_mauchly = int(contrast_df * (contrast_df + 1) / 2 - 1)
    return {
        "status": status, "W": W, "chi_square": _safe(chi_square),
        "df": df_mauchly, "p_value": _safe(p_value),
        "reject_sphericity": (bool(p_value < alpha)
                               if np.isfinite(p_value) else None),
        "epsilon_greenhouse_geisser": epsilon_gg,
        "epsilon_huynh_feldt": epsilon_hf,
        "epsilon_lower_bound": lower_bound,
    }


def repeated_measures_anova(
    data: list,
    alpha: float = 0.05,
) -> dict:
    """One-factor repeated-measures ANOVA with sphericity corrections."""
    mat = np.asarray(data, dtype=float)
    if mat.ndim != 2:
        raise ValueError(
            "repeated_measures_anova requires a 2D matrix "
            "(subjects x conditions).")
    if np.any(~np.isfinite(mat)):
        raise ValueError("Repeated-measures data must all be finite.")
    if not 0 < alpha < 1:
        raise ValueError("alpha must be between 0 and 1.")
    n_subj, n_cond = mat.shape
    if n_cond < 2:
        raise ValueError("Need at least 2 conditions.")
    if n_subj < 3:
        raise ValueError("Need at least 3 subjects for repeated-measures inference.")

    grand_mean = np.mean(mat)
    cond_means = np.mean(mat, axis=0)
    subj_means = np.mean(mat, axis=1)
    ss_conditions = float(n_subj * np.sum((cond_means - grand_mean) ** 2))
    ss_subjects = float(n_cond * np.sum((subj_means - grand_mean) ** 2))
    ss_total = float(np.sum((mat - grand_mean) ** 2))
    ss_error = max(0.0, ss_total - ss_conditions - ss_subjects)
    df_cond = n_cond - 1
    df_subj = n_subj - 1
    df_error = df_cond * df_subj
    ms_cond = ss_conditions / df_cond
    ms_error = ss_error / df_error
    f_stat = ms_cond / ms_error if ms_error > 0 else float("nan")

    sphericity = _sphericity_diagnostics(mat, alpha)
    epsilons = {
        "uncorrected": 1.0,
        "greenhouse_geisser": sphericity["epsilon_greenhouse_geisser"],
        "huynh_feldt": sphericity["epsilon_huynh_feldt"],
        "lower_bound": sphericity["epsilon_lower_bound"],
    }
    corrections = {}
    for name, epsilon in epsilons.items():
        if epsilon is None or not np.isfinite(f_stat):
            corrections[name] = {
                "epsilon": epsilon, "df_conditions": None,
                "df_error": None, "p_value": None,
            }
            continue
        df1 = float(epsilon * df_cond)
        df2 = float(epsilon * df_error)
        corrections[name] = {
            "epsilon": float(epsilon), "df_conditions": df1,
            "df_error": df2, "p_value": float(stats.f.sf(f_stat, df1, df2)),
        }

    # If Mauchly is rejected—or cannot be calibrated in a small/singular
    # sample—prefer the conservative GG degrees of freedom.
    use_correction = (
        bool(sphericity.get("reject_sphericity"))
        or (n_cond > 2 and sphericity.get("status") != "ok"))
    inference_basis = "greenhouse_geisser" if use_correction else "uncorrected"
    selected = corrections[inference_basis]
    p_value = selected["p_value"]
    reject = bool(p_value is not None and p_value < alpha)
    partial_eta = (
        ss_conditions / (ss_conditions + ss_error)
        if (ss_conditions + ss_error) > 0 else float("nan"))

    table_rows = [
        {"source": "Conditions", "SS": _safe(ss_conditions),
         "df": selected["df_conditions"], "df_uncorrected": df_cond,
         "MS": _safe(ms_cond), "F": _safe(f_stat), "p_value": _safe(p_value),
         "partial_eta_sq": _safe(partial_eta), "correction": inference_basis},
        {"source": "Subjects", "SS": _safe(ss_subjects), "df": df_subj,
         "MS": _safe(ss_subjects / df_subj), "F": None, "p_value": None,
         "partial_eta_sq": None},
        {"source": "Error", "SS": _safe(ss_error),
         "df": selected["df_error"], "df_uncorrected": df_error,
         "MS": _safe(ms_error), "F": None, "p_value": None,
         "partial_eta_sq": None, "correction": inference_basis},
        {"source": "Total", "SS": _safe(ss_total),
         "df": (n_subj * n_cond) - 1, "MS": None, "F": None,
         "p_value": None, "partial_eta_sq": None},
    ]

    return {
        "test": "Repeated-Measures ANOVA (one within factor)",
        "statistic": _safe(f_stat), "p_value": _safe(p_value),
        "p_value_uncorrected": corrections["uncorrected"]["p_value"],
        "df": {"conditions": selected["df_conditions"],
               "error": selected["df_error"]},
        "df_uncorrected": {"conditions": df_cond, "error": df_error},
        "effect_size": _safe(partial_eta),
        "effect_size_name": "Partial eta-squared", "alpha": alpha,
        "reject_null": reject, "n_subjects": n_subj,
        "n_conditions": n_cond, "anova_table": table_rows,
        "sphericity": sphericity, "corrections": corrections,
        "inference_basis": inference_basis,
        "interpretation": (
            f"{_interpret(reject, 'repeated-measures ANOVA')} "
            f"Reported p-value uses {inference_basis.replace('_', ' ')} degrees of freedom."
        ),
    }


# ---------------------------------------------------------------------------
# 14. Mixed ANOVA (one between + one within factor)
# ---------------------------------------------------------------------------

def _mixed_anova_split_plot_legacy(
    values: list,
    subjects: list,
    between_factor: list,
    within_factor: list,
    alpha: float = 0.05,
) -> dict:
    """
    Mixed ANOVA: one between-subjects factor + one within-subjects factor.

    Implements the standard split-plot SS decomposition for the balanced case.
    For unbalanced designs the SS may be approximate — a warning is included
    in the result.

    Parameters
    ----------
    values : list of numeric response values (long format)
    subjects : list of subject identifiers
    between_factor : list of between-subjects factor levels
    within_factor : list of within-subjects factor levels
    alpha : significance level

    Returns
    -------
    dict with F and p for between, within, and interaction effects.
    """
    df = pd.DataFrame({
        "value": np.asarray(values, dtype=float),
        "subject": subjects,
        "between": between_factor,
        "within": within_factor,
    })

    n_subj = df["subject"].nunique()
    between_levels = df["between"].unique()
    within_levels = df["within"].unique()
    n_between = len(between_levels)
    n_within = len(within_levels)

    # Check balance
    counts = df.groupby(["subject", "within"]).size()
    is_balanced = (counts.nunique() == 1) and (df.groupby("subject")["between"].nunique() == 1).all()
    balance_note = "balanced" if is_balanced else "unbalanced (SS values are approximate)"

    grand_mean = df["value"].mean()

    # ---- Between-subjects stratum ----
    # SS_between_factor
    between_means = df.groupby("between")["value"].mean()
    n_per_between = df.groupby("between")["value"].count()
    ss_between = float(((between_means - grand_mean) ** 2 * n_per_between).sum())
    df_between = n_between - 1

    # SS_subjects_within_between (error for between)
    subj_means = df.groupby("subject")["value"].mean()
    between_subj = df.groupby("subject")["between"].first()
    between_group_means = between_subj.map(between_means)
    ss_subj_within_b = float(((subj_means - between_group_means) ** 2 *
                               df.groupby("subject")["value"].count()).sum())
    df_subj_within_b = n_subj - n_between

    ms_between = ss_between / df_between if df_between > 0 else float("nan")
    ms_subj_within_b = ss_subj_within_b / df_subj_within_b if df_subj_within_b > 0 else float("nan")
    f_between = ms_between / ms_subj_within_b if ms_subj_within_b > 0 else float("nan")
    p_between = float(stats.f.sf(f_between, df_between, df_subj_within_b)) if not math.isnan(f_between) else float("nan")

    # ---- Within-subjects stratum ----
    within_means = df.groupby("within")["value"].mean()
    n_per_within = df.groupby("within")["value"].count()
    ss_within = float(((within_means - grand_mean) ** 2 * n_per_within).sum())
    df_within = n_within - 1

    # SS_interaction (between x within)
    cell_means = df.groupby(["between", "within"])["value"].mean()
    cell_ns = df.groupby(["between", "within"])["value"].count()
    ss_interaction = 0.0
    for (b_lvl, w_lvl), cm in cell_means.items():
        n_c = cell_ns.get((b_lvl, w_lvl), 0)
        ss_interaction += n_c * (
            cm - between_means.get(b_lvl, grand_mean)
            - within_means.get(w_lvl, grand_mean)
            + grand_mean
        ) ** 2
    ss_interaction = float(ss_interaction)
    df_interaction = df_between * df_within

    # SS_within_error
    ss_total = float(np.sum((df["value"].values - grand_mean) ** 2))
    ss_within_error = ss_total - ss_between - ss_subj_within_b - ss_within - ss_interaction
    df_within_error = df_subj_within_b * df_within

    ms_within = ss_within / df_within if df_within > 0 else float("nan")
    ms_interaction = ss_interaction / df_interaction if df_interaction > 0 else float("nan")
    ms_within_error = ss_within_error / df_within_error if df_within_error > 0 else float("nan")

    f_within = ms_within / ms_within_error if ms_within_error > 0 else float("nan")
    f_interaction = ms_interaction / ms_within_error if ms_within_error > 0 else float("nan")
    p_within = float(stats.f.sf(f_within, df_within, df_within_error)) if not math.isnan(f_within) else float("nan")
    p_interaction = float(stats.f.sf(f_interaction, df_interaction, df_within_error)) if not math.isnan(f_interaction) else float("nan")

    reject_between = (not math.isnan(p_between)) and p_between < alpha
    reject_within = (not math.isnan(p_within)) and p_within < alpha
    reject_interaction = (not math.isnan(p_interaction)) and p_interaction < alpha

    table_rows = [
        {"source": "Between factor", "SS": _safe(ss_between), "df": df_between,
         "MS": _safe(ms_between), "F": _safe(f_between), "p_value": _safe(p_between),
         "significant": reject_between},
        {"source": "Subjects(Between) [error_b]", "SS": _safe(ss_subj_within_b), "df": df_subj_within_b,
         "MS": _safe(ms_subj_within_b), "F": None, "p_value": None, "significant": None},
        {"source": "Within factor", "SS": _safe(ss_within), "df": df_within,
         "MS": _safe(ms_within), "F": _safe(f_within), "p_value": _safe(p_within),
         "significant": reject_within},
        {"source": "Between x Within interaction", "SS": _safe(ss_interaction), "df": df_interaction,
         "MS": _safe(ms_interaction), "F": _safe(f_interaction), "p_value": _safe(p_interaction),
         "significant": reject_interaction},
        {"source": "Within error", "SS": _safe(ss_within_error), "df": df_within_error,
         "MS": _safe(ms_within_error), "F": None, "p_value": None, "significant": None},
        {"source": "Total", "SS": _safe(ss_total), "df": len(df) - 1,
         "MS": None, "F": None, "p_value": None, "significant": None},
    ]

    return {
        "test": "Mixed ANOVA (1 between + 1 within factor)",
        "statistic": None,
        "p_value": None,
        "df": None,
        "effect_size": None,
        "alpha": alpha,
        "reject_null": reject_between or reject_within or reject_interaction,
        "between_factor": {"F": _safe(f_between), "p_value": _safe(p_between), "reject_null": reject_between},
        "within_factor": {"F": _safe(f_within), "p_value": _safe(p_within), "reject_null": reject_within},
        "interaction": {"F": _safe(f_interaction), "p_value": _safe(p_interaction), "reject_null": reject_interaction},
        "anova_table": table_rows,
        "n_subjects": n_subj,
        "n_between_levels": n_between,
        "n_within_levels": n_within,
        "balance_note": balance_note,
        "interpretation": (
            f"Mixed ANOVA ({balance_note}): "
            f"Between {'significant' if reject_between else 'ns'}, "
            f"Within {'significant' if reject_within else 'ns'}, "
            f"Interaction {'significant' if reject_interaction else 'ns'}."
        ),
    }


def _mixed_wald_test(
    contrast: np.ndarray,
    cell_means: np.ndarray,
    covariance: np.ndarray,
    denominator_df: int,
    alpha: float,
) -> dict:
    """Wald F approximation for a linear contrast of marginal cell means."""
    estimate = contrast @ cell_means
    contrast_cov = contrast @ covariance @ contrast.T
    rank = int(np.linalg.matrix_rank(contrast_cov))
    if rank != contrast.shape[0]:
        raise ValueError("Mixed-model contrast is not estimable.")
    wald = float(estimate @ np.linalg.solve(contrast_cov, estimate))
    numerator_df = int(contrast.shape[0])
    f_stat = wald / numerator_df
    p_value = float(stats.f.sf(f_stat, numerator_df, denominator_df))
    return {
        "F": f_stat, "p_value": p_value,
        "reject_null": bool(p_value < alpha),
        "df_num": numerator_df, "df_den": int(denominator_df),
        "wald_chi_square": wald,
        "wald_chi_square_p": float(stats.chi2.sf(wald, numerator_df)),
        "inference_method": "REML covariance Wald F (denominator-df approximation)",
    }


def mixed_anova(
    values: list,
    subjects: list,
    between_factor: list,
    within_factor: list,
    alpha: float = 0.05,
) -> dict:
    """One-between/one-within mixed model using a pooled REML covariance.

    The mean model contains every between-by-within cell.  The repeated
    covariance is estimated from subject residual vectors after removing the
    group-specific condition means, which is the REML estimate for this cell
    means model.  An unstructured covariance is used when identifiable;
    otherwise a positive-definite compound-symmetry estimate is used and the
    fallback is reported.
    """
    lengths = {
        len(values), len(subjects), len(between_factor), len(within_factor)}
    if len(lengths) != 1 or not values:
        raise ValueError("Mixed ANOVA inputs must be non-empty and have equal length.")
    if not 0 < alpha < 1:
        raise ValueError("alpha must be between 0 and 1.")
    numeric_values = np.asarray(values, dtype=float)
    if np.any(~np.isfinite(numeric_values)):
        raise ValueError("Mixed ANOVA values must all be finite.")

    frame = pd.DataFrame({
        "value": numeric_values,
        "subject": [str(item) for item in subjects],
        "between": [str(item) for item in between_factor],
        "within": [str(item) for item in within_factor],
    })
    if (frame[["subject", "between", "within"]] == "").any().any():
        raise ValueError("Subject and factor labels must not be empty.")
    duplicates = frame.duplicated(["subject", "within"], keep=False)
    if duplicates.any():
        raise ValueError(
            "Each subject must have exactly one observation at each within-factor level.")
    between_per_subject = frame.groupby("subject", sort=False)["between"].nunique()
    if (between_per_subject != 1).any():
        raise ValueError("A subject cannot belong to multiple between-factor levels.")

    between_levels = list(dict.fromkeys(frame["between"].tolist()))
    within_levels = list(dict.fromkeys(frame["within"].tolist()))
    n_between, n_within = len(between_levels), len(within_levels)
    if n_between < 2 or n_within < 2:
        raise ValueError("Mixed ANOVA requires at least two levels of each factor.")
    expected_within = set(within_levels)
    observed_by_subject = frame.groupby("subject", sort=False)["within"].agg(set)
    if any(levels != expected_within for levels in observed_by_subject):
        raise ValueError(
            "The REML mixed model requires a complete within-factor profile "
            "for every subject; missing repeated observations were found.")

    subject_between = frame.groupby("subject", sort=False)["between"].first()
    group_subjects = {
        level: subject_between[subject_between == level].index.tolist()
        for level in between_levels
    }
    group_sizes = {level: len(ids) for level, ids in group_subjects.items()}
    if any(size < 2 for size in group_sizes.values()):
        raise ValueError("Each between-factor level needs at least two subjects.")
    n_subjects = int(len(subject_between))
    residual_df = n_subjects - n_between
    if residual_df <= 0:
        raise ValueError("No residual subject degrees of freedom for mixed inference.")

    profiles = frame.pivot(index="subject", columns="within", values="value")
    profiles = profiles.loc[subject_between.index, within_levels]
    group_means = []
    residual_crossproduct = np.zeros((n_within, n_within), dtype=float)
    for level in between_levels:
        matrix = profiles.loc[group_subjects[level]].to_numpy(dtype=float)
        mean_vector = np.mean(matrix, axis=0)
        group_means.append(mean_vector)
        residuals = matrix - mean_vector
        residual_crossproduct += residuals.T @ residuals
    cell_means = np.concatenate(group_means)
    covariance_raw = residual_crossproduct / residual_df

    eigenvalues = np.linalg.eigvalsh(covariance_raw)
    condition = (float(np.max(eigenvalues) / np.min(eigenvalues))
                 if np.min(eigenvalues) > 0 else float("inf"))
    warnings_list = []
    if residual_df >= n_within and np.min(eigenvalues) > 1e-12 and condition < 1e10:
        repeated_covariance = covariance_raw
        covariance_structure = "unstructured"
    else:
        variance = float(np.mean(np.diag(covariance_raw)))
        if variance <= 0:
            raise ValueError("Repeated-measure residual variance is zero.")
        off_diagonal = covariance_raw[~np.eye(n_within, dtype=bool)]
        covariance_value = float(np.mean(off_diagonal)) if len(off_diagonal) else 0.0
        lower = -variance / (n_within - 1) + variance * 1e-8
        upper = variance * (1.0 - 1e-8)
        covariance_value = float(np.clip(covariance_value, lower, upper))
        repeated_covariance = np.full(
            (n_within, n_within), covariance_value, dtype=float)
        np.fill_diagonal(repeated_covariance, variance)
        covariance_structure = "compound_symmetry_fallback"
        warnings_list.append(
            "The unstructured repeated covariance was not identifiable or "
            "well-conditioned; inference uses a REML compound-symmetry fallback.")

    # Covariance of the independently estimated group condition means.
    blocks = [repeated_covariance / group_sizes[level] for level in between_levels]
    cell_covariance = np.zeros((n_between * n_within, n_between * n_within))
    for group_index, block in enumerate(blocks):
        start = group_index * n_within
        cell_covariance[start:start + n_within, start:start + n_within] = block

    # Type-III-style equal-weight marginal contrasts in cell-means space.
    between_rows = []
    for group_index in range(1, n_between):
        row = np.zeros(n_between * n_within)
        row[group_index * n_within:(group_index + 1) * n_within] = 1.0 / n_within
        row[:n_within] = -1.0 / n_within
        between_rows.append(row)
    within_rows = []
    for condition_index in range(1, n_within):
        row = np.zeros(n_between * n_within)
        for group_index in range(n_between):
            row[group_index * n_within + condition_index] = 1.0 / n_between
            row[group_index * n_within] = -1.0 / n_between
        within_rows.append(row)
    interaction_rows = []
    for group_index in range(1, n_between):
        for condition_index in range(1, n_within):
            row = np.zeros(n_between * n_within)
            row[group_index * n_within + condition_index] = 1.0
            row[group_index * n_within] = -1.0
            row[condition_index] = -1.0
            row[0] = 1.0
            interaction_rows.append(row)

    between_result = _mixed_wald_test(
        np.asarray(between_rows), cell_means, cell_covariance,
        residual_df, alpha)
    within_result = _mixed_wald_test(
        np.asarray(within_rows), cell_means, cell_covariance,
        residual_df, alpha)
    interaction_result = _mixed_wald_test(
        np.asarray(interaction_rows), cell_means, cell_covariance,
        residual_df, alpha)

    balanced = len(set(group_sizes.values())) == 1
    balance_note = (
        "balanced subject counts" if balanced
        else "unequal subject counts handled by the REML covariance model")
    rows = []
    for source, result in (
        ("Between factor", between_result),
        ("Within factor", within_result),
        ("Between x Within interaction", interaction_result),
    ):
        rows.append({
            "source": source, "SS": None, "df": result["df_num"],
            "MS": None, "F": result["F"], "p_value": result["p_value"],
            "significant": result["reject_null"],
            "df_den": result["df_den"],
            "method": result["inference_method"],
        })

    reject_any = bool(
        between_result["reject_null"] or within_result["reject_null"]
        or interaction_result["reject_null"])
    return {
        "test": "Mixed model (1 between + 1 within factor)",
        "statistic": None, "p_value": None, "df": None,
        "effect_size": None, "alpha": alpha, "reject_null": reject_any,
        "between_factor": between_result,
        "within_factor": within_result,
        "interaction": interaction_result,
        "anova_table": rows, "n_subjects": n_subjects,
        "n_between_levels": n_between, "n_within_levels": n_within,
        "balance_note": balance_note,
        "model": {
            "estimation": "REML cell-means repeated model",
            "covariance_structure": covariance_structure,
            "residual_subject_df": residual_df,
            "group_sizes": group_sizes,
            "repeated_covariance": repeated_covariance.tolist(),
            "raw_covariance_condition_number": _safe(condition),
            "warnings": warnings_list,
            "assumptions": [
                "independent subjects",
                "complete repeated profiles",
                "common within-subject covariance across between groups",
                "approximately multivariate-normal residual profiles",
            ],
        },
        "interpretation": (
            f"REML repeated-covariance model ({balance_note}; "
            f"{covariance_structure.replace('_', ' ')}). "
            f"Between {'significant' if between_result['reject_null'] else 'ns'}, "
            f"Within {'significant' if within_result['reject_null'] else 'ns'}, "
            f"Interaction {'significant' if interaction_result['reject_null'] else 'ns'}."
        ),
    }
