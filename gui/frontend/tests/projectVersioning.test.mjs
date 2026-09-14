import assert from 'node:assert/strict'
import { mock } from 'node:test'
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
    /Unsupported project schema 1.*accepts schema 6 or 7/,
    'schemas older than the explicit migration boundary must fail closed',
  )
  assert.throws(
    () => project.importPayload({ ...payload, schemaVersion: 999 }),
    /Unsupported project schema 999.*accepts schema 6 or 7/,
    'newer schemas must fail closed instead of being interpreted approximately',
  )
  project.importPayload({
    ...payload,
    schemaVersion: 6,
    modules: { ...payload.modules, prediction: { blocks: [], parts: [] } },
  })
  assert.ok(project.getProjectState().modules.systemDefinition,
    'schema 6 projects with hierarchy data must receive the canonical System Definition slice')
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

  project.newProject('Existing hours project')
  project.setModuleState('warranty', { times: [100, 200], result: { estimate: 1 } })
  project.importPayload({ ...payload, units: 'days' })
  assert.deepEqual(Object.keys(project.getProjectState().modules), ['growth'],
    'full imports must remove modules absent from the imported project')
  assert.equal(project.getProjectState().units, 'days')
  assert.equal(project.getProjectState().identity.projectId, payload.identity.projectId)
  assert.equal(project.isDirty(), false, 'the imported project is a clean baseline')

  project.newProject('Partial import destination')
  project.setModuleState('warranty', { times: [100, 200] })
  const destinationId = project.getProjectState().identity.projectId
  project.importPayload(payload, 'growth')
  assert.deepEqual(project.getProjectState().modules.warranty, { times: [100, 200] },
    'a module import must preserve unrelated modules')
  assert.equal(project.getProjectState().identity.projectId, destinationId)
  assert.equal(project.isDirty(), true, 'a module import edits the destination project')

  const originalFetch = globalThis.fetch
  project.setModuleState('warranty', { times: [100, 200], result: { estimate: 42 } })
  globalThis.fetch = async () => ({ ok: true, json: async () => ({
    ...payload, engineRevisions: { ...payload.engineRevisions, warranty: 0 },
  }) })
  try {
    assert.equal(await project.applyWebsiteShowcaseFixture('growth-example'), true)
    assert.deepEqual(project.getProjectState().modules.warranty,
      { times: [100, 200], result: { estimate: 42 } },
      'a showcase patch must preserve unrelated results even if its source engine revisions differ')
  } finally {
    globalThis.fetch = originalFetch
  }

  const initial = { parts: [{ id: 'part-1', value: 1 }], result: null }
  const setupFolios = () => {
    project.newProject('Request origin')
    project.setModuleState('prediction', {
      _folioWrap: true, activeId: 'a', folios: [
        { id: 'a', name: 'A', state: initial },
        { id: 'b', name: 'B', state: { ...initial, parts: [{ id: 'part-2', value: 2 }] } },
      ],
    })
  }
  const select = id => project.setModuleState('prediction', {
    ...project.getProjectState().modules.prediction, activeId: id,
  })
  const request = channel => project.beginFolioRequest('prediction', 'a', initial, channel)
  const publish = pending => pending.commit(current => ({ ...current, result: { estimate: 7 } }))
  setupFolios()
  let pending = request()
  select('b')
  assert.equal(publish(pending), false, 'a response must not overwrite a different active folio')
  select('a')
  assert.equal(publish(pending), false, 'returning to the original folio must not revive a stale request')
  pending.finish()
  assert.equal(project.getProjectState().modules.prediction.folios[1].state.result, null)

  pending = request()
  project.writeFolioState('prediction', 'a', { ...initial, parts: [{ id: 'part-1', value: 3 }] })
  project.writeFolioState('prediction', 'a', initial)
  assert.equal(publish(pending), false, 'an edit-and-revert must invalidate the pending input snapshot')
  pending.finish()

  pending = request()
  project.newProject('Different project')
  assert.equal(publish(pending), false, 'a stale response must not recreate a slice in another project')
  assert.deepEqual(project.getProjectState().modules, {})
  pending.finish()

  setupFolios()
  pending = request()
  const sameIdentity = project.buildExport(undefined, true)
  project.importPayload(sameIdentity)
  assert.equal(publish(pending), false, 'reopening the same project identity starts a new request epoch')
  pending.finish()

  setupFolios()
  const older = request()
  const newer = request()
  assert.equal(publish(newer), true)
  assert.equal(publish(older), false, 'an older response must not replace the latest response')
  older.finish()
  newer.finish()
  const resultOnly = request()
  project.writeFolioState('prediction', 'a', { ...initial, result: { estimate: 8 } })
  assert.equal(publish(resultOnly), true, 'independent result updates must not invalidate unchanged inputs')
  resultOnly.finish()

  const cancelled = request()
  cancelled.finish()
  assert.equal(publish(cancelled), false, 'unmount cleanup must reject all subsequent writes')
  project.newProject('Unwrapped legacy analysis')
  project.setModuleState('prediction', initial)
  pending = project.beginFolioRequest('prediction', 'f0', initial)
  assert.equal(publish(pending), true, 'legacy raw slices must still accept their own calculation')
  assert.equal(project.getProjectState().modules.prediction.folios[0].state.result.estimate, 7)
  pending.finish()

  // Exercise both sides of the provenance async boundary without wall-clock sleeps.
  const originalDigest = crypto.subtle.digest
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    project.newProject('Old provenance origin')
    project.setModuleState('growth', { input: 11, result: { estimate: 17 } })
    project.newProject('New project before capture timer')
    mock.timers.tick(200)
    await new Promise(setImmediate)
    assert.deepEqual(project.getProjectState().analysisRuns, [],
      'a delayed capture must not stamp old results with a new project identity')

    let releaseDigest
    const digestGate = new Promise(resolve => { releaseDigest = resolve })
    let digestCalls = 0
    crypto.subtle.digest = async () => {
      digestCalls += 1
      await digestGate
      return new ArrayBuffer(32)
    }
    project.setModuleState('growth', { input: 23, result: { estimate: 29 } })
    mock.timers.tick(200)
    assert.equal(digestCalls, 2, 'input and result hashing must be pending before project replacement')
    project.importPayload(project.buildExport(undefined, true))
    releaseDigest()
    await new Promise(setImmediate)
    assert.deepEqual(project.getProjectState().analysisRuns, [],
      'hash completion after reopening the same project must not append an obsolete run')

    project.setModuleState('growth', { input: 31, result: { estimate: 37 } })
    mock.timers.tick(200)
    await new Promise(setImmediate)
    assert.equal(project.getProjectState().analysisRuns.length, 1,
      'unchanged project epochs must still record successful calculations')
    assert.equal(project.getProjectState().analysisRuns[0].projectId,
      project.getProjectState().identity.projectId)
  } finally {
    crypto.subtle.digest = originalDigest
    mock.timers.reset()
  }

  console.log('project versioning contracts passed')
} finally {
  await vite.close()
  hmrServer.close()
}
