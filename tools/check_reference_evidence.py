#!/usr/bin/env python3
"""Validate the MIL-HDBK-217F evidence catalog and PDF tracking policy."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CATALOG = ROOT / "docs" / "standards" / "mil-hdbk-217f-evidence.json"
AVAILABLE_STATUSES = {"controlled_tracked", "local_untracked", "public_external"}
ALL_AVAILABILITY_STATUSES = AVAILABLE_STATUSES | {"identified_unavailable"}
IDENTITY_STATUSES = {"verified", "corrected", "conflicted", "unverified"}
REVIEW_STATUSES = {"fully_reviewed", "identity_verified", "pending", "context_only"}
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
REQUIRED_DOCUMENT_FIELDS = {
    "id",
    "document_number",
    "accession",
    "title",
    "date",
    "authority",
    "authority_role",
    "relationship",
    "supports",
    "acquisition_status",
    "identity_status",
    "review_status",
    "local_files",
    "findings",
    "limitations",
}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _tracked_reference_pdfs(root: Path) -> set[str]:
    result = subprocess.run(
        ["git", "-C", str(root), "ls-files", "--", "docs/references/*.pdf"],
        check=True,
        capture_output=True,
        text=True,
    )
    prefix = "docs/references/"
    return {
        line[len(prefix):]
        for line in result.stdout.splitlines()
        if line.startswith(prefix)
    }


def _validate_string_list(value: Any, label: str, errors: list[str]) -> None:
    if not isinstance(value, list) or not all(
        isinstance(item, str) and item.strip() for item in value
    ):
        errors.append(f"{label} must be a list of non-empty strings")


def _validate_local_files(
    files: Any,
    *,
    label: str,
    acquisition_status: Any,
    root: Path,
    check_files: bool,
    seen_filenames: set[str],
    errors: list[str],
) -> None:
    if not isinstance(files, list):
        errors.append(f"{label}.local_files must be a list")
        return
    if acquisition_status in {"controlled_tracked", "local_untracked"} and not files:
        errors.append(f"{label} with {acquisition_status!r} requires local_files")
    if acquisition_status in {"public_external", "identified_unavailable"} and files:
        errors.append(f"{label} with {acquisition_status!r} must not declare local_files")

    for index, local_file in enumerate(files):
        file_label = f"{label}.local_files[{index}]"
        if not isinstance(local_file, dict):
            errors.append(f"{file_label} must be an object")
            continue
        required = {"filename", "sha256", "redistribution_status"}
        missing = sorted(required - set(local_file))
        if missing:
            errors.append(f"{file_label} missing fields: {', '.join(missing)}")
            continue
        filename = local_file["filename"]
        if not isinstance(filename, str) or Path(filename).name != filename or not filename.endswith(".pdf"):
            errors.append(f"{file_label}.filename must be a basename ending in .pdf")
            continue
        if filename in seen_filenames:
            errors.append(f"local filename is cataloged more than once: {filename}")
        seen_filenames.add(filename)

        expected_hash = local_file["sha256"]
        if not isinstance(expected_hash, str) or not SHA256_RE.fullmatch(expected_hash):
            errors.append(f"{file_label}.sha256 must be a lowercase SHA-256 digest")
            continue

        if check_files:
            path = root / "docs" / "references" / filename
            if path.is_file():
                actual_hash = _sha256(path)
                if actual_hash != expected_hash:
                    errors.append(
                        f"{file_label} hash mismatch: expected {expected_hash}, got {actual_hash}"
                    )
            elif acquisition_status == "controlled_tracked":
                errors.append(f"controlled reference is missing: {path.relative_to(root)}")


def _validate_document(
    document: Any,
    *,
    label: str,
    root: Path,
    check_files: bool,
    seen_ids: set[str],
    seen_filenames: set[str],
    errors: list[str],
) -> None:
    if not isinstance(document, dict):
        errors.append(f"{label} must be an object")
        return
    missing = sorted(REQUIRED_DOCUMENT_FIELDS - set(document))
    if missing:
        errors.append(f"{label} missing fields: {', '.join(missing)}")
        return

    document_id = document["id"]
    if not isinstance(document_id, str) or not document_id.strip():
        errors.append(f"{label}.id must be a non-empty string")
    elif document_id in seen_ids:
        errors.append(f"duplicate evidence id: {document_id}")
    else:
        seen_ids.add(document_id)

    for field in ("supports", "findings", "limitations"):
        _validate_string_list(document[field], f"{label}.{field}", errors)

    acquisition_status = document["acquisition_status"]
    if acquisition_status not in ALL_AVAILABILITY_STATUSES:
        errors.append(f"{label}.acquisition_status is invalid: {acquisition_status!r}")
    if document["identity_status"] not in IDENTITY_STATUSES:
        errors.append(f"{label}.identity_status is invalid: {document['identity_status']!r}")
    if document["review_status"] not in REVIEW_STATUSES:
        errors.append(f"{label}.review_status is invalid: {document['review_status']!r}")

    _validate_local_files(
        document["local_files"],
        label=label,
        acquisition_status=acquisition_status,
        root=root,
        check_files=check_files,
        seen_filenames=seen_filenames,
        errors=errors,
    )


def validate_payload(
    payload: Any,
    *,
    root: Path = ROOT,
    check_files: bool = True,
    tracked_pdfs: Iterable[str] | None = None,
) -> list[str]:
    """Return all catalog and repository-policy errors."""
    errors: list[str] = []
    if not isinstance(payload, dict):
        return ["catalog must be a JSON object"]

    required = {
        "$schema",
        "schema_version",
        "catalog_id",
        "reviewed_on",
        "policy",
        "program_status",
        "documents",
        "appendix_c_entries",
    }
    missing = sorted(required - set(payload))
    if missing:
        return [f"catalog missing fields: {', '.join(missing)}"]
    if payload["schema_version"] != 1:
        errors.append("schema_version must be 1")
    schema_path = root / "docs" / "standards" / Path(str(payload["$schema"])).name
    if check_files and not schema_path.is_file():
        errors.append(f"catalog schema does not exist: {schema_path.relative_to(root)}")

    policy = payload["policy"]
    if not isinstance(policy, dict):
        return errors + ["policy must be an object"]
    if policy.get("reference_directory") != "docs/references":
        errors.append("policy.reference_directory must be docs/references")
    if policy.get("metadata_only_for_new_sources") is not True:
        errors.append("policy.metadata_only_for_new_sources must be true")
    if policy.get("availability_statuses") != [
        "controlled_tracked",
        "local_untracked",
        "public_external",
        "identified_unavailable",
    ]:
        errors.append("policy.availability_statuses is not the canonical ordered list")

    allowlist_records = policy.get("tracked_pdf_allowlist")
    if not isinstance(allowlist_records, list):
        return errors + ["policy.tracked_pdf_allowlist must be a list"]
    allowlist: set[str] = set()
    allowlist_seen: set[str] = set()
    _validate_local_files(
        allowlist_records,
        label="policy.tracked_pdf_allowlist",
        acquisition_status="controlled_tracked",
        root=root,
        check_files=check_files,
        seen_filenames=allowlist_seen,
        errors=errors,
    )
    allowlist = {
        record.get("filename")
        for record in allowlist_records
        if isinstance(record, dict) and isinstance(record.get("filename"), str)
    }
    expected_allowlist = {"MIL-HDBK-217F-Notice2.pdf", "AV51DOT1-2013-R2018.pdf"}
    if allowlist != expected_allowlist:
        errors.append(
            "tracked PDF allowlist must contain only the controlled MIL-HDBK-217F "
            "Notice 2 and ANSI/VITA 51.1 files"
        )

    if tracked_pdfs is None and check_files:
        try:
            tracked_pdfs = _tracked_reference_pdfs(root)
        except (OSError, subprocess.CalledProcessError) as exc:
            errors.append(f"could not inspect tracked reference PDFs: {exc}")
            tracked_pdfs = ()
    if tracked_pdfs is not None:
        tracked_set = set(tracked_pdfs)
        unauthorized = sorted(tracked_set - allowlist)
        missing_tracked = sorted(allowlist - tracked_set)
        if unauthorized:
            errors.append(f"reference PDFs tracked outside allowlist: {', '.join(unauthorized)}")
        if missing_tracked:
            errors.append(f"allowlisted controlled PDFs are not tracked: {', '.join(missing_tracked)}")

    documents = payload["documents"]
    entries = payload["appendix_c_entries"]
    if not isinstance(documents, list):
        errors.append("documents must be a list")
        documents = []
    if not isinstance(entries, list):
        errors.append("appendix_c_entries must be a list")
        entries = []

    seen_ids: set[str] = set()
    seen_filenames: set[str] = set()
    for index, document in enumerate(documents):
        _validate_document(
            document,
            label=f"documents[{index}]",
            root=root,
            check_files=check_files,
            seen_ids=seen_ids,
            seen_filenames=seen_filenames,
            errors=errors,
        )
    for index, entry in enumerate(entries):
        _validate_document(
            entry,
            label=f"appendix_c_entries[{index}]",
            root=root,
            check_files=check_files,
            seen_ids=seen_ids,
            seen_filenames=seen_filenames,
            errors=errors,
        )

    reference_numbers = [
        entry.get("reference_number") if isinstance(entry, dict) else None
        for entry in entries
    ]
    if reference_numbers != list(range(1, 39)):
        errors.append("Appendix C references must be exactly the ordered sequence 1 through 38")

    available = sum(
        1
        for entry in entries
        if isinstance(entry, dict) and entry.get("acquisition_status") in AVAILABLE_STATUSES
    )
    lineage = payload.get("program_status", {}).get("lineage_evidence", {})
    if not isinstance(lineage, dict):
        errors.append("program_status.lineage_evidence must be an object")
    else:
        if lineage.get("total") != len(entries) or lineage.get("total") != 38:
            errors.append("lineage total must equal the 38 Appendix C references")
        if lineage.get("available_unique") != available:
            errors.append(
                "lineage available_unique does not match acquisition statuses: "
                f"declared {lineage.get('available_unique')}, derived {available}"
            )
        if lineage.get("missing") != 38 - available:
            errors.append(
                "lineage missing does not match acquisition statuses: "
                f"declared {lineage.get('missing')}, derived {38 - available}"
            )
        if lineage.get("status") != "partial":
            errors.append("lineage status must remain partial while Appendix C coverage is incomplete")

    entry_30 = next(
        (entry for entry in entries if isinstance(entry, dict) and entry.get("reference_number") == 30),
        {},
    )
    if (
        entry_30.get("document_number") != "RADC-TR-89-177"
        or entry_30.get("accession") != "ADA214601"
        or entry_30.get("identity_status") != "corrected"
    ):
        errors.append("Appendix C entry 30 must preserve the RADC-TR-89-177/ADA214601 correction")

    if check_files:
        gitignore = root / ".gitignore"
        ignored_rules = gitignore.read_text(encoding="utf-8") if gitignore.is_file() else ""
        required_rules = {
            "docs/references/*.pdf",
            "!docs/references/MIL-HDBK-217F-Notice2.pdf",
            "!docs/references/AV51DOT1-2013-R2018.pdf",
        }
        lines = {line.strip() for line in ignored_rules.splitlines()}
        missing_rules = sorted(required_rules - lines)
        if missing_rules:
            errors.append(f".gitignore is missing reference PDF policy rules: {', '.join(missing_rules)}")

    return errors


def validate(
    catalog_path: Path = DEFAULT_CATALOG,
    *,
    root: Path = ROOT,
    check_files: bool = True,
    tracked_pdfs: Iterable[str] | None = None,
) -> list[str]:
    try:
        payload = json.loads(catalog_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return [f"could not load evidence catalog {catalog_path}: {exc}"]
    return validate_payload(
        payload,
        root=root,
        check_files=check_files,
        tracked_pdfs=tracked_pdfs,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("catalog", nargs="?", type=Path, default=DEFAULT_CATALOG)
    args = parser.parse_args(argv)
    errors = validate(args.catalog)
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    payload = json.loads(args.catalog.read_text(encoding="utf-8"))
    lineage = payload["program_status"]["lineage_evidence"]
    print(
        "Reference evidence valid: "
        f"{lineage['available_unique']}/{lineage['total']} unique Appendix C sources available; "
        "new PDFs are metadata-only."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
