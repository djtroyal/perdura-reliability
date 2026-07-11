"""Step-stress cumulative-exposure correctness tests."""

import sys
from pathlib import Path

import pytest
from fastapi import HTTPException


BACKEND = Path(__file__).resolve().parents[1] / "gui" / "backend"
sys.path.insert(0, str(BACKEND))

from routers.alt import step_stress  # noqa: E402
from schemas import StepStressRequest  # noqa: E402


def _request(**overrides):
    values = {
        "steps": [
            {"stress": 1, "duration": 10},
            {"stress": 2, "duration": 10},
            {"stress": 4, "duration": 10},
        ],
        "failure_times": [21, 25],
        "stress_at_failure": [4, 4],
        "distribution": "Weibull",
    }
    values.update(overrides)
    return StepStressRequest(**values)


def test_prior_steps_are_accelerated_in_cumulative_exposure():
    result = step_stress(_request())

    assert result["exponent_p"] == 2.0
    assert result["equivalent_times"] == pytest.approx([66.0, 130.0])
    assert [row["equivalent_start"] for row in result["step_exposure"]] \
        == pytest.approx([0.0, 10.0, 50.0])
    assert [row["equivalent_end"] for row in result["step_exposure"]] \
        == pytest.approx([10.0, 50.0, 210.0])


def test_failure_stress_must_match_cumulative_time_step():
    with pytest.raises(HTTPException) as caught:
        step_stress(_request(
            failure_times=[15, 25],
            stress_at_failure=[4, 4],
        ))

    assert caught.value.status_code == 400
    assert "lies in the 2 stress step" in caught.value.detail


def test_failure_time_must_be_inside_profile():
    with pytest.raises(HTTPException) as caught:
        step_stress(_request(failure_times=[21, 31]))

    assert caught.value.status_code == 400
    assert "within (0, 30]" in caught.value.detail


@pytest.mark.parametrize(
    "steps, message",
    [
        ([{"stress": 1, "duration": 10},
          {"stress": 1, "duration": 10}], "strictly increasing"),
        ([{"stress": 2, "duration": 10},
          {"stress": 1, "duration": 10}], "strictly increasing"),
        ([{"stress": 1, "duration": 0},
          {"stress": 2, "duration": 10}], "duration"),
    ],
)
def test_step_profile_validation(steps, message):
    with pytest.raises(HTTPException) as caught:
        step_stress(_request(steps=steps))

    assert caught.value.status_code == 400
    assert message in caught.value.detail
