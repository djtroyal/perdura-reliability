"""FastAPI backend for the Reliability Analysis GUI."""

import sys
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from routers import (
    life_data, alt, system_reliability, fault_tree, prediction, pof, growth, warranty,
    descriptive, hypothesis, regression, doe, msa, capability, spc, predictive,
    markov, ram, allocation, maintenance, hra,
)

app = FastAPI(title="Reliability Analysis API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(life_data.router, prefix="/api/life-data", tags=["Life Data"])
app.include_router(alt.router, prefix="/api/alt", tags=["ALT"])
app.include_router(system_reliability.router, prefix="/api/system", tags=["System Reliability"])
app.include_router(fault_tree.router, prefix="/api/fault-tree", tags=["Fault Tree"])
app.include_router(prediction.router, prefix="/api/prediction", tags=["Failure Rate Prediction"])
app.include_router(pof.router, prefix="/api/pof", tags=["Physics of Failure"])
app.include_router(growth.router, prefix="/api/growth", tags=["Reliability Growth"])
app.include_router(warranty.router, prefix="/api/warranty", tags=["Warranty Analysis"])
app.include_router(descriptive.router, prefix="/api/descriptive", tags=["Descriptive Statistics"])
app.include_router(hypothesis.router, prefix="/api/hypothesis", tags=["Hypothesis Tests"])
app.include_router(regression.router, prefix="/api/regression", tags=["Regression Analysis"])
app.include_router(doe.router, prefix="/api/doe", tags=["Design of Experiments"])
app.include_router(msa.router, prefix="/api/msa", tags=["MSA"])
app.include_router(capability.router, prefix="/api/capability", tags=["Process Capability"])
app.include_router(spc.router, prefix="/api/spc", tags=["SPC"])
app.include_router(predictive.router, prefix="/api/predictive", tags=["Predictive Analytics"])
app.include_router(markov.router, prefix="/api/markov", tags=["Markov Chain"])
app.include_router(ram.router, prefix="/api/ram", tags=["RAM"])
app.include_router(allocation.router, prefix="/api/allocation", tags=["Reliability Allocation"])
app.include_router(maintenance.router, prefix="/api/maintenance", tags=["Maintenance"])
app.include_router(hra.router, prefix="/api/hra", tags=["Human Reliability"])


@app.exception_handler(ValueError)
async def _value_error_handler(request: Request, exc: ValueError):
    """Treat a bubbled-up ValueError as a 400 (bad input). Lets routers drop the
    boilerplate `except ValueError: raise HTTPException(400, ...)` wrapper."""
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.get("/api/health")
def health():
    return {"status": "ok"}


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

    @app.get("/{full_path:path}")
    async def _spa_fallback(request: Request, full_path: str):
        """Serve the SPA: try an exact file first, fall back to index.html."""
        file = _static_dir / full_path
        if full_path and file.is_file():
            return FileResponse(str(file))
        return FileResponse(str(_static_dir / "index.html"))
