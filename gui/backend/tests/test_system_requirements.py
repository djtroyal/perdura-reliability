"""Model-based requirement traceability and explicit verification boundaries."""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import sys

import pytest
from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "gui" / "backend"))

from reliability.SystemRequirements import validate_requirement_graph
from reliability.SystemDefinition import propagate_system_definition, validate_system_definition
from system_definition_schemas import SystemDefinitionModel
from requirement_schemas import SystemRequirement, SystemVerificationCase, SystemVerificationEvidence
from gui.backend.tests.test_system_definition import model as architecture


def requirement(key="req-1", instance="sensor-1"):
    return SystemRequirement(id=key, statement="Measure pressure within the specified tolerance.",
        lifecycle="active", acceptance_criteria="Error no greater than 1 kPa.", unit="kPa",
        allocations=[{"system_model_id": "SYS-1", "instance_id": instance}],
        verification_method="test", mode_ids=["run"]).model_dump(exclude_none=True)


def model():
    result = architecture()
    result["requirements"] = [requirement()]
    result["verification_cases"] = []
    result["verification_evidence"] = []
    return result


def test_canonical_contract_reuses_existing_fmea_fields_and_allows_drafts():
    from requirement_schemas import FMEAFunctionalRequirement, FMEAEvidenceLink, FMEAVerificationPlanRow
    assert issubclass(SystemRequirement, FMEAFunctionalRequirement)
    assert issubclass(SystemVerificationCase, FMEAVerificationPlanRow)
    assert issubclass(SystemVerificationEvidence, FMEAEvidenceLink)
    assert SystemVerificationCase(id="draft").objective == ""
    assert SystemVerificationEvidence(id="draft").source_analysis_id == ""
    parsed = SystemDefinitionModel.model_validate(model())
    assert parsed.requirements[0].id == "req-1"
    assert validate_requirement_graph(parsed.model_dump()) == []
    with pytest.raises(ValidationError):
        SystemRequirement(id="bad", accidental_typo="ignored")
    with pytest.raises(ValidationError):
        SystemDefinitionModel.model_validate({**model(), "requirements": [{**requirement(), "allocations": [{"system_model_id": "SYS-1", "wrong_field": "x"}]}]})


@pytest.mark.parametrize("field,value,code", [
    ("derived_from_ids", ["missing"], "missing_parent_requirement"),
    ("mode_ids", ["missing"], "missing_mode"),
    ("evidence_ids", ["missing"], "missing_evidence"),
    ("requirement_type", "process", "process_requirement"),
    ("allocations", [{"system_model_id": "different"}], "wrong_system"),
    ("allocations", [{"system_model_id": "SYS-1", "instance_id": "gone"}], "missing_instance"),
    ("allocations", [{"system_model_id": "SYS-1", "instance_id": "sensor-1", "function_id": "gone"}], "missing_function"),
    ("allocations", [{"system_model_id": "SYS-1", "interface_id": "gone"}], "missing_interface"),
])
def test_invalid_references_remain_draft_and_do_not_block_calculations(field, value, code):
    draft = model()
    draft["requirements"][0][field] = value
    assert code in {item["code"] for item in validate_requirement_graph(draft)}
    assert validate_system_definition(draft)["valid"]
    assert propagate_system_definition(draft)["valid"]


def test_derivation_cycles_are_reported_for_every_member_not_unrelated_requirements():
    draft = model()
    draft["requirements"] += [requirement("req-2"), requirement("unrelated")]
    draft["requirements"][0]["derived_from_ids"] = ["req-2"]
    draft["requirements"][1]["derived_from_ids"] = ["req-1"]
    issues = validate_requirement_graph(draft)
    assert {item["requirement_id"] for item in issues if item["code"] == "derivation_cycle"} == {"req-1", "req-2"}


def test_deep_derivation_is_iterative_and_duplicate_identity_is_rejected():
    draft = model()
    draft["requirements"] = [{**requirement(f"r-{i}"), "derived_from_ids": [f"r-{i-1}"] if i else []} for i in range(1500)]
    assert validate_requirement_graph(draft) == []
    draft["requirements"].append(deepcopy(draft["requirements"][0]))
    assert any(item["code"] == "duplicate_id" for item in validate_requirement_graph(draft))


