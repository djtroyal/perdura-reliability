#!/usr/bin/env python3
"""Validate Perdura's locally observable security-assurance controls.

This checker deliberately reports only controls that can be established from a
source checkout. Repository settings, deployed proxy behavior, vulnerability
scanner results, and independent assessment decisions remain separate evidence.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import platform
import re
import subprocess
import sys
from typing import Any
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = "perdura.product-assurance/v1"
PINNED_ACTION = re.compile(r"^[^\s@]+@[0-9a-f]{40}(?:\s+#.*)?$")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _git_commit() -> str:
    try:
        return subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True,
            capture_output=True, check=True, timeout=10,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return "unknown"


def _check(identifier: str, description: str, passed: bool, detail: str) -> dict[str, Any]:
    return {
        "id": identifier,
        "description": description,
        "status": "passed" if passed else "failed",
        "detail": detail,
    }


def _read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def _workflow_pin_check() -> tuple[bool, str]:
    failures: list[str] = []
    total = 0
    for path in sorted((ROOT / ".github" / "workflows").glob("*.yml")):
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            match = re.match(r"\s*(?:-\s*)?uses:\s*(\S+(?:\s+#.*)?)$", line)
            if not match:
                continue
            value = match.group(1)
            if value.startswith("./"):
                continue
            total += 1
            if not PINNED_ACTION.match(value):
                failures.append(f"{path.name}:{line_number} ({value.split()[0]})")
    detail = f"{total} external Action references inspected"
    if failures:
        detail += "; movable references: " + ", ".join(failures)
    return not failures, detail


def evaluate() -> dict[str, Any]:
    checks: list[dict[str, Any]] = []

    security = _read("SECURITY.md")
    checks.append(_check(
        "security-policy",
        "Private vulnerability-reporting and supported-release policy are documented.",
        all(term in security for term in (
            "Report a vulnerability", "two business days", "current stable Perdura release",
        )),
        "SECURITY.md contains the reporting channel, acknowledgement target, and latest-release policy.",
    ))

    asvs_path = ROOT / "docs" / "assurance" / "asvs-5.0-scope.json"
    try:
        asvs = json.loads(asvs_path.read_text(encoding="utf-8"))
        chapters = asvs["chapter_inventory"]
        level_12 = sum(int(item["level_1"]) + int(item["level_2"]) for item in chapters)
        asvs_valid = (
            asvs.get("schema") == "perdura.asvs-scope/v1"
            and asvs["standard"].get("version") == "5.0.0"
            and asvs["standard"].get("source_git_blob_sha") == "f7ae2926598c4648ff7614a6968e4c8fd89524bd"
            and len(chapters) == 17
            and level_12 == asvs["standard"].get("level_1_and_2_requirements") == 253
            and asvs["assessment"].get("independent_assessment_performed") is False
            and asvs["assessment"].get("conformance_claimed") is False
        )
        missing_evidence = sorted({
            path
            for item in asvs.get("automated_evidence", [])
            for path in item.get("evidence", [])
            if not (ROOT / path).is_file()
        })
        asvs_valid = asvs_valid and not missing_evidence
        asvs_detail = (
            f"OWASP ASVS 5.0.0 source blob fixed; 17 chapters and {level_12} Level 1/2 "
            "requirements inventoried; no conformance claim."
        )
        if missing_evidence:
            asvs_detail += " Missing evidence paths: " + ", ".join(missing_evidence)
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        asvs_valid = False
        asvs_detail = f"ASVS scope tracker is invalid: {exc}"
    checks.append(_check(
        "asvs-scope-integrity",
        "The ASVS 5.0 Level 2 assessment scope is versioned and does not overstate conformance.",
        asvs_valid,
        asvs_detail,
    ))

    ssdf_path = ROOT / "docs" / "assurance" / "nist-ssdf-mapping.json"
    try:
        ssdf = json.loads(ssdf_path.read_text(encoding="utf-8"))
        practices = ssdf.get("practices", [])
        missing_ssdf_evidence = sorted({
            path
            for item in practices
            for path in item.get("evidence", [])
            if not (ROOT / path).is_file()
        })
        ssdf_valid = (
            ssdf.get("schema") == "perdura.ssdf-mapping/v1"
            and ssdf.get("status") == "partial_alignment"
            and ssdf.get("conformance_claimed") is False
            and {item.get("id") for item in practices} == {"PO", "PS", "PW", "RV"}
            and all(item.get("remaining") for item in practices)
            and not missing_ssdf_evidence
        )
        ssdf_detail = "All four SSDF practice groups are mapped as partial/scoped alignment without a certification claim."
        if missing_ssdf_evidence:
            ssdf_detail += " Missing evidence paths: " + ", ".join(missing_ssdf_evidence)
    except (OSError, TypeError, ValueError, json.JSONDecodeError) as exc:
        ssdf_valid = False
        ssdf_detail = f"SSDF mapping is invalid: {exc}"
    checks.append(_check(
        "nist-ssdf-mapping",
        "Secure-development evidence is mapped to NIST SSDF 1.1 without overstating conformance.",
        ssdf_valid,
        ssdf_detail,
    ))

    accessibility_path = ROOT / "assurance" / "accessibility-baseline.json"
    try:
        accessibility = json.loads(accessibility_path.read_text(encoding="utf-8"))
        entries = accessibility.get("entries", [])
        entry_keys = [
            (item.get("module"), item.get("id"), item.get("impact"))
            for item in entries
        ]
        review_by = datetime.fromisoformat(accessibility["review_by"]).date()
        accessibility_valid = (
            accessibility.get("schema") == "perdura.accessibility-baseline/v1"
            and bool(accessibility.get("owner"))
            and bool(accessibility.get("policy"))
            and bool(accessibility.get("remediation"))
            and len(entry_keys) == len(set(entry_keys))
            and all(
                item.get("impact") in {"critical", "serious"}
                and isinstance(item.get("max_node_count"), int)
                and item["max_node_count"] > 0
                for item in entries
            )
            and review_by >= datetime.now(timezone.utc).date()
        )
        accessibility_detail = (
            f"{len(entries)} known finding signatures are ratcheted; review due {review_by.isoformat()}."
        )
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        accessibility_valid = False
        accessibility_detail = f"Accessibility baseline is invalid: {exc}"
    checks.append(_check(
        "accessibility-debt-ratchet",
        "Known serious/critical accessibility findings are explicit, bounded, and time-limited.",
        accessibility_valid,
        accessibility_detail,
    ))

    pinned, pin_detail = _workflow_pin_check()
    checks.append(_check(
        "immutable-actions",
        "Every external GitHub Action is pinned to a full commit SHA.",
        pinned,
        pin_detail,
    ))

    caddy = _read("deploy/Caddyfile")
    expected_headers = (
        "Strict-Transport-Security", "Content-Security-Policy",
        "X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy",
    )
    checks.append(_check(
        "proxy-security-headers",
        "The reference reverse proxy defines the browser security headers assessed by DAST.",
        all(header in caddy for header in expected_headers) and "max_size 100MB" in caddy,
        "Required reference-deployment headers: " + ", ".join(expected_headers)
        + "; request-body outer bound: 100 MB",
    ))

    zap_rules = _read("assurance/zap-rules.tsv")
    ignored_zap_rules = [
        line for line in zap_rules.splitlines()
        if line and not line.startswith("#") and "\tIGNORE\t" in line
    ]
    checks.append(_check(
        "zaproxy-suppressions",
        "Every ZAP suppression is narrow, reasoned, and time-limited.",
        bool(ignored_zap_rules)
        and all("Review by 2026-10-31." in line for line in ignored_zap_rules),
        f"{len(ignored_zap_rules)} explicit rule suppressions inspected; all require review by 2026-10-31.",
    ))

    dockerfile = _read("Dockerfile")
    compose = _read("docker-compose.yml")
    app_service = compose.split("\n  proxy:", 1)[0]
    checks.append(_check(
        "container-boundary",
        "The application container runs unprivileged and does not publish its unauthenticated port.",
        "USER perdura" in dockerfile
        and re.search(r"^\s{4}expose:\s*$", app_service, re.MULTILINE) is not None
        and re.search(r"^\s{4}ports:\s*$", app_service, re.MULTILINE) is None,
        "Dockerfile must set USER perdura; the app service may expose port 8000 only to the proxy network.",
    ))

    backend = _read("gui/backend/main.py")
    checks.append(_check(
        "generic-api-errors",
        "Unexpected API failures return a generic message and correlation identifier.",
        "Use the request ID when reporting this error" in backend
        and "logging.getLogger(\"perdura.api\").exception" in backend,
        "The exception is logged server-side while the response omits its internal text.",
    ))

    report_markdown = _read("gui/frontend/src/components/ReportBuilder/reportMarkdown.tsx")
    checks.append(_check(
        "safe-authored-links",
        "Authored-report links use an explicit safe-protocol transformation.",
        "SAFE_PROTOCOLS" in report_markdown and "safeMarkdownUrl" in report_markdown,
        "The report renderer rejects executable/unsafe link targets; the ASVS tracker records this as partial URL evidence.",
    ))

    passed = sum(item["status"] == "passed" for item in checks)
    failed = len(checks) - passed
    return {
        "schema": SCHEMA,
        "generated_at": _utc_now(),
        "status": "passed" if failed == 0 else "failed",
        "commit": _git_commit(),
        "environment": {
            "platform": platform.platform(),
            "python": platform.python_version(),
        },
        "summary": {"total": len(checks), "passed": passed, "failed": failed},
        "checks": checks,
        "external_evidence_not_evaluated": [
            "GitHub branch/ruleset protection and private-vulnerability-reporting settings",
            "GitHub secret scanning, push protection, and Dependabot security-update settings",
            "CodeQL, OSV, OpenSSF Scorecard, Trivy, and OWASP ZAP findings",
            "deployed TLS, authentication, authorization, throttling, and logging",
            "independent penetration testing and ASVS conformance",
        ],
        "interpretation": (
            "A pass establishes only the locally observable controls listed here. "
            "It is not a vulnerability-free, ASVS-conformant, or independently assessed claim."
        ),
    }


def _write_junit(path: Path, report: dict[str, Any]) -> None:
    suite = ET.Element(
        "testsuite",
        name="product-assurance",
        tests=str(report["summary"]["total"]),
        failures=str(report["summary"]["failed"]),
        errors="0",
        skipped="0",
    )
    for item in report["checks"]:
        case = ET.SubElement(suite, "testcase", classname="assurance", name=item["id"], time="0")
        if item["status"] == "failed":
            failure = ET.SubElement(case, "failure", message=item["description"])
            failure.text = item["detail"]
        output = ET.SubElement(case, "system-out")
        output.text = item["detail"]
    tree = ET.ElementTree(suite)
    ET.indent(tree, space="  ")
    path.parent.mkdir(parents=True, exist_ok=True)
    tree.write(path, encoding="utf-8", xml_declaration=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    parser.add_argument("--junit", type=Path)
    parser.add_argument("--no-gate", action="store_true", help="Report failures without a non-zero exit status.")
    args = parser.parse_args(argv)

    report = evaluate()
    rendered = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    if args.junit:
        _write_junit(args.junit, report)
    print(rendered, end="")
    return 0 if args.no_gate or report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
