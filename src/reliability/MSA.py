"""
Measurement Systems Analysis (MSA) -- Gage Repeatability & Reproducibility.

Implements two standard MSA methods:
  - gage_rr_anova : ANOVA (crossed, with optional interaction pooling)
  - gage_rr_xbar_r: Average & Range method

Only numpy, scipy, and pandas are used (no sklearn/statsmodels).
"""

import math
from typing import Optional

import numpy as np
import pandas as pd
from scipy.stats import f as f_dist


# ---------------------------------------------------------------------------
# Constants for the Average & Range method
# ---------------------------------------------------------------------------
# d2* values (bias-corrected) indexed by number of trials (replicates)
# Source: AIAG MSA Reference Manual, 4th edition, Table D3
_D2_STAR = {
    1: 1.128, 2: 1.128, 3: 1.693, 4: 2.059, 5: 2.326,
    6: 2.534, 7: 2.704, 8: 2.847, 9: 2.970, 10: 3.078,
}

# K1 = 1/d2*(trials): converts Rbar (avg range) to EV (equipment variation = 5.15*sigma/5.15 -- stored as sigma)
# Standard AIAG table for K1 (2–7 trials)
# K1 = 1 / d2*(n_trials)
def _k1(n_trials: int) -> float:
    d2 = _D2_STAR.get(n_trials, _D2_STAR[max(_D2_STAR)])
    return 1.0 / d2


# d2* for a SINGLE range (g=1 subgroup), by subgroup size m — AIAG MSA manual
# Appendix. K2/K3 must use this table: the operator-means range and the
# part-means range are each ONE range, so the bias correction is the g=1
# column, not the asymptotic d2 used for the many-averaged ranges in K1.
# (e.g. 2 operators: K2 = 1/1.41 = 0.7071, matching the AIAG/Minitab value.)
_D2_STAR_G1 = {
    2: 1.41, 3: 1.91, 4: 2.24, 5: 2.48, 6: 2.67,
    7: 2.83, 8: 2.96, 9: 3.08, 10: 3.18,
    11: 3.27, 12: 3.35, 13: 3.42, 14: 3.49, 15: 3.55,
}


# K2: converts the range of operator means to AV sigma.
def _k2(n_operators: int) -> float:
    d2 = _D2_STAR_G1.get(n_operators, _D2_STAR_G1[max(_D2_STAR_G1)])
    return 1.0 / d2


# K3: converts the range of part means (Rp) to PV sigma.
def _k3(n_parts: int) -> float:
    d2 = _D2_STAR_G1.get(n_parts, _D2_STAR_G1[max(_D2_STAR_G1)])
    return 1.0 / d2


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _parse_inputs(parts, operators, measurements):
    """Validate and return structured arrays."""
    parts = np.asarray(parts)
    operators = np.asarray(operators)
    measurements = np.asarray(measurements, dtype=float)

    if not (len(parts) == len(operators) == len(measurements)):
        raise ValueError(
            "parts, operators, and measurements must all have the same length."
        )
    if len(measurements) == 0:
        raise ValueError("No data provided.")

    unique_parts = np.unique(parts)
    unique_ops = np.unique(operators)

    if len(unique_parts) < 2:
        raise ValueError("At least 2 distinct parts are required for Gage R&R.")
    if len(unique_ops) < 2:
        raise ValueError("At least 2 distinct operators are required for Gage R&R.")

    return parts, operators, measurements, unique_parts, unique_ops


def _component_stats(var: float, total_var: float, stdev_total: float,
                     multiplier: float, tolerance: Optional[float]):
    """Return the standard MSA component statistics dict."""
    var = max(0.0, var)
    stdev = math.sqrt(var)
    study_var = multiplier * stdev
    pct_contribution = 100.0 * var / total_var if total_var > 0 else 0.0
    study_var_total = multiplier * math.sqrt(max(0.0, total_var))
    pct_study_var = 100.0 * study_var / study_var_total if study_var_total > 0 else 0.0
    pct_tolerance = (100.0 * study_var / tolerance) if (tolerance is not None and tolerance > 0) else None
    return {
        "variance": var,
        "pct_contribution": pct_contribution,
        "stdev": stdev,
        "study_var": study_var,
        "pct_study_var": pct_study_var,
        "pct_tolerance": pct_tolerance,
    }


