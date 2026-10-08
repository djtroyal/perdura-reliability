"""HTTP regressions for the API defects found by active assurance scans."""

from __future__ import annotations

import importlib.util
import json
import math
from pathlib import Path
import sys

import pytest
from fastapi.testclient import TestClient


BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from schemas import TestSimulationRequest as SimulationRequest


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    """Exercise production routing without depending on a frontend build."""
    static_dir = tmp_path_factory.mktemp("api-boundary-frontend")
    (static_dir / "assets").mkdir()
    (static_dir / "index.html").write_text("<html>Perdura test frontend</html>")
    spec = importlib.util.spec_from_file_location(
        "perdura_api_boundary_test_app", BACKEND / "main.py",
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    with pytest.MonkeyPatch.context() as patch:
        patch.setenv("PERDURA_STATIC_DIR", str(static_dir))
        spec.loader.exec_module(module)
    with TestClient(module.app, raise_server_exceptions=False, headers={
        "X-Perdura-Client-API-Contract": "1",
        "X-Request-ID": "api-boundary-test",
    }) as test_client:
        yield test_client


def assert_error(response, status, code="request_error"):
    assert response.status_code == status
    assert response.headers["content-type"].startswith("application/json")
    error = response.json()["error"]
    assert set(error) == {"code", "message", "issues", "request_id"}
    assert error["code"] == code
    assert error["request_id"] == "api-boundary-test"
    return error


@pytest.mark.parametrize("path", ["/api", "/api/", "/api/unknown", "/api/v1/missing"])
@pytest.mark.parametrize("method", ["GET", "POST", "DELETE"])
def test_unknown_api_paths_never_return_spa_html(client, method, path):
    response = client.request(method, path)
    assert_error(response, 404)
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "Perdura test frontend" not in response.text


@pytest.mark.parametrize("method,path,allowed", [
    ("GET", "/api/v1/alt/test-simulation", "POST"),
    ("DELETE", "/api/v1/alt/test-simulation", "POST"),
    ("POST", "/api/v1/health", "GET"),
])
def test_wrong_api_methods_return_json_and_allow_header(client, method, path, allowed):
    response = client.request(method, path)
    assert_error(response, 405)
    assert allowed in response.headers["allow"].split(", ")


@pytest.mark.parametrize("path", ["/", "/life-data/project", "/apiary"])
def test_frontend_navigation_keeps_spa_fallback(client, path):
    response = client.get(path)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert response.text == "<html>Perdura test frontend</html>"
    assert "no-store" in response.headers["cache-control"]


def test_api_health_and_trailing_slash_redirect_still_work(client):
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    redirected = client.get("/api/v1/health/", follow_redirects=False)
    assert redirected.status_code == 307
    assert redirected.headers["location"].endswith("/api/v1/health")


def test_api_contract_negotiation_remains_enforced(client):
    response = client.get("/api/v1/catalog", headers={
        "X-Perdura-Client-API-Contract": "999",
    })
    assert_error(response, 409, "frontend_update_required")


@pytest.mark.parametrize("invalid", [
    {"distribution": "Unknown"},
    {"metric": "unknown"},
    {"n": 1},
    {"num_simulations": 9},
    {"seed": -1},
    {"test_duration": 0},
    {"test_duration": -1},
    {"eta": 0},
    {"distribution": "Exponential", "eta": -1},
    {"beta": 0},
    {"distribution": "Normal", "beta": -1},
    {"target_time": -1},
    {"target_value": -0.1},
    {"target_value": 1.1},
    {"metric": "B10", "target_value": -1},
    *({field: value} for field in (
        "beta", "eta", "test_duration", "target_time", "target_value",
    ) for value in (float("inf"), float("nan"))),
])
def test_invalid_simulation_inputs_are_rejected_before_sampling(client, monkeypatch, invalid):
    import routers.alt as alt

    def must_not_sample(*_args, **_kwargs):
        pytest.fail("invalid input reached the numerical simulation")

    monkeypatch.setattr(alt.np.random, "default_rng", must_not_sample)
    # Raw JSON also tests rejection of nonfinite values accepted by the JSON
    # decoder; httpx's convenience serializer correctly refuses those itself.
    response = client.post(
        "/api/v1/alt/test-simulation", content=json.dumps(invalid),
        headers={"Content-Type": "application/json"},
    )
    error = assert_error(response, 422, "request_validation_error")
    assert error["issues"]


@pytest.mark.parametrize("distribution", ["Normal", "Lognormal"])
@pytest.mark.parametrize("eta", [0, -2.5])
def test_location_parameters_remain_valid(distribution, eta):
    request = SimulationRequest(distribution=distribution, eta=eta)
    assert request.eta == eta


def test_unused_parameters_do_not_invent_distribution_restrictions():
    assert SimulationRequest(distribution="Exponential", beta=-2).beta == -2
    assert SimulationRequest(metric="B10", target_time=-1, target_value=100).target_value == 100


def test_non_estimable_censored_design_is_a_client_error_with_counts(client):
    response = client.post("/api/v1/alt/test-simulation", json={
        "distribution": "Weibull", "beta": 2, "eta": 1000, "n": 20,
        "test_duration": 1e-12, "num_simulations": 10, "seed": 42,
    })
    error = assert_error(response, 400, "insufficient_simulation_fits")
    issue = error["issues"][0]
    assert issue["valid_fits"] == 0
    assert issue["completed_simulations"] == issue["requested_simulations"] == 10


def test_nominal_simulation_is_finite_and_reproducible(client):
    payload = {
        "distribution": "Weibull", "beta": 2, "eta": 1000, "n": 20,
        "test_duration": 1500, "num_simulations": 100, "seed": 42,
    }
    response = client.post("/api/v1/alt/test-simulation", json=payload)
    assert response.status_code == 200
    result = response.json()
    assert result == client.post("/api/v1/alt/test-simulation", json=payload).json()
    assert result["n_valid"] == result["num_simulations"] == 100
    assert not result["early_stopped"]
    # Recorded from main 0798994 before the error-contract repair. Input
    # validation must not change the seeded scientific calculation.
    for key, expected in {
        "mean": 0.790026, "median": 0.793276, "std": 0.084983,
        "p5": 0.639216, "p95": 0.929006,
    }.items():
        assert result[key] == pytest.approx(expected, abs=1e-6)
    assert all(math.isfinite(result[key]) for key in ("mean", "median", "std", "p5", "p95"))
    assert 0 <= result["p5"] <= result["median"] <= result["p95"] <= 1
    assert sum(result["histogram"]["counts"]) == result["n_valid"]


def test_unexpected_fitter_errors_remain_generic_server_errors(client, monkeypatch):
    import scipy.optimize

    def broken_fitter(*_args, **_kwargs):
        raise RuntimeError("internal implementation detail must stay in the server log")

    monkeypatch.setattr(scipy.optimize, "brentq", broken_fitter)
    response = client.post("/api/v1/alt/test-simulation", json={
        "num_simulations": 10, "seed": 42,
    })
    assert_error(response, 500, "internal_error")
    assert "internal implementation detail" not in response.text
