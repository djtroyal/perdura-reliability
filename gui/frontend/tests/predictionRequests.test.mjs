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
  const { beginDeratingCalculation, deratingApiParts } = await vite.ssrLoadModule(
    '/src/components/Prediction/deratingRequest.ts',
  )
  const initial = {
    parts: [{
      id: 'part-a', category: 'resistor', quantity: 1, params: {}, parentId: 'block-a',
      part_number: ' R1 ', system_ref: { occurrenceId: 'canonical-part-a' },
    }],
    deratingEnabled: false, deratingStandard: 'MIL-STD-975M', deratingLevel: 'II',
    customRules: {}, missionHours: 120, result: null, deratingResult: null,
  }
  const reset = () => {
    project.newProject('Derating request tests')
    project.setModuleState('prediction', {
      _folioWrap: true, activeId: 'a', folios: [
        { id: 'a', name: 'A', state: initial },
        { id: 'b', name: 'B', state: { ...initial, parts: [{ ...initial.parts[0], id: 'part-b' }] } },
      ],
    })
    const state = project.getProjectState()
    return { projectId: state.identity.projectId, revision: state.revision, folioId: 'a', units: state.units }
  }
  const active = () => project.getProjectState().modules.prediction.folios.find(
    folio => folio.id === 'a',
  ).state
  const update = patch => project.writeFolioState('prediction', 'a', { ...active(), ...patch })
  const select = activeId => project.setModuleState('prediction', {
    ...project.getProjectState().modules.prediction, activeId,
  })

  // Simulate the actual control ordering: persist the input, then initiate the
  // request synchronously before React has supplied an updated render closure.
  for (const patch of [
    { deratingEnabled: true },
    { deratingStandard: 'RADC-TR-84-254' },
    { deratingLevel: 'III' },
    { deratingStandard: 'Custom', customRules: { resistor: [{ param: 'stress', level_I: 0.5 }] } },
  ]) {
    const origin = reset()
    update(patch)
    const calculation = beginDeratingCalculation(origin)
    assert.ok(calculation, 'the originating folio still exists after its control update')
    assert.deepEqual(calculation.snapshot, active(), 'API inputs and guard must use the same updated snapshot')
    assert.equal(calculation.request.isCurrent(), true)
    const response = await Promise.resolve({ summary: { ok: 1 }, results: [] })
    assert.equal(calculation.request.commit(current => ({ ...current, deratingResult: response })), true,
      'enable, profile and level changes must accept their own immediate rerun')
    assert.deepEqual(active().deratingResult, response)
    assert.equal(project.getProjectState().modules.prediction.folios[0].dirty, false)
    calculation.request.finish()
  }

  let origin = reset()
  update({
    parts: [
      { ...initial.parts[0], derating_params: { profile: 'Custom', family: 'resistor', stress: 0.7 } },
      { ...initial.parts[0], id: 'part-c', part_number: 'r1', derating_params: { profile: 'Custom', family: 'resistor', voltage: 10 } },
    ],
  })
  let calculation = beginDeratingCalculation(origin)
  const apiParts = deratingApiParts(calculation.snapshot.parts, 'Custom')
  assert.equal(apiParts[0].derating_params.voltage, 10, 'shared part inputs come from the captured current parts')
  assert.equal(apiParts[0].derating_params.stress, 0.7, 'local operational inputs win over shared values')
  assert.equal('parentId' in apiParts[0], false)
  assert.equal('system_ref' in apiParts[0], false)
  update({ parts: [{ ...initial.parts[0], quantity: 3 }] })
  assert.equal(calculation.request.commit(current => ({ ...current, deratingResult: {} })), false,
    'an input edit during the request must still reject its delayed response')
  calculation.request.finish()

  origin = reset()
  const prediction = project.beginFolioRequest('prediction', 'a', initial)
  assert.equal(prediction.commit(current => ({ ...current, result: { total: 1 } })), true)
  calculation = beginDeratingCalculation(origin, prediction)
  assert.ok(calculation, 'a successful same-folio prediction may immediately start derating')
  prediction.finish()
  assert.equal(calculation.request.commit(current => ({ ...current, deratingResult: {} })), true,
    'finishing the parent prediction must not cancel its independent derating channel')
  calculation.request.finish()

  origin = reset()
  let parent = project.beginFolioRequest('prediction', 'a', initial)
  select('b')
  assert.equal(beginDeratingCalculation(origin, parent), null,
    'an asynchronous follow-up must never capture the newly selected folio')
  select('a')
  assert.equal(beginDeratingCalculation(origin, parent), null,
    'switching away and back must not revive the parent request')
  parent.finish()

  origin = reset()
  parent = project.beginFolioRequest('prediction', 'a', initial)
  project.convertProjectUnits('hours', 'days')
  assert.equal(beginDeratingCalculation(origin, parent), null,
    'converted inputs must invalidate automatic follow-up from the old calculation')
  parent.finish()

  origin = reset()
  assert.equal(beginDeratingCalculation({ ...origin, units: 'days' }), null,
    'a closure using different project units must not start a new request')

  origin = reset()
  const sameProject = project.buildExport(undefined, true)
  project.importPayload(sameProject)
  assert.equal(beginDeratingCalculation(origin), null,
    'reopening the same project identity must invalidate the previous generation')
  project.newProject('Replacement project')
  project.setModuleState('prediction', initial)
  assert.equal(beginDeratingCalculation(origin), null,
    'a stale closure must not capture a replacement project')

  const legacyProject = project.getProjectState()
  calculation = beginDeratingCalculation({
    projectId: legacyProject.identity.projectId, revision: legacyProject.revision, folioId: 'f0',
    units: legacyProject.units,
  })
  assert.ok(calculation, 'legacy unwrapped folios must still support derating')
  calculation.request.finish()
  assert.equal(calculation.request.isCurrent(), false, 'cleanup rejects subsequent writes')

  console.log('Prediction request context contracts passed')
} finally {
  await vite.close()
  hmrServer.close()
}
