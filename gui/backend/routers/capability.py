"""Process Capability router."""

import sys
import math
from pathlib import Path
from typing import List, Optional

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
    result = process_capability(
        data=req.data,
        lsl=req.lsl,
        usl=req.usl,
        target=req.target,
        subgroup_size=req.subgroup_size,
        n_bins=req.n_bins,
    )
    return _safe(result)
