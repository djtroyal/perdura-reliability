"""Conformance claims must remain explicit and evidence-backed."""

import pytest

from reliability.Standards import (
    CONFORMANCE_TIERS,
    DERATING_DISCLOSURE_IDS,
    STANDARD_DISCLOSURES,
    get_derating_disclosure,
    get_standard_disclosure,
)


PREDICTION_MODELS = {
    "MIL-HDBK-217F",
    "VITA-51.1",
    "Telcordia",
    "217Plus",
    "FIDES",
    "NSWC",
    "EPRD-2014",
    "NPRD-2023",
}


@pytest.mark.parametrize("standard_id", sorted(STANDARD_DISCLOSURES))
def test_every_disclosure_has_auditable_provenance(standard_id):
    disclosure = get_standard_disclosure(standard_id)

    assert disclosure["standard_id"] == standard_id
    assert disclosure["edition"]
    assert disclosure["authority"]
    assert disclosure["method_scope"]
    assert disclosure["implementation_scope"]
    assert disclosure["known_exclusions"]
    assert disclosure["clause_coverage"]
    assert disclosure["reviewed_on"]
    assert disclosure["conformance_tier"] in CONFORMANCE_TIERS
    assert disclosure["tier_definition"]["label"]
    assert disclosure["source"]["title"]
    assert disclosure["source"]["access"]

    validation = disclosure["authoritative_example_validation"]
    assert validation["status"] in {
        "not_applicable", "not_completed", "partial", "passed", "failed",
    }
    assert validation["passed"] <= validation["total"]
    assert validation["note"]


def test_all_branded_prediction_models_are_registered():
    assert PREDICTION_MODELS <= set(STANDARD_DISCLOSURES)


def test_verified_tier_requires_source_parity_evidence():
    for standard_id in STANDARD_DISCLOSURES:
        disclosure = get_standard_disclosure(standard_id)
        validation = disclosure["authoritative_example_validation"]
        if disclosure["full_conformance_claimed"]:
            assert disclosure["conformance_tier"] == "verified"
            if validation["status"] == "not_applicable":
                assert validation["total"] == 0
                assert validation["passed"] == 0
                assert "no authoritative worked-example" in validation["note"]
            else:
                assert validation["status"] == "passed"
                assert validation["total"] > 0
                assert validation["passed"] == validation["total"]
        else:
            assert disclosure["conformance_tier"] != "verified"


def test_registry_returns_detached_disclosures():
    first = get_standard_disclosure("MIL-HDBK-217F")
    first["clause_coverage"].append("mutation")
    first["source"]["title"] = "mutation"

    second = get_standard_disclosure("MIL-HDBK-217F")
    assert "mutation" not in second["clause_coverage"]
    assert second["source"]["title"] != "mutation"


def test_every_derating_selector_has_a_disclosure():
    assert {
        "MIL-STD-975M", "RADC-TR-84-254", "RL-TR-92-11", "NAVSEA", "ECSS", "Custom",
    } <= set(DERATING_DISCLOSURE_IDS)
    assert "MIL-STD-975" not in DERATING_DISCLOSURE_IDS
    for selector in DERATING_DISCLOSURE_IDS:
        assert get_derating_disclosure(selector)["standard_id"].endswith(
            "derating"
        ) or selector == "Custom"
