import axios from 'axios'

// A finite timeout so a hung / unreachable backend surfaces as a clear error
// instead of spinning forever. Most endpoints respond in well under a second;
// the slowest (Fit_Everything on large data sets) still finishes within this.
export const api = axios.create({ baseURL: '/api', timeout: 60000 })

// Normalize a timeout / network failure into a helpful message. We synthesize
// a `response.data.detail` so the many existing catch blocks (which read
// `err.response?.data?.detail`) surface it without any per-call-site changes.
api.interceptors.response.use(
  r => r,
  err => {
    if (!err.response) {
      const detail =
        err.code === 'ECONNABORTED' || err.message?.includes('timeout')
          ? 'The request timed out — the analysis backend may not be running. '
            + 'Start it with "bash gui/start.sh" and try again.'
          : 'Could not reach the analysis backend. Make sure it is running '
            + '(bash gui/start.sh) at http://localhost:8000.'
      err.response = { data: { detail } }
    }
    return Promise.reject(err)
  },
)

// --- Life Data ---

export interface FitRequest {
  failures: number[]
  right_censored?: number[]
  distributions_to_fit?: string[]
  method?: string
  CI?: number
}

export interface FitResult {
  Distribution: string
  AICc: number | null
  BIC: number | null
  AD: number | null
  LogLik: number
  // Parameter point estimates plus CI fields ({name}_lower/_upper/_se)
  params?: Record<string, number | null>
}

export interface DistPlotData {
  probability?: {
    scatter_x: number[]
    scatter_y: number[]
    line_x: number[]
    line_y: number[]
    line_x_raw?: number[]
    line_lower?: number[]
    line_upper?: number[]
    x_label: string
    y_label: string
  }
  curves?: {
    x: number[]
    pdf: number[]
    cdf: number[]
    sf: number[]
    hf: number[]
    sf_lower?: number[]
    sf_upper?: number[]
    cdf_lower?: number[]
    cdf_upper?: number[]
  }
}

export interface FitResponse {
  results: FitResult[]
  best_distribution: string
  CI: number
  plots: Record<string, DistPlotData>
  available_distributions: string[]
}

export const fitDistributions = (req: FitRequest) =>
  api.post<FitResponse>('/life-data/fit', req).then(r => r.data)

export interface NonparametricRequest {
  failures: number[]
  right_censored?: number[]
  method?: string
  CI?: number
}

export interface NonparametricResponse {
  method: string
  time: number[]
  SF: number[]
  CHF?: number[]
  CI_lower: number[]
  CI_upper: number[]
}

export const fitNonparametric = (req: NonparametricRequest) =>
  api.post<NonparametricResponse>('/life-data/nonparametric', req).then(r => r.data)

export const getDistributions = () =>
  api.get<{ distributions: string[] }>('/life-data/distributions').then(r => r.data)

// --- Distribution spec / Monte Carlo / folio comparison ---

export interface GenerateRequest {
  distribution: string
  params: Record<string, number>
  n: number
  seed?: number
}

export const generateSamples = (req: GenerateRequest) =>
  api.post<{ distribution: string; samples: number[] }>('/life-data/generate', req)
    .then(r => r.data)

export interface SpecCurvesResponse {
  distribution: string
  curves: { x: number[]; pdf: number[]; cdf: number[]; sf: number[]; hf: number[] }
  stats: { mean: number | null; median: number | null; std: number | null }
}

export const getSpecCurves = (distribution: string, params: Record<string, number>) =>
  api.post<SpecCurvesResponse>('/life-data/spec-curves', { distribution, params })
    .then(r => r.data)

export const evaluateDistribution = (
  distribution: string, params: Record<string, number>, t: number,
) =>
  api.post<{ distribution: string; t: number; sf: number; cdf: number; pdf: number; hf: number }>(
    '/life-data/evaluate', { distribution, params, t }).then(r => r.data)

