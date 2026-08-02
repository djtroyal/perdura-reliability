#!/usr/bin/env python3
"""Build the self-contained, lock-derived Perdura application wheel.

The source project keeps broad API lower bounds for library consumers.  The
published application wheel instead receives an exact ``app`` extra generated
from ``uv.lock`` so an installed release cannot silently select a different
scientific/runtime stack.  The generated Vite output is staged inside the
wheel; an sdist is deliberately not produced.
"""

from __future__ import annotations

import argparse
import email
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import tomllib
import zipfile


ROOT = Path(__file__).resolve().parents[1]


def _run(command: list[str], *, cwd: Path = ROOT) -> str:
    environment = dict(os.environ)
    environment.setdefault("UV_CACHE_DIR", str(Path(tempfile.gettempdir()) / "perdura-uv-cache"))
    try:
        result = subprocess.run(
            command, cwd=cwd, env=environment, check=True, text=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or "no command output").strip()
        raise RuntimeError(f"{' '.join(command)} failed:\n{detail}") from exc
    return result.stdout


def locked_app_requirements() -> list[str]:
    output = _run([
        "uv", "export", "--format", "requirements-txt", "--extra", "app",
        "--no-dev", "--no-group", "release", "--no-emit-project",
        "--no-hashes", "--no-annotate", "--no-header",
    ])
    requirements = [line.strip() for line in output.splitlines() if line.strip()]
    if not requirements or any(" @ file:" in requirement for requirement in requirements):
        raise RuntimeError("uv.lock did not produce a portable application requirement set")
    if any("==" not in requirement for requirement in requirements):
        raise RuntimeError("published application requirements must be exact pins")
    return requirements


def _toml_string(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _staged_pyproject(version: str, requirements: list[str]) -> str:
    locked = "\n".join(f"    {_toml_string(requirement)}," for requirement in requirements)
    return f'''[build-system]
requires = ["setuptools==83.0.0"]
build-backend = "setuptools.build_meta"

[project]
name = "perdura"
version = {_toml_string(version)}
description = "Perdura Reliability Engineering and Statistics Suite"
readme = "README.md"
license = "LicenseRef-PolyForm-Noncommercial-1.0.0"
license-files = ["LICENSE"]
requires-python = ">=3.11,<3.15"
dependencies = [
    "numpy>=2.0",
    "scipy>=1.13",
    "matplotlib>=3.9",
    "pandas>=2.2.2",
]

[project.optional-dependencies]
app = [
{locked}
]

[project.scripts]
perdura = "perdura_app.cli:main"

[project.urls]
Homepage = "https://perdurareliability.com"
Repository = "https://github.com/djtroyal/perdura-reliability"
Documentation = "https://perdurareliability.com"

[tool.setuptools]
packages = ["reliability", "perdura_app", "perdura_app.backend", "perdura_app.backend.routers"]
include-package-data = true

[tool.setuptools.package-dir]
reliability = "src/reliability"
perdura_app = "src/perdura_app"
"perdura_app.backend" = "gui/backend"
"perdura_app.backend.routers" = "gui/backend/routers"

[tool.setuptools.package-data]
perdura_app = ["static/*", "static/assets/*", "static/website-showcase/*"]
'''


def _copy_sources(stage: Path, frontend_dist: Path) -> None:
    for filename in ("README.md", "LICENSE"):
        shutil.copy2(ROOT / filename, stage / filename)
    shutil.copytree(ROOT / "src" / "reliability", stage / "src" / "reliability")
    shutil.copytree(
        ROOT / "src" / "perdura_app", stage / "src" / "perdura_app",
        ignore=shutil.ignore_patterns("__pycache__", "static"),
    )
    shutil.copytree(frontend_dist, stage / "src" / "perdura_app" / "static")
    (stage / "gui" / "backend" / "routers").mkdir(parents=True)
    for source in (ROOT / "gui" / "backend").glob("*.py"):
        shutil.copy2(source, stage / "gui" / "backend" / source.name)
    for source in (ROOT / "gui" / "backend" / "routers").glob("*.py"):
        shutil.copy2(source, stage / "gui" / "backend" / "routers" / source.name)


def _verify_wheel(wheel: Path, version: str, requirements: list[str]) -> None:
    with zipfile.ZipFile(wheel) as archive:
        names = set(archive.namelist())
        required_files = {
            "perdura_app/cli.py",
            "perdura_app/backend/main.py",
            "perdura_app/static/index.html",
            f"perdura-{version}.dist-info/METADATA",
            f"perdura-{version}.dist-info/entry_points.txt",
        }
        missing = required_files - names
        if missing:
            raise RuntimeError(f"application wheel is incomplete: {sorted(missing)}")
        metadata_text = archive.read(f"perdura-{version}.dist-info/METADATA").decode("utf-8")
        metadata_message = email.message_from_string(metadata_text)
        wheel_requirements = set(metadata_message.get_all("Requires-Dist", []))
        for requirement in requirements:
            # Setuptools may normalize parentheses/whitespace in markers.  The
            # package/version prefix is the fail-closed invariant here; marker
            # parity is checked by the generated constraints asset below.
            package_pin = requirement.split(" ;", 1)[0]
            if not any(item.startswith(package_pin) and 'extra == "app"' in item for item in wheel_requirements):
                raise RuntimeError(f"locked requirement missing from wheel metadata: {package_pin}")


def build(output_dir: Path, constraints_output: Path | None, frontend_dist: Path) -> Path:
    if not (frontend_dist / "index.html").is_file():
        raise RuntimeError(
            f"frontend build is missing at {frontend_dist}; run npm run build first"
        )
    project = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    version = str(project["project"]["version"])
    requirements = locked_app_requirements()
    output_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="perdura-wheel-") as temporary:
        stage = Path(temporary)
        _copy_sources(stage, frontend_dist)
        (stage / "pyproject.toml").write_text(
            _staged_pyproject(version, requirements), encoding="utf-8"
        )
        _run(["uv", "build", "--wheel", "--out-dir", str(output_dir), str(stage)])

    wheels = sorted(output_dir.glob(f"perdura-{version}-*.whl"))
    if len(wheels) != 1:
        raise RuntimeError(f"expected one Perdura {version} wheel, found {len(wheels)}")
    wheel = wheels[0]
    _verify_wheel(wheel, version, requirements)
    if constraints_output:
        constraints_output.parent.mkdir(parents=True, exist_ok=True)
        constraints_output.write_text("\n".join(requirements) + "\n", encoding="utf-8")
    print(wheel)
    return wheel


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, default=ROOT / "dist-pypi")
    parser.add_argument("--constraints-output", type=Path)
    parser.add_argument("--frontend-dist", type=Path, default=ROOT / "gui" / "frontend" / "dist")
    args = parser.parse_args()
    build(args.output_dir.resolve(), args.constraints_output, args.frontend_dist.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
