/** Actual singleton System Definition/Prediction editing and portable scenario export. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'
import { unzipSync, strFromU8 } from 'fflate'
import { closeViteTestServer } from './viteTestLifecycle.mjs'
const root = new URL('..', import.meta.url).pathname
const arg = process.argv.indexOf('--output-dir')
const output = resolve(arg < 0 ? join(tmpdir(), 'perdura-shared-system') : process.argv[arg + 1])
await mkdir(output, { recursive: true })
const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-shared-system-vite-'))
const route = '/__shared-system.tsx'
const fixture = `
import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import '/src/index.css'
import SystemDefinition from '/src/components/SystemDefinition'
import Prediction from '/src/components/Prediction'
import {KeyboardShortcutProvider} from '/src/components/shared/KeyboardShortcuts'
import {ReportAssetScopeProvider} from '/src/components/shared/ReportAssetScope'
import * as project from '/src/store/project'
import * as model from '/src/store/sharedSystemModel'
import * as shared from '/src/store/sharedSystem'
await project.hydrateProjectStorage()
const initial={standard:'MIL-HDBK-217F',environment:'GB',parts:[],blocks:[],blockSeq:0,deratingEnabled:false}
if(project.getProjectState().projectName!=='Shared browser'){
 project.newProject('Shared browser')
 const data=model.splitPredictionUpdate(model.createProjectSystem('Plant'),model.emptyPredictionScenario(initial),{
  ...initial,blocks:[{id:'assembly',name:'Assembly',quantity:2,parentId:null},{id:'nested',name:'Nested',quantity:5,parentId:'assembly'}],
  parts:[['root-part','Root part',null],['assembly-part','Assembly part','assembly'],['nested-part','Nested part','nested']].map(([id,name,parentId])=>({id,name,parentId,quantity:1,category:'resistor',params:{style:'RW',quality:'commercial'}}))})
 shared.commitProjectSystem(data.system)
 project.writeModuleSlices({prediction:{_folioWrap:true,activeId:'one',folios:[
  {id:'one',name:'Scenario one',state:data.scenario},
  {id:'two',name:'Scenario two',state:{...structuredClone(data.scenario),partInputs:{...data.scenario.partInputs,'root-part':{...data.scenario.partInputs['root-part'],params:{style:'RC',quality:'commercial'}}}}}]}})
}
window.sharedBrowser={project,shared,model,snapshot:()=>project.getProjectState(),view:(id)=>{
 const modules=project.getProjectState().modules
 return model.materializePrediction(modules.systemDefinition,modules.prediction.folios.find(f=>f.id===id).state,initial)}}
function App(){const [workspace,setWorkspace]=useState('system')
 return <KeyboardShortcutProvider><ReportAssetScopeProvider value={{module:workspace==='system'?'systemDefinition':'prediction',moduleLabel:workspace}}>
 <div className="perdura-theme flex h-screen min-h-0 flex-col"><nav><button onClick={()=>setWorkspace('system')}>Open system workspace</button><button onClick={()=>setWorkspace('prediction')}>Open prediction workspace</button></nav>
 {workspace==='system'?<SystemDefinition/>:<Prediction/>}</div>
 </ReportAssetScopeProvider></KeyboardShortcutProvider>}
createRoot(document.getElementById('root')).render(<App/>)
`
const vite = await createServer({ root, cacheDir, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [{
 name: 'shared-system-fixture', resolveId(id) { if (id === route) return id }, load(id) { if (id === route) return fixture },
 configureServer(server) { server.middlewares.use('/__shared-system', async (req, res, next) => {
  if (!['/', ''].includes(req.url?.split('?')[0])) return next()
  res.setHeader('Content-Type', 'text/html')
  res.end(await server.transformIndexHtml('/__shared-system', '<!doctype html><html lang="en"><head><title>Shared system regression</title></head><body><div id="root"></div><script type="module" src="/__shared-system.tsx"></script></body></html>'))
 }) }
}] })
let browser
const errors = [], checks = []
try {
 await vite.listen(); browser = await chromium.launch({ headless: true })
 const page = await browser.newPage({ viewport: { width: 1800, height: 1050 } })
 page.on('pageerror', error => errors.push(error.message))
 page.on('dialog', dialog => dialog.accept())
 await page.route(url => url.pathname.startsWith('/api/'), route => {
  const path = route.request().url()
  const body = path.endsWith('/prediction/options') ? { environments: [], nonoperating_environments: [], nonoperating_models: {}, nonoperating_automatic_models: {}, standards: [], categories: [] }
   : path.endsWith('/prediction/derating-standards') ? []
   : path.includes('parts-count') ? { parts: [] } : {}
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
 })
 await page.goto('http://127.0.0.1:' + vite.httpServer.address().port + '/__shared-system')
 await page.getByLabel('Show piece parts').waitFor({ timeout: 90000 })
 await expect(page.getByRole('button', { name: 'Select Root part, level 2', exact: true })).toHaveCount(0)
 await page.getByLabel('Show piece parts').check()
 for (const [name, level] of [['Root part', 2], ['Assembly part', 3], ['Nested part', 4]])
  await expect(page.getByRole('button', { name: `Select ${name}, level ${level}`, exact: true })).toBeVisible()
 await page.getByRole('button', { name: 'Select Root part, level 2', exact: true }).click()
 await page.getByLabel('Installed name', { exact: true }).fill('Root part renamed')
 await page.getByLabel('Quantity', { exact: true }).fill('3')
 await expect.poll(() => page.evaluate(() => window.sharedBrowser.view('two').parts.find(p => p.id === 'root-part').quantity)).toBe(3)
 await page.screenshot({ path: join(output, 'system-shared-edit.png') })
 checks.push('One root; parts hidden by default and visible at every indenture; system edits update both scenarios')
 await page.getByRole('button', { name: 'Open prediction workspace', exact: true }).click()
 await page.getByRole('tab', { name: /Parts List/ }).click()
 await expect(page.locator('[id^="prediction-part-row-"]')).toHaveCount(3)
 await page.locator('#prediction-part-row-0 input[type=number]').fill('4')
 await expect.poll(() => page.evaluate(() => window.sharedBrowser.snapshot().modules.systemDefinition.model.instances.find(i => i.id === 'root-part').quantity)).toBe(4)
 await page.getByRole('button', { name: /^Scenario two/ }).click()
 await expect(page.locator('#prediction-part-row-0 input[type=number]')).toHaveValue('4')
 assert.deepEqual(await page.evaluate(() => ['one','two'].map(id => window.sharedBrowser.view(id).parts.find(p => p.id === 'root-part').params.style)), ['RW', 'RC'])
 await page.screenshot({ path: join(output, 'prediction-shared-edit.png') })
 checks.push('Prediction edits update canonical quantities; scenarios retain independent model parameters')
 const downloadPromise = page.waitForEvent('download')
 await page.getByRole('button', { name: 'Export', exact: true }).click()
 const download = await downloadPromise
 const bundle = unzipSync(new Uint8Array(await readFile(await download.path())))
 const artifactPath = Object.keys(bundle).find(path => path.endsWith('prediction_scenarios.json'))
 assert.ok(artifactPath, 'broker package contains the intended portable scenario artifact')
 assert.ok(bundle[artifactPath + '.perdura.json'], 'broker package retains its verification manifest')
 const downloaded = JSON.parse(strFromU8(bundle[artifactPath]))
 assert.equal(downloaded.schemaVersion, 9)
 assert.ok(downloaded.modules.systemDefinition.model.root_instance_id)
 assert.equal(downloaded.modules.prediction.folios.length, 2)
 assert.ok(downloaded.modules.prediction.folios.every(f => f.state.scenarioVersion === 1 && !('parts' in f.state)))
 await writeFile(join(output, 'prediction_scenarios.json'), JSON.stringify(downloaded, null, 2))
 await page.evaluate(async () => { await window.sharedBrowser.project.flushProjectPersistence() })
 await page.reload()
 await page.getByLabel('Show piece parts').waitFor({ timeout: 90000 })
 await expect.poll(() => page.evaluate(() => window.sharedBrowser.view('one').parts.find(p => p.id === 'root-part').quantity)).toBe(4)
 assert.equal(await page.evaluate(() => window.sharedBrowser.snapshot().modules.prediction.folios.length), 2)
 checks.push('Actual JSON download carries canonical model and scenario maps; IndexedDB reload retains shared edits')
 assert.deepEqual(errors, [])
 await writeFile(join(output, 'report.json'), JSON.stringify({ status: 'passed', checks }, null, 2))
 console.log('PASS shared System Definition/Prediction browser editing, isolation, export and persistence')
} catch (error) {
 await writeFile(join(output, 'failure.json'), JSON.stringify({ error: String(error), errors, checks }, null, 2)); throw error
} finally { await browser?.close(); await closeViteTestServer(vite, cacheDir) }
