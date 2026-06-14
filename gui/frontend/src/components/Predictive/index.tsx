import { useState } from 'react'
import Plot from 'react-plotly.js'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlotlyLayout = any
import { Play, GitCompare } from 'lucide-react'
import InfoLabel from '../shared/InfoLabel'
import DataTable, { DataColumn } from '../shared/DataTable'
import DataGenerator from '../shared/DataGenerator'
import { useModuleState } from '../../store/project'
import {
  fitModel, compareModels, FitResponse, CompareResponse,
  ModelType, ClassMetrics, RegMetrics,
} from '../../api/predictive'

interface PredState {
  colNames: string[]
  rows: Record<string, string>[]
  target: string
  features: string[]
  model: ModelType
  fit: FitResponse | null
  compare: CompareResponse | null
  genCol: string
}

const DEFAULT_COLS = ['x1', 'x2', 'y']
const INITIAL: PredState = {
  colNames: DEFAULT_COLS,
  rows: Array.from({ length: 8 }, () => Object.fromEntries(DEFAULT_COLS.map(c => [c, '']))),
  target: 'y',
  features: ['x1', 'x2'],
  model: 'decision_tree',
  fit: null,
  compare: null,
  genCol: DEFAULT_COLS[0],
}

const MODELS: { id: ModelType; label: string }[] = [
  { id: 'decision_tree', label: 'Decision Tree' },
  { id: 'chaid', label: 'CHAID' },
  { id: 'random_forest', label: 'Random Forest' },
  { id: 'gradient_boosting', label: 'Gradient Boosting' },
  { id: 'svm', label: 'SVM' },
  { id: 'knn', label: 'KNN' },
  { id: 'adaboost', label: 'AdaBoost' },
  { id: 'mlp', label: 'MLP (Neural Network)' },
]

const isClass = (m: ClassMetrics | RegMetrics): m is ClassMetrics =>
  (m as ClassMetrics).accuracy !== undefined

