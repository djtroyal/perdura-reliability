import type { Edge } from '@xyflow/react'

const RBD_SOURCE_HANDLE = 'rbd-output'
const RBD_TARGET_HANDLE = 'rbd-input'

function nextAvailableId(used: Set<string>, prefix = 'rbd-edge'): string {
  let sequence = 1
  while (used.has(`${prefix}-${sequence}`)) sequence += 1
  return `${prefix}-${sequence}`
}

/**
 * Restore the invariants React Flow requires to render every persisted RBD
 * connector. Duplicate edge IDs are especially harmful: React Flow keys its
 * internal edge lookup by ID and can silently replace one of the two paths.
 */
export function normalizeRbdEdges(edges: readonly Edge[] | null | undefined): Edge[] {
  const used = new Set<string>()
  return (edges ?? []).map(edge => {
    const requested = typeof edge.id === 'string' ? edge.id.trim() : ''
    const id = requested && !used.has(requested)
      ? requested
      : nextAvailableId(used, 'rbd-edge-recovered')
    used.add(id)
    return {
      ...edge,
      id,
      sourceHandle: RBD_SOURCE_HANDLE,
      targetHandle: RBD_TARGET_HANDLE,
    }
  })
}

/** Allocate a deterministic ID that cannot collide with the current graph. */
export function nextRbdEdgeId(edges: readonly Pick<Edge, 'id'>[]): string {
  return nextAvailableId(new Set(edges.map(edge => edge.id)), 'rbd-edge')
}
