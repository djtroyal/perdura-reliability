"""Maintenance Task Analysis and transparent resource-constrained scheduling.

The implementation is deliberately standards-informed rather than a claim of
conformance with a proprietary logistics-product-data exchange schema.  It
implements the engineering calculations needed by a task analysis:

* precedence-aware elapsed time and labour-hour rollups;
* fixed, triangular, and beta-PERT step-duration uncertainty;
* deterministic and stochastic task occurrence generation;
* resource-calendar constrained list scheduling; and
* task, resource, cost, downtime, and validation summaries.

All public inputs and outputs are plain mappings so the calculation layer can
be used by the FastAPI service, tests, notebooks, and future import adapters.
"""

from __future__ import annotations

from collections import defaultdict
import hashlib
import heapq
import json
import math
from typing import Any, Callable, Iterable, Mapping

import numpy as np


MTA_METHOD_VERSION = "1.0"
_EPS = 1e-12


class MaintenanceTaskAnalysisError(ValueError):
    """Raised when an MTA model is internally inconsistent."""


def _canonical_hash(value: Any) -> str:
    payload = json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _quantiles(values: Iterable[float], confidence: float) -> dict[str, float]:
    array = np.asarray(list(values), dtype=float)
    if array.size == 0:
        return {"mean": 0.0, "lower": 0.0, "upper": 0.0}
    alpha = (1.0 - confidence) / 2.0
    return {
        "mean": float(np.mean(array)),
        "lower": float(np.quantile(array, alpha)),
        "upper": float(np.quantile(array, 1.0 - alpha)),
    }


def _topological_steps(task: Mapping[str, Any]) -> list[str]:
    steps = list(task.get("steps") or ())
    task_id = str(task.get("id", "task"))
    ids = [str(step.get("id", "")) for step in steps]
    if any(not value for value in ids):
        raise MaintenanceTaskAnalysisError(
            f"Task '{task_id}' contains a step without an ID.")
    if len(ids) != len(set(ids)):
        raise MaintenanceTaskAnalysisError(
            f"Task '{task_id}' contains duplicate step IDs.")
    known = set(ids)
    indegree = {step_id: 0 for step_id in ids}
    successors: dict[str, list[str]] = {step_id: [] for step_id in ids}
    for step in steps:
        step_id = str(step["id"])
        for predecessor in step.get("predecessor_step_ids") or ():
            predecessor = str(predecessor)
            if predecessor == step_id:
                raise MaintenanceTaskAnalysisError(
                    f"Step '{step_id}' cannot depend on itself.")
            if predecessor not in known:
                raise MaintenanceTaskAnalysisError(
                    f"Step '{step_id}' references missing predecessor "
                    f"'{predecessor}'.")
            indegree[step_id] += 1
            successors[predecessor].append(step_id)
    ready = sorted(step_id for step_id, degree in indegree.items() if degree == 0)
    ordered: list[str] = []
    while ready:
        current = ready.pop(0)
        ordered.append(current)
        for successor in sorted(successors[current]):
            indegree[successor] -= 1
            if indegree[successor] == 0:
                ready.append(successor)
                ready.sort()
    if len(ordered) != len(ids):
        cyclic = sorted(step_id for step_id, degree in indegree.items() if degree)
        raise MaintenanceTaskAnalysisError(
            f"Task '{task_id}' contains a dependency cycle involving "
            f"{', '.join(cyclic)}.")
    return ordered


def _duration_values(step: Mapping[str, Any]) -> tuple[str, float, float, float]:
    estimate = step.get("duration") or {}
    mode = str(estimate.get("mode", "fixed")).lower()
    if mode == "fixed":
        fixed = float(estimate.get("fixed_hours", 0.0) or 0.0)
        if not math.isfinite(fixed) or fixed < 0:
            raise MaintenanceTaskAnalysisError(
                f"Step '{step.get('id')}' has an invalid fixed duration.")
        return mode, fixed, fixed, fixed
    optimistic = float(estimate.get("optimistic_hours", 0.0) or 0.0)
    likely = float(estimate.get("most_likely_hours", optimistic) or 0.0)
    pessimistic = float(estimate.get("pessimistic_hours", likely) or 0.0)
    if (not all(math.isfinite(v) for v in (optimistic, likely, pessimistic))
            or optimistic < 0 or not optimistic <= likely <= pessimistic):
        raise MaintenanceTaskAnalysisError(
            f"Step '{step.get('id')}' requires 0 <= optimistic <= "
            "most likely <= pessimistic duration.")
    distribution = str(estimate.get("distribution", "pert")).lower()
    if distribution not in {"pert", "triangular"}:
        raise MaintenanceTaskAnalysisError(
            f"Step '{step.get('id')}' has unsupported duration distribution "
            f"'{distribution}'.")
    return distribution, optimistic, likely, pessimistic


def _duration_mean(step: Mapping[str, Any]) -> float:
    mode, low, likely, high = _duration_values(step)
    if mode == "fixed":
        return low
    if mode == "triangular":
        return (low + likely + high) / 3.0
    return (low + 4.0 * likely + high) / 6.0