export default function Predictive() {
  const [s, setS] = useModuleState<PredState>('sixSigma.predictive', INITIAL)
  const patch = (p: Partial<PredState>) => setS(prev => ({ ...prev, ...p }))
  const [loading, setLoading] = useState<'fit' | 'compare' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cols: DataColumn[] = s.colNames.map(c => ({ key: c, label: c, type: 'number' as const }))

  const toData = (): Record<string, (string | number)[]> => {
    const d: Record<string, (string | number)[]> = {}
    for (const c of s.colNames) {
      d[c] = s.rows.map(r => {
        const v = r[c] ?? ''
        const n = parseFloat(v)
        return v.trim() !== '' && !isNaN(n) ? n : v
      })
    }
    return d
  }

  const fillColumn = (col: string) => (vals: number[]) => {
    const rows = s.rows.map((r, i) => ({ ...r, [col]: i < vals.length ? String(vals[i]) : r[col] }))
    while (rows.length < vals.length) {
      const idx = rows.length
      rows.push(Object.fromEntries(s.colNames.map(c => [c, c === col ? String(vals[idx]) : ''])))
    }
    patch({ rows, fit: null, compare: null })
  }

  const toggleFeature = (c: string) =>
    patch({
      features: s.features.includes(c) ? s.features.filter(f => f !== c) : [...s.features, c],
      fit: null,
    })

  const validate = (): string | null => {
    if (!s.target) return 'Choose a target column.'
    if (s.features.length === 0) return 'Select at least one feature.'
    if (s.features.includes(s.target)) return 'Target cannot also be a feature.'
    return null
  }

  const runFit = async () => {
    const v = validate(); if (v) { setError(v); return }
    setError(null); setLoading('fit')
    try {
      const res = await fitModel({
        model: s.model, data: toData(), target: s.target, features: s.features,
      })
      patch({ fit: res, compare: null })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Fit failed.')
    } finally { setLoading(null) }
  }

  const runCompare = async () => {
    const v = validate(); if (v) { setError(v); return }
    setError(null); setLoading('compare')
    try {
      const res = await compareModels({ data: toData(), target: s.target, features: s.features })
      patch({ compare: res, fit: null })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Compare failed.')
    } finally { setLoading(null) }
  }

  const fit = s.fit
  const cmp = s.compare

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="w-80 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-4 flex flex-col gap-3">
        <div>
          <InfoLabel tip="Small dataset — each column is a variable; rows are observations. Paste from a spreadsheet.">Dataset</InfoLabel>
          <DataTable columns={cols} rows={s.rows}
            onChange={rows => patch({ rows, fit: null, compare: null })} minRows={1} />
        </div>

        <div>
          <InfoLabel tip="Select which column to fill with generated data.">Generate Column</InfoLabel>
          <select value={s.genCol} onChange={e => patch({ genCol: e.target.value })}
            className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 mb-2 focus:outline-none focus:ring-1 focus:ring-blue-400">
            {s.colNames.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <DataGenerator defaultDist="normal" onGenerate={fillColumn(s.genCol)}
            label={`Generate column "${s.genCol}"`} />
        </div>

        <div>
          <InfoLabel tip="Column the model predicts. Classification is auto-detected from few distinct integer values; otherwise regression.">Target</InfoLabel>
          <select value={s.target} onChange={e => patch({ target: e.target.value, fit: null, compare: null })}
            className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400">
            {s.colNames.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div>
          <InfoLabel tip="Predictor columns. Numeric columns are used as-is; text columns are label-encoded.">Features</InfoLabel>
          <div className="flex flex-col gap-1 border border-gray-200 rounded p-2">
            {s.colNames.filter(c => c !== s.target).map(c => (
              <label key={c} className="flex items-center gap-2 text-xs text-gray-700">
                <input type="checkbox" checked={s.features.includes(c)} onChange={() => toggleFeature(c)} />
                {c}
              </label>
            ))}
          </div>
        </div>

        <div>
          <InfoLabel tip="Model family. CHAID is a chi-square multiway classification tree (classification only).">Model</InfoLabel>
          <select value={s.model} onChange={e => patch({ model: e.target.value as ModelType, fit: null })}
            className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400">
            {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>

        {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}

        <div className="flex gap-2">
          <button onClick={runFit} disabled={loading !== null}
            className="flex-1 flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium py-2 rounded transition-colors">
            <Play size={12} /> {loading === 'fit' ? 'Fitting...' : 'Fit'}
          </button>
          <button onClick={runCompare} disabled={loading !== null}
            className="flex-1 flex items-center justify-center gap-1.5 border border-blue-600 text-blue-700 hover:bg-blue-50 disabled:opacity-50 text-xs font-medium py-2 rounded transition-colors">
            <GitCompare size={12} /> {loading === 'compare' ? 'Running...' : 'Compare'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!fit && !cmp ? (
          <div className="h-full flex items-center justify-center text-gray-400">
            <div className="text-center">
              <p className="text-lg font-medium">No model fitted</p>
              <p className="text-sm mt-1">Enter data, pick target + features, then Fit or Compare</p>
            </div>
          </div>
        ) : (
          <div className="p-6 flex flex-col gap-6">
            {fit && <FitResults fit={fit} />}
            {cmp && <CompareResults cmp={cmp} />}
          </div>
        )}
      </div>
    </div>
  )
}

function FitResults({ fit }: { fit: FitResponse }) {
  const m = fit.metrics
  const classification = isClass(m)
  const fi = fit.feature_importances
    ? Object.entries(fit.feature_importances).sort((a, b) => b[1] - a[1]) : []

  return (
    <>
      <div>
        <h3 className="text-sm font-semibold text-gray-800 mb-3">
          {fit.model} · {fit.task} (train {fit.n_train} / test {fit.n_test})
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {classification ? (
            <>
              <Card label="Accuracy" value={pct((m as ClassMetrics).accuracy)} accent />
              <Card label="Precision (macro)" value={pct((m as ClassMetrics).precision)} />
              <Card label="Recall (macro)" value={pct((m as ClassMetrics).recall)} />
              <Card label="F1 (macro)" value={pct((m as ClassMetrics).f1)} />
              {(m as ClassMetrics).roc_auc != null &&
                <Card label="ROC AUC" value={fmt((m as ClassMetrics).roc_auc!)} />}
            </>
          ) : (
            <>
              <Card label="R²" value={fmt((m as RegMetrics).r2)} accent />
              <Card label="RMSE" value={fmt((m as RegMetrics).rmse)} />
              <Card label="MAE" value={fmt((m as RegMetrics).mae)} />
            </>
          )}
        </div>

        {/* Interpretation panel */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-3">
          <p className="text-xs font-medium text-blue-800 mb-1">Interpretation</p>
          <ul className="text-xs text-blue-700 list-disc list-inside space-y-0.5">
            {classification ? (() => {
              const cm = m as ClassMetrics
              const nClasses = cm.classes?.length ?? 2
              const baseline = nClasses > 0 ? 1 / nClasses : 0.5
              return (
                <>
                  <li>
                    Accuracy is {pct(cm.accuracy)}.{' '}
                    {cm.accuracy > baseline + 0.2
                      ? 'The model performs substantially better than random guessing.'
                      : cm.accuracy > baseline + 0.05
                      ? 'The model performs somewhat better than random guessing.'
                      : `The model is close to random guessing (baseline ~${pct(baseline)} for ${nClasses} classes).`}
                  </li>
                  <li>
                    F1 score of {pct(cm.f1)} balances precision and recall.{' '}
                    {cm.f1 >= 0.8 ? 'This indicates strong predictive performance.' :
                     cm.f1 >= 0.6 ? 'This indicates moderate predictive performance.' :
                     'This suggests the model has difficulty with one or more classes.'}
                  </li>
                  {fi.length > 0 && (
                    <li>
                      Most important feature{fi.length > 1 ? 's' : ''}: {fi.slice(0, 3).map(f => f[0]).join(', ')}.
                    </li>
                  )}
                </>
              )
            })() : (() => {
              const rm = m as RegMetrics
              return (
                <>
                  <li>
                    R² = {fmt(rm.r2)} — the model explains {rm.r2 != null ? (rm.r2 * 100).toFixed(1) : '?'}% of the variance.{' '}
                    {rm.r2 != null && rm.r2 < 0.3 ? 'This is a poor fit; predictions may not be reliable.' :
                     rm.r2 != null && rm.r2 < 0.6 ? 'This is a fair fit; predictions have moderate reliability.' :
                     rm.r2 != null && rm.r2 < 0.8 ? 'This is a good fit; predictions should be reasonably reliable.' :
                     'This is an excellent fit; predictions are highly reliable.'}
                  </li>
                  {fi.length > 0 && (
                    <li>
                      Most important feature{fi.length > 1 ? 's' : ''}: {fi.slice(0, 3).map(f => f[0]).join(', ')}.
                    </li>
                  )}
                </>
              )
            })()}
          </ul>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Confusion matrix OR actual vs predicted */}
        {classification ? (
          <ConfusionMatrix m={m as ClassMetrics} />
        ) : (
          <ActualVsPredicted fit={fit} />
        )}

        {/* Feature importances */}
        {fi.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 320 }}>
            <Plot
              data={[{
                x: fi.map(f => f[1]), y: fi.map(f => f[0]), type: 'bar', orientation: 'h',
                marker: { color: '#3b82f6' },
              } as Plotly.Data]}
              layout={{
                title: { text: 'Feature Importances', font: { size: 13 } },
                margin: { t: 40, r: 20, b: 40, l: 90 },
                xaxis: { gridcolor: '#e5e7eb' },
                paper_bgcolor: 'white', plot_bgcolor: 'white',
              } as PlotlyLayout}
              config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler />
          </div>
        )}
      </div>

      {fit.tree_text && (
        <div>
          <h3 className="text-sm font-semibold text-gray-800 mb-2">Tree Structure</h3>
          <pre className="text-[11px] bg-gray-50 border border-gray-200 rounded p-3 overflow-x-auto font-mono">{fit.tree_text}</pre>
        </div>
      )}
    </>
  )
}

