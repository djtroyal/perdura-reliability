"""Independent boundary and workflow checks for AIAG–VDA-aligned FMEA."""

import pytest

from reliability.AIAG_VDA_FMEA import (
    action_priority_sfm,
    action_priority_sod,
    analyze_aiag_vda_fmea,
    builtin_rating_profiles,
)


def _analysis(kind="dfmea"):
    ratings = (
        {"frequency": 3, "monitoring": 4}
        if kind == "fmea_msr"
        else {"occurrence": 4, "detection": 7}
    )
    analysis = {
        "id": f"{kind}-1",
        "name": f"Example {kind.upper()}",
        "kind": kind,
        "revision": "A",
        "status": "draft",
        "planning": {
            "subject": "Pump controller",
            "scope": "Power input through commanded output",
            "intent": "Prevent loss of commanded operation",
            "team": ["Design", "Manufacturing", "Quality"],
        },
        "structure_nodes": [{
            "id": "ST-1",
            "name": "Controller" if kind != "pfmea" else "Assembly step",
            "level": "focus" if kind != "pfmea" else "process_step",
        }],
        "block_diagram": {
            "version": 2,
            "boundary": {
                "label": "Pump controller",
                "x": 40,
                "y": 40,
                "width": 720,
                "height": 440,
            },
            "nodes": [
                {
                    "id": "BDN-1",
                    "kind": "structure",
                    "structure_node_id": "ST-1",
                    "label": "Controller",
                    "x": 260,
                    "y": 180,
                    "width": 180,
                    "height": 72,
                    "inside_boundary": True,
                },
                {
                    "id": "BDX-1",
                    "kind": "external",
                    "external_kind": "adjacent_system",
                    "label": "Supervisory controller",
                    "x": 20,
                    "y": 180,
                    "width": 180,
                    "height": 72,
                    "inside_boundary": False,
                },
            ],
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "snap_to_grid": True,
        },
        "functions": [{
            "id": "FN-1",
            "structure_node_id": "ST-1",
            "description": "Deliver commanded output",
            "function_type": "primary",
            "operating_modes": ["normal"],
            "owner": "Systems",
            "notes": "",
        }],
        "function_links": [],
        "functional_requirements": [{
            "id": "FREQ-1",
            "statement": "Commanded output remains within tolerance",
            "requirement_type": "performance",
            "measure": "Output error",
            "target": "±2%",
            "unit": "%",
            "acceptance_criteria": "Absolute error no greater than 2%",
            "operating_condition": "Normal operation",
            "source": "System requirement SYS-1",
            "owner": "Systems",
            "confidence": "",
            "verification_method": "Functional test",
            "evidence_ids": [],
            "special_characteristic": "",
        }],
        "function_requirement_links": [{
            "id": "FRC-1",
            "function_id": "FN-1",
            "requirement_id": "FREQ-1",
            "strength": "strong",
            "rationale": "Direct performance requirement",
        }],
        "interfaces": [{
            "id": "IF-1",
            "name": "Command input",
            "interface_type": "information",
            "source_block_id": "BDX-1",
            "target_block_id": "BDN-1",
            "linkage": "direct",
            "directionality": "directed",
            "relationship_strength": "strong",
            "relationship_nature": "beneficial",
            "interface_detail": "Digital command",
            "external_source": "Supervisory controller",
            "target_structure_node_id": "ST-1",
            "external_target": "",
            "flow_description": "Command signal",
            "operating_condition": "Normal operation",
            "function_ids": ["FN-1"],
            "requirement_ids": ["FREQ-1"],
        }],
        "p_diagrams": [{
            "id": "PD-1",
            "title": "Commanded output",
            "primary_function_id": "FN-1",
            "supporting_function_ids": [],
            "items": [
                {"id": "PDI-1", "category": "signal_input",
                 "label": "Command", "description": "",
                 "requirement_ids": ["FREQ-1"]},
                {"id": "PDI-2", "category": "intended_output",
                 "label": "Controlled output", "description": "",
                 "requirement_ids": ["FREQ-1"]},
                {"id": "PDI-3", "category": "control_factor",
                 "label": "Control gain", "description": "",
                 "requirement_ids": []},
                {"id": "PDI-4", "category": "noise_factor",
                 "label": "Supply variation", "description": "",
                 "requirement_ids": []},
                {"id": "PDI-5", "category": "error_state",
                 "label": "Output error", "description": "",
                 "requirement_ids": ["FREQ-1"]},
            ],
        }],
        "failure_chains": [{
            "id": "FC-1",
            "function_id": "FN-1",
            "effect": "Loss of pumping",
            "failure_mode": "No output",
            "cause": "Open connection",
            "severity": 8,
            **ratings,
            "prevention_controls": "Qualified interconnect",
            "detection_controls": "End-of-line functional test",
            "actions": [{
                "id": "ACT-1",
                "kind": "prevention",
                "description": "Improve strain relief",
                "status": "decision_pending",
                "owner": "Design",
                "target_date": "2099-12-31",
            }],
        }],
        "control_plan": [],
    }
    if kind == "fmea_msr":
        analysis["standalone_justification"] = (
            "Standalone service-monitoring assessment for a legacy controller."
        )
    return analysis


