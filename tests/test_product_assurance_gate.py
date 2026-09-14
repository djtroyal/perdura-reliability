import importlib.util
import json
from pathlib import Path
import subprocess
import sys

import pytest
import yaml


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "product_assurance_gate", ROOT / "tools" / "product_assurance_gate.py",
)
assert SPEC and SPEC.loader
GATE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GATE)


def _needs(run="true"):
    return {
        "scope": {"result": "success", "outputs": {"run_assurance": run}},
        **{
            name: {"result": "success" if run == "true" else "skipped"}
            for name in GATE.ASSURANCE_JOBS
        },
    }


@pytest.mark.parametrize("paths,expected", [
    (["README.md", "docs/methodology/example.md"], True),
    (["docs/assurance/policy.md"], False),
    (["SECURITY.md"], False),
    (["README.md", "gui/backend/main.py"], False),
    ([".github/workflows/product-assurance.yml"], False),
    (["tools/new-tool.py"], False),
    (["new-root-file"], False),
    ([], False),
])
def test_documentation_scope_is_conservative(paths, expected):
    assert GATE.documentation_only(paths) is expected


def test_renaming_source_into_documentation_still_runs_assurance(monkeypatch):
    def diff(command, **kwargs):
        assert command == [
            "git", "diff", "--no-renames", "--name-only", "-z",
            f"{'a' * 40}...{'b' * 40}",
        ]
        return subprocess.CompletedProcess(command, 0, b"src/code.py\0docs/code.md\0")

    monkeypatch.setattr(GATE.subprocess, "run", diff)
    assert not GATE.documentation_only(GATE.changed_paths("a" * 40, "b" * 40))


def test_scope_failure_is_not_treated_as_documentation(monkeypatch):
    def failed_diff(*args, **kwargs):
        raise subprocess.CalledProcessError(128, "git")

    monkeypatch.setattr(GATE.subprocess, "run", failed_diff)
    with pytest.raises(subprocess.CalledProcessError):
        GATE.changed_paths("a" * 40, "b" * 40)
    with pytest.raises(ValueError):
        GATE.changed_paths("--help", "b" * 40)


def test_all_checks_pass_on_internal_pull_request():
    assert GATE.evaluate_jobs(_needs(), "pull_request", True)[0]


def test_documentation_skip_is_explicit_and_only_allowed_on_pull_requests():
    passed, detail = GATE.evaluate_jobs(_needs("false"), "pull_request", True)
    assert passed
    assert "Documentation-only" in detail
    assert not GATE.evaluate_jobs(_needs("false"), "schedule", True)[0]
    assert not GATE.evaluate_jobs(_needs("false"), "workflow_dispatch", True)[0]


@pytest.mark.parametrize("event", ["schedule", "workflow_dispatch"])
def test_full_runs_allow_only_dependency_review_skip(event):
    needs = _needs()
    needs["dependency-review"]["result"] = "skipped"
    assert GATE.evaluate_jobs(needs, event, True)[0]
    needs["osv"]["result"] = "skipped"
    assert not GATE.evaluate_jobs(needs, event, True)[0]


def test_fork_pull_request_allows_only_scorecard_skip():
    needs = _needs()
    needs["scorecard"]["result"] = "skipped"
    assert GATE.evaluate_jobs(needs, "pull_request", False)[0]
    assert not GATE.evaluate_jobs(needs, "pull_request", True)[0]
    needs["dependency-review"]["result"] = "skipped"
    assert not GATE.evaluate_jobs(needs, "pull_request", False)[0]


@pytest.mark.parametrize("job", GATE.ASSURANCE_JOBS)
@pytest.mark.parametrize("result", ["failure", "cancelled", "skipped", None])
def test_failed_cancelled_or_missing_required_check_blocks_gate(job, result):
    needs = _needs()
    needs[job]["result"] = result
    assert not GATE.evaluate_jobs(needs, "pull_request", True)[0]


@pytest.mark.parametrize("scope", [
    {"result": "failure"},
    {"result": "cancelled"},
    {"result": "skipped"},
    {"result": "success", "outputs": {}},
    {"result": "success", "outputs": {"run_assurance": "unexpected"}},
])
def test_scope_must_succeed_with_a_valid_decision(scope):
    needs = _needs()
    needs["scope"] = scope
    assert not GATE.evaluate_jobs(needs, "pull_request", True)[0]


def test_omitting_a_job_or_receiving_an_unknown_job_blocks_gate():
    needs = _needs()
    del needs["osv"]
    assert not GATE.evaluate_jobs(needs, "pull_request", True)[0]
    needs = _needs()
    needs["new-check"] = {"result": "success"}
    assert not GATE.evaluate_jobs(needs, "pull_request", True)[0]


def test_cli_reports_failure_and_exits_nonzero(monkeypatch, tmp_path):
    needs = _needs()
    needs["container"]["result"] = "failure"
    summary = tmp_path / "summary.md"
    monkeypatch.setenv("GITHUB_EVENT_NAME", "pull_request")
    monkeypatch.setenv("ASSURANCE_NEEDS", json.dumps(needs))
    monkeypatch.setenv("SAME_REPOSITORY", "true")
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    monkeypatch.setattr(sys, "argv", ["product_assurance_gate.py", "check"])
    assert GATE.main() == 1
    assert "container: expected success, got failure" in summary.read_text()


def test_workflow_always_runs_the_aggregate_and_covers_every_assurance_job():
    workflow = yaml.load(
        (ROOT / ".github/workflows/product-assurance.yml").read_text(),
        Loader=yaml.BaseLoader,
    )
    assert "paths" not in workflow["on"]["pull_request"]
    assert "paths-ignore" not in workflow["on"]["pull_request"]
    jobs = workflow["jobs"]
    gate = jobs["assurance-gate"]
    assert gate["if"] == "always()"
    assert gate["name"] == "Product assurance gate"
    assert set(gate["needs"]) == set(jobs) - {"assurance-gate"}
    assert set(gate["needs"]) == {"scope", *GATE.ASSURANCE_JOBS}
    for name in GATE.ASSURANCE_JOBS:
        assert jobs[name]["needs"] == "scope"
        assert "needs.scope.outputs.run_assurance == 'true'" in jobs[name]["if"]
