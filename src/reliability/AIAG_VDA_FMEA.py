"""AIAG–VDA-aligned FMEA workflow evaluation.

This module is an independent implementation of the publicly described
seven-step method.  It intentionally does not reproduce copyrighted handbook
prose.  Rating guidance is concise, independently worded, and versioned so a
project can retain the exact decision basis used for an analysis.

The DFMEA/PFMEA Action Priority lookup follows the grouped 1,000-combination
S/O/D table.  FMEA-MSR uses its separate S/F/M table.  Action Priority is the
priority for further action, not a quantitative or categorical statement of
risk, and RPN is never calculated for these profiles.
"""

from __future__ import annotations

from collections import Counter
from copy import deepcopy
from datetime import date
import hashlib
import json
from typing import Iterable, Mapping


METHOD_VERSION = "perdura-aiag-vda-aligned/1"
HANDBOOK_BASIS = {
    "title": "AIAG & VDA FMEA Handbook",
    "edition": "First Edition (2019)",
    "errata": "English Translation Errata, Version 2 (2020-06-02)",
    "implementation_status": "AIAG-VDA aligned, independently implemented",
    "method_version": METHOD_VERSION,
}

AIAG_KINDS = {"dfmea", "pfmea", "fmea_msr"}
ACTION_STATUSES = {
    "open",
    "decision_pending",
    "implementation_pending",
    "completed",
    "not_implemented",
}

STRUCTURE_LEVELS = {
    "dfmea": {"next_higher", "focus", "next_lower", "interface"},
    "pfmea": {"process_item", "process_step", "work_element", "interface"},
    "fmea_msr": {"next_higher", "focus", "next_lower", "interface"},
}


def _guidance(entries: list[tuple[str, str]]) -> list[dict]:
    return [
        {"rating": rating, "label": label, "description": description}
        for rating, (label, description) in enumerate(entries, start=1)
    ]


# Concise, independently worded selection guidance. These descriptions are
# deliberately not handbook table text.
_SEVERITY_DESIGN = _guidance([
    ("No discernible effect", "The user or downstream function is not affected."),
    ("Very minor", "A slight effect may be noticed without meaningful loss of function."),
    ("Minor", "A noticeable inconvenience or limited degradation is possible."),
    ("Moderate-low", "A clearly objectionable attribute or limited function loss occurs."),
    ("Moderate", "A secondary function is degraded."),
    ("Moderate-high", "A secondary function is lost."),
    ("High", "A primary function is degraded."),
    ("Very high", "A primary function is lost."),
    ("Regulatory", "A regulatory requirement may not be met."),
    ("Safety", "Safe operation or health may be affected."),
])

_SEVERITY_PROCESS = _guidance([
    ("No discernible effect", "No meaningful effect at the plant, downstream plant, or user."),
    ("Very minor", "A slight operational inconvenience or cosmetic effect occurs."),
    ("Minor", "Minor in-station correction or a modest user objection is expected."),
    ("Moderate-low", "Significant in-station rework or an objectionable attribute occurs."),
    ("Moderate", "Off-line rework or degradation of a secondary function occurs."),
    ("Moderate-high", "Major rework, short disruption, or loss of a secondary function occurs."),
    ("High", "Scrap/sort or substantial disruption accompanies degradation of a primary function."),
    ("Very high", "Major production disruption or loss of a primary function occurs."),
    ("Regulatory", "Manufacturing or product regulatory compliance may be affected."),
    ("Safety", "Worker, user, passenger, or public safety may be affected."),
])

_OCCURRENCE = _guidance([
    ("Extremely low", "The cause is physically precluded or controlled by a highly robust design."),
    ("Very low", "Proven technical prevention makes the cause very unlikely."),
    ("Low", "Strong prevention and relevant experience support a low expectation."),
    ("Moderate-low", "Effective prevention exists with some remaining exposure."),
    ("Moderate", "Prevention is generally effective but not strongly error-proofed."),
    ("Moderate-high", "Prevention has material limitations."),
    ("High", "Controls only partly prevent the cause."),
    ("High", "The cause is expected under some normal variation."),
    ("Very high", "Prevention is weak and the cause is frequently expected."),
    ("Extremely high", "No credible prevention control is present."),
])

_DETECTION_DESIGN = _guidance([
    ("Very high", "The cause/mode is physically prevented or detection is demonstrated as certain."),
    ("Very high", "A proven early method detects the cause before the mode develops."),
    ("High", "A proven method detects the mode early enough for design correction."),
    ("High", "A proven method has a strong opportunity to detect the cause or mode."),
    ("Moderate", "A proven method has a reasonable detection opportunity."),
    ("Moderate", "The method is proven but timing or coverage limits correction."),
    ("Low", "A new or insufficiently proven method has a plausible opportunity."),
    ("Low", "The unproven method or late timing makes detection uncertain."),
    ("Very low", "The method is unlikely to expose the cause or mode."),
    ("Very low", "No suitable detection method is known or planned."),
])

_DETECTION_PROCESS = _guidance([
    ("Very high", "The mode cannot be produced or a proven method always detects it."),
    ("Very high", "Machine detection identifies the cause and prevents discrepant production."),
    ("High", "Automated in-station detection contains discrepant output."),
    ("High", "Automated downstream detection reliably contains discrepant output."),
    ("Moderate", "Proven machine-based inspection detects the cause or mode."),
    ("Moderate", "Proven manual or sampled inspection detects the cause or mode."),
    ("Low", "Machine-assisted detection exists but is not fully proven."),
    ("Low", "Human/manual detection is not demonstrated as consistently effective."),
    ("Very low", "Only sporadic checks are likely to expose the mode."),
    ("Very low", "No effective inspection or detection method exists."),
])

_FREQUENCY = _guidance([
    ("Cannot occur", "The failure cause is physically precluded."),
    ("Extremely low", "Service-life occurrence is extremely unlikely."),
    ("Very low", "Service-life occurrence is unlikely."),
    ("Low", "The cause is possible but infrequent."),
    ("Medium", "The cause may occur during the service life."),
    ("Moderately high", "The cause is expected in some service populations."),
    ("High", "The cause is expected repeatedly."),
    ("Very high", "The cause occurs frequently."),
    ("Very high", "The cause is highly prevalent."),
    ("Extremely high", "The cause is expected throughout the service population."),
])

_MONITORING = _guidance([
    ("Reliable", "Monitoring and response reliably reach the intended mitigated state in time."),
    ("Very high", "Monitoring and response are highly effective with strong timing margin."),
    ("High", "Monitoring and response are effective with adequate timing margin."),
    ("Moderately high", "Monitoring is generally effective with some residual limitations."),
    ("Moderate", "Monitoring has meaningful but incomplete coverage or response effectiveness."),
    ("Moderate", "Coverage, diagnosis, or response timing is materially limited."),
    ("Moderately low", "Monitoring is unlikely to provide consistent mitigation."),
    ("Low", "Monitoring or response effectiveness is poor."),
    ("Very low", "Only exceptional cases are expected to be mitigated."),
    ("Not effective", "No effective monitoring/system response is available."),
])


def _profile_payload() -> dict:
    profiles = {
        "aiag_vda_dfmea_public_v1": {
            "id": "aiag_vda_dfmea_public_v1",
            "name": "AIAG–VDA aligned DFMEA",
            "version": "1.0",
            "kind": "dfmea",
            "built_in": True,
            "approved": True,
            "method_status": HANDBOOK_BASIS["implementation_status"],
            "rating_axes": {
                "severity": _SEVERITY_DESIGN,
                "occurrence": _OCCURRENCE,
                "detection": _DETECTION_DESIGN,
            },
            "ap_model": "aiag_vda_sod_2019",
        },
        "aiag_vda_pfmea_public_v1": {
            "id": "aiag_vda_pfmea_public_v1",
            "name": "AIAG–VDA aligned PFMEA",
            "version": "1.0",
            "kind": "pfmea",
            "built_in": True,
            "approved": True,
            "method_status": HANDBOOK_BASIS["implementation_status"],
            "rating_axes": {
                "severity": _SEVERITY_PROCESS,
                "occurrence": _OCCURRENCE,
                "detection": _DETECTION_PROCESS,
            },
            "ap_model": "aiag_vda_sod_2019",
        },
        "aiag_vda_msr_public_v1": {
            "id": "aiag_vda_msr_public_v1",
            "name": "AIAG–VDA aligned FMEA-MSR",
            "version": "1.0",
            "kind": "fmea_msr",
            "built_in": True,
            "approved": True,
            "method_status": HANDBOOK_BASIS["implementation_status"],
            "rating_axes": {
                "severity": _SEVERITY_DESIGN,
                "frequency": _FREQUENCY,
                "monitoring": _MONITORING,
            },
            "ap_model": "aiag_vda_sfm_2019",
        },
    }
    return profiles


