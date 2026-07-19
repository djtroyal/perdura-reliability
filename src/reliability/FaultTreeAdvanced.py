"""Typed static and dynamic fault-tree evaluation.

This module deliberately separates three concepts that the historical FTA
implementation combined:

* the diagram (nodes, typed/ordered input edges and dependency constructs),
* the Boolean structure function used by static fault trees, and
* chronological failure-time semantics used by dynamic fault trees.

Static trees, including non-coherent logic, are evaluated with a reduced
ordered binary decision diagram (ROBDD).  Dynamic trees are evaluated by an
event-time simulation that preserves repeated-event identity and the order of
simultaneous failures.  A simulation result is never described as exact.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
import math
from statistics import NormalDist
from typing import Any, Callable, Iterable, Mapping, Sequence

import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.linalg import expm_multiply


STATIC_GATE_TYPES = frozenset({
    "and", "or", "vote", "cardinality", "xor", "not", "nand", "nor",
    "iff", "imply", "inhibit",
})
DYNAMIC_GATE_TYPES = frozenset({"pand", "por", "spare"})
CONSTRAINT_TYPES = frozenset({"fdep", "seq"})
PASS_THROUGH_TYPES = frozenset({"transfer"})
STOCHASTIC_EVENT_TYPES = frozenset({
    "basic", "undeveloped", "conditioning", "external",
})
EVENT_TYPES = STOCHASTIC_EVENT_TYPES | {"house"}
SUPPORTED_NODE_TYPES = (
    STATIC_GATE_TYPES | DYNAMIC_GATE_TYPES | CONSTRAINT_TYPES
    | PASS_THROUGH_TYPES | EVENT_TYPES
)

COHERENT_GATE_TYPES = frozenset({"and", "or", "vote", "inhibit"})
ORDERED_GATE_TYPES = frozenset({"pand", "por", "spare", "imply"})


class FaultTreeValidationError(ValueError):
    """A fault-tree graph has one or more actionable model errors."""

    def __init__(self, issues: Sequence[Mapping[str, Any]]):
        self.issues = [dict(issue) for issue in issues]
        message = "; ".join(str(issue.get("message", "Invalid fault tree"))
                            for issue in self.issues)
        super().__init__(message or "Invalid fault tree")


class BDDStateLimitError(ValueError):
    """The configured ROBDD node limit was exceeded."""


class DynamicExactIneligible(ValueError):
    """A dynamic tree cannot be represented by the bounded exact CTMC."""

    def __init__(self, reasons: Sequence[str]):
        self.reasons = list(reasons)
        super().__init__(" ".join(self.reasons))


def _as_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return bool(value)
    if isinstance(value, str):
        text = value.strip().lower()
        if text in {"true", "yes", "1", "on", "failed", "active"}:
            return True
        if text in {"false", "no", "0", "off", "success", "inactive"}:
            return False
    return default


def _finite_float(value: Any, default: float | None = None) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return parsed if math.isfinite(parsed) else default


@dataclass(frozen=True)
class GraphNode:
    id: str
    type: str
    data: Mapping[str, Any]

    @property
    def label(self) -> str:
        return str(self.data.get("label") or self.id)

    @property
    def event_key(self) -> str:
        # Display labels are intentionally not identities.  Two events merge
        # only through an explicit eventKey/reference.
        return str(self.data.get("eventKey") or self.id)


@dataclass(frozen=True)
class GraphEdge:
    source: str
    target: str
    role: str | None = None
    order: int | None = None
    id: str | None = None
    insertion: int = 0


@dataclass
class CompiledGraph:
    nodes: dict[str, GraphNode]
    edges: list[GraphEdge]
    inputs: dict[str, list[GraphEdge]]
    root_id: str
    event_nodes: dict[str, list[str]]
    dynamic: bool
    coherent: bool
    warnings: list[dict[str, Any]] = field(default_factory=list)

    def children(self, node_id: str) -> list[str]:
        return [edge.target for edge in self.inputs.get(node_id, [])]

    def event_key_for_node(self, node_id: str) -> str:
        return self.nodes[node_id].event_key


def _edge_sort_key(edge: GraphEdge) -> tuple[int, int, str]:
    return (
        edge.order if edge.order is not None else 1_000_000 + edge.insertion,
        edge.insertion,
        edge.target,
    )


def _default_roles(node_type: str, edges: list[GraphEdge]) -> list[GraphEdge]:
    """Fill deterministic roles without deriving semantics from canvas position."""
    ordered = sorted(edges, key=_edge_sort_key)
    result: list[GraphEdge] = []
    for index, edge in enumerate(ordered):
        role = edge.role
        if not role:
            if node_type == "inhibit":
                role = "primary" if index == 0 else "condition"
            elif node_type == "imply":
                role = "antecedent" if index == 0 else "consequent"
            elif node_type == "por":
                role = "priority" if index == 0 else "blocker"
            elif node_type == "spare":
                role = "primary" if index == 0 else "spare"
            elif node_type == "fdep":
                role = "trigger" if index == 0 else "dependent"
            elif node_type == "seq":
                role = "sequence"
            else:
                role = "input"
        result.append(GraphEdge(
            source=edge.source,
            target=edge.target,
            role=role,
            order=index if edge.order is None else edge.order,
            id=edge.id,
            insertion=edge.insertion,
        ))
    return sorted(result, key=_edge_sort_key)


def compile_graph(nodes: Iterable[Mapping[str, Any]],
                  edges: Iterable[Mapping[str, Any]]) -> CompiledGraph:
    """Normalize and validate a fault-tree graph.

    Edges run from an output gate/event to its input child, matching the
    existing Perdura canvas contract.  FDEP and SEQ outgoing edges are
    dependency edges and therefore do not make their targets non-root causal
    nodes.
    """
    issues: list[dict[str, Any]] = []
    node_map: dict[str, GraphNode] = {}
    for raw in nodes:
        node_id = str(raw.get("id", "")).strip()
        node_type = str(raw.get("type", "")).strip().lower()
        if not node_id:
            issues.append({"code": "NODE_ID_REQUIRED", "message": "Every node requires an id."})
            continue
        if node_id in node_map:
            issues.append({"code": "DUPLICATE_NODE_ID", "node_id": node_id,
                           "message": f"Node id {node_id!r} is duplicated."})
            continue
        if node_type not in SUPPORTED_NODE_TYPES:
            issues.append({"code": "UNSUPPORTED_NODE_TYPE", "node_id": node_id,
                           "message": f"Node {node_id!r} uses unsupported type {node_type!r}."})
        node_map[node_id] = GraphNode(
            id=node_id, type=node_type,
            data=dict(raw.get("data") or {}),
        )

    normalized_edges: list[GraphEdge] = []
    seen_edges: set[tuple[str, str, str | None, int | None]] = set()
    for index, raw in enumerate(edges):
        source = str(raw.get("source", "")).strip()
        target = str(raw.get("target", "")).strip()
        role_raw = raw.get("role")
        role = str(role_raw).strip().lower() if role_raw not in (None, "") else None
        order_raw = raw.get("order")
        try:
            order = int(order_raw) if order_raw is not None else None
        except (TypeError, ValueError):
            order = None
            issues.append({"code": "INVALID_EDGE_ORDER", "edge_id": raw.get("id"),
                           "message": f"Connection {source!r} → {target!r} has a non-integer order."})
        if source not in node_map or target not in node_map:
            issues.append({"code": "DANGLING_EDGE", "edge_id": raw.get("id"),
                           "message": f"Connection {source!r} → {target!r} references a missing node."})
            continue
        if source == target:
            issues.append({"code": "SELF_LOOP", "node_id": source,
                           "message": f"Node {source!r} cannot connect to itself."})
            continue
        signature = (source, target, role, order)
        if signature in seen_edges:
            issues.append({"code": "DUPLICATE_EDGE", "node_id": source,
                           "message": f"Connection {source!r} → {target!r} is duplicated."})
            continue
        seen_edges.add(signature)
        normalized_edges.append(GraphEdge(
            source=source, target=target, role=role, order=order,
            id=str(raw.get("id")) if raw.get("id") is not None else None,
            insertion=index,
        ))

    inputs: dict[str, list[GraphEdge]] = {node_id: [] for node_id in node_map}
    for edge in normalized_edges:
        inputs[edge.source].append(edge)
    for node_id, node_edges in list(inputs.items()):
        inputs[node_id] = _default_roles(node_map[node_id].type, node_edges)

    # Causal-cycle validation. Constraint constructs receive their own cycle
    # validation in the dynamic evaluator.
    color: dict[str, int] = {node_id: 0 for node_id in node_map}

    def visit(node_id: str, path: list[str]) -> None:
        if color[node_id] == 1:
            cycle = path[path.index(node_id):] + [node_id] if node_id in path else path + [node_id]
            issues.append({"code": "CAUSAL_CYCLE", "node_id": node_id,
                           "message": "Fault-tree causal cycle: " + " → ".join(cycle)})
            return
        if color[node_id] == 2:
            return
        color[node_id] = 1
        if node_map[node_id].type not in CONSTRAINT_TYPES:
            for edge in inputs.get(node_id, []):
                visit(edge.target, path + [node_id])
        color[node_id] = 2

    for node_id in node_map:
        if color[node_id] == 0:
            visit(node_id, [])

    # Gate arity and role checks.
    for node_id, node in node_map.items():
        child_edges = inputs.get(node_id, [])
        n = len(child_edges)
        roles = [edge.role for edge in child_edges]
        if node.type in EVENT_TYPES and n:
            issues.append({"code": "EVENT_HAS_INPUTS", "node_id": node_id,
                           "message": f"Event {node.label!r} cannot have child inputs."})
        elif node.type == "or" and n < 1:
            issues.append({"code": "GATE_ARITY", "node_id": node_id,
                           "message": f"OR gate {node.label!r} requires at least one input."})
        elif node.type in {"and", "nand", "nor", "vote", "cardinality", "pand", "por", "spare"} and n < 2:
            issues.append({"code": "GATE_ARITY", "node_id": node_id,
                           "message": f"{node.type.upper()} gate {node.label!r} requires at least two inputs."})
        elif node.type in {"xor", "iff", "imply", "inhibit"} and n != 2:
            issues.append({"code": "GATE_ARITY", "node_id": node_id,
                           "message": f"{node.type.upper()} gate {node.label!r} requires exactly two inputs."})
        elif node.type == "not" and n != 1:
            issues.append({"code": "GATE_ARITY", "node_id": node_id,
                           "message": f"NOT gate {node.label!r} requires exactly one input."})
        elif node.type in PASS_THROUGH_TYPES:
            if node.type == "transfer" and n == 0 and node.data.get("transferTo"):
                pass  # The router expands configured transfers before compile.
            elif n != 1:
                issues.append({"code": "PASS_THROUGH_ARITY", "node_id": node_id,
                               "message": f"{node.label!r} requires exactly one input."})
        elif node.type == "fdep":
            if roles.count("trigger") != 1 or roles.count("dependent") < 1:
                issues.append({"code": "FDEP_ROLES", "node_id": node_id,
                               "message": f"FDEP {node.label!r} requires one trigger and at least one dependent event."})
        elif node.type == "seq" and n < 2:
            issues.append({"code": "SEQ_ARITY", "node_id": node_id,
                           "message": f"SEQ {node.label!r} requires at least two ordered events."})

        if node.type in ORDERED_GATE_TYPES | CONSTRAINT_TYPES | {"inhibit"}:
            orders = [edge.order for edge in child_edges]
            if len(set(orders)) != len(orders):
                issues.append({
                    "code": "DUPLICATE_INPUT_ORDER", "node_id": node_id,
                    "message": f"{node.type.upper()} {node.label!r} requires a unique order for every input.",
                })
        required_roles = {
            "por": {"priority": 1, "blocker": -1},
            "spare": {"primary": 1, "spare": -1},
            "imply": {"antecedent": 1, "consequent": 1},
            "inhibit": {"primary": 1, "condition": 1},
        }.get(node.type)
        if required_roles:
            for role, count in required_roles.items():
                actual = roles.count(role)
                valid = actual >= 1 if count < 0 else actual == count
                if not valid:
                    issues.append({
                        "code": "INPUT_ROLES", "node_id": node_id,
                        "message": (
                            f"{node.type.upper()} {node.label!r} requires "
                            f"{'at least one' if count < 0 else str(count)} {role} input(s)."
                        ),
                    })

        if node.type == "vote":
            k = node.data.get("k", 2)
            try:
                valid = int(k) == k and 1 <= int(k) <= n
            except (TypeError, ValueError):
                valid = False
            if not valid:
                issues.append({"code": "VOTE_THRESHOLD", "node_id": node_id,
                               "message": f"VOTE {node.label!r} requires an integer k between 1 and {n}."})
        if node.type == "cardinality":
            low = node.data.get("min", node.data.get("low", 1))
            high = node.data.get("max", node.data.get("high", n))
            try:
                valid = (int(low) == low and int(high) == high
                         and 0 <= int(low) <= int(high) <= n)
            except (TypeError, ValueError):
                valid = False
            if not valid:
                issues.append({"code": "CARDINALITY_RANGE", "node_id": node_id,
                               "message": f"Cardinality {node.label!r} requires 0 ≤ minimum ≤ maximum ≤ {n}."})
        if node.type == "spare":
            mode = str(node.data.get("spare_mode", "cold")).lower()
            alpha = _finite_float(node.data.get("dormancy_factor"),
                                  {"cold": 0.0, "warm": 0.5, "hot": 1.0}.get(mode))
            coverage = _finite_float(node.data.get("coverage", 1.0))
            if mode not in {"cold", "warm", "hot"}:
                issues.append({"code": "SPARE_MODE", "node_id": node_id,
                               "message": f"SPARE {node.label!r} mode must be cold, warm, or hot."})
            if alpha is None or not 0 <= alpha <= 1:
                issues.append({"code": "SPARE_DORMANCY", "node_id": node_id,
                               "message": f"SPARE {node.label!r} dormancy factor must be between 0 and 1."})
            if coverage is None or not 0 <= coverage <= 1:
                issues.append({"code": "SPARE_COVERAGE", "node_id": node_id,
                               "message": f"SPARE {node.label!r} coverage must be between 0 and 1."})
            for edge in child_edges:
                child_type = node_map[edge.target].type
                if child_type not in EVENT_TYPES:
                    issues.append({"code": "SPARE_INPUT_TYPE", "node_id": node_id,
                                   "message": f"SPARE {node.label!r} inputs must be event nodes; {node_map[edge.target].label!r} is {child_type}."})
        if node.type in {"fdep", "seq"}:
            for edge in child_edges:
                if edge.role == "trigger" and node.type == "fdep":
                    continue
                if node_map[edge.target].type not in EVENT_TYPES:
                    issues.append({"code": "DYNAMIC_CONSTRAINT_INPUT", "node_id": node_id,
                                   "message": f"{node.type.upper()} dependent/sequence inputs must be event nodes."})
        if node.type in {"pand", "por"}:
            for edge in child_edges:
                child = node_map[edge.target]
                upper = _finite_float(child.data.get(
                    "max", child.data.get("high", len(inputs.get(child.id, [])))))
                bounded_cardinality = (
                    child.type == "cardinality"
                    and upper != len(inputs.get(child.id, []))
                )
                if child.type in {"not", "xor", "nand", "nor", "iff", "imply"} or bounded_cardinality:
                    issues.append({
                        "code": "DYNAMIC_INPUT_NO_FAILURE_TIME", "node_id": node_id,
                        "message": (
                            f"{node.type.upper()} {node.label!r} input {child.label!r} "
                            "can reverse state and has no unique occurrence time."
                        ),
                    })

    # Some dynamic constructs can be combined safely; resource/activation
    # ownership cannot. Fail closed where two constructs would otherwise write
    # competing occurrence times for the same logical event.
    spare_membership: dict[str, list[str]] = {}
    sequence_members: set[str] = set()
    sequence_predecessors: dict[str, set[str]] = {}
    fdep_dependents: set[str] = set()
    for node_id, node in node_map.items():
        if node.type == "spare":
            for edge in inputs[node_id]:
                key = node_map[edge.target].event_key
                spare_membership.setdefault(key, []).append(node_id)
        elif node.type == "seq":
            keys = [node_map[edge.target].event_key for edge in inputs[node_id]]
            sequence_members.update(keys)
            for predecessor, successor in zip(keys, keys[1:]):
                sequence_predecessors.setdefault(successor, set()).add(predecessor)
        elif node.type == "fdep":
            for edge in inputs[node_id]:
                if edge.role == "dependent":
                    fdep_dependents.add(node_map[edge.target].event_key)
    for key, owners in spare_membership.items():
        if len(owners) > 1:
            issues.append({
                "code": "SHARED_SPARE_RESOURCE", "node_id": owners[1],
                "message": (
                    f"Event {key!r} is allocated to multiple SPARE gates. "
                    "Shared spare pools require an explicit state-space resource model."
                ),
            })
    spare_keys = set(spare_membership)
    for key in sorted(spare_keys & (sequence_members | fdep_dependents)):
        issues.append({
            "code": "DYNAMIC_RESOURCE_CONFLICT",
            "message": (
                f"Event {key!r} is both a SPARE resource and a SEQ/FDEP-dependent event; "
                "those constructs define competing activation/failure times."
            ),
        })
    for key in sorted(sequence_members & fdep_dependents):
        issues.append({
            "code": "DYNAMIC_ACTIVATION_CONFLICT",
            "message": (
                f"Event {key!r} is both sequence-controlled and FDEP-dependent; "
                "the precedence versus forced-failure rule is ambiguous."
            ),
        })
    ccf_keys = {
        node.event_key for node in node_map.values()
        if node.type in STOCHASTIC_EVENT_TYPES
        and str(node.data.get("ccf_group") or "").strip()
    }
    for key in sorted(ccf_keys & (spare_keys | sequence_members)):
        issues.append({
            "code": "DYNAMIC_CCF_RESOURCE_CONFLICT",
            "message": (
                f"Common-cause event {key!r} is controlled by SPARE/SEQ effective age. "
                "Represent a calendar-time common shock explicitly so it is not transformed as component age."
            ),
        })

    sequence_color: dict[str, int] = {}

    def visit_sequence(key: str, path: list[str]) -> None:
        color_value = sequence_color.get(key, 0)
        if color_value == 1:
            cycle = path[path.index(key):] + [key] if key in path else path + [key]
            issues.append({
                "code": "SEQ_CYCLE",
                "message": "Sequence precedence cycle: " + " → ".join(cycle),
            })
            return
        if color_value == 2:
            return
        sequence_color[key] = 1
        for predecessor in sequence_predecessors.get(key, set()):
            visit_sequence(predecessor, path + [key])
        sequence_color[key] = 2

    for key in sequence_members:
        if sequence_color.get(key, 0) == 0:
            visit_sequence(key, [])

    # Root detection ignores outgoing dependency edges from FDEP/SEQ.
    has_causal_parent: set[str] = set()
    dependency_owned_events: set[str] = set()
    for edge in normalized_edges:
        if node_map[edge.source].type not in CONSTRAINT_TYPES:
            has_causal_parent.add(edge.target)
        elif node_map[edge.target].type in EVENT_TYPES:
            # A trigger/dependent used only by a constraint is an auxiliary
            # event in the same model, not a second causal top event.
            dependency_owned_events.add(edge.target)
    roots = [node_id for node_id, node in node_map.items()
             if (node.type not in CONSTRAINT_TYPES
                 and node_id not in has_causal_parent
                 and node_id not in dependency_owned_events)]
    if len(roots) != 1:
        issues.append({
            "code": "ROOT_COUNT",
            "message": ("Fault tree requires exactly one causal top event; "
                        f"found {len(roots)} ({', '.join(roots) or 'none'})."),
        })

    event_nodes: dict[str, list[str]] = {}
    event_signatures: dict[str, tuple[Any, ...]] = {}
    for node_id, node in node_map.items():
        if node.type not in EVENT_TYPES:
            continue
        key = node.event_key
        event_nodes.setdefault(key, []).append(node_id)
        if node.type == "house":
            signature = (node.type, _as_bool(node.data.get("state", node.data.get("value", False))))
        else:
            params = node.data.get("dist_params") or {}
            signature = (
                node.type,
                node.data.get("distribution"),
                tuple(sorted((str(k), repr(v)) for k, v in dict(params).items())),
                node.data.get("probability"),
                node.data.get("ccf_group"),
                node.data.get("ccf_beta"),
            )
        previous = event_signatures.get(key)
        if previous is not None and previous != signature:
            issues.append({"code": "REPEATED_EVENT_CONFLICT", "node_id": node_id,
                           "message": f"Repeated event {key!r} has inconsistent source or dependency settings."})
        event_signatures[key] = signature

    dynamic = any(node.type in DYNAMIC_GATE_TYPES | CONSTRAINT_TYPES
                  for node in node_map.values())

    # Dynamic event descendants require a time model. Direct mission
    # probabilities cannot recover occurrence order.
    if dynamic:
        dynamic_event_ids: set[str] = set()

        def collect_event_descendants(node_id: str, seen: set[str]) -> None:
            if node_id in seen:
                return
            seen.add(node_id)
            node = node_map[node_id]
            if node.type in EVENT_TYPES:
                dynamic_event_ids.add(node_id)
                return
            for edge in inputs.get(node_id, []):
                collect_event_descendants(edge.target, seen)

        for node_id, node in node_map.items():
            if node.type in DYNAMIC_GATE_TYPES | CONSTRAINT_TYPES:
                collect_event_descendants(node_id, set())
        # A dynamic analysis reports a probability curve for the complete top
        # event. Even a nominally static sibling branch therefore needs a time
        # law; a point probability cannot be propagated consistently away from
        # its one mission time.
        dynamic_event_ids.update(
            node_id for node_id, node in node_map.items()
            if node.type in EVENT_TYPES
        )
        for node_id in sorted(dynamic_event_ids):
            node = node_map[node_id]
            if node.type == "house":
                continue
            if not node.data.get("distribution"):
                issues.append({
                    "code": "DYNAMIC_TIME_MODEL_REQUIRED",
                    "node_id": node_id,
                    "message": (
                        f"Dynamic event {node.label!r} requires a rate or time-to-failure "
                        "distribution. A mission probability alone has no occurrence order."
                    ),
                })

    coherent = not dynamic
    for node in node_map.values():
        if node.type in CONSTRAINT_TYPES:
            continue
        if node.type in EVENT_TYPES | PASS_THROUGH_TYPES | COHERENT_GATE_TYPES:
            continue
        if node.type == "cardinality":
            try:
                upper = int(node.data.get(
                    "max", node.data.get("high", len(inputs.get(node.id, [])))))
            except (TypeError, ValueError):
                coherent = False
            else:
                coherent = coherent and upper == len(inputs.get(node.id, []))
            continue
        coherent = False

    if issues:
        raise FaultTreeValidationError(issues)
    return CompiledGraph(
        nodes=node_map,
        edges=normalized_edges,
        inputs=inputs,
        root_id=roots[0],
        event_nodes=event_nodes,
        dynamic=dynamic,
        coherent=coherent,
    )


class BDDManager:
    """Small deterministic ROBDD manager with an explicit node limit."""

    def __init__(self, variables: Sequence[str], max_nodes: int = 250_000):
        self.variables = tuple(variables)
        self.order = {name: index for index, name in enumerate(self.variables)}
        self.max_nodes = int(max_nodes)
        self.nodes: dict[int, tuple[int, int, int]] = {}
        self.unique: dict[tuple[int, int, int], int] = {}
        self._apply_cache: dict[tuple[str, int, int], int] = {}
        self._not_cache: dict[int, int] = {0: 1, 1: 0}
        self._next_id = 2

    def mk(self, variable: int, low: int, high: int) -> int:
        if low == high:
            return low
        key = (variable, low, high)
        existing = self.unique.get(key)
        if existing is not None:
            return existing
        if len(self.nodes) >= self.max_nodes:
            raise BDDStateLimitError(
                f"Exact fault-tree evaluation exceeded {self.max_nodes:,} ROBDD nodes."
            )
        node_id = self._next_id
        self._next_id += 1
        self.nodes[node_id] = key
        self.unique[key] = node_id
        return node_id

    def variable(self, name: str) -> int:
        return self.mk(self.order[name], 0, 1)

    def _var(self, node: int) -> int:
        return self.nodes[node][0] if node > 1 else len(self.variables) + 1

    @staticmethod
    def _terminal(op: str, left: int, right: int) -> int:
        a = bool(left)
        b = bool(right)
        if op == "and":
            value = a and b
        elif op == "or":
            value = a or b
        elif op == "xor":
            value = a != b
        elif op == "iff":
            value = a == b
        elif op == "imply":
            value = (not a) or b
        else:  # pragma: no cover - callers own the operation catalog
            raise ValueError(f"Unknown BDD operation {op!r}")
        return int(value)

    def apply(self, op: str, left: int, right: int) -> int:
        if left <= 1 and right <= 1:
            return self._terminal(op, left, right)
        key = (op, left, right)
        cached = self._apply_cache.get(key)
        if cached is not None:
            return cached
        variable = min(self._var(left), self._var(right))

        def branch(node: int, high: bool) -> int:
            if self._var(node) != variable:
                return node
            return self.nodes[node][2 if high else 1]

        low = self.apply(op, branch(left, False), branch(right, False))
        high = self.apply(op, branch(left, True), branch(right, True))
        result = self.mk(variable, low, high)
        self._apply_cache[key] = result
        return result

    def negate(self, node: int) -> int:
        cached = self._not_cache.get(node)
        if cached is not None:
            return cached
        variable, low, high = self.nodes[node]
        result = self.mk(variable, self.negate(low), self.negate(high))
        self._not_cache[node] = result
        return result

    def fold(self, op: str, values: Sequence[int], identity: int) -> int:
        result = identity
        for value in values:
            result = self.apply(op, result, value)
        return result

    def atleast(self, values: Sequence[int], threshold: int) -> int:
        if threshold <= 0:
            return 1
        if threshold > len(values):
            return 0
        # DP[j] is the BDD for at least j true values processed so far.
        dp = [1] + [0] * threshold
        for value in values:
            next_dp = list(dp)
            for j in range(1, threshold + 1):
                with_current = self.apply("and", value, dp[j - 1])
                next_dp[j] = self.apply("or", dp[j], with_current)
            dp = next_dp
        return dp[threshold]

    def probability(self, root: int, probabilities: Mapping[str, float],
                    forced: Mapping[str, bool] | None = None) -> float:
        forced = forced or {}
        cache: dict[int, float] = {0: 0.0, 1: 1.0}

        def solve(node: int) -> float:
            cached = cache.get(node)
            if cached is not None:
                return cached
            variable, low, high = self.nodes[node]
            name = self.variables[variable]
            if name in forced:
                value = solve(high if forced[name] else low)
            else:
                p = float(probabilities[name])
                value = (1.0 - p) * solve(low) + p * solve(high)
            value = min(1.0, max(0.0, value))
            cache[node] = value
            return value

        return solve(root)

    def true_paths(self, root: int, max_paths: int = 20_000) -> tuple[list[tuple[frozenset[str], frozenset[str]]], bool]:
        paths: list[tuple[frozenset[str], frozenset[str]]] = []
        truncated = False

        def visit(node: int, positive: frozenset[str], negative: frozenset[str]) -> None:
            nonlocal truncated
            if truncated or node == 0:
                return
            if node == 1:
                if len(paths) >= max_paths:
                    truncated = True
                    return
                paths.append((positive, negative))
                return
            variable, low, high = self.nodes[node]
            name = self.variables[variable]
            visit(low, positive, negative | {name})
            visit(high, positive | {name}, negative)

        visit(root, frozenset(), frozenset())
        paths.sort(key=lambda cube: (len(cube[0]) + len(cube[1]),
                                     tuple(sorted(cube[0])), tuple(sorted(cube[1]))))
        minimal: list[tuple[frozenset[str], frozenset[str]]] = []
        for cube in paths:
            if any(p.issubset(cube[0]) and n.issubset(cube[1])
                   for p, n in minimal):
                continue
            minimal.append(cube)
        return minimal, truncated

    def diagnostics(self, root: int) -> dict[str, Any]:
        reachable: set[int] = set()

        def walk(node: int) -> None:
            if node <= 1 or node in reachable:
                return
            reachable.add(node)
            _, low, high = self.nodes[node]
            walk(low)
            walk(high)

        walk(root)
        return {
            "engine": "robdd_structure_function",
            "exact": True,
            "variables": len(self.variables),
            "nodes_created": len(self.nodes),
            "nodes_reachable": len(reachable),
            "max_nodes": self.max_nodes,
            "state_limit_reached": False,
        }


@dataclass
class StaticEvaluation:
    graph: CompiledGraph
    manager: BDDManager
    roots: dict[str, int]
    probabilities: dict[str, float]
    top_probability: float
    node_probabilities: dict[str, float]
    importance: list[dict[str, Any]]
    conditions: list[dict[str, Any]]
    conditions_truncated: bool


def _variable_order(graph: CompiledGraph,
                    event_components: Mapping[str, Sequence[str]]) -> list[str]:
    counts: Counter[str] = Counter()
    for key, node_ids in graph.event_nodes.items():
        weight = max(1, len(node_ids))
        for variable in event_components.get(key, (key,)):
            counts[str(variable)] += weight
    # Highly shared variables first is a useful deterministic ROBDD heuristic.
    return sorted(counts, key=lambda name: (-counts[name], name))


def evaluate_static(
    graph: CompiledGraph,
    latent_probabilities: Mapping[str, float],
    event_components: Mapping[str, Sequence[str]] | None = None,
    display_names: Mapping[str, str] | None = None,
    max_bdd_nodes: int = 250_000,
    max_conditions: int = 20_000,
) -> StaticEvaluation:
    """Evaluate every static node using one authoritative ROBDD."""
    if graph.dynamic:
        raise ValueError("evaluate_static cannot evaluate a dynamic fault tree")
    event_components = event_components or {
        key: (key,) for key in graph.event_nodes
    }
    display_names = display_names or {}
    variables = _variable_order(graph, event_components)
    probabilities = {str(name): float(value)
                     for name, value in latent_probabilities.items()}
    for name in variables:
        if name not in probabilities:
            raise ValueError(f"Missing probability for latent event {name!r}.")
        if not 0 <= probabilities[name] <= 1:
            raise ValueError(f"Probability for {name!r} must be between 0 and 1.")
    manager = BDDManager(variables, max_nodes=max_bdd_nodes)
    roots: dict[str, int] = {}

    def build(node_id: str) -> int:
        cached = roots.get(node_id)
        if cached is not None:
            return cached
        node = graph.nodes[node_id]
        child_values = [build(edge.target) for edge in graph.inputs.get(node_id, [])]
        if node.type == "house":
            value = int(_as_bool(node.data.get("state", node.data.get("value", False))))
        elif node.type in STOCHASTIC_EVENT_TYPES:
            components = [manager.variable(str(name))
                          for name in event_components.get(node.event_key, (node.event_key,))]
            value = manager.fold("or", components, 0)
        elif node.type in PASS_THROUGH_TYPES:
            value = child_values[0]
        elif node.type in {"and", "inhibit"}:
            value = manager.fold("and", child_values, 1)
        elif node.type == "or":
            value = manager.fold("or", child_values, 0)
        elif node.type == "nand":
            value = manager.negate(manager.fold("and", child_values, 1))
        elif node.type == "nor":
            value = manager.negate(manager.fold("or", child_values, 0))
        elif node.type == "xor":
            value = manager.apply("xor", child_values[0], child_values[1])
        elif node.type == "not":
            value = manager.negate(child_values[0])
        elif node.type == "iff":
            value = manager.apply("iff", child_values[0], child_values[1])
        elif node.type == "imply":
            value = manager.apply("imply", child_values[0], child_values[1])
        elif node.type == "vote":
            value = manager.atleast(child_values, int(node.data.get("k", 2)))
        elif node.type == "cardinality":
            low = int(node.data.get("min", node.data.get("low", 1)))
            high = int(node.data.get("max", node.data.get("high", len(child_values))))
            value = manager.atleast(child_values, low)
            if high < len(child_values):
                value = manager.apply(
                    "and", value,
                    manager.negate(manager.atleast(child_values, high + 1)),
                )
        else:  # pragma: no cover - graph validation owns this branch
            raise ValueError(f"Node {node_id!r} is not static: {node.type}")
        roots[node_id] = value
        return value

    top_root = build(graph.root_id)
    top_probability = manager.probability(top_root, probabilities)
    node_probabilities = {
        node_id: manager.probability(root, probabilities)
        for node_id, root in roots.items()
    }

    importance: list[dict[str, Any]] = []
    for name in variables:
        q = probabilities[name]
        p1 = manager.probability(top_root, probabilities, {name: True})
        p0 = manager.probability(top_root, probabilities, {name: False})
        birnbaum = p1 - p0
        importance.append({
            "event_key": name,
            "event": display_names.get(name, name),
            "probability": q,
            "Birnbaum": birnbaum,
            "Criticality": (q * birnbaum / top_probability
                            if top_probability > 0 else None),
            "Fussell-Vesely": ((top_probability - p0) / top_probability
                               if graph.coherent and top_probability > 0 else None),
            "RAW": (p1 / top_probability if top_probability > 0 else None),
            "RRW": (top_probability / p0 if p0 > 0 else None),
            "coherent_interpretation": graph.coherent,
        })
    importance.sort(key=lambda row: (-abs(float(row["Birnbaum"])), row["event"]))

    cubes, truncated = manager.true_paths(top_root, max_paths=max_conditions)
    if graph.coherent:
        # ROBDD paths include the low-branch decisions needed to reach each
        # terminal. In a monotone structure those successful-event literals
        # are not part of a cut set. Remove them, then absorb supersets.
        positive_sets = sorted(
            {positive for positive, _ in cubes},
            key=lambda values: (len(values), tuple(sorted(values))),
        )
        minimal_positive: list[frozenset[str]] = []
        for values in positive_sets:
            if any(existing.issubset(values) for existing in minimal_positive):
                continue
            minimal_positive.append(values)
        cubes = [(values, frozenset()) for values in minimal_positive]
    conditions = []
    for positive, negative in cubes:
        failed = sorted(display_names.get(name, name) for name in positive)
        successful = sorted(display_names.get(name, name) for name in negative)
        probability = 1.0
        for name in positive:
            probability *= probabilities[name]
        for name in negative:
            probability *= 1.0 - probabilities[name]
        conditions.append({
            "required_failed": failed,
            "required_successful": successful,
            "order": len(failed) + len(successful),
            "probability": probability,
            "kind": "minimal_cut_set" if graph.coherent else "disjoint_failure_condition",
        })
    conditions.sort(key=lambda row: (
        row["order"], row["required_failed"], row["required_successful"]
    ))
    return StaticEvaluation(
        graph=graph,
        manager=manager,
        roots=roots,
        probabilities=probabilities,
        top_probability=top_probability,
        node_probabilities=node_probabilities,
        importance=importance,
        conditions=conditions,
        conditions_truncated=truncated,
    )


def _sample_distribution(distribution: str, params: Mapping[str, Any],
                         rng: np.random.Generator, size: int) -> np.ndarray:
    p = {str(k): float(v) for k, v in params.items()}
    if distribution == "exponential":
        values = p.get("gamma", 0.0) + rng.exponential(1.0 / p["lambda"], size)
    elif distribution == "weibull":
        values = p.get("gamma", 0.0) + p["alpha"] * rng.weibull(p["beta"], size)
    elif distribution == "normal":
        values = rng.normal(p["mu"], p["sigma"], size)
    elif distribution == "lognormal":
        values = p.get("gamma", 0.0) + rng.lognormal(p["mu"], p["sigma"], size)
    elif distribution == "gamma":
        values = p.get("gamma", 0.0) + rng.gamma(p["alpha"], p["beta"], size)
    elif distribution == "loglogistic":
        u = np.clip(rng.random(size), np.finfo(float).tiny, 1.0 - np.finfo(float).eps)
        values = p.get("gamma", 0.0) + p["alpha"] * np.power(u / (1.0 - u), 1.0 / p["beta"])
    elif distribution == "gumbel":
        # scipy's gumbel_l: F(x)=1-exp(-exp((x-mu)/sigma)).
        u = np.clip(rng.random(size), np.finfo(float).tiny, 1.0 - np.finfo(float).eps)
        values = p["mu"] + p["sigma"] * np.log(-np.log1p(-u))
    elif distribution == "beta":
        values = rng.beta(p["alpha"], p["beta"], size)
    else:
        raise ValueError(f"Unsupported failure-time distribution {distribution!r}.")
    # Failure time is physically non-negative.  A normal/gumbel model may put
    # mass below zero; those draws represent failures already present at t=0.
    return np.maximum(0.0, np.asarray(values, dtype=float))


def _wilson_interval(successes: int, trials: int,
                     confidence_level: float) -> tuple[float, float]:
    if trials <= 0:
        return 0.0, 1.0
    p = successes / trials
    z = NormalDist().inv_cdf(0.5 + confidence_level / 2.0)
    z2 = z * z
    denominator = 1.0 + z2 / trials
    center = (p + z2 / (2.0 * trials)) / denominator
    half = z * math.sqrt(
        p * (1.0 - p) / trials + z2 / (4.0 * trials * trials)
    ) / denominator
    return max(0.0, center - half), min(1.0, center + half)


@dataclass
class DynamicExactEvaluation:
    top_probability: float
    node_probabilities: dict[str, float]
    time_curve: list[dict[str, float]]
    node_curves: dict[str, list[float]]
    sequences: list[dict[str, Any]]
    diagnostics: dict[str, Any]


def dynamic_exact_eligibility(
    graph: CompiledGraph,
    event_models: Mapping[str, Mapping[str, Any]],
    *,
    mission_time: float | None = None,
    max_states: int = 100_000,
) -> dict[str, Any]:
    """Establish whether an exact ordered-failure CTMC is mathematically valid.

    The current exact class is deliberately narrow: independent, unshifted
    exponential event clocks and PAND/POR dynamic gates whose ordered inputs
    are event nodes.  FDEP, SEQ and SPARE introduce simultaneous, activation,
    coverage, or effective-age state and therefore remain in the chronological
    simulation engine until an equivalent state representation is available.
    """
    reasons: list[str] = []
    unsupported = sorted({
        node.type for node in graph.nodes.values()
        if node.type in CONSTRAINT_TYPES | {"spare"}
    })
    if unsupported:
        reasons.append(
            "Exact CTMC does not yet represent " + ", ".join(kind.upper() for kind in unsupported) + "."
        )
    for node in graph.nodes.values():
        if node.type not in {"pand", "por"}:
            continue
        non_events = [
            graph.nodes[edge.target].label
            for edge in graph.inputs[node.id]
            if graph.nodes[edge.target].type not in STOCHASTIC_EVENT_TYPES
        ]
        if non_events:
            reasons.append(
                f"{node.type.upper()} {node.label!r} has non-event ordered inputs "
                f"({', '.join(non_events)})."
            )
    event_keys = sorted(
        key for key, node_ids in graph.event_nodes.items()
        if graph.nodes[node_ids[0]].type in STOCHASTIC_EVENT_TYPES
    )
    for key in event_keys:
        model = event_models.get(key) or {}
        if str(model.get("ccf_group") or "").strip():
            reasons.append(
                f"Event {key!r} belongs to a common-cause group; exact dynamic CCF state is unavailable."
            )
        if model.get("distribution") != "exponential":
            reasons.append(
                f"Event {key!r} is not an exponential time model."
            )
            continue
        params = dict(model.get("dist_params") or {})
        rate = _finite_float(params.get("lambda"))
        shift = _finite_float(params.get("gamma", 0.0), 0.0)
        if rate is None or rate <= 0:
            reasons.append(f"Event {key!r} requires a positive exponential rate.")
        if shift is None or abs(shift) > 1e-15:
            reasons.append(f"Event {key!r} has a shifted exponential clock.")
        override = _finite_float(model.get("exposure_time"))
        if model.get("exposure_time") is not None and (
                override is None or override < 0 or mission_time is None
                or not math.isfinite(float(mission_time)) or mission_time <= 0):
            reasons.append(
                f"Event {key!r} has an exposure override but no positive global mission time for calendar scaling."
            )

    state_count = 1
    term = 1
    for selected in range(1, len(event_keys) + 1):
        term *= len(event_keys) - selected + 1
        state_count += term
        if state_count > max_states:
            reasons.append(
                f"Ordered-failure CTMC requires {state_count:,}+ states, above the {max_states:,} limit."
            )
            break
    return {
        "eligible": not reasons,
        "reasons": reasons,
        "event_keys": event_keys,
        "state_count": state_count,
        "max_states": max_states,
    }


def evaluate_dynamic_exact(
    graph: CompiledGraph,
    mission_time: float,
    event_models: Mapping[str, Mapping[str, Any]],
    *,
    time_grid: Sequence[float] | None = None,
    max_states: int = 100_000,
    max_sequences: int = 2_000,
) -> DynamicExactEvaluation:
    """Evaluate an eligible dynamic tree as a finite ordered-failure CTMC."""
    if not graph.dynamic:
        raise DynamicExactIneligible(["The graph contains no dynamic construct."])
    eligibility = dynamic_exact_eligibility(
        graph, event_models, mission_time=mission_time, max_states=max_states)
    if not eligibility["eligible"]:
        raise DynamicExactIneligible(eligibility["reasons"])
    mission_time = float(mission_time)
    if not math.isfinite(mission_time) or mission_time < 0:
        raise ValueError("mission_time must be finite and non-negative")
    if time_grid is None:
        grid = np.linspace(0.0, mission_time, 51)
    else:
        grid = np.asarray(time_grid, dtype=float)
        if (grid.ndim != 1 or len(grid) < 2 or not np.all(np.isfinite(grid))
                or np.any(grid < 0) or np.any(np.diff(grid) < 0)):
            raise ValueError("time_grid must be a sorted finite non-negative sequence")

    event_keys = list(eligibility["event_keys"])
    rates = {}
    for key in event_keys:
        model = event_models[key]
        override = model.get("exposure_time")
        scale = float(override) / mission_time if override is not None else 1.0
        rates[key] = float((model.get("dist_params") or {})["lambda"]) * scale
    states: list[tuple[str, ...]] = [()]
    state_index: dict[tuple[str, ...], int] = {(): 0}
    cursor = 0
    while cursor < len(states):
        state = states[cursor]
        selected = set(state)
        for key in event_keys:
            if key in selected:
                continue
            target = state + (key,)
            if target not in state_index:
                state_index[target] = len(states)
                states.append(target)
        cursor += 1
    if len(states) > max_states:  # defensive; eligibility computes this first
        raise DynamicExactIneligible([
            f"Ordered-failure CTMC requires {len(states):,} states, above the {max_states:,} limit."
        ])

    rows: list[int] = []
    columns: list[int] = []
    values: list[float] = []
    for index, state in enumerate(states):
        selected = set(state)
        outgoing = 0.0
        for key in event_keys:
            if key in selected:
                continue
            rate = rates[key]
            rows.append(index)
            columns.append(state_index[state + (key,)])
            values.append(rate)
            outgoing += rate
        rows.append(index)
        columns.append(index)
        values.append(-outgoing)
    generator = csr_matrix((values, (rows, columns)),
                           shape=(len(states), len(states)), dtype=float)
    initial = np.zeros(len(states), dtype=float)
    initial[0] = 1.0

    def state_values(state: tuple[str, ...]) -> dict[str, bool]:
        failed = set(state)
        order = {key: index for index, key in enumerate(state)}
        cache: dict[str, bool] = {}

        def evaluate(node_id: str) -> bool:
            if node_id in cache:
                return cache[node_id]
            node = graph.nodes[node_id]
            child_values = [evaluate(edge.target)
                            for edge in graph.inputs.get(node_id, [])]
            if node.type == "house":
                result = _as_bool(node.data.get("state", node.data.get("value", False)))
            elif node.type in STOCHASTIC_EVENT_TYPES:
                result = node.event_key in failed
            elif node.type in PASS_THROUGH_TYPES:
                result = child_values[0]
            elif node.type in {"and", "inhibit"}:
                result = all(child_values)
            elif node.type == "or":
                result = any(child_values)
            elif node.type == "nand":
                result = not all(child_values)
            elif node.type == "nor":
                result = not any(child_values)
            elif node.type == "xor":
                result = child_values[0] != child_values[1]
            elif node.type == "not":
                result = not child_values[0]
            elif node.type == "iff":
                result = child_values[0] == child_values[1]
            elif node.type == "imply":
                result = (not child_values[0]) or child_values[1]
            elif node.type == "vote":
                result = sum(child_values) >= int(node.data.get("k", 2))
            elif node.type == "cardinality":
                count = sum(child_values)
                low = int(node.data.get("min", node.data.get("low", 1)))
                high = int(node.data.get("max", node.data.get("high", len(child_values))))
                result = low <= count <= high
            elif node.type == "pand":
                keys = [graph.nodes[edge.target].event_key
                        for edge in graph.inputs[node_id]]
                inclusive = str(node.data.get("tie_policy", "inclusive")).lower() != "exclusive"
                # Independent exponential transitions have no ties, but retain
                # the policy in the explicit comparison for semantic clarity.
                indices = [order.get(key) for key in keys]
                result = all(index is not None for index in indices) and (
                    all(left <= right for left, right in zip(indices, indices[1:]))
                    if inclusive else
                    all(left < right for left, right in zip(indices, indices[1:]))
                )
            elif node.type == "por":
                keys = [graph.nodes[edge.target].event_key
                        for edge in graph.inputs[node_id]]
                priority = order.get(keys[0])
                inclusive = str(node.data.get("tie_policy", "inclusive")).lower() != "exclusive"
                blockers = [order.get(key, math.inf) for key in keys[1:]]
                result = priority is not None and (
                    all(priority <= blocker for blocker in blockers)
                    if inclusive else all(priority < blocker for blocker in blockers)
                )
            elif node.type in CONSTRAINT_TYPES | {"spare"}:
                raise RuntimeError("Ineligible construct reached exact CTMC evaluation.")
            else:  # pragma: no cover
                raise RuntimeError(f"Unsupported exact dynamic node {node.type!r}.")
            cache[node_id] = bool(result)
            return bool(result)

        for node_id, node in graph.nodes.items():
            if node.type not in CONSTRAINT_TYPES:
                evaluate(node_id)
        return cache

    truth = [state_values(state) for state in states]
    evaluated_nodes = [
        node_id for node_id, node in graph.nodes.items()
        if node.type not in CONSTRAINT_TYPES
    ]
    masks = {
        node_id: np.fromiter(
            (1.0 if values.get(node_id, False) else 0.0 for values in truth),
            dtype=float, count=len(states),
        )
        for node_id in evaluated_nodes
    }

    def distribution_at(time: float) -> np.ndarray:
        if time == 0:
            return initial.copy()
        probability = np.asarray(
            expm_multiply(generator.transpose() * float(time), initial),
            dtype=float,
        )
        probability[probability < 0] = 0.0
        total = float(probability.sum())
        return probability / total if total > 0 else probability

    distributions = [distribution_at(float(time)) for time in grid]
    if any(math.isclose(float(time), mission_time, rel_tol=0.0, abs_tol=1e-12)
           for time in grid):
        mission_distribution = distributions[next(
            index for index, time in enumerate(grid)
            if math.isclose(float(time), mission_time, rel_tol=0.0, abs_tol=1e-12)
        )]
    else:
        mission_distribution = distribution_at(mission_time)
    node_probabilities = {
        node_id: float(mission_distribution @ masks[node_id])
        for node_id in evaluated_nodes
    }
    node_curves = {
        node_id: [float(probability @ masks[node_id])
                  for probability in distributions]
        for node_id in evaluated_nodes
    }
    top_probability = node_probabilities[graph.root_id]
    time_curve = [
        {"time": float(time),
         "probability": node_curves[graph.root_id][index]}
        for index, time in enumerate(grid)
    ]

    sequence_mass: Counter[tuple[str, ...]] = Counter()
    for index, state in enumerate(states):
        mass = float(mission_distribution[index])
        if mass <= 0 or not truth[index].get(graph.root_id, False):
            continue
        first_entry = state
        for length in range(len(state) + 1):
            prefix = state[:length]
            if truth[state_index[prefix]].get(graph.root_id, False):
                first_entry = prefix
                break
        sequence_mass[first_entry] += mass
    ordered_sequences = sorted(
        sequence_mass.items(), key=lambda item: (-item[1], len(item[0]), item[0]))
    truncated = len(ordered_sequences) > max_sequences
    sequences = [
        {
            "events": list(sequence),
            "count": 0,
            "state_count": sum(1 for state in states if state[:len(sequence)] == sequence),
            "conditional_contribution": mass / top_probability if top_probability > 0 else 0.0,
            "estimated_probability": mass,
            "kind": "exact_first_entry_sequence",
        }
        for sequence, mass in ordered_sequences[:max_sequences]
    ]
    return DynamicExactEvaluation(
        top_probability=top_probability,
        node_probabilities=node_probabilities,
        time_curve=time_curve,
        node_curves=node_curves,
        sequences=sequences,
        diagnostics={
            "engine": "ordered_failure_ctmc",
            "exact": True,
            "states_evaluated": len(states),
            "variables": len(event_keys),
            "max_states": max_states,
            "qualitative_sequence_count": len(ordered_sequences),
            "qualitative_display_truncated": truncated,
            "eligibility": eligibility,
        },
    )


@dataclass
class DynamicEvaluation:
    top_probability: float
    ci_lower: float
    ci_upper: float
    confidence_level: float
    n_simulations: int
    top_event_count: int
    node_probabilities: dict[str, float]
    time_curve: list[dict[str, float]]
    node_curves: dict[str, list[float]]
    sequences: list[dict[str, Any]]
    diagnostics: dict[str, Any]


class _TrialEvaluator:
    def __init__(self, graph: CompiledGraph, thresholds: Mapping[str, float],
                 rng: np.random.Generator):
        self.graph = graph
        self.thresholds = dict(thresholds)
        self.times = dict(thresholds)
        self.rng = rng
        self.spare_times: dict[str, float] = {}
        self._time_cache: dict[str, float] = {}
        self._prepare_sequences()
        self._prepare_spares()
        self._apply_fdep()

    def _event_key(self, node_id: str) -> str:
        return self.graph.nodes[node_id].event_key

    def _prepare_sequences(self) -> None:
        predecessors: dict[str, set[str]] = {}
        for node_id, node in self.graph.nodes.items():
            if node.type != "seq":
                continue
            keys = [self._event_key(edge.target)
                    for edge in self.graph.inputs[node_id]]
            for predecessor, successor in zip(keys, keys[1:]):
                predecessors.setdefault(successor, set()).add(predecessor)

        completed: dict[str, float] = {}
        visiting: set[str] = set()

        def completion(key: str) -> float:
            if key in completed:
                return completed[key]
            if key in visiting:  # compile_graph reports this first
                raise ValueError(f"Sequence precedence cycle at event {key!r}.")
            visiting.add(key)
            activation = max(
                (completion(predecessor)
                 for predecessor in predecessors.get(key, set())),
                default=0.0,
            )
            value = activation + self.thresholds[key]
            visiting.remove(key)
            completed[key] = value
            return value

        for key in set(predecessors).union(
                predecessor for values in predecessors.values()
                for predecessor in values):
            self.times[key] = completion(key)

    def _prepare_spares(self) -> None:
        for node_id, node in self.graph.nodes.items():
            if node.type != "spare":
                continue
            edges = self.graph.inputs[node_id]
            mode = str(node.data.get("spare_mode", "cold")).lower()
            default_alpha = {"cold": 0.0, "warm": 0.5, "hot": 1.0}[mode]
            alpha = float(node.data.get("dormancy_factor", default_alpha))
            coverage = float(node.data.get("coverage", 1.0))
            primary_key = self._event_key(edges[0].target)
            failure_time = self.thresholds[primary_key]
            self.times[primary_key] = failure_time
            exhausted = True
            for edge in edges[1:]:
                key = self._event_key(edge.target)
                threshold = self.thresholds[key]
                dormant_exposure = alpha * failure_time
                if alpha > 0.0 and threshold <= dormant_exposure:
                    self.times[key] = threshold / alpha
                    continue
                if self.rng.random() > coverage:
                    self.times[key] = math.inf
                    self.spare_times[node_id] = failure_time
                    exhausted = False
                    break
                remaining = max(0.0, threshold - dormant_exposure)
                failure_time = failure_time + remaining
                self.times[key] = failure_time
            if exhausted:
                self.spare_times[node_id] = failure_time
        self._time_cache.clear()

    def _apply_fdep(self) -> None:
        fdeps = [node_id for node_id, node in self.graph.nodes.items()
                 if node.type == "fdep"]
        if not fdeps:
            return
        for _ in range(max(2, len(fdeps) + 1)):
            changed = False
            self._time_cache.clear()
            for node_id in fdeps:
                edges = self.graph.inputs[node_id]
                trigger = next(edge for edge in edges if edge.role == "trigger")
                trigger_time = self.failure_time(trigger.target)
                for edge in edges:
                    if edge.role != "dependent":
                        continue
                    key = self._event_key(edge.target)
                    if trigger_time < self.times[key]:
                        self.times[key] = trigger_time
                        changed = True
            if not changed:
                return
        raise ValueError("FDEP dependencies did not reach a stable chronological closure.")

    def failure_time(self, node_id: str) -> float:
        cached = self._time_cache.get(node_id)
        if cached is not None:
            return cached
        node = self.graph.nodes[node_id]
        child_times = [self.failure_time(edge.target)
                       for edge in self.graph.inputs.get(node_id, [])]
        if node.type == "house":
            result = 0.0 if _as_bool(node.data.get("state", node.data.get("value", False))) else math.inf
        elif node.type in STOCHASTIC_EVENT_TYPES:
            result = self.times[node.event_key]
        elif node.type in PASS_THROUGH_TYPES:
            result = child_times[0]
        elif node.type in {"and", "inhibit"}:
            result = max(child_times)
        elif node.type == "or":
            result = min(child_times)
        elif node.type == "vote":
            result = sorted(child_times)[int(node.data.get("k", 2)) - 1]
        elif node.type == "cardinality":
            low = int(node.data.get("min", node.data.get("low", 1)))
            result = sorted(child_times)[max(0, low - 1)] if low > 0 else 0.0
        elif node.type == "pand":
            inclusive = str(node.data.get("tie_policy", "inclusive")).lower() != "exclusive"
            ordered = all(a <= b for a, b in zip(child_times, child_times[1:])) if inclusive else all(a < b for a, b in zip(child_times, child_times[1:]))
            result = child_times[-1] if ordered else math.inf
        elif node.type == "por":
            inclusive = str(node.data.get("tie_policy", "inclusive")).lower() != "exclusive"
            priority = child_times[0]
            ordered = all(priority <= other for other in child_times[1:]) if inclusive else all(priority < other for other in child_times[1:])
            result = priority if ordered else math.inf
        elif node.type == "spare":
            result = self.spare_times[node_id]
        elif node.type in {"not", "xor", "nand", "nor", "iff", "imply"}:
            # A non-coherent state can later return false and therefore has no
            # single failure time. State-at-time evaluation owns these gates.
            result = math.nan
        elif node.type in CONSTRAINT_TYPES:
            result = math.inf
        else:  # pragma: no cover
            raise ValueError(f"Unsupported node type {node.type!r}")
        self._time_cache[node_id] = result
        return result

    def state_at(self, node_id: str, time: float,
                 cache: dict[tuple[str, float], bool] | None = None) -> bool:
        cache = cache if cache is not None else {}
        key = (node_id, time)
        if key in cache:
            return cache[key]
        node = self.graph.nodes[node_id]
        child_states = [self.state_at(edge.target, time, cache)
                        for edge in self.graph.inputs.get(node_id, [])]
        if node.type == "house":
            value = _as_bool(node.data.get("state", node.data.get("value", False)))
        elif node.type in STOCHASTIC_EVENT_TYPES:
            value = self.times[node.event_key] <= time
        elif node.type in PASS_THROUGH_TYPES:
            value = child_states[0]
        elif node.type in {"and", "inhibit"}:
            value = all(child_states)
        elif node.type == "or":
            value = any(child_states)
        elif node.type == "nand":
            value = not all(child_states)
        elif node.type == "nor":
            value = not any(child_states)
        elif node.type == "xor":
            value = child_states[0] != child_states[1]
        elif node.type == "not":
            value = not child_states[0]
        elif node.type == "iff":
            value = child_states[0] == child_states[1]
        elif node.type == "imply":
            value = (not child_states[0]) or child_states[1]
        elif node.type == "vote":
            value = sum(child_states) >= int(node.data.get("k", 2))
        elif node.type == "cardinality":
            count = sum(child_states)
            low = int(node.data.get("min", node.data.get("low", 1)))
            high = int(node.data.get("max", node.data.get("high", len(child_states))))
            value = low <= count <= high
        elif node.type in DYNAMIC_GATE_TYPES:
            value = self.failure_time(node_id) <= time
        elif node.type in CONSTRAINT_TYPES:
            value = False
        else:  # pragma: no cover
            raise ValueError(f"Unsupported node type {node.type!r}")
        cache[key] = value
        return value

    def causal_sequence(self, top_time: float) -> tuple[str, ...]:
        if not math.isfinite(top_time):
            return ()
        ordered = sorted(
            ((time, key) for key, time in self.times.items()
             if math.isfinite(time) and time <= top_time),
            key=lambda item: (item[0], item[1]),
        )
        return tuple(key for _, key in ordered)


def evaluate_dynamic(
    graph: CompiledGraph,
    mission_time: float,
    event_models: Mapping[str, Mapping[str, Any]],
    n_simulations: int = 20_000,
    seed: int | None = None,
    confidence_level: float = 0.95,
    time_grid: Sequence[float] | None = None,
    progress: Callable[[int, int], None] | None = None,
    cancelled: Callable[[], bool] | None = None,
) -> DynamicEvaluation:
    """Chronological Monte Carlo evaluation of a dynamic fault tree."""
    if not graph.dynamic:
        raise ValueError("evaluate_dynamic requires at least one dynamic construct")
    mission_time = float(mission_time)
    if not math.isfinite(mission_time) or mission_time < 0:
        raise ValueError("mission_time must be finite and non-negative")
    if isinstance(n_simulations, bool) or int(n_simulations) != n_simulations or n_simulations < 1:
        raise ValueError("n_simulations must be a positive integer")
    n_simulations = int(n_simulations)
    confidence_level = float(confidence_level)
    if not 0 < confidence_level < 1:
        raise ValueError("confidence_level must be between 0 and 1")
    if time_grid is None:
        time_grid_array = np.linspace(0.0, mission_time, 51)
    else:
        time_grid_array = np.asarray(time_grid, dtype=float)
        if (time_grid_array.ndim != 1 or len(time_grid_array) < 2
                or not np.all(np.isfinite(time_grid_array))
                or np.any(time_grid_array < 0)
                or np.any(np.diff(time_grid_array) < 0)):
            raise ValueError("time_grid must be a sorted finite non-negative sequence")

    rng = np.random.default_rng(seed)
    thresholds: dict[str, np.ndarray] = {}
    ccf_groups: dict[str, list[str]] = {}
    for event_key, model in event_models.items():
        group = str(model.get("ccf_group") or "").strip()
        if group:
            ccf_groups.setdefault(group, []).append(event_key)

    grouped_keys = {key for members in ccf_groups.values() for key in members}
    for group, members in sorted(ccf_groups.items()):
        members = sorted(set(members))
        if len(members) < 2:
            raise ValueError(
                f"Dynamic beta-factor group {group!r} requires at least two events."
            )
        models = [event_models[key] for key in members]
        if any(model.get("distribution") != "exponential" for model in models):
            raise ValueError(
                f"Dynamic beta-factor group {group!r} requires exponential event models; "
                "use an explicit common-shock event for non-exponential dependence."
            )
        exposure_scales = []
        for model in models:
            override = model.get("exposure_time")
            if override is not None and mission_time <= 0:
                raise ValueError(
                    f"Dynamic beta-factor group {group!r} needs a positive mission time for exposure scaling."
                )
            exposure_scales.append(
                float(override) / mission_time if override is not None else 1.0)
        rates = [
            float((model.get("dist_params") or {})["lambda"]) * scale
            for model, scale in zip(models, exposure_scales)
        ]
        betas = [float(model.get("ccf_beta", 0.1)) for model in models]
        shifts = [float((model.get("dist_params") or {}).get("gamma", 0.0))
                  for model in models]
        if any(not math.isclose(rate, rates[0], rel_tol=1e-9, abs_tol=1e-15)
               for rate in rates[1:]):
            raise ValueError(
                f"Dynamic beta-factor group {group!r} requires equal exponential rates."
            )
        if any(not math.isclose(beta, betas[0], rel_tol=0.0, abs_tol=1e-12)
               for beta in betas[1:]):
            raise ValueError(
                f"Dynamic beta-factor group {group!r} requires one common beta factor."
            )
        if any(abs(shift) > 1e-15 for shift in shifts):
            raise ValueError(
                f"Dynamic beta-factor group {group!r} does not support shifted exponential models."
            )
        rate = rates[0]
        beta = betas[0]
        common_time = (rng.exponential(1.0 / (beta * rate), n_simulations)
                       if beta > 0 else np.full(n_simulations, math.inf))
        individual_rate = (1.0 - beta) * rate
        for key in members:
            individual_time = (
                rng.exponential(1.0 / individual_rate, n_simulations)
                if individual_rate > 0 else np.full(n_simulations, math.inf)
            )
            thresholds[key] = np.minimum(individual_time, common_time)

    for event_key in sorted(graph.event_nodes):
        node = graph.nodes[graph.event_nodes[event_key][0]]
        if node.type == "house":
            thresholds[event_key] = np.full(
                n_simulations,
                0.0 if _as_bool(node.data.get("state", node.data.get("value", False))) else math.inf,
            )
            continue
        if event_key in grouped_keys:
            continue
        model = event_models.get(event_key)
        if not model or not model.get("distribution"):
            raise ValueError(
                f"Dynamic event {node.label!r} requires a time-to-failure distribution."
            )
        override = model.get("exposure_time")
        if override is not None and mission_time <= 0:
            raise ValueError(
                f"Dynamic event {node.label!r} needs a positive mission time for exposure scaling."
            )
        exposure_scale = (
            float(override) / mission_time if override is not None else 1.0
        )
        sampled = _sample_distribution(
            str(model["distribution"]), model.get("dist_params") or {}, rng,
            n_simulations,
        )
        thresholds[event_key] = (
            sampled / exposure_scale
            if exposure_scale > 0 else np.full(n_simulations, math.inf)
        )

    top_count = 0
    node_counts = Counter()
    curve_counts = np.zeros(len(time_grid_array), dtype=np.int64)
    node_curve_counts = {
        node_id: np.zeros(len(time_grid_array), dtype=np.int64)
        for node_id, node in graph.nodes.items()
        if node.type not in CONSTRAINT_TYPES
    }
    sequence_counts: Counter[tuple[str, ...]] = Counter()
    report_every = max(1, n_simulations // 100)
    for index in range(n_simulations):
        if cancelled and cancelled():
            raise InterruptedError("Fault-tree analysis was cancelled.")
        trial_thresholds = {key: values[index] for key, values in thresholds.items()}
        trial = _TrialEvaluator(graph, trial_thresholds, rng)
        mission_cache: dict[tuple[str, float], bool] = {}
        top = trial.state_at(graph.root_id, mission_time, mission_cache)
        if top:
            top_count += 1
            top_time = trial.failure_time(graph.root_id)
            sequence_counts[trial.causal_sequence(top_time)] += 1
        for node_id, node in graph.nodes.items():
            if node.type in CONSTRAINT_TYPES:
                continue
            if trial.state_at(node_id, mission_time, mission_cache):
                node_counts[node_id] += 1
        for grid_index, time in enumerate(time_grid_array):
            cache: dict[tuple[str, float], bool] = {}
            if trial.state_at(graph.root_id, float(time), cache):
                curve_counts[grid_index] += 1
            for node_id in node_curve_counts:
                if trial.state_at(node_id, float(time), cache):
                    node_curve_counts[node_id][grid_index] += 1
        if progress and ((index + 1) % report_every == 0 or index + 1 == n_simulations):
            progress(index + 1, n_simulations)

    probability = top_count / n_simulations
    ci_lower, ci_upper = _wilson_interval(
        top_count, n_simulations, confidence_level)
    sequences = []
    for sequence, count in sequence_counts.most_common(100):
        sequences.append({
            "events": list(sequence),
            "count": count,
            "conditional_contribution": count / top_count if top_count else 0.0,
            "estimated_probability": count / n_simulations,
            "kind": "observed_cut_sequence",
        })
    return DynamicEvaluation(
        top_probability=probability,
        ci_lower=ci_lower,
        ci_upper=ci_upper,
        confidence_level=confidence_level,
        n_simulations=n_simulations,
        top_event_count=top_count,
        node_probabilities={node_id: count / n_simulations
                            for node_id, count in node_counts.items()},
        time_curve=[
            {"time": float(time), "probability": float(count / n_simulations)}
            for time, count in zip(time_grid_array, curve_counts)
        ],
        node_curves={
            node_id: [float(value / n_simulations) for value in counts]
            for node_id, counts in node_curve_counts.items()
        },
        sequences=sequences,
        diagnostics={
            "engine": "chronological_event_time_monte_carlo",
            "exact": False,
            "n_simulations": n_simulations,
            "seed": seed,
            "confidence_interval": "wilson_score",
            "confidence_level": confidence_level,
            "resolution_limit": 1.0 / n_simulations,
            "zero_event_upper_bound": (
                1.0 - (1.0 - confidence_level) ** (1.0 / n_simulations)
                if top_count == 0 else None
            ),
            "sequence_display_limit": 100,
            "sequence_display_truncated": len(sequence_counts) > 100,
        },
    )


def exponential_rate_from_mission_probability(probability: float,
                                              mission_time: float) -> float:
    """Explicit constant-hazard conversion offered by the UI for dynamic use."""
    probability = float(probability)
    mission_time = float(mission_time)
    if not 0 <= probability < 1:
        raise ValueError("probability must be in [0, 1) for exponential conversion")
    if not math.isfinite(mission_time) or mission_time <= 0:
        raise ValueError("mission_time must be positive for exponential conversion")
    if probability == 0:
        return 0.0
    return -math.log1p(-probability) / mission_time


__all__ = [
    "BDDManager", "BDDStateLimitError", "CompiledGraph",
    "DynamicEvaluation", "DynamicExactEvaluation", "DynamicExactIneligible",
    "FaultTreeValidationError", "GraphEdge", "GraphNode", "StaticEvaluation",
    "SUPPORTED_NODE_TYPES", "compile_graph", "dynamic_exact_eligibility",
    "evaluate_dynamic", "evaluate_dynamic_exact", "evaluate_static",
    "exponential_rate_from_mission_probability",
]
