"""Assurance checks for the dedicated FMEA control plane."""

from copy import deepcopy
from time import perf_counter

import pytest

from reliability.FMEA import (
    analyze_fmeda,
    analyze_studies,
    create_release,
    create_revision,
    evidence_impact,
    generate_suggestions,
    instantiate_library_item,
    method_profiles,
    prepare_library_item,
    semantic_diff,
    study_sha256,
    transition_lifecycle,
    validate_evidence,
    validate_failure_flow,
    validate_flowdown,
    verify_release,
)


def _model():
    return {
        "id": "DFMEA-1",
        "name": "Controller DFMEA",
        "kind": "dfmea",
        "revision": "A",
        "status": "draft",
        "planning": {
            "subject": "Controller",
            "scope": "Command input through controlled output",
            "intent": "Prevent loss of controlled output",
            "team": ["Design", "Quality"],
        },
        "structure_nodes": [{
            "id": "ST-1", "name": "Controller", "level": "focus",
        }],
        "functions": [{
            "id": "FN-1", "structure_node_id": "ST-1",
            "description": "Provide controlled output",
            "function_type": "primary",
        }],
        "functional_requirements": [{
            "id": "REQ-1",
            "statement": "Output remains available",
            "requirement_type": "performance",
            "measure": "Availability",
            "target": "Available",
            "acceptance_criteria": "Output present",
            "verification_method": "Functional test",
        }],
        "function_requirement_links": [{
            "id": "LINK-1",
            "function_id": "FN-1",
            "requirement_id": "REQ-1",
            "strength": "strong",
        }],
        "failure_chains": [{
            "id": "FC-1",
            "function_id": "FN-1",
            "effect": "Output unavailable",
            "failure_mode": "No output",
            "cause": "Open circuit",
            "severity": 3,
            "occurrence": 2,
            "detection": 2,
            "prevention_controls": "Qualified interconnect",
            "detection_controls": "Functional test",
            "severity_rationale": "Loss is recoverable",
            "occurrence_rationale": "Relevant predecessor evidence",
            "detection_rationale": "Automated functional test",
        }],
    }


def _study():
    return {
        "schema_version": 2,
        "id": "DFMEA-1",
        "lifecycle_status": "draft",
        "method_profile_id": "aiag_vda_2019_public",
        "model": _model(),
        "evidence_links": [],
        "fmeda_sources": [],
        "fmeda_modes": [],
        "process_steps": [],
        "verification_plan": [],
        "special_characteristics": [],
        "review_findings": [],
        "assignments": [],
        "change_requests": [],
        "library_items": [],
        "library_instances": [],
        "saved_views": [],
        "lifecycle_history": [],
        "revisions": [],
        "releases": [],
    }


def _flow_snapshot():
    source = {
        "folio_id": "FOLIO-HIGH",
        "analysis_id": "DFMEA-1",
    }
    target = {
        "folio_id": "FOLIO-LOW",
        "analysis_id": "DFMEA-2",
    }
    mode_source = {
        **source, "chain_id": "FC-1", "role": "failure_mode",
    }
    cause_source = {
        **source, "chain_id": "FC-1", "role": "cause",
    }
    effect_target = {
        **target, "chain_id": "FC-LOW", "role": "effect",
    }
    mode_target = {
        **target, "chain_id": "FC-LOW", "role": "failure_mode",
    }
    return {
        "schema_version": 1,
        "owner": source,
        "statements": [
            {
                "id": "FS-MODE",
                "text": "No output",
                "version": 1,
                "origin": mode_source,
                "updated_at": "2026-07-26T12:00:00Z",
            },
            {
                "id": "FS-CAUSE",
                "text": "Open circuit",
                "version": 1,
                "origin": cause_source,
                "updated_at": "2026-07-26T12:00:00Z",
            },
        ],
        "analysis_relations": [{
            "id": "REL-1",
            "parent": source,
            "child": target,
            "mappings": [{
                "id": "MAP-1",
                "parent_function_id": "FN-1",
                "child_function_id": "FN-LOW",
            }],
            "created_at": "2026-07-26T12:00:00Z",
        }],
        "edges": [
            {
                "id": "EDGE-MODE",
                "statement_id": "FS-MODE",
                "relation": "higher_mode_to_lower_effect",
                "source": mode_source,
                "target": effect_target,
                "analysis_relation_id": "REL-1",
                "function_mapping_id": "MAP-1",
                "status": "active",
                "source_revision": "A",
                "target_revision": "A",
                "created_at": "2026-07-26T12:00:00Z",
            },
            {
                "id": "EDGE-CAUSE",
                "statement_id": "FS-CAUSE",
                "relation": "higher_cause_to_lower_mode",
                "source": cause_source,
                "target": mode_target,
                "analysis_relation_id": "REL-1",
                "function_mapping_id": "MAP-1",
                "status": "active",
                "source_revision": "A",
                "target_revision": "A",
                "created_at": "2026-07-26T12:00:00Z",
            },
        ],
        "history": [],
        "endpoints": [
            {
                **mode_source,
                "statement_id": "FS-MODE",
                "text": "No output",
                "analysis_kind": "dfmea",
                "analysis_revision": "A",
                "lifecycle_status": "draft",
                "function_id": "FN-1",
                "structure_node_id": "ST-1",
            },
            {
                **cause_source,
                "statement_id": "FS-CAUSE",
                "text": "Open circuit",
                "analysis_kind": "dfmea",
                "analysis_revision": "A",
                "lifecycle_status": "draft",
                "function_id": "FN-1",
                "structure_node_id": "ST-1",
            },
            {
                **effect_target,
                "statement_id": "FS-MODE",
                "text": "No output",
                "analysis_kind": "dfmea",
                "analysis_revision": "A",
                "lifecycle_status": "draft",
                "function_id": "FN-LOW",
                "structure_node_id": "ST-LOW",
            },
            {
                **mode_target,
                "statement_id": "FS-CAUSE",
                "text": "Open circuit",
                "analysis_kind": "dfmea",
                "analysis_revision": "A",
                "lifecycle_status": "draft",
                "function_id": "FN-LOW",
                "structure_node_id": "ST-LOW",
            },
        ],
    }


