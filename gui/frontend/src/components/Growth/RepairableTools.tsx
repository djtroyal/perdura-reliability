import { useEffect, useRef, useState } from 'react'
import Plot from '../shared/ExportablePlot'
import { Play } from 'lucide-react'
import {
  computeROCOF, ROCOFResponse,
  computeMCF, MCFResponse,
} from '../../api/client'
import { useUnits } from '../../store/project'
import InfoLabel from '../shared/InfoLabel'
import ConfidenceInput from '../shared/ConfidenceInput'
import { Card } from '../shared/ui'
import { inputCls, labelCls, btnCls } from '../shared/styles'
import {
  createMCFRequestToken,
  INITIAL_MCF_STATE,
  isMCFRequestTokenCurrent,
  parseMCFWideText,
  parseStrictFiniteNumber,
  type MCFState,
} from './mcfContracts'

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
          <input type="number" min="0" step="1" value={testEnd} onChange={e => setTestEnd(e.target.value)} className={inputCls} placeholder="Failure-terminated if blank" />
        </div>
        <div>
          <InfoLabel tip="Confidence level for the two-sided trend test; 0.95 = 95%.">Confidence level</InfoLabel>
          <ConfidenceInput value={ci} onChange={setCi} className="w-full" />
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

type SetMCFState = (value: MCFState | ((previous: MCFState) => MCFState)) => void

