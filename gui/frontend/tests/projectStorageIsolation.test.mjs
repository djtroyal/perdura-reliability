import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'vite'

const values = new Map()
globalThis.localStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: key => values.delete(key),
  clear: () => values.clear(),
  key: index => [...values.keys()][index] ?? null,
  get length() { return values.size },
}

const legacy = JSON.stringify({
  projectName: 'Legacy browser tab',
  units: 'hours',
  revision: 0,
  modules: { growth: { input: 7 } },
})
values.set('reliability-suite-session', legacy)

const hmrServer = createHttpServer()
const vite = await createServer({
  root: new URL('..', import.meta.url).pathname,
  appType: 'custom',
  server: { middlewareMode: true, ws: { server: hmrServer } },
})

try {
  const project = await vite.ssrLoadModule('/src/store/project.ts')
  const version = await vite.ssrLoadModule('/src/version.ts')
  assert.equal(project.PROJECT_STORAGE_NAMESPACE, `perdura:project-schema:${version.PROJECT_SCHEMA_VERSION}`)
  assert.equal(project.getProjectState().projectName, 'Legacy browser tab')
  assert.equal(values.get(`${project.PROJECT_STORAGE_NAMESPACE}:session`), undefined,
    'opening legacy storage must not create another full localStorage snapshot')
  await assert.rejects(project.hydrateProjectStorage(), /IndexedDB is unavailable/,
    'unavailable durable storage must fail visibly, never silently fall back to localStorage')
  project.setModuleState('growth', { input: 9 })
  assert.equal(await project.saveNamedProject('Blocked save'), false)
  assert.equal(project.isDirty(), true, 'failed commits must not mark the project saved')
  assert.equal(values.get('reliability-suite-session'), legacy,
    'migration and failed saves must never overwrite data used by older tabs')
  assert.equal(values.get(`${project.PROJECT_STORAGE_NAMESPACE}:session`), undefined)
  console.log('project storage isolation contracts passed')
} finally {
  await vite.close()
  hmrServer.close()
  delete globalThis.localStorage
}
