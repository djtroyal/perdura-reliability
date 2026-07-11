import { api } from './client'

export type ModelType = 'decision_tree' | 'chaid' | 'random_forest' | 'gradient_boosting' | 'svm' | 'knn' | 'adaboost' | 'mlp'
export type TaskType = 'classification' | 'regression'
export type SplitStrategy = 'auto' | 'random' | 'stratified' | 'group' | 'time'

export interface FitRequest {
  model: ModelType
  task?: TaskType
  data: Record<string, (string | number)[]>
  target: string
  features: string[]
  test_size?: number
  params?: Record<string, unknown>
  split_strategy?: SplitStrategy
  group_column?: string | null
  time_column?: string | null
  seed?: number
}

export interface CompareRequest {
  task?: TaskType
  data: Record<string, (string | number)[]>
  target: string
  features: string[]
  test_size?: number
  split_strategy?: SplitStrategy
  group_column?: string | null
  time_column?: string | null
  seed?: number
}

export interface CalibrationMetrics {
  available: boolean
  reason: string | null
  brier_score: number | null
  log_loss: number | null
  expected_calibration_error: number | null
  predicted_probability: number[]
  observed_frequency: number[]
}

export interface ClassMetrics {
  accuracy: number
  balanced_accuracy: number
  precision: number
  recall: number
  f1: number
  confusion_matrix: number[][]
  classes: string[]
  roc_auc?: number | null
  average_precision?: number | null
  calibration: CalibrationMetrics
}

export interface RegMetrics {
  r2: number
  rmse: number
  mae: number
}

export interface FitResponse {
  model: string
  task: TaskType
  metrics: ClassMetrics | RegMetrics
  feature_importances: Record<string, number> | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tree: any
  tree_text: string | null
  predictions: (string | number)[]
  actual: (string | number)[]
  n_train: number
  n_test: number
  prediction_scope: 'holdout'
  preprocessing: {
    numeric_features: string[]
    categorical_features: string[]
    categorical_encoding: string
    unknown_category_handling: string
    numeric_scaling: string
    rows_dropped_for_missing_values: number
  }
  validation: {
    strategy: Exclude<SplitStrategy, 'auto'>
    test_fraction: number
    seed: number | null
    n_train: number
    n_test: number
    group_overlap: boolean | null
    time_order_preserved: boolean | null
  }
  fit_diagnostics: {
    converged: boolean
    n_iter: number | null
    max_iter: number | null
    warnings: string[]
  }
}

export interface CompareRow {
  model: string
  cv_mean: number | null
  cv_std: number | null
  accuracy?: number
  f1?: number
  precision?: number
  recall?: number
  roc_auc?: number | null
  balanced_accuracy?: number
  brier_score?: number | null
  expected_calibration_error?: number | null
  converged?: boolean
  convergence_warnings?: string[]
  cv_folds_successful?: number
  r2?: number
  rmse?: number
  mae?: number
}

export interface CompareResponse {
  task: TaskType
  scoring: string
  comparison: CompareRow[]
  validation?: FitResponse['validation'] & { cv_strategy?: string; cv_folds_requested?: number }
  preprocessing?: FitResponse['preprocessing']
}

export interface PredictRequest {
  model: ModelType
  task?: TaskType
  data: Record<string, (string | number)[]>
  target: string
  features: string[]
  params?: Record<string, unknown>
  input: Record<string, string | number>
}

export interface PredictResponse {
  prediction: string | number
  task: TaskType
  probabilities?: Record<string, number>
}

export async function fitModel(req: FitRequest): Promise<FitResponse> {
  const res = await api.post<FitResponse>('/predictive/fit', req)
  return res.data
}

export async function predictModel(req: PredictRequest): Promise<PredictResponse> {
  const res = await api.post<PredictResponse>('/predictive/predict', req)
  return res.data
}

export interface PredictBatchRequest {
  model: ModelType
  task?: TaskType
  data: Record<string, (string | number)[]>
  target: string
  features: string[]
  params?: Record<string, unknown>
  inputs: Record<string, string | number>[]
}

export interface PredictBatchResponse {
  predictions: (string | number)[]
  task: TaskType
}

export async function predictBatchModel(req: PredictBatchRequest): Promise<PredictBatchResponse> {
  const res = await api.post<PredictBatchResponse>('/predictive/predict_batch', req)
  return res.data
}

export async function compareModels(req: CompareRequest): Promise<CompareResponse> {
  const res = await api.post<CompareResponse>('/predictive/compare', req)
  return res.data
}
