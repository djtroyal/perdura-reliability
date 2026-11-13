/** Production FMEA/store integration against the current canonical architecture contract. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'
import { closeViteTestServer } from './viteTestLifecycle.mjs'
const root = new URL('..', import.meta.url).pathname
const outputArg = process.argv.indexOf('--output-dir')
const output = outputArg < 0 ? join(tmpdir(), 'perdura-shared-fmea') : resolve(process.argv[outputArg + 1])
await mkdir(output, { recursive: true })
const route = '/__shared-fmea.tsx', cacheDir = await mkdtemp(join(tmpdir(), 'perdura-shared-fmea-vite-'))
const aircraft = JSON.parse(await readFile(new URL('./fixtures/aircraftArchitecture.json', import.meta.url), 'utf8'))
for (const definition of aircraft.definitions) definition.failure_modes = definition.functions.map(fn => ({ id: `failure-${fn.id}`, function_id: fn.id, description: `Loss of ${fn.description}`, deviation_id: 'absent', mode_ids: [] }))
const fixture = `
import React from 'react';import {createRoot} from 'react-dom/client';import '/src/index.css'
import FMEA from '/src/components/FMEA';import {KeyboardShortcutProvider} from '/src/components/shared/KeyboardShortcuts'
import {ReportAssetScopeProvider} from '/src/components/shared/ReportAssetScope'
import * as project from '/src/store/project';import * as shared from '/src/store/sharedSystem';import * as system from '/src/store/sharedSystemModel'
import * as fmea from '/src/store/sharedFmeaModel';import {createFmeaAnalysis} from '/src/components/ReliabilityProgram/fmeaModel'
import {EMPTY_FMEA_VOCABULARY_PROFILE} from '/src/components/ReliabilityProgram/fmeaVocabulary'
await project.hydrateProjectStorage()
if(project.getProjectState().projectName!=='Canonical shared FMEA browser'){
 project.newProject('Canonical shared FMEA browser');const state=system.createProjectSystem('Aircraft'),model=${JSON.stringify(aircraft)};state.model=model;shared.commitProjectSystem(state)
 const source=createFmeaAnalysis('dfmea',1);source.planning={...source.planning,subject:'Aircraft',scope:'Aircraft functions and interfaces',intent:'Assess system failures',team:['Systems engineer']}
 const study=fmea.bindFmeaAnalysis(model,source)
 study.failure_chains=study.failure_chains.map(chain=>({...chain,severity:9,occurrence:3,detection:3,cause:'Open functional path',effect:'Loss of aircraft function',cause_structure_node_id:study.functions.find(fn=>fn.id===chain.function_id)?.structure_node_id,effect_function_id:study.functions[0].id,remarks:'Keep my engineering assessment'}))
 const folio={view:'analysis',workspaceView:'guided',step:2,structureView:'hierarchy',functionVisualView:'tree',pDiagramId:'',activeId:study.id,analyses:[study],customRatingProfiles:[],vocabularyProfile:EMPTY_FMEA_VOCABULARY_PROFILE,governance:{},result:null}
 project.writeModuleSlices({fmea:{_folioWrap:true,activeId:'one',folios:[{id:'one',name:'Main study',state:folio},{id:'two',name:'Inactive study',state:structuredClone(folio)}]}})
}
window.sharedFmea={project,shared,system,fmea,rename:(id,name)=>shared.commitProjectSystem({...shared.currentProjectSystem(),model:{...shared.currentProjectSystem().model,instances:shared.currentProjectSystem().model.instances.map(item=>item.id===id?{...item,name}:item)}})}
createRoot(document.getElementById('root')).render(<KeyboardShortcutProvider><ReportAssetScopeProvider value={{module:'fmea',moduleLabel:'FMEA'}}><div className="perdura-theme h-screen"><FMEA/></div></ReportAssetScopeProvider></KeyboardShortcutProvider>)`
const vite = await createServer({ root, cacheDir, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [{ name: 'shared-fmea-fixture',
  resolveId(id) { if (id === route) return id }, load(id) { if (id === route) return fixture }, configureServer(server) { server.middlewares.use('/__shared-fmea', async (req, res, next) => {
    if (!['/', ''].includes(req.url?.split('?')[0])) return next(); res.setHeader('Content-Type', 'text/html')
    res.end(await server.transformIndexHtml('/__shared-fmea', '<!doctype html><html lang="en"><head><title>Canonical shared FMEA</title></head><body><div id="root"></div><script type="module" src="/__shared-fmea.tsx"></script></body></html>'))
  }) } }] })
let browser
const errors = [], checks = []
try {
  await vite.listen(); browser = await chromium.launch({ headless: true }); const page = await browser.newPage({ viewport: { width: 1780, height: 1080 } })
  page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept())
  await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({ status: 503, body: 'Use immediate local draft readiness in this isolated browser check.' }))
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__shared-fmea`)
  await expect(page.getByLabel('FMEA study scope')).toBeVisible({ timeout: 90000 })
  await page.evaluate(() => window.sharedFmea.rename('propulsion', 'Propulsion revised'))
  const row = page.locator('[data-fmea-record-id="SD-propulsion"]')
  await expect(row).toContainText('Propulsion revised'); await row.getByText('Propulsion revised', { exact: true }).click()
  await row.getByLabel('Block name', { exact: true }).fill('Propulsion from FMEA')
  await expect.poll(() => page.evaluate(() => window.sharedFmea.shared.currentProjectSystem().model.instances.find(item => item.id === 'propulsion').name)).toBe('Propulsion from FMEA')
  const preserved = await page.evaluate(() => { const { project, fmea, shared } = window.sharedFmea; return project.getProjectState().modules.fmea.folios.map(folio => fmea.materializeFmeaAnalysis(shared.currentProjectSystem().model, folio.state.analyses[0])) })
  assert(preserved.every(study => study.structure_nodes.find(node => node.id === 'SD-propulsion').name === 'Propulsion from FMEA'))
  assert(preserved.every(study => study.failure_chains.every(chain => chain.severity === 9 && chain.remarks === 'Keep my engineering assessment')))
  checks.push('Bidirectional canonical edits update inactive studies while retaining every assessment')
  await page.getByRole('button', { name: 'Block diagram', exact: true }).click()
  await expect(page.getByLabel('Item of focus')).toBeVisible()
  const signature = await page.evaluate(() => { const w = window.sharedFmea; return w.fmea.fmeaSemanticFingerprint(w.shared.currentProjectSystem().model, w.project.getProjectState().modules.fmea.folios[0].state.analyses) })
  await page.getByLabel('Item of focus').selectOption('motor-controller')
  await expect(page.locator('.react-flow__node-fmeaBlock').filter({ hasText: 'Motor Controller' })).toHaveCount(1)
  await expect(page.locator('.react-flow__node-fmeaBlock').filter({ hasText: 'ESPS' })).toHaveCount(1)
  assert.equal(await page.evaluate(() => { const w = window.sharedFmea; return w.fmea.fmeaSemanticFingerprint(w.shared.currentProjectSystem().model, w.project.getProjectState().modules.fmea.folios[0].state.analyses) }), signature)
  checks.push('Focused lower-level diagram retains its cross-level boundary peer without changing semantic inputs')
  await page.getByRole('button', { name: 'Snap', exact: true }).click()
  await page.getByLabel('Diagram layout', { exact: true }).click(); await page.getByRole('button', { name: 'Expanded', exact: true }).click()
  assert.equal(await page.evaluate(() => { const w = window.sharedFmea; return w.fmea.fmeaSemanticFingerprint(w.shared.currentProjectSystem().model, w.project.getProjectState().modules.fmea.folios[0].state.analyses) }), signature)
  checks.push('Canvas layout and snap do not alter canonical semantic fingerprint')
  assert.equal(await page.evaluate(() => window.sharedFmea.project.flushProjectPersistence()), true)
  await page.reload(); await expect(page.getByLabel('Item of focus')).toHaveValue('motor-controller')
  assert.equal(await page.evaluate(() => window.sharedFmea.shared.currentProjectSystem().model.instances.find(item => item.id === 'propulsion').name), 'Propulsion from FMEA')
  checks.push('Canonical model edits and focused diagram preference survive reload')
  await page.getByLabel('FMEA study scope').selectOption('motor-controller')
  await page.getByRole('button', { name: /Function analysis$/i }).click()
  const creationTarget = page.getByLabel('New function system item', { exact: true })
  assert.deepEqual(await creationTarget.locator('option').evaluateAll(options => options.map(option => option.value)), ['SD-motor-controller'])
  await expect(creationTarget).toHaveValue('SD-motor-controller')
  checks.push('Canonical function creation stays within study scope while required peer and ancestor functions remain context')
  await page.evaluate(() => { const w = window.sharedFmea, state = w.shared.currentProjectSystem(); w.shared.commitProjectSystem({ ...state, model: { ...state.model, resources: state.model.resources.map(resource => resource.id === 'dc-power' ? { ...resource, name: 'Protected DC supply' } : resource) } }) })
  const updated = await page.evaluate(() => { const w = window.sharedFmea; return w.project.getProjectState().modules.fmea.folios.map(folio => w.fmea.materializeFmeaAnalysis(w.shared.currentProjectSystem().model, folio.state.analyses[0])) })
  for (const study of updated) {
    const receiver = study.functions.find(fn => fn.system_definition_ref?.instance_id === 'motor-controller'
      && fn.system_definition_ref?.function_id === 'receive-power')
    assert.ok(receiver, 'Every study retains the canonical receiving function')
    assert.equal(receiver.description, 'Import 28 V DC supply', 'Renaming a resource must preserve the authored function action')
    assert.equal(receiver.definition.action, 'Import 28 V DC supply')
    assert.ok(receiver.definition.io.some(io => io.direction === 'input' && io.resource_id === 'dc-power'),
      'The receiving function retains its canonical input resource binding')
    assert.equal(study.resources.find(resource => resource.id === 'dc-power')?.name, 'Protected DC supply',
      'Every study resolves its input resource to the renamed shared resource')
  }
  assert(updated.every(study => study.interfaces[0].flow_description === 'Protected DC supply'))
  assert(updated.every(study => study.interfaces[0].transfers[0].resource_id === 'dc-power'))
  checks.push('Resource renames refresh shared inputs and interface content in all studies while preserving authored function actions')
  assert.deepEqual(errors, [])
  await page.screenshot({ path: join(output, 'focused-system-fmea.png'), fullPage: true })
  await writeFile(join(output, 'report.json'), JSON.stringify({ checks, errors }, null, 2))
  console.log(JSON.stringify({ passed: checks.length, output, checks }, null, 2))
} finally { await browser?.close(); await closeViteTestServer(vite, cacheDir) }
