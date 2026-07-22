"""Exact structural conversion between reliability block diagrams and fault trees.

The converters operate on the domain graph payloads used by Perdura's APIs.
They deliberately do not carry calculation results or canvas coordinates.  A
conversion is accepted only when the generated model has the same Boolean
structure function as the source (RBD failure == FTA top event), proven with a
shared reduced ordered binary decision diagram.
"""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any, Iterable, Mapping, Sequence

from reliability.FaultTreeAdvanced import BDDManager, BDDStateLimitError


class ModelConversionError(ValueError):
    """A model cannot be converted exactly."""

    def __init__(self, code: str, message: str, *, node_id: str | None = None):
        self.code = code
        self.node_id = node_id
        super().__init__(message)

    def diagnostic(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "severity": "error", "code": self.code, "message": str(self),
        }
        if self.node_id:
            result["node_id"] = self.node_id
        return result


def _clean_id(value: object) -> str:
    text = re.sub(r"[^a-zA-Z0-9_.-]+", "-", str(value)).strip("-")
    return text or "node"


def _node_dict(node: Mapping[str, Any] | object) -> dict[str, Any]:
    if isinstance(node, Mapping):
        return dict(node)
    if hasattr(node, "model_dump"):
        return dict(node.model_dump(mode="python"))
    raise TypeError("graph nodes must be mappings or Pydantic models")


def _edge_dict(edge: Mapping[str, Any] | object) -> dict[str, Any]:
    if isinstance(edge, Mapping):
        return dict(edge)
    if hasattr(edge, "model_dump"):
        return dict(edge.model_dump(mode="python", exclude_none=True))
    raise TypeError("graph edges must be mappings or Pydantic models")


# Boolean expressions use tuples so they remain cheap, immutable and easy to
# compile through one authoritative ROBDD manager.
Expr = tuple[Any, ...]


def _const(value: bool) -> Expr:
    return ("const", bool(value))


def _var(name: str) -> Expr:
    return ("var", str(name))


def _fold(kind: str, values: Iterable[Expr]) -> Expr:
    flattened: list[Expr] = []
    identity = kind == "and"
    absorbing = not identity
    for value in values:
        if value[0] == "const":
            if bool(value[1]) == absorbing:
                return _const(absorbing)
            continue
        if value[0] == kind:
            flattened.extend(value[1:])
        else:
            flattened.append(value)
    if not flattened:
        return _const(identity)
    unique = list(dict.fromkeys(flattened))
    if len(unique) == 1:
        return unique[0]
    return (kind, *unique)


def _atleast(values: Sequence[Expr], threshold: int) -> Expr:
    constants_true = sum(value == _const(True) for value in values)
    remaining = [value for value in values if value[0] != "const"]
    threshold -= constants_true
    if threshold <= 0:
        return _const(True)
    if threshold > len(remaining):
        return _const(False)
    if threshold == 1:
        return _fold("or", remaining)
    if threshold == len(remaining):
        return _fold("and", remaining)
    return ("atleast", threshold, *remaining)


def _variables(expression: Expr) -> set[str]:
    if expression[0] == "var":
        return {str(expression[1])}
    if expression[0] == "const":
        return set()
    start = 2 if expression[0] == "atleast" else 1
    result: set[str] = set()
    for child in expression[start:]:
        result.update(_variables(child))
    return result


def _compile_bdd(expression: Expr, manager: BDDManager) -> int:
    kind = expression[0]
    if kind == "const":
        return int(bool(expression[1]))
    if kind == "var":
        return manager.variable(str(expression[1]))
    if kind in {"and", "or"}:
        values = [_compile_bdd(child, manager) for child in expression[1:]]
        return manager.fold(kind, values, 1 if kind == "and" else 0)
    if kind == "atleast":
        values = [_compile_bdd(child, manager) for child in expression[2:]]
        return manager.atleast(values, int(expression[1]))
    raise ValueError(f"unknown Boolean expression {kind!r}")


def _prove_equal(left: Expr, right: Expr, max_bdd_nodes: int) -> dict[str, Any]:
    variables = sorted(_variables(left) | _variables(right))
    manager = BDDManager(variables, max_nodes=max_bdd_nodes)
    left_root = _compile_bdd(left, manager)
    right_root = _compile_bdd(right, manager)
    if left_root != right_root:
        raise ModelConversionError(
            "EQUIVALENCE_CHECK_FAILED",
            "The generated model did not reproduce the source structure function.",
        )
    return {
        "method": "canonical_roBDD",
        "equivalent": True,
        "logical_variables": len(variables),
        "bdd_nodes": len(manager.nodes),
    }


