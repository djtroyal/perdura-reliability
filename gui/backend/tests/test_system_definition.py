"""Canonical System Definition validation and propagation contracts."""

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "gui" / "backend"))

from reliability.SystemDefinition import (  # noqa: E402
    analyze_system_impact,
    generate_system_starter,
    plan_definition_composition,
    profile_adapters,
    project_system_definition,
    propagate_system_definition,
    resolve_analysis_profile,
    upgrade_system_definition,
    validate_system_definition,
)
from system_definition_schemas import SystemDefinitionModel  # noqa: E402


def model() -> dict:
    return {
        "version": 1,
        "id": "SYS-1",
        "name": "Control system",
        "revision": "A",
        "modes": [{"id": "run", "name": "Run", "description": ""}],
        "definitions": [
            {
                "id": "sensor-def", "name": "Sensor", "classification": "component",
                "description": "", "part_number": "", "manufacturer": "", "category": "",
                "ports": [{
                    "id": "signal", "name": "Signal", "interface_type": "information",
                    "direction": "output", "description": "",
                }],
                "functions": [{
                    "id": "measure", "description": "Measure pressure",
                    "function_type": "primary", "mode_ids": ["run"],
                }],
                "failure_modes": [{
                    "id": "no-signal", "function_id": "measure",
                    "description": "No pressure signal", "deviation_id": "absent",
                    "mode_ids": ["run"],
                }],
                "child_slots": [],
            },
            {
                "id": "controller-def", "name": "Controller", "classification": "component",
                "description": "", "part_number": "", "manufacturer": "", "category": "",
                "ports": [{
                    "id": "input", "name": "Input", "interface_type": "information",
                    "direction": "input", "description": "",
                }],
                "functions": [{
                    "id": "control", "description": "Control pressure",
                    "function_type": "primary", "mode_ids": ["run"],
                }],
                "failure_modes": [], "child_slots": [],
            },
        ],
        "instances": [
            {
                "id": "sensor-1", "definition_id": "sensor-def", "name": "Sensor 1",
                "quantity": 1, "reference_designators": ["PS1"], "mode_ids": [],
                "function_overrides": [], "failure_mode_overrides": [], "legacy_refs": [],
            },
            {
                "id": "controller-1", "definition_id": "controller-def", "name": "Controller 1",
                "quantity": 1, "reference_designators": ["U1"], "mode_ids": [],
                "function_overrides": [], "failure_mode_overrides": [], "legacy_refs": [],
            },
        ],
        "externals": [],
        "interfaces": [{
            "id": "signal-if", "name": "Pressure data", "interface_type": "information",
            "source": {"instance_id": "sensor-1", "port_id": "signal"},
            "target": {"instance_id": "controller-1", "port_id": "input"},
            "directionality": "directed", "linkage": "direct",
            "interface_detail": "", "flow_description": "Pressure reading",
            "operating_condition": "", "source_function_ids": ["measure"],
            "target_function_ids": ["control"], "mode_ids": ["run"],
        }],
        "function_links": [], "propagation_rules": [],
        "diagrams": [{"id": "D1", "name": "System", "nodes": []}],
    }


def test_schema_and_validation_accept_complete_model():
    parsed = SystemDefinitionModel.model_validate(model())
    result = validate_system_definition(parsed.model_dump())
    assert result["valid"]
    assert result["summary"] == {
        "definitions": 2, "instances": 2, "interfaces": 1,
        "functions": 2, "failure_modes": 1,
        "analysis_profiles": 0, "accepted_propagations": 0,
    }


def test_linear_propagation_is_deterministic_and_explainable():
    first = propagate_system_definition(model(), mode_id="run")
    second = propagate_system_definition(model(), mode_id="run")
    assert first == second
    assert first["valid"]
    assert len(first["proposals"]) == 1
    assert first["proposals"][0]["review_required"] is True
    assert first["proposals"][0]["transition"]["id"] == "signal-if"
    assert first["nodes"][-1]["function"]["instance_id"] == "controller-1"
    assert first["paths"][0]["termination"] == "no_downstream_mapping"
    assert len(first["fingerprint"]) == 64


