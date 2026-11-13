import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'
import { closeViteTestServer } from './viteTestLifecycle.mjs'

const outputArg = process.argv.indexOf('--output-dir')
const output = outputArg < 0 ? join(tmpdir(), 'perdura-popover-menus') : resolve(process.argv[outputArg + 1])
await mkdir(output, { recursive: true })
const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-popovers-'))
const route = '/__popover_fixture.tsx'
const fixture = `
import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import '/src/index.css'
import {FunctionStatementField,CauseMechanismField,VocabularyPicker} from '/src/components/ReliabilityProgram/FmeaVocabularyAid'
import DiagramLayoutMenu from '/src/components/shared/DiagramLayoutMenu'
import DropdownDetails from '/src/components/shared/DropdownDetails'
import ExportDiagramButton from '/src/components/shared/ExportDiagramButton'
import ExportablePlot from '/src/components/shared/ExportablePlot'
import ProjectUnitsSelect from '/src/components/shared/ProjectUnitsSelect'
import DatasetUnitsControl from '/src/components/shared/DatasetUnitsControl'
import ProjectBar from '/src/components/shared/ProjectBar'
import {ModuleBookmarkMenu} from '/src/components/shared/BookmarkControls'
import {KeyboardShortcutProvider,useShortcut} from '/src/components/shared/KeyboardShortcuts'
import {hydrateProjectStorage,newProject} from '/src/store/project'
await hydrateProjectStorage();newProject('Popover tests')
function Fixture(){
 const [statement,setStatement]=useState('Supply pressure')
 const [cause,setCause]=useState({cause:'',cause_noun:'',cause_mechanism_verb:''})
 const [layout,setLayout]=useState({mode:'normal',preserveGateOrder:true,preserveEventOrder:true,optimizeLabelGeometry:true})
 const [unit,setUnit]=useState({kind:'time',unit:'hours'})
 const [outside,setOutside]=useState(0)
 const [escapes,setEscapes]=useState(0)
 useShortcut({id:'fixture.canvas.escape',label:'Canvas Escape',category:'Canvas',scope:'canvas',bindings:[{key:'Escape'}],allowInEditable:true,handler:()=>setEscapes(count=>count+1)})
 return <main className="p-6 space-y-6"><h1>Production popover behavior</h1>
 <output aria-label="Canvas Escape count">{escapes}</output>
 <button className="border p-2" onClick={()=>setOutside(value=>value+1)}>Outside action {outside}</button>
 <div className="flex gap-4"><ProjectUnitsSelect/><ProjectBar activeModule="fmea"/></div>
 <section aria-label="FMEA function"><FunctionStatementField value={statement} onChange={setStatement} kind="dfmea" targetSuggestions={[{label:'Pump',boundary:'inside'},{label:'Environment',boundary:'outside'}]}/></section>
 <section aria-label="Cause"><CauseMechanismField idPrefix="fixture" cause={cause.cause} noun={cause.cause_noun} mechanismVerb={cause.cause_mechanism_verb} structureNodes={[{id:'seal',name:'Seal',level:'component',description:'',interface:''}]} onChange={setCause}/></section>
 <div className="flex gap-5"><DiagramLayoutMenu value={layout} onChange={setLayout} onApply={setLayout}/><ExportDiagramButton getElement={()=>null}/><DatasetUnitsControl value={unit} onChange={setUnit}/><ModuleBookmarkMenu activeTab="fmea" activeModuleKey="fmea"/></div>
 <DropdownDetails className="relative"><summary>Nested popup</summary><div className="absolute z-20 bg-white border p-4"><VocabularyPicker domain="function_verb" kind="dfmea" title="Nested terms" onSelect={()=>{}}/></div></DropdownDetails>
 <details><summary>Ordinary disclosure</summary><p>Persistent explanatory content</p></details>
 <div style={{height:300,width:620}}><ExportablePlot data={[{type:'scatter',x:[0,1,2],y:[1,.8,.6]}]} layout={{title:{text:'Popup plot'}}} style={{height:300,width:620}} config={{displayModeBar:true}}/></div>
 </main>
}
createRoot(document.getElementById('root')).render(<KeyboardShortcutProvider><Fixture/></KeyboardShortcutProvider>);
`
const vite = await createServer({ root: new URL('..', import.meta.url).pathname, cacheDir,
  server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'popover-browser-fixture',
    resolveId(id) { if (id === route) return id },
    load(id) { if (id === route) return fixture },
    configureServer(server) { server.middlewares.use('/__popovers', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html')
      res.end(await server.transformIndexHtml('/__popovers', `<!doctype html><html lang="en"><head><title>Popover tests</title></head><body><div id="root"></div><script type="module" src="${route}"></script></body></html>`))
    }) },
  }],
})
let browser, page
const checks = [], errors = []
try {
  await vite.listen()
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 1050 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__popovers`)
  const outside = page.getByRole('button', { name: /^Outside action/ })
  await expect(outside).toBeVisible({ timeout: 90000 })
  let clicks = 0
  const clickOutside = async () => {
    await outside.click()
    await expect(outside).toHaveText(`Outside action ${++clicks}`)
    await expect(outside).toBeFocused()
  }
  const target = page.locator('summary').filter({ hasText: 'Choose target' })
  const targetDetails = target.locator('..')
  for (const activation of ['click', 'Enter', 'Space']) {
    if (activation === 'click') await target.click()
    else { await target.focus(); await page.keyboard.press(activation) }
    await expect(targetDetails).toHaveAttribute('open')
    await page.keyboard.press('Escape')
    await expect(targetDetails).not.toHaveAttribute('open')
    await expect(target).toBeFocused()
  }
  const canvasEscapes = page.getByRole('status', { name: 'Canvas Escape count' })
  await expect(canvasEscapes).toHaveText('0')
  await page.keyboard.press('Escape')
  await expect(canvasEscapes).toHaveText('1')
  await target.click()
  await clickOutside()
  await expect(targetDetails).not.toHaveAttribute('open')
  await target.click()
  await outside.focus()
  await expect(targetDetails).not.toHaveAttribute('open')
  await expect(outside).toBeFocused()
  await target.click()
  await page.getByRole('button', { name: 'Pump', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Optional target object or system' })).toHaveValue('Pump')
  await expect(targetDetails).not.toHaveAttribute('open')
  checks.push('FMEA target: pointer/Enter/Space activation, Escape/focus, canvas shortcut priority, outside click-through and selection')

  const layout = page.getByText('Layout: Normal', { exact: false })
  await layout.click()
  const preserve = page.getByRole('checkbox', { name: 'Preserve event order', exact: true })
  await preserve.uncheck()
  await expect(preserve).toBeVisible()
  await expect(preserve).not.toBeChecked()
  await page.keyboard.press('Escape')
  await expect(preserve).toHaveCount(0)
  await expect(layout).toBeFocused()
  await layout.click()
  await target.click()
  await expect(preserve).toHaveCount(0)
  await expect(targetDetails).toHaveAttribute('open')
  await clickOutside()
  checks.push('Diagram layout: retained inside edits, Escape/focus and switching menus')

  const noun = page.getByRole('button', { name: 'Show lower-level Structure Analysis items' })
  const nounList = page.getByRole('listbox', { name: 'Lower-level Structure Analysis items' })
  await noun.click()
  await expect(nounList).toBeVisible()
  await nounList.getByRole('option', { name: /Seal/ }).focus()
  await page.keyboard.press('Escape')
  await expect(nounList).toHaveCount(0)
  await expect(noun).toBeFocused()
  await noun.click()
  await nounList.getByRole('option', { name: /Seal/ }).click()
  await expect(page.getByRole('combobox', { name: 'Cause affected item or noun' })).toHaveValue('Seal')
  const mechanism = page.getByRole('button', { name: 'Show cause mechanism dictionary' })
  await mechanism.click()
  await clickOutside()
  await expect(page.getByRole('listbox', { name: 'Cause mechanism dictionary' })).toHaveCount(0)
  checks.push('FMEA cause: noun selection, mechanism dismissal and Escape/focus')

  const nested = page.locator('summary').filter({ hasText: 'Nested popup' })
  await nested.click()
  const dictionaryTrigger = page.getByRole('button', { name: 'Nested terms', exact: true })
  await dictionaryTrigger.click()
  const dictionary = page.getByRole('dialog', { name: 'Nested terms', exact: true })
  await dictionary.getByRole('textbox').fill('pressure')
  await expect(dictionary).toBeVisible()
  await expect(nested.locator('..')).toHaveAttribute('open')
  await page.keyboard.press('Escape')
  await expect(dictionary).toHaveCount(0)
  await expect(dictionaryTrigger).toBeFocused()
  await expect(nested.locator('..')).toHaveAttribute('open')
  await page.keyboard.press('Escape')
  await expect(nested.locator('..')).not.toHaveAttribute('open')
  await expect(nested).toBeFocused()
  checks.push('Nested dictionary portal: retained parent, inside search and one-layer-at-a-time Escape')

  const exportTrigger = page.getByRole('button', { name: 'Export', exact: true })
  await exportTrigger.click()
  await expect(page.getByRole('menu', { name: 'Export diagram format' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(exportTrigger).toBeFocused()
  await exportTrigger.click()
  await clickOutside()
  await expect(page.getByRole('menu', { name: 'Export diagram format' })).toHaveCount(0)
  const bookmarks = page.getByRole('button', { name: 'Results', exact: true })
  await bookmarks.click()
  await page.keyboard.press('Escape')
  await expect(bookmarks).toBeFocused()
  await expect(page.getByRole('dialog', { name: 'Bookmark results' })).toHaveCount(0)
  checks.push('Diagram export and bookmarks: outside dismissal and Escape/focus')
  const dataset = page.getByRole('button', { name: 'Dataset units: hours', exact: true })
  await dataset.click()
  await expect(page.getByRole('dialog', { name: 'Dataset units', exact: true })).toBeVisible()
  await clickOutside()
  await expect(page.getByRole('dialog', { name: 'Dataset units', exact: true })).toHaveCount(0)
  const units = page.getByRole('combobox', { name: 'Project units', exact: true })
  await expect(units).toHaveValue('hours')
  assert.deepEqual(await units.locator('option').allTextContents(), ['hours', 'days', 'weeks', 'months', 'years', 'cycles', 'km', 'miles'])
  checks.push('Dataset units popup and unit-only native Project Units selector')

  const openProject = page.getByRole('button', { name: 'Open a saved project', exact: true })
  await openProject.click()
  await page.keyboard.press('Escape')
  await expect(openProject).toHaveAttribute('aria-expanded', 'false')
  await expect(openProject).toBeFocused()
  await openProject.click()
  await clickOutside()
  await expect(openProject).toHaveAttribute('aria-expanded', 'false')
  await page.getByText('Ordinary disclosure', { exact: true }).click()
  await clickOutside()
  await expect(page.getByText('Persistent explanatory content', { exact: true })).toBeVisible()
  checks.push('Project Open: immediate Escape and outside dismissal; ordinary content disclosures remain open')

  const download = page.locator('[data-title="Download plot"]')
  await expect(download).toBeVisible({ timeout: 90000 })
  await download.click()
  await expect(page.getByRole('menu', { name: 'Download plot format' })).toBeVisible()
  await clickOutside()
  await expect(page.getByRole('menu', { name: 'Download plot format' })).toHaveCount(0)
  await download.click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu', { name: 'Download plot format' })).toHaveCount(0)
  const annotate = page.locator('[data-title="Annotate plot"]')
  await annotate.click()
  await expect(page.getByRole('button', { name: 'Close plot tools' })).toBeVisible()
  await clickOutside()
  await expect(page.getByRole('button', { name: 'Close plot tools' })).toHaveCount(0)
  checks.push('Plotly download and annotation tool menus: outside and Escape dismissal')
  assert.deepEqual(errors, [])
  await page.screenshot({ path: join(output, 'popovers.png'), fullPage: true })
  await writeFile(join(output, 'report.json'), JSON.stringify({ passed: checks.length, checks, errors }, null, 2))
  console.log(JSON.stringify({ passed: checks.length, output, checks }, null, 2))
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  await writeFile(join(output, 'report.json'), JSON.stringify({ passed: checks.length, checks, errors,
    failure: error instanceof Error ? error.message : String(error) }, null, 2))
  throw error
} finally {
  await browser?.close()
  await closeViteTestServer(vite, cacheDir)
}