@pytest.mark.parametrize(
    ("s", "o", "d", "expected"),
    [
        (10, 4, 1, "M"),
        (10, 4, 2, "H"),
        (9, 2, 4, "L"),
        (9, 2, 5, "M"),
        (9, 2, 7, "H"),
        (7, 4, 6, "M"),
        (7, 4, 7, "H"),
        (4, 6, 1, "L"),
        (4, 6, 2, "M"),
        (2, 8, 4, "L"),
        (2, 8, 5, "M"),
        (1, 10, 10, "L"),
        (10, 1, 10, "L"),
    ],
)
def test_dfmea_pfmea_action_priority_boundaries(s, o, d, expected):
    assert action_priority_sod(s, o, d) == expected


@pytest.mark.parametrize(
    ("s", "f", "m", "expected"),
    [
        (10, 4, 1, "M"),
        (10, 4, 2, "H"),
        (10, 3, 1, "L"),
        (10, 3, 2, "M"),
        (10, 3, 4, "H"),
        (9, 3, 1, "L"),
        (9, 3, 2, "H"),
        (8, 5, 5, "M"),
        (8, 5, 6, "H"),
        (7, 4, 3, "L"),
        (7, 4, 4, "M"),
        (7, 4, 7, "H"),
        (4, 5, 5, "M"),
        (4, 5, 6, "H"),
        (2, 7, 6, "H"),
        (2, 6, 6, "L"),
        (2, 6, 7, "M"),
        (1, 10, 10, "L"),
    ],
)
def test_msr_action_priority_boundaries(s, f, m, expected):
    assert action_priority_sfm(s, f, m) == expected


def test_every_action_priority_combination_is_covered():
    assert {
        action_priority_sod(s, o, d)
        for s in range(1, 11)
        for o in range(1, 11)
        for d in range(1, 11)
    } == {"H", "M", "L"}


def test_complete_sod_lookup_matches_published_grouped_chart():
    severity_groups = [
        (range(9, 11), ["HHHH", "HHHH", "HHHM", "HMLL", "LLLL"]),
        (range(7, 9), ["HHHH", "HHHM", "HMMM", "MMLL", "LLLL"]),
        (range(4, 7), ["HHMM", "MMML", "MLLL", "LLLL", "LLLL"]),
        (range(2, 4), ["MMLL", "LLLL", "LLLL", "LLLL", "LLLL"]),
        (range(1, 2), ["LLLL", "LLLL", "LLLL", "LLLL", "LLLL"]),
    ]
    occurrence_groups = [range(8, 11), range(6, 8), range(4, 6),
                         range(2, 4), range(1, 2)]
    detection_groups = [range(7, 11), range(5, 7), range(2, 5),
                        range(1, 2)]
    for severities, rows in severity_groups:
        for occurrences, expected_row in zip(occurrence_groups, rows):
            for detections, expected in zip(detection_groups, expected_row):
                for s in severities:
                    for o in occurrences:
                        for d in detections:
                            assert action_priority_sod(s, o, d) == expected


