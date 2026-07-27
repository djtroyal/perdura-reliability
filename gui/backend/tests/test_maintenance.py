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


def test_replacement_policy_returns_run_to_failure_for_beta_below_one():
    r = M.replacement_policy(M.ReplacementPolicyRequest(
        cost_PM=1, cost_CM=5, weibull_alpha=100, weibull_beta=0.7))
    assert r["cheaper_policy"] == "corrective"
    assert r["age"]["optimal_time"] is None
    assert r["block"]["optimal_time"] is None
    assert r["age"]["decision"] == "run_to_failure"
    assert r["age"]["min_cost"] == pytest.approx(r["corrective_only_cost"])


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


def test_virtual_age_endpoint_surfaces_model_and_intervals():
    result = M.virtual_age_simulation(M.VirtualAgeSimulationRequest(
        weibull_alpha=200, weibull_beta=2.0, horizon=800,
        preventive_interval=150, repair_effectiveness=0.5,
        preventive_effectiveness=0.1, cost_CM=100, cost_PM=20,
        corrective_downtime=3, preventive_downtime=1,
        n_simulations=300, seed=11,
    ))
    assert result["model"] == "kijima_type_ii_virtual_age"
    assert result["analysis_basis"] == "finite_horizon_monte_carlo"
    assert result["total_cost"]["lower"] <= result["total_cost"]["upper"]
    assert 0 <= result["availability"]["mean"] <= 1


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


# --- Maintenance Task Analysis ---

def _mta_payload(*, simulations=1):
    return {
        "personnel": [{
            "id": "technician",
            "name": "Maintenance technician",
            "available_headcount": 1,
            "hourly_rate": 100,
        }],
        "resources": [{
            "id": "test-set",
            "name": "Portable test set",
            "kind": "test_equipment",
            "capacity": 1,
            "use_cost_per_hour": 10,
        }, {
            "id": "pump-kit",
            "name": "Pump replacement kit",
            "kind": "spare",
            "capacity": 0,
            "unit_cost": 500,
        }],
        "tasks": [{
            "id": "MTA-001",
            "title": "Replace failed coolant pump",
            "task_type": "corrective",
            "maintenance_level": "field",
            "status": "approved",
            "criticality": "mission",
            "frequency": {
                "model": "manual_per_period",
                "occurrences_per_period": 1,
                "period_hours": 24,
            },
            "takes_asset_out_of_service": True,
            "affected_asset_count": 1,
            "downtime_cost_per_hour": 50,
            "steps": [{
                "id": "S1",
                "label": "Isolate equipment",
                "phase": "isolate",
                "duration": {"mode": "fixed", "fixed_hours": 1},
                "personnel": [{
                    "role_id": "technician",
                    "headcount": 1,
                    "engagement_fraction": 1,
                }],
            }, {
                "id": "S2",
                "label": "Replace pump",
                "phase": "replace",
                "predecessor_step_ids": ["S1"],
                "duration": {"mode": "fixed", "fixed_hours": 2},
                "personnel": [{
                    "role_id": "technician",
                    "headcount": 1,
                    "engagement_fraction": 1,
                }],
                "resources": [{
                    "resource_id": "pump-kit",
                    "quantity": 1,
                }],
            }, {
                "id": "S3",
                "label": "Verify operation",
                "phase": "test",
                "predecessor_step_ids": ["S2"],
                "duration": {"mode": "fixed", "fixed_hours": 1},
                "personnel": [{
                    "role_id": "technician",
                    "headcount": 1,
                    "engagement_fraction": 1,
                }],
                "resources": [{
                    "resource_id": "test-set",
                    "quantity": 1,
                }],
            }],
        }],
        "portfolio": {
            "horizon_hours": 24,
            "slot_hours": 0.25,
            "simulation_enabled": simulations > 1,
            "n_simulations": simulations,
            "confidence": 0.95,
            "seed": 42,
            "asset_population": 1,
        },
    }


def test_mta_rolls_up_precedence_labour_cost_and_downtime():
    result = M.maintenance_task_analysis(
        M.MTAAnalysisRequest(**_mta_payload()))
    task = result["task_results"][0]
    assert task["elapsed_hours"] == pytest.approx(4)
    assert task["labour_hours"] == pytest.approx(4)
    assert task["cost_per_event"]["labour"] == pytest.approx(400)
    assert task["cost_per_event"]["materials"] == pytest.approx(500)
    assert task["cost_per_event"]["resource_use"] == pytest.approx(10)
    assert task["cost_per_event"]["downtime"] == pytest.approx(200)
    assert task["cost_per_event"]["total"] == pytest.approx(1110)
    portfolio = result["portfolio"]
    assert portfolio["jobs_generated"]["mean"] == pytest.approx(1)
    assert portfolio["jobs_completed"]["mean"] == pytest.approx(1)
    assert portfolio["total_downtime_hours"]["mean"] == pytest.approx(4)
    assert portfolio["availability"]["mean"] == pytest.approx(20 / 24)
    breakdown = portfolio["cost_breakdown"]
    assert breakdown["labour"]["mean"] == pytest.approx(400)
    assert breakdown["materials"]["mean"] == pytest.approx(500)
    assert breakdown["resource_use"]["mean"] == pytest.approx(10)
    assert breakdown["fixed"]["mean"] == pytest.approx(0)
    assert breakdown["travel"]["mean"] == pytest.approx(0)
    assert breakdown["downtime"]["mean"] == pytest.approx(200)
    assert sum(component["mean"] for component in breakdown.values()) \
        == pytest.approx(portfolio["total_cost"]["mean"])
    assert len(result["input_sha256"]) == 64
    assert len(result["result_sha256"]) == 64


