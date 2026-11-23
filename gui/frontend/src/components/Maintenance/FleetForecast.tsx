import { useRef, useState } from 'react'
import Plot from '../shared/ExportablePlot'
import { computeFleetForecast, type FleetForecastRequest, type FleetForecastResponse, type FleetModel } from '../../api/lifecycle'
import { beginFolioRequest, getProjectState, readFolioState, useModuleState, useUnits } from '../../store/project'
import { useReliabilitySources } from '../shared/ldaFolios'
import { linkedSourcesFingerprint, resolveReliabilitySource } from '../shared/reliabilitySources'
import { ToolLayout, Card, detail } from '../ALT/toolkit'
import { inputCls } from '../shared/styles'
import InfoLabel from '../shared/InfoLabel'
import ExportResultsButton from '../shared/ExportResultsButton'
import { fmtNum } from '../shared/format'
import ExampleButton from '../shared/ExampleButton'

interface CohortRow { id: string; count: string; age: string; entry: string; exit: string }
export interface FleetForecastState {
  srcId: string; alpha: string; beta: string; horizon: string; cost: string; model: FleetModel
  cohorts: CohortRow[]; result: FleetForecastResponse | null
  sourceStale?: boolean; sourceStaleReason?: string
}
const INITIAL: FleetForecastState = { srcId: '', alpha: '', beta: '', horizon: '36', cost: '0', model: 'first_failure',
  cohorts: [{ id: 'Cohort 1', count: '', age: '0', entry: '0', exit: '' }], result: null }
const EXAMPLE: FleetForecastState = { ...INITIAL, alpha: '72', beta: '2.6', cost: '1500',
  cohorts: [{ id: 'Installed', count: '1000', age: '24', entry: '0', exit: '' },
    { id: 'New deliveries', count: '200', age: '0', entry: '12', exit: '' }] }
const LABELS: Record<FleetModel, string> = { first_failure: 'First failures', perfect_renewal: 'Perfect renewal', minimal_repair: 'Minimal repair' }
const finite = (s: string, label: string) => {
  if (!s.trim() || !Number.isFinite(Number(s))) throw new Error(`${label} must be a finite number.`)
  return Number(s)
}

