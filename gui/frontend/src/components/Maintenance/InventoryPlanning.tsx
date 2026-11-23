import { useMemo, useState } from 'react'
import { Download, Plus, Trash2 } from 'lucide-react'
import { ToolLayout, Card, Field, Select, detail, inputCls } from '../ALT/toolkit'
import { getProjectState, useModuleFolios, useModuleState, useUnits } from '../../store/project'
import { currentProjectSystem, useSharedSystemDefinition } from '../../store/sharedSystem'
import { systemInputFingerprint, type PredictionScenario } from '../../store/sharedSystemModel'
import type { PredictionResponse } from '../../api/client'
import { planInventory, type InventoryItem, type InventoryResult } from '../../api/inventory'
import { convert, unitGroup } from '../../store/units'
import { downloadArtifact } from '../../store/artifactExport'
import { inventoryInputSignature, inventoryResultStatus } from '../../store/toolkitFreshness'

export interface InventoryRow {
  id: string; pn: string; sourceIds: string[]; quantity: string; rate: string; duty: string; stock: string; cost: string
  model: InventoryItem['model']; dispersion: string; eta: string; beta: string; repair: string
  pipeline: boolean; lead: string; leadSd: string; storageRate: string; age: string; entry: string; exit: string
}
export const newInventoryRow = (id: string = crypto.randomUUID()): InventoryRow => ({ id, pn: '', sourceIds: [], quantity: '1', rate: '', duty: '1', stock: '0', cost: '0', model: 'poisson', dispersion: '10', eta: '', beta: '', repair: '0', pipeline: false, lead: '0', leadSd: '0', storageRate: '0', age: '0', entry: '0', exit: '' })
export interface InventoryState {
  mode: 'period' | 'lifetime'; horizon: string; service: string; target: 'per_part' | 'joint'; dependence: 'independent' | 'unspecified'
  trials: string; seed: string; rows: InventoryRow[]; selectedId: string; scenarioId: string
  sourceFingerprint: string; linkedScenarioId: string; result: (InventoryResult & { _inputSignature?: string }) | null
  allocation: 'equal_risk' | 'minimum_cost'; maximumStock: string
}
export const INITIAL_INVENTORY: InventoryState = { mode: 'period', horizon: '8760', service: '.95', target: 'per_part', dependence: 'unspecified', trials: '1000', seed: '42', rows: [], selectedId: '', scenarioId: '', sourceFingerprint: '', linkedScenarioId: '', result: null, allocation: 'equal_risk', maximumStock: '200' }

export function inventoryRequestRows(rows: InventoryRow[], mode: 'period' | 'lifetime'): InventoryItem[] {
  const num = (s: string, label: string) => { if (!s.trim() || !Number.isFinite(Number(s))) throw new Error(`${label}: enter a finite number.`); return Number(s) }
  return rows.map(r => ({ part_number: r.pn, source_ids: r.sourceIds, quantity: num(r.quantity, 'Quantity'), failure_rate: r.model === 'weibull' ? 0 : num(r.rate, 'Failure rate'), duty_cycle: num(r.duty, 'Duty'), model: r.model,
    dispersion: num(r.dispersion, 'Dispersion'), weibull_alpha: r.model === 'weibull' ? num(r.eta, 'Weibull scale') : null, weibull_beta: r.model === 'weibull' ? num(r.beta, 'Weibull shape') : null,
    initial_stock: num(r.stock, 'Depot stock'), unit_cost: num(r.cost, 'Unit cost'), repair_probability: mode === 'lifetime' ? num(r.repair, 'Repair probability') : 0,
    include_pipeline: r.pipeline, lead_mean: num(r.lead, 'Return time'), lead_sd: num(r.leadSd, 'Return SD'), storage_failure_rate: mode === 'lifetime' ? num(r.storageRate, 'Storage failure rate') : 0,
    cohorts: mode === 'lifetime' ? [{ count: num(r.quantity, 'Quantity'), age: num(r.age, 'Operating age'), entry: num(r.entry, 'Entry'), exit: r.exit.trim() ? num(r.exit, 'Retirement') : null }] : [] }))
}

