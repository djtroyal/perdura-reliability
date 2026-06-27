import { useState } from 'react'
import Plot from '../shared/ExportablePlot'
import {
  ToolLayout, Card, Field, Select, detail, fmtNum,
  inputCls, labelCls, PLOT_CFG, plotBase,
} from '../ALT/toolkit'
import { TabBar } from '../shared/ui'
import {
  computeAvailability, AvailabilityResponse,
  computeMaintainability, MaintainabilityResponse,
  computeSpares, SparesResponse,
} from '../../api/client'
import { useModuleState, useUnits } from '../../store/project'

// ── Persisted module state ───────────────────────────────────────────────────

interface AvailState {
  mtbf: string; mttr: string; mtbm: string; meanMaint: string
  adminDelay: string; logiDelay: string; result: AvailabilityResponse | null
}
interface MaintState {
  mode: 'lognormal' | 'data'; mu: string; sigma: string; samples: string
  percentile: string; result: MaintainabilityResponse | null
}
interface SparesState {
  quantity: string; opHours: string; dutyCycle: string
  basis: 'mtbf' | 'rate'; mtbf: string; rate: string; confidence: string
  result: SparesResponse | null
}
interface RamState { avail: AvailState; maint: MaintState; spares: SparesState }

const INITIAL: RamState = {
  avail: { mtbf: '500', mttr: '8', mtbm: '', meanMaint: '', adminDelay: '0', logiDelay: '0', result: null },
  maint: { mode: 'lognormal', mu: '1.5', sigma: '0.6', samples: '', percentile: '0.95', result: null },
  spares: { quantity: '10', opHours: '8760', dutyCycle: '1', basis: 'mtbf', mtbf: '50000', rate: '', confidence: '0.95', result: null },
}

const TABS = [
  { id: 'avail', label: 'Availability' },
  { id: 'maint', label: 'Maintainability' },
  { id: 'spares', label: 'Spares' },
] as const

const pf = (v: string): number | null => {
  const t = v.trim()
  if (t === '') return null
  const n = parseFloat(t)
  return isNaN(n) ? null : n
}

export default function RAM() {
  const [s, setS] = useModuleState<RamState>('ram', INITIAL)
  const [active, setActive] = useState<typeof TABS[number]['id']>('avail')

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TabBar tabs={TABS as unknown as { id: string; label: string }[]}
        active={active} onChange={id => setActive(id as typeof active)} />
      {active === 'avail' && <Availability s={s.avail} set={a => setS(p => ({ ...p, avail: a(p.avail) }))} />}
      {active === 'maint' && <Maintainability s={s.maint} set={a => setS(p => ({ ...p, maint: a(p.maint) }))} />}
      {active === 'spares' && <Spares s={s.spares} set={a => setS(p => ({ ...p, spares: a(p.spares) }))} />}
    </div>
  )
}

// ── Availability ─────────────────────────────────────────────────────────────