def _study_with_failure_flow():
    study = _study()
    study["model"]["failure_chains"][0].update({
        "failure_mode_statement_id": "FS-MODE",
        "cause_statement_id": "FS-CAUSE",
    })
    study["failure_flow"] = _flow_snapshot()
    return study


def test_failure_flow_accepts_explicit_mode_effect_and_cause_mode_links():
    study = _study_with_failure_flow()
    result = validate_failure_flow(study)
    assert result["findings"] == []
    assert result["summary"] == {
        "statements": 2,
        "active_links": 2,
        "detached_links": 0,
        "mapped_analyses": 1,
        "coverage_gaps": 0,
    }
    analyzed = analyze_studies([study])["studies"][0]
    assert analyzed["failure_flow"]["active_links"] == 2
    assert analyzed["failure_flow_snapshot"]["owner"]["analysis_id"] == "DFMEA-1"


def test_failure_flow_rejects_reversed_roles_and_hierarchy_cycles():
    study = _study_with_failure_flow()
    study["failure_flow"]["edges"][0]["source"]["role"] = "effect"
    study["failure_flow"]["analysis_relations"].append({
        "id": "REL-2",
        "parent": {"folio_id": "FOLIO-LOW", "analysis_id": "DFMEA-2"},
        "child": {"folio_id": "FOLIO-HIGH", "analysis_id": "DFMEA-1"},
        "mappings": [],
        "created_at": "2026-07-26T12:00:00Z",
    })
    codes = {
        item["code"] for item in validate_failure_flow(study)["findings"]
    }
    assert "reversed_failure_flow_edge" in codes
    assert "failure_flow_hierarchy_cycle" in codes


def test_failure_flow_stale_revision_escalates_after_draft():
    study = _study_with_failure_flow()
    for endpoint in study["failure_flow"]["endpoints"]:
        if endpoint["analysis_id"] == "DFMEA-2":
            endpoint["analysis_revision"] = "B"
    draft_findings = validate_failure_flow(study)["findings"]
    stale_draft = [
        item for item in draft_findings
        if item["code"] == "stale_failure_flow_link"
    ]
    assert len(stale_draft) == 2
    assert {item["severity"] for item in stale_draft} == {"warning"}

    study["lifecycle_status"] = "in_review"
    controlled_findings = validate_failure_flow(study)["findings"]
    stale_controlled = [
        item for item in controlled_findings
        if item["code"] == "stale_failure_flow_link"
    ]
    assert {item["severity"] for item in stale_controlled} == {"error"}


def test_cross_analysis_flow_requires_its_exact_function_mapping():
    study = _study_with_failure_flow()
    study["failure_flow"]["edges"][0].pop("function_mapping_id")
    study["failure_flow"]["edges"][1]["function_mapping_id"] = "UNKNOWN"
    findings = validate_failure_flow(study)["findings"]
    assert sum(
        item["code"] == "failure_flow_function_mapping_missing"
        for item in findings
    ) == 2


