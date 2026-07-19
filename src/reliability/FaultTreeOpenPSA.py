"""OpenPSA Model Exchange Format interoperability for fault trees.

The importer intentionally accepts a conservative, useful subset of the
OpenPSA fault-tree vocabulary.  It rejects XML declarations that can resolve
external entities, limits document complexity, and reports every lossy or
unsupported construct instead of silently changing the model.  The exporter
emits portable static Boolean formulae and expands convenience gates (NAND,
NOR, IFF, IMPLY and INHIBIT) into core Boolean operators.
"""

from __future__ import annotations

from collections import defaultdict, deque
import math
import re
from typing import Any, Iterable, Mapping
import xml.etree.ElementTree as ET

from .FaultTreeAdvanced import (
    CONSTRAINT_TYPES,
    DYNAMIC_GATE_TYPES,
    EVENT_TYPES,
    PASS_THROUGH_TYPES,
    STATIC_GATE_TYPES,
    compile_graph,
)


class OpenPSAError(ValueError):
    """An OpenPSA document cannot be imported or exported without ambiguity."""

    def __init__(self, message: str, *, code: str = "OPENPSA_INVALID"):
        self.code = code
        super().__init__(message)


_REFERENCE_TAGS = {"gate", "basic-event", "house-event"}
_FORMULA_TAGS = {
    "and", "or", "not", "xor", "iff", "imply", "nand", "nor",
    "atleast", "cardinality", "inhibit",
}
_IGNORED_TAGS = {"label", "description", "attributes", "attribute"}


def _tag(element: ET.Element) -> str:
    return element.tag.rsplit("}", 1)[-1].strip().lower()


def _safe_id(prefix: str, name: str, used: set[str]) -> str:
    stem = re.sub(r"[^A-Za-z0-9_.:-]+", "_", name.strip()).strip("_")
    stem = stem or "unnamed"
    candidate = f"{prefix}_{stem}"
    suffix = 2
    while candidate in used:
        candidate = f"{prefix}_{stem}_{suffix}"
        suffix += 1
    used.add(candidate)
    return candidate


def _first_formula_child(element: ET.Element) -> ET.Element | None:
    for child in element:
        if _tag(child) not in _IGNORED_TAGS:
            return child
    return None


def _numeric_value(element: ET.Element) -> float | None:
    """Read a literal probability without pretending to evaluate parameters."""
    for candidate in element.iter():
        tag = _tag(candidate)
        if tag not in {"float", "constant"}:
            continue
        raw = candidate.get("value")
        if raw is None and candidate.text:
            raw = candidate.text.strip()
        try:
            value = float(raw) if raw is not None else None
        except (TypeError, ValueError):
            continue
        if value is not None and math.isfinite(value) and 0 <= value <= 1:
            return value
    return None


def _house_value(element: ET.Element) -> bool | None:
    for candidate in element.iter():
        if _tag(candidate) != "constant":
            continue
        raw = candidate.get("value")
        if raw is None and candidate.text:
            raw = candidate.text.strip()
        if str(raw).strip().lower() in {"true", "1", "yes"}:
            return True
        if str(raw).strip().lower() in {"false", "0", "no"}:
            return False
    return None


def _secure_parse(xml: str, *, max_elements: int = 100_000,
                  max_depth: int = 128) -> ET.Element:
    if re.search(r"<!\s*(?:DOCTYPE|ENTITY)\b", xml, re.IGNORECASE):
        raise OpenPSAError(
            "DTD and entity declarations are not allowed in OpenPSA imports.",
            code="OPENPSA_UNSAFE_XML",
        )
    try:
        parser = ET.XMLPullParser(events=("start", "end"))
        parser.feed(xml)
        depth = 0
        count = 0
        root: ET.Element | None = None
        for event, element in parser.read_events():
            if event == "start":
                depth += 1
                count += 1
                if count > max_elements:
                    raise OpenPSAError(
                        f"OpenPSA document exceeds {max_elements:,} elements.",
                        code="OPENPSA_COMPLEXITY_LIMIT",
                    )
                if depth > max_depth:
                    raise OpenPSAError(
                        f"OpenPSA document nesting exceeds {max_depth} levels.",
                        code="OPENPSA_COMPLEXITY_LIMIT",
                    )
                if root is None:
                    root = element
            else:
                depth -= 1
        parser.close()
    except ET.ParseError as exc:
        raise OpenPSAError(f"Invalid OpenPSA XML: {exc}") from exc
    if root is None:
        raise OpenPSAError("The OpenPSA document is empty.")
    return root


