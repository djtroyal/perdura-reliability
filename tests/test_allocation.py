"""Tests for reliability allocation (apportionment)."""

import math
import pytest
from reliability.Allocation import allocate, AllocationError


def test_equal_apportionment_hits_target():
    r = allocate([{"name": "A"}, {"name": "B"}, {"name": "C"}],
                 method="equal", target_reliability=0.9, mission_time=1.0)
    assert r["allocations"][0]["reliability"] == pytest.approx(0.9 ** (1 / 3))
    assert r["achieved_reliability"] == pytest.approx(0.9)


def test_arinc_proportional_to_failure_rate():
    r = allocate([{"name": "A", "failure_rate": 1.0}, {"name": "B", "failure_rate": 3.0}],
                 method="arinc", target_reliability=0.95, mission_time=10.0)
    la, lb = (a["failure_rate"] for a in r["allocations"])
    assert lb / la == pytest.approx(3.0, rel=1e-9)
    assert r["achieved_reliability"] == pytest.approx(0.95, rel=1e-9)


def test_mtbf_target_converted_via_mission_time():
    r = allocate([{"name": "A"}, {"name": "B"}], method="equal",
                 target_mtbf=10000, mission_time=1000)
    assert r["system_reliability"] == pytest.approx(math.exp(-1000 / 10000))


def test_agree_equal_importance_meets_target():
    # With importance = 1 for all, AGREE product equals the system target.
    r = allocate([{"name": "A", "complexity": 10}, {"name": "B", "complexity": 30}],
                 method="agree", target_reliability=0.9, mission_time=100.0)
    assert r["achieved_reliability"] == pytest.approx(0.9, rel=1e-6)


def test_feasibility_harder_subsystem_gets_more_failure_rate():
    r = allocate([{"name": "A", "difficulty": 2}, {"name": "B", "difficulty": 8}],
                 method="feasibility", target_reliability=0.9, mission_time=1.0)
    # Higher difficulty → larger allocated failure rate → lower reliability.
    assert r["allocations"][1]["reliability"] < r["allocations"][0]["reliability"]


def test_errors():
    with pytest.raises(AllocationError):
        allocate([], method="equal", target_reliability=0.9)
    with pytest.raises(AllocationError):
        allocate([{"name": "A"}], method="arinc", target_reliability=0.9)  # missing rate
    with pytest.raises(AllocationError):
        allocate([{"name": "A"}], method="equal")  # no target
    with pytest.raises(AllocationError):
        allocate([{"name": "A"}], method="bogus", target_reliability=0.9)
