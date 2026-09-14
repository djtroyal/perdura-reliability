import importlib.util
import re
from pathlib import Path

import pytest
import yaml


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "check_product_assurance", ROOT / "tools" / "check_product_assurance.py"
)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def _workflow(name):
    # BaseLoader keeps GitHub's "on" key and boolean-like expression values as
    # strings instead of applying YAML 1.1's surprising implicit conversions.
    return yaml.load(
        (ROOT / ".github" / "workflows" / name).read_text(encoding="utf-8"),
        Loader=yaml.BaseLoader,
    )


def _steps(workflow):
    return [
        step for job in workflow["jobs"].values()
        for step in job.get("steps", [])
    ]


def test_local_product_assurance_controls_pass():
    report = MODULE.evaluate()

    assert report["schema"] == "perdura.product-assurance/v1"
    assert report["status"] == "passed", {
        item["id"]: item["detail"]
        for item in report["checks"]
        if item["status"] != "passed"
    }
    assert report["summary"]["failed"] == 0


def test_assurance_report_does_not_claim_external_assessment():
    report = MODULE.evaluate()

    assert any("independent" in item.lower() for item in report["external_evidence_not_evaluated"])
    assert "not" in report["interpretation"].lower()


def test_container_removes_build_only_python_packaging_tools():
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")

    assert "/usr/local/bin/python -m pip uninstall --yes pip setuptools wheel" in dockerfile


def test_k6_release_version_does_not_duplicate_v_prefix():
    workflow = (ROOT / ".github" / "workflows" / "product-assurance.yml").read_text(
        encoding="utf-8"
    )

    assert "k6-version: '2.1.0'" in workflow
    assert "k6-version: v2.1.0" not in workflow


def test_container_sarif_scan_honors_assurance_severity_threshold():
    workflow = (ROOT / ".github" / "workflows" / "product-assurance.yml").read_text(
        encoding="utf-8"
    )

    assert "severity: HIGH,CRITICAL" in workflow
    assert "limit-severities-for-sarif: true" in workflow


def test_zap_active_scan_is_bounded_inside_job_timeout():
    workflow = (ROOT / ".github" / "workflows" / "product-assurance.yml").read_text(
        encoding="utf-8"
    )

    assert "timeout-minutes: 60" in workflow
    assert "scanner.maxScanDurationInMins=30" in workflow
    assert "scanner.maxRuleDurationInMins=5" in workflow


def test_osv_workflow_preserves_supported_pinned_scan_interface():
    osv = _workflow("product-assurance.yml")["jobs"]["osv"]
    assert re.fullmatch(
        r"google/osv-scanner-action/\.github/workflows/osv-scanner-reusable\.yml@[0-9a-f]{40}",
        osv["uses"],
    )
    # This historical release failed with the Node 24 runner. Keep a narrow
    # regression guard without requiring every newer release to retain one SHA.
    assert not osv["uses"].endswith("@40a8940a65eab1544a6af759e43d936201a131a2")
    assert osv["with"]["fail-on-vuln"] == "true"
    assert osv["with"]["upload-sarif"] == "true"
    assert osv["with"]["scan-args"].split() == ["--recursive", "./"]
    assert osv["permissions"]["security-events"] == "write"


def test_website_sync_download_identifies_source_repository():
    workflow = (ROOT / ".github" / "workflows" / "sync-website-resources.yml").read_text(
        encoding="utf-8"
    )

    assert 'gh run download "$RUN_ID" --repo "$GITHUB_REPOSITORY"' in workflow


@pytest.mark.parametrize("name,prefix,version", [
    ("release.yml", "", "${{ steps.tag.outputs.version }}"),
    ("recover-release.yml", "release-files/", "${{ needs.validate.outputs.version }}"),
])
def test_release_uses_supported_exact_path_sbom_attestations(name, prefix, version):
    steps = _steps(_workflow(name))
    assert not any(step.get("uses", "").startswith("actions/attest-sbom@") for step in steps)
    attestations = [
        step for step in steps if step.get("uses", "").startswith("actions/attest@")
    ]
    assert attestations
    assert all(re.fullmatch(r"actions/attest@[0-9a-f]{40}", step["uses"]) for step in attestations)
    # Verify each SBOM is bound to its corresponding exact subject in the same
    # step, rather than counting copies of a previous action's commit hash.
    actual = {
        (step["with"].get("subject-path"), step["with"]["sbom-path"])
        for step in attestations if "sbom-path" in step["with"]
    }
    assert actual == {
        (
            f"{prefix}Perdura-{version}-linux-x64.tar.gz",
            f"{prefix}Perdura-{version}-sbom-linux-x64.spdx.json",
        ),
        (
            f"{prefix}perdura-{version}-py3-none-any.whl",
            f"{prefix}Perdura-{version}-sbom-python-wheel.spdx.json",
        ),
    }


def test_container_sources_are_digest_pinned_and_monitored():
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    sources = re.findall(r"^FROM (\S+)", dockerfile, re.MULTILINE)
    sources += re.findall(r"^COPY --from=(\S+/\S+)", dockerfile, re.MULTILINE)
    assert len(sources) == 3
    assert all(re.fullmatch(r"\S+@sha256:[0-9a-f]{64}", source) for source in sources)
    dependabot = yaml.load(
        (ROOT / ".github" / "dependabot.yml").read_text(encoding="utf-8"),
        Loader=yaml.BaseLoader,
    )
    assert any(
        update["package-ecosystem"] == "docker" and update["directory"] == "/"
        for update in dependabot["updates"]
    )