def _rbd_graph_parts(nodes: Sequence[Mapping[str, Any] | object],
                     edges: Sequence[Mapping[str, Any] | object]):
    node_list = [_node_dict(node) for node in nodes]
    edge_list = [_edge_dict(edge) for edge in edges]
    by_id = {str(node["id"]): node for node in node_list}
    outgoing = {node_id: [] for node_id in by_id}
    incoming = {node_id: [] for node_id in by_id}
    for edge in edge_list:
        source, target = str(edge.get("source", "")), str(edge.get("target", ""))
        if source not in by_id or target not in by_id:
            raise ModelConversionError(
                "DANGLING_EDGE", f"Connection {source!r} → {target!r} references a missing node.")
        outgoing[source].append(target)
        incoming[target].append(source)
    sources = [node_id for node_id, node in by_id.items() if node.get("type") == "source"]
    sinks = [node_id for node_id, node in by_id.items() if node.get("type") == "sink"]
    if len(sources) != 1 or len(sinks) != 1:
        raise ModelConversionError(
            "RBD_TERMINALS", "Exact conversion requires exactly one RBD source and one sink.")
    return node_list, edge_list, by_id, outgoing, incoming, sources[0], sinks[0]


def _rbd_failure_expression(nodes: Sequence[Mapping[str, Any] | object],
                            edges: Sequence[Mapping[str, Any] | object]) -> Expr:
    """Return the failure-to-reach-sink function in component-failure variables.

    The forward dual recurrence also covers generalized voting junctions whose
    incoming connections are complete branch/subsystem outcomes.
    """
    _node_list, _edge_list, by_id, outgoing, incoming, source, sink = (
        _rbd_graph_parts(nodes, edges)
    )
    indegree = {node_id: len(incoming[node_id]) for node_id in by_id}
    queue = sorted((node_id for node_id, degree in indegree.items() if degree == 0))
    order: list[str] = []
    while queue:
        node_id = queue.pop(0)
        order.append(node_id)
        for target in outgoing[node_id]:
            indegree[target] -= 1
            if indegree[target] == 0:
                queue.append(target)
                queue.sort()
    if len(order) != len(by_id):
        raise ModelConversionError("RBD_CYCLE", "Cyclic RBDs cannot be converted to a fault tree.")
    failure_to_reach: dict[str, Expr] = {source: _const(False)}
    for node_id in order:
        if node_id == source:
            continue
        node = by_id[node_id]
        predecessor_failures = [failure_to_reach[parent] for parent in incoming[node_id]]
        node_type = str(node.get("type", ""))
        if node_type == "kofn":
            k = int(dict(node.get("data") or {}).get("k", 0))
            failure_to_reach[node_id] = _atleast(
                predecessor_failures, len(predecessor_failures) - k + 1)
        else:
            upstream_failure = _fold("and", predecessor_failures)
            if node_type == "component":
                data = dict(node.get("data") or {})
                component_failure = (
                    _const(not bool(data["conversion_constant"]))
                    if "conversion_constant" in data
                    else _var(str(data.get("component_key") or node_id))
                )
                upstream_failure = _fold("or", [upstream_failure, component_failure])
            failure_to_reach[node_id] = upstream_failure
    return failure_to_reach[sink]


def _fta_graph_parts(nodes: Sequence[Mapping[str, Any] | object],
                     edges: Sequence[Mapping[str, Any] | object]):
    node_list = [_node_dict(node) for node in nodes]
    edge_list = [_edge_dict(edge) for edge in edges]
    by_id = {str(node["id"]): node for node in node_list}
    children = {node_id: [] for node_id in by_id}
    has_parent: set[str] = set()
    for index, edge in enumerate(edge_list):
        source, target = str(edge.get("source", "")), str(edge.get("target", ""))
        if source not in by_id or target not in by_id:
            raise ModelConversionError(
                "DANGLING_EDGE", f"Connection {source!r} → {target!r} references a missing node.")
        children[source].append((
            int(edge.get("order", index)) if edge.get("order") is not None else index,
            target,
        ))
        has_parent.add(target)
    for node_id in children:
        children[node_id].sort(key=lambda item: (item[0], item[1]))
    roots = [node_id for node_id in by_id if node_id not in has_parent]
    if len(roots) != 1:
        raise ModelConversionError(
            "FTA_ROOT", f"Exact conversion requires one FTA top event; found {len(roots)}.")
    return by_id, {key: [target for _, target in value] for key, value in children.items()}, roots[0]


