"""Validation and deterministic qualitative propagation for system models."""

from __future__ import annotations

from collections import defaultdict, deque
from copy import deepcopy
from dataclasses import dataclass
from hashlib import sha256
import json
from typing import Any, Iterable, Mapping


PROFILE_ADAPTERS: tuple[dict[str, Any], ...] = (
    {
        "id": "prediction.mil-hdbk-217f", "domain": "prediction",
        "name": "MIL-HDBK-217F", "version": 1,
        "required": ["category"],
    },
    {
        "id": "prediction.telcordia-sr332", "domain": "prediction",
        "name": "Telcordia SR-332", "version": 1,
        "required": ["category"],
    },
    {
        "id": "prediction.217plus", "domain": "prediction",
        "name": "217Plus", "version": 1, "required": ["category"],
    },
    {
        "id": "prediction.fides", "domain": "prediction",
        "name": "FIDES", "version": 1, "required": ["category"],
    },
    {
        "id": "prediction.nswc-98-le1", "domain": "prediction",
        "name": "NSWC-98/LE1", "version": 1, "required": ["category"],
    },
    {
        "id": "reliability.constant-hazard", "domain": "reliability",
        "name": "Constant hazard", "version": 1,
        "required": ["failure_rate"],
    },
    {
        "id": "reliability.distribution", "domain": "reliability",
        "name": "Lifetime distribution", "version": 1,
        "required": ["distribution"],
    },
    {
        "id": "reliability.analysis-reference", "domain": "reliability",
        "name": "Analysis reference", "version": 1,
        "required": ["analysis_id"],
    },
    {
        "id": "custom", "domain": "custom", "name": "Custom",
        "version": 1, "required": [],
    },
)

_ADAPTER_BY_ID = {item["id"]: item for item in PROFILE_ADAPTERS}

_DISTRIBUTION_PARAMETERS: dict[str, tuple[str, ...]] = {
    "exponential": ("lambda",),
    "weibull": ("alpha", "beta"),
    "normal": ("mu", "sigma"),
    "lognormal": ("mu", "sigma"),
    "gamma": ("alpha", "beta"),
    "loglogistic": ("alpha", "beta"),
    "gumbel": ("mu", "sigma"),
    "beta": ("alpha", "beta"),
}

_FAILURE_RATE_PER_HOUR_FACTORS = {
    "failures/hour": 1.0, "failure/hour": 1.0, "1/hour": 1.0,
    "/hour": 1.0, "h^-1": 1.0,
    "fpmh": 1e-6, "failures/million hours": 1e-6,
    "fit": 1e-9, "failures/billion hours": 1e-9,
}


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _hash(prefix: str, value: Any) -> str:
    return f"{prefix}-{sha256(_canonical(value).encode()).hexdigest()[:20]}"


def _checksum(value: Any) -> str:
    return sha256(_canonical(value).encode()).hexdigest()


def profile_adapters() -> dict[str, Any]:
    """Return the portable adapter registry used by editors and projections."""
    return {"version": 1, "adapters": list(PROFILE_ADAPTERS)}


def _value_is_missing(value: Any) -> bool:
    value = _parameter_value(value)
    return value is None or (isinstance(value, str) and not value.strip())


def _profile_value_issues(
    adapter_id: str, values: Mapping[str, Any], *, path: str = "",
) -> list[dict[str, Any]]:
    """Validate adapter-owned values without leaking module defaults into the model."""
    adapter = _ADAPTER_BY_ID.get(adapter_id, {})
    missing = [key for key in adapter.get("required", ())
               if key not in values or _value_is_missing(values[key])]
    resolved = {key: _parameter_value(value) for key, value in values.items()}
    if adapter_id == "reliability.distribution":
        distribution = str(resolved.get("distribution", "")).lower()
        if distribution and distribution not in _DISTRIBUTION_PARAMETERS:
            return [{
                "severity": "error", "code": "unsupported_profile_distribution",
                "path": path,
                "message": f"Reliability distribution '{distribution}' is not supported.",
            }]
        missing.extend(key for key in _DISTRIBUTION_PARAMETERS.get(distribution, ())
                       if key not in values or _value_is_missing(values[key]))
    issues: list[dict[str, Any]] = []
    if missing:
        issues.append({
            "severity": "error", "code": "incomplete_profile",
            "path": path,
            "message": "Profile is missing: " + ", ".join(dict.fromkeys(missing)) + ".",
        })
    if adapter_id == "reliability.constant-hazard" and "failure_rate" in resolved:
        rate = resolved["failure_rate"]
        if not isinstance(rate, (int, float)) or isinstance(rate, bool) or rate < 0:
            issues.append({
                "severity": "error", "code": "invalid_failure_rate",
                "path": path,
                "message": "Constant-hazard failure_rate must be a non-negative number.",
            })
        typed_rate = values.get("failure_rate")
        unit = str(typed_rate.get("unit", "")).strip().lower() \
            if isinstance(typed_rate, Mapping) else ""
        if unit not in _FAILURE_RATE_PER_HOUR_FACTORS:
            issues.append({
                "severity": "error", "code": "unsupported_failure_rate_unit",
                "path": path,
                "message": "failure_rate unit must be failures/hour, FPMH, or FIT.",
            })
    if adapter_id == "reliability.distribution":
        distribution = str(resolved.get("distribution", "")).lower()
        for key in _DISTRIBUTION_PARAMETERS.get(distribution, ()):
            value = resolved.get(key)
            if (not isinstance(value, (int, float)) or isinstance(value, bool)
                    or value <= 0):
                issues.append({
                    "severity": "error", "code": "invalid_distribution_parameter",
                    "path": path,
                    "message": f"Distribution parameter '{key}' must be a positive number.",
                })
    return issues


def upgrade_system_definition(model: Mapping[str, Any]) -> dict[str, Any]:
    """Upgrade v1 JSON to v2 without changing stable IDs or authored content."""
    upgraded = deepcopy(dict(model))
    upgraded["version"] = 2
    upgraded.setdefault("propagation_assertions", [])
    for definition in upgraded.get("definitions", ()):
        classification = str(definition.get("classification", "component")).lower()
        inferred = (
            "piece_part" if classification in {"part", "piece part", "piece_part"}
            else "system" if classification == "system"
            else "subsystem" if classification == "subsystem"
            else "assembly" if classification == "assembly"
            else "component"
        )
        definition.setdefault("kind", inferred)
        definition.setdefault("revision", upgraded.get("revision", "A"))
        definition.setdefault("properties", {})
        definition.setdefault("analysis_profiles", [])
        for port in definition.get("ports", ()):
            port.setdefault("properties", {})
        for function in definition.get("functions", ()):
            function.setdefault("port_ids", [])
    for instance in upgraded.get("instances", ()):
        instance.setdefault("origin", "ad_hoc")
        instance.setdefault("definition_revision", "")
        instance.setdefault("properties", {})
        instance.setdefault("profile_overrides", [])
    for external in upgraded.get("externals", ()):
        external.setdefault("ports", [])
    for interface in upgraded.get("interfaces", ()):
        interface.setdefault("strength", "unknown")
        interface.setdefault("nature", "unknown")
        interface.setdefault("properties", {})
    for diagram in upgraded.get("diagrams", ()):
        diagram.setdefault("density", "standard")
        diagram.setdefault("boundary", {
            "label": "System Boundary", "x": -40, "y": -40,
            "width": 1200, "height": 700,
        })
        diagram.setdefault("viewport", {"x": 0, "y": 0, "zoom": 1})
        diagram.setdefault("snap_to_grid", True)
        diagram.setdefault("mode_ids", [])
    return upgraded


@dataclass(frozen=True)
class SystemGraphIndex:
    """Indexed view of the portable graph; intentionally storage-agnostic."""

    definitions: dict[str, Mapping[str, Any]]
    instances: dict[str, Mapping[str, Any]]
    children: dict[str | None, list[Mapping[str, Any]]]
    interfaces: dict[str, Mapping[str, Any]]
    functions: dict[str, Mapping[str, Any]]
    failures: dict[str, Mapping[str, Any]]

    @classmethod
    def build(cls, model: Mapping[str, Any]) -> "SystemGraphIndex":
        definitions = {item["id"]: item for item in model.get("definitions", ())}
        instances = {item["id"]: item for item in model.get("instances", ())}
        children: dict[str | None, list[Mapping[str, Any]]] = defaultdict(list)
        functions: dict[str, Mapping[str, Any]] = {}
        failures: dict[str, Mapping[str, Any]] = {}
        for instance in instances.values():
            children[instance.get("parent_instance_id")].append(instance)
            definition = definitions.get(instance.get("definition_id"), {})
            for function in definition.get("functions", ()):
                functions[f"{instance['id']}::{function['id']}"] = function
            for failure in definition.get("failure_modes", ()):
                failures[f"{instance['id']}::{failure['id']}"] = failure
        for values in children.values():
            values.sort(key=lambda value: (value.get("name", ""), value["id"]))
        return cls(
            definitions=definitions, instances=instances, children=dict(children),
            interfaces={item["id"]: item for item in model.get("interfaces", ())},
            functions=functions, failures=failures,
        )


