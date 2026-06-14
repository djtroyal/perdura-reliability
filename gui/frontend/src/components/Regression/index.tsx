import { useState, useMemo } from 'react'
import Plot from 'react-plotly.js'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlotlyLayout = any
import { Play } from 'lucide-react'
import InfoLabel from '../shared/InfoLabel'
import { useModuleState } from '../../store/project'
import {
  fitRegression,
  FitRegressionRequest,
  FitRegressionResponse,
  LinearResult,
  LogisticResult,
  PolynomialResult,
  RegressionModel,
} from '../../api/regression'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface RegressionState {
  rawText: string
  modelType: RegressionModel
  responseCol: string
  predictorCols: string[]
  alpha: number
  alphaText: string
  degree: number
  degreeText: string
  fitIntercept: boolean
  result: FitRegressionResponse | null
}

const INITIAL_STATE: RegressionState = {
  rawText:
    'x1\tx2\ty\n' +
    '1\t2\t5\n' +
    '2\t3\t8\n' +
    '3\t1\t7\n' +
    '4\t4\t11\n' +
    '5\t2\t12\n' +
    '6\t5\t14\n' +
    '7\t3\t16\n' +
    '8\t6\t19\n' +
    '9\t1\t18\n' +
    '10\t4\t22',
  modelType: 'linear',
  responseCol: '',
  predictorCols: [],
  alpha: 1.0,
  alphaText: '1',
  degree: 2,
  degreeText: '2',
  fitIntercept: true,
  result: null,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseTable(text: string): { columns: string[]; data: Record<string, number[]> } {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return { columns: [], data: {} }
  const sep = lines[0].includes('\t') ? '\t' : ','
  const columns = lines[0].split(sep).map(c => c.trim())
  const data: Record<string, number[]> = {}
  for (const col of columns) data[col] = []
  for (const line of lines.slice(1)) {
    const cells = line.split(sep).map(c => c.trim())
    columns.forEach((col, i) => {
      const v = parseFloat(cells[i] ?? '')
      data[col].push(isNaN(v) ? 0 : v)
    })
  }
  return { columns, data }
}

const fmt = (v: number | null | undefined): string => {
  if (v == null) return '—'
  if (Math.abs(v) !== 0 && (Math.abs(v) >= 1e4 || Math.abs(v) < 1e-3)) return v.toExponential(3)
  return v.toFixed(4)
}

const fmtPct = (v: number | null | undefined): string =>
  v == null ? '—' : (v * 100).toFixed(2) + '%'

function isLinear(r: FitRegressionResponse): r is LinearResult {
  return r.model === 'linear'
}
function isLogistic(r: FitRegressionResponse): r is LogisticResult {
  return r.model === 'logistic'
}
function isPolynomial(r: FitRegressionResponse): r is PolynomialResult {
  return r.model === 'polynomial'
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  label, value, tip,
}: { label: string; value: string; tip?: string }) {
  return (
    <div className="bg-gray-50 rounded p-2 border border-gray-200">
      <InfoLabel tip={tip} className="text-[10px] text-gray-500 mb-0.5">{label}</InfoLabel>
      <p className="text-sm font-semibold text-gray-800 font-mono">{value}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Regression() {
  const [state, setState] = useModuleState<RegressionState>('regression', INITIAL_STATE)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { columns, data } = useMemo(() => parseTable(state.rawText), [state.rawText])

  // Auto-select first column as response if none selected
  const responseCol = state.responseCol && columns.includes(state.responseCol)
    ? state.responseCol
    : columns[columns.length - 1] ?? ''

  const predictorCols = state.predictorCols.filter(c => columns.includes(c) && c !== responseCol)

  const patch = (p: Partial<RegressionState>) => setState(s => ({ ...s, ...p }))

  const togglePredictor = (col: string) => {
    const cols = predictorCols.includes(col)
      ? predictorCols.filter(c => c !== col)
      : [...predictorCols, col]
    patch({ predictorCols: cols })
  }

  const handleRun = async () => {
    setError(null)
    if (!responseCol) { setError('Select a response column.'); return }
    if (predictorCols.length === 0) { setError('Select at least one predictor column.'); return }
    if (state.modelType === 'polynomial' && predictorCols.length !== 1) {
      setError('Polynomial regression requires exactly one predictor column.'); return
    }

    const req: FitRegressionRequest = {
      model: state.modelType,
      data,
      y: responseCol,
      x: predictorCols,
      alpha: state.alpha,
      degree: state.degree,
      fit_intercept: state.fitIntercept,
    }

    setLoading(true)
    try {
      const result = await fitRegression(req)
      patch({ result })
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err?.response?.data?.detail ?? 'Unexpected error.')
    } finally {
      setLoading(false)
    }
  }

  const result = state.result
  const lin = result && isLinear(result) ? result : null
  const log = result && isLogistic(result) ? result : null
  const poly = result && isPolynomial(result) ? result : null

  // Coefficient table rows
  const coefRows = useMemo(() => {
    if (!result) return []
    const names: string[] = []
    if (result.intercept != null) names.push('Intercept')
    names.push(...result.feature_names)

    const coeffs: number[] = result.intercept != null
      ? [result.intercept, ...result.coefficients]
      : result.coefficients

    return names.map((name, i) => ({
      name,
      coef: coeffs[i],
      se: (lin ?? log)?.std_errors?.[i] ?? null,
      tOrZ: lin ? lin.t_values?.[i] ?? null : log ? log.z_values?.[i] ?? null : null,
      p: (lin ?? log)?.p_values?.[i] ?? null,
      ciLo: (lin ?? log)?.conf_int?.[i]?.[0] ?? null,
      ciHi: (lin ?? log)?.conf_int?.[i]?.[1] ?? null,
      or: log?.odds_ratios?.[i] ?? null,
    }))
  }, [result, lin, log])

  // --- Plots ---

  const residVsFittedData = useMemo(() => {
    if (!result) return []
    return [{
      x: result.fitted,
      y: result.residuals,
      mode: 'markers' as const,
      type: 'scatter' as const,
      marker: { color: '#3b82f6', size: 5, opacity: 0.7 },
      name: 'Residuals',
    }]
  }, [result])

  const residVsFittedLayout: PlotlyLayout = {
    xaxis: { title: 'Fitted values', gridcolor: '#e5e7eb', zeroline: true, zerolinecolor: '#9ca3af' },
    yaxis: { title: 'Residuals', gridcolor: '#e5e7eb', zeroline: true, zerolinecolor: '#9ca3af' },
    margin: { t: 24, r: 16, b: 48, l: 56 },
    paper_bgcolor: 'white', plot_bgcolor: 'white',
    showlegend: false,
    shapes: [{ type: 'line', x0: 0, x1: 1, y0: 0, y1: 0, xref: 'paper', yref: 'y',
               line: { color: '#ef4444', width: 1.5, dash: 'dash' } }],
  }

  // Actual vs Predicted
  const actVsPredData = useMemo((): Record<string, unknown>[] => {
    if (!result) return []
    const yVals = data[responseCol] ?? []
    const minV = Math.min(...yVals, ...result.fitted)
    const maxV = Math.max(...yVals, ...result.fitted)
    return [
      { x: [minV, maxV], y: [minV, maxV], mode: 'lines', type: 'scatter',
        line: { color: '#9ca3af', dash: 'dash', width: 1.5 },
        name: 'Perfect fit', showlegend: false },
      { x: result.fitted, y: yVals, mode: 'markers', type: 'scatter',
        marker: { color: '#10b981', size: 5, opacity: 0.8 },
        name: 'Actual vs Predicted' },
    ]
  }, [result, data, responseCol])

  const actVsPredLayout: PlotlyLayout = {
    xaxis: { title: 'Predicted', gridcolor: '#e5e7eb' },
    yaxis: { title: 'Actual', gridcolor: '#e5e7eb' },
    margin: { t: 24, r: 16, b: 48, l: 56 },
    paper_bgcolor: 'white', plot_bgcolor: 'white',
    showlegend: false,
  }

  // Polynomial fitted curve overlay
  const polyScatterData = useMemo(() => {
    if (!poly) return []
    return [
      { x: poly.x_data, y: poly.y_data, mode: 'markers' as const, type: 'scatter' as const,
        marker: { color: '#3b82f6', size: 5 }, name: 'Data' },
      { x: poly.x_grid, y: poly.y_grid, mode: 'lines' as const, type: 'scatter' as const,
        line: { color: '#ef4444', width: 2 }, name: `Degree-${poly.degree} fit` },
    ]
  }, [poly])

  const polyScatterLayout: PlotlyLayout = {
    xaxis: { title: predictorCols[0] ?? 'x', gridcolor: '#e5e7eb' },
    yaxis: { title: responseCol || 'y', gridcolor: '#e5e7eb' },
    margin: { t: 24, r: 16, b: 48, l: 56 },
    paper_bgcolor: 'white', plot_bgcolor: 'white',
  }

  // ROC curve
  const rocData = useMemo((): Record<string, unknown>[] => {
    if (!log) return []
    const { fpr, tpr, auc } = log.roc
    return [
      { x: [0, 1], y: [0, 1], mode: 'lines', type: 'scatter',
        line: { color: '#9ca3af', dash: 'dash', width: 1 }, showlegend: false },
      { x: fpr, y: tpr, mode: 'lines', type: 'scatter',
        line: { color: '#3b82f6', width: 2 },
        name: `AUC = ${auc.toFixed(3)}` },
    ]
  }, [log])

  const rocLayout: PlotlyLayout = {
    xaxis: { title: 'False Positive Rate', gridcolor: '#e5e7eb', range: [0, 1] },
    yaxis: { title: 'True Positive Rate', gridcolor: '#e5e7eb', range: [0, 1] },
    margin: { t: 24, r: 16, b: 48, l: 56 },
    paper_bgcolor: 'white', plot_bgcolor: 'white',
    legend: { x: 0.5, y: 0.1 },
  }

  const showAlpha = state.modelType === 'ridge' || state.modelType === 'lasso'
  const showDegree = state.modelType === 'polynomial'
  const showIntercept = state.modelType === 'linear' || state.modelType === 'logistic'
  const tOrZLabel = state.modelType === 'logistic' ? 'z' : 't'

  return (
    <div className="flex h-[calc(100vh-57px)]">
      {/* ========== Left panel ========== */}
      <div className="w-80 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-4 flex flex-col gap-4">

        {/* Data input */}
        <div>
          <InfoLabel tip="Paste tabular data with a header row. Use tabs or commas as separators. First row = column names, subsequent rows = numeric values.">
            Data (header + rows)
          </InfoLabel>
          <textarea
            value={state.rawText}
            onChange={e => patch({ rawText: e.target.value, result: null })}
            rows={8}
            className="w-full text-xs font-mono border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-y"
            placeholder="x1&#9;x2&#9;y&#10;1&#9;2&#9;5&#10;..."
            spellCheck={false}
          />
        </div>

        {/* Response column */}
        {columns.length > 0 && (
          <div>
            <InfoLabel tip="Select the dependent (response) variable y.">Response (y)</InfoLabel>
            <select
              value={responseCol}
              onChange={e => patch({ responseCol: e.target.value, result: null })}
              className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
            >
              {columns.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}

        {/* Predictor columns */}
        {columns.length > 0 && (
          <div>
            <InfoLabel tip="Select one or more predictor (independent) variables. For polynomial regression select exactly one.">
              Predictors (x)
            </InfoLabel>
            <div className="flex flex-col gap-1">
              {columns.filter(c => c !== responseCol).map(c => (
                <label key={c} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={predictorCols.includes(c)}
                    onChange={() => { togglePredictor(c); patch({ result: null }) }}
                    className="rounded text-blue-600"
                  />
                  {c}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Model type */}
        <div>
          <InfoLabel tip="Choose the regression model to fit.">Model type</InfoLabel>
          <select
            value={state.modelType}
            onChange={e => patch({ modelType: e.target.value as RegressionModel, result: null })}
            className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="linear">Linear (OLS)</option>
            <option value="ridge">Ridge</option>
            <option value="lasso">Lasso</option>
            <option value="logistic">Logistic</option>
            <option value="polynomial">Polynomial</option>
          </select>
        </div>

        {/* Alpha (ridge / lasso) */}
        {showAlpha && (
          <div>
            <InfoLabel tip="Regularization strength (lambda). Larger values increase shrinkage.">
              Alpha (λ)
            </InfoLabel>
            <div className="flex gap-2 items-center">
              <input
                type="range" min={0} max={10} step={0.01}
                value={Math.min(state.alpha, 10)}
                onChange={e => {
                  const v = parseFloat(e.target.value)
                  patch({ alpha: v, alphaText: String(v), result: null })
                }}
                className="flex-1"
              />
              <input
                type="text" value={state.alphaText}
                onChange={e => {
                  patch({ alphaText: e.target.value, result: null })
                  const v = parseFloat(e.target.value)
                  if (!isNaN(v) && v >= 0) patch({ alpha: v, alphaText: e.target.value })
                }}
                className="w-16 text-xs font-mono border border-gray-300 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
          </div>
        )}

        {/* Degree (polynomial) */}
        {showDegree && (
          <div>
            <InfoLabel tip="Degree of the polynomial (1 = linear, 2 = quadratic, etc.).">
              Degree
            </InfoLabel>
            <input
              type="number" min={1} max={10}
              value={state.degreeText}
              onChange={e => {
                patch({ degreeText: e.target.value, result: null })
                const v = parseInt(e.target.value, 10)
                if (!isNaN(v) && v >= 1) patch({ degree: v, degreeText: String(v) })
              }}
              className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
        )}

        {/* Fit intercept */}
        {showIntercept && (
          <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={state.fitIntercept}
              onChange={e => patch({ fitIntercept: e.target.checked, result: null })}
              className="rounded text-blue-600"
            />
            <InfoLabel tip="Include an intercept term in the model.">Fit intercept</InfoLabel>
          </label>
        )}

        {/* Run */}
        <button
          onClick={handleRun}
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2 rounded flex items-center justify-center gap-2 transition-colors"
        >
          <Play size={14} />
          {loading ? 'Fitting…' : 'Fit Model'}
        </button>

        {error && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2 leading-relaxed">
            {error}
          </p>
        )}
      </div>

      {/* ========== Main panel ========== */}
      <div className="flex-1 overflow-auto p-4">
        {!result && (
          <div className="h-full flex items-center justify-center text-gray-400 text-sm">
            Configure data and predictors, then click <strong className="mx-1">Fit Model</strong>.
          </div>
        )}

        {result && (
          <div className="flex flex-col gap-6">

            {/* ---- Fit Statistics ---- */}
            <section>
              <h2 className="text-sm font-semibold text-gray-700 mb-2">Fit Statistics</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                <StatCard label="R²" value={fmt(result.r2)} tip="Coefficient of determination" />
                <StatCard label="RMSE" value={fmt(result.rmse)} tip="Root mean squared error" />

                {lin && (
                  <>
                    <StatCard label="Adj. R²" value={fmt(lin.adj_r2)} tip="Adjusted R²" />
                    <StatCard label="F-stat" value={fmt(lin.f_stat)} tip="Overall F-statistic" />
                    <StatCard label="F p-value" value={fmt(lin.f_pvalue)} tip="p-value for overall F-test" />
                    <StatCard label="n" value={String(lin.n)} tip="Number of observations" />
                    <StatCard label="df resid" value={String(lin.df_resid)} tip="Residual degrees of freedom" />
                  </>
                )}

                {poly && (
                  <>
                    <StatCard label="Adj. R²" value={fmt(poly.adj_r2)} tip="Adjusted R²" />
                    <StatCard label="Degree" value={String(poly.degree)} tip="Polynomial degree" />
                    <StatCard label="n" value={String(poly.n)} tip="Number of observations" />
                  </>
                )}

                {log && (
                  <>
                    <StatCard label="McFadden R²" value={fmt(log.mcfadden_r2)} tip="Pseudo R² (McFadden)" />
                    <StatCard label="Log-lik" value={fmt(log.log_likelihood)} tip="Log-likelihood" />
                    <StatCard label="AUC" value={fmt(log.roc.auc)} tip="Area under the ROC curve" />
                    <StatCard label="Accuracy" value={fmtPct(log.accuracy)} tip="Accuracy at threshold 0.5" />
                    <StatCard label="Converged" value={log.converged ? 'Yes' : 'No'} tip="Did Newton-Raphson converge?" />
                    <StatCard label="Iterations" value={String(log.n_iter)} tip="Newton-Raphson iterations" />
                  </>
                )}

                {(result.model === 'ridge' || result.model === 'lasso') && (
                  <StatCard label="Alpha (λ)" value={fmt(
                    (result as { alpha: number }).alpha
                  )} tip="Regularization strength used" />
                )}
                {result.model === 'lasso' && (
                  <StatCard label="Non-zero coef" value={String(
                    (result as { n_nonzero: number }).n_nonzero
                  )} tip="Number of non-zero coefficients after shrinkage" />
                )}
              </div>

              {/* Interpretation panel */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-3">
                <p className="text-xs font-medium text-blue-800 mb-1">Interpretation</p>
                <ul className="text-xs text-blue-700 list-disc list-inside space-y-0.5">
                  {!log && result.r2 != null && (
                    <li>
                      R² = {fmt(result.r2)} — the model explains{' '}
                      {(result.r2 * 100).toFixed(1)}% of the variance in the response.{' '}
                      {result.r2 < 0.3 ? 'This is a poor fit.' :
                       result.r2 < 0.6 ? 'This is a fair fit.' :
                       result.r2 < 0.8 ? 'This is a good fit.' :
                       'This is an excellent fit.'}
                    </li>
                  )}
                  {lin && lin.f_pvalue != null && (
                    <li>
                      The overall F-test p-value is {fmt(lin.f_pvalue)}.{' '}
                      {lin.f_pvalue < 0.05
                        ? 'The model as a whole is statistically significant — at least one predictor has a real relationship with the response.'
                        : 'The model is not statistically significant — the predictors may not explain the response better than chance.'}
                    </li>
                  )}
                  {lin && lin.p_values && lin.p_values.length > 0 && (() => {
                    const names = result.intercept != null
                      ? ['Intercept', ...result.feature_names]
                      : result.feature_names
                    const sigCoefs = names.filter((_, i) => (lin.p_values?.[i] ?? 1) < 0.05 && names[i] !== 'Intercept')
                    if (sigCoefs.length > 0) {
                      return <li>Significant predictors (p &lt; 0.05): {sigCoefs.join(', ')}.</li>
                    }
                    return <li>No individual predictor reached statistical significance at the 0.05 level.</li>
                  })()}
                  {log && (
                    <>
                      <li>
                        Classification accuracy is {fmtPct(log.accuracy)}.{' '}
                        {log.accuracy >= 0.9 ? 'The model classifies very well.' :
                         log.accuracy >= 0.7 ? 'The model has reasonable classification performance.' :
                         'The model has limited classification ability.'}
                      </li>
                      <li>
                        AUC = {fmt(log.roc.auc)}.{' '}
                        {log.roc.auc >= 0.9 ? 'Excellent discrimination between classes.' :
                         log.roc.auc >= 0.7 ? 'Acceptable discrimination between classes.' :
                         'Poor discrimination — the model struggles to separate classes.'}
                      </li>
                    </>
                  )}
                </ul>
              </div>
            </section>

            {/* ---- Coefficient Table ---- */}
            <section>
              <h2 className="text-sm font-semibold text-gray-700 mb-2">Coefficients</h2>
              <div className="overflow-x-auto">
                <table className="text-xs w-full border-collapse">
                  <thead>
                    <tr className="bg-gray-50 text-gray-600">
                      <th className="text-left px-2 py-1.5 border border-gray-200 font-medium">Term</th>
                      <th className="text-right px-2 py-1.5 border border-gray-200 font-medium">Coef</th>
                      {(lin || log) && (
                        <>
                          <th className="text-right px-2 py-1.5 border border-gray-200 font-medium">Std Err</th>
                          <th className="text-right px-2 py-1.5 border border-gray-200 font-medium">{tOrZLabel}</th>
                          <th className="text-right px-2 py-1.5 border border-gray-200 font-medium">p</th>
                          <th className="text-right px-2 py-1.5 border border-gray-200 font-medium">[95% CI</th>
                          <th className="text-right px-2 py-1.5 border border-gray-200 font-medium">95% CI]</th>
                        </>
                      )}
                      {log && (
                        <th className="text-right px-2 py-1.5 border border-gray-200 font-medium">Odds Ratio</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {coefRows.map((row, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-2 py-1 border border-gray-200 font-medium text-gray-700">{row.name}</td>
                        <td className="px-2 py-1 border border-gray-200 text-right font-mono">{fmt(row.coef)}</td>
                        {(lin || log) && (
                          <>
                            <td className="px-2 py-1 border border-gray-200 text-right font-mono">{fmt(row.se)}</td>
                            <td className="px-2 py-1 border border-gray-200 text-right font-mono">{fmt(row.tOrZ)}</td>
                            <td className={`px-2 py-1 border border-gray-200 text-right font-mono ${
                              row.p != null && row.p < 0.05 ? 'text-green-700 font-semibold' : ''
                            }`}>
                              {fmt(row.p)}
                            </td>
                            <td className="px-2 py-1 border border-gray-200 text-right font-mono">{fmt(row.ciLo)}</td>
                            <td className="px-2 py-1 border border-gray-200 text-right font-mono">{fmt(row.ciHi)}</td>
                          </>
                        )}
                        {log && (
                          <td className="px-2 py-1 border border-gray-200 text-right font-mono">{fmt(row.or)}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* ---- Logistic: Confusion Matrix ---- */}
            {log && (
              <section>
                <h2 className="text-sm font-semibold text-gray-700 mb-2">Confusion Matrix (threshold 0.5)</h2>
                <table className="text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-3 py-1.5 border border-gray-200"></th>
                      <th className="px-3 py-1.5 border border-gray-200 font-medium text-gray-600">Pred 0</th>
                      <th className="px-3 py-1.5 border border-gray-200 font-medium text-gray-600">Pred 1</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="px-3 py-1.5 border border-gray-200 font-medium text-gray-600 bg-gray-50">Act 0</td>
                      <td className="px-3 py-1.5 border border-gray-200 text-center font-mono text-green-700">{log.confusion_matrix[0][0]}</td>
                      <td className="px-3 py-1.5 border border-gray-200 text-center font-mono text-red-600">{log.confusion_matrix[0][1]}</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-1.5 border border-gray-200 font-medium text-gray-600 bg-gray-50">Act 1</td>
                      <td className="px-3 py-1.5 border border-gray-200 text-center font-mono text-red-600">{log.confusion_matrix[1][0]}</td>
                      <td className="px-3 py-1.5 border border-gray-200 text-center font-mono text-green-700">{log.confusion_matrix[1][1]}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="text-[10px] text-gray-400 mt-1">Green = correct, Red = misclassified</p>
              </section>
            )}

            {/* ---- Plots ---- */}
            <section>
              <h2 className="text-sm font-semibold text-gray-700 mb-2">Diagnostic Plots</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

                {/* Residuals vs Fitted */}
                <div>
                  <p className="text-xs text-gray-500 mb-1">Residuals vs Fitted</p>
                  <Plot
                    data={residVsFittedData}
                    layout={residVsFittedLayout}
                    config={{ displayModeBar: false, responsive: true }}
                    style={{ width: '100%', height: 280 }}
                  />
                </div>

                {/* Actual vs Predicted (non-logistic) */}
                {!log && (
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Actual vs Predicted</p>
                    <Plot
                      data={actVsPredData}
                      layout={actVsPredLayout}
                      config={{ displayModeBar: false, responsive: true }}
                      style={{ width: '100%', height: 280 }}
                    />
                  </div>
                )}

                {/* ROC curve (logistic) */}
                {log && (
                  <div>
                    <p className="text-xs text-gray-500 mb-1">ROC Curve</p>
                    <Plot
                      data={rocData}
                      layout={rocLayout}
                      config={{ displayModeBar: false, responsive: true }}
                      style={{ width: '100%', height: 280 }}
                    />
                  </div>
                )}

                {/* Polynomial fitted curve overlay */}
                {poly && (
                  <div className="lg:col-span-2">
                    <p className="text-xs text-gray-500 mb-1">Polynomial Fit</p>
                    <Plot
                      data={polyScatterData}
                      layout={polyScatterLayout}
                      config={{ displayModeBar: false, responsive: true }}
                      style={{ width: '100%', height: 300 }}
                    />
                  </div>
                )}
              </div>
            </section>

          </div>
        )}
      </div>
    </div>
  )
}
