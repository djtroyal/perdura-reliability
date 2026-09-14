import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'vite'

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
  server: { middlewareMode: true, ws: { server: hmrServer } },
})
try {
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

  assert.equal(project.saveNamedProject('Cached'), true)
  const raw = [...values.entries()].find(([key]) => key.includes('projects') && !key.includes('backup'))
  assert.ok(raw)
  let parses = 0
  const parse = JSON.parse
  JSON.parse = function (text, ...rest) {
    if (text === raw[1]) parses++
    return parse(text, ...rest)
  }
  try {
    for (let i = 0; i < 25; i++) assert.equal(project.projectExists('Cached'), true)
    assert.equal(parses, 1, 'identical project-map bytes are parsed once across reads')
    failSave = true
    assert.equal(project.saveNamedProject('Failed'), false)
    assert.equal(project.projectExists('Failed'), false, 'failed writes cannot mutate the cached map')
  } finally { JSON.parse = parse; failSave = false }
  const external = JSON.parse(raw[1])
  external.Other = { ...external.Cached, name: 'Other' }
  values.set(raw[0], JSON.stringify(external))
  assert.equal(project.projectExists('Other'), true, 'external storage edits are observed before a storage event')
  project.deleteNamedProject('Other')
  assert.equal(project.projectExists('Other'), false)
  project.newProject('Replacement')
  assert.notEqual(project.getProvenanceLedger(), ledger)
  assert.deepEqual(project.getUndoRedoHistory(), { undo: [], redo: [] })
  assert.deepEqual(project.getProvenanceLedger().exports, [])
  console.log('Performance store snapshots, invalidation, storage cache and failed-write contracts passed.')
} finally {
  globalThis.localStorage = previousStorage
  await vite.close()
  await rm(cacheDir, { recursive: true, force: true })
  hmrServer.close()
}
