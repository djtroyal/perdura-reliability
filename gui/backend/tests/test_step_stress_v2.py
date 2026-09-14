"""Versioned HTTP contract and unsupported-model rejection."""
import asyncio
import json as json_module
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from routers import alt
from reliability.Utils import FitConvergenceError


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(alt.router, prefix="/alt")
    # Exercise real ASGI validation/serialization without a test-only HTTP
    # client dependency tied to the installed Starlette version.
    def post(path, json):
        body = json_module.dumps(json).encode()
        messages = []
        scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
                 "method": "POST", "path": path, "raw_path": path.encode(), "root_path": "",
                 "scheme": "http", "query_string": b"", "server": ("test", 80), "client": ("test", 1),
                 "headers": [(b"content-type", b"application/json")]}
        async def exchange():
            received = False
            completed = asyncio.Event()
            async def receive():
                nonlocal received
                if not received:
                    received = True
                    return {"type": "http.request", "body": body, "more_body": False}
                await completed.wait()
                return {"type": "http.disconnect"}
            async def send(message):
                messages.append(message)
                if message["type"] == "http.response.body" and not message.get("more_body", False):
                    completed.set()
            await asyncio.wait_for(app(scope, receive, send), timeout=30)
        asyncio.run(exchange())
        text = b"".join(message.get("body", b"") for message in messages).decode()
        return SimpleNamespace(status_code=messages[0]["status"], text=text,
                               json=lambda: json_module.loads(text))
    return SimpleNamespace(post=post)


def payload():
    return {"steps": [{"stress": 1, "duration": 20}],
            "observations": [{"time": 2, "status": "failure"}, {"time": 5, "status": "failure"},
                             {"time": 10, "status": "right_censored"}],
            "fit_mode": "fixed_exponent", "fixed_exponent": 0}


def test_v2_serializes_likelihood_and_uncertainty_metadata(client):
    response = client.post("/alt/step-stress/v2", json=payload())
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["schema"] == "perdura.step-stress/v2"
    assert result["n_right_censored"] == 1
    assert result["fit_mode"] == "fixed_exponent"
    assert result["analysis_metadata"]["engine_revision"] == 2
    assert result["analysis_metadata"]["uncertainty"]["status"] == result["uncertainty"]["status"]


@pytest.mark.parametrize("update", [{"distribution": "Normal"}, {"life_stress_model": "Arrhenius"}, {"schema_version": 1}, {"failure_times": [2, 5]}])
def test_unsupported_models_or_legacy_shapes_are_not_silently_substituted(client, update):
    response = client.post("/alt/step-stress/v2", json={**payload(), **update})
    assert response.status_code == 422


def test_unidentified_request_returns_clear_client_error(client):
    request = payload()
    request.update(fit_mode="joint", fixed_exponent=None)
    response = client.post("/alt/step-stress/v2", json=request)
    assert response.status_code == 400
    assert "unidentified" in response.json()["detail"]


def test_optimizer_failure_is_not_returned_as_success(client, monkeypatch):
    def fail(*args, **kwargs):
        raise FitConvergenceError("unidentified optimum")
    monkeypatch.setattr(alt, "fit_step_stress", fail)
    response = client.post("/alt/step-stress/v2", json=payload())
    assert response.status_code == 422
    assert response.json()["detail"]["status"] == "fit_unavailable"
