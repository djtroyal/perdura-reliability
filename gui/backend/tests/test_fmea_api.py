"""Dedicated FMEA API contract checks."""

import sys
from pathlib import Path

import pytest


BACKEND = Path(__file__).resolve().parents[1]
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(ROOT / "src"))

from routers.fmea import analyze, profiles
from schemas import (
    AIAGVDAFMEAAnalysis,
    FMEAAttestation,
    FMEAAnalyzeRequest,
    FMEAFailureChain,
    FMEDAFailureMode,
    FMEDASource,
)


def test_method_profile_discovery_is_explicit_about_verification():
    methods = profiles()
    assert any(item["status"] == "preview_public_alignment"
               for item in methods)
    assert any(item["status"] == "reference_gated" for item in methods)
    assert all(len(item["checksum"]) == 64 for item in methods)


def test_fmeda_and_attestation_schema_boundaries():
    source = FMEDASource(
        id="R1", label="Resistor", failure_rate_per_hour=1e-7,
        lower_rate_per_hour=0.8e-7, upper_rate_per_hour=1.2e-7,
    )
    assert source.allocation_complete is True
    mode = FMEDAFailureMode(
        id="FM-1", source_id="R1", mode_fraction=0.5,
        classification="single_point", diagnostic_coverage=0.9,
    )
    assert mode.diagnostic_coverage == 0.9
    local = FMEAAttestation(
        id="ATT-1", role="approver", name="Reviewer", decision="approved",
        statement="Reviewed.", timestamp="2026-07-25T00:00:00Z",
        identity_assurance="named_local",
    )
    assert local.identity_provider is None


def test_structured_cause_language_and_structure_reference_contract():
    chain = FMEAFailureChain(
        id="FC-1",
        effect="Output lost",
        failure_mode="No output",
        cause="connector contact opens",
        cause_noun="connector contact",
        cause_structure_node_id="ST-1",
        cause_mechanism_verb="opens",
        severity=8,
        occurrence=3,
        detection=4,
    )
    analysis = AIAGVDAFMEAAnalysis(
        id="DFMEA-1",
        name="Connector DFMEA",
        kind="dfmea",
        structure_nodes=[{
            "id": "ST-1", "name": "Connector contact", "level": "focus",
        }],
        failure_chains=[chain],
    )
    assert analysis.failure_chains[0].cause_noun == "connector contact"

    with pytest.raises(
        ValueError,
        match="cause_structure_node_id must reference a structure node",
    ):
        AIAGVDAFMEAAnalysis(
            id="DFMEA-2",
            name="Invalid cause reference",
            kind="dfmea",
            structure_nodes=[{
                "id": "ST-1", "name": "Connector contact", "level": "focus",
            }],
            failure_chains=[
                chain.model_copy(update={"cause_structure_node_id": "ST-X"}),
            ],
        )


def linked_analysis():
    system_ref = {"system_model_id": "SYS-1", "instance_id": "pump-1",
                  "definition_id": "pump", "revision": "A"}
    return {
        "id": "DFMEA-1", "name": "Pump DFMEA", "kind": "dfmea",
        "planning": {"subject": "Pump", "scope": "Pressure outlet", "intent": "Analyze failures", "team": ["Engineering"]},
        "resources": [{"id": "pressure", "name": "Pressure", "category": "information"}],
        "system_binding": {"version": 1, "system_model_id": "SYS-1",
                           "scope_instance_id": "pump-1", "included_piece_part_ids": [], "mode_id": "run"},
        "structure_nodes": [{"id": "ST-1", "name": "Pump", "level": "focus",
                             "system_definition_ref": system_ref}],
        "functions": [{"id": "FN-1", "structure_node_id": "ST-1",
                       "description": "Supply pressure", "canonical_verb_id": "supply",
                       "operating_modes": ["run"],
                       "definition": {"role": "source", "action": "Supply", "io": [{"id": "io", "resource_id": "pressure", "direction": "output"}]},
                       "system_definition_ref": {**system_ref, "function_id": "supply"}}],
        "interfaces": [{"id": "IF-1", "source_structure_node_id": "ST-1",
                        "external_target": "Reservoir", "function_ids": ["FN-1"],
                        "transfers": [{"id": "transfer", "kind": "flow", "resource_id": "pressure", "source": {"kind": "function", "instance_id": "pump-1", "function_id": "supply", "io_id": "io"}, "target": {"kind": "external", "external_id": "reservoir", "port_id": "in"}, "mode_ids": ["run"]}],
                        "system_definition_ref": {"system_model_id": "SYS-1",
                                                  "interface_id": "outlet"}}],
        "failure_chains": [{"id": "FC-1", "function_id": "FN-1", "cause_structure_node_id": "ST-1", "effect_function_id": "FN-1", "effect": "Flow lost",
                            "failure_mode": "No pressure", "cause": "Impeller breaks",
                            "severity": 8, "occurrence": 3, "detection": 4,
                            "severity_rationale": "Pressure loss removes the required pumping function.",
                            "occurrence_rationale": "Qualified seal life supports this occurrence band.",
                            "detection_rationale": "Pressure verification detects loss at system test.",
                            "system_definition_ref": {**system_ref, "function_id": "supply",
                                                      "failure_mode_id": "no-pressure"}}],
    }


