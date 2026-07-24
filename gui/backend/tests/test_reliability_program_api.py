"""API contract checks for the reliability-program workspace."""

import sys
from pathlib import Path


BACKEND = Path(__file__).resolve().parents[1]
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(ROOT / "src"))

from routers.reliability_program import analyze, rating_profiles
from schemas import ReliabilityProgramRequest


def test_program_route_preserves_traceability_and_method_status():
    request = ReliabilityProgramRequest(
        fmea=[{
            "id": "FMEA-1", "failure_mode": "Open connector",
            "severity": 9, "occurrence": 2, "detection": 3,
            "linked_hazard_ids": ["HAZ-1"],
            "linked_fracas_ids": ["FRACAS-1"],
        }],
        hazards=[{
            "id": "HAZ-1", "title": "Loss of control",
            "initial_probability": "C", "initial_severity": "II",
            "residual_probability": "D", "residual_severity": "II",
            "linked_fmea_ids": ["FMEA-1"],
        }],
        fracas=[{
            "id": "FRACAS-1", "failure_mode": "Open connector",
            "status": "closed", "effectiveness_verified": True,
            "linked_fmea_ids": ["FMEA-1"],
        }],
        total_exposure=10_000,
    )
    response = analyze(request)
    assert response["fmea"]["rows"][0]["screening_band"] == "severity_override"
    assert response["hazards"]["rows"][0]["initial_risk"]["risk_index"] == 6
    assert response["fracas"]["exposure_metrics"]["event_rate"] == 0.0001
    assert response["traceability"]["summary"]["issues"] == 0
    assert response["standards_context"]["status"] == "standards_informed_workflow"


def test_testability_route_uses_weighted_fault_universe():
    response = analyze(ReliabilityProgramRequest(testability_faults=[
        {"id": "FAULT-1", "weight": 3, "detected": True,
         "ambiguity_group_size": 1},
        {"id": "FAULT-2", "weight": 1, "detected": False,
         "ambiguity_group_size": 2},
    ]))
    assert response["testability"]["summary"]["fraction_faults_detected"] == 0.75
    assert response["testability"]["summary"]["fraction_faults_isolated"] == 0.75


