"""Exercise the publication workflow's actual shell steps without GitHub access."""

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
import yaml


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = yaml.load(
    (ROOT / ".github/workflows/sync-website-resources.yml").read_text(encoding="utf-8"),
    Loader=yaml.BaseLoader,
)
ELIGIBILITY = WORKFLOW["jobs"]["eligibility"]
SYNC = WORKFLOW["jobs"]["sync"]
STEPS = SYNC["steps"]
ELIGIBILITY_SOURCE = next(step for step in ELIGIBILITY["steps"] if step.get("id") == "source")
SOURCE = next(step for step in STEPS if step.get("id") == "source")
PUBLICATION_SOURCE = next(step for step in STEPS if step.get("id") == "publication")
SOURCE_GUARDS = [
    pytest.param(ELIGIBILITY_SOURCE, id="before-queue"),
    pytest.param(SOURCE, id="after-queue"),
    pytest.param(PUBLICATION_SOURCE, id="before-pr-update"),
]
CONFIGURATION = next(step for step in STEPS if step.get("id") == "configured")
SUMMARY = next(step for step in STEPS if step["name"] == "Report screenshot publication status")
VERIFIER_CHECKOUT = next(step for step in STEPS if step.get("with", {}).get("path") == "source")
VERIFY_BUNDLE = next(step for step in STEPS if step["name"] == "Verify bundle source, inventory, and image hashes")
SOURCE_COMMIT = "a" * 40
PR_URL = "https://github.com/example/website/pull/14"
SOURCE_RUN_URL = "https://github.com/example/app/actions/runs/123"


@pytest.fixture
def shell_environment(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    # The summary step invokes `python`; use the running test interpreter.
    (bin_dir / "python").symlink_to(sys.executable)
    gh = bin_dir / "gh"
    gh.write_text(
        "#!/bin/bash\n"
        "printf '%s\\n' \"$@\" > \"$FAKE_GH_ARGUMENTS\"\n"
        "if [ \"${FAKE_GH_EXIT_CODE:-0}\" != 0 ]; then\n"
        "  echo 'simulated GitHub API failure' >&2\n"
        "  exit \"$FAKE_GH_EXIT_CODE\"\n"
        "fi\n"
        "printf '%s\\n' \"$FAKE_GH_COMMIT\"\n",
        encoding="utf-8",
    )
    gh.chmod(0o755)
    return {
        "PATH": f"{bin_dir}{os.pathsep}{os.defpath}",
        "LANG": "C.UTF-8",
        "GH_TOKEN": "test-token",
        "GITHUB_REPOSITORY": "example/app",
        "GITHUB_OUTPUT": str(tmp_path / "outputs"),
        "GITHUB_STEP_SUMMARY": str(tmp_path / "summary.md"),
        "FAKE_GH_ARGUMENTS": str(tmp_path / "gh-arguments"),
        "FAKE_GH_COMMIT": SOURCE_COMMIT,
        "SOURCE_COMMIT": SOURCE_COMMIT,
        "SOURCE_RUN_URL": SOURCE_RUN_URL,
        "APP_CLIENT_ID": "",
        "APP_PRIVATE_KEY": "",
    }


def run_step(step, tmp_path, environment, **overrides):
    # GitHub's bash runner enables errexit and pipefail. Keep those semantics
    # so a failed API request cannot quietly look like a superseded source.
    return subprocess.run(
        ["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", step["run"]],
        cwd=tmp_path,
        env={**environment, **overrides},
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )


def test_verifier_code_is_trusted_main_and_payload_only_identifies_bundle_data():
    assert VERIFIER_CHECKOUT["uses"].startswith("actions/checkout@")
    assert VERIFIER_CHECKOUT["with"]["ref"] == "refs/heads/main"
    assert VERIFIER_CHECKOUT["with"]["persist-credentials"] == "false"
    assert VERIFIER_CHECKOUT["with"].get("repository", "${{ github.repository }}") == "${{ github.repository }}"
    assert VERIFIER_CHECKOUT["if"] == VERIFY_BUNDLE["if"] == "steps.configured.outputs.enabled == 'true'"
    assert VERIFY_BUNDLE["env"]["SOURCE_COMMIT"] == "${{ github.event.workflow_run.head_sha }}"
    app_token = next(step for step in STEPS if step.get("id") == "app-token")
    assert STEPS.index(SOURCE) < STEPS.index(VERIFIER_CHECKOUT) < STEPS.index(VERIFY_BUNDLE)
    assert STEPS.index(VERIFY_BUNDLE) < STEPS.index(app_token) < STEPS.index(PUBLICATION_SOURCE)


@pytest.mark.parametrize("mutation,error", [
    (None, None),
    ("wrong-source", "source commit"),
    ("changed-image", "Checksum mismatch"),
    ("unlisted-image", "manifest inventory"),
])
def test_workflow_verifier_enforces_bundle_identity_and_integrity(
    tmp_path, shell_environment, mutation, error,
):
    # Model the trusted checkout separately from the downloaded artifact, then
    # execute the workflow's actual verifier command with a real minimal bundle.
    (tmp_path / "source").symlink_to(ROOT, target_is_directory=True)
    generated = tmp_path / "generated-resources"
    images = generated / "screenshots"
    images.mkdir(parents=True)
    image = b"\x89PNG\r\n\x1a\nfixture"
    (images / "example.png").write_bytes(image)
    (generated / "screenshots.generated.json").write_text(json.dumps({
        "schema": "perdura.website-resources/v1", "captures": [{
            "id": "example", "file": "example.png", "sizeBytes": len(image),
            "sha256": hashlib.sha256(image).hexdigest(),
        }],
    }), encoding="utf-8")
    (generated / "build-provenance.json").write_text(json.dumps({
        "schema": "perdura.website-resource-build/v1", "captures": 1,
        "sourceCommit": "b" * 40 if mutation == "wrong-source" else SOURCE_COMMIT,
    }), encoding="utf-8")
    (generated / "diff-report.json").write_text('{"differences": []}', encoding="utf-8")
    (generated / "SHA256SUMS").write_text("".join(
        f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.relative_to(generated).as_posix()}\n"
        for path in sorted(generated.rglob("*")) if path.is_file()
    ), encoding="utf-8")
    if mutation == "changed-image":
        (images / "example.png").write_bytes(image + b"tampered")
    elif mutation == "unlisted-image":
        (images / "unlisted.png").write_bytes(image)

    result = run_step(VERIFY_BUNDLE, tmp_path, shell_environment)

    if error:
        assert result.returncode != 0
        assert error in result.stderr
    else:
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == f"Verified 1 screenshots from {SOURCE_COMMIT}"


