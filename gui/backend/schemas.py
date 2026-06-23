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


class MCEquationVariable(BaseModel):
    name: str                              # e.g. 'A', 'B', 'Load1'
    distribution: str                      # e.g. 'Normal_2P'
    params: dict[str, float]               # e.g. {'mu': 2.0146, 'sigma': 0.0181}


class MCEquationRequest(BaseModel):
    """Equation-based Monte Carlo: combine multiple random variables via a formula."""
    variables: list[MCEquationVariable]    # 1–20 input variables
    equation: str                          # e.g. 'A + B + C'
    n: int = 1000                          # 1–100,000
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


class CalculatorRequest(BaseModel):
    """Comprehensive life-metrics calculator for a specified distribution."""
    distribution: str
    params: dict[str, float]
    mission_end: Optional[float] = None       # R(t), F(t), f(t), h(t)
    elapsed: Optional[float] = None           # conditional R/F start time
    reliability_target: Optional[float] = None  # for reliable life
    bx_percent: Optional[float] = None        # for BX% life


class CompareFolio(BaseModel):
    name: str
    failures: list[float]
    right_censored: Optional[list[float]] = None


class CompareRequest(BaseModel):
    """Statistical comparison of multiple life-data folios."""
    folios: list[CompareFolio]
    distribution: str = "Weibull_2P"
    CI: float = 0.95


class SpecialModelRequest(BaseModel):
    """Fit a special Weibull model (mixture, competing risks, DSZI, grouped)."""
    # 'mixture' | 'competing_risks' | 'dszi' | 'ds' | 'zi' | 'grouped'
    model: str
    failures: list[float]
    right_censored: Optional[list[float]] = None
    # Grouped data: per-time quantities (parallel to failures/right_censored)
    failure_quantities: Optional[list[float]] = None
    right_censored_quantities: Optional[list[float]] = None
    CI: float = 0.95


class WeibayesRequest(BaseModel):
    """Weibayes (Bayesian Weibull) fit with a fixed assumed shape parameter."""
    failures: list[float]
    right_censored: Optional[list[float]] = None
    beta: float          # assumed/fixed Weibull shape
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


class StepStressRequest(BaseModel):
    """Step-stress ALT using cumulative exposure model."""
    failure_times: list[float]
    stress_at_failure: list[float]
    steps: list[dict]  # [{stress: float, duration: float}, ...]
    use_level_stress: Optional[float] = None
    distribution: str = "Weibull"


class HALTRequest(BaseModel):
    """Highly Accelerated Life Test — find operating/destruct limits."""
    stress_levels: list[float]
    outcomes: list[str]  # "pass", "fail", "anomaly"
    stress_type: str = "temperature"  # "temperature", "vibration", "combined"
    spec_min: Optional[float] = None
    spec_max: Optional[float] = None


class MarginTestRequest(BaseModel):
    """Margin test — demonstrate reliability at conditions beyond spec."""
    n_units: int
    n_failures: int
    test_duration: float
    test_stress: float
    spec_stress: float
    acceleration_factor: Optional[float] = None
    confidence: float = 0.95


class MultiStressRequest(BaseModel):
    """Multiple-stress ALT with two simultaneous stress variables."""
    failure_times: list[float]
    stress1: list[float]
    stress2: list[float]
    stress1_use: Optional[float] = None
    stress2_use: Optional[float] = None
    stress1_label: str = "Stress 1"
    stress2_label: str = "Stress 2"


class DegradationRequest(BaseModel):
    """Non-destructive degradation (wear-to-failure) analysis."""
    unit_ids: list[str]
    times: list[float]
    measurements: list[float]
    threshold: float
    threshold_direction: str = "above"   # "above" or "below"
    # linear, exponential, power, logarithmic, gompertz, lloyd_lipow
    degradation_model: str = "linear"
    # Weibull_2P, Normal_2P, Lognormal_2P, Exponential_1P, Gumbel_2P
    life_distribution: str = "Weibull_2P"
    reliability_time: Optional[float] = None      # compute R(t)/F(t) at this time
    use_extrapolated_intervals: bool = False      # delta-method CI on projected times
    ci: float = 0.90                              # confidence level for the bounds


