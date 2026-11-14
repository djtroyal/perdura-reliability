"""Canonical requirements and explicit, evidence-backed verification.

Requirement drafts are independent of scientific calculation readiness. Review
status is derived from traceability, applicable evidence and a current human
assessment; the editable plan's ``status`` field is never an approval source.
"""
from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from datetime import datetime
from hashlib import sha256
import json
import re
from typing import Any


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _issue(code: str, message: str, path: str, **refs: str) -> dict[str, Any]:
    return {"severity": "error", "code": code, "message": message, "path": path, **refs}


def _index(model: Mapping[str, Any], key: str) -> dict[str, dict[str, Any]]:
    return {item["id"]: item for item in model.get(key, ()) if isinstance(item, dict) and _text(item.get("id"))}


def _effective_functions(instance: Mapping[str, Any], definition: Mapping[str, Any]) -> dict[str, Any]:
    from reliability.FMEA_readiness import effective_function, occurrence_enabled
    overrides = {item.get("function_id"): item for item in instance.get("function_overrides", ())}
    return {item["id"]: effective_function(item, overrides.get(item["id"], {}))
            for item in definition.get("functions", ())
            if occurrence_enabled(item, overrides.get(item["id"], {}))}


def requirement_ancestors(requirements: Mapping[str, Mapping[str, Any]], ids: list[str]) -> list[str]:
    """Iterative closure remains bounded for malformed cyclic drafts."""
    seen: set[str] = set()
    pending = list(ids)
    while pending:
        key = pending.pop()
        if key in seen:
            continue
        seen.add(key)
        pending.extend(requirements.get(key, {}).get("derived_from_ids", ()))
    return sorted(seen)


