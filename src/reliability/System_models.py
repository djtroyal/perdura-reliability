"""Explicit repairable redundancy templates and independent reference formulas."""
from __future__ import annotations

import math
from collections import defaultdict
from scipy.stats import binom

from reliability.Markov import MarkovChain, MarkovState, MarkovTransition


def redundancy_model(*, mode="active", required=1, total=2, failure_rate=.001,
                     repair_rate=.01, repair_crews=1, failure_rates=None,
                     repair_rates=None, dormant_rate=0., coverage=1.,
                     switching="independent", switch_repair_rate=.01):
    """Build a CTMC without treating a first-failure mean as a cycle mean.

    Unequal active units use a fixed-priority preemptive-resume repair policy;
    memorylessness makes each selected failed unit's repair transition valid.
    Homogeneous pools use min(failed, crews)*mu. Switch restoration has its own
    independent resource and exponential rate, explicitly separate from crews.
    """
    if mode not in {"active", "standby"} or switching not in {"independent", "common"}:
        raise ValueError("Choose active/standby and independent/common switching.")
    if any(isinstance(v, bool) or int(v) != v for v in (required, total, repair_crews)) or not 1 <= required <= total <= 60 or not 0 <= repair_crews <= total:
        raise ValueError("Require 1 ≤ required ≤ total ≤ 60 and 0 ≤ crews ≤ total.")
    if (failure_rates is None) != (repair_rates is None) or (mode != "active" and failure_rates is not None):
        raise ValueError("Provide both per-unit failure and repair rates, only for unequal active models.")
    for value in [failure_rate, repair_rate, dormant_rate, switch_repair_rate]:
        if not math.isfinite(value) or value < 0:
            raise ValueError("Rates must be finite and non-negative.")
    if not math.isfinite(coverage) or not 0 <= coverage <= 1:
        raise ValueError("Coverage must be between zero and one.")
    mc = MarkovChain()
    rates = defaultdict(float)
    initial = {}
    notes = []
    if mode == "active" and failure_rates is not None:
        if total > 9 or len(failure_rates) != total or len(repair_rates or []) != total:
            raise ValueError("Unequal active models require one failure/repair rate per unit and at most 9 units.")
        if any(not math.isfinite(x) or x < 0 for x in [*failure_rates, *repair_rates]):
            raise ValueError("Unit rates must be finite and non-negative.")
        for mask in range(2 ** total):
            up = [i for i in range(total) if mask & (1 << i)]
            failed = [i for i in range(total) if i not in up]
            key = f"u{mask}"
            mc.add_state(MarkovState(key, "Up: " + (", ".join(str(i + 1) for i in up) or "none"),
                                    "failed" if len(up) < required else "operational" if len(up) == total else "degraded"))
            for i in up:
                rates[key, f"u{mask & ~(1 << i)}"] += failure_rates[i]
            for i in failed[:repair_crews]:
                rates[key, f"u{mask | (1 << i)}"] += repair_rates[i]
        initial[f"u{2 ** total - 1}"] = 1.
        notes.append("Unequal units: ascending unit number is preemptive repair priority; exponential residual repair times.")
    elif mode == "active":
        for up in range(total, -1, -1):
            key = f"u{up}"
            mc.add_state(MarkovState(key, f"{up} of {total} working",
                                    "failed" if up < required else "operational" if up == total else "degraded"))
            if up:
                rates[key, f"u{up - 1}"] += up * failure_rate
            if up < total:
                rates[key, f"u{up + 1}"] += min(total - up, repair_crews) * repair_rate
        initial[f"u{total}"] = 1.
    else:
        statuses = ("ready", "latent", "down") if switching == "common" else ("ready", "down")
        for up in range(total, -1, -1):
            for status in statuses:
                key = f"u{up}_{status}"
                good = up >= required and status != "down"
                mc.add_state(MarkovState(key, f"{up} healthy; switch {status}",
                                        "failed" if not good else "operational" if up == total else "degraded"))
                active = min(up, required) if status != "down" else 0
                dormant = up - active
                if dormant:
                    rates[key, f"u{up - 1}_{status}"] += dormant * dormant_rate
                if active:
                    rate = active * failure_rate
                    if up > required:
                        p = coverage if switching == "independent" else float(status == "ready")
                        rates[key, f"u{up - 1}_{status}"] += rate * p
                        rates[key, f"u{up - 1}_down"] += rate * (1 - p)
                    else:
                        rates[key, f"u{up - 1}_{status}"] += rate
                if up < total:
                    rates[key, f"u{up + 1}_{status}"] += min(total - up, repair_crews) * repair_rate
                if status == "down":
                    rates[key, f"u{up}_ready"] += switch_repair_rate
        initial[f"u{total}_ready"] = coverage if switching == "common" else 1.
        if switching == "common":
            initial[f"u{total}_latent"] = 1 - coverage
        notes += ["Healthy units are assigned instantly to the required active positions; remaining units accrue dormant hazard.",
                  "After a switch failure all healthy units are dormant until a separate switch-restoration resource restores readiness.",
                  ("Initial switch readiness is one common Bernoulli condition, revealed on the first transfer demand; restored switch is ready."
                   if switching == "common" else "Every required transfer has an independent success probability; a failed transfer causes system downtime.")]
    for (a, b), rate in rates.items():
        if rate > 0:
            mc.add_transition(MarkovTransition(a, b, rate, "combined failure/restoration rate"))
    # Exclude unreachable states, so dormant switch modes do not create
    # spurious closed classes and suppress otherwise valid stationary metrics.
    reachable = {key for key, probability in initial.items() if probability > 0}
    changed = True
    while changed:
        before = len(reachable)
        reachable.update(t.to_state for t in mc.transitions if t.from_state in reachable)
        changed = len(reachable) != before
    compact = MarkovChain([s for s in mc.states if s.id in reachable],
                          [t for t in mc.transitions if t.from_state in reachable])
    initial = {key: value for key, value in initial.items() if value > 0}
    return compact, initial, ["Units start healthy; all times use the project time unit.",
                             "Repair capacity is shared; failures continue in working units during system outages.", *notes]


def redundancy_reference(*, required, total, failure_rate, time, coverage=1., mode="active", switching="independent"):
    """Exact no-repair references for identical exponential components."""
    if failure_rate == 0:
        return {"reliability": 1., "mttf": None, "mean_status": "infinite"}
    if mode == "active":
        r = float(binom.sf(required - 1, total, math.exp(-failure_rate * time)))
        mean = sum(1 / i for i in range(required, total + 1)) / failure_rate
    else:
        x = required * failure_rate * time
        terms = [1. if k == 0 else coverage ** k if switching == "independent" else coverage
                 for k in range(total - required + 1)]
        from scipy.stats import poisson
        r = float(sum(p * poisson.pmf(k, x) for k, p in enumerate(terms)))
        mean = sum(terms) / (required * failure_rate)
    return {"reliability": r, "mttf": mean, "mean_status": "finite",
            "basis": "No repairs, zero dormant hazard, instantaneous transfer. This is a reference, not the repairable model."}