function ConfusionMatrix({ m }: { m: ClassMetrics }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 320 }}>
      <Plot
        data={[{
          z: m.confusion_matrix, x: m.classes, y: m.classes, type: 'heatmap',
          colorscale: 'Blues', showscale: true,
          text: m.confusion_matrix.map(row => row.map(String)),
          texttemplate: '%{text}', hovertemplate: 'pred %{x}<br>actual %{y}<br>%{z}<extra></extra>',
        } as unknown as Plotly.Data]}
        layout={{
          title: { text: 'Confusion Matrix', font: { size: 13 } },
          xaxis: { title: { text: 'Predicted' } },
          yaxis: { title: { text: 'Actual' }, autorange: 'reversed' },
          margin: { t: 40, r: 20, b: 50, l: 60 },
          paper_bgcolor: 'white', plot_bgcolor: 'white',
        } as PlotlyLayout}
        config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler />
    </div>
  )
}

function ActualVsPredicted({ fit }: { fit: FitResponse }) {
  const actual = fit.actual.map(Number)
  const pred = fit.predictions.map(Number)
  const lo = Math.min(...actual, ...pred)
  const hi = Math.max(...actual, ...pred)
  return (
    <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 320 }}>
      <Plot
        data={[
          { x: actual, y: pred, mode: 'markers', name: 'Predictions', marker: { color: '#3b82f6', size: 7 } } as Plotly.Data,
          { x: [lo, hi], y: [lo, hi], mode: 'lines', name: 'Ideal', line: { color: '#16a34a', dash: 'dash' } } as Plotly.Data,
        ]}
        layout={{
          title: { text: 'Actual vs Predicted', font: { size: 13 } },
          xaxis: { title: { text: 'Actual' }, gridcolor: '#e5e7eb' },
          yaxis: { title: { text: 'Predicted' }, gridcolor: '#e5e7eb' },
          margin: { t: 40, r: 20, b: 50, l: 60 },
          paper_bgcolor: 'white', plot_bgcolor: 'white',
          legend: { font: { size: 10 } },
        } as PlotlyLayout}
        config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler />
    </div>
  )
}

