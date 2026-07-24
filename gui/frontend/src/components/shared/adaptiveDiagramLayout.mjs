const DENSITY_PROFILES = {
  dense: { nodeGap: 28, layerGap: 58, laneGap: 24, corridor: 28 },
  compact: { nodeGap: 42, layerGap: 72, laneGap: 30, corridor: 34 },
  comfortable: { nodeGap: 62, layerGap: 92, laneGap: 38, corridor: 42 },
  spacious: { nodeGap: 78, layerGap: 112, laneGap: 46, corridor: 50 },
  expanded: { nodeGap: 96, layerGap: 132, laneGap: 54, corridor: 58 },
}

function profileFor(density, connectorStyle = 'smoothstep') {
  const base = DENSITY_PROFILES[density] ?? DENSITY_PROFILES.comfortable
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
  if (!values.length) return 0
  const middle = Math.floor(values.length / 2)
  return values.length % 2 === 1
    ? values[middle]
    : (values[middle - 1] + values[middle]) / 2
}

function graphLayers(nodes, edges, horizontal) {
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
    Number(left.order ?? 0) - Number(right.order ?? 0) || left.target.localeCompare(right.target)))

  const prior = node => horizontal ? Number(node.y ?? 0) : Number(node.x ?? 0)
  const queue = nodes.filter(node => (indegree.get(node.id) ?? 0) === 0)
    .sort((left, right) => prior(left) - prior(right) || left.id.localeCompare(right.id))
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
    prior(byId.get(left)) - prior(byId.get(right)) || left.localeCompare(right)))

  const rankCount = Math.max(0, ...layers.keys()) + 1
  const orderMap = layer => new Map((layers.get(layer) ?? []).map((id, index) => [id, index]))
  const reorder = (layer, neighbourLayer, neighbours) => {
    const ids = layers.get(layer)
    if (!ids || ids.length < 2) return
    const stable = new Map(ids.map((id, index) => [id, index]))
    const neighbourOrder = orderMap(neighbourLayer)
    const score = id => {
      const values = neighbours(id).map(value => neighbourOrder.get(value))
        .filter(value => value != null)
      return values.length
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : stable.get(id) ?? 0
    }
    const semanticOrder = id => Math.min(
      Infinity,
      ...(incoming.get(id) ?? []).map(edge => Number(edge.order ?? Infinity)),
    )
    ids.sort((left, right) => score(left) - score(right)
      || semanticOrder(left) - semanticOrder(right)
      || (stable.get(left) ?? 0) - (stable.get(right) ?? 0))
  }
  for (let sweep = 0; sweep < 6; sweep += 1) {
    for (let layer = 1; layer < rankCount; layer += 1) {
      reorder(layer, layer - 1, id => (incoming.get(id) ?? []).map(edge => edge.source))
    }
    for (let layer = rankCount - 2; layer >= 0; layer -= 1) {
      reorder(layer, layer + 1, id => (outgoing.get(id) ?? []).map(edge => edge.target))
    }
  }
  return { byId, outgoing, incoming, rank, layers, rankCount }
}

