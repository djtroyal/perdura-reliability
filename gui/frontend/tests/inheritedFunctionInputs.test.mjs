import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite'
import { closeViteTestServer, ssrOnlyVitePlugin } from './viteTestLifecycle.mjs'

const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-inherited-inputs-'))
const vite = await createServer({ root: new URL('..', import.meta.url).pathname, cacheDir, appType: 'custom', plugins: [ssrOnlyVitePlugin()],
  server: { middlewareMode: true, ws: { server: createHttpServer() } } })
try {
  const { projectInheritedInputs: project, projectFunctionInheritedInputs: projectFunction,
    projectFunctionInputSuppliers: inputSuppliers } = await vite.ssrLoadModule('/src/store/inheritedFunctionInputs.ts')
  const f = (id, inputs = [], output, role = 'transform') => ({ id, description: id, function_type: 'primary', mode_ids: [], definition: {
    role, action: id, io: [...inputs.map((resource_id, i) => ({ id: `in-${i}`, resource_id, direction: 'input' })),
      ...(output ? [{ id: 'out', resource_id: output, direction: 'output' }] : [])] } })
  const d = (id, functions) => ({ id, name: id, classification: '', description: '', part_number: '', manufacturer: '', category: '',
    ports: [], functions, failure_modes: [], child_slots: [] })
  const instance = (id, parent_instance_id, definition_id = `def-${id}`) => ({ id, name: id, definition_id, parent_instance_id, quantity: 1,
    reference_designators: [], mode_ids: [], function_overrides: [], failure_mode_overrides: [], legacy_refs: [] })
  const end = (instance_id, function_id, io_id) => ({ kind: 'function', instance_id, function_id, io_id })
  const route = (id, source, target, resource_id, mode_ids = []) => ({ id, name: id, interface_type: 'energy',
    source: source.kind === 'function' ? { instance_id: source.instance_id } : { external_id: source.external_id, port_id: source.port_id },
    target: { instance_id: target.instance_id }, directionality: 'directed', linkage: 'direct', interface_detail: '', flow_description: '',
    operating_condition: '', source_function_ids: [], target_function_ids: [], mode_ids: [],
    transfers: [{ id: `transfer-${id}`, kind: 'flow', source, target, resource_id, mode_ids }] })
  const support = (source, target, mode_ids = []) => ({ id: `support-${source.instance_id}-${source.function_id}-${target.instance_id}-${target.function_id}`,
    source, target, relationship: 'decomposes_to', rationale: '', mode_ids })
  const base = { version: 4, id: 'test', name: 'Test', revision: '', root_instance_id: 'aircraft',
    modes: ['run', 'standby'].map(id => ({ id, name: id, description: '' })),
    resources: ['battery', 'power', 'torque', 'thrust', 'coolant', 'cooling', 'cooled', 'ambient', 'unused'].map(id => ({ id, name: id, category: 'energy' })),
    instances: [instance('aircraft'), instance('system', 'aircraft'), instance('motor', 'system'), instance('cooler', 'system'),
      instance('orphan', 'system'), instance('supplier', 'aircraft')],
    definitions: [d('def-aircraft', [f('ready', [], undefined, 'maintain_state')]),
      d('def-system', [f('thrust', ['torque'], 'thrust'), f('cool', ['cooling'], 'cooled')]),
      d('def-motor', [f('convert', ['power'], 'torque')]), d('def-cooler', [f('cool', ['coolant'], 'cooling')]),
      d('def-orphan', [f('unassigned', ['ambient'], 'unused')]), d('def-supplier', [f('supply', ['battery'], 'power')])],
    externals: [{ id: 'environment', name: 'Environment', kind: 'environment', description: '',
      ports: ['battery', 'coolant', 'ambient'].map(id => ({ id, name: id, direction: 'output', interface_type: 'energy', description: '', resource_id: id })) }],
    interfaces: [route('power', end('supplier', 'supply', 'out'), end('motor', 'convert', 'in-0'), 'power'),
      route('torque', end('motor', 'convert', 'out'), end('system', 'thrust', 'in-0'), 'torque'),
      route('cooling', end('cooler', 'cool', 'out'), end('system', 'cool', 'in-0'), 'cooling'),
      ...[['coolant', 'cooler', 'cool'], ['ambient', 'orphan', 'unassigned'], ['battery', 'supplier', 'supply']].map(([id, block, fn]) =>
        route(id, { kind: 'external', external_id: 'environment', port_id: id }, end(block, fn, 'in-0'), id))],
    function_links: [support({ instance_id: 'system', function_id: 'thrust' }, { instance_id: 'motor', function_id: 'convert' }),
      support({ instance_id: 'system', function_id: 'cool' }, { instance_id: 'cooler', function_id: 'cool' })], propagation_rules: [], diagrams: [] }
  const clone = () => structuredClone(base)
  const p = (model = base, functionId = 'thrust', modeId = 'run') => projectFunction(model, { instanceId: 'system', functionId, modeId })
  const ids = rows => rows.map(item => item.resource.id).sort()
  const mutateFn = (model, block, fn) => model.definitions.find(item => item.id === `def-${block}`).functions.find(item => item.id === fn)
  const freeze = value => { if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child) } return value }

  const initial = p()
  assert.equal(initial.directInputCount, 1)
  assert.deepEqual(ids(initial.inheritedInputs), ['power'])
  assert.deepEqual(ids(p(base, 'cool').inheritedInputs), ['coolant'], 'Functions inherit only their own supporting requirements')
  assert.deepEqual(ids(project(base, { instanceId: 'system', modeId: 'run' }).unallocatedInputs), ['ambient'])
  assert.equal(initial.inheritedInputs[0].consumers[0].functionId, 'convert')
  assert.deepEqual(initial.inheritedInputs[0].consumers[0].interfaceIds, ['power'])
  assert.equal(initial.inheritedInputs[0].consumers[0].steps[0].kind, 'resource', 'Deterministic shortest witness prefers resource dependency')
  assert.equal(initial.inheritedInputs[0].supplierPath, 'aircraft › supplier')
  assert(!ids(initial.inheritedInputs).includes('battery'), 'Stop at the first upstream block boundary')
  assert.deepEqual(projectFunction(base, { instanceId: 'missing', functionId: 'missing' }).inheritedInputs, [])
  assert.equal(p(base, 'thrust', 'unknown-mode').inactive, true)

  const direct = clone()
  mutateFn(direct, 'system', 'thrust').definition.io.push({ id: 'direct-power', direction: 'input', resource_id: 'power' })
  direct.interfaces.push(route('direct-power', end('supplier', 'supply', 'out'), end('system', 'thrust', 'direct-power'), 'power'))
  assert.equal(p(direct).directInputCount, 2)
  assert.deepEqual(ids(p(direct).inheritedInputs), [])
  assert.deepEqual(ids(p(direct).sharedDirectInputs), ['power'], 'Direct resources retain their authored row and get child-use annotations')
  assert.equal(p(direct).sharedDirectInputs[0].consumers.length, 1)

  const peer = clone()
  mutateFn(peer, 'system', 'thrust').definition.io.push({ id: 'peer-input', direction: 'input', resource_id: 'cooled' })
  mutateFn(peer, 'system', 'cool').definition.io = [{ id: 'in-0', direction: 'input', resource_id: 'coolant' },
    { id: 'out', direction: 'output', resource_id: 'cooled' }]
  peer.interfaces.push(route('direct-coolant', { kind: 'external', external_id: 'environment', port_id: 'coolant' }, end('system', 'cool', 'in-0'), 'coolant'))
  peer.function_links = peer.function_links.filter(link => link.source.function_id !== 'cool')
  assert.deepEqual(ids(p(peer).inheritedInputs), ['power'], 'Outside inputs to a same-block peer function are not child inputs')

  const missing = clone(); missing.interfaces = missing.interfaces.filter(edge => edge.id !== 'power')
  assert.deepEqual(p(missing).inheritedInputs, [])
  assert.equal(p(missing).unresolvedInputs[0].kind, 'missing_route')
  assert.deepEqual(project(missing, { instanceId: 'system', modeId: 'run' }).unresolvedInputs, [],
    'An allocated unresolved input belongs to its function, not unallocated block context')
  const unresolvedOrphan = clone(); unresolvedOrphan.interfaces = unresolvedOrphan.interfaces.filter(edge => edge.id !== 'ambient')
  assert.equal(project(unresolvedOrphan, { instanceId: 'system', modeId: 'run' }).unresolvedInputs[0].instanceId, 'orphan')
  const duplicate = clone(); duplicate.definitions.push(d('def-copy', [f('copy', [], 'power', 'source')])); duplicate.instances.push(instance('copy', 'aircraft'))
  assert.equal(p(duplicate).unresolvedInputs[0].kind, 'ambiguous_producer')
  const unowned = clone(); mutateFn(unowned, 'supplier', 'supply').definition.io = []
  assert.equal(p(unowned).unresolvedInputs[0].kind, 'missing_producer')
  const inactive = clone(); mutateFn(inactive, 'supplier', 'supply').mode_ids = ['standby']
  assert.equal(p(inactive).unresolvedInputs[0].kind, 'inactive_producer')
  const disabled = clone(); disabled.instances.find(item => item.id === 'motor').function_overrides.push({ function_id: 'convert', enabled: false })
  assert.deepEqual(p(disabled).inheritedInputs, [])
  const unknown = clone(); mutateFn(unknown, 'motor', 'convert').definition.io[0].resource_id = 'unknown'
  assert.equal(p(unknown).unresolvedInputs[0].kind, 'missing_resource')
  const self = clone(); mutateFn(self, 'motor', 'convert').definition.io[0].resource_id = 'torque'
  assert.equal(p(self).unresolvedInputs[0].kind, 'self_input')
  const wrongCategory = clone(); wrongCategory.interfaces.find(edge => edge.id === 'power').interface_type = 'information'
  assert.equal(p(wrongCategory).unresolvedInputs[0].kind, 'incompatible_route')
  const ambiguous = clone(); ambiguous.interfaces.push({ ...structuredClone(ambiguous.interfaces[0]), id: 'other-power' })
  assert.equal(p(ambiguous).unresolvedInputs[0].kind, 'ambiguous_route')
  const inactiveRoute = clone(); inactiveRoute.interfaces[0].transfers[0].mode_ids = ['standby']
  assert.equal(p(inactiveRoute).unresolvedInputs[0].kind, 'missing_route')

  const reverse = clone(), reversedEdge = reverse.interfaces[0]
  ;[reversedEdge.source, reversedEdge.target] = [reversedEdge.target, reversedEdge.source]
  assert.equal(p(reverse).unresolvedInputs[0].kind, 'incompatible_route', 'Directed interface cannot carry a reverse transfer')
  reversedEdge.directionality = 'bidirectional'
  assert.deepEqual(ids(p(reverse).inheritedInputs), ['power'], 'Bidirectional interface obeys actual resource transfer direction')
  const ports = clone(); ports.definitions.find(item => item.id === 'def-motor').ports.push({ id: 'feed', name: 'Feed', direction: 'output', interface_type: 'energy', description: '' })
  mutateFn(ports, 'motor', 'convert').definition.io[0].port_id = 'feed'
  assert.equal(p(ports).unresolvedInputs[0].kind, 'incompatible_route')
  ports.definitions.find(item => item.id === 'def-motor').ports[0].direction = 'input'
  assert.deepEqual(ids(p(ports).inheritedInputs), ['power'])

  const supportOnly = clone(); mutateFn(supportOnly, 'system', 'thrust').definition.io = []
  assert.deepEqual(ids(p(supportOnly).inheritedInputs), ['power'], 'Valid parent allocation establishes a supporting requirement')
  const invalidSupport = structuredClone(supportOnly)
  invalidSupport.instances.find(item => item.id === 'motor').parent_instance_id = 'cooler'
  assert.deepEqual(p(invalidSupport).inheritedInputs, [], 'Skipped indenture allocations are not valid parent support')
  assert(ids(project(invalidSupport, { instanceId: 'system', modeId: 'run' }).unallocatedInputs).includes('power'))
  const causal = structuredClone(supportOnly); causal.function_links[0].relationship = 'depends_on'
  assert.deepEqual(p(causal).inheritedInputs, [], 'Generic causal links do not establish resource requirements')
  const maintain = structuredClone(supportOnly); mutateFn(maintain, 'system', 'thrust').definition.role = 'maintain_state'
  assert.deepEqual(ids(p(maintain).inheritedInputs), ['power'], 'Supporting descendants still have requirements when the parent maintains state')
  const deep = clone(); deep.resources.push({ id: 'condition', name: 'condition', category: 'energy' })
  deep.definitions.push(d('def-valve', [f('condition', ['coolant'], 'condition')]))
  deep.instances.push(instance('valve', 'motor'))
  deep.function_links.push(support({ instance_id: 'motor', function_id: 'convert' }, { instance_id: 'valve', function_id: 'condition' }))
  deep.interfaces.push(route('valve-feed', { kind: 'external', external_id: 'environment', port_id: 'coolant' }, end('valve', 'condition', 'in-0'), 'coolant'))
  const deepInput = p(deep).inheritedInputs.find(item => item.resource.id === 'coolant')
  assert.equal(deepInput.consumers[0].blockPath, 'aircraft › system › motor › valve')
  assert.deepEqual(deepInput.consumers[0].steps.map(step => [step.kind, step.to.instanceId]), [['resource', 'motor'], ['support', 'valve']])
  const sameBlock = clone(); sameBlock.resources.push({ id: 'conditioned', name: 'conditioned', category: 'energy' })
  sameBlock.definitions.find(item => item.id === 'def-motor').functions.push(f('prepare', ['power'], 'conditioned'))
  mutateFn(sameBlock, 'motor', 'convert').definition.io[0].resource_id = 'conditioned'
  sameBlock.interfaces[0].transfers[0].target.function_id = 'prepare'
  const sameBlockInput = p(sameBlock).inheritedInputs[0]
  assert.equal(sameBlockInput.consumers[0].functionId, 'prepare')
  assert.equal(sameBlockInput.consumers[0].steps.length, 2, 'Same-block producer dependencies do not require a diagram self-loop')

  const exclusive = clone(); exclusive.function_links = exclusive.function_links.filter(link => link.source.function_id !== 'thrust')
  exclusive.interfaces.find(edge => edge.id === 'torque').transfers[0].mode_ids = ['run']
  exclusive.interfaces.find(edge => edge.id === 'power').transfers[0].mode_ids = ['standby']
  assert.deepEqual(projectFunction(exclusive, { instanceId: 'system', functionId: 'thrust' }).inheritedInputs, [], 'All modes must not combine mutually exclusive edges into a path')
  const witnesses = clone(); witnesses.function_links[0].mode_ids = ['standby']
  witnesses.interfaces.find(edge => edge.id === 'torque').transfers[0].mode_ids = ['run']
  const traced = projectFunction(witnesses, { instanceId: 'system', functionId: 'thrust' }).inheritedInputs[0]
  assert.deepEqual(traced.modeIds, ['run', 'standby'])
  assert.equal(traced.consumers[0].witnesses.length, 2)
  assert.deepEqual(traced.consumers[0].witnesses.map(item => [item.steps[0].kind, item.modeIds]), [['resource', ['run']], ['support', ['standby']]])
  const separateRoutes = clone(); separateRoutes.interfaces[0].transfers[0].mode_ids = ['run']
  separateRoutes.interfaces.push(route('standby-power', end('supplier', 'supply', 'out'), end('motor', 'convert', 'in-0'), 'power', ['standby']))
  const routedWitnesses = projectFunction(separateRoutes, { instanceId: 'system', functionId: 'thrust' }).inheritedInputs[0].consumers[0].witnesses
  assert.deepEqual(routedWitnesses.map(witness => [witness.modeIds, witness.interfaceIds]), [[['run'], ['power']], [['standby'], ['standby-power']]],
    'The boundary input route remains attributable to its actual mode even when the internal allocation path is unchanged')
  const modeSupport = structuredClone(supportOnly); modeSupport.function_links[0].mode_ids = ['standby']
  assert.deepEqual(p(modeSupport).inheritedInputs, [])
  assert.deepEqual(ids(p(modeSupport, 'thrust', 'standby').inheritedInputs), ['power'])
  const partialIssue = structuredClone(supportOnly); partialIssue.function_links[0].mode_ids = ['run']
  partialIssue.interfaces = partialIssue.interfaces.filter(edge => edge.id !== 'power')
  const partialProjection = project(partialIssue, { instanceId: 'system' })
  assert.deepEqual(partialProjection.functions.thrust.unresolvedInputs[0].modeIds, ['run'])
  assert.deepEqual(partialProjection.unresolvedInputs[0].modeIds, ['standby'],
    'Block context includes only modes where the unresolved descendant has no function allocation')
  partialIssue.function_links.push(support({ instance_id: 'system', function_id: 'cool' }, { instance_id: 'motor', function_id: 'convert' }, ['standby']))
  assert.deepEqual(project(partialIssue, { instanceId: 'system' }).unresolvedInputs, [],
    'Different root functions can account for an unresolved input in different modes without duplicating it in block context')
  const noModes = clone(); noModes.modes = []
  assert.equal(projectFunction(noModes, { instanceId: 'system', functionId: 'thrust' }).inactive, false)
  assert.deepEqual(projectFunction(noModes, { instanceId: 'system', functionId: 'thrust' }).activeModeIds, [])

  const feedback = clone(); mutateFn(feedback, 'motor', 'convert').definition.io.push({ id: 'feedback', direction: 'input', resource_id: 'thrust' })
  feedback.interfaces.push(route('feedback', end('system', 'thrust', 'out'), end('motor', 'convert', 'feedback'), 'thrust'))
  assert.deepEqual(ids(p(feedback).inheritedInputs), ['power'])
  assert.equal(p(feedback).inheritedInputs[0].consumers[0].steps.length, 1, 'Feedback terminates with a shortest witness')

  const reused = clone(); reused.resources.push({ id: 'right-torque', name: 'torque', category: 'energy' })
  reused.instances.push({ ...instance('right-motor', 'system', 'def-motor'), function_overrides: [{ function_id: 'convert', resource_bindings: { out: 'right-torque' } }] })
  mutateFn(reused, 'system', 'thrust').definition.io.push({ id: 'right-in', direction: 'input', resource_id: 'right-torque' })
  reused.interfaces.push(route('right-power', end('supplier', 'supply', 'out'), end('right-motor', 'convert', 'in-0'), 'power'),
    route('right-torque', end('right-motor', 'convert', 'out'), end('system', 'thrust', 'right-in'), 'right-torque'))
  assert.equal(p(reused).inheritedInputs[0].consumers.length, 2, 'Installed consumers with a shared definition remain distinct')
  const copies = clone(); copies.resources.find(item => item.id === 'coolant').name = 'power'
  mutateFn(copies, 'system', 'thrust').definition.io.push({ id: 'other', direction: 'input', resource_id: 'cooling' })
  copies.interfaces.push(route('second-cooling', end('cooler', 'cool', 'out'), end('system', 'thrust', 'other'), 'cooling'))
  assert.deepEqual(ids(p(copies).inheritedInputs), ['coolant', 'power'], 'Equal resource names never merge distinct identities')

  const appearance = clone(); appearance.diagrams = [{ id: 'drawing', name: 'Drawing', hidden_instance_ids: ['motor', 'cooler'],
    nodes: [{ instance_id: 'system', x: 999, y: 400, width: 10, height: 20, expanded: false }] }]
  assert.deepEqual(p(appearance), p(), 'Visibility, size and layout have no semantic effect')
  const reordered = clone()
  for (const field of ['instances', 'definitions', 'resources', 'interfaces', 'function_links', 'modes']) reordered[field].reverse()
  for (const definition of reordered.definitions) definition.functions.reverse()
  assert.deepEqual(project(reordered, { instanceId: 'system' }), project(base, { instanceId: 'system' }), 'Array order does not change projections or witnesses')
  const frozen = freeze(clone()), before = JSON.stringify(frozen)
  project(frozen, { instanceId: 'system' }); assert.equal(JSON.stringify(frozen), before, 'Projection does not mutate even a frozen canonical graph')

  const bundled = JSON.parse(await readFile(new URL('../src/data/demoProject.json', import.meta.url), 'utf8')).modules.systemDefinition.model
  const aircraft = projectFunction(bundled, { instanceId: 'propulsion', functionId: 'perform', modeId: 'run' })
  assert.equal(aircraft.directInputCount, 2)
  assert.deepEqual(ids(aircraft.inheritedInputs), ['resource-atmosphere-terminal', 'resource-electrical-power-supply-high-voltage',
    'resource-flight-command-computer-perform', 'resource-thermal-environmental-supply-equipment-coolant'])
  assert(aircraft.inheritedInputs.every(item => item.consumers.length === 2))
  assert.deepEqual(aircraft.unresolvedInputs, [])
  const controller = project(bundled, { instanceId: 'b1', modeId: 'run' })
  assert.equal(controller.functions['DFN-3'].inheritedInputs.length, 2)
  assert.equal(controller.functions['MFN-1'].inheritedInputs.length, 1)
  assert.equal(controller.functions['MFN-2'].inheritedInputs.length, 1)
  const thermal = project(bundled, { instanceId: 'thermal-environmental', modeId: 'run' })
  const thermalFunctions = Object.values(thermal.functions).filter(fn => fn.inheritedInputs.length)
  assert.equal(thermalFunctions.length, 2)
  const thermalConsumers = thermalFunctions.map(fn => new Set(fn.inheritedInputs.flatMap(resource => resource.consumers.map(consumer => `${consumer.instanceId}/${consumer.functionId}`))))
  assert([...thermalConsumers[0]].every(consumer => !thermalConsumers[1].has(consumer)), 'Thermal functions retain distinct descendant provenance')

  const suppliers = (model = base, functionId = 'thrust', modeId = 'run') => inputSuppliers(model, { instanceId: 'system', functionId, modeId })
  assert.deepEqual(inputSuppliers(new Proxy({}, { get() { throw new Error('An unexpanded editor should not inspect the model') } }),
    { instanceId: 'system', functionId: '' }), {})
  const supplierIds = rows => rows.map(item => item.resourceId).sort()
  assert.deepEqual(supplierIds(suppliers()['in-0']), ['power'])
  assert.deepEqual(supplierIds(suppliers(base, 'cool')['in-0']), ['coolant'])
  assert.equal(suppliers()['in-0'][0].supplierLabel, 'supplier', 'Compact supplier names are installed names without breadcrumbs')
  assert.deepEqual(supplierIds(suppliers(direct)['direct-power']), ['power'], 'A direct outside producer is already the boundary supplier')
  const internalSource = clone(); mutateFn(internalSource, 'motor', 'convert').definition = {
    role: 'source', action: 'Provide torque', io: [{ id: 'out', direction: 'output', resource_id: 'torque' }] }
  assert.deepEqual(suppliers(internalSource)['in-0'], [], 'An internal source with no upstream inputs has no invented boundary suppliers')
  assert.deepEqual(supplierIds(suppliers(deep)['in-0']), ['power'], 'Child support alone must not contaminate the exact input resource chain')
  assert.deepEqual(supplierIds(suppliers(sameBlock)['in-0']), ['power'], 'Same-block producer IO can be followed without interface self-loops')
  assert.deepEqual(suppliers(missing)['in-0'], [], 'Missing initial or upstream transfers never produce supplier assertions')
  assert.deepEqual(suppliers(duplicate)['in-0'], [], 'Ambiguous resource owners remain unresolved')
  assert.deepEqual(suppliers(inactive)['in-0'], [], 'Inactive suppliers are excluded')
  assert.deepEqual(suppliers(ambiguous)['in-0'], [], 'Ambiguous active routes are excluded')
  assert.deepEqual(suppliers(wrongCategory)['in-0'], [], 'Incompatible resource routes are excluded')
  assert.deepEqual(supplierIds(suppliers(reverse)['in-0']), ['power'], 'Bidirectional transfers follow their actual IO direction')
  assert.deepEqual(supplierIds(suppliers(feedback)['in-0']), ['power'], 'Resource feedback terminates without losing valid boundary suppliers')
  assert.deepEqual(inputSuppliers(exclusive, { instanceId: 'system', functionId: 'thrust' })['in-0'], [],
    'Per-input all-mode projection never constructs a path from mutually exclusive transfers')
  assert.deepEqual(inputSuppliers(separateRoutes, { instanceId: 'system', functionId: 'thrust' })['in-0'][0].modeIds, ['run', 'standby'])
  assert.deepEqual(inputSuppliers(base, { instanceId: 'system', functionId: 'thrust', modeId: 'unknown-mode' })['in-0'], [])
  assert.deepEqual(inputSuppliers(frozen, { instanceId: 'system', functionId: 'thrust' }), inputSuppliers(base, { instanceId: 'system', functionId: 'thrust' }))
  assert.equal(JSON.stringify(frozen), before, 'Per-input projection leaves the canonical model untouched')
  assert.deepEqual(inputSuppliers(reordered, { instanceId: 'system', functionId: 'thrust' }), inputSuppliers(base, { instanceId: 'system', functionId: 'thrust' }))

  const channels = structuredClone(reused)
  channels.resources.push({ id: 'right-power', name: 'Right channel power', category: 'energy' })
  channels.definitions.find(item => item.id === 'def-supplier').functions.push(f('right-supply', [], 'right-power', 'source'))
  channels.instances.find(item => item.id === 'right-motor').function_overrides[0].resource_bindings['in-0'] = 'right-power'
  channels.interfaces = channels.interfaces.map(edge => edge.id === 'right-power'
    ? route('right-power', end('supplier', 'right-supply', 'out'), end('right-motor', 'convert', 'in-0'), 'right-power') : edge)
  assert.deepEqual(supplierIds(suppliers(channels)['in-0']), ['power'])
  assert.deepEqual(supplierIds(suppliers(channels)['right-in']), ['right-power'], 'Reused producer definitions preserve exact per-input occurrence bindings')
  mutateFn(channels, 'motor', 'convert').definition.io.push({ id: 'feedback', direction: 'input', resource_id: 'thrust' })
  channels.interfaces.push(route('left-feedback', end('system', 'thrust', 'out'), end('motor', 'convert', 'feedback'), 'thrust'))
  assert.deepEqual(supplierIds(suppliers(channels)['in-0']), ['power'], 'A feedback return to the consuming function cannot leak its right input into its left input')

  const aircraftSuppliers = inputSuppliers(bundled, { instanceId: 'propulsion', functionId: 'perform', modeId: 'run' })
  const expectedSuppliers = ['resource-atmosphere-terminal', 'resource-electrical-power-supply-high-voltage',
    'resource-flight-command-computer-perform', 'resource-thermal-environmental-supply-equipment-coolant']
  for (const ioId of ['in-propulsion-left-perform', 'in-propulsion-right-perform']) {
    assert.deepEqual(supplierIds(aircraftSuppliers[ioId]), expectedSuppliers)
    assert.deepEqual(aircraftSuppliers[ioId].map(row => row.supplierLabel),
      ['Ambient Atmosphere', 'Electrical Power System', 'Flight Command Computer', 'Thermal and Environmental System'])
    assert(aircraftSuppliers[ioId].every(row => row.resourceName && !row.supplierLabel.includes(' › ')))
  }
  const leftInterrupted = structuredClone(bundled)
  for (const edge of leftInterrupted.interfaces) edge.transfers = edge.transfers?.filter(transfer => !(transfer.kind === 'flow'
    && transfer.target.kind === 'function' && transfer.target.instance_id === 'motor-left'
    && transfer.resource_id === 'resource-thermal-environmental-supply-equipment-coolant'))
  const interruptedSuppliers = inputSuppliers(leftInterrupted, { instanceId: 'propulsion', functionId: 'perform', modeId: 'run' })
  assert.deepEqual(supplierIds(interruptedSuppliers['in-propulsion-left-perform']), expectedSuppliers.filter(id => !id.includes('coolant')))
  assert.deepEqual(supplierIds(interruptedSuppliers['in-propulsion-right-perform']), expectedSuppliers,
    'A disconnected left-channel resource does not change the right input or borrow its valid connection')
  console.log('Input suppliers and inherited projections: Aircraft, exact per-input channels, boundary stopping, routes, modes, feedback, reuse and immutability passed.')
} finally { await closeViteTestServer(vite, cacheDir) }
