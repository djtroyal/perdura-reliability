import { useState } from 'react'
import { AlertTriangle, Play, Plus, Trash2 } from 'lucide-react'

import { planReliabilityGrowth, type GrowthPlanResponse } from '../../api/client'
import Plot from '../shared/ExportablePlot'
import InfoLabel from '../shared/InfoLabel'
import { Card } from '../shared/ui'
import { inputCls, labelCls } from '../shared/styles'


interface FixRow {
  name: string
  rate: string
  time: string
  effectiveness: string
  lower: string
  upper: string
}

export interface GrowthPlanningState {
  currentTime: string
  currentMtbf: string
  targetMtbf: string
  growthRate: string
  plannedAdditionalTime: string
  unaddressedRate: string
  actions: FixRow[]
  result?: GrowthPlanResponse | null
}

export const INITIAL_GROWTH_PLANNING_STATE: GrowthPlanningState = {
  currentTime: '', currentMtbf: '', targetMtbf: '', growthRate: '0.3',
  plannedAdditionalTime: '', unaddressedRate: '', actions: [], result: null,
}

const fmt = (value: number | null | undefined) => {
  if (value == null || !Number.isFinite(value)) return '—'
  if (value !== 0 && (Math.abs(value) < 1e-3 || Math.abs(value) >= 1e4)) return value.toExponential(3)
  return value.toFixed(4)
}