def test_aiag_vda_route_and_profile_discovery_contract():
    request = ReliabilityProgramRequest(fmea_analyses=[{
        "id": "DFMEA-1",
        "name": "Controller DFMEA",
        "kind": "dfmea",
        "planning": {
            "subject": "Controller",
            "scope": "Input through output",
            "intent": "Prevent loss of function",
            "team": ["Design", "Quality"],
        },
        "structure_nodes": [
            {
                "id": "ST-1", "name": "Controller", "level": "focus",
                "source_ref": {
                    "module": "prediction",
                    "analysis_id": "prediction-1",
                    "analysis_name": "Controller prediction",
                    "entity_type": "block",
                    "entity_id": "block:b1",
                    "parent_entity_id": "system:system",
                    "imported_at": "2026-07-23T12:00:00Z",
                    "source_checksum": "a" * 64,
                    "source_name": "Controller",
                    "reference_designators": [],
                    "quantity": 1,
                    "category": "system_block",
                },
            },
            {
                "id": "ST-2", "name": "R1 — RN55", "level": "next_lower",
                "parent_id": "ST-1",
                "source_ref": {
                    "module": "prediction",
                    "analysis_id": "prediction-1",
                    "analysis_name": "Controller prediction",
                    "entity_type": "part",
                    "entity_id": "part:p1",
                    "parent_entity_id": "block:b1",
                    "imported_at": "2026-07-23T12:00:00Z",
                    "source_checksum": "b" * 64,
                    "source_name": "R1 — RN55",
                    "piece_key": "refdes:R1",
                    "reference_designators": ["R1"],
                    "part_number": "RN55",
                    "quantity": 1,
                    "category": "resistor",
                },
            },
        ],
        "block_diagram": {
            "version": 2,
            "density": "spacious",
            "boundary": {
                "label": "Controller boundary",
                "x": 40, "y": 40, "width": 720, "height": 440,
            },
            "nodes": [
                {
                    "id": "BDN-1", "kind": "structure",
                    "structure_node_id": "ST-1", "label": "Controller",
                    "expanded": True,
                    "x": 260, "y": 180, "width": 180, "height": 72,
                    "inside_boundary": True,
                },
                {
                    "id": "BDX-1", "kind": "external",
                    "external_kind": "adjacent_system",
                    "label": "Command source",
                    "x": 20, "y": 180, "width": 180, "height": 72,
                    "inside_boundary": False,
                },
                {
                    "id": "BDN-2", "kind": "structure",
                    "structure_node_id": "ST-2", "label": "R1 — RN55",
                    "container_parent_block_id": "BDN-1",
                    "x": 285, "y": 250, "width": 180, "height": 72,
                    "inside_boundary": True,
                },
            ],
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "snap_to_grid": True,
        },
        "functions": [{
            "id": "FN-1", "structure_node_id": "ST-1",
            "description": "Provide output",
            "canonical_verb_id": "function_verb:supply",
        }],
        "functional_requirements": [{
            "id": "FREQ-1", "statement": "Output remains available",
            "verification_method": "System test",
            "verification_method_id": "verification_method:test",
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
            "external_source": "Command source",
            "target_structure_node_id": "ST-1",
            "flow_description": "Command word",
            "operating_condition": "Normal operation",
            "function_ids": ["FN-1"],
            "requirement_ids": ["FREQ-1"],
        }],
        "failure_chains": [{
            "id": "FC-1", "function_id": "FN-1",
            "effect": "Function lost", "failure_mode": "No output",
            "deviation_id": "failure_deviation:absent",
            "effect_level": "System / end user",
            "effect_level_id": "effect_level:system-end-user",
            "effect_contexts": [{
                "id": "EC-1", "context": "System",
                "level_id": "effect_level:system-end-user",
                "description": "Function lost", "severity": 8,
            }],
            "cause": "Open circuit", "severity": 8,
            "occurrence": 4, "detection": 7,
            "prevention_controls": "Connector retention feature",
            "prevention_control_method_id":
                "prevention_control:requirement-or-design-rule",
            "detection_controls": "System test",
            "detection_control_method_id":
                "detection_control:measurement-or-test",
            "actions": [{
                "id": "ACT-1", "description": "Add retention",
                "status": "decision_pending", "owner": "Design",
                "target_date": "2099-12-31",
            }],
        }],
    }])
    response = analyze(request)
    result = response["aiag_vda_fmea"]["analyses"][0]
    assert result["failure_chains"][0]["action_priority"] == "H"
    assert result["functions"][0]["canonical_verb_id"] == "function_verb:supply"
    assert result["functional_requirements"][0]["verification_method_id"] == (
        "verification_method:test")
    assert result["failure_chains"][0]["deviation_id"] == (
        "failure_deviation:absent")
    assert result["failure_chains"][0]["effect_contexts"][0]["level_id"] == (
        "effect_level:system-end-user")
    assert result["structure_nodes"][0]["source_ref"]["entity_id"] == "block:b1"
    assert result["structure_nodes"][0]["source_ref"]["source_checksum"] == "a" * 64
    assert result["structure_nodes"][1]["source_ref"]["piece_key"] == "refdes:R1"
    assert result["block_diagram"]["nodes"][1]["label"] == "Command source"
    assert result["block_diagram"]["version"] == 2
    assert result["block_diagram"]["density"] == "spacious"
    assert result["block_diagram"]["nodes"][0]["expanded"] is True
    assert result["block_diagram"]["nodes"][2][
        "container_parent_block_id"] == "BDN-1"
    assert result["interfaces"][0]["source_block_id"] == "BDX-1"
    assert result["function_coverage"][0]["interface_ids"] == ["IF-1"]
    assert "rpn" not in result["failure_chains"][0]
    assert {profile["kind"] for profile in rating_profiles()} == {
        "dfmea", "pfmea", "fmea_msr",
    }