class DestructiveDegradationRequest(BaseModel):
    """Destructive degradation analysis (one measurement per sample per time)."""
    times: list[float]
    measurements: list[float]
    threshold: float
    threshold_direction: str = "above"   # "above" or "below"
    # linear, exponential, power, logarithm, lloyd_lipow
    degradation_model: str = "linear"
    # Weibull, Exponential, Normal, Lognormal, Gumbel
    measurement_distribution: str = "Normal"
    reliability_time: Optional[float] = None      # compute R(t)/F(t) at this time


class ExpChiSquaredRDTRequest(BaseModel):
    """Exponential chi-squared reliability demonstration test."""
    metric: str = "reliability"          # "reliability" or "mttf"
    reliability: float = 0.9             # demonstrated reliability (if metric=reliability)
    demo_time: float = 100.0             # time at which reliability is demonstrated
    mttf: float = 100.0                  # demonstrated MTTF (if metric=mttf)
    confidence: float = 0.9
    failures: int = 0                    # allowable failures
    solve_for: str = "test_time"         # "test_time" (per unit) or "sample_size"
    n: Optional[int] = None              # units (when solving test_time)
    test_time: Optional[float] = None    # per-unit test time (when solving sample_size)


class BayesianRDTRequest(BaseModel):
    """Non-parametric Bayesian reliability demonstration test."""
    solve_for: str = "sample_size"       # "sample_size", "reliability", "confidence"
    reliability: float = 0.9             # target/required reliability
    confidence: float = 0.8
    failures: int = 0                    # allowed failures r in the demonstration test
    n: Optional[int] = None              # sample size (when solving reliability/confidence)
    prior_source: str = "expert"         # "expert" or "subsystem"
    # Expert-opinion prior (worst/most-likely/best reliability)
    worst: Optional[float] = None
    likely: Optional[float] = None
    best: Optional[float] = None
    # Subsystem-test prior: series system of subsystems with (n, r)
    subsystems: Optional[list[dict]] = None  # [{name, n, r}, ...]


class ExpectedFailureTimesRequest(BaseModel):
    """Expected failure times (with bounds) for a planned test."""
    n: int                               # sample size
    distribution: str = "Weibull"        # Weibull, Normal, Lognormal, Exponential
    beta: float = 2.0                    # Weibull/Lognormal/Normal shape (sigma for N/LN)
    eta: float = 500.0                   # Weibull scale / Normal mu / Lognormal mu / Exp MTTF
    confidence: float = 0.8              # 2-sided confidence level for the bounds


class DifferenceDetectionRequest(BaseModel):
    """Difference detection matrix for comparing two designs' life metric."""
    metric: str = "B10"                  # "B10" or "mean"
    confidence: float = 0.9
    design1_beta: float = 3.0
    design1_n: int = 20
    design2_beta: float = 2.0
    design2_n: int = 20
    metric_min: float = 500.0
    metric_max: float = 3000.0
    metric_increment: float = 500.0
    test_times: list[float] = []         # candidate test durations, ascending


class TestSimulationRequest(BaseModel):
    """Monte-Carlo simulation of a reliability test design."""
    distribution: str = "Weibull"        # Weibull, Normal, Lognormal, Exponential
    beta: float = 2.0
    eta: float = 1000.0
    n: int = 20                          # sample size
    test_duration: Optional[float] = None  # time-terminated test (suspend survivors)
    num_simulations: int = 1000
    metric: str = "reliability"          # "reliability" (at target_time) or "B10"
    target_time: float = 500.0           # time for the reliability metric
    target_value: Optional[float] = None  # success threshold for the metric
    seed: Optional[int] = None


class ESSRequest(BaseModel):
    """Environmental Stress Screening profile development."""
    defect_rate: float                 # fraction defective (0-1)
    target_screening_strength: float   # fraction of defects to detect (0-1)
    screening_type: str = "thermal"    # "thermal", "vibration", "combined"
    temp_range: Optional[float] = None     # ΔT in °C
    ramp_rate: Optional[float] = None      # °C/min
    num_cycles: Optional[int] = None
    dwell_time: Optional[float] = None     # minutes
    grms: Optional[float] = None
    vib_duration: Optional[float] = None   # minutes


