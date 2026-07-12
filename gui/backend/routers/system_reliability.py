"""System Reliability (RBD) router."""

import sys
from itertools import combinations
from collections import defaultdict
from fastapi import APIRouter, HTTPException
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.Dependencies import beta_factor_decomposition
from reliability.FaultTree import ExactEvaluationLimitError
from reliability.SystemReliability import (
    NetworkSystem,
    exact_network_reliability,
)
from schemas import RBDRequest, RBDComponentData
from ._probability_models import distribution_cdf


def _compute_reliability(data: dict) -> float:
    """Compute component reliability from distribution parameters if present.

    If the node data includes ``distribution``, ``dist_params``, and
    ``mission_time``, reliability is computed as SF(t) = 1 - CDF(t).
    Otherwise, the raw ``reliability`` field is used.
    """
    model = RBDComponentData.model_validate(data)
    if model.distribution is None:
        return float(model.reliability)
    return 1.0 - distribution_cdf(
        model.distribution, model.dist_params, model.mission_time)

router = APIRouter()


# Path sets are presentation output only. Exact probability is evaluated on
# graph connectivity and does not enumerate paths. Cap only the display list.
MAX_DISPLAY_PATHS = 2_000


def _iex_terms(path_sets):
    """Precompute the inclusion-exclusion terms (sign, component tuple) once.

    The subset enumeration is the expensive part (2^n_paths); the importance
    loop then re-evaluates the polynomial 2x per component with different
    reliabilities, which only needs the products."""
    n = len(path_sets)
    terms = []
    for k in range(1, n + 1):
        sign = (-1) ** (k + 1)
        for combo in combinations(range(n), k):
            components = set()
            for idx in combo:
                components.update(path_sets[idx])
            terms.append((sign, tuple(components)))
    return terms


def _reliability_from_terms(terms, comp_reliabilities):
    """Evaluate the precomputed inclusion-exclusion polynomial."""
    r_sys = 0.0
    for sign, components in terms:
        prob = 1.0
        for c in components:
            prob *= comp_reliabilities[c]
        r_sys += sign * prob
    return max(0.0, min(1.0, r_sys))


def _system_reliability_from_paths(path_sets, comp_reliabilities):
    """Inclusion-exclusion on path sets (one-shot convenience wrapper)."""
    return _reliability_from_terms(_iex_terms(path_sets), comp_reliabilities)


def _find_all_paths(adj: dict, start: str, end: str,
                    max_paths=MAX_DISPLAY_PATHS):
    """Return up to ``max_paths`` simple paths for display, plus truncation."""
    paths = []
    truncated = False

    def dfs(current, path, visited):
        nonlocal truncated
        if len(paths) >= max_paths:
            truncated = True
            return
        if current == end:
            paths.append(list(path))
            return
        for neighbor in adj.get(current, []):
            if neighbor not in visited:
                visited.add(neighbor)
                path.append(neighbor)
                dfs(neighbor, path, visited)
                path.pop()
                visited.discard(neighbor)
                if truncated:
                    return

    dfs(start, [start], {start})
    return paths, truncated


def _prepare_common_cause(component_ids, reliabilities, node_map):
    failures = {cid: 1.0 - reliabilities[cid] for cid in component_ids}
    assignments = {}
    for cid in component_ids:
        data = node_map[cid].data or {}
        group = str(data.get("ccf_group", "")).strip()
        if group:
            assignments[cid] = {
                "group": group,
                "beta": data.get("ccf_beta", 0.1),
            }
    return beta_factor_decomposition(failures, assignments)


