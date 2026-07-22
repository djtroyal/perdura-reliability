"""Stateless project-runner contracts."""

from __future__ import annotations

import asyncio
import io
import json
import sys
import zipfile
from pathlib import Path

from starlette.requests import Request


BACKEND = Path(__file__).resolve().parents[1]
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(ROOT / "src"))

import main
from project_api import (
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
            "schemaVersion": 4,
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
