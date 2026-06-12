"""Fault Tree Analysis router."""

import sys
from fastapi import APIRouter, HTTPException
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.FaultTree import BasicEvent, AndGate, OrGate, VoteGate, FaultTree
from schemas import FaultTreeRequest

router = APIRouter()


def _build_tree(node_id: str, node_map: dict, children_map: dict):
    """Recursively build FaultTree node from React Flow graph."""
    node = node_map[node_id]
    ntype = node.type
    data = node.data

    if ntype == "basic":
        prob = float(data.get("probability", 0.01))
        label = data.get("label", node_id)
        return BasicEvent(label, prob)

    child_ids = children_map.get(node_id, [])
    if not child_ids:
        # Leaf gate treated as basic event with p=0
        label = data.get("label", node_id)
        return BasicEvent(label, 0.0)

    children = [_build_tree(cid, node_map, children_map) for cid in child_ids]
    label = data.get("label", node_id)

    if ntype == "and" or ntype == "pand":
        # PAND (Priority AND) has same probability as AND (product of children)
        return AndGate(label, children)
    elif ntype == "or":
        return OrGate(label, children)
    elif ntype == "vote":
        k = int(data.get("k", max(1, len(children) // 2)))
        return VoteGate(label, k, children)
    elif ntype == "xor":
        # XOR: probability that exactly one input fails
        # P = sum_i( P(A_i) * product_{j!=i}(1 - P(A_j)) )
        child_probs = []
        for c in children:
            sub_ft = FaultTree(c)
            child_probs.append(sub_ft.top_event_probability)
        total = 0.0
        for i, pi in enumerate(child_probs):
            prod_others = 1.0
            for j, pj in enumerate(child_probs):
                if j != i:
                    prod_others *= (1.0 - pj)
            total += pi * prod_others
        # Wrap as a BasicEvent with the computed probability
        return BasicEvent(label, min(total, 1.0))
    elif ntype == "not":
        # NOT (Inhibit): P = 1 - P(child), uses only first child
        child = children[0]
        sub_ft = FaultTree(child)
        p = 1.0 - sub_ft.top_event_probability
        return BasicEvent(label, max(p, 0.0))
    elif ntype == "transfer":
        # Transfer: pass-through, probability = child probability
        child = children[0]
        sub_ft = FaultTree(child)
        p = sub_ft.top_event_probability
        return BasicEvent(label, p)
    else:
        return OrGate(label, children)


@router.post("/analyze")
def analyze_fault_tree(req: FaultTreeRequest):
    if not req.nodes:
        raise HTTPException(status_code=400, detail="Fault tree has no nodes.")

    node_map = {n.id: n for n in req.nodes}

    # children_map[parent_id] = [child_id, ...]
    children_map: dict[str, list[str]] = {n.id: [] for n in req.nodes}
    # incoming_count tracks how many parents each node has
    incoming: dict[str, int] = {n.id: 0 for n in req.nodes}

    for edge in req.edges:
        children_map[edge.source].append(edge.target)
        incoming[edge.target] += 1

    # Root = node with no incoming edges
    roots = [nid for nid, cnt in incoming.items() if cnt == 0]
    if not roots:
        raise HTTPException(status_code=400,
                            detail="No root node found (cycle detected?).")
    if len(roots) > 1:
        raise HTTPException(status_code=400,
                            detail=f"Multiple root nodes found: {roots}. Connect them to a single top event.")

    root_id = roots[0]

    try:
        top_event = _build_tree(root_id, node_map, children_map)
        ft = FaultTree(top_event)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Serialize minimal cut sets
    mcs = [sorted(cs) for cs in ft.minimal_cut_sets]
    mcs.sort(key=lambda s: (len(s), s))

    # Importance measures
    try:
        importance = ft.importance_table()
    except Exception:
        importance = {}

    importance_list = [
        {
            "event": name,
            "Birnbaum": round(vals["Birnbaum"], 6),
            "Fussell-Vesely": round(vals["Fussell-Vesely"], 6),
            "RAW": round(vals["RAW"], 6) if vals["RAW"] != float("inf") else None,
            "RRW": round(vals["RRW"], 6) if vals["RRW"] != float("inf") else None,
        }
        for name, vals in importance.items()
    ]
    importance_list.sort(key=lambda r: -r["Birnbaum"])

    return {
        "top_event_probability": round(ft.top_event_probability, 8),
        "minimal_cut_sets": mcs,
        "importance": importance_list,
    }