def _fta_failure_expression(nodes: Sequence[Mapping[str, Any] | object],
                            edges: Sequence[Mapping[str, Any] | object]) -> Expr:
    by_id, children, root = _fta_graph_parts(nodes, edges)
    cache: dict[str, Expr] = {}
    visiting: set[str] = set()

    def build(node_id: str) -> Expr:
        if node_id in cache:
            return cache[node_id]
        if node_id in visiting:
            raise ModelConversionError("FTA_CYCLE", "Cyclic fault trees cannot be converted to an RBD.")
        visiting.add(node_id)
        node = by_id[node_id]
        node_type = str(node.get("type", ""))
        data = dict(node.get("data") or {})
        values = [build(child) for child in children[node_id]]
        if node_type == "house":
            result = _const(bool(data.get("state", data.get("value", False))))
        elif node_type in {"basic", "undeveloped", "conditioning", "external"}:
            result = _var(str(data.get("eventKey") or node_id))
        elif node_type == "transfer":
            if len(values) != 1:
                raise ModelConversionError("TRANSFER_NOT_EXPANDED", "Transfer references must be expanded before conversion.", node_id=node_id)
            result = values[0]
        elif node_type in {"and", "inhibit"}:
            result = _fold("and", values)
        elif node_type == "or":
            result = _fold("or", values)
        elif node_type == "vote":
            result = _atleast(values, int(data.get("k", 2)))
        elif node_type == "cardinality":
            low = int(data.get("min", data.get("low", 1)))
            high = int(data.get("max", data.get("high", len(values))))
            if high != len(values):
                raise ModelConversionError(
                    "NON_COHERENT_CARDINALITY",
                    "A cardinality gate with an upper bound is non-coherent and has no exact passive-RBD equivalent.",
                    node_id=node_id)
            result = _atleast(values, low)
        else:
            raise ModelConversionError(
                "UNSUPPORTED_FTA_SEMANTICS",
                f"{node_type.upper() or 'Unknown'} logic has no exact passive-RBD equivalent.",
                node_id=node_id)
        visiting.remove(node_id)
        cache[node_id] = result
        return result

    return build(root)


class _FTAEmitter:
    def __init__(self, component_nodes: Mapping[str, Mapping[str, Any]], max_nodes: int):
        self.component_nodes = component_nodes
        self.max_nodes = max_nodes
        self.nodes: list[dict[str, Any]] = []
        self.edges: list[dict[str, Any]] = []
        self._event_ids: dict[str, str] = {}
        self._sequence = 0

    def _append(self, node: dict[str, Any]) -> str:
        if len(self.nodes) >= self.max_nodes:
            raise ModelConversionError(
                "CONVERSION_EXPANSION_LIMIT",
                f"Exact conversion would exceed the {self.max_nodes:,}-node generation limit.")
        self.nodes.append(node)
        return str(node["id"])

    def event(self, key: str) -> str:
        existing = self._event_ids.get(key)
        if existing:
            return existing
        source = self.component_nodes[key]
        data = dict(source.get("data") or {})
        target_data: dict[str, Any] = {
            "label": data.get("label") or source.get("id") or key,
            "eventKey": key,
            "sourceNodeId": source.get("id"),
        }
        for field in ("description", "extendedDescription", "diagramColor",
                      "ccf_group", "ccf_beta"):
            if data.get(field) is not None:
                target_data[field] = data[field]
        if data.get("ldaSource") is not None:
            target_data["ldaFolioId"] = data["ldaSource"]
        if data.get("ldaSourceName") is not None:
            target_data["ldaFolioName"] = data["ldaSourceName"]
        if data.get("distribution"):
            target_data.update({
                "distribution": data["distribution"],
                "dist_params": dict(data.get("dist_params") or {}),
            })
            if data.get("mission_time") is not None:
                target_data["exposure_time"] = data["mission_time"]
        else:
            target_data["probability"] = 1.0 - float(data.get("reliability", 1.0))
        node_id = self._append({
            "id": f"evt-{_clean_id(source.get('id') or key)}-{len(self._event_ids) + 1}",
            "type": "basic", "data": target_data,
        })
        self._event_ids[key] = node_id
        return node_id

    def emit(self, expression: Expr) -> str:
        kind = expression[0]
        if kind == "var":
            return self.event(str(expression[1]))
        if kind == "const":
            return self._append({
                "id": f"house-{len(self.nodes) + 1}", "type": "house",
                "data": {"label": "Constant failure state", "state": bool(expression[1])},
            })
        child_ids = [self.emit(child) for child in expression[2 if kind == "atleast" else 1:]]
        self._sequence += 1
        gate_type = "vote" if kind == "atleast" else kind
        data: dict[str, Any] = {
            "label": "Converted voting gate" if gate_type == "vote" else f"Converted {gate_type.upper()} gate",
            "gateId": f"CONV-{gate_type.upper()}-{self._sequence}",
        }
        if gate_type == "vote":
            data["k"] = int(expression[1])
        gate_id = self._append({
            "id": f"gate-{gate_type}-{self._sequence}", "type": gate_type, "data": data,
        })
        for index, child_id in enumerate(child_ids):
            self.edges.append({
                "id": f"edge-{gate_id}-{index + 1}", "source": gate_id,
                "target": child_id, "role": "input", "order": index,
            })
        return gate_id


