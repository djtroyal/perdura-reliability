"""Exact interchange between Perdura RBD and Fault Tree analyses."""

from __future__ import annotations

from pathlib import Path
import sys
from typing import Any

from fastapi import APIRouter, HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.FaultTreeAdvanced import (  # noqa: E402
    BDDStateLimitError,
    FaultTreeValidationError,
    compile_graph,
)
from reliability.SystemModelConversion import (  # noqa: E402
    ModelConversionError,
    convert_fta_to_rbd,
    convert_rbd_to_fta,
)
from schemas import (  # noqa: E402
    FTAToRBDConversionRequest,
    RBDConversionGraph,
    RBDRequest,
    RBDToFTAConversionRequest,
)
from .fault_tree import _event_sources, _expand_transfers, _static_dependency  # noqa: E402
from .system_reliability import (  # noqa: E402
    _component_key,
    _compute_reliability,
    _latent_network_model,
    _rbd_validation,
)


router = APIRouter()


# API diagnostics are deliberately selected by code instead of serializing
# caught exceptions.  Conversion errors can contain model identifiers supplied
# by a project, while generic ValueError text can contain implementation detail.
# Keep the response actionable without making exception strings an API surface.
_PUBLIC_CONVERSION_MESSAGES: dict[str, str] = {
    "RBD_REFERENCE_CYCLE": (
        "Linked RBD analyses contain a reference cycle. Detach one reference "
        "and retry the conversion."
    ),
    "UNKNOWN_RBD_REFERENCE": (
        "A linked RBD analysis is unavailable. Re-select the referenced "
        "analysis and retry the conversion."
    ),
    "RBD_REFERENCE_TERMINALS": (
        "Each linked RBD analysis must contain exactly one source and one sink."
    ),
    "EQUIVALENCE_CHECK_FAILED": (
        "The generated model did not reproduce the source structure function."
    ),
    "DANGLING_EDGE": (
        "A connection references a missing node. Remove or reconnect it and retry."
    ),
    "RBD_TERMINALS": (
        "Exact conversion requires exactly one RBD source and one sink."
    ),
    "RBD_CYCLE": "Cyclic RBDs cannot be converted to a fault tree.",
    "FTA_ROOT": "Exact conversion requires exactly one FTA top event.",
    "FTA_CYCLE": "Cyclic fault trees cannot be converted to an RBD.",
    "TRANSFER_NOT_EXPANDED": (
        "Transfer references must be expanded before conversion."
    ),
    "NON_COHERENT_CARDINALITY": (
        "A cardinality gate with an upper bound has no exact passive-RBD equivalent."
    ),
    "UNSUPPORTED_FTA_SEMANTICS": (
        "The selected fault-tree logic has no exact passive-RBD equivalent."
    ),
    "CONVERSION_EXPANSION_LIMIT": (
        "Exact conversion exceeds the configured generated-node limit. "
        "Convert a smaller model or increase the limit."
    ),
}

_PUBLIC_EQUIVALENCE_LIMIT_MESSAGE = (
    "The equivalence proof exceeded the configured BDD state limit. "
    "Simplify the model or increase the limit."
)


def _conversion_failure(
    exc: ModelConversionError,
    *,
    warnings: list[dict[str, Any]],
) -> dict[str, Any]:
    code = exc.code if exc.code in _PUBLIC_CONVERSION_MESSAGES else "MODEL_CONVERSION_FAILED"
    message = _PUBLIC_CONVERSION_MESSAGES.get(
        code,
        "The model cannot be converted exactly with the selected settings.",
    )
    return _failure(code, message, node_id=exc.node_id, warnings=warnings)


