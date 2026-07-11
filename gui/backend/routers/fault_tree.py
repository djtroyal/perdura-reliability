"""Fault Tree Analysis router."""

import sys
import math
from fastapi import APIRouter, HTTPException
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.FaultTree import (
    BasicEvent, AndGate, OrGate, VoteGate, FaultTree,
    ExactEvaluationLimitError, exact_probability_from_cut_sets,
)
from reliability.Dependencies import beta_factor_decomposition
from schemas import FaultTreeRequest, FaultTreeGraph, FTNode, FTEdge

router = APIRouter()


def _sanitize(x):
    """Replace non-finite floats with None so JSON serialization never emits
    NaN/Infinity (which are invalid JSON and break the frontend)."""
    if isinstance(x, float):
        if not math.isfinite(x):
            return None
        return x
    if isinstance(x, dict):
        return {k: _sanitize(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_sanitize(v) for v in x]
    return x


def _compute_probability(data: dict, global_t=None) -> float:
    """Compute event probability from distribution parameters if present.

    The exposure time is the event's own ``exposure_time`` override when
    present, otherwise the tree-wide ``global_t``.
    """
    dist = data.get("distribution")
    dist_params = data.get("dist_params")
    t = data.get("exposure_time")
    if t is None:
        t = global_t
    if not dist or not dist_params or t is None:
        return float(data.get("probability", 0.01))
    t = float(t)
    if t <= 0 and dist != "normal":
        return 0.0
    try:
        if dist == "exponential":
            lam = float(dist_params.get("lambda", 0.001))
            return 1 - math.exp(-lam * t)
        elif dist == "weibull":
            alpha = float(dist_params.get("alpha", 1000))
            beta = float(dist_params.get("beta", 1.5))
            if alpha <= 0 or beta <= 0:
                return 0.0
            return 1 - math.exp(-((t / alpha) ** beta))
        elif dist == "normal":
            mu = float(dist_params.get("mu", 1000))
            sigma = float(dist_params.get("sigma", 200))
            return 0.5 * (1 + math.erf((t - mu) / (sigma * math.sqrt(2))))
        elif dist == "lognormal":
            if t <= 0:
                return 0.0
            mu = float(dist_params.get("mu", 6.9))
            sigma = float(dist_params.get("sigma", 0.5))
            return 0.5 * (1 + math.erf((math.log(t) - mu) / (sigma * math.sqrt(2))))
    except (ValueError, OverflowError):
        pass
    return float(data.get("probability", 0.01))


def _event_key(node_id: str, data: dict) -> str:
    """Identity used to decide whether two basic-event nodes are the *same*
    underlying event (#8). A mirrored/repeated event carries an explicit
    ``eventKey``; otherwise the node falls back to its label, then its id.

    Events spliced in from a referenced tree via a Transfer gate carry a
    namespace prefix (``_ns``) so their independently-numbered ids/labels can
    not accidentally collide with — and be merged into — the parent tree's
    events. Intentional mirrors *within* the same (sub)tree share the same
    namespace, so they still resolve to a single identity (#1)."""
    ns = str(data.get("_ns", ""))
    ek = data.get("eventKey")
    if ek:
        return ns + str(ek)
    label = data.get("label")
    if label:
        return ns + str(label)
    return node_id


def _event_display(node_id: str, data: dict) -> str:
    """Human-readable name for a basic event in cut sets / formulae. Primary-
    tree events keep their bare identity (so the frontend's MCS highlighting,
    which matches eventKey/label/id, still works). Events pulled in through a
    Transfer gate are prefixed with their referenced-tree provenance (#1)."""
    ns_label = str(data.get("_ns_label", ""))
    if not ns_label:
        return _event_key(node_id, data)
    base = data.get("label") or data.get("eventKey") or node_id
    return ns_label + str(base)


def _prepare_common_cause(node_map: dict, global_t=None):
    """Build an exact latent-event beta-factor representation.

    Basic nodes opt in with ``ccf_group`` and ``ccf_beta`` in their data.
    Transfer-tree namespaces are applied to group ids just as they are to
    repeated-event ids, preventing accidental coupling between folios.
    """
    probabilities = {}
    assignments = {}
    signatures = {}
    group_display = {}

    for node_id, node in node_map.items():
        if node.type != "basic":
            continue
        data = node.data
        key = _event_key(node_id, data)
        probability = _compute_probability(data, global_t)
        raw_group = str(data.get("ccf_group", "")).strip()
        beta_raw = data.get("ccf_beta", 0.1) if raw_group else None
        try:
            beta = float(beta_raw) if raw_group else None
        except (TypeError, ValueError) as exc:
            raise ValueError(
                f"Common-cause event {key!r} requires a numeric beta factor."
            ) from exc
        namespace = str(data.get("_ns", ""))
        group = namespace + raw_group if raw_group else None
        signature = (probability, group, beta)

        if key in probabilities:
            previous = signatures[key]
            same_probability = math.isclose(
                probability, previous[0], rel_tol=1e-12, abs_tol=1e-15
            )
            if (not same_probability or group != previous[1]
                    or beta_raw != previous[2]):
                raise ValueError(
                    f"Repeated event {key!r} has inconsistent probability or "
                    "common-cause settings across its mirror nodes."
                )
            continue

        probabilities[key] = probability
        signatures[key] = signature
        if group:
            assignments[key] = {"group": group, "beta": beta}
            namespace_label = str(data.get("_ns_label", ""))
            group_display[group] = (
                f"{namespace_label}{raw_group}" if namespace_label else raw_group
            )

    decomposition = beta_factor_decomposition(probabilities, assignments)
    decomposition["group_display"] = group_display
    return decomposition


def _expand_transfers(graph: FaultTreeGraph, trees: dict,
                      tree_id, visiting: frozenset):
    """Inline Transfer gates by splicing the referenced tree's nodes/edges into
    this graph (#9). Returns (nodes, edges, children_map). Detects cycles via
    the ``visiting`` set of tree ids currently on the expansion stack."""
    # Work on copies, prefixing referenced-tree node ids to keep them unique.
    nodes = {n.id: n for n in graph.nodes}
    edges = [(e.source, e.target) for e in graph.edges]
    # Tree ids currently on the expansion stack (this tree + all ancestors).
    stack = visiting | ({tree_id} if tree_id else frozenset())

    for node in list(graph.nodes):
        if node.type != "transfer":
            continue
        ref = node.data.get("transferTo") or node.data.get("ref_tree")
        if not ref:
            continue  # unconnected / unconfigured transfer -> leaf (p=0)
        ref = str(ref)
        if ref in stack:
            raise HTTPException(
                status_code=400,
                detail=f"Transfer-gate cycle detected involving tree '{ref}'.")
        sub = trees.get(ref)
        if sub is None:
            raise HTTPException(
                status_code=400,
                detail=f"Transfer gate references unknown tree '{ref}'.")
        # Recursively expand the referenced tree first.
        sub_nodes, sub_edges, _ = _expand_transfers(sub, trees, ref, stack)
        # Find the referenced tree's root (no incoming edge).
        incoming = {nid: 0 for nid in sub_nodes}
        for s, t in sub_edges:
            if t in incoming:
                incoming[t] += 1
        roots = [nid for nid, c in incoming.items() if c == 0]
        if len(roots) != 1:
            raise HTTPException(
                status_code=400,
                detail=f"Referenced tree '{ref}' must have exactly one root.")
        sub_root = roots[0]
        prefix = f"__xfer_{node.id}__"
        # Readable provenance for the referenced tree, shown in cut sets (#1).
        xfer_label = str(node.data.get("transferToName")
                         or node.data.get("label") or ref)
        # Splice prefixed sub-nodes in, then connect the transfer node to the
        # prefixed sub-root so the transfer becomes a pass-through. Each spliced
        # node accumulates a namespace (``_ns``) that keeps its event identity
        # distinct from the parent tree, plus a readable label chain
        # (``_ns_label``) used when presenting cut sets / formulae (#1).
        for snid, sn in sub_nodes.items():
            nd = dict(sn.data)
            nd["_ns"] = prefix + str(sn.data.get("_ns", ""))
            nd["_ns_label"] = xfer_label + " › " + str(sn.data.get("_ns_label", ""))
            nodes[prefix + snid] = FTNode(
                id=prefix + snid, type=sn.type, data=nd)
        for s, t in sub_edges:
            edges.append((prefix + s, prefix + t))
        edges.append((node.id, prefix + sub_root))

    children_map: dict[str, list[str]] = {nid: [] for nid in nodes}
    for s, t in edges:
        if s in children_map:
            children_map[s].append(t)
    return nodes, edges, children_map


def _build_tree(node_id: str, node_map: dict, children_map: dict,
                event_cache: dict, display_map: dict, global_t=None,
                dependency=None, common_event_cache=None):
    """Recursively build a FaultTree node graph from the (transfer-expanded)
    React Flow graph. ``event_cache`` maps a basic event's *eventKey* to its
    logical event node so repeated/mirror events are a single object with
    correct cut-set semantics (#8). ``display_map`` records the readable name
    for each event key (used when presenting cut sets / formulae)."""
    node = node_map[node_id]
    ntype = node.type
    data = node.data

    if ntype == "basic":
        key = _event_key(node_id, data)
        if key in event_cache:
            return event_cache[key]
        if dependency is None:
            prob = _compute_probability(data, global_t)
            group = None
        else:
            prob = dependency["individual_failure_probabilities"][key]
            group = dependency["membership"].get(key)
        ev = BasicEvent(key, prob)
        display_map[key] = _event_display(node_id, data)
        if group is not None:
            if common_event_cache is None:
                common_event_cache = {}
            common_name = f"__ccf__:{group}"
            common = common_event_cache.get(group)
            if common is None:
                common = BasicEvent(
                    common_name,
                    dependency["common_cause_probabilities"][group],
                )
                common_event_cache[group] = common
                group_label = dependency.get("group_display", {}).get(group, group)
                display_map[common_name] = f"CCF[{group_label}]"
            ev = OrGate(f"{key} with common cause", [ev, common])
        event_cache[key] = ev
        return ev

    child_ids = children_map.get(node_id, [])
    if not child_ids:
        label = str(data.get("label", node_id))
        return BasicEvent(label, 0.0)

    children = [_build_tree(cid, node_map, children_map, event_cache,
                            display_map, global_t, dependency,
                            common_event_cache)
                for cid in child_ids]
    label = str(data.get("label", node_id))

    if ntype == "and":
        return AndGate(label, children)
    elif ntype == "or":
        return OrGate(label, children)
    elif ntype == "vote":
        k = int(data.get("k", max(1, len(children) // 2)))
        return VoteGate(label, k, children)
    elif ntype == "transfer":
        # Pass-through after expansion: return the spliced sub-tree root
        # directly so its cut sets/structure propagate up (#9).
        return children[0]
    else:
        return OrGate(label, children)


# ---------------------------------------------------------------------------
# Formulas (#6) and calculation methods (#7)
# ---------------------------------------------------------------------------

def _boolean_expression(node, disp, depth=0):
    """Boolean structure-function expression of the tree in terms of basic
    events, e.g. ``(A AND B) OR C``. ``disp`` maps an event key to its readable
    name."""
    if isinstance(node, BasicEvent):
        return disp(node.name)
    op = {"AndGate": " AND ", "OrGate": " OR "}.get(type(node).__name__)
    if isinstance(node, VoteGate):
        inner = ", ".join(_boolean_expression(c, disp, depth + 1) for c in node.inputs)
        return f"{node.k}-of-N({inner})"
    if op is None:
        return disp(node.name)
    inner = op.join(_boolean_expression(c, disp, depth + 1) for c in node.inputs)
    return f"({inner})" if depth > 0 else inner


def _mcs_formulas(mcs_list, events, disp):
    """For each minimal cut set, a product formula string and its value.
    Probabilities are computed on the internal event keys; the displayed names
    use ``disp`` (so transferred events show their readable provenance)."""
    out = []
    for cs in mcs_list:
        keys = sorted(cs)
        names = [disp(k) for k in keys]
        terms = " * ".join(f"P({n})" for n in names)
        val = 1.0
        for k in keys:
            val *= events[k].probability if k in events else 0.0
        out.append({
            "events": names,
            "formula": terms,
            "value": val,
        })
    return out


def _method_probabilities(mcs_list, events, methods):
    """Compute top-event probability under each requested method (#7).

    - exact: BDD evaluation of the minimal-cut-set union (correct even with
      repeated events shared across cut sets).
    - rare_event: sum of minimal-cut-set probabilities.
    - min_cut_upper_bound: 1 - prod(1 - P(MCS_i)).
    """
    def mcs_prob(cs):
        p = 1.0
        for n in cs:
            p *= events[n].probability if n in events else 0.0
        return p

    mcs_p = [mcs_prob(cs) for cs in mcs_list]
    results = {}
    diagnostics = None

    if "rare_event" in methods:
        results["rare_event"] = sum(mcs_p)

    if "min_cut_upper_bound" in methods:
        prod = 1.0
        for p in mcs_p:
            prod *= (1.0 - p)
        results["min_cut_upper_bound"] = 1.0 - prod

    if "exact" in methods:
        results["exact"], diagnostics = exact_probability_from_cut_sets(
            mcs_list, events, return_diagnostics=True)

    return results, diagnostics


def _simulate_top_event(ft_obj, n_simulations: int, seed=None) -> dict:
    """Monte Carlo simulation using the library's gate-logic evaluator.
    Returns dict with probability, std_error, ci_lower, ci_upper, n_samples."""
    return ft_obj.monte_carlo_simulation(n_samples=n_simulations, seed=seed)


@router.post("/analyze")
def analyze_fault_tree(req: FaultTreeRequest):
    if not req.nodes:
        raise HTTPException(status_code=400, detail="Fault tree has no nodes.")

    methods = req.methods or ["exact"]
    valid_methods = {"exact", "rare_event", "min_cut_upper_bound", "simulation"}
    methods = [m for m in methods if m in valid_methods] or ["exact"]

    trees = {k: v for k, v in (req.trees or {}).items()}

    primary = FaultTreeGraph(nodes=req.nodes, edges=req.edges)
    try:
        node_map, edges, children_map = _expand_transfers(
            primary, trees, req.tree_id, frozenset())
    except HTTPException:
        raise
    except ExactEvaluationLimitError as e:
        raise HTTPException(
            status_code=422,
            detail={"code": "FAULT_TREE_EXACT_LIMIT", "message": str(e)},
        ) from e
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Transfer expansion failed: {e}")

    unsupported = sorted({
        node.type for node in node_map.values()
        if node.type in {"pand", "xor", "not"}
    })
    if unsupported:
        labels = ", ".join(name.upper() for name in unsupported)
        raise HTTPException(
            status_code=422,
            detail=(
                f"{labels} gate semantics are disabled in the static coherent "
                "fault-tree solver. PAND requires ordered event-time/state-space "
                "analysis; XOR and NOT require a non-coherent structure-function "
                "solver. They are not approximated as AND/OR/basic events."
            ),
        )

    # Root = node with no incoming edges
    incoming = {nid: 0 for nid in node_map}
    for s, t in edges:
        if t in incoming:
            incoming[t] += 1
    roots = [nid for nid, cnt in incoming.items() if cnt == 0]
    if not roots:
        raise HTTPException(status_code=400,
                            detail="No root node found (cycle detected?).")
    if len(roots) > 1:
        raise HTTPException(
            status_code=400,
            detail=f"Multiple root nodes found: {roots}. Connect them to a single top event.")

    root_id = roots[0]

    try:
        dependency = _prepare_common_cause(node_map, req.exposure_time)
        event_cache: dict = {}
        common_event_cache: dict = {}
        display_map: dict = {}
        top_event = _build_tree(root_id, node_map, children_map, event_cache,
                                display_map, req.exposure_time, dependency,
                                common_event_cache)
        ft = FaultTree(top_event)
    except HTTPException:
        raise
    except ExactEvaluationLimitError as e:
        raise HTTPException(
            status_code=422,
            detail={"code": "FAULT_TREE_EXACT_LIMIT", "message": str(e)},
        ) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

    # Distinct events must not share a display name (or they'd visually merge in
    # the cut-set output), so disambiguate any collisions before presenting.
    by_name: dict[str, list[str]] = {}
    for key, name in display_map.items():
        by_name.setdefault(name, []).append(key)
    for name, keys in by_name.items():
        if len(keys) > 1:
            for i, key in enumerate(sorted(keys), 1):
                display_map[key] = f"{name} #{i}"

    def disp(key):
        return display_map.get(key, key)

    # Minimal cut sets (sorted, by eventKey identity). Computations stay on the
    # internal keys; only the emitted names are mapped to their display form.
    mcs_sets = [set(cs) for cs in ft.minimal_cut_sets]
    mcs_sets.sort(key=lambda s: (len(s), sorted(s)))
    mcs = [sorted(disp(e) for e in cs) for cs in mcs_sets]
    mcs.sort(key=lambda s: (len(s), s))

    events = ft._collect_basic_events()

    # Importance measures
    try:
        importance = ft.importance_table()
    except Exception:
        importance = {}

    importance_list = [
        {
            "event": disp(name),
            "Birnbaum": round(vals["Birnbaum"], 6),
            "Fussell-Vesely": round(vals["Fussell-Vesely"], 6),
            "RAW": round(vals["RAW"], 6) if math.isfinite(vals["RAW"]) else None,
            "RRW": round(vals["RRW"], 6) if math.isfinite(vals["RRW"]) else None,
        }
        for name, vals in importance.items()
    ]
    importance_list.sort(key=lambda r: -r["Birnbaum"])

    # Formulas (#6) and per-method probabilities (#7)
    try:
        method_probs, exact_diagnostics = _method_probabilities(
            mcs_sets, events, methods)
    except ExactEvaluationLimitError as e:
        raise HTTPException(
            status_code=422,
            detail={"code": "FAULT_TREE_EXACT_LIMIT", "message": str(e)},
        ) from e
    simulation_result = None
    if "simulation" in methods:
        n_sim = max(1000, min(req.n_simulations or 10000, 10_000_000))
        simulation_result = _simulate_top_event(ft, n_sim, seed=req.seed)
        method_probs["simulation"] = simulation_result['probability']
    mcs_formulas = _mcs_formulas(mcs_sets, events, disp)
    bool_expr = _boolean_expression(top_event, disp)

    # Default reported top-event probability: exact if requested, else the
    # first requested method, else the library's recursive value.
    if "exact" in method_probs:
        top_p = method_probs["exact"]
    elif method_probs:
        top_p = method_probs[methods[0]]
    else:
        top_p = ft.top_event_probability

    if mcs_formulas:
        union_terms = " ∪ ".join(
            "(" + " ∩ ".join(f["events"]) + ")" for f in mcs_formulas)
        prob_expr = f"P(TOP) = P({union_terms})"
    else:
        prob_expr = "P(TOP) = 0"

    formulas = {
        "boolean_expression": bool_expr,
        "probability_expression": prob_expr,
        "cut_sets": mcs_formulas,
    }

    dependency_diagnostics = dict(dependency["diagnostics"])
    dependency_diagnostics["groups"] = [
        {
            **group,
            "group_id": dependency.get("group_display", {}).get(
                group["group_id"], group["group_id"]),
            "members": [disp(member) for member in group["members"]],
        }
        for group in dependency_diagnostics["groups"]
    ]

    resp = {
        "top_event_probability": round(top_p, 12),
        "minimal_cut_sets": mcs,
        "importance": importance_list,
        "methods": {m: method_probs[m] for m in method_probs},
        "formulas": formulas,
        "dependency_model": dependency_diagnostics,
        "assumptions": [dependency_diagnostics["assumption"]],
        "computation": {
            "exact_engine": exact_diagnostics,
            "minimal_cut_set_count": len(mcs_sets),
            "basic_latent_event_count": len(events),
        },
    }
    if simulation_result:
        resp["simulation"] = simulation_result
    return _sanitize(resp)
