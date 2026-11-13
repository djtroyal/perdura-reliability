import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite'
import { closeViteTestServer, ssrOnlyVitePlugin } from './viteTestLifecycle.mjs'
const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-function-flows-'))
const vite = await createServer({ root: new URL('..', import.meta.url).pathname, cacheDir, appType: 'custom', plugins: [ssrOnlyVitePlugin()], server: { middlewareMode: true, ws: { server: createHttpServer() } } })
try {
  const lib = await vite.ssrLoadModule('/src/store/functionResourceFlows.ts'), arch = await vite.ssrLoadModule('/src/store/systemArchitecture.ts')
  let sequence = 0; const idFactory = () => `generated-${++sequence}`
  const resource = (id, category = 'energy') => ({ id, name: 'Power', category })
  const fn = (id, role, action, inputs = [], output) => ({ id, description: action, function_type: 'primary', mode_ids: [], definition: { role, action, io: [...inputs.map((resource_id, index) => ({ id: `${id}-in-${index}`, direction: 'input', resource_id })), ...(output ? [{ id: `${id}-out`, direction: 'output', resource_id: output }] : [])] } })
  const def = (id, functions) => ({ id, name: id, classification: '', description: '', kind: 'subsystem', part_number: '', manufacturer: '', category: '', ports: [], functions, failure_modes: [], child_slots: [] })
  const instance = (id, definition_id) => ({ id, name: id, definition_id, parent_instance_id: 'aircraft', quantity: 1, reference_designators: [], mode_ids: [], function_overrides: [], failure_mode_overrides: [], legacy_refs: [] })
  const fixture = { version: 4, id: 'model', name: 'Aircraft', revision: '', root_instance_id: 'aircraft', resources: [resource('power'), resource('torque', 'physical')], modes: ['running','standby'].map(id => ({ id, name: id, description: '' })), definitions: [def('aircraft-def', [fn('ready','maintain_state','availability')]), def('supply-def', [fn('supply','source','Supply power',[],'power')]), def('motor-def',[fn('control','transform','Control speed',['power'],'torque')])], instances: [instance('aircraft','aircraft-def'), instance('esps','supply-def'), instance('motor','motor-def')], externals: [], interfaces: [], function_links: [], propagation_rules: [], diagrams: [] }
  fixture.instances[0].parent_instance_id = undefined
  const clone = () => structuredClone(fixture), reconcile = model => lib.reconcileFunctionResources(model, { idFactory }), effective = (model,id) => arch.effectiveSystemFunctions(model,id)
  const initial = reconcile(clone())
  assert.deepEqual(initial.issues, []); assert.deepEqual(initial.ambiguities, [])
  assert.equal(initial.model.interfaces.length,1); assert.equal(initial.model.interfaces[0].transfers[0].resource_id,'power')
  assert.equal(initial.model.function_links.filter(link => link.relationship === 'decomposes_to').length,2)
  assert.deepEqual(arch.inspectArchitectureCompleteness(initial.model), [], 'Unused outputs and resource-free Maintain State are complete')
  const before = sequence; assert.equal(reconcile(initial.model).model,initial.model); assert.equal(sequence,before,'Repeated reconciliation allocates no identities')
  assert.equal(lib.availableFunctionInputs(initial.model,{instanceId:'motor',functionId:'control'}).length,1)
  assert(lib.availableFunctionInputs(initial.model)[0].label.includes(' › '))
  const supplyOption = lib.availableFunctionInputs(initial.model).find(option => option.resource.id === 'power')
  assert.equal(supplyOption.sourceKind, 'installed')
  assert.deepEqual(supplyOption.path, [{ id: 'aircraft', label: 'aircraft' }, { id: 'esps', label: 'esps' }])
  assert.equal(supplyOption.instanceId, 'esps'); assert.equal(supplyOption.functionId, 'supply'); assert.equal(supplyOption.functionLabel, 'Supply power')
  assert.deepEqual(supplyOption.producer, { kind: 'function', instance_id: 'esps', function_id: 'supply', io_id: 'supply-out' })
  const nestedOptions = clone(); nestedOptions.instances.find(item => item.id === 'motor').parent_instance_id = 'esps'
  nestedOptions.instances.find(item => item.id === 'esps').name = 'Power › distribution'
  assert.deepEqual(lib.availableFunctionInputs(nestedOptions).find(option => option.resource.id === 'torque').path,
    [{ id: 'aircraft', label: 'aircraft' }, { id: 'esps', label: 'Power › distribution' }, { id: 'motor', label: 'motor' }],
    'Structural hierarchy never splits a label containing the breadcrumb separator')
  const rootOutput = clone(); rootOutput.resources.push(resource('root-output'))
  rootOutput.definitions[0].functions.push(fn('root-source','source','Provide system service',[],'root-output'))
  assert.deepEqual(lib.availableFunctionInputs(rootOutput).find(option => option.resource.id === 'root-output').path, [{ id: 'aircraft', label: 'aircraft' }],
    'Functions on the root and intermediate levels remain selectable')
  const disconnected = lib.disconnectInterface(initial.model,initial.model.interfaces[0].id)
  assert.equal(disconnected.interfaces.length,0); assert.equal(effective(disconnected,'motor')[0].definition.io[0].resource_id,'')
  assert.equal(reconcile(disconnected).model.interfaces.length,0,'Deleted connection is not recreated')
  const manual = structuredClone(initial.model); manual.interfaces[0].generated = false
  assert.equal(lib.disconnectResourceTransfer(manual,manual.interfaces[0].id,manual.interfaces[0].transfers[0].id).interfaces.length,1,'Manual routes retained')
  const fanout = clone(); fanout.definitions.push(def('other-def',[fn('other','transform','Use power',['power'],'other-output')])); fanout.instances.push(instance('other','other-def')); fanout.resources.push(resource('other-output'))
  assert.equal(reconcile(fanout).model.interfaces.length,2); assert.deepEqual(arch.inspectArchitectureCompleteness(reconcile(fanout).model),[])
  const modes = clone(); modes.definitions[1].functions[0].mode_ids=['running']
  assert(reconcile(modes).issues.some(issue=>issue.code==='unpaired_function_io')); assert.deepEqual(reconcile(modes).model.interfaces[0].transfers[0].mode_ids,['running'])
  const edge = {...initial.model.interfaces[0],generated:false,transfers:[]}, ambiguous = clone(); ambiguous.interfaces=[{...edge,id:'route-a'},{...edge,id:'route-b'}]
  const undecided = reconcile(ambiguous); assert.equal(undecided.ambiguities.length,1); assert(undecided.model.interfaces.every(edge=>!edge.transfers.length))
  const routed=lib.reconcileFunctionResources(undecided.model,{idFactory,routeSelections:{[undecided.ambiguities[0].inputKey]:'route-b'}}).model
  assert.equal(routed.interfaces.find(edge=>edge.id==='route-b').transfers.length,1); assert.equal(reconcile(routed).ambiguities.length,0)
  const internal=clone(); internal.definitions[2].functions.push(fn('drive','transform','Drive shaft',['torque'],'shaft')); internal.resources.push(resource('shaft','physical'))
  assert.equal(reconcile(internal).model.interfaces.length,1); assert.equal(reconcile(internal).model.function_links.filter(link=>link.relationship==='provides_input').length,2)
  assert.deepEqual(arch.inspectArchitectureCompleteness(reconcile(internal).model),[])
  const self=clone(); self.definitions[2].functions[0].definition.io[0].resource_id='torque'; assert(reconcile(self).issues.some(issue=>issue.code==='self_function_input'))
  const feedback=clone(); feedback.definitions[1].functions[0]=fn('supply','transform','Regulate power',['torque'],'power')
  assert.deepEqual(reconcile(feedback).issues,[]); assert.equal(reconcile(feedback).model.interfaces.length,2)
  const external=clone(); external.instances=external.instances.filter(item=>item.id!=='esps'); external.definitions[1].functions=[]
  external.externals.push({id:'grid',name:'Grid',kind:'adjacent_system',description:'',ports:[{id:'feed',name:'Feed',interface_type:'energy',direction:'output',description:'',resource_id:'power'}]})
  assert.equal(reconcile(external).model.interfaces[0].transfers[0].source.kind,'external'); assert.deepEqual(arch.inspectArchitectureCompleteness(reconcile(external).model),[])
  const externalOption = lib.availableFunctionInputs(external).find(option => option.resource.id === 'power')
  assert.equal(externalOption.sourceKind, 'external'); assert.equal(externalOption.externalId, 'grid'); assert.equal(externalOption.externalLabel, 'Grid')
  assert.equal(externalOption.functionLabel, 'Feed'); assert.deepEqual(externalOption.path, [])
  assert.deepEqual(externalOption.producer, { kind: 'external', external_id: 'grid', port_id: 'feed' })
  const duplicate=clone(); duplicate.definitions.push(def('copy-def',[fn('duplicate','source','Supply power',[],'power')])); duplicate.instances.push(instance('duplicate','copy-def'))
  assert(reconcile(duplicate).issues.some(issue=>issue.code==='multiple_resource_producers')); assert(!lib.availableFunctionInputs(duplicate).some(option=>option.resource.id==='power'))
  const reused=clone(); reused.instances.push(instance('second-motor','motor-def')); const isolated=lib.isolateInstalledOutputs(reused,['second-motor'],idFactory)
  assert.notEqual(effective(isolated,'second-motor')[0].definition.io[1].resource_id,'torque'); assert.equal(effective(isolated,'second-motor')[0].definition.io[0].resource_id,'power')
  const installedOptions = lib.availableFunctionInputs(isolated).filter(option => option.functionId === 'control')
  assert.equal(installedOptions.length, 2)
  assert.equal(new Set(installedOptions.map(option => option.instanceId)).size, 2)
  assert.equal(new Set(installedOptions.map(option => option.resource.id)).size, 2, 'Reusable definitions preserve output occurrence identity in drilldown metadata')
  assert(installedOptions.every(option => option.path.at(-1).id === option.instanceId))
  assert(!isolated.instances.find(item=>item.id==='second-motor').function_overrides[0].definition)
  isolated.definitions[2].functions[0].definition.action='Updated shared action'; assert.equal(effective(isolated,'second-motor')[0].definition.action,'Updated shared action')
  const withNew=lib.upsertInstalledFunction(isolated,'motor',fn('secure','maintain_state','secure attachment'),{idFactory})
  assert(effective(withNew,'motor').some(fn=>fn.id==='secure')); assert(!effective(withNew,'second-motor').some(fn=>fn.id==='secure'))
  const futureInstall={...withNew,instances:[...withNew.instances,instance('future-motor','motor-def')]}
  assert(!effective(futureInstall,'future-motor').some(fn=>fn.id==='secure'),'Future reuse does not activate installed-only functions')
  futureInstall.instances[futureInstall.instances.length-1].function_overrides=[{function_id:'secure',resource_bindings:{},enabled:null}]
  assert(!effective(futureInstall,'future-motor').some(fn=>fn.id==='secure'),'Nullable binding-only overrides inherit default enablement')
  const change=structuredClone(effective(isolated,'second-motor')[0]); change.definition.io[0].resource_id=''
  const bindingOnly=lib.upsertInstalledFunction(isolated,'second-motor',change,{idFactory}), override=bindingOnly.instances.find(item=>item.id==='second-motor').function_overrides.find(item=>item.function_id==='control')
  assert(!override.definition,'Resource-only edits preserve action inheritance'); assert.equal(override.resource_bindings['control-in-0'],'')
  const reusableFn={...isolated.definitions[2].functions[0],definition:{...isolated.definitions[2].functions[0].definition,action:'Shared updated action'}}
  const renamedResources=isolated.resources.map(resource=>resource.id==='torque'?{...resource,name:'Drive torque',unit:'N·m'}:resource)
  const inherited=lib.updateReusableFunction(isolated,'motor-def',reusableFn,renamedResources)
  const boundOutput=effective(inherited,'second-motor')[0].definition.io.find(io=>io.direction==='output').resource_id
  assert.equal(inherited.resources.find(resource=>resource.id===boundOutput).name,'Drive torque')
  assert.equal(inherited.resources.find(resource=>resource.id===boundOutput).unit,'N·m')
  const customized=structuredClone(isolated); customized.resources.find(resource=>resource.id===boundOutput).name='Custom output'
  const customInherited=lib.updateReusableFunction(customized,'motor-def',reusableFn,customized.resources.map(resource=>resource.id==='torque'?{...resource,name:'Drive torque',unit:'N·m'}:resource))
  assert.equal(customInherited.resources.find(resource=>resource.id===boundOutput).name,'Custom output'); assert.equal(customInherited.resources.find(resource=>resource.id===boundOutput).unit,'N·m')
  const stateChanged=lib.updateReusableFunction(isolated,'motor-def',fn('control','maintain_state','attachment'))
  assert.deepEqual(stateChanged.instances.find(item=>item.id==='second-motor').function_overrides[0].resource_bindings,{})
  const newSource=lib.upsertInstalledFunction(isolated,'motor',fn('extra-source','source','Provide signal',[],'signal'),{idFactory,resources:[...isolated.resources,resource('signal','information')]})
  const enable=structuredClone(newSource); enable.instances.find(item=>item.id==='second-motor').function_overrides.find(item=>item.function_id==='extra-source').enabled=true
  const enabled=lib.bindNewInstalledOutputs(enable,newSource,idFactory)
  assert.notEqual(effective(enabled,'motor').find(fn=>fn.id==='extra-source').definition.io[0].resource_id,effective(enabled,'second-motor').find(fn=>fn.id==='extra-source').definition.io[0].resource_id)
  assert.equal(effective(enabled,'second-motor').find(fn=>fn.id==='control').definition.io[1].resource_id,boundOutput,'Enabling another function preserves existing output identities')
  assert.equal(lib.bindNewInstalledOutputs(enabled,enabled,idFactory),enabled,'Ownership binding is idempotent')
  const copied=clone(); copied.instances.push(instance('copied-supply','supply-def'),instance('copied-motor','motor-def'))
  const isolatedCopy=lib.isolateInstalledOutputs(copied,['copied-supply','copied-motor'],idFactory)
  assert.equal(effective(isolatedCopy,'copied-motor')[0].definition.io[0].resource_id,effective(isolatedCopy,'copied-supply')[0].definition.io[0].resource_id)
  assert.equal(effective(isolatedCopy,'motor')[0].definition.io[0].resource_id,'power','Original consumers retain original producer')
  const relation=clone(); relation.interfaces.push({...edge,id:'attachment',interface_type:'physical',directionality:'undirected',source:{instance_id:'esps'},target:{instance_id:'motor'},transfers:[{id:'relation',kind:'relation',source:{kind:'block',instance_id:'esps'},target:{kind:'block',instance_id:'motor'},mode_ids:[]}]})
  const relationModel=reconcile(relation).model; assert.deepEqual(arch.inspectArchitectureCompleteness(relationModel),[])
  assert.equal(relationModel.function_links.filter(link=>link.relationship==='provides_input').length,1,'Attachment alone is not causal propagation')
  const duplicateLabels=clone(); duplicateLabels.definitions[1].functions.push(fn('another-source','source','Supply power',[],'another-power')); duplicateLabels.resources.push(resource('another-power'))
  const labels=lib.availableFunctionInputs(duplicateLabels).map(item=>item.label); assert.equal(new Set(labels).size,labels.length,'Identical block, action and output names still identify distinct producers')
  const modeEdit=structuredClone(initial.model); modeEdit.definitions[1].functions[0].mode_ids=['running']; const modeEdited=reconcile(modeEdit).model
  assert.equal(modeEdited.interfaces[0].id,initial.model.interfaces[0].id); assert.equal(modeEdited.interfaces[0].transfers[0].id,initial.model.interfaces[0].transfers[0].id,'Changing applicable modes retains connection identities')
  assert.deepEqual(lib.inspectFunctionResourceConnections(ambiguous).ambiguities,reconcile(ambiguous).ambiguities)
  const pendingScope=arch.architectureDependencyScope(undecided.model,{scopeInstanceId:'motor'}); assert(pendingScope.functionKeys.has(JSON.stringify(['esps','supply'])),'An input producer remains in the study context while selecting its route')
  const badContract=clone(); badContract.definitions[0].functions[0].definition.verb_id='maintain'
  assert(arch.validateArchitectureIntegrity(badContract).some(issue=>issue.code==='invalid_function_contract'))
  const twoOutputs=clone(); twoOutputs.definitions[1].functions[0].definition.io.push({id:'extra',direction:'output',resource_id:'torque'})
  assert(arch.inspectArchitectureCompleteness(reconcile(twoOutputs).model).some(issue=>issue.code==='invalid_function_io'))
  const twoParents=clone(); twoParents.definitions[0].functions.push(fn('other-root','maintain_state','integrity'))
  assert.equal(reconcile(twoParents).model.function_links.filter(link=>link.relationship==='decomposes_to').length,0)
  const process = arch.processArchitectureModel({ id: 'process', name: 'Process', revision: '', resources: [resource('feedstock'), resource('product')],
    structure_nodes: [{ id: 'line', name: 'Assembly line', description: '' }, { id: 'station', name: 'Process station', parent_id: 'line', description: '' }],
    functions: [{ ...fn('process-step', 'transform', 'Form material', ['feedstock'], 'product'), structure_node_id: 'station', operating_modes: [] }],
    interfaces: [], function_links: [], block_diagram: { nodes: [{ id: 'feed', kind: 'external', label: 'Material supply',
      ports: [{ id: 'feed-output', name: 'Feedstock', direction: 'output', interface_type: 'energy', description: '', resource_id: 'feedstock' }] }] } })
  const processOptions = lib.availableFunctionInputs(process)
  assert.deepEqual(processOptions.find(option => option.resource.id === 'product').path,
    [{ id: 'line', label: 'Assembly line' }, { id: 'station', label: 'Process station' }], 'PFMEA uses process hierarchy without borrowing equipment parentage')
  assert.equal(processOptions.find(option => option.resource.id === 'feedstock').externalLabel, 'Material supply')
  console.log('Output ownership, inferred routes, modes, fan-out, feedback, occurrence bindings, subtree copies and physical relations passed.')
} finally { await closeViteTestServer(vite,cacheDir) }
