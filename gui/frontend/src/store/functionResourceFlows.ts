import type { ResourceTransfer, ResourceTransferEndpoint, SystemDefinitionModel, SystemEndpoint, SystemFunction, SystemInterface, SystemResource } from '../api/systemDefinition'
import { effectiveSystemFunctions, structuredFunctionStatement, syncGeneratedDescriptions, systemResourceProducers, transferEndpointKey, type ArchitectureFinding } from './systemArchitecture'

type Model = SystemDefinitionModel
type IdFactory = () => string
const newId: IdFactory = () => crypto.randomUUID()
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const active = (modes: string[]|undefined, mode: string) => !modes?.length || modes.includes(mode)
const fnKey = (instanceId: string, functionId: string) => JSON.stringify([instanceId, functionId])
export const functionInputKey = (instanceId: string, functionId: string, ioId: string) => JSON.stringify([instanceId, functionId, ioId])
const blockEndpoint = (end: ResourceTransferEndpoint): SystemEndpoint => end.kind === 'function'
  ? { instance_id: end.instance_id } : { external_id: end.external_id, port_id: end.port_id }
const belongs = (end: ResourceTransferEndpoint, block: SystemEndpoint) => end.kind === 'function'
  ? end.instance_id === block.instance_id : end.external_id === block.external_id && (!block.port_id || block.port_id === end.port_id)

export interface FunctionInputOption {
  resource: SystemResource; producer: ResourceTransferEndpoint; label: string
  sourceKind: 'installed'|'external'
  /** Installed root-to-occurrence path, using identities rather than parsed display text. */
  path: { id: string; label: string }[]
  instanceId?: string; functionId?: string; functionLabel: string
  externalId?: string; externalLabel?: string
}
export function availableFunctionInputs(model: Model, exclude?: { instanceId: string; functionId: string }): FunctionInputOption[] {
  const owners = systemResourceProducers(model), counts = new Map<string, number>()
  for (const owner of owners) counts.set(owner.resourceId, (counts.get(owner.resourceId) ?? 0) + 1)
  const instances = new Map(model.instances.map(item => [item.id, item]))
  const resources = new Map(model.resources.map(item => [item.id, item]))
  const externals = new Map(model.externals.map(item => [item.id, item]))
  const paths = new Map<string, FunctionInputOption['path']>()
  const path = (id: string) => {
    const cached = paths.get(id)
    if (cached) return cached
    const items: FunctionInputOption['path'] = [], seen = new Set<string>()
    let instance = instances.get(id)
    while (instance && !seen.has(instance.id)) {
      items.unshift({ id: instance.id, label: instance.name || instance.id }); seen.add(instance.id)
      instance = instances.get(instance.parent_instance_id ?? '')
    }
    paths.set(id, items); return items
  }
  const options = owners.flatMap<FunctionInputOption>(owner => {
    const resource = resources.get(owner.resourceId)
    if (!resource || counts.get(resource.id) !== 1) return []
    const end = owner.endpoint
    if (end.kind === 'function' && end.instance_id === exclude?.instanceId && end.function_id === exclude.functionId) return []
    if (end.kind === 'function') {
      const hierarchy = path(end.instance_id)
      const fn = effectiveSystemFunctions(model, end.instance_id).find(fn => fn.id === end.function_id)
      const functionLabel = structuredFunctionStatement(fn?.definition, model.resources) || fn?.description || 'Untitled function'
      return [{ resource, producer: end, sourceKind: 'installed' as const, path: hierarchy, instanceId: end.instance_id,
        functionId: end.function_id, functionLabel, label: `${hierarchy.map(item => item.label).join(' › ')} › ${functionLabel} › ${resource.name}` }]
    }
    const external = externals.get(end.external_id), externalLabel = external?.name || 'External source'
    const functionLabel = external?.ports?.find(port => port.id === end.port_id)?.name || 'Output'
    return [{ resource, producer: end, sourceKind: 'external' as const, path: [], externalId: end.external_id,
      externalLabel, functionLabel, label: `${externalLabel} › ${functionLabel} › ${resource.name}` }]
  }).sort((a, b) => a.label.localeCompare(b.label) || a.resource.id.localeCompare(b.resource.id))
  return options.map(option => {
    const duplicates = options.filter(other => other.label === option.label)
    if (duplicates.length < 2) return option
    let length = Math.min(8, option.resource.id.length)
    while (length < option.resource.id.length && duplicates.some(other => other.resource.id !== option.resource.id
      && other.resource.id.slice(-length) === option.resource.id.slice(-length))) length++
    return { ...option, label: `${option.label} (${option.resource.id.slice(-length)})` }
  })
}

