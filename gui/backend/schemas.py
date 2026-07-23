"""Pydantic schemas for the Reliability Analysis API."""

import math
from typing import Any, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field, model_validator


# --- Life Data ---

class LifeDataFitRequest(BaseModel):
    failures: list[float] = Field(min_length=1)
    right_censored: Optional[list[float]] = None
    distributions_to_fit: Optional[list[str]] = None
    method: str = "MLE"
    CI: float = Field(0.95, gt=0, lt=1)


class SingleDistPlotRequest(BaseModel):
    """Plot payload for one distribution — fetched lazily when the user
    switches away from the best fit, instead of shipping all ~13
    distributions' curves in the /fit response."""
    failures: list[float] = Field(min_length=1)
    right_censored: Optional[list[float]] = None
    distribution: str
    method: str = "MLE"
    CI: float = Field(0.95, gt=0, lt=1)


class FrequencyLifeObservation(BaseModel):
    id: str = ""
    time: float
    state: Literal["F", "S"]
    count: int = Field(ge=1)


class IntervalLifeObservation(BaseModel):
    id: str = ""
    lower: Optional[float] = None
    upper: Optional[float] = None
    count: int = Field(ge=1)


class GroupedLifeFitRequest(BaseModel):
    """Weighted exact-frequency or interval-censored life observations."""
    observation_model: Literal["frequency_exact", "interval_censored"]
    frequency_observations: list[FrequencyLifeObservation] = Field(default_factory=list)
    interval_observations: list[IntervalLifeObservation] = Field(default_factory=list)
    distributions_to_fit: Optional[list[str]] = None
    CI: float = Field(0.95, gt=0, lt=1)


class GroupedLifePlotRequest(GroupedLifeFitRequest):
    distribution: str


class TurnbullRequest(BaseModel):
    interval_observations: list[IntervalLifeObservation] = Field(min_length=1)


class NonparametricRequest(BaseModel):
    failures: list[float] = Field(min_length=1)
    right_censored: Optional[list[float]] = None
    method: str = "KM"
    CI: float = Field(0.95, gt=0, lt=1)


class GenerateRequest(BaseModel):
    """Monte Carlo sample generation from a specified distribution."""
    distribution: str                      # e.g. 'Weibull_2P'
    params: dict[str, float]               # e.g. {'alpha': 100, 'beta': 2}
    n: int = Field(20, ge=1)
    seed: Optional[int] = None


class MCEquationVariable(BaseModel):
    name: str                              # e.g. 'A', 'B', 'Load1'
    distribution: str                      # e.g. 'Normal_2P'
    params: dict[str, float]               # e.g. {'mu': 2.0146, 'sigma': 0.0181}


class MCEquationRequest(BaseModel):
    """Equation-based Monte Carlo: combine multiple random variables via a formula."""
    variables: list[MCEquationVariable] = Field(min_length=1)  # 1–20 input variables
    equation: str                          # e.g. 'A + B + C'
    n: int = Field(1000, ge=1, le=100_000)  # 1–100,000
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
    """Conditional common-family test across multiple life-data analyses."""
    folios: list[CompareFolio]
    distribution: str = "Weibull_2P"
    CI: float = 0.95


class SpecialModelRequest(BaseModel):
    """Fit a special Weibull model (mixture, competing risks, DSZI)."""
    # 'mixture' | 'competing_risks' | 'dszi' | 'ds' | 'zi'
    model: str
    failures: list[float]
    right_censored: Optional[list[float]] = None
    CI: float = 0.95
    # Mixture model: number of sub-populations (2–4). Ignored for other models.
    n_subpopulations: int = 2


class WeibayesRequest(BaseModel):
    """Weibayes with fixed, sensitivity-range, or Bayesian shape uncertainty."""
    failures: list[float]
    right_censored: Optional[list[float]] = None
    beta: float          # assumed/fixed Weibull shape
    CI: float = 0.95
    uncertainty_method: str = "fixed"
    beta_lower: Optional[float] = None
    beta_upper: Optional[float] = None
    beta_sd: Optional[float] = None
    n_beta_samples: int = 4000
    seed: Optional[int] = None


class CensoringDesignRequest(BaseModel):
    """Experimental censoring mechanism reproduced by a life-data bootstrap."""
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    type: Literal[
        "fixed_administrative", "observed_schedule", "parametric_independent",
    ]
    time: Optional[float] = Field(None, gt=0)
    times: Optional[list[float]] = None
    distribution: Optional[Literal[
        "exponential", "weibull", "lognormal", "uniform",
    ]] = None
    parameters: Optional[dict[str, float]] = None

    @model_validator(mode="after")
    def validate_design_contract(self):
        if self.type == "fixed_administrative":
            if self.time is None:
                raise ValueError("fixed_administrative requires time.")
            if any(value is not None for value in (
                self.times, self.distribution, self.parameters,
            )):
                raise ValueError(
                    "fixed_administrative accepts only the time field."
                )
        elif self.type == "observed_schedule":
            if not self.times:
                raise ValueError("observed_schedule requires non-empty times.")
            if any(not math.isfinite(value) or value <= 0 for value in self.times):
                raise ValueError(
                    "observed_schedule times must be positive and finite."
                )
            if any(value is not None for value in (
                self.time, self.distribution, self.parameters,
            )):
                raise ValueError(
                    "observed_schedule accepts only the times field."
                )
        else:
            if self.distribution is None or self.parameters is None:
                raise ValueError(
                    "parametric_independent requires distribution and parameters."
                )
            if self.time is not None or self.times is not None:
                raise ValueError(
                    "parametric_independent does not accept time or times."
                )
        return self


