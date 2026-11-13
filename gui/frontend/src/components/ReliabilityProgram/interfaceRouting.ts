/** Deterministic connector geometry. Expanded assemblies contribute their header,
 * not their empty interior: that interior is the workspace for their children. */
export type ConnectorStyle = 'orthogonal'|'curved'|'straight'
export type ConnectorSide = 'left'|'right'|'top'|'bottom'
export type Point = { x: number; y: number }
export type RoutingRect = Point & { id: string; width: number; height: number }
export type ConnectorRoute = {
  points: Point[]; path: string; label: Point
  sourceSide: ConnectorSide; targetSide: ConnectorSide
}
const EPSILON = 0.001
const normal: Record<ConnectorSide, Point> = {
  left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
  top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 },
}
export function connectorAnchor(rect: RoutingRect, side: ConnectorSide): Point {
  return { x: rect.x + (side === 'left' ? 0 : side === 'right' ? rect.width : rect.width / 2),
    y: rect.y + (side === 'top' ? 0 : side === 'bottom' ? rect.height : rect.height / 2) }
}
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const inflated = (rect: RoutingRect, margin: number): RoutingRect => ({ ...rect,
  x: rect.x - margin, y: rect.y - margin, width: rect.width + margin * 2, height: rect.height + margin * 2 })

/** Open-interior intersection; a connector may run along a clearance boundary. */
export function segmentEntersRect(a: Point, b: Point, rect: RoutingRect): boolean {
  if (Math.max(a.x,b.x) <= rect.x || Math.min(a.x,b.x) >= rect.x+rect.width
      || Math.max(a.y,b.y) <= rect.y || Math.min(a.y,b.y) >= rect.y+rect.height) return false
  const minX = rect.x + EPSILON; const maxX = rect.x + rect.width - EPSILON
  const minY = rect.y + EPSILON; const maxY = rect.y + rect.height - EPSILON
  let lower = 0; let upper = 1
  for (const [origin, delta, low, high] of [
    [a.x, b.x - a.x, minX, maxX], [a.y, b.y - a.y, minY, maxY],
  ]) {
    if (Math.abs(delta) < EPSILON) { if (origin < low || origin > high) return false }
    else {
      const one = (low - origin) / delta; const two = (high - origin) / delta
      lower = Math.max(lower, Math.min(one, two)); upper = Math.min(upper, Math.max(one, two))
      if (lower > upper) return false
    }
  }
  return lower <= upper && upper > EPSILON && lower < 1 - EPSILON
}
function simplify(points: Point[]): Point[] {
  const result: Point[] = []
  for (const point of points) {
    if (result.length && distance(result[result.length - 1], point) < EPSILON) continue
    while (result.length > 1) {
      const a = result[result.length - 2]; const b = result[result.length - 1]
      if (Math.abs((b.x - a.x) * (point.y - b.y) - (b.y - a.y) * (point.x - b.x)) > EPSILON
          || (b.x - a.x) * (point.x - b.x) + (b.y - a.y) * (point.y - b.y) < 0) break
      result.pop()
    }
    result.push(point)
  }
  return result
}
function routeCost(points: Point[]) {
  return points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0)
    + Math.max(0, points.length - 2) * 12
}
function clearPath(points: Point[], obstacles: RoutingRect[]) {
  return points.slice(1).every((point, index) => obstacles.every(rect => !segmentEntersRect(points[index], point, rect)))
}

/** A lazy Hanan-grid search is the complete fallback when simple corridors are
 * obstructed. It never gives up and substitutes a line through an obstacle. */
