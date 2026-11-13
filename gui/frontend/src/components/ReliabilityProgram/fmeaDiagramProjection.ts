import type { AIAGVDAFMEAAnalysis, FMEABlockDiagram, FMEABlockDiagramNode } from '../../api/reliabilityProgram'
import type { SystemDefinitionModel, SystemEndpoint } from '../../api/systemDefinition'
import { hierarchyIndex, projectHierarchicalNodes } from '../shared/hierarchicalDiagram'
import { interfaceResourceFlowProjector, type DiagramResourceFlow } from '../shared/interfaceResourceFlows'

const pathIndexes = new WeakMap<SystemDefinitionModel, {
  instances: Map<string, SystemDefinitionModel['instances'][number]>
  definitions: Map<string, SystemDefinitionModel['definitions'][number]>
  paths: Map<string, string>
}>()

export function installedPath(model: SystemDefinitionModel, instanceId: string): string {
  let index = pathIndexes.get(model)
  if (!index) {
    index = { instances: new Map(model.instances.map(item => [item.id, item])),
      definitions: new Map(model.definitions.map(item => [item.id, item])), paths: new Map() }
    pathIndexes.set(model, index)
  }
  const cached = index.paths.get(instanceId)
  if (cached) return cached
  const { instances, definitions } = index
  const labels: string[] = [], visited = new Set<string>()
  let item = instances.get(instanceId)
  while (item && !visited.has(item.id)) {
    visited.add(item.id)
    labels.unshift(item.name || definitions.get(item.definition_id)?.name || item.id)
    item = item.parent_instance_id ? instances.get(item.parent_instance_id) : undefined
  }
  const path = labels.join(' › ')
  index.paths.set(instanceId, path)
  return path
}

export function instanceSubtree(model: SystemDefinitionModel, rootId: string): Set<string> {
  const children = new Map<string, string[]>()
  for (const item of model.instances) if (item.parent_instance_id) {
    const siblings = children.get(item.parent_instance_id)
    if (siblings) siblings.push(item.id)
    else children.set(item.parent_instance_id, [item.id])
  }
  const result = new Set<string>(), pending = [rootId]
  while (pending.length) {
    const id = pending.pop()!
    if (result.has(id)) continue
    result.add(id); pending.push(...(children.get(id) ?? []))
  }
  return result
}

export interface FmeaDiagramViewState {
  expandedByNodeId?: Record<string, boolean>
  viewport?: FMEABlockDiagram['viewport']
}

export interface FmeaDiagramProjection {
  analysis: AIAGVDAFMEAAnalysis
  interfaceEndpoints: Record<string, { source: string; target: string }>
  interfaceDescriptions: Record<string, string>
  interfaceResourceIds: Record<string, string[]>
  interfaceResourceFlows: Record<string, DiagramResourceFlow[]>
  hiddenStructureIds: Set<string>
  instanceIdByStructureId: Map<string, string>
  implicitRootStructureId?: string
  focused: boolean
  internalInterfaceCount: number
}

