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
const output = resolve(outputOption < 0 ? join(tmpdir(), 'perdura-inventory-ram-browser') : process.argv[outputOption + 1])
await mkdir(output, { recursive: true })
const cache = await mkdtemp(join(tmpdir(), 'perdura-inventory-ram-vite-'))
const entry = '/__inventory-ram.tsx'
const fixture = `
import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import '/src/index.css'
import Maintenance from '/src/components/Maintenance'
import {KeyboardShortcutProvider} from '/src/components/shared/KeyboardShortcuts'
import {ReportAssetScopeProvider} from '/src/components/shared/ReportAssetScope'
import {enumerateAssets} from '/src/store/assetExtractors'
import * as project from '/src/store/project'
await project.hydrateProjectStorage();project.newProject('Inventory and RAM browser fixture')
function Fixture(){const[units,setUnits]=project.useUnits(),[mounted,setMounted]=useState(true);window.inventoryRamTest={project,enumerateAssets};return <KeyboardShortcutProvider><ReportAssetScopeProvider value={{module:'ram',moduleLabel:'Maintenance'}}><div className="perdura-theme flex h-screen flex-col"><nav><button onClick={()=>setMounted(x=>!x)}>Toggle maintenance</button>{['days','hours'].map(to=><button key={to} onClick={()=>{project.convertProjectUnits(units,to);setUnits(to)}}>Convert to {to}</button>)}</nav>{mounted&&<Maintenance/>}</div></ReportAssetScopeProvider></KeyboardShortcutProvider>}
createRoot(document.getElementById('root')).render(<Fixture/>)
`

