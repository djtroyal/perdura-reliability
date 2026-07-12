"""Public API tests for fail-closed FTA/RBD probability inputs."""

import math
import sys
from pathlib import Path

import pytest


BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from pydantic import ValidationError  # noqa: E402
from routers.fault_tree import analyze_fault_tree  # noqa: E402
from routers.system_reliability import compute_rbd  # noqa: E402
from schemas import FaultTreeRequest, RBDRequest  # noqa: E402


def _post(path, payload):
    """Exercise each public router handler with its declared request model."""
    schema, endpoint = {
        "/api/system/rbd": (RBDRequest, compute_rbd),
        "/api/fault-tree/analyze": (FaultTreeRequest, analyze_fault_tree),
    }[path]
    try:
        request = schema.model_validate(payload)
    except ValidationError as exc:
        return 422, {"detail": exc.errors(include_url=False)}
    return 200, endpoint(request)


def _rbd_payload(data):
    return {
        "nodes": [
            {"id": "source", "type": "source", "data": {"label": "Source"}},
            {"id": "c", "type": "component", "data": data},
            {"id": "sink", "type": "sink", "data": {"label": "Sink"}},
        ],
        "edges": [
            {"source": "source", "target": "c"},
            {"source": "c", "target": "sink"},
        ],
    }


def _fault_tree_payload(data, exposure_time=None):
    return {
        "nodes": [{"id": "event", "type": "basic", "data": data}],
        "edges": [],
        "exposure_time": exposure_time,
    }


@pytest.mark.parametrize(
    ("distribution", "params", "time", "expected_reliability"),
    [
        ("exponential", {"lambda": 0.1}, 2.0, math.exp(-0.2)),
        ("weibull", {"alpha": 10.0, "beta": 2.0}, 2.0, math.exp(-0.04)),
        ("normal", {"mu": 2.0, "sigma": 1.0}, 2.0, 0.5),
        ("lognormal", {"mu": 0.0, "sigma": 1.0}, 1.0, 0.5),
        ("gamma", {"alpha": 2.0, "beta": 1.0}, 2.0, 3.0 * math.exp(-2.0)),
        ("loglogistic", {"alpha": 2.0, "beta": 2.0}, 2.0, 0.5),
        ("gumbel", {"mu": 2.0, "sigma": 1.0}, 2.0, math.exp(-1.0)),
        ("beta", {"alpha": 2.0, "beta": 2.0}, 0.5, 0.5),
    ],
)
def test_rbd_public_router_evaluates_every_supported_typed_distribution(
    distribution, params, time, expected_reliability,
):
    status, result = _post(
        "/api/system/rbd",
        _rbd_payload({
            "distribution": distribution,
            "dist_params": params,
            "mission_time": time,
            # A stored display value must not override the typed model.
            "reliability": 0.123,
        }),
    )
    assert status == 200, result
    assert result["system_reliability"] == pytest.approx(
        expected_reliability, abs=5e-7)


@pytest.mark.parametrize(
    "data",
    [
        {},
        {"reliability": "not-a-number"},
        {"reliability": 1.1},
        {"reliability": "NaN"},
        {"distribution": "unknown", "dist_params": {}, "mission_time": 10},
        {"distribution": "weibull", "mission_time": 10},
        {"distribution": "weibull", "dist_params": {"alpha": 100},
         "mission_time": 10},
        {"distribution": "weibull",
         "dist_params": {"alpha": -100, "beta": 2},
         "mission_time": 10, "reliability": 0.9},
        {"distribution": "normal",
         "dist_params": {"mu": 100, "sigma": 0},
         "mission_time": 10},
        {"distribution": "exponential",
         "dist_params": {"lambda": 0.1}, "mission_time": -1},
    ],
)
def test_rbd_public_router_rejects_invalid_models_without_default_substitution(data):
    status, result = _post("/api/system/rbd", _rbd_payload(data))
    assert status == 422
    assert "system_reliability" not in result


def test_fault_tree_public_router_uses_typed_distribution_and_global_time():
    status, result = _post(
        "/api/fault-tree/analyze",
        _fault_tree_payload(
            {"distribution": "exponential", "dist_params": {"lambda": 0.1},
             "probability": 0.987},
            exposure_time=2.0,
        ),
    )
    assert status == 200, result
    assert result["top_event_probability"] == pytest.approx(
        1.0 - math.exp(-0.2))


@pytest.mark.parametrize(
    ("data", "global_time"),
    [
        ({}, None),
        ({"probability": "not-a-number"}, None),
        ({"probability": -0.01}, None),
        ({"probability": "Infinity"}, None),
        ({"distribution": "unknown", "dist_params": {}}, 10),
        ({"distribution": "exponential", "dist_params": {"lambda": 0.1}}, None),
        ({"distribution": "exponential", "dist_params": {"lambda": 0}}, 10),
        ({"distribution": "normal",
          "dist_params": {"mu": 10, "sigma": -1}, "probability": 0.01}, 10),
    ],
)
def test_fault_tree_public_router_rejects_invalid_models_without_defaults(
    data, global_time,
):
    status, result = _post(
        "/api/fault-tree/analyze",
        _fault_tree_payload(data, global_time),
    )
    assert status == 422
    assert "top_event_probability" not in result
