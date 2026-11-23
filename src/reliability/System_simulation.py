"""Finite-horizon repairable-system discrete-event simulation.

Static RBD/FTA success logic is supplied by SystemStructure. Failure clocks,
repair crews, supplies, PM and unsuccessful restorations share one event
calendar. No sampled durations are clipped and event guards fail explicitly.
"""
from __future__ import annotations

import math
from collections import deque
import numpy as np
from scipy import stats
from reliability.System_renewal import Lifetime


def _mean_interval(values, confidence, *, bounded=False):
    values = np.asarray(values, dtype=float)
    mean = float(values.mean())
    half = float(stats.t.ppf((1 + confidence) / 2, len(values) - 1) * values.std(ddof=1) / math.sqrt(len(values)))
    low, high = mean - half, mean + half
    if bounded:
        low, high = max(0., low), min(1., high)
    return {"mean": mean, "lower": low, "upper": high,
            "method": "independent_replication_student_t_mean_interval"}


def simulate_system(structure, lifetimes, policies, *, horizon, replications=500,
                    warmup=0., repair_crews=1, clock="calendar", seed=42,
                    confidence=.95, max_events=100000, log_limit=1000):
    """Simulate independent component renewal with FIFO repair scheduling.

    Calendar clock: a working component ages even while the system is down.
    Operating clock: all working-component failure clocks pause while the
    system is unsuccessful. PM and supply/repair always use calendar time.
    PM occurs on a fixed calendar grid and is skipped if that component is
    already down; deferred corrective repair is released at its next PM date.
    A spare token is consumed at corrective service start and replenished after
    the specified supply lead time. PM does not consume spare tokens.
    """
    if not math.isfinite(horizon) or horizon <= 0 or not math.isfinite(warmup) or warmup < 0:
        raise ValueError("Horizon must be positive and warm-up nonnegative, in project time units.")
    if clock not in {"calendar", "operating"} or not 0 <= repair_crews <= 64:
        raise ValueError("Choose calendar/operating failure exposure and 0 to 64 repair crews.")
    if not 20 <= replications <= 5000 or not 0 < confidence < 1:
        raise ValueError("Use 20–5000 replications and a confidence level between zero and one.")
    keys = structure.keys
    if set(policies) - set(keys):
        raise ValueError("Maintenance policies reference components absent from this diagram.")
    cfg = {}
    roles = {p.get("crew_role_id") for p in policies.values() if p.get("crew_role_id")}
    if len(roles) > 1:
        raise ValueError("One shared qualified crew pool is supported. Tasks needing different personnel roles require the maintenance-task scheduler.")
    for key in keys:
        p = policies.get(key, {})
        repair = p.get("repair", {"distribution": "exponential", "params": {"mean": 10.}})
        pm = p.get("pm_duration", {"distribution": "deterministic", "params": {"value": 1.}})
        interval = p.get("pm_interval")
        lead = float(p.get("supply_lead_time", 0.))
        yield_ = float(p.get("repair_yield", 1.))
        stock = p.get("spares")
        demand = p.get("crew_demand", 1)
        if not isinstance(demand, int) or not 1 <= demand <= 64:
            raise ValueError("Crew demand must be an integer from 1 to 64.")
        if repair_crews and demand > repair_crews:
            raise ValueError(f"Component {key!r} requires more concurrent personnel than the configured crew pool.")
        if interval is not None and (not math.isfinite(interval) or interval <= 0):
            raise ValueError("PM intervals must be positive or omitted.")
        if lead < 0 or not math.isfinite(lead) or not 0 <= yield_ <= 1:
            raise ValueError("Supply lead times must be nonnegative and repair yield within [0,1].")
        if stock is not None and (int(stock) != stock or stock < 0):
            raise ValueError("Spare stock must be a nonnegative integer or unlimited.")
        if p.get("defer_repair") and interval is None:
            raise ValueError("Deferred repairs require a scheduled PM interval.")
        cfg[key] = {"repair": Lifetime(repair["distribution"], repair.get("params", {}),
                                        condition_positive=repair.get("condition_positive", False)),
                    "pm": Lifetime(pm["distribution"], pm.get("params", {}),
                                    condition_positive=pm.get("condition_positive", False)),
                    "interval": interval, "lead": lead, "yield": yield_, "stock": stock,
                    "defer": bool(p.get("defer_repair", False)), "crew_demand": demand}
    end = warmup + horizon
    grid = np.linspace(warmup, end, 101)
    occupancy = np.zeros(len(grid))
    mission = np.zeros(len(grid))
    avails, outages, criticals, uptimes, all_failures, wait_means, crew_loads = [], [], [], [], [], [], []
    logs, component_failures, component_repairs = [], {k: 0 for k in keys}, {k: 0 for k in keys}
    event_total = 0
    seed_sequence = np.random.SeedSequence(seed)
    for replicate, sequence in enumerate(seed_sequence.spawn(replications)):
        rng = np.random.default_rng(sequence)
        working = {k: True for k in keys}
        remaining = {k: lifetimes[k].sample(rng) for k in keys}
        next_pm = {k: cfg[k]["interval"] if cfg[k]["interval"] else math.inf for k in keys}
        stock = {k: cfg[k]["stock"] for k in keys}
        queue = deque()
        waiting = set()
        repairs = {}  # component -> (finish, corrective?, entered_queue)
        deliveries = []
        t, uptime, busy_time, wait_total, starts = 0., 0., 0., 0., 0
        n_out, n_critical, n_failure = 0, 0, 0
        first_down = None
        grid_index = 0
        step = 0

        def record(event, key):
            if replicate == 0 and len(logs) < log_limit:
                logs.append({"time": t, "event": event, "component": key,
                             "system_up": structure.succeeds(working),
                             "crews_busy": sum(cfg[k]["crew_demand"] for k in repairs), "queue_length": len(queue),
                             "stock": stock.get(key), "measurement_window": t >= warmup})

        def enqueue(key, corrective, release):
            if key in waiting or key in repairs:
                return
            queue.append((key, corrective, release, t))
            waiting.add(key)

        def dispatch():
            nonlocal starts, wait_total
            # Work-conserving FIFO among jobs whose supply/release conditions
            # are satisfied; a stockout does not idle all crews.
            for _ in range(len(queue)):
                key, corrective, release, entered = queue.popleft()
                available = stock[key] is None or stock[key] > 0 or not corrective
                if sum(cfg[k]["crew_demand"] for k in repairs) + cfg[key]["crew_demand"] > repair_crews or release > t or not available:
                    queue.append((key, corrective, release, entered))
                    continue
                waiting.remove(key)
                if corrective and stock[key] is not None:
                    stock[key] -= 1
                    if cfg[key]["lead"] == 0:
                        stock[key] += 1
                    else:
                        deliveries.append((t + cfg[key]["lead"], key))
                duration = cfg[key]["repair" if corrective else "pm"].sample(rng)
                repairs[key] = (t + duration, corrective, entered)
                if t >= warmup:
                    starts += 1
                    wait_total += t - entered
                record("corrective_start" if corrective else "preventive_start", key)

        while t < end:
            up_before = structure.succeeds(working)
            active = {k: working[k] and (clock == "calendar" or up_before) for k in keys}
            failure_times = {k: t + remaining[k] for k in keys if active[k]}
            next_failure = min(failure_times.values(), default=math.inf)
            next_release = min((job[2] for job in queue if job[2] > t), default=math.inf)
            following = min(next_failure, min(next_pm.values()),
                            min((value[0] for value in repairs.values()), default=math.inf),
                            min((value[0] for value in deliveries), default=math.inf), next_release, end)
            if following < t or not math.isfinite(following):
                raise ValueError("Event calendar became invalid.")
            measured = max(0., following - max(t, warmup))
            if up_before:
                uptime += measured
            elif first_down is None and following > warmup:
                first_down = max(t, warmup)
            busy_time += measured * sum(cfg[k]["crew_demand"] for k in repairs)
            while grid_index < len(grid) and grid[grid_index] < following:
                occupancy[grid_index] += up_before
                mission[grid_index] += first_down is None
                grid_index += 1
            delta = following - t
            for key in keys:
                if active[key]:
                    remaining[key] = max(0., remaining[key] - delta)
            t = following
            if t >= end:
                break
            step += 1
            event_total += 1
            if step > max_events or event_total > 2_000_000:
                raise ValueError("Simulation event budget exceeded; reduce horizon/replications or use the Markov model. No partial estimate was returned.")
            # Tie policy: supplies, restorations, PM, failures, then queue
            # dispatch. Evaluate system transitions once after the whole batch.
            delivered = [(time, key) for time, key in deliveries if time <= t]
            deliveries = [(time, key) for time, key in deliveries if time > t]
            for _, key in sorted(delivered):
                stock[key] += 1
                record("supply_arrival", key)
            for key in sorted(k for k, value in repairs.items() if value[0] <= t):
                _, corrective, _ = repairs.pop(key)
                if not corrective or rng.random() < cfg[key]["yield"]:
                    working[key] = True
                    remaining[key] = lifetimes[key].sample(rng)
                    if t >= warmup:
                        component_repairs[key] += 1
                    record("restored", key)
                else:
                    enqueue(key, True, t)
                    record("restoration_unsuccessful", key)
            for key in keys:
                if next_pm[key] <= t:
                    next_pm[key] += cfg[key]["interval"]
                    if working[key]:
                        working[key] = False
                        enqueue(key, False, t)
                        record("preventive_due", key)
            failed_now = []
            up_before_failures = structure.succeeds(working)
            for key in keys:
                if working[key] and failure_times.get(key, math.inf) <= t:
                    working[key] = False
                    failed_now.append(key)
                    if t >= warmup:
                        n_failure += 1
                        component_failures[key] += 1
                    enqueue(key, True, next_pm[key] if cfg[key]["defer"] else t)
                    record("failure", key)
            dispatch()
            up_after = structure.succeeds(working)
            if t >= warmup and up_before and not up_after:
                n_out += 1
                n_critical += bool(failed_now) and up_before_failures
            if t >= warmup and not up_after and first_down is None:
                first_down = t
        final_up = structure.succeeds(working)
        while grid_index < len(grid):
            occupancy[grid_index] += final_up
            mission[grid_index] += first_down is None
            grid_index += 1
        uptimes.append(uptime)
        avails.append(uptime / horizon)
        outages.append(n_out)
        criticals.append(n_critical)
        all_failures.append(n_failure)
        wait_means.append(wait_total / starts if starts else 0.)
        crew_loads.append(busy_time / (horizon * repair_crews) if repair_crews else 0.)
    critical_count = int(sum(criticals))
    total_up = float(sum(uptimes))
    ratio_interval = None
    if critical_count:
        # Paired replication bootstrap preserves uptime/outage correlation.
        rng = np.random.default_rng(np.random.SeedSequence([seed, 0x5EED]))
        samples = []
        for _ in range(1000):
            indices = rng.integers(0, replications, replications)
            count = np.asarray(criticals)[indices].sum()
            if count:
                samples.append(float(np.asarray(uptimes)[indices].sum() / count))
        if len(samples) == 1000:
            tail = (1 - confidence) / 2
            ratio_interval = {"lower": float(np.quantile(samples, tail)), "upper": float(np.quantile(samples, 1 - tail)),
                              "method": "paired_replication_bootstrap_ratio"}
    return {"analysis_basis": "post_warmup_finite_horizon" if warmup else "as_new_finite_horizon",
            "horizon": horizon, "warmup": warmup, "replications": replications, "seed": seed,
            "confidence": confidence, "availability": _mean_interval(avails, confidence, bounded=True),
            "critical_failures": _mean_interval(criticals, confidence),
            "system_outages": _mean_interval(outages, confidence),
            "component_failures": _mean_interval(all_failures, confidence),
            "crew_utilization": _mean_interval(crew_loads, confidence, bounded=True),
            "mean_queue_wait_per_started_job": _mean_interval(wait_means, confidence),
            "mean_operating_time_per_critical_failure": total_up / critical_count if critical_count else None,
            "mean_calendar_time_per_critical_failure": horizon * replications / critical_count if critical_count else None,
            "operating_time_per_critical_failure_interval": ratio_interval,
            "critical_failure_count": critical_count,
            "curve": [{"time": float(t - warmup), "availability": float(a / replications),
                       "uninterrupted_success": float(r / replications)} for t, a, r in zip(grid, occupancy, mission)],
            "components": [{"id": k, "label": structure.labels[k], "failures": component_failures[k],
                            "restorations": component_repairs[k]} for k in keys],
            "events": logs, "event_log_truncated": len(logs) >= log_limit,
            "events_processed": event_total,
            "assumptions": ["All components start as new and working; perfect renewal follows successful corrective or preventive service.",
                "Independent component lifetimes, service durations and restoration outcomes; no hidden common-cause or dynamic-gate clocks.",
                "Failure exposure: " + ("working components age during system outages." if clock == "calendar" else "all working component clocks pause during system outages."),
                "FIFO eligible-job scheduling, nonpreemptive crews; supplies and maintenance use calendar time.",
                "Spare tokens are consumed at corrective service start and replenished after the configured lead time; zero initial stock with no external deliveries prevents repair.",
                "Ties process supplies, repair completion, PM, then failure; system up/down transitions are counted once per event batch.",
                "Measurement window is [warm-up, warm-up + horizon); events exactly at its end are excluded. The last plotted point uses the left limit.",
                "Queue-wait summary averages each replication's mean over jobs started during measurement; a replication without starts contributes zero.",
                "Critical failures require a successful-to-unsuccessful event batch and success immediately before the failure stage; a PM-caused outage is not reclassified as critical by a simultaneous unrelated failure.",
                "Confidence intervals quantify Monte Carlo replication error, not input-parameter uncertainty. Warm-up does not certify stationarity.",
                *(["Explicit positive-time conditioning is applied to the selected life/service models; no negative duration is clipped."]
                  if any(life.condition_positive for life in lifetimes.values()) or any(c["repair"].condition_positive or c["pm"].condition_positive for c in cfg.values()) else [])]}