export interface CalculatorResponse {
  distribution: string
  mean_life: number | null
  reliability?: number
  prob_failure?: number
  pdf?: number | null
  failure_rate?: number | null
  conditional_reliability?: number | null
  conditional_prob_failure?: number | null
  reliable_life?: number | null
  bx_life?: number | null
  bx_percent?: number
}
export const calculateMetrics = (req: {
  distribution: string; params: Record<string, number>
  mission_end?: number | null; elapsed?: number | null
  reliability_target?: number | null; bx_percent?: number | null
}) => api.post<CalculatorResponse>('/life-data/calculate', req).then(r => r.data)

export interface CompareRequest {
  folios: { name: string; failures: number[]; right_censored?: number[] }[]
  distribution: string
  CI: number
}

export interface ContourData {
  x_name: string
  y_name: string
  x: number[]
  y: number[]
  nll: (number | null)[][]
  level: number
  point: [number | null, number | null]
}

export interface CompareResponse {
  distribution: string
  CI: number
  param_names: string[]
  folios: {
    name: string
    n_failures: number
    n_censored: number
    log_likelihood: number | null
    AICc: number | null
    params: Record<string, number | null>
    contour: ContourData | null
    curves?: { x: number[]; pdf: number[]; cdf: number[]; sf: number[]; hf: number[] } | null
    pp?: { theoretical: number[]; empirical: number[] } | null
    qq?: { theoretical: number[]; empirical: number[] } | null
  }[]
  lr_test: {
    statistic: number
    df: number
    p_value: number
    pooled_log_likelihood: number | null
    separate_log_likelihood: number
    alpha: number
    different: boolean
  } | null
}

export const compareFolios = (req: CompareRequest) =>
  api.post<CompareResponse>('/life-data/compare', req).then(r => r.data)

// Special Weibull models (mixture / competing risks / DSZI / grouped)
export interface SpecialModelRequest {
  model: string
  failures: number[]
  right_censored?: number[] | null
  failure_quantities?: number[] | null
  right_censored_quantities?: number[] | null
  CI?: number
}
export interface SpecialModelResponse {
  model: string
  params: { name: string; value: number }[]
  loglik: number | null
  AICc: number | null
  BIC: number | null
  curves: { x: number[]; sf?: number[]; cdf?: number[]; pdf?: number[] }
}
export const fitSpecialModel = (req: SpecialModelRequest) =>
  api.post<SpecialModelResponse>('/life-data/special', req).then(r => r.data)

// Weibayes (#15)
export interface WeibayesRequest {
  failures: number[]
  right_censored?: number[]
  beta: number
  CI?: number
}
export interface WeibayesResponse {
  beta: number
  eta: number | null
  eta_lower: number | null
  eta_upper: number | null
  r: number
  n_total: number
  sum_tb: number
  CI: number
  zero_failure: boolean
  curves: {
    x: number[]
    sf: number[]
    cdf: number[]
    pdf: number[]
    hf: number[]
    sf_lower: (number | null)[]
    sf_upper: (number | null)[]
  }
}
export const fitWeibayes = (req: WeibayesRequest) =>
  api.post<WeibayesResponse>('/life-data/weibayes', req).then(r => r.data)

// --- Reliability Testing tools ---

export const oneSampleProportion = (req: { trials: number; successes: number; CI?: number }) =>
  api.post<{ proportion: number; lower: number; upper: number; trials: number; successes: number; CI: number }>(
    '/alt/one-sample-proportion', req).then(r => r.data)

export const twoProportionTest = (req: {
  trials_1: number; successes_1: number; trials_2: number; successes_2: number; CI?: number
}) => api.post<{ p1: number; p2: number; difference: number; z: number; p_value: number; different: boolean; CI: number }>(
  '/alt/two-proportion-test', req).then(r => r.data)

export const sampleSizeNoFailures = (req: {
  reliability: number; CI?: number; lifetimes?: number; weibull_shape?: number
}) => api.post<{ n: number; reliability: number; CI: number; lifetimes: number; weibull_shape: number }>(
  '/alt/sample-size-no-failures', req).then(r => r.data)

