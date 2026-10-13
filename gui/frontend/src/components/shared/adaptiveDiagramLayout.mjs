export const LAYOUT_PROFILES = {
  compact: { nodeGap: 28, layerGap: 58, laneGap: 24, corridor: 28 },
  normal: { nodeGap: 62, layerGap: 92, laneGap: 38, corridor: 42 },
  expanded: { nodeGap: 96, layerGap: 132, laneGap: 54, corridor: 58 },
}
const compareId = (a, b) => a < b ? -1 : a > b ? 1 : 0
export function normalizeLayoutOptions(value, density) {
  return {
    mode: ['compact', 'normal', 'expanded'].includes(value?.mode) ? value.mode
      : ['dense', 'compact'].includes(density) ? 'compact'
        : ['spacious', 'expanded', 'detailed'].includes(density) ? 'expanded' : 'normal',
    preserveGateOrder: value?.preserveGateOrder !== false,
    preserveEventOrder: value?.preserveEventOrder !== false,
    optimizeLabelGeometry: value?.optimizeLabelGeometry === true,
  }
}
export const layoutDensity = mode => mode === 'normal' ? 'comfortable' : mode

/** A single captured cross-axis ordering avoids contradictory parent-local
 * constraints for a shared DAG. Protected classes keep their visual sequence. */
export function orderLayoutNodes(nodes, options, horizontal = false, score) {
  const center = node => horizontal ? Number(node.y ?? 0) + node.height / 2
    : Number(node.x ?? 0) + node.width / 2
  const visual = [...nodes].sort((a, b) => center(a) - center(b) || compareId(a.id, b.id))
  if (options.preserveGateOrder && options.preserveEventOrder) return visual
  const priority = node => score?.(node.id) ?? center(node)
  const candidates = [...visual].sort((a, b) => priority(a) - priority(b) || compareId(a.id, b.id))
  const protectedKind = options.preserveGateOrder ? 'gate' : options.preserveEventOrder ? 'event' : null
  if (!protectedKind) return candidates
  const protectedNodes = visual.filter(node => (node.kind ?? 'event') === protectedKind)
  let nextProtected = 0
  const pending = new Set(candidates.map(node => node.id))
  const result = []
  // Merge the protected sequence with the priority sequence in linear time.
  for (const candidate of candidates) {
    const node = (candidate.kind ?? 'event') === protectedKind
      ? protectedNodes[nextProtected++] : candidate
    if (pending.delete(node.id)) result.push(node)
  }
  return result
}

function cleanInputs(nodes, edges) {
  const ids = new Set()
  const clean = nodes.map(node => {
    if (!node.id || ids.has(node.id)) throw new Error('Layout requires unique node IDs.')
    ids.add(node.id)
    return { ...node,
      width: Number.isFinite(node.width) && node.width > 0 ? node.width : 144,
      height: Number.isFinite(node.height) && node.height > 0 ? node.height : 100,
      x: Number.isFinite(node.x) ? node.x : 0, y: Number.isFinite(node.y) ? node.y : 0 }
  })
  return { nodes: clean, edges: edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)) }
}

function profileFor(density, connectorStyle = 'smoothstep') {
  const base = LAYOUT_PROFILES[normalizeLayoutOptions(undefined, density).mode]
  const scale = connectorStyle === 'straight' ? 0.76 : connectorStyle === 'bezier' ? 0.88 : 1
  return {
    ...base,
    nodeGap: Math.round(base.nodeGap * (connectorStyle === 'straight' ? 0.88 : 1)),
    layerGap: Math.round(base.layerGap * scale),
    corridor: Math.round(base.corridor * scale),
  }
}

export function adaptiveConnectorOffset(density, connectorStyle = 'smoothstep') {
  return profileFor(density, connectorStyle).corridor
}

function snap(value, enabled, gridSize) {
  return enabled ? Math.round(value / gridSize) * gridSize : value
}

function medianCenter(values) {
  values = [...values].sort((a, b) => a - b)
  if (!values.length) return 0
  const middle = Math.floor(values.length / 2)
  return values.length % 2 === 1
    ? values[middle]
    : (values[middle - 1] + values[middle]) / 2
}

