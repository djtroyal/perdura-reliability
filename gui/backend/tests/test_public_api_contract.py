"""Public v1 discovery and OpenAPI invariants."""

from __future__ import annotations

import asyncio
import hashlib
import sys
from pathlib import Path


BACKEND = Path(__file__).resolve().parents[1]
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(ROOT / "src"))

import main
from api_catalog import MODULES, build_catalog
from api_contract import (
    API_CONTRACT_VERSION,
    API_PREFIX,
    ApiMetadataMiddleware,
    validation_error_response,
)
from fastapi.exceptions import RequestValidationError
from starlette.requests import Request
from starlette.responses import StreamingResponse


def test_only_versioned_public_api_is_documented():
    schema = main.app.openapi()
    paths = schema["paths"]
    assert paths
    assert all(path.startswith(f"{API_PREFIX}/") for path in paths)
    assert "/api/health" not in paths
    assert f"{API_PREFIX}/health" in paths
    assert f"{API_PREFIX}/catalog" in paths


def test_operation_ids_and_success_contracts_are_complete():
    schema = main.app.openapi()
    operation_ids: list[str] = []
    for path, path_item in schema["paths"].items():
        for method, operation in path_item.items():
            if method not in {"get", "post", "put", "patch", "delete"}:
                continue
            operation_ids.append(operation["operationId"])
            success = operation["responses"].get("200") or operation["responses"].get("201")
            assert success and success.get("content"), f"{method.upper()} {path} has no success schema"
            for status in ("400", "409", "422", "500"):
                assert status in operation["responses"], f"{method.upper()} {path} lacks {status}"
    assert len(operation_ids) == len(set(operation_ids))


def test_catalog_covers_every_router_and_module():
    catalog = build_catalog(main.app)
    assert {module.id for module in catalog.modules} == set(MODULES)
    operations = [analysis.operation_id for module in catalog.modules for analysis in module.analyses]
    assert len(operations) >= 130
    assert len(operations) == len(set(operations))
    assert any(analysis.stream_path for module in catalog.modules for analysis in module.analyses)
    assert any(analysis.project_runnable for module in catalog.modules for analysis in module.analyses)


def test_spa_fallback_is_not_part_of_openapi():
    assert "/{full_path}" not in main.app.openapi()["paths"]


def test_metadata_middleware_hashes_complete_responses_but_not_streams():
    middleware = ApiMetadataMiddleware(lambda *_: None, app_version="1.2.3", app_commit="abc")
    request = Request({
        "type": "http", "method": "GET", "path": f"{API_PREFIX}/health",
        "headers": [], "query_string": b"", "scheme": "http",
        "server": ("test", 80), "client": ("127.0.0.1", 1),
    })

    async def complete(_request):
        async def body():
            yield b'{"status":"ok"}'
        return StreamingResponse(body(), media_type="application/json")

    response = asyncio.run(middleware.dispatch(request, complete))
    assert response.headers["X-Perdura-API-Version"] == "1"
    assert response.headers["X-Perdura-API-Contract"] == str(API_CONTRACT_VERSION)
    assert response.headers["X-Perdura-Min-Client-API-Contract"] == "1"
    assert response.headers["X-Perdura-Max-Client-API-Contract"] == "1"
    assert response.headers["X-Perdura-Version"] == "1.2.3"
    assert response.headers["X-Perdura-Content-SHA256"] == hashlib.sha256(response.body).hexdigest()

    async def stream(_request):
        async def body():
            yield b'{"type":"start"}\n'
        return StreamingResponse(body(), media_type="application/x-ndjson")

    streamed = asyncio.run(middleware.dispatch(request, stream))
    assert "X-Perdura-Content-SHA256" not in streamed.headers


def test_browser_clients_fail_closed_when_frontend_contract_is_missing_or_wrong():
    middleware = ApiMetadataMiddleware(lambda *_: None, app_version="1.2.3", app_commit="abc")

    def make_request(contract: str | None):
        headers = [(b"sec-fetch-site", b"same-origin")]
        if contract is not None:
            headers.append((b"x-perdura-client-api-contract", contract.encode()))
        return Request({
            "type": "http", "method": "POST", "path": f"{API_PREFIX}/life-data/fit",
            "headers": headers, "query_string": b"", "scheme": "http",
            "server": ("test", 80), "client": ("127.0.0.1", 1),
        })

    async def complete(_request):
        async def body():
            yield b'{}'
        return StreamingResponse(body(), media_type="application/json")

    missing = asyncio.run(middleware.dispatch(make_request(None), complete))
    assert missing.status_code == 409
    assert b"frontend_update_required" in missing.body
    assert missing.headers["Cache-Control"] == "no-store"

    wrong = asyncio.run(middleware.dispatch(make_request("999"), complete))
    assert wrong.status_code == 409
    assert wrong.headers["X-Perdura-API-Contract"] == str(API_CONTRACT_VERSION)

    compatible = asyncio.run(middleware.dispatch(
        make_request(str(API_CONTRACT_VERSION)), complete,
    ))
    assert compatible.status_code == 200


def test_request_validation_error_is_stable_across_pydantic_error_apis():
    request = Request({
        "type": "http", "method": "POST", "path": f"{API_PREFIX}/example",
        "headers": [], "query_string": b"", "scheme": "http",
        "server": ("test", 80), "client": ("127.0.0.1", 1),
    })
    error = RequestValidationError([{
        "type": "missing",
        "loc": ("body", "mission_time"),
        "msg": "Field required",
        "input": {"untrusted": object()},
        "ctx": {"internal": object()},
    }])

    response = validation_error_response(request, error)
    assert response.status_code == 422
    assert b'"path":"body.mission_time"' in response.body
    assert b'"message":"Field required"' in response.body
    assert b"untrusted" not in response.body
    assert b"internal" not in response.body
