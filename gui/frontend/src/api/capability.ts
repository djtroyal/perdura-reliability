import { api } from './client'

export interface CapabilityRequest {
  data: number[]
  lsl?: number | null
  usl?: number | null
  target?: number | null
  subgroup_size?: number
  n_bins?: number | null
}

export interface DefectRates {
  below_lsl: number | null
  above_usl: number | null
  total: number | null
}

export interface CapabilityResponse {
  n: number
  mean: number
  std_within: number
  std_overall: number
  r_bar: number
  subgroup_size: number
  lsl: number | null
  usl: number | null
  target: number | null
  Cp: number | null
  Cpk: number | null
  Pp_lower: number | null
  Pp_upper: number | null
  Ppk_lower: number | null
  Ppk_upper: number | null
  ci_level?: number
  Cpl: number | null
  Cpu: number | null
  Pp: number | null
  Ppk: number | null
  Ppl: number | null
  Ppu: number | null
  Cpm: number | null
  Z_lsl: number | null
  Z_usl: number | null
  Z_bench: number | null
  ppm_within: DefectRates
  ppm_overall: DefectRates
  observed: DefectRates & { n_below: number; n_above: number; n: number }
  histogram: {
    counts: number[]
    bin_edges: number[]
    bin_centers: number[]
    bin_width: number
  }
  normality: {
    test: string
    statistic: number | null
    p_value: number | null
    normal: boolean | null
  }
  normality_warning?: boolean
  normality_note?: string | null
  non_normal?: {
    method: string
    p0135: number
    median: number
    p99865: number
    Pp: number | null
    Ppk: number | null
    Ppl: number | null
    Ppu: number | null
    boxcox: {
      lambda: number
      lambda_rounded: number
      transform: string
      shapiro_p_transformed: number | null
      restores_normality: boolean
    } | null
    note: string | null
  } | null
  min: number
  max: number
}

export async function analyzeCapability(req: CapabilityRequest): Promise<CapabilityResponse> {
  const res = await api.post<CapabilityResponse>('/capability/analyze', req)
  return res.data
}
