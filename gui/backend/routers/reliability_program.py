"""Reliability program workflow API."""

import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.Reliability_program import analyze_reliability_program
from reliability.AIAG_VDA_FMEA import builtin_rating_profiles
from schemas import ReliabilityProgramRequest


router = APIRouter()


@router.post("/analyze", response_model=dict[str, Any],
             summary="Analyze reliability-program records")
def analyze(request: ReliabilityProgramRequest) -> dict[str, Any]:
    return analyze_reliability_program(**request.model_dump())


@router.get("/fmea/rating-profiles", response_model=list[dict[str, Any]],
            summary="List built-in FMEA rating profiles")
def rating_profiles() -> list[dict[str, Any]]:
    """Expose versioned rating guidance without requiring an analysis run."""
    return builtin_rating_profiles()