def _canonical_checksum(value: Mapping) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(payload).hexdigest()


def builtin_rating_profiles() -> list[dict]:
    """Return detached, checksummed built-in profile definitions."""
    profiles = []
    for profile in _profile_payload().values():
        item = deepcopy(profile)
        item["checksum"] = _canonical_checksum(item)
        profiles.append(item)
    return profiles


def _rating(value: object, name: str) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{name} must be an integer from 1 to 10.")
    try:
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be an integer from 1 to 10.") from exc
    try:
        is_integer = float(value) == number
    except (TypeError, ValueError):
        is_integer = False
    if number < 1 or number > 10 or not is_integer:
        raise ValueError(f"{name} must be an integer from 1 to 10.")
    return number


def action_priority_sod(severity: int, occurrence: int, detection: int) -> str:
    """Return H/M/L for the complete AIAG–VDA DFMEA/PFMEA S/O/D space."""
    s = _rating(severity, "severity")
    o = _rating(occurrence, "occurrence")
    d = _rating(detection, "detection")
    if s == 1 or o == 1:
        return "L"
    if s >= 9:
        if o >= 6:
            return "H"
        if o >= 4:
            return "H" if d >= 2 else "M"
        # O 2–3
        if d >= 7:
            return "H"
        if d >= 5:
            return "M"
        return "L"
    if s >= 7:
        if o >= 8:
            return "H"
        if o >= 6:
            return "H" if d >= 2 else "M"
        if o >= 4:
            return "H" if d >= 7 else "M"
        # O 2–3
        return "M" if d >= 5 else "L"
    if s >= 4:
        if o >= 8:
            return "H" if d >= 5 else "M"
        if o >= 6:
            return "M" if d >= 2 else "L"
        if o >= 4:
            return "M" if d >= 7 else "L"
        return "L"
    # S 2–3
    if o >= 8:
        return "M" if d >= 5 else "L"
    return "L"


def action_priority_sfm(
    severity: int,
    frequency: int,
    monitoring: int,
    *,
    mitigated_severity: int | None = None,
) -> str:
    """Return H/M/L for the complete AIAG–VDA FMEA-MSR S/F/M space."""
    s = _rating(severity, "severity")
    f = _rating(frequency, "frequency")
    m = _rating(monitoring, "monitoring")
    if m == 1 and mitigated_severity is not None:
        s = _rating(mitigated_severity, "mitigated severity")
    if s == 1 or f == 1:
        return "L"
    if s == 10:
        if f >= 5:
            return "H"
        if f == 4:
            return "H" if m >= 2 else "M"
        if f == 3:
            return "H" if m >= 4 else "M" if m >= 2 else "L"
        return "M" if m >= 4 else "L"
    if s == 9:
        if f >= 4:
            return "H"
        if f >= 2:
            return "H" if m >= 2 else "L"
        return "L"
    if s >= 7:
        if f >= 6:
            return "H"
        if f == 5:
            return "H" if m >= 6 else "M"
        if f == 4:
            return "H" if m >= 7 else "M" if m >= 4 else "L"
        if f == 3:
            return "H" if m >= 9 else "M" if m >= 7 else "L"
        return "M" if m >= 7 else "L"
    if s >= 4:
        if f >= 7:
            return "H"
        if f >= 5:
            return "H" if m >= 6 else "M"
        if f >= 2:
            return "M" if m >= 7 else "L"
        return "L"
    # S 2–3
    if f >= 7:
        return "H"
    if f >= 5:
        return "M" if m >= 7 else "L"
    return "L"


def _issue(step: int, code: str, message: str, *, severity: str = "error",
           record_id: str | None = None, field: str | None = None) -> dict:
    return {
        "step": step,
        "code": code,
        "severity": severity,
        "record_id": record_id,
        "field": field,
        "message": message,
    }


def _nonempty(value: object) -> bool:
    return bool(str(value or "").strip())


def _duplicates(values: Iterable[str]) -> set[str]:
    counts = Counter(value for value in values if value)
    return {value for value, count in counts.items() if count > 1}


def _validate_structure(analysis: Mapping, issues: list[dict]) -> None:
    kind = str(analysis["kind"])
    nodes = list(analysis.get("structure_nodes", []))
    node_ids = {str(node.get("id", "")) for node in nodes}
    for duplicate in _duplicates(str(node.get("id", "")) for node in nodes):
        issues.append(_issue(2, "duplicate_structure_id",
                             f"Structure ID '{duplicate}' is duplicated.",
                             record_id=duplicate, field="id"))
    for node in nodes:
        node_id = str(node.get("id", ""))
        parent = str(node.get("parent_id") or "")
        level = str(node.get("level", ""))
        if not _nonempty(node.get("name")):
            issues.append(_issue(
                2, "missing_structure_name",
                "Structure elements require a name.",
                record_id=node_id, field="name"))
        if level not in STRUCTURE_LEVELS[kind]:
            issues.append(_issue(
                2, "invalid_structure_level",
                f"'{level}' is not a valid {kind.upper()} structure level.",
                record_id=node_id, field="level"))
        if parent and parent not in node_ids:
            issues.append(_issue(
                2, "unknown_structure_parent",
                f"Structure parent '{parent}' does not exist.",
                record_id=node_id, field="parent_id"))
        if parent == node_id:
            issues.append(_issue(
                2, "structure_self_parent",
                "A structure element cannot be its own parent.",
                record_id=node_id, field="parent_id"))
        if (kind == "pfmea" and level == "work_element"
                and str(node.get("element_type", "")).lower() not in {
                    "man", "machine", "material", "environment",
                }):
            issues.append(_issue(
                2, "missing_4m_element_type",
                "PFMEA work elements require a Man, Machine, Material, or Environment type.",
                record_id=node_id, field="element_type"))
    by_id = {str(node.get("id")): node for node in nodes}
    for node_id in by_id:
        seen: set[str] = set()
        cursor = node_id
        while cursor and cursor in by_id:
            if cursor in seen:
                issues.append(_issue(
                    2, "structure_cycle", "Structure hierarchy contains a cycle.",
                    record_id=node_id, field="parent_id"))
                break
            seen.add(cursor)
            cursor = str(by_id[cursor].get("parent_id") or "")
    focus_level = "process_step" if kind == "pfmea" else "focus"
    if nodes and not any(str(node.get("level")) == focus_level for node in nodes):
        issues.append(_issue(
            2, "missing_focus_element",
            f"Add at least one {focus_level.replace('_', ' ')} element.",
            field="structure_nodes"))


