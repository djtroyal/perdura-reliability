import assert from 'node:assert/strict'
import { readFile, mkdtemp } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite'
import { closeViteTestServer, ssrOnlyVitePlugin } from './viteTestLifecycle.mjs'
const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-architecture-'))
const vite = await createServer({ root: new URL('..', import.meta.url).pathname, cacheDir,
  appType: 'custom', plugins: [ssrOnlyVitePlugin()], server: { middlewareMode: true, ws: { server: createHttpServer() } } })
try {
  const lib = await vite.ssrLoadModule('/src/store/systemArchitecture.ts')
  const fixture = JSON.parse(await readFile(new URL('./fixtures/aircraftArchitecture.json', import.meta.url), 'utf8'))
  const check = (model, options = {}) => lib.inspectArchitectureCompleteness(model, options)
  const clone = () => structuredClone(fixture)
  const fn = (model, instance) => model.definitions.find(item => item.id === model.instances.find(item => item.id === instance).definition_id).functions[0]
  const codes = (model, options = {}) => new Set(check(model, options).map(item => item.code))
  assert.deepEqual(lib.validateArchitectureIntegrity(fixture), [])
  assert.deepEqual(check(fixture), [], 'A complete aircraft with explicit cross-level transfer is ready')
  assert.deepEqual(check(fixture, { scopeInstanceId: 'motor-controller' }), [])
  const dependency = lib.architectureDependencyScope(fixture, { scopeInstanceId: 'motor-controller' })
  assert.deepEqual([...dependency.instanceIds].sort(), ['aircraft', 'esps', 'motor-controller', 'propulsion'])
  assert.deepEqual([...dependency.interfaceIds], ['power-feed'])
  assert.equal(dependency.functionKeys.size, 4)
  const nullOverrides = clone(); nullOverrides.instances.find(item => item.id === 'motor-controller').function_overrides = [{ function_id: 'receive-power', enabled: true, description: null, mode_ids: null, definition: null }]
  assert.deepEqual(check(nullOverrides), [], 'Optional null API overrides inherit reusable definition fields')
  const incomplete = clone(); delete fn(incomplete, 'motor-controller').definition
  assert(codes(incomplete).has('missing_function_definition'))
  const unlinked = clone(); unlinked.function_links = unlinked.function_links.filter(link => link.id !== 'support-motor-controller')
  assert(codes(unlinked).has('missing_parent_support'))
  const wrongParent = clone(); wrongParent.function_links.find(link => link.id === 'support-motor-controller').source = { instance_id: 'aircraft', function_id: 'aircraft-ready' }
  assert.deepEqual(lib.validateArchitectureIntegrity(wrongParent), [], 'Reparenting can preserve stale allocations for repair'); assert(codes(wrongParent).has('invalid_parent_support')); assert(codes(wrongParent).has('missing_parent_support'))
  const modeGap = clone(); modeGap.function_links.find(link => link.id === 'support-motor-controller').mode_ids = ['running']
  assert(codes(modeGap).has('missing_parent_support')); assert.deepEqual(check(modeGap, { modeId: 'running' }), [])
  const transferGap = clone(); transferGap.interfaces[0].transfers[0].mode_ids = ['running']
  assert(codes(transferGap).has('incomplete_transfer_mode_coverage')); assert(codes(transferGap).has('unpaired_function_io'))
  assert.deepEqual(check(transferGap, { modeId: 'running' }), [])
  const modeSpecificPeer = clone()
  const peerDefinition = modeSpecificPeer.definitions.find(item => item.id === 'esps-definition')
  peerDefinition.functions.push({ ...structuredClone(peerDefinition.functions[0]), id: 'standby-supply' })
  const standbyTransfer = structuredClone(modeSpecificPeer.interfaces[0].transfers[0]); standbyTransfer.id = 'standby-transfer'
  standbyTransfer.source.function_id = 'standby-supply'; standbyTransfer.mode_ids = ['standby']; modeSpecificPeer.interfaces[0].transfers.push(standbyTransfer)
  assert(!lib.architectureDependencyScope(modeSpecificPeer, { scopeInstanceId: 'motor-controller', modeId: 'running' }).functionKeys.has(JSON.stringify(['esps', 'standby-supply'])), 'Inactive transfers do not pull unrelated peer functions into scoped validation')
  const functionGap = clone(); fn(functionGap, 'esps').mode_ids = ['running']
  assert(codes(functionGap).has('incomplete_transfer_mode_coverage'))
  const disabled = clone(); disabled.instances.find(item => item.id === 'esps').function_overrides = [{ function_id: 'supply-power', enabled: false }]
  assert(codes(disabled).has('incomplete_transfer_mode_coverage')); assert.deepEqual(lib.validateArchitectureIntegrity(disabled), [], 'Disabled referenced functions retain their saved allocations while blocking progression')
  const unrelated = clone(); unrelated.definitions.find(item => item.id === 'esps-definition').functions.push({ id: 'unrelated', description: '', function_type: 'supporting', mode_ids: [] })
  assert.deepEqual(check(unrelated, { scopeInstanceId: 'motor-controller' }), [], 'An unrelated function on a boundary peer does not lock the study')
  assert(!lib.architectureDependencyScope(unrelated, { scopeInstanceId: 'motor-controller' }).functionKeys.has(JSON.stringify(['esps', 'unrelated'])))
  assert(codes(unrelated).has('missing_function_definition'))
  const piece = clone()
  piece.definitions.push({ ...structuredClone(piece.definitions[0]), id: 'piece-def', name: 'Fastener', kind: 'piece_part', functions: [] })
  piece.instances.push({ ...structuredClone(piece.instances[0]), id: 'fastener', name: 'Fastener', definition_id: 'piece-def', parent_instance_id: 'propulsion' })
  assert.deepEqual(check(piece), [], 'Prediction-only pieces are exempt until included')
  assert(codes(piece, { includedPiecePartIds: ['fastener'] }).has('missing_function_coverage'))
  piece.interfaces.push({ ...structuredClone(piece.interfaces[0]), id: 'fastener-feed', target: { instance_id: 'fastener' }, transfers: [] })
  assert(codes(piece).has('missing_function_coverage'), 'Actual endpoint is included even when hidden')
  const source = lib.systemTransferOptions(fixture, fixture.interfaces[0].source), target = lib.systemTransferOptions(fixture, fixture.interfaces[0].target)
  assert.equal(lib.compatibleTransferPairs(source, target, 'energy', fixture.resources).length, 1)
  assert.equal(lib.compatibleTransferPairs(source, target, 'information', fixture.resources).length, 0)
  assert.equal(lib.compatibleTransferPairs([...source, { ...source[0], endpoint: { ...source[0].endpoint, function_id: 'another' } }], target, 'energy', fixture.resources).length, 2)
  const mismatch = clone(); mismatch.resources.push({ id: 'ac', name: 'AC supply', category: 'energy' }); fn(mismatch, 'motor-controller').definition.io[0].resource_id = 'ac'
  assert(codes(mismatch).has('incompatible_transfer_resource'))
  const reversed = clone(); [reversed.interfaces[0].transfers[0].source, reversed.interfaces[0].transfers[0].target] = [reversed.interfaces[0].transfers[0].target, reversed.interfaces[0].transfers[0].source]
  assert(codes(reversed).has('transfer_endpoint_mismatch'))
  const bidirectional = clone(); bidirectional.interfaces[0].directionality = 'bidirectional'; assert(codes(bidirectional).has('incompatible_transfer_direction'))
  const mismatchedPort = clone()
  const receiverDefinition = mismatchedPort.definitions.find(item => item.id === 'motor-controller-definition')
  receiverDefinition.ports = [{ id: 'input', name: 'Power input', interface_type: 'information', direction: 'input', description: '' }]
  receiverDefinition.functions[0].definition.io[0].port_id = 'input'
  assert(codes(mismatchedPort).has('incompatible_function_port'))
  receiverDefinition.ports[0].interface_type = 'energy'; receiverDefinition.ports[0].direction = 'output'
  assert(codes(mismatchedPort).has('incompatible_function_port'))
  receiverDefinition.ports[0].direction = 'input'; receiverDefinition.ports.push({ ...receiverDefinition.ports[0], id: 'other' })
  mismatchedPort.interfaces[0].target.port_id = 'other'
  assert(codes(mismatchedPort).has('incompatible_transfer_resource'), 'Selected IO must use the specific interface port when both are supplied')
  const transformation = clone(); fn(transformation, 'motor-controller').definition.io = fn(transformation, 'motor-controller').definition.io.filter(io => io.direction === 'input'); assert(codes(transformation).has('invalid_function_io'))
  const draft = clone(); draft.interfaces[0].transfers = []; assert.deepEqual(lib.validateArchitectureIntegrity(draft), []); assert(codes(draft).has('incomplete_interface_transfer'))
  const missing = clone(); fn(missing, 'motor-controller').definition.io[0].resource_id = 'missing'; assert(lib.validateArchitectureIntegrity(missing).some(item => item.code === 'missing_resource'))
  const moved = clone(); moved.diagrams[0].nodes[0].x += 1200; moved.diagrams[0].hidden_instance_ids = ['motor-controller']; assert.deepEqual(check(moved), [])
  const reused = clone(); reused.instances.push({ ...structuredClone(reused.instances.find(item => item.id === 'motor-controller')), id: 'backup', name: 'Backup', parent_instance_id: 'propulsion' })
  assert(check(reused).some(item => item.code === 'missing_parent_support' && item.instance_id === 'backup'))
  const process = { id: 'process', name: 'Process', revision: 'A', structure_nodes: [{ id: 'step', name: 'Assembly', description: '' }], resources: fixture.resources,
    functions: [{ id: 'process-ready', structure_node_id: 'step', description: '', function_type: 'primary', operating_modes: [], definition: structuredClone(fn(fixture, 'aircraft').definition) }],
    function_links: [], interfaces: [], block_diagram: { nodes: [] } }
  const converted = lib.processArchitectureModel(process); assert.equal(converted.root_instance_id, 'step'); assert.deepEqual(check(converted), [])
  console.log('Canonical structured architecture, occurrence support, scoped dependencies, modes and deterministic resource pairing passed.')
} finally { await closeViteTestServer(vite, cacheDir) }
