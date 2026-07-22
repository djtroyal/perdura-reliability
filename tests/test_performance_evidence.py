import json
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]


def test_performance_runner_emits_deterministic_provenance_and_junit(tmp_path):
    report = tmp_path / "performance.json"
    junit = tmp_path / "performance.xml"
    subprocess.run([
        sys.executable, str(ROOT / "tools" / "run_performance_baseline.py"),
        "--output", str(report), "--junit", str(junit), "--repeats", "3",
        "--only", "distribution-vector-100k",
        "--only", "descriptive-summary-10k",
    ], cwd=ROOT, check=True)

    data = json.loads(report.read_text())
    assert data["schema"] == "perdura.performance-baseline/v1"
    assert data["status"] == "passed"
    assert data["profile"] == "ci-regression"
    assert data["public_claim_eligible"] is False
    assert data["provenance"]["workload_sha256"]
    assert {case["id"] for case in data["cases"]} == {
        "distribution-vector-100k", "descriptive-summary-10k",
    }
    assert all(len(case["observations_seconds"]) == 3 for case in data["cases"])
    assert '<testsuite name="performance-baseline"' in junit.read_text()


def test_performance_runner_gates_material_regression(tmp_path):
    baseline = tmp_path / "baseline.json"
    baseline.write_text(json.dumps({
        "schema": "perdura.performance-baseline/v1",
        "status": "passed",
        "cases": [{
            "id": "distribution-vector-100k",
            "median_seconds": 1e-12,
            "peak_python_bytes": 1,
        }],
    }))
    result = subprocess.run([
        sys.executable, str(ROOT / "tools" / "run_performance_baseline.py"),
        "--baseline", str(baseline), "--repeats", "3",
        "--only", "distribution-vector-100k",
    ], cwd=ROOT, capture_output=True, text=True)
    assert result.returncode == 1
    assert json.loads(result.stdout)["status"] == "regressed"
