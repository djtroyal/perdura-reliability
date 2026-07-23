import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "check_product_assurance", ROOT / "tools" / "check_product_assurance.py"
)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


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


def test_osv_workflow_uses_node24_compatible_release():
    workflow = (ROOT / ".github" / "workflows" / "product-assurance.yml").read_text(
        encoding="utf-8"
    )

    assert "osv-scanner-reusable.yml@9a498708959aeaef5ef730655706c5a1df1edbc2" in workflow
    assert "osv-scanner-reusable.yml@40a8940a65eab1544a6af759e43d936201a131a2" not in workflow


def test_website_sync_download_identifies_source_repository():
    workflow = (ROOT / ".github" / "workflows" / "sync-website-resources.yml").read_text(
        encoding="utf-8"
    )

    assert 'gh run download "$RUN_ID" --repo "$GITHUB_REPOSITORY"' in workflow
