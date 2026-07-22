import assert from 'node:assert/strict'
import test from 'node:test'
import {
  layoutHorizontalGraph,
  layoutVerticalGraph,
  orthogonalConnectorPath,
  rectanglesOverlap,
} from '../src/components/shared/adaptiveDiagramLayout.mjs'

const trioNodes = [
  { id: 'gate', width: 112, height: 90 },
  { id: 'left', width: 96, height: 100 },
  { id: 'middle', width: 96, height: 100 },
  { id: 'right', width: 96, height: 100 },
]
const trioEdges = ['left', 'middle', 'right'].map((target, order) => ({
  id: `edge-${target}`, source: 'gate', target, order,
}))

function box(node, position) {
  return { ...position, width: node.width, height: node.height }
}

test('dense FTA trio forms a centered, collision-free trident', () => {
  const result = layoutVerticalGraph({
    nodes: trioNodes, edges: trioEdges, density: 'dense', viewportWidth: 900,
  })
  assert.deepEqual(new Set(result.staggered), new Set(['left', 'right']))
  assert.equal(result.positions.left.y, result.positions.right.y)
  assert.ok(result.positions.middle.y < result.positions.left.y)

  const gateCenter = result.positions.gate.x + trioNodes[0].width / 2
  const middleCenter = result.positions.middle.x + trioNodes[2].width / 2
  assert.equal(gateCenter, middleCenter)
  for (let left = 0; left < trioNodes.length; left += 1) {
    for (let right = left + 1; right < trioNodes.length; right += 1) {
      assert.equal(rectanglesOverlap(
        box(trioNodes[left], result.positions[trioNodes[left].id]),
        box(trioNodes[right], result.positions[trioNodes[right].id]),
      ), false)
    }
  }
  assert.deepEqual(Object.values(result.routes).map(route => route.lane), [-1, 0, 1])
})

test('comfortable FTA remains a conventional single-row fanout', () => {
  const result = layoutVerticalGraph({
    nodes: trioNodes, edges: trioEdges, density: 'comfortable', viewportWidth: 900,
  })
  assert.deepEqual(result.staggered, [])
  assert.equal(result.positions.left.y, result.positions.middle.y)
  assert.equal(result.positions.middle.y, result.positions.right.y)
})

test('compact FTA staggers only when a fanout exceeds the viewport budget', () => {
  const narrow = layoutVerticalGraph({
    nodes: trioNodes, edges: trioEdges, density: 'compact', viewportWidth: 1200,
  })
  assert.deepEqual(narrow.staggered, [])
  const targets = Array.from({ length: 8 }, (_, index) => ({
    id: `n${index}`, width: 112, height: 90,
  }))
  const wide = layoutVerticalGraph({
    nodes: [{ id: 'gate', width: 128, height: 90 }, ...targets],
    edges: targets.map((node, order) => ({ id: `e${order}`, source: 'gate', target: node.id, order })),
    density: 'compact',
    viewportWidth: 700,
  })
  assert.ok(wide.staggered.length > 0)
})

test('dense fanouts from three through twelve stay ordered and collision-free', () => {
  for (let count = 3; count <= 12; count += 1) {
    const children = Array.from({ length: count }, (_, index) => ({
      id: `n${index}`, width: 80 + (index % 3) * 22, height: 65 + (index % 4) * 27,
    }))
    const nodes = [{ id: 'gate', width: 112, height: 90 }, ...children]
    const result = layoutVerticalGraph({
      nodes,
      edges: children.map((node, order) => ({ id: `e${order}`, source: 'gate', target: node.id, order })),
      density: 'dense', viewportWidth: 760,
    })
    const centers = children.map(node => result.positions[node.id].x + node.width / 2)
    assert.ok(centers.every((value, index) => index === 0 || value > centers[index - 1]))
    for (let left = 0; left < nodes.length; left += 1) {
      for (let right = left + 1; right < nodes.length; right += 1) {
        assert.equal(rectanglesOverlap(
          box(nodes[left], result.positions[nodes[left].id]),
          box(nodes[right], result.positions[nodes[right].id]),
        ), false, `${count}-way fanout collision: ${nodes[left].id}/${nodes[right].id}`)
      }
    }
  }
})

test('vertical layout is deterministic and applies the requested grid', () => {
  const options = {
    nodes: trioNodes, edges: trioEdges, density: 'dense', viewportWidth: 913,
    snapToGrid: true, gridSize: 20,
  }
  const first = layoutVerticalGraph(options)
  const second = layoutVerticalGraph(options)
  assert.deepEqual(first, second)
  trioNodes.forEach(node => {
    const position = first.positions[node.id]
    assert.equal((position.x + node.width / 2) % 20, 0)
    assert.equal(position.y % 20, 0)
  })
})

test('orthogonal FTA fanouts share a clean bus and aligned children stay straight', () => {
  const left = orthogonalConnectorPath({
    sourceX: 240, sourceY: 200, targetX: 80, targetY: 340,
    orientation: 'vertical', trunk: 'source', offset: 32,
  })
  const right = orthogonalConnectorPath({
    sourceX: 240, sourceY: 200, targetX: 400, targetY: 340,
    orientation: 'vertical', trunk: 'source', offset: 32,
  })
  assert.match(left, /^M 240 200 L 240 232 L 80 232 L 80 340$/)
  assert.match(right, /^M 240 200 L 240 232 L 400 232 L 400 340$/)
  assert.equal(orthogonalConnectorPath({
    sourceX: 240, sourceY: 200, targetX: 240, targetY: 300,
  }), 'M 240 200 L 240 300')
})

