import { useRef, useState } from 'react'
import Plot from 'react-plotly.js'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlotlyLayout = any
import { Play, GitCompare, Layers, Upload, X, Trash2 } from 'lucide-react'
import InfoLabel from '../shared/InfoLabel'
import ExportResultsButton from '../shared/ExportResultsButton'
import DataGenerator from '../shared/DataGenerator'
import { useModuleState } from '../../store/project'
import {
  fitRegression, FitRegressionResponse, RegressionModel, LogisticResult,
} from '../../api/regression'
import { fitModel, FitResponse, ModelType, ClassMetrics, RegMetrics } from '../../api/predictive'
import {
  MODEL_CATALOG, CATEGORIES, PALETTE, compatibility, ModelDef, ModelId, Task, ParamField,
} from './catalog'
import ModelDataGrid, { GridRow } from './ModelDataGrid'
import { RegressionDetail, MLDetail, fmt } from './details'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NormMetrics {
  r2?: number; rmse?: number; mae?: number
  accuracy?: number; precision?: number; recall?: number; f1?: number; roc_auc?: number | null
}

interface FittedModel {
  id: string
  name: string
  modelId: ModelId
  task: Task
  target: string
  features: string[]
  color: string
  metrics: NormMetrics
  reg?: FitRegressionResponse
  ml?: FitResponse
}

interface DMState {
  columns: string[]
  rows: GridRow[]
  target: string
  features: string[]
  taskOverride: 'auto' | Task
  modelId: ModelId
  paramValues: Record<string, string>   // keyed `${modelId}.${field}`
  testSize: number
  fitted: FittedModel[]
  selectedId: string | null
  view: 'detail' | 'compare'
  excluded: string[]
  metricReg: string
  metricClass: string
  genCol: string
}

const DEFAULT_COLS = ['x1', 'x2', 'y']
const sampleRows = (): GridRow[] => {
  const data = [
    [1, 2, 5], [2, 3, 8], [3, 1, 7], [4, 4, 11], [5, 2, 12],
    [6, 5, 14], [7, 3, 16], [8, 6, 19], [9, 1, 18], [10, 4, 22],
  ]
  return data.map(([a, b, c]) => ({ x1: String(a), x2: String(b), y: String(c) }))
}

const INITIAL: DMState = {
  columns: DEFAULT_COLS,
  rows: sampleRows(),
  target: 'y',
  features: ['x1', 'x2'],
  taskOverride: 'auto',
  modelId: 'linear',
  paramValues: {},
  testSize: 0.25,
  fitted: [],
  selectedId: null,
  view: 'detail',
  excluded: [],
  metricReg: 'r2',
  metricClass: 'accuracy',
  genCol: 'y',
}

