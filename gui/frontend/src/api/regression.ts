import { api } from './client'

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

export type RegressionModel = 'linear' | 'ridge' | 'lasso' | 'elastic_net' | 'logistic' | 'polynomial'

export interface FitRegressionRequest {
  model: RegressionModel
  data: Record<string, number[]>
  y: string
  x: string[]
  alpha?: number
  l1_ratio?: number
  degree?: number
  fit_intercept?: boolean
  CI?: number
  stability_selection?: boolean
  stability_pairs?: number
  stability_threshold?: number
  stability_lambdas?: number
  stability_seed?: number
}

// ---------------------------------------------------------------------------
// Response types — shared fields
// ---------------------------------------------------------------------------

export interface RegressionDiagnostics {
  std_residuals: number[]
  qq: { theoretical: number[]; sample: number[] }
  leverage: number[] | null
  cooks_d: number[] | null
  shapiro_p: number | null
  durbin_watson: number | null
  fitted: number[]
  matrix_rank?: number
  n_parameters?: number
  rank_deficient?: boolean
  aliased_terms?: string[]
  condition_number?: number | null
  condition_warning?: string | null
}

interface BaseResult {
  model: string
  feature_names: string[]
  coefficients: number[]
  intercept: number | null
  fitted: number[]
  residuals: number[]
  r2: number
  rmse: number
  CI?: number
  diagnostics?: RegressionDiagnostics
  converged?: boolean
  n_iter?: number
  convergence_warning?: string | null
  max_coefficient_change?: number
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
  selection_stability?: SelectionStabilityResult
}

export interface ElasticNetResult extends BaseResult {
  alpha: number
  l1_ratio: number
  n_nonzero: number
  selection_stability?: SelectionStabilityResult
}

export interface SelectionStabilityResult {
  method: string
  model: 'lasso' | 'elastic_net'
  feature_names: string[]
  lambda_path: number[]
  selection_threshold: number
  selection_probabilities: number[]
  selected_support: string[]
  selected_indices: number[]
  diagnostic_candidate_support: string[]
  diagnostic_candidate_indices: number[]
  support_eligible: boolean
  support_status: string
  selection_scope: string
  operating_point: {
    chosen_path_index: number
    chosen_lambda: number
    alpha_for_half_sample: number
    empirical_mean_selected_per_half_sample_q: number
    q_budget: number
    q_budget_met: boolean
    selection_rule: string
  }
  convergence: {
    all_fits_converged: boolean
    converged_fits: number
    total_fits: number
    [key: string]: unknown
  }
  selection_size_control: {
    method: string
    formal_error_bound: false
    plug_in_pfer_target: number
    plug_in_pfer_diagnostic: number
    plug_in_pfer_target_met: boolean
    q_budget: number
    empirical_mean_selected_per_half_sample_q: number
    diagnostic_note: string
    [key: string]: unknown
  }
  reproducibility: {
    random_seed: number
    n_pairs: number
    n_half_samples: number
    [key: string]: unknown
  }
  inference_note?: string
  [key: string]: unknown
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
  inference_valid: boolean
  convergence_warning: string | null
  predicted_probabilities: number[]
  accuracy: number
  confusion_matrix: [[number, number], [number, number]]
  roc: { fpr: number[]; tpr: number[]; auc: number }
  // Present when a 2-class string target was label-encoded: '0'/'1' -> label.
  class_mapping?: Record<string, string>
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
  | ElasticNetResult
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
