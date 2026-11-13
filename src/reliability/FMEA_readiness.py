"""Deterministic architecture and prerequisite checks, independent of UI state.

Drafts remain serializable. Executable studies are checked against the canonical
architecture; no client readiness flag or copied engineering statement is trusted.
"""
from __future__ import annotations

from collections import defaultdict, deque
from copy import deepcopy
from hashlib import sha256
import json
from typing import Any, Mapping


STATE_VERBS = frozenset(("maintain", "secure", "support", "contain", "isolate", "protect"))


def occurrence_enabled(raw, override):
    return override["enabled"] if override.get("enabled") is not None else raw.get("default_enabled", True)


def effective_function(raw, override):
    """Resource bindings specialize occurrence I/O without freezing its action."""
    fn = {**raw, **{key: value for key, value in override.items()
        if value is not None and key not in ("function_id", "enabled", "resource_bindings")}}
    definition = fn.get("definition")
    if definition and override.get("resource_bindings"):
        fn["definition"] = {**definition, "io": [
            {**io, "resource_id": override["resource_bindings"].get(io["id"], io.get("resource_id", ""))}
            for io in definition.get("io", [])]}
    return fn


def resource_owners(functions, externals):
    owners = defaultdict(list)
    for key, fn in functions.items():
        for io in (fn.get("definition") or {}).get("io", []):
            if io.get("direction") == "output" and io.get("resource_id"):
                owners[io["resource_id"]].append({"kind": "function", "instance_id": fn["instance_id"], "function_id": fn["id"], "io_id": io["id"], "key": key})
    for actor in externals:
        for port in actor.get("ports", []):
            if port.get("resource_id") and port.get("direction") in ("output", "bidirectional"):
                owners[port["resource_id"]].append({"kind": "external", "external_id": actor["id"], "port_id": port["id"]})
    return dict(owners)


def _hash(value: Any) -> str:
    return sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()


def _applies(modes, mode):
    return not modes or not mode or mode in modes


def _key(ref):
    return f"{ref.get('instance_id', '')}::{ref.get('function_id', '')}"


def _modes(value, all_modes):
    return set(value or all_modes or ["*"])


def architecture_context(model: Mapping, binding: Mapping, *, include_inactive=False) -> dict:
    """Index only scope, connected functions, and their ancestor support chains."""
    definitions = {item["id"]: item for item in model.get("definitions", [])}
    instances = {item["id"]: item for item in model.get("instances", [])}
    children = defaultdict(list)
    for item in instances.values():
        children[item.get("parent_instance_id")].append(item["id"])
    mode = binding.get("mode_id")
    scope = set()
    pending = [binding.get("scope_instance_id")]
    explicit_parts = set(binding.get("included_piece_part_ids", []))
    endpoints = {edge.get(side, {}).get("instance_id") for edge in model.get("interfaces", []) for side in ("source", "target")}
    while pending:
        ident = pending.pop()
        if ident in scope or ident not in instances:
            continue
        item = instances[ident]
        if not _applies(item.get("mode_ids"), mode):
            continue
        if definitions.get(item.get("definition_id"), {}).get("kind") == "piece_part" and ident not in explicit_parts | endpoints and ident != binding.get("scope_instance_id"):
            continue
        scope.add(ident)
        pending.extend(children[ident])
    functions = {}
    for ident, instance in instances.items():
        if not _applies(instance.get("mode_ids"), mode):
            continue
        overrides = {item["function_id"]: item for item in instance.get("function_overrides", [])}
        for raw in definitions.get(instance.get("definition_id"), {}).get("functions", []):
            override = overrides.get(raw["id"], {})
            if occurrence_enabled(raw, override) is False and not include_inactive:
                continue
            fn = {**effective_function(raw, override), "instance_id": ident}
            if _applies(fn.get("mode_ids"), mode):
                functions[f"{ident}::{fn['id']}"] = fn
    owner_functions = {key: fn for key, fn in functions.items() if occurrence_enabled(fn, next((override for override in instances[fn["instance_id"]].get("function_overrides", []) if override.get("function_id") == fn["id"]), {}))}
    owners = resource_owners(owner_functions, model.get("externals", []))
    interfaces = [item for item in model.get("interfaces", []) if _applies(item.get("mode_ids"), mode) and any(item.get(side, {}).get("instance_id") in scope for side in ("source", "target"))]
    required = {key for key, fn in functions.items() if fn["instance_id"] in scope}
    for edge in interfaces:
        for transfer in edge.get("transfers", []):
            if not _applies(transfer.get("mode_ids"), mode):
                continue
            for side in ("source", "target"):
                endpoint = transfer.get(side, {})
                if endpoint.get("kind") == "function" or endpoint.get("kind") == "block" and endpoint.get("function_id"):
                    required.add(_key(endpoint))
    links = [item for item in model.get("function_links", []) if _applies(item.get("mode_ids"), mode)]
    support = defaultdict(list)
    for link in links:
        if link.get("relationship") == "decomposes_to":
            support[_key(link.get("target", {}))].append(link)
    pending = deque(required)
    while pending:
        key = pending.popleft()
        fn = functions.get(key, {})
        for io in (fn.get("definition") or {}).get("io", []):
            if fn.get("instance_id") in scope and io.get("direction") == "input":
                for owner in owners.get(io.get("resource_id"), []):
                    if owner.get("key") and owner["key"] not in required:
                        required.add(owner["key"])
                        pending.append(owner["key"])
        for link in support[key]:
            parent = _key(link.get("source", {}))
            if parent not in required:
                required.add(parent)
                pending.append(parent)
    context_instances = set(scope)
    context_instances.update(fn["instance_id"] for key, fn in functions.items() if key in required)
    for edge in interfaces:
        context_instances.update(edge.get(side, {}).get("instance_id") for side in ("source", "target"))
    traced_ancestors = set()
    for ident in list(context_instances):
        while ident in instances and ident not in traced_ancestors:
            traced_ancestors.add(ident)
            context_instances.add(ident)
            ident = instances[ident].get("parent_instance_id")
    context_instances.discard(None)
    definition_ids = {instances[ident].get("definition_id") for ident in context_instances if ident in instances}
    resources = {item["id"]: item for item in model.get("resources", [])}
    resource_ids = {io.get("resource_id") for key, fn in functions.items() if key in required for io in (fn.get("definition") or {}).get("io", [])}
    resource_ids.update(t.get("resource_id") for edge in interfaces for t in edge.get("transfers", []))
    semantic = {
        "id": model.get("id"), "version": model.get("version"), "binding": dict(binding),
        "instances": [{key: item.get(key) for key in ("id", "definition_id", "parent_instance_id", "name", "mode_ids", "quantity")} for ident, item in instances.items() if ident in context_instances],
        "definitions": [{"id": item["id"], "name": item.get("name"), "kind": item.get("kind"), "ports": item.get("ports", [])} for item in definitions.values() if item["id"] in definition_ids],
        "functions": [fn for key, fn in functions.items() if key in required],
        "resources": [value for ident, value in resources.items() if ident in resource_ids],
        "interfaces": interfaces,
        "function_links": [link for link in links if _key(link.get("source", {})) in required and _key(link.get("target", {})) in required],
        "modes": model.get("modes", []),
        "failures": [{"instance_id": ident, "failures": definitions.get(instances[ident].get("definition_id"), {}).get("failure_modes", []), "overrides": instances[ident].get("failure_mode_overrides", [])} for ident in sorted(scope)],
        "externals": [item for item in model.get("externals", []) if any(port.get("resource_id") in resource_ids for port in item.get("ports", [])) or any(edge.get(side, {}).get("external_id") == item["id"] for edge in interfaces for side in ("source", "target"))],
    }
    return {"owners": owners, "definitions": definitions, "instances": instances, "scope": scope, "functions": functions, "required": required, "interfaces": interfaces, "links": links, "support": support, "resources": resources, "context_instances": context_instances, "semantic": semantic}


