"""Stateless project-runner contracts."""

from __future__ import annotations

import asyncio
import io
import json
import sys
import threading
import zipfile

import pytest
from pydantic import ValidationError
from pathlib import Path

from starlette.requests import Request


BACKEND = Path(__file__).resolve().parents[1]
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(ROOT / "src"))

import main
from project_api import (
    ProjectDocument,
    ProjectRunRequest,
    _tabular_results,
    execute_project,
    export_project,
    validate_project,
)


def project_request(*, invalid_dependency: bool = False) -> ProjectRunRequest:
    return ProjectRunRequest.model_validate({
        "project": {
            "app": "Perdura",
            "subtitle": "Reliability Engineering and Statistics Suite",
            "website": "https://perdurareliability.com",
            "schemaVersion": 6,
            "createdWith": {"version": main.APP_VERSION, "commit": main.APP_COMMIT, "builtAt": "dev"},
            "engineRevisions": {"life-data": 1},
            "project": "API contract",
            "units": "hours",
            "exported": "2026-07-21T00:00:00Z",
            "identity": {"projectId": "prj-api-contract"},
            "analysisRuns": [],
            "exportLedger": [],
            "modules": {},
        },
        "analyses": [{
            "id": "weibull-metrics",
            "operation_id": "post_life_data_calculate",
            "module_key": "life-data",
            "analysis_name": "Weibull mission metrics",
            "depends_on": ["missing"] if invalid_dependency else [],
            "input": {
                "distribution": "Weibull_2P",
                "params": {"eta": 1000, "beta": 2},
                "mission_end": 500,
            },
        }],
    })


def api_request() -> Request:
    request = Request({
        "type": "http", "app": main.app, "method": "POST", "path": "/api/v1/projects/run",
        "headers": [], "query_string": b"", "scheme": "http", "server": ("test", 80),
        "client": ("127.0.0.1", 1),
    })
    request.state.request_id = "test-request"
    return request


def test_project_validation_and_execution():
    req = project_request()
    validation = validate_project(req, api_request())
    assert validation.valid
    assert validation.runnable == 1

    response = asyncio.run(execute_project(req, api_request()))
    assert response.summary.completed == 1
    assert response.summary.failed == 0
    assert response.runs[0].result["reliability"] > 0
    assert len(response.runs[0].result_sha256 or "") == 64
    assert response.project["app"] == "Perdura"
    assert response.project["subtitle"] == "Reliability Engineering and Statistics Suite"
    assert response.project["website"] == "https://perdurareliability.com"
    assert response.project["analysisRuns"]
    assert response.project["modules"]["apiResults"]["weibull-metrics"]["status"] == "completed"


def test_project_validation_reports_dependency_errors():
    validation = validate_project(project_request(invalid_dependency=True), api_request())
    assert not validation.valid
    assert any(issue.code == "missing_dependency" for issue in validation.issues)


def test_project_runner_resolves_dependency_result_pointers():
    req = project_request()
    req.analyses.append(type(req.analyses[0]).model_validate({
        "id": "derived-rate",
        "operation_id": "post_fault_tree_derive_exponential",
        "module_key": "fault-tree",
        "depends_on": ["weibull-metrics"],
        "input": {
            "probability": {"$result": "weibull-metrics", "pointer": "/reliability"},
            "mission_time": 500,
        },
    }))
    validation = validate_project(req, api_request())
    assert validation.valid
    response = asyncio.run(execute_project(req, api_request()))
    assert response.summary.completed == 2
    assert response.runs[1].result["dist_params"]["lambda"] > 0


