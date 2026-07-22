#!/usr/bin/env python3
"""Build durable, fail-closed verification evidence for Perdura CI and releases.

The tool intentionally uses only the Python standard library so evidence can
still be assembled when part of the project environment failed to install.
It never infers a pass from missing evidence: absent expected components are
reported as incomplete, while explicit command/test failures are reported as
failed.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import html
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
from typing import Any, Iterable
import xml.etree.ElementTree as ET
import zipfile


SCHEMA = "perdura.build-verification/v1"
COMPONENT_SCHEMA = "perdura.build-verification-component/v1"
ROOT = Path(__file__).resolve().parents[1]
PASS_STATUSES = {"pass", "passed", "success", "successful", "skipped"}
FAIL_STATUSES = {"fail", "failed", "failure", "error", "timed_out"}
INCOMPLETE_STATUSES = {"cancelled", "canceled", "incomplete", "missing", "unknown"}
TEXT_SUFFIXES = {".json", ".xml", ".log", ".txt", ".md", ".html", ".css", ".js"}
REDACTIONS = (
    (re.compile(r"(?i)(authorization\s*:\s*(?:bearer|token)\s+)[^\s<]+"), r"\1[REDACTED]"),
    (re.compile(r"(?i)((?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*)[^\s,;<]+"), r"\1[REDACTED]"),
    (re.compile(r"\b(?:gh[oprsu]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b"), "[REDACTED_GITHUB_TOKEN]"),
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_status(value: str | None) -> str:
    status = (value or "unknown").strip().lower()
    if status in PASS_STATUSES:
        return "passed" if status != "skipped" else "skipped"
    if status in FAIL_STATUSES:
        return "failed"
    if status in INCOMPLETE_STATUSES:
        return "incomplete"
    return "incomplete"


def redact(text: str) -> str:
    result = text
    for pattern, replacement in REDACTIONS:
        result = pattern.sub(replacement, result)
    # Normalize hosted-runner absolute paths without hiding repository paths.
    result = re.sub(r"/(?:home/runner/work|__w)/[^/\s]+/[^/\s]+", "[WORKSPACE]", result)
    result = re.sub(r"[A-Z]:\\(?:a|actions-runner)\\_work\\[^\\\s]+\\[^\\\s]+", "[WORKSPACE]", result, flags=re.I)
    return result


def command_version(command: list[str]) -> str | None:
    try:
        proc = subprocess.run(command, capture_output=True, text=True, timeout=10, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    line = (proc.stdout or proc.stderr).strip().splitlines()
    return redact(line[0]) if line else None


def parse_pairs(values: Iterable[str], *, normalized: bool = False) -> dict[str, str]:
    result: dict[str, str] = {}
    for raw in values:
        if "=" not in raw:
            raise ValueError(f"Expected NAME=VALUE, got {raw!r}")
        name, value = raw.split("=", 1)
        if not name.strip():
            raise ValueError(f"Pair has an empty name: {raw!r}")
        result[name.strip()] = normalize_status(value) if normalized else value.strip()
    return result


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def component_command(args: argparse.Namespace) -> int:
    results = parse_pairs(args.result, normalized=True)
    optional_results = parse_pairs(args.optional_result, normalized=True)
    duplicates = set(results) & set(optional_results)
    if duplicates:
        names = ", ".join(sorted(duplicates))
        raise ValueError(f"Results cannot be both required and optional: {names}")
    # Optional context (for example, a historical comparison baseline) may add
    # information to a report, but its absence is not evidence that the product
    # failed. Preserve successful retrievals and represent every unavailable
    # optional input as skipped instead of weakening the fail-closed semantics of
    # required commands and files.
    results.update({
        name: "passed" if status == "passed" else "skipped"
        for name, status in optional_results.items()
    })
    optional_ids = set(optional_results)
    files: list[dict[str, Any]] = []
    for raw in args.file:
        name, path_text = raw.split("=", 1) if "=" in raw else (Path(raw).name, raw)
        path = Path(path_text)
        files.append({
            "name": name,
            "path": str(path),
            "exists": path.is_file(),
            "size_bytes": path.stat().st_size if path.is_file() else None,
            "sha256": sha256(path) if path.is_file() else None,
        })
    explicit = normalize_status(args.status)
    statuses = [explicit, *results.values()]
    if any(not item["exists"] for item in files):
        statuses.append("incomplete")
    status = "failed" if "failed" in statuses else (
        "incomplete" if "incomplete" in statuses else "passed")
    payload = {
        "schema": COMPONENT_SCHEMA,
        "component_id": args.id,
        "label": args.label or args.id.replace("-", " ").title(),
        "kind": args.kind,
        "status": status,
        "generated_at": utc_now(),
        "results": [
            {"id": name, "status": value, "optional": name in optional_ids}
            for name, value in sorted(results.items())
        ],
        "files": files,
        "environment": {
            "os": platform.platform(),
            "machine": platform.machine(),
            "python": platform.python_version(),
            "node": command_version(["node", "--version"]),
            "npm": command_version(["npm", "--version"]),
            "uv": command_version(["uv", "--version"]),
        },
    }
    write_json(args.output, payload)
    return 0


def strip_tag(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def parse_junit(path: Path) -> tuple[list[dict[str, Any]], list[str]]:
    errors: list[str] = []
    cases: list[dict[str, Any]] = []
    try:
        root = ET.parse(path).getroot()
    except (ET.ParseError, OSError) as exc:
        return [], [f"Malformed JUnit XML {path.name}: {exc}"]
    for node in root.iter():
        if strip_tag(node.tag) != "testcase":
            continue
        status = "passed"
        detail = ""
        for child in node:
            child_tag = strip_tag(child.tag)
            if child_tag in {"failure", "error", "skipped"}:
                status = "failed" if child_tag in {"failure", "error"} else "skipped"
                detail = redact("\n".join(filter(None, [child.get("message"), child.text])).strip())
                break
        try:
            duration = float(node.get("time", "0") or 0)
        except ValueError:
            duration = 0.0
            errors.append(f"Invalid test duration in {path.name}: {node.get('time')!r}")
        cases.append({
            "suite": node.get("classname") or root.get("name") or path.stem,
            "name": node.get("name") or "unnamed",
            "status": status,
            "duration_seconds": duration,
            "detail": detail,
            "source": path.name,
        })
    return cases, errors


def parse_coverage(path: Path) -> tuple[dict[str, Any] | None, list[str]]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        totals = data["totals"]
    except (OSError, json.JSONDecodeError, KeyError, TypeError) as exc:
        return None, [f"Malformed coverage JSON {path.name}: {exc}"]
    covered_lines = totals.get("covered_lines")
    num_statements = totals.get("num_statements")
    line_percent = totals.get("percent_statements_covered")
    if line_percent is None and covered_lines is not None and num_statements:
        line_percent = 100 * covered_lines / num_statements
    summary = {
        "source": path.name,
        "covered_lines": covered_lines,
        "num_statements": num_statements,
        "missing_lines": totals.get("missing_lines"),
        "line_percent": line_percent,
        "combined_percent": totals.get("percent_covered"),
        "covered_branches": totals.get("covered_branches"),
        "num_branches": totals.get("num_branches"),
        "missing_branches": totals.get("missing_branches"),
    }
    if summary["num_branches"]:
        summary["branch_percent"] = 100 * summary["covered_branches"] / summary["num_branches"]
    else:
        summary["branch_percent"] = None
    summary["files"] = {
        name: entry.get("summary", {}) for name, entry in sorted(data.get("files", {}).items())
    }
    return summary, []


def parse_warnings(paths: list[Path]) -> list[dict[str, str]]:
    warnings: list[dict[str, str]] = []
    seen: set[tuple[str, str, str]] = set()
    pattern = re.compile(
        r"^(?P<location>.+?)(?::(?P<line>\d+))?:\s*"
        r"(?P<category>[A-Za-z_][A-Za-z0-9_]*(?:Warning|DeprecationWarning)):\s*"
        r"(?P<message>.+)$")
    for path in sorted(p for p in paths if p.suffix.lower() == ".log"):
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        for line in lines:
            match = pattern.match(line.strip())
            if not match:
                continue
            location = match.group("location")
            if match.group("line"):
                location += f":{match.group('line')}"
            item = (match.group("category"), redact(location), redact(match.group("message")))
            if item in seen:
                continue
            seen.add(item)
            warnings.append({
                "category": item[0], "location": item[1],
                "message": item[2], "source": path.name,
            })
    return warnings


def parse_workflow_execution(paths: list[Path]) -> list[dict[str, Any]]:
    source = next((path for path in paths if path.name == "workflow-jobs.json"), None)
    if not source:
        return []
    try:
        data = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    jobs = []
    for job in data.get("jobs", []):
        steps = []
        for step in job.get("steps", []):
            steps.append({
                "name": redact(str(step.get("name", ""))),
                "status": step.get("status"), "conclusion": step.get("conclusion"),
                "started_at": step.get("started_at"), "completed_at": step.get("completed_at"),
            })
        jobs.append({
            "name": redact(str(job.get("name", ""))),
            "runner_name": redact(str(job.get("runner_name", ""))),
            "status": job.get("status"), "conclusion": job.get("conclusion"),
            "started_at": job.get("started_at"), "completed_at": job.get("completed_at"),
            "html_url": job.get("html_url"), "steps": steps,
        })
    return jobs


def assurance_summary(paths: list[Path]) -> dict[str, Any] | None:
    matrix = next((p for p in paths if p.name == "model-assurance-matrix.json"), None)
    if not matrix:
        return None
    try:
        data = json.loads(matrix.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"available": False, "error": "Model-assurance matrix could not be parsed."}
    statuses = Counter(model.get("status", "unspecified") for model in data.get("models", []))
    blockers = sum(len(model.get("blockers", [])) for model in data.get("models", []))
    return {
        "available": True,
        "schema_version": data.get("schema_version"),
        "inventory_complete": data.get("model_inventory_complete"),
        "domains": len(data.get("domains", [])),
        "detailed_models": len(data.get("models", [])),
        "model_status_counts": dict(sorted(statuses.items())),
        "blocker_count": blockers,
        "sha256": sha256(matrix),
    }


def reference_summary(paths: list[Path]) -> dict[str, Any] | None:
    catalog = next((p for p in paths if p.name == "mil-hdbk-217f-evidence.json"), None)
    if not catalog:
        return None
    try:
        data = json.loads(catalog.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"available": False, "error": "Reference-evidence catalog could not be parsed."}
    program = data.get("program_status", {})
    return {
        "available": True,
        "catalog_id": data.get("catalog_id"),
        "reviewed_on": data.get("reviewed_on"),
        "assurance_status": program.get("assurance_status"),
        "conformance_tier": program.get("conformance_tier"),
        "lineage_evidence": program.get("lineage_evidence"),
        "documents": len(data.get("documents", [])),
        "appendix_c_entries": len(data.get("appendix_c_entries", [])),
        "sha256": sha256(catalog),
    }


def crow_summaries(paths: list[Path]) -> list[dict[str, Any]]:
    summaries = []
    for path in paths:
        if "crow" not in path.name.lower() or path.suffix.lower() != ".json":
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if data.get("tool") != "crow_amsaa_validation":
            continue
        summaries.append({
            "source": path.name,
            "profile": data.get("profile"),
            "passed": data.get("passed"),
            "certification_eligible": data.get("certification_eligible"),
            "certification_ineligibility_reasons": data.get("certification_ineligibility_reasons", []),
            "replicates_per_coverage_cell": data.get("replicates_per_coverage_cell"),
            "elapsed_seconds": data.get("provenance", {}).get("elapsed_seconds"),
            "sha256": sha256(path),
        })
    return summaries


def copy_raw_files(inputs: list[Path], output: Path) -> tuple[list[dict[str, Any]], list[str]]:
    raw_root = output / "raw"
    records: list[dict[str, Any]] = []
    errors: list[str] = []
    for input_index, source_root in enumerate(inputs):
        if not source_root.exists():
            errors.append(f"Evidence input does not exist: {source_root}")
            continue
        candidates = [source_root] if source_root.is_file() else sorted(source_root.rglob("*"))
        for source in candidates:
            if not source.is_file() or source.is_symlink():
                continue
            relative = Path(source.name) if source_root.is_file() else source.relative_to(source_root)
            target = raw_root / f"input-{input_index + 1}" / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            if source.suffix.lower() in TEXT_SUFFIXES:
                try:
                    target.write_text(redact(source.read_text(encoding="utf-8", errors="replace")), encoding="utf-8")
                except OSError as exc:
                    errors.append(f"Could not copy {source}: {exc}")
                    continue
            else:
                shutil.copy2(source, target)
            records.append({
                "path": target.relative_to(output).as_posix(),
                "size_bytes": target.stat().st_size,
                "sha256": sha256(target),
            })
    return records, errors


def load_baseline(path: Path | None) -> dict[str, Any] | None:
    if not path or not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if data.get("schema") == SCHEMA:
        return data.get("coverage")
    return data.get("coverage", data)


def fmt_percent(value: Any) -> str:
    return "—" if value is None else f"{float(value):.2f}%"


def fmt_delta(value: Any) -> str:
    return "baseline unavailable" if value is None else f"{float(value):+.2f} percentage points"


def render_markdown(report: dict[str, Any]) -> str:
    totals = report["tests"]["totals"]
    coverage = report.get("coverage") or {}
    coverage_delta = coverage.get("delta") or {}
    icon = "✅" if report["status"] == "passed" else "❌" if report["status"] == "failed" else "⚠️"
    lines = [
        f"# {icon} Perdura build verification — {report['status'].upper()}",
        "",
        f"- Commit: `{report['provenance']['commit'] or 'unknown'}`",
        f"- Workflow: {report['provenance']['run_url'] or 'not supplied'}",
        f"- Completeness: **{'complete' if report['complete'] else 'incomplete'}**",
        f"- Tests: **{totals['total']}** total · {totals['passed']} passed · {totals['failed']} failed · {totals['skipped']} skipped",
        f"- Python line / branch coverage: **{fmt_percent(coverage.get('line_percent'))} / {fmt_percent(coverage.get('branch_percent'))}**",
        f"- Coverage.py combined line-and-branch metric: **{fmt_percent(coverage.get('combined_percent'))}**",
        f"- Coverage change versus latest successful main: **lines {fmt_delta(coverage_delta.get('line_percent'))}; branches {fmt_delta(coverage_delta.get('branch_percent'))}**",
        f"- Warnings captured: **{len(report.get('warnings', []))}**",
        "",
        "## Components",
        "",
        "| Component | Kind | Status |",
        "|---|---|---|",
    ]
    for component in report["components"]:
        lines.append(f"| {component['label']} | {component['kind']} | {component['status']} |")
    if report["issues"]:
        lines.extend(["", "## Evidence issues", ""])
        lines.extend(f"- {issue}" for issue in report["issues"])
    failures = [case for case in report["tests"]["cases"] if case["status"] == "failed"]
    if failures:
        lines.extend(["", "## Test failures", ""])
        lines.extend(f"- `{case['suite']}::{case['name']}`" for case in failures[:50])
    if report.get("warnings"):
        lines.extend(["", "## Warnings", ""])
        lines.extend(
            f"- `{warning['category']}` at `{warning['location']}` — {warning['message']}"
            for warning in report["warnings"][:50])
    lines.extend([
        "", "## Interpretation", "",
        "This automated record supports verification and audit review. It is not regulatory certification, independent validation, or proof of complete requirements coverage.",
        "Security analysis is controlled separately by the repository's CodeQL and Dependabot records.",
        "",
    ])
    return "\n".join(lines)


def render_html(report: dict[str, Any]) -> str:
    esc = lambda value: html.escape(str(value if value is not None else "—"))
    totals = report["tests"]["totals"]
    coverage = report.get("coverage") or {}
    coverage_delta = coverage.get("delta") or {}
    component_rows = "".join(
        f"<tr><td>{esc(c['label'])}</td><td>{esc(c['kind'])}</td><td class='status-{esc(c['status'])}'>{esc(c['status'])}</td></tr>"
        for c in report["components"]
    )
    component_details = []
    for component in report["components"]:
        result_rows = "".join(
            f"<tr><td>{esc(item.get('id'))}</td><td class='status-{esc(item.get('status'))}'>{esc(item.get('status'))}</td></tr>"
            for item in component.get("results", [])
        ) or "<tr><td colspan='2'>No individual command results recorded.</td></tr>"
        file_rows = "".join(
            f"<tr><td>{esc(item.get('name'))}</td><td>{esc(item.get('exists'))}</td><td>{esc(item.get('size_bytes'))}</td><td><code>{esc(item.get('sha256'))}</code></td></tr>"
            for item in component.get("files", [])
        ) or "<tr><td colspan='4'>No declared files.</td></tr>"
        component_details.append(
            f"<details><summary>{esc(component['label'])} — {esc(component['status'])}</summary>"
            "<h3>Command results</h3><table><thead><tr><th>Command</th><th>Status</th></tr></thead>"
            f"<tbody>{result_rows}</tbody></table><h3>Declared files</h3>"
            "<table><thead><tr><th>File</th><th>Exists</th><th>Bytes</th><th>SHA-256</th></tr></thead>"
            f"<tbody>{file_rows}</tbody></table><h3>Environment</h3>"
            f"<pre>{esc(json.dumps(component.get('environment', {}), indent=2, sort_keys=True))}</pre></details>")
    issue_items = "".join(f"<li>{esc(issue)}</li>" for issue in report["issues"]) or "<li>None.</li>"
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for case in report["tests"]["cases"]:
        groups[case["suite"]].append(case)
    test_groups = []
    for suite, cases in sorted(groups.items()):
        counts = Counter(case["status"] for case in cases)
        rows = []
        for case in sorted(cases, key=lambda item: (item["status"] != "failed", item["name"])):
            detail = f"<pre>{esc(case['detail'])}</pre>" if case["detail"] else ""
            rows.append(
                f"<tr><td>{esc(case['name'])}{detail}</td><td class='status-{esc(case['status'])}'>{esc(case['status'])}</td>"
                f"<td>{case['duration_seconds']:.4f}</td><td>{esc(case['source'])}</td></tr>")
        test_groups.append(
            f"<details{' open' if counts['failed'] else ''}><summary>{esc(suite)} — {len(cases)} tests; {counts['failed']} failed</summary>"
            "<table><thead><tr><th>Test</th><th>Status</th><th>Seconds</th><th>Evidence</th></tr></thead>"
            f"<tbody>{''.join(rows)}</tbody></table></details>")
    raw_rows = "".join(
        f"<tr><td>{esc(item['path'])}</td><td>{item['size_bytes']}</td><td><code>{item['sha256']}</code></td></tr>"
        for item in report["raw_files"]
    )
    warning_rows = "".join(
        f"<tr><td>{esc(item['category'])}</td><td>{esc(item['location'])}</td><td>{esc(item['message'])}</td></tr>"
        for item in report.get("warnings", [])) or "<tr><td colspan='3'>None captured.</td></tr>"
    execution_rows = "".join(
        f"<tr><td>{esc(job['name'])}</td><td>{esc(job.get('runner_name'))}</td><td>{esc(job.get('conclusion') or job.get('status'))}</td><td>{esc(job.get('started_at'))}</td><td>{esc(job.get('completed_at'))}</td></tr>"
        for job in report.get("workflow_execution", [])) or "<tr><td colspan='5'>Workflow timing metadata unavailable.</td></tr>"
    execution_details = []
    for job in report.get("workflow_execution", []):
        step_rows = "".join(
            f"<tr><td>{esc(step.get('name'))}</td><td>{esc(step.get('conclusion') or step.get('status'))}</td><td>{esc(step.get('started_at'))}</td><td>{esc(step.get('completed_at'))}</td></tr>"
            for step in job.get("steps", [])) or "<tr><td colspan='4'>No step timing metadata.</td></tr>"
        execution_details.append(
            f"<details><summary>{esc(job.get('name'))} — {esc(job.get('conclusion') or job.get('status'))}</summary>"
            "<table><thead><tr><th>Step</th><th>Conclusion</th><th>Started</th><th>Completed</th></tr></thead>"
            f"<tbody>{step_rows}</tbody></table></details>")
    coverage_rows = "".join(
        f"<tr><td><code>{esc(name)}</code></td>"
        f"<td>{esc(item.get('covered_lines'))} / {esc(item.get('num_statements'))}</td>"
        f"<td>{fmt_percent(item.get('percent_statements_covered'))}</td>"
        f"<td>{esc(item.get('covered_branches'))} / {esc(item.get('num_branches'))}</td>"
        f"<td>{fmt_percent(item.get('percent_branches_covered'))}</td></tr>"
        for name, item in sorted((coverage.get("files") or {}).items())
    ) or "<tr><td colspan='5'>Per-file coverage unavailable.</td></tr>"
    provenance = report["provenance"]
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Perdura build verification — {esc(report['status'])}</title>
<style>
body{{font:14px/1.45 system-ui,sans-serif;color:#172033;max-width:1500px;margin:0 auto;padding:28px}}h1,h2{{color:#111827}}.banner{{padding:16px;border:2px solid #94a3b8;border-radius:8px;background:#f8fafc}}.status-passed{{color:#166534;font-weight:700}}.status-failed{{color:#b91c1c;font-weight:700}}.status-incomplete{{color:#a16207;font-weight:700}}.status-skipped{{color:#64748b}}.metrics{{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:16px 0}}.metric{{border:1px solid #d1d5db;border-radius:6px;padding:10px}}table{{width:100%;border-collapse:collapse;margin:8px 0 18px}}th,td{{border:1px solid #d1d5db;padding:6px;text-align:left;vertical-align:top}}th{{background:#f1f5f9}}code,pre{{font:12px ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}}details{{margin:8px 0;border:1px solid #d1d5db;border-radius:6px;padding:8px}}summary{{cursor:pointer;font-weight:600}}.notice{{border-left:4px solid #64748b;padding:8px 12px;background:#f8fafc}}@media print{{details{{break-inside:avoid}}details>summary{{display:none}}details>*{{display:block!important}}}}
</style></head><body>
<h1>Perdura Build Verification Report</h1><div class="banner"><strong class="status-{esc(report['status'])}">{esc(report['status'].upper())}</strong> · Evidence {"complete" if report["complete"] else "incomplete"}<br>Schema {esc(report['schema'])} · Generated {esc(report['generated_at'])}</div>
<div class="metrics"><div class="metric"><b>Tests</b><br>{totals['total']} total<br>{totals['passed']} passed / {totals['failed']} failed / {totals['skipped']} skipped</div><div class="metric"><b>Coverage</b><br>{fmt_percent(coverage.get('line_percent'))} lines ({fmt_delta(coverage_delta.get('line_percent'))})<br>{fmt_percent(coverage.get('branch_percent'))} branches ({fmt_delta(coverage_delta.get('branch_percent'))})<br>{fmt_percent(coverage.get('combined_percent'))} Coverage.py combined</div><div class="metric"><b>Commit</b><br><code>{esc(provenance.get('commit'))}</code></div><div class="metric"><b>Run</b><br><a href="{esc(provenance.get('run_url'))}">{esc(provenance.get('run_id'))}</a> attempt {esc(provenance.get('run_attempt'))}</div></div>
<h2>Verification components</h2><table><thead><tr><th>Component</th><th>Kind</th><th>Status</th></tr></thead><tbody>{component_rows}</tbody></table>
{''.join(component_details)}
<h2>Evidence issues and limitations</h2><ul>{issue_items}</ul><p class="notice">This automated record supports verification and audit review. It is not regulatory certification, independent validation, or proof of complete requirements coverage. CodeQL and Dependabot are separately controlled security records.</p>
<h2>Coverage details</h2><table><thead><tr><th>File</th><th>Lines</th><th>Line %</th><th>Branches</th><th>Branch %</th></tr></thead><tbody>{coverage_rows}</tbody></table>
<h2>Workflow execution</h2><table><thead><tr><th>Job</th><th>Runner</th><th>Conclusion</th><th>Started</th><th>Completed</th></tr></thead><tbody>{execution_rows}</tbody></table>
{''.join(execution_details)}
<h2>Scientific assurance</h2><pre>{esc(json.dumps(report.get('scientific_assurance'), indent=2, sort_keys=True))}</pre>
<h2>Warnings</h2><table><thead><tr><th>Category</th><th>Location</th><th>Message</th></tr></thead><tbody>{warning_rows}</tbody></table>
<h2>Detailed test results</h2>{''.join(test_groups) if test_groups else '<p>No JUnit test cases were available.</p>'}
<h2>Raw evidence inventory</h2><table><thead><tr><th>Path</th><th>Bytes</th><th>SHA-256</th></tr></thead><tbody>{raw_rows}</tbody></table>
</body></html>"""