export default function GrowthPlanning({ state, setState, units }: {
  state: GrowthPlanningState
  setState: (value: GrowthPlanningState | ((previous: GrowthPlanningState) => GrowthPlanningState)) => void
  units: string
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const patch = (change: Partial<GrowthPlanningState>) => {
    setState(previous => ({ ...previous, ...change, result: null }))
    setError(null)
  }
  const updateAction = (index: number, field: keyof FixRow, value: string) => patch({
    actions: state.actions.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row),
  })
  const run = async () => {
    const required = [state.currentTime, state.currentMtbf, state.targetMtbf, state.growthRate].map(Number)
    if (required.some(value => !Number.isFinite(value) || value <= 0)) {
      setError('Current time, current MTBF, target MTBF, and growth rate must be positive.'); return
    }
    if (!(required[3] < 1)) { setError('Growth rate must be strictly between 0 and 1.'); return }
    const actions = state.actions.filter(row => Object.values(row).some(value => value.trim()))
    if (actions.some(row => !row.name.trim() || !(Number(row.rate) >= 0)
        || !(Number(row.time) >= required[0]) || !(Number(row.effectiveness) >= 0 && Number(row.effectiveness) <= 1))) {
      setError('Each corrective action needs a name, non-negative rate, fix time at or after the current time, and effectiveness from 0 to 1.')
      return
    }
    setLoading(true); setError(null)
    try {
      const result = await planReliabilityGrowth({
        current_test_time: required[0], current_mtbf: required[1],
        target_mtbf: required[2], growth_rate: required[3],
        planned_additional_test_time: Number(state.plannedAdditionalTime) || undefined,
        unaddressed_failure_rate: Number(state.unaddressedRate) || 0,
        corrective_actions: actions.map(row => ({
          name: row.name.trim(), baseline_failure_rate: Number(row.rate),
          planned_fix_time: Number(row.time), effectiveness: Number(row.effectiveness),
          effectiveness_lower: row.lower.trim() ? Number(row.lower) : Number(row.effectiveness),
          effectiveness_upper: row.upper.trim() ? Number(row.upper) : Number(row.effectiveness),
        })),
      })
      setState(previous => ({ ...previous, result }))
    } catch (caught: unknown) {
      setError((caught as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        || (caught instanceof Error ? caught.message : 'Growth planning failed.'))
    } finally { setLoading(false) }
  }
  const result = state.result
  const fixes = result?.corrective_action_projection
  return (
    <div className="flex flex-1 overflow-hidden">
      <aside className="w-80 flex-shrink-0 overflow-y-auto border-r border-gray-200 bg-white p-4 space-y-4">
        <div className="rounded border border-blue-100 bg-blue-50 p-2 text-[11px] text-blue-800">
          Plan a target trajectory from an established current point. Fit recurrence data in Growth Models first; this view does not infer a growth rate from these planning inputs.
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><InfoLabel tip="Accumulated test exposure at the planning baseline.">Current test time</InfoLabel><input type="number" min="0" value={state.currentTime} onChange={event => patch({ currentTime: event.target.value })} className={inputCls} /></div>
          <div><InfoLabel tip="Instantaneous MTBF supported or adopted at the planning baseline.">Current MTBF</InfoLabel><input type="number" min="0" value={state.currentMtbf} onChange={event => patch({ currentMtbf: event.target.value })} className={inputCls} /></div>
          <div><label className={labelCls}>Target MTBF</label><input type="number" min="0" value={state.targetMtbf} onChange={event => patch({ targetMtbf: event.target.value })} className={inputCls} /></div>
          <div><InfoLabel tip="Power-law MTBF exponent α. It must be between 0 and 1 and should be justified from a program plan or prior evidence.">Growth rate α</InfoLabel><input type="number" min="0" max="1" step="0.01" value={state.growthRate} onChange={event => patch({ growthRate: event.target.value })} className={inputCls} /></div>
          <div><InfoLabel tip="Optional exposure already budgeted beyond the current test point. Blank solves the exposure needed to reach the target.">Planned additional test</InfoLabel><input type="number" min="0" value={state.plannedAdditionalTime} onChange={event => patch({ plannedAdditionalTime: event.target.value })} className={inputCls} /></div>
          <div><InfoLabel tip="Failure-rate contribution not assigned to a listed corrective action. It remains in the projected growth-potential rate.">Unaddressed rate</InfoLabel><input type="number" min="0" value={state.unaddressedRate} onChange={event => patch({ unaddressedRate: event.target.value })} className={inputCls} /></div>
        </div>
        <details className="rounded border border-gray-200" open={state.actions.length > 0}>
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-gray-700">Delayed corrective actions</summary>
          <div className="border-t border-gray-200 p-2 space-y-2">
            {state.actions.map((row, index) => <div key={index} className="rounded border border-gray-200 bg-gray-50 p-2">
              <div className="mb-1 flex gap-1"><input value={row.name} onChange={event => updateAction(index, 'name', event.target.value)} placeholder="Failure mode / action" className="min-w-0 flex-1 rounded border border-gray-300 px-1.5 py-1 text-xs" />
                <button onClick={() => patch({ actions: state.actions.filter((_, rowIndex) => rowIndex !== index) })} className="text-gray-300 hover:text-red-500"><Trash2 size={12} /></button></div>
              <div className="grid grid-cols-2 gap-1 text-[10px]">
                <label>Baseline rate<input type="number" min="0" value={row.rate} onChange={event => updateAction(index, 'rate', event.target.value)} className={inputCls} /></label>
                <label>Fix time<input type="number" min="0" value={row.time} onChange={event => updateAction(index, 'time', event.target.value)} className={inputCls} /></label>
                <label>Effectiveness<input type="number" min="0" max="1" step="0.01" value={row.effectiveness} onChange={event => updateAction(index, 'effectiveness', event.target.value)} className={inputCls} /></label>
                <label>Low / high<div className="flex gap-1"><input type="number" min="0" max="1" step="0.01" value={row.lower} onChange={event => updateAction(index, 'lower', event.target.value)} className={inputCls} /><input type="number" min="0" max="1" step="0.01" value={row.upper} onChange={event => updateAction(index, 'upper', event.target.value)} className={inputCls} /></div></label>
              </div>
            </div>)}
            <button onClick={() => patch({ actions: [...state.actions, { name: '', rate: '', time: state.currentTime, effectiveness: '0.7', lower: '', upper: '' }] })}
              className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-blue-600"><Plus size={11} /> Add corrective action</button>
          </div>
        </details>
        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
        <button onClick={run} disabled={loading} className="flex w-full items-center justify-center gap-2 rounded bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          <Play size={14} /> {loading ? 'Planning…' : 'Build plan'}
        </button>
      </aside>
      <main className="flex-1 overflow-y-auto bg-gray-50 p-5">
        {!result ? <div className="flex h-full items-center justify-center text-sm text-gray-400">Enter an anchored target trajectory to build a growth plan.</div> :
          <div className="mx-auto max-w-6xl space-y-4">
            <div className="flex gap-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800"><AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />{result.trajectory.warning}</div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Card label={`Additional test to target (${units})`} value={fmt(result.trajectory.additional_test_time_to_target)} accent />
              <Card label={`Planned end MTBF (${units})`} value={fmt(result.trajectory.planned_end_mtbf)} />
              <Card label="Target at planned end" value={result.trajectory.target_met_at_planned_end ? 'Met' : 'Not met'} />
              <Card label="Expected failures to planned end" value={fmt(result.trajectory.expected_failures_to_planned_end)} />
            </div>
            <section className="rounded-lg border border-gray-200 bg-white p-3">
              <Plot plotId="growth-plan-trajectory" reportLabel="Growth Planning Trajectory"
                data={[
                  { x: result.trajectory.curve.time, y: result.trajectory.curve.instantaneous_mtbf, mode: 'lines', name: 'Planned MTBF', line: { color: '#2563eb', width: 2.5 } } as Plotly.Data,
                  { x: [result.trajectory.test_time_at_target], y: [result.trajectory.target_mtbf], mode: 'markers', name: 'Target', marker: { color: '#16a34a', size: 10, symbol: 'diamond' } } as Plotly.Data,
                ]} layout={{ autosize: true, height: 400, margin: { l: 65, r: 25, t: 42, b: 55 }, title: { text: 'Anchored reliability-growth target trajectory' },
                  xaxis: { title: { text: `Accumulated test time (${units})` }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: `Instantaneous MTBF (${units})` }, gridcolor: '#e5e7eb', rangemode: 'tozero' } }}
                useResizeHandler style={{ width: '100%', height: 400 }} />
            </section>
            {fixes && <>
              <div className="flex gap-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800"><AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />{fixes.warning}</div>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Card label="Initial failure rate" value={fmt(fixes.initial_failure_rate)} />
                <Card label={`Initial MTBF (${units})`} value={fmt(fixes.initial_mtbf)} />
                <Card label="Growth-potential rate" value={fmt(fixes.growth_potential_failure_rate)} />
                <Card label={`Growth-potential MTBF (${units})`} value={fmt(fixes.growth_potential_mtbf)} accent
                  tip={`Effectiveness sensitivity: ${fmt(fixes.growth_potential_mtbf_lower)} to ${fmt(fixes.growth_potential_mtbf_upper)}.`} />
              </div>
              <section className="rounded-lg border border-gray-200 bg-white p-3">
                <Plot plotId="growth-plan-delayed-fixes" reportLabel="Delayed Corrective Action Projection"
                  data={[{ x: fixes.steps.map(step => step.time), y: fixes.steps.map(step => step.failure_rate), mode: 'lines+markers', name: 'Projected failure rate', line: { color: '#dc2626', width: 2, shape: 'hv' } } as Plotly.Data]}
                  layout={{ autosize: true, height: 360, margin: { l: 65, r: 25, t: 42, b: 55 }, title: { text: 'Delayed corrective-action projection' },
                    xaxis: { title: { text: `Accumulated test time (${units})` }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'Failure rate' }, gridcolor: '#e5e7eb', rangemode: 'tozero' } }}
                  useResizeHandler style={{ width: '100%', height: 360 }} />
              </section>
              <section className="overflow-hidden rounded-lg border border-gray-200 bg-white"><table className="w-full text-xs"><thead className="bg-gray-50 text-gray-500"><tr><th className="px-3 py-2 text-left">Action</th><th className="px-3 py-2 text-right">Fix time</th><th className="px-3 py-2 text-right">Mode rate</th><th className="px-3 py-2 text-right">Effectiveness</th><th className="px-3 py-2 text-right">Rate reduction</th><th className="px-3 py-2 text-right">System rate after</th></tr></thead>
                <tbody>{fixes.actions.map(action => <tr key={action.name} className="border-t border-gray-100"><td className="px-3 py-2">{action.name}</td><td className="px-3 py-2 text-right">{fmt(action.planned_fix_time)}</td><td className="px-3 py-2 text-right">{fmt(action.baseline_failure_rate)}</td><td className="px-3 py-2 text-right">{fmt(action.effectiveness)}</td><td className="px-3 py-2 text-right">{fmt(action.projected_rate_reduction)}</td><td className="px-3 py-2 text-right">{fmt(action.failure_rate_after)}</td></tr>)}</tbody>
              </table></section>
            </>}
            <p className="text-[10px] text-gray-400">{result.standards_context.status.replace(/_/g, ' ')} · {result.standards_context.claim}</p>
          </div>}
      </main>
    </div>
  )
}