def test_disabled_occurrence_function_does_not_satisfy_allocation():
    draft = model()
    draft["requirements"][0]["allocations"][0]["function_id"] = "measure"
    assert validate_requirement_graph(draft) == []
    draft["instances"][0]["function_overrides"] = [{"function_id": "measure", "enabled": False}]
    assert any(item["code"] == "missing_function" for item in validate_requirement_graph(draft))


def test_rename_and_reparent_preserve_stable_requirement_links():
    draft = model()
    refs = deepcopy(draft["requirements"][0]["allocations"])
    draft["instances"][0]["name"] = "New sensor label"
    draft["instances"][0]["parent_instance_id"] = "controller-1"
    assert validate_requirement_graph(draft) == []
    assert draft["requirements"][0]["allocations"] == refs


def complete_case():
    draft = model()
    draft["verification_cases"] = [SystemVerificationCase(
        id="v-1", objective="Confirm measurement accuracy.", requirement_ids=["req-1"],
        method="test", acceptance_criteria="Error no greater than 1 kPa.",
        outcome="pass", assessment="Measured maximum absolute error of 0.6 kPa.",
        mode_ids=["run"], evidence_link_ids=["e-1"],
    ).model_dump(exclude_none=True)]
    draft["verification_evidence"] = [SystemVerificationEvidence(
        id="e-1", target_id="req-1", requirement_ids=["req-1"], mode_ids=["run"],
        claim="Maximum absolute error was 0.6 kPa.", locator="test-report.pdf#accuracy",
        source_module="external", source_revision="1", source_checksum="a" * 64,
        captured_at="2026-11-12T12:00:00Z", units="kPa",
    ).model_dump(exclude_none=True)]
    return draft


def reviewed_case():
    from reliability.SystemRequirements import review_verification_case
    return review_verification_case(complete_case(), "v-1", "Test engineer", now="2026-11-13T12:00:00Z")


def test_attachment_and_manually_entered_pass_status_do_not_verify():
    from reliability.SystemRequirements import evaluate_system_requirements, review_verification_case
    draft = complete_case()
    draft["verification_cases"][0]["status"] = "passed"
    result = evaluate_system_requirements(draft)
    assert result["cases"][0]["status"] == "unreviewed"
    assert result["requirements"][0]["status"] == "unverified"
    reviewed = review_verification_case(draft, "v-1", "Engineer", now="2026-11-13T12:00:00Z")
    result = evaluate_system_requirements(reviewed)
    assert result["cases"][0]["status"] == "passed"
    assert result["requirements"][0]["status"] == "verified"


@pytest.mark.parametrize("collection,field,value,code", [
    ("verification_cases", "assessment", "", "missing_assessment"),
    ("verification_cases", "outcome", "inconclusive", "missing_outcome"),
    ("verification_cases", "acceptance_criteria", "", "missing_criteria"),
    ("verification_evidence", "source_checksum", "", "unversioned_evidence"),
    ("verification_evidence", "source_checksum", "not-a-sha256", "unversioned_evidence"),
    ("verification_evidence", "captured_at", "not-a-date", "incomplete_evidence"),
    ("verification_evidence", "units", "Pa", "unit_mismatch"),
    ("verification_evidence", "requirement_ids", [], "inapplicable_evidence"),
    ("verification_evidence", "stale", True, "stale_evidence"),
])
def test_review_rejects_incomplete_or_inapplicable_evidence(collection, field, value, code):
    from reliability.SystemRequirements import evaluate_system_requirements, review_verification_case
    draft = complete_case()
    draft[collection][0][field] = value
    result = evaluate_system_requirements(draft)
    assert result["cases"][0]["status"] == "blocked"
    assert code in {item["code"] for item in result["cases"][0]["issues"]}
    with pytest.raises(ValueError):
        review_verification_case(draft, "v-1", "Engineer")


