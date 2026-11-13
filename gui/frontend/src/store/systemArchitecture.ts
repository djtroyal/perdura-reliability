import type { AIAGVDAFMEAAnalysis } from '../api/reliabilityProgram'
import type { ResourceTransfer, ResourceTransferEndpoint, RelationEndpoint, StructuredFunctionDefinition, SystemDefinitionModel,
  SystemEndpoint, SystemFunction, SystemInterface, SystemResource } from '../api/systemDefinition'

export interface ArchitectureFinding {
  step: 2|3; code: string; message: string; record_id?: string; field?: string; instance_id?: string
}
export interface ArchitectureScope { scopeInstanceId?: string; modeId?: string; includedPiecePartIds?: string[] }
export interface TransferOption {
  endpoint: ResourceTransferEndpoint; label: string; direction: 'input'|'output'|'bidirectional'
  resourceId?: string; category: SystemResource['category']
}
export const transferEndpointKey = (endpoint: ResourceTransferEndpoint|RelationEndpoint) => endpoint.kind === 'function'
  ? JSON.stringify([endpoint.kind, endpoint.instance_id, endpoint.function_id, endpoint.io_id])
  : endpoint.kind === 'block' ? JSON.stringify([endpoint.kind, endpoint.instance_id, endpoint.function_id])
  : JSON.stringify([endpoint.kind, endpoint.external_id, endpoint.port_id])
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const active = (modes: string[]|undefined, mode?: string) => !mode || !modes?.length || modes.includes(mode)
const key = (instanceId: string, functionId: string) => JSON.stringify([instanceId, functionId])
const stateVerbs = new Set(['maintain', 'secure', 'support', 'contain', 'isolate', 'protect'])

export function structuredFunctionStatement(definition: StructuredFunctionDefinition|undefined, resources: SystemResource[]): string {
  if (!definition) return ''
  const action = definition.action?.trim() ?? ''
  if (definition.role === 'maintain_state') {
    const verb = definition.state_verb || 'maintain'
    return action ? `${verb[0].toUpperCase()}${verb.slice(1)} ${action}` : ''
  }
  if (action) return action
  const output = definition.io.find(io => io.direction === 'output')
  const name = resources.find(item => item.id === output?.resource_id)?.name
  return name ? `${definition.role === 'source' ? 'Provide' : 'Produce'} ${name}` : ''
}

/** Narrow bindings change only resource identity; shared actions remain inherited. */
export function effectiveSystemFunctions(model: SystemDefinitionModel, instanceId: string, mode?: string): SystemFunction[] {
  const instance = model.instances.find(item => item.id === instanceId)
  if (!instance || !active(instance.mode_ids, mode)) return []
  const definition = model.definitions.find(item => item.id === instance.definition_id)
  return (definition?.functions ?? []).flatMap(fn => {
    const override = instance.function_overrides.find(item => item.function_id === fn.id)
    if ((override?.enabled ?? fn.default_enabled ?? true) === false) return []
    const fields = Object.fromEntries(Object.entries(override ?? {}).filter(([, value]) => value != null))
    let result = { ...fn, ...fields, id: fn.id }
    if (result.definition && override?.resource_bindings) result = { ...result, definition: { ...result.definition,
      io: result.definition.io.map(io => ({ ...io, resource_id: override.resource_bindings?.[io.id] ?? io.resource_id })) } }
    if (result.definition) result = { ...result, description: structuredFunctionStatement(result.definition, model.resources) }
    return active(result.mode_ids, mode) ? [result] : []
  })
}

export interface ResourceProducer {
  resourceId: string; endpoint: ResourceTransferEndpoint; modeIds: string[]
}
/** Outputs own resources globally. Names are deliberately not identities. */
export function systemResourceProducers(model: SystemDefinitionModel): ResourceProducer[] {
  const result: ResourceProducer[] = []
  for (const instance of model.instances) for (const fn of effectiveSystemFunctions(model, instance.id))
    for (const io of fn.definition?.io ?? []) if (io.direction === 'output' && io.resource_id) result.push({ resourceId: io.resource_id,
      endpoint: { kind: 'function', instance_id: instance.id, function_id: fn.id, io_id: io.id },
      modeIds: model.modes.filter(mode => active(instance.mode_ids, mode.id) && active(fn.mode_ids, mode.id)).map(mode => mode.id) })
  for (const actor of model.externals) for (const port of actor.ports ?? [])
    if (port.resource_id && port.direction !== 'input') result.push({ resourceId: port.resource_id,
      endpoint: { kind: 'external', external_id: actor.id, port_id: port.id }, modeIds: model.modes.map(mode => mode.id) })
  return result
}