def test_mta_parallel_steps_use_critical_path_elapsed_time():
    payload = _mta_payload()
    steps = payload["tasks"][0]["steps"]
    steps[2]["predecessor_step_ids"] = ["S1"]
    result = M.maintenance_task_analysis(M.MTAAnalysisRequest(**payload))
    assert result["task_results"][0]["elapsed_hours"] == pytest.approx(3)
    assert result["task_results"][0]["labour_hours"] == pytest.approx(4)


def test_mta_rejects_dependency_cycles_with_actionable_message():
    payload = _mta_payload()
    payload["tasks"][0]["steps"][0]["predecessor_step_ids"] = ["S3"]
    with pytest.raises(HTTPException) as exc:
        M.maintenance_task_analysis(M.MTAAnalysisRequest(**payload))
    assert exc.value.status_code == 400
    assert "dependency cycle" in exc.value.detail["message"]


def test_mta_seeded_pert_simulation_is_reproducible():
    payload = _mta_payload(simulations=30)
    payload["tasks"][0]["steps"][1]["duration"] = {
        "mode": "uncertain",
        "distribution": "pert",
        "optimistic_hours": 1,
        "most_likely_hours": 2,
        "pessimistic_hours": 5,
    }
    request = M.MTAAnalysisRequest(**payload)
    first = M.maintenance_task_analysis(request)
    second = M.maintenance_task_analysis(request)
    assert first["result_sha256"] == second["result_sha256"]
    interval = first["portfolio"]["total_downtime_hours"]
    assert interval["lower"] < interval["upper"]


def test_mta_resource_contention_creates_sequential_completion():
    payload = _mta_payload()
    payload["tasks"].append({
        **payload["tasks"][0],
        "id": "MTA-002",
        "title": "Replace second pump",
    })
    result = M.maintenance_task_analysis(M.MTAAnalysisRequest(**payload))
    timeline = result["portfolio"]["representative_timeline"]
    replacements = [
        row for row in timeline if row["step_id"] == "S2"
    ]
    assert len(replacements) == 2
    first, second = sorted(replacements, key=lambda row: row["start"])
    assert first["finish"] <= second["start"]


def test_mta_inactive_conditional_step_consumes_no_time_or_capacity():
    payload = _mta_payload()
    payload["tasks"][0]["steps"].insert(1, {
        "id": "SKIP",
        "label": "Conditional investigation",
        "phase": "diagnose",
        "predecessor_step_ids": ["S1"],
        "duration": {"mode": "fixed", "fixed_hours": 10},
        "execution_probability": 0,
        "interruptible": True,
        "personnel": [{
            "role_id": "technician",
            "headcount": 1,
            "engagement_fraction": 1,
        }],
    })
    payload["tasks"][0]["steps"][2]["predecessor_step_ids"] = ["SKIP"]
    result = M.maintenance_task_analysis(M.MTAAnalysisRequest(**payload))
    assert result["portfolio"]["total_downtime_hours"]["mean"] == pytest.approx(4)
    skipped = next(row for row in result["portfolio"]["representative_timeline"]
                   if row["step_id"] == "SKIP")
    assert skipped["start"] == skipped["finish"]


def test_mta_calendar_interval_defaults_first_due_to_one_interval():
    payload = _mta_payload()
    payload["tasks"][0]["frequency"] = {
        "model": "calendar_interval",
        "interval": 12,
        "interval_unit": "hours",
    }
    result = M.maintenance_task_analysis(M.MTAAnalysisRequest(**payload))
    assert result["portfolio"]["jobs_generated"]["mean"] == pytest.approx(1)
    first = result["portfolio"]["representative_timeline"][0]
    assert first["start"] == pytest.approx(12)


def test_mta_overtime_uses_off_shift_capacity_and_rate_multiplier():
    payload = _mta_payload()
    payload["personnel"][0].update({
        "weekly_shifts": [{
            "weekday": 0, "start_hour": 8, "end_hour": 16, "capacity": 1,
        }],
        "overtime_capacity": 1,
        "overtime_rate_multiplier": 1.5,
    })
    regular = M.maintenance_task_analysis(M.MTAAnalysisRequest(**payload))
    assert regular["portfolio"]["representative_timeline"][0]["start"] == 8

    payload["portfolio"]["allow_overtime"] = True
    overtime = M.maintenance_task_analysis(M.MTAAnalysisRequest(**payload))
    assert overtime["portfolio"]["representative_timeline"][0]["start"] == 0
    task_metrics = overtime["task_results"][0]["portfolio"]
    assert task_metrics["overtime_labor_hours"]["mean"] == pytest.approx(4)
    assert overtime["portfolio"]["overtime_labor_hours"]["mean"] == pytest.approx(4)
    assert overtime["portfolio"]["total_cost"]["mean"] == pytest.approx(1310)


