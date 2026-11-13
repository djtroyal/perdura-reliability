import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ALL_RESOURCES, UNASSIGNED_RESOURCE, connectedDiagramNodeIds, defaultInterfaceDiagramFilters,
  interfaceMatchesFilters, parseInterfaceDiagramFilters, projectInterfaceDiagramFilters, resourceFilterValue,
  diagramSelectionScope, interfaceMatchesConnections,
} from '../src/components/shared/interfaceDiagramFilters.ts'
import { interfaceAggregationKey } from '../src/components/shared/hierarchicalDiagram.ts'
import { commitBlockDrag } from '../src/components/ReliabilityProgram/blockDiagramGeometry.ts'
import { hiddenIdsAfterInterfaceEdits } from '../src/components/SystemDefinition/interfaceDiagramEdits.ts'

const block = (id, parent, x = 0) => ({ id, kind: 'structure', structure_node_id: id, label: id,
  container_parent_block_id: parent, expanded: false, x, y: 80, width: 180, height: 72, inside_boundary: true })
const edge = (id, source, target, type = 'energy') => ({ id, name: id, interface_type: type,
  source_block_id: source, target_block_id: target, directionality: 'directed', linkage: 'direct' })
const nodes = [block('assembly', undefined, 20), block('a', 'assembly', 40), block('b', 'assembly', 240),
  block('focus', undefined, 800), block('isolated', undefined, 1000), { ...block('actor', undefined, 1200), kind: 'external' }]
const interfaces = [edge('power', 'a', 'actor'), edge('combined', 'a', 'b'),
  edge('data', 'b', 'actor', 'information'), edge('mount', 'a', 'b', 'physical'), edge('missing', 'a', 'absent')]
const resourceIds = { power: ['electricity'], combined: ['electricity', 'heat', 'electricity'], data: ['status'] }

test('resource filters retain whole multi-transfer records once and combine with interface type', () => {
  const snapshot = structuredClone({ nodes, interfaces, resourceIds })
  const filters = { ...defaultInterfaceDiagramFilters(), resource: resourceFilterValue('electricity') }
  const projection = projectInterfaceDiagramFilters(interfaces, nodes, filters, resourceIds)
  assert.equal(projection.eligible.length, 4, 'Dangling endpoints are outside the rendered scope')
  assert.deepEqual(projection.matching.map(value => value.item.id), ['power', 'combined'])
  assert.equal(projection.matching[1].item, interfaces[1], 'The complete canonical record is retained')
  assert.equal(projectInterfaceDiagramFilters(interfaces, nodes, { ...filters, types: ['information'] }, resourceIds).matching.length, 0)
  assert.notEqual(interfaceAggregationKey('assembly', 'actor', interfaces[0], resourceIds.power),
    interfaceAggregationKey('assembly', 'actor', interfaces[1], resourceIds.combined), 'Matching A does not merge A-only with A+B interfaces')
  assert.deepEqual({ nodes, interfaces, resourceIds }, snapshot, 'Projection never writes canonical data')
})

test('unassigned includes resource-free physical connections while explicit resource ignores them', () => {
  const filters = { ...defaultInterfaceDiagramFilters(), resource: UNASSIGNED_RESOURCE }
  assert.deepEqual(projectInterfaceDiagramFilters(interfaces, nodes, filters, resourceIds).matching.map(value => value.item.id), ['mount'])
  assert.ok(interfaceMatchesFilters(interfaces[3], [], { ...filters, resource: ALL_RESOURCES }))
  assert.equal(projectInterfaceDiagramFilters(interfaces, nodes, { ...filters, types: [] }, resourceIds).matching.length, 0)
})

test('connected-only retains collapsed internal endpoints and ancestors, not unrelated blocks or actors', () => {
  const filters = { ...defaultInterfaceDiagramFilters(), resource: resourceFilterValue('heat'), onlyConnected: true }
  const projection = projectInterfaceDiagramFilters(interfaces, nodes, filters, resourceIds)
  const retained = connectedDiagramNodeIds(nodes, projection.matching)
  assert.deepEqual([...retained].sort(), ['a', 'assembly', 'b'])
  assert.deepEqual([...connectedDiagramNodeIds(nodes, [], ['focus'])], ['focus'], 'An empty FMEA filter still keeps its active focus')
  assert.deepEqual([...connectedDiagramNodeIds(nodes, [], ['a'])].sort(), ['a', 'assembly'], 'Focused child retains required parent context')
})

