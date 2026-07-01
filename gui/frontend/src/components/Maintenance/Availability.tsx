import { useState } from 'react'
import Plot from '../shared/ExportablePlot'
import { ToolLayout, Card, Field, detail, fmtNum, PLOT_CFG, plotBase } from '../ALT/toolkit'
import { computeAvailability } from '../../api/client'
import { useModuleState, useUnits } from '../../store/project'
import { RamState, AvailState, INITIAL, pf } from './ram'

/** Inherent / achieved / operational availability from MTBF, MTTR and delays. */
export default function Availability() {
  const [s, setS] = useModuleState<RamState>('ram', INITIAL)
  const av = s.avail
  const patch = (p: Partial<AvailState>) => setS(prev => ({ ...prev, avail: { ...prev.avail, ...p } }))
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [units] = useUnits()

  const run = async () => {
    setErr(null); setLoading(true)
    try {
      const r = await computeAvailability({
        mtbf: pf(av.mtbf), mttr: pf(av.mttr), mtbm: pf(av.mtbm), mean_maint_time: pf(av.meanMaint),
        admin_delay: pf(av.adminDelay) ?? 0, logistics_delay: pf(av.logiDelay) ?? 0,
      })
      patch({ result: r })
    } catch (e) { setErr(detail(e, 'Analysis failed')) } finally { setLoading(false) }
  }

  const pct = (v: number | null | undefined) => v == null ? '—' : `${(v * 100).toFixed(3)}%`
  const r = av.result

  const controls = (
    <>
      <Field label="MTBF" tip="Mean time between failures (uptime)." value={av.mtbf} onChange={v => patch({ mtbf: v })} />
      <Field label="MTTR" tip="Mean corrective time to repair." value={av.mttr} onChange={v => patch({ mttr: v })} />
      <Field label="MTBM (optional)" tip="Mean time between maintenance, including preventive. Used for achieved/operational availability." value={av.mtbm} onChange={v => patch({ mtbm: v })} />
      <Field label="Mean active maint. time (optional)" tip="M̄ — mean active corrective + preventive maintenance time. Used for achieved availability." value={av.meanMaint} onChange={v => patch({ meanMaint: v })} />
      <Field label="Admin delay" tip="Mean administrative delay before maintenance starts." value={av.adminDelay} onChange={v => patch({ adminDelay: v })} />
      <Field label="Logistics delay" tip="Mean logistics / supply delay (e.g. waiting for spares)." value={av.logiDelay} onChange={v => patch({ logiDelay: v })} />
    </>
  )

  const results = r && (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <Card label="Inherent availability (Ai)" value={pct(r.inherent)} accent />
        <Card label="Achieved availability (Aa)" value={pct(r.achieved)} />
        <Card label="Operational availability (Ao)" value={pct(r.operational)} accent />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="Mean down time (MDT)" value={fmtNum(r.mean_down_time)} />
        <Card label="Repair (MTTR)" value={fmtNum(r.downtime_breakdown.repair)} />
        <Card label="Admin delay" value={fmtNum(r.downtime_breakdown.admin_delay)} />
        <Card label="Logistics delay" value={fmtNum(r.downtime_breakdown.logistics_delay)} />
      </div>
      {(() => {
        // Where availability is lost: uptime vs the components of downtime.
        const uptime = pf(av.mtbm) ?? pf(av.mtbf)
        const d = r.downtime_breakdown
        const admin = d.admin_delay ?? 0
        const logi = d.logistics_delay ?? 0
        if (r.mean_down_time == null || uptime == null || (admin <= 0 && logi <= 0)) return null
        const seg = (name: string, value: number | null, color: string): Plotly.Data => ({
          x: [value ?? 0], y: ['Mean cycle'], type: 'bar', orientation: 'h', name,
          marker: { color }, hovertemplate: `${name}: %{x}<extra></extra>`,
        })
        return (
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-1">
              Where availability is lost {r.operational != null && `(Ao = ${(r.operational * 100).toFixed(2)}%)`}
            </p>
            <Plot
              data={[
                seg('Uptime', uptime, '#10b981'),
                seg('Repair', d.repair, '#ef4444'),
                seg('Admin delay', admin, '#f59e0b'),
                seg('Logistics delay', logi, '#3b82f6'),
              ]}
              layout={{ ...plotBase, height: 170, barmode: 'stack',
                margin: { t: 10, r: 20, b: 40, l: 80 },
                xaxis: { title: { text: `Time (${units})` } },
                yaxis: { title: { text: '' } },
                legend: { orientation: 'h', y: -0.3, font: { size: 10 } } } as Plotly.Layout}
              config={PLOT_CFG} style={{ width: '100%' }} useResizeHandler />
          </div>
        )
      })()}
      <p className="text-[11px] text-gray-500 leading-snug">
        Ai = MTBF/(MTBF+MTTR) ignores delays. Ao = uptime/(uptime+MDT) where MDT = MTTR + admin + logistics
        delay. For state-based (degraded-mode) availability, use the Markov tab under System Modeling.
      </p>
    </div>
  )

  return <ToolLayout
    intro="Availability from MTBF, MTTR and downtime delays. Inherent availability uses repair time only; operational availability adds administrative and logistics delay. Supply MTBM and mean maintenance time for achieved availability."
    controls={controls} err={err} loading={loading} onRun={run} runLabel="Compute" results={results} />
}