function gridRoute(start: Point, end: Point, obstacles: RoutingRect[]): Point[] | undefined {
  const xs = [...new Set([start.x, end.x, ...obstacles.flatMap(r => [r.x, r.x + r.width])])].sort((a,b) => a-b)
  const ys = [...new Set([start.y, end.y, ...obstacles.flatMap(r => [r.y, r.y + r.height])])].sort((a,b) => a-b)
  const width = xs.length; const startId = ys.indexOf(start.y) * width + xs.indexOf(start.x)
  const endId = ys.indexOf(end.y) * width + xs.indexOf(end.x)
  type Entry = { key: number; id: number; axis: number; g: number; f: number }
  const heap: Entry[] = []
  const less = (a: Entry, b: Entry) => a.f < b.f || (a.f === b.f && (a.g < b.g || (a.g === b.g && a.key < b.key)))
  const push = (item: Entry) => {
    let index = heap.length; heap.push(item)
    while (index) { const parent = (index - 1) >> 1; if (!less(item, heap[parent])) break
      heap[index] = heap[parent]; index = parent; heap[index] = item }
  }
  const pop = () => {
    const item = heap[0]; const last = heap.pop()!
    if (heap.length) { heap[0] = last; let index = 0
      while (true) { const left = index * 2 + 1; const right = left + 1
        let child = left; if (right < heap.length && less(heap[right], heap[left])) child = right
        if (child >= heap.length || !less(heap[child], heap[index])) break
        ;[heap[index], heap[child]] = [heap[child], heap[index]]; index = child }
    }
    return item
  }
  const point = (id: number) => ({ x: xs[id % width], y: ys[Math.floor(id / width)] })
  const costs = new Map<number, number>(); const previous = new Map<number, number>()
  const startKey = startId * 3
  costs.set(startKey, 0); push({ key: startKey, id: startId, axis: 0, g: 0, f: Math.abs(start.x-end.x)+Math.abs(start.y-end.y) })
  while (heap.length) {
    const current = pop()
    if (costs.get(current.key) !== current.g) continue
    if (current.id === endId) {
      const path: Point[] = []; let key: number | undefined = current.key
      while (key != null) { path.push(point(Math.floor(key / 3))); key = previous.get(key) }
      return simplify(path.reverse())
    }
    const x = current.id % width; const y = Math.floor(current.id / width); const from = point(current.id)
    for (const [nx, ny, axis] of [[x-1,y,1],[x+1,y,1],[x,y-1,2],[x,y+1,2]]) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= ys.length) continue
      const id = ny * width + nx; const to = point(id)
      if (!clearPath([from, to], obstacles)) continue
      const g = current.g + distance(from,to) + (current.axis && current.axis !== axis ? 12 : 0)
      const key = id * 3 + axis
      if (g >= (costs.get(key) ?? Infinity)) continue
      costs.set(key,g); previous.set(key,current.key)
      push({ key,id,axis,g,f:g+Math.abs(to.x-end.x)+Math.abs(to.y-end.y) })
    }
  }
}

function orthogonalRoute(start: Point, end: Point, obstacles: RoutingRect[], lane: number): Point[] | undefined {
  const midX = (start.x + end.x) / 2 + lane; const midY = (start.y + end.y) / 2 + lane
  if (Math.abs(lane) > .01) {
    const parallel = Math.abs(end.x-start.x) >= Math.abs(end.y-start.y)
      ? [start,{ x:start.x,y:start.y+lane },{ x:end.x,y:start.y+lane },{ x:end.x,y:end.y },end]
      : [start,{ x:start.x+lane,y:start.y },{ x:start.x+lane,y:end.y },{ x:end.x,y:end.y },end]
    if (clearPath(parallel,obstacles)) return simplify(parallel)
  }
  const candidates = [
    [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end],
    [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end],
    [start, { x: end.x, y: start.y }, end], [start, { x: start.x, y: end.y }, end],
  ].map(simplify)
  const clear = candidates.filter(path => clearPath(path, obstacles)).sort((a,b) => routeCost(a)-routeCost(b))
  if (clear.length) return clear[0]
  return gridRoute(start, end, obstacles)
}