function graphLayers(nodes, edges, horizontal, options) {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const outgoing = new Map(nodes.map(node => [node.id, []]))
  const incoming = new Map(nodes.map(node => [node.id, []]))
  const indegree = new Map(nodes.map(node => [node.id, 0]))
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue
    outgoing.get(edge.source).push(edge)
    incoming.get(edge.target).push(edge)
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
  }
  outgoing.forEach(list => list.sort((left, right) =>
    Number(left.order ?? 0) - Number(right.order ?? 0) || compareId(left.target, right.target)))

  const prior = node => horizontal ? Number(node.y ?? 0) : Number(node.x ?? 0)
  const queue = nodes.filter(node => (indegree.get(node.id) ?? 0) === 0)
    .sort((left, right) => prior(left) - prior(right) || compareId(left.id, right.id))
    .map(node => node.id)
  const rank = new Map(queue.map(id => [id, 0]))
  const remaining = new Map(indegree)
  while (queue.length) {
    const id = queue.shift()
    for (const edge of outgoing.get(id) ?? []) {
      rank.set(edge.target, Math.max(rank.get(edge.target) ?? 0, (rank.get(id) ?? 0) + 1))
      const value = (remaining.get(edge.target) ?? 1) - 1
      remaining.set(edge.target, value)
      if (value === 0) queue.push(edge.target)
    }
  }

  const maxRank = Math.max(0, ...rank.values())
  nodes.forEach(node => { if (!rank.has(node.id)) rank.set(node.id, maxRank + 1) })
  const layers = new Map()
  rank.forEach((value, id) => layers.set(value, [...(layers.get(value) ?? []), id]))
  layers.forEach(ids => ids.sort((left, right) =>
    prior(byId.get(left)) - prior(byId.get(right)) || compareId(left, right)))

  const rankCount = Math.max(0, ...layers.keys()) + 1
  const orderMap = layer => new Map((layers.get(layer) ?? []).map((id, index) => [id, index]))
  const reorder = (layer, neighbourLayer, neighbours) => {
    const ids = layers.get(layer)
    if (!ids || ids.length < 2) return
    const stable = new Map(ids.map((id, index) => [id, index]))
    const neighbourOrder = orderMap(neighbourLayer)
    if (options.optimizeLabelGeometry && nodes.length <= 500 && edges.length <= 2000) {
      let cursor = 0
      for (const id of layers.get(neighbourLayer) ?? []) {
        const extent = horizontal ? byId.get(id).height : byId.get(id).width
        neighbourOrder.set(id, cursor + extent / 2)
        cursor += extent + LAYOUT_PROFILES[options.mode].nodeGap
      }
    }
    const score = id => {
      const values = neighbours(id).map(value => neighbourOrder.get(value))
        .filter(value => value != null)
      return values.length
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : stable.get(id) ?? 0
    }
    const ordered = orderLayoutNodes(ids.map(id => byId.get(id)), options, horizontal, score)
    ids.splice(0, ids.length, ...ordered.map(node => node.id))
  }
  for (let sweep = 0; sweep < 6; sweep += 1) {
    for (let layer = 1; layer < rankCount; layer += 1) {
      reorder(layer, layer - 1, id => (incoming.get(id) ?? []).map(edge => edge.source))
    }
    for (let layer = rankCount - 2; layer >= 0; layer -= 1) {
      reorder(layer, layer + 1, id => (outgoing.get(id) ?? []).map(edge => edge.target))
    }
  }
  if (options.mode === 'compact' && options.optimizeLabelGeometry && !options.preserveEventOrder
      && nodes.length <= 500 && edges.length <= 2000) {
    outgoing.forEach(children => {
      if (children.length !== 3) return
      const ids = children.map(edge => edge.target)
      const layer = layers.get(rank.get(ids[0]))
      if (layer?.length !== 3 || ids.some(id => byId.get(id).type !== 'basic'
          || incoming.get(id).length !== 1 || outgoing.get(id).length !== 0)) return
      const area = sequence => {
        const [left, middle, right] = sequence.map(id => byId.get(id))
        const d = Math.max(middle.width / 2 + 12, (left.width + right.width) / 4 + 14)
        const width = 2 * d + (left.width + right.width) / 2
        return width * (middle.height + 24 + Math.max(left.height, right.height))
      }
      let best = [...layer], cost = area(best)
      for (const candidate of [[ids[0],ids[1],ids[2]],[ids[0],ids[2],ids[1]],
        [ids[1],ids[0],ids[2]],[ids[1],ids[2],ids[0]],[ids[2],ids[0],ids[1]],[ids[2],ids[1],ids[0]]]) {
        const nextCost = area(candidate)
        if (nextCost < cost) { best = candidate; cost = nextCost }
      }
      layer.splice(0, layer.length, ...best)
    })
  }
  return { byId, outgoing, incoming, rank, layers, rankCount }
}

