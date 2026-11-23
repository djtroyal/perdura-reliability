import { api } from './client'

export interface SurvivalMatrixResult {
  ages: number[]; durations: number[]; survival: number[][]; failure: number[][]
  conditioning: string; negative_support_probability: number
}
export interface MechanicalRateResult {
  eta: number; beta: number; interval: number; cycle_operating_time: number; cycle_calendar_time: number | null
  failure_probability: number; survival_probability: number; cm_per_time: number; pm_per_time: number
  mttf: number | null; equivalent_operating_mtbf: number | null; calendar_failure_rate: number | null
  equivalent_calendar_time_between_failures: number | null; availability: number | null; exposure_basis: 'time' | 'non_time'; assumptions: string[]
}
export interface PredictiveBounds { lower: number; upper: number; cdf_error_bound: number; cells: number }
export interface InspectionPredictionRow {
  beta: number; eta_mle: number | null; expected_additional_failures_mle: number; posterior_predictive_mean: number
  predictive_interval: PredictiveBounds; posterior_alpha: number; posterior_beta: number
  prior_sensitivity?: (PredictiveBounds & { prior: string; alpha: number; beta: number; mean: number })[]
}
export interface InspectionPredictionResult {
  population: number; observed_failures: number; survivors: number; first_age: number; second_age: number
  level: number; rows: InspectionPredictionRow[]; prior: { alpha: number; beta: number; parameter: string }
  interval_kind: string; numerical_method: string; boundary_note: string | null; assumptions: string[]
  sources: { title: string; url: string }[]
}
export const computeSurvivalMatrix = (request: { distribution: string; params: Record<string, number>; ages: number[]; durations: number[] }) =>
  api.post<SurvivalMatrixResult>('/life-tools/survival-matrix', request).then(r => r.data)
export const computeMechanicalRate = (request: { beta: number; interval: number; eta: number | null; percentile_life: number | null; failure_percentile: number; corrective_downtime: number; preventive_downtime: number; exposure_basis: 'time' | 'non_time' }) =>
  api.post<MechanicalRateResult>('/life-tools/mechanical-rate', request).then(r => r.data)
export const computeInspectionPrediction = (request: { n: number; failures: number; first_age: number; second_age: number; betas: number[]; level: number; prior_alpha: number; prior_beta: number; prior_sensitivity: boolean }) =>
  api.post<InspectionPredictionResult>('/life-tools/inspection-prediction', request).then(r => r.data)

/** Strict lists or inclusive start:end:step ranges; no discarded tokens. */
export function parseLifetimeGrid(text: string, label: string, limit = 2500): number[] {
  const value = text.trim()
  if (!value) throw new Error(`${label} is required.`)
  if (value.includes(':')) {
    const parts = value.split(':')
    if (parts.length !== 3 || parts.some(x => !x.trim())) throw new Error(`${label}: use start:end:step.`)
    const [start, end, step] = parts.map(Number)
    if (![start, end, step].every(Number.isFinite) || step <= 0 || start < 0 || end < start) throw new Error(`${label}: require 0 ≤ start ≤ end and step > 0.`)
    const count = Math.floor((end - start) / step + 1e-10) + 1
    if (count > limit) throw new Error(`${label} allows at most ${limit} values.`)
    return Array.from({ length: count }, (_, i) => start + i * step)
  }
  const parts = value.split(/[\s,]+/).filter(part => part.length > 0)
  const values = parts.map(Number)
  if (!values.length || values.length > limit || values.some(x => !Number.isFinite(x) || x < 0)) throw new Error(`${label}: enter at most ${limit} finite nonnegative numbers.`)
  return values
}

export function survivalMatrixCsv(result: SurvivalMatrixResult, measure: 'survival' | 'failure', units: string): string {
  const quote = (s: string) => `"${s.replace(/"/g, '""')}"`
  return [[quote(`Current age (${units}); conditional ${measure}`), ...result.durations.map(d => quote(`Additional ${d} ${units}`))].join(','),
    ...result.ages.map((age, i) => [age, ...result[measure][i]].join(','))].join('\r\n')
}
