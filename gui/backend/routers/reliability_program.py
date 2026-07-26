"""Reliability program workflow API."""

import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.Reliability_program import analyze_reliability_program
from schemas import ReliabilityProgramRequest


router = APIRouter()


@router.post("/analyze", response_model=dict[str, Any],
             summary="Analyze reliability-program records")
def analyze(request: ReliabilityProgramRequest) -> dict[str, Any]:
    result = analyze_reliability_program(
        **request.model_dump(),
        fmea=(),
        fmea_analyses=(),
        rating_profiles=(),
    )
    result.pop("fmea", None)
    result.pop("aiag_vda_fmea", None)
    return result
