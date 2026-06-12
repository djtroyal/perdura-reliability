import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

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
  quantity: number
  params: Record<string, string | number>
  // ANSI/VITA 51.1 supplement: null/undefined = inherit global, else override
  apply_vita?: boolean | null
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
}

export interface PredictionResponse {
  environment: string
  vita_global: boolean
  total_failure_rate: number
  mtbf_hours: number | null
  results: PredictionResult[]
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
}

export const analyzeFaultTree = (nodes: FTNode[], edges: FTEdge[]) =>
  api.post<FaultTreeResponse>('/fault-tree/analyze', { nodes, edges }).then(r => r.data)

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
