"""Life Data Analysis router."""

import sys
import warnings
import numpy as np
from fastapi import APIRouter, HTTPException
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.Fitters import (
    Fit_Everything, _FITTER_MAP, ALL_FITTER_NAMES,
    Fit_Weibull_2P, Fit_Weibull_3P,
    Fit_Exponential_1P, Fit_Exponential_2P,
    Fit_Normal_2P, Fit_Lognormal_2P, Fit_Lognormal_3P,
    Fit_Gamma_2P, Fit_Loglogistic_2P, Fit_Beta_2P, Fit_Gumbel_2P,
)
from reliability.Nonparametric import KaplanMeier, NelsonAalen
from reliability.Utils import xy_transform
from schemas import LifeDataFitRequest, NonparametricRequest

router = APIRouter()


def _safe(v, ndigits: int = 6):
    """Round to a JSON-friendly float, mapping non-finite values to None."""
    if v is None:
        return None
    v = float(v)
    if not np.isfinite(v):
        return None
    return round(v, ndigits)


def _dist_params(fit, name: str) -> dict:
    """Extract fitted parameters and their confidence intervals as a flat dict."""
    params = {}
    for attr in ('alpha', 'beta', 'gamma', 'mu', 'sigma', 'Lambda', 'alpha_1', 'alpha_2'):
        if hasattr(fit, attr):
            val = getattr(fit, attr)
            if val is not None:
                params[attr] = _safe(val)
                if hasattr(fit, f"{attr}_lower"):
                    params[f"{attr}_lower"] = _safe(getattr(fit, f"{attr}_lower"))
                if hasattr(fit, f"{attr}_upper"):
                    params[f"{attr}_upper"] = _safe(getattr(fit, f"{attr}_upper"))
                if hasattr(fit, f"{attr}_SE"):
                    params[f"{attr}_se"] = _safe(getattr(fit, f"{attr}_SE"))
    return params


def _distribution_curves(fit, failures: np.ndarray) -> dict:
    """Generate PDF, CDF, SF, HF curves plus SF/CDF confidence bands."""
    dist = fit.distribution
    lo = failures.min() * 0.5
    hi = failures.max() * 1.5
    x = np.linspace(max(lo, 1e-6), hi, 300)

    # Some distributions have support constraints
    if hasattr(dist, 'gamma') and dist.gamma is not None:
        x = x[x > dist.gamma]
    if len(x) == 0:
        return {}

    out = {
        "x": x.tolist(),
        "pdf": dist._pdf(x).tolist(),
        "cdf": dist._cdf(x).tolist(),
        "sf": dist._sf(x).tolist(),
        "hf": dist._hf(x).tolist(),
    }

    # Confidence bands on the survival and cumulative functions
    try:
        _, sf_lo, sf_hi = fit.confidence_bounds(xvals=x, func='SF')
        if sf_lo is not None:
            out["sf_lower"] = sf_lo.tolist()
            out["sf_upper"] = sf_hi.tolist()
            out["cdf_lower"] = (1 - sf_hi).tolist()
            out["cdf_upper"] = (1 - sf_lo).tolist()
    except Exception:
        pass

    return out