class UncertaintyRequest(BaseModel):
    """Calibrated scalar interval for a fitted life distribution."""
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    distribution: str
    failures: list[float] = Field(min_length=2)
    right_censored: Optional[list[float]] = None
    target: Literal["reliability", "quantile", "median", "mean"] = "reliability"
    target_value: Optional[float] = None
    method: Literal["profile_likelihood", "parametric_bootstrap"] = "profile_likelihood"
    CI: float = Field(0.95, gt=0, lt=1)
    n_bootstrap: int = Field(200, ge=20, le=2000)
    seed: Optional[int] = None
    censoring_design: Optional[CensoringDesignRequest] = None

    @model_validator(mode="after")
    def validate_uncertainty_target(self):
        if self.target == "reliability":
            if self.target_value is None or self.target_value < 0:
                raise ValueError(
                    "reliability requires a non-negative mission time."
                )
        elif self.target == "quantile":
            if (self.target_value is None
                    or not 0 < self.target_value < 1):
                raise ValueError(
                    "quantile requires a probability strictly between 0 and 1."
                )
        elif self.target_value is not None:
            raise ValueError(
                "median and mean targets do not accept target_value."
            )
        if (self.method != "parametric_bootstrap"
                and self.censoring_design is not None):
            raise ValueError(
                "censoring_design applies only to parametric_bootstrap."
            )
        return self


# --- ALT ---

class ALTFitRequest(BaseModel):
    failures: list[float]
    failure_stress: list[float]
    right_censored: Optional[list[float]] = None
    right_censored_stress: Optional[list[float]] = None
    use_level_stress: Optional[float] = None
    models_to_fit: Optional[list[str]] = None
    sort_by: str = "AICc"
    uncertainty_method: Literal['delta', 'parametric_bootstrap'] = 'delta'
    uncertainty_CI: float = Field(0.95, gt=0, lt=1)
    n_bootstrap: int = Field(200, ge=20, le=2000)
    seed: Optional[int] = None


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
    stress1_direction: Literal['increasing_damage', 'decreasing_damage'] = 'increasing_damage'
    stress2_direction: Literal['increasing_damage', 'decreasing_damage'] = 'increasing_damage'
    CI: float = Field(0.95, gt=0, lt=1)
    n_bootstrap: int = Field(500, ge=50, le=10_000)
    seed: Optional[int] = None


class DegradationRequest(BaseModel):
    """Non-destructive degradation (wear-to-failure) analysis."""
    unit_ids: list[str]
    times: list[float]
    measurements: list[float]
    threshold: float
    threshold_direction: str = "above"   # "above" or "below"
    # linear, exponential, power, logarithmic, gompertz, lloyd_lipow
    degradation_model: str = "linear"
    analysis_method: Literal["per_unit_delta", "hierarchical_nlme"] = "per_unit_delta"
    # Weibull_2P, Normal_2P, Lognormal_2P, Exponential_1P, Gumbel_2P
    life_distribution: str = "Weibull_2P"
    reliability_time: Optional[float] = None      # compute R(t)/F(t) at this time
    # Confidence level for delta projections or hierarchical bootstrap
    # intervals. Per-unit delta intervals are descriptive diagnostics only;
    # they are never censoring observations in a life likelihood.
    ci: float = Field(0.95, gt=0, lt=1)
    # Hierarchical-model controls.  A value of zero disables the parametric
    # bootstrap while retaining Monte Carlo evaluation of the induced life
    # distribution.
    n_monte_carlo: int = Field(10_000, ge=1_000, le=1_000_000)
    n_bootstrap: int = Field(200, ge=0, le=2_000)
    seed: Optional[int] = None

    @model_validator(mode="after")
    def validate_hierarchical_bootstrap_size(self):
        if self.analysis_method == "hierarchical_nlme" and 0 < self.n_bootstrap < 20:
            raise ValueError(
                "n_bootstrap must be 0 (disabled) or at least 20; "
                "smaller samples cannot support user-facing percentile intervals"
            )
        return self


class DestructiveDegradationRequest(BaseModel):
    """Destructive degradation analysis (one measurement per sample per time)."""
    times: list[float]
    measurements: list[float]
    threshold: float
    threshold_direction: str = "above"   # "above" or "below"
    # linear, exponential, power, logarithm, lloyd_lipow
    degradation_model: str = "linear"
    # Best_Fit, Weibull, Exponential, Normal, Lognormal, Gumbel
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
    bins: Optional[int] = None
    min_expected: float = 5.0
    n_bootstrap: int = 200
    seed: Optional[int] = 1729


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
    # Requirement-vs-reliability and sample-size/test-time tradeoff curves
    # (parametric methods only). One curve per allowable-failure count when
    # options_table is also set.
    curves: bool = False


# --- Reliability Growth (Crow-AMSAA / Duane) ---