function routeDescriptors(edges, orientation, corridor) {
  const grouped = new Map()
  for (const edge of edges) grouped.set(edge.source, [...(grouped.get(edge.source) ?? []), edge])
  const routes = {}
  grouped.forEach(list => {
    list.sort((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0)
      || compareId(left.target, right.target))
    list.forEach((edge, index) => {
      const lane = index - (list.length - 1) / 2
      routes[edge.id] = {
        orientation,
        lane,
        // Siblings share one corridor. Separate offsets create the nested
        // stair-steps that make an ordinary fanout look like a maze.
        offset: Math.round(corridor),
      }
    })
  })
  return routes
}

function staggerLanes(graph, nodes, mode) {
  const lane = new Map(nodes.map(node => [node.id, 0]))
  if (mode !== 'compact') return lane
  graph.outgoing.forEach(children => {
    // Only three independent basic leaves form the compact trident. Never
    // stagger mixed gate/event groups, shared nodes or compound Transfers.
    const ids = children.map(edge => edge.target)
    if (ids.length !== 3 || new Set(ids).size !== 3 || ids.some(id =>
      graph.byId.get(id).type !== 'basic' || graph.incoming.get(id).length !== 1
      || graph.outgoing.get(id).length !== 0)) return
    const ordered = graph.layers.get(graph.rank.get(ids[0])).filter(id => ids.includes(id))
    const layer = graph.layers.get(graph.rank.get(ids[0]))
    if (ordered.length !== 3 || layer.indexOf(ordered[2]) - layer.indexOf(ordered[0]) !== 2) return
    lane.set(ordered[0], 1); lane.set(ordered[2], 1)
  })
  return lane
}

function packHorizontal(ids, graph, lanes, gap, centerX) {
  const centers = new Map()
  let cursor = 0
  for (let index = 0; index < ids.length; index++) {
    const node = graph.byId.get(ids[index])
    if ((lanes.get(node.id) ?? 0) === 1 && index + 2 < ids.length
        && (lanes.get(ids[index + 1]) ?? 0) === 0 && (lanes.get(ids[index + 2]) ?? 0) === 1) {
      const middle = graph.byId.get(ids[index + 1]), right = graph.byId.get(ids[index + 2])
      const distance = Math.max(middle.width / 2 + 12, (node.width + right.width) / 4 + gap / 2)
      const anchor = cursor + Math.max(distance + node.width / 2, middle.width / 2)
      centers.set(node.id, anchor - distance); centers.set(middle.id, anchor); centers.set(right.id, anchor + distance)
      cursor = anchor + Math.max(distance + right.width / 2, middle.width / 2) + gap
      index += 2
    } else {
      centers.set(node.id, cursor + node.width / 2)
      cursor += node.width + gap
    }
  }
  const offset = centerX - Math.max(0, cursor - gap) / 2
  ids.forEach(id => centers.set(id, centers.get(id) + offset))
  return centers
}

