import type { Edge, Node } from '@xyflow/react'
import type { FTEdge, FTNode, RBDEdge, RBDNode } from '../../api/client'

/** Deterministic first layout for a generated graph; users can refine it with Auto Layout. */
export function layoutConvertedGraph(
  kind: 'rbd' | 'fta',
  rawNodes: (RBDNode | FTNode)[],
  rawEdges: (RBDEdge | FTEdge)[],
): { nodes: Node[]; edges: Edge[] } {
  const ids = new Set(rawNodes.map(node => node.id))
  const incoming = new Map([...ids].map(id => [id, [] as string[]]))
  const outgoing = new Map([...ids].map(id => [id, [] as string[]]))
  rawEdges.forEach(edge => {
    if (!ids.has(edge.source) || !ids.has(edge.target)) return
    outgoing.get(edge.source)?.push(edge.target)
    incoming.get(edge.target)?.push(edge.source)
  })
  const indegree = new Map([...ids].map(id => [id, incoming.get(id)?.length ?? 0]))
  const queue = [...ids].filter(id => indegree.get(id) === 0).sort()
  const rank = new Map<string, number>(queue.map(id => [id, 0]))
  while (queue.length) {
    const current = queue.shift()!
    for (const target of outgoing.get(current) ?? []) {
      rank.set(target, Math.max(rank.get(target) ?? 0, (rank.get(current) ?? 0) + 1))
      indegree.set(target, (indegree.get(target) ?? 1) - 1)
      if (indegree.get(target) === 0) { queue.push(target); queue.sort() }
    }
  }
  const layers = new Map<number, string[]>()
  rawNodes.forEach(node => {
    const layer = rank.get(node.id) ?? 0
    layers.set(layer, [...(layers.get(layer) ?? []), node.id])
  })
  const positions = new Map<string, { x: number; y: number }>()
  layers.forEach((layerIds, layer) => {
    layerIds.sort()
    layerIds.forEach((id, index) => {
      const centered = index - (layerIds.length - 1) / 2
      positions.set(id, kind === 'fta'
        ? { x: 520 + centered * 190, y: 60 + layer * 155 }
        : { x: 60 + layer * 195, y: 300 + centered * 125 })
    })
  })
  return {
    nodes: rawNodes.map(node => ({
      id: node.id, type: node.type, position: positions.get(node.id) ?? { x: 0, y: 0 },
      data: { ...(node.data ?? {}) },
    })),
    edges: rawEdges.map((edge, index) => ({
      id: edge.id || `converted-edge-${index + 1}`,
      source: edge.source, target: edge.target,
      ...(kind === 'rbd' ? {
        sourceHandle: 'rbd-output', targetHandle: 'rbd-input',
      } : {}),
      ...('role' in edge || 'order' in edge ? { data: {
        role: (edge as FTEdge).role,
        order: (edge as FTEdge).order,
      } } : {}),
    })),
  }
}
