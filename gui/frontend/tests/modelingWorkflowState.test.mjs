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
  const workflow = await vite.ssrLoadModule(
    '/src/components/DataModeling/workflowState.ts')

  const legacy = workflow.normalizeModelingState({
    target: 'outcome',
    features: ['temperature', 'vendor'],
    taskOverride: 'classification',
    fitted: [{ id: 'legacy-1' }, { id: 'legacy-2' }],
  })
  assert.equal(legacy.schemaVersion, 2)
  assert.equal(legacy.task, 'classification')
  assert.equal(legacy.target, 'outcome')
  assert.deepEqual(legacy.features, ['temperature', 'vendor'])
  assert.equal(legacy.legacyResultCount, 2)
  assert.equal(legacy.run, null)
  assert.equal(legacy.finalized, null)

  const finalized = { asset_id: 'model-test', artifact: { kind: 'onnx' } }
  const current = workflow.normalizeModelingState({
    schemaVersion: 2,
    target: 'life',
    features: ['stress'],
    finalized,
    stage: 'finalize',
  })
  assert.equal(current.finalized, finalized)
  assert.deepEqual(current.assets, [finalized])
  assert.equal(current.stage, 'finalize')
  assert.equal(current.tuningBudget, 'standard')
  assert.equal(current.confidence, 0.95)

  assert.deepEqual(
    workflow.modelsForTask('regression', ['linear', 'logistic', 'chaid']),
    ['linear'],
  )
  assert.deepEqual(
    workflow.modelsForTask('regression', ['spline', 'logistic']),
    ['spline'],
  )
  assert.equal(workflow.REGRESSION_DEFAULTS.includes('spline'), false)
  assert.deepEqual(
    workflow.modelsForTask('classification', ['linear', 'logistic', 'chaid']),
    ['logistic', 'chaid'],
  )
  assert.equal(
    workflow.modelsForTask('classification', ['linear']).includes('logistic'),
    true,
  )
  assert.equal(workflow.selectionMetricForTask('regression', 'roc_auc'), 'rmse')
  assert.equal(
    workflow.selectionMetricForTask('classification', 'expected_cost'),
    'expected_cost',
  )

  const project = await vite.ssrLoadModule('/src/store/project.ts')
  const extractors = await vite.ssrLoadModule('/src/store/assetExtractors.ts')
  const savedAsset = {
    schema_version: 1,
    asset_id: 'model-report-contract',
    name: 'Ridge — life',
    created_at: '2026-07-17T12:00:00Z',
    task: 'regression',
    model: 'ridge',
    model_label: 'Ridge (L2)',
    schema: { target: 'life', dataset_fingerprint: 'abc123' },
    selection_metric: 'rmse',
    artifact: { kind: 'onnx', available: true },
  }
  project.setModuleState('dataModeling', {
    ...workflow.INITIAL_MODELING_WORKFLOW,
    assets: [savedAsset],
  })
  const reportAssets = extractors.enumerateAssets()
    .filter(asset => asset.module === 'dataModeling')
  assert.equal(
    reportAssets.some(asset => asset.label.includes('Finalized Model Card')),
    true,
  )

  const metric = { value: 0.12, lower: 0.09, upper: 0.16, confidence: 0.95, resamples: 50 }
  project.setModuleState('dataModeling', {
    ...workflow.INITIAL_MODELING_WORKFLOW,
    assets: [savedAsset],
    run: {
      schema_version: 1,
      task: 'regression',
      selection_metric: 'rmse',
      recommended_model: 'spline',
      readiness: {
        n_rows_original: 12, n_rows_eligible: 12, dropped_missing_target: 0,
        dropped_missing_predictors: 0, missing_by_feature: { x: 0 },
        numeric_features: ['x'], categorical_features: [], cardinality: { x: 12 },
        constant_features: [], high_cardinality_features: [], id_like_features: [],
        duplicate_rows: 0, class_counts: null, leakage_warnings: [], warnings: [], status: 'ready',
      },
      data_schema: {
        target: 'y', features: ['x'], numeric_features: ['x'], categorical_features: [],
        classes: null, positive_class: null, missing_policy: 'impute_indicator',
        dataset_fingerprint: 'spline-contract',
      },
      validation: { strategy: 'random', outer_folds_used: 3, metric_interval_method: 'row_bootstrap' },
      models: [{
        model: 'spline', label: 'Spline Regression', status: 'eligible', rank: 1,
        selection_metric: 'rmse', metrics: { rmse: metric, mae: metric, r2: metric },
        folds: [], selected_params: {}, oof: {
          row_indices: [], actual: [], actual_encoded: [], predicted: [],
          predicted_encoded: [], probabilities: null,
        },
        diagnostics: { spline_curve: {
          feature: 'x', x_observed: [0, 1], y_observed: [0, 1],
          y_oof_predicted: [0.1, 0.9], x_grid: [0, 1], y_grid: [0.05, 0.95],
          lower: [-0.1, 0.8], upper: [0.2, 1.1], omitted_missing_x: 0,
          extrapolation: 'linear',
        } },
        permutation_importance: { method: 'outer_fold_permutation', feature_names: ['x'], mean: [], std: [] },
        partial_dependence: [], threshold: null, calibration_state: null, conformal: null,
        fit_diagnostics: { converged: true, warnings: [], n_iter: null, max_iter: null },
        inference: null, warnings: [], runtime_seconds: 0.1,
      }],
      versions: {}, runtime_seconds: 0.1,
    },
  })
  const splineCurveAsset = extractors.enumerateAssets()
    .find(asset => asset.label === 'Spline Regression — Spline Response Curve')
  assert.ok(splineCurveAsset, 'spline response curve should be available to Report Builder')
  assert.equal(splineCurveAsset.getData().plotData.length, 5)

  const inputsOnly = project.buildExport(['dataModeling'], false)
  assert.equal('assets' in inputsOnly.modules.dataModeling, false)
  const fullSnapshot = project.buildExport(['dataModeling'], true)
  assert.equal(fullSnapshot.modules.dataModeling.assets.length, 1)

  console.log('Regression & ML workflow state contracts passed')
} finally {
  await vite.close()
}
