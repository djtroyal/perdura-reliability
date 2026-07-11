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
from scipy import optimize
from scipy.linalg import cho_factor, cho_solve
from scipy.stats import f as f_dist
from scipy.stats import norm


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
    if n_trials not in _D2_STAR:
        raise ValueError(
            f"Xbar-R supports 1 through {max(_D2_STAR)} replicates; got {n_trials}."
        )
    return 1.0 / _D2_STAR[n_trials]


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
    if n_operators not in _D2_STAR_G1:
        raise ValueError(
            f"Xbar-R supports 2 through {max(_D2_STAR_G1)} operators; got {n_operators}."
        )
    return 1.0 / _D2_STAR_G1[n_operators]


# K3: converts the range of part means (Rp) to PV sigma.
def _k3(n_parts: int) -> float:
    if n_parts not in _D2_STAR_G1:
        raise ValueError(
            f"Xbar-R supports 2 through {max(_D2_STAR_G1)} parts; got {n_parts}."
        )
    return 1.0 / _D2_STAR_G1[n_parts]


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
    if not np.all(np.isfinite(measurements)):
        raise ValueError("measurements must all be finite.")

    unique_parts = np.unique(parts)
    unique_ops = np.unique(operators)

    if len(unique_parts) < 2:
        raise ValueError("At least 2 distinct parts are required for Gage R&R.")
    if len(unique_ops) < 2:
        raise ValueError("At least 2 distinct operators are required for Gage R&R.")

    return parts, operators, measurements, unique_parts, unique_ops


def _design_diagnostics(parts, operators, topology="crossed"):
    """Describe and validate the study topology before applying a model."""
    if topology not in {"crossed", "nested"}:
        raise ValueError("topology must be 'crossed' or 'nested'.")
    df = pd.DataFrame({"part": parts, "operator": operators})
    cell_counts = df.groupby(["part", "operator"]).size()
    unique_parts = list(pd.unique(df["part"]))
    unique_ops = list(pd.unique(df["operator"]))
    expected = {(p, o) for p in unique_parts for o in unique_ops}
    observed = set(cell_counts.index.tolist())
    missing = sorted(expected - observed, key=lambda pair: (str(pair[0]), str(pair[1])))
    operators_per_part = df.groupby("part")["operator"].nunique()
    parts_per_operator = df.groupby("operator")["part"].nunique()
    count_values = [int(v) for v in cell_counts.values]
    balanced = len(set(count_values)) == 1 and not missing
    replicated = bool(count_values and min(count_values) >= 2)

    if topology == "crossed":
        valid = bool(
            all(v >= 2 for v in operators_per_part.values)
            and all(v >= 2 for v in parts_per_operator.values)
            and replicated
        )
        reason = None if valid else (
            "A crossed study requires each part to be measured by multiple operators, "
            "each operator to measure multiple parts, and repeated measurements in every observed cell."
        )
    else:
        valid = bool(
            all(v == 1 for v in operators_per_part.values)
            and all(v >= 2 for v in parts_per_operator.values)
            and replicated
        )
        reason = None if valid else (
            "A nested study requires each part to belong to exactly one operator, at least "
            "two parts per operator, and repeated measurements for each part."
        )

    return {
        "topology": topology,
        "valid": valid,
        "balanced": balanced,
        "complete": len(missing) == 0,
        "replicated": replicated,
        "n_observed_cells": len(observed),
        "n_expected_crossed_cells": len(expected),
        "replicates_min": min(count_values) if count_values else 0,
        "replicates_max": max(count_values) if count_values else 0,
        "missing_cells": [{"part": str(p), "operator": str(o)} for p, o in missing],
        "operators_per_part_min": int(operators_per_part.min()),
        "operators_per_part_max": int(operators_per_part.max()),
        "parts_per_operator_min": int(parts_per_operator.min()),
        "parts_per_operator_max": int(parts_per_operator.max()),
        "reason": reason,
    }


