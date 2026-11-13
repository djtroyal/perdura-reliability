/** Exercises virtual observation rows without numerical APIs or project mutations. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'
import { closeViteTestServer } from './viteTestLifecycle.mjs'

const root = new URL('..', import.meta.url).pathname
const argument = process.argv.indexOf('--output-dir')
const output = resolve(argument < 0 ? join(tmpdir(), 'perdura-life-data-entry') : process.argv[argument + 1])
await mkdir(output, { recursive: true })
const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-life-data-entry-vite-'))
const route = '/__life-data-entry.tsx'
const fixture = `
import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import '/src/index.css'
import EditableLifeDataTable from '/src/components/LifeData/EditableLifeDataTable'
import GroupedDataGrid from '/src/components/LifeData/GroupedDataGrid'
import {extractLifeObservations,lifeDataObservationSignature} from '/src/components/shared/adoptedDistribution'
let sequence=0
const newRow=()=>({key:'entry-'+(++sequence),id:'',time:'',state:'F'})
const newFrequency=()=>({...newRow(),count:'1'})
const newInterval=()=>({key:'entry-'+(++sequence),id:'',lower:'',upper:'',count:'1'})
function App(){
 const [rows,setRows]=useState([{...newRow(),id:'B',time:'20'},newRow(),{...newRow(),id:'A',time:'10'}])
 const [frequency,setFrequency]=useState([newFrequency(),newFrequency()])
 const [interval,setInterval]=useState([newInterval(),newInterval()])
 const [expanded,setExpanded]=useState(false)
 const [changes,setChanges]=useState(0)
 window.entryBrowser={rows,frequency,interval,changes,
  signature:()=>lifeDataObservationSignature({id:'entry',dataFormat:'individual',rows}),
  validate:()=>{try{extractLifeObservations({id:'entry',dataFormat:'individual',rows});return null}catch(error){return error.message}}}
 const change=setter=>value=>{setter(value);setChanges(previous=>previous+1)}
 return <main className="perdura-theme mx-auto max-w-4xl space-y-4 p-5">
 <h1>Life Data entry</h1><button onClick={()=>setExpanded(value=>!value)}>Toggle expanded data</button>
 <section aria-label="Individual entry"><EditableLifeDataTable rows={rows} units="hours" expanded={expanded} onChange={change(setRows)} newRow={newRow}/></section>
 <section aria-label="Frequency entry"><GroupedDataGrid format="frequency" rows={frequency} units="hours" expanded={expanded} onChange={change(setFrequency)} newRow={newFrequency}/></section>
 <section aria-label="Interval entry"><GroupedDataGrid format="interval" rows={interval} units="hours" expanded={expanded} onChange={change(setInterval)} newRow={newInterval}/></section>
 <button>After all data tables</button>
 </main>
}
createRoot(document.getElementById('root')).render(<App/>)
`
const vite = await createServer({ root, cacheDir, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [{
  name: 'life-data-entry-fixture', resolveId(id) { if (id === route) return id }, load(id) { if (id === route) return fixture },
  configureServer(server) { server.middlewares.use('/__life-data-entry', async (req, res, next) => {
    if (!['/', ''].includes(req.url?.split('?')[0])) return next()
    res.setHeader('Content-Type', 'text/html')
    res.end(await server.transformIndexHtml('/__life-data-entry', '<!doctype html><html lang="en"><head><title>Life Data entry regression</title></head><body><div id="root"></div><script type="module" src="/__life-data-entry.tsx"></script></body></html>'))
  }) },
}] })
let browser
const errors = [], checks = []
try {
  await vite.listen()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1200, height: 1100 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('http://127.0.0.1:' + vite.httpServer.address().port + '/__life-data-entry')
  const individual = page.getByRole('region', { name: 'Individual entry' })
  const frequency = page.getByRole('region', { name: 'Frequency entry' })
  const interval = page.getByRole('region', { name: 'Interval entry' })
  const blank = section => section.locator('tbody tr[data-placeholder="true"]')
  await blank(individual).waitFor({ timeout: 90000 })
  await expect(individual.locator('tbody tr')).toHaveCount(3)
  await expect(frequency.locator('tbody tr')).toHaveCount(1)
  await expect(interval.locator('tbody tr')).toHaveCount(1)
  await expect(page.getByRole('button', { name: /Add (grouped )?row/i })).toHaveCount(0)
  assert.equal(await page.evaluate(() => window.entryBrowser.changes), 0)
  const originalRows = await page.evaluate(() => window.entryBrowser.rows)
  const originalSignature = await page.evaluate(() => window.entryBrowser.signature())
  await page.getByRole('button', { name: 'Toggle expanded data' }).click()
  await page.getByRole('button', { name: 'Toggle expanded data' }).click()
  assert.equal(await page.evaluate(() => window.entryBrowser.changes), 0)
  checks.push('Mounting/expanding preserve stored rows; legacy empty rows are hidden and each format has exactly one virtual entry row')

  await individual.getByRole('button', { name: 'Sort by Value (hours)', exact: true }).click()
  assert.deepEqual(await individual.locator('input[data-col="time"]').evaluateAll(inputs => inputs.map(input => [input.value, input.dataset.row])), [['10', '2'], ['20', '0'], ['', '3']])
  await individual.locator('input[data-row="2"][data-col="time"]').press('Enter')
  await expect(individual.locator('input[data-row="0"][data-col="time"]')).toBeFocused()
  await individual.locator('input[data-row="0"][data-col="time"]').press('Enter')
  await expect(blank(individual).locator('input[data-col="time"]')).toBeFocused()
  const oldCount = await page.evaluate(() => window.entryBrowser.rows.length)
  await page.keyboard.press('Enter')
  assert.equal(await page.evaluate(() => window.entryBrowser.rows.length), oldCount)
  assert.deepEqual(await page.evaluate(() => window.entryBrowser.rows), originalRows)
  assert.equal(await page.evaluate(() => window.entryBrowser.signature()), originalSignature,
    'sorting, focus, expansion, and Enter on the placeholder must not change the observation fingerprint')
  await page.keyboard.type('12e')
  assert.equal(await page.evaluate(() => window.entryBrowser.rows.at(-1).time), '12e')
  assert.match(await page.evaluate(() => window.entryBrowser.validate()), /finite number/,
    'partial numeric input must remain present and invalid rather than being silently dropped')
  await expect(page.locator(':focus')).toHaveValue('12e')
  await expect(blank(individual)).toHaveCount(1)
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('123')
  assert.equal(await page.evaluate(() => window.entryBrowser.rows.at(-1).time), '123')
  await page.keyboard.press('Enter')
  await expect(blank(individual).locator('input[data-col="time"]')).toBeFocused()
  checks.push('Sorting retains raw indices; Enter follows visible order; promotion retains caret/focus and partial numeric text')

  const addedKey = await page.evaluate(() => window.entryBrowser.rows.at(-1).key)
  const addedInput = individual.locator(`tr[data-entry-key="${addedKey}"] input[data-col="time"]`)
  await addedInput.fill('')
  await expect(addedInput).toBeFocused()
  await addedInput.pressSequentially('45')
  await expect(addedInput).toHaveValue('45')
  await addedInput.fill('')
  await page.getByRole('button', { name: 'Toggle expanded data' }).click()
  await expect(individual.locator(`tr[data-entry-key="${addedKey}"]`)).toHaveCount(0)
  await blank(individual).getByRole('button', { name: /New row: Fail/ }).click()
  const beforeStateEntry = await page.evaluate(() => window.entryBrowser.rows.length)
  await blank(individual).locator('input[data-col="id"]').fill('Asset-7')
  assert.equal(await page.evaluate(() => window.entryBrowser.rows.length), beforeStateEntry + 1)
  assert.deepEqual(await page.evaluate(() => ({ id: window.entryBrowser.rows.at(-1).id, state: window.entryBrowser.rows.at(-1).state, time: window.entryBrowser.rows.at(-1).time })), { id: 'Asset-7', state: 'S', time: '' })
  checks.push('Clearing an active row keeps focus and permits replacement; leaving a blank row hides it; ID-first and F/S choices are retained')

  await blank(frequency).locator('input[data-col="time"]').pressSequentially('77')
  await expect(page.locator(':focus')).toHaveValue('77')
  assert.equal(await page.evaluate(() => window.entryBrowser.frequency.at(-1).time), '77')
  await frequency.locator('tbody tr:not([data-placeholder]) input[data-col="count"]').fill('1e')
  assert.equal(await page.evaluate(() => window.entryBrowser.frequency.at(-1).count), '1e')
  await frequency.locator('tbody tr:not([data-placeholder]) input[data-col="count"]').fill('4')
  await frequency.getByRole('button', { name: /^Delete row/ }).click()
  await expect(frequency.locator('tbody tr')).toHaveCount(1)
  checks.push('Frequency entry preserves partial counts and deleting its last observation leaves only the virtual row')

  await blank(interval).locator('input[data-col="upper"]').pressSequentially('90')
  await expect(page.locator(':focus')).toHaveValue('90')
  assert.deepEqual(await page.evaluate(() => ({ lower: window.entryBrowser.interval.at(-1).lower, upper: window.entryBrowser.interval.at(-1).upper })), { lower: '', upper: '90' })
  await page.keyboard.press('Enter')
  await expect(blank(interval).locator('input[data-col="upper"]')).toBeFocused()
  await blank(interval).locator('input[data-col="count"]').focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'After all data tables', exact: true })).toBeFocused()
  checks.push('Interval upper-bound-first censoring is retained; Enter advances and Tab exits the final placeholder normally')
  assert.deepEqual(errors, [])
  await page.screenshot({ path: join(output, 'life-data-entry.png') })
  await writeFile(join(output, 'report.json'), JSON.stringify({ status: 'passed', checks }, null, 2))
  console.log('PASS all Life Data formats: blank-entry rows, typing/focus, sorting, clearing, deletion, and keyboard navigation')
} catch (error) {
  await writeFile(join(output, 'failure.json'), JSON.stringify({ error: String(error), errors, checks }, null, 2))
  throw error
} finally {
  await browser?.close()
  await closeViteTestServer(vite, cacheDir)
}
