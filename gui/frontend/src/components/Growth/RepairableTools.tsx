import { useState } from 'react'
import Plot from '../shared/ExportablePlot'
import { Play } from 'lucide-react'
import {
  computeROCOF, ROCOFResponse,
  computeMCF, MCFResponse,
} from '../../api/client'
import { useUnits } from '../../store/project'
import InfoLabel from '../shared/InfoLabel'
import { Card } from '../shared/ui'
import { inputCls, labelCls, btnCls } from '../shared/styles'

function detail(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback
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
  const [text, setText] = useState('5, 10, 15 | 17\n6, 13 | 17\n12, 20, 25 | 26\n4, 9, 13 | 17')
  const [ci, setCi] = useState('0.95')
  const [parametric, setParametric] = useState(true)
  const [intervalMethod, setIntervalMethod] = useState<'log_transformed' | 'cluster_bootstrap'>('log_transformed')
  const [bootstrapSamples, setBootstrapSamples] = useState('500')
  const [res, setRes] = useState<MCFResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parse = (): { data: number[][]; observation_ends: number[] } => {
    const data: number[][] = []
    const observation_ends: number[] = []
    for (const [index, raw] of text.split('\n').entries()) {
      if (!raw.trim()) continue
      const parts = raw.split('|')
      if (parts.length !== 2) throw new Error(`Row ${index + 1}: use "events | observation end".`)
      const events = parts[0].split(/[\s,]+/).map(v => parseFloat(v)).filter(n => !isNaN(n))
      const end = parseFloat(parts[1].trim())
      if (!Number.isFinite(end)) throw new Error(`Row ${index + 1}: observation end is missing.`)
      if (events.some(event => event > end)) throw new Error(`Row ${index + 1}: an event occurs after observation end ${end}.`)
      data.push(events); observation_ends.push(end)
    }
    return { data, observation_ends }
  }

  const run = async () => {
    try {
      const { data, observation_ends } = parse()
      if (data.length < 1) { setError('Enter at least one system (one row).'); return }
      setError(null); setLoading(true)
      const r = await computeMCF({
        data, observation_ends, CI: parseFloat(ci), parametric,
        interval_method: intervalMethod,
        bootstrap_samples: intervalMethod === 'cluster_bootstrap' ? parseInt(bootstrapSamples) || 500 : 0,
      })
      setRes(r)
    } catch (e) { setError(e instanceof Error && !('response' in e) ? e.message : detail(e, 'Error computing MCF.')) }
    finally { setLoading(false) }
  }

  const np = res?.nonparametric
  const resTrend = res ? (res as MCFResponse & { trend?: { trend: string; detail: string } }).trend : null
  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="w-80 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-4 flex flex-col gap-3">
        <p className="text-xs text-gray-500 leading-snug">
          Estimates the average cumulative number of repairs per system over time. A
          concave-down (levelling) shape means improving; straight means constant; concave-up
          means worsening.
        </p>
        <div>
          <InfoLabel tip="One system per line in explicit 'event times | observation end' form. An event may equal the observation end and will still be counted.">Repair data (events | end)</InfoLabel>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={8}
            className={inputCls + ' resize-none'} placeholder="5, 10, 15 | 17" />
          <p className="text-[10px] text-gray-400 mt-1">The value after | is censoring; every value before | is an event, including ties at the endpoint.</p>
        </div>
        <div>
          <InfoLabel tip="Log-transformed bounds use the subject-cluster robust variance. Cluster bootstrap resamples complete system histories and is slower.">Interval method</InfoLabel>
          <select value={intervalMethod} onChange={e => setIntervalMethod(e.target.value as typeof intervalMethod)} className={inputCls}>
            <option value="log_transformed">Robust log-transformed</option>
            <option value="cluster_bootstrap">System-cluster bootstrap</option>
          </select>
        </div>
        {intervalMethod === 'cluster_bootstrap' && (
          <div>
            <InfoLabel tip="Number of complete-system history resamples. Use at least 500 for routine work and more for tail quantiles.">Bootstrap samples</InfoLabel>
            <input type="number" min="50" max="10000" step="50" value={bootstrapSamples}
              onChange={e => setBootstrapSamples(e.target.value)} className={inputCls} />
          </div>
        )}
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
            {resTrend && (
              <div className={`mb-4 flex items-start gap-3 rounded-lg border p-3 ${
                resTrend.trend === 'improving' ? 'bg-green-50 border-green-200' :
                resTrend.trend === 'worsening' ? 'bg-red-50 border-red-200' :
                'bg-gray-50 border-gray-200'
              }`}>
                <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded ${
                  resTrend.trend === 'improving' ? 'bg-green-100 text-green-700' :
                  resTrend.trend === 'worsening' ? 'bg-red-100 text-red-700' :
                  'bg-gray-100 text-gray-600'
                }`}>{resTrend.trend}</span>
                <p className="text-xs text-gray-600 leading-snug">{resTrend.detail}</p>
              </div>
            )}
            <div className="mb-3 grid grid-cols-2 md:grid-cols-4 gap-2">
              <Card label="Systems" value={String(np.n_systems)} />
              <Card label="Events" value={String(np.n_events)} />
              <Card label="Tail risk set" value={String(np.at_risk[np.at_risk.length - 1] ?? '—')} />
              <Card label="Interval" value={np.interval_method === 'cluster_bootstrap' ? 'Cluster bootstrap' : 'Robust log'} />
            </div>
            {np.tail_warning && (
              <p className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">{np.tail_warning}</p>
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

export default function RepairableTools({ tool }: { tool: 'rocof' | 'mcf' }) {
  if (tool === 'rocof') return <Rocof />
  return <MCF />
}
