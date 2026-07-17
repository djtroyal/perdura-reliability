import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'vite'

const hmrServer = createHttpServer()
const vite = await createServer({
  root: new URL('..', import.meta.url).pathname,
  appType: 'custom',
  server: { middlewareMode: true, hmr: { server: hmrServer } },
})

const response = {
  nonparametric: {
    time: [5, 10], MCF: [0.5, 1.25],
    MCF_lower: [0.2, null], MCF_upper: [1.0, null],
    variance: [0.04, 0.2], standard_error: [0.2, 0.447],
    at_risk: [4, 2], events_at_time: [2, 1], CI: 0.95,
    variance_method: 'nelson_lawless_nadeau_subject_robust',
    interval_method: 'cluster_bootstrap',
    n_systems: 4, n_events: 3,
    variance_available: true, interval_available: false,
    interval_point_available: [true, false],
    interval_status: 'partially_unavailable',
    interval_reason: 'Late bound withheld.',
    tail_risk_threshold: 3, sparse_tail: [false, true],
    tail_warning: 'Sparse tail.',
    data_contract: 'explicit_event_times_and_observation_ends',
    bootstrap: {
      samples: 100, seed: null,
      lower: [0.2, null], upper: [1.0, null],
      standard_error: [0.2, null], valid_replicates: [100, 60],
      minimum_valid_replicates: 80, point_available: [true, false],
      interval_status: 'partially_unavailable',
      interval_reason: 'Late bound withheld.',
      resampling_unit: 'system_history_cluster',
    },
  },
  parametric: {
    alpha: 8, log_alpha: Math.log(8), beta: 0.7,
    Lambda: 0.23, log_Lambda: Math.log(0.23),
    profile_score: 0, optimizer: 'brent_profile_score_unequal_observation_ends',
    converged: true, beta_lower: 0.4, beta_upper: 1.1,
    beta_interval_method: 'profile_likelihood_chi_square_1df',
    endpoint_time: 10, endpoint_MCF: 1.2,
    endpoint_MCF_lower: 0.7, endpoint_MCF_upper: 2.1,
    endpoint_MCF_interval_method: 'joint_profile_likelihood_lambda_beta_chi_square_1df',
    Lambda_interval_method: 'not_computed', alpha_interval_method: 'not_computed',
    interval_status: 'asymptotic_profile_likelihood',
    r_squared: null, time: [5, 10], MCF: [0.7, 1.2], CI: 0.95,
  },
  trend: {
    trend: 'improving', detail: 'Descriptive only.',
    method: 'descriptive_two_segment_slope_ratio', inferential: false,
  },
  status: {
    nonparametric_estimate: 'available',
    nonparametric_interval: 'partially_unavailable',
    parametric_fit: 'available',
    parametric_interval: 'asymptotic_profile_likelihood',
  },
  assumptions: ['Independent histories.', 'Shared event definition.'],
}

try {
  const contracts = await vite.ssrLoadModule(
    '/src/components/Growth/mcfContracts.ts')

  assert.deepEqual(
    contracts.parseMCFWideText('1, 2e0 | 3\n| 4'),
    { data: [[1, 2], []], observation_ends: [3, 4] },
  )
  assert.throws(
    () => contracts.parseMCFWideText('1, 2hours | 3'),
    /Row 1, event 2.*not a valid number/,
  )
  assert.throws(
    () => contracts.parseMCFWideText('2, 1 | 3'),
    /Row 1, event 2.*nondecreasing/,
  )
  assert.throws(
    () => contracts.parseMCFWideText('1 | 3 | 4'),
    /Row 1.*exactly one/,
  )

  const originalState = {
    text: '1 | 2', ciText: '0.95', parametric: false,
    intervalMethod: 'log_transformed', bootstrapSamples: '500', result: null,
  }
  const token = contracts.createMCFRequestToken('f0', originalState, 3)
  assert.equal(contracts.isMCFRequestTokenCurrent(
    token, 'f0', { ...originalState, result: response }, 3), true)
  assert.equal(contracts.isMCFRequestTokenCurrent(
    token, 'f0', { ...originalState, text: '1 | 3' }, 3), false)
  assert.equal(contracts.isMCFRequestTokenCurrent(token, 'f1', originalState, 3), false)
  assert.equal(contracts.isMCFRequestTokenCurrent(token, 'f0', originalState, 4), false)

  const unitFields = await vite.ssrLoadModule('/src/store/unitFields.ts')
  const converted = unitFields.convertStateObject(
    { mcf: { text: '24, 48 | 72\n| 24' } },
    unitFields.UNIT_RULES.growth,
    'hours',
    'days',
  )
  assert.equal(converted.mcf.text, '1, 2 | 3\n | 1')

  // API wrapper preserves the explicit-censoring request contract and typed
  // nullable response without a live backend.
  const client = await vite.ssrLoadModule('/src/api/client.ts')
  const originalPost = client.api.post
  let captured = null
  client.api.post = async (url, body) => {
    captured = { url, body }
    return { data: response }
  }
  try {
    const returned = await client.computeMCF({
      data: [[1], []], observation_ends: [2, 3], CI: 0.95,
      parametric: false, interval_method: 'log_transformed',
      bootstrap_samples: 0,
    })
    assert.equal(captured.url, '/growth/mcf')
    assert.deepEqual(captured.body.observation_ends, [2, 3])
    assert.equal(returned.nonparametric.MCF_upper[1], null)
  } finally {
    client.api.post = originalPost
  }

  // MCF inputs and results live in the active Growth analysis, are recognized
  // as computed output, and participate in stale-input detection.
  const project = await vite.ssrLoadModule('/src/store/project.ts')
  const savedState = { ...originalState, result: response }
  project.setModuleState('growth', {
    _folioWrap: true,
    activeId: 'f0',
    folios: [{ id: 'f0', name: 'Fleet MCF', state: { mcf: savedState } }],
  })
  const persisted = project.getProjectState().modules.growth
  assert.equal(persisted.folios[0].state.mcf.text, '1 | 2')
  assert.equal(persisted.folios[0].state.mcf.result.parametric.beta, 0.7)
  assert.equal(project.hasComputedResults(persisted), true)
  assert.equal(project.inputsChanged(
    persisted.folios[0].state,
    { mcf: { ...savedState, text: '1 | 3', result: null } },
  ), true)

  const assetsModule = await vite.ssrLoadModule('/src/store/assetExtractors.ts')
  const assets = assetsModule.enumerateAssets().filter(asset => asset.module === 'growth')
  const labels = new Set(assets.map(asset => asset.label))
  assert.equal(labels.has('Mean Cumulative Function'), true)
  assert.equal(labels.has('MCF Point Estimates and Interval Availability'), true)
  assert.equal(labels.has('MCF Summary'), true)
  assert.equal(labels.has('MCF Power-law Fit'), true)

  const points = assets.find(
    asset => asset.label === 'MCF Point Estimates and Interval Availability')
  assert.equal(points.getData().tableRows[1][7], 'No')
  assert.equal(points.getData().tableRows[1][9], '60 / 100')
  const fit = assets.find(asset => asset.label === 'MCF Power-law Fit')
  const fitMetrics = new Map(fit.getData().metrics.map(item => [item.label, item.value]))
  assert.equal(fitMetrics.get('Beta Lower'), '0.4000')
  assert.equal(fitMetrics.get('Endpoint MCF Upper'), '2.1000')

  console.log('MCF parsing, stale-response, persistence, API, and report contracts passed')
} finally {
  await vite.close()
}
