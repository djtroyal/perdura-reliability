"""API-level contract checks for Software Reliability Engineering."""

import sys
from pathlib import Path


BACKEND = Path(__file__).resolve().parents[1]
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(ROOT / "src"))

from schemas import SoftwareReliabilityRequest
from routers.software_reliability import fit


def test_schema_and_route_preserve_terminal_exposure():
    request = SoftwareReliabilityRequest(
        event_times=[2, 5, 10, 18, 29, 43],
        observation_end=60,
        models=["hpp", "goel_okumoto"],
        prediction_horizon=20,
        mission_duration=10,
    )
    response = fit(request)
    assert response["observation_end"] == 60
    assert response["n_failures"] == 6
    assert {item["model"] for item in response["models"]} == {"hpp", "goel_okumoto"}
    assert response["standards_context"]["status"] == "standards_informed_not_certified_conformance"


def test_interval_count_api_mode():
    response = fit(SoftwareReliabilityRequest(
        observation_end=40,
        interval_endpoints=[10, 20, 30, 40],
        interval_counts=[4, 3, 2, 1],
        models=["hpp"],
    ))
    assert response["data_mode"] == "interval_counts"
    assert response["n_intervals"] == 4
