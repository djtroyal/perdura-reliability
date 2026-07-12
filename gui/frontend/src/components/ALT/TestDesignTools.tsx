import { useState } from 'react'
import Plot from '../shared/ExportablePlot'
import {
  rdtExpectedFailureTimes, ExpectedFailureTimesResponse,
  rdtDifferenceDetection, DifferenceDetectionResponse,
  testSimulation, TestSimulationResponse,
} from '../../api/client'
import {
  ToolLayout, ToolTabs, Card, Field, Select,
  detail, fmtNum, inputCls, labelCls, PLOT_CFG, plotBase,
  ToolDef,
} from './toolkit'
import { useModuleState } from '../../store/project'
import ConvergencePlot from '../shared/ConvergencePlot'

// Persisted Difference-Detection state (inputs + result) so it survives tab
// switches and is available as a Report Builder asset.
interface DiffDetState {
  metric: 'B10' | 'mean'; conf: string; b1: string; n1: string; b2: string; n2: string
  mMin: string; mMax: string; mInc: string; times: string
  result: DifferenceDetectionResponse | null
}
const INITIAL_DIFFDET: DiffDetState = {
  metric: 'B10', conf: '95', b1: '3', n1: '20', b2: '2', n2: '20',
  mMin: '500', mMax: '3000', mInc: '500', times: '3000, 5000', result: null,
}

const DIST_OPTS = [
  { value: 'Weibull', label: 'Weibull' },
  { value: 'Normal', label: 'Normal' },
  { value: 'Lognormal', label: 'Lognormal' },
  { value: 'Exponential', label: 'Exponential' },
]

// ─── 1. Expected Failure Times ───────────────────────────────────────────────

