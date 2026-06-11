"""System Reliability (RBD) router."""

import sys
from itertools import combinations
from collections import defaultdict
from fastapi import APIRouter, HTTPException
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.SystemReliability import NetworkSystem
from schemas import RBDRequest

router = APIRouter()


def _system_reliability_from_paths(path_sets, comp_reliabilities):
    """Inclusion-exclusion on path sets."""
    n = len(path_sets)
    r_sys = 0.0
    for k in range(1, n + 1):
        sign = (-1) ** (k + 1)
        for combo in combinations(range(n), k):
            components = set()
            for idx in combo:
                components.update(path_sets[idx])
            prob = 1.0
            for c in components:
                prob *= comp_reliabilities[c]
            r_sys += sign * prob
    return max(0.0, min(1.0, r_sys))


def _find_all_paths(adj: dict, start: str, end: str) -> list[list[str]]:
    """DFS to find all simple paths from start to end."""
    paths = []

    def dfs(current, path, visited):
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

    dfs(start, [start], {start})
    return paths


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
            r = (n.data or {}).get("reliability", 0.9)
            try:
                r = float(r)
            except (TypeError, ValueError):
                r = 0.9
            reliabilities[n.id] = max(0.0, min(1.0, r))

    # Find all paths from source to sink
    all_paths = _find_all_paths(adj, source_id, sink_id)
    if not all_paths:
        raise HTTPException(status_code=400,
                            detail="No path found from source to sink.")

    # Strip source/sink from paths, keep only component nodes
    component_index = {cid: i for i, cid in enumerate(component_ids)}
    path_sets = []
    for path in all_paths:
        comp_path = [node for node in path
                     if node in component_index]
        if comp_path:
            path_sets.append([component_index[c] for c in comp_path])

    if not path_sets:
        raise HTTPException(status_code=400,
                            detail="No component paths found between source and sink.")

    comp_reliabilities = [reliabilities[cid] for cid in component_ids]

    try:
        sys_result = NetworkSystem(path_sets, comp_reliabilities)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Rebuild path sets with component labels for display
    labeled_paths = []
    for path in all_paths:
        comp_path = [node_map[node].data.get("label", node)
                     for node in path
                     if node in component_index]
        if comp_path:
            labeled_paths.append(comp_path)

    r_sys = sys_result.reliability
    q_sys = 1.0 - r_sys

    importance = []
    for j, cid in enumerate(component_ids):
        orig_r = comp_reliabilities[j]
        r_perfect = list(comp_reliabilities)
        r_perfect[j] = 1.0
        r_failed = list(comp_reliabilities)
        r_failed[j] = 0.0

        r_sys_1 = _system_reliability_from_paths(path_sets, r_perfect)
        r_sys_0 = _system_reliability_from_paths(path_sets, r_failed)
        birnbaum = r_sys_1 - r_sys_0
        q_sys_0 = 1.0 - r_sys_0
        q_sys_1 = 1.0 - r_sys_1

        importance.append({
            "id": cid,
            "label": (node_map[cid].data or {}).get("label", cid),
            "reliability": orig_r,
            "Birnbaum": round(birnbaum, 6),
            "Criticality": round(birnbaum * orig_r / max(r_sys, 1e-15), 6),
            "RAW": round(q_sys_0 / max(q_sys, 1e-15), 4) if q_sys > 0 else None,
            "RRW": round(q_sys / max(q_sys_1, 1e-15), 4) if q_sys_1 > 0 else None,
        })

    return {
        "system_reliability": round(r_sys, 6),
        "system_unreliability": round(q_sys, 6),
        "path_sets": labeled_paths,
        "components": [
            {
                "id": cid,
                "label": (node_map[cid].data or {}).get("label", cid),
                "reliability": reliabilities[cid],
            }
            for cid in component_ids
        ],
        "importance": importance,
    }