@router.post("/rbd")
def compute_rbd(req: RBDRequest):
    # Build adjacency list
    adj = defaultdict(list)
    for edge in req.edges:
        adj[edge.source].append(edge.target)

    # Find source and sink nodes
    node_map = {n.id: n for n in req.nodes}
    source_ids = [n.id for n in req.nodes if n.type == "source"]
    sink_ids = [n.id for n in req.nodes if n.type == "sink"]
    component_ids = [n.id for n in req.nodes if n.type == "component"]

    if not source_ids or not sink_ids:
        raise HTTPException(status_code=400,
                            detail="RBD must have at least one source and one sink node.")

    if not component_ids:
        raise HTTPException(status_code=400, detail="RBD must have at least one component.")

    source_id = source_ids[0]
    sink_id = sink_ids[0]

    # Build component reliability map
    reliabilities = {}
    for n in req.nodes:
        if n.type == "component":
            reliabilities[n.id] = _compute_reliability(n.data or {})

    # Enumerate a bounded path list only for display. Exact reliability below
    # operates directly on graph connectivity, so its complexity is not tied
    # to the number of source-to-sink paths.
    all_paths, paths_truncated = _find_all_paths(adj, source_id, sink_id)
    if not all_paths:
        raise HTTPException(status_code=400,
                            detail="No path found from source to sink.")

    component_set = set(component_ids)
    display_component_paths = [
        [node for node in path if node in component_set]
        for path in all_paths
    ]
    display_component_paths = [path for path in display_component_paths if path]
    if not display_component_paths:
        raise HTTPException(status_code=400,
                            detail="No component paths found between source and sink.")

    try:
        dependency = _prepare_common_cause(
            component_ids, reliabilities, node_map)

        individual_failures = dependency["individual_failure_probabilities"]
        membership = dependency["membership"]
        common_failures = dependency["common_cause_probabilities"]

        variable_probabilities = {}
        component_requirements = {}
        component_variables = {}
        group_variables = {}

        for cid in component_ids:
            variable = f"component_survival:{cid}"
            component_variables[cid] = variable
            variable_probabilities[variable] = 1.0 - individual_failures[cid]
            required = {variable}
            group = membership.get(cid)
            if group is not None:
                group_variable = group_variables.setdefault(
                    group, f"common_cause_survival:{group}")
                variable_probabilities[group_variable] = 1.0 - common_failures[group]
                required.add(group_variable)
            component_requirements[cid] = required

        r_sys, exact_diagnostics = exact_network_reliability(
            adj,
            source_id,
            sink_id,
            component_requirements,
            variable_probabilities,
            return_diagnostics=True,
        )
    except ExactEvaluationLimitError as e:
        raise HTTPException(
            status_code=422,
            detail={"code": "RBD_EXACT_LIMIT", "message": str(e)},
        ) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

    # Rebuild path sets with component labels for display
    labeled_paths = []
    for path in display_component_paths:
        comp_path = [(node_map[node].data or {}).get("label", node)
                     for node in path]
        if comp_path:
            labeled_paths.append(comp_path)

    q_sys = 1.0 - r_sys

    def evaluate(changes):
        probabilities = dict(variable_probabilities)
        probabilities.update(changes)
        return exact_network_reliability(
            adj,
            source_id,
            sink_id,
            component_requirements,
            probabilities,
        )

    importance = []
    for cid in component_ids:
        orig_r = reliabilities[cid]
        variable = component_variables[cid]
        modeled_r = variable_probabilities[variable]
        r_sys_1 = evaluate({variable: 1.0})
        r_sys_0 = evaluate({variable: 0.0})
        birnbaum = r_sys_1 - r_sys_0
        q_sys_0 = 1.0 - r_sys_0
        q_sys_1 = 1.0 - r_sys_1

        # Standard failure criticality uses component and system
        # *unreliability*.  Birnbaum * R_i / R_sys is instead a success-side
        # contribution and must not be labelled criticality importance.
        criticality = birnbaum * (1.0 - modeled_r) / q_sys if q_sys > 0 else None
        rrw_unbounded = q_sys > 0 and q_sys_1 <= 1e-15

        importance.append({
            "id": cid,
            "label": (node_map[cid].data or {}).get("label", cid),
            "reliability": orig_r,
            "modeled_variable_reliability": modeled_r,
            "kind": "component_specific",
            "Birnbaum": round(birnbaum, 6),
            "Criticality": round(criticality, 6) if criticality is not None else None,
            "RAW": round(q_sys_0 / max(q_sys, 1e-15), 4) if q_sys > 0 else None,
            "RRW": round(q_sys / max(q_sys_1, 1e-15), 4) if q_sys_1 > 0 else None,
            "RRW_unbounded": rrw_unbounded,
        })

    for group in sorted(group_variables):
        variable = group_variables[group]
        modeled_r = variable_probabilities[variable]
        r_sys_1 = evaluate({variable: 1.0})
        r_sys_0 = evaluate({variable: 0.0})
        birnbaum = r_sys_1 - r_sys_0
        q_sys_0 = 1.0 - r_sys_0
        q_sys_1 = 1.0 - r_sys_1
        criticality = birnbaum * (1.0 - modeled_r) / q_sys if q_sys > 0 else None
        importance.append({
            "id": f"ccf:{group}",
            "label": f"CCF[{group}]",
            "reliability": modeled_r,
            "modeled_variable_reliability": modeled_r,
            "kind": "common_cause_survival",
            "Birnbaum": round(birnbaum, 6),
            "Criticality": round(criticality, 6) if criticality is not None else None,
            "RAW": round(q_sys_0 / max(q_sys, 1e-15), 4) if q_sys > 0 else None,
            "RRW": round(q_sys / max(q_sys_1, 1e-15), 4) if q_sys_1 > 0 else None,
            "RRW_unbounded": q_sys > 0 and q_sys_1 <= 1e-15,
        })

    dependency_diagnostics = dependency["diagnostics"]

    return {
        "system_reliability": round(r_sys, 6),
        "system_unreliability": round(q_sys, 6),
        "path_sets": labeled_paths,
        "path_sets_truncated": paths_truncated,
        "display_path_limit": MAX_DISPLAY_PATHS,
        "components": [
            {
                "id": cid,
                "label": (node_map[cid].data or {}).get("label", cid),
                "reliability": reliabilities[cid],
            }
            for cid in component_ids
        ],
        "importance": importance,
        "importance_definitions": {
            "Birnbaum": "R_system(latent success variable=1) - R_system(latent success variable=0)",
            "Criticality": "Birnbaum * latent-variable failure probability / system unreliability",
            "RAW": "Q_system(latent success variable=0) / Q_system",
            "RRW": "Q_system / Q_system(latent success variable=1)",
        },
        "dependency_model": dependency_diagnostics,
        "assumptions": [dependency_diagnostics["assumption"]],
        "computation": {
            **exact_diagnostics,
            "display_paths_returned": len(labeled_paths),
            "display_paths_truncated": paths_truncated,
        },
    }