export function systemTransferOptions(model: SystemDefinitionModel, endpoint: SystemEndpoint, mode?: string): TransferOption[] {
  const resources = new Map(model.resources.map(item => [item.id, item]))
  const instance = model.instances.find(item => item.id === endpoint.instance_id)
  const ports = model.definitions.find(item => item.id === instance?.definition_id)?.ports ?? []
  if (endpoint.instance_id) return effectiveSystemFunctions(model, endpoint.instance_id, mode).flatMap(fn =>
    (fn.definition?.io ?? []).flatMap(io => {
      const resource = resources.get(io.resource_id), port = ports.find(item => item.id === io.port_id)
      const portCompatible = !io.port_id || Boolean(port && resource && port.interface_type === resource.category
        && (port.direction === 'bidirectional' || port.direction === io.direction)
        && (!endpoint.port_id || endpoint.port_id === io.port_id))
      return resource && portCompatible ? [{ endpoint: { kind: 'function' as const, instance_id: endpoint.instance_id!, function_id: fn.id, io_id: io.id },
        label: `${structuredFunctionStatement(fn.definition, model.resources) || fn.description} · ${io.direction} · ${resource.name}`,
        direction: io.direction, resourceId: resource.id, category: resource.category }] : []
    }))
  const external = model.externals.find(item => item.id === endpoint.external_id)
  return (external?.ports ?? []).filter(port => !endpoint.port_id || port.id === endpoint.port_id).map(port => ({
    endpoint: { kind: 'external', external_id: external!.id, port_id: port.id }, label: `${external!.name} · ${port.name}`,
    direction: port.direction, category: port.interface_type, resourceId: port.resource_id,
  }))
}

export function compatibleTransferPairs(sourceOptions: TransferOption[], targetOptions: TransferOption[],
  interfaceType: SystemInterface['interface_type'], resources: SystemResource[], reverse = false) {
  const pairs: { source: TransferOption; target: TransferOption; resource: SystemResource }[] = []
  for (const source of sourceOptions) for (const target of targetOptions) {
    const sourceDirection = reverse ? 'input' : 'output', targetDirection = reverse ? 'output' : 'input'
    if (![sourceDirection, 'bidirectional'].includes(source.direction) || ![targetDirection, 'bidirectional'].includes(target.direction)) continue
    if (source.category !== interfaceType || target.category !== interfaceType) continue
    for (const resource of resources) {
      if (resource.category !== interfaceType || source.resourceId && source.resourceId !== resource.id
        || target.resourceId && target.resourceId !== resource.id) continue
      pairs.push({ source, target, resource })
    }
  }
  return pairs
}

export function syncGeneratedDescriptions(model: SystemDefinitionModel): SystemDefinitionModel {
  let changed = false
  const definitions = model.definitions.map(block => {
    let blockChanged = false
    const functions = block.functions.map(fn => {
      if (!fn.definition) return fn
      const description = structuredFunctionStatement(fn.definition, model.resources)
      if (fn.description === description) return fn
      changed = blockChanged = true
      return { ...fn, description }
    })
    return blockChanged ? { ...block, functions } : block
  })
  const instances = model.instances.map(instance => {
    let instanceChanged = false
    const function_overrides = instance.function_overrides.map(override => {
      if (!override.definition) return override
      const def = { ...override.definition, io: override.definition.io.map(io => ({ ...io,
        resource_id: override.resource_bindings?.[io.id] ?? io.resource_id })) }
      const description = structuredFunctionStatement(def, model.resources)
      if (override.description === description) return override
      changed = instanceChanged = true
      return { ...override, description }
    })
    return instanceChanged ? { ...instance, function_overrides } : instance
  })
  const interfaces = model.interfaces.map(edge => {
    const ids = (endpoint: SystemEndpoint) => [...new Set((edge.transfers ?? []).flatMap(transfer => [transfer.source, transfer.target]
      .flatMap(item => (item.kind === 'function' || item.kind === 'block') && item.function_id && item.instance_id === endpoint.instance_id ? [item.function_id] : [])))]
    const source_function_ids = ids(edge.source), target_function_ids = ids(edge.target)
    const flow_description = [...new Set((edge.transfers ?? []).map(transfer => transfer.kind === 'flow' ? model.resources.find(item => item.id === transfer.resource_id)?.name : undefined)
      .filter((name): name is string => Boolean(name)))].join(', ')
    if (same(source_function_ids, edge.source_function_ids) && same(target_function_ids, edge.target_function_ids)
      && edge.flow_description === flow_description) return edge
    changed = true
    return { ...edge, source_function_ids, target_function_ids, flow_description }
  })
  return changed ? { ...model, definitions, instances, interfaces } : model
}