export interface SequentialSamplingResponse {
  n: number[]; acceptance_line: (number | null)[]; rejection_line: number[]
  slope: number; intercept_accept: number; intercept_reject: number
}
export const sequentialSampling = (req: {
  p1: number; p2: number; alpha?: number; beta?: number; max_samples?: number
}) => api.post<SequentialSamplingResponse>('/alt/sequential-sampling', req).then(r => r.data)

export const testPlanner = (req: {
  MTBF?: number | null; test_duration?: number | null; number_of_failures?: number | null
  CI?: number; two_sided?: boolean
}) => api.post<{ MTBF: number; test_duration: number; number_of_failures: number; CI: number }>(
  '/alt/test-planner', req).then(r => r.data)

export const testDuration = (req: {
  MTBF_required: number; MTBF_design: number; consumer_risk?: number; producer_risk?: number
}) => api.post<{ test_duration: number; number_of_failures: number; MTBF_required: number; MTBF_design: number; consumer_risk: number; producer_risk: number }>(
  '/alt/test-duration', req).then(r => r.data)

export interface GoodnessOfFitResponse {
  statistic: number; critical_value: number; p_value: number
  hypothesis: string; CI: number; test: string; distribution: string
  bins?: number; df?: number
}
export const goodnessOfFit = (req: {
  failures: number[]; distribution?: string; test?: string; CI?: number
}) => api.post<GoodnessOfFitResponse>('/alt/goodness-of-fit', req).then(r => r.data)

// --- ALT ---

export interface ALTFitRequest {
  failures: number[]
  failure_stress: number[]
  right_censored?: number[]
  right_censored_stress?: number[]
  use_level_stress?: number
  models_to_fit?: string[]
  sort_by?: string
}

export interface ALTFitResponse {
  results: Record<string, number | string | null>[]
  best_model: string
  life_stress_plot: {
    line_stress: number[]
    line_life: (number | null)[]
    scatter_stress: number[]
    scatter_life: number[]
    use_level_stress: number | null
    use_level_life: number | null
  } | null
  available_models: string[]
}

export const fitALT = (req: ALTFitRequest) =>
  api.post<ALTFitResponse>('/alt/fit', req).then(r => r.data)

export const getALTModels = () =>
  api.get<{ models: string[] }>('/alt/models').then(r => r.data)

// --- Reliability Demonstration Test (sample size) ---

export interface SampleSizeRequest {
  method: 'nonparametric' | 'parametric_samples' | 'parametric_time'
  failures: number
  R: number
  CI: number
  mission_time?: number
  beta?: number
  test_time?: number
  n?: number
  options_table?: boolean
  oc_curve?: boolean
}

export interface SampleSizeResponse {
  method: string
  failures: number
  R: number
  CI: number
  n: number | null
  test_time: number | null
  eta: number | null
  R_test: number | null
  options_table?: { f: number; n?: number | null; test_time?: number | null }[]
  oc_curve?: { R: number[]; P_accept: number[]; R_demonstrated: number; alpha: number }
}

export const computeSampleSize = (req: SampleSizeRequest) =>
  api.post<SampleSizeResponse>('/alt/sample-size', req).then(r => r.data)

// --- Failure Rate Prediction (MIL-HDBK-217F / VITA 51.1) ---

export interface PredictionPart {
  category: string
  name?: string
  // free-text user notes about this part (not used in the calculation)
  notes?: string
  quantity: number
  params: Record<string, string | number>
  // ANSI/VITA 51.1 supplement: null/undefined = inherit global, else override
  apply_vita?: boolean | null
  // Per-part environment override: null/undefined = inherit from block/global
  environment?: string | null
  // frontend-only: containing system block id (null/undefined = root level)
  parentId?: string | null
}

export interface PredictionRequest {
  environment: string
  vita_global: boolean
  parts: PredictionPart[]
}

