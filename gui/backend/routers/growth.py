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
        params = {
            "beta": round(fit.beta, 6),
            "Lambda": float(f"{fit.Lambda:.6g}"),
            "CvM": round(float(fit.CvM), 6),
            "failure_terminated": bool(fit.failure_terminated),
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
        }
        mtbf_inst = fit.DMTBF_I
        mtbf_cum = fit.DMTBF_C
        growth_rate = fit.alpha

    mtbf_cumulative_curve = fit.MTBF_cumulative(t_grid)
    mtbf_instantaneous_curve = fit.MTBF_instantaneous(t_grid)

    return {
        "model": model_name,
        **params,
        "growth_rate": round(float(growth_rate), 6),
        "mtbf_instantaneous": round(float(mtbf_inst), 6),
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
            "instantaneous": np.asarray(mtbf_instantaneous_curve, dtype=float).tolist(),
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
        np_res = MCF_nonparametric(req.data, CI=req.CI)
        out = {"nonparametric": np_res, "parametric": None}
        if req.parametric:
            par = MCF_parametric(req.data, CI=req.CI)
            # Drop the nested non-parametric copy to keep the payload small.
            par.pop("np", None)
            out["parametric"] = par
        return out
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
