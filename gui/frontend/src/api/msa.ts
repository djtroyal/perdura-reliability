import { api } from './client'

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export interface GageRRRequest {
  parts: string[]
  operators: string[]
  measurements: number[]
  tolerance?: number
  study_var_multiplier?: number
  method?: 'anova' | 'xbar_r'
  alpha_pool?: number
}

// ---------------------------------------------------------------------------
// Response — variance component row
// ---------------------------------------------------------------------------

export interface VarCompRow {
  variance: number | null
  pct_contribution: number | null
  stdev: number | null
  study_var: number | null
  pct_study_var: number | null
  pct_tolerance: number | null
}

export interface AnovaRow {
  source: string
  SS: number | null
  df: number | null
  MS: number | null
  F: number | null
  p: number | null
}

export interface CellMeanEntry {
  part: string
  operator: string
  mean: number
  measurements: number[]
}

export interface GageRRResponse {
  method: string
  anova_table?: AnovaRow[]
  anova_table_original?: AnovaRow[]
  pooled?: boolean
  alpha_pool?: number
  variance_components: Record<string, VarCompRow>
  ndc: number
  n_parts: number
  n_operators: number
  n_replicates: number | null
  study_var_multiplier: number
  per_cell_means: Record<string, CellMeanEntry>
  per_part_means: Record<string, number>
  per_op_means: Record<string, number>
  unique_parts: string[]
  unique_operators: string[]
  grand_mean: number
  // Xbar-R specific
  R_bar?: number | null
  K1?: number | null
  K2?: number | null
  K3?: number | null
  Xbar_diff?: number | null
  Rp?: number | null
}

// ---------------------------------------------------------------------------
// API function
// ---------------------------------------------------------------------------

export async function gageRR(req: GageRRRequest): Promise<GageRRResponse> {
  const res = await api.post<GageRRResponse>('/msa/gage-rr', req)
  return res.data
}
