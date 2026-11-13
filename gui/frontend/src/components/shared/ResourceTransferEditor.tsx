import { useId, useState } from 'react'
import type { RelationEndpoint, ResourceTransfer, SystemDefinitionModel, SystemInterface, SystemResource } from '../../api/systemDefinition'
import { compatibleTransferPairs, effectiveSystemFunctions, structuredFunctionStatement, syncGeneratedDescriptions, systemTransferOptions,
  transferEndpointKey, type TransferOption } from '../../store/systemArchitecture'
import { disconnectResourceTransfer, reconcileFunctionResources } from '../../store/functionResourceFlows'

const field = 'mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500'
const button = 'rounded border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 hover:border-blue-400 disabled:opacity-50'
const interfaceTypes: SystemInterface['interface_type'][] = ['physical', 'energy', 'information', 'material', 'human_machine', 'clearance']
const categoryLabel = (value: string) => value.replace(/_/g, ' ').replace(/^./, character => character.toUpperCase())
type InterfaceProperties = Pick<SystemInterface, 'interface_type'|'directionality'>
export interface RelationOption { endpoint: RelationEndpoint; label: string }

export default function ResourceTransferEditor({ resources, sourceOptions, targetOptions, transfers, interfaceType, directionality,
  modeIds = [], onChange, onCreateComplement, onInterfaceChange, resourceChoice: selectedResource, onResourceChoice,
  sourceRelations = [], targetRelations = [], terminalSides = ['source', 'target'], disabled = false }: {
  resources: SystemResource[]; sourceOptions: TransferOption[]; targetOptions: TransferOption[]; transfers: ResourceTransfer[]
  interfaceType: SystemInterface['interface_type']; directionality: SystemInterface['directionality']; modeIds?: string[]
  onChange: (transfers: ResourceTransfer[]) => void; onInterfaceChange?: (properties: InterfaceProperties) => void
  resourceChoice?: string; onResourceChoice?: (resourceId: string) => void
  sourceRelations?: RelationOption[]; targetRelations?: RelationOption[]; terminalSides?: ('source'|'target')[]
  onCreateComplement?: (side: 'source'|'target', resourceId: string, reverse: boolean) => void; disabled?: boolean
}) {
  const id = useId()
  const [localResource, chooseLocalResource] = useState(''), [sourceChoice, chooseSource] = useState(''), [targetChoice, chooseTarget] = useState('')
  const [reverse, setReverse] = useState(false)
  const [physicalKind, setPhysicalKind] = useState<'flow'|'relation'>(transfers[0]?.kind ?? 'relation')
  const relation = interfaceType === 'clearance' || interfaceType === 'physical' && physicalKind === 'relation'
  const chooseResource = (value: string) => { chooseLocalResource(value); onResourceChoice?.(value); chooseSource(''); chooseTarget('') }
  const pairs = compatibleTransferPairs(sourceOptions, targetOptions, interfaceType, resources, reverse)
  const availableResources = resources.filter(resource => resource.category === interfaceType)
  const choice = selectedResource ?? localResource
  const resourceId = resources.some(item => item.id === choice) ? choice : pairs.length === 1 ? pairs[0].resource.id : availableResources.length === 1 ? availableResources[0].id : ''
  const resource = resources.find(item => item.id === resourceId)
  const options = (items: TransferOption[], side: 'source'|'target') => items.filter(item => item.category === interfaceType
    && (!item.resourceId || item.resourceId === resourceId) && (item.direction === 'bidirectional' || item.direction === ((side === 'source') !== reverse ? 'output' : 'input')))
  const sources = options(sourceOptions, 'source'), targets = options(targetOptions, 'target')
  const choices = relation ? [sourceRelations, targetRelations] : [sources, targets]
  const sourceKey = choices[0].some(option => transferEndpointKey(option.endpoint) === sourceChoice) ? sourceChoice : choices[0].length === 1 ? transferEndpointKey(choices[0][0].endpoint) : ''
  const targetKey = choices[1].some(option => transferEndpointKey(option.endpoint) === targetChoice) ? targetChoice : choices[1].length === 1 ? transferEndpointKey(choices[1][0].endpoint) : ''
  const source = choices[0].find(item => transferEndpointKey(item.endpoint) === sourceKey), target = choices[1].find(item => transferEndpointKey(item.endpoint) === targetKey)
  const compatible = relation ? Boolean(source && target) : pairs.some(pair => pair.resource.id === resourceId
    && transferEndpointKey(pair.source.endpoint) === sourceKey && transferEndpointKey(pair.target.endpoint) === targetKey)
  const existing = transfers.some(transfer => transfer.kind === (relation ? 'relation' : 'flow') && (transfer.kind === 'relation' || transfer.resource_id === resourceId)
    && transferEndpointKey(transfer.source) === (reverse ? targetKey : sourceKey) && transferEndpointKey(transfer.target) === (reverse ? sourceKey : targetKey))
  const label = (endpoint: ResourceTransfer['source']) => [...sourceOptions, ...targetOptions, ...sourceRelations, ...targetRelations]
    .find(option => transferEndpointKey(option.endpoint) === transferEndpointKey(endpoint))?.label || 'Unavailable endpoint'
  const changeType = (type: SystemInterface['interface_type']) => {
    if (transfers.length || !onInterfaceChange) return
    chooseSource(''); chooseTarget(''); setReverse(false)
    onInterfaceChange({ interface_type: type, directionality: type === 'clearance' || type === 'physical' ? 'undirected' : 'directed' })
  }
  return <fieldset disabled={disabled} className="space-y-3 rounded-lg border border-blue-200 bg-blue-50/30 p-3">
    <legend className="px-1 text-xs font-semibold text-slate-700">Interface connections</legend>
    {onInterfaceChange && <div className="grid grid-cols-2 gap-2">
      <label className="text-xs text-slate-600">Interface type<select aria-label="Interface type" className={field} value={interfaceType}
        disabled={Boolean(transfers.length)} onChange={event => changeType(event.target.value as SystemInterface['interface_type'])}>
        {interfaceTypes.map(type => <option key={type} value={type}>{categoryLabel(type)}</option>)}</select></label>
      <label className="text-xs text-slate-600">Interface direction<select className={field} value={directionality} disabled={Boolean(transfers.length)}
        onChange={event => onInterfaceChange({ interface_type: interfaceType, directionality: event.target.value as SystemInterface['directionality'] })}>
        {['directed', 'bidirectional', 'undirected'].map(value => <option key={value} value={value}>{categoryLabel(value)}</option>)}</select></label>
    </div>}
    {interfaceType === 'physical' && <label className="block text-xs text-slate-600">Connection kind<select className={field} value={physicalKind}
      onChange={event => { setPhysicalKind(event.target.value as 'flow'|'relation'); chooseSource(''); chooseTarget(''); setReverse(false) }}>
      <option value="relation">Physical relation (attachment, support)</option><option value="flow">Resource flow (force, torque)</option></select></label>}
    {transfers.map(transfer => <div key={transfer.id} className="space-y-1 rounded border bg-white p-2 text-xs">
      <div className="flex items-center justify-between gap-2"><strong>{transfer.kind === 'relation' ? 'Physical relation' : resources.find(item => item.id === transfer.resource_id)?.name || 'Unavailable resource'}</strong>
        <button type="button" className={button} onClick={() => onChange(transfers.filter(item => item.id !== transfer.id))}>Remove connection</button></div>
      <p>{label(transfer.source)} {transfer.kind === 'relation' ? '↔' : '→'} {label(transfer.target)}</p>
    </div>)}
    {relation ? <p className="text-xs text-slate-600">Physical connection — no resource required.</p> : <>
      {directionality === 'bidirectional' && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={reverse}
        onChange={event => { setReverse(event.target.checked); chooseSource(''); chooseTarget('') }} />Define the reverse transfer</label>}
      <label htmlFor={`${id}-resource`} className="block text-xs text-slate-600">Resource<select id={`${id}-resource`} value={resourceId} className={field} onChange={event => chooseResource(event.target.value)}>
        <option value="">Choose a resource</option>{resources.filter(item => item.category !== 'state').map(item => <option key={item.id} value={item.id}>{item.name} · {categoryLabel(item.category)}</option>)}
      </select></label>
      {resource && resource.category !== interfaceType && <div role="status" className="space-y-2 text-xs text-amber-950">
        <p>{resource.name} is {categoryLabel(resource.category).toLowerCase()}. Match the interface type to connect it.</p>
        {onInterfaceChange && !transfers.length && resource.category !== 'state' && <button type="button" className={button} onClick={() => changeType(resource.category as SystemInterface['interface_type'])}>Use {categoryLabel(resource.category)} interface</button>}
      </div>}
    </>}
    {(['source', 'target'] as const).map((side, index) => <div key={side}><label className="block text-xs text-slate-600">
      {side === 'source' ? 'Source' : 'Target'} {relation ? 'block or condition' : 'function or terminal'}
      <select className={field} value={index === 0 ? sourceKey : targetKey} onChange={event => (index === 0 ? chooseSource : chooseTarget)(event.target.value)}>
        <option value="">Choose an endpoint</option>{choices[index].map(option => <option key={transferEndpointKey(option.endpoint)} value={transferEndpointKey(option.endpoint)}>{option.label}</option>)}</select></label>
      {!relation && onCreateComplement && terminalSides.includes(side) && ((side === 'source') === reverse) && resource?.category === interfaceType && !choices[index].length && <button type="button" className={`mt-1 ${button}`}
        onClick={() => onCreateComplement(side, resourceId, reverse)}>Define missing {side} terminal</button>}
    </div>)}
    <button type="button" className={button} disabled={!source || !target || !compatible || existing} onClick={() => {
      if (!source || !target) return
      const common = { id: `transfer-${crypto.randomUUID()}`, mode_ids: [...modeIds] }
      const transfer: ResourceTransfer = relation ? { ...common, kind: 'relation', source: source.endpoint as RelationEndpoint, target: target.endpoint as RelationEndpoint }
        : { ...common, kind: 'flow', resource_id: resourceId, source: (reverse ? target : source).endpoint as TransferOption['endpoint'], target: (reverse ? source : target).endpoint as TransferOption['endpoint'] }
      onChange([...transfers, transfer]); chooseResource(''); chooseSource(''); chooseTarget('')
    }}>{existing ? 'Connection already defined' : relation ? 'Connect physical relation' : 'Confirm resource pairing'}</button>
  </fieldset>
}

