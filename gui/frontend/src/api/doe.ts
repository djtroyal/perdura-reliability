import { api } from './client'

// ---------------------------------------------------------------------------
// Request interface
// ---------------------------------------------------------------------------

export interface GenerateDesignRequest {
  design: string
  factor_names?: string[]
  n_factors?: number
  levels?: number[]
  generators?: string[]
  fraction?: number
  center_points?: number
  alpha?: string | number
  q?: number
  degree?: number
  lower?: number[]
  upper?: number[]
  taguchi_array?: string
  low?: number[]
  high?: number[]
  explicit_levels?: number[][]
  randomize?: boolean
  seed?: number
  n_blocks?: number
  block_seed?: number
  standardized_coefficient?: number
  power_alpha?: number
  target_power?: number
  /** Total independent observations at each design point; 1 is unreplicated. */
  replicates?: number
}

// ---------------------------------------------------------------------------
// Response interface
// ---------------------------------------------------------------------------

export interface GenerateDesignResponse {
  columns: Record<string, (number | string)[]>
  runs: Record<string, number | string>[]
  factor_names?: string[]
  metadata: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// API function
// ---------------------------------------------------------------------------

export async function generateDesign(
  req: GenerateDesignRequest,
): Promise<GenerateDesignResponse> {
  const res = await api.post<GenerateDesignResponse>('/doe/generate', req)
  return res.data
}

// ── Analysis of a completed factorial experiment ──
export interface DOEEffectRow {
  term: string
  effect: number
  coefficient: number
  ss: number
  pct_contribution: number
  p_value: number | null
  significant_lenth: boolean | null
}
export interface DOEAnalyzeResponse {
  analysis_type?: 'two_level_factorial' | 'response_surface' | 'mixture'
  model?: string
  effects: DOEEffectRow[]
  terms?: { term: string; coefficient: number; standard_error: number | null; t_value: number | null; p_value: number | null }[]
  aliased_terms_dropped: string[]
  r2: number
  adj_r2: number | null
  saturated: boolean
  lenth: { pse: number; margin_of_error: number } | null
  half_normal: { abs_effect: number[]; quantile: number[]; term: string[] }
  main_effects: Record<string, { levels: number[]; means: number[] }>
  interactions: { factor_x: string; factor_trace: string; x_levels: number[]; series: { level: number; means: (number | null)[] }[] }[]
  residuals: number[]
  fitted: number[]
  n_runs: number
  residual_df?: number
  lack_of_fit?: {
    status: string; F: number | null; p_value: number | null
    lack_of_fit_ss: number; lack_of_fit_df: number
    pure_error_ss: number; pure_error_df: number
    interpretation: string
  }
  design_diagnostics?: {
    model: string; rank: number; n_parameters: number; full_rank: boolean
    residual_df: number; condition_number: number | null; replicated_runs: number
    blocking?: { n_blocks: number; confounded_with_treatment_model: boolean; block_effects_estimable: boolean }
  }
  stationary_point?: {
    status: string; coordinates: number[] | null; predicted_response?: number
    classification?: string; inside_tested_factor_ranges?: boolean
    quadratic_eigenvalues?: number[]
  }
  mixture_optimum?: {
    minimum: { status: string; composition?: Record<string, number>; predicted_response?: number }
    maximum: { status: string; composition?: Record<string, number>; predicted_response?: number }
    bounds: { lower: number[]; upper: number[] }
    conditional_on: string
  }
  warnings?: string[]
  block_effects?: { term: string; coefficient: number; p_value: number | null }[]
  block_adjusted?: boolean
}
export async function analyzeDesign(req: {
  factor_names: string[]
  runs: Record<string, number>[]
  responses: number[]
  include_interactions?: boolean
  design_class?: string
  model?: string
  metadata?: Record<string, unknown>
  constraints?: Record<string, unknown>
}): Promise<DOEAnalyzeResponse> {
  const res = await api.post<DOEAnalyzeResponse>('/doe/analyze', req)
  return res.data
}