def validate_requirement_graph(model: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Return traceability errors without mutating or rejecting draft records."""
    issues: list[dict[str, Any]] = []
    requirements = _index(model, "requirements")
    instances, definitions = _index(model, "instances"), _index(model, "definitions")
    interfaces, modes = _index(model, "interfaces"), _index(model, "modes")
    evidence = _index(model, "verification_evidence")
    seen: set[str] = set()
    for collection in ("requirements", "verification_cases", "verification_evidence"):
        for position, item in enumerate(model.get(collection, ())):
            key = item.get("id", "")
            if not _text(key) or key in seen:
                issues.append(_issue("duplicate_id" if key in seen else "missing_id",
                                     f"{collection} need unique, nonempty IDs.", f"{collection}.{position}.id",
                                     **({"requirement_id": key} if collection == "requirements" else {"case_id": key} if collection == "verification_cases" else {"evidence_id": key})))
            seen.add(key)

    def missing_modes(item: Mapping[str, Any], path: str, **refs: str) -> None:
        for mode in item.get("mode_ids", ()):
            if mode not in modes:
                issues.append(_issue("missing_mode", f"Operating mode '{mode}' does not exist.", path + ".mode_ids", **refs))

    for key, req in requirements.items():
        path = f"requirements.{key}"
        missing_modes(req, path, requirement_id=key)
        if req.get("requirement_type") == "process":
            issues.append(_issue("process_requirement", "Process requirements belong to a process FMEA.", path + ".requirement_type", requirement_id=key))
        for parent in req.get("derived_from_ids", ()):
            if parent not in requirements:
                issues.append(_issue("missing_parent_requirement", f"Parent requirement '{parent}' does not exist.", path + ".derived_from_ids", requirement_id=key))
        for evidence_id in req.get("evidence_ids", ()):
            if evidence_id not in evidence:
                issues.append(_issue("missing_evidence", f"Evidence '{evidence_id}' does not exist.", path + ".evidence_ids", requirement_id=key))
        for position, ref in enumerate(req.get("allocations", ())):
            allocation_path = f"{path}.allocations.{position}"
            if ref.get("system_model_id") != model.get("id"):
                issues.append(_issue("wrong_system", "Allocation belongs to another System Model.", allocation_path, requirement_id=key))
            instance = instances.get(ref.get("instance_id"))
            definition = definitions.get(instance.get("definition_id")) if instance else definitions.get(ref.get("definition_id"))
            if ref.get("instance_id") and instance is None:
                issues.append(_issue("missing_instance", "Allocated system block no longer exists.", allocation_path, requirement_id=key))
            if ref.get("definition_id") and ref["definition_id"] not in definitions:
                issues.append(_issue("missing_definition", "Allocated block definition no longer exists.", allocation_path, requirement_id=key))
            if instance and ref.get("definition_id") and instance.get("definition_id") != ref["definition_id"]:
                issues.append(_issue("definition_mismatch", "Allocated definition does not belong to this block.", allocation_path, requirement_id=key))
            if ref.get("function_id"):
                if not instance or ref["function_id"] not in _effective_functions(instance, definition or {}):
                    issues.append(_issue("missing_function", "Allocated function requires an existing enabled installed function.", allocation_path, requirement_id=key))
            if ref.get("failure_mode_id"):
                overrides = {item["failure_mode_id"]: item for item in (instance or {}).get("failure_mode_overrides", ())}
                from reliability.FMEA_readiness import occurrence_enabled
                failures = {item["id"] for item in (definition or {}).get("failure_modes", ())
                            if occurrence_enabled(item, overrides.get(item["id"], {}))}
                if not instance or ref["failure_mode_id"] not in failures:
                    issues.append(_issue("missing_failure_mode", "Allocated failure mode no longer exists or is disabled.", allocation_path, requirement_id=key))
            if ref.get("interface_id") and ref["interface_id"] not in interfaces:
                issues.append(_issue("missing_interface", "Allocated interface no longer exists.", allocation_path, requirement_id=key))

    # DFS with an explicit stack avoids recursion limits on deep derivation chains.
    done: set[str] = set()
    cyclic: set[str] = set()
    for start in requirements:
        if start in done:
            continue
        active: dict[str, int] = {start: 0}
        path = [start]
        stack = [(start, iter(requirements[start].get("derived_from_ids", ())))]
        while stack:
            node, children = stack[-1]
            child = next(children, None)
            if child is None:
                stack.pop(); done.add(node); active.pop(node, None); path.pop()
            elif child in active:
                cyclic.update(path[active[child]:])
            elif child in requirements and child not in done:
                active[child] = len(path); path.append(child)
                stack.append((child, iter(requirements[child].get("derived_from_ids", ()))))
    for key in sorted(cyclic):
        issues.append(_issue("derivation_cycle", "Requirement derivation must not contain a cycle.", f"requirements.{key}.derived_from_ids", requirement_id=key))

    for key, item in evidence.items():
        path = f"verification_evidence.{key}"
        missing_modes(item, path, evidence_id=key)
        for req in item.get("requirement_ids", ()):
            if req not in requirements:
                issues.append(_issue("missing_requirement", f"Evidence references missing requirement '{req}'.", path, evidence_id=key))
    for case in model.get("verification_cases", ()):
        key = case.get("id", "")
        path = f"verification_cases.{key}"
        missing_modes(case, path, case_id=key)
        for req in case.get("requirement_ids", ()):
            if req not in requirements:
                issues.append(_issue("missing_requirement", f"Verification references missing requirement '{req}'.", path, case_id=key))
        for evidence_id in case.get("evidence_link_ids", ()):
            if evidence_id not in evidence:
                issues.append(_issue("missing_evidence", f"Verification references missing evidence '{evidence_id}'.", path, case_id=key))
    return issues


def _without(value: Mapping[str, Any], keys: tuple[str, ...]) -> dict[str, Any]:
    return {key: item for key, item in value.items() if key not in keys}


def _sorted(items):
    return sorted(items, key=lambda item: item["id"].encode("utf-16-be", errors="surrogatepass"))


def _js_number(value: int | float) -> str:
    """JSON.stringify's finite-number notation for portable review manifests."""
    if value == 0:
        return "0"
    sign = "-" if value < 0 else ""
    value = abs(value)
    raw = repr(float(value)).lower()
    if raw in ("nan", "inf"):
        raise ValueError("Review hashing does not accept non-finite numbers.")
    mantissa, _, exponent = raw.partition("e")
    digits = mantissa.replace(".", "").rstrip("0")
    # Number of digits before the decimal, prior to exponent adjustment.
    point = len(mantissa.partition(".")[0]) + int(exponent or "0")
    if 1e-6 <= value < 1e21:
        if point <= 0:
            return sign + "0." + "0" * (-point) + digits
        if point >= len(digits):
            return sign + digits + "0" * (point - len(digits))
        return sign + digits[:point] + "." + digits[point:]
    exp = point - 1
    return sign + digits[0] + (("." + digits[1:]) if len(digits) > 1 else "") + "e" + ("+" if exp >= 0 else "-") + str(abs(exp))


def canonical_review_json(value: Any) -> str:
    """Canonical key order and UTF-8 strings match frontend provenance hashing."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, (int, float)):
        return _js_number(value)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(canonical_review_json(item) for item in value) + "]"
    if isinstance(value, Mapping):
        # JSON.stringify enumerates integer-index keys first, even when keys
        # were inserted in sorted order by canonicalJson().
        def key_order(key):
            is_index = key.isascii() and key.isdigit() and str(int(key)) == key and int(key) < 4294967295
            return (0, int(key)) if is_index else (1, key.encode("utf-16-be", errors="surrogatepass"))
        return "{" + ",".join(canonical_review_json(key) + ":" + canonical_review_json(value[key]) for key in sorted(value, key=key_order)) + "}"
    raise TypeError("Review hashing accepts only JSON values.")


def _review_functions(model: Mapping[str, Any], instance: Mapping[str, Any], definitions=None, resources=None) -> list[dict[str, Any]]:
    definition = (definitions if definitions is not None else _index(model, "definitions")).get(instance.get("definition_id"), {})
    resources = resources if resources is not None else _index(model, "resources")
    overrides = {item.get("function_id"): item for item in instance.get("function_overrides", ())}
    functions = []
    for raw in definition.get("functions", ()):
        override = overrides.get(raw["id"], {})
        enabled = override.get("enabled")
        if (enabled if enabled is not None else raw.get("default_enabled", True)) is False:
            continue
        function = {**raw, **{key: value for key, value in override.items() if value is not None}, "id": raw["id"]}
        structured = function.get("definition")
        if structured and override.get("resource_bindings"):
            structured = {**structured, "io": [{**io, "resource_id": override["resource_bindings"].get(io["id"], io["resource_id"])} for io in structured.get("io", ())]}
            function["definition"] = structured
        if structured:
            action = _text(structured.get("action"))
            if structured.get("role") == "maintain_state":
                verb = structured.get("state_verb") or "maintain"
                function["description"] = f"{verb[0].upper()}{verb[1:]} {action}" if action else ""
            else:
                outputs = [resources.get(io.get("resource_id"), {}).get("name", "") for io in structured.get("io", ()) if io.get("direction") == "output"]
                output = next((name for name in outputs if name), "")
                function["description"] = action or (f"{'Provide' if structured.get('role') == 'source' else 'Produce'} {output}" if output else "")
        functions.append(function)
    return functions


def _allocated_inputs(model: Mapping[str, Any], allocations: list[dict[str, Any]]) -> dict[str, Any]:
    instance_ids, function_keys, interface_ids, definition_ids, resource_ids = set(), set(), set(), set(), set()
    for ref in allocations:
        if ref.get("interface_id"):
            interface_ids.add(ref["interface_id"])
        if ref.get("instance_id") and ref.get("function_id"):
            function_keys.add(f"{ref['instance_id']}::{ref['function_id']}")
        elif ref.get("instance_id"):
            instance_ids.add(ref["instance_id"])
        elif ref.get("definition_id"):
            definition_ids.add(ref["definition_id"])
    changed = True
    while changed:
        changed = False
        for instance in model.get("instances", ()):
            if (instance.get("parent_instance_id", "") in instance_ids or instance["definition_id"] in definition_ids) and instance["id"] not in instance_ids:
                instance_ids.add(instance["id"]); changed = True
    definitions, resources = _index(model, "definitions"), _index(model, "resources")
    installed_functions = [(instance, function) for instance in model.get("instances", ())
        for function in _review_functions(model, instance, definitions, resources)]
    for instance, function in installed_functions:
        if instance["id"] in instance_ids:
            function_keys.add(f"{instance['id']}::{function['id']}")
    for edge in model.get("interfaces", ()):
        if edge["id"] not in interface_ids:
            continue
        for side in ("source", "target"):
            instance_id = edge.get(side, {}).get("instance_id")
            if instance_id:
                function_keys.update(f"{instance_id}::{key}" for key in edge.get(side + "_function_ids", ()))
        for transfer in edge.get("transfers", ()):
            if transfer.get("kind") == "flow":
                for side in ("source", "target"):
                    endpoint = transfer[side]
                    if endpoint.get("kind") == "function":
                        function_keys.add(f"{endpoint['instance_id']}::{endpoint['function_id']}")
    changed = True
    while changed:
        before = len(function_keys)
        for link in model.get("function_links", ()):
            source = f"{link['source']['instance_id']}::{link['source']['function_id']}"
            target = f"{link['target']['instance_id']}::{link['target']['function_id']}"
            if source in function_keys and link.get("relationship") in ("decomposes_to", "depends_on", "monitors", "responds_to"):
                function_keys.add(target)
            if target in function_keys and link.get("relationship") in ("provides_input", "enables"):
                function_keys.add(source)
        for edge in model.get("interfaces", ()):
            for transfer in edge.get("transfers", ()):
                if transfer.get("kind") == "flow" and transfer.get("source", {}).get("kind") == "function" and transfer.get("target", {}).get("kind") == "function":
                    if f"{transfer['target']['instance_id']}::{transfer['target']['function_id']}" in function_keys:
                        function_keys.add(f"{transfer['source']['instance_id']}::{transfer['source']['function_id']}")
        changed = len(function_keys) != before
    functions = []
    for instance, function in installed_functions:
        key = f"{instance['id']}::{function['id']}"
        if key not in function_keys:
            continue
        resource_ids.update(io["resource_id"] for io in (function.get("definition") or {}).get("io", ()))
        definition = definitions.get(instance["definition_id"], {})
        functions.append({"id": key, "instance_id": instance["id"], "definition_id": instance["definition_id"],
            "parent_instance_id": instance.get("parent_instance_id"), **({"quantity": instance["quantity"]} if "quantity" in instance else {}),
            "mode_ids": instance.get("mode_ids") or [],
            "properties": instance.get("properties") or {}, "profile_overrides": instance.get("profile_overrides") or [],
            "definition_properties": definition.get("properties") or {}, "analysis_profiles": definition.get("analysis_profiles") or [],
            "function": function})
    selected_functions = {function["id"] for function in functions}
    interfaces = [edge for edge in model.get("interfaces", ()) if edge["id"] in interface_ids
        or edge.get("source", {}).get("instance_id", "") in instance_ids or edge.get("target", {}).get("instance_id", "") in instance_ids
        or any(f"{edge.get('source', {}).get('instance_id')}::{key}" in selected_functions for key in edge.get("source_function_ids", ()))
        or any(f"{edge.get('target', {}).get('instance_id')}::{key}" in selected_functions for key in edge.get("target_function_ids", ()))]
    for edge in interfaces:
        resource_ids.update(transfer["resource_id"] for transfer in edge.get("transfers", ()) if transfer.get("kind") == "flow")
    external_ids = {edge.get(side, {}).get("external_id") for edge in interfaces for side in ("source", "target")}
    instances = [item for item in model.get("instances", ()) if item["id"] in instance_ids]
    definition_ids.update(instance["definition_id"] for instance in instances)
    return {
        "instances": [_without(item, ("name", "source_metadata", "legacy_refs")) for item in _sorted(instances)],
        "definitions": [_without(item, ("name", "revision")) for item in _sorted([item for item in model.get("definitions", ()) if item["id"] in definition_ids])],
        "functions": _sorted(functions), "interfaces": _sorted(interfaces),
        "resources": _sorted([item for item in model.get("resources", ()) if item["id"] in resource_ids]),
        "externals": _sorted([item for item in model.get("externals", ()) if item["id"] in external_ids]),
        "function_links": _sorted([link for link in model.get("function_links", ()) if f"{link['source']['instance_id']}::{link['source']['function_id']}" in selected_functions
            or f"{link['target']['instance_id']}::{link['target']['function_id']}" in selected_functions]),
    }


def verification_review_inputs(model: Mapping[str, Any], case: Mapping[str, Any]) -> dict[str, Any]:
    by_id = _index(model, "requirements")
    requirements = _sorted([by_id[key] for key in requirement_ancestors(by_id, list(case.get("requirement_ids", ()))) if key in by_id])
    mode_ids = set(case.get("mode_ids", ())) | {key for req in requirements for key in req.get("mode_ids", ())}
    return {
        "schema": "perdura-verification-review/1", "system_model_id": model["id"],
        "case": _without(case, ("status", "planned_date", "reviewed_by", "reviewed_at", "reviewed_fingerprint", "reviewed_revision")),
        "requirements": [_without(req, ("source_checksum", "linked_program_requirement_id")) for req in requirements],
        "evidence": _sorted([item for item in model.get("verification_evidence", ()) if item["id"] in case.get("evidence_link_ids", ())]),
        "modes": _sorted([mode for mode in model.get("modes", ()) if not mode_ids or mode["id"] in mode_ids]),
        "architecture": _allocated_inputs(model, [ref for req in requirements for ref in req.get("allocations", ())]),
    }


def verification_review_fingerprint(model: Mapping[str, Any], case: Mapping[str, Any]) -> str:
    return sha256(canonical_review_json(verification_review_inputs(model, case)).encode("utf-8", errors="backslashreplace")).hexdigest()


def _date_valid(value: Any) -> bool:
    if not _text(value):
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return True
    except (ValueError, TypeError):
        return False


def evaluate_system_requirements(model: Mapping[str, Any], sources: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Derive case and requirement status; planned ``status`` is never trusted.

    ``sources`` is the caller's current project provenance ledger, not an
    authentication claim. The desktop project owner remains the reviewing
    engineer; this endpoint does not sign or certify engineering decisions.
    """
    requirements = list(model.get("requirements", ()))
    cases = list(model.get("verification_cases", ()))
    evidence = list(model.get("verification_evidence", ()))
    by_id = {req["id"]: req for req in requirements}
    mode_ids = {mode["id"] for mode in model.get("modes", ())}
    issues: list[dict[str, Any]] = []

    def add(entity_id, code, message):
        issues.append({"entity_id": entity_id, "code": code, "message": message, "severity": "error"})

    # Graph validation is shared by editors, reports and review assessment.
    code_aliases = {"duplicate_id": "duplicate_identity", "missing_id": "duplicate_identity", "process_requirement": "process_scope", "missing_instance": "broken_allocation", "missing_definition": "broken_allocation", "definition_mismatch": "broken_allocation", "wrong_system": "broken_allocation", "missing_function": "broken_allocation", "missing_failure_mode": "broken_allocation", "missing_interface": "broken_allocation"}
    for issue in validate_requirement_graph(model):
        entity_id = issue.get("requirement_id") or issue.get("case_id") or issue.get("evidence_id") or ""
        code = code_aliases.get(issue["code"], issue["code"])
        if issue.get("evidence_id") and code == "missing_requirement":
            code = "evidence_missing_requirement"
        add(entity_id, code, issue["message"])
    for req in requirements:
        if not _text(req.get("statement")):
            add(req["id"], "missing_statement", "Define the requirement statement.")
        if not _text(req.get("acceptance_criteria")):
            add(req["id"], "missing_criteria", "Define measurable acceptance criteria.")
        if not req.get("allocations"):
            add(req["id"], "missing_allocation", "Allocate the requirement to a system block, function, or interface.")
        for ref in req.get("allocations", ()):
            if not any(ref.get(key) for key in ("instance_id", "definition_id", "interface_id")):
                add(req["id"], "broken_allocation", "Choose an installed block, function, or interface.")
    case_results = []
    for case in cases:
        key = case["id"]
        local: list[dict[str, Any]] = []

        def fail(code, message):
            local.append({"entity_id": key, "code": code, "message": message, "severity": "error"})

        requirement_ids = case.get("requirement_ids", ())
        if not requirement_ids:
            fail("missing_requirement", "Choose a requirement to verify.")
        linked = [by_id[req_id] for req_id in requirement_ids if req_id in by_id]
        for req_id in requirement_ancestors(by_id, list(requirement_ids)):
            req = by_id.get(req_id)
            if not req:
                continue
            if req.get("lifecycle") == "retired":
                fail("retired_requirement", "A linked or parent requirement is retired.")
            for issue in issues:
                if issue["entity_id"] == req_id and issue["severity"] == "error":
                    fail(issue["code"], f"{req_id}: {issue['message']}")
        for field, code, message in (
            ("objective", "missing_objective", "Define the verification objective."),
            ("method", "missing_method", "Choose a verification method."),
            ("acceptance_criteria", "missing_criteria", "Define the verification acceptance criteria."),
            ("assessment", "missing_assessment", "Record how the evidence meets or fails the acceptance criteria."),
        ):
            if not _text(case.get(field)):
                fail(code, message)
        if case.get("outcome") not in ("pass", "fail"):
            fail("missing_outcome", "Record a pass or fail assessment; an inconclusive result remains unverified.")
        attached = [entry for entry in evidence if entry["id"] in case.get("evidence_link_ids", ())]
        if not attached:
            fail("missing_evidence", "Add applicable evidence before recording a review.")
        for entry in attached:
            for issue in issues:
                if issue["entity_id"] == entry["id"]:
                    fail(issue["code"], issue["message"])
            if entry.get("stale"):
                fail("stale_evidence", entry.get("stale_reason") or "Evidence was marked stale.")
            if not _text(entry.get("claim")) or not _text(entry.get("locator")) or not _date_valid(entry.get("captured_at")):
                fail("incomplete_evidence", "Evidence needs a claim, locator, and valid capture date.")
            if not set(entry.get("requirement_ids", ())).intersection(requirement_ids):
                fail("inapplicable_evidence", "Evidence does not support a requirement in this case.")
            if entry.get("source_module") == "external":
                if not _text(entry.get("source_revision")) or not re.fullmatch(r"[a-f0-9]{64}", entry.get("source_checksum") or ""):
                    fail("unversioned_evidence", "External evidence needs its source revision and SHA-256 checksum.")
            else:
                source = next((value for value in sources or [] if value.get("runId") == entry.get("run_id") and value.get("moduleKey") == entry.get("module_key") and value.get("analysisId") == entry.get("source_analysis_id")), None)
                if not source or not source.get("current") or source.get("fingerprintSha256") != entry.get("source_checksum"):
                    fail("stale_evidence", "The linked analysis run is missing, superseded, or its calculation inputs changed.")
        for req in linked:
            required_modes = case.get("mode_ids") or req.get("mode_ids") or mode_ids
            if req.get("mode_ids") and any(mode not in req["mode_ids"] for mode in case.get("mode_ids", ())):
                fail("inapplicable_mode", "Verification includes a mode outside the requirement applicability.")
            applicable = [entry for entry in attached if req["id"] in entry.get("requirement_ids", ())]
            if not applicable:
                fail("missing_evidence_coverage", f"{req['id']}: no evidence supports this requirement.")
            compatible = [entry for entry in applicable if (not req.get("unit") or _text(entry.get("units")) == _text(req["unit"])) and (not req.get("mission_profile") or _text(entry.get("mission_context")) == _text(req["mission_profile"]))]
            if applicable and not compatible:
                fail("missing_evidence_coverage", f"{req['id']}: no evidence matches the requirement units and mission context together.")
            for mode in required_modes:
                if not any(not entry.get("mode_ids") or mode in entry["mode_ids"] for entry in compatible):
                    fail("missing_mode_coverage", f"{req['id']}: evidence does not cover every verification mode.")
            if req.get("unit") and not any(_text(entry.get("units")) == _text(req["unit"]) for entry in applicable):
                fail("unit_mismatch", f"{req['id']}: evidence units must match the requirement units.")
            if req.get("mission_profile") and not any(_text(entry.get("mission_context")) == _text(req["mission_profile"]) for entry in applicable):
                fail("mission_mismatch", f"{req['id']}: evidence must identify the requirement mission context.")
        fingerprint = verification_review_fingerprint(model, case)
        reviewed = bool(case.get("reviewed_fingerprint") and _text(case.get("reviewed_by")) and _text(case.get("reviewed_revision")) and _date_valid(case.get("reviewed_at")))
        if reviewed and (case["reviewed_fingerprint"] != fingerprint or any(issue["code"] == "stale_evidence" for issue in local)):
            status = "stale"
        elif local or any(issue["entity_id"] == key for issue in issues):
            status = "draft" if not _text(case.get("objective")) else "blocked"
        elif reviewed:
            status = "passed" if case.get("outcome") == "pass" else "failed"
        else:
            status = "unreviewed"
        issues.extend(local)
        case_results.append({"id": key, "status": status, "issues": [issue for issue in issues if issue["entity_id"] == key], "fingerprint": fingerprint})
    cases_by_id = {case["id"]: case for case in cases}
    requirement_results = []
    for req in requirements:
        linked = [item for item in case_results if req["id"] in cases_by_id[item["id"]].get("requirement_ids", ())]
        own_issues = [issue for issue in issues if issue["entity_id"] == req["id"]]
        modes = req.get("mode_ids") or mode_ids
        passed = [item for item in linked if item["status"] == "passed"]
        covered = all(any(not cases_by_id[item["id"]].get("mode_ids") or mode in cases_by_id[item["id"]]["mode_ids"] for item in passed) for mode in modes)
        status = "retired" if req.get("lifecycle") == "retired" else "draft" if req.get("lifecycle") == "draft" else "unverified"
        if req.get("lifecycle") != "retired":
            if any(item["status"] == "failed" for item in linked):
                status = "failed"
            elif any(item["status"] == "stale" for item in linked):
                status = "stale"
            elif not own_issues and linked and len(passed) == len(linked) and covered:
                status = "verified"
        requirement_results.append({"id": req["id"], "status": status, "issues": own_issues, "case_ids": [item["id"] for item in linked]})
    return {"issues": issues, "requirements": requirement_results, "cases": case_results}


def review_verification_case(model: Mapping[str, Any], case_id: str, reviewer: str, sources: list[dict[str, Any]] | None = None, now: str | None = None) -> dict[str, Any]:
    """Record an explicit local engineer review after validating the evidence."""
    if not _text(reviewer):
        raise ValueError("Enter the reviewing engineer's name.")
    if now is None:
        from datetime import timezone
        now = datetime.now(timezone.utc).isoformat()
    if not _date_valid(now):
        raise ValueError("A valid review date is required.")
    assessment = next((item for item in evaluate_system_requirements(model, sources)["cases"] if item["id"] == case_id), None)
    if not assessment:
        raise ValueError("Verification case no longer exists.")
    if assessment["issues"]:
        raise ValueError(assessment["issues"][0]["message"])
    result = deepcopy(dict(model))
    for case in result.get("verification_cases", ()):
        if case["id"] == case_id:
            case.update(status="passed" if case.get("outcome") == "pass" else "failed", reviewed_by=reviewer.strip(), reviewed_at=now, reviewed_fingerprint=assessment["fingerprint"], reviewed_revision=model.get("revision", ""))
    return result