def _local_architecture(analysis):
    """PFMEA process steps are independent occurrences, not physical blocks."""
    externals = {}
    blocks = {item["id"]: item for item in analysis.get("block_diagram", {}).get("nodes", [])}
    for node in blocks.values():
        if node.get("kind") == "external":
            externals[node["id"]] = {"id": node["id"], "name": node.get("label", ""), "ports": deepcopy(node.get("ports", []))}
    def endpoint(edge, side):
        ident = edge.get(side + "_structure_node_id") or blocks.get(edge.get(side + "_block_id"), {}).get("structure_node_id")
        if ident:
            return {"instance_id": ident}
        external_id = edge.get(side + "_block_id") or f"external-{edge['id']}-{side}"
        externals.setdefault(external_id, {"id": external_id, "name": edge.get("external_" + side) or external_id, "ports": deepcopy(blocks.get(external_id, {}).get("ports", []))})
        return {"external_id": external_id}
    local_interfaces = [{**edge, "source": endpoint(edge, "source"), "target": endpoint(edge, "target")} for edge in analysis.get("interfaces", [])]
    roots = [n["id"] for n in analysis.get("structure_nodes", []) if not n.get("parent_id")]
    return {
        "externals": list(externals.values()),
        "version": 4, "id": analysis.get("id"), "root_instance_id": roots[0] if len(roots) == 1 else None,
        "modes": [{"id": mode} for mode in sorted({mode for f in analysis.get("functions", []) for mode in f.get("operating_modes", [])})],
        "resources": analysis.get("resources", []),
        "definitions": [{"id": n["id"], "name": n.get("name", ""), "kind": "component", "ports": [], "functions": [{**f, "mode_ids": f.get("operating_modes", [])} for f in analysis.get("functions", []) if f.get("structure_node_id") == n["id"]]} for n in analysis.get("structure_nodes", [])],
        "instances": [{"id": n["id"], "name": n.get("name", ""), "definition_id": n["id"], "parent_instance_id": n.get("parent_id")} for n in analysis.get("structure_nodes", [])],
        "interfaces": local_interfaces,
        "function_links": [{**link, "source": {"instance_id": next((f.get("structure_node_id") for f in analysis.get("functions", []) if f["id"] == link.get("source_function_id")), ""), "function_id": link.get("source_function_id")}, "target": {"instance_id": next((f.get("structure_node_id") for f in analysis.get("functions", []) if f["id"] == link.get("target_function_id")), ""), "function_id": link.get("target_function_id")}} for link in analysis.get("function_links", [])],
    }