def test_transform_and_mode_filtering():
    payload = model()
    payload["propagation_rules"] = [{
        "id": "transform-1", "action": "transform", "interface_id": "signal-if",
        "source_deviation_id": "absent", "result_deviation_id": "incorrect",
        "result_description": "Controller uses an incorrect pressure value",
        "mode_ids": ["run"], "rationale": "Loss is interpreted as the fallback value.",
    }]
    propagated = propagate_system_definition(payload, mode_id="run")
    assert propagated["nodes"][-1]["deviation_id"] == "incorrect"
    assert propagated["nodes"][-1]["description"].startswith("Controller uses")
    assert propagated["proposals"][0]["rule_id"] == "transform-1"

    assert not propagate_system_definition(payload, mode_id="maintenance")["nodes"]


def test_hierarchy_and_definition_cycles_fail_closed():
    payload = model()
    payload["instances"][0]["parent_instance_id"] = "controller-1"
    payload["instances"][1]["parent_instance_id"] = "sensor-1"
    result = validate_system_definition(payload)
    assert not result["valid"]
    assert any(issue["code"] == "instance_hierarchy_cycle" for issue in result["issues"])
    propagated = propagate_system_definition(payload)
    assert not propagated["valid"]
    assert propagated["paths"] == []


def test_nested_mode_and_instance_override_references_fail_closed():
    payload = model()
    payload["definitions"][0]["functions"][0]["mode_ids"] = ["missing-mode"]
    payload["instances"][0]["function_overrides"] = [{
        "function_id": "missing-function", "enabled": True,
    }]
    result = validate_system_definition(payload)
    assert not result["valid"]
    assert any(issue["code"] == "missing_mode" for issue in result["issues"])
    assert any(issue["code"] == "missing_override_function" for issue in result["issues"])


def test_external_boundaries_do_not_require_impossible_function_mappings():
    payload = model()
    payload["externals"] = [{
        "id": "operator", "name": "Operator", "kind": "person",
        "description": "",
    }]
    payload["interfaces"][0]["target"] = {"external_id": "operator"}
    payload["interfaces"][0]["target_function_ids"] = []
    validation = validate_system_definition(payload)
    assert validation["valid"]
    assert not any(
        issue["code"] == "unmapped_interface_functions"
        for issue in validation["issues"]
    )
    propagated = propagate_system_definition(payload, mode_id="run")
    assert propagated["coverage"]["interfaces_without_function_mapping"] == []


def test_bidirectional_cycles_are_collapsed_not_expanded_forever():
    payload = model()
    payload["interfaces"][0]["directionality"] = "bidirectional"
    propagated = propagate_system_definition(payload, mode_id="run")
    assert any(path["termination"] == "cycle_collapsed" for path in propagated["paths"])
    assert len(propagated["paths"]) < 10


def test_reviewable_starters_preserve_analysis_boundaries():
    for target in ("rbd", "fta", "markov"):
        result = generate_system_starter(model(), target, mode_id="run")
        assert result["valid"]
        assert result["target"] == target
        assert result["draft"]
        assert result["issues"][-1]["code"] == "review_generated_starter"
    fta = generate_system_starter(model(), "fta", mode_id="run")
    assert fta["draft"]["gate_required"] is True
    assert fta["draft"]["top_event"]["systemRef"] == {
        "system_model_id": "SYS-1", "instance_id": "controller-1",
        "definition_id": "controller-def", "function_id": "control",
        "revision": "A",
    }
    markov = generate_system_starter(model(), "markov", mode_id="run")
    assert all(item["rate"] is None for item in markov["draft"]["transitions"])
    assert all("description" not in item["systemRef"]
               for item in markov["draft"]["states"][1:])