def _validate_links(analysis: Mapping, issues: list[dict]) -> None:
    structure_ids = {str(node.get("id")) for node in analysis.get("structure_nodes", [])}
    functions = list(analysis.get("functions", []))
    function_ids = {str(item.get("id")) for item in functions}
    for duplicate in _duplicates(str(item.get("id", "")) for item in functions):
        issues.append(_issue(
            3, "duplicate_function_id", f"Function ID '{duplicate}' is duplicated.",
            record_id=duplicate, field="id"))
    for item in functions:
        item_id = str(item.get("id", ""))
        structure_id = str(item.get("structure_node_id", ""))
        if structure_id not in structure_ids:
            issues.append(_issue(
                3, "unknown_function_structure",
                f"Function references unknown structure element '{structure_id}'.",
                record_id=item_id, field="structure_node_id"))
        if not _nonempty(item.get("description")):
            issues.append(_issue(
                3, "missing_function", "Function description is required.",
                record_id=item_id, field="description"))
    for chain in analysis.get("failure_chains", []):
        chain_id = str(chain.get("id", ""))
        function_id = str(chain.get("function_id") or "")
        if function_id and function_id not in function_ids:
            issues.append(_issue(
                4, "unknown_chain_function",
                f"Failure chain references unknown function '{function_id}'.",
                record_id=chain_id, field="function_id"))


_PROGRAM_REQUIREMENT_FIELDS = {
    "statement": "statement",
    "measure": "measure",
    "target": "target",
    "confidence": "confidence",
    "mission_profile": "operating_condition",
    "failure_definition": "acceptance_criteria",
    "verification_method": "verification_method",
    "owner": "owner",
    "evidence_ids": "evidence_ids",
}


def _requirement_source_snapshot(requirement: Mapping) -> dict:
    """Return the stable Reliability Program fields copied into an FMEA."""
    return {
        target: deepcopy(requirement.get(source, [] if source == "evidence_ids" else ""))
        for source, target in _PROGRAM_REQUIREMENT_FIELDS.items()
    }


def _requirement_source_checksum(requirement: Mapping) -> str:
    payload = json.dumps(
        _requirement_source_snapshot(requirement),
        sort_keys=True, separators=(",", ":"), ensure_ascii=False,
    ).encode()
    return hashlib.sha256(payload).hexdigest()