const REG_METRICS = [
  { key: 'r2', label: 'R²', higher: true },
  { key: 'rmse', label: 'RMSE', higher: false },
  { key: 'mae', label: 'MAE', higher: false },
]
const CLASS_METRICS = [
  { key: 'accuracy', label: 'Accuracy', higher: true },
  { key: 'f1', label: 'F1', higher: true },
  { key: 'precision', label: 'Precision', higher: true },
  { key: 'recall', label: 'Recall', higher: true },
  { key: 'roc_auc', label: 'ROC AUC', higher: true },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DataModeling() {
  const [s, setS] = useModuleState<DMState>('dataModeling', INITIAL)
  const patch = (p: Partial<DMState>) => setS(prev => ({ ...prev, ...p }))
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // --- derived dataset facts ---
  const columnNumeric = (col: string): boolean => {
    const vals = s.rows.map(r => (r[col] ?? '').trim()).filter(v => v !== '')
    return vals.length > 0 && vals.every(v => Number.isFinite(Number(v)))
  }
  const targetVals = s.rows.map(r => (s.target ? (r[s.target] ?? '').trim() : '')).filter(v => v !== '')
  const targetNumeric = s.target ? columnNumeric(s.target) : false
  const nClasses = new Set(targetVals).size
  const featuresNumeric = s.features.length > 0 && s.features.every(columnNumeric)

  const detectedTask: Task = (() => {
    if (!targetNumeric) return 'classification'
    const nums = targetVals.map(Number)
    const uniq = new Set(nums)
    const allInt = nums.every(v => Number.isInteger(v))
    if (allInt && uniq.size <= Math.max(2, Math.floor(0.1 * nums.length))) return 'classification'
    return 'regression'
  })()
  const task: Task = s.taskOverride === 'auto' ? detectedTask : s.taskOverride

  const ctx = { task, nFeatures: s.features.length, nClasses, featuresNumeric, targetNumeric }

  const def = MODEL_CATALOG.find(m => m.id === s.modelId)!
  const compat = compatibility(def, ctx)

  // --- data editing ---
  const onColumnsChange = (cols: string[], rows: GridRow[]) => {
    const target = cols.includes(s.target) ? s.target : (cols[cols.length - 1] ?? '')
    const features = s.features.filter(f => cols.includes(f) && f !== target)
    const genCol = cols.includes(s.genCol) ? s.genCol : (cols[0] ?? '')
    patch({ columns: cols, rows, target, features, genCol })
  }

  const fillColumn = (col: string) => (vals: number[]) => {
    const rows = s.rows.map((r, i) => ({ ...r, [col]: i < vals.length ? String(vals[i]) : (r[col] ?? '') }))
    while (rows.length < vals.length) {
      const idx = rows.length
      rows.push(Object.fromEntries(s.columns.map(c => [c, c === col ? String(vals[idx]) : ''])))
    }
    patch({ rows })
  }

  const importCSV = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result).replace(/\r/g, '').trim()
      const lines = text.split('\n').filter(l => l.trim() !== '')
      if (lines.length < 2) { setError('CSV needs a header row and at least one data row.'); return }
      const sep = lines[0].includes('\t') ? '\t' : ','
      const cols = lines[0].split(sep).map(c => c.trim()).filter(c => c !== '')
      const rows: GridRow[] = lines.slice(1).map(line => {
        const cells = line.split(sep)
        return Object.fromEntries(cols.map((c, i) => [c, (cells[i] ?? '').trim()]))
      })
      const target = cols[cols.length - 1] ?? ''
      patch({ columns: cols, rows, target, features: cols.filter(c => c !== target), genCol: cols[0] ?? '' })
      setError(null)
    }
    reader.readAsText(file)
  }

  const toggleFeature = (c: string) =>
    patch({ features: s.features.includes(c) ? s.features.filter(f => f !== c) : [...s.features, c] })

  // --- params ---
  const paramKey = (field: ParamField) => `${s.modelId}.${field.key}`
  const paramVal = (field: ParamField): string => {
    const v = s.paramValues[paramKey(field)]
    return v != null ? v : String(field.default)
  }
  const setParam = (field: ParamField, value: string) =>
    patch({ paramValues: { ...s.paramValues, [paramKey(field)]: value } })

  const readParam = (mdef: ModelDef, key: string) => {
    const field = mdef.params.find(f => f.key === key)
    if (!field) return undefined
    const raw = s.paramValues[`${mdef.id}.${key}`] ?? String(field.default)
    if (field.type === 'bool') return raw === 'true' || raw === String(true) || (field.default === true && raw === 'true')
    if (field.type === 'int') return raw.trim() === '' ? undefined : parseInt(raw, 10)
    if (field.type === 'number') return raw.trim() === '' ? undefined : parseFloat(raw)
    return raw
  }

  const readMlParams = (mdef: ModelDef): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    for (const f of mdef.params) {
      const v = readParam(mdef, f.key)
      if (v === undefined || v === '') continue
      if (f.key === 'hidden_layer_sizes') {
        const sizes = String(v).split(',').map(x => parseInt(x.trim(), 10)).filter(n => Number.isFinite(n) && n > 0)
        if (sizes.length) out[f.key] = sizes
        continue
      }
      out[f.key] = v
    }
    return out
  }

  // --- fitting ---
  const fitOne = async (modelId: ModelId): Promise<FittedModel | null> => {
    const mdef = MODEL_CATALOG.find(m => m.id === modelId)!
    const c = compatibility(mdef, ctx)
    if (!c.ok) { setError(c.reason ?? `${mdef.label} is not compatible.`); return null }
    const required = [s.target, ...s.features]
    const clean = s.rows.filter(r => required.every(col => (r[col] ?? '').trim() !== ''))
    if (clean.length < 4) { setError('Need at least 4 complete rows for the selected columns.'); return null }

    const count = s.fitted.filter(f => f.modelId === modelId).length + 1
    const color = PALETTE[s.fitted.length % PALETTE.length]
    const base = { id: `${modelId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: `${mdef.label} #${count}`, modelId, task, target: s.target, features: [...s.features], color }

    if (mdef.backend === 'regression') {
      const data: Record<string, number[]> = {}
      for (const col of required) data[col] = clean.map(r => Number(r[col]))
      const res = await fitRegression({
        model: modelId as RegressionModel, data, y: s.target, x: s.features,
        alpha: readParam(mdef, 'alpha') as number | undefined,
        degree: readParam(mdef, 'degree') as number | undefined,
        fit_intercept: readParam(mdef, 'fit_intercept') as boolean | undefined,
      })
      return { ...base, metrics: normalizeReg(res, modelId), reg: res }
    } else {
      const data: Record<string, (string | number)[]> = {}
      for (const col of required) {
        data[col] = clean.map(r => {
          const v = (r[col] ?? '').trim()
          const n = Number(v)
          return v !== '' && Number.isFinite(n) ? n : v
        })
      }
      const res = await fitModel({
        model: modelId as ModelType, task, data, target: s.target, features: s.features,
        test_size: s.testSize, params: readMlParams(mdef),
      })
      return { ...base, metrics: normalizeML(res), ml: res }
    }
  }

  const runFit = async () => {
    setError(null); setBusy('fit')
    try {
      const fm = await fitOne(s.modelId)
      if (fm) patch({ fitted: [...s.fitted, fm], selectedId: fm.id, view: 'detail' })
    } catch (e) {
      setError(errDetail(e) || 'Fit failed.')
    } finally { setBusy(null) }
  }

  const fitAllCompatible = async () => {
    setError(null); setBusy('all')
    const added: FittedModel[] = []
    try {
      for (const mdef of MODEL_CATALOG) {
        if (!compatibility(mdef, ctx).ok) continue
        try {
          // rebuild base count using running list
          const merged = [...s.fitted, ...added]
          const count = merged.filter(f => f.modelId === mdef.id).length + 1
          const color = PALETTE[merged.length % PALETTE.length]
          const fm = await fitOneInternal(mdef, count, color)
          if (fm) added.push(fm)
        } catch { /* skip a model that errors, keep going */ }
      }
      if (added.length === 0) { setError('No compatible models could be fitted on this dataset.'); return }
      patch({ fitted: [...s.fitted, ...added], selectedId: added[added.length - 1].id, view: 'compare' })
    } finally { setBusy(null) }
  }

  // internal variant used by fitAll so naming/colors stay consistent
  const fitOneInternal = async (mdef: ModelDef, count: number, color: string): Promise<FittedModel | null> => {
    const required = [s.target, ...s.features]
    const clean = s.rows.filter(r => required.every(col => (r[col] ?? '').trim() !== ''))
    if (clean.length < 4) return null
    const base = { id: `${mdef.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: `${mdef.label} #${count}`, modelId: mdef.id, task, target: s.target, features: [...s.features], color }
    if (mdef.backend === 'regression') {
      const data: Record<string, number[]> = {}
      for (const col of required) data[col] = clean.map(r => Number(r[col]))
      const res = await fitRegression({
        model: mdef.id as RegressionModel, data, y: s.target, x: s.features,
        alpha: readParam(mdef, 'alpha') as number | undefined,
        degree: readParam(mdef, 'degree') as number | undefined,
        fit_intercept: readParam(mdef, 'fit_intercept') as boolean | undefined,
      })
      return { ...base, metrics: normalizeReg(res, mdef.id), reg: res }
    }
    const data: Record<string, (string | number)[]> = {}
    for (const col of required) {
      data[col] = clean.map(r => {
        const v = (r[col] ?? '').trim(); const n = Number(v)
        return v !== '' && Number.isFinite(n) ? n : v
      })
    }
    const res = await fitModel({
      model: mdef.id as ModelType, task, data, target: s.target, features: s.features,
      test_size: s.testSize, params: readMlParams(mdef),
    })
    return { ...base, metrics: normalizeML(res), ml: res }
  }

  const removeFitted = (id: string) => {
    const fitted = s.fitted.filter(f => f.id !== id)
    const selectedId = s.selectedId === id ? (fitted[fitted.length - 1]?.id ?? null) : s.selectedId
    patch({ fitted, selectedId, excluded: s.excluded.filter(x => x !== id) })
  }
  const clearFitted = () => patch({ fitted: [], selectedId: null, excluded: [] })
  const toggleExcluded = (id: string) =>
    patch({ excluded: s.excluded.includes(id) ? s.excluded.filter(x => x !== id) : [...s.excluded, id] })

  const selected = s.fitted.find(f => f.id === s.selectedId) ?? null

  // --- render ---
  const inputCls = 'w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400'

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left config panel */}
      <div className="w-96 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-4 flex flex-col gap-3">
        <div>
          <div className="flex items-center justify-between mb-1">
            <InfoLabel tip="Each column is a variable; rows are observations. Rename columns by editing the header. Paste from a spreadsheet, import a CSV, or generate a column.">Dataset</InfoLabel>
            <div className="flex items-center gap-1">
              <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) importCSV(f); e.target.value = '' }} />
              <button onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 border border-gray-300 rounded hover:bg-gray-50">
                <Upload size={10} /> CSV
              </button>
            </div>
          </div>
          <ModelDataGrid columns={s.columns} rows={s.rows}
            onColumnsChange={onColumnsChange} onRowsChange={rows => patch({ rows })} />
        </div>

        <div>
          <InfoLabel tip="Fill a column with generated values from a chosen distribution.">Generate column</InfoLabel>
          <div className="flex gap-2 items-center mb-2">
            <select value={s.genCol} onChange={e => patch({ genCol: e.target.value })} className={inputCls}>
              {s.columns.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <DataGenerator defaultDist="normal" onGenerate={fillColumn(s.genCol)}
            label={`Generate "${s.genCol}"`} />
        </div>

        <hr className="border-gray-200" />

        {/* Target / features / task */}
        <div>
          <InfoLabel tip="The column the model predicts.">Target</InfoLabel>
          <select value={s.target}
            onChange={e => patch({ target: e.target.value, features: s.features.filter(f => f !== e.target.value) })}
            className={inputCls}>
            {s.columns.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div>
          <InfoLabel tip="Predictor columns. Numeric columns are used as-is; text columns are label-encoded (ML models only).">Features</InfoLabel>
          <div className="flex flex-col gap-1 border border-gray-200 rounded p-2 max-h-32 overflow-y-auto">
            {s.columns.filter(c => c !== s.target).map(c => (
              <label key={c} className="flex items-center gap-2 text-xs text-gray-700">
                <input type="checkbox" checked={s.features.includes(c)} onChange={() => toggleFeature(c)} />
                {c} <span className="text-[10px] text-gray-400">{columnNumeric(c) ? 'numeric' : 'categorical'}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <InfoLabel tip="Regression predicts a continuous number; classification predicts a category. Auto-detected from the target column.">Task</InfoLabel>
          <div className="flex rounded border border-gray-300 overflow-hidden text-xs">
            {(['auto', 'regression', 'classification'] as const).map(t => (
              <button key={t} onClick={() => patch({ taskOverride: t })}
                className={`flex-1 px-2 py-1.5 capitalize transition-colors ${
                  s.taskOverride === t ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}>{t}</button>
            ))}
          </div>
          <p className="text-[10px] text-gray-500 mt-1">
            Effective: <span className="font-medium">{task}</span>
            {s.taskOverride === 'auto' && ' (auto)'} · target {targetNumeric ? 'numeric' : 'categorical'}, {nClasses} distinct
          </p>
        </div>

        <hr className="border-gray-200" />

        {/* Model selection by category with greying */}
        <div>
          <InfoLabel tip="Models incompatible with the current dataset/task are greyed out with the reason shown on hover.">Model</InfoLabel>
          <div className="flex flex-col gap-2 border border-gray-200 rounded p-2 max-h-72 overflow-y-auto">
            {CATEGORIES.map(cat => {
              const models = MODEL_CATALOG.filter(m => m.category === cat)
              return (
                <div key={cat}>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{cat}</p>
                  <div className="flex flex-col gap-0.5">
                    {models.map(m => {
                      const mc = compatibility(m, ctx)
                      const active = s.modelId === m.id
                      return (
                        <button key={m.id} disabled={!mc.ok}
                          onClick={() => patch({ modelId: m.id })}
                          title={mc.ok ? m.blurb : mc.reason}
                          className={`text-left text-xs px-2 py-1 rounded border transition-colors ${
                            active && mc.ok ? 'bg-blue-600 text-white border-blue-600'
                              : mc.ok ? 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                              : 'bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed'
                          }`}>
                          {m.label}
                          {!mc.ok && <span className="block text-[9px] leading-tight">{mc.reason}</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Hyperparameters */}
        {def.params.length > 0 && (
          <div>
            <InfoLabel tip="Hyperparameters for the selected model.">Hyperparameters</InfoLabel>
            <div className="flex flex-col gap-2">
              {def.params.map(field => (
                <div key={field.key} className="flex items-center justify-between gap-2">
                  <label className="text-xs text-gray-600">{field.label}
                    {field.help && <span className="block text-[9px] text-gray-400">{field.help}</span>}
                  </label>
                  {field.type === 'bool' ? (
                    <input type="checkbox" checked={paramVal(field) === 'true'}
                      onChange={e => setParam(field, String(e.target.checked))} />
                  ) : field.type === 'select' ? (
                    <select value={paramVal(field)} onChange={e => setParam(field, e.target.value)}
                      className="text-xs border border-gray-300 rounded px-1.5 py-1 w-32">
                      {(field.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input type={field.type === 'text' ? 'text' : 'number'}
                      value={paramVal(field)}
                      min={field.min} max={field.max} step={field.step}
                      onChange={e => setParam(field, e.target.value)}
                      className="text-xs border border-gray-300 rounded px-1.5 py-1 w-24 font-mono" />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Test size for ML models */}
        {def.backend === 'predictive' && (
          <div className="flex items-center justify-between gap-2">
            <InfoLabel tip="Fraction of rows held out for the test metrics.">Test size</InfoLabel>
            <input type="number" min={0.1} max={0.5} step={0.05} value={s.testSize}
              onChange={e => patch({ testSize: parseFloat(e.target.value) || 0.25 })}
              className="text-xs border border-gray-300 rounded px-1.5 py-1 w-24 font-mono" />
          </div>
        )}

        {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}
        {!compat.ok && <p className="text-[11px] text-amber-600 bg-amber-50 p-2 rounded">{compat.reason}</p>}

        <div className="flex gap-2">
          <button onClick={runFit} disabled={busy !== null || !compat.ok}
            className="flex-1 flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium py-2 rounded transition-colors">
            <Play size={12} /> {busy === 'fit' ? 'Fitting…' : 'Fit model'}
          </button>
          <button onClick={fitAllCompatible} disabled={busy !== null}
            title="Fit every compatible model and compare"
            className="flex items-center justify-center gap-1.5 border border-blue-600 text-blue-700 hover:bg-blue-50 disabled:opacity-50 text-xs font-medium py-2 px-2 rounded transition-colors">
            <Layers size={12} /> {busy === 'all' ? '…' : 'Fit all'}
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {s.fitted.length === 0 ? (
          <div className="h-full flex items-center justify-center text-gray-400">
            <div className="text-center">
              <p className="text-lg font-medium">No models fitted yet</p>
              <p className="text-sm mt-1">Enter data, pick a target + features, choose a model, then Fit.</p>
            </div>
          </div>
        ) : (
          <div className="p-4 flex flex-col gap-3">
            {/* Fitted-models bar */}
            <div className="flex items-center gap-2 flex-wrap">
              {s.fitted.map(f => (
                <div key={f.id}
                  className={`flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full border text-xs cursor-pointer transition-colors ${
                    s.selectedId === f.id && s.view === 'detail'
                      ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                  onClick={() => patch({ selectedId: f.id, view: 'detail' })}>
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: f.color }} />
                  {f.name}
                  <span className="text-[10px] text-gray-400">{summaryMetric(f)}</span>
                  <button onClick={e => { e.stopPropagation(); removeFitted(f.id) }}
                    className="text-gray-300 hover:text-red-500"><X size={12} /></button>
                </div>
              ))}
              <div className="flex-1" />
              <button onClick={() => patch({ view: s.view === 'compare' ? 'detail' : 'compare' })}
                className={`flex items-center gap-1 text-xs px-2 py-1 rounded border transition-colors ${
                  s.view === 'compare' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}>
                <GitCompare size={12} /> Compare ({s.fitted.length})
              </button>
              {s.fitted.length > 0 && (
                <button onClick={clearFitted}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-300 text-gray-500 hover:bg-gray-50">
                  <Trash2 size={12} /> Clear
                </button>
              )}
            </div>

            <div ref={resultsRef} className="flex flex-col gap-4">
              <div className="flex justify-end" data-export-ignore>
                <ExportResultsButton getElement={() => resultsRef.current} baseName="regression-ml" title="Regression & ML" />
              </div>

              {s.view === 'compare' ? (
                <ComparePanel fitted={s.fitted} excluded={s.excluded} onToggle={toggleExcluded}
                  metricReg={s.metricReg} metricClass={s.metricClass}
                  onMetricReg={m => patch({ metricReg: m })} onMetricClass={m => patch({ metricClass: m })}
                  onSelect={id => patch({ selectedId: id, view: 'detail' })} />
              ) : selected ? (
                <div>
                  <h3 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: selected.color }} />
                    {selected.name} · {selected.task} · target: {selected.target}
                  </h3>
                  {selected.reg ? <RegressionDetail fit={selected.reg} /> : selected.ml ? <MLDetail fit={selected.ml} /> : null}
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Comparison panel
// ---------------------------------------------------------------------------

function ComparePanel({
  fitted, excluded, onToggle, metricReg, metricClass, onMetricReg, onMetricClass, onSelect,
}: {
  fitted: FittedModel[]
  excluded: string[]
  onToggle: (id: string) => void
  metricReg: string
  metricClass: string
  onMetricReg: (m: string) => void
  onMetricClass: (m: string) => void
  onSelect: (id: string) => void
}) {
  const groups: { task: Task; metrics: typeof REG_METRICS; metric: string; setMetric: (m: string) => void }[] = [
    { task: 'regression', metrics: REG_METRICS, metric: metricReg, setMetric: onMetricReg },
    { task: 'classification', metrics: CLASS_METRICS, metric: metricClass, setMetric: onMetricClass },
  ]
  return (
    <div className="flex flex-col gap-6">
      {groups.map(g => {
        const models = fitted.filter(f => f.task === g.task)
        if (models.length === 0) return null
        const included = models.filter(f => !excluded.includes(f.id))
        const metricDef = g.metrics.find(m => m.key === g.metric) ?? g.metrics[0]
        const vals = included.map(f => (f.metrics as Record<string, number | null | undefined>)[metricDef.key])
        const valid = vals.filter((v): v is number => v != null && !Number.isNaN(v))
        const best = valid.length ? (metricDef.higher ? Math.max(...valid) : Math.min(...valid)) : null
        return (
          <div key={g.task}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-800 capitalize">{g.task} models ({models.length})</h3>
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-gray-500">Chart metric:</span>
                <select value={g.metric} onChange={e => g.setMetric(e.target.value)}
                  className="text-xs border border-gray-300 rounded px-1.5 py-1">
                  {g.metrics.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto rounded border border-gray-200 mb-3">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-600">
                  <tr>
                    <th className="px-2 py-1.5 text-center font-medium w-8">Show</th>
                    <th className="px-3 py-1.5 text-left font-medium">Model</th>
                    {g.metrics.map(m => <th key={m.key} className="px-3 py-1.5 text-right font-medium">{m.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {models.map(f => {
                    const mm = f.metrics as Record<string, number | null | undefined>
                    return (
                      <tr key={f.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                        <td className="px-2 py-1.5 text-center">
                          <input type="checkbox" checked={!excluded.includes(f.id)} onChange={() => onToggle(f.id)} />
                        </td>
                        <td className="px-3 py-1.5 cursor-pointer" onClick={() => onSelect(f.id)}>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: f.color }} />
                            <span className="text-blue-700 hover:underline">{f.name}</span>
                          </span>
                        </td>
                        {g.metrics.map(m => {
                          const v = mm[m.key]
                          const isBest = !excluded.includes(f.id) && m.key === metricDef.key && v != null && v === best
                          return (
                            <td key={m.key} className={`px-3 py-1.5 text-right font-mono ${isBest ? 'font-bold text-green-700' : ''}`}>
                              {fmt(v)}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Bar chart */}
            {included.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 300 }}>
                <Plot
                  data={[{
                    type: 'bar',
                    x: included.map(f => f.name),
                    y: included.map(f => (f.metrics as Record<string, number | null | undefined>)[metricDef.key] ?? null),
                    marker: { color: included.map(f => f.color) },
                    text: included.map(f => fmt((f.metrics as Record<string, number | null | undefined>)[metricDef.key])),
                    textposition: 'outside',
                  } as unknown as Plotly.Data]}
                  layout={{
                    title: { text: `${metricDef.label} by model`, font: { size: 12 } },
                    margin: { t: 36, r: 20, b: 80, l: 50 },
                    yaxis: { title: { text: metricDef.label }, gridcolor: '#e5e7eb' },
                    xaxis: { tickangle: -30 },
                    paper_bgcolor: 'white', plot_bgcolor: 'white',
                  } as PlotlyLayout}
                  config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler />
              </div>
            )}
          </div>
        )
      })}
      {fitted.length === 0 && <p className="text-sm text-gray-400">Fit at least one model to compare.</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeReg(res: FitRegressionResponse, modelId: ModelId): NormMetrics {
  if (modelId === 'logistic') {
    const r = res as LogisticResult
    const cm = r.confusion_matrix
    const tn = cm[0][0], fp = cm[0][1], fn = cm[1][0], tp = cm[1][1]
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0
    return { accuracy: r.accuracy, precision, recall, f1, roc_auc: r.roc?.auc }
  }
  const mae = res.residuals.length
    ? res.residuals.reduce((a, b) => a + Math.abs(b), 0) / res.residuals.length : undefined
  return { r2: res.r2, rmse: res.rmse, mae }
}

function normalizeML(res: FitResponse): NormMetrics {
  if (res.task === 'classification') {
    const m = res.metrics as ClassMetrics
    return { accuracy: m.accuracy, precision: m.precision, recall: m.recall, f1: m.f1, roc_auc: m.roc_auc }
  }
  const m = res.metrics as RegMetrics
  return { r2: m.r2, rmse: m.rmse, mae: m.mae }
}

function summaryMetric(f: FittedModel): string {
  if (f.task === 'classification') return `acc ${fmt(f.metrics.accuracy)}`
  return `R² ${fmt(f.metrics.r2)}`
}

function errDetail(e: unknown): string | undefined {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
}
