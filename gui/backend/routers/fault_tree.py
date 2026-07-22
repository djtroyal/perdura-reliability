"""Fault Tree Analysis API.

The router owns source validation, transfer/reference expansion, dependency
preparation and API presentation. Mathematical gate semantics live in
``reliability.FaultTreeAdvanced`` so the browser never has to recreate them.
"""

from __future__ import annotations

import json
import logging
import math
from pathlib import Path
from queue import Queue
from statistics import NormalDist
import sys
from threading import Event, Thread
from typing import Any, Callable

import numpy as np
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from api_contract import stream_error_event, stream_result_event

from reliability.Dependencies import beta_factor_decomposition
from reliability.FaultTreeAdvanced import (
    BDDStateLimitError,
    DynamicExactIneligible,
    FaultTreeValidationError,
    compile_graph,
    evaluate_dynamic,
    evaluate_dynamic_exact,
    evaluate_static,
    exponential_rate_from_mission_probability,
)
from reliability.FaultTreeOpenPSA import (
    OpenPSAError,
    export_openpsa,
    import_openpsa,
)
from schemas import (
    FaultTreeGraph,
    FaultTreeRequest,
    FTBasicEventData,
    FTExponentialConversionRequest,
    FTOpenPSAExportRequest,
    FTOpenPSAImportRequest,
)
from ._probability_models import distribution_cdf


router = APIRouter()
logger = logging.getLogger(__name__)

_FAULT_TREE_INPUT_MESSAGE = (
    "Fault-tree input could not be validated. Review the node properties and "
    "connections, then try again."
)
_FAULT_TREE_INTERNAL_MESSAGE = (
    "Fault-tree analysis failed unexpectedly. Review the model or server logs."
)

_EVENT_TYPES = {"basic", "undeveloped", "conditioning", "external", "house"}
_STOCHASTIC_EVENT_TYPES = _EVENT_TYPES - {"house"}
_CONSTRAINT_TYPES = {"fdep", "seq"}


