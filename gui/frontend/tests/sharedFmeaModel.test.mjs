import assert from 'node:assert/strict'
import {createServer as createHttpServer} from 'node:http'
import {readFile,mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer} from 'vite'
import {closeViteTestServer,ssrOnlyVitePlugin} from './viteTestLifecycle.mjs'
const cacheDir=await mkdtemp(join(tmpdir(),'perdura-shared-model-')),hmrServer=createHttpServer()
const vite=await createServer({root:new URL('..',import.meta.url).pathname,cacheDir,appType:'custom',logLevel:'error',server:{middlewareMode:true,ws:{server:hmrServer}},plugins:[ssrOnlyVitePlugin()]})
try {
 const shared=await vite.ssrLoadModule('/src/store/sharedSystemModel.ts'),m=await vite.ssrLoadModule('/src/store/sharedFmeaModel.ts'),fmea=await vite.ssrLoadModule('/src/components/ReliabilityProgram/fmeaModel.ts'),arch=await vite.ssrLoadModule('/src/store/systemArchitecture.ts')
 const model=JSON.parse(await readFile(new URL('./fixtures/aircraftArchitecture.json',import.meta.url),'utf8'))
 const motor=model.instances.find(i=>i.id==='motor-controller'),definition=model.definitions.find(d=>d.id===motor.definition_id)
 model.resources.push({id:'spare-command',name:'Motor command',category:'information'})
 model.instances.push({...structuredClone(motor),id:'spare-controller',name:'Spare controller',function_overrides:[{function_id:'receive-power',enabled:true,resource_bindings:{'command-output':'spare-command'}}]})
 model.function_links.push({...structuredClone(model.function_links.find(i=>i.id==='support-motor-controller')),id:'support-spare',target:{instance_id:'spare-controller',function_id:'receive-power'}})
 definition.failure_modes=[{id:'no-power',function_id:'receive-power',description:'No power received',deviation_id:'failure_deviation:absent',mode_ids:[]}]
 model.definitions.push({...structuredClone(definition),id:'part-definition',name:'Prediction-only resistor',kind:'piece_part',functions:[],failure_modes:[]})
 model.instances.push({...structuredClone(motor),id:'part',name:'Prediction-only resistor',definition_id:'part-definition',parent_instance_id:'motor-controller'})
 shared.validateProjectSystem(model)
 const original=structuredClone(model),bound=m.bindFmeaAnalysis(model,fmea.createFmeaAnalysis('dfmea',1))
 assert.equal(bound.structure_nodes.length,5,'Prediction-only piece parts require explicit inclusion')
 assert.equal(bound.functions.length,5);assert.equal(bound.failure_chains.length,2);assert.equal(bound.interfaces.length,1)
 assert.deepEqual(m.inspectFmeaBinding(model,bound),[]);assert.deepEqual(m.materializeFmeaAnalysis(model,bound),bound,'Materialization is idempotent')
 const scoped=m.bindFmeaAnalysis(model,bound,'motor-controller')
 assert.deepEqual([...m.fmeaScopeInstanceIds(model,scoped)],['motor-controller'])
 assert.deepEqual(new Set(scoped.functions.map(f=>f.system_definition_ref.instance_id)),new Set(['motor-controller','esps','propulsion','aircraft']),'Required counterparts and ancestor support functions are included')
 assert.equal(scoped.failure_chains.length,1)
 assert.deepEqual(scoped.interfaces[0].transfers,model.interfaces[0].transfers,'Transfers retain canonical identities')
 const included=m.materializeFmeaAnalysis(model,{...scoped,system_binding:{...scoped.system_binding,included_piece_part_ids:['part']}})
 assert.ok(m.fmeaScopeInstanceIds(model,included).has('part'));assert.ok(included.structure_nodes.some(i=>i.system_definition_ref?.instance_id==='part'))
 const endpoints=structuredClone(model);endpoints.interfaces.push({...structuredClone(model.interfaces[0]),id:'part-feed',target:{instance_id:'part'},transfers:[],source_function_ids:[],target_function_ids:[],flow_description:''})
 assert.ok(m.fmeaScopeInstanceIds(endpoints,scoped).has('part'),'Actual endpoints participate even when visually summarized')
 const unrelated=structuredClone(model);unrelated.instances.find(i=>i.id==='spare-controller').name='Revised spare';unrelated.diagrams[0].nodes[0].x+=777;unrelated.revision='B'
 assert.equal(m.fmeaSemanticFingerprint(model,[scoped]),m.fmeaSemanticFingerprint(unrelated,[scoped]))
 const resourceChange=structuredClone(model);resourceChange.resources.find(i=>i.id==='dc-power').name='Qualified DC power'
 assert.notEqual(m.fmeaSemanticFingerprint(model,[scoped]),m.fmeaSemanticFingerprint(resourceChange,[scoped]),'Referenced resource changes stale results')
 const supportChange=structuredClone(model);supportChange.function_links=supportChange.function_links.filter(i=>i.id!=='support-motor-controller')
 assert.notEqual(m.fmeaSemanticFingerprint(model,[scoped]),m.fmeaSemanticFingerprint(supportChange,[scoped]),'Support allocations participate in freshness')
 const risk=structuredClone(scoped);risk.failure_chains[0].severity=9;risk.failure_chains[0].effect='Loss of propulsion';risk.failure_chains[0].cause='Supply interrupted';risk.failure_chains[0].actions=[{id:'action',kind:'design',description:'Verify redundant input',owner:'Systems',status:'open',evidence_ids:[],decision_rationale:''}]
 const renamed=structuredClone(model);renamed.instances.find(i=>i.id==='motor-controller').name='Main motor controller';renamed.definitions.find(d=>d.id===motor.definition_id).failure_modes[0].description='Power unavailable'
 const refreshed=m.materializeFmeaAnalysis(renamed,risk)
 assert.equal(refreshed.failure_chains[0].failure_mode,'Power unavailable');assert.equal(refreshed.failure_chains[0].severity,9);assert.equal(refreshed.failure_chains[0].actions[0].id,'action')
 const edited=structuredClone(scoped),fn=edited.functions.find(i=>i.system_definition_ref.instance_id==='motor-controller')
 fn.definition.action='Condition 28 V DC supply';fn.description='Condition 28 V DC supply';edited.failure_chains[0].severity=8
 const occurrence=m.splitFmeaUpdate(model,scoped,edited),all=m.materializeFmeaAnalysis(occurrence.model,bound)
 assert.equal(occurrence.model.definitions.find(d=>d.id===motor.definition_id).functions[0].definition.action,'Import 28 V DC supply')
 assert.equal(all.functions.find(i=>i.system_definition_ref.instance_id==='motor-controller').description,'Condition 28 V DC supply')
 assert.equal(all.functions.find(i=>i.system_definition_ref.instance_id==='spare-controller').description,'Import 28 V DC supply')
 assert.equal(occurrence.analysis.failure_chains[0].severity,8)
 const layout=structuredClone(scoped),block=layout.block_diagram.nodes.find(i=>i.structure_node_id===fn.structure_node_id)
 block.x+=450;layout.block_diagram.viewport={x:88,y:90,zoom:2};layout.block_diagram.connectorStyle='orthogonal'
 const arranged=m.splitFmeaUpdate(model,scoped,layout)
 assert.equal(arranged.model.diagrams[0].nodes.find(i=>i.instance_id==='motor-controller').x,block.x)
 assert.deepEqual(arranged.model.interfaces,model.interfaces,'Presentation cannot rewrite structured transfers')
 assert.deepEqual(arranged.model.diagrams[0].viewport,model.diagrams[0].viewport,'Viewport stays local')
 assert.equal(m.fmeaSemanticFingerprint(model,[scoped]),m.fmeaSemanticFingerprint(arranged.model,[arranged.analysis]));assert.equal(m.fmeaEngineeringFingerprint([scoped]),m.fmeaEngineeringFingerprint([arranged.analysis]))
 const edgeEdit=structuredClone(scoped);edgeEdit.interfaces[0].name='Controller DC feed';const edgeWrite=m.splitFmeaUpdate(model,scoped,edgeEdit)
 assert.equal(edgeWrite.model.interfaces[0].name,'Controller DC feed');assert.deepEqual(edgeWrite.model.interfaces[0].transfers,model.interfaces[0].transfers);assert.deepEqual(edgeWrite.model.interfaces[0].target,model.interfaces[0].target,'Summary edits never retarget the L3 endpoint')
 const reparent=structuredClone(bound);reparent.structure_nodes.find(i=>i.system_definition_ref.instance_id==='motor-controller').parent_id=reparent.structure_nodes.find(i=>i.system_definition_ref.instance_id==='esps').id
 const parentWrite=m.splitFmeaUpdate(model,bound,reparent)
 assert.equal(parentWrite.model.instances.find(i=>i.id==='motor-controller').parent_instance_id,'esps')
 assert.ok(arch.inspectArchitectureCompleteness(parentWrite.model,{scopeInstanceId:'motor-controller'}).some(i=>/parent|support/.test(i.code)),'Reparenting requires new parent support')
 const process=fmea.createFmeaAnalysis('pfmea',1)
 process.structure_nodes=[{id:'process',name:'Assemble controller',level:'process_item',description:'',interface:''},{id:'step',name:'Seat connector',level:'process_step',description:'',interface:'',parent_id:'process',system_definition_ref:{system_model_id:model.id,instance_id:'motor-controller',definition_id:motor.definition_id}}]
 process.functions=[{id:'process-function',structure_node_id:'step',description:'Draft process function',function_type:'primary',operating_modes:[],owner:'Manufacturing',notes:''}]
 const processEdit=structuredClone(process);processEdit.structure_nodes[1].name='Seat verified connector';processEdit.interfaces=[{id:'draft-transfer',name:'Draft process exchange',interface_type:'material',source_structure_node_id:'process',target_structure_node_id:'step',source_block_id:'a',target_block_id:'b',function_ids:[],requirement_ids:[],transfers:[],flow_description:''}]
 const processWrite=m.splitFmeaUpdate(model,process,processEdit)
 assert.equal(processWrite.model,model);assert.deepEqual(processWrite.analysis,processEdit,'Process drafts never invent functions or mutate equipment');assert.equal(m.materializeFmeaAnalysis(model,process),process)
 const suggestion=structuredClone(scoped)
 suggestion.failure_chains.push({...suggestion.failure_chains[0],id:'selected-failure',system_definition_ref:undefined,failure_mode:'Incorrect Motor command'})
 const suggested=m.splitFmeaUpdate(model,scoped,suggestion)
 const suggestedRef=suggested.analysis.failure_chains.find(chain=>chain.id==='selected-failure').system_definition_ref
 assert.ok(suggestedRef.failure_mode_id,'New FMEA failure suggestions become canonical block failures')
 const future={...structuredClone(motor),id:'future-controller',name:'Future controller',function_overrides:[{function_id:'receive-power',enabled:true,resource_bindings:{'command-output':'future-command'}}],failure_mode_overrides:[]}
 suggested.model.resources.push({id:'future-command',name:'Motor command',category:'information'})
 suggested.model.instances.push(future)
 const futureAnalysis=m.bindFmeaAnalysis(suggested.model,fmea.createFmeaAnalysis('dfmea',2))
 assert.equal(futureAnalysis.failure_chains.filter(chain=>chain.system_definition_ref?.failure_mode_id===suggestedRef.failure_mode_id).length,1,'Occurrence failure does not leak to a future installation')
 const freshFn=structuredClone(scoped)
 freshFn.functions.push({id:'local-state',structure_node_id:fn.structure_node_id,description:'Maintain secure attachment',definition:{role:'maintain_state',action:'secure attachment',io:[]},function_type:'primary',operating_modes:[],owner:'',notes:''})
 const addedFn=m.splitFmeaUpdate(model,scoped,freshFn)
 addedFn.model.instances.push(future);addedFn.model.resources.push({id:'future-command',name:'Motor command',category:'information'})
 assert.equal(m.bindFmeaAnalysis(addedFn.model,fmea.createFmeaAnalysis('dfmea',3)).functions.filter(item=>item.description==='Maintain secure attachment').length,1,'Occurrence function does not leak to future installations')
 const missing=structuredClone(model);missing.interfaces=[];missing.instances=missing.instances.filter(i=>!['motor-controller','part'].includes(i.id));missing.function_links=missing.function_links.filter(i=>i.target.instance_id!=='motor-controller')
 const retained=m.materializeFmeaAnalysis(missing,risk)
 assert.ok(retained.failure_chains.some(i=>i.id===risk.failure_chains[0].id&&i.severity===9),'Removed source records retain assessment work');assert.ok(m.inspectFmeaBinding(missing,retained).some(i=>i.code==='missing_instance'))
 const historical={model:structuredClone(risk)},state={analyses:[risk],result:{frozen:true},governance:{revisions:[{snapshot:historical}],releases:[{engineering_snapshot:historical}]}}
 const before={...shared.createProjectSystem('Aircraft'),model},after={...before,model:renamed}
 const updates=shared.canonicalDependencyUpdates({fmea:{_folioWrap:true,activeId:'f',folios:[{id:'f',state}]}},before,after)
 assert.equal(updates.fmea.folios[0].dirty,true);assert.deepEqual(updates.fmea.folios[0].state.governance,state.governance,'Source changes never rewrite historical snapshots')
 assert.deepEqual(model,original)
 console.log('PASS Shared FMEA current contracts: scope/resources/ancestors, occurrence isolation, risk retention, shared geometry, parent support, PFMEA separation and snapshots')
}finally{await closeViteTestServer(vite,cacheDir,hmrServer)}
