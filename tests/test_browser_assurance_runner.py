"""Browser failures must retain evidence without hiding independent suites."""

import importlib.util
import json
import os
from pathlib import Path
import socket
import sys
import time
import xml.etree.ElementTree as ET

import pytest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("browser_runner", ROOT / "tools/run_browser_assurance.py")
RUNNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNNER)


def test_repository_registry_explicitly_covers_all_assurance_scripts():
    registry = RUNNER.load_registry(RUNNER.REGISTRY, RUNNER.FRONTEND / "package.json")
    assert set(registry["groups"]) == {"analysis", "system", "architecture", "workspace", "toolkit"}
    assert sum(map(len, registry["groups"].values())) == 38
    # This entry point is an intentional alias, not an untested orphan script.
    alias = (RUNNER.FRONTEND / "tests/structuredArchitectureBrowser.mjs").read_text()
    assert "import('./simplifiedFunctionsBrowser.mjs')" in alias


def fixture_registry(tmp_path, *, scripts=None):
    registry = {"schemaVersion": 1, "groups": {"sample": [
        {"script": "assurance:first", "timeoutSeconds": 10},
    ]}}
    registry_path = tmp_path / "registry.json"
    package_path = tmp_path / "package.json"
    registry_path.write_text(json.dumps(registry))
    package_path.write_text(json.dumps({"scripts": scripts or {"assurance:first": "node first.mjs"}}))
    return registry, registry_path, package_path


def test_new_assurance_script_cannot_silently_escape_ci(tmp_path):
    _, path, package = fixture_registry(tmp_path, scripts={
        "assurance:first": "node first.mjs", "assurance:unregistered": "node new.mjs",
    })
    with pytest.raises(ValueError, match="unregistered=.*assurance:unregistered"):
        RUNNER.load_registry(path, package)


@pytest.mark.parametrize("change,pattern", [
    (lambda r: r["groups"]["sample"].append(r["groups"]["sample"][0]), "duplicate"),
    (lambda r: r["groups"]["sample"][0].update(timeoutSeconds=0), "timeout"),
    (lambda r: r["groups"]["sample"][0].update(timeoutSeconds=True), "timeout"),
    (lambda r: r["groups"]["sample"][0].update(script="assurance:first; echo bad"), "Invalid"),
    (lambda r: r.update(aliases={"assurance:alias": "assurance:absent"}), "alias"),
])
def test_malformed_registry_fails_closed(tmp_path, change, pattern):
    registry, path, package = fixture_registry(tmp_path)
    change(registry)
    path.write_text(json.dumps(registry))
    with pytest.raises(ValueError, match=pattern):
        RUNNER.load_registry(path, package)


def test_unknown_group_fails_instead_of_passing_without_work(tmp_path):
    with pytest.raises(ValueError, match="Unknown"):
        RUNNER.run_group({"groups": {}}, "typo", tmp_path)


def test_failure_retains_logs_and_runs_the_remaining_suite(tmp_path, monkeypatch):
    summary = tmp_path / "summary.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    registry = {"groups": {"sample": [
        {"script": "assurance:first", "timeoutSeconds": 5},
        {"script": "assurance:second", "timeoutSeconds": 5},
    ]}}
    commands = []
    def execute(command, **kwargs):
        commands.append(command)
        failed = command[2] == "assurance:first"
        code = "import sys; print('diagnostic',file=sys.stderr); sys.exit(7)" if failed else "print('second suite ran')"
        return RUNNER.run_command([sys.executable, "-c", code], **kwargs)
    report = RUNNER.run_group(registry, "sample", tmp_path / "evidence", frontend=tmp_path, execute=execute)
    assert report["status"] == "failed"
    assert [s["status"] for s in report["suites"]] == ["failed", "passed"]
    assert report["suites"][0]["returncode"] == 7
    assert "diagnostic" in Path(report["suites"][0]["stderr"]).read_text()
    assert "second suite ran" in Path(report["suites"][1]["stdout"]).read_text()
    assert all(c[:2] == ["npm.cmd" if os.name == "nt" else "npm", "run"] for c in commands)
    assert all(c[3:5] == ["--", "--output-dir"] for c in commands)
    junit = ET.parse(tmp_path / "evidence/junit-browser-suites.xml")
    assert len(junit.findall(".//testcase")) == 2
    assert len(junit.findall(".//failure")) == 1
    assert "assurance:second | passed" in summary.read_text()


