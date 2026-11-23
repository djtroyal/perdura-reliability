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
const output = resolve(outputOption < 0 ? join(tmpdir(), 'perdura-lifetime-tools-browser') : process.argv[outputOption + 1])
await mkdir(output, { recursive: true })
const cache = await mkdtemp(join(tmpdir(), 'perdura-lifetime-tools-vite-'))
const entry = '/__lifetime-tools.tsx'
const fixture = `
import React from 'react'
import {createRoot} from 'react-dom/client'
import '/src/index.css'
import LifetimeTools from '/src/components/Maintenance/LifetimeTools'
import {KeyboardShortcutProvider} from '/src/components/shared/KeyboardShortcuts'
import {ReportAssetScopeProvider} from '/src/components/shared/ReportAssetScope'
import * as project from '/src/store/project'
import {requestBookmarkNavigation} from '/src/store/bookmarks'
await project.hydrateProjectStorage()
project.newProject('Lifetime tools browser fixture')
window.lifetimeToolsTest={project,requestBookmarkNavigation}
createRoot(document.getElementById('root')).render(<KeyboardShortcutProvider><ReportAssetScopeProvider value={{module:'lifeTools',moduleLabel:'Lifetime Tools'}}>
<div className="perdura-theme flex h-screen flex-col"><LifetimeTools/></div></ReportAssetScopeProvider></KeyboardShortcutProvider>)
`

