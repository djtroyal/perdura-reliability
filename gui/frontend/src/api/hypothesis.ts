import { api } from './client'

// ---------------------------------------------------------------------------
// Common result shape shared by all tests
// ---------------------------------------------------------------------------

export interface HypothesisResult {
  test: string
  statistic: number | null
  p_value: number | null
  df: number | { [key: string]: number } | null
  effect_size: number | null
  effect_size_name?: string
  alpha: number
  reject_null: boolean
  alternative?: string
  interpretation: string
  // Confidence interval on the mean / mean-difference (t-tests)
  ci_lower?: number | null
  ci_upper?: number | null
  ci_level?: number
  ci_on?: string
  // One-sample extras
  sample_mean?: number | null
  sample_sd?: number | null
  n?: number
  popmean?: number
  // Two-sample extras
  equal_var?: boolean
  mean_a?: number | null
  mean_b?: number | null
  sd_a?: number | null
  sd_b?: number | null
  n_a?: number
  n_b?: number
  // Paired extras
  mean_diff?: number | null
  sd_diff?: number | null
  // Binomial extras
  successes?: number
  p_null?: number
  p_observed?: number | null
  // k-group extras
  k?: number
  n_total?: number
  group_means?: (number | null)[]
  group_sds?: (number | null)[]
  group_ns?: number[]
  group_medians?: (number | null)[]
  pairwise_bonferroni?: PairwiseComparison[]
  // SS decomposition (one-way ANOVA)
  ss_between?: number | null
  ss_within?: number | null
  ss_total?: number | null
  ms_between?: number | null
  ms_within?: number | null
  // ANOVA table (factorial / RM / mixed)
  anova_table?: AnovaTableRow[]
  // Mixed ANOVA sub-effects
  between_factor?: SubEffect
  within_factor?: SubEffect
  interaction?: SubEffect
  // Misc
  n_subjects?: number
  n_conditions?: number
  n_between_levels?: number
  n_within_levels?: number
  balance_note?: string
  shape?: number[]
}

export interface PairwiseComparison {
  group_i: number
  group_j: number
  mean_diff: number | null
  p_value_raw: number | null
  p_value_bonferroni: number | null
  significant: boolean
}

export interface AnovaTableRow {
  source: string
  SS: number | null
  df: number | null
  MS: number | null
  F: number | null
  p_value: number | null
  partial_eta_sq?: number | null
  significant?: boolean | null
}

export interface SubEffect {
  F: number | null
  p_value: number | null
  reject_null: boolean
}

// ---------------------------------------------------------------------------
// /run — dispatch to any simple test
// ---------------------------------------------------------------------------

export interface RunRequest {
  test: string
  // One-sample
  data?: number[]
  popmean?: number
  // Two-sample / paired / nonparametric
  group_a?: number[]
  group_b?: number[]
  equal_var?: boolean
  // k-group
  groups?: number[][]
  // Chi-square GOF
  observed?: number[]
  expected?: number[] | null
  // Chi-square independence
  table?: number[][]
  // Binomial
  successes?: number
  n?: number
  p?: number
  // Common
  alpha?: number
  alternative?: string
}

export const runHypothesisTest = (req: RunRequest) =>
  api.post<HypothesisResult>('/hypothesis/run', req).then(r => r.data)

// ---------------------------------------------------------------------------
// /anova — factorial 1–3 way
// ---------------------------------------------------------------------------

export interface AnovaRequest {
  response: number[]
  factors: Record<string, string[]>
  factor_names: string[]
  alpha?: number
}

export const runAnova = (req: AnovaRequest) =>
  api.post<HypothesisResult>('/hypothesis/anova', req).then(r => r.data)

// ---------------------------------------------------------------------------
// /rm-anova — repeated-measures ANOVA
// ---------------------------------------------------------------------------

export interface RMAnovaRequest {
  data: number[][]   // shape: subjects x conditions
  alpha?: number
}

export const runRMAnova = (req: RMAnovaRequest) =>
  api.post<HypothesisResult>('/hypothesis/rm-anova', req).then(r => r.data)

// ---------------------------------------------------------------------------
// /mixed-anova — one between + one within factor
// ---------------------------------------------------------------------------

export interface MixedAnovaRequest {
  values: number[]
  subjects: string[]
  between_factor: string[]
  within_factor: string[]
  alpha?: number
}

export const runMixedAnova = (req: MixedAnovaRequest) =>
  api.post<HypothesisResult>('/hypothesis/mixed-anova', req).then(r => r.data)