function renderPath(points: Point[], style: ConnectorStyle, obstacles: RoutingRect[]) {
  if (!points.length) return ''
  let path = `M ${points[0].x},${points[0].y}`
  for (let index = 1; index < points.length - 1; index++) {
    const before = points[index - 1]; const corner = points[index]; const after = points[index + 1]
    let radius = style === 'curved' ? Math.min(80, distance(before,corner)/2, distance(corner,after)/2) : 0
    // A rounded turn cuts inside its orthogonal corridor. Certify the whole
    // quadratic's convex hull against real blocks before rounding that turn.
    const rounded = (r: number) => ({
      a: { x: corner.x + (before.x-corner.x)*r/distance(before,corner), y: corner.y + (before.y-corner.y)*r/distance(before,corner) },
      b: { x: corner.x + (after.x-corner.x)*r/distance(after,corner), y: corner.y + (after.y-corner.y)*r/distance(after,corner) },
    })
    while (radius > .5) {
      const { a,b } = rounded(radius)
      const box = { x:Math.min(a.x,b.x,corner.x),y:Math.min(a.y,b.y,corner.y),
        width:Math.max(a.x,b.x,corner.x)-Math.min(a.x,b.x,corner.x),height:Math.max(a.y,b.y,corner.y)-Math.min(a.y,b.y,corner.y) }
      if (!obstacles.some(rect => box.x < rect.x+rect.width && box.x+box.width > rect.x
        && box.y < rect.y+rect.height && box.y+box.height > rect.y)) break
      radius /= 2
    }
    if (radius > .5) { const { a,b } = rounded(radius); path += ` L ${a.x},${a.y} Q ${corner.x},${corner.y} ${b.x},${b.y}` }
    else path += ` L ${corner.x},${corner.y}`
  }
  if (points.length > 1) path += ` L ${points[points.length-1].x},${points[points.length-1].y}`
  return path
}
function midpoint(points: Point[]) {
  const lengths = points.slice(1).map((point,index) => distance(points[index],point))
  let remaining = lengths.reduce((a,b) => a+b,0)/2
  for (let index = 0; index < lengths.length; index++) {
    if (remaining <= lengths[index]) { const fraction = remaining/(lengths[index] || 1)
      return { x:points[index].x+(points[index+1].x-points[index].x)*fraction,
        y:points[index].y+(points[index+1].y-points[index].y)*fraction } }
    remaining -= lengths[index]
  }
  return points[0]
}
export function routeInterfaceConnector(options: {
  source: RoutingRect; target: RoutingRect; obstacles: RoutingRect[]
  style?: ConnectorStyle; lane?: number; clearance?: number
  sourceSide?: ConnectorSide; targetSide?: ConnectorSide
}): ConnectorRoute {
  const { source, target, obstacles, style = 'curved', lane = 0, clearance = 14 } = options
  const dx = target.x+target.width/2-source.x-source.width/2
  const dy = target.y+target.height/2-source.y-source.height/2
  const sourcePreferred: ConnectorSide = Math.abs(dx) >= Math.abs(dy) ? dx >= 0 ? 'right' : 'left' : dy >= 0 ? 'bottom' : 'top'
  const opposite: Record<ConnectorSide,ConnectorSide> = { left:'right',right:'left',top:'bottom',bottom:'top' }
  const sides: ConnectorSide[] = ['right','bottom','left','top']
  const sourceSides = options.sourceSide ? [options.sourceSide] : [sourcePreferred,...sides.filter(s => s!==sourcePreferred)]
  const targetPreferred = source.id === target.id ? 'top' : opposite[sourcePreferred]
  const targetSides = options.targetSide ? [options.targetSide] : [targetPreferred,...sides.filter(s => s!==targetPreferred)]
  const rectangles = new Map(obstacles.map(rect => [rect.id,rect])); rectangles.set(source.id,source); rectangles.set(target.id,target)
  const actual = [...rectangles.values()]
  const padded = actual.map(rect => inflated(rect,clearance))
  for (const sourceSide of sourceSides) for (const targetSide of targetSides) {
    if (source.id === target.id && sourceSide === targetSide) continue
    const start = connectorAnchor(source,sourceSide); const end = connectorAnchor(target,targetSide)
    const stub = clearance + Math.abs(lane)*.3
    const escape = { x:start.x+normal[sourceSide].x*stub,y:start.y+normal[sourceSide].y*stub }
    const approach = { x:end.x+normal[targetSide].x*stub,y:end.y+normal[targetSide].y*stub }
    if (!clearPath([start,escape],actual.filter(rect => rect.id !== source.id))
      || !clearPath([approach,end],actual.filter(rect => rect.id !== target.id))) continue
    const outward = (end.x-start.x)*normal[sourceSide].x+(end.y-start.y)*normal[sourceSide].y >= 0
      && (start.x-end.x)*normal[targetSide].x+(start.y-end.y)*normal[targetSide].y >= 0
    let points = style === 'straight' && source.id !== target.id && outward && clearPath([start,end],actual)
      ? [start,end] : undefined
    if (!points) {
      const core = orthogonalRoute(escape,approach,padded,lane)
      if (core) points = simplify([start,...core,end])
    }
    if (points) return { points,path:renderPath(points,style,actual),label:midpoint(points),sourceSide,targetSide }
  }
  // Fully overlapping/covered endpoints have no collision-free geometric
  // solution. Expose no misleading line through a block; the UI reports it.
  if (clearance > 0) return routeInterfaceConnector({ ...options,clearance:clearance > 6 ? 6 : 0 })
  return { points:[],path:'',label:connectorAnchor(source,sourcePreferred),sourceSide:sourcePreferred,targetSide:targetPreferred }
}