const vite = await createServer({ root, cacheDir: cache, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [{
  name: 'lifecycle-fixture', resolveId(id) { if (id === entry) return id }, load(id) { if (id === entry) return fixture },
  configureServer(server) {
    server.middlewares.use('/__lifetime-tools', async (req, res, next) => {
      if (req.url !== '/' && req.url !== '') return next()
      res.setHeader('Content-Type', 'text/html')
      res.end(await server.transformIndexHtml('/__lifetime-tools', `<!doctype html><html lang="en"><head><title>Lifecycle assurance</title></head><body><main id="root"></main><script type="module" src="${entry}"></script></body></html>`))
    })
  },
}] })
const python = process.env.PERDURA_PYTHON ?? resolve(repo, '.venv/bin/python')
const child = spawn(python, ['-u', '-c', `
import json,sys
from routers import life_tools
print(json.dumps({'ready':True}))
for line in sys.stdin:
    p=json.loads(line)
    try:
        kind=p['kind']; body=p['body']
        if kind=='survival-matrix': out=life_tools.matrix(life_tools.SurvivalMatrixRequest(**body))
        elif kind=='mechanical-rate': out=life_tools.mechanical(life_tools.MechanicalRateRequest(**body))
        elif kind=='inspection-prediction': out=life_tools.inspection(life_tools.InspectionPredictionRequest(**body))
        else: raise ValueError(kind)
        print(json.dumps({'id':p['id'],'result':out},allow_nan=False))
    except Exception as error:
        print(json.dumps({'id':p['id'],'error':str(error)}))
`], { cwd: repo, env: { ...process.env, PYTHONPATH: join(repo, 'src') + ':' + join(repo, 'gui/backend'), MPLCONFIGDIR: join(tmpdir(), 'perdura-lifetime-tools-mpl') },
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
let browser, page, releaseHeldResponse
let holdNextResponse = false
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
      if (holdNextResponse) { holdNextResponse = false; await new Promise(resolveHeld => { releaseHeldResponse = resolveHeld }) }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) })
    } catch (error) {
      errors.push(String(error))
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: String(error) }) })
    }
  })
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__lifetime-tools`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  const run = page.getByRole('button', { name: 'Calculate lifetime tool', exact: true })
  await run.waitFor({timeout:90000})
  const state = () => page.evaluate(() => window.lifetimeToolsTest.project.getProjectState().modules.lifeTools)
  await run.click()
  await expect.poll(async () => Boolean((await state())?.matrixResult), {timeout:90000}).toBe(true)
  assert.equal((await state()).matrixResult.survival[0][0],1)
  await expect(page.getByRole('table',{name:'Conditional probability table'})).toBeVisible()
  await page.getByRole('combobox',{name:'Survival table measure'}).selectOption('failure')
  const downloadPromise=page.waitForEvent('download')
  await page.getByRole('button',{name:'Export CSV',exact:true}).click()
  await (await downloadPromise).saveAs(join(output,'conditional-survival.csv'))
  await page.screenshot({path:join(output,'survival-matrix.png'),fullPage:true})
  checks.push('Real conditional probabilities, heatmap, failure toggle and CSV export')
  await page.getByRole('textbox',{name:'Current ages (hours)',exact:true}).fill('0:100:1')
  await page.getByRole('textbox',{name:'Additional durations (hours)',exact:true}).fill('0:100:1')
  await run.click()
  await expect(page.getByText('The survival table is limited to 2500 cells.',{exact:true})).toBeVisible()
  await page.getByRole('combobox',{name:'Lifetime tool'}).selectOption('mechanical')
  await page.getByRole('button',{name:'Load reference example'}).click()
  await run.click()
  await expect.poll(async () => Boolean((await state())?.mechanicalResult), {timeout:90000}).toBe(true)
  assert.ok(Math.abs((await state()).mechanicalResult.cm_per_time-20.617528603752664e-6)<1e-14)
  await page.getByRole('combobox',{name:'Mechanical life input'}).selectOption('percentile')
  await page.getByRole('textbox',{name:'Corrective downtime (hours)',exact:true}).fill('20')
  await run.click()
  await expect.poll(async () => (await state())?.mechanicalResult?.availability ?? 1).toBeLessThan(1)
  assert.ok((await state()).mechanicalResult.eta>5000)
  await page.screenshot({path:join(output,'mechanical-conversion.png'),fullPage:true})
  checks.push('Mechanical reference, percentile conversion and operating/calendar rate semantics')
  await page.getByRole('combobox',{name:'Lifetime tool'}).selectOption('inspection')
  await page.getByRole('button',{name:'Load reference example'}).click()
  await run.click()
  await expect.poll(async () => Boolean((await state())?.inspectionResult), {timeout:90000}).toBe(true)
  const predicted=(await state()).inspectionResult
  assert.equal(predicted.rows.length,3)
  assert.ok(predicted.rows[0].predictive_interval.upper>predicted.rows[0].posterior_predictive_mean)
  await expect(page.getByText('Prior sensitivity',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Use in Fleet Forecast',exact:true}).first().click()
  const fleet=await page.evaluate(() => window.lifetimeToolsTest.project.getProjectState().modules.maintFleet)
  assert.equal(fleet.cohorts[0].count,'19992')
  assert.equal(Number(fleet.alpha),predicted.rows[0].eta_mle)
  await page.screenshot({path:join(output,'inspection-prediction.png'),fullPage:true})
  await page.getByRole('textbox',{name:'Failures observed X',exact:true}).fill('0')
  await run.click()
  await expect.poll(async () => (await state())?.inspectionResult?.observed_failures, {timeout:90000}).toBe(0)
  assert.ok((await state()).inspectionResult.rows[0].posterior_predictive_mean>0)
  await expect(page.getByRole('button',{name:'Use in Fleet Forecast',exact:true}).first()).toBeDisabled()
  await page.getByRole('textbox',{name:'Failures observed X',exact:true}).fill('20000')
  await run.click()
  await expect.poll(async () => (await state())?.inspectionResult?.observed_failures, {timeout:90000}).toBe(20000)
  assert.equal((await state()).inspectionResult.rows[0].posterior_predictive_mean,0)
  checks.push('Predictive/prior/shape uncertainty, fleet handoff, zero/all-failure cases')
  for (const view of ['matrix','mechanical','inspection']) {
    await page.evaluate(view => window.lifetimeToolsTest.requestBookmarkNavigation({module:'lifeTools',tab:'maintenance',sub:'lifetime-tools',view,assetKey:'test-'+view,analysisName:'Lifetime Tools'},'Saved result'),view)
    await expect(page.getByRole('combobox',{name:'Lifetime tool'})).toHaveValue(view)
  }
  assert.equal((await state()).inspectionResult.observed_failures,20000)
  checks.push('Saved report navigation selects each lifetime view without deleting its result')
  holdNextResponse = true
  await run.click()
  await expect.poll(() => Boolean(releaseHeldResponse)).toBe(true)
  await page.evaluate(() => window.lifetimeToolsTest.project.newProject('New project during pending calculation'))
  releaseHeldResponse()
  await expect(run).toBeEnabled()
  assert.equal((await state())?.inspectionResult ?? null, null)
  checks.push('A completed request from the previous project cannot populate the new project')
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