def _validate_function_analysis(
    analysis: Mapping,
    program_requirements: Mapping[str, Mapping],
    issues: list[dict],
) -> tuple[dict, list[dict], list[dict]]:
    """Validate Step 3 and return summary, coverage rows, and source sync."""
    kind = str(analysis["kind"])
    structures = list(analysis.get("structure_nodes", []))
    functions = list(analysis.get("functions", []))
    links = list(analysis.get("function_links", []))
    requirements = list(analysis.get("functional_requirements", []))
    correlations = list(analysis.get("function_requirement_links", []))
    interfaces = list(analysis.get("interfaces", []))
    block_diagram = dict(analysis.get("block_diagram", {}))
    diagram_nodes = list(block_diagram.get("nodes", []))
    p_diagrams = list(analysis.get("p_diagrams", []))
    chains = list(analysis.get("failure_chains", []))

    structure_by_id = {str(item.get("id")): item for item in structures}
    diagram_by_id = {str(item.get("id")): item for item in diagram_nodes}
    function_by_id = {str(item.get("id")): item for item in functions}
    requirement_by_id = {
        str(item.get("id")): item for item in requirements
    }

    for collection, label, field in (
        (links, "function relationship", "function_links"),
        (requirements, "functional requirement", "functional_requirements"),
        (correlations, "function/requirement correlation",
         "function_requirement_links"),
        (interfaces, "interface", "interfaces"),
        (p_diagrams, "P-diagram", "p_diagrams"),
    ):
        for duplicate in _duplicates(str(item.get("id", "")) for item in collection):
            issues.append(_issue(
                3, f"duplicate_{field}_id",
                f"{label.title()} ID '{duplicate}' is duplicated.",
                record_id=duplicate, field="id"))

    correlations_by_function: dict[str, list[Mapping]] = {}
    correlations_by_requirement: dict[str, list[Mapping]] = {}
    for correlation in correlations:
        correlation_id = str(correlation.get("id", ""))
        function_id = str(correlation.get("function_id", ""))
        requirement_id = str(correlation.get("requirement_id", ""))
        if function_id not in function_by_id:
            issues.append(_issue(
                3, "unknown_correlation_function",
                f"Correlation references unknown function '{function_id}'.",
                record_id=correlation_id, field="function_id"))
        else:
            correlations_by_function.setdefault(function_id, []).append(correlation)
        if requirement_id not in requirement_by_id:
            issues.append(_issue(
                3, "unknown_correlation_requirement",
                f"Correlation references unknown requirement '{requirement_id}'.",
                record_id=correlation_id, field="requirement_id"))
        else:
            correlations_by_requirement.setdefault(requirement_id, []).append(
                correlation)

    decomposition: dict[str, list[str]] = {}
    for link in links:
        link_id = str(link.get("id", ""))
        source = str(link.get("source_function_id", ""))
        target = str(link.get("target_function_id", ""))
        if source not in function_by_id:
            issues.append(_issue(
                3, "unknown_function_link_source",
                f"Function relationship references unknown source '{source}'.",
                record_id=link_id, field="source_function_id"))
        if target not in function_by_id:
            issues.append(_issue(
                3, "unknown_function_link_target",
                f"Function relationship references unknown target '{target}'.",
                record_id=link_id, field="target_function_id"))
        if source and source == target:
            issues.append(_issue(
                3, "function_self_link",
                "A function cannot relate to itself.",
                record_id=link_id, field="target_function_id"))
        if (link.get("relationship") == "decomposes_to"
                and source in function_by_id and target in function_by_id
                and source != target):
            decomposition.setdefault(source, []).append(target)

    def visit(function_id: str, path: tuple[str, ...]) -> None:
        if function_id in path:
            issues.append(_issue(
                3, "function_decomposition_cycle",
                "Function decomposition must be acyclic.",
                record_id=function_id, field="function_links"))
            return
        for child in decomposition.get(function_id, []):
            visit(child, (*path, function_id))

    for function_id in function_by_id:
        visit(function_id, ())

    failure_chains_by_function: dict[str, list[str]] = {}
    for chain in chains:
        function_id = str(chain.get("function_id") or "")
        if function_id in function_by_id:
            failure_chains_by_function.setdefault(function_id, []).append(
                str(chain.get("id", "")))

    functions_by_structure: dict[str, list[str]] = {}
    for function in functions:
        function_id = str(function.get("id", ""))
        structure_id = str(function.get("structure_node_id", ""))
        if structure_id in structure_by_id:
            functions_by_structure.setdefault(structure_id, []).append(function_id)
        description = str(function.get("description", "")).strip()
        if description and len(description.split()) < 2:
            issues.append(_issue(
                3, "weak_function_phrase",
                "Use a concise verb–noun phrase so the intended function is unambiguous.",
                severity="warning", record_id=function_id, field="description"))
        if (function.get("function_type") == "primary"
                and not correlations_by_function.get(function_id)):
            issues.append(_issue(
                3, "primary_function_without_requirement",
                "Primary functions require at least one correlated requirement.",
                severity="warning", record_id=function_id,
                field="function_requirement_links"))
        if not failure_chains_by_function.get(function_id):
            issues.append(_issue(
                3, "function_without_failure_chain",
                "No failure chain currently traces to this function.",
                severity="warning", record_id=function_id,
                field="failure_chains"))

    focus_level = "process_step" if kind == "pfmea" else "focus"
    for structure in structures:
        structure_id = str(structure.get("id", ""))
        if functions_by_structure.get(structure_id):
            continue
        blocking = str(structure.get("level")) == focus_level
        issues.append(_issue(
            3,
            "focus_without_function" if blocking else
            "structure_without_function",
            f"{str(structure.get('level', 'Structure')).replace('_', ' ').title()} "
            "has no allocated function.",
            severity="error" if blocking else "warning",
            record_id=structure_id, field="functions"))

    requirement_sync: list[dict] = []
    for requirement in requirements:
        requirement_id = str(requirement.get("id", ""))
        if not _nonempty(requirement.get("statement")):
            issues.append(_issue(
                3, "missing_requirement_statement",
                "Functional requirements require a statement.",
                record_id=requirement_id, field="statement"))
        if not correlations_by_requirement.get(requirement_id):
            issues.append(_issue(
                3, "orphan_function_requirement",
                "Requirement is not correlated to any function.",
                severity="warning", record_id=requirement_id,
                field="function_requirement_links"))
        if (not _nonempty(requirement.get("measure"))
                or (not _nonempty(requirement.get("target"))
                    and not _nonempty(requirement.get("acceptance_criteria")))):
            issues.append(_issue(
                3, "nonmeasurable_function_requirement",
                "Document a measure and target or acceptance criterion.",
                severity="warning", record_id=requirement_id,
                field="measure"))
        if not _nonempty(requirement.get("verification_method")):
            issues.append(_issue(
                3, "missing_requirement_verification",
                "Identify how the requirement will be verified.",
                severity="warning", record_id=requirement_id,
                field="verification_method"))
        if not _nonempty(requirement.get("source")) and not requirement.get(
                "linked_program_requirement_id"):
            issues.append(_issue(
                3, "missing_requirement_source",
                "Identify the requirement source.",
                severity="warning", record_id=requirement_id, field="source"))

        source_id = str(requirement.get("linked_program_requirement_id") or "")
        if not source_id:
            requirement_sync.append({
                "requirement_id": requirement_id,
                "source_id": None,
                "status": "local",
                "stored_checksum": None,
                "current_checksum": None,
                "differences": [],
            })
            continue
        source = program_requirements.get(source_id)
        if source is None:
            issues.append(_issue(
                3, "unknown_program_requirement",
                f"Linked Reliability Program requirement '{source_id}' is unavailable.",
                record_id=requirement_id, field="linked_program_requirement_id"))
            requirement_sync.append({
                "requirement_id": requirement_id,
                "source_id": source_id,
                "status": "missing_source",
                "stored_checksum": requirement.get("source_checksum"),
                "current_checksum": None,
                "differences": [],
            })
            continue
        current_checksum = _requirement_source_checksum(source)
        stored_checksum = str(requirement.get("source_checksum") or "")
        snapshot = _requirement_source_snapshot(source)
        differences = [{
            "field": field,
            "snapshot": deepcopy(requirement.get(field, [] if field == "evidence_ids" else "")),
            "source": deepcopy(value),
        } for field, value in snapshot.items()
            if requirement.get(field, [] if field == "evidence_ids" else "") != value]
        status = (
            "unbaselined" if not stored_checksum else
            "in_sync" if stored_checksum == current_checksum and not differences
            else "stale"
        )
        if status == "unbaselined":
            issues.append(_issue(
                3, "unbaselined_linked_requirement",
                "Linked requirement has no source checksum; review and synchronize it.",
                severity="warning", record_id=requirement_id,
                field="source_checksum"))
        elif status == "stale":
            issues.append(_issue(
                3, "stale_linked_requirement",
                "Linked Reliability Program requirement changed; review the source diff.",
                severity="warning", record_id=requirement_id,
                field="source_checksum"))
        requirement_sync.append({
            "requirement_id": requirement_id,
            "source_id": source_id,
            "status": status,
            "stored_checksum": stored_checksum or None,
            "current_checksum": current_checksum,
            "differences": differences,
        })

    interfaces_by_structure: dict[str, list[str]] = {}
    interfaces_by_function: dict[str, list[str]] = {}
    for duplicate in _duplicates(
            str(item.get("id", "")) for item in diagram_nodes):
        issues.append(_issue(
            2, "duplicate_diagram_block_id",
            f"Block Diagram ID '{duplicate}' is duplicated.",
            record_id=duplicate, field="id"))
    structure_occurrences: dict[str, list[str]] = {}
    for block in diagram_nodes:
        if str(block.get("kind") or "") != "structure":
            continue
        structure_id = str(block.get("structure_node_id") or "")
        structure_occurrences.setdefault(structure_id, []).append(
            str(block.get("id") or ""))
    for structure_id, block_ids in structure_occurrences.items():
        if structure_id and len(block_ids) > 1:
            issues.append(_issue(
                2, "duplicate_structure_diagram_occurrence",
                f"Structure item '{structure_id}' appears more than once in "
                "the Block Diagram.",
                record_id=structure_id, field="structure_node_id"))

    for block in diagram_nodes:
        block_id = str(block.get("id") or "")
        kind = str(block.get("kind") or "")
        structure_id = str(block.get("structure_node_id") or "")
        container_id = str(block.get("container_parent_block_id") or "")
        if kind == "structure":
            if not structure_id:
                issues.append(_issue(
                    2, "diagram_block_without_structure",
                    "An internal block must reference a Structure Analysis item.",
                    record_id=block_id, field="structure_node_id"))
            elif structure_id not in structure_by_id:
                issues.append(_issue(
                    2, "diagram_block_unknown_structure",
                    f"Block Diagram item references unknown structure "
                    f"'{structure_id}'.",
                    record_id=block_id, field="structure_node_id"))
            if container_id:
                container = diagram_by_id.get(container_id)
                container_structure_id = str(
                    (container or {}).get("structure_node_id") or "")
                expected_parent_id = str(
                    structure_by_id.get(structure_id, {}).get("parent_id")
                    or "")
                if container is None:
                    issues.append(_issue(
                        2, "diagram_container_missing",
                        f"Block Diagram item references missing parent "
                        f"container '{container_id}'.",
                        record_id=block_id,
                        field="container_parent_block_id"))
                elif (str(container.get("kind") or "") != "structure"
                      or container_structure_id != expected_parent_id):
                    issues.append(_issue(
                        2, "diagram_container_mismatch",
                        "Visual containment must match the direct Structure "
                        "Analysis parent.",
                        record_id=block_id,
                        field="container_parent_block_id"))
                elif bool(block.get("inside_boundary")) != bool(
                        container.get("inside_boundary")):
                    issues.append(_issue(
                        2, "diagram_container_scope_mismatch",
                        "A contained Block Diagram item must inherit its "
                        "parent's analysis-boundary scope.",
                        record_id=block_id,
                        field="inside_boundary"))
        elif kind == "external" and not _nonempty(block.get("label")):
            issues.append(_issue(
                2, "unnamed_external_diagram_block",
                "External Block Diagram items require a descriptive name.",
                severity="warning", record_id=block_id, field="label"))

        visited: set[str] = set()
        current_id = block_id
        while current_id:
            if current_id in visited:
                issues.append(_issue(
                    2, "diagram_container_cycle",
                    "Block Diagram containment contains a cycle.",
                    record_id=block_id,
                    field="container_parent_block_id"))
                break
            visited.add(current_id)
            current = diagram_by_id.get(current_id)
            current_id = str(
                (current or {}).get("container_parent_block_id") or "")

    for interface in interfaces:
        interface_id = str(interface.get("id", ""))
        source_block_id = str(interface.get("source_block_id") or "")
        target_block_id = str(interface.get("target_block_id") or "")
        source_block = diagram_by_id.get(source_block_id)
        target_block = diagram_by_id.get(target_block_id)
        source_id = str(interface.get("source_structure_node_id") or "")
        target_id = str(interface.get("target_structure_node_id") or "")
        external_source = str(interface.get("external_source") or "").strip()
        external_target = str(interface.get("external_target") or "").strip()
        if source_block_id or target_block_id:
            if source_block is None:
                issues.append(_issue(
                    3, "unknown_interface_source_block",
                    f"Interface references unknown source diagram block "
                    f"'{source_block_id or '(missing)'}'.",
                    record_id=interface_id, field="source_block_id"))
            if target_block is None:
                issues.append(_issue(
                    3, "unknown_interface_target_block",
                    f"Interface references unknown destination diagram block "
                    f"'{target_block_id or '(missing)'}'.",
                    record_id=interface_id, field="target_block_id"))
            if source_block is not None:
                if str(source_block.get("kind")) == "structure":
                    source_id = str(source_block.get("structure_node_id") or "")
                    external_source = ""
                else:
                    source_id = ""
                    external_source = str(source_block.get("label") or "").strip()
            if target_block is not None:
                if str(target_block.get("kind")) == "structure":
                    target_id = str(target_block.get("structure_node_id") or "")
                    external_target = ""
                else:
                    target_id = ""
                    external_target = str(target_block.get("label") or "").strip()
            if source_block_id and source_block_id == target_block_id:
                issues.append(_issue(
                    3, "interface_self_connection",
                    "An interface must connect two different diagram blocks.",
                    record_id=interface_id, field="target_block_id"))
            if (source_block is not None and target_block is not None
                    and str(source_block.get("kind")) == "external"
                    and str(target_block.get("kind")) == "external"):
                issues.append(_issue(
                    3, "external_only_interface",
                    "An FMEA interface must involve at least one structure block.",
                    record_id=interface_id, field="source_block_id"))
        else:
            if bool(source_id) == bool(external_source):
                issues.append(_issue(
                    3, "invalid_interface_source",
                    "Choose exactly one internal or external interface source.",
                    record_id=interface_id, field="source_structure_node_id"))
            if bool(target_id) == bool(external_target):
                issues.append(_issue(
                    3, "invalid_interface_target",
                    "Choose exactly one internal or external interface target.",
                    record_id=interface_id, field="target_structure_node_id"))
        if source_id and source_id not in structure_by_id:
            issues.append(_issue(
                3, "unknown_interface_source",
                f"Interface references unknown source structure '{source_id}'.",
                record_id=interface_id, field="source_structure_node_id"))
        if target_id and target_id not in structure_by_id:
            issues.append(_issue(
                3, "unknown_interface_target",
                f"Interface references unknown target structure '{target_id}'.",
                record_id=interface_id, field="target_structure_node_id"))
        if (not source_block_id and not target_block_id
                and source_id and source_id == target_id):
            issues.append(_issue(
                3, "interface_self_connection",
                "An internal interface must connect two different structure elements.",
                record_id=interface_id, field="target_structure_node_id"))
        for structure_id in (source_id, target_id):
            if structure_id in structure_by_id:
                interfaces_by_structure.setdefault(structure_id, []).append(
                    interface_id)
        for function_id in interface.get("function_ids", []):
            function_id = str(function_id)
            if function_id not in function_by_id:
                issues.append(_issue(
                    3, "unknown_interface_function",
                    f"Interface references unknown function '{function_id}'.",
                    record_id=interface_id, field="function_ids"))
            else:
                interfaces_by_function.setdefault(function_id, []).append(
                    interface_id)
        for requirement_id in interface.get("requirement_ids", []):
            if str(requirement_id) not in requirement_by_id:
                issues.append(_issue(
                    3, "unknown_interface_requirement",
                    f"Interface references unknown requirement '{requirement_id}'.",
                    record_id=interface_id, field="requirement_ids"))
        if not _nonempty(interface.get("name")) or not _nonempty(
                interface.get("flow_description")):
            issues.append(_issue(
                3, "incomplete_interface_definition",
                "Interfaces should name the connection and describe what flows.",
                severity="warning", record_id=interface_id, field="name"))

    for function in functions:
        if (function.get("function_type") == "interface"
                and not interfaces_by_function.get(str(function.get("id")))):
            issues.append(_issue(
                3, "interface_function_without_interface",
                "Interface functions should reference a structured interface.",
                severity="warning", record_id=str(function.get("id")),
                field="interfaces"))

    if functions and not p_diagrams:
        issues.append(_issue(
            3, "missing_p_diagram",
            "Consider a P-diagram to review signals, outputs, controls, noise, and error states.",
            severity="warning", field="p_diagrams"))
    for diagram in p_diagrams:
        diagram_id = str(diagram.get("id", ""))
        primary_id = str(diagram.get("primary_function_id", ""))
        if primary_id not in function_by_id:
            issues.append(_issue(
                3, "unknown_p_diagram_function",
                f"P-diagram references unknown primary function '{primary_id}'.",
                record_id=diagram_id, field="primary_function_id"))
        for function_id in diagram.get("supporting_function_ids", []):
            if str(function_id) not in function_by_id:
                issues.append(_issue(
                    3, "unknown_p_diagram_supporting_function",
                    f"P-diagram references unknown supporting function '{function_id}'.",
                    record_id=diagram_id, field="supporting_function_ids"))
        categories = {str(item.get("category")) for item in diagram.get("items", [])}
        for item in diagram.get("items", []):
            item_id = str(item.get("id", ""))
            if not _nonempty(item.get("label")):
                issues.append(_issue(
                    3, "blank_p_diagram_item",
                    "P-diagram items require a concise label.",
                    severity="warning", record_id=item_id, field="label"))
            for requirement_id in item.get("requirement_ids", []):
                if str(requirement_id) not in requirement_by_id:
                    issues.append(_issue(
                        3, "unknown_p_diagram_requirement",
                        f"P-diagram item references unknown requirement '{requirement_id}'.",
                        record_id=item_id, field="requirement_ids"))
        expected_categories = {
            "signal_input", "intended_output", "control_factor",
            "noise_factor", "error_state",
        }
        if missing := sorted(expected_categories - categories):
            issues.append(_issue(
                3, "incomplete_p_diagram",
                f"P-diagram is missing: {', '.join(value.replace('_', ' ') for value in missing)}.",
                severity="warning", record_id=diagram_id, field="items"))

    if kind == "pfmea":
        for function in functions:
            structure = structure_by_id.get(
                str(function.get("structure_node_id")), {})
            if str(structure.get("level")) != "process_step":
                continue
            linked_requirement_ids = {
                str(item.get("requirement_id"))
                for item in correlations_by_function.get(
                    str(function.get("id")), [])
            }
            linked_types = {
                str(requirement_by_id[item].get("requirement_type"))
                for item in linked_requirement_ids if item in requirement_by_id
            }
            if not linked_types.intersection(
                    {"performance", "process", "customer", "safety", "regulatory"}):
                issues.append(_issue(
                    3, "missing_pfmea_characteristic",
                    "PFMEA process-step functions should identify a product or process characteristic.",
                    severity="warning", record_id=str(function.get("id")),
                    field="functional_requirements"))
    if kind == "fmea_msr" and functions:
        present_types = {str(item.get("function_type")) for item in functions}
        for required_type, label in (
            ("monitoring", "monitoring"),
            ("system_response", "system-response"),
        ):
            if required_type not in present_types:
                issues.append(_issue(
                    3, f"missing_msr_{required_type}_function",
                    f"FMEA-MSR should identify at least one {label} function.",
                    severity="warning", field="functions"))

    coverage = []
    for structure in structures:
        structure_id = str(structure.get("id", ""))
        function_ids = functions_by_structure.get(structure_id, [])
        requirement_ids = sorted({
            str(correlation.get("requirement_id"))
            for function_id in function_ids
            for correlation in correlations_by_function.get(function_id, [])
            if str(correlation.get("requirement_id")) in requirement_by_id
        })
        failure_ids = sorted({
            chain_id for function_id in function_ids
            for chain_id in failure_chains_by_function.get(function_id, [])
        })
        interface_ids = sorted(set(interfaces_by_structure.get(structure_id, [])))
        gaps = []
        if not function_ids:
            gaps.append("function")
        if function_ids and not requirement_ids:
            gaps.append("requirement")
        if function_ids and not failure_ids:
            gaps.append("failure chain")
        if str(structure.get("interface") or "").strip() and not interface_ids:
            gaps.append("structured interface")
        coverage.append({
            "structure_node_id": structure_id,
            "structure_name": str(structure.get("name") or ""),
            "level": str(structure.get("level") or ""),
            "function_ids": function_ids,
            "requirement_ids": requirement_ids,
            "interface_ids": interface_ids,
            "failure_chain_ids": failure_ids,
            "gaps": gaps,
        })

    summary = {
        "functions": len(functions),
        "primary_functions": sum(
            item.get("function_type") == "primary" for item in functions),
        "requirements": len(requirements),
        "correlations": len(correlations),
        "interfaces": len(interfaces),
        "p_diagrams": len(p_diagrams),
        "structures_with_functions": sum(
            bool(item["function_ids"]) for item in coverage),
        "structures_total": len(coverage),
        "functions_with_requirements": sum(
            bool(correlations_by_function.get(str(item.get("id"))))
            for item in functions),
        "functions_with_failure_chains": sum(
            bool(failure_chains_by_function.get(str(item.get("id"))))
            for item in functions),
        "stale_requirement_links": sum(
            item["status"] in {"stale", "unbaselined", "missing_source"}
            for item in requirement_sync),
        "coverage_gaps": sum(len(item["gaps"]) for item in coverage),
    }
    return summary, coverage, requirement_sync


