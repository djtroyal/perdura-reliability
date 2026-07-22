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
