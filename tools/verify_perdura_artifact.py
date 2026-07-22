#!/usr/bin/env python3
"""Verify a Perdura artifact package using only the Python standard library.

This validates byte integrity and trace metadata. A SHA-256 checksum is not a
digital signature and therefore does not establish who produced the artifact.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import zipfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


MANIFEST_SCHEMA = "perdura.artifact-manifest/v1"


@dataclass
class VerificationResult:
    valid: bool
    integrity: str
    traceability: str
    authenticity: str
    artifact: str
    expected_sha256: str
    actual_sha256: str
    issues: list[str]
    warnings: list[str]


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _read_package(path: Path) -> tuple[bytes, dict[str, Any]]:
    with zipfile.ZipFile(path) as archive:
        sidecars = [name for name in archive.namelist() if name.endswith(".perdura.json")]
        if len(sidecars) != 1:
            raise ValueError(f"expected exactly one .perdura.json manifest; found {len(sidecars)}")
        manifest = json.loads(archive.read(sidecars[0]))
        filename = manifest.get("artifact", {}).get("filename")
        candidates = [name for name in archive.namelist()
                      if name != sidecars[0] and (name == filename or name.endswith(f"/{filename}"))]
        if len(candidates) != 1:
            raise ValueError(f"declared artifact {filename!r} is missing or ambiguous")
        return archive.read(candidates[0]), manifest


def _read_pair(artifact: Path, manifest_path: Path) -> tuple[bytes, dict[str, Any]]:
    return artifact.read_bytes(), json.loads(manifest_path.read_text(encoding="utf-8"))


def verify(data: bytes, manifest: dict[str, Any], verification_report: Path | None = None) -> VerificationResult:
    issues: list[str] = []
    warnings: list[str] = []
    artifact = manifest.get("artifact") if isinstance(manifest.get("artifact"), dict) else {}
    software = manifest.get("software") if isinstance(manifest.get("software"), dict) else {}
    assurance = manifest.get("assurance") if isinstance(manifest.get("assurance"), dict) else {}
    expected = str(artifact.get("sha256", "")).lower()
    actual = _sha256(data)

    if manifest.get("schema") != MANIFEST_SCHEMA:
        issues.append("Unsupported or missing artifact-manifest schema.")
    if expected != actual:
        issues.append("Artifact SHA-256 does not match the manifest.")
    if artifact.get("sizeBytes") != len(data):
        issues.append("Artifact byte size does not match the manifest.")
    if assurance.get("level") != "checksum_only" or assurance.get("authenticityEstablished") is not False:
        issues.append("Manifest makes an invalid checksum-only assurance claim.")

    trace_fields = [manifest.get("artifactId"), manifest.get("project", {}).get("projectId"),
                    software.get("version"), software.get("commit")]
    traceability = "linked" if all(isinstance(value, str) and value for value in trace_fields) else "incomplete"
    if traceability == "incomplete":
        warnings.append("Project, artifact, or software trace fields are incomplete.")
    if software.get("buildStatus") == "development":
        warnings.append("Manifest identifies a development build, not release build evidence.")
    if software.get("buildStatus") == "identity-mismatch":
        issues.append("Manifest records inconsistent frontend/backend software identity.")

    if verification_report is not None:
        declared = software.get("verificationReportSha256")
        if not isinstance(declared, str) or not declared:
            issues.append("No build-verification report digest is declared.")
        elif _sha256(verification_report.read_bytes()) != declared.lower():
            issues.append("Build-verification report SHA-256 does not match the manifest.")

    return VerificationResult(
        valid=not issues,
        integrity="verified" if expected == actual and artifact.get("sizeBytes") == len(data) else "failed",
        traceability=traceability,
        authenticity="not-established-checksum-only",
        artifact=str(artifact.get("filename", "")),
        expected_sha256=expected,
        actual_sha256=actual,
        issues=issues,
        warnings=warnings,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifact", type=Path, help="Perdura .perdura.zip package, or an artifact file")
    parser.add_argument("manifest", nargs="?", type=Path, help="Sidecar JSON when verifying an unpacked artifact")
    parser.add_argument("--verification-report", type=Path,
                        help="Optional downloaded build-verification report to cross-check")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON")
    args = parser.parse_args(argv)
    try:
        if args.manifest is None:
            data, manifest = _read_package(args.artifact)
        else:
            data, manifest = _read_pair(args.artifact, args.manifest)
        result = verify(data, manifest, args.verification_report)
    except (OSError, ValueError, KeyError, json.JSONDecodeError, zipfile.BadZipFile) as error:
        if args.json:
            print(json.dumps({"valid": False, "error": str(error)}, indent=2))
        else:
            print(f"INVALID PACKAGE: {error}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(asdict(result), indent=2))
    else:
        mark = "PASS" if result.valid else "FAIL"
        print(f"{mark}: {result.artifact}")
        print(f"  Integrity:    {result.integrity}")
        print(f"  Traceability: {result.traceability}")
        print(f"  Authenticity: not established (checksum only)")
        print(f"  SHA-256:      {result.actual_sha256}")
        for issue in result.issues:
            print(f"  ERROR: {issue}")
        for warning in result.warnings:
            print(f"  WARNING: {warning}")
    return 0 if result.valid else 1


if __name__ == "__main__":
    raise SystemExit(main())