def _sample_duration(step: Mapping[str, Any], rng: np.random.Generator) -> float:
    mode, low, likely, high = _duration_values(step)
    if mode == "fixed" or high - low <= _EPS:
        return low
    if mode == "triangular":
        return float(rng.triangular(low, likely, high))
    relative = (likely - low) / (high - low)
    alpha = 1.0 + 4.0 * relative
    beta = 1.0 + 4.0 * (1.0 - relative)
    return float(low + (high - low) * rng.beta(alpha, beta))


def _validate_probability(value: Any, *, label: str) -> float:
    probability = float(1.0 if value is None else value)
    if not math.isfinite(probability) or not 0.0 <= probability <= 1.0:
        raise MaintenanceTaskAnalysisError(
            f"{label} must be between 0 and 1.")
    return probability


def _task_step_maps(task: Mapping[str, Any]) -> tuple[
        list[str], dict[str, Mapping[str, Any]]]:
    order = _topological_steps(task)
    by_id = {str(step["id"]): step for step in task.get("steps") or ()}
    groups: dict[str, float] = defaultdict(float)
    for step in by_id.values():
        group = str(step.get("branch_group") or "").strip()
        probability = _validate_probability(
            step.get("execution_probability", 1.0),
            label=f"Step '{step.get('id')}' execution probability",
        )
        if group:
            groups[group] += probability
    for group, total in groups.items():
        if total > 1.0 + 1e-9:
            raise MaintenanceTaskAnalysisError(
                f"Task '{task.get('id')}' branch group '{group}' probabilities "
                "sum to more than 1.")
    return order, by_id


