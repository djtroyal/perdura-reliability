import { effectiveSystemFunctions, structuredFunctionStatement } from '../../store/systemArchitecture'
import type { SystemDefinitionModel } from '../../api/systemDefinition'

/** Parent support is inferred when unambiguous; only the unresolved choice needs input. */
export default function ParentFunctionSupportEditor({ model, instanceId, functionId, onChange, disabled = false }: {
  model: SystemDefinitionModel; instanceId: string; functionId: string
  onChange: (model: SystemDefinitionModel) => void; disabled?: boolean
}) {
  const instance = model.instances.find(item => item.id === instanceId)
  const parent = model.instances.find(item => item.id === instance?.parent_instance_id)
  if (!parent) return null
  const fn = effectiveSystemFunctions(model, instanceId).find(item => item.id === functionId)
  const activeModes = model.modes.filter(mode => (!instance?.mode_ids.length || instance.mode_ids.includes(mode.id)) && (!fn?.mode_ids.length || fn.mode_ids.includes(mode.id)))
  const functions = effectiveSystemFunctions(model, parent.id).filter(candidate => candidate.definition?.action.trim() && activeModes.every(mode =>
    (!parent.mode_ids.length || parent.mode_ids.includes(mode.id)) && (!candidate.mode_ids.length || candidate.mode_ids.includes(mode.id))))
  const links = model.function_links.filter(link => link.relationship === 'decomposes_to' && link.target.instance_id === instanceId && link.target.function_id === functionId)
  const validLinks = links.filter(link => link.source.instance_id === parent.id && functions.some(fn => fn.id === link.source.function_id))
  const label = (id: string) => {
    const item = functions.find(fn => fn.id === id)
    return item ? structuredFunctionStatement(item.definition, model.resources) || item.description || 'Untitled function' : 'Unavailable parent function'
  }
  const select = (id: string) => onChange({ ...model, function_links: [
    ...model.function_links.filter(link => !links.some(item => item.id === link.id)),
    ...(id ? [{ id: validLinks.find(link => link.source.function_id === id)?.id ?? `support-${crypto.randomUUID()}`,
      source: { instance_id: parent.id, function_id: id }, target: { instance_id: instanceId, function_id: functionId },
      relationship: 'decomposes_to' as const, rationale: '', mode_ids: [] }] : []),
  ] })
  return <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
    {validLinks.length > 0 ? <p>Supports <span className="font-medium text-slate-800">{parent.name} › {validLinks.map(link => label(link.source.function_id)).join('; ')}</span></p>
      : functions.length === 1 && !links.length ? <div className="flex flex-wrap items-center justify-between gap-2">
          <p>Suggested parent function: <span className="font-medium text-slate-800">{parent.name} › {label(functions[0].id)}</span></p>
          <button type="button" disabled={disabled} onClick={() => select(functions[0].id)} className="rounded border border-slate-300 bg-white px-2 py-1 font-medium disabled:opacity-50">Use this function</button>
        </div>
        : !functions.length ? <p>Define a function on {parent.name} for this function to support.</p> : null}
    {(functions.length > 1 || links.length > validLinks.length) && <label className="mt-1 block">Supports…<select disabled={disabled} aria-label={`Supports a function on ${parent.name}`}
      value={validLinks.length === 1 ? validLinks[0].source.function_id : ''} onChange={event => select(event.target.value)}
      className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs">
      <option value="">Choose the parent function</option>{functions.map(fn => <option key={fn.id} value={fn.id}>{label(fn.id)}</option>)}
    </select></label>}
    {links.length > validLinks.length && <p role="status" className="mt-1 text-amber-800">Parent link is no longer valid. Choose a parent function.</p>}
  </div>
}
