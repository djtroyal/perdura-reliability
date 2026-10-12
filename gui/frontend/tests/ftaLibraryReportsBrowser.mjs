import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import { closeViteTestServer } from './viteTestLifecycle.mjs'
const root = fileURLToPath(new URL('..', import.meta.url))
const option = process.argv.indexOf('--output-dir')
const output = resolve(option < 0 ? join(tmpdir(), 'perdura-fta-report-browser') : process.argv[option + 1])
await mkdir(output, { recursive: true })
const cacheDir = await mkdtemp(join(tmpdir(), 'fta-report-browser-'))
const route = '/__fta-report-test.tsx'
const fixture = `
import '/src/index.css'
import * as project from '/src/store/project'
import * as model from '/src/components/FaultTree/libraryModel'
import * as library from '/src/components/FaultTree/libraryReports'
import * as reporting from '/src/components/ReportBuilder'
import * as assets from '/src/store/assetExtractors'
import { renderFtaDiagram } from '/src/components/FaultTree/ReadOnlyFaultTreeDiagram'
import { CURRENT_ENGINE_REVISIONS } from '/src/version'
window.ftaReportTest = {project,model,library,reporting,assets,renderFtaDiagram,revision:CURRENT_ENGINE_REVISIONS.faultTree}
document.getElementById('root').textContent = 'FTA report browser ready'
`
const vite = await createServer({ root, cacheDir, logLevel: 'error', optimizeDeps: { include: ['jspdf', 'html-to-image', 'fflate', '@xyflow/react', 'papaparse', 'react-dom/client'] }, server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [{
  name: 'fta-report-browser-fixture', resolveId(id) { if (id === route) return id }, load(id) { if (id === route) return fixture },
  configureServer(server) { server.middlewares.use('/__fta-report-test', async (req, res, next) => {
    if (req.url !== '/' && req.url !== '') return next()
    res.setHeader('Content-Type', 'text/html')
    res.end(await server.transformIndexHtml('/__fta-report-test', '<!doctype html><html lang="en"><head><title>FTA report regression</title></head><body><main id="root"></main><script type="module" src="/__fta-report-test.tsx"></script></body></html>'))
  }) },
}] })
let browser
try {
  await vite.listen()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } })
  const errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()) })
  await page.route(/^https?:\/\/[^/]+\/api\//, route => route.abort())
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__fta-report-test`)
  await page.getByText('FTA report browser ready').waitFor({ timeout: 90000 })
  const result = await page.evaluate(async () => {
    const { project, model, library, reporting, assets, renderFtaDiagram, revision } = window.ftaReportTest
    const child = { id: 'child-id', name: 'Same name', state: { nodes: [
      { id: 'b', type: 'basic', position: { x: 20, y: 20 }, data: { label: 'Pump unavailable', probability: '.1' } }], edges: [],
      exposureTime: '100', result: { top_event_probability: .1, importance: [{ event: 'b', Birnbaum: 1 }] } } }
    const parent = { id: 'parent-id', name: 'Same name', state: { nodes: [
      { id: 'g', type: 'or', position: { x: 100, y: 0 }, data: { label: 'Loss of pumping' } },
      { id: 't', type: 'transfer', position: { x: 100, y: 200 }, data: { label: 'Pump transfer', transferTo: 'child-id', referenceMode: 'shared' } }],
      edges: [{ id: 'edge', source: 'g', target: 't', data: { order: 0, role: 'input' } }], exposureTime: '200', result: { top_event_probability: .1, time_curve: [{time:0,probability:0},{time:200,probability:.1}] } } }
    const folios = [parent, child]
    for (const tree of folios) tree.state.resultProvenance = model.createFtaResultProvenance(folios, tree.id, revision)
    const catalog = model.normalizeFtaLibrary(folios).catalog
    project.newProject('FTA reporting browser')
    project.setModuleState('faultTree', { _folioWrap: true, activeId: 'parent-id', folios })
    const before = project.getProjectState().modules.faultTree.activeId
    const options = { folios, catalog, treeIds: ['parent-id'], scope: 'branch', units: 'hours' }
    const built = library.buildFtaLibraryReport(options)
    const png = await renderFtaDiagram(parent.state, 'Loss of pumping — read-only report', true)
    const img = new Image(); img.src = png.dataUrl; await img.decode()
    const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0)
    const pixels = ctx.getImageData(0, 0, img.width, img.height).data
    let nonWhite = 0
    for (let i = 0; i < pixels.length; i += 4) if (Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) < 200) nonWhite++
    const result = await library.assembleFtaLibraryPackage(options, project.buildExport(undefined, true),
      { diagram: renderFtaDiagram, html: reporting.renderReportHtml, pdf: reporting.renderReportPDF })
    const html = new TextDecoder().decode(result.files['report.html'])
    const pdf = new TextDecoder('latin1').decode(result.files['report.pdf'])
    const reportId = await library.addFtaLibraryToReport(options)
    const liveAssets = assets.enumerateAssets()
    const metrics = liveAssets.find(asset => asset.analysisId === 'child-id' && asset.label === 'Top Event')
    const table = liveAssets.find(asset => asset.analysisId === 'child-id' && asset.label === 'Importance Measures')
    const blocks = [metrics, table].map(asset => ({ ...library.ftaAssetReportBlock(asset, '2026-10-12T00:00:00Z'), sourceKind: 'live' }))
    const snapshotReport = { id: 'snapshot', title: 'Snapshot', blocks: [library.ftaAssetReportBlock(metrics, '2026-10-12T00:00:00Z')] }
    const snapshotUnchanged = reporting.refreshReportAssets(snapshotReport, []).blocks[0] === snapshotReport.blocks[0]
    const live = { id: 'live', title: 'Live sources', blocks }
    const refreshed = reporting.refreshReportAssets(live, liveAssets)
    const recalculated = structuredClone(folios)
    recalculated[1].state.result.top_event_probability = .2
    project.setModuleState('faultTree', { _folioWrap: true, activeId: 'parent-id', folios: recalculated })
    let changedResultBlocked = false
    try { await reporting.renderReportHtml(live) } catch (error) { changedResultBlocked = /unavailable/i.test(error.message) }
    const changed = structuredClone(folios)
    changed[1].state.nodes[0].data.probability = '.9'
    project.setModuleState('faultTree', { _folioWrap: true, activeId: 'parent-id', folios: changed })
    let blocked = false
    try { await reporting.renderReportHtml(live) } catch (error) { blocked = /unavailable/i.test(error.message) }
    document.getElementById('root').innerHTML = '<h1>FTA library report evidence</h1><p>Two unique trees, one transfer, source contexts retained.</p>'
    img.style.maxWidth = '1100px'; document.getElementById('root').append(img)
    const parentSvg = new TextDecoder().decode(result.files[Object.keys(result.files).find(path => path.includes('parent-id/diagram.svg'))])
    const summary = { complete: result.result.complete, failedAssets: result.result.failedAssets, files: Object.keys(result.files),
      svgResolvedTarget: parentSvg.includes('FTA-002') && parentSvg.includes('child-id'),
      svgTopEventRole: parentSvg.includes('data-fta-inferred-role="top"'),
      nonWhite, pngDimensions: [img.width, img.height], pdfHeader: pdf.slice(0, 8), pdfLength: result.files['report.pdf']?.length,
      snapshotUnchanged, htmlHasIdentity: html.includes('child-id') && html.includes('parent-id'), htmlHasContext: html.includes('Standalone root'),
      noFolioSwitch: before === project.getProjectState().modules.faultTree.activeId,
      reportAdded: project.getProjectState().modules.reportBuilder.reports.some(report => report.id === reportId),
      refreshSourcePreserved: refreshed.blocks.every(block => block.source?.analysisId === 'child-id'),
      liveStaleExportBlocked: blocked, changedResultBlocked, offscreenRootsCleaned: document.querySelectorAll('div[style*="left: -20000px"]').length === 0 }
    let changedDuringExport = false, restartRequired = false
    try {
      await library.downloadFtaLibraryPackage(options, () => {
        if (!changedDuringExport) { changedDuringExport = true; project.setModuleState('during-export-input', { value: 'changed' }) }
      })
    } catch (error) { restartRequired = /project changed.*Restart/s.test(error.message) }
    return { ...summary, restartRequired }
  })
  await writeFile(join(output, 'report.json'), JSON.stringify(result, null, 2))
  await page.screenshot({ path: join(output, 'fta-report-diagram.png'), fullPage: true })
  assert.equal(result.complete, true, JSON.stringify(result.failedAssets))
  assert.equal(result.files.filter(file => file.endsWith('/diagram.png')).length, 2)
  assert.equal(result.files.filter(file => file.endsWith('/diagram.svg')).length, 2)
  assert.ok(result.nonWhite > 1000, 'diagram contains visible nodes/connectors, not a blank capture')
  assert.match(result.pdfHeader, /^%PDF-/)
  assert.ok(result.pdfLength > 10000)
  assert.ok(result.pdfLength < 2_000_000, 'small diagram package PDF must compress raster figures for large-library scalability')
  for (const key of ['restartRequired', 'svgResolvedTarget', 'svgTopEventRole', 'snapshotUnchanged', 'htmlHasIdentity', 'htmlHasContext', 'noFolioSwitch', 'reportAdded', 'refreshSourcePreserved', 'liveStaleExportBlocked', 'changedResultBlocked', 'offscreenRootsCleaned']) assert.equal(result[key], true, key)
  assert.deepEqual(errors, [])
  await page.screenshot({ path: join(output, 'fta-report-diagram.png'), fullPage: true })
  await writeFile(join(output, 'report.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ status: 'passed', output, ...result }, null, 2))
} finally { await browser?.close(); await closeViteTestServer(vite, cacheDir) }