def test_affected_scope_stales_review_while_presentation_and_unrelated_blocks_do_not():
    from reliability.SystemRequirements import evaluate_system_requirements
    reviewed = reviewed_case()
    presentation = deepcopy(reviewed)
    presentation["diagrams"][0]["nodes"] = [{"instance_id": "sensor-1", "x": 500, "y": 750}]
    presentation["instances"][0]["name"] = "Renamed sensor"
    presentation["definitions"][1]["description"] = "Unrelated controller specification"
    assert evaluate_system_requirements(presentation)["cases"][0]["status"] == "passed"
    presentation["definitions"][0]["description"] = "Changed sensor specification"
    assert evaluate_system_requirements(presentation)["cases"][0]["status"] == "stale"
    changed_requirement = deepcopy(reviewed)
    changed_requirement["requirements"][0]["acceptance_criteria"] = "Error under 0.1 kPa."
    assert evaluate_system_requirements(changed_requirement)["cases"][0]["status"] == "stale"


def test_current_analysis_run_and_checksum_are_required_for_internal_evidence():
    from reliability.SystemRequirements import evaluate_system_requirements, review_verification_case
    draft = complete_case()
    draft["verification_evidence"][0].update(source_module="prediction", module_key="prediction", source_analysis_id="p-1", run_id="run-1")
    source = {"runId": "run-1", "moduleKey": "prediction", "analysisId": "p-1", "current": True, "fingerprintSha256": "a" * 64}
    assert evaluate_system_requirements(draft)["cases"][0]["status"] == "blocked"
    reviewed = review_verification_case(draft, "v-1", "Engineer", [source])
    assert evaluate_system_requirements(reviewed, [source])["cases"][0]["status"] == "passed"
    assert evaluate_system_requirements(reviewed, [{**source, "current": False}])["cases"][0]["status"] == "stale"
    assert evaluate_system_requirements(reviewed, [{**source, "fingerprintSha256": "b" * 64}])["cases"][0]["status"] == "stale"


def test_failed_assessment_and_retired_requirement_are_not_verified():
    from reliability.SystemRequirements import evaluate_system_requirements, review_verification_case
    draft = complete_case()
    draft["verification_cases"][0]["outcome"] = "fail"
    reviewed = review_verification_case(draft, "v-1", "Engineer")
    assert evaluate_system_requirements(reviewed)["requirements"][0]["status"] == "failed"
    reviewed["requirements"][0]["lifecycle"] = "retired"
    assert evaluate_system_requirements(reviewed)["requirements"][0]["status"] == "retired"


def test_verification_metadata_does_not_change_fault_map_fingerprint():
    before = propagate_system_definition(architecture())
    after = propagate_system_definition(reviewed_case())
    assert before["fingerprint"] == after["fingerprint"]


def test_review_fingerprint_matches_frontend_golden_manifest():
    import json
    from reliability.SystemRequirements import verification_review_inputs, verification_review_fingerprint
    fixture = json.loads((ROOT / "tests/fixtures/system_verification_contract.json").read_text())
    draft = fixture["model"]
    case = draft["verification_cases"][0]
    assert verification_review_inputs(draft, case) == fixture["inputs"]
    assert verification_review_fingerprint(draft, case) == fixture["fingerprint"]


@pytest.mark.parametrize("value,expected", [
    (1.0, "1"), (-0.0, "0"), (1e-6, "0.000001"), (1e-7, "1e-7"),
    (1e20, "100000000000000000000"), (1e21, "1e+21"), (1.234e-9, "1.234e-9"),
    (0.1, "0.1"), (-12.4, "-12.4"), (120000.0, "120000"),
])
def test_cross_language_number_notation(value, expected):
    from reliability.SystemRequirements import canonical_review_json
    assert canonical_review_json(value) == expected


def test_assessment_endpoint_ignores_claimed_pass_and_preserves_review_manifest():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from routers.system_definition import router
    app = FastAPI()
    app.include_router(router, prefix="/system-definition")
    with TestClient(app) as client:
        draft = complete_case()
        draft["verification_cases"][0]["status"] = "passed"
        response = client.post("/system-definition/requirements/assess", json={"model": draft})
        assert response.status_code == 200
        assert response.json()["cases"][0]["status"] == "unreviewed"
        reviewed = client.post("/system-definition/requirements/review", json={"model": draft, "case_id": "v-1", "reviewer": "Engineer", "reviewed_at": "2026-11-13T12:00:00Z"})
        assert reviewed.status_code == 200, reviewed.text
        assessed = client.post("/system-definition/requirements/assess", json={"model": reviewed.json()})
        assert assessed.status_code == 200, assessed.text
        assert assessed.json()["cases"][0]["status"] == "passed"
        draft["verification_evidence"] = []
        failed = client.post("/system-definition/requirements/review", json={"model": draft, "case_id": "v-1", "reviewer": "Engineer"})
        assert failed.status_code == 422
        malformed = client.post("/system-definition/requirements/assess", json={"model": {**draft, "requirements": [{**requirement(), "extra": True}]}})
        assert malformed.status_code == 422


