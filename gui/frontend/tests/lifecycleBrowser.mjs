/** Production lifecycle controls with results from the real Python handlers. */
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
const output = resolve(outputOption < 0 ? join(tmpdir(), 'perdura-lifecycle-browser') : process.argv[outputOption + 1])
await mkdir(output, { recursive: true })
const cache = await mkdtemp(join(tmpdir(), 'perdura-lifecycle-vite-'))
const entry = '/__lifecycle.tsx'
const fixture = `
import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import '/src/index.css'
import FleetForecast from '/src/components/Maintenance/FleetForecast'
import RepairableTools from '/src/components/Growth/RepairableTools'
import {INITIAL_MCF_STATE} from '/src/components/Growth/mcfContracts'
import {KeyboardShortcutProvider} from '/src/components/shared/KeyboardShortcuts'
import {ReportAssetScopeProvider} from '/src/components/shared/ReportAssetScope'
import * as project from '/src/store/project'
await project.hydrateProjectStorage()
project.newProject('Lifecycle browser fixture')
window.lifecycleTest={project}
function Fixture(){
  const [view,setView]=useState('fleet'),[mcf,setMcf]=useState(INITIAL_MCF_STATE)
  window.lifecycleTest.mcf=mcf
  return <KeyboardShortcutProvider><ReportAssetScopeProvider value={{module:view==='fleet'?'maintFleet':'growth',moduleLabel:'Lifecycle'}}>
    <div className="perdura-theme flex h-screen flex-col"><nav><button onClick={()=>setView('fleet')}>Fleet view</button><button onClick={()=>setView('mcf')}>Cost MCF view</button></nav>
    {view==='fleet'?<FleetForecast/>:<RepairableTools tool="mcf" mcfState={mcf} setMcfState={setMcf} folioId="f0"/>}</div>
  </ReportAssetScopeProvider></KeyboardShortcutProvider>
}
createRoot(document.getElementById('root')).render(<Fixture/>)
`
const vite = await createServer({ root, cacheDir: cache, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [{
  name: 'lifecycle-fixture', resolveId(id) { if (id === entry) return id }, load(id) { if (id === entry) return fixture },
  configureServer(server) {
    server.middlewares.use('/__lifecycle', async (req, res, next) => {
      if (req.url !== '/' && req.url !== '') return next()
      res.setHeader('Content-Type', 'text/html')
      res.end(await server.transformIndexHtml('/__lifecycle', `<!doctype html><html lang="en"><head><title>Lifecycle assurance</title></head><body><main id="root"></main><script type="module" src="${entry}"></script></body></html>`))
    })
  },
}] })
const python = process.env.PERDURA_PYTHON ?? resolve(repo, '.venv/bin/python')
const child = spawn(python, ['-u', '-c', `
import json,sys
from routers import maintenance,growth
from schemas import MCFRequest
print(json.dumps({'ready':True}))
for line in sys.stdin:
    p=json.loads(line)
    try:
        if p['kind']=='fleet-forecast': out=maintenance.fleet_forecast(maintenance.FleetForecastRequest(**p['body']))
        elif p['kind']=='mcf': out=growth.mcf(MCFRequest(**p['body']))
        else: raise ValueError(p['kind'])
        print(json.dumps({'id':p['id'],'result':out},allow_nan=False))
    except Exception as error:
        print(json.dumps({'id':p['id'],'error':str(error)}))
`], { cwd: repo, env: { ...process.env, PYTHONPATH: join(repo, 'src') + ':' + join(repo, 'gui/backend'), MPLCONFIGDIR: join(tmpdir(), 'perdura-lifecycle-mpl') },
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
let browser, page
const checks = [], errors = [], requests = []
try {
  await ready
  await vite.listen()
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, reducedMotion: 'reduce' })
  page = await context.newPage()
  page.setDefaultTimeout(20000)
  page.on('pageerror', error => errors.push(error.message))
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const kind = new URL(route.request().url()).pathname.split('/').at(-1)
    const body = route.request().postDataJSON(), request = { kind, body }
    requests.push(request)
    try {
      const result = await calculate(kind, body)
      request.result = result
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) })
    } catch (error) {
      errors.push(String(error))
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: String(error) }) })
    }
  })
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__lifecycle`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  const run = page.getByRole('button', { name: 'Forecast fleet', exact: true })
  await run.waitFor({ timeout: 90000 })
  await page.getByRole('button', { name: 'Load example data', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Cohort 2 id', exact: true })).toHaveValue('New deliveries')
  await run.click({ timeout: 90000 })
  const fleet = () => page.evaluate(() => window.lifecycleTest.project.readFolioState('maintFleet', 'f0'))
  await expect.poll(async () => Boolean((await fleet()).result), { timeout: 90000 }).toBe(true)
  const first = (await fleet()).result
  assert.equal(first.model, 'first_failure')
  assert.ok(first.total_expected_events > 0 && first.total_expected_events < 1200)
  assert.equal(first.cohorts.length, 2)
  assert.equal(first.cohorts[1].entry_time, 12)
  await expect(page.getByText('Expected events', { exact: true }).first()).toBeVisible()
  checks.push('Default fleet example computes both installed-age and delivery cohorts with the real handler')
  await page.getByRole('combobox', { name: 'Fleet event model', exact: true }).selectOption('perfect_renewal')
  assert.equal((await fleet()).result, null)
  await run.click({ timeout: 90000 })
  await expect.poll(async () => (await fleet()).result?.model, { timeout: 90000 }).toBe('perfect_renewal')
  const renewed = (await fleet()).result
  assert.ok(renewed.total_expected_events > first.total_expected_events)
  assert.ok(renewed.numerical.maximum_count_half_width > 0)
  assert.equal(renewed.total_expected_cost, 1500 * renewed.total_expected_events)
  await page.screenshot({ path: join(output, 'fleet-renewal.png'), fullPage: true })
  checks.push('Model changes clear the previous result; perfect renewal displays bounded events and costs')

  await page.getByRole('button', { name: 'Cost MCF view', exact: true }).click()
  await page.getByRole('combobox', { name: 'MCF measure', exact: true }).selectOption('cost')
  await expect(page.getByRole('checkbox')).toBeDisabled()
  await expect(page.getByRole('checkbox')).not.toBeChecked()
  await page.getByRole('textbox', { name: 'MCF cost data', exact: true }).fill('1:10 | 2\n1:30 | 2')
  await page.getByRole('button', { name: 'Compute MCF', exact: true }).click({ timeout: 90000 })
  await expect.poll(() => page.evaluate(() => Boolean(window.lifecycleTest.mcf.result)), { timeout: 90000 }).toBe(true)
  const mcf = await page.evaluate(() => window.lifecycleTest.mcf.result)
  assert.deepEqual(mcf.nonparametric.MCF, [20])
  assert.deepEqual(mcf.nonparametric.variance, [100])
  assert.equal(mcf.nonparametric.measure, 'cost')
  assert.equal(mcf.parametric, null)
  assert.equal(mcf.trend.trend, 'not_assessed')
  await page.screenshot({ path: join(output, 'cost-mcf.png'), fullPage: true })
  checks.push('Cost selection disables count likelihood and computes mean monetary marks with subject-cluster variance')
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, browser: browser.version(), requests: requests.length }, null, 2))
  console.log(JSON.stringify({ status: 'passed', checks, output }, null, 2))
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  await writeFile(join(output, 'report.json'), JSON.stringify({ status: 'failed', error: String(error), errors, checks, requests,
    body: await page?.locator('body').innerText().catch(() => null) }, null, 2))
  throw error
} finally {
  child.stdin.end()
  child.kill()
  await browser?.close()
  await closeViteTestServer(vite, cache)
}
