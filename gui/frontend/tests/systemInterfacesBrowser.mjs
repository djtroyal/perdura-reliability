/** Real System Definition canvas: filtered data, nested dragging, and inspectors. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'
import { closeViteTestServer } from './viteTestLifecycle.mjs'

const root = new URL('..', import.meta.url).pathname
const argument = process.argv.indexOf('--output-dir')
const output = resolve(argument < 0 ? join(tmpdir(), 'perdura-system-interfaces') : process.argv[argument + 1])
await mkdir(output, { recursive: true })
const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-system-interfaces-vite-'))
const entry = '/__system_interfaces.tsx'
const fixture = `
import React from 'react'
import {createRoot} from 'react-dom/client'
import '/src/index.css'
import SystemDefinition from '/src/components/SystemDefinition'
import {KeyboardShortcutProvider} from '/src/components/shared/KeyboardShortcuts'
import {ReportAssetScopeProvider} from '/src/components/shared/ReportAssetScope'
import {ToastViewport} from '/src/components/shared/toast'
import * as project from '/src/store/project'
import {setUiPreference} from '/src/store/uiPreferences'
import demo from '/src/data/demoProject.json'
await project.hydrateProjectStorage()
project.newProject('Interfaces browser regression')
const system=structuredClone(demo.modules.systemDefinition)
const model=system.model
model.version=4
// This is a geometry regression, so isolate the hydraulic assembly instead of
// depending on the breadth or default collapsed state of the bundled aircraft.
const retained=new Set(['pump-system','pump-a','pump-b','b1','demo-part-1','demo-part-2','demo-part-3'])
model.instances=model.instances.filter(item=>retained.has(item.id))
model.externals=[]
for(const item of model.instances) if(['pump-a','pump-b','b1'].includes(item.id)) item.parent_instance_id='pump-system'
const supply=model.interfaces.find(item=>item.source.instance_id==='pump-a'&&item.interface_type==='material')
model.interfaces=['pump-a','pump-b'].map(id=>({...structuredClone(supply),
 id:'if-'+id+'-supply',name:id==='pump-a'?'Pump A supply':'Pump B supply',
 source:{instance_id:id,port_id:'discharge'},target:{instance_id:'pump-system',port_id:'supply-in'},
 source_function_ids:[],target_function_ids:[],transfers:[],flow_description:''}))
model.definitions.find(item=>item.id===model.instances.find(item=>item.id==='pump-system').definition_id).ports=[
 {id:'supply-in',name:'Supply input',interface_type:'material',direction:'input',description:'',properties:{}}]
model.function_links=model.function_links.filter(link=>[link.source,link.target].every(end=>retained.has(end.instance_id)))
model.diagrams[0].nodes=[
 {instance_id:'pump-system',x:520,y:170,width:210,height:80,expanded:false},
 {instance_id:'pump-a',x:100,y:80,width:180,height:72,expanded:false},
 {instance_id:'pump-b',x:100,y:260,width:180,height:72,expanded:false}]
model.diagrams[0].hidden_instance_ids=[]
model.instances.find(item=>item.id==='pump-system').name='Hydraulic System'
model.instances.find(item=>item.id==='b1').name='Controller Board Assembly'
model.instances.find(item=>item.id==='pump-a').name='Pump A'
model.instances.find(item=>item.id==='pump-b').name='Pump B'
// Keep the nested drag regression on an actual assembly; the new top-level
// system is implicit canvas space, with a compact endpoint only for its edge.
const rootDefinition=structuredClone(model.definitions.find(item=>item.id===model.instances.find(value=>value.id==='pump-system').definition_id))
rootDefinition.id='whole-system-definition'; rootDefinition.name='Project system'; rootDefinition.functions=[]; rootDefinition.failure_modes=[]
model.definitions.push(rootDefinition)
model.instances.find(item=>item.id==='pump-system').parent_instance_id='whole-system'
model.instances.push({id:'whole-system',definition_id:rootDefinition.id,name:'Project system',quantity:1,parent_instance_id:null,order:0,mode_ids:[],function_overrides:[],failure_mode_overrides:[],reference_designators:[],legacy_refs:[]})
model.root_instance_id='whole-system'
model.diagrams[0].nodes.push({instance_id:'whole-system',x:-40,y:-40,width:900,height:650,expanded:true})
const rootInterface=structuredClone(model.interfaces[0]);rootInterface.id='root-boundary-interface';rootInterface.name='Project boundary supply'
rootInterface.target={instance_id:'whole-system',port_id:rootDefinition.ports[0].id};rootInterface.target_function_ids=[];rootInterface.source_function_ids=[];rootInterface.transfers=[];rootInterface.flow_description=''
model.interfaces.push(rootInterface)
const hidden=structuredClone(model.interfaces[0])
hidden.id='hidden-part-interface'; hidden.name='Hidden piece-part supply'
hidden.source={instance_id:'demo-part-1',port_id:'part-output'}
hidden.target={external_id:'hidden-part-actor'}
hidden.source_function_ids=[]; hidden.target_function_ids=[];hidden.transfers=[];hidden.flow_description=''
hidden.properties={sentinel:'preserve exactly'}
model.definitions.find(item=>item.id==='definition-demo-part-1').ports=[{
 id:'part-output',name:'Part output',interface_type:'material',direction:'output',description:'',properties:{}}]
model.interfaces.push(hidden)
model.externals.push({id:'hidden-part-actor',name:'Piece-part service actor',kind:'adjacent_system',description:'',ports:[]})
model.diagrams[0].nodes.push({instance_id:'demo-part-1',x:999,y:777,width:181,height:73,expanded:false})
model.diagrams[0].snap_to_grid=false
system.view='structure'; system.structureCollapsedIds=['pump-system','demo-part-1']; model.diagrams[0].nodes.find(item=>item.instance_id==='pump-system').expanded=false
project.setModuleState('systemDefinition',system)
setUiPreference('systemDefinition.showPieceParts',true)
window.systemInterfacesTest={project,original:structuredClone(model),snapshot:()=>project.getProjectState().modules.systemDefinition}
createRoot(document.getElementById('root')).render(<KeyboardShortcutProvider>
 <ReportAssetScopeProvider value={{module:'systemDefinition',moduleLabel:'System Definition'}}>
  <div className="perdura-theme flex h-screen min-h-0 flex-col"><SystemDefinition/></div><ToastViewport/>
 </ReportAssetScopeProvider></KeyboardShortcutProvider>)
`
const vite = await createServer({
  root, cacheDir, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false },
  plugins: [{
    name: 'system-interfaces-assurance',
    resolveId(id) { if (id === entry) return id },
    load(id) { if (id === entry) return fixture },
    configureServer(server) {
      server.middlewares.use('/__system_interfaces', async (req, res, next) => {
        if (!['', '/'].includes(req.url?.split('?')[0])) return next()
        res.setHeader('Content-Type', 'text/html')
        res.end(await server.transformIndexHtml('/__system_interfaces', `<!doctype html><html lang="en"><head><title>System Interfaces assurance</title></head><body><div id="root"></div><script type="module" src="${entry}"></script></body></html>`))
      })
    },
  }],
})

let browser
let page
const checks = []
const errors = []
const node = id => page.locator(`.react-flow__node[data-id="system-instance:${id}"]`)
const snapshot = () => page.evaluate(() => window.systemInterfacesTest.snapshot())

async function settledViewport() {
  await page.evaluate(async () => {
    let previous = '', stable = 0
    for (let frame = 0; frame < 120; frame++) {
      await new Promise(resolve => requestAnimationFrame(resolve))
      const current = document.querySelector('.react-flow__viewport')?.getAttribute('style') ?? ''
      stable = current === previous ? stable + 1 : 0
      previous = current
      if (frame >= 30 && stable >= 5) return
    }
    throw new Error('Interfaces viewport did not settle')
  })
}

async function expectHiddenDataRetained(original) {
  const current = (await snapshot()).model
  assert.deepEqual(current.instances, original.instances, 'Canvas editing must retain the canonical hierarchy and all piece parts')
  assert.deepEqual(current.definitions, original.definitions, 'Canvas editing must retain canonical definitions')
  assert.deepEqual(current.interfaces, original.interfaces, 'Hidden and visible interface semantics must be retained')
  assert.deepEqual(current.diagrams[0].nodes.find(item => item.instance_id === 'demo-part-1'),
    original.diagrams[0].nodes.find(item => item.instance_id === 'demo-part-1'))
  assert.ok((await snapshot()).structureCollapsedIds.includes('demo-part-1'))
}

async function dragBeyondParent(direction) {
  await page.getByTitle('Fit the complete diagram in view', { exact: true }).click()
  await settledViewport()
  await page.locator('.react-flow__controls-zoomout').click()
  await page.locator('.react-flow__controls-zoomout').click()
  await settledViewport()
  const before = (await snapshot()).model
  const parent = await node('pump-system').boundingBox()
  const child = await node('pump-a').boundingBox()
  const area = await page.locator('.react-flow').boundingBox()
  const from = { x: child.x + child.width / 2, y: child.y + child.height / 2 }
  const target = direction === 'right-down'
    ? { x: parent.x + parent.width + 45, y: parent.y + parent.height + 45 }
    : { x: parent.x - 45, y: parent.y - 45 }
  assert.ok(target.x > area.x + 10 && target.x < area.x + area.width - 10
    && target.y > area.y + 10 && target.y < area.y + area.height - 10,
  'The drag target must stay inside the visible canvas while crossing both parent bounds')
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(target.x, target.y, { steps: 20 })
  await page.mouse.up()
  const oldChild = before.diagrams[0].nodes.find(item => item.instance_id === 'pump-a')
  await expect.poll(async () => {
    const next = (await snapshot()).model.diagrams[0].nodes.find(item => item.instance_id === 'pump-a')
    return direction === 'right-down' ? next.x > oldChild.x + 30 && next.y > oldChild.y + 30
      : next.x < oldChild.x - 30 && next.y < oldChild.y - 30
  }).toBe(true)
  const after = (await snapshot()).model
  const oldSibling = before.diagrams[0].nodes.find(item => item.instance_id === 'pump-b')
  const newSibling = after.diagrams[0].nodes.find(item => item.instance_id === 'pump-b')
  assert.ok(Math.abs(newSibling.x - oldSibling.x) < 0.1 && Math.abs(newSibling.y - oldSibling.y) < 0.1,
    'Growing a parent must not move its sibling blocks in absolute diagram coordinates')
  assert.deepEqual(after.instances, before.instances)
  await settledViewport()
  const rendered = await node('pump-a').boundingBox()
  await writeFile(join(output, `drag-${direction}.json`), JSON.stringify({
    from, target, rendered, parent, area,
    before: before.diagrams[0], after: after.diagrams[0],
  }, null, 2) + '\n')
  assert.ok(Math.abs(rendered.x + rendered.width / 2 - target.x) < 8
    && Math.abs(rendered.y + rendered.height / 2 - target.y) < 8,
  `A child must remain at the released position after its parent resizes: target=${JSON.stringify(target)}, renderedCenter=${JSON.stringify({ x: rendered.x + rendered.width / 2, y: rendered.y + rendered.height / 2 })}`)
}

try {
  await vite.listen()
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1900, height: 1150 }, reducedMotion: 'reduce' })
  page.setDefaultTimeout(30000)
  page.setDefaultNavigationTimeout(90000)
  page.on('pageerror', error => errors.push(error.message))
  await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({
    status: 200, contentType: 'application/json', body: '{}',
  }))
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__system_interfaces`)
  await expect(page.getByRole('checkbox', { name: 'Show piece parts', exact: true })).toBeChecked({ timeout: 90000 })
  await page.getByRole('button', { name: 'Expand Hydraulic System', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Select Microprocessor, level 4', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Collapse Hydraulic System', exact: true }).click()
  const original = await page.evaluate(() => window.systemInterfacesTest.original)
  await page.getByRole('button', { name: 'Interfaces', exact: true }).click()
  const installed = page.getByRole('group', { name: 'Installed hierarchy', exact: true })
  await expect(installed).toBeVisible()
  await expect(installed.getByRole('button', { name: /Microprocessor|Bias Resistors|Decoupling Caps/ })).toHaveCount(0)
  await expect(node('pump-system')).toBeVisible()
  await expect(node('pump-a')).toHaveCount(0)
  await page.getByRole('button', { name: 'Expand Hydraulic System', exact: true }).click()
  await expect(node('pump-a')).toBeVisible()
  for (const id of ['demo-part-1', 'demo-part-2', 'demo-part-3']) await expect(node(id)).toHaveCount(0)
  await expect(page.locator('.react-flow__edge')).toHaveCount(4)
  await expect(page.locator('.react-flow__node[data-id="fmea-analysis-boundary"]')).toHaveCount(0)
  await expect(node('whole-system')).toBeVisible()
  await expect(node('whole-system').getByRole('button', { name: /^Expand|^Collapse/ })).toHaveCount(0)
  assert.ok((await node('whole-system').boundingBox()).height < (await node('pump-system').boundingBox()).height,
    'Root is only a compact interface endpoint; internal assemblies retain their containers')
  assert.equal(await node('whole-system').getAttribute('class').then(value=>value.includes('draggable')),false)
  checks.push('Canvas replaces the redundant top-level root and boundary frames while retaining root interface identity')
  await expect(node('b1').getByRole('button', { name: /^Expand|^Collapse/ })).toHaveCount(0)
  const connectors=page.getByRole('combobox',{name:'Connector style',exact:true})
  await expect(connectors).toHaveValue('curved')
  for(const style of ['orthogonal','straight','curved']) {
    await connectors.selectOption(style)
    await expect.poll(async()=>(await snapshot()).model.diagrams[0].connectorStyle).toBe(style)
    await expect(page.locator('.react-flow__edge')).toHaveCount(4)
  }
  assert.deepEqual((await snapshot()).model.diagrams[0].nodes.find(item=>item.instance_id==='whole-system'),
    original.diagrams[0].nodes.find(item=>item.instance_id==='whole-system'),'Root canonical layout remains unchanged')
  await expectHiddenDataRetained(original)
  checks.push('Interfaces summarizes piece-part endpoints at their containing assembly independently of the Structure table preference')


  const beforeHierarchySelection=(await snapshot()).model
  for(let attempt=0;attempt<2;attempt++) {
    await page.locator('.react-flow__edge button').first().click()
    await expect(page.locator('.react-flow__edge.selected')).toHaveCount(1)
    await installed.getByRole('button',{name:/^Pump A /}).click()
    await expect(page.getByRole('complementary',{name:'Diagram properties',exact:true}).getByRole('textbox',{name:'Installed name',exact:true})).toHaveValue('Pump A')
    await expect(page.locator('.react-flow__edge.selected')).toHaveCount(0)
    await expect(node('pump-a')).toHaveClass(/selected/)
    assert.deepEqual((await snapshot()).model,beforeHierarchySelection,'Hierarchy selection must not change geometry or model inputs')
  }
  checks.push('Installed hierarchy selection updates only the selected block inspector and clears connector selection without model writes')
  const initialWidth = (await page.locator('.react-flow').boundingBox()).width
  await expect(page.getByRole('complementary', { name: 'Block inspector', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Edit system model', exact: true }).click()
  const tools = page.getByRole('dialog', { name: 'System model tools', exact: true })
  await expect(tools).toBeVisible()
  await expect(tools.getByRole('complementary', { name: 'Block inspector', exact: true })).toBeVisible()
  const inspectedValues=await tools.getByRole('complementary',{name:'Block inspector',exact:true}).locator('input').evaluateAll(inputs=>inputs.map(input=>input.value))
  const selection=(await snapshot()).selectedInstanceId
  for(const item of original.interfaces) {
    assert.equal(inspectedValues.includes(item.name),item.source.instance_id===selection||item.target.instance_id===selection,
      'Block inspector must show only interfaces of the selected block')
  }
  await tools.getByRole('button', { name: 'Close model tools', exact: true }).click()
  await expect(tools).toHaveCount(0)
  await page.getByRole('button', { name: 'Toggle inspector', exact: true }).click()
  const allHiddenWidth = (await page.locator('.react-flow').boundingBox()).width
  assert.ok(allHiddenWidth > initialWidth + 180)
  await page.getByRole('button', { name: 'Toggle inspector', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Toggle inspector', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Toggle inspector', exact: true }).click()
  await page.getByRole('button', { name: 'Structure', exact: true }).click()
  await page.getByRole('button', { name: 'Interfaces', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Edit system model', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Toggle inspector', exact: true })).toHaveAttribute('aria-expanded','false')
  checks.push('One normal inspector; optional shared-model authoring drawer; inspector collapse restores canvas width and persists across tabs')


  const mountedNode=await node('pump-a').elementHandle()
  const expand=page.getByRole('button',{name:'Expand diagram to full screen',exact:true})
  await expand.focus();await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog',{name:'System interface diagram — full screen',exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Restore diagram',exact:true})).toHaveCount(1)
  assert.equal(await node('pump-a').evaluate((current,original)=>current===original,mountedNode),true)
  await page.keyboard.press('Escape')
  await expect(expand).toBeFocused()
  checks.push('Fullscreen uses the shared stable toggle, keeps nodes mounted, and restores keyboard focus with Escape')
  const tallCanvas = await page.locator('.react-flow').boundingBox()
  assert.ok(tallCanvas.y + tallCanvas.height >= 1150 - 24, 'Interfaces canvas must fill the available vertical workspace')
  await page.setViewportSize({ width: 1900, height: 850 })
  await expect.poll(async () => {
    const bounds = await page.locator('.react-flow').boundingBox()
    return Math.abs(bounds.y + bounds.height - 850)
  }).toBeLessThan(24)
  const shortCanvas = await page.locator('.react-flow').boundingBox()
  assert.ok(tallCanvas.height - shortCanvas.height > 250, 'Canvas height must respond to window height rather than staying fixed')
  await page.setViewportSize({ width: 1900, height: 1150 })
  checks.push('Interfaces canvas fills the available window height and responds to resizing')

  await page.getByLabel('Diagram layout', { exact: true }).click()
  await page.getByRole('button', { name: 'Normal', exact: true }).click()
  await settledViewport()
  await expectHiddenDataRetained(original)
  const beforeSelection = (await snapshot()).model
  await node('pump-a').click()
  await settledViewport()
  assert.deepEqual((await snapshot()).model, beforeSelection, 'Selecting a block without dragging must not change the model or its geometry')
  await dragBeyondParent('right-down')
  await expectHiddenDataRetained(original)
  await dragBeyondParent('left-up')
  await expectHiddenDataRetained(original)
  const placed = (await snapshot()).model.diagrams[0].nodes
    .filter(item => ['pump-a', 'pump-b', 'b1'].includes(item.instance_id))
    .map(item => ({ id: item.instance_id, x: item.x, y: item.y }))
  await page.getByRole('button', { name: 'Collapse Hydraulic System', exact: true }).click()
  await expect(node('pump-a')).toHaveCount(0)
  await page.getByRole('button', { name: 'Expand Hydraulic System', exact: true }).click()
  await expect(node('pump-a')).toBeVisible()
  assert.deepEqual((await snapshot()).model.diagrams[0].nodes
    .filter(item => ['pump-a', 'pump-b', 'b1'].includes(item.instance_id))
    .map(item => ({ id: item.instance_id, x: item.x, y: item.y })), placed,
  'Collapsing and reopening an assembly must retain manually arranged child positions')
  await settledViewport()
  const reopenedParent = await node('pump-system').boundingBox()
  const reopenedChildren = await Promise.all(['pump-a', 'pump-b', 'b1'].map(id => node(id).boundingBox()))
  await writeFile(join(output, 'reexpanded-bounds.json'), JSON.stringify({ parent: reopenedParent, children: reopenedChildren }, null, 2) + '\n')
  assert.ok(reopenedChildren.every(child => child.x >= reopenedParent.x - 1 && child.y >= reopenedParent.y - 1
    && child.x + child.width <= reopenedParent.x + reopenedParent.width + 1
    && child.y + child.height <= reopenedParent.y + reopenedParent.height + 1),
  'Reopening an assembly must render a parent container large enough to enclose its retained child positions')
  await page.screenshot({ path: join(output, 'interfaces-expanded-drag.png') })
  checks.push('Nested blocks move beyond right/down and left/up parent bounds without moving siblings or changing hierarchy and hidden data')

  const beforeVisibility=(await snapshot()).model
  await installed.getByRole('button',{name:'Diagram visibility for Controller Board Assembly',exact:true}).click()
  await expect(node('b1')).toHaveCount(0)
  assert.deepEqual((await snapshot()).model.interfaces,beforeVisibility.interfaces,'Visibility must not delete interfaces')
  assert.deepEqual((await snapshot()).model.instances,beforeVisibility.instances,'Visibility must not change installed hierarchy')
  await installed.getByRole('button',{name:'Diagram visibility for Controller Board Assembly',exact:true}).click()
  await expect(node('b1')).toBeVisible()
  assert.equal((await snapshot()).model.diagrams[0].nodes.find(item=>item.instance_id==='b1').x,beforeVisibility.diagrams[0].nodes.find(item=>item.instance_id==='b1').x)
  checks.push('Hierarchy visibility buttons hide and reveal branches while retaining canonical interfaces and manual placement')

  await page.evaluate(() => {
    const {project} = window.systemInterfacesTest
    const current = structuredClone(window.systemInterfacesTest.snapshot())
    current.view = 'functions'; current.selectedInstanceId = 'pump-a'
    const instance = current.model.instances.find(item => item.id === 'pump-a')
    const fn=current.model.definitions.find(item=>item.id===instance.definition_id).functions.find(item=>item.id==='move-fluid')
    instance.function_overrides = [{...instance.function_overrides.find(item=>item.function_id==='move-fluid'),function_id:'move-fluid',enabled:true,description:'Supply Pressurized fluid',definition:{...structuredClone(fn.definition),action:'Supply Pressurized fluid'},function_type:'supporting',mode_ids:['run']}]
    instance.failure_mode_overrides = [{failure_mode_id:'no-flow',enabled:true,description:'FMEA occurrence failure',deviation_id:'reduced',mode_ids:['run']}]
    project.setModuleState('systemDefinition', current)
  })
  const functions = page.getByRole('region', {name:'Installed functions and failures',exact:true})
  await functions.getByRole('button', {name:/^Supply Pressurized fluid/}).click()
  await expect(functions.getByRole('textbox', {name:'Function action',exact:true})).toHaveValue('Supply Pressurized fluid')
  await expect(functions.getByRole('textbox', {name:'Failure description',exact:true})).toHaveValue('FMEA occurrence failure')
  const beforeFunctionEdit = (await snapshot()).model
  await functions.getByRole('textbox', {name:'Function action',exact:true}).fill('Generate Pressurized fluid')
  await functions.getByRole('textbox', {name:'Failure description',exact:true}).fill('Updated installed failure')
  const afterFunctionEdit = (await snapshot()).model
  assert.deepEqual(afterFunctionEdit.definitions, beforeFunctionEdit.definitions, 'Installed editing must preserve reusable definitions')
  assert.deepEqual(afterFunctionEdit.diagrams,beforeFunctionEdit.diagrams,'Function and failure text edits must retain every manually arranged/hidden diagram node')
  assert.deepEqual(afterFunctionEdit.instances.find(item => item.id === 'pump-b'), beforeFunctionEdit.instances.find(item => item.id === 'pump-b'))
  const beforeOverride=beforeFunctionEdit.instances.find(item=>item.id==='pump-a').function_overrides[0]
  const afterOverride=afterFunctionEdit.instances.find(item=>item.id==='pump-a').function_overrides[0]
  assert.equal(afterOverride.definition.action,'Generate Pressurized fluid')
  assert.equal(afterOverride.description,'Generate Pressurized fluid')
  assert.equal(afterOverride.function_type,beforeOverride.function_type)
  assert.deepEqual(afterOverride.mode_ids,beforeOverride.mode_ids)
  const resourcesFor=override=>override.definition.io.map(io=>override.resource_bindings?.[io.id]??io.resource_id)
  assert.deepEqual(resourcesFor(afterOverride),resourcesFor(beforeOverride),'Editing an action preserves installed resource identities')
  assert.equal(afterFunctionEdit.instances.find(item => item.id === 'pump-a').failure_mode_overrides[0].deviation_id, 'reduced')
  await functions.getByText('Advanced block settings',{exact:true}).click()
  await functions.getByRole('checkbox', {name:'Edit reusable definition',exact:true}).check()
  const reusablePump = beforeFunctionEdit.definitions.find(item => item.id === beforeFunctionEdit.instances.find(item => item.id === 'pump-a').definition_id)
  await expect(functions.getByRole('textbox', {name:'Function action',exact:true})).toHaveValue(reusablePump.functions[0].definition.action)
  await functions.getByRole('textbox', {name:'Function action',exact:true}).fill('Supply Pressurized fluid')
  await functions.getByRole('checkbox', {name:'Edit reusable definition',exact:true}).uncheck()
  await expect(functions.getByRole('textbox', {name:'Function action',exact:true})).toHaveValue('Generate Pressurized fluid')
  assert.deepEqual((await snapshot()).model.diagrams,beforeFunctionEdit.diagrams,'Reusable default edits must not run Auto Layout or reset hidden part geometry')
  await page.screenshot({path:join(output,'installed-functions.png')})
  checks.push('Functions displays FMEA occurrence overrides, edits only the selected installed item, preserves unchanged overrides, and separates reusable defaults')


  await page.getByRole('button',{name:'Interfaces',exact:true}).click()
  await expect(node('pump-a')).toBeVisible()
  await settledViewport()
  const returnedParent=await node('pump-system').boundingBox()
  const returnedChildren=await Promise.all(['pump-a','pump-b','b1'].map(id=>node(id).boundingBox()))
  assert.ok(returnedChildren.every(child=>child.x>=returnedParent.x-1&&child.y>=returnedParent.y-1
    &&child.x+child.width<=returnedParent.x+returnedParent.width+1&&child.y+child.height<=returnedParent.y+returnedParent.height+1),
    'Ordinary tab return after Functions edits must retain expanded enclosure')
  const beforeInterfaceEdit=(await snapshot()).model.diagrams
  await page.getByRole('button',{name:'Edit system model',exact:true}).click()
  const interfaceTools=page.getByRole('dialog',{name:'System model tools',exact:true})
  await interfaceTools.getByRole('textbox',{name:'Interface name',exact:true}).first().fill('Updated interface name')
  assert.deepEqual((await snapshot()).model.diagrams,beforeInterfaceEdit,'Interface context edits must preserve the shared arrangement')
  await interfaceTools.getByRole('button',{name:'Close model tools',exact:true}).click()
  checks.push('Occurrence/default function edits and interface edits preserve all layout geometry; remounted expanded assemblies still enclose their children')

  await page.evaluate(()=>{
    const current=structuredClone(window.systemInterfacesTest.snapshot())
    current.view='architecture'
    current.model.interfaces=current.model.interfaces.filter(item=>item.id!=='root-boundary-interface')
    window.systemInterfacesTest.project.setModuleState('systemDefinition',current)
  })
  await expect(node('whole-system')).toHaveCount(0)
  await expect(node('pump-system')).toBeVisible()
  const beforeRootSelection=(await snapshot()).model
  await page.getByRole('group',{name:'Installed hierarchy',exact:true}).getByRole('button',{name:/^Project system /}).click()
  await expect(page.getByRole('complementary',{name:'Diagram properties',exact:true}).getByRole('textbox',{name:'Installed name',exact:true})).toHaveValue('Project system')
  assert.deepEqual((await snapshot()).model,beforeRootSelection)
  await expect(node('whole-system')).toHaveCount(0)
  await settledViewport()
  const remountedParent=await node('pump-system').boundingBox()
  const remountedChildren=await Promise.all(['pump-a','pump-b','b1'].map(id=>node(id).boundingBox()))
  assert.ok(remountedChildren.every(child=>child.x>=remountedParent.x-1&&child.y>=remountedParent.y-1
    &&child.x+child.width<=remountedParent.x+remountedParent.width+1&&child.y+child.height<=remountedParent.y+remountedParent.height+1),
    'Expanded assembly must still enclose its manually placed children after semantic edits and remount')
  await writeFile(join(output,'remounted-geometry.json'),JSON.stringify({model:(await snapshot()).model,parent:await node('pump-system').boundingBox(),children:await Promise.all(['pump-a','pump-b','b1'].map(id=>node(id).boundingBox()))},null,2)+'\n')
  await page.screenshot({path:join(output,'interfaces-implicit-system.png')})
  checks.push('A root with no interface endpoints has no canvas block; hierarchy selection still provides its inspector without geometry changes')
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'browser.json'), JSON.stringify({ status: 'passed', checks }, null, 2) + '\n')
  console.log('PASS Interfaces browser: hierarchical visibility, inherited endpoints, shared placement, nested dragging, structured function editing, routing, fullscreen and inspector preferences')
} catch (error) {
  await writeFile(join(output, 'failure.json'), JSON.stringify({ error: String(error), errors, checks }, null, 2) + '\n')
  if (page) await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await browser?.close()
  await closeViteTestServer(vite, cacheDir)
}
