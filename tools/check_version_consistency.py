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

    print(f"Perdura version declarations agree: {expected}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
