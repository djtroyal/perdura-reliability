"""Demo metadata must never manufacture newer scientific result provenance."""

import copy
import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("refresh_demo", ROOT / "tools/refresh_demo_project.py")
refresh = importlib.util.module_from_spec(spec)
spec.loader.exec_module(refresh)


@pytest.mark.parametrize("key,revision", [("warranty", 3), ("reliabilityTestingTools", 2)])
def test_input_only_demo_adopts_engine_revision_without_changing_inputs(key, revision):
    demo = {"modules": {key: {"_folioWrap": True, "folios": [
        {"id": "saved", "state": {"rows": [{"time": 12, "status": "right_censored"}], "result": None}},
    ]}}, "engineRevisions": {key: revision - 1}}
    original = copy.deepcopy(demo)
    assert refresh.demo_engine_revisions(demo)[key] == revision
    assert demo == original


@pytest.mark.parametrize("result", [{"estimate": 12}, [1, 2], 0])
@pytest.mark.parametrize("key,revision", [("warranty", 3), ("reliabilityTestingTools", 2)])
def test_historical_outputs_cannot_be_relabelled(key, revision, result):
    demo = {"modules": {key: {"nested": {"forecastResult": result}}},
            "engineRevisions": {key: revision - 1}}
    original = copy.deepcopy(demo)
    with pytest.raises(ValueError, match="Cannot relabel.*regenerate"):
        refresh.demo_engine_revisions(demo)
    assert demo == original


def test_current_and_newer_outputs_keep_their_declared_revision():
    demo = {"modules": {"warranty": {"result": {"estimate": 12}},
                        "reliabilityTestingTools": {"stepStress": {"result": {"schema": "v2"}}},
                        "growth": {"custom_input": 17}},
            "engineRevisions": {"warranty": 4, "reliabilityTestingTools": 2, "growth": 8}}
    original = copy.deepcopy(demo)
    assert refresh.demo_engine_revisions(demo) == {"warranty": 4, "reliabilityTestingTools": 2, "growth": 8}
    assert demo == original


def test_absent_modules_are_not_added_to_the_demo():
    assert refresh.demo_engine_revisions({"modules": {"growth": {"input": 1}}}) == {"growth": 1}


def test_showcase_revised_engine_outputs_will_not_be_discarded_on_import():
    fixtures = ROOT / "gui/frontend/public/website-showcase"
    checked = 0
    for path in fixtures.glob("*.json"):
        fixture = json.loads(path.read_text())
        for key, required in refresh.INPUT_ONLY_ENGINE_UPGRADES.items():
            state = fixture.get("modules", {}).get(key)
            if state is not None and refresh.has_computed_output(state):
                checked += 1
                declared = fixture.get("engineRevisions", {}).get(key, 1)
                assert declared >= required, (
                    f"{path.name}: {key} results will be invalidated on load; "
                    "regenerate through the current API instead of relabeling results"
                )
    assert checked > 0, "expected completed-analysis fixtures for revised engines"
