"""Transparent reliability-growth trajectory and corrective-action planning.

This is a planning model, not a fit to recurrence data. It keeps a smooth
power-law target trajectory separate from deterministic delayed-fix / fix-
effectiveness accounting so neither is mistaken for statistical evidence.
"""

from __future__ import annotations

import math
from typing import Iterable

import numpy as np


def plan_reliability_growth(
    *,
    current_test_time: float,
    current_mtbf: float,
    target_mtbf: float,
    growth_rate: float,
    planned_additional_test_time: float | None = None,
    unaddressed_failure_rate: float = 0.0,
    corrective_actions: Iterable[dict] | None = None,
) -> dict:
    """Build a power-law growth target and optional delayed-fix projection."""
    t0 = float(current_test_time)
    m0 = float(current_mtbf)
    target = float(target_mtbf)
    alpha = float(growth_rate)
    unaddressed = float(unaddressed_failure_rate)
    if not math.isfinite(t0) or t0 <= 0:
        raise ValueError("current_test_time must be positive and finite.")
    if not math.isfinite(m0) or m0 <= 0 or not math.isfinite(target) or target <= 0:
        raise ValueError("current_mtbf and target_mtbf must be positive and finite.")
    if not math.isfinite(alpha) or not 0 < alpha < 1:
        raise ValueError("growth_rate must be strictly between 0 and 1.")
    if not math.isfinite(unaddressed) or unaddressed < 0:
        raise ValueError("unaddressed_failure_rate must be non-negative and finite.")
    if planned_additional_test_time is not None:
        additional = float(planned_additional_test_time)
        if not math.isfinite(additional) or additional <= 0:
            raise ValueError("planned_additional_test_time must be positive and finite.")
    else:
        additional = None

    already_met = m0 >= target
    target_time = t0 if already_met else t0 * (target / m0) ** (1.0 / alpha)
    planned_end = t0 + additional if additional is not None else target_time
    curve_end = max(t0 * 1.01, planned_end, target_time)
    time = np.linspace(t0, curve_end, 180)
    mtbf = m0 * (time / t0) ** alpha
    intensity = 1.0 / mtbf

    def expected_between(end: float) -> float:
        coefficient = t0 ** alpha / m0
        return coefficient * (end ** (1.0 - alpha) - t0 ** (1.0 - alpha)) / (1.0 - alpha)

    planned_mtbf = m0 * (planned_end / t0) ** alpha
    trajectory = {
        "method": "anchored_power_law_target_trajectory",
        "current_test_time": t0,
        "current_mtbf": m0,
        "target_mtbf": target,
        "growth_rate": alpha,
        "target_already_met": already_met,
        "test_time_at_target": target_time,
        "additional_test_time_to_target": max(target_time - t0, 0.0),
        "planned_end_time": planned_end,
        "planned_end_mtbf": planned_mtbf,
        "target_met_at_planned_end": planned_mtbf >= target,
        "expected_failures_to_planned_end": expected_between(planned_end),
        "curve": {"time": time.tolist(), "instantaneous_mtbf": mtbf.tolist(),
                  "failure_intensity": intensity.tolist()},
        "warning": (
            "This is a deterministic planning trajectory anchored at the entered "
            "current point. It is not a fitted Crow-AMSAA confidence statement."
        ),
    }

    actions = _fix_projection(
        current_time=t0, unaddressed=unaddressed,
        actions=[] if corrective_actions is None else list(corrective_actions),
    )
    return {
        "trajectory": trajectory,
        "corrective_action_projection": actions,
        "standards_context": {
            "status": "standards_informed_planning_model",
            "references": ["MIL-HDBK-189C", "MIL-HDBK-338B §8.5"],
            "claim": "No claim of clause-complete MIL-HDBK-189C implementation.",
        },
    }


def _fix_projection(*, current_time: float, unaddressed: float,
                    actions: list[dict]) -> dict | None:
    if not actions and unaddressed == 0:
        return None
    cleaned = []
    for index, raw in enumerate(actions):
        name = str(raw.get("name", "")).strip() or f"Failure mode {index + 1}"
        rate = float(raw.get("baseline_failure_rate", 0))
        fix_time = float(raw.get("planned_fix_time", current_time))
        effectiveness = float(raw.get("effectiveness", 0))
        low = float(raw.get("effectiveness_lower", effectiveness))
        high = float(raw.get("effectiveness_upper", effectiveness))
        if not math.isfinite(rate) or rate < 0:
            raise ValueError("Corrective-action failure rates must be non-negative and finite.")
        if not math.isfinite(fix_time) or fix_time < current_time:
            raise ValueError("Corrective-action fix times cannot precede current_test_time.")
        if any(not math.isfinite(value) or not 0 <= value <= 1
               for value in (effectiveness, low, high)) or not low <= effectiveness <= high:
            raise ValueError("Fix effectiveness bounds must satisfy 0 <= lower <= estimate <= upper <= 1.")
        cleaned.append({
            "name": name, "baseline_failure_rate": rate,
            "planned_fix_time": fix_time, "effectiveness": effectiveness,
            "effectiveness_lower": low, "effectiveness_upper": high,
        })
    cleaned.sort(key=lambda item: (item["planned_fix_time"], item["name"]))
    initial_rate = unaddressed + sum(item["baseline_failure_rate"] for item in cleaned)
    if initial_rate <= 0:
        return {
            "initial_failure_rate": 0.0, "initial_mtbf": None,
            "growth_potential_failure_rate": 0.0, "growth_potential_mtbf": None,
            "actions": [], "steps": [],
            "warning": "No positive failure-rate contribution was entered.",
        }
    current_rate = initial_rate
    steps = [{"time": current_time, "failure_rate": current_rate,
              "mtbf": 1.0 / current_rate, "action": "Current state"}]
    output_actions = []
    for item in cleaned:
        reduction = item["baseline_failure_rate"] * item["effectiveness"]
        before = current_rate
        current_rate = max(current_rate - reduction, 0.0)
        output_actions.append({**item, "projected_rate_reduction": reduction,
                               "failure_rate_before": before,
                               "failure_rate_after": current_rate})
        steps.extend([
            {"time": item["planned_fix_time"], "failure_rate": before,
             "mtbf": 1.0 / before if before > 0 else None,
             "action": f"Before {item['name']}"},
            {"time": item["planned_fix_time"], "failure_rate": current_rate,
             "mtbf": 1.0 / current_rate if current_rate > 0 else None,
             "action": f"After {item['name']}"},
        ])
    pessimistic = unaddressed + sum(
        item["baseline_failure_rate"] * (1.0 - item["effectiveness_lower"])
        for item in cleaned)
    optimistic = unaddressed + sum(
        item["baseline_failure_rate"] * (1.0 - item["effectiveness_upper"])
        for item in cleaned)
    return {
        "initial_failure_rate": initial_rate,
        "initial_mtbf": 1.0 / initial_rate,
        "growth_potential_failure_rate": current_rate,
        "growth_potential_mtbf": 1.0 / current_rate if current_rate > 0 else None,
        "growth_potential_mtbf_lower": 1.0 / pessimistic if pessimistic > 0 else None,
        "growth_potential_mtbf_upper": 1.0 / optimistic if optimistic > 0 else None,
        "unaddressed_failure_rate": unaddressed,
        "actions": output_actions,
        "steps": steps,
        "warning": (
            "Fix-effectiveness projection is deterministic and assumes independent, "
            "additive failure-rate contributions with no new failure modes."
        ),
    }


__all__ = ["plan_reliability_growth"]
