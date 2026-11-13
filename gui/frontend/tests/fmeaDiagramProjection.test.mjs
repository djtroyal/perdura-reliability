import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite'
import { closeViteTestServer, ssrOnlyVitePlugin } from './viteTestLifecycle.mjs'
const cacheDir=await mkdtemp(join(tmpdir(),'perdura-fmea-projection-'))
const hmrServer=createHttpServer()
const vite=await createServer({root:new URL('..',import.meta.url).pathname,cacheDir,logLevel:'error',appType:'custom',
 server:{middlewareMode:true,ws:{server:hmrServer}},plugins:[ssrOnlyVitePlugin()]})
try {
 const {projectFmeaDiagram,mergeFmeaDiagramPatch,instanceSubtree}=await vite.ssrLoadModule('/src/components/ReliabilityProgram/fmeaDiagramProjection.ts')
 const {createFmeaAnalysis}=await vite.ssrLoadModule('/src/components/ReliabilityProgram/fmeaModel.ts')
 const demo=JSON.parse(await readFile(new URL('../src/data/demoProject.json',import.meta.url),'utf8'))
 const model=structuredClone(demo.modules.systemDefinition.model),base=model.interfaces[0]
 model.interfaces=[['cross-a','demo-part-1','pump-a'],['cross-b','demo-part-2','pump-a'],['internal','demo-part-1','demo-part-2'],
  ['unrelated','pump-a','pump-b'],['different-instance','demo-part-1','pump-b'],['ancestor','demo-part-3',model.root_instance_id]]
 .map(([id,source,target])=>({...structuredClone(base),id,name:id,source:{instance_id:source},target:{instance_id:target}}))
 model.externals=[{id:'operator',name:'Operator',kind:'person',description:'',ports:[]}]
 model.interfaces.push({...structuredClone(base),id:'actor',source:{instance_id:'demo-part-1'},target:{external_id:'operator'}})
 const analysis=createFmeaAnalysis('dfmea',1)
 analysis.structure_nodes=model.instances.map(item=>({id:`SD-${item.id}`,name:item.name,parent_id:item.parent_instance_id?`SD-${item.parent_instance_id}`:undefined,
  level:'component',description:'',interface:'',system_definition_ref:{system_model_id:model.id,instance_id:item.id}}))
 analysis.block_diagram.nodes=model.instances.map((item,index)=>({id:`SD-BLOCK-${item.id}`,kind:'structure',structure_node_id:`SD-${item.id}`,
  container_parent_block_id:item.parent_instance_id?`SD-BLOCK-${item.parent_instance_id}`:undefined,
  label:item.name,x:index*99,y:index*17,width:180,height:72,expanded:true,inside_boundary:true}))
 analysis.block_diagram.nodes.push({id:'legacy-actor',kind:'external',label:'Operator',x:900,y:10,width:180,height:72,inside_boundary:false})
 analysis.interfaces=model.interfaces.map(item=>({id:`SD-IF-${item.id}`,name:item.name,source_block_id:`SD-BLOCK-${item.source.instance_id}`,
  target_block_id:item.target.external_id?'legacy-actor':`SD-BLOCK-${item.target.instance_id}`,
  source_structure_node_id:`SD-${item.source.instance_id}`,target_structure_node_id:item.target.instance_id?`SD-${item.target.instance_id}`:undefined,
  ...Object.fromEntries(['interface_type','linkage','directionality','flow_description','operating_condition'].map(key=>[key,item[key]])),
  relationship_strength:'strong',relationship_nature:'beneficial',interface_detail:'',function_ids:[],requirement_ids:[],external_source:'',external_target:'',
  system_definition_ref:{system_model_id:model.id,interface_id:item.id}}))
 const original=structuredClone({model,analysis}),board=projectFmeaDiagram(model,analysis,'b1')
 assert.deepEqual(Object.keys(board.interfaceEndpoints),['SD-IF-cross-a','SD-IF-cross-b','SD-IF-different-instance','SD-IF-ancestor','SD-IF-actor'])
 assert.equal(board.internalInterfaceCount,1)
 assert.deepEqual(board.interfaceEndpoints['SD-IF-cross-a'],{source:'SD-BLOCK-b1',target:'SD-BLOCK-pump-a'})
 assert.equal(board.interfaceEndpoints['SD-IF-different-instance'].target,'SD-BLOCK-pump-b','Repeated definitions retain installed identity')
 assert.equal(board.interfaceEndpoints['SD-IF-actor'].target,'legacy-actor','Preserve legacy external identity')
 assert.equal(board.interfaceEndpoints['SD-IF-ancestor'].target,`SD-BLOCK-${model.root_instance_id}`,'A real root endpoint is represented without a redundant root frame')
 assert.equal(board.analysis.block_diagram.nodes.find(item=>item.id==='SD-BLOCK-b1').expanded,false)
 assert.ok(board.analysis.block_diagram.nodes.every(item=>!item.container_parent_block_id||board.analysis.block_diagram.nodes.some(parent=>parent.id===item.container_parent_block_id)),'Every lower-level block keeps its ancestor container')
 assert.deepEqual(board.analysis.interfaces,analysis.interfaces,'Projected endpoints never replace semantic endpoints')
 assert.match(board.interfaceDescriptions['SD-IF-cross-a'],/Microprocessor/)
 const controllerSubtree=instanceSubtree(model,'b1')
 for (const id of ['b1','power-connector','pressure-sensor','demo-part-1','demo-part-2','demo-part-3'])
  assert.ok(controllerSubtree.has(id),'Hidden descendants participate in boundary classification')
 assert.ok(!controllerSubtree.has('pump-a'),'A sibling subsystem is outside the controller boundary')
 const pump=projectFmeaDiagram(model,analysis,'pump-a')
 assert.equal(pump.interfaceEndpoints['SD-IF-cross-a'].source,'SD-BLOCK-b1','Hidden outside parts promote only to nearest non-part ancestor')
 assert.equal(pump.interfaceEndpoints['SD-IF-unrelated'].target,'SD-BLOCK-pump-b')
 const part=projectFmeaDiagram(model,analysis,'demo-part-1')
 assert.ok(part.analysis.block_diagram.nodes.some(item=>item.id==='SD-BLOCK-demo-part-1'),'Explicit part focus is visible')
 assert.equal(part.interfaceEndpoints['SD-IF-internal'].target,'SD-BLOCK-b1')
 assert.ok(!part.analysis.block_diagram.nodes.some(item=>item.id==='SD-BLOCK-demo-part-2'))
 const focusMove=mergeFmeaDiagramPatch(analysis,board,{block_diagram:{...board.analysis.block_diagram,
  nodes:board.analysis.block_diagram.nodes.map(item=>({...item,x:item.x+100}))}})
 assert.equal(focusMove.block_diagram.nodes.find(item=>item.id==='SD-BLOCK-b1').x,analysis.block_diagram.nodes.find(item=>item.id==='SD-BLOCK-b1').x+100,'Focus changes shared geometry')
 assert.deepEqual(focusMove.block_diagram.nodes.find(item=>item.id===`SD-BLOCK-${model.root_instance_id}`),analysis.block_diagram.nodes.find(item=>item.id===`SD-BLOCK-${model.root_instance_id}`),'Projected root endpoint geometry is never saved over the master root')
 const edited=mergeFmeaDiagramPatch(analysis,board,{interfaces:analysis.interfaces.map(item=>item.id==='SD-IF-cross-a'?{...item,name:'Edited exact interface'}:item)})
 assert.equal(edited.interfaces.find(item=>item.id==='SD-IF-cross-a').source_block_id,'SD-BLOCK-demo-part-1')
 assert.ok(edited.interfaces.some(item=>item.id==='SD-IF-internal'),'Hidden interfaces retained during visible editing')
 const full=projectFmeaDiagram(model,analysis,'')
 assert.ok(full.analysis.block_diagram.nodes.every(item=>!item.id.includes('demo-part')))
 const fullEdit=mergeFmeaDiagramPatch(analysis,full,{block_diagram:{...full.analysis.block_diagram,
  nodes:full.analysis.block_diagram.nodes.map(item=>({...item,x:item.x+50}))}})
 assert.deepEqual(fullEdit.block_diagram.nodes.find(item=>item.id==='SD-BLOCK-demo-part-1'),analysis.block_diagram.nodes.find(item=>item.id==='SD-BLOCK-demo-part-1'))
 assert.deepEqual({model,analysis},original,'Projection and merging are pure')
 const modeModel={...model,interfaces:model.interfaces.map(item=>item.id==='cross-a'?{...item,mode_ids:['other-mode']}:item)}
 const modeAnalysis={...analysis,system_binding:{version:1,system_model_id:model.id,scope_instance_id:model.root_instance_id,mode_id:'run'}}
 assert.ok(!projectFmeaDiagram(modeModel,modeAnalysis,'b1').interfaceEndpoints['SD-IF-cross-a'],'A retained interface outside the active mode must not reappear in the diagram')
 // Exercise high fan-out and thousands of canonical crossings; no display cap
 // may remove interface records merely to make the focus projection faster.
 const count=1500
 const largeModel={...model,id:'large-project',root_instance_id:'large-root',externals:[],definitions:[
   {...model.definitions[0],id:'large-assembly',kind:'assembly'},
   {...model.definitions.find(item=>item.kind==='piece_part'),id:'large-part',kind:'piece_part'}],instances:[],interfaces:[]}
 const install=(id,parent,part=false)=>({...model.instances[0],id,name:id,definition_id:part?'large-part':'large-assembly',parent_instance_id:parent})
 largeModel.instances.push(install('large-root'),install('large-focus','large-root'))
 for(let index=0;index<count;index++) largeModel.instances.push(
   install('inside-'+index,'large-focus',true),install('neighbor-'+index,'large-root'),install('outside-'+index,'neighbor-'+index,true))
 const largeEdge=(id,source,target)=>({...base,id,name:id,mode_ids:[],source:{instance_id:source},target:{instance_id:target}})
 for(let index=0;index<count;index++) {
   largeModel.interfaces.push(largeEdge('cross-out-'+index,'inside-'+index,'outside-'+index),largeEdge('cross-in-'+index,'outside-'+index,'inside-'+index))
   if(index) largeModel.interfaces.push(largeEdge('internal-'+index,'inside-'+(index-1),'inside-'+index),
     largeEdge('unrelated-'+index,'outside-'+(index-1),'outside-'+index))
 }
 const largeAnalysis={...analysis,id:'large-study',structure_nodes:largeModel.instances.map(item=>({
   id:'structure-'+item.id,name:item.name,parent_id:item.parent_instance_id?'structure-'+item.parent_instance_id:undefined,
   level:'assembly',description:'',interface:'',system_definition_ref:{system_model_id:largeModel.id,instance_id:item.id}})),
   block_diagram:{...analysis.block_diagram,nodes:largeModel.instances.map(item=>({id:'block-'+item.id,kind:'structure',structure_node_id:'structure-'+item.id,
     label:item.name,x:100,y:100,width:180,height:72,expanded:false,inside_boundary:true}))},
   interfaces:largeModel.interfaces.map(item=>({...analysis.interfaces[0],id:'fmea-'+item.id,
     source_block_id:'block-'+item.source.instance_id,target_block_id:'block-'+item.target.instance_id,
     source_structure_node_id:'structure-'+item.source.instance_id,target_structure_node_id:'structure-'+item.target.instance_id,
     system_definition_ref:{system_model_id:largeModel.id,interface_id:item.id}}))}
 const coldStart=performance.now(),large=projectFmeaDiagram(largeModel,largeAnalysis,'large-focus'),coldMs=performance.now()-coldStart
 assert.equal(Object.keys(large.interfaceEndpoints).length,count*2)
 assert.equal(large.internalInterfaceCount,count-1)
 assert.equal(large.analysis.block_diagram.nodes.length,count+1)
 for(let index=0;index<count;index++) {
   assert.deepEqual(large.interfaceEndpoints['fmea-cross-out-'+index],{source:'block-large-focus',target:'block-neighbor-'+index})
   assert.deepEqual(large.interfaceEndpoints['fmea-cross-in-'+index],{source:'block-neighbor-'+index,target:'block-large-focus'})
 }
 const timings=[]
 for(let run=0;run<5;run++) {
   const start=performance.now(),repeated=projectFmeaDiagram(largeModel,largeAnalysis,'large-focus')
   timings.push(performance.now()-start)
   assert.deepEqual(repeated.interfaceEndpoints,large.interfaceEndpoints)
   assert.deepEqual(repeated.analysis.block_diagram.nodes,large.analysis.block_diagram.nodes,'Large projections stay deterministic')
 }
 const medianMs=timings.sort((a,b)=>a-b)[2]
 assert.ok(coldMs<2000 && medianMs<500,`Projection exceeded generous CI budget: cold ${coldMs.toFixed(1)} ms, median ${medianMs.toFixed(1)} ms`)
 console.log('Large FMEA focus baseline '+JSON.stringify({instances:largeModel.instances.length,interfaces:largeModel.interfaces.length,
   crossings:count*2,coldMs:Math.round(coldMs*10)/10,medianMs:Math.round(medianMs*10)/10}))
 console.log('FMEA focus projection, canonical endpoints, and hidden-record preservation passed')
} finally {await closeViteTestServer(vite, cacheDir);hmrServer.close()}