def _require_classical_crossed(parts, operators, method):
    diagnostics = _design_diagnostics(parts, operators, "crossed")
    if not diagnostics["valid"] or not diagnostics["complete"] or not diagnostics["balanced"]:
        raise ValueError(
            f"{method} requires a complete, balanced, replicated crossed design. "
            "Use method='reml' for an unbalanced crossed or nested study."
        )
    return diagnostics


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
    if tolerance is not None and tolerance <= 0:
        raise ValueError("tolerance must be positive when supplied.")
    if study_var_multiplier <= 0:
        raise ValueError("study_var_multiplier must be positive.")
    if not 0.0 <= alpha_pool <= 1.0:
        raise ValueError("alpha_pool must be between 0 and 1.")
    design_diagnostics = _require_classical_crossed(parts, operators, "ANOVA Gage R&R")

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
        raw_var_op = (MS_op - MS_error_p) / (n_rep * n_parts)
        raw_var_interact = 0.0
        var_op = max(0.0, raw_var_op)
        var_interact = 0.0
    else:
        anova_table = anova_table_original

        # Variance components (standard formulas)
        var_repeatability = MS_error  # EV^2

        # Operator: (MS_op - MS_interact) / (n_rep * n_parts)
        raw_var_op = (MS_op - MS_interact) / (n_rep * n_parts)
        var_op = max(0.0, raw_var_op)

        # Interaction: (MS_interact - MS_error) / n_rep
        raw_var_interact = (MS_interact - MS_error) / n_rep
        var_interact = max(0.0, raw_var_interact)

    # Part: (MS_part - MS_interact_or_error) / (n_rep * n_ops)
    if not pooled:
        raw_var_part = (MS_part - MS_interact) / (n_rep * n_ops)
    else:
        raw_var_part = (MS_part - MS_error_p) / (n_rep * n_ops)
    var_part = max(0.0, raw_var_part)

    truncation_diagnostics = []
    for component, raw in (
        ("Operator", raw_var_op),
        ("Interaction", raw_var_interact),
        ("Part-to-Part", raw_var_part),
    ):
        if raw < 0:
            truncation_diagnostics.append({
                "component": component,
                "unconstrained_variance": float(raw),
                "reported_variance": 0.0,
                "reason": "negative method-of-moments estimate truncated at the variance boundary",
            })

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
        "design_diagnostics": design_diagnostics,
        "truncation_diagnostics": truncation_diagnostics,
        "result_quality": "approximate" if truncation_diagnostics else "validated_design",
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
    if tolerance is not None and tolerance <= 0:
        raise ValueError("tolerance must be positive when supplied.")
    if study_var_multiplier <= 0:
        raise ValueError("study_var_multiplier must be positive.")
    design_diagnostics = _require_classical_crossed(parts, operators, "Xbar-R Gage R&R")

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
    truncation_diagnostics = ([{
        "component": "Reproducibility",
        "unconstrained_variance": float(inner),
        "reported_variance": 0.0,
        "reason": "negative Average-and-Range estimate truncated at the variance boundary",
    }] if inner < 0 else [])

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
        "design_diagnostics": design_diagnostics,
        "truncation_diagnostics": truncation_diagnostics,
        "result_quality": "approximate" if truncation_diagnostics else "validated_design",
    }


# ---------------------------------------------------------------------------
# Restricted maximum-likelihood variance components
# ---------------------------------------------------------------------------

def _indicator(labels):
    labels = np.asarray([str(v) for v in labels], dtype=object)
    levels, inverse = np.unique(labels, return_inverse=True)
    z = np.zeros((len(labels), len(levels)), dtype=float)
    z[np.arange(len(labels)), inverse] = 1.0
    return z


