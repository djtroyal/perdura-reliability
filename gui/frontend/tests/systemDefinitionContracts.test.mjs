import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'vite'

const hmrServer = createHttpServer()
const vite = await createServer({
  root: new URL('..', import.meta.url).pathname,
  appType: 'custom',
  server: { middlewareMode: true, ws: { server: hmrServer } },
})

try {
  const model = await vite.ssrLoadModule('/src/components/SystemDefinition/model.ts')
  const legacy = {
    prediction: {
      _folioWrap: true,
      activeId: 'pred-1',
      folios: [{
        id: 'pred-1', name: 'Controller', state: {
          blocks: [{ id: 'b1', name: 'Electronics', parentId: null }],
          parts: [{
            id: 'p1', name: 'Pressure sensor', category: 'generic', quantity: 1,
            parentId: 'b1', part_number: 'PS-1', manufacturer: 'Perdura',
            reference_designators: ['PS1'], params: {},
          }],
        },
      }],
    },
    system: {
      _folioWrap: true, activeId: 'rbd-1', folios: [{ id: 'rbd-1', name: 'RBD', state: {
        nodes: [{ id: 'n1', type: 'component', data: { label: 'Pressure sensor' } }], edges: [],
      } }],
    },
  }
  const migrated = model.migrateSystemDefinitionModules(legacy)
  assert.ok(migrated.systemDefinition)
  assert.equal(migrated.systemDefinition.folios.length, 1)
  const state = migrated.systemDefinition.folios[0].state
  assert.equal(state.model.instances.length, 3, 'system, block, and part instances migrate')
  assert.equal(state.model.instances.find(item => item.name === 'Pressure sensor').quantity, 1)
  assert.equal(migrated.prediction.folios[0].state.parts[0].system_ref.system_model_id, state.model.id)
  assert.equal(migrated.system.folios[0].state.nodes[0].data.systemRef.system_model_id, state.model.id)
  assert.strictEqual(model.migrateSystemDefinitionModules(migrated), migrated,
    'migration is idempotent once the canonical slice exists')

  const fmeaOnly = model.migrateSystemDefinitionModules({
    fmea: {
      _folioWrap: true, activeId: 'fmea-1', folios: [{ id: 'fmea-1', name: 'Pump FMEA', state: {
        analyses: [{
          id: 'a1', name: 'Pump FMEA',
          structure_nodes: [{ id: 's1', name: 'Pump', element_type: 'component' }],
          functions: [{
            id: 'fn1', structure_node_id: 's1', description: 'Move fluid',
            function_type: 'primary', operating_modes: ['run'],
          }],
          failure_chains: [{
            id: 'fm1', function_id: 'fn1', failure_mode: 'No flow', deviation_id: 'absent',
          }],
          interfaces: [{
            id: 'if1', name: 'Pump discharge', source_structure_node_id: 's1',
            external_target: 'Plant header', interface_type: 'material',
            function_ids: ['fn1'],
          }],
        }],
      } }],
    },
  })
  const fmeaState = fmeaOnly.systemDefinition.folios[0].state
  assert.equal(fmeaState.model.modes[0].id, 'run', 'FMEA operating modes migrate as canonical modes')
  assert.equal(fmeaState.model.definitions[0].failure_modes[0].description, 'No flow')
  assert.equal(fmeaState.model.externals[0].name, 'Plant header')
  assert.equal(fmeaState.model.interfaces[0].target.external_id, fmeaState.model.externals[0].id)

  for (const count of [1, 2, 3, 4, 5]) {
    const ambiguous = model.migrateSystemDefinitionModules({
      prediction: {
        blocks: [], parts: Array.from({ length: count }, (_, index) => ({
          id: `pump-${index}`, name: index === 0 ? 'Pump' : ' PUMP ',
          category: 'generic', quantity: 1, params: {},
        })),
      },
      system: { nodes: [{ id: 'pump', type: 'component', data: { label: 'Pump' } }], edges: [] },
      fmea: { analyses: [{
        id: 'a1', name: 'Failures',
        structure_nodes: [{ id: 's1', name: 'Failure source', element_type: 'component' }],
        functions: [{ id: 'fn1', structure_node_id: 's1', description: 'Move fluid' }],
        failure_chains: Array.from({ length: count }, (_, index) => ({
          id: `failure-${index}`, function_id: 'fn1',
          failure_mode: index === 0 ? 'No flow' : 'no-flow', deviation_id: 'absent',
        })),
      }] },
      faultTree: { nodes: [{ id: 'no-flow', data: { label: 'No flow' } }], edges: [] },
      markov: { states: [{ id: 'pump', name: 'Pump' }, { id: 'no-flow', name: 'No flow' }] },
    })
    const linked = count === 1
    assert.equal(Boolean(ambiguous.system.nodes[0].data.systemRef), linked,
      `${count} normalized instance-name matches must ${linked ? '' : 'not '}link RBD records`)
    assert.equal(Boolean(ambiguous.faultTree.nodes[0].data.systemRef), linked,
      `${count} normalized failure-name matches must ${linked ? '' : 'not '}link FTA records`)
    assert.equal(Boolean(ambiguous.markov.states[0].systemRef), linked)
    assert.equal(Boolean(ambiguous.markov.states[1].systemRef), linked)
  }

  const rbdOnly = model.migrateSystemDefinitionModules({
    system: { nodes: [{ id: 'pump', type: 'component', data: { label: 'Pump' } }], edges: [] },
  })
  assert.equal(rbdOnly.systemDefinition.folios[0].state.model.instances.length, 2,
    'an RBD-only project receives a system root and canonical component')

  const unrelated = { growth: { input: 1 } }
  assert.strictEqual(model.migrateSystemDefinitionModules(unrelated), unrelated,
    'unrelated module exports do not gain a blank canonical slice')

  const blank = model.emptySystemDefinition('Pump', 'pump-1')
  assert.equal(blank.model.version, 2)
  assert.deepEqual(blank.model.propagation_assertions, [])
  assert.equal(blank.view, 'structure')
  assert.equal(model.decisionStatus(blank, 'missing'), 'pending')

  const upgradedV1 = model.migrateSystemDefinitionModules({
    systemDefinition: {
      ...blank, model: { ...blank.model, version: 1 }, view: 'architecture',
    },
  })
  assert.equal(upgradedV1.systemDefinition.model.version, 2,
    'existing canonical v1 folios upgrade without a global project schema bump')

  blank.model.instances = [
    { id: 'root', definition_id: 'd-root', name: 'Root' },
    ...Array.from({ length: 12 }, (_, index) => ({
      id: `child-${index}`, definition_id: 'd-child',
      parent_instance_id: 'root', name: `Child ${index}`,
    })),
    { id: 'grandchild', definition_id: 'd-child', parent_instance_id: 'child-0', name: 'Grandchild' },
  ]
  const layout = model.hierarchyLayout(blank.model)
  const byId = new Map(layout.map(item => [item.instance_id, item]))
  assert.ok(byId.get('root').x < byId.get('child-0').x)
  assert.ok(byId.get('child-0').x < byId.get('grandchild').x,
    'each indentation level must occupy the next diagram column')
  assert.equal(byId.get('child-0').x, byId.get('child-11').x,
    'siblings must align in the same indentation column')
  for (let left = 0; left < layout.length; left += 1) {
    for (let right = left + 1; right < layout.length; right += 1) {
      const a = layout[left]
      const b = layout[right]
      const overlaps = a.x < b.x + b.width && a.x + a.width > b.x
        && a.y < b.y + b.height && a.y + a.height > b.y
      assert.equal(overlaps, false, `${a.instance_id} must not overlap ${b.instance_id}`)
    }
  }
  assert.deepEqual(model.applyHierarchyLayout(blank.model).diagrams[0].nodes, layout,
    'the non-overlapping layout must be persisted for downstream diagrams')
  const rootCollapsed = model.hierarchyLayout(blank.model, ['root'])
  assert.deepEqual(rootCollapsed.map(item => item.instance_id), ['root'],
    'collapsing a parent must hide its entire descendant subtree')
  const branchCollapsed = model.hierarchyLayout(blank.model, ['child-0'])
  assert.ok(branchCollapsed.some(item => item.instance_id === 'child-0'))
  assert.ok(branchCollapsed.some(item => item.instance_id === 'child-11'))
  assert.ok(!branchCollapsed.some(item => item.instance_id === 'grandchild'),
    'a collapsed branch keeps its parent visible while hiding descendants')
  assert.deepEqual(model.emptySystemDefinition().collapsedInstanceIds, [],
    'new system diagrams start fully expanded')
  console.log('system definition contracts passed')
} finally {
  await vite.close()
  hmrServer.close()
}
