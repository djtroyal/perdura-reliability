/** Startup recovery uses the real screen and real IndexedDB, including reloads. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'
import { closeViteTestServer } from './viteTestLifecycle.mjs'

const root = new URL('..', import.meta.url).pathname
const argument = process.argv.indexOf('--output-dir')
const output = resolve(argument < 0 ? join(tmpdir(), 'perdura-startup-recovery') : process.argv[argument + 1])
await mkdir(output, { recursive: true })
const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-startup-recovery-vite-'))
const appRoute = '/__startup_recovery_app.tsx'
const demo = JSON.parse(await readFile(new URL('../src/data/demoProject.json', import.meta.url), 'utf8'))
const validFile = { ...demo, project: 'Opened recovery file', modules: { systemDefinition: demo.modules.systemDefinition } }
const legacySystem = {
  _folioWrap: true,
  activeId: 'old-system',
  folios: [{ id: 'old-system', name: 'Original system folio', state: { model: demo.modules.systemDefinition.model } }],
}
const blocked = {
  projectName: 'Blocked saved system', identity: { projectId: 'blocked-system-project' },
  units: 'hours', analysisRuns: [], exportLedger: [], lastSavedAt: '2026-10-13T00:00:00.000Z',
  modules: { systemDefinition: legacySystem, recoverySentinel: { original: 'retain these exact inputs' } },
}

const vite = await createServer({
  root, cacheDir, logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, hmr: false },
  plugins: [{
    name: 'startup-recovery-assurance',
    resolveId(id) { if (id === appRoute) return id },
    load(id) {
      if (id === appRoute) return `
        import React from 'react'
        import { createRoot } from 'react-dom/client'
        import '/src/index.css'
        import App from '/src/App.tsx'
        createRoot(document.getElementById('root')).render(<App />)
      `
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split('?')[0]
        if (!['/__startup_recovery', '/__startup_seed'].includes(path)) return next()
        const script = path === '/__startup_recovery' ? `<script type="module" src="${appRoute}"></script>` : ''
        res.setHeader('Content-Type', 'text/html')
        res.end(await server.transformIndexHtml(path, `<!doctype html><html lang="en"><head><title>Startup recovery assurance</title></head><body><div id="root"></div>${script}</body></html>`))
      })
    },
  }],
})

let browser
let origin
const errors = []
const checks = []

async function newScenario() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({
    status: 200, contentType: 'application/json', body: '{}',
  }))
  await page.route('https://api.github.com/**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: '{}',
  }))
  await page.goto(`${origin}/__startup_seed`)
  return { context, page }
}

async function seedIndexedSession(page) {
  await page.evaluate(async source => {
    const { ProjectPersistence } = await import('/src/store/projectPersistence.ts')
    await new ProjectPersistence().save('session', source)
  }, blocked)
}

async function openRecovery(page) {
  await page.goto(`${origin}/__startup_recovery`)
  await expect(page.getByRole('alert')).toContainText('one canonical System Definition', { timeout: 90000 })
  await expect(page.getByRole('button', { name: 'Start blank project', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open project file', exact: true })).toBeVisible()
}

async function expectOpened(page, name) {
  await expect(page.getByRole('button', { name: 'Start blank project', exact: true })).toHaveCount(0, { timeout: 30000 })
  await expect(page.getByRole('button', { name: 'Start a new project', exact: true })).toBeVisible({ timeout: 30000 })
  await expect.poll(() => page.evaluate(async () => {
    const project = await import('/src/store/project.ts')
    return project.getProjectState().projectName
  })).toBe(name)
}

async function storedState(page) {
  return page.evaluate(async () => {
    const { ProjectPersistence } = await import('/src/store/projectPersistence.ts')
    const persistence = new ProjectPersistence()
    const summaries = await persistence.list()
    const saved = await Promise.all(summaries.map(async summary => ({ ...summary, project: await persistence.read(summary.id) })))
    return { session: await persistence.read('session'), saved, migrated: await persistence.migrationComplete() }
  })
}

async function upload(page, payload, name = 'project.json') {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open project file', exact: true }).click()
  await (await chooser).setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)) })
}

function assertArchive(snapshot) {
  const archive = snapshot.saved.find(item => item.name.startsWith(`${blocked.projectName} (startup recovery`))
  assert.ok(archive, 'The original session remains a named recovery project')
  assert.deepEqual(archive.project.modules, blocked.modules)
  assert.equal(archive.project.identity.projectId, blocked.identity.projectId)
}

try {
  await vite.listen()
  origin = `http://127.0.0.1:${vite.httpServer.address().port}`
  browser = await chromium.launch({ headless: true })

  const legacy = await newScenario()
  const legacyBytes = JSON.stringify(blocked)
  const namedBytes = JSON.stringify({
    'Legacy named system': { ...blocked, name: 'Legacy named system', savedAt: blocked.lastSavedAt },
    'Malformed legacy entry': null,
  })
  await legacy.page.evaluate(({ session, named }) => {
    localStorage.setItem('perdura:project-schema:7:session', session)
    localStorage.setItem('perdura:project-schema:7:projects', named)
  }, { session: legacyBytes, named: namedBytes })
  await legacy.page.goto(`${origin}/__startup_recovery`)
  await expectOpened(legacy.page, 'Untitled Project')
  let snapshot = await storedState(legacy.page)
  assert.equal(snapshot.session, null)
  assert.equal(snapshot.saved.length, 0)
  assert.equal(snapshot.migrated, false)
  assert.deepEqual(await legacy.page.evaluate(() => [
    localStorage.getItem('perdura:project-schema:7:session'),
    localStorage.getItem('perdura:project-schema:7:projects'),
  ]), [legacyBytes, namedBytes])
  await legacy.page.reload()
  await expectOpened(legacy.page, 'Untitled Project')
  checks.push('Unsupported browser namespaces remain untouched and do not enter the current project')
  await legacy.context.close()

  const blank = await newScenario()
  await seedIndexedSession(blank.page)
  await openRecovery(blank.page)
  await blank.page.getByRole('button', { name: 'Start blank project', exact: true }).click()
  await expectOpened(blank.page, 'Untitled Project')
  snapshot = await storedState(blank.page)
  assert.equal(snapshot.session.projectName, 'Untitled Project')
  assertArchive(snapshot)
  await blank.page.reload()
  await expectOpened(blank.page, 'Untitled Project')
  assertArchive(await storedState(blank.page))
  checks.push('Blank startup survives reload and preserves the rejected current session as an exact recovery archive')
  await blank.context.close()

  const imported = await newScenario()
  await seedIndexedSession(imported.page)
  await openRecovery(imported.page)
  const download = imported.page.waitForEvent('download')
  await imported.page.getByRole('button', { name: 'Export recoverable project', exact: true }).click()
  const recovered = JSON.parse(await readFile(await (await download).path(), 'utf8'))
  assert.equal(recovered.project, blocked.projectName)
  assert.deepEqual(recovered.modules, blocked.modules)
  assert.equal(recovered.recovery.status, 'unvalidated')
  await upload(imported.page, { invalid: true }, 'invalid.json')
  await expect(imported.page.getByRole('alert')).toContainText(/not a valid|no project|metadata|unsupported|invalid/i)
  snapshot = await storedState(imported.page)
  assert.deepEqual(snapshot.session, blocked)
  assert.equal(snapshot.saved.length, 0, 'Rejected files must not archive or replace the original session')
  await expect(imported.page.getByRole('button', { name: 'Start blank project', exact: true })).toBeVisible()
  await upload(imported.page, { ...validFile, modules: { systemDefinition: legacySystem } }, 'incompatible.json')
  await expect(imported.page.getByRole('alert')).toContainText('one canonical System Definition')
  snapshot = await storedState(imported.page)
  assert.deepEqual(snapshot.session, blocked)
  assert.equal(snapshot.saved.length, 0, 'A metadata-valid but incompatible project must not alter browser data')
  await upload(imported.page, validFile)
  await expectOpened(imported.page, validFile.project)
  snapshot = await storedState(imported.page)
  assert.equal(snapshot.session.projectName, validFile.project)
  assert.deepEqual(snapshot.session.modules.systemDefinition, validFile.modules.systemDefinition)
  assertArchive(snapshot)
  await imported.page.reload()
  await expectOpened(imported.page, validFile.project)
  assertArchive(await storedState(imported.page))
  checks.push('IndexedDB recovery exports the blocked project; invalid files preserve it; valid files open and reload with original archived')
  await imported.context.close()

  const failure = await newScenario()
  await seedIndexedSession(failure.page)
  await openRecovery(failure.page)
  await failure.page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    window.restoreRecoveryWrite = () => { IDBObjectStore.prototype.put = original }
    IDBObjectStore.prototype.put = function (value, ...args) {
      if (this.name === 'documents' && value?.id === 'session') {
        throw new DOMException('Injected recovery write failure', 'QuotaExceededError')
      }
      return original.call(this, value, ...args)
    }
  })
  await failure.page.getByRole('button', { name: 'Start blank project', exact: true }).click()
  await expect(failure.page.getByRole('alert')).toContainText('Injected recovery write failure')
  snapshot = await storedState(failure.page)
  assert.deepEqual(snapshot.session, blocked)
  assert.equal(snapshot.saved.length, 0, 'Failed replacement must roll back its archive in the same transaction')
  assert.equal(snapshot.migrated, false, 'Failed replacement must not commit a storage replacement marker')
  await failure.page.evaluate(() => window.restoreRecoveryWrite())
  await failure.page.getByRole('button', { name: 'Start blank project', exact: true }).click()
  await expectOpened(failure.page, 'Untitled Project')
  assertArchive(await storedState(failure.page))
  checks.push('An aborted replacement retains the original session, rolls back archive and storage marker, and permits retry')
  await failure.context.close()

  assert.deepEqual(errors, [])
  await writeFile(join(output, 'browser.json'), JSON.stringify({ status: 'passed', checks }, null, 2) + '\n')
  console.log('PASS startup recovery: blank project, file import, reload, original preservation, and atomic failure')
} catch (error) {
  await writeFile(join(output, 'failure.json'), JSON.stringify({ error: String(error), errors, checks }, null, 2) + '\n')
  throw error
} finally {
  await browser?.close()
  await closeViteTestServer(vite, cacheDir)
}
