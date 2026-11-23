/** Physical invariance and saved report provenance for the added workflows. */
import assert from 'node:assert/strict'
import {createServer as createHttpServer} from 'node:http'
import {createSsrTestServer} from './viteTestLifecycle.mjs'
const http=createHttpServer()
const vite=await createSsrTestServer({root:new URL('..',import.meta.url).pathname,appType:'custom',server:{middlewareMode:true,ws:{server:http}}})
try {
  const {convertStateObject,UNIT_RULES}=await vite.ssrLoadModule('/src/store/unitFields.ts')
  const cv=(key,value)=>convertStateObject(value,UNIT_RULES[key],'hours','days')
  const inv=cv('maintInventory',{horizon:'48',rows:[{quantity:'10',rate:'.01',storageRate:'.02',eta:'240',beta:'2',lead:'24',leadSd:'12',age:'48',entry:'24',exit:'120',cost:'400'}]})
  assert.equal(inv.horizon,'2');assert.equal(inv.rows[0].rate,'0.24');assert.equal(inv.rows[0].quantity,'10')
  assert.equal(inv.rows[0].storageRate,'0.48');assert.equal(inv.rows[0].beta,'2');assert.equal(inv.rows[0].cost,'400')
  const ram=cv('ram',{maint:{mode:'frequency',mu:'5',sigma:'.7',mttr:'48',samples:'24, 5\n48, 2\n'}})
  assert.equal(ram.maint.mttr,'2');assert.equal(Number(ram.maint.mu),5+Math.log(1/24));assert.equal(ram.maint.sigma,'.7')
  assert.equal(ram.maint.samples,'1, 5\n2, 2\n')
  const inf=cv('reliabilityTestingTools',{aggregateMTBF:{totalExposure:'240',exposureText:'5, 48, .5\n2, 24, 1'},sequentialSampling:{goodMtbf:'240',badMtbf:'120',alpha:'.05',failureTimes:'24, 48\n',observedExposure:'72'}})
  assert.equal(inf.aggregateMTBF.totalExposure,'10');assert.equal(inf.aggregateMTBF.exposureText,'5, 2, .5\n2, 1, 1')
  assert.equal(inf.sequentialSampling.goodMtbf,'10');assert.equal(inf.sequentialSampling.alpha,'.05')
  const life=cv('lifeTools',{ages:'0:240:24',durations:'24, 48',eta:'240',beta:'2',priorAlpha:'.5'})
  assert.equal(life.ages,'0:10:1');assert.equal(life.durations,'1, 2');assert.equal(life.beta,'2')
  const lifecycle=cv('system',{lifecycle:{modelSignature:'old',settings:{horizon:240,warmup:24,policies:{c:{pm_interval:48,supply_lead_time:12,repair:{distribution:'lognormal',params:{mu:4,sigma:.5}},pm_duration:{distribution:'exponential',params:{mean:24}}}}}}})
  assert.equal(lifecycle.lifecycle.modelSignature,undefined)
  assert.equal(lifecycle.lifecycle.settings.policies.c.repair.params.mu,4+Math.log(1/24))
  assert.equal(lifecycle.lifecycle.settings.policies.c.repair.params.sigma,.5)
  assert.equal(lifecycle.lifecycle.settings.policies.c.pm_duration.params.mean,1)
  const project=await vite.ssrLoadModule('/src/store/project.ts')
  const {toolkitAssets}=await vite.ssrLoadModule('/src/store/toolkitAssets.ts')
  const {systemDiagramSignature,resolveLifecycleDiagram,lifecycleSettingsSignature}=await vite.ssrLoadModule('/src/components/shared/systemLifecycleSource.ts')
  project.newProject('Toolkit report provenance')
  const st={nodes:[{id:'c',type:'component',position:{x:0,y:0},data:{distribution:'exponential',dist_params:{lambda:.01}}}],edges:[],missionTime:100}
  const settings={overrides:{},policies:{},horizon:1000}
  const inputSignature=lifecycleSettingsSignature(settings)
  const signature=systemDiagramSignature(resolveLifecycleDiagram(project.getProjectState(),'rbd',st))
  project.writeModuleSlices({lifeTools:{matrixResult:{_units:'hours',ages:[0],durations:[1],survival:[[.9]],failure:[[.1]]}},maintInventory:{result:{rows:[{part_number:'A',required_stock:5}],purchase_quantity:5}},system:{_folioWrap:true,activeId:'rbd',folios:[{id:'rbd',name:'System',state:{...st,lifecycle:{modelSignature:signature,inputSignature,settings,renewalResult:{mttf:100}}}}]}})
  let assets=toolkitAssets(project.getProjectState())
  assert.ok(assets.some(a=>a.module==='lifeTools'&&a.type==='plot'))
  assert.ok(assets.some(a=>a.module==='maintInventory'&&a.type==='table'))
  assert.equal(assets.find(a=>a.module==='system').source.resultStatus,'current')
  const changedInputs=structuredClone(project.getProjectState())
  changedInputs.modules.system.folios[0].state.lifecycle.settings.horizon=2000
  assert.equal(toolkitAssets(changedInputs).find(a=>a.module==='system').source.resultStatus,'stale','a programmatic horizon edit invalidates saved lifecycle assets')
  const state=structuredClone(project.getProjectState())
  state.modules.system.folios[0].state.nodes[0].position.x=400
  assert.equal(toolkitAssets(state).find(a=>a.module==='system').source.resultStatus,'current','moving a symbol preserves calculation freshness')
  state.modules.system.folios[0].state.nodes[0].data.dist_params.lambda=.02
  assert.equal(toolkitAssets(state).find(a=>a.module==='system').source.resultStatus,'stale','changing physics invalidates saved lifecycle assets')
  state.units='days'
  assert.equal(toolkitAssets(state).find(a=>a.module==='lifeTools').source.resultStatus,'stale')
  assert.equal(project.NAV_MAP.maintInventory.sub,'inventory')
  assert.equal(project.NAV_MAP.predictionComparison.sub,'comparison')
  console.log('Toolkit dimensional and saved report provenance contracts passed')
} finally {await vite.close();http.close()}
