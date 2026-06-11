"""Accelerated Life Testing router."""

import sys
import warnings
import numpy as np
from fastapi import APIRouter, HTTPException
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.ALT_fitters import Fit_Everything_ALT, ALL_SINGLE_STRESS_NAMES
from reliability.Reliability_testing import (
    sample_size_binomial, parametric_binomial_sample_size,
    parametric_binomial_test_time, binomial_oc_curve,
)
from schemas import ALTFitRequest, SampleSizeRequest

router = APIRouter()


@router.post("/fit")
def fit_alt(req: ALTFitRequest):
    failures = np.asarray(req.failures, dtype=float)
    stresses = np.asarray(req.failure_stress, dtype=float)
    rc = np.asarray(req.right_censored, dtype=float) if req.right_censored else None
    rc_stress = np.asarray(req.right_censored_stress, dtype=float) if req.right_censored_stress else None

    if len(failures) < 4:
        raise HTTPException(status_code=400, detail="At least 4 failure times required for ALT.")

    if len(failures) != len(stresses):
        raise HTTPException(status_code=400,
                            detail="failures and failure_stress must have the same length.")

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            fe = Fit_Everything_ALT(
                failures=failures,
                failure_stress=stresses,
                right_censored=rc,
                right_censored_stress=rc_stress,
                use_level_stress=req.use_level_stress,
                models_to_fit=req.models_to_fit,
                sort_by=req.sort_by,
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    results = []
    for _, row in fe.results.iterrows():
        entry = {k: (None if (isinstance(v, float) and np.isinf(v)) else
                     (round(v, 4) if isinstance(v, float) else v))
                 for k, v in row.items()}
        results.append(entry)

    # Life-stress plot data for best model
    life_stress_plot = None
    if fe.best_model is not None:
        try:
            model = fe.best_model
            unique_stresses = np.unique(stresses)
            s_range = np.linspace(unique_stresses.min() * 0.8,
                                  unique_stresses.max() * 1.2, 100)
            life_at_stress = []
            for s in s_range:
                try:
                    # life = characteristic life at stress s
                    params = model.life_stress_params
                    dist_info_life = model._life_at_stress(s)
                    life_at_stress.append(float(dist_info_life))
                except Exception:
                    life_at_stress.append(None)

            # Observed median lives per stress level
            obs_stress = []
            obs_life = []
            for s in unique_stresses:
                mask = stresses == s
                median_life = float(np.median(failures[mask]))
                obs_stress.append(float(s))
                obs_life.append(median_life)

            life_stress_plot = {
                "line_stress": s_range.tolist(),
                "line_life": life_at_stress,
                "scatter_stress": obs_stress,
                "scatter_life": obs_life,
                "use_level_stress": req.use_level_stress,
                "use_level_life": (float(model._life_at_stress(req.use_level_stress))
                                   if req.use_level_stress else None),
            }
        except Exception:
            pass

    return {
        "results": results,
        "best_model": fe.best_model_name,
        "life_stress_plot": life_stress_plot,
        "available_models": list(ALL_SINGLE_STRESS_NAMES),
    }


@router.get("/models")
def list_models():
    return {"models": list(ALL_SINGLE_STRESS_NAMES)}


@router.post("/sample-size")
def sample_size(req: SampleSizeRequest):
    """Binomial reliability demonstration test planner.

    Method 1 (nonparametric) solves the binomial equation for sample size.
    Method 2A/2B use a Weibull shape parameter to trade test time against
    samples; both report eta and the reliability demonstrated at test time.
    """
    parametric = req.method in ("parametric_samples", "parametric_time")
    if parametric and (req.mission_time is None or req.beta is None):
        raise HTTPException(status_code=400,
                            detail="mission_time and beta are required for parametric methods.")

    try:
        out = {"method": req.method, "failures": req.failures,
               "R": req.R, "CI": req.CI,
               "n": None, "test_time": None, "eta": None, "R_test": None}

        if req.method == "nonparametric":
            out["n"] = sample_size_binomial(req.R, CI=req.CI, failures=req.failures)
            oc_n, demonstrated_R = out["n"], req.R
        elif req.method == "parametric_samples":
            if req.test_time is None:
                raise ValueError("test_time is required for Method 2A.")
            res = parametric_binomial_sample_size(
                req.R, req.mission_time, req.beta, req.test_time,
                CI=req.CI, failures=req.failures)
            out.update(n=res["n"], eta=round(res["eta"], 4),
                       R_test=round(res["R_test"], 6))
            oc_n, demonstrated_R = res["n"], res["R_test"]
        elif req.method == "parametric_time":
            if req.n is None:
                raise ValueError("n is required for Method 2B.")
            res = parametric_binomial_test_time(
                req.R, req.mission_time, req.beta, req.n,
                CI=req.CI, failures=req.failures)
            out.update(n=req.n, test_time=round(res["T_test"], 4),
                       eta=round(res["eta"], 4), R_test=round(res["R_test"], 6))
            oc_n, demonstrated_R = req.n, res["R_test"]
        else:
            raise ValueError(f"Unknown method: '{req.method}'")

        if req.options_table:
            rows = []
            for f in range(16):
                row = {"f": f}
                try:
                    if req.method == "nonparametric":
                        row["n"] = sample_size_binomial(req.R, CI=req.CI, failures=f)
                    elif req.method == "parametric_samples":
                        row["n"] = parametric_binomial_sample_size(
                            req.R, req.mission_time, req.beta, req.test_time,
                            CI=req.CI, failures=f)["n"]
                    else:  # parametric_time: fixed n, vary f (needs n > f)
                        if req.n >= f + 1:
                            row["test_time"] = round(parametric_binomial_test_time(
                                req.R, req.mission_time, req.beta, req.n,
                                CI=req.CI, failures=f)["T_test"], 2)
                        else:
                            row["test_time"] = None
                except ValueError:
                    row["n" if req.method != "parametric_time" else "test_time"] = None
                rows.append(row)
            out["options_table"] = rows

        if req.oc_curve:
            R_vals, P_acc = binomial_oc_curve(oc_n, failures=req.failures)
            out["oc_curve"] = {
                "R": np.round(R_vals, 6).tolist(),
                "P_accept": np.round(P_acc, 6).tolist(),
                "R_demonstrated": round(float(demonstrated_R), 6),
                "alpha": round(1 - req.CI, 6),
            }

        return out
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
