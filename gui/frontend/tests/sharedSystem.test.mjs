import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'vite'
const hmrServer = createHttpServer()
const vite = await createServer({ root: new URL('..', import.meta.url).pathname, appType: 'custom',
  server: { middlewareMode: true, ws: { server: hmrServer } } })
try {
  const m = await vite.ssrLoadModule('/src/store/sharedSystemModel.ts')
  const store = await vite.ssrLoadModule('/src/store/project.ts')
  const shared = await vite.ssrLoadModule('/src/store/sharedSystem.ts')
  const initial = { standard: 'MIL-HDBK-217F', environment: 'GB', parts: [], blocks: [], blockSeq: 0 }
  let system = m.createProjectSystem('Plant'), scenario = m.emptyPredictionScenario(initial)
  const view = { ...initial, blocks: [{ id: 'a', name: 'Assembly', parentId: null, quantity: 2 },
    { id: 'b', name: 'Nested', parentId: 'a', quantity: 5 }], parts: [
      { id: 'p0', name: 'Root part', parentId: null, category: 'resistor', quantity: 1, params: { style: 'RW' } },
      { id: 'p1', name: 'Assembly part', parentId: 'a', category: 'resistor', quantity: 3, params: { style: 'RW' } },
      { id: 'p2', name: 'Nested part', parentId: 'b', category: 'resistor', quantity: 1, params: { style: 'RW' } }] }
  ;({ system, scenario } = m.splitPredictionUpdate(system, scenario, view))
  assert.equal(system.model.instances.length, 6)
  assert.equal(scenario.parts, undefined, 'scenario persistence never contains a copied hierarchy')
  assert.equal(scenario.blocks, undefined)
  assert.equal(m.materializePrediction(system, scenario, initial).parts[2].parentId, 'b')
  const other = m.emptyPredictionScenario(initial)
  assert.equal(m.materializePrediction(system, other, initial).parts.length, 3)
  assert.ok(m.materializePrediction(system, other, initial).parts.every(part => part.calculation_enabled === false))
  const before = structuredClone(scenario)
  const edited = m.materializePrediction(system, scenario, initial)
  edited.parts = edited.parts.map(part => part.id === 'p1' ? { ...part, quantity: 9, params: { style: 'RC' } } : part)
  const update = m.splitPredictionUpdate(system, scenario, edited)
  assert.equal(m.materializePrediction(update.system, other, initial).parts[1].quantity, 9)
  assert.deepEqual(scenario, before)
  assert.equal(update.scenario.partInputs.p1.params.style, 'RC')
  assert.equal(other.partInputs.p1, undefined)
  system.model.definitions.find(item => item.id === 'definition-p0').analysis_profiles = [{
    id: 'profile', name: 'Reviewed resistor', domain: 'prediction', adapter_id: 'prediction.mil-hdbk-217f',
    adapter_version: 1, status: 'reviewed', mode_ids: [], values: {
      category: { kind: 'text', value: 'resistor' }, style: { kind: 'text', value: 'RW' } } }]
  const profileScenario = { ...other, partInputs: { p0: { profileId: 'profile' } } }
  let profileView = m.materializePrediction(system, profileScenario, initial)
  const profileSaved = m.splitPredictionUpdate(system, profileScenario, { ...profileView, contributionScope: 'system' })
  assert.equal(profileSaved.scenario.partInputs.p0.params, undefined)
  system.model.definitions.find(item => item.id === 'definition-p0').analysis_profiles[0].values.style.value = 'RC'
  assert.equal(m.materializePrediction(system, profileSaved.scenario, initial).parts[0].params.style, 'RC')
  profileView = m.materializePrediction(system, profileSaved.scenario, initial)
  profileView.parts[0] = { ...profileView.parts[0], params: { style: 'RD' } }
  assert.equal(m.splitPredictionUpdate(system, profileSaved.scenario, profileView).scenario.partInputs.p0.params.style, 'RD')
  const switched = m.splitPredictionUpdate(system, profileSaved.scenario, {
    ...m.materializePrediction(system, profileSaved.scenario, initial), standard: 'Telcordia',
    parts: m.materializePrediction(system, profileSaved.scenario, initial).parts.map(part =>
      ({ ...part, category: 'resistor', params: { converted: 1 } })),
  })
  assert.equal(switched.scenario.partInputs.p0.profileId, undefined)
  assert.deepEqual(switched.scenario.partInputs.p0.params, { converted: 1 })
  const removed = { ...system, model: { ...system.model, instances: system.model.instances.filter(item => item.id !== 'p0') } }
  const graph = { nodes: [{ id: 'event', data: { label: 'Root part', systemRef: {
    system_model_id: system.model.id, instance_id: 'p0' } } }], edges: [], result: { p: 0.2 } }
  const dependencies = m.canonicalDependencyUpdates({ faultTree: { _folioWrap: true, activeId: 'f',
    folios: [{ id: 'f', name: 'FTA', state: graph }] } }, system, removed)
  const stale = dependencies.faultTree.folios[0]
  assert.equal(stale.state.nodes.length, 1)
  assert.equal(stale.state.nodes[0].data.systemReferenceBroken, true)
  assert.equal(stale.state.canonicalDependencies.status, 'broken')
  assert.deepEqual(stale.state.result, { p: 0.2 })
  assert.equal(stale.dirty, true)
  assert.equal(m.pruneScenarioInputs(removed.model, scenario).partInputs.p0, undefined)
  assert.throws(() => m.validateProjectSystem({ ...system.model, root_instance_id: 'a' }), /exactly one/)
  const partParent = structuredClone(system.model)
  partParent.instances.find(item => item.id === 'a').parent_instance_id = 'p0'
  assert.throws(() => m.validateProjectSystem(partParent), /Piece parts cannot/)
  assert.throws(() => m.normalizeSharedSystemModules({ systemDefinition: { _folioWrap: true, folios: [] } }), /one canonical/)
  assert.throws(() => m.normalizeSharedSystemModules({ prediction: { parts: [{ id: 'old', quantity: 1 }], blocks: [] } }), /Copied legacy hierarchies/)
  store.newProject('Shared')
  shared.commitProjectSystem(system)
  store.writeModuleSlices({ prediction: { _folioWrap: true, activeId: 'one', folios: [
    { id: 'one', name: 'One', state: { ...scenario, result: { total_failure_rate: 1 } } },
    { id: 'two', name: 'Two', state: { ...scenario, result: { total_failure_rate: 2 } } }] } })
  const request = store.beginFolioRequest('prediction', 'one', scenario, 'analysis',
    () => m.systemInputFingerprint(shared.currentProjectSystem().model))
  shared.commitProjectSystem(removed)
  assert.equal(request.isCurrent(), false)
  assert.equal(request.commit(value => ({ ...value, result: { late: true } })), false)
  for (const folio of store.getProjectState().modules.prediction.folios) {
    assert.equal(folio.dirty, true)
    assert.equal(folio.state.partInputs.p0, undefined)
  }
  // Result commits cannot turn inherited defaults into new inputs and mark themselves stale.
  store.writeModuleSlices({ prediction: { _folioWrap: true, activeId: 'fresh', folios: [
    { id: 'fresh', name: 'Fresh', state: { scenarioVersion: 1, partInputs: {}, blockInputs: {} } }] } })
  const raw = store.getProjectState().modules.prediction.folios[0].state
  const calculation = store.beginFolioRequest('prediction', 'fresh', raw)
  assert.equal(calculation.commit(previous => {
    const before = m.materializePrediction(removed, previous, initial)
    return m.mergePredictionResultUpdate(previous, before, { ...before, result: { rate: 2 } })
  }), true)
  assert.equal(store.getProjectState().modules.prediction.folios[0].dirty, false)
  assert.deepEqual(store.getProjectState().modules.prediction.folios[0].state.partInputs, {})
  calculation.finish()
  const fingerprint = m.systemInputFingerprint(system.model)
  assert.equal(m.systemInputFingerprint({ ...system.model, diagrams: [{ id: 'presentation', nodes: [] }] }), fingerprint)
  assert.deepEqual(m.brokenSystemReferences(graph, removed.model), ['instance:p0'])
  assert.deepEqual(m.brokenSystemReferences({ nodes: [{ id: 'event', data: { label: 'Detached' } }] }, removed.model), [])
  // Module exports carry the physical companion; input-only exports round-trip into a blank project.
  store.newProject('Export source')
  shared.commitProjectSystem(system)
  store.writeModuleSlices({ prediction: { _folioWrap: true, activeId: 'scenario', folios: [
    { id: 'scenario', name: 'Export scenario', state: scenario }] } })
  assert.deepEqual(store.moduleSlices('prediction'), ['prediction', 'systemDefinition'])
  const exported = store.buildExport(['prediction'], false)
  assert.ok(exported.modules.systemDefinition)
  assert.equal(exported.engineRevisions.prediction, 2)
  assert.equal(exported.modules.prediction.folios[0].state.parts, undefined)
  store.newProject('Import destination')
  store.importPayload(exported, 'prediction')
  const restored = store.getProjectState().modules
  assert.equal(m.materializePrediction(restored.systemDefinition, restored.prediction.folios[0].state, initial).parts.length, 3)
  const originalState = store.getProjectState()
  for (const defect of ['missing', 'number', 'duplicate', 'empty', 'active']) {
    const malformed = structuredClone(exported)
    const wrap = malformed.modules.prediction
    if (defect === 'missing') delete wrap.folios[0].id
    if (defect === 'number') wrap.folios[0].id = 1
    if (defect === 'duplicate') wrap.folios.push(structuredClone(wrap.folios[0]))
    if (defect === 'empty') wrap.folios = []
    if (defect === 'active') wrap.activeId = 'missing'
    assert.throws(() => store.importPayload(malformed), /scenario|identit/)
    assert.equal(store.getProjectState(), originalState, `${defect}: malformed import leaves the original project intact`)
  }
  const missingCompanion = structuredClone(exported)
  delete missingCompanion.modules.systemDefinition
  assert.throws(() => store.importPayload(missingCompanion, 'prediction'), /companion/)
  const changedSystem = structuredClone(exported)
  changedSystem.modules.systemDefinition.model.instances.find(item => item.id === 'p1').quantity = 77
  assert.throws(() => store.importPayload(changedSystem, 'prediction'), /different shared system/)
  assert.equal(store.getProjectState(), originalState)
  store.importPayload(changedSystem)
  assert.equal(store.getProjectState().modules.systemDefinition.model.instances.find(item => item.id === 'p1').quantity, 77)
  // Reporting materializes inactive scenarios and keeps same-name scenarios distinct.
  const fixture = JSON.parse(await readFile(new URL('../public/website-showcase/prediction.overview.json', import.meta.url), 'utf8'))
  store.importPayload(fixture)
  const resultWrap = structuredClone(store.getProjectState().modules.prediction)
  const first = resultWrap.folios[0]
  const second = { ...structuredClone(first), id: 'same-name-second', dirty: true }
  resultWrap.folios.push(second)
  store.setModuleState('prediction', resultWrap)
  const assets = (await vite.ssrLoadModule('/src/store/assetExtractors.ts')).enumerateAssets().filter(asset => asset.module === 'prediction')
  const inputTables = assets.filter(asset => asset.label === 'Shared System Inputs')
  assert.equal(inputTables.length, 2)
  assert.equal(new Set(inputTables.map(asset => asset.id)).size, 2)
  assert.ok(inputTables.every(asset => asset.getData().tableRows.some(row => row[0] === 'demo-part-1')))
  assert.ok(assets.some(asset => asset.analysisId === first.id && asset.type === 'metrics' && asset.source.resultStatus === 'current'))
  assert.ok(assets.filter(asset => asset.analysisId === second.id).every(asset => ['Shared System Inputs', 'Calculation Status', 'Imported BOM Mapping Traceability'].includes(asset.label)))
  assert.equal(assets.find(asset => asset.analysisId === second.id && asset.label === 'Calculation Status').source.resultStatus, 'stale')
  console.log('Shared system contracts passed: singleton, all-depth parts, scenario isolation, inherited profiles, canonical deletion, stale request guard.')
} finally { await vite.close(); hmrServer.close() }