def import_openpsa(xml: str, *, tree_name: str | None = None,
                   top_event: str | None = None) -> dict[str, Any]:
    """Import a static OpenPSA fault tree into Perdura's graph contract."""
    root = _secure_parse(xml)
    warnings: list[dict[str, Any]] = []
    tree_elements = [el for el in root.iter() if _tag(el) == "define-fault-tree"]
    if not tree_elements:
        # A few tools emit a bare collection of definitions. Treat the root as
        # the tree container and disclose that compatibility choice.
        tree_elements = [root]
        warnings.append({
            "severity": "warning", "code": "OPENPSA_BARE_DEFINITIONS",
            "message": "No define-fault-tree element was found; imported the document root.",
        })
    if tree_name:
        matches = [el for el in tree_elements if el.get("name") == tree_name]
        if not matches:
            available = ", ".join(el.get("name", "(unnamed)") for el in tree_elements)
            raise OpenPSAError(
                f"Fault tree {tree_name!r} was not found. Available trees: {available}.",
                code="OPENPSA_TREE_NOT_FOUND",
            )
        tree = matches[0]
    else:
        tree = tree_elements[0]
        if len(tree_elements) > 1:
            warnings.append({
                "severity": "warning", "code": "OPENPSA_TREE_SELECTED",
                "message": (
                    f"The document contains {len(tree_elements)} fault trees; "
                    f"imported {tree.get('name', '(unnamed)')!r}."
                ),
            })

    # Definitions can be scoped to the selected tree or placed at model level.
    # Definitions inside a different define-fault-tree must not leak into this
    # import and make its candidate top event ambiguous.
    parent_of = {child: parent for parent in root.iter() for child in parent}
    definitions: dict[str, dict[str, ET.Element]] = {
        "gate": {}, "basic-event": {}, "house-event": {},
    }
    for element in root.iter():
        tag = _tag(element)
        if tag not in {"define-gate", "define-basic-event", "define-house-event"}:
            continue
        ancestor = parent_of.get(element)
        enclosing_tree: ET.Element | None = None
        while ancestor is not None:
            if _tag(ancestor) == "define-fault-tree":
                enclosing_tree = ancestor
                break
            ancestor = parent_of.get(ancestor)
        if tree is not root and enclosing_tree not in {None, tree}:
            continue
        name = (element.get("name") or "").strip()
        if not name:
            warnings.append({
                "severity": "warning", "code": "OPENPSA_UNNAMED_DEFINITION",
                "message": f"Ignored an unnamed {tag} definition.",
            })
            continue
        definitions[tag.removeprefix("define-")][name] = element

    gate_defs = definitions["gate"]
    if not gate_defs:
        raise OpenPSAError("The selected OpenPSA tree has no gate definitions.")
    referenced_gates = {
        (ref.get("name") or "").strip()
        for definition in gate_defs.values()
        for ref in definition.iter()
        if _tag(ref) == "gate"
    }
    candidates = [name for name in gate_defs if name not in referenced_gates]
    if top_event:
        if top_event not in gate_defs:
            raise OpenPSAError(
                f"Top gate {top_event!r} is not defined in the selected tree.",
                code="OPENPSA_TOP_NOT_FOUND",
            )
        selected_top = top_event
    elif len(candidates) == 1:
        selected_top = candidates[0]
    else:
        selected_top = candidates[0] if candidates else next(iter(gate_defs))
        warnings.append({
            "severity": "warning", "code": "OPENPSA_TOP_SELECTED",
            "message": (
                "The top gate was ambiguous; imported "
                f"{selected_top!r}. Candidate roots: {', '.join(candidates) or '(none)'}."
            ),
        })

    used_ids: set[str] = set()
    gate_ids = {name: _safe_id("gate", name, used_ids) for name in gate_defs}
    event_ids: dict[tuple[str, str], str] = {}
    nodes: list[dict[str, Any]] = []
    node_by_id: dict[str, dict[str, Any]] = {}
    edges: list[dict[str, Any]] = []
    expanded_gates: set[str] = set()
    internal_counter = 0

    def add_node(node_id: str, node_type: str, data: Mapping[str, Any]) -> str:
        if node_id not in node_by_id:
            node = {"id": node_id, "type": node_type,
                    "data": dict(data), "position": {"x": 0.0, "y": 0.0}}
            nodes.append(node)
            node_by_id[node_id] = node
        return node_id

    def event_node(kind: str, name: str) -> str:
        key = (kind, name)
        if key in event_ids:
            return event_ids[key]
        node_id = _safe_id("event" if kind != "house-event" else "house", name, used_ids)
        event_ids[key] = node_id
        definition = definitions.get(kind, {}).get(name)
        if kind == "house-event":
            state = _house_value(definition) if definition is not None else None
            if state is None:
                state = False
                warnings.append({
                    "severity": "warning", "code": "OPENPSA_HOUSE_DEFAULT",
                    "message": f"House event {name!r} had no Boolean constant; defaulted to false.",
                })
            return add_node(node_id, "house", {
                "label": name, "state": state, "openpsaName": name,
            })
        probability = _numeric_value(definition) if definition is not None else None
        data: dict[str, Any] = {
            "label": name, "eventKey": name, "openpsaName": name,
        }
        if probability is None:
            probability = 0.0
            data["sourceIncomplete"] = True
            warnings.append({
                "severity": "warning", "code": "OPENPSA_SOURCE_INCOMPLETE",
                "message": (
                    f"Basic event {name!r} does not contain a literal probability. "
                    "Its placeholder is 0; define a Perdura probability or time model before analysis."
                ),
                "node_id": node_id,
            })
        data["probability"] = probability
        return add_node(node_id, "basic", data)

    def add_edge(parent: str, child: str, order: int, role: str = "input") -> None:
        edges.append({
            "id": f"edge_{len(edges) + 1}", "source": parent,
            "target": child, "role": role, "order": order,
        })

    def parse_formula(element: ET.Element, *, owner: str | None = None) -> str:
        nonlocal internal_counter
        tag = _tag(element)
        if tag in _REFERENCE_TAGS:
            name = (element.get("name") or "").strip()
            if not name:
                raise OpenPSAError(f"An OpenPSA {tag} reference is missing its name.")
            if tag == "gate":
                if name not in gate_defs:
                    raise OpenPSAError(
                        f"Gate reference {name!r} has no define-gate declaration.",
                        code="OPENPSA_UNRESOLVED_REFERENCE",
                    )
                expand_gate(name)
                return gate_ids[name]
            return event_node(tag, name)
        if tag == "constant":
            internal_counter += 1
            raw = str(element.get("value", element.text or "false")).strip().lower()
            state = raw in {"true", "1", "yes"}
            node_id = _safe_id("constant", str(internal_counter), used_ids)
            return add_node(node_id, "house", {
                "label": "TRUE" if state else "FALSE", "state": state,
            })
        if tag not in _FORMULA_TAGS:
            raise OpenPSAError(
                f"Unsupported OpenPSA formula element <{tag}>.",
                code="OPENPSA_UNSUPPORTED_CONSTRUCT",
            )
        node_id = owner
        if node_id is None:
            internal_counter += 1
            node_id = _safe_id("formula", str(internal_counter), used_ids)
        node_type = "vote" if tag == "atleast" else tag
        data: dict[str, Any] = {"label": tag.upper()}
        children = [child for child in element if _tag(child) not in _IGNORED_TAGS]
        if tag == "atleast":
            data["k"] = int(element.get("min", element.get("k", "1")))
        elif tag == "cardinality":
            data["min"] = int(element.get("min", "0"))
            data["max"] = int(element.get("max", str(len(children))))
        add_node(node_id, node_type, data)
        roles = ("antecedent", "consequent") if tag == "imply" else ()
        for order, child_formula in enumerate(children):
            child_id = parse_formula(child_formula)
            role = roles[order] if order < len(roles) else (
                "primary" if tag == "inhibit" and order == 0 else
                "condition" if tag == "inhibit" else "input"
            )
            add_edge(node_id, child_id, order, role)
        return node_id

    expanding: set[str] = set()

    def expand_gate(name: str) -> str:
        if name in expanded_gates:
            return gate_ids[name]
        if name in expanding:
            raise OpenPSAError(
                f"Gate-reference cycle detected at {name!r}.",
                code="OPENPSA_CAUSAL_CYCLE",
            )
        expanding.add(name)
        definition = gate_defs[name]
        formula = _first_formula_child(definition)
        if formula is None:
            raise OpenPSAError(f"Gate {name!r} has no formula.")
        node_id = gate_ids[name]
        formula_root = parse_formula(formula, owner=node_id)
        if formula_root != node_id:
            # A one-input OR is Perdura's explicit top/intermediate gate
            # representation. It preserves a named OpenPSA gate alias without
            # maintaining a separate pass-through node type.
            add_node(node_id, "or", {"label": name})
            add_edge(node_id, formula_root, 0)
        node_by_id[node_id]["data"].update({"label": name, "openpsaName": name})
        expanding.remove(name)
        expanded_gates.add(name)
        return node_id

    root_id = expand_gate(selected_top)

    # Layer the imported graph for immediate readability. Shared inputs are
    # placed at their deepest occurrence so all incoming connections remain
    # visually legible.
    children: dict[str, list[str]] = defaultdict(list)
    for edge in edges:
        children[edge["source"]].append(edge["target"])
    depth = {root_id: 0}
    queue = deque([root_id])
    while queue:
        parent = queue.popleft()
        for child in children.get(parent, []):
            candidate = depth[parent] + 1
            if candidate > depth.get(child, -1):
                depth[child] = candidate
                queue.append(child)
    layers: dict[int, list[str]] = defaultdict(list)
    for node in nodes:
        layers[depth.get(node["id"], 0)].append(node["id"])
    for layer, ids in layers.items():
        width = max(0, len(ids) - 1) * 240
        for index, node_id in enumerate(ids):
            node_by_id[node_id]["position"] = {
                "x": 500 - width / 2 + index * 240,
                "y": 80 + layer * 170,
            }

    return {
        "schema_version": 2,
        "format": "OpenPSA Model Exchange Format",
        "tree_name": tree.get("name") or "Imported OpenPSA tree",
        "top_event": selected_top,
        "root_id": root_id,
        "nodes": nodes,
        "edges": edges,
        "warnings": warnings,
        "available_trees": [el.get("name", "(unnamed)") for el in tree_elements],
        "candidate_top_events": candidates,
    }


