import json
from pathlib import Path

from tools.check_model_assurance import validate


ROOT = Path(__file__).resolve().parents[1]
MATRIX = ROOT / "docs" / "audit" / "model-assurance-matrix.json"


def _matrix_payload():
    return json.loads(MATRIX.read_text(encoding="utf-8"))


def _validate_payload(tmp_path, payload, *, strict=False):
    path = tmp_path / "model-assurance-matrix.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return validate(path, strict=strict)


def test_model_assurance_inventory_is_structurally_valid():
    report = validate(MATRIX)
    assert report["passed"], report["errors"]
    assert report["domain_count"] > 0
    assert report["model_count"] > 0


def test_strict_gate_cannot_claim_global_certification_while_gaps_remain():
    report = validate(MATRIX, strict=True)
    assert report["passed"] is False
    assert any("per-model inventory is incomplete" in message
               for message in report["errors"])
    assert any("uncertified domains" in message for message in report["errors"])


def test_checker_rejects_nonexistent_implementation_and_evidence(tmp_path):
    payload = _matrix_payload()
    model = payload["models"][0]
    model["implementation"][0] = "src/reliability/not_a_model.py::Missing"
    model["evidence"][0]["path"] = "tests/not_independent_evidence.py"

    report = _validate_payload(tmp_path, payload)

    assert report["passed"] is False
    assert any("implementation reference does not exist" in message
               for message in report["errors"])
    assert any("evidence crow_exact_published path does not exist" in message
               for message in report["errors"])


def test_complete_inventory_requires_reconcilable_model_source(tmp_path):
    payload = _matrix_payload()
    payload["model_inventory_complete"] = True

    missing_source = _validate_payload(tmp_path, payload)
    assert any("requires a repository-relative model_inventory_source" in message
               for message in missing_source["errors"])

    payload["model_inventory_source"] = (
        "tests/fixtures/model-assurance-inventory-mismatch.csv"
    )
    mismatched_source = _validate_payload(tmp_path, payload)
    assert any("omits inventoried models" in message
               for message in mismatched_source["errors"])
    assert any("models absent from model inventory" in message
               for message in mismatched_source["errors"])


def test_certified_model_requires_full_capability_accounting(tmp_path):
    payload = _matrix_payload()
    model = payload["models"][0]
    model["status"] = "verified_with_caveats"
    model["blockers"] = []
    model["capabilities"] = {
        "required": ["implemented method", "silently omitted method"],
        "implemented": ["implemented method"],
        "explicit_gaps": [],
    }
    report = _validate_payload(tmp_path, payload)

    assert report["passed"] is False
    assert any("capability accounting omits" in message
               and "silently omitted method" in message
               for message in report["errors"])
    assert any("verified_with_caveats requires explicit gaps" in message
               for message in report["errors"])


def test_certified_domain_cannot_hide_uncertified_model(tmp_path):
    payload = _matrix_payload()
    next(domain for domain in payload["domains"]
         if domain["id"] == "growth")["status"] = "verified"

    report = _validate_payload(tmp_path, payload)

    assert report["passed"] is False
    assert any("domain growth: cannot be certified" in message
               and "growth.crow_amsaa_exact" in message
               for message in report["errors"])


def test_prior_false_certification_mutation_now_fails_closed(tmp_path):
    payload = _matrix_payload()
    payload["model_inventory_complete"] = True
    for domain in payload["domains"]:
        domain["status"] = "verified"
    model = payload["models"][0]
    model["status"] = "verified_with_caveats"
    model["blockers"] = []
    model["capabilities"] = {}
    # A schema-v1-style list of arbitrary existing file strings must not be
    # accepted as typed, mapped scientific evidence.
    model["evidence"] = ["README.md"]
    for field in model["validation"]:
        model["validation"][field] = ["README.md"]

    report = _validate_payload(tmp_path, payload, strict=True)

    assert report["passed"] is False
    assert any("model_inventory_source" in message for message in report["errors"])
    assert any("every evidence entry must be an object" in message
               for message in report["errors"])
    assert any("references unknown evidence 'README.md'" in message
               for message in report["errors"])
    assert any("capabilities.required must be non-empty" in message
               for message in report["errors"])


def test_certified_claim_requires_per_regime_applicability(tmp_path):
    payload = _matrix_payload()
    model = payload["models"][0]
    model["status"] = "verified_with_caveats"
    model["blockers"] = []
    model["capabilities"] = {
        "required": ["implemented", "documented caveat"],
        "implemented": ["implemented"],
        "explicit_gaps": ["documented caveat"],
    }
    model["claims"][0]["applicability"] = (
        model["claims"][0]["applicability"][:1])

    report = _validate_payload(tmp_path, payload)

    assert report["passed"] is False
    assert any("certified claim mean_and_intensity has no applicability decision"
               in message for message in report["errors"])