def test_complete_sfm_lookup_matches_published_grouped_chart():
    monitoring_groups = [
        range(9, 11), range(7, 9), range(6, 7), range(5, 6),
        range(4, 5), range(2, 4), range(1, 2),
    ]
    # Rows are listed from higher to lower frequency within each severity band.
    grouped = [
        (range(10, 11), [
            (range(5, 11), "HHHHHHH"), (range(4, 5), "HHHHHHM"),
            (range(3, 4), "HHHHHML"), (range(2, 3), "MMMMMLL"),
            (range(1, 2), "LLLLLLL"),
        ]),
        (range(9, 10), [
            (range(4, 11), "HHHHHHH"), (range(2, 4), "HHHHHHL"),
            (range(1, 2), "LLLLLLL"),
        ]),
        (range(7, 9), [
            (range(6, 11), "HHHHHHH"), (range(5, 6), "HHHMMMM"),
            (range(4, 5), "HHMMMLL"), (range(3, 4), "HMLLLLL"),
            (range(2, 3), "MMLLLLL"), (range(1, 2), "LLLLLLL"),
        ]),
        (range(4, 7), [
            (range(7, 11), "HHHHHHH"), (range(5, 7), "HHHMMMM"),
            (range(2, 5), "MMLLLLL"), (range(1, 2), "LLLLLLL"),
        ]),
        (range(2, 4), [
            (range(7, 11), "HHHHHHH"), (range(5, 7), "MMLLLLL"),
            (range(2, 5), "LLLLLLL"), (range(1, 2), "LLLLLLL"),
        ]),
        (range(1, 2), [(range(1, 11), "LLLLLLL")]),
    ]
    for severities, frequency_rows in grouped:
        for frequencies, expected_row in frequency_rows:
            for monitoring, expected in zip(monitoring_groups, expected_row):
                for s in severities:
                    for f in frequencies:
                        for m in monitoring:
                            assert action_priority_sfm(s, f, m) == expected
    assert {
        action_priority_sfm(s, f, m)
        for s in range(1, 11)
        for f in range(1, 11)
        for m in range(1, 11)
    } == {"H", "M", "L"}


def test_msr_monitoring_one_uses_mitigated_effect_severity():
    assert action_priority_sfm(
        10, 5, 1, mitigated_severity=1) == "L"
    analysis = _analysis("fmea_msr")
    chain = analysis["failure_chains"][0]
    chain.update({
        "severity": 10,
        "frequency": 5,
        "monitoring": 1,
        "mitigated_effect": "No discernible effect after safe response",
        "mitigated_severity": 1,
    })
    result = analyze_aiag_vda_fmea([analysis])["analyses"][0]
    assert result["failure_chains"][0]["action_priority"] == "L"
    assert result["failure_chains"][0]["action_priority_severity"] == 1


def test_msr_monitoring_one_requires_mitigated_effect_basis():
    analysis = _analysis("fmea_msr")
    analysis["failure_chains"][0]["monitoring"] = 1
    result = analyze_aiag_vda_fmea([analysis])["analyses"][0]
    assert "missing_mitigated_effect" in {
        issue["code"] for issue in result["issues"]
    }


def test_aiag_result_uses_ap_not_rpn_and_reports_step_readiness():
    result = analyze_aiag_vda_fmea([_analysis()])
    analysis = result["analyses"][0]
    chain = analysis["failure_chains"][0]
    assert chain["action_priority"] == "H"
    assert "rpn" not in chain
    assert analysis["methodology"]["rpn_calculated"] is False
    assert len(analysis["step_readiness"]) == 7
    assert analysis["rating_profile"]["checksum"]


def test_planning_completeness_prompts_are_non_blocking_warnings():
    analysis = _analysis()
    analysis["planning"] = {
        **analysis["planning"],
        "subject": "",
        "scope": "",
        "intent": "",
        "team": [],
    }
    result = analyze_aiag_vda_fmea([analysis])["analyses"][0]
    expected = {
        "missing_subject", "missing_scope", "missing_intent", "missing_team",
    }
    findings = {
        issue["code"]: issue for issue in result["issues"]
        if issue["code"] in expected
    }
    assert set(findings) == expected
    assert all(item["severity"] == "warning" for item in findings.values())
    assert result["step_readiness"][0] == {
        "step": 1, "ready": True, "errors": 0, "warnings": 4,
    }
    assert result["finalization_ready"] is True


