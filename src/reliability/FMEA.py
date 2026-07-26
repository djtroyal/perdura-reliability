"""Controlled FMEA lifecycle, evidence, profile, and FMEDA services."""

from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from datetime import UTC, datetime
import hashlib
import json
from math import exp
from typing import Any, Iterable, Mapping

from reliability.AIAG_VDA_FMEA import (
    analyze_aiag_vda_fmea,
)


METHOD_PROFILES: tuple[dict[str, Any], ...] = (
    {
        "id": "aiag_vda_2019_public",
        "name": "AIAG–VDA FMEA",
        "edition": "First edition, second printing (2022)",
        "family": "aiag_vda",
        "workflow": "seven_step",
        "status": "preview_public_alignment",
        "reference_status": "authorized_source_required_for_conformance",
        "supported_kinds": ["dfmea", "pfmea", "fmea_msr"],
        "capabilities": ["action_priority", "control_plan", "fmes"],
        "basis": [
            "AIAG–VDA FMEA Handbook public method descriptions",
            "Perdura independently worded rating guidance",
        ],
    },
    {
        "id": "sae_j1739_2026",
        "name": "SAE J1739",
        "edition": "J1739_202605",
        "family": "sae",
        "workflow": "profile_defined",
        "status": "reference_gated",
        "reference_status": "authorized_source_not_in_repository",
        "supported_kinds": ["dfmea", "pfmea", "fmea_msr"],
        "capabilities": ["method_profile"],
        "basis": ["SAE publication metadata only"],
    },
    {
        "id": "iec_60812_2018",
        "name": "IEC 60812",
        "edition": "2018, edition 3",
        "family": "iec",
        "workflow": "profile_defined",
        "status": "reference_gated",
        "reference_status": "authorized_source_not_in_repository",
        "supported_kinds": ["dfmea", "pfmea"],
        "capabilities": ["fmea", "fmeca"],
        "basis": ["IEC publication metadata only"],
    },
    {
        "id": "mil_std_1629a",
        "name": "MIL-STD-1629A",
        "edition": "1977 with notices",
        "family": "military",
        "workflow": "profile_defined",
        "status": "reference_gated",
        "reference_status": "source_not_in_repository",
        "supported_kinds": ["dfmea"],
        "capabilities": ["fmeca", "criticality"],
        "basis": ["Method profile reserved pending source verification"],
    },
    {
        "id": "iso_26262_2018_fmeda",
        "name": "ISO 26262 hardware FMEDA",
        "edition": "2018",
        "family": "functional_safety",
        "workflow": "fmeda",
        "status": "reference_gated",
        "reference_status": "authorized_source_not_in_repository",
        "supported_kinds": ["dfmea"],
        "capabilities": ["fmeda", "spfm", "lfm", "pmhf"],
        "basis": ["Generic FMEDA accounting; conformance rules unavailable"],
    },
    {
        "id": "iec_61508_2010_fmeda",
        "name": "IEC 61508 hardware FMEDA",
        "edition": "2010",
        "family": "functional_safety",
        "workflow": "fmeda",
        "status": "reference_gated",
        "reference_status": "authorized_source_not_in_repository",
        "supported_kinds": ["dfmea"],
        "capabilities": ["fmeda", "sff", "diagnostic_coverage"],
        "basis": ["Generic FMEDA accounting; conformance rules unavailable"],
    },
)


STUDY_SCHEMA_VERSION = 2
LIFECYCLE_TRANSITIONS: dict[str, frozenset[str]] = {
    "draft": frozenset({"in_review", "retired"}),
    "in_review": frozenset({"draft", "approved", "retired"}),
    "approved": frozenset({"draft", "released", "superseded", "retired"}),
    "released": frozenset({"superseded", "retired"}),
    "superseded": frozenset({"retired"}),
    "retired": frozenset(),
}


def _canonical(value: Any) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")


def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


def method_profiles() -> list[dict[str, Any]]:
    """Return detached profiles with checksums over all method metadata."""
    result = []
    for raw in METHOD_PROFILES:
        profile = deepcopy(raw)
        profile["checksum"] = canonical_sha256(profile)
        result.append(profile)
    return result


def _study_payload(study: Mapping[str, Any]) -> dict[str, Any]:
    """Return the immutable engineering content covered by a revision."""
    return {
        "schema_version": study.get("schema_version", STUDY_SCHEMA_VERSION),
        "id": study["id"],
        "method_profile_id": study["method_profile_id"],
        "model": study["model"],
        "evidence_links": study.get("evidence_links", []),
        "fmeda_sources": study.get("fmeda_sources", []),
        "fmeda_modes": study.get("fmeda_modes", []),
        "process_steps": study.get("process_steps", []),
        "verification_plan": study.get("verification_plan", []),
        "special_characteristics": study.get("special_characteristics", []),
        "review_findings": study.get("review_findings", []),
        "assignments": study.get("assignments", []),
        "change_requests": study.get("change_requests", []),
        "library_items": study.get("library_items", []),
        "library_instances": study.get("library_instances", []),
        "saved_views": study.get("saved_views", []),
    }


def study_sha256(study: Mapping[str, Any]) -> str:
    return canonical_sha256(_study_payload(study))


def _semantic_ids(value: Any) -> set[str]:
    ids: set[str] = set()
    if isinstance(value, Mapping):
        item_id = value.get("id")
        if isinstance(item_id, str) and item_id:
            ids.add(item_id)
        for child in value.values():
            ids.update(_semantic_ids(child))
    elif isinstance(value, list):
        for child in value:
            ids.update(_semantic_ids(child))
    return ids


