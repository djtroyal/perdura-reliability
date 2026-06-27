"""Reliability allocation (apportionment).

Top-down distribution of a system reliability / MTBF target across the
subsystems of a *series* system (R_sys = prod(R_i)). Supports the standard
allocation methods used during reliability design:

- equal        : every subsystem gets R_i = R_sys ** (1/n)
- arinc        : split the system failure rate proportional to each
                 subsystem's current/predicted failure rate
- agree        : the AGREE method — allocate by complexity (module count) and
                 importance/utilisation
- feasibility  : feasibility-of-effort — weight by an improvement-difficulty
                 rating (1 = easy to improve ... 10 = very hard)

All methods assume a constant-failure-rate (exponential) series model so that
reliability and failure rate map cleanly: R = exp(-lambda * t), lambda = 1/MTBF.
"""

import math


class AllocationError(ValueError):
    """Raised when inputs are inconsistent with the chosen method."""


def _system_reliability(target_reliability, target_mtbf, mission_time):
    """Resolve the system reliability target at the mission time."""
    if target_reliability is not None:
        if not (0 < target_reliability < 1):
            raise AllocationError("target_reliability must be between 0 and 1.")
        return float(target_reliability)
    if target_mtbf is not None:
        if target_mtbf <= 0:
            raise AllocationError("target_mtbf must be positive.")
        if mission_time <= 0:
            raise AllocationError("mission_time must be positive when using an MTBF target.")
        return math.exp(-mission_time / target_mtbf)
    raise AllocationError("Provide either target_reliability or target_mtbf.")


def _result_row(name, r_i, mission_time):
    """Build an output row from an allocated reliability."""
    r_i = min(max(r_i, 1e-12), 1 - 1e-12)
    lam = -math.log(r_i) / mission_time if mission_time > 0 else None
    mtbf = (1.0 / lam) if (lam and lam > 0) else None
    return {
        "name": name,
        "reliability": r_i,
        "failure_rate": lam,
        "mtbf": mtbf,
    }


def allocate(subsystems, method="equal", target_reliability=None,
             target_mtbf=None, mission_time=1.0):
    """Allocate a system reliability target across subsystems.

    Parameters
    ----------
    subsystems : list[dict]
        Each dict has a ``name`` and method-specific fields:
          - arinc        : ``failure_rate`` (current/predicted, per unit time)
          - agree        : ``complexity`` (module count) and optional
                           ``importance`` (0-1, default 1)
          - feasibility  : ``difficulty`` (1-10, default 5)
    method : str
    target_reliability : float, optional
        System reliability target at ``mission_time``.
    target_mtbf : float, optional
        System MTBF target (converted to reliability via the mission time).
    mission_time : float
        Time at which the reliability target applies.

    Returns
    -------
    dict with ``method``, ``system_reliability`` (target), ``mission_time``,
    ``allocations`` (list of rows) and ``achieved_reliability`` (product check).
    """
    if not subsystems:
        raise AllocationError("Provide at least one subsystem.")
    if mission_time <= 0:
        raise AllocationError("mission_time must be positive.")

    r_sys = _system_reliability(target_reliability, target_mtbf, mission_time)
    n = len(subsystems)
    names = [s.get("name") or f"Subsystem {i + 1}" for i, s in enumerate(subsystems)]
    lam_sys = -math.log(r_sys) / mission_time  # total allowable system failure rate

    rows = []

    if method == "equal":
        r_i = r_sys ** (1.0 / n)
        rows = [_result_row(name, r_i, mission_time) for name in names]

    elif method == "arinc":
        rates = [s.get("failure_rate") for s in subsystems]
        if any(r is None for r in rates):
            raise AllocationError("ARINC requires a failure_rate for every subsystem.")
        if any(r < 0 for r in rates):
            raise AllocationError("failure_rate values must be non-negative.")
        total = sum(rates)
        if total <= 0:
            raise AllocationError("At least one subsystem must have a positive failure_rate.")
        for name, r in zip(names, rates):
            lam_i = (r / total) * lam_sys
            r_i = math.exp(-lam_i * mission_time)
            rows.append(_result_row(name, r_i, mission_time))

    elif method == "agree":
        complexities = [s.get("complexity") for s in subsystems]
        if any(c is None for c in complexities):
            raise AllocationError("AGREE requires a complexity (module count) for every subsystem.")
        if any(c <= 0 for c in complexities):
            raise AllocationError("complexity values must be positive.")
        importances = [s.get("importance", 1.0) or 1.0 for s in subsystems]
        if any(not (0 < w <= 1) for w in importances):
            raise AllocationError("importance values must be in (0, 1].")
        total_n = sum(complexities)
        # AGREE: lambda_i = n_i * (-ln R_sys) / (N * w_i * t_i)
        for name, n_i, w_i in zip(names, complexities, importances):
            lam_i = n_i * (-math.log(r_sys)) / (total_n * w_i * mission_time)
            r_i = math.exp(-lam_i * mission_time)
            rows.append(_result_row(name, r_i, mission_time))

    elif method == "feasibility":
        # Feasibility of effort: a subsystem that is harder to improve (higher
        # difficulty) absorbs a larger share of the allowable failure rate.
        diffs = [s.get("difficulty", 5.0) or 5.0 for s in subsystems]
        if any(not (0 < d <= 10) for d in diffs):
            raise AllocationError("difficulty values must be in (0, 10].")
        total_d = sum(diffs)
        for name, d in zip(names, diffs):
            lam_i = (d / total_d) * lam_sys
            r_i = math.exp(-lam_i * mission_time)
            rows.append(_result_row(name, r_i, mission_time))

    else:
        raise AllocationError(f"Unknown allocation method '{method}'.")

    achieved = 1.0
    for row in rows:
        achieved *= row["reliability"]

    return {
        "method": method,
        "system_reliability": r_sys,
        "mission_time": mission_time,
        "allocations": rows,
        "achieved_reliability": achieved,
    }