class GrowthRequest(BaseModel):
    """Reliability-growth fit using exact events or grouped interval counts.

    Crow-AMSAA termination is a design property, not something that can be
    recovered from ``T == times[-1]``. Exact-event Crow-AMSAA requests must
    state it explicitly. Grouped counts describe the intervals ``(0, e_1]``,
    ``(e_1, e_2]``, ... and are necessarily time terminated at the last end.
    """
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    times: list[float] = Field(default_factory=list)
    T: Optional[float] = Field(None, gt=0)
    model: Literal["crow_amsaa", "crow-amsaa", "duane"] = "crow_amsaa"
    data_mode: Literal["exact", "grouped"] = "exact"
    estimator: Literal["mle", "modified_mle"] = "mle"
    termination: Optional[Literal["time", "failure"]] = None
    CI: float = Field(0.95, gt=0, lt=1)
    # Published Crow-AMSAA CvM critical-value columns.  Restricting the exact
    # event test to these levels avoids presenting an interpolated table value
    # as an exact decision.  The grouped Pearson test uses the same field.
    gof_significance: Literal[0.01, 0.05, 0.10, 0.15, 0.20] = 0.10
    grouped_endpoints: list[float] = Field(default_factory=list)
    grouped_counts: list[int] = Field(default_factory=list)
    # Continuation forecast: horizon is elapsed time after T; the order and
    # probability define the requested future-event time quantile.
    prediction_horizon: Optional[float] = Field(None, gt=0)
    prediction_failure_count: int = Field(1, ge=1, le=10_000)
    prediction_probability: float = Field(0.50, gt=0, lt=1)

    @model_validator(mode="after")
    def validate_growth_data_contract(self):
        model_name = self.model.replace("-", "_")

        if model_name == "duane" and self.estimator != "mle":
            raise ValueError("estimator applies only to Crow-AMSAA.")

        if self.data_mode == "exact":
            if len(self.times) < 2:
                raise ValueError("Exact-event analysis requires at least 2 failure times.")
            if self.grouped_endpoints or self.grouped_counts:
                raise ValueError(
                    "grouped_endpoints/grouped_counts are accepted only when "
                    "data_mode='grouped'."
                )
            if any(value <= 0 for value in self.times):
                raise ValueError("Failure times must be positive and finite.")
            if any(right < left for left, right in zip(self.times, self.times[1:])):
                raise ValueError("Failure times must be non-decreasing.")
            if self.T is not None and self.T < self.times[-1]:
                raise ValueError("T must be at least the final failure time.")
            if model_name == "crow_amsaa" and self.termination is None:
                raise ValueError(
                    "Exact-event Crow-AMSAA requires an explicit termination "
                    "design ('time' or 'failure')."
                )
            if self.termination == "time" and self.T is None:
                raise ValueError("A time-terminated analysis requires T.")
            if (self.termination == "failure" and self.T is not None
                    and not math.isclose(self.T, self.times[-1], rel_tol=1e-12,
                                         abs_tol=0.0)):
                raise ValueError(
                    "A failure-terminated analysis requires T to be blank or "
                    "equal to the final failure time."
                )
            return self

        if model_name != "crow_amsaa":
            raise ValueError("Grouped interval counts are supported only by Crow-AMSAA.")
        if self.estimator != "mle":
            raise ValueError(
                "Grouped Crow-AMSAA currently supports the likelihood estimator only."
            )
        if self.times:
            raise ValueError("times must be empty when data_mode='grouped'.")
        if len(self.grouped_endpoints) < 3:
            raise ValueError("Grouped analysis requires at least 3 interval endpoints.")
        if len(self.grouped_counts) != len(self.grouped_endpoints):
            raise ValueError(
                "grouped_counts must contain one count for every grouped endpoint."
            )
        if any(count < 0 for count in self.grouped_counts):
            raise ValueError("Grouped failure counts cannot be negative.")
        if any(value <= 0 for value in self.grouped_endpoints):
            raise ValueError("Grouped endpoints must be positive and finite.")
        if any(right <= left for left, right in zip(
                self.grouped_endpoints, self.grouped_endpoints[1:])):
            raise ValueError("Grouped endpoints must be strictly increasing.")
        if sum(self.grouped_counts) < 2:
            raise ValueError("Grouped analysis requires at least 2 observed failures.")
        if sum(count > 0 for count in self.grouped_counts) < 2:
            raise ValueError(
                "Grouped analysis requires failures in at least 2 intervals "
                "to identify a time trend."
            )
        if self.termination == "failure":
            raise ValueError("Grouped interval counts require time termination.")
        if (self.T is not None
                and not math.isclose(self.T, self.grouped_endpoints[-1],
                                     rel_tol=1e-12, abs_tol=0.0)):
            raise ValueError(
                "For grouped analysis, T must be blank or equal to the final endpoint."
            )
        return self


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


class MCFRecord(BaseModel):
    """Long-form recurrent-event record with explicit event/censor status."""
    system_id: str
    time: float = Field(ge=0)
    status: str                  # event | censor
    count: int = Field(1, ge=1)


class MCFRequest(BaseModel):
    """Mean Cumulative Function for recurrent events across systems."""
    # Wide form: event times only plus one explicit observation end per system.
    data: Optional[list[list[float]]] = None
    observation_ends: Optional[list[float]] = None
    # Long-form alternative with explicit event/censor records.
    records: Optional[list[MCFRecord]] = None
    CI: float = Field(0.95, gt=0, lt=1)
    parametric: bool = False     # also fit the power-law parametric MCF
    interval_method: Literal[
        "log_transformed", "cluster_bootstrap"] = "log_transformed"
    bootstrap_samples: int = Field(0, ge=0, le=10000)
    seed: Optional[int] = None

    @model_validator(mode="after")
    def validate_bootstrap_contract(self):
        if (self.interval_method == "cluster_bootstrap"
                and self.bootstrap_samples < 50):
            raise ValueError(
                "cluster_bootstrap intervals require at least 50 samples")
        if 0 < self.bootstrap_samples < 50:
            raise ValueError(
                "at least 50 samples are required when bootstrap is enabled")
        return self


# --- Failure Rate Prediction (MIL-HDBK-217F / VITA 51.1) ---

class BOMSource(BaseModel):
    """Traceable source location for an imported electronic BOM row."""
    model_config = ConfigDict(extra="forbid")

    file_name: str = Field(min_length=1, max_length=512)
    sheet: Optional[str] = Field(None, max_length=256)
    source_row: int = Field(ge=1)
    imported_at: str = Field(min_length=1, max_length=64)


class BOMMappingAssessment(BaseModel):
    """Audit record for a manual or Perdura-proposed component mapping."""
    model_config = ConfigDict(extra="forbid")

    status: Literal["confirmed", "provisional", "unmapped"] = "confirmed"
    source: Literal["manual", "perdura"] = "manual"
    target_standard: Optional[str] = Field(None, max_length=64)
    confidence: Optional[Literal["high", "medium", "low"]] = None
    score: Optional[float] = Field(None, ge=0)
    evidence: list[str] = Field(default_factory=list, max_length=100)
    matched_rule_ids: list[str] = Field(default_factory=list, max_length=100)
    missing_parameters: list[str] = Field(default_factory=list, max_length=100)
    rule_profile_id: Optional[str] = Field(None, max_length=128)
    rule_profile_revision: Optional[int] = Field(None, ge=1)
    rule_profile_sha256: Optional[str] = Field(
        None, pattern=r"^[a-f0-9]{64}$")