function Availability({ s, set }: { s: AvailState; set: (f: (p: AvailState) => AvailState) => void }) {
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [units] = useUnits()
  const patch = (p: Partial<AvailState>) => set(prev => ({ ...prev, ...p }))

  const run = async () => {
    setErr(null); setLoading(true)
    try {
      const r = await computeAvailability({
        mtbf: pf(s.mtbf), mttr: pf(s.mttr), mtbm: pf(s.mtbm), mean_maint_time: pf(s.meanMaint),
        admin_delay: pf(s.adminDelay) ?? 0, logistics_delay: pf(s.logiDelay) ?? 0,
      })
      patch({ result: r })
    } catch (e) { setErr(detail(e, 'Analysis failed')) } finally { setLoading(false) }
  }

  const pct = (v: number | null | undefined) => v == null ? '—' : `${(v * 100).toFixed(3)}%`
  const r = s.result

  const controls = (
    <>
      <Field label="MTBF" tip="Mean time between failures (uptime)." value={s.mtbf} onChange={v => patch({ mtbf: v })} />
      <Field label="MTTR" tip="Mean corrective time to repair." value={s.mttr} onChange={v => patch({ mttr: v })} />
      <Field label="MTBM (optional)" tip="Mean time between maintenance, including preventive. Used for achieved/operational availability." value={s.mtbm} onChange={v => patch({ mtbm: v })} />
      <Field label="Mean active maint. time (optional)" tip="M̄ — mean active corrective + preventive maintenance time. Used for achieved availability." value={s.meanMaint} onChange={v => patch({ meanMaint: v })} />
      <Field label="Admin delay" tip="Mean administrative delay before maintenance starts." value={s.adminDelay} onChange={v => patch({ adminDelay: v })} />
      <Field label="Logistics delay" tip="Mean logistics / supply delay (e.g. waiting for spares)." value={s.logiDelay} onChange={v => patch({ logiDelay: v })} />
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
        const uptime = pf(s.mtbm) ?? pf(s.mtbf)
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

// ── Maintainability ──────────────────────────────────────────────────────────

function Maintainability({ s, set }: { s: MaintState; set: (f: (p: MaintState) => MaintState) => void }) {
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [units] = useUnits()
  const patch = (p: Partial<MaintState>) => set(prev => ({ ...prev, ...p }))

  const run = async () => {
    setErr(null); setLoading(true)
    try {
      const samples = s.samples.split(/[\s,]+/).map(Number).filter(n => isFinite(n))
      const r = await computeMaintainability({
        mode: s.mode,
        mu: pf(s.mu), sigma: pf(s.sigma),
        samples: s.mode === 'data' ? samples : null,
        percentile: pf(s.percentile) ?? 0.95,
      })
      patch({ result: r })
    } catch (e) { setErr(detail(e, 'Analysis failed')) } finally { setLoading(false) }
  }

  const r = s.result

  const controls = (
    <>
      <Select label="Repair-time input" value={s.mode} onChange={v => patch({ mode: v as MaintState['mode'] })}
        options={[
          { value: 'lognormal', label: 'Lognormal parameters' },
          { value: 'data', label: 'Repair-time samples' },
        ]} />
      {s.mode === 'lognormal' ? <>
        <Field label="μ (log-space location)" tip="Mean of ln(repair time)." value={s.mu} onChange={v => patch({ mu: v })} />
        <Field label="σ (log-space scale)" tip="Std. dev. of ln(repair time)." value={s.sigma} onChange={v => patch({ sigma: v })} />
      </> : (
        <div>
          <label className={labelCls}>Repair-time samples</label>
          <textarea value={s.samples} onChange={e => patch({ samples: e.target.value })}
            rows={5} placeholder="e.g. 2.0 3.5 2.8 4.1 3.0" className={`${inputCls} resize-y`} />
          <p className="text-[10px] text-gray-400 mt-1">Fitted to a lognormal distribution (whitespace/comma separated).</p>
        </div>
      )}
      <Field label="Percentile for Mmax" tip="Percentile of the repair-time distribution for the maximum corrective time (e.g. 0.95)." value={s.percentile} onChange={v => patch({ percentile: v })} />
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

// ── Spares ───────────────────────────────────────────────────────────────────

function Spares({ s, set }: { s: SparesState; set: (f: (p: SparesState) => SparesState) => void }) {
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const patch = (p: Partial<SparesState>) => set(prev => ({ ...prev, ...p }))

  const run = async () => {
    setErr(null); setLoading(true)
    try {
      const r = await computeSpares({
        quantity: parseInt(s.quantity, 10) || 1,
        op_hours: pf(s.opHours) ?? 0,
        duty_cycle: pf(s.dutyCycle) ?? 1,
        mtbf: s.basis === 'mtbf' ? pf(s.mtbf) : null,
        failure_rate: s.basis === 'rate' ? pf(s.rate) : null,
        confidence: pf(s.confidence) ?? 0.95,
      })
      patch({ result: r })
    } catch (e) { setErr(detail(e, 'Analysis failed')) } finally { setLoading(false) }
  }

  const r = s.result

  const controls = (
    <>
      <Field label="Installed quantity" tip="Number of units in service." value={s.quantity} onChange={v => patch({ quantity: v })} />
      <Field label="Operating hours" tip="Operating hours over the provisioning period." value={s.opHours} onChange={v => patch({ opHours: v })} />
      <Field label="Duty cycle" tip="Fraction of operating hours the unit actually runs (0-1)." value={s.dutyCycle} onChange={v => patch({ dutyCycle: v })} />
      <Select label="Demand basis" value={s.basis} onChange={v => patch({ basis: v as SparesState['basis'] })}
        options={[
          { value: 'mtbf', label: 'MTBF' },
          { value: 'rate', label: 'Failure rate' },
        ]} />
      {s.basis === 'mtbf'
        ? <Field label="MTBF (per unit)" tip="Mean time between failures of one unit." value={s.mtbf} onChange={v => patch({ mtbf: v })} />
        : <Field label="Failure rate (per hour)" tip="Failures per hour of one unit." value={s.rate} onChange={v => patch({ rate: v })} />}
      <Field label="Target confidence" tip="Desired probability of no stockout over the period (e.g. 0.95)." value={s.confidence} onChange={v => patch({ confidence: v })} />
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
