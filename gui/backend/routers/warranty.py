"""Warranty data analysis router."""

import sys
import numpy as np
from fastapi import APIRouter, HTTPException
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.Warranty import nevada_to_life_data, forecast_returns
from reliability.Fitters import (
    Fit_Weibull_2P, Fit_Weibull_3P,
    Fit_Exponential_1P, Fit_Exponential_2P,
    Fit_Normal_2P, Fit_Lognormal_2P, Fit_Lognormal_3P,
    Fit_Gamma_2P, Fit_Gamma_3P,
    Fit_Loglogistic_2P, Fit_Loglogistic_3P,
    Fit_Beta_2P, Fit_Gumbel_2P,
)
from schemas import (
    WarrantyConvertRequest, WarrantyForecastRequest,
)

router = APIRouter()

_FITTER_MAP = {
    "Weibull_2P": Fit_Weibull_2P,
    "Weibull_3P": Fit_Weibull_3P,
    "Exponential_1P": Fit_Exponential_1P,
    "Exponential_2P": Fit_Exponential_2P,
    "Normal_2P": Fit_Normal_2P,
    "Lognormal_2P": Fit_Lognormal_2P,
    "Lognormal_3P": Fit_Lognormal_3P,
    "Gamma_2P": Fit_Gamma_2P,
    "Gamma_3P": Fit_Gamma_3P,
    "Loglogistic_2P": Fit_Loglogistic_2P,
    "Loglogistic_3P": Fit_Loglogistic_3P,
    "Beta_2P": Fit_Beta_2P,
    "Gumbel_2P": Fit_Gumbel_2P,
}

# Map fitter classes to the parameter names they expose on the fitted object.
_PARAM_NAMES = {
    "Weibull_2P": ["eta", "beta"],
    "Weibull_3P": ["eta", "beta", "gamma"],
    "Exponential_1P": ["Lambda"],
    "Exponential_2P": ["Lambda", "gamma"],
    "Normal_2P": ["mu", "sigma"],
    "Lognormal_2P": ["mu", "sigma"],
    "Lognormal_3P": ["mu", "sigma", "gamma"],
    "Gamma_2P": ["alpha", "beta"],
    "Gamma_3P": ["alpha", "beta", "gamma"],
    "Loglogistic_2P": ["alpha", "beta"],
    "Loglogistic_3P": ["alpha", "beta", "gamma"],
    "Beta_2P": ["alpha", "beta"],
    "Gumbel_2P": ["mu", "sigma"],
}


def _extract_params(fit, dist_name: str) -> dict:
    """Extract distribution parameters from a fitted object as a dict."""
    names = _PARAM_NAMES.get(dist_name, [])
    return {name: round(float(getattr(fit, name)), 6) for name in names}


@router.post("/convert")
def convert_nevada(req: WarrantyConvertRequest):
    """Convert a Nevada chart to life data (failures + right-censored)."""
    try:
        failures, right_censored = nevada_to_life_data(req.quantities, req.returns)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "failures": failures.tolist(),
        "right_censored": right_censored.tolist(),
        "n_failures": len(failures),
        "n_censored": len(right_censored),
    }


@router.post("/forecast")
def forecast(req: WarrantyForecastRequest):
    """Forecast future warranty returns from Nevada chart data."""
    if req.distribution not in _FITTER_MAP:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown distribution '{req.distribution}'. "
                   f"Available: {', '.join(sorted(_FITTER_MAP))}.",
        )

    # Step 1: Convert Nevada chart to life data
    try:
        failures, right_censored = nevada_to_life_data(req.quantities, req.returns)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    if len(failures) == 0:
        raise HTTPException(
            status_code=400,
            detail="No failures found in the Nevada chart; cannot fit a distribution.",
        )

    # Step 2: Fit the distribution
    fitter_class = _FITTER_MAP[req.distribution]
    rc = right_censored if len(right_censored) > 0 else None
    try:
        fit = fitter_class(failures=failures, right_censored=rc, method=req.fit_method)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Fitting error: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Fitting error: {e}")

    # Step 3: Forecast returns
    try:
        forecast_matrix, totals = forecast_returns(
            req.quantities, req.returns, fit.distribution, req.n_forecast_periods,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Forecast error: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Forecast error: {e}")

    return {
        "distribution": req.distribution,
        "params": _extract_params(fit, req.distribution),
        "n_failures": len(failures),
        "n_censored": len(right_censored),
        "forecast": np.round(forecast_matrix, 4).tolist(),
        "totals": np.round(totals, 4).tolist(),
        "failures": failures.tolist(),
        "right_censored": right_censored.tolist(),
    }