/** Add/edit an installed function without enabling a new function on sibling occurrences. */
export function upsertInstalledFunction(model: Model, instanceId: string, fn: SystemFunction,
  options: { resources?: SystemResource[]; idFactory?: IdFactory } = {}): Model {
  const instance = model.instances.find(item => item.id === instanceId)
  if (!instance) return model
  const block = model.definitions.find(item => item.id === instance.definition_id)
  if (!block) return model
  const existing = block.functions.find(item => item.id === fn.id)
  let next: Model = { ...model, resources: options.resources ?? model.resources,
    definitions: model.definitions.map(item => item.id === block.id && !existing ? { ...item, functions: [...item.functions, { ...fn, default_enabled: false }] } : item),
    instances: model.instances.map(item => {
      if (item.definition_id !== block.id) return item
      if (item.id !== instanceId) return existing ? item : { ...item,
        function_overrides: [...item.function_overrides, { function_id: fn.id, enabled: false }] }
      if (!existing) return { ...item, function_overrides: [...item.function_overrides, { function_id: fn.id, enabled: true }] }
      const previous = item.function_overrides.find(override => override.function_id === fn.id)
      const sameShape = existing.definition && fn.definition && same({ ...existing.definition, io: existing.definition.io.map(({ resource_id: _, ...io }) => io) },
        { ...fn.definition, io: fn.definition.io.map(({ resource_id: _, ...io }) => io) })
      const resource_bindings = Object.fromEntries((fn.definition?.io ?? []).filter(io =>
        (sameShape ? existing.definition : fn.definition)?.io.find(base => base.id === io.id)?.resource_id !== io.resource_id).map(io => [io.id, io.resource_id]))
      // Keep the inherited action when only the occurrence's resources differ.
      const override: Model['instances'][number]['function_overrides'][number] = {
        function_id: fn.id, enabled: previous?.enabled ?? existing.default_enabled ?? true,
        ...(fn.function_type !== existing.function_type ? { function_type: fn.function_type } : {}),
        ...(!same(fn.mode_ids, existing.mode_ids) ? { mode_ids: fn.mode_ids } : {}),
        ...(!sameShape ? { definition: fn.definition, description: fn.description } : {}),
        ...(Object.keys(resource_bindings).length ? { resource_bindings } : {}),
      }
      return { ...item, function_overrides: [...item.function_overrides.filter(value => value.function_id !== fn.id), override] }
    }) }
  next = reconcileFunctionResources(next, { idFactory: options.idFactory }).model
  return next
}

/** Reusable definitions inherit descriptions and unchanged output metadata, never occurrence customizations. */
export function updateReusableFunction(model: Model, definitionId: string, fn: SystemFunction, resources: SystemResource[] = model.resources): Model {
  const previous = model.definitions.find(block => block.id === definitionId)?.functions.find(item => item.id === fn.id)
  if (!previous) return model
  const updates = new Map<string, SystemResource>()
  const fields = ['name', 'category', 'quantity', 'unit'] as const
  const instances = model.instances.map(instance => {
    if (instance.definition_id !== definitionId) return instance
    return { ...instance, function_overrides: instance.function_overrides.map(override => {
      if (override.function_id !== fn.id || override.definition || !override.resource_bindings) return override
      for (const output of previous.definition?.io.filter(io => io.direction === 'output') ?? []) {
        const oldResource = model.resources.find(item => item.id === output.resource_id)
        const newOutput = fn.definition?.io.find(io => io.id === output.id && io.direction === 'output')
        const newResource = resources.find(item => item.id === newOutput?.resource_id)
        const boundId = override.resource_bindings[output.id], bound = resources.find(item => item.id === boundId)
        if (!oldResource || !newResource || !bound || bound.id === newResource.id) continue
        const updated = { ...bound }
        for (const field of fields) if (same(bound[field], oldResource[field])) {
          // Field-by-field inheritance preserves a customized label alongside inherited units/category.
          if (newResource[field] === undefined) delete updated[field]
          else Object.assign(updated, { [field]: newResource[field] })
        }
        updates.set(bound.id, updated)
      }
      const validIds = new Set(fn.definition?.io.map(io => io.id) ?? [])
      return { ...override, resource_bindings: Object.fromEntries(Object.entries(override.resource_bindings).filter(([ioId]) => validIds.has(ioId))) }
    }) }
  })
  return { ...model, resources: resources.map(resource => updates.get(resource.id) ?? resource), instances,
    definitions: model.definitions.map(block => block.id === definitionId ? { ...block, functions: block.functions.map(item => item.id === fn.id ? fn : item) } : block) }
}