def test_mta_always_available_pool_honours_planned_outage():
    payload = _mta_payload()
    payload["personnel"][0]["planned_outages"] = [{
        "start_hour": 0,
        "end_hour": 2,
        "capacity": 0,
        "note": "training",
    }]
    payload["tasks"][0]["frequency"] = {
        "model": "event_list",
        "event_times_hours": [0],
    }
    payload["portfolio"].update({
        "horizon_hours": 8,
        "slot_hours": 1,
    })

    result = M.maintenance_task_analysis(M.MTAAnalysisRequest(**payload))

    timeline = result["portfolio"]["representative_timeline"]
    assert timeline[0]["start"] == pytest.approx(2)


def test_mta_aggregates_duplicate_pool_assignments_for_capacity():
    payload = _mta_payload()
    payload["tasks"][0]["frequency"] = {
        "model": "event_list",
        "event_times_hours": [0],
    }
    payload["tasks"][0]["steps"] = [{
        "id": "S1",
        "label": "Two-person lift",
        "phase": "remove",
        "duration": {"mode": "fixed", "fixed_hours": 1},
        "personnel": [
            {
                "role_id": "technician",
                "headcount": 1,
                "engagement_fraction": 1,
            },
            {
                "role_id": "technician",
                "headcount": 1,
                "engagement_fraction": 1,
            },
        ],
    }]
    payload["portfolio"].update({
        "horizon_hours": 4,
        "slot_hours": 1,
    })

    result = M.maintenance_task_analysis(M.MTAAnalysisRequest(**payload))

    assert result["portfolio"]["jobs_completed"]["mean"] == pytest.approx(0)
    assert result["portfolio"]["backlog_jobs"]["mean"] == pytest.approx(1)


def test_mta_prediction_link_normalizes_fpmh_snapshot_and_calendar_basis():
    payload = _mta_payload()
    payload["tasks"][0]["frequency"] = {
        "model": "poisson_rate",
        "rate_per_hour": 999,
        "population": 500,
        "duty_cycle": 0.2,
        "prediction_source": {
            "analysis_id": "prediction-1",
            "analysis_name": "Pump prediction",
            "entity_type": "part",
            "entity_id": "part:pump-1",
            "label": "P1 — coolant pump",
            "rate_fpmh": 25,
            "rate_basis": "service_calendar",
            "represented_quantity": 2,
            "standard": "MIL-HDBK-217F",
            "linked_at": "2026-07-26T12:00:00Z",
        },
    }

    request = M.MTAAnalysisRequest(**payload)

    frequency = request.tasks[0].frequency
    assert frequency.rate_per_hour == pytest.approx(25e-6)
    assert frequency.population == 1
    assert frequency.duty_cycle == pytest.approx(1)
    result = M.maintenance_task_analysis(request)
    source = result["source_traceability"][0]["prediction_rate_source"]
    assert source["entity_id"] == "part:pump-1"
    assert source["rate_fpmh"] == pytest.approx(25)


def test_mta_prediction_link_preserves_explicit_rate_override():
    payload = _mta_payload()
    payload["tasks"][0]["frequency"] = {
        "model": "poisson_rate",
        "rate_per_hour": 40e-6,
        "population": 1,
        "duty_cycle": 0.5,
        "prediction_rate_override_enabled": True,
        "prediction_source": {
            "analysis_id": "prediction-1",
            "entity_type": "block",
            "entity_id": "block:cooling",
            "label": "Cooling assembly",
            "rate_fpmh": 25,
            "rate_basis": "operating",
        },
    }

    request = M.MTAAnalysisRequest(**payload)

    frequency = request.tasks[0].frequency
    assert frequency.rate_per_hour == pytest.approx(40e-6)
    assert frequency.population == 1
    assert frequency.duty_cycle == pytest.approx(0.5)


def test_mta_prediction_link_requires_poisson_frequency_model():
    payload = _mta_payload()
    payload["tasks"][0]["frequency"]["prediction_source"] = {
        "analysis_id": "prediction-1",
        "entity_type": "part",
        "entity_id": "part:pump-1",
        "label": "P1 — coolant pump",
        "rate_fpmh": 25,
    }
    with pytest.raises(ValueError, match="poisson_rate"):
        M.MTAAnalysisRequest(**payload)


def test_mta_vocabulary_exposes_controlled_language_and_governance():
    vocabulary = M.maintenance_task_analysis_vocabulary()
    assert "replace" in vocabulary["action_verbs"]
    assert "demonstrated" in vocabulary["governance_statuses"]
    assert "training" in vocabulary["task_types"]