def _validate_planning(analysis: Mapping, issues: list[dict]) -> None:
    planning = analysis.get("planning", {}) or {}
    required = {
        "subject": "Define the analysis subject.",
        "scope": "Define what is included in the analysis.",
        "intent": "Record the analysis intent.",
    }
    for field, message in required.items():
        if not _nonempty(planning.get(field)):
            issues.append(_issue(
                1, f"missing_{field}", message,
                severity="warning", field=field))
    if not planning.get("team"):
        issues.append(_issue(
            1, "missing_team", "Identify at least one cross-functional team member.",
            severity="warning", field="team"))
    foundation = (
        planning.get("foundation_source_id"),
        planning.get("foundation_source_revision"),
        planning.get("foundation_checksum"),
    )
    if any(_nonempty(value) for value in foundation) and not all(
            _nonempty(value) for value in foundation):
        issues.append(_issue(
            1, "incomplete_foundation_provenance",
            "Foundation records require source ID, revision, and checksum.",
            field="foundation_source_id"))


def _validate_custom_profile(profile: Mapping) -> None:
    kind = str(profile.get("kind", ""))
    if kind not in AIAG_KINDS:
        raise ValueError("Custom rating profile kind is invalid.")
    required_axes = (
        {"severity", "frequency", "monitoring"}
        if kind == "fmea_msr"
        else {"severity", "occurrence", "detection"}
    )
    axes = profile.get("rating_axes", {}) or {}
    if set(axes) != required_axes:
        raise ValueError(
            f"Rating profile '{profile.get('id')}' requires exactly "
            f"{', '.join(sorted(required_axes))}.")
    for name, criteria in axes.items():
        ratings = [_rating(item.get("rating"), f"{name} rating")
                   for item in criteria]
        if len(ratings) != 10 or set(ratings) != set(range(1, 11)):
            raise ValueError(
                f"Rating profile '{profile.get('id')}' axis '{name}' must "
                "define each rating 1–10 exactly once.")
        if any(not _nonempty(item.get("label"))
               or not _nonempty(item.get("description"))
               for item in criteria):
            raise ValueError(
                f"Rating profile '{profile.get('id')}' axis '{name}' "
                "requires a label and description for every rating.")
    expected_model = (
        "aiag_vda_sfm_2019" if kind == "fmea_msr"
        else "aiag_vda_sod_2019"
    )
    if profile.get("ap_model") != expected_model:
        raise ValueError(
            f"Rating profile '{profile.get('id')}' must use {expected_model}.")
    if not _nonempty(profile.get("version")):
        raise ValueError("Custom rating profiles require a version.")