def test_bundled_demo_contains_an_executable_canonical_system():
    import json

    demo_path = ROOT / "gui" / "frontend" / "src" / "data" / "demoProject.json"
    demo = json.loads(demo_path.read_text(encoding="utf-8"))
    state = demo["modules"]["systemDefinition"]["folios"][0]["state"]
    parsed = SystemDefinitionModel.model_validate(state["model"])
    validation = validate_system_definition(parsed.model_dump())
    assert validation["valid"]
    propagated = propagate_system_definition(parsed.model_dump(), mode_id="run")
    assert len(propagated["paths"]) == 2


def test_v1_upgrade_preserves_ids_and_adds_portable_v2_semantics():
    upgraded = upgrade_system_definition(model())
    assert upgraded["version"] == 2
    assert [item["id"] for item in upgraded["instances"]] == [
        "sensor-1", "controller-1",
    ]
    assert upgraded["definitions"][0]["kind"] == "component"
    assert upgraded["propagation_assertions"] == []
    assert upgraded["diagrams"][0]["boundary"]["label"] == "System Boundary"


def test_typed_profile_resolution_has_explicit_precedence_and_provenance():
    payload = upgrade_system_definition(model())
    payload["definitions"][0]["analysis_profiles"] = [{
        "id": "prediction", "name": "MIL profile", "domain": "prediction",
        "adapter_id": "prediction.mil-hdbk-217f", "adapter_version": 1,
        "status": "reviewed", "mode_ids": ["run"],
        "values": {
            "category": {"kind": "text", "value": "sensor"},
            "quality": {"kind": "choice", "value": "MIL-SPEC", "option_ids": []},
        },
    }]
    payload["instances"][0]["profile_overrides"] = [{
        "profile_id": "prediction", "disabled": False,
        "values": {"quality": {"kind": "choice", "value": "COTS", "option_ids": []}},
    }]
    result = resolve_analysis_profile(
        payload, "sensor-1", "prediction", mode_id="run",
        analysis_overrides={"quality": {
            "kind": "choice", "value": "SCREENED", "option_ids": [],
        }},
    )
    assert result["valid"]
    assert result["profile"]["resolved_values"]["category"] == "sensor"
    assert result["profile"]["resolved_values"]["quality"] == "SCREENED"
    assert result["provenance"]["quality"] == "analysis"
    assert profile_adapters()["adapters"]


def test_reusable_composition_is_review_gated_and_does_not_mutate_model():
    payload = upgrade_system_definition(model())
    payload["definitions"][0]["child_slots"] = [{
        "id": "controller-slot", "definition_id": "controller-def",
        "name": "Controller", "quantity": 2,
    }]
    original_instances = list(payload["instances"])
    plan = plan_definition_composition(payload, "sensor-1")
    assert plan["valid"]
    assert plan["summary"]["add"] == 1
    assert plan["proposals"][0]["review_required"] is True
    assert plan["proposals"][0]["instance"]["quantity"] == 2
    assert payload["instances"] == original_instances


def test_prediction_projection_requires_profiles_and_emits_linked_piece_parts():
    payload = upgrade_system_definition(model())
    payload["definitions"][0]["kind"] = "piece_part"
    blocked = project_system_definition(payload, "prediction")
    assert not blocked["valid"]
    assert any(issue["code"] == "missing_prediction_profile"
               for issue in blocked["issues"])
    payload["definitions"][0]["analysis_profiles"] = [{
        "id": "prediction", "name": "MIL profile", "domain": "prediction",
        "adapter_id": "prediction.mil-hdbk-217f", "adapter_version": 1,
        "status": "reviewed", "mode_ids": [],
        "values": {"category": {"kind": "text", "value": "sensor"}},
    }]
    projected = project_system_definition(payload, "prediction", current_analysis={
        "parts": [{
            "id": "existing", "system_ref": {"instance_id": "sensor-1"},
            "params": {"quality": "analysis-local"},
        }],
    })
    assert projected["valid"]
    assert projected["projection"]["parts"][0]["linked"] is True
    assert projected["projection"]["parts"][0]["system_ref"]["instance_id"] == "sensor-1"
    assert projected["projection"]["parts"][0]["params"]["quality"] == "analysis-local"
    assert projected["binding"]["entity_checksums"]


