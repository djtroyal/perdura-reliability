"""Tests for the Reliability Allocation router."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi import HTTPException

from routers import allocation


def _req(**kw):
    return allocation.AllocationRequest(**kw)


def test_equal_hits_target_exactly():
    r = allocation.allocate_endpoint(_req(
        method="equal", target_reliability=0.9, mission_time=1.0,
        subsystems=[{"name": "A"}, {"name": "B"}, {"name": "C"}]))
    assert r["allocations"][0]["reliability"] == pytest.approx(0.9 ** (1 / 3))
    assert r["achieved_reliability"] == pytest.approx(0.9)


def test_arinc_splits_proportional_to_rate():
    r = allocation.allocate_endpoint(_req(
        method="arinc", target_reliability=0.95, mission_time=10,
        subsystems=[{"name": "A", "failure_rate": 1}, {"name": "B", "failure_rate": 3}]))
    la = r["allocations"][0]["failure_rate"]
    lb = r["allocations"][1]["failure_rate"]
    assert lb / la == pytest.approx(3.0, rel=1e-6)
    assert r["achieved_reliability"] == pytest.approx(0.95, rel=1e-6)


def test_mtbf_target_runs():
    r = allocation.allocate_endpoint(_req(
        method="equal", target_mtbf=10000, mission_time=1000,
        subsystems=[{"name": "A"}, {"name": "B"}]))
    assert 0 < r["system_reliability"] < 1


def test_arinc_missing_rate_is_400():
    with pytest.raises(HTTPException) as exc:
        allocation.allocate_endpoint(_req(
            method="arinc", target_reliability=0.9, mission_time=1,
            subsystems=[{"name": "A"}]))
    assert exc.value.status_code == 400