/** Authoring only: new/enabled outputs cannot take ownership away from an existing producer. */
export function bindNewInstalledOutputs(next: Model, previous: Model, idFactory: IdFactory = newId): Model {
  const priorOwners = new Set(systemResourceProducers(previous).map(owner => JSON.stringify([owner.resourceId, transferEndpointKey(owner.endpoint)])))
  const groups = new Map<string, ReturnType<typeof systemResourceProducers>>()
  for (const owner of systemResourceProducers(next)) groups.set(owner.resourceId, [...(groups.get(owner.resourceId) ?? []), owner])
  const bindings = new Map<string, Record<string, string>>(), resources = [...next.resources]
  for (const [resourceId, owners] of groups) {
    if (owners.length < 2) continue
    const resource = next.resources.find(item => item.id === resourceId)
    if (!resource) continue
    const existing = owners.filter(owner => priorOwners.has(JSON.stringify([resourceId, transferEndpointKey(owner.endpoint)])))
    if (existing.length > 1) continue // Existing malformed ownership is validated, never guessed away.
    const keeper = existing[0] ?? owners[0]
    for (const owner of owners) {
      if (owner === keeper || owner.endpoint.kind !== 'function' || priorOwners.has(JSON.stringify([resourceId, transferEndpointKey(owner.endpoint)]))) continue
      const fresh = idFactory(); resources.push({ ...resource, id: fresh })
      const key = fnKey(owner.endpoint.instance_id, owner.endpoint.function_id)
      bindings.set(key, { ...bindings.get(key), [owner.endpoint.io_id]: fresh })
    }
  }
  if (!bindings.size) return next
  return { ...next, resources, instances: next.instances.map(instance => ({ ...instance,
    function_overrides: [...instance.function_overrides.filter(override => !bindings.has(fnKey(instance.id, override.function_id))),
      ...[...bindings].flatMap(([key, resource_bindings]) => {
        const [instanceId, functionId] = JSON.parse(key) as [string, string]
        if (instanceId !== instance.id) return []
        const previous = instance.function_overrides.find(override => override.function_id === functionId)
        return [{ ...(previous ?? { function_id: functionId, enabled: true }), resource_bindings: { ...previous?.resource_bindings, ...resource_bindings } }]
      }),
    ],
  })) }
}

export interface RouteAmbiguity { inputKey: string; instanceId: string; functionId: string; ioId: string; interfaceIds: string[] }
export interface ReconcileResourceOptions { routeSelections?: Record<string, string>; idFactory?: IdFactory }