def convert_rbd_to_fta(nodes: Sequence[Mapping[str, Any] | object],
                       edges: Sequence[Mapping[str, Any] | object], *,
                       max_generated_nodes: int = 5_000,
                       max_bdd_nodes: int = 250_000) -> dict[str, Any]:
    """Convert one validated acyclic RBD into an exact coherent fault tree."""
    source_nodes = [_node_dict(node) for node in nodes]
    expression = _rbd_failure_expression(source_nodes, edges)
    component_by_key: dict[str, Mapping[str, Any]] = {}
    for node in source_nodes:
        if node.get("type") != "component":
            continue
        data = dict(node.get("data") or {})
        component_by_key.setdefault(str(data.get("component_key") or node["id"]), node)
    emitter = _FTAEmitter(component_by_key, max_generated_nodes)
    emitter.emit(expression)
    target_expression = _fta_failure_expression(emitter.nodes, emitter.edges)
    verification = _prove_equal(expression, target_expression, max_bdd_nodes)
    return {
        "nodes": emitter.nodes,
        "edges": emitter.edges,
        "verification": verification,
        "summary": {
            "source_nodes": len(source_nodes), "source_edges": len(edges),
            "target_nodes": len(emitter.nodes), "target_edges": len(emitter.edges),
            "logical_events": len(component_by_key),
        },
    }


@dataclass
class _Fragment:
    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]
    entries: list[str]
    exits: list[str]
    constant: bool | None = None


