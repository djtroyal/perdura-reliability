from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import zipfile
from pathlib import Path

from tools.verify_perdura_artifact import MANIFEST_SCHEMA, verify


def manifest_for(data: bytes) -> dict:
    return {
        "schema": MANIFEST_SCHEMA,
        "artifactId": "art-test",
        "artifact": {
            "filename": "result.csv",
            "mediaType": "text/csv",
            "sizeBytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
        },
        "project": {"projectId": "prj-test", "name": "Test", "units": "hours"},
        "software": {"version": "0.7.0", "commit": "a" * 40, "buildStatus": "development"},
        "assurance": {"level": "checksum_only", "authenticityEstablished": False},
    }


def test_verifier_accepts_matching_bytes_without_claiming_authenticity():
    result = verify(b"x,y\n1,2\n", manifest_for(b"x,y\n1,2\n"))
    assert result.valid
    assert result.integrity == "verified"
    assert result.traceability == "linked"
    assert result.authenticity == "not-established-checksum-only"


def test_verifier_detects_tampering():
    result = verify(b"changed", manifest_for(b"original"))
    assert not result.valid
    assert result.integrity == "failed"
    assert any("SHA-256" in issue for issue in result.issues)


def test_cli_verifies_single_download_package(tmp_path: Path):
    data = b"metric,value\nMTBF,1250\n"
    manifest = manifest_for(data)
    package = tmp_path / "result.csv.perdura.zip"
    with zipfile.ZipFile(package, "w") as archive:
        archive.writestr("result.csv", data)
        archive.writestr("result.csv.perdura.json", json.dumps(manifest))
    proc = subprocess.run(
        [sys.executable, "tools/verify_perdura_artifact.py", str(package), "--json"],
        cwd=Path(__file__).resolve().parents[1], text=True, capture_output=True,
    )
    assert proc.returncode == 0, proc.stderr
    assert json.loads(proc.stdout)["valid"] is True