def test_identifiers_must_be_unique_across_requirement_case_and_evidence_kinds():
    from reliability.SystemRequirements import evaluate_system_requirements
    draft = complete_case()
    draft["verification_cases"][0]["id"] = "req-1"
    result = evaluate_system_requirements(draft)
    assert any(issue["code"] == "duplicate_identity" for issue in result["issues"])
    assert result["cases"][0]["status"] == "blocked"


def test_no_mode_definition_does_not_bypass_joint_unit_and_mission_coverage():
    from reliability.SystemRequirements import evaluate_system_requirements
    draft = complete_case()
    draft["modes"] = []
    draft["requirements"][0].update(mode_ids=[], mission_profile="Standard mission")
    draft["verification_cases"][0]["mode_ids"] = []
    draft["verification_evidence"][0].update(mode_ids=[], mission_context="Different mission")
    draft["verification_evidence"].append({**draft["verification_evidence"][0], "id": "e-2", "units": "Pa", "mission_context": "Standard mission"})
    draft["verification_cases"][0]["evidence_link_ids"].append("e-2")
    result = evaluate_system_requirements(draft)
    assert result["cases"][0]["status"] == "blocked"
    assert any(issue["code"] == "missing_evidence_coverage" for issue in result["cases"][0]["issues"])


def test_physical_fmea_calculates_with_incomplete_canonical_verification_drafts():
    from gui.backend.tests.test_fmea_api import linked_analysis, canonical_model
    from routers.fmea import analyze
    from schemas import FMEAAnalyzeRequest
    from requirement_schemas import FMEAEvidenceLink
    from reliability.SystemRequirements import evaluate_system_requirements
    analysis = linked_analysis()
    system = canonical_model(analysis)
    requirement_draft = SystemRequirement(id="req-draft", allocations=[{"system_model_id": "SYS-1", "instance_id": "pump-1"}])
    evidence_draft = SystemVerificationEvidence(id="e-draft", source_checksum="", requirement_ids=["req-draft"])
    case_draft = SystemVerificationCase(id="v-draft", requirement_ids=["req-draft"], evidence_link_ids=["e-draft"])
    system.update(requirements=[requirement_draft.model_dump(exclude_none=True)],
        verification_cases=[case_draft.model_dump(exclude_none=True)],
        verification_evidence=[evidence_draft.model_dump(exclude_none=True)])
    # Existing editors submit the common base fields, while the canonical
    # System Model retains the additional traceability and review records.
    analysis["functional_requirements"] = [{key: value for key, value in requirement_draft.model_dump(exclude_none=True).items() if key in SystemRequirement.__mro__[1].model_fields}]
    draft_case = {key: value for key, value in case_draft.model_dump(exclude_none=True).items() if key in SystemVerificationCase.__mro__[1].model_fields}
    draft_evidence = {key: value for key, value in evidence_draft.model_dump(exclude_none=True).items() if key in SystemVerificationEvidence.__mro__[1].model_fields}
    request = FMEAAnalyzeRequest.model_validate({"canonical_system": system, "studies": [{
        "schema_version": 4, "id": analysis["id"], "method_profile_id": "aiag_vda_2019_public", "model": analysis,
        "evidence_links": [draft_evidence], "verification_plan": [draft_case],
    }]})
    saved = request.model_dump()
    result = analyze(request)
    assert result["studies"][0]["analysis"]["id"] == analysis["id"]
    assert request.model_dump() == saved
    assert request.studies[0].verification_plan[0].objective == ""
    assert request.studies[0].evidence_links[0].source_checksum == ""
    assert evaluate_system_requirements(system)["cases"][0]["status"] == "draft"
    with pytest.raises(ValidationError):
        FMEAEvidenceLink.model_validate({**draft_evidence, "source_checksum": "malformed-nonempty-checksum"})


