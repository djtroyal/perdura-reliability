"""Process Capability router."""

import sys
import math
from pathlib import Path
from typing import List, Optional, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

# Bootstrap the reliability src package path
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.Process_capability import process_capability

router = APIRouter()


# ---------------------------------------------------------------------------
# Inline Pydantic schema
# ---------------------------------------------------------------------------

class CapabilityRequest(BaseModel):
    data: List[float]
    lsl: Optional[float] = None
    usl: Optional[float] = None
    target: Optional[float] = None
    subgroup_size: int = 1
    n_bins: Optional[int] = None
    stability_status: Literal["assess", "stable", "unstable", "not_assessed"] = "assess"
    bootstrap_samples: int = 200
    bootstrap_confidence: float = 0.95
    seed: Optional[int] = 12345


# ---------------------------------------------------------------------------
# Sanitizer
# ---------------------------------------------------------------------------

from utils import safe as _safe


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/analyze")
def analyze(req: CapabilityRequest):
    """Run a process-capability study (Cp/Cpk/Pp/Ppk/Cpm, DPMO, histogram)."""
    try:
        result = process_capability(
            data=req.data,
            lsl=req.lsl,
            usl=req.usl,
            target=req.target,
            subgroup_size=req.subgroup_size,
            n_bins=req.n_bins,
            stability_status=req.stability_status,
            bootstrap_samples=req.bootstrap_samples,
            bootstrap_confidence=req.bootstrap_confidence,
            seed=req.seed,
        )
    except (ValueError, FloatingPointError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _safe(result)