export function layoutVerticalGraph({
  nodes, edges, density = 'comfortable', layoutOptions, viewportWidth = 1000,
  connectorStyle = 'smoothstep', snapToGrid = false, gridSize = 20, top = 82, side = 40,
}) {
  if (!nodes.length) return { positions: {}, routes: {}, staggered: [] }
  ;({ nodes, edges } = cleanInputs(nodes, edges))
  const options = normalizeLayoutOptions(layoutOptions, density)
  const settings = LAYOUT_PROFILES[options.mode]
  const graph = graphLayers(nodes, edges, false, options)
  const lanes = staggerLanes(graph, nodes, options.mode)
  const centers = new Map()
  const centerX = Math.max(side + 300, viewportWidth / 2)

  for (let rank = graph.rankCount - 1; rank >= 0; rank -= 1) {
    const ids = graph.layers.get(rank) ?? []
    const packed = packHorizontal(ids, graph, lanes, settings.nodeGap, centerX)
    // Prefer exact odd/even centering over children. Packing remains the hard
    // constraint and wins whenever centering would create a collision.
    const rightByLane = new Map()
    let priorCenter = -Infinity
    for (const id of ids) {
      const childCenters = (graph.outgoing.get(id) ?? []).map(edge => centers.get(edge.target))
        .filter(value => value != null)
      const desired = childCenters.length && !ids.some(id => lanes.get(id) === 1) ? medianCenter(childCenters) : packed.get(id)
      const node = graph.byId.get(id)
      const nodeLane = lanes.get(id) ?? 0
      const minimum = Math.max(
        (rightByLane.get(nodeLane) ?? -Infinity) + settings.nodeGap + node.width / 2,
        priorCenter + 12,
      )
      const value = Math.max(desired, Number.isFinite(minimum) ? minimum : desired)
      centers.set(id, value)
      rightByLane.set(nodeLane, value + node.width / 2)
      priorCenter = value
    }

  }

  const rankTop = new Map()
  const laneTop = new Map()
  let cursorY = top
  for (let rank = 0; rank < graph.rankCount; rank += 1) {
    const ids = graph.layers.get(rank) ?? []
    const upperHeight = Math.max(0, ...ids.filter(id => (lanes.get(id) ?? 0) === 0)
      .map(id => graph.byId.get(id).height))
    const lowerHeight = Math.max(0, ...ids.filter(id => (lanes.get(id) ?? 0) === 1)
      .map(id => graph.byId.get(id).height))
    rankTop.set(rank, cursorY)
    laneTop.set(rank, [cursorY, cursorY + upperHeight + settings.laneGap])
    cursorY += upperHeight + (lowerHeight ? settings.laneGap + lowerHeight : 0) + settings.layerGap
  }

  const left = Math.min(...nodes.map(node => centers.get(node.id) - node.width / 2))
  const right = Math.max(...nodes.map(node => centers.get(node.id) + node.width / 2))
  const graphWidth = right - left
  const graphOffset = Math.max(side - left, (viewportWidth - graphWidth) / 2 - left)
  const positions = {}
  for (const node of nodes) {
    const rank = graph.rank.get(node.id) ?? 0
    const nodeLane = lanes.get(node.id) ?? 0
    positions[node.id] = {
      // Snap the connector centerline, not the left edge. Nodes of unlike
      // widths otherwise acquire a small but very visible connector kink.
      x: snap((centers.get(node.id) ?? 0) + graphOffset, snapToGrid, gridSize) - node.width / 2,
      y: snap((laneTop.get(rank) ?? [rankTop.get(rank) ?? top])[nodeLane], snapToGrid, gridSize),
    }
  }
  return {
    positions,
    routes: routeGraphEdges(nodes, edges, positions, 'vertical', settings.corridor),
    staggered: nodes.filter(node => (lanes.get(node.id) ?? 0) === 1).map(node => node.id),
  }
}

