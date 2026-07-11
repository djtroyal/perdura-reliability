"""Human Reliability Analysis (HRA) router.

Exposes the implemented HRA methods in reliability.HRA plus clearly identified
screening worksheets. Legacy JHEDI/SHERPA/ATHEANA/MERMOS paths remain available
for saved clients, but return warnings because they are not full implementations
of those published methods. Bad input raises ValueError → HTTP 400 via the
global handler in main.py.
"""

import sys
from pathlib import Path
from typing import Dict, List, Literal, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability import HRA

from utils import safe as _safe

router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class EpcItem(BaseModel):
    epc_id: int
    proportion: float = Field(..., ge=0, le=1)


class HeartRequest(BaseModel):
    gtt: str
    epcs: List[EpcItem] = []


class SparHDependency(BaseModel):
    enabled: bool = False
    level: Optional[Literal['zero', 'low', 'moderate', 'high', 'complete']] = None
    same_crew: Optional[bool] = None
    close_in_time: Optional[bool] = None
    same_location: Optional[bool] = None
    additional_cues: Optional[bool] = None
    failure_number_in_sequence: int = Field(2, ge=2)
    justification: str = ""


class SparHRequest(BaseModel):
    task_type: str = "action"
    psfs: Dict[str, str] = {}
    dependency: Optional[SparHDependency] = None
    uncertainty_confidence: float = Field(0.90, gt=0, lt=1)
    uncertainty_alpha: Optional[float] = Field(None, gt=0)


class TherpRequest(BaseModel):
    nominal_hep: float = Field(..., ge=0, le=1)
    stress: str = "optimal"
    experience: str = "skilled"
    second_hep: Optional[float] = Field(None, ge=0, le=1)
    dependency: str = "ZD"


class CreamRequest(BaseModel):
    cpc_levels: Dict[str, str] = {}


class CreamStep(BaseModel):
    description: str = ""
    activity: str
    failure_type: str


class CreamExtendedRequest(BaseModel):
    cpc_levels: Dict[str, str] = {}
    steps: List[CreamStep]


class SlimPsf(BaseModel):
    weight: float = Field(..., ge=0)
    rating: float


class SlimAnchor(BaseModel):
    sli: float
    hep: float = Field(..., gt=0, lt=1)


class SlimRequest(BaseModel):
    psfs: List[SlimPsf]
    anchors: Optional[List[SlimAnchor]] = None
    a: Optional[float] = None
    b: Optional[float] = None


class JhediRequest(BaseModel):
    task_category: str
    aggravating_factors: int = Field(0, ge=0)


class SherpaRow(BaseModel):
    error_mode: str = "unspecified"
    probability: str = "M"
    critical: bool = False


class SherpaRequest(BaseModel):
    rows: List[SherpaRow]


class AtheanaRequest(BaseModel):
    min_hep: float = Field(..., ge=0, le=1)
    mode_hep: float = Field(..., ge=0, le=1)
    max_hep: float = Field(..., ge=0, le=1)


class MermosScenario(BaseModel):
    label: str = "scenario"
    probability: float = Field(..., ge=0, le=1)


class MermosRequest(BaseModel):
    scenarios: List[MermosScenario]
    mutually_exclusive: bool = False


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/heart")
def heart(req: HeartRequest):
    return _safe(HRA.heart(req.gtt, [e.model_dump() for e in req.epcs]))


@router.post("/spar-h")
def spar_h(req: SparHRequest):
    return _safe(HRA.spar_h(
        req.task_type,
        req.psfs,
        dependency=req.dependency.model_dump() if req.dependency else None,
        uncertainty_confidence=req.uncertainty_confidence,
        uncertainty_alpha=req.uncertainty_alpha,
    ))


@router.post("/therp")
def therp(req: TherpRequest):
    return _safe(HRA.therp(req.nominal_hep, req.stress, req.experience,
                           req.second_hep, req.dependency))


@router.post("/cream")
def cream(req: CreamRequest):
    return _safe(HRA.cream(req.cpc_levels))


@router.post("/cream-extended")
def cream_extended(req: CreamExtendedRequest):
    return _safe(HRA.cream_extended(req.cpc_levels, [s.model_dump() for s in req.steps]))


@router.post("/slim")
def slim(req: SlimRequest):
    return _safe(HRA.slim([p.model_dump() for p in req.psfs],
                          [a.model_dump() for a in req.anchors] if req.anchors else None,
                          req.a, req.b))


@router.post("/jhedi")
def jhedi(req: JhediRequest):
    return _safe(HRA.jhedi(req.task_category, req.aggravating_factors))


@router.post("/category-screening")
def category_screening(req: JhediRequest):
    return _safe(HRA.category_factor_screening(
        req.task_category, req.aggravating_factors))


@router.post("/sherpa")
def sherpa(req: SherpaRequest):
    return _safe(HRA.sherpa([r.model_dump() for r in req.rows]))


@router.post("/error-mode-screening")
def error_mode_screening(req: SherpaRequest):
    return _safe(HRA.error_mode_screening([r.model_dump() for r in req.rows]))


@router.post("/atheana")
def atheana(req: AtheanaRequest):
    return _safe(HRA.atheana(req.min_hep, req.mode_hep, req.max_hep))


@router.post("/efc-elicitation-screening")
def efc_elicitation_screening(req: AtheanaRequest):
    return _safe(HRA.efc_elicitation_screening(
        req.min_hep, req.mode_hep, req.max_hep))


@router.post("/mermos")
def mermos(req: MermosRequest):
    return _safe(HRA.mermos([s.model_dump() for s in req.scenarios]))


@router.post("/mission-scenario-screening")
def mission_scenario_screening(req: MermosRequest):
    return _safe(HRA.mission_scenario_screening(
        [s.model_dump() for s in req.scenarios], req.mutually_exclusive))
