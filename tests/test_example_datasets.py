"""Integrity and executable-smoke tests for bundled NIST examples and demo data."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np

from reliability.DOE import analyze_experiment
from reliability.Hypothesis_tests import repeated_measures_anova
from reliability.Process_capability import process_capability
from reliability.SPC import control_chart


ROOT = Path(__file__).resolve().parents[1]
NIST_DIR = ROOT / "examples" / "nist"
CATALOG_PATH = ROOT / "gui" / "frontend" / "src" / "data" / "exampleDatasets" / "catalog.generated.json"
DEMO_PATH = ROOT / "gui" / "frontend" / "src" / "data" / "demoProject.json"
COVERAGE_PATH = ROOT / "gui" / "frontend" / "src" / "data" / "demoCoverage.json"


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def catalog_entries():
    return load(CATALOG_PATH)["entries"]


def by_id():
    return {entry["id"]: entry for entry in catalog_entries()}


def test_generated_nist_assets_are_current():
    subprocess.run(
        [sys.executable, str(ROOT / "tools" / "build_nist_examples.py"), "--check"],
        cwd=ROOT, check=True,
    )


def test_demo_refresh_is_current():
    subprocess.run(
        [sys.executable, str(ROOT / "tools" / "refresh_demo_project.py"), "--check"],
        cwd=ROOT, check=True,
    )


def test_manifest_sources_and_catalog_provenance_match():
    manifest = load(NIST_DIR / "manifest.json")
    sources = {source["id"]: source for source in manifest["sources"]}
    assert len(sources) == 16
    assert len(catalog_entries()) == 17
    for source_id, source in sources.items():
        csv_path = NIST_DIR / "source" / f"{source_id}.csv"
        assert csv_path.is_file()
        lines = csv_path.read_text(encoding="utf-8").splitlines()
        assert lines[0].split(",") == source["columns"]
        assert len(lines) - 1 == source["rowCount"]
        assert re.fullmatch(r"[0-9a-f]{64}", source["rawSha256"])

    for entry in catalog_entries():
        source = sources[entry["source"]["id"]]
        csv_bytes = (NIST_DIR / "source" / f"{source['id']}.csv").read_bytes()
        assert entry["source"]["url"] == source["url"]
        assert entry["source"]["rawSha256"] == source["rawSha256"]
        assert entry["source"]["normalizedSha256"] == hashlib.sha256(csv_bytes).hexdigest()

    # The official BENNETT2 header says 154, but the checksummed file contains
    # seven curves × 21 values = 147. Preserve and disclose that discrepancy.
    assert sources["bennett2"]["rowCount"] == 147
    assert sources["bennett2"]["sourceHeaderRowCount"] == 154


def test_every_catalog_entry_is_a_standalone_module_import():
    for entry in catalog_entries():
        payload = entry["payload"]
        assert payload["app"] == "Perdura"
        assert payload["subtitle"] == "Reliability Engineering and Statistics Suite"
        assert payload["website"] == "https://perdurareliability.com"
        assert payload["schemaVersion"] == 4
        assert payload["createdWith"]["version"]
        assert payload["engineRevisions"] == {
            key: 1 for key in payload["modules"]
        }
        assert "version" not in payload
        assert payload["identity"]["projectId"].startswith("prj-example-")
        assert payload["analysisRuns"] == []
        assert payload["exportLedger"] == []
        assert payload["modules"]
        assert list(payload["modules"]) == entry["targetSlices"]
        standalone = load(NIST_DIR / "imports" / f"{entry['id']}.json")
        assert standalone == payload


def test_life_data_examples_use_model_preserving_compare_state():
    life_data_states = [
        entry["payload"]["modules"]["lifeData"]
        for entry in catalog_entries()
        if "lifeData" in entry["payload"]["modules"]
    ]
    life_data_states.append(load(DEMO_PATH)["modules"]["lifeData"])

    for state in life_data_states:
        compare = state["compare"]
        assert compare["commonDistribution"] == ""
        assert compare["commonDistributionManual"] is False
        assert compare["commonExpanded"] is False
        assert compare["ci"] == 0.95
        assert "distribution" not in compare
        assert "result" not in compare


def test_transformations_preserve_supported_contracts_without_fabrication():
    entries = by_id()

    censored = entries["nist-tob99-censored-life"]["payload"]["modules"]["lifeData"]["folios"][0]["rows"]
    assert sum(row["state"] == "F" for row in censored) == 25
    assert sum(row["state"] == "S" for row in censored) == 25
    assert {row["time"] for row in censored if row["state"] == "S"} == {"3000.0"}

    for temperature in ("105", "125"):
        entry = entries[f"nist-tob201-{temperature}-degradation"]
        rows = entry["payload"]["modules"]["degradation"]["nd"]["rows"]
        assert len(rows) == 30
        assert len({row["unit"] for row in rows}) == 10
        assert all(set(row) == {"unit", "time", "meas"} for row in rows)

    # Grouped ALT count files are deliberately absent: the only Reliability
    # Testing imports are genuine degradation paths, never invented exact lives.
    for entry in catalog_entries():
        if entry["targetModule"] == "alt":
            assert set(entry["payload"]["modules"]) == {"degradation"}

    mixture = entries["nist-cornel35-mixture"]["payload"]["modules"]["doe"]["result"]["runs"]
    assert all(np.isclose(sum(run.values()), 1.0, atol=1e-12) for run in mixture)


def test_nist_doe_examples_execute_with_the_declared_analysis_contract():
    entries = by_id()
    ids = [
        "nist-splett-factorial",
        "nist-bennett2-response-surface",
        "nist-cornel35-mixture",
    ]
    expected_types = ["two_level_factorial", "response_surface", "mixture"]
    for example_id, expected_type in zip(ids, expected_types):
        state = entries[example_id]["payload"]["modules"]["doe"]
        design = state["result"]
        metadata = design["metadata"]
        result = analyze_experiment(
            design["runs"],
            [float(value) for value in state["responses"]],
            design["factor_names"],
            design_class=metadata["design_class"],
            constraints=metadata.get("analysis_constraints"),
        )
        assert result["analysis_type"] == expected_type
        assert np.isfinite(result["r2"])
        assert result["design_diagnostics"]["full_rank"] is True


def test_nist_hypothesis_and_spc_examples_execute():
    entries = by_id()
    state = entries["nist-battadd3-rm-anova"]["payload"]["modules"]["hypothesis"]
    matrix = [[float(value) for value in line.split()] for line in state["rmTableText"].splitlines()]
    result = repeated_measures_anova(matrix)
    assert result["n_subjects"] == 12
    assert result["n_conditions"] == 3
    assert np.isfinite(result["p_value"])

    for example_id in ("nist-ccxbar-spc", "nist-ccp-spc", "nist-ccu-spc"):
        state = entries[example_id]["payload"]["modules"]["sixSigma.spc"]
        rows, chart = state["rows"], state["chart"]
        if chart in {"xbar_r", "xbar_s"}:
            data = [[float(row[key]) for key in "abcde" if row[key]] for row in rows]
            result = control_chart(chart, data)
        else:
            result = control_chart(
                chart,
                [float(row["a"]) for row in rows],
                sizes=[float(row["size"]) for row in rows],
            )
        assert result["chart"] == chart
        assert len(result["subcharts"][0]["points"]) == 20

    capability = entries["nist-clear-capability"]["payload"]["modules"]["sixSigma.capability"]
    result = process_capability(
        [float(row["x"]) for row in capability["rows"]],
        lsl=float(capability["lsl"]),
        usl=float(capability["usl"]),
        target=float(capability["target"]),
        stability_status="not_assessed",
        bootstrap_samples=0,
    )
    assert result["n"] == 325
    assert np.isfinite(result["Cpk"])


def test_demo_covers_every_registered_persisted_slice():
    demo = load(DEMO_PATH)
    coverage = load(COVERAGE_PATH)
    modules = demo["modules"]
    required = set(coverage["requiredSlices"])
    assert required == set(modules)
    assert all(modules[key] is not None for key in required)

    # Literal persisted slice keys in components must be registered. Dynamic
    # keys such as faultTree are captured explicitly by demoCoverage.json.
    component_text = "\n".join(
        path.read_text(encoding="utf-8")
        for path in (ROOT / "gui" / "frontend" / "src" / "components").rglob("*.tsx")
    )
    literal_keys = set(re.findall(
        r"use(?:Module|Folio)State[^\n(]*\(\s*['\"]([^'\"]+)['\"]",
        component_text,
    ))
    assert literal_keys <= required

    assert modules["maintVirtualAge"]["simulations"]
    assert len(modules["hraSparH"]["psfs"]) == 8
    assert len(modules["hraCream"]["levels"]) == 9
    assert modules["hraCreamExt"]["steps"]
    assert modules["library"]["items"]
    assert modules["reportBuilder"]["reports"][0]["blocks"]
    assert modules["reliabilityAllocation"]["_folioWrap"] is True
    assert modules["ram"]["spares"]["model"] == "renewal_pipeline"
    assert modules["sixSigma.capability"]["stability"] == "assess"
    assert modules["msa"]["topology"] == "crossed"


def test_demo_uses_the_canonical_nist_payloads():
    modules = load(DEMO_PATH)["modules"]
    entries = by_id()
    canonical = [
        "nist-fuller2-life",
        "nist-tob201-125-degradation",
        "nist-battadd3-rm-anova",
        "nist-anscombe-modeling",
        "nist-ccxbar-spc",
        "nist-clear-capability",
        "nist-splett-factorial",
    ]
    for example_id in canonical:
        for slice_key, expected in entries[example_id]["payload"]["modules"].items():
            assert modules[slice_key] == expected