test('FMEA endpoint scope precedes display filters and retains canonical interface ownership', () => {
  const projection = projectInterfaceDiagramFilters(interfaces, nodes, defaultInterfaceDiagramFilters(), resourceIds,
    { power: { source: 'assembly', target: 'actor' } })
  assert.deepEqual(projection.matching.map(value => [value.item.id, value.source, value.target]), [['power', 'assembly', 'actor']])
  assert.equal(projection.matching[0].item.source_block_id, 'a', 'Display roll-up cannot rewrite the underlying source')
})

test('saved filters tolerate missing resources and malformed browser preferences', () => {
  const resources = [{ id: 'electricity', name: '28 V DC' }]
  assert.deepEqual(parseInterfaceDiagramFilters('{invalid', resources), defaultInterfaceDiagramFilters())
  assert.deepEqual(parseInterfaceDiagramFilters(JSON.stringify({ types: ['energy', 'unknown', 'energy'],
    resource: resourceFilterValue('deleted'), onlyConnected: true }), resources),
  { types: ['energy'], resource: ALL_RESOURCES, onlyConnected: true, connections: 'all' })
  assert.equal(parseInterfaceDiagramFilters(JSON.stringify({ resource: resourceFilterValue('electricity') }), resources).resource, resourceFilterValue('electricity'))
  assert.equal(parseInterfaceDiagramFilters(JSON.stringify({ resource: UNASSIGNED_RESOURCE }), resources).resource, UNASSIGNED_RESOURCE)
})

test('selected-system supplier and recipient filters use resource flow direction across its boundary', () => {
  const scope = diagramSelectionScope(nodes, [], { nodeId: 'assembly' })
  assert.deepEqual([...scope].sort(), ['a', 'assembly', 'b'], 'Collapsed children remain in the selected assembly scope')
  const flows = {
    power: [{ source: 'actor', target: 'a', resourceId: 'electricity' }],
    combined: [{ source: 'a', target: 'b', resourceId: 'heat' }],
    data: [{ source: 'b', target: 'actor', resourceId: 'status' }],
  }
  const filters = { ...defaultInterfaceDiagramFilters(), connections: 'suppliers' }
  const project = settings => projectInterfaceDiagramFilters(interfaces, nodes, settings, resourceIds, undefined, flows, scope).matching.map(value => value.item.id)
  assert.deepEqual(project(filters), ['power'], 'An incoming transfer qualifies even when the drawn edge points the other way')
  assert.deepEqual(project({ ...filters, connections: 'recipients' }), ['data'])
  assert.deepEqual(project({ ...filters, connections: 'both' }), ['power', 'data'], 'Internal and relation-only connections are excluded')
  assert.deepEqual(project({ ...filters, types: ['information'] }), [], 'Direction intersects the type filter')
  assert.deepEqual([...connectedDiagramNodeIds(nodes, [], ['assembly'])], ['assembly'], 'A selected block survives an empty result')
  assert.deepEqual([...connectedDiagramNodeIds(nodes, [], [], ['actor'])], ['actor'], 'External selections also survive an empty result')
})

test('resource and directional filters must match the same transfer on a bidirectional interface', () => {
  const flows = [{ source: 'actor', target: 'a', resourceId: 'electricity' }, { source: 'a', target: 'actor', resourceId: 'status' }]
  const scope = new Set(['a']), filters = { ...defaultInterfaceDiagramFilters(), connections: 'suppliers', resource: resourceFilterValue('electricity') }
  assert.equal(interfaceMatchesConnections(flows, filters, scope), true)
  assert.equal(interfaceMatchesConnections(flows, { ...filters, connections: 'recipients' }, scope), false)
  assert.equal(interfaceMatchesConnections(flows, { ...filters, connections: 'recipients', resource: resourceFilterValue('status') }, scope), true)
  assert.equal(interfaceMatchesConnections([], filters, scope), false, 'Missing transfers cannot imply resource suppliers')
  assert.equal(interfaceMatchesConnections(flows, { ...filters, resource: UNASSIGNED_RESOURCE }, scope), false)
  assert.equal(interfaceMatchesConnections([], filters), true, 'No selection suspends the directional filter until a block is selected')
})