test('orthogonal RBD merges share a target-side bus', () => {
  const upper = orthogonalConnectorPath({
    sourceX: 200, sourceY: 120, targetX: 460, targetY: 240,
    orientation: 'horizontal', trunk: 'target', offset: 40,
  })
  const lower = orthogonalConnectorPath({
    sourceX: 200, sourceY: 360, targetX: 460, targetY: 240,
    orientation: 'horizontal', trunk: 'target', offset: 40,
  })
  assert.match(upper, /L 420 120 L 420 240 L 460 240$/)
  assert.match(lower, /L 420 360 L 420 240 L 460 240$/)
})

test('FTA sibling order follows stored semantic edge order', () => {
  const nodes = [
    { id: 'gate', width: 112, height: 90 },
    { id: 'alpha', width: 96, height: 90, x: 500 },
    { id: 'beta', width: 96, height: 90, x: 100 },
    { id: 'gamma', width: 96, height: 90, x: 300 },
  ]
  const result = layoutVerticalGraph({
    nodes,
    edges: [
      { id: 'e-gamma', source: 'gate', target: 'gamma', order: 0 },
      { id: 'e-alpha', source: 'gate', target: 'alpha', order: 1 },
      { id: 'e-beta', source: 'gate', target: 'beta', order: 2 },
    ],
    density: 'dense', viewportWidth: 900,
  })
  const center = id => result.positions[id].x + 48
  assert.ok(center('gamma') < center('alpha'))
  assert.ok(center('alpha') < center('beta'))
})

test('RBD uses measured heights and keeps an isolated chain horizontal', () => {
  const chainNodes = [
    { id: 'source', width: 58, height: 58 },
    { id: 'block', width: 144, height: 132 },
    { id: 'sink', width: 58, height: 58 },
  ]
  const chain = layoutHorizontalGraph({
    nodes: chainNodes,
    edges: [
      { id: 'source-block', source: 'source', target: 'block' },
      { id: 'block-sink', source: 'block', target: 'sink' },
    ],
    density: 'comfortable',
    viewportHeight: 600,
  })
  const centers = chainNodes.map(node => chain.positions[node.id].y + node.height / 2)
  assert.equal(new Set(centers).size, 1)
  assert.ok(chain.positions.source.x < chain.positions.block.x)
  assert.ok(chain.positions.block.x < chain.positions.sink.x)
})

test('straight connectors reserve less routing space than orthogonal connectors', () => {
  const nodes = [
    { id: 'source', width: 58, height: 58 },
    { id: 'block', width: 144, height: 80 },
    { id: 'sink', width: 58, height: 58 },
  ]
  const edges = [
    { id: 'source-block', source: 'source', target: 'block' },
    { id: 'block-sink', source: 'block', target: 'sink' },
  ]
  const orthogonal = layoutHorizontalGraph({ nodes, edges, connectorStyle: 'smoothstep' })
  const straight = layoutHorizontalGraph({ nodes, edges, connectorStyle: 'straight' })
  assert.ok(straight.positions.sink.x < orthogonal.positions.sink.x)
  assert.ok(straight.routes['source-block'].offset < orthogonal.routes['source-block'].offset)
})

test('RBD parallel ranks are centered and collision-free', () => {
  const nodes = [
    { id: 'source', width: 58, height: 58 },
    { id: 'short', width: 144, height: 70 },
    { id: 'tall', width: 144, height: 150 },
    { id: 'sink', width: 58, height: 58 },
  ]
  const result = layoutHorizontalGraph({
    nodes,
    edges: [
      { id: 's-short', source: 'source', target: 'short' },
      { id: 's-tall', source: 'source', target: 'tall' },
      { id: 'short-t', source: 'short', target: 'sink' },
      { id: 'tall-t', source: 'tall', target: 'sink' },
    ],
    density: 'dense', viewportHeight: 540,
  })
  assert.equal(rectanglesOverlap(
    box(nodes[1], result.positions.short),
    box(nodes[2], result.positions.tall),
  ), false)
  assert.equal(result.routes['s-short'].lane, -0.5)
  assert.equal(result.routes['s-tall'].lane, 0.5)
})

test('cyclic residue is placed without looping or disappearing', () => {
  const result = layoutVerticalGraph({
    nodes: [{ id: 'a', width: 100, height: 80 }, { id: 'b', width: 100, height: 80 }],
    edges: [{ id: 'ab', source: 'a', target: 'b' }, { id: 'ba', source: 'b', target: 'a' }],
    density: 'comfortable', viewportWidth: 800,
  })
  assert.deepEqual(Object.keys(result.positions).sort(), ['a', 'b'])
  Object.values(result.positions).forEach(position => {
    assert.ok(Number.isFinite(position.x))
    assert.ok(Number.isFinite(position.y))
  })
})