def _xml_ref(parent: ET.Element, node: Mapping[str, Any],
             event_names: Mapping[str, str]) -> None:
    node_type = str(node["type"])
    data = dict(node.get("data") or {})
    if node_type in EVENT_TYPES:
        tag = "house-event" if node_type == "house" else "basic-event"
        ET.SubElement(parent, tag, {"name": event_names[str(node["id"])]})
    else:
        ET.SubElement(parent, "gate", {"name": str(data.get("openpsaName") or node["id"])})


def export_openpsa(nodes: Iterable[Mapping[str, Any]],
                   edges: Iterable[Mapping[str, Any]], *,
                   tree_name: str = "Perdura_Fault_Tree") -> dict[str, Any]:
    """Export a validated static Perdura tree as OpenPSA XML."""
    raw_nodes = [dict(node) for node in nodes]
    raw_edges = [dict(edge) for edge in edges]
    graph = compile_graph(raw_nodes, raw_edges)
    unsupported = [
        node for node in graph.nodes.values()
        if node.type in DYNAMIC_GATE_TYPES | CONSTRAINT_TYPES | {"transfer"}
    ]
    if unsupported:
        detail = ", ".join(f"{node.label} ({node.type})" for node in unsupported)
        raise OpenPSAError(
            "OpenPSA static export cannot preserve dynamic, dependency, or "
            f"unexpanded transfer constructs: {detail}.",
            code="OPENPSA_EXPORT_UNSUPPORTED",
        )

    gate_names = [
        str(node.data.get("openpsaName") or node.id)
        for node in graph.nodes.values() if node.type not in EVENT_TYPES
    ]
    duplicates = sorted({name for name in gate_names if gate_names.count(name) > 1})
    if duplicates:
        raise OpenPSAError(
            "OpenPSA gate names must be unique; duplicated: " + ", ".join(duplicates) + ".",
            code="OPENPSA_EXPORT_DUPLICATE_NAME",
        )

    warnings: list[dict[str, Any]] = []
    node_by_id = graph.nodes
    event_name_for_key: dict[str, str] = {}
    event_names: dict[str, str] = {}
    used_names: set[str] = set()
    for node in graph.nodes.values():
        if node.type not in EVENT_TYPES:
            continue
        key = node.event_key
        if key not in event_name_for_key:
            preferred = str(node.data.get("openpsaName") or node.data.get("label") or key)
            name = preferred
            suffix = 2
            while name in used_names:
                name = f"{preferred}_{suffix}"
                suffix += 1
            used_names.add(name)
            event_name_for_key[key] = name
        event_names[node.id] = event_name_for_key[key]

    root = ET.Element("opsa-mef", {"version": "2.0"})
    tree = ET.SubElement(root, "define-fault-tree", {"name": tree_name})
    ET.SubElement(tree, "label").text = (
        f"Top event: {node_by_id[graph.root_id].data.get('openpsaName') or graph.root_id}"
    )

    def child_refs(node_id: str) -> list[Mapping[str, Any]]:
        return [node_by_id[edge.target] for edge in graph.inputs.get(node_id, [])]

    def emit_refs(parent: ET.Element, values: Iterable[Mapping[str, Any]]) -> None:
        for child in values:
            _xml_ref(parent, {"id": child.id, "type": child.type, "data": child.data}, event_names)

    def emit_formula(parent: ET.Element, node_id: str) -> None:
        node = node_by_id[node_id]
        children = child_refs(node_id)
        node_type = node.type
        if node_type in PASS_THROUGH_TYPES:
            _xml_ref(parent, {"id": children[0].id, "type": children[0].type,
                              "data": children[0].data}, event_names)
            return
        if node_type in EVENT_TYPES:
            _xml_ref(parent, {"id": node.id, "type": node.type,
                              "data": node.data}, event_names)
            return
        if node_type == "or" and len(children) == 1:
            _xml_ref(parent, {"id": children[0].id, "type": children[0].type,
                              "data": children[0].data}, event_names)
        elif node_type in {"and", "or", "not"}:
            expression = ET.SubElement(parent, node_type)
            emit_refs(expression, children)
        elif node_type == "vote":
            expression = ET.SubElement(parent, "atleast", {
                "min": str(int(node.data.get("k", 2))),
            })
            emit_refs(expression, children)
        elif node_type == "cardinality":
            expression = ET.SubElement(parent, "cardinality", {
                "min": str(int(node.data.get("min", node.data.get("low", 1)))),
                "max": str(int(node.data.get("max", node.data.get("high", len(children))))),
            })
            emit_refs(expression, children)
        elif node_type in {"nand", "nor"}:
            outer = ET.SubElement(parent, "not")
            inner = ET.SubElement(outer, "and" if node_type == "nand" else "or")
            emit_refs(inner, children)
        elif node_type == "xor":
            # Portable two-input expansion: (A and not B) or (not A and B).
            expression = ET.SubElement(parent, "or")
            for direct, negated in ((children[0], children[1]), (children[1], children[0])):
                conjunction = ET.SubElement(expression, "and")
                _xml_ref(conjunction, {"id": direct.id, "type": direct.type,
                                       "data": direct.data}, event_names)
                negation = ET.SubElement(conjunction, "not")
                _xml_ref(negation, {"id": negated.id, "type": negated.type,
                                    "data": negated.data}, event_names)
        elif node_type == "iff":
            expression = ET.SubElement(parent, "or")
            both = ET.SubElement(expression, "and")
            emit_refs(both, children)
            neither = ET.SubElement(expression, "and")
            for child in children:
                negation = ET.SubElement(neither, "not")
                _xml_ref(negation, {"id": child.id, "type": child.type,
                                    "data": child.data}, event_names)
        elif node_type == "imply":
            expression = ET.SubElement(parent, "or")
            negation = ET.SubElement(expression, "not")
            _xml_ref(negation, {"id": children[0].id, "type": children[0].type,
                                "data": children[0].data}, event_names)
            _xml_ref(expression, {"id": children[1].id, "type": children[1].type,
                                  "data": children[1].data}, event_names)
        elif node_type == "inhibit":
            expression = ET.SubElement(parent, "and")
            emit_refs(expression, children)
        else:  # pragma: no cover - compile/export eligibility owns this
            raise OpenPSAError(f"Cannot export gate type {node_type!r}.")

    # Definitions are emitted in topological-independent form; gate references
    # let OpenPSA tools choose their own evaluation order.
    for node in graph.nodes.values():
        if node.type in EVENT_TYPES:
            continue
        name = str(node.data.get("openpsaName") or node.id)
        definition = ET.SubElement(tree, "define-gate", {"name": name})
        emit_formula(definition, node.id)

    emitted_keys: set[str] = set()
    for node in graph.nodes.values():
        if node.type not in EVENT_TYPES or node.event_key in emitted_keys:
            continue
        emitted_keys.add(node.event_key)
        name = event_name_for_key[node.event_key]
        if node.type == "house":
            definition = ET.SubElement(tree, "define-house-event", {"name": name})
            ET.SubElement(definition, "constant", {
                "value": "true" if bool(node.data.get("state", False)) else "false",
            })
            continue
        definition = ET.SubElement(tree, "define-basic-event", {"name": name})
        probability = node.data.get("probability")
        if probability is None or node.data.get("sourceIncomplete"):
            raise OpenPSAError(
                f"Event {node.label!r} has no resolved mission probability to export.",
                code="OPENPSA_EXPORT_SOURCE_REQUIRED",
            )
        if node.data.get("distribution"):
            warnings.append({
                "severity": "warning", "code": "OPENPSA_DISTRIBUTION_SNAPSHOT",
                "message": (
                    f"Exported {node.label!r} as its displayed mission probability; "
                    "the Perdura time-distribution model is not embedded in this static exchange."
                ),
            })
        ET.SubElement(definition, "float", {"value": format(float(probability), ".17g")})

    try:
        ET.indent(root, space="  ")
    except AttributeError:  # pragma: no cover - Python <3.9
        pass
    xml = ET.tostring(root, encoding="unicode", xml_declaration=True)
    return {
        "format": "OpenPSA Model Exchange Format",
        "schema_version": 2,
        "tree_name": tree_name,
        "top_event": str(node_by_id[graph.root_id].data.get("openpsaName") or graph.root_id),
        "xml": xml,
        "warnings": warnings,
    }


__all__ = ["OpenPSAError", "export_openpsa", "import_openpsa"]