def canonical_model(payload):
    fn = payload["functions"][0]
    return {"version": 4, "id": "SYS-1", "name": "Pump", "root_instance_id": "pump-1", "modes": [{"id": "run", "name": "Run"}], "resources": payload["resources"],
        "definitions": [{"id": "pump", "name": "Pump", "ports": [{"id": "out", "name": "Out", "direction": "output"}], "functions": [{key: fn[key] for key in ("description", "canonical_verb_id", "definition", "interface_origin") if key in fn} | {"id": "supply", "mode_ids": ["run"]}]}],
        "instances": [{"id": "pump-1", "definition_id": "pump", "name": "Pump"}],
        "externals": [{"id": "reservoir", "name": "Reservoir", "ports": [{"id": "in", "name": "In", "direction": "input"}]}],
        "interfaces": [{"id": "outlet", "source": {"instance_id": "pump-1", "port_id": "out"}, "target": {"external_id": "reservoir", "port_id": "in"}, "transfers": payload["interfaces"][0]["transfers"]}]}


def test_canonical_binding_and_all_reference_types_survive_analysis_api():
    payload = linked_analysis()
    parsed = AIAGVDAFMEAAnalysis.model_validate(payload)
    reloaded = AIAGVDAFMEAAnalysis.model_validate_json(parsed.model_dump_json())
    assert reloaded.model_dump() == parsed.model_dump()
    request = FMEAAnalyzeRequest(canonical_system=canonical_model(payload), studies=[{
        "schema_version": 4, "id": payload["id"], "method_profile_id": "aiag_vda_2019_public", "model": payload,
    }])
    saved_input = request.model_dump()
    result = analyze(request)
    evaluated = result["studies"][0]["analysis"]
    assert evaluated["system_binding"] == payload["system_binding"]
    for field in ("structure_nodes", "functions", "interfaces", "failure_chains"):
        for key, value in payload[field][0]["system_definition_ref"].items():
            assert evaluated[field][0]["system_definition_ref"][key] == value
    assert request.model_dump() == saved_input, "Calculation must not rewrite source identities"


def test_interface_function_provenance_survives_analysis_and_remains_strict():
    payload = linked_analysis()
    origin = {"interface_id": "outlet", "endpoint": "source", "instance_id": "pump-1",
              "generated_description": "Provide pressure to Reservoir", "generated_mode_ids": ["run"]}
    payload["functions"][0]["interface_origin"] = origin
    payload["functions"][0]["description"] = "Deliver the engineer-specified pressure"
    request = FMEAAnalyzeRequest(canonical_system=canonical_model(payload), studies=[{
        "schema_version": 4, "id": payload["id"], "method_profile_id": "aiag_vda_2019_public", "model": payload,
    }])
    evaluated = analyze(request)["studies"][0]["analysis"]["functions"][0]
    assert evaluated["interface_origin"] == origin
    assert evaluated["description"] == payload["functions"][0]["description"]
    origin["unexpected"] = True
    with pytest.raises(ValueError, match="Extra inputs are not permitted"):
        AIAGVDAFMEAAnalysis.model_validate(payload)


@pytest.mark.parametrize("field", [
    "system_binding", "structure_nodes", "functions", "interfaces", "failure_chains",
])
def test_canonical_extensions_retain_strict_unknown_field_validation(field):
    payload = linked_analysis()
    target = payload[field] if field == "system_binding" else payload[field][0]["system_definition_ref"]
    target["unreviewed_extra"] = "must not silently pass"
    with pytest.raises(ValueError, match="Extra inputs are not permitted"):
        AIAGVDAFMEAAnalysis.model_validate(payload)
