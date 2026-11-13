import { useMemo, useState } from 'react'
import { Link2 } from 'lucide-react'
import type { AIAGVDAFMEAAnalysis, FMEAStructureNode } from '../../api/reliabilityProgram'
import type { CanonicalSystemRef, SystemDefinitionModel } from '../../api/systemDefinition'
import { bindFmeaAnalysis, canonicalFmeaBinding, canonicalInstanceId, inspectFmeaBinding, splitFmeaUpdate } from '../../store/sharedFmeaModel'
import { useSharedSystemDefinition } from '../../store/sharedSystem'
import { useUiPreference } from '../../store/uiPreferences'
import { createFmeaAnalysis } from './fmeaModel'
import SharedFmeaDiagram from './SharedFmeaDiagram'
import { installedPath } from './fmeaDiagramProjection'

export default function FmeaSystemBindingControl({ analysis, model, update }: {
  analysis: AIAGVDAFMEAAnalysis
  model: SystemDefinitionModel
  update: (patch: Partial<AIAGVDAFMEAAnalysis>) => void
}) {
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [equipmentFocus, setEquipmentFocus] = useUiPreference<string>(`fmea.equipment:${model.id}:${analysis.id}`, '__closed__')
  const [, setSystem] = useSharedSystemDefinition()
  const equipmentDiagram = useMemo(() => analysis.kind === 'pfmea' && equipmentFocus !== '__closed__'
    ? bindFmeaAnalysis(model, { ...createFmeaAnalysis('dfmea', 1), id: `${analysis.id}-equipment`,
        name: `${analysis.name} — Equipment interfaces` }) : undefined, [analysis.id, analysis.name, analysis.kind, equipmentFocus, model])
  const binding = canonicalFmeaBinding(model, analysis)
  const issues = inspectFmeaBinding(model, analysis)
  const unavailableIds = new Set(issues.filter(issue => issue.code === 'unavailable_reference').map(issue => issue.recordId))
  const instancesById = useMemo(() => new Map(model.instances.map(item => [item.id, item])), [model])
  const definitionsById = useMemo(() => new Map(model.definitions.map(item => [item.id, item])), [model])
  const interfaceIds = useMemo(() => new Set(model.interfaces.map(item => item.id)), [model])
  const missingSource = (ref: CanonicalSystemRef | undefined) => {
    if (!ref) return false
    if (ref.system_model_id !== model.id) return true
    const instance = instancesById.get(ref.instance_id ?? '')
    const definition = definitionsById.get(instance?.definition_id ?? '')
    return Boolean((ref.instance_id && !instance)
      || (ref.function_id && !definition?.functions.some(item => item.id === ref.function_id))
      || (ref.failure_mode_id && !definition?.failure_modes.some(item => item.id === ref.failure_mode_id))
      || (ref.interface_id && !interfaceIds.has(ref.interface_id)))
  }
  const missingFunctions = analysis.functions.filter(item => unavailableIds.has(item.id) || missingSource(item.system_definition_ref))
  const missingFailures = analysis.failure_chains.filter(item => unavailableIds.has(item.id) || missingSource(item.system_definition_ref))
  const missingInterfaces = analysis.interfaces.filter(item => unavailableIds.has(item.id) || missingSource(item.system_definition_ref))
  const needsRepair = missingFunctions.length + missingFailures.length + missingInterfaces.length > 0
  const repairScope = model.instances.some(item => item.id === binding?.scope_instance_id)
    ? binding!.scope_instance_id : model.root_instance_id
  const repairMode = model.modes.some(mode => mode.id === binding?.mode_id) ? binding?.mode_id : undefined
  const availableSources = useMemo(() => needsRepair ? bindFmeaAnalysis(model, {
    ...createFmeaAnalysis('dfmea', 1), system_binding: { version: 1, system_model_id: model.id,
      scope_instance_id: repairScope ?? '', mode_id: repairMode },
  }, repairScope) : createFmeaAnalysis('dfmea', 1), [model, needsRepair, repairScope, repairMode])
  const instanceIds = new Set(model.instances.map(item => item.id))
  const unresolved = analysis.structure_nodes.filter(node => {
    const id = node.source_ref?.module === 'system_definition' ? node.source_ref.entity_id
      : node.system_definition_ref?.instance_id
    const modelId = node.system_definition_ref?.system_model_id
      ?? (node.source_ref?.module === 'system_definition' ? node.source_ref.analysis_id : undefined)
    return !id || !instanceIds.has(id) || Boolean(modelId && modelId !== model.id)
  })
  const path = (id: string) => installedPath(model, id)
  const linkedNode = (node: FMEAStructureNode, instanceId: string): FMEAStructureNode => {
    const instance = model.instances.find(item => item.id === instanceId)!
    const definition = model.definitions.find(item => item.id === instance.definition_id)
    return { ...node, source_ref: {
      module: 'system_definition', analysis_id: model.id, analysis_name: model.name,
      entity_id: instance.id, entity_type: definition?.kind === 'piece_part' ? 'part'
        : instance.parent_instance_id ? 'block' : 'system',
      parent_entity_id: instance.parent_instance_id, imported_at: new Date().toISOString(),
      source_checksum: '', source_name: instance.name || definition?.name || instance.id,
      reference_designators: instance.reference_designators,
    }, system_definition_ref: { system_model_id: model.id, instance_id: instance.id, definition_id: instance.definition_id } }
  }
  if (analysis.kind === 'pfmea') return <details open={equipmentFocus !== '__closed__' || undefined} className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs">
    <summary className="cursor-pointer font-medium text-slate-700">Process equipment links</summary>
    <p className="my-2 text-slate-500">Link process equipment to a system item.</p>
    <div className="grid gap-2 sm:grid-cols-2">{analysis.structure_nodes.map(node => <label key={node.id} className="text-slate-600">
      {node.name || node.id}
      <select aria-label={`System item for ${node.name || node.id}`} className="ml-2 max-w-full rounded border bg-white p-1"
        value={canonicalInstanceId(node, model.id) ?? ''} onChange={event => update({ structure_nodes:
          analysis.structure_nodes.map(item => item.id === node.id ? { ...item,
            source_ref: item.source_ref?.module === 'system_definition' ? undefined : item.source_ref,
            system_definition_ref: event.target.value ? { system_model_id: model.id, instance_id: event.target.value } : undefined,
          } : item) })}>
        <option value="">No equipment link</option>
        {model.instances.map(instance => <option key={instance.id} value={instance.id}>{path(instance.id)}</option>)}
      </select>
      <button type="button" disabled={!canonicalInstanceId(node, model.id)}
        aria-label={`View linked interfaces for ${node.name || node.id}`}
        onClick={() => setEquipmentFocus(canonicalInstanceId(node, model.id) ?? '')}
        className="ml-2 rounded border bg-white px-2 py-1 text-blue-700 disabled:opacity-40">View linked interfaces</button>
    </label>)}</div>
    {equipmentDiagram && <div className="mt-3 h-[680px] rounded border bg-white p-2">
      <div className="mb-2 flex items-center justify-between"><span className="font-medium">Project equipment interfaces</span>
        <button type="button" onClick={() => setEquipmentFocus('__closed__')} className="rounded border px-2 py-1">Close equipment view</button></div>
      <div className="h-[calc(100%-2.5rem)]"><SharedFmeaDiagram analysis={equipmentDiagram} model={model}
        viewSection="equipment" bookmarkAnalysisId={analysis.id}
        focusInstanceId={equipmentFocus} onFocusInstanceId={setEquipmentFocus} fillHeight
        scopeInstanceId={model.root_instance_id} update={patch => setSystem(previous => {
          const split = splitFmeaUpdate(previous.model, equipmentDiagram, { ...equipmentDiagram, ...patch })
          return { ...previous, model: split.model }
        })} /></div>
    </div>}
  </details>
  return <div className="border-b border-violet-200 bg-violet-50/50 px-4 py-2 text-xs">
    <div className="flex flex-wrap items-center gap-2">
      <Link2 size={13} className="text-violet-700" />
      <span className="font-medium text-violet-900">{binding ? 'Project System Model' : 'Link this FMEA to the project System Model'}</span>
      {binding ? <label className="ml-auto text-slate-600">Study scope
        <select aria-label="FMEA study scope" value={binding.scope_instance_id}
          onChange={event => update({ system_binding: { ...binding, system_model_id: model.id, scope_instance_id: event.target.value } })}
          className="ml-2 max-w-80 rounded border border-violet-200 bg-white px-2 py-1">
          {model.instances.map(instance => <option key={instance.id} value={instance.id}>{path(instance.id)}</option>)}
        </select>
      </label> : <button type="button" className="rounded border border-violet-300 bg-white px-2 py-1 text-violet-800"
        onClick={() => update(bindFmeaAnalysis(model, analysis))}>Use project System Model</button>}
      {binding && model.modes.length > 0 && <label className="text-slate-600">Operating mode
        <select aria-label="FMEA system operating mode" value={binding.mode_id ?? ''}
          onChange={event => update({ system_binding: { ...binding, mode_id: event.target.value || undefined } })}
          className="ml-2 rounded border border-violet-200 bg-white px-2 py-1">
          <option value="">All modes</option>
          {model.modes.map(mode => <option key={mode.id} value={mode.id}>{mode.name}</option>)}
        </select>
      </label>}
    </div>
    {binding && <p className="mt-1 text-[11px] text-slate-600">System edits apply project-wide; ratings, controls, and actions stay in this FMEA.</p>}
    {binding && <details className="mt-2"><summary className="cursor-pointer text-slate-700">Piece-part study coverage</summary>
      <p className="my-1 text-slate-600">Include additional piece parts. Interface endpoints are always included.</p>
      {model.instances.filter(instance => definitionsById.get(instance.definition_id)?.kind === 'piece_part').map(instance => <label key={instance.id} className="mr-4 inline-flex items-center gap-1">
        <input type="checkbox" checked={binding.included_piece_part_ids?.includes(instance.id) ?? false} onChange={event => update({ system_binding: { ...binding,
          included_piece_part_ids: event.target.checked ? [...binding.included_piece_part_ids ?? [], instance.id] : binding.included_piece_part_ids?.filter(id => id !== instance.id),
        } })} />{path(instance.id)}</label>)}
    </details>}
    {(issues.length > 0 || unresolved.length > 0) && <details className="mt-2 rounded border border-amber-200 bg-amber-50 p-2">
      <summary className="cursor-pointer font-medium text-amber-900">Review system links{unresolved.length > 0 ? ` · ${unresolved.length} unmapped item(s)` : ''}</summary>
      <p className="my-2 text-slate-600">Choose or create a system item for each unmapped record.</p>
      {issues.length > 0 && <ul className="mb-2 list-inside list-disc text-amber-900">{issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul>}
      <div className="space-y-2">{unresolved.map(node => <label key={node.id} className="flex flex-wrap items-center justify-between gap-2 text-slate-700">
        <span>{node.name || 'Unnamed item'} <span className="font-mono text-[10px] text-slate-400">{node.id}</span></span>
        <select aria-label={`Map ${node.name || node.id}`} value={mapping[node.id] ?? ''}
          onChange={event => setMapping(previous => ({ ...previous, [node.id]: event.target.value }))}
          className="max-w-full rounded border bg-white p-1">
          <option value="">Choose an installed item…</option>
          <option value="__create__">Create in project System Model</option>
          {model.instances.map(instance => <option key={instance.id} value={instance.id}>{path(instance.id)}</option>)}
        </select>
      </label>)}</div>
      {(missingFunctions.length > 0 || missingFailures.length > 0 || missingInterfaces.length > 0) && <div className="mt-3 space-y-2 border-t border-amber-200 pt-2">
        <p className="font-medium text-amber-900">Repair missing source links</p>
        <p className="text-[11px] text-slate-600">Choose a replacement source. Existing ratings and actions are preserved.</p>
        {missingFunctions.map(item => <label key={item.id} className="flex flex-wrap items-center justify-between gap-2">
          <span>Function · {item.description || item.id}</span>
          <select aria-label={`Replacement function for ${item.id}`} value="" className="max-w-full rounded border bg-white p-1"
            onChange={event => {
              const replacement = availableSources.functions.find(candidate => candidate.id === event.target.value)
              if (replacement) update({ functions: analysis.functions.map(fn => fn.id === item.id
                ? { ...fn, system_definition_ref: replacement.system_definition_ref } : fn) })
            }}><option value="">Choose a replacement function…</option>
            {availableSources.functions.map(candidate => <option key={candidate.id} value={candidate.id}>
              {path(candidate.system_definition_ref?.instance_id ?? '')} · {candidate.description}</option>)}
          </select>
        </label>)}
        {missingFailures.map(item => <label key={item.id} className="flex flex-wrap items-center justify-between gap-2">
          <span>Failure mode · {item.failure_mode || item.id}</span>
          <select aria-label={`Replacement failure mode for ${item.id}`} value="" className="max-w-full rounded border bg-white p-1"
            onChange={event => {
              const replacement = availableSources.failure_chains.find(candidate => candidate.id === event.target.value)
              if (replacement) update({ failure_chains: analysis.failure_chains.map(chain => chain.id === item.id
                ? { ...chain, system_definition_ref: replacement.system_definition_ref } : chain) })
            }}><option value="">Choose a replacement failure mode…</option>
            {availableSources.failure_chains.map(candidate => <option key={candidate.id} value={candidate.id}>
              {path(candidate.system_definition_ref?.instance_id ?? '')} · {candidate.failure_mode}</option>)}
          </select>
        </label>)}
        {missingInterfaces.map(item => <label key={item.id} className="flex flex-wrap items-center justify-between gap-2">
          <span>Interface · {item.name || item.id}</span>
          <select aria-label={`Replacement interface for ${item.id}`} value="" className="max-w-full rounded border bg-white p-1"
            onChange={event => {
              const replacement = availableSources.interfaces.find(candidate => candidate.id === event.target.value)
              if (replacement) update({ interfaces: analysis.interfaces.map(edge => edge.id === item.id
                ? { ...edge, system_definition_ref: replacement.system_definition_ref } : edge) })
            }}><option value="">Choose a replacement interface…</option>
            {availableSources.interfaces.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name || candidate.id}</option>)}
          </select>
        </label>)}
      </div>}
      <button type="button" disabled={!unresolved.some(node => mapping[node.id])}
        onClick={() => {
          const structure_nodes = analysis.structure_nodes.map(node => {
            const choice = mapping[node.id]
            return choice === '__create__' ? { ...node, source_ref: undefined, system_definition_ref: undefined, element_type: 'canonical_new' }
              : choice && instanceIds.has(choice) ? linkedNode(node, choice) : node
          })
          update({ ...analysis, system_binding: { ...binding, version: 1, system_model_id: model.id,
            scope_instance_id: repairScope ?? model.instances[0]?.id ?? '' }, structure_nodes })
          setMapping({})
        }} className="mt-3 rounded bg-violet-700 px-3 py-1.5 font-medium text-white disabled:opacity-40">Apply reviewed mappings</button>
    </details>}
  </div>
}
