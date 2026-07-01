"""Human Reliability Analysis (HRA) router.

Exposes the HRA methods in reliability.HRA: HEART, SPAR-H, THERP, CREAM, SLIM,
JHEDI, SHERPA, ATHEANA and MERMOS. Each endpoint validates its inputs and
returns a human-error probability (HEP) plus method-specific detail. Bad input
raises ValueError → HTTP 400 via the global handler in main.py.
"""

import sys
from pathlib import Path
from typing import Dict, List, Optional

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


class SparHRequest(BaseModel):
    task_type: str = "action"
    psfs: Dict[str, str] = {}


class TherpRequest(BaseModel):
    nominal_hep: float = Field(..., ge=0, le=1)
    stress: str = "optimal"
    experience: str = "skilled"
    second_hep: Optional[float] = Field(None, ge=0, le=1)
    dependency: str = "ZD"


class CreamRequest(BaseModel):
    cpc_levels: Dict[str, str] = {}


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


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/heart")
def heart(req: HeartRequest):
    return _safe(HRA.heart(req.gtt, [e.model_dump() for e in req.epcs]))


@router.post("/spar-h")
def spar_h(req: SparHRequest):
    return _safe(HRA.spar_h(req.task_type, req.psfs))


@router.post("/therp")
def therp(req: TherpRequest):
    return _safe(HRA.therp(req.nominal_hep, req.stress, req.experience,
                           req.second_hep, req.dependency))


@router.post("/cream")
def cream(req: CreamRequest):
    return _safe(HRA.cream(req.cpc_levels))


@router.post("/slim")
def slim(req: SlimRequest):
    return _safe(HRA.slim([p.model_dump() for p in req.psfs],
                          [a.model_dump() for a in req.anchors] if req.anchors else None,
                          req.a, req.b))


@router.post("/jhedi")
def jhedi(req: JhediRequest):
    return _safe(HRA.jhedi(req.task_category, req.aggravating_factors))


@router.post("/sherpa")
def sherpa(req: SherpaRequest):
    return _safe(HRA.sherpa([r.model_dump() for r in req.rows]))


@router.post("/atheana")
def atheana(req: AtheanaRequest):
    return _safe(HRA.atheana(req.min_hep, req.mode_hep, req.max_hep))


@router.post("/mermos")
def mermos(req: MermosRequest):
    return _safe(HRA.mermos([s.model_dump() for s in req.scenarios]))
