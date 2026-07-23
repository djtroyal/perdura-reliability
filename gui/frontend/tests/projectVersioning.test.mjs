import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'vite'

const hmrServer = createHttpServer()
const vite = await createServer({
  root: new URL('..', import.meta.url).pathname,
  appType: 'custom',
  server: { middlewareMode: true, ws: { server: hmrServer } },
})

try {
  const project = await vite.ssrLoadModule('/src/store/project.ts')
  const version = await vite.ssrLoadModule('/src/version.ts')
  project.newProject('Version contract')
  project.setModuleState('growth', { input: 7, result: { estimate: 9 } })

  const payload = project.buildExport(undefined, true)
  assert.equal(payload.schemaVersion, version.PROJECT_SCHEMA_VERSION)
  assert.equal(payload.app, 'Perdura')
  assert.equal(payload.subtitle, 'Reliability Engineering and Statistics Suite')
  assert.equal(payload.website, 'https://perdurareliability.com')
  assert.equal(payload.createdWith.version, version.APP_VERSION)
  assert.equal(payload.createdWith.commit, version.APP_COMMIT)
  assert.equal(payload.engineRevisions.growth, version.engineRevisionFor('growth'))
  assert.equal(payload.version, undefined, 'legacy ambiguous version field must not be emitted')

  assert.throws(
    () => project.importPayload({ ...payload, schemaVersion: 1 }),
    /Unsupported project schema 1.*requires schema 4/,
    'older schemas must fail closed without a compatibility migration',
  )
  assert.throws(
    () => project.importPayload({ ...payload, schemaVersion: 999 }),
    /Unsupported project schema 999.*requires schema 4/,
    'newer schemas must fail closed instead of being interpreted approximately',
  )
  assert.throws(
    () => project.importPayload({ ...payload, subtitle: 'Unknown software' }),
    /metadata is incomplete/,
    'software identity metadata must match the Perdura schema contract',
  )

  let outcome = project.importPayload(payload)
  assert.deepEqual(outcome.recalculationRequired, [])
  assert.deepEqual(project.getProjectState().modules.growth.result, { estimate: 9 },
    'matching engine revisions must retain saved results')

  outcome = project.importPayload({
    ...payload,
    engineRevisions: { ...payload.engineRevisions, growth: 0 },
  })
  assert.deepEqual(outcome.recalculationRequired, ['Reliability Growth'])
  assert.equal(project.getProjectState().modules.growth.input, 7)
  assert.equal(project.getProjectState().modules.growth.result, undefined,
    'mismatched engine revisions must retain inputs and remove computed output')

  console.log('project versioning contracts passed')
} finally {
  await vite.close()
  hmrServer.close()
}