def test_primary_function_requirement_gap_is_a_non_blocking_warning():
    analysis = _analysis()
    analysis["function_requirement_links"] = []
    result = analyze_aiag_vda_fmea([analysis])["analyses"][0]
    finding = next(issue for issue in result["issues"]
                   if issue["code"] == "primary_function_without_requirement")
    assert finding["severity"] == "warning"
    step = result["step_readiness"][2]
    assert step["ready"] is True
    assert step["errors"] == 0
    assert step["warnings"] >= 1
    assert result["finalization_ready"] is True


def test_high_ap_requires_action_or_explicit_disposition():
    analysis = _analysis()
    analysis["failure_chains"][0]["actions"] = []
    result = analyze_aiag_vda_fmea([analysis])["analyses"][0]
    assert "high_ap_without_disposition" in {
        issue["code"] for issue in result["issues"]
    }
    assert result["finalization_ready"] is False


def test_pfmea_control_plan_review_is_explicit_and_non_destructive():
    analysis = _analysis("pfmea")
    result = analyze_aiag_vda_fmea([analysis])["analyses"][0]
    review = result["control_plan_review"][0]
    assert review["status"] == "missing"
    assert review["proposal"]["failure_chain_id"] == "FC-1"
    assert review["proposal"]["process_step"] == "Assembly step"
    assert review["proposal"]["reaction_plan"] == ""
    assert analysis["control_plan"] == []


def test_msr_source_revision_staleness_is_reported():
    parent = _analysis("dfmea")
    child = _analysis("fmea_msr")
    child["parent_dfmea_id"] = parent["id"]
    child["source_revision"] = "previous"
    child["standalone_justification"] = ""
    result = analyze_aiag_vda_fmea([parent, child])
    msr = next(item for item in result["analyses"] if item["kind"] == "fmea_msr")
    assert "stale_msr_source" in {issue["code"] for issue in msr["issues"]}


def test_built_in_profiles_are_versioned_and_checksummed():
    profiles = builtin_rating_profiles()
    assert {profile["kind"] for profile in profiles} == {
        "dfmea", "pfmea", "fmea_msr",
    }
    assert all(len(profile["checksum"]) == 64 for profile in profiles)
    assert all(profile["version"] == "1.0" for profile in profiles)


def test_custom_profile_cannot_replace_perdura_builtin():
    profile = builtin_rating_profiles()[0]
    with pytest.raises(ValueError, match="reserved"):
        analyze_aiag_vda_fmea([], rating_profiles=[profile])


def test_pfmea_work_elements_require_a_4m_type():
    analysis = _analysis("pfmea")
    analysis["structure_nodes"].append({
        "id": "ST-2",
        "name": "Torque fasteners",
        "level": "work_element",
        "parent_id": "ST-1",
    })
    result = analyze_aiag_vda_fmea([analysis])["analyses"][0]
    assert "missing_4m_element_type" in {
        issue["code"] for issue in result["issues"]
    }


def test_structure_drafts_return_readiness_issue_for_blank_name():
    analysis = _analysis()
    analysis["structure_nodes"][0]["name"] = ""
    result = analyze_aiag_vda_fmea([analysis])["analyses"][0]
    assert "missing_structure_name" in {
        issue["code"] for issue in result["issues"]
    }


def test_chain_severity_must_follow_most_severe_effect_context():
    analysis = _analysis()
    analysis["failure_chains"][0]["effect_contexts"] = [
        {
            "id": "EC-1",
            "context": "Next higher level",
            "description": "Controller reset",
            "severity": 6,
        },
        {
            "id": "EC-2",
            "context": "End user",
            "description": "Loss of pumping",
            "severity": 9,
        },
    ]
    result = analyze_aiag_vda_fmea([analysis])["analyses"][0]
    assert "severity_not_most_severe_effect" in {
        issue["code"] for issue in result["issues"]
    }


def test_blank_action_does_not_dispose_high_action_priority():
    analysis = _analysis()
    analysis["failure_chains"][0]["actions"] = [{
        "id": "ACT-BLANK",
        "description": "",
        "status": "open",
    }]
    result = analyze_aiag_vda_fmea([analysis])["analyses"][0]
    codes = {issue["code"] for issue in result["issues"]}
    assert "high_ap_without_disposition" in codes
    assert "missing_action_description" in codes