def _ref_key(ref: Mapping[str, Any]) -> str:
    return f"{ref.get('instance_id', '')}::{ref.get('function_id', '')}"


def _applies(mode_ids: Iterable[str] | None, mode_id: str | None) -> bool:
    values = set(mode_ids or ())
    return not mode_id or not values or mode_id in values


def _unique_issues(items: list[Mapping[str, Any]], collection: str) -> list[dict[str, Any]]:
    seen: set[str] = set()
    issues: list[dict[str, Any]] = []
    for index, item in enumerate(items):
        item_id = str(item.get("id", ""))
        if item_id in seen:
            issues.append({
                "severity": "error", "code": "duplicate_id",
                "path": f"{collection}.{index}.id",
                "message": f"Duplicate {collection} ID '{item_id}'.",
            })
        seen.add(item_id)
    return issues


def validate_system_definition(model: Mapping[str, Any]) -> dict[str, Any]:
    """Return field-addressable issues without mutating the submitted model."""
    model = upgrade_system_definition(model)
    issues: list[dict[str, Any]] = []
    collections = [
        "modes", "definitions", "instances", "externals", "interfaces",
        "function_links", "propagation_rules", "propagation_assertions", "diagrams",
    ]
    for name in collections:
        issues.extend(_unique_issues(list(model.get(name, ())), name))

    modes = {item["id"] for item in model.get("modes", ())}
    definitions = {item["id"]: item for item in model.get("definitions", ())}
    instances = {item["id"]: item for item in model.get("instances", ())}
    external_items = {item["id"]: item for item in model.get("externals", ())}
    externals = set(external_items)
    interfaces = {item["id"] for item in model.get("interfaces", ())}

    function_ids: dict[str, set[str]] = {}
    failure_ids: dict[str, set[str]] = {}
    port_ids: dict[str, set[str]] = {}
    definition_graph: dict[str, list[str]] = defaultdict(list)

    def validate_mode_ids(item: Mapping[str, Any], path: str) -> None:
        for mode in item.get("mode_ids", ()) or ():
            if mode not in modes:
                issues.append({
                    "severity": "error", "code": "missing_mode",
                    "path": f"{path}.mode_ids",
                    "message": f"Operating mode '{mode}' does not exist.",
                })

    for definition_id, definition in definitions.items():
        ports = list(definition.get("ports", ()))
        functions = list(definition.get("functions", ()))
        failures = list(definition.get("failure_modes", ()))
        issues.extend(_unique_issues(ports, f"definitions.{definition_id}.ports"))
        issues.extend(_unique_issues(functions, f"definitions.{definition_id}.functions"))
        issues.extend(_unique_issues(failures, f"definitions.{definition_id}.failure_modes"))
        profiles = list(definition.get("analysis_profiles", ()))
        issues.extend(_unique_issues(
            profiles, f"definitions.{definition_id}.analysis_profiles"))
        port_ids[definition_id] = {item["id"] for item in ports}
        function_ids[definition_id] = {item["id"] for item in functions}
        failure_ids[definition_id] = {item["id"] for item in failures}
        for function in functions:
            validate_mode_ids(
                function, f"definitions.{definition_id}.functions.{function.get('id')}")
            for port_id in function.get("port_ids", ()):
                if port_id not in port_ids[definition_id]:
                    issues.append({
                        "severity": "error", "code": "missing_function_port",
                        "path": f"definitions.{definition_id}.functions.{function.get('id')}.port_ids",
                        "message": f"Allocated port '{port_id}' does not exist.",
                    })
        for failure in failures:
            validate_mode_ids(
                failure, f"definitions.{definition_id}.failure_modes.{failure.get('id')}")
            if failure.get("function_id") not in function_ids[definition_id]:
                issues.append({
                    "severity": "error", "code": "missing_failure_function",
                    "path": f"definitions.{definition_id}.failure_modes.{failure.get('id')}",
                    "message": "Failure mode references a missing function.",
                })
        slots = list(definition.get("child_slots", ()))
        issues.extend(_unique_issues(slots, f"definitions.{definition_id}.child_slots"))
        for slot in slots:
            child = slot.get("definition_id")
            if child not in definitions:
                issues.append({
                    "severity": "error", "code": "missing_child_definition",
                    "path": f"definitions.{definition_id}.child_slots.{slot.get('id')}",
                    "message": f"Child definition '{child}' does not exist.",
                })
            else:
                definition_graph[definition_id].append(child)
        for profile in profiles:
            path = f"definitions.{definition_id}.analysis_profiles.{profile.get('id')}"
            validate_mode_ids(profile, path)
            adapter = _ADAPTER_BY_ID.get(str(profile.get("adapter_id", "")))
            if not adapter:
                issues.append({
                    "severity": "error", "code": "unknown_profile_adapter",
                    "path": f"{path}.adapter_id",
                    "message": f"Profile adapter '{profile.get('adapter_id')}' is not registered.",
                })
            elif adapter["domain"] not in {"custom", profile.get("domain")}:
                issues.append({
                    "severity": "error", "code": "profile_domain_mismatch",
                    "path": f"{path}.domain",
                    "message": "Profile domain does not match its adapter.",
                })
            elif profile.get("status") == "reviewed":
                for issue in _profile_value_issues(
                        str(profile.get("adapter_id", "")),
                        profile.get("values", {}), path=f"{path}.values"):
                    issues.append({
                        **issue,
                        "code": "incomplete_reviewed_profile"
                        if issue["code"] == "incomplete_profile" else issue["code"],
                    })

    def find_cycles(graph: Mapping[str, list[str]], code: str, label: str) -> None:
        visiting: set[str] = set()
        visited: set[str] = set()

        def visit(node: str, trail: list[str]) -> None:
            if node in visiting:
                start = trail.index(node) if node in trail else 0
                cycle = trail[start:] + [node]
                issues.append({
                    "severity": "error", "code": code, "path": label,
                    "message": f"{label} cycle: {' -> '.join(cycle)}.",
                })
                return
            if node in visited:
                return
            visiting.add(node)
            for child in graph.get(node, ()):
                visit(child, trail + [node])
            visiting.remove(node)
            visited.add(node)

        for node in graph:
            visit(node, [])

    find_cycles(definition_graph, "definition_composition_cycle", "Definition composition")

    parent_graph: dict[str, list[str]] = defaultdict(list)
    for instance_id, instance in instances.items():
        definition_id = instance.get("definition_id")
        if definition_id not in definitions:
            issues.append({
                "severity": "error", "code": "missing_instance_definition",
                "path": f"instances.{instance_id}.definition_id",
                "message": f"Definition '{definition_id}' does not exist.",
            })
        parent = instance.get("parent_instance_id")
        if parent:
            if parent not in instances:
                issues.append({
                    "severity": "error", "code": "missing_parent_instance",
                    "path": f"instances.{instance_id}.parent_instance_id",
                    "message": f"Parent instance '{parent}' does not exist.",
                })
            else:
                parent_graph[parent].append(instance_id)
        validate_mode_ids(instance, f"instances.{instance_id}")
        if definition_id in definitions:
            profile_ids = {
                profile["id"] for profile in
                definitions[definition_id].get("analysis_profiles", ())
            }
            for override in instance.get("function_overrides", ()):
                if override.get("function_id") not in function_ids[definition_id]:
                    issues.append({
                        "severity": "error", "code": "missing_override_function",
                        "path": f"instances.{instance_id}.function_overrides",
                        "message": "Function override references a missing inherited function.",
                    })
                if override.get("mode_ids") is not None:
                    validate_mode_ids(override, f"instances.{instance_id}.function_overrides")
            for override in instance.get("failure_mode_overrides", ()):
                if override.get("failure_mode_id") not in failure_ids[definition_id]:
                    issues.append({
                        "severity": "error", "code": "missing_override_failure_mode",
                        "path": f"instances.{instance_id}.failure_mode_overrides",
                        "message": "Failure-mode override references a missing inherited failure mode.",
                    })
                if override.get("mode_ids") is not None:
                    validate_mode_ids(override, f"instances.{instance_id}.failure_mode_overrides")
            for override in instance.get("profile_overrides", ()):
                if override.get("profile_id") not in profile_ids:
                    issues.append({
                        "severity": "error", "code": "missing_override_profile",
                        "path": f"instances.{instance_id}.profile_overrides",
                        "message": "Profile override references a missing inherited profile.",
                    })
    find_cycles(parent_graph, "instance_hierarchy_cycle", "Instance hierarchy")

    def validate_function_ref(ref: Mapping[str, Any], path: str) -> None:
        instance = instances.get(str(ref.get("instance_id", "")))
        if not instance:
            issues.append({
                "severity": "error", "code": "missing_function_instance",
                "path": path, "message": "Function reference has no matching instance.",
            })
            return
        definition_id = instance.get("definition_id")
        if ref.get("function_id") not in function_ids.get(definition_id, set()):
            issues.append({
                "severity": "error", "code": "missing_function",
                "path": path, "message": "Function reference has no inherited function.",
            })

    def validate_endpoint(endpoint: Mapping[str, Any], path: str) -> None:
        instance_id = endpoint.get("instance_id")
        if instance_id:
            instance = instances.get(instance_id)
            if not instance:
                issues.append({
                    "severity": "error", "code": "missing_endpoint_instance",
                    "path": path, "message": f"Endpoint instance '{instance_id}' does not exist.",
                })
                return
            definition_id = instance.get("definition_id")
            if endpoint.get("port_id") not in port_ids.get(definition_id, set()):
                issues.append({
                    "severity": "error", "code": "missing_endpoint_port",
                    "path": path, "message": "Endpoint port does not exist on the instance definition.",
                })
        elif endpoint.get("external_id") not in externals:
            issues.append({
                "severity": "error", "code": "missing_external_endpoint",
                "path": path, "message": "External endpoint does not exist.",
            })
        elif endpoint.get("port_id"):
            external = external_items.get(endpoint.get("external_id"), {})
            if endpoint.get("port_id") not in {
                    port.get("id") for port in external.get("ports", ())}:
                issues.append({
                    "severity": "error", "code": "missing_external_port",
                    "path": path, "message": "Endpoint port does not exist on the external actor.",
                })

    for item in model.get("interfaces", ()):
        item_id = item.get("id")
        validate_mode_ids(item, f"interfaces.{item_id}")
        validate_endpoint(item.get("source", {}), f"interfaces.{item_id}.source")
        validate_endpoint(item.get("target", {}), f"interfaces.{item_id}.target")
        endpoint_ports: list[Mapping[str, Any] | None] = []
        for endpoint in (item.get("source", {}), item.get("target", {})):
            if endpoint.get("instance_id") in instances:
                definition_id = instances[endpoint["instance_id"]].get("definition_id")
                endpoint_ports.append(next((port for port in definitions.get(
                    definition_id, {}).get("ports", ())
                    if port.get("id") == endpoint.get("port_id")), None))
            else:
                endpoint_ports.append(next((port for port in external_items.get(
                    endpoint.get("external_id"), {}).get("ports", ())
                    if port.get("id") == endpoint.get("port_id")), None))
        typed_ports = [port for port in endpoint_ports if port]
        if any(port.get("interface_type") != item.get("interface_type")
               for port in typed_ports):
            issues.append({
                "severity": "warning", "code": "interface_port_type_mismatch",
                "path": f"interfaces.{item_id}.interface_type",
                "message": "Interface type differs from one or more connected ports.",
            })
        if len(typed_ports) == 2 and typed_ports[0].get("direction") == "input" \
                and item.get("directionality") == "directed":
            issues.append({
                "severity": "warning", "code": "interface_direction_mismatch",
                "path": f"interfaces.{item_id}.source",
                "message": "A directed interface starts at an input-only port.",
            })
        source_instance = item.get("source", {}).get("instance_id")
        target_instance = item.get("target", {}).get("instance_id")
        for function_id in item.get("source_function_ids", ()):
            validate_function_ref(
                {"instance_id": source_instance, "function_id": function_id},
                f"interfaces.{item_id}.source_function_ids",
            )
        for function_id in item.get("target_function_ids", ()):
            validate_function_ref(
                {"instance_id": target_instance, "function_id": function_id},
                f"interfaces.{item_id}.target_function_ids",
            )
        if source_instance and target_instance and (
                not item.get("source_function_ids")
                or not item.get("target_function_ids")):
            issues.append({
                "severity": "warning", "code": "unmapped_interface_functions",
                "path": f"interfaces.{item_id}",
                "message": "Interface needs source and target function mappings for propagation.",
            })

    function_graph: dict[str, list[str]] = defaultdict(list)
    for item in model.get("function_links", ()):
        validate_mode_ids(item, f"function_links.{item.get('id')}")
        validate_function_ref(item.get("source", {}), f"function_links.{item.get('id')}.source")
        validate_function_ref(item.get("target", {}), f"function_links.{item.get('id')}.target")
        function_graph[_ref_key(item.get("source", {}))].append(
            _ref_key(item.get("target", {})))

    for rule in model.get("propagation_rules", ()):
        validate_mode_ids(rule, f"propagation_rules.{rule.get('id')}")
        if rule.get("interface_id") and rule.get("interface_id") not in interfaces:
            issues.append({
                "severity": "error", "code": "missing_rule_interface",
                "path": f"propagation_rules.{rule.get('id')}.interface_id",
                "message": "Propagation rule references a missing interface.",
            })
        if rule.get("source"):
            validate_function_ref(rule["source"], f"propagation_rules.{rule.get('id')}.source")
        if rule.get("target"):
            validate_function_ref(rule["target"], f"propagation_rules.{rule.get('id')}.target")

    for assertion in model.get("propagation_assertions", ()):
        validate_mode_ids(
            assertion, f"propagation_assertions.{assertion.get('id')}")
        if assertion.get("transition_id") not in interfaces and not any(
                link.get("id") == assertion.get("transition_id")
                for link in model.get("function_links", ())):
            issues.append({
                "severity": "error", "code": "missing_assertion_transition",
                "path": f"propagation_assertions.{assertion.get('id')}.transition_id",
                "message": "Accepted propagation references a missing transition.",
            })

    for diagram in model.get("diagrams", ()):
        validate_mode_ids(diagram, f"diagrams.{diagram.get('id')}")
        if diagram.get("scope_instance_id") and diagram["scope_instance_id"] not in instances:
            issues.append({
                "severity": "error", "code": "missing_diagram_scope",
                "path": f"diagrams.{diagram.get('id')}.scope_instance_id",
                "message": "Diagram scope references a missing instance.",
            })
        seen_subjects: set[str] = set()
        for node in diagram.get("nodes", ()):
            subject = node.get("instance_id") or node.get("external_id") or ""
            if subject in seen_subjects:
                issues.append({
                    "severity": "warning", "code": "duplicate_diagram_subject",
                    "path": f"diagrams.{diagram.get('id')}.nodes",
                    "message": f"Diagram contains duplicate node '{subject}'.",
                })
            seen_subjects.add(subject)
            if node.get("instance_id") and node["instance_id"] not in instances:
                issues.append({
                    "severity": "error", "code": "missing_diagram_instance",
                    "path": f"diagrams.{diagram.get('id')}.nodes",
                    "message": "Diagram node references a missing instance.",
                })
            if node.get("external_id") and node["external_id"] not in externals:
                issues.append({
                    "severity": "error", "code": "missing_diagram_external",
                    "path": f"diagrams.{diagram.get('id')}.nodes",
                    "message": "Diagram node references a missing external actor.",
                })

    return {
        "valid": not any(item["severity"] == "error" for item in issues),
        "issues": issues,
        "summary": {
            "definitions": len(definitions), "instances": len(instances),
            "interfaces": len(interfaces),
            "functions": sum(len(values) for values in function_ids.values()),
            "failure_modes": sum(len(values) for values in failure_ids.values()),
            "analysis_profiles": sum(
                len(item.get("analysis_profiles", ())) for item in definitions.values()),
            "accepted_propagations": sum(
                item.get("status") == "accepted"
                for item in model.get("propagation_assertions", ())),
        },
    }