def all_files(roots: list[Path]) -> list[Path]:
    paths: list[Path] = []
    for root in roots:
        if root.is_file():
            paths.append(root)
        elif root.exists():
            paths.extend(path for path in root.rglob("*") if path.is_file() and not path.is_symlink())
    return paths


def compile_command(args: argparse.Namespace) -> int:
    inputs = [Path(value) for value in args.input]
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    paths = all_files(inputs)
    issues: list[str] = []
    components: list[dict[str, Any]] = []
    for path in sorted(paths):
        if not path.name.startswith("component") or path.suffix != ".json":
            continue
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            issues.append(f"Malformed component manifest {path.name}: {exc}")
            continue
        if value.get("schema") != COMPONENT_SCHEMA:
            continue
        # Component manifests are incorporated into the canonical report, so
        # apply the same secret/path redaction used for copied raw evidence.
        value = json.loads(redact(json.dumps(value)))
        value["source"] = path.name
        components.append(value)
    component_ids = {component["component_id"] for component in components}
    for expected in args.expected:
        if expected not in component_ids:
            issues.append(f"Expected evidence component is missing: {expected}")
    job_results = parse_pairs(args.job_result, normalized=True)
    for job_id, status in sorted(job_results.items()):
        if job_id not in component_ids:
            components.append({
                "schema": COMPONENT_SCHEMA,
                "component_id": job_id,
                "label": job_id.replace("-", " ").title(),
                "kind": "workflow_job",
                "status": status,
                "results": [],
                "files": [],
                "environment": {},
                "source": "workflow needs context",
            })
    cases: list[dict[str, Any]] = []
    for path in sorted(p for p in paths if p.suffix.lower() == ".xml" and "junit" in p.name.lower()):
        parsed, parse_issues = parse_junit(path)
        cases.extend(parsed)
        issues.extend(parse_issues)
    if not cases:
        issues.append("Structured JUnit test results are missing or contain no test cases.")
    coverage = None
    coverage_paths = [p for p in paths if p.suffix.lower() == ".json" and p.name.startswith("coverage")]
    if coverage_paths:
        coverage, coverage_issues = parse_coverage(sorted(coverage_paths)[0])
        issues.extend(coverage_issues)
    else:
        issues.append("Python branch-coverage JSON is missing.")
    baseline = load_baseline(Path(args.baseline) if args.baseline else None)
    if coverage is not None:
        coverage["baseline"] = baseline
        coverage["delta"] = {
            "line_percent": None if not baseline or baseline.get("line_percent") is None else coverage["line_percent"] - baseline["line_percent"],
            "branch_percent": None if not baseline or baseline.get("branch_percent") is None else coverage["branch_percent"] - baseline["branch_percent"],
            "combined_percent": None if coverage.get("combined_percent") is None or not baseline or baseline.get("combined_percent") is None else coverage["combined_percent"] - baseline["combined_percent"],
        }
    raw_files, copy_issues = copy_raw_files(inputs, output)
    issues.extend(copy_issues)
    totals = Counter(case["status"] for case in cases)
    warnings = parse_warnings(paths)
    explicit_failures = any(component.get("status") == "failed" for component in components) or totals["failed"] > 0
    incomplete = bool(issues) or any(component.get("status") == "incomplete" for component in components)
    status = "failed" if explicit_failures else "incomplete" if incomplete else "passed"
    report = {
        "schema": SCHEMA,
        "report_kind": "continuous_integration",
        "status": status,
        "complete": not incomplete,
        "generated_at": utc_now(),
        "provenance": {
            "repository": args.repository,
            "commit": args.commit,
            "ref": args.ref,
            "event": args.event,
            "version": args.version,
            "run_id": args.run_id,
            "run_attempt": args.run_attempt,
            "run_url": args.run_url,
        },
        "components": sorted(components, key=lambda item: item["component_id"]),
        "tests": {
            "totals": {
                "total": len(cases), "passed": totals["passed"],
                "failed": totals["failed"], "skipped": totals["skipped"],
                "duration_seconds": sum(case["duration_seconds"] for case in cases),
            },
            "cases": sorted(cases, key=lambda item: (item["suite"], item["name"])),
        },
        "coverage": coverage,
        "warnings": warnings,
        "workflow_execution": parse_workflow_execution(paths),
        "scientific_assurance": {
            "model_assurance": assurance_summary(paths),
            "reference_evidence": reference_summary(paths),
            "crow_amsaa": crow_summaries(paths),
        },
        "issues": sorted(set(issues)),
        "raw_files": raw_files,
        "related_security_records": {
            "codeql": f"https://github.com/{args.repository}/actions/workflows/codeql.yml" if args.repository else None,
            "dependabot": f"https://github.com/{args.repository}/security/dependabot" if args.repository else None,
            "included_in_conclusion": False,
        },
        "interpretation": "Automated verification evidence; not regulatory certification or independent validation.",
    }
    write_json(output / "verification-report.json", report)
    (output / "verification-report.md").write_text(render_markdown(report), encoding="utf-8")
    (output / "verification-report.html").write_text(render_html(report), encoding="utf-8")
    (output / "conclusion.txt").write_text(status + "\n", encoding="utf-8")
    for source_name in ("build-verification.schema.json", "BUILD_VERIFICATION.md"):
        source = ROOT / "docs" / "assurance" / source_name
        if source.is_file():
            shutil.copy2(source, output / source.name)
    write_checksums(output)
    if args.github_summary:
        Path(args.github_summary).write_text(render_markdown(report), encoding="utf-8")
    print(f"Verification evidence: {status}; {len(cases)} tests; {len(issues)} evidence issue(s).")
    return 0