export function ExpectedFailureTimes() {
  const [n, setN] = useState('4')
  const [dist, setDist] = useState('Weibull')
  const [beta, setBeta] = useState('2')
  const [eta, setEta] = useState('500')
  const [conf, setConf] = useState('95')
  const [res, setRes] = useState<ExpectedFailureTimesResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const run = async () => {
    setErr(null); setLoading(true)
    try {
      const r = await rdtExpectedFailureTimes({
        n: parseInt(n, 10),
        distribution: dist,
        beta: parseFloat(beta),
        eta: parseFloat(eta),
        confidence: parseFloat(conf) / 100,
      })
      setRes(r)
    } catch (e) { setErr(detail(e, 'Computation failed.')) } finally { setLoading(false) }
  }

  const controls = (
    <>
      <Field label="Sample size (n)" tip="Number of units on test. The expected ordered failure times (and their bounds) are computed for each unit." value={n} onChange={setN} />
      <Select label="Distribution" value={dist} onChange={setDist} options={DIST_OPTS} />
      <Field label="Weibull β / Normal σ / Lognormal σ" tip="Shape parameter (Weibull β) or spread (Normal σ, Lognormal σ of ln-time). Ignored for Exponential." value={beta} onChange={setBeta} />
      <Field label="Weibull η / Normal μ / Lognormal μ / Exp MTTF" tip="Scale/location parameter." value={eta} onChange={setEta} />
      <Field label="Confidence level (%)" tip="Confidence level for the low/high bounds on each order statistic." value={conf} onChange={setConf} />
    </>
  )

  const results = res && (
    <div className="space-y-5">
      <div className="bg-white border border-gray-200 rounded-lg">
        <Plot
          data={[{
            x: res.rows.map(r => r.median),
            y: res.rows.map(r => r.order),
            error_x: {
              type: 'data',
              symmetric: false,
              array: res.rows.map(r => r.high - r.median),
              arrayminus: res.rows.map(r => r.median - r.low),
              color: '#9ca3af',
              thickness: 1.5,
              width: 6,
            },
            mode: 'markers',
            marker: { color: '#3b82f6', size: 8 },
            name: 'Median',
          }] as Plotly.Data[]}
          layout={{
            ...plotBase, height: 320,
            title: { text: 'Expected Failure Times', font: { size: 13 } },
            xaxis: { title: { text: 'Time' }, gridcolor: '#e5e7eb' },
            yaxis: { title: { text: 'Unit' }, dtick: 1, gridcolor: '#e5e7eb' },
          } as Plotly.Layout}
          config={PLOT_CFG} style={{ width: '100%' }} useResizeHandler />
      </div>
      <table className="w-full text-xs border border-gray-200 rounded">
        <thead className="bg-gray-50"><tr>
          <th className="px-3 py-1.5 text-left font-medium text-gray-600">Order</th>
          <th className="px-3 py-1.5 text-right font-medium text-gray-600">Low</th>
          <th className="px-3 py-1.5 text-right font-medium text-gray-600">Median</th>
          <th className="px-3 py-1.5 text-right font-medium text-gray-600">High</th>
        </tr></thead>
        <tbody>
          {res.rows.map(r => (
            <tr key={r.order} className="border-t border-gray-100">
              <td className="px-3 py-1 text-gray-700">{r.order}</td>
              <td className="px-3 py-1 text-right font-mono">{fmtNum(r.low)}</td>
              <td className="px-3 py-1 text-right font-mono">{fmtNum(r.median)}</td>
              <td className="px-3 py-1 text-right font-mono">{fmtNum(r.high)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return <ToolLayout intro="Predicts the expected ordered failure times for a test of n units drawn from the specified life distribution, with confidence bounds on each order statistic. Useful for scheduling inspections and planning test duration." controls={controls} err={err} loading={loading} onRun={run} runLabel="Compute" results={results} />
}

// ─── 2. Difference Detection Matrix ──────────────────────────────────────────

const METRIC_OPTS = [
  { value: 'B10', label: 'B10 life' },
  { value: 'mean', label: 'Mean life' },
]

export function DifferenceDetection() {
  const [st, setSt] = useModuleState<DiffDetState>('differenceDetection', INITIAL_DIFFDET)
  const patchSt = (p: Partial<DiffDetState>) => setSt(prev => ({ ...prev, ...p }))
  const { metric, conf, b1, n1, b2, n2, mMin, mMax, mInc, times } = st
  const res = st.result
  const setMetric = (v: 'B10' | 'mean') => patchSt({ metric: v })
  const setConf = (v: string) => patchSt({ conf: v })
  const setB1 = (v: string) => patchSt({ b1: v })
  const setN1 = (v: string) => patchSt({ n1: v })
  const setB2 = (v: string) => patchSt({ b2: v })
  const setN2 = (v: string) => patchSt({ n2: v })
  const setMMin = (v: string) => patchSt({ mMin: v })
  const setMMax = (v: string) => patchSt({ mMax: v })
  const setMInc = (v: string) => patchSt({ mInc: v })
  const setTimes = (v: string) => patchSt({ times: v })
  const setRes = (v: DifferenceDetectionResponse | null) => patchSt({ result: v })
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sel, setSel] = useState<{ m1: number; m2: number } | null>(null)

  const run = async () => {
    setErr(null); setLoading(true); setSel(null)
    try {
      const test_times = times.split(/[\s,]+/).map(v => parseFloat(v)).filter(v => !isNaN(v))
      const r = await rdtDifferenceDetection({
        metric,
        confidence: parseFloat(conf) / 100,
        design1_beta: parseFloat(b1), design1_n: parseInt(n1, 10),
        design2_beta: parseFloat(b2), design2_n: parseInt(n2, 10),
        metric_min: parseFloat(mMin), metric_max: parseFloat(mMax), metric_increment: parseFloat(mInc),
        test_times,
      })
      setRes(r)
    } catch (e) { setErr(detail(e, 'Computation failed.')) } finally { setLoading(false) }
  }

  const controls = (
    <>
      <Select label="Metric" value={metric} onChange={v => setMetric(v as 'B10' | 'mean')} options={METRIC_OPTS} />
      <Field label="Confidence level (%)" tip="Confidence level for the metric confidence intervals used to judge detectability." value={conf} onChange={setConf} />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Design 1 β" value={b1} onChange={setB1} />
        <Field label="Design 1 n" value={n1} onChange={setN1} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Design 2 β" value={b2} onChange={setB2} />
        <Field label="Design 2 n" value={n2} onChange={setN2} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Min" value={mMin} onChange={setMMin} />
        <Field label="Max" value={mMax} onChange={setMMax} />
        <Field label="Step" value={mInc} onChange={setMInc} />
      </div>
      <div>
        <label className={labelCls}>Test durations (comma-separated)</label>
        <input value={times} onChange={e => setTimes(e.target.value)} className={inputCls} placeholder="3000, 5000" />
      </div>
    </>
  )

  const selDetail = res && sel ? res.details[`${sel.m1}|${sel.m2}`] : null

  const results = res && (
    <div className="space-y-5">
      {(() => {
        const z = res.matrix.map(row => row.map(v => (v > 0 ? v : null)))
        const text = res.matrix.map(row => row.map(v => (v > 0 ? fmtNum(v) : '')))
        return (
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-1">Shortest detectable test duration</p>
            <Plot
              data={[{
                type: 'heatmap', x: res.values, y: res.values, z,
                text, texttemplate: '%{text}', textfont: { size: 10 },
                colorscale: 'YlGnBu', reversescale: true, hoverongaps: false,
                colorbar: { title: { text: 'Detect time' }, thickness: 12 },
                hovertemplate: 'D1=%{x}<br>D2=%{y}<br>detect=%{z}<extra></extra>',
              }] as unknown as Plotly.Data[]}
              layout={{ ...plotBase, height: 340,
                xaxis: { title: { text: 'Design 1 metric' }, type: 'category' },
                yaxis: { title: { text: 'Design 2 metric' }, type: 'category' } } as Plotly.Layout}
              config={PLOT_CFG} style={{ width: '100%' }} useResizeHandler />
            <p className="text-[10px] text-gray-400 mt-0.5">Darker = shorter (easier to detect); blank = not detectable with the supplied durations.</p>
          </div>
        )
      })()}
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse">
          <thead>
            <tr>
              <th className="border border-gray-200 bg-gray-100 px-2 py-1 text-gray-500 font-medium whitespace-nowrap">Design 2 ↓ / Design 1 →</th>
              {res.values.map(m1 => (
                <th key={m1} className="border border-gray-200 bg-gray-50 px-2 py-1 font-medium text-gray-700 text-right">{fmtNum(m1)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {res.values.map((m2, ri) => (
              <tr key={m2}>
                <th className="border border-gray-200 bg-gray-50 px-2 py-1 font-medium text-gray-700 text-right">{fmtNum(m2)}</th>
                {res.values.map((m1, ci) => {
                  const v = res.matrix[ri][ci]
                  const detectable = v > 0
                  const isSel = sel != null && sel.m1 === m1 && sel.m2 === m2
                  return (
                    <td key={m1}
                      onClick={() => setSel({ m1, m2 })}
                      className={`border border-gray-200 px-2 py-1 text-right cursor-pointer font-mono ${
                        isSel ? 'ring-2 ring-blue-400 ' : ''
                      }${detectable ? 'bg-green-100 text-green-800 hover:bg-green-200' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}>
                      {detectable ? fmtNum(v) : '—'}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500 leading-snug">
        Each cell shows the shortest test duration (hours) needed to detect the difference between the two designs at the
        chosen confidence level. <span className="font-mono">—</span> means the difference is not detectable with any of the
        supplied test durations. Click a cell for the metric values and confidence intervals.
      </p>

      {selDetail && (
        <div className="border border-gray-200 rounded-lg p-3 text-xs space-y-2 max-w-md">
          <p className="font-semibold text-gray-700">
            Design 1 = {fmtNum(sel!.m1)} &nbsp;·&nbsp; Design 2 = {fmtNum(sel!.m2)} &nbsp;·&nbsp; detected at {fmtNum(selDetail.test_time)} h
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Card label={`Design 1 ${metric}`} value={`${fmtNum(selDetail.design1.value)}`} accent />
            <Card label={`Design 2 ${metric}`} value={`${fmtNum(selDetail.design2.value)}`} />
          </div>
          <p className="font-mono text-gray-600">D1 CI [{fmtNum(selDetail.design1.lower)}, {fmtNum(selDetail.design1.upper)}]</p>
          <p className="font-mono text-gray-600">D2 CI [{fmtNum(selDetail.design2.lower)}, {fmtNum(selDetail.design2.upper)}]</p>
        </div>
      )}
    </div>
  )

  return <ToolLayout intro="Builds a matrix showing, for every pairing of Design 1 and Design 2 metric values, the shortest test duration that lets you statistically distinguish the two designs. Helps decide whether a comparison test is feasible." controls={controls} err={err} loading={loading} onRun={run} runLabel="Build matrix" results={results} />
}

// ─── 3. Test Simulation ──────────────────────────────────────────────────────

const SIM_METRIC_OPTS = [
  { value: 'reliability', label: 'Reliability at a time' },
  { value: 'B10', label: 'B10 life' },
]

export function Simulation() {
  const [dist, setDist] = useState('Weibull')
  const [beta, setBeta] = useState('2')
  const [eta, setEta] = useState('1000')
  const [n, setN] = useState('20')
  const [dur, setDur] = useState('1500')
  const [nsim, setNsim] = useState('1000')
  const [metric, setMetric] = useState<'reliability' | 'B10'>('reliability')
  const [targetTime, setTargetTime] = useState('500')
  const [targetVal, setTargetVal] = useState('')
  const [seed, setSeed] = useState('')
  const [res, setRes] = useState<TestSimulationResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const run = async () => {
    setErr(null); setLoading(true)
    try {
      const r = await testSimulation({
        distribution: dist,
        beta: parseFloat(beta),
        eta: parseFloat(eta),
        n: parseInt(n, 10),
        test_duration: dur.trim() ? parseFloat(dur) : null,
        num_simulations: parseInt(nsim, 10),
        metric,
        target_time: parseFloat(targetTime || '0'),
        target_value: targetVal.trim() ? parseFloat(targetVal) : null,
        seed: seed.trim() ? parseInt(seed, 10) : null,
      })
      setRes(r)
    } catch (e) { setErr(detail(e, 'Simulation failed.')) } finally { setLoading(false) }
  }

  const controls = (
    <>
      <Select label="Distribution" value={dist} onChange={setDist} options={DIST_OPTS} />
      <Field label="Shape β" tip="Weibull β / Normal σ / Lognormal σ (ignored for Exponential)." value={beta} onChange={setBeta} />
      <Field label="Scale η" tip="Weibull η / Normal μ / Lognormal μ / Exp MTTF." value={eta} onChange={setEta} />
      <Field label="Sample size (n)" tip="Units per simulated test." value={n} onChange={setN} />
      <Field label="Test duration (optional)" tip="Right-censoring time. Leave empty to run each simulated unit to failure (no censoring)." value={dur} onChange={setDur} />
      <Field label="Number of simulations" tip="How many synthetic tests to run." value={nsim} onChange={setNsim} />
      <Select label="Metric" value={metric} onChange={v => setMetric(v as 'reliability' | 'B10')} options={SIM_METRIC_OPTS} />
      {metric === 'reliability' && (
        <Field label="Target time" tip="Time at which reliability R(t) is estimated in each simulation." value={targetTime} onChange={setTargetTime} />
      )}
      <Field label="Success threshold (optional)" tip="If set, reports the probability that the simulated metric meets/exceeds this target." value={targetVal} onChange={setTargetVal} />
      <Field label="Random seed (optional)" tip="Set for reproducible results." value={seed} onChange={setSeed} />
    </>
  )

  const histTrace = res ? (() => {
    const { counts, edges } = res.histogram
    const centers = counts.map((_, i) => (edges[i] + edges[i + 1]) / 2)
    return [{ x: centers, y: counts, type: 'bar', marker: { color: '#3b82f6' }, name: 'Estimates' }] as Plotly.Data[]
  })() : []

  const results = res && (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="Mean estimate" value={fmtNum(res.mean)} accent />
        <Card label="Median" value={fmtNum(res.median)} />
        <Card label="Std. dev." value={fmtNum(res.std)} />
        <Card label="5th / 95th pct" value={`${fmtNum(res.p5)} / ${fmtNum(res.p95)}`} />
        {res.prob_meet_target != null && (
          <Card label={`P(meet target ${fmtNum(res.target_value)})`} value={`${(res.prob_meet_target * 100).toFixed(1)}%`} />
        )}
      </div>
      <p className="text-xs text-gray-500">{res.n_valid} of {res.num_simulations} simulations produced a valid {res.metric} estimate.</p>
      <div className="bg-white border border-gray-200 rounded-lg">
        <Plot
          data={histTrace}
          layout={{
            ...plotBase, height: 320,
            title: { text: 'Distribution of Estimates', font: { size: 13 } },
            xaxis: { title: { text: res.metric === 'reliability' ? 'Estimated reliability' : 'Estimated B10 life' }, gridcolor: '#e5e7eb' },
            yaxis: { title: { text: 'Count' }, gridcolor: '#e5e7eb' },
            bargap: 0.02,
          } as Plotly.Layout}
          config={PLOT_CFG} style={{ width: '100%' }} useResizeHandler />
      </div>
      {res.convergence && (
        <ConvergencePlot data={res.convergence}
          label={res.metric === 'reliability' ? 'Mean reliability estimate' : 'Mean B10 estimate'} />
      )}
    </div>
  )

  return <ToolLayout intro="Monte-Carlo simulation of a reliability test. Repeatedly draws a synthetic sample from the chosen life distribution (optionally right-censored at the test duration), estimates the metric each time, and summarises the resulting sampling distribution." controls={controls} err={err} loading={loading} onRun={run} runLabel="Simulate" results={results} />
}

// ─── Container ───────────────────────────────────────────────────────────────

const TOOLS: ToolDef[] = [
  { id: 'expected', label: 'Expected Failure Times', render: () => <ExpectedFailureTimes /> },
  { id: 'difference', label: 'Difference Detection Matrix', render: () => <DifferenceDetection /> },
  { id: 'simulation', label: 'Simulation', render: () => <Simulation /> },
]

export default function TestDesignTools() {
  return <ToolTabs tools={TOOLS} />
}
