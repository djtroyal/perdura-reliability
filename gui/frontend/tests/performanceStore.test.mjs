import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'vite'
import { closeViteTestServer, ssrOnlyVitePlugin } from './viteTestLifecycle.mjs'

const values = new Map()
let failSave = false
const previousStorage = globalThis.localStorage
globalThis.localStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => { if (failSave) throw new Error('Quota'); values.set(key, value) },
  removeItem: key => values.delete(key),
}
const hmrServer = createHttpServer()
const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-performance-vite-'))
const vite = await createServer({
  cacheDir,
  root: new URL('..', import.meta.url).pathname, appType: 'custom',
  plugins: [ssrOnlyVitePlugin()],
  server: { middlewareMode: true, ws: { server: hmrServer } },
})
try {
  assert.equal(vite.config.optimizeDeps.noDiscovery, true)
  assert.deepEqual(vite.config.optimizeDeps.include, [])
  const project = await vite.ssrLoadModule('/src/store/project.ts')
  project.newProject('Snapshot contract')
  project.setModuleState('growth', { input: 1 })
  const firstHistory = project.getUndoRedoHistory()
  const firstLedger = project.getProvenanceLedger()
  const firstDirty = project.getUnsavedChangeDetails()
  for (let i = 0; i < 25; i++) {
    assert.equal(project.getUndoRedoHistory(), firstHistory)
    assert.equal(project.getProvenanceLedger(), firstLedger)
    assert.equal(project.getUnsavedChangeDetails(), firstDirty)
  }
  project.setModuleState('growth', { input: 2 })
  const inputHistory = project.getUndoRedoHistory()
  project.setModuleState('growth', { input: 3 })
  assert.equal(project.getUndoRedoHistory(), inputHistory, 'coalesced typing reuses history labels')
  assert.equal(project.getProvenanceLedger(), firstLedger, 'editor changes do not recreate a ledger')
  assert.equal(project.getUnsavedChangeDetails(), firstDirty, 'same dirty target keeps its snapshot')
  project.setModuleState('growth', { input: 3, other: 1 })
  assert.notEqual(project.getUndoRedoHistory(), inputHistory, 'distinct fields create fresh history')
  project.undo()
  const undone = project.getUndoRedoHistory()
  assert.equal(undone.redo.length, 1)
  project.redo()
  assert.equal(project.getUndoRedoHistory().redo.length, 0)
  project.recordExportLedger({ artifactId: 'one', filename: 'first.csv', sha256: 'abc', generatedAt: '2026-09-14' })
  const ledger = project.getProvenanceLedger()
  assert.notEqual(ledger, firstLedger)
  assert.equal(ledger.analysisRuns, firstLedger.analysisRuns)
  assert.equal(ledger.exports.length, 1)
  project.clearDirty()
  assert.deepEqual(project.getUnsavedChangeDetails(), [])

  project.setModuleState('growth', { input: 4 })
  assert.equal(await project.saveNamedProject('Unavailable storage'), false)
  assert.equal(project.projectExists('Unavailable storage'), false,
    'an uncommitted save cannot enter the saved-project metadata cache')
  assert.equal(project.isDirty(), true)
  assert.equal(values.size, 0, 'editor mutations must not serialize project bodies into localStorage')
  project.newProject('Replacement')
  assert.notEqual(project.getProvenanceLedger(), ledger)
  assert.deepEqual(project.getUndoRedoHistory(), { undo: [], redo: [] })
  assert.deepEqual(project.getProvenanceLedger().exports, [])
  console.log('Performance store snapshots, invalidation, incremental-storage and failed-write contracts passed.')
} finally {
  globalThis.localStorage = previousStorage
  await closeViteTestServer(vite, cacheDir, hmrServer)
}