@pytest.mark.parametrize("current_commit,expected", [
    (SOURCE_COMMIT, "true"),
    ("b" * 40, "false"),
])
@pytest.mark.parametrize("guard", SOURCE_GUARDS)
def test_only_current_main_source_can_synchronize(tmp_path, shell_environment, current_commit, expected, guard):
    result = run_step(guard, tmp_path, shell_environment, FAKE_GH_COMMIT=current_commit)

    assert result.returncode == 0, result.stderr
    assert (tmp_path / "outputs").read_text() == f"current={expected}\n"
    assert (tmp_path / "gh-arguments").read_text().splitlines() == [
        "api", "repos/example/app/git/ref/heads/main", "--jq", ".object.sha",
    ]
    assert ("supersedes" in result.stdout) is (expected == "false")


@pytest.mark.parametrize("guard", SOURCE_GUARDS)
def test_source_lookup_failure_does_not_report_successful_skip(tmp_path, shell_environment, guard):
    result = run_step(guard, tmp_path, shell_environment, FAKE_GH_EXIT_CODE="1")

    assert result.returncode != 0
    assert not (tmp_path / "outputs").exists()
    assert "supersedes" not in result.stdout


def test_superseded_eligibility_reports_why_sync_never_started(tmp_path, shell_environment):
    result = run_step(ELIGIBILITY_SOURCE, tmp_path, shell_environment, FAKE_GH_COMMIT="b" * 40)

    assert result.returncode == 0, result.stderr
    summary = (tmp_path / "summary.md").read_text()
    assert "Superseded source build" in summary
    assert "did not update the website PR" in summary
    assert SOURCE_COMMIT in summary
    assert SOURCE_RUN_URL in summary


@pytest.mark.parametrize("guard", [
    pytest.param(SOURCE, id="advanced-while-queued"),
    pytest.param(PUBLICATION_SOURCE, id="advanced-during-validation"),
])
def test_eligible_build_is_rejected_if_main_advances(tmp_path, shell_environment, guard):
    initial = run_step(ELIGIBILITY_SOURCE, tmp_path, shell_environment)
    assert initial.returncode == 0, initial.stderr
    assert (tmp_path / "outputs").read_text() == "current=true\n"

    recheck = run_step(guard, tmp_path, shell_environment, FAKE_GH_COMMIT="b" * 40)
    assert recheck.returncode == 0, recheck.stderr
    assert (tmp_path / "outputs").read_text().splitlines()[-1] == "current=false"


@pytest.mark.parametrize("client_id,private_key", [
    ("", ""), ("configured-client", ""), ("", "test-private-key"),
])
def test_missing_website_credentials_fail_the_job(tmp_path, shell_environment, client_id, private_key):
    result = run_step(
        CONFIGURATION, tmp_path, shell_environment,
        APP_CLIENT_ID=client_id, APP_PRIVATE_KEY=private_key,
    )

    assert result.returncode != 0
    assert (tmp_path / "outputs").read_text() == "enabled=false\n"
    assert "::error::" in result.stdout
    assert "PERDURA_WEBSITE_APP_CLIENT_ID" in result.stdout
    assert "PERDURA_WEBSITE_APP_PRIVATE_KEY" in result.stdout
    assert "test-private-key" not in result.stdout + result.stderr


