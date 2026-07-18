import { api } from './client'

export type ModelingTask = 'regression' | 'classification'
export type ValidationStrategy = 'auto' | 'random' | 'stratified' | 'group' | 'time'
export type MissingPolicy = 'drop' | 'impute' | 'impute_indicator'
export type TuningBudget = 'quick' | 'standard' | 'thorough'
export type CalibrationMethod = 'none' | 'sigmoid' | 'isotonic'
export type ModelingModel =
  | 'linear' | 'ridge' | 'lasso' | 'elastic_net' | 'polynomial' | 'logistic'
  | 'decision_tree' | 'random_forest' | 'gradient_boosting'
  | 'hist_gradient_boosting' | 'adaboost' | 'chaid' | 'svm' | 'knn' | 'mlp'

export interface ModelSpec {
  model: ModelingModel
  params?: Record<string, unknown>
  tune?: boolean
}

export interface ModelingEvaluateRequest {
  data: Record<string, (string | number | null)[]>
  target: string
  features: string[]
  task: ModelingTask
  models: ModelSpec[]
  missing_policy: MissingPolicy
  validation: {
    strategy: ValidationStrategy
    group_column?: string | null
    time_column?: string | null
    budget: TuningBudget
    outer_folds?: number | null
    inner_folds?: number | null
    candidates?: number | null
    seed: number
  }
  selection_metric?: string | null
  positive_class?: string | null
  costs?: { false_positive: number; false_negative: number } | null
  calibration: CalibrationMethod
  confidence: number
  metric_resamples?: number
}

export interface MetricInterval {
  value: number
  lower: number | null
  upper: number | null
  confidence: number
  resamples: number
}

export interface ModelingReadiness {
  n_rows_original: number
  n_rows_eligible: number
  dropped_missing_target: number
  dropped_missing_predictors: number
  missing_by_feature: Record<string, number>
  numeric_features: string[]
  categorical_features: string[]
  cardinality: Record<string, number>
  constant_features: string[]
  high_cardinality_features: string[]
  id_like_features: string[]
  duplicate_rows: number
  class_counts: Record<string, number> | null
  leakage_warnings: string[]
  warnings: string[]
  status: 'ready' | 'warning'
}

export interface FoldResult {
  fold: number
  n_train: number
  n_test: number
  metrics: Record<string, number>
  selected_params: Record<string, unknown>
  threshold: number | null
  calibration: Record<string, unknown> | null
  fit_diagnostics: {
    converged: boolean
    warnings: string[]
    n_iter: number | null
    max_iter: number | null
  }
  train_row_indices: number[]
  test_row_indices: number[]
  threshold_detail?: {
    metric: string
    curve: {
      threshold: number
      selection_value: number | null
      expected_cost: number | null
      recall_positive: number | null
      precision_positive: number | null
    }[]
    reason?: string
  } | null
}

export interface ModelResult {
  model: ModelingModel
  label: string
  status: 'eligible' | 'ineligible' | 'failed'
  reason?: string
  rank: number | null
  selection_metric: string
  metrics: Record<string, MetricInterval>
  folds: FoldResult[]
  selected_params: Record<string, unknown>
  oof: {
    row_indices: number[]
    actual: (string | number)[]
    actual_encoded: number[]
    predicted: (string | number)[]
    predicted_encoded: number[]
    probabilities: number[][] | null
  }
  diagnostics: {
    observed_predicted?: { observed: number[]; predicted: number[]; lower?: number[]; upper?: number[] }
    residuals?: { predicted: number[]; residual: number[] }
    confusion_matrix?: { labels: string[]; raw: number[][]; normalized: number[][] }
    roc?: { fpr: number[]; tpr: number[] }
    precision_recall?: { precision: number[]; recall: number[] }
    calibration?: { mean_probability: number[]; observed_frequency: number[] }
    threshold?: number | null
  }
  permutation_importance: {
    method: string
    feature_names: string[]
    mean: number[]
    std: number[]
    folds?: number
    scoring?: string
  }
  partial_dependence: {
    feature: string
    grid?: number[]
    average?: number[]
    individual?: number[][]
    error?: string
  }[]
  threshold: number | null
  calibration_state: Record<string, unknown> | null
  conformal: Record<string, unknown> | null
  fit_diagnostics: FoldResult['fit_diagnostics']
  inference: Record<string, unknown> | null
  warnings: string[]
  runtime_seconds: number
}