def _resolved_model(model: Mapping[str, Any], mode_id: str | None) -> dict[str, Any]:
    model = upgrade_system_definition(model)
    definitions = {item["id"]: item for item in model.get("definitions", ())}
    functions: dict[str, dict[str, Any]] = {}
    failures: list[dict[str, Any]] = []
    instances = {item["id"]: item for item in model.get("instances", ())}
    for instance_id, instance in instances.items():
        if not _applies(instance.get("mode_ids"), mode_id):
            continue
        definition = definitions.get(instance.get("definition_id"), {})
        function_overrides = {
            item["function_id"]: item for item in instance.get("function_overrides", ())
        }
        for function in definition.get("functions", ()):
            override = function_overrides.get(function["id"], {})
            if override.get("enabled", True) is False:
                continue
            modes = override.get("mode_ids")
            modes = function.get("mode_ids", ()) if modes is None else modes
            if not _applies(modes, mode_id):
                continue
            key = f"{instance_id}::{function['id']}"
            functions[key] = {
                **function,
                "description": override.get("description") or function["description"],
                "instance_id": instance_id,
                "instance_name": instance.get("name") or definition.get("name", instance_id),
                "definition_id": definition.get("id"),
                "key": key,
                "mode_ids": list(modes or ()),
            }
        failure_overrides = {
            item["failure_mode_id"]: item
            for item in instance.get("failure_mode_overrides", ())
        }
        for failure in definition.get("failure_modes", ()):
            override = failure_overrides.get(failure["id"], {})
            if override.get("enabled", True) is False:
                continue
            modes = override.get("mode_ids")
            modes = failure.get("mode_ids", ()) if modes is None else modes
            function_key = f"{instance_id}::{failure['function_id']}"
            if function_key not in functions or not _applies(modes, mode_id):
                continue
            failures.append({
                **failure,
                "id": f"{instance_id}::{failure['id']}",
                "template_failure_mode_id": failure["id"],
                "function_key": function_key,
                "instance_id": instance_id,
                "description": override.get("description") or failure["description"],
                "deviation_id": override.get("deviation_id") or failure["deviation_id"],
                "mode_ids": list(modes or ()),
            })
    return {"functions": functions, "failures": failures, "instances": instances}