def test_rbd_projection_resolves_profiles_and_preserves_local_model_overrides():
    payload = upgrade_system_definition(model())
    for index, definition in enumerate(payload["definitions"]):
        definition["analysis_profiles"] = [{
            "id": "reliability", "name": "Constant hazard",
            "domain": "reliability",
            "adapter_id": "reliability.constant-hazard",
            "adapter_version": 1, "status": "reviewed", "mode_ids": [],
            "values": {"failure_rate": {
                "kind": "number", "value": (index + 1) * 1e-6,
                "unit": "failures/hour",
            }},
        }]
    projected = project_system_definition(payload, "rbd")
    assert projected["valid"]
    sensor = next(item for item in projected["projection"]["nodes"]
                  if item["data"]["systemRef"]["instance_id"] == "sensor-1")
    assert sensor["data"]["distribution"] == "exponential"
    assert sensor["data"]["dist_params"] == {"lambda": 1e-6}
    assert sensor["data"]["requiresReliabilityModel"] is False

    overridden = project_system_definition(payload, "rbd", current_analysis={
        "nodes": [{
            "id": "rbd-sensor-1", "data": {
                "systemRef": {"instance_id": "sensor-1"},
                "analysisReliabilityOverride": {
                    "distribution": "weibull",
                    "dist_params": {"alpha": 2500, "beta": 2.2},
                },
            },
        }],
    })
    sensor = next(item for item in overridden["projection"]["nodes"]
                  if item["data"]["systemRef"]["instance_id"] == "sensor-1")
    assert sensor["data"]["distribution"] == "weibull"
    assert sensor["data"]["dist_params"] == {"alpha": 2500, "beta": 2.2}


def test_reviewed_distribution_profile_requires_explicit_parameters():
    payload = upgrade_system_definition(model())
    payload["definitions"][0]["analysis_profiles"] = [{
        "id": "life", "name": "Weibull life", "domain": "reliability",
        "adapter_id": "reliability.distribution", "adapter_version": 1,
        "status": "reviewed", "mode_ids": [],
        "values": {"distribution": {
            "kind": "choice", "value": "weibull", "option_ids": ["weibull"],
        }},
    }]
    validation = validate_system_definition(payload)
    assert not validation["valid"]
    assert any(issue["code"] == "incomplete_reviewed_profile"
               for issue in validation["issues"])


def test_accepted_propagation_assertion_is_reused_until_inputs_change():
    payload = upgrade_system_definition(model())
    first = propagate_system_definition(payload, mode_id="run")
    proposal = first["proposals"][0]
    payload["propagation_assertions"] = [{
        "id": "assert-1", "source_failure_mode_id": proposal["source_failure_mode_id"],
        "source_node_id": proposal["source_node_id"],
        "target_node_id": proposal["target_node_id"],
        "transition_id": proposal["transition"]["id"],
        "result_deviation_id": proposal["result_deviation_id"],
        "status": "accepted", "rationale": "Reviewed by system safety",
        "evidence_refs": ["review://SSR-12"], "mode_ids": ["run"],
        "source_fingerprint": first["fingerprint"],
    }]
    repeated = propagate_system_definition(payload, mode_id="run")
    assert repeated["proposals"][0]["review_required"] is False
    assert repeated["proposals"][0]["accepted_assertion_id"] == "assert-1"
    assert repeated["coverage"]["reviewed_proposals"] == 1


def test_binding_impact_reports_changed_canonical_entities():
    payload = upgrade_system_definition(model())
    projection = project_system_definition(payload, "fmea")
    binding = projection["binding"]
    binding["analysis_id"] = "FMEA-1"
    assert analyze_system_impact(payload, [binding])["stale"] == 0
    payload["definitions"][0]["functions"][0]["description"] = "Measure pressure accurately"
    impact = analyze_system_impact(payload, [binding])
    assert impact["stale"] == 1
    assert any(item["entity_type"] == "function"
               for item in impact["bindings"][0]["changes"])
