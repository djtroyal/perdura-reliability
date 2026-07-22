#!/usr/bin/env python3
"""Ensure Perdura's Python and frontend version declarations agree."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import tomllib


ROOT = Path(__file__).resolve().parents[1]


def _python_runtime_version() -> str:
    source = (ROOT / "src" / "reliability" / "_version.py").read_text(
        encoding="utf-8"
    )
    match = re.fullmatch(r'__version__\s*=\s*"([^"]+)"\s*', source)
    if not match:
        raise RuntimeError("src/reliability/_version.py has an unsupported format")
    return match.group(1)


def _uv_lock_version() -> str:
    with (ROOT / "uv.lock").open("rb") as stream:
        packages = tomllib.load(stream).get("package", [])
    matches = [package.get("version") for package in packages
               if package.get("name") == "perdura"]
    if len(matches) != 1 or not isinstance(matches[0], str):
        raise RuntimeError("uv.lock must contain exactly one Perdura package")
    return matches[0]


def _project_schema_versions() -> dict[str, int]:
    sources = {
        "src/reliability/_build.py": ROOT / "src" / "reliability" / "_build.py",
        "gui/frontend/src/version.ts": ROOT / "gui" / "frontend" / "src" / "version.ts",
    }
    versions: dict[str, int] = {}
    for label, path in sources.items():
        source = path.read_text(encoding="utf-8")
        match = re.search(
            r"^(?:export const )?PROJECT_SCHEMA_VERSION\s*=\s*(\d+)\s*$",
            source,
            re.MULTILINE,
        )
        if not match:
            raise RuntimeError(f"{label} has no parseable PROJECT_SCHEMA_VERSION")
        versions[label] = int(match.group(1))
    return versions


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--expected", help="Expected release/tag version without a leading v"
    )
    args = parser.parse_args()

    with (ROOT / "pyproject.toml").open("rb") as stream:
        project = tomllib.load(stream)["project"]
    frontend = json.loads(
        (ROOT / "gui" / "frontend" / "package.json").read_text(encoding="utf-8")
    )
    frontend_lock = json.loads(
        (ROOT / "gui" / "frontend" / "package-lock.json").read_text(encoding="utf-8")
    )

    declarations = {
        "pyproject.toml": project["version"],
        "src/reliability/_version.py": _python_runtime_version(),
        "gui/frontend/package.json": frontend["version"],
        "gui/frontend/package-lock.json": frontend_lock["version"],
        "package-lock root package": frontend_lock["packages"][""]["version"],
        "uv.lock": _uv_lock_version(),
    }
    expected = args.expected or next(iter(declarations.values()))
    mismatches = {
        name: value for name, value in declarations.items() if value != expected
    }
    if mismatches:
        detail = ", ".join(f"{name}={value}" for name, value in mismatches.items())
        raise RuntimeError(
            f"Expected Perdura {expected}; inconsistent declarations: {detail}"
        )

    if project["name"] != "perdura":
        raise RuntimeError(
            f"Python distribution must be named 'perdura', got {project['name']!r}"
        )
    if frontend["name"] != "perdura-gui":
        raise RuntimeError(
            f"Frontend package must be named 'perdura-gui', got {frontend['name']!r}"
        )
    if frontend_lock["name"] != frontend["name"]:
        raise RuntimeError("Frontend package-lock name does not match package.json")
    if frontend_lock["packages"][""]["name"] != frontend["name"]:
        raise RuntimeError(
            "Frontend package-lock root package name does not match package.json"
        )

    schemas = _project_schema_versions()
    if len(set(schemas.values())) != 1:
        detail = ", ".join(f"{name}={value}" for name, value in schemas.items())
        raise RuntimeError(f"Project schema declarations disagree: {detail}")

    print(
        f"Perdura version declarations agree: {expected}; project schema: "
        f"{next(iter(schemas.values()))}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
