/** Behavioral performance contracts with real React/react-plotly subscriptions.
 * Plotly's rendering engine is stubbed: this measures boundary calls, not GPU
 * performance. The production Plotly assurance journey covers actual rendering.
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import { resolve } from 'node:path'
import { closeViteTestServer } from './viteTestLifecycle.mjs'

const root = new URL('..', import.meta.url).pathname
const args = process.argv.slice(2)
const outputIndex = args.indexOf('--output-dir')
const outputDir = outputIndex >= 0 ? args[outputIndex + 1] : null
if (outputIndex >= 0 && !outputDir) throw new Error('--output-dir requires a path')
const fixturePath = resolve(root, 'tests/performance-fixture.tsx')
const stubId = '\0perdura-performance-plotly'
const fixture = `
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import * as project from '/src/store/project.ts'
import { registerRuntimePlotAsset } from '/src/store/runtimePlotAssets.ts'
import { ModuleBookmarkMenu } from '/src/components/shared/BookmarkControls.tsx'
import ProjectBar from '/src/components/shared/ProjectBar.tsx'
import Plot from '/src/components/shared/ExportablePlotInner.tsx'
import { ToastViewport } from '/src/components/shared/toast.tsx'
window.__performanceCounts = { assets: 0, history: 0, ledger: 0, plotReact: 0 }
window.__plot = { calls: [], relayouts: [] }
project.newProject('Performance fixture')
project.setModuleState('growth', { input: 1 })
project.setModuleState('growth', { input: 1, other: 2 })
const initialData = [{ x: [1, 2], y: [3, 4], type: 'scatter', mode: 'lines' }]
const initialLayout = { xaxis: { range: [0, 4] }, yaxis: { range: [0, 5] } }
const initialConfig = { responsive: true }
function Fixture() {
  const [data, setData] = useState(initialData)
  const [layout, setLayout] = useState(initialLayout)
  const [config, setConfig] = useState(initialConfig)
  const [callbackVersion, setCallbackVersion] = useState(1)
  const [hoverEnabled, setHoverEnabled] = useState(false)
  const [markup, setMarkup] = useState({ annotations: [], shapes: [] })
  window.__fixture = { project, registerRuntimePlotAsset, setData, setLayout, setConfig,
    setCallbackVersion, setHoverEnabled, markup }
  return <>
    <ToastViewport />
    <ModuleBookmarkMenu activeTab="growth" activeModuleKey="growth" />
    <ProjectBar activeModule="growth" />
    <Plot data={data} layout={layout} config={config} userMarkup={markup}
      onUserMarkupChange={setMarkup}
      onClick={() => { window.__lastClick = callbackVersion }}
      onHover={hoverEnabled ? () => { window.__lastHover = callbackVersion } : undefined}
      onError={error => { throw error }} />
  </>
}
createRoot(document.getElementById('root')).render(<Fixture />)
`
const plotlyStub = `
const Plotly = {
  react: async (gd, figure) => {
    window.__performanceCounts.plotReact++
    window.__plot.calls.push(figure)
    window.__plot.gd = gd
    gd.data = figure.data
    gd.layout = figure.layout
    gd._fullLayout = figure.layout
    gd._handlers ??= {}
    gd.on = (name, callback) => { (gd._handlers[name] ??= new Set()).add(callback) }
    gd.removeListener = (name, callback) => { gd._handlers[name]?.delete(callback) }
    gd.emit = (name, event) => { for (const callback of gd._handlers[name] ?? []) callback(event) }
    return gd
  },
  relayout: async (gd, updates) => { window.__plot.relayouts.push(updates); return gd },
  toImage: () => {
    const error = new Error(window.__plotExportFailure)
    if (window.__plotExportFailure === 'Synchronous image failure') throw error
    return Promise.reject(error)
  },
  purge: () => {}, Plots: { resize: () => {} }, Icons: {},
}
export default Plotly
`
const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-performance-vite-'))
const vite = await createServer({
  cacheDir,
  root, appType: 'custom',
  plugins: [{
    name: 'performance-contract-instrumentation', enforce: 'pre',
    resolveId(source, importer) {
      if (source.endsWith('performance-fixture.tsx')) return fixturePath
      if (source === './plotly' && importer?.endsWith('ExportablePlotInner.tsx')) return stubId
    },
    load(id) {
      if (id === fixturePath) return fixture
      if (id === stubId) return plotlyStub
    },
    transform(code, id) {
      const targets = id.endsWith('/store/project.ts') ? [
        ['function historyItems(stack: HistoryEntry[]): ProjectHistoryItem[] {', 'history'],
        ['export function getProvenanceLedger() {', 'ledger'],
      ] : id.endsWith('/store/assetExtractors.ts') ? [
        ['export function enumerateAssets(): AssetDescriptor[] {', 'assets'],
      ] : []
      for (const [marker, counter] of targets) {
        if (!code.includes(marker)) throw new Error(`Instrumentation target missing: ${marker}`)
        code = code.replace(marker, marker + `\nif (globalThis.__performanceCounts) globalThis.__performanceCounts.${counter}++;`)
      }
      return targets.length ? { code, map: null } : null
    },
    configureServer(server) {
      server.middlewares.use('/__performance__', async (_req, res) => {
        res.setHeader('Content-Type', 'text/html')
        res.end(await server.transformIndexHtml('/__performance__', '<html><body><div id="root"></div><script type="module" src="/tests/performance-fixture.tsx"></script></body></html>'))
      })
    },
  }],
  server: { host: '127.0.0.1', port: 0, strictPort: false },
})
let browser
try {
  await vite.listen()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__performance__`)
  await page.waitForFunction(() => window.__plot?.calls.length >= 1)
  const counts = () => page.evaluate(() => ({ ...window.__performanceCounts }))
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await settle()
  const before = await counts()
  assert.deepEqual({ assets: before.assets, history: before.history, ledger: before.ledger },
    { assets: 0, history: 0, ledger: 0 }, 'closed mounted panels perform no expensive derivation')
  await page.evaluate(() => {
    const p = window.__fixture.project
    for (let i = 0; i < 20; i++) p.setModuleState('growth', { input: i, other: 2 })
  })
  await settle()
  const after = await counts()
  assert.equal(after.assets, 0)
  assert.equal(after.history, 0)
  assert.equal(after.ledger, 0)

  const results = page.getByRole('button', { name: /Results/ })
  await results.click()
  await expect(page.getByText('Run an analysis to create bookmarkable results.')).toBeVisible()
  assert.ok((await counts()).assets > 0)
  await results.click()
  const closedAssets = (await counts()).assets
  await page.evaluate(() => {
    window.__fixture.registerRuntimePlotAsset({ module: 'growth', moduleLabel: 'Reliability Growth',
      group: 'Current', label: 'Latest result', plotData: [{ x: [1], y: [2] }] })
    window.__fixture.project.setModuleState('growth', { input: 50 })
  })
  await settle()
  assert.equal((await counts()).assets, closedAssets)
  await results.click()
  await expect(page.getByRole('button', { name: /Latest result/ })).toBeVisible()
  await results.click()
  await page.getByRole('button', { name: 'Show undo history' }).click()
  await expect(page.getByRole('menu', { name: 'Undo history' })).toBeVisible()
  assert.ok((await counts()).history > 0)
  await page.keyboard.press('Escape')
  const closedHistory = (await counts()).history
  await page.evaluate(() => window.__fixture.project.setModuleState('growth', { input: 51, added: true }))
  await settle()
  assert.equal((await counts()).history, closedHistory)

  await page.getByRole('button', { name: 'Export data to a file' }).click()
  await page.getByRole('button', { name: /Provenance & verify/ }).click()
  await expect(page.getByRole('dialog', { name: 'Provenance and verification' })).toBeVisible()
  assert.ok((await counts()).ledger > 0)
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  const closedLedger = (await counts()).ledger
  await page.evaluate(() => window.__fixture.project.recordExportLedger({
    artifactId: 'after-close', filename: 'Latest.csv', sha256: 'abc', generatedAt: '2026-09-14',
  }))
  await settle()
  assert.equal((await counts()).ledger, closedLedger)
  await page.getByRole('button', { name: 'Export data to a file' }).click()
  await page.getByRole('button', { name: /Provenance & verify/ }).click()
  await expect(page.getByText('Latest.csv', { exact: true })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()

  const plotCalls = (await counts()).plotReact
  await page.evaluate(() => window.__plot.calls.at(-1).config.modeBarButtonsToAdd.find(b => b.name === 'Annotate plot').click())
  await expect(page.getByText('Plot tools', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close plot tools' }).click()
  await page.evaluate(() => window.__plot.calls.at(-1).config.modeBarButtonsToAdd.find(b => b.name === 'perdura-download').click(window.__plot.gd))
  await expect(page.getByRole('menu', { name: 'Download plot format' })).toBeVisible()
  await page.keyboard.press('Escape')
  await settle()
  assert.equal((await counts()).plotReact, plotCalls, 'tool visibility must not rerender the Plotly figure')

  await page.evaluate(() => window.__fixture.setCallbackVersion(2))
  await settle()
  await page.evaluate(() => window.__plot.gd.emit('plotly_click', { points: [] }))
  assert.equal(await page.evaluate(() => window.__lastClick), 2, 'existing event handlers see current closures without Plotly.react')
  assert.equal((await counts()).plotReact, plotCalls)
  await page.evaluate(() => window.__fixture.setHoverEnabled(true))
  await expect.poll(async () => (await counts()).plotReact).toBe(plotCalls + 1)
  await page.evaluate(() => window.__plot.gd.emit('plotly_hover', { points: [] }))
  assert.equal(await page.evaluate(() => window.__lastHover), 2, 'new event kinds are attached')
  await page.evaluate(() => window.__fixture.setHoverEnabled(false))
  await expect.poll(async () => (await counts()).plotReact).toBe(plotCalls + 2)
  await page.evaluate(() => { window.__lastHover = null; window.__plot.gd.emit('plotly_hover', { points: [] }) })
  assert.equal(await page.evaluate(() => window.__lastHover), null, 'removed event kinds are detached')
  await page.evaluate(() => window.__fixture.setConfig({ responsive: false, scrollZoom: false }))
  await expect.poll(async () => (await counts()).plotReact).toBe(plotCalls + 3)
  assert.equal(await page.evaluate(() => window.__plot.calls.at(-1).config.scrollZoom), false)
  await page.evaluate(() => window.__fixture.setLayout({ xaxis: { range: [0, 10] } }))
  await expect.poll(async () => (await counts()).plotReact).toBe(plotCalls + 4)
  await page.evaluate(() => window.__plot.calls.at(-1).config.modeBarButtonsToAdd.find(b => b.name === 'perdura-reset-view').click(window.__plot.gd))
  assert.deepEqual(await page.evaluate(() => window.__plot.relayouts.at(-1)['xaxis.range']), [0, 10], 'reset callback uses the latest authored layout')
  await page.evaluate(() => window.__fixture.setData([{ x: [2, 3], y: [5, 6], type: 'scatter' }]))
  await expect.poll(async () => (await counts()).plotReact).toBe(plotCalls + 5)
  assert.deepEqual(await page.evaluate(() => window.__plot.calls.at(-1).data[0].y), [5, 6])
  await page.evaluate(() => window.__fixture.project.newProject('History arrow thresholds'))
  await expect(page.getByRole('button', { name: 'Show undo history' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Show redo history' })).toHaveCount(0)
  await page.evaluate(() => window.__fixture.project.setModuleState('growth', { input: 1 }))
  await expect(page.getByRole('button', { name: 'Show undo history' })).toHaveCount(0)
  await page.evaluate(() => window.__fixture.project.setModuleState('growth', { input: 1, other: 2 }))
  await expect(page.getByRole('button', { name: 'Show undo history' })).toHaveCount(1)
  await page.evaluate(() => window.__fixture.project.undo())
  await expect(page.getByRole('button', { name: 'Show redo history' })).toHaveCount(0)
  await page.evaluate(() => window.__fixture.project.undo())
  await expect(page.getByRole('button', { name: 'Show redo history' })).toHaveCount(1)
  for (const failure of ['Synchronous image failure', 'Asynchronous image failure']) {
    await page.evaluate(message => {
      window.__plotExportFailure = message
      window.__plot.calls.at(-1).config.modeBarButtonsToAdd
        .find(button => button.name === 'perdura-download').click(window.__plot.gd)
    }, failure)
    await page.getByRole('menuitem', { name: /SVG vector/ }).click()
    const alert = page.getByRole('alert').filter({ hasText: failure })
    await expect(alert).toBeVisible()
    await alert.getByRole('button', { name: 'Dismiss notification' }).click()
  }
  assert.deepEqual(errors, [])
  const report = { schema: 'perdura.frontend-performance-contracts/v1', status: 'passed',
    generatedAt: new Date().toISOString(), node: process.version,
    reactPlotlyVersion: JSON.parse(await readFile(resolve(root, 'node_modules/react-plotly.js/package.json'), 'utf8')).version,
    closedPanelEdits: 20,
    closedPanelDerivations: { assets: 0, history: 0, ledger: 0 }, toolbarPlotlyReactCalls: 0,
    semanticChangesAndLatestCallbacks: 'passed', exportFailureHandling: 'passed',
    engine: 'Plotly API stub with installed react-plotly factory',
    interpretation: 'Deterministic work-count assertions; no rendering-speed or GPU-performance claim.' }
  if (outputDir) {
    await mkdir(outputDir, { recursive: true })
    await writeFile(resolve(outputDir, 'performance-contracts.json'), JSON.stringify(report, null, 2) + '\n')
  }
  console.log(JSON.stringify(report))
} finally {
  try { await browser?.close() }
  finally { await closeViteTestServer(vite, cacheDir) }
}
