import type { ResourceTransferEndpoint, SystemDefinitionModel, SystemEndpoint, SystemFunction, SystemResource } from '../api/systemDefinition'
import { effectiveSystemFunctions, structuredFunctionStatement, systemResourceProducers, transferEndpointKey } from './systemArchitecture'

export interface FunctionTraceRef {
  instanceId: string; functionId: string; blockPath: string; functionLabel: string
}
export interface TraceStep {
  kind: 'resource'|'support'; from: FunctionTraceRef; to: FunctionTraceRef
  resourceId?: string; resourceName?: string; interfaceIds: string[]
}
export interface InputConsumerTrace extends FunctionTraceRef {
  ioId: string; interfaceIds: string[]; transferIds: string[]; modeIds: string[]
  steps: TraceStep[]; witnesses: { modeIds: string[]; steps: TraceStep[]; interfaceIds: string[]; transferIds: string[] }[]
}
export interface InheritedResource {
  resource: SystemResource; producer: ResourceTransferEndpoint
  supplierLabel: string; supplierPath: string; supplierFunctionLabel: string
  modeIds: string[]; consumers: InputConsumerTrace[]
}
export interface InputConnectionIssue extends FunctionTraceRef {
  kind: 'missing_resource'|'missing_producer'|'ambiguous_producer'|'inactive_producer'|'missing_route'|'ambiguous_route'|'incompatible_route'|'self_input'
  ioId: string; resourceId?: string; resourceName: string; message: string; modeIds: string[]
}
export interface FunctionInputProjection {
  directInputCount: number; inheritedInputs: InheritedResource[]; sharedDirectInputs: InheritedResource[]
  unresolvedInputs: InputConnectionIssue[]; activeModeIds: string[]; inactive: boolean
}
export interface InheritedInputProjection {
  functions: Record<string, FunctionInputProjection>
  /** Descendant context unallocated to every selected-block function in each reported mode. */
  unallocatedInputs: InheritedResource[]; unresolvedInputs: InputConnectionIssue[]
}
export interface InputSupplier {
  supplierLabel: string; resourceName: string; resourceId: string
  producer: ResourceTransferEndpoint; modeIds: string[]
}

type Model = SystemDefinitionModel
type InstalledFunction = { fn: SystemFunction; ref: FunctionTraceRef }
type Route = { interfaceId: string; transferId: string; sourceKey: string }
type BoundaryInput = { resource: SystemResource; producer: ResourceTransferEndpoint; consumer: FunctionTraceRef; ioId: string; routes: Route[] }
const fnKey = (instanceId: string, functionId: string) => JSON.stringify([instanceId, functionId])
const inputKey = (ref: FunctionTraceRef, ioId: string) => JSON.stringify([ref.instanceId, ref.functionId, ioId])
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const sorted = (values: Iterable<string>) => [...new Set(values)].sort(compare)
const applies = (ids: string[]|undefined, mode: string) => !mode || !ids?.length || ids.includes(mode)
const modeIds = (mode: string) => mode ? [mode] : []
const routeKey = (target: ResourceTransferEndpoint, resourceId: string) => JSON.stringify([transferEndpointKey(target), resourceId])
const stepKey = (steps: TraceStep[]) => JSON.stringify(steps.map(step => [step.kind, step.from.instanceId, step.from.functionId,
  step.to.instanceId, step.to.functionId, step.resourceId ?? '', step.interfaceIds]))
const emptyFunction = (directInputCount = 0): FunctionInputProjection => ({ directInputCount, inheritedInputs: [], sharedDirectInputs: [],
  unresolvedInputs: [], activeModeIds: [], inactive: true })

/**
 * A read-only projection of confirmed inputs crossing an installed block's boundary.
 * Each mode is traversed separately. Breadth-first reachability stores one shortest
 * witness per consumer, so feedback loops cannot enumerate exponentially many paths.
 * Neither diagram visibility nor generic causal/physical relations establish inputs.
 */
