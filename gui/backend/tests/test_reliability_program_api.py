"""API contract checks for the reliability-program workspace."""

import sys
from pathlib import Path


BACKEND = Path(__file__).resolve().parents[1]
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(ROOT / "src"))

from routers.fmea import analyze as analyze_fmea, ratings
from routers.reliability_program import analyze
from schemas import FMEAAnalyzeRequest, ReliabilityProgramRequest


def test_program_route_preserves_non_fmea_traceability_and_method_status():
    request = ReliabilityProgramRequest(
        hazards=[{
            "id": "HAZ-1", "title": "Loss of control",
            "initial_probability": "C", "initial_severity": "II",
            "residual_probability": "D", "residual_severity": "II",
        }],
        fracas=[{
            "id": "FRACAS-1", "failure_mode": "Open connector",
            "status": "closed", "effectiveness_verified": True,
        }],
        total_exposure=10_000,
    )
    response = analyze(request)
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


def test_rcm_guidance_recommends_on_condition_for_detectable_failure():
    response = analyze(ReliabilityProgramRequest(rcm=[{
        "id": "RCM-1",
        "functional_failure": "Fails to maintain coolant flow",
        "failure_mode": "Bearing wear",
        "consequence": "operational",
        "failure_evident": "yes",
        "age_related": "unknown",
        "condition_detectable": "yes",
        "task_type": "on-condition",
        "task_interval": 250,
        "task_applicable": "yes",
        "task_effective": "yes",
        "decision_status": "approved",
        "evidence": "Vibration trend detects degradation before loss of flow.",
    }]))
    rcm = response["rcm"]
    assert rcm["rows"][0]["recommended_task_type"] == "on-condition"
    assert rcm["rows"][0]["decision_complete"] is True
    assert rcm["summary"]["guided_complete"] == 1


def test_rcm_override_requires_explicit_rationale():
    response = analyze(ReliabilityProgramRequest(rcm=[{
        "id": "RCM-2",
        "functional_failure": "Hidden protective trip unavailable",
        "consequence": "hidden",
        "failure_evident": "no",
        "task_type": "run-to-failure",
        "task_applicable": "yes",
        "task_effective": "yes",
        "decision_status": "review",
    }]))
    row = response["rcm"]["rows"][0]
    assert row["recommended_task_type"] == "failure-finding"
    assert row["recommendation_overridden"] is True
    assert "override rationale missing" in row["issues"]


def test_aiag_vda_route_and_profile_discovery_contract():
    request = FMEAAnalyzeRequest(studies=[{
        "schema_version": 4,
        "id": "DFMEA-1",
        "lifecycle_status": "draft",
        "method_profile_id": "aiag_vda_2019_public",
        "model": {
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
            "severity_rationale": "Loss of commanded output prevents the system function.",
            "occurrence_rationale": "Connector service history supports this occurrence band.",
            "detection_rationale": "System test has limited coverage of intermittent opens.",
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
        },
    }])
    # Author the route fixture against the current canonical architecture contract.
    from system_definition_schemas import SystemDefinitionModel
    from schemas import FMEAStudy
    model = request.studies[0].model.model_dump()
    model["system_binding"] = {"version": 1, "system_model_id": "controller-system", "scope_instance_id": "ST-1"}
    model["resources"] = [{"id": "command", "name": "Command word", "category": "information"}, {"id": "integrity", "name": "Connection integrity", "category": "state"}, {"id": "result", "name": "Controlled output", "category": "information"}]
    for node in model["structure_nodes"]:
        node["system_definition_ref"] = {"system_model_id": "controller-system", "instance_id": node["id"], "definition_id": node["id"]}
    fn = model["functions"][0]
    fn.update(description="Import command word", canonical_verb_id="function_verb:import", definition={"role": "transform", "action": "Control output", "io": [{"id": "input", "resource_id": "command", "direction": "input"}, {"id": "out", "resource_id": "result", "direction": "output"}]}, system_definition_ref={**model["structure_nodes"][0]["system_definition_ref"], "function_id": "FN-1"})
    model["functions"].append({"id": "FN-2", "structure_node_id": "ST-2", "description": "Regulate connection integrity", "operating_modes": [], "definition": {'role': 'maintain_state', 'action': 'Operational integrity', 'io': []}, "system_definition_ref": {**model["structure_nodes"][1]["system_definition_ref"], "function_id": "FN-2"}})
    model["failure_chains"][0]["cause_structure_node_id"] = "ST-2"
    model["failure_chains"].append({"id": "FC-2", "function_id": "FN-2", "cause_structure_node_id": "ST-2", "effect_function_id": "FN-1", "failure_mode": "Connection lost", "cause": "Contact opens", "effect": "Command lost", "severity": 3, "occurrence": 2, "detection": 2, "severity_rationale": "Transient command loss is recoverable.", "occurrence_rationale": "Qualified interconnect limits occurrence.", "detection_rationale": "Continuity verification detects opens before installation."})
    transfer = {"id": "command-transfer", "kind": "flow", "resource_id": "command", "source": {"kind": "external", "external_id": "command-source", "port_id": "output"}, "target": {"kind": "function", "instance_id": "ST-1", "function_id": "FN-1", "io_id": "input"}, "mode_ids": []}
    edge = model["interfaces"][0]
    edge["transfers"] = [transfer]
    edge["system_definition_ref"] = {"system_model_id": "controller-system", "interface_id": "command"}
    canonical = {"version": 4, "id": "controller-system", "name": "Controller", "root_instance_id": "ST-1", "resources": model["resources"],
        "definitions": [{"id": node["id"], "name": node["name"], "kind": "system" if index == 0 else "component", "ports": [{"id": "p", "name": "Command", "interface_type": "information", "direction": "input"}], "functions": [{key: fn[key] for key in ("id", "description", "definition", "canonical_verb_id") if key in fn} for fn in model["functions"] if fn["structure_node_id"] == node["id"]]} for index, node in enumerate(model["structure_nodes"])],
        "instances": [{"id": node["id"], "definition_id": node["id"], "name": node["name"], "parent_instance_id": node["parent_id"]} for node in model["structure_nodes"]],
        "externals": [{"id": "command-source", "name": "Command source", "ports": [{"id": "output", "name": "Command", "interface_type": "information", "direction": "output", "resource_id": "command"}]}],
        "interfaces": [{"id": "command", **{key: edge[key] for key in ("name", "interface_type", "directionality", "flow_description", "transfers")}, "source": {"external_id": "command-source", "port_id": "output"}, "target": {"instance_id": "ST-1", "port_id": "p"}}],
        "function_links": [{"id": "support", "relationship": "decomposes_to", "source": {"instance_id": "ST-1", "function_id": "FN-1"}, "target": {"instance_id": "ST-2", "function_id": "FN-2"}}]}
    request.canonical_system = SystemDefinitionModel.model_validate(canonical)
    request.studies = [FMEAStudy.model_validate({**request.studies[0].model_dump(), "model": model})]
    response = analyze_fmea(request)
    result = response["studies"][0]["analysis"]
    assert result["failure_chains"][0]["action_priority"] == "H"
    assert result["functions"][0]["canonical_verb_id"] == "function_verb:import"
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
    assert {profile["kind"] for profile in ratings()} == {
        "dfmea", "pfmea", "fmea_msr",
    }
