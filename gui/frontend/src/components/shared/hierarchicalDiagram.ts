import type { FMEABlockDiagramNode, FMEAInterface } from '../../api/reliabilityProgram'

export interface HierarchyItem { id: string; parent_instance_id?: string }

/** Shared topology index. Coordinates and visibility never define model ownership. */
function buildHierarchyIndex(items: readonly HierarchyItem[]) {
  const byId = new Map(items.map(item => [item.id, item]))
  const children = new Map<string, string[]>()
  for (const item of items) if (item.parent_instance_id) {
    const siblings = children.get(item.parent_instance_id) ?? []
    siblings.push(item.id); children.set(item.parent_instance_id, siblings)
  }
  const ancestors = (id: string) => {
    const result: string[] = [], seen = new Set<string>()
    let parent = byId.get(id)?.parent_instance_id
    while (parent && !seen.has(parent)) {
      seen.add(parent); result.push(parent); parent = byId.get(parent)?.parent_instance_id
    }
    return result
  }
  const subtree = (id: string) => {
    const result = new Set<string>(), pending = [id]
    for (let at = 0; at < pending.length; at++) {
      const current = pending[at]
      if (result.has(current) || !byId.has(current)) continue
      result.add(current); pending.push(...children.get(current) ?? [])
    }
    return result
  }
  return { byId, children, ancestors, subtree }
}

const hierarchyIndexes = new WeakMap<readonly HierarchyItem[], ReturnType<typeof buildHierarchyIndex>>()
export function hierarchyIndex(items: readonly HierarchyItem[]) {
  let index = hierarchyIndexes.get(items)
  if (!index) { index = buildHierarchyIndex(items); hierarchyIndexes.set(items, index) }
  return index
}

/** Ancestors inherit crossing interfaces once, retaining the actual interface identity. */
export function interfaceBoundaryInstances(items: readonly HierarchyItem[], source?: string, target?: string) {
  const index = hierarchyIndex(items)
  const sourcePath = new Set(source ? [source, ...index.ancestors(source)] : [])
  const targetPath = new Set(target ? [target, ...index.ancestors(target)] : [])
  return new Set([...sourcePath, ...targetPath].filter(id => sourcePath.has(id) !== targetPath.has(id)))
}

export function interfaceAggregationKey(source: string, target: string, item: Pick<FMEAInterface,
  'interface_type' | 'linkage' | 'directionality' | 'relationship_strength' | 'relationship_nature'>,
  resourceIds: readonly string[] = []) {
  const endpoints = item.directionality === 'directed' ? [source, target] : [source, target].sort()
  return JSON.stringify([...endpoints, item.interface_type, item.linkage, item.directionality,
    [...new Set(resourceIds)].sort(), item.relationship_strength, item.relationship_nature])
}

/** The root is an implicit canvas boundary; lower levels always retain their containers. */
export function projectHierarchicalNodes(nodes: readonly FMEABlockDiagramNode[], {
  rootBlockId, rootEndpointRequired = false, expandedByNodeId = {},
}: { rootBlockId?: string; rootEndpointRequired?: boolean; expandedByNodeId?: Record<string, boolean> }) {
  const others = nodes.filter(node => node.id !== rootBlockId)
  const topY = others.length ? Math.min(...others.map(node => node.y)) : 80
  const projected = nodes.flatMap<FMEABlockDiagramNode>(node => node.id === rootBlockId
    ? rootEndpointRequired ? [{ ...node, container_parent_block_id: undefined, expanded: false,
      width: 200, height: 64, y: topY - 110 }] : []
    : [{ ...node, expanded: expandedByNodeId[node.id] ?? node.expanded ?? false,
      container_parent_block_id: node.container_parent_block_id === rootBlockId
        ? undefined : node.container_parent_block_id }])
  const byId = new Map(projected.map(node => [node.id, node]))
  const ordered: FMEABlockDiagramNode[] = [], visited = new Set<string>()
  const visit = (node: FMEABlockDiagramNode, trail = new Set<string>()) => {
    if (visited.has(node.id) || trail.has(node.id)) return
    const parent = byId.get(node.container_parent_block_id ?? '')
    if (parent) visit(parent, new Set(trail).add(node.id))
    visited.add(node.id); ordered.push(node)
  }
  projected.forEach(node => visit(node))
  return ordered
}
