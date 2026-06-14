import { useState } from 'react'
import Plot from 'react-plotly.js'
import { Play } from 'lucide-react'
import {
  optimalReplacementTime, OptimalReplacementResponse,
  computeROCOF, ROCOFResponse,
  computeMCF, MCFResponse,
} from '../../api/client'
import { useUnits } from '../../store/project'
import InfoLabel from '../shared/InfoLabel'

const inputCls = 'w-full text-xs border border-gray-300 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400'
const labelCls = 'block text-xs font-medium text-gray-700 mb-1'
const btnCls = 'flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium py-2 rounded transition-colors'

function detail(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback
}

function Card({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${accent ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200'}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-semibold ${accent ? 'text-blue-700' : 'text-gray-900'}`}>{value}</p>
    </div>
  )
}

// ─── Optimal Replacement Time ────────────────────────────────────────────────

function OptimalReplacement() {
  const [units] = useUnits()
  const [costPM, setCostPM] = useState('1')
  const [costCM, setCostCM] = useState('5')
  const [alpha, setAlpha] = useState('1000')
  const [beta, setBeta] = useState('2.5')
  const [q, setQ] = useState('0')
  const [res, setRes] = useState<OptimalReplacementResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setError(null); setLoading(true)
    try {
      const r = await optimalReplacementTime({
        cost_PM: parseFloat(costPM), cost_CM: parseFloat(costCM),
        weibull_alpha: parseFloat(alpha), weibull_beta: parseFloat(beta),
        q: parseInt(q, 10),
      })
      setRes(r)
    } catch (e) { setError(detail(e, 'Error computing optimal replacement time.')) }
    finally { setLoading(false) }
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="w-80 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-4 flex flex-col gap-3">
        <p className="text-xs text-gray-500 leading-snug">
          Balances scheduled preventive-maintenance (PM) cost against the higher cost of
          unplanned corrective maintenance (CM) to find the replacement interval with the
          lowest cost per unit time. Only meaningful for wear-out (β &gt; 1).
        </p>
        <div>
          <InfoLabel tip="Cost of a planned preventive replacement. Must be less than the corrective cost.">Cost of preventive maintenance (PM)</InfoLabel>
          <input type="number" step="any" value={costPM} onChange={e => setCostPM(e.target.value)} className={inputCls} />
        </div>
        <div>
          <InfoLabel tip="Cost of an unplanned corrective replacement after a failure.">Cost of corrective maintenance (CM)</InfoLabel>
          <input type="number" step="any" value={costCM} onChange={e => setCostCM(e.target.value)} className={inputCls} />
        </div>
        <div>
          <InfoLabel tip="Weibull scale parameter (characteristic life) of the failure distribution.">Weibull α (scale)</InfoLabel>
          <input type="number" step="any" value={alpha} onChange={e => setAlpha(e.target.value)} className={inputCls} />
        </div>
        <div>
          <InfoLabel tip="Weibull shape parameter. Preventive replacement only pays off when β > 1 (wear-out).">Weibull β (shape)</InfoLabel>
          <input type="number" step="any" value={beta} onChange={e => setBeta(e.target.value)} className={inputCls} />
        </div>
        <div>
          <InfoLabel tip="'As good as new' renews the item (HPP renewal). 'As good as old' is minimal repair (Power-Law NHPP).">Maintenance assumption</InfoLabel>
          <select value={q} onChange={e => setQ(e.target.value)} className={inputCls}>
            <option value="0">As good as new (renewal)</option>
            <option value="1">As good as old (minimal repair)</option>
          </select>
        </div>
        {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}
        <button onClick={run} disabled={loading} className={btnCls}>
          <Play size={12} /> {loading ? 'Computing...' : 'Compute'}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {!res ? (
          <div className="h-full flex items-center justify-center text-gray-400 text-sm">
            Enter the cost model and click Compute.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
              <Card label={`Optimal replacement time (${units})`} value={res.optimal_replacement_time.toFixed(2)} accent />
              <Card label="Min cost per unit time" value={res.min_cost.toExponential(4)} />
              <Card label="Maintenance model" value={res.q === 1 ? 'As good as old' : 'As good as new'} />
            </div>
            <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 420 }}>
              <Plot
                data={[
                  { x: res.time, y: res.cost, mode: 'lines', name: 'Cost per unit time', line: { color: '#3b82f6', width: 2 } } as Plotly.Data,
                  { x: [res.optimal_replacement_time], y: [res.min_cost], mode: 'markers', name: 'Optimum', marker: { color: '#ef4444', size: 10, symbol: 'star' } } as Plotly.Data,
                ]}
                layout={{
                  title: { text: 'Cost per Unit Time vs Replacement Interval', font: { size: 13 } },
                  xaxis: { title: { text: `Replacement time (${units})` }, gridcolor: '#e5e7eb' },
                  yaxis: { title: { text: 'Cost per unit time' }, gridcolor: '#e5e7eb' },
                  margin: { t: 40, r: 20, b: 50, l: 70 }, paper_bgcolor: 'white', plot_bgcolor: 'white',
                  legend: { x: 0.98, y: 0.98, xanchor: 'right', font: { size: 10 } },
                } as Partial<Plotly.Layout>}
                config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── ROCOF ───────────────────────────────────────────────────────────────────

function Rocof() {
  const [units] = useUnits()
  const [mode, setMode] = useState<'gaps' | 'cumulative'>('gaps')
  const [text, setText] = useState('')
  const [testEnd, setTestEnd] = useState('')
  const [ci, setCi] = useState('0.95')
  const [res, setRes] = useState<ROCOFResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parse = () => text.split(/[\s,\n]+/).map(v => parseFloat(v)).filter(n => !isNaN(n))

  const run = async () => {
    const vals = parse()
    if (vals.length < 2) { setError('Enter at least 2 values.'); return }
    setError(null); setLoading(true)
    try {
      const r = await computeROCOF({
        times_between_failures: mode === 'gaps' ? vals : null,
        failure_times: mode === 'cumulative' ? vals : null,
        test_end: testEnd.trim() ? parseFloat(testEnd) : null,
        CI: parseFloat(ci),
      })
      setRes(r)
    } catch (e) { setError(detail(e, 'Error computing ROCOF.')) }
    finally { setLoading(false) }
  }

  const trendColor = res?.trend === 'improving' ? 'text-green-600'
    : res?.trend === 'worsening' ? 'text-red-600' : 'text-gray-600'

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="w-80 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-4 flex flex-col gap-3">
        <p className="text-xs text-gray-500 leading-snug">
          Tests whether failure inter-arrival times show a statistically significant trend
          (Laplace test). When a trend exists, a Power-Law NHPP is fitted.
        </p>
        <div>
          <InfoLabel tip="Inter-arrival times are the gaps between successive failures. Cumulative are the system ages at each failure.">Input type</InfoLabel>
          <div className="flex gap-2">
            {([['gaps', 'Inter-arrival'], ['cumulative', 'Cumulative']] as const).map(([v, lbl]) => (
              <button key={v} onClick={() => setMode(v)}
                className={`flex-1 py-1 text-xs rounded border transition-colors ${mode === v ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}>{lbl}</button>
            ))}
          </div>
        </div>
        <div>
          <label className={labelCls}>{mode === 'gaps' ? 'Times between failures' : 'Cumulative failure times'} ({units})</label>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={6}
            placeholder="Comma or newline separated" className={inputCls + ' resize-none'} />
        </div>
        <div>
          <InfoLabel tip="Total observation time. Leave blank if the test ended at the last failure (failure-terminated).">Test end time (optional)</InfoLabel>
          <input type="number" step="any" value={testEnd} onChange={e => setTestEnd(e.target.value)} className={inputCls} placeholder="Failure-terminated if blank" />
        </div>
        <div>
          <InfoLabel tip="Confidence level for the two-sided trend test.">Confidence level</InfoLabel>
          <select value={ci} onChange={e => setCi(e.target.value)} className={inputCls}>
            <option value="0.90">90%</option><option value="0.95">95%</option><option value="0.99">99%</option>
          </select>
        </div>
        {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}
        <button onClick={run} disabled={loading} className={btnCls}><Play size={12} /> {loading ? 'Computing...' : 'Run trend test'}</button>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {!res ? (
          <div className="h-full flex items-center justify-center text-gray-400 text-sm">Enter failure data and run the trend test.</div>
        ) : (
          <>
            <div className="mb-5">
              <p className="text-sm text-gray-500 mb-1">Trend</p>
              <p className={`text-3xl font-bold capitalize ${trendColor}`}>{res.trend}</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card label="Laplace U statistic" value={res.U.toFixed(4)} />
              <Card label="Critical z" value={`±${res.z_crit.toFixed(3)}`} />
              <Card label="p-value" value={res.p_value.toExponential(3)} />
              <Card label="Failures" value={String(res.n_failures)} />
              {res.ROCOF != null && <Card label={`Constant ROCOF (per ${units.replace(/s$/, '')})`} value={res.ROCOF.toExponential(4)} accent />}
              {res.Beta_hat != null && <Card label="NHPP β̂" value={res.Beta_hat.toFixed(4)} accent />}
              {res.Lambda_hat != null && <Card label="NHPP λ̂" value={res.Lambda_hat.toExponential(4)} />}
            </div>
            <p className="text-xs text-gray-500 mt-4 max-w-xl">
              {res.trend === 'no trend'
                ? 'No statistically significant trend: the rate of occurrence of failures is treated as constant (homogeneous Poisson process).'
                : `A statistically significant ${res.trend} trend was detected; the failure intensity is modelled by a Power-Law NHPP with the parameters above.`}
            </p>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Mean Cumulative Function ────────────────────────────────────────────────

function MCF() {
  const [units] = useUnits()
  const [text, setText] = useState('5, 10, 15, 17\n6, 13, 17\n12, 20, 25, 26\n4, 9, 13, 17')
  const [ci, setCi] = useState('0.95')
  const [parametric, setParametric] = useState(true)
  const [res, setRes] = useState<MCFResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parse = (): number[][] =>
    text.split('\n').map(line => line.split(/[\s,]+/).map(v => parseFloat(v)).filter(n => !isNaN(n)))
      .filter(row => row.length > 0)

  const run = async () => {
    const data = parse()
    if (data.length < 1) { setError('Enter at least one system (one row).'); return }
    setError(null); setLoading(true)
    try {
      const r = await computeMCF({ data, CI: parseFloat(ci), parametric })
      setRes(r)
    } catch (e) { setError(detail(e, 'Error computing MCF.')) }
    finally { setLoading(false) }
  }

  const np = res?.nonparametric
  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="w-80 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-4 flex flex-col gap-3">
        <p className="text-xs text-gray-500 leading-snug">
          Estimates the average cumulative number of repairs per system over time. A
          concave-down (levelling) shape means improving; straight means constant; concave-up
          means worsening.
        </p>
        <div>
          <InfoLabel tip="One system per line. Within each line the largest value is treated as the end-of-observation (censoring) time and the smaller values are repair times.">Repair data (one system per line)</InfoLabel>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={8}
            className={inputCls + ' resize-none'} placeholder="5, 10, 15, 17" />
          <p className="text-[10px] text-gray-400 mt-1">Largest value per row = censoring time; the rest are repairs.</p>
        </div>
        <div>
          <InfoLabel tip="Confidence level for the bounds on the non-parametric MCF.">Confidence level</InfoLabel>
          <select value={ci} onChange={e => setCi(e.target.value)} className={inputCls}>
            <option value="0.90">90%</option><option value="0.95">95%</option><option value="0.99">99%</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-700">
          <input type="checkbox" checked={parametric} onChange={e => setParametric(e.target.checked)} />
          Also fit power-law (parametric) MCF
        </label>
        {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}
        <button onClick={run} disabled={loading} className={btnCls}><Play size={12} /> {loading ? 'Computing...' : 'Compute MCF'}</button>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {!np ? (
          <div className="h-full flex items-center justify-center text-gray-400 text-sm">Enter repair data and compute the MCF.</div>
        ) : (
          <>
            {res?.parametric && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
                <Card label="Power-law β" value={res.parametric.beta.toFixed(4)} accent />
                <Card label="Power-law α" value={res.parametric.alpha.toFixed(2)} />
                <Card label="R²" value={res.parametric.r_squared.toFixed(4)} />
              </div>
            )}
            <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 440 }}>
              <Plot
                data={[
                  { x: np.time, y: np.MCF_upper, mode: 'lines', name: `Upper ${(np.CI * 100).toFixed(0)}%`, line: { width: 0 }, showlegend: false } as Plotly.Data,
                  { x: np.time, y: np.MCF_lower, mode: 'lines', name: 'CI', fill: 'tonexty', fillcolor: 'rgba(59,130,246,0.12)', line: { width: 0 } } as Plotly.Data,
                  { x: np.time, y: np.MCF, mode: 'lines+markers', name: 'MCF (non-parametric)', line: { color: '#3b82f6', width: 2, shape: 'hv' }, marker: { size: 5 } } as Plotly.Data,
                  ...(res?.parametric ? [{ x: res.parametric.time, y: res.parametric.MCF, mode: 'lines', name: 'MCF (power-law)', line: { color: '#ef4444', width: 2, dash: 'dash' } } as Plotly.Data] : []),
                ]}
                layout={{
                  title: { text: 'Mean Cumulative Function', font: { size: 13 } },
                  xaxis: { title: { text: `Time (${units})` }, gridcolor: '#e5e7eb' },
                  yaxis: { title: { text: 'Mean cumulative repairs' }, gridcolor: '#e5e7eb' },
                  margin: { t: 40, r: 20, b: 50, l: 60 }, paper_bgcolor: 'white', plot_bgcolor: 'white',
                  legend: { x: 0.02, y: 0.98, font: { size: 10 } },
                } as Partial<Plotly.Layout>}
                config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function RepairableTools({ tool }: { tool: 'replacement' | 'rocof' | 'mcf' }) {
  if (tool === 'replacement') return <OptimalReplacement />
  if (tool === 'rocof') return <Rocof />
  return <MCF />
}
