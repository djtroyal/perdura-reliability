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


# --- Stress-Strength Interference ---

class StressStrengthRequest(BaseModel):
    stress_distribution: str
    stress_params: dict[str, float]
    strength_distribution: str
    strength_params: dict[str, float]


# --- ALT Acceleration Factor ---

class AccelerationFactorRequest(BaseModel):
    model: str = "arrhenius"
    stress_test: float = 100.0
    stress_use: float = 40.0
    params: dict[str, float] = {}


# --- Physics of Failure ---

class SNCurveRequest(BaseModel):
    stress_amplitude: list[float]  # stress values
    cycles_to_failure: list[float]  # corresponding cycle counts
    stress_query: Optional[float] = None  # optional: predict life at this stress
    life_query: Optional[float] = None  # optional: predict stress at this life


class StressStrainRequest(BaseModel):
    E: float  # Young's modulus (MPa)
    K: float = 1000.0  # strength coefficient
    n: float = 0.15  # strain hardening exponent
    sigma_y: Optional[float] = None  # yield stress (for display only)
    max_stress: Optional[float] = None  # max stress to plot (defaults to 1.5 * K)


class CreepRequest(BaseModel):
    temperature_C: float = 500.0
    stress_MPa: float = 100.0
    C: float = 20.0  # Larson-Miller constant (typically 20 for metals)
    lmp_coeffs: list[float] = [25000.0, -5.0]  # LMP = a + b*log10(stress)


class DamageRequest(BaseModel):
    stress_levels: list[float]
    cycles_applied: list[float]
    cycles_to_failure: list[float]  # Nf at each stress level


class FractureRequest(BaseModel):
    sigma: float = 100.0  # applied stress (MPa)
    a: float = 0.001  # crack length (m)
    Y: float = 1.12  # geometry factor
    K_Ic: float = 50.0  # fracture toughness (MPa*sqrt(m))
    C: float = 1e-11  # Paris law coefficient
    m: float = 3.0  # Paris law exponent
    a_initial: Optional[float] = None  # for crack growth (defaults to a)
    delta_sigma: Optional[float] = None  # stress range for fatigue crack growth
