import type { AIAGVDAFMEAAnalysis } from '../api/reliabilityProgram'
import type { ResourceTransferEndpoint, SystemDefinitionModel } from '../api/systemDefinition'
import { effectiveSystemFunctions, processArchitectureModel, systemResourceProducers, transferEndpointKey } from './systemArchitecture'
import { bindNewInstalledOutputs, reconcileFunctionResources } from './functionResourceFlows'

/** Distinguish explicit connection deletion from routing removed by a function edit. */
function transferEndpointContext(model: SystemDefinitionModel, endpoint: ResourceTransferEndpoint): string {
  if (endpoint.kind === 'external') {
    const actor = model.externals.find(item => item.id === endpoint.external_id)
    const port = actor?.ports?.find(item => item.id === endpoint.port_id)
    return JSON.stringify({ actorId: actor?.id, port, resource: model.resources.find(item => item.id === port?.resource_id) })
  }
  const instance = model.instances.find(item => item.id === endpoint.instance_id)
  const fn = effectiveSystemFunctions(model, endpoint.instance_id).find(item => item.id === endpoint.function_id)
  return JSON.stringify({ definitionId: instance?.definition_id, parentId: instance?.parent_instance_id,
    modeIds: instance?.mode_ids, fn, modes: model.modes.map(mode => mode.id),
    resources: (fn?.definition?.io ?? []).map(io => model.resources.find(item => item.id === io.resource_id)),
  })
}

/** Mutation boundary: deleting a connection clears its input instead of recreating it. */
export function populateSystemInterfaceFunctions(next: SystemDefinitionModel, previous?: SystemDefinitionModel): SystemDefinitionModel {
  const semantic = ({ diagrams: _diagrams, revision: _revision, ...value }: SystemDefinitionModel) => JSON.stringify(value)
  if (previous && semantic(next) === semantic(previous)) return next
  let model = previous ? bindNewInstalledOutputs(next, previous) : next
  for (const edge of previous?.interfaces ?? []) for (const transfer of edge.transfers ?? []) {
    if (transfer.kind !== 'flow' || transfer.target.kind !== 'function') continue
    if (next.interfaces.some(item => item.transfers?.some(value => value.kind === 'flow' && value.resource_id === transfer.resource_id
      && transferEndpointKey(value.source) === transferEndpointKey(transfer.source)
      && transferEndpointKey(value.target) === transferEndpointKey(transfer.target)))) continue
    const end = transfer.target
    const fn = effectiveSystemFunctions(model, end.instance_id).find(item => item.id === end.function_id)
    const instance = model.instances.find(item => item.id === end.instance_id)
    const producer = systemResourceProducers(model).find(owner => owner.resourceId === transfer.resource_id
      && transferEndpointKey(owner.endpoint) === transferEndpointKey(transfer.source))
    const usable = producer && fn && (!model.modes.length || producer.modeIds.some(mode =>
      (!instance?.mode_ids.length || instance.mode_ids.includes(mode)) && (!fn.mode_ids.length || fn.mode_ids.includes(mode))))
    // Retain an input invalidated by an upstream edit. A concurrent descriptive
    // edit must not prevent an explicit connection deletion from clearing it.
    if (!usable && previous && (transferEndpointContext(previous, transfer.source) !== transferEndpointContext(next, transfer.source)
      || transferEndpointContext(previous, transfer.target) !== transferEndpointContext(next, transfer.target))) continue
    // An intentional replacement input wins over the old connection being removed.
    if (fn?.definition?.io.find(io => io.id === end.io_id)?.resource_id !== transfer.resource_id) continue
    model = { ...model, instances: model.instances.map(instance => {
      if (instance.id !== end.instance_id) return instance
      const prior = instance.function_overrides.find(item => item.function_id === end.function_id)
      return { ...instance, function_overrides: [...instance.function_overrides.filter(item => item.function_id !== end.function_id),
        { ...(prior ?? { function_id: end.function_id, enabled: true }), resource_bindings: { ...prior?.resource_bindings, [end.io_id]: '' } }] }
    }) }
  }
  return reconcileFunctionResources(model).model
}

/** Persist the shared authoring contract without replacing PFMEA-specific records or geometry. */
export function applyProcessArchitecture(analysis: AIAGVDAFMEAAnalysis, model: SystemDefinitionModel): AIAGVDAFMEAAnalysis {
  const functions = model.instances.flatMap(instance => effectiveSystemFunctions(model, instance.id).map(fn => {
    const prior = analysis.functions.find(item => item.id === fn.id)
    return { ...prior, id: fn.id, structure_node_id: instance.id, description: fn.description,
      definition: fn.definition, canonical_verb_id: undefined, function_type: fn.function_type,
      operating_modes: fn.mode_ids, owner: prior?.owner ?? '', notes: prior?.notes ?? '' }
  }))
  const blockFor = (instanceId?: string) => analysis.block_diagram.nodes.find(node => node.structure_node_id === instanceId)?.id
  return { ...analysis, resources: model.resources, functions,
    function_links: model.function_links.map(link => ({ ...analysis.function_links.find(item => item.id === link.id),
      id: link.id, source_function_id: link.source.function_id, target_function_id: link.target.function_id,
      relationship: link.relationship, rationale: link.rationale, label: analysis.function_links.find(item => item.id === link.id)?.label ?? '', mode_ids: link.mode_ids, generated: link.generated })),
    interfaces: model.interfaces.map(edge => ({ ...analysis.interfaces.find(item => item.id === edge.id),
      id: edge.id, name: edge.name, interface_type: edge.interface_type, source_structure_node_id: edge.source.instance_id,
      target_structure_node_id: edge.target.instance_id, source_block_id: edge.source.external_id ?? blockFor(edge.source.instance_id),
      target_block_id: edge.target.external_id ?? blockFor(edge.target.instance_id), linkage: edge.linkage, directionality: edge.directionality,
      relationship_strength: edge.strength === 'unknown' ? 'unspecified' : edge.strength ?? 'unspecified',
      relationship_nature: analysis.interfaces.find(item => item.id === edge.id)?.relationship_nature ?? 'unspecified',
      interface_detail: edge.interface_detail, external_source: model.externals.find(item => item.id === edge.source.external_id)?.name ?? '',
      external_target: model.externals.find(item => item.id === edge.target.external_id)?.name ?? '', flow_description: edge.flow_description,
      operating_condition: edge.operating_condition, function_ids: [...new Set([...edge.source_function_ids, ...edge.target_function_ids])],
      requirement_ids: analysis.interfaces.find(item => item.id === edge.id)?.requirement_ids ?? [], transfers: edge.transfers, generated: edge.generated, mode_ids: edge.mode_ids })),
    block_diagram: { ...analysis.block_diagram, nodes: analysis.block_diagram.nodes.map(node => node.kind === 'external'
      ? { ...node, ports: model.externals.find(item => item.id === node.id)?.ports ?? node.ports } : node) },
  }
}

export function populateFmeaInterfaceFunctions(next: AIAGVDAFMEAAnalysis, previous?: AIAGVDAFMEAAnalysis): AIAGVDAFMEAAnalysis {
  if (next.kind !== 'pfmea') return next
  const architecture = processArchitectureModel(next)
  const updated = populateSystemInterfaceFunctions(architecture, previous ? processArchitectureModel(previous) : undefined)
  return updated === architecture ? next : applyProcessArchitecture(next, updated)
}
