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
