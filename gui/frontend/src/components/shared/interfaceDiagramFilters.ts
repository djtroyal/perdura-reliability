import type { FMEABlockDiagramNode, FMEAInterface } from '../../api/reliabilityProgram'

export const INTERFACE_TYPE_OPTIONS = [
  { value: 'physical', label: 'Physical' }, { value: 'energy', label: 'Energy' },
  { value: 'information', label: 'Information / data' }, { value: 'material', label: 'Material' },
  { value: 'human_machine', label: 'Human-machine' }, { value: 'clearance', label: 'Clearance / indirect' },
] as const
export interface DiagramResourceOption { id: string; name: string; category?: string; unit?: string }
export type SelectedConnections = 'all' | 'suppliers' | 'recipients' | 'both'
export interface DiagramResourceFlow { source: string; target: string; resourceId: string }
export interface InterfaceDiagramFilters { types: FMEAInterface['interface_type'][]; resource: string; onlyConnected: boolean; connections: SelectedConnections }
export const ALL_RESOURCES = 'all'
export const UNASSIGNED_RESOURCE = 'unassigned'
export const resourceFilterValue = (id: string) => `resource:${id}`
export const defaultInterfaceDiagramFilters = (): InterfaceDiagramFilters => ({
  types: INTERFACE_TYPE_OPTIONS.map(item => item.value), resource: ALL_RESOURCES, onlyConnected: false, connections: 'all',
})

export function parseInterfaceDiagramFilters(json: string, resources: readonly DiagramResourceOption[]): InterfaceDiagramFilters {
  const fallback = defaultInterfaceDiagramFilters()
  try {
    const value = JSON.parse(json)
    if (!value || typeof value !== 'object') return fallback
    return {
      types: Array.isArray(value.types) ? INTERFACE_TYPE_OPTIONS.filter(item => value.types.includes(item.value)).map(item => item.value) : fallback.types,
      resource: value.resource === UNASSIGNED_RESOURCE || resources.some(item => resourceFilterValue(item.id) === value.resource)
        ? value.resource : ALL_RESOURCES,
      onlyConnected: value.onlyConnected === true,
      connections: ['suppliers', 'recipients', 'both'].includes(value.connections) ? value.connections : 'all',
    }
  } catch { return fallback }
}

/** Selection is semantic: collapsed descendants still belong to their assembly. */
export function diagramSelectionScope(nodes: readonly FMEABlockDiagramNode[],
  structures: readonly { id: string; parent_id?: string }[], selection: { nodeId?: string; structureId?: string }): Set<string> {
  const structureId = selection.structureId ?? nodes.find(node => node.id === selection.nodeId)?.structure_node_id
  const structuresInScope = new Set<string>(structureId ? [structureId] : [])
  const children = new Map<string, string[]>()
  for (const item of structures) if (item.parent_id) children.set(item.parent_id, [...children.get(item.parent_id) ?? [], item.id])
  const pending = [...structuresInScope]
  for (let at = 0; at < pending.length; at++) for (const child of children.get(pending[at]) ?? []) {
    if (!structuresInScope.has(child)) { structuresInScope.add(child); pending.push(child) }
  }
  const scope = new Set(nodes.filter(node => node.id === selection.nodeId
    || (node.structure_node_id && structuresInScope.has(node.structure_node_id))).map(node => node.id))
  const contained = new Map<string, string[]>()
  for (const node of nodes) if (node.container_parent_block_id)
    contained.set(node.container_parent_block_id, [...contained.get(node.container_parent_block_id) ?? [], node.id])
  const queue = [...scope]
  for (let at = 0; at < queue.length; at++) for (const child of contained.get(queue[at]) ?? []) {
    if (!scope.has(child)) { scope.add(child); queue.push(child) }
  }
  return scope
}

/** Resource and direction must match the same flow, including reverse flows on a shared interface. */
export function interfaceMatchesConnections(flows: readonly DiagramResourceFlow[], filters: InterfaceDiagramFilters,
  selectedScope?: ReadonlySet<string>): boolean {
  if (filters.connections === 'all' || !selectedScope) return true
  return flows.some(flow => {
    if (filters.resource !== ALL_RESOURCES && filters.resource !== resourceFilterValue(flow.resourceId)) return false
    const sourceInside = selectedScope.has(flow.source), targetInside = selectedScope.has(flow.target)
    if (sourceInside === targetInside) return false
    return filters.connections === 'both' || (filters.connections === 'suppliers' ? targetInside : sourceInside)
  })
}

/** Select complete interface records. A matching transfer never changes other transfers. */
export function interfaceMatchesFilters(item: FMEAInterface, resourceIds: readonly string[], filters: InterfaceDiagramFilters): boolean {
  return filters.types.includes(item.interface_type) && (filters.resource === ALL_RESOURCES
    || (filters.resource === UNASSIGNED_RESOURCE ? resourceIds.length === 0
      : resourceIds.some(id => resourceFilterValue(id) === filters.resource)))
}

export function projectInterfaceDiagramFilters(interfaces: readonly FMEAInterface[], nodes: readonly FMEABlockDiagramNode[],
  filters: InterfaceDiagramFilters, resourceIds: Readonly<Record<string, string[]>> = {},
  endpointOverrides?: Readonly<Record<string, { source: string; target: string }>>,
  flows: Readonly<Record<string, readonly DiagramResourceFlow[]>> = {}, selectedScope?: ReadonlySet<string>) {
  const nodeIds = new Set(nodes.map(node => node.id))
  const eligible = interfaces.flatMap(item => {
    const endpoints = endpointOverrides?.[item.id]
    if (endpointOverrides && !endpoints) return []
    const source = endpoints?.source ?? item.source_block_id, target = endpoints?.target ?? item.target_block_id
    return source && target && nodeIds.has(source) && nodeIds.has(target) ? [{ item, source, target }] : []
  })
  return { eligible, matching: eligible.filter(({ item }) => interfaceMatchesFilters(item, resourceIds[item.id] ?? [], filters)
    && interfaceMatchesConnections(flows[item.id] ?? [], filters, selectedScope)) }
}

/** Retain original endpoints and their containers before collapsed endpoints are aggregated. */
export function connectedDiagramNodeIds(nodes: readonly FMEABlockDiagramNode[],
  endpoints: readonly { source: string; target: string }[], retainedStructureIds: readonly string[] = [],
  retainedNodeIds: readonly string[] = []): Set<string> {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const retained = new Set<string>()
  const include = (id: string) => {
    let node = byId.get(id)
    const visited = new Set<string>()
    while (node && !visited.has(node.id)) {
      visited.add(node.id); retained.add(node.id)
      node = byId.get(node.container_parent_block_id ?? '')
    }
  }
  for (const endpoint of endpoints) { include(endpoint.source); include(endpoint.target) }
  retainedNodeIds.forEach(include)
  for (const node of nodes) if (node.structure_node_id && retainedStructureIds.includes(node.structure_node_id)) include(node.id)
  return retained
}