export interface PredictionResult {
  name: string
  category: string
  quantity: number
  multiplier: number
  failure_rate: number
  total_failure_rate: number
  contribution: number
  pi_factors: Record<string, number>
  vita: boolean
  // Present only when VITA 51.1 is applied: the unadjusted MIL-HDBK-217F values
  base_pi_factors?: Record<string, number>
  base_failure_rate?: number
  base_total_failure_rate?: number
  // Set when a part could not be computed under the selected standard (#3).
  incompatible?: boolean
  error?: string
}

export interface IncompatiblePart {
  index: number
  name: string
  category: string
  error: string
}

export interface PredictionResponse {
  environment: string
  vita_global: boolean
  total_failure_rate: number
  mtbf_hours: number | null
  results: PredictionResult[]
  /** Parts that could not be computed under the selected standard (#3). */
  incompatible?: IncompatiblePart[]
}

export const predictFailureRate = (req: PredictionRequest) =>
  api.post<PredictionResponse>('/prediction/predict', req).then(r => r.data)

export const getPredictionOptions = () =>
  api.get<{
    environments: { code: string; description: string }[]
    standards: string[]
    categories: string[]
  }>('/prediction/options').then(r => r.data)

// --- System Reliability ---

export interface RBDNode {
  id: string
  type: string
  data?: Record<string, unknown>
}

export interface RBDEdge {
  source: string
  target: string
}

export interface RBDImportance {
  id: string
  label: string
  reliability: number
  Birnbaum: number
  Criticality: number
  RAW: number | null
  RRW: number | null
}

export interface RBDResponse {
  system_reliability: number
  system_unreliability: number
  path_sets: string[][]
  components: { id: string; label: string; reliability: number }[]
  importance?: RBDImportance[]
}

export const computeRBD = (nodes: RBDNode[], edges: RBDEdge[]) =>
  api.post<RBDResponse>('/system/rbd', { nodes, edges }).then(r => r.data)

// --- Fault Tree ---

export interface FTNode {
  id: string
  type: string
  data: Record<string, unknown>
}

export interface FTEdge {
  source: string
  target: string
}

export interface FTCutSetFormula {
  events: string[]
  formula: string
  value: number | null
}

export interface FaultTreeResponse {
  top_event_probability: number
  minimal_cut_sets: string[][]
  importance: {
    event: string
    Birnbaum: number
    'Fussell-Vesely': number
    RAW: number | null
    RRW: number | null
  }[]
  methods?: Record<string, number | null>
  simulation?: {
    probability: number
    std_error: number
    ci_lower: number
    ci_upper: number
    n_samples: number
  }
  formulas?: {
    boolean_expression: string
    probability_expression: string
    cut_sets: FTCutSetFormula[]
  }
}

export interface FaultTreeGraph {
  nodes: FTNode[]
  edges: FTEdge[]
}

export interface AnalyzeFaultTreeOptions {
  exposureTime?: number | null
  methods?: string[]
  nSimulations?: number
  seed?: number | null
  trees?: Record<string, FaultTreeGraph>
  treeId?: string | null
}

export const analyzeFaultTree = (
  nodes: FTNode[], edges: FTEdge[], opts: AnalyzeFaultTreeOptions = {},
) =>
  api.post<FaultTreeResponse>('/fault-tree/analyze', {
    nodes,
    edges,
    exposure_time: opts.exposureTime ?? null,
    methods: opts.methods,
    n_simulations: opts.nSimulations,
    seed: opts.seed ?? null,
    trees: opts.trees,
    tree_id: opts.treeId ?? null,
  }).then(r => r.data)

// --- Stress-Strength Interference ---

export interface StressStrengthResponse {
  probability_of_failure: number
  reliability: number
  curves: { x: number[]; stress_pdf: number[]; strength_pdf: number[] }
}

export const computeStressStrength = (req: {
  stress_distribution: string; stress_params: Record<string, number>
  strength_distribution: string; strength_params: Record<string, number>
}) => api.post<StressStrengthResponse>('/life-data/stress-strength', req).then(r => r.data)

// --- ALT Acceleration Factor ---

