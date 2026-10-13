/** Physical invariance of manual graph models versus explicitly source-owned units. */
import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'vite'
const hmrServer = createHttpServer()
const vite = await createServer({ root: new URL('..', import.meta.url).pathname, appType: 'custom',
  server: { middlewareMode: true, ws: { server: hmrServer } } })
try {
  const { convertStateObject, UNIT_RULES } = await vite.ssrLoadModule('/src/store/unitFields.ts')
  const { computeCDF } = await vite.ssrLoadModule('/src/components/FaultTree/index.tsx')
  const graph = { exposureTime: '1234.56789012345', missionTime: '1234.56789012345', nodes: [
    ['exponential', { lambda: .00123456789012345, gamma: 2 }],
    ['weibull', { alpha: 987.65432109876, beta: 1.7, gamma: 3 }],
    ['normal', { mu: 1000.123456789, sigma: 201.234567891 }],
    ['lognormal', { mu: 6.23456789123, sigma: .6, gamma: 4 }],
    ['gamma', { alpha: 2.5, beta: 301.23456789, gamma: 5 }],
    ['loglogistic', { alpha: 1000.1234567, beta: 3, gamma: 6 }],
    ['gumbel', { mu: 1000.1234567, sigma: 201.23456789 }],
    ['beta', { alpha: 2.5, beta: 3, support_scale: 2000 }],
  ].map(([distribution, dist_params], index) => ({ id: String(index), data: { distribution, dist_params,
    exposure_time: 876.543210987654, mission_time: 876.543210987654 } })) }
  for (const key of ['faultTree', 'system']) {
    const original = structuredClone(graph)
    const days = convertStateObject(graph, UNIT_RULES[key], 'hours', 'days')
    const timeKey = key === 'faultTree' ? 'exposureTime' : 'missionTime'
    const overrideKey = key === 'faultTree' ? 'exposure_time' : 'mission_time'
    assert.equal(Number(days[timeKey]), Number(graph[timeKey]) / 24)
    days.nodes.forEach((node, index) => {
      const before = graph.nodes[index].data
      assert.equal(node.data[overrideKey], before[overrideKey] / 24)
      const originalCDF = computeCDF(before.distribution, before.dist_params, before[overrideKey])
      const convertedCDF = computeCDF(node.data.distribution, node.data.dist_params, node.data[overrideKey])
      assert.ok(Math.abs(originalCDF - convertedCDF) < 1e-12, `${key}/${before.distribution} probability changes under unit conversion`)
    })
    assert.equal(days.nodes[0].data.dist_params.lambda, graph.nodes[0].data.dist_params.lambda * 24)
    assert.equal(days.nodes[3].data.dist_params.mu, graph.nodes[3].data.dist_params.mu + Math.log(1/24))
    assert.equal(days.nodes[4].data.dist_params.alpha, 2.5, 'Gamma shape is dimensionless')
    assert.equal(days.nodes[4].data.dist_params.beta, graph.nodes[4].data.dist_params.beta / 24, 'Gamma beta is scale')
    const hours = convertStateObject(days, UNIT_RULES[key], 'days', 'hours')
    for (let i=0; i<graph.nodes.length; i++) for (const [parameter, value] of Object.entries(graph.nodes[i].data.dist_params))
      assert.ok(Math.abs(hours.nodes[i].data.dist_params[parameter] - value) <= 1e-14*Math.max(1,Math.abs(value)))
    assert.deepEqual(graph, original, 'conversion does not mutate the captured graph')
    for (const source of [{ distributionSource: { module: 'lifeData', analysisId: 'fit' } }, { ldaFolioId: 'fit' }, { ldaSource: 'pred:folio' }, { sourceId: 'fit' }]) {
      const linked = { nodes: [{ data: { ...graph.nodes[0].data, ...source } }] }
      const converted = convertStateObject(linked, UNIT_RULES[key], 'hours', 'days').nodes[0].data
      assert.deepEqual(converted.dist_params, linked.nodes[0].data.dist_params, 'live source parameters are resolved from declared units, never double-scaled')
      assert.equal(converted[overrideKey], linked.nodes[0].data[overrideKey]/24)
    }
  }
  const incomplete = convertStateObject({ nodes: [{ data: { distribution: 'weibull', dist_params: { beta: 2 } } }] }, UNIT_RULES.faultTree, 'hours', 'days')
  assert.equal(incomplete.nodes[0].data.dist_params.alpha, undefined, 'conversion cannot invent a missing scale parameter')
  const optionalBeta = convertStateObject({ nodes: [{ data: { distribution: 'beta', dist_params: { alpha: 2, beta: 3 } } }] }, UNIT_RULES.faultTree, 'hours', 'days')
  assert.equal(optionalBeta.nodes[0].data.dist_params.support_scale, 1/24, 'the defined optional support default scales with the physical axis')
  const prediction = { missionHours: '1234.56789012345', missionPhases: [{ duration_hours: 123.4567890123 }],
    partInputs: { p: { failure_rate_override_fpmh: .123456789 } } }
  assert.deepEqual(convertStateObject(prediction, UNIT_RULES.prediction, 'hours', 'days'), prediction)
  const mcf = convertStateObject({ mcf: { text: '1234.56789012345 | 2345.67890123456' } }, UNIT_RULES.growth, 'hours', 'days')
  assert.equal(mcf.mcf.text, `${1234.56789012345/24} | ${2345.67890123456/24}`)
  const markov = { tMax: 240, transitions: [{ rate: .0123456789123 }, { rate: 10, sourceId: 'fit' }],
    canvasEdges: [{ data: { rate: .0123456789123 } }, { data: { rate: 10, sourceId: 'fit' } }] }
  const converted = convertStateObject(markov, UNIT_RULES.markov, 'hours', 'days')
  assert.equal(converted.tMax, 10)
  assert.equal(converted.transitions[0].rate, .0123456789123 * 24)
  assert.equal(converted.canvasEdges[0].data.rate, converted.transitions[0].rate)
  assert.equal(converted.transitions[1].rate, 10)
  assert.equal(converted.canvasEdges[1].data.rate, 10)
  const project = await vite.ssrLoadModule('/src/store/project.ts')
  project.newProject('Explicit unit ownership')
  const lifeData = { folios: [{ id: 'data', name: 'Declared dataset', quantity: { kind: 'time', unit: 'days' },
    result: { params: { eta: 10, beta: 2 } }, adoptedDistribution: { distribution: 'Weibull_2P', parameters: { eta: 10, beta: 2 } } }] }
  const predictionSlice = { _folioWrap: true, activeId: 'scenario', folios: [{ id: 'scenario', name: 'Scenario', state: {
    ...prediction, scenarioVersion: 1, partInputs: {}, blockInputs: {}, result: { total_failure_rate: 1.2 } } }] }
  project.writeModuleSlices({ lifeData, prediction: predictionSlice })
  const before = project.getProjectState().modules
  project.convertProjectUnits('hours', 'days')
  assert.deepEqual(project.getProjectState().modules.lifeData, before.lifeData, 'dataset units, adoption and completed results are retained')
  assert.deepEqual(project.getProjectState().modules.prediction, before.prediction, 'fixed-hour Prediction inputs and completed results are retained')
  console.log('Shared system unit contracts passed: eight distribution families, FTA/RBD overrides, source-owned units, full precision, Markov canvas rates.')
} finally { await vite.close(); hmrServer.close() }