function CompareResults({ cmp }: { cmp: CompareResponse }) {
  const classification = cmp.task === 'classification'
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-800 mb-3">
        Model Comparison ({cmp.task}, CV scoring: {cmp.scoring})
      </h3>
      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200 text-gray-600">
              <th className="px-3 py-2 text-left font-medium">Model</th>
              <th className="px-3 py-2 text-right font-medium">CV mean</th>
              <th className="px-3 py-2 text-right font-medium">CV std</th>
              {classification ? (
                <>
                  <th className="px-3 py-2 text-right font-medium">Accuracy</th>
                  <th className="px-3 py-2 text-right font-medium">F1</th>
                  <th className="px-3 py-2 text-right font-medium">Precision</th>
                  <th className="px-3 py-2 text-right font-medium">Recall</th>
                  <th className="px-3 py-2 text-right font-medium">ROC AUC</th>
                </>
              ) : (
                <>
                  <th className="px-3 py-2 text-right font-medium">R²</th>
                  <th className="px-3 py-2 text-right font-medium">RMSE</th>
                  <th className="px-3 py-2 text-right font-medium">MAE</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {cmp.comparison.map((row, i) => (
              <tr key={i} className="border-b border-gray-100 last:border-0">
                <td className="px-3 py-2 text-gray-800">{row.model}</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(row.cv_mean)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(row.cv_std)}</td>
                {classification ? (
                  <>
                    <td className="px-3 py-2 text-right font-mono">{fmt(row.accuracy)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(row.f1)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(row.precision)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(row.recall)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(row.roc_auc)}</td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-2 text-right font-mono">{fmt(row.r2)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(row.rmse)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(row.mae)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function fmt(v: number | null | undefined): string {
  if (v == null) return '--'
  return v.toFixed(4)
}
function pct(v: number): string {
  return (v * 100).toFixed(1) + '%'
}
function Card({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${accent ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200'}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-semibold ${accent ? 'text-blue-700' : 'text-gray-900'}`}>{value}</p>
    </div>
  )
}