def _action_issues(chain: Mapping, actions: list[Mapping], ap: str,
                   issues: list[dict]) -> None:
    chain_id = str(chain.get("id", ""))
    justification = str(chain.get("no_action_justification", "")).strip()
    substantive_actions = [
        action for action in actions if _nonempty(action.get("description"))
    ]
    if ap == "H" and not substantive_actions and not justification:
        issues.append(_issue(
            6, "high_ap_without_disposition",
            "High Action Priority requires an action or approved no-action justification.",
            record_id=chain_id, field="actions"))
    elif ap == "M" and not substantive_actions and not justification:
        issues.append(_issue(
            6, "medium_ap_without_disposition",
            "Medium Action Priority should receive an action or documented disposition.",
            severity="warning", record_id=chain_id, field="actions"))
    today = date.today()
    for action in actions:
        action_id = str(action.get("id", ""))
        status = str(action.get("status", "open"))
        if status not in ACTION_STATUSES:
            issues.append(_issue(
                6, "invalid_action_status", f"Unknown action status '{status}'.",
                record_id=action_id, field="status"))
        if not _nonempty(action.get("description")):
            issues.append(_issue(
                6, "missing_action_description", "Actions require a description.",
                record_id=action_id, field="description"))
        if status not in {"open", "not_implemented"} and not _nonempty(action.get("owner")):
            issues.append(_issue(
                6, "missing_action_owner", "A decided action requires an owner.",
                record_id=action_id, field="owner"))
        if status in {"decision_pending", "implementation_pending"}:
            target = action.get("target_date")
            if not target:
                issues.append(_issue(
                    6, "missing_target_date", "A pending action requires a target date.",
                    record_id=action_id, field="target_date"))
            else:
                try:
                    if date.fromisoformat(str(target)) < today:
                        issues.append(_issue(
                            6, "overdue_action", "The action target date has passed.",
                            severity="warning", record_id=action_id,
                            field="target_date"))
                except ValueError:
                    issues.append(_issue(
                        6, "invalid_target_date", "Use an ISO date (YYYY-MM-DD).",
                        record_id=action_id, field="target_date"))
        if status == "completed":
            if not action.get("evidence_ids"):
                issues.append(_issue(
                    6, "completed_action_without_evidence",
                    "A completed action requires effectiveness evidence.",
                    record_id=action_id, field="evidence_ids"))
            if not action.get("completion_date"):
                issues.append(_issue(
                    6, "completed_action_without_date",
                    "A completed action requires an actual completion date.",
                    record_id=action_id, field="completion_date"))
        if status == "not_implemented" and not _nonempty(action.get("decision_rationale")):
            issues.append(_issue(
                6, "unimplemented_without_rationale",
                "A not-implemented action requires the decision rationale.",
                record_id=action_id, field="decision_rationale"))