# ---------------------------------------------------------------------------
# ANOVA method
# ---------------------------------------------------------------------------

def gage_rr_anova(
    parts,
    operators,
    measurements,
    tolerance: Optional[float] = None,
    study_var_multiplier: float = 6.0,
    alpha_pool: float = 0.25,
) -> dict:
    """
    Crossed Gage R&R by ANOVA method.

    Parameters
    ----------
    parts        : array-like of part labels (length N)
    operators    : array-like of operator labels (length N)
    measurements : array-like of float measurement values (length N)
    tolerance    : optional process/spec tolerance (for %Tolerance computation)
    study_var_multiplier : multiplier for StudyVar (default 6.0 -> 6-sigma)
    alpha_pool   : if interaction p-value > alpha_pool, pool into error (default 0.25)

    Returns
    -------
    dict with keys: anova_table, variance_components, summary, per_cell_means, pooled
    """
    parts, operators, measurements, unique_parts, unique_ops = _parse_inputs(
        parts, operators, measurements
    )

    n_parts = len(unique_parts)
    n_ops = len(unique_ops)

    # Build a DataFrame for easy indexing
    df = pd.DataFrame({"part": parts, "operator": operators, "y": measurements})
    N = len(df)

    # Number of replicates per cell -- verify balanced-enough structure
    # For standard ANOVA we compute grand mean and marginal means
    grand_mean = df["y"].mean()

    # --- SS Total ---
    SS_total = float(np.sum((df["y"].values - grand_mean) ** 2))
    df_total = N - 1

    # --- SS Part ---
    part_means = df.groupby("part")["y"].mean()
    part_counts = df.groupby("part")["y"].count()
    SS_part = float(np.sum(part_counts.values * (part_means.values - grand_mean) ** 2))
    df_part = n_parts - 1

    # --- SS Operator ---
    op_means = df.groupby("operator")["y"].mean()
    op_counts = df.groupby("operator")["y"].count()
    SS_op = float(np.sum(op_counts.values * (op_means.values - grand_mean) ** 2))
    df_op = n_ops - 1

    # --- SS Interaction (Part * Operator) ---
    cell_means = df.groupby(["part", "operator"])["y"].mean()
    cell_counts = df.groupby(["part", "operator"])["y"].count()

    SS_interact = 0.0
    for (p, o), cell_mean in cell_means.items():
        n_cell = cell_counts[(p, o)]
        SS_interact += n_cell * (
            cell_mean - part_means[p] - op_means[o] + grand_mean
        ) ** 2
    SS_interact = float(SS_interact)
    df_interact = df_part * df_op

    # --- SS Error (Repeatability / Within-cell) ---
    SS_error = 0.0
    for (p, o), group in df.groupby(["part", "operator"])["y"]:
        cell_mean = float(group.mean())
        SS_error += float(np.sum((group.values - cell_mean) ** 2))
    SS_error = float(SS_error)
    df_error = N - n_parts * n_ops  # total - cells
    if df_error < 0:
        df_error = 0  # degenerate: no replication

    # --- Check SS consistency ---
    # (small floating-point residual allowed)
    # SS_total ≈ SS_part + SS_op + SS_interact + SS_error

    # --- Mean Squares ---
    MS_part = SS_part / df_part if df_part > 0 else 0.0
    MS_op = SS_op / df_op if df_op > 0 else 0.0
    MS_interact = SS_interact / df_interact if df_interact > 0 else 0.0
    MS_error = SS_error / df_error if df_error > 0 else 0.0

    # --- F-statistics and p-values (standard Gage R&R rules) ---
    # Part and Operator are tested against Interaction; Interaction is tested against Error
    if df_interact > 0 and MS_interact > 0:
        F_part = MS_part / MS_interact
        F_op = MS_op / MS_interact
        p_part = float(1 - f_dist.cdf(F_part, df_part, df_interact))
        p_op = float(1 - f_dist.cdf(F_op, df_op, df_interact))
    elif df_error > 0 and MS_error > 0:
        F_part = MS_part / MS_error
        F_op = MS_op / MS_error
        p_part = float(1 - f_dist.cdf(F_part, df_part, df_error))
        p_op = float(1 - f_dist.cdf(F_op, df_op, df_error))
    else:
        F_part = F_op = 0.0
        p_part = p_op = 1.0

    if df_error > 0 and MS_error > 0 and df_interact > 0:
        F_interact = MS_interact / MS_error
        p_interact = float(1 - f_dist.cdf(F_interact, df_interact, df_error))
    else:
        F_interact = 0.0
        p_interact = 1.0

    # --- Pooling decision ---
    pooled = False
    anova_table_original = [
        {"source": "Part",              "SS": SS_part,     "df": df_part,
         "MS": MS_part,     "F": F_part,     "p": p_part},
        {"source": "Operator",          "SS": SS_op,       "df": df_op,
         "MS": MS_op,       "F": F_op,       "p": p_op},
        {"source": "Part*Operator",     "SS": SS_interact, "df": df_interact,
         "MS": MS_interact, "F": F_interact, "p": p_interact},
        {"source": "Repeatability",     "SS": SS_error,    "df": df_error,
         "MS": MS_error,    "F": None,       "p": None},
        {"source": "Total",             "SS": SS_total,    "df": df_total,
         "MS": None,        "F": None,       "p": None},
    ]

    # Estimate number of replicates per cell (for variance component extraction)
    # Use harmonic mean to handle slight imbalance
    cell_ns = cell_counts.values
    n_rep = float(len(cell_ns) / np.sum(1.0 / cell_ns.astype(float))) if np.all(cell_ns > 0) else 1.0

    if p_interact > alpha_pool and df_interact > 0:
        # Pool interaction into error
        pooled = True
        SS_error_p = SS_error + SS_interact
        df_error_p = df_error + df_interact
        MS_error_p = SS_error_p / df_error_p if df_error_p > 0 else 0.0

        F_part_p = MS_part / MS_error_p if MS_error_p > 0 else 0.0
        F_op_p = MS_op / MS_error_p if MS_error_p > 0 else 0.0
        p_part_p = float(1 - f_dist.cdf(F_part_p, df_part, df_error_p)) if MS_error_p > 0 else 1.0
        p_op_p = float(1 - f_dist.cdf(F_op_p, df_op, df_error_p)) if MS_error_p > 0 else 1.0

        anova_table = [
            {"source": "Part",          "SS": SS_part,     "df": df_part,
             "MS": MS_part,     "F": F_part_p,   "p": p_part_p},
            {"source": "Operator",      "SS": SS_op,       "df": df_op,
             "MS": MS_op,       "F": F_op_p,     "p": p_op_p},
            {"source": "Repeatability", "SS": SS_error_p,  "df": df_error_p,
             "MS": MS_error_p,  "F": None,       "p": None},
            {"source": "Total",         "SS": SS_total,    "df": df_total,
             "MS": None,        "F": None,       "p": None},
        ]

        # Variance components from pooled model
        var_repeatability = MS_error_p  # EV^2
        # Operator: (MS_op - MS_error_p) / (n_rep * n_parts)
        var_op = max(0.0, (MS_op - MS_error_p) / (n_rep * n_parts))
        var_interact = 0.0
    else:
        anova_table = anova_table_original

        # Variance components (standard formulas)
        var_repeatability = MS_error  # EV^2

        # Operator: (MS_op - MS_interact) / (n_rep * n_parts)
        var_op = max(0.0, (MS_op - MS_interact) / (n_rep * n_parts))

        # Interaction: (MS_interact - MS_error) / n_rep
        var_interact = max(0.0, (MS_interact - MS_error) / n_rep)

    # Part: (MS_part - MS_interact_or_error) / (n_rep * n_ops)
    ms_denom_for_part = (MS_interact if not pooled else (MS_error + MS_interact) / max(1, df_interact + df_error) * df_error) if not pooled else (
        SS_error + SS_interact) / max(1, df_error + df_interact)
    if not pooled:
        var_part = max(0.0, (MS_part - MS_interact) / (n_rep * n_ops))
    else:
        var_part = max(0.0, (MS_part - ms_denom_for_part) / (n_rep * n_ops))

    # Reproducibility = operator + interaction variance
    var_reproducibility = var_op + var_interact

    # GRR = Repeatability + Reproducibility
    var_grr = var_repeatability + var_reproducibility

    # Total Variation
    var_tv = var_grr + var_part

    # Build component stats
    components = {
        "Repeatability": _component_stats(var_repeatability, var_tv,
                                           math.sqrt(max(0, var_tv)),
                                           study_var_multiplier, tolerance),
        "Reproducibility": _component_stats(var_reproducibility, var_tv,
                                             math.sqrt(max(0, var_tv)),
                                             study_var_multiplier, tolerance),
        "Operator": _component_stats(var_op, var_tv,
                                      math.sqrt(max(0, var_tv)),
                                      study_var_multiplier, tolerance),
        "Interaction": _component_stats(var_interact, var_tv,
                                         math.sqrt(max(0, var_tv)),
                                         study_var_multiplier, tolerance),
        "GRR": _component_stats(var_grr, var_tv,
                                  math.sqrt(max(0, var_tv)),
                                  study_var_multiplier, tolerance),
        "Part-to-Part": _component_stats(var_part, var_tv,
                                          math.sqrt(max(0, var_tv)),
                                          study_var_multiplier, tolerance),
        "Total": _component_stats(var_tv, var_tv,
                                   math.sqrt(max(0, var_tv)),
                                   study_var_multiplier, tolerance),
    }

    # Number of Distinct Categories
    stdev_pv = math.sqrt(max(0.0, var_part))
    stdev_grr = math.sqrt(max(0.0, var_grr))
    ndc = int(math.floor(1.41 * stdev_pv / stdev_grr)) if stdev_grr > 0 else 1
    ndc = max(1, ndc)

    # Per-cell means for plotting
    per_cell_means = {}
    for (p, o), g in df.groupby(["part", "operator"])["y"]:
        key = f"{p}|{o}"
        per_cell_means[key] = {
            "part": str(p),
            "operator": str(o),
            "mean": float(g.mean()),
            "measurements": g.tolist(),
        }

    # Per-part means across all operators
    per_part_means = {str(p): float(part_means[p]) for p in unique_parts}
    # Per-operator means across all parts
    per_op_means = {str(o): float(op_means[o]) for o in unique_ops}

    return {
        "method": "ANOVA",
        "anova_table": anova_table,
        "anova_table_original": anova_table_original,
        "variance_components": components,
        "pooled": pooled,
        "alpha_pool": alpha_pool,
        "ndc": ndc,
        "n_parts": n_parts,
        "n_operators": n_ops,
        "n_replicates": float(n_rep),
        "study_var_multiplier": study_var_multiplier,
        "per_cell_means": per_cell_means,
        "per_part_means": per_part_means,
        "per_op_means": per_op_means,
        "unique_parts": [str(p) for p in unique_parts],
        "unique_operators": [str(o) for o in unique_ops],
        "grand_mean": float(grand_mean),
    }


