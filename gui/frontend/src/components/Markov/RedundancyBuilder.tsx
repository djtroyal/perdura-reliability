import { useEffect, useRef, useState } from 'react'
import { buildRedundancy, type RedundancyRequest, type RedundancyResult } from '../../api/systemTools'
import { useReliabilitySources } from '../shared/ldaFolios'
import { detail, fmtNum } from '../ALT/toolkit'
import { useUnits } from '../../store/project'

export default function RedundancyBuilder({ onApply, onClose, missionTime }: {
  onApply: (result: RedundancyResult) => void; onClose: () => void; missionTime: number
}) {
  const [units] = useUnits()
  const sources = useReliabilitySources('constant-rate')
  const [source, setSource] = useState('')
  const [request, setRequest] = useState<RedundancyRequest>({ mode: 'active', required: 1, total: 2,
    failure_rate: .001, repair_rate: .01, repair_crews: 1, dormant_rate: 0, coverage: 1,
    switching: 'independent', switch_repair_rate: .01, mission_time: missionTime })
  const [unequal, setUnequal] = useState(false), [rates, setRates] = useState<{ failure: number; repair: number }[]>([])
  const [result, setResult] = useState<RedundancyResult>(), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [previewSignature, setPreviewSignature] = useState('')
  const live = useRef(''); live.current = JSON.stringify({ request, source, sources, unequal, rates, units })
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const patch = (p: Partial<RedundancyRequest>) => { setRequest(r => ({ ...r, ...p })); setResult(undefined) }
  const number = (key: keyof RedundancyRequest, label: string, min = 0, max?: number) => <label className="text-xs">{label}<input type="number" min={min} max={max} step="any" value={Number(request[key])} onChange={e => patch({ [key]: Number(e.target.value) })} className="mt-1 block w-full rounded border p-2" /></label>
  const build = async () => {
    setBusy(true); setError('')
    const signature = live.current
    try {
      const usesSource = !unequal || request.mode === 'standby'
      const selected = usesSource ? sources.find(s => s.id === source) : undefined
      if (usesSource && source && !selected) throw new Error('The selected adopted rate is no longer current.')
      const r = await buildRedundancy({ ...request, failure_rate: selected?.dist_params.lambda ?? request.failure_rate,
        ...(unequal && request.mode === 'active' ? {
          failure_rates: Array.from({ length: request.total }, (_, i) => rates[i]?.failure ?? request.failure_rate),
          repair_rates: Array.from({ length: request.total }, (_, i) => rates[i]?.repair ?? request.repair_rate),
        } : {}),
      })
      if (!active.current) return
      if (signature !== live.current) throw new Error('Inputs or adopted sources changed while building. Preview again.')
      if (selected) r.assumptions.push(`Failure-rate snapshot from adopted source ${selected.name}; rebuild after source revision. Snapshot rate ${selected.dist_params.lambda} per ${units}.`)
      setResult(r)
      setPreviewSignature(signature)
    } catch (e) { if (active.current) setError(detail(e, 'Could not build redundancy model')) }
    finally { if (active.current) setBusy(false) }
  }
  return <div role="dialog" aria-modal="true" aria-label="Build repairable redundancy" className="fixed inset-8 z-50 flex flex-col overflow-hidden rounded-xl border bg-white shadow-2xl">
    <header className="flex justify-between border-b p-4"><h2 className="font-semibold">Build repairable redundancy</h2><button onClick={onClose} className="rounded border px-3 py-1">Close</button></header>
    <div className="min-h-0 flex-1 space-y-4 overflow-auto p-5"><p className="text-sm">Generate an editable Markov model with explicit repair resources. The preview lists its assumptions before replacing the current canvas.</p>
      {error && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><label className="text-xs">Configuration<select aria-label="Configuration" value={request.mode} onChange={e => patch({ mode: e.target.value as RedundancyRequest['mode'] })} className="mt-1 block w-full rounded border p-2"><option value="active">Active m-of-n</option><option value="standby">Active positions + shared standby pool</option></select></label>
        {number('required', 'Required active units', 1, request.total)}{number('total', 'Total units', 1, unequal && request.mode === 'active' ? 9 : 60)}{number('repair_crews', 'Concurrent repair crews', 0, request.total)}
        {number('failure_rate', `Unit active failure rate (1/${units})`)}{number('repair_rate', `Unit repair rate (1/${units})`)}
      </div>
      {sources.length > 0 && (!unequal || request.mode === 'standby') && <label className="block text-xs">Use an adopted constant-rate snapshot<select value={source} onChange={e => { setSource(e.target.value); setResult(undefined) }} className="mt-1 rounded border p-2"><option value="">Manual failure rate</option>{sources.map(s => <option key={s.id} value={s.id}>{s.name} — {s.label}</option>)}</select></label>}
      {request.mode === 'active' && <><label className="text-sm"><input type="checkbox" checked={unequal} onChange={e => { setUnequal(e.target.checked); setResult(undefined) }} /> Different failure and repair rates by unit (maximum 9)</label>{unequal && <div className="overflow-auto"><table className="text-xs"><thead><tr><th className="p-2">Unit / priority</th><th>Failure rate</th><th>Repair rate</th></tr></thead><tbody>{Array.from({ length: Math.min(request.total, 9) }, (_, i) => <tr key={i}><td className="p-2">{i + 1}</td>{(['failure', 'repair'] as const).map(k => <td key={k}><input aria-label={`Unit ${i + 1} ${k} rate`} className="m-1 w-32 rounded border p-2" type="number" min={0} step="any" value={rates[i]?.[k] ?? (k === 'failure' ? request.failure_rate : request.repair_rate)} onChange={e => { setRates(current => Array.from({ length: request.total }, (_, j) => ({ failure: current[j]?.failure ?? request.failure_rate, repair: current[j]?.repair ?? request.repair_rate, ...(i === j ? { [k]: Number(e.target.value) } : {}) }))); setResult(undefined) }} /></td>)}</tr>)}</tbody></table><p className="text-xs text-slate-500">Lower unit number has preemptive repair priority. For nonpreemptive FIFO and general service distributions, use the diagram’s repairable simulation.</p></div>}</>}
      {request.mode === 'standby' && <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{number('dormant_rate', `Unit dormant failure rate (1/${units})`)}{number('coverage', 'Switch success probability', 0, 1)}{number('switch_repair_rate', `Switch restoration rate (1/${units})`)}<label className="text-xs">Switch dependence<select aria-label="Switch dependence" value={request.switching} onChange={e => patch({ switching: e.target.value as RedundancyRequest['switching'] })} className="mt-1 block w-full rounded border p-2"><option value="independent">Independent per transfer</option><option value="common">Common initial readiness</option></select></label></div>}
      {result && <div className="space-y-3 rounded border bg-slate-50 p-4"><p className="font-medium">{result.states.length} states · {result.transitions.length} transitions</p>{previewSignature !== live.current && <p role="status">Inputs or adopted sources changed. Preview again before loading.</p>}<details open><summary className="cursor-pointer text-sm">Model assumptions</summary><ul className="list-disc pl-5 text-sm">{result.assumptions.map(a => <li key={a}>{a}</li>)}</ul></details>{result.no_repair_reference && <p className="text-sm">No-repair reference at {missionTime} {units}: R={fmtNum(result.no_repair_reference.reliability)}, MTTF={fmtNum(result.no_repair_reference.mttf)}. {result.no_repair_reference.basis}</p>}<p className="text-xs">Full first-passage and stationary metrics are calculated with the existing Analyze action after loading this model.</p></div>}
    </div><footer className="flex gap-3 border-t p-4"><button disabled={busy} onClick={() => void build()} className="rounded bg-blue-700 px-4 py-2 text-sm text-white disabled:opacity-40">{busy ? 'Building…' : 'Preview model'}</button><button disabled={!result || previewSignature !== live.current} onClick={() => result && previewSignature === live.current && onApply(result)} className="rounded border border-blue-400 px-4 py-2 text-sm disabled:opacity-40">Load model into canvas</button></footer>
  </div>
}
