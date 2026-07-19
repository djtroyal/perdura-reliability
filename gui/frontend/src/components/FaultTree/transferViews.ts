import type { Edge, Node } from '@xyflow/react'

const TRANSFER_VIEW_ENDPOINT = /^transfer-view:([^:]+):.+$/

/**
 * Expanded transfer trees are presentation-only React Flow nodes. Older edge
 * change handling could persist the virtual referenced-tree root in place of
 * the real Transfer gate endpoint. Restore that endpoint before validation,
 * analysis, and persistence, and discard any leaked virtual internal edges.
 */
export function restoreExpandedTransferEndpoints(
  rawEdges: Edge[], graphNodes: Pick<Node, 'id' | 'type'>[],
): Edge[] {
  const nodeTypes = new Map(graphNodes.map(node => [node.id, node.type]))
  let changed = false
  const restored: Edge[] = []

  const restoreEndpoint = (endpoint: string) => {
    const owner = TRANSFER_VIEW_ENDPOINT.exec(endpoint)?.[1]
    if (!owner || nodeTypes.get(owner) !== 'transfer') return endpoint
    changed = true
    return owner
  }

  for (const edge of rawEdges) {
    if (String(edge.id).startsWith('transfer-view:')) {
      changed = true
      continue
    }
    const source = restoreEndpoint(edge.source)
    const target = restoreEndpoint(edge.target)
    restored.push(source === edge.source && target === edge.target
      ? edge : { ...edge, source, target })
  }
  return changed ? restored : rawEdges
}