export function layoutHorizontalGraph({
  nodes, edges, density = 'comfortable', layoutOptions, viewportHeight = 700,
  connectorStyle = 'smoothstep', snapToGrid = false, gridSize = 20, top = 82, side = 70,
}) {
  if (!nodes.length) return { positions: {}, routes: {}, staggered: [] }
  ;({ nodes, edges } = cleanInputs(nodes, edges))
  const options = normalizeLayoutOptions(layoutOptions, density)
  const settings = LAYOUT_PROFILES[options.mode]
  const graph = graphLayers(nodes, edges, true, options)
  const layerWidths = new Map()
  for (let rank = 0; rank < graph.rankCount; rank += 1) {
    layerWidths.set(rank, Math.max(0, ...(graph.layers.get(rank) ?? [])
      .map(id => graph.byId.get(id).width)))
  }
  const layerLeft = new Map()
  let cursorX = side
  for (let rank = 0; rank < graph.rankCount; rank += 1) {
    layerLeft.set(rank, cursorX)
    cursorX += (layerWidths.get(rank) ?? 0) + settings.layerGap
  }

  const packedByLayer = new Map()
  let tallestLayer = 0
  for (let rank = 0; rank < graph.rankCount; rank += 1) {
    const ids = graph.layers.get(rank) ?? []
    const totalHeight = ids.reduce((sum, id) => sum + graph.byId.get(id).height, 0)
      + settings.nodeGap * Math.max(0, ids.length - 1)
    tallestLayer = Math.max(tallestLayer, totalHeight)
    let cursor = 0
    const values = new Map()
    ids.forEach(id => {
      values.set(id, cursor + graph.byId.get(id).height / 2)
      cursor += graph.byId.get(id).height + settings.nodeGap
    })
    packedByLayer.set(rank, { values, totalHeight })
  }
  const centerY = Math.max(top + tallestLayer / 2, viewportHeight / 2)
  const positions = {}
  for (const node of nodes) {
    const rank = graph.rank.get(node.id) ?? 0
    const packed = packedByLayer.get(rank)
    const layerWidth = layerWidths.get(rank) ?? node.width
    const center = centerY - packed.totalHeight / 2 + packed.values.get(node.id)
    positions[node.id] = {
      x: snap((layerLeft.get(rank) ?? side) + (layerWidth - node.width) / 2, snapToGrid, gridSize),
      y: snap(center, snapToGrid, gridSize) - node.height / 2,
    }
  }
  return {
    positions,
    routes: routeGraphEdges(nodes, edges, positions, 'horizontal', settings.corridor),
    staggered: [],
  }
}

export function orthogonalConnectorPath({
  sourceX, sourceY, targetX, targetY, orientation = 'vertical',
  trunk = 'source', offset = 32,
}) {
  const clean = value => Number(Number(value).toFixed(3))
  const sx = clean(sourceX)
  const sy = clean(sourceY)
  const tx = clean(targetX)
  const ty = clean(targetY)
  const alignmentTolerance = 1
  if (orientation === 'vertical') {
    // Layout measurements can differ by a fractional CSS pixel even when the
    // handles share a logical centerline. Snap that rendering noise to the
    // target axis rather than drawing a tiny dogleg or diagonal.
    if (Math.abs(sx - tx) <= alignmentTolerance) {
      return `M ${tx} ${sy} L ${tx} ${ty}`
    }
    if (sy === ty) {
      return `M ${sx} ${sy} L ${tx} ${ty}`
    }
    const delta = targetY - sourceY
    const direction = Math.sign(delta) || 1
    const clearance = Math.min(Math.max(12, offset), Math.abs(delta) * 0.5)
    const busY = trunk === 'target'
      ? targetY - direction * clearance
      : trunk === 'midpoint' ? (sourceY + targetY) / 2
        : sourceY + direction * clearance
    const by = clean(busY)
    return `M ${sx} ${sy} L ${sx} ${by} L ${tx} ${by} L ${tx} ${ty}`
  }

  if (Math.abs(sy - ty) <= alignmentTolerance) {
    return `M ${sx} ${ty} L ${tx} ${ty}`
  }
  if (sx === tx) return `M ${sx} ${sy} L ${tx} ${ty}`
  const delta = targetX - sourceX
  const direction = Math.sign(delta) || 1
  const clearance = Math.min(Math.max(12, offset), Math.abs(delta) * 0.5)
  const busX = trunk === 'target'
    ? targetX - direction * clearance
    : trunk === 'midpoint' ? (sourceX + targetX) / 2
      : sourceX + direction * clearance
  const bx = clean(busX)
  return `M ${sx} ${sy} L ${bx} ${sy} L ${bx} ${ty} L ${tx} ${ty}`
}

export function rectanglesOverlap(left, right, gap = 0) {
  return left.x < right.x + right.width + gap
    && left.x + left.width + gap > right.x
    && left.y < right.y + right.height + gap
    && left.y + left.height + gap > right.y
}