function MCF({ state, setState, folioId }: {
  state: MCFState
  setState: SetMCFState
  folioId: string
}) {
  const [units] = useUnits()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  const latestStateRef = useRef(state)
  const latestFolioRef = useRef(folioId)
  latestStateRef.current = state
  latestFolioRef.current = folioId

  useEffect(() => {
    // A response launched from the previously selected analysis must not
    // update the newly selected one or leave its spinner active.
    requestIdRef.current += 1
    setLoading(false)
    setError(null)
  }, [folioId])

  const patch = (value: Partial<MCFState>) => {
    requestIdRef.current += 1
    setLoading(false)
    setError(null)
    setState(previous => ({ ...previous, ...value, result: null }))
  }

  const run = async () => {
    let requestToken: ReturnType<typeof createMCFRequestToken> | null = null
    const requestIsCurrent = () => requestToken == null || isMCFRequestTokenCurrent(
      requestToken,
      latestFolioRef.current,
      latestStateRef.current,
      requestIdRef.current,
    )
    try {
      const { data, observation_ends } = parseMCFWideText(state.text)
      if (data.length < 1) { setError('Enter at least one system (one row).'); return }
      const eventCount = data.reduce((total, row) => total + row.length, 0)
      if (eventCount < 1) { setError('Enter at least one repair event.'); return }
      if (state.parametric && eventCount < 2) {
        setError('The optional power-law fit requires at least 2 repair events.'); return
      }
      if (state.parametric && data.some(row => row.some(time => time <= 0))) {
        setError('Power-law MCF event times must be greater than zero.'); return
      }
      const confidence = parseStrictFiniteNumber(state.ciText, 'Confidence level')
      if (confidence <= 0 || confidence >= 1) {
        setError('Confidence level must be between 0 and 1.'); return
      }
      let bootstrapSamples = 0
      if (state.intervalMethod === 'cluster_bootstrap') {
        bootstrapSamples = parseStrictFiniteNumber(
          state.bootstrapSamples, 'Bootstrap samples')
        if (!Number.isInteger(bootstrapSamples)
            || bootstrapSamples < 50 || bootstrapSamples > 10_000) {
          setError('Bootstrap samples must be a whole number from 50 to 10,000.'); return
        }
      }

      const requestId = ++requestIdRef.current
      requestToken = createMCFRequestToken(folioId, state, requestId)
      setError(null); setLoading(true)
      const r = await computeMCF({
        data, observation_ends, CI: confidence, parametric: state.parametric,
        interval_method: state.intervalMethod,
        bootstrap_samples: bootstrapSamples,
      })
      if (requestIsCurrent()) setState(previous => ({ ...previous, result: r }))
    } catch (e) {
      const localMessage = e instanceof Error
        && !(e as Error & { response?: unknown }).response ? e.message : null
      // Parsing errors happen before a token is made, while API errors happen
      // afterward. Input mutation clears both through patch().
      if (requestIsCurrent()) {
        setError(localMessage ?? detail(e, 'Error computing MCF.'))
      }
    } finally {
      // Do not let an older request stop the spinner for a newer one.
      if (requestIsCurrent()) setLoading(false)
    }
  }

  const res = state.result
  const np = res?.nonparametric
  const resTrend = res?.trend
  const parametric = res?.parametric
  const intervalPct = np ? `${(100 * np.CI).toFixed(1).replace('.0', '')}%` : ''
  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="w-80 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-4 flex flex-col gap-3">
        <p className="text-xs text-gray-500 leading-snug">
          Estimates the average cumulative number of repairs per system over time. A
          concave-down (levelling) shape descriptively suggests improvement; straight suggests
          a constant recurrence rate; concave-up suggests worsening. Use the optional power-law
          β profile interval for model-based trend inference.
        </p>
        <div>
          <InfoLabel tip="One system per line in explicit 'event times | observation end' form. An event may equal the observation end and will still be counted.">Repair data (events | end)</InfoLabel>
          <textarea value={state.text} onChange={e => patch({ text: e.target.value })} rows={8}
            className={inputCls + ' resize-none'} placeholder="5, 10, 15 | 17" />
          <p className="text-[10px] text-gray-400 mt-1">The value after | is censoring; every value before | is an event, including ties at the endpoint.</p>
        </div>
        <div>
          <InfoLabel tip="Log-transformed bounds use the subject-cluster robust variance. Cluster bootstrap resamples complete system histories and is slower.">Interval method</InfoLabel>
          <select value={state.intervalMethod} onChange={e => patch({ intervalMethod: e.target.value as MCFState['intervalMethod'] })} className={inputCls}>
            <option value="log_transformed">Robust log-transformed</option>
            <option value="cluster_bootstrap">System-cluster bootstrap</option>
          </select>
        </div>
        {state.intervalMethod === 'cluster_bootstrap' && (
          <div>
            <InfoLabel tip="Number of complete-system history resamples. Use at least 500 for routine work and more for tail quantiles.">Bootstrap samples</InfoLabel>
            <input type="number" min="50" max="10000" step="50" value={state.bootstrapSamples}
              onChange={e => patch({ bootstrapSamples: e.target.value })} className={inputCls} />
          </div>
        )}
        <div>
          <InfoLabel tip="Confidence level for the bounds on the non-parametric MCF; 0.95 = 95%.">Confidence level</InfoLabel>
          <ConfidenceInput value={state.ciText} onChange={value => patch({ ciText: value })} className="w-full" />
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-700">
          <input type="checkbox" checked={state.parametric} onChange={e => patch({ parametric: e.target.checked })} />
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
            {parametric && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                <Card label={`Power-law β (${intervalPct} profile)`}
                  value={`${parametric.beta.toFixed(4)} [${parametric.beta_lower?.toFixed(4) ?? '—'}, ${parametric.beta_upper?.toFixed(4) ?? '—'}]`} accent />
                <Card label="Power-law Λ" value={parametric.Lambda.toExponential(4)} />
                <Card label={`MCF at ${parametric.endpoint_time.toPrecision(5)}`}
                  value={`${parametric.endpoint_MCF.toFixed(4)} [${parametric.endpoint_MCF_lower?.toFixed(4) ?? '—'}, ${parametric.endpoint_MCF_upper?.toFixed(4) ?? '—'}]`} />
                <Card label="Descriptive log-log R²"
                  value={parametric.r_squared == null ? 'Unavailable' : parametric.r_squared.toFixed(4)} />
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
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Descriptive shape indicator — not a trend test</p>
                  <p className="text-xs text-gray-600 leading-snug">{resTrend.detail}</p>
                </div>
              </div>
            )}
            <div className="mb-3 grid grid-cols-2 md:grid-cols-4 gap-2">
              <Card label="Systems" value={String(np.n_systems)} />
              <Card label="Events" value={String(np.n_events)} />
              <Card label="Tail risk set" value={String(np.at_risk[np.at_risk.length - 1] ?? '—')} />
              <Card label="Interval status" value={np.interval_status.replace(/_/g, ' ')}
                tip={np.interval_reason ?? undefined} />
            </div>
            {np.tail_warning && (
              <p className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">{np.tail_warning}</p>
            )}
            <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 440 }}>
              <Plot
                data={[
                  ...(np.interval_point_available.some(Boolean) ? [
                    { x: np.time, y: np.MCF_upper, mode: 'lines', name: `Upper ${(np.CI * 100).toFixed(0)}%`, line: { width: 0 }, showlegend: false } as Plotly.Data,
                    { x: np.time, y: np.MCF_lower, mode: 'lines', name: 'CI', fill: 'tonexty', fillcolor: 'rgba(59,130,246,0.12)', line: { width: 0 } } as Plotly.Data,
                  ] : []),
                  { x: np.time, y: np.MCF, mode: 'lines+markers', name: 'MCF (non-parametric)', line: { color: '#3b82f6', width: 2, shape: 'hv' }, marker: { size: 5 } } as Plotly.Data,
                  ...(parametric ? [{ x: parametric.time, y: parametric.MCF, mode: 'lines', name: 'MCF (power-law)', line: { color: '#ef4444', width: 2, dash: 'dash' } } as Plotly.Data] : []),
                ]}
                layout={{
                  title: { text: 'Mean Cumulative Function', font: { size: 13 } },
                  xaxis: { title: { text: `Time (${units})` }, gridcolor: '#e5e7eb' },
                  yaxis: { title: { text: 'Mean cumulative repairs' }, gridcolor: '#e5e7eb' },
                  margin: { t: 40, r: 20, b: 50, l: 60 }, paper_bgcolor: 'white', plot_bgcolor: 'white',
                  legend: { x: 0.02, y: 0.98, font: { size: 10 } },
                } as Partial<Plotly.Layout>}
                config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler
                plotId="mean-cumulative-function"
              />
            </div>
            <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full min-w-[760px] text-xs">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="px-2 py-1.5 text-right">Time</th>
                    <th className="px-2 py-1.5 text-right">MCF</th>
                    <th className="px-2 py-1.5 text-right">Lower</th>
                    <th className="px-2 py-1.5 text-right">Upper</th>
                    <th className="px-2 py-1.5 text-right">At risk</th>
                    <th className="px-2 py-1.5 text-right">Events</th>
                    <th className="px-2 py-1.5 text-left">Interval availability</th>
                    {np.bootstrap && <th className="px-2 py-1.5 text-right">Valid bootstrap replicates</th>}
                  </tr>
                </thead>
                <tbody>
                  {np.time.map((time, i) => (
                    <tr key={`${time}-${i}`} className="border-t border-gray-100">
                      <td className="px-2 py-1 text-right font-mono">{time.toPrecision(6)}</td>
                      <td className="px-2 py-1 text-right font-mono">{np.MCF[i].toPrecision(6)}</td>
                      <td className="px-2 py-1 text-right font-mono">{np.MCF_lower[i]?.toPrecision(6) ?? '—'}</td>
                      <td className="px-2 py-1 text-right font-mono">{np.MCF_upper[i]?.toPrecision(6) ?? '—'}</td>
                      <td className="px-2 py-1 text-right">{np.at_risk[i]}</td>
                      <td className="px-2 py-1 text-right">{np.events_at_time[i]}</td>
                      <td className={`px-2 py-1 ${np.interval_point_available[i] ? 'text-emerald-700' : 'text-amber-700'}`}>
                        {np.interval_point_available[i] ? 'Available' : 'Withheld'}
                      </td>
                      {np.bootstrap && <td className="px-2 py-1 text-right">
                        {np.bootstrap.valid_replicates[i]} / {np.bootstrap.samples}
                      </td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs font-semibold text-gray-700">Methods and assumptions</p>
              <p className="mt-1 text-[11px] text-gray-600">
                Non-parametric variance: {np.variance_method.replace(/_/g, ' ')}.
                {' '}Intervals: {np.interval_method.replace(/_/g, ' ')}.
                {parametric && ` Parametric optimizer: ${parametric.optimizer.replace(/_/g, ' ')}; interval status: ${parametric.interval_status.replace(/_/g, ' ')}.`}
              </p>
              <ul className="mt-1 list-disc pl-5 text-[11px] text-gray-600">
                {res?.assumptions.map(assumption => <li key={assumption}>{assumption}</li>)}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function RepairableTools({ tool, mcfState, setMcfState, folioId }: {
  tool: 'rocof' | 'mcf'
  mcfState?: MCFState
  setMcfState?: SetMCFState
  folioId?: string
}) {
  if (tool === 'rocof') return <Rocof />
  return <MCF
    state={mcfState ?? INITIAL_MCF_STATE}
    setState={setMcfState ?? (() => undefined)}
    folioId={folioId ?? 'default'}
  />
}
