import assert from 'node:assert/strict'
import { test } from 'node:test'
import { commitBlockDrag, resolveExpansionCollisions } from '../src/components/ReliabilityProgram/blockDiagramGeometry.ts'

const block = (id, x, y, parent, expanded = false) => ({
  id, kind: 'structure', structure_node_id: id, label: id,
  x, y, width: 180, height: 72, expanded, inside_boundary: true,
  ...(parent ? { container_parent_block_id: parent } : {}),
})
const diagram = () => ({
  version: 2, density: 'comfortable', snap_to_grid: false,
  viewport: { x: 0, y: 0, zoom: 1 },
  boundary: { label: 'System', x: -1000, y: -1000, width: 3000, height: 3000 },
  nodes: [block('root', 0, 0, undefined, true), block('assembly', 40, 60, 'root'),
    block('hidden', 60, 100, 'assembly'), block('sibling', 300, 60, 'root')],
})
const live = (id, x, y, parentId) => ({ id, position: { x, y }, parentId })
const at = (result, id) => result.nodes.find(node => node.id === id)

test('drag past right/bottom bounds preserves siblings, hidden subtree and compact block sizes', () => {
  const before = diagram(), snapshot = structuredClone(before)
  const after = commitBlockDrag(before, [live('root', 0, 0),
    live('assembly', 800, 500, 'root'), live('sibling', 300, 60, 'root')], 'assembly')
  assert.deepEqual([at(after, 'assembly').x, at(after, 'assembly').y], [800, 500])
  assert.deepEqual([at(after, 'hidden').x, at(after, 'hidden').y], [820, 540])
  assert.deepEqual(at(after, 'sibling'), at(before, 'sibling'))
  assert.deepEqual(after.nodes.map(node => [node.id, node.container_parent_block_id, node.width, node.height]),
    before.nodes.map(node => [node.id, node.container_parent_block_id, node.width, node.height]))
  assert.deepEqual(before, snapshot)
})

test('left/top growth rebases the parent without shifting other blocks or changing hierarchy', () => {
  const before = diagram()
  // React Flow has expanded/rebased the root and compensated the sibling.
  const after = commitBlockDrag(before, [live('root', -200, -100),
    live('assembly', 0, 0, 'root'), live('sibling', 500, 160, 'root')], 'assembly')
  assert.deepEqual([at(after, 'assembly').x, at(after, 'assembly').y], [-200, -100])
  assert.deepEqual([at(after, 'hidden').x, at(after, 'hidden').y], [-180, -60])
  assert.deepEqual(at(after, 'sibling'), at(before, 'sibling'))
  assert.ok(at(after, 'root').x <= -220)
  assert.ok(at(after, 'root').y <= -146)
  assert.equal(at(after, 'root').width, 180)
})

test('moving a fully collapsed assembly translates all hidden descendants together', () => {
  const before = diagram()
  at(before, 'root').expanded = false
  const after = commitBlockDrag(before, [live('root', 120, 240)], 'root')
  assert.deepEqual(after.nodes.map(node => [node.x, node.y]),
    before.nodes.map(node => [node.x + 120, node.y + 240]))
})

test('nested growth encloses each ancestor while retaining absolute positions of sibling blocks', () => {
  const before = diagram()
  at(before, 'assembly').expanded = true
  const after = commitBlockDrag(before, [live('root', -300, -200),
    live('assembly', 0, 0, 'root'), live('hidden', 0, 0, 'assembly'),
    live('sibling', 600, 260, 'root')], 'hidden')
  assert.deepEqual([at(after, 'hidden').x, at(after, 'hidden').y], [-300, -200])
  assert.deepEqual(at(after, 'sibling'), at(before, 'sibling'))
  assert.ok(at(after, 'assembly').x < at(after, 'hidden').x)
  assert.ok(at(after, 'root').x < at(after, 'assembly').x)
  assert.ok(at(after, 'root').y < at(after, 'assembly').y)
})

test('opening an assembly moves only intersecting siblings and their complete hidden branches', () => {
  const before = { ...diagram(), nodes: [
    block('opened', 0, 0, undefined, true), block('manual-child', 240, 60, 'opened'),
    block('neighbor', 260, 20), block('hidden-neighbor-child', 300, 80, 'neighbor'),
    block('untouched', 1000, 0),
  ] }
  const snapshot = structuredClone(before)
  const after = resolveExpansionCollisions(before, 'opened')
  assert.deepEqual(at(after, 'opened'), at(before, 'opened'))
  assert.deepEqual(at(after, 'manual-child'), at(before, 'manual-child'), 'Authored child placement is retained')
  assert.deepEqual(at(after, 'untouched'), at(before, 'untouched'))
  assert.ok(at(after, 'neighbor').y >= 172, 'The expanded branch gets room below its lowest child')
  assert.deepEqual([at(after, 'hidden-neighbor-child').x - at(after, 'neighbor').x,
    at(after, 'hidden-neighbor-child').y - at(after, 'neighbor').y], [40, 60])
  assert.deepEqual(after.nodes.map(node => [node.id, node.width, node.height, node.container_parent_block_id]),
    before.nodes.map(node => [node.id, node.width, node.height, node.container_parent_block_id]))
  assert.deepEqual(resolveExpansionCollisions(after, 'opened'), after, 'Reopening the same arrangement adds no drift')
  assert.deepEqual(resolveExpansionCollisions(before, 'opened'), after, 'Collision resolution is deterministic')
  assert.deepEqual(before, snapshot, 'The captured diagram is never mutated')
})

test('expansion cascades through colliding peers and grown ancestor containers', () => {
  const before = { ...diagram(), nodes: [
    block('outer', 0, 0, undefined, true), block('opened', 20, 60, 'outer', true),
    block('manual-child', 200, 120, 'opened'), block('first-peer', 300, 60, 'outer'),
    block('hidden-child', 330, 110, 'first-peer'), block('next-peer', 500, 60, 'outer'),
    block('outer-neighbor', 650, 0), block('outside-hidden', 675, 60, 'outer-neighbor'),
    block('unrelated', 2000, 0),
  ] }
  const after = resolveExpansionCollisions(before, 'opened')
  assert.ok(at(after, 'first-peer').x >= 420)
  assert.ok(at(after, 'next-peer').x >= 620 || at(after, 'next-peer').y >= 152,
    'A displaced sibling cannot cover the next sibling')
  assert.ok(at(after, 'outer-neighbor').x >= 720 || at(after, 'outer-neighbor').y >= 244,
    'Growth of the containing assembly also reserves room at its parent level')
  assert.equal(at(after, 'outside-hidden').x - at(after, 'outer-neighbor').x, 25)
  assert.equal(at(after, 'outside-hidden').y - at(after, 'outer-neighbor').y, 60)
  assert.deepEqual(at(after, 'unrelated'), at(before, 'unrelated'))
  assert.deepEqual(at(after, 'manual-child'), at(before, 'manual-child'))
})
