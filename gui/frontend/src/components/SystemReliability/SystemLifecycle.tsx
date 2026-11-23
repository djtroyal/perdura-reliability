import { useEffect, useRef, useState } from 'react'
import Plot from '../shared/ExportablePlot'
import { detail, fmtNum, PLOT_CFG, plotBase } from '../ALT/toolkit'
import { useUnits, useModuleState, getProjectState } from '../../store/project'
import { downloadArtifact } from '../../store/artifactExport'
import { systemDiagramSignature, lifecycleSettingsSignature } from '../shared/systemLifecycleSource'
import { resolveLinkedNodes } from '../shared/reliabilitySources'
import { importSystemRepairTask, systemTaskSourceIssue, type SystemTaskCatalog } from '../shared/systemTaskImport'
import {
  analyzeSystemRenewal, analyzeSystemStates, simulateSystem, defaultComponentPolicy, initialLifecycleSettings,
  type SystemDiagram, type LifecycleState, type LifecycleSettings, type ComponentPolicy, type DurationModel,
} from '../../api/systemTools'

const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
const durationParams: Record<DurationModel['distribution'], [string, string, number][]> = {
  exponential: [['mean', 'Mean duration', 10]], deterministic: [['value', 'Duration', 1]],
  weibull: [['alpha', 'Scale η', 10], ['beta', 'Shape β', 2]],
  lognormal: [['mu', 'Log location μ', 2], ['sigma', 'Log scale σ', .5]],
  gamma: [['alpha', 'Shape', 2], ['beta', 'Scale', 5]], normal: [['mu', 'Mean', 10], ['sigma', 'SD', 2]],
}
function DurationFields({ label, value, onChange }: { label: string; value: DurationModel; onChange: (v: DurationModel) => void }) {
  return <fieldset className="flex flex-wrap items-end gap-2 rounded border p-2"><legend className="px-1 font-medium">{label}</legend>
    <label>Distribution<select aria-label={`${label} distribution`} value={value.distribution} onChange={e => {
      const d = e.target.value as DurationModel['distribution']; onChange({ distribution: d, params: Object.fromEntries(durationParams[d].map(([key, , fallback]) => [key, fallback])), condition_positive: false })
    }} className="block rounded border p-1">{Object.keys(durationParams).map(d => <option key={d}>{d}</option>)}</select></label>
    {durationParams[value.distribution].map(([key, title, fallback]) => <label key={key}>{title}<input aria-label={`${label} ${title}`} type="number" step="any" value={value.params[key] ?? fallback} onChange={e => onChange({ ...value, params: { ...value.params, [key]: Number(e.target.value) } })} className="block w-28 rounded border p-1" /></label>)}
    {value.distribution === 'normal' && <label><input type="checkbox" checked={!!value.condition_positive} onChange={e => onChange({ ...value, condition_positive: e.target.checked })} /> Condition on positive duration</label>}
  </fieldset>
}

