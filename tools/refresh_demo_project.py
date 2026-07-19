#!/usr/bin/env python3
"""Refresh the bundled demo with canonical NIST cases and current slice data."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEMO_PATH = ROOT / "gui" / "frontend" / "src" / "data" / "demoProject.json"
EXAMPLE_DEMO_PATH = ROOT / "examples" / "demo-project.json"
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

PREDICTION_BLOCKS = [
    {
        "id": "b1",
        "name": "Controller Board Assembly",
        "parentId": None,
        "quantity": 1,
        "operatingFraction": 0.75,
        "environment": "GF",
        "nonoperatingEnvironment": "GB",
        "nonoperatingTemperatureC": 25,
        "powerCyclesPer1000NonoperatingHours": 0.5,
        "notes": (
            "Representative 75% operating / 25% nonoperating exposure. "
            "Operating rates use MIL-HDBK-217F; nonoperating rates use the "
            "selected RADC-TR-85-91 models."
        ),
    },
]

PREDICTION_PARTS = [
    {
        "category": "microcircuit",
        "name": "Microprocessor",
        "quantity": 1,
        "params": {
            "device_type": "microprocessor",
            "technology": "mos",
            "complexity": 32,
            "pins": 64,
            "package": "nonhermetic",
            "T_junction": 55,
            "quality": "commercial",
            "years_in_production": 3,
        },
        "apply_vita": None,
        "environment": None,
        "parentId": "b1",
        "nonoperating_params": {
            "model": "microelectronic_device",
            "device_type": "digital",
            "technology": "cmos",
            "complexity": 32,
            "package": "nonhermetic",
            "quality": "C-1",
        },
    },
    {
        "category": "resistor",
        "name": "Bias Resistors",
        "quantity": 24,
        "params": {
            "style": "RL",
            "rated_power": 0.25,
            "power_stress": 0.4,
            "case_temperature_c": 40,
            "quality": "commercial",
        },
        "apply_vita": None,
        "environment": None,
        "parentId": "b1",
        "nonoperating_params": {
            "model": "resistor",
            "style": "RL",
            "quality": "Lower",
        },
    },
    {
        "category": "capacitor",
        "name": "Decoupling Caps",
        "quantity": 16,
        "params": {
            "style": "CK",
            "capacitance_microfarads": 0.1,
            "voltage_stress": 0.4,
            "T_ambient": 40,
            "circuit_resistance_ohm_per_volt": 1.0,
            "quality": "commercial",
        },
        "apply_vita": None,
        "environment": None,
        "parentId": "b1",
        "nonoperating_params": {
            "model": "capacitor",
            "style": "CK",
            "quality": "Lower",
        },
    },
]


def _fta_event(event_id: str, label: str, x: int, y: int, *,
               probability: float = 0.01, dynamic: bool = False,
               description: str = "") -> dict[str, Any]:
    data: dict[str, Any] = {
        "label": label,
        "eventKey": event_id,
        "probability": probability,
        "description": description,
    }
    if dynamic:
        data.update({
            "distribution": "exponential",
            "dist_params": {"lambda": 0.001, "gamma": 0},
            "probability": 1 - 2.718281828459045 ** -1,
        })
    return {
        "id": event_id,
        "type": "basic",
        "position": {"x": x, "y": y},
        "data": data,
    }


FTA_GATE_PREFIXES = {
    "and": "AND", "or": "OR", "vote": "VOTE", "cardinality": "CARD",
    "xor": "XOR", "not": "NOT", "nand": "NAND", "nor": "NOR",
    "iff": "IFF", "imply": "IMPLY", "inhibit": "INH", "pand": "PAND",
    "por": "POR", "spare": "SPR", "fdep": "FDEP", "seq": "SEQ",
    "transfer": "XFER",
}


def _fta_gate(gate_id: str, gate_type: str, label: str, x: int, y: int,
              **data: Any) -> dict[str, Any]:
    return {
        "id": gate_id,
        "type": gate_type,
        "position": {"x": x, "y": y},
        "data": {"label": label, **data},
    }


def _fta_edge(source: str, target: str, order: int,
              role: str = "input") -> dict[str, Any]:
    return {
        "id": f"e-{source}-{target}",
        "source": source,
        "target": target,
        "data": {"role": role, "order": order},
    }


def _fta_state(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> dict[str, Any]:
    gate_sequences: dict[str, int] = {}
    for node in nodes:
        gate_type = str(node["type"])
        if gate_type in {"basic", "undeveloped", "house", "conditioning", "external"}:
            continue
        prefix = FTA_GATE_PREFIXES.get(gate_type, gate_type.upper())
        gate_sequences[prefix] = gate_sequences.get(prefix, 0) + 1
        node["data"]["gateId"] = f"{prefix}-{gate_sequences[prefix]}"
    return {
        "schemaVersion": 2,
        "exposureTime": "1000",
        "engine": "auto",
        "confidenceLevel": "95",
        "nSimulations": "20000",
        "simSeed": "42",
        "density": "comfortable",
        "connectorStyle": "smoothstep",
        "snapToGrid": False,
        "annotations": [],
        "showNodeIds": True,
        "nodes": nodes,
        "edges": edges,
        "result": None,
    }


def fault_tree_demo() -> dict[str, Any]:
    dynamic_probability = 1 - 2.718281828459045 ** -1
    return {
        "_folioWrap": True,
        "activeId": "f0",
        "folios": [
            {
                "id": "f0",
                "name": "Pump System FTA",
                "state": _fta_state([
                    _fta_gate("g1", "or", "System Failure", 320, 40,
                              description="Loss of the required pumping function"),
                    _fta_gate("g2", "and", "Both Pumps Fail", 150, 210),
                    _fta_event("b1", "Pump A Fails", 30, 400, probability=0.05),
                    _fta_event("b2", "Pump B Fails", 250, 400, probability=0.05),
                    _fta_event("b3", "Controller Fails", 430, 210, probability=0.02),
                    _fta_event("b4", "Power Loss", 640, 210, probability=0.01),
                ], [
                    _fta_edge("g1", "g2", 0), _fta_edge("g1", "b3", 1),
                    _fta_edge("g1", "b4", 2), _fta_edge("g2", "b1", 0),
                    _fta_edge("g2", "b2", 1),
                ]),
            },
            {
                "id": "fta-simple-or",
                "name": "Example — Simple OR",
                "state": _fta_state([
                    _fta_gate("TOP", "or", "Loss of Function", 360, 50,
                              description="Either failure mode causes the top event"),
                    _fta_event("A", "Failure Mode A", 210, 250, probability=0.01),
                    _fta_event("B", "Failure Mode B", 510, 250, probability=0.02),
                ], [_fta_edge("TOP", "A", 0), _fta_edge("TOP", "B", 1)]),
            },
            {
                "id": "fta-vote",
                "name": "Example — 2-of-3 Voting",
                "state": _fta_state([
                    _fta_gate("TOP", "vote", "Two Channels Unavailable", 360, 40, k=2),
                    _fta_event("A", "Channel A Fails", 80, 250, probability=0.01),
                    _fta_event("B", "Channel B Fails", 360, 250, probability=0.01),
                    _fta_event("C", "Channel C Fails", 640, 250, probability=0.01),
                ], [_fta_edge("TOP", event, order)
                    for order, event in enumerate(("A", "B", "C"))]),
            },
            {
                "id": "fta-pand",
                "name": "Example — PAND Sequence",
                "state": _fta_state([
                    _fta_gate("TOP", "pand", "Unsafe Ordered Failure", 360, 40,
                              tie_policy="inclusive",
                              description="Protection must fail before the demand occurs"),
                    _fta_event("A", "Protection Fails First", 210, 260,
                               probability=dynamic_probability, dynamic=True),
                    _fta_event("B", "Demand Occurs Second", 510, 260,
                               probability=dynamic_probability, dynamic=True),
                ], [_fta_edge("TOP", "A", 0), _fta_edge("TOP", "B", 1)]),
            },
            {
                "id": "fta-spare",
                "name": "Example — Cold Standby",
                "state": _fta_state([
                    _fta_gate("TOP", "spare", "Primary and Standby Unavailable", 360, 40,
                              spare_mode="cold", dormancy_factor=0, coverage=1),
                    _fta_event("A", "Primary Unit", 210, 260,
                               probability=dynamic_probability, dynamic=True),
                    _fta_event("B", "Standby Unit", 510, 260,
                               probability=dynamic_probability, dynamic=True),
                ], [
                    _fta_edge("TOP", "A", 0, "primary"),
                    _fta_edge("TOP", "B", 1, "spare"),
                ]),
            },
            {
                "id": "fta-fdep",
                "name": "Example — Functional Dependency",
                "state": _fta_state([
                    _fta_gate("TOP", "or", "Dependent Function Unavailable", 250, 40),
                    _fta_gate("DEP", "fdep", "Shared Support Dependency", 570, 190),
                    _fta_event("A", "Support Failure Trigger", 570, 390,
                               probability=dynamic_probability, dynamic=True),
                    _fta_event("B", "Dependent Function", 250, 250,
                               probability=dynamic_probability, dynamic=True),
                ], [
                    _fta_edge("TOP", "B", 0),
                    _fta_edge("DEP", "A", 0, "trigger"),
                    _fta_edge("DEP", "B", 1, "dependent"),
                ]),
            },
        ],
    }

CURRENT_SLICE_EXAMPLES: dict[str, Any] = {
    "faultTree": fault_tree_demo(),
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
    prediction.update({
        "blocks": PREDICTION_BLOCKS,
        "blockSeq": 1,
        "parts": PREDICTION_PARTS,
        "contributionScope": "system",
        "contributionBlockIds": [],
    })

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


def expected_example_demo() -> dict[str, Any]:
    demo = json.loads(EXAMPLE_DEMO_PATH.read_text(encoding="utf-8"))
    demo["modules"]["faultTree"] = fault_tree_demo()
    return demo


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if not args.write and not args.check:
        parser.error("choose --write and/or --check")
    expected = render(expected_demo())
    example_expected = render(expected_example_demo())
    if args.write:
        DEMO_PATH.write_text(expected, encoding="utf-8")
        EXAMPLE_DEMO_PATH.write_text(example_expected, encoding="utf-8")
    if args.check:
        stale = []
        if DEMO_PATH.read_text(encoding="utf-8") != expected:
            stale.append(str(DEMO_PATH.relative_to(ROOT)))
        if EXAMPLE_DEMO_PATH.read_text(encoding="utf-8") != example_expected:
            stale.append(str(EXAMPLE_DEMO_PATH.relative_to(ROOT)))
        if stale:
            raise SystemExit(
                "Demo project is stale (" + ", ".join(stale)
                + "); run tools/refresh_demo_project.py --write"
            )
    print("Demo project refreshed with 7 canonical NIST cases and all current persisted slices.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
