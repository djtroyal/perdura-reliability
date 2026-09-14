import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { closeViteTestServer } from './viteTestLifecycle.mjs'

// A self-contained browser fixture mounts the production shared components.
// No snapshots of their markup or assumptions about component internals.
const root = fileURLToPath(new URL('..', import.meta.url))
const route = '/__shared-accessibility.tsx'
const outputIndex = process.argv.indexOf('--output-dir')
const outputDir = resolve(outputIndex < 0 ? join(tmpdir(), 'perdura-shared-accessibility') : process.argv[outputIndex + 1])
await mkdir(outputDir, { recursive:true })
const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-shared-vite-'))
const fixture = `
import React, { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '/src/index.css'
import DataTable from '/src/components/shared/DataTable'
import ResultsTable from '/src/components/shared/ResultsTable'
import ModelDataGrid from '/src/components/DataModeling/ModelDataGrid'
import { Tabs } from '/src/components/shared/ui'
import FolioBar from '/src/components/shared/FolioBar'
import ExportablePlot from '/src/components/shared/ExportablePlot'
import PlotDataView from '/src/components/shared/PlotDataView'
import { useFocusTrap } from '/src/components/shared/useDialog'
import { useDisplayDensity } from '/src/components/shared/useDisplayDensity'
import StructureTable from '/src/components/SystemDefinition/StructureTable'
import { emptySystemDefinition } from '/src/components/SystemDefinition/model'
function Fixture() {
  const [rows, setRows] = useState([{ time: '2', status: 'F' }, { time: '1', status: 'C' }])
  const [selected, select] = useState('')
  const [modelRows,setModelRows]=useState(Array.from({length:180},(_,index)=>({Value:String(180-index),Note:'Sample '+(index+1)})))
  const [open, setOpen] = useState(false), [nested, setNested] = useState(false)
  const [text, setText] = useState('')
  const dialog = useRef(null), child = useRef(null)
  useFocusTrap(dialog, open, () => setOpen(false))
  useFocusTrap(child, nested, () => setNested(false))
  const [density, setDensity] = useDisplayDensity()
  const [activeId, activate] = useState('a')
  const [folios, setFolios] = useState([{ id:'a', name:'Alpha', dirty:true }, { id:'b', name:'Beta', dirty:false }])
  const api = { moduleKey:'fixture', activeId, folios, select:activate,
    add:() => { setFolios(v => [...v, { id:'c', name:'Gamma', dirty:false }]); activate('c') },
    remove:id => { setFolios(v => v.filter(f => f.id !== id)); activate(id === 'a' ? 'b' : 'a') },
    rename:() => {} }
  const [collapsed, collapse] = useState([]), [element, selectElement] = useState('root')
  const model = emptySystemDefinition().model
  model.definitions = [{ id:'d', name:'Pump', kind:'assembly', classification:'component' }]
  model.instances = [
    { id:'root', definition_id:'d', name:'Plant', quantity:1 },
    { id:'child', definition_id:'d', name:'Pump', quantity:2, parent_instance_id:'root' },
    { id:'grandchild', definition_id:'d', name:'Valve', quantity:1, parent_instance_id:'child' },
  ]
  return <div className="perdura-theme p-4"><h1>Shared accessibility fixture</h1>
    <label>Density<select value={density} onChange={e => setDensity(e.target.value)}><option value="compact">Compact</option><option value="comfortable">Comfortable</option></select></label>
    <section aria-label="Data entry"><DataTable columns={[{ key:'time', label:'Time', type:'number' }, { key:'status', label:'Status', type:'select', options:[{value:'F',label:'Failure'}, {value:'C',label:'Censored'}] }]} rows={rows} onChange={setRows}/><button className="secondary-button">After data entry</button></section>
    <section aria-label="Results"><ResultsTable sortable highlightFirst={false} columns={[{key:'id',label:'Model'},{key:'score',label:'Score'}]} rows={[{id:'Weibull',score:2},{id:'Exponential',score:1}]} rowKey="id" selectedRow={selected} onRowClick={r => select(r.id)}/></section>
    <section aria-label="Model grid"><ModelDataGrid columns={["Value","Note"]} rows={modelRows} onRowsChange={setModelRows} onColumnsChange={()=>{}} maxBodyHeight="240px"/><button className="secondary-button">After model grid</button></section>
    <section aria-label="Shared tabs"><Tabs tools={[{id:'first',label:'First',render:()=> <button>First action</button>},{id:'second',label:'Second',render:()=> <button>Second action</button>}]}/></section>
    <FolioBar api={api}/>
    <button onClick={() => setOpen(true)}>Open dialog</button>
    {open && <div ref={dialog} role="dialog" aria-modal="true" aria-label="Outer" className="fixed inset-20 z-50 bg-white p-4">
      <label>Dialog value<input value={text} onChange={e => setText(e.target.value)}/></label>
      <button onClick={() => setNested(true)}>Open nested dialog</button>
      <button onClick={() => setOpen(false)}>Close dialog</button>
    </div>}
    {nested && <div ref={child} role="dialog" aria-modal="true" aria-label="Inner" className="fixed inset-24 z-[60] bg-white p-4"><button onClick={() => setNested(false)}>Close nested dialog</button></div>}
    <section aria-label="Structure"><StructureTable model={model} selectedId={element} collapsedIds={collapsed} onSelect={selectElement} onToggle={id => collapse(v => v.includes(id) ? v.filter(i => i !== id) : [...v,id])} onChangeParent={()=>{}}/></section>
    <div style={{ width:600,maxWidth:"100%" }}><ExportablePlot data={[{ type:'scatter',name:'Reliability',x:Array.from({length:61},(_,i)=>i),y:Array.from({length:61},(_,i)=>1-i/100),error_y:{type:'data',array:new Float64Array(61).fill(.1),arrayminus:new Float64Array(61).fill(.05),symmetric:false},error_x:{type:'constant',value:.25} }]} layout={{ title:{text:'Reliability over time'}, xaxis:{title:{text:'Time (hours)'}}, yaxis:{title:{text:'Reliability'}} }} style={{width:'100%',height:280}} config={{displayModeBar:false}} accessibleDescription="Reliability decreases from 1 to 0.4 over 60 hours."/></div>
    <PlotDataView label="Uncertainty examples" layout={{xaxis:{title:{text:"Calendar (days)"}},scene:{xaxis:{title:{text:"Temperature (K)"}}}}} data={[{name:'Percent uncertainty',type:'scatter3d',x:[1],y:[2],z:[3],error_z:{type:'percent',value:5,valueminus:2,symmetric:false}},{name:'Cartesian with hidden defaults',type:'scatter',x:[1],y:[2],error_y:{}},{name:'Unsupported DataView',type:'scatter',y:new DataView(new ArrayBuffer(8))}]}/>
  </div>
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`
const vite = await createServer({ root, cacheDir, optimizeDeps:{ entries:['index.html','src/components/SystemDefinition/StructureTable.tsx','src/components/shared/ExportablePlotInner.tsx'] }, logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'shared-accessibility-fixture',
  resolveId(id) { if (id === route) return id },
  load(id) { if (id === route) return fixture },
  configureServer(server) {
    server.middlewares.use('/__shared-accessibility', async (req, res, next) => {
      if (req.url !== '/' && req.url !== '') return next()
      res.setHeader('Content-Type', 'text/html')
      res.end(await server.transformIndexHtml('/__shared-accessibility', '<!doctype html><html lang="en"><head><title>Shared accessibility regression</title></head><body><main id="root"></main><script type="module" src="/__shared-accessibility.tsx"></script></body></html>'))
    })
  },
}] })
let browser
try {
  await vite.listen()
  const address = vite.httpServer.address()
  const base = `http://127.0.0.1:${address.port}`
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.on('console', message => { if (message.type() === 'error') console.error('Browser:', message.text()) })
  page.on('requestfailed', request => console.error('Request failed:',request.url(),request.failure()?.errorText))
  await page.route(/^https?:\/\/[^/]+\/api\//, route => route.abort())
  const errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  await page.goto(`${base}/__shared-accessibility`, { waitUntil:'domcontentloaded', timeout:60000 })

  await page.getByRole('heading', { name:'Shared accessibility fixture' }).waitFor({ timeout:60000 })
  const data = page.getByRole('region', { name: 'Data entry' })
  await expect(data.getByRole('textbox', { name: 'Time, row 1', exact:true })).toHaveValue('2')
  await data.getByRole('button', { name:'Sort by Time' }).focus()
  await page.keyboard.press('Enter')
  await expect(data.locator('tbody tr').first().getByRole('textbox')).toHaveValue('1')
  await expect(data.getByRole('columnheader', { name:'Sort by Time' })).toHaveAttribute('aria-sort','ascending')
  await data.getByRole('button', { name:'Delete row 1' }).focus()
  await page.keyboard.press('Tab')
  await expect(data.getByRole('button', {name:'+ Add row'})).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(data.getByRole('button', {name:'After data entry'})).toBeFocused()
  await expect(data.locator('tbody tr')).toHaveCount(2)
  await data.getByRole('button', {name:'+ Add row'}).click()
  await expect(data.getByRole('textbox',{name:'Time, row 3',exact:true})).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(data.getByRole('textbox',{name:'Time, row 2',exact:true})).toBeFocused()
  await data.getByRole('textbox',{name:'Time, row 1',exact:true}).focus()
  await page.keyboard.press('Enter')
  await expect(data.getByRole('textbox',{name:'Time, row 4',exact:true})).toBeFocused()
  await data.getByRole('button',{name:'Delete row 3'}).focus()
  await page.keyboard.press('Enter')
  await expect(data.locator('tbody tr')).toHaveCount(3)
  await expect(data.getByRole('textbox',{name:'Time, row 3',exact:true})).toBeFocused()
  const result = page.getByRole('region',{name:'Results'})
  await result.getByRole('button',{name:'Sort by Score'}).focus()
  await page.keyboard.press('Space')
  await expect(result.locator('tbody tr').first()).toContainText('Exponential')
  await result.getByRole('button',{name:'Select Exponential'}).focus()
  await page.keyboard.press('Enter')
  await expect(result.getByRole('button',{name:'Select Exponential'})).toHaveAttribute('aria-pressed','true')
  const modelGrid=page.getByRole('region',{name:'Model grid'})
  await modelGrid.getByRole('button',{name:'Sort column Value'}).focus()
  await page.keyboard.press('Enter')
  await expect(modelGrid.getByRole('textbox',{name:'Value, row 180',exact:true})).toHaveValue('1')
  await modelGrid.getByRole('textbox',{name:'Value, row 180',exact:true}).focus()
  await page.keyboard.press('Enter')
  await expect(modelGrid.getByRole('textbox',{name:'Value, row 179',exact:true})).toBeFocused()
  assert.ok(await modelGrid.locator('tbody tr[data-body-row]').count()<180,'large model grid stays windowed')
  await modelGrid.locator('table').evaluate(table=>{ const scroller=table.parentElement; scroller.scrollTop=scroller.scrollHeight })
  await modelGrid.getByRole('textbox',{name:'Value, row 1',exact:true}).waitFor()
  await modelGrid.getByRole('textbox',{name:'Value, row 1',exact:true}).focus()
  await page.keyboard.press('Enter')
  await expect(modelGrid.getByRole('textbox',{name:'Value, row 181',exact:true})).toBeFocused()
  await expect(modelGrid.getByRole('table')).toHaveAttribute('aria-rowcount','182')
  assert.ok(await modelGrid.locator('table').evaluate(table=>table.parentElement.scrollTop)<60,'new sorted row mounts at the top before focus')
  await modelGrid.locator('table').evaluate(table=>{const scroller=table.parentElement;scroller.scrollTop=scroller.scrollHeight})
  await modelGrid.getByRole('button',{name:'Remove row 1',exact:true}).focus()
  await page.keyboard.press('Tab')
  await expect(modelGrid.getByRole('button',{name:'+ Add row',exact:true})).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(modelGrid.getByRole('button',{name:'After model grid',exact:true})).toBeFocused()
  const tabs = page.getByRole('region',{name:'Shared tabs'})
  await tabs.getByRole('tab',{name:'First'}).focus()
  await page.keyboard.press('ArrowRight')
  await expect(tabs.getByRole('tab',{name:'Second'})).toBeFocused()
  await expect(tabs.getByRole('tabpanel',{name:'Second'})).toBeVisible()
  const panelId = await tabs.getByRole('tab',{name:'Second'}).getAttribute('aria-controls')
  assert.equal(await tabs.getByRole('tabpanel').getAttribute('id'),panelId)
  await page.getByRole('button',{name:'Alpha Recalculate'}).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('button',{name:'Beta',exact:true})).toBeFocused()
  await expect(page.getByRole('button',{name:'Beta',exact:true})).toHaveAttribute('aria-pressed','true')
  assert.equal(await page.locator('[role="toolbar"] button button').count(),0)
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button',{name:'Close analysis Beta'}).click()
  await expect(page.getByRole('button',{name:'Alpha Recalculate'})).toBeFocused()
  await page.getByRole('button',{name:'New analysis'}).click()
  await expect(page.getByRole('button',{name:'Gamma',exact:true})).toBeFocused()
  await page.getByRole('button',{name:'Open dialog',exact:true}).click()
  await expect(page.getByRole('textbox',{name:'Dialog value'})).toBeFocused()
  await page.getByRole('textbox',{name:'Dialog value'}).fill('123')
  await expect(page.getByRole('textbox',{name:'Dialog value'})).toBeFocused()
  assert.equal(await data.evaluate(el=>Boolean(el.closest('[inert]'))),true)
  await page.getByRole('button',{name:'Close dialog',exact:true}).focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('textbox',{name:'Dialog value'})).toBeFocused()
  await page.getByRole('button',{name:'Open nested dialog'}).click()
  await expect(page.getByRole('button',{name:'Close nested dialog'})).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button',{name:'Open nested dialog'})).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button',{name:'Open dialog',exact:true})).toBeFocused()
  assert.equal(await page.locator('[inert]').count(),0)
  const structure = page.getByRole('region',{name:'Structure'})
  await structure.getByRole('button',{name:'Collapse Plant',exact:true}).focus()
  await page.keyboard.press('Enter')
  await expect(structure.locator('tbody tr')).toHaveCount(1)
  await expect(structure.getByRole('button',{name:'Expand Plant'})).toHaveAttribute('aria-expanded','false')
  await page.keyboard.press('Enter')
  await expect(structure.locator('tbody tr')).toHaveCount(3)
  await structure.getByRole('button',{name:'Select Pump, level 2'}).click()
  await expect(structure.getByRole('button',{name:'Select Pump, level 2'})).toHaveAttribute('aria-pressed','true')
  await expect(structure.getByRole('combobox',{name:'Parent of Pump'})).toHaveValue('root')
  const summary = page.getByText('View data and description: Reliability over time',{exact:true})
  await summary.click()
  await expect(page.getByRole('table',{name:'Reliability supplied chart values'})).toBeVisible()
  await expect(page.getByText('1–50 of 61 values',{exact:true})).toBeVisible()
  const valuesTable=page.getByRole('table',{name:'Reliability supplied chart values'})
  await expect(valuesTable.getByRole('columnheader',{name:'X — Time (hours)',exact:true})).toBeVisible()
  await expect(valuesTable.getByRole('columnheader',{name:'Y error + (data)',exact:true})).toBeVisible()
  await expect(valuesTable.getByRole('columnheader',{name:'Y error − (data)',exact:true})).toBeVisible()
  await expect(valuesTable.locator('tbody tr').first()).toContainText('0.05')
  await expect(valuesTable.locator('tbody tr').first()).toContainText('0.25')
  await expect(page.getByText(/X axis: Time \(hours\). Y axis: Reliability./).last()).toBeVisible()
  await page.getByText('View data and description: Uncertainty examples',{exact:true}).click()
  await expect(page.getByRole('table',{name:'Percent uncertainty supplied chart values'}).locator('tbody tr')).toContainText('5%')
  await expect(page.getByRole('table',{name:'Percent uncertainty supplied chart values'}).locator('tbody tr')).toContainText('2%')
  await expect(page.getByText(/Unsupported DataView: no tabular values/)).toBeVisible()
  const cartesian=page.getByRole('table',{name:'Cartesian with hidden defaults supplied chart values'})
  await expect(cartesian.getByRole('columnheader',{name:'X — Calendar (days)',exact:true})).toBeVisible()
  await expect(cartesian.getByRole('columnheader',{name:'Y error ± (percent, hidden)',exact:true})).toBeVisible()
  await expect(page.getByRole('table',{name:'Percent uncertainty supplied chart values'}).getByRole('columnheader',{name:'X — Temperature (K)',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Next values for Reliability'}).click()
  await expect(page.getByText('51–61 of 61 values',{exact:true})).toBeVisible()
  await expect(page.getByRole('table',{name:'Reliability supplied chart values'}).locator('tbody tr').last()).toContainText('0.4')
  await page.getByRole('button',{name:'Open full-screen interactive plot'}).focus()
  await page.keyboard.press('Enter')
  const viewer = page.getByRole('dialog',{name:'Reliability over time full-screen viewer'})
  await expect(viewer).toBeVisible()
  assert.equal(await viewer.evaluate(el=>el.contains(document.activeElement)),true)
  await page.screenshot({path:join(outputDir,'chart-fullscreen.png')})
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button',{name:'Open full-screen interactive plot'})).toBeFocused()
  await page.screenshot({path:join(outputDir,'compact.png'),fullPage:true})
  await page.getByRole('combobox',{name:'Density',exact:true}).selectOption('comfortable')
  await expect(page.locator('html')).toHaveAttribute('data-density','comfortable')
  assert.equal(await data.getByRole('textbox').first().evaluate(el=>getComputedStyle(el).minHeight),'40px')
  await page.screenshot({path:join(outputDir,'comfortable.png'),fullPage:true})
  await page.reload()
  await expect(page.getByRole('combobox',{name:'Density',exact:true})).toHaveValue('comfortable')
  await page.emulateMedia({forcedColors:'active',reducedMotion:'reduce'})
  await data.getByRole('button',{name:'Sort by Time'}).focus()
  assert.notEqual(await data.getByRole('button',{name:'Sort by Time'}).evaluate(el=>getComputedStyle(el).outlineStyle),'none')
  const axe = await new AxeBuilder({page}).include('[aria-label="Data entry"]').include('[aria-label="Results"]').include('[aria-label="Model grid"]').include('[aria-label="Shared tabs"]').include('[aria-label="Structure"]').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()
  assert.deepEqual(axe.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[])
  await page.emulateMedia({ forcedColors:'none', reducedMotion:'reduce' })
  const reflow=[]
  for (const [scale,width,height] of [[200,640,450],[400,320,225]]) {
    await page.setViewportSize({width,height})
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth),{message:"Shared UI reflow at "+scale+"% equivalent",timeout:10000}).toBeLessThanOrEqual(width+1)
    const metrics=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth}))
    assert.ok(metrics.documentWidth<=metrics.width+1,'shared controls reflow at '+scale+'% equivalent width')
    const horizontal=structure.locator('table').locator('..')
    assert.ok(await horizontal.evaluate(el=>el.scrollWidth>el.clientWidth),'hierarchy uses local horizontal table scrolling')
    await horizontal.evaluate(el=>{el.scrollLeft=el.scrollWidth})
    assert.ok(await horizontal.evaluate(el=>el.scrollLeft)>0)
    await page.screenshot({path:join(outputDir,'reflow-'+scale+'.png'),fullPage:true})
    reflow.push({scale,width,height,...metrics,localTableScroll:true})
  }
  await page.setViewportSize({width:1280,height:900})
  await page.route(/^https?:\/\/[^/]+\/api\/v1\/version(?:\?|$)/, route => {
    const headers=route.request().headers(), contract=Number(headers['x-perdura-client-api-contract'])
    return route.fulfill({json:{version:headers['x-perdura-client-version'],commit:'dev',api_contract:contract,minimum_client_api_contract:contract,maximum_client_api_contract:contract}})
  })
  await page.goto(base+'/', {waitUntil:'domcontentloaded',timeout:60000})
  const modules=page.getByRole('tablist',{name:'Perdura modules'})
  await modules.getByRole('tab',{name:'Dashboard',exact:true}).waitFor({timeout:60000})
  await modules.getByRole('tab',{name:'Dashboard',exact:true}).focus()
  await page.keyboard.press('ArrowRight')
  await expect(modules.getByRole('tab',{name:'Life Data Analysis',exact:true})).toBeFocused()
  await expect(modules.getByRole('tab',{name:'Dashboard',exact:true})).toHaveAttribute('aria-selected','true')
  await expect(modules.getByRole('tab',{name:'Life Data Analysis',exact:true})).toHaveAttribute('aria-selected','false')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tabpanel',{name:'Life Data Analysis',exact:true})).toBeVisible()
  const observations=page.getByRole('table',{name:/^Life Data observations/})
  await observations.waitFor({timeout:60000})
  for (let count=await observations.locator('tbody tr').count(); count>3; count--) {
    await observations.getByRole('button',{name:'Delete row '+count,exact:true}).click()
    await expect(observations.locator('tbody tr')).toHaveCount(count-1)
  }
  for (const [row,id,time] of [[1,'z','2'],[2,'a','1'],[3,'m','3']]) {
    await observations.getByRole('textbox',{name:'ID, row '+row,exact:true}).fill(id)
    await observations.getByRole('textbox',{name:new RegExp('^Time.*row '+row+'$')}).fill(time)
  }
  await observations.getByRole('button',{name:'Sort by ID',exact:true}).focus()
  await page.keyboard.press('Enter')
  await expect(observations.locator('tbody tr').first().getByRole('textbox',{name:/^ID/})).toHaveValue('a')
  await observations.getByRole('button',{name:/^Row 1: Fail/}).focus()
  await page.keyboard.press('Enter')
  await expect(observations.getByRole('button',{name:/^Row 1: Susp/})).toBeFocused()
  await observations.getByRole('textbox',{name:/^Time.*row 1$/}).focus()
  await page.keyboard.press('Tab')
  await expect(observations.getByRole('button',{name:/^Row 1: Susp/})).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(observations.getByRole('button',{name:'Delete row 1',exact:true})).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button',{name:'Add row',exact:true})).toBeFocused()
  await expect(observations.locator('tbody tr')).toHaveCount(3)
  const analyses=page.getByRole('toolbar',{name:'Life Data analysis selection'})
  await analyses.getByRole('button',{name:'New analysis',exact:true}).click()
  await expect(analyses.locator('button[aria-pressed="true"]')).toBeFocused()
  page.once('dialog',dialog=>dialog.accept())
  await analyses.getByRole('button',{name:/^Close analysis/}).last().click()
  await expect(analyses.locator('button[aria-pressed="true"]')).toBeFocused()
  await page.screenshot({path:join(outputDir,'life-data-keyboard.png')})
  const pickModule=async name=>{
    const direct=modules.getByRole('tab',{name,exact:true})
    if (await direct.count()) { await direct.focus(); await page.keyboard.press('Enter') }
    else {
      await page.getByRole('button',{name:/^More \(/}).click()
      await page.getByRole('menuitem',{name,exact:true}).focus()
      await page.keyboard.press('Enter')
    }
    await expect(page.getByRole('tabpanel',{name,exact:true})).toBeVisible()
  }
  await pickModule('Statistical Modeling')
  const renameInputs=page.getByRole('textbox',{name:/^Rename column/})
  await renameInputs.first().waitFor()
  for (const input of await renameInputs.all()) {
    const box=await input.boundingBox()
    assert.ok(box.width>=64 && box.height>=24,'modeling column rename target preserves width and height')
  }
  const statistical=page.getByRole('toolbar',{name:'Analysis selection',exact:true})
  await statistical.getByRole('button',{name:'New',exact:true}).focus()
  await page.keyboard.press('Enter')
  await expect(statistical.locator('button[aria-pressed="true"]')).toBeFocused()
  page.once('dialog',dialog=>dialog.accept())
  await statistical.getByRole('button',{name:/^Close analysis/}).last().focus()
  await page.keyboard.press('Enter')
  await expect(statistical.locator('button[aria-pressed="true"]')).toBeFocused()
  await page.getByRole('tab',{name:'Regression & ML',exact:true}).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tabpanel',{name:'Regression & ML',exact:true})).toBeVisible()
  await page.screenshot({path:join(outputDir,'modeling-keyboard.png')})
  await pickModule('Report Builder')
  const reports=page.getByRole('toolbar',{name:'Report selection',exact:true})
  await reports.getByRole('button',{name:'New report',exact:true}).focus()
  await page.keyboard.press('Enter')
  await expect(reports.locator('button[aria-pressed="true"]')).toBeFocused()
  await reports.getByRole('button',{name:/^Close report/}).last().focus()
  await page.keyboard.press('Enter')
  await expect(reports.locator('button[aria-pressed="true"]')).toBeFocused()
  await page.screenshot({path:join(outputDir,'reports-keyboard.png')})
  assert.deepEqual(errors,[])
  await writeFile(join(outputDir,'report.json'),JSON.stringify({status:'passed',reflow,checks:['keyboard tables','linked tabs','folio switch/close/new focus','nested modal focus/inert','hierarchy disclosure','chart supplied values/uncertainty/pagination/fullscreen','density persistence','forced colors','scoped axe','actual module manual activation','Life Data keyboard editor/analysis focus','virtual model-grid sorted Enter/mount/focus and Tab exit','DataAnalysis/ReportBuilder new/close keyboard focus','200%/400% equivalent shared-control reflow with local table scrolling'],screenshots:['compact.png','comfortable.png','chart-fullscreen.png','life-data-keyboard.png','modeling-keyboard.png','reports-keyboard.png','reflow-200.png','reflow-400.png']},null,2))
  console.log('PASS shared browser accessibility: keyboard tables, linked tabs, folios, nested modals, hierarchy disclosure, chart data/pagination/fullscreen, density persistence, forced colors and scoped axe')
} finally {
  try { await browser?.close() }
  finally { await closeViteTestServer(vite, cacheDir) }
}