def _sanitize(value: Any) -> Any:
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {key: _sanitize(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_sanitize(item) for item in value]
    return value


def _event_key(node_id: str, data: dict[str, Any]) -> str:
    # Labels are display metadata, never identity. Explicit eventKey values are
    # created by the Repeat/Reference workflow and by transfer expansion.
    return str(data.get("eventKey") or node_id)


def _event_display(node_id: str, data: dict[str, Any]) -> str:
    return str(data.get("_display_label") or data.get("label")
               or data.get("eventKey") or node_id)


def _compute_probability(data: dict[str, Any], mission_time: float | None) -> float:
    model = FTBasicEventData.model_validate(data)
    if model.distribution is None:
        return float(model.probability)
    time = model.exposure_time if model.exposure_time is not None else mission_time
    if time is None:
        raise ValueError("distribution-based event requires a mission/exposure time")
    return distribution_cdf(model.distribution, model.dist_params, time)


def _graph_payload(graph: FaultTreeGraph) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    return (
        [node.model_dump(mode="python") for node in graph.nodes],
        [edge.model_dump(mode="python", exclude_none=True) for edge in graph.edges],
    )


def _find_root(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> str:
    by_id = {str(node["id"]): node for node in nodes}
    has_parent = {
        str(edge["target"])
        for edge in edges
        if str(by_id.get(str(edge["source"]), {}).get("type", ""))
        not in _CONSTRAINT_TYPES
    }
    roots = [
        node_id for node_id, node in by_id.items()
        if str(node.get("type")) not in _CONSTRAINT_TYPES
        and node_id not in has_parent
    ]
    if len(roots) != 1:
        raise ValueError(
            "Referenced tree requires exactly one causal top event; "
            f"found {len(roots)}."
        )
    return roots[0]


def _expand_transfers(
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    trees: dict[str, FaultTreeGraph],
    tree_id: str | None,
    visiting: tuple[str, ...] = (),
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Expand transfer references while preserving shared logical identity.

    Node ids are instance-qualified to keep the diagram acyclic. Event keys use
    the referenced tree id by default, so two transfers to the same tree refer
    to the same logical events. ``referenceMode='independent'`` adds the
    transfer instance to the identity instead.
    """
    result_nodes = [{**node, "data": dict(node.get("data") or {})}
                    for node in nodes]
    result_edges = [dict(edge) for edge in edges]
    stack = visiting + ((tree_id,) if tree_id else ())

    for transfer in list(nodes):
        if transfer.get("type") != "transfer":
            continue
        data = dict(transfer.get("data") or {})
        reference = data.get("transferTo") or data.get("ref_tree")
        if not reference:
            continue
        reference = str(reference)
        if reference in stack:
            chain = " → ".join((*stack, reference))
            raise HTTPException(
                status_code=400,
                detail={"code": "TRANSFER_CYCLE",
                        "message": f"Transfer-reference cycle: {chain}"},
            )
        sub_graph = trees.get(reference)
        if sub_graph is None:
            friendly_target = str(
                data.get("transferToName") or data.get("label") or reference
            )
            raise HTTPException(
                status_code=400,
                detail={"code": "UNKNOWN_TRANSFER_TARGET",
                        "message": (
                            "Transfer references unknown FTA analysis "
                            f"{friendly_target!r}."
                        )},
            )
        sub_nodes, sub_edges = _graph_payload(sub_graph)
        sub_nodes, sub_edges = _expand_transfers(
            sub_nodes, sub_edges, trees, reference, stack)
        sub_root = _find_root(sub_nodes, sub_edges)
        instance_prefix = f"__xfer__{transfer['id']}__"
        display_prefix = str(data.get("transferToName") or data.get("label") or reference)
        independent = str(data.get("referenceMode", "shared")).lower() == "independent"
        local_ids = {str(node["id"]): instance_prefix + str(node["id"])
                     for node in sub_nodes}
        for sub_node in sub_nodes:
            sub_data = dict(sub_node.get("data") or {})
            if sub_node.get("type") in _EVENT_TYPES:
                existing_qualified = sub_data.get("_qualified_event_key")
                base_key = str(sub_data.get("eventKey") or sub_node["id"])
                qualified = str(existing_qualified or f"{reference}::{base_key}")
                if independent:
                    qualified = f"{transfer['id']}::{qualified}"
                sub_data["eventKey"] = qualified
                sub_data["_qualified_event_key"] = qualified
                base_label = str(sub_data.get("label") or sub_node["id"])
                sub_data["_display_label"] = f"{display_prefix} › {base_label}"
            result_nodes.append({
                "id": local_ids[str(sub_node["id"])],
                "type": sub_node["type"],
                "data": sub_data,
            })
        for sub_edge in sub_edges:
            result_edges.append({
                **sub_edge,
                "id": (instance_prefix + str(sub_edge.get("id"))
                       if sub_edge.get("id") else None),
                "source": local_ids[str(sub_edge["source"])],
                "target": local_ids[str(sub_edge["target"])],
            })
        result_edges.append({
            "id": f"{instance_prefix}root",
            "source": str(transfer["id"]),
            "target": local_ids[sub_root],
            "role": "input",
            "order": 0,
        })
    return result_nodes, result_edges


def _disambiguate_display_names(display_names: dict[str, str]) -> dict[str, str]:
    by_label: dict[str, list[str]] = {}
    for key, label in display_names.items():
        by_label.setdefault(label, []).append(key)
    result = dict(display_names)
    for label, keys in by_label.items():
        if len(keys) > 1:
            for index, key in enumerate(sorted(keys), 1):
                result[key] = f"{label} #{index}"
    return result


def _event_sources(nodes: list[dict[str, Any]], mission_time: float | None) -> dict[str, Any]:
    marginals: dict[str, float] = {}
    models: dict[str, dict[str, Any]] = {}
    assignments: dict[str, dict[str, Any]] = {}
    display_names: dict[str, str] = {}
    signatures: dict[str, tuple[Any, ...]] = {}
    labels_by_key: dict[str, set[str]] = {}
    for node in nodes:
        node_type = str(node.get("type"))
        if node_type not in _EVENT_TYPES:
            continue
        node_id = str(node["id"])
        data = dict(node.get("data") or {})
        key = _event_key(node_id, data)
        display = _event_display(node_id, data)
        display_names.setdefault(key, display)
        labels_by_key.setdefault(key, set()).add(display)
        if node_type == "house":
            continue
        if data.get("sourceIncomplete"):
            raise ValueError(
                f"Imported event {display!r} has only a placeholder probability. "
                "Define its probability or time-to-failure model before analysis."
            )
        probability = _compute_probability(data, mission_time)
        model = {
            "distribution": data.get("distribution"),
            "dist_params": dict(data.get("dist_params") or {}),
            "exposure_time": data.get("exposure_time"),
            "probability": probability,
            "ccf_group": data.get("ccf_group"),
            "ccf_beta": data.get("ccf_beta", 0.1),
        }
        signature = (
            probability, model["distribution"],
            tuple(sorted((str(k), repr(v)) for k, v in model["dist_params"].items())),
            model["exposure_time"], model["ccf_group"], model["ccf_beta"],
        )
        if key in signatures and signatures[key] != signature:
            raise ValueError(
                f"Repeated event {display_names[key]!r} has inconsistent probability, "
                "time model, or common-cause settings."
            )
        signatures[key] = signature
        marginals[key] = probability
        models[key] = model
        group = str(data.get("ccf_group") or "").strip()
        if group:
            assignments[key] = {
                "group": group,
                "beta": data.get("ccf_beta", 0.1),
            }
    for key, labels in labels_by_key.items():
        if len(labels) > 1:
            display_names[key] = key
    return {
        "marginals": marginals,
        "models": models,
        "assignments": assignments,
        "display_names": _disambiguate_display_names(display_names),
    }


def _static_dependency(source: dict[str, Any]) -> dict[str, Any]:
    decomposition = beta_factor_decomposition(
        source["marginals"], source["assignments"])
    latent_probabilities = dict(decomposition["individual_failure_probabilities"])
    components: dict[str, list[str]] = {}
    display_names = dict(source["display_names"])
    for key in source["marginals"]:
        group = decomposition["membership"].get(key)
        if group:
            shock = f"__ccf__::{group}"
            components[key] = [key, shock]
            latent_probabilities[shock] = decomposition["common_cause_probabilities"][group]
            display_names[key] = f"{display_names.get(key, key)} (independent)"
            display_names[shock] = f"CCF[{group}]"
        else:
            components[key] = [key]
    diagnostics = dict(decomposition["diagnostics"])
    diagnostics["groups"] = [
        {
            **group,
            "members": [source["display_names"].get(member, member)
                        for member in group["members"]],
        }
        for group in diagnostics["groups"]
    ]
    return {
        "latent_probabilities": latent_probabilities,
        "components": components,
        "display_names": display_names,
        "diagnostics": diagnostics,
    }


def _boolean_expression(graph, node_id: str, display_names: dict[str, str],
                        depth: int = 0) -> str:
    node = graph.nodes[node_id]
    children = graph.children(node_id)
    if node.type in _EVENT_TYPES:
        return display_names.get(node.event_key, node.label)
    child_expr = [_boolean_expression(graph, child, display_names, depth + 1)
                  for child in children]
    if node.type == "transfer":
        return child_expr[0]
    if node.type == "not":
        return f"NOT({child_expr[0]})"
    if node.type == "vote":
        return f"ATLEAST({int(node.data.get('k', 2))}; {', '.join(child_expr)})"
    if node.type == "cardinality":
        low = int(node.data.get("min", node.data.get("low", 1)))
        high = int(node.data.get("max", node.data.get("high", len(children))))
        return f"CARDINALITY({low}..{high}; {', '.join(child_expr)})"
    if node.type == "inhibit":
        return f"INHIBIT({child_expr[0]} | {child_expr[1]})"
    if node.type in {"pand", "por", "spare"}:
        return f"{node.type.upper()}[{', '.join(child_expr)}]"
    operators = {
        "and": " AND ", "or": " OR ", "nand": " NAND ", "nor": " NOR ",
        "xor": " XOR ", "iff": " IFF ", "imply": " IMPLIES ",
    }
    inner = operators.get(node.type, f" {node.type.upper()} ").join(child_expr)
    return f"({inner})" if depth else inner


def _latex_text(value: str) -> str:
    escaped = str(value)
    for source, target in (
        ("\\", r"\backslash "), ("{", r"\{"), ("}", r"\}"),
        ("_", r"\_"), ("%", r"\%"), ("#", r"\#"),
        ("&", r"\&"), ("$", r"\$"),
    ):
        escaped = escaped.replace(source, target)
    escaped = escaped.replace(" ", r"\ ")
    return rf"\mathrm{{{escaped}}}"


def _latex_expression(graph, node_id: str,
                      display_names: dict[str, str]) -> str:
    node = graph.nodes[node_id]
    children = [_latex_expression(graph, child, display_names)
                for child in graph.children(node_id)]
    if node.type in _EVENT_TYPES:
        return _latex_text(display_names.get(node.event_key, node.label))
    if node.type == "transfer":
        return children[0]
    if node.type == "not":
        return rf"\neg\left({children[0]}\right)"
    if node.type == "vote":
        return rf"\operatorname{{AtLeast}}_{{{int(node.data.get('k', 2))}}}\left({', '.join(children)}\right)"
    if node.type == "cardinality":
        low = int(node.data.get("min", node.data.get("low", 1)))
        high = int(node.data.get("max", node.data.get("high", len(children))))
        return rf"\operatorname{{Card}}_{{{low}\ldots {high}}}\left({', '.join(children)}\right)"
    if node.type == "inhibit":
        return rf"\left({children[0]}\land {children[1]}\right)"
    if node.type in {"pand", "por", "spare"}:
        return rf"\operatorname{{{node.type.upper()}}}\left({', '.join(children)}\right)"
    operators = {
        "and": r"\land", "or": r"\lor", "nand": r"\mathbin{\uparrow}",
        "nor": r"\mathbin{\downarrow}", "xor": r"\oplus", "iff": r"\leftrightarrow",
        "imply": r"\rightarrow",
    }
    operator = operators.get(node.type, rf"\operatorname{{{node.type.upper()}}}")
    return rf"\left({' {} '.format(operator).join(children)}\right)"


def _static_method_values(evaluation, methods: list[str]) -> dict[str, float]:
    result: dict[str, float] = {}
    if "exact" in methods:
        result["exact"] = evaluation.top_probability
    if evaluation.graph.coherent:
        cut_probabilities = [condition["probability"]
                             for condition in evaluation.conditions]
        if "rare_event" in methods:
            result["rare_event"] = sum(cut_probabilities)
        if "min_cut_upper_bound" in methods:
            survival = 1.0
            for probability in cut_probabilities:
                survival *= 1.0 - min(1.0, probability)
            result["min_cut_upper_bound"] = 1.0 - survival
    return result


def _simulate_static(evaluation, n_simulations: int, seed: int | None,
                     confidence_level: float,
                     progress: Callable[[int, int], None] | None = None,
                     cancelled: Callable[[], bool] | None = None) -> dict[str, Any]:
    n = max(1, int(n_simulations))
    rng = np.random.default_rng(seed)
    manager = evaluation.manager
    variables = manager.variables
    marginal = np.array([evaluation.probabilities[name] for name in variables])
    root = evaluation.roots[evaluation.graph.root_id]
    successes = 0
    completed = 0
    chunk_size = min(100_000, n)
    while completed < n:
        if cancelled and cancelled():
            raise InterruptedError("Fault-tree analysis was cancelled.")
        size = min(chunk_size, n - completed)
        draws = rng.random((size, len(variables))) < marginal
        current = np.full(size, root, dtype=np.int64)
        while np.any(current > 1):
            for bdd_node in np.unique(current[current > 1]):
                mask = current == bdd_node
                variable, low, high = manager.nodes[int(bdd_node)]
                current[mask] = np.where(draws[mask, variable], high, low)
        successes += int(np.count_nonzero(current))
        completed += size
        if progress:
            progress(completed, n)
    probability = successes / n
    z = NormalDist().inv_cdf(0.5 + confidence_level / 2.0)
    z2 = z * z
    denominator = 1.0 + z2 / n
    center = (probability + z2 / (2 * n)) / denominator
    half = z * math.sqrt(
        probability * (1 - probability) / n + z2 / (4 * n * n)
    ) / denominator
    return {
        "probability": probability,
        "std_error": math.sqrt(probability * (1 - probability) / n),
        "ci_lower": max(0.0, center - half),
        "ci_upper": min(1.0, center + half),
        "n_samples": n,
        "top_event_count": successes,
        "confidence_level": confidence_level,
        "interval_method": "wilson_score",
        "resolution_limit": 1.0 / n,
        "zero_event_upper_bound": (
            1.0 - (1.0 - confidence_level) ** (1.0 / n)
            if successes == 0 else None
        ),
    }


def _static_time_curve(req: FaultTreeRequest, graph, source,
                       evaluation) -> tuple[list[dict[str, float]], dict[str, list[float]], str | None]:
    if any(model.get("distribution") is None
           for model in source["models"].values()):
        return [], {}, (
            "Probability-versus-time is unavailable because at least one event "
            "has only a point mission probability."
        )
    if req.exposure_time is None:
        return [], {}, (
            "Probability-versus-time requires a global exposure time. Event-level "
            "exposures can quantify the mission point but do not define a shared calendar axis."
        )
    mission = float(req.exposure_time)
    if mission <= 0 and any(model.get("exposure_time") not in {None, 0, 0.0}
                            for model in source["models"].values()):
        return [], {}, (
            "A positive global exposure time is required to scale event-level exposure overrides."
        )
    grid = req.time_grid or np.linspace(0.0, mission, 51).tolist()
    top_curve: list[dict[str, float]] = []
    node_curves = {node_id: [] for node_id in evaluation.roots}
    for time in grid:
        marginals: dict[str, float] = {}
        for key, model in source["models"].items():
            override = model.get("exposure_time")
            effective_time = (
                float(time) * float(override) / mission
                if override is not None and mission > 0 else float(time)
            )
            marginals[key] = distribution_cdf(
                model["distribution"], model["dist_params"], effective_time)
        decomposition = beta_factor_decomposition(marginals, source["assignments"])
        probabilities = dict(decomposition["individual_failure_probabilities"])
        for group, probability in decomposition["common_cause_probabilities"].items():
            probabilities[f"__ccf__::{group}"] = probability
        top_probability = evaluation.manager.probability(
            evaluation.roots[graph.root_id], probabilities)
        top_curve.append({"time": float(time), "probability": top_probability})
        for node_id, root in evaluation.roots.items():
            node_curves[node_id].append(
                evaluation.manager.probability(root, probabilities))
    return top_curve, node_curves, None


def _analyze(req: FaultTreeRequest,
             progress: Callable[[int, int], None] | None = None,
             cancelled: Callable[[], bool] | None = None) -> dict[str, Any]:
    if not req.nodes:
        raise HTTPException(status_code=400, detail={
            "code": "EMPTY_FAULT_TREE", "message": "Fault tree has no nodes."
        })
    primary = FaultTreeGraph(nodes=req.nodes, edges=req.edges)
    nodes, edges = _graph_payload(primary)
    try:
        nodes, edges = _expand_transfers(
            nodes, edges, dict(req.trees or {}), req.tree_id)
        graph = compile_graph(nodes, edges)
        mission_time = req.exposure_time
        source = _event_sources(nodes, mission_time)
    except HTTPException:
        raise
    except FaultTreeValidationError as exc:
        raise HTTPException(status_code=422, detail={
            "code": "FAULT_TREE_VALIDATION",
            "message": str(exc),
            "issues": exc.issues,
        }) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail={
            "code": "FAULT_TREE_INPUT", "message": str(exc)
        }) from exc

    methods = req.methods or (["simulation"] if graph.dynamic else ["exact"])
    methods = [method for method in methods
               if method in {"exact", "rare_event", "min_cut_upper_bound", "simulation"}]
    if not methods:
        methods = ["simulation"] if graph.dynamic else ["exact"]

    expression = _boolean_expression(graph, graph.root_id,
                                     source["display_names"])
    expression_latex = _latex_expression(
        graph, graph.root_id, source["display_names"])
    if graph.dynamic:
        if mission_time is None:
            raise HTTPException(status_code=422, detail={
                "code": "MISSION_TIME_REQUIRED",
                "message": "Dynamic fault-tree analysis requires a mission time."
            })
        exact_ineligible: list[str] = []
        if req.engine in {"auto", "exact"}:
            try:
                exact_result = evaluate_dynamic_exact(
                    graph,
                    mission_time=float(mission_time),
                    event_models=source["models"],
                    time_grid=req.time_grid,
                    max_states=req.max_dynamic_states,
                )
            except DynamicExactIneligible as exc:
                exact_ineligible = exc.reasons
                if req.engine == "exact":
                    raise HTTPException(status_code=422, detail={
                        "code": "DYNAMIC_EXACT_INELIGIBLE",
                        "message": (
                            "This dynamic tree is outside the proven exact-CTMC "
                            "eligibility class. " + " ".join(exc.reasons)
                        ),
                        "reasons": exc.reasons,
                    }) from exc
            else:
                node_results = [
                    {
                        "node_id": node_id,
                        "label": graph.nodes[node_id].label,
                        "type": graph.nodes[node_id].type,
                        "probability": exact_result.node_probabilities.get(node_id, 0.0),
                        "curve": exact_result.node_curves.get(node_id, []),
                    }
                    for node_id in graph.nodes
                    if graph.nodes[node_id].type not in _CONSTRAINT_TYPES
                ]
                display_sequences = [
                    {
                        **sequence,
                        "events": [source["display_names"].get(event, event)
                                   for event in sequence["events"]],
                    }
                    for sequence in exact_result.sequences
                ]
                diagnostics = []
                if exact_result.diagnostics.get("qualitative_display_truncated"):
                    diagnostics.append({
                        "severity": "warning",
                        "code": "DYNAMIC_SEQUENCE_DISPLAY_TRUNCATED",
                        "message": "Exact probability is complete; the displayed first-entry sequences reached their presentation limit.",
                    })
                return _sanitize({
                    "schema_version": 2,
                    "analysis_kind": "dynamic",
                    "top_event_probability": exact_result.top_probability,
                    "minimal_cut_sets": [],
                    "failure_conditions": [],
                    "cut_sequences": display_sequences,
                    "importance": [],
                    "importance_eligibility": {
                        "available": False,
                        "reason": "Dynamic importance is not inferred from static cut sets; use sensitivity cases for event-rate changes.",
                    },
                    "methods": {"exact": exact_result.top_probability},
                    "time_curve": exact_result.time_curve,
                    "time_grid": [point["time"] for point in exact_result.time_curve],
                    "node_results": node_results,
                    "formulas": {
                        "boolean_expression": expression,
                        "boolean_expression_latex": expression_latex,
                        "probability_expression": "P(TOP at mission time) = π(0) exp(Qt) · I(TOP)",
                        "probability_expression_latex": r"P_{\mathrm{TOP}}(t)=\boldsymbol{\pi}(0)e^{Qt}\mathbf{1}_{\mathrm{TOP}}",
                        "cut_sets": [],
                    },
                    "dependency_model": {
                        "model": "independent_exponential_clocks",
                        "assumption": "Independent, unshifted exponential event clocks in an ordered-failure CTMC.",
                        "groups": [],
                        "limitations": "Exact eligibility excludes SPARE, FDEP, SEQ, shifted/non-exponential clocks, and dynamic common cause.",
                    },
                    "assumptions": [
                        "Nonrepairable mission-failure model; repair and availability belong in Markov Analysis.",
                        "Independent, unshifted exponential event clocks; event-order ties have probability zero.",
                    ],
                    "diagnostics": diagnostics,
                    "computation": {
                        "engine": exact_result.diagnostics,
                        "exact_engine": exact_result.diagnostics,
                        "minimal_cut_set_count": 0,
                        "basic_event_count": len(source["models"]),
                    },
                })
        try:
            result = evaluate_dynamic(
                graph,
                mission_time=float(mission_time),
                event_models=source["models"],
                n_simulations=max(1_000, min(req.n_simulations or 20_000, 10_000_000)),
                seed=req.seed,
                confidence_level=req.confidence_level,
                time_grid=req.time_grid,
                progress=progress,
                cancelled=cancelled,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail={
                "code": "DYNAMIC_MODEL_INVALID", "message": str(exc)
            }) from exc
        node_results = [
            {
                "node_id": node_id,
                "label": graph.nodes[node_id].label,
                "type": graph.nodes[node_id].type,
                "probability": result.node_probabilities.get(node_id, 0.0),
                "curve": result.node_curves.get(node_id, []),
            }
            for node_id in graph.nodes
            if graph.nodes[node_id].type not in _CONSTRAINT_TYPES
        ]
        assumptions = [
            "Nonrepairable mission-failure model; repair and availability belong in Markov Analysis.",
            "Failure-time sources are independent except for configured exponential beta-factor groups and FDEP constructs.",
            "Warm-spare dormancy scales accumulated effective exposure by the configured dormancy factor.",
        ]
        display_sequences = [
            {
                **sequence,
                "events": [source["display_names"].get(event, event)
                           for event in sequence["events"]],
            }
            for sequence in result.sequences
        ]
        response = {
            "schema_version": 2,
            "analysis_kind": "dynamic",
            "top_event_probability": result.top_probability,
            "minimal_cut_sets": [],
            "failure_conditions": [],
            "cut_sequences": display_sequences,
            "importance": [],
            "importance_eligibility": {
                "available": False,
                "reason": "Dynamic importance requires conditional chronological re-simulation and is not inferred from static cut sets.",
            },
            "methods": {"simulation": result.top_probability},
            "simulation": {
                "probability": result.top_probability,
                "ci_lower": result.ci_lower,
                "ci_upper": result.ci_upper,
                "n_samples": result.n_simulations,
                "top_event_count": result.top_event_count,
                "confidence_level": result.confidence_level,
                "interval_method": "wilson_score",
                "resolution_limit": result.diagnostics["resolution_limit"],
                "zero_event_upper_bound": result.diagnostics["zero_event_upper_bound"],
            },
            "time_curve": result.time_curve,
            "time_grid": [point["time"] for point in result.time_curve],
            "node_results": node_results,
            "formulas": {
                "boolean_expression": expression,
                "boolean_expression_latex": expression_latex,
                "probability_expression": "P(TOP at mission time) from chronological event-time trials",
                "probability_expression_latex": r"\widehat P_{\mathrm{TOP}}(t)=N_{\mathrm{TOP}}(t)/N",
                "cut_sets": [],
            },
            "dependency_model": {
                "model": "dynamic_declared_dependencies",
                "assumption": assumptions[1],
                "groups": [],
                "limitations": "Non-exponential common cause requires an explicit common-shock event.",
            },
            "assumptions": assumptions,
            "diagnostics": ([{
                "severity": "info",
                "code": "DYNAMIC_EXACT_FALLBACK",
                "message": "Auto selected chronological Monte Carlo because exact CTMC eligibility was not proven: " + " ".join(exact_ineligible),
            }] if exact_ineligible else []),
            "computation": {
                "engine": result.diagnostics,
                "exact_engine": None,
                "minimal_cut_set_count": 0,
                "basic_event_count": len(source["models"]),
            },
        }
        return _sanitize(response)

    try:
        dependency = _static_dependency(source)
        evaluation = evaluate_static(
            graph,
            dependency["latent_probabilities"],
            dependency["components"],
            dependency["display_names"],
            max_bdd_nodes=req.max_bdd_nodes,
        )
    except BDDStateLimitError as exc:
        raise HTTPException(status_code=422, detail={
            "code": "FAULT_TREE_EXACT_LIMIT", "message": str(exc)
        }) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail={
            "code": "FAULT_TREE_DEPENDENCY", "message": str(exc)
        }) from exc

    method_values = _static_method_values(evaluation, methods)
    simulation = None
    if req.engine == "simulation" or "simulation" in methods:
        simulation = _simulate_static(
            evaluation,
            max(1_000, min(req.n_simulations or 20_000, 10_000_000)),
            req.seed,
            req.confidence_level,
            progress=progress,
            cancelled=cancelled,
        )
        method_values["simulation"] = simulation["probability"]
    if req.engine == "exact" and "exact" not in method_values:
        method_values["exact"] = evaluation.top_probability

    top_probability = (
        simulation["probability"] if req.engine == "simulation" and simulation
        else evaluation.top_probability
    )
    time_curve, node_curves, curve_warning = _static_time_curve(
        req, graph, source, evaluation)
    conditions = evaluation.conditions
    minimal_cut_sets = [condition["required_failed"] for condition in conditions]
    if not graph.coherent:
        minimal_cut_sets = []
    cut_formulas = [
        {
            "events": condition["required_failed"],
            "required_successful": condition["required_successful"],
            "formula": " * ".join(
                [f"P({name})" for name in condition["required_failed"]]
                + [f"(1-P({name}))" for name in condition["required_successful"]]
            ) or "1",
            "formula_latex": r"\,".join(
                [rf"P\!\left({_latex_text(name)}\right)" for name in condition["required_failed"]]
                + [rf"\left[1-P\!\left({_latex_text(name)}\right)\right]"
                   for name in condition["required_successful"]]
            ) or "1",
            "value": condition["probability"],
        }
        for condition in conditions
    ]
    node_results = [
        {
            "node_id": node_id,
            "label": graph.nodes[node_id].label,
            "type": graph.nodes[node_id].type,
            "probability": evaluation.node_probabilities[node_id],
            "curve": node_curves.get(node_id, []),
        }
        for node_id in graph.nodes
        if node_id in evaluation.node_probabilities
    ]
    bdd_diagnostics = evaluation.manager.diagnostics(
        evaluation.roots[graph.root_id])
    # Preserve earlier diagnostic field names while exposing the new ROBDD
    # contract to report assets and saved results.
    bdd_diagnostics.update({
        "states_evaluated": bdd_diagnostics["nodes_reachable"],
        "cache_hits": 0,
        "terms": len(conditions),
    })
    diagnostics = []
    if curve_warning:
        diagnostics.append({"severity": "info", "code": "TIME_CURVE_UNAVAILABLE",
                            "message": curve_warning})
    if evaluation.conditions_truncated:
        diagnostics.append({
            "severity": "warning", "code": "QUALITATIVE_DISPLAY_TRUNCATED",
            "message": "Qualitative condition display reached its configured limit; exact probability was not truncated.",
        })
    response = {
        "schema_version": 2,
        "analysis_kind": "static_coherent" if graph.coherent else "static_noncoherent",
        "top_event_probability": top_probability,
        "minimal_cut_sets": minimal_cut_sets,
        "failure_conditions": [] if graph.coherent else conditions,
        "cut_sequences": [],
        "importance": evaluation.importance,
        "importance_eligibility": {
            "available": True,
            "coherent_interpretation": graph.coherent,
            "reason": None if graph.coherent else (
                "Birnbaum is signed; FV is withheld and RAW/RRW need non-coherent interpretation."
            ),
        },
        "methods": method_values,
        "time_curve": time_curve,
        "time_grid": [point["time"] for point in time_curve],
        "node_results": node_results,
        "formulas": {
            "boolean_expression": expression,
            "boolean_expression_latex": expression_latex,
            "probability_expression": (
                "P(TOP) = exact reduced Boolean decision-diagram evaluation"
            ),
            "probability_expression_latex": r"P_{\mathrm{TOP}}=\operatorname{ROBDD}\!\left(f_{\mathrm{TOP}},\mathbf q\right)",
            "cut_sets": cut_formulas,
        },
        "dependency_model": dependency["diagnostics"],
        "assumptions": [
            dependency["diagnostics"]["assumption"],
            "Static state probability at the selected mission time; no repair or event-order semantics.",
        ],
        "diagnostics": diagnostics,
        "computation": {
            "engine": bdd_diagnostics,
            "exact_engine": bdd_diagnostics,
            "minimal_cut_set_count": len(minimal_cut_sets),
            "qualitative_condition_count": len(conditions),
            "qualitative_display_truncated": evaluation.conditions_truncated,
            "basic_latent_event_count": len(dependency["latent_probabilities"]),
            "basic_event_count": len(source["models"]),
        },
    }
    if simulation:
        response["simulation"] = simulation
    return _sanitize(response)


@router.post("/validate")
def validate_fault_tree(req: FaultTreeRequest):
    primary = FaultTreeGraph(nodes=req.nodes, edges=req.edges)
    nodes, edges = _graph_payload(primary)
    try:
        nodes, edges = _expand_transfers(
            nodes, edges, dict(req.trees or {}), req.tree_id)
        graph = compile_graph(nodes, edges)
        source = _event_sources(nodes, req.exposure_time)
    except HTTPException:
        raise
    except FaultTreeValidationError as exc:
        return {
            "valid": False,
            "issues": exc.issues,
            "analysis_kind": None,
        }
    except ValueError:
        logger.info("Fault-tree validation rejected an input model.", exc_info=True)
        return {
            "valid": False,
            "issues": [{"code": "FAULT_TREE_INPUT", "message": _FAULT_TREE_INPUT_MESSAGE}],
            "analysis_kind": None,
        }
    return {
        "valid": True,
        "issues": graph.warnings,
        "analysis_kind": "dynamic" if graph.dynamic else (
            "static_coherent" if graph.coherent else "static_noncoherent"),
        "root_id": graph.root_id,
        "event_count": len(source["models"]),
    }


@router.post("/analyze")
def analyze_fault_tree(req: FaultTreeRequest):
    return _analyze(req)


@router.post("/analyze/stream", response_class=StreamingResponse, responses={
    200: {"content": {"application/x-ndjson": {"schema": {"type": "string"}}}},
})
async def analyze_fault_tree_stream(req: FaultTreeRequest, request: Request):
    """NDJSON analysis stream used for dynamic Monte Carlo progress."""
    def generate():
        yield json.dumps({"type": "start"}) + "\n"
        events: Queue[dict[str, Any]] = Queue()
        cancel = Event()

        def progress(done: int, total: int) -> None:
            events.put({"type": "progress", "done": done, "total": total})

        def worker() -> None:
            try:
                result = _analyze(req, progress=progress,
                                  cancelled=cancel.is_set)
                events.put(stream_result_event(result))
            except InterruptedError:
                events.put(stream_error_event(
                    "Analysis cancelled.", request_id_value=getattr(request.state, "request_id", ""),
                    status=499, code="cancelled",
                ))
            except HTTPException as exc:
                events.put(stream_error_event(
                    exc.detail, request_id_value=getattr(request.state, "request_id", ""),
                    status=exc.status_code,
                ))
            except Exception:  # pragma: no cover - stream boundary
                logger.exception("Unexpected fault-tree streaming analysis failure.")
                events.put(stream_error_event(
                    _FAULT_TREE_INTERNAL_MESSAGE,
                    request_id_value=getattr(request.state, "request_id", ""),
                ))
            finally:
                events.put({"type": "end"})

        thread = Thread(target=worker, daemon=True)
        thread.start()
        try:
            while True:
                event = events.get()
                if event["type"] == "end":
                    break
                yield json.dumps(event) + "\n"
        finally:
            cancel.set()

    return StreamingResponse(generate(), media_type="application/x-ndjson")


@router.post("/derive-exponential")
def derive_exponential(req: FTExponentialConversionRequest):
    try:
        rate = exponential_rate_from_mission_probability(req.probability, req.mission_time)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail={
            "code": "EXPONENTIAL_CONVERSION", "message": str(exc)
        }) from exc
    return {
        "distribution": "exponential",
        "dist_params": {"lambda": rate, "gamma": 0.0},
        "assumption": (
            "Constant hazard inferred explicitly from the supplied mission "
            "probability using λ = -ln(1-p)/t."
        ),
    }


@router.post("/openpsa/import")
def import_openpsa_model(req: FTOpenPSAImportRequest):
    try:
        return import_openpsa(
            req.xml, tree_name=req.tree_name, top_event=req.top_event)
    except OpenPSAError as exc:
        raise HTTPException(status_code=422, detail={
            "code": exc.code, "message": str(exc),
        }) from exc


@router.post("/openpsa/export")
def export_openpsa_model(req: FTOpenPSAExportRequest):
    try:
        return export_openpsa(
            [node.model_dump(mode="python") for node in req.nodes],
            [edge.model_dump(mode="python", exclude_none=True)
             for edge in req.edges],
            tree_name=req.tree_name,
        )
    except (OpenPSAError, FaultTreeValidationError) as exc:
        detail: dict[str, Any] = {
            "code": getattr(exc, "code", "OPENPSA_EXPORT_INVALID"),
            "message": str(exc),
        }
        if isinstance(exc, FaultTreeValidationError):
            detail["issues"] = exc.issues
        raise HTTPException(status_code=422, detail=detail) from exc


__all__ = [
    "analyze_fault_tree", "analyze_fault_tree_stream", "derive_exponential",
    "export_openpsa_model", "import_openpsa_model", "validate_fault_tree",
]