/** Structural integrity checks tolerate missing draft values, but never dangling nonempty references. */
export function validateArchitectureIntegrity(model: SystemDefinitionModel): ArchitectureFinding[] {
  const findings: ArchitectureFinding[] = []
  const issue = (code: string, message: string, record_id?: string, field?: string, step: 2|3 = 3) =>
    findings.push({ step, code, message, record_id, field })
  const instances = new Map(model.instances.map(item => [item.id, item]))
  const resources = new Map(model.resources.map(item => [item.id, item]))
  const modes = new Set(model.modes.map(item => item.id))
  const checkModes = (ids: string[]|undefined, id: string) => { for (const mode of ids ?? []) if (!modes.has(mode)) issue('unknown_mode', 'The selected operating mode no longer exists.', id, 'mode_ids') }
  const unique = (items: { id: string }[], kind: string) => {
    const ids = new Set<string>()
    for (const item of items) {
      if (!item.id || ids.has(item.id)) issue('duplicate_identity', `${kind} requires a unique nonempty identifier.`, item.id, 'id', 2)
      ids.add(item.id)
    }
  }
  unique(model.resources, 'Resource'); unique(model.instances, 'Installed block'); unique(model.definitions, 'Definition'); unique(model.interfaces, 'Interface')
  // Current-contract shape checks run before resolving any effective output owners.
  const contracts = [...model.definitions.flatMap(block => block.functions.map(fn => ({ id: fn.id, definition: fn.definition }))),
    ...model.instances.flatMap(instance => instance.function_overrides.map(override => ({ id: override.function_id, definition: override.definition })))]
  for (const entry of contracts) if (entry.definition != null) {
    const definition = entry.definition
    if (typeof definition !== 'object' || Array.isArray(definition)
      || Object.keys(definition).some(field => !['role', 'action', 'state_verb', 'io'].includes(field))
      || !['transform', 'source', 'maintain_state'].includes(definition.role) || typeof definition.action !== 'string'
      || !Array.isArray(definition.io) || definition.io.some(io => !io || typeof io !== 'object' || Array.isArray(io)
        || Object.keys(io).some(field => !['id', 'resource_id', 'direction', 'port_id'].includes(field))
        || typeof io.id !== 'string' || typeof io.resource_id !== 'string' || !['input', 'output'].includes(io.direction)
        || io.port_id != null && typeof io.port_id !== 'string'))
      issue('invalid_function_contract', 'Use the current function action and input/output resource format.', entry.id, 'definition')
  }
  for (const instance of model.instances) for (const override of [...instance.function_overrides, ...instance.failure_mode_overrides])
    if (override.enabled != null && typeof override.enabled !== 'boolean')
      issue('invalid_default_enabled', 'Installed enablement must be a boolean or inherited.', instance.id, 'overrides')
  for (const instance of model.instances) for (const override of instance.function_overrides) if (override.resource_bindings != null
    && (typeof override.resource_bindings !== 'object' || Array.isArray(override.resource_bindings)
      || Object.values(override.resource_bindings).some(value => typeof value !== 'string')))
    issue('invalid_resource_bindings', 'Installed resource bindings must map I/O identities to resource identities.', instance.id, 'function_overrides')
  if (findings.some(item => ['invalid_function_contract', 'invalid_resource_bindings'].includes(item.code))) return findings
  const owners = new Map<string, ResourceProducer[]>()
  for (const owner of systemResourceProducers(model)) owners.set(owner.resourceId, [...(owners.get(owner.resourceId) ?? []), owner])
  for (const entries of owners.values()) if (entries.length > 1)
    for (const owner of entries) issue('multiple_resource_producers', 'Each output resource must have exactly one producer.',
      owner.endpoint.kind === 'function' ? owner.endpoint.function_id : owner.endpoint.external_id, 'definition.io')
  for (const actor of model.externals) for (const port of actor.ports ?? []) if (port.resource_id) {
    const resource = resources.get(port.resource_id)
    if (!resource) issue('missing_resource', 'External output references an unavailable resource.', actor.id, 'ports')
    else if (port.direction === 'input' || port.interface_type !== resource.category)
      issue('incompatible_external_resource', 'An external resource requires an output terminal with the same category.', actor.id, 'ports')
  }
  const checkDefinition = (fn: SystemFunction, ports: Set<string>, ownerId: string) => {
    if (!fn.definition) return
    unique(fn.definition.io, 'Function I/O')
    if (fn.definition.state_verb && !stateVerbs.has(fn.definition.state_verb)) issue('unknown_function_verb', 'Choose a supported state action.', fn.id, 'definition.state_verb')
    for (const io of fn.definition.io) {
      if (io.resource_id && !resources.has(io.resource_id)) issue('missing_resource', 'Function I/O references an unavailable resource.', fn.id, 'definition.io')
      if (io.port_id && !ports.has(io.port_id)) issue('missing_port', `Function I/O references an unavailable port on ${ownerId}.`, fn.id, 'definition.io')
    }
  }
  for (const definition of model.definitions) {
    for (const item of [...definition.functions, ...definition.failure_modes]) if (item.default_enabled != null && typeof item.default_enabled !== 'boolean')
      issue('invalid_default_enabled', 'Default enablement must be a boolean.', item.id, 'default_enabled')
    unique(definition.functions, 'Function')
    for (const fn of definition.functions) { checkModes(fn.mode_ids, fn.id); checkDefinition(fn, new Set(definition.ports.map(port => port.id)), definition.id) }
  }
  for (const instance of model.instances) {
    const definition = model.definitions.find(item => item.id === instance.definition_id)
    if (!definition) issue('missing_definition', 'Installed block references an unavailable definition.', instance.id, 'definition_id', 2)
    if (instance.parent_instance_id && !instances.has(instance.parent_instance_id)) issue('missing_parent', 'Installed block references an unavailable parent.', instance.id, 'parent_instance_id', 2)
    const seen = new Set([instance.id]); let cursor = instance.parent_instance_id
    while (cursor && instances.has(cursor)) {
      if (seen.has(cursor)) { issue('hierarchy_cycle', 'Installed hierarchy contains a cycle.', instance.id, 'parent_instance_id', 2); break }
      seen.add(cursor); cursor = instances.get(cursor)?.parent_instance_id
    }
    checkModes(instance.mode_ids, instance.id)
    for (const override of instance.function_overrides) {
      const fn = definition?.functions.find(item => item.id === override.function_id)
      if (!fn) issue('missing_function', 'Installed override references an unavailable function.', instance.id, 'function_overrides')
      else checkDefinition({ ...fn, ...override }, new Set(definition?.ports.map(port => port.id)), instance.id)
      for (const [ioId, resourceId] of Object.entries(override.resource_bindings ?? {})) {
        if (!(override.definition ?? fn?.definition)?.io.some(io => io.id === ioId)) issue('missing_function_io', 'Resource binding references unavailable function I/O.', instance.id, 'function_overrides')
        if (resourceId && !resources.has(resourceId)) issue('missing_resource', 'Resource binding references an unavailable resource.', instance.id, 'function_overrides')
      }
      checkModes(override.mode_ids, instance.id)
    }
  }
  const referencedFunction = (instanceId: string, functionId: string) => {
    const instance = instances.get(instanceId)
    const fn = model.definitions.find(item => item.id === instance?.definition_id)?.functions.find(item => item.id === functionId)
    const fields = Object.fromEntries(Object.entries(instance?.function_overrides.find(item => item.function_id === functionId) ?? {}).filter(([, value]) => value != null))
    return fn && { ...fn, ...fields, id: fn.id }
  }
  const resolved = (endpoint: ResourceTransferEndpoint|RelationEndpoint, id: string) => {
    if (endpoint.kind === 'external') {
      const actor = model.externals.find(item => item.id === endpoint.external_id)
      if (!actor || endpoint.port_id && !actor.ports?.some(port => port.id === endpoint.port_id)) issue('missing_external_terminal', 'Select an existing typed external terminal.', id, 'transfers')
      return
    }
    if (endpoint.kind === 'block' && !endpoint.function_id) {
      if (!instances.has(endpoint.instance_id)) issue('missing_interface_endpoint', 'Relation references an unavailable block.', id, 'transfers')
      return
    }
    const fn = referencedFunction(endpoint.instance_id, endpoint.function_id!)
    if (!fn) issue('missing_transfer_function', 'Transfer references an unavailable installed function.', id, 'transfers')
    else if (endpoint.kind === 'function' && !fn.definition?.io.some(io => io.id === endpoint.io_id)) issue('missing_transfer_io', 'Transfer references an unavailable function I/O.', id, 'transfers')
  }
  const belongs = (end: ResourceTransferEndpoint|RelationEndpoint, block: SystemEndpoint) => end.kind !== 'external'
    ? end.instance_id === block.instance_id : end.external_id === block.external_id && (!block.port_id || block.port_id === end.port_id)
  for (const edge of model.interfaces) {
    checkModes(edge.mode_ids, edge.id); unique(edge.transfers ?? [], 'Transfer')
    for (const end of [edge.source, edge.target]) {
      if (end.instance_id && !instances.has(end.instance_id)) issue('missing_interface_endpoint', 'Interface references an unavailable installed block.', edge.id, 'source')
      if (end.external_id && !model.externals.some(item => item.id === end.external_id)) issue('missing_interface_endpoint', 'Interface references an unavailable external actor.', edge.id, 'source')
    }
    for (const transfer of edge.transfers ?? []) {
      if (transfer.kind === 'flow' && !resources.has(transfer.resource_id)) issue('missing_resource', 'Transfer references an unavailable resource.', edge.id, 'transfers')
      resolved(transfer.source, edge.id); resolved(transfer.target, edge.id); checkModes(transfer.mode_ids, edge.id)
      const forward = belongs(transfer.source, edge.source) && belongs(transfer.target, edge.target)
      const reverse = edge.directionality !== 'directed' && belongs(transfer.source, edge.target) && belongs(transfer.target, edge.source)
      if (!forward && !reverse) issue('transfer_endpoint_mismatch', 'Transfer endpoints must belong to the connected blocks and follow the interface direction.', edge.id, 'transfers')
    }
  }
  for (const link of model.function_links) {
    checkModes(link.mode_ids, link.id)
    for (const endpoint of [link.source, link.target]) if (!referencedFunction(endpoint.instance_id, endpoint.function_id))
      issue('missing_link_function', 'Function link references an unavailable installed function.', link.id, 'function_links')
  }
  return findings
}

