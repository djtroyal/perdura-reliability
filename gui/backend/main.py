"""FastAPI backend for the Reliability Analysis GUI."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import life_data, alt, system_reliability, fault_tree, prediction, pof

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


@app.get("/api/health")
def health():
    return {"status": "ok"}
