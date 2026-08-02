"""Runtime identity used by the CLI, API, and exported provenance records."""

from __future__ import annotations

import hashlib
from importlib import metadata
import json
import os
from pathlib import Path
import platform
import sys
from typing import Any


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _distribution() -> metadata.Distribution | None:
    try:
        return metadata.distribution("perdura")
    except metadata.PackageNotFoundError:
        return None


def _installation_record_sha256(distribution: metadata.Distribution | None) -> str | None:
    if distribution is None:
        return None
    record = distribution.read_text("RECORD")
    return _sha256(record.encode("utf-8")) if record else None


def _distribution_channel(distribution: metadata.Distribution | None) -> str:
    explicit = os.environ.get("PERDURA_DISTRIBUTION_CHANNEL", "").strip()
    if explicit:
        return explicit
    if getattr(sys, "frozen", False):
        return "pyinstaller"
    if distribution is None:
        return "source"
    direct_url = distribution.read_text("direct_url.json")
    if direct_url:
        try:
            payload = json.loads(direct_url)
            if payload.get("dir_info", {}).get("editable"):
                return "editable-source"
        except (TypeError, json.JSONDecodeError):
            pass
    return "python-wheel"


def _installed_packages() -> list[str]:
    packages: set[str] = set()
    for distribution in metadata.distributions():
        name = distribution.metadata.get("Name")
        if name:
            packages.add(f"{name.lower()}=={distribution.version}")
    return sorted(packages)


def runtime_identity(*, include_packages: bool = False) -> dict[str, Any]:
    """Return stable installation metadata without exposing local paths."""

    distribution = _distribution()
    packages = _installed_packages()
    payload: dict[str, Any] = {
        "distribution_channel": _distribution_channel(distribution),
        "installation_record_sha256": _installation_record_sha256(distribution),
        "runtime_environment_sha256": _sha256("\n".join(packages).encode("utf-8")),
        "python": platform.python_version(),
        "python_implementation": platform.python_implementation(),
        "operating_system": platform.system(),
        "operating_system_release": platform.release(),
        "architecture": platform.machine(),
        "executable_name": Path(sys.executable).name,
    }
    if include_packages:
        payload["packages"] = packages
    return payload
