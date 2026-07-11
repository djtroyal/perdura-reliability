"""Warranty data analysis router."""

import sys
import numpy as np
from fastapi import APIRouter, HTTPException
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.Warranty import (
    nevada_to_life_data,
    nevada_to_grouped_life_data,
    fit_grouped_warranty_distribution,
    forecast_returns,
    forecast_parameter_interval,
)
from schemas import (
    WarrantyConvertRequest, WarrantyForecastRequest,
)

router = APIRouter()

_SUPPORTED_GROUPED_DISTRIBUTIONS = {
    "Weibull_2P", "Exponential_1P", "Normal_2P", "Lognormal_2P",
    "Gamma_2P", "Loglogistic_2P", "Gumbel_2P",
}

@router.post("/convert")
def convert_nevada(req: WarrantyConvertRequest):
    """Preserve a Nevada chart as weighted grouped censoring observations."""
    try:
        grouped = nevada_to_grouped_life_data(req.quantities, req.returns)
        try:
            failures, right_censored = nevada_to_life_data(
                req.quantities, req.returns)
            legacy_available = True
        except ValueError as legacy_error:
            if "integral counts" not in str(legacy_error):
                raise
            failures = np.asarray([], dtype=float)
            right_censored = np.asarray([], dtype=float)
            legacy_available = False
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "failures": failures.tolist(),
        "right_censored": right_censored.tolist(),
        "n_failures": grouped["n_failures"],
        "n_censored": grouped["n_censored"],
        "interval_failures": grouped["interval_failures"],
        "right_censored_groups": grouped["right_censored"],
        "observation_model": grouped["observation_model"],
        "legacy_exact_age_expansion_available": legacy_available,
        "migration_note": (
            "failures/right_censored are a compatibility endpoint-age expansion "
            "for integral counts only; fitting uses interval_failures and "
            "right_censored_groups without rounding"),
    }


@router.post("/forecast")
def forecast(req: WarrantyForecastRequest):
    """Forecast future warranty returns from Nevada chart data."""
    if req.distribution not in _SUPPORTED_GROUPED_DISTRIBUTIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown distribution '{req.distribution}'. "
                   f"Grouped warranty models: "
                   f"{', '.join(sorted(_SUPPORTED_GROUPED_DISTRIBUTIONS))}.",
        )
    if req.fit_method.upper() != "MLE":
        raise HTTPException(
            status_code=400,
            detail="Grouped interval-censored warranty fitting supports MLE only.",
        )

    # Fit weighted period intervals directly; do not expand or round counts.
    try:
        grouped = nevada_to_grouped_life_data(req.quantities, req.returns)
        fit = fit_grouped_warranty_distribution(
            req.quantities, req.returns, distribution=req.distribution,
            CI=req.CI,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    if not fit.converged:
        raise HTTPException(
            status_code=400,
            detail=("Grouped interval-censored likelihood did not converge: "
                    f"{fit.optimizer_message}"),
        )

    # Conditional expected returns plus a parameter-only uncertainty interval.
    try:
        forecast_matrix, totals = forecast_returns(
            req.quantities, req.returns, fit.distribution, req.n_forecast_periods,
        )
        forecast_interval = forecast_parameter_interval(
            req.quantities, req.returns, fit, req.n_forecast_periods,
            n_draws=req.n_parameter_draws, CI=req.CI, seed=req.seed,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Forecast error: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Forecast error: {e}")

    # Compatibility arrays are returned only when every count is integral and
    # are never used in the grouped fit.
    try:
        failures, right_censored = nevada_to_life_data(
            req.quantities, req.returns)
        legacy_available = True
    except ValueError as legacy_error:
        if "integral counts" not in str(legacy_error):
            raise HTTPException(status_code=400, detail=str(legacy_error))
        failures = np.asarray([], dtype=float)
        right_censored = np.asarray([], dtype=float)
        legacy_available = False

    return {
        "distribution": req.distribution,
        "params": {key: round(float(value), 6)
                   for key, value in fit.params.items()},
        "n_failures": grouped["n_failures"],
        "n_censored": grouped["n_censored"],
        "forecast": np.round(forecast_matrix, 4).tolist(),
        "totals": np.round(totals, 4).tolist(),
        "forecast_interval": forecast_interval,
        "fit": {
            "method": "weighted_grouped_interval_censored_MLE",
            "log_likelihood": fit.loglik, "AIC": fit.AIC, "BIC": fit.BIC,
            "converged": fit.converged,
            "optimizer_message": fit.optimizer_message,
            "successful_starts": fit.successful_starts,
            "parameter_interval_method": "local_optimizer_covariance_Wald",
        },
        "observation_model": grouped["observation_model"],
        "interval_failures": grouped["interval_failures"],
        "right_censored_groups": grouped["right_censored"],
        "failures": failures.tolist(),
        "right_censored": right_censored.tolist(),
        "legacy_exact_age_expansion_available": legacy_available,
        "migration_note": (
            "Forecast fitting now uses weighted interval-censored period groups; "
            "legacy exact-age arrays are compatibility-only and may be empty."),
    }