def _probability_plot_data(fit, name: str, failures: np.ndarray,
                           right_censored) -> dict:
    """Return probability plot scatter + fitted line data."""
    from reliability.Utils import rank_adjustment, median_rank_approximation

    rc = np.asarray(right_censored, dtype=float) if right_censored else None
    adj_ranks, n = rank_adjustment(failures, rc)
    median_ranks = median_rank_approximation(adj_ranks, n)
    sorted_f = np.sort(failures)
    median_ranks = np.clip(median_ranks, 1e-10, 1 - 1e-10)

    x_transform, y_transform, x_label, y_label = xy_transform(name)
    x_pts = x_transform(sorted_f).tolist()
    y_pts = y_transform(median_ranks).tolist()

    # Fitted line
    x_line_raw = np.linspace(sorted_f.min() * 0.8, sorted_f.max() * 1.2, 200)
    x_line_raw = x_line_raw[x_line_raw > 0]
    cdf_vals = np.clip(fit.distribution._cdf(x_line_raw), 1e-10, 1 - 1e-10)
    x_line = x_transform(x_line_raw).tolist()
    y_line = y_transform(cdf_vals).tolist()

    out = {
        "scatter_x": x_pts,
        "scatter_y": y_pts,
        "line_x": x_line,
        "line_y": y_line,
        "x_label": x_label,
        "y_label": y_label,
    }

    # Confidence band on the fitted line (mapped onto the linearized axis)
    try:
        _, sf_lo, sf_hi = fit.confidence_bounds(xvals=x_line_raw, func='SF')
        if sf_lo is not None:
            cdf_lo = np.clip(1 - sf_hi, 1e-10, 1 - 1e-10)
            cdf_hi = np.clip(1 - sf_lo, 1e-10, 1 - 1e-10)
            out["line_lower"] = y_transform(cdf_lo).tolist()
            out["line_upper"] = y_transform(cdf_hi).tolist()
    except Exception:
        pass

    return out


@router.post("/fit")
def fit_distributions(req: LifeDataFitRequest):
    failures = np.asarray(req.failures, dtype=float)
    rc = np.asarray(req.right_censored, dtype=float) if req.right_censored else None

    if len(failures) < 2:
        raise HTTPException(status_code=400, detail="At least 2 failure times required.")

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            fe = Fit_Everything(
                failures=failures,
                right_censored=rc,
                distributions_to_fit=req.distributions_to_fit,
                method=req.method,
                CI=req.CI,
                show_probability_plot=False,
                show_histogram_plot=False,
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Build results rows
    results = []
    for _, row in fe.results.iterrows():
        dist_name = row["Distribution"]
        entry = {
            "Distribution": dist_name,
            "AICc": None if np.isinf(row["AICc"]) else round(float(row["AICc"]), 4),
            "BIC": None if np.isinf(row["BIC"]) else round(float(row["BIC"]), 4),
            "AD": None if np.isinf(row["AD"]) else round(float(row["AD"]), 4),
            "LogLik": round(float(row["Log-Likelihood"]), 4),
        }
        if dist_name in fe.fitted:
            entry["params"] = _dist_params(fe.fitted[dist_name], dist_name)
        results.append(entry)

    # Plot data for every fitted distribution (enables instant switching)
    best_name = fe.best_distribution_name
    plots: dict = {}
    for dist_name, fit in fe.fitted.items():
        if fit and fit.distribution:
            try:
                plots[dist_name] = {
                    "probability": _probability_plot_data(
                        fit, dist_name, failures, req.right_censored),
                    "curves": _distribution_curves(fit, failures),
                }
            except Exception:
                pass

    return {
        "results": results,
        "best_distribution": best_name,
        "plots": plots,
        "CI": req.CI,
        "available_distributions": list(ALL_FITTER_NAMES),
    }


@router.post("/nonparametric")
def nonparametric(req: NonparametricRequest):
    failures = np.asarray(req.failures, dtype=float)
    rc = np.asarray(req.right_censored, dtype=float) if req.right_censored else None

    if len(failures) < 1:
        raise HTTPException(status_code=400, detail="At least 1 failure time required.")

    try:
        if req.method == "KM":
            est = KaplanMeier(failures, right_censored=rc, CI=req.CI)
            df = est.results
            return {
                "method": "Kaplan-Meier",
                "time": df["time"].tolist(),
                "SF": df["SF"].tolist(),
                "CI_lower": df["CI_lower"].tolist(),
                "CI_upper": df["CI_upper"].tolist(),
            }
        else:
            est = NelsonAalen(failures, right_censored=rc, CI=req.CI)
            df = est.results
            return {
                "method": "Nelson-Aalen",
                "time": df["time"].tolist(),
                "CHF": df["CHF"].tolist(),
                "SF": df["SF"].tolist(),
                "CI_lower": df["CI_lower"].tolist(),
                "CI_upper": df["CI_upper"].tolist(),
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/distributions")
def list_distributions():
    return {"distributions": list(ALL_FITTER_NAMES)}
