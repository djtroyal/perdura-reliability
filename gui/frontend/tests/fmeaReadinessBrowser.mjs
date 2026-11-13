/** Full FMEA workspace against real Python request schemas and route handlers. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'
import { closeViteTestServer } from './viteTestLifecycle.mjs'
const root = new URL('..', import.meta.url).pathname, repo = resolve(root, '../..')
const outputArg = process.argv.indexOf('--output-dir'), output = outputArg < 0 ? join(tmpdir(), 'perdura-fmea-readiness') : resolve(process.argv[outputArg + 1])
await mkdir(output, { recursive: true })
const aircraft = JSON.parse(await readFile(new URL('./fixtures/aircraftArchitecture.json', import.meta.url), 'utf8'))
const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-fmea-readiness-vite-'))
const python = spawn(process.env.PERDURA_TEST_PYTHON ?? join(repo, '.venv/bin/python'), ['-u', '-c', `
import json,sys
sys.path.insert(0,'gui/backend');sys.path.insert(0,'src')
from routers import fmea
import schemas
from fastapi import HTTPException
from pydantic import ValidationError
routes={'readiness':(fmea.readiness,schemas.FMEAReadinessRequest),'analyze':(fmea.analyze,schemas.FMEAAnalyzeRequest),'revisions':(fmea.revision,schemas.FMEARevisionRequest),'lifecycle/transition':(fmea.transition,schemas.FMEALifecycleTransitionRequest),'releases':(fmea.release,schemas.FMEAReleaseRequest),'releases/verify':(fmea.verify,schemas.FMEAVerifyReleaseRequest)}
for line in sys.stdin:
 try:
  message=json.loads(line);route=message['route']
  if route=='method-profiles':value=fmea.profiles()
  elif route=='rating-profiles':value=fmea.ratings()
  else:
   handler,schema=routes[route];value=handler(schema.model_validate(message['body']))
  response={'status':200,'value':value}
 except HTTPException as exc:response={'status':exc.status_code,'value':{'detail':exc.detail}}
 except ValidationError as exc:response={'status':422,'value':{'detail':json.loads(exc.json())}}
 except Exception as exc:response={'status':500,'value':{'detail':str(exc)}}
 print(json.dumps(response),flush=True)
`], { cwd: repo, stdio: ['pipe', 'pipe', 'pipe'] })
const pending = [], pythonErrors = []
python.stderr.on('data', value => pythonErrors.push(String(value)))
createInterface({ input: python.stdout }).on('line', line => pending.shift()?.resolve(JSON.parse(line)))
python.on('error', error => { for (const request of pending.splice(0)) request.reject(error) })
const backend = (route, body) => new Promise((resolve, reject) => { pending.push({ resolve, reject }); python.stdin.write(JSON.stringify({ route, body }) + '\n') })
const fixture = `
import React from 'react';import {createRoot} from 'react-dom/client';import '/src/index.css'
import FMEA from '/src/components/FMEA'
import {KeyboardShortcutProvider} from '/src/components/shared/KeyboardShortcuts'
import {ReportAssetScopeProvider} from '/src/components/shared/ReportAssetScope'
import * as project from '/src/store/project'
import * as shared from '/src/store/sharedSystem'
import {createProjectSystem} from '/src/store/sharedSystemModel'
import {bindFmeaAnalysis} from '/src/store/sharedFmeaModel'
import {createFmeaAnalysis} from '/src/components/ReliabilityProgram/fmeaModel'
import {createFmeaFailureChain} from '/src/store/fmeaDefaults'
import {EMPTY_FMEA_VOCABULARY_PROFILE} from '/src/components/ReliabilityProgram/fmeaVocabulary'
await project.hydrateProjectStorage();project.newProject('Full FMEA readiness')
const model=${JSON.stringify(aircraft)};shared.commitProjectSystem({...createProjectSystem('Aircraft'),model})
const analysis=bindFmeaAnalysis(model,createFmeaAnalysis('dfmea',1),'motor-controller')
const fn=analysis.functions.find(f=>f.system_definition_ref.instance_id==='motor-controller')
analysis.failure_chains=[{...createFmeaFailureChain('dfmea','FC-1'),function_id:fn.id,cause_structure_node_id:fn.structure_node_id,effect_function_id:fn.id,
failure_mode:'Fails to receive supply',cause:'Open input',effect:'No control power',severity:3,occurrence:2,detection:2,severity_rationale:'Local power loss has limited system impact.',occurrence_rationale:'Established design and operating history support infrequent occurrence.',detection_rationale:'Independent verification detects this failure before operation.',remarks:'Preserve engineering assessment'}]
const folio={view:'analysis',workspaceView:'guided',step:1,structureView:'hierarchy',functionVisualView:'tree',pDiagramId:'',activeId:analysis.id,analyses:[analysis],customRatingProfiles:[],vocabularyProfile:EMPTY_FMEA_VOCABULARY_PROFILE,governance:{},result:null}
project.writeModuleSlices({fmea:{_folioWrap:true,activeId:'one',folios:[{id:'one',name:'Controller study',state:folio}]}})
window.fmeaTest={read:()=>project.getProjectState().modules.fmea.folios[0].state,shared,
 method:id=>{const wrapper=project.getProjectState().modules.fmea,old=wrapper.folios[0].state,aid=old.analyses[0].id;project.writeModuleSlices({fmea:{...wrapper,folios:[{...wrapper.folios[0],state:{...old,governance:{...old.governance,[aid]:{...old.governance[aid],methodProfileId:id}},result:null}}]}})}}
createRoot(document.getElementById('root')).render(<KeyboardShortcutProvider><ReportAssetScopeProvider value={{module:'fmea',moduleLabel:'FMEA'}}><main className="perdura-theme h-screen"><FMEA/></main></ReportAssetScopeProvider></KeyboardShortcutProvider>)`
const vite = await createServer({ root, cacheDir, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [{
  name: 'full-fmea-readiness', resolveId(id) { if (id === '/__fmea-readiness.tsx') return id }, load(id) { if (id === '/__fmea-readiness.tsx') return fixture },
  configureServer(server) { server.middlewares.use('/__fmea-readiness', async (req, res, next) => {
    if (!['/', ''].includes(req.url?.split('?')[0])) return next()
    res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml('/__fmea-readiness', '<!doctype html><html lang="en"><head><title>FMEA readiness regression</title></head><body><div id="root"></div><script type="module" src="/__fmea-readiness.tsx"></script></body></html>'))
  }) },
}] })
let browser, failAnalysis = false, offlineReadiness = false
const errors = [], requests = [], checks = []
try {
  await vite.listen(); browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1780, height: 1150 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const path = new URL(route.request().url()).pathname.split('/fmea/')[1]
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : undefined
    requests.push({ path, body })
    if (path === 'readiness' && offlineReadiness) { await route.fulfill({ status: 503, body: 'Readiness unavailable' }); return }
    const submitted = structuredClone(body)
    if (path === 'analyze' && failAnalysis) submitted.canonical_system.function_links = submitted.canonical_system.function_links.filter(link => link.id !== 'support-motor-controller')
    const response = await backend(path, submitted)
    await route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.value) })
  })
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__fmea-readiness`)
  const analyze = page.getByRole('button', { name: 'Analyze FMEA', exact: true })
  await expect(analyze).toBeEnabled({ timeout: 20000 })
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Scope', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Intent', { exact: true })).toHaveValue('')
  await page.getByRole('button', { name: 'Review & Release', exact: true }).click()
  await expect(page.getByText('This work is read-only until its prerequisites are repaired.', { exact: false })).toHaveCount(0)
  await expect(page.getByLabel('Reviewer / approver name')).toBeEnabled()
  assert.equal(await page.evaluate(() => window.fmeaTest.read().analyses[0].failure_chains[0].remarks), 'Preserve engineering assessment')
  checks.push('Blank descriptive planning fields allow Analyze and Review when engineering prerequisites are complete')
  await page.getByRole('button', { name: 'Analysis', exact: true }).click()
  failAnalysis = true
  await analyze.click()
  await expect(page.getByRole('alert').filter({ hasText: 'Step 3' })).toContainText('parent', { timeout: 20000 })
  assert.equal(await page.evaluate(() => window.fmeaTest.read().result), null)
  checks.push('Authoritative API rejection presents actionable step details and keeps results empty')
  failAnalysis = false
  await analyze.click()
  await expect.poll(() => page.evaluate(() => Boolean(window.fmeaTest.read().result)), { timeout: 20000 }).toBe(true)
  await page.getByRole('button', { name: 'Review & Release', exact: true }).click()
  await page.getByLabel('Reviewer / approver name').fill('Systems reviewer')
  await page.getByLabel('Change summary or approval statement').fill('Verified canonical controller architecture')
  await page.getByRole('button', { name: 'Capture revision', exact: true }).click()
  await expect.poll(() => page.evaluate(() => Object.values(window.fmeaTest.read().governance)[0]?.revisions?.length), { timeout: 20000 }).toBe(1)
  await page.getByLabel('Change summary or approval statement').fill('Submit verified controller study')
  await page.getByRole('button', { name: 'Submit for review', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Approve baseline', exact: true })).toBeVisible({ timeout: 20000 })
  await page.getByLabel('Change summary or approval statement').fill('Approve verified controller study')
  await expect(page.getByRole('button', { name: 'Approve baseline', exact: true })).toBeEnabled({ timeout: 20000 })
  await page.getByRole('button', { name: 'Approve baseline', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Release', exact: true })).toBeEnabled({ timeout: 20000 })
  await page.getByRole('button', { name: 'Release', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Verify', exact: true })).toBeVisible({ timeout: 20000 })
  const current = await page.evaluate(() => Object.values(window.fmeaTest.read().governance)[0])
  assert.equal(current.lifecycleStatus, 'released'); assert.equal(current.revisions[0].canonical_system.version, 4); assert.ok(current.releases[0].canonical_context_sha256)
  for (const request of requests.filter(item => ['analyze', 'revisions', 'lifecycle/transition', 'releases'].includes(item.path))) assert.equal(request.body.canonical_system.id, aircraft.id)
  for (const request of requests.filter(item => ['analyze', 'lifecycle/transition', 'releases'].includes(item.path))) { assert.ok(Array.isArray(request.body.rating_profiles)); assert.ok(Array.isArray(request.body.program_requirements)) }
  checks.push('Analysis, revision, review, approval and release send canonical context through real backend gates')
  offlineReadiness = true
  await page.evaluate(() => window.fmeaTest.method('iec_60812_2018'))
  await expect(analyze).toBeDisabled(); await expect(page.getByLabel('Reviewer / approver name')).toBeDisabled()
  await page.getByRole('button', { name: 'Analysis', exact: true }).click()
  await page.getByRole('button', { name: /Function analysis$/i }).click()
  await expect(page.getByText('This work is read-only until its prerequisites are complete.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Methods', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Method profiles', exact: true })).toBeVisible()
  checks.push('Method prerequisites block child editing during backend unavailability while Methods stays accessible')
  assert.deepEqual(errors, [])
  await page.screenshot({ path: join(output, 'fmea-readiness.png'), fullPage: true })
  await writeFile(join(output, 'browser.json'), JSON.stringify({ checks, errors, requests: requests.map(item => item.path), pythonErrors }, null, 2) + '\n')
  console.log(JSON.stringify({ checks, output }))
} finally { await browser?.close(); await closeViteTestServer(vite, cacheDir); python.kill() }
