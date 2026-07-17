import type {
  CalibrationMethod, MissingPolicy, ModelAsset, ModelingModel, ModelingRun,
  ModelingTask, TuningBudget, ValidationStrategy,
} from '../../api/modeling'

export type ModelingStage = 'prepare' | 'compare' | 'diagnose' | 'finalize'

export interface ModelingWorkflowState {
  schemaVersion: 2
  stage: ModelingStage
  target: string
  features: string[]
  task: ModelingTask
  models: ModelingModel[]
  missingPolicy: MissingPolicy
  validationStrategy: ValidationStrategy
  groupColumn: string
  timeColumn: string
  tuningBudget: TuningBudget
  seed: number
  selectionMetric: string
  positiveClass: string
  useDecisionCosts: boolean
  falsePositiveCost: number
  falseNegativeCost: number
  calibration: CalibrationMethod
  confidence: number
  confidenceText: string
  run: ModelingRun | null
  selectedModel: ModelingModel | null
  finalized: ModelAsset | null
  /** Immutable scoring assets retained even when the analysis is re-run. */
  assets: ModelAsset[]
  dataSig: string | null
  /** Legacy pre-v2 model results remain inspectable only through this marker. */
  legacyResultCount: number
}

export const REGRESSION_DEFAULTS: ModelingModel[] = [
  'linear', 'ridge', 'lasso', 'elastic_net', 'decision_tree', 'random_forest',
  'gradient_boosting', 'hist_gradient_boosting', 'svm',
]

export const CLASSIFICATION_DEFAULTS: ModelingModel[] = [
  'logistic', 'decision_tree', 'random_forest', 'gradient_boosting',
  'hist_gradient_boosting', 'adaboost', 'svm',
]

export const INITIAL_MODELING_WORKFLOW: ModelingWorkflowState = {
  schemaVersion: 2,
  stage: 'prepare',
  target: 'y',
  features: ['x1', 'x2'],
  task: 'regression',
  models: REGRESSION_DEFAULTS,
  missingPolicy: 'impute_indicator',
  validationStrategy: 'auto',
  groupColumn: '',
  timeColumn: '',
  tuningBudget: 'standard',
  seed: 42,
  selectionMetric: 'rmse',
  positiveClass: '',
  useDecisionCosts: false,
  falsePositiveCost: 1,
  falseNegativeCost: 1,
  calibration: 'none',
  confidence: 0.95,
  confidenceText: '0.95',
  run: null,
  selectedModel: null,
  finalized: null,
  assets: [],
  dataSig: null,
  legacyResultCount: 0,
}

/** Merge project state with current defaults and identify legacy saved fits. */
export function normalizeModelingState(raw: unknown): ModelingWorkflowState {
  if (!raw || typeof raw !== 'object') return { ...INITIAL_MODELING_WORKFLOW }
  const value = raw as Partial<ModelingWorkflowState> & { fitted?: unknown[]; taskOverride?: string }
  if (value.schemaVersion === 2) {
    const assets = Array.isArray(value.assets)
      ? value.assets
      : value.finalized ? [value.finalized] : []
    return {
      ...INITIAL_MODELING_WORKFLOW,
      ...value,
      features: Array.isArray(value.features) ? value.features : INITIAL_MODELING_WORKFLOW.features,
      models: Array.isArray(value.models) ? value.models : INITIAL_MODELING_WORKFLOW.models,
      assets,
      legacyResultCount: value.legacyResultCount ?? 0,
    }
  }
  const inferredTask: ModelingTask = value.taskOverride === 'classification' ? 'classification' : 'regression'
  return {
    ...INITIAL_MODELING_WORKFLOW,
    target: typeof value.target === 'string' ? value.target : INITIAL_MODELING_WORKFLOW.target,
    features: Array.isArray(value.features) ? value.features : INITIAL_MODELING_WORKFLOW.features,
    task: inferredTask,
    models: inferredTask === 'classification' ? CLASSIFICATION_DEFAULTS : REGRESSION_DEFAULTS,
    legacyResultCount: Array.isArray(value.fitted) ? value.fitted.length : 0,
  }
}

export function modelsForTask(task: ModelingTask, selected: ModelingModel[]): ModelingModel[] {
  const allowed = task === 'classification'
    ? new Set< ModelingModel >([
      'logistic', 'decision_tree', 'random_forest', 'gradient_boosting',
      'hist_gradient_boosting', 'adaboost', 'chaid', 'svm', 'knn', 'mlp',
    ])
    : new Set< ModelingModel >([
      'linear', 'ridge', 'lasso', 'elastic_net', 'polynomial', 'decision_tree',
      'random_forest', 'gradient_boosting', 'hist_gradient_boosting', 'adaboost',
      'svm', 'knn', 'mlp',
    ])
  const compatible = selected.filter(model => allowed.has(model))
  return compatible.length
    ? compatible
    : (task === 'classification' ? CLASSIFICATION_DEFAULTS : REGRESSION_DEFAULTS)
}

export function selectionMetricForTask(task: ModelingTask, current?: string): string {
  const regression = new Set(['rmse', 'mae', 'median_absolute_error', 'r2'])
  const classification = new Set([
    'balanced_accuracy', 'accuracy', 'f1_macro', 'recall_macro', 'precision_macro',
    'roc_auc', 'average_precision', 'log_loss', 'brier_score', 'expected_cost',
  ])
  if (task === 'regression') return current && regression.has(current) ? current : 'rmse'
  return current && classification.has(current) ? current : 'balanced_accuracy'
}
