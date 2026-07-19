#!/usr/bin/env python3
"""Smoke-test and describe a Perdura environment created from ``uv.lock``.

The release workflows run this on each supported operating system.  Besides
checking imports, it exercises a small scikit-learn -> ONNX Runtime round trip
so native-extension or model-interchange problems fail before packaging.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib
from importlib import metadata
import json
from pathlib import Path
import platform
import site
import sys


ROOT = Path(__file__).resolve().parents[1]
PACKAGES = {
    "fastapi": "fastapi",
    "matplotlib": "matplotlib",
    "numpy": "numpy",
    "onnx": "onnx",
    "onnxruntime": "onnxruntime",
    "pandas": "pandas",
    "pydantic": "pydantic",
    "perdura": "reliability",
    "scikit-learn": "sklearn",
    "scipy": "scipy",
    "skl2onnx": "skl2onnx",
    "uvicorn": "uvicorn",
}


def _target_name() -> str:
    machine = platform.machine().lower()
    if sys.platform.startswith("linux") and machine in {"amd64", "x86_64"}:
        return "linux-x64"
    if sys.platform == "win32" and machine in {"amd64", "x86_64"}:
        return "windows-x64"
    if sys.platform == "darwin" and machine in {"aarch64", "arm64"}:
        return "macos-arm64"
    return f"{sys.platform}-{machine or 'unknown'}"


def _onnx_round_trip() -> float:
    import numpy as np
    import onnxruntime as ort
    from sklearn.linear_model import LinearRegression
    from skl2onnx import convert_sklearn
    from skl2onnx.common.data_types import FloatTensorType

    x = np.asarray([[0.0], [1.0], [2.0], [3.0]], dtype=np.float32)
    y = np.asarray([1.0, 3.0, 5.0, 7.0], dtype=np.float32)
    estimator = LinearRegression().fit(x, y)
    model = convert_sklearn(
        estimator,
        initial_types=[("input", FloatTensorType([None, 1]))],
    )
    session = ort.InferenceSession(
        model.SerializeToString(), providers=["CPUExecutionProvider"]
    )
    actual = session.run(None, {session.get_inputs()[0].name: x})[0].reshape(-1)
    expected = estimator.predict(x).reshape(-1)
    np.testing.assert_allclose(actual, expected, rtol=1e-5, atol=1e-6)
    return float(np.max(np.abs(actual - expected)))


def _backend_route_count() -> int:
    sys.path.insert(0, str(ROOT / "gui" / "backend"))
    try:
        from main import app
    finally:
        sys.path.pop(0)
    return len(app.routes)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--expected-target",
        choices=("linux-x64", "windows-x64", "macos-arm64"),
    )
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    target = _target_name()
    if args.expected_target and target != args.expected_target:
        raise RuntimeError(
            f"Expected release target {args.expected_target!r}, detected {target!r}"
        )
    if args.expected_target and sys.version_info[:2] != (3, 11):
        raise RuntimeError(
            f"Release environments require Python 3.11, got {platform.python_version()}"
        )

    packages = dict(PACKAGES)
    if args.expected_target:
        packages["PyInstaller"] = "PyInstaller"

    critical_versions: dict[str, str] = {}
    for distribution, module in packages.items():
        importlib.import_module(module)
        critical_versions[distribution] = metadata.version(distribution)

    installed_versions: dict[str, str] = {}
    environment_paths = [str(Path(path).resolve()) for path in site.getsitepackages()]
    for distribution in metadata.distributions(path=environment_paths):
        name = distribution.metadata.get("Name")
        if name:
            installed_versions[name] = distribution.version

    lock_path = ROOT / "uv.lock"
    report = {
        "schema_version": 1,
        "target": target,
        "python": platform.python_version(),
        "python_implementation": platform.python_implementation(),
        "platform": platform.platform(),
        "machine": platform.machine(),
        "uv_lock_sha256": hashlib.sha256(lock_path.read_bytes()).hexdigest(),
        # Complete environment inventory, including transitive dependencies.
        "packages": dict(
            sorted(installed_versions.items(), key=lambda item: item[0].lower())
        ),
        "checks": {
            "backend_route_count": _backend_route_count(),
            "critical_import_versions": dict(
                sorted(critical_versions.items(), key=lambda item: item[0].lower())
            ),
            "onnx_max_absolute_error": _onnx_round_trip(),
        },
    }
    rendered = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
