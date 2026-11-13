"""Bound qualitative path enumeration and disclose incomplete fault-map coverage."""

from collections import deque
import importlib
import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "src"))
engine = importlib.import_module("reliability.SystemDefinition")


def branching_model(width=4, layers=8):
    """Explicit causal dependencies with width**layers distinct source routes."""
    levels = [["origin"]] + [[f"stage-{stage}-{item}" for item in range(width)] for stage in range(layers)]
    names = [name for level in levels for name in level] + ["later-source"]
    return {
        "version": 4, "id": "branching", "name": "Branching dependencies", "root_instance_id": "unit",
        "definitions": [{
            "id": "unit-definition", "name": "Unit", "kind": "system",
            "functions": [{"id": name, "description": f"Maintain {name}", "definition": {
                "role": "maintain_state", "action": name, "io": [],
            }} for name in names],
            "failure_modes": [{"id": name, "function_id": name, "description": f"Loss of {name}",
                               "deviation_id": "absent"} for name in ("origin", "later-source")],
        }],
        "instances": [{"id": "unit", "definition_id": "unit-definition", "name": "Unit"}],
        "function_links": [{"id": f"{source}-to-{target}", "relationship": "enables",
                            "source": {"instance_id": "unit", "function_id": source},
                            "target": {"instance_id": "unit", "function_id": target}}
                           for before, after in zip(levels, levels[1:])
                           for source in before for target in after],
    }


def test_wide_frontier_stays_bounded_and_later_sources_are_not_starved(monkeypatch):
    largest_queue = 0

    class TrackingDeque(deque):
        def append(self, item):
            nonlocal largest_queue
            super().append(item)
            largest_queue = max(largest_queue, len(self))

    monkeypatch.setattr(engine, "deque", TrackingDeque)
    result = engine.propagate_system_definition(branching_model(), max_paths=50)
    assert result["valid"]
    assert largest_queue <= 50
    assert len(result["paths"]) == 50
    assert {path["source_failure_mode_id"] for path in result["paths"]} == {"unit::origin", "unit::later-source"}
    assert result["coverage"]["processed_source_failure_modes"] == 2
    assert result["coverage"]["unprocessed_source_failure_mode_ids"] == []
    assert result["coverage"]["truncated_source_failure_mode_ids"] == ["unit::origin"]
    assert result["coverage"]["omitted_frontier_branches"] > 0
    assert any(issue["code"] == "propagation_truncated" and issue["severity"] == "warning" for issue in result["issues"])


def test_complete_small_graph_retains_path_order_and_evidence_at_exact_budget():
    model = branching_model(width=2, layers=2)
    complete = engine.propagate_system_definition(model)
    bounded = engine.propagate_system_definition(model, max_paths=5)
    assert len(complete["paths"]) == 5
    assert not bounded["coverage"]["truncated"]
    assert bounded["issues"] == complete["issues"] == []
    for key in ("fingerprint", "nodes", "edges", "paths", "proposals"):
        assert bounded[key] == complete[key]


def test_depth_limit_does_not_prevent_exploration_of_later_sources():
    result = engine.propagate_system_definition(branching_model(width=2, layers=2), max_depth=1)
    assert result["coverage"]["truncated"]
    assert any(path["source_failure_mode_id"] == "unit::later-source" for path in result["paths"])
    assert any(path["termination"] == "maximum_depth" for path in result["paths"])


def test_budget_smaller_than_source_count_explicitly_reports_unexplored_sources():
    result = engine.propagate_system_definition(branching_model(), max_paths=1)
    assert len(result["paths"]) == 1
    assert result["coverage"]["truncated"]
    assert result["coverage"]["unprocessed_source_failure_mode_ids"] == ["unit::later-source"]
    assert "1 were not explored" in result["issues"][-1]["message"]


def test_stop_rules_cannot_overshoot_the_terminal_path_budget():
    model = branching_model(width=8, layers=1)
    model["propagation_rules"] = [{"id": "stop", "action": "stop", "rationale": "Explicit review boundary."}]
    result = engine.propagate_system_definition(model, max_paths=3)
    assert len(result["paths"]) == 3
    assert result["coverage"]["truncated"]
    assert any(path["source_failure_mode_id"] == "unit::later-source" for path in result["paths"])


def test_aircraft_default_budget_covers_every_source_and_discloses_partial_paths():
    project = json.loads((ROOT / "gui/frontend/src/data/demoProject.json").read_text())
    model = project["modules"]["systemDefinition"]["model"]
    bounded = engine.propagate_system_definition(model, mode_id="run")
    complete = engine.propagate_system_definition(model, mode_id="run", max_paths=100000)
    expected_sources = {path["source_failure_mode_id"] for path in complete["paths"]}
    assert {"pump-a::no-flow", "pump-b::no-flow"} <= expected_sources
    assert {path["source_failure_mode_id"] for path in bounded["paths"]} == expected_sources
    assert len(bounded["paths"]) <= 10000
    assert len(expected_sources) == bounded["coverage"]["source_failure_modes"]
    assert not complete["coverage"]["truncated"]
    assert complete["issues"] == []
    if bounded["coverage"]["truncated"]:
        assert any(issue["code"] == "propagation_truncated" for issue in bounded["issues"])
        assert bounded["coverage"]["truncated_source_failure_mode_ids"]
