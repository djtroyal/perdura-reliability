import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'vite'
import {
  appendCompositionInstance, moveSystemSibling, reparentSystemInstance, systemHierarchyInstances, systemParentOptions, systemStructureRows,
} from '../src/components/SystemDefinition/structureEditing.ts'

const hmrServer = createHttpServer()
const vite = await createServer({ root: new URL('..', import.meta.url).pathname, appType: 'custom',
  server: { middlewareMode: true, ws: { server: hmrServer } } })
try {
  const sharedModel = await vite.ssrLoadModule('/src/store/sharedSystemModel.ts')
  const shared = await vite.ssrLoadModule('/src/store/sharedSystem.ts')
  const store = await vite.ssrLoadModule('/src/store/project.ts')
  const layout = await vite.ssrLoadModule('/src/components/SystemDefinition/model.ts')
  const system = sharedModel.createProjectSystem('Plant')
  const root = system.model.instances[0], rootId = root.id
  const definition = system.model.definitions[0]
  const node = (id, parent, kind = 'assembly') => ({ ...root, id, name: id.toUpperCase(),
    definition_id: kind, parent_instance_id: parent, source_metadata: { retained: id } })
  const model = { ...system.model, definitions: [definition,
    { ...definition, id: 'assembly', kind: 'assembly' }, { ...definition, id: 'piece_part', kind: 'piece_part' }],
    instances: [root, node('a', rootId), node('a-child', 'a'), node('a-part', 'a', 'piece_part'),
      node('root-part', rootId, 'piece_part'), node('b', rootId), node('b-child', 'b'), node('c', rootId)] }
  sharedModel.validateProjectSystem(model)
  const before = structuredClone(model)
  const ids = value => systemStructureRows(value).map(row => row.instance.id)
  assert.equal(systemHierarchyInstances(model, false), model.instances, 'other hierarchy consumers keep piece-part data')
  assert.deepEqual(systemHierarchyInstances(model, true).map(item => item.id),
    [rootId, 'a', 'a-child', 'b', 'b-child', 'c'], 'Installed Hierarchy excludes piece parts at every indenture')
  const partsOnlyAssembly = { ...model, instances: model.instances.filter(item => item.id !== 'a-child') }
  assert.equal(systemHierarchyInstances(partsOnlyAssembly, true).filter(item => item.parent_instance_id === 'a').length, 0,
    'a branch containing only hidden piece parts has no visible children or expansion indicator')
  assert.deepEqual(systemParentOptions(model, 'a').map(row => row.instance.id), [rootId, 'b', 'b-child', 'c'])
  for (const parent of ['a', 'a-child', 'a-part', 'root-part', 'missing', '']) {
    assert.throws(() => reparentSystemInstance(model, 'a', parent), /Choose an existing/)
  }
  assert.throws(() => reparentSystemInstance(model, rootId, 'b'), /root cannot/)
  assert.equal(reparentSystemInstance(model, 'a', rootId), model)

  const moved = moveSystemSibling(model, 'b', -1, false)
  assert.deepEqual(ids(moved), [rootId, 'b', 'b-child', 'a', 'a-child', 'a-part', 'root-part', 'c'],
    'moving up skips hidden piece-part siblings and moves the complete visible subtree')
  assert.equal(moved.instances.find(item => item.id === 'root-part'), model.instances.find(item => item.id === 'root-part'))
  assert.equal(moveSystemSibling(model, 'a', -1, false), model, 'top visible sibling is already at the boundary')
  assert.equal(moveSystemSibling(model, rootId, 1, true), model, 'the System root remains fixed')
  assert.deepEqual(ids(moveSystemSibling(model, 'b', -1, true)),
    [rootId, 'a', 'a-child', 'a-part', 'b', 'b-child', 'root-part', 'c'],
    'with piece parts shown, order controls include them as siblings')

  const reparented = reparentSystemInstance(moved, 'a', 'b')
  sharedModel.validateProjectSystem(reparented)
  assert.deepEqual(systemStructureRows(reparented).find(row => row.instance.id === 'a-child').ancestors, [rootId, 'b', 'a'])
  assert.deepEqual(reparented.instances.find(item => item.id === 'a-part').source_metadata, { retained: 'a-part' })
  assert.equal(reparented.instances.find(item => item.id === 'a-part').parent_instance_id, 'a')
  const linked = { ...model, instances: model.instances.map(item => item.id === 'a-child'
    ? { ...item, slot_id: 'slot-one', origin: 'definition_slot' } : item) }
  const detached = reparentSystemInstance(linked, 'a-child', 'b').instances.find(item => item.id === 'a-child')
  assert.equal(detached.origin, 'ad_hoc')
  assert.equal(detached.slot_id, undefined)
  assert.equal(detached.id, 'a-child', 'analysis references retain their occurrence identity')
  const detachedModel = reparentSystemInstance(linked, 'a-child', 'b')
  const proposed = linked.instances.find(item => item.id === 'a-child')
  const reinstalled = appendCompositionInstance(detachedModel.instances, proposed, () => 'reinstalled-child')
  assert.equal(reinstalled.find(item => item.id === 'a-child').parent_instance_id, 'b',
    'restoring a reusable slot cannot move the detached occurrence back or break its references')
  assert.equal(reinstalled.find(item => item.id === 'reinstalled-child').parent_instance_id, 'a')
  assert.equal(appendCompositionInstance(reinstalled, proposed, () => 'another-child'), reinstalled,
    'applying the same composition addition twice cannot duplicate its installed slot')
  assert.deepEqual(model, before, 'hierarchy editing is immutable')

  store.newProject('Structure editing')
  shared.commitProjectSystem({ ...system, model: layout.applyHierarchyLayout(reparented) })
  const persisted = JSON.parse(JSON.stringify(store.getProjectState().modules.systemDefinition))
  assert.deepEqual(ids(persisted.model), ids(reparented), 'sibling order and parent changes survive serialization')
  const scenario = sharedModel.emptyPredictionScenario({ standard: 'MIL-HDBK-217F', parts: [], blocks: [], blockSeq: 0 })
  const view = sharedModel.materializePrediction(persisted, scenario, { parts: [], blocks: [], blockSeq: 0 })
  assert.equal(view.blocks.find(block => block.id === 'a').parentId, 'b')
  assert.deepEqual(view.blocks.map(block => block.id), ['b', 'b-child', 'a', 'a-child', 'c'])
  assert.equal(view.parts.find(part => part.id === 'a-part').parentId, 'a')
  const points = new Map(persisted.model.diagrams[0].nodes.map(point => [point.instance_id, point]))
  assert.ok(points.get('b-child').y < points.get('a').y, 'diagram layout follows the same canonical child order')
  assert.ok(points.get('a').x > points.get('b').x, 'diagram indenture follows the new parent')
  console.log('PASS structure edit validation, visible sibling order, subtree moves, reusable slots, persistence, Prediction and layout')
} finally {
  await vite.close()
  hmrServer.close()
}
