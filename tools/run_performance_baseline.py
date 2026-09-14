#!/usr/bin/env python3
"""Run deterministic Perdura performance workloads and emit reviewable evidence."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import gc
import hashlib
import importlib
import importlib.metadata
import importlib.util
import json
import math
import os
from pathlib import Path
import platform
import statistics
import subprocess
import sys
import time
import tracemalloc
from typing import Any
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
for source_path in (ROOT, ROOT / "src"):
    value = str(source_path)
    if value not in sys.path:
        sys.path.insert(0, value)

WORKLOADS: dict[str, Any] = {}
SOURCE_ROOT = ROOT


SCHEMA = "perdura.performance-baseline/v1"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def percentile(values: list[float], probability: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def git_value(*args: str) -> str:
    try:
        return subprocess.run(
            ["git", *args], cwd=SOURCE_ROOT, check=True, capture_output=True,
            text=True, timeout=10,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return "unknown"


def cpu_model() -> str:
    cpuinfo = Path("/proc/cpuinfo")
    if cpuinfo.is_file():
        for line in cpuinfo.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.lower().startswith("model name") and ":" in line:
                return line.split(":", 1)[1].strip()
    return platform.processor() or "unknown"


def file_hash(relative: str) -> str | None:
    path = SOURCE_ROOT / relative
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def workload_hash() -> str:
    paths = [ROOT / "tools" / "performance_workloads.py", Path(__file__)]
    digest = hashlib.sha256()
    for path in paths:
        digest.update(path.name.encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def load_workloads(source_root: Path) -> str:
    """Use this harness with a selected source revision and verify the import."""
    global SOURCE_ROOT, WORKLOADS
    SOURCE_ROOT = source_root.resolve()
    expected = SOURCE_ROOT / "src" / "reliability"
    if not (expected / "__init__.py").is_file():
        raise ValueError(f"Scientific source package is missing: {expected}")
    # Import source, never a wheel/editable install selected accidentally by cwd.
    sys.path.insert(0, str(SOURCE_ROOT / "src"))
    package = importlib.import_module("reliability")
    origin = Path(package.__file__).resolve()
    if not origin.is_relative_to(expected.resolve()):
        raise ValueError(f"Scientific import origin {origin} is outside requested {expected}")
    spec = importlib.util.spec_from_file_location("perdura_performance_workloads", ROOT / "tools" / "performance_workloads.py")
    assert spec and spec.loader
    workload_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(workload_module)
    WORKLOADS = workload_module.WORKLOADS
    return str(origin)


def comparison_context(repeats: int, selected: list[str]) -> dict[str, Any]:
    """Only records with the same measurement protocol are comparable."""
    from threadpoolctl import threadpool_info

    def installed_version(name: str) -> str:
        try:
            return importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            return "not-installed"

    return {
        "protocol": "perdura.performance-comparison/v1",
        "workload_sha256": workload_hash(),
        "uv_lock_sha256": file_hash("uv.lock"),
        "workloads": selected,
        "warmups": 1,
        "repeats": repeats,
        "environment": {
            "platform": platform.platform(),
            "machine": platform.machine(),
            "cpu_model": cpu_model(),
            "logical_cpu_count": os.cpu_count(),
            "cpu_affinity": sorted(os.sched_getaffinity(0)) if hasattr(os, "sched_getaffinity") else None,
            "python": platform.python_version(),
            "libraries": {name: installed_version(name) for name in (
                "numpy", "scipy", "pandas", "autograd", "threadpoolctl",
            )},
            "thread_limits": {name: os.environ.get(name) for name in (
                "OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS",
                "VECLIB_MAXIMUM_THREADS", "NUMEXPR_NUM_THREADS",
            )},
            # Installation paths differ between checkouts, but library and
            # threading behavior must match before comparing measurements.
            "native_pools": [{key: pool.get(key) for key in (
                "user_api", "internal_api", "prefix", "version", "num_threads",
                "threading_layer", "architecture",
            )} for pool in threadpool_info()],
        },
    }


def load_baseline(path: Path | None, context: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    if not path:
        return {}, {"status": "unavailable", "reasons": ["No baseline was supplied; this run is smoke evidence only."]}
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schema") != SCHEMA or data.get("status") not in {"passed", "regressed", "inconclusive"}:
        raise ValueError("Baseline is not a supported completed performance record")
    previous = data.get("comparison_context", {})
    differences = [key for key, value in context.items() if previous.get(key) != value]
    cases = {case["id"]: case for case in data.get("cases", [])}
    if set(cases) != set(context["workloads"]) or len(cases) != len(data.get("cases", [])):
        differences.append("case coverage")
    for case in cases.values():
        for key in ("median_seconds", "peak_python_bytes", "coefficient_of_variation"):
            value = case.get(key)
            if not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
                differences.append(f"invalid {case['id']} {key}")
        if case.get("median_seconds", 0) == 0 or case.get("peak_python_bytes", 0) == 0:
            differences.append(f"empty measurement for {case['id']}")
    if differences:
        return {}, {"status": "incompatible", "reasons": differences,
                    "baseline_commit": data.get("provenance", {}).get("commit")}
    return cases, {"status": "available", "reasons": [],
                   "baseline_commit": data.get("provenance", {}).get("commit")}


def run_case(identifier: str, repeats: int, baseline: dict[str, Any] | None) -> dict[str, Any]:
    operation = WORKLOADS[identifier]
    operation()  # one unmeasured warm-up
    observations: list[float] = []
    checksum = 0.0
    for _ in range(repeats):
        gc.collect()
        started = time.perf_counter_ns()
        checksum += float(operation())
        observations.append((time.perf_counter_ns() - started) / 1_000_000_000)

    gc.collect()
    tracemalloc.start()
    memory_checksum = float(operation())
    _, peak_bytes = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    checksum += memory_checksum
    if not math.isfinite(checksum):
        raise RuntimeError(f"{identifier} returned a non-finite benchmark checksum")

    median = statistics.median(observations)
    mean = statistics.mean(observations)
    cv = statistics.stdev(observations) / mean if len(observations) > 1 and mean else 0.0
    previous_median = baseline.get("median_seconds") if baseline else None
    previous_peak = baseline.get("peak_python_bytes") if baseline else None
    time_change = median / previous_median - 1 if previous_median else None
    memory_change = peak_bytes / previous_peak - 1 if previous_peak else None
    time_regression = time_change is not None and time_change > 0.10
    memory_regression = memory_change is not None and memory_change > 0.15
    regression = time_regression or memory_regression
    stable = cv <= 0.05 and (baseline is None or baseline["coefficient_of_variation"] <= 0.05)
    return {
        "id": identifier,
        "status": ("regressed" if memory_regression or (time_regression and stable)
                   else "inconclusive" if baseline and not stable else "passed"),
        "warmups": 1,
        "repeats": repeats,
        "observations_seconds": observations,
        "median_seconds": median,
        "p95_seconds": percentile(observations, 0.95),
        "mean_seconds": mean,
        "coefficient_of_variation": cv,
        "peak_python_bytes": peak_bytes,
        "result_checksum": checksum,
        "baseline": {
            "available": baseline is not None,
            "stable_comparison": bool(baseline and stable),
            "threshold_exceeded": regression,
            "interpretation": "Timing comparisons require both coefficients of variation <= 5%; Python allocation peaks exclude native/process memory.",
            "median_change_fraction": time_change,
            "peak_memory_change_fraction": memory_change,
            "time_regression_threshold_fraction": 0.10,
            "memory_regression_threshold_fraction": 0.15,
        },
    }


def render_junit(path: Path, report: dict[str, Any]) -> None:
    regressed = sum(case["status"] == "regressed" for case in report["cases"])
    inconclusive = sum(case["status"] == "inconclusive" for case in report["cases"])
    suite = ET.Element(
        "testsuite", name="performance-baseline", tests=str(len(report["cases"])),
        failures=str(regressed), errors="0", skipped=str(inconclusive),
        time=str(sum(case["median_seconds"] for case in report["cases"])),
    )
    for case in report["cases"]:
        node = ET.SubElement(
            suite, "testcase", classname="performance", name=case["id"],
            time=f"{case['median_seconds']:.9f}",
        )
        if case["status"] == "regressed":
            failure = ET.SubElement(node, "failure", message="Performance regression threshold exceeded")
            failure.text = json.dumps(case["baseline"], sort_keys=True)
        elif case["status"] == "inconclusive":
            ET.SubElement(node, "skipped", message="Timing noise exceeds 5%; comparison is inconclusive")
        output = ET.SubElement(node, "system-out")
        output.text = json.dumps(case, sort_keys=True)
    tree = ET.ElementTree(suite)
    ET.indent(tree, space="  ")
    path.parent.mkdir(parents=True, exist_ok=True)
    tree.write(path, encoding="utf-8", xml_declaration=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    parser.add_argument("--junit", type=Path)
    parser.add_argument("--baseline", type=Path)
    parser.add_argument("--source-root", type=Path, default=ROOT,
                        help="Run this exact harness against another checkout's scientific source.")
    parser.add_argument("--require-comparison", action="store_true",
                        help="Fail when a stable compatible baseline comparison is unavailable.")
    parser.add_argument("--repeats", type=int, default=5)
    parser.add_argument("--only", action="append")
    parser.add_argument("--reference-platform", action="store_true")
    parser.add_argument("--no-gate", action="store_true")
    args = parser.parse_args(argv)
    if args.repeats < 3:
        parser.error("--repeats must be at least 3")

    try:
        source_origin = load_workloads(args.source_root)
    except ValueError as error:
        parser.error(str(error))
    selected = args.only or list(WORKLOADS)
    if len(set(selected)) != len(selected) or any(name not in WORKLOADS for name in selected):
        parser.error(f"--only must select distinct workloads from {sorted(WORKLOADS)}")
    context = comparison_context(args.repeats, selected)
    baseline, comparison = load_baseline(args.baseline, context)
    cases = [run_case(name, args.repeats, baseline.get(name)) for name in selected]
    status = ("regressed" if any(case["status"] == "regressed" for case in cases)
              else "inconclusive" if any(case["status"] == "inconclusive" for case in cases)
              else "passed")
    if comparison["status"] == "available":
        comparison["status"] = status
    stable = all(case["coefficient_of_variation"] <= 0.05 for case in cases)
    clean = git_value("status", "--porcelain") == ""
    report = {
        "schema": SCHEMA,
        "generated_at": utc_now(),
        "status": status,
        "profile": "reference" if args.reference_platform else "ci-regression",
        "public_claim_eligible": bool(args.reference_platform and args.repeats >= 5 and stable and clean),
        "public_claim_ineligibility_reasons": [
            reason for condition, reason in (
                (not args.reference_platform, "not run on the controlled reference platform"),
                (args.repeats < 5, "fewer than five measured repetitions"),
                (not stable, "one or more workload coefficients of variation exceed 5%"),
                (not clean, "source worktree is not clean"),
            ) if condition
        ],
        "provenance": {
            "commit": git_value("rev-parse", "HEAD"),
            "scientific_source_root": str(SOURCE_ROOT),
            "scientific_import_origin": source_origin,
            "dependency_environment": "Current interpreter; uv-lock equality is required for release comparisons.",
            "worktree_clean": clean,
            "workload_sha256": workload_hash(),
            "uv_lock_sha256": file_hash("uv.lock"),
            "package_lock_sha256": file_hash("gui/frontend/package-lock.json"),
        },
        "environment": context["environment"],
        "comparison_context": context,
        "comparison": comparison,
        "cases": cases,
        "interpretation": (
            "CI results are regression diagnostics. Numerical public performance claims require "
            "the controlled reference profile, five stable runs, a clean revision, and the raw evidence."
        ),
    }
    rendered = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    if args.junit:
        render_junit(args.junit, report)
    print(rendered, end="")
    if args.require_comparison and comparison["status"] not in {"passed", "regressed"}:
        return 2
    return 1 if not args.no_gate and status == "regressed" else 0


if __name__ == "__main__":
    raise SystemExit(main())
