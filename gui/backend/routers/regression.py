"""Regression Analysis router for Perdura."""
from __future__ import annotations

import math
import sys
from pathlib import Path
from typing import Optional

# Bootstrap path so we can import from src/reliability/
_root = Path(__file__).resolve().parents[3]
_src = _root / "src"
if str(_src) not in sys.path:
    sys.path.insert(0, str(_src))

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from reliability.Regression import (
    linear_regression,
    ridge_regression,
    lasso_regression,
    logistic_regression,
    polynomial_regression,
)

router = APIRouter(prefix="/api/regression", tags=["Regression"])


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class FitRequest(BaseModel):
    model: str  # 'linear' | 'ridge' | 'lasso' | 'logistic' | 'polynomial'
    data: dict[str, list[float]]  # column name -> values
    y: str                        # response column name
    x: list[str]                  # predictor column names
    alpha: Optional[float] = 1.0
    degree: Optional[int] = 2
    fit_intercept: Optional[bool] = True


# ---------------------------------------------------------------------------
# Sanitizer
# ---------------------------------------------------------------------------

def _safe_val(v):
    """Replace non-finite floats with None so JSON serialisation succeeds."""
    if isinstance(v, float):
        if math.isnan(v) or math.isinf(v):
            return None
    return v


def _sanitize(obj):
    """Recursively sanitize non-finite floats in dicts/lists."""
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize(item) for item in obj]
    if isinstance(obj, float):
        return _safe_val(obj)
    return obj


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/fit")
def fit_regression(req: FitRequest):
    """
    Fit a regression model.

    Body fields
    -----------
    model         : 'linear' | 'ridge' | 'lasso' | 'logistic' | 'polynomial'
    data          : dict of column_name -> [float, ...]
    y             : name of the response column in data
    x             : list of predictor column names in data
    alpha         : regularization strength (ridge / lasso only)
    degree        : polynomial degree (polynomial only)
    fit_intercept : whether to fit intercept (linear / logistic)
    """
    # ---- validate columns ----
    if req.y not in req.data:
        raise HTTPException(status_code=400, detail=f"Response column '{req.y}' not found in data.")
    for col in req.x:
        if col not in req.data:
            raise HTTPException(status_code=400, detail=f"Predictor column '{col}' not found in data.")

    y_raw = req.data[req.y]
    n_obs = len(y_raw)

    if n_obs < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 observations.")

    # Build X (list of lists: n rows × p cols)
    X_cols = [req.data[col] for col in req.x]
    if len(X_cols) == 0:
        raise HTTPException(status_code=400, detail="At least one predictor column required.")

    # Check consistent lengths
    for col in req.x:
        if len(req.data[col]) != n_obs:
            raise HTTPException(
                status_code=400,
                detail=f"Column '{col}' has {len(req.data[col])} values but y has {n_obs}.",
            )

    import numpy as np  # local import to keep module import fast

    X = np.column_stack(X_cols)  # shape (n, p)
    y = np.array(y_raw, dtype=float)

    try:
        model = req.model.lower()

        if model == "linear":
            result = linear_regression(
                X, y,
                feature_names=list(req.x),
                fit_intercept=req.fit_intercept if req.fit_intercept is not None else True,
            )

        elif model == "ridge":
            alpha = req.alpha if req.alpha is not None else 1.0
            result = ridge_regression(X, y, alpha=alpha, feature_names=list(req.x))

        elif model == "lasso":
            alpha = req.alpha if req.alpha is not None else 1.0
            result = lasso_regression(X, y, alpha=alpha, feature_names=list(req.x))

        elif model == "logistic":
            result = logistic_regression(
                X, y,
                feature_names=list(req.x),
                fit_intercept=req.fit_intercept if req.fit_intercept is not None else True,
            )

        elif model == "polynomial":
            if len(req.x) != 1:
                raise ValueError("Polynomial regression requires exactly one predictor column.")
            degree = req.degree if req.degree is not None else 2
            x_1d = X[:, 0]
            result = polynomial_regression(x_1d, y, degree=degree)

        else:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown model type '{req.model}'. "
                       "Choose from: linear, ridge, lasso, logistic, polynomial.",
            )

    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    result["model"] = req.model
    return _sanitize(result)
