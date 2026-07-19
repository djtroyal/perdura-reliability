"""System Reliability (RBD) router."""

import sys
from itertools import combinations
from collections import defaultdict
from fastapi import APIRouter, HTTPException
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.Dependencies import beta_factor_decomposition
from reliability.FaultTree import ExactEvaluationLimitError
from reliability.SystemReliability import (
    NetworkSystem,
    exact_network_reliability,
)
from schemas import RBDRequest, RBDComponentData
from ._probability_models import distribution_cdf


def _compute_reliability(
    data: dict,
    evaluation_time: float | None = None,
    system_mission_time: float | None = None,
) -> float:
    """Compute component reliability from distribution parameters if present.

    Distribution blocks inherit the system evaluation time when they do not
    define a component exposure-time override.  During a system time curve, a
    component override scales exposure relative to the system mission so the
    curve remains anchored at R(0)=1 and reaches the requested component
    exposure at the system mission endpoint.
    """
    model = RBDComponentData.model_validate(data)
    if model.distribution is None:
        return float(model.reliability)
    component_time = model.mission_time
    if evaluation_time is None:
        effective_time = component_time
    elif component_time is not None and system_mission_time is not None:
        effective_time = evaluation_time * component_time / system_mission_time
    else:
        effective_time = evaluation_time
    if effective_time is None:  # guarded by RBDRequest; defensive for direct use
        raise ValueError(
            "distribution life model requires a system mission time or a "
            "component mission-time override"
        )
    return 1.0 - distribution_cdf(
        model.distribution, model.dist_params, effective_time)

router = APIRouter()


# Path sets are presentation output only. Exact probability is evaluated on
# graph connectivity and does not enumerate paths. Cap only the display list.
MAX_DISPLAY_PATHS = 2_000


def _component_key(node) -> str:
    """Stable logical identity shared by mirrored diagram occurrences."""
    value = str((node.data or {}).get("component_key", "")).strip()
    return value or node.id


def _component_model_signature(node) -> tuple:
    """Fields that must agree across occurrences of one logical component."""
    data = node.data or {}
    distribution = data.get("distribution")
    params = data.get("dist_params") or {}
    return (
        distribution,
        tuple(sorted(params.items())),
        None if distribution else data.get("reliability"),
        data.get("mission_time") if distribution else None,
        str(data.get("ccf_group", "")).strip(),
        data.get("ccf_beta") if str(data.get("ccf_group", "")).strip() else None,
    )


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


def _latent_network_model(component_ids, reliabilities, node_map):
    """Build independent and beta-factor survival variables for one mission time."""
    dependency = _prepare_common_cause(component_ids, reliabilities, node_map)
    individual_failures = dependency["individual_failure_probabilities"]
    membership = dependency["membership"]
    common_failures = dependency["common_cause_probabilities"]
    variable_probabilities = {}
    component_requirements = {}
    component_variables = {}
    group_variables = {}
    for component_id in component_ids:
        variable = f"component_survival:{component_id}"
        component_variables[component_id] = variable
        variable_probabilities[variable] = 1.0 - individual_failures[component_id]
        required = {variable}
        group = membership.get(component_id)
        if group is not None:
            group_variable = group_variables.setdefault(
                group, f"common_cause_survival:{group}")
            variable_probabilities[group_variable] = 1.0 - common_failures[group]
            required.add(group_variable)
        component_requirements[component_id] = required
    return {
        "dependency": dependency,
        "variable_probabilities": variable_probabilities,
        "component_requirements": component_requirements,
        "component_variables": component_variables,
        "group_variables": group_variables,
    }