# ---------------------------------------------------------------------------
# Average & Range (Xbar-R) method
# ---------------------------------------------------------------------------

def gage_rr_xbar_r(
    parts,
    operators,
    measurements,
    tolerance: Optional[float] = None,
    study_var_multiplier: float = 6.0,
) -> dict:
    """
    Crossed Gage R&R by Average & Range method (AIAG standard).

    Returns a dict with keys: repeatability, reproducibility, grr, part_variation,
    total_variation, components (with %EV, %AV, %GRR, %PV), ndc, per_cell_means, etc.
    """
    parts, operators, measurements, unique_parts, unique_ops = _parse_inputs(
        parts, operators, measurements
    )

    n_parts = len(unique_parts)
    n_ops = len(unique_ops)

    df = pd.DataFrame({"part": parts, "operator": operators, "y": measurements})

    # Count trials per cell
    cell_counts = df.groupby(["part", "operator"])["y"].count()
    n_trials = int(round(float(cell_counts.mean())))  # assume balanced

    # Per-cell range
    cell_ranges = df.groupby(["part", "operator"])["y"].apply(
        lambda g: float(g.max() - g.min())
    )

    # R-bar (average range over all cells)
    R_bar = float(cell_ranges.mean())

    # EV (equipment variation = sigma_repeatability)
    K1 = _k1(n_trials)
    EV = R_bar * K1  # = sigma_EV

    # Operator average for each operator (across all parts and replicates)
    op_means = df.groupby("operator")["y"].mean()
    Xbar_diff = float(op_means.max() - op_means.min())  # range of operator means

    K2 = _k2(n_ops)
    # AV (reproducibility) -- must be >= 0
    inner = (Xbar_diff * K2) ** 2 - (EV ** 2) / (n_parts * n_trials)
    AV = math.sqrt(max(0.0, inner))

    # GRR
    GRR = math.sqrt(EV ** 2 + AV ** 2)

    # Part variation: Rp = max part mean - min part mean
    part_means = df.groupby("part")["y"].mean()
    Rp = float(part_means.max() - part_means.min())
    K3 = _k3(n_parts)
    PV = Rp * K3

    # Total variation
    TV = math.sqrt(GRR ** 2 + PV ** 2)

    def pct_tv(v):
        return 100.0 * v / TV if TV > 0 else 0.0

    def pct_tol(v):
        if tolerance is not None and tolerance > 0:
            return 100.0 * (study_var_multiplier * v) / tolerance
        return None

    # Variance components (sigma^2 values)
    var_ev = EV ** 2
    var_av = AV ** 2
    var_grr = GRR ** 2
    var_pv = PV ** 2
    var_tv = TV ** 2

    # Number of distinct categories
    ndc = int(math.floor(1.41 * PV / GRR)) if GRR > 0 else 1
    ndc = max(1, ndc)

    # Study vars (= multiplier * sigma)
    sv_ev = study_var_multiplier * EV
    sv_av = study_var_multiplier * AV
    sv_grr = study_var_multiplier * GRR
    sv_pv = study_var_multiplier * PV
    sv_tv = study_var_multiplier * TV

    components = {
        "Repeatability": {
            "stdev": EV, "study_var": sv_ev,
            "pct_study_var": pct_tv(EV),
            "pct_tolerance": pct_tol(EV),
            "variance": var_ev,
            "pct_contribution": 100.0 * var_ev / var_tv if var_tv > 0 else 0.0,
        },
        "Reproducibility": {
            "stdev": AV, "study_var": sv_av,
            "pct_study_var": pct_tv(AV),
            "pct_tolerance": pct_tol(AV),
            "variance": var_av,
            "pct_contribution": 100.0 * var_av / var_tv if var_tv > 0 else 0.0,
        },
        "GRR": {
            "stdev": GRR, "study_var": sv_grr,
            "pct_study_var": pct_tv(GRR),
            "pct_tolerance": pct_tol(GRR),
            "variance": var_grr,
            "pct_contribution": 100.0 * var_grr / var_tv if var_tv > 0 else 0.0,
        },
        "Part-to-Part": {
            "stdev": PV, "study_var": sv_pv,
            "pct_study_var": pct_tv(PV),
            "pct_tolerance": pct_tol(PV),
            "variance": var_pv,
            "pct_contribution": 100.0 * var_pv / var_tv if var_tv > 0 else 0.0,
        },
        "Total": {
            "stdev": TV, "study_var": sv_tv,
            "pct_study_var": pct_tv(TV),
            "pct_tolerance": pct_tol(TV),
            "variance": var_tv,
            "pct_contribution": 100.0,
        },
    }

    # Per-cell means for plotting
    per_cell_means = {}
    for (p, o), g in df.groupby(["part", "operator"])["y"]:
        per_cell_means[f"{p}|{o}"] = {
            "part": str(p),
            "operator": str(o),
            "mean": float(g.mean()),
            "measurements": g.tolist(),
        }

    per_part_means = {str(p): float(v) for p, v in part_means.items()}
    per_op_means = {str(o): float(v) for o, v in op_means.items()}

    return {
        "method": "Xbar-R",
        "R_bar": R_bar,
        "K1": K1,
        "K2": K2,
        "K3": K3,
        "Xbar_diff": Xbar_diff,
        "Rp": Rp,
        "variance_components": components,
        "ndc": ndc,
        "n_parts": n_parts,
        "n_operators": n_ops,
        "n_replicates": n_trials,
        "study_var_multiplier": study_var_multiplier,
        "per_cell_means": per_cell_means,
        "per_part_means": per_part_means,
        "per_op_means": per_op_means,
        "unique_parts": [str(p) for p in unique_parts],
        "unique_operators": [str(o) for o in unique_ops],
        "grand_mean": float(df["y"].mean()),
    }
