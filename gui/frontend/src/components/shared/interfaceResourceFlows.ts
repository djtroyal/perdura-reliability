import type { ResourceTransferEndpoint, SystemDefinitionModel, SystemEndpoint, SystemFunction, SystemInterface } from '../../api/systemDefinition'
import { effectiveSystemFunctions } from '../../store/systemArchitecture'

export interface DiagramResourceFlow { source: string; target: string; resourceId: string }

const applies = (ids: readonly string[] | undefined, mode: string) => !mode || !ids?.length || ids.includes(mode)
const functionKey = (instanceId: string, functionId: string) => JSON.stringify([instanceId, functionId])
const modelIndexes = new WeakMap<SystemDefinitionModel, ReturnType<typeof indexModel>>()
function indexModel(model: SystemDefinitionModel) {
  const instances = new Map(model.instances.map(item => [item.id, item]))
  const definitions = new Map(model.definitions.map(item => [item.id, item]))
  const resources = new Map(model.resources.map(item => [item.id, item]))
  const externals = new Map(model.externals.map(item => [item.id, item]))
  const functions = new Map<string, SystemFunction>()
  for (const instance of model.instances) for (const fn of effectiveSystemFunctions(model, instance.id))
    functions.set(functionKey(instance.id, fn.id), fn)
  return { instances, definitions, resources, externals, functions }
}

/** Resolve authored resource direction before endpoints are collapsed into containers. */
export function interfaceResourceFlowProjector(model: SystemDefinitionModel, modeId?: string) {
  let index = modelIndexes.get(model)
  if (!index) { index = indexModel(model); modelIndexes.set(model, index) }
  const { instances, definitions, resources, externals, functions } = index
  const modes = modeId ? (model.modes.some(mode => mode.id === modeId) || !model.modes.length ? [modeId] : [])
    : model.modes.length ? model.modes.map(mode => mode.id) : ['']
  const belongs = (end: ResourceTransferEndpoint, endpoint: SystemEndpoint) => end.kind === 'function'
    ? end.instance_id === endpoint.instance_id
    : end.external_id === endpoint.external_id && (!endpoint.port_id || endpoint.port_id === end.port_id)
  const validTerminal = (end: ResourceTransferEndpoint, endpoint: SystemEndpoint, resourceId: string,
    direction: 'input' | 'output', mode: string) => {
    const resource = resources.get(resourceId)
    if (!resource) return false
    if (end.kind === 'external') {
      const port = externals.get(end.external_id)?.ports?.find(item => item.id === end.port_id)
      return Boolean(port && port.resource_id === resourceId && port.interface_type === resource.category
        && (port.direction === direction || port.direction === 'bidirectional'))
    }
    const instance = instances.get(end.instance_id), fn = functions.get(functionKey(end.instance_id, end.function_id))
    if (!instance || !fn || !applies(instance.mode_ids, mode) || !applies(fn.mode_ids, mode)) return false
    const io = fn.definition?.io.find(item => item.id === end.io_id)
    if (!io || io.resource_id !== resourceId || io.direction !== direction) return false
    if (io.port_id && endpoint.port_id && io.port_id !== endpoint.port_id) return false
    const ports = definitions.get(instance.definition_id)?.ports ?? []
    return [io.port_id, endpoint.port_id].every(id => !id || ports.some(port => port.id === id
      && port.interface_type === resource.category && (port.direction === direction || port.direction === 'bidirectional')))
  }
  return (item: SystemInterface, endpoints: { source: string; target: string }): DiagramResourceFlow[] => {
    if (!endpoints.source || !endpoints.target || endpoints.source === endpoints.target) return []
    const flows: DiagramResourceFlow[] = [], seen = new Set<string>()
    for (const transfer of item.transfers ?? []) {
      if (transfer.kind !== 'flow' || resources.get(transfer.resource_id)?.category !== item.interface_type) continue
      const forward = belongs(transfer.source, item.source) && belongs(transfer.target, item.target)
      const reverse = item.directionality !== 'directed' && belongs(transfer.source, item.target) && belongs(transfer.target, item.source)
      if (!forward && !reverse) continue
      const source = forward ? item.source : item.target, target = forward ? item.target : item.source
      // All-mode views require one common operating mode, never a union of incompatible terminals.
      if (!modes.some(mode => applies(item.mode_ids, mode) && applies(transfer.mode_ids, mode)
        && validTerminal(transfer.source, source, transfer.resource_id, 'output', mode)
        && validTerminal(transfer.target, target, transfer.resource_id, 'input', mode))) continue
      const flow = { source: forward ? endpoints.source : endpoints.target,
        target: forward ? endpoints.target : endpoints.source, resourceId: transfer.resource_id }
      const key = JSON.stringify([flow.source, flow.target, flow.resourceId])
      if (!seen.has(key)) { seen.add(key); flows.push(flow) }
    }
    return flows
  }
}