export function SystemInterfaceTransferEditor({ model, interfaceId, onChange, disabled = false }: {
  model: SystemDefinitionModel; interfaceId: string; onChange: (model: SystemDefinitionModel) => void; disabled?: boolean
}) {
  const edge = model.interfaces.find(item => item.id === interfaceId)
  if (!edge) return null
  return <SystemInterfaceTransferFields key={`${model.id}:${edge.id}`} model={model} edge={edge} onChange={onChange} disabled={disabled} />
}

function SystemInterfaceTransferFields({ model, edge, onChange, disabled }: {
  model: SystemDefinitionModel; edge: SystemInterface; onChange: (model: SystemDefinitionModel) => void; disabled: boolean
}) {
  const [externalName, setExternalName] = useState('')
  const commit = (next: SystemDefinitionModel) => onChange(syncGeneratedDescriptions(reconcileFunctionResources(next).model))
  const relations = (endpoint: SystemInterface['source']): RelationOption[] => endpoint.instance_id ? [
    { endpoint: { kind: 'block', instance_id: endpoint.instance_id }, label: model.instances.find(item => item.id === endpoint.instance_id)?.name || 'Block' },
    ...effectiveSystemFunctions(model, endpoint.instance_id).filter(fn => fn.definition?.role === 'maintain_state').map(fn => ({ endpoint: { kind: 'block' as const, instance_id: endpoint.instance_id!, function_id: fn.id }, label: structuredFunctionStatement(fn.definition, model.resources) })),
  ] : [{ endpoint: { kind: 'external', external_id: endpoint.external_id! }, label: model.externals.find(item => item.id === endpoint.external_id)?.name || 'External actor' }]
  const changeInterface = (properties: InterfaceProperties) => {
    if (edge.transfers?.length) return
    const clearPort = (endpoint: SystemInterface['source']) => { const { port_id: _port, ...rest } = endpoint; return rest }
    commit({ ...model, interfaces: model.interfaces.map(item => item.id === edge.id ? { ...item, ...properties,
      source: clearPort(item.source), target: clearPort(item.target), linkage: properties.interface_type === 'clearance' ? 'indirect' : 'direct' } : item) })
  }
  const createTerminal = (side: 'source'|'target', resourceId: string, reverse: boolean) => {
    const endpoint = edge[side], resource = model.resources.find(item => item.id === resourceId)
    if (!endpoint.external_id || !resource || resource.category === 'state') return
    const output = (side === 'source') !== reverse
    // An existing resource already has a producer; only sink terminals can be added here.
    if (output) return
    const port = { id: `terminal-${crypto.randomUUID()}`, name: resource.name, interface_type: resource.category,
      direction: 'input' as const, description: '' }
    commit({ ...model, externals: model.externals.map(actor => actor.id === endpoint.external_id ? { ...actor, ports: [...actor.ports ?? [], port] } : actor) })
  }
  return <div className="space-y-2"><ResourceTransferEditor key={`${edge.interface_type}:${edge.directionality}`}
    resources={model.resources} sourceOptions={systemTransferOptions(model, edge.source)} targetOptions={systemTransferOptions(model, edge.target)}
    sourceRelations={relations(edge.source)} targetRelations={relations(edge.target)}
    transfers={edge.transfers ?? []} interfaceType={edge.interface_type} directionality={edge.directionality} modeIds={edge.mode_ids}
    terminalSides={(['source', 'target'] as const).filter(side => Boolean(edge[side].external_id))}
    disabled={disabled} onInterfaceChange={changeInterface} onCreateComplement={edge.source.external_id || edge.target.external_id ? createTerminal : undefined}
    onChange={transfers => {
      let next = model
      for (const prior of edge.transfers ?? []) if (!transfers.some(item => item.id === prior.id)) next = disconnectResourceTransfer(next, edge.id, prior.id)
      commit({ ...next, interfaces: next.interfaces.map(item => item.id === edge.id ? { ...item, transfers } : item) })
    }} />
    {edge.source.external_id && <details className="text-xs text-slate-600"><summary className="cursor-pointer">Define an external source</summary>
      <div className="mt-2 flex items-end gap-2"><label className="flex-1">Output resource<input value={externalName} onChange={event => setExternalName(event.target.value)} className={field} /></label>
        <button type="button" disabled={disabled || !externalName.trim()} className={button} onClick={() => {
          const resource: SystemResource = { id: `resource-${crypto.randomUUID()}`, name: externalName.trim(), category: edge.interface_type }
          commit({ ...model, resources: [...model.resources, resource], externals: model.externals.map(actor => actor.id === edge.source.external_id
            ? { ...actor, ports: [...actor.ports ?? [], { id: `terminal-${crypto.randomUUID()}`, name: resource.name, interface_type: edge.interface_type,
              direction: 'output', description: '', resource_id: resource.id }] } : actor) }); setExternalName('')
        }}>Add external output</button></div>
    </details>}
  </div>
}
