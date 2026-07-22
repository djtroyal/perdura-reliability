"""Tests for the NDJSON fit-progress stream (/life-data/fit/stream), the
per-row fitting-method reporting, and the 3P probability-plot gamma shift."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

import numpy as np
from starlette.requests import Request

from routers.life_data import (
    calibrated_uncertainty_stream, fit_distributions,
    fit_distributions_stream, single_distribution_plot,
)
from schemas import LifeDataFitRequest, SingleDistPlotRequest, UncertaintyRequest


def _failures(n=25, seed=50):
    rng = np.random.default_rng(seed)
    return (100 * rng.weibull(2.0, n)).tolist()


def _request() -> Request:
    request = Request({
        "type": "http", "method": "POST", "path": "/api/v1/life-data/fit/stream",
        "headers": [], "query_string": b"", "scheme": "http",
        "server": ("test", 80), "client": ("127.0.0.1", 1),
    })
    request.state.request_id = "stream-contract"
    return request


def _stream_events(req: LifeDataFitRequest):
    import asyncio

    resp = fit_distributions_stream(req, _request())
    assert resp.media_type == "application/x-ndjson"
    assert resp.headers["x-accel-buffering"] == "no"

    async def collect():
        # StreamingResponse wraps even a sync generator into an async iterator.
        return [chunk async for chunk in resp.body_iterator]

    chunks = asyncio.run(collect())
    text = "".join(c.decode() if isinstance(c, bytes) else c for c in chunks)
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def test_stream_emits_start_progress_and_result():
    dists = ["Weibull_2P", "Normal_2P", "Lognormal_2P", "Gamma_2P"]
    events = _stream_events(LifeDataFitRequest(
        failures=_failures(), distributions_to_fit=dists))

    assert events[0] == {"type": "start", "total": len(dists)}
    progress = [e for e in events if e["type"] == "progress"]
    assert [p["done"] for p in progress] == list(range(1, len(dists) + 1))
    assert all(p["total"] == len(dists) for p in progress)
    assert sorted(p["current"] for p in progress) == sorted(dists)

    assert events[-1]["type"] == "result"
    payload = events[-1]["data"]
    plain = fit_distributions(LifeDataFitRequest(
        failures=_failures(), distributions_to_fit=dists))
    assert set(payload.keys()) == set(plain.keys())
    assert payload["best_distribution"] == plain["best_distribution"]


def test_stream_reports_validation_error_in_band():
    events = _stream_events(LifeDataFitRequest(failures=[10.0]))
    assert events[-1]["type"] == "error"
    assert events[-1]["status"] == 400
    assert "failure times" in events[-1]["error"]["message"]


def test_uncertainty_stream_reports_each_bootstrap_refit():
    import asyncio

    response = calibrated_uncertainty_stream(UncertaintyRequest(
        distribution="Weibull_2P",
        failures=_failures(),
        target="reliability",
        target_value=100.0,
        method="parametric_bootstrap",
        n_bootstrap=20,
        seed=17,
    ), _request())

    async def collect():
        return [chunk async for chunk in response.body_iterator]

    chunks = asyncio.run(collect())
    stream = "".join(chunk.decode() if isinstance(chunk, bytes) else chunk for chunk in chunks)
    events = [json.loads(line) for line in stream.splitlines() if line.strip()]
    assert events[0] == {"type": "start", "total": 20}
    progress = [event for event in events if event["type"] == "progress"]
    assert [event["done"] for event in progress] == list(range(21))
    assert all(event["total"] == 20 for event in progress)
    assert events[-1]["type"] == "result"
    assert events[-1]["data"]["interval"]["n_requested"] == 20
    assert len(events[-1]["result_sha256"]) == 64


def test_fit_results_carry_actual_method():
    out = fit_distributions(LifeDataFitRequest(
        failures=_failures(), method="RRX",
        distributions_to_fit=["Weibull_2P", "Gamma_2P", "Gumbel_2P"]))
    methods = {r["Distribution"]: r["method"] for r in out["results"]}
    assert methods["Weibull_2P"] == "RRX"
    assert methods["Gumbel_2P"] == "RRX"
    assert methods["Gamma_2P"] == "MLE"  # no linearizing paper -> MLE fallback


def test_plot_response_carries_method():
    out = single_distribution_plot(SingleDistPlotRequest(
        failures=_failures(), distribution="Weibull_2P", method="RRY"))
    assert out["method"] == "RRY"


def test_3p_probability_plot_shifts_by_gamma():
    from scipy import stats as ss
    rng = np.random.default_rng(8)
    failures = (500 + 100 * rng.weibull(2.0, 120)).tolist()
    out = single_distribution_plot(SingleDistPlotRequest(
        failures=failures, distribution="Weibull_3P"))
    prob = out["plot"]["probability"]
    assert prob["x_label"] == "ln(t-γ)"
    # line_x is the transform of (line_x_raw - gamma); line_x_raw stays REAL
    # time so suspension-marker interpolation in the frontend keeps working.
    raw = np.asarray(prob["line_x_raw"])
    line_x = np.asarray(prob["line_x"])
    # gamma is not in the payload; recover it from the first line point
    g = float(raw[0] - np.exp(line_x[0]))
    np.testing.assert_allclose(line_x, np.log(raw - g), rtol=1e-6)
    assert g > 0
    # Scatter is near-linear on the shifted paper
    r = ss.linregress(prob["scatter_x"], prob["scatter_y"]).rvalue
    assert r ** 2 > 0.95


def test_2p_probability_plot_keeps_plain_axis():
    out = single_distribution_plot(SingleDistPlotRequest(
        failures=_failures(), distribution="Weibull_2P"))
    prob = out["plot"]["probability"]
    assert prob["x_label"] == "ln(t)"
    np.testing.assert_allclose(prob["line_x"], np.log(prob["line_x_raw"]), rtol=1e-12)


def test_gumbel_plot_uses_min_ev_paper():
    from scipy import stats as ss
    rng = np.random.default_rng(3)
    failures = ss.gumbel_l.rvs(loc=100, scale=10, size=100, random_state=rng).tolist()
    out = single_distribution_plot(SingleDistPlotRequest(
        failures=failures, distribution="Gumbel_2P"))
    prob = out["plot"]["probability"]
    assert prob["y_label"] == "ln(-ln(1-F))"
    r = ss.linregress(prob["scatter_x"], prob["scatter_y"]).rvalue
    assert r ** 2 > 0.95
