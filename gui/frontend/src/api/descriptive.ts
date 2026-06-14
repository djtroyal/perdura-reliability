import { api } from './client'

// ---------------------------------------------------------------------------
// Request interfaces
// ---------------------------------------------------------------------------

export interface SummaryRequest {
  columns: Record<string, number[]>
}

export interface FrequencyRequest {
  values: (number | string)[]
  bins?: number
}

export interface ContingencyRequest {
  row_values: (number | string)[]
  col_values: (number | string)[]
}

export interface RunChartRequest {
  values: number[]
}

export interface BoxplotRequest {
  values: number[]
}

export interface HistogramRequest {
  values: number[]
  bins?: number
}

// ---------------------------------------------------------------------------
// Response interfaces
// ---------------------------------------------------------------------------

export interface NormalityResult {
  test: string
  stat: number | null
  p: number | null
  critical_5pct?: number | null
}

export interface ColumnStats {
  n: number
  mean: number | null
  trimmed_mean: number | null
  median: number | null
  mode: number | null
  variance: number | null
  std: number | null
  sem: number | null
  min: number | null
  max: number | null
  range: number | null
  sum: number | null
  Q1: number | null
  Q2: number | null
  Q3: number | null
  IQR: number | null
  p5: number | null
  p10: number | null
  p90: number | null
  p95: number | null
  skewness: number | null
  kurtosis: number | null
  coefficient_of_variation: number | null
  MAD: number | null
  normality: NormalityResult
  error?: string
}

export type SummaryResponse = Record<string, ColumnStats>

export interface FrequencyResponse {
  mode: 'binned' | 'value_counts'
  // binned
  bin_edges?: number[]
  bin_labels?: string[]
  // value_counts
  labels?: string[]
  // common
  counts: number[]
  relative_freq: number[]
  cumulative_freq: number[]
}

export interface ContingencyResponse {
  row_labels: string[]
  col_labels: string[]
  observed: number[][]
  expected: number[][]
  row_totals: number[]
  col_totals: number[]
  grand_total: number
  chi2: {
    chi2: number | null
    p: number | null
    dof: number | null
    error?: string
  }
}

export interface RunChartResponse {
  sequence: number[]
  median: number
  n: number
  n_runs: number
  n_above: number
  n_below: number
  expected_runs: number | null
  longest_run: number
  runs_test: {
    z: number | null
    p: number | null
  }
}

export interface BoxplotResponse {
  min: number
  Q1: number
  median: number
  Q3: number
  max: number
  iqr: number
  whisker_low: number
  whisker_high: number
  outliers: number[]
}

export interface HistogramResponse {
  counts: number[]
  bin_edges: number[]
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function getSummaryStatistics(req: SummaryRequest): Promise<SummaryResponse> {
  const res = await api.post<SummaryResponse>('/descriptive/summary', req)
  return res.data
}

export async function getFrequencyTable(req: FrequencyRequest): Promise<FrequencyResponse> {
  const res = await api.post<FrequencyResponse>('/descriptive/frequency', req)
  return res.data
}

export async function getContingencyTable(req: ContingencyRequest): Promise<ContingencyResponse> {
  const res = await api.post<ContingencyResponse>('/descriptive/contingency', req)
  return res.data
}

export async function getRunChart(req: RunChartRequest): Promise<RunChartResponse> {
  const res = await api.post<RunChartResponse>('/descriptive/runchart', req)
  return res.data
}

export async function getBoxplot(req: BoxplotRequest): Promise<BoxplotResponse> {
  const res = await api.post<BoxplotResponse>('/descriptive/boxplot', req)
  return res.data
}

export async function getHistogram(req: HistogramRequest): Promise<HistogramResponse> {
  const res = await api.post<HistogramResponse>('/descriptive/histogram', req)
  return res.data
}
