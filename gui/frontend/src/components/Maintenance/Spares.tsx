import { useState } from 'react'
import Plot from '../shared/ExportablePlot'
import { ToolLayout, Card, Field, Select, detail, fmtNum, PLOT_CFG, plotBase } from '../ALT/toolkit'
import { computeSpares } from '../../api/client'
import { useModuleState } from '../../store/project'
import { RamState, SparesState, INITIAL, pf } from './ram'

/** Poisson spare-parts provisioning to a target no-stockout confidence. */
export default function Spares() {
  const [s, setS] = useModuleState<RamState>('ram', INITIAL)
  const sp = s.spares
  const patch = (p: Partial<SparesState>) => setS(prev => ({ ...prev, spares: { ...prev.spares, ...p } }))
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const run = async () => {
    setErr(null); setLoading(true)
    try {
      const r = await computeSpares({
        quantity: parseInt(sp.quantity, 10) || 1,
        op_hours: pf(sp.opHours) ?? 0,
        duty_cycle: pf(sp.dutyCycle) ?? 1,
        mtbf: sp.basis === 'mtbf' ? pf(sp.mtbf) : null,
        failure_rate: sp.basis === 'rate' ? pf(sp.rate) : null,
        confidence: pf(sp.confidence) ?? 0.95,
      })
      patch({ result: r })
    } catch (e) { setErr(detail(e, 'Analysis failed')) } finally { setLoading(false) }
  }

  const r = sp.result

  const controls = (
    <>
      <Field label="Installed quantity" tip="Number of units in service." value={sp.quantity} onChange={v => patch({ quantity: v })} />
      <Field label="Operating hours" tip="Operating hours over the provisioning period." value={sp.opHours} onChange={v => patch({ opHours: v })} />
      <Field label="Duty cycle" tip="Fraction of operating hours the unit actually runs (0-1)." value={sp.dutyCycle} onChange={v => patch({ dutyCycle: v })} />
      <Select label="Demand basis" value={sp.basis} onChange={v => patch({ basis: v as SparesState['basis'] })}
        options={[
          { value: 'mtbf', label: 'MTBF' },
          { value: 'rate', label: 'Failure rate' },
        ]} />
      {sp.basis === 'mtbf'
        ? <Field label="MTBF (per unit)" tip="Mean time between failures of one unit." value={sp.mtbf} onChange={v => patch({ mtbf: v })} />
        : <Field label="Failure rate (per hour)" tip="Failures per hour of one unit." value={sp.rate} onChange={v => patch({ rate: v })} />}
      <Field label="Target confidence" tip="Desired probability of no stockout over the period (e.g. 0.95)." value={sp.confidence} onChange={v => patch({ confidence: v })} />
    </>
  )

  const results = r && (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <Card label="Required spares" value={String(r.required_spares)} accent />
        <Card label="Expected demand" value={fmtNum(r.expected_demand)} />
        <Card label="Achieved protection" value={`${(r.achieved_protection * 100).toFixed(2)}%`} />
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1">P(no stockout) vs spares stocked</p>
        <Plot
          data={[
            { x: r.curve.stock_level, y: r.curve.protection, type: 'bar', marker: { color: '#10b981' }, name: 'P(no stockout)' },
            { x: [r.required_spares, r.required_spares], y: [0, 1], mode: 'lines', line: { color: '#ef4444', width: 2, dash: 'dot' }, name: `required = ${r.required_spares}` },
          ] as Plotly.Data[]}
          layout={{ ...plotBase, height: 320, xaxis: { title: { text: 'Spares stocked' } }, yaxis: { title: { text: 'P(no stockout)' }, range: [0, 1] } } as Plotly.Layout}
          config={PLOT_CFG} style={{ width: '100%' }} useResizeHandler />
      </div>
    </div>
  )

  return <ToolLayout
    intro="Spare-parts provisioning. Models failure demand over the period as Poisson and returns the smallest stock level that meets the target no-stockout confidence, with a protection-vs-stock curve."
    controls={controls} err={err} loading={loading} onRun={run} runLabel="Compute" results={results} />
}
