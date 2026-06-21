// Model catalog and shared types for the unified Regression & ML module.

export type Task = 'regression' | 'classification'

export type ModelId =
  | 'linear' | 'ridge' | 'lasso' | 'polynomial' | 'logistic'
  | 'decision_tree' | 'random_forest' | 'gradient_boosting' | 'adaboost' | 'chaid'
  | 'svm' | 'knn' | 'mlp'

export type Backend = 'regression' | 'predictive'

export interface ParamField {
  key: string
  label: string
  type: 'number' | 'int' | 'bool' | 'select' | 'text'
  default: string | number | boolean
  options?: string[]
  min?: number
  max?: number
  step?: number
  help?: string
}

export interface ModelDef {
  id: ModelId
  label: string
  category: 'Classical Regression' | 'Trees & Ensembles' | 'Other ML' | 'Neural Network'
  backend: Backend
  tasks: Task[]
  /** Classical statistical models require numeric predictors & target. */
  numericOnly?: boolean
  /** Logistic regression needs a binary (2-class) target. */
  needsBinary?: boolean
  /** Polynomial regression takes exactly one predictor. */
  maxFeatures?: number
  params: ParamField[]
  blurb: string
}

export const MODEL_CATALOG: ModelDef[] = [
  // --- Classical Regression (statistical inference) ---
  {
    id: 'linear', label: 'Linear (OLS)', category: 'Classical Regression',
    backend: 'regression', tasks: ['regression'], numericOnly: true,
    params: [{ key: 'fit_intercept', label: 'Fit intercept', type: 'bool', default: true }],
    blurb: 'Ordinary least squares with full inference (SE, t, p, CIs, F-test).',
  },
  {
    id: 'ridge', label: 'Ridge (L2)', category: 'Classical Regression',
    backend: 'regression', tasks: ['regression'], numericOnly: true,
    params: [{ key: 'alpha', label: 'alpha (L2)', type: 'number', default: 1.0, min: 0, step: 0.1 }],
    blurb: 'L2-penalized linear regression; shrinks coefficients toward zero.',
  },
  {
    id: 'lasso', label: 'Lasso (L1)', category: 'Classical Regression',
    backend: 'regression', tasks: ['regression'], numericOnly: true,
    params: [{ key: 'alpha', label: 'alpha (L1)', type: 'number', default: 1.0, min: 0, step: 0.1 }],
    blurb: 'L1-penalized regression; performs automatic feature selection.',
  },
  {
    id: 'polynomial', label: 'Polynomial', category: 'Classical Regression',
    backend: 'regression', tasks: ['regression'], numericOnly: true, maxFeatures: 1,
    params: [{ key: 'degree', label: 'Degree', type: 'int', default: 2, min: 1, max: 10 }],
    blurb: 'Single-predictor polynomial fit with a fitted curve overlay.',
  },
  {
    id: 'logistic', label: 'Logistic', category: 'Classical Regression',
    backend: 'regression', tasks: ['classification'], numericOnly: true, needsBinary: true,
    params: [{ key: 'fit_intercept', label: 'Fit intercept', type: 'bool', default: true }],
    blurb: 'Binary logistic regression with odds ratios, ROC and McFadden R².',
  },

  // --- Trees & Ensembles ---
  {
    id: 'decision_tree', label: 'Decision Tree', category: 'Trees & Ensembles',
    backend: 'predictive', tasks: ['regression', 'classification'],
    params: [{ key: 'max_depth', label: 'Max depth', type: 'int', default: '', min: 1, help: 'blank = unlimited' }],
    blurb: 'A single CART tree; interpretable splits and feature importances.',
  },
  {
    id: 'random_forest', label: 'Random Forest', category: 'Trees & Ensembles',
    backend: 'predictive', tasks: ['regression', 'classification'],
    params: [
      { key: 'n_estimators', label: 'Trees', type: 'int', default: 100, min: 1 },
      { key: 'max_depth', label: 'Max depth', type: 'int', default: '', min: 1, help: 'blank = unlimited' },
    ],
    blurb: 'Bagged ensemble of trees; robust general-purpose model.',
  },
  {
    id: 'gradient_boosting', label: 'Gradient Boosting', category: 'Trees & Ensembles',
    backend: 'predictive', tasks: ['regression', 'classification'],
    params: [{ key: 'n_estimators', label: 'Stages', type: 'int', default: 100, min: 1 }],
    blurb: 'Boosted trees; often highest accuracy on tabular data.',
  },
  {
    id: 'adaboost', label: 'AdaBoost', category: 'Trees & Ensembles',
    backend: 'predictive', tasks: ['regression', 'classification'],
    params: [{ key: 'n_estimators', label: 'Estimators', type: 'int', default: 50, min: 1 }],
    blurb: 'Adaptive boosting of weak learners.',
  },
  {
    id: 'chaid', label: 'CHAID', category: 'Trees & Ensembles',
    backend: 'predictive', tasks: ['classification'],
    params: [{ key: 'max_depth', label: 'Max depth', type: 'int', default: 3, min: 1 }],
    blurb: 'Chi-square multiway classification tree (classification only).',
  },

  // --- Other ML ---
  {
    id: 'svm', label: 'SVM', category: 'Other ML',
    backend: 'predictive', tasks: ['regression', 'classification'],
    params: [
      { key: 'C', label: 'C', type: 'number', default: 1.0, min: 0, step: 0.1 },
      { key: 'kernel', label: 'Kernel', type: 'select', default: 'rbf', options: ['rbf', 'linear', 'poly', 'sigmoid'] },
    ],
    blurb: 'Support vector machine with kernel options.',
  },
  {
    id: 'knn', label: 'k-Nearest Neighbors', category: 'Other ML',
    backend: 'predictive', tasks: ['regression', 'classification'],
    params: [{ key: 'n_neighbors', label: 'Neighbors (k)', type: 'int', default: 5, min: 1 }],
    blurb: 'Instance-based learning from nearest neighbors.',
  },

  // --- Neural Network ---
  {
    id: 'mlp', label: 'MLP (Neural Net)', category: 'Neural Network',
    backend: 'predictive', tasks: ['regression', 'classification'],
    params: [
      { key: 'hidden_layer_sizes', label: 'Hidden layers', type: 'text', default: '100', help: 'comma-separated, e.g. 64,32' },
      { key: 'alpha', label: 'L2 alpha', type: 'number', default: 0.0001, min: 0, step: 0.0001 },
    ],
    blurb: 'Multi-layer perceptron (feed-forward neural network).',
  },
]

