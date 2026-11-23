/** Real consumer editors/store and Python numerical routers, with delayed HTTP responses. */
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {fileURLToPath} from 'node:url'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium, expect as baseExpect } from '@playwright/test'
const expect = baseExpect.configure({ timeout: 60000 })
import {unzipSync,strFromU8} from 'fflate'
import { closeViteTestServer } from './viteTestLifecycle.mjs'

const root = new URL('..', import.meta.url).pathname, repo = resolve(root, '../..')
const arg = process.argv.indexOf('--output-dir')
const output = resolve(arg < 0 ? join(tmpdir(), 'perdura-system-lifecycle-browser') : process.argv[arg + 1])
await mkdir(output, { recursive: true })
if(!process.argv.includes('--markov-only') && !process.argv.includes('--diagrams-only')) {
 for(const phase of ['diagrams','markov']) {
  const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),`--${phase}-only`,'--output-dir',output],{stdio:'inherit',timeout:600000})
  if(child.error)throw child.error
  if(child.status!==0)throw new Error(`${phase} browser phase failed (${child.status ?? child.signal})`)
 }
 const phases=await Promise.all(['diagrams','markov'].map(async phase=>JSON.parse(await readFile(join(output,phase+'-results.json'),'utf8'))))
 await writeFile(join(output,'results.json'),JSON.stringify({status:'passed',checks:phases.flatMap(phase=>phase.checks),phases},null,2))
 console.log('Both system lifecycle browser phases passed');process.exit(0)
}