class PredictionPart(BaseModel):
    # 'microcircuit' | 'diode' | 'bjt' | 'fet' | 'resistor' | 'capacitor' | 'generic'
    category: str
    name: Optional[str] = None
    # Manufacturer/supplier identifier. Components with the same normalized
    # part number may share source-specific derating inputs in the client.
    part_number: Optional[str] = None
    reference_designators: list[str] = Field(default_factory=list, max_length=10000)
    manufacturer: Optional[str] = Field(None, max_length=512)
    supplier: Optional[str] = Field(None, max_length=512)
    supplier_part_number: Optional[str] = Field(None, max_length=512)
    description: Optional[str] = Field(None, max_length=4096)
    value: Optional[str] = Field(None, max_length=512)
    package_or_footprint: Optional[str] = Field(None, max_length=512)
    population_status: Optional[Literal["populate", "dnp", "unknown"]] = None
    bom_attributes: dict[str, str] = Field(default_factory=dict, max_length=100)
    bom_source: Optional[BOMSource] = None
    bom_mapping: Optional[BOMMappingAssessment] = None
    # False means the line remains visible and traceable but must not affect
    # any prediction total (for example an unconfirmed automatic BOM mapping).
    calculation_enabled: bool = True
    calculation_exclusion_reason: Optional[str] = Field(None, max_length=1024)
    # Free-text user notes about this part (not used in the calculation).
    notes: Optional[str] = None
    quantity: int = Field(1, ge=1)
    params: dict[str, Any] = {}
    # ANSI/VITA 51.1 supplement: None = inherit global setting,
    # True/False = per-part override
    apply_vita: Optional[bool] = None
    # Per-part environment override: None = inherit from global
    environment: Optional[str] = None
    # Logical grouping label (presentation/library aggregation only)
    group: Optional[str] = None
    # Containing System Block. None means a root-level part.
    parent_id: Optional[str] = None
    # A user override replaces only the effective output; the standards-based
    # calculation remains in the result for traceability.
    failure_rate_override_enabled: bool = False
    failure_rate_override_fpmh: Optional[float] = Field(None, ge=0)
    # RADC-TR-85-91 nonoperating-rate escape hatch.  This is intentionally
    # separate from the final output override above: the operating handbook
    # result remains intact and the supplied value participates only in the
    # service-life exposure blend.
    nonoperating_rate_override_enabled: bool = False
    nonoperating_rate_override_fpmh: Optional[float] = Field(None, ge=0)
    nonoperating_rate_source_type: Optional[Literal[
        "measured", "manufacturer", "qualification_test",
        "engineering_estimate", "other",
    ]] = None
    nonoperating_rate_source: Optional[str] = None
    # Source-specific inputs which do not belong to the operating handbook
    # model (for example relay contact voltage or a RADC transistor group).
    nonoperating_params: dict[str, Any] = Field(default_factory=dict)
    # Operational derating inputs belong to their selected source profile,
    # identified by the required ``profile`` member, not to the failure-rate
    # constructor. Keeping this separate prevents cross-profile/default reuse.
    derating_params: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def require_enabled_failure_rate_override(self):
        if (self.failure_rate_override_enabled
                and self.failure_rate_override_fpmh is None):
            raise ValueError(
                "failure_rate_override_fpmh is required when the part override is enabled"
            )
        if self.nonoperating_rate_override_enabled:
            if self.nonoperating_rate_override_fpmh is None:
                raise ValueError(
                    "nonoperating_rate_override_fpmh is required when the "
                    "nonoperating override is enabled"
                )
            if self.nonoperating_rate_source_type is None:
                raise ValueError(
                    "nonoperating_rate_source_type is required when the "
                    "nonoperating override is enabled"
                )
            if not (self.nonoperating_rate_source or "").strip():
                raise ValueError(
                    "nonoperating_rate_source is required when the "
                    "nonoperating override is enabled"
                )
        return self


class PredictionBlock(BaseModel):
    """A repeatable System Block in the steady-state prediction hierarchy."""
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    parent_id: Optional[str] = None
    quantity: int = Field(1, ge=1)
    operating_fraction: float = Field(1.0, ge=0, le=1)
    environment: Optional[str] = None
    nonoperating_environment: Optional[str] = None
    nonoperating_temperature_c: Optional[float] = None
    power_cycles_per_1000_nonoperating_hours: Optional[float] = Field(
        None, ge=0)
    notes: Optional[str] = None
    failure_rate_override_enabled: bool = False
    failure_rate_override_fpmh: Optional[float] = Field(None, ge=0)

    @model_validator(mode="after")
    def require_enabled_failure_rate_override(self):
        if (self.failure_rate_override_enabled
                and self.failure_rate_override_fpmh is None):
            raise ValueError(
                "failure_rate_override_fpmh is required when the block override is enabled"
            )
        return self


class PredictionRequest(BaseModel):
    environment: str = "GB"
    # Base prediction is always MIL-HDBK-217F; VITA 51.1 is applied as a
    # supplement either globally or per part.
    vita_global: bool = False
    parts: list[PredictionPart]
    blocks: list[PredictionBlock] = Field(default_factory=list)


# --- System Reliability (RBD) ---

DistributionName = Literal[
    "exponential", "weibull", "normal", "lognormal",
    "gamma", "loglogistic", "gumbel", "beta",
]