def _evaluate_chain(kind: str, chain: Mapping, issues: list[dict]) -> dict:
    chain_id = str(chain.get("id", ""))
    for field in ("effect", "failure_mode", "cause"):
        if not _nonempty(chain.get(field)):
            issues.append(_issue(
                4, f"missing_{field}", f"Failure chain {field.replace('_', ' ')} is required.",
                record_id=chain_id, field=field))
    s = _rating(chain.get("severity"), "severity")
    effect_contexts = list(chain.get("effect_contexts", []))
    if effect_contexts:
        context_ratings = []
        for context in effect_contexts:
            context_id = str(context.get("id", ""))
            if not _nonempty(context.get("context")) or not _nonempty(
                    context.get("description")):
                issues.append(_issue(
                    4, "incomplete_effect_context",
                    "Effect contexts require a stakeholder/level and effect description.",
                    record_id=context_id or chain_id, field="effect_contexts"))
            context_ratings.append(
                _rating(context.get("severity"), "effect-context severity"))
        if context_ratings and s != max(context_ratings):
            issues.append(_issue(
                5, "severity_not_most_severe_effect",
                "The chain severity must equal the highest recorded effect-context severity.",
                record_id=chain_id, field="severity"))
    if kind == "fmea_msr":
        second_name, third_name = "frequency", "monitoring"
        second = _rating(chain.get(second_name), second_name)
        third = _rating(chain.get(third_name), third_name)
        mitigated_severity = chain.get("mitigated_severity")
        if third == 1:
            if mitigated_severity is None or not _nonempty(
                    chain.get("mitigated_effect")):
                issues.append(_issue(
                    5, "missing_mitigated_effect",
                    "Monitoring rating 1 requires the effect and severity after system response.",
                    record_id=chain_id, field="mitigated_severity"))
            effective_severity = (
                s if mitigated_severity is None
                else _rating(mitigated_severity, "mitigated severity")
            )
        else:
            effective_severity = s
        ap = action_priority_sfm(
            s, second, third,
            mitigated_severity=effective_severity if third == 1 else None)
    else:
        second_name, third_name = "occurrence", "detection"
        second = _rating(chain.get(second_name), second_name)
        third = _rating(chain.get(third_name), third_name)
        ap = action_priority_sod(s, second, third)
    for field in ("severity_rationale", f"{second_name}_rationale",
                  f"{third_name}_rationale"):
        if not _nonempty(chain.get(field)):
            issues.append(_issue(
                5, "missing_rating_rationale",
                f"Document the basis for {field.replace('_rationale', '').replace('_', ' ')}.",
                severity="warning", record_id=chain_id, field=field))
    actions = list(chain.get("actions", []))
    _action_issues(chain, actions, ap, issues)
    if s >= 9 and ap in {"H", "M"} and str(
            chain.get("management_review_status", "")).lower() not in {
                "reviewed", "approved",
            }:
        issues.append(_issue(
            6, "management_review_recommended",
            "Severity 9–10 with High/Medium AP should record management review.",
            severity="warning", record_id=chain_id,
            field="management_review_status"))

    post_values = [
        chain.get("post_severity"),
        chain.get(f"post_{second_name}"),
        chain.get(f"post_{third_name}"),
    ]
    post_ap = None
    if any(value is not None for value in post_values):
        if any(value is None for value in post_values):
            issues.append(_issue(
                6, "partial_post_action_rating",
                "Enter all post-action ratings together.",
                record_id=chain_id, field="post_ratings"))
        else:
            ps = _rating(post_values[0], "post severity")
            p2 = _rating(post_values[1], f"post {second_name}")
            p3 = _rating(post_values[2], f"post {third_name}")
            if kind == "fmea_msr":
                post_mitigated = chain.get("post_mitigated_severity")
                if p3 == 1 and post_mitigated is None:
                    issues.append(_issue(
                        6, "missing_post_mitigated_severity",
                        "Post-action monitoring rating 1 requires post-action mitigated severity.",
                        record_id=chain_id, field="post_mitigated_severity"))
                post_ap = action_priority_sfm(
                    ps, p2, p3,
                    mitigated_severity=post_mitigated if p3 == 1 else None)
            else:
                post_ap = action_priority_sod(ps, p2, p3)
            if ps != s and not _nonempty(chain.get("post_severity_rationale")):
                issues.append(_issue(
                    6, "severity_change_without_rationale",
                    "A post-action severity change requires a design/effect rationale.",
                    record_id=chain_id, field="post_severity_rationale"))
            if not any(str(action.get("status")) == "completed" for action in actions):
                issues.append(_issue(
                    6, "post_rating_before_effectiveness",
                    "Post-action ratings are preliminary until an action is completed and verified.",
                    severity="warning", record_id=chain_id, field="post_ratings"))
    return {
        **chain,
        "severity": s,
        second_name: second,
        third_name: third,
        "action_priority": ap,
        "action_priority_severity": effective_severity
        if kind == "fmea_msr" else s,
        "post_action_priority": post_ap,
        "action_priority_meaning": {
            "H": "highest priority for review and action",
            "M": "medium priority for review and action",
            "L": "low priority for review and action",
        }[ap],
    }


def _control_plan_issues(analysis: Mapping, chain_ids: set[str],
                         issues: list[dict]) -> None:
    if analysis["kind"] != "pfmea":
        return
    rows = list(analysis.get("control_plan", []))
    for row in rows:
        row_id = str(row.get("id", ""))
        chain_id = str(row.get("failure_chain_id") or "")
        if chain_id and chain_id not in chain_ids:
            issues.append(_issue(
                6, "unknown_control_plan_chain",
                f"Control Plan row references unknown failure chain '{chain_id}'.",
                record_id=row_id, field="failure_chain_id"))
        if not _nonempty(row.get("reaction_plan")):
            issues.append(_issue(
                6, "missing_reaction_plan",
                "Control Plan rows require a reaction plan.",
                severity="warning", record_id=row_id, field="reaction_plan"))
        if bool(row.get("stale")):
            issues.append(_issue(
                6, "stale_control_plan_row",
                "The linked PFMEA content changed; review this Control Plan row.",
                record_id=row_id, field="stale"))


def _control_plan_review(analysis: Mapping, chains: list[dict]) -> list[dict]:
    """Build a non-destructive PFMEA → Control Plan change set."""
    if analysis["kind"] != "pfmea":
        return []
    functions = {
        str(item.get("id")): item for item in analysis.get("functions", [])
    }
    structures = {
        str(item.get("id")): item for item in analysis.get("structure_nodes", [])
    }
    existing = {
        str(item.get("failure_chain_id")): item
        for item in analysis.get("control_plan", [])
        if item.get("failure_chain_id")
    }
    review = []
    compared_fields = (
        "process_step", "product_characteristic", "process_characteristic",
        "specification", "measurement_method", "control_method",
        "responsibility", "special_characteristic",
    )
    for chain in chains:
        chain_id = str(chain.get("id"))
        function = functions.get(str(chain.get("function_id") or ""), {})
        structure = structures.get(str(function.get("structure_node_id") or ""), {})
        owners = sorted({
            str(action.get("owner")).strip()
            for action in chain.get("actions", [])
            if str(action.get("owner") or "").strip()
        })
        proposal = {
            "id": f"CP-{chain_id}",
            "failure_chain_id": chain_id,
            "process_step": str(structure.get("name") or ""),
            "product_characteristic": str(
                function.get("characteristic_type") or chain.get("failure_mode") or ""),
            "process_characteristic": str(chain.get("cause") or ""),
            "specification": str(function.get("specification") or ""),
            "measurement_method": str(chain.get("detection_controls") or ""),
            "sample_size": "",
            "frequency": "",
            "control_method": str(chain.get("prevention_controls") or ""),
            "reaction_plan": "",
            "responsibility": ", ".join(owners),
            "special_characteristic": str(chain.get("effect_level") or ""),
            "source_revision": str(analysis.get("revision") or ""),
            "stale": False,
        }
        current = existing.get(chain_id)
        differences = [
            {
                "field": field,
                "current": str(current.get(field) or "") if current else "",
                "proposed": proposal[field],
            }
            for field in compared_fields
            if not current or str(current.get(field) or "") != proposal[field]
        ]
        review.append({
            "failure_chain_id": chain_id,
            "status": "missing" if current is None else
                      "different" if differences else "in_sync",
            "differences": differences,
            "proposal": {
                **proposal,
                # Never overwrite fields that require an explicit Control Plan
                # decision when accepting a PFMEA-derived update.
                "id": str(current.get("id")) if current else proposal["id"],
                "sample_size": str(current.get("sample_size") or "") if current else "",
                "frequency": str(current.get("frequency") or "") if current else "",
                "reaction_plan": str(current.get("reaction_plan") or "") if current else "",
            },
        })
    return review


