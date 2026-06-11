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
}

export interface PredictionRequest {
  environment: string
  standard: string
  parts: PredictionPart[]
}

export interface PredictionResult {
  name: string
  category: string
  quantity: number
  failure_rate: number
  total_failure_rate: number
  contribution: number
  pi_factors: Record<string, number>
}

export interface PredictionResponse {
  environment: string
  standard: string
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

export interface RBDResponse {
  system_reliability: number
  system_unreliability: number
  path_sets: string[][]
  components: { id: string; label: string; reliability: number }[]
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
