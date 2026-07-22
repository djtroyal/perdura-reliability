"""Contracts for the fail-closed build-verification evidence compiler."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import zipfile


SCRIPT = Path(__file__).resolve().parents[1] / "tools" / "build_verification_evidence.py"
SPEC = importlib.util.spec_from_file_location("build_verification_evidence", SCRIPT)
assert SPEC and SPEC.loader
evidence = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(evidence)


def _junit(path: Path, *, failed: bool = False) -> None:
    failure = '<failure message="token=ghp_abcdefghijklmnopqrstuvwxyz">trace</failure>' if failed else ""
    path.write_text(
        '<testsuites tests="2"><testsuite name="library" tests="2">'
        f'<testcase classname="math" name="identity" time="0.2">{failure}</testcase>'
        '<testcase classname="math" name="boundary" time="0.1" />'
        '</testsuite></testsuites>',
        encoding="utf-8",
    )


def _coverage(path: Path) -> None:
    path.write_text(json.dumps({
        "totals": {
            "covered_lines": 80, "num_statements": 100,
            "missing_lines": 20, "percent_covered": 78.0,
            "percent_statements_covered": 80.0,
            "covered_branches": 30, "num_branches": 40,
            "missing_branches": 10,
        },
        "files": {"src/reliability/example.py": {"summary": {"percent_covered": 80.0}}},
    }), encoding="utf-8")


def _component(root: Path, component_id: str, status: str = "success") -> None:
    code = evidence.main([
        "component", "--output", str(root / f"component-{component_id}.json"),
        "--id", component_id, "--kind", "test", "--status", status,
    ])
    assert code == 0


def _compile(source: Path, output: Path, *expected: str, baseline: Path | None = None) -> dict:
    args = [
        "compile", "--input", str(source), "--output", str(output),
        "--repository", "example/perdura", "--commit", "a" * 40,
        "--version", "0.6.0",
        "--run-id", "42", "--run-url", "https://github.test/runs/42",
    ]
    for component_id in expected:
        args.extend(["--expected", component_id])
    if baseline is not None:
        args.extend(["--baseline", str(baseline)])
    assert evidence.main(args) == 0
    return json.loads((output / "verification-report.json").read_text(encoding="utf-8"))


def test_complete_evidence_compiles_to_human_and_machine_reports(tmp_path: Path):
    source = tmp_path / "source"
    source.mkdir()
    _component(source, "python-3.11")
    _junit(source / "junit-library.xml")
    _coverage(source / "coverage.json")
    (source / "library.log").write_text(
        "tests/test_math.py:12: RuntimeWarning: numerical boundary reached\n",
        encoding="utf-8",
    )

    output = tmp_path / "report"
    report = _compile(source, output, "python-3.11")

    assert report["schema"] == evidence.SCHEMA
    assert report["status"] == "passed"
    assert report["complete"] is True
    assert report["tests"]["totals"] == {
        "total": 2, "passed": 2, "failed": 0, "skipped": 0,
        "duration_seconds": 0.30000000000000004,
    }
    assert report["coverage"]["branch_percent"] == 75.0
    assert report["coverage"]["line_percent"] == 80.0
    assert report["coverage"]["combined_percent"] == 78.0
    assert report["warnings"][0]["category"] == "RuntimeWarning"
    assert (output / "verification-report.html").is_file()
    assert (output / "verification-report.md").is_file()
    assert (output / "build-verification.schema.json").is_file()
    checksums = (output / "SHA256SUMS").read_text(encoding="utf-8")
    assert "verification-report.json" in checksums
    assert evidence.main(["gate", "--report", str(output / "verification-report.json")]) == 0


def test_failure_remains_failed_but_report_is_published_and_redacted(tmp_path: Path):
    source = tmp_path / "source"
    source.mkdir()
    _component(source, "python-3.11", "failure")
    _junit(source / "junit-library.xml", failed=True)
    _coverage(source / "coverage.json")

    output = tmp_path / "report"
    report = _compile(source, output, "python-3.11")

    assert report["status"] == "failed"
    assert report["tests"]["totals"]["failed"] == 1
    assert "ghp_" not in json.dumps(report)
    assert "[REDACTED" in json.dumps(report)
    assert evidence.main(["gate", "--report", str(output / "verification-report.json")]) == 1


def test_missing_expected_evidence_is_incomplete_not_passed(tmp_path: Path):
    source = tmp_path / "source"
    source.mkdir()
    _junit(source / "junit-library.xml")
    _coverage(source / "coverage.json")

    report = _compile(source, tmp_path / "report", "frontend")

    assert report["status"] == "incomplete"
    assert report["complete"] is False
    assert any("Expected evidence component is missing: frontend" in item for item in report["issues"])


def test_missing_declared_component_file_is_incomplete(tmp_path: Path):
    manifest = tmp_path / "component-python.json"
    assert evidence.main([
        "component", "--output", str(manifest), "--id", "python-3.11",
        "--status", "success", "--file", f"junit={tmp_path / 'missing.xml'}",
    ]) == 0

    component = json.loads(manifest.read_text(encoding="utf-8"))
    assert component["status"] == "incomplete"
    assert component["files"][0]["exists"] is False


def test_unavailable_optional_context_is_recorded_without_failing_component(
        tmp_path: Path):
    manifest = tmp_path / "component-website-resources.json"
    assert evidence.main([
        "component", "--output", str(manifest),
        "--id", "website-resources", "--kind", "generated-product-resource",
        "--optional-result", "baseline=failure",
        "--result", "generate=success",
    ]) == 0

    component = json.loads(manifest.read_text(encoding="utf-8"))
    assert component["status"] == "passed"
    assert component["results"] == [
        {"id": "baseline", "optional": True, "status": "skipped"},
        {"id": "generate", "optional": False, "status": "passed"},
    ]


def test_coverage_trend_and_workflow_timestamps_are_recorded(tmp_path: Path):
    source = tmp_path / "source"
    source.mkdir()
    _component(source, "python-3.11")
    _junit(source / "junit-library.xml")
    _coverage(source / "coverage.json")
    (source / "workflow-jobs.json").write_text(json.dumps({"jobs": [{
        "name": "Python 3.11", "runner_name": "GitHub Actions 7",
        "status": "completed", "conclusion": "success",
        "started_at": "2026-07-21T01:00:00Z",
        "completed_at": "2026-07-21T01:01:00Z",
        "steps": [{"name": "Test", "status": "completed", "conclusion": "success"}],
    }]}), encoding="utf-8")
    baseline = tmp_path / "baseline.json"
    baseline.write_text(json.dumps({
        "schema": evidence.SCHEMA,
        "coverage": {"line_percent": 79.0, "branch_percent": 73.0, "combined_percent": 76.5},
    }), encoding="utf-8")

    report = _compile(source, tmp_path / "report", "python-3.11", baseline=baseline)

    assert report["coverage"]["delta"] == {
        "line_percent": 1.0, "branch_percent": 2.0, "combined_percent": 1.5,
    }
    assert report["workflow_execution"][0]["conclusion"] == "success"
    assert report["workflow_execution"][0]["steps"][0]["name"] == "Test"


def test_release_bundle_binds_ci_report_platform_archives_and_manifests(tmp_path: Path):
    source = tmp_path / "source"
    source.mkdir()
    _component(source, "python-3.11")
    _junit(source / "junit-library.xml")
    _coverage(source / "coverage.json")
    lock = source / "uv.lock"
    lock.write_text("version = 1\n", encoding="utf-8")
    ci_dir = tmp_path / "ci"
    _compile(source, ci_dir, "python-3.11")

    subjects = []
    for target, suffix in [
        ("linux-x64", ".tar.gz"), ("windows-x64", ".zip"),
        ("macos-arm64", ".tar.gz"),
    ]:
        archive = tmp_path / f"Perdura-0.6.0-{target}{suffix}"
        archive.write_bytes(target.encode())
        manifest = tmp_path / f"Perdura-0.6.0-dependencies-{target}.json"
        manifest.write_text(json.dumps({
            "schema_version": 1, "target": target, "python": "3.11.15",
            "uv_lock_sha256": evidence.sha256(lock),
        }), encoding="utf-8")
        subjects.extend([archive, manifest])
    crow = tmp_path / "Perdura-0.6.0-crow-amsaa-validation.json"
    crow.write_text(json.dumps({
        "tool": "crow_amsaa_validation", "profile": "release",
        "passed": True, "certification_eligible": True,
        "provenance": {"git_sha": "a" * 40},
    }), encoding="utf-8")
    subjects.append(crow)
    archive = tmp_path / "release-evidence.zip"
    args = [
        "release", "--ci-report", str(ci_dir / "verification-report.json"),
        "--output", str(tmp_path / "release"), "--archive", str(archive),
        "--repository", "example/perdura", "--commit", "a" * 40,
        "--version", "0.6.0",
    ]
    for subject in subjects:
        args.extend(["--subject", str(subject)])

    assert evidence.main(args) == 0
    assert archive.is_file()
    assert Path(str(archive) + ".sha256").is_file()
    with zipfile.ZipFile(archive) as bundle:
        names = set(bundle.namelist())
    assert "Perdura-0.6.0-release-verification.json" in names
    assert "ci-evidence/verification-report.json" in names
    assert "release-artifacts/Perdura-0.6.0-dependencies-linux-x64.json" in names
    assert "release-artifacts/Perdura-0.6.0-linux-x64.tar.gz" not in names


def test_incomplete_release_attempt_still_publishes_evidence(tmp_path: Path):
    source = tmp_path / "source"
    source.mkdir()
    _component(source, "python-3.11")
    _junit(source / "junit-library.xml")
    _coverage(source / "coverage.json")
    (source / "uv.lock").write_text("version = 1\n", encoding="utf-8")
    ci_dir = tmp_path / "ci"
    _compile(source, ci_dir, "python-3.11")

    archive = tmp_path / "incomplete-release-evidence.zip"
    code = evidence.main([
        "release", "--ci-report", str(ci_dir / "verification-report.json"),
        "--output", str(tmp_path / "release"), "--archive", str(archive),
        "--repository", "example/perdura", "--commit", "a" * 40,
        "--version", "0.6.0",
    ])

    assert code == 1
    assert archive.is_file()
    report = json.loads(
        (tmp_path / "release" / "Perdura-0.6.0-release-verification.json")
        .read_text(encoding="utf-8")
    )
    assert report["status"] == "incomplete"
    assert report["complete"] is False
    assert any("Release archives cover" in issue for issue in report["issues"])