def analyze_aiag_vda_fmea(
    analyses: Iterable[Mapping],
    *,
    rating_profiles: Iterable[Mapping] = (),
    program_requirements: Iterable[Mapping] = (),
) -> dict:
    """Evaluate AIAG–VDA analyses without mutating caller-owned records."""
    builtins = {profile["id"]: profile for profile in builtin_rating_profiles()}
    profiles = dict(builtins)
    for raw in rating_profiles:
        profile = deepcopy(dict(raw))
        profile_id = str(profile.get("id", "")).strip()
        if not profile_id:
            raise ValueError("Custom rating profiles require an ID.")
        if profile_id in builtins:
            raise ValueError(
                f"Rating profile ID '{profile_id}' is reserved by Perdura.")
        if bool(profile.get("built_in")):
            raise ValueError("Custom rating profiles cannot claim built-in status.")
        if bool(profile.get("approved")) and (
                not _nonempty(profile.get("approved_by"))
                or not _nonempty(profile.get("approved_date"))):
            raise ValueError(
                f"Approved rating profile '{profile_id}' requires approver and date.")
        _validate_custom_profile(profile)
        expected = profile.pop("checksum", None)
        checksum = _canonical_checksum(profile)
        if expected and expected != checksum:
            raise ValueError(
                f"Rating profile '{profile_id}' checksum does not match its contents.")
        profile["checksum"] = checksum
        profiles[profile_id] = profile

    raw_analyses = [deepcopy(dict(item)) for item in analyses]
    requirement_records = {
        str(item.get("id")): deepcopy(dict(item))
        for item in program_requirements if item.get("id")
    }
    ids = [str(item.get("id", "")) for item in raw_analyses]
    if any(not item for item in ids) or len(ids) != len(set(ids)):
        raise ValueError("AIAG–VDA FMEA analysis IDs must be non-empty and unique.")
    revisions = {str(item["id"]): str(item.get("revision", "")) for item in raw_analyses}
    output = []
    all_issues: list[dict] = []
    for analysis in raw_analyses:
        analysis_id = str(analysis["id"])
        kind = str(analysis.get("kind", ""))
        if kind not in AIAG_KINDS:
            raise ValueError(
                "AIAG–VDA analysis kind must be dfmea, pfmea, or fmea_msr.")
        issues: list[dict] = []
        profile_id = str(analysis.get("rating_profile_id") or {
            "dfmea": "aiag_vda_dfmea_public_v1",
            "pfmea": "aiag_vda_pfmea_public_v1",
            "fmea_msr": "aiag_vda_msr_public_v1",
        }[kind])
        profile = profiles.get(profile_id)
        if not profile:
            issues.append(_issue(
                5, "unknown_rating_profile",
                f"Rating profile '{profile_id}' is unavailable.",
                field="rating_profile_id"))
        elif profile.get("kind") != kind:
            issues.append(_issue(
                5, "rating_profile_kind_mismatch",
                f"Rating profile '{profile_id}' is for {profile.get('kind')}, not {kind}.",
                field="rating_profile_id"))
        elif not bool(profile.get("approved")):
            issues.append(_issue(
                5, "unapproved_rating_profile",
                f"Rating profile '{profile_id}' is not approved.",
                field="rating_profile_id"))

        _validate_planning(analysis, issues)
        template_values = (
            analysis.get("template_source_id"),
            analysis.get("template_source_revision"),
            analysis.get("template_source_checksum"),
        )
        if any(_nonempty(value) for value in template_values) and not all(
                _nonempty(value) for value in template_values):
            issues.append(_issue(
                1, "incomplete_template_provenance",
                "Foundation/template copies require source ID, revision, and checksum.",
                field="template_source_id"))
        _validate_structure(analysis, issues)
        _validate_links(analysis, issues)
        function_summary, function_coverage, requirement_sync = (
            _validate_function_analysis(
                analysis, requirement_records, issues))
        chains = []
        for chain in analysis.get("failure_chains", []):
            try:
                chains.append(_evaluate_chain(kind, chain, issues))
            except ValueError as exc:
                issues.append(_issue(
                    5, "invalid_rating", str(exc),
                    record_id=str(chain.get("id", "")), field="ratings"))
        _control_plan_issues(
            analysis, {str(chain.get("id")) for chain in chains}, issues)

        if kind == "fmea_msr":
            parent_id = str(analysis.get("parent_dfmea_id") or "")
            if parent_id:
                parent = next((item for item in raw_analyses
                               if str(item["id"]) == parent_id), None)
                if not parent or parent.get("kind") != "dfmea":
                    issues.append(_issue(
                        1, "invalid_msr_parent",
                        "FMEA-MSR parent must reference a DFMEA in this program.",
                        field="parent_dfmea_id"))
                elif (analysis.get("source_revision")
                      and str(analysis.get("source_revision")) != revisions[parent_id]):
                    issues.append(_issue(
                        4, "stale_msr_source",
                        "The source DFMEA revision changed; review the linked MSR chains.",
                        field="source_revision"))
            elif not _nonempty(analysis.get("standalone_justification")):
                issues.append(_issue(
                    1, "unjustified_standalone_msr",
                    "Standalone FMEA-MSR requires an explicit scope justification.",
                    field="standalone_justification"))

        if not analysis.get("structure_nodes"):
            issues.append(_issue(
                2, "empty_structure", "Add at least one structure element.",
                field="structure_nodes"))
        if not analysis.get("functions"):
            issues.append(_issue(
                3, "empty_functions", "Add at least one function.",
                field="functions"))
        if not analysis.get("failure_chains"):
            issues.append(_issue(
                4, "empty_failure_chains", "Add at least one failure chain.",
                field="failure_chains"))
        if str(analysis.get("status")) == "finalized" and any(
                item["severity"] == "error" for item in issues):
            issues.append(_issue(
                7, "invalid_finalization",
                "This revision cannot be finalized until all blocking findings are resolved.",
                field="status"))

        by_step = {
            step: [item for item in issues if item["step"] == step]
            for step in range(1, 8)
        }
        step_readiness = [{
            "step": step,
            "ready": not any(item["severity"] == "error" for item in by_step[step]),
            "errors": sum(item["severity"] == "error" for item in by_step[step]),
            "warnings": sum(item["severity"] == "warning" for item in by_step[step]),
        } for step in range(1, 8)]
        counts = Counter(row["action_priority"] for row in chains)
        post_counts = Counter(
            row["post_action_priority"] for row in chains
            if row["post_action_priority"])
        finalization_ready = not any(
            issue["severity"] == "error" for issue in issues)
        result = {
            **analysis,
            "rating_profile_id": profile_id,
            "rating_profile": {
                "id": profile_id,
                "name": profile.get("name") if profile else "Unavailable",
                "version": profile.get("version") if profile else None,
                "checksum": profile.get("checksum") if profile else None,
                "method_status": profile.get("method_status") if profile else None,
            },
            "failure_chains": chains,
            "function_analysis_summary": function_summary,
            "function_coverage": function_coverage,
            "requirement_sync": requirement_sync,
            "control_plan_review": _control_plan_review(analysis, chains),
            "issues": issues,
            "step_readiness": step_readiness,
            "finalization_ready": finalization_ready,
            "summary": {
                "failure_chains": len(chains),
                "high_action_priority": counts["H"],
                "medium_action_priority": counts["M"],
                "low_action_priority": counts["L"],
                "post_high_action_priority": post_counts["H"],
                "open_actions": sum(
                    str(action.get("status", "open")) not in
                    {"completed", "not_implemented"}
                    for chain in chains for action in chain.get("actions", [])),
                "overdue_actions": sum(
                    issue["code"] == "overdue_action" for issue in issues),
                "errors": sum(issue["severity"] == "error" for issue in issues),
                "warnings": sum(issue["severity"] == "warning" for issue in issues),
            },
            "methodology": {
                **HANDBOOK_BASIS,
                "profile_checksum": profile.get("checksum") if profile else None,
                "rpn_calculated": False,
                "interpretation": (
                    "Action Priority ranks the need for action; it is not a "
                    "probability, risk magnitude, or acceptance decision."
                ),
            },
        }
        output.append(result)
        all_issues.extend(
            {**item, "analysis_id": analysis_id} for item in issues)
    return {
        "analyses": output,
        "summary": {
            "analyses": len(output),
            "dfmea": sum(item["kind"] == "dfmea" for item in output),
            "pfmea": sum(item["kind"] == "pfmea" for item in output),
            "fmea_msr": sum(item["kind"] == "fmea_msr" for item in output),
            "high_action_priority": sum(
                item["summary"]["high_action_priority"] for item in output),
            "open_actions": sum(item["summary"]["open_actions"] for item in output),
            "finalization_ready": sum(
                item["finalization_ready"] for item in output),
            "issues": len(all_issues),
        },
        "issues": all_issues,
        "rating_profiles": list(profiles.values()),
        "methodology": HANDBOOK_BASIS,
    }


__all__ = [
    "ACTION_STATUSES",
    "HANDBOOK_BASIS",
    "METHOD_VERSION",
    "action_priority_sfm",
    "action_priority_sod",
    "analyze_aiag_vda_fmea",
    "builtin_rating_profiles",
]
