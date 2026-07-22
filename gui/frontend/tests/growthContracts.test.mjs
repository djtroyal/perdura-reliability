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
  const contracts = await vite.ssrLoadModule(
    '/src/components/Growth/growthContracts.ts')
  const original = { rows: ['1', '2'], T: '3', result: null }
  const token = contracts.createGrowthRequestToken('f0', original)
  assert.equal(contracts.isGrowthRequestTokenCurrent(
    token, 'f0', { ...original, result: { beta: 1 } }), true)
  assert.equal(contracts.isGrowthRequestTokenCurrent(
    token, 'f0', { ...original, T: '4' }), false)
  assert.equal(contracts.isGrowthRequestTokenCurrent(token, 'f1', original), false)

  const project = await vite.ssrLoadModule('/src/store/project.ts')
  const assetsModule = await vite.ssrLoadModule('/src/store/assetExtractors.ts')
  const result = {
    model: 'crow_amsaa', data_mode: 'grouped', termination: 'time',
    estimator: 'mle', beta: 0.75, Lambda: 1.5, log_Lambda: Math.log(1.5),
    scale_representable: true, growth_rate: 0.25,
    instantaneous_failure_intensity: 0.4,
    mtbf_instantaneous: 2.5, mtbf_cumulative: 2,
    n_failures: 5, T: 10,
    scatter: { t: [5, 10], n: [2, 5] },
    model_curve: { t: [1, 10], n: [0.5, 5] },
    mtbf_curve: { t: [1, 10], cumulative: [1, 2], instantaneous: [1.2, 2.5] },
    intensity_curve: { t: [1, 10], instantaneous: [0.8, 0.4] },
    interval_context: {
      interval_start: [0, 5], interval_end: [5, 10],
      observed_count: [2, 3], expected_count: [2.2, 2.8],
      observed_average_intensity: [0.4, 0.6],
      fitted_average_intensity: [0.44, 0.56],
    },
    grouped_final_interval: {
      start: 5, end: 10, observed_failures: 3, expected_failures: 2.8,
      average_failure_intensity: 0.56, average_mtbf: 1 / 0.56,
      confidence_level: 0.95,
      target_profile: {
        average_failure_intensity_interval: {
          estimate: 0.56, lower: 0.32, upper: 0.85, available: true,
          method: 'grouped_poisson_target_profile_likelihood_chi_square_1df',
          coverage_status: 'asymptotic_target_profile_likelihood',
        },
        average_mtbf_interval: {
          estimate: 1 / 0.56, lower: 1.18, upper: 3.13, available: true,
          method: 'grouped_poisson_target_profile_likelihood_chi_square_1df',
          coverage_status: 'asymptotic_target_profile_likelihood',
        },
      },
      handbook_approximate: {
        average_failure_intensity_interval: {
          estimate: 0.56, lower: 0.3, upper: 0.9, available: true,
          method: 'handbook_grouped',
          coverage_status: 'approximate_grouped_handbook',
        },
        average_mtbf_interval: {
          estimate: 1 / 0.56, lower: 1.1, upper: 3.3, available: true,
          method: 'handbook_grouped',
          coverage_status: 'approximate_grouped_handbook',
        },
        average_mtbf_one_sided_lower_bound: {
          quantity: 'final_interval_average_mtbf', side: 'lower',
          bound: 1.25, confidence_level: 0.95, available: true,
          estimate: 1 / 0.56, reported_estimate_basis: 'grouped_mle',
          interval_reference_estimate: 1 / 0.56,
          interval_reference_basis:
            'grouped_mle_handbook_crow_coefficient_reference',
          method: 'handbook_grouped_one_tail',
          coverage_status: 'approximate_grouped_handbook',
        },
      },
    },
    confidence: {
      level: 0.95,
      intervals: {
        beta: {
          estimate: 0.75, lower: 0.4, upper: 1.2, available: true,
          reported_estimate_basis: 'selected_mle',
          interval_reference_estimate: 0.75,
          interval_reference_basis: 'raw_mle_interval_statistic',
          method: 'profile_likelihood_chi_square_1df',
          coverage_status: 'asymptotic_profile_likelihood',
        },
      },
      one_sided_bounds: {
        final_interval_average_mtbf_handbook_lower: {
          quantity: 'final_interval_average_mtbf', side: 'lower',
          bound: 1.25, confidence_level: 0.95, available: true,
          estimate: 1 / 0.56, reported_estimate_basis: 'grouped_mle',
          interval_reference_estimate: 1 / 0.56,
          interval_reference_basis:
            'grouped_mle_handbook_crow_coefficient_reference',
          method: 'handbook_grouped_one_tail',
          coverage_status: 'approximate_grouped_handbook',
        },
      },
    },
    goodness_of_fit: {
      available: true, method: 'Pearson chi-square for grouped interval counts',
      statistic: 0.2, degrees_of_freedom: 1, p_value: 0.65,
      significance: 0.1, decision: 'fail_to_reject',
      decision_text: 'Fail to reject.',
      pooled_intervals: [
        { start: 0, end: 5, observed: 2, expected: 2.2 },
        { start: 5, end: 10, observed: 3, expected: 2.8 },
      ],
    },
    trend_test: {
      available: true, method: 'Military Handbook power-law process trend test',
      null_hypothesis: 'beta = 1', statistic: 9.5, degrees_of_freedom: 8,
      significance: 0.05, p_value_two_sided: 0.12,
      p_value_improving: 0.06, p_value_worsening: 0.94,
      observed_direction: 'improving', shape_for_direction: 0.7,
      direction_estimator: 'modified MLE', decision: 'fail_to_reject',
      direction_basis: 'smaller one-sided chi-square null tail',
      decision_text: 'Fail to reject no trend.',
    },
    diagnostics: { warnings: [] },
  }
  project.setModuleState('growth', {
    _folioWrap: true,
    activeId: 'f0',
    folios: [{ id: 'f0', name: 'Grouped benchmark', state: { result } }],
  })
  const assets = assetsModule.enumerateAssets()
    .filter(asset => asset.module === 'growth')

  const intervals = assets.find(asset => asset.label === 'Uncertainty Intervals')
  assert.ok(intervals)
  assert.equal(intervals.getData().tableRows[0][2], 'selected_mle')
  assert.equal(intervals.getData().tableRows[0][3], '0.7500')
  assert.equal(intervals.getData().tableRows[0][9],
    'asymptotic_profile_likelihood')

  const oneSided = assets.find(
    asset => asset.label === 'One-sided Confidence Bounds')
  assert.ok(oneSided)
  assert.equal(oneSided.getData().tableRows[0][1], 'lower')
  assert.equal(oneSided.getData().tableRows[0][2], '1.2500')
  assert.equal(oneSided.getData().tableRows[0][7],
    'grouped_mle_handbook_crow_coefficient_reference')

  const pooled = assets.find(asset => asset.label === 'Grouped GOF Pooled Intervals')
  assert.ok(pooled)
  assert.equal(pooled.getData().tableRows.length, 2)

  const trend = assets.find(asset => asset.label === 'Power-law Process Trend Test')
  assert.ok(trend)
  const trendMetrics = new Map(
    trend.getData().metrics.map(metric => [metric.label, metric.value]))
  assert.equal(trendMetrics.get('Improving p-value'), '0.0600')
  assert.equal(trendMetrics.get('Direction Estimator'), 'modified MLE')
  assert.equal(trendMetrics.get('Direction Basis'),
    'smaller one-sided chi-square null tail')

  const groupedFinal = assets.find(
    asset => asset.label === 'Grouped Final-Interval Estimate')
  assert.ok(groupedFinal)
  const finalMetrics = new Map(
    groupedFinal.getData().metrics.map(metric => [metric.label, metric.value]))
  assert.equal(finalMetrics.get('Target-profile MTBF Lower'), '1.1800')
  assert.equal(finalMetrics.get('Target-profile Coverage Status'),
    'asymptotic_target_profile_likelihood')
  assert.equal(finalMetrics.get('Handbook-approx. MTBF Lower'), '1.1000')
  assert.equal(finalMetrics.get('Handbook-approx. Coverage Status'),
    'approximate_grouped_handbook')
  assert.equal(finalMetrics.get('Handbook One-sided MTBF Lower Bound'),
    '1.2500')

  console.log('growth request and report-asset contracts passed')
} finally {
  await vite.close()
}
