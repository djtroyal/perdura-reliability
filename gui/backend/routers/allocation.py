"""Reliability Allocation router — top-down apportionment of a system target."""

import sys
import math
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

# Bootstrap the reliability src package path
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.Allocation import allocate, AllocationError

router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class AllocationSubsystem(BaseModel):
    name: Optional[str] = None
    failure_rate: Optional[float] = None   # ARINC
    complexity: Optional[float] = None     # AGREE (module count)
    importance: Optional[float] = None     # AGREE (utilisation 0-1)
    difficulty: Optional[float] = None     # Feasibility of effort (1-10)


class AllocationRequest(BaseModel):
    method: str = "equal"                  # equal | arinc | agree | feasibility
    target_reliability: Optional[float] = None
    target_mtbf: Optional[float] = None
    mission_time: float = 1.0
    subsystems: List[AllocationSubsystem]


def _safe(obj):
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if isinstance(obj, dict):
        return {k: _safe(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_safe(v) for v in obj]
    return obj


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/allocate")
def allocate_endpoint(req: AllocationRequest):
    """Allocate a system reliability/MTBF target across subsystems."""
    try:
        result = allocate(
            subsystems=[s.model_dump() for s in req.subsystems],
            method=req.method,
            target_reliability=req.target_reliability,
            target_mtbf=req.target_mtbf,
            mission_time=req.mission_time,
        )
    except AllocationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # numerical / unexpected
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return _safe(result)