export function architectureDependencyScope(model: SystemDefinitionModel, options: ArchitectureScope = {}) {
  const instances = new Map(model.instances.map(item => [item.id, item]))
  const definitions = new Map(model.definitions.map(item => [item.id, item]))
  const root = options.scopeInstanceId || model.root_instance_id || ''
  const scope = new Set<string>(), included = new Set(options.includedPiecePartIds ?? [])
  const isDescendant = (id: string, parent: string) => {
    const seen = new Set<string>(); let next: string|undefined = id
    while (next && !seen.has(next)) { if (next === parent) return true; seen.add(next); next = instances.get(next)?.parent_instance_id }
    return false
  }
  for (const instance of model.instances) if (isDescendant(instance.id, root) && active(instance.mode_ids, options.modeId)
    && (definitions.get(instance.definition_id)?.kind !== 'piece_part' || included.has(instance.id) || instance.id === root)) scope.add(instance.id)
  // A piece part used as an actual endpoint belongs to the functional model even when its symbol is hidden.
  const edges = model.interfaces.filter(edge => active(edge.mode_ids, options.modeId)
    && [edge.source, edge.target].some(end => end.instance_id && (scope.has(end.instance_id) || isDescendant(end.instance_id, root))))
  for (const edge of edges) for (const end of [edge.source, edge.target]) if (end.instance_id && isDescendant(end.instance_id, root)) scope.add(end.instance_id)
  const required = new Map<string, { instanceId: string; fn: SystemFunction; full: boolean }>()
  const add = (instanceId: string, functionId?: string, full = false) => {
    for (const fn of effectiveSystemFunctions(model, instanceId, options.modeId)) if (!functionId || fn.id === functionId) {
      const ref = key(instanceId, fn.id), prior = required.get(ref)
      required.set(ref, { instanceId, fn, full: full || Boolean(prior?.full) })
    }
  }
  for (const id of scope) add(id, undefined, true)
  // An input refers to its producer even while a route is still being chosen.
  const producers = systemResourceProducers(model), externalIds = new Set<string>()
  for (const { fn, full } of [...required.values()]) if (full) for (const io of fn.definition?.io ?? []) if (io.direction === 'input') {
    const owners = producers.filter(owner => owner.resourceId === io.resource_id)
    for (const owner of owners.length === 1 ? owners : []) {
      if (owner.endpoint.kind === 'function') add(owner.endpoint.instance_id, owner.endpoint.function_id)
      else externalIds.add(owner.endpoint.external_id)
    }
  }
  for (const edge of edges) for (const transfer of (edge.transfers ?? []).filter(item => active(item.mode_ids, options.modeId))) for (const end of [transfer.source, transfer.target])
    if ((end.kind === 'function' || end.kind === 'block') && end.function_id) add(end.instance_id, end.function_id)
  // Follow only authored support links, never every function on an outside peer or ancestor.
  for (const item of required.values()) for (const link of model.function_links) if (link.relationship === 'decomposes_to'
    && link.target.instance_id === item.instanceId && link.target.function_id === item.fn.id
    && active(link.mode_ids, options.modeId) && instances.get(item.instanceId)?.parent_instance_id === link.source.instance_id)
    if (!required.has(key(link.source.instance_id, link.source.function_id))) add(link.source.instance_id, link.source.function_id)
  const instanceIds = new Set([...scope, ...required.values()].flatMap(item => typeof item === 'string' ? [item] : [item.instanceId]))
  for (const edge of edges) for (const end of [edge.source, edge.target]) if (end.instance_id) instanceIds.add(end.instance_id)
  for (const id of instanceIds) {
    const parent = instances.get(id)?.parent_instance_id
    if (parent) instanceIds.add(parent)
  }
  const resourceIds = new Set([...required.values()].flatMap(item => item.fn.definition?.io.map(io => io.resource_id) ?? []))
  for (const edge of edges) for (const transfer of (edge.transfers ?? []).filter(item => active(item.mode_ids, options.modeId))) if (transfer.kind === 'flow') resourceIds.add(transfer.resource_id)
  return { instanceIds, externalIds, scopeInstanceIds: scope, functionKeys: new Set(required.keys()),
    interfaceIds: new Set(edges.map(edge => edge.id)), resourceIds, requiredFunctions: required }
}