def validate_evidence(study: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Validate typed links without asserting evidence quality."""
    target_ids = _semantic_ids(study.get("model", {}))
    evidence_ids = {
        str(item.get("id", "")) for item in study.get("evidence_links", [])
    }
    findings: list[dict[str, Any]] = []
    for link in study.get("evidence_links", []):
        if link.get("target_id") not in target_ids:
            findings.append({
                "code": "dangling_evidence_target",
                "severity": "error",
                "record_id": link.get("id"),
                "message": (
                    f"Evidence link targets unknown semantic record "
                    f"'{link.get('target_id')}'."
                ),
            })
        if link.get("stale"):
            findings.append({
                "code": "stale_evidence",
                "severity": "warning",
                "record_id": link.get("id"),
                "target_id": link.get("target_id"),
                "message": (
                    "Evidence source changed after this link was captured"
                    + (
                        f": {link.get('stale_reason')}"
                        if link.get("stale_reason") else "."
                    )
                ),
            })
        if not link.get("source_checksum") and link.get("source_module") != "external":
            findings.append({
                "code": "unbaselined_evidence",
                "severity": "warning",
                "record_id": link.get("id"),
                "message": "Internal evidence has no source checksum.",
            })
        if link.get("evidence_kind") in {
            "rate", "distribution", "test_result", "diagnostic_coverage",
        } and not link.get("units"):
            findings.append({
                "code": "evidence_units_missing",
                "severity": "warning",
                "record_id": link.get("id"),
                "target_id": link.get("target_id"),
                "message": (
                    "Quantitative evidence should preserve the source units."
                ),
            })
        if link.get("source_module") != "external" and not link.get(
                "source_revision"):
            findings.append({
                "code": "evidence_revision_missing",
                "severity": "warning",
                "record_id": link.get("id"),
                "target_id": link.get("target_id"),
                "message": (
                    "Internal evidence should preserve its source revision."
                ),
            })
    for mode in study.get("fmeda_modes", []):
        for evidence_id in mode.get("evidence_link_ids", []):
            if evidence_id not in evidence_ids:
                findings.append({
                    "code": "unknown_fmeda_evidence",
                    "severity": "error",
                    "record_id": mode.get("id"),
                    "message": f"FMEDA mode references unknown evidence '{evidence_id}'.",
                })
    return findings


def validate_flowdown(study: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Check process flow, DVP&R, and special-characteristic references."""
    model = study.get("model", {})
    structure_ids = {str(item.get("id")) for item in model.get("structure_nodes", [])}
    requirement_ids = {
        str(item.get("id")) for item in model.get("functional_requirements", [])
    }
    chain_ids = {str(item.get("id")) for item in model.get("failure_chains", [])}
    control_ids = {str(item.get("id")) for item in model.get("control_plan", [])}
    evidence_ids = {str(item.get("id")) for item in study.get("evidence_links", [])}
    steps = study.get("process_steps", [])
    step_ids = {str(item.get("id")) for item in steps}
    findings: list[dict[str, Any]] = []

    def unknown(
        owner: Mapping[str, Any], field: str, values: Iterable[Any],
        valid: set[str],
    ) -> None:
        for value in values:
            if str(value) not in valid:
                findings.append({
                    "code": "unknown_flowdown_reference",
                    "severity": "error",
                    "record_id": owner.get("id"),
                    "field": field,
                    "message": (
                        f"{owner.get('id')} references unknown {field} "
                        f"'{value}'."
                    ),
                })

    for step in steps:
        if step.get("structure_node_id"):
            unknown(step, "structure_node_id",
                    [step["structure_node_id"]], structure_ids)
        unknown(step, "predecessor_ids",
                step.get("predecessor_ids", []), step_ids)
        if step.get("id") in step.get("predecessor_ids", []):
            findings.append({
                "code": "process_self_predecessor",
                "severity": "error",
                "record_id": step.get("id"),
                "message": "A process step cannot precede itself.",
            })
    # Directed-cycle check over predecessor -> step.
    predecessors = {
        str(step.get("id")): {
            str(value) for value in step.get("predecessor_ids", [])
            if str(value) in step_ids
        } for step in steps
    }
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(node: str) -> bool:
        if node in visiting:
            return True
        if node in visited:
            return False
        visiting.add(node)
        cyclic = any(visit(parent) for parent in predecessors.get(node, set()))
        visiting.remove(node)
        visited.add(node)
        return cyclic

    if any(visit(node) for node in predecessors):
        findings.append({
            "code": "process_flow_cycle",
            "severity": "error",
            "message": "Process-flow predecessor links contain a cycle.",
        })

    for row in study.get("verification_plan", []):
        unknown(row, "requirement_ids",
                row.get("requirement_ids", []), requirement_ids)
        unknown(row, "failure_chain_ids",
                row.get("failure_chain_ids", []), chain_ids)
        unknown(row, "evidence_link_ids",
                row.get("evidence_link_ids", []), evidence_ids)
        if row.get("status") in {"passed", "failed"} and not row.get(
                "evidence_link_ids"):
            findings.append({
                "code": "verification_result_without_evidence",
                "severity": "error",
                "record_id": row.get("id"),
                "message": (
                    "Completed verification requires linked result evidence."
                ),
            })

    for item in study.get("special_characteristics", []):
        unknown(item, "requirement_ids",
                item.get("requirement_ids", []), requirement_ids)
        unknown(item, "failure_chain_ids",
                item.get("failure_chain_ids", []), chain_ids)
        unknown(item, "process_step_ids",
                item.get("process_step_ids", []), step_ids)
        unknown(item, "control_plan_row_ids",
                item.get("control_plan_row_ids", []), control_ids)
        if item.get("status") == "approved" and not (
            item.get("requirement_ids") and item.get("failure_chain_ids")
        ):
            findings.append({
                "code": "untraced_special_characteristic",
                "severity": "error",
                "record_id": item.get("id"),
                "message": (
                    "Approved special characteristics require requirement and "
                    "failure-chain traceability."
                ),
            })
    return findings


def analyze_fmeda(
    sources: Iterable[Mapping[str, Any]],
    modes: Iterable[Mapping[str, Any]],
) -> dict[str, Any]:
    """Compute auditable, method-neutral FMEDA accounting.

    Failure rates live on sources and are allocated exactly once through mode
    fractions.  This prevents a common spreadsheet defect where the same
    component rate is copied into several rows and silently double-counted.
    Standards-specific classification and acceptance rules remain profile
    gated.
    """
    source_rows = [deepcopy(dict(item)) for item in sources]
    source_by_id = {str(item["id"]): item for item in source_rows}
    rows: list[dict[str, Any]] = []
    allocations: dict[str, float] = defaultdict(float)
    totals: dict[str, float] = defaultdict(float)
    lower_totals: dict[str, float] = defaultdict(float)
    upper_totals: dict[str, float] = defaultdict(float)
    residual_by_source: dict[str, float] = defaultdict(float)
    common_cause_groups: dict[str, float] = defaultdict(float)
    issues: list[dict[str, Any]] = []

    for source in source_rows:
        rate = float(source["failure_rate_per_hour"])
        exposure = float(source.get("exposure_fraction", 1.0))
        lower = float(source.get("lower_rate_per_hour", rate))
        upper = float(source.get("upper_rate_per_hour", rate))
        if rate < 0 or lower < 0 or upper < 0:
            raise ValueError("FMEDA source rates must be non-negative.")
        if lower > rate or rate > upper:
            raise ValueError(
                "FMEDA source uncertainty must satisfy lower <= rate <= upper.")
        if not 0 <= exposure <= 1:
            raise ValueError("FMEDA source exposure_fraction must be in [0, 1].")
        totals["source_rate"] += rate * exposure
        lower_totals["source_rate"] += lower * exposure
        upper_totals["source_rate"] += upper * exposure

    for raw in modes:
        source_id = str(raw["source_id"])
        source = source_by_id.get(source_id)
        if source is None:
            issues.append({
                "code": "unknown_fmeda_source",
                "severity": "error",
                "record_id": raw.get("id"),
                "message": (
                    f"FMEDA mode references unknown rate source '{source_id}'."
                ),
            })
            continue
        fraction = float(raw["mode_fraction"])
        coverage = float(raw.get("diagnostic_coverage", 0.0))
        dependent = float(raw.get("dependent_failure_fraction", 0.0))
        if not 0 <= fraction <= 1 or not 0 <= coverage <= 1:
            raise ValueError(
                "FMEDA mode fractions and diagnostic coverage must be in [0, 1].")
        if not 0 <= dependent <= 1:
            raise ValueError(
                "FMEDA dependent_failure_fraction must be in [0, 1].")
        allocations[source_id] += fraction
        exposure = float(source.get("exposure_fraction", 1.0))
        source_rate = float(source["failure_rate_per_hour"]) * exposure
        lower_rate = float(
            source.get("lower_rate_per_hour", source["failure_rate_per_hour"])
        ) * exposure
        upper_rate = float(
            source.get("upper_rate_per_hour", source["failure_rate_per_hour"])
        ) * exposure
        mode_rate = source_rate * fraction
        mode_rate_lower = lower_rate * fraction
        mode_rate_upper = upper_rate * fraction
        classification = str(raw["classification"])
        detected = 0.0
        residual = 0.0
        residual_fraction = 0.0
        if classification in {"safe", "no_effect"}:
            totals["safe"] += mode_rate
            lower_totals["safe"] += mode_rate_lower
            upper_totals["safe"] += mode_rate_upper
        elif classification in {"single_point", "residual"}:
            # The explicitly dependent fraction bypasses the claimed
            # diagnostic coverage. The remainder is partitioned by DC.
            residual_fraction = dependent + (1.0 - dependent) * (1.0 - coverage)
            residual = mode_rate * residual_fraction
            detected = mode_rate - residual
            totals["dangerous_detected"] += detected
            totals["single_point_residual"] += residual
            lower_totals["dangerous_detected"] += (
                mode_rate_lower * (1.0 - residual_fraction))
            lower_totals["single_point_residual"] += (
                mode_rate_lower * residual_fraction)
            upper_totals["dangerous_detected"] += (
                mode_rate_upper * (1.0 - residual_fraction))
            upper_totals["single_point_residual"] += (
                mode_rate_upper * residual_fraction)
        elif classification == "multiple_point_detected":
            detected = mode_rate
            totals["multiple_point_detected"] += mode_rate
            lower_totals["multiple_point_detected"] += mode_rate_lower
            upper_totals["multiple_point_detected"] += mode_rate_upper
        elif classification == "multiple_point_latent":
            residual = mode_rate
            residual_fraction = 1.0
            totals["multiple_point_latent"] += mode_rate
            lower_totals["multiple_point_latent"] += mode_rate_lower
            upper_totals["multiple_point_latent"] += mode_rate_upper
        else:
            issues.append({
                "code": "unknown_fmeda_classification",
                "severity": "error",
                "record_id": raw.get("id"),
                "message": f"Unknown FMEDA classification '{classification}'.",
            })
            continue
        totals["accounted_rate"] += mode_rate
        lower_totals["accounted_rate"] += mode_rate_lower
        upper_totals["accounted_rate"] += mode_rate_upper
        residual_by_source[source_id] += residual
        group_id = str(raw.get("common_cause_group_id") or "").strip()
        if group_id and residual:
            common_cause_groups[group_id] += residual
        proof_interval = raw.get("proof_test_interval_hours")
        diagnostic_interval = raw.get("diagnostic_interval_hours")
        latent_unavailability = (
            residual * float(proof_interval) / 2.0
            if proof_interval and classification == "multiple_point_latent"
            else None
        )
        detection_latency_unavailability = (
            detected * float(diagnostic_interval) / 2.0
            if diagnostic_interval and detected else None
        )
        rows.append({
            **dict(raw),
            "source_rate_per_hour": source_rate,
            "mode_rate_per_hour": mode_rate,
            "mode_rate_lower_per_hour": mode_rate_lower,
            "mode_rate_upper_per_hour": mode_rate_upper,
            "detected_rate_per_hour": detected,
            "residual_rate_per_hour": residual,
            "latent_unavailability_approx": latent_unavailability,
            "detection_latency_unavailability_approx": (
                detection_latency_unavailability),
        })

    for source_id, source in source_by_id.items():
        allocated = allocations.get(source_id, 0.0)
        delta = allocated - 1.0
        if delta > 1e-12:
            issues.append({
                "code": "mode_fraction_overallocated",
                "severity": "error",
                "record_id": source_id,
                "message": (
                    f"Failure-mode fractions total {allocated:.6g}; "
                    "the source rate would be double-counted."
                ),
            })
        elif delta < -1e-12:
            severity = "error" if source.get(
                "allocation_complete", True) else "warning"
            issues.append({
                "code": "mode_fraction_unallocated",
                "severity": severity,
                "record_id": source_id,
                "message": (
                    f"Failure-mode fractions total {allocated:.6g}; "
                    f"{1.0 - allocated:.6g} remains unclassified."
                ),
            })
            rate = float(source["failure_rate_per_hour"]) * float(
                source.get("exposure_fraction", 1.0))
            lower = float(source.get(
                "lower_rate_per_hour", source["failure_rate_per_hour"]
            )) * float(source.get("exposure_fraction", 1.0))
            upper = float(source.get(
                "upper_rate_per_hour", source["failure_rate_per_hour"]
            )) * float(source.get("exposure_fraction", 1.0))
            totals["unclassified"] += rate * (1.0 - allocated)
            lower_totals["unclassified"] += lower * (1.0 - allocated)
            upper_totals["unclassified"] += upper * (1.0 - allocated)
            residual_by_source[source_id] += rate * (1.0 - allocated)

    total = totals["source_rate"]
    dangerous = (
        totals["dangerous_detected"]
        + totals["single_point_residual"]
    )
    multiple = (
        totals["multiple_point_detected"]
        + totals["multiple_point_latent"]
        + totals["unclassified"]
    )
    residual_rate = (
        totals["single_point_residual"]
        + totals["multiple_point_latent"]
        + totals["unclassified"]
    )
    lower_residual = (
        lower_totals["single_point_residual"]
        + lower_totals["multiple_point_latent"]
        + lower_totals["unclassified"]
    )
    upper_residual = (
        upper_totals["single_point_residual"]
        + upper_totals["multiple_point_latent"]
        + upper_totals["unclassified"]
    )
    mission_exposure = sum(
        residual_by_source[source_id]
        * float(source_by_id[source_id].get("mission_time_hours", 0.0))
        for source_id in residual_by_source
    )
    sensitivity = sorted(
        ({
            "source_id": source_id,
            "residual_rate_per_hour": value,
            "residual_share": value / residual_rate if residual_rate else 0.0,
        } for source_id, value in residual_by_source.items()),
        key=lambda item: (-item["residual_rate_per_hour"], item["source_id"]),
    )
    return {
        "sources": source_rows,
        "rows": rows,
        "totals": dict(totals),
        "uncertainty": {
            "lower_totals": dict(lower_totals),
            "upper_totals": dict(upper_totals),
            "residual_rate_lower_per_hour": lower_residual,
            "residual_rate_upper_per_hour": upper_residual,
        },
        "metrics": {
            "safe_failure_fraction": (
                (totals["safe"] + totals["dangerous_detected"]) / total
                if total else None
            ),
            "diagnostic_coverage": (
                totals["dangerous_detected"] / dangerous if dangerous else None
            ),
            "single_point_fault_metric": (
                1.0 - (
                    totals["single_point_residual"] + totals["unclassified"]
                ) / total if total else None
            ),
            "latent_fault_metric": (
                1.0 - (
                    totals["multiple_point_latent"] + totals["unclassified"]
                ) / multiple if multiple else None
            ),
            "residual_rate_per_hour": residual_rate,
            "mission_residual_probability": (
                -exp(-mission_exposure) + 1.0
                if mission_exposure > 0 else None
            ),
        },
        "allocation_by_source": dict(sorted(allocations.items())),
        "residual_sensitivity": sensitivity,
        "common_cause_groups": [
            {"group_id": group_id, "residual_rate_per_hour": value}
            for group_id, value in sorted(common_cause_groups.items())
        ],
        "issues": issues,
        "interpretation": (
            "Method-neutral source-to-mode accounting with explicit "
            "allocation, exposure, diagnostic, dependency, mission, and "
            "uncertainty terms. Use a source-verified method profile before "
            "making ISO, IEC, SAE, or customer conformance claims."
        ),
    }


def analyze_studies(
    studies: Iterable[Mapping[str, Any]],
    *,
    rating_profiles: Iterable[Mapping[str, Any]] = (),
    program_requirements: Iterable[Mapping[str, Any]] = (),
) -> dict[str, Any]:
    records = [deepcopy(dict(item)) for item in studies]
    core = analyze_aiag_vda_fmea(
        [item["model"] for item in records],
        rating_profiles=rating_profiles,
        program_requirements=program_requirements,
    )
    by_id = {str(item["id"]): item for item in records}
    profiles = {item["id"]: item for item in method_profiles()}
    study_results = []
    for analysis in core["analyses"]:
        study = by_id[str(analysis["id"])]
        evidence_findings = validate_evidence(study)
        flowdown_findings = validate_flowdown(study)
        governance_findings = validate_governance(study)
        fmeda = analyze_fmeda(
            study.get("fmeda_sources", []),
            study.get("fmeda_modes", []),
        )
        method = profiles.get(str(study["method_profile_id"]))
        method_findings: list[dict[str, Any]] = []
        if method is None:
            method_findings.append({
                "code": "unknown_method_profile",
                "severity": "error",
                "record_id": study["id"],
                "message": (
                    f"Method profile '{study['method_profile_id']}' is unavailable."
                ),
            })
        elif analysis["kind"] not in method["supported_kinds"]:
            method_findings.append({
                "code": "method_kind_mismatch",
                "severity": "error",
                "record_id": study["id"],
                "message": (
                    f"{method['name']} does not support {analysis['kind']}."
                ),
            })
        elif method["status"] == "reference_gated":
            method_findings.append({
                "code": "method_reference_gated",
                "severity": "error",
                "record_id": study["id"],
                "message": (
                    f"{method['name']} is reference-gated and cannot support "
                    "calculation or release."
                ),
            })
        findings = [
            *method_findings, *evidence_findings, *flowdown_findings,
            *governance_findings, *fmeda["issues"],
        ]
        issue_index = [{
            **item,
            "category": (
                "method" if item in method_findings
                else "evidence" if item in evidence_findings
                else "flowdown" if item in flowdown_findings
                else "governance" if item in governance_findings
                else "fmeda"
            ),
            "target_id": item.get("target_id") or item.get("record_id")
            or study["id"],
        } for item in findings]
        study_results.append({
            "study_id": study["id"],
            "method_profile_id": study["method_profile_id"],
            "method_profile": method,
            "content_sha256": study_sha256(study),
            "analysis": analysis,
            "evidence_findings": evidence_findings,
            "flowdown_findings": flowdown_findings,
            "governance_findings": governance_findings,
            "fmeda": fmeda,
            "projections": {
                "evidence_links": deepcopy(
                    study.get("evidence_links", [])),
                "process_steps": deepcopy(study.get("process_steps", [])),
                "verification_plan": deepcopy(
                    study.get("verification_plan", [])),
                "special_characteristics": deepcopy(
                    study.get("special_characteristics", [])),
                "review_findings": deepcopy(
                    study.get("review_findings", [])),
                "change_requests": deepcopy(
                    study.get("change_requests", [])),
                "library_instances": deepcopy(
                    study.get("library_instances", [])),
            },
            "findings": findings,
            "issue_index": issue_index,
            "release_ready": (
                analysis["finalization_ready"]
                and not any(item["severity"] == "error" for item in findings)
            ),
        })
    return {
        "studies": study_results,
        "core": core,
        "method_profiles": method_profiles(),
    }


def semantic_diff(before: Any, after: Any, path: str = "") -> list[dict[str, Any]]:
    """Produce a stable field-level diff suitable for review and export."""
    if before == after:
        return []
    if isinstance(before, Mapping) and isinstance(after, Mapping):
        changes = []
        for key in sorted(set(before) | set(after)):
            child_path = f"{path}.{key}" if path else str(key)
            if key not in before:
                changes.append({
                    "path": child_path, "change": "added",
                    "before": None, "after": after[key],
                })
            elif key not in after:
                changes.append({
                    "path": child_path, "change": "removed",
                    "before": before[key], "after": None,
                })
            else:
                changes.extend(semantic_diff(
                    before[key], after[key], child_path))
        return changes
    if isinstance(before, list) and isinstance(after, list):
        keyed_before = {
            str(item["id"]): item for item in before
            if isinstance(item, Mapping) and item.get("id")
        }
        keyed_after = {
            str(item["id"]): item for item in after
            if isinstance(item, Mapping) and item.get("id")
        }
        if (len(keyed_before) == len(before)
                and len(keyed_after) == len(after)):
            return semantic_diff(keyed_before, keyed_after, path)
    return [{
        "path": path or "$", "change": "modified",
        "before": before, "after": after,
    }]


def create_revision(
    study: Mapping[str, Any], *, created_by: str, change_summary: str,
) -> dict[str, Any]:
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    content_hash = study_sha256(study)
    revisions = study.get("revisions", [])
    parent_hash = revisions[-1]["content_sha256"] if revisions else None
    if parent_hash == content_hash:
        raise ValueError(
            "The FMEA has not changed since the latest controlled revision.")
    revision = str(study["model"].get("revision", "")).strip() or "A"
    return {
        "id": f"rev-{content_hash[:16]}",
        "revision": revision,
        "created_at": now,
        "created_by": created_by.strip(),
        "change_summary": change_summary.strip(),
        "content_sha256": content_hash,
        "parent_sha256": parent_hash,
        "snapshot": deepcopy(_study_payload(study)),
    }


def create_release(
    study: Mapping[str, Any],
    *,
    rating_profiles: Iterable[Mapping[str, Any]],
    program_requirements: Iterable[Mapping[str, Any]],
    software_version: str,
    software_commit: str,
    attestations: list[Mapping[str, Any]],
) -> dict[str, Any]:
    rating_profiles = list(rating_profiles)
    program_requirements = list(program_requirements)
    if study.get("lifecycle_status", "draft") != "approved":
        raise ValueError(
            "A controlled release requires an approved FMEA baseline.")
    if not any(
        item.get("role") == "approver"
        and item.get("decision") == "approved"
        for item in attestations
    ):
        raise ValueError(
            "A release requires at least one approving approver attestation.")
    if any(item.get("decision") == "rejected" for item in attestations):
        raise ValueError(
            "A release cannot include a rejected attestation.")
    result = analyze_studies(
        [study], rating_profiles=rating_profiles,
        program_requirements=program_requirements,
    )["studies"][0]
    if not result["release_ready"]:
        raise ValueError(
            "FMEA release is blocked until all model and evidence errors are resolved.")
    profiles = {item["id"]: item for item in method_profiles()}
    profile_id = str(study["method_profile_id"])
    method = profiles.get(profile_id)
    rating = result["analysis"].get("rating_profile", {})
    content_hash = result["content_sha256"]
    revisions = list(study.get("revisions", []))
    if not revisions or revisions[-1].get("content_sha256") != content_hash:
        raise ValueError(
            "Capture the approved engineering content as a revision before release.")
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    assurance = (
        "authenticated_hosted"
        if attestations and all(
            item.get("identity_assurance") == "authenticated_hosted"
            for item in attestations
        )
        else "named_local"
    )
    release_transition = {
        "id": f"transition-release-{content_hash[:16]}",
        "from_status": "approved",
        "to_status": "released",
        "actor": str(attestations[-1].get("name", "")).strip(),
        "rationale": str(
            attestations[-1].get("statement", "")).strip(),
        "timestamp": now,
        "attestations": deepcopy(attestations),
    }
    manifest = {
        "id": f"release-{content_hash[:16]}",
        "study_id": study["id"],
        "revision": study["model"].get("revision", "A"),
        "lifecycle_status": "released",
        "method_profile_id": profile_id,
        "released_at": now,
        "content_sha256": content_hash,
        "software_version": software_version,
        "software_commit": software_commit,
        "profile_checksum": (
            rating.get("checksum") or (method or {}).get("checksum")
        ),
        "assurance": assurance,
        "attestations": deepcopy(attestations),
        "lifecycle_event": release_transition,
        "method_profile": deepcopy(method),
        "rating_profile": deepcopy(rating),
        "engineering_snapshot": deepcopy(_study_payload(study)),
        "analysis_summary": {
            "summary": deepcopy(result["analysis"].get("summary", {})),
            "issue_index": deepcopy(result.get("issue_index", [])),
            "fmeda_metrics": deepcopy(result["fmeda"].get("metrics", {})),
            "fmeda_uncertainty": deepcopy(
                result["fmeda"].get("uncertainty", {})),
        },
        "requirements_sha256": canonical_sha256(
            list(program_requirements)),
        "findings": [
            *result["analysis"].get("issues", []),
            *result["findings"],
        ],
    }
    manifest["manifest_sha256"] = canonical_sha256(manifest)
    return manifest


def verify_release(
    study: Mapping[str, Any], release: Mapping[str, Any],
) -> dict[str, Any]:
    content_actual = study_sha256(study)
    manifest = dict(release)
    expected_manifest = manifest.pop("manifest_sha256", "")
    manifest_actual = canonical_sha256(manifest)
    return {
        "valid": (
            content_actual == release.get("content_sha256")
            and manifest_actual == expected_manifest
            and study.get("id") == release.get("study_id")
            and (
                not release.get("engineering_snapshot")
                or canonical_sha256(release["engineering_snapshot"])
                == canonical_sha256(_study_payload(study))
            )
        ),
        "content_matches": content_actual == release.get("content_sha256"),
        "manifest_matches": manifest_actual == expected_manifest,
        "study_matches": study.get("id") == release.get("study_id"),
        "snapshot_matches": (
            not release.get("engineering_snapshot")
            or canonical_sha256(release["engineering_snapshot"])
            == canonical_sha256(_study_payload(study))
        ),
        "content_sha256": content_actual,
        "manifest_sha256": manifest_actual,
    }


def validate_governance(study: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Validate review, assignment, change-control, and lifecycle records."""
    findings: list[dict[str, Any]] = []
    semantic_ids = _semantic_ids(_study_payload(study))
    finding_ids = {
        str(item.get("id")) for item in study.get("review_findings", [])
    }
    assignment_ids = {
        str(item.get("id")) for item in study.get("assignments", [])
    }
    for item in study.get("review_findings", []):
        target_id = str(item.get("target_id", ""))
        if target_id and target_id not in semantic_ids:
            findings.append({
                "code": "dangling_review_target",
                "severity": "error",
                "record_id": item.get("id"),
                "target_id": target_id,
                "message": f"Review finding targets unknown record '{target_id}'.",
            })
        if item.get("status") == "closed" and not str(
                item.get("disposition", "")).strip():
            findings.append({
                "code": "closed_finding_without_disposition",
                "severity": "error",
                "record_id": item.get("id"),
                "message": "A closed review finding requires a disposition.",
            })
    for item in study.get("assignments", []):
        target_id = str(item.get("target_id", ""))
        if target_id not in semantic_ids and target_id not in finding_ids:
            findings.append({
                "code": "dangling_assignment_target",
                "severity": "error",
                "record_id": item.get("id"),
                "target_id": target_id,
                "message": f"Assignment targets unknown record '{target_id}'.",
            })
    for item in study.get("change_requests", []):
        unknown = [
            value for value in item.get("affected_ids", [])
            if str(value) not in semantic_ids
        ]
        if unknown:
            findings.append({
                "code": "dangling_change_request_target",
                "severity": "error",
                "record_id": item.get("id"),
                "message": (
                    "Change request references unknown records: "
                    + ", ".join(str(value) for value in unknown[:10])
                ),
            })
        if item.get("assignment_id") and str(
                item["assignment_id"]) not in assignment_ids:
            findings.append({
                "code": "dangling_change_assignment",
                "severity": "error",
                "record_id": item.get("id"),
                "message": (
                    f"Change request references unknown assignment "
                    f"'{item['assignment_id']}'."
                ),
            })
    if study.get("lifecycle_status") in {"approved", "released"}:
        blockers = [
            item for item in study.get("review_findings", [])
            if item.get("status") != "closed"
            and item.get("severity") in {"error", "critical"}
        ]
        if blockers:
            findings.append({
                "code": "open_review_blockers",
                "severity": "error",
                "record_id": study.get("id"),
                "message": (
                    f"{len(blockers)} blocking review finding(s) remain open."
                ),
            })
    return findings


def transition_lifecycle(
    study: Mapping[str, Any],
    *,
    target_status: str,
    actor: str,
    rationale: str,
    attestations: Iterable[Mapping[str, Any]] = (),
) -> dict[str, Any]:
    """Return a study copy after a validated lifecycle transition."""
    current = str(study.get("lifecycle_status", "draft"))
    if target_status not in LIFECYCLE_TRANSITIONS.get(current, frozenset()):
        raise ValueError(
            f"Lifecycle transition '{current}' to '{target_status}' is not allowed.")
    attestations = [deepcopy(dict(item)) for item in attestations]
    if target_status == "approved" and not any(
        item.get("role") in {"reviewer", "approver"}
        and item.get("decision") == "approved"
        for item in attestations
    ):
        raise ValueError("Approval requires an approving reviewer or approver.")
    if target_status in {"in_review", "approved"}:
        revisions = list(study.get("revisions", []))
        if not revisions or revisions[-1].get(
                "content_sha256") != study_sha256(study):
            raise ValueError(
                "Capture the current engineering content as a revision first.")
    if target_status == "approved" and any(
        item["severity"] == "error" for item in validate_governance(study)
    ):
        raise ValueError(
            "Resolve blocking governance findings before approval.")
    if target_status == "released":
        raise ValueError(
            "Use create_release so analysis, approval, and integrity checks run.")
    result = deepcopy(dict(study))
    result["lifecycle_status"] = target_status
    history = list(result.get("lifecycle_history", []))
    transition_hash = canonical_sha256([
        study.get("id"), current, target_status, actor, rationale, len(history),
    ])
    event = {
        "id": f"transition-{transition_hash[:16]}",
        "from_status": current,
        "to_status": target_status,
        "actor": actor.strip(),
        "rationale": rationale.strip(),
        "timestamp": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "attestations": attestations,
    }
    history.append(event)
    result["lifecycle_history"] = history
    return result


def evidence_impact(
    study: Mapping[str, Any],
    source_records: Iterable[Mapping[str, Any]],
) -> dict[str, Any]:
    """Compare captured evidence identities with current project sources."""
    current: dict[tuple[str, str, str], Mapping[str, Any]] = {}
    for record in source_records:
        key = (
            str(record.get("source_module", "")),
            str(record.get("source_analysis_id", "")),
            str(record.get("source_record_id", "")),
        )
        current[key] = record
    impacts: list[dict[str, Any]] = []
    for link in study.get("evidence_links", []):
        if link.get("source_module") == "external":
            continue
        key = (
            str(link.get("source_module", "")),
            str(link.get("source_analysis_id", "")),
            str(link.get("source_record_id", "")),
        )
        source = current.get(key)
        reason = ""
        current_checksum = None
        if source is None:
            reason = "Source record is no longer present."
        else:
            current_checksum = source.get("source_checksum")
            if current_checksum != link.get("source_checksum"):
                reason = "Source content checksum changed."
            elif source.get("source_revision") != link.get("source_revision"):
                reason = "Source revision changed."
        if reason:
            impacts.append({
                "evidence_link_id": link.get("id"),
                "target_id": link.get("target_id"),
                "reason": reason,
                "captured_checksum": link.get("source_checksum"),
                "current_checksum": current_checksum,
            })
    targets = sorted({
        str(item["target_id"]) for item in impacts if item.get("target_id")
    })
    return {
        "stale_links": impacts,
        "affected_target_ids": targets,
        "count": len(impacts),
    }


def prepare_library_item(item: Mapping[str, Any]) -> dict[str, Any]:
    """Normalize and checksum a reusable family/foundation library item."""
    result = deepcopy(dict(item))
    payload = {
        key: value for key, value in result.items()
        if key not in {"checksum", "updated_at"}
    }
    result["checksum"] = canonical_sha256(payload)
    return result


def instantiate_library_item(
    study: Mapping[str, Any],
    item: Mapping[str, Any],
    *,
    instance_id: str,
) -> dict[str, Any]:
    """Apply a released library item as an explicit, reviewable patch."""
    prepared = prepare_library_item(item)
    if prepared.get("status") != "released":
        raise ValueError("Only released library items can be instantiated.")
    content = prepared.get("content")
    if not isinstance(content, Mapping):
        raise ValueError("Library content must be an object.")
    allowed = {
        "structure_nodes", "functions", "functional_requirements",
        "function_links", "function_requirement_links", "failure_chains",
        "interfaces", "control_plan",
    }
    unknown = sorted(set(content) - allowed)
    if unknown:
        raise ValueError(
            "Library content contains unsupported collections: "
            + ", ".join(unknown))
    old_ids = _semantic_ids(content)
    id_map = {
        old_id: f"{instance_id}:{old_id}" for old_id in sorted(old_ids)
    }

    def rewrite(value: Any) -> Any:
        if isinstance(value, str):
            return id_map.get(value, value)
        if isinstance(value, list):
            return [rewrite(item) for item in value]
        if isinstance(value, Mapping):
            return {key: rewrite(child) for key, child in value.items()}
        return value

    patch = rewrite(content)
    result = deepcopy(dict(study))
    model = deepcopy(dict(result["model"]))
    existing_ids = _semantic_ids(model)
    collisions = existing_ids.intersection(_semantic_ids(patch))
    if collisions:
        raise ValueError(
            "Library instantiation would duplicate IDs: "
            + ", ".join(sorted(collisions)[:10]))
    for collection, values in patch.items():
        model[collection] = [*model.get(collection, []), *values]
    result["model"] = model
    instance = {
        "id": instance_id,
        "library_item_id": prepared.get("id"),
        "library_version": prepared.get("version"),
        "library_checksum": prepared["checksum"],
        "id_map": id_map,
        "instantiated_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "status": "current",
    }
    result["library_instances"] = [
        *result.get("library_instances", []), instance,
    ]
    return {
        "study": result,
        "instance": instance,
        "patch": patch,
    }


def generate_suggestions(study: Mapping[str, Any]) -> dict[str, Any]:
    """Generate cited, deterministic proposals without modifying the study."""
    suggestions: list[dict[str, Any]] = []
    chains = {
        str(item.get("id")): item
        for item in study.get("model", {}).get("failure_chains", [])
    }
    dimension_fields = {
        "severity": "severity",
        "occurrence": "occurrence",
        "detection": "detection",
        "frequency": "frequency",
        "monitoring": "monitoring",
    }
    for link in study.get("evidence_links", []):
        target_id = str(link.get("target_id", ""))
        chain = chains.get(target_id)
        dimension = str(link.get("rating_dimension", ""))
        rating = link.get("rating_value")
        if (
            chain is not None
            and dimension in dimension_fields
            and isinstance(rating, int)
            and 1 <= rating <= 10
        ):
            field = dimension_fields[dimension]
            suggestion_hash = canonical_sha256([
                link.get("id"), field, rating,
            ])
            suggestions.append({
                "id": f"suggestion-{suggestion_hash[:16]}",
                "kind": "rating_proposal",
                "target_id": target_id,
                "path": f"model.failure_chains.{target_id}.{field}",
                "current_value": chain.get(field),
                "proposed_value": rating,
                "rationale": (
                    link.get("claim")
                    or f"Evidence explicitly proposes {dimension} rating {rating}."
                ),
                "evidence_link_ids": [link.get("id")],
                "confidence": "source_explicit",
                "requires_acceptance": True,
            })
    for chain_id, chain in chains.items():
        for dimension in ("severity", "occurrence", "detection"):
            if chain.get(dimension) and not str(
                    chain.get(f"{dimension}_rationale", "")).strip():
                suggestion_hash = canonical_sha256([
                    chain_id, dimension, "rationale",
                ])
                suggestions.append({
                    "id": f"suggestion-{suggestion_hash[:16]}",
                    "kind": "missing_basis",
                    "target_id": chain_id,
                    "path": (
                        f"model.failure_chains.{chain_id}."
                        f"{dimension}_rationale"
                    ),
                    "current_value": "",
                    "proposed_value": None,
                    "rationale": (
                        f"Record the engineering basis for the {dimension} "
                        "rating or link evidence that states it."
                    ),
                    "evidence_link_ids": [],
                    "confidence": "rule",
                    "requires_acceptance": True,
                })
    return {
        "suggestions": suggestions,
        "count": len(suggestions),
        "applied": False,
        "policy": (
            "Suggestions are cited proposals. They never modify, rate, "
            "approve, or release an FMEA without explicit analyst action."
        ),
    }


__all__ = [
    "analyze_fmeda", "analyze_studies", "canonical_sha256",
    "create_release", "create_revision", "evidence_impact",
    "generate_suggestions", "instantiate_library_item", "method_profiles",
    "prepare_library_item", "semantic_diff", "study_sha256",
    "transition_lifecycle", "validate_evidence", "validate_flowdown",
    "validate_governance", "verify_release",
]