def _rbd_validation(req: RBDRequest) -> list[dict]:
    """Return actionable graph issues before invoking the exact engine."""
    issues: list[dict] = []
    ids = [node.id for node in req.nodes]
    duplicates = sorted({node_id for node_id in ids if ids.count(node_id) > 1})
    for node_id in duplicates:
        issues.append({
            "severity": "error", "code": "DUPLICATE_NODE_ID", "node_id": node_id,
            "message": f"Node ID {node_id!r} is duplicated.",
        })
    node_map = {node.id: node for node in req.nodes}
    sources = [node.id for node in req.nodes if node.type == "source"]
    sinks = [node.id for node in req.nodes if node.type == "sink"]
    components = [node.id for node in req.nodes if node.type == "component"]
    if len(sources) != 1:
        issues.append({
            "severity": "error", "code": "SOURCE_COUNT",
            "message": f"RBD requires exactly one source; found {len(sources)}.",
        })
    if len(sinks) != 1:
        issues.append({
            "severity": "error", "code": "SINK_COUNT",
            "message": f"RBD requires exactly one sink; found {len(sinks)}.",
        })
    if not components:
        issues.append({
            "severity": "error", "code": "NO_COMPONENTS",
            "message": "RBD requires at least one reliability block.",
        })

    logical_components = defaultdict(list)
    for component in (node for node in req.nodes if node.type == "component"):
        logical_components[_component_key(component)].append(component)
    for component_key, occurrences in logical_components.items():
        if not component_key:
            issues.append({
                "severity": "error", "code": "EMPTY_COMPONENT_KEY",
                "message": "A mirrored component has an empty logical identity.",
            })
            continue
        if len(occurrences) <= 1:
            continue
        expected = _component_model_signature(occurrences[0])
        if any(_component_model_signature(node) != expected for node in occurrences[1:]):
            issues.append({
                "severity": "error", "code": "INCONSISTENT_MIRROR_MODEL",
                "node_id": occurrences[0].id,
                "message": (
                    f"Mirrored component {component_key!r} has inconsistent reliability, "
                    "life-model, mission-time, or common-cause definitions."
                ),
            })

    valid_edges = []
    signatures: set[tuple[str, str]] = set()
    for index, edge in enumerate(req.edges):
        edge_id = edge.id or f"connection {index + 1}"
        if edge.source not in node_map or edge.target not in node_map:
            issues.append({
                "severity": "error", "code": "DANGLING_EDGE", "edge_id": edge.id,
                "message": f"{edge_id} references a missing node.",
            })
            continue
        if edge.source == edge.target:
            issues.append({
                "severity": "error", "code": "SELF_LOOP", "node_id": edge.source,
                "message": f"Node {edge.source!r} cannot connect to itself.",
            })
            continue
        signature = (edge.source, edge.target)
        if signature in signatures:
            issues.append({
                "severity": "error", "code": "DUPLICATE_EDGE", "edge_id": edge.id,
                "message": f"Connection {edge.source!r} → {edge.target!r} is duplicated.",
            })
            continue
        signatures.add(signature)
        valid_edges.append(edge)

    outgoing = defaultdict(list)
    incoming = defaultdict(list)
    for edge in valid_edges:
        outgoing[edge.source].append(edge.target)
        incoming[edge.target].append(edge.source)
    for source in sources:
        if incoming[source]:
            issues.append({
                "severity": "error", "code": "SOURCE_HAS_INPUT", "node_id": source,
                "message": "The source terminal cannot have an incoming connection.",
            })
    for sink in sinks:
        if outgoing[sink]:
            issues.append({
                "severity": "error", "code": "SINK_HAS_OUTPUT", "node_id": sink,
                "message": "The sink terminal cannot have an outgoing connection.",
            })
    for component in components:
        if not incoming[component] or not outgoing[component]:
            issues.append({
                "severity": "error", "code": "INCOMPLETE_COMPONENT", "node_id": component,
                "message": (
                    f"Reliability block {node_map[component].data.get('label', component)!r} "
                    "requires both an incoming and outgoing connection."
                ),
            })

    # Kahn's algorithm produces a direct cycle diagnostic without depending on
    # path enumeration or the exact engine's state construction.
    indegree = {node_id: 0 for node_id in node_map}
    for edge in valid_edges:
        indegree[edge.target] += 1
    queue = sorted(node_id for node_id, degree in indegree.items() if degree == 0)
    visited = []
    while queue:
        current = queue.pop(0)
        visited.append(current)
        for neighbor in outgoing[current]:
            indegree[neighbor] -= 1
            if indegree[neighbor] == 0:
                queue.append(neighbor)
                queue.sort()
    if len(visited) != len(node_map):
        cycle_nodes = sorted(set(node_map) - set(visited))
        issues.append({
            "severity": "error", "code": "CAUSAL_CYCLE",
            "message": (
                "RBD contains a directed cycle involving " + ", ".join(cycle_nodes)
                + "; repair/feedback behavior belongs in Markov Analysis."
            ),
        })

    if len(sources) == 1 and len(sinks) == 1:
        source, sink = sources[0], sinks[0]
        reachable = {source}
        stack = [source]
        while stack:
            current = stack.pop()
            for neighbor in outgoing[current]:
                if neighbor not in reachable:
                    reachable.add(neighbor); stack.append(neighbor)
        can_reach_sink = {sink}
        stack = [sink]
        while stack:
            current = stack.pop()
            for parent in incoming[current]:
                if parent not in can_reach_sink:
                    can_reach_sink.add(parent); stack.append(parent)
        if sink not in reachable:
            issues.append({
                "severity": "error", "code": "NO_SUCCESS_PATH",
                "message": "No directed success path connects the source to the sink.",
            })
        for component in components:
            if component not in reachable or component not in can_reach_sink:
                issues.append({
                    "severity": "error", "code": "OFF_PATH_COMPONENT", "node_id": component,
                    "message": (
                        f"Reliability block {node_map[component].data.get('label', component)!r} "
                        "is not on a complete source-to-sink path."
                    ),
                })
        if sink in outgoing[source]:
            issues.append({
                "severity": "warning", "code": "PERFECT_BYPASS",
                "message": (
                    "A direct source-to-sink connection bypasses every reliability block "
                    "and therefore makes system reliability equal to one."
                ),
            })
    return issues