def _catalog_maps(payload: Mapping[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    people = list(payload.get("personnel") or ())
    resources = list(payload.get("resources") or ())
    person_map = {str(item.get("id", "")): item for item in people}
    resource_map = {str(item.get("id", "")): item for item in resources}
    if "" in person_map or len(person_map) != len(people):
        raise MaintenanceTaskAnalysisError(
            "Personnel role IDs must be non-empty and unique.")
    if "" in resource_map or len(resource_map) != len(resources):
        raise MaintenanceTaskAnalysisError(
            "Resource IDs must be non-empty and unique.")
    return person_map, resource_map


def _resource_requirements(
    step: Mapping[str, Any],
    person_map: Mapping[str, Any],
    resource_map: Mapping[str, Any],
) -> tuple[list[tuple[str, float]], list[Mapping[str, Any]], list[str]]:
    renewable_by_pool: dict[str, float] = defaultdict(float)
    consumables: list[Mapping[str, Any]] = []
    missing: list[str] = []
    for assignment in step.get("personnel") or ():
        role_id = str(assignment.get("role_id", ""))
        if role_id not in person_map:
            missing.append(f"personnel:{role_id}")
            continue
        renewable_by_pool[f"personnel:{role_id}"] += float(
            assignment.get("headcount", 1.0) or 0.0)
    for assignment in step.get("resources") or ():
        resource_id = str(assignment.get("resource_id", ""))
        resource = resource_map.get(resource_id)
        if resource is None:
            missing.append(f"resource:{resource_id}")
            continue
        if str(resource.get("kind", "tool")).lower() in {
                "spare", "repair_part", "consumable", "material", "ppe"}:
            consumables.append(assignment)
        else:
            renewable_by_pool[f"resource:{resource_id}"] += float(
                assignment.get("quantity", 1.0) or 0.0)
    return sorted(renewable_by_pool.items()), consumables, missing


def _deterministic_task_result(
    task: Mapping[str, Any],
    person_map: Mapping[str, Any],
    resource_map: Mapping[str, Any],
) -> dict[str, Any]:
    order, by_id = _task_step_maps(task)
    finish: dict[str, float] = {}
    schedule: list[dict[str, Any]] = []
    labour_by_role: dict[str, float] = defaultdict(float)
    resource_quantities: dict[str, float] = defaultdict(float)
    labour_cost = material_cost = resource_cost = 0.0
    warnings: list[str] = []
    for step_id in order:
        step = by_id[step_id]
        probability = _validate_probability(
            step.get("execution_probability", 1.0),
            label=f"Step '{step_id}' execution probability",
        )
        duration = _duration_mean(step)
        start = max(
            (finish[str(pred)] for pred in step.get("predecessor_step_ids") or ()),
            default=0.0,
        )
        nominal_finish = start + duration
        finish[step_id] = nominal_finish
        schedule.append({
            "step_id": step_id,
            "label": str(step.get("label") or step.get("description") or step_id),
            "phase": str(step.get("phase", "other")),
            "start": start,
            "finish": nominal_finish,
            "duration": duration,
            "execution_probability": probability,
        })
        for assignment in step.get("personnel") or ():
            role_id = str(assignment.get("role_id", ""))
            role = person_map.get(role_id)
            if role is None:
                warnings.append(f"Step {step_id} references missing role {role_id}.")
                continue
            headcount = float(assignment.get("headcount", 1.0) or 0.0)
            engagement = float(assignment.get("engagement_fraction", 1.0) or 0.0)
            hours = duration * probability * headcount * engagement
            labour_by_role[role_id] += hours
            labour_cost += hours * float(role.get("hourly_rate", 0.0) or 0.0)
        for assignment in step.get("resources") or ():
            resource_id = str(assignment.get("resource_id", ""))
            resource = resource_map.get(resource_id)
            if resource is None:
                warnings.append(
                    f"Step {step_id} references missing resource {resource_id}.")
                continue
            quantity = float(assignment.get("quantity", 1.0) or 0.0)
            resource_quantities[resource_id] += quantity * probability
            kind = str(resource.get("kind", "tool")).lower()
            if kind in {"spare", "repair_part", "consumable", "material", "ppe"}:
                unit_cost = float(
                    assignment.get("unit_cost_override")
                    if assignment.get("unit_cost_override") is not None
                    else resource.get("unit_cost", 0.0) or 0.0)
                material_cost += probability * quantity * unit_cost
            else:
                use_rate = float(resource.get("use_cost_per_hour", 0.0) or 0.0)
                resource_cost += probability * quantity * duration * use_rate
    elapsed = max(finish.values(), default=0.0)
    active_labour = sum(labour_by_role.values())
    fixed_cost = float(task.get("fixed_cost", 0.0) or 0.0)
    travel_cost = float(task.get("travel_cost", 0.0) or 0.0)
    downtime_rate = float(task.get("downtime_cost_per_hour", 0.0) or 0.0)
    downtime_cost = elapsed * downtime_rate if task.get(
        "takes_asset_out_of_service", False) else 0.0
    per_event_cost = (
        labour_cost + material_cost + resource_cost + fixed_cost
        + travel_cost + downtime_cost
    )
    return {
        "task_id": str(task.get("id")),
        "title": str(task.get("title") or task.get("id")),
        "task_type": str(task.get("task_type", "other")),
        "maintenance_level": str(task.get("maintenance_level", "unspecified")),
        "status": str(task.get("status", "draft")),
        "elapsed_hours": elapsed,
        "labour_hours": active_labour,
        "labour_by_role": dict(sorted(labour_by_role.items())),
        "resource_quantity_per_event": dict(sorted(resource_quantities.items())),
        "cost_per_event": {
            "labour": labour_cost,
            "materials": material_cost,
            "resource_use": resource_cost,
            "fixed": fixed_cost,
            "travel": travel_cost,
            "downtime": downtime_cost,
            "total": per_event_cost,
        },
        "step_schedule": schedule,
        "warnings": sorted(set(warnings)),
    }


def _period_hours(unit: str, value: float) -> float:
    factors = {
        "hour": 1.0, "hours": 1.0,
        "day": 24.0, "days": 24.0,
        "week": 168.0, "weeks": 168.0,
        "month": 365.2425 * 24.0 / 12.0,
        "months": 365.2425 * 24.0 / 12.0,
        "year": 365.2425 * 24.0, "years": 365.2425 * 24.0,
    }
    if unit not in factors:
        raise MaintenanceTaskAnalysisError(
            f"Unsupported calendar interval unit '{unit}'.")
    return value * factors[unit]


def _generate_occurrences(
    task: Mapping[str, Any],
    horizon: float,
    rng: np.random.Generator,
) -> list[dict[str, float]]:
    frequency = task.get("frequency") or {}
    model = str(frequency.get("model", "manual_per_period")).lower()
    occurrences: list[float] = []
    if model == "event_list":
        occurrences = sorted(
            float(value) for value in frequency.get("event_times_hours") or ()
            if 0.0 <= float(value) < horizon)
    elif model in {"calendar_interval", "usage_interval"}:
        interval = float(frequency.get("interval", 0.0) or 0.0)
        if interval <= 0:
            return []
        if model == "calendar_interval":
            interval_hours = _period_hours(
                str(frequency.get("interval_unit", "hours")).lower(), interval)
        else:
            operating = float(frequency.get("annual_operating_hours", 0.0) or 0.0)
            usage_per_hour = operating / (365.2425 * 24.0)
            if usage_per_hour <= 0:
                return []
            interval_hours = interval / usage_per_hour
        raw_first = frequency.get("first_due_hours")
        first = interval_hours if raw_first is None else float(raw_first)
        if first < 0:
            first = 0.0
        occurrences = list(np.arange(first, horizon, interval_hours, dtype=float))
    elif model == "poisson_rate":
        rate = float(frequency.get("rate_per_hour", 0.0) or 0.0)
        population = float(frequency.get("population", 1.0) or 0.0)
        duty = float(frequency.get("duty_cycle", 1.0) or 0.0)
        total_rate = rate * population * duty
        if total_rate > 0:
            time = 0.0
            while True:
                time += float(rng.exponential(1.0 / total_rate))
                if time >= horizon:
                    break
                occurrences.append(time)
    elif model == "renewal":
        distribution = str(frequency.get("distribution", "weibull")).lower()
        population = max(1, int(frequency.get("population", 1) or 1))
        duty = float(frequency.get("duty_cycle", 1.0) or 0.0)
        if duty <= 0:
            return []
        for _ in range(population):
            time = 0.0
            while True:
                if distribution == "weibull":
                    scale = float(frequency.get("scale_hours", 0.0) or 0.0)
                    shape = float(frequency.get("shape", 0.0) or 0.0)
                    if scale <= 0 or shape <= 0:
                        break
                    increment = scale * float(rng.weibull(shape)) / duty
                elif distribution == "exponential":
                    rate = float(frequency.get("rate_per_hour", 0.0) or 0.0)
                    if rate <= 0:
                        break
                    increment = float(rng.exponential(1.0 / rate)) / duty
                else:
                    raise MaintenanceTaskAnalysisError(
                        f"Unsupported renewal distribution '{distribution}'.")
                time += max(increment, _EPS)
                if time >= horizon:
                    break
                occurrences.append(time)
        occurrences.sort()
    else:
        count = float(frequency.get("occurrences_per_period", 0.0) or 0.0)
        period = float(frequency.get("period_hours", horizon) or horizon)
        expected = max(0.0, count * horizon / max(period, _EPS))
        whole = int(math.floor(expected))
        fractional = expected - whole
        n = whole + int(rng.random() < fractional)
        if n > 0:
            occurrences = list(np.linspace(
                0.0, horizon, n, endpoint=False, dtype=float))
    tolerance_before = float(
        frequency.get("tolerance_before_hours", 0.0) or 0.0)
    tolerance_after = float(
        frequency.get("tolerance_after_hours", 0.0) or 0.0)
    return [{
        "arrival": max(0.0, time - tolerance_before),
        "due": time,
        "latest": min(horizon, time + tolerance_after),
    } for time in occurrences]


def _shift_mask(
    item: Mapping[str, Any],
    horizon_slots: int,
    slot_hours: float,
    start_weekday: int,
    off_shift_capacity: int = 0,
) -> np.ndarray:
    shifts = list(item.get("weekly_shifts") or ())
    if not shifts:
        mask = np.full(
            horizon_slots, int(item.get("capacity", 1) or 0),
            dtype=np.int32,
        )
    else:
        capacity = max(0, int(item.get("capacity", 1) or 0))
        mask = np.full(
            horizon_slots, max(0, off_shift_capacity), dtype=np.int32)
        for slot in range(horizon_slots):
            hour = slot * slot_hours
            day_index = int(hour // 24)
            weekday = (start_weekday + day_index) % 7
            hour_of_day = hour - day_index * 24
            for shift in shifts:
                if int(shift.get("weekday", -1)) != weekday:
                    continue
                start = float(shift.get("start_hour", 0.0) or 0.0)
                end = float(shift.get("end_hour", 24.0) or 0.0)
                if start <= hour_of_day < end:
                    raw_shift_capacity = shift.get("capacity")
                    shift_capacity = (
                        capacity if raw_shift_capacity is None
                        else int(raw_shift_capacity)
                    )
                    mask[slot] = max(
                        mask[slot], min(capacity, shift_capacity))
    for outage in item.get("planned_outages") or ():
        start = max(0, int(math.floor(
            float(outage.get("start_hour", 0.0) or 0.0) / slot_hours)))
        end = min(horizon_slots, int(math.ceil(
            float(outage.get("end_hour", 0.0) or 0.0) / slot_hours)))
        mask[start:end] = int(outage.get("capacity", 0) or 0)
    return mask


def _priority_value(task: Mapping[str, Any]) -> int:
    classes = {
        "safety": 500, "regulatory": 500, "mission": 400,
        "operational": 300, "support": 200, "routine": 100,
    }
    return classes.get(str(task.get("criticality", "routine")).lower(), 100) + int(
        task.get("priority", 0) or 0)


def _active_step_ids(
    order: list[str],
    by_id: Mapping[str, Mapping[str, Any]],
    rng: np.random.Generator,
) -> set[str]:
    active: set[str] = set()
    groups: dict[str, list[tuple[str, float]]] = defaultdict(list)
    for step_id in order:
        step = by_id[step_id]
        probability = _validate_probability(
            step.get("execution_probability", 1.0),
            label=f"Step '{step_id}' execution probability",
        )
        group = str(step.get("branch_group") or "").strip()
        if group:
            groups[group].append((step_id, probability))
        elif rng.random() <= probability:
            active.add(step_id)
    for members in groups.values():
        draw = rng.random()
        cumulative = 0.0
        for step_id, probability in members:
            cumulative += probability
            if draw <= cumulative:
                active.add(step_id)
                break
    return active


def _find_slots(
    ready: int,
    duration: int,
    requirements: list[tuple[str, int]],
    available: Mapping[str, np.ndarray],
    used: Mapping[str, np.ndarray],
    horizon_slots: int,
    interruptible: bool,
) -> list[int] | None:
    if duration <= 0:
        return []

    def slot_available(index: int) -> bool:
        if index < 0 or index >= horizon_slots:
            return False
        return all(
            int(available[pool][index]) - int(used[pool][index]) >= quantity
            for pool, quantity in requirements
        )

    if not requirements:
        if ready + duration <= horizon_slots:
            return list(range(ready, ready + duration))
        return None
    if interruptible:
        chosen: list[int] = []
        for index in range(max(0, ready), horizon_slots):
            if slot_available(index):
                chosen.append(index)
                if len(chosen) == duration:
                    return chosen
        return None
    consecutive: list[int] = []
    for index in range(max(0, ready), horizon_slots):
        if slot_available(index):
            consecutive.append(index)
            if len(consecutive) == duration:
                return consecutive
        else:
            consecutive.clear()
    return None


def _referenced_renewable_pools(
    payload: Mapping[str, Any],
    person_map: Mapping[str, Any],
    resource_map: Mapping[str, Any],
) -> set[str]:
    return {
        pool
        for task in payload.get("tasks") or ()
        for step in task.get("steps") or ()
        for pool, quantity in _resource_requirements(
            step, person_map, resource_map)[0]
        if quantity > 0
    }


def _portfolio_calendars(
    payload: Mapping[str, Any],
    horizon_slots: int,
    slot_hours: float,
    start_weekday: int,
) -> tuple[dict[str, np.ndarray], dict[str, np.ndarray]]:
    """Build read-only regular/total capacity once for all replications."""
    person_map, resource_map = _catalog_maps(payload)
    referenced = _referenced_renewable_pools(
        payload, person_map, resource_map)
    portfolio = payload.get("portfolio") or {}
    allow_overtime = bool(portfolio.get("allow_overtime", False))
    available: dict[str, np.ndarray] = {}
    regular_available: dict[str, np.ndarray] = {}
    for role_id, role in person_map.items():
        pool = f"personnel:{role_id}"
        if pool not in referenced:
            continue
        role_with_capacity = {
            **role,
            "capacity": role.get("available_headcount", 1),
        }
        regular_available[pool] = _shift_mask(
            role_with_capacity, horizon_slots, slot_hours, start_weekday)
        available[pool] = _shift_mask(
            role_with_capacity, horizon_slots, slot_hours, start_weekday,
            int(role.get("overtime_capacity", 0) or 0)
            if allow_overtime else 0)
    for resource_id, resource in resource_map.items():
        pool = f"resource:{resource_id}"
        if pool not in referenced:
            continue
        available[pool] = _shift_mask(
            resource, horizon_slots, slot_hours, start_weekday)
        regular_available[pool] = available[pool]
    return available, regular_available


def _schedule_replication(
    payload: Mapping[str, Any],
    rng: np.random.Generator,
    calendars: tuple[
        Mapping[str, np.ndarray], Mapping[str, np.ndarray],
    ],
    *,
    keep_timeline: bool,
) -> dict[str, Any]:
    portfolio = payload.get("portfolio") or {}
    horizon = float(portfolio.get("horizon_hours", 8760.0) or 0.0)
    slot_hours = float(portfolio.get("slot_hours", 0.25) or 0.0)
    if horizon <= 0 or slot_hours <= 0:
        raise MaintenanceTaskAnalysisError(
            "Portfolio horizon and scheduling interval must be positive.")
    horizon_slots = int(math.ceil(horizon / slot_hours))
    if horizon_slots > 200_000:
        raise MaintenanceTaskAnalysisError(
            "Portfolio horizon contains too many scheduling intervals; "
            "increase the interval or shorten the horizon.")
    person_map, resource_map = _catalog_maps(payload)
    available, regular_available = calendars
    used = {
        pool: np.zeros(horizon_slots, dtype=np.int32)
        for pool in available
    }

    jobs: list[dict[str, Any]] = []
    job_limit = int(portfolio.get("max_generated_jobs", 100_000) or 100_000)
    for task in payload.get("tasks") or ():
        order, by_id = _task_step_maps(task)
        for index, occurrence in enumerate(
                _generate_occurrences(task, horizon, rng)):
            if len(jobs) >= job_limit:
                raise MaintenanceTaskAnalysisError(
                    "Generated job count exceeds the configured safety limit.")
            active = _active_step_ids(order, by_id, rng)
            sampled = {
                step_id: (_sample_duration(by_id[step_id], rng)
                          if step_id in active else 0.0)
                for step_id in order
            }
            jobs.append({
                "id": f"{task.get('id')}:{index + 1}",
                "task": task,
                "order": order,
                "steps": by_id,
                "active": active,
                "sampled": sampled,
                "arrival_slot": int(math.floor(
                    occurrence["arrival"] / slot_hours)),
                "due_slot": int(math.ceil(occurrence["due"] / slot_hours)),
                "latest_slot": int(math.ceil(
                    occurrence["latest"] / slot_hours)),
                "finish": {},
                "scheduled": set(),
                "backlog": False,
            })

    timeline: list[dict[str, Any]] = []
    task_metrics: dict[str, dict[str, float]] = defaultdict(
        lambda: defaultdict(float))
    total_cost = 0.0
    cost_breakdown = {
        "labour": 0.0,
        "materials": 0.0,
        "resource_use": 0.0,
        "fixed": 0.0,
        "travel": 0.0,
        "downtime": 0.0,
    }
    total_overtime_labor_hours = 0.0
    scheduled_steps = 0
    unscheduled_steps = 0
    while True:
        candidates: list[tuple[tuple[Any, ...], dict[str, Any]]] = []
        remaining = False
        for job in jobs:
            if job["backlog"]:
                continue
            unscheduled = [
                step_id for step_id in job["order"]
                if step_id not in job["scheduled"]
            ]
            if unscheduled:
                remaining = True
            for step_id in unscheduled:
                step = job["steps"][step_id]
                predecessors = [
                    str(value)
                    for value in step.get("predecessor_step_ids") or ()
                ]
                if any(pred not in job["scheduled"] for pred in predecessors):
                    continue
                ready = max(
                    [job["arrival_slot"]]
                    + [job["finish"].get(pred, job["arrival_slot"])
                       for pred in predecessors]
                )
                duration_hours = job["sampled"][step_id]
                duration_slots = int(math.ceil(
                    duration_hours / slot_hours - _EPS))
                renewable, _consumables, missing = _resource_requirements(
                    step, person_map, resource_map)
                if missing:
                    job["backlog"] = True
                    break
                requirements = [
                    (pool, int(math.ceil(quantity)))
                    for pool, quantity in renewable if quantity > 0
                ]
                if any(pool not in available for pool, _ in requirements):
                    job["backlog"] = True
                    break
                slots = _find_slots(
                    ready, duration_slots, requirements, available, used,
                    horizon_slots, bool(step.get("interruptible", True)),
                )
                feasible = (
                    slots[0] if slots
                    else ready if slots is not None
                    else horizon_slots + 1
                )
                key = (
                    feasible,
                    -_priority_value(job["task"]),
                    job["due_slot"],
                    job["arrival_slot"],
                    job["id"],
                    step_id,
                )
                candidates.append((key, {
                    "job": job, "step_id": step_id, "step": step,
                    "slots": slots, "requirements": requirements,
                    "duration_hours": duration_hours, "ready": ready,
                }))
        if not remaining:
            break
        if not candidates:
            break
        candidates.sort(key=lambda value: value[0])
        selected = candidates[0][1]
        job = selected["job"]
        # A resource-validation failure may have marked a job as backlog after
        # an earlier ready step from that job entered the candidate list.
        if job["backlog"]:
            continue
        slots = selected["slots"]
        if slots is None:
            job["backlog"] = True
            continue
        step_id = selected["step_id"]
        step = selected["step"]
        overtime_fractions: dict[str, float] = {}
        for pool, quantity in selected["requirements"]:
            if slots and slots[0] < horizon_slots:
                if pool.startswith("personnel:"):
                    overtime_units = 0.0
                    for slot in slots:
                        before = max(
                            0, int(used[pool][slot])
                            - int(regular_available[pool][slot]))
                        after = max(
                            0, int(used[pool][slot]) + quantity
                            - int(regular_available[pool][slot]))
                        overtime_units += after - before
                    overtime_fractions[pool] = (
                        overtime_units / (quantity * len(slots))
                        if quantity > 0 and slots else 0.0
                    )
                used[pool][np.asarray(slots, dtype=int)] += quantity
        start_slot = slots[0] if slots else selected["ready"]
        finish_slot = min(
            horizon_slots, (slots[-1] + 1) if slots else start_slot)
        job["scheduled"].add(step_id)
        job["finish"][step_id] = finish_slot
        scheduled_steps += 1

        probability = 1.0 if step_id in job["active"] else 0.0
        labour_cost = material_cost = resource_cost = 0.0
        labour_hours = 0.0
        overtime_labor_hours = 0.0
        for assignment in step.get("personnel") or ():
            role_id = str(assignment.get("role_id"))
            role = person_map[role_id]
            headcount = float(assignment.get("headcount", 1.0) or 0.0)
            engagement = float(
                assignment.get("engagement_fraction", 1.0) or 0.0)
            hours = selected["duration_hours"] * headcount * engagement
            labour_hours += hours
            overtime_fraction = overtime_fractions.get(
                f"personnel:{role_id}", 0.0)
            overtime_hours = hours * overtime_fraction
            overtime_labor_hours += overtime_hours
            rate = float(role.get("hourly_rate", 0.0) or 0.0)
            multiplier = float(
                role.get("overtime_rate_multiplier", 1.5) or 1.5)
            labour_cost += (
                (hours - overtime_hours) * rate
                + overtime_hours * rate * multiplier
            )
        for assignment in step.get("resources") or ():
            resource = resource_map[str(assignment.get("resource_id"))]
            quantity = float(assignment.get("quantity", 1.0) or 0.0)
            kind = str(resource.get("kind", "tool")).lower()
            if kind in {"spare", "repair_part", "consumable", "material", "ppe"}:
                unit_cost = float(
                    assignment.get("unit_cost_override")
                    if assignment.get("unit_cost_override") is not None
                    else resource.get("unit_cost", 0.0) or 0.0)
                material_cost += quantity * unit_cost
            else:
                resource_cost += (
                    quantity * selected["duration_hours"]
                    * float(resource.get("use_cost_per_hour", 0.0) or 0.0)
                )
        step_cost = probability * (labour_cost + material_cost + resource_cost)
        total_cost += step_cost
        cost_breakdown["labour"] += probability * labour_cost
        cost_breakdown["materials"] += probability * material_cost
        cost_breakdown["resource_use"] += probability * resource_cost
        total_overtime_labor_hours += probability * overtime_labor_hours
        task_id = str(job["task"].get("id"))
        task_metrics[task_id]["labour_hours"] += probability * labour_hours
        task_metrics[task_id]["overtime_labor_hours"] += (
            probability * overtime_labor_hours)
        task_metrics[task_id]["direct_cost"] += step_cost
        if keep_timeline:
            timeline.append({
                "job_id": job["id"], "task_id": task_id,
                "step_id": step_id,
                "label": str(step.get("label") or step_id),
                "start": start_slot * slot_hours,
                "finish": finish_slot * slot_hours,
                "active": bool(probability),
            })

    completed_jobs = backlog_jobs = late_jobs = 0
    total_downtime = 0.0
    for job in jobs:
        active_ids = job["active"]
        complete = all(step_id in job["scheduled"] for step_id in active_ids)
        task_id = str(job["task"].get("id"))
        if complete:
            completed_jobs += 1
            completion = max(
                (job["finish"].get(step_id, job["arrival_slot"])
                 for step_id in active_ids),
                default=job["arrival_slot"],
            )
            elapsed = max(0.0, (completion - job["arrival_slot"]) * slot_hours)
            task_metrics[task_id]["events"] += 1.0
            task_metrics[task_id]["elapsed_hours"] += elapsed
            fixed_cost = float(
                job["task"].get("fixed_cost", 0.0) or 0.0)
            travel_cost = float(
                job["task"].get("travel_cost", 0.0) or 0.0)
            event_fixed_cost = fixed_cost + travel_cost
            total_cost += event_fixed_cost
            cost_breakdown["fixed"] += fixed_cost
            cost_breakdown["travel"] += travel_cost
            task_metrics[task_id]["direct_cost"] += event_fixed_cost
            if completion > job["latest_slot"]:
                late_jobs += 1
                task_metrics[task_id]["late_events"] += 1.0
            if job["task"].get("takes_asset_out_of_service", False):
                affected = float(job["task"].get("affected_asset_count", 1.0) or 1.0)
                total_downtime += elapsed * affected
                task_metrics[task_id]["downtime_hours"] += elapsed * affected
                rate = float(job["task"].get(
                    "downtime_cost_per_hour",
                    portfolio.get("default_downtime_cost_per_hour", 0.0),
                ) or 0.0)
                downtime_cost = elapsed * affected * rate
                total_cost += downtime_cost
                cost_breakdown["downtime"] += downtime_cost
                task_metrics[task_id]["downtime_cost"] += downtime_cost
        else:
            backlog_jobs += 1
            task_metrics[task_id]["backlog_events"] += 1.0
            unscheduled_steps += sum(
                step_id in active_ids and step_id not in job["scheduled"]
                for step_id in job["order"])

    utilisation: dict[str, float] = {}
    for pool, capacity in available.items():
        available_capacity = float(np.sum(capacity))
        utilisation[pool] = (
            float(np.sum(used[pool])) / available_capacity
            if available_capacity > 0 else 0.0
        )
    asset_population = float(portfolio.get("asset_population", 0.0) or 0.0)
    availability = None
    if asset_population > 0:
        availability = max(
            0.0, 1.0 - total_downtime / (asset_population * horizon))
    return {
        "jobs_generated": len(jobs),
        "jobs_completed": completed_jobs,
        "backlog_jobs": backlog_jobs,
        "late_jobs": late_jobs,
        "scheduled_steps": scheduled_steps,
        "unscheduled_steps": unscheduled_steps,
        "total_cost": total_cost,
        "cost_breakdown": cost_breakdown,
        "overtime_labor_hours": total_overtime_labor_hours,
        "total_downtime_hours": total_downtime,
        "availability": availability,
        "resource_utilisation": utilisation,
        "task_metrics": {
            key: dict(value) for key, value in task_metrics.items()
        },
        "timeline": sorted(
            timeline, key=lambda item: (item["start"], item["job_id"], item["step_id"])),
    }


def analyze_maintenance_task_analysis(
    payload: Mapping[str, Any],
    *,
    progress_callback: Callable[[int, int], None] | None = None,
    cancel_check: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    """Analyze a complete MTA task inventory and optional portfolio schedule."""
    input_sha256 = _canonical_hash({
        "tasks": payload.get("tasks") or [],
        "personnel": payload.get("personnel") or [],
        "resources": payload.get("resources") or [],
        "portfolio": payload.get("portfolio") or {},
    })
    tasks = list(payload.get("tasks") or ())
    task_ids = [str(task.get("id", "")) for task in tasks]
    if any(not value for value in task_ids) or len(task_ids) != len(set(task_ids)):
        raise MaintenanceTaskAnalysisError(
            "Task IDs must be non-empty and unique.")
    person_map, resource_map = _catalog_maps(payload)
    deterministic = [
        _deterministic_task_result(task, person_map, resource_map)
        for task in tasks
    ]
    portfolio = payload.get("portfolio") or {}
    simulations = int(portfolio.get("n_simulations", 1) or 1)
    if not bool(portfolio.get("simulation_enabled", True)):
        simulations = 1
    if not 1 <= simulations <= 20_000:
        raise MaintenanceTaskAnalysisError(
            "Simulation count must be between 1 and 20,000.")
    horizon = float(portfolio.get("horizon_hours", 8760.0) or 0.0)
    slot_hours = float(portfolio.get("slot_hours", 0.25) or 0.0)
    if horizon <= 0 or slot_hours <= 0:
        raise MaintenanceTaskAnalysisError(
            "Portfolio horizon and scheduling interval must be positive.")
    estimated_grid_work = (
        simulations * math.ceil(horizon / slot_hours)
    )
    if estimated_grid_work > 500_000_000:
        raise MaintenanceTaskAnalysisError(
            "The requested simulation/calendar grid exceeds the bounded "
            "work budget. Reduce replications, increase the scheduling "
            "interval, shorten the horizon, or consolidate resource pools.")
    confidence = float(portfolio.get("confidence", 0.95) or 0.95)
    if not 0.0 < confidence < 1.0:
        raise MaintenanceTaskAnalysisError(
            "Confidence must be between 0 and 1.")
    seed = int(portfolio.get("seed", 42) or 42)
    rng = np.random.default_rng(seed)
    horizon_slots = int(math.ceil(horizon / slot_hours))
    referenced_pool_count = len(_referenced_renewable_pools(
        payload, person_map, resource_map))
    if referenced_pool_count * horizon_slots > 25_000_000:
        raise MaintenanceTaskAnalysisError(
            "The resource-calendar model exceeds the bounded memory budget. "
            "Increase the scheduling interval, shorten the horizon, or "
            "consolidate equivalent personnel and resource pools.")
    calendars = _portfolio_calendars(
        payload,
        horizon_slots,
        slot_hours,
        int(portfolio.get("start_weekday", 0) or 0) % 7,
    )
    replications: list[dict[str, Any]] = []
    for index in range(simulations):
        if cancel_check is not None and cancel_check():
            raise InterruptedError("Maintenance task analysis cancelled.")
        replications.append(_schedule_replication(
            payload, rng, calendars, keep_timeline=(index == 0),
        ))
        if progress_callback is not None:
            progress_callback(index + 1, simulations)

    portfolio_result = {
        "n_simulations": simulations,
        "confidence": confidence,
        "seed": seed,
        "jobs_generated": _quantiles(
            (row["jobs_generated"] for row in replications), confidence),
        "jobs_completed": _quantiles(
            (row["jobs_completed"] for row in replications), confidence),
        "backlog_jobs": _quantiles(
            (row["backlog_jobs"] for row in replications), confidence),
        "late_jobs": _quantiles(
            (row["late_jobs"] for row in replications), confidence),
        "total_cost": _quantiles(
            (row["total_cost"] for row in replications), confidence),
        "cost_breakdown": {
            component: _quantiles(
                (row["cost_breakdown"][component] for row in replications),
                confidence,
            )
            for component in (
                "labour", "materials", "resource_use",
                "fixed", "travel", "downtime",
            )
        },
        "overtime_labor_hours": _quantiles(
            (row["overtime_labor_hours"] for row in replications), confidence),
        "total_downtime_hours": _quantiles(
            (row["total_downtime_hours"] for row in replications), confidence),
        "availability": (
            _quantiles(
                (row["availability"] for row in replications
                 if row["availability"] is not None),
                confidence,
            )
            if any(row["availability"] is not None for row in replications)
            else None
        ),
        "resource_utilisation": {
            pool: _quantiles(
                (row["resource_utilisation"].get(pool, 0.0)
                 for row in replications),
                confidence,
            )
            for pool in sorted({
                pool for row in replications for pool in row["resource_utilisation"]
            })
        },
        "representative_timeline": replications[0]["timeline"],
    }
    task_portfolio: dict[str, Any] = {}
    for task_id in task_ids:
        fields = {
            field for row in replications
            for field in row["task_metrics"].get(task_id, {})
        }
        task_portfolio[task_id] = {
            field: _quantiles(
                (row["task_metrics"].get(task_id, {}).get(field, 0.0)
                 for row in replications),
                confidence,
            )
            for field in sorted(fields)
        }
    for task_result in deterministic:
        task_result["portfolio"] = task_portfolio.get(
            task_result["task_id"], {})

    warnings: list[str] = []
    if not tasks:
        warnings.append("No support tasks are defined.")
    if any(task.get("status", "draft") not in {
            "approved", "demonstrated"} for task in tasks):
        warnings.append(
            "Draft or unapproved tasks are included in the portfolio results.")
    if portfolio_result["backlog_jobs"]["upper"] > 0:
        warnings.append(
            "At least one simulation produced unfinished work; inspect resource "
            "availability and the backlog.")
    result: dict[str, Any] = {
        "input_sha256": input_sha256,
        "source_traceability": [{
            "task_id": str(task.get("id")),
            "source_refs": list(task.get("source_refs") or ()),
            "prediction_rate_source": (
                task.get("frequency") or {}).get("prediction_source"),
        } for task in tasks if (
            task.get("source_refs")
            or (task.get("frequency") or {}).get("prediction_source")
        )],
        "task_results": deterministic,
        "portfolio": portfolio_result,
        "warnings": warnings,
        "methodology": {
            "title": "Maintenance Task Analysis and resource-constrained scheduling",
            "method_version": MTA_METHOD_VERSION,
            "implementation_status": "standards_informed_native_model",
            "standards_basis": [
                "MIL-HDBK-502B, Activities C.1.9 and D.1",
                "MIL-STD-3034A task applicability and effectiveness concepts",
            ],
            "scheduler": (
                "seeded discrete-event list scheduling on a bounded time grid; "
                "priority, due date, FIFO, then stable ID"
            ),
            "uncertainty": (
                "fixed, triangular, or beta-PERT step durations; deterministic "
                "or stochastic task occurrences"
            ),
            "assumptions": [
                "Resource pools represent qualified capacity, not named-person calendars.",
                "Active work is not displaced by a later higher-priority job.",
                "Duration, branch, and arrival draws are independent unless represented by a common source.",
                "Reported availability is an asset-hour burden estimate when asset population is provided.",
            ],
        },
    }
    result["result_sha256"] = _canonical_hash(result)
    return result


__all__ = [
    "MTA_METHOD_VERSION",
    "MaintenanceTaskAnalysisError",
    "analyze_maintenance_task_analysis",
]