def test_configured_website_credentials_enable_sync_without_disclosure(tmp_path, shell_environment):
    result = run_step(
        CONFIGURATION, tmp_path, shell_environment,
        APP_CLIENT_ID="configured-client", APP_PRIVATE_KEY="test-private-key",
    )

    assert result.returncode == 0, result.stderr
    assert (tmp_path / "outputs").read_text() == "enabled=true\n"
    assert "test-private-key" not in result.stdout + result.stderr


@pytest.mark.parametrize("current,status,pr_url,expected", [
    ("true", "success", PR_URL, "Publication pending merge and deployment"),
    ("false", "success", "", "Superseded source build"),
    ("false", "success", PR_URL, "Superseded source build"),
    ("true", "failure", PR_URL, "Synchronization failed"),
    ("false", "failure", "", "Synchronization failed"),
    ("true", "cancelled", PR_URL, "Synchronization failed"),
    ("true", "success", "", "No resource changes to propose"),
])
def test_publication_summary_distinguishes_pending_skipped_failed_and_unchanged(
    tmp_path, shell_environment, current, status, pr_url, expected,
):
    result = run_step(
        SUMMARY, tmp_path, shell_environment,
        SOURCE_CURRENT=current, SYNC_STATUS=status, PR_URL=pr_url,
    )

    assert result.returncode == 0, result.stderr
    summary = (tmp_path / "summary.md").read_text()
    outcomes = [
        "Publication pending merge and deployment", "Superseded source build",
        "Synchronization failed", "No resource changes to propose",
    ]
    assert [outcome for outcome in outcomes if outcome in summary] == [expected]
    assert SOURCE_COMMIT in summary
    assert f"[Source CI run]({SOURCE_RUN_URL})" in summary
    assert (PR_URL in summary) is (expected == "Publication pending merge and deployment")


def test_publication_summary_includes_generated_bundle_identity(tmp_path, shell_environment):
    generated = tmp_path / "generated-resources"
    generated.mkdir()
    (generated / "build-provenance.json").write_text(json.dumps({
        "generatedAt": "2026-11-12T20:11:00Z", "captures": 89,
    }), encoding="utf-8")

    result = run_step(
        SUMMARY, tmp_path, shell_environment,
        SOURCE_CURRENT="true", SYNC_STATUS="success", PR_URL=PR_URL,
    )

    assert result.returncode == 0, result.stderr
    summary = (tmp_path / "summary.md").read_text()
    assert "Generated: 2026-11-12T20:11:00Z" in summary
    assert "Screenshots: 89" in summary


@pytest.mark.parametrize("provenance_kind", ["malformed-json", "unreadable-file"])
def test_invalid_provenance_does_not_hide_the_sync_failure(tmp_path, shell_environment, provenance_kind):
    generated = tmp_path / "generated-resources"
    generated.mkdir()
    provenance = generated / "build-provenance.json"
    if provenance_kind == "malformed-json":
        provenance.write_text('{"generatedAt":', encoding="utf-8")
    else:
        provenance.mkdir()

    result = run_step(
        SUMMARY, tmp_path, shell_environment,
        SOURCE_CURRENT="true", SYNC_STATUS="failure", PR_URL="",
    )

    assert result.returncode == 0, result.stderr
    summary = (tmp_path / "summary.md").read_text()
    assert "Synchronization failed" in summary
    assert SOURCE_COMMIT in summary
    assert SOURCE_RUN_URL in summary


def test_status_steps_are_bound_to_the_actual_workflow_results():
    assert CONFIGURATION["if"] == "steps.source.outputs.current == 'true'"
    assert SUMMARY["if"] == "always()"
    assert SUMMARY["env"]["SOURCE_CURRENT"] == "${{ steps.publication.outputs.current || steps.source.outputs.current }}"
    assert SUMMARY["env"]["SYNC_STATUS"] == "${{ job.status }}"
    pr_step = next(step for step in STEPS if step.get("id") == "resource-pr")
    assert pr_step["uses"].startswith("peter-evans/create-pull-request@")
    assert pr_step["if"] == "steps.configured.outputs.enabled == 'true' && steps.publication.outputs.current == 'true'"
    assert STEPS.index(PUBLICATION_SOURCE) == STEPS.index(pr_step) - 1
    assert SUMMARY["env"]["PR_URL"] == "${{ steps.resource-pr.outputs.pull-request-url }}"


def test_superseded_builds_cannot_displace_current_syncs_in_the_concurrency_queue():
    # GitHub cancels an older pending job even with cancel-in-progress=false.
    # Reject stale completions before they can enter that concurrency group.
    assert "concurrency" not in WORKFLOW
    assert "concurrency" not in ELIGIBILITY
    assert ELIGIBILITY["if"] == "github.event.workflow_run.conclusion == 'success'"
    assert ELIGIBILITY["outputs"]["current"] == "${{ steps.source.outputs.current }}"
    assert SYNC["needs"] == "eligibility"
    assert SYNC["if"] == "needs.eligibility.outputs.current == 'true'"
    assert SYNC["concurrency"] == {
        "group": "perdura-website-resources", "cancel-in-progress": "false",
    }