/** Bounded obstacle-aware orthogonal routing. Normal fanouts share their bus;
 * obstructed paths consider deterministic outside corridors instead. */
export function routeGraphEdges(nodes, edges, positions, orientation, corridor) {
  const boxes = new Map(nodes.map(node => [node.id, { ...positions[node.id], width: node.width, height: node.height }]))
  const horizontal = orientation === 'horizontal'
  const values = [...boxes.values()]
  const minX = Math.min(...values.map(b => b.x)) - corridor
  const maxX = Math.max(...values.map(b => b.x + b.width)) + corridor
  const minY = Math.min(...values.map(b => b.y)) - corridor
  const maxY = Math.max(...values.map(b => b.y + b.height)) + corridor
  const routes = routeDescriptors(edges, orientation, corridor)
  const outgoing = new Map(), incoming = new Map()
  for (const edge of edges) {
    outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1)
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1)
  }
  // Expensive obstruction scoring has a deterministic graph-size cutoff. Large
  // diagrams still retain every edge and receive the same direct bus routing.
  const inspect = nodes.length <= 500 && edges.length <= 2000
  const hits = (points, source, target) => {
    let count = 0
    for (const [id, box] of boxes) {
      if (id === source || id === target) continue
      const b = { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 }
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], z = points[i]
        if (a.x === z.x ? a.x > b.x && a.x < b.x + b.width && Math.max(a.y, z.y) > b.y && Math.min(a.y, z.y) < b.y + b.height
          : a.y > b.y && a.y < b.y + b.height && Math.max(a.x, z.x) > b.x && Math.min(a.x, z.x) < b.x + b.width) count++
      }
    }
    return count
  }
  const length = points => points.slice(1).reduce((sum, point, i) => sum + Math.abs(point.x - points[i].x) + Math.abs(point.y - points[i].y), 0)
  for (const edge of edges) {
    const a = boxes.get(edge.source), b = boxes.get(edge.target)
    if (!a || !b) continue
    const source = horizontal ? { x: a.x + a.width, y: a.y + a.height / 2 } : { x: a.x + a.width / 2, y: a.y + a.height }
    const target = horizontal ? { x: b.x, y: b.y + b.height / 2 } : { x: b.x + b.width / 2, y: b.y }
    const trunk = horizontal && outgoing.get(edge.source) === 1 ? incoming.get(edge.target) > 1 ? 'target' : 'midpoint' : 'source'
    const delta = horizontal ? target.x - source.x : target.y - source.y
    const gap = Math.min(corridor, Math.max(12, Math.abs(delta) / 2))
    const bus = trunk === 'target' ? (horizontal ? target.x : target.y) - gap
      : trunk === 'midpoint' ? ((horizontal ? source.x + target.x : source.y + target.y) / 2)
        : (horizontal ? source.x : source.y) + gap
    const direct = horizontal
      ? [source, { x: bus, y: source.y }, { x: bus, y: target.y }, target]
      : [source, { x: source.x, y: bus }, { x: target.x, y: bus }, target]
    let points = direct, obstructionCount = inspect ? hits(direct, edge.source, edge.target) : undefined
    if (obstructionCount) {
      const alternatives = horizontal ? [minY, maxY].map(y => [source, { x: source.x + 12, y: source.y }, { x: source.x + 12, y }, { x: target.x - 12, y }, { x: target.x - 12, y: target.y }, target])
        : [minX, maxX].map(x => [source, { x: source.x, y: source.y + 12 }, { x, y: source.y + 12 }, { x, y: target.y - 12 }, { x: target.x, y: target.y - 12 }, target])
      for (const candidate of alternatives) {
        const collisions = hits(candidate, edge.source, edge.target)
        if (collisions < obstructionCount || (collisions === obstructionCount && length(candidate) < length(points))) {
          points = candidate; obstructionCount = collisions
        }
      }
    }
    routes[edge.id] = { ...routes[edge.id], trunk, points, sourceAnchor: source, targetAnchor: target,
      ...(obstructionCount == null ? {} : { obstructionCount }) }
  }
  return routes
}