export default function FleetForecast() {
  const [units] = useUnits()
  const [state, setState] = useModuleState<FleetForecastState>('maintFleet', INITIAL)
  const patch = (value: Partial<FleetForecastState>) => setState(old => ({ ...old, ...value, result: value.result ?? null }))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const sources = useReliabilitySources().filter(s => !['normal', 'gumbel'].includes(s.dist))
  const selectedSource = sources.find(s => s.id === state.srcId)
  const updateCohort = (index: number, field: keyof CohortRow, value: string) => patch({
    cohorts: state.cohorts.map((row, i) => i === index ? { ...row, [field]: value } : row),
  })
  const run = async () => {
    setError(null); setLoading(true)
    const project = getProjectState(), fingerprint = linkedSourcesFingerprint(project, state)
    const guard = beginFolioRequest('maintFleet', 'f0', readFolioState<FleetForecastState>('maintFleet', 'f0') ?? state,
      'maintenance', () => linkedSourcesFingerprint(getProjectState(), state))
    try {
      const source = state.srcId ? resolveReliabilitySource(project, state.srcId) : null
      const request: FleetForecastRequest = {
        dist: (source?.dist ?? 'weibull') as FleetForecastRequest['dist'],
        dist_params: source?.dist_params ?? { alpha: finite(state.alpha, 'Scale'), beta: finite(state.beta, 'Shape') },
        horizon: finite(state.horizon, 'Horizon'), cost_per_event: finite(state.cost, 'Event cost'), model: state.model,
        cohorts: state.cohorts.map((row, index) => ({ id: row.id.trim(), count: finite(row.count, `Cohort ${index+1} count`),
          age: finite(row.age, 'Age'), entry_time: finite(row.entry, 'Entry'), exit_time: row.exit.trim() ? finite(row.exit, 'Exit') : null })),
      }
      const result = await computeFleetForecast(request)
      if (!guard.isCurrent()) throw new Error('Inputs or linked sources changed. Recalculate the forecast.')
      const recorded = { ...result, _sourceFingerprint: fingerprint, _sourceSnapshots: source ? [source.snapshot] : [] }
      patch({ result: recorded })
    } catch (e) { setError(detail(e, e instanceof Error ? e.message : 'Could not forecast the fleet.')) }
    finally { guard.finish(); setLoading(false) }
  }
  const controls = <>
    <div className="flex justify-end"><ExampleButton hasData={state.result != null} onLoad={() => setState(EXAMPLE)} /></div>
    <div><InfoLabel tip="First failures remove failed items from risk. Perfect renewal replaces each failed item. Minimal repair restores function without resetting age.">Event model</InfoLabel>
      <select aria-label="Fleet event model" className={inputCls} value={state.model} onChange={e => patch({ model: e.target.value as FleetModel })}>
        {Object.entries(LABELS).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
      </select></div>
    <div><InfoLabel tip="Use a current adopted positive lifetime distribution, or enter a Weibull model.">Failure distribution</InfoLabel>
      <select aria-label="Fleet failure distribution" className={inputCls} value={state.srcId} onChange={e => patch({ srcId: e.target.value })}>
        <option value="">Manual Weibull</option>
        {state.srcId && !selectedSource && <option value={state.srcId}>Unavailable source</option>}
        {sources.map(s => <option key={s.id} value={s.id}>{s.name} — {s.label}</option>)}
      </select></div>
    {!state.srcId && <>
      <div><InfoLabel tip="Characteristic lifetime in the project exposure unit.">Weibull scale ({units})</InfoLabel><input aria-label="Fleet Weibull scale" className={inputCls} type="number" min="0" value={state.alpha} onChange={e => patch({ alpha: e.target.value })} /></div>
      <div><InfoLabel tip="Positive Weibull shape.">Weibull shape</InfoLabel><input aria-label="Fleet Weibull shape" className={inputCls} type="number" min="0" value={state.beta} onChange={e => patch({ beta: e.target.value })} /></div>
    </>}
    <div><InfoLabel tip="Time from forecast start; cohort entry and exit use this same clock.">Horizon ({units})</InfoLabel><input aria-label="Fleet horizon" className={inputCls} type="number" min="0" value={state.horizon} onChange={e => patch({ horizon: e.target.value })} /></div>
    <div><InfoLabel tip="Constant cost of each counted event. All costs use the same currency and price basis.">Cost per event</InfoLabel><input aria-label="Fleet event cost" className={inputCls} type="number" min="0" value={state.cost} onChange={e => patch({ cost: e.target.value })} /></div>
    {state.sourceStale && <p role="status" className="text-xs text-amber-800">Historical result — {state.sourceStaleReason}</p>}
  </>
  const result = state.result
  const results = <div ref={resultsRef}>
    <div className="flex items-center justify-between mb-2"><h3 className="text-sm font-semibold">Fleet cohorts</h3>
      <button type="button" className="secondary-button" disabled={state.cohorts.length >= 200} onClick={() => patch({ cohorts: [...state.cohorts, { id: `Cohort ${state.cohorts.length+1}`, count: '1', age: '0', entry: '0', exit: '' }] })}>Add cohort</button></div>
    <p className="text-xs text-slate-600 mb-3">Age is age at entry. Leave exit blank to retain the cohort through the horizon.</p>
    <div className="overflow-x-auto border rounded-lg mb-5"><table className="w-full text-xs"><thead className="bg-slate-50"><tr>
      {['Cohort', 'Units', `Age (${units})`, `Entry (${units})`, `Exit (${units})`, ''].map((label,i) => <th className="p-2 text-left" key={i}>{label}</th>)}
    </tr></thead><tbody>{state.cohorts.map((row,i) => <tr key={i} className="border-t">
      {(['id','count','age','entry','exit'] as const).map(field => <td key={field} className="p-1"><input aria-label={`Cohort ${i+1} ${field}`} className={inputCls} value={row[field]} onChange={e => updateCohort(i,field,e.target.value)} /></td>)}
      <td className="p-1"><button type="button" className="mini-button" aria-label={`Remove cohort ${i+1}`} disabled={state.cohorts.length===1} onClick={() => patch({ cohorts: state.cohorts.filter((_,j) => i!==j) })}>Remove</button></td>
    </tr>)}</tbody></table></div>
    {result && <>
      <div className="flex justify-end mb-3"><ExportResultsButton getElement={() => resultsRef.current} baseName="fleet_forecast" /></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4"><Card label="Expected events" value={fmtNum(result.total_expected_events)} accent />
        <Card label="Expected cost" value={fmtNum(result.total_expected_cost)} />
        <Card label="Probability of no events" value={result.probability_no_events[result.probability_no_events.length-1]?.toExponential(4) ?? '—'} />
        <Card label="Numerical count ±" value={result.numerical.maximum_count_half_width.toExponential(2)} tip="Deterministic solver error bound, not a statistical confidence interval." /></div>
      <p className="text-xs text-slate-600 mb-3">{LABELS[result.model]} · {result.model === 'first_failure' ? 'Each unit contributes at most one event.' : result.model === 'perfect_renewal' ? 'Replacement restores new condition; zero downtime.' : 'Repair retains age; zero downtime.'} Shading shows numerical bounds.</p>
      <div className="border rounded-lg"><Plot data={[
        { x: result.time, y: result.expected_events_upper, type: 'scatter', mode: 'lines', line: { width: 0 }, showlegend: false },
        { x: result.time, y: result.expected_events_lower, type: 'scatter', mode: 'lines', fill: 'tonexty', fillcolor: 'rgba(37,99,235,.14)', line: { width: 0 }, name: 'Numerical bounds' },
        { x: result.time, y: result.expected_events, type: 'scatter', mode: 'lines', line: { width: 2, color: '#2563eb' }, name: 'Expected events' },
      ]} layout={{ title: { text: 'Cumulative fleet events' }, xaxis: { title: { text: `Time (${units})` } }, yaxis: { title: { text: 'Expected events' } }, margin: { t: 45, r: 20, b: 50, l: 65 } }} config={{ responsive: true }} useResizeHandler style={{ width: '100%', height: 384 }} plotId="fleet-forecast" /></div>
      <div className="overflow-x-auto border rounded-lg mt-4"><table className="w-full text-xs"><thead className="bg-slate-50"><tr>{['Cohort','Units','Expected events','Expected cost'].map(x => <th key={x} className="p-2 text-left">{x}</th>)}</tr></thead><tbody>
        {result.cohorts.map(row => <tr className="border-t" key={row.id}><td className="p-2">{row.id}</td><td className="p-2">{row.count}</td><td className="p-2">{fmtNum(row.expected_events)}</td><td className="p-2">{fmtNum(row.expected_cost)}</td></tr>)}
      </tbody></table></div>
    </>}
  </div>
  return <ToolLayout intro="Forecast events and costs for installed units, deliveries, and scheduled retirements." controls={controls} results={results} onRun={run} runLabel="Forecast fleet" loading={loading} err={error} />
}
