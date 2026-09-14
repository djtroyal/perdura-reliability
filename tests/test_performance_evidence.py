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


def fake_process_blocks(runner, monkeypatch, timings, peaks=None, mismatch=None):
    calls = []
    reports = []
    context = {"protocol": "test", "workloads": ["case"], "repeats": 3}
    def measure(root, repeats, selected):
        index = len(calls)
        calls.append(root.name)
        case = runner.summarize_case("case", [timings[index]] * 3,
                                     (peaks or [100] * 4)[index], 8.0, None)
        report = {"schema": runner.SCHEMA, "status": "passed",
                  "comparison_context": {**context}, "cases": [case],
                  "provenance": {"commit": root.name}}
        if mismatch is not None and index == 2:
            report["comparison_context"][mismatch] = "different"
        reports.append(report)
        return report
    monkeypatch.setattr(runner, "measure_source_block", measure)
    return calls, reports


def test_counterbalanced_comparison_retains_every_process_and_observation(runner, monkeypatch):
    calls, reports = fake_process_blocks(runner, monkeypatch, [1.0, 1.01, 1.01, 1.0])
    cases, comparison, blocks = runner.compare_sources(Path("candidate"), Path("base"), 3, ["case"])
    assert calls == ["base", "candidate", "candidate", "base"]
    assert comparison["measurement_order"] == ["baseline", "candidate", "candidate", "baseline"]
    assert comparison["independent_processes_per_revision"] == 2
    assert [block["report"] for block in blocks] == reports
    assert cases[0]["observations_seconds"] == [1.01] * 6
    assert cases[0]["baseline"]["observations_seconds"] == [1.0] * 6
    assert cases[0]["result_checksum"] == cases[0]["baseline"]["result_checksum"] == 16
    assert cases[0]["status"] == "passed"


def test_between_process_drift_is_inconclusive_despite_stable_individual_blocks(runner, monkeypatch):
    # Every process has CV=0; the original single-process A/B gate would fail
    # at a 20% offset. Two orders expose that offset as process variability.
    fake_process_blocks(runner, monkeypatch, [1.0, 1.2, 1.2, 1.4])
    cases, _, blocks = runner.compare_sources(Path("candidate"), Path("base"), 3, ["case"])
    assert all(block["report"]["cases"][0]["coefficient_of_variation"] == 0 for block in blocks)
    assert cases[0]["status"] == "inconclusive"
    assert cases[0]["baseline"]["coefficient_of_variation"] > .05
    assert cases[0]["baseline"]["stable_comparison"] is False


def test_stable_cross_process_regression_keeps_the_ten_percent_gate(runner, monkeypatch):
    fake_process_blocks(runner, monkeypatch, [1.0, 1.11, 1.11, 1.0])
    cases, _, _ = runner.compare_sources(Path("candidate"), Path("base"), 3, ["case"])
    assert cases[0]["status"] == "regressed"
    assert cases[0]["baseline"]["time_regression_threshold_fraction"] == .10
    assert cases[0]["baseline"]["median_change_fraction"] == pytest.approx(.11)


def test_memory_gate_survives_noisy_counterbalanced_timing(runner, monkeypatch):
    fake_process_blocks(runner, monkeypatch, [1, 2, 4, 1], [100, 115, 116, 100])
    cases, _, _ = runner.compare_sources(Path("candidate"), Path("base"), 3, ["case"])
    assert cases[0]["status"] == "regressed"
    assert cases[0]["baseline"]["stable_comparison"] is False
    assert cases[0]["baseline"]["peak_memory_change_fraction"] == pytest.approx(.16)
    assert cases[0]["baseline"]["memory_regression_threshold_fraction"] == .15


def test_counterbalanced_environment_mismatch_is_not_treated_as_comparable(runner, monkeypatch):
    fake_process_blocks(runner, monkeypatch, [1, 2, 2, 1], mismatch="repeats")
    cases, comparison, blocks = runner.compare_sources(Path("candidate"), Path("base"), 3, ["case"])
    assert comparison["status"] == "incompatible"
    assert comparison["reasons"] == ["repeats"]
    assert cases[0]["baseline"]["available"] is False
    assert cases[0]["status"] == "inconclusive"
    assert len(blocks) == 4


@pytest.mark.parametrize("checksum", [8.1, float("nan")])
def test_changed_or_nonfinite_numerical_checksum_prevents_performance_pass(runner, monkeypatch, checksum):
    fake_process_blocks(runner, monkeypatch, [1, .5, .5, 1])
    measure = runner.measure_source_block
    def changed(root, repeats, selected):
        report = measure(root, repeats, selected)
        if root.name == "candidate":
            report["cases"][0]["result_checksum"] = checksum
        return report
    monkeypatch.setattr(runner, "measure_source_block", changed)
    cases, comparison, _ = runner.compare_sources(Path("candidate"), Path("base"), 3, ["case"])
    assert comparison["status"] == "incompatible"
    assert comparison["numerical_result_check"]["status"] == "different"
    assert comparison["reasons"] == ["result checksum mismatch: case"]
    assert cases[0]["baseline"]["available"] is False
    assert cases[0]["status"] == "inconclusive"
    assert "checksum mismatch" in cases[0]["inconclusive_reason"]


def test_incompatible_cli_report_and_junit_are_explicitly_inconclusive(tmp_path, runner, monkeypatch):
    fake_process_blocks(runner, monkeypatch, [1, 2, 2, 1], mismatch="repeats")
    monkeypatch.setattr(runner, "WORKLOADS", {"case": lambda: 1})
    monkeypatch.setattr(runner, "load_workloads", lambda root: "test-origin")
    monkeypatch.setattr(runner, "comparison_context", lambda *args: {"environment": {}})
    output = tmp_path / "comparison.json"
    junit = tmp_path / "comparison.xml"
    assert runner.main(["--compare-source-root", str(tmp_path), "--only", "case",
                        "--repeats", "3", "--output", str(output), "--junit", str(junit)]) == 2
    report = json.loads(output.read_text())
    assert report["status"] == "inconclusive"
    assert report["comparison"]["status"] == "incompatible"
    assert report["public_claim_eligible"] is False
    assert '<skipped message="Comparison incompatible: repeats"' in junit.read_text()


def test_counterbalanced_cli_uses_selected_sources_in_fresh_processes(tmp_path):
    base = tmp_path / "base"
    shutil.copytree(ROOT / "src/reliability", base / "src/reliability",
                    ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copyfile(ROOT / "uv.lock", base / "uv.lock")
    output = tmp_path / "paired.json"
    result = subprocess.run([
        sys.executable, str(ROOT / "tools/run_performance_baseline.py"),
        "--compare-source-root", str(base), "--repeats", "3",
        "--only", "distribution-vector-100k", "--output", str(output),
        "--no-gate",
    ], cwd=ROOT, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    data = json.loads(output.read_text())
    assert data["comparison_context"]["protocol"] == "perdura.performance-comparison/v2"
    assert data["comparison_context"]["repeats"] == 6
    assert len(data["measurement_blocks"]) == 4
    assert len({block["report"]["provenance"]["process_id"] for block in data["measurement_blocks"]}) == 4
    for block in data["measurement_blocks"]:
        expected = base if block["role"] == "baseline" else ROOT
        assert Path(block["report"]["provenance"]["scientific_import_origin"]).is_relative_to(expected / "src/reliability")
    assert len(data["cases"][0]["observations_seconds"]) == 6
    assert data["public_claim_eligible"] is False
