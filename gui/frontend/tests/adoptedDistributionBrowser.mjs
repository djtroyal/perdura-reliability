/** Real production LDA/SSI UI and HTTP payloads; responses use the Python router. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { closeViteTestServer } from './viteTestLifecycle.mjs'

const root=new URL('..',import.meta.url).pathname, repo=resolve(root,'../..')
const outputOption=process.argv.indexOf('--output-dir')
const output=resolve(outputOption<0 ? join(tmpdir(),'perdura-adopted-distribution') : process.argv[outputOption+1])
await mkdir(output,{recursive:true})
const cache=await mkdtemp(join(tmpdir(),'perdura-adoption-vite-'))
const entry='/__adoption.tsx'
const fixture=`
import React from 'react'
import {createRoot} from 'react-dom/client'
import '/src/index.css'
import LifeData from '/src/components/LifeData'
import {KeyboardShortcutProvider} from '/src/components/shared/KeyboardShortcuts'
import {ReportAssetScopeProvider} from '/src/components/shared/ReportAssetScope'
import * as project from '/src/store/project'
import * as model from '/src/components/shared/adoptedDistribution'
import {computeDashboardSummary} from '/src/store/dashboardSummary'
import demo from '/src/data/demoProject.json'
await project.hydrateProjectStorage()
project.newProject('Adopted model browser fixture')
const base=demo.modules.lifeData.folios[0]
const values=[31,58,72,84,96,108,120,135,152,178,205,240]
const make=(id,name,multiplier,unit)=>({...base,id,name,analysisMode:'parametric',dataSource:'table',dataFormat:'individual',
  selectedDists:['Weibull_2P','Normal_2P'],method:'MLE',ci:.95,ciText:'.95',setDist:null,adoptedDistribution:null,result:null,
  quantity:{kind:'pressure',unit},rows:values.map((v,i)=>({key:id+i,id:i<6?'A':'B',time:String(v*multiplier),state:'F'}))})
project.setModuleState('lifeData',{folios:[make('a','Stress dataset',1,'MPa'),make('b','Strength dataset',1300,'kPa')],
  activeId:'a',folioSeq:2,compare:{folioIds:[],commonDistribution:'',ci:.95,ciText:'.95'}})
window.adoptionTest={project,model,computeDashboardSummary}
createRoot(document.getElementById('root')).render(<KeyboardShortcutProvider><ReportAssetScopeProvider value={{module:'lifeData',moduleLabel:'Life Data'}}>
<div className="perdura-theme flex h-screen flex-col"><LifeData/></div></ReportAssetScopeProvider></KeyboardShortcutProvider>)
`
const vite=await createServer({root,cacheDir:cache,logLevel:'error',server:{host:'127.0.0.1',port:0,hmr:false},plugins:[{
  name:'adoption-fixture',resolveId(id){if(id===entry)return id},load(id){if(id===entry)return fixture},
  configureServer(server){server.middlewares.use('/__adoption',async(req,res,next)=>{
    if(req.url!=='/'&&req.url!=='')return next()
    res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__adoption',
      `<!doctype html><html lang="en"><head><title>Adopted distribution assurance</title></head><body><main id="root"></main><script type="module" src="${entry}"></script></body></html>`))
  })},
}]})
const python=process.env.PERDURA_PYTHON ?? resolve(repo,'.venv/bin/python')
const calculate=(kind,body)=>JSON.parse(execFileSync(python,['-c',`
import json,sys
from routers import life_data
from schemas import LifeDataFitRequest,SingleDistPlotRequest,SpecCurvesRequest,MCEquationRequest
from ssi_schemas import StressStrengthRequest
p=json.load(sys.stdin)
kind=p['kind']; body=p['body']
if kind=='fit': out=life_data._run_fit(LifeDataFitRequest(**body))
elif kind=='plot': out=life_data.single_distribution_plot(SingleDistPlotRequest(**body))
elif kind=='spec-curves': out=life_data.spec_curves(SpecCurvesRequest(**body))
elif kind=='stress-strength': out=life_data.stress_strength(StressStrengthRequest(**body))
elif kind=='mc-equation': out=life_data.mc_equation(MCEquationRequest(**body))
else: raise ValueError(kind)
print(json.dumps(out,allow_nan=False))
`],{cwd:repo,env:{...process.env,PYTHONPATH:join(repo,'src')+':'+join(repo,'gui/backend'),MPLCONFIGDIR:join(tmpdir(),'perdura-adoption-mpl')},
  input:JSON.stringify({kind,body}),encoding:'utf8',timeout:60000,maxBuffer:6_000_000}))
let browser,page
let holdNextSsi=false, releaseSsi
let holdNextMc=false, releaseMc
const checks=[],errors=[],requests=[]
try {
  await vite.listen();browser=await chromium.launch({headless:true})
  const context=await browser.newContext({viewport:{width:1600,height:1100},reducedMotion:'reduce'})
  page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message))
  await page.route(url=>url.pathname.startsWith('/api/'),async route=>{
    const path=new URL(route.request().url()).pathname
    const kind=path.endsWith('/fit/stream') ? 'fit' : path.split('/').at(-1)
    const body=route.request().postDataJSON();requests.push({kind,body})
    try {
      const result=calculate(kind,body)
      if(kind==='stress-strength' && holdNextSsi) {
        holdNextSsi=false
        await new Promise(resolve=>{releaseSsi=resolve})
      }
      if(kind==='mc-equation' && holdNextMc){holdNextMc=false;await new Promise(resolve=>{releaseMc=resolve})}
      await route.fulfill({status:200,contentType:path.endsWith('/stream')?'application/x-ndjson':'application/json',
        body:path.endsWith('/stream') ? JSON.stringify({type:'result',data:result})+'\n' : JSON.stringify(result)})
    } catch(e) { errors.push(String(e));await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({detail:String(e)})}) }
  })
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__adoption`,{waitUntil:'domcontentloaded'})
  await page.getByRole('button',{name:'Run Analysis',exact:true}).waitFor({timeout:90000})
  await page.getByRole('button',{name:'Run Analysis',exact:true}).click()
  await expect.poll(()=>page.evaluate(()=>!!window.adoptionTest.project.getProjectState().modules.lifeData.folios[0].result),{timeout:90000}).toBe(true)
  const bar=page.getByRole('region',{name:'Dataset distribution selection'})
  await expect(bar).toBeVisible({timeout:90000})
  const nonBest=await page.evaluate(()=>{
    const f=window.adoptionTest.project.getProjectState().modules.lifeData.folios[0]
    return f.result.results.find(row=>row.fit_eligible&&row.Distribution!==f.result.best_distribution).Distribution
  })
  await page.getByRole('row').filter({has:page.getByText(nonBest,{exact:true})}).first().click()
  await bar.getByRole('button',{name:'Set as dataset distribution'}).click()
  const adopted=await page.evaluate(()=>window.adoptionTest.project.getProjectState().modules.lifeData.folios[0].adoptedDistribution)
  assert.equal(adopted.distribution,nonBest)
  await page.getByTitle('Collapse fit results',{exact:true}).click()
  await expect(bar.getByRole('button',{name:'Set as dataset distribution'})).toBeVisible()
  const before=adopted.modelFingerprint
  await page.getByRole('button',{name:'Run Analysis',exact:true}).click()
  await expect(page.getByRole('button',{name:'Run Analysis',exact:true})).toBeEnabled({timeout:90000})
  assert.equal(await page.evaluate(()=>window.adoptionTest.project.getProjectState().modules.lifeData.folios[0].adoptedDistribution.modelFingerprint),before)
  assert.equal(await page.evaluate(()=>window.adoptionTest.computeDashboardSummary().areas.find(a=>a.tabId==='life-data').stale),false)
  const adoptionAxe=await new AxeBuilder({page}).include('[aria-label="Dataset distribution selection"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()
  assert.deepEqual(adoptionAxe.violations.filter(v=>['critical','serious'].includes(v.impact)),[])
  await page.screenshot({path:join(output,'adoption-bar.png'),fullPage:true})
  checks.push('Non-best model adopted explicitly; persistent accessible bar survives table collapse; unchanged refit preserves adoption; Dashboard current')
  await page.locator('[data-tab-id="b"]').click()
  await page.getByRole('button',{name:'Run Analysis',exact:true}).click()
  await expect.poll(()=>page.evaluate(()=>!!window.adoptionTest.project.getProjectState().modules.lifeData.folios[1].result),{timeout:90000}).toBe(true)
  await expect(bar).toBeVisible({timeout:90000})
  await bar.getByRole('button',{name:'Set as dataset distribution'}).click()
  await page.locator('[data-tab-id="a"]').click()
  await page.locator('[data-tab-id="stressstrength"]').click()
  await page.getByLabel('Stress dataset',{exact:true}).selectOption('a')
  await page.getByLabel('Strength dataset',{exact:true}).selectOption('b')
  const fitsBefore=requests.filter(r=>r.kind==='fit').length
  await page.getByRole('button',{name:'Compute Interference',exact:true}).click()
  await expect.poll(()=>requests.filter(r=>r.kind==='stress-strength').length,{timeout:90000}).toBe(1)
  await expect.poll(()=>page.evaluate(()=>!!window.adoptionTest.project.getProjectState().modules.lifeData.folios[0].ssResult)).toBe(true)
  const submitted=requests.find(r=>r.kind==='stress-strength').body
  assert.deepEqual(submitted.stress_params,adopted.parameters)
  assert.equal(submitted.stress_distribution,nonBest)
  assert.deepEqual(submitted.stress_quantity,{kind:'pressure',unit:'MPa'})
  assert.deepEqual(submitted.strength_quantity,{kind:'pressure',unit:'kPa'})
  assert.equal(requests.filter(r=>r.kind==='fit').length,fitsBefore)
  await page.screenshot({path:join(output,'ssi-live-sources.png'),fullPage:true})
  checks.push('SSI inherits exact adopted parameters without refitting, including mixed pressure units and real numerical result')
  await page.evaluate(()=>{window.previousSsiResult=window.adoptionTest.project.getProjectState().modules.lifeData.folios[0].ssResult})
  holdNextSsi=true
  await page.getByRole('button',{name:'Compute Interference',exact:true}).click()
  await expect.poll(()=>typeof releaseSsi,{timeout:90000}).toBe('function')
  await page.evaluate(()=>{
    const {project}=window.adoptionTest, state=project.getProjectState().modules.lifeData
    project.setModuleState('lifeData',{...state,folios:state.folios.map(f=>f.id==='b'?{...f,rows:f.rows.map((r,i)=>i? r:{...r,time:String(Number(r.time)+1)})}:f)})
  })
  await expect(page.getByText('Historical interference result',{exact:false})).toBeVisible()
  releaseSsi()
  await expect(page.getByRole('button',{name:'Compute Interference',exact:true})).toBeEnabled()
  assert.equal(await page.evaluate(()=>window.previousSsiResult===window.adoptionTest.project.getProjectState().modules.lifeData.folios[0].ssResult),true)
  await page.getByRole('button',{name:'Compute Interference',exact:true}).click()
  assert.equal(requests.filter(r=>r.kind==='stress-strength').length,2)
  checks.push('Changing an inherited dataset marks historical SSI output, rejects a pending old response and prevents stale calculation')
  page.on('dialog',dialog=>dialog.accept())
  await page.evaluate(()=>{
    const {project}=window.adoptionTest,state=project.getProjectState().modules.lifeData
    project.setModuleState('lifeData',{...state,activeId:'b',folios:state.folios.map(f=>f.id!=='b'?f:{...f,analysisMode:'parametric',dataSource:'spec',quantity:{kind:'pressure',unit:'MPa'},
      spec:{...f.spec,mcMode:'equation',mcVariables:[{id:'mc-linked',name:'A',distribution:'Normal_2P',params:{mu:'999',sigma:'10'}}],mcEquation:'abs(A)',n:'20',seed:'42',genMode:'replace',mcId:'',includeSuspensions:false}})})
  })
  await page.getByLabel('Variable A source',{exact:true}).selectOption('a')
  await expect(page.getByRole('group',{name:'Variable A',exact:true})).toContainText('Live adopted Normal_2P')
  const mcAxe=await new AxeBuilder({page}).include('[data-mc-variable="mc-linked"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()
  assert.deepEqual(mcAxe.violations.filter(v=>['critical','serious'].includes(v.impact)),[])
  await page.screenshot({path:join(output,'monte-carlo-live-sources.png'),fullPage:true})
  await page.getByRole('button',{name:'Generate data into table',exact:true}).click()
  await expect.poll(()=>page.evaluate(()=>!!window.adoptionTest.project.getProjectState().modules.lifeData.folios[1].spec.mcRunProvenance),{timeout:90000}).toBe(true)
  assert.deepEqual(requests.find(r=>r.kind==='mc-equation').body.variables[0].params,adopted.parameters)
  assert.equal(await page.evaluate(()=>window.adoptionTest.project.getProjectState().modules.lifeData.folios[1].rows.length),20)
  checks.push('Monte Carlo variable uses a live adopted model with exact parameters, records its source snapshot, and generates real seeded samples')
  await page.evaluate(()=>{
    const {project}=window.adoptionTest,state=project.getProjectState().modules.lifeData
    window.previousMcRows=state.folios[1].rows
    project.setModuleState('lifeData',{...state,folios:state.folios.map(f=>f.id==='b'?{...f,dataSource:'spec'}:f)})
  })
  holdNextMc=true
  await page.getByRole('button',{name:'Generate data into table',exact:true}).click()
  await expect.poll(()=>typeof releaseMc,{timeout:90000}).toBe('function')
  await page.evaluate(()=>{
    const {project}=window.adoptionTest,state=project.getProjectState().modules.lifeData
    project.setModuleState('lifeData',{...state,folios:state.folios.map(f=>f.id!=='a'?f:{...f,rows:f.rows.map((r,i)=>i?r:{...r,time:String(Number(r.time)+1)})})})
  })
  releaseMc()
  await expect(page.getByRole('button',{name:'Generate data into table',exact:true})).toBeEnabled()
  assert.equal(await page.evaluate(()=>window.previousMcRows===window.adoptionTest.project.getProjectState().modules.lifeData.folios[1].rows),true)
  await page.getByRole('button',{name:'Generate data into table',exact:true}).click()
  assert.equal(requests.filter(r=>r.kind==='mc-equation').length,2)
  checks.push('A source edit rejects pending Monte Carlo output and blocks stale generation without changing destination data')
  assert.deepEqual(errors,[])
  await writeFile(join(output,'report.json'),JSON.stringify({status:'passed',checks,browser:browser.version(),requests:requests.length},null,2))
  console.log(JSON.stringify({status:'passed',checks,output},null,2))
} catch(e) {
  await page?.screenshot({path:join(output,'failure.png'),fullPage:true}).catch(()=>{})
  await writeFile(join(output,'report.json'),JSON.stringify({status:'failed',error:String(e),errors,checks,requests,body:await page?.locator('body').innerText().catch(()=>null)},null,2))
  throw e
} finally { releaseSsi?.();releaseMc?.();await browser?.close();await closeViteTestServer(vite,cache) }
