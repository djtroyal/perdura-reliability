import { useState } from 'react'
import Plot from '../shared/ExportablePlot'
import { ToolLayout, Card, Field, Select, detail, fmtNum, inputCls, labelCls, PLOT_CFG, plotBase } from '../ALT/toolkit'
import { computeMaintainability } from '../../api/client'
import { useModuleState, useUnits } from '../../store/project'
import { RamState, MaintState, INITIAL, pf } from './ram'
import { parseRepairTimes } from './repairTimeInput'

/** Repair-time roll-up: mean corrective time (Mct) and Mmax at a percentile. */
export default function Maintainability() {
  const [s, setS] = useModuleState<RamState>('ram', INITIAL)
  const mt = { ...INITIAL.maint, ...s.maint }
  const patch = (p: Partial<MaintState>) => setS(prev => ({ ...prev, maint: { ...INITIAL.maint, ...prev.maint, ...(!('curveView' in p) ? { result: null } : {}), ...p } }))
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [units] = useUnits()

  const run = async () => {
    setErr(null); setLoading(true)
    try {
      const observations = ['data', 'frequency'].includes(mt.mode) ? parseRepairTimes(mt.samples, mt.mode === 'frequency') : {}
      const r = await computeMaintainability({
        mode: mt.mode,
        mu: pf(mt.mu), sigma: pf(mt.sigma),
        ...observations, estimator: mt.estimator, mttr: pf(mt.mttr),
        percentile: pf(mt.percentile) ?? 0.95,
      })
      patch({ result: r })
    } catch (e) { setErr(detail(e, 'Analysis failed')) } finally { setLoading(false) }
  }

  const r = mt.result

  const controls = (
    <>
      <Select label="Repair-time input" value={mt.mode} onChange={v => patch({ mode: v as MaintState['mode'] })}
        options={[
          { value: 'lognormal', label: 'Lognormal parameters' },
          { value: 'data', label: 'Repair-time samples' },
          { value: 'frequency', label: 'Duration / frequency rows' },
          { value: 'exponential', label: 'MTTR only (exponential)' },
        ]} />
      {mt.mode === 'lognormal' ? <>
        <div>
          <label className={labelCls}>μ (log-space location)</label>
          <input type="number" step="0.1" value={mt.mu} onChange={e => patch({ mu: e.target.value })} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>σ (log-space scale)</label>
          <input type="number" min="0" step="0.1" value={mt.sigma} onChange={e => patch({ sigma: e.target.value })} className={inputCls} />
        </div>
      </> : mt.mode === 'exponential' ? <Field label={`MTTR (${units})`} value={mt.mttr} onChange={v => patch({ mttr: v })} tip="Exponential repair-duration approximation from its mean." /> : (
        <div>
          <label htmlFor="repair-observations" className={labelCls}>{mt.mode === 'frequency' ? 'Duration, frequency — one pair per row' : `Repair-time samples (${units})`}</label>
          <textarea id="repair-observations" value={mt.samples} onChange={e => patch({ samples: e.target.value })}
            rows={5} placeholder={mt.mode === 'frequency' ? '2.0, 4\n3.5, 2' : '2.0 3.5 2.8 4.1 3.0'} className={`${inputCls} resize-y`} />
        </div>
      )}
      {['data', 'frequency'].includes(mt.mode) && <Select label="Lognormal estimator" value={mt.estimator} onChange={v => patch({ estimator: v as MaintState['estimator'] })}
        options={[{ value: 'mle', label: 'Maximum likelihood' }, { value: 'sample_log_sd', label: 'Handbook sample log-SD' }]} />}
      <div>
        <label className={labelCls}>Percentile for Mmax</label>
        <input type="number" min="0" max="1" step="0.01" value={mt.percentile} onChange={e => patch({ percentile: e.target.value })} className={inputCls} />
      </div>
    </>
  )

  const results = r && (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <Card label="Mct (mean corrective time)" value={fmtNum(r.mct)} accent />
        <Card label={`Mmax (${(r.percentile * 100).toFixed(0)}th pct)`} value={fmtNum(r.mmax)} accent />
        <Card label="Median repair time" value={fmtNum(r.median)} />
      </div>
      {r.fitted && (
        <div className="grid grid-cols-2 gap-3">
          <Card label="Fitted μ" value={fmtNum(r.fitted.mu)} />
          <Card label="Fitted σ" value={fmtNum(r.fitted.sigma)} />
        </div>
      )}
      {r.fitted?.sample_size != null && <p className="text-xs text-gray-600">{r.fitted.sample_size} repairs · {r.fitted.estimator === 'sample_log_sd' ? 'Sample log-SD' : 'Maximum likelihood'}</p>}
      <Select label="Repair-time view" value={mt.curveView} onChange={v => patch({ curveView: v as MaintState['curveView'] })}
        options={[{ value: 'completion', label: 'Completed by time' }, { value: 'exceedance', label: 'Exceeds time' }]} />
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1">{mt.curveView === 'completion' ? 'Repair completion probability' : 'Repair exceedance probability'}</p>
        <Plot
          data={[{ x: r.curve.time, y: mt.curveView === 'completion' ? (r.curve.cdf ?? r.curve.sf.map(v => 1 - v)) : r.curve.sf, mode: 'lines', line: { color: '#7c3aed', width: 2 }, name: mt.curveView === 'completion' ? 'P(T ≤ t)' : 'P(T > t)' }] as Plotly.Data[]}
          layout={{ ...plotBase, height: 320, xaxis: { title: { text: `Repair time (${units})` } }, yaxis: { title: { text: 'Probability' }, range: [0, 1] } } as Plotly.Layout}
          config={PLOT_CFG} style={{ width: '100%' }} useResizeHandler />
      </div>
      <details><summary className="cursor-pointer text-xs font-semibold">Repair probabilities</summary>
        <div className="mt-2 max-h-80 overflow-auto"><table aria-label="Repair-time probabilities" className="w-full text-right text-xs">
          <thead><tr><th className="p-2">Time ({units})</th><th className="p-2">Completed by time</th><th className="p-2">Exceeds time</th></tr></thead>
          <tbody>{r.curve.time.map((time, i) => <tr key={i} className="border-t"><td className="p-2">{fmtNum(time)}</td><td>{fmtNum(r.curve.cdf?.[i] ?? 1-r.curve.sf[i])}</td><td>{fmtNum(r.curve.sf[i])}</td></tr>)}</tbody>
        </table></div>
      </details>
    </div>
  )

  return <ToolLayout
    intro="Estimate mean and percentile repair durations."
    controls={controls} err={err} loading={loading} onRun={run} runLabel="Compute" results={results} />
}