export interface AccelerationFactorResponse {
  model: string
  stress_test: number
  stress_use: number
  acceleration_factor: number
}

export const computeAccelerationFactor = (req: {
  model: string; stress_test: number; stress_use: number; params: Record<string, number>
}) => api.post<AccelerationFactorResponse>('/alt/acceleration-factor', req).then(r => r.data)

export interface PassProbResponse {
  test_duration: number
  allowable_failures: number
  true_mtbf: number
  lambda: number
  p_pass: number
  oc_curve: { mtbf: number[]; p_pass: (number | null)[] } | null
}

export const computePassProbability = (req: {
  test_duration: number; allowable_failures: number; true_mtbf: number
  oc_mtbf_min?: number; oc_mtbf_max?: number; oc_points?: number
}) => api.post<PassProbResponse>('/alt/pass-probability', req).then(r => r.data)

// --- Physics of Failure ---

export interface SNCurveResponse {
  A: number; b: number; r_squared: number; endurance_limit: number
  curve: { n: number[]; s: number[] }
  prediction: { cycles: number | null; stress: number | null } | null
}

export const computeSNCurve = (req: {
  stress_amplitude: number[]; cycles_to_failure: number[]
  stress_query?: number | null; life_query?: number | null
}) => api.post<SNCurveResponse>('/pof/sn-curve', req).then(r => r.data)

export interface StressStrainResponse {
  stress: number[]; strain_elastic: number[]; strain_plastic: number[]; strain_total: number[]
  E: number; K: number; n: number
}

export const computeStressStrain = (req: {
  E: number; K?: number; n?: number; sigma_y?: number | null; max_stress?: number | null
}) => api.post<StressStrainResponse>('/pof/stress-strain', req).then(r => r.data)

export interface CreepResponse {
  lmp: number; temperature_K: number; time_to_rupture_hours: number
  curve: { temperature_C: number[]; time_hours: number[] }
}

export const computeCreepLife = (req: {
  temperature_C?: number; stress_MPa?: number; C?: number; lmp_coeffs?: number[]
}) => api.post<CreepResponse>('/pof/creep-life', req).then(r => r.data)

export interface DamageResponse {
  damage_fractions: number[]; total_damage: number
  remaining_life_fraction: number; failed: boolean
}

export const computeLinearDamage = (req: {
  stress_levels: number[]; cycles_applied: number[]; cycles_to_failure: number[]
}) => api.post<DamageResponse>('/pof/linear-damage', req).then(r => r.data)

export interface FractureResponse {
  K_I: number; K_Ic: number; critical: boolean; critical_crack_length: number
  crack_growth_curve?: { a: number[]; cycles: number[] } | null
}

export const computeFracture = (req: {
  sigma?: number; a?: number; Y?: number; K_Ic?: number
  C?: number; m?: number; a_initial?: number | null; delta_sigma?: number | null
}) => api.post<FractureResponse>('/pof/fracture', req).then(r => r.data)

export interface CoffinMansonResponse {
  transition_reversals: number; transition_cycles: number; transition_strain: number
  curve: {
    reversals: number[]; strain_elastic: number[]
    strain_plastic: number[]; strain_total: number[]
  }
  prediction: { strain_amplitude: number; reversals: number; cycles: number } | null
}

export const computeCoffinManson = (req: {
  E: number; sigma_f: number; b?: number; epsilon_f?: number; c?: number
  strain_query?: number | null
}) => api.post<CoffinMansonResponse>('/pof/coffin-manson', req).then(r => r.data)

export interface NorrisLandzbergResponse {
  acceleration_factor: number
  factor_dT: number; factor_frequency: number; factor_temperature: number
  T_max_use_K: number; T_max_test_K: number
  cycles_field?: number | null
}

export const computeNorrisLandzberg = (req: {
  dT_use?: number; dT_test?: number; f_use?: number; f_test?: number
  T_max_use?: number; T_max_test?: number; n?: number; m?: number; Ea?: number
  cycles_test?: number | null
}) => api.post<NorrisLandzbergResponse>('/pof/norris-landzberg', req).then(r => r.data)

