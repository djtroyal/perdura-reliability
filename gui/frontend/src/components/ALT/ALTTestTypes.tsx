import { useState } from 'react'
import Plot from '../shared/ExportablePlot'
import { Plus, Trash2 } from 'lucide-react'
import {
  stepStressAnalysis, StepStressResponse,
  haltAnalysis, HALTResponse,
  marginTestAnalysis, MarginTestResponse,
  multiStressAnalysis, MultiStressResponse,
} from '../../api/client'
import InfoLabel from '../shared/InfoLabel'
import ExampleButton from '../shared/ExampleButton'
import { useModuleState } from '../../store/project'
import { inputCls, labelCls, PLOT_CFG, plotBase, detail, fmtNum, Card, Field, ToolLayout } from './toolkit'

// Canonical sample datasets for the local-state ALT sub-tools. Each tool opens
// with empty rows and fills these on demand via the ✨ Load-example button.
const EXAMPLE_SS_ROWS: SSRow[] = [
  { time: '120', stress: '85' }, { time: '340', stress: '85' },
  { time: '560', stress: '105' }, { time: '780', stress: '105' }, { time: '1150', stress: '125' },
]
const EXAMPLE_SS_STEPS: StepDef[] = [
  { stress: '85', duration: '500' }, { stress: '105', duration: '500' }, { stress: '125', duration: '500' },
]
const EXAMPLE_MS_ROWS: MSRow[] = [
  { time: '100', s1: '85', s2: '50' }, { time: '150', s1: '85', s2: '50' },
  { time: '80', s1: '105', s2: '70' }, { time: '120', s1: '105', s2: '70' },
  { time: '60', s1: '125', s2: '90' }, { time: '90', s1: '125', s2: '90' },
]
const EXAMPLE_HALT_ROWS: HALTRow[] = [
  { stress: '85', outcome: 'pass' }, { stress: '95', outcome: 'pass' },
  { stress: '105', outcome: 'anomaly' }, { stress: '115', outcome: 'pass' }, { stress: '125', outcome: 'fail' },
]

// Persisted Margin-Test state (inputs + result) so it is available as a Report
// Builder asset and survives tab switches.
interface MarginTestState {
  nUnits: string; nFail: string; dur: string; testStress: string
  specStress: string; af: string; ci: string
  result: MarginTestResponse | null
}
const INITIAL_MARGIN: MarginTestState = {
  nUnits: '20', nFail: '0', dur: '1000', testStress: '125', specStress: '85', af: '8', ci: '0.9', result: null,
}

// ─── Step / Sequential Stress ────────────────────────────────────────────────

interface SSRow { time: string; stress: string }
interface StepDef { stress: string; duration: string }

