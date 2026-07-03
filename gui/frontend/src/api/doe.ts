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
  effects: DOEEffectRow[]
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
}
export async function analyzeDesign(req: {
  factor_names: string[]
  runs: Record<string, number>[]
  responses: number[]
  include_interactions?: boolean
}): Promise<DOEAnalyzeResponse> {
  const res = await api.post<DOEAnalyzeResponse>('/doe/analyze', req)
  return res.data
}
