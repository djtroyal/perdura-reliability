import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'vite'
import { closeViteTestServer, ssrOnlyVitePlugin } from './viteTestLifecycle.mjs'
const root = resolve(new URL('..', import.meta.url).pathname)
const cacheDir = await mkdtemp(join(tmpdir(), 'fta-report-contract-'))
const hmrServer = createHttpServer()
const vite = await createServer({ root, cacheDir, appType: 'custom', plugins: [ssrOnlyVitePlugin()],
  server: { middlewareMode: true, ws: { server: hmrServer } } })
try {
  const model = await vite.ssrLoadModule('/src/components/FaultTree/libraryModel.ts')
  const reports = await vite.ssrLoadModule('/src/components/FaultTree/libraryReports.ts')
  const assets = await vite.ssrLoadModule('/src/store/assetExtractors.ts')
  const project = await vite.ssrLoadModule('/src/store/project.ts')
  const exportOrigin = await vite.ssrLoadModule('/src/store/exportSnapshot.ts')
  const version = await vite.ssrLoadModule('/src/version.ts')
  const { renderReportTablePdf } = await vite.ssrLoadModule('/src/components/ReportBuilder/reportTablePdf.ts')
  const basic = (id, name = 'Same name') => ({ id, name, state: { nodes: [{ id: 'b', type: 'basic', data: { label: `Basic ${id}`, probability: '0.1' } }], edges: [], exposureTime: '100', result: { top_event_probability: .1, importance: [{ event: 'b', Birnbaum: 1 }] } } })
  const parent = (id, targets) => ({ id, name: 'Same name', state: { nodes: [{ id: 'g', type: 'or', data: { label: id } },
    ...targets.map((target, i) => ({ id: `t${i}`, type: 'transfer', data: { transferTo: target, referenceMode: i % 2 ? 'independent' : 'shared' } }))],
    edges: targets.map((target, i) => ({ id: `e${i}`, source: 'g', target: `t${i}`, data: { order: i, role: 'input' } })), exposureTime: '200', result: { top_event_probability: .19 } } })
  const folios = [parent('root', ['left', 'right']), parent('left', ['leaf']), parent('right', ['leaf']), basic('leaf')]
  for (const folio of folios) folio.state.resultProvenance = model.createFtaResultProvenance(folios, folio.id, version.CURRENT_ENGINE_REVISIONS.faultTree)
  const catalog = model.normalizeFtaLibrary(folios).catalog
  const options = { folios, catalog, treeIds: ['root'], scope: 'tree', units: 'hours' }
  const systemModel = { id: 'shared', name: 'Plant', instances: [{ id: 'part', name: 'Control card' }] }
  const linkedCatalog = structuredClone(catalog)
  linkedCatalog.byTreeId.root.systemLinks = [{ systemModelId: 'shared', instanceId: 'part' }, { systemModelId: 'shared', instanceId: 'deleted' }]
  const linkedReport = reports.buildFtaLibraryReport({ ...options, catalog: linkedCatalog, systemModel })
  const systemLabels = linkedReport.report.blocks.find(block => block.label === 'Tree definition and identity').rows.find(row => row[0] === 'System links')[1]
  assert.match(systemLabels, /Plant \[shared\].*Control card \[part\]/)
  assert.match(systemLabels, /Missing item \[deleted\]/)
  const built = reports.buildFtaLibraryReport(options)
  assert.equal(built.folios.length, 4)
  assert.equal(built.report.blocks.filter(b => b.type === 'diagram').length, 4, 'shared target detailed exactly once')
  assert.equal(built.register.length, 5)
  assert.deepEqual(built.register.map(row => row[0]), ['1', '1.1', '1.1.1', '1.2', '1.2.1'], 'indenture is the occurrence path, not just depth')
  assert.equal(built.register.filter(row => row[8] === 'Cross-reference; detailed once').length, 1)
  assert.deepEqual(built.manifest.contexts.map(item => item.status), ['current', 'current', 'current', 'current'])
  assert.equal(built.referenceRows.length, 4)
  const extracted = assets.extractFaultTreeAssets(folios, 'hours')
  const topEvents = extracted.filter(asset => asset.label === 'Top Event')
  assert.equal(new Set(topEvents.map(asset => asset.id)).size, 4, 'duplicate names never alias stable tree identities')
  assert.deepEqual(new Set(topEvents.map(asset => asset.source.analysisId)), new Set(folios.map(tree => tree.id)))
  for (const block of built.report.blocks.filter(b => b.type === 'table' || b.type === 'metrics').filter(b => b.source)) {
    assert.ok(block.source.analysisId)
    assert.match(block.source.evaluationContext, /Standalone root/)
    assert.equal(block.sourceKind, 'snapshot')
    assert.ok(block.sourceCapturedAt)
  }
  const renamed = folios.map(tree => ({ ...tree, name: `Renamed ${tree.id}` })).reverse()
  assert.deepEqual(new Set(assets.extractFaultTreeAssets(renamed).map(asset => asset.id)), new Set(extracted.map(asset => asset.id)))
  const annotated = structuredClone(folios)
  for (const tree of annotated) tree.state.result.time_curve = [{ time: 0, probability: 0 }, { time: 100, probability: .1 }]
  project.newProject('FTA annotation identities')
  project.setModuleState('faultTree', { _folioWrap: true, activeId: 'root', folios: annotated })
  project.setModuleState('__plotMarkup', Object.fromEntries(annotated.map(tree => [
    `faulttree:${tree.id}:fta-top-event-time`,
    { annotations: [{ id: `note-${tree.id}`, text: `Note for ${tree.id}`, x: 1, y: .1, xref: 'x', yref: 'y' }], shapes: [] },
  ])))
  for (const asset of assets.enumerateAssets().filter(asset => asset.type === 'plot' && asset.module === 'faultTree')) {
    const notes = asset.getData().plotLayout.annotations
    assert.equal(notes.length, 1)
    assert.equal(notes[0].text, `Note for ${asset.analysisId}`, 'same-name plots retain only their own ID-scoped saved annotation')
  }
  const changed = structuredClone(folios)
  changed.find(tree => tree.id === 'leaf').state.nodes[0].data.probability = '0.9'
  const stale = reports.buildFtaLibraryReport({ ...options, folios: changed })
  assert.ok(stale.manifest.contexts.every(context => context.status === 'stale'))
  assert.equal(stale.assets.filter(asset => asset.label === 'Top Event').length, 0, 'stale results never reappear as current numeric tables')
  assert.ok(stale.folios[0].state.result, 'historical saved outputs remain available with stale context')
  const settings = structuredClone(folios)
  settings.find(tree => tree.id === 'leaf').state.exposureTime = '999'
  const contexts = reports.buildFtaLibraryReport({ ...options, folios: settings }).manifest.contexts
  assert.equal(contexts.find(item => item.treeId === 'root').status, 'current', 'parent calculation uses parent settings')
  assert.equal(contexts.find(item => item.treeId === 'leaf').status, 'stale', 'child standalone result retains its own context')
  const missing = reports.buildFtaLibraryReport({ ...options, treeIds: ['missing'] })
  assert.equal(missing.manifest.complete, false)
  assert.deepEqual(missing.manifest.missingTargets, ['missing'])
  const cycle = [parent('x', ['y']), parent('y', ['x'])]
  const cyclic = reports.buildFtaLibraryReport({ folios: cycle, catalog, treeIds: [], scope: 'all', units: 'hours' })
  assert.equal(cyclic.folios.length, 2)
  assert.equal(cyclic.manifest.complete, false)
  assert.ok(cyclic.register.length <= 4, 'cycle traversal stays bounded')
  const large = Array.from({ length: 500 }, (_, i) => i === 499 ? basic(`tree-${i}`) : parent(`tree-${i}`, [`tree-${i + 1}`, 'tree-499']))
  const start = performance.now()
  const largeReport = reports.buildFtaLibraryReport({ folios: large, catalog, treeIds: ['tree-0'], scope: 'branch', units: 'hours' })
  assert.equal(largeReport.folios.length, 500)
  assert.ok(largeReport.register.length <= 1000, '500-tree shared DAG register has linear size')
  assert.ok(performance.now() - start < 10_000)
  const payload = project.buildExport(undefined, true)
  const successRenderers = { diagram: async () => ({ dataUrl: 'data:image/png;base64,AA==', svgDataUrl: 'data:image/svg+xml,%3Csvg%2F%3E', width: 1, height: 1 }),
    html: async report => `<!doctype html>${report.title}`, pdf: async () => new ArrayBuffer(1) }
  const success = await reports.assembleFtaLibraryPackage(options, payload, successRenderers)
  assert.equal(success.result.complete, true)
  assert.equal(Object.keys(success.files).filter(path => path.endsWith('/diagram.png')).length, 4)
  assert.equal(JSON.parse(new TextDecoder().decode(success.files['project.json'])).modules.faultTree.folios.length, 4)
  assert.ok(success.manifest.files.every(file => file in success.files))
  const failure = await reports.assembleFtaLibraryPackage(options, payload, { ...successRenderers,
    diagram: async () => { throw new Error('simulated image failure') }, pdf: async () => { throw new Error('simulated PDF failure') } })
  assert.equal(failure.result.complete, false)
  assert.equal(failure.result.failedAssets.length, 5)
  assert.equal(failure.manifest.complete, false)
  assert.ok(!('report.pdf' in failure.files))
  assert.ok(failure.result.failedAssets.every(item => item.error.includes('simulated')))
  // Exercise actual page-flow algorithm with cells far longer than a page.
  let y = 10, page = 1
  const calls = []
  const pdf = { setFontSize() {}, setFont() {}, setTextColor() {}, setFillColor() {}, setDrawColor() {}, rect() {}, line() {},
    splitTextToSize: value => String(value).split('|'), text: (text, x, atY) => calls.push({ text, x, atY, page }) }
  const tokens = Array.from({ length: 160 }, (_, i) => `UNIQUE_${i}`)
  renderReportTablePdf(pdf, ['Header A', 'Header B'], [[tokens.join('|'), 'Other cell']],
    { x: 15, width: 200, topY: 10, bottomY: 60, getY: () => y, setY: value => { y = value }, newPage: () => { y = 10; page++ } })
  assert.ok(page > 10)
  assert.deepEqual(calls.filter(call => call.text.startsWith('UNIQUE_')).map(call => call.text), tokens, 'PDF row continuation preserves every long-cell line')
  assert.ok(calls.every(call => call.atY <= 60 && call.atY >= 10), 'no text crosses page content bounds')
  assert.ok(calls.filter(call => call.text === 'Header A').length > 1, 'headers repeat across pages')
  const original = exportOrigin.captureProjectExportOrigin()
  exportOrigin.assertProjectExportOrigin(original)
  const priorRevision = project.getProjectState().revision
  project.setModuleState('ordinary-input', { changed: true })
  assert.equal(project.getProjectState().revision, priorRevision, 'ordinary edits are not adequately identified by revision alone')
  assert.throws(() => exportOrigin.assertProjectExportOrigin(original), /project changed.*Restart/s)
  const changedOrigin = exportOrigin.captureProjectExportOrigin()
  project.newProject('Switched project during export')
  assert.throws(() => exportOrigin.assertProjectExportOrigin(changedOrigin), /project changed.*Restart/s)
  console.log('FTA library reporting contracts passed (identity, DAG scopes, freshness, 500 trees, completeness, PDF wrapping).')
} finally { await closeViteTestServer(vite, cacheDir, hmrServer) }