export const CATEGORIES = [
  'Classical Regression', 'Trees & Ensembles', 'Other ML', 'Neural Network',
] as const

export const PALETTE = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
]

export interface CompatCtx {
  task: Task
  nFeatures: number
  nClasses: number
  featuresNumeric: boolean
  targetNumeric: boolean
}

/** Whether a model can run on the current dataset/selection, with a reason. */
export function compatibility(m: ModelDef, ctx: CompatCtx): { ok: boolean; reason?: string } {
  if (!m.tasks.includes(ctx.task)) {
    return { ok: false, reason: `${m.label} is ${m.tasks.join(' / ')} only` }
  }
  // Regression-task models on the classical backend need a numeric target.
  // Classification models (e.g. logistic) accept a categorical target — the
  // backend label-encodes 2-class string targets automatically.
  if (m.backend === 'regression' && ctx.task === 'regression' && !ctx.targetNumeric) {
    return { ok: false, reason: 'needs a numeric target column' }
  }
  if (m.numericOnly && !ctx.featuresNumeric) {
    return { ok: false, reason: 'needs numeric predictor columns' }
  }
  if (m.needsBinary && ctx.nClasses !== 2) {
    return { ok: false, reason: `needs a binary target (found ${ctx.nClasses} classes)` }
  }
  if (m.maxFeatures != null && ctx.nFeatures > m.maxFeatures) {
    return { ok: false, reason: `supports at most ${m.maxFeatures} predictor` }
  }
  if (ctx.nFeatures < 1) {
    return { ok: false, reason: 'select at least one feature' }
  }
  return { ok: true }
}
