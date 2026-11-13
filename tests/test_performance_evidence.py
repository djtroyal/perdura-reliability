import json
import importlib.util
from copy import deepcopy
import hashlib
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
    assert data["provenance"]["uv_lock_sha256"] == hashlib.sha256((ROOT / 'uv.lock').read_bytes()).hexdigest()
    assert data["comparison_context"]["runtime_lock_sha256"]
    assert "uv_lock_sha256" not in data["comparison_context"]
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


@pytest.mark.parametrize("mismatch", ["protocol", "workload_sha256", "runtime_lock_sha256", "environment", "repeats", "case coverage"])
def test_incompatible_records_are_not_compared(tmp_path, runner, mismatch):
    context = {"protocol": "perdura.performance-comparison/v3", "workload_sha256": "abc", "runtime_lock_sha256": "def", "environment": {"cpu": "A"},
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
    # A tooling-only package changes full-lock provenance, not runtime imports.
    with (base / "uv.lock").open('a') as stream:
        stream.write('\n[[package]]\nname = "dev-tool-only"\nversion = "1.0"\nsource = { registry = "https://pypi.org/simple" }\n')
    output = tmp_path / "paired.json"
    result = subprocess.run([
        sys.executable, str(ROOT / "tools/run_performance_baseline.py"),
        "--compare-source-root", str(base), "--repeats", "3",
        "--only", "distribution-vector-100k", "--output", str(output),
        "--no-gate",
    ], cwd=ROOT, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    data = json.loads(output.read_text())
    assert data["comparison_context"]["protocol"] == "perdura.performance-comparison/v4"
    assert data["comparison_context"]["repeats"] == 6
    assert len(data["measurement_blocks"]) == 4
    assert len({block["report"]["provenance"]["process_id"] for block in data["measurement_blocks"]}) == 4
    for block in data["measurement_blocks"]:
        expected = base if block["role"] == "baseline" else ROOT
        assert Path(block["report"]["provenance"]["scientific_import_origin"]).is_relative_to(expected / "src/reliability")
    assert len({block["report"]["provenance"]["uv_lock_sha256"] for block in data["measurement_blocks"]}) == 2
    assert len({block["report"]["comparison_context"]["runtime_lock_sha256"] for block in data["measurement_blocks"]}) == 1
    assert len(data["cases"][0]["observations_seconds"]) == 6
    assert data["public_claim_eligible"] is False


@pytest.fixture
def runtime_lock():
    def package(name, **fields):
        return {"name": name, "version": "1.0", "source": {"registry": "https://pypi.org/simple"},
                "wheels": [{"url": f"https://files.example/{name}.whl", "hash": "sha256:original"}], **fields}
    return {
        "version": 1, "revision": 3, "requires-python": ">=3.11,<3.15",
        "resolution-markers": ["sys_platform == 'darwin'", "sys_platform != 'darwin'"],
        "package": [
            package("perdura", source={"editable": "."}, dependencies=[{"name": "core"}],
                    **{"optional-dependencies": {"app": [{"name": "server", "extra": ["fast"]},
                                                         {"name": "variant"}]},
                       "dev-dependencies": {"dev": [{"name": "tool"}], "release": [{"name": "release"}]},
                       "metadata": {"requires-dist": [{"name": "core", "specifier": ">=1"}],
                                    "requires-dev": {"dev": [{"name": "tool", "specifier": ">=1"}]}}}),
            package("core", dependencies=[{"name": "shared"}]),
            package("server", **{"optional-dependencies": {"fast": [{"name": "fast"}]}}),
            package("fast"),
            package("variant", **{"resolution-markers": ["sys_platform == 'darwin'"]}),
            package("variant", version="2.0", **{"resolution-markers": ["sys_platform != 'darwin'"]}),
            package("shared"),
            package("tool", dependencies=[{"name": "shared"}]),
            package("release"),
        ],
    }


def test_runtime_closure_excludes_only_tools_and_retains_app_extras_and_all_platforms(runner, runtime_lock):
    projection = runner.runtime_lock_projection(runtime_lock)
    records = {(package['name'], package.get('version')) for package in projection['packages']}
    assert records == {('perdura', None), ('core', '1.0'), ('server', '1.0'), ('fast', '1.0'),
                       ('shared', '1.0'), ('variant', '1.0'), ('variant', '2.0')}
    changed = deepcopy(runtime_lock)
    changed['package'][7]['version'] = '3.0'
    changed['package'][8]['wheels'][0]['hash'] = 'sha256:release-change'
    changed['package'][0]['dev-dependencies']['dev'].append({'name': 'release'})
    changed['package'][0]['metadata']['requires-dev']['dev'][0]['specifier'] = '>=3'
    changed['package'].reverse()
    assert runner.runtime_lock_projection(changed) == projection


def test_editable_root_release_version_does_not_change_runtime_projection_or_hash(runner, tmp_path):
    contents = (ROOT / 'uv.lock').read_text()
    lock = runner.tomllib.loads(contents)
    root = next(package for package in lock['package']
                if package['name'] == 'perdura' and package['source'] == {'editable': '.'})
    changed = contents.replace(
        f'name = "perdura"\nversion = "{root["version"]}"',
        'name = "perdura"\nversion = "999.0.0"', 1,
    )
    assert changed != contents
    path = tmp_path / 'uv.lock'
    path.write_text(contents)
    original_hash = runner.runtime_lock_hash(path)
    path.write_text(changed)
    assert runner.runtime_lock_hash(path) == original_hash
    assert runner.runtime_lock_projection(runner.tomllib.loads(changed)) == runner.runtime_lock_projection(lock)
    # Projection must not mutate the full-lock provenance input.
    assert root['version'] != '999.0.0'


@pytest.mark.parametrize('change', [
    lambda lock: lock['package'][1].update(version='3.0'),
    lambda lock: lock['package'][1].update(source={'git': 'https://example.test/core'}),
    lambda lock: lock['package'][1]['wheels'][0].update(hash='sha256:changed'),
    lambda lock: lock['package'][1]['wheels'][0].update(url='https://other.example/core.whl'),
    lambda lock: lock['package'][1]['dependencies'][0].update(marker="sys_platform == 'linux'"),
    lambda lock: lock['package'][1]['dependencies'].append({'name': 'tool'}),
    lambda lock: lock['package'][3].update(version='3.0'),
    lambda lock: lock['package'][5].update(version='3.0'),
    lambda lock: lock['package'][5].update(**{'resolution-markers': ["sys_platform == 'win32'"]}),
    lambda lock: lock['package'][6].update(version='3.0'),
    lambda lock: lock['package'][0]['metadata']['requires-dist'][0].update(specifier='>=3'),
    lambda lock: lock.update(**{'requires-python': '>=3.12,<3.15'}),
])
def test_any_runtime_identity_artifact_edge_marker_or_requirement_change_is_incompatible(runner, runtime_lock, change):
    before = deepcopy(runner.runtime_lock_projection(runtime_lock))
    change(runtime_lock)
    assert runner.runtime_lock_projection(runtime_lock) != before


@pytest.mark.parametrize('failure', ['root', 'dependency', 'extra', 'identity', 'version', 'source'])
def test_incomplete_or_ambiguous_runtime_closure_fails_closed(runner, runtime_lock, failure):
    if failure == 'root':
        runtime_lock['package'].pop(0)
    elif failure == 'dependency':
        runtime_lock['package'][1]['dependencies'].append({'name': 'missing'})
    elif failure == 'extra':
        runtime_lock['package'][2]['optional-dependencies'].clear()
    elif failure == 'identity':
        runtime_lock['package'].append(deepcopy(runtime_lock['package'][1]))
    else:
        runtime_lock['package'][1]['dependencies'][0][failure] = 'missing'
    with pytest.raises(ValueError):
        runner.runtime_lock_projection(runtime_lock)


def test_selected_extra_cycles_terminate_and_keep_exact_version_resolution(runner, runtime_lock):
    runtime_lock['package'][2]['optional-dependencies']['fast'].append({'name': 'server', 'extra': ['fast']})
    runtime_lock['package'][0]['optional-dependencies']['app'][1]['version'] = '2.0'
    projection = runner.runtime_lock_projection(runtime_lock)
    variants = [package['version'] for package in projection['packages'] if package['name'] == 'variant']
    assert variants == ['2.0']


@pytest.mark.parametrize('contents', [None, 'not a lock', 'version = 1\npackage = []'])
def test_missing_or_malformed_lock_cannot_produce_comparable_hash(runner, tmp_path, contents):
    path = tmp_path / 'uv.lock'
    if contents is not None:
        path.write_text(contents)
    with pytest.raises(ValueError, match='Cannot establish runtime lock closure'):
        runner.runtime_lock_hash(path)


def fake_locked_blocks(runner, monkeypatch, *, timings=None, peaks=None, mutation=None):
    calls, reports = fake_process_blocks(runner, monkeypatch, timings or [1, 1, 1, 1], peaks)
    measure = runner.measure_source_block
    monkeypatch.setattr(runner, "prepare_locked_environment", lambda root, directory: {"role": root.name})

    def locked_measure(root, repeats, selected, environment):
        assert environment["role"] == root.name
        report = measure(root, repeats, selected)
        report["comparison_context"].update({
            "runtime_lock_sha256": root.name,
            "workload_sha256": "same-workload",
            "environment": {
                "cpu_model": "same-cpu", "python": "3.13.18",
                "thread_limits": {"OPENBLAS_NUM_THREADS": "1"},
                "libraries": {"numpy": "1" if root.name == "base" else "2"},
                "native_pools": [{"user_api": "blas", "num_threads": 1, "version": root.name}],
            },
        })
        if mutation:
            mutation(report, root.name, len(calls))
        return report
    monkeypatch.setattr(runner, "measure_source_block", locked_measure)
    return calls, reports


def test_explicit_locked_mode_compares_runtime_changes_with_all_observations(runner, monkeypatch):
    calls, reports = fake_locked_blocks(runner, monkeypatch)
    cases, comparison, blocks = runner.compare_sources(Path("candidate"), Path("base"), 3, ["case"], locked_environments=True)
    assert calls == ["base", "candidate", "candidate", "base"]
    assert [block["report"] for block in blocks] == reports
    assert comparison["status"] == "available"
    assert comparison["dependency_environment_mode"] == "separate-locked-runtime-environments"
    assert comparison["runtime_locks"] == {"baseline": "base", "candidate": "candidate"}
    assert comparison["numerical_result_check"]["status"] == "matched"
    assert cases[0]["status"] == "passed"
    assert len(cases[0]["observations_seconds"]) == 6


@pytest.mark.parametrize("field", ["cpu_model", "python", "thread_limits", "native_pools", "protocol", "workload_sha256"])
def test_locked_mode_still_rejects_hardware_python_threads_and_protocol_changes(runner, monkeypatch, field):
    def mutate(report, role, _index):
        if role != "candidate":
            return
        context = report["comparison_context"]
        if field in {"protocol", "workload_sha256"}:
            context[field] = "changed"
        elif field == "native_pools":
            context["environment"][field][0]["num_threads"] = 2
        else:
            context["environment"][field] = "changed"
    fake_locked_blocks(runner, monkeypatch, mutation=mutate)
    cases, comparison, _ = runner.compare_sources(Path("candidate"), Path("base"), 3, ["case"], locked_environments=True)
    assert comparison["status"] == "incompatible"
    assert cases[0]["status"] == "inconclusive"
    assert cases[0]["baseline"]["available"] is False


@pytest.mark.parametrize("field", ["runtime_lock_sha256", "libraries", "native_pools"])
def test_locked_mode_rejects_dependency_drift_within_a_revision(runner, monkeypatch, field):
    def mutate(report, _role, index):
        if index == 3:
            context = report["comparison_context"]
            if field == "runtime_lock_sha256":
                context[field] = "unexpected-third-lock"
            else:
                context["environment"][field] = {"changed": True} if field == "libraries" else []
    fake_locked_blocks(runner, monkeypatch, mutation=mutate)
    _, comparison, _ = runner.compare_sources(Path("candidate"), Path("base"), 3, ["case"], locked_environments=True)
    assert comparison["status"] == "incompatible"


@pytest.mark.parametrize("timings,peaks,expected", [
    ([1, 1.11, 1.11, 1], None, "regressed"),
    ([1, 2, 4, 1], [100, 116, 116, 100], "regressed"),
    ([1, 1.2, 1.2, 1.4], None, "inconclusive"),
])
def test_locked_mode_keeps_time_memory_and_noise_gates(runner, monkeypatch, timings, peaks, expected):
    fake_locked_blocks(runner, monkeypatch, timings=timings, peaks=peaks)
    cases, _, _ = runner.compare_sources(Path("candidate"), Path("base"), 3, ["case"], locked_environments=True)
    assert cases[0]["status"] == expected
    assert cases[0]["baseline"]["time_regression_threshold_fraction"] == .10
    assert cases[0]["baseline"]["memory_regression_threshold_fraction"] == .15


def test_locked_mode_rejects_numerical_changes(runner, monkeypatch):
    def mutate(report, role, _index):
        if role == "candidate":
            report["cases"][0]["result_checksum"] = 9
    fake_locked_blocks(runner, monkeypatch, mutation=mutate)
    _, comparison, _ = runner.compare_sources(Path("candidate"), Path("base"), 3, ["case"], locked_environments=True)
    assert comparison["status"] == "incompatible"
    assert comparison["numerical_result_check"]["status"] == "different"


def test_locked_cli_reports_measured_candidate_environment_not_orchestrator(tmp_path, runner, monkeypatch):
    fake_locked_blocks(runner, monkeypatch)
    monkeypatch.setattr(runner, "WORKLOADS", {"case": lambda: 1})
    monkeypatch.setattr(runner, "load_workloads", lambda root: "test-origin")
    monkeypatch.setattr(runner, "comparison_context", lambda *args: {"environment": {"parent-dev-env": True}})
    output = tmp_path / "paired.json"
    assert runner.main(["--source-root", "candidate", "--compare-source-root", "base",
                        "--compare-locked-environments", "--only", "case", "--repeats", "3",
                        "--output", str(output)]) == 0
    report = json.loads(output.read_text())
    assert report["comparison_context"]["protocol"] == "perdura.performance-comparison/v5-locked"
    assert report["environment"]["libraries"]["numpy"] == "2"
    assert "parent-dev-env" not in report["environment"]


def test_locked_cli_requires_source_pair(runner):
    with pytest.raises(SystemExit) as error:
        runner.main(["--compare-locked-environments"])
    assert error.value.code == 2


def test_locked_environment_sanitizes_inherited_interpreter_and_uv_policy(runner, monkeypatch):
    for key in ("PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV", "UV_PROJECT_ENVIRONMENT", "UV_INEXACT", "UV_NO_SYNC"):
        monkeypatch.setenv(key, "wrong")
    monkeypatch.setenv("OMP_NUM_THREADS", "1")
    monkeypatch.setenv("UV_CACHE_DIR", "/tmp/allowed-cache")
    environment = runner.isolated_environment()
    assert not any(key in environment for key in (
        "PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV", "UV_PROJECT_ENVIRONMENT", "UV_INEXACT", "UV_NO_SYNC"))
    assert environment["OMP_NUM_THREADS"] == "1"
    assert environment["UV_CACHE_DIR"] == "/tmp/allowed-cache"


@pytest.mark.parametrize("changed", ["source", "workload", "sync"])
def test_locked_environment_fails_closed_on_source_or_sync_drift(runner, monkeypatch, tmp_path, changed):
    environment = {"source_root": str(tmp_path), "source_fingerprint": {"source": "before"},
                   "workload_sha256": "workload", "sync_check_command": ["uv", "sync", "--check"],
                   "process_environment": {}}
    monkeypatch.setattr(runner, "source_fingerprint", lambda root: {"source": "after" if changed == "source" else "before"})
    monkeypatch.setattr(runner, "workload_hash", lambda: "after" if changed == "workload" else "workload")
    def failed_sync(*args, **kwargs):
        raise RuntimeError("sync failed")
    monkeypatch.setattr(runner, "checked_process", failed_sync)
    with pytest.raises((ValueError, RuntimeError), match="changed|sync failed"):
        runner.verify_locked_environment(environment)


def test_inventory_is_limited_to_venv_site_packages_even_with_checkout_metadata(runner, monkeypatch, tmp_path):
    from types import SimpleNamespace
    prefix = tmp_path / "venv"
    site_packages = prefix / "lib/site-packages"
    monkeypatch.setattr(runner.sys, "prefix", str(prefix))
    monkeypatch.setattr(runner.site, "getsitepackages", lambda: [str(site_packages)])
    def distributions(*, path):
        assert path == [str(site_packages)]
        return [SimpleNamespace(metadata={"Name": "locked_package"}, version="1.0",
                                locate_file=lambda _: site_packages)]
    monkeypatch.setattr(runner.importlib.metadata, "distributions", distributions)
    assert runner.environment_inventory()["packages"] == {"locked-package": "1.0"}


def test_inventory_rejects_system_site_packages(runner, monkeypatch, tmp_path):
    monkeypatch.setattr(runner.sys, "prefix", str(tmp_path / "venv"))
    monkeypatch.setattr(runner.site, "getsitepackages", lambda: [str(tmp_path / "system/site-packages")])
    with pytest.raises(ValueError, match="System site-packages"):
        runner.environment_inventory()


@pytest.mark.parametrize("failure", [None, "prefix", "executable", "python", "isolated", "packages", "package_roots", "sync"])
def test_prepare_locked_environment_verifies_sync_interpreter_and_installed_closure(runner, monkeypatch, tmp_path, failure):
    root = tmp_path / "source"
    root.mkdir()
    (root / "uv.lock").write_text("version = 1\n")
    directory = tmp_path / "environment"
    python = directory / ("Scripts/python.exe" if runner.os.name == "nt" else "bin/python")
    inventory = {
        "prefix": str(directory), "executable": str(python),
        "base_executable": str(Path(getattr(sys, "_base_executable", sys.executable)).resolve()),
        "python": runner.platform.python_version(), "implementation": runner.platform.python_implementation(),
        "isolated": True, "packages": {"numpy": "1.0"},
        "package_roots": {"numpy": str(directory / "lib/site-packages")},
    }
    if failure in {"prefix", "executable", "python"}:
        inventory[failure] = "wrong"
    elif failure == "isolated":
        inventory[failure] = False
    elif failure == "packages":
        inventory[failure] = {"unexpected": "9.0"}
    elif failure == "package_roots":
        inventory[failure] = {"numpy": str(tmp_path / "outside")}
    monkeypatch.setattr(runner.shutil, "which", lambda _: "/test/uv")
    monkeypatch.setattr(runner, "source_fingerprint", lambda _: {"uv.lock": "lock"})
    monkeypatch.setattr(runner, "runtime_lock_hash", lambda _: "runtime")
    monkeypatch.setattr(runner, "runtime_lock_projection", lambda _: {"packages": [{"name": "numpy", "version": "1.0"}]})
    calls = []
    def checked(command, **kwargs):
        calls.append((command, kwargs))
        if failure == "sync" and "sync" in command:
            raise RuntimeError("sync failed")
        return subprocess.CompletedProcess(command, 0, json.dumps(inventory) if "--describe-environment" in command else "uv 0.11.29", "")
    monkeypatch.setattr(runner, "checked_process", checked)
    if failure:
        with pytest.raises((ValueError, RuntimeError)):
            runner.prepare_locked_environment(root, directory)
        return
    environment = runner.prepare_locked_environment(root, directory)
    command = environment["sync_command"]
    for flag in ("--locked", "--no-dev", "--no-default-groups", "--no-install-project", "--no-python-downloads"):
        assert flag in command
    assert command[command.index("--extra") + 1] == "app"
    assert command[command.index("--python") + 1] == str(Path(sys.executable).absolute())
    assert calls[1][0][:2] == [str(python), "-I"]
    assert calls[0][1]["env"]["UV_PROJECT_ENVIRONMENT"] == str(directory)
    assert environment["sync_check_command"] == [*command, "--check"]
    assert environment["sync_returncode"] == 0


@pytest.mark.parametrize("failure", [None, "inventory", "lock", "source", "origin"])
def test_measured_locked_process_must_match_verified_environment(runner, monkeypatch, tmp_path, failure):
    source = tmp_path / "source"
    python = tmp_path / "venv/bin/python"
    # A real symlink ensures the command keeps the venv executable path.
    python.parent.mkdir(parents=True)
    python.symlink_to(sys.executable)
    environment = {
        "python": str(python), "source_root": str(source), "inventory": {"prefix": str(python.parent.parent)},
        "process_environment": {"SECRET": "never-in-report"},
        "uv_lock_sha256": "lock", "runtime_lock_sha256": "runtime",
    }
    report = {"provenance": {
        "python_environment": deepcopy(environment["inventory"]), "uv_lock_sha256": "lock",
        "scientific_source_root": str(source), "scientific_import_origin": str(source / "src/reliability/__init__.py")},
        "comparison_context": {"runtime_lock_sha256": "runtime"}}
    if failure == "inventory":
        report["provenance"]["python_environment"]["prefix"] = "outside"
    elif failure == "lock":
        report["comparison_context"]["runtime_lock_sha256"] = "changed"
    elif failure == "source":
        report["provenance"]["scientific_source_root"] = "other"
    elif failure == "origin":
        report["provenance"]["scientific_import_origin"] = str(tmp_path / "wrong/__init__.py")
    verified = []
    monkeypatch.setattr(runner, "verify_locked_environment", lambda env: verified.append(env))
    def run(command, **kwargs):
        assert command[:2] == [str(python), "-I"]
        assert kwargs["env"] == environment["process_environment"]
        assert "--locked-environment-prefix" in command
        Path(command[command.index("--output") + 1]).write_text(json.dumps(report))
        return subprocess.CompletedProcess(command, 0, "", "")
    monkeypatch.setattr(runner.subprocess, "run", run)
    if failure:
        with pytest.raises(ValueError, match="differs from"):
            runner.measure_source_block(source, 3, ["case"], environment)
    else:
        measured = runner.measure_source_block(source, 3, ["case"], environment)
        assert "SECRET" not in json.dumps(measured)
        assert len(verified) == 2