const vite = await createServer({ root, cacheDir: cache, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [{
  name: 'lifecycle-fixture', resolveId(id) { if (id === entry) return id }, load(id) { if (id === entry) return fixture },
  configureServer(server) {
    server.middlewares.use('/__inventory-ram', async (req, res, next) => {
      if (req.url !== '/' && req.url !== '') return next()
      res.setHeader('Content-Type', 'text/html')
      res.end(await server.transformIndexHtml('/__inventory-ram', `<!doctype html><html lang="en"><head><title>Lifecycle assurance</title></head><body><main id="root"></main><script type="module" src="${entry}"></script></body></html>`))
    })
  },
}] })
const python = process.env.PERDURA_PYTHON ?? resolve(repo, '.venv/bin/python')
const child = spawn(python, ['-u', '-c', `
import json,sys
from routers import ram,inventory
print(json.dumps({'ready':True}))
for line in sys.stdin:
    p=json.loads(line)
    try:
        kind=p['kind']; body=p['body']
        if kind=='availability': out=ram.availability(ram.AvailabilityRequest(**body))
        elif kind=='maintainability': out=ram.maintainability(ram.MaintainabilityRequest(**body))
        elif kind=='plan': out=inventory.plan(inventory.InventoryRequest(**body))
        else: raise ValueError(kind)
        print(json.dumps({'id':p['id'],'result':out},allow_nan=False))
    except Exception as error:
        print(json.dumps({'id':p['id'],'error':str(error)}))
`], { cwd: repo, env: { ...process.env, PYTHONPATH: join(repo, 'src') + ':' + join(repo, 'gui/backend'), MPLCONFIGDIR: join(tmpdir(), 'perdura-inventory-ram-mpl') },
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
let nextPlanHold
const planHolds = []
function holdNextPlan() {
  const hold = { ready: false }
  hold.promise = new Promise(resolve => { hold.release = resolve })
  nextPlanHold = hold
  planHolds.push(hold)
  return hold
}
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
    const held = kind === 'plan' ? nextPlanHold : null
    if (held) nextPlanHold = undefined
    try {
      const result = await calculate(kind, body)
      request.result = result
      if (held) { held.ready = true; await held.promise }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) })
    } catch (error) {
      errors.push(String(error))
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: String(error) }) })
    }
  })
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__inventory-ram`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  const state = () => page.evaluate(() => window.inventoryRamTest.project.getProjectState().modules)
  const run = page.getByRole('button',{name:'Compute',exact:true})
  await run.waitFor({timeout:90000})
  for(const [label,value] of [['MTBF','200'],['MTTR','2'],['MTBM (optional)','100'],['Mean active maintenance time','10'],['Admin delay','0'],['Logistics delay','0']]) await page.getByLabel(label,{exact:true}).fill(value)
  await run.click()
  await expect.poll(async()=>Boolean((await state()).ram?.avail?.result),{timeout:90000}).toBe(true)
  const availability=(await state()).ram.avail.result
  assert.ok(Math.abs(availability.achieved-100/110)<1e-12)
  assert.equal(availability.operational,availability.achieved)
  await page.getByText('Uptime / downtime trade space',{exact:true}).click()
  await page.screenshot({path:join(output,'availability.png'),fullPage:true})
  checks.push('All-maintenance availability uses the same uptime and active downtime for Aa and Ao')
  await page.getByRole('tab',{name:'Maintainability',exact:true}).click()
  await page.getByRole('combobox',{name:'Repair-time input'}).selectOption('data')
  await page.getByLabel('Repair-time samples (hours)',{exact:true}).fill('2 4 8\n')
  await run.click()
  await expect.poll(async()=>(await state()).ram.maint.result?.fitted?.sample_size).toBe(3)
  await page.getByLabel('Repair-time samples (hours)',{exact:true}).fill('2 bad 8\n')
  const before=requests.length
  await run.click(); await expect(page.getByRole('alert')).toContainText('positive finite number')
  assert.equal(requests.length,before)
  await page.getByRole('combobox',{name:'Repair-time input'}).selectOption('frequency')
  await page.getByLabel('Duration, frequency — one pair per row',{exact:true}).fill('2,4\n4,2\n')
  await run.click(); await expect.poll(async()=>(await state()).ram.maint.result?.fitted?.sample_size).toBe(6)
  await page.getByRole('combobox',{name:'Repair-time view'}).selectOption('exceedance')
  await expect(page.getByText('Repair exceedance probability',{exact:true})).toBeVisible()
  await page.getByRole('combobox',{name:'Repair-time input'}).selectOption('exponential')
  await page.getByLabel('MTTR (hours)',{exact:true}).fill('4')
  await run.click();await expect.poll(async()=>(await state()).ram.maint.result?.mct).toBe(4)
  assert.ok(Math.abs((await state()).ram.maint.result.mmax+4*Math.log(.05))<1e-10)
  await page.screenshot({path:join(output,'maintainability.png'),fullPage:true})
  checks.push('Raw trailing newline, invalid-token refusal, weighted repair frequencies and exponential MTTR')
  await page.getByRole('tab',{name:'Inventory Planning',exact:true}).click()
  await page.getByRole('combobox',{name:'Planning basis'}).selectOption('lifetime')
  await page.getByLabel('Planning horizon (hours)',{exact:true}).fill('43800')
  await page.getByRole('button',{name:'Add part',exact:true}).click()
  await page.getByLabel('Part pn',{exact:true}).fill('Pump')
  for(const [key,value] of [['quantity','100'],['rate','.00002'],['stock','3'],['cost','500']]) await page.getByLabel(`Pump ${key}`,{exact:true}).fill(value)
  await page.getByText('Pump — demand, repairs and service dates',{exact:true}).click()
  await page.getByLabel('Successful repair probability',{exact:true}).fill('.8')
  const plan=page.getByRole('button',{name:'Plan inventory',exact:true})
  await plan.click();await expect.poll(async()=>Boolean((await state()).maintInventory?.result),{timeout:90000}).toBe(true)
  const inventory=(await state()).maintInventory.result
  assert.equal(inventory.rows[0].required_stock,25)
  assert.equal(inventory.purchase_quantity,22)
  assert.equal(inventory.purchase_cost,11000)
  const downloadPromise=page.waitForEvent('download')
  await page.getByRole('button',{name:'Export plan',exact:true}).click()
  await (await downloadPromise).saveAs(join(output,'inventory-plan.json'))
  await page.screenshot({path:join(output,'inventory.png'),fullPage:true})
  const assets=await page.evaluate(()=>window.inventoryRamTest.enumerateAssets().filter(a=>a.module==='maintInventory').map(a=>({label:a.label,type:a.type,data:a.getData()})))
  assert.ok(assets.some(a=>a.type==='metrics'))
  assert.ok(assets.some(a=>a.type==='table'&&JSON.stringify(a.data).includes('Pump')))
  await writeFile(join(output,'inventory-assets.json'),JSON.stringify(assets,null,2))
  await page.getByRole('button',{name:'Toggle maintenance',exact:true}).click();await page.getByRole('button',{name:'Toggle maintenance',exact:true}).click()
  await expect(page.getByRole('combobox',{name:'Planning basis'})).toHaveValue('lifetime')
  assert.equal((await state()).maintInventory.result.purchase_cost,11000)
  await page.getByRole('button',{name:'Convert to days',exact:true}).click()
  await expect(page.getByLabel('Planning horizon (days)',{exact:true})).toHaveValue('1825')
  assert.equal((await state()).maintInventory.result,undefined)
  await plan.click();await expect.poll(async()=>Boolean((await state()).maintInventory?.result),{timeout:90000}).toBe(true)
  assert.equal((await state()).maintInventory.result.rows[0].required_stock,25)
  assert.equal((await state()).maintInventory.result.purchase_cost,11000)
  checks.push('Lifetime inventory stock/cost, JSON export, report assets, remount persistence and hours-to-days recomputation')
  // Hold actual computed responses to exercise request ownership independently
  // of network speed. The second row lets focus change the persisted selection.
  await page.getByRole('button',{name:'Add part',exact:true}).click()
  await page.getByLabel('Part pn',{exact:true}).fill('View-only row')
  await page.getByLabel('View-only row rate',{exact:true}).fill('0')
  await page.evaluate(()=>window.inventoryRamTest.project.setModuleState('prediction',{
    _folioWrap:true,activeId:'chooser-only',folios:[{id:'chooser-only',name:'Chooser-only scenario',state:{scenarioVersion:1,partInputs:{},blockInputs:{}}}],
  }))
  const selectedBefore=(await state()).maintInventory.selectedId
  const viewOnly=holdNextPlan()
  await plan.click(); await expect.poll(()=>viewOnly.ready).toBe(true)
  await page.getByLabel('Pump pn',{exact:true}).focus()
  await page.getByRole('combobox',{name:'Prediction scenario',exact:true}).selectOption('chooser-only')
  assert.notEqual((await state()).maintInventory.selectedId,selectedBefore)
  assert.equal((await state()).maintInventory.scenarioId,'chooser-only')
  viewOnly.release()
  await expect(plan).toBeEnabled()
  await expect.poll(async()=>(await state()).maintInventory.result?.purchase_cost).toBe(11000)
  assert.equal((await state()).maintInventory.result.rows.length,2)
  checks.push('Delayed inventory result survives selected-row focus and scenario-chooser changes')

  // A mathematical edit must discard a response even though its calculation
  // succeeded. The obsolete result must not overwrite the edited horizon.
  await page.getByLabel('Planning horizon (days)',{exact:true}).fill('1826')
  const changedInput=holdNextPlan()
  await plan.click(); await expect.poll(()=>changedInput.ready).toBe(true)
  await page.getByLabel('Planning horizon (days)',{exact:true}).fill('1825')
  changedInput.release(); await expect(plan).toBeEnabled()
  assert.equal((await state()).maintInventory.result,null)
  assert.equal((await state()).maintInventory.horizon,'1825')

  const changedUnits=holdNextPlan()
  await plan.click(); await expect.poll(()=>changedUnits.ready).toBe(true)
  await page.getByRole('button',{name:'Convert to hours',exact:true}).click()
  await expect(page.getByLabel('Planning horizon (hours)',{exact:true})).toHaveValue('43800')
  changedUnits.release(); await expect(plan).toBeEnabled()
  assert.equal(Boolean((await state()).maintInventory.result),false)

  // Restore identical mathematical inputs in a new project, making project
  // identity the only difference that can reject the old pending response.
  const changedProject=holdNextPlan()
  await plan.click(); await expect.poll(()=>changedProject.ready).toBe(true)
  const identities=await page.evaluate(()=>{
    const api=window.inventoryRamTest.project, before=api.getProjectState()
    const snapshot=structuredClone(before.modules.maintInventory)
    api.newProject('Different project during inventory request')
    api.setModuleState('maintInventory',{...snapshot,result:null})
    return [before.identity.projectId,api.getProjectState().identity.projectId]
  })
  assert.notEqual(identities[0],identities[1])
  changedProject.release(); await expect(plan).toBeEnabled()
  assert.equal((await state()).maintInventory.result,null)
  checks.push('Delayed inventory results are discarded after mathematical edits, unit changes and new-project identity')
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, browser: browser.version(), requests: requests.length }, null, 2))
  console.log(JSON.stringify({ status: 'passed', checks, output }, null, 2))
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  await writeFile(join(output, 'report.json'), JSON.stringify({ status: 'failed', error: String(error), errors, checks, requests,
    body: await page?.locator('body').innerText().catch(() => null) }, null, 2))
  throw error
} finally {
  for (const hold of planHolds) hold.release()
  child.stdin.end()
  child.kill()
  await browser?.close()
  await closeViteTestServer(vite, cache)
}
