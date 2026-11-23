import assert from 'node:assert/strict'
import { test } from 'node:test'
import { capabilityModelSources, capabilityModelTailStatus, saveCapabilityModelTail } from '../src/components/ProcessCapability/modelTails.ts'
import { adoptDistribution, createFitProvenance } from '../src/components/shared/adoptedDistribution.ts'

function fixture() {
  const folio = { id: 'pressure', name: 'Pressure', dataSource: 'spec',
    quantity: { kind: 'pressure', unit: 'MPa' },
    spec: { distribution: 'Lognormal_2P', params: { mu: '0', sigma: '.25' } },
    specResult: { distribution: 'Lognormal_2P', params: { mu: 0, sigma: .25 } } }
  folio.fitProvenance = createFitProvenance(folio)
  folio.adoptedDistribution = adoptDistribution(folio, 'Lognormal_2P')
  return { units: 'hours', modules: { lifeData: { folios: [folio] } } }
}

test('specification-tail selector retains non-lifetime measurement units and parameters', () => {
  const project = fixture(), sources = capabilityModelSources(project)
  assert.equal(sources.length, 1)
  assert.deepEqual(sources[0].model.quantity, { kind: 'pressure', unit: 'MPa' })
  assert.deepEqual(sources[0].model.parameters, { mu: 0, sigma: .25 })
})

test('specification-tail selector excludes stale or unconfirmed models', () => {
  const project = fixture()
  project.modules.lifeData.folios[0].spec.params.sigma = '.5'
  assert.deepEqual(capabilityModelSources(project), [])
  delete project.modules.lifeData.folios[0].adoptedDistribution
  assert.deepEqual(capabilityModelSources(project), [])
  assert.deepEqual(capabilityModelSources({ units: 'hours', modules: {} }), [])
})

function calculatedState(project = fixture()) {
  const source = capabilityModelSources(project)[0]
  const result = { distribution: 'Lognormal_2P', params: { mu: 0, sigma: .25 }, lsl: null, usl: 2,
    probability_below_lsl: 0, probability_above_usl: .0027806, probability_total: .0027806,
    below_lsl: 0, above_usl: 2780.6, total: 2780.6, method: 'specified_distribution_direct_tails', parameter_uncertainty_included: false }
  return { modelSourceId: source.id, lsl: '', usl: '2', modelTailResult: saveCapabilityModelTail(result, source, 2) }
}

test('tail provenance follows source identity, limits, engine and immutable model snapshot', () => {
  const project = fixture(), state = calculatedState(project), saved = structuredClone(state.modelTailResult)
  const status = () => capabilityModelTailStatus(project, state, 2).status
  assert.equal(status(), 'current')
  project.modules.lifeData.folios[0].name = 'Renamed pressure'
  project.units = 'seconds'
  assert.equal(status(), 'current')
  state.usl = '3'
  assert.equal(status(), 'stale')
  state.usl = '2'
  assert.equal(capabilityModelTailStatus(project, state, 3).status, 'stale')
  project.modules.lifeData.folios.push({ ...structuredClone(project.modules.lifeData.folios[0]), id: 'same-model-other-dataset' })
  state.modelSourceId = 'same-model-other-dataset'
  assert.equal(status(), 'stale')
  state.modelSourceId = 'pressure'
  project.modules.lifeData.folios[0].spec.params.sigma = '.5'
  assert.equal(status(), 'stale')
  assert.deepEqual(state.modelTailResult, saved)
})

test('legacy or inconsistent tail snapshots are never promoted to current', () => {
  const project = fixture(), state = calculatedState(project)
  state.modelTailResult.provenance.model.parameters.sigma = .5
  assert.equal(capabilityModelTailStatus(project, state, 2).status, 'unverified')
  delete state.modelTailResult.provenance
  assert.equal(capabilityModelTailStatus(project, state, 2).status, 'unverified')
  assert.equal(capabilityModelTailStatus(project, {}, 2), null)
})

test('reports, dashboard and project snapshots preserve current and historical tail contexts', async () => {
  const { createServer } = await import('node:http')
  const { createSsrTestServer, closeViteTestServer } = await import('./viteTestLifecycle.mjs')
  const hmr = createServer(), cacheDir = `/tmp/perdura-tail-provenance-${process.pid}`
  const vite = await createSsrTestServer({ root: new URL('..', import.meta.url).pathname, cacheDir,
    appType: 'custom', server: { middlewareMode: true, ws: { server: hmr } } })
  try {
    const store = await vite.ssrLoadModule('/src/store/project.ts')
    const assets = await vite.ssrLoadModule('/src/store/assetExtractors.ts')
    const dashboard = await vite.ssrLoadModule('/src/store/dashboardSummary.ts')
    store.newProject('Tail provenance')
    const project = fixture(), state = calculatedState(project)
    store.setModuleState('lifeData', project.modules.lifeData)
    store.setModuleState('sixSigma.capability', state)
    const tailAsset = () => assets.enumerateAssets().find(asset => asset.label === 'Adopted-model Specification PPM')
    assert.equal(tailAsset().source.resultStatus, 'current')
    assert.equal(dashboard.computeDashboardSummary().areas.find(area => area.tabId === 'six-sigma').stale, false)
    const original = structuredClone(state.modelTailResult)
    const changed = structuredClone(project.modules.lifeData)
    changed.folios[0].spec.params.sigma = '.5'
    store.setModuleState('lifeData', changed)
    assert.equal(tailAsset().source.resultStatus, 'stale')
    assert.match(tailAsset().getData().metrics.find(metric => metric.label === 'Status').value, /Historical/)
    assert.equal(dashboard.computeDashboardSummary().areas.find(area => area.tabId === 'six-sigma').stale, true)
    assert.deepEqual(store.buildExport(undefined, true).modules['sixSigma.capability'].modelTailResult, original)
    assert.equal(store.buildExport(undefined, false).modules['sixSigma.capability'].modelTailResult, undefined)
  } finally { await closeViteTestServer(vite, cacheDir, hmr) }
})
