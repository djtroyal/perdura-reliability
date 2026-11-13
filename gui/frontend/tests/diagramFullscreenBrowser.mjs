/** Full-screen transitions retain the real editable graph and inspector. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'
import { closeViteTestServer } from './viteTestLifecycle.mjs'
const root = new URL('..', import.meta.url).pathname
const outputArg = process.argv.indexOf('--output-dir')
const output = outputArg < 0 ? join(tmpdir(), 'perdura-diagram-fullscreen') : resolve(process.argv[outputArg + 1])
await mkdir(output, { recursive: true })
const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-fullscreen-vite-'))
const route = '/__diagram-fullscreen.tsx'
const fixture = `
import React from 'react'
import {createRoot} from 'react-dom/client'
import '/src/index.css'
import {FaultTreeEditor} from '/src/components/FaultTree'
import RBD from '/src/components/SystemReliability'
import Markov from '/src/components/Markov'
import {KeyboardShortcutProvider} from '/src/components/shared/KeyboardShortcuts'
import {ReportAssetScopeProvider} from '/src/components/shared/ReportAssetScope'
import * as project from '/src/store/project'
const kind=new URL(location.href).searchParams.get('module')||'fta'
await project.hydrateProjectStorage()
project.newProject('Fullscreen '+kind)
const fta={nodes:[{id:'g',type:'or',position:{x:180,y:40},data:{label:'Top event'}},
 {id:'a',type:'basic',position:{x:180,y:240},data:{label:'Editable block',probability:.1,eventKey:'a'}}],
 edges:[{id:'ga',source:'g',target:'a',data:{role:'input',order:0}}],annotations:[],exposureTime:'1000',density:'comfortable',snapToGrid:false}
const rbd={nodes:[{id:'source',type:'source',position:{x:0,y:100},data:{label:'Source'}},
 {id:'a',type:'component',position:{x:200,y:100},data:{label:'Editable block',reliability:.9}},
 {id:'sink',type:'sink',position:{x:440,y:100},data:{label:'Sink'}}],
 edges:[{id:'sa',source:'source',target:'a'},{id:'at',source:'a',target:'sink'}],annotations:[],density:'comfortable',missionTime:'1000',snapToGrid:false}
const markov={states:[{id:'a',name:'Editable block',state_type:'operational'},{id:'b',name:'Failed',state_type:'failed'}],
 transitions:[{id:'ab',from_state:'a',to_state:'b',rate:.01}],initialState:'a',positions:{a:{x:80,y:150},b:{x:380,y:150}},annotations:[],density:'comfortable',snapToGrid:false}
const moduleKey=kind==='fta'?'faultTree':kind==='rbd'?'system':'markov'
project.setModuleState(moduleKey,{_folioWrap:true,activeId:'canvas',folios:[{id:'canvas',name:'Fullscreen fixture',state:kind==='fta'?fta:kind==='rbd'?rbd:markov}]})
window.fullscreenTest={project,snapshot:()=>project.getProjectState().modules[moduleKey].folios[0].state}
createRoot(document.getElementById('root')).render(<KeyboardShortcutProvider><ReportAssetScopeProvider value={{module:moduleKey,moduleLabel:kind}}>
 <div className="perdura-theme flex h-screen min-h-0 flex-col"><button type="button">Outside canvas</button><div className="flex min-h-0 flex-1">{kind==='fta'?<FaultTreeEditor/>:kind==='rbd'?<RBD/>:<Markov/>}</div></div>
 </ReportAssetScopeProvider></KeyboardShortcutProvider>)
`
const vite = await createServer({ root, cacheDir, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [{
  name: 'diagram-fullscreen-fixture', resolveId(id) { if (id === route) return id }, load(id) { if (id === route) return fixture },
  configureServer(server) { server.middlewares.use('/__diagram-fullscreen', async (req, res, next) => {
    if (!['/', ''].includes(req.url?.split('?')[0])) return next()
    res.setHeader('Content-Type', 'text/html')
    res.end(await server.transformIndexHtml('/__diagram-fullscreen', '<!doctype html><html lang="en"><head><title>Diagram fullscreen regression</title></head><body><div id="root"></div><script type="module" src="/__diagram-fullscreen.tsx"></script></body></html>'))
  }) },
}] })
let browser
const errors = [], checks = []
try {
  await vite.listen(); browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ valid: true, issues: [], analysis_kind: 'static_coherent' }) }))
  const settle = () => page.evaluate(async () => {
    let last = '', stable = 0
    for (let i = 0; i < 100; i++) {
      await new Promise(requestAnimationFrame)
      const current = document.querySelector('.react-flow__viewport')?.getAttribute('style') ?? ''
      stable = current === last ? stable + 1 : 0; last = current
      if (i > 15 && stable >= 5) return
    }
    throw new Error('Diagram viewport did not settle')
  })
  for (const kind of ['fta', 'rbd', 'markov']) {
    await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__diagram-fullscreen?module=${kind}`)
    const expand = page.getByRole('button', { name: 'Expand diagram to full screen', exact: true })
    await expect(expand).toBeVisible({ timeout: 90000 })
    const node = page.locator('.react-flow__node[data-id="a"]')
    await expect(node).toBeVisible()
    await settle()
    await node.click()
    const labelInput = kind === 'fta' ? page.locator('[data-fta-properties-pane] input').first()
      : page.getByLabel(kind === 'markov' ? 'Name' : 'Label', { exact: true })
    await expect(labelInput).toHaveValue('Editable block')
    await settle()
    const initial = await page.evaluate(() => {
      window.fullscreenTest.node = document.querySelector('.react-flow__node[data-id="a"]')
      window.fullscreenTest.flow = document.querySelector('.react-flow')
      const area = window.fullscreenTest.flow.getBoundingClientRect()
      return { width: area.width, transform: document.querySelector('.react-flow__viewport').getAttribute('style') }
    })
    await expand.click()
    const dialog = page.getByRole('dialog', { name: /diagram — full screen/ })
    await expect(dialog).toBeVisible()
    await settle()
    assert.ok((await page.locator('.react-flow').boundingBox()).width > initial.width + 200, `${kind}: canvas gains library width`)
    assert.equal(await page.evaluate(() => window.fullscreenTest.node === document.querySelector('.react-flow__node[data-id="a"]')
      && window.fullscreenTest.flow === document.querySelector('.react-flow')), true, `${kind}: graph stays mounted`)
    await expect(labelInput).toBeVisible()
    await labelInput.fill(`Edited ${kind}`)
    await expect(node).toContainText(`Edited ${kind}`)
    await expect.poll(() => page.evaluate(kind => {
      const state = window.fullscreenTest.snapshot()
      return kind === 'markov' ? state.states.find(item => item.id === 'a')?.name : state.nodes.find(item => item.id === 'a')?.data.label
    }, kind)).toBe(`Edited ${kind}`)
    await node.click()
    await page.locator('.react-flow').evaluate(flow => flow.parentElement.focus())
    await page.keyboard.press('Control+c')
    await expect(page.getByRole('button', { name: 'Paste', exact: true })).toBeEnabled()
    // Native popup Escape takes precedence over closing the full-screen editor.
    await page.getByLabel('Diagram layout', { exact: true }).click()
    await expect(page.locator('details[data-dropdown-menu][open]')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(page.locator('details[data-dropdown-menu][open]')).toHaveCount(0)
    await expect(dialog).toBeVisible()
    await expect(page.getByLabel('Diagram layout', { exact: true })).toBeFocused()
    // Keyboard focus cycles within the full-screen graph and its inspector.
    await dialog.evaluate(root => {
      const items = [...root.querySelectorAll('button,input,select,textarea,summary,a[href],[tabindex]')]
        .filter(item => item.tabIndex >= 0 && !item.disabled && item.getClientRects().length > 0)
      window.fullscreenTest.firstTab = items[0]; window.fullscreenTest.lastTab = items[items.length - 1]
      items[items.length - 1].focus()
    })
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => document.activeElement === window.fullscreenTest.firstTab), true)
    await page.keyboard.press('Shift+Tab')
    assert.equal(await page.evaluate(() => document.activeElement === window.fullscreenTest.lastTab), true)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await settle()
    await expect(expand).toBeFocused()
    assert.equal(await page.evaluate(() => document.body.style.overflow), '')
    assert.equal(await page.locator('.react-flow__viewport').getAttribute('style'), initial.transform, `${kind}: original viewport restored`)
    assert.equal(await page.evaluate(() => window.fullscreenTest.node === document.querySelector('.react-flow__node[data-id="a"]')), true)
    await expect(labelInput).toHaveValue(`Edited ${kind}`)
    await expand.click(); await settle()
    const oldPosition = await node.getAttribute('style'), box = await node.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 65, box.y + box.height / 2 + 50, { steps: 8 }); await page.mouse.up()
    await expect.poll(() => node.getAttribute('style')).not.toBe(oldPosition)
    await page.getByRole('button', { name: 'Restore diagram', exact: true }).click(); await settle()
    await expect(expand).toBeFocused()
    await expect(node).toHaveClass(/selected/)
    await page.screenshot({ path: join(output, `${kind}-restored.png`) })
    checks.push({ kind, editable: true, graphRetained: true, keyboardAndFocus: true, viewportRestored: true })
  }
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'report.json'), JSON.stringify({ checks, errors }, null, 2))
  console.log(JSON.stringify({ passed: checks.length, output, checks }, null, 2))
} catch (error) { console.error('Browser errors:', errors); throw error }
finally { await browser?.close(); await closeViteTestServer(vite, cacheDir) }