@router.post("/rbd/validate")
def validate_rbd(req: RBDRequest):
    issues = _rbd_validation(req)
    return {
        "valid": not any(issue["severity"] == "error" for issue in issues),
        "issues": issues,
        "summary": {
            "nodes": len(req.nodes),
            "components": sum(node.type == "component" for node in req.nodes),
            "connections": len(req.edges),
        },
    }


@router.post("/rbd")
def compute_rbd(req: RBDRequest):
    validation_issues = _rbd_validation(req)
    blocking = [issue for issue in validation_issues if issue["severity"] == "error"]
    if blocking:
        raise HTTPException(status_code=400, detail={
            "code": "RBD_VALIDATION",
            "message": f"RBD has {len(blocking)} blocking model issue(s).",
            "issues": validation_issues,
        })
    # Build adjacency list
    adj = defaultdict(list)
    for edge in req.edges:
        adj[edge.source].append(edge.target)

    # Find source and sink nodes
    node_map = {n.id: n for n in req.nodes}
    source_ids = [n.id for n in req.nodes if n.type == "source"]
    sink_ids = [n.id for n in req.nodes if n.type == "sink"]
    component_ids = [n.id for n in req.nodes if n.type == "component"]
    component_keys = {component_id: _component_key(node_map[component_id])
                      for component_id in component_ids}
    logical_members = defaultdict(list)
    for component_id, component_key in component_keys.items():
        logical_members[component_key].append(component_id)
    logical_ids = list(logical_members)
    logical_node_map = {
        component_key: node_map[members[0]]
        for component_key, members in logical_members.items()
    }

    source_id = source_ids[0]
    sink_id = sink_ids[0]

    # Build component reliability map
    reliabilities = {
        component_key: _compute_reliability(
            logical_node_map[component_key].data or {},
            req.mission_time,
            req.mission_time,
        )
        for component_key in logical_ids
    }

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
        latent = _latent_network_model(
            logical_ids, reliabilities, logical_node_map)
        dependency = latent["dependency"]
        variable_probabilities = latent["variable_probabilities"]
        logical_requirements = latent["component_requirements"]
        component_requirements = {
            component_id: logical_requirements[component_keys[component_id]]
            for component_id in component_ids
        }
        component_variables = latent["component_variables"]
        group_variables = latent["group_variables"]

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
    for cid in logical_ids:
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
            "node_ids": logical_members[cid],
            "occurrences": len(logical_members[cid]),
            "label": (logical_node_map[cid].data or {}).get("label", cid),
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

    time_curve = []
    restricted_mean_survival_time = None
    nonparametric_components = [
        component_id for component_id in logical_ids
        if not bool((logical_node_map[component_id].data or {}).get("distribution"))
    ]
    all_parametric = not nonparametric_components
    if req.mission_time is None and nonparametric_components:
        curve_reason = (
            "Set a system mission time and assign a life distribution to every "
            "block to calculate R(t)."
        )
    elif req.mission_time is None:
        curve_reason = "Set a system mission time to calculate R(t)."
    elif nonparametric_components:
        labels = [
            str((logical_node_map[component_id].data or {}).get("label", component_id))
            for component_id in nonparametric_components
        ]
        curve_reason = (
            f"System mission time t = {req.mission_time:g} is active and inherited by "
            "parametric blocks. Assign a life distribution to "
            f"{', '.join(labels)}; fixed-probability and linked-analysis blocks provide "
            "only a mission-point reliability and cannot define R(t)."
        )
    else:
        curve_reason = None
    if req.mission_time is not None and all_parametric:
        for time in np.linspace(0.0, req.mission_time, req.time_points):
            point_reliabilities = {
                component_id: _compute_reliability(
                    logical_node_map[component_id].data or {},
                    float(time),
                    req.mission_time,
                )
                for component_id in logical_ids
            }
            point_latent = _latent_network_model(
                logical_ids, point_reliabilities, logical_node_map)
            point_requirements = {
                component_id: point_latent["component_requirements"][
                    component_keys[component_id]]
                for component_id in component_ids
            }
            point_reliability = exact_network_reliability(
                adj,
                source_id,
                sink_id,
                point_requirements,
                point_latent["variable_probabilities"],
            )
            time_curve.append({
                "time": float(time),
                "reliability": float(point_reliability),
                "unreliability": float(1.0 - point_reliability),
            })
        restricted_mean_survival_time = float(np.trapezoid(
            [point["reliability"] for point in time_curve],
            [point["time"] for point in time_curve],
        ))

    return {
        "system_reliability": round(r_sys, 6),
        "system_unreliability": round(q_sys, 6),
        "path_sets": labeled_paths,
        # Stable diagram identities accompany display labels so the client can
        # highlight one exact success path even when labels are duplicated or
        # a logical component has mirrored occurrences.
        "path_node_ids": display_component_paths,
        "path_sets_truncated": paths_truncated,
        "display_path_limit": MAX_DISPLAY_PATHS,
        "components": [
            {
                "id": cid,
                "component_key": component_keys[cid],
                "mirrored": len(logical_members[component_keys[cid]]) > 1,
                "label": (node_map[cid].data or {}).get("label", cid),
                "reliability": reliabilities[component_keys[cid]],
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
        "assumptions": [
            dependency_diagnostics["assumption"],
            "Blocks are nonrepairable during the modeled mission; repair and feedback require Markov Analysis.",
        ],
        "warnings": [
            issue["message"] for issue in validation_issues
            if issue["severity"] == "warning"
        ],
        "mission_time": req.mission_time,
        "time_curve": time_curve,
        "time_curve_unavailable_reason": curve_reason,
        "restricted_mean_survival_time": restricted_mean_survival_time,
        "formulas": [
            {
                "label": "Series path",
                "latex": r"R_{\mathrm{series}}=\prod_i R_i",
                "description": "Every block on a series path must survive.",
            },
            {
                "label": "Parallel alternatives",
                "latex": r"R_{\mathrm{parallel}}=1-\prod_i(1-R_i)",
                "description": "At least one independent parallel path must survive.",
            },
            {
                "label": "Exact network",
                "latex": r"R_{\mathrm{sys}}=\Pr\{\text{a functioning source-to-sink path exists}\}",
                "description": "Perdura evaluates this connectivity event with a reduced ordered BDD.",
            },
            {
                "label": "Birnbaum importance",
                "latex": r"I_B(i)=R_{\mathrm{sys}}(X_i=1)-R_{\mathrm{sys}}(X_i=0)",
                "description": "The system-reliability change when one modeled survival variable is toggled.",
            },
        ],
        "computation": {
            **exact_diagnostics,
            "display_paths_returned": len(labeled_paths),
            "display_paths_truncated": paths_truncated,
        },
    }