class HASSRequest(BaseModel):
    """Highly Accelerated Stress Screening profile development."""
    op_temp_low: float
    op_temp_high: float
    destruct_temp_low: float
    destruct_temp_high: float
    op_vib: float
    destruct_vib: float
    target_precip_ss: float
    detection_duration: float          # hours
    use_mtbf: float                    # hours


class BurnInRequest(BaseModel):
    """Burn-in test design to screen infant-mortality failures."""
    duration: float                    # burn-in duration (hours)
    beta: float                        # Weibull shape parameter
    eta: float                         # Weibull characteristic life (hours)
    n_units: int
    temperature: Optional[float] = None
    acceleration_factor: float = 1.0
    use_temperature: Optional[float] = None


class OneSampleProportionRequest(BaseModel):
    trials: int
    successes: int
    CI: float = 0.95


class TwoProportionRequest(BaseModel):
    trials_1: int
    successes_1: int
    trials_2: int
    successes_2: int
    CI: float = 0.95


class NoFailuresRequest(BaseModel):
    reliability: float
    CI: float = 0.95
    lifetimes: float = 1.0
    weibull_shape: float = 1.0


class SequentialSamplingRequest(BaseModel):
    p1: float
    p2: float
    alpha: float = 0.05
    beta: float = 0.10
    max_samples: int = 100


class TestPlannerRequest(BaseModel):
    MTBF: Optional[float] = None
    test_duration: Optional[float] = None
    number_of_failures: Optional[int] = None
    CI: float = 0.90
    two_sided: bool = False


class PassProbRequest(BaseModel):
    test_duration: float           # total test duration T (all units combined)
    allowable_failures: int = 0    # c
    true_mtbf: float               # assumed true MTBF M
    # OC curve: range of true_mtbf values to sweep
    oc_mtbf_min: Optional[float] = None
    oc_mtbf_max: Optional[float] = None
    oc_points: int = 200


class TestDurationRequest(BaseModel):
    MTBF_required: float
    MTBF_design: float
    consumer_risk: float = 0.10
    producer_risk: float = 0.10


class GoodnessOfFitRequest(BaseModel):
    """Chi-squared / KS goodness-of-fit test against a fitted distribution."""
    failures: list[float]
    distribution: str = "Weibull_2P"
    test: str = "chi_squared"  # or "ks"
    CI: float = 0.95


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


# --- Reliability Growth (Crow-AMSAA / Duane) ---

class GrowthRequest(BaseModel):
    times: list[float]
    T: Optional[float] = None  # total test time (None = failure terminated)
    model: str = "crow_amsaa"  # or "duane"


class OptimalReplacementRequest(BaseModel):
    """Optimal preventive-maintenance interval (cost model)."""
    cost_PM: float
    cost_CM: float
    weibull_alpha: float
    weibull_beta: float
    q: int = 0  # 0 = as good as new (renewal); 1 = as good as old (minimal repair)


class ROCOFRequest(BaseModel):
    """Rate of occurrence of failures + Laplace trend test."""
    times_between_failures: Optional[list[float]] = None
    failure_times: Optional[list[float]] = None
    test_end: Optional[float] = None
    CI: float = 0.95


class MCFRequest(BaseModel):
    """Mean Cumulative Function for recurrent events across systems."""
    data: list[list[float]]      # one list of event times per system
    CI: float = 0.95
    parametric: bool = False     # also fit the power-law parametric MCF


# --- Failure Rate Prediction (MIL-HDBK-217F / VITA 51.1) ---

class PredictionPart(BaseModel):
    # 'microcircuit' | 'diode' | 'bjt' | 'fet' | 'resistor' | 'capacitor' | 'generic'
    category: str
    name: Optional[str] = None
    # Free-text user notes about this part (not used in the calculation).
    notes: Optional[str] = None
    quantity: int = 1
    params: dict[str, Any] = {}
    # ANSI/VITA 51.1 supplement: None = inherit global setting,
    # True/False = per-part override
    apply_vita: Optional[bool] = None
    # Per-part environment override: None = inherit from global
    environment: Optional[str] = None
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
    type: str  # 'basic' | 'and' | 'or' | 'vote' | 'pand' | 'xor' | 'not' | 'transfer'
    data: dict[str, Any]


