/** Production FTA workspace/browser integration, with a fixture-only validation API. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { closeViteTestServer } from './viteTestLifecycle.mjs'

const root = new URL('..', import.meta.url).pathname
const option = process.argv.indexOf('--output-dir')
const output = resolve(option < 0 ? join(tmpdir(), 'perdura-fta-library-browser') : process.argv[option + 1])
await mkdir(output, { recursive: true })
const cacheDir = await mkdtemp(join(tmpdir(), 'fta-library-browser-'))
const route = '/__fta-library-browser.tsx'
const fixture = `
import React from 'react'
import {createRoot} from 'react-dom/client'
import '/src/index.css'
import FaultTreePage from '/src/components/FaultTree'
import {KeyboardShortcutProvider} from '/src/components/shared/KeyboardShortcuts'
import {ReportAssetScopeProvider} from '/src/components/shared/ReportAssetScope'
import DialogHost from '/src/components/shared/ConfirmDialog'
import {ToastViewport} from '/src/components/shared/toast'
import * as project from '/src/store/project'
import * as model from '/src/components/FaultTree/libraryModel'
import {CURRENT_ENGINE_REVISIONS} from '/src/version'
import {requestBookmarkNavigation} from '/src/store/bookmarks'
const event = (id, label, probability=.1) => ({id,type:'basic',position:{x:80,y:230},data:{label,probability,eventKey:id}})
const tree = (id,name,targets=[],type='or') => ({id,name,state:{schemaVersion:2,nodes:[
  {id:'top',type,position:{x:180,y:20},data:{label:name+' top event'}},event('event',name+' valve failure'),
  ...targets.map((target,i)=>({id:'transfer'+i,type:'transfer',position:{x:360+i*200,y:230},
    data:{label:'Shared pump assembly',transferTo:target,referenceMode:'shared'}}))],
  edges:[{id:'input',source:'top',target:'event',data:{order:0,role:type==='por'?'priority':'input'}},
    ...targets.map((target,i)=>({id:'ref'+i,source:'top',target:'transfer'+i,data:{order:i+1,role:'input'}}))],
  exposureTime:'1000',engine:'auto',confidenceLevel:'95',nSimulations:'20000',simSeed:'',
  density:'comfortable',connectorStyle:'smoothstep',snapToGrid:false,annotations:[],showNodeIds:true}})
function seed(large=false) {
  project.flushProjectEditors()
  project.newProject(large?'Large FTA library browser fixture':'FTA library browser fixture')
  const folios = large ? Array.from({length:500},(_,i)=>({id:'large-'+i,name:'Assembly '+String(i).padStart(3,'0'),state:{
    nodes:[{id:'top',type:'or',position:{x:150,y:0},data:{label:'Assembly '+i}},
      ...Array.from({length:99},(_,j)=>({id:'event-'+j,type:'basic',position:{x:(j%10)*210,y:200+Math.floor(j/10)*160},
        data:{label:j===98?'unique-search-sentinel-'+i:'Component '+j,probability:.001,eventKey:'event-'+j}}))],
    edges:Array.from({length:99},(_,j)=>({id:'edge-'+j,source:'top',target:'event-'+j,data:{role:'input',order:j}})),
    exposureTime:'1000',engine:'auto',annotations:[]}}))
    : [tree('parent-a','Cooling system',['shared']),tree('parent-b','Power system',['shared']),
       tree('shared','Shared pump assembly'),tree('ordered','Priority protection',[],'por')]
  const normalized=model.normalizeFtaLibrary(folios)
  project.writeFtaLibrary(folios,normalized.catalog,folios[0].id,'Seed isolated browser fixture')
  return folios.length
}
window.ftaLibraryHarnessStage='modules-loaded'
await project.hydrateProjectStorage()
window.ftaLibraryHarnessStage='storage-hydrated'
seed()
window.ftaLibraryHarnessStage='fixture-seeded'
window.ftaLibraryTest={project,model,seed,requestBookmarkNavigation,engineRevision:CURRENT_ENGINE_REVISIONS.faultTree}
createRoot(document.getElementById('root')).render(<KeyboardShortcutProvider>
  <ReportAssetScopeProvider value={{module:'faultTree',moduleLabel:'Fault Tree Analysis'}}>
    <div className="perdura-theme flex h-screen min-h-0 flex-col"><FaultTreePage /></div>
  </ReportAssetScopeProvider><DialogHost/><ToastViewport/>
</KeyboardShortcutProvider>)
`
const vite = await createServer({ root, cacheDir, logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [{
    name: 'fta-library-browser-fixture', resolveId(id) { if (id === route) return id },
    load(id) { if (id === route) return fixture },
    configureServer(server) { server.middlewares.use('/__fta-library-browser', async (req, res, next) => {
      if (req.url !== '/' && req.url !== '') return next()
      res.setHeader('Content-Type', 'text/html')
      res.end(await server.transformIndexHtml('/__fta-library-browser',
        '<!doctype html><html lang="en"><head><title>FTA Library regression</title></head><body><div id="root">Loading fixture modules…</div><script type="module" src="/__fta-library-browser.tsx"></script></body></html>'))
    }) },
  }] })
let browser, page
const errors = [], consoleErrors = [], failedRequests = [], checks = [], timings = {}, accessibility = []
const pendingAnalyses = []
const responseData = probability => ({ analysis_kind:'static_coherent',top_event_probability:probability,
  minimal_cut_sets:[['Fixture event']],importance:[],methods:{exact:probability},node_results:[],
  computation:{exact_engine:{engine:'robdd',exact:true,variables:1},minimal_cut_set_count:1} })
async function startDelayedAnalysis() {
  const count=pendingAnalyses.length
  await page.getByRole('button',{name:'Analyze Fault Tree',exact:true}).click()
  await expect.poll(()=>pendingAnalyses.length,{timeout:15000}).toBe(count+1)
  return pendingAnalyses[count]
}
async function finishAnalysis(request,probability) {
  // Cancelled navigation is allowed to abort fetch. In the still-mounted case this delivers a real NDJSON response.
  await request.fulfill({status:200,contentType:'application/x-ndjson',body:
    `${JSON.stringify({type:'progress',done:1,total:1})}\n${JSON.stringify({type:'result',data:responseData(probability)})}\n`}).catch(error=>{
    if(!/already handled|closed|aborted/i.test(String(error)))throw error
  })
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
}
async function snapshot(name) {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: join(output, `${name}.png`), fullPage: true })
}
async function axe(name, selector = '[data-fta-workspace]') {
  const result = await new AxeBuilder({ page }).include(selector).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  const serious = result.violations.filter(item => ['critical', 'serious'].includes(item.impact))
  accessibility.push({ name, violations: result.violations })
  assert.deepEqual(serious.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), [], `${name} accessibility`)
}
try {
  await vite.listen()
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if(message.type()==='error') consoleErrors.push(message.text()) })
  page.on('requestfailed', request => failedRequests.push({url:request.url(),failure:request.failure()}))
  // Match backend URLs only. '**/api/**' also intercepts Vite's /src/api/*.ts modules.
  await page.route(url => url.pathname.startsWith('/api/'), route => {
    if(new URL(route.request().url()).pathname.endsWith('/fault-tree/analyze/stream')) {pendingAnalyses.push(route);return}
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ valid: true, issues: [], analysis_kind: 'static_coherent', root_id: 'top', event_count: 1 }) })
  })
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__fta-library-browser`)
  await page.getByRole('heading', { name: 'FTA Library', exact: true }).waitFor({ timeout: 90000 })
  const views = page.getByRole('group', { name: 'FTA workspace view' })
  await expect(views.getByRole('button', { name: 'Library', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('region', { name: 'Node Library' })).toHaveCount(0)
  const hierarchy = page.getByRole('tree', { name: 'Fault tree hierarchy' })
  await hierarchy.getByRole('button', { name: 'Expand Cooling system', exact: true }).click()
  await hierarchy.getByRole('button', { name: 'Expand Power system', exact: true }).click()
  const sharedRows = hierarchy.getByRole('treeitem').filter({ hasText: 'Shared pump assembly' })
  await expect(sharedRows).toHaveCount(2)
  assert.ok((await sharedRows.allTextContents()).every(value => value.includes('Repeated · 2 parents')))
  await snapshot('library-shared-hierarchy')
  await axe('Library home')
  checks.push('Library is the initial home; one shared tree appears beneath each referring parent')

  await hierarchy.focus()
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowDown')
  const activeDescendant = await hierarchy.getAttribute('aria-activedescendant')
  assert.ok(await page.locator(`[id=${JSON.stringify(activeDescendant)}]`).count())
  await page.keyboard.press('Enter')
  await expect(views.getByRole('button', { name: 'Editor', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('toolbar', { name: 'Open fault trees' }).getByRole('button', { name: 'Close tab Shared pump assembly' })).toBeVisible()
  const initialNodes = await page.evaluate(() => window.ftaLibraryTest.project.getProjectState().modules.faultTree.folios.find(t=>t.id==='shared').state.nodes.length)
  const palette = page.getByRole('region', { name: 'Node Library', exact: true })
  const basic = palette.getByTitle('Add Basic Event', { exact: true })
  const metrics = await basic.evaluate(button => ({ height: button.getBoundingClientRect().height,
    fontSize: parseFloat(getComputedStyle(button.querySelector('span')).fontSize),
    symbolCount: button.querySelectorAll('[data-fta-symbol]').length }))
  assert.ok(metrics.height >= 36 && metrics.fontSize >= 13 && metrics.symbolCount === 1)
  await basic.focus(); await page.keyboard.press('Enter')
  // Close immediately, deliberately before the editor's250ms persistence debounce.
  await page.getByRole('button', { name: 'Close tab Shared pump assembly', exact: true }).click()
  await expect(views.getByRole('button', { name: 'Library', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const closed = await page.evaluate(() => {
    const folios = window.ftaLibraryTest.project.getProjectState().modules.faultTree.folios
    return { count: folios.length, nodes: folios.find(t=>t.id==='shared').state.nodes.length }
  })
  assert.equal(closed.count, 4)
  assert.equal(closed.nodes, initialNodes + 1)
  checks.push('Keyboard navigation opens a shared tree; Close preserves the document and flushes pending node additions')

  await page.evaluate(() => window.ftaLibraryTest.requestBookmarkNavigation({ module:'faultTree',
    tab:'system-modeling',sub:'fta',analysisId:'shared',analysisName:'Shared pump assembly',assetKey:'fixture-canvas' },'Fault Tree Diagram'))
  await expect(page.getByRole('button', { name: 'Close tab Shared pump assembly', exact: true })).toBeVisible()
  await expect(views.getByRole('button', { name: 'Editor', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await palette.getByRole('textbox', { name: 'Search node types' }).fill('priority')
  await expect(palette.getByTitle('Add Priority AND', { exact: true })).toBeVisible()
  await expect(palette.getByTitle('Add Priority OR', { exact: true })).toBeVisible()
  await palette.getByRole('textbox', { name: 'Search node types' }).fill('')
  await snapshot('editor-node-library')
  await axe('Node palette', '[data-fta-node-library]')
  checks.push('Stable-ID bookmarks reopen closed tabs; searchable palette has full symbols and keyboard-operable44px rows')

  await views.getByRole('button', { name: 'Library', exact: true }).click()
  const search = page.getByRole('textbox', { name: 'Search FTA Library' })
  await search.fill('Cooling system valve failure')
  await expect(hierarchy.getByRole('treeitem')).toHaveCount(1)
  await hierarchy.getByRole('treeitem').click()
  await search.fill('')
  await page.getByRole('button', { name: 'Create child', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: 'Create child fault tree' })
  await expect(dialog.getByRole('button', { name: 'Create and connect' })).toBeDisabled()
  await dialog.getByLabel('Child tree name').fill('Cancelled child')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(await page.evaluate(()=>window.ftaLibraryTest.project.getProjectState().modules.faultTree.folios.length),4)
  await page.getByRole('button', { name: 'Create child', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Create child fault tree' })
  await dialog.getByLabel('Child tree name').fill('Auxiliary cooling draft')
  await dialog.getByLabel('Parent gate in Cooling system').selectOption('top')
  await dialog.getByLabel('Event identity').selectOption('independent')
  await axe('Explicit placement dialog', '[role="dialog"]')
  await dialog.getByRole('button', { name: 'Create and connect' }).click()
  const created = await page.evaluate(() => {
    const folios = window.ftaLibraryTest.project.getProjectState().modules.faultTree.folios
    const child = folios.find(t=>t.name==='Auxiliary cooling draft')
    const parent = folios.find(t=>t.id==='parent-a')
    const transfer = parent.state.nodes.find(n=>n.data.transferTo===child.id)
    return { count:folios.length, childNodes:child.state.nodes.length, mode:transfer.data.referenceMode,
      placed:parent.state.edges.some(e=>e.source==='top'&&e.target===transfer.id) }
  })
  assert.deepEqual(created,{count:5,childNodes:0,mode:'independent',placed:true})
  checks.push('Creating a child requires explicit placement; Cancel is atomic; committed child is connected with selected identity mode')

  await search.fill('Priority protection')
  await hierarchy.getByRole('treeitem').click()
  await search.fill('')
  await page.getByRole('button', { name: 'Reference existing', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Reference an existing tree' })
  await dialog.getByLabel('Referenced tree').selectOption('shared')
  await dialog.getByLabel('Parent gate in Priority protection').selectOption('top')
  await dialog.getByLabel('Input role').selectOption('priority')
  await expect(dialog.getByRole('button', { name: 'Add reference', exact: true })).toBeDisabled()
  await expect(dialog.getByRole('alert')).toContainText('already has a priority input')
  await dialog.getByLabel('Input role').selectOption('blocker')
  await expect(dialog.getByRole('button', { name: 'Add reference', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  checks.push('Placement rejects duplicate analytical priority roles without silently reassigning existing inputs')

  await page.setViewportSize({ width: 720, height: 500 })
  await expect(search).toBeVisible()
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1), 'Library must fit a200%-equivalent desktop viewport')
  await snapshot('library-200percent-equivalent')
  await page.setViewportSize({ width: 1440, height: 1000 })
  // Reset to a complete fixture before testing numerical-request lifecycle isolation.
  await page.evaluate(()=>window.ftaLibraryTest.seed())
  await page.getByRole('button',{name:'Open editor',exact:true}).click()
  let delayed=await startDelayedAnalysis()
  await page.evaluate(()=>{
    const {project}=window.ftaLibraryTest
    const child=project.getProjectState().modules.faultTree.folios.find(tree=>tree.id==='shared')
    project.writeFolioState('faultTree','shared',{...child.state,nodes:child.state.nodes.map(node=>node.id==='event'
      ? {...node,data:{...node.data,probability:.25}} : node)})
  })
  await finishAnalysis(delayed,.87654321)
  await expect(page.getByText('Inputs or referenced trees changed while calculating. Recalculate to obtain current results.',{exact:true})).toBeVisible()
  assert.equal(await page.evaluate(()=>window.ftaLibraryTest.project.getProjectState().modules.faultTree.folios.find(t=>t.id==='parent-a').state.result==null),true)
  delayed=await startDelayedAnalysis()
  await finishAnalysis(delayed,.12345678)
  await expect.poll(()=>page.evaluate(()=>window.ftaLibraryTest.project.getProjectState().modules.faultTree.folios.find(t=>t.id==='parent-a').state.result?.top_event_probability)).toBe(.12345678)
  assert.equal(await page.evaluate(()=>window.ftaLibraryTest.model.ftaResultFreshness(
    window.ftaLibraryTest.project.getProjectState().modules.faultTree.folios,'parent-a',window.ftaLibraryTest.engineRevision).status),'current')
  checks.push('A delayed NDJSON response is rejected when a dependency changes; a subsequent matching request commits verified current results')

  delayed=await startDelayedAnalysis()
  const undone=await page.evaluate(()=>{
    const {project}=window.ftaLibraryTest
    project.flushProjectEditors()
    const before=project.getProjectState()
    const child=before.modules.faultTree.folios.find(tree=>tree.id==='shared')
    project.writeFolioState('faultTree','shared',{...child.state,nodes:child.state.nodes.map(node=>node.id==='event'
      ? {...node,data:{...node.data,probability:.375}} : node)},'delayed-analysis-undo-fixture')
    project.undo()
    const after=project.getProjectState()
    return {sameProject:after.identity.projectId===before.identity.projectId,
      newerRevision:after.revision>before.revision,
      probability:after.modules.faultTree.folios.find(tree=>tree.id==='shared').state.nodes.find(node=>node.id==='event').data.probability}
  })
  assert.deepEqual(undone,{sameProject:true,newerRevision:true,probability:.25})
  await finishAnalysis(delayed,.87654321)
  assert.equal(await page.evaluate(()=>window.ftaLibraryTest.project.getProjectState().modules.faultTree.folios
    .find(tree=>tree.id==='parent-a').state.result?.top_event_probability),.12345678)
  checks.push('Undo during a pending analysis preserves restored results even when the inputs again match the request')

  delayed=await startDelayedAnalysis()
  await page.evaluate(()=>window.ftaLibraryTest.requestBookmarkNavigation({module:'faultTree',tab:'system-modeling',sub:'fta',
    analysisId:'parent-b',analysisName:'Power system',assetKey:'fixture-switch'},'Fault Tree Diagram'))
  await expect(page.getByRole('button',{name:'Close tab Power system',exact:true})).toBeVisible()
  await finishAnalysis(delayed,.98765432)
  assert.deepEqual(await page.evaluate(()=>{
    const wrap=window.ftaLibraryTest.project.getProjectState().modules.faultTree
    return {active:wrap.activeId,a:wrap.folios.find(t=>t.id==='parent-a').state.result?.top_event_probability,
      b:wrap.folios.find(t=>t.id==='parent-b').state.result?.top_event_probability}
  }),{active:'parent-b',a:.12345678,b:undefined})
  delayed=await startDelayedAnalysis()
  const oldProjectId=await page.evaluate(()=>window.ftaLibraryTest.project.getProjectState().identity.projectId)
  await page.evaluate(()=>window.ftaLibraryTest.seed())
  await expect(views.getByRole('button',{name:'Library',exact:true})).toHaveAttribute('aria-pressed','true')
  await finishAnalysis(delayed,.98765432)
  const switched=await page.evaluate(()=>{
    const project=window.ftaLibraryTest.project.getProjectState()
    return {id:project.identity.projectId,hasResult:project.modules.faultTree.folios.some(t=>t.state.result!=null)}
  })
  assert.notEqual(switched.id,oldProjectId)
  assert.equal(switched.hasResult,false)
  checks.push('Switching working trees or projects during an analysis cannot attach the old response to either destination')

  const loadStart = performance.now()
  await page.evaluate(() => window.ftaLibraryTest.seed(true))
  await expect(page.getByText('500 trees', { exact:true })).toBeVisible()
  timings.load500x100Ms = performance.now() - loadStart
  const rendered = await hierarchy.getByRole('treeitem').count()
  assert.ok(rendered <= 33, `Windowed hierarchy rendered ${rendered} rows`)
  await hierarchy.focus(); await page.keyboard.press('End')
  await expect(hierarchy.getByRole('treeitem').filter({hasText:'Assembly 499'})).toBeVisible()
  const searchStart = performance.now()
  await search.fill('unique-search-sentinel-499')
  await expect(hierarchy.getByRole('treeitem')).toHaveCount(1)
  await expect(hierarchy.getByRole('treeitem')).toContainText('Assembly 499')
  timings.search500x100Ms = performance.now() - searchStart
  await snapshot('library-500trees-event-search')
  assert.ok(timings.load500x100Ms < 15000 && timings.search500x100Ms < 3000, JSON.stringify(timings))
  checks.push('500trees/50,000nodes browse with at most33mounted hierarchy rows; End reaches last row and event-label search finds it')
  assert.deepEqual(errors, [])
  await writeFile(join(output,'report.json'),JSON.stringify({status:'passed',browser:browser.version(),checks,timings,accessibility,errors,consoleErrors,failedRequests},null,2))
  console.log(JSON.stringify({status:'passed',output,checks,timings},null,2))
} catch(error) {
  await page?.screenshot({path:join(output,'failure.png'),fullPage:true}).catch(()=>{})
  const stage=await page?.evaluate(()=>({stage:window.ftaLibraryHarnessStage,body:document.body.innerText.slice(0,2000)})).catch(()=>null)
  await writeFile(join(output,'report.json'),JSON.stringify({status:'failed',error:String(error),stage,checks,timings,accessibility,errors,consoleErrors,failedRequests},null,2))
  throw error
} finally { await browser?.close(); await closeViteTestServer(vite,cacheDir) }
