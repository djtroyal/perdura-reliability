/** Real RBD library navigation, safe subsystem insertion, and display preferences. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'
import { closeViteTestServer } from './viteTestLifecycle.mjs'

const root = new URL('..', import.meta.url).pathname
const arg = process.argv.indexOf('--output-dir')
const output = resolve(arg < 0 ? join(tmpdir(), 'perdura-rbd-library') : process.argv[arg + 1])
await mkdir(output, { recursive: true })
const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-rbd-library-vite-'))
const route = '/__rbd-library.tsx'
const fixture = `
import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import '/src/index.css'
import SystemReliability from '/src/components/SystemReliability'
import {KeyboardShortcutProvider} from '/src/components/shared/KeyboardShortcuts'
import {ReportAssetScopeProvider} from '/src/components/shared/ReportAssetScope'
import * as project from '/src/store/project'
await project.hydrateProjectStorage()
const model=(label,extra={})=>({
 nodes:[{id:'source',type:'source',position:{x:0,y:80},data:{label:'Source'}},
  {id:'block',type:'component',position:{x:180,y:80},data:{label,reliability:.95,...extra}},
  {id:'sink',type:'sink',position:{x:420,y:80},data:{label:'Sink'}}],
 edges:[{id:'a',source:'source',target:'block'},{id:'b',source:'block',target:'sink'}],
 annotations:[],missionTime:'1000',density:'comfortable',connectorStyle:'smoothstep',snapToGrid:false,showNodeIds:true,
})
const result={system_reliability:.95,system_unreliability:.05,mission_time:1000,
 components:[{id:'block',label:'Power converter',reliability:.95}],path_sets:[['Power converter']],
 warnings:[],importance:[],formulas:[],assumptions:[]}
if(project.getProjectState().projectName!=='RBD library browser'){
 project.newProject('RBD library browser')
 project.writeModuleSlices({system:{_folioWrap:true,activeId:'main',folios:[
  {id:'main',name:'Main system',state:model('Main processor')},
  {id:'power',name:'Power supply',state:{...model('Power converter'),result}},
  {id:'stale',name:'Cooling subsystem',dirty:true,state:{...model('Cooling pump'),result,sourceStale:true,sourceStaleReason:'Cooling data changed.'}},
  {id:'cycle',name:'Supervisory system',state:model('Main reference',{linkedAnalysisId:'main',linkedAnalysisName:'Main system'})},
  {id:'empty',name:'Uncalculated controller',state:model('Control channel')},
 ]}})
}
window.rbdLibraryBrowser={project,snapshot:()=>project.getProjectState()}
function App(){const [open,setOpen]=useState(true)
 return <KeyboardShortcutProvider><ReportAssetScopeProvider value={{module:'system',moduleLabel:'RBD'}}>
 <div className="perdura-theme flex h-screen min-h-0 flex-col"><nav>
 <button onClick={()=>setOpen(true)}>Open RBD workspace</button><button onClick={()=>setOpen(false)}>Leave RBD workspace</button></nav>
 {open?<SystemReliability/>:<p>Other workspace</p>}</div>
 </ReportAssetScopeProvider></KeyboardShortcutProvider>}
createRoot(document.getElementById('root')).render(<App/>)
`
const vite = await createServer({ root, cacheDir, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [{
  name: 'rbd-library-fixture', resolveId(id) { if (id === route) return id }, load(id) { if (id === route) return fixture },
  configureServer(server) { server.middlewares.use('/__rbd-library', async (req, res, next) => {
    if (!['/', ''].includes(req.url?.split('?')[0])) return next()
    res.setHeader('Content-Type', 'text/html')
    res.end(await server.transformIndexHtml('/__rbd-library', '<!doctype html><html lang="en"><head><title>RBD library regression</title></head><body><div id="root"></div><script type="module" src="/__rbd-library.tsx"></script></body></html>'))
  }) },
}] })
let browser
const errors = [], checks = []
try {
  await vite.listen()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.route(url => url.pathname.startsWith('/api/'), request => request.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ valid: true, issues: [] }),
  }))
  await page.goto('http://127.0.0.1:' + vite.httpServer.address().port + '/__rbd-library')
  const analysesTab = page.getByRole('tab', { name: /^Project analyses/ })
  await analysesTab.waitFor({ timeout: 90000 })
  await expect(page.getByRole('button', { name: /^Component block/ })).toBeVisible()
  await analysesTab.click()
  const library = page.getByRole('region', { name: 'Project RBD analyses' })
  await expect(library.getByRole('article')).toHaveCount(5)
  const current = library.getByRole('article', { name: 'Main system', exact: true })
  await expect(current.getByText('Current', { exact: true })).toBeVisible()
  await expect(current.getByRole('button', { name: 'Insert linked subsystem Main system' })).toBeDisabled()
  await expect(library.getByRole('article', { name: 'Power supply', exact: true }).getByText('Calculated', { exact: true })).toBeVisible()
  const stale = library.getByRole('article', { name: 'Cooling subsystem', exact: true })
  await expect(stale.getByText('Recalculate', { exact: true })).toBeVisible()
  await expect(stale.getByText('Cooling data changed.', { exact: true })).toBeVisible()
  const cycle = library.getByRole('article', { name: 'Supervisory system', exact: true })
  await expect(cycle.getByRole('button', { name: 'Insert linked subsystem Supervisory system' })).toBeDisabled()
  await expect(cycle.getByRole('button', { name: 'Open analysis Supervisory system' })).toBeEnabled()
  await expect(library.getByRole('article', { name: 'Uncalculated controller', exact: true }).getByText('Not calculated', { exact: true })).toBeVisible()
  checks.push('Current, stale, uncalculated, and circular-reference states are explicit; only unsafe insertion is blocked')

  const search = library.getByRole('textbox', { name: 'Search project RBD analyses' })
  await search.fill('converter')
  await expect(library.getByRole('article')).toHaveCount(1)
  await expect(library.getByRole('heading', { name: 'Power supply', exact: true })).toBeVisible()
  await search.fill('missing-analysis')
  await expect(library.getByText('No matching analyses', { exact: true })).toBeVisible()
  await library.getByRole('button', { name: 'Clear search', exact: true }).click()
  await expect(library.getByRole('article')).toHaveCount(5)
  checks.push('Search matches block labels and displays a recoverable empty state')

  // Wait for normal canvas mount persistence before taking the comparison.
  await expect.poll(() => page.evaluate(() => window.rbdLibraryBrowser.snapshot().modules.system.folios[0].state.edges[0].sourceHandle)).toBe('rbd-output')
  const mainNodes = await page.evaluate(() => window.rbdLibraryBrowser.snapshot().modules.system.folios.find(folio => folio.id === 'main').state.nodes)
  await library.getByRole('button', { name: 'Open analysis Power supply' }).click()
  await expect.poll(() => page.evaluate(() => window.rbdLibraryBrowser.snapshot().modules.system.activeId)).toBe('power')
  assert.deepEqual(await page.evaluate(() => window.rbdLibraryBrowser.snapshot().modules.system.folios.find(folio => folio.id === 'main').state.nodes), mainNodes,
    'opening an analysis must not insert a block into the previous model')
  await library.getByRole('button', { name: 'Open analysis Main system' }).click()
  await expect.poll(() => page.evaluate(() => window.rbdLibraryBrowser.snapshot().modules.system.activeId)).toBe('main')
  const targetNodes = await page.evaluate(() => window.rbdLibraryBrowser.snapshot().modules.system.folios.find(folio => folio.id === 'empty').state.nodes)
  await library.getByRole('button', { name: 'Insert linked subsystem Uncalculated controller' }).click()
  await expect.poll(() => page.evaluate(() => window.rbdLibraryBrowser.snapshot().modules.system.folios.find(folio => folio.id === 'main').state.nodes.filter(node => node.data.linkedAnalysisId === 'empty').length)).toBe(1)
  assert.equal(await page.evaluate(() => window.rbdLibraryBrowser.snapshot().modules.system.activeId), 'main')
  assert.deepEqual(await page.evaluate(() => window.rbdLibraryBrowser.snapshot().modules.system.folios.find(folio => folio.id === 'empty').state.nodes), targetNodes,
    'inserting a subsystem must leave its source model unchanged')
  checks.push('Opening navigates without insertion; explicit insertion links an uncalculated subsystem without changing its source')

  await page.getByRole('button', { name: 'Leave RBD workspace', exact: true }).click()
  await page.getByRole('button', { name: 'Open RBD workspace', exact: true }).click()
  await expect(analysesTab).toHaveAttribute('aria-selected', 'true')
  await page.evaluate(async () => { await window.rbdLibraryBrowser.project.flushProjectPersistence() })
  await page.reload()
  await expect(analysesTab).toHaveAttribute('aria-selected', 'true', { timeout: 90000 })
  await expect(page.getByRole('region', { name: 'Project RBD analyses' })).toBeVisible()
  checks.push('Library section preference survives module switches and browser reloads')
  await page.screenshot({ path: join(output, 'project-rbd-library.png') })
  await page.getByRole('tab', { name: 'Blocks', exact: true }).click()
  await page.screenshot({ path: join(output, 'rbd-block-library.png') })
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'report.json'), JSON.stringify({ status: 'passed', checks }, null, 2))
  console.log('PASS RBD library navigation, search, reference guards, insertion, and preferences')
} catch (error) {
  await writeFile(join(output, 'failure.json'), JSON.stringify({ error: String(error), errors, checks }, null, 2))
  throw error
} finally {
  await browser?.close()
  await closeViteTestServer(vite, cacheDir)
}
