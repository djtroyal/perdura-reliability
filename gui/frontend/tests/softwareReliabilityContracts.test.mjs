import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'vite'

const hmrServer = createHttpServer()
const vite = await createServer({
  root: new URL('..', import.meta.url).pathname,
  appType: 'custom',
  server: { middlewareMode: true, ws: { server: hmrServer } },
})

const model = {
  model: 'hpp', label: 'Homogeneous Poisson process', source: 'baseline',
  finite_fault_model: false,
  parameters: [{ name: 'failure_rate', estimate: 0.1, lower: 0.05, upper: 0.2, relative_standard_error: 0.2 }],
  parameter_values: { failure_rate: 0.1 }, log_likelihood: -10,
  AIC: 22, AICc: 23, BIC: 22.5, eligible: true, converged: true,
  optimizer_message: 'ok', information_condition: 1, warnings: [],
  goodness_of_fit: { available: true, method: 'conditional_time_rescaling_ks_diagnostic', p_value: 0.5 },
  comparison_criterion: 'AICc', delta: 0, weight: 1,
  bootstrap: { requested: 0, successful: 0, method: 'not_requested' },
  projection: {
    current_intensity: 0.1, expected_failures_observed_to_T: 6,
    expected_future_failures: 1, probability_zero_failures_over_horizon: Math.exp(-1),
    mission_duration: 10, mission_reliability: Math.exp(-1),
    remaining_faults: null, remaining_faults_available: false,
    additional_test_exposure_to_target: null, target_status: null,
    probability_current_intensity_meets_target: null,
    uncertainty: { level: 0.95, method: 'asymptotic_log_parameter_monte_carlo', successful_draws: 2000, intervals: {} },
    curve: { time: [1, 10], cumulative_failures: [0.1, 1], intensity: [0.1, 0.1], cumulative_lower: [0.05, 0.5], cumulative_upper: [0.2, 2] },
  },
}

try {
  const project = await vite.ssrLoadModule('/src/store/project.ts')
  const extractors = await vite.ssrLoadModule('/src/store/assetExtractors.ts')
  project.newProject('Software reliability assets')
  project.setModuleState('softwareReliability', {
    _folioWrap: true,
    folios: [{ id: 'sre-a', name: 'Release candidate', state: { result: {
      analysis: 'software_reliability_growth', data_mode: 'event_times',
      exposure_basis: 'user_declared_consistent_exposure_unit', observation_end: 60,
      n_failures: 6, n_intervals: null, confidence_level: 0.95,
      comparison_criterion: 'AICc', best_model: 'hpp', models: [model],
      warnings: ['conditional result'], operational_profile: null,
      standards_context: { status: 'standards_informed_not_certified_conformance', references: ['MIL-HDBK-338B §9'] },
    } } }], activeId: 'sre-a',
  })
  const assets = extractors.enumerateAssets().filter(asset => asset.module === 'softwareReliability')
  assert.deepEqual(assets.map(asset => asset.label).sort(), [
    'Homogeneous Poisson process Cumulative Failures',
    'Homogeneous Poisson process Failure Intensity',
    'Homogeneous Poisson process Parameters',
    'Software Model Comparison',
    'Software Reliability Summary',
  ].sort())
  assert.ok(assets.every(asset => asset.source?.tab === 'software-reliability'))
  assert.ok(assets.every(asset => asset.source?.analysisId === 'sre-a'))
  assert.equal(assets.find(asset => asset.label === 'Software Model Comparison').getData().tableRows.length, 1)
  console.log('Software reliability persistence and report-asset contracts passed')
} finally {
  await vite.close()
  hmrServer.close()
}
