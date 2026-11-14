/** Live Reliability Program editor and physical FMEA hook share one persistent requirement. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'
import { closeViteTestServer } from './viteTestLifecycle.mjs'

const root = new URL('..', import.meta.url).pathname
const index = process.argv.indexOf('--output-dir')
const output = index < 0 ? join(tmpdir(), 'perdura-shared-requirements') : resolve(process.argv[index + 1])
await mkdir(output, { recursive: true })
const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-shared-requirements-vite-'))
const path = '/__shared-requirements.tsx'
const fixture = `
import React from 'react'; import {createRoot} from 'react-dom/client'; import '/src/index.css'
import ReliabilityProgram from '/src/components/ReliabilityProgram'
import {KeyboardShortcutProvider} from '/src/components/shared/KeyboardShortcuts'
import {ReportAssetScopeProvider} from '/src/components/shared/ReportAssetScope'
import * as project from '/src/store/project'; import * as shared from '/src/store/sharedSystem'
import {createProjectSystem} from '/src/store/sharedSystemModel'; import {bindFmeaAnalysis} from '/src/store/sharedFmeaModel'
import {createFmeaAnalysis} from '/src/components/ReliabilityProgram/fmeaModel'
import {createSystemRequirement,createVerificationCase} from '/src/store/systemRequirements'
import {useSharedFmeaState} from '/src/store/useSharedFmeaState'
await project.hydrateProjectStorage()
await project.openNamedProject('Shared requirement browser')
const initial={analyses:[],governance:{}}
if(project.getProjectState().projectName!=='Shared requirement browser'){
  project.newProject('Shared requirement browser');const system=createProjectSystem('Aircraft')
  system.model.definitions[0].functions=[{id:'isolate',description:'Maintain secure isolation',function_type:'primary',mode_ids:[],definition:{role:'maintain_state',action:'secure isolation',state_verb:'maintain',io:[]}}]
  system.model.requirements=[{...createSystemRequirement('REQ-POWER'),statement:'Maintain power isolation',allocations:[{system_model_id:system.model.id,instance_id:system.model.root_instance_id}]}]
  shared.commitProjectSystem(system)
  const physical=bindFmeaAnalysis(system.model,createFmeaAnalysis('dfmea',1));physical.planning.subject='Aircraft';physical.planning.scope='Aircraft systems'
  const process=createFmeaAnalysis('pfmea',1);process.functional_requirements=[{id:'PROCESS-REQ',statement:'Inspect fastener',requirement_type:'process',measure:'',target:'',unit:'',acceptance_criteria:'',operating_condition:'',source:'',owner:'',confidence:'',verification_method:'',evidence_ids:[],special_characteristic:''}]
  project.writeModuleSlices({fmea:{_folioWrap:true,activeId:'study',folios:[{id:'study',name:'System assessment',state:{analyses:[physical,process],governance:{}}}]}})
}
function FmeaProjection(){const[state,setState]=useSharedFmeaState('fmea',initial,'analyses');const analysis=state.analyses.find(item=>item.kind==='dfmea'), process=state.analyses.find(item=>item.kind==='pfmea');return <section aria-label="Physical FMEA shared editor" className="p-4 border-b"><label>FMEA requirement statement<input aria-label="FMEA requirement statement" value={analysis?.functional_requirements[0]?.statement??''} onChange={event=>setState(previous=>({...previous,analyses:previous.analyses.map(item=>item.id===analysis.id?{...item,functional_requirements:item.functional_requirements.map((requirement,index)=>index===0?{...requirement,statement:event.target.value}:requirement)}:item)}))}/></label><output aria-label="Process requirement">{process?.functional_requirements[0]?.statement}</output><button onClick={()=>setState(previous=>({...previous,governance:{...previous.governance,[analysis.id]:{...previous.governance[analysis.id],verificationPlan:[{...createVerificationCase('CASE-POWER','REQ-POWER'),objective:'Verify isolation'}]}}}))}>Add shared verification from FMEA</button></section>}
window.requirementsTest={project,shared}
createRoot(document.getElementById('root')).render(<KeyboardShortcutProvider><ReportAssetScopeProvider value={{module:'reliabilityProgram',moduleLabel:'Reliability Program'}}><div className="perdura-theme h-screen flex flex-col"><FmeaProjection/><div className="min-h-0 flex-1"><ReliabilityProgram/></div></div></ReportAssetScopeProvider></KeyboardShortcutProvider>)`
const vite = await createServer({ root, cacheDir, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false },
  plugins: [{ name: 'shared-requirements-fixture', resolveId(id) { if (id === path) return id }, load(id) { if (id === path) return fixture },
    configureServer(server) { server.middlewares.use('/__shared-requirements', async (req, res, next) => {
      if (!['', '/'].includes(req.url?.split('?')[0])) return next()
      res.setHeader('Content-Type', 'text/html')
      res.end(await server.transformIndexHtml('/__shared-requirements', '<!doctype html><html lang="en"><head><title>Shared requirements</title></head><body><div id="root"></div><script type="module" src="/__shared-requirements.tsx"></script></body></html>'))
    }) } }] })
let browser, page, failure
const errors = [], checks = []
const startedAt = Date.now()
const xml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
try {
  await vite.listen(); browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1780, height: 1080 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({ status: 503, body: 'Offline authoring test' }))
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__shared-requirements`)
  await expect(page.getByLabel('FMEA requirement statement')).toHaveValue('Maintain power isolation', { timeout: 90000 })
  await page.getByRole('button', { name: /^Requirements 1$/ }).click()
  await page.getByLabel('Requirement statement, row 1', { exact: true }).fill('Maintain protected power isolation')
  await expect(page.getByLabel('FMEA requirement statement')).toHaveValue('Maintain protected power isolation')
  await page.getByLabel('FMEA requirement statement').fill('Maintain verified isolation')
  await expect(page.getByLabel('Requirement statement, row 1', { exact: true })).toHaveValue('Maintain verified isolation')
  await expect(page.getByLabel('ID, row 1', { exact: true })).toHaveAttribute('readonly', '')
  await expect(page.getByLabel('Process requirement')).toHaveText('Inspect fastener')
  checks.push('Real Reliability Program edits and physical FMEA hook edits share identity; PFMEA stays local')
  await page.getByRole('button', { name: 'Add shared verification from FMEA' }).click()
  const stored = await page.evaluate(() => {
    const modules = window.requirementsTest.project.getProjectState().modules
    return { model: modules.systemDefinition.model, fmea: modules.fmea.folios[0].state, program: modules.reliabilityProgram.folios[0].state }
  })
  assert.equal(stored.model.verification_cases[0].objective, 'Verify isolation')
  assert.deepEqual(stored.fmea.governance['DFMEA-1'].verificationPlan, [])
  assert.deepEqual(stored.fmea.analyses.find(item => item.kind === 'dfmea').functional_requirements, [])
  assert.deepEqual(stored.program.rows.requirements, [])
  assert.equal(stored.model.requirements[0].id, 'REQ-POWER')
  checks.push('Governance-only edits commit canonical cases; projected records are not duplicated in persistence')
  await page.evaluate(async () => {
    const {project}=window.requirementsTest
    if(!await project.saveNamedProject('Shared requirement browser')) throw new Error('Save failed')
  })
  await page.reload()
  await expect(page.getByLabel('FMEA requirement statement')).toHaveValue('Maintain verified isolation', { timeout: 90000 })
  await expect(page.getByLabel('Requirement statement, row 1', { exact: true })).toHaveValue('Maintain verified isolation')
  checks.push('Explicit named-project reopen after reload preserves the canonical requirement and both live views')
  assert.deepEqual(errors, [])
  await page.screenshot({ path: join(output, 'shared-requirements.png'), fullPage: true })
  await writeFile(join(output, 'report.json'), JSON.stringify({ checks, errors }, null, 2))
  console.log(JSON.stringify({ passed: checks.length, checks, output }, null, 2))
} catch (error) {
  failure = error
  await writeFile(join(output, 'report.json'), JSON.stringify({ status: 'failed', checks, errors, failure: String(error.stack ?? error) }, null, 2))
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  throw error
} finally {
  const cases = checks.map(check => `<testcase classname="shared-requirements-browser" name="${xml(check)}"/>`)
  if (failure) cases.push(`<testcase classname="shared-requirements-browser" name="remaining checks"><failure message="${xml(failure.message ?? failure)}">${xml(failure.stack ?? failure)}</failure></testcase>`)
  await writeFile(join(output, 'junit-shared-requirements.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="shared-requirements-browser" tests="${cases.length}" failures="${failure ? 1 : 0}" errors="0" skipped="0" time="${((Date.now() - startedAt) / 1000).toFixed(3)}">${cases.join('')}</testsuite>\n`)
  await browser?.close(); await closeViteTestServer(vite, cacheDir)
}
