"""Reliability Growth (Crow-AMSAA / Duane) router."""

import sys
import numpy as np
from fastapi import APIRouter, HTTPException
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.Repairable_systems import (
    CrowAMSAA, Duane,
    optimal_replacement_time, ROCOF, MCF_nonparametric, MCF_parametric,
)
from schemas import (
    GrowthRequest, OptimalReplacementRequest, ROCOFRequest, MCFRequest,
)

router = APIRouter()


# Critical values of the Cramer-von Mises GoF statistic for the Crow-AMSAA
# model at the 10% significance level, by number of failures M (MIL-HDBK-189).
_CVM_CRIT_10PCT = [
    (2, 0.162), (3, 0.154), (4, 0.155), (5, 0.160), (6, 0.162), (7, 0.165),
    (8, 0.165), (9, 0.167), (10, 0.167), (15, 0.169), (20, 0.172),
    (30, 0.172), (60, 0.173), (100, 0.173),
]


def _cvm_critical(m: int) -> float:
    """10%-level CvM critical value for M failures (step lookup, capped)."""
    crit = _CVM_CRIT_10PCT[0][1]
    for size, value in _CVM_CRIT_10PCT:
        if m >= size:
            crit = value
    return crit


def _growth_interpretation(beta_like: float, model: str, mtbf_inst,
                           beta_lower=None, beta_upper=None) -> dict:
    """Plain-language verdict for a growth fit (mirrors _mcf_trend)."""
    if model == "crow_amsaa":
        if beta_like < 1:
            trend, verdict = "improving", "failure intensity is decreasing — reliability is growing"
        elif beta_like > 1:
            trend, verdict = "worsening", "failure intensity is increasing — reliability is degrading"
        else:
            trend, verdict = "constant", "failure intensity is constant (no growth)"
        detail = f"β = {beta_like:.3f} ({'<' if beta_like < 1 else '>' if beta_like > 1 else '='} 1): {verdict}."
        if beta_lower is not None and beta_upper is not None:
            if beta_lower > 1 or beta_upper < 1:
                detail += f" The 95% CI on β [{beta_lower:.3f}, {beta_upper:.3f}] excludes 1 — the trend is statistically significant."
            else:
                detail += f" The 95% CI on β [{beta_lower:.3f}, {beta_upper:.3f}] includes 1 — the trend is not statistically significant."
    else:   # duane: alpha > 0 means growth
        if beta_like > 0:
            trend, verdict = "improving", "cumulative MTBF is increasing — reliability is growing"
        elif beta_like < 0:
            trend, verdict = "worsening", "cumulative MTBF is decreasing — reliability is degrading"
        else:
            trend, verdict = "constant", "no growth trend"
        detail = f"Duane slope α = {beta_like:.3f}: {verdict}."
    if mtbf_inst is None or not np.isfinite(mtbf_inst):
        detail += (
            " Instantaneous MTBF is withheld outside the valid Duane growth "
            "regime (0 <= alpha < 1); use Crow-AMSAA and assess deterioration "
            "or change points."
        )
    else:
        detail += f" Current (instantaneous) MTBF ≈ {mtbf_inst:.4g}."
    return {"trend": trend, "detail": detail}


def _mcf_trend(times: list, mcf_vals: list) -> dict:
    """Classify MCF trend as improving / constant / worsening.

    Splits the time series into two halves by index, fits a linear regression
    to each half, and compares the slopes (recurrence rates).
    """
    if len(times) < 4:
        return {"trend": "constant", "detail": "Insufficient data for trend analysis."}

    t = np.asarray(times, dtype=float)
    m = np.asarray(mcf_vals, dtype=float)

    mid = len(t) // 2
    t1, m1 = t[:mid], m[:mid]
    t2, m2 = t[mid:], m[mid:]

    # Linear regression slope for each half (polyfit degree 1)
    slope1 = float(np.polyfit(t1, m1, 1)[0])
    slope2 = float(np.polyfit(t2, m2, 1)[0])

    # Guard against division by zero / negative slopes
    if slope1 <= 0:
        ratio = 1.0
    else:
        ratio = slope2 / slope1

    if ratio < 0.85:
        trend_str = "improving"
        direction = "decreased"
        verdict = "system appears to be improving (reliability growth)"
    elif ratio > 1.15:
        trend_str = "worsening"
        direction = "increased"
        verdict = "system appears to be worsening (reliability degradation)"
    else:
        trend_str = "constant"
        direction = "remained stable"
        verdict = "recurrence rate is approximately constant"

    detail_str = (
        f"Recurrence rate {direction} from {slope1:.2e} to {slope2:.2e} "
        f"per unit time (ratio {ratio:.2f}) — {verdict}."
    )
    return {"trend": trend_str, "detail": detail_str}