@pytest.mark.skipif(os.name != "posix", reason="CI process-group cleanup targets Linux runners")
def test_timeout_kills_child_listener_before_next_suite(tmp_path, monkeypatch):
    address = tmp_path / "port.txt"
    child = (
        "import signal,socket,time; from pathlib import Path; "
        "signal.signal(signal.SIGTERM,signal.SIG_IGN); "
        "s=socket.socket(); s.bind(('127.0.0.1',0)); s.listen(); "
        f"Path({str(address)!r}).write_text(str(s.getsockname()[1])); time.sleep(60)"
    )
    parent = f"import subprocess,sys,time; subprocess.Popen([sys.executable,'-c',{child!r}]); time.sleep(60)"
    original_popen = RUNNER.subprocess.Popen
    def ready_popen(*args, **kwargs):
        process = original_popen(*args, **kwargs)
        deadline = time.monotonic() + 10
        while not address.is_file():
            if process.poll() is not None or time.monotonic() >= deadline:
                RUNNER.terminate_process_group(process)
                pytest.fail(f"Child server did not become ready; parent returncode={process.returncode}")
            time.sleep(0.01)
        return process
    # Establish child readiness before the runner starts waiting on its timeout;
    # a busy CI host must not turn this cleanup test into a startup-speed test.
    monkeypatch.setattr(RUNNER.subprocess, "Popen", ready_popen)
    result = RUNNER.run_command([sys.executable, "-c", parent], cwd=tmp_path, env=dict(os.environ),
                                stdout_path=tmp_path / "stdout", stderr_path=tmp_path / "stderr",
                                timeout_seconds=1)
    assert result["status"] == "timed_out"
    assert address.is_file(), "the child must start before the timeout is tested"
    port = int(address.read_text())
    with socket.socket() as probe:
        probe.settimeout(1)
        assert probe.connect_ex(("127.0.0.1", port)) != 0, "timed-out suite left its child server listening"


def test_start_failure_is_recorded(tmp_path):
    result = RUNNER.run_command([str(tmp_path / "missing-command")], cwd=tmp_path, env=dict(os.environ),
                                stdout_path=tmp_path / "stdout", stderr_path=tmp_path / "stderr",
                                timeout_seconds=1)
    assert result["status"] == "failed"
    assert "Could not start" in result["detail"]


def test_interruption_preserves_unfinished_coverage(tmp_path):
    registry = {"groups": {"sample": [
        {"script": "assurance:first", "timeoutSeconds": 5},
        {"script": "assurance:second", "timeoutSeconds": 5},
    ]}}
    def interrupt(*_args, **_kwargs):
        raise KeyboardInterrupt
    with pytest.raises(KeyboardInterrupt):
        RUNNER.run_group(registry, "sample", tmp_path, execute=interrupt)
    report = json.loads((tmp_path / "browser-suites.json").read_text())
    assert report["status"] == "incomplete"
    assert len(report["expectedSuites"]) == 2
    assert [s["status"] for s in report["suites"]] == ["interrupted", "not_run"]
    assert len(ET.parse(tmp_path / "junit-browser-suites.xml").findall(".//failure")) == 2


def test_reusing_output_directory_cannot_reuse_previous_success_evidence(tmp_path):
    registry = {"groups": {"sample": [{"script": "assurance:first", "timeoutSeconds": 5}]}}
    def passed(command, **_kwargs):
        (Path(command[-1]) / "result.json").write_text('{"status":"passed"}')
        return {"status": "passed", "returncode": 0, "detail": "", "durationSeconds": 0}
    previous = RUNNER.run_group(registry, "sample", tmp_path, execute=passed)
    def failed(*_args, **_kwargs):
        return {"status": "failed", "returncode": 1, "detail": "failed before writing evidence", "durationSeconds": 0}
    current = RUNNER.run_group(registry, "sample", tmp_path, execute=failed)
    previous_dir = Path(previous["suites"][0]["output"])
    current_dir = Path(current["suites"][0]["output"])
    assert previous_dir != current_dir
    assert (previous_dir / "result.json").exists()
    assert not (current_dir / "result.json").exists()
    assert json.loads((tmp_path / "browser-suites.json").read_text())["status"] == "failed"
    assert str(previous_dir) not in (tmp_path / "browser-suites.json").read_text()
