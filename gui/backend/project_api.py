"""Stateless whole-project validation, execution, and structured export."""

from __future__ import annotations

import csv
import hashlib
import inspect
import io
import json
import asyncio
import logging
import uuid
import zipfile
from copy import deepcopy
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import Response, StreamingResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, field_validator, model_validator

from api_catalog import MODULES, build_catalog, public_routes, route_module, route_project_runnable


router = APIRouter()
log = logging.getLogger("perdura.api.projects")


def _now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _canonical(value: Any) -> bytes:
    return json.dumps(
        jsonable_encoder(value), sort_keys=True, separators=(",", ":"),
        ensure_ascii=False, allow_nan=False,
    ).encode("utf-8")


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


class ProjectDocument(BaseModel):
    """The portable browser project contract; module slices remain domain-owned."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)
    app: str
    subtitle: str
    website: str
    schema_version: int = Field(alias="schemaVersion")
    created_with: dict[str, Any] = Field(alias="createdWith")
    engine_revisions: dict[str, int] = Field(alias="engineRevisions")
    project: str
    units: str = "hours"
    exported: str
    identity: dict[str, Any]
    analysis_runs: list[dict[str, Any]] = Field(alias="analysisRuns")
    export_ledger: list[dict[str, Any]] = Field(alias="exportLedger")
    modules: dict[str, Any]

    @field_validator("app")
    @classmethod
    def supported_file_type(cls, value: str) -> str:
        if value != "Perdura":
            raise ValueError("Not a Perdura project export.")
        return value

    @field_validator("schema_version")
    @classmethod
    def supported_schema(cls, value: int) -> int:
        if value != 4:
            raise ValueError("This API accepts Perdura project schema 4 only.")
        return value

    @model_validator(mode="after")
    def required_identity_metadata(self):
        if self.subtitle != "Reliability Engineering and Statistics Suite":
            raise ValueError("Project subtitle does not identify Perdura.")
        if self.website != "https://perdurareliability.com":
            raise ValueError("Project website does not identify Perdura.")
        if not isinstance(self.identity.get("projectId"), str) or not self.identity["projectId"].strip():
            raise ValueError("Project identity.projectId is required.")
        for key in ("version", "commit", "builtAt"):
            if not isinstance(self.created_with.get(key), str):
                raise ValueError(f"Project createdWith.{key} is required.")
        return self


class ProjectRunItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=200)
    operation_id: str = Field(min_length=1, max_length=240)
    input: dict[str, Any] = Field(default_factory=dict)
    depends_on: list[str] = Field(default_factory=list)
    module_key: str | None = None
    analysis_name: str | None = None


class ProjectRunSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    modules: list[str] | None = None
    analyses: list[str] | None = None


class ProjectRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project: ProjectDocument
    analyses: list[ProjectRunItem] = Field(default_factory=list)
    selection: ProjectRunSelection | None = None
    include_dependencies: bool = True
    fail_fast: bool = False


class ProjectIssue(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str
    message: str
    analysis_id: str | None = None


class ProjectValidationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    valid: bool
    schema_version: int
    analyses: int
    runnable: int
    issues: list[ProjectIssue]


class ProjectRunResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    operation_id: str
    module_key: str
    analysis_name: str
    status: Literal["completed", "failed", "blocked", "skipped"]
    started_at: str | None = None
    completed_at: str | None = None
    input_sha256: str | None = None
    result_sha256: str | None = None
    result: Any = None
    error: dict[str, Any] | None = None


class ProjectRunSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")
    total: int
    completed: int
    failed: int
    blocked: int
    skipped: int


class ProjectRunResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project: dict[str, Any]
    summary: ProjectRunSummary
    runs: list[ProjectRunResult]


def _project_runs(req: ProjectRunRequest) -> list[ProjectRunItem]:
    if req.analyses:
        return req.analyses
    for key in ("apiRuns", "api_runs"):
        raw = req.project.modules.get(key)
        if isinstance(raw, list):
            try:
                return TypeAdapter(list[ProjectRunItem]).validate_python(raw)
            except Exception as exc:
                raise HTTPException(400, {
                    "code": "invalid_project_recipe",
                    "message": f"Project module '{key}' is not a valid API run recipe: {exc}",
                }) from exc
    return []


def _route_map(app: Any) -> dict[str, Any]:
    return {
        (route.operation_id or route.unique_id): route for route in public_routes(app)
        if (route.operation_id or route.unique_id) and route_project_runnable(route)
        and route_module(route.path) != "projects"
    }


def _selected(items: list[ProjectRunItem], req: ProjectRunRequest) -> list[ProjectRunItem]:
    selection = req.selection
    if not selection or (selection.modules is None and selection.analyses is None):
        return items
    wanted = set(selection.analyses or [])
    modules = set(selection.modules or [])
    chosen = {item.id for item in items if item.id in wanted or (item.module_key or "") in modules}
    if req.include_dependencies:
        by_id = {item.id: item for item in items}
        pending = list(chosen)
        while pending:
            item = by_id.get(pending.pop())
            if not item:
                continue
            for dependency in item.depends_on:
                if dependency not in chosen:
                    chosen.add(dependency)
                    pending.append(dependency)
    return [item for item in items if item.id in chosen]


def _order(items: list[ProjectRunItem]) -> tuple[list[ProjectRunItem], list[ProjectIssue]]:
    by_id = {item.id: item for item in items}
    issues: list[ProjectIssue] = []
    if len(by_id) != len(items):
        issues.append(ProjectIssue(code="duplicate_analysis_id", message="Analysis IDs must be unique."))
    for item in items:
        for dependency in item.depends_on:
            if dependency not in by_id:
                issues.append(ProjectIssue(
                    code="missing_dependency",
                    message=f"Dependency '{dependency}' is not present in the selected project run.",
                    analysis_id=item.id,
                ))
    ordered: list[ProjectRunItem] = []
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(item: ProjectRunItem) -> None:
        if item.id in visited:
            return
        if item.id in visiting:
            issues.append(ProjectIssue(
                code="dependency_cycle", message="The project run contains a dependency cycle.",
                analysis_id=item.id,
            ))
            return
        visiting.add(item.id)
        for dependency in item.depends_on:
            if dependency in by_id:
                visit(by_id[dependency])
        visiting.discard(item.id)
        if item.id not in visited:
            visited.add(item.id)
            ordered.append(item)

    for item in items:
        visit(item)
    return ordered, issues


def _pointer(value: Any, pointer: str) -> Any:
    current = value
    if not pointer or pointer == "/":
        return current
    for part in pointer.lstrip("/").split("/"):
        key = part.replace("~1", "/").replace("~0", "~")
        if isinstance(current, list):
            current = current[int(key)]
        elif isinstance(current, dict):
            current = current[key]
        else:
            raise KeyError(pointer)
    return current


def _resolve_refs(value: Any, results: dict[str, Any]) -> Any:
    if isinstance(value, dict):
        if set(value).issubset({"$result", "pointer"}) and "$result" in value:
            source = results[str(value["$result"])]
            return deepcopy(_pointer(source, str(value.get("pointer", ""))))
        return {key: _resolve_refs(item, results) for key, item in value.items()}
    if isinstance(value, list):
        return [_resolve_refs(item, results) for item in value]
    return value


def _contains_result_ref(value: Any) -> bool:
    if isinstance(value, dict):
        return "$result" in value or any(_contains_result_ref(item) for item in value.values())
    if isinstance(value, list):
        return any(_contains_result_ref(item) for item in value)
    return False


def _validate_route_input(route: APIRoute, value: dict[str, Any]) -> tuple[str, Any]:
    body_param = route.dependant.body_params[0]
    annotation = body_param.field_info.annotation
    return body_param.name, TypeAdapter(annotation).validate_python(value)


async def _invoke(route: APIRoute, value: dict[str, Any], request: Request) -> Any:
    name, validated = _validate_route_input(route, value)
    kwargs: dict[str, Any] = {name: validated}
    if route.dependant.request_param_name:
        kwargs[route.dependant.request_param_name] = request
    endpoint = route.endpoint
    if inspect.iscoroutinefunction(endpoint):
        result = await endpoint(**kwargs)
    else:
        # Project runs execute dependency-ordered operations one at a time.
        # This also avoids moving numerical libraries across worker threads.
        result = endpoint(**kwargs)
    if isinstance(result, Response):
        raise ValueError("Binary and streaming operations cannot be embedded in a project run.")
    return jsonable_encoder(result)


def _software(request: Request) -> dict[str, Any]:
    version = getattr(request.app.state, "perdura_version", "dev")
    commit = getattr(request.app.state, "perdura_commit", "dev")
    built_at = getattr(request.app.state, "perdura_built_at", "dev")
    return {
        "product": "Perdura", "version": version, "commit": commit,
        "builtAt": built_at, "repository": "djtroyal/perdura-reliability",
        "commitUrl": None, "releaseUrl": None,
        "verificationReportSha256": None, "verificationRunUrl": None,
        "runtimeExecutableSha256": None, "buildStatus": "development",
    }


def _record(req: ProjectRunRequest, item: ProjectRunItem, run: ProjectRunResult,
            request: Request) -> dict[str, Any]:
    project_id = str(req.project.identity.get("projectId", ""))
    module_key = run.module_key
    completed = run.completed_at or _now()
    core = {
        "schema": "perdura.analysis-run/v1", "projectId": project_id,
        "moduleKey": module_key, "analysisId": item.id,
        "engineRevision": int(req.project.engine_revisions.get(module_key, 1)),
        "completedAt": completed, "inputSha256": run.input_sha256,
        "resultSha256": run.result_sha256, "software": _software(request),
    }
    return {
        **core, "runId": f"run-{uuid.uuid4()}",
        "moduleLabel": MODULES.get(module_key, (module_key, ""))[0],
        "analysisName": run.analysis_name,
        "method": item.operation_id,
        "fingerprintSha256": _sha(core),
    }


async def execute_project(req: ProjectRunRequest, request: Request, emit: Any | None = None) -> ProjectRunResponse:
    route_map = _route_map(request.app)
    items = _selected(_project_runs(req), req)
    ordered, graph_issues = _order(items)
    if graph_issues:
        raise HTTPException(400, {
            "code": "invalid_project_dependencies", "message": "The project run graph is invalid.",
            "issues": [issue.model_dump() for issue in graph_issues],
        })
    results_by_id: dict[str, Any] = {}
    states: dict[str, str] = {}
    runs: list[ProjectRunResult] = []
    if emit:
        await emit({"type": "start", "total": len(ordered)})
        await asyncio.sleep(0)
    for index, item in enumerate(ordered):
        route = route_map.get(item.operation_id)
        module_key = item.module_key or (route_module(route.path) if route else "unknown")
        name = item.analysis_name or item.id
        if any(states.get(dep) != "completed" for dep in item.depends_on):
            run = ProjectRunResult(
                id=item.id, operation_id=item.operation_id, module_key=module_key,
                analysis_name=name, status="blocked",
                error={"code": "dependency_failed", "message": "A required analysis did not complete."},
            )
        elif route is None:
            run = ProjectRunResult(
                id=item.id, operation_id=item.operation_id, module_key=module_key,
                analysis_name=name, status="failed",
                error={"code": "unknown_operation", "message": "The operation is not project-runnable."},
            )
        else:
            started = _now()
            try:
                resolved = _resolve_refs(item.input, results_by_id)
                result = await _invoke(route, resolved, request)
                run = ProjectRunResult(
                    id=item.id, operation_id=item.operation_id, module_key=module_key,
                    analysis_name=name, status="completed", started_at=started, completed_at=_now(),
                    input_sha256=_sha(resolved), result_sha256=_sha(result), result=result,
                )
                results_by_id[item.id] = result
            except HTTPException as exc:
                detail = exc.detail if isinstance(exc.detail, dict) else {"message": str(exc.detail)}
                run = ProjectRunResult(
                    id=item.id, operation_id=item.operation_id, module_key=module_key,
                    analysis_name=name, status="failed", started_at=started, completed_at=_now(),
                    error={"code": str(detail.get("code", "analysis_failed")),
                           "message": str(detail.get("message") or detail.get("detail") or "Analysis failed.")},
                )
            except Exception as exc:
                log.exception(
                    "Project analysis failed (request_id=%s analysis_id=%s operation_id=%s)",
                    getattr(request.state, "request_id", "unknown"), item.id, item.operation_id,
                )
                run = ProjectRunResult(
                    id=item.id, operation_id=item.operation_id, module_key=module_key,
                    analysis_name=name, status="failed", started_at=started, completed_at=_now(),
                    error={
                        "code": "analysis_failed",
                        "message": "The analysis failed. Use the request ID when reporting this error.",
                    },
                )
        states[item.id] = run.status
        runs.append(run)
        if emit:
            await emit({"type": "analysis_completed" if run.status == "completed" else "analysis_failed",
                        "done": index + 1, "total": len(ordered), "run": run.model_dump()})
            await asyncio.sleep(0)
        if req.fail_fast and run.status == "failed":
            break

    if req.fail_fast and len(runs) < len(ordered):
        for item in ordered[len(runs):]:
            route = route_map.get(item.operation_id)
            runs.append(ProjectRunResult(
                id=item.id, operation_id=item.operation_id,
                module_key=item.module_key or (route_module(route.path) if route else "unknown"),
                analysis_name=item.analysis_name or item.id, status="skipped",
                error={"code": "fail_fast", "message": "Skipped after an earlier analysis failed."},
            ))

    project = req.project.model_dump(by_alias=True)
    project["analysisRuns"] = list(project.get("analysisRuns", []))
    for item, run in zip(ordered, runs):
        if run.status == "completed":
            project["analysisRuns"].append(_record(req, item, run, request))
    project["analysisRuns"] = project["analysisRuns"][-10_000:]
    project["modules"] = dict(project.get("modules", {}))
    project["modules"]["apiResults"] = {run.id: run.model_dump() for run in runs}
    counts = {status: sum(run.status == status for run in runs)
              for status in ("completed", "failed", "blocked", "skipped")}
    summary = ProjectRunSummary(total=len(runs), **counts)
    response = ProjectRunResponse(project=project, summary=summary, runs=runs)
    if emit:
        await emit({"type": "result", "data": response.model_dump(),
                    "result_sha256": _sha(response.model_dump())})
    return response


@router.post("/validate", response_model=ProjectValidationResponse, summary="Validate a project run")
def validate_project(req: ProjectRunRequest, request: Request) -> ProjectValidationResponse:
    items = _selected(_project_runs(req), req)
    _, issues = _order(items)
    route_map = _route_map(request.app)
    for item in items:
        route = route_map.get(item.operation_id)
        if route is None:
            issues.append(ProjectIssue(
                code="unknown_operation", message="The operation is not project-runnable.",
                analysis_id=item.id,
            ))
            continue
        if not _contains_result_ref(item.input):
            try:
                _validate_route_input(route, item.input)
            except Exception as exc:
                issues.append(ProjectIssue(
                    code="invalid_analysis_input", message=str(exc), analysis_id=item.id,
                ))
    return ProjectValidationResponse(
        valid=not issues, schema_version=req.project.schema_version, analyses=len(items),
        runnable=len(items) - sum(issue.code == "unknown_operation" for issue in issues), issues=issues,
    )


@router.post("/run", response_model=ProjectRunResponse, summary="Run a project")
async def run_project(req: ProjectRunRequest, request: Request) -> ProjectRunResponse:
    return await execute_project(req, request)


@router.post("/run/stream", summary="Run a project with NDJSON progress",
             response_class=StreamingResponse, responses={
                 200: {"content": {"application/x-ndjson": {"schema": {"type": "string"}}}},
             })
async def run_project_stream(req: ProjectRunRequest, request: Request) -> StreamingResponse:
    async def generate():
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

        async def emit(event: dict[str, Any]) -> None:
            await queue.put(event)

        async def produce() -> None:
            try:
                await execute_project(req, request, emit)
            except Exception:
                log.exception(
                    "Project stream failed (request_id=%s)",
                    getattr(request.state, "request_id", "unknown"),
                )
                await emit({"type": "error", "error": {
                    "code": "project_run_failed",
                    "message": "The project run failed. Use the request ID when reporting this error.",
                    "issues": [],
                    "request_id": getattr(request.state, "request_id", ""),
                }})

        task = asyncio.create_task(produce())
        try:
            while True:
                event = await queue.get()
                yield json.dumps(event, separators=(",", ":"), allow_nan=False) + "\n"
                if event.get("type") in {"result", "error"}:
                    break
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(generate(), media_type="application/x-ndjson")


def _csv_bytes(rows: list[dict[str, Any]]) -> bytes:
    columns: list[str] = []
    for row in rows:
        for key in row:
            if key not in columns:
                columns.append(key)
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({key: value if not isinstance(value, (dict, list))
                         else json.dumps(value, separators=(",", ":")) for key, value in row.items()})
    return output.getvalue().encode("utf-8")


def _tabular_results(value: Any, path: tuple[str, ...] = ()):
    if isinstance(value, list) and value and all(isinstance(row, dict) for row in value):
        yield path or ("table",), value
        return
    if not isinstance(value, dict):
        return
    vector_columns = {
        str(key): column for key, column in value.items()
        if isinstance(column, list) and column
        and all(not isinstance(item, (dict, list)) for item in column)
    }
    lengths = {len(column) for column in vector_columns.values()}
    if len(vector_columns) >= 2 and len(lengths) == 1:
        keys = list(vector_columns)
        yield path or ("table",), [
            {key: vector_columns[key][index] for key in keys}
            for index in range(next(iter(lengths)))
        ]
    for key, nested in value.items():
        if key in vector_columns:
            continue
        if isinstance(nested, (dict, list)):
            yield from _tabular_results(nested, (*path, str(key)))


@router.post("/export", summary="Run a project and export structured results",
             response_class=Response, responses={
                 200: {"content": {"application/zip": {
                     "schema": {"type": "string", "format": "binary"},
                 }}},
             })
async def export_project(req: ProjectRunRequest, request: Request) -> Response:
    completed = await execute_project(req, request)
    files: dict[str, bytes] = {
        "project.json": json.dumps(completed.project, indent=2, ensure_ascii=False).encode("utf-8"),
        "run-summary.json": json.dumps(completed.summary.model_dump(), indent=2).encode("utf-8"),
        "api-catalog.json": json.dumps(
            build_catalog(request.app).model_dump(), indent=2, ensure_ascii=False,
        ).encode("utf-8"),
    }
    for run in completed.runs:
        safe = "".join(char if char.isalnum() or char in "-_." else "_" for char in run.id)[:120]
        files[f"results/{safe}.json"] = json.dumps(run.model_dump(), indent=2, ensure_ascii=False).encode("utf-8")
        for path, rows in _tabular_results(run.result):
            suffix = "-".join(
                "".join(char if char.isalnum() or char in "-_." else "_" for char in part)[:60]
                for part in path
            )
            files[f"results/{safe}-{suffix}.csv"] = _csv_bytes(rows)
    manifest = {
        "schema": "perdura.api-project-export/v1", "generated_at": _now(),
        "project": req.project.project, "software": _software(request),
        "assurance": {
            "level": "checksum-only",
            "integrity_algorithm": "SHA-256",
            "authenticity_established": False,
            "statement": (
                "Checksums detect changed bytes but do not authenticate the producer. "
                "Retain the referenced build-verification evidence with controlled outputs."
            ),
        },
        "files": [{"path": path, "size_bytes": len(data),
                   "sha256": hashlib.sha256(data).hexdigest()} for path, data in sorted(files.items())],
    }
    files["manifest.json"] = json.dumps(manifest, indent=2).encode("utf-8")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path, data in files.items():
            archive.writestr(path, data)
    filename = "".join(char if char.isalnum() or char in "-_." else "_" for char in req.project.project) or "project"
    return Response(
        buffer.getvalue(), media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}_api-results.zip"'},
    )