class FTEdge(BaseModel):
    source: str  # parent gate
    target: str  # child event/gate


class FaultTreeGraph(BaseModel):
    """A single fault tree's graph, used both as the primary request body and
    as referenced sub-trees for Transfer gates (#9)."""
    nodes: list[FTNode]
    edges: list[FTEdge]


class FaultTreeRequest(BaseModel):
    nodes: list[FTNode]
    edges: list[FTEdge]
    # Global exposure/mission time used for distribution-based basic events
    # that do not carry their own ``exposure_time`` override.
    exposure_time: Optional[float] = None
    # Calculation methods to report top-event probability for (#7).
    # Subset of {'exact', 'rare_event', 'min_cut_upper_bound', 'simulation'}.
    methods: Optional[list[str]] = None
    # Number of Monte Carlo samples for the 'simulation' method.
    n_simulations: Optional[int] = None
    # Random seed for reproducible Monte Carlo simulations.
    seed: Optional[int] = None
    # Other trees referenced by Transfer gates, keyed by tree id (#9).
    trees: Optional[dict[str, FaultTreeGraph]] = None
    # Id of the tree being analyzed (for transfer-gate cycle detection).
    tree_id: Optional[str] = None


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


class CoffinMansonRequest(BaseModel):
    E: float  # Young's modulus (MPa)
    sigma_f: float  # fatigue strength coefficient (MPa)
    b: float = -0.09  # fatigue strength exponent
    epsilon_f: float = 0.5  # fatigue ductility coefficient
    c: float = -0.6  # fatigue ductility exponent
    strain_query: Optional[float] = None  # total strain amplitude to solve for life


class NorrisLandzbergRequest(BaseModel):
    dT_use: float = 60.0  # field thermal cycle range (deg C)
    dT_test: float = 100.0  # test thermal cycle range (deg C)
    f_use: float = 2.0  # field cycling frequency (cycles/day)
    f_test: float = 48.0  # test cycling frequency (cycles/day)
    T_max_use: float = 60.0  # max field temperature (deg C)
    T_max_test: float = 100.0  # max test temperature (deg C)
    n: float = 1.9  # thermal range exponent
    m: float = 1.0 / 3.0  # frequency exponent
    Ea: float = 0.122  # activation energy (eV)
    cycles_test: Optional[float] = None  # test cycles to failure


class BlackRequest(BaseModel):
    A: float = 1e5  # material/process constant
    J: float = 1e6  # current density (A/cm^2)
    n: float = 2.0  # current density exponent
    Ea: float = 0.7  # activation energy (eV)
    T: float = 100.0  # temperature (deg C)


class PeckRequest(BaseModel):
    A: float = 1e5  # material/process constant
    RH: float = 85.0  # test relative humidity (%)
    n: float = 2.7  # humidity exponent
    Ea: float = 0.79  # activation energy (eV)
    T: float = 85.0  # test temperature (deg C)
    RH_use: Optional[float] = None  # use relative humidity (%)
    T_use: Optional[float] = None  # use temperature (deg C)


class ArrheniusRequest(BaseModel):
    Ea: float = 0.7  # activation energy (eV)
    T_use: float = 55.0  # use temperature (deg C)
    T_test: float = 125.0  # test temperature (deg C)
    life_test: Optional[float] = None  # life at test conditions (hours)


class EyringRequest(BaseModel):
    Ea: float = 0.7  # activation energy (eV)
    T_use: float = 55.0  # use temperature (deg C)
    T_test: float = 125.0  # test temperature (deg C)
    n: float = 0.0  # temperature pre-exponent (T^n term)
    life_test: Optional[float] = None  # life at test conditions (hours)


class HallbergPeckRequest(BaseModel):
    Ea: float = 0.9  # activation energy (eV)
    n: float = 3.0  # humidity exponent (typically ~3 for Hallberg-Peck)
    RH_use: float = 50.0  # use relative humidity (%)
    RH_test: float = 85.0  # test relative humidity (%)
    T_use: float = 30.0  # use temperature (deg C)
    T_test: float = 85.0  # test temperature (deg C)
    life_test: Optional[float] = None  # life at test conditions (hours)


