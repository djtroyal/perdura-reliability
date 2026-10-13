import assert from 'node:assert/strict'
import {test} from 'node:test'
import {performance} from 'node:perf_hooks'
import {readFileSync} from 'node:fs'
import {systemInputFingerprint} from '../src/store/sharedSystemFingerprint.ts'
import {adoptDistribution,createFitProvenance} from '../src/components/shared/adoptedDistribution.ts'
import {analysisSourceFingerprint,linkedSourcesFingerprint,mapSourceDistribution,resolveLinkedNodes,resolveReliabilitySource} from '../src/components/shared/reliabilitySources.ts'
import {reconcileLinkedSources} from '../src/store/linkedSourceInvalidation.ts'

function dataset(id='a',distribution='Weibull_2P',parameters={eta:10,beta:2},unit='hours') {
 const f={id,name:id,dataSource:'spec',quantity:{kind:'time',unit},spec:{distribution,params:Object.fromEntries(Object.entries(parameters).map(([k,v])=>[k,String(v)])),mcMode:'single'},specResult:{distribution,params:parameters}}
 f.fitProvenance=createFitProvenance(f);f.adoptedDistribution=adoptDistribution(f,distribution);return f
}
const project=(...folios)=>({units:'hours',modules:{lifeData:{folios}}})
const linked=(id='n',analysisId='a')=>({id,type:'basic',data:{distributionSource:{module:'lifeData',analysisId},distribution:'exponential',dist_params:{lambda:999}}})
const wrap=folios=>({_folioWrap:true,activeId:folios[0]?.id,folios})
const tree=(id,nodes)=>({id,name:id,dirty:false,state:{nodes,edges:[]}})
function recordCurrent(p,key,id){const f=p.modules[key].folios.find(f=>f.id===id);return {...f,dirty:false,state:{...f.state,result:{answer:id,_sourceFingerprint:analysisSourceFingerprint(p,key,id)}}}}

