"""Verify a screenshot bundle before copying it into the companion website."""

import argparse
import hashlib
import json
import re
from pathlib import Path


def verify_bundle(directory: Path, expected_commit: str) -> int:
    directory = directory.resolve()
    manifest = json.loads((directory / "screenshots.generated.json").read_text())
    provenance = json.loads((directory / "build-provenance.json").read_text())
    if not isinstance(manifest, dict) or manifest.get("schema") != "perdura.website-resources/v1":
        raise ValueError("Unsupported screenshot manifest schema")
    if not isinstance(provenance, dict) or provenance.get("schema") != "perdura.website-resource-build/v1":
        raise ValueError("Unsupported screenshot provenance schema")
    if not re.fullmatch(r"[0-9a-f]{40}", expected_commit):
        raise ValueError("Expected source commit must be a full Git SHA")
    if provenance.get("sourceCommit") != expected_commit:
        raise ValueError("Screenshot source commit does not match the successful CI run")
    records = manifest.get("captures", [])
    if not isinstance(records, list) or not records or provenance.get("captures") != len(records):
        raise ValueError("Screenshot inventory and provenance counts do not match")

    checksums = {}
    for line in (directory / "SHA256SUMS").read_text().splitlines():
        digest, separator, name = line.partition("  ")
        if not separator or not re.fullmatch(r"[0-9a-f]{64}", digest) or name in checksums:
            raise ValueError("Invalid or duplicate bundle checksum entry")
        checksums[name] = digest

    def verify_file(name: str, declared_hash: str | None = None) -> bytes:
        path = directory / name
        if path.is_symlink() or not path.resolve().is_relative_to(directory):
            raise ValueError(f"Screenshot path escapes bundle: {name}")
        data = path.read_bytes()
        actual = hashlib.sha256(data).hexdigest()
        if checksums.get(name) != actual or (declared_hash is not None and declared_hash != actual):
            raise ValueError(f"Checksum mismatch: {name}")
        return data

    for name in ("screenshots.generated.json", "build-provenance.json", "diff-report.json"):
        verify_file(name)
    names, ids = set(), set()
    for record in records:
        if not isinstance(record, dict):
            raise ValueError("Invalid screenshot record")
        name, capture_id = record.get("file", ""), record.get("id", "")
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*\.png", name):
            raise ValueError(f"Invalid screenshot filename: {name}")
        if not isinstance(capture_id, str) or not capture_id or name in names or capture_id in ids:
            raise ValueError("Duplicate or missing screenshot identity")
        names.add(name)
        ids.add(capture_id)
        digest = record.get("sha256", "")
        if not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ValueError(f"Missing screenshot hash: {name}")
        data = verify_file(f"screenshots/{name}", digest)
        if not data.startswith(b"\x89PNG\r\n\x1a\n") or len(data) != record.get("sizeBytes"):
            raise ValueError(f"Invalid screenshot bytes or size: {name}")
    actual_names = {path.name for path in (directory / "screenshots").glob("*.png")}
    if actual_names != names:
        raise ValueError("Screenshot files do not match the manifest inventory")
    return len(records)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--source-commit", required=True)
    args = parser.parse_args()
    try:
        count = verify_bundle(args.directory, args.source_commit)
    except (OSError, ValueError, TypeError, KeyError) as error:
        parser.exit(1, f"Website resource verification failed: {error}\n")
    print(f"Verified {count} screenshots from {args.source_commit}")
