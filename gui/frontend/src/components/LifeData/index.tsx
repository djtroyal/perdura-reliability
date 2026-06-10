import { useState } from 'react'
import Plot from 'react-plotly.js'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlotlyLayout = any
import { Play, Download } from 'lucide-react'
import FileUpload from '../shared/FileUpload'
import ResultsTable from '../shared/ResultsTable'
import {
  fitDistributions, fitNonparametric,
  FitResponse, NonparametricResponse,
} from '../../api/client'

const ALL_DISTS = [
  'Weibull_2P','Weibull_3P','Exponential_1P','Exponential_2P',
  'Normal_2P','Lognormal_2P','Lognormal_3P',
  'Gamma_2P','Gamma_3P','Loglogistic_2P','Loglogistic_3P',
  'Beta_2P','Gumbel_2P',
]

const CURVE_TABS = ['PDF', 'CDF', 'SF', 'HF'] as const
type CurveTab = typeof CURVE_TABS[number]

export default function LifeData() {
  const [failureText, setFailureText] = useState('')
  const [censoredText, setCensoredText] = useState('')
  const [method, setMethod] = useState<'MLE' | 'LS'>('MLE')
  const [ci, setCi] = useState(0.95)
  const [selectedDists, setSelectedDists] = useState<string[]>(ALL_DISTS)
  const [analysisMode, setAnalysisMode] = useState<'parametric' | 'nonparametric'>('parametric')
  const [npMethod, setNpMethod] = useState<'KM' | 'NA'>('KM')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fitResult, setFitResult] = useState<FitResponse | null>(null)
  const [npResult, setNpResult] = useState<NonparametricResponse | null>(null)
  const [curveTab, setCurveTab] = useState<CurveTab>('CDF')
  const [plotTab, setPlotTab] = useState<'probability' | 'curves' | 'nonparametric'>('probability')
  const [selectedDist, setSelectedDist] = useState<string | null>(null)

  const parseNumbers = (text: string): number[] =>
    text.split(/[\s,\n]+/).map(Number).filter(n => !isNaN(n) && n > 0)

  const handleCSV = (failures: number[], censored: number[]) => {
    setFailureText(failures.join(', '))
    setCensoredText(censored.join(', '))
  }

  const toggleDist = (d: string) =>
    setSelectedDists(prev =>
      prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])

  const run = async () => {
    const failures = parseNumbers(failureText)
    if (failures.length < 2) {
      setError('Enter at least 2 failure times.')
      return
    }
    const rc = parseNumbers(censoredText)
    setError(null)
    setLoading(true)
    try {
      if (analysisMode === 'parametric') {
        const res = await fitDistributions({
          failures,
          right_censored: rc.length ? rc : undefined,
          distributions_to_fit: selectedDists.length < ALL_DISTS.length ? selectedDists : undefined,
          method,
          CI: ci,
        })
        setFitResult(res)
        setSelectedDist(res.best_distribution)
        setPlotTab('probability')
      } else {
        const res = await fitNonparametric({
          failures,
          right_censored: rc.length ? rc : undefined,
          method: npMethod,
        })
        setNpResult(res)
        setPlotTab('nonparametric')
      }
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error running analysis.')
    } finally {
      setLoading(false)
    }
  }

  const downloadCSV = () => {
    if (!fitResult) return
    const header = 'Distribution,AICc,BIC,AD,LogLik\n'
    const rows = fitResult.results.map(r =>
      `${r.Distribution},${r.AICc ?? ''},${r.BIC ?? ''},${r.AD ?? ''},${r.LogLik}`
    ).join('\n')
    const blob = new Blob([header + rows], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'fit_results.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const ciPct = Math.round((fitResult?.CI ?? ci) * 100)

  // Build probability plot
  const probPlotData = (() => {
    if (!fitResult?.plots?.probability) return []
    const p = fitResult.plots.probability
    const traces: Record<string, unknown>[] = []
    // Confidence band (drawn first so data/fit render on top)
    if (p.line_upper && p.line_lower) {
      traces.push({ x: p.line_x, y: p.line_upper, mode: 'lines', line: { width: 0 },
        showlegend: false, hoverinfo: 'skip' })
      traces.push({ x: p.line_x, y: p.line_lower, mode: 'lines', name: `${ciPct}% CI`,
        fill: 'tonexty', fillcolor: 'rgba(239,68,68,0.15)', line: { width: 0 }, hoverinfo: 'skip' })
    }
    traces.push({ x: p.scatter_x, y: p.scatter_y, mode: 'markers', name: 'Data',
      marker: { color: '#3b82f6', size: 6 } })
    traces.push({ x: p.line_x, y: p.line_y, mode: 'lines', name: 'Fitted',
      line: { color: '#ef4444', width: 2 } })
    return traces
  })()

  const probLayout = fitResult?.plots?.probability ? {
    xaxis: { title: fitResult.plots.probability.x_label, gridcolor: '#e5e7eb' },
    yaxis: { title: fitResult.plots.probability.y_label, gridcolor: '#e5e7eb' },
    margin: { t: 30, r: 20, b: 50, l: 60 },
    paper_bgcolor: 'white', plot_bgcolor: 'white',
    showlegend: true, legend: { x: 0.02, y: 0.98 },
  } : {}

  // Build curve plot
  const curveKey = curveTab.toLowerCase() as 'pdf' | 'cdf' | 'sf' | 'hf'
  const curvePlotData = (() => {
    if (!fitResult?.plots?.curves) return []
    const c = fitResult.plots.curves
    const dyn = c as unknown as Record<string, number[] | undefined>
    const traces: Record<string, unknown>[] = []
    // Confidence band for SF/CDF (drawn first so the curve renders on top)
    const lower = dyn[`${curveKey}_lower`]
    const upper = dyn[`${curveKey}_upper`]
    if ((curveKey === 'sf' || curveKey === 'cdf') && lower && upper) {
      traces.push({ x: c.x, y: upper, mode: 'lines', line: { width: 0 },
        showlegend: false, hoverinfo: 'skip' })
      traces.push({ x: c.x, y: lower, mode: 'lines', name: `${ciPct}% CI`,
        fill: 'tonexty', fillcolor: 'rgba(59,130,246,0.15)', line: { width: 0 }, hoverinfo: 'skip' })
    }
    traces.push({
      x: c.x, y: c[curveKey], mode: 'lines',
      line: { color: '#3b82f6', width: 2 }, name: curveTab,
    })
    return traces
  })()

  const curveLayout: PlotlyLayout = {
    xaxis: { title: 'Time', gridcolor: '#e5e7eb' },
    yaxis: { title: curveTab, gridcolor: '#e5e7eb' },
    margin: { t: 30, r: 20, b: 50, l: 60 },
    paper_bgcolor: 'white', plot_bgcolor: 'white',
  }

  // Non-parametric plot
  const npPlotData = (() => {
    if (!npResult) return []
    const isKM = npResult.method === 'Kaplan-Meier'
    const yKey = isKM ? 'SF' : 'CHF'
    const yLabel = isKM ? 'Survival Function' : 'Cumulative Hazard'
    return [
      {
        x: npResult.time, y: npResult[yKey as keyof typeof npResult] as number[],
        mode: 'lines', name: yLabel, line: { color: '#3b82f6', width: 2, shape: 'hv' as const },
      },
      {
        x: npResult.time, y: npResult.CI_upper,
        mode: 'lines', name: '95% CI Upper',
        line: { color: '#93c5fd', width: 1, dash: 'dash' as const, shape: 'hv' as const },
      },
      {
        x: npResult.time, y: npResult.CI_lower,
        mode: 'lines', name: '95% CI Lower', fill: 'tonexty' as const,
        fillcolor: 'rgba(147,197,253,0.2)',
        line: { color: '#93c5fd', width: 1, dash: 'dash' as const, shape: 'hv' as const },
      },
    ]
  })()

  const tableColumns = [
    { key: 'Distribution', label: 'Distribution' },
    { key: 'AICc', label: 'AICc' },
    { key: 'BIC', label: 'BIC' },
    { key: 'AD', label: 'AD' },
    { key: 'LogLik', label: 'Log-Lik' },
  ]

  // Parameter CI table for the selected (or best) distribution
  const PARAM_NAMES = ['alpha', 'beta', 'gamma', 'mu', 'sigma', 'Lambda']
  const fmt = (v: number | null) =>
    v == null ? '—'
      : (Math.abs(v) !== 0 && (Math.abs(v) >= 1e4 || Math.abs(v) < 1e-3))
        ? v.toExponential(3) : v.toFixed(4)
  const selectedParams = (() => {
    if (!fitResult) return null
    const row = fitResult.results.find(
      r => r.Distribution === (selectedDist ?? fitResult.best_distribution))
    if (!row?.params) return null
    const p = row.params
    const rows = PARAM_NAMES.filter(n => p[n] != null).map(n => ({
      name: n,
      value: p[n] as number,
      se: (p[`${n}_se`] ?? null) as number | null,
      lower: (p[`${n}_lower`] ?? null) as number | null,
      upper: (p[`${n}_upper`] ?? null) as number | null,
    }))
    return { dist: row.Distribution, rows }
  })()

  return (
    <div className="flex h-[calc(100vh-57px)]">
      {/* Left panel */}
      <div className="w-72 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-4 flex flex-col gap-4">
        <div>
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => setAnalysisMode('parametric')}
              className={`flex-1 py-1.5 text-xs rounded font-medium border transition-colors ${
                analysisMode === 'parametric' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'
              }`}
            >Parametric</button>
            <button
              onClick={() => setAnalysisMode('nonparametric')}
              className={`flex-1 py-1.5 text-xs rounded font-medium border transition-colors ${
                analysisMode === 'nonparametric' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'
              }`}
            >Non-Parametric</button>
          </div>

          <FileUpload onData={handleCSV} label="Upload CSV (columns: value, type[F/S])" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Failure times <span className="text-gray-400">(comma or newline separated)</span>
          </label>
          <textarea
            value={failureText}
            onChange={e => setFailureText(e.target.value)}
            className="w-full h-24 text-xs border border-gray-300 rounded p-2 font-mono resize-none focus:outline-none focus:ring-1 focus:ring-blue-400"
            placeholder="100, 150, 200, 250..."
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Suspensions <span className="text-gray-400">(right-censored, optional)</span>
          </label>
          <textarea
            value={censoredText}
            onChange={e => setCensoredText(e.target.value)}
            className="w-full h-16 text-xs border border-gray-300 rounded p-2 font-mono resize-none focus:outline-none focus:ring-1 focus:ring-blue-400"
            placeholder="300, 350..."
          />
        </div>

        {analysisMode === 'parametric' ? (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Method</label>
              <div className="flex gap-2">
                {(['MLE', 'LS'] as const).map(m => (
                  <button key={m} onClick={() => setMethod(m)}
                    className={`flex-1 py-1 text-xs rounded border transition-colors ${
                      method === m ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'
                    }`}>{m}</button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Confidence level</label>
              <div className="flex gap-2">
                {([0.90, 0.95, 0.99] as const).map(c => (
                  <button key={c} onClick={() => setCi(c)}
                    className={`flex-1 py-1 text-xs rounded border transition-colors ${
                      ci === c ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'
                    }`}>{Math.round(c * 100)}%</button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-gray-700">Distributions</label>
                <div className="flex gap-1">
                  <button onClick={() => setSelectedDists(ALL_DISTS)}
                    className="text-xs text-blue-600 hover:underline">All</button>
                  <span className="text-gray-300">|</span>
                  <button onClick={() => setSelectedDists([])}
                    className="text-xs text-gray-500 hover:underline">None</button>
                </div>
              </div>
              <div className="flex flex-col gap-1 max-h-52 overflow-y-auto">
                {ALL_DISTS.map(d => (
                  <label key={d} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                    <input type="checkbox" checked={selectedDists.includes(d)}
                      onChange={() => toggleDist(d)}
                      className="rounded text-blue-600" />
                    {d}
                  </label>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Estimator</label>
            <div className="flex gap-2">
              {(['KM', 'NA'] as const).map(m => (
                <button key={m} onClick={() => setNpMethod(m)}
                  className={`flex-1 py-1 text-xs rounded border transition-colors ${
                    npMethod === m ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'
                  }`}>
                  {m === 'KM' ? 'Kaplan-Meier' : 'Nelson-Aalen'}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}

        <button
          onClick={run}
          disabled={loading}
          className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2 rounded transition-colors"
        >
          <Play size={14} />
          {loading ? 'Running...' : 'Run Analysis'}
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {fitResult && (
          <>
            {/* Tab bar */}
            <div className="bg-white border-b border-gray-200 px-4 flex items-center gap-1 pt-2">
              {[
                { id: 'probability', label: 'Probability Plot' },
                { id: 'curves', label: 'Distribution Curves' },
              ].map(t => (
                <button
                  key={t.id}
                  onClick={() => setPlotTab(t.id as typeof plotTab)}
                  className={`px-3 py-1.5 text-sm rounded-t border-b-2 transition-colors ${
                    plotTab === t.id
                      ? 'border-blue-600 text-blue-700 font-medium'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >{t.label}</button>
              ))}
              <div className="ml-auto pb-1">
                <button onClick={downloadCSV}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 border border-gray-200 px-2 py-1 rounded">
                  <Download size={12} /> Export CSV
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-hidden flex">
              {/* Results table */}
              <div className="w-80 flex-shrink-0 border-r border-gray-200 overflow-y-auto p-3">
                <p className="text-xs font-medium text-gray-500 mb-2">
                  Fit Results — best: <span className="text-green-700 font-semibold">{fitResult.best_distribution}</span>
                </p>
                <ResultsTable
                  columns={tableColumns}
                  rows={fitResult.results as unknown as Record<string, unknown>[]}
                  rowKey="Distribution"
                  selectedRow={selectedDist ?? undefined}
                  onRowClick={row => setSelectedDist(row.Distribution as string)}
                />

                {selectedParams && selectedParams.rows.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-medium text-gray-500 mb-2">
                      Parameters — <span className="font-semibold text-gray-700">{selectedParams.dist}</span>
                      <span className="text-gray-400"> ({ciPct}% CI)</span>
                    </p>
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="text-gray-500 border-b border-gray-200">
                          <th className="text-left py-1 font-medium">Param</th>
                          <th className="text-right py-1 font-medium">Value</th>
                          <th className="text-right py-1 font-medium">SE</th>
                          <th className="text-right py-1 font-medium">Lower</th>
                          <th className="text-right py-1 font-medium">Upper</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono">
                        {selectedParams.rows.map(r => (
                          <tr key={r.name} className="border-b border-gray-100">
                            <td className="py-1 text-gray-700">{r.name}</td>
                            <td className="py-1 text-right">{fmt(r.value)}</td>
                            <td className="py-1 text-right text-gray-500">{fmt(r.se)}</td>
                            <td className="py-1 text-right text-gray-500">{fmt(r.lower)}</td>
                            <td className="py-1 text-right text-gray-500">{fmt(r.upper)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Plot area */}
              <div className="flex-1 p-4 overflow-auto">
                {plotTab === 'probability' && probPlotData.length > 0 && (
                  <Plot
                    data={probPlotData as Plotly.Data[]}
                    layout={{ ...probLayout, title: `${fitResult.best_distribution} Probability Plot` } as any}
                    config={{ responsive: true, displayModeBar: true }}
                    style={{ width: '100%', height: '100%' }}
                    useResizeHandler
                  />
                )}
                {plotTab === 'curves' && curvePlotData.length > 0 && (
                  <div className="flex flex-col h-full gap-3">
                    <div className="flex gap-1">
                      {CURVE_TABS.map(t => (
                        <button key={t} onClick={() => setCurveTab(t)}
                          className={`px-3 py-1 text-xs rounded border transition-colors ${
                            curveTab === t ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'
                          }`}>{t}</button>
                      ))}
                    </div>
                    <Plot
                      data={curvePlotData as Plotly.Data[]}
                      layout={{ ...curveLayout, title: `${fitResult.best_distribution} — ${curveTab}` } as any}
                      config={{ responsive: true }}
                      style={{ width: '100%', flex: 1 }}
                      useResizeHandler
                    />
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {npResult && plotTab === 'nonparametric' && (
          <div className="flex-1 p-4">
            <Plot
              data={npPlotData as Plotly.Data[]}
              layout={{
                title: `${npResult.method} Estimate`,
                xaxis: { title: 'Time', gridcolor: '#e5e7eb' },
                yaxis: { title: npResult.method === 'Kaplan-Meier' ? 'Survival Probability' : 'Cumulative Hazard', gridcolor: '#e5e7eb' },
                margin: { t: 40, r: 20, b: 50, l: 60 },
                paper_bgcolor: 'white', plot_bgcolor: 'white',
              } as any}
              config={{ responsive: true }}
              style={{ width: '100%', height: '90%' }}
              useResizeHandler
            />
          </div>
        )}

        {!fitResult && !npResult && (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <p className="text-lg font-medium">No results yet</p>
              <p className="text-sm mt-1">Enter failure times and click Run Analysis</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