/** Run at authoring boundaries. An unchanged graph returns unchanged identities and values. */
export function reconcileFunctionResources(model: Model, options: ReconcileResourceOptions = {}): {
  model: Model; ambiguities: RouteAmbiguity[]; issues: ArchitectureFinding[]
} {
  const id = options.idFactory ?? newId, issues: ArchitectureFinding[] = [], ambiguities: RouteAmbiguity[] = []
  const producers = systemResourceProducers(model), allModes = model.modes.map(mode => mode.id)
  const ownerMap = new Map<string, typeof producers>()
  for (const producer of producers) ownerMap.set(producer.resourceId, [...(ownerMap.get(producer.resourceId) ?? []), producer])
  const desired = new Map<string, { resource: SystemResource; source: ResourceTransferEndpoint; target: Extract<ResourceTransferEndpoint, { kind: 'function' }>; mode_ids: string[]; sameBlock: boolean; ioPort?: string; sourcePort?: string }>()
  for (const instance of model.instances) for (const fn of effectiveSystemFunctions(model, instance.id)) for (const io of fn.definition?.io ?? []) {
    if (io.direction !== 'input' || !io.resource_id) continue
    const owners = ownerMap.get(io.resource_id) ?? [], resource = model.resources.find(item => item.id === io.resource_id)
    const finding = (code: string, message: string) => issues.push({ step: 3, code, message, record_id: fn.id, field: 'definition.io', instance_id: instance.id })
    if (!resource || owners.length !== 1) { finding(owners.length > 1 ? 'multiple_resource_producers' : 'missing_resource_producer', 'Choose an input resource with exactly one producer.'); continue }
    const owner = owners[0], source = owner.endpoint
    if (source.kind === 'function' && source.instance_id === instance.id && source.function_id === fn.id) { finding('self_function_input', 'A function cannot consume its own output.'); continue }
    const requiredModes = allModes.filter(mode => active(instance.mode_ids, mode) && active(fn.mode_ids, mode))
    const sharedModes = requiredModes.filter(mode => owner.modeIds.includes(mode))
    if (allModes.length && !sharedModes.length) { finding('unpaired_function_io', 'The producer and consumer have no common operating mode.'); continue }
    if (requiredModes.some(mode => !owner.modeIds.includes(mode))) finding('unpaired_function_io', 'The producer does not cover every operating mode of this input.')
    if (resource.category === 'state') { finding('incompatible_transfer_resource', 'A maintained condition is not a resource flow.'); continue }
    desired.set(functionInputKey(instance.id, fn.id, io.id), { resource, source,
      target: { kind: 'function', instance_id: instance.id, function_id: fn.id, io_id: io.id },
      mode_ids: sharedModes.length === allModes.length ? [] : sharedModes,
      sameBlock: source.kind === 'function' && source.instance_id === instance.id, ioPort: io.port_id,
      sourcePort: source.kind === 'function' ? effectiveSystemFunctions(model, source.instance_id).find(fn => fn.id === source.function_id)?.definition?.io.find(io => io.id === source.io_id)?.port_id : source.port_id })
  }
  // Retain physical relations and external sinks. Function inputs own their corresponding transfers.
  let interfaces: SystemInterface[] = model.interfaces.map(edge => ({ ...edge, transfers: (edge.transfers ?? []).filter(transfer => {
    if (transfer.kind !== 'flow' || transfer.target.kind !== 'function') return true
    const item = desired.get(functionInputKey(transfer.target.instance_id, transfer.target.function_id, transfer.target.io_id))
    return item && !item.sameBlock && transfer.resource_id === item.resource.id && transferEndpointKey(transfer.source) === transferEndpointKey(item.source)
  }) }))
  const dependencies = new Map<string, { source: { instance_id: string; function_id: string }; target: { instance_id: string; function_id: string }; mode_ids: string[] }>()
  for (const [inputKey, item] of desired) {
    if (item.source.kind === 'function') {
      const source = { instance_id: item.source.instance_id, function_id: item.source.function_id }
      const target = { instance_id: item.target.instance_id, function_id: item.target.function_id }
      const key = JSON.stringify([source, target]), previous = dependencies.get(key)
      dependencies.set(key, { source, target, mode_ids: previous && (!previous.mode_ids.length || !item.mode_ids.length) ? []
        : [...new Set([...(previous?.mode_ids ?? []), ...item.mode_ids])].sort() })
    }
    if (item.sameBlock) continue
    const compatible = (edge: SystemInterface) => edge.interface_type === item.resource.category
      && (belongs(item.source, edge.source) && belongs(item.target, edge.target)
        || edge.directionality !== 'directed' && belongs(item.source, edge.target) && belongs(item.target, edge.source))
      && (!item.sourcePort || !(belongs(item.source, edge.source) ? edge.source.port_id : edge.target.port_id)
        || (belongs(item.source, edge.source) ? edge.source.port_id : edge.target.port_id) === item.sourcePort)
      && (!item.ioPort || !(belongs(item.target, edge.target) ? edge.target.port_id : edge.source.port_id)
        || (belongs(item.target, edge.target) ? edge.target.port_id : edge.source.port_id) === item.ioPort)
      && (edge.generated || (item.mode_ids.length ? item.mode_ids : allModes).every(mode => active(edge.mode_ids, mode)))
    const candidates = interfaces.filter(compatible)
    const existing = candidates.filter(edge => edge.transfers?.some(transfer => transfer.kind === 'flow' && transfer.resource_id === item.resource.id
      && transferEndpointKey(transfer.source) === transferEndpointKey(item.source) && transferEndpointKey(transfer.target) === transferEndpointKey(item.target)))
    const selectedId = options.routeSelections?.[inputKey]
    let selected = selectedId ? candidates.find(edge => edge.id === selectedId) : existing.length === 1 ? existing[0] : candidates.length === 1 ? candidates[0] : undefined
    if (!selected && candidates.length > 1) {
      ambiguities.push({ inputKey, instanceId: item.target.instance_id, functionId: item.target.function_id, ioId: item.target.io_id, interfaceIds: candidates.map(edge => edge.id).sort() })
      continue
    }
    if (!selected) {
      selected = { id: id(), name: item.resource.name, interface_type: item.resource.category as SystemInterface['interface_type'], source: { ...blockEndpoint(item.source), ...(item.sourcePort ? { port_id: item.sourcePort } : {}) },
        target: { ...blockEndpoint(item.target), ...(item.ioPort ? { port_id: item.ioPort } : {}) }, directionality: 'directed', linkage: 'direct', interface_detail: '',
        flow_description: '', operating_condition: '', source_function_ids: [], target_function_ids: [], mode_ids: item.mode_ids,
        transfers: [], generated: true }
      interfaces.push(selected)
    }
    const prior = selected.transfers?.find(transfer => transfer.kind === 'flow' && transferEndpointKey(transfer.source) === transferEndpointKey(item.source)
      && transferEndpointKey(transfer.target) === transferEndpointKey(item.target))
    const transfer: ResourceTransfer = { id: prior?.id ?? id(), kind: 'flow', resource_id: item.resource.id, source: item.source, target: item.target, mode_ids: item.mode_ids }
    interfaces = interfaces.map(edge => ({ ...edge, transfers: [
      ...(edge.transfers ?? []).filter(value => value.kind !== 'flow' || transferEndpointKey(value.target) !== transferEndpointKey(item.target)),
      ...(edge.id === selected!.id ? [transfer] : []),
    ] }))
  }
  interfaces = interfaces.filter(edge => !edge.generated || edge.transfers?.length).map(edge => !edge.generated ? edge : { ...edge,
    mode_ids: edge.transfers?.some(transfer => !transfer.mode_ids.length) ? [] : [...new Set(edge.transfers?.flatMap(transfer => transfer.mode_ids) ?? [])].sort(),
  })
  const generatedDependencies = [...dependencies.values()].filter(dependency => !model.function_links.some(link => !link.generated
    && link.relationship === 'provides_input' && same(link.source, dependency.source) && same(link.target, dependency.target)))
  let function_links = model.function_links.flatMap(link => {
    if (!link.generated || link.relationship !== 'provides_input') return [link]
    const dependency = generatedDependencies.find(item => same(link.source, item.source) && same(link.target, item.target))
    return dependency ? [{ ...link, ...dependency }] : []
  })
  for (const dependency of generatedDependencies) {
    if (function_links.some(link => link.relationship === 'provides_input' && same(link.source, dependency.source) && same(link.target, dependency.target))) continue
    function_links.push({ ...dependency, id: id(), relationship: 'provides_input', rationale: '', generated: true })
  }
  // Infer a parent allocation only once and only if the entire child mode range has one candidate.
  for (const instance of model.instances) if (instance.parent_instance_id) for (const fn of effectiveSystemFunctions(model, instance.id)) {
    if (function_links.some(link => link.relationship === 'decomposes_to' && link.target.instance_id === instance.id && link.target.function_id === fn.id)) continue
    const childModes = allModes.filter(mode => active(instance.mode_ids, mode) && active(fn.mode_ids, mode))
    const parent = model.instances.find(item => item.id === instance.parent_instance_id)
    const candidates = effectiveSystemFunctions(model, instance.parent_instance_id).filter(candidate => candidate.definition?.action?.trim()
      && childModes.every(mode => active(candidate.mode_ids, mode) && active(parent?.mode_ids, mode)))
    if (candidates.length === 1) function_links.push({ id: id(), source: { instance_id: instance.parent_instance_id, function_id: candidates[0].id },
      target: { instance_id: instance.id, function_id: fn.id }, relationship: 'decomposes_to', rationale: '', mode_ids: fn.mode_ids })
  }
  const next = syncGeneratedDescriptions({ ...model, interfaces, function_links })
  return { model: same(next, model) ? model : next, ambiguities, issues }
}

