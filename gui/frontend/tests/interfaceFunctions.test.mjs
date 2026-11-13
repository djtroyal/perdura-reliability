import assert from 'node:assert/strict'
import { readFile, mkdtemp } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite'
import { closeViteTestServer, ssrOnlyVitePlugin } from './viteTestLifecycle.mjs'
const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-interface-functions-'))
const vite = await createServer({ root: new URL('..', import.meta.url).pathname, cacheDir,
  appType: 'custom', plugins: [ssrOnlyVitePlugin()], server: { middlewareMode: true, ws: { server: createHttpServer() } } })
try {
  const { populateSystemInterfaceFunctions: populate, populateFmeaInterfaceFunctions: local } = await vite.ssrLoadModule('/src/store/interfaceFunctions.ts')
  const model = JSON.parse(await readFile(new URL('./fixtures/aircraftArchitecture.json', import.meta.url), 'utf8'))
  const baseline = populate(model)
  assert.equal(populate(baseline), baseline, 'Reconciliation is idempotent')
  const next = structuredClone(baseline); next.interfaces[0].transfers = []
  const cleared = populate(next, baseline)
  assert.deepEqual(cleared.interfaces[0].source_function_ids, []); assert.deepEqual(cleared.interfaces[0].target_function_ids, [])
  assert.equal(cleared.definitions.reduce((n, def) => n + def.functions.length, 0), 4, 'Connections never invent generic functions')
  assert.equal(next.interfaces[0].source_function_ids.length, 1, 'Synchronization is immutable')
  const { effectiveSystemFunctions, processArchitectureModel } = await vite.ssrLoadModule('/src/store/systemArchitecture.ts')
  assert.equal(effectiveSystemFunctions(cleared, 'motor-controller')[0].definition.io[0].resource_id, '', 'Connection deletion clears the consumed input')
  const rerouted = structuredClone(baseline)
  rerouted.interfaces[0] = { ...rerouted.interfaces[0], id: 'replacement-route', transfers: rerouted.interfaces[0].transfers.map(transfer => ({ ...transfer, id: 'replacement-transfer' })) }
  const rerouteResult = populate(rerouted, baseline)
  assert.equal(effectiveSystemFunctions(rerouteResult, 'motor-controller')[0].definition.io[0].resource_id, 'dc-power', 'Moving an equivalent flow to a different route/transfer ID preserves its input binding')
  assert.equal(rerouteResult.interfaces[0].id, 'replacement-route')
  assert.equal(rerouteResult.interfaces[0].transfers[0].id, 'replacement-transfer')
  const { reconcileFunctionResources, upsertInstalledFunction } = await vite.ssrLoadModule('/src/store/functionResourceFlows.ts')
  const standbyConsumer = structuredClone(baseline)
  standbyConsumer.definitions.find(item => item.id === 'motor-controller-definition').functions[0].mode_ids = ['standby']
  const modeBaseline = populate(standbyConsumer, baseline)
  const producer = effectiveSystemFunctions(modeBaseline, 'esps').find(fn => fn.id === 'supply-power')
  const disjointDraft = upsertInstalledFunction(modeBaseline, 'esps', { ...producer, mode_ids: ['running'] })
  assert.equal(disjointDraft.interfaces.flatMap(edge => edge.transfers ?? []).length, 0, 'Disjoint producer modes remove the unusable transfer')
  const retainedDraft = populate(disjointDraft, modeBaseline)
  assert.equal(effectiveSystemFunctions(retainedDraft, 'motor-controller')[0].definition.io[0].resource_id, 'dc-power', 'A producer mode edit retains the invalidated input selection')
  const restoredProducer = effectiveSystemFunctions(retainedDraft, 'esps').find(fn => fn.id === 'supply-power')
  const restoredModes = populate(upsertInstalledFunction(retainedDraft, 'esps', { ...restoredProducer, mode_ids: [] }), retainedDraft)
  assert.equal(restoredModes.interfaces.flatMap(edge => edge.transfers ?? []).length, 1, 'Restoring compatible modes reconnects the retained input')
  const disabledProducer = structuredClone(baseline)
  disabledProducer.instances.find(item => item.id === 'esps').function_overrides = [{ function_id: 'supply-power', enabled: false }]
  const disabledReconciled = reconcileFunctionResources(disabledProducer).model
  const disabledResult = populate(disabledReconciled, baseline)
  assert.equal(effectiveSystemFunctions(disabledResult, 'motor-controller')[0].definition.io[0].resource_id, 'dc-power', 'Disabling a producer retains the consumer input for repair')
  const reenabledProducer = structuredClone(disabledResult)
  reenabledProducer.instances.find(item => item.id === 'esps').function_overrides[0].enabled = true
  const reenabledResult = populate(reenabledProducer, disabledResult)
  assert.equal(reenabledResult.interfaces.flatMap(edge => edge.transfers ?? []).length, 1)
  const renamed = structuredClone(baseline); renamed.resources.find(item => item.id === 'dc-power').name = 'Protected DC supply'
  const updated = populate(renamed, baseline)
  assert.equal(updated.definitions.find(item => item.id === 'esps-definition').functions[0].description, 'Supply 28 V DC supply', 'Authored actions remain authored')
  assert.equal(updated.interfaces[0].flow_description, 'Protected DC supply')
  const moved = structuredClone(model); moved.diagrams[0].nodes[1].x += 100; assert.equal(populate(moved, model), moved, 'Layout cannot mutate engineering links')
  const { createFmeaAnalysis } = await vite.ssrLoadModule('/src/components/ReliabilityProgram/fmeaModel.ts')
  const { applyProcessArchitecture } = await vite.ssrLoadModule('/src/store/interfaceFunctions.ts')
  let process = createFmeaAnalysis('pfmea', 1)
  process.structure_nodes = model.instances.map(instance => ({ id: instance.id, name: instance.name, parent_id: instance.parent_instance_id, level: 'process', description: '', interface: '' }))
  process = applyProcessArchitecture(process, baseline)
  const localResult = local(process)
  assert.equal(localResult.functions.find(fn => fn.id === 'supply-power').description, 'Supply 28 V DC supply')
  assert.deepEqual(localResult.interfaces[0].function_ids, ['supply-power', 'receive-power'])
  assert.deepEqual(local(localResult), localResult)
  assert.deepEqual(processArchitectureModel(localResult).interfaces[0].transfers, baseline.interfaces[0].transfers)
  const annotatedProcess = structuredClone(localResult)
  annotatedProcess.function_links[0].label = 'Traceable parent support'
  annotatedProcess.interfaces[0].relationship_strength = 'strong'
  const editedProcess = structuredClone(annotatedProcess)
  editedProcess.functions[0].definition.action = 'Updated process condition'
  const afterEdit = local(editedProcess, annotatedProcess)
  assert.equal(afterEdit.function_links[0].label, 'Traceable parent support', 'Function authoring preserves existing dependency labels')
  assert.equal(afterEdit.interfaces[0].relationship_strength, 'strong', 'Function authoring preserves interface strength through process-model projection')
  assert.equal(processArchitectureModel(afterEdit).interfaces[0].strength, 'strong')
  const editor = await vite.ssrLoadModule('/src/components/ReliabilityProgram/fmeaModel.ts')
  const { fmeaEngineeringFingerprint } = await vite.ssrLoadModule('/src/store/sharedFmeaModel.ts')
  localResult.block_diagram.nodes.push({id:'external-supply',kind:'external',label:'Independent source',x:0,y:0,width:180,height:72,inside_boundary:false,
    ports:[{id:'supply-terminal',name:'Power output',interface_type:'energy',direction:'output',description:'',resource_id:'external-power'}]})
  localResult.resources.push({id:'external-power',name:'External power',category:'energy'})
  localResult.interfaces[0].mode_ids = ['running']
  localResult.function_links[0].generated = true
  const sheets = Object.fromEntries(editor.functionWorkbookSheets(localResult).map(sheet => [sheet.name,sheet.rows]))
  const restored = editor.importFunctionWorkbook(editor.createFmeaAnalysis('pfmea',2),sheets)
  assert.deepEqual(restored.block_diagram.nodes[0].ports,localResult.block_diagram.nodes[0].ports,'Workbook preserves independent external source ownership')
  assert.deepEqual(restored.interfaces[0].mode_ids,['running'])
  assert.equal(restored.function_links[0].generated,true,'Workbook preserves automatic dependency cleanup semantics')
  const movedProcess = structuredClone(restored); movedProcess.block_diagram.nodes[0].x += 80
  assert.equal(fmeaEngineeringFingerprint([movedProcess]),fmeaEngineeringFingerprint([restored]),'Geometry never stales process results')
  movedProcess.block_diagram.nodes[0].ports[0].direction='input'
  assert.notEqual(fmeaEngineeringFingerprint([movedProcess]),fmeaEngineeringFingerprint([restored]),'External ownership is an engineering input')
  const deleteAndRename = structuredClone(baseline)
  deleteAndRename.interfaces=[]
  deleteAndRename.definitions.find(item=>item.id==='esps-definition').functions[0].definition.action='Supply qualified power'
  const deletedWithAction=populate(deleteAndRename,baseline)
  assert.equal(effectiveSystemFunctions(deletedWithAction,'motor-controller')[0].definition.io[0].resource_id,'',
    'A simultaneous action edit does not recreate an explicitly deleted connection')
  console.log('Explicit transfer synchronization and deterministic generated function statements passed.')
} finally { await closeViteTestServer(vite, cacheDir) }
