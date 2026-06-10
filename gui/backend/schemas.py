"""Pydantic schemas for the Reliability Analysis API."""

from typing import Any, Optional
from pydantic import BaseModel


# --- Life Data ---

class LifeDataFitRequest(BaseModel):
    failures: list[float]
    right_censored: Optional[list[float]] = None
    distributions_to_fit: Optional[list[str]] = None
    method: str = "MLE"
    CI: float = 0.95


class NonparametricRequest(BaseModel):
    failures: list[float]
    right_censored: Optional[list[float]] = None
    method: str = "KM"
    CI: float = 0.95


# --- ALT ---

class ALTFitRequest(BaseModel):
    failures: list[float]
    failure_stress: list[float]
    right_censored: Optional[list[float]] = None
    right_censored_stress: Optional[list[float]] = None
    use_level_stress: Optional[float] = None
    models_to_fit: Optional[list[str]] = None
    sort_by: str = "AICc"


# --- System Reliability (RBD) ---

class RBDNode(BaseModel):
    id: str
    type: str  # 'source' | 'sink' | 'component'
    data: Optional[dict[str, Any]] = None


class RBDEdge(BaseModel):
    source: str
    target: str


class RBDRequest(BaseModel):
    nodes: list[RBDNode]
    edges: list[RBDEdge]


# --- Fault Tree ---

class FTNode(BaseModel):
    id: str
    type: str  # 'basic' | 'and' | 'or' | 'vote'
    data: dict[str, Any]


class FTEdge(BaseModel):
    source: str  # parent gate
    target: str  # child event/gate


class FaultTreeRequest(BaseModel):
    nodes: list[FTNode]
    edges: list[FTEdge]