class _DistributionParameters(BaseModel):
    """Base contract shared by FTA/RBD parametric probability models."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class ExponentialParameters(_DistributionParameters):
    rate: float = Field(alias="lambda", gt=0)
    gamma: float = 0.0


class WeibullParameters(_DistributionParameters):
    alpha: float = Field(gt=0)
    beta: float = Field(gt=0)
    gamma: float = 0.0


class NormalParameters(_DistributionParameters):
    mu: float
    sigma: float = Field(gt=0)


class LognormalParameters(_DistributionParameters):
    mu: float
    sigma: float = Field(gt=0)
    gamma: float = 0.0


class GammaParameters(_DistributionParameters):
    alpha: float = Field(gt=0)
    beta: float = Field(gt=0)
    gamma: float = 0.0


class LoglogisticParameters(_DistributionParameters):
    alpha: float = Field(gt=0)
    beta: float = Field(gt=0)
    gamma: float = 0.0


class GumbelParameters(_DistributionParameters):
    mu: float
    sigma: float = Field(gt=0)


class BetaParameters(_DistributionParameters):
    alpha: float = Field(gt=0)
    beta: float = Field(gt=0)


DISTRIBUTION_PARAMETER_MODELS = {
    "exponential": ExponentialParameters,
    "weibull": WeibullParameters,
    "normal": NormalParameters,
    "lognormal": LognormalParameters,
    "gamma": GammaParameters,
    "loglogistic": LoglogisticParameters,
    "gumbel": GumbelParameters,
    "beta": BetaParameters,
}


def validate_distribution_params(
    distribution: DistributionName,
    params: dict[str, Any],
) -> dict[str, float]:
    """Validate and normalize one supported distribution's parameters."""
    model = DISTRIBUTION_PARAMETER_MODELS[distribution].model_validate(params)
    return model.model_dump(by_alias=True)


class RBDComponentData(BaseModel):
    """A component has either a direct reliability or a life model.

    A life model may omit ``mission_time`` when the enclosing RBD request
    supplies the system mission time.  A component value is an explicit
    exposure-time override.
    """

    model_config = ConfigDict(extra="allow", allow_inf_nan=False)

    reliability: Optional[float] = Field(None, ge=0, le=1)
    distribution: Optional[DistributionName] = None
    dist_params: Optional[dict[str, Any]] = None
    mission_time: Optional[float] = Field(None, ge=0)

    @model_validator(mode="after")
    def validate_probability_source(self):
        if self.distribution is None:
            if self.dist_params is not None:
                raise ValueError("dist_params requires a distribution")
            if self.reliability is None:
                raise ValueError(
                    "component data requires reliability or a distribution model"
                )
            return self
        if self.dist_params is None:
            raise ValueError("distribution requires dist_params")
        self.dist_params = validate_distribution_params(
            self.distribution, self.dist_params)
        return self


class RBDVotingData(BaseModel):
    """A perfect voting junction over incoming block or subsystem branches."""

    model_config = ConfigDict(extra="allow", allow_inf_nan=False)

    k: int = Field(ge=1)
    label: Optional[str] = None


class RBDNode(BaseModel):
    id: str
    type: Literal['source', 'sink', 'component', 'kofn']
    data: Optional[dict[str, Any]] = None

    @model_validator(mode="after")
    def validate_component_data(self):
        if self.type == "component":
            if self.data is None:
                raise ValueError("component node requires data")
            self.data = RBDComponentData.model_validate(self.data).model_dump(
                by_alias=True, exclude_none=True)
        elif self.type == "kofn":
            if self.data is None:
                raise ValueError("k-out-of-n voting node requires data")
            self.data = RBDVotingData.model_validate(self.data).model_dump(
                by_alias=True, exclude_none=True)
        return self


class RBDEdge(BaseModel):
    id: Optional[str] = None
    source: str
    target: str


class RBDRequest(BaseModel):
    nodes: list[RBDNode]
    edges: list[RBDEdge]
    mission_time: Optional[float] = Field(None, gt=0)
    time_points: int = Field(81, ge=2, le=401)

    @model_validator(mode="after")
    def validate_life_model_exposure_times(self):
        missing = [
            node.id for node in self.nodes
            if node.type == "component"
            and (node.data or {}).get("distribution") is not None
            and (node.data or {}).get("mission_time") is None
        ]
        if missing and self.mission_time is None:
            raise ValueError(
                "distribution life models require a positive system mission_time "
                "or an explicit component mission_time override; missing for "
                + ", ".join(missing)
            )
        return self


class RBDConversionGraph(BaseModel):
    nodes: list[RBDNode]
    edges: list[RBDEdge]
    mission_time: Optional[float] = Field(None, gt=0)


class RBDToFTAConversionRequest(RBDConversionGraph):
    source_analysis_id: Optional[str] = None
    analyses: dict[str, RBDConversionGraph] = Field(default_factory=dict)
    max_generated_nodes: int = Field(5_000, ge=100, le=20_000)
    max_bdd_nodes: int = Field(250_000, ge=100, le=5_000_000)


# --- Fault Tree ---


class FTExponentialConversionRequest(BaseModel):
    probability: float = Field(gt=0, lt=1)
    mission_time: float = Field(gt=0)


class FTBasicEventData(BaseModel):
    """A basic event has either a direct probability or a complete life model."""

    model_config = ConfigDict(extra="allow", allow_inf_nan=False)

    probability: Optional[float] = Field(None, ge=0, le=1)
    distribution: Optional[DistributionName] = None
    dist_params: Optional[dict[str, Any]] = None
    exposure_time: Optional[float] = Field(None, ge=0)

    @model_validator(mode="after")
    def validate_probability_source(self):
        if self.distribution is None:
            if self.dist_params is not None:
                raise ValueError("dist_params requires a distribution")
            if self.probability is None:
                raise ValueError(
                    "basic-event data requires probability or a distribution model"
                )
            return self
        if self.dist_params is None:
            raise ValueError("distribution requires dist_params")
        self.dist_params = validate_distribution_params(
            self.distribution, self.dist_params)
        return self

