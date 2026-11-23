/** Production inference controls with results from the real Python handlers. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'
import { closeViteTestServer } from './viteTestLifecycle.mjs'

const root = new URL('..', import.meta.url).pathname, repo = resolve(root, '../..')
const outputOption = process.argv.indexOf('--output-dir')
const output = resolve(outputOption < 0 ? join(tmpdir(), 'perdura-inference-browser') : process.argv[outputOption + 1])
await mkdir(output, { recursive: true })
const cache = await mkdtemp(join(tmpdir(), 'perdura-inference-vite-'))
const entry = '/__inference.tsx'
const fixture = `
import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import '/src/index.css'
import {AggregateMTBF,ProportionInterval,NormalSummary,DiscreteProbability,ExecutedSequential} from '/src/components/ALT/InferenceTools'
import GrowthPlanning,{INITIAL_GROWTH_PLANNING_STATE} from '/src/components/Growth/GrowthPlanning'
import {KeyboardShortcutProvider} from '/src/components/shared/KeyboardShortcuts'
import {ReportAssetScopeProvider} from '/src/components/shared/ReportAssetScope'
import * as project from '/src/store/project'
await project.hydrateProjectStorage()
project.newProject('Inference browser fixture')
window.inferenceTest={project}
function Fixture(){
 const [view,setView]=useState('MTBF'),[growth,setGrowth]=useState(INITIAL_GROWTH_PLANNING_STATE)
 window.inferenceTest.growth=growth
 const views={MTBF:AggregateMTBF,Proportion:ProportionInterval,Normal:NormalSummary,Discrete:DiscreteProbability,Sequential:ExecutedSequential}
 const View=views[view]
 return <KeyboardShortcutProvider><ReportAssetScopeProvider value={{module:'alt',moduleLabel:'Inference'}}><div className="perdura-theme flex h-screen flex-col"><nav>{[...Object.keys(views),'Growth'].map(v=><button key={v} onClick={()=>setView(v)}>{v} view</button>)}</nav>{View?<View/>:<GrowthPlanning state={growth} setState={setGrowth} units="hours"/>}</div></ReportAssetScopeProvider></KeyboardShortcutProvider>
}
createRoot(document.getElementById('root')).render(<Fixture/>)
`
const vite = await createServer({ root, cacheDir: cache, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [{
  name: 'inference-fixture', resolveId(id) { if (id === entry) return id }, load(id) { if (id === entry) return fixture },
  configureServer(server) {
    server.middlewares.use('/__inference', async (req, res, next) => {
      if (req.url !== '/' && req.url !== '') return next()
      res.setHeader('Content-Type', 'text/html')
      res.end(await server.transformIndexHtml('/__inference', `<!doctype html><html lang="en"><head><title>Lifecycle assurance</title></head><body><main id="root"></main><script type="module" src="${entry}"></script></body></html>`))
    })
  },
}] })
const python = process.env.PERDURA_PYTHON ?? resolve(repo, '.venv/bin/python')
const child = spawn(python, ['-u', '-c', `
import json,sys
from routers import inference_tools as t
routes={'mtbf-interval':(t.MTBFRequest,t.aggregate_mtbf),'binomial-interval':(t.BinomialRequest,t.proportion_interval),'normal-mean-interval':(t.NormalRequest,t.normal_summary),'discrete-probability':(t.DiscreteRequest,t.probability_explorer),'bernoulli-sprt':(t.BernoulliRequest,t.sequential_bernoulli),'exponential-sprt':(t.ExponentialRequest,t.sequential_exponential),'growth-plan':(t.GrowthPlanRequest,t.growth_phases)}
print(json.dumps({'ready':True}))
for line in sys.stdin:
    p=json.loads(line)
    try:
        model,handler=routes[p['kind']]
        out=handler(model(**p['body']))
        print(json.dumps({'id':p['id'],'result':out},allow_nan=False))
    except Exception as error:
        print(json.dumps({'id':p['id'],'error':str(error)}))
`], { cwd: repo, env: { ...process.env, PYTHONPATH: join(repo, 'src') + ':' + join(repo, 'gui/backend'), MPLCONFIGDIR: join(tmpdir(), 'perdura-inference-mpl') },
  stdio: ['pipe', 'pipe', 'pipe'] })
let readyResolve, readyReject, sequence = 0, pythonErrors = ''
const ready = new Promise((resolveReady, rejectReady) => { readyResolve = resolveReady; readyReject = rejectReady })
const startupTimer = setTimeout(() => { readyReject(new Error('Python handler startup timed out')); child.kill() }, 90000)
const pending = new Map()
child.stderr.on('data', data => { pythonErrors = (pythonErrors + data).slice(-10000) })
child.on('error', error => { clearTimeout(startupTimer); readyReject(error) })
child.on('exit', code => {
  clearTimeout(startupTimer)
  const error = new Error(`Python handler exited (${code}): ${pythonErrors}`)
  readyReject(error)
  for (const item of pending.values()) item.reject(error)
})
createInterface({ input: child.stdout }).on('line', line => {
  let message
  try { message = JSON.parse(line) } catch { return }
  if (message.ready) { clearTimeout(startupTimer); readyResolve(); return }
  const item = pending.get(message.id)
  if (!item) return
  pending.delete(message.id); clearTimeout(item.timer)
  if (message.error) item.reject(new Error(message.error))
  else item.resolve(message.result)
})
const calculate = (kind, body) => new Promise((resolveCalculation, reject) => {
  const id = ++sequence
  const timer = setTimeout(() => { pending.delete(id); reject(new Error('Python calculation timed out')) }, 90000)
  pending.set(id, { resolve: resolveCalculation, reject, timer })
  child.stdin.write(JSON.stringify({ id, kind, body }) + '\n')
})
let browser,page
const checks=[],errors=[],requests=[]
try {
 await ready;await vite.listen();browser=await chromium.launch({headless:true})
 page=await browser.newPage({viewport:{width:1600,height:1100},reducedMotion:'reduce'});page.setDefaultTimeout(30000)
 page.on('pageerror',e=>errors.push(e.message))
 await page.route(url=>url.pathname.startsWith('/api/'),async route=>{
  const kind=new URL(route.request().url()).pathname.split('/').at(-1),body=route.request().postDataJSON();requests.push({kind,body})
  try { const result=await calculate(kind,body);await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)}) }
  catch(error){await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({detail:String(error)})})}
 })
 await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__inference`,{waitUntil:'domcontentloaded',timeout:90000})
 const result=key=>page.evaluate(key=>window.inferenceTest.project.getProjectState().modules.reliabilityTestingTools?.[key]?.result,key)
 const view=name=>page.getByRole('button',{name:`${name} view`,exact:true}).click()
 const run=label=>page.getByRole('button',{name:label,exact:true}).click({timeout:90000})
 await run('Calculate MTBF interval');await expect.poll(async()=>Boolean(await result('aggregateMTBF'))).toBe(true)
 assert.ok(Math.abs((await result('aggregateMTBF')).mtbf_lower-127.068968)<1e-5)
 await page.getByLabel('Stopping design',{exact:true}).selectOption('failure');assert.equal(await result('aggregateMTBF'),null)
 await run('Calculate MTBF interval');await expect.poll(async()=>(await result('aggregateMTBF'))?.termination).toBe('failure')
 assert.ok((await result('aggregateMTBF')).mtbf_lower>168)
 checks.push('Stopping-rule change clears result and changes MTBF interval correctly')
 await view('Proportion');await page.getByLabel('Confidence statement',{exact:true}).selectOption('lower')
 await run('Calculate proportion interval');await expect.poll(async()=>Boolean(await result('oneProportion'))).toBe(true)
 assert.ok(Math.abs((await result('oneProportion')).lower-.8608916593)<1e-8)
 await view('MTBF');await expect(page.getByLabel('Stopping design',{exact:true})).toHaveValue('failure');assert.ok((await result('aggregateMTBF')).mtbf_lower>168)
 checks.push('Exact one-sided binomial result and unmount/remount persistence')
 await view('Normal');await run('Calculate mean interval');await expect.poll(async()=>Boolean(await result('normalSummary'))).toBe(true)
 assert.equal((await result('normalSummary')).method,'student_t_unknown_sigma')
 await view('Discrete');await page.getByLabel('Sampling model',{exact:true}).selectOption('hypergeometric');await run('Calculate probabilities')
 await expect.poll(async()=>Boolean(await result('discreteProbability'))).toBe(true);assert.ok((await result('discreteProbability')).probability>0)
 checks.push('Normal summary and finite-lot PMF/CDF/OC use real Python results')
 await view('Sequential');await page.getByRole('textbox',{name:'Ordered inspection outcomes',exact:true}).fill('1,1,0,0');await run('Analyze sequential test')
 await expect.poll(async()=>(await result('sequentialSampling'))?.decision).toBe('reject');assert.equal((await result('sequentialSampling')).ignored_observations,2)
 await page.getByLabel('Sequential model',{exact:true}).selectOption('exponential');await page.getByLabel('Observed exposure (hours)',{exact:true}).fill('3000');await run('Analyze sequential test')
 await expect.poll(async()=>(await result('sequentialSampling'))?.decision,{timeout:90000}).toBe('accept');assert.ok((await result('sequentialSampling')).stopping_time<3000)
 await page.screenshot({path:join(output,'sequential-exposure.png'),fullPage:true});checks.push('First crossing and event-free exponential acceptance with seeded OC')
 await view('Growth');await page.getByLabel('Baseline MTBF definition',{exact:true}).selectOption('initial_phase_average')
 const inputs=page.locator('aside input[type=number]');for(const [i,value] of ['1000','50','110','.23'].entries())await inputs.nth(i).fill(value)
 await page.getByRole('textbox',{name:'Subsequent phase durations',exact:true}).fill('1500,2500,2000,3000');await run('Build plan')
 await expect.poll(()=>page.evaluate(()=>Boolean(window.inferenceTest.growth.result))).toBe(true)
 const growth=await page.evaluate(()=>window.inferenceTest.growth.result)
 assert.ok(Math.abs(growth.trajectory.planned_end_mtbf-110.27556185)<1e-6)
 assert.ok(Math.abs(growth.phase_table.at(-1).cumulative_expected_failures-117.76873107)<1e-6)
 await page.screenshot({path:join(output,'growth-phases.png'),fullPage:true});checks.push('Initial-phase average conversion and integrated counts')
 assert.deepEqual(errors,[]);await writeFile(join(output,'report.json'),JSON.stringify({status:'passed',checks,requests:requests.length,browser:browser.version()},null,2));console.log(JSON.stringify({status:'passed',checks,output},null,2))
} catch(error) {
 await page?.screenshot({path:join(output,'failure.png'),fullPage:true}).catch(()=>{})
 await writeFile(join(output,'report.json'),JSON.stringify({status:'failed',error:String(error),errors,checks,requests,body:await page?.locator('body').innerText().catch(()=>null)},null,2));throw error
} finally { child.stdin.end();child.kill();await browser?.close();await closeViteTestServer(vite,cache) }
