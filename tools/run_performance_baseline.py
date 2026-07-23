#!/usr/bin/env python3
"""Run deterministic Perdura performance workloads and emit reviewable evidence."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import gc
import hashlib
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

from performance_workloads import WORKLOADS


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
            ["git", *args], cwd=ROOT, check=True, capture_output=True,
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
    path = ROOT / relative
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def workload_hash() -> str:
    paths = [ROOT / "tools" / "performance_workloads.py", Path(__file__)]
    digest = hashlib.sha256()
    for path in paths:
        digest.update(path.name.encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def load_baseline(path: Path | None) -> dict[str, dict[str, Any]]:
    if not path:
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schema") != SCHEMA or data.get("status") not in {"passed", "regressed"}:
        raise ValueError("Baseline is not a supported completed performance record")
    return {case["id"]: case for case in data.get("cases", [])}


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
    regression = bool(
        (time_change is not None and time_change > 0.10)
        or (memory_change is not None and memory_change > 0.15)
    )
    return {
        "id": identifier,
        "status": "regressed" if regression else "passed",
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
            "median_change_fraction": time_change,
            "peak_memory_change_fraction": memory_change,
            "time_regression_threshold_fraction": 0.10,
            "memory_regression_threshold_fraction": 0.15,
        },
    }


def render_junit(path: Path, report: dict[str, Any]) -> None:
    regressed = sum(case["status"] == "regressed" for case in report["cases"])
    suite = ET.Element(
        "testsuite", name="performance-baseline", tests=str(len(report["cases"])),
        failures=str(regressed), errors="0", skipped="0",
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
    parser.add_argument("--repeats", type=int, default=5)
    parser.add_argument("--only", action="append", choices=sorted(WORKLOADS))
    parser.add_argument("--reference-platform", action="store_true")
    parser.add_argument("--no-gate", action="store_true")
    args = parser.parse_args(argv)
    if args.repeats < 3:
        parser.error("--repeats must be at least 3")

    baseline = load_baseline(args.baseline)
    selected = args.only or list(WORKLOADS)
    cases = [run_case(name, args.repeats, baseline.get(name)) for name in selected]
    status = "regressed" if any(case["status"] == "regressed" for case in cases) else "passed"
    stable = all(case["coefficient_of_variation"] <= 0.05 for case in cases)
    clean = git_value("status", "--porcelain") == ""
    report = {
        "schema": SCHEMA,
        "generated_at": utc_now(),
        "status": status,
        "profile": "reference" if args.reference_platform else "ci-regression",
        "public_claim_eligible": bool(args.reference_platform and stable and clean),
        "public_claim_ineligibility_reasons": [
            reason for condition, reason in (
                (not args.reference_platform, "not run on the controlled reference platform"),
                (not stable, "one or more workload coefficients of variation exceed 5%"),
                (not clean, "source worktree is not clean"),
            ) if condition
        ],
        "provenance": {
            "commit": git_value("rev-parse", "HEAD"),
            "worktree_clean": clean,
            "workload_sha256": workload_hash(),
            "uv_lock_sha256": file_hash("uv.lock"),
            "package_lock_sha256": file_hash("gui/frontend/package-lock.json"),
        },
        "environment": {
            "platform": platform.platform(),
            "machine": platform.machine(),
            "cpu_model": cpu_model(),
            "logical_cpu_count": os.cpu_count(),
            "python": platform.python_version(),
        },
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
    return 0 if args.no_gate or status == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
