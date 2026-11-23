/** Production LDA workflow; every numerical response comes from the Python router. */
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
const output = resolve(outputOption < 0 ? join(tmpdir(), 'perdura-standard-life-browser') : process.argv[outputOption + 1])
await mkdir(output, { recursive: true })
const cache = await mkdtemp(join(tmpdir(), 'perdura-standard-life-vite-'))
const entry = '/__standard-life.tsx'
const fixture = `
import React from 'react'
import {createRoot} from 'react-dom/client'
import '/src/index.css'
import LifeData from '/src/components/LifeData'
import {KeyboardShortcutProvider} from '/src/components/shared/KeyboardShortcuts'
import {ReportAssetScopeProvider} from '/src/components/shared/ReportAssetScope'
import * as project from '/src/store/project'
import * as model from '/src/components/shared/adoptedDistribution'
import demo from '/src/data/demoProject.json'
await project.hydrateProjectStorage()
project.newProject('Standard lifetime methods browser fixture')
const base=demo.modules.lifeData.folios[0]
const make=(id,name,values)=>({...base,id,name,analysisMode:'parametric',dataSource:'table',dataFormat:'individual',
  selectedDists:['Exponential_1P'],method:'MLE',rankMethod:'benard',ci:.95,ciText:'.95',
  setDist:null,adoptedDistribution:null,result:null,fitProvenance:null,
  quantity:{kind:'time',unit:'hours'},
  rows:values.map((v,i)=>({key:id+i,id:'',time:String(v),state:'F'}))})
const ranks={...make('ranks','Rank methods',[11,17,29,43,61,87,122,170]),selectedDists:['Weibull_2P']}
const mixed={...make('mixed','Mixed observations',[]),dataFormat:'interval',intervalRows:[
  {key:'m1',id:'',kind:'interval',lower:'2.5',upper:'4',count:'3'},
  {key:'m2',id:'',kind:'interval',lower:'',upper:'3',count:'2'},
  {key:'m3',id:'',kind:'interval',lower:'8',upper:'',count:'4'},
  {key:'m4',id:'',kind:'interval',lower:'4',upper:'7',count:'2'},
]}
project.setModuleState('lifeData',{folios:[ranks,mixed,make('precision','Small failure rate',[1e6,2e6,3e6,4e6])],
  activeId:'ranks',folioSeq:3,compare:{folioIds:[],commonDistribution:'',ci:.95,ciText:'.95'}})
window.standardLifeTest={project,model}
createRoot(document.getElementById('root')).render(<KeyboardShortcutProvider><ReportAssetScopeProvider value={{module:'lifeData',moduleLabel:'Life Data'}}>
<div className="perdura-theme flex h-screen flex-col"><LifeData/></div></ReportAssetScopeProvider></KeyboardShortcutProvider>)
`
const vite = await createServer({ root, cacheDir: cache, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [{
  name: 'standard-life-fixture', resolveId(id) { if (id === entry) return id }, load(id) { if (id === entry) return fixture },
  configureServer(server) {
    server.middlewares.use('/__standard-life', async (req, res, next) => {
      if (req.url !== '/' && req.url !== '') return next()
      res.setHeader('Content-Type', 'text/html')
      res.end(await server.transformIndexHtml('/__standard-life', `<!doctype html><html lang="en"><head><title>Standard life methods assurance</title></head><body><main id="root"></main><script type="module" src="${entry}"></script></body></html>`))
    })
  },
}] })
const python = process.env.PERDURA_PYTHON ?? resolve(repo, '.venv/bin/python')
const child = spawn(python, ['-u', '-c', `
import json,sys
from routers import life_data
from schemas import LifeDataFitRequest,SingleDistPlotRequest,GroupedLifeFitRequest,GroupedLifePlotRequest,SpecCurvesRequest,CalculatorRequest
print(json.dumps({'ready':True}))
for line in sys.stdin:
    p=json.loads(line)
    kind=p['kind'];body=p['body']
    try:
        if kind=='fit': out=life_data._run_fit(LifeDataFitRequest(**body))
        elif kind=='grouped-fit': out=life_data.fit_grouped_distributions(GroupedLifeFitRequest(**body))
        elif kind=='plot': out=life_data.single_distribution_plot(SingleDistPlotRequest(**body))
        elif kind=='grouped-plot': out=life_data.grouped_distribution_plot(GroupedLifePlotRequest(**body))
        elif kind=='spec-curves': out=life_data.spec_curves(SpecCurvesRequest(**body))
        elif kind=='calculate': out=life_data.calculate_metrics(CalculatorRequest(**body))
        else: raise ValueError(kind)
        print(json.dumps({'id':p['id'],'result':out},allow_nan=False))
    except Exception as error:
        print(json.dumps({'id':p['id'],'error':str(error)}))
`], { cwd: repo, env: { ...process.env, PYTHONPATH: join(repo, 'src') + ':' + join(repo, 'gui/backend'), MPLCONFIGDIR: join(tmpdir(), 'perdura-standard-life-mpl') },
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
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error) }
  pending.clear()
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
let browser, context, page, failed = false
const checks = [], errors = [], requests = []
async function runCalculation(button, path) {
  // Register before clicking so even a cached/fast handler cannot race the wait.
  // A handler error should report its body, not turn into a missing-label timeout.
  const [response] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname.endsWith(path)
      && response.request().method() === 'POST', { timeout: 90000 }),
    button.click(),
  ])
  assert.ok(response.ok(), `${path}: HTTP ${response.status()} ${await response.text()}`)
}
async function expectDisplayedMetric(metric, expected, expectedContext) {
  const row = page.locator(`[data-result-metric="${metric}"]`)
  await expect(row).toBeVisible()
  for (const text of expectedContext) await expect(row).toContainText(text)
  const displayed = Number((await row.locator('[data-result-value]').innerText()).replaceAll(',', ''))
  assert.ok(Number.isFinite(displayed) && Math.abs(displayed - expected) <= Math.abs(expected) * 5e-4,
    `${metric}: displayed ${displayed}, expected ${expected} within four-significant-digit display precision`)
}
try {
  await ready
  await vite.listen()
  browser = await chromium.launch({ headless: true })
  context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, reducedMotion: 'reduce' })
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
  page = await context.newPage()
  page.setDefaultTimeout(30000)
  page.on('pageerror', error => errors.push(error.message))
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const path = new URL(route.request().url()).pathname
    const kind = path.endsWith('/fit/stream') ? 'fit' : path.split('/').at(-1)
    const body = route.request().postDataJSON(), request = { kind, body, startedAt: Date.now() }
    requests.push(request)
    try {
      const result = await calculate(kind, body)
      request.result = result
      request.durationMs = Date.now() - request.startedAt
      await route.fulfill({ status: 200, contentType: path.endsWith('/stream') ? 'application/x-ndjson' : 'application/json',
        body: path.endsWith('/stream') ? JSON.stringify({ type: 'result', data: result }) + '\n' : JSON.stringify(result) })
    } catch (error) {
      request.error = String(error)
      request.durationMs = Date.now() - request.startedAt
      errors.push(String(error))
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: String(error) }) })
    }
  })
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__standard-life`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  const run = page.getByRole('button', { name: 'Run Analysis', exact: true })
  await run.waitFor({ timeout: 90000 })
  const folio = id => page.evaluate(id => window.standardLifeTest.project.getProjectState().modules.lifeData.folios.find(f => f.id === id), id)
  const fitted = async id => expect.poll(async () => !!(await folio(id)).result, { timeout: 90000 }).toBe(true)
  const rank = page.getByRole('combobox', { name: 'Plotting positions', exact: true })
  await rank.selectOption('hazen')
  await page.getByRole('button', { name: 'RRY', exact: true }).click()
  await runCalculation(run, '/fit/stream')
  await fitted('ranks')
  const rankFit = requests.find(request => request.kind === 'fit')
  assert.equal(rankFit.body.rank_method, 'hazen')
  assert.equal(rankFit.body.method, 'RRY')
  assert.equal((await folio('ranks')).result.results[0].rank_method, 'hazen')
  await page.locator('[data-tab-id="mixed"]').click()
  await page.locator('[data-tab-id="ranks"]').click()
  await expect(rank).toHaveValue('hazen')
  checks.push('Selected Hazen plotting positions persist across folios and reach the real RRY fitter and result metadata')
  console.log(checks.at(-1))

  await page.locator('[data-tab-id="mixed"]').click()
  await page.getByRole('combobox', { name: 'Observation, row 1', exact: true }).selectOption('exact')
  await expect(page.getByRole('textbox', { name: 'Upper (hours), row 1', exact: true })).toBeDisabled()
  await expect(page.getByRole('textbox', { name: 'Upper (hours), row 1', exact: true })).toHaveValue('')
  await runCalculation(run, '/grouped-fit')
  await fitted('mixed')
  const mixedFit = requests.find(request => request.kind === 'grouped-fit')
  assert.equal(mixedFit.body.observation_model, 'mixed')
  const kinds = Object.fromEntries(mixedFit.body.mixed_observations.map(row => [row.kind, row]))
  assert.deepEqual(kinds.failure, { kind: 'failure', time: 2.5, count: 3 })
  assert.deepEqual(kinds.left_censored, { kind: 'left_censored', upper: 3, count: 2 })
  assert.deepEqual(kinds.right_censored, { kind: 'right_censored', time: 8, count: 4 })
  assert.deepEqual(kinds.interval_censored, { kind: 'interval_censored', lower: 4, upper: 7, count: 2 })
  assert.equal((await folio('mixed')).result.results[0].fit_eligible, true)
  await page.screenshot({ path: join(output, 'mixed-observations.png'), fullPage: true })
  checks.push('The production interval grid switches a row to an exact failure, clears its upper bound and fits all four weighted observation kinds together')
  console.log(checks.at(-1))

  await page.locator('[data-tab-id="precision"]').click()
  await runCalculation(run, '/fit/stream')
  await fitted('precision')
  const bar = page.getByRole('region', { name: 'Dataset distribution selection' })
  await bar.getByRole('button', { name: 'Set as dataset distribution' }).click()
  await expect(bar.getByRole('button', { name: 'Set as dataset distribution' })).toBeHidden()
  const adopted = (await folio('precision')).adoptedDistribution
  assert.equal(adopted.parameters.Lambda, 4e-7)
  assert.equal(JSON.parse(JSON.stringify(adopted)).parameters.Lambda, 4e-7)
  await page.getByRole('textbox', { name: 'Mission end (hours)', exact: true }).fill('3000000')
  await page.getByRole('textbox', { name: 'Elapsed (hours)', exact: true }).fill('2000000')
  await page.getByPlaceholder('0.9', { exact: true }).fill('0.9')
  const calculateButton = page.getByRole('button', { name: 'Calculate', exact: true })
  await runCalculation(calculateButton, '/calculate')
  const calculation = requests.find(request => request.kind === 'calculate')
  assert.equal(calculation.body.params.Lambda, 4e-7)
  const remaining = -Math.log(.9) / 4e-7
  assert.ok(Math.abs(calculation.result.remaining_life - remaining) < 1e-6)
  assert.ok(Math.abs(calculation.result.total_life_at_target - (2e6 + remaining)) < 1e-6)
  await expectDisplayedMetric('remaining_life', remaining, ['R=0.9', '(hours)'])
  await expectDisplayedMetric('total_life_at_target', 2e6 + remaining, ['(hours)'])
  await page.getByPlaceholder('0.9', { exact: true }).fill('0.5')
  await runCalculation(calculateButton, '/calculate')
  const secondRemaining = -Math.log(.5) / 4e-7
  await expectDisplayedMetric('remaining_life', secondRemaining, ['R=0.5', '(hours)'])
  await expectDisplayedMetric('total_life_at_target', 2e6 + secondRemaining, ['(hours)'])
  await page.screenshot({ path: join(output, 'precise-rate-remaining-life.png'), fullPage: true })
  checks.push('Adoption retains Lambda=4e-7 exactly; displayed remaining life and total age match independent arithmetic and update with the reliability target')
  console.log(checks.at(-1))
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, browser: browser.version(), requests: requests.length }, null, 2))
  console.log(JSON.stringify({ status: 'passed', checks, output }, null, 2))
} catch (error) {
  failed = true
  await page?.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  await writeFile(join(output, 'report.json'), JSON.stringify({ status: 'failed', error: String(error), errors, checks, requests,
    body: await page?.locator('body').innerText().catch(() => null) }, null, 2))
  throw error
} finally {
  child.stdin.end()
  child.kill()
  await context?.tracing.stop(failed ? { path: join(output, 'trace.zip') } : {}).catch(() => {})
  await browser?.close()
  await closeViteTestServer(vite, cache)
}