def architecture_findings(model: Mapping, context: Mapping, *, include_completeness=True) -> list[dict]:
    findings = []
    def add(code, message, record_type, record_id, path, step=3):
        findings.append({"code": code, "message": message, "step": step, "record_type": record_type, "record_id": record_id, "path": path, "severity": "error"})
    instances, definitions, functions, resources = (context[key] for key in ("instances", "definitions", "functions", "resources"))
    all_modes = [item["id"] for item in model.get("modes", [])]
    for collection in ("instances", "definitions", "resources", "interfaces", "modes", "function_links"):
        identifiers = set()
        for item in model.get(collection, []):
            if not item.get("id") or item["id"] in identifiers:
                add("duplicate_identity", "Architecture records require unique nonempty identifiers.", collection, item.get("id", ""), collection + ".id", 2)
            identifiers.add(item.get("id"))
    mode = context["semantic"]["binding"].get("mode_id")
    def active_modes(value):
        return ({mode} if _applies(value, mode) else set()) if mode else _modes(value, all_modes)
    def function_modes(fn):
        return active_modes(fn.get("mode_ids")) & active_modes(instances.get(fn.get("instance_id"), {}).get("mode_ids"))
    roots = [item["id"] for item in instances.values() if not item.get("parent_instance_id")]
    if model.get("root_instance_id") and (len(roots) != 1 or roots[0] != model.get("root_instance_id")):
        add("invalid_hierarchy", "The canonical architecture must have exactly one root system.", "system", model.get("id"), "root_instance_id", 2)
    function_instances = {fn["instance_id"] for fn in functions.values()}
    checked_hierarchy = set()
    for ident in sorted(context["context_instances"]):
        instance = instances.get(ident)
        if not instance:
            add("invalid_hierarchy", "The referenced installed block does not exist.", "instance", ident, f"instances.{ident}", 2)
            continue
        definition = definitions.get(instance.get("definition_id"))
        if set(instance.get("mode_ids", [])) - set(all_modes):
            add("unknown_mode", "Select an existing operating mode for this installed block.", "instance", ident, f"instances.{ident}.mode_ids")
        if not definition:
            add("invalid_hierarchy", "Select an existing block definition.", "instance", ident, f"instances.{ident}.definition_id", 2)
        elif not str(instance.get("name") or definition.get("name") or "").strip():
            add("missing_block_name", "Name the installed block.", "instance", ident, f"instances.{ident}.name", 2)
        seen, cursor = set(), ident
        while cursor and cursor not in checked_hierarchy:
            if cursor in seen or cursor not in instances:
                add("invalid_hierarchy", "Repair the missing parent or containment cycle.", "instance", ident, f"instances.{ident}.parent_instance_id", 2)
                break
            seen.add(cursor)
            cursor = instances[cursor].get("parent_instance_id")
        checked_hierarchy.update(seen)
        if include_completeness and ident in context["scope"] and ident not in function_instances:
            add("missing_function_coverage", "Define at least one active structured function for this block.", "instance", ident, f"instances.{ident}.functions")
    paired = defaultdict(set)
    owners = context["owners"]
    externals = {item["id"]: item for item in model.get("externals", [])}
    relevant_resources = {io.get("resource_id") for key in context["required"] for io in (functions.get(key, {}).get("definition") or {}).get("io", [])}
    if not include_completeness:
        relevant_resources.update(owners)
    for resource_id in relevant_resources:
        if len(owners.get(resource_id, [])) > 1:
            add("duplicate_resource_owner", "Each output resource must have exactly one producing function or external terminal.", "resource", resource_id, f"resources.{resource_id}")
    for actor in externals.values():
        for port in actor.get("ports", []):
            if port.get("resource_id") and (not include_completeness or port["resource_id"] in relevant_resources):
                resource = resources.get(port["resource_id"])
                if not resource:
                    add("missing_resource", "Select an existing output resource for the external terminal.", "external", actor["id"], f"externals.{actor['id']}.ports.{port['id']}")
                elif port.get("interface_type") != resource.get("category") or port.get("direction") not in ("output", "bidirectional"):
                    add("invalid_resource_owner", "An external output resource requires a compatible producing terminal.", "external", actor["id"], f"externals.{actor['id']}.ports.{port['id']}")
    for edge in context["interfaces"]:
        edge_id = edge["id"]
        transfers = [transfer for transfer in edge.get("transfers", []) if _applies(transfer.get("mode_ids"), mode)]
        if set(edge.get("mode_ids", [])) - set(all_modes):
            add("unknown_mode", "Select existing interface operating modes.", "interface", edge_id, f"interfaces.{edge_id}.mode_ids")
        if include_completeness and not transfers:
            add("incomplete_interface_transfer", "Pair a provider output with a receiver input, or define a symmetric relation.", "interface", edge_id, f"interfaces.{edge_id}.transfers")
        ids = set()
        for transfer in transfers:
            path = f"interfaces.{edge_id}.transfers.{transfer.get('id', '')}"
            if set(transfer.get("mode_ids", [])) - set(all_modes):
                add("unknown_mode", "Select existing transfer operating modes.", "interface", edge_id, path + ".mode_ids")
            if not transfer.get("id") or transfer.get("id") in ids:
                add("duplicate_transfer_id", "Transfer IDs must be unique within an interface.", "interface", edge_id, path)
            ids.add(transfer.get("id"))
            resource = resources.get(transfer.get("resource_id"))
            is_relation = transfer.get("kind") == "relation"
            if is_relation:
                if transfer.get("resource_id") or edge.get("interface_type") not in ("physical", "clearance"):
                    add("incompatible_transfer_resource", "Physical relations connect blocks without a resource.", "interface", edge_id, path)
            elif not resource:
                add("missing_resource", "Select an existing resource.", "interface", edge_id, path + ".resource_id")
            elif resource.get("category") != edge.get("interface_type"):
                add("incompatible_transfer_resource", "The transferred resource category must match the interface type.", "interface", edge_id, path + ".resource_id")
            terminal_pairs = [(edge.get("source", {}), edge.get("target", {}))]
            if is_relation or edge.get("directionality") in ("bidirectional", "undirected"):
                terminal_pairs.append(tuple(reversed(terminal_pairs[0])))
            def matches(endpoint, terminal):
                return (endpoint.get("instance_id") == terminal.get("instance_id") if endpoint.get("kind") in ("function", "block") else endpoint.get("external_id") == terminal.get("external_id") and (not terminal.get("port_id") or endpoint.get("port_id") == terminal.get("port_id")))
            if not any(matches(transfer.get("source", {}), left) and matches(transfer.get("target", {}), right) for left, right in terminal_pairs):
                add("invalid_transfer_endpoint", "Transfer endpoints must belong to this interface's actual blocks or external terminals.", "interface", edge_id, path)
            for side, direction in (("source", "output"), ("target", "input")):
                endpoint = transfer.get(side, {})
                if endpoint.get("kind") == "external":
                    actor = externals.get(endpoint.get("external_id"), {})
                    port = next((p for p in actor.get("ports", []) if p["id"] == endpoint.get("port_id")), None)
                    if not actor or (not is_relation or endpoint.get("port_id")) and not port:
                        add("invalid_transfer_endpoint", "Select an existing external actor or typed flow terminal.", "interface", edge_id, path + "." + side)
                    elif resource and port.get("interface_type") != resource.get("category"):
                        add("incompatible_transfer_resource", "External terminal type must match the transferred resource.", "interface", edge_id, path + "." + side)
                    elif not is_relation and port and port.get("direction") not in (direction, "bidirectional"):
                        add("incompatible_transfer_direction", "External terminal direction must match the transferred flow.", "interface", edge_id, path + "." + side)
                    if not is_relation and side == "source" and port and port.get("resource_id") != transfer.get("resource_id"):
                        add("invalid_resource_owner", "The external source terminal must own this output resource.", "interface", edge_id, path + ".source")
                    continue
                if is_relation:
                    fn = functions.get(_key(endpoint))
                    if endpoint.get("kind") != "block" or endpoint.get("instance_id") not in instances or endpoint.get("io_id"):
                        add("invalid_transfer_endpoint", "Physical relations reference blocks without resource I/O.", "interface", edge_id, path + "." + side)
                    elif endpoint.get("function_id") and (not fn or (fn.get("definition") or {}).get("role") != "maintain_state"):
                        add("invalid_relation_function", "A physical relation may reference a Maintain State function.", "interface", edge_id, path + "." + side)
                    elif fn and include_completeness and not (active_modes(transfer.get("mode_ids")) & active_modes(edge.get("mode_ids"))) <= function_modes(fn):
                        add("incomplete_transfer_mode_coverage", "The endpoint function must be active in every relation mode.", "interface", edge_id, path + ".mode_ids")
                    continue
                key = _key(endpoint)
                fn = functions.get(key)
                io = next((item for item in (fn or {}).get("definition", {}).get("io", []) if item.get("id") == endpoint.get("io_id")), None) if (fn or {}).get("definition") else None
                if endpoint.get("kind") != "function" or not io:
                    add("invalid_transfer_endpoint", "Select an active function and its resource input/output.", "interface", edge_id, path + "." + side)
                    continue
                terminals = [edge.get(end, {}) for end in ("source", "target") if edge.get(end, {}).get("instance_id") == endpoint.get("instance_id")]
                terminal = next((item for item in terminals if io.get("port_id") and item.get("port_id") == io["port_id"]), terminals[0] if terminals else {})
                terminal_port = next((port for port in definitions.get(instances.get(endpoint.get("instance_id"), {}).get("definition_id"), {}).get("ports", []) if port["id"] == terminal.get("port_id")), None)
                if include_completeness and terminal.get("port_id") and io.get("port_id") and terminal["port_id"] != io["port_id"]:
                    add("transfer_endpoint_mismatch", "Choose the function I/O attached to this interface's selected port.", "interface", edge_id, path + "." + side)
                if include_completeness and terminal_port and resource and (terminal_port.get("interface_type") != resource.get("category") or not is_relation and terminal_port.get("direction") not in (direction, "bidirectional")):
                    add("incompatible_function_port", "The selected interface port must match the resource category and flow direction.", "interface", edge_id, path + "." + side)
                if io.get("resource_id") != transfer.get("resource_id"):
                    add("incompatible_transfer_resource", "Both functions must reference the same transferred resource.", "interface", edge_id, path + "." + side)
                if io.get("direction") != direction:
                    add("incompatible_transfer_direction", "Directed flow must pair an output with an input.", "interface", edge_id, path + "." + side)
                transfer_modes = active_modes(transfer.get("mode_ids")) & active_modes(edge.get("mode_ids"))
                if include_completeness and not transfer_modes <= function_modes(fn):
                    add("incomplete_transfer_mode_coverage", "The endpoint function must be active in every transfer mode.", "interface", edge_id, path + ".mode_ids")
                if io.get("direction") == direction:
                    paired[(key, io["id"])].update(transfer_modes)
        if include_completeness and transfers:
            edge_modes = active_modes(edge.get("mode_ids"))
            def transfer_active(transfer, candidate):
                if candidate not in active_modes(transfer.get("mode_ids")):
                    return False
                return all(endpoint.get("kind") == "external" or endpoint.get("kind") == "block" and not endpoint.get("function_id") or (_key(endpoint) in functions and candidate in function_modes(functions[_key(endpoint)])) for endpoint in (transfer.get("source", {}), transfer.get("target", {})))
            if any(not any(transfer_active(transfer, candidate) for transfer in transfers) for candidate in edge_modes):
                add("incomplete_transfer_mode_coverage", "Define a transfer with active endpoint functions in every interface mode.", "interface", edge_id, f"interfaces.{edge_id}.transfers")
            if edge.get("directionality") == "bidirectional" and any(t.get("kind") == "flow" for t in transfers):
                if any(not any(transfer.get("kind") == "flow" and transfer_active(transfer, candidate) and matches(transfer.get("source", {}), edge.get(side, {})) for transfer in transfers) for candidate in edge_modes for side in ("source", "target")):
                    add("incompatible_transfer_direction", "A bidirectional interface requires an explicit transfer in each direction for every interface mode.", "interface", edge_id, f"interfaces.{edge_id}.transfers")
    for key in sorted(context["required"]):
        fn = functions.get(key)
        if not fn:
            add("invalid_parent_support", "The referenced function must exist and be enabled in this mode.", "function", key, "function_links")
            continue
        path = f"instances.{fn['instance_id']}.functions.{fn['id']}"
        if set(fn.get("mode_ids", [])) - set(all_modes):
            add("unknown_mode", "Select an existing function operating mode.", "function", key, path + ".mode_ids")
        definition = fn.get("definition")
        if not definition:
            if include_completeness:
                add("missing_function_definition", "Define this function's action, inputs, and output, or maintained condition.", "function", key, path + ".definition")
        else:
            if include_completeness and not str(definition.get("action") or "").strip():
                add("missing_function_action", "Describe what this function does or the condition it maintains.", "function", key, path + ".definition.action")
            if definition.get("state_verb") and definition["state_verb"] not in STATE_VERBS:
                add("invalid_state_verb", "Choose a supported Maintain State action.", "function", key, path + ".definition.state_verb")
            io_rows = definition.get("io", [])
            role = definition.get("role")
            inputs = [io for io in io_rows if io.get("direction") == "input"]
            outputs = [io for io in io_rows if io.get("direction") == "output"]
            if include_completeness and ((role == "transform" and (not inputs or len(outputs) != 1)) or (role == "source" and (inputs or len(outputs) != 1)) or (role == "maintain_state" and io_rows) or role not in ("transform", "source", "maintain_state")):
                add("missing_function_io", "Transform requires inputs and one output; Source requires one output; Maintain State has no resource I/O.", "function", key, path + ".definition.io")
            override = next((item for item in instances.get(fn["instance_id"], {}).get("function_overrides", []) if item.get("function_id") == fn["id"]), {})
            if set(override.get("resource_bindings") or {}) - {io.get("id") for io in io_rows}:
                add("invalid_resource_binding", "Occurrence resource bindings must reference existing function I/O.", "function", key, path + ".resource_bindings")
            seen = set()
            for io in io_rows:
                if not io.get("id") or io.get("id") in seen or io.get("direction") not in ("input", "output"):
                    add("invalid_function_io", "Function resource IDs must be unique.", "function", key, path + ".definition.io")
                seen.add(io.get("id"))
                resource = resources.get(io.get("resource_id"))
                ports = definitions.get(instances.get(fn["instance_id"], {}).get("definition_id"), {}).get("ports", [])
                io_port = next((port for port in ports if port["id"] == io.get("port_id")), None)
                if io.get("port_id") and not io_port:
                    add("missing_port", "Select an existing port on this installed block definition.", "function", key, path + ".definition.io")
                if include_completeness and io_port and resource and (io_port.get("interface_type") != resource.get("category") or io.get("direction") != "state" and io_port.get("direction") not in (io.get("direction"), "bidirectional")):
                    add("incompatible_function_port", "Function I/O must match its port's resource category and direction.", "function", key, path + ".definition.io")
                if not resource and (include_completeness or io.get("resource_id")):
                    add("missing_resource", "Select an existing resource for this function.", "function", key, path + ".definition.io")
                elif resource and include_completeness and not str(resource.get("name") or "").strip():
                    add("missing_resource_name", "Give the resource a meaningful name.", "resource", resource["id"], f"resources.{resource['id']}.name")
                producers = owners.get(io.get("resource_id"), [])
                if io.get("direction") == "input" and resource:
                    if any(owner.get("key") == key for owner in producers):
                        add("self_resource_input", "A function cannot consume its own output; connect a distinct function's output.", "function", key, path + ".definition.io")
                    if include_completeness and fn["instance_id"] in context["scope"] and not producers:
                        add("missing_resource_owner", "Choose an output produced by a function or typed external source.", "function", key, path + ".definition.io")
                    if include_completeness and fn["instance_id"] in context["scope"] and len(producers) == 1:
                        owner = producers[0]
                        source_fn = functions.get(owner.get("key"))
                        if source_fn and not function_modes(fn) <= function_modes(source_fn):
                            add("incomplete_input_mode_coverage", "The input's producer must be active in every mode of this function.", "function", key, path + ".definition.io")
                        if owner.get("instance_id") != fn["instance_id"] and not function_modes(fn) <= paired[(key, io["id"])]:
                            add("unpaired_function_io", "Connect this input to its producer in every applicable mode.", "function", key, path + ".definition.io")
        parent = instances.get(fn["instance_id"], {}).get("parent_instance_id")
        if not parent:
            continue
        links = context["support"].get(key, [])
        covered = set()
        for link in links:
            source = link.get("source", {})
            parent_fn = functions.get(_key(source))
            if source.get("instance_id") != parent or not parent_fn:
                if not include_completeness:
                    continue
                add("invalid_parent_support", "Allocate this function to an active function on its immediate installed parent.", "function_link", link["id"], f"function_links.{link['id']}")
            else:
                covered.update(active_modes(link.get("mode_ids")) & function_modes(parent_fn))
        if include_completeness and not links:
            add("missing_parent_support", "Select the immediate parent function supported by this function.", "function", key, path + ".parent_support")
        elif include_completeness and not function_modes(fn) <= covered:
            add("incomplete_parent_mode_coverage", "Parent support must cover every mode in which this function is active.", "function", key, path + ".parent_support")
    return findings