FTNodeType = Literal[
    'basic', 'undeveloped', 'house', 'conditioning', 'external',
    'and', 'or', 'vote', 'cardinality', 'xor', 'not', 'nand', 'nor',
    'iff', 'imply', 'inhibit',
    'pand', 'por', 'spare', 'fdep', 'seq', 'transfer',
]


class FTNode(BaseModel):
    id: str
    type: FTNodeType
    data: dict[str, Any]

    @model_validator(mode="after")
    def validate_basic_event_data(self):
        if self.type in {"basic", "undeveloped", "conditioning", "external"}:
            self.data = FTBasicEventData.model_validate(self.data).model_dump(
                by_alias=True, exclude_none=True)
        elif self.type == "house":
            state = self.data.get("state", self.data.get("value", False))
            if not isinstance(state, bool):
                raise ValueError("house event state must be true or false")
            self.data = {**self.data, "state": state}
        return self


class FTEdge(BaseModel):
    id: Optional[str] = None
    source: str  # parent gate
    target: str  # child event/gate
    # Input role and semantic order are persisted explicitly. They are required
    # for ordered/dynamic gates and never inferred from canvas coordinates.
    role: Optional[str] = None
    order: Optional[int] = Field(None, ge=0)


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
    exposure_time: Optional[float] = Field(None, ge=0)
    # Calculation methods to report top-event probability for (#7).
    # Subset of {'exact', 'rare_event', 'min_cut_upper_bound', 'simulation'}.
    methods: Optional[list[str]] = None
    # Number of Monte Carlo samples for the 'simulation' method.
    n_simulations: Optional[int] = Field(None, ge=1_000, le=10_000_000)
    # Random seed for reproducible Monte Carlo simulations.
    seed: Optional[int] = None
    # Solver contract. Auto selects exact ROBDD for static trees and
    # chronological simulation for dynamic/non-exponential semantics.
    engine: Literal['auto', 'exact', 'simulation'] = 'auto'
    confidence_level: float = Field(0.95, gt=0, lt=1)
    # Optional explicit grid for probability-versus-time results.
    time_grid: Optional[list[float]] = Field(None, max_length=501)
    max_bdd_nodes: int = Field(250_000, ge=100, le=5_000_000)
    max_dynamic_states: int = Field(100_000, ge=100, le=250_000)
    # Other trees referenced by Transfer gates, keyed by tree id (#9).
    trees: Optional[dict[str, FaultTreeGraph]] = None
    # Id of the tree being analyzed (for transfer-gate cycle detection).
    tree_id: Optional[str] = None

    @model_validator(mode="after")
    def validate_time_grid(self):
        if self.time_grid is not None:
            if len(self.time_grid) < 2:
                raise ValueError("time_grid requires at least two values")
            if any(not math.isfinite(value) or value < 0
                   for value in self.time_grid):
                raise ValueError("time_grid values must be finite and non-negative")
            if any(right < left for left, right in zip(
                    self.time_grid, self.time_grid[1:])):
                raise ValueError("time_grid must be sorted in ascending order")
        return self

    @model_validator(mode="after")
    def require_distribution_exposure_time(self):
        graphs = [self.nodes]
        graphs.extend(tree.nodes for tree in (self.trees or {}).values())
        missing = [
            node.id
            for nodes in graphs
            for node in nodes
            if (node.type in {"basic", "undeveloped", "conditioning", "external"}
                and node.data.get("distribution") is not None
                and node.data.get("exposure_time") is None
                and self.exposure_time is None)
        ]
        if missing:
            joined = ", ".join(missing)
            raise ValueError(
                "distribution-based events require exposure_time on the "
                f"event or request; missing for: {joined}"
            )
        return self


class FTAToRBDConversionRequest(BaseModel):
    nodes: list[FTNode]
    edges: list[FTEdge]
    exposure_time: Optional[float] = Field(None, ge=0)
    trees: dict[str, FaultTreeGraph] = Field(default_factory=dict)
    tree_id: Optional[str] = None
    max_generated_nodes: int = Field(5_000, ge=100, le=20_000)
    max_bdd_nodes: int = Field(250_000, ge=100, le=5_000_000)

    @model_validator(mode="after")
    def require_distribution_exposure_time(self):
        graphs = [self.nodes]
        graphs.extend(tree.nodes for tree in self.trees.values())
        missing = [
            node.id
            for nodes in graphs
            for node in nodes
            if (node.type in {"basic", "undeveloped", "conditioning", "external"}
                and node.data.get("distribution") is not None
                and node.data.get("exposure_time") is None
                and self.exposure_time is None)
        ]
        if missing:
            raise ValueError(
                "distribution-based events require exposure_time on the "
                f"event or request; missing for: {', '.join(missing)}"
            )
        return self


class FTOpenPSAImportRequest(BaseModel):
    xml: str = Field(min_length=1, max_length=5_000_000)
    tree_name: Optional[str] = None
    top_event: Optional[str] = None


class FTOpenPSAExportRequest(BaseModel):
    nodes: list[FTNode]
    edges: list[FTEdge]
    tree_name: str = Field("Perdura_Fault_Tree", min_length=1, max_length=200)


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

class PoFUncertaintySpec(BaseModel):
    """Independent input-uncertainty model for PoF Monte Carlo propagation.

    Keys name scalar request fields (or list elements such as
    ``cycles_applied[0]``) and values are coefficients of variation. Positive
    inputs are sampled lognormally; signed inputs are sampled normally.
    """
    relative_sd: dict[str, float] = Field(default_factory=dict)
    samples: int = Field(2000, ge=200, le=20_000)
    confidence: float = Field(0.95, gt=0, lt=1)
    seed: Optional[int] = None