export function routedConnectorPath(args, route) {
  const near = (a, x, y) => a && Math.abs(a.x - x) <= 16 && Math.abs(a.y - y) <= 16
  if (!route?.points?.length || !near(route.sourceAnchor, args.sourceX, args.sourceY)
      || !near(route.targetAnchor, args.targetX, args.targetY)) return orthogonalConnectorPath(args)
  const points = route.points.map(point => ({ ...point }))
  points[0] = { x: args.sourceX, y: args.sourceY }
  points[points.length - 1] = { x: args.targetX, y: args.targetY }
  const horizontal = args.orientation === 'horizontal'
  if (horizontal) { points[1].y = args.sourceY; points[points.length - 2].y = args.targetY }
  else { points[1].x = args.sourceX; points[points.length - 2].x = args.targetX }
  return points.map((p, i) => `${i ? 'L' : 'M'} ${Number(p.x.toFixed(3))} ${Number(p.y.toFixed(3))}`).join(' ')
}

/** Radial placement uses measured diagonals, preserving captured clockwise
 * order when requested and never changing the state/transition arrays. */
export function layoutRadialGraph({ nodes, edges = [], layoutOptions, initialId, snapToGrid = false }) {
  const options = normalizeLayoutOptions(layoutOptions)
  const settings = LAYOUT_PROFILES[options.mode]
  ;({ nodes, edges } = cleanInputs(nodes, edges))
  if (!nodes.length) return { positions: {}, routes: {}, staggered: [] }
  const cx = nodes.reduce((sum, n) => sum + n.x + n.width / 2, 0) / nodes.length
  const cy = nodes.reduce((sum, n) => sum + n.y + n.height / 2, 0) / nodes.length
  let ordered = [...nodes].sort((a, b) => Math.atan2(a.y + a.height / 2 - cy, a.x + a.width / 2 - cx)
    - Math.atan2(b.y + b.height / 2 - cy, b.x + b.width / 2 - cx) || compareId(a.id, b.id))
  if (!options.preserveEventOrder) ordered.sort((a, b) => compareId(a.id, b.id))
  const anchor = ordered.findIndex(node => node.id === initialId)
  if (anchor > 0) ordered = [...ordered.slice(anchor), ...ordered.slice(0, anchor)]
  const diameter = Math.max(...nodes.map(n => Math.hypot(n.width, n.height))) + settings.nodeGap + (snapToGrid ? 30 : 0)
  let radius = nodes.length === 1 ? 0 : diameter / (2 * Math.sin(Math.PI / nodes.length))
  let increments = ordered.map(() => 2 * Math.PI / nodes.length)
  if (options.optimizeLabelGeometry && nodes.length > 2 && nodes.length <= 500) {
    const required = ordered.map((node, i) => (Math.hypot(node.width, node.height)
      + Math.hypot(ordered[(i + 1) % ordered.length].width, ordered[(i + 1) % ordered.length].height)) / 2 + settings.nodeGap + (snapToGrid ? 30 : 0))
    let low = Math.max(...required) / 2, high = radius
    for (let iteration = 0; iteration < 40; iteration++) {
      const middle = (low + high) / 2
      const total = required.reduce((sum, chord) => sum + 2 * Math.asin(Math.min(1, chord / (2 * middle))), 0)
      if (total > 2 * Math.PI) low = middle; else high = middle
    }
    radius = high
    increments = required.map(chord => 2 * Math.asin(Math.min(1, chord / (2 * radius))))
  }
  const positions = {}
  let angle = -Math.PI / 2
  ordered.forEach((node, index) => {
    positions[node.id] = { x: snap(400 + radius * Math.cos(angle), snapToGrid, 20) - node.width / 2,
      y: snap(300 + radius * Math.sin(angle), snapToGrid, 20) - node.height / 2 }
    angle += increments[index]
  })
  return { positions, routes: {}, staggered: [] }
}

/** Linear hierarchy fallback for large assembly diagrams. Every block remains
 * represented; compound bounds are computed bottom-up and applied top-down. */