export interface ElectromigrationResponse {
  mttf_hours: number
  temperature_K: number
  curve_temperature: { temperature_C: number[]; mttf_hours: number[] }
  curve_current_density: { J: number[]; mttf_hours: number[] }
}

export const computeElectromigration = (req: {
  A?: number; J?: number; n?: number; Ea?: number; T?: number
}) => api.post<ElectromigrationResponse>('/pof/electromigration', req).then(r => r.data)

export interface PeckResponse {
  ttf_test_hours: number
  temperature_K: number
  acceleration_factor?: number | null
  ttf_use_hours?: number | null
  curve: { RH: number[]; ttf_hours: number[] }
}

export const computePeck = (req: {
  A?: number; RH?: number; n?: number; Ea?: number; T?: number
  RH_use?: number | null; T_use?: number | null
}) => api.post<PeckResponse>('/pof/peck', req).then(r => r.data)

export interface ArrheniusResponse {
  acceleration_factor: number
  T_use_K: number; T_test_K: number
  life_use_hours?: number | null
  curve: { T_test_C: number[]; af: number[] }
}

export const computeArrhenius = (req: {
  Ea?: number; T_use?: number; T_test?: number; life_test?: number | null
}) => api.post<ArrheniusResponse>('/pof/arrhenius', req).then(r => r.data)

export interface EyringResponse {
  acceleration_factor: number
  T_use_K: number; T_test_K: number
  life_use_hours?: number | null
  curve: { T_test_C: number[]; af: number[] }
}

export const computeEyring = (req: {
  Ea?: number; T_use?: number; T_test?: number; n?: number; life_test?: number | null
}) => api.post<EyringResponse>('/pof/eyring', req).then(r => r.data)

export interface HallbergPeckResponse {
  acceleration_factor: number
  factor_humidity: number; factor_temperature: number
  T_use_K: number; T_test_K: number
  life_use_hours?: number | null
  curve: { RH_use: number[]; af: number[] }
}

export const computeHallbergPeck = (req: {
  Ea?: number; n?: number; RH_use?: number; RH_test?: number
  T_use?: number; T_test?: number; life_test?: number | null
}) => api.post<HallbergPeckResponse>('/pof/hallberg-peck', req).then(r => r.data)

export interface TDDBResponse {
  model: string
  acceleration_factor: number
  factor_field: number; factor_temperature: number
  T_use_K: number; T_test_K: number
  life_use_hours?: number | null
  curve: { E_use: number[]; af: number[] }
}

export const computeTDDB = (req: {
  model?: string; gamma?: number; Ea?: number; E_use?: number; E_test?: number
  T_use?: number; T_test?: number; life_test?: number | null
}) => api.post<TDDBResponse>('/pof/tddb', req).then(r => r.data)

export interface MeanStressResponse {
  method: string
  factor_of_safety: number
  safe: boolean
  Se: number
  strength_label: string
  strength_intercept: number
  operating_point: { sigma_m: number; sigma_a: number }
  failure_line: { sigma_m: number[]; sigma_a: number[] }
}

export const computeMeanStress = (req: {
  method?: string; sigma_a?: number; sigma_m?: number
  Se?: number; Su?: number; Sy?: number
}) => api.post<MeanStressResponse>('/pof/mean-stress', req).then(r => r.data)

// --- Reliability Growth ---

export interface GrowthRequest {
  times: number[]
  T?: number | null
  model: string
}

export interface GrowthResponse {
  model: string
  beta?: number
  Lambda?: number
  alpha?: number
  A?: number
  r_squared?: number | null
  CvM?: number | null
  growth_rate: number
  mtbf_instantaneous: number
  mtbf_cumulative: number
  n_failures: number
  T: number
  failure_terminated?: boolean
  scatter: { t: number[]; n: number[] }
  model_curve: { t: number[]; n: number[] }
  mtbf_curve: { t: number[]; cumulative: number[]; instantaneous: number[] }
}

