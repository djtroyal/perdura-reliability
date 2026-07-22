import { useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, BrainCircuit, CheckCircle2, ChevronRight, Download, FileJson,
  Gauge, Play, Plus, RotateCcw, ShieldCheck, SlidersHorizontal, Square, Upload,
} from 'lucide-react'
import Plot from '../shared/ExportablePlot'
import InfoLabel from '../shared/InfoLabel'
import ConfidenceInput from '../shared/ConfidenceInput'
import StaleBanner from '../shared/StaleBanner'
import ExportResultsButton from '../shared/ExportResultsButton'
import GenerateColumnPanel from '../shared/GenerateColumnPanel'
import ModelDataGrid, { GridRow } from './ModelDataGrid'
import { parseCsv } from '../shared/parseCsv'
import { useModuleState } from '../../store/project'
import { useSharedDataset, INITIAL_DATASET } from '../DataAnalysis/shared'
import {
  evaluateModelsStream, exportOnnx, finalizeModel, scoreModel,
  type ModelAsset, type ModelingEvaluateRequest, type ModelingModel,
  type ModelingProgress, type ModelingRun, type ModelingTask, type ModelResult,
  type ScoreResponse,
} from '../../api/modeling'
import {
  CLASSIFICATION_DEFAULTS, INITIAL_MODELING_WORKFLOW, REGRESSION_DEFAULTS,
  modelsForTask, normalizeModelingState, selectionMetricForTask,
  type ModelingStage, type ModelingWorkflowState,
} from './workflowState'
import { useHelpTopic } from '../help/context'
import { handleTabKey } from '../shared/tabKeyboard'
import { downloadArtifact } from '../../store/artifactExport'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlotlyLayout = any

const MODEL_GROUPS: { name: string; models: { id: ModelingModel; label: string; note: string }[] }[] = [
  { name: 'Interpretable baselines', models: [
    { id: 'linear', label: 'Linear (OLS)', note: 'Regression baseline with separate coefficient inference.' },
    { id: 'logistic', label: 'Logistic', note: 'Binary classification with odds-ratio inference.' },
    { id: 'ridge', label: 'Ridge', note: 'L2-shrunk linear model.' },
    { id: 'lasso', label: 'Lasso', note: 'L1 sparse linear model.' },
    { id: 'elastic_net', label: 'Elastic Net', note: 'Combined L1/L2 shrinkage.' },
    { id: 'polynomial', label: 'Polynomial', note: 'Curved single-predictor regression.' },
  ] },
  { name: 'Trees and ensembles', models: [
    { id: 'decision_tree', label: 'Decision Tree', note: 'Interpretable CART tree.' },
    { id: 'chaid', label: 'CHAID', note: 'Multiway chi-square classification tree.' },
    { id: 'random_forest', label: 'Random Forest', note: 'Bagged tree ensemble.' },
    { id: 'gradient_boosting', label: 'Gradient Boosting', note: 'Sequential boosted trees.' },
    { id: 'hist_gradient_boosting', label: 'Histogram Gradient Boosting', note: 'Fast regularized boosting.' },
    { id: 'adaboost', label: 'AdaBoost', note: 'Adaptive weak-learner ensemble.' },
  ] },
  { name: 'Other predictive models', models: [
    { id: 'svm', label: 'Support Vector Machine', note: 'Scaled kernel model.' },
    { id: 'knn', label: 'k-Nearest Neighbors', note: 'Scaled local-neighborhood model.' },
    { id: 'mlp', label: 'MLP Neural Network', note: 'Feed-forward nonlinear model.' },
  ] },
]

const REGRESSION_METRICS = [
  ['rmse', 'RMSE (lower is better)'], ['mae', 'MAE (lower is better)'],
  ['median_absolute_error', 'Median absolute error'], ['r2', 'R² (higher is better)'],
] as const
const CLASSIFICATION_METRICS = [
  ['balanced_accuracy', 'Balanced accuracy'], ['accuracy', 'Accuracy'],
  ['f1_macro', 'Macro F1'], ['recall_macro', 'Macro recall'],
  ['precision_macro', 'Macro precision'], ['roc_auc', 'ROC AUC (binary)'],
  ['average_precision', 'Average precision (binary)'], ['log_loss', 'Log loss'],
  ['brier_score', 'Brier score'], ['expected_cost', 'Expected decision cost'],
] as const
const MULTICLASS_METRICS = new Set([
  'balanced_accuracy', 'accuracy', 'f1_macro', 'recall_macro', 'precision_macro',
  'log_loss',
])

const PLOT_BG = { paper_bgcolor: 'white', plot_bgcolor: 'white' }
const pretty = (value: string) => value.replace(/_/g, ' ')

function fmt(value: number | null | undefined, digits = 4) {
  if (value == null || !Number.isFinite(value)) return '—'
  if (value !== 0 && (Math.abs(value) >= 1e5 || Math.abs(value) < 1e-3)) return value.toExponential(3)
  return value.toFixed(digits)
}

function downloadBlob(blob: Blob, filename: string) {
  return downloadArtifact(blob, filename, blob.type || 'application/octet-stream', {
    kind: 'modeling-artifact', moduleKey: 'dataModeling',
  })
}

function modelCardExport(asset: ModelAsset) {
  const artifact = { ...asset.artifact } as Record<string, unknown>
  delete artifact.bytes_base64
  return {
    schema_version: asset.schema_version,
    asset_id: asset.asset_id,
    name: asset.name,
    created_at: asset.created_at,
    task: asset.task,
    model: asset.model,
    model_label: asset.model_label,
    schema: asset.schema,
    selected_params: asset.selected_params,
    validation: asset.validation,
    selection_metric: asset.selection_metric,
    metrics: asset.metrics,
    calibration_state: asset.calibration_state,
    threshold: asset.threshold,
    conformal: asset.conformal,
    fit_diagnostics: asset.fit_diagnostics,
    warnings: asset.warnings,
    versions: asset.versions,
    artifact,
    model_card: asset.model_card,
    dataset_fingerprint: asset.rebuild_recipe.dataset_fingerprint,
    note: 'Training rows and executable model bytes are intentionally omitted from this model-card export.',
  }
}

function errorDetail(error: unknown) {
  const candidate = error as { response?: { data?: { detail?: string } }; message?: string; name?: string }
  if (candidate.name === 'AbortError') return 'Modeling run cancelled.'
  return candidate.response?.data?.detail ?? candidate.message ?? 'The modeling operation failed.'
}