def test_custom_profile_must_define_all_ratings_and_correct_ap_model():
    profile = builtin_rating_profiles()[0]
    profile["id"] = "organization-dfmea-v1"
    profile["built_in"] = False
    profile["approved"] = False
    profile["rating_axes"]["severity"] = profile["rating_axes"]["severity"][:-1]
    profile.pop("checksum")
    with pytest.raises(ValueError, match="each rating 1–10"):
        analyze_aiag_vda_fmea([], rating_profiles=[profile])

    profile = builtin_rating_profiles()[0]
    profile["id"] = "organization-dfmea-v2"
    profile["built_in"] = False
    profile["approved"] = False
    profile["ap_model"] = "aiag_vda_sfm_2019"
    profile.pop("checksum")
    with pytest.raises(ValueError, match="aiag_vda_sod_2019"):
        analyze_aiag_vda_fmea([], rating_profiles=[profile])


def test_function_analysis_blocks_missing_primary_requirement_and_cycles():
    analysis = _analysis()
    analysis["functions"].append({
        "id": "FN-2",
        "structure_node_id": "ST-1",
        "description": "Monitor output",
        "function_type": "primary",
        "operating_modes": [],
        "owner": "",
        "notes": "",
    })
    analysis["function_links"] = [
        {"id": "FL-1", "source_function_id": "FN-1",
         "target_function_id": "FN-2", "relationship": "decomposes_to"},
        {"id": "FL-2", "source_function_id": "FN-2",
         "target_function_id": "FN-1", "relationship": "decomposes_to"},
    ]
    result = analyze_aiag_vda_fmea([analysis])["analyses"][0]
    codes = {issue["code"] for issue in result["issues"]}
    assert "primary_function_without_requirement" in codes
    assert "function_decomposition_cycle" in codes
    assert result["function_analysis_summary"]["functions"] == 2
    assert result["finalization_ready"] is False


def test_linked_program_requirement_reports_sync_and_staleness():
    source = {
        "id": "REQ-1",
        "statement": "Output remains available",
        "measure": "Availability",
        "target": "0.999",
        "confidence": "90%",
        "mission_profile": "10 h mission",
        "failure_definition": "Loss of commanded output",
        "verification_method": "Reliability demonstration",
        "owner": "Systems",
        "status": "approved",
        "evidence_ids": ["TEST-1"],
    }
    analysis = _analysis()
    requirement = analysis["functional_requirements"][0]
    requirement.update({
        "statement": source["statement"],
        "measure": source["measure"],
        "target": source["target"],
        "confidence": source["confidence"],
        "operating_condition": source["mission_profile"],
        "acceptance_criteria": source["failure_definition"],
        "verification_method": source["verification_method"],
        "owner": source["owner"],
        "evidence_ids": source["evidence_ids"],
        "linked_program_requirement_id": source["id"],
    })
    unbaselined = analyze_aiag_vda_fmea(
        [analysis], program_requirements=[source])["analyses"][0]
    assert unbaselined["requirement_sync"][0]["status"] == "unbaselined"
    requirement["source_checksum"] = (
        unbaselined["requirement_sync"][0]["current_checksum"])
    in_sync = analyze_aiag_vda_fmea(
        [analysis], program_requirements=[source])["analyses"][0]
    assert in_sync["requirement_sync"][0]["status"] == "in_sync"

    changed = {**source, "target": "0.9999"}
    stale = analyze_aiag_vda_fmea(
        [analysis], program_requirements=[changed])["analyses"][0]
    assert stale["requirement_sync"][0]["status"] == "stale"
    assert stale["requirement_sync"][0]["differences"][0]["field"] == "target"


def test_interface_requires_existing_diagram_endpoints():
    analysis = _analysis()
    interface = analysis["interfaces"][0]
    interface["source_block_id"] = "BDX-missing"
    result = analyze_aiag_vda_fmea([analysis])["analyses"][0]
    assert "unknown_interface_source_block" in {
        issue["code"] for issue in result["issues"]
    }


def test_parallel_diagram_interfaces_are_valid_and_traced():
    analysis = _analysis()
    second = {
        **analysis["interfaces"][0],
        "id": "IF-2",
        "name": "Status output",
        "directionality": "bidirectional",
        "flow_description": "Command acknowledgement",
    }
    analysis["interfaces"].append(second)
    result = analyze_aiag_vda_fmea([analysis])["analyses"][0]
    codes = {issue["code"] for issue in result["issues"]}
    assert "interface_self_connection" not in codes
    assert "unknown_interface_source_block" not in codes
    coverage = result["function_coverage"][0]
    assert coverage["interface_ids"] == ["IF-1", "IF-2"]


