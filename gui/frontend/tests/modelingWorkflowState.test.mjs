import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'vite'

const hmrServer = createHttpServer()
const vite = await createServer({
  root: new URL('..', import.meta.url).pathname,
  appType: 'custom',
  server: { middlewareMode: true, hmr: { server: hmrServer } },
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

  const inputsOnly = project.buildExport(['dataModeling'], false)
  assert.equal('assets' in inputsOnly.modules.dataModeling, false)
  const fullSnapshot = project.buildExport(['dataModeling'], true)
  assert.equal(fullSnapshot.modules.dataModeling.assets.length, 1)

  console.log('Regression & ML workflow state contracts passed')
} finally {
  await vite.close()
}
