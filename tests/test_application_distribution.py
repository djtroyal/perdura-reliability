"""Contracts for the supported local application and release channels."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tomllib

from perdura_app import cli


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "build_pypi_wheel", ROOT / "tools" / "build_pypi_wheel.py"
)
assert SPEC and SPEC.loader
WHEEL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WHEEL)


def test_cli_doctor_exposes_stable_runtime_identity(capsys):
    assert cli.main(["doctor", "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)

    assert payload["app"] == "Perdura"
    assert payload["version"]
    assert payload["distribution_channel"]
    assert payload["python"]
    assert payload["operating_system"]
    assert payload["architecture"]
    assert len(payload["runtime_environment_sha256"]) == 64
    assert isinstance(payload["packages"], list)


def test_release_wheel_metadata_keeps_exact_application_requirements():
    requirements = [
        "fastapi==0.139.2",
        'onnxruntime==1.27.0 ; sys_platform == "linux"',
    ]
    staged = tomllib.loads(WHEEL._staged_pyproject("9.8.7", requirements))

    assert staged["project"]["name"] == "perdura"
    assert staged["project"]["version"] == "9.8.7"
    assert staged["project"]["optional-dependencies"]["app"] == requirements
    assert staged["project"]["scripts"]["perdura"] == "perdura_app.cli:main"
    assert staged["tool"]["setuptools"]["package-dir"]["perdura_app.backend"] == "gui/backend"


def test_release_channels_do_not_publish_unsigned_mac_or_windows_bundles():
    workflow = (ROOT / ".github/workflows/release.yml").read_text(encoding="utf-8")

    assert "Perdura-*-windows-x64.zip" not in workflow
    assert "Perdura-*-macos-arm64.tar.gz" not in workflow
    assert "pypa/gh-action-pypi-publish@" in workflow
    assert "perdura-*.whl" in workflow
    assert "linux/amd64" in workflow
    assert "linux/arm64" in workflow
    assert "ghcr.io/${{ github.repository }}" in workflow


def test_candidate_wheel_is_exercised_on_every_supported_local_platform():
    workflow = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")

    for target in (
        "linux-x64",
        "linux-arm64",
        "windows-x64",
        "macos-arm64",
        "macos-x64",
    ):
        assert f"target: {target}" in workflow
    assert "Perdura-CI-application-wheel-${{ github.sha }}" in workflow
    assert 'uv tool install --python 3.11.15 --force "${WHEEL}[app]"' in workflow
    assert "perdura doctor --json" in workflow


def test_consolidated_ci_evidence_survives_failed_job_reruns():
    ci_workflow = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    release_workflow = (ROOT / ".github/workflows/release.yml").read_text(encoding="utf-8")
    artifact_name = "Perdura-CI-evidence-${{ github.sha }}-${{ github.run_id }}"

    assert f"name: {artifact_name}" in ci_workflow
    assert "overwrite: true" in ci_workflow
    assert release_workflow.count(f"name: {artifact_name}") == 4
    assert f"{artifact_name}-${{{{ github.run_attempt }}}}" not in release_workflow


def test_release_stages_nested_wheel_before_attestation_and_upload():
    workflow = (ROOT / ".github/workflows/release.yml").read_text(encoding="utf-8")

    stage = workflow.index("- name: Stage Python wheel for release")
    attest = workflow.index("- name: Attest released binaries and verification evidence")
    publish = workflow.index("- name: Create GitHub Release")

    assert stage < attest < publish
    assert "find wheelhouse -maxdepth 1 -type f -name 'perdura-*.whl'" in workflow
    assert 'if [ "${#wheels[@]}" -ne 1 ]' in workflow
    assert 'cp "${wheels[0]}" .' in workflow


def test_release_recovery_is_bound_to_the_tagged_source_run():
    workflow = (ROOT / ".github/workflows/recover-release.yml").read_text(
        encoding="utf-8"
    )

    assert "ref: ${{ inputs.tag }}" in workflow
    assert 'RUN_SHA="$(jq -r \'.head_sha\' <<<"$RUN_JSON")"' in workflow
    assert 'TAG_SHA="$(git rev-parse HEAD)"' in workflow
    assert 'if [ "$RUN_SHA" != "$TAG_SHA" ]' in workflow
    assert 'if [ "$RUN_PATH" != ".github/workflows/release.yml" ]' in workflow
    assert "run-id: ${{ inputs.source_run_id }}" in workflow
    assert "refusing to overwrite it" in workflow
    assert "find python-input -type f -name 'perdura-*.whl'" in workflow
    assert "Attach Python wheel SBOM attestation" in workflow
