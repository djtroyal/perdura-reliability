"""Lifetime planning tools with explicit renewal and predictive semantics."""
from typing import Literal
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from reliability.Lifetime_tools import survival_matrix, mechanical_equivalent_rate, inspection_failure_prediction
from routers.life_data import _build_distribution
from routers.maintenance import _build_dist
from utils import safe

router = APIRouter()


class StrictRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)


class SurvivalMatrixRequest(StrictRequest):
    distribution: str = 'Weibull_2P'
    params: dict[str, float]
    ages: list[float] = Field(min_length=1, max_length=2500)
    durations: list[float] = Field(min_length=1, max_length=2500)


class MechanicalRateRequest(StrictRequest):
    exposure_basis: Literal['time', 'non_time'] = 'time'
    beta: float = Field(gt=0)
    interval: float = Field(gt=0)
    eta: float | None = Field(None, gt=0)
    percentile_life: float | None = Field(None, gt=0)
    failure_percentile: float = Field(.1, gt=0, lt=1)
    corrective_downtime: float = Field(0, ge=0)
    preventive_downtime: float = Field(0, ge=0)


class InspectionPredictionRequest(StrictRequest):
    n: int = Field(ge=1, le=1_000_000_000, strict=True)
    failures: int = Field(ge=0, strict=True)
    first_age: float = Field(gt=0)
    second_age: float = Field(gt=0)
    betas: list[float] = Field(min_length=1, max_length=12)
    level: float = Field(.95, gt=0, lt=1)
    prior_alpha: float = Field(.5, gt=0, le=1e6)
    prior_beta: float = Field(.5, gt=0, le=1e6)
    cdf_tolerance: float = Field(5e-4, ge=1/65536, le=.005)
    prior_sensitivity: bool = True


def _call(function, **kwargs):
    try:
        # Preserve small tail probabilities; sanitize nonfinite values only.
        return safe(function(**kwargs))
    except (ValueError, OverflowError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post('/survival-matrix')
def matrix(req: SurvivalMatrixRequest):
    distribution = (_build_dist(req.distribution, req.params) if req.distribution.islower()
                    else _build_distribution(req.distribution, req.params))
    return _call(survival_matrix, distribution=distribution, ages=req.ages, durations=req.durations)


@router.post('/mechanical-rate')
def mechanical(req: MechanicalRateRequest):
    return _call(mechanical_equivalent_rate, **req.model_dump())


@router.post('/inspection-prediction')
def inspection(req: InspectionPredictionRequest):
    return _call(inspection_failure_prediction, **req.model_dump())