class PoFRequestBase(BaseModel):
    uncertainty: Optional[PoFUncertaintySpec] = None


class SNCurveRequest(PoFRequestBase):
    stress_amplitude: list[float]  # stress values
    cycles_to_failure: list[float]  # corresponding cycle counts
    stress_query: Optional[float] = None  # optional: predict life at this stress
    life_query: Optional[float] = None  # optional: predict stress at this life


class StressStrainRequest(PoFRequestBase):
    E: float  # Young's modulus (MPa)
    K: float = 1000.0  # strength coefficient
    n: float = 0.15  # strain hardening exponent
    sigma_y: Optional[float] = None  # yield stress (for display only)
    max_stress: Optional[float] = None  # max stress to plot (defaults to 1.5 * K)


class CreepRequest(PoFRequestBase):
    temperature_C: float = 500.0
    stress_MPa: float = 100.0
    C: float = 20.0  # Larson-Miller constant (typically 20 for metals)
    lmp_coeffs: list[float] = [25000.0, -5.0]  # LMP = a + b*log10(stress)
    time_unit: Literal['seconds', 'minutes', 'hours', 'days'] = 'hours'


class DamageRequest(PoFRequestBase):
    stress_levels: list[float]
    cycles_applied: list[float]
    cycles_to_failure: list[float]  # Nf at each stress level
    damage_exponents: Optional[list[float]] = None  # optional nonlinear DCA exponents, in load order


class FractureRequest(PoFRequestBase):
    sigma: float = 100.0  # applied stress (MPa)
    a: float = 0.001  # crack length (m)
    Y: float = 1.12  # geometry factor
    K_Ic: float = 50.0  # fracture toughness (MPa*sqrt(m))
    C: float = 1e-11  # Paris law coefficient
    m: float = 3.0  # Paris law exponent
    a_initial: Optional[float] = None  # for crack growth (defaults to a)
    delta_sigma: Optional[float] = None  # stress range for fatigue crack growth
    stress_ratio: Optional[float] = None  # R=sigma_min/sigma_max; required by Walker/Forman
    walker_C: Optional[float] = None
    walker_m: Optional[float] = None
    walker_gamma: float = 0.5
    forman_C: Optional[float] = None
    forman_m: Optional[float] = None
    yield_strength: Optional[float] = None  # MPa, enables a plastic-zone LEFM screen
    remaining_ligament: Optional[float] = None  # m, enables geometry validity screen


class CoffinMansonRequest(PoFRequestBase):
    E: float  # Young's modulus (MPa)
    sigma_f: float  # fatigue strength coefficient (MPa)
    b: float = -0.09  # fatigue strength exponent
    epsilon_f: float = 0.5  # fatigue ductility coefficient
    c: float = -0.6  # fatigue ductility exponent
    strain_query: Optional[float] = None  # total strain amplitude to solve for life


class NorrisLandzbergRequest(PoFRequestBase):
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


class BlackRequest(PoFRequestBase):
    A: float = 1e5  # material/process constant
    J: float = 1e6  # current density (A/cm^2)
    n: float = 2.0  # current density exponent
    Ea: float = 0.7  # activation energy (eV)
    T: float = 100.0  # temperature (deg C)
    time_unit: Literal['seconds', 'minutes', 'hours', 'days'] = 'hours'


class PeckRequest(PoFRequestBase):
    A: float = 1e5  # material/process constant
    RH: float = 85.0  # test relative humidity (%)
    n: float = 2.7  # humidity exponent
    Ea: float = 0.79  # activation energy (eV)
    T: float = 85.0  # test temperature (deg C)
    RH_use: Optional[float] = None  # use relative humidity (%)
    T_use: Optional[float] = None  # use temperature (deg C)
    time_unit: Literal['seconds', 'minutes', 'hours', 'days'] = 'hours'


class ArrheniusRequest(PoFRequestBase):
    Ea: float = 0.7  # signed apparent activation energy (eV)
    T_use: float = 55.0  # use temperature (deg C)
    T_test: float = 125.0  # test temperature (deg C)
    life_test: Optional[float] = None  # life at test conditions (hours)
    life_unit: Literal['seconds', 'minutes', 'hours', 'days', 'cycles'] = 'hours'


class EyringRequest(PoFRequestBase):
    Ea: float = 0.7  # activation energy (eV)
    T_use: float = 55.0  # use temperature (deg C)
    T_test: float = 125.0  # test temperature (deg C)
    n: float = 0.0  # temperature pre-exponent (T^n term)
    life_test: Optional[float] = None  # life at test conditions (hours)
    life_unit: Literal['seconds', 'minutes', 'hours', 'days', 'cycles'] = 'hours'


class HallbergPeckRequest(PoFRequestBase):
    Ea: float = 0.9  # activation energy (eV)
    n: float = 3.0  # humidity exponent (typically ~3 for Hallberg-Peck)
    RH_use: float = 50.0  # use relative humidity (%)
    RH_test: float = 85.0  # test relative humidity (%)
    T_use: float = 30.0  # use temperature (deg C)
    T_test: float = 85.0  # test temperature (deg C)
    life_test: Optional[float] = None  # life at test conditions (hours)
    life_unit: Literal['seconds', 'minutes', 'hours', 'days', 'cycles'] = 'hours'


class TDDBRequest(PoFRequestBase):
    model: str = "E"  # "E" (thermochemical) or "1/E" (anode hole injection)
    gamma: float = 4.0  # field acceleration parameter (cm/MV for E; MV/cm for 1/E)
    Ea: float = 0.6  # activation energy (eV)
    E_use: float = 4.0  # use electric field (MV/cm)
    E_test: float = 8.0  # test electric field (MV/cm)
    T_use: float = 55.0  # use temperature (deg C)
    T_test: float = 125.0  # test temperature (deg C)
    life_test: Optional[float] = None  # TTF at test conditions (hours)
    life_unit: Literal['seconds', 'minutes', 'hours', 'days', 'cycles'] = 'hours'