/** A focus is a filtered canonical hierarchy, never a separately laid-out graph. */
export function projectFmeaDiagram(model: SystemDefinitionModel, analysis: AIAGVDAFMEAAnalysis,
  focusInstanceId: string, view?: FmeaDiagramViewState): FmeaDiagramProjection {
  const index = hierarchyIndex(model.instances)
  const instances = new Map(model.instances.map(item => [item.id, item]))
  const definitions = new Map(model.definitions.map(item => [item.id, item]))
  const isPart = (id: string) => definitions.get(instances.get(id)?.definition_id ?? '')?.kind === 'piece_part'
  const instanceIdByStructureId = new Map<string, string>()
  for (const item of analysis.structure_nodes) {
    const ref = item.system_definition_ref
    if (ref?.system_model_id === model.id && ref.instance_id) instanceIdByStructureId.set(item.id, ref.instance_id)
  }
  const blocksByInstance = new Map(analysis.block_diagram.nodes.flatMap(item => {
    const id = instanceIdByStructureId.get(item.structure_node_id ?? '')
    return id ? [[id, item] as const] : []
  }))
  const blockById = new Map(analysis.block_diagram.nodes.map(item => [item.id, item]))
  const canonicalInterfaces = new Map(model.interfaces.map(item => [item.id, item]))
  const externalById = new Map(model.externals.flatMap(external => {
    const node = blockById.get(`SD-EXT-${external.id}`)
    return node ? [[external.id, node] as const] : []
  }))
  for (const item of analysis.interfaces) {
    const canonical = canonicalInterfaces.get(item.system_definition_ref?.interface_id ?? '')
    if (!canonical) continue
    for (const side of ['source', 'target'] as const) {
      const id = canonical[side].external_id, node = blockById.get(item[`${side}_block_id`] ?? '')
      if (id && node) externalById.set(id, node)
    }
  }
  const activeFocusId = focusInstanceId || analysis.system_binding?.scope_instance_id || ''
  const focus = blocksByInstance.get(activeFocusId)
  const focused = Boolean(focus && activeFocusId !== model.root_instance_id)
  const subtree = focused ? index.subtree(activeFocusId) : new Set<string>()
  const endpoints: FmeaDiagramProjection['interfaceEndpoints'] = {}, descriptions: Record<string, string> = {}
  const resourceIds: Record<string, string[]> = {}
  const resourceFlows: FmeaDiagramProjection['interfaceResourceFlows'] = {}
  const projectFlows = interfaceResourceFlowProjector(model, analysis.system_binding?.mode_id)
  const included = new Set<string>(), externalNodes = new Map<string, FMEABlockDiagramNode>()
  const expandedByNodeId = { ...view?.expandedByNodeId }
  const includePath = (id: string, includeDescendants = false) => {
    included.add(id)
    if (includeDescendants) index.subtree(id).forEach(child => included.add(child))
    for (const parent of index.ancestors(id)) {
      included.add(parent)
      const block = blocksByInstance.get(parent)
      if (block && parent !== model.root_instance_id && expandedByNodeId[block.id] === undefined)
        expandedByNodeId[block.id] = true
    }
  }
  if (focused) {
    includePath(activeFocusId, true)
    if (focus && expandedByNodeId[focus.id] === undefined) expandedByNodeId[focus.id] = false
  } else for (const id of blocksByInstance.keys()) included.add(id)
  const promoted = (endpoint: SystemEndpoint) => {
    if (endpoint.external_id) return externalById.get(endpoint.external_id)
    let id = endpoint.instance_id
    const visited = new Set<string>()
    while (id && isPart(id) && id !== activeFocusId && !visited.has(id)) {
      visited.add(id); id = instances.get(id)?.parent_instance_id
    }
    return id ? blocksByInstance.get(id) : undefined
  }
  const describe = (endpoint: SystemEndpoint) => endpoint.instance_id
    ? installedPath(model, endpoint.instance_id)
    : model.externals.find(item => item.id === endpoint.external_id)?.name || 'Unresolved external actor'
  let internalInterfaceCount = 0, rootEndpointRequired = false
  for (const item of analysis.interfaces) {
    const canonical = canonicalInterfaces.get(item.system_definition_ref?.interface_id ?? '')
    const mode = analysis.system_binding?.mode_id
    if (!canonical || (mode && canonical.mode_ids.length && !canonical.mode_ids.includes(mode))) continue
    const sourceInside = Boolean(canonical.source.instance_id && subtree.has(canonical.source.instance_id))
    const targetInside = Boolean(canonical.target.instance_id && subtree.has(canonical.target.instance_id))
    if (focused && sourceInside && targetInside) internalInterfaceCount++
    if (focused && sourceInside === targetInside) continue
    const source = promoted(canonical.source), target = promoted(canonical.target)
    if (!source || !target || source.id === target.id) continue
    for (const [endpoint, block] of [[canonical.source, source], [canonical.target, target]] as const) {
      const id = instanceIdByStructureId.get(block.structure_node_id ?? '')
      // Focus-side descendants remain inside the collapsed focus block. Counterparts
      // expose their real endpoint through the minimum necessary ancestor path.
      if (id && focused && !subtree.has(id)) includePath(id, true)
      if (endpoint.external_id) externalNodes.set(block.id, block)
      if (id === model.root_instance_id) rootEndpointRequired = true
    }
    endpoints[item.id] = { source: source.id, target: target.id }
    descriptions[item.id] = `Actual endpoints: ${describe(canonical.source)} ${item.directionality === 'directed' ? '→' : '↔'} ${describe(canonical.target)}. Collapsed containers summarize these endpoints.`
    resourceFlows[item.id] = projectFlows(canonical, endpoints[item.id])
    resourceIds[item.id] = [...new Set(resourceFlows[item.id].map(flow => flow.resourceId))]
  }
  const visible = [...blocksByInstance].filter(([id]) => included.has(id) && (!isPart(id) || id === activeFocusId))
    .map(([id, node]) => ({ ...node, container_parent_block_id: blocksByInstance.get(instances.get(id)?.parent_instance_id ?? '')?.id }))
  if (!focused) for (const node of analysis.block_diagram.nodes) if (node.kind === 'external') externalNodes.set(node.id, node)
  const rootBlock = blocksByInstance.get(model.root_instance_id ?? '')
  const nodes = projectHierarchicalNodes([...visible, ...externalNodes.values()], {
    rootBlockId: rootBlock?.id, rootEndpointRequired, expandedByNodeId,
  })
  const displayedStructures = new Set(nodes.flatMap(node => node.structure_node_id ? [node.structure_node_id] : []))
  const hiddenStructureIds = new Set(analysis.structure_nodes.filter(item => !displayedStructures.has(item.id)).map(item => item.id))
  return { analysis: { ...analysis, block_diagram: { ...analysis.block_diagram, nodes,
    viewport: view?.viewport ?? analysis.block_diagram.viewport } },
    interfaceEndpoints: endpoints, interfaceDescriptions: descriptions, interfaceResourceIds: resourceIds, interfaceResourceFlows: resourceFlows,
    hiddenStructureIds, instanceIdByStructureId, implicitRootStructureId: rootBlock?.structure_node_id,
    focused, internalInterfaceCount }
}

