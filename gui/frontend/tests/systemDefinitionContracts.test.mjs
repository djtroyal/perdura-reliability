import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'vite'
import { readFile } from 'node:fs/promises'

const hmrServer = createHttpServer()
const vite = await createServer({
  root: new URL('..', import.meta.url).pathname,
  appType: 'custom',
  server: { middlewareMode: true, ws: { server: hmrServer } },
})

try {
  const model = await vite.ssrLoadModule('/src/components/SystemDefinition/model.ts')
  const shared = await vite.ssrLoadModule('/src/store/sharedSystemModel.ts')
  const project = await vite.ssrLoadModule('/src/store/project.ts')
  const architecture = await vite.ssrLoadModule('/src/store/systemArchitecture.ts')
  const fmeaBinding = await vite.ssrLoadModule('/src/store/sharedFmeaModel.ts')
  const editor = await vite.ssrLoadModule('/src/components/ReliabilityProgram/fmeaModel.ts')
  const current = shared.createProjectSystem('Canonical project')
  assert.equal(current.model.version, 4)
  assert.deepEqual(current.model.resources, [])
  assert.equal(current.model.instances.length, 1, 'A project begins with one canonical root')
  shared.validateProjectSystem(current.model)
  for (const version of [1, 2, 3]) assert.throws(() => shared.validateProjectSystem({ ...current.model, version }), /version 4/)
  project.newProject('Current destination')
  const original = project.getProjectState(), payload = project.buildExport(undefined, true)
  for (const schemaVersion of [6, 7, 9]) {
    assert.throws(() => project.importPayload({ ...payload, schemaVersion }), /Unsupported project schema/)
    assert.equal(project.getProjectState(), original, 'Rejected old files leave the current project untouched')
  }
  const demo = JSON.parse(await readFile(new URL('../src/data/demoProject.json', import.meta.url), 'utf8'))
  assert.equal(demo.schemaVersion, 11)
  const aircraft = demo.modules.systemDefinition.model
  const instances = new Map(aircraft.instances.map(item => [item.id, item]))
  const definitions = new Map(aircraft.definitions.map(item => [item.id, item]))
  const aircraftRoot = instances.get(aircraft.root_instance_id)
  assert.equal(aircraftRoot.name, 'Aircraft', 'The bundled example opens a complete aircraft architecture')
  const depth = item => item.parent_instance_id ? 1 + depth(instances.get(item.parent_instance_id)) : 1
  const systemItems = aircraft.instances.filter(item => definitions.get(item.definition_id)?.kind !== 'piece_part')
  const l2Systems = systemItems.filter(item => depth(item) === 2)
  assert.ok(l2Systems.length >= 6, 'Aircraft example spans multiple major aircraft systems')
  assert.ok(systemItems.filter(item => depth(item) === 3).length >= 12,
    'The example contains subsystem detail beyond a flat list of systems')
  assert.ok(systemItems.filter(item => depth(item) === 4).length >= 24,
    'Installed components reach L4 across the aircraft; piece parts do not stand in for components')
  for (const branch of l2Systems) {
    const descendsFrom = item => item?.parent_instance_id === branch.id
      || Boolean(item?.parent_instance_id && descendsFrom(instances.get(item.parent_instance_id)))
    assert.ok(systemItems.some(item => depth(item) >= 4 && descendsFrom(item)),
      `${branch.name} includes components at L4 or deeper`)
  }
  const owners = architecture.systemResourceProducers(aircraft)
  assert.equal(new Set(owners.map(owner => owner.resourceId)).size, owners.length,
    'Every output resource has exactly one producer, including reused equipment')
  assert.ok(aircraft.interfaces.length >= l2Systems.length,
    'The aircraft includes an interconnected resource architecture')
  shared.validateProjectSystem(demo.modules.systemDefinition.model)
  assert.deepEqual(architecture.inspectArchitectureCompleteness(demo.modules.systemDefinition.model), [],
    'Bundled architecture demonstrates complete structured functions, resource exchanges, and parent support')
  for (const folio of demo.modules.fmea.folios) for (const study of folio.state.analyses) {
    assert.deepEqual(editor.normalizeFmeaAnalysis(study), study, 'Bundled studies must already use current structured records')
    if (study.kind !== 'pfmea') {
      assert.deepEqual(fmeaBinding.inspectFmeaBinding(aircraft, study), [], 'Aircraft FMEA retains valid canonical references')
      assert.deepEqual(JSON.parse(JSON.stringify(fmeaBinding.materializeFmeaAnalysis(aircraft, study))), study,
        'Bundled FMEA already matches its aircraft architecture without needing a repair on first load')
      const structures = new Map(study.structure_nodes.map(item => [item.id, item]))
      const blocks = new Map(study.block_diagram.nodes.map(item => [item.id, item]))
      for (const edge of study.interfaces) {
        const canonical = aircraft.interfaces.find(item => item.id === edge.system_definition_ref?.interface_id)
        assert.ok(canonical, `FMEA interface ${edge.id} has a canonical source`)
        for (const end of ['source', 'target']) {
          const block = blocks.get(edge[`${end}_block_id`])
          assert.ok(block, `FMEA interface ${edge.id} ${end} block is present`)
          if (canonical[end].instance_id) assert.equal(structures.get(block.structure_node_id)?.system_definition_ref?.instance_id,
            canonical[end].instance_id, `FMEA interface ${edge.id} ${end} retains its actual installed endpoint`)
        }
      }
      const authored = study.failure_chains.find(item => item.id === (study.kind === 'dfmea' ? 'DFC-1' : 'MFC-1'))
      assert.equal(authored?.severity, 9, 'Existing authored risk ratings remain attached to their failure chain')
      assert.ok(authored.actions.some(item => item.id === (study.kind === 'dfmea' ? 'DACT-1' : 'MACT-1')),
        'Existing authored actions remain attached to their failure chain')
      assert.equal(study.system_binding.scope_instance_id, 'b1')
      assert.equal(instances.get('b1').parent_instance_id, 'pump-system')
      assert.equal(instances.get('pump-system').parent_instance_id, aircraft.root_instance_id)
    }
    const model = study.kind === 'pfmea' ? architecture.processArchitectureModel(study) : demo.modules.systemDefinition.model
    assert.deepEqual(architecture.inspectArchitectureCompleteness(model, {
      scopeInstanceId: study.system_binding?.scope_instance_id,
    }), [], `${study.kind} architecture prerequisites are complete`)
  }

  const blank = model.emptySystemDefinition('Pump', 'pump-1')
  assert.equal(blank.model.version, 4)
  assert.deepEqual(blank.model.propagation_assertions, [])
  assert.equal(blank.view, 'structure')
  assert.equal(model.decisionStatus(blank, 'missing'), 'pending')

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
  assert.deepEqual(model.emptySystemDefinition().structureCollapsedIds, [],
    'the structure tree owns its own expansion state')
  console.log('system definition contracts passed')
} finally {
  await vite.close()
  hmrServer.close()
}