def write_checksums(root: Path) -> None:
    checksum_path = root / "SHA256SUMS"
    entries = []
    for path in sorted(p for p in root.rglob("*") if p.is_file() and p != checksum_path):
        entries.append(f"{sha256(path)}  {path.relative_to(root).as_posix()}")
    checksum_path.write_text("\n".join(entries) + "\n", encoding="utf-8")


def gate_command(args: argparse.Namespace) -> int:
    try:
        report = json.loads(Path(args.report).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"Verification report unavailable: {exc}", file=sys.stderr)
        return 2
    if report.get("schema") != SCHEMA or report.get("status") != "passed" or report.get("complete") is not True:
        print(f"Verification evidence is not a complete pass: {report.get('status', 'invalid')}", file=sys.stderr)
        return 1
    return 0


def release_command(args: argparse.Namespace) -> int:
    ci_report_path = Path(args.ci_report)
    try:
        ci_report = json.loads(ci_report_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"Cannot load CI report: {exc}", file=sys.stderr)
        return 2
    output = Path(args.output)
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    ci_root = ci_report_path.parent
    shutil.copytree(ci_root, output / "ci-evidence")
    artifacts_dir = output / "release-artifacts"
    artifacts_dir.mkdir()
    subjects: list[dict[str, Any]] = []
    issues: list[str] = []
    explicit_failure = ci_report.get("status") == "failed"
    for raw in args.subject:
        source = Path(raw)
        if not source.is_file():
            issues.append(f"Release subject is missing: {source}")
            continue
        bundled = source.suffix.lower() == ".json"
        if bundled:
            target = artifacts_dir / source.name
            shutil.copy2(source, target)
        subjects.append({
            "name": source.name, "path": source.name,
            "size_bytes": source.stat().st_size, "sha256": sha256(source),
            "bundled": bundled,
        })
    crow_release = None
    for raw in args.subject:
        path = Path(raw)
        if path.is_file() and "crow" in path.name.lower() and path.suffix == ".json":
            try:
                candidate = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            if candidate.get("profile") == "release":
                crow_release = {
                    "passed": candidate.get("passed"),
                    "certification_eligible": candidate.get("certification_eligible"),
                    "ineligibility_reasons": candidate.get("certification_ineligibility_reasons", []),
                    "git_sha": candidate.get("provenance", {}).get("git_sha"),
                }
    if ci_report.get("schema") != SCHEMA:
        issues.append("Underlying CI evidence has an unsupported or missing schema.")
    if ci_report.get("status") != "passed" or ci_report.get("complete") is not True:
        issues.append("Underlying CI evidence is not a complete pass.")
    ci_provenance = ci_report.get("provenance", {})
    if ci_provenance.get("commit") != args.commit:
        issues.append("Underlying CI evidence commit does not match the release commit.")
    if ci_provenance.get("version") != args.version:
        issues.append("Underlying CI evidence version does not match the release version.")
    if not crow_release or crow_release.get("passed") is not True or crow_release.get("certification_eligible") is not True:
        issues.append("Release-profile Crow-AMSAA evidence is missing, failed, or not certification-eligible.")
        if crow_release and crow_release.get("passed") is False:
            explicit_failure = True
    elif crow_release.get("git_sha") != args.commit:
        issues.append("Release-profile Crow-AMSAA evidence commit does not match the release commit.")

    expected_targets = {"linux-x64", "windows-x64", "macos-arm64"}
    manifest_targets: set[str] = set()
    lock_hashes: set[str] = set()
    manifests = [item for item in subjects if "dependencies-" in item["name"] and item["name"].endswith(".json")]
    for item in manifests:
        path = next(Path(raw) for raw in args.subject if Path(raw).name == item["name"])
        try:
            manifest = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            issues.append(f"Release dependency manifest {item['name']} is malformed: {exc}.")
            continue
        filename_target = item["name"].split("dependencies-", 1)[1].removesuffix(".json")
        manifest_target = manifest.get("target")
        manifest_targets.add(str(manifest_target))
        if manifest_target != filename_target:
            issues.append(f"Dependency manifest {item['name']} reports target {manifest_target!r}.")
        if manifest.get("python") != "3.11.15":
            issues.append(f"Dependency manifest {item['name']} was not generated with Python 3.11.15.")
        lock_hash = manifest.get("uv_lock_sha256")
        if not isinstance(lock_hash, str) or len(lock_hash) != 64:
            issues.append(f"Dependency manifest {item['name']} has no valid uv.lock digest.")
        else:
            lock_hashes.add(lock_hash)
    if len(manifests) != 3 or manifest_targets != expected_targets:
        issues.append(f"Release dependency manifests cover {sorted(manifest_targets)}, expected {sorted(expected_targets)}.")
    if len(lock_hashes) != 1:
        issues.append("Release dependency manifests do not share one uv.lock digest.")
    ci_lock_hashes = {
        item.get("sha256") for item in ci_report.get("raw_files", [])
        if str(item.get("path", "")).endswith("/uv.lock")
    }
    if len(ci_lock_hashes) != 1 or lock_hashes != ci_lock_hashes:
        issues.append("Release dependency manifests do not match the uv.lock tested by CI.")

    archives = [item for item in subjects if item["name"].endswith((".zip", ".tar.gz"))]
    archive_targets = {
        target for target in expected_targets
        if any(f"-{target}." in item["name"] for item in archives)
    }
    if len(archives) != 3 or archive_targets != expected_targets:
        issues.append(
            f"Release archives cover {sorted(archive_targets)}, expected one each for {sorted(expected_targets)}.")
    report = {
        "schema": SCHEMA,
        "report_kind": "release",
        "status": "passed" if not issues else "failed" if explicit_failure else "incomplete",
        "complete": not issues,
        "generated_at": utc_now(),
        "provenance": {
            "repository": args.repository, "commit": args.commit,
            "version": args.version, "run_id": args.run_id, "run_url": args.run_url,
        },
        "ci_report": {
            "status": ci_report.get("status"), "sha256": sha256(ci_report_path),
            "test_totals": ci_report.get("tests", {}).get("totals"),
            "coverage": ci_report.get("coverage"),
        },
        "crow_amsaa_release": crow_release,
        "release_subjects": sorted(subjects, key=lambda item: item["name"]),
        "issues": issues,
        "attestation": {
            "method": "GitHub artifact attestation",
            "verification_command": f"gh attestation verify <artifact> --repo {args.repository}",
        },
        "interpretation": "Release build and verification evidence; not regulatory certification or independent approval.",
    }
    write_json(output / f"Perdura-{args.version}-release-verification.json", report)
    summary = {
        **ci_report,
        "report_kind": "release",
        "status": report["status"],
        "complete": report["complete"],
        "generated_at": report["generated_at"],
        "provenance": report["provenance"],
        "issues": issues,
        "raw_files": subjects,
    }
    (output / f"Perdura-{args.version}-release-verification.html").write_text(render_html(summary), encoding="utf-8")
    (output / "VERIFY.md").write_text(
        f"# Verify Perdura {args.version}\n\n"
        f"1. Check every file against `SHA256SUMS`.\n"
        f"2. Run `gh attestation verify <artifact> --repo {args.repository}` for each released binary and this evidence bundle.\n"
        "3. Review the CI and release verification reports before accepting the software.\n",
        encoding="utf-8",
    )
    write_checksums(output)
    archive_base = Path(args.archive)
    archive_base.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive_base, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for path in sorted(p for p in output.rglob("*") if p.is_file()):
            info = zipfile.ZipInfo(path.relative_to(output).as_posix(), date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            bundle.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    Path(str(archive_base) + ".sha256").write_text(f"{sha256(archive_base)}  {archive_base.name}\n", encoding="utf-8")
    print(f"Release evidence: {report['status']}; {len(subjects)} bound artifact(s).")
    return 0 if not issues else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    component = sub.add_parser("component", help="Write one CI component manifest")
    component.add_argument("--output", type=Path, required=True)
    component.add_argument("--id", required=True)
    component.add_argument("--label")
    component.add_argument("--kind", default="test")
    component.add_argument("--status", default="success")
    component.add_argument("--result", action="append", default=[])
    component.add_argument(
        "--optional-result", action="append", default=[],
        help="Record NAME=STATUS context without failing when it is unavailable",
    )
    component.add_argument("--file", action="append", default=[])
    component.set_defaults(func=component_command)

    compile_parser = sub.add_parser("compile", help="Compile a complete CI evidence report")
    compile_parser.add_argument("--input", action="append", required=True)
    compile_parser.add_argument("--output", required=True)
    compile_parser.add_argument("--expected", action="append", default=[])
    compile_parser.add_argument("--job-result", action="append", default=[])
    compile_parser.add_argument("--baseline")
    compile_parser.add_argument("--repository", default="")
    compile_parser.add_argument("--commit", default="")
    compile_parser.add_argument("--ref", default="")
    compile_parser.add_argument("--event", default="")
    compile_parser.add_argument("--version", default="")
    compile_parser.add_argument("--run-id", default="")
    compile_parser.add_argument("--run-attempt", default="")
    compile_parser.add_argument("--run-url", default="")
    compile_parser.add_argument("--github-summary")
    compile_parser.set_defaults(func=compile_command)

    gate = sub.add_parser("gate", help="Fail unless a report is a complete pass")
    gate.add_argument("--report", required=True)
    gate.set_defaults(func=gate_command)

    release = sub.add_parser("release", help="Bind CI evidence to release artifacts")
    release.add_argument("--ci-report", required=True)
    release.add_argument("--subject", action="append", default=[])
    release.add_argument("--output", required=True)
    release.add_argument("--archive", required=True)
    release.add_argument("--repository", required=True)
    release.add_argument("--commit", required=True)
    release.add_argument("--version", required=True)
    release.add_argument("--run-id", default="")
    release.add_argument("--run-url", default="")
    release.set_defaults(func=release_command)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