def _canonical_projection(study, canonical, context, findings):
    """Rebuild submitted physical snapshots by qualified identity, preserving risk IDs."""
    result = deepcopy(dict(study))
    analysis = result["model"]
    def mismatch(record_type, record_id, path):
        findings.append({"step": 2 if record_type == "structure" else 3, "code": "canonical_snapshot_mismatch", "severity": "error", "record_type": record_type, "record_id": record_id, "path": path, "message": "Refresh this record from the canonical System Model; its identity or engineering content differs."})
    structures = {}
    for node in analysis.get("structure_nodes", []):
        ref = node.get("system_definition_ref") or {}
        ident = ref.get("instance_id")
        instance = context["instances"].get(ident)
        if ref.get("system_model_id") != canonical.get("id") or not instance or ident not in context["context_instances"]:
            mismatch("structure", node["id"], f"structure_nodes.{node['id']}")
            continue
        if ref.get("definition_id") and ref["definition_id"] != instance.get("definition_id"):
            mismatch("structure", node["id"], f"structure_nodes.{node['id']}.system_definition_ref.definition_id")
        definition = context["definitions"].get(instance.get("definition_id"), {})
        name = instance.get("name") or definition.get("name", "")
        if node.get("name") != name:
            mismatch("structure", node["id"], f"structure_nodes.{node['id']}.name")
        node["name"] = name
        if ident in structures:
            mismatch("structure", node["id"], f"structure_nodes.{node['id']}.system_definition_ref")
        structures[ident] = node
    for ident in context["scope"]:
        if ident not in structures:
            mismatch("structure", ident, "structure_nodes")
    for ident, node in structures.items():
        parent = context["instances"][ident].get("parent_instance_id")
        expected_parent = structures.get(parent, {}).get("id")
        if (node.get("parent_id") or None) != expected_parent:
            mismatch("structure", node["id"], f"structure_nodes.{node['id']}.parent_id")
        node["parent_id"] = expected_parent
    present_functions = {}
    for fn in analysis.get("functions", []):
        ref = fn.get("system_definition_ref") or {}
        key = _key(ref)
        canonical_fn = context["functions"].get(key)
        if ref.get("system_model_id") != canonical.get("id") or not canonical_fn or key not in context["required"]:
            mismatch("function", fn["id"], f"functions.{fn['id']}")
            continue
        if ref.get("definition_id") and ref["definition_id"] != context["instances"][ref["instance_id"]].get("definition_id"):
            mismatch("function", fn["id"], f"functions.{fn['id']}.system_definition_ref.definition_id")
        if key in present_functions:
            mismatch("function", fn["id"], f"functions.{fn['id']}.system_definition_ref")
        present_functions[key] = fn
        expected = {"description": canonical_fn.get("description", ""), "definition": canonical_fn.get("definition"), "operating_modes": canonical_fn.get("mode_ids", []), "structure_node_id": structures.get(ref.get("instance_id"), {}).get("id")}
        if any(fn.get(field) != value for field, value in expected.items()):
            mismatch("function", fn["id"], f"functions.{fn['id']}")
        fn.update(deepcopy(expected))
    for key in context["required"]:
        if key not in present_functions:
            mismatch("function", key, "functions")
    canonical_edges = {edge["id"]: edge for edge in context["interfaces"]}
    seen = set()
    for edge in analysis.get("interfaces", []):
        ref = edge.get("system_definition_ref") or {}
        actual = canonical_edges.get(ref.get("interface_id"))
        if ref.get("system_model_id") != canonical.get("id") or not actual:
            mismatch("interface", edge["id"], f"interfaces.{edge['id']}")
            continue
        if actual["id"] in seen:
            mismatch("interface", edge["id"], f"interfaces.{edge['id']}.system_definition_ref")
        seen.add(actual["id"])
        expected = {field: actual.get(field, [] if field in ("transfers", "mode_ids") else "") for field in ("name", "interface_type", "directionality", "flow_description", "transfers", "mode_ids")}
        expected["generated"] = actual.get("generated")
        expected.update({side + "_structure_node_id": structures.get(actual.get(side, {}).get("instance_id"), {}).get("id") for side in ("source", "target")})
        if any(edge.get(field, [] if field in ("transfers", "mode_ids") else "" if field in ("name", "flow_description") else None) != value for field, value in expected.items()):
            mismatch("interface", edge["id"], f"interfaces.{edge['id']}")
        edge.update(deepcopy(expected))
    for ident in canonical_edges.keys() - seen:
        mismatch("interface", ident, "interfaces")
    # Support is derived from canonical allocations, never from copied study links.
    expected_links = []
    for link in context["semantic"]["function_links"]:
        source = present_functions.get(_key(link.get("source", {})))
        target = present_functions.get(_key(link.get("target", {})))
        if source and target:
            expected_links.append({"id": "SD-FLINK-" + link["id"], "source_function_id": source["id"],
                "target_function_id": target["id"], "relationship": link.get("relationship"),
                "rationale": link.get("rationale", ""), "mode_ids": link.get("mode_ids", []), "label": "", **({"generated": link["generated"]} if link.get("generated") is not None else {})})
    def link_identity(link):
        return (link.get("source_function_id"), link.get("target_function_id"), link.get("relationship"), tuple(sorted(link.get("mode_ids", []))))
    canonical_links = {link_identity(link): link for link in expected_links}
    supplied_links = set()
    for link in analysis.get("function_links", []):
        identity = link_identity(link)
        expected = canonical_links.get(identity)
        if not expected or identity in supplied_links or link.get("rationale", "") != expected["rationale"]:
            mismatch("function_link", link["id"], f"function_links.{link['id']}")
        elif expected:
            expected.update({"id": link["id"], "label": link.get("label", "")})
        supplied_links.add(identity)
    analysis["function_links"] = expected_links
    analysis["resources"] = deepcopy(list(context["resources"].values()))
    return result


