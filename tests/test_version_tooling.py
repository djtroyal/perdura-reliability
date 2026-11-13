"""Release version declarations move as one validated unit."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest


SCRIPT = Path(__file__).resolve().parents[1] / "tools" / "bump_version.py"
ROOT = SCRIPT.parents[1]
SPEC = importlib.util.spec_from_file_location("bump_version", SCRIPT)
assert SPEC and SPEC.loader
bump_version = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bump_version)

VERSION_SPEC = importlib.util.spec_from_file_location(
    "check_version_consistency", ROOT / "tools/check_version_consistency.py",
)
assert VERSION_SPEC and VERSION_SPEC.loader
version_check = importlib.util.module_from_spec(VERSION_SPEC)
VERSION_SPEC.loader.exec_module(version_check)


def _fixture(root: Path, version: str = "0.6.0") -> None:
    (root / "src/reliability").mkdir(parents=True)
    (root / "src/perdura_app").mkdir(parents=True)
    (root / "gui/frontend").mkdir(parents=True)
    (root / "pyproject.toml").write_text(
        f'[project]\nname = "perdura"\nversion = "{version}"\n', encoding="utf-8",
    )
    (root / "src/reliability/_version.py").write_text(
        f'__version__ = "{version}"\n', encoding="utf-8",
    )
    (root / "src/perdura_app/_version.py").write_text(
        f'__version__ = "{version}"\n', encoding="utf-8",
    )
    (root / "gui/frontend/package.json").write_text(
        json.dumps({"name": "perdura-gui", "version": version}), encoding="utf-8",
    )
    (root / "gui/frontend/package-lock.json").write_text(json.dumps({
        "name": "perdura-gui", "version": version,
        "packages": {"": {"name": "perdura-gui", "version": version}},
    }), encoding="utf-8")
    (root / "uv.lock").write_text(
        f'[[package]]\nname = "perdura"\nversion = "{version}"\n', encoding="utf-8",
    )


def test_prepare_version_bump_updates_every_declaration(tmp_path: Path):
    _fixture(tmp_path)
    updates = bump_version.prepare_version_bump(tmp_path, "0.7.0")
    assert len(updates) == 6
    assert all("0.7.0" in content for content in updates.values())
    assert all("0.6.0" not in content for content in updates.values())


@pytest.mark.parametrize("target", ["0.6.0", "0.5.9", "v0.7.0", "0.7.0-rc.1"])
def test_prepare_version_bump_rejects_nonforward_or_unstable_targets(
    tmp_path: Path, target: str,
):
    _fixture(tmp_path)
    with pytest.raises(ValueError):
        bump_version.prepare_version_bump(tmp_path, target)


def test_uv_lock_has_canonical_cross_platform_line_endings():
    attributes = (ROOT / ".gitattributes").read_text(encoding="utf-8").splitlines()
    assert "uv.lock text eol=lf" in attributes
    assert b"\r\n" not in (ROOT / "uv.lock").read_bytes()


@pytest.mark.parametrize("filename", ["package.json", "package-lock.json"])
@pytest.mark.parametrize("second_range", ["^19.3.0", "^19.3.1"])
def test_version_check_rejects_shadowed_dependency_declarations(tmp_path, filename, second_range):
    path = tmp_path / filename
    path.write_text(
        '{"dependencies":{"react":"^19.3.0","react":"' + second_range + '"}}',
        encoding="utf-8",
    )
    with pytest.raises(RuntimeError, match=r"duplicate JSON key 'react'"):
        version_check._load_unique_json(path)


def test_version_check_allows_same_key_in_distinct_objects(tmp_path):
    path = tmp_path / "package-lock.json"
    expected = {"version": "0.8.3", "packages": {"": {"version": "0.8.3"}}}
    path.write_text(json.dumps(expected), encoding="utf-8")
    assert version_check._load_unique_json(path) == expected
