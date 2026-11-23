import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { createSsrTestServer } from './viteTestLifecycle.mjs'

const hmrServer = createHttpServer()
const vite = await createSsrTestServer({ root: new URL('..', import.meta.url).pathname,
  appType: 'custom', server: { middlewareMode: true, ws: { server: hmrServer } } })
try {
  const client = await vite.ssrLoadModule('/src/api/client.ts')
  const api = await vite.ssrLoadModule('/src/api/lifecycle.ts')
  let captured
  const originalPost = client.api.post
  client.api.post = async (url, body) => { captured = { url, body }; return { data: { ok: true } } }
  try {
    await api.compareReplacementPolicies({ cost_PM: 1, cost_CM: 8, weibull_alpha: 1200, weibull_beta: 3, block_repair_model: 'perfect' })
    assert.equal(captured.url, '/maintenance/replacement-policy')
    assert.equal(captured.body.block_repair_model, 'perfect')
    const cohorts = [{ id: 'Existing', count: 100, age: 12, entry_time: 0, exit_time: 24 }]
    await api.computeFleetForecast({ dist: 'gamma', dist_params: { alpha: 2, beta: 1 }, cohorts, horizon: 36, model: 'perfect_renewal', cost_per_event: 12 })
    assert.equal(captured.url, '/maintenance/fleet-forecast')
    assert.deepEqual(captured.body.cohorts, cohorts)
    assert.equal(captured.body.model, 'perfect_renewal')
  } finally { client.api.post = originalPost }

  const project = await vite.ssrLoadModule('/src/store/project.ts')
  const policy = { optimal_time: null, min_cost: 1, pm_per_time: 0, cm_per_time: .1,
    time: [1, 2], cost: [2, 1], decision: 'withheld', finite_optimum: false,
    decision_reason: 'Search range did not establish an interior candidate.', boundary_minimum: true, search_expanded: true }
  project.setModuleState('maintReplacement', { result: {
    age: { ...policy, decision: 'run_to_failure' },
    block: { ...policy, candidate_cost_lower: .9, candidate_cost_upper: 1.1,
      numerical: { method: 'lattice', cells: 1024, interval_grid_step: .01, cost_lower: [1.9, .9], cost_upper: [2.1, 1.1] } },
    corrective_only_cost: 1, mttf: 10, cheaper_policy: 'undetermined', block_repair_model: 'perfect',
    maintenance_assumptions: { block: 'Perfect renewal after failure and PM.' }, recommendation: 'Withheld',
  } })
  project.setModuleState('maintCostForecast', { result: {
    policy: 'block', block_repair_model: 'perfect', interval: 2, expected_pm: 1, expected_cm: 3,
    expected_cm_lower: 2.9, expected_cm_upper: 3.1, total_cost: 25, cost_rate: 12.5, mttf: 10,
    time: [0, 2], cumulative_cost: [0, 25], cumulative_cost_lower: [0, 24.2], cumulative_cost_upper: [0, 25.8],
    finite_horizon_transients_modeled: true, assumption_note: 'Perfect renewal; zero downtime.',
  } })
  const { enumerateAssets } = await vite.ssrLoadModule('/src/store/assetExtractors.ts')
  const assets = enumerateAssets()
  const metrics = label => new Map(assets.find(asset => asset.label === label).getData().metrics.map(row => [row.label, row.value]))
  const replacement = metrics('Age vs Block Policy')
  assert.equal(replacement.get('Recommended policy'), 'Not established')
  assert.equal(replacement.get('Block selected interval'), 'Not established')
  assert.equal(replacement.get('Repair between block replacements'), 'Perfect renewal')
  assert.equal(Number(replacement.get('Numerical interval grid resolution')), .01)
  assert.ok(replacement.has('Candidate cost/time discretization bounds'))
  const cost = metrics('Maintenance Cost Forecast')
  assert.equal(cost.get('Analysis basis'), 'Finite-horizon renewal forecast')
  assert.ok(cost.has('Average cost/time over horizon'))
  assert.ok(cost.has('Total cost discretization bounds'))
  assert.equal(cost.get('Assumptions'), 'Perfect renewal; zero downtime.')
  const costPlot = assets.find(asset => asset.label === 'Cumulative Maintenance Cost').getData().plotData
  assert.equal(costPlot.some(trace => trace.name === 'Discretization bounds'), true)
  assert.equal(JSON.stringify(costPlot).includes('confidence'), false)
  console.log('Lifecycle repair-model, cohort, numerical decision, and report contracts passed')
} finally { await vite.close() }
