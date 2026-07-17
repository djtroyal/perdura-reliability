#!/usr/bin/env python3
"""Refresh the bundled demo with canonical NIST cases and current slice data."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEMO_PATH = ROOT / "gui" / "frontend" / "src" / "data" / "demoProject.json"
CATALOG_PATH = (
    ROOT / "gui" / "frontend" / "src" / "data" / "exampleDatasets"
    / "catalog.generated.json"
)

CANONICAL_EXAMPLES = [
    "nist-fuller2-life",
    "nist-tob201-125-degradation",
    "nist-battadd3-rm-anova",
    "nist-anscombe-modeling",
    "nist-ccxbar-spc",
    "nist-clear-capability",
    "nist-splett-factorial",
]

CREAM_LEVELS = {
    "organisation": "deficient",
    "working_conditions": "incompatible",
    "mmi_support": "inappropriate",
    "procedures": "acceptable",
    "simultaneous_goals": "matching_capacity",
    "available_time": "continuously_inadequate",
    "time_of_day": "day_adjusted",
    "training_experience": "inadequate",
    "crew_collaboration": "efficient",
}

CURRENT_SLICE_EXAMPLES: dict[str, Any] = {
    "maintVirtualAge": {
        "alpha": "1000", "beta": "2.5", "horizon": "5000", "interval": "750",
        "qCM": "0.6", "qPM": "0.2", "costCM": "10", "costPM": "2",
        "downCM": "8", "downPM": "2", "simulations": "2000", "seed": "42",
        "result": None,
    },
    "hraSparH": {
        "taskType": "diagnosis",
        "psfs": {
            "available_time": "nominal", "stress": "high",
            "complexity": "highly_complex", "experience": "low",
            "procedures": "available_poor", "ergonomics": "nominal",
            "fitness": "nominal", "work_processes": "nominal",
        },
        "dependencyEnabled": True, "dependencyMode": "context",
        "dependencyLevel": "low", "sameCrew": True, "closeInTime": True,
        "sameLocation": False, "additionalCues": True, "failureNumber": "2",
        "dependencyJustification": "Same crew response shortly after the preceding human failure event.",
        "uncertaintyConfidence": "0.95", "result": None,
    },
    "hraCream": {"levels": CREAM_LEVELS, "result": None},
    "hraCreamExt": {
        "levels": {**CREAM_LEVELS, "organisation": "efficient", "working_conditions": "compatible"},
        "steps": [
            {"description": "Diagnose the alarm pattern", "activity": "diagnose", "failure_type": "I1"},
            {"description": "Select the response procedure", "activity": "plan", "failure_type": "P2"},
            {"description": "Isolate the affected train", "activity": "execute", "failure_type": "E5"},
            {"description": "Verify system response", "activity": "verify", "failure_type": "O3"},
        ],
        "result": None,
    },
    "library": {
        "missionHours": "8760",
        "items": [
            {"id": "demo-manual", "name": "Manual reliability target", "kind": "manual", "value": 0.99,
             "source": "Perdura demo input"},
            {"id": "demo-weibull", "name": "Bearing life model", "kind": "distribution",
             "distribution": "Weibull_2P", "params": {"eta": 1200, "beta": 2.4},
             "source": "Perdura demo distribution snapshot"},
            {"id": "demo-lambda", "name": "Controller constant rate", "kind": "lambda",
             "lambdaFpmh": 12.5, "source": "Perdura demo prediction snapshot"},
        ],
    },
    "reportBuilder": {
        "reports": [{
            "id": "demo-report",
            "title": "Perdura Demonstration Summary",
            "blocks": [
                {"id": "demo-heading", "type": "heading", "text": "Demonstration Project", "level": 1},
                {"id": "demo-text", "type": "text",
                 "content": "This project combines traceable NIST datasets with representative engineering models across Perdura."},
                {"id": "demo-table", "type": "table", "label": "Bundled NIST cases",
                 "headers": ["Area", "Dataset"],
                 "rows": [
                     ["Life Data Analysis", "FULLER2.DAT"],
                     ["Degradation", "TOB201.DAT — 125 °C"],
                     ["Hypothesis Tests", "BATTADD3.DAT"],
                     ["Statistical Modeling", "ANSCOMBE.DAT"],
                     ["SPC", "CCXBAR.DAT"],
                     ["Process Capability", "CLEAR.DAT"],
                     ["DOE", "SPLETT.DAT"],
                 ]},
                {"id": "demo-divider", "type": "divider"},
                {"id": "demo-metrics", "type": "metrics", "label": "Project coverage",
                 "items": [
                     {"label": "NIST source cases", "value": "7"},
                     {"label": "Project units", "value": "hours"},
                     {"label": "Analysis status", "value": "Inputs ready to run"},
                 ]},
            ],
            "pageFormat": {"orientation": "portrait", "pageSize": "letter", "margin": 15},
            "header": {"enabled": True, "left": "Perdura", "center": "Demo Project", "right": "{date}",
                       "showDate": True, "dateFormat": "YYYY-MM-DD", "showPageNumber": False, "fontSize": 8},
            "footer": {"enabled": True, "left": "", "center": "", "right": "Page {page} of {pages}",
                       "showDate": False, "dateFormat": "YYYY-MM-DD", "showPageNumber": True, "fontSize": 8},
        }],
        "activeReportId": "demo-report",
        "collapsed": {},
    },
}


def active_folio_state(modules: dict[str, Any], key: str) -> dict[str, Any]:
    wrapped = modules[key]
    if not wrapped.get("_folioWrap"):
        raise ValueError(f"Expected {key} to use the current folio wrapper")
    active_id = wrapped["activeId"]
    return next(folio["state"] for folio in wrapped["folios"] if folio["id"] == active_id)


def modernize_existing_slices(modules: dict[str, Any]) -> None:
    alt = active_folio_state(modules, "alt")
    alt.update({"uncertaintyMethod": "delta", "bootstrapSamples": "200"})

    prediction = active_folio_state(modules, "prediction")
    prediction.update({"contributionScope": "system", "contributionBlockIds": []})

    # Reliability Allocation adopted the common folio container after the
    # original demo was authored. Store the current shape directly instead of
    # relying on the runtime legacy migration path.
    allocation = modules["reliabilityAllocation"]
    if not allocation.get("_folioWrap"):
        modules["reliabilityAllocation"] = {
            "_folioWrap": True,
            "activeId": "f0",
            "folios": [{"id": "f0", "name": "Subsystem Allocation", "state": allocation}],
        }

    modules["ram"]["spares"].update({
        "model": "renewal_pipeline",
        "dispersion": "10",
        "renewalBasis": "weibull",
        "weibullAlpha": "50000",
        "weibullBeta": "1.8",
        "leadMean": "720",
        "leadStd": "168",
        "shockRate": "0.00001",
        "shockSize": "2",
        "simulations": "5000",
        "seed": "42",
    })
    modules["sixSigma.capability"].update({
        "stability": "assess", "bootstrapSamples": "200",
    })
    modules["msa"]["topology"] = "crossed"


def expected_demo() -> dict[str, Any]:
    demo = json.loads(DEMO_PATH.read_text(encoding="utf-8"))
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    entries = {entry["id"]: entry for entry in catalog["entries"]}
    for example_id in CANONICAL_EXAMPLES:
        try:
            modules = entries[example_id]["payload"]["modules"]
        except KeyError as exc:
            raise ValueError(f"Missing canonical catalog example {example_id}") from exc
        demo["modules"].update(modules)
    modernize_existing_slices(demo["modules"])
    demo["modules"].update(CURRENT_SLICE_EXAMPLES)
    demo.update({
        "app": "reliability-suite",
        "version": 1,
        "project": "Perdura Demo Project",
        "units": "hours",
        "exported": "2026-07-12T00:00:00.000Z",
    })
    return demo


def render(value: Any) -> str:
    return json.dumps(value, indent=2, ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if not args.write and not args.check:
        parser.error("choose --write and/or --check")
    expected = render(expected_demo())
    if args.write:
        DEMO_PATH.write_text(expected, encoding="utf-8")
    if args.check and DEMO_PATH.read_text(encoding="utf-8") != expected:
        raise SystemExit("Bundled demo project is stale; run tools/refresh_demo_project.py --write")
    print("Demo project refreshed with 7 canonical NIST cases and all current persisted slices.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