def propagate_system_definition(
    model: Mapping[str, Any], *, mode_id: str | None = None,
    source_failure_mode_ids: Iterable[str] = (), max_paths: int = 10000,
    max_depth: int = 100,
) -> dict[str, Any]:
    model = upgrade_system_definition(model)
    validation = validate_system_definition(model)
    fingerprint_model = deepcopy(model)
    fingerprint_model.pop("propagation_assertions", None)
    fingerprint = sha256(_canonical({
        "model": fingerprint_model, "mode_id": mode_id,
        "source_failure_mode_ids": sorted(source_failure_mode_ids),
    }).encode()).hexdigest()
    if not validation["valid"]:
        return {
            "valid": False, "fingerprint": fingerprint,
            "issues": validation["issues"], "nodes": [], "edges": [],
            "paths": [], "proposals": [], "coverage": {},
        }

    resolved = _resolved_model(model, mode_id)
    functions: dict[str, dict[str, Any]] = resolved["functions"]
    requested = set(source_failure_mode_ids)
    sources = [item for item in resolved["failures"]
               if not requested
               or item["id"] in requested
               or item["template_failure_mode_id"] in requested]
    transitions: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for link in model.get("function_links", ()):
        if not _applies(link.get("mode_ids"), mode_id):
            continue
        source_key, target_key = _ref_key(link["source"]), _ref_key(link["target"])
        if source_key in functions and target_key in functions:
            transitions[source_key].append({
                "kind": "function_link", "id": link["id"],
                "source": source_key, "target": target_key,
                "relationship": link.get("relationship", "depends_on"),
            })

    for interface in model.get("interfaces", ()):
        if not _applies(interface.get("mode_ids"), mode_id):
            continue
        source_instance = interface.get("source", {}).get("instance_id")
        target_instance = interface.get("target", {}).get("instance_id")
        forward = [
            (f"{source_instance}::{source}", f"{target_instance}::{target}")
            for source in interface.get("source_function_ids", ())
            for target in interface.get("target_function_ids", ())
        ] if source_instance and target_instance else []
        pairs = list(forward)
        if interface.get("directionality") in {"bidirectional", "undirected"}:
            pairs.extend((target, source) for source, target in forward)
        for source_key, target_key in pairs:
            if source_key not in functions or target_key not in functions:
                continue
            transitions[source_key].append({
                "kind": "interface", "id": interface["id"],
                "source": source_key, "target": target_key,
                "interface_type": interface.get("interface_type"),
                "directionality": interface.get("directionality"),
                "flow_description": interface.get("flow_description", ""),
            })

    rules = [item for item in model.get("propagation_rules", ())
             if _applies(item.get("mode_ids"), mode_id)]
    assertions = [item for item in model.get("propagation_assertions", ())
                  if item.get("status") == "accepted"
                  and _applies(item.get("mode_ids"), mode_id)]

    def matching_rule(transition: Mapping[str, Any], deviation: str) -> Mapping[str, Any] | None:
        ranked: list[tuple[int, Mapping[str, Any]]] = []
        for rule in rules:
            if rule.get("interface_id") and (
                    transition.get("kind") != "interface"
                    or rule["interface_id"] != transition.get("id")):
                continue
            if rule.get("source") and _ref_key(rule["source"]) != transition["source"]:
                continue
            if rule.get("target") and _ref_key(rule["target"]) != transition["target"]:
                continue
            if rule.get("source_deviation_id") and rule["source_deviation_id"] != deviation:
                continue
            specificity = sum(bool(rule.get(key)) for key in (
                "interface_id", "source", "target", "source_deviation_id"))
            ranked.append((specificity, rule))
        return max(ranked, key=lambda value: value[0])[1] if ranked else None

    graph_nodes: dict[str, dict[str, Any]] = {}
    graph_edges: dict[str, dict[str, Any]] = {}
    proposals: dict[str, dict[str, Any]] = {}
    paths: list[dict[str, Any]] = []
    truncated = False

    for source in sources:
        initial_key = f"{source['function_key']}::{source['deviation_id']}"
        queue = deque([({
            "function_key": source["function_key"],
            "deviation_id": source["deviation_id"],
            "description": source["description"],
        }, [], {initial_key}, 0)])
        graph_nodes[initial_key] = {
            "id": initial_key, "kind": "failure_mode",
            "function": functions[source["function_key"]],
            "deviation_id": source["deviation_id"],
            "description": source["description"], "authored": True,
        }
        while queue:
            state, path_edges, visited, depth = queue.popleft()
            if depth >= max_depth:
                path_id = _hash("path", [source["id"], path_edges, "depth"])
                paths.append({
                    "id": path_id, "source_failure_mode_id": source["id"],
                    "edge_ids": path_edges, "terminated": True,
                    "termination": "maximum_depth",
                })
                truncated = True
                continue
            outgoing = transitions.get(state["function_key"], ())
            if not outgoing:
                path_id = _hash("path", [source["id"], path_edges])
                paths.append({
                    "id": path_id, "source_failure_mode_id": source["id"],
                    "edge_ids": path_edges, "terminated": True,
                    "termination": "no_downstream_mapping",
                })
                if len(paths) >= max_paths:
                    truncated = True
                    break
                continue
            advanced = False
            for transition in outgoing:
                rule = matching_rule(transition, state["deviation_id"])
                action = rule.get("action", "pass_through") if rule else "pass_through"
                proposal_basis = {
                    "fingerprint": fingerprint, "source": source["id"],
                    "transition": transition, "deviation": state["deviation_id"],
                    "rule": rule.get("id") if rule else None,
                }
                proposal_id = _hash("proposal", proposal_basis)
                if action in {"stop", "terminate"}:
                    proposals[proposal_id] = {
                        "id": proposal_id, "action": action,
                        "transition": transition, "rule_id": rule.get("id") if rule else None,
                        "source_failure_mode_id": source["id"],
                        "source_node_id": f"{state['function_key']}::{state['deviation_id']}",
                        "result_deviation_id": state["deviation_id"],
                        "explanation": rule.get("rationale") if rule else "Propagation terminates here.",
                    }
                    path_id = _hash("path", [source["id"], path_edges, proposal_id])
                    paths.append({
                        "id": path_id, "source_failure_mode_id": source["id"],
                        "edge_ids": path_edges, "terminated": True,
                        "termination": action, "proposal_id": proposal_id,
                    })
                    advanced = True
                    continue
                target_key = transition["target"]
                deviation = (rule.get("result_deviation_id") if rule else None) \
                    or state["deviation_id"]
                target_function = functions[target_key]
                description = (rule.get("result_description") if rule else "") \
                    or f"{target_function['description']} affected by {state['description']}"
                node_id = f"{target_key}::{deviation}"
                edge_id = _hash("edge", [proposal_id, state["function_key"], node_id])
                graph_nodes.setdefault(node_id, {
                    "id": node_id, "kind": "derived_failure_mode",
                    "function": target_function, "deviation_id": deviation,
                    "description": description, "authored": False,
                })
                graph_edges[edge_id] = {
                    "id": edge_id,
                    "source": f"{state['function_key']}::{state['deviation_id']}",
                    "target": node_id, "transition": transition,
                    "rule_id": rule.get("id") if rule else None,
                    "proposal_id": proposal_id,
                }
                proposals[proposal_id] = {
                    "id": proposal_id, "action": action,
                    "source_failure_mode_id": source["id"],
                    "source_node_id": graph_edges[edge_id]["source"],
                    "target_node_id": node_id, "edge_id": edge_id,
                    "result_deviation_id": deviation,
                    "transition": transition,
                    "rule_id": rule.get("id") if rule else None,
                    "explanation": (
                        rule.get("rationale") if rule and rule.get("rationale")
                        else f"Pass {state['deviation_id']} through {transition['kind'].replace('_', ' ')}."
                    ),
                    "review_required": True,
                }
                accepted = next((assertion for assertion in assertions
                    if assertion.get("source_failure_mode_id") in {
                        source["id"], source["template_failure_mode_id"]}
                    and assertion.get("source_node_id") == graph_edges[edge_id]["source"]
                    and assertion.get("target_node_id") == node_id
                    and assertion.get("transition_id") == transition.get("id")
                    and assertion.get("result_deviation_id") == deviation
                    and assertion.get("source_fingerprint") in {"", fingerprint}), None)
                if accepted:
                    proposals[proposal_id].update({
                        "review_required": False,
                        "accepted_assertion_id": accepted["id"],
                        "explanation": accepted.get("rationale")
                            or proposals[proposal_id]["explanation"],
                        "evidence_refs": accepted.get("evidence_refs", []),
                    })
                next_path = path_edges + [edge_id]
                if node_id in visited:
                    path_id = _hash("path", [source["id"], next_path, "cycle"])
                    paths.append({
                        "id": path_id, "source_failure_mode_id": source["id"],
                        "edge_ids": next_path, "terminated": True,
                        "termination": "cycle_collapsed",
                    })
                else:
                    queue.append(({
                        "function_key": target_key, "deviation_id": deviation,
                        "description": description,
                    }, next_path, visited | {node_id}, depth + 1))
                advanced = True
            if len(paths) >= max_paths:
                truncated = True
                break
            if not advanced:
                path_id = _hash("path", [source["id"], path_edges, "blocked"])
                paths.append({
                    "id": path_id, "source_failure_mode_id": source["id"],
                    "edge_ids": path_edges, "terminated": True,
                    "termination": "blocked",
                })
        if truncated:
            break

    mapped_functions = {edge["transition"]["source"] for edge in graph_edges.values()}
    coverage = {
        "source_failure_modes": len(sources),
        "functions_total": len(functions),
        "functions_with_downstream_mapping": len(mapped_functions),
        "unmapped_function_ids": sorted(set(functions) - set(transitions)),
        "interfaces_without_function_mapping": [
            item["id"] for item in model.get("interfaces", ())
            if item.get("source", {}).get("instance_id")
            and item.get("target", {}).get("instance_id")
            and (not item.get("source_function_ids")
                 or not item.get("target_function_ids"))
        ],
        "truncated": truncated,
        "reviewed_proposals": sum(
            not proposal.get("review_required", True)
            for proposal in proposals.values()),
        "unreviewed_proposals": sum(
            proposal.get("review_required", True)
            for proposal in proposals.values()),
    }
    return {
        "valid": True, "fingerprint": fingerprint,
        "issues": validation["issues"],
        "nodes": list(graph_nodes.values()), "edges": list(graph_edges.values()),
        "paths": paths, "proposals": list(proposals.values()),
        "coverage": coverage,
    }


