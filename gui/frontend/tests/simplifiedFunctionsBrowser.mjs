/** The actual System Modeling workspace: minimal function authoring and inferred connections. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { closeViteTestServer } from './viteTestLifecycle.mjs'
const outputArg = process.argv.indexOf('--output-dir')
const output = outputArg < 0 ? join(tmpdir(), 'perdura-simplified-functions') : resolve(process.argv[outputArg + 1])
await mkdir(output, { recursive: true })
const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-simple-functions-vite-'))
const route = '/__simplified_functions.tsx'
const fixture = `
import React from 'react';import {createRoot} from 'react-dom/client';import '/src/index.css'
import SystemDefinition from '/src/components/SystemDefinition'
import {KeyboardShortcutProvider} from '/src/components/shared/KeyboardShortcuts'
import {ReportAssetScopeProvider} from '/src/components/shared/ReportAssetScope'
import {ToastViewport} from '/src/components/shared/toast'
import * as project from '/src/store/project'
import {createProjectSystem} from '/src/store/sharedSystemModel'
import {effectiveSystemFunctions} from '/src/store/systemArchitecture'
import {commitProjectSystem,currentProjectSystem} from '/src/store/sharedSystem'
await project.hydrateProjectStorage();project.newProject('Simple functions regression')
const state=createProjectSystem('Aircraft'),model=state.model
model.definitions[0].functions=[{id:'root-state',description:'Maintain aircraft operation',function_type:'primary',mode_ids:[],definition:{role:'maintain_state',action:'aircraft operation',state_verb:'maintain',io:[]}}]
for(const[id,name]of[['supply','Power supply'],['motor','Motor'],['connector','Connector']]){
model.definitions.push({...structuredClone(model.definitions[0]),id:id+'-definition',name,kind:'subsystem',functions:[],failure_modes:[]})
model.instances.push({...structuredClone(model.instances[0]),id,definition_id:id+'-definition',name,parent_instance_id:model.root_instance_id})}
model.instances.push({...structuredClone(model.instances.find(i=>i.id==='supply')),id:'spare-supply',name:'Spare power supply'})
state.view='functions';state.selectedInstanceId='supply';project.setModuleState('systemDefinition',state)
window.simpleFunctions={snapshot:()=>project.getProjectState().modules.systemDefinition.model,effective:(id)=>effectiveSystemFunctions(project.getProjectState().modules.systemDefinition.model,id),prepareRoutes:()=>{
const current=currentProjectSystem();commitProjectSystem({...current,model:{...current.model,interfaces:['Harness A','Harness B'].map((name,index)=>({id:'route-'+index,name,interface_type:'energy',source:{instance_id:'supply'},target:{instance_id:'motor'},directionality:'directed',linkage:'direct',interface_detail:'',flow_description:'',operating_condition:'',source_function_ids:[],target_function_ids:[],mode_ids:[],transfers:[]}))}})
},removeParentSupport:()=>{const current=currentProjectSystem();project.setModuleState('systemDefinition',{...current,model:{...current.model,function_links:current.model.function_links.filter(link=>link.relationship!=='decomposes_to'||link.target.instance_id!=='motor')}})}}
createRoot(document.getElementById('root')).render(<KeyboardShortcutProvider><ReportAssetScopeProvider value={{module:'systemDefinition',moduleLabel:'System Modeling'}}>
<div className="perdura-theme flex h-screen min-h-0 flex-col"><SystemDefinition/></div><ToastViewport/></ReportAssetScopeProvider></KeyboardShortcutProvider>)
`
const vite = await createServer({ root: new URL('..', import.meta.url).pathname, cacheDir, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false },
  plugins: [{ name: 'simple-functions-browser', resolveId(id) { if (id === route) return id }, load(id) { if (id === route) return fixture },
    configureServer(server) { server.middlewares.use('/__simple_functions', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml('/__simple_functions', `<!doctype html><html lang="en"><head><title>Function authoring</title></head><body><div id="root"></div><script type="module" src="${route}"></script></body></html>`))
    }) } }],
})
let browser, page
const checks = [], errors = []
try {
  await vite.listen(); browser = await chromium.launch({ headless: true }); page = await (await browser.newContext({ viewport: { width: 1440, height: 1080 } })).newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__simple_functions`)
  const editor = page.getByRole('region', { name: 'Installed functions and failures' })
  await expect(editor.getByRole('button', { name: 'Add function', exact: true })).toBeVisible({ timeout: 90000 })
  await expect(page.getByText('Functional dependencies', { exact: true })).toHaveCount(0)
  await editor.getByRole('button', { name: 'Add function', exact: true }).click()
  await editor.getByLabel('Function kind').selectOption('source')
  await editor.getByLabel('Function action').fill('Generate electrical power')
  await editor.getByLabel('Output resource', { exact: true }).fill('DC supply')
  await editor.getByLabel('Resource category').selectOption('energy')
  await expect(editor.getByText(/Supports.*Aircraft/)).toBeVisible()
  assert.equal(await page.evaluate(() => window.simpleFunctions.effective('spare-supply').length), 0)
  assert.equal(await page.evaluate(() => window.simpleFunctions.snapshot().function_links.filter(link => link.relationship === 'decomposes_to' && link.target.instance_id === 'supply').length), 1)
  const sourceResource = await page.evaluate(() => window.simpleFunctions.effective('supply')[0].definition.io[0].resource_id)
  checks.push('Source authoring creates one owned output atomically, allocates its parent, and does not change another installed occurrence')
  await page.getByRole('button', { name: /^Motor L2$/ }).click()
  await editor.getByRole('button', { name: 'Add function', exact: true }).click()
  await editor.getByLabel('Function action').fill('Convert electricity into rotation')
  await editor.getByLabel('Output resource', { exact: true }).fill('Shaft rotation')
  await editor.getByLabel('Resource category').selectOption('physical')
  await editor.getByRole('button', { name: 'Add input', exact: true }).click()
  await editor.getByRole('button', { name: 'Input 1', exact: true }).click()
  await page.getByRole('dialog', { name: 'Choose input resource' }).getByRole('button', { name: 'Power supply', exact: true }).click()
  await page.getByRole('dialog', { name: 'Choose input resource' }).getByRole('button', { name: 'Use DC supply', exact: true }).click()
  assert.equal(await page.evaluate(() => window.simpleFunctions.effective('motor')[0].definition.io.find(io => io.direction === 'input').resource_id), sourceResource)
  assert.equal(await page.evaluate(() => window.simpleFunctions.snapshot().interfaces.filter(edge => edge.source.instance_id === 'supply' && edge.target.instance_id === 'motor').length), 1)
  assert.equal(await page.evaluate(() => window.simpleFunctions.snapshot().interfaces[0].transfers[0].resource_id), sourceResource)
  checks.push('An exact producer-labelled input creates a typed interface and preserves its output resource identity')
  await editor.getByRole('button', { name: '+ Missing output', exact: true }).click()
  await editor.getByLabel('Failure description', { exact: true }).fill('Motor provides no shaft rotation when commanded')
  assert.equal(await page.evaluate(() => window.simpleFunctions.snapshot().definitions.find(d => d.id === 'motor-definition').failure_modes.length), 1)
  await expect(editor.getByText('Deviation ID', { exact: true })).toHaveCount(0)
  await editor.getByRole('button', { name: 'Add function', exact: true }).click()
  await expect(editor.getByLabel('Function kind')).toHaveCount(1)
  await editor.getByLabel('Function kind').selectOption('maintain_state')
  await editor.getByLabel('Condition to maintain').fill('secure attachment')
  await expect(editor.getByLabel('Output resource', { exact: true })).toHaveCount(0)
  assert.equal(await page.evaluate(() => window.simpleFunctions.effective('motor')[1].definition.io.length), 0)
  checks.push('Failures are opt-in with editable descriptions; one function expands at a time and Maintain State requires no resources')
  await editor.getByRole('button', { name: /Convert electricity into rotation/ }).click()
  await editor.getByRole('button', { name: 'Remove input 1', exact: true }).click()
  assert.equal(await page.evaluate(() => window.simpleFunctions.snapshot().interfaces.length), 0)
  assert.equal(await page.evaluate(() => window.simpleFunctions.snapshot().definitions.find(d => d.id === 'motor-definition').failure_modes.length), 1)
  checks.push('Removing an input removes its generated route while retaining authored failure work')
  await page.evaluate(() => window.simpleFunctions.prepareRoutes())
  await editor.getByRole('button', { name: 'Add input', exact: true }).click()
  await editor.getByRole('button', { name: 'Input 1', exact: true }).click()
  await page.getByRole('dialog', { name: 'Choose input resource' }).getByRole('button', { name: 'Power supply', exact: true }).click()
  await page.getByRole('dialog', { name: 'Choose input resource' }).getByRole('button', { name: 'Use DC supply', exact: true }).click()
  await expect(editor.getByLabel('Choose the interface for this input')).toBeVisible()
  assert.equal(await page.evaluate(() => window.simpleFunctions.snapshot().interfaces.flatMap(edge => edge.transfers).length), 0)
  await editor.getByLabel('Choose the interface for this input').selectOption('route-1')
  assert.equal(await page.evaluate(() => window.simpleFunctions.snapshot().interfaces.find(edge => edge.id === 'route-1').transfers.length), 1)
  await editor.getByRole('button', { name: 'Remove input 1', exact: true }).click()
  assert.equal(await page.evaluate(() => window.simpleFunctions.snapshot().interfaces.length), 2)
  assert.equal(await page.evaluate(() => window.simpleFunctions.snapshot().interfaces.flatMap(edge => edge.transfers).length), 0)
  checks.push('Ambiguous routes require one explicit choice, and removing the input preserves manually authored interfaces')
  await page.evaluate(() => window.simpleFunctions.removeParentSupport())
  await expect(editor.getByText(/Suggested parent function/)).toBeVisible()
  assert.equal(await page.evaluate(() => window.simpleFunctions.snapshot().function_links.filter(link => link.relationship === 'decomposes_to' && link.target.instance_id === 'motor').length), 0)
  await editor.getByRole('button', { name: 'Use this function', exact: true }).click()
  await expect(editor.getByText(/Suggested parent function/)).toHaveCount(0)
  assert.equal(await page.evaluate(() => window.simpleFunctions.snapshot().function_links.filter(link => link.relationship === 'decomposes_to' && link.target.instance_id === 'motor').length), 2)
  checks.push('An imported draft with missing parent allocation presents an honest suggestion and a compact repair action')
  const accessibility = await new AxeBuilder({ page }).include('[aria-label="Installed functions and failures"]').analyze()
  assert.deepEqual(accessibility.violations.map(item => ({ id: item.id, nodes: item.nodes.length })), [])
  assert.deepEqual(errors, [])
  await page.screenshot({ path: join(output, 'functions.png'), fullPage: true })
  await writeFile(join(output, 'browser.json'), JSON.stringify({ checks, errors, violations: accessibility.violations }, null, 2))
  console.log(JSON.stringify({ status: 'passed', checks, output }, null, 2))
} catch (error) { if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {}); console.error('Browser errors:', errors); throw error }
finally { await browser?.close(); await closeViteTestServer(vite, cacheDir) }