export const fitGrowth = (req: GrowthRequest) =>
  api.post<GrowthResponse>('/growth/fit', req).then(r => r.data)

// Optimal replacement time
export interface OptimalReplacementResponse {
  optimal_replacement_time: number
  min_cost: number
  cost_PM_per_unit_time: number
  time: number[]
  cost: (number | null)[]
  q: number
}
export const optimalReplacementTime = (req: {
  cost_PM: number; cost_CM: number; weibull_alpha: number; weibull_beta: number; q: number
}) => api.post<OptimalReplacementResponse>('/growth/optimal-replacement', req).then(r => r.data)

// ROCOF (rate of occurrence of failures) + Laplace trend test
export interface ROCOFResponse {
  U: number
  z_crit: number
  p_value: number
  CI: number
  n_failures: number
  test_end: number
  failure_terminated: boolean
  trend: string
  ROCOF: number | null
  Lambda_hat: number | null
  Beta_hat: number | null
}
export const computeROCOF = (req: {
  times_between_failures?: number[] | null
  failure_times?: number[] | null
  test_end?: number | null
  CI?: number
}) => api.post<ROCOFResponse>('/growth/rocof', req).then(r => r.data)

// Mean Cumulative Function
export interface MCFResponse {
  nonparametric: {
    time: number[]; MCF: number[]; MCF_lower: number[]; MCF_upper: number[]
    variance: number[]; CI: number
  }
  parametric: {
    alpha: number; beta: number; r_squared: number
    time: number[]; MCF: number[]; CI: number
  } | null
  trend?: { trend: string; detail: string }
}
export const computeMCF = (req: { data: number[][]; CI?: number; parametric?: boolean }) =>
  api.post<MCFResponse>('/growth/mcf', req).then(r => r.data)

// --- Warranty Analysis ---

export interface WarrantyConvertRequest {
  quantities: number[]
  returns: (number | null)[][]
}

export interface WarrantyConvertResponse {
  failures: number[]
  right_censored: number[]
  n_failures: number
  n_censored: number
}

export interface WarrantyForecastRequest {
  quantities: number[]
  returns: (number | null)[][]
  n_forecast_periods: number
  distribution?: string
  fit_method?: string
}

export interface WarrantyForecastResponse {
  distribution: string
  params: Record<string, number>
  n_failures: number
  n_censored: number
  forecast: number[][]
  totals: number[]
  failures: number[]
  right_censored: number[]
}

export const convertWarrantyData = (req: WarrantyConvertRequest) =>
  api.post<WarrantyConvertResponse>('/warranty/convert', req).then(r => r.data)

export const forecastWarrantyReturns = (req: WarrantyForecastRequest) =>
  api.post<WarrantyForecastResponse>('/warranty/forecast', req).then(r => r.data)


// --- Markov Chain Analysis ---

export interface MarkovStateInput {
  id: string
  name: string
  state_type: 'operational' | 'degraded' | 'failed'
  description: string
}

export interface MarkovTransitionInput {
  from_state: string
  to_state: string
  rate: number
  label: string
}

export interface MarkovRequest {
  states: MarkovStateInput[]
  transitions: MarkovTransitionInput[]
  times?: number[]
  initial_state?: string
}

export interface MarkovSystemParams {
  availability_ss: number | null
  unavailability_ss: number | null
  mttf: number | null
  mtbf: number | null
  mttr: number | null
  failure_frequency: number | null
  repair_frequency: number | null
}

export interface MarkovTimeDependentEntry {
  time: number
  state_probs: Record<string, number>
  availability: number
  unavailability: number
  reliability: number
  unreliability: number
}

export interface MarkovResponse {
  states: { id: string; name: string; type: string; description: string }[]
  transitions: { from: string; to: string; rate: number; label: string }[]
  transition_matrix: number[][]
  steady_state: Record<string, number> | null
  system_params: MarkovSystemParams
  time_dependent?: MarkovTimeDependentEntry[]
}