def _parameter_value(value: Any) -> Any:
    """Unwrap a typed profile value for legacy analysis modules."""
    if isinstance(value, Mapping) and "value" in value:
        return value["value"]
    return value


def resolve_analysis_profile(
    model: Mapping[str, Any], instance_id: str, profile_id: str, *,
    mode_id: str | None = None,
    analysis_overrides: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Resolve definition → instance → analysis-local profile precedence."""
    model = upgrade_system_definition(model)
    validation = validate_system_definition(model)
    index = SystemGraphIndex.build(model)
    instance = index.instances.get(instance_id)
    if not instance:
        return {"valid": False, "issues": [{
            "severity": "error", "code": "missing_profile_instance",
            "message": f"Instance '{instance_id}' does not exist.",
        }]}
    definition = index.definitions.get(instance.get("definition_id"), {})
    profile = next((item for item in definition.get("analysis_profiles", ())
                    if item.get("id") == profile_id), None)
    if not profile:
        return {"valid": False, "issues": [{
            "severity": "error", "code": "missing_profile",
            "message": f"Profile '{profile_id}' is not defined by this block.",
        }]}
    if not _applies(profile.get("mode_ids"), mode_id):
        return {"valid": False, "issues": [{
            "severity": "error", "code": "profile_not_applicable",
            "message": "Profile is not applicable in the selected operating mode.",
        }]}
    instance_override = next((item for item in instance.get("profile_overrides", ())
                              if item.get("profile_id") == profile_id), {})
    if instance_override.get("disabled"):
        return {"valid": False, "disabled": True, "issues": [{
            "severity": "warning", "code": "profile_disabled",
            "message": "This inherited profile is disabled on the instance.",
        }]}
    values: dict[str, Any] = {}
    provenance: dict[str, str] = {}
    for source, payload in (
        ("definition", profile.get("values", {})),
        ("instance", instance_override.get("values", {})),
        ("analysis", analysis_overrides or {}),
    ):
        for key, value in payload.items():
            values[key] = deepcopy(value)
            provenance[key] = source
    profile_issues = _profile_value_issues(
        str(profile.get("adapter_id", "")), values,
        path=f"instances.{instance_id}.profiles.{profile_id}",
    )
    return {
        "valid": validation["valid"] and not profile_issues,
        "issues": [*validation["issues"], *profile_issues],
        "instance_id": instance_id, "definition_id": definition.get("id"),
        "profile": {
            **deepcopy(profile), "values": values,
            "resolved_values": {key: _parameter_value(value)
                                for key, value in values.items()},
        },
        "provenance": provenance,
        "precedence": ["definition", "instance", "analysis"],
    }


def plan_definition_composition(
    model: Mapping[str, Any], instance_id: str,
) -> dict[str, Any]:
    """Create a review-only plan for synchronizing reusable child slots."""
    model = upgrade_system_definition(model)
    validation = validate_system_definition(model)
    index = SystemGraphIndex.build(model)
    root = index.instances.get(instance_id)
    if not root:
        return {"valid": False, "issues": [{
            "severity": "error", "code": "missing_composition_instance",
            "message": f"Instance '{instance_id}' does not exist.",
        }], "proposals": []}
    referenced: set[str] = set()
    for interface in model.get("interfaces", ()):
        referenced.update(filter(None, (
            interface.get("source", {}).get("instance_id"),
            interface.get("target", {}).get("instance_id"),
        )))
    for link in model.get("function_links", ()):
        referenced.update((link["source"]["instance_id"], link["target"]["instance_id"]))
    proposals: list[dict[str, Any]] = []
    visited: set[str] = set()

    def visit(parent: Mapping[str, Any]) -> None:
        if parent["id"] in visited:
            return
        visited.add(parent["id"])
        definition = index.definitions.get(parent.get("definition_id"), {})
        slots = {slot["id"]: slot for slot in definition.get("child_slots", ())}
        children = list(index.children.get(parent["id"], ()))
        by_slot = {child.get("slot_id"): child for child in children if child.get("slot_id")}
        for slot_id, slot in slots.items():
            child = by_slot.get(slot_id)
            if not child:
                child_definition = index.definitions.get(slot.get("definition_id"), {})
                proposed_id = _hash("instance", [parent["id"], slot_id])
                proposals.append({
                    "id": _hash("composition", ["add", proposed_id]),
                    "action": "add", "review_required": True,
                    "parent_instance_id": parent["id"], "slot_id": slot_id,
                    "instance": {
                        "id": proposed_id, "definition_id": slot["definition_id"],
                        "parent_instance_id": parent["id"], "slot_id": slot_id,
                        "name": slot.get("name") or child_definition.get("name", ""),
                        "quantity": slot.get("quantity", 1),
                        "reference_designators": [], "mode_ids": [],
                        "function_overrides": [], "failure_mode_overrides": [],
                        "legacy_refs": [], "origin": "definition_slot",
                        "definition_revision": child_definition.get("revision", "A"),
                        "properties": {}, "profile_overrides": [],
                    },
                    "reason": "Reusable definition declares a child slot not installed here.",
                })
                continue
            changes: dict[str, Any] = {}
            if child.get("definition_id") != slot.get("definition_id"):
                changes["definition_id"] = slot["definition_id"]
            if child.get("quantity", 1) != slot.get("quantity", 1):
                changes["quantity"] = slot.get("quantity", 1)
            wanted_revision = index.definitions.get(
                slot.get("definition_id"), {}).get("revision", "A")
            if child.get("definition_revision") != wanted_revision:
                changes["definition_revision"] = wanted_revision
            if changes:
                proposals.append({
                    "id": _hash("composition", ["update", child["id"], changes]),
                    "action": "update", "review_required": True,
                    "instance_id": child["id"], "changes": changes,
                    "has_graph_references": child["id"] in referenced,
                    "reason": "Installed child differs from its reusable slot definition.",
                })
            visit(child)
        for child in children:
            if child.get("origin") == "definition_slot" and child.get("slot_id") not in slots:
                proposals.append({
                    "id": _hash("composition", ["remove", child["id"]]),
                    "action": "remove", "review_required": True,
                    "instance_id": child["id"],
                    "blocked": child["id"] in referenced
                        or bool(index.children.get(child["id"])),
                    "reason": "Installed child slot no longer exists in its reusable definition.",
                })

    visit(root)
    return {
        "valid": validation["valid"], "issues": validation["issues"],
        "instance_id": instance_id, "proposals": proposals,
        "summary": {
            "add": sum(item["action"] == "add" for item in proposals),
            "update": sum(item["action"] == "update" for item in proposals),
            "remove": sum(item["action"] == "remove" for item in proposals),
            "blocked": sum(bool(item.get("blocked")) for item in proposals),
        },
    }


def _scope_instances(
    index: SystemGraphIndex, scope_instance_id: str | None,
) -> list[Mapping[str, Any]]:
    if not scope_instance_id:
        return list(index.instances.values())
    values: list[Mapping[str, Any]] = []
    queue = deque([scope_instance_id])
    while queue:
        instance_id = queue.popleft()
        instance = index.instances.get(instance_id)
        if not instance:
            continue
        values.append(instance)
        queue.extend(child["id"] for child in index.children.get(instance_id, ()))
    return values


def _entity_checksums(
    model: Mapping[str, Any], instance_ids: set[str] | None = None,
) -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    for entity_type, collection in (
        ("definition", "definitions"), ("instance", "instances"),
        ("interface", "interfaces"),
        ("propagation_assertion", "propagation_assertions"),
    ):
        for item in model.get(collection, ()):
            if instance_ids is not None:
                used_definition_ids = {
                    instance.get("definition_id")
                    for instance in model.get("instances", ())
                    if instance.get("id") in instance_ids
                }
                if entity_type == "definition" and item["id"] not in used_definition_ids:
                    continue
                if entity_type == "instance" and item["id"] not in instance_ids:
                    continue
                if entity_type == "interface" and not any(
                    item.get(endpoint, {}).get("instance_id") in instance_ids
                    for endpoint in ("source", "target")
                ):
                    continue
            records.append({
                "entity_type": entity_type, "entity_id": item["id"],
                "checksum": _checksum(item),
            })
    definitions = {item["id"]: item for item in model.get("definitions", ())}
    used_definitions = None if instance_ids is None else {
        item.get("definition_id") for item in model.get("instances", ())
        if item.get("id") in instance_ids
    }
    for definition_id, definition in definitions.items():
        if used_definitions is not None and definition_id not in used_definitions:
            continue
        for kind, collection in (
            ("function", "functions"), ("failure_mode", "failure_modes"),
        ):
            for item in definition.get(collection, ()):
                records.append({
                    "entity_type": kind,
                    "entity_id": f"{definition_id}::{item['id']}",
                    "checksum": _checksum(item),
                })
    return records


def _projection_diff(projection: Mapping[str, Any], current: Mapping[str, Any]) -> dict[str, Any]:
    def walk(value: Any) -> dict[str, Mapping[str, Any]]:
        found: dict[str, Mapping[str, Any]] = {}
        if isinstance(value, Mapping):
            ref = value.get("system_ref") or value.get("systemRef")
            if isinstance(ref, Mapping) and ref.get("instance_id"):
                found[str(ref["instance_id"])] = value
            for nested in value.values():
                found.update(walk(nested))
        elif isinstance(value, list):
            for nested in value:
                found.update(walk(nested))
        return found
    desired, existing = walk(projection), walk(current)
    adds = sorted(set(desired) - set(existing))
    removes = sorted(set(existing) - set(desired))
    updates = sorted(
        key for key in set(desired) & set(existing)
        if _checksum(desired[key]) != _checksum(existing[key])
    )
    return {
        "add": [{"instance_id": key, "desired": desired[key]} for key in adds],
        "update": [{"instance_id": key, "current": existing[key],
                    "desired": desired[key]} for key in updates],
        "remove": [{"instance_id": key, "current": existing[key]} for key in removes],
        "conflicts": [],
        "summary": {"add": len(adds), "update": len(updates),
                    "remove": len(removes), "conflicts": 0},
    }


def project_system_definition(
    model: Mapping[str, Any], target: str, *,
    scope_instance_id: str | None = None, mode_id: str | None = None,
    quantity_strategy: str = "grouped",
    selected_path_ids: Iterable[str] = (),
    current_analysis: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Create a linked, reviewable projection into a Perdura analysis module."""
    model = upgrade_system_definition(model)
    validation = validate_system_definition(model)
    index = SystemGraphIndex.build(model)
    scoped = [item for item in _scope_instances(index, scope_instance_id)
              if _applies(item.get("mode_ids"), mode_id)]
    scoped_ids = {item["id"] for item in scoped}
    if scope_instance_id and scope_instance_id not in index.instances:
        return {"valid": False, "issues": [{
            "severity": "error", "code": "missing_projection_scope",
            "message": f"Scope instance '{scope_instance_id}' does not exist.",
        }]}

    def system_ref(instance: Mapping[str, Any], *, suffix: str = "") -> dict[str, Any]:
        definition = index.definitions.get(instance.get("definition_id"), {})
        return {
            "system_model_id": model["id"],
            "instance_id": instance["id"] + suffix,
            "definition_id": definition.get("id"),
            "revision": model.get("revision", "A"),
            "definition_revision": definition.get("revision", "A"),
        }

    def expanded(instance: Mapping[str, Any]) -> list[tuple[Mapping[str, Any], str, int]]:
        quantity = int(instance.get("quantity", 1))
        if quantity_strategy == "exploded" and quantity > 1:
            refs = instance.get("reference_designators", ())
            return [
                (instance, f"#{refs[index] if index < len(refs) else index + 1}", 1)
                for index in range(quantity)
            ]
        return [(instance, "", quantity)]

    current_linked: dict[str, Mapping[str, Any]] = {}

    def index_current(value: Any) -> None:
        if isinstance(value, Mapping):
            ref = value.get("system_ref") or value.get("systemRef")
            if isinstance(ref, Mapping) and ref.get("instance_id"):
                current_linked[str(ref["instance_id"])] = value
            for nested in value.values():
                index_current(nested)
        elif isinstance(value, list):
            for nested in value:
                index_current(nested)

    index_current(current_analysis or {})

    issues = list(validation["issues"])
    projection: dict[str, Any]
    if target == "prediction":
        blocks: list[dict[str, Any]] = []
        parts: list[dict[str, Any]] = []
        block_ids = {
            item["id"] for item in scoped
            if index.definitions.get(item.get("definition_id"), {}).get("kind") != "piece_part"
        }
        for instance in scoped:
            definition = index.definitions.get(instance.get("definition_id"), {})
            ref = system_ref(instance)
            label = instance.get("name") or definition.get("name", instance["id"])
            parent_id = instance.get("parent_instance_id")
            if definition.get("kind") != "piece_part":
                blocks.append({
                    "id": f"sys-{instance['id']}", "name": label,
                    "parentId": f"sys-{parent_id}" if parent_id in block_ids else None,
                    "quantity": instance.get("quantity", 1), "system_ref": ref,
                    "linked": True,
                })
                continue
            profiles = [profile for profile in definition.get("analysis_profiles", ())
                        if profile.get("domain") == "prediction"
                        and _applies(profile.get("mode_ids"), mode_id)]
            profile = profiles[0] if profiles else None
            resolved = resolve_analysis_profile(
                model, instance["id"], profile["id"], mode_id=mode_id
            ) if profile else None
            cursor = parent_id
            while cursor and cursor not in block_ids:
                cursor = index.instances.get(cursor, {}).get("parent_instance_id")
            for _, suffix, quantity in expanded(instance):
                raw = resolved.get("profile", {}).get("resolved_values", {}) \
                    if resolved else {}
                ref = system_ref(instance, suffix=suffix)
                existing = current_linked.get(str(ref["instance_id"]), {})
                profile_params = {key: value for key, value in raw.items()
                                  if key not in {"category", "environment"}}
                local_params = existing.get("params", {})
                params = {**profile_params, **(local_params
                    if isinstance(local_params, Mapping) else {})}
                parts.append({
                    "id": f"sys-{instance['id']}{suffix}",
                    "name": label if not suffix else f"{label} {suffix.removeprefix('#')}",
                    "part_number": definition.get("part_number", ""),
                    "manufacturer": definition.get("manufacturer", ""),
                    "category": raw.get("category", definition.get("category", "")),
                    "quantity": quantity,
                    "parentId": f"sys-{cursor}" if cursor else None,
                    "params": params,
                    "environment": existing.get("environment", raw.get("environment")),
                    "profile_adapter_id": profile.get("adapter_id") if profile else None,
                    "requires_profile": not bool(profile and resolved and resolved.get("valid")),
                    "system_ref": ref, "linked": True,
                })
                if not profile:
                    issues.append({
                        "severity": "error", "code": "missing_prediction_profile",
                        "path": f"instances.{instance['id']}",
                        "message": f"Piece part '{label}' needs a Prediction profile.",
                    })
                elif not resolved.get("valid"):
                    issues.append({
                        "severity": "error", "code": "invalid_prediction_profile",
                        "path": f"instances.{instance['id']}",
                        "message": f"Piece part '{label}' has an incomplete Prediction profile.",
                    })
        projection = {"blocks": blocks, "parts": parts}
    elif target == "fmea":
        structures = []
        functions = []
        failures = []
        for instance in scoped:
            definition = index.definitions.get(instance.get("definition_id"), {})
            variants = expanded(instance)
            if quantity_strategy == "exploded" and len(variants) > 1 and (
                    index.children.get(instance["id"]) or any(
                        interface.get(side, {}).get("instance_id") == instance["id"]
                        for interface in model.get("interfaces", ())
                        for side in ("source", "target"))):
                issues.append({
                    "severity": "error", "code": "explode_mapping_required",
                    "path": f"instances.{instance['id']}",
                    "message": "Exploding a connected or parent block requires a reviewed child/interface mapping; use grouped quantity for this projection.",
                })
                variants = [(instance, "", instance.get("quantity", 1))]
            for _, suffix, quantity in variants:
                ref = system_ref(instance, suffix=suffix)
                projection_instance_id = f"{instance['id']}{suffix}"
                structures.append({
                    "id": f"sys-{projection_instance_id}",
                    "parent_id": f"sys-{instance.get('parent_instance_id')}"
                        if instance.get("parent_instance_id") in scoped_ids else None,
                    "name": (instance.get("name") or definition.get("name", instance["id"]))
                        + (f" {suffix.removeprefix('#')}" if suffix else ""),
                    "type": definition.get("kind", "component"),
                    "quantity": quantity,
                    "system_ref": ref, "linked": True,
                })
                for function in definition.get("functions", ()):
                    if not _applies(function.get("mode_ids"), mode_id):
                        continue
                    function_id = f"sys-{projection_instance_id}-{function['id']}"
                    functions.append({
                        "id": function_id, "structure_node_id": f"sys-{projection_instance_id}",
                        "description": function["description"],
                        "canonical_verb_id": function.get("canonical_verb_id"),
                        "function_type": function.get("function_type", "primary"),
                        "system_ref": {**ref, "function_id": function["id"]}, "linked": True,
                    })
                    for failure in definition.get("failure_modes", ()):
                        if failure.get("function_id") == function["id"] and _applies(
                                failure.get("mode_ids"), mode_id):
                            failures.append({
                                "id": f"sys-{projection_instance_id}-{failure['id']}",
                                "function_id": function_id,
                                "description": failure["description"],
                                "deviation_id": failure.get("deviation_id", "custom"),
                                "system_ref": {**ref, "function_id": function["id"],
                                               "failure_mode_id": failure["id"]},
                                "linked": True,
                            })
        interfaces = [deepcopy(item) for item in model.get("interfaces", ())
                      if any(item.get(side, {}).get("instance_id") in scoped_ids
                             for side in ("source", "target"))]
        assertions = [deepcopy(item) for item in model.get("propagation_assertions", ())
                      if item.get("status") == "accepted"]
        projection = {
            "structures": structures, "functions": functions,
            "failure_modes": failures, "interfaces": interfaces,
            "accepted_propagations": assertions,
        }
    elif target == "rbd":
        leaf_ids = {item["id"] for item in scoped if not any(
            child["id"] in scoped_ids for child in index.children.get(item["id"], ()))}
        nodes = []
        for instance in scoped:
            if instance["id"] not in leaf_ids:
                continue
            definition = index.definitions.get(instance.get("definition_id"), {})
            profiles = [profile for profile in definition.get("analysis_profiles", ())
                        if profile.get("domain") == "reliability"
                        and _applies(profile.get("mode_ids"), mode_id)]
            profile = profiles[0] if profiles else None
            existing = current_linked.get(instance["id"], {})
            analysis_overrides = existing.get("reliabilityProfileOverrides", {})
            resolved = resolve_analysis_profile(
                model, instance["id"], profile["id"], mode_id=mode_id,
                analysis_overrides=analysis_overrides
                    if isinstance(analysis_overrides, Mapping) else {},
            ) if profile else None
            raw = resolved.get("profile", {}).get("resolved_values", {}) \
                if resolved else {}
            reliability_data: dict[str, Any] = {}
            adapter_id = profile.get("adapter_id") if profile else None
            if adapter_id == "reliability.constant-hazard" and resolved.get("valid"):
                typed_rate = resolved["profile"]["values"]["failure_rate"]
                unit = str(typed_rate.get("unit", "")).strip().lower()
                reliability_data = {
                    "distribution": "exponential",
                    "dist_params": {
                        "lambda": raw["failure_rate"]
                        * _FAILURE_RATE_PER_HOUR_FACTORS[unit],
                    },
                    "reliabilitySourceUnit": typed_rate.get("unit"),
                }
            elif adapter_id == "reliability.distribution" and resolved.get("valid"):
                distribution = str(raw["distribution"]).lower()
                reliability_data = {
                    "distribution": distribution,
                    "dist_params": {
                        key: raw[key]
                        for key in _DISTRIBUTION_PARAMETERS[distribution]
                    },
                }
                if isinstance(raw.get("mission_time"), (int, float)):
                    reliability_data["mission_time"] = raw["mission_time"]
            elif adapter_id == "reliability.analysis-reference" and resolved.get("valid"):
                reliability_data = {
                    "canonicalAnalysisReference": raw.get("analysis_id"),
                }
            local_reliability = existing.get("analysisReliabilityOverride", {})
            if isinstance(local_reliability, Mapping):
                reliability_data.update(deepcopy(local_reliability))
            direct_reliability = reliability_data.get("reliability")
            distribution = str(reliability_data.get("distribution", ""))
            parameters = reliability_data.get("dist_params")
            has_local_model = (
                isinstance(direct_reliability, (int, float))
                and not isinstance(direct_reliability, bool)
                and 0 <= direct_reliability <= 1
                or (
                    distribution in _DISTRIBUTION_PARAMETERS
                    and isinstance(parameters, Mapping)
                    and all(
                        isinstance(parameters.get(key), (int, float))
                        and not isinstance(parameters.get(key), bool)
                        and parameters[key] > 0
                        for key in _DISTRIBUTION_PARAMETERS[distribution]
                    )
                )
                or bool(reliability_data.get("linkedAnalysisId"))
            )
            variants = expanded(instance)
            if quantity_strategy == "exploded" and len(variants) > 1 and any(
                    interface.get(side, {}).get("instance_id") == instance["id"]
                    for interface in model.get("interfaces", ())
                    for side in ("source", "target")):
                issues.append({
                    "severity": "error", "code": "explode_mapping_required",
                    "path": f"instances.{instance['id']}",
                    "message": "Exploding an interfaced reliability block requires a reviewed topology mapping; use grouped quantity for this projection.",
                })
                variants = [(instance, "", instance.get("quantity", 1))]
            for _, suffix, _ in variants:
                nodes.append({
                    "id": f"rbd-{instance['id']}{suffix}", "type": "component",
                    "data": {
                        "label": (instance.get("name") or definition.get("name", instance["id"]))
                            + (f" {suffix.removeprefix('#')}" if suffix else ""),
                        "systemRef": system_ref(instance, suffix=suffix), "linked": True,
                        "requiresReliabilityModel": not bool(has_local_model or (
                            profile and resolved and resolved.get("valid")
                            and adapter_id != "reliability.analysis-reference")),
                        "reliabilityProfileId": profile["id"] if profile else None,
                        "reliabilityProfileAdapterId": adapter_id,
                        "reliabilityProfileOverrides": analysis_overrides,
                        **reliability_data,
                    },
                })
            if not profile and not has_local_model:
                issues.append({
                    "severity": "error", "code": "missing_reliability_profile",
                    "path": f"instances.{instance['id']}",
                    "message": f"Leaf block '{instance.get('name') or definition.get('name', instance['id'])}' needs a reliability profile.",
                })
            elif profile and not resolved.get("valid") and not has_local_model:
                issues.append({
                    "severity": "error", "code": "invalid_reliability_profile",
                    "path": f"instances.{instance['id']}",
                    "message": f"Leaf block '{instance.get('name') or definition.get('name', instance['id'])}' has an incomplete reliability profile.",
                })
            elif adapter_id == "reliability.analysis-reference":
                issues.append({
                    "severity": "warning", "code": "analysis_reference_resolution_required",
                    "path": f"instances.{instance['id']}",
                    "message": "Resolve the canonical analysis reference in RBD before calculation.",
                })
        edges = []
        seen_edges: set[tuple[str, str]] = set()
        for interface in model.get("interfaces", ()):
            source = interface.get("source", {}).get("instance_id")
            target_id = interface.get("target", {}).get("instance_id")
            if source in leaf_ids and target_id in leaf_ids and source != target_id:
                key = (source, target_id)
                if key not in seen_edges:
                    edges.append({
                        "id": f"rbd-{interface['id']}",
                        "source": f"rbd-{source}", "target": f"rbd-{target_id}",
                        "systemRef": {"system_model_id": model["id"],
                                      "interface_id": interface["id"]},
                    })
                    seen_edges.add(key)
        projection = {"nodes": nodes, "edges": edges, "topologyReviewRequired": True}
    else:
        starter = generate_system_starter(
            model, target, mode_id=mode_id,
            selected_path_ids=selected_path_ids,
        )
        projection = starter.get("draft", {})
        issues.extend(starter.get("issues", ()))

    checksums = _entity_checksums(model, scoped_ids)
    fingerprint = _checksum({
        "model_id": model["id"], "revision": model.get("revision"),
        "target": target, "scope": scope_instance_id, "mode": mode_id,
        "quantity_strategy": quantity_strategy, "checksums": checksums,
    })
    binding = {
        "id": _hash("binding", [model["id"], target, scope_instance_id, mode_id]),
        "system_model_id": model["id"], "analysis_module": target,
        "analysis_id": "pending", "scope_instance_id": scope_instance_id,
        "mode_id": mode_id, "quantity_strategy": quantity_strategy,
        "source_revision": model.get("revision", "A"),
        "source_fingerprint": fingerprint, "entity_checksums": checksums,
        "analysis_overrides": {},
    }
    return {
        "valid": not any(item.get("severity") == "error" for item in issues),
        "target": target, "issues": issues,
        "projection": projection,
        "diff": _projection_diff(projection, current_analysis or {}),
        "binding": binding,
        "review_required": True,
    }


def analyze_system_impact(
    model: Mapping[str, Any], bindings: Iterable[Mapping[str, Any]],
) -> dict[str, Any]:
    """Compare saved binding checksums with current canonical entities."""
    model = upgrade_system_definition(model)
    index = SystemGraphIndex.build(model)
    results: list[dict[str, Any]] = []
    for binding in bindings:
        scope = binding.get("scope_instance_id")
        scoped_ids = {item["id"] for item in _scope_instances(index, scope)} \
            if scope else None
        current = {
            (item["entity_type"], item["entity_id"]): item["checksum"]
            for item in _entity_checksums(model, scoped_ids)
        }
        previous = {
            (item["entity_type"], item["entity_id"]): item["checksum"]
            for item in binding.get("entity_checksums", ())
        }
        changed = [
            {"entity_type": key[0], "entity_id": key[1],
             "change": "modified" if key in current else "removed"}
            for key, value in previous.items()
            if current.get(key) != value
        ]
        added = [
            {"entity_type": key[0], "entity_id": key[1], "change": "added"}
            for key in current if key not in previous
        ]
        results.append({
            "binding_id": binding.get("id"),
            "analysis_module": binding.get("analysis_module"),
            "analysis_id": binding.get("analysis_id"),
            "status": "stale" if changed or added else "current",
            "changes": changed + added,
            "summary": {"modified_or_removed": len(changed), "added": len(added)},
        })
    return {"model_id": model.get("id"), "bindings": results,
            "stale": sum(item["status"] == "stale" for item in results)}


def generate_system_starter(
    model: Mapping[str, Any], target: str, *, mode_id: str | None = None,
    source_failure_mode_ids: Iterable[str] = (), selected_path_ids: Iterable[str] = (),
    max_paths: int = 10000, max_depth: int = 100,
) -> dict[str, Any]:
    model = upgrade_system_definition(model)
    propagation = propagate_system_definition(
        model, mode_id=mode_id, source_failure_mode_ids=source_failure_mode_ids,
        max_paths=max_paths, max_depth=max_depth,
    )
    selected = set(selected_path_ids)
    paths = [item for item in propagation.get("paths", ())
             if not selected or item["id"] in selected]
    edge_by_id = {item["id"]: item for item in propagation.get("edges", ())}
    node_by_id = {item["id"]: item for item in propagation.get("nodes", ())}
    used_edges = [edge_by_id[edge_id] for path in paths for edge_id in path["edge_ids"]
                  if edge_id in edge_by_id]
    used_nodes = {edge["source"] for edge in used_edges} | {
        edge["target"] for edge in used_edges}

    def canonical_ref(node_id: str) -> dict[str, Any]:
        function = node_by_id.get(node_id, {}).get("function", {})
        return {
            "system_model_id": model["id"],
            "instance_id": function.get("instance_id"),
            "definition_id": function.get("definition_id"),
            "function_id": function.get("id"),
            "revision": model.get("revision"),
        }

    if target == "rbd":
        instance_ids: list[str] = []
        for node_id in used_nodes:
            instance_id = node_by_id[node_id]["function"]["instance_id"]
            if instance_id not in instance_ids:
                instance_ids.append(instance_id)
        nodes = [{
            "id": f"rbd-{instance_id}", "type": "component",
            "data": {
                "label": node_by_id[next(node_id for node_id in used_nodes
                                         if node_by_id[node_id]["function"]["instance_id"] == instance_id)]["function"]["instance_name"],
                "systemRef": canonical_ref(next(
                    node_id for node_id in used_nodes
                    if node_by_id[node_id]["function"]["instance_id"] == instance_id)),
                "requiresReliabilityModel": True,
            },
        } for instance_id in instance_ids]
        edges = []
        for edge in used_edges:
            source_instance = node_by_id[edge["source"]]["function"]["instance_id"]
            target_instance = node_by_id[edge["target"]]["function"]["instance_id"]
            if source_instance != target_instance:
                value = {"source": f"rbd-{source_instance}", "target": f"rbd-{target_instance}"}
                if value not in edges:
                    edges.append(value)
        draft = {"nodes": nodes, "edges": edges}
    elif target == "fta":
        terminal_ids = [edge["target"] for edge in used_edges]
        top = terminal_ids[-1] if terminal_ids else next(iter(used_nodes), "top")
        draft = {
            "top_event": {
                "id": "fta-top", "type": "undeveloped",
                "label": node_by_id.get(top, {}).get("description", "Functional failure"),
                "systemRef": canonical_ref(top),
            },
            "candidate_events": [{
                "id": f"fta-{index + 1}", "type": "undeveloped",
                "label": node_by_id[node_id]["description"],
                "systemRef": canonical_ref(node_id),
            } for index, node_id in enumerate(sorted(used_nodes))],
            "gate_required": True,
        }
    else:
        failed = [{
            "id": f"failed-{index + 1}",
            "name": node_by_id[node_id]["description"], "state_type": "failed",
            "description": "Generated from an accepted qualitative failure path.",
            "systemRef": canonical_ref(node_id),
        } for index, node_id in enumerate(sorted(used_nodes))]
        draft = {
            "states": [{
                "id": "operational", "name": "Operational",
                "state_type": "operational", "description": "Nominal system state.",
            }, *failed],
            "transitions": [{
                "from_state": "operational", "to_state": state["id"],
                "rate": None, "label": state["name"], "requiresRate": True,
            } for state in failed],
        }
    return {
        "valid": propagation.get("valid", False), "target": target,
        "source_fingerprint": propagation.get("fingerprint"),
        "selected_path_ids": [item["id"] for item in paths],
        "draft": draft,
        "issues": [*propagation.get("issues", ()), {
            "severity": "warning", "code": "review_generated_starter",
            "message": "Generated topology is a reviewable starter and is not analysis-ready until confirmed.",
        }],
    }


__all__ = [
    "PROFILE_ADAPTERS", "SystemGraphIndex", "profile_adapters",
    "upgrade_system_definition", "resolve_analysis_profile",
    "plan_definition_composition", "project_system_definition",
    "analyze_system_impact",
    "validate_system_definition", "propagate_system_definition",
    "generate_system_starter",
]
