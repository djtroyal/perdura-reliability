import { api } from './client'

export type ModelType = 'decision_tree' | 'chaid' | 'random_forest' | 'gradient_boosting' | 'svm' | 'knn' | 'adaboost' | 'mlp'
export type TaskType = 'classification' | 'regression'

export interface FitRequest {
  model: ModelType
  task?: TaskType
  data: Record<string, (string | number)[]>
  target: string
  features: string[]
  test_size?: number
  params?: Record<string, unknown>
}

export interface CompareRequest {
  task?: TaskType
  data: Record<string, (string | number)[]>
  target: string
  features: string[]
  test_size?: number
}

export interface ClassMetrics {
  accuracy: number
  precision: number
  recall: number
  f1: number
  confusion_matrix: number[][]
  classes: string[]
  roc_auc?: number | null
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
  r2?: number
  rmse?: number
  mae?: number
}

export interface CompareResponse {
  task: TaskType
  scoring: string
  comparison: CompareRow[]
}

export async function fitModel(req: FitRequest): Promise<FitResponse> {
  const res = await api.post<FitResponse>('/predictive/fit', req)
  return res.data
}

export async function compareModels(req: CompareRequest): Promise<CompareResponse> {
  const res = await api.post<CompareResponse>('/predictive/compare', req)
  return res.data
}
