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
  method?: 'anova' | 'xbar_r' | 'reml'
  topology?: 'crossed' | 'nested'
  alpha_pool?: number
  confidence?: number
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
  variance_ci?: [number, number] | null
  stdev_ci?: [number, number] | null
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
  topology?: 'crossed' | 'nested'
  design_diagnostics?: {
    topology: string
    valid: boolean
    balanced: boolean
    complete: boolean
    replicated: boolean
    replicates_min: number
    replicates_max: number
    missing_cells: { part: string; operator: string }[]
    reason: string | null
  }
  truncation_diagnostics?: { component: string; unconstrained_variance: number; reason: string }[]
  optimizer?: { success: boolean; message: string; iterations: number; successful_starts: number; total_starts: number }
  boundary_components?: string[]
  result_quality?: string
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