def test_typed_evidence_requires_bidirectional_claim_regime_mapping(tmp_path):
    payload = _matrix_payload()
    payload["models"][0]["evidence"][0]["claim_ids"].append(
        "integration_contract")

    report = _validate_payload(tmp_path, payload)

    assert report["passed"] is False
    assert any("evidence crow_exact_published claim mapping does not match"
               in message for message in report["errors"])


def test_certification_rejects_wrong_evidence_kind_and_pr_calibration(tmp_path):
    payload = _matrix_payload()
    model = payload["models"][0]
    model["status"] = "verified_with_caveats"
    model["blockers"] = []
    model["capabilities"] = {
        "required": ["implemented", "documented caveat"],
        "implemented": ["implemented"],
        "explicit_gaps": ["documented caveat"],
    }
    exact_calibration = next(
        evidence for evidence in model["evidence"]
        if evidence["id"] == "crow_exact_calibration_pr")
    exact_calibration["kind"] = "consistency_test"
    exact_calibration["independence"] = "consistency"

    report = _validate_payload(tmp_path, payload)

    assert report["passed"] is False
    assert any("validation.calibration_evidence evidence crow_exact_calibration_pr "
               "must have kind 'simulation_calibration'" in message
               for message in report["errors"])
    assert any("validation.calibration_evidence evidence crow_exact_calibration_pr "
               "must be independent" in message for message in report["errors"])
    assert any("calibration evidence crow_exact_cvm_pr must use the "
               "release profile" in message for message in report["errors"])
    assert any("certified claim exact_uncertainty regime "
               "beta_equal_one lacks passed independent "
               "evidence" in message for message in report["errors"])


def test_growth_assurance_records_do_not_conflate_procedures():
    payload = _matrix_payload()
    models = {model["id"]: model for model in payload["models"]}
    expected = {
        "growth.crow_amsaa_exact",
        "growth.crow_amsaa_grouped",
        "growth.mcf_parametric_pooled",
        "growth.mcf_nonparametric",
    }

    assert expected.issubset(models)
    assert payload["model_inventory_complete"] is False
    assert all(models[model_id]["status"] == "needs_revision"
               for model_id in expected)
    assert all("MCF_" not in reference for model_id in (
        "growth.crow_amsaa_exact", "growth.crow_amsaa_grouped")
               for reference in models[model_id]["implementation"])
    assert all("CrowAMSAA" not in reference for model_id in (
        "growth.mcf_parametric_pooled", "growth.mcf_nonparametric")
               for reference in models[model_id]["implementation"])
    for model_id in expected:
        assert models[model_id]["blockers"]
        assert all(evidence["procedure_id"] == model_id
                   for evidence in models[model_id]["evidence"])


def test_checker_rejects_cross_procedure_evidence_label(tmp_path):
    payload = _matrix_payload()
    grouped = next(model for model in payload["models"]
                   if model["id"] == "growth.crow_amsaa_grouped")
    grouped["evidence"][0]["procedure_id"] = "growth.crow_amsaa_exact"

    report = _validate_payload(tmp_path, payload)

    assert report["passed"] is False
    assert any("procedure_id must equal its owning model id" in message
               for message in report["errors"])


def test_checker_rejects_cross_procedure_evidence_location_reuse(tmp_path):
    payload = _matrix_payload()
    exact = next(model for model in payload["models"]
                 if model["id"] == "growth.crow_amsaa_exact")
    grouped = next(model for model in payload["models"]
                   if model["id"] == "growth.crow_amsaa_grouped")
    grouped["evidence"][0]["path"] = exact["evidence"][0]["path"]
    grouped["evidence"][0]["node"] = exact["evidence"][0]["node"]

    report = _validate_payload(tmp_path, payload)

    assert report["passed"] is False
    assert any("already owned by procedure growth.crow_amsaa_exact" in message
               and "use a procedure-specific evidence node" in message
               for message in report["errors"])


def test_checker_rejects_duplicate_evidence_id_across_procedures(tmp_path):
    payload = _matrix_payload()
    exact = next(model for model in payload["models"]
                 if model["id"] == "growth.crow_amsaa_exact")
    grouped = next(model for model in payload["models"]
                   if model["id"] == "growth.crow_amsaa_grouped")
    grouped["evidence"][0]["id"] = exact["evidence"][0]["id"]
    for claim in grouped["claims"]:
        for applicability in claim["applicability"]:
            applicability["evidence_ids"] = [
                exact["evidence"][0]["id"]
                if evidence_id == "crow_grouped_published" else evidence_id
                for evidence_id in applicability["evidence_ids"]
            ]
    grouped["validation"]["published_benchmarks"] = [
        exact["evidence"][0]["id"]]

    report = _validate_payload(tmp_path, payload)

    assert report["passed"] is False
    assert any("evidence id 'crow_exact_published' is already owned by "
               "procedure growth.crow_amsaa_exact" in message
               for message in report["errors"])
