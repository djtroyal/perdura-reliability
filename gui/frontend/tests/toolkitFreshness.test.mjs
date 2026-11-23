/** Saved outputs keep their evidence identity through edits and report navigation. */
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createServer as createHttpServer} from 'node:http'
import {createSsrTestServer} from './viteTestLifecycle.mjs'
const http=createHttpServer()
const vite=await createSsrTestServer({root:new URL('..',import.meta.url).pathname,appType:'custom',server:{middlewareMode:true,ws:{server:http}}})
try {
  const {lifetimeInputSignature,inventoryInputSignature,lifetimeResultStatus,inventoryResultStatus}=await vite.ssrLoadModule('/src/store/toolkitFreshness.ts')
  const {toolkitAssets}=await vite.ssrLoadModule('/src/store/toolkitAssets.ts')
  const project=await vite.ssrLoadModule('/src/store/project.ts')
  const {inferenceSignature}=await vite.ssrLoadModule('/src/components/ALT/inferenceToolContracts.ts')
  const {computeDashboardSummary}=await vite.ssrLoadModule('/src/store/dashboardSummary.ts')
  const {adoptDistribution,createFitProvenance}=await vite.ssrLoadModule('/src/components/shared/adoptedDistribution.ts')
  const {resolveReliabilitySource}=await vite.ssrLoadModule('/src/components/shared/reliabilitySources.ts')
  const {systemDiagramSignature,resolveLifecycleDiagram,lifecycleSettingsSignature}=await vite.ssrLoadModule('/src/components/shared/systemLifecycleSource.ts')
  const {systemInputFingerprint}=await vite.ssrLoadModule('/src/store/sharedSystemModel.ts')
  const folio=(eta=10)=>{
    const f={id:'a',name:'Dataset',dataSource:'spec',quantity:{kind:'time',unit:'hours'},spec:{distribution:'Weibull_2P',params:{eta:String(eta),beta:'2'},mcMode:'single'},specResult:{distribution:'Weibull_2P',params:{eta,beta:2}}}
    f.fitProvenance=createFitProvenance(f);f.adoptedDistribution=adoptDistribution(f,'Weibull_2P');return f
  }
  let p={units:'hours',modules:{lifeData:{folios:[folio()]}}}
  const life={tab:'matrix',sourceId:'a',ages:'0,1',durations:'0,1',eta:'10',beta:'2',measure:'survival'}
  life.matrixResult={_sourceId:'a',_sourceFingerprint:resolveReliabilitySource(p,'a').fingerprint,_units:'hours',_inputSignature:lifetimeInputSignature(life,'matrix'),ages:[0,1],durations:[0,1],survival:[[1,.9],[1,.8]],failure:[[0,.1],[0,.2]]}
  p.modules.lifeTools=life
  assert.equal(lifetimeResultStatus(p,life,'matrixResult').current,true)
  assert.equal(lifetimeResultStatus(p,{...life,measure:'failure',tab:'mechanical'},'matrixResult').current,true,'view changes preserve evidence')
  assert.equal(lifetimeResultStatus(p,{...life,ages:'0,2'},'matrixResult').current,false)
  assert.equal(lifetimeResultStatus({...p,units:'days'},life,'matrixResult').current,false)
  const changed={...p,modules:{...p.modules,lifeData:{folios:[folio(20)]}}}
  assert.equal(lifetimeResultStatus(changed,life,'matrixResult').reason,'Linked distribution changed')
  const deleted={...p,modules:{...p.modules,lifeData:{folios:[]}}}
  assert.equal(lifetimeResultStatus(deleted,life,'matrixResult').current,false)
  assert.equal(toolkitAssets(changed).find(a=>a.module==='lifeTools').source.resultStatus,'stale')
  const table=toolkitAssets(p).find(a=>a.label==='Conditional Survival Matrix')
  assert.equal(table.targetView,'matrix');assert.deepEqual(table.getData().tableRows[1],[1,'1','0.8'])
  for(const view of ['mechanical','inspection']){
    const state={...life,[`${view}Result`]:{_units:'hours',_inputSignature:lifetimeInputSignature(life,view),answer:1}}
    const asset=toolkitAssets({...p,modules:{...p.modules,lifeTools:state}}).find(a=>a.targetView===view)
    assert.ok(asset,`${view} report destination exists`)
  }
  const systemDefinition=JSON.parse(readFileSync(new URL('../src/data/demoProject.json',import.meta.url),'utf8')).modules.systemDefinition
  p.modules.systemDefinition=systemDefinition
  const scenario={id:'scenario',name:'Prediction',dirty:false,state:{partInputs:{p:1},blockInputs:{},result:{request_sha256:'request'}}}
  p.modules.prediction={_folioWrap:true,activeId:'scenario',folios:[scenario]}
  const inventory={mode:'period',horizon:'10',service:'.95',target:'joint',dependence:'independent',rows:[{pn:'P',rate:'.01'}],trials:'200',seed:'1',allocation:'equal_risk',maximumStock:'200',linkedScenarioId:'scenario'}
  inventory.sourceFingerprint=JSON.stringify([systemInputFingerprint(systemDefinition.model),'scenario','request',false,scenario.state.partInputs,scenario.state.blockInputs])
  inventory.result={units:'hours',source_fingerprint:inventory.sourceFingerprint,_inputSignature:inventoryInputSignature(inventory,'hours'),rows:[{part_number:'P',required_stock:3}]}
  p.modules.maintInventory=inventory
  assert.equal(inventoryResultStatus(p).current,true)
  assert.equal(inventoryResultStatus({...p,modules:{...p.modules,maintInventory:{...inventory,selectedId:'other',scenarioId:'other'}}}).current,true)
  assert.equal(inventoryResultStatus({...p,modules:{...p.modules,maintInventory:{...inventory,horizon:'20'}}}).reason,'Calculation inputs changed')
  const dirty={...p,modules:{...p.modules,prediction:{...p.modules.prediction,folios:[{...scenario,dirty:true}]}}}
  assert.equal(inventoryResultStatus(dirty).reason,'Prediction source changed')
  assert.equal(toolkitAssets(dirty).find(a=>a.module==='maintInventory').source.resultStatus,'stale')
  const old={...p,modules:{...p.modules,maintInventory:{...inventory,result:{...inventory.result,_inputSignature:undefined}}}}
  assert.equal(inventoryResultStatus(old).current,false,'legacy results without an input identity stay explicitly unverified')
  project.newProject('Saved toolkit freshness')
  project.writeModuleSlices(p.modules)
  assert.equal(computeDashboardSummary().areas.find(a=>a.tabId==='maintenance').stale,false)
  project.writeModuleSlices(changed.modules)
  assert.equal(computeDashboardSummary().areas.find(a=>a.tabId==='maintenance').stale,true)
  project.writeModuleSlices(dirty.modules)
  assert.ok(computeDashboardSummary().areas.find(a=>a.tabId==='maintenance').staleDetails.some(v=>v.includes('Prediction source changed')))
  const lifecycleState={nodes:[{id:'c',type:'component',data:{distribution:'exponential',dist_params:{lambda:.01}}}],edges:[],missionTime:100}
  const settings={policies:{},overrides:{},horizon:1000}
  lifecycleState.lifecycle={settings,modelSignature:systemDiagramSignature(resolveLifecycleDiagram(project.getProjectState(),'rbd',lifecycleState)),inputSignature:lifecycleSettingsSignature(settings),renewalResult:{mttf:100}}
  project.writeModuleSlices({system:{_folioWrap:true,activeId:'rbd',folios:[{id:'rbd',name:'RBD',state:lifecycleState}]}})
  assert.equal(computeDashboardSummary().areas.find(a=>a.tabId==='system-modeling').stale,false)
  const revisedLifecycle=structuredClone(lifecycleState);revisedLifecycle.lifecycle.settings.horizon=2000
  project.writeModuleSlices({system:{_folioWrap:true,activeId:'rbd',folios:[{id:'rbd',name:'RBD',state:revisedLifecycle}]}})
  assert.ok(computeDashboardSummary().areas.find(a=>a.tabId==='system-modeling').staleDetails.some(v=>v.includes('Lifecycle settings changed')))
  project.writeModuleSlices({system:{_folioWrap:true,activeId:'rbd',folios:[{id:'rbd',name:'RBD',state:{nodes:[],edges:[],lifecycle:{modelSignature:'old',settings:{policies:{},overrides:{}},renewalResult:{mttf:100}}}}]}})
  assert.ok(computeDashboardSummary().areas.find(a=>a.tabId==='system-modeling').staleDetails.some(v=>v.includes('Lifecycle')))
  const inference={totalExposure:'100',failures:'2'}
  inference.result={mtbf_estimate:50,_units:'hours',_inputSignature:inferenceSignature(inference)}
  project.writeModuleSlices({reliabilityTestingTools:{aggregateMTBF:inference}})
  assert.equal(computeDashboardSummary().areas.find(a=>a.tabId==='alt').stale,false)
  project.writeModuleSlices({reliabilityTestingTools:{aggregateMTBF:{...inference,failures:'3'}}})
  assert.ok(computeDashboardSummary().areas.find(a=>a.tabId==='alt').staleDetails.some(v=>v.includes('Field MTBF')))
  console.log('Toolkit saved input, linked-source, unit and report destination checks passed')
}finally{await vite.close();http.close()}
