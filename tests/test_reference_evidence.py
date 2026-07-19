from __future__ import annotations

from copy import deepcopy
import json

from tools.check_reference_evidence import DEFAULT_CATALOG, validate, validate_payload


def _catalog() -> dict:
    return json.loads(DEFAULT_CATALOG.read_text(encoding="utf-8"))


def test_repository_evidence_catalog_and_pdf_policy_are_valid():
    assert validate() == []


def test_appendix_c_coverage_is_derived_from_unique_entries():
    catalog = _catalog()
    entries = catalog["appendix_c_entries"]
    available = [
        entry
        for entry in entries
        if entry["acquisition_status"]
        in {"controlled_tracked", "local_untracked", "public_external"}
    ]

    assert [entry["reference_number"] for entry in entries] == list(range(1, 39))
    assert len(available) == 12
    assert catalog["program_status"]["lineage_evidence"] == {
        "status": "partial",
        "available_unique": 12,
        "total": 38,
        "missing": 26,
    }


def test_declared_coverage_cannot_drift_from_acquisition_statuses():
    catalog = _catalog()
    catalog["program_status"]["lineage_evidence"]["available_unique"] = 13

    errors = validate_payload(catalog, check_files=False)

    assert any("available_unique" in error and "derived 12" in error for error in errors)


def test_duplicate_scans_do_not_create_duplicate_appendix_entries():
    catalog = _catalog()
    entry_32 = catalog["appendix_c_entries"][31]

    assert entry_32["document_number"] == "RADC-TR-90-72"
    assert len(entry_32["local_files"]) == 2
    assert catalog["program_status"]["lineage_evidence"]["available_unique"] == 12


def test_mil_hdbk_978b_resistor_delegation_evidence_is_pinned():
    catalog = _catalog()
    entry = catalog["appendix_c_entries"][34]

    assert entry["document_number"] == "MIL-HDBK-978B (NASA), Volume I"
    assert entry["acquisition_status"] == "public_external"
    assert entry["review_status"] == "fully_reviewed"
    assert any(
        "7ad4d29529fa42b24676fc3e22f178c2d2c099617c15fab15af8db536aa453be"
        in finding
        for finding in entry["findings"]
    )
    assert any("3.3.5.3" in finding for finding in entry["findings"])


def test_duplicate_evidence_ids_are_rejected():
    catalog = _catalog()
    catalog["appendix_c_entries"][1]["id"] = catalog["appendix_c_entries"][0]["id"]

    errors = validate_payload(catalog, check_files=False)

    assert any("duplicate evidence id" in error for error in errors)


def test_unallowlisted_tracked_pdf_is_rejected():
    catalog = _catalog()
    tracked = {
        "MIL-HDBK-217F-Notice2.pdf",
        "AV51DOT1-2013-R2018.pdf",
        "new-reference.pdf",
    }

    errors = validate_payload(catalog, check_files=False, tracked_pdfs=tracked)

    assert any("new-reference.pdf" in error for error in errors)


def test_missing_allowlisted_controlled_pdf_is_rejected():
    catalog = _catalog()

    errors = validate_payload(
        catalog,
        check_files=False,
        tracked_pdfs={"MIL-HDBK-217F-Notice2.pdf"},
    )

    assert any("AV51DOT1-2013-R2018.pdf" in error for error in errors)


def test_appendix_c_vhsic_report_number_correction_is_locked():
    catalog = _catalog()
    entry_30 = catalog["appendix_c_entries"][29]
    assert entry_30["document_number"] == "RADC-TR-89-177"
    assert entry_30["accession"] == "ADA214601"
    assert entry_30["identity_status"] == "corrected"

    altered = deepcopy(catalog)
    altered["appendix_c_entries"][29]["document_number"] = "RADC-TR-89-171"
    errors = validate_payload(altered, check_files=False)
    assert any("RADC-TR-89-177/ADA214601 correction" in error for error in errors)


def test_new_reference_pdfs_are_not_in_the_tracking_allowlist():
    catalog = _catalog()
    allowlist = {
        record["filename"] for record in catalog["policy"]["tracked_pdf_allowlist"]
    }

    assert allowlist == {
        "MIL-HDBK-217F-Notice2.pdf",
        "AV51DOT1-2013-R2018.pdf",
    }
    assert "RADC-TR-85-91_MAY1985.pdf" not in allowlist
    assert "MIL-STD-883-1.pdf" not in allowlist


def test_derating_cross_reference_evidence_is_pinned_without_tracking_pdfs():
    catalog = _catalog()
    documents = {document["id"]: document for document in catalog["documents"]}

    toolkit = documents["radc-reliability-engineers-toolkit-1988"]
    assert toolkit["document_number"].endswith("(July 1988 issue)")
    assert toolkit["local_files"] == [{
        "filename": "RADC_Reliability_Engineers_Toolkit.pdf",
        "sha256": "2e137b2790eb97e428b380e053c02408ffb2531dbc1b6f55705d8baf0ce1c136",
        "redistribution_status": "public_domain_source_scan",
    }]

    rome_toolkit = documents[
        "rome-laboratory-reliability-engineers-toolkit-1993"
    ]
    assert rome_toolkit["date"] == "1993-04"
    assert rome_toolkit["local_files"] == [{
        "filename": "Rome_Laboratory_Reliability_Engineers_Toolkit.pdf",
        "sha256": "8ea85b2d1536c33b77c4e8191cc8d00592eabab1b4b08c11f15ea164fc15c815",
        "redistribution_status": "public_domain_source_scan",
    }]

    mil198 = documents["mil-std-198e-capacitor-guidance"]
    assert mil198["acquisition_status"] == "public_external"
    assert mil198["review_status"] == "fully_reviewed"
    assert mil198["local_files"] == []
    findings = " ".join(mil198["findings"])
    for digest in (
        "ab159381fbc2cecf249088252ca9e5d8c5afb88b00f7fdfee9810d15d6192a77",
        "a2631090385bd78f3f7a9a7c22c571158ecf48240d39fed5d1417daeac6c3d0d",
        "789b3ad07f521a60d2d9180a1d5fd553784c6697c2abbea83217d658aa358642",
        "9a8a838d8a90f169596fe936d3e37239b182788cfc6815b25188e40f9c57f13a",
    ):
        assert digest in findings
