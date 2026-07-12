import { useState } from 'react'
import Plot from '../shared/ExportablePlot'
import { ToolLayout, Card, Select, detail, fmtNum, inputCls, labelCls, PLOT_CFG, plotBase } from '../ALT/toolkit'
import { computeMaintainability } from '../../api/client'
import { useModuleState, useUnits } from '../../store/project'
import { RamState, MaintState, INITIAL, pf } from './ram'

/** Repair-time roll-up: mean corrective time (Mct) and Mmax at a percentile. */
export default function Maintainability() {
  const [s, setS] = useModuleState<RamState>('ram', INITIAL)
  const mt = s.maint
  const patch = (p: Partial<MaintState>) => setS(prev => ({ ...prev, maint: { ...prev.maint, ...p } }))
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [units] = useUnits()

  const run = async () => {
    setErr(null); setLoading(true)
    try {
      const samples = mt.samples.split(/[\s,]+/).map(Number).filter(n => isFinite(n))
      const r = await computeMaintainability({
        mode: mt.mode,
        mu: pf(mt.mu), sigma: pf(mt.sigma),
        samples: mt.mode === 'data' ? samples : null,
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
      </> : (
        <div>
          <label className={labelCls}>Repair-time samples</label>
          <textarea value={mt.samples} onChange={e => patch({ samples: e.target.value })}
            rows={5} placeholder="e.g. 2.0 3.5 2.8 4.1 3.0" className={`${inputCls} resize-y`} />
          <p className="text-[10px] text-gray-400 mt-1">Fitted to a lognormal distribution (whitespace/comma separated).</p>
        </div>
      )}
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
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1">Probability a repair exceeds time t</p>
        <Plot
          data={[{ x: r.curve.time, y: r.curve.sf, mode: 'lines', line: { color: '#8b5cf6', width: 2 }, name: 'P(T > t)' }] as Plotly.Data[]}
          layout={{ ...plotBase, height: 320, xaxis: { title: { text: `Repair time (${units})` } }, yaxis: { title: { text: 'P(T > t)' }, range: [0, 1] } } as Plotly.Layout}
          config={PLOT_CFG} style={{ width: '100%' }} useResizeHandler />
      </div>
    </div>
  )

  return <ToolLayout
    intro="Maintainability roll-up: repair times are modelled as lognormal. Returns the mean corrective maintenance time (Mct) and the maximum corrective time (Mmax) at a chosen percentile, from manual parameters or fitted repair-time samples."
    controls={controls} err={err} loading={loading} onRun={run} runLabel="Compute" results={results} />
}
