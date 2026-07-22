"""FastAPI backend for the Reliability Analysis GUI."""

import hashlib
import logging
import os
import sys
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from api_catalog import assign_stable_operation_ids, router as catalog_router, stable_operation_id
from api_contract import (
    API_PREFIX,
    ApiMetadataMiddleware,
    complete_openapi_contract,
    error_payload,
    http_error_response,
    validation_error_response,
)
from project_api import router as project_router

from routers import (
    life_data, alt, system_reliability, fault_tree, prediction, pof, growth, warranty,
    descriptive, hypothesis, regression, doe, msa, capability, spc, predictive, modeling,
    markov, ram, allocation, maintenance, hra, system_conversion,
)


def _app_version() -> str:
    """Running version: PERDURA_VERSION env (set by CI / the Docker build) ->
    the reliability library's stamped __version__ -> 'dev'."""
    env = os.environ.get("PERDURA_VERSION")
    if env:
        return env
    try:
        from reliability import __version__  # src is on sys.path via the routers import
        return __version__
    except Exception:
        return "dev"


APP_VERSION = _app_version()

try:
    from reliability._build import (
        BUILD_COMMIT as _STAMPED_COMMIT,
        BUILD_TIMESTAMP as _STAMPED_TIMESTAMP,
        BUILD_VERIFICATION_REPORT_SHA256 as _STAMPED_VERIFICATION_SHA256,
        BUILD_VERIFICATION_RUN_URL as _STAMPED_VERIFICATION_RUN_URL,
        PROJECT_SCHEMA_VERSION,
    )
except Exception:
    _STAMPED_COMMIT = "dev"
    _STAMPED_TIMESTAMP = "dev"
    _STAMPED_VERIFICATION_SHA256 = ""
    _STAMPED_VERIFICATION_RUN_URL = ""
    PROJECT_SCHEMA_VERSION = 4

APP_COMMIT = os.environ.get("PERDURA_COMMIT") or _STAMPED_COMMIT
BUILD_TIMESTAMP = os.environ.get("PERDURA_BUILD_TIMESTAMP") or _STAMPED_TIMESTAMP
BUILD_VERIFICATION_REPORT_SHA256 = (
    os.environ.get("PERDURA_VERIFICATION_REPORT_SHA256")
    or _STAMPED_VERIFICATION_SHA256
)
BUILD_VERIFICATION_RUN_URL = (
    os.environ.get("PERDURA_VERIFICATION_RUN_URL")
    or _STAMPED_VERIFICATION_RUN_URL
)


def _runtime_executable_sha256() -> str | None:
    if not getattr(sys, "frozen", False):
        return None
    try:
        digest = hashlib.sha256()
        with Path(sys.executable).open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()
    except OSError:
        return None


def _version_payload() -> dict[str, str | int | None]:
    return {
        "version": APP_VERSION,
        "commit": APP_COMMIT,
        "built_at": BUILD_TIMESTAMP,
        "project_schema": PROJECT_SCHEMA_VERSION,
        "verification_report_sha256": BUILD_VERIFICATION_REPORT_SHA256,
        "verification_run_url": BUILD_VERIFICATION_RUN_URL,
        "runtime_executable_sha256": _runtime_executable_sha256(),
    }

app = FastAPI(
    title="Perdura API",
    version=APP_VERSION,
    description=(
        "Stateless reliability-engineering calculations and project automation. "
        "Use GET /api/v1/catalog to discover every supported module and analysis."
    ),
    docs_url=f"{API_PREFIX}/docs",
    swagger_ui_oauth2_redirect_url=f"{API_PREFIX}/docs/oauth2-redirect",
    redoc_url=f"{API_PREFIX}/redoc",
    openapi_url=f"{API_PREFIX}/openapi.json",
    generate_unique_id_function=lambda route: stable_operation_id(
        route.path,
        sorted((route.methods or {"GET"}) - {"HEAD", "OPTIONS"})[0],
    ),
)
app.state.perdura_version = APP_VERSION
app.state.perdura_commit = APP_COMMIT
app.state.perdura_built_at = BUILD_TIMESTAMP

