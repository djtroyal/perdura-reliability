"""Shared public HTTP API behavior for Perdura.

The numerical routers predate the public API and intentionally return their
domain payloads directly.  This module adds the cross-cutting contract without
wrapping (and therefore needlessly copying) every numerical result.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import uuid
from collections.abc import Iterable
from typing import Any

from fastapi import HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from fastapi.encoders import jsonable_encoder
from starlette.middleware.base import BaseHTTPMiddleware


log = logging.getLogger("perdura.api")
API_VERSION = "1"
API_PREFIX = f"/api/v{API_VERSION}"
_SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")


def request_id(request: Request) -> str:
    value = request.headers.get("x-request-id", "")
    if not _SAFE_REQUEST_ID.fullmatch(value):
        value = str(uuid.uuid4())
    request.state.request_id = value
    return value


def error_payload(
    request: Request,
    *,
    code: str,
    message: str,
    issues: Iterable[dict[str, Any]] = (),
) -> dict[str, Any]:
    return {
        "error": {
            "code": code,
            "message": message,
            "issues": list(issues),
            "request_id": getattr(request.state, "request_id", request_id(request)),
        }
    }


def validation_error_response(request: Request, exc: RequestValidationError) -> JSONResponse:
    issues = []
    for issue in exc.errors(include_url=False, include_context=False, include_input=False):
        issues.append({
            "path": ".".join(str(part) for part in issue.get("loc", ())),
            "message": issue.get("msg", "Invalid value"),
            "type": issue.get("type", "validation_error"),
        })
    return JSONResponse(
        status_code=422,
        content=error_payload(
            request,
            code="request_validation_error",
            message="The request did not satisfy the API contract.",
            issues=issues,
        ),
    )


def http_error_response(request: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail
    issues: list[dict[str, Any]] = []
    if isinstance(detail, dict):
        message = str(detail.get("message") or detail.get("detail") or "Request failed.")
        raw_issues = detail.get("issues")
        if isinstance(raw_issues, list):
            issues = [item for item in raw_issues if isinstance(item, dict)]
        code = str(detail.get("code") or "request_error")
    else:
        message = str(detail)
        code = "request_error"
    return JSONResponse(
        status_code=exc.status_code,
        content=error_payload(request, code=code, message=message, issues=issues),
        headers=exc.headers,
    )


class ApiMetadataMiddleware(BaseHTTPMiddleware):
    """Stamp every v1 response and hash complete non-streaming bodies."""

    def __init__(self, app: Any, *, app_version: str, app_commit: str) -> None:
        super().__init__(app)
        self.app_version = app_version
        self.app_commit = app_commit

    async def dispatch(self, request: Request, call_next: Any) -> Response:
        rid = request_id(request)
        response = await call_next(request)
        if not request.url.path.startswith(API_PREFIX):
            return response

        response.headers["X-Request-ID"] = rid
        response.headers["X-Perdura-API-Version"] = API_VERSION
        response.headers["X-Perdura-Version"] = self.app_version
        response.headers["X-Perdura-Commit"] = self.app_commit

        content_type = response.headers.get("content-type", "").lower()
        if "application/x-ndjson" in content_type or "text/event-stream" in content_type:
            return response

        body = b"".join([chunk async for chunk in response.body_iterator])
        response.headers["X-Perdura-Content-SHA256"] = hashlib.sha256(body).hexdigest()
        headers = dict(response.headers)
        headers.pop("content-length", None)
        return Response(
            content=body,
            status_code=response.status_code,
            headers=headers,
            background=response.background,
        )


def _json_schema() -> dict[str, Any]:
    return {
        "oneOf": [
            {"type": "object", "additionalProperties": True},
            {"type": "array", "items": {}},
            {"type": "string"},
            {"type": "number"},
            {"type": "boolean"},
            {"type": "null"},
        ]
    }


def complete_openapi_contract(schema: dict[str, Any]) -> dict[str, Any]:
    """Fill legacy response-schema gaps while routers gain precise models.

    Request schemas are already generated from Pydantic models.  Historically
    router return annotations were untyped, which made every success response
    appear schema-less.  A JSON-value contract is materially safer for client
    generation than an empty schema and catalog tests prevent future omissions.
    Binary and NDJSON operations retain their declared media types.
    """

    error_ref = {"$ref": "#/components/schemas/ApiErrorResponse"}
    components = schema.setdefault("components", {}).setdefault("schemas", {})
    components.setdefault("ApiIssue", {
        "type": "object",
        "required": ["path", "message", "type"],
        "properties": {
            "path": {"type": "string"},
            "message": {"type": "string"},
            "type": {"type": "string"},
        },
    })
    components.setdefault("ApiError", {
        "type": "object",
        "required": ["code", "message", "issues", "request_id"],
        "properties": {
            "code": {"type": "string"},
            "message": {"type": "string"},
            "issues": {"type": "array", "items": {"$ref": "#/components/schemas/ApiIssue"}},
            "request_id": {"type": "string"},
        },
    })
    components.setdefault("ApiErrorResponse", {
        "type": "object",
        "required": ["error"],
        "properties": {"error": {"$ref": "#/components/schemas/ApiError"}},
    })

    for path, item in schema.get("paths", {}).items():
        if not path.startswith(API_PREFIX):
            continue
        for method, operation in item.items():
            if method not in {"get", "post", "put", "patch", "delete"}:
                continue
            responses = operation.setdefault("responses", {})
            success = responses.get("200") or responses.get("201")
            if success is not None:
                content = success.setdefault("content", {})
                if not content:
                    content["application/json"] = {"schema": _json_schema()}
                for media, definition in content.items():
                    if media == "application/json" and not definition.get("schema"):
                        definition["schema"] = _json_schema()
            for status, description in (
                ("400", "The request is valid JSON but invalid for the selected model."),
                ("422", "The request does not satisfy the declared schema."),
                ("500", "The calculation failed without exposing internal implementation details."),
            ):
                responses.setdefault(status, {
                    "description": description,
                    "content": {"application/json": {"schema": error_ref}},
                })
    return schema


def stream_result_event(data: Any) -> dict[str, Any]:
    encoded = jsonable_encoder(data)
    canonical = json.dumps(
        encoded, sort_keys=True, separators=(",", ":"), allow_nan=False,
    ).encode("utf-8")
    return {
        "type": "result",
        "data": encoded,
        "result_sha256": hashlib.sha256(canonical).hexdigest(),
    }


def stream_error_event(
    detail: Any,
    *,
    request_id_value: str,
    status: int = 500,
    code: str = "analysis_failed",
) -> dict[str, Any]:
    if isinstance(detail, dict):
        message = str(detail.get("message") or detail.get("detail") or "Analysis failed.")
        code = str(detail.get("code") or code)
        issues = detail.get("issues") if isinstance(detail.get("issues"), list) else []
    else:
        message = str(detail)
        issues = []
    return {
        "type": "error", "status": status,
        "error": {
            "code": code, "message": message, "issues": issues,
            "request_id": request_id_value,
        },
    }
