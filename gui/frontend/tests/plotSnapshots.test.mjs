import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createServer } from 'vite'

const hmrServer = createHttpServer()
const vite = await createServer({
  root: new URL('..', import.meta.url).pathname,
  appType: 'custom',
  server: { middlewareMode: true, ws: { server: hmrServer } },
})

try {
  const project = await vite.ssrLoadModule('/src/store/project.ts')
  const snapshots = await vite.ssrLoadModule('/src/store/plotSnapshots.ts')

  project.setModuleState('reportBuilder', {
    reports: [{ id: 'report-1', title: 'Evidence', blocks: [] }],
    activeReportId: 'report-1',
  })
  const data = [{ x: [1, 2], y: [3, 4], name: 'Fit', visible: 'legendonly' }]
  const layout = {
    width: 900,
    height: 500,
    uirevision: 'live-view',
    dragmode: 'pan',
    xaxis: { range: [1.2, 1.8], autorange: false },
    legend: { x: 0.25, y: 0.75 },
    annotations: [
      { text: 'Base note', x: 1, y: 3, showarrow: false },
      {
        name: 'perdura-user-note-1', text: 'Reviewed point',
        x: 2, y: 4, xref: 'x', yref: 'y', showarrow: true,
        font: { color: '#2563eb', size: 12 },
      },
    ],
    shapes: [{
      name: 'perdura-user-shape-1', type: 'line', xref: 'x', yref: 'y',
      x0: 2, x1: 2, y0: 0, y1: 4,
      line: { color: '#2563eb', width: 2 }, opacity: 0.8,
    }],
  }
  const snapshot = await snapshots.createPlotSnapshot({
    name: 'CDF Plot', plotData: data, plotLayout: layout,
    capturedAt: '2026-07-21T12:34:56.000Z',
    source: {
      module: 'lifeData', moduleLabel: 'Life Data Analysis',
      analysisId: 'folio-1', analysisName: 'Pump life', plotId: 'cdf',
      assetKey: 'asset:life-data:cdf',
    },
  })

  assert.equal(snapshot.schema, 'perdura.plot-snapshot/v1')
  assert.equal(snapshot.name, 'CDF Plot')
  assert.equal(snapshot.capturedAt, '2026-07-21T12:34:56.000Z')
  assert.match(snapshot.figureSha256, /^[0-9a-f]{64}$/)
  assert.ok(snapshot.sizeBytes > 0)
  assert.equal(snapshot.plotData[0].visible, 'legendonly')
  assert.deepEqual(snapshot.plotLayout.xaxis.range, [1.2, 1.8])
  assert.deepEqual(snapshot.plotLayout.legend, { x: 0.25, y: 0.75 })
  assert.equal(snapshot.plotLayout.width, undefined)
  assert.equal(snapshot.plotLayout.height, undefined)
  assert.equal(snapshot.plotLayout.dragmode, undefined)
  assert.equal(snapshot.plotLayout.uirevision, undefined)
  assert.equal(snapshot.plotLayout.autosize, true)
  assert.equal(snapshot.plotLayout.annotations.length, 1, 'base annotations remain in the base layout')
  assert.equal(snapshot.plotMarkup.annotations[0].text, 'Reviewed point')
  assert.equal(snapshot.plotMarkup.shapes[0].id, 'shape-1')

  data[0].x[0] = 999
  layout.xaxis.range[0] = 999
  assert.equal(snapshot.plotData[0].x[0], 1, 'snapshot data must be detached from Plotly mutations')
  assert.equal(snapshot.plotLayout.xaxis.range[0], 1.2, 'snapshot view must be detached from Plotly mutations')

  snapshots.storePlotSnapshot(snapshot)
  const reportBuilder = project.getProjectState().modules.reportBuilder
  assert.equal(reportBuilder.plotSnapshots.length, 1)
  assert.equal(reportBuilder.reports[0].title, 'Evidence', 'capture must not overwrite concurrent report state')
  assert.equal(snapshots.sanitizePlotSnapshots(reportBuilder.plotSnapshots).length, 1)
  assert.equal(project.buildExport(['reportBuilder']).modules.reportBuilder.plotSnapshots[0].id, snapshot.id,
    'ordinary project exports must persist plot snapshots')

  const wrapperSource = await readFile(
    new URL('../src/components/shared/ExportablePlot.tsx', import.meta.url), 'utf8')
  const innerSource = await readFile(
    new URL('../src/components/shared/ExportablePlotInner.tsx', import.meta.url), 'utf8')
  const reportBuilderSource = await readFile(
    new URL('../src/components/ReportBuilder/index.tsx', import.meta.url), 'utf8')

  assert.match(wrapperSource, /<BookmarkAssetButton asset=\{bookmarkAsset\}[\s\S]*?<Camera size=\{13\}/,
    'the snapshot action must sit beside the bookmark action')
  assert.match(wrapperSource, /snapshotRequest=\{snapshotRequest\}/,
    'the adjacent snapshot action must request capture from the live Plotly instance')
  assert.match(innerSource, /Plots\?\.graphJson[\s\S]*?'keepdata'[\s\S]*?'object'/,
    'snapshot capture must use Plotly graph JSON to preserve the live view')
  assert.doesNotMatch(innerSource, /name: 'perdura-snapshot'/,
    'snapshot must not remain in the Plotly mode bar')
  assert.match(reportBuilderSource, /Plot Snapshots \(\{plotSnapshots\.length\}\)/,
    'Report Builder must expose a dedicated snapshot library section')
  assert.match(reportBuilderSource, /b\.sourceKind === 'snapshot'\) return b/,
    'live-data refresh must leave snapshot-backed blocks unchanged')

  console.log('Plot snapshot capture, persistence, and Report Builder contracts passed')
} finally {
  await vite.close()
  hmrServer.close()
}