def physical_verification_request(*, reviewed=False, internal=False):
    from gui.backend.tests.test_fmea_api import linked_analysis, canonical_model
    from requirement_schemas import FMEAFunctionalRequirement, FMEAVerificationPlanRow, FMEAEvidenceLink
    from reliability.SystemRequirements import review_verification_case
    analysis = linked_analysis()
    system = canonical_model(analysis)
    system["revision"] = "A"
    draft = complete_case()
    draft["requirements"][0]["allocations"] = [{"system_model_id": "SYS-1", "instance_id": "pump-1"}]
    system.update({key: draft[key] for key in ("requirements", "verification_cases", "verification_evidence")})
    sources = []
    if internal:
        system["verification_evidence"][0].update(source_module="prediction", module_key="prediction", source_analysis_id="prediction-1", run_id="run-1")
        sources = [{"runId": "run-1", "moduleKey": "prediction", "analysisId": "prediction-1", "analysisName": "Prediction", "current": True, "fingerprintSha256": "a" * 64, "inputSha256": "b" * 64, "resultSha256": "c" * 64, "engineRevision": 1}]
    if reviewed:
        system = review_verification_case(system, "v-1", "Engineer", sources, "2026-11-13T12:00:00Z")
    analysis["functional_requirements"] = [{key: value for key, value in system["requirements"][0].items() if key in FMEAFunctionalRequirement.model_fields}]
    evidence = [{key: value for key, value in system["verification_evidence"][0].items() if key in FMEAEvidenceLink.model_fields}]
    cases = [{key: value for key, value in system["verification_cases"][0].items() if key in FMEAVerificationPlanRow.model_fields}]
    return {"canonical_system": system, "verification_sources": sources, "studies": [{"schema_version": 4,
        "id": analysis["id"], "method_profile_id": "aiag_vda_2019_public", "model": analysis,
        "evidence_links": evidence, "verification_plan": cases}]}


def test_fmea_api_does_not_trust_forged_physical_verification_pass():
    from routers.fmea import analyze
    from schemas import FMEAAnalyzeRequest
    from reliability.FMEA import study_sha256
    payload = physical_verification_request()
    payload["studies"][0]["verification_plan"][0]["status"] = "passed"
    request = FMEAAnalyzeRequest.model_validate(payload)
    before = request.model_dump()
    result = analyze(request)["studies"][0]
    assert result["projections"]["verification_plan"][0]["status"] == "planned"
    assert any(item["code"] == "canonical_verification_unreviewed" for item in result["governance_findings"])
    assert result["content_sha256"] == study_sha256(before["studies"][0])
    assert request.model_dump() == before


def test_fmea_api_projects_canonical_reviewed_case_fields_and_status():
    from routers.fmea import analyze
    from schemas import FMEAAnalyzeRequest
    payload = physical_verification_request(reviewed=True)
    # The copied plan cannot claim a reviewed case covers a different objective.
    payload["studies"][0]["verification_plan"][0].update(objective="Forged objective", acceptance_criteria="Arbitrary criterion", status="failed")
    result = analyze(FMEAAnalyzeRequest.model_validate(payload))["studies"][0]
    row = result["projections"]["verification_plan"][0]
    assert row["status"] == "passed"
    assert row["objective"] == payload["canonical_system"]["verification_cases"][0]["objective"]
    assert row["acceptance_criteria"] != "Arbitrary criterion"
    assert any(item["code"] == "canonical_verification_snapshot_mismatch" for item in result["governance_findings"])


def test_fmea_api_requires_current_provenance_for_internal_verification():
    from routers.fmea import analyze
    from schemas import FMEAAnalyzeRequest
    payload = physical_verification_request(reviewed=True, internal=True)
    result = analyze(FMEAAnalyzeRequest.model_validate(payload))["studies"][0]
    assert result["projections"]["verification_plan"][0]["status"] == "passed"
    payload["verification_sources"][0]["current"] = False
    result = analyze(FMEAAnalyzeRequest.model_validate(payload))["studies"][0]
    assert result["projections"]["verification_plan"][0]["status"] == "blocked"
    assert any(item["code"] == "canonical_verification_stale" for item in result["governance_findings"])
    payload["verification_sources"] = []
    assert analyze(FMEAAnalyzeRequest.model_validate(payload))["studies"][0]["projections"]["verification_plan"][0]["status"] == "blocked"


