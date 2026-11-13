import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite'
import { closeViteTestServer, ssrOnlyVitePlugin } from './viteTestLifecycle.mjs'

const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-interface-resource-flows-'))
const hmrServer = createHttpServer()
const vite = await createServer({ root: new URL('..', import.meta.url).pathname, cacheDir,
  logLevel: 'error', appType: 'custom', server: { middlewareMode: true, ws: { server: hmrServer } }, plugins: [ssrOnlyVitePlugin()] })
try {
  const { interfaceResourceFlowProjector } = await vite.ssrLoadModule('/src/components/shared/interfaceResourceFlows.ts')
  const io = (id, resource_id, direction) => ({ id, resource_id, direction })
  const definition = (id, items) => ({ id, ports: [], functions: [{ id: 'fn', mode_ids: [],
    definition: { role: 'transform', action: id, io: items } }] })
  const instance = (id, definition_id) => ({ id, definition_id, mode_ids: [], function_overrides: [] })
  const endpoint = (instance_id, io_id) => ({ kind: 'function', instance_id, function_id: 'fn', io_id })
  const power = { id: 'power', kind: 'flow', resource_id: 'power', source: endpoint('a', 'power-out'),
    target: endpoint('b', 'power-in'), mode_ids: [] }
  const heat = { id: 'heat', kind: 'flow', resource_id: 'heat', source: endpoint('b', 'heat-out'),
    target: endpoint('a', 'heat-in'), mode_ids: [] }
  const model = {
    instances: [instance('a', 'source'), instance('b', 'sink')],
    definitions: [definition('source', [io('power-out', 'power', 'output'), io('heat-in', 'heat', 'input')]),
      definition('sink', [io('power-in', 'power', 'input'), io('heat-out', 'heat', 'output')])],
    resources: [{ id: 'power', category: 'energy' }, { id: 'heat', category: 'energy' }],
    modes: [{ id: 'run' }, { id: 'standby' }], externals: [],
  }
  const edge = { id: 'edge', interface_type: 'energy', directionality: 'bidirectional',
    source: { instance_id: 'a' }, target: { instance_id: 'b' }, mode_ids: [], transfers: [power, heat] }
  const endpoints = { source: 'diagram-a', target: 'diagram-b' }
  const forward = { source: 'diagram-a', target: 'diagram-b', resourceId: 'power' }
  const reverse = { source: 'diagram-b', target: 'diagram-a', resourceId: 'heat' }
  const snapshot = structuredClone({ model, edge })
  const project = interfaceResourceFlowProjector(model)
  assert.deepEqual(project(edge, endpoints), [forward, reverse], 'Each resource retains its real direction on a bidirectional interface')
  assert.deepEqual(project({ ...edge, directionality: 'directed' }, endpoints), [forward], 'A directed interface cannot establish a reverse transfer')
  assert.deepEqual(project({ ...edge, transfers: [...edge.transfers, { ...power, id: 'duplicate' }] }, endpoints), [forward, reverse], 'Duplicate endpoint/resource flows count once')
  assert.deepEqual(project({ ...edge, transfers: [{ kind: 'relation', source: { kind: 'block', instance_id: 'a' },
    target: { kind: 'block', instance_id: 'b' } }] }, endpoints), [], 'Physical relations do not imply resource direction')
  assert.deepEqual(project({ ...edge, transfers: [] }, endpoints), [], 'An arrow without resources cannot imply a supplier')
  assert.deepEqual(project(edge, { source: 'assembly', target: 'other' }), [
    { source: 'assembly', target: 'other', resourceId: 'power' }, { source: 'other', target: 'assembly', resourceId: 'heat' },
  ], 'Canonical terminals resolve to caller-provided piece-part proxies without losing direction')
  assert.deepEqual(project(edge, { source: 'assembly', target: 'assembly' }), [], 'Transfers internal to one display proxy do not create external suppliers')
  assert.deepEqual(project({ ...edge, transfers: [{ ...power, source: endpoint('b', 'heat-out') }] }, endpoints), [], 'Mismatched canonical terminals are ignored')
  assert.deepEqual(project({ ...edge, transfers: [{ ...power, resource_id: 'heat' }] }, endpoints), [], 'Assigned resource must match the installed IO')
  assert.deepEqual(project({ ...edge, transfers: [{ ...power, source: endpoint('a', 'missing') }] }, endpoints), [], 'Missing IO does not qualify')

  const scoped = structuredClone(model)
  scoped.definitions[0].functions[0].mode_ids = ['run']
  scoped.definitions[1].functions[0].mode_ids = ['standby']
  assert.deepEqual(interfaceResourceFlowProjector(structuredClone(scoped))(edge, endpoints), [], 'All modes cannot join mutually exclusive producers and consumers')
  scoped.definitions[1].functions[0].mode_ids = ['run']
  const scopedEdge = { ...edge, transfers: [{ ...power, mode_ids: ['run'] }, { ...heat, mode_ids: ['standby'] }] }
  assert.deepEqual(interfaceResourceFlowProjector(structuredClone(scoped))(scopedEdge, endpoints), [forward])
  assert.deepEqual(interfaceResourceFlowProjector(model, 'run')(scopedEdge, endpoints), [forward], 'FMEA binding mode applies to individual transfers')
  assert.deepEqual(interfaceResourceFlowProjector(model, 'standby')(scopedEdge, endpoints), [reverse])
  assert.deepEqual(interfaceResourceFlowProjector(model, 'missing')(edge, endpoints), [], 'A deleted bound mode cannot reveal unrelated flows')
  assert.deepEqual(interfaceResourceFlowProjector(model, 'run')({ ...edge, mode_ids: ['standby'] }, endpoints), [], 'The interface itself must also be active')
  scoped.instances[0].mode_ids = ['standby']
  assert.deepEqual(interfaceResourceFlowProjector(structuredClone(scoped))(edge, endpoints), [], 'Installed-block applicability participates in the same mode intersection')
  scoped.instances[0].mode_ids = []
  scoped.instances[0].function_overrides = [{ function_id: 'fn', enabled: false }]
  assert.deepEqual(interfaceResourceFlowProjector(structuredClone(scoped))(edge, endpoints), [], 'Disabled installed functions are excluded')

  const reused = structuredClone(model)
  reused.instances.push({ ...instance('a2', 'source'), function_overrides: [{ function_id: 'fn', resource_bindings: { 'power-out': 'heat' } }] })
  const reusedEdge = { ...edge, source: { instance_id: 'a2' }, transfers: [{ ...power, source: endpoint('a2', 'power-out') }] }
  assert.deepEqual(interfaceResourceFlowProjector(reused)(reusedEdge, endpoints), [], 'Repeated definitions preserve occurrence-specific resource bindings')
  assert.deepEqual(interfaceResourceFlowProjector(reused)(edge, endpoints), [forward, reverse], 'One installed override does not change another occurrence')

  const external = structuredClone(model)
  external.externals.push({ id: 'actor', ports: [{ id: 'power-port', resource_id: 'power', interface_type: 'energy', direction: 'output' }] })
  const externalEdge = { ...edge, source: { external_id: 'actor', port_id: 'power-port' },
    transfers: [{ ...power, source: { kind: 'external', external_id: 'actor', port_id: 'power-port' } }] }
  assert.deepEqual(interfaceResourceFlowProjector(external)(externalEdge, { source: 'actor-proxy', target: 'diagram-b' }), [
    { source: 'actor-proxy', target: 'diagram-b', resourceId: 'power' },
  ], 'External resource suppliers use the existing diagram actor identity')
  external.externals[0].ports[0].direction = 'input'
  assert.deepEqual(interfaceResourceFlowProjector(external)(externalEdge, endpoints), [], 'An external input terminal cannot provide resources')
  assert.deepEqual({ model, edge }, snapshot, 'Direction projection is read-only')

  const { projectFmeaDiagram } = await vite.ssrLoadModule('/src/components/ReliabilityProgram/fmeaDiagramProjection.ts')
  const boundModel = { ...model, id: 'model', interfaces: [scopedEdge] }
  const analysis = { system_binding: { mode_id: 'run' },
    structure_nodes: model.instances.map(item => ({ id: `structure-${item.id}`, system_definition_ref: { system_model_id: 'model', instance_id: item.id } })),
    interfaces: [{ id: 'fmea-interface', directionality: 'bidirectional', system_definition_ref: { interface_id: edge.id } }],
    block_diagram: { nodes: model.instances.map(item => ({ id: `fmea-${item.id}`, kind: 'structure',
      structure_node_id: `structure-${item.id}`, x: 0, y: 0, width: 180, height: 72 })) },
  }
  const bound = projectFmeaDiagram(boundModel, analysis, 'b')
  assert.deepEqual(bound.interfaceResourceFlows, { 'fmea-interface': [{ source: 'fmea-a', target: 'fmea-b', resourceId: 'power' }] },
    'FMEA metadata preserves its interface identity, mapped endpoints, boundary scope and bound mode')
  assert.deepEqual(bound.interfaceResourceIds, { 'fmea-interface': ['power'] }, 'Resource selection and resource direction share the same applicable transfer set')

  const demo = JSON.parse(await readFile(new URL('../src/data/demoProject.json', import.meta.url), 'utf8'))
  const aircraft = demo.modules.systemDefinition.model
  const aircraftProject = interfaceResourceFlowProjector(aircraft)
  const flows = aircraft.interfaces.flatMap(item => aircraftProject(item, {
    source: item.source.instance_id ?? item.source.external_id, target: item.target.instance_id ?? item.target.external_id,
  }))
  assert.ok(flows.some(flow => flow.resourceId.includes('hv') || aircraft.resources.find(item => item.id === flow.resourceId)?.name.includes('high-voltage')),
    'Aircraft exposes confirmed high-voltage power supplies')
  assert.ok(flows.length > 100, 'Detailed Aircraft resource connections remain available')
  console.log('Interface resource flow metadata: direction, operating modes, installed overrides, proxies, external actors, and Aircraft passed.')
} finally {
  await closeViteTestServer(vite, cacheDir, hmrServer)
}