def test_failure_flow_large_hierarchy_cycle_check_is_non_recursive():
    study = _study()
    study["failure_flow"] = {
        "schema_version": 1,
        "owner": {
            "folio_id": "FOLIO-HIGH",
            "analysis_id": "DFMEA-1",
        },
        "statements": [],
        "analysis_relations": [{
            "id": f"REL-{index}",
            "parent": {
                "folio_id": "PORTFOLIO",
                "analysis_id": f"DFMEA-{index}",
            },
            "child": {
                "folio_id": "PORTFOLIO",
                "analysis_id": f"DFMEA-{index + 1}",
            },
            "mappings": [],
            "created_at": "2026-07-26T12:00:00Z",
        } for index in range(1500)],
        "edges": [],
        "history": [],
        "endpoints": [],
    }
    codes = {
        item["code"] for item in validate_failure_flow(study)["findings"]
    }
    assert "failure_flow_hierarchy_cycle" not in codes


def test_failure_flow_is_part_of_the_controlled_content_hash():
    study = _study_with_failure_flow()
    before = study_sha256(study)
    revision = create_revision(
        study, created_by="Analyst",
        change_summary="Capture linked hierarchy.",
    )
    assert revision["snapshot"]["failure_flow"]["edges"][0][
        "statement_id"] == "FS-MODE"
    study["failure_flow"]["statements"][0]["text"] = "Output absent"
    assert study_sha256(study) != before


def test_method_profiles_are_checksummed_and_reference_gated():
    first = method_profiles()
    second = method_profiles()
    assert first == second
    assert len({item["checksum"] for item in first}) == len(first)
    assert next(item for item in first if item["id"] == "aiag_vda_2019_public")[
        "status"] == "preview_public_alignment"
    assert all(
        item["status"] == "reference_gated"
        for item in first if item["family"] in {"sae", "iec", "military",
                                                "functional_safety"}
    )


def test_semantic_diff_uses_record_identity_and_ignores_reordering():
    before = {"rows": [{"id": "A", "value": 1}, {"id": "B", "value": 2}]}
    reordered = {"rows": [{"id": "B", "value": 2}, {"id": "A", "value": 1}]}
    assert semantic_diff(before, reordered) == []
    changed = deepcopy(reordered)
    changed["rows"][0]["value"] = 3
    assert semantic_diff(before, changed) == [{
        "path": "rows.B.value",
        "change": "modified",
        "before": 2,
        "after": 3,
    }]


def test_evidence_integrity_finds_dangling_and_unbaselined_links():
    study = _study()
    study["evidence_links"] = [{
        "id": "EV-1",
        "target_id": "UNKNOWN",
        "source_module": "prediction",
        "source_analysis_id": "PRED-1",
        "evidence_kind": "rate",
        "claim": "Part failure rate",
        "locator": "Part R1",
        "captured_at": "2026-07-25T00:00:00Z",
        "stale": False,
    }]
    codes = {item["code"] for item in validate_evidence(study)}
    assert codes == {
        "dangling_evidence_target", "unbaselined_evidence",
        "evidence_units_missing", "evidence_revision_missing",
    }


def test_fmeda_conserves_rates_and_reports_residual_metrics():
    result = analyze_fmeda([{
        "id": "R1", "label": "Resistor", "failure_rate_per_hour": 2e-7,
        "exposure_fraction": 1, "allocation_complete": True,
    }], [
        {
            "id": "FM-1", "source_id": "R1", "description": "Open",
            "mode_fraction": 0.25,
            "classification": "single_point", "diagnostic_coverage": 0.9,
            "evidence_link_ids": [], "notes": "",
        },
        {
            "id": "FM-2", "source_id": "R1", "description": "Benign drift",
            "mode_fraction": 0.75,
            "classification": "safe", "diagnostic_coverage": 0,
            "evidence_link_ids": [], "notes": "",
        },
    ])
    assert result["totals"]["source_rate"] == pytest.approx(2e-7)
    assert result["totals"]["single_point_residual"] == pytest.approx(5e-9)
    assert result["metrics"]["diagnostic_coverage"] == pytest.approx(0.9)
    assert result["metrics"]["single_point_fault_metric"] == pytest.approx(0.975)
    assert result["issues"] == []


def test_fmeda_rejects_overallocated_source_fraction():
    result = analyze_fmeda([{
        "id": "R1", "label": "Resistor", "failure_rate_per_hour": 1e-7,
        "exposure_fraction": 1, "allocation_complete": True,
    }], [
        {
            "id": f"FM-{index}", "source_id": "R1", "description": "",
            "mode_fraction": 0.6,
            "classification": "safe", "diagnostic_coverage": 0,
            "evidence_link_ids": [], "notes": "",
        }
        for index in range(2)
    ])
    assert result["issues"][0]["code"] == "mode_fraction_overallocated"