test('eight families preserve native parameters and apply exact physical scaling at consumers',()=>{
 const cases=[
 ['Weibull_3P',{eta:10,beta:2,gamma:1},{dist:'weibull',dist_params:{alpha:240,beta:2,gamma:24}}],
 ['Exponential_2P',{Lambda:.1,gamma:1},{dist:'exponential',dist_params:{lambda:.1/24,gamma:24}}],
 ['Normal_2P',{mu:5,sigma:2},{dist:'normal',dist_params:{mu:120,sigma:48}}],
 ['Lognormal_3P',{mu:2,sigma:1,gamma:1},{dist:'lognormal',dist_params:{mu:2+Math.log(24),sigma:1,gamma:24}}],
 ['Gamma_3P',{alpha:2,beta:3,gamma:1},{dist:'gamma',dist_params:{alpha:2,beta:72,gamma:24}}],
 ['Loglogistic_3P',{alpha:10,beta:2,gamma:1},{dist:'loglogistic',dist_params:{alpha:240,beta:2,gamma:24}}],
 ['Gumbel_2P',{mu:5,sigma:2},{dist:'gumbel',dist_params:{mu:120,sigma:48}}],
 ['Beta_2P',{alpha:2,beta:3},{dist:'beta',dist_params:{alpha:2,beta:3,support_scale:24}}],
 ]
 for(const [family,params,expected]of cases){const p=project(dataset('a',family,params,'days')),r=resolveReliabilitySource(p,'a')
  assert.deepEqual({dist:r.dist,dist_params:r.dist_params},expected);assert.deepEqual(r.snapshot.parameters,params)
  assert.deepEqual(resolveLinkedNodes(p,[linked()])[0].data.dist_params,expected.dist_params)
  assert.equal(resolveLinkedNodes(p,[{...linked(),data:{...linked().data,sourceError:'Previous source missing'}}])[0].data.sourceError,undefined)
 }
 assert.throws(()=>mapSourceDistribution('Weibull_mixture',{eta:10,beta:2}),/Unsupported/)
 assert.throws(()=>mapSourceDistribution('Weibull_3P',{eta:10,beta:2}),/Missing/)
})
test('constant-rate and Weibull maintenance reject unsupported shifted models',()=>{
 assert.throws(()=>resolveReliabilitySource(project(dataset('a','Exponential_2P',{Lambda:.1,gamma:2})),'a','constant-rate'),/zero location/)
 assert.throws(()=>resolveReliabilitySource(project(dataset('a','Weibull_3P',{eta:10,beta:2,gamma:2})),'a','weibull-2p'),/zero location/)
 assert.throws(()=>resolveReliabilitySource(project(dataset('a','Normal_2P',{mu:10,sigma:2})),'a','constant-rate'),/exponential/)
 assert.equal(resolveReliabilitySource(project(dataset('a','Exponential_1P',{Lambda:.1})),'a','constant-rate').dist_params.lambda,.1)
})
test('legacy, deleted, malformed and wrong-domain sources cannot use cached node parameters',()=>{
 assert.throws(()=>resolveLinkedNodes(project({...dataset(),adoptedDistribution:null,setDist:'Weibull_2P'}),[linked()]),/Set a dataset distribution/)
 assert.throws(()=>resolveLinkedNodes(project(),[linked()]),/missing/)
 assert.throws(()=>resolveLinkedNodes(project(dataset()),[{id:'x',data:{distributionSource:{module:'unknown',analysisId:'a'}}}]),/malformed/)
 const wrong=dataset();wrong.quantity={kind:'pressure',unit:'MPa'};wrong.fitProvenance=createFitProvenance(wrong);wrong.adoptedDistribution=adoptDistribution(wrong,'Weibull_2P')
 assert.throws(()=>resolveReliabilitySource(project(wrong),'a'),/cannot define a lifetime/)
})
test('Prediction incomplete totals fail closed while valid individual contributions remain available',()=>{
 const systemDefinition=JSON.parse(readFileSync(new URL('../src/data/demoProject.json',import.meta.url),'utf8')).modules.systemDefinition
 const canonical=systemInputFingerprint(systemDefinition.model)
 const result={total_failure_rate:100,service_rate_available:true,source_fingerprint:canonical,request_sha256:'request',excluded_part_count:0,incompatible:[],results:[{part_id:'p1',total_failure_rate:40,service_rate_available:true}],blocks:[{id:'b1',name:'Block',total_failure_rate:100,service_rate_available:true,descendant_part_indices:[0]}]}
 const p={units:'days',modules:{systemDefinition,prediction:wrap([{id:'scenario',name:'Scenario',dirty:false,state:{sourceSystemFingerprint:canonical,result}}])}}
 assert.ok(Math.abs(resolveReliabilitySource(p,'pred:scenario','constant-rate').dist_params.lambda-.0024)<1e-17)
 assert.ok(Math.abs(resolveReliabilitySource(p,'pred:scenario::part:p1').dist_params.lambda-.00096)<1e-17)
 const badResult={...result,excluded_part_count:1,incompatible:[{part_id:'missing'}],results:[...result.results,{part_id:'missing',incompatible:true}]}
 const bad={...p,modules:{...p.modules,prediction:wrap([{...p.modules.prediction.folios[0],state:{result:badResult}}])}}
 assert.throws(()=>resolveReliabilitySource(bad,'pred:scenario'),/incomplete/)
 assert.ok(Math.abs(resolveReliabilitySource(bad,'pred:scenario::part:p1').dist_params.lambda-.00096)<1e-17)
 assert.throws(()=>resolveReliabilitySource(bad,'pred:scenario::part:missing'),/unavailable/)
 assert.throws(()=>resolveReliabilitySource({...p,modules:{...p.modules,prediction:wrap([{...p.modules.prediction.folios[0],dirty:true}])}},'pred:scenario'),/current prediction/)
 // Results cannot become sources by dropping optional state-side freshness markers.
 const withoutProvenance={...p,modules:{...p.modules,prediction:wrap([{...p.modules.prediction.folios[0],state:{result:{...result,source_fingerprint:undefined}}}])}}
 assert.throws(()=>resolveReliabilitySource(withoutProvenance,'pred:scenario'),/provenance/)
 assert.throws(()=>resolveReliabilitySource({...p,modules:{prediction:p.modules.prediction}},'pred:scenario'),/provenance/)
 // Reuse exactly the same scenario object to exercise cached-source invalidation.
 const changedModel={...systemDefinition.model,instances:systemDefinition.model.instances.map((item,index)=>index===1?{...item,quantity:item.quantity+1}:item)}
 const changed={...p,modules:{...p.modules,systemDefinition:{...systemDefinition,model:changedModel}}}
 assert.throws(()=>resolveReliabilitySource(changed,'pred:scenario'),/provenance/)
 assert.throws(()=>resolveReliabilitySource(changed,'pred:scenario::part:p1'),/provenance/)
 assert.ok(resolveReliabilitySource(p,'pred:scenario'), 'unchanged captured canonical context remains usable')
 const consumer={...p,modules:{...p.modules,system:wrap([tree('rbd',[{id:'linked',data:{distributionSource:{module:'prediction',analysisId:'scenario'}}}])])}}
 consumer.modules.system=wrap([recordCurrent(consumer,'system','rbd')])
 consumer.modules=reconcileLinkedSources(consumer)
 assert.equal(consumer.modules.system.folios[0].state.sourceStale,false)
 const canonicalOnly={...consumer,modules:{...consumer.modules,systemDefinition:changed.modules.systemDefinition}}
 const reconciled=reconcileLinkedSources(canonicalOnly)
 assert.equal(reconciled.system.folios[0].state.sourceStale,true,'canonical-only changes bypass neither the source cache nor reconciliation fast path')


})
for(const key of ['faultTree','system'])test(`${key}: offscreen ancestors stale, recalculated parent current despite historical child`,()=>{
 let p=project(dataset('a'),dataset('b','Exponential_1P',{Lambda:.01}))
 const ref={id:'reference',type:key==='faultTree'?'transfer':'component',data:key==='faultTree'?{ref_tree:'child'}:{linkedAnalysisId:'child'}}
 p.modules[key]=wrap([tree('parent',[ref,linked('parent-source','b')]),tree('child',[linked()]),tree('unrelated',[])])
 p.modules[key]={...p.modules[key],folios:p.modules[key].folios.map(f=>recordCurrent(p,key,f.id))};p.modules=reconcileLinkedSources(p)
 assert.equal(p.modules[key].folios[0].state.sourceStale,false)
 const oldParent=p.modules[key].folios[0].state.result,oldChild=p.modules[key].folios[1].state.result
 p={...p,modules:{...p.modules,lifeData:{folios:[dataset('a','Weibull_2P',{eta:20,beta:2}),dataset('b','Exponential_1P',{Lambda:.01})]}}};p.modules=reconcileLinkedSources(p)
 assert.equal(p.modules[key].folios[0].state.sourceStale,true);assert.equal(p.modules[key].folios[1].state.sourceStale,true);assert.equal(p.modules[key].folios[2].dirty,false)
 assert.equal(p.modules[key].folios[0].state.result,oldParent);assert.equal(p.modules[key].folios[1].state.result,oldChild)
 const fresh=recordCurrent(p,key,'parent');p={...p,modules:{...p.modules,[key]:{...p.modules[key],folios:p.modules[key].folios.map(f=>f.id==='parent'?fresh:f)}}};p.modules=reconcileLinkedSources(p)
 assert.equal(p.modules[key].folios[0].state.sourceStale,false);assert.equal(p.modules[key].folios[0].dirty,false);assert.equal(p.modules[key].folios[1].state.sourceStale,true)
 const before=analysisSourceFingerprint(p,key,'parent')
 p={...p,modules:{...p.modules,lifeData:{folios:p.modules.lifeData.folios.map(f=>({...f,name:'Renamed'}))},[key]:{...p.modules[key],folios:p.modules[key].folios.map(f=>({...f,name:'Renamed tree',state:{...f.state,nodes:f.state.nodes.map(n=>({...n,position:{x:20,y:30}}))}}))}}}
 assert.equal(analysisSourceFingerprint(p,key,'parent'),before);p.modules=reconcileLinkedSources(p);assert.equal(p.modules[key].folios[0].state.sourceStale,false)
})
test('flat maintenance keeps historical outputs and matching unavailable markers cannot bypass failure',()=>{
 let p=project(dataset());const st={sourceId:'a',result:{answer:100}};st.result._sourceFingerprint=linkedSourcesFingerprint(p,st);p.modules.maintReplacement=st;p.modules=reconcileLinkedSources(p)
 assert.equal(p.modules.maintReplacement.sourceStale,false)
 for(const folios of [[dataset('a','Weibull_3P',{eta:10,beta:2,gamma:1})],[]]){
  p={...p,modules:{...p.modules,lifeData:{folios}}};p.modules.maintReplacement={...p.modules.maintReplacement,result:{answer:100,_sourceFingerprint:linkedSourcesFingerprint(p,st)}};p.modules=reconcileLinkedSources(p)
  assert.equal(p.modules.maintReplacement.sourceStale,true);assert.equal(p.modules.maintReplacement.result.answer,100)
 }
})
test('removing last source or malformed references preserves stale historical output',()=>{
 let p=project(dataset());const state={nodes:[linked()],result:{answer:1}};state.result._sourceFingerprint=linkedSourcesFingerprint(p,state)
 p.modules.system=wrap([{id:'a',state,dirty:false}]);p.modules=reconcileLinkedSources(p);const f=p.modules.system.folios[0]
 for(const nodes of [[],[{id:'bad',data:{distributionSource:{module:'lifeData'}}}]]){
  const next={...p,modules:{...p.modules,system:wrap([{...f,state:{...f.state,nodes}}])}},modules=reconcileLinkedSources(next)
  assert.equal(modules.system.folios[0].state.sourceStale,true);assert.equal(modules.system.folios[0].state.result.answer,1)
 }
})
test('Markov resolves current rate and fails closed when an adopted replacement is shifted',()=>{
 let p=project(dataset('a','Exponential_1P',{Lambda:.02}))
 const state={transitions:[{id:'tr',from:'up',to:'down',rate:999,ldaSource:'a'}],result:{answer:7}}
 state.result._sourceFingerprint=linkedSourcesFingerprint(p,state)
 p.modules.markov=wrap([{id:'m',dirty:true,state}]);p.modules=reconcileLinkedSources(p)
 assert.equal(p.modules.markov.folios[0].state.transitions[0].rate,.02)
 assert.equal(p.modules.markov.folios[0].state.sourceStale,false)
 assert.equal(p.modules.markov.folios[0].dirty,true,'source freshness must not erase unrelated local dirty state')
 p={...p,modules:{...p.modules,lifeData:{folios:[dataset('a','Exponential_2P',{Lambda:.03,gamma:2})]}}}
 p.modules=reconcileLinkedSources(p)
 assert.equal(p.modules.markov.folios[0].state.sourceStale,true)
 assert.match(p.modules.markov.folios[0].state.transitions[0].sourceError,/zero location/)
 assert.equal(p.modules.markov.folios[0].state.result.answer,7)
})
test('500 trees × 100 nodes avoid full-node scans on unrelated and preview edits',()=>{
 let reads=0
 const folios=Array.from({length:500},(_,i)=>tree(`t${i}`,Array.from({length:100},(_,j)=>{
  const data=j===0&&i===499?linked().data:j===0&&i<499?{ref_tree:`t${i+1}`}:{label:`Event ${i}/${j}`}
  return {id:`n${i}/${j}`,type:j===0&&i<499?'transfer':'basic',get data(){reads++;return data}}
 })))
 let p=project(dataset());p.modules.faultTree=wrap(folios)
 const start=performance.now();p.modules=reconcileLinkedSources(p);const initial=performance.now()-start
 reads=0;const same=reconcileLinkedSources({...p,modules:{...p.modules,unrelated:{text:'x'}}});assert.equal(same.faultTree,p.modules.faultTree);assert.equal(reads,0)
 const next={...p,modules:{...p.modules,lifeData:{folios:[{...p.modules.lifeData.folios[0],method:'RRX',selectedDist:'Normal_2P'}]}}},updated=reconcileLinkedSources(next)
 assert.equal(updated.faultTree,p.modules.faultTree);assert.ok(reads<500,`unchanged nodes rescanned: ${reads}`)
 const previewNodeReads=reads;reads=0
 const warmed={...next,modules:{...updated,lifeData:{folios:[{...next.modules.lifeData.folios[0],selectedDist:'Gamma_2P'}]}}}
 const warmStart=performance.now();reconcileLinkedSources(warmed);const warmPreviewMs=performance.now()-warmStart
 assert.equal(reads,0,'subsequent preview-only edits must reuse graph closures and node indexes')
 const changed={...warmed,modules:{...warmed.modules,lifeData:{folios:[dataset('a','Weibull_2P',{eta:20,beta:2})]}}}
 const resolved=reconcileLinkedSources(changed)
 assert.equal(resolved.faultTree.folios[499].state.nodes[0].data.dist_params.alpha,20)
 assert.ok(reads<500,'a real source update must touch its linked node, not every unrelated node')
 console.log(JSON.stringify({performance:{trees:500,nodes:50000,initialMs:Math.round(initial),previewNodeReads,warmPreviewMs,sourceUpdateNodeReads:reads}}))
})