/** All study functions, actual boundary endpoints and only their required ancestor support chains. */
export function inspectArchitectureCompleteness(model: SystemDefinitionModel, options: ArchitectureScope = {}): ArchitectureFinding[] {
  const findings: ArchitectureFinding[] = []
  const issue = (code: string, message: string, record_id?: string, field?: string, instance_id?: string, step: 2|3 = 3) =>
    findings.push({ step, code, message, record_id, field, instance_id })
  const instances = new Map(model.instances.map(item => [item.id, item]))
  const definitions = new Map(model.definitions.map(item => [item.id, item]))
  const root = options.scopeInstanceId || model.root_instance_id
  if (!root || !instances.has(root)) return [{ step: 2, code: 'missing_scope', message: 'Choose an installed analysis scope.', field: 'scope_instance_id' }]
  const dependency = architectureDependencyScope(model, options)
  const scope = dependency.scopeInstanceIds, required = dependency.requiredFunctions
  const edges = model.interfaces.filter(edge => dependency.interfaceIds.has(edge.id))
  for (const id of dependency.instanceIds) {
    const instance = instances.get(id)
    if (!instance?.name.trim()) issue('missing_block_name', 'Name every installed block in the study scope.', id, 'name', id, 2)
    if (scope.has(id) && !effectiveSystemFunctions(model, id, options.modeId).length) issue('missing_function_coverage', 'Define at least one active function for this installed block.', id, 'functions', id)
  }
  const referenced = new Set([...required.values()].map(item => item.fn.id))
  const relevantRecords = new Set([...dependency.instanceIds, ...edges.map(edge => edge.id), ...referenced,
    ...model.function_links.filter(link => required.has(key(link.target.instance_id, link.target.function_id))).map(link => link.id)])
  for (const finding of validateArchitectureIntegrity(model)) if (!finding.record_id || relevantRecords.has(finding.record_id)) findings.push(finding)
  for (const link of model.function_links) if (link.relationship === 'decomposes_to'
    && required.has(key(link.target.instance_id, link.target.function_id))
    && instances.get(link.target.instance_id)?.parent_instance_id !== link.source.instance_id)
    issue('invalid_parent_support', 'Function support must link an immediate installed parent to its child.', link.id, 'function_links', link.target.instance_id)
  const resources = new Map(model.resources.map(item => [item.id, item]))
  const allModes = model.modes.map(item => item.id)
  const producers = systemResourceProducers(model)
  for (const { instanceId, fn, full } of required.values()) {
    const definition = fn.definition, instance = instances.get(instanceId)
    if (!definition || !definition.action?.trim()) {
      issue('missing_function_definition', 'Describe what this function does or the condition it maintains.', fn.id, 'definition.action', instanceId)
      if (!definition) continue
    }
    const inputs = definition.io.filter(io => io.direction === 'input'), outputs = definition.io.filter(io => io.direction === 'output')
    if (definition.role === 'source' && (outputs.length !== 1 || inputs.length !== 0)
      || definition.role === 'transform' && (inputs.length < 1 || outputs.length !== 1)
      || definition.role === 'maintain_state' && definition.io.length !== 0)
      issue('invalid_function_io', 'Transform needs inputs and one output; Source needs one output; Maintain State needs only a condition.', fn.id, 'definition.io', instanceId)
    for (const io of definition.io) {
      const resource = resources.get(io.resource_id)
      if (!resource?.name.trim()) issue('missing_resource_name', 'Name the output or choose an input resource.', fn.id, 'definition.io', instanceId)
      const port = definitions.get(instance?.definition_id ?? '')?.ports.find(item => item.id === io.port_id)
      if (io.port_id && port && resource && (port.interface_type !== resource.category
        || port.direction !== 'bidirectional' && port.direction !== io.direction))
        issue('incompatible_function_port', 'The function I/O resource category and direction must match its typed port.', fn.id, 'definition.io', instanceId)
      const owners = producers.filter(owner => owner.resourceId === io.resource_id)
      if (io.resource_id && owners.length > 1) issue('multiple_resource_producers', 'Each output resource must have exactly one producer.', fn.id, 'definition.io', instanceId)
      if (full && io.direction === 'input' && io.resource_id) {
        const owner = owners.length === 1 ? owners[0] : undefined
        if (!owner) { issue('missing_resource_producer', 'Choose an input from a function output or typed external source.', fn.id, 'definition.io', instanceId); continue }
        if (owner.endpoint.kind === 'function' && owner.endpoint.instance_id === instanceId && owner.endpoint.function_id === fn.id) {
          issue('self_function_input', 'A function cannot use its own output as an input.', fn.id, 'definition.io', instanceId); continue
        }
        const fnModes = options.modeId ? [options.modeId] : allModes.filter(mode => active(fn.mode_ids, mode) && active(instance?.mode_ids, mode))
        const applicableModes = fnModes.length ? fnModes : ['']
        const sameBlock = owner.endpoint.kind === 'function' && owner.endpoint.instance_id === instanceId
        const producerActive = (mode: string) => !mode || owner.modeIds.includes(mode)
        if (applicableModes.some(mode => !producerActive(mode) || !sameBlock && !edges.some(edge => active(edge.mode_ids, mode)
          && (edge.transfers ?? []).some(transfer => transfer.kind === 'flow' && transfer.resource_id === io.resource_id
            && active(transfer.mode_ids, mode) && transferEndpointKey(transfer.source) === transferEndpointKey(owner.endpoint)
            && transfer.target.kind === 'function' && transfer.target.instance_id === instanceId
            && transfer.target.function_id === fn.id && transfer.target.io_id === io.id))))
          issue('unpaired_function_io', 'Connect this input to its producer in every applicable operating mode.', fn.id, 'definition.io', instanceId)
      }
    }
    if (instance?.parent_instance_id) {
      const fnModes = options.modeId ? [options.modeId] : allModes.filter(mode => active(fn.mode_ids, mode) && active(instance.mode_ids, mode))
      const coverageModes = fnModes.length ? fnModes : ['']
      const links = model.function_links.filter(link => link.relationship === 'decomposes_to'
        && link.target.instance_id === instanceId && link.target.function_id === fn.id && link.source.instance_id === instance.parent_instance_id)
      if (coverageModes.some(mode => !links.some(link => active(link.mode_ids, mode)
        && effectiveSystemFunctions(model, link.source.instance_id, mode).some(parent => parent.id === link.source.function_id))))
        issue('missing_parent_support', 'Allocate this function to an active function on its immediate installed parent for every applicable mode.', fn.id, 'function_links', instanceId)
    }
  }
  for (const edge of edges) {
    if (!edge.transfers?.length) { issue('incomplete_interface_transfer', 'Define the resource and complementary functions for this interface.', edge.id, 'transfers'); continue }
    const sourceOptions = systemTransferOptions(model, edge.source, options.modeId), targetOptions = systemTransferOptions(model, edge.target, options.modeId)
    const pairs = compatibleTransferPairs(sourceOptions, targetOptions, edge.interface_type, model.resources)
    if (edge.directionality !== 'directed') pairs.push(...compatibleTransferPairs(targetOptions, sourceOptions, edge.interface_type, model.resources))
    const edgeModes = options.modeId ? [options.modeId] : allModes.filter(mode => active(edge.mode_ids, mode))
    const coverageModes = edgeModes.length ? edgeModes : ['']
    const terminalActive = (endpoint: ResourceTransferEndpoint|RelationEndpoint, mode: string) => endpoint.kind === 'external'
      || (endpoint.kind === 'block' && !endpoint.function_id ? active(instances.get(endpoint.instance_id)?.mode_ids, mode)
        : effectiveSystemFunctions(model, endpoint.instance_id, mode).some(fn => fn.id === endpoint.function_id))
    if (coverageModes.some(mode => !edge.transfers!.some(transfer => active(transfer.mode_ids, mode)
      && terminalActive(transfer.source, mode) && terminalActive(transfer.target, mode))))
      issue('incomplete_transfer_mode_coverage', 'Define a connection with active endpoints in every applicable interface mode.', edge.id, 'transfers')
    if (edge.directionality === 'bidirectional' && edge.transfers.some(transfer => transfer.kind === 'flow')) {
      const belongs = (endpoint: ResourceTransferEndpoint, end: SystemEndpoint) => endpoint.kind === 'function'
        ? endpoint.instance_id === end.instance_id : endpoint.external_id === end.external_id
      if (coverageModes.some(mode => ['source', 'target'].some(side => !edge.transfers!.some(transfer => transfer.kind === 'flow' && active(transfer.mode_ids, mode)
        && belongs(transfer.source, edge[side as 'source'|'target']) && terminalActive(transfer.source, mode) && terminalActive(transfer.target, mode)))))
        issue('incompatible_transfer_direction', 'A bidirectional resource interface needs a transfer in each direction.', edge.id, 'transfers')
    }
    for (const transfer of edge.transfers.filter(item => active(item.mode_ids, options.modeId))) {
      if (transfer.kind === 'relation') {
        if (!['physical', 'clearance'].includes(edge.interface_type)) issue('incompatible_transfer_resource', 'Physical relations require a physical or clearance interface.', edge.id, 'transfers')
        for (const end of [transfer.source, transfer.target]) if (end.kind === 'block' && end.function_id
          && effectiveSystemFunctions(model, end.instance_id).find(fn => fn.id === end.function_id)?.definition?.role !== 'maintain_state')
          issue('incompatible_relation_function', 'A physical relation may reference a block or one of its Maintain State functions.', edge.id, 'transfers')
      } else if (!pairs.some(pair => pair.resource.id === transfer.resource_id && transferEndpointKey(pair.source.endpoint) === transferEndpointKey(transfer.source)
        && transferEndpointKey(pair.target.endpoint) === transferEndpointKey(transfer.target)))
        issue('incompatible_transfer_resource', 'The selected transfer must pair the output resource with its consuming input.', edge.id, 'transfers')
    }
  }

  return findings.filter((finding, index) => findings.findIndex(other => same(other, finding)) === index)
}

