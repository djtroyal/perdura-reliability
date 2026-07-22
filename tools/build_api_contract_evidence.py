#!/usr/bin/env python3
"""Emit a fail-closed, machine-readable inventory of Perdura's public API."""

from __future__ import annotations

import argparse
from datetime import UTC, datetime
import hashlib
import json
from pathlib import Path
import sys
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "gui" / "backend"
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(ROOT / "src"))

import main  # noqa: E402
from api_catalog import build_catalog  # noqa: E402
from api_contract import API_PREFIX, API_VERSION  # noqa: E402


SCHEMA = "perdura.api-contract-evidence/v1"
HTTP_METHODS = {"get", "post", "put", "patch", "delete"}


def _json_bytes(value: Any) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")


def build_evidence() -> tuple[dict[str, Any], dict[str, Any]]:
    openapi = main.app.openapi()
    catalog = build_catalog(main.app)
    operations: list[dict[str, Any]] = []
    issues: list[dict[str, str]] = []

    for path, path_item in sorted(openapi.get("paths", {}).items()):
        if not path.startswith(f"{API_PREFIX}/"):
            issues.append({
                "code": "unversioned_path",
                "location": path,
                "message": "Every documented public operation must be under the current API version.",
            })
        for method, operation in sorted(path_item.items()):
            if method not in HTTP_METHODS:
                continue
            operation_id = str(operation.get("operationId", ""))
            responses = operation.get("responses", {})
            success = responses.get("200") or responses.get("201") or {}
            success_content = success.get("content", {})
            response_media = sorted(success_content)
            record = {
                "operation_id": operation_id,
                "method": method.upper(),
                "path": path,
                "request_schema": bool(operation.get("requestBody", {}).get("content")),
                "response_media_types": response_media,
                "standard_errors": [status for status in ("400", "422", "500") if status in responses],
            }
            operations.append(record)
            if not operation_id:
                issues.append({
                    "code": "missing_operation_id", "location": f"{method.upper()} {path}",
                    "message": "The operation has no stable operation ID.",
                })
            if not success_content or any(not item.get("schema") for item in success_content.values()):
                issues.append({
                    "code": "missing_success_schema", "location": f"{method.upper()} {path}",
                    "message": "The success response lacks a declared media type or schema.",
                })
            missing_errors = [status for status in ("400", "422", "500") if status not in responses]
            if missing_errors:
                issues.append({
                    "code": "missing_standard_error", "location": f"{method.upper()} {path}",
                    "message": f"The operation does not document: {', '.join(missing_errors)}.",
                })
            if path.endswith("/stream") and "application/x-ndjson" not in success_content:
                issues.append({
                    "code": "missing_ndjson_contract", "location": f"{method.upper()} {path}",
                    "message": "A streaming operation must declare application/x-ndjson.",
                })

    operation_ids = [item["operation_id"] for item in operations if item["operation_id"]]
    duplicates = sorted({value for value in operation_ids if operation_ids.count(value) > 1})
    for operation_id in duplicates:
        issues.append({
            "code": "duplicate_operation_id", "location": operation_id,
            "message": "Operation IDs must be unique across the public API.",
        })

    openapi_ids = set(operation_ids)
    modules: list[dict[str, Any]] = []
    catalog_ids: set[str] = set()
    for module in catalog.modules:
        analyses = []
        for analysis in module.analyses:
            data = analysis.model_dump()
            catalog_ids.add(analysis.operation_id)
            analyses.append(data)
            if analysis.operation_id not in openapi_ids:
                issues.append({
                    "code": "catalog_operation_missing", "location": analysis.operation_id,
                    "message": "The catalog operation is absent from the OpenAPI document.",
                })
        if not analyses:
            issues.append({
                "code": "module_without_operations", "location": module.id,
                "message": "Every catalog module must expose at least one API operation.",
            })
        modules.append({
            "id": module.id,
            "title": module.title,
            "kind": module.kind,
            "operation_count": len(analyses),
            "project_runnable_count": sum(bool(item["project_runnable"]) for item in analyses),
            "streaming_count": sum(bool(item["stream_path"]) for item in analyses),
            "operations": analyses,
        })

    openapi_bytes = _json_bytes(openapi)
    evidence = {
        "schema": SCHEMA,
        "status": "failed" if issues else "passed",
        "generated_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "software": {
            "product": "Perdura",
            "version": main.APP_VERSION,
            "commit": main.APP_COMMIT,
            "built_at": main.BUILD_TIMESTAMP,
        },
        "api": {
            "version": API_VERSION,
            "prefix": API_PREFIX,
            "openapi_url": main.app.openapi_url,
            "docs_url": main.app.docs_url,
            "openapi_sha256": hashlib.sha256(openapi_bytes).hexdigest(),
        },
        "summary": {
            "modules": len(modules),
            "documented_operations": len(operations),
            "catalog_analyses": sum(module["operation_count"] for module in modules),
            "project_runnable_analyses": sum(module["project_runnable_count"] for module in modules),
            "streaming_analyses": sum(module["streaming_count"] for module in modules),
            "issues": len(issues),
        },
        "checks": {
            "all_paths_versioned": not any(issue["code"] == "unversioned_path" for issue in issues),
            "operation_ids_unique": not duplicates,
            "success_schemas_complete": not any(issue["code"] == "missing_success_schema" for issue in issues),
            "standard_errors_complete": not any(issue["code"] == "missing_standard_error" for issue in issues),
            "stream_contracts_complete": not any(issue["code"] == "missing_ndjson_contract" for issue in issues),
            "catalog_matches_openapi": not any(issue["code"] == "catalog_operation_missing" for issue in issues),
            "every_module_represented": not any(issue["code"] == "module_without_operations" for issue in issues),
        },
        "issues": issues,
        "modules": modules,
    }
    return evidence, openapi


def main_command() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="API coverage-matrix JSON path")
    parser.add_argument("--openapi-output", type=Path, required=True, help="OpenAPI JSON path")
    args = parser.parse_args()

    evidence, openapi = build_evidence()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.openapi_output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(_json_bytes(evidence))
    args.openapi_output.write_bytes(_json_bytes(openapi))
    summary = evidence["summary"]
    print(
        f"API contract {evidence['status']}: {summary['modules']} modules, "
        f"{summary['documented_operations']} operations, {summary['issues']} issues"
    )
    return 0 if evidence["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main_command())