export default function SystemLifecycle({ diagram, value, onChange, onClose, analysisId }: {
  diagram: SystemDiagram; analysisId?: string; value?: LifecycleState; onChange: (v: LifecycleState) => void; onClose: () => void
}) {
  const [units] = useUnits()
  const [taskCatalog] = useModuleState<SystemTaskCatalog>('maintTaskAnalysis', { tasks: [], personnel: [], resources: [] })
  const [tab, setTab] = useState<'renewal' | 'states' | 'simulation'>('renewal')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [statePage, setStatePage] = useState(0)
  const settings = value?.settings ?? initialLifecycleSettings()
  const signature = systemDiagramSignature(diagram)
  const taskIssue = systemTaskSourceIssue(taskCatalog, settings.policies, units, settings.repair_crews)
  const live = useRef({ signature, settings, taskIssue }); live.current = { signature, settings, taskIssue }
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const diagramStale = value?.modelSignature != null && value.modelSignature !== signature
  const inputStale = !!(value?.renewalResult || value?.simulationResult || value?.stateResult)
    && value?.inputSignature !== lifecycleSettingsSignature(settings)
  const stale = diagramStale || inputStale
  const change = (patch: Partial<LifecycleSettings>) => onChange({ settings: { ...settings, ...patch } })
  const numeric = (label: string, key: keyof LifecycleSettings, min = 0) => <label className="text-xs">{label}<input type="number" min={min} step="any" value={Number(settings[key])} onChange={e => change({ [key]: Number(e.target.value) })} className="mt-1 block w-full rounded border p-2" /></label>
  const components = new Map<string, { label: string; distribution: string }>()
  for (const node of diagram.nodes) {
    if (!(diagram.kind === 'rbd' ? ['component'] : ['basic', 'undeveloped', 'conditioning', 'external']).includes(node.type)) continue
    const key = String((diagram.kind === 'rbd' ? node.data.component_key : node.data.eventKey) || node.id)
    components.set(key, { label: String(node.data.label || key), distribution: String(node.data.distribution || 'No life model') })
  }
  const setPolicy = (key: string, patch: Partial<ComponentPolicy>) => change({ policies: { ...settings.policies, [key]: { ...(settings.policies[key] ?? defaultComponentPolicy()), ...patch } } })
  const run = async () => {
    setBusy(true); setError('')
    const start = JSON.stringify(live.current)
    const origin = getProjectState()
    const request = { ...diagram, overrides: settings.overrides, source_signature: signature }
    try {
      if (tab === 'simulation' && taskIssue) throw new Error(taskIssue)
      if (Object.keys(settings.overrides).length && JSON.stringify(settings.override_keys) !== JSON.stringify([...components.keys()].sort())) throw new Error('The component set changed since the state overrides were chosen. Reset overrides and evaluate the current states.')
      const result = tab === 'renewal' ? { renewalResult: await analyzeSystemRenewal(request, settings) }
        : tab === 'states' ? { stateResult: await analyzeSystemStates(request) } : { simulationResult: await simulateSystem(request, settings) }
      if (!active.current) return
      if (JSON.stringify(live.current) !== start) throw new Error('The diagram, source models or settings changed. Recalculate.')
      const current = getProjectState()
      if (current.identity.projectId !== origin.identity.projectId || current.units !== origin.units
        || systemDiagramSignature({ ...diagram, nodes: resolveLinkedNodes(current, diagram.nodes) }) !== signature)
        throw new Error('The project or adopted sources changed. Recalculate.')
      if (tab === 'simulation') {
        const issue = systemTaskSourceIssue(current.modules.maintTaskAnalysis as SystemTaskCatalog ?? { tasks: [], personnel: [], resources: [] }, settings.policies, current.units, settings.repair_crews)
        if (issue) throw new Error(issue)
      }
      onChange({ ...(!stale ? value : undefined), settings, modelSignature: signature,
        inputSignature: lifecycleSettingsSignature(settings), ...result })
    } catch (e) { if (active.current) setError(detail(e, 'System analysis failed')) }
    finally { if (active.current) setBusy(false) }
  }
  const renewal = stale ? undefined : value?.renewalResult
  const states = diagramStale ? undefined : value?.stateResult
  const statesDraft = !!states && (inputStale || JSON.stringify(states.evaluated_overrides ?? {}) !== JSON.stringify(settings.overrides))
  const downloadSystemText = (name: string, content: string, type = 'text/plain') => {
    void downloadArtifact(content, name, type, { kind: 'system-lifecycle', title: 'System lifecycle analysis',
      moduleKey: diagram.kind === 'rbd' ? 'system' : 'faultTree', analysisId }).catch(e => setError(detail(e, 'Export failed')))
  }
  const simulation = stale || taskIssue ? undefined : value?.simulationResult
  const metric = (label: string, number: number | null | undefined) => <div className="rounded border bg-white p-3"><p className="text-xs text-slate-500">{label}</p><p className="font-mono text-lg">{number == null ? 'Not identified' : fmtNum(number)}</p></div>
  return <div role="dialog" aria-modal="true" aria-label="System lifecycle analysis" className="fixed inset-6 z-50 flex flex-col overflow-hidden rounded-xl border bg-white shadow-2xl">
    <header className="flex items-center justify-between border-b p-4"><div><h2 className="font-semibold">System lifecycle analysis</h2><p className="text-xs text-slate-600">Current {diagram.kind.toUpperCase()} · {components.size} components · time in {units}. Component lifetimes follow the diagram and adopted sources.</p></div><button onClick={() => { active.current = false; onClose() }} className="rounded border px-3 py-2">Close</button></header>
    <div className="flex gap-2 border-b px-4 py-2">{(['renewal', 'states', 'simulation'] as const).map(t => <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)} className={`rounded px-3 py-2 text-sm ${tab === t ? 'bg-blue-100 text-blue-900' : 'bg-slate-50'}`}>{t === 'renewal' ? 'Renewal and MTTF' : t === 'states' ? 'State table and export' : 'Repairable simulation'}</button>)}</div>
    <div className="min-h-0 flex-1 space-y-4 overflow-auto p-5">
      {stale && <p role="status" className="rounded bg-amber-50 p-3 text-sm">Previous results have different or unverified diagram, source or settings inputs. Recalculate.</p>}
      {error && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {taskIssue && <p role="status" className="rounded bg-amber-50 p-3 text-sm">{taskIssue}</p>}
      {tab === 'renewal' && <><p className="text-sm">Renew every component together. A scheduled renewal holds a failed system down until the scheduled date; failure-or-age renewal restores at failure or age T. Restoration downtime is added to each cycle.</p><div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {numeric(`Renewal interval (${units})`, 'interval', .000001)}{numeric(`Restoration downtime (${units})`, 'downtime')}
        <label className="text-xs">Renewal policy<select value={settings.policy} onChange={e => change({ policy: e.target.value as LifecycleSettings['policy'] })} className="mt-1 block w-full rounded border p-2"><option value="scheduled">Fixed scheduled interval</option><option value="age">Failure or attained age</option></select></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.include_mttf} onChange={e => change({ include_mttf: e.target.checked })} /> Also integrate total MTTF</label>
      </div>{renewal && <><div className="grid grid-cols-2 gap-3 md:grid-cols-4">{metric('Mission reliability', renewal.reliability)}{metric('Restricted mean uptime', renewal.restricted_mean)}{metric('Total MTTF', renewal.mttf)}{metric('Cycle availability', renewal.availability)}{metric('Operating time / failure', renewal.mean_operating_time_per_failure)}{metric('Calendar time / failure', renewal.mean_calendar_time_per_failure)}{metric('Failures / calendar time', renewal.failure_frequency_per_calendar_time)}</div><p className="text-xs">MTTF integration: {renewal.mttf_status}. {renewal.numerical.note}</p>
      <Plot data={[{ x: renewal.curve.map(r => r.time), y: renewal.curve.map(r => r.reliability), type: 'scatter', mode: 'lines', name: 'Mission survival' }, { x: renewal.curve.map(r => r.time), y: renewal.curve.map(r => r.density), type: 'scatter', mode: 'lines', name: 'Failure density f(t)', yaxis: 'y2' }, { x: renewal.curve.map(r => r.time), y: renewal.curve.map(r => r.hazard), type: 'scatter', mode: 'lines', name: 'Hazard h(t)', yaxis: 'y2' }]} layout={{ ...plotBase, height: 280, xaxis: { title: { text: `Time (${units})` } }, yaxis: { title: { text: 'R(t)' }, range: [0, 1] }, yaxis2: { title: { text: `Rate (1/${units})` }, overlaying: 'y', side: 'right' } }} config={PLOT_CFG} style={{ width: '100%' }} useResizeHandler />
      <button className="rounded border px-3 py-2 text-sm" onClick={() => downloadSystemText('system-survival.csv', 'time,reliability,density,hazard\n' + renewal.curve.map(r => `${r.time},${r.reliability},${r.density ?? ''},${r.hazard ?? ''}`).join('\n'), 'text/csv')}>Export survival CSV</button><details><summary className="cursor-pointer text-sm">Renewal assumptions</summary><ul className="list-disc pl-5 text-xs">{renewal.assumptions.map(a => <li key={a}>{a}</li>)}</ul></details></>}</>}
      {tab === 'states' && <><p className="text-sm">Enumerate up to 4,096 complete states. Uncheck success to exclude a state, or check it to declare success. State overrides apply to lifecycle calculations; they do not change the source diagram. Noncoherent rules remain available for occupancy simulation, and cannot be integrated as survival.</p>
        {Object.keys(settings.overrides).length > 0 && <button className="rounded border px-3 py-2 text-sm" onClick={() => change({ overrides: {}, override_keys: undefined })}>Reset state overrides</button>}
        {states && <><div className="flex flex-wrap gap-2"><button disabled={statesDraft} className="rounded border px-3 py-2 text-sm disabled:opacity-40" onClick={() => downloadSystemText('system-states.csv', states.csv, 'text/csv')}>Export state CSV</button>{states.python_expression && <button disabled={statesDraft} className="rounded border px-3 py-2 text-sm disabled:opacity-40" onClick={() => downloadSystemText('system-survival.py', states.python_expression!)}>Export executable point-probability R(t)</button>}</div>{statesDraft ? <p role="status" className="text-xs text-amber-800">State selections changed. Evaluate states to refresh probabilities and exports.</p> : <p className="text-xs">Probability sum {states.probability_sum.toPrecision(8)} · success {states.success_probability.toPrecision(8)} · {states.coherent ? 'coherent' : 'noncoherent'}. {states.state_id_rule}</p>}
        <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr><th>State</th>{states.keys.map(k => <th key={k} className="p-2">{states.labels[k]}</th>)}<th>Success</th><th>Probability</th></tr></thead><tbody>{states.rows.slice(statePage * 100, (statePage + 1) * 100).map(row => <tr key={row.id} className="border-t"><td className="p-2">{row.id}</td>{states.keys.map(k => <td key={k} className="text-center">{row.working[k] ? 'Up' : 'Down'}</td>)}<td className="text-center"><input aria-label={`State ${row.id} succeeds`} type="checkbox" checked={settings.overrides[row.id] ?? row.success} onChange={e => {
          // Retain the current table while editing; mark numerical results stale.
          onChange({ settings: { ...settings, override_keys: states.keys, overrides: { ...settings.overrides, [row.id]: e.target.checked } }, stateResult: states, modelSignature: signature })
        }} /></td><td className="p-2 font-mono">{row.probability.toPrecision(6)}</td></tr>)}</tbody></table></div><div className="flex items-center gap-3"><button disabled={statePage === 0} onClick={() => setStatePage(p => p - 1)} className="rounded border px-3 py-1 disabled:opacity-40">Previous</button><span className="text-xs">Page {statePage + 1} / {Math.ceil(states.rows.length / 100)}</span><button disabled={(statePage + 1) * 100 >= states.rows.length} onClick={() => setStatePage(p => p + 1)} className="rounded border px-3 py-1 disabled:opacity-40">Next</button></div></>}
      </>}
      {tab === 'simulation' && <><p className="text-sm">Failure and restoration events use this diagram’s static success logic. Crews serve eligible jobs FIFO; all successful maintenance renews the component. A failed restoration queues another corrective job. PM uses a fixed calendar schedule.</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{numeric(`Measurement horizon (${units})`, 'horizon', .000001)}{numeric(`Warm-up (${units})`, 'warmup')}{numeric('Replications (20–5000)', 'replications', 20)}{numeric('Repair crews (0–64)', 'repair_crews')}{numeric('Seed', 'seed')}{numeric('Confidence (0–1)', 'confidence')}
        <label className="text-xs">Component failure clock<select value={settings.clock} onChange={e => change({ clock: e.target.value as LifecycleSettings['clock'] })} className="mt-1 block w-full rounded border p-2"><option value="calendar">Continues during system downtime</option><option value="operating">Pauses during system downtime</option></select></label>
        <label className="text-xs"><input type="checkbox" checked={settings.condition_positive_lifetimes} onChange={e => change({ condition_positive_lifetimes: e.target.checked })} /> Explicitly condition real-support life models on positive time</label></div>
        <div className="space-y-2">{[...components].map(([key, c]) => {
          const p = settings.policies[key] ?? defaultComponentPolicy()
          return <details key={key} className="rounded border p-3"><summary className="cursor-pointer text-sm font-medium">{c.label} · {c.distribution} life · {p.repair.distribution} restoration{p.pm_interval ? ` · PM every ${p.pm_interval} ${units}` : ''}</summary><div className="mt-3 space-y-3 text-xs">
            <DurationFields label={`${c.label} repair`} value={p.repair} onChange={repair => setPolicy(key, { repair, task_source: null })} />
            <div className="flex flex-wrap items-end gap-3"><label>Concurrent people per service<input aria-label={`${c.label} crew demand`} type="number" min={1} max={64} value={p.crew_demand ?? 1} onChange={e => setPolicy(key, { crew_demand: Number(e.target.value), task_source: null })} className="block w-32 rounded border p-2" /></label>
              {!!taskCatalog.tasks?.length && <label>Import a corrective maintenance task<select aria-label={`${c.label} maintenance task`} value="" onChange={e => {
                if (!e.target.value) return
                try {
                  const imported = importSystemRepairTask(taskCatalog, e.target.value, units)
                  if (Object.entries(settings.policies).some(([id, policy]) => id !== key && policy.crew_role_id && policy.crew_role_id !== imported.policy.crew_role_id)) throw new Error('All imported tasks must use the same qualified personnel pool.')
                  change({ repair_crews: imported.capacity, policies: { ...settings.policies, [key]: { ...p, ...imported.policy } } }); setError('')
                } catch (cause) { setError(detail(cause, 'Cannot import task')) }
              }} className="block rounded border p-2"><option value="">Choose task…</option>{taskCatalog.tasks.map(task => <option key={task.id} value={task.id}>{task.title} · revision {task.revision}</option>)}</select></label>}
            </div>
            {p.task_source && <p>Imported {p.task_source.title}, revision {p.task_source.revision}. Failure events trigger this service. DES uses FIFO scheduling; task criticality priorities, occurrence frequencies and economic costs are not used. Personnel demand and capacity are retained.</p>}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><label>PM interval (blank = none)<input type="number" value={p.pm_interval ?? ''} onChange={e => setPolicy(key, { pm_interval: e.target.value === '' ? null : Number(e.target.value) })} className="mt-1 block w-full rounded border p-2" /></label><label>Repair success probability<input type="number" min={0} max={1} step="any" value={p.repair_yield} onChange={e => setPolicy(key, { repair_yield: Number(e.target.value) })} className="mt-1 block w-full rounded border p-2" /></label><label>Initial spare tokens (blank = unlimited)<input type="number" min={0} value={p.spares ?? ''} onChange={e => setPolicy(key, { spares: e.target.value === '' ? null : Number(e.target.value) })} className="mt-1 block w-full rounded border p-2" /></label><label>Supply lead time<input type="number" min={0} value={p.supply_lead_time} onChange={e => setPolicy(key, { supply_lead_time: Number(e.target.value) })} className="mt-1 block w-full rounded border p-2" /></label></div>
            {p.pm_interval && <><DurationFields label={`${c.label} PM`} value={p.pm_duration} onChange={pm_duration => setPolicy(key, { pm_duration })} /><label><input type="checkbox" checked={p.defer_repair} onChange={e => setPolicy(key, { defer_repair: e.target.checked })} /> Release corrective repair only at the next PM visit</label></>}
          </div></details>
        })}</div>
        {simulation && <><p className="text-sm font-medium">{simulation.analysis_basis.replace(/_/g, ' ')} · {simulation.events_processed.toLocaleString()} event batches</p><div className="grid grid-cols-2 gap-3 md:grid-cols-4">{metric('Mean availability', simulation.availability.mean)}{metric('Mean critical failures / trial', simulation.critical_failures.mean)}{metric('Operating time / critical failure', simulation.mean_operating_time_per_critical_failure)}{metric('Calendar time / critical failure', simulation.mean_calendar_time_per_critical_failure)}{metric('Mean crew utilization', simulation.crew_utilization.mean)}{metric('Mean queue wait / started job', simulation.mean_queue_wait_per_started_job.mean)}</div><p className="text-xs">{settings.confidence * 100}% Monte Carlo mean-availability interval: [{simulation.availability.lower.toPrecision(6)}, {simulation.availability.upper.toPrecision(6)}]. Zero observed critical failures do not establish infinite MTBCF. Warm-up alone does not establish stationarity.</p>
          <Plot data={[{ x: simulation.curve.map(r => r.time), y: simulation.curve.map(r => r.availability), type: 'scatter', mode: 'lines', name: 'Point availability' }, { x: simulation.curve.map(r => r.time), y: simulation.curve.map(r => r.uninterrupted_success), type: 'scatter', mode: 'lines', name: 'Uninterrupted success' }]} layout={{ ...plotBase, height: 280, xaxis: { title: { text: `Measurement time (${units})` } }, yaxis: { range: [0, 1] } }} config={PLOT_CFG} style={{ width: '100%' }} useResizeHandler />
          <button className="rounded border px-3 py-2 text-sm" onClick={() => downloadSystemText('system-events.csv', 'time,event,component,system_up,crews_busy,queue_length,stock,measurement_window\n' + simulation.events.map(e => [e.time, e.event, e.component, e.system_up, e.crews_busy, e.queue_length, e.stock, e.measurement_window].map(csvCell).join(',')).join('\n'), 'text/csv')}>Export first-trial event log{simulation.event_log_truncated ? ' (bounded)' : ''}</button>
          <details><summary className="cursor-pointer text-sm">Event policy and assumptions</summary><ul className="list-disc pl-5 text-xs">{simulation.assumptions.map(a => <li key={a}>{a}</li>)}</ul></details>
        </>}
      </>}
    </div><footer className="flex gap-3 border-t bg-slate-50 p-4"><button disabled={busy} onClick={() => void run()} className="rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Calculating…' : tab === 'simulation' ? 'Simulate system' : tab === 'states' ? 'Evaluate states' : 'Calculate renewal'}</button><button disabled={!value || stale || statesDraft || !!taskIssue || busy} onClick={() => downloadSystemText('system-lifecycle-results.json', JSON.stringify({ diagram, ...value }, null, 2), 'application/json')} className="rounded border px-3 py-2 text-sm disabled:opacity-40">Export analysis with provenance</button></footer>
  </div>
}
