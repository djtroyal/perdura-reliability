import type { FMEABlockDiagram } from '../../api/reliabilityProgram'

interface LiveBlock {
  id: string
  parentId?: string
  position: { x: number; y: number }
  width?: number
  height?: number
}

/** Grow container origins left/up while keeping every child's world position. */
export function encloseExpandedContainers(diagram: FMEABlockDiagram, padding = 20): FMEABlockDiagram {
  const nodes = diagram.nodes.map(node => ({ ...node }))
  const byId = new Map(nodes.map(node => [node.id, node]))
  const children = new Map<string, string[]>()
  for (const node of nodes) if (node.container_parent_block_id) {
    const siblings = children.get(node.container_parent_block_id) ?? []
    siblings.push(node.id)
    children.set(node.container_parent_block_id, siblings)
  }
  const expanded = new Set<string>()
  const enclose = (id: string, trail = new Set<string>()) => {
    const node = byId.get(id)
    if (!node?.expanded || expanded.has(id) || trail.has(id)) return
    const childIds = children.get(id) ?? []
    for (const childId of childIds) enclose(childId, new Set(trail).add(id))
    for (const childId of childIds) {
      const child = byId.get(childId)!
      node.x = Math.min(node.x, child.x - padding)
      node.y = Math.min(node.y, child.y - Math.max(46, padding))
    }
    expanded.add(id)
  }
  nodes.forEach(node => enclose(node.id))
  return { ...diagram, nodes }
}

/** Make room for an explicitly opened branch without rearranging its contents.
 * Only intersecting siblings move, together with their hidden descendants.
 * Ancestor growth is then checked against the next level's siblings. */
export function resolveExpansionCollisions(
  diagram: FMEABlockDiagram, expandedId: string, padding = 20, sizeScale = 1,
): FMEABlockDiagram {
  const nodes = diagram.nodes.map(node => ({ ...node }))
  const byId = new Map(nodes.map(node => [node.id, node]))
  const children = new Map<string | undefined, typeof nodes>()
  for (const node of nodes) {
    const parent = byId.has(node.container_parent_block_id ?? '') ? node.container_parent_block_id : undefined
    const peers = children.get(parent) ?? []
    peers.push(node); children.set(parent, peers)
  }
  const bounds = (id: string, trail = new Set<string>()): { x: number; y: number; width: number; height: number } => {
    const node = byId.get(id)!
    const result = { x: node.x, y: node.y, width: node.width * sizeScale, height: node.height * sizeScale }
    if (!node.expanded || trail.has(id)) return result
    const next = new Set(trail).add(id)
    for (const child of children.get(id) ?? []) {
      const size = bounds(child.id, next)
      result.width = Math.max(result.width, size.x + size.width + padding - result.x)
      result.height = Math.max(result.height, size.y + size.height + padding - result.y)
    }
    return result
  }
  const overlaps = (a: ReturnType<typeof bounds>, b: ReturnType<typeof bounds>) =>
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
  const move = (id: string, dx: number, dy: number) => {
    const seen = new Set<string>(), pending = [id]
    while (pending.length) {
      const current = pending.pop()!
      if (seen.has(current)) continue
      seen.add(current)
      const node = byId.get(current)!
      node.x += dx; node.y += dy
      pending.push(...(children.get(current) ?? []).map(child => child.id))
    }
  }
  const visited = new Set<string>()
  let anchor = byId.get(expandedId)
  while (anchor && !visited.has(anchor.id)) {
    visited.add(anchor.id)
    const parent = byId.has(anchor.container_parent_block_id ?? '') ? anchor.container_parent_block_id : undefined
    const pending = (children.get(parent) ?? []).filter(node => node.id !== anchor!.id)
      .sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const settled = [bounds(anchor.id)]
    // A moved peer can encounter the next peer. The settled frontier prevents
    // cycles while leaving unrelated, previously positioned branches untouched.
    for (let changed = true; changed;) {
      changed = false
      for (let index = 0; index < pending.length; index++) {
        const node = pending[index], current = bounds(node.id)
        if (!settled.some(other => overlaps(current, other))) continue
        const clearAlong = (axis: 'x' | 'y') => {
          const candidate = { ...current }
          for (let step = 0; step <= settled.length; step++) {
            const intersecting = settled.filter(other => overlaps(candidate, other))
            if (!intersecting.length) break
            candidate[axis] = Math.max(...intersecting.map(other => other[axis]
              + (axis === 'x' ? other.width : other.height) + padding))
          }
          return candidate
        }
        const right = clearAlong('x'), down = clearAlong('y')
        const target = right.x - current.x <= down.y - current.y ? right : down
        move(node.id, target.x - current.x, target.y - current.y)
        settled.push(bounds(node.id))
        pending.splice(index--, 1)
        changed = true
      }
    }
    anchor = parent ? byId.get(parent) : undefined
  }
  return { ...diagram, nodes }
}