def test_project_calculation_keeps_health_requests_responsive(monkeypatch):
    from project_api import _route_map

    release = threading.Event()
    started = threading.Event()
    route = _route_map(main.app)["post_life_data_calculate"]

    def calculation(req):
        started.set()
        if not release.wait(timeout=2):
            raise RuntimeError("Health request could not run during calculation")
        return {"reliability": 0.9}

    monkeypatch.setattr(route, "endpoint", calculation)

    async def exercise():
        task = asyncio.create_task(execute_project(project_request(), api_request()))
        try:
            for _ in range(200):
                if started.is_set():
                    break
                await asyncio.sleep(0.01)
            assert started.is_set()
            messages = []
            received = False

            async def receive():
                nonlocal received
                if not received:
                    received = True
                    return {"type": "http.request", "body": b"", "more_body": False}
                await asyncio.Event().wait()
                return {"type": "http.disconnect"}

            async def send(message):
                messages.append(message)

            await main.app({
                "type": "http", "asgi": {"version": "3.0", "spec_version": "2.4"},
                "http_version": "1.1", "method": "GET", "scheme": "http",
                "path": "/api/v1/health", "raw_path": b"/api/v1/health",
                "query_string": b"", "root_path": "", "headers": [],
                "server": ("test", 80), "client": ("127.0.0.1", 1),
            }, receive, send)
            assert next(message for message in messages
                        if message["type"] == "http.response.start")["status"] == 200
            release.set()
            result = await task
            assert result.summary.completed == 1
        finally:
            release.set()
            await task

    asyncio.run(exercise())


def test_structured_export_contains_verified_manifest():
    response = asyncio.run(export_project(project_request(), api_request()))
    assert response.media_type == "application/zip"
    with zipfile.ZipFile(io.BytesIO(response.body)) as archive:
        names = set(archive.namelist())
        assert {"project.json", "run-summary.json", "api-catalog.json", "manifest.json"} <= names
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["assurance"]["level"] == "checksum-only"
        assert manifest["assurance"]["authenticity_established"] is False
        for entry in manifest["files"]:
            import hashlib
            assert hashlib.sha256(archive.read(entry["path"])).hexdigest() == entry["sha256"]


def test_tabular_result_discovery_supports_nested_vectors_and_row_tables():
    tables = list(_tabular_results({
        "curve": {"time": [1, 2], "reliability": [0.99, 0.95]},
        "diagnostics": {"rows": [{"name": "A", "value": 1}, {"name": "B", "value": 2}]},
    }))
    assert tables == [
        (("curve",), [
            {"time": 1, "reliability": 0.99},
            {"time": 2, "reliability": 0.95},
        ]),
        (("diagnostics", "rows"), [
            {"name": "A", "value": 1},
            {"name": "B", "value": 2},
        ]),
    ]


@pytest.mark.parametrize("schema", [6, 7, 8, 9])
def test_project_document_supports_explicit_migration_schemas(schema):
    payload = project_request().project.model_dump(by_alias=True)
    payload["schemaVersion"] = schema
    payload["modules"]["faultTreeCatalog"] = {"schemaVersion": 1, "byTreeId": {}}
    restored = ProjectDocument.model_validate(payload)
    assert restored.schema_version == schema
    assert restored.model_dump(by_alias=True)["modules"] == payload["modules"]


@pytest.mark.parametrize("schema", [5, 10, 999])
def test_project_document_rejects_unsupported_schema_without_guessing(schema):
    payload = project_request().project.model_dump(by_alias=True)
    payload["schemaVersion"] = schema
    with pytest.raises(ValidationError, match="schema 6, 7, 8, or 9"):
        ProjectDocument.model_validate(payload)


def test_legacy_fta_catalog_migration_is_stable_and_preserves_graphs():
    payload = project_request().project.model_dump(by_alias=True)
    payload["schemaVersion"] = 7
    graph = {"nodes": [{"id": "event", "type": "basic", "data": {"probability": 0.2}}], "edges": []}
    payload["modules"] = {"faultTree": {"_folioWrap": True, "activeId": "tree-a", "folios": [
        {"id": "tree-a", "name": "Same name", "state": graph},
        {"id": "tree-b", "name": "Same name", "state": graph},
    ]}}
    model = ProjectDocument.model_validate(payload)
    catalog = model.modules["faultTreeCatalog"]
    assert catalog["byTreeId"]["tree-a"]["code"] == "FTA-001"
    assert catalog["byTreeId"]["tree-b"]["code"] == "FTA-002"
    assert model.modules["faultTree"] == payload["modules"]["faultTree"]
    assert "faultTreeCatalog" not in payload["modules"]
    assert ProjectDocument.model_validate(model.model_dump(by_alias=True)).modules == model.modules


