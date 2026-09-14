import json
import importlib.util
import shutil
import pytest
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
    assert data["comparison"]["status"] == "unavailable"
    assert data["comparison_context"]["repeats"] == 3
    assert data["profile"] == "ci-regression"
    assert data["public_claim_eligible"] is False
    assert data["provenance"]["workload_sha256"]
    assert {case["id"] for case in data["cases"]} == {
        "distribution-vector-100k", "descriptive-summary-10k",
    }
    assert all(len(case["observations_seconds"]) == 3 for case in data["cases"])
    assert '<testsuite name="performance-baseline"' in junit.read_text()


@pytest.fixture
def runner():
    spec = importlib.util.spec_from_file_location("performance_runner_test", ROOT / "tools/run_performance_baseline.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_performance_runner_gates_material_regression(runner, monkeypatch):
    monkeypatch.setattr(runner, "WORKLOADS", {"deterministic": lambda: 1.0})
    ticks = iter([0, 200_000_000, 0, 200_000_000, 0, 200_000_000])
    monkeypatch.setattr(runner.time, "perf_counter_ns", lambda: next(ticks))
    result = runner.run_case("deterministic", 3, {
        "median_seconds": 0.1, "peak_python_bytes": 10**9,
        "coefficient_of_variation": 0,
    })
    assert result["status"] == "regressed"
    assert result["baseline"]["median_change_fraction"] == 1.0


def test_noisy_comparison_is_inconclusive(runner, monkeypatch):
    monkeypatch.setattr(runner, "WORKLOADS", {"deterministic": lambda: 1.0})
    ticks = iter([0, 200_000_000, 0, 400_000_000, 0, 800_000_000])
    monkeypatch.setattr(runner.time, "perf_counter_ns", lambda: next(ticks))
    result = runner.run_case("deterministic", 3, {
        "median_seconds": 0.1, "peak_python_bytes": 10**9,
        "coefficient_of_variation": 0,
    })
    assert result["status"] == "inconclusive"
    assert result["baseline"]["threshold_exceeded"] is True
    assert result["baseline"]["stable_comparison"] is False


@pytest.mark.parametrize("mismatch", ["workload_sha256", "uv_lock_sha256", "environment", "repeats", "case coverage"])
def test_incompatible_records_are_not_compared(tmp_path, runner, mismatch):
    context = {"workload_sha256": "abc", "uv_lock_sha256": "def", "environment": {"cpu": "A"},
               "repeats": 3, "workloads": ["case"]}
    previous = {**context}
    case = {"id": "case", "median_seconds": 1, "peak_python_bytes": 1, "coefficient_of_variation": 0}
    if mismatch == "case coverage":
        case["id"] = "other"
    else:
        previous[mismatch] = "changed"
    path = tmp_path / "baseline.json"
    path.write_text(json.dumps({"schema": runner.SCHEMA, "status": "passed",
                               "comparison_context": previous, "cases": [case]}))
    cases, comparison = runner.load_baseline(path, context)
    assert cases == {}
    assert comparison["status"] == "incompatible"
    assert mismatch in comparison["reasons"]


def test_missing_baseline_is_explicit(runner):
    cases, comparison = runner.load_baseline(None, {})
    assert cases == {}
    assert comparison["status"] == "unavailable"
    assert "smoke" in comparison["reasons"][0]


def test_selected_source_origin_is_verified(tmp_path):
    base = tmp_path / "base"
    shutil.copytree(ROOT / "src/reliability", base / "src/reliability",
                    ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copyfile(ROOT / "uv.lock", base / "uv.lock")
    result = subprocess.run([
        sys.executable, str(ROOT / "tools/run_performance_baseline.py"),
        "--source-root", str(base), "--repeats", "3", "--only", "distribution-vector-100k",
        "--require-comparison",
    ], cwd=ROOT, capture_output=True, text=True)
    assert result.returncode == 2, result.stderr
    data = json.loads(result.stdout)
    assert Path(data["provenance"]["scientific_import_origin"]).is_relative_to(base / "src/reliability")
    assert data["comparison"]["status"] == "unavailable"


def test_preimported_wrong_source_is_rejected(tmp_path, runner, monkeypatch):
    from types import SimpleNamespace
    expected = tmp_path / "src/reliability"
    expected.mkdir(parents=True)
    (expected / "__init__.py").write_text("")
    monkeypatch.setitem(sys.modules, "reliability", SimpleNamespace(__file__=str(ROOT / "src/reliability/__init__.py")))
    with pytest.raises(ValueError, match="outside requested"):
        runner.load_workloads(tmp_path)