def _numeric_hessian(fun, x, step=2e-3):
    """Small central-difference Hessian for log-variance uncertainty."""
    x = np.asarray(x, dtype=float)
    k = len(x)
    h = np.zeros((k, k), dtype=float)
    f0 = float(fun(x))
    for i in range(k):
        ei = np.zeros(k); ei[i] = step
        h[i, i] = (fun(x + ei) - 2.0 * f0 + fun(x - ei)) / step**2
        for j in range(i):
            ej = np.zeros(k); ej[j] = step
            value = (fun(x + ei + ej) - fun(x + ei - ej)
                     - fun(x - ei + ej) + fun(x - ei - ej)) / (4.0 * step**2)
            h[i, j] = h[j, i] = value
    return h


def _reml_fit(y, covariance_components):
    """Fit non-negative variance components by dense Gaussian REML."""
    y = np.asarray(y, dtype=float)
    n = len(y)
    scale = float(np.std(y, ddof=1))
    if not np.isfinite(scale) or scale <= 0:
        raise ValueError("REML requires non-zero measurement variation.")
    ys = (y - float(np.mean(y))) / scale
    x = np.ones((n, 1), dtype=float)
    matrices = [np.asarray(m, dtype=float) for m in covariance_components]
    k = len(matrices)

    def objective(log_variances):
        variances = np.exp(np.clip(log_variances, -40.0, 20.0))
        v = np.zeros((n, n), dtype=float)
        for variance, matrix in zip(variances, matrices):
            v += variance * matrix
        try:
            factor = cho_factor(v, lower=True, check_finite=False)
            vinv_x = cho_solve(factor, x, check_finite=False)
            vinv_y = cho_solve(factor, ys, check_finite=False)
            xt_vinv_x = float((x.T @ vinv_x)[0, 0])
            if xt_vinv_x <= 0 or not np.isfinite(xt_vinv_x):
                return 1e100
            beta = float((x.T @ vinv_y)[0] / xt_vinv_x)
            residual = ys - beta
            quad = float(residual @ cho_solve(factor, residual, check_finite=False))
            logdet_v = 2.0 * float(np.sum(np.log(np.diag(factor[0]))))
            value = 0.5 * (
                logdet_v + math.log(xt_vinv_x) + quad
                + (n - 1) * math.log(2.0 * math.pi)
            )
            return value if np.isfinite(value) else 1e100
        except (np.linalg.LinAlgError, ValueError, FloatingPointError):
            return 1e100

    base = np.full(k, math.log(1.0 / k))
    starts = [base]
    for dominant in range(k):
        weights = np.full(k, 0.15 / max(1, k - 1))
        weights[dominant] = 0.85
        starts.append(np.log(weights))
    fits = [
        optimize.minimize(
            objective, start, method="L-BFGS-B", bounds=[(-18.0, 5.0)] * k,
            options={"maxiter": 1000, "ftol": 1e-11, "gtol": 1e-7},
        )
        for start in starts
    ]
    successful = [fit for fit in fits if fit.success and np.isfinite(fit.fun)]
    best = min(successful or fits, key=lambda fit: float(fit.fun))
    theta_scaled = np.exp(best.x)
    theta = theta_scaled * scale**2

    covariance_log = None
    information_rank = 0
    try:
        hessian = _numeric_hessian(objective, best.x)
        information_rank = int(np.linalg.matrix_rank(hessian, tol=1e-7))
        candidate = np.linalg.pinv(hessian, rcond=1e-9)
        if (information_rank == k and np.all(np.isfinite(candidate))
                and np.all(np.diag(candidate) >= 0)):
            covariance_log = candidate
    except (np.linalg.LinAlgError, ValueError, FloatingPointError):
        pass

    # Recover the GLS intercept on the original measurement scale.
    v = sum(value * matrix for value, matrix in zip(theta, matrices))
    factor = cho_factor(v, lower=True, check_finite=False)
    vinv_x = cho_solve(factor, x, check_finite=False)
    vinv_y = cho_solve(factor, y, check_finite=False)
    intercept = float((x.T @ vinv_y)[0] / (x.T @ vinv_x)[0, 0])

    return {
        "theta": theta,
        "covariance_log": covariance_log,
        "intercept": intercept,
        "optimizer": best,
        "successful_starts": len(successful),
        "total_starts": len(fits),
        "information_rank": information_rank,
        "scale": scale,
    }


