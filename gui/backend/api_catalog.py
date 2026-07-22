"""Discoverable inventory of the public Perdura API."""

from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Request
from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict

from api_contract import API_PREFIX, API_VERSION


router = APIRouter()


MODULES: dict[str, tuple[str, str]] = {
    "life-data": ("Life Data Analysis", "calculation"),
    "alt": ("Reliability Testing", "calculation"),
    "system": ("Reliability Block Diagrams", "calculation"),
    "fault-tree": ("Fault Tree Analysis", "calculation"),
    "system-modeling": ("System Modeling Conversion", "calculation"),
    "prediction": ("Failure Rate Prediction", "calculation"),
    "pof": ("Physics of Failure", "calculation"),
    "growth": ("Reliability Growth", "calculation"),
    "warranty": ("Warranty Analysis", "calculation"),
    "descriptive": ("Descriptive Statistics", "calculation"),
    "hypothesis": ("Hypothesis Tests", "calculation"),
    "regression": ("Regression", "calculation"),
    "doe": ("Design of Experiments", "calculation"),
    "msa": ("Measurement Systems Analysis", "calculation"),
    "capability": ("Process Capability", "calculation"),
    "spc": ("Statistical Process Control", "calculation"),
    "predictive": ("Predictive Analytics", "calculation"),
    "modeling": ("Regression & Machine Learning", "calculation"),
    "markov": ("Markov Analysis", "calculation"),
    "ram": ("Reliability, Availability & Maintainability", "calculation"),
    "allocation": ("Reliability Allocation", "calculation"),
    "maintenance": ("Maintenance", "calculation"),
    "hra": ("Human Reliability", "calculation"),
    "projects": ("Dashboard, Projects & Report Builder", "workflow"),
}


class AnalysisCapability(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    operation_id: str
    title: str
    method: str
    path: str
    stream_path: str | None = None
    project_runnable: bool = False


class ModuleCapability(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    title: str
    kind: str
    analyses: list[AnalysisCapability]


class CatalogResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    api_version: str
    openapi_url: str
    docs_url: str
    modules: list[ModuleCapability]


def stable_operation_id(path: str, method: str) -> str:
    relative = path.removeprefix(f"{API_PREFIX}/").strip("/")
    value = re.sub(r"[{}]", "", relative)
    value = re.sub(r"[^a-zA-Z0-9]+", "_", value).strip("_")
    return f"{method.lower()}_{value}" or f"{method.lower()}_root"


def public_routes(app: Any) -> list[Any]:
    """Return effective routes across eager and lazy FastAPI router versions."""
    routes: list[Any] = []
    for candidate in app.routes:
        if isinstance(candidate, APIRoute):
            routes.append(candidate)
        elif hasattr(candidate, "effective_candidates"):
            routes.extend(candidate.effective_candidates())
    return sorted(
        [route for route in routes if route.path.startswith(f"{API_PREFIX}/")
         and route.include_in_schema],
        key=lambda route: (route.path, sorted(route.methods or set())),
    )


def assign_stable_operation_ids(app: Any) -> None:
    for route in public_routes(app):
        methods = sorted((route.methods or {"GET"}) - {"HEAD", "OPTIONS"})
        route.operation_id = stable_operation_id(route.path, methods[0])
        route.unique_id = route.operation_id


def route_module(path: str) -> str:
    relative = path.removeprefix(f"{API_PREFIX}/")
    prefix = relative.split("/", 1)[0]
    return prefix if prefix in MODULES else "projects"


def route_project_runnable(route: Any) -> bool:
    if "POST" not in (route.methods or set()) or route.path.endswith("/stream"):
        return False
    if route.path.endswith("/export/onnx"):
        return False
    if any(media in str(route.response_class).lower() for media in ("file", "stream")):
        return False
    return (len(route.dependant.body_params) == 1
            and not route.dependant.path_params
            and not route.dependant.query_params)


def build_catalog(app: Any) -> CatalogResponse:
    grouped: dict[str, list[AnalysisCapability]] = {key: [] for key in MODULES}
    stream_paths = {route.path.removesuffix("/stream") for route in public_routes(app)
                    if route.path.endswith("/stream")}
    for route in public_routes(app):
        if route.path in {f"{API_PREFIX}/catalog", f"{API_PREFIX}/health", f"{API_PREFIX}/version"}:
            continue
        if route.path.endswith("/stream"):
            continue
        method = sorted((route.methods or {"GET"}) - {"HEAD", "OPTIONS"})[0]
        module_id = route_module(route.path)
        relative = route.path.removeprefix(f"{API_PREFIX}/{module_id}/").strip("/")
        grouped[module_id].append(AnalysisCapability(
            id=f"{module_id}.{relative.replace('/', '.')}",
            operation_id=route.operation_id or route.unique_id or stable_operation_id(route.path, method),
            title=route.summary or route.name.replace("_", " ").title(),
            method=method,
            path=route.path,
            stream_path=f"{route.path}/stream" if route.path in stream_paths else None,
            project_runnable=route_project_runnable(route),
        ))
    modules = [ModuleCapability(id=key, title=title, kind=kind, analyses=grouped[key])
               for key, (title, kind) in MODULES.items()]
    return CatalogResponse(
        api_version=API_VERSION,
        openapi_url=f"{API_PREFIX}/openapi.json",
        docs_url=f"{API_PREFIX}/docs",
        modules=modules,
    )


@router.get("/catalog", response_model=CatalogResponse, summary="List modules and analyses")
def catalog(request: Request) -> CatalogResponse:
    return build_catalog(request.app)