def test_block_diagram_accepts_direct_structure_containment():
    analysis = _analysis()
    analysis["structure_nodes"].append({
        "id": "ST-2",
        "name": "Control board",
        "level": "subsystem",
        "parent_id": "ST-1",
    })
    analysis["block_diagram"]["nodes"][0]["expanded"] = False
    analysis["block_diagram"]["nodes"].append({
        "id": "BDN-2",
        "kind": "structure",
        "structure_node_id": "ST-2",
        "container_parent_block_id": "BDN-1",
        "expanded": False,
        "label": "Control board",
        "x": 280,
        "y": 270,
        "width": 180,
        "height": 72,
        "inside_boundary": True,
    })
    analysis["interfaces"][0].update({
        "target_block_id": "BDN-2",
        "target_structure_node_id": "ST-2",
    })
    result = analyze_aiag_vda_fmea([analysis])["analyses"][0]
    codes = {issue["code"] for issue in result["issues"]}
    assert "diagram_container_missing" not in codes
    assert "diagram_container_mismatch" not in codes
    assert "diagram_container_cycle" not in codes
    assert "diagram_container_scope_mismatch" not in codes


def test_block_diagram_child_must_inherit_parent_boundary_scope():
    analysis = _analysis()
    analysis["structure_nodes"].append({
        "id": "ST-2",
        "name": "Control board",
        "level": "subsystem",
        "parent_id": "ST-1",
    })
    analysis["block_diagram"]["nodes"].append({
        "id": "BDN-2",
        "kind": "structure",
        "structure_node_id": "ST-2",
        "container_parent_block_id": "BDN-1",
        "label": "Control board",
        "x": 280,
        "y": 270,
        "width": 180,
        "height": 72,
        "inside_boundary": False,
    })
    result = analyze_aiag_vda_fmea([analysis])["analyses"][0]
    assert "diagram_container_scope_mismatch" in {
        issue["code"] for issue in result["issues"]
    }


def test_block_diagram_rejects_invalid_containment_and_duplicate_occurrences():
    analysis = _analysis()
    analysis["structure_nodes"].append({
        "id": "ST-2",
        "name": "Control board",
        "level": "subsystem",
        "parent_id": "ST-1",
    })
    analysis["block_diagram"]["nodes"].extend([
        {
            "id": "BDN-2",
            "kind": "structure",
            "structure_node_id": "ST-2",
            "container_parent_block_id": "BDX-1",
            "label": "Control board",
            "x": 280,
            "y": 270,
            "width": 180,
            "height": 72,
            "inside_boundary": True,
        },
        {
            "id": "BDN-3",
            "kind": "structure",
            "structure_node_id": "ST-2",
            "container_parent_block_id": "BDN-missing",
            "label": "Duplicate control board",
            "x": 480,
            "y": 270,
            "width": 180,
            "height": 72,
            "inside_boundary": True,
        },
    ])
    result = analyze_aiag_vda_fmea([analysis])["analyses"][0]
    codes = {issue["code"] for issue in result["issues"]}
    assert "diagram_container_mismatch" in codes
    assert "diagram_container_missing" in codes
    assert "duplicate_structure_diagram_occurrence" in codes


def test_block_diagram_rejects_containment_cycles():
    analysis = _analysis()
    analysis["structure_nodes"][0]["parent_id"] = "ST-2"
    analysis["structure_nodes"].append({
        "id": "ST-2",
        "name": "Control board",
        "level": "subsystem",
        "parent_id": "ST-1",
    })
    analysis["block_diagram"]["nodes"][0][
        "container_parent_block_id"] = "BDN-2"
    analysis["block_diagram"]["nodes"].append({
        "id": "BDN-2",
        "kind": "structure",
        "structure_node_id": "ST-2",
        "container_parent_block_id": "BDN-1",
        "label": "Control board",
        "x": 280,
        "y": 270,
        "width": 180,
        "height": 72,
        "inside_boundary": True,
    })
    result = analyze_aiag_vda_fmea([analysis])["analyses"][0]
    assert "diagram_container_cycle" in {
        issue["code"] for issue in result["issues"]
    }
