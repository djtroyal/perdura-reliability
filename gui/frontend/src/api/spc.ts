import { api } from './client'

export type ChartType = 'i_mr' | 'xbar_r' | 'xbar_s' | 'p' | 'np' | 'c' | 'u'

export interface ChartRequest {
  chart: ChartType
  data: number[] | number[][]
  sizes?: number[]
  phase?: 'single' | 'phase_i' | 'phase_ii'
  baseline_data?: number[] | number[][]
  baseline_sizes?: number[]
  phase_i_max_iterations?: number
  phase_i_remove_signals?: boolean
}

export interface Violation {
  index: number
  value: number
  rule: number
  description: string
}

export interface SubChart {
  name: string
  points: number[]
  indices: number[]
  labels: (number | string)[]
  cl: number | number[]
  ucl: number | number[]
  lcl: number | number[]
  violations: Violation[]
}

export interface ChartResponse {
  chart: string
  sigma?: number
  center?: number
  subcharts: SubChart[]
  workflow?: {
    phase: string
    limits_source: string
    limits_frozen: boolean
    status: string
    excluded_points?: number[]
    retained_points?: number[]
    warning?: string | null
    baseline_n?: number
    monitoring_n?: number
    baseline_status?: string
    baseline_signals?: Violation[]
  }
}

export async function computeChart(req: ChartRequest): Promise<ChartResponse> {
  const res = await api.post<ChartResponse>('/spc/chart', req)
  return res.data
}
