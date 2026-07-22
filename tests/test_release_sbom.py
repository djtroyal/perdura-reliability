import json
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]


def test_release_sbom_binds_subject_and_both_dependency_ecosystems(tmp_path):
    subject = tmp_path / "Perdura-1.2.3-linux-x64.tar.gz"
    subject.write_bytes(b"release archive")
    environment = tmp_path / "environment.json"
    environment.write_text(json.dumps({"packages": {"NumPy": "2.3.1", "perdura": "1.2.3"}}))
    lock = tmp_path / "package-lock.json"
    lock.write_text(json.dumps({
        "packages": {
            "": {"name": "perdura-gui", "version": "1.2.3"},
            "node_modules/react": {"version": "18.3.1", "license": "MIT"},
            "node_modules/typescript": {"version": "7.0.2", "license": "Apache-2.0", "dev": True},
        }
    }))
    cdx = tmp_path / "sbom.cdx.json"
    spdx = tmp_path / "sbom.spdx.json"

    subprocess.run([
        sys.executable, str(ROOT / "tools" / "build_release_sbom.py"),
        "--environment", str(environment), "--package-lock", str(lock),
        "--subject", str(subject), "--version", "1.2.3", "--commit", "abc123",
        "--created", "2026-07-22T12:00:00Z",
        "--cyclonedx-output", str(cdx), "--spdx-output", str(spdx),
    ], check=True)

    cyclonedx = json.loads(cdx.read_text())
    assert cyclonedx["bomFormat"] == "CycloneDX"
    assert cyclonedx["specVersion"] == "1.6"
    assert {item["purl"] for item in cyclonedx["components"]} == {
        "pkg:pypi/numpy@2.3.1", "pkg:pypi/perdura@1.2.3", "pkg:npm/react@18.3.1",
        "pkg:npm/typescript@7.0.2",
    }
    assert cyclonedx["metadata"]["component"]["hashes"][0]["content"]
    typescript = next(item for item in cyclonedx["components"] if item["name"] == "typescript")
    assert typescript["scope"] == "excluded"
    assert "pkg:npm/typescript@7.0.2" not in cyclonedx["dependencies"][0]["dependsOn"]

    spdx_data = json.loads(spdx.read_text())
    assert spdx_data["spdxVersion"] == "SPDX-2.3"
    assert spdx_data["documentDescribes"] == ["SPDXRef-Perdura"]
    assert any(item["fileName"] == subject.name for item in spdx_data["files"])
    assert len([item for item in spdx_data["relationships"] if item["relationshipType"] == "DEPENDS_ON"]) == 3
    assert len([item for item in spdx_data["relationships"] if item["relationshipType"] == "BUILD_DEPENDENCY_OF"]) == 1


def test_release_sbom_is_deterministic(tmp_path):
    subject = tmp_path / "archive.zip"
    subject.write_bytes(b"same")
    environment = tmp_path / "environment.json"
    environment.write_text('{"packages":{"scipy":"1.16.0"}}')
    lock = tmp_path / "package-lock.json"
    lock.write_text('{"packages":{}}')
    outputs = []
    for index in range(2):
        cdx = tmp_path / f"{index}.cdx.json"
        spdx = tmp_path / f"{index}.spdx.json"
        subprocess.run([
            sys.executable, str(ROOT / "tools" / "build_release_sbom.py"),
            "--environment", str(environment), "--package-lock", str(lock),
            "--subject", str(subject), "--version", "1.0.0", "--commit", "deadbeef",
            "--created", "2026-07-22T12:00:00Z",
            "--cyclonedx-output", str(cdx), "--spdx-output", str(spdx),
        ], check=True)
        outputs.append((cdx.read_bytes(), spdx.read_bytes()))
    assert outputs[0] == outputs[1]