/** Read-only projection for UI hints; never allocates durable IDs during rendering. */
export function inspectFunctionResourceConnections(model: Model): { ambiguities: RouteAmbiguity[]; issues: ArchitectureFinding[] } {
  let sequence = 0
  const { ambiguities, issues } = reconcileFunctionResources(model, { idFactory: () => `preview:${sequence++}` })
  return { ambiguities, issues }
}

function clearInput(model: Model, endpoint: ResourceTransferEndpoint): Model {
  if (endpoint.kind !== 'function') return model
  const instance = model.instances.find(item => item.id === endpoint.instance_id)
  if (!instance) return model
  const fn = effectiveSystemFunctions(model, instance.id).find(item => item.id === endpoint.function_id)
  if (!fn?.definition?.io.some(io => io.id === endpoint.io_id && io.direction === 'input')) return model
  return { ...model, instances: model.instances.map(item => item.id !== instance.id ? item : { ...item, function_overrides: [
    ...item.function_overrides.filter(value => value.function_id !== endpoint.function_id),
    { ...(item.function_overrides.find(value => value.function_id === endpoint.function_id) ?? { function_id: endpoint.function_id, enabled: true }),
      resource_bindings: { ...item.function_overrides.find(value => value.function_id === endpoint.function_id)?.resource_bindings, [endpoint.io_id]: '' } },
  ] }) }
}
export function disconnectResourceTransfer(model: Model, interfaceId: string, transferId: string): Model {
  const transfer = model.interfaces.find(edge => edge.id === interfaceId)?.transfers?.find(item => item.id === transferId)
  const next = transfer?.kind === 'flow' ? clearInput(model, transfer.target) : model
  return reconcileFunctionResources({ ...next, interfaces: next.interfaces.map(edge => edge.id === interfaceId
    ? { ...edge, transfers: edge.transfers?.filter(item => item.id !== transferId) } : edge) }).model
}
export function disconnectInterface(model: Model, interfaceId: string): Model {
  let next = model
  for (const transfer of model.interfaces.find(edge => edge.id === interfaceId)?.transfers ?? []) if (transfer.kind === 'flow') next = clearInput(next, transfer.target)
  return reconcileFunctionResources({ ...next, interfaces: next.interfaces.filter(edge => edge.id !== interfaceId) }).model
}

