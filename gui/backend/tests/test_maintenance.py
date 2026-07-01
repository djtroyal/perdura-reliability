"""Tests for the Maintenance router (replacement policy / PM interval /
cost forecast / availability sensitivity)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import math

import pytest
from fastapi import HTTPException

from routers import maintenance as M


# --- Replacement policy (age vs block) ---

def test_replacement_policy_compares_age_and_block():
    r = M.replacement_policy(M.ReplacementPolicyRequest(
        cost_PM=1, cost_CM=5, weibull_alpha=1000, weibull_beta=2.5))
    for pol in ("age", "block"):
        assert 0 < r[pol]["optimal_time"] < 3000
        assert r[pol]["min_cost"] > 0
    # Preventive policies beat run-to-failure for a wear-out item.
    assert r["age"]["min_cost"] < r["corrective_only_cost"]
    assert r["block"]["min_cost"] < r["corrective_only_cost"]
    assert r["cheaper_policy"] in ("age", "block")


def test_replacement_policy_rejects_pm_ge_cm():
    with pytest.raises(HTTPException) as exc:
        M.replacement_policy(M.ReplacementPolicyRequest(
            cost_PM=5, cost_CM=5, weibull_alpha=1000, weibull_beta=2))
    assert exc.value.status_code == 400


# --- PM interval / MFOP ---

def test_pm_interval_hits_target_reliability():
    r = M.pm_interval(M.PMIntervalRequest(
        dist="weibull", dist_params={"alpha": 1000, "beta": 2.5},
        target_reliability=0.9, horizon=5000))
    tau = r["pm_interval"]
    assert tau > 0
    # At the interval, reliability should equal the target (sawtooth low point).
    assert r["curve"]["reliability_pm"][0] == pytest.approx(1.0, abs=1e-6)
    assert r["n_pm"] == math.floor(5000 / tau)
    # The un-maintained curve must sit at or below the PM sawtooth everywhere.
    lo = min(r["curve"]["reliability_none"])
    assert lo <= min(r["curve"]["reliability_pm"]) + 1e-9


def test_pm_interval_exponential_source():
    r = M.pm_interval(M.PMIntervalRequest(
        dist="exponential", dist_params={"lambda": 0.001},
        target_reliability=0.95, horizon=2000))
    assert r["pm_interval"] > 0


def test_pm_interval_missing_param():
    with pytest.raises(HTTPException) as exc:
        M.pm_interval(M.PMIntervalRequest(
            dist="weibull", dist_params={"alpha": 1000},   # no beta
            target_reliability=0.9, horizon=1000))
    assert exc.value.status_code == 400


# --- Cost forecast ---

def test_cost_forecast_reconciles():
    r = M.cost_forecast(M.CostForecastRequest(
        policy="block", cost_PM=1, cost_CM=5,
        weibull_alpha=1000, weibull_beta=2.5, horizon=10000))
    assert r["total_cost"] == pytest.approx(r["cost_rate"] * 10000)
    assert r["cumulative_cost"][-1] == pytest.approx(r["total_cost"])


def test_cost_forecast_age_beats_corrective():
    age = M.cost_forecast(M.CostForecastRequest(
        policy="age", cost_PM=1, cost_CM=5,
        weibull_alpha=1000, weibull_beta=2.5, horizon=10000))
    corr = M.cost_forecast(M.CostForecastRequest(
        policy="corrective", cost_PM=1, cost_CM=5,
        weibull_alpha=1000, weibull_beta=2.5, horizon=10000))
    assert age["total_cost"] < corr["total_cost"]
    assert corr["expected_pm"] == 0


# --- Availability sensitivity ---

def test_availability_sensitivity_tornado_and_solve():
    r = M.availability_sensitivity(M.AvailabilitySensitivityRequest(
        mtbf=100, mttr=5, admin_delay=2, logistics_delay=10,
        swing_pct=20, target_availability=0.95))
    assert 0 < r["baseline_availability"] < 1
    # Every non-zero driver appears in the tornado, sorted by impact.
    assert len(r["tornado"]) == 4
    assert r["tornado"][0]["range"] >= r["tornado"][-1]["range"]
    # Solve-for-target inverts Ao = MTBF/(MTBF+MDT).
    solve = r["solve"]
    assert solve["max_down_time"] == pytest.approx(100 * (1 - 0.95) / 0.95)
    assert solve["required_mttr"] == pytest.approx(solve["max_down_time"] - 2 - 10)


def test_availability_sensitivity_target_unachievable():
    # A very high target with large fixed delays => required MTTR goes negative.
    r = M.availability_sensitivity(M.AvailabilitySensitivityRequest(
        mtbf=100, mttr=5, admin_delay=3, logistics_delay=3,
        target_availability=0.999))
    assert r["solve"]["achievable"] is False
