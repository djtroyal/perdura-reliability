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


class GenerateRequest(BaseModel):
    """Monte Carlo sample generation from a specified distribution."""
    distribution: str                      # e.g. 'Weibull_2P'
    params: dict[str, float]               # e.g. {'alpha': 100, 'beta': 2}
    n: int = 20
    seed: Optional[int] = None


class SpecCurvesRequest(BaseModel):
    """Distribution curves from user-specified parameters (no data)."""
    distribution: str
    params: dict[str, float]


class EvaluateRequest(BaseModel):
    """Evaluate SF/CDF of a specified distribution at time t."""
    distribution: str
    params: dict[str, float]
    t: float


class CompareFolio(BaseModel):
    name: str
    failures: list[float]
    right_censored: Optional[list[float]] = None


class CompareRequest(BaseModel):
    """Statistical comparison of multiple life-data folios."""
    folios: list[CompareFolio]
    distribution: str = "Weibull_2P"
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


class SampleSizeRequest(BaseModel):
    # 'nonparametric' (Method 1) | 'parametric_samples' (2A) | 'parametric_time' (2B)
    method: str = "nonparametric"
    failures: int = 0
    R: float = 0.80                       # reliability requirement (R_rqmt for parametric)
    CI: float = 0.90
    mission_time: Optional[float] = None  # parametric methods
    beta: Optional[float] = None          # Weibull shape, parametric methods
    test_time: Optional[float] = None     # Method 2A
    n: Optional[int] = None               # Method 2B
    options_table: bool = False
    oc_curve: bool = False


# --- Failure Rate Prediction (MIL-HDBK-217F / VITA 51.1) ---

class PredictionPart(BaseModel):
    # 'microcircuit' | 'diode' | 'bjt' | 'fet' | 'resistor' | 'capacitor' | 'generic'
    category: str
    name: Optional[str] = None
    quantity: int = 1
    params: dict[str, Any] = {}
    # ANSI/VITA 51.1 supplement: None = inherit global setting,
    # True/False = per-part override
    apply_vita: Optional[bool] = None
    # Logical grouping label (presentation/library aggregation only)
    group: Optional[str] = None


class PredictionRequest(BaseModel):
    environment: str = "GB"
    # Base prediction is always MIL-HDBK-217F; VITA 51.1 is applied as a
    # supplement either globally or per part.
    vita_global: bool = False
    parts: list[PredictionPart]


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
