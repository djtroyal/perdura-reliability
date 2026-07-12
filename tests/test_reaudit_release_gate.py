"""Executable release gates for the methodology re-audit reconciliation."""

import csv
import importlib.util
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
AUDIT = ROOT / "docs" / "audit"


def _rows(name):
    with (AUDIT / name).open(newline="", encoding="utf-8") as stream:
        return list(csv.DictReader(stream))


def test_reaudit_retains_every_original_finding_and_historical_severity():
    original = _rows("findings.csv")
    current = _rows("re-audit-findings.csv")
    original_by_id = {row["id"]: row for row in original}
    current_by_id = {row["id"]: row for row in current}

    assert len(original) == len(original_by_id) == 50
    assert set(original_by_id) <= set(current_by_id)
    assert len(current) == len(current_by_id)
    for finding_id, baseline in original_by_id.items():
        assert current_by_id[finding_id]["original_severity"] == baseline["severity"]


def test_reaudit_has_no_partial_open_or_residual_severity_rows():
    findings = _rows("re-audit-findings.csv")
    assert findings
    assert {row["status"] for row in findings} == {"Resolved"}
    assert all(not row["residual_severity"].strip() for row in findings)

    counts = {row["status"]: row for row in _rows("re-audit-status-counts.csv")}
    assert int(counts["Resolved"]["finding_count"]) == 50
    assert float(counts["Resolved"]["share"]) == 1.0
    assert int(counts["Partially resolved"]["finding_count"]) == 0
    assert int(counts["Unresolved"]["finding_count"]) == 0

    summary = _rows("re-audit-summary.csv")[0]
    assert int(summary["resolved_findings"]) == 50
    assert int(summary["partially_resolved_findings"]) == 0
    assert int(summary["unresolved_original_findings"]) == 0
    assert all(int(summary[field]) == 0 for field in (
        "current_critical_risks", "current_high_risks",
        "current_medium_risks", "current_low_risks",
        "current_root_warnings",
    ))


def test_closed_findings_retain_traceable_evidence_and_scope_disclosure():
    for row in _rows("re-audit-findings.csv"):
        references = [part.strip() for part in row["evidence"].split(";")
                      if part.strip()]
        assert references, f"{row['id']} has no evidence"
        assert any("tests/" in reference for reference in references), (
            f"{row['id']} has no executable test evidence")
        assert any(reference.startswith(("src/", "gui/backend/"))
                   for reference in references), (
            f"{row['id']} has no implementation evidence")
        for reference in references:
            evidence_path = reference.split("::", 1)[0]
            assert (ROOT / evidence_path).exists(), (
                f"{row['id']} references missing evidence {evidence_path}")
        assert row["residual_or_limitation"].strip(), (
            f"{row['id']} must retain an explicit residual/scope disclosure")


def test_reaudit_probe_harness_and_recorded_results_all_pass():
    os.environ.setdefault("MPLCONFIGDIR", "/tmp/matplotlib")
    probe_path = AUDIT / "re-audit-probes.py"
    spec = importlib.util.spec_from_file_location("reaudit_probes", probe_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    fresh = module.run()
    recorded = _rows("re-audit-probe-results.csv")

    assert fresh and recorded
    assert all(row["result"] == "pass" for row in fresh)
    assert all(row["result"] == "pass" for row in recorded)
    assert {(row["finding"], row["probe"]) for row in fresh} == {
        (row["finding"], row["probe"]) for row in recorded
    }
