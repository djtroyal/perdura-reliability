import { api } from './client'

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

export type RegressionModel = 'linear' | 'ridge' | 'lasso' | 'logistic' | 'polynomial'

export interface FitRegressionRequest {
  model: RegressionModel
  data: Record<string, number[]>
  y: string
  x: string[]
  alpha?: number
  degree?: number
  fit_intercept?: boolean
}

// ---------------------------------------------------------------------------
// Response types — shared fields
// ---------------------------------------------------------------------------

interface BaseResult {
  model: string
  feature_names: string[]
  coefficients: number[]
  intercept: number | null
  fitted: number[]
  residuals: number[]
  r2: number
  rmse: number
}

export interface LinearResult extends BaseResult {
  std_errors: number[]
  t_values: number[]
  p_values: number[]
  conf_int: [number, number][]
  adj_r2: number
  f_stat: number | null
  f_pvalue: number | null
  n: number
  df_resid: number
}

export interface RidgeResult extends BaseResult {
  alpha: number
}

export interface LassoResult extends BaseResult {
  alpha: number
  n_nonzero: number
}

export interface LogisticResult extends BaseResult {
  std_errors: number[]
  z_values: number[]
  p_values: number[]
  odds_ratios: number[]
  conf_int: [number, number][]
  log_likelihood: number
  null_log_likelihood: number
  mcfadden_r2: number
  n_iter: number
  converged: boolean
  predicted_probabilities: number[]
  accuracy: number
  confusion_matrix: [[number, number], [number, number]]
  roc: { fpr: number[]; tpr: number[]; auc: number }
}

export interface PolynomialResult extends LinearResult {
  degree: number
  x_grid: number[]
  y_grid: number[]
  x_data: number[]
  y_data: number[]
}

export type FitRegressionResponse =
  | LinearResult
  | RidgeResult
  | LassoResult
  | LogisticResult
  | PolynomialResult

// ---------------------------------------------------------------------------
// API function
// ---------------------------------------------------------------------------

export async function fitRegression(
  req: FitRegressionRequest,
): Promise<FitRegressionResponse> {
  const res = await api.post<FitRegressionResponse>('/regression/fit', req)
  return res.data
}