_cors_origins = [origin.strip() for origin in os.environ.get(
    "PERDURA_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173",
).split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(
    ApiMetadataMiddleware, app_version=APP_VERSION, app_commit=APP_COMMIT,
)

app.include_router(life_data.router, prefix=f"{API_PREFIX}/life-data", tags=["Life Data"])
app.include_router(alt.router, prefix=f"{API_PREFIX}/alt", tags=["Reliability Testing"])
app.include_router(system_reliability.router, prefix=f"{API_PREFIX}/system", tags=["System Reliability"])
app.include_router(fault_tree.router, prefix=f"{API_PREFIX}/fault-tree", tags=["Fault Tree"])
app.include_router(system_conversion.router, prefix=f"{API_PREFIX}/system-modeling", tags=["System Modeling Conversion"])
app.include_router(prediction.router, prefix=f"{API_PREFIX}/prediction", tags=["Failure Rate Prediction"])
app.include_router(pof.router, prefix=f"{API_PREFIX}/pof", tags=["Physics of Failure"])
app.include_router(growth.router, prefix=f"{API_PREFIX}/growth", tags=["Reliability Growth"])
app.include_router(warranty.router, prefix=f"{API_PREFIX}/warranty", tags=["Warranty Analysis"])
app.include_router(descriptive.router, prefix=f"{API_PREFIX}/descriptive", tags=["Descriptive Statistics"])
app.include_router(hypothesis.router, prefix=f"{API_PREFIX}/hypothesis", tags=["Hypothesis Tests"])
app.include_router(regression.router, prefix=f"{API_PREFIX}/regression", tags=["Regression Analysis"])
app.include_router(doe.router, prefix=f"{API_PREFIX}/doe", tags=["Design of Experiments"])
app.include_router(msa.router, prefix=f"{API_PREFIX}/msa", tags=["MSA"])
app.include_router(capability.router, prefix=f"{API_PREFIX}/capability", tags=["Process Capability"])
app.include_router(spc.router, prefix=f"{API_PREFIX}/spc", tags=["SPC"])
app.include_router(predictive.router, prefix=f"{API_PREFIX}/predictive", tags=["Predictive Analytics"])
app.include_router(modeling.router, prefix=f"{API_PREFIX}/modeling", tags=["Decision-Grade Modeling"])
app.include_router(markov.router, prefix=f"{API_PREFIX}/markov", tags=["Markov Chain"])
app.include_router(ram.router, prefix=f"{API_PREFIX}/ram", tags=["RAM"])
app.include_router(allocation.router, prefix=f"{API_PREFIX}/allocation", tags=["Reliability Allocation"])
app.include_router(maintenance.router, prefix=f"{API_PREFIX}/maintenance", tags=["Maintenance"])
app.include_router(hra.router, prefix=f"{API_PREFIX}/hra", tags=["Human Reliability"])
app.include_router(project_router, prefix=f"{API_PREFIX}/projects", tags=["Projects"])
app.include_router(catalog_router, prefix=API_PREFIX, tags=["Discovery"])


@app.exception_handler(ValueError)
async def _value_error_handler(request: Request, exc: ValueError):
    """Treat a bubbled-up ValueError as a 400 (bad input). Lets routers drop the
    boilerplate `except ValueError: raise HTTPException(400, ...)` wrapper."""
    return JSONResponse(
        status_code=400,
        content=error_payload(request, code="invalid_model_input", message=str(exc)),
    )


@app.exception_handler(RequestValidationError)
async def _request_validation_error_handler(request: Request, exc: RequestValidationError):
    return validation_error_response(request, exc)


@app.exception_handler(HTTPException)
async def _http_error_handler(request: Request, exc: HTTPException):
    return http_error_response(request, exc)


@app.exception_handler(Exception)
async def _unexpected_error_handler(request: Request, exc: Exception):
    logging.getLogger("perdura.api").exception(
        "Unhandled API error (request_id=%s)", getattr(request.state, "request_id", "unknown"),
    )
    return JSONResponse(
        status_code=500,
        content=error_payload(
            request, code="internal_error",
            message="The request could not be completed. Use the request ID when reporting this error.",
        ),
    )


@app.get(f"{API_PREFIX}/health", summary="Check service health")
def health():
    return {"status": "ok", **_version_payload()}


@app.get(f"{API_PREFIX}/version", summary="Get software and schema identity")
def version():
    return _version_payload()


# ---------------------------------------------------------------------------
# Serve the built frontend (production / packaged mode)
# ---------------------------------------------------------------------------
# When running as a PyInstaller bundle, _MEIPASS points to the temp extract
# directory.  Otherwise fall back to the sibling frontend/dist folder.
def _find_static_dir() -> Path | None:
    if getattr(sys, "frozen", False):
        base = Path(sys._MEIPASS)  # type: ignore[attr-defined]
    else:
        base = Path(__file__).resolve().parent.parent / "frontend"
    dist = base / "dist"
    if dist.is_dir() and (dist / "index.html").exists():
        return dist
    return None


_static_dir = _find_static_dir()

if _static_dir is not None:
    app.mount("/assets", StaticFiles(directory=str(_static_dir / "assets")), name="static-assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def _spa_fallback(request: Request, full_path: str):
        """Serve the SPA: try an exact file first, fall back to index.html."""
        file = _static_dir / full_path
        if full_path and file.is_file():
            return FileResponse(str(file))
        return FileResponse(str(_static_dir / "index.html"))


assign_stable_operation_ids(app)


def _public_openapi():
    if app.openapi_schema is None:
        app.openapi_schema = complete_openapi_contract(get_openapi(
            title=app.title, version=app.version, description=app.description, routes=app.routes,
        ))
    return app.openapi_schema


app.openapi = _public_openapi
