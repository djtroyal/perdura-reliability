import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite'
import { closeViteTestServer, ssrOnlyVitePlugin } from './viteTestLifecycle.mjs'

const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-interfaces-diagram-'))
const hmrServer = createHttpServer()
const vite = await createServer({
  root: new URL('..', import.meta.url).pathname, cacheDir, logLevel: 'error', appType: 'custom',
  server: { middlewareMode: true, ws: { server: hmrServer } }, plugins: [ssrOnlyVitePlugin()],
})

try {
  const { interfacesDiagramModel, retainHiddenDiagramData, setDiagramBranchVisibility, diagramEndpointInstance } = await vite.ssrLoadModule('/src/components/SystemDefinition/diagramProjection.ts')
  const { hierarchyLayout } = await vite.ssrLoadModule('/src/components/SystemDefinition/model.ts')
  const demo = JSON.parse(await readFile(new URL('../src/data/demoProject.json', import.meta.url), 'utf8'))
  const model = structuredClone(demo.modules.systemDefinition.model)
  const partDefinitions = new Set(model.definitions.filter(item => item.kind === 'piece_part').map(item => item.id))
  const parts = model.instances.filter(item => partDefinitions.has(item.definition_id))
  const part = parts[0]
  const root = model.root_instance_id
  const assembly = model.instances.find(item => !partDefinitions.has(item.definition_id) && item.id !== root).id
  model.externals = [
    { id: 'outside', name: 'Connected actor', kind: 'adjacent_system', ports: [] },
    { id: 'unused', name: 'Unconnected actor', kind: 'adjacent_system', ports: [] },
  ]
  const edge = (id, source, target) => ({
    id, name: id, source, target, interface_type: 'signal', linkage: 'direct', directionality: 'unidirectional',
    source_function_ids: [], target_function_ids: [], strength: 'unknown', nature: 'unknown',
    interface_detail: '', flow_description: '', operating_condition: '', mode_ids: [], properties: {},
  })
  model.interfaces = [
    edge('visible', { instance_id: root }, { instance_id: assembly }),
    edge('part-source', { instance_id: part.id }, { instance_id: assembly }),
    edge('part-target', { instance_id: assembly }, { instance_id: part.id }),
    edge('part-external', { external_id: 'outside' }, { instance_id: part.id }),
    edge('dangling', { instance_id: 'missing' }, { instance_id: assembly }),
  ]
  const node = (instance_id, x) => ({ instance_id, x, y: 80, width: 180, height: 72, expanded: false })
  model.diagrams[0].nodes = [node(root, 0), node(assembly, 240), node(part.id, 999)]
  const original = structuredClone(model)
  const visible = interfacesDiagramModel(model)

  assert.ok(parts.length > 0, 'Fixture must contain real canonical piece parts')
  assert.ok(parts.every(item => !visible.instances.some(instance => instance.id === item.id)))
  assert.deepEqual(visible.interfaces.map(item => item.id), ['visible', 'part-source', 'part-target', 'part-external'],
    'Keep real piece-part interfaces for inherited display and exclude dangling endpoints')
  assert.ok(diagramEndpointInstance(model, { instance_id: part.id }), 'A hidden piece-part endpoint resolves to its visible assembly')
  assert.deepEqual(visible.diagrams[0].nodes.map(item => item.instance_id), [root, assembly])
  assert.ok(hierarchyLayout(visible).every(item => !parts.some(part => part.id === item.instance_id)),
    'Automatic spacing must be calculated without hidden piece parts')
  assert.deepEqual(model, original, 'Opening the filtered Interfaces diagram must not mutate canonical data')

  const branchHidden = setDiagramBranchVisibility(model, assembly, false)
  assert.deepEqual(branchHidden.interfaces, model.interfaces, 'Visibility never deletes model connections')
  const branchShown = setDiagramBranchVisibility(branchHidden, assembly, true)
  assert.ok(branchShown.diagrams[0].nodes.find(item => item.instance_id === root)?.expanded, 'Revealing a child opens its ancestor path')

  const edited = structuredClone(model)
  edited.interfaces = [
    ...visible.interfaces.map((item, index) => index === 0 ? { ...item, name: 'Renamed visible connection' } : item),
    edge('new-visible', { instance_id: assembly }, { external_id: 'outside' }),
  ]
  edited.diagrams[0].nodes = visible.diagrams[0].nodes.map(item => ({ ...item, x: item.x + 100 }))
  const merged = retainHiddenDiagramData(model, edited, visible)
  assert.equal(merged.interfaces.find(item => item.id === 'visible').name, 'Renamed visible connection')
  assert.ok(merged.interfaces.some(item => item.id === 'new-visible'))
  for (const hidden of original.interfaces.filter(item => !visible.interfaces.some(edge => edge.id === item.id))) {
    assert.deepEqual(merged.interfaces.find(item => item.id === hidden.id), hidden,
      'Editing visible connections must preserve every hidden canonical interface')
  }
  assert.deepEqual(merged.diagrams[0].nodes.find(item => item.instance_id === part.id), original.diagrams[0].nodes[2],
    'Layout changes must retain stored positions and expansion state for piece parts')
  assert.equal(merged.diagrams[0].nodes.find(item => item.instance_id === root).x, 100)
  assert.deepEqual(merged.instances, original.instances)
  assert.deepEqual(merged.definitions, original.definitions)
  assert.deepEqual(model, original)

  const removedVisible = retainHiddenDiagramData(model, { ...edited, interfaces: [] }, visible)
  assert.deepEqual(removedVisible.interfaces, original.interfaces.filter(item => !visible.interfaces.some(edge => edge.id === item.id)),
    'Deleting visible edges must not delete hidden canonical edges')
  const hiddenActorModel = { ...model, interfaces: [...model.interfaces, edge('hidden-actor', { instance_id: 'missing' }, { external_id: 'outside' })] }
  assert.throws(() => retainHiddenDiagramData(hiddenActorModel, {
    ...edited, externals: edited.externals.filter(item => item.id !== 'outside'),
  }, visible), /actor is connected to interfaces hidden from this diagram/,
  'A referenced actor cannot be deleted through a view that hides its connections')
  const unconnected = retainHiddenDiagramData(model, {
    ...edited, externals: edited.externals.filter(item => item.id !== 'unused'),
  }, visible)
  assert.ok(!unconnected.externals.some(item => item.id === 'unused'))
  assert.deepEqual(model, original)
  console.log('PASS Interfaces diagram: piece-part rollup, branch visibility, ancestor expansion, safe writeback, retained hidden data, and actor deletion guard')
} finally {
  await closeViteTestServer(vite, cacheDir, hmrServer)
}