export function StepStress() {
  const [rows, setRows] = useState<SSRow[]>(() => Array.from({ length: 5 }, () => ({ time: '', stress: '' })))
  const [steps, setSteps] = useState<StepDef[]>(() => Array.from({ length: 3 }, () => ({ stress: '', duration: '' })))
  const [useStress, setUseStress] = useState('60')
  const [dist, setDist] = useState('Weibull')
  const [res, setRes] = useState<StepStressResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const updRow = (i: number, k: keyof SSRow, v: string) => setRows(rows.map((r, j) => j === i ? { ...r, [k]: v } : r))
  const updStep = (i: number, k: keyof StepDef, v: string) => setSteps(steps.map((s, j) => j === i ? { ...s, [k]: v } : s))

  const run = async () => {
    setErr(null); setLoading(true)
    try {
      const valid = rows.filter(r => r.time.trim() && r.stress.trim())
      const vSteps = steps.filter(s => s.stress.trim() && s.duration.trim())
      const r = await stepStressAnalysis({
        failure_times: valid.map(v => parseFloat(v.time)),
        stress_at_failure: valid.map(v => parseFloat(v.stress)),
        steps: vSteps.map(s => ({ stress: parseFloat(s.stress), duration: parseFloat(s.duration) })),
        use_level_stress: useStress.trim() ? parseFloat(useStress) : null,
        distribution: dist,
      })
      setRes(r)
    } catch (e) { setErr(detail(e, 'Analysis failed')) } finally { setLoading(false) }
  }

  const controls = (
    <>
      <div className="flex justify-end -mb-1">
        <ExampleButton hasData={rows.some(r => r.time.trim() || r.stress.trim())}
          onLoad={() => { setRows(EXAMPLE_SS_ROWS.map(r => ({ ...r }))); setSteps(EXAMPLE_SS_STEPS.map(s => ({ ...s }))) }} />
      </div>
      <div>
        <InfoLabel tip="Stress steps applied in sequence: units run at each stress for its duration until they fail.">Stress profile (steps)</InfoLabel>
        <div className="border border-gray-200 rounded overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50"><tr>
              <th className="px-1 py-1 text-left font-medium text-gray-500">Stress</th>
              <th className="px-1 py-1 text-left font-medium text-gray-500">Duration</th>
              <th className="w-6"></th>
            </tr></thead>
            <tbody>
              {steps.map((s, i) => (
                <tr key={i} className="border-t border-gray-100 group">
                  <td className="px-0.5 py-0.5"><input value={s.stress} onChange={e => updStep(i, 'stress', e.target.value)} className="w-full text-xs px-1 py-0.5 border-0 bg-transparent focus:ring-1 focus:ring-blue-400 rounded font-mono" /></td>
                  <td className="px-0.5 py-0.5"><input value={s.duration} onChange={e => updStep(i, 'duration', e.target.value)} className="w-full text-xs px-1 py-0.5 border-0 bg-transparent focus:ring-1 focus:ring-blue-400 rounded font-mono" /></td>
                  <td className="text-center"><button tabIndex={-1} onClick={() => setSteps(steps.filter((_, j) => j !== i))} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"><Trash2 size={11} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={() => setSteps([...steps, { stress: '', duration: '' }])} className="w-full text-xs text-blue-600 hover:bg-blue-50 py-1 flex items-center justify-center gap-1 border-t border-gray-100"><Plus size={11} /> Add step</button>
        </div>
      </div>
      <div>
        <InfoLabel tip="Observed failure times and the stress level the unit was at when it failed.">Failure data</InfoLabel>
        <div className="border border-gray-200 rounded overflow-hidden">
          <div className="max-h-44 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0"><tr>
                <th className="px-1 py-1 text-left font-medium text-gray-500">Time</th>
                <th className="px-1 py-1 text-left font-medium text-gray-500">Stress</th>
                <th className="w-6"></th>
              </tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-gray-100 group">
                    <td className="px-0.5 py-0.5"><input value={r.time} onChange={e => updRow(i, 'time', e.target.value)} className="w-full text-xs px-1 py-0.5 border-0 bg-transparent focus:ring-1 focus:ring-blue-400 rounded font-mono" /></td>
                    <td className="px-0.5 py-0.5"><input value={r.stress} onChange={e => updRow(i, 'stress', e.target.value)} className="w-full text-xs px-1 py-0.5 border-0 bg-transparent focus:ring-1 focus:ring-blue-400 rounded font-mono" /></td>
                    <td className="text-center"><button tabIndex={-1} onClick={() => setRows(rows.filter((_, j) => j !== i))} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"><Trash2 size={11} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={() => setRows([...rows, { time: '', stress: '' }])} className="w-full text-xs text-blue-600 hover:bg-blue-50 py-1 flex items-center justify-center gap-1 border-t border-gray-100"><Plus size={11} /> Add row</button>
        </div>
      </div>
      <Field label="Use-level stress" tip="Field/use stress for extrapolation (optional)." value={useStress} onChange={setUseStress} />
      <div>
        <label className={labelCls}>Life distribution</label>
        <select value={dist} onChange={e => setDist(e.target.value)} className={inputCls}>
          <option value="Weibull">Weibull</option>
          <option value="Normal">Normal</option>
          <option value="Lognormal">Lognormal</option>
        </select>
      </div>
    </>
  )

  const results = res && (
    <div className="space-y-5">
      <div className="grid grid-cols-4 gap-3">
        <Card label="Mean life (at ref)" value={fmtNum(res.distribution_fit.summary.mean)} accent />
        <Card label="B50 life" value={fmtNum(res.distribution_fit.summary.B50)} />
        <Card label="B10 life" value={fmtNum(res.distribution_fit.summary.B10)} />
        <Card label="Stress exponent p" value={res.exponent_p.toFixed(3)} />
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1">Cumulative failures with step boundaries</p>
        <Plot
          data={[
            { x: res.cumulative_plot.time, y: res.cumulative_plot.cum_fraction, mode: 'lines+markers', line: { color: '#3b82f6', width: 2, shape: 'hv' }, name: 'Cumulative fraction' },
          ] as Plotly.Data[]}
          layout={{
            ...plotBase, height: 320,
            xaxis: { title: { text: 'Time' } }, yaxis: { title: { text: 'Cumulative fraction failed' }, range: [0, 1] },
            shapes: res.cumulative_plot.step_boundaries.map(b => ({
              type: 'line', x0: b, x1: b, y0: 0, y1: 1, line: { color: '#9ca3af', width: 1, dash: 'dash' },
            })),
          } as Plotly.Layout}
          config={PLOT_CFG} style={{ width: '100%' }} useResizeHandler />
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1">Equivalent-time CDF (cumulative exposure)</p>
        <Plot
          data={[{ x: res.distribution_fit.curve_x, y: res.distribution_fit.cdf, mode: 'lines', line: { color: '#3b82f6', width: 2 }, name: 'CDF' }] as Plotly.Data[]}
          layout={{ ...plotBase, height: 260, xaxis: { title: { text: 'Equivalent time at reference stress' } }, yaxis: { title: { text: 'Unreliability' }, range: [0, 1] } } as Plotly.Layout}
          config={PLOT_CFG} style={{ width: '100%' }} useResizeHandler />
      </div>
    </div>
  )

  return <ToolLayout intro="Step-stress (and sequential-stress) ALT analysis using the cumulative-exposure model. Failures at higher steps are converted to equivalent times at the reference stress, then a life distribution is fitted." controls={controls} err={err} loading={loading} onRun={run} runLabel="Analyze" results={results} />
}

// ─── Multi-Stress ────────────────────────────────────────────────────────────

interface MSRow { time: string; s1: string; s2: string }

export function MultiStress() {
  const [rows, setRows] = useState<MSRow[]>(() => Array.from({ length: 6 }, () => ({ time: '', s1: '', s2: '' })))
  const [s1Label, setS1Label] = useState('Temperature')
  const [s2Label, setS2Label] = useState('Humidity')
  const [s1Use, setS1Use] = useState('40')
  const [s2Use, setS2Use] = useState('30')
  const [s1Direction, setS1Direction] = useState<'increasing_damage' | 'decreasing_damage'>('increasing_damage')
  const [s2Direction, setS2Direction] = useState<'increasing_damage' | 'decreasing_damage'>('increasing_damage')
  const [res, setRes] = useState<MultiStressResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const upd = (i: number, k: keyof MSRow, v: string) => setRows(rows.map((r, j) => j === i ? { ...r, [k]: v } : r))

  const run = async () => {
    setErr(null); setLoading(true)
    try {
      const valid = rows.filter(r => r.time.trim() && r.s1.trim() && r.s2.trim())
      const r = await multiStressAnalysis({
        failure_times: valid.map(v => parseFloat(v.time)),
        stress1: valid.map(v => parseFloat(v.s1)),
        stress2: valid.map(v => parseFloat(v.s2)),
        stress1_use: s1Use.trim() ? parseFloat(s1Use) : null,
        stress2_use: s2Use.trim() ? parseFloat(s2Use) : null,
        stress1_label: s1Label, stress2_label: s2Label,
        stress1_direction: s1Direction, stress2_direction: s2Direction,
        CI: 0.95, n_bootstrap: 500, seed: 1729,
      })
      setRes(r)
    } catch (e) { setErr(detail(e, 'Analysis failed')) } finally { setLoading(false) }
  }

  const controls = (
    <>
      <div className="flex justify-end -mb-1">
        <ExampleButton hasData={rows.some(r => r.time.trim() || r.s1.trim() || r.s2.trim())}
          onLoad={() => setRows(EXAMPLE_MS_ROWS.map(r => ({ ...r })))} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className={labelCls}>Stress 1 name</label><input value={s1Label} onChange={e => setS1Label(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Stress 2 name</label><input value={s2Label} onChange={e => setS2Label(e.target.value)} className={inputCls} /></div>
      </div>
      <div>
        <InfoLabel tip="Failure times under combinations of two simultaneous stresses.">Failure data</InfoLabel>
        <div className="border border-gray-200 rounded overflow-hidden">
          <div className="max-h-52 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0"><tr>
                <th className="px-1 py-1 text-left font-medium text-gray-500">Time</th>
                <th className="px-1 py-1 text-left font-medium text-gray-500">S1</th>
                <th className="px-1 py-1 text-left font-medium text-gray-500">S2</th>
                <th className="w-6"></th>
              </tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-gray-100 group">
                    <td className="px-0.5 py-0.5"><input value={r.time} onChange={e => upd(i, 'time', e.target.value)} className="w-full text-xs px-1 py-0.5 border-0 bg-transparent focus:ring-1 focus:ring-blue-400 rounded font-mono" /></td>
                    <td className="px-0.5 py-0.5"><input value={r.s1} onChange={e => upd(i, 's1', e.target.value)} className="w-full text-xs px-1 py-0.5 border-0 bg-transparent focus:ring-1 focus:ring-blue-400 rounded font-mono" /></td>
                    <td className="px-0.5 py-0.5"><input value={r.s2} onChange={e => upd(i, 's2', e.target.value)} className="w-full text-xs px-1 py-0.5 border-0 bg-transparent focus:ring-1 focus:ring-blue-400 rounded font-mono" /></td>
                    <td className="text-center"><button tabIndex={-1} onClick={() => setRows(rows.filter((_, j) => j !== i))} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"><Trash2 size={11} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={() => setRows([...rows, { time: '', s1: '', s2: '' }])} className="w-full text-xs text-blue-600 hover:bg-blue-50 py-1 flex items-center justify-center gap-1 border-t border-gray-100"><Plus size={11} /> Add row</button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label={`${s1Label} use`} value={s1Use} onChange={setS1Use} />
        <Field label={`${s2Label} use`} value={s2Use} onChange={setS2Use} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><InfoLabel tip="Choose increasing damage when larger stress should shorten life; choose decreasing damage for protective/resource variables where larger values should lengthen life.">{s1Label} direction</InfoLabel>
          <select value={s1Direction} onChange={e => setS1Direction(e.target.value as typeof s1Direction)} className={inputCls}>
            <option value="increasing_damage">Higher shortens life</option><option value="decreasing_damage">Higher extends life</option>
          </select></div>
        <div><InfoLabel tip="The fitted coefficient must agree with this physical direction or use-life prediction is withheld.">{s2Label} direction</InfoLabel>
          <select value={s2Direction} onChange={e => setS2Direction(e.target.value as typeof s2Direction)} className={inputCls}>
            <option value="increasing_damage">Higher shortens life</option><option value="decreasing_damage">Higher extends life</option>
          </select></div>
      </div>
    </>
  )

  const results = res && (
    <div className="space-y-5">
      {!res.fit_eligible && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-xs text-red-800">
          <strong>Use-life prediction withheld.</strong> {res.eligibility_reasons.join(', ').replace(/_/g, ' ')}.
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="Design rank" value={`${res.design_diagnostics.rank}/${res.design_diagnostics.required_rank}`} />
        <Card label="Scaled condition" value={fmtNum(res.design_diagnostics.scaled_condition_number)} />
        <Card label="Physical directions" value={res.physical_constraint.passed ? 'Pass' : 'Violated'} />
        <Card label="Common dispersion" value={res.common_dispersion.status === 'ok'
          ? `${res.common_dispersion.reject_common_dispersion ? 'Rejected' : 'Not rejected'} (p=${fmtNum(res.common_dispersion.p_value!)})`
          : res.common_dispersion.status.replace(/_/g, ' ')} />
      </div>
      {res.use_stress_diagnostics?.is_extrapolation && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
          <strong>Use point is outside the tested stress-design convex hull.</strong> Leverage is {res.use_stress_diagnostics.leverage_ratio.toFixed(2)}× the average training leverage; treat the life and interval as extrapolation.
        </div>
      )}
      {res.use_level_life != null && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Card label="Estimated life at use conditions" value={fmtNum(res.use_level_life)} accent />
          <Card label="Stress combinations" value={String(res.combo_table.length)} />
          {res.use_life_interval?.lower != null && res.use_life_interval?.upper != null && (
            <Card label={`${Math.round(res.use_life_interval.CI * 100)}% bootstrap interval`}
              value={`${fmtNum(res.use_life_interval.lower)} – ${fmtNum(res.use_life_interval.upper)}`} />
          )}
        </div>
      )}
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1">Life vs stress (3D scatter)</p>
        <Plot
          data={[{
            type: 'scatter3d', mode: 'markers',
            x: res.scatter.stress1, y: res.scatter.stress2, z: res.scatter.life,
            marker: { size: 4, color: res.scatter.life, colorscale: 'Viridis' }, name: 'Failures',
          }] as Plotly.Data[]}
          layout={{ ...plotBase, height: 420, scene: {
            xaxis: { title: { text: res.stress1_label } }, yaxis: { title: { text: res.stress2_label } },
            zaxis: { title: { text: 'Life' } },
          } } as Plotly.Layout}
          config={PLOT_CFG} style={{ width: '100%' }} useResizeHandler />
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1">Per-combination summary</p>
        <table className="w-full text-xs border border-gray-200 rounded">
          <thead className="bg-gray-50"><tr>
            <th className="px-3 py-1.5 text-left font-medium text-gray-600">{res.stress1_label}</th>
            <th className="px-3 py-1.5 text-left font-medium text-gray-600">{res.stress2_label}</th>
            <th className="px-3 py-1.5 text-right font-medium text-gray-600">n</th>
            <th className="px-3 py-1.5 text-right font-medium text-gray-600">Median life</th>
            <th className="px-3 py-1.5 text-right font-medium text-gray-600">Mean life</th>
          </tr></thead>
          <tbody>
            {res.combo_table.map((c, i) => (
              <tr key={i} className="border-t border-gray-100">
                <td className="px-3 py-1 font-mono">{c.stress1}</td>
                <td className="px-3 py-1 font-mono">{c.stress2}</td>
                <td className="px-3 py-1 text-right font-mono">{c.n}</td>
                <td className="px-3 py-1 text-right font-mono">{fmtNum(c.median_life)}</td>
                <td className="px-3 py-1 text-right font-mono">{fmtNum(c.mean_life)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )

  return <ToolLayout intro="Two-stress log-life ALT with full-rank/conditioning checks, explicit physical coefficient directions, common-dispersion diagnostics, convex-hull leverage warnings and a parametric-bootstrap interval at the use point." controls={controls} err={err} loading={loading} onRun={run} runLabel="Analyze" results={results} />
}

// ─── HALT ─────────────────────────────────────────────────────────────────────

interface HALTRow { stress: string; outcome: string }

export function HALT() {
  const [rows, setRows] = useState<HALTRow[]>(() => Array.from({ length: 5 }, () => ({ stress: '', outcome: 'pass' })))
  const [stressType, setStressType] = useState('temperature')
  const [specMax, setSpecMax] = useState('70')
  const [res, setRes] = useState<HALTResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const upd = (i: number, k: keyof HALTRow, v: string) => setRows(rows.map((r, j) => j === i ? { ...r, [k]: v } : r))

  const run = async () => {
    setErr(null); setLoading(true)
    try {
      const valid = rows.filter(r => r.stress.trim())
      const r = await haltAnalysis({
        stress_levels: valid.map(v => parseFloat(v.stress)),
        outcomes: valid.map(v => v.outcome),
        stress_type: stressType,
        spec_max: specMax.trim() ? parseFloat(specMax) : null,
      })
      setRes(r)
    } catch (e) { setErr(detail(e, 'Analysis failed')) } finally { setLoading(false) }
  }

  const OUT_COLOR: Record<string, string> = { pass: '#86efac', anomaly: '#fdba74', degraded: '#fdba74', fail: '#fca5a5', destruct: '#fca5a5' }

  const controls = (
    <>
      <div className="flex justify-end -mb-1">
        <ExampleButton hasData={rows.some(r => r.stress.trim())}
          onLoad={() => setRows(EXAMPLE_HALT_ROWS.map(r => ({ ...r })))} />
      </div>
      <div>
        <label className={labelCls}>Stress type</label>
        <select value={stressType} onChange={e => setStressType(e.target.value)} className={inputCls}>
          <option value="temperature">Temperature</option>
          <option value="vibration">Vibration</option>
          <option value="combined">Combined</option>
        </select>
      </div>
      <div>
        <InfoLabel tip="Each stress level tested and its outcome: pass, anomaly (operating limit), or fail (destruct limit).">Step-search results</InfoLabel>
        <div className="border border-gray-200 rounded overflow-hidden">
          <div className="max-h-52 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0"><tr>
                <th className="px-1 py-1 text-left font-medium text-gray-500">Stress</th>
                <th className="px-1 py-1 text-left font-medium text-gray-500">Outcome</th>
                <th className="w-6"></th>
              </tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-gray-100 group">
                    <td className="px-0.5 py-0.5"><input value={r.stress} onChange={e => upd(i, 'stress', e.target.value)} className="w-full text-xs px-1 py-0.5 border-0 bg-transparent focus:ring-1 focus:ring-blue-400 rounded font-mono" /></td>
                    <td className="px-0.5 py-0.5">
                      <select value={r.outcome} onChange={e => upd(i, 'outcome', e.target.value)} className="w-full text-xs px-1 py-0.5 border-0 bg-transparent focus:ring-1 focus:ring-blue-400 rounded">
                        <option value="pass">pass</option>
                        <option value="anomaly">anomaly</option>
                        <option value="fail">fail</option>
                      </select>
                    </td>
                    <td className="text-center"><button tabIndex={-1} onClick={() => setRows(rows.filter((_, j) => j !== i))} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"><Trash2 size={11} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={() => setRows([...rows, { stress: '', outcome: 'pass' }])} className="w-full text-xs text-blue-600 hover:bg-blue-50 py-1 flex items-center justify-center gap-1 border-t border-gray-100"><Plus size={11} /> Add level</button>
        </div>
      </div>
      <Field label="Spec limit (upper)" tip="Product specification limit, used to compute margins." value={specMax} onChange={setSpecMax} />
    </>
  )

  const results = res && (
    <div className="space-y-5">
      <div className="grid grid-cols-4 gap-3">
        <Card label="Operating limit" value={res.operating_limit != null ? fmtNum(res.operating_limit) : '—'} accent />
        <Card label="Destruct limit" value={res.destruct_limit != null ? fmtNum(res.destruct_limit) : '—'} />
        <Card label="Operating margin" value={res.operating_margin != null ? fmtNum(res.operating_margin) : '—'} />
        <Card label="Destruct margin" value={res.destruct_margin != null ? fmtNum(res.destruct_margin) : '—'} />
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1">Stress capability</p>
        <Plot
          data={[{
            x: res.capability_plot.levels, y: res.capability_plot.levels.map(() => 1),
            type: 'bar', orientation: 'v',
            marker: { color: res.capability_plot.outcomes.map(o => OUT_COLOR[o] || '#cbd5e1') },
            text: res.capability_plot.outcomes, textposition: 'outside', name: 'Outcome',
          }] as Plotly.Data[]}
          layout={{
            ...plotBase, height: 300,
            xaxis: { title: { text: `Stress (${stressType})` } }, yaxis: { visible: false, range: [0, 1.6] },
            shapes: [
              ...(res.spec_max != null ? [{ type: 'line' as const, x0: res.spec_max, x1: res.spec_max, y0: 0, y1: 1.5, line: { color: '#3b82f6', width: 2, dash: 'dash' as const } }] : []),
              ...(res.operating_limit != null ? [{ type: 'line' as const, x0: res.operating_limit, x1: res.operating_limit, y0: 0, y1: 1.5, line: { color: '#f59e0b', width: 2 } }] : []),
              ...(res.destruct_limit != null ? [{ type: 'line' as const, x0: res.destruct_limit, x1: res.destruct_limit, y0: 0, y1: 1.5, line: { color: '#ef4444', width: 2 } }] : []),
            ],
          } as Plotly.Layout}
          config={PLOT_CFG} style={{ width: '100%' }} useResizeHandler />
        <p className="text-[11px] text-gray-500 mt-1">Blue = spec limit · Amber = operating limit · Red = destruct limit</p>
      </div>
    </div>
  )

  return <ToolLayout intro="Highly Accelerated Life Test (HALT): step the stress beyond specification to find the operating limit (first anomaly) and destruct limit (permanent failure), and report the design margins." controls={controls} err={err} loading={loading} onRun={run} runLabel="Analyze" results={results} />
}

// ─── Margin Test ──────────────────────────────────────────────────────────────

export function MarginTest() {
  const [st, setSt] = useModuleState<MarginTestState>('marginTest', INITIAL_MARGIN)
  const patchSt = (p: Partial<MarginTestState>) => setSt(prev => ({ ...prev, ...p }))
  const { nUnits, nFail, dur, testStress, specStress, af, ci } = st
  const res = st.result
  const setNUnits = (v: string) => patchSt({ nUnits: v })
  const setNFail = (v: string) => patchSt({ nFail: v })
  const setDur = (v: string) => patchSt({ dur: v })
  const setTestStress = (v: string) => patchSt({ testStress: v })
  const setSpecStress = (v: string) => patchSt({ specStress: v })
  const setAf = (v: string) => patchSt({ af: v })
  const setCi = (v: string) => patchSt({ ci: v })
  const setRes = (v: MarginTestResponse | null) => patchSt({ result: v })
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const run = async () => {
    setErr(null); setLoading(true)
    try {
      const r = await marginTestAnalysis({
        n_units: parseInt(nUnits, 10), n_failures: parseInt(nFail, 10),
        test_duration: parseFloat(dur), test_stress: parseFloat(testStress),
        spec_stress: parseFloat(specStress),
        acceleration_factor: af.trim() ? parseFloat(af) : null,
        confidence: parseFloat(ci),
      })
      setRes(r)
    } catch (e) { setErr(detail(e, 'Analysis failed')) } finally { setLoading(false) }
  }

  const controls = (
    <>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Units tested" value={nUnits} onChange={setNUnits} />
        <Field label="Failures" value={nFail} onChange={setNFail} />
      </div>
      <Field label="Test duration" value={dur} onChange={setDur} />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Test stress" value={testStress} onChange={setTestStress} />
        <Field label="Spec stress" value={specStress} onChange={setSpecStress} />
      </div>
      <Field label="Acceleration factor" tip="AF between test and spec conditions. Leave blank to use a simple stress ratio." value={af} onChange={setAf} />
      <Field label="Confidence level" value={ci} onChange={setCi} />
    </>
  )

  const results = res && (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <Card label="Demonstrated reliability" value={res.demonstrated_reliability.toFixed(4)} accent />
        <Card label={`Lower bound (${Math.round(res.confidence * 100)}%)`} value={res.reliability_lower_bound.toFixed(4)} />
        <Card label="Equivalent time at spec" value={fmtNum(res.equivalent_time_at_spec)} />
        <Card label="MTBF at spec" value={res.mtbf_at_spec != null ? fmtNum(res.mtbf_at_spec) : '—'} />
      </div>
      <div className="text-xs text-gray-600 border border-gray-200 rounded p-3 space-y-1">
        <p>Acceleration factor used: <span className="font-mono">{res.acceleration_factor}</span></p>
        <p>Stress margin ratio (test / spec): <span className="font-mono">{res.margin_ratio ?? '—'}</span></p>
        <p className="text-gray-500">
          With <span className="font-mono">{Math.round(res.confidence * 100)}%</span> confidence, reliability at spec
          conditions is at least <span className="font-mono">{res.reliability_lower_bound.toFixed(4)}</span> over the
          equivalent <span className="font-mono">{fmtNum(res.equivalent_time_at_spec)}</span> of operation.
        </p>
      </div>
    </div>
  )

  return <ToolLayout intro="Margin test: demonstrate reliability at specification conditions from an over-stress test. The test exposure is scaled by the acceleration factor to an equivalent time at spec, then a lower confidence bound on reliability is computed." controls={controls} err={err} loading={loading} onRun={run} runLabel="Compute" results={results} />
}

// ─── Container ────────────────────────────────────────────────────────────────

const ATT_TOOLS = [
  { id: 'step', label: 'Step / Sequential Stress' },
  { id: 'multi', label: 'Multi-Stress' },
  { id: 'halt', label: 'HALT' },
  { id: 'margin', label: 'Margin Test' },
] as const
type ATTTool = typeof ATT_TOOLS[number]['id']

export default function ALTTestTypes() {
  const [tool, setTool] = useState<ATTTool>('step')
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-stretch gap-1 bg-gray-50 border-b border-gray-200 px-3 overflow-x-auto">
        {ATT_TOOLS.map(t => (
          <button key={t.id} onClick={() => setTool(t.id)}
            className={`px-3 py-1.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
              tool === t.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>{t.label}</button>
        ))}
      </div>
      {tool === 'step' && <StepStress />}
      {tool === 'multi' && <MultiStress />}
      {tool === 'halt' && <HALT />}
      {tool === 'margin' && <MarginTest />}
    </div>
  )
}