function routeDescriptors(edges, orientation, corridor) {
  const grouped = new Map()
  for (const edge of edges) grouped.set(edge.source, [...(grouped.get(edge.source) ?? []), edge])
  const routes = {}
  grouped.forEach(list => {
    list.sort((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0)
      || left.target.localeCompare(right.target))
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

function staggerLanes(graph, nodes, density, viewportWidth, nodeGap) {
  const lane = new Map(nodes.map(node => [node.id, 0]))
  if (density !== 'dense' && density !== 'compact') return lane
  const claimed = new Set()
  graph.outgoing.forEach(children => {
    const ids = children.map(edge => edge.target)
      .filter(id => (graph.incoming.get(id) ?? []).length === 1)
    if (ids.length < 3 || ids.some(id => claimed.has(id))) return
    const rank = graph.rank.get(ids[0])
    if (ids.some(id => graph.rank.get(id) !== rank)) return
    const widths = ids.map(id => graph.byId.get(id).width)
    const flatWidth = widths.reduce((sum, width) => sum + width, 0) + nodeGap * (ids.length - 1)
    const sameLaneWidth = Math.max(...widths) * Math.ceil(ids.length / 2)
      + nodeGap * Math.max(0, Math.ceil(ids.length / 2) - 1)
    const saving = 1 - sameLaneWidth / Math.max(1, flatWidth)
    const localBudget = Math.max(420, viewportWidth * 0.72)
    if (saving < 0.15 || (density === 'compact' && flatWidth <= localBudget)) return

    const middle = Math.floor(ids.length / 2)
    ids.forEach((id, index) => {
      // Odd groups create a symmetric trident: the median stays on the
      // canonical row and equal-distance siblings share a secondary row.
      lane.set(id, ids.length % 2 === 1
        ? Math.abs(index - middle) % 2
        : index % 2)
      claimed.add(id)
    })
  })
  return lane
}

function packHorizontal(ids, graph, lanes, gap, centerX) {
  const centers = new Map()
  const rightByLane = new Map()
  let priorCenter = -Infinity
  for (const id of ids) {
    const node = graph.byId.get(id)
    const nodeLane = lanes.get(id) ?? 0
    const minimum = Math.max(
      (rightByLane.get(nodeLane) ?? -Infinity) + gap + node.width / 2,
      priorCenter + 12,
    )
    const center = Number.isFinite(minimum) ? minimum : node.width / 2
    centers.set(id, center)
    rightByLane.set(nodeLane, center + node.width / 2)
    priorCenter = center
  }
  const left = Math.min(...ids.map(id => centers.get(id) - graph.byId.get(id).width / 2))
  const right = Math.max(...ids.map(id => centers.get(id) + graph.byId.get(id).width / 2))
  const offset = centerX - (left + right) / 2
  ids.forEach(id => centers.set(id, centers.get(id) + offset))
  return centers
}

export function layoutVerticalGraph({
  nodes, edges, density = 'comfortable', viewportWidth = 1000,
  connectorStyle = 'smoothstep', snapToGrid = false, gridSize = 20, top = 82, side = 40,
}) {
  if (!nodes.length) return { positions: {}, routes: {}, staggered: [] }
  const settings = profileFor(density, connectorStyle)
  const graph = graphLayers(nodes, edges, false)
  const lanes = staggerLanes(graph, nodes, density, viewportWidth, settings.nodeGap)
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
      const desired = childCenters.length ? medianCenter(childCenters) : packed.get(id)
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
    if (ids.length) {
      const layerLeft = Math.min(...ids.map(id => centers.get(id) - graph.byId.get(id).width / 2))
      const layerRight = Math.max(...ids.map(id => centers.get(id) + graph.byId.get(id).width / 2))
      const offset = centerX - (layerLeft + layerRight) / 2
      ids.forEach(id => centers.set(id, centers.get(id) + offset))
      // Make the three-child dense pattern a true trident instead of merely
      // alternating rows: the middle child and parent share one centerline.
      graph.outgoing.forEach(children => {
        const childIds = children.map(edge => edge.target)
        if (childIds.length !== 3 || childIds.some(id => !ids.includes(id))) return
        if ((lanes.get(childIds[0]) ?? 0) !== 1
            || (lanes.get(childIds[1]) ?? 0) !== 0
            || (lanes.get(childIds[2]) ?? 0) !== 1) return
        centers.set(childIds[1], ((centers.get(childIds[0]) ?? 0) + (centers.get(childIds[2]) ?? 0)) / 2)
      })
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
    routes: routeDescriptors(edges, 'vertical', settings.corridor),
    staggered: nodes.filter(node => (lanes.get(node.id) ?? 0) === 1).map(node => node.id),
  }
}

export function layoutHorizontalGraph({
  nodes, edges, density = 'comfortable', viewportHeight = 700,
  connectorStyle = 'smoothstep', snapToGrid = false, gridSize = 20, top = 82, side = 70,
}) {
  if (!nodes.length) return { positions: {}, routes: {}, staggered: [] }
  const settings = profileFor(density, connectorStyle)
  const graph = graphLayers(nodes, edges, true)
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
    routes: routeDescriptors(edges, 'horizontal', settings.corridor),
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