test('implicit root selection uses installed indenture even without a root endpoint card', () => {
  const structures = [{ id: 'root' }, { id: 'assembly', parent_id: 'root' }, { id: 'a', parent_id: 'assembly' }, { id: 'b', parent_id: 'assembly' }]
  assert.deepEqual([...diagramSelectionScope(nodes, structures, { structureId: 'root' })].sort(), ['a', 'assembly', 'b'])
  assert.deepEqual([...diagramSelectionScope(nodes, structures, { nodeId: 'actor' })], ['actor'])
  assert.equal(parseInterfaceDiagramFilters(JSON.stringify({ connections: 'recipients' }), []).connections, 'recipients')
  assert.equal(parseInterfaceDiagramFilters(JSON.stringify({ connections: 'invalid' }), []).connections, 'all')
})

test('editing a filtered canvas preserves omitted nodes and the complete stored branch', () => {
  const diagram = { nodes: structuredClone(nodes), boundary: { x: -100, y: -100, width: 2000, height: 2000 },
    density: 'comfortable', viewport: { x: 0, y: 0, zoom: 1 }, snap_to_grid: false }
  const snapshot = structuredClone(diagram)
  const after = commitBlockDrag(diagram, [{ id: 'assembly', position: { x: 120, y: 180 } }], 'assembly')
  assert.deepEqual(after.nodes.map(item => item.id), diagram.nodes.map(item => item.id))
  for (const id of ['focus', 'isolated', 'actor']) assert.deepEqual(after.nodes.find(item => item.id === id), diagram.nodes.find(item => item.id === id))
  for (const id of ['a', 'b']) {
    const original = diagram.nodes.find(item => item.id === id), changed = after.nodes.find(item => item.id === id)
    assert.deepEqual([changed.x - original.x, changed.y - original.y], [100, 100], 'Moving a retained parent translates hidden descendants')
  }
  assert.deepEqual(diagram, snapshot)
})

test('drawing or retargeting at context-only parents selects only the connector endpoint blocks', () => {
  const previous = { id: 'existing', source: { instance_id: 'a' }, target: { external_id: 'actor' } }
  const model = {
    root_instance_id: 'root', interfaces: [previous],
    definitions: [{ id: 'assembly-def', kind: 'assembly' }, { id: 'part-def', kind: 'piece_part' }],
    instances: [
      { id: 'root', definition_id: 'assembly-def' },
      { id: 'assembly', definition_id: 'assembly-def', parent_instance_id: 'root' },
      { id: 'a', definition_id: 'assembly-def', parent_instance_id: 'assembly' },
      { id: 'b', definition_id: 'assembly-def', parent_instance_id: 'assembly' },
      { id: 'part', definition_id: 'part-def', parent_instance_id: 'b' },
    ],
    diagrams: [{ hidden_instance_ids: ['assembly', 'b', 'part'], nodes: structuredClone(nodes) }],
  }
  const snapshot = structuredClone(model)
  const added = { id: 'new', source: { instance_id: 'assembly' }, target: { external_id: 'actor' } }
  assert.deepEqual(hiddenIdsAfterInterfaceEdits(model, [previous, added]), ['b', 'part'], 'A new parent connection remains eligible without revealing its hidden children')
  assert.deepEqual(hiddenIdsAfterInterfaceEdits(model, [{ ...previous, source: { instance_id: 'assembly' } }]), ['b', 'part'])
  assert.deepEqual(hiddenIdsAfterInterfaceEdits(model, [{ ...previous, name: 'Rename only' }]), ['assembly', 'b', 'part'], 'Unrelated edits preserve selections exactly')
  assert.deepEqual(hiddenIdsAfterInterfaceEdits(model, [{ ...added, source: { instance_id: 'part' } }]), ['assembly', 'part'], 'A piece-part endpoint selects only its eligible assembly proxy')
  assert.deepEqual(model, snapshot, 'Endpoint reveal never changes canonical records, collapse, or coordinates')
})
