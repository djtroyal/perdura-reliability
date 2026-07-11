import { api } from './client'

// Human Reliability Analysis — one compute function per method. Each returns a
// human-error probability (HEP) plus method-specific detail.

// ── HEART ──
export interface HeartResponse {
  hep: number
  nominal: number
  gtt: string
  contributions: { epc_id: number; max_affect: number; proportion: number; factor: number; label: string }[]
}
export const computeHeart = (req: { gtt: string; epcs: { epc_id: number; proportion: number }[] }) =>
  api.post<HeartResponse>('/hra/heart', req).then(r => r.data)

// ── SPAR-H ──
export type SparHDependencyLevel = 'zero' | 'low' | 'moderate' | 'high' | 'complete'
export interface SparHDependencyRequest {
  enabled: boolean
  level?: SparHDependencyLevel | null
  same_crew?: boolean | null
  close_in_time?: boolean | null
  same_location?: boolean | null
  additional_cues?: boolean | null
  failure_number_in_sequence?: number
  justification?: string
}
export interface SparHResponse {
  hep: number
  nominal: number
  psf_product: number | null
  raw_hep?: number
  psf_adjusted_hep: number
  independent_hep: number
  adjustment_applied: boolean
  n_negative_psfs: number
  applied: Record<string, { level: string; multiplier: number | string }>
  guaranteed_failure: boolean
  minimum_cutoff_applied: boolean
  dependency: {
    applied: boolean
    level: SparHDependencyLevel
    independent_hep: number
    adjusted_hep: number
    source: string
    failure_number_in_sequence: number
    justification: string
    context?: Record<string, boolean | null>
  }
  uncertainty: {
    distribution: string
    mean: number
    alpha: number | null
    beta: number | null
    confidence: number
    lower: number
    upper: number
    median: number
    parameter_source: string
    note?: string
  }
  result_quality: 'screening'
  psf_dependence_note: string
}
export const computeSparH = (req: {
  task_type: string
  psfs: Record<string, string>
  dependency?: SparHDependencyRequest | null
  uncertainty_confidence?: number
  uncertainty_alpha?: number | null
}) =>
  api.post<SparHResponse>('/hra/spar-h', req).then(r => r.data)

// ── THERP ──
export interface TherpResponse {
  hep: number
  adjusted_hep: number
  nominal_hep: number
  stress_multiplier: number
  experience_multiplier: number
  conditional_hep: number | null
  joint_hep: number | null
  dependency: string | null
}
export const computeTherp = (req: {
  nominal_hep: number; stress: string; experience: string
  second_hep?: number | null; dependency?: string
}) => api.post<TherpResponse>('/hra/therp', req).then(r => r.data)

// ── CREAM ──
export interface CreamResponse {
  hep: number
  control_mode: string
  hep_lower: number
  hep_upper: number
  sum_reduced: number
  sum_improved: number
  effects: Record<string, string>
  /** Control-mode map: rows improved 0-7 × cols reduced 0-9; null = infeasible. */
  grid: (string | null)[][]
}
export const computeCream = (req: { cpc_levels: Record<string, string> }) =>
  api.post<CreamResponse>('/hra/cream', req).then(r => r.data)

// ── CREAM extended ──
export interface CreamExtStep {
  description: string
  activity: string
  failure_type: string
  failure_label: string
  function: string
  nominal_cfp: number
  weight: number
  cfp: number
}
export interface CreamExtendedResponse {
  hep: number
  steps: CreamExtStep[]
  dominant_step: CreamExtStep | null
  context_weights: Record<string, number>
}
export const computeCreamExtended = (req: {
  cpc_levels: Record<string, string>
  steps: { description: string; activity: string; failure_type: string }[]
}) => api.post<CreamExtendedResponse>('/hra/cream-extended', req).then(r => r.data)

// ── SLIM ──
export interface SlimResponse { hep: number; sli: number; a: number; b: number }
export const computeSlim = (req: {
  psfs: { weight: number; rating: number }[]
  anchors?: { sli: number; hep: number }[] | null
  a?: number | null; b?: number | null
}) => api.post<SlimResponse>('/hra/slim', req).then(r => r.data)

// ── Category-factor screening (legacy endpoint: JHEDI) ──
export interface CategoryScreeningResponse {
  hep: number
  base: number
  aggravating_factors: number
  factor_multiplier: number
  result_quality: 'screening'
  warning: string
}
export type JhediResponse = CategoryScreeningResponse
export const computeCategoryScreening = (req: { task_category: string; aggravating_factors: number }) =>
  api.post<CategoryScreeningResponse>('/hra/category-screening', req).then(r => r.data)
export const computeJhedi = (req: { task_category: string; aggravating_factors: number }) =>
  api.post<JhediResponse>('/hra/jhedi', req).then(r => r.data)

// ── Error-mode likelihood screening (SHERPA-inspired taxonomy) ──
export interface ErrorModeScreeningResponse {
  hep: number
  overall_error_probability: number
  max_critical_probability: number
  counts_by_mode: Record<string, number>
  rows: { error_mode: string; probability: number; critical: boolean }[]
  result_quality: 'screening'
  assumption: string
}
export type SherpaResponse = ErrorModeScreeningResponse
export const computeErrorModeScreening = (req: {
  rows: { error_mode: string; probability: string; critical: boolean }[]
}) => api.post<ErrorModeScreeningResponse>('/hra/error-mode-screening', req).then(r => r.data)
export const computeSherpa = (req: {
  rows: { error_mode: string; probability: string; critical: boolean }[]
}) => api.post<SherpaResponse>('/hra/sherpa', req).then(r => r.data)

// ── Error-forcing-context elicitation screen (not full ATHEANA) ──
export interface EfcElicitationResponse {
  hep: number
  min: number
  mode: number
  max: number
  result_quality: 'screening'
  warning: string
}
export type AtheanaResponse = EfcElicitationResponse
export const computeEfcElicitationScreening = (req: { min_hep: number; mode_hep: number; max_hep: number }) =>
  api.post<EfcElicitationResponse>('/hra/efc-elicitation-screening', req).then(r => r.data)
export const computeAtheana = (req: { min_hep: number; mode_hep: number; max_hep: number }) =>
  api.post<AtheanaResponse>('/hra/atheana', req).then(r => r.data)

// ── Mission-scenario screening sum (not full MERMOS) ──
export interface MissionScenarioScreeningResponse {
  hep: number
  total_failure_probability: number
  dominant_scenario: { label: string; probability: number } | null
  scenarios: { label: string; probability: number }[]
  mutually_exclusive: boolean
  result_quality: 'screening'
  warning: string
}
export type MermosResponse = MissionScenarioScreeningResponse
export const computeMissionScenarioScreening = (req: {
  scenarios: { label: string; probability: number }[]
  mutually_exclusive: boolean
}) => api.post<MissionScenarioScreeningResponse>('/hra/mission-scenario-screening', req).then(r => r.data)
export const computeMermos = (req: { scenarios: { label: string; probability: number }[] }) =>
  api.post<MermosResponse>('/hra/mermos', req).then(r => r.data)
