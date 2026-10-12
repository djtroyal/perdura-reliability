/** Real IndexedDB assurance: migration, 50k nodes, incremental writes and conflicts. */
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { closeViteTestServer } from './viteTestLifecycle.mjs'

const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-storage-browser-'))
const option = process.argv.indexOf('--output-dir')
const output = resolve(option < 0 ? join(tmpdir(), 'perdura-project-persistence-browser') : process.argv[option + 1])
await mkdir(output, { recursive: true })
const vite = await createServer({
  root: new URL('..', import.meta.url).pathname,
  cacheDir,
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'storage-assurance-page',
    resolveId(id) { if (id === '/__storage_app.tsx') return id },
    load(id) {
      if (id === '/__storage_app.tsx') return `
        import React from 'react'
        import { createRoot } from 'react-dom/client'
        import App from '/src/App.tsx'
        const host = document.createElement('div')
        document.body.append(host)
        createRoot(host).render(<App />)
      `
    },
    configureServer(server) {
    server.middlewares.use('/__storage_test', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html')
      res.end(await server.transformIndexHtml('/__storage_test', '<!doctype html><html lang="en"><head><title>Storage assurance</title></head><body>Storage assurance</body></html>'))
    })
  } }],
})
let browser
try {
  await vite.listen()
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.goto(`${origin}/__storage_test`)
  const migration = await page.evaluate(async () => {
    const legacy = { projectName: 'Legacy FTA', identity: { projectId: 'legacy-project' },
      units: 'hours', analysisRuns: [], exportLedger: [], modules: { faultTree: {
        _folioWrap: true, activeId: 'f0', folios: [{ id: 'f0', name: 'Legacy tree', state: {
          nodes: [{ id: 'event', type: 'basic', data: { probability: 0.1 }, position: { x: 0, y: 0 } }],
          edges: [], result: { top_event_probability: 0.1 },
        } }],
      } } }
    const raw = JSON.stringify(legacy)
    localStorage.setItem('perdura:project-schema:7:session', raw)
    localStorage.setItem('perdura:project-schema:7:projects', JSON.stringify({ 'Legacy FTA': {
      name: 'Legacy FTA', savedAt: '2026-10-12', ...legacy,
    } }))
    const project = await import('/src/store/project.ts')
    await project.hydrateProjectStorage()
    return { name: project.getProjectState().projectName, saved: project.projectExists('Legacy FTA'),
      result: project.getProjectState().modules.faultTree.folios[0].state.result,
      legacyRetained: localStorage.getItem('perdura:project-schema:7:session') === raw }
  })
  assert.equal(migration.name, 'Legacy FTA')
  assert.equal(migration.saved, true)
  assert.equal(migration.legacyRetained, true)
  assert.equal(migration.result.top_event_probability, 0.1)

  const scale = await page.evaluate(async () => {
    const project = await import('/src/store/project.ts')
    const { ProjectPersistence } = await import('/src/store/projectPersistence.ts')
    project.newProject('Large FTA library')
    const folios = Array.from({ length: 500 }, (_, tree) => ({ id: `tree-${tree}`, name: `Tree ${tree}`, state: {
      nodes: Array.from({ length: 100 }, (_, node) => ({ id: `node-${node}`, type: node ? 'basic' : 'or',
        position: { x: node * 10, y: node ? 100 : 0 }, data: { label: `Long description for node ${node}`, probability: 0.001 } })),
      edges: Array.from({ length: 99 }, (_, edge) => ({ id: `edge-${edge}`, source: 'node-0', target: `node-${edge + 1}` })),
      result: { top_event_probability: 0.01 },
    } }))
    project.setModuleState('faultTree', { _folioWrap: true, activeId: 'tree-0', folios })
    const initialStart = performance.now()
    if (!await project.flushProjectPersistence()) throw new Error('Initial large save failed')
    const initialSaveMs = performance.now() - initialStart
    const puts = []
    const originalPut = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (value, ...args) {
      puts.push({ store: this.name, key: value?.key })
      return originalPut.call(this, value, ...args)
    }
    try {
      const current = project.getProjectState().modules.faultTree.folios[0].state
      project.writeFolioState('faultTree', 'tree-0', { ...current,
        nodes: current.nodes.map((node, index) => index ? node : { ...node, position: { x: 30, y: 0 } }),
      })
      if (!await project.flushProjectPersistence()) throw new Error('Incremental save failed')
    } finally { IDBObjectStore.prototype.put = originalPut }
    const reader = new ProjectPersistence()
    const loaded = await reader.read('session')
    const saved = await project.saveNamedProject('Large FTA library')
    project.newProject('Replacement')
    const opened = await project.openNamedProject('Large FTA library')
    return { initialSaveMs, count: loaded.modules.faultTree.folios.length,
      nodeCount: loaded.modules.faultTree.folios.reduce((sum, folio) => sum + folio.state.nodes.length, 0),
      result: loaded.modules.faultTree.folios[1].state.result.top_event_probability,
      puts: puts.filter(item => item.store === 'records').map(item => item.key), saved, opened,
      active: project.getProjectState().modules.faultTree.activeId,
      localProjectKeys: Object.keys(localStorage).filter(key => key.startsWith('perdura:project-schema:8:') && !key.endsWith('recent-projects')) }
  })
  assert.equal(scale.count, 500)
  assert.equal(scale.nodeCount, 50000)
  assert.equal(scale.result, 0.01)
  assert.deepEqual(scale.puts, ['fta-input:tree-0'], 'position edit writes only the changed tree input, retaining analytical results')
  assert.equal(scale.saved, true)
  assert.equal(scale.opened, true)
  assert.equal(scale.active, 'tree-0')
  assert.deepEqual(scale.localProjectKeys, [])

  const reports = await page.evaluate(async () => {
    const { ProjectPersistence } = await import('/src/store/projectPersistence.ts')
    const adapter = new ProjectPersistence()
    const image = `data:image/png;base64,${'a'.repeat(100000)}`
    const reportA = { id: 'report-a', title: 'A', blocks: [{ id: 'img-a', type: 'image', dataUrl: image }] }
    const reportB = { id: 'report-b', title: 'B', blocks: [{ id: 'img-b', type: 'image', dataUrl: image }] }
    const snapshot = { projectName: 'Reports', identity: { projectId: 'report-fixture' }, units: 'hours',
      analysisRuns: [], exportLedger: [], modules: { reportBuilder: { activeReportId: 'report-a',
        reports: [reportA, reportB], plotSnapshots: [{ id: 'snapshot-a', png: image }] } } }
    await adapter.save('named:Reports', snapshot)
    const puts = []
    const originalPut = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (value, ...args) {
      if (this.name === 'records') puts.push(value.key)
      return originalPut.call(this, value, ...args)
    }
    try {
      await adapter.save('named:Reports', { ...snapshot, modules: { reportBuilder: { ...snapshot.modules.reportBuilder,
        reports: [{ ...reportA, title: 'Revised A' }, reportB] } } })
    } finally { IDBObjectStore.prototype.put = originalPut }
    const loaded = await new ProjectPersistence().read('named:Reports')
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('perdura:project-schema:8')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const rows = await new Promise((resolve, reject) => {
      const req = db.transaction('records').objectStore('records').getAll(IDBKeyRange.bound(['named:Reports', ''], ['named:Reports', '\uffff']))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    db.close()
    return { puts, blobCount: rows.filter(row => row.key.startsWith('report-blob:')).length,
      imageRoundtrip: loaded.modules.reportBuilder.reports[0].blocks[0].dataUrl === image,
      otherReport: loaded.modules.reportBuilder.reports[1].title,
      snapshotRoundtrip: loaded.modules.reportBuilder.plotSnapshots[0].png === image,
      reportRecordsContainImage: rows.filter(row => row.key.startsWith('report:')).some(row => JSON.stringify(row.value).includes(image)) }
  })
  assert.deepEqual(reports.puts, ['report:report-a'])
  assert.equal(reports.blobCount, 1, 'the same image in multiple reports and snapshots has one committed blob')
  assert.equal(reports.imageRoundtrip, true)
  assert.equal(reports.snapshotRoundtrip, true)
  assert.equal(reports.otherReport, 'B')
  assert.equal(reports.reportRecordsContainImage, false)

  const saveRaces = await page.evaluate(async () => {
    const project = await import('/src/store/project.ts')
    const { ProjectPersistence } = await import('/src/store/projectPersistence.ts')
    const originalSave = ProjectPersistence.prototype.save
    async function heldSave(name, change) {
      let release, entered
      const gate = new Promise(resolve => { release = resolve })
      const started = new Promise(resolve => { entered = resolve })
      ProjectPersistence.prototype.save = async function (id, snapshot) {
        if (id === `named:${name}`) { entered(); await gate }
        return originalSave.call(this, id, snapshot)
      }
      try {
        const pending = project.saveNamedProject(name)
        await started
        change()
        release()
        return await pending
      } finally { ProjectPersistence.prototype.save = originalSave }
    }
    project.newProject('Save race')
    project.setModuleState('growth', { input: 1 })
    const editedSave = await heldSave('Save race', () => project.setModuleState('growth', { input: 2 }))
    const dirtyAfterEdit = project.isDirty()
    const inputAfterEdit = project.getProjectState().modules.growth.input
    const storedOldInput = (await new ProjectPersistence().read('named:Save race')).modules.growth.input
    const replacedSave = await heldSave('Old project', () => project.newProject('Replacement stays active'))
    const activeName = project.getProjectState().projectName
    const activeModules = Object.keys(project.getProjectState().modules)
    return { editedSave, dirtyAfterEdit, inputAfterEdit, storedOldInput, replacedSave, activeName, activeModules }
  })
  assert.equal(saveRaces.editedSave, true)
  assert.equal(saveRaces.dirtyAfterEdit, true, 'an older committed snapshot cannot acknowledge newer edits')
  assert.equal(saveRaces.inputAfterEdit, 2)
  assert.equal(saveRaces.storedOldInput, 1)
  assert.equal(saveRaces.replacedSave, true)
  assert.equal(saveRaces.activeName, 'Replacement stays active', 'save completion cannot replace a newly opened project')
  assert.deepEqual(saveRaces.activeModules, [])

  const failures = await page.evaluate(async () => {
    const project = await import('/src/store/project.ts')
    if (!await project.flushProjectPersistence()) throw new Error('Race fixture could not commit its session')
    const { ProjectPersistence } = await import('/src/store/projectPersistence.ts')
    const first = new ProjectPersistence()
    const second = new ProjectPersistence()
    const snapshot = await first.read('session')
    await second.read('session')
    await first.save('session', { ...snapshot, projectName: 'Other tab committed' })
    let conflict = ''
    try { await second.save('session', { ...snapshot, projectName: 'Should not overwrite' }) }
    catch (error) { conflict = error.message }
    project.setModuleState('growth', { input: 7 })
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function () { throw new DOMException('Quota fixture', 'QuotaExceededError') }
    let saved
    try { saved = await project.saveNamedProject('Must not be saved') }
    finally { IDBObjectStore.prototype.put = original }
    return { conflict, saved, dirty: project.isDirty(), exists: project.projectExists('Must not be saved'),
      finalName: (await first.read('session')).projectName }
  })
  assert.match(failures.conflict, /another browser tab/)
  assert.equal(failures.saved, false)
  assert.equal(failures.dirty, true)
  assert.equal(failures.exists, false)
  assert.equal(failures.finalName, 'Other tab committed')
  const recoveryPage = await browser.newPage()
  await recoveryPage.goto(`${origin}/__storage_test`)
  const malformedRecovery = await recoveryPage.evaluate(async () => {
    const source = JSON.stringify({ projectName: 'Malformed legacy library', modules: { faultTree: {
      _folioWrap: true, activeId: 'valid', folios: [{ id: 'valid', state: { nodes: [], edges: [] } },
        { name: 'Missing identity must survive', state: { nodes: [{ id: 'saved-event' }], edges: [] } }],
    } } })
    localStorage.setItem('perdura:project-schema:7:session', source)
    const project = await import('/src/store/project.ts')
    const { ProjectPersistence } = await import('/src/store/projectPersistence.ts')
    let error = ''
    try { await project.hydrateProjectStorage() } catch (cause) { error = cause.message }
    const recovery = project.buildRecoveryExport()
    const persistence = new ProjectPersistence()
    return { error, retained: localStorage.getItem('perdura:project-schema:7:session') === source,
      recoveredFolios: recovery.modules.faultTree.folios.length,
      recoveredEvent: recovery.modules.faultTree.folios[1].state.nodes[0].id,
      savedSession: await persistence.read('session'), migrated: await persistence.migrationComplete() }
  })
  assert.match(malformedRecovery.error, /FTA library contains/)
  assert.equal(malformedRecovery.retained, true)
  assert.equal(malformedRecovery.recoveredFolios, 2)
  assert.equal(malformedRecovery.recoveredEvent, 'saved-event')
  assert.equal(malformedRecovery.savedSession, null)
  assert.equal(malformedRecovery.migrated, false)
  await recoveryPage.evaluate(() => import('/__storage_app.tsx'))
  const recoveryDownload = recoveryPage.waitForEvent('download')
  await recoveryPage.getByRole('button', { name: 'Export recoverable project' }).click()
  const downloadedRecovery = JSON.parse(await readFile(await (await recoveryDownload).path(), 'utf8'))
  assert.equal(downloadedRecovery.recovery.status, 'unvalidated')
  assert.equal(downloadedRecovery.modules.faultTree.folios.length, 2)
  assert.equal(downloadedRecovery.modules.faultTree.folios[1].state.nodes[0].id, 'saved-event')
  await recoveryPage.close()
  const evidence = { schemaVersion: 1, status: 'passed', migration, scale, reports, saveRaces, failures, malformedRecovery }
  await writeFile(join(output, 'browser.json'), JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  await browser?.close()
  await closeViteTestServer(vite, cacheDir)
}