export default function InventoryPlanning() {
  const [s, set] = useModuleState<InventoryState>('maintInventory', INITIAL_INVENTORY)
  const [units] = useUnits(), [system] = useSharedSystemDefinition()
  const scenarios = useModuleFolios<PredictionScenario & { result?: PredictionResponse }>('prediction')
  const [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false)
  const patch = (value: Partial<InventoryState>) => set(old => ({ ...old, result: null, ...value }))
  const sourceSignature = (id: string) => {
    const raw = getProjectState().modules.prediction as { folios?: { id: string; dirty?: boolean; state: PredictionScenario & { result?: PredictionResponse } }[] } | undefined
    const f = raw?.folios?.find(v => v.id === id)
    return JSON.stringify([systemInputFingerprint(currentProjectSystem().model), id, f?.state.result?.request_sha256, f?.dirty, f?.state.partInputs, f?.state.blockInputs])
  }
  const stale = Boolean(s.linkedScenarioId && (sourceSignature(s.linkedScenarioId) !== s.sourceFingerprint || scenarios.find(f => f.id === s.linkedScenarioId)?.dirty))
  const selected = s.rows.find(r => r.id === s.selectedId) ?? s.rows[0]
  const edit = (p: Partial<InventoryRow>) => selected && patch({ rows: s.rows.map(row => row.id === selected.id ? { ...row, ...p } : row) })
  const sourceOptions = useMemo(() => [{ value: '', label: 'Choose a calculated scenario' }, ...scenarios.map(f => ({ value: f.id, label: `${f.name}${f.dirty ? ' (changed)' : ''}` }))], [scenarios])
  function importBOM() {
    try {
      setErr(null)
      if (unitGroup(units) !== 'time') throw new Error('Prediction rates are per hour. Use time units before importing the BOM.')
      const folio = scenarios.find(f => f.id === s.scenarioId), result = folio?.state.result
      if (!folio || folio.dirty || !result || result.source_fingerprint !== systemInputFingerprint(system.model)) throw new Error('Calculate a current Prediction scenario before importing its rates.')
      if (result.service_rate_available === false || result.rate_time_basis !== 'calendar_hours'
        || result.results.some(part => part.excluded || part.incompatible || part.error || part.failure_rate == null))
        throw new Error('Resolve incomplete or unavailable calendar-hour rates in Prediction before importing the BOM.')
      const instances = new Map(system.model.instances.map(i => [i.id, i])), definitions = new Map(system.model.definitions.map(d => [d.id, d]))
      const rows = result.results.flatMap(part => {
        if (part.failure_rate == null || !part.part_id) return []
        const instance = instances.get(part.part_id), definition = instance && definitions.get(instance.definition_id)
        if (!instance || !definition || definition.kind !== 'piece_part') return []
        let quantity = instance.quantity, parent = instance.parent_instance_id
        const seen = new Set([instance.id])
        while (parent) { const p = instances.get(parent); if (!p || seen.has(parent)) throw new Error('Invalid installed hierarchy.'); seen.add(parent); quantity *= p.quantity; parent = p.parent_instance_id }
        return [{ ...newInventoryRow(instance.id), pn: definition.part_number || instance.id, sourceIds: [instance.id], quantity: String(quantity), rate: String(part.failure_rate / 1e6 * convert(1, units, 'hours')) }]
      })
      if (!rows.length) throw new Error('The scenario has no calculated piece-part rates.')
      patch({ rows, selectedId: rows[0].id, sourceFingerprint: sourceSignature(folio.id), linkedScenarioId: folio.id })
    } catch (e) { setErr(detail(e, 'BOM import failed')) }
  }
  function loadExample() {
    if (unitGroup(units) !== 'time') { setErr('The procurement example uses time units.'); return }
    const row = { ...newInventoryRow(), pn: 'Serviceable pump', quantity: '100', rate: String(convert(1, units, 'hours') / 50000), repair: '.8', cost: '500' }
    patch({ mode: 'lifetime', horizon: String(convert(43800, 'hours', units)), service: '.95', target: 'per_part', allocation: 'equal_risk',
      rows: [row], selectedId: row.id, linkedScenarioId: '', sourceFingerprint: '' })
    setErr(null)
  }
  async function run() {
    setErr(null); setBusy(true)
    const inputSignature = inventoryInputSignature(s,units), signature = s.linkedScenarioId ? sourceSignature(s.linkedScenarioId) : ''
    const projectId = getProjectState().identity.projectId
    try {
      if (stale) throw new Error('The source scenario changed. Refresh the BOM rates or detach this snapshot before planning.')
      const result = await planInventory({ items: inventoryRequestRows(s.rows, s.mode), mode: s.mode, horizon: Number(s.horizon), service_probability: Number(s.service), target: s.target, dependence: s.dependence, simulations: Number(s.trials), seed: Number(s.seed), source_fingerprint: s.sourceFingerprint, units, allocation: s.allocation, maximum_stock: Number(s.maximumStock) })
      if (getProjectState().identity.projectId === projectId && getProjectState().units === units) set(current => inventoryInputSignature(current,units) === inputSignature && (!s.linkedScenarioId || sourceSignature(s.linkedScenarioId) === signature) ? { ...current, result: { ...result, _inputSignature: inputSignature } } : current)
    } catch (e) { setErr(detail(e, 'Inventory planning failed')) } finally { setBusy(false) }
  }
  const controls = <>
    <Select label="Planning basis" value={s.mode} onChange={mode => patch({ mode: mode as InventoryState['mode'] })} options={[{ value: 'period', label: 'Replenishment period' }, { value: 'lifetime', label: 'Lifetime procurement' }]} />
    <Field label={`Planning horizon (${units})`} value={s.horizon} onChange={horizon => patch({ horizon })} />
    <Select label="Prediction scenario" value={s.scenarioId} onChange={scenarioId => set(v => ({ ...v, scenarioId }))} options={sourceOptions} />
    <button type="button" onClick={importBOM} className="rounded border px-3 py-2 text-xs">Load installed BOM and rates</button>
    <button type="button" onClick={loadExample} className="rounded border px-3 py-2 text-xs">Load procurement example</button>
    {s.linkedScenarioId && <><p className={`text-xs ${stale ? 'text-amber-800' : 'text-gray-600'}`}>{stale ? 'Source changed: refresh rates.' : 'Prediction rates include operating duty; imported duty is 1.'}</p><button type="button" className="text-xs underline" onClick={() => patch({ linkedScenarioId: '', sourceFingerprint: '' })}>Use as manual inputs</button></>}
    <Select label="Service target applies to" value={s.target} onChange={target => patch({ target: target as InventoryState['target'] })} options={[{ value: 'per_part', label: 'Each part number' }, { value: 'joint', label: 'All part numbers together' }]} />
    <Field label="Service probability" value={s.service} onChange={service => patch({ service })} />
    <Select label="Demand dependence" value={s.dependence} onChange={dependence => patch({ dependence: dependence as InventoryState['dependence'] })} options={[{ value: 'unspecified', label: 'Unspecified — union bound' }, { value: 'independent', label: 'Independent part numbers' }]} />
    <Select label="Stock allocation" value={s.allocation} onChange={allocation => patch({ allocation: allocation as InventoryState['allocation'] })} options={[{ value: 'equal_risk', label: 'Equal service risk' }, { value: 'minimum_cost', label: 'Minimum purchase cost (analytic)' }]} />
    {s.allocation === 'minimum_cost' && <Field label="Maximum stock per part number" tip="Discrete optimization searches this explicit stock range. Requires a joint service target and analytic demand." value={s.maximumStock} onChange={maximumStock => patch({ maximumStock })} />}
    <details><summary className="cursor-pointer text-xs font-semibold">Simulation settings</summary><div className="mt-2 space-y-3"><Field label="Replications" value={s.trials} onChange={trials => patch({ trials })} /><Field label="Seed" value={s.seed} onChange={seed => patch({ seed })} /></div></details>
  </>
  const r = s.result
  const resultStatus = r ? inventoryResultStatus(getProjectState()) : null
  return <ToolLayout intro="Plan pooled part-number inventory from the installed system or manual rows." controls={controls} err={err} loading={busy} onRun={run} runLabel="Plan inventory" results={<div className="space-y-5">
    <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">Installed parts</h2><button type="button" className="inline-flex items-center gap-1 rounded border px-3 py-2 text-xs" onClick={() => { const row = newInventoryRow(); patch({ rows: [...s.rows, row], selectedId: row.id }) }}><Plus size={14} />Add part</button></div>
    <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr>{['Part number', 'Quantity', `Rate / ${units}`, 'Depot stock', 'Unit cost', ''].map((h, i) => <th className="px-2 py-2 text-left" key={i}>{h}</th>)}</tr></thead><tbody>{s.rows.map(row => <tr key={row.id} className={selected?.id === row.id ? 'bg-blue-50' : ''}>
      {(['pn', 'quantity', 'rate', 'stock', 'cost'] as const).map(key => <td key={key} className="p-1"><input aria-label={`${row.pn || 'Part'} ${key}`} className={`${inputCls} min-w-20`} value={row[key]} onFocus={() => set(v => ({ ...v, selectedId: row.id }))} onChange={e => patch({ rows: s.rows.map(v => v.id === row.id ? { ...v, [key]: e.target.value } : v) })} /></td>)}
      <td><button type="button" aria-label={`Remove ${row.pn || 'part'}`} className="p-2" onClick={() => patch({ rows: s.rows.filter(v => v.id !== row.id) })}><Trash2 size={14} /></button></td></tr>)}</tbody></table></div>
    {selected && <details key={selected.id}><summary className="cursor-pointer text-xs font-semibold">{selected.pn || 'Selected part'} — demand, repairs and service dates</summary><div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
      <Select label="Demand model" value={selected.model} onChange={model => edit({ model: model as InventoryRow['model'] })} options={[{ value: 'poisson', label: 'Constant-rate Poisson' }, { value: 'negative_binomial', label: 'Overdispersed count' }, { value: 'weibull', label: 'Weibull renewal' }]} />
      <Field label="Operating duty" value={selected.duty} onChange={duty => edit({ duty })} />
      {selected.model === 'negative_binomial' && <Field label="Dispersion" value={selected.dispersion} onChange={dispersion => edit({ dispersion })} />}
      {selected.model === 'weibull' && <><Field label={`Weibull scale (${units})`} value={selected.eta} onChange={eta => edit({ eta })} /><Field label="Weibull shape" value={selected.beta} onChange={beta => edit({ beta })} /></>}
      {s.mode === 'lifetime' && <><Field label="Successful repair probability" value={selected.repair} onChange={repair => edit({ repair })} /><Field label={`Operating age (${units})`} value={selected.age} onChange={age => edit({ age })} /><Field label={`Service entry (${units})`} value={selected.entry} onChange={entry => edit({ entry })} /><Field label={`Retirement (${units}, optional)`} value={selected.exit} onChange={exit => edit({ exit })} /><Field label={`Depot deterioration rate / ${units}`} tip="Independent exponential deterioration while a spare is stored. Zero disables storage losses." value={selected.storageRate} onChange={storageRate => edit({ storageRate })} /></>}
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={selected.pipeline} onChange={e => edit({ pipeline: e.target.checked })} />Include return pipeline</label>
      {selected.pipeline && <><Field label={`Return mean (${units})`} value={selected.lead} onChange={lead => edit({ lead })} /><Field label={`Return SD (${units})`} value={selected.leadSd} onChange={leadSd => edit({ leadSd })} /></>}
    </div></details>}
    {r && <>{resultStatus && !resultStatus.current && <p className="text-xs text-amber-800">Historical plan: {resultStatus.reason}. Recalculate before use.</p>}<div className="grid grid-cols-3 gap-3"><Card label="Purchase quantity" value={String(r.purchase_quantity)} accent /><Card label="Purchase cost" value={r.purchase_cost.toLocaleString(undefined, { maximumFractionDigits: 2 })} /><Card label={r.joint_protection == null ? 'Joint protection lower bound' : 'Joint protection'} value={`${(100 * (r.joint_protection ?? r.joint_protection_lower_bound)).toFixed(2)}%`} /></div>
      {r.simulation_uncertainty && <p className="text-xs text-gray-600">Simulation estimates are conditional on the supplied parameters. Stock intervals describe Monte Carlo uncertainty.</p>}
      {r.joint_protection_interval && <p className="text-xs text-gray-600">95% simultaneous joint-protection interval: {(100*r.joint_protection_interval.lower).toFixed(2)}%–{(100*r.joint_protection_interval.upper).toFixed(2)}%.</p>}
      <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr>{['Part number', 'Installed', 'Required stock', 'Purchase', 'Purchase cost', 'Service probability'].map(h => <th className="px-2 py-2 text-left" key={h}>{h}</th>)}</tr></thead><tbody>{r.rows.map(v => <tr key={v.part_number} className="border-t"><td className="p-2">{v.part_number}</td><td>{v.quantity}</td><td>{v.required_stock}{v.stock_interval && <span className="block text-gray-600">95% MC: {v.stock_interval.lower}–{v.stock_interval.upper ?? 'unbounded'}</span>}</td><td>{v.purchase_quantity}</td><td>{v.purchase_cost.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td><td>{(100 * v.achieved_protection).toFixed(2)}%</td></tr>)}</tbody></table></div>
      <button type="button" className="inline-flex items-center gap-1 rounded border px-3 py-2 text-xs" onClick={() => void downloadArtifact(JSON.stringify(r, null, 2), 'inventory-plan.json', 'application/json', { kind: 'inventory-plan', moduleKey: 'maintInventory' })}><Download size={14} />Export plan</button></>}
  </div>} />
}