def test_project_validation_reports_fta_catalog_and_transfer_issues_without_mutation():
    req = project_request()
    req.project.schema_version = 8
    req.project.modules = {
        "faultTree": {"_folioWrap": True, "activeId": "a", "folios": [
            {"id": "a", "state": {"nodes": [{"id": "to-b", "type": "transfer", "data": {"transferTo": "b"}}], "edges": []}},
            {"id": "b", "state": {"nodes": [
                {"id": "to-a", "type": "transfer", "data": {"transferTo": "a"}},
                {"id": "missing", "type": "transfer", "data": {"transferTo": "absent"}},
            ], "edges": []}},
        ]},
        "faultTreeCatalog": {"schemaVersion": 1, "byTreeId": {
            "a": {"code": "FTA-A", "description": "", "tags": []},
            "b": {"code": "fta-a", "tags": [], "systemLinks": [{"itemId": "unqualified"}]},
        }},
    }
    original = json.dumps(req.project.modules, sort_keys=True)
    validation = validate_project(req, api_request())
    assert not validation.valid
    assert {"fta_transfer_cycle", "fta_missing_transfer_target", "fta_duplicate_code", "fta_invalid_system_link"} <= {
        issue.code for issue in validation.issues
    }
    assert json.dumps(req.project.modules, sort_keys=True) == original


def shared_project_request():
    req = project_request()
    payload = json.loads((ROOT / "gui/frontend/src/data/demoProject.json").read_text())
    req.project.schema_version = 9
    req.project.modules = {key: payload["modules"][key] for key in ("systemDefinition", "prediction")}
    return req


def test_schema9_validates_shared_system_and_scenarios_without_mutation():
    req = shared_project_request()
    original = json.dumps(req.project.modules, sort_keys=True)
    assert validate_project(req, api_request()).valid
    assert json.dumps(req.project.modules, sort_keys=True) == original


@pytest.mark.parametrize("defect,code", [
    ("duplicate", "invalid_prediction_scenario_id"),
    ("missing", "invalid_prediction_scenario_id"),
    ("number", "invalid_prediction_scenario_id"),
    ("empty", "invalid_prediction_scenarios"),
    ("active", "invalid_prediction_active_id"),
    ("missing-part", "invalid_prediction_scenario"),
    ("copied-parts", "invalid_prediction_scenario"),
    ("multi-root", "invalid_shared_system"),
])
def test_schema9_rejects_invalid_scenario_identity_and_structure(defect, code):
    from copy import deepcopy
    req = shared_project_request()
    wrap = req.project.modules["prediction"]
    folio = wrap["folios"][0]
    if defect == "duplicate": wrap["folios"].append(deepcopy(folio))
    elif defect == "missing": del folio["id"]
    elif defect == "number": folio["id"] = 123
    elif defect == "empty": wrap["folios"] = []
    elif defect == "active": wrap["activeId"] = "missing"
    elif defect == "missing-part": folio["state"]["partInputs"]["deleted-item"] = {}
    elif defect == "copied-parts": folio["state"]["parts"] = []
    elif defect == "multi-root": req.project.modules["systemDefinition"]["model"]["instances"][1]["parent_instance_id"] = None
    original = json.dumps(req.project.modules, sort_keys=True)
    validation = validate_project(req, api_request())
    assert not validation.valid
    assert code in {issue.code for issue in validation.issues}
    assert json.dumps(req.project.modules, sort_keys=True) == original


def test_schema9_fta_associations_resolve_canonical_instance_ids():
    req = shared_project_request()
    model = req.project.modules["systemDefinition"]["model"]
    req.project.modules["faultTree"] = {"_folioWrap": True, "activeId": "tree", "folios": [
        {"id": "tree", "state": {"nodes": [], "edges": []}}]}
    link = {"systemModelId": model["id"], "instanceId": model["root_instance_id"]}
    req.project.modules["faultTreeCatalog"] = {"schemaVersion": 1, "byTreeId": {
        "tree": {"code": "FTA-001", "description": "", "tags": [], "systemLinks": [link]}}}
    assert validate_project(req, api_request()).valid
    link["instanceId"] = "deleted"
    validation = validate_project(req, api_request())
    assert "fta_missing_system_link" in {issue.code for issue in validation.issues}