@router.post("/fit")
def fit_growth(req: GrowthRequest):
    """Fit a Crow-AMSAA (NHPP power law, MLE) or Duane (regression)
    reliability growth model to cumulative failure times."""
    times = np.asarray(req.times, dtype=float)

    model_name = req.model.lower().replace("-", "_")
    if model_name not in ("crow_amsaa", "duane"):
        raise HTTPException(status_code=400,
                            detail=f"Unknown model '{req.model}'. "
                                   "Use: crow_amsaa, duane.")

    try:
        if model_name == "crow_amsaa":
            fit = CrowAMSAA(times=times, T=req.T)
        else:
            fit = Duane(times=times, T=req.T)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    n = fit.n
    T = float(fit.T)
    t_grid = np.logspace(np.log10(float(times[0])), np.log10(T), 100)

    if model_name == "crow_amsaa":
        model_n = fit.expected_failures(t_grid)
        m_cvm = (fit.n - 1) if fit.failure_terminated else fit.n
        cvm_crit = _cvm_critical(m_cvm)
        params = {
            "beta": round(fit.beta, 6),
            "Lambda": float(f"{fit.Lambda:.6g}"),
            "CvM": round(float(fit.CvM), 6),
            # 10%-level MIL-HDBK-189 critical value → an actual verdict for the
            # GoF statistic instead of a bare number.
            "cvm_critical": cvm_crit,
            "fit_acceptable": bool(fit.CvM < cvm_crit),
            "failure_terminated": bool(fit.failure_terminated),
            # Exact chi-square bounds on beta; Poisson-count bounds on the
            # cumulative MTBF; first-order bounds on the instantaneous MTBF.
            "beta_lower": fit.beta_lower, "beta_upper": fit.beta_upper,
            "mtbf_cumulative_lower": fit.cumulative_MTBF_lower,
            "mtbf_cumulative_upper": fit.cumulative_MTBF_upper,
            "mtbf_instantaneous_lower": fit.instantaneous_MTBF_lower,
            "mtbf_instantaneous_upper": fit.instantaneous_MTBF_upper,
            "ci_level": fit.CI,
        }
        mtbf_inst = fit.instantaneous_MTBF
        mtbf_cum = fit.cumulative_MTBF
        growth_rate = fit.growth_rate
    else:
        # implied cumulative failures: N(t) = t / m_c(t) = t^(1-alpha) / A
        model_n = t_grid ** (1 - fit.alpha) / fit.A
        params = {
            "alpha": round(fit.alpha, 6),
            "A": float(f"{fit.A:.6g}"),
            "r_squared": round(fit.r_squared, 6),
            "CvM": None,
            "valid_growth_regime": fit.valid_growth_regime,
            "regime_warning": fit.regime_warning,
        }
        mtbf_inst = fit.DMTBF_I
        mtbf_cum = fit.DMTBF_C
        growth_rate = fit.alpha

    mtbf_cumulative_curve = fit.MTBF_cumulative(t_grid)
    mtbf_instantaneous_curve = fit.MTBF_instantaneous(t_grid)

    interpretation = _growth_interpretation(
        fit.beta if model_name == "crow_amsaa" else fit.alpha,
        model_name, (float(mtbf_inst) if mtbf_inst is not None else None),
        params.get("beta_lower"), params.get("beta_upper"))

    return {
        "model": model_name,
        **params,
        "interpretation": interpretation,
        "growth_rate": round(float(growth_rate), 6),
        "mtbf_instantaneous": (round(float(mtbf_inst), 6)
                               if mtbf_inst is not None else None),
        "mtbf_cumulative": round(float(mtbf_cum), 6),
        "n_failures": n,
        "T": T,
        "scatter": {
            "t": times.tolist(),
            "n": list(range(1, n + 1)),
        },
        "model_curve": {
            "t": t_grid.tolist(),
            "n": np.asarray(model_n, dtype=float).tolist(),
        },
        "mtbf_curve": {
            "t": t_grid.tolist(),
            "cumulative": np.asarray(mtbf_cumulative_curve, dtype=float).tolist(),
            "instantaneous": (
                np.asarray(mtbf_instantaneous_curve, dtype=float).tolist()
                if mtbf_inst is not None else [None] * len(t_grid)
            ),
        },
    }


@router.post("/optimal-replacement")
def optimal_replacement(req: OptimalReplacementRequest):
    """Optimal preventive-maintenance interval from a Weibull cost model."""
    try:
        res = optimal_replacement_time(
            cost_PM=req.cost_PM, cost_CM=req.cost_CM,
            weibull_alpha=req.weibull_alpha, weibull_beta=req.weibull_beta,
            q=req.q,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return res


@router.post("/rocof")
def rocof(req: ROCOFRequest):
    """Rate of occurrence of failures with the Laplace trend test."""
    try:
        res = ROCOF(
            times_between_failures=req.times_between_failures,
            failure_times=req.failure_times,
            test_end=req.test_end, CI=req.CI,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return res


@router.post("/mcf")
def mcf(req: MCFRequest):
    """Mean Cumulative Function (non-parametric, optionally parametric)."""
    try:
        records = ([record.model_dump() for record in req.records]
                   if req.records is not None else None)
        np_res = MCF_nonparametric(
            data=req.data,
            observation_ends=req.observation_ends,
            records=records,
            CI=req.CI,
            interval_method=req.interval_method,
            bootstrap_samples=req.bootstrap_samples,
            seed=req.seed,
        )
        out = {"nonparametric": np_res, "parametric": None}
        if req.parametric:
            par = MCF_parametric(
                data=req.data,
                observation_ends=req.observation_ends,
                records=records,
                CI=req.CI,
            )
            # Drop the nested non-parametric copy to keep the payload small.
            par.pop("np", None)
            out["parametric"] = par
        # Trend interpretation from non-parametric MCF
        out["trend"] = _mcf_trend(np_res["time"], np_res["MCF"])
        return out
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
