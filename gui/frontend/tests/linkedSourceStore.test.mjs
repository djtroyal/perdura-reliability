/** Real store regression: reconciliation metadata must not stale a just-completed run. */
import assert from 'node:assert/strict'
import {createServer} from 'vite'
import {createServer as createHttpServer} from 'node:http'
import {mkdtemp} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {closeViteTestServer,ssrOnlyVitePlugin} from './viteTestLifecycle.mjs'
const cache=await mkdtemp(join(tmpdir(),'perdura-source-store-')),hmrServer=createHttpServer()
const vite=await createServer({root:new URL('..',import.meta.url).pathname,cacheDir:cache,appType:'custom',
 plugins:[ssrOnlyVitePlugin()],server:{middlewareMode:true,ws:{server:hmrServer}}})
try{
 const project=await vite.ssrLoadModule('/src/store/project.ts')
 const model=await vite.ssrLoadModule('/src/components/shared/adoptedDistribution.ts')
 const sources=await vite.ssrLoadModule('/src/components/shared/reliabilitySources.ts')
 const dashboard=await vite.ssrLoadModule('/src/store/dashboardSummary.ts')
 function source(eta){const f={id:'source',name:'Source',dataSource:'spec',quantity:{kind:'time',unit:'hours'},spec:{distribution:'Weibull_2P',params:{eta:String(eta),beta:'2'},mcMode:'single'},specResult:{distribution:'Weibull_2P',params:{eta,beta:2}}};f.fitProvenance=model.createFitProvenance(f);f.adoptedDistribution=model.adoptDistribution(f,'Weibull_2P');return f}
 project.newProject('Linked-source integration')
 project.setModuleState('lifeData',{folios:[source(10)],activeId:'source'})
 project.setModuleState('system',{_folioWrap:true,activeId:'parent',folios:[
  {id:'parent',name:'Parent',dirty:false,state:{nodes:[{id:'transfer',type:'component',data:{linkedAnalysisId:'child'}}],edges:[]}},
  {id:'child',name:'Child',dirty:false,state:{nodes:[{id:'component',type:'component',data:{distributionSource:{module:'lifeData',analysisId:'source'}}}],edges:[]}},
 ]})
 const complete=id=>{
  const state=project.readFolioState('system',id)
  const next={...state,result:{system_reliability:.9,_sourceFingerprint:sources.analysisSourceFingerprint(project.getProjectState(),'system',id)}}
  project.writeFolioState('system',id,next)
  return next
 }
 complete('child');complete('parent')
 const maintenance={sourceId:'source',result:{interval:100}}
 maintenance.result._sourceFingerprint=sources.linkedSourcesFingerprint(project.getProjectState(),maintenance)
 project.setModuleState('maintPMInterval',maintenance)
 assert.equal(dashboard.computeDashboardSummary().areas.find(area=>area.tabId==='maintenance').stale,false)
 const old=project.readFolioState('system','parent').result
 project.setModuleState('lifeData',{folios:[source(20)],activeId:'source'})
 assert.equal(project.readFolioState('system','parent').sourceStale,true)
 assert.equal(project.readFolioState('system','parent').result,old)
 assert.equal(project.getProjectState().modules.maintPMInterval.sourceStale,true)
 assert.equal(dashboard.computeDashboardSummary().areas.find(area=>area.tabId==='maintenance').stale,true,
  'Dashboard surfaces stale flat maintenance results after an adopted source changes')
 const committed=complete('parent'),fresh=project.readFolioState('system','parent')
 assert.equal(fresh.sourceStale,false)
 assert.equal(project.getProjectState().modules.system.folios[0].dirty,false)
 assert.equal(project.readFolioState('system','child').sourceStale,true)
 assert.deepEqual(project.analysisInputSnapshot(committed,'system'),project.analysisInputSnapshot(fresh,'system'),
  'post-write source-status reconciliation must not change mathematical inputs')
 let provenance=[]
 for(let attempt=0;attempt<40;attempt++){
  await new Promise(resolve=>setTimeout(resolve,25))
  provenance=await project.artifactSources('system','parent')
  if(provenance.length)break
 }
 assert.equal(provenance.length,1);assert.equal(provenance[0].current,true,'newly calculated artifact provenance must be current')
 const module=project.getProjectState().modules.lifeData
 project.setModuleState('lifeData',{...module,folios:module.folios.map(f=>({...f,name:'Renamed source'}))})
 assert.equal((await project.artifactSources('system','parent'))[0].current,true)
 // Calculation metadata does not change science, but the adopted model does.
 const baseline={adoptedDistribution:{parameters:{eta:10,beta:2}},spec:{distribution:'Weibull_2P',params:{eta:'10',beta:'2'}}}
 assert.deepEqual(project.analysisInputSnapshot(baseline,'lifeData'),project.analysisInputSnapshot({...baseline,
  fitProvenance:{fingerprint:'fit'},ssProvenance:{fingerprint:'ss'},adoptedCurves:{x:[1],y:[.9]},
  spec:{...baseline.spec,mcConvergence:[1,2],mcRunProvenance:{fingerprint:'mc'}}},'lifeData'))
 assert.notDeepEqual(project.analysisInputSnapshot(baseline,'lifeData'),project.analysisInputSnapshot({...baseline,
  adoptedDistribution:{parameters:{eta:20,beta:2}}},'lifeData'))

 const ssi=await vite.ssrLoadModule('/src/components/LifeData/stressStrengthModel.ts')
 const mc=await vite.ssrLoadModule('/src/components/LifeData/monteCarloModel.ts')
 for(const kind of ['ssi','mc']) {
  project.newProject('External context '+kind)
  const sourceA=source(10),quantity={kind:'time',unit:'hours'},options={projectUnit:'hours',engineRevision:2}
  const owner=kind==='ssi'?{id:'owner',name:'SSI',quantity,
   ssStressInput:{mode:'dataset',source:{module:'lifeData',analysisId:'source'}},
   ssStrengthInput:{mode:'manual',distribution:'Weibull_2P',parameters:{eta:'30',beta:'2'},quantity}}:
   {id:'owner',name:'MC',quantity,rows:[],spec:{distribution:'Weibull_2P',params:{eta:'10',beta:'2'},mcMode:'equation',
    mcVariables:[{id:'X',name:'X',distribution:'Weibull_2P',params:{},distributionSource:{module:'lifeData',analysisId:'source'}}],
    mcEquation:'X',n:'10',seed:'42',genMode:'replace',includeSuspensions:false,suspensionRate:'0',mcId:''}}
  const completed=kind==='ssi'?{...owner,ssResult:{probability:.1},ssProvenance:{fingerprint:ssi.ssiInputFingerprint([owner.ssStressInput,owner.ssStrengthInput],owner,[sourceA],options)}}:
   {...owner,result:{simulation:true},spec:{...owner.spec,mcConvergence:[{n:10}],mcRunProvenance:mc.resolveMcRun(owner,[sourceA],options)}}
  const write=(sourceFolio,folio=completed)=>project.setModuleState('lifeData',{folios:[sourceFolio,folio],activeId:'owner'})
  write(sourceA)
  const current=async()=> (await project.artifactSources('lifeData','owner'))[0]
  for(let attempt=0;attempt<100&&!await current();attempt++)await new Promise(resolve=>setTimeout(resolve,20))
  assert.equal((await current()).current,true,kind+' completed run starts current')
  write({...sourceA,name:'Renamed source'})
  assert.equal((await current()).current,true,kind+' source rename is presentation')
  write(source(20))
  assert.equal((await current()).current,false,kind+' adopted parameter change invalidates remote context')
  write({...sourceA,spec:{...sourceA.spec,params:{eta:'20',beta:'2'}}})
  assert.equal((await current()).current,false,kind+' stale source cannot remain current')
  write(sourceA)
  assert.equal((await current()).current,true,kind+' exact source restoration restores context')
  // Replace output, then edit its source before the coalescing timer fires.
  const newOutput=kind==='ssi'?{...completed,ssResult:{probability:.2}}:{...completed,result:{simulation:'rerun'}}
  write(sourceA,newOutput)
  write(source(30),newOutput)
  const oldId=(await current()).runId
  for(let attempt=0;attempt<100&&(await current()).runId===oldId;attempt++)await new Promise(resolve=>setTimeout(resolve,20))
  assert.notEqual((await current()).runId,oldId,kind+' replacement output captured')
  assert.equal((await current()).current,false,kind+' capture uses source context at completion, not delayed timer time')
 }
 console.log('PASS linked source store reconciliation, historical child independence, and current run provenance')
}finally{await closeViteTestServer(vite,cache,hmrServer)}
