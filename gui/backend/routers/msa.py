"""Measurement Systems Analysis (MSA) / Gage R&R router."""

import sys
import math
from pathlib import Path
from typing import List, Optional, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

# Bootstrap the reliability src package path
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.MSA import gage_rr_anova, gage_rr_xbar_r

router = APIRouter()


# ---------------------------------------------------------------------------
# Inline Pydantic schemas
# ---------------------------------------------------------------------------

class GageRRRequest(BaseModel):
    parts: List[str]
    operators: List[str]
    measurements: List[float]
    tolerance: Optional[float] = None
    study_var_multiplier: float = 6.0
    method: Literal["anova", "xbar_r"] = "anova"
    alpha_pool: float = 0.25


# ---------------------------------------------------------------------------
# Sanitizer — replace nan/inf with None so JSON serialises cleanly
# ---------------------------------------------------------------------------

from utils import safe as _safe


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/gage-rr")
def gage_rr(req: GageRRRequest):
    """
    Run a crossed Gage R&R study.

    - method='anova'   : Full ANOVA with optional interaction pooling
    - method='xbar_r'  : Average & Range (AIAG) method

    Returns variance components, ANOVA table (ANOVA only), NDC, and
    per-cell means for plotting.
    """
    if len(req.parts) != len(req.operators) or len(req.parts) != len(req.measurements):
        raise HTTPException(
            status_code=400,
            detail="parts, operators, and measurements must have the same length.",
        )

    try:
        if req.method == "anova":
            result = gage_rr_anova(
                parts=req.parts,
                operators=req.operators,
                measurements=req.measurements,
                tolerance=req.tolerance,
                study_var_multiplier=req.study_var_multiplier,
                alpha_pool=req.alpha_pool,
            )
        else:
            result = gage_rr_xbar_r(
                parts=req.parts,
                operators=req.operators,
                measurements=req.measurements,
                tolerance=req.tolerance,
                study_var_multiplier=req.study_var_multiplier,
            )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return _safe(result)