/** PFMEA owns process topology. Equipment references never alter its parentage. */
export function processArchitectureModel(analysis: AIAGVDAFMEAAnalysis): SystemDefinitionModel {
  const nodes = analysis.structure_nodes, blocks = analysis.block_diagram.nodes
  const modeIds = [...new Set([...analysis.functions.flatMap(fn => fn.operating_modes),
    ...analysis.interfaces.flatMap(edge => [...edge.mode_ids ?? [], ...edge.transfers?.flatMap(transfer => transfer.mode_ids) ?? []]),
    ...analysis.function_links.flatMap(link => link.mode_ids ?? []),
  ])]
  const externals: SystemDefinitionModel['externals'] = blocks.filter(block => block.kind === 'external').map(block => ({
    id: block.id, name: block.label, kind: block.external_kind ?? 'adjacent_system', description: '', ports: block.ports ?? [],
  }))
  const endpoint = (edge: AIAGVDAFMEAAnalysis['interfaces'][number], side: 'source'|'target'): SystemEndpoint => {
    const id = edge[`${side}_structure_node_id`] || blocks.find(block => block.id === edge[`${side}_block_id`])?.structure_node_id
    if (id) return { instance_id: id }
    const externalId = edge[`${side}_block_id`] || `external-${edge.id}-${side}`
    if (!externals.some(item => item.id === externalId)) externals.push({ id: externalId,
      name: edge[side === 'source' ? 'external_source' : 'external_target'] || externalId,
      kind: 'adjacent_system', description: '', ports: blocks.find(block => block.id === externalId)?.ports ?? [] })
    return { external_id: externalId }
  }
  const interfaces = analysis.interfaces.map(edge => ({ id: edge.id, name: edge.name, interface_type: edge.interface_type,
    source: endpoint(edge, 'source'), target: endpoint(edge, 'target'), directionality: edge.directionality, linkage: edge.linkage,
    strength: edge.relationship_strength === 'unspecified' ? 'unknown' as const : edge.relationship_strength,
    interface_detail: edge.interface_detail, flow_description: edge.flow_description, operating_condition: edge.operating_condition,
    source_function_ids: [], target_function_ids: [], mode_ids: edge.mode_ids ?? [], transfers: edge.transfers ?? [], generated: edge.generated }))
  return { version: 4, id: analysis.id, name: analysis.name, revision: analysis.revision,
    root_instance_id: nodes.filter(node => !node.parent_id).length === 1 ? nodes.find(node => !node.parent_id)?.id : undefined, resources: analysis.resources ?? [],
    modes: modeIds.map(id => ({ id, name: id, description: '' })),
    definitions: nodes.map(node => ({ id: `process-definition:${node.id}`, name: node.name, classification: 'process',
      description: node.description, kind: 'system', part_number: '', manufacturer: '', category: '', ports: [], child_slots: [], failure_modes: [],
      functions: analysis.functions.filter(fn => fn.structure_node_id === node.id).map(fn => ({ id: fn.id, description: fn.description,
        canonical_verb_id: fn.canonical_verb_id, function_type: fn.function_type, mode_ids: fn.operating_modes, definition: fn.definition })) })),
    instances: nodes.map(node => ({ id: node.id, name: node.name, definition_id: `process-definition:${node.id}`, parent_instance_id: node.parent_id,
      quantity: 1, reference_designators: [], mode_ids: [], function_overrides: [], failure_mode_overrides: [], legacy_refs: [] })),
    externals, interfaces, function_links: analysis.function_links.flatMap(link => {
      const source = analysis.functions.find(fn => fn.id === link.source_function_id), target = analysis.functions.find(fn => fn.id === link.target_function_id)
      return source && target ? [{ id: link.id, source: { instance_id: source.structure_node_id, function_id: source.id },
        target: { instance_id: target.structure_node_id, function_id: target.id }, relationship: link.relationship, rationale: link.rationale, mode_ids: link.mode_ids ?? [], generated: link.generated }] : []
    }), propagation_rules: [], diagrams: [] }
}