def test_process_verification_and_characteristic_flowdown_is_validated():
    study = _study()
    study["process_steps"] = [{
        "id": "PS-1", "sequence": 1, "name": "Assemble",
        "step_type": "operation", "predecessor_ids": ["PS-1"],
        "product_characteristic": "", "process_characteristic": "",
        "notes": "",
    }]
    study["verification_plan"] = [{
        "id": "DVP-1", "objective": "Verify output",
        "requirement_ids": ["REQ-1"], "failure_chain_ids": ["FC-1"],
        "method": "Functional test", "level": "system", "sample_size": "3",
        "acceptance_criteria": "All pass", "owner": "Test",
        "status": "passed", "evidence_link_ids": [],
    }]
    study["special_characteristics"] = [{
        "id": "SC-1", "symbol": "SC", "name": "Output",
        "classification": "safety", "requirement_ids": [],
        "failure_chain_ids": [], "process_step_ids": ["PS-1"],
        "control_plan_row_ids": [], "status": "approved", "rationale": "",
    }]
    codes = {item["code"] for item in validate_flowdown(study)}
    assert codes == {
        "process_self_predecessor",
        "process_flow_cycle",
        "verification_result_without_evidence",
        "untraced_special_characteristic",
    }


def test_revision_release_and_verification_are_content_addressed():
    study = _study()
    analysis = analyze_studies([study])["studies"][0]
    assert analysis["release_ready"] is True
    revision = create_revision(
        study, created_by="A. Reviewer", change_summary="Initial baseline")
    assert revision["content_sha256"] == study_sha256(study)
    study["revisions"].append(revision)
    attestation = {
        "id": "ATT-1",
        "role": "approver",
        "name": "A. Reviewer",
        "decision": "approved",
        "statement": "Reviewed and approved.",
        "timestamp": "2026-07-25T00:00:00Z",
        "identity_assurance": "named_local",
    }
    study = transition_lifecycle(
        study, target_status="in_review", actor="A. Reviewer",
        rationale="Ready for review")
    study = transition_lifecycle(
        study, target_status="approved", actor="A. Reviewer",
        rationale="Approved", attestations=[attestation])
    release = create_release(
        study,
        rating_profiles=[],
        program_requirements=[],
        software_version="0.7.0",
        software_commit="abc123",
        attestations=[attestation],
    )
    assert release["assurance"] == "named_local"
    assert verify_release(study, release)["valid"] is True
    study["model"]["failure_chains"][0]["cause"] = "Changed cause"
    verification = verify_release(study, release)
    assert verification["valid"] is False
    assert verification["content_matches"] is False


def test_reference_gated_profile_blocks_release_readiness():
    study = _study()
    study["method_profile_id"] = "iso_26262_2018_fmeda"
    result = analyze_studies([study])["studies"][0]
    assert result["release_ready"] is False
    assert result["findings"][0]["code"] == "method_reference_gated"


def test_release_requires_an_approving_attestation():
    study = _study()
    revision = create_revision(
        study, created_by="Reviewer", change_summary="Baseline")
    study["revisions"].append(revision)
    study = transition_lifecycle(
        study, target_status="in_review", actor="Reviewer",
        rationale="Ready for review")
    study["lifecycle_status"] = "approved"
    with pytest.raises(ValueError, match="approving approver"):
        create_release(
            study,
            rating_profiles=[],
            program_requirements=[],
            software_version="0.7.0",
            software_commit="abc123",
            attestations=[{
                "id": "ATT-1",
                "role": "reviewer",
                "name": "Reviewer",
                "decision": "prepared",
                "statement": "Prepared.",
                "timestamp": "2026-07-25T00:00:00Z",
                "identity_assurance": "named_local",
            }],
        )


def test_fmeda_uncertainty_dependency_and_mission_terms_are_explicit():
    result = analyze_fmeda([{
        "id": "IC1", "label": "Controller",
        "failure_rate_per_hour": 1e-6,
        "lower_rate_per_hour": 0.8e-6,
        "upper_rate_per_hour": 1.3e-6,
        "exposure_fraction": 0.5,
        "mission_time_hours": 1000,
        "allocation_complete": True,
    }], [{
        "id": "FM-1", "source_id": "IC1", "description": "Loss",
        "mode_fraction": 1, "classification": "single_point",
        "diagnostic_coverage": 0.9, "dependent_failure_fraction": 0.1,
        "common_cause_group_id": "CCF-A",
    }])
    expected_residual_fraction = 0.1 + 0.9 * 0.1
    expected_rate = 0.5e-6 * expected_residual_fraction
    assert result["metrics"]["residual_rate_per_hour"] == pytest.approx(
        expected_rate)
    assert result["uncertainty"][
        "residual_rate_lower_per_hour"] == pytest.approx(
            0.4e-6 * expected_residual_fraction)
    assert result["metrics"]["mission_residual_probability"] == pytest.approx(
        1 - __import__("math").exp(-expected_rate * 1000))
    assert result["common_cause_groups"][0]["group_id"] == "CCF-A"


