#!/usr/bin/env python3
"""Build deterministic Perdura imports from curated NIST Dataplot tables.

The checked-in CSV files are normalized, numeric-only snapshots of the official
NIST ``.DAT`` files.  ``--write-sources`` reconstructs those snapshots from a
directory of downloaded raw files after verifying each official-file digest.
Ordinary ``--write`` and ``--check`` operation is completely offline.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "examples" / "nist" / "manifest.json"
SOURCE_DIR = ROOT / "examples" / "nist" / "source"
IMPORT_DIR = ROOT / "examples" / "nist" / "imports"
CATALOG_PATH = (
    ROOT / "gui" / "frontend" / "src" / "data" / "exampleDatasets"
    / "catalog.generated.json"
)
EXPORTED_AT = "2026-07-12T00:00:00.000Z"
NUMBER = re.compile(r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_manifest() -> dict[str, Any]:
    with MANIFEST_PATH.open(encoding="utf-8") as handle:
        manifest = json.load(handle)
    if manifest.get("schemaVersion") != 1:
        raise ValueError("Unsupported NIST example manifest version.")
    return manifest


def numeric_rows(raw: str, column_count: int, serial_layout: bool = False) -> list[list[str]]:
    """Extract lines made entirely of the expected number of numeric tokens."""
    lines = raw.splitlines()
    if serial_layout:
        separators = [i for i, line in enumerate(lines) if re.fullmatch(r"\s*-{5,}\s*", line)]
        if not separators:
            raise ValueError("Serialized NIST table has no header separator.")
        values: list[list[str]] = []
        for line in lines[separators[-1] + 1:]:
            fields = line.strip().split()
            if fields and all(NUMBER.fullmatch(value) for value in fields):
                values.extend([[value] for value in fields])
        return values
    rows: list[list[str]] = []
    for line in lines:
        fields = line.strip().split()
        if len(fields) == column_count and all(NUMBER.fullmatch(v) for v in fields):
            rows.append(fields)
    return rows


def refresh_sources(manifest: dict[str, Any], raw_dir: Path) -> None:
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    for source in manifest["sources"]:
        raw_path = raw_dir / source["filename"]
        if not raw_path.is_file():
            raise FileNotFoundError(f"Missing raw NIST file: {raw_path}")
        raw_bytes = raw_path.read_bytes()
        actual = sha256(raw_bytes)
        if actual != source["rawSha256"]:
            raise ValueError(
                f"Raw checksum mismatch for {source['filename']}: "
                f"expected {source['rawSha256']}, got {actual}"
            )
        columns = source["columns"]
        rows = numeric_rows(
            raw_bytes.decode("utf-8", errors="replace"),
            len(columns),
            bool(source.get("serialLayout")),
        )
        if len(rows) != source["rowCount"]:
            raise ValueError(
                f"Parsed {len(rows)} rows from {source['filename']}; "
                f"expected {source['rowCount']}"
            )
        with (SOURCE_DIR / f"{source['id']}.csv").open(
            "w", newline="", encoding="utf-8"
        ) as handle:
            writer = csv.writer(handle, lineterminator="\n")
            writer.writerow(columns)
            writer.writerows(rows)


def read_sources(manifest: dict[str, Any]) -> dict[str, list[dict[str, str]]]:
    result: dict[str, list[dict[str, str]]] = {}
    for source in manifest["sources"]:
        path = SOURCE_DIR / f"{source['id']}.csv"
        if not path.is_file():
            raise FileNotFoundError(
                f"Missing normalized source {path}; use --write-sources with raw .DAT files."
            )
        with path.open(newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            if reader.fieldnames != source["columns"]:
                raise ValueError(
                    f"Columns for {source['id']} are {reader.fieldnames}; "
                    f"expected {source['columns']}"
                )
            rows = list(reader)
        if len(rows) != source["rowCount"]:
            raise ValueError(
                f"Normalized row count for {source['id']} is {len(rows)}; "
                f"expected {source['rowCount']}"
            )
        for index, row in enumerate(rows, start=1):
            for column, value in row.items():
                if value is None or not NUMBER.fullmatch(value.strip()):
                    raise ValueError(
                        f"Non-numeric value in {source['id']} row {index}, {column}: {value!r}"
                    )
        result[source["id"]] = rows
    return result


def number(value: str) -> int | float:
    parsed = float(value)
    return int(parsed) if parsed.is_integer() else parsed


def default_spec() -> dict[str, Any]:
    return {
        "distribution": "Weibull_2P",
        "params": {"eta": "100", "beta": "2"},
        "n": "20",
        "seed": "",
        "includeSuspensions": False,
        "suspensionRate": "20",
        "genMode": "replace",
        "mcMode": "single",
        "mcVariables": [
            {"id": "mv1", "name": "A", "distribution": "Normal_2P", "params": {"mu": "100", "sigma": "10"}},
            {"id": "mv2", "name": "B", "distribution": "Normal_2P", "params": {"mu": "100", "sigma": "10"}},
        ],
        "mcEquation": "A + B",
        "mcId": "",
    }


def life_payload(example: dict[str, Any], rows: list[dict[str, str]]) -> dict[str, Any]:
    censored = example["transform"] == "life_censored"
    data_rows = []
    for index, row in enumerate(rows, start=1):
        state = "F" if not censored or row["event"] == "1" else "S"
        data_rows.append({
            "key": f"{example['source']}-{index}",
            "id": str(index),
            "time": row["time"],
            "state": state,
        })
    folio = {
        "id": "folio1",
        "name": example["title"],
        "rows": data_rows,
        "dataFormat": "individual",
        "frequencyRows": [],
        "intervalRows": [],
        "method": "MLE",
        "ci": 0.95,
        "ciText": "0.95",
        "selectedDists": [
            "Weibull_2P", "Lognormal_2P", "Gamma_2P", "Loglogistic_2P",
            "Normal_2P", "Exponential_1P", "Gumbel_2P",
        ],
        "analysisMode": "parametric",
        "npMethod": "KM",
        "specialModel": "mixture",
        "weibayesBeta": "2.0",
        "weibayesUncertaintyMethod": "fixed",
        "weibayesBetaLower": "1.5",
        "weibayesBetaUpper": "2.5",
        "weibayesBetaSd": "0.25",
        "weibayesSamples": "4000",
        "cfmDist": "Weibull_2P",
        "cfmReliabilityTime": "",
        "dataSource": "table",
        "spec": default_spec(),
        "setDist": None,
        "showSalient": True,
        "showSuspensions": censored,
        "showStats": True,
        "fitComparisonOpen": False,
        "fitComparisonView": "CDF",
        "fitComparisonHidden": [],
        "fitComparisonShowData": True,
        "fitTableCollapsed": False,
    }
    return {
        "lifeData": {
            "folios": [folio],
            "activeId": "folio1",
            "folioSeq": 1,
            "compare": {
                "folioIds": [], "commonDistribution": "",
                "commonDistributionManual": False, "commonExpanded": False,
                "ciText": "0.95", "ci": 0.95,
            },
        }
    }


def degradation_payload(
    example: dict[str, Any], rows: list[dict[str, str]]
) -> dict[str, Any]:
    if example["transform"] == "degradation_tob201":
        temperature = example["filter"]["temperature"]
        selected = [r for r in rows if r["temperature"] == temperature]
        converted = [
            {"unit": r["component"], "time": r["time"], "meas": r["degradation"]}
            for r in selected
        ]
        threshold, direction, rel_time = "30", "above", "200"
    else:
        converted = [
            {"unit": r["component"], "time": r["time"], "meas": r["threshold_voltage"]}
            for r in rows
        ]
        threshold, direction, rel_time = "0.5", "below", "1500"
    return {
        "degradation": {
            "mode": "nondestructive",
            "nd": {
                "rows": converted,
                "threshold": threshold,
                "direction": direction,
                "model": "linear",
                "dist": "Best_Fit",
                "relTime": rel_time,
                "ci": "0.95",
                "result": None,
            },
            "dest": {
                "rows": [{"time": "", "meas": ""} for _ in range(5)],
                "threshold": "150",
                "direction": "below",
                "model": "linear",
                "dist": "Best_Fit",
                "relTime": "5",
                "result": None,
            },
        }
    }


def doe_state(
    *, category: str, design_key: str, factors: list[str], runs: list[dict[str, int | float]],
    responses: list[str], metadata: dict[str, Any], q: str = "3", degree: str = "2",
) -> dict[str, Any]:
    columns = {factor: [run[factor] for run in runs] for factor in factors}
    return {
        "doe": {
            "category": category,
            "designKey": design_key,
            "factors": [
                {"name": name, "low": "-1", "high": "1", "levels": "2"}
                for name in factors
            ],
            "generators": "D=ABC",
            "fraction": "1",
            "centerPoints": "3",
            "alpha": "face",
            "customAlpha": "1.414",
            "q": q,
            "degree": degree,
            "mixtureLower": ",".join("0" for _ in factors),
            "mixtureUpper": ",".join("1" for _ in factors),
            "taguchiArray": "L8",
            "randomize": False,
            "seed": "",
            "nBlocks": "1",
            "standardizedCoefficient": "0.5",
            "powerAlpha": "0.05",
            "targetPower": "0.80",
            "result": {
                "columns": columns,
                "runs": runs,
                "factor_names": factors,
                "metadata": {
                    "contract_version": 2,
                    "run_count": len(runs),
                    "factor_names": factors,
                    "coding": "mixture_proportions_sum_to_one"
                    if metadata["design_class"] == "mixture" else "coded_numeric",
                    **metadata,
                },
            },
            "responses": responses,
            "analysis": None,
        }
    }


def doe_payload(example: dict[str, Any], rows: list[dict[str, str]]) -> dict[str, Any]:
    transform = example["transform"]
    if transform == "doe_splett":
        factors = ["Power", "Pressure", "Oxygen"]
        runs = [
            {"Power": number(r["power"]), "Pressure": number(r["pressure"]), "Oxygen": number(r["oxygen"])}
            for r in rows
        ]
        return doe_state(
            category="Screening", design_key="full_factorial_2level",
            factors=factors, runs=runs, responses=[r["underetch"] for r in rows],
            metadata={
                "design_type": "NIST 2^3 full factorial — chip underetch",
                "generator_key": "full_factorial_2level",
                "design_class": "screening",
                "analysis_model": "factorial_main_plus_2fi",
                "source_run_order": [number(r["run_order"]) for r in rows],
            },
        )
    if transform == "doe_bennett2":
        factors = ["Log-density (coded)", "AlAs fraction (coded)"]
        runs = []
        for row in rows:
            # The source density settings are logarithmically spaced from 1 to
            # 10,000. Code log10(density) and the 0..0.30 mole fraction onto a
            # common [-1, 1] scale for a numerically stable quadratic surface.
            coded_density = math.log10(float(row["acceptor_density"])) / 2 - 1
            coded_fraction = float(row["alas_fraction"]) / 0.15 - 1
            runs.append({
                factors[0]: round(coded_density, 12),
                factors[1]: round(coded_fraction, 12),
            })
        return doe_state(
            category="Optimization", design_key="central_composite",
            factors=factors, runs=runs, responses=[r["mobility"] for r in rows],
            metadata={
                "design_type": "NIST response surface — electron mobility",
                "generator_key": "imported_response_surface",
                "design_class": "response_surface",
                "analysis_model": "full_quadratic",
                "source_factor_transform": {
                    "Log-density (coded)": "log10(acceptor_density) / 2 - 1",
                    "AlAs fraction (coded)": "alas_fraction / 0.15 - 1",
                },
                "source_factor_ranges": {
                    "acceptor_density": [1, 10000], "alas_fraction": [0, 0.3],
                },
            },
        )
    if transform == "doe_cornel35":
        factors = ["Component 1", "Component 2", "Component 3"]
        runs = []
        for row in rows:
            values = [number(row[f"component_{i}"]) for i in range(1, 4)]
            if abs(sum(float(v) for v in values) - 0.999) < 1e-9:
                values = [1 / 3, 1 / 3, 1 / 3]
            runs.append(dict(zip(factors, values)))
        return doe_state(
            category="Mixture", design_key="simplex_centroid",
            factors=factors, runs=runs, responses=[r["survival"] for r in rows],
            metadata={
                "design_type": "NIST simplex-centroid — pesticide composition",
                "generator_key": "simplex_centroid",
                "design_class": "mixture",
                "analysis_model": "scheffe_quadratic",
                "source_centroid": [0.333, 0.333, 0.333],
                "analysis_constraints": {"lower": [0, 0, 0], "upper": [1, 1, 1]},
            },
        )
    raise ValueError(f"Unknown DOE transform {transform}")


def hypothesis_payload(rows: list[dict[str, str]]) -> dict[str, Any]:
    by_battery: dict[str, dict[str, str]] = defaultdict(dict)
    for row in rows:
        by_battery[row["battery"]][row["additive"]] = row["watt_hours"]
    matrix = [
        " ".join(by_battery[battery][additive] for additive in ("1", "2", "3"))
        for battery in sorted(by_battery, key=float)
    ]
    return {
        "hypothesis": {
            "testKey": "rm_anova",
            "alpha": "0.05",
            "alternative": "two-sided",
            "dataText": "",
            "popmean": "0",
            "groupAText": "",
            "groupBText": "",
            "equalVar": False,
            "kGroupsText": "",
            "observedText": "",
            "expectedText": "",
            "useExpected": False,
            "tableText": "",
            "successesText": "",
            "nText": "",
            "pText": "0.5",
            "factorialTableText": "",
            "factorialResponse": "",
            "factorialFactors": "",
            "rmTableText": "\n".join(matrix),
            "mixedTableText": "",
            "mixedSubject": "subject",
            "mixedBetween": "between",
            "mixedWithin": "within",
            "mixedValue": "value",
            "result": None,
            "error": None,
        }
    }


def data_analysis_payload(
    example: dict[str, Any], rows: list[dict[str, str]]
) -> dict[str, Any]:
    transform = example["transform"]
    if transform == "modeling_anscombe":
        columns = ["x1", "y1", "x2", "y2", "x3", "y3", "x4", "y4"]
        target, features = "y1", ["x1"]
        models = ["linear", "ridge", "polynomial", "decision_tree"]
        tabs = ["summary", "scatter", "correlation"]
    elif transform == "modeling_boxbod":
        columns = ["incubation_days", "bod"]
        target, features = "bod", ["incubation_days"]
        models = ["polynomial", "linear", "gradient_boosting"]
        tabs = ["summary", "scatter", "runchart"]
    elif transform == "modeling_ehrlich":
        columns = ["pressure", "gage", "effective_area"]
        target, features = "effective_area", ["pressure", "gage"]
        models = ["linear", "ridge", "random_forest"]
        tabs = ["summary", "scatter", "correlation"]
    else:
        raise ValueError(f"Unknown modeling transform {transform}")
    grid_rows = [{column: row[column] for column in columns} for row in rows]
    descriptive = {
        "histBins": "",
        "freqBins": "",
        "freqColIdx": "0",
        "ctRowColIdx": "0",
        "ctColColIdx": "1",
        "analyzeColIdx": str(columns.index(target)),
        "activeTabs": tabs,
        "results": {
            "summary": None, "histogram": None, "boxplot": None,
            "runchart": None, "frequency": None, "contingency": None,
        },
    }
    modeling = {
        "schemaVersion": 2,
        "stage": "prepare",
        "target": target,
        "features": features,
        "task": "regression",
        "models": models,
        "missingPolicy": "impute_indicator",
        "validationStrategy": "auto",
        "groupColumn": "",
        "timeColumn": "",
        "tuningBudget": "standard",
        "seed": 42,
        "selectionMetric": "rmse",
        "positiveClass": "",
        "useDecisionCosts": False,
        "falsePositiveCost": 1,
        "falseNegativeCost": 1,
        "calibration": "none",
        "confidence": 0.95,
        "confidenceText": "0.95",
        "run": None,
        "selectedModel": None,
        "finalized": None,
        "assets": [],
        "dataSig": None,
        "legacyResultCount": 0,
    }
    return {
        "dataAnalysisData": {"columns": columns, "rows": grid_rows},
        "descriptive": descriptive,
        "dataModeling": modeling,
        "dataAnalysisFolios": {
            "analyses": [{"id": "a0", "name": example["title"]}],
            "activeId": "a0",
            "snapshots": {},
            "dirty": {},
        },
    }


def spc_payload(transform: str, rows: list[dict[str, str]]) -> dict[str, Any]:
    if transform == "spc_ccxbar":
        grouped: dict[str, list[str]] = defaultdict(list)
        for row in rows:
            grouped[row["day"]].append(row["thickness"])
        chart = "xbar_r"
        converted = []
        for day in sorted(grouped, key=float):
            values = grouped[day]
            if len(values) != 5:
                raise ValueError(f"CCXBAR day {day} has {len(values)} values, expected 5")
            converted.append(dict(zip(("a", "b", "c", "d", "e"), values), size=""))
    elif transform == "spc_ccp":
        chart = "p"
        converted = [
            {"a": r["defective"], "b": "", "c": "", "d": "", "e": "", "size": r["inspected"]}
            for r in rows
        ]
    elif transform == "spc_ccu":
        chart = "u"
        converted = [
            {"a": r["defects"], "b": "", "c": "", "d": "", "e": "", "size": r["inspection_size"]}
            for r in rows
        ]
    else:
        raise ValueError(f"Unknown SPC transform {transform}")
    return {
        "sixSigma.spc": {
            "chart": chart,
            "phase": "phase_i",
            "rows": converted,
            "baselineRows": [],
            "removeSignals": False,
            "result": None,
        }
    }


def capability_payload(rows: list[dict[str, str]]) -> dict[str, Any]:
    return {
        "sixSigma.capability": {
            "rows": [{"x": row["clearance"]} for row in rows],
            "lsl": "0",
            "usl": "13",
            "target": "0",
            "subgroup": "1",
            "stability": "assess",
            "bootstrapSamples": "200",
            "result": None,
        }
    }


def build_modules(example: dict[str, Any], rows: list[dict[str, str]]) -> dict[str, Any]:
    transform = example["transform"]
    if transform.startswith("life_"):
        return life_payload(example, rows)
    if transform.startswith("degradation_"):
        return degradation_payload(example, rows)
    if transform.startswith("doe_"):
        return doe_payload(example, rows)
    if transform == "hypothesis_battadd3":
        return hypothesis_payload(rows)
    if transform.startswith("modeling_"):
        return data_analysis_payload(example, rows)
    if transform.startswith("spc_"):
        return spc_payload(transform, rows)
    if transform == "capability_clear":
        return capability_payload(rows)
    raise ValueError(f"Unknown transform {transform}")


def json_text(value: Any) -> str:
    return json.dumps(value, indent=2, ensure_ascii=False) + "\n"


def build_outputs(
    manifest: dict[str, Any], source_rows: dict[str, list[dict[str, str]]]
) -> tuple[dict[Path, str], list[dict[str, Any]]]:
    sources = {source["id"]: source for source in manifest["sources"]}
    outputs: dict[Path, str] = {}
    catalog: list[dict[str, Any]] = []
    for example in manifest["examples"]:
        source = sources[example["source"]]
        rows = source_rows[source["id"]]
        modules = build_modules(example, rows)
        payload = {
            "app": "reliability-suite",
            "version": 1,
            "project": example["title"],
            "units": example["units"],
            "exported": EXPORTED_AT,
            "modules": modules,
        }
        outputs[IMPORT_DIR / f"{example['id']}.json"] = json_text(payload)

        source_csv = (SOURCE_DIR / f"{source['id']}.csv").read_bytes()
        row_count = next(iter(modules.values()))
        if example["transform"].startswith("degradation_"):
            display_rows = len(row_count["nd"]["rows"])
        elif example["transform"].startswith("doe_"):
            display_rows = len(row_count["result"]["runs"])
        elif example["transform"].startswith("spc_"):
            display_rows = len(row_count["rows"])
        elif example["transform"] == "capability_clear":
            display_rows = len(row_count["rows"])
        elif example["transform"].startswith("life_"):
            display_rows = len(row_count["folios"][0]["rows"])
        elif example["transform"] == "hypothesis_battadd3":
            display_rows = len(row_count["rmTableText"].splitlines())
        else:
            display_rows = len(modules["dataAnalysisData"]["rows"])
        catalog.append({
            "id": example["id"],
            "title": example["title"],
            "description": example["description"],
            "targetModule": example["targetModule"],
            "targetLabel": example["targetLabel"],
            "targetSlices": list(modules),
            "subtool": example["subtool"],
            "category": example["category"],
            "units": example["units"],
            "rowCount": display_rows,
            "variables": example["variables"],
            "transformation": example["transformation"],
            "source": {
                "id": source["id"],
                "filename": source["filename"],
                "title": source["title"],
                "url": source["url"],
                "rawSha256": source["rawSha256"],
                "normalizedSha256": sha256(source_csv),
            },
            "payload": payload,
        })
    outputs[CATALOG_PATH] = json_text({
        "schemaVersion": 1,
        "sourcePage": manifest["sourcePage"],
        "entries": catalog,
    })
    return outputs, catalog


def write_outputs(outputs: dict[Path, str]) -> None:
    for path, content in outputs.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")


def check_outputs(outputs: dict[Path, str]) -> None:
    stale = []
    for path, expected in outputs.items():
        actual = path.read_text(encoding="utf-8") if path.is_file() else None
        if actual != expected:
            stale.append(path.relative_to(ROOT))
    expected_imports = {path.resolve() for path in outputs if path.parent == IMPORT_DIR}
    if IMPORT_DIR.is_dir():
        for path in IMPORT_DIR.glob("*.json"):
            if path.resolve() not in expected_imports:
                stale.append(path.relative_to(ROOT))
    if stale:
        joined = "\n  ".join(str(path) for path in stale)
        raise ValueError(f"Generated NIST example files are stale or missing:\n  {joined}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-dir", type=Path, help="Directory containing official NIST .DAT files")
    parser.add_argument("--write-sources", action="store_true", help="Rebuild normalized CSV snapshots")
    parser.add_argument("--write", action="store_true", help="Write standalone imports and GUI catalog")
    parser.add_argument("--check", action="store_true", help="Verify committed generated files")
    args = parser.parse_args()
    if args.write_sources:
        if args.raw_dir is None:
            parser.error("--write-sources requires --raw-dir")
        refresh_sources(load_manifest(), args.raw_dir)
    manifest = load_manifest()
    rows = read_sources(manifest)
    outputs, catalog = build_outputs(manifest, rows)
    if args.write:
        write_outputs(outputs)
    if args.check:
        check_outputs(outputs)
    if not args.write and not args.check:
        parser.error("choose --write and/or --check")
    print(f"Validated {len(manifest['sources'])} NIST sources and {len(catalog)} Perdura examples.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1)
