"""Explicit-design inference and sequential testing API."""
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from reliability.Inference_tools import (
    mtbf_interval, binomial_interval, normal_mean_interval, discrete_probability,
    bernoulli_sprt, exponential_sprt,
)
from reliability.Growth_planning import plan_reliability_growth

router = APIRouter()
Sides = Literal['two-sided', 'lower', 'upper']
Terminal = Literal['inconclusive', 'likelihood_ratio']


class Input(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)


class ExposureRow(Input):
    label: str = ''
    units: int = Field(1, ge=1)
    duration: float = Field(gt=0)
    duty: float = Field(1, ge=0, le=1)


class MTBFRequest(Input):
    failures: int = Field(ge=0)
    confidence: float = Field(.95, gt=0, lt=1)
    termination: Literal['time', 'failure'] = 'time'
    sides: Sides = 'two-sided'
    total_exposure: float | None = Field(None, gt=0)
    exposure_rows: list[ExposureRow] | None = Field(None, max_length=1000)


class BinomialRequest(Input):
    trials: int = Field(ge=1)
    count: int = Field(ge=0)
    confidence: float = Field(.95, gt=0, lt=1)
    sides: Sides = 'two-sided'
    orientation: Literal['success', 'defect'] = 'success'
    method: Literal['exact', 'wilson'] = 'exact'


class NormalRequest(Input):
    mean: float
    standard_deviation: float = Field(gt=0)
    sample_size: int = Field(ge=1)
    confidence: float = Field(.95, gt=0, lt=1)
    sides: Sides = 'two-sided'
    sigma_known: bool = False


class DiscreteRequest(Input):
    sample_size: int = Field(ge=1, le=1000000)
    probability: float = Field(.05, ge=0, le=1)
    model: Literal['binomial', 'hypergeometric'] = 'binomial'
    lot_size: int | None = Field(None, ge=1, le=1000000000)
    lot_defects: int | None = Field(None, ge=0)
    event: Literal['at_most', 'at_least', 'exactly', 'between'] = 'at_most'
    threshold: int = Field(0, ge=0)
    upper: int | None = Field(None, ge=0)
    good_quality: float | None = Field(None, ge=0, le=1)
    bad_quality: float | None = Field(None, ge=0, le=1)


class BernoulliRequest(Input):
    good_probability: float = Field(gt=0, lt=1)
    bad_probability: float = Field(gt=0, lt=1)
    alpha: float = Field(.05, gt=0, lt=1)
    beta: float = Field(.1, gt=0, lt=1)
    horizon: int = Field(100, ge=1, le=2000)
    outcomes: list[int] = Field(default_factory=list, max_length=2000)
    terminal_rule: Terminal = 'inconclusive'
    oc_points: int = Field(21, ge=3, le=41)


class ExponentialRequest(Input):
    good_mtbf: float = Field(gt=0)
    bad_mtbf: float = Field(gt=0)
    alpha: float = Field(.05, gt=0, lt=1)
    beta: float = Field(.1, gt=0, lt=1)
    horizon: float = Field(1000, gt=0)
    failure_times: list[float] = Field(default_factory=list, max_length=100000)
    observed_exposure: float = Field(0, ge=0)
    terminal_rule: Terminal = 'inconclusive'
    simulations: int = Field(2000, ge=200, le=20000)
    seed: int = Field(42, ge=0, le=2**32-1)
    oc_points: int = Field(13, ge=3, le=21)


class FixAction(Input):
    name: str
    baseline_failure_rate: float = Field(ge=0)
    planned_fix_time: float = Field(gt=0)
    effectiveness: float = Field(ge=0, le=1)
    effectiveness_lower: float = Field(ge=0, le=1)
    effectiveness_upper: float = Field(ge=0, le=1)


class GrowthPlanRequest(Input):
    current_test_time: float = Field(gt=0)
    current_mtbf: float = Field(gt=0)
    target_mtbf: float = Field(gt=0)
    growth_rate: float = Field(gt=0, lt=1)
    planned_additional_test_time: float | None = Field(None, gt=0)
    unaddressed_failure_rate: float = Field(0, ge=0)
    corrective_actions: list[FixAction] = Field(default_factory=list, max_length=100)
    baseline_basis: Literal['instantaneous', 'initial_phase_average'] = 'instantaneous'
    phase_durations: list[float] = Field(default_factory=list, max_length=100)
    provenance: str = Field('', max_length=4000)


@router.post('/mtbf-interval')
def aggregate_mtbf(request: MTBFRequest):
    return mtbf_interval(**request.model_dump())


@router.post('/binomial-interval')
def proportion_interval(request: BinomialRequest):
    return binomial_interval(**request.model_dump())


@router.post('/normal-mean-interval')
def normal_summary(request: NormalRequest):
    return normal_mean_interval(**request.model_dump())


@router.post('/discrete-probability')
def probability_explorer(request: DiscreteRequest):
    return discrete_probability(**request.model_dump())


@router.post('/bernoulli-sprt')
def sequential_bernoulli(request: BernoulliRequest):
    return bernoulli_sprt(**request.model_dump())


@router.post('/exponential-sprt')
def sequential_exponential(request: ExponentialRequest):
    return exponential_sprt(**request.model_dump())


@router.post('/growth-plan')
def growth_phases(request: GrowthPlanRequest):
    return plan_reliability_growth(**request.model_dump())