export interface MarkovExampleInfo {
  name: string
  description: string
  states: { id: string; name: string; type: string; description: string }[]
  transitions: { from: string; to: string; rate: number; label: string }[]
}

export const analyzeMarkov = (req: MarkovRequest) =>
  api.post<MarkovResponse>('/markov/analyze', req).then(r => r.data)

export const getMarkovExamples = () =>
  api.get<Record<string, { name: string; description: string; default_params: Record<string, number> }>>('/markov/examples').then(r => r.data)

export const getMarkovExample = (modelId: string) =>
  api.get<MarkovExampleInfo>(`/markov/examples/${modelId}`).then(r => r.data)


// --- Multi-Standard Prediction ---

export interface MultiStandardPredictionRequest {
  standard: string
  environment: string
  vita_global: boolean
  parts: PredictionPart[]
  process_grade?: number
  process_score?: number
  part_manufacturing?: string
}

export const predictMultiStandard = (req: MultiStandardPredictionRequest) =>
  api.post<PredictionResponse>('/prediction/predict-standard', req).then(r => r.data)

export const getPredictionStandards = () =>
  api.get<Record<string, { name: string; description: string; categories: string[] }>>('/prediction/standards').then(r => r.data)


// --- Derating Analysis ---

export interface DeratingResult {
  parameter: string
  description: string
  actual_value: number | null
  rated_value: number | null
  stress_ratio: number | null
  level_I: number
  level_II: number
  level_III: number
  status: 'ok' | 'warning' | 'exceeds'
  derating_level: string
}

export interface DeratingPartResult {
  name: string
  category: string
  derating: DeratingResult[]
  overall_status: 'ok' | 'warning' | 'exceeds'
}

export interface DeratingResponse {
  standard: string
  derating_level: string
  summary: { ok: number; warning: number; exceeds: number }
  results: DeratingPartResult[]
}

export interface DeratingStandard {
  key: string
  name: string
  description: string
}

export interface CustomDeratingRule {
  param: string
  desc: string
  unit: string
  level_I: number
  level_II: number
  level_III: number
  rated?: number
}

export const getDeratingStandards = () =>
  api.get<DeratingStandard[]>('/prediction/derating-standards').then(r => r.data)

export const analyzeDerating = (
  parts: PredictionPart[],
  derating_level: string = 'II',
  standard: string = 'MIL-STD-975',
  custom_rules?: Record<string, CustomDeratingRule[]>,
) =>
  api.post<DeratingResponse>('/prediction/derating', {
    parts,
    derating_level,
    standard,
    custom_rules: custom_rules ?? null,
  }).then(r => r.data)


// --- Mission Profile ---

export interface MissionPhaseInput {
  name: string
  duration: number
  environment: string
  temperature: number
  operating: boolean
  duty_cycle: number
  description: string
}

export interface MissionProfilePredictionRequest {
  profile_name: string
  phases: MissionPhaseInput[]
  parts: PredictionPart[]
  standard: string
}

export interface MissionProfileResponse {
  standard: string
  profile_name: string
  total_duration: number
  system_failure_rate: number
  system_mtbf: number | null
  mission_reliability: number
  mission_unreliability: number
  phases: MissionPhaseInput[]
  part_results: {
    name: string
    category: string
    quantity: number
    mission_failure_rate: number
    phases: {
      phase_name: string
      duration: number
      environment: string
      temperature: number
      operating: boolean
      duty_cycle: number
      failure_rate: number
      fraction: number
      weighted_contribution: number
      pi_factors: Record<string, number>
      error?: string | null
    }[]
  }[]
}

export const predictMissionProfile = (req: MissionProfilePredictionRequest) =>
  api.post<MissionProfileResponse>('/prediction/mission-profile', req).then(r => r.data)

export const getMissionProfiles = () =>
  api.get<Record<string, { name: string; total_duration: number; n_phases: number; phases: MissionPhaseInput[] }>>('/prediction/mission-profiles').then(r => r.data)
