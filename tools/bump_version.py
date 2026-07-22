#!/usr/bin/env python3
"""Atomically prepare every Perdura version declaration for a release."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import tomllib


ROOT = Path(__file__).resolve().parents[1]
STABLE_VERSION = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")


def _replace_once(source: str, old: str, new: str, label: str) -> str:
    if source.count(old) != 1:
        raise RuntimeError(f"Expected exactly one {label} declaration")
    return source.replace(old, new, 1)


def _current_versions(root: Path) -> dict[str, str]:
    with (root / "pyproject.toml").open("rb") as stream:
        python_version = str(tomllib.load(stream)["project"]["version"])
    runtime = (root / "src/reliability/_version.py").read_text(encoding="utf-8")
    match = re.fullmatch(r'__version__\s*=\s*"([^"]+)"\s*', runtime)
    if not match:
        raise RuntimeError("src/reliability/_version.py has an unsupported format")
    package = json.loads((root / "gui/frontend/package.json").read_text(encoding="utf-8"))
    package_lock = json.loads((root / "gui/frontend/package-lock.json").read_text(encoding="utf-8"))
    with (root / "uv.lock").open("rb") as stream:
        uv_packages = tomllib.load(stream).get("package", [])
    uv_matches = [str(item["version"]) for item in uv_packages if item.get("name") == "perdura"]
    if len(uv_matches) != 1:
        raise RuntimeError("uv.lock must contain exactly one Perdura package")
    return {
        "pyproject.toml": python_version,
        "src/reliability/_version.py": match.group(1),
        "gui/frontend/package.json": str(package["version"]),
        "gui/frontend/package-lock.json": str(package_lock["version"]),
        "package-lock root package": str(package_lock["packages"][""]["version"]),
        "uv.lock": uv_matches[0],
    }


def prepare_version_bump(root: Path, target: str) -> dict[Path, str]:
    match = STABLE_VERSION.fullmatch(target)
    if not match:
        raise ValueError("Version must use stable X.Y.Z form (for example, 0.7.0)")
    declarations = _current_versions(root)
    current = next(iter(declarations.values()))
    inconsistent = {name: value for name, value in declarations.items() if value != current}
    if inconsistent:
        detail = ", ".join(f"{name}={value}" for name, value in inconsistent.items())
        raise RuntimeError(f"Current version declarations disagree: {detail}")
    if tuple(map(int, target.split("."))) <= tuple(map(int, current.split("."))):
        raise ValueError(f"Target {target} must be greater than current version {current}")

    updates: dict[Path, str] = {}
    pyproject = root / "pyproject.toml"
    updates[pyproject] = _replace_once(
        pyproject.read_text(encoding="utf-8"),
        f'version = "{current}"', f'version = "{target}"', "project version",
    )
    runtime = root / "src/reliability/_version.py"
    updates[runtime] = f'__version__ = "{target}"\n'

    package_path = root / "gui/frontend/package.json"
    package = json.loads(package_path.read_text(encoding="utf-8"))
    package["version"] = target
    updates[package_path] = json.dumps(package, indent=2, ensure_ascii=False) + "\n"

    lock_path = root / "gui/frontend/package-lock.json"
    package_lock = json.loads(lock_path.read_text(encoding="utf-8"))
    package_lock["version"] = target
    package_lock["packages"][""]["version"] = target
    updates[lock_path] = json.dumps(package_lock, indent=2, ensure_ascii=False) + "\n"

    uv_path = root / "uv.lock"
    uv_source = uv_path.read_text(encoding="utf-8")
    package_pattern = re.compile(
        rf'(\[\[package\]\]\nname = "perdura"\nversion = "){re.escape(current)}("\n)'
    )
    uv_updated, count = package_pattern.subn(rf"\g<1>{target}\g<2>", uv_source)
    if count != 1:
        raise RuntimeError("Expected exactly one Perdura version declaration in uv.lock")
    updates[uv_path] = uv_updated
    return updates


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version", help="New stable version in X.Y.Z form")
    parser.add_argument("--dry-run", action="store_true", help="Validate without writing")
    args = parser.parse_args()
    updates = prepare_version_bump(ROOT, args.version)
    if not args.dry_run:
        for path, content in updates.items():
            path.write_text(content, encoding="utf-8")
    action = "Would update" if args.dry_run else "Updated"
    print(f"{action} {len(updates)} files to Perdura {args.version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