class _RBDBuilder:
    def __init__(self, by_id: Mapping[str, Mapping[str, Any]],
                 children: Mapping[str, Sequence[str]], max_nodes: int):
        self.by_id = by_id
        self.children = children
        self.max_nodes = max_nodes
        self.sequence = 0

    def _check(self, count: int) -> None:
        if count > self.max_nodes:
            raise ModelConversionError(
                "CONVERSION_EXPANSION_LIMIT",
                f"Exact conversion would exceed the {self.max_nodes:,}-node generation limit. "
                "Convert smaller referenced subtrees separately or retry with a larger limit.")

    def _component(self, node_id: str) -> _Fragment:
        source = self.by_id[node_id]
        data = dict(source.get("data") or {})
        self.sequence += 1
        component_id = f"component-{self.sequence}"
        target_data: dict[str, Any] = {
            "label": data.get("label") or node_id,
            "description": data.get("description") or data.get("extendedDescription") or "",
            "component_key": str(data.get("eventKey") or node_id),
            "sourceNodeId": node_id,
        }
        for field in ("diagramColor", "ccf_group", "ccf_beta"):
            if data.get(field) is not None:
                target_data[field] = data[field]
        if data.get("ldaFolioId") is not None:
            target_data["ldaSource"] = data["ldaFolioId"]
        if data.get("ldaFolioName") is not None:
            target_data["ldaSourceName"] = data["ldaFolioName"]
        if data.get("distribution"):
            target_data.update({
                "distribution": data["distribution"],
                "dist_params": dict(data.get("dist_params") or {}),
            })
            if data.get("exposure_time") is not None:
                target_data["mission_time"] = data["exposure_time"]
        else:
            target_data["reliability"] = 1.0 - float(data.get("probability", 0.0))
        node = {"id": component_id, "type": "component", "data": target_data}
        return _Fragment([node], [], [component_id], [component_id])

    @staticmethod
    def _series(fragments: Sequence[_Fragment]) -> _Fragment:
        usable = [fragment for fragment in fragments if fragment.constant is not True]
        if any(fragment.constant is False for fragment in fragments):
            return _Fragment([], [], [], [], False)
        if not usable:
            return _Fragment([], [], [], [], True)
        nodes = [node for fragment in usable for node in fragment.nodes]
        edges = [edge for fragment in usable for edge in fragment.edges]
        for left, right in zip(usable, usable[1:]):
            for source in left.exits:
                for target in right.entries:
                    edges.append({"id": f"edge-{source}-{target}", "source": source, "target": target})
        return _Fragment(nodes, edges, list(usable[0].entries), list(usable[-1].exits))

    @staticmethod
    def _parallel(fragments: Sequence[_Fragment]) -> _Fragment:
        if any(fragment.constant is True for fragment in fragments):
            return _Fragment([], [], [], [], True)
        usable = [fragment for fragment in fragments if fragment.constant is not False]
        if not usable:
            return _Fragment([], [], [], [], False)
        return _Fragment(
            [node for fragment in usable for node in fragment.nodes],
            [edge for fragment in usable for edge in fragment.edges],
            [entry for fragment in usable for entry in fragment.entries],
            [exit_id for fragment in usable for exit_id in fragment.exits],
        )

    def _threshold(self, child_ids: Sequence[str], required: int, label: str) -> _Fragment:
        if required <= 0:
            return _Fragment([], [], [], [], True)
        if required > len(child_ids):
            return _Fragment([], [], [], [], False)
        raw_members = [self.build(child) for child in child_ids]
        required -= sum(member.constant is True for member in raw_members)
        members = [member for member in raw_members if member.constant is None]
        if required <= 0:
            return _Fragment([], [], [], [], True)
        if required > len(members):
            return _Fragment([], [], [], [], False)
        if len(members) == 1:
            return members[0]

        # A threshold counts one Boolean outcome per input subtree.  Give a
        # parallel child with several terminal blocks an explicit perfect
        # 1-of-n merge so it reaches the outer vote through one predecessor.
        normalized: list[_Fragment] = []
        for member in members:
            if len(member.exits) <= 1:
                normalized.append(member)
                continue
            self.sequence += 1
            merge_id = f"vote-{self.sequence}"
            merge = {"id": merge_id, "type": "kofn", "data": {
                "label": "Converted branch merge", "k": 1,
            }}
            normalized.append(_Fragment(
                [*member.nodes, merge],
                [*member.edges, *[
                    {"id": f"edge-{exit_id}-{merge_id}", "source": exit_id, "target": merge_id}
                    for exit_id in member.exits
                ]],
                list(member.entries), [merge_id],
            ))

        self.sequence += 1
        vote_id = f"vote-{self.sequence}"
        nodes = [node for member in normalized for node in member.nodes]
        edges = [edge for member in normalized for edge in member.edges]
        nodes.append({"id": vote_id, "type": "kofn", "data": {"label": label, "k": required}})
        for member in normalized:
            edges.append({
                "id": f"edge-{member.exits[0]}-{vote_id}",
                "source": member.exits[0], "target": vote_id,
            })
        self._check(len(nodes))
        return _Fragment(
            nodes, edges,
            [entry for member in normalized for entry in member.entries], [vote_id],
        )

    def build(self, node_id: str) -> _Fragment:
        node = self.by_id[node_id]
        node_type = str(node.get("type", ""))
        data = dict(node.get("data") or {})
        child_ids = list(self.children[node_id])
        if node_type == "house":
            return _Fragment([], [], [], [], not bool(data.get("state", data.get("value", False))))
        if node_type in {"basic", "undeveloped", "conditioning", "external"}:
            return self._component(node_id)
        if node_type == "transfer":
            if len(child_ids) != 1:
                raise ModelConversionError("TRANSFER_NOT_EXPANDED", "Transfer references must be expanded before conversion.", node_id=node_id)
            return self.build(child_ids[0])
        if node_type == "or":
            return self._series([self.build(child) for child in child_ids])
        if node_type in {"and", "inhibit"}:
            return self._parallel([self.build(child) for child in child_ids])
        if node_type == "vote":
            failure_k = int(data.get("k", 2))
            return self._threshold(child_ids, len(child_ids) - failure_k + 1,
                                   f"Success threshold for {data.get('label') or node_id}")
        if node_type == "cardinality":
            low = int(data.get("min", data.get("low", 1)))
            high = int(data.get("max", data.get("high", len(child_ids))))
            if high != len(child_ids):
                raise ModelConversionError(
                    "NON_COHERENT_CARDINALITY",
                    "A cardinality gate with an upper bound is non-coherent and has no exact passive-RBD equivalent.",
                    node_id=node_id)
            return self._threshold(child_ids, len(child_ids) - low + 1,
                                   f"Success threshold for {data.get('label') or node_id}")
        raise ModelConversionError(
            "UNSUPPORTED_FTA_SEMANTICS",
            f"{node_type.upper() or 'Unknown'} logic has no exact passive-RBD equivalent.",
            node_id=node_id)