const cache = await mkdtemp(join(tmpdir(), 'perdura-live-consumers-vite-'))
const entry = '/__live-consumers.tsx'
const fixture = `
import React from 'react'
import {createRoot} from 'react-dom/client'
import '/src/index.css'
import {FaultTreeEditor} from '/src/components/FaultTree'
import RBD from '/src/components/SystemReliability'
import Markov from '/src/components/Markov'
import {KeyboardShortcutProvider} from '/src/components/shared/KeyboardShortcuts'
import {ReportAssetScopeProvider} from '/src/components/shared/ReportAssetScope'
import * as project from '/src/store/project'
import {lifecycleSourceStatus} from '/src/components/shared/systemLifecycleSource'
import {requestBookmarkNavigation} from '/src/store/bookmarks'
import {adoptDistribution,createFitProvenance} from '/src/components/shared/adoptedDistribution'
const kind=new URL(location.href).searchParams.get('module')||'fta'
const moduleKey={fta:'faultTree',rbd:'system',markov:'markov',replacement:'maintReplacement',pm:'maintPMInterval',cost:'maintCostForecast'}[kind]
await project.hydrateProjectStorage()
project.newProject('Live source browser '+kind)
// Deliberately specified (not fabricated fit) models give independent exact expectations.
function source(value=1,unit='hours',shifted=false) {
 const distribution=shifted?'Exponential_2P':'Exponential_1P'
 const params={Lambda:value/1000,...(shifted?{gamma:1}:{})}
 const folio={id:'life',name:'Adopted lifetime dataset',analysisMode:'parametric',dataSource:'spec',quantity:{kind:'time',unit},
  spec:{distribution,params:Object.fromEntries(Object.entries(params).map(([k,v])=>[k,String(v)]))},specResult:{distribution,params}}
 folio.fitProvenance=createFitProvenance(folio)
 folio.adoptedDistribution=adoptDistribution(folio,distribution)
 return folio
}
const updateSource=(value=1,unit='hours',shifted=false)=>project.setModuleState('lifeData',{folios:[source(value,unit,shifted)],activeId:'life'})
updateSource()
project.setModuleState('maintTaskAnalysis',{tasks:[{id:'replace',title:'Replace controller',revision:'B',status:'approved',task_type:'corrective',takes_asset_out_of_service:true,affected_asset_count:1,
steps:[{id:'one',predecessor_step_ids:[],execution_probability:1,resources:[],duration:{mode:'fixed',fixed_hours:2},personnel:[{role_id:'electrical',headcount:2,engagement_fraction:1}]}]}],personnel:[{id:'electrical',available_headcount:3,weekly_shifts:[],planned_outages:[]}],resources:[]})
const linked={label:'Live linked component',distributionSource:{module:'lifeData',analysisId:'life'},
 ldaFolioId:'life',ldaSource:'life',distribution:'weibull',dist_params:{alpha:99999,beta:9},probability:.999,reliability:.999}
const fta={nodes:[{id:'g',type:'or',position:{x:180,y:10},data:{label:'Top event'}},
 {id:'live',type:'basic',position:{x:180,y:220},data:{...linked,eventKey:'live'}}],
 edges:[{id:'e',source:'g',target:'live',data:{role:'input',order:0}}],annotations:[],
 exposureTime:'1000',engine:'exact',confidenceLevel:'95',nSimulations:'20000',density:'comfortable'}
const rbd={nodes:[{id:'source',type:'source',position:{x:10,y:100},data:{label:'Source'}},
 {id:'live',type:'component',position:{x:240,y:100},data:linked},
 {id:'sink',type:'sink',position:{x:520,y:100},data:{label:'Sink'}}],
 edges:[{id:'a',source:'source',target:'live'},{id:'b',source:'live',target:'sink'}],annotations:[],missionTime:'1000',density:'comfortable'}
const markov={states:[{id:'up',name:'Operating',state_type:'operational'}, {id:'down',name:'Failed',state_type:'failed'}],
 transitions:[{id:'failure',from_state:'up',to_state:'down',rate:999,label:'lambda',sourceId:'life'},
 {id:'repair',from_state:'down',to_state:'up',rate:.001,label:'mu'}],
 positions:{up:{x:60,y:100},down:{x:440,y:100}},initialState:'up',tMax:1000,nPoints:3,
 uncertaintySamples:0,uncertaintyCI:.95,uncertaintySeed:42,annotations:[],density:'comfortable',result:null}
const maintenance={sourceId:'life',srcId:'life',alpha:'99999',beta:'9',costPM:'1',costCM:'8',
 policy:'block',interval:'100',horizon:'1000',target:'.9',result:null}
const activeState=kind==='fta'?fta:kind==='rbd'?rbd:markov
const alternate=JSON.parse(JSON.stringify(activeState))
if(kind==='rbd'){alternate.missionTime='77';alternate.nodes[1].data.label='Alternate component'}
if(kind==='markov'){alternate.tMax=77;alternate.states[0].name='Alternate operating state'}
project.setModuleState(moduleKey,['fta','rbd','markov'].includes(kind)?{_folioWrap:true,activeId:'consumer',
 folios:[{id:'consumer',name:'Live consumer fixture',state:activeState},
 ...(['rbd','markov'].includes(kind)?[{id:'alternate',name:'Alternate consumer',state:alternate}]:[])]}:maintenance)
const snapshot=()=>project.readFolioState(moduleKey,['fta','rbd','markov'].includes(kind)?'consumer':'f0')
window.consumerTest={project,kind,moduleKey,updateSource,snapshot,requestBookmarkNavigation,fresh:()=>lifecycleSourceStatus(project.getProjectState(),kind,snapshot())}
function App(){const [units,setUnits]=project.useUnits();window.consumerTest.setUnits=setUnits
 return <KeyboardShortcutProvider><ReportAssetScopeProvider value={{module:moduleKey,moduleLabel:kind}}>
 <div className="perdura-theme flex h-screen min-h-0 flex-col">{kind==='fta'?<FaultTreeEditor/>:kind==='rbd'?<RBD/>:
 <Markov/>}</div>
 </ReportAssetScopeProvider></KeyboardShortcutProvider>}
createRoot(document.getElementById('root')).render(<App/>)
`
const vite = await createServer({ root, cacheDir: cache, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [{
  name: 'live-consumer-fixture', resolveId(id) { if (id === entry) return id }, load(id) { if (id === entry) return fixture },
  configureServer(server) { server.middlewares.use('/__live-consumers', async (req, res, next) => {
    if (!['/', ''].includes(req.url?.split('?')[0])) return next()
    res.setHeader('Content-Type', 'text/html')
    res.end(await server.transformIndexHtml('/__live-consumers', `<!doctype html><html lang="en"><head><title>Live consumer regression</title></head><body><main id="root"></main><script type="module" src="${entry}"></script></body></html>`))
  }) },
}] })
const python = process.env.PERDURA_PYTHON ?? resolve(repo, '.venv/bin/python')
function calculate(kind, body) {
  return JSON.parse(execFileSync(python, ['-c', `
import json,sys
from routers import fault_tree,system_reliability,markov,maintenance,system_tools
from schemas import FaultTreeRequest,RBDRequest,MarkovRequest
p=json.load(sys.stdin); kind=p['kind']; body=p['body']
if kind in ['renewal','states','simulate','redundancy']:
    fn,model={'renewal':(system_tools.analyze_renewal,system_tools.RenewalRequest),'states':(system_tools.analyze_states,system_tools.StateRequest),'simulate':(system_tools.analyze_simulation,system_tools.SimulationRequest),'redundancy':(system_tools.build_redundancy,system_tools.RedundancyRequest)}[kind];out=fn(model(**body))
elif kind=='validate':out=markov.validate(MarkovRequest(**body))
elif kind=='fta': out=fault_tree.analyze_fault_tree(FaultTreeRequest(**body))
elif kind=='rbd': out=system_reliability.compute_rbd(RBDRequest(**body))
elif kind=='markov': out=markov.analyze(MarkovRequest(**body))
elif kind=='replacement': out=maintenance.replacement_policy(maintenance.ReplacementPolicyRequest(**body))
elif kind=='pm': out=maintenance.pm_interval(maintenance.PMIntervalRequest(**body))
elif kind=='cost': out=maintenance.cost_forecast(maintenance.CostForecastRequest(**body))
else: raise ValueError(kind)
print(json.dumps(out,allow_nan=False))
`], { cwd: repo, env: { ...process.env, PYTHONPATH: join(repo, 'src') + ':' + join(repo, 'gui/backend'), MPLCONFIGDIR: join(tmpdir(), 'perdura-consumer-mpl') },
    input: JSON.stringify({ kind, body }), encoding: 'utf8', timeout: 60000, maxBuffer: 8_000_000 }))
}
let browser,page,holdNext=false,release
const checks=[],errors=[],requests=[]
const check=message=>{checks.push(message);console.log(message)}
try {
 await vite.listen();browser=await chromium.launch({headless:true})
 page=await browser.newPage({viewport:{width:1650,height:1150},reducedMotion:'reduce'});page.setDefaultTimeout(60000)
 page.on('pageerror',error=>errors.push(error.message))
 await page.route(url=>url.pathname.startsWith('/api/'),async route=>{
  const path=new URL(route.request().url()).pathname,body=route.request().postDataJSON()
  const kind=path.includes('/system-tools/')?path.split('/').at(-1):path.endsWith('/markov/validate')?'validate':path.endsWith('/markov/analyze')?'markov':null
  if(!kind)return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({valid:true,issues:[]})})
  const record={kind,body};requests.push(record)
  try {const result=calculate(kind,body);record.result=result
   if(holdNext && kind==='simulate'){holdNext=false;await new Promise(resolve=>{release=resolve})}
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)})
  }catch(error){errors.push(String(error));await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({detail:String(error)})})}
 })
 const snapshot=()=>page.evaluate(()=>window.consumerTest.snapshot())
 const navigate=kind=>page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__live-consumers?module=${kind}`,{waitUntil:'domcontentloaded',timeout:90000})
 const lifecycle=page.getByRole('button',{name:'Lifecycle: renewal, state table and repairable simulation',exact:true})
 if(!process.argv.includes('--markov-only')) {
 await navigate('rbd');await lifecycle.waitFor({timeout:90000});await lifecycle.click()
 await page.getByRole('button',{name:'Calculate renewal',exact:true}).click()
 await expect.poll(async()=>Boolean((await snapshot()).lifecycle?.renewalResult),{timeout:60000}).toBe(true)
 assert.ok(Math.abs((await snapshot()).lifecycle.renewalResult.mttf-1000)<1e-6)
 assert.equal(await page.evaluate(()=>window.consumerTest.fresh().current),true)
 check('RBD current adopted lifetime feeds renewal and report source verification')
 await page.getByRole('button',{name:'State table and export',exact:true}).click();await page.getByRole('button',{name:'Evaluate states',exact:true}).click()
 await expect(page.getByLabel('State 0 succeeds')).toBeVisible()
 const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Export state CSV',exact:true}).click();const download=await downloading
 const bundle=unzipSync(new Uint8Array(await readFile(await download.path())))
 assert.ok(bundle['system-states.csv.perdura.json']);assert.match(strFromU8(bundle['system-states.csv']),/state_id,live,success,probability/)
 await page.getByLabel('State 0 succeeds').check();await expect(page.getByRole('button',{name:'Export state CSV',exact:true})).toBeDisabled()
 await page.getByRole('button',{name:'Evaluate states',exact:true}).click();await expect.poll(async()=>(await snapshot()).lifecycle.stateResult.success_probability).toBe(1)
 await page.getByRole('button',{name:'Reset state overrides',exact:true}).click()
 check('State edits require reevaluation; CSV export includes assurance manifest')
 await page.getByRole('button',{name:'Repairable simulation',exact:true}).click();await page.getByLabel('Replications (20–5000)',{exact:true}).fill('100')
 await page.locator('summary').filter({hasText:'Live linked component · exponential life'}).click()
 await page.getByLabel('Live linked component maintenance task',{exact:true}).selectOption('replace')
 assert.equal((await snapshot()).lifecycle.settings.policies.live.crew_demand,2)
 assert.equal((await snapshot()).lifecycle.settings.repair_crews,3)
 await page.getByRole('button',{name:'Simulate system',exact:true}).click();await expect.poll(async()=>Boolean((await snapshot()).lifecycle?.simulationResult),{timeout:60000}).toBe(true)
 assert.ok((await snapshot()).lifecycle.simulationResult.availability.mean>.95)
 await page.screenshot({path:join(output,'rbd-system-simulation.png')});check('Real diagram-connected seeded DES persists policies and results')
 holdNext=true;await page.getByRole('button',{name:'Simulate system',exact:true}).click();await expect.poll(()=>Boolean(release),{timeout:60000}).toBe(true)
 await page.getByLabel('Seed',{exact:true}).fill('43');release();release=undefined
 await expect(page.getByRole('alert')).toContainText('changed');assert.equal((await snapshot()).lifecycle.simulationResult,undefined)
 check('Delayed DES response cannot overwrite newer settings')
 holdNext=true;await page.getByRole('button',{name:'Simulate system',exact:true}).click();await expect.poll(()=>Boolean(release),{timeout:60000}).toBe(true)
 await page.evaluate(()=>window.consumerTest.updateSource(2));release();release=undefined
 await expect(page.getByRole('alert')).toContainText('changed');assert.equal((await snapshot()).lifecycle.simulationResult,undefined)
 check('Delayed DES response cannot overwrite a revised adopted source')
 await page.getByRole('button',{name:'Simulate system',exact:true}).click();await expect.poll(async()=>Boolean((await snapshot()).lifecycle?.simulationResult),{timeout:60000}).toBe(true)
 await page.evaluate(()=>window.consumerTest.updateSource(3));await expect.poll(()=>page.evaluate(()=>window.consumerTest.fresh().current)).toBe(false)
 check('Adopted source revision marks saved lifecycle result historical')
 await page.getByRole('button',{name:'Close',exact:true}).click()
 await page.evaluate(()=>window.consumerTest.requestBookmarkNavigation({module:'system',tab:'rbd',analysisId:'consumer',view:'lifecycle',analysisName:'Lifecycle fixture',assetKey:'fixture'},'Lifecycle'))
 await expect(page.getByRole('dialog',{name:'System lifecycle analysis'})).toBeVisible()
 check('Lifecycle report bookmark reopens the owning analysis panel')
 await navigate('fta');await lifecycle.waitFor({timeout:90000});await lifecycle.click()
 await page.getByRole('button',{name:'Repairable simulation',exact:true}).click();await page.getByLabel('Replications (20–5000)',{exact:true}).fill('20')
 await page.getByRole('button',{name:'Simulate system',exact:true}).click();await expect.poll(async()=>Boolean((await snapshot()).lifecycle?.simulationResult),{timeout:60000}).toBe(true)
 assert.equal(await page.evaluate(()=>window.consumerTest.fresh().current),true)
 await page.screenshot({path:join(output,'fta-system-simulation.png')});check('Static FTA has a usable diagram-connected DES entry')
 }
 if(!process.argv.includes('--diagrams-only')) {
 await navigate('markov');await page.getByRole('button',{name:'Build repairable redundancy',exact:true}).waitFor({timeout:90000});await page.getByRole('button',{name:'Build repairable redundancy',exact:true}).click()
 await page.getByLabel('Configuration',{exact:true}).selectOption('standby');await page.getByLabel('Total units',{exact:true}).fill('3')
 await page.getByLabel('Switch success probability',{exact:true}).fill('.5');await page.getByLabel('Switch dependence',{exact:true}).selectOption('common')
 await page.getByLabel(/^Unit repair rate/).fill('0');await page.getByLabel(/^Switch restoration rate/).fill('0')
 await page.getByRole('button',{name:'Preview model',exact:true}).click();await expect(page.getByRole('button',{name:'Load model into canvas',exact:true})).toBeEnabled()
 await page.getByRole('button',{name:'Load model into canvas',exact:true}).click();await page.getByRole('button',{name:'Analyze Markov Model',exact:true}).click()
 await expect.poll(async()=>Boolean((await snapshot()).result),{timeout:60000}).toBe(true)
 const markov=await snapshot();assert.equal(Object.keys(markov.initialProbabilities).length,2);assert.ok(Math.abs(markov.result.system_params.mttf-2000)<1e-6)
 await page.screenshot({path:join(output,'markov-common-readiness.png')});check('Guided standby model loads editable canvas and analyzes initial mixture')
 }
 assert.deepEqual(errors,[])
 await writeFile(join(output,process.argv.includes('--markov-only')?'markov-results.json':'diagrams-results.json'),JSON.stringify({status:'passed',checks,errors,requests:requests.map(r=>({kind:r.kind,body:r.body,method:r.result?.method_version}))},null,2))
 console.log(JSON.stringify({status:'passed',checks,output},null,2))
}catch(error){if(page)await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});await writeFile(join(output,'failure.json'),JSON.stringify({error:String(error),errors,checks,requests},null,2));throw error}
finally{release?.();await browser?.close();await closeViteTestServer(vite,cache)}
