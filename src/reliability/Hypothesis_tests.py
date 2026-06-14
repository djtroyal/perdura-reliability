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
    """Rank-biserial correlation for Mann-Whitney U."""
    na, nb = len(a), len(b)
    return float(1.0 - (2.0 * u_stat) / (na * nb))


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
    return {
        "test": "One-sample t-test",
        "statistic": _safe(statistic),
        "p_value": _safe(p_value),
        "df": _safe(df),
        "effect_size": _safe(d),
        "effect_size_name": "Cohen's d",
        "alpha": alpha,
        "reject_null": reject,
        "alternative": alternative,
        "sample_mean": _safe(float(np.mean(arr))),
        "sample_sd": _safe(float(np.std(arr, ddof=1))),
        "n": len(arr),
        "popmean": popmean,
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
        "effect_size": _safe(d),
        "effect_size_name": "Cohen's d",
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
        "effect_size": _safe(d),
        "effect_size_name": "Cohen's d (on differences)",
        "alpha": alpha,
        "reject_null": reject,
        "alternative": alternative,
        "mean_diff": _safe(float(np.mean(diffs))),
        "sd_diff": _safe(float(np.std(diffs, ddof=1))),
        "n": len(arr_a),
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
) -> dict:
    """
    Chi-square goodness-of-fit test.

    Parameters
    ----------
    observed : observed frequencies
    expected : expected frequencies (None = uniform)
    alpha : significance level

    Returns
    -------
    dict with chi2 statistic, df, and p-value.
    """
    obs = np.asarray(observed, dtype=float)
    if len(obs) < 2:
        raise ValueError("chi_square_gof requires at least 2 categories.")
    exp = np.asarray(expected, dtype=float) if expected is not None else None
    result = stats.chisquare(obs, f_exp=exp)
    chi2 = float(result.statistic)
    p_value = float(result.pvalue)
    df = float(len(obs) - 1)
    reject = p_value < alpha
    return {
        "test": "Chi-square goodness-of-fit",
        "statistic": _safe(chi2),
        "p_value": _safe(p_value),
        "df": _safe(df),
        "effect_size": None,
        "alpha": alpha,
        "reject_null": reject,
        "n_categories": len(obs),
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
    chi2, p_value, df, _ = stats.chi2_contingency(arr)
    n = int(arr.sum())
    r, c = arr.shape
    v = _cramers_v(float(chi2), n, r, c)
    reject = p_value < alpha
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

    # Bonferroni pairwise t-tests
    pairs = list(itertools.combinations(range(k), 2))
    n_comparisons = len(pairs)
    pairwise = []
    for i, j in pairs:
        t_res = stats.ttest_ind(arrs[i], arrs[j], equal_var=False)
        p_adj = min(float(t_res.pvalue) * n_comparisons, 1.0)
        pairwise.append({
            "group_i": i,
            "group_j": j,
            "mean_diff": _safe(float(np.mean(arrs[i]) - np.mean(arrs[j]))),
            "p_value_raw": _safe(float(t_res.pvalue)),
            "p_value_bonferroni": _safe(p_adj),
            "significant": p_adj < alpha,
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
    reject = p_value < alpha
    return {
        "test": "Kruskal-Wallis H",
        "statistic": _safe(float(h_stat)),
        "p_value": _safe(float(p_value)),
        "df": _safe(float(df)),
        "effect_size": None,
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
    df = len(arrs) - 1
    reject = p_value < alpha
    return {
        "test": "Friedman",
        "statistic": _safe(float(chi2)),
        "p_value": _safe(float(p_value)),
        "df": _safe(float(df)),
        "effect_size": None,
        "alpha": alpha,
        "reject_null": reject,
        "k": len(arrs),
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

    # Balanced check
    cell_counts = df.groupby(factor_names)["__response__"].count()
    is_balanced = (cell_counts.nunique() == 1)
    balance_note = "balanced" if is_balanced else "unbalanced (Type I / sequential SS used)"

    # Build ANOVA table rows
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

    # Overall F is the first main effect
    f_main = table_rows[0]["F"]
    p_main = table_rows[0]["p_value"]
    reject = (p_main is not None) and p_main < alpha

    return {
        "test": f"Factorial ANOVA ({len(factor_names)}-way)",
        "statistic": f_main,
        "p_value": p_main,
        "df": None,
        "effect_size": None,
        "alpha": alpha,
        "reject_null": reject,
        "anova_table": table_rows,
        "n": n,
        "balance_note": balance_note,
        "interpretation": f"ANOVA table computed ({balance_note}). See anova_table for details.",
    }


# ---------------------------------------------------------------------------
# 13. Repeated-measures ANOVA (one within-subject factor)
# ---------------------------------------------------------------------------

def repeated_measures_anova(
    data: list,
    alpha: float = 0.05,
) -> dict:
    """
    One-factor repeated-measures ANOVA.

    Parameters
    ----------
    data : 2D list, shape (n_subjects, n_conditions). Each row is one subject.
    alpha : significance level

    Returns
    -------
    dict with F, p, SS decomposition, and partial eta-squared.
    """
    mat = np.asarray(data, dtype=float)
    if mat.ndim != 2:
        raise ValueError("repeated_measures_anova requires a 2D matrix (subjects x conditions).")
    n_subj, n_cond = mat.shape
    if n_cond < 2:
        raise ValueError("Need at least 2 conditions.")
    if n_subj < 2:
        raise ValueError("Need at least 2 subjects.")

    grand_mean = np.mean(mat)
    cond_means = np.mean(mat, axis=0)
    subj_means = np.mean(mat, axis=1)

    ss_conditions = float(n_subj * np.sum((cond_means - grand_mean) ** 2))
    ss_subjects = float(n_cond * np.sum((subj_means - grand_mean) ** 2))
    ss_total = float(np.sum((mat - grand_mean) ** 2))
    ss_error = ss_total - ss_conditions - ss_subjects

    df_cond = n_cond - 1
    df_subj = n_subj - 1
    df_error = df_cond * df_subj

    ms_cond = ss_conditions / df_cond if df_cond > 0 else float("nan")
    ms_error = ss_error / df_error if df_error > 0 else float("nan")

    f_stat = ms_cond / ms_error if ms_error > 0 else float("nan")
    p_value = float(stats.f.sf(f_stat, df_cond, df_error)) if not math.isnan(f_stat) else float("nan")

    partial_eta = ss_conditions / (ss_conditions + ss_error) if (ss_conditions + ss_error) > 0 else float("nan")
    reject = p_value < alpha

    table_rows = [
        {"source": "Conditions", "SS": _safe(ss_conditions), "df": df_cond, "MS": _safe(ms_cond),
         "F": _safe(f_stat), "p_value": _safe(p_value), "partial_eta_sq": _safe(partial_eta)},
        {"source": "Subjects", "SS": _safe(ss_subjects), "df": df_subj, "MS": _safe(ss_subjects / df_subj),
         "F": None, "p_value": None, "partial_eta_sq": None},
        {"source": "Error", "SS": _safe(ss_error), "df": df_error, "MS": _safe(ms_error),
         "F": None, "p_value": None, "partial_eta_sq": None},
        {"source": "Total", "SS": _safe(ss_total), "df": (n_subj * n_cond) - 1,
         "MS": None, "F": None, "p_value": None, "partial_eta_sq": None},
    ]

    return {
        "test": "Repeated-Measures ANOVA (one within factor)",
        "statistic": _safe(f_stat),
        "p_value": _safe(p_value),
        "df": {"conditions": df_cond, "error": df_error},
        "effect_size": _safe(partial_eta),
        "effect_size_name": "Partial eta-squared",
        "alpha": alpha,
        "reject_null": reject,
        "n_subjects": n_subj,
        "n_conditions": n_cond,
        "anova_table": table_rows,
        "interpretation": _interpret(reject, "repeated-measures ANOVA"),
    }


# ---------------------------------------------------------------------------
# 14. Mixed ANOVA (one between + one within factor)
# ---------------------------------------------------------------------------

def mixed_anova(
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