def convert_fta_to_rbd(nodes: Sequence[Mapping[str, Any] | object],
                       edges: Sequence[Mapping[str, Any] | object], *,
                       max_generated_nodes: int = 5_000,
                       max_bdd_nodes: int = 250_000) -> dict[str, Any]:
    """Convert one expanded static coherent fault tree into an exact RBD."""
    source_nodes = [_node_dict(node) for node in nodes]
    source_edges = [_edge_dict(edge) for edge in edges]
    source_expression = _fta_failure_expression(source_nodes, source_edges)
    by_id, children, root = _fta_graph_parts(source_nodes, source_edges)
    builder = _RBDBuilder(by_id, children, max_generated_nodes)
    fragment = builder.build(root)
    target_nodes: list[dict[str, Any]] = [
        {"id": "source", "type": "source", "data": {"label": "Source"}},
        {"id": "sink", "type": "sink", "data": {"label": "Sink"}},
    ]
    target_edges: list[dict[str, Any]] = list(fragment.edges)
    if fragment.constant is not None:
        constant_id = "component-constant"
        target_nodes.append({
            "id": constant_id, "type": "component",
            "data": {
                "label": "Constant converted state",
                "description": "Generated from a constant fault-tree structure.",
                "component_key": constant_id,
                "reliability": 1.0 if fragment.constant else 0.0,
                "conversion_constant": fragment.constant,
            },
        })
        target_edges.extend([
            {"id": "edge-source-constant", "source": "source", "target": constant_id},
            {"id": "edge-constant-sink", "source": constant_id, "target": "sink"},
        ])
    else:
        target_nodes.extend(fragment.nodes)
        for entry in fragment.entries:
            target_edges.append({"id": f"edge-source-{entry}", "source": "source", "target": entry})
        for exit_id in fragment.exits:
            target_edges.append({"id": f"edge-{exit_id}-sink", "source": exit_id, "target": "sink"})
    if len(target_nodes) > max_generated_nodes + 2:
        raise ModelConversionError(
            "CONVERSION_EXPANSION_LIMIT",
            f"Exact conversion would exceed the {max_generated_nodes:,}-node generation limit.")
    target_expression = _rbd_failure_expression(target_nodes, target_edges)
    verification = _prove_equal(source_expression, target_expression, max_bdd_nodes)
    return {
        "nodes": target_nodes,
        "edges": target_edges,
        "verification": verification,
        "summary": {
            "source_nodes": len(source_nodes), "source_edges": len(source_edges),
            "target_nodes": len(target_nodes), "target_edges": len(target_edges),
            "logical_events": len(_variables(source_expression)),
        },
    }


__all__ = [
    "ModelConversionError", "convert_rbd_to_fta", "convert_fta_to_rbd",
    "BDDStateLimitError",
]