def test_fmea_missing_canonical_case_is_blocked_but_still_calculates():
    from routers.fmea import analyze
    from schemas import FMEAAnalyzeRequest
    payload = physical_verification_request(reviewed=True)
    payload["canonical_system"]["verification_cases"] = []
    result = analyze(FMEAAnalyzeRequest.model_validate(payload))["studies"][0]
    assert result["projections"]["verification_plan"][0]["status"] == "blocked"
    assert any(item["code"] == "missing_canonical_verification" for item in result["governance_findings"])
    assert result["analysis"]["id"] == "DFMEA-1"


def test_pfmea_keeps_process_owned_verification_even_with_canonical_system_present():
    from routers.fmea import analyze
    from schemas import FMEAAnalyzeRequest
    payload = physical_verification_request()
    study = payload["studies"][0]
    analysis = study["model"]
    analysis.update(kind="pfmea", system_binding=None, interfaces=[])
    for node in analysis["structure_nodes"]:
        node.update(level="process_step", system_definition_ref=None)
    for function in analysis["functions"]:
        function.update(system_definition_ref=None, definition={"role": "maintain_state", "action": "Assembly integrity", "io": []})
    for chain in analysis["failure_chains"]:
        chain.pop("system_definition_ref", None)
    study["verification_plan"][0]["status"] = "passed"
    request = FMEAAnalyzeRequest.model_validate(payload)
    result = analyze(request)["studies"][0]
    assert result["projections"]["verification_plan"][0]["status"] == "passed"
    assert not any(item["code"].startswith("canonical_verification") for item in result["governance_findings"])


def test_function_allocation_tracks_occurrence_quantity_and_upstream_producers():
    from reliability.SystemRequirements import review_verification_case, evaluate_system_requirements
    draft = complete_case()
    # Controller input depends on the sensor's pressure output.
    draft["requirements"][0]["allocations"] = [{"system_model_id": "SYS-1", "instance_id": "controller-1", "function_id": "control"}]
    reviewed = review_verification_case(draft, "v-1", "Engineer")
    quantity_change = deepcopy(reviewed)
    quantity_change["instances"][1]["quantity"] = 2
    assert evaluate_system_requirements(quantity_change)["cases"][0]["status"] == "stale"
    producer_change = deepcopy(reviewed)
    producer_change["definitions"][0]["functions"][0]["definition"]["action"] = "Supply calibrated pressure"
    assert evaluate_system_requirements(producer_change)["cases"][0]["status"] == "stale"
    properties_change = deepcopy(reviewed)
    properties_change["definitions"][0]["properties"] = {"accuracy": {"kind": "number", "value": 2, "unit": "kPa"}}
    assert evaluate_system_requirements(properties_change)["cases"][0]["status"] == "stale"


def test_fmea_projection_does_not_pair_canonical_pass_with_copied_evidence_claim():
    from routers.fmea import analyze
    from schemas import FMEAAnalyzeRequest
    payload = physical_verification_request(reviewed=True)
    payload["studies"][0]["evidence_links"][0]["claim"] = "Unreviewed replacement claim"
    result = analyze(FMEAAnalyzeRequest.model_validate(payload))["studies"][0]
    assert result["projections"]["verification_plan"][0]["status"] == "passed"
    assert result["projections"]["evidence_links"][0]["claim"] == payload["canonical_system"]["verification_evidence"][0]["claim"]
    assert any(item["code"] == "canonical_verification_evidence_mismatch" for item in result["governance_findings"])
    assert result["release_ready"] is False


def test_function_review_stales_when_occurrence_mode_applicability_changes():
    from reliability.SystemRequirements import review_verification_case, evaluate_system_requirements
    draft = complete_case()
    draft["modes"].append({"id": "standby", "name": "Standby", "description": ""})
    draft["requirements"][0]["allocations"] = [{"system_model_id": "SYS-1", "instance_id": "sensor-1", "function_id": "measure"}]
    reviewed = review_verification_case(draft, "v-1", "Engineer")
    assert evaluate_system_requirements(reviewed)["cases"][0]["status"] == "passed"
    reviewed["instances"][0]["mode_ids"] = ["standby"]
    assert evaluate_system_requirements(reviewed)["cases"][0]["status"] == "stale"