export function layoutLargeNestedBlocks(nodes, boundary, options) {
  const profile = LAYOUT_PROFILES[options.mode]
  const byId = new Map(nodes.map(node => [node.id, node]))
  const children = new Map(nodes.map(node => [node.id, []]))
  const roots = []
  for (const node of nodes) {
    if (node.parentId && byId.has(node.parentId) && node.parentId !== node.id) children.get(node.parentId).push(node)
    else roots.push(node)
  }
  const seen = new Set(), order = [], effectiveChildren = new Map(), effectiveRoots = []
  // Also retain cyclic/disconnected drafts. A back edge cannot create an
  // infinite traversal and does not cause a model relation to be rewritten.
  for (const root of [...roots, ...nodes]) {
    if (seen.has(root.id)) continue
    effectiveRoots.push(root)
    const stack = [root]
    while (stack.length) {
      const node = stack.pop()
      if (seen.has(node.id)) continue
      seen.add(node.id); order.push(node)
      const peers = orderLayoutNodes(children.get(node.id).filter(child => !seen.has(child.id)), options, true)
      effectiveChildren.set(node.id, peers)
      stack.push(...[...peers].reverse())
    }
  }
  const sizes = new Map(), local = new Map()
  for (const node of [...order].reverse()) {
    const peers = effectiveChildren.get(node.id) ?? []
    let width = node.width, height = node.height, y = 52
    for (const child of peers) {
      const size = sizes.get(child.id)
      if (!size) continue
      local.set(child.id, { x: 24, y }); y += size.height + profile.nodeGap
      if (node.expanded) { width = Math.max(width, size.width + 48); height = Math.max(height, y) }
    }
    sizes.set(node.id, { width, height })
  }
  const inside = orderLayoutNodes(effectiveRoots.filter(node => node.insideBoundary), options, true)
  const outside = orderLayoutNodes(effectiveRoots.filter(node => !node.insideBoundary), options, true)
  const requiredWidth = Math.max(300, ...inside.map(node => sizes.get(node.id).width + 110))
  const requiredHeight = Math.max(200, 110 + inside.reduce((sum, node) => sum + sizes.get(node.id).height + profile.nodeGap, 0))
  const nextBoundary = { ...boundary, width: requiredWidth, height: requiredHeight }
  const positions = {}
  let y = boundary.y + 70
  inside.forEach(node => { positions[node.id] = { x: boundary.x + 55, y }; y += sizes.get(node.id).height + profile.nodeGap })
  y = boundary.y
  outside.forEach(node => { positions[node.id] = { x: boundary.x + requiredWidth + profile.layerGap, y }; y += sizes.get(node.id).height + profile.nodeGap })
  for (const node of order) for (const child of effectiveChildren.get(node.id) ?? []) {
    if (!local.has(child.id) || !positions[node.id]) continue
    positions[child.id] = { x: positions[node.id].x + local.get(child.id).x, y: positions[node.id].y + local.get(child.id).y }
  }
  return { positions, boundary: nextBoundary }
}

/** Choose a curved interface's perpendicular offset using actual block bounds.
 * Fixed candidate/sample counts keep the optional clearance search bounded. */
export function clearCurveOffset(source, target, boxes, preferred, clearance) {
  if (boxes.length > 500) return preferred
  const dx = target.x - source.x, dy = target.y - source.y, length = Math.max(1, Math.hypot(dx, dy))
  const nx = -dy / length, ny = dx / length
  const contains = (box, point) => point.x > box.x - 8 && point.x < box.x + box.width + 8
    && point.y > box.y - 8 && point.y < box.y + box.height + 8
  const obstacles = boxes.filter(box => !contains(box, source) && !contains(box, target))
  const hits = offset => {
    let result = 0
    for (let step = 1; step < 24; step++) {
      const t = step / 24, normal = 3 * t * (1 - t) * offset
      const point = { x: source.x + dx * t + nx * normal, y: source.y + dy * t + ny * normal }
      for (const box of obstacles) if (contains(box, point)) result++
    }
    return result
  }
  let best = preferred, score = hits(preferred)
  if (!score) return best
  for (const offset of [clearance, -clearance, clearance * 2, -clearance * 2, clearance * 4, -clearance * 4]) {
    const next = hits(offset)
    if (next < score || (next === score && Math.abs(offset) < Math.abs(best))) { best = offset; score = next }
  }
  return best
}
