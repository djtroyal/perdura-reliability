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
  assert.equal(values.get(`${project.PROJECT_STORAGE_NAMESPACE}:session`), legacy,
    'legacy state should be copied into the current schema namespace once')

  project.setModuleState('growth', { input: 9 })
  await new Promise(resolve => setTimeout(resolve, 450))
  assert.equal(JSON.parse(values.get('reliability-suite-session')).projectName, 'Legacy browser tab',
    'new builds must never overwrite storage still used by an older tab')
  assert.equal(JSON.parse(values.get(`${project.PROJECT_STORAGE_NAMESPACE}:session`)).modules.growth.input, 9)
  console.log('project storage isolation contracts passed')
} finally {
  await vite.close()
  hmrServer.close()
  delete globalThis.localStorage
}