class MeanStressRequest(PoFRequestBase):
    """Goodman / Soderberg / Gerber mean-stress correction inputs."""
    method: str = "goodman"
    sigma_a: float = 100.0  # alternating stress amplitude (MPa)
    sigma_m: float = 150.0  # mean stress (MPa)
    Se: float = 200.0  # fully-reversed endurance / fatigue limit (MPa)
    Su: float = 500.0  # ultimate tensile strength (MPa, used by Goodman)
    Sy: float = 350.0  # yield strength (MPa, used by Soderberg)


# --- Warranty Data Analysis ---

class WarrantyConvertRequest(BaseModel):
    """Preserve a Nevada chart as weighted grouped life observations."""
    quantities: list[float]
    returns: list[list[Optional[float]]]


class WarrantyForecastRequest(BaseModel):
    """Forecast future warranty returns."""
    quantities: list[float]
    returns: list[list[Optional[float]]]
    n_forecast_periods: int = Field(3, ge=1, le=120)
    distribution: str = "Weibull_2P"
    fit_method: str = "MLE"
    CI: float = Field(0.95, gt=0, lt=1)
    n_parameter_draws: int = Field(500, ge=100, le=10000)
    seed: Optional[int] = None


# --- Markov Chain Analysis ---

class MarkovStateSchema(BaseModel):
    id: str
    name: str
    state_type: Literal["operational", "degraded", "failed"] = "operational"
    description: str = ""
    dwell_model: Literal["exponential", "erlang"] = "exponential"
    dwell_shape: int = Field(1, ge=1, le=20)


class MarkovTransitionSchema(BaseModel):
    id: Optional[str] = None
    from_state: str
    to_state: str
    rate: float = Field(ge=0)
    label: str = ""
    rate_cv: float = Field(0.0, ge=0, le=10)


class MarkovRequest(BaseModel):
    """Markov chain analysis request."""
    states: list[MarkovStateSchema]
    transitions: list[MarkovTransitionSchema]
    times: Optional[list[float]] = None
    initial_state: Optional[str] = None
    uncertainty_samples: int = Field(500, ge=0, le=5000)
    uncertainty_ci: float = Field(0.90, gt=0, lt=1)
    uncertainty_seed: Optional[int] = None


# --- Mission Profile ---

class MissionPhaseSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    duration: float = Field(gt=0)
    environment: str = "GB"
    temperature: float = 40.0
    operating_fraction: float = Field(1.0, ge=0, le=1)
    nonoperating_environment: Optional[str] = None
    nonoperating_temperature_c: Optional[float] = None
    power_cycles_per_1000_nonoperating_hours: Optional[float] = Field(
        None, ge=0)
    description: str = ""


class MissionProfilePredictionRequest(BaseModel):
    """Failure rate prediction with a mission profile."""
    profile_name: str = "Custom Mission"
    phases: list[MissionPhaseSchema]
    parts: list[PredictionPart]
    # Standard to use: 'MIL-HDBK-217F', 'Telcordia', '217Plus', 'FIDES'
    standard: str = "MIL-HDBK-217F"
    vita_global: bool = False

    @model_validator(mode="after")
    def validate_nonoperating_context(self):
        mixed = [phase for phase in self.phases
                 if phase.operating_fraction < 1]
        if not mixed:
            return self
        if self.standard != "MIL-HDBK-217F":
            raise ValueError(
                "Nonoperating mission exposure is available only through the "
                "RADC-TR-85-91 extension to MIL-HDBK-217F."
            )
        for phase in mixed:
            if phase.nonoperating_environment is None:
                raise ValueError(
                    f"Phase '{phase.name}' requires a nonoperating_environment "
                    "when operating_fraction is below 1."
                )
            if phase.nonoperating_temperature_c is None:
                raise ValueError(
                    f"Phase '{phase.name}' requires a nonoperating_temperature_c "
                    "when operating_fraction is below 1."
                )
            if phase.power_cycles_per_1000_nonoperating_hours is None:
                raise ValueError(
                    f"Phase '{phase.name}' requires an explicit power-cycle rate "
                    "when operating_fraction is below 1 (enter 0 when none occur)."
                )
        return self


# --- Multi-Standard Prediction ---

class MultiStandardPredictionRequest(BaseModel):
    """Prediction request supporting multiple standards."""
    standard: str = "MIL-HDBK-217F"  # MIL-HDBK-217F, Telcordia, 217Plus, FIDES, NSWC
    environment: str = "GB"
    vita_global: bool = False
    parts: list[PredictionPart]
    blocks: list[PredictionBlock] = Field(default_factory=list)
    # 217Plus-specific
    process_grade: int = 3
    # FIDES-specific
    process_score: float = 50.0
    part_manufacturing: str = "standard"


# --- Derating Analysis ---

class DeratingRequest(BaseModel):
    """Derating analysis for a set of parts."""
    model_config = ConfigDict(extra="forbid")

    parts: list[PredictionPart]
    derating_level: Optional[Literal["I", "II", "III"]] = None
    standard: str = "MIL-STD-975M"
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


class CFMMonteCarloRequest(BaseModel):
    """Monte Carlo simulation from a fitted CFM analysis.

    Takes the fitted distribution name and per-mode parameters to generate
    synthetic competing-failure-mode data.
    """
    distribution: str = "Weibull_2P"
    modes: list[dict]  # [{mode: str, params: {param: value, ...}}, ...]
    n_samples: int = 1000
    seed: Optional[int] = None
    # Optional test/observation time. Units whose earliest failure exceeds this
    # horizon are right-censored (suspended) at the horizon instead of failing.
    time_horizon: Optional[float] = None
