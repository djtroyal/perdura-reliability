"""Software Reliability Engineering API."""

import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.Software_reliability import fit_software_reliability
from schemas import SoftwareReliabilityRequest


router = APIRouter()


@router.post(
    "/fit",
    response_model=dict[str, Any],
    summary="Fit and compare software reliability-growth models",
)
def fit(request: SoftwareReliabilityRequest) -> dict[str, Any]:
    """Fit NHPPs to execution/exposure-indexed software failures.

    The result includes model eligibility, likelihood comparisons, diagnostic
    goodness-of-fit information, uncertainty, failure-intensity projections,
    release-target context, and method provenance.
    """
    return fit_software_reliability(**request.model_dump())
