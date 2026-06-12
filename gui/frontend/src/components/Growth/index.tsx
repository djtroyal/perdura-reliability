import { useState } from 'react'
import Plot from 'react-plotly.js'
import { Play } from 'lucide-react'
import { fitGrowth, GrowthResponse } from '../../api/client'
import { useModuleState } from '../../store/project'

type GrowthModel = 'crow-amsaa' | 'duane'

interface GrowthState {
  model: GrowthModel
  times: string
  T: string
  result?: GrowthResponse | null
}

const INITIAL_STATE: GrowthState = {
  model: 'crow-amsaa',
  times: '',
  T: '',
}

const parseNumbers = (text: string) =>
  text.split(/[\s,\n]+/).map(Number).filter(n => !isNaN(n))

export default function Growth() {
  const [s, setS] = useModuleState<GrowthState>('growth', INITIAL_STATE)
  const patch = (p: Partial<GrowthState>) => setS(prev => ({ ...prev, ...p }))

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runAnalysis = async () => {
    const times = parseNumbers(s.times)
    if (times.length < 3) {
      setError('Enter at least 3 cumulative failure times.'); return
    }
    setError(null); setLoading(true)
    try {
      const res = await fitGrowth({
        times,
        T: s.T.trim() ? parseFloat(s.T) : null,
        model: s.model,
      })
      patch({ result: res })
    } catch (e: unknown) {
      setError(
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        || 'Error fitting growth model.',
      )
    } finally { setLoading(false) }
  }

  // --- Style helpers ---
  const inputCls = 'w-full text-xs border border-gray-300 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400'
  const labelCls = 'block text-xs font-medium text-gray-700 mb-1'
  const textareaCls = 'w-full h-28 text-xs border border-gray-300 rounded p-2 font-mono resize-none focus:outline-none focus:ring-1 focus:ring-blue-400'

  // --- Results ---
  const r = s.result

  return (
    <div className="flex flex-col h-[calc(100vh-57px)]">
      {/* Body: left panel + main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel */}
        <div className="w-80 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-4 flex flex-col gap-3">
          {/* Model selection */}
          <div>
            <label className={labelCls}>Model</label>
            <select
              value={s.model}
              onChange={e => patch({ model: e.target.value as GrowthModel })}
              className={inputCls}
            >
              <option value="crow-amsaa">Crow-AMSAA (NHPP)</option>
              <option value="duane">Duane</option>
            </select>
          </div>

          {/* Failure times */}
          <div>
            <label className={labelCls}>
              Cumulative failure times <span className="text-gray-400">(comma-separated)</span>
            </label>
            <textarea
              value={s.times}
              onChange={e => patch({ times: e.target.value })}
              className={textareaCls}
              placeholder="e.g. 5, 18, 27, 43, 60, 89, 115, 148, 200..."
            />
          </div>

          {/* Total test time */}
          <div>
            <label className={labelCls}>
              T (total test time) <span className="text-gray-400">(optional)</span>
            </label>
            <input
              type="number"
              step="any"
              value={s.T}
              onChange={e => patch({ T: e.target.value })}
              className={inputCls}
              placeholder="If blank, uses last failure time"
            />
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}

          <button
            onClick={runAnalysis}
            disabled={loading}
            className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium py-2 rounded transition-colors"
          >
            <Play size={12} /> {loading ? 'Computing...' : 'Analyze'}
          </button>
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {!r ? (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <p className="text-lg font-medium">No results yet</p>
                <p className="text-sm mt-1">Enter cumulative failure times and click Analyze</p>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-6">
              {/* Results summary */}
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-800 mb-3">
                  {r.model === 'crow-amsaa' ? 'Crow-AMSAA' : 'Duane'} Model Results
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {r.model === 'crow-amsaa' ? (
                    <>
                      <Card label="Beta (shape)" value={fmt(r.beta)} />
                      <Card label="Lambda (scale)" value={fmtSci(r.Lambda)} />
                      <Card label="Growth rate" value={fmt(r.growth_rate)} />
                      <Card label="MTBF (instantaneous)" value={fmtNum(r.mtbf_instantaneous)} accent />
                    </>
                  ) : (
                    <>
                      <Card label="Alpha (growth rate)" value={fmt(r.alpha)} />
                      <Card label="A (intercept)" value={fmtSci(r.A)} />
                      <Card label="R-squared" value={fmtR2(r.r_squared)} />
                      <Card label="MTBF (instantaneous)" value={fmtNum(r.mtbf_instantaneous)} accent />
                    </>
                  )}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                  <Card label="MTBF (cumulative)" value={fmtNum(r.mtbf_cumulative)} />
                  <Card label="Total failures" value={String(r.n_failures)} />
                  <Card label="Total test time (T)" value={fmtNum(r.T)} />
                  {r.CvM != null && <Card label="CvM statistic" value={fmt(r.CvM)} />}
                </div>
              </div>

              {/* Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Cumulative failures plot */}
                <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 400 }}>
                  <Plot
                    data={[
                      {
                        x: r.scatter.t,
                        y: r.scatter.n,
                        mode: 'markers',
                        name: 'Observed',
                        marker: { color: '#ef4444', size: 7 },
                      } as Plotly.Data,
                      {
                        x: r.model_curve.t,
                        y: r.model_curve.n,
                        mode: 'lines',
                        name: 'Fitted model',
                        line: { color: '#3b82f6', width: 2 },
                      } as Plotly.Data,
                    ]}
                    layout={{
                      title: { text: 'Cumulative Failures', font: { size: 13 } },
                      xaxis: { title: { text: 'Time' }, gridcolor: '#e5e7eb' },
                      yaxis: { title: { text: 'Cumulative Failures' }, gridcolor: '#e5e7eb' },
                      margin: { t: 40, r: 20, b: 50, l: 60 },
                      paper_bgcolor: 'white', plot_bgcolor: 'white',
                      legend: { x: 0.02, y: 0.98, font: { size: 10 } },
                      showlegend: true,
                    } as Partial<Plotly.Layout>}
                    config={{ responsive: true }}
                    style={{ width: '100%', height: '100%' }}
                    useResizeHandler
                  />
                </div>

                {/* MTBF plot */}
                <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 400 }}>
                  <Plot
                    data={[
                      {
                        x: r.mtbf_curve.t,
                        y: r.mtbf_curve.cumulative,
                        mode: 'lines',
                        name: 'Cumulative MTBF',
                        line: { color: '#3b82f6', width: 2 },
                      } as Plotly.Data,
                      {
                        x: r.mtbf_curve.t,
                        y: r.mtbf_curve.instantaneous,
                        mode: 'lines',
                        name: 'Instantaneous MTBF',
                        line: { color: '#10b981', width: 2, dash: 'dash' },
                      } as Plotly.Data,
                    ]}
                    layout={{
                      title: { text: 'MTBF vs Time', font: { size: 13 } },
                      xaxis: { title: { text: 'Time' }, gridcolor: '#e5e7eb' },
                      yaxis: { title: { text: 'MTBF' }, gridcolor: '#e5e7eb' },
                      margin: { t: 40, r: 20, b: 50, l: 60 },
                      paper_bgcolor: 'white', plot_bgcolor: 'white',
                      legend: { x: 0.02, y: 0.98, font: { size: 10 } },
                      showlegend: true,
                    } as Partial<Plotly.Layout>}
                    config={{ responsive: true }}
                    style={{ width: '100%', height: '100%' }}
                    useResizeHandler
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// --- Formatting helpers ---

function fmt(v: number | undefined | null): string {
  if (v == null) return '--'
  return v.toFixed(4)
}

function fmtSci(v: number | undefined | null): string {
  if (v == null) return '--'
  return v.toExponential(4)
}

function fmtNum(v: number | undefined | null): string {
  if (v == null) return '--'
  return v.toFixed(2)
}

function fmtR2(v: number | undefined | null): string {
  if (v == null) return '--'
  return v.toFixed(4)
}

// --- Small shared components ---

function Card({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${accent ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200'}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-semibold ${accent ? 'text-blue-700' : 'text-gray-900'}`}>{value}</p>
    </div>
  )
}