/** Filtered views share geometry, but do not own omission, collapse, or viewport state. */
export function mergeFmeaDiagramPatch(full: AIAGVDAFMEAAnalysis, projection: FmeaDiagramProjection,
  patch: Partial<AIAGVDAFMEAAnalysis>): Partial<AIAGVDAFMEAAnalysis> {
  const { block_diagram, ...semantic } = patch
  if (!block_diagram) return semantic
  const projected = new Map(projection.analysis.block_diagram.nodes.map(item => [item.id, item]))
  const edited = new Map(block_diagram.nodes.map(item => [item.id, item]))
  const nodes = full.block_diagram.nodes.map(item => {
    const changed = edited.get(item.id), before = projected.get(item.id)
    if (!changed || !before || item.structure_node_id === projection.implicitRootStructureId) return item
    return { ...item,
      ...(changed.x !== before.x ? { x: changed.x } : {}),
      ...(changed.y !== before.y ? { y: changed.y } : {}),
      ...(changed.width !== before.width ? { width: changed.width } : {}),
      ...(changed.height !== before.height ? { height: changed.height } : {}),
      ...(item.kind === 'external' ? { label: changed.label, external_kind: changed.external_kind } : {}),
    }
  })
  const originalIds = new Set(full.block_diagram.nodes.map(item => item.id))
  nodes.push(...block_diagram.nodes.filter(item => !originalIds.has(item.id)))
  const next = { ...full.block_diagram, nodes, density: block_diagram.density,
    layoutOptions: block_diagram.layoutOptions, connectorStyle: block_diagram.connectorStyle,
    snap_to_grid: block_diagram.snap_to_grid }
  return JSON.stringify(next) === JSON.stringify(full.block_diagram) ? semantic : { ...semantic, block_diagram: next }
}