function projectInputRequirements(model: Model, options: { instanceId: string; modeId?: string }, supplierFunctionId?: string): {
  projection: InheritedInputProjection; suppliers: Record<string, InputSupplier[]>
} {
  const instances = new Map(model.instances.map(item => [item.id, item]))
  const definitions = new Map(model.definitions.map(item => [item.id, item]))
  const resources = new Map(model.resources.map(item => [item.id, item]))
  const children = new Map<string, string[]>()
  for (const instance of model.instances) if (instance.parent_instance_id)
    children.set(instance.parent_instance_id, [...children.get(instance.parent_instance_id) ?? [], instance.id])
  const subtree = new Set<string>(), pending = [options.instanceId]
  for (let i = 0; i < pending.length; i++) {
    const id = pending[i]
    if (subtree.has(id) || !instances.has(id)) continue
    subtree.add(id); pending.push(...children.get(id) ?? [])
  }
  const paths = new Map<string, string>()
  const path = (id: string) => {
    if (paths.has(id)) return paths.get(id)!
    const labels: string[] = [], seen = new Set<string>()
    let current = instances.get(id)
    while (current && !seen.has(current.id)) {
      labels.unshift(current.name || current.id); seen.add(current.id)
      current = current.parent_instance_id ? instances.get(current.parent_instance_id) : undefined
    }
    const result = labels.join(' › ') || id; paths.set(id, result); return result
  }
  const functions = new Map<string, InstalledFunction>()
  for (const instance of model.instances) for (const fn of effectiveSystemFunctions(model, instance.id)) functions.set(fnKey(instance.id, fn.id), { fn,
    ref: { instanceId: instance.id, functionId: fn.id, blockPath: path(instance.id),
      functionLabel: structuredFunctionStatement(fn.definition, model.resources) || fn.description || fn.id } })
  const roots = [...functions.values()].filter(item => item.ref.instanceId === options.instanceId).sort((a, b) => compare(a.fn.id, b.fn.id))
  const result: InheritedInputProjection = { functions: Object.fromEntries(roots.map(item => [item.fn.id,
    emptyFunction(item.fn.definition?.io.filter(io => io.direction === 'input').length ?? 0)])), unallocatedInputs: [], unresolvedInputs: [] }
  const supplierFunction = roots.find(item => item.fn.id === supplierFunctionId)
  const suppliers: Record<string, InputSupplier[]> = Object.fromEntries((supplierFunction?.fn.definition?.io ?? [])
    .filter(io => io.direction === 'input').map(io => [io.id, []]))
  const producers = new Map<string, ReturnType<typeof systemResourceProducers>>()
  for (const producer of systemResourceProducers(model)) producers.set(producer.resourceId, [...producers.get(producer.resourceId) ?? [], producer])
  const modes = options.modeId ? (model.modes.some(mode => mode.id === options.modeId) || !model.modes.length ? [options.modeId] : [])
    : model.modes.length ? sorted(model.modes.map(mode => mode.id)) : ['']

  const addIssue = (issues: InputConnectionIssue[], issue: InputConnectionIssue) => {
    const previous = issues.find(item => inputKey(item, item.ioId) === inputKey(issue, issue.ioId) && item.kind === issue.kind)
    if (previous) previous.modeIds = sorted([...previous.modeIds, ...issue.modeIds])
    else issues.push({ ...issue, modeIds: [...issue.modeIds] })
  }
  const addInput = (rows: InheritedResource[], input: BoundaryInput, mode: string, steps: TraceStep[]) => {
    let row = rows.find(item => item.resource.id === input.resource.id)
    if (!row) {
      const end = input.producer
      const external = end.kind === 'external' ? model.externals.find(item => item.id === end.external_id) : undefined
      row = { resource: input.resource, producer: end,
        supplierLabel: end.kind === 'function' ? instances.get(end.instance_id)?.name || end.instance_id : external?.name || end.external_id,
        supplierPath: end.kind === 'function' ? path(end.instance_id) : external?.name || end.external_id,
        supplierFunctionLabel: end.kind === 'function' ? functions.get(fnKey(end.instance_id, end.function_id))?.ref.functionLabel || end.function_id
          : external?.ports?.find(port => port.id === end.port_id)?.name || end.port_id,
        modeIds: [], consumers: [] }
      rows.push(row)
    }
    row.modeIds = sorted([...row.modeIds, ...modeIds(mode)])
    const key = inputKey(input.consumer, input.ioId)
    let consumer = row.consumers.find(item => inputKey(item, item.ioId) === key)
    if (!consumer) {
      consumer = { ...input.consumer, ioId: input.ioId, interfaceIds: [], transferIds: [], modeIds: [], steps, witnesses: [] }
      row.consumers.push(consumer)
    }
    const interfaceIds = sorted(input.routes.map(route => route.interfaceId)), transferIds = sorted(input.routes.map(route => route.transferId))
    consumer.interfaceIds = sorted([...consumer.interfaceIds, ...interfaceIds])
    consumer.transferIds = sorted([...consumer.transferIds, ...transferIds])
    consumer.modeIds = sorted([...consumer.modeIds, ...modeIds(mode)])
    const witness = consumer.witnesses.find(item => stepKey(item.steps) === stepKey(steps)
      && JSON.stringify(item.interfaceIds) === JSON.stringify(interfaceIds) && JSON.stringify(item.transferIds) === JSON.stringify(transferIds))
    if (witness) witness.modeIds = sorted([...witness.modeIds, ...modeIds(mode)])
    else consumer.witnesses.push({ modeIds: modeIds(mode), steps, interfaceIds, transferIds })
    if (steps.length < consumer.steps.length || steps.length === consumer.steps.length && compare(stepKey(steps), stepKey(consumer.steps)) < 0) consumer.steps = steps
  }

  for (const mode of modes) {
    const active = new Map([...functions].filter(([, item]) => applies(instances.get(item.ref.instanceId)?.mode_ids, mode) && applies(item.fn.mode_ids, mode)))
    const routes = new Map<string, Route[]>(), incompatible = new Set<string>()
    const belongs = (end: ResourceTransferEndpoint, endpoint: SystemEndpoint) => end.kind === 'function'
      ? end.instance_id === endpoint.instance_id
      : end.external_id === endpoint.external_id && (!endpoint.port_id || endpoint.port_id === end.port_id)
    const validTerminal = (end: ResourceTransferEndpoint, endpoint: SystemEndpoint, resource: SystemResource, direction: 'input'|'output') => {
      if (end.kind === 'external') {
        const port = model.externals.find(item => item.id === end.external_id)?.ports?.find(item => item.id === end.port_id)
        return Boolean(port && port.resource_id === resource.id && port.interface_type === resource.category
          && (port.direction === direction || port.direction === 'bidirectional'))
      }
      const item = active.get(fnKey(end.instance_id, end.function_id))
      const io = item?.fn.definition?.io.find(item => item.id === end.io_id)
      if (!io || io.direction !== direction || io.resource_id !== resource.id) return false
      const ports = definitions.get(instances.get(end.instance_id)?.definition_id ?? '')?.ports ?? []
      if (io.port_id && endpoint.port_id && io.port_id !== endpoint.port_id) return false
      return [io.port_id, endpoint.port_id].every(id => !id || ports.some(port => port.id === id && port.interface_type === resource.category
        && (port.direction === direction || port.direction === 'bidirectional')))
    }
    for (const edge of model.interfaces) {
      if (!applies(edge.mode_ids, mode)) continue
      for (const transfer of edge.transfers ?? []) {
        if (transfer.kind !== 'flow' || !applies(transfer.mode_ids, mode)) continue
        const key = routeKey(transfer.target, transfer.resource_id), resource = resources.get(transfer.resource_id)
        let ends: [SystemEndpoint, SystemEndpoint]|undefined
        if (belongs(transfer.source, edge.source) && belongs(transfer.target, edge.target)) ends = [edge.source, edge.target]
        else if (edge.directionality !== 'directed' && belongs(transfer.source, edge.target) && belongs(transfer.target, edge.source)) ends = [edge.target, edge.source]
        if (!resource || !ends || resource.category !== edge.interface_type
          || !validTerminal(transfer.source, ends[0], resource, 'output') || !validTerminal(transfer.target, ends[1], resource, 'input')) {
          incompatible.add(key); continue
        }
        routes.set(key, [...routes.get(key) ?? [], { interfaceId: edge.id, transferId: transfer.id, sourceKey: transferEndpointKey(transfer.source) }])
      }
    }
    const adjacency = new Map<string, TraceStep[]>(), boundary = new Map<string, BoundaryInput[]>(), issues = new Map<string, InputConnectionIssue[]>()
    const resolvedInputs = new Map<string, BoundaryInput>()
    const addStep = (from: string, step: TraceStep) => adjacency.set(from, [...adjacency.get(from) ?? [], step])
    for (const [key, item] of active) {
      if (!subtree.has(item.ref.instanceId)) continue
      for (const io of item.fn.definition?.io ?? []) {
        if (io.direction !== 'input') continue
        const resource = resources.get(io.resource_id), owners = producers.get(io.resource_id) ?? []
        const issue = (kind: InputConnectionIssue['kind'], message: string) => issues.set(key, [...issues.get(key) ?? [], { ...item.ref,
          kind, ioId: io.id, resourceId: io.resource_id || undefined, resourceName: resource?.name || io.resource_id || 'Unassigned resource', message, modeIds: modeIds(mode) }])
        if (!resource) { issue('missing_resource', 'Choose an existing resource for this child input.'); continue }
        if (owners.length !== 1) { issue(owners.length ? 'ambiguous_producer' : 'missing_producer', owners.length
          ? 'This resource has more than one producer; its upstream connection is unresolved.' : 'This resource has no available producer.'); continue }
        const producer = owners[0].endpoint
        const producerKey = producer.kind === 'function' ? fnKey(producer.instance_id, producer.function_id) : undefined
        if (producerKey && !active.has(producerKey)) { issue('inactive_producer', 'The producer is not active in this operating mode.'); continue }
        if (producerKey === key) { issue('self_input', 'A function cannot consume its own output as an upstream input.'); continue }
        const target: ResourceTransferEndpoint = { kind: 'function', instance_id: item.ref.instanceId, function_id: item.fn.id, io_id: io.id }
        const sameBlock = producer.kind === 'function' && producer.instance_id === item.ref.instanceId
        const routeId = routeKey(target, resource.id)
        const confirmed = (routes.get(routeId) ?? []).filter(route => route.sourceKey === transferEndpointKey(producer))
        if (!sameBlock && !confirmed.length) { issue(incompatible.has(routeId) ? 'incompatible_route' : 'missing_route', incompatible.has(routeId)
          ? 'The interface does not contain a compatible directed resource transfer for this input.' : 'No active interface transfer confirms this input connection.'); continue }
        if (!sameBlock && new Set(confirmed.map(route => route.interfaceId)).size > 1) {
          issue('ambiguous_route', 'More than one active interface routes this input; select its intended connection.'); continue
        }
        resolvedInputs.set(inputKey(item.ref, io.id), { resource, producer, consumer: item.ref, ioId: io.id, routes: confirmed })
        if (producer.kind === 'function' && subtree.has(producer.instance_id)) {
          addStep(key, { kind: 'resource', from: item.ref, to: active.get(producerKey!)!.ref, resourceId: resource.id,
            resourceName: resource.name, interfaceIds: sorted(confirmed.map(route => route.interfaceId)) })
        } else if (item.ref.instanceId !== options.instanceId) boundary.set(key, [...boundary.get(key) ?? [], {
          resource, producer, consumer: item.ref, ioId: io.id, routes: confirmed }])
      }
    }
    if (supplierFunctionId !== undefined) {
      const selectedKey = fnKey(options.instanceId, supplierFunctionId)
      if (supplierFunction && active.has(selectedKey)) for (const io of supplierFunction.fn.definition?.io ?? []) {
        if (io.direction !== 'input') continue
        const first = resolvedInputs.get(inputKey(supplierFunction.ref, io.id))
        if (!first) continue
        const queue = [first], visited = new Set([selectedKey])
        for (let index = 0; index < queue.length; index++) {
          const input = queue[index], producer = input.producer
          if (producer.kind === 'external' || !subtree.has(producer.instance_id)) {
            const existing = suppliers[io.id].find(item => item.resourceId === input.resource.id)
            if (existing) existing.modeIds = sorted([...existing.modeIds, ...modeIds(mode)])
            else suppliers[io.id].push({ supplierLabel: producer.kind === 'function'
              ? instances.get(producer.instance_id)?.name || producer.instance_id
              : model.externals.find(item => item.id === producer.external_id)?.name || producer.external_id,
            resourceId: input.resource.id, resourceName: input.resource.name, producer, modeIds: modeIds(mode) })
            continue
          }
          const key = fnKey(producer.instance_id, producer.function_id)
          if (visited.has(key)) continue
          visited.add(key)
          const upstream = active.get(key)
          for (const inputIo of upstream?.fn.definition?.io ?? []) {
            if (inputIo.direction !== 'input') continue
            const resolved = resolvedInputs.get(inputKey(upstream!.ref, inputIo.id))
            if (resolved) queue.push(resolved)
          }
        }
      }
      continue
    }
    for (const link of model.function_links) {
      if (link.relationship !== 'decomposes_to' || !applies(link.mode_ids, mode)
        || instances.get(link.target.instance_id)?.parent_instance_id !== link.source.instance_id
        || !subtree.has(link.source.instance_id) || !subtree.has(link.target.instance_id)) continue
      const parentKey = fnKey(link.source.instance_id, link.source.function_id), childKey = fnKey(link.target.instance_id, link.target.function_id)
      const parent = active.get(parentKey), child = active.get(childKey)
      if (parent && child) addStep(parentKey, { kind: 'support', from: parent.ref, to: child.ref, interfaceIds: [] })
    }
    for (const [key, steps] of adjacency) adjacency.set(key, steps.sort((a, b) => compare(stepKey([a]), stepKey([b]))))
    const allocated = new Set<string>(), reachedFunctions = new Set<string>()
    for (const root of roots) {
      const rootKey = fnKey(root.ref.instanceId, root.fn.id), projection = result.functions[root.fn.id]
      if (!active.has(rootKey)) continue
      projection.inactive = false; projection.activeModeIds = sorted([...projection.activeModeIds, ...modeIds(mode)])
      const directIds = new Set(root.fn.definition?.io.filter(io => io.direction === 'input').map(io => io.resource_id))
      const witnesses = new Map<string, TraceStep[]>([[rootKey, []]]), queue = [rootKey]
      for (let index = 0; index < queue.length; index++) {
        const key = queue[index], steps = witnesses.get(key)!
        reachedFunctions.add(key)
        for (const input of boundary.get(key) ?? []) {
          allocated.add(inputKey(input.consumer, input.ioId))
          addInput(directIds.has(input.resource.id) ? projection.sharedDirectInputs : projection.inheritedInputs, input, mode, steps)
        }
        if (active.get(key)!.ref.instanceId !== options.instanceId) for (const issue of issues.get(key) ?? []) addIssue(projection.unresolvedInputs, issue)
        for (const step of adjacency.get(key) ?? []) {
          const next = fnKey(step.to.instanceId, step.to.functionId)
          if (witnesses.has(next)) continue
          witnesses.set(next, [...steps, step]); queue.push(next)
        }
      }
    }
    for (const inputs of boundary.values()) for (const input of inputs) if (!allocated.has(inputKey(input.consumer, input.ioId)))
      addInput(result.unallocatedInputs, input, mode, [])
    for (const [key, items] of issues) if (!reachedFunctions.has(key)) for (const issue of items)
      if (issue.instanceId !== options.instanceId) addIssue(result.unresolvedInputs, issue)
  }
  const finishRows = (rows: InheritedResource[]) => {
    rows.sort((a, b) => compare(a.resource.name, b.resource.name) || compare(a.resource.id, b.resource.id))
    for (const row of rows) {
      row.consumers.sort((a, b) => compare(inputKey(a, a.ioId), inputKey(b, b.ioId)))
      for (const consumer of row.consumers) consumer.witnesses.sort((a, b) => a.steps.length - b.steps.length || compare(stepKey(a.steps), stepKey(b.steps))
        || compare(JSON.stringify(a.interfaceIds), JSON.stringify(b.interfaceIds)) || compare(JSON.stringify(a.transferIds), JSON.stringify(b.transferIds)))
    }
  }
  const finishIssues = (issues: InputConnectionIssue[]) => issues.sort((a, b) => compare(inputKey(a, a.ioId), inputKey(b, b.ioId)) || compare(a.kind, b.kind))
  for (const projection of Object.values(result.functions)) {
    finishRows(projection.inheritedInputs); finishRows(projection.sharedDirectInputs); finishIssues(projection.unresolvedInputs)
  }
  finishRows(result.unallocatedInputs); finishIssues(result.unresolvedInputs)
  for (const rows of Object.values(suppliers)) rows.sort((a, b) => compare(a.supplierLabel, b.supplierLabel)
    || compare(a.resourceName, b.resourceName) || compare(a.resourceId, b.resourceId))
  return { projection: result, suppliers }
}

export function projectInheritedInputs(model: Model, options: { instanceId: string; modeId?: string }): InheritedInputProjection {
  return projectInputRequirements(model, options).projection
}

export function projectFunctionInheritedInputs(model: Model, options: { instanceId: string; functionId: string; modeId?: string }): FunctionInputProjection {
  return projectInheritedInputs(model, options).functions[options.functionId] ?? emptyFunction()
}

/**
 * Compact supplier context for each authored input, independently of sibling inputs.
 * Follow only confirmed upstream IO from that exact input, never broad child support
 * allocations. Stop at the selected installed block boundary and at the consuming
 * function in feedback loops. All modes are evaluated independently before unioning.
 */
export function projectFunctionInputSuppliers(model: Model, options: { instanceId: string; functionId: string; modeId?: string }): Record<string, InputSupplier[]> {
  if (!options.functionId) return {}
  return projectInputRequirements(model, options, options.functionId).suppliers
}