def test_lifecycle_requires_revision_and_approval_attestation():
    study = _study()
    with pytest.raises(ValueError, match="Capture"):
        transition_lifecycle(
            study, target_status="in_review", actor="Reviewer",
            rationale="Ready")
    study["revisions"].append(create_revision(
        study, created_by="Reviewer", change_summary="Baseline"))
    review = transition_lifecycle(
        study, target_status="in_review", actor="Reviewer", rationale="Ready")
    with pytest.raises(ValueError, match="approving reviewer or approver"):
        transition_lifecycle(
            review, target_status="approved", actor="Reviewer",
            rationale="Approved")


def test_evidence_impact_reports_changed_source_without_rewriting_model():
    study = _study()
    study["evidence_links"] = [{
        "id": "EV-1", "target_id": "FC-1",
        "source_module": "prediction", "source_analysis_id": "PRED-1",
        "source_record_id": "R1", "source_revision": "A",
        "source_checksum": "a" * 64, "evidence_kind": "rate",
        "claim": "Failure rate", "locator": "R1", "units": "failures/hour",
        "captured_at": "2026-07-25T00:00:00Z", "stale": False,
    }]
    before = deepcopy(study["model"])
    result = evidence_impact(study, [{
        "source_module": "prediction", "source_analysis_id": "PRED-1",
        "source_record_id": "R1", "source_revision": "B",
        "source_checksum": "b" * 64,
    }])
    assert result["affected_target_ids"] == ["FC-1"]
    assert result["count"] == 1
    assert study["model"] == before


def test_released_family_instantiation_rekeys_all_internal_links():
    study = _study()
    item = prepare_library_item({
        "id": "LIB-1", "name": "Output stage", "kind": "family",
        "version": "1", "status": "released", "description": "",
        "tags": [], "applicability": {},
        "content": {
            "structure_nodes": [{
                "id": "ST-X", "name": "Output", "level": "focus",
            }],
            "functions": [{
                "id": "FN-X", "structure_node_id": "ST-X",
                "description": "Provide output", "function_type": "primary",
            }],
        },
    })
    result = instantiate_library_item(study, item, instance_id="INST-1")
    added = result["study"]["model"]["functions"][-1]
    assert added["id"] == "INST-1:FN-X"
    assert added["structure_node_id"] == "INST-1:ST-X"
    assert result["instance"]["library_checksum"] == item["checksum"]


def test_guidance_only_proposes_rating_when_evidence_states_it():
    study = _study()
    study["evidence_links"] = [{
        "id": "EV-RATING", "target_id": "FC-1",
        "source_module": "external", "source_analysis_id": "criterion",
        "evidence_kind": "rationale", "claim": "Severity criterion maps to 4",
        "locator": "customer-profile:S4", "captured_at": "2026-07-25T00:00:00Z",
        "stale": False, "rating_dimension": "severity", "rating_value": 4,
    }]
    before = study["model"]["failure_chains"][0]["severity"]
    result = generate_suggestions(study)
    proposal = next(
        item for item in result["suggestions"]
        if item["kind"] == "rating_proposal")
    assert proposal["proposed_value"] == 4
    assert proposal["evidence_link_ids"] == ["EV-RATING"]
    assert study["model"]["failure_chains"][0]["severity"] == before
    assert result["applied"] is False


def test_fmeda_enterprise_scale_pass_is_linear_and_bounded():
    count = 10_000
    sources = [{
        "id": f"S-{index}", "label": f"Source {index}",
        "failure_rate_per_hour": 1e-8,
        "exposure_fraction": 1, "allocation_complete": True,
    } for index in range(count)]
    modes = [{
        "id": f"M-{index}", "source_id": f"S-{index}",
        "description": "Allocated mode", "mode_fraction": 1,
        "classification": "safe", "diagnostic_coverage": 0,
    } for index in range(count)]
    started = perf_counter()
    result = analyze_fmeda(sources, modes)
    elapsed = perf_counter() - started
    assert len(result["rows"]) == count
    assert result["issues"] == []
    assert result["totals"]["source_rate"] == pytest.approx(count * 1e-8)
    assert elapsed < 5