class TDDBRequest(BaseModel):
    model: str = "E"  # "E" (thermochemical) or "1/E" (anode hole injection)
    gamma: float = 4.0  # field acceleration parameter (cm/MV for E; MV/cm for 1/E)
    Ea: float = 0.6  # activation energy (eV)
    E_use: float = 4.0  # use electric field (MV/cm)
    E_test: float = 8.0  # test electric field (MV/cm)
    T_use: float = 55.0  # use temperature (deg C)
    T_test: float = 125.0  # test temperature (deg C)
    life_test: Optional[float] = None  # TTF at test conditions (hours)


class MeanStressRequest(BaseModel):
    """Goodman / Soderberg mean-stress correction inputs."""
    method: str = "goodman"  # "goodman" (modified Goodman) or "soderberg"
    sigma_a: float = 100.0  # alternating stress amplitude (MPa)
    sigma_m: float = 150.0  # mean stress (MPa)
    Se: float = 200.0  # fully-reversed endurance / fatigue limit (MPa)
    Su: float = 500.0  # ultimate tensile strength (MPa, used by Goodman)
    Sy: float = 350.0  # yield strength (MPa, used by Soderberg)


# --- Warranty Data Analysis ---

class WarrantyConvertRequest(BaseModel):
    """Convert a Nevada chart to life data."""
    quantities: list[int]
    returns: list[list[Optional[int]]]


class WarrantyForecastRequest(BaseModel):
    """Forecast future warranty returns."""
    quantities: list[int]
    returns: list[list[Optional[int]]]
    n_forecast_periods: int = 3
    distribution: str = "Weibull_2P"
    fit_method: str = "MLE"


# --- Markov Chain Analysis ---

class MarkovStateSchema(BaseModel):
    id: str
    name: str
    state_type: str = "operational"  # operational, degraded, failed
    description: str = ""


class MarkovTransitionSchema(BaseModel):
    from_state: str
    to_state: str
    rate: float
    label: str = ""


class MarkovRequest(BaseModel):
    """Markov chain analysis request."""
    states: list[MarkovStateSchema]
    transitions: list[MarkovTransitionSchema]
    times: Optional[list[float]] = None
    initial_state: Optional[str] = None


# --- Mission Profile ---

class MissionPhaseSchema(BaseModel):
    name: str
    duration: float
    environment: str = "GB"
    temperature: float = 40.0
    operating: bool = True
    duty_cycle: float = 1.0
    description: str = ""


class MissionProfilePredictionRequest(BaseModel):
    """Failure rate prediction with a mission profile."""
    profile_name: str = "Custom Mission"
    phases: list[MissionPhaseSchema]
    parts: list[PredictionPart]
    # Standard to use: 'MIL-HDBK-217F', 'Telcordia', '217Plus', 'FIDES'
    standard: str = "MIL-HDBK-217F"


# --- Multi-Standard Prediction ---

class MultiStandardPredictionRequest(BaseModel):
    """Prediction request supporting multiple standards."""
    standard: str = "MIL-HDBK-217F"  # MIL-HDBK-217F, Telcordia, 217Plus, FIDES, NSWC
    environment: str = "GB"
    vita_global: bool = False
    parts: list[PredictionPart]
    # 217Plus-specific
    process_grade: int = 3
    # FIDES-specific
    process_score: float = 50.0
    part_manufacturing: str = "standard"


# --- Derating Analysis ---

class DeratingRequest(BaseModel):
    """Derating analysis for a set of parts."""
    parts: list[PredictionPart]
    derating_level: str = "II"  # I, II, III
    standard: str = "MIL-STD-975"  # MIL-STD-975, NAVSEA, ECSS, Custom
    custom_rules: Optional[dict[str, Any]] = None


# --- Competing Failure Modes ---

class CFMItem(BaseModel):
    time: float
    mode: str
    state: str = "F"  # "F" for failure, "S" for suspension

class CompetingFailureModesRequest(BaseModel):
    """Competing Failure Modes analysis. Each item has a time, mode ID, and state."""
    items: list[CFMItem]
    distribution: str = "Weibull_2P"
    method: str = "MLE"
    CI: float = 0.95
    reliability_time: Optional[float] = None
