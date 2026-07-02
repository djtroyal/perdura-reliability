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
export interface SparHResponse {
  hep: number
  nominal: number
  psf_product: number | null
  raw_hep?: number
  adjustment_applied: boolean
  n_negative_psfs: number
  applied: Record<string, { level: string; multiplier: number | string }>
  guaranteed_failure: boolean
}
export const computeSparH = (req: { task_type: string; psfs: Record<string, string> }) =>
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

// ── JHEDI ──
export interface JhediResponse { hep: number; base: number; aggravating_factors: number }
export const computeJhedi = (req: { task_category: string; aggravating_factors: number }) =>
  api.post<JhediResponse>('/hra/jhedi', req).then(r => r.data)

// ── SHERPA ──
export interface SherpaResponse {
  hep: number
  overall_error_probability: number
  max_critical_probability: number
  counts_by_mode: Record<string, number>
  rows: { error_mode: string; probability: number; critical: boolean }[]
}
export const computeSherpa = (req: {
  rows: { error_mode: string; probability: string; critical: boolean }[]
}) => api.post<SherpaResponse>('/hra/sherpa', req).then(r => r.data)

// ── ATHEANA ──
export interface AtheanaResponse { hep: number; min: number; mode: number; max: number }
export const computeAtheana = (req: { min_hep: number; mode_hep: number; max_hep: number }) =>
  api.post<AtheanaResponse>('/hra/atheana', req).then(r => r.data)

// ── MERMOS ──
export interface MermosResponse {
  hep: number
  total_failure_probability: number
  dominant_scenario: { label: string; probability: number } | null
  scenarios: { label: string; probability: number }[]
}
export const computeMermos = (req: { scenarios: { label: string; probability: number }[] }) =>
  api.post<MermosResponse>('/hra/mermos', req).then(r => r.data)
