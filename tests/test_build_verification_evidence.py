"""Contracts for the fail-closed build-verification evidence compiler."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import zipfile
import pytest


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


def _compile(source: Path, output: Path, *expected: str, baseline: Path | None = None,
             extra_args: tuple[str, ...] = ()) -> dict:
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
    args.extend(extra_args)
    assert evidence.main(args) == 0
    return json.loads((output / "verification-report.json").read_text(encoding="utf-8"))


def _attempt_artifact(source, component_id, attempt, *, status="passed", tests=False):
    root = source / f"Perdura-CI-raw-{component_id}-42-{attempt}"
    root.mkdir(parents=True)
    manifest = root / f"component-{component_id}.json"
    manifest.write_text(json.dumps({
        "schema": evidence.COMPONENT_SCHEMA, "component_id": component_id,
        "label": component_id, "kind": "test", "status": status,
        "generated_at": f"2026-01-01T00:0{attempt}:30Z",
        "provenance": {"repository": "example/perdura", "commit": "a" * 40,
                       "run_id": "42", "run_attempt": str(attempt), "job_name": component_id},
    }), encoding="utf-8")
    if tests:
        _junit(root / "junit-tests.xml", failed=status == "failed")
        _coverage(root / "coverage.json")
    return root


def _workflow_job(component_id, attempt, *, outcome="success", execution_attempt=None):
    execution = execution_attempt or attempt
    return {"id": attempt * 1000, "name": component_id, "run_id": 42,
            "run_attempt": attempt, "status": "completed", "conclusion": outcome,
            "started_at": f"2026-01-01T00:0{execution}:00Z",
            "completed_at": f"2026-01-01T00:0{execution}:59Z", "steps": []}


def _compile_attempts(source, output, jobs, *expected, job_results=()):
    (source / "workflow-jobs.json").write_text(json.dumps({"jobs": jobs}), encoding="utf-8")
    return _compile(source, output, *expected, extra_args=(
        "--select-latest-attempts", "--run-attempt", "2", *job_results))


def test_selective_rerun_combines_unchanged_and_rerun_components(tmp_path):
    source = tmp_path / "source"
    _attempt_artifact(source, "python-3.13", 1, tests=True)
    _attempt_artifact(source, "macos-arm64", 2)
    report = _compile_attempts(source, tmp_path / "report", [
        _workflow_job("python-3.13", 1),
        # GitHub copies a successful job into attempt 2 without executing it.
        _workflow_job("python-3.13", 2, execution_attempt=1),
        _workflow_job("macos-arm64", 1, outcome="cancelled"),
        _workflow_job("macos-arm64", 2),
    ], "python-3.13", "macos-arm64")
    assert report["status"] == "passed"
    assert report["tests"]["totals"]["total"] == 2
    assert {item["component_id"]: item["run_attempt"] for item in
            report["artifact_selection"]["selected"]} == {"python-3.13": 1, "macos-arm64": 2}


@pytest.mark.parametrize("ambiguous", [False, True])
def test_reusable_workflow_job_prefixes_must_identify_one_caller(tmp_path, ambiguous):
    source = tmp_path / "source"
    _attempt_artifact(source, "python-3.13", 2, tests=True)
    jobs = [{**_workflow_job("python-3.13", 2), "name": "test / python-3.13"}]
    if ambiguous:
        jobs.append({**jobs[0], "name": "other / python-3.13", "id": 2001})
    report = _compile_attempts(source, tmp_path / "report", jobs, "python-3.13")
    assert report["status"] == ("incomplete" if ambiguous else "passed")


@pytest.mark.parametrize("old_status,new_status", [("failed", "passed"), ("passed", "failed")])
def test_latest_whole_artifact_replaces_old_results_without_double_counting(tmp_path, old_status, new_status):
    source = tmp_path / "source"
    old = _attempt_artifact(source, "python-3.13", 1, status=old_status, tests=True)
    _attempt_artifact(source, "python-3.13", 2, status=new_status, tests=True)
    output = tmp_path / "report"
    report = _compile_attempts(source, output, [
        _workflow_job("python-3.13", 1, outcome="failure" if old_status == "failed" else "success"),
        _workflow_job("python-3.13", 2, outcome="failure" if new_status == "failed" else "success"),
    ], "python-3.13")
    assert report["status"] == new_status
    assert report["tests"]["totals"]["total"] == 2
    assert report["tests"]["totals"]["failed"] == (1 if new_status == "failed" else 0)
    assert report["artifact_selection"]["superseded"] == [old.name]
    assert (output / "raw" / "input-1" / old.name / "junit-tests.xml").is_file()


@pytest.mark.parametrize("outcome,status", [("failure", "failed"), ("cancelled", "incomplete"), ("success", "incomplete")])
def test_missing_rerun_artifact_never_reuses_an_older_pass(tmp_path, outcome, status):
    source = tmp_path / "source"
    _attempt_artifact(source, "python-3.13", 1, tests=True)
    report = _compile_attempts(source, tmp_path / "report", [
        _workflow_job("python-3.13", 1), _workflow_job("python-3.13", 2, outcome=outcome),
    ], "python-3.13")
    assert report["status"] == status
    assert any("predates the latest execution" in issue for issue in report["issues"])


@pytest.mark.parametrize("malformed", [False, True, "array", "missing-id", "invalid-status", "invalid-provenance"])
def test_empty_or_malformed_latest_artifact_does_not_fall_back(tmp_path, malformed):
    source = tmp_path / "source"
    _attempt_artifact(source, "python-3.13", 1, tests=True)
    latest = source / "Perdura-CI-raw-python-3.13-42-2"
    latest.mkdir()
    if malformed:
        payload = {
            True: "{invalid",
            "array": "[]",
            "missing-id": json.dumps({"schema": evidence.COMPONENT_SCHEMA, "status": "passed"}),
            "invalid-status": json.dumps({"schema": evidence.COMPONENT_SCHEMA,
                                          "component_id": "python-3.13", "status": {}}),
            "invalid-provenance": json.dumps({"schema": evidence.COMPONENT_SCHEMA,
                                              "component_id": "python-3.13", "status": "passed",
                                              "provenance": []}),
        }[malformed]
        (latest / "component-python.json").write_text(payload, encoding="utf-8")
    report = _compile_attempts(source, tmp_path / "report", [
        _workflow_job("python-3.13", 2, outcome="failure"),
    ], "python-3.13", job_results=("--job-result", "python=failure"))
    assert report["status"] == "failed"
    assert report["complete"] is False
    assert report["tests"]["totals"]["total"] == 0
    assert any("Invalid current evidence" in issue for issue in report["issues"])


@pytest.mark.parametrize("field,value", [("commit", "b" * 40), ("run_id", "43"), ("repository", "other/repo"), ("run_attempt", "1")])
def test_current_artifact_provenance_must_match_its_run(tmp_path, field, value):
    source = tmp_path / "source"
    root = _attempt_artifact(source, "python-3.13", 2, tests=True)
    path = root / "component-python-3.13.json"
    manifest = json.loads(path.read_text())
    manifest["provenance"][field] = value
    path.write_text(json.dumps(manifest), encoding="utf-8")
    report = _compile_attempts(source, tmp_path / "report", [
        _workflow_job("python-3.13", 2),
    ], "python-3.13")
    assert report["status"] == "incomplete"
    assert any("does not match" in issue for issue in report["issues"])


def test_duplicate_current_attempt_artifacts_are_incomplete(tmp_path):
    source = tmp_path / "source"
    _attempt_artifact(source, "python-3.13", 2, tests=True)
    _attempt_artifact(source / "duplicate", "python-3.13", 2, tests=True)
    report = _compile_attempts(source, tmp_path / "report", [
        _workflow_job("python-3.13", 2),
    ], "python-3.13")
    assert report["status"] == "incomplete"
    assert any("Duplicate evidence artifacts" in issue for issue in report["issues"])


def test_workflow_failure_after_manifest_creation_still_fails_gate(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    _component(source, "frontend")
    _junit(source / "junit.xml")
    _coverage(source / "coverage.json")
    report = _compile(source, tmp_path / "report", "frontend",
                      extra_args=("--job-result", "frontend=failure"))
    assert report["status"] == "failed"


def test_component_records_github_provenance(monkeypatch, tmp_path):
    for key, value in {"GITHUB_REPOSITORY": "example/perdura", "GITHUB_SHA": "a" * 40,
                       "GITHUB_RUN_ID": "42", "GITHUB_RUN_ATTEMPT": "2", "GITHUB_JOB": "python"}.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setattr(evidence, "command_version", lambda _command: None)
    path = tmp_path / "component.json"
    assert evidence.main(["component", "--output", str(path), "--id", "python-3.13",
                          "--job-name", "python (3.13)"]) == 0
    assert json.loads(path.read_text())["provenance"] == {
        "repository": "example/perdura", "commit": "a" * 40, "run_id": "42",
        "run_attempt": "2", "job_name": "python (3.13)",
    }


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


def test_release_bundle_binds_supported_delivery_artifacts_and_manifests(tmp_path: Path):
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
    deliveries = [
        tmp_path / "Perdura-0.6.0-linux-x64.tar.gz",
        tmp_path / "perdura-0.6.0-py3-none-any.whl",
        tmp_path / "Perdura-0.6.0-application-constraints.txt",
    ]
    for delivery in deliveries:
        delivery.write_bytes(delivery.name.encode())
    subjects.extend(deliveries)
    for label in ("linux-x64", "python-wheel"):
        manifest = tmp_path / f"Perdura-0.6.0-dependencies-{label}.json"
        manifest.write_text(json.dumps({
            "schema_version": 1, "target": "linux-x64", "python": "3.13.14",
            "uv_lock_sha256": evidence.sha256(lock),
        }), encoding="utf-8")
        subjects.append(manifest)
    container = tmp_path / "Perdura-0.6.0-container.json"
    container.write_text(json.dumps({
        "schema": "perdura.container-release/v1",
        "image": "ghcr.io/example/perdura",
        "version": "0.6.0",
        "digest": f"sha256:{'b' * 64}",
        "platforms": ["linux/amd64", "linux/arm64"],
        "commit": "a" * 40,
    }), encoding="utf-8")
    subjects.append(container)
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
    assert "release-artifacts/Perdura-0.6.0-application-constraints.txt" in names
    assert "release-artifacts/Perdura-0.6.0-linux-x64.tar.gz" not in names
    assert "release-artifacts/perdura-0.6.0-py3-none-any.whl" not in names


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
    assert any("Release delivery set" in issue for issue in report["issues"])
