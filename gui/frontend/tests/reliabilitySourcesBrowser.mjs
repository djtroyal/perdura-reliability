/** Real consumer editors/store and Python numerical routers, with delayed HTTP responses. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { closeViteTestServer } from './viteTestLifecycle.mjs'

const root = new URL('..', import.meta.url).pathname, repo = resolve(root, '../..')
const arg = process.argv.indexOf('--output-dir')
const output = resolve(arg < 0 ? join(tmpdir(), 'perdura-live-consumers-browser') : process.argv[arg + 1])
await mkdir(output, { recursive: true })
const cache = await mkdtemp(join(tmpdir(), 'perdura-live-consumers-vite-'))
const entry = '/__live-consumers.tsx'
const fixture = `
import React from 'react'
import {createRoot} from 'react-dom/client'
import '/src/index.css'
import {FaultTreeEditor} from '/src/components/FaultTree'
import RBD from '/src/components/SystemReliability'
import Markov from '/src/components/Markov'
import Replacement from '/src/components/Maintenance/ReplacementPolicy'
import PM from '/src/components/Maintenance/PMInterval'
import Cost from '/src/components/Maintenance/CostForecast'
import {KeyboardShortcutProvider} from '/src/components/shared/KeyboardShortcuts'
import {ReportAssetScopeProvider} from '/src/components/shared/ReportAssetScope'
import * as project from '/src/store/project'
import {adoptDistribution,createFitProvenance} from '/src/components/shared/adoptedDistribution'
const kind=new URL(location.href).searchParams.get('module')||'fta'
const moduleKey={fta:'faultTree',rbd:'system',markov:'markov',replacement:'maintReplacement',pm:'maintPMInterval',cost:'maintCostForecast'}[kind]
await project.hydrateProjectStorage()
project.newProject('Live source browser '+kind)
// Deliberately specified (not fabricated fit) models give independent exact expectations.
function source(value=10,unit='days',shifted=false) {
 const distribution=kind==='markov'?(shifted?'Exponential_2P':'Exponential_1P'):(shifted?'Weibull_3P':'Weibull_2P')
 const params=kind==='markov'?{Lambda:value/1000,...(shifted?{gamma:1}:{})}:{eta:value,beta:2,...(shifted?{gamma:1}:{})}
 const folio={id:'life',name:'Adopted lifetime dataset',analysisMode:'parametric',dataSource:'spec',quantity:{kind:'time',unit},
  spec:{distribution,params:Object.fromEntries(Object.entries(params).map(([k,v])=>[k,String(v)]))},specResult:{distribution,params}}
 folio.fitProvenance=createFitProvenance(folio)
 folio.adoptedDistribution=adoptDistribution(folio,distribution)
 return folio
}
const updateSource=(value=10,unit='days',shifted=false)=>project.setModuleState('lifeData',{folios:[source(value,unit,shifted)],activeId:'life'})
updateSource()
const linked={label:'Live linked component',distributionSource:{module:'lifeData',analysisId:'life'},
 ldaFolioId:'life',ldaSource:'life',distribution:'weibull',dist_params:{alpha:99999,beta:9},probability:.999,reliability:.999}
const fta={nodes:[{id:'g',type:'or',position:{x:180,y:10},data:{label:'Top event'}},
 {id:'live',type:'basic',position:{x:180,y:220},data:{...linked,eventKey:'live'}}],
 edges:[{id:'e',source:'g',target:'live',data:{role:'input',order:0}}],annotations:[],
 exposureTime:'100',engine:'exact',confidenceLevel:'95',nSimulations:'20000',density:'comfortable'}
const rbd={nodes:[{id:'source',type:'source',position:{x:10,y:100},data:{label:'Source'}},
 {id:'live',type:'component',position:{x:240,y:100},data:linked},
 {id:'sink',type:'sink',position:{x:520,y:100},data:{label:'Sink'}}],
 edges:[{id:'a',source:'source',target:'live'},{id:'b',source:'live',target:'sink'}],annotations:[],missionTime:'100',density:'comfortable'}
const markov={states:[{id:'up',name:'Operating',state_type:'operational'}, {id:'down',name:'Failed',state_type:'failed'}],
 transitions:[{id:'failure',from_state:'up',to_state:'down',rate:999,label:'lambda',sourceId:'life'},
 {id:'repair',from_state:'down',to_state:'up',rate:.001,label:'mu'}],
 positions:{up:{x:60,y:100},down:{x:440,y:100}},initialState:'up',tMax:100,nPoints:11,
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
window.consumerTest={project,kind,moduleKey,updateSource,snapshot}
function App(){const [units,setUnits]=project.useUnits();window.consumerTest.setUnits=setUnits
 return <KeyboardShortcutProvider><ReportAssetScopeProvider value={{module:moduleKey,moduleLabel:kind}}>
 <div className="perdura-theme flex h-screen min-h-0 flex-col">{kind==='fta'?<FaultTreeEditor/>:kind==='rbd'?<RBD/>:
 kind==='markov'?<Markov/>:kind==='replacement'?<Replacement/>:kind==='pm'?<PM/>:<Cost/>}</div>
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
from routers import fault_tree,system_reliability,markov,maintenance
from schemas import FaultTreeRequest,RBDRequest,MarkovRequest
p=json.load(sys.stdin); kind=p['kind']; body=p['body']
if kind=='fta': out=fault_tree.analyze_fault_tree(FaultTreeRequest(**body))
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
const config = {
  fta: { path: '/fault-tree/analyze/stream', button: 'Analyze Fault Tree' },
  rbd: { path: '/system/rbd', button: 'Analyze RBD' },
  markov: { path: '/markov/analyze', button: 'Analyze Markov Model' },
  replacement: { path: '/maintenance/replacement-policy', button: 'Compare policies' },
  pm: { path: '/maintenance/pm-interval', button: 'Compute interval' },
  cost: { path: '/maintenance/cost-forecast', button: 'Forecast cost' },
}
const modulesOption=process.argv.indexOf('--modules')
const modules=modulesOption<0?Object.keys(config):process.argv[modulesOption+1].split(',')
assert.ok(modules.length && modules.every(kind=>kind in config),'--modules must name supported consumer tools')
let browser, page, holdNext = false, release
const checks = [], errors = [], requests = [], accessibility = []
let currentKind = ''
const currentRequests = () => requests.filter(item => item.kind === currentKind)
const snapshot = () => page.evaluate(() => window.consumerTest.snapshot())
async function frames() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))) }
async function run() {
  const count = currentRequests().length
  await page.getByRole('button', { name: config[currentKind].button, exact: true }).click()
  await expect.poll(() => currentRequests().length, { timeout: 90000 }).toBe(count + 1)
  return currentRequests().at(-1)
}
async function finished() {
  await expect(page.getByRole('button', { name: config[currentKind].button, exact: true })).toBeEnabled({ timeout: 90000 })
  await expect.poll(async () => Boolean((await snapshot())?.result), { timeout: 20000 }).toBe(true)
  await frames()
}
function checkParameters(kind, body, value, scale) {
  if (kind === 'markov') assert.equal(body.transitions.find(t => t.id === 'failure').rate, value / 1000 / scale)
  else if (['fta', 'rbd'].includes(kind)) {
    const node = body.nodes.find(n => n.id === 'live')
    assert.equal(node.data.distribution, 'weibull')
    assert.equal(node.data.dist_params.alpha, value * scale)
    assert.equal(node.data.dist_params.beta, 2)
  } else if (kind === 'pm') {
    assert.equal(body.dist, 'weibull'); assert.equal(body.dist_params.alpha, value * scale); assert.equal(body.dist_params.beta, 2)
  } else { assert.equal(body.weibull_alpha, value * scale); assert.equal(body.weibull_beta, 2) }
}
async function selectSourcePanel(kind) {
  if (['fta', 'rbd'].includes(kind)) await page.locator('.react-flow__node[data-id="live"]').click()
  else if (kind === 'markov') {
    // Edges have narrow SVG geometry; click the actual accessible ReactFlow edge.
    await page.locator('.react-flow__edge[data-id="failure"]').dispatchEvent('click')
  }
  const name = kind === 'fta' ? 'Linked source (Life Data / Prediction)' : kind === 'rbd' ? 'Reliability source'
    : kind === 'markov' ? 'Rate source' : kind === 'pm' ? 'Failure distribution' : 'Weibull source'
  const select = page.getByRole('combobox', { name, exact: true })
  await expect(select).toBeVisible()
  await select.evaluate(element => {
    document.querySelectorAll('[data-live-source-panel]').forEach(item => item.removeAttribute('data-live-source-panel'))
    const label = element.closest('label')
    ;(label?.parentElement ?? element.parentElement).setAttribute('data-live-source-panel', '')
  })
  return select
}
async function checkCanvasPreview(kind, scale) {
  if (!['fta','rbd'].includes(kind)) return
  const reliability=Math.exp(-Math.pow(100/scale,2))
  await expect(page.locator('.react-flow__node[data-id="live"]')).toContainText(kind==='fta'
    ? (1-reliability).toExponential(3) : 'R = '+reliability.toFixed(6))
}
try {
  await vite.listen(); browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1600, height: 1050 }, reducedMotion: 'reduce' })
  page = await context.newPage(); page.setDefaultTimeout(20000)
  page.on('pageerror', error => errors.push({ kind: currentKind, message: error.message }))
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const path = new URL(route.request().url()).pathname
    const kind = Object.entries(config).find(([, value]) => path.endsWith(value.path))?.[0]
    if (!kind) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(path.endsWith('/examples') ? {} : {
      valid: true, issues: [], analysis_kind: 'static_coherent', root_id: 'g', event_count: 1,
      summary: { states: 2, transitions: 2, up_states: 1, failed_states: 1, initial_state: 'up', nodes: 3, components: 1, connections: 2 },
    }) })
    const body = route.request().postDataJSON()
    requests.push({ kind, body })
    try {
      const result = calculate(kind, body)
      if (holdNext) { holdNext = false; await new Promise(resolve => { release = resolve }) }
      await route.fulfill({ status: 200, contentType: kind === 'fta' ? 'application/x-ndjson' : 'application/json',
        body: kind === 'fta' ? JSON.stringify({ type: 'result', data: result }) + '\n' : JSON.stringify(result) })
    } catch (error) {
      errors.push({ kind, message: String(error) })
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: String(error) }) }).catch(() => {})
    }
  })
  for (const kind of modules) {
    currentKind = kind
    await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__live-consumers?module=${kind}`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: config[kind].button, exact: true }).waitFor({ timeout: 90000 })
    const select = await selectSourcePanel(kind)
    await expect(select).toHaveValue('life')
    await checkCanvasPreview(kind,240)
    const axe = await new AxeBuilder({ page }).include('[data-live-source-panel]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    accessibility.push({ kind, violations: axe.violations })
    assert.deepEqual(axe.violations.filter(v => ['critical', 'serious'].includes(v.impact)).map(v => ({ id: v.id, nodes: v.nodes })), [], kind + ' linked-source panel accessibility')
    await page.screenshot({ path: join(output, kind + '-linked-source.png'), fullPage: true })
    const first = await run(); checkParameters(kind, first.body, 10, 24)
    await finished()
    let state = await snapshot()
    assert.equal(state.result._sourceSnapshots[0].parameters[kind === 'markov' ? 'Lambda' : 'eta'], kind === 'markov' ? .01 : 10)
    assert.deepEqual(state.result._sourceSnapshots[0].quantity, { kind: 'time', unit: 'days' })
    assert.equal(state.sourceStale, false, kind + ' completed output must be current')
    await page.evaluate(() => { window.savedConsumerResult = window.consumerTest.snapshot().result; window.consumerTest.updateSource(20) })
    await expect.poll(async () => (await snapshot()).sourceStale).toBe(true)
    await checkCanvasPreview(kind,480)
    holdNext = true; release = undefined
    const pending = await run(); checkParameters(kind, pending.body, 20, 24)
    await expect.poll(() => typeof release, { timeout: 90000 }).toBe('function')
    await page.evaluate(() => window.consumerTest.updateSource(30))
    release(); release = undefined
    await finished()
    assert.equal(await page.evaluate(() => window.savedConsumerResult === window.consumerTest.snapshot().result), true, kind + ' delayed output must preserve historical result identity')
    await expect.poll(async () => (await snapshot()).sourceStale).toBe(true)
    // Both source quantity and evaluation unit change; physical scale is hours → minutes.
    await page.evaluate(() => { window.consumerTest.updateSource(30, 'hours'); window.consumerTest.setUnits('minutes') })
    const converted = await run(); checkParameters(kind, converted.body, 30, 60)
    await finished()
    state = await snapshot()
    assert.equal(state.sourceStale, false, kind + ' new-unit calculation must be current')
    assert.deepEqual(state.result._sourceSnapshots[0].quantity, { kind: 'time', unit: 'hours' })
    assert.deepEqual(state.result._sourceSnapshots[0].evaluationQuantity, { kind: 'time', unit: 'minutes' })
    checks.push(kind + ': exact live parameters, physical unit conversion, source snapshots, pending response rejection and current recovery')

    if (['rbd', 'markov'].includes(kind)) {
      holdNext = true; release = undefined
      await run()
      await expect.poll(() => typeof release, { timeout: 90000 }).toBe('function')
      await page.evaluate(() => {
        const {project,moduleKey}=window.consumerTest
        window.savedConsumerResult=project.readFolioState(moduleKey,'consumer').result
        window.savedConsumerInputs=project.analysisInputSnapshot(project.readFolioState(moduleKey,'consumer'),moduleKey)
      })
      await page.locator('[data-tab-id="alternate"]').click()
      await expect(page.locator('[data-tab-id="alternate"]')).toHaveAttribute('aria-pressed','true')
      await frames()
      await page.evaluate(() => {
        const {project,moduleKey}=window.consumerTest
        project.flushProjectEditors()
        window.savedAlternateInputs=project.analysisInputSnapshot(project.readFolioState(moduleKey,'alternate'),moduleKey)
      })
      release(); release = undefined
      await expect(page.getByRole('button', { name: config[kind].button, exact: true })).toBeEnabled({ timeout: 90000 })
      await frames()
      const preserved=await page.evaluate(() => {
        const {project,moduleKey}=window.consumerTest
        project.flushProjectEditors()
        return {originResult:window.savedConsumerResult===project.readFolioState(moduleKey,'consumer').result,
          originInputs:JSON.stringify(window.savedConsumerInputs)===JSON.stringify(project.analysisInputSnapshot(project.readFolioState(moduleKey,'consumer'),moduleKey)),
          alternateInputs:JSON.stringify(window.savedAlternateInputs)===JSON.stringify(project.analysisInputSnapshot(project.readFolioState(moduleKey,'alternate'),moduleKey)),
          alternateResult:project.readFolioState(moduleKey,'alternate').result??null}
      })
      assert.deepEqual(preserved,{originResult:true,originInputs:true,alternateInputs:true,alternateResult:null},kind+' switch must not copy destination inputs into the origin or attach a late result')
      await page.locator('[data-tab-id="consumer"]').click()
      await expect(page.locator('[data-tab-id="consumer"]')).toHaveAttribute('aria-pressed','true')
      checks.push(kind + ': switching analyses during calculation preserves both documents and rejects the late result')
    }

    if (['markov', 'replacement', 'cost'].includes(kind)) {
      await page.evaluate(() => window.consumerTest.updateSource(30, 'hours', true))
      await selectSourcePanel(kind)
      await expect(page.getByRole('alert').filter({ hasText: /zero location|unavailable|incompatible/i }).first()).toBeVisible()
      const count = currentRequests().length
      await page.getByRole('button', { name: config[kind].button, exact: true }).click(); await frames()
      assert.equal(currentRequests().length, count, kind + ' shifted models must be rejected before HTTP')
      checks.push(kind + ': unsupported shifted model fails closed')
    }
    await page.evaluate(() => { window.savedConsumerResult = window.consumerTest.snapshot().result; window.consumerTest.project.setModuleState('lifeData', { folios: [], activeId: '' }) })
    const unavailableSelect=await selectSourcePanel(kind)
    await expect(unavailableSelect).toHaveValue('life')
    await expect(unavailableSelect.locator('option:checked')).toContainText('Unavailable')
    await expect(page.getByRole('alert').filter({ hasText: /missing|unavailable|compatible/i }).first()).toBeVisible()
    if (kind === 'fta') await expect(page.getByText('Computed probability @', { exact: false }).locator('..')).toContainText('—')
    if (kind === 'rbd') await expect(page.getByText('R(t) =', { exact: false })).toHaveText('R(t) = —')
    if (['fta','rbd'].includes(kind)) await expect(page.locator('.react-flow__node[data-id="live"]')).toContainText('Source unavailable')
    const count = currentRequests().length
    await page.getByRole('button', { name: config[kind].button, exact: true }).click(); await frames()
    assert.equal(currentRequests().length, count, kind + ' deleted source must not calculate from cached values')
    assert.equal(await page.evaluate(() => window.savedConsumerResult === window.consumerTest.snapshot().result), true)
    await expect.poll(async () => (await snapshot()).sourceStale).toBe(true)
    const unavailableAxe=await new AxeBuilder({page}).include('[data-live-source-panel]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()
    accessibility.push({kind,state:'unavailable',violations:unavailableAxe.violations})
    assert.deepEqual(unavailableAxe.violations.filter(v=>['critical','serious'].includes(v.impact)).map(v=>({id:v.id,nodes:v.nodes})),[],kind+' unavailable-source panel accessibility')
    await page.screenshot({ path: join(output, kind + '-unavailable-source.png'), fullPage: true })
    checks.push(kind + ': removed source remains explicit, calculation blocked and historical output retained')
    console.log('PASS', kind, currentRequests().length, 'actual numerical requests')
  }
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, accessibility, browser: browser.version(), requests }, null, 2))
  console.log(JSON.stringify({ status: 'passed', checks, output }, null, 2))
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  await writeFile(join(output, 'report.json'), JSON.stringify({ status: 'failed', kind: currentKind, error: String(error), errors, checks, accessibility, requests,
    body: await page?.locator('body').innerText().catch(() => null), state: page ? await snapshot().catch(() => null) : null }, null, 2))
  throw error
} finally { release?.(); await browser?.close(); await closeViteTestServer(vite, cache) }