def evaluate_fmea_readiness(study: Mapping, canonical_system: Mapping | None = None, *, rating_profiles=(), program_requirements=()) -> dict:
    """Return cumulative seven-step eligibility without executing FMEDA or analysis."""
    from reliability import AIAG_VDA_FMEA as core
    from reliability.FMEA import method_profiles, validate_governance, validate_evidence, validate_flowdown, validate_failure_flow
    analysis = study.get("model", {})
    findings = []
    def add(step, code, message, path, record_id=None, record_type="study", severity="error"):
        findings.append({"step": step, "code": code, "message": message, "path": path, "record_type": record_type, "record_id": record_id or study.get("id", ""), "severity": severity})
    if study.get("schema_version") != 4:
        add(1, "unsupported_schema", "Create a study using FMEA schema version 4.", "schema_version")
    planning = analysis.get("planning", {})
    for field in ("subject", "scope", "intent"):
        if not str(planning.get(field) or "").strip():
            add(1, "missing_" + field, f"Consider documenting the analysis {field}.", "planning." + field, severity="warning")
    if not any(str(item).strip() for item in planning.get("team", [])):
        add(1, "missing_team", "Consider identifying the responsible analysis team.", "planning.team", severity="warning")
    method = next((item for item in method_profiles() if item["id"] == study.get("method_profile_id")), None)
    if not method:
        add(1, "unknown_method_profile", "Select an available method profile.", "method_profile_id")
    elif analysis.get("kind") not in method["supported_kinds"]:
        add(1, "method_kind_mismatch", "Select a method supporting this analysis kind.", "method_profile_id")
    elif method.get("status") == "reference_gated":
        add(1, "method_reference_gated", "This method is not enabled for calculation or release.", "method_profile_id")
    context = None
    physical = analysis.get("kind") != "pfmea"
    if physical:
        binding = analysis.get("system_binding") or {}
        if not canonical_system:
            add(2, "missing_canonical_system", "Provide the project's canonical System Model.", "canonical_system")
        elif canonical_system.get("version") != 4:
            add(2, "unsupported_schema", "Create a version 4 canonical System Model.", "canonical_system.version")
        elif binding.get("system_model_id") != canonical_system.get("id"):
            add(2, "canonical_system_mismatch", "Bind the study to this project's canonical System Model.", "system_binding")
        elif not any(i["id"] == binding.get("scope_instance_id") for i in canonical_system.get("instances", [])):
            add(2, "missing_scope", "Choose an existing installed system element as the study scope.", "system_binding.scope_instance_id")
        else:
            if not canonical_system.get("root_instance_id") or not any(i["id"] == canonical_system.get("root_instance_id") for i in canonical_system.get("instances", [])):
                add(2, "invalid_hierarchy", "Choose the canonical top-level system root.", "root_instance_id")
            context = architecture_context(canonical_system, binding)
            findings.extend(architecture_findings(canonical_system, context))
            _canonical_projection(study, canonical_system, context, findings)
    else:
        local = _local_architecture(analysis)
        context = architecture_context(local, {"scope_instance_id": local["root_instance_id"]})
        # Process models may have several roots; every process element is studied.
        context["scope"] = set(context["instances"])
        context["required"] = set(context["functions"])
        context["context_instances"] = set(context["instances"])
        context["interfaces"] = local["interfaces"]
        findings.extend(architecture_findings(local, context))
        old = []
        core._validate_structure(analysis, old)
        for finding in old:
            findings.append({**finding, "path": finding.get("field", "structure_nodes"), "record_type": "structure"})
        for node in analysis.get("structure_nodes", []):
            ref = node.get("system_definition_ref")
            if ref and (not canonical_system or ref.get("system_model_id") != canonical_system.get("id") or not any(i["id"] == ref.get("instance_id") for i in canonical_system.get("instances", []))):
                add(2, "missing_equipment_reference", "Repair the linked physical equipment reference.", f"structure_nodes.{node['id']}.system_definition_ref", node["id"], "structure")
    if not analysis.get("structure_nodes"):
        add(2, "missing_structure", "Define the study's system or process structure.", "structure_nodes")
    chains = analysis.get("failure_chains", [])
    covered_functions = {chain.get("function_id") for chain in chains if str(chain.get("failure_mode") or "").strip()}
    for fn in analysis.get("functions", []):
        ref = fn.get("system_definition_ref") or {}
        if physical and context and ref.get("instance_id") not in context["scope"]:
            continue
        if fn["id"] not in covered_functions:
            add(4, "missing_failure_coverage", "Identify the failure modes of this studied function.", f"functions.{fn['id']}", fn["id"], "function")
    function_ids = {fn["id"] for fn in analysis.get("functions", [])}
    structure_ids = {node["id"] for node in analysis.get("structure_nodes", [])}
    for chain in chains:
        if chain.get("function_id") not in function_ids or not all(str(chain.get(field) or "").strip() for field in ("failure_mode", "cause", "effect")):
            add(4, "incomplete_failure_chain", "Link the failure mode to a studied function and define its traceable cause and effect.", f"failure_chains.{chain['id']}", chain["id"], "failure_chain")
        if not chain.get("cause_function_id") and chain.get("cause_structure_node_id") not in structure_ids:
            add(4, "missing_cause_traceability", "Link the cause to its source function or installed/process element.", f"failure_chains.{chain['id']}.cause_structure_node_id", chain["id"], "failure_chain")
        if not chain.get("effect_function_id") and not any(str(effect.get("context") or "").strip() and str(effect.get("description") or "").strip() for effect in chain.get("effect_contexts", [])):
            add(4, "missing_effect_traceability", "Link the effect to its affected function or define a structured stakeholder/system effect context.", f"failure_chains.{chain['id']}.effect_contexts", chain["id"], "failure_chain")
        if chain.get("cause_structure_node_id") and chain["cause_structure_node_id"] not in structure_ids:
            add(4, "unknown_cause_structure", "Select an existing cause element.", f"failure_chains.{chain['id']}.cause_structure_node_id", chain["id"], "failure_chain")
        for field in ("cause_function_id", "effect_function_id"):
            if chain.get(field) and chain[field] not in function_ids:
                add(4, "unknown_failure_function", "Select an existing function for this failure chain.", f"failure_chains.{chain['id']}.{field}", chain["id"], "failure_chain")
        old = []
        try:
            core._evaluate_chain(analysis.get("kind"), chain, old)
        except ValueError as exc:
            add(5, "invalid_rating", str(exc), f"failure_chains.{chain['id']}.ratings", chain["id"], "failure_chain")
        for finding in old:
            # Controlled studies require an explicit assessment basis; an in-range
            # default rating is not evidence that risk assessment is complete.
            if finding["code"] == "missing_rating_rationale":
                finding = {**finding, "severity": "error"}
            findings.append({**finding, "path": f"failure_chains.{chain['id']}.{finding.get('field', '')}", "record_type": "failure_chain"})
    profiles = {p["id"]: p for p in core.builtin_rating_profiles()}
    for profile in rating_profiles:
        if profile.get("id") in profiles:
            add(5, "reserved_rating_profile", "Built-in rating profiles cannot be replaced.", "rating_profile_id")
        else:
            try:
                core._validate_custom_profile(profile)
                if profile.get("approved") and (not str(profile.get("approved_by") or "").strip() or not str(profile.get("approved_date") or "").strip()):
                    raise ValueError("Approved rating profiles require an approver and approval date.")
                expected = profile.get("checksum")
                raw = {k: v for k, v in profile.items() if k != "checksum"}
                if expected and expected != core._canonical_checksum(raw):
                    raise ValueError("Rating profile checksum differs from its contents.")
                profiles[profile["id"]] = profile
            except (ValueError, KeyError) as exc:
                add(5, "invalid_rating_profile", str(exc), "rating_profile_id")
    profile_id = analysis.get("rating_profile_id") or {"dfmea": "aiag_vda_dfmea_public_v1", "pfmea": "aiag_vda_pfmea_public_v1", "fmea_msr": "aiag_vda_msr_public_v1"}.get(analysis.get("kind"))
    profile = profiles.get(profile_id)
    if not profile or profile.get("kind") != analysis.get("kind") or not profile.get("approved"):
        add(5, "invalid_rating_profile", "Select an approved rating profile for this analysis kind.", "rating_profile_id")
    link_findings = []
    core._validate_links(analysis, link_findings)
    core._control_plan_issues(analysis, {chain["id"] for chain in chains}, link_findings)
    for finding in link_findings:
        findings.append({**finding, "record_type": "analysis", "path": finding.get("field", "")})
    for finding in [*validate_governance(study), *validate_evidence(study), *validate_flowdown(study), *validate_failure_flow(study)["findings"]]:
        findings.append({**finding, "step": 7, "record_type": "governance", "path": finding.get("field", finding.get("code", ""))})
    for finding in study.get("review_findings", []):
        if finding.get("severity") in ("error", "critical") and finding.get("status") != "closed":
            add(7, "open_review_blockers", "Resolve this blocking review finding.", f"review_findings.{finding['id']}", finding["id"], "review_finding")
    unique = {(f["step"], f["code"], f.get("record_id"), f.get("path")): f for f in findings}
    findings = sorted(unique.values(), key=lambda f: (f["step"], f["code"], str(f.get("record_id") or ""), str(f.get("path") or "")))
    semantic_study = deepcopy(dict(study))
    semantic_study.get("model", {}).pop("block_diagram", None)
    for edge in semantic_study.get("model", {}).get("interfaces", []):
        for field in ("source_handle", "target_handle", "source_block_id", "target_block_id"):
            edge.pop(field, None)
    for field in ("saved_views", "revisions", "releases", "lifecycle_history"):
        semantic_study.pop(field, None)
    stages = [{"step": step, "eligible": not any(f["step"] < step and f["severity"] == "error" for f in findings), "complete": not any(f["step"] == step and f["severity"] == "error" for f in findings), "findings": [f for f in findings if f["step"] == step]} for step in range(1, 8)]
    return {"semantic_fingerprint": _hash({"study": semantic_study, "architecture": context["semantic"] if context else None, "rating_profiles": list(rating_profiles), "program_requirements": list(program_requirements)}), "stages": stages, "findings": findings, "can_analyze": not any(f["step"] <= 5 and f["severity"] == "error" for f in findings), "can_release": not any(f["severity"] == "error" for f in findings)}


class FMEAPrerequisiteError(ValueError):
    def __init__(self, readiness):
        self.readiness = readiness
        super().__init__("FMEA prerequisites are incomplete. " + "; ".join(f["message"] for f in readiness["findings"] if f["severity"] == "error")[:2000])


def require_fmea_readiness(study, canonical_system=None, *, through_step=5, rating_profiles=(), program_requirements=()):
    readiness = evaluate_fmea_readiness(study, canonical_system, rating_profiles=rating_profiles, program_requirements=program_requirements)
    if any(f["step"] <= through_step and f["severity"] == "error" for f in readiness["findings"]):
        raise FMEAPrerequisiteError(readiness)
    if study.get("model", {}).get("kind") == "pfmea":
        return deepcopy(dict(study))
    return _canonical_projection(study, canonical_system, architecture_context(canonical_system, study["model"]["system_binding"]), [])
