import hashlib
import json
from pathlib import Path

import pytest

from tools.verify_website_resources import verify_bundle


COMMIT = "a" * 40


def bundle(root: Path) -> Path:
    (root / "screenshots").mkdir()
    image = b"\x89PNG\r\n\x1a\nfixture"
    (root / "screenshots/example.png").write_bytes(image)
    manifest = {"schema": "perdura.website-resources/v1", "captures": [{
        "id": "example", "file": "example.png", "sizeBytes": len(image),
        "sha256": hashlib.sha256(image).hexdigest(),
    }]}
    (root / "screenshots.generated.json").write_text(json.dumps(manifest))
    (root / "build-provenance.json").write_text(json.dumps({
        "schema": "perdura.website-resource-build/v1", "sourceCommit": COMMIT, "captures": 1,
    }))
    (root / "diff-report.json").write_text('{"differences": []}')
    checksum(root)
    return root


def checksum(root: Path) -> None:
    (root / "SHA256SUMS").write_text("".join(
        f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.relative_to(root).as_posix()}\n"
        for path in sorted(root.rglob("*")) if path.is_file() and path.name != "SHA256SUMS"
    ))


def test_matching_bundle_is_accepted(tmp_path):
    assert verify_bundle(bundle(tmp_path), COMMIT) == 1


def test_bundle_from_another_run_is_rejected(tmp_path):
    with pytest.raises(ValueError, match="source commit"):
        verify_bundle(bundle(tmp_path), "b" * 40)


def test_changed_png_is_rejected_even_with_rewritten_bundle_checksums(tmp_path):
    bundle(tmp_path)
    (tmp_path / "screenshots/example.png").write_bytes(b"\x89PNG\r\n\x1a\nolder-image")
    checksum(tmp_path)
    with pytest.raises(ValueError, match="Checksum mismatch"):
        verify_bundle(tmp_path, COMMIT)


def test_missing_and_unlisted_images_are_rejected(tmp_path):
    bundle(tmp_path)
    image = tmp_path / "screenshots/example.png"
    image.rename(tmp_path / "screenshots/old.png")
    with pytest.raises(FileNotFoundError):
        verify_bundle(tmp_path, COMMIT)
    (tmp_path / "screenshots/old.png").rename(image)
    (tmp_path / "screenshots/extra.png").write_bytes(image.read_bytes())
    with pytest.raises(ValueError, match="inventory"):
        verify_bundle(tmp_path, COMMIT)


def test_modified_metadata_and_path_traversal_are_rejected(tmp_path):
    bundle(tmp_path)
    manifest_path = tmp_path / "screenshots.generated.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["captures"][0]["file"] = "../example.png"
    manifest_path.write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="Checksum mismatch"):
        verify_bundle(tmp_path, COMMIT)
    checksum(tmp_path)
    with pytest.raises(ValueError, match="filename"):
        verify_bundle(tmp_path, COMMIT)