def _derived_variance_ci(weights, theta, covariance_log, confidence):
    value = float(np.dot(weights, theta))
    if value <= 0:
        return [0.0, 0.0]
    if covariance_log is None:
        return None
    gradient = np.asarray(weights, dtype=float) * theta
    variance = float(gradient @ covariance_log @ gradient)
    if not np.isfinite(variance) or variance < 0:
        return None
    se_log = math.sqrt(variance) / value
    z = float(norm.ppf(0.5 + confidence / 2.0))
    half = min(50.0, z * se_log)
    return [float(value * math.exp(-half)), float(value * math.exp(half))]


def gage_rr_reml(
    parts,
    operators,
    measurements,
    tolerance: Optional[float] = None,
    study_var_multiplier: float = 6.0,
    topology: str = "crossed",
    confidence: float = 0.95,
) -> dict:
    """Gage R&R using constrained restricted maximum likelihood.

    ``crossed`` models random part, operator and part-by-operator effects.
    ``nested`` models parts nested within operators, the usual design where
    each operator measures a different set of parts.  REML accepts unequal
    replicate counts and incomplete crossed cells; the classical ANOVA and
    Average-and-Range paths intentionally do not.
    """
    parts, operators, measurements, unique_parts, unique_ops = _parse_inputs(
        parts, operators, measurements
    )
    if tolerance is not None and tolerance <= 0:
        raise ValueError("tolerance must be positive when supplied.")
    if study_var_multiplier <= 0:
        raise ValueError("study_var_multiplier must be positive.")
    if not 0.5 < confidence < 1.0:
        raise ValueError("confidence must be between 0.5 and 1.")

    design = _design_diagnostics(parts, operators, topology)
    if not design["valid"]:
        raise ValueError(design["reason"])

    n = len(measurements)
    identity = np.eye(n)
    z_part = _indicator(parts)
    z_operator = _indicator(operators)
    if topology == "crossed":
        interaction_labels = [f"{p}\x1f{o}" for p, o in zip(parts, operators)]
        z_interaction = _indicator(interaction_labels)
        matrices = [
            identity,
            z_part @ z_part.T,
            z_operator @ z_operator.T,
            z_interaction @ z_interaction.T,
        ]
        names = ["Repeatability", "Part-to-Part", "Operator", "Interaction"]
        weights = {
            "Repeatability": [1, 0, 0, 0],
            "Operator": [0, 0, 1, 0],
            "Interaction": [0, 0, 0, 1],
            "Reproducibility": [0, 0, 1, 1],
            "GRR": [1, 0, 1, 1],
            "Part-to-Part": [0, 1, 0, 0],
            "Total": [1, 1, 1, 1],
        }
    else:
        # Each part label has one operator by validation; use a composite label
        # so repeated part codes in imported data cannot alias across operators.
        nested_parts = [f"{o}\x1f{p}" for p, o in zip(parts, operators)]
        z_nested_part = _indicator(nested_parts)
        matrices = [identity, z_nested_part @ z_nested_part.T, z_operator @ z_operator.T]
        names = ["Repeatability", "Part-to-Part", "Operator"]
        weights = {
            "Repeatability": [1, 0, 0],
            "Operator": [0, 0, 1],
            "Interaction": [0, 0, 0],
            "Reproducibility": [0, 0, 1],
            "GRR": [1, 0, 1],
            "Part-to-Part": [0, 1, 0],
            "Total": [1, 1, 1],
        }

    component_design_rank = int(np.linalg.matrix_rank(
        np.column_stack([matrix.reshape(-1) for matrix in matrices]), tol=1e-8
    ))
    fit = _reml_fit(measurements, matrices)
    theta = fit["theta"]
    covariance_log = fit["covariance_log"]

    variances = {key: float(np.dot(value, theta)) for key, value in weights.items()}
    total_variance = variances["Total"]
    components = {}
    for name, value in variances.items():
        component = _component_stats(
            value, total_variance, math.sqrt(total_variance),
            study_var_multiplier, tolerance,
        )
        variance_ci = _derived_variance_ci(
            weights[name], theta, covariance_log, confidence
        )
        component["variance_ci"] = variance_ci
        component["stdev_ci"] = ([math.sqrt(variance_ci[0]), math.sqrt(variance_ci[1])]
                                  if variance_ci is not None else None)
        components[name] = component

    stdev_pv = math.sqrt(variances["Part-to-Part"])
    stdev_grr = math.sqrt(variances["GRR"])
    ndc = max(1, int(math.floor(1.41 * stdev_pv / stdev_grr))) if stdev_grr > 0 else 1

    df = pd.DataFrame({"part": parts, "operator": operators, "y": measurements})
    per_cell_means = {}
    for (part, operator), group in df.groupby(["part", "operator"])["y"]:
        per_cell_means[f"{part}|{operator}"] = {
            "part": str(part), "operator": str(operator),
            "mean": float(group.mean()), "measurements": group.tolist(),
        }
    per_part_means = {str(p): float(v) for p, v in df.groupby("part")["y"].mean().items()}
    per_op_means = {str(o): float(v) for o, v in df.groupby("operator")["y"].mean().items()}
    cell_counts = df.groupby(["part", "operator"])["y"].count().values
    n_replicates = int(cell_counts[0]) if len(set(cell_counts.tolist())) == 1 else None

    raw_components = {name: float(value) for name, value in zip(names, theta)}
    boundary_threshold = max(total_variance, np.finfo(float).eps) * 1e-7
    boundary_components = [name for name, value in raw_components.items()
                           if value <= boundary_threshold]
    optimizer_result = fit["optimizer"]
    converged = bool(optimizer_result.success and np.isfinite(optimizer_result.fun))
    identifiable = (component_design_rank == len(matrices)
                    and fit["information_rank"] == len(matrices))

    return {
        "method": "REML",
        "topology": topology,
        "variance_components": components,
        "raw_variance_components": raw_components,
        "ndc": ndc,
        "n_parts": len(unique_parts),
        "n_operators": len(unique_ops),
        "n_replicates": n_replicates,
        "study_var_multiplier": study_var_multiplier,
        "per_cell_means": per_cell_means,
        "per_part_means": per_part_means,
        "per_op_means": per_op_means,
        "unique_parts": [str(p) for p in unique_parts],
        "unique_operators": [str(o) for o in unique_ops],
        "grand_mean": fit["intercept"],
        "design_diagnostics": design,
        "truncation_diagnostics": [],
        "uncertainty": {
            "method": "observed-information Wald intervals on log variance",
            "confidence": confidence,
            "information_rank": fit["information_rank"],
        },
        "optimizer": {
            "success": converged,
            "status": int(optimizer_result.status),
            "message": str(optimizer_result.message),
            "objective": float(optimizer_result.fun),
            "iterations": int(getattr(optimizer_result, "nit", 0)),
            "successful_starts": fit["successful_starts"],
            "total_starts": fit["total_starts"],
        },
        "identifiability": {
            "identifiable": identifiable,
            "component_design_rank": component_design_rank,
            "n_component_matrices": len(matrices),
        },
        "boundary_components": boundary_components,
        "result_quality": (
            "non_converged" if not converged else
            "insufficient_identifiability" if not identifiable else
            "boundary_solution" if boundary_components else "validated_design"
        ),
    }
