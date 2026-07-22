import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createServer } from 'vite'

const hmrServer = createHttpServer()
const vite = await createServer({
  root: new URL('..', import.meta.url).pathname,
  appType: 'custom',
  server: { middlewareMode: true, hmr: { server: hmrServer } },
})

try {
  const project = await vite.ssrLoadModule('/src/store/project.ts')
  const assetsModule = await vite.ssrLoadModule('/src/store/assetExtractors.ts')
  const bookmarks = await vite.ssrLoadModule('/src/store/bookmarks.ts')

  assert.equal(await project.openDemoProject(), true)
  const first = assetsModule.enumerateAssets()
  assert.ok(first.length > 0, 'the demo project must expose report/bookmark assets')
  assert.equal(new Set(first.map(asset => asset.id)).size, first.length,
    'every report asset needs a unique durable key')
  for (const asset of first) {
    assert.match(asset.id, /^asset:/)
    assert.equal(asset.source.assetKey, asset.id)
    assert.ok(asset.source.tab, `${asset.label} must identify its destination tab`)
  }
  assert.deepEqual(
    assetsModule.enumerateAssets().map(asset => asset.id),
    first.map(asset => asset.id),
    're-enumerating unchanged results must preserve asset identity',
  )
  assert.equal(assetsModule.assetSubview('lifeData', 'Weibull_2P Probability Plot'), 'lda:Probability')
  assert.equal(assetsModule.assetSubview('lifeData', 'Weibull_2P Specified CDF'), 'lda:CDF')
  assert.equal(assetsModule.assetSubview('lifeData', 'CFM Seal Probability Plot'), 'lda:cfm:probability')
  assert.equal(assetsModule.assetSubview('lifeData', 'CFM System Unreliability (CDF)'), 'lda:cfm:curve:CDF')
  assert.equal(assetsModule.assetSubview('lifeData', 'CFM Parameter Summary'), 'lda:cfm:params')
  assert.equal(assetsModule.assetSubview('lifeData', 'CFM MC Simulation Summary'), 'lda:cfm:simulation')

  project.setModuleState('lifeData', {
    activeId: 'folio-stable',
    folios: [{
      id: 'folio-stable', name: 'Original analysis name',
      specResult: {
        distribution: 'Weibull_2P', params: { beta: 2, eta: 100 },
        stats: { mean: 88.6, median: 83.3, std: 46.3 },
        curves: { x: [1, 2], pdf: [0.1, 0.2], cdf: [0.1, 0.2], sf: [0.9, 0.8], hf: [0.01, 0.02] },
      },
    }],
  })
  const lifeAssets = assetsModule.enumerateAssets()
  const lifeAsset = lifeAssets.find(asset => asset.module === 'lifeData' && asset.source.analysisId)
  assert.ok(lifeAsset, 'demo life-data results must carry a folio target')
  const specifiedCdf = lifeAssets.find(asset => asset.label === 'Weibull_2P Specified CDF')
  assert.ok(specifiedCdf, 'specified LDA results must expose a CDF asset')
  assert.equal(specifiedCdf.source.view, 'lda:CDF',
    'an extracted LDA CDF asset must retain its internal result-view destination')
  assert.equal(bookmarks.bookmarkFromAsset(specifiedCdf).source.view, 'lda:CDF',
    'bookmark persistence must retain the internal result-view destination')
  const lifeState = project.getProjectState().modules.lifeData
  const folio = lifeState.folios.find(item => item.id === lifeAsset.source.analysisId)
  assert.ok(folio)
  folio.name = `${folio.name} renamed`
  const renamed = assetsModule.enumerateAssets().find(asset =>
    asset.module === lifeAsset.module
    && asset.type === lifeAsset.type
    && asset.label === lifeAsset.label
    && asset.source.analysisId === lifeAsset.source.analysisId)
  assert.equal(renamed.id, lifeAsset.id,
    'renaming an analysis must not invalidate its result bookmarks')

  const bookmark = bookmarks.bookmarkFromAsset(renamed, '2026-07-21T12:00:00.000Z')
  assert.equal(bookmark.assetKey, renamed.id)
  assert.equal(bookmark.source.analysisId, renamed.source.analysisId)
  project.setModuleState('bookmarks', { items: [bookmark] })
  assert.deepEqual(project.buildExport().modules.bookmarks, { items: [bookmark] },
    'bookmarks must persist with the project')

  bookmarks.requestBookmarkNavigation(bookmark.source, bookmark.label)
  assert.equal(bookmarks.getBookmarkNavigationTarget().source.assetKey, bookmark.assetKey)
  bookmarks.clearBookmarkNavigation()
  assert.equal(bookmarks.getBookmarkNavigationTarget(), null)

  const dashboardSource = await readFile(
    new URL('../src/components/Dashboard/index.tsx', import.meta.url), 'utf8')
  const reportBuilderSource = await readFile(
    new URL('../src/components/ReportBuilder/index.tsx', import.meta.url), 'utf8')
  const lifeDataSource = await readFile(
    new URL('../src/components/LifeData/index.tsx', import.meta.url), 'utf8')
  assert.match(dashboardSource, /BOOKMARK_MODULE_ICONS\[source\.tab\]/,
    'Dashboard bookmark cards must use their destination module icon')
  assert.match(reportBuilderSource, /<BookmarkAssetButton asset=\{a\}/,
    'every Report Builder asset row must expose a bookmark control')
  assert.match(reportBuilderSource, /w-\[27rem\].*Left sidebar|Left sidebar[\s\S]*?w-\[27rem\]/,
    'the Report Builder left pane must remain at the requested 27rem width')
  assert.match(lifeDataSource, /setActiveViews\(\[standardView\]\)/,
    'LDA bookmark navigation must select the saved result subview')
  assert.match(lifeDataSource, /setCfmCurveViews\(\[cfmCurve\]\)/,
    'LDA bookmark navigation must select saved CFM curve subviews')

  console.log('Bookmark identity, persistence, navigation, and subview contracts passed')
} finally {
  await vite.close()
  hmrServer.close()
}
