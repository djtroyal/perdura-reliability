#!/usr/bin/env python3
"""Create release-specific CycloneDX and SPDX SBOMs for a Perdura archive."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import quote
import uuid
from typing import Any


TOOL_NAME = "Perdura release SBOM builder"
TOOL_VERSION = "1"
PYTHON_BUILD_TOOLS = {
    "altgraph", "packaging", "pefile", "pyinstaller", "pyinstaller-hooks-contrib",
    "pywin32-ctypes", "setuptools",
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def normalize_python_name(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def purl_name(name: str) -> str:
    return quote(name, safe="")


def npm_packages(lock: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    result: dict[tuple[str, str], dict[str, Any]] = {}
    for location, entry in lock.get("packages", {}).items():
        if not location or "node_modules/" not in location or not isinstance(entry, dict):
            continue
        name = location.rsplit("node_modules/", 1)[-1]
        version = str(entry.get("version") or "")
        if name and version:
            result[(name, version)] = entry
    return result


def inventory(environment: dict[str, Any], lock: dict[str, Any]) -> list[dict[str, Any]]:
    components: list[dict[str, Any]] = []
    for raw_name, raw_version in sorted(environment.get("packages", {}).items(), key=lambda pair: pair[0].lower()):
        name = normalize_python_name(str(raw_name))
        version = str(raw_version)
        components.append({
            "ecosystem": "PyPI", "name": name, "version": version,
            "purl": f"pkg:pypi/{purl_name(name)}@{purl_name(version)}",
            "relationship": "build" if name in PYTHON_BUILD_TOOLS else "runtime",
        })
    for (name, version), entry in sorted(npm_packages(lock).items()):
        item = {
            "ecosystem": "npm", "name": name, "version": version,
            "purl": f"pkg:npm/{purl_name(name)}@{purl_name(version)}",
            "relationship": "build" if entry.get("dev") else "runtime",
        }
        if entry.get("license"):
            item["license"] = str(entry["license"])
        components.append(item)
    return components


def cyclonedx(
    *, components: list[dict[str, Any]], subject: Path, subject_hash: str,
    version: str, commit: str, created: str, environment_hash: str, lock_hash: str,
) -> dict[str, Any]:
    root_ref = f"pkg:generic/perdura@{purl_name(version)}?download={purl_name(subject.name)}"
    serial_seed = f"{subject_hash}:{environment_hash}:{lock_hash}"
    entries = []
    for item in components:
        entry: dict[str, Any] = {
            "type": "library",
            "bom-ref": item["purl"],
            "name": item["name"],
            "version": item["version"],
            "purl": item["purl"],
            "scope": "excluded" if item["relationship"] == "build" else "required",
            "properties": [
                {"name": "perdura:ecosystem", "value": item["ecosystem"]},
                {"name": "perdura:relationship", "value": item["relationship"]},
            ],
        }
        if item.get("license"):
            entry["licenses"] = [{"license": {"name": item["license"]}}]
        entries.append(entry)
    return {
        "bomFormat": "CycloneDX",
        "specVersion": "1.6",
        "serialNumber": f"urn:uuid:{uuid.uuid5(uuid.NAMESPACE_URL, serial_seed)}",
        "version": 1,
        "metadata": {
            "timestamp": created,
            "tools": {"components": [{"type": "application", "name": TOOL_NAME, "version": TOOL_VERSION}]},
            "component": {
                "type": "application",
                "bom-ref": root_ref,
                "name": "Perdura",
                "version": version,
                "hashes": [{"alg": "SHA-256", "content": subject_hash}],
                "properties": [
                    {"name": "perdura:release-archive", "value": subject.name},
                    {"name": "perdura:source-commit", "value": commit},
                    {"name": "perdura:environment-manifest-sha256", "value": environment_hash},
                    {"name": "perdura:frontend-lock-sha256", "value": lock_hash},
                ],
            },
        },
        "components": entries,
        "dependencies": [{
            "ref": root_ref,
            "dependsOn": [item["purl"] for item in components if item["relationship"] == "runtime"],
        }],
    }


def spdx_id(prefix: str, value: str) -> str:
    clean = re.sub(r"[^A-Za-z0-9.-]+", "-", value).strip("-") or "item"
    suffix = hashlib.sha256(value.encode()).hexdigest()[:12]
    return f"SPDXRef-{prefix}-{clean[:80]}-{suffix}"


def spdx(
    *, components: list[dict[str, Any]], subject: Path, subject_hash: str,
    version: str, commit: str, created: str, environment_hash: str, lock_hash: str,
) -> dict[str, Any]:
    document_seed = f"{subject_hash}:{environment_hash}:{lock_hash}"
    document_ns = f"https://perdurareliability.com/sbom/{uuid.uuid5(uuid.NAMESPACE_URL, document_seed)}"
    root_id = "SPDXRef-Perdura"
    file_id = "SPDXRef-ReleaseArchive"
    packages = [{
        "SPDXID": root_id,
        "name": "Perdura",
        "versionInfo": version,
        "downloadLocation": "NOASSERTION",
        "filesAnalyzed": False,
        "checksums": [{"algorithm": "SHA256", "checksumValue": subject_hash}],
        "licenseConcluded": "NOASSERTION",
        "licenseDeclared": "LicenseRef-PolyForm-Noncommercial-1.0.0",
        "copyrightText": "Copyright (c) 2026 Derek Taylor",
        "externalRefs": [{
            "referenceCategory": "PACKAGE-MANAGER",
            "referenceType": "purl",
            "referenceLocator": f"pkg:generic/perdura@{purl_name(version)}",
        }],
        "annotations": [{
            "annotationDate": created,
            "annotationType": "OTHER",
            "annotator": f"Tool: {TOOL_NAME}-{TOOL_VERSION}",
            "comment": (
                f"Release archive {subject.name}; source commit {commit}; "
                f"environment manifest SHA-256 {environment_hash}; frontend lock SHA-256 {lock_hash}."
            ),
        }],
    }]
    relationships = [{
        "spdxElementId": root_id,
        "relationshipType": "CONTAINS",
        "relatedSpdxElement": file_id,
    }]
    for item in components:
        identifier = spdx_id(item["ecosystem"], item["purl"])
        packages.append({
            "SPDXID": identifier,
            "name": item["name"],
            "versionInfo": item["version"],
            "downloadLocation": "NOASSERTION",
            "filesAnalyzed": False,
            "licenseConcluded": "NOASSERTION",
            "licenseDeclared": item.get("license", "NOASSERTION"),
            "copyrightText": "NOASSERTION",
            "externalRefs": [{
                "referenceCategory": "PACKAGE-MANAGER",
                "referenceType": "purl",
                "referenceLocator": item["purl"],
            }],
            "primaryPackagePurpose": "LIBRARY",
            "summary": f"Resolved {item['ecosystem']} dependency in the Perdura release environment.",
        })
        if item["relationship"] == "build":
            relationships.append({
                "spdxElementId": identifier,
                "relationshipType": "BUILD_DEPENDENCY_OF",
                "relatedSpdxElement": root_id,
            })
        else:
            relationships.append({
                "spdxElementId": root_id,
                "relationshipType": "DEPENDS_ON",
                "relatedSpdxElement": identifier,
            })
    return {
        "spdxVersion": "SPDX-2.3",
        "dataLicense": "CC0-1.0",
        "SPDXID": "SPDXRef-DOCUMENT",
        "name": f"Perdura-{version}-{subject.name}-SBOM",
        "documentNamespace": document_ns,
        "creationInfo": {"created": created, "creators": [f"Tool: {TOOL_NAME}-{TOOL_VERSION}"]},
        "documentDescribes": [root_id],
        "packages": packages,
        "files": [{
            "SPDXID": file_id,
            "fileName": subject.name,
            "checksums": [{"algorithm": "SHA256", "checksumValue": subject_hash}],
            "licenseConcluded": "NOASSERTION",
            "copyrightText": "NOASSERTION",
        }],
        "relationships": relationships,
        "hasExtractedLicensingInfos": [{
            "licenseId": "LicenseRef-PolyForm-Noncommercial-1.0.0",
            "name": "PolyForm Noncommercial License 1.0.0",
            "extractedText": "See the LICENSE file distributed with Perdura.",
            "seeAlsos": ["https://polyformproject.org/licenses/noncommercial/1.0.0/"],
        }],
    }


def parse_created(value: str) -> str:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--environment", type=Path, required=True)
    parser.add_argument("--package-lock", type=Path, required=True)
    parser.add_argument("--subject", type=Path, required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--created", required=True)
    parser.add_argument("--cyclonedx-output", type=Path, required=True)
    parser.add_argument("--spdx-output", type=Path, required=True)
    args = parser.parse_args()

    environment = json.loads(args.environment.read_text(encoding="utf-8"))
    lock = json.loads(args.package_lock.read_text(encoding="utf-8"))
    components = inventory(environment, lock)
    if not components:
        raise ValueError("The release inventory contains no components")
    created = parse_created(args.created)
    common = {
        "components": components,
        "subject": args.subject,
        "subject_hash": sha256(args.subject),
        "version": args.version,
        "commit": args.commit,
        "created": created,
        "environment_hash": sha256(args.environment),
        "lock_hash": sha256(args.package_lock),
    }
    args.cyclonedx_output.write_text(
        json.dumps(cyclonedx(**common), indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    args.spdx_output.write_text(
        json.dumps(spdx(**common), indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(f"Recorded {len(components)} resolved components for {args.subject.name}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
