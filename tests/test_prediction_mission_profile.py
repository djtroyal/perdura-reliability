"""Mission-profile prediction endpoint correctness and error semantics."""

import sys
from pathlib import Path

import pytest
from fastapi import HTTPException


BACKEND = Path(__file__).resolve().parents[1] / "gui" / "backend"
sys.path.insert(0, str(BACKEND))

from routers.prediction import predict_mission_profile  # noqa: E402
from schemas import (  # noqa: E402
    MissionPhaseSchema,
    MissionProfilePredictionRequest,
    PredictionPart,
)


def test_invalid_part_phase_returns_structured_error():
    request = MissionProfilePredictionRequest(
        profile_name="Invalid part",
        standard="MIL-HDBK-217F",
        phases=[
            MissionPhaseSchema(
                name="Operation",
                duration=100,
                environment="GB",
                temperature=40,
            )
        ],
        parts=[
            PredictionPart(
                category="resistor",
                name="R-bad",
                params={"style": "not-a-resistor-style"},
            )
        ],
    )

    with pytest.raises(HTTPException) as caught:
        predict_mission_profile(request)

    assert caught.value.status_code == 422
    detail = caught.value.detail
    assert detail["code"] == "MISSION_PART_PHASE_CALCULATION_FAILED"
    assert detail["part_index"] == 0
    assert detail["part_name"] == "R-bad"
    assert detail["phase_index"] == 0
    assert detail["phase_name"] == "Operation"
    assert detail["error_type"] == "ValueError"
    assert "style must be one of" in detail["message"]
