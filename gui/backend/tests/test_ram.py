"""Tests for the RAM router (availability / maintainability / spares)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi import HTTPException

from routers import ram


# --- Availability ---

def test_inherent_availability():
    r = ram.availability(ram.AvailabilityRequest(mtbf=100, mttr=5))
    assert r["inherent"] == pytest.approx(100 / 105)


def test_operational_includes_delays():
    r = ram.availability(ram.AvailabilityRequest(mtbf=100, mttr=5, admin_delay=2, logistics_delay=10))
    assert r["mean_down_time"] == pytest.approx(17.0)
    assert r["operational"] == pytest.approx(100 / 117)
    # Operational availability is lower than inherent once delays are added.
    assert r["operational"] < r["inherent"]


def test_availability_requires_inputs():
    with pytest.raises(HTTPException) as exc:
        ram.availability(ram.AvailabilityRequest(admin_delay=2))
    assert exc.value.status_code == 400


# --- Maintainability ---

def test_maintainability_lognormal():
    r = ram.maintainability(ram.MaintainabilityRequest(mode="lognormal", mu=1.5, sigma=0.6, percentile=0.95))
    assert r["mmax"] > r["mct"] > 0
    assert len(r["curve"]["time"]) == len(r["curve"]["sf"]) > 0


def test_maintainability_data_fit():
    r = ram.maintainability(ram.MaintainabilityRequest(
        mode="data", samples=[2, 3, 2.5, 4, 3.2, 2.8, 5, 3.5], percentile=0.9))
    assert r["fitted"] is not None
    assert r["mmax"] > r["mct"] > 0


def test_maintainability_data_needs_samples():
    with pytest.raises(HTTPException) as exc:
        ram.maintainability(ram.MaintainabilityRequest(mode="data", samples=[1.0]))
    assert exc.value.status_code == 400


# --- Spares ---

def test_spares_required_rises_with_demand():
    lo = ram.spares(ram.SparesRequest(quantity=5, op_hours=8760, mtbf=50000, confidence=0.95))
    hi = ram.spares(ram.SparesRequest(quantity=20, op_hours=8760, mtbf=50000, confidence=0.95))
    assert hi["expected_demand"] > lo["expected_demand"]
    assert hi["required_spares"] >= lo["required_spares"]
    assert hi["achieved_protection"] >= 0.95


def test_spares_needs_rate_or_mtbf():
    with pytest.raises(HTTPException) as exc:
        ram.spares(ram.SparesRequest(quantity=5, op_hours=8760, confidence=0.95))
    assert exc.value.status_code == 400


def test_negative_binomial_exposes_overdispersion():
    poisson_result = ram.spares(ram.SparesRequest(
        quantity=20, op_hours=8760, mtbf=20000, confidence=0.95,
        model="poisson"))
    overdispersed = ram.spares(ram.SparesRequest(
        quantity=20, op_hours=8760, mtbf=20000, confidence=0.95,
        model="negative_binomial", dispersion=2.0))

    assert overdispersed["demand_variance"] > overdispersed["expected_demand"]
    assert overdispersed["required_spares"] > poisson_result["required_spares"]
    assert overdispersed["model"] == "negative_binomial_overdispersed_demand"


def test_renewal_pipeline_returns_reduce_peak_stock_requirement():
    common = dict(
        quantity=10, op_hours=5000, mtbf=1000, confidence=0.95,
        model="renewal_pipeline", n_simulations=1000, seed=9,
        replenishment_lead_time_std=0,
    )
    short = ram.spares(ram.SparesRequest(
        replenishment_lead_time_mean=100, **common))
    no_return_during_horizon = ram.spares(ram.SparesRequest(
        replenishment_lead_time_mean=5000, **common))

    assert short["required_spares"] < no_return_during_horizon["required_spares"]
    assert short["analysis_basis"] == "finite_horizon_monte_carlo"
    assert short["required_spares_interval"]["lower"] <= short["required_spares_interval"]["upper"]
    assert len(short["curve"]["protection_lower"]) == len(short["curve"]["stock_level"])


def test_renewal_pipeline_supports_weibull_and_compound_shocks():
    result = ram.spares(ram.SparesRequest(
        quantity=5, op_hours=2000, mtbf=1000, confidence=0.9,
        model="renewal_pipeline", weibull_alpha=900, weibull_beta=2.0,
        replenishment_lead_time_mean=300, replenishment_lead_time_std=50,
        common_shock_rate=0.001, common_shock_size=3,
        n_simulations=500, seed=3,
    ))
    assert result["failure_process"] == "weibull_renewal"
    assert result["pipeline"]["common_shock_size"] == 3
    assert result["demand_variance"] > 0
