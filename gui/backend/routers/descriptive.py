"""Descriptive Statistics router."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

import math
from typing import Optional

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from reliability.Descriptive import (
    summary_statistics,
    frequency_table,
    contingency_table,
    run_chart,
    boxplot_stats,
    histogram,
    qq_plot,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe(v):
    """Map non-finite floats (nan/inf) to None for JSON serialisation."""
    if isinstance(v, float):
        return None if (math.isnan(v) or math.isinf(v)) else v
    if isinstance(v, (int, bool)):
        return v
    if isinstance(v, list):
        return [_safe(x) for x in v]
    if isinstance(v, dict):
        return {k: _safe(val) for k, val in v.items()}
    return v


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class SummaryRequest(BaseModel):
    columns: dict[str, list[float]]


class FrequencyRequest(BaseModel):
    values: list
    bins: Optional[int] = None


class ContingencyRequest(BaseModel):
    row_values: list
    col_values: list


class RunChartRequest(BaseModel):
    values: list[float]


class BoxplotRequest(BaseModel):
    values: list[float]


class HistogramRequest(BaseModel):
    values: list[float]
    bins: Optional[int] = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/summary")
def summary(req: SummaryRequest):
    """Per-column descriptive statistics (n, mean, std, quartiles, normality, etc.)."""
    result = summary_statistics(req.columns)
    return _safe(result)


@router.post("/frequency")
def frequency(req: FrequencyRequest):
    """Frequency table — binned (numeric) or value-counts (discrete/categorical)."""
    result = frequency_table(req.values, bins=req.bins)
    return _safe(result)


@router.post("/contingency")
def contingency(req: ContingencyRequest):
    """2-D contingency table with chi-square independence test."""
    result = contingency_table(req.row_values, req.col_values)
    return _safe(result)


@router.post("/runchart")
def runchart(req: RunChartRequest):
    """Run chart statistics and Wald-Wolfowitz runs test."""
    result = run_chart(req.values)
    return _safe(result)


@router.post("/boxplot")
def boxplot(req: BoxplotRequest):
    """Tukey boxplot statistics including whiskers and outliers."""
    result = boxplot_stats(req.values)
    return _safe(result)


@router.post("/histogram")
def histogram_endpoint(req: HistogramRequest):
    """Histogram counts and bin edges (default bins via Freedman-Diaconis)."""
    result = histogram(req.values, bins=req.bins)
    return _safe(result)


class QQRequest(BaseModel):
    values: list[float]


@router.post("/qq")
def qq(req: QQRequest):
    """Normal Q-Q plot coordinates with a robust quartile reference line."""
    result = qq_plot(req.values)
    return _safe(result)