/** Commit React Flow's growing containers using canonical absolute positions. */
export function commitBlockDrag(
  diagram: FMEABlockDiagram,
  liveBlocks: readonly LiveBlock[],
  draggedId: string,
  padding = 20,
): FMEABlockDiagram {
  const original = new Map(diagram.nodes.map(node => [node.id, node]))
  const live = new Map(liveBlocks.map(node => [node.id, node]))
  const positions = new Map<string, { x: number; y: number }>()
  const absolute = (id: string, trail = new Set<string>()): { x: number; y: number } | undefined => {
    if (positions.has(id)) return positions.get(id)
    const node = live.get(id)
    if (!node || trail.has(id)) return undefined
    const parent = node.parentId ? absolute(node.parentId, new Set(trail).add(id)) : undefined
    const position = { x: node.position.x + (parent?.x ?? 0), y: node.position.y + (parent?.y ?? 0) }
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return undefined
    positions.set(id, position)
    return position
  }
  liveBlocks.forEach(node => absolute(node.id))
  const dragged = original.get(draggedId)
  if (!dragged || !positions.has(draggedId)) return diagram
  const descendants = new Set([draggedId])
  const children = new Map<string, string[]>()
  for (const node of diagram.nodes) if (node.container_parent_block_id) {
    const siblings = children.get(node.container_parent_block_id) ?? []
    siblings.push(node.id)
    children.set(node.container_parent_block_id, siblings)
  }
  const visit = (id: string) => {
    for (const child of children.get(id) ?? []) if (!descendants.has(child)) {
      descendants.add(child)
      visit(child)
    }
  }
  visit(draggedId)
  const draggedPosition = positions.get(draggedId)!
  const draggedLive = live.get(draggedId)!
  const centerX = draggedPosition.x + (draggedLive.width ?? dragged.width) / 2
  const centerY = draggedPosition.y + (draggedLive.height ?? dragged.height) / 2
  const parent = original.get(dragged.container_parent_block_id ?? '')
  const inside = parent ? parent.inside_boundary
    : centerX >= diagram.boundary.x && centerX <= diagram.boundary.x + diagram.boundary.width
      && centerY >= diagram.boundary.y && centerY <= diagram.boundary.y + diagram.boundary.height
  const nodes = diagram.nodes.map(node => {
    let position = positions.get(node.id)
    // Collapsed descendants are absent from React Flow. Follow the nearest
    // rendered ancestor, never a container origin shifted solely by growth.
    if (!position) {
      let ancestorId = node.container_parent_block_id
      const seen = new Set([node.id])
      while (ancestorId && !seen.has(ancestorId)) {
        seen.add(ancestorId)
        const ancestor = original.get(ancestorId)
        const moved = positions.get(ancestorId)
        if (ancestor && moved) {
          position = { x: node.x + moved.x - ancestor.x, y: node.y + moved.y - ancestor.y }
          break
        }
        ancestorId = ancestor?.container_parent_block_id
      }
    }
    return { ...node, ...(position ?? {}),
      inside_boundary: descendants.has(node.id) ? inside : node.inside_boundary }
  })
  // Keep each block's collapsed size. Expanded dimensions are derived from
  // the enclosed children, including any parents that grew during the drag.
  return encloseExpandedContainers({ ...diagram, nodes }, padding)
}