export interface ModelingRun {
  schema_version: 1
  task: ModelingTask
  selection_metric: string
  recommended_model: ModelingModel | null
  readiness: ModelingReadiness
  data_schema: {
    target: string
    features: string[]
    numeric_features: string[]
    categorical_features: string[]
    classes: string[] | null
    positive_class: string | null
    missing_policy: MissingPolicy
    dataset_fingerprint: string
  }
  validation: Record<string, unknown> & {
    strategy: Exclude<ValidationStrategy, 'auto'>
    outer_folds_used: number
    metric_interval_method: string
  }
  models: ModelResult[]
  versions: Record<string, string | null>
  runtime_seconds: number
}

export interface ModelingProgress {
  stage: string
  model?: ModelingModel
  outer_fold?: number
  outer_folds?: number
  candidate?: number
  candidates?: number
  models_done?: number
  models_total?: number
}

export interface ModelAsset {
  schema_version: 1
  asset_id: string
  name: string
  created_at: string
  task: ModelingTask
  model: ModelingModel
  model_label: string
  schema: ModelingRun['data_schema']
  selected_params: Record<string, unknown>
  validation: Record<string, unknown>
  selection_metric: string
  metrics: Record<string, MetricInterval>
  calibration_state: Record<string, unknown> | null
  threshold: number | null
  conformal: Record<string, unknown> | null
  fit_diagnostics: ModelResult['fit_diagnostics']
  warnings: string[]
  versions: Record<string, string | null>
  artifact: {
    kind: 'onnx' | 'native_chaid' | 'recipe'
    available: boolean
    reason?: string
    bytes_base64?: string
    size_bytes?: number
    parity?: { passed: boolean; rows: number; max_absolute_error: number | null }
    [key: string]: unknown
  }
  rebuild_recipe: Record<string, unknown>
  model_card: Record<string, unknown>
}

export interface ScoreResponse {
  asset_id: string
  task: ModelingTask
  model: ModelingModel
  scored_rows: number
  predictions: (string | number)[]
  probabilities: Record<string, number>[] | null
  intervals?: { lower: number; upper: number }[]
}

export const evaluateModels = (request: ModelingEvaluateRequest) =>
  api.post<ModelingRun>('/modeling/evaluate', request).then(response => response.data)

const streamError = (detail: string) =>
  Object.assign(new Error(detail), { response: { data: { detail } } })

export async function evaluateModelsStream(
  request: ModelingEvaluateRequest,
  onProgress?: (progress: ModelingProgress) => void,
  signal?: AbortSignal,
): Promise<ModelingRun> {
  const response = await fetch('/api/modeling/evaluate/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  })
  if (!response.ok || !response.body) {
    const detail = await response.json().catch(() => null)
    throw streamError(detail?.detail ?? 'The modeling run could not be started.')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) {
        const message = JSON.parse(line)
        if (message.type === 'progress') onProgress?.(message as ModelingProgress)
        else if (message.type === 'result') return message.payload as ModelingRun
        else if (message.type === 'error') throw streamError(message.detail ?? 'Modeling failed.')
        else if (message.type === 'cancelled') throw new DOMException('Modeling cancelled.', 'AbortError')
      }
      newline = buffer.indexOf('\n')
    }
  }
  if (signal?.aborted) throw new DOMException('Modeling cancelled.', 'AbortError')
  throw streamError('The modeling stream ended before returning results.')
}

export async function finalizeModel(
  evaluation: ModelingEvaluateRequest,
  result: ModelResult,
): Promise<ModelAsset> {
  const response = await api.post<ModelAsset>('/modeling/finalize', {
    evaluation,
    model: result.model,
    selected_params: result.selected_params,
    conformal: result.conformal,
    metrics: result.metrics,
    warnings: result.warnings,
  })
  return response.data
}

export async function scoreModel(
  asset: ModelAsset,
  rows: Record<string, string | number | null>[],
): Promise<ScoreResponse> {
  const response = await api.post<ScoreResponse>('/modeling/score', { asset, rows })
  return response.data
}

export async function exportOnnx(asset: ModelAsset): Promise<Blob> {
  const response = await api.post('/modeling/export/onnx', { asset }, { responseType: 'blob' })
  return response.data as Blob
}