def _failure(code: str, message: str, *, node_id: str | None = None,
             warnings: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    diagnostic: dict[str, Any] = {
        "severity": "error", "code": code, "message": message,
    }
    if node_id:
        diagnostic["node_id"] = node_id
    return {
        "convertible": False,
        "exact": False,
        "diagnostics": [diagnostic],
        "warnings": warnings or [],
    }


def _graph_payload(graph: RBDConversionGraph) -> tuple[list[dict], list[dict]]:
    return (
        [node.model_dump(mode="python") for node in graph.nodes],
        [edge.model_dump(mode="python", exclude_none=True) for edge in graph.edges],
    )


def _expand_rbd_references(
    graph: RBDConversionGraph,
    analyses: dict[str, RBDConversionGraph],
    visiting: tuple[str, ...] = (),
) -> tuple[list[dict], list[dict], int]:
    """Inline linked RBD analyses while preserving shared/independent identity."""
    nodes, edges = _graph_payload(graph)
    expanded_references = 0
    while True:
        linked = next((node for node in nodes
                       if str((node.get("data") or {}).get("linkedAnalysisId") or "")), None)
        if linked is None:
            break
        data = dict(linked.get("data") or {})
        reference = str(data.get("linkedAnalysisId"))
        friendly = str(data.get("linkedAnalysisName") or reference)
        if reference in visiting:
            return_chain = " → ".join((*visiting, reference))
            raise ModelConversionError(
                "RBD_REFERENCE_CYCLE", f"Linked RBD analysis cycle: {return_chain}",
                node_id=str(linked["id"]))
        target = analyses.get(reference)
        if target is None:
            raise ModelConversionError(
                "UNKNOWN_RBD_REFERENCE",
                f"Linked RBD analysis {friendly!r} is not available for conversion.",
                node_id=str(linked["id"]))
        sub_nodes, sub_edges, nested_count = _expand_rbd_references(
            target, analyses, (*visiting, reference))
        expanded_references += nested_count + 1
        source_ids = [str(node["id"]) for node in sub_nodes if node.get("type") == "source"]
        sink_ids = [str(node["id"]) for node in sub_nodes if node.get("type") == "sink"]
        if len(source_ids) != 1 or len(sink_ids) != 1:
            raise ModelConversionError(
                "RBD_REFERENCE_TERMINALS",
                f"Linked RBD analysis {friendly!r} must have exactly one source and sink.",
                node_id=str(linked["id"]))
        sub_source, sub_sink = source_ids[0], sink_ids[0]
        occurrence = str(linked["id"])
        identity_prefix = str(data.get("component_key") or occurrence)
        id_map = {
            str(node["id"]): f"xfer-{occurrence}-{node['id']}"
            for node in sub_nodes if str(node["id"]) not in {sub_source, sub_sink}
        }
        inherited_time = target.mission_time
        clones = []
        for node in sub_nodes:
            old_id = str(node["id"])
            if old_id not in id_map:
                continue
            clone_data = dict(node.get("data") or {})
            clone_data.pop("linkedAnalysisId", None)
            clone_data.pop("linkedAnalysisName", None)
            if node.get("type") == "component":
                local_key = str(clone_data.get("component_key") or old_id)
                clone_data["component_key"] = f"{identity_prefix}::{local_key}"
                clone_data["label"] = f"{friendly} › {clone_data.get('label') or old_id}"
                if (clone_data.get("distribution") and clone_data.get("mission_time") is None
                        and inherited_time is not None):
                    clone_data["mission_time"] = inherited_time
            clones.append({**node, "id": id_map[old_id], "data": clone_data})

        linked_id = str(linked["id"])
        outer_in = [edge for edge in edges if str(edge.get("target")) == linked_id]
        outer_out = [edge for edge in edges if str(edge.get("source")) == linked_id]
        edges = [edge for edge in edges
                 if str(edge.get("source")) != linked_id and str(edge.get("target")) != linked_id]
        bridge_edges = []
        sequence = 0
        for sub_edge in sub_edges:
            sub_from, sub_to = str(sub_edge["source"]), str(sub_edge["target"])
            if sub_from == sub_source and sub_to == sub_sink:
                pairs = [(str(left["source"]), str(right["target"]))
                         for left in outer_in for right in outer_out]
            elif sub_from == sub_source:
                pairs = [(str(left["source"]), id_map[sub_to]) for left in outer_in]
            elif sub_to == sub_sink:
                pairs = [(id_map[sub_from], str(right["target"])) for right in outer_out]
            else:
                pairs = [(id_map[sub_from], id_map[sub_to])]
            for source, target_id in pairs:
                sequence += 1
                bridge_edges.append({
                    "id": f"xfer-edge-{occurrence}-{sequence}",
                    "source": source, "target": target_id,
                })
        nodes = [node for node in nodes if str(node["id"]) != linked_id] + clones
        edges.extend(bridge_edges)
    return nodes, edges, expanded_references


@router.post("/convert/rbd-to-fta")
def rbd_to_fta(req: RBDToFTAConversionRequest):
    warnings: list[dict[str, Any]] = []
    try:
        graph = RBDConversionGraph(nodes=req.nodes, edges=req.edges,
                                   mission_time=req.mission_time)
        nodes, edges, expanded = _expand_rbd_references(
            graph, req.analyses,
            (req.source_analysis_id,) if req.source_analysis_id else (),
        )
        validated = RBDRequest(nodes=nodes, edges=edges, mission_time=req.mission_time)
        issues = _rbd_validation(validated)
        blocking = [issue for issue in issues if issue.get("severity") == "error"]
        if blocking:
            return {
                "convertible": False, "exact": False,
                "diagnostics": blocking,
                "warnings": [issue for issue in issues if issue.get("severity") != "error"],
            }
        warnings.extend(issue for issue in issues if issue.get("severity") != "error")
        logical_nodes: dict[str, Any] = {}
        for node in validated.nodes:
            if node.type == "component":
                logical_nodes.setdefault(_component_key(node), node)
        reliabilities = {
            key: _compute_reliability(node.data or {}, req.mission_time, req.mission_time)
            for key, node in logical_nodes.items()
        }
        _latent_network_model(list(logical_nodes), reliabilities, logical_nodes)
        result = convert_rbd_to_fta(
            nodes, edges,
            max_generated_nodes=req.max_generated_nodes,
            max_bdd_nodes=req.max_bdd_nodes,
        )
        if expanded:
            warnings.append({
                "severity": "info", "code": "REFERENCES_EXPANDED",
                "message": f"Expanded {expanded} linked RBD reference(s) into the converted fault tree.",
            })
        return {
            "convertible": True, "exact": True,
            "target_kind": "fta", "nodes": result["nodes"], "edges": result["edges"],
            "target_mission_time": req.mission_time,
            "summary": result["summary"], "verification": result["verification"],
            "diagnostics": [], "warnings": warnings,
        }
    except ModelConversionError as exc:
        return _conversion_failure(exc, warnings=warnings)
    except BDDStateLimitError:
        return _failure(
            "EQUIVALENCE_LIMIT", _PUBLIC_EQUIVALENCE_LIMIT_MESSAGE,
            warnings=warnings,
        )
    except ValueError:
        return _failure(
            "INVALID_RBD",
            "The RBD input could not be converted. Review its nodes, connections, "
            "and numeric parameters.",
            warnings=warnings,
        )


@router.post("/convert/fta-to-rbd")
def fta_to_rbd(req: FTAToRBDConversionRequest):
    warnings: list[dict[str, Any]] = []
    try:
        nodes = [node.model_dump(mode="python") for node in req.nodes]
        edges = [edge.model_dump(mode="python", exclude_none=True) for edge in req.edges]
        nodes, edges = _expand_transfers(nodes, edges, req.trees, req.tree_id)
        graph = compile_graph(nodes, edges)
        # Reuse native FTA source validation so repeated logical events cannot
        # enter the generated RBD with inconsistent probability/time models.
        _static_dependency(_event_sources(nodes, req.exposure_time))
        if graph.dynamic:
            dynamic = sorted({node.type for node in graph.nodes.values()
                              if node.type in {"pand", "por", "spare", "fdep", "seq"}})
            return _failure(
                "DYNAMIC_FTA_NOT_CONVERTIBLE",
                "Dynamic fault-tree semantics cannot be represented by a passive RBD: "
                + ", ".join(item.upper() for item in dynamic),
            )
        if not graph.coherent:
            unsupported = sorted({
                node.type for node in graph.nodes.values()
                if node.type in {"xor", "not", "nand", "nor", "iff", "imply"}
                or (node.type == "cardinality" and int(node.data.get(
                    "max", node.data.get("high", len(graph.inputs[node.id]))))
                    < len(graph.inputs[node.id]))
            })
            return _failure(
                "NON_COHERENT_FTA_NOT_CONVERTIBLE",
                "Non-coherent fault-tree semantics have no exact passive-RBD equivalent: "
                + ", ".join(item.upper() for item in unsupported),
            )
        result = convert_fta_to_rbd(
            nodes, edges,
            max_generated_nodes=req.max_generated_nodes,
            max_bdd_nodes=req.max_bdd_nodes,
        )
        target_mission_time = (
            req.exposure_time
            if req.exposure_time is not None and req.exposure_time > 0
            else None
        )
        target_request = RBDRequest(
            nodes=result["nodes"], edges=result["edges"],
            mission_time=target_mission_time,
        )
        target_issues = _rbd_validation(target_request)
        target_errors = [issue for issue in target_issues
                         if issue.get("severity") == "error"]
        if target_errors:
            return {
                "convertible": False, "exact": False,
                "diagnostics": [{
                    "severity": "error", "code": "GENERATED_RBD_INVALID",
                    "message": "The exact target could not satisfy native RBD validation: "
                               + "; ".join(issue["message"] for issue in target_errors),
                }],
                "warnings": warnings,
            }
        transfer_count = sum(node.type == "transfer" for node in req.nodes)
        if transfer_count:
            warnings.append({
                "severity": "info", "code": "TRANSFERS_EXPANDED",
                "message": f"Expanded {transfer_count} Transfer reference(s) into the converted RBD.",
            })
        return {
            "convertible": True, "exact": True,
            "target_kind": "rbd", "nodes": result["nodes"], "edges": result["edges"],
            "target_mission_time": target_mission_time,
            "summary": result["summary"], "verification": result["verification"],
            "diagnostics": [], "warnings": warnings,
        }
    except FaultTreeValidationError as exc:
        return {
            "convertible": False, "exact": False,
            "diagnostics": [{"severity": "error", **issue} for issue in exc.issues],
            "warnings": warnings,
        }
    except ModelConversionError as exc:
        return _conversion_failure(exc, warnings=warnings)
    except BDDStateLimitError:
        return _failure(
            "EQUIVALENCE_LIMIT", _PUBLIC_EQUIVALENCE_LIMIT_MESSAGE,
            warnings=warnings,
        )
    except HTTPException as exc:
        detail = exc.detail
        if isinstance(detail, dict):
            return _failure(str(detail.get("code", "TRANSFER_EXPANSION_FAILED")),
                            str(detail.get("message", detail)), warnings=warnings)
        return _failure("TRANSFER_EXPANSION_FAILED", str(detail), warnings=warnings)
    except ValueError:
        return _failure(
            "INVALID_FTA",
            "The fault-tree input could not be converted. Review its nodes, "
            "connections, gate settings, and numeric parameters.",
            warnings=warnings,
        )