/** Fresh outputs for installed/copied occurrences. Internal consumers remap; incoming sources remain exact. */
export function isolateInstalledOutputs(model: Model, instanceIds: string[], idFactory: IdFactory = newId): Model {
  const selected = new Set(instanceIds), resources = [...model.resources]
  const bindings = new Map<string, Record<string, string>>(), remap = new Map<string, string[]>()
  for (const instance of model.instances) if (selected.has(instance.id)) for (const fn of effectiveSystemFunctions(model, instance.id)) {
    const mapping: Record<string, string> = {}
    for (const io of fn.definition?.io ?? []) if (io.direction === 'output' && io.resource_id) {
      const resource = model.resources.find(item => item.id === io.resource_id)
      if (!resource) continue
      const fresh = idFactory(); resources.push({ ...resource, id: fresh }); mapping[io.id] = fresh
      remap.set(resource.id, [...(remap.get(resource.id) ?? []), fresh])
    }
    bindings.set(fnKey(instance.id, fn.id), mapping)
  }
  return { ...model, resources, instances: model.instances.map(instance => !selected.has(instance.id) ? instance : {
    ...instance, function_overrides: [...instance.function_overrides.filter(override => !bindings.has(fnKey(instance.id, override.function_id))),
      ...effectiveSystemFunctions(model, instance.id).map(fn => {
        const previous = instance.function_overrides.find(item => item.function_id === fn.id), mapping = bindings.get(fnKey(instance.id, fn.id)) ?? {}
        for (const io of fn.definition?.io ?? []) if (io.direction === 'input' && remap.get(io.resource_id)?.length === 1) mapping[io.id] = remap.get(io.resource_id)![0]
        return { ...(previous ?? { function_id: fn.id, enabled: true }), resource_bindings: { ...previous?.resource_bindings, ...mapping } }
      }),
    ],
  }) }
}