export default function EnhancedDataModeling() {
  const [rawState, setRawState] = useModuleState<unknown>('dataModeling', INITIAL_MODELING_WORKFLOW)
  const state = normalizeModelingState(rawState)
  const contextualHelpTopic = state.stage === 'diagnose' && state.selectedModel
    ? `dataAnalysis.${state.selectedModel}`
    : state.stage === 'finalize'
      ? 'dataAnalysis.finalization'
      : 'dataAnalysis.regression_ml_workflow'
  useHelpTopic(contextualHelpTopic, 10)
  const [data, setData] = useSharedDataset()
  const [busy, setBusy] = useState<'evaluate' | 'finalize' | 'score' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<ModelingProgress | null>(null)
  const [scoreRows, setScoreRows] = useState<Record<string, string>>({})
  const [batchText, setBatchText] = useState('')
  const [scoreResult, setScoreResult] = useState<ScoreResponse | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const csvRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const patch = (updates: Partial<ModelingWorkflowState>) =>
    setRawState({ ...state, ...updates, schemaVersion: 2 })

  const columns = data.columns
  const rows = data.rows
  const columnProfiles = useMemo(() => Object.fromEntries(columns.map(column => {
    const values = rows.map(row => String(row[column] ?? '').trim()).filter(Boolean)
    return [column, {
      values,
      numeric: values.length > 0 && values.every(value => Number.isFinite(Number(value))),
    }]
  })), [columns, rows]) as Record<string, { values: string[]; numeric: boolean }>
  const classes = useMemo(
    () => [...new Set(columnProfiles[state.target]?.values ?? [])].sort(),
    [columnProfiles, state.target],
  )
  const effectivePositiveClass = classes.includes(state.positiveClass)
    ? state.positiveClass : (classes[1] ?? classes[0] ?? '')
  const classificationMetrics = classes.length === 2
    ? CLASSIFICATION_METRICS
    : CLASSIFICATION_METRICS.filter(([key]) => MULTICLASS_METRICS.has(key))
  const effectiveSelectionMetric = state.task === 'classification'
    && !classificationMetrics.some(([key]) => key === state.selectionMetric)
    ? 'balanced_accuracy'
    : state.selectionMetric
  const compatibleModels = useMemo(() => new Set(modelsForTask(
    state.task,
    MODEL_GROUPS.flatMap(group => group.models.map(model => model.id)),
  )), [state.task])
  const numericColumn = (column: string) => columnProfiles[column]?.numeric ?? false
  const analysisSignature = useMemo(() => JSON.stringify({
    data, target: state.target, features: state.features, task: state.task,
    models: state.models, missingPolicy: state.missingPolicy,
    validationStrategy: state.validationStrategy, groupColumn: state.groupColumn,
    timeColumn: state.timeColumn, tuningBudget: state.tuningBudget, seed: state.seed,
    selectionMetric: effectiveSelectionMetric, positiveClass: effectivePositiveClass,
    useDecisionCosts: state.useDecisionCosts,
    falsePositiveCost: state.falsePositiveCost, falseNegativeCost: state.falseNegativeCost,
    calibration: state.calibration, confidence: state.confidence,
  }), [
    data, state.target, state.features, state.task, state.models, state.missingPolicy,
    state.validationStrategy, state.groupColumn, state.timeColumn, state.tuningBudget,
    state.seed, effectiveSelectionMetric, effectivePositiveClass, state.useDecisionCosts,
    state.falsePositiveCost, state.falseNegativeCost, state.calibration, state.confidence,
  ])
  const stale = !!state.run && state.dataSig !== analysisSignature
  const selected = state.run?.models.find(model => model.model === state.selectedModel) ?? null

  const patchTask = (task: ModelingTask) => patch({
    task,
    models: modelsForTask(task, state.models),
    selectionMetric: selectionMetricForTask(task, state.selectionMetric),
    positiveClass: task === 'classification' ? (classes[1] ?? classes[0] ?? '') : '',
    calibration: task === 'classification' ? state.calibration : 'none',
  })

  const onColumnsChange = (nextColumns: string[], nextRows: GridRow[]) => {
    const target = nextColumns.includes(state.target) ? state.target : (nextColumns[nextColumns.length - 1] ?? '')
    const features = state.features.filter(feature => nextColumns.includes(feature) && feature !== target)
    setData({ columns: nextColumns, rows: nextRows })
    patch({ target, features })
  }

  const importCsv = async (file: File) => {
    try {
      const parsed = await parseCsv(file)
      if (!parsed.headers.length || !parsed.rows.length) throw new Error('CSV requires headers and data rows.')
      const nextRows = parsed.rows.map(row => Object.fromEntries(
        parsed.headers.map(header => [header, String(row[header] ?? '').trim()]),
      ))
      const target = parsed.headers[parsed.headers.length - 1] ?? ''
      setData({ columns: parsed.headers, rows: nextRows })
      patch({ target, features: parsed.headers.filter(column => column !== target) })
      setError(null)
    } catch (cause) { setError(errorDetail(cause)) }
  }

  const buildRequest = (): ModelingEvaluateRequest => {
    const required = new Set([state.target, ...state.features])
    if (state.validationStrategy === 'group' && state.groupColumn) required.add(state.groupColumn)
    if (state.validationStrategy === 'time' && state.timeColumn) required.add(state.timeColumn)
    const payload: Record<string, (string | number | null)[]> = {}
    for (const column of required) {
      payload[column] = rows.map(row => {
        const value = String(row[column] ?? '').trim()
        return value === '' ? null : value
      })
    }
    return {
      data: payload,
      target: state.target,
      features: state.features,
      task: state.task,
      models: state.models.map(model => ({ model, tune: true })),
      missing_policy: state.missingPolicy,
      validation: {
        strategy: state.validationStrategy,
        group_column: state.validationStrategy === 'group' ? state.groupColumn : null,
        time_column: state.validationStrategy === 'time' ? state.timeColumn : null,
        budget: state.tuningBudget,
        seed: state.seed,
      },
      selection_metric: effectiveSelectionMetric,
      positive_class: state.task === 'classification' && classes.length === 2
        ? effectivePositiveClass : null,
      costs: state.task === 'classification' && state.useDecisionCosts
        ? { false_positive: state.falsePositiveCost, false_negative: state.falseNegativeCost }
        : null,
      calibration: state.task === 'classification' && classes.length === 2 ? state.calibration : 'none',
      confidence: state.confidence,
      metric_resamples: state.tuningBudget === 'quick' ? 100 : state.tuningBudget === 'thorough' ? 500 : 200,
    }
  }

  const runEvaluation = async () => {
    setError(null); setScoreResult(null); setBusy('evaluate'); setProgress(null)
    const controller = new AbortController(); abortRef.current = controller
    try {
      const request = buildRequest()
      const run = await evaluateModelsStream(request, setProgress, controller.signal)
      const selectedModel = run.recommended_model ?? run.models.find(model => model.status === 'eligible')?.model ?? null
      patch({ run, selectedModel, finalized: null, dataSig: analysisSignature, stage: 'compare' })
    } catch (cause) {
      setError(errorDetail(cause))
    } finally {
      abortRef.current = null; setBusy(null); setProgress(null)
    }
  }

  const finalizeSelected = async () => {
    if (!selected || stale) return
    setBusy('finalize'); setError(null)
    try {
      const asset = await finalizeModel(buildRequest(), selected)
      patch({
        finalized: asset,
        assets: [...state.assets.filter(item => item.asset_id !== asset.asset_id), asset],
        stage: 'finalize',
      })
      setScoreRows(Object.fromEntries(asset.schema.features.map(feature => [feature, defaultScoreValue(feature)])))
    } catch (cause) { setError(errorDetail(cause)) }
    finally { setBusy(null) }
  }

  const defaultScoreValue = (feature: string) => {
    const values = columnProfiles[feature]?.values ?? []
    if (numericColumn(feature)) {
      const sorted = values.map(Number).sort((a, b) => a - b)
      return String(sorted[Math.floor(sorted.length / 2)] ?? 0)
    }
    return values[0] ?? ''
  }

  const runSingleScore = async () => {
    if (!state.finalized) return
    setBusy('score'); setError(null)
    try {
      setScoreResult(await scoreModel(state.finalized, [scoreRows]))
    } catch (cause) { setError(errorDetail(cause)) }
    finally { setBusy(null) }
  }

  const parsedBatch = () => {
    if (!state.finalized) return []
    const lines = batchText.replace(/\r/g, '').split('\n').map(line => line.trim()).filter(Boolean)
    if (!lines.length) return []
    const delimiter = lines[0].includes('\t') ? '\t' : ','
    const headers = lines[0].split(delimiter).map(value => value.trim())
    const missing = state.finalized.schema.features.filter(feature => !headers.includes(feature))
    if (missing.length) throw new Error(`Batch header is missing: ${missing.join(', ')}.`)
    return lines.slice(1).map(line => {
      const values = line.split(delimiter)
      return Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? '']))
    })
  }

  const runBatchScore = async () => {
    if (!state.finalized) return
    setBusy('score'); setError(null)
    try {
      const batch = parsedBatch()
      if (!batch.length) throw new Error('Paste a header and at least one scoring row.')
      setScoreResult(await scoreModel(state.finalized, batch))
    } catch (cause) { setError(errorDetail(cause)) }
    finally { setBusy(null) }
  }

  const downloadScoredCsv = () => {
    if (!scoreResult || !state.finalized) return
    const probabilityLabels = scoreResult.probabilities ? Object.keys(scoreResult.probabilities[0] ?? {}) : []
    const headers = ['prediction', ...probabilityLabels.map(label => `probability_${label}`),
      ...(scoreResult.intervals ? ['lower', 'upper'] : [])]
    const lines = scoreResult.predictions.map((prediction, index) => [
      prediction,
      ...probabilityLabels.map(label => scoreResult.probabilities?.[index]?.[label] ?? ''),
      ...(scoreResult.intervals ? [scoreResult.intervals[index].lower, scoreResult.intervals[index].upper] : []),
    ].join(','))
    downloadBlob(new Blob([[headers.join(','), ...lines].join('\n')], { type: 'text/csv' }),
      `${state.finalized.model}-predictions.csv`)
  }

  const stageEnabled = (stage: ModelingStage) => stage === 'prepare' || stage === 'compare'
    || (stage === 'diagnose' && !!selected)
    || (stage === 'finalize' && (!!selected || !!state.finalized || state.assets.length > 0))

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden bg-gray-50">
      <aside className="flex min-h-0 w-[25rem] min-w-[22rem] max-w-[30rem] flex-shrink-0 flex-col overflow-hidden border-r border-gray-200 bg-white">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <section>
          <div className="flex items-center justify-between mb-1">
            <InfoLabel tip="Rows are observations and columns are variables. Missing predictors can be imputed inside each validation fold.">Dataset</InfoLabel>
            <div className="flex gap-1">
              <input ref={csvRef} type="file" accept=".csv,text/csv,text/plain" className="hidden"
                onChange={event => { const file = event.target.files?.[0]; if (file) void importCsv(file); event.target.value = '' }} />
              <button onClick={() => csvRef.current?.click()} className="mini-button"><Upload size={11} /> CSV</button>
              <button onClick={() => { setData(INITIAL_DATASET); patch({ run: null, finalized: null, dataSig: null }) }}
                className="mini-button"><RotateCcw size={11} /> Reset</button>
            </div>
          </div>
          <ModelDataGrid columns={columns} rows={rows} onColumnsChange={onColumnsChange}
            onRowsChange={nextRows => setData({ columns, rows: nextRows })} maxBodyHeight="28vh" />
        </section>
        <GenerateColumnPanel columns={columns} rows={rows} setData={setData} onError={setError} defaultCollapsed />

        <section className="grid grid-cols-2 gap-3 border-t border-gray-200 pt-3">
          <label className="text-[11px] text-gray-600">Target
            <select value={state.target} onChange={event => patch({
              target: event.target.value,
              features: state.features.filter(feature => feature !== event.target.value),
            })} className="field mt-1">
              {columns.map(column => <option key={column}>{column}</option>)}
            </select>
          </label>
          <label className="text-[11px] text-gray-600">Task
            <select value={state.task} onChange={event => patchTask(event.target.value as ModelingTask)} className="field mt-1">
              <option value="regression">Regression</option>
              <option value="classification">Classification</option>
            </select>
          </label>
          <div className="col-span-2">
            <InfoLabel tip="Features are the inputs available when future predictions are made. Exclude IDs and post-outcome information.">Predictor features</InfoLabel>
            <div className="mt-1 max-h-32 overflow-y-auto rounded border border-gray-200 p-2 grid grid-cols-2 gap-1">
              {columns.filter(column => column !== state.target).map(column => (
                <label key={column} className="flex items-center gap-1.5 text-[11px] text-gray-700 min-w-0">
                  <input type="checkbox" checked={state.features.includes(column)} onChange={() => patch({
                    features: state.features.includes(column)
                      ? state.features.filter(feature => feature !== column)
                      : [...state.features, column],
                  })} />
                  <span className="truncate">{column}</span>
                  <span className="text-[9px] text-gray-400">{numericColumn(column) ? 'num' : 'cat'}</span>
                </label>
              ))}
            </div>
          </div>
        </section>

        <section className="space-y-3 border-t border-gray-200 pt-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-[11px] text-gray-600">Missing predictors
              <select value={state.missingPolicy} onChange={event => patch({ missingPolicy: event.target.value as ModelingWorkflowState['missingPolicy'] })} className="field mt-1">
                <option value="impute_indicator">Impute + indicators</option>
                <option value="impute">Median / most frequent</option>
                <option value="drop">Drop incomplete rows</option>
              </select>
            </label>
            <label className="text-[11px] text-gray-600">Validation structure
              <select value={state.validationStrategy} onChange={event => patch({ validationStrategy: event.target.value as ModelingWorkflowState['validationStrategy'] })} className="field mt-1">
                <option value="auto">Auto</option>
                <option value="random">Random folds</option>
                {state.task === 'classification' && <option value="stratified">Stratified folds</option>}
                <option value="group">Grouped entities</option>
                <option value="time">Forward in time</option>
              </select>
            </label>
          </div>
          {state.validationStrategy === 'group' && (
            <label className="text-[11px] text-gray-600 block">Entity/group column
              <select value={state.groupColumn} onChange={event => patch({ groupColumn: event.target.value })} className="field mt-1">
                <option value="">Select…</option>{columns.map(column => <option key={column}>{column}</option>)}
              </select>
            </label>
          )}
          {state.validationStrategy === 'time' && (
            <label className="text-[11px] text-gray-600 block">Time/order column
              <select value={state.timeColumn} onChange={event => patch({ timeColumn: event.target.value })} className="field mt-1">
                <option value="">Select…</option>{columns.map(column => <option key={column}>{column}</option>)}
              </select>
            </label>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="text-[11px] text-gray-600">Tuning budget
              <select value={state.tuningBudget} onChange={event => patch({ tuningBudget: event.target.value as ModelingWorkflowState['tuningBudget'] })} className="field mt-1">
                <option value="quick">Quick · 3×3 / 12</option>
                <option value="standard">Standard · 5×3 / 24</option>
                <option value="thorough">Thorough · 5×5 / 50</option>
              </select>
            </label>
            <label className="text-[11px] text-gray-600">Random seed
              <input type="number" min={0} step={1} value={state.seed} onChange={event => patch({ seed: Number(event.target.value) || 0 })} className="field mt-1 font-mono" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-[11px] text-gray-600">Selection metric
              <select value={effectiveSelectionMetric} onChange={event => patch({ selectionMetric: event.target.value })} className="field mt-1">
                {(state.task === 'regression' ? REGRESSION_METRICS : classificationMetrics).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            <label className="text-[11px] text-gray-600">Confidence
              <ConfidenceInput value={state.confidenceText} onChange={confidenceText => patch({ confidenceText })}
                onCommit={confidence => patch({ confidence, confidenceText: String(confidence) })} className="field mt-1" />
            </label>
          </div>
        </section>

        {state.task === 'classification' && (
          <section className="space-y-3 rounded-lg border border-blue-100 bg-blue-50/40 p-3">
            <p className="text-[11px] font-semibold text-blue-900">Probability and decision policy</p>
            {classes.length === 2 ? <>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-[11px] text-gray-600">Positive class
                  <select value={effectivePositiveClass} onChange={event => patch({ positiveClass: event.target.value })} className="field mt-1">
                    {classes.map(value => <option key={value}>{value}</option>)}
                  </select>
                </label>
                <label className="text-[11px] text-gray-600">Calibration
                  <select value={state.calibration} onChange={event => patch({ calibration: event.target.value as ModelingWorkflowState['calibration'] })} className="field mt-1">
                    <option value="none">None</option><option value="sigmoid">Sigmoid</option><option value="isotonic">Isotonic (large samples)</option>
                  </select>
                </label>
              </div>
              <label className="flex items-center gap-2 text-[11px] text-gray-700">
                <input type="checkbox" checked={state.useDecisionCosts} onChange={event => patch({ useDecisionCosts: event.target.checked,
                  selectionMetric: event.target.checked ? 'expected_cost' : selectionMetricForTask('classification') })} />
                Optimize with false-positive / false-negative costs
              </label>
              {state.useDecisionCosts && <div className="grid grid-cols-2 gap-3">
                <label className="text-[11px] text-gray-600">False-positive cost<input type="number" min={0} step="0.1" value={state.falsePositiveCost} onChange={event => patch({ falsePositiveCost: Number(event.target.value) })} className="field mt-1" /></label>
                <label className="text-[11px] text-gray-600">False-negative cost<input type="number" min={0} step="0.1" value={state.falseNegativeCost} onChange={event => patch({ falseNegativeCost: Number(event.target.value) })} className="field mt-1" /></label>
              </div>}
            </> : <p className="text-[10px] text-gray-600">Probability calibration and cost-tuned thresholds are available for binary targets. This target currently has {classes.length} classes.</p>}
          </section>
        )}

        <section className="border-t border-gray-200 pt-3">
          <div className="flex items-center justify-between mb-2">
            <InfoLabel tip="Each model is tuned only on inner folds and evaluated only on outer folds. Incompatible models fail individually without stopping the run.">Candidate models</InfoLabel>
            <div className="flex gap-1">
              <button className="mini-button" onClick={() => patch({ models: state.task === 'regression' ? REGRESSION_DEFAULTS : CLASSIFICATION_DEFAULTS })}>Defaults</button>
              <button className="mini-button" onClick={() => patch({ models: modelsForTask(state.task, MODEL_GROUPS.flatMap(group => group.models.map(model => model.id))) })}>All</button>
            </div>
          </div>
          <div className="space-y-2 rounded border border-gray-200 p-2">
            {MODEL_GROUPS.map(group => (
              <div key={group.name}>
                <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 mb-1">{group.name}</p>
                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                  {group.models.filter(model => compatibleModels.has(model.id)).map(model => (
                    <label key={model.id} title={`${model.label}: ${model.note}`}
                      className="flex min-w-0 items-center gap-1.5 rounded px-1 py-1 text-[11px] hover:bg-gray-50">
                      <input type="checkbox" checked={state.models.includes(model.id)} onChange={() => patch({ models: state.models.includes(model.id)
                        ? state.models.filter(value => value !== model.id) : [...state.models, model.id] })} />
                      <span className="min-w-0 text-gray-800">{model.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
        </div>

        <div className="flex-shrink-0 space-y-2 border-t border-gray-200 bg-white px-4 py-3">
          <button onClick={runEvaluation} disabled={busy !== null || !state.target || !state.features.length || !state.models.length}
            data-shortcut-primary data-shortcut-label="Compare and tune candidate models"
            title="Compare and tune candidate models (Ctrl/⌘+Enter)"
            className="w-full flex items-center justify-center gap-2 rounded bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50">
            {busy === 'evaluate' ? <><BrainCircuit size={15} className="animate-pulse" /> Evaluating models…</> : <><Play size={14} /> Compare & tune</>}
          </button>
          {busy === 'evaluate' && <ProgressPanel progress={progress} onCancel={() => abortRef.current?.abort()} />}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div role="tablist" aria-label="Regression and ML workflow" className="flex items-center border-b border-gray-200 bg-white px-4 pt-2">
          {(['prepare', 'compare', 'diagnose', 'finalize'] as ModelingStage[]).map((stage, index) => (
            <button key={stage} disabled={!stageEnabled(stage)} onClick={() => patch({ stage })}
              role="tab" aria-selected={state.stage === stage} tabIndex={state.stage === stage ? 0 : -1}
              data-tab-id={stage}
              onKeyDown={event => handleTabKey(event, {
                ids: (['prepare', 'compare', 'diagnose', 'finalize'] as ModelingStage[]).filter(stageEnabled),
                currentId: stage, onSelect: id => patch({ stage: id as ModelingStage }),
              })}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs capitalize ${state.stage === stage
                ? 'border-blue-600 font-semibold text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800 disabled:text-gray-300'}`}>
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-gray-100 text-[9px]">{index + 1}</span>
              {stage === 'compare' ? 'Compare & tune' : stage}
              {index < 3 && <ChevronRight size={11} className="text-gray-300" />}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 pb-1">
            {state.assets.length > 0 && <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700"><CheckCircle2 size={10} className="inline mr-1" />{state.assets.length} model asset{state.assets.length === 1 ? '' : 's'}</span>}
            <ExportResultsButton getElement={() => resultsRef.current} baseName="decision-grade-modeling" title="Regression & ML" />
          </div>
        </div>
        <StaleBanner show={stale} message="The data or modeling configuration changed after validation. Re-run before finalizing; an existing finalized asset remains immutable." onRerun={runEvaluation} />
        {error && <div className="mx-4 mt-3 flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{error}</div>}
        {state.legacyResultCount > 0 && !state.run && <div className="mx-4 mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">This analysis contains {state.legacyResultCount} pre-workflow fitted result(s). They require refitting under the unified out-of-sample contract before comparison, finalization, or export.</div>}

        <div ref={resultsRef} className="flex-1 overflow-y-auto p-4">
          {state.stage === 'prepare' && <PrepareView state={state} selectionMetric={effectiveSelectionMetric} columns={columns} rows={rows} run={state.run} />}
          {state.stage === 'compare' && <CompareView run={state.run} selectedModel={state.selectedModel}
            onSelect={model => patch({ selectedModel: model, finalized: null, stage: 'diagnose' })}
            metric={state.run?.selection_metric ?? effectiveSelectionMetric} />}
          {state.stage === 'diagnose' && <DiagnoseView model={selected} run={state.run} />}
          {state.stage === 'finalize' && <FinalizeView model={selected} asset={state.finalized} assets={state.assets} stale={stale}
            busy={busy} onFinalize={finalizeSelected} scoreRows={scoreRows} setScoreRows={setScoreRows}
            onSingleScore={runSingleScore} batchText={batchText} setBatchText={setBatchText}
            onBatchScore={runBatchScore} scoreResult={scoreResult} onDownloadScores={downloadScoredCsv}
            onSelectAsset={asset => {
              patch({ finalized: asset, stage: 'finalize' })
              setScoreRows(Object.fromEntries(asset.schema.features.map(feature => [feature, defaultScoreValue(feature)])))
              setScoreResult(null)
            }}
            onNewAsset={() => { patch({ finalized: null }); setScoreResult(null) }}
            onDownloadCard={() => state.finalized && downloadBlob(new Blob([JSON.stringify(modelCardExport(state.finalized), null, 2)], { type: 'application/json' }), `${state.finalized.model}-model-card.json`)}
            onDownloadOnnx={async () => { if (!state.finalized) return; try { downloadBlob(await exportOnnx(state.finalized), `${state.finalized.model}.onnx`) } catch (cause) { setError(errorDetail(cause)) } }} />}
        </div>
      </main>
    </div>
  )
}

function ProgressPanel({ progress, onCancel }: { progress: ModelingProgress | null; onCancel: () => void }) {
  let fraction = 0.02
  if (progress?.models_total && progress.models_done != null) {
    let withinModel = 0
    if (progress.stage === 'tuning' && progress.outer_fold && progress.outer_folds
        && progress.candidate && progress.candidates) {
      withinModel = ((progress.outer_fold - 1) + progress.candidate / progress.candidates)
        / (progress.outer_folds + 1)
    } else if (progress.stage === 'outer_validation' && progress.outer_fold && progress.outer_folds) {
      withinModel = progress.outer_fold / (progress.outer_folds + 1)
    } else if (progress.stage === 'model_complete') {
      withinModel = 0
    }
    fraction = (progress.models_done + withinModel) / progress.models_total
  }
  const detail = !progress ? 'Preparing folds…'
    : progress.stage === 'tuning' ? (progress.outer_fold && progress.outer_folds && progress.outer_fold > progress.outer_folds
      ? `${progress.model}: selecting final recipe · candidate ${progress.candidate}/${progress.candidates}`
      : `${progress.model}: candidate ${progress.candidate}/${progress.candidates}, outer fold ${progress.outer_fold}`)
      : progress.stage === 'outer_validation' ? `${progress.model}: validated outer fold ${progress.outer_fold}/${progress.outer_folds}`
        : progress.stage === 'model_complete' ? `${progress.model} complete · ${progress.models_done}/${progress.models_total} models`
          : 'Preparing validation…'
  return <div className="rounded border border-blue-200 bg-blue-50 p-2">
    <div className="mb-1 flex items-center justify-between text-[10px] text-blue-800"><span className="truncate">{detail}</span><button onClick={onCancel} className="ml-2 flex items-center gap-1 font-medium text-red-600"><Square size={9} />Cancel</button></div>
    <div className="h-1.5 overflow-hidden rounded bg-blue-100"><div className="h-full bg-blue-600 transition-all" style={{ width: `${Math.max(4, Math.min(100, fraction * 100))}%` }} /></div>
  </div>
}

function PrepareView({ state, selectionMetric, columns, rows, run }: { state: ModelingWorkflowState; selectionMetric: string; columns: string[]; rows: GridRow[]; run: ModelingRun | null }) {
  const readiness = run?.readiness
  const missing = state.features.reduce((sum, feature) => sum + rows.filter(row => !String(row[feature] ?? '').trim()).length, 0)
  const duplicates = new Set(rows.map(row => JSON.stringify(columns.map(column => row[column] ?? '')))).size
  return <div className="space-y-4">
    <header><h2 className="text-lg font-semibold text-gray-900">Prepare a trustworthy modeling dataset</h2><p className="text-xs text-gray-500">Declare what will be available at prediction time, then inspect data loss and leakage risks before comparing algorithms.</p></header>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <SummaryCard label="Rows" value={String(readiness?.n_rows_original ?? rows.length)} />
      <SummaryCard label="Eligible rows" value={String(readiness?.n_rows_eligible ?? 'Run audit')} accent />
      <SummaryCard label="Predictors" value={String(state.features.length)} />
      <SummaryCard label="Missing predictor cells" value={String(readiness ? Object.values(readiness.missing_by_feature).reduce((a, b) => a + b, 0) : missing)} />
      <SummaryCard label="Duplicate rows" value={String(readiness?.duplicate_rows ?? rows.length - duplicates)} />
    </div>
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Panel title="Modeling contract" icon={<ShieldCheck size={15} />}>
        <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2 text-xs">
          <dt className="text-gray-500">Task</dt><dd className="font-medium capitalize">{state.task}</dd>
          <dt className="text-gray-500">Target</dt><dd className="font-mono">{state.target}</dd>
          <dt className="text-gray-500">Features</dt><dd>{state.features.join(', ') || 'None selected'}</dd>
          <dt className="text-gray-500">Missing data</dt><dd>{pretty(state.missingPolicy)}</dd>
          <dt className="text-gray-500">Validation</dt><dd>{state.validationStrategy} · {state.tuningBudget} nested tuning</dd>
          <dt className="text-gray-500">Selection</dt><dd>{pretty(selectionMetric)}</dd>
        </dl>
      </Panel>
      <Panel title="Data readiness" icon={readiness?.status === 'ready' ? <CheckCircle2 size={15} className="text-green-600" /> : <AlertTriangle size={15} className="text-amber-500" />}>
        {!readiness ? <p className="text-xs text-gray-500">Run Compare & tune to execute the backend audit with the exact eligible-row and type rules.</p> : <>
          <div className="mb-2 flex flex-wrap gap-1.5">
            <Badge>{readiness.numeric_features.length} numeric</Badge><Badge>{readiness.categorical_features.length} categorical</Badge>
            <Badge>{readiness.dropped_missing_target} missing targets dropped</Badge><Badge>{readiness.leakage_warnings.length} leakage warning(s)</Badge>
          </div>
          {readiness.warnings.length ? <ul className="list-disc space-y-1 pl-4 text-[11px] text-amber-800">{readiness.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
            : <p className="text-xs text-green-700">No structural readiness warnings were detected.</p>}
        </>}
      </Panel>
    </div>
  </div>
}

function CompareView({ run, selectedModel, onSelect, metric }: { run: ModelingRun | null; selectedModel: ModelingModel | null; onSelect: (model: ModelingModel) => void; metric: string }) {
  if (!run) return <EmptyState icon={<SlidersHorizontal size={30} />} title="No comparable models yet" text="Configure candidates and run Compare & tune. The leaderboard will use one out-of-sample contract for every model." />
  const ordered = [...run.models].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
  const metricKeys = [...new Set([
    run.selection_metric,
    ...(run.task === 'regression'
      ? ['rmse', 'mae', 'r2']
      : ['balanced_accuracy', 'f1_macro', 'roc_auc', 'log_loss']),
  ])]
  return <div className="space-y-4">
    <header className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold text-gray-900">Nested-validation leaderboard</h2><p className="text-xs text-gray-500">Ranked only by {pretty(run.selection_metric)}. Intervals use {pretty(run.validation.metric_interval_method)}.</p></div><div className="text-right text-[10px] text-gray-500"><p>{run.validation.outer_folds_used} outer folds · {String(run.validation.strategy)} structure</p><p>{fmt(run.runtime_seconds, 1)} seconds</p></div></header>
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 text-gray-600"><tr><th className="px-3 py-2 text-center">Rank</th><th className="px-3 py-2 text-left">Model</th>{metricKeys.map(key => <th key={key} className="px-3 py-2 text-right">{pretty(key)}</th>)}<th className="px-3 py-2 text-center">Folds</th><th className="px-3 py-2 text-left">Status</th></tr></thead>
        <tbody>{ordered.map(model => {
          const chosen = selectedModel === model.model
          const recommended = run.recommended_model === model.model
          return <tr key={model.model} onClick={() => model.status === 'eligible' && onSelect(model.model)}
            className={`border-t border-gray-100 ${model.status !== 'eligible' ? 'bg-red-50/40 text-gray-400' : chosen ? 'bg-green-50 cursor-pointer' : 'cursor-pointer hover:bg-blue-50/50'}`}>
            <td className="px-3 py-2 text-center font-semibold">{model.rank ?? '—'}</td>
            <td className="px-3 py-2"><div className="font-medium text-gray-900">{model.label} {recommended && <span className="ml-1 rounded bg-green-100 px-1.5 py-0.5 text-[9px] text-green-700">Recommended</span>}</div>{model.status === 'eligible' && <div className="mt-0.5 text-[9px] text-gray-400">{fmt(model.runtime_seconds, 1)}s · click to diagnose</div>}</td>
            {metricKeys.map(key => <td key={key} className="px-3 py-2 text-right font-mono"><MetricCell metric={model.metrics?.[key]} primary={key === metric} /></td>)}
            <td className="px-3 py-2 text-center">{model.folds?.length ?? '—'}</td>
            <td className="max-w-xs px-3 py-2">{model.status === 'eligible' ? <span className={model.fit_diagnostics?.converged ? 'text-green-700' : 'text-amber-700'}>{model.fit_diagnostics?.converged ? 'Eligible' : 'Diagnostic'}</span> : <span title={model.reason} className="text-red-600">{model.status}: {model.reason}</span>}</td>
          </tr>
        })}</tbody>
      </table>
    </div>
    <Panel title="Fold stability" icon={<Gauge size={15} />}>
      <FoldPlot models={ordered.filter(model => model.status === 'eligible')} metric={run.selection_metric} />
    </Panel>
  </div>
}

function DiagnoseView({ model, run }: { model: ModelResult | null; run: ModelingRun | null }) {
  if (!model || !run) return <EmptyState icon={<Gauge size={30} />} title="Select an eligible model" text="Choose a leaderboard row to inspect its held-out behavior, uncertainty, explanations, and fitted settings." />
  const important = model.permutation_importance?.feature_names.map((name, index) => ({ name, mean: model.permutation_importance.mean[index], std: model.permutation_importance.std[index] })).sort((a, b) => b.mean - a.mean) ?? []
  const thresholdFolds = model.folds.filter(fold => fold.threshold_detail?.curve?.length)
  return <div className="space-y-4">
    <header className="flex items-start justify-between"><div><h2 className="text-lg font-semibold text-gray-900">{model.label}</h2><p className="text-xs text-gray-500">Outer-fold diagnostics · rank {model.rank ?? '—'} · parameters selected by inner validation</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-medium ${model.fit_diagnostics.converged ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{model.fit_diagnostics.converged ? 'Converged' : 'Review convergence'}</span></header>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">{Object.entries(model.metrics).slice(0, 6).map(([key, value]) => <SummaryCard key={key} label={pretty(key)} value={fmt(value.value)} sub={value.lower != null ? `${fmt(value.lower)} – ${fmt(value.upper)}` : undefined} accent={key === run.selection_metric} />)}</div>
    {(model.threshold != null || model.calibration_state) && <Panel title="Probability decision policy" icon={<SlidersHorizontal size={15} />}><div className="flex flex-wrap gap-2 text-xs"><Badge>Threshold {fmt(model.threshold)}</Badge><Badge>Calibration {String(model.calibration_state?.method ?? 'none')}</Badge><Badge>Positive class {run.data_schema.positive_class ?? '—'}</Badge></div><p className="mt-2 text-[10px] text-gray-500">Threshold selection was performed on inner-fold probabilities and evaluated only on outer folds.</p></Panel>}
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {run.task === 'regression' ? <>
        <PlotPanel title="Observed vs out-of-sample predicted"><ObservedPredicted diagnostics={model.diagnostics} /></PlotPanel>
        <PlotPanel title="Held-out residuals"><Residuals diagnostics={model.diagnostics} /></PlotPanel>
      </> : <>
        {model.diagnostics.confusion_matrix && <PlotPanel title="Confusion matrix"><Confusion diagnostic={model.diagnostics.confusion_matrix} /></PlotPanel>}
        {model.diagnostics.roc && <PlotPanel title="ROC curve"><Roc diagnostic={model.diagnostics.roc} /></PlotPanel>}
        {model.diagnostics.precision_recall && <PlotPanel title="Precision–recall curve"><PrecisionRecall diagnostic={model.diagnostics.precision_recall} /></PlotPanel>}
        {model.diagnostics.calibration && <PlotPanel title="Reliability diagram"><Calibration diagnostic={model.diagnostics.calibration} /></PlotPanel>}
        {thresholdFolds.length > 0 && <PlotPanel title="Inner-fold decision threshold sensitivity"><ThresholdSensitivity folds={thresholdFolds} selected={model.threshold} /></PlotPanel>}
      </>}
      {important.length > 0 && <PlotPanel title="Held-out permutation importance"><Importance values={important} /></PlotPanel>}
      {model.partial_dependence?.filter(item => item.grid && item.average).map(item => <PlotPanel key={item.feature} title={`Partial dependence / ICE — ${item.feature}`}><Dependence item={item} /></PlotPanel>)}
    </div>
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Panel title="Selected hyperparameters" icon={<SlidersHorizontal size={15} />}><pre className="overflow-x-auto whitespace-pre-wrap text-[11px] text-gray-700">{JSON.stringify(model.selected_params, null, 2)}</pre></Panel>
      <Panel title="Interpretation guardrails" icon={<ShieldCheck size={15} />}>
        <ul className="list-disc space-y-1 pl-4 text-[11px] text-gray-700">
          <li>Permutation importance measures performance loss when a raw feature is disrupted; it is not a causal effect.</li>
          <li>Partial dependence may describe implausible combinations when predictors are correlated.</li>
          {model.conformal && <li>Prediction band: {pretty(String(model.conformal.coverage_scope))}; formal finite-sample guarantee: {String(model.conformal.formal_finite_sample_guarantee)}.</li>}
          {model.warnings.map((warning, index) => <li key={index} className="text-amber-800">{warning}</li>)}
        </ul>
      </Panel>
    </div>
    {model.inference && <InferencePanel inference={model.inference} />}
  </div>
}

function FinalizeView({ model, asset, assets, stale, busy, onFinalize, scoreRows, setScoreRows, onSingleScore, batchText, setBatchText, onBatchScore, scoreResult, onDownloadScores, onSelectAsset, onNewAsset, onDownloadCard, onDownloadOnnx }: {
  model: ModelResult | null; asset: ModelAsset | null; assets: ModelAsset[]; stale: boolean; busy: string | null; onFinalize: () => void
  scoreRows: Record<string, string>; setScoreRows: (rows: Record<string, string>) => void; onSingleScore: () => void
  batchText: string; setBatchText: (text: string) => void; onBatchScore: () => void; scoreResult: ScoreResponse | null
  onDownloadScores: () => void; onSelectAsset: (asset: ModelAsset) => void; onNewAsset: () => void
  onDownloadCard: () => void; onDownloadOnnx: () => void
}) {
  if (!model && !asset && assets.length === 0) return <EmptyState icon={<ShieldCheck size={30} />} title="Choose a model before finalizing" text="Review an eligible model, then create an immutable scoring asset and model card." />
  return <div className="space-y-4">
    <header><h2 className="text-lg font-semibold text-gray-900">Finalize and predict</h2><p className="text-xs text-gray-500">Promote a validated recipe into an immutable project asset, then score new rows without using the live analysis table.</p></header>
    {assets.length > 0 && <Panel title="Saved model assets" icon={<ShieldCheck size={15} />}>
      <div className="flex flex-wrap gap-2">
        {[...assets].reverse().map(item => <button key={item.asset_id} onClick={() => onSelectAsset(item)}
          className={`rounded border px-2.5 py-1.5 text-left text-[11px] ${asset?.asset_id === item.asset_id ? 'border-green-400 bg-green-50 text-green-800' : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300'}`}>
          <span className="block font-medium">{item.model_label} · {item.schema.target}</span>
          <span className="block text-[9px] text-gray-400">{new Date(item.created_at).toLocaleString()}</span>
        </button>)}
      </div>
      {asset && model && <button className="mini-button mt-3" onClick={onNewAsset}><Plus size={11} /> Finalize current selection as another asset</button>}
    </Panel>}
    {!asset && model && <Panel title="Create model asset" icon={<ShieldCheck size={15} />}><p className="mb-3 text-xs text-gray-700">Finalize <strong>{model.label}</strong> using its selected parameters. Perdura refits the point model on all eligible rows, records the complete rebuild recipe, and attempts parity-checked ONNX conversion.</p><button disabled={stale || busy !== null} onClick={onFinalize} className="primary-button">{busy === 'finalize' ? 'Finalizing…' : 'Finalize selected model'}</button>{stale && <p className="mt-2 text-[10px] text-amber-700">Re-run validation before finalizing changed inputs.</p>}</Panel>}
    {asset && <>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Model card" icon={<FileJson size={15} />}><dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-2 text-xs"><dt className="text-gray-500">Asset</dt><dd className="font-mono">{asset.asset_id}</dd><dt className="text-gray-500">Model</dt><dd>{asset.model_label}</dd><dt className="text-gray-500">Target</dt><dd>{asset.schema.target}</dd><dt className="text-gray-500">Selection metric</dt><dd>{pretty(asset.selection_metric)}</dd>{asset.task === 'classification' && <><dt className="text-gray-500">Decision policy</dt><dd>{asset.threshold == null ? 'Estimator default' : `threshold ${fmt(asset.threshold, 3)}`} · {String(asset.calibration_state?.method ?? 'uncalibrated')}</dd></>}<dt className="text-gray-500">Dataset fingerprint</dt><dd className="truncate font-mono" title={asset.schema.dataset_fingerprint}>{asset.schema.dataset_fingerprint}</dd><dt className="text-gray-500">Created</dt><dd>{asset.created_at}</dd></dl><div className="mt-3 flex flex-wrap gap-2"><button className="secondary-button" onClick={onDownloadCard}><FileJson size={12} /> JSON model card</button>{asset.artifact.kind === 'onnx' && asset.artifact.available && <button className="secondary-button" onClick={onDownloadOnnx}><Download size={12} /> ONNX</button>}</div></Panel>
        <Panel title="Executable artifact" icon={asset.artifact.available ? <CheckCircle2 size={15} className="text-green-600" /> : <AlertTriangle size={15} className="text-amber-500" />}><p className="text-sm font-medium capitalize text-gray-900">{pretty(asset.artifact.kind)}</p>{asset.artifact.available ? <div className="mt-2 space-y-1 text-[11px] text-gray-600"><p>Ready for project scoring.</p>{asset.artifact.size_bytes && <p>Size: {(asset.artifact.size_bytes / 1024).toFixed(1)} KiB</p>}{asset.artifact.parity && <p>Parity checked on {asset.artifact.parity.rows} rows · passed.</p>}</div> : <p className="mt-2 text-[11px] text-amber-800">{asset.artifact.reason}</p>}<p className="mt-3 text-[10px] text-gray-400">Pickle and joblib imports are deliberately unsupported.</p></Panel>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Score one row" icon={<Play size={15} />}><div className="grid grid-cols-2 gap-3">{asset.schema.features.map(feature => <label key={feature} className="text-[11px] text-gray-600">{feature}<input value={scoreRows[feature] ?? ''} onChange={event => setScoreRows({ ...scoreRows, [feature]: event.target.value })} className="field mt-1 font-mono" /></label>)}</div><button disabled={!asset.artifact.available || busy !== null} onClick={onSingleScore} className="primary-button mt-3">{busy === 'score' ? 'Scoring…' : 'Score row'}</button></Panel>
        <Panel title="Batch score" icon={<Upload size={15} />}><p className="mb-1 text-[10px] text-gray-500">Paste CSV/TSV with header: {asset.schema.features.join(', ')}</p><textarea value={batchText} onChange={event => setBatchText(event.target.value)} rows={6} className="w-full rounded border border-gray-300 p-2 font-mono text-xs" placeholder={`${asset.schema.features.join(',')}\n${asset.schema.features.map(() => 'value').join(',')}`} /><button disabled={!asset.artifact.available || busy !== null} onClick={onBatchScore} className="primary-button mt-2">Score batch</button></Panel>
      </div>
      {scoreResult && <Panel title={`Scoring results — ${scoreResult.scored_rows} row(s)`} icon={<CheckCircle2 size={15} className="text-green-600" />}><div className="overflow-x-auto"><table className="w-full text-xs"><thead className="bg-gray-50"><tr><th className="px-2 py-1 text-left">Row</th><th className="px-2 py-1 text-left">Prediction</th><th className="px-2 py-1 text-left">Probabilities / interval</th></tr></thead><tbody>{scoreResult.predictions.slice(0, 100).map((prediction, index) => <tr key={index} className="border-t"><td className="px-2 py-1">{index + 1}</td><td className="px-2 py-1 font-mono font-semibold">{String(prediction)}</td><td className="px-2 py-1 font-mono text-gray-600">{scoreResult.probabilities?.[index] ? Object.entries(scoreResult.probabilities[index]).map(([key, value]) => `${key}: ${fmt(value)}`).join(' · ') : scoreResult.intervals?.[index] ? `[${fmt(scoreResult.intervals[index].lower)}, ${fmt(scoreResult.intervals[index].upper)}]` : '—'}</td></tr>)}</tbody></table></div><button className="secondary-button mt-3" onClick={onDownloadScores}><Download size={12} /> Download predictions CSV</button></Panel>}
    </>}
  </div>
}

function SummaryCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return <div className={`rounded-lg border bg-white px-3 py-2 ${accent ? 'border-blue-300 ring-1 ring-blue-100' : 'border-gray-200'}`}><p className="truncate text-[10px] uppercase tracking-wide text-gray-400">{label}</p><p className={`mt-0.5 font-mono text-lg font-semibold ${accent ? 'text-blue-700' : 'text-gray-900'}`}>{value}</p>{sub && <p className="font-mono text-[9px] text-gray-400">{sub}</p>}</div>
}

function Panel({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return <section className="rounded-lg border border-gray-200 bg-white p-4"><h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800">{icon}{title}</h3>{children}</section>
}
function PlotPanel({ title, children }: { title: string; children: React.ReactNode }) { return <section className="rounded-lg border border-gray-200 bg-white"><h3 className="px-3 pt-2 text-xs font-semibold text-gray-700">{title}</h3><div className="h-80">{children}</div></section> }
function Badge({ children }: { children: React.ReactNode }) { return <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] text-gray-600">{children}</span> }
function EmptyState({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) { return <div className="flex min-h-[28rem] flex-col items-center justify-center text-center text-gray-400"><div className="mb-3 text-blue-300">{icon}</div><h2 className="text-base font-semibold text-gray-700">{title}</h2><p className="mt-1 max-w-md text-xs">{text}</p></div> }

function MetricCell({ metric, primary }: { metric?: { value: number; lower: number | null; upper: number | null }; primary?: boolean }) {
  if (!metric) return <>—</>
  return <div className={primary ? 'font-semibold text-blue-700' : ''}><div>{fmt(metric.value)}</div>{metric.lower != null && <div className="text-[9px] font-normal text-gray-400">{fmt(metric.lower)}–{fmt(metric.upper)}</div>}</div>
}

function FoldPlot({ models, metric }: { models: ModelResult[]; metric: string }) {
  return <Plot data={models.map((model, index) => ({ x: model.folds.map(fold => fold.fold), y: model.folds.map(fold => fold.metrics[metric]), type: 'scatter', mode: 'lines+markers', name: model.label, line: { width: 1.5 }, marker: { size: 6 }, legendrank: index })) as Plotly.Data[]}
    layout={{ ...PLOT_BG, margin: { t: 10, r: 20, b: 45, l: 55 }, xaxis: { title: { text: 'Outer fold' }, dtick: 1, gridcolor: '#e5e7eb' }, yaxis: { title: { text: pretty(metric) }, gridcolor: '#e5e7eb' }, legend: { orientation: 'h', y: -0.25 } } as PlotlyLayout} config={{ responsive: true }} style={{ width: '100%', height: 320 }} useResizeHandler />
}

function ObservedPredicted({ diagnostics }: { diagnostics: ModelResult['diagnostics'] }) {
  const data = diagnostics.observed_predicted!
  const lo = Math.min(...data.observed, ...data.predicted), hi = Math.max(...data.observed, ...data.predicted)
  const traces: Plotly.Data[] = []
  if (data.lower && data.upper) traces.push({ x: data.observed, y: data.upper, mode: 'markers', marker: { opacity: 0 }, error_y: { type: 'data', symmetric: false, array: data.upper.map((upper, i) => upper - data.predicted[i]), arrayminus: data.predicted.map((predicted, i) => predicted - data.lower![i]), color: '#93c5fd', thickness: 1 }, name: 'Prediction band' } as Plotly.Data)
  traces.push({ x: data.observed, y: data.predicted, mode: 'markers', marker: { color: '#2563eb', size: 7 }, name: 'Held-out predictions' } as Plotly.Data, { x: [lo, hi], y: [lo, hi], mode: 'lines', line: { color: '#16a34a', dash: 'dash' }, name: 'Ideal' } as Plotly.Data)
  return <Plot data={traces} layout={{ ...PLOT_BG, margin: { t: 10, r: 20, b: 45, l: 55 }, xaxis: { title: { text: 'Observed' }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'Out-of-sample predicted' }, gridcolor: '#e5e7eb' } } as PlotlyLayout} config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler />
}
function Residuals({ diagnostics }: { diagnostics: ModelResult['diagnostics'] }) { const data = diagnostics.residuals!; return <Plot data={[{ x: data.predicted, y: data.residual, mode: 'markers', marker: { color: '#7c3aed', size: 7 } } as Plotly.Data, { x: [Math.min(...data.predicted), Math.max(...data.predicted)], y: [0, 0], mode: 'lines', line: { color: '#9ca3af', dash: 'dash' } } as Plotly.Data]} layout={{ ...PLOT_BG, margin: { t: 10, r: 20, b: 45, l: 55 }, showlegend: false, xaxis: { title: { text: 'Predicted' }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'Residual' }, gridcolor: '#e5e7eb' } } as PlotlyLayout} config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler /> }
function Confusion({ diagnostic }: { diagnostic: NonNullable<ModelResult['diagnostics']['confusion_matrix']> }) { return <Plot data={[{ z: diagnostic.raw, x: diagnostic.labels, y: diagnostic.labels, type: 'heatmap', colorscale: 'Blues', text: diagnostic.raw.map(row => row.map(String)), texttemplate: '%{text}', hovertemplate: 'pred %{x}<br>actual %{y}<br>%{z}<extra></extra>' } as unknown as Plotly.Data]} layout={{ ...PLOT_BG, margin: { t: 10, r: 30, b: 45, l: 55 }, xaxis: { title: { text: 'Predicted' } }, yaxis: { title: { text: 'Actual' }, autorange: 'reversed' } } as PlotlyLayout} config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler /> }
function Roc({ diagnostic }: { diagnostic: NonNullable<ModelResult['diagnostics']['roc']> }) { return <Plot data={[{ x: diagnostic.fpr, y: diagnostic.tpr, mode: 'lines', line: { color: '#2563eb', width: 2 }, name: 'Model' } as Plotly.Data, { x: [0, 1], y: [0, 1], mode: 'lines', line: { color: '#9ca3af', dash: 'dash' }, name: 'Chance' } as Plotly.Data]} layout={{ ...PLOT_BG, margin: { t: 10, r: 20, b: 45, l: 55 }, xaxis: { title: { text: 'False-positive rate' }, range: [0, 1], gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'True-positive rate' }, range: [0, 1], gridcolor: '#e5e7eb' } } as PlotlyLayout} config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler /> }
function PrecisionRecall({ diagnostic }: { diagnostic: NonNullable<ModelResult['diagnostics']['precision_recall']> }) { return <Plot data={[{ x: diagnostic.recall, y: diagnostic.precision, mode: 'lines', line: { color: '#7c3aed', width: 2 } } as Plotly.Data]} layout={{ ...PLOT_BG, margin: { t: 10, r: 20, b: 45, l: 55 }, showlegend: false, xaxis: { title: { text: 'Recall' }, range: [0, 1], gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'Precision' }, range: [0, 1], gridcolor: '#e5e7eb' } } as PlotlyLayout} config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler /> }
function Calibration({ diagnostic }: { diagnostic: NonNullable<ModelResult['diagnostics']['calibration']> }) { return <Plot data={[{ x: diagnostic.mean_probability, y: diagnostic.observed_frequency, mode: 'lines+markers', line: { color: '#2563eb' }, name: 'Observed' } as Plotly.Data, { x: [0, 1], y: [0, 1], mode: 'lines', line: { color: '#9ca3af', dash: 'dash' }, name: 'Perfect' } as Plotly.Data]} layout={{ ...PLOT_BG, margin: { t: 10, r: 20, b: 45, l: 55 }, xaxis: { title: { text: 'Mean predicted probability' }, range: [0, 1], gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'Observed frequency' }, range: [0, 1], gridcolor: '#e5e7eb' } } as PlotlyLayout} config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler /> }
function ThresholdSensitivity({ folds, selected }: { folds: ModelResult['folds']; selected: number | null }) {
  const metric = folds[0]?.threshold_detail?.metric ?? 'selection metric'
  return <Plot data={folds.map(fold => ({
    x: fold.threshold_detail!.curve.map(point => point.threshold),
    y: fold.threshold_detail!.curve.map(point => point.selection_value),
    mode: 'lines', name: `Outer fold ${fold.fold}`, opacity: 0.7,
  } as Plotly.Data))} layout={{
    ...PLOT_BG, margin: { t: 10, r: 20, b: 45, l: 60 },
    xaxis: { title: { text: 'Decision threshold' }, range: [0, 1], gridcolor: '#e5e7eb' },
    yaxis: { title: { text: pretty(metric) }, gridcolor: '#e5e7eb' },
    legend: { orientation: 'h', y: -0.25 },
    shapes: selected == null ? [] : [{ type: 'line', xref: 'x', yref: 'paper', x0: selected, x1: selected, y0: 0, y1: 1, line: { color: '#dc2626', dash: 'dash', width: 2 } }],
    annotations: selected == null ? [] : [{ x: selected, y: 1, xref: 'x', yref: 'paper', text: `median ${fmt(selected, 3)}`, showarrow: false, xanchor: 'left', font: { size: 9, color: '#dc2626' } }],
  } as PlotlyLayout} config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler />
}
function Importance({ values }: { values: { name: string; mean: number; std: number }[] }) { return <Plot data={[{ x: values.map(value => value.mean).reverse(), y: values.map(value => value.name).reverse(), type: 'bar', orientation: 'h', marker: { color: '#2563eb' }, error_x: { type: 'data', array: values.map(value => value.std).reverse(), color: '#64748b' } } as Plotly.Data]} layout={{ ...PLOT_BG, margin: { t: 10, r: 30, b: 45, l: 110 }, showlegend: false, xaxis: { title: { text: 'Held-out score decrease' }, gridcolor: '#e5e7eb' } } as PlotlyLayout} config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler /> }
function Dependence({ item }: { item: ModelResult['partial_dependence'][number] }) { const traces: Plotly.Data[] = (item.individual ?? []).slice(0, 30).map(values => ({ x: item.grid, y: values, mode: 'lines', line: { color: 'rgba(147,197,253,.25)', width: 1 }, hoverinfo: 'skip', showlegend: false } as Plotly.Data)); traces.push({ x: item.grid, y: item.average, mode: 'lines', line: { color: '#dc2626', width: 3 }, name: 'Average' } as Plotly.Data); return <Plot data={traces} layout={{ ...PLOT_BG, margin: { t: 10, r: 20, b: 45, l: 55 }, xaxis: { title: { text: item.feature }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'Model response' }, gridcolor: '#e5e7eb' } } as PlotlyLayout} config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler /> }

function InferencePanel({ inference }: { inference: Record<string, unknown> }) {
  if (inference.status === 'unavailable') return <Panel title="Classical inference" icon={<AlertTriangle size={15} className="text-amber-500" />}><p className="text-xs text-amber-800">{String(inference.reason)}</p></Panel>
  const names = (inference.feature_names as string[] | undefined) ?? []
  const coefficients = (inference.coefficients as number[] | undefined) ?? []
  const pvalues = (inference.p_values as number[] | undefined) ?? []
  return <Panel title="Separate full-sample classical inference" icon={<Gauge size={15} />}><p className="mb-2 text-[10px] text-gray-500">These coefficient estimates describe the full-sample statistical fit. They are not the out-of-sample leaderboard metrics above.</p><div className="overflow-x-auto"><table className="w-full text-xs"><thead className="bg-gray-50"><tr><th className="px-2 py-1 text-left">Term</th><th className="px-2 py-1 text-right">Coefficient</th><th className="px-2 py-1 text-right">p-value</th></tr></thead><tbody>{names.map((name, index) => <tr key={name} className="border-t"><td className="px-2 py-1">{name}</td><td className="px-2 py-1 text-right font-mono">{fmt(coefficients[index])}</td><td className="px-2 py-1 text-right font-mono">{fmt(pvalues[index])}</td></tr>)}</tbody></table></div></Panel>
}
