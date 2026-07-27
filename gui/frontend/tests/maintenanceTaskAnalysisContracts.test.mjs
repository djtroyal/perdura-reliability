import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'vite'

const component = readFileSync(new URL(
  '../src/components/Maintenance/TaskAnalysis.tsx',
  import.meta.url,
), 'utf8')
const maintenance = readFileSync(new URL(
  '../src/components/Maintenance/index.tsx',
  import.meta.url,
), 'utf8')
const router = readFileSync(new URL(
  '../../backend/routers/maintenance.py',
  import.meta.url,
), 'utf8')

assert.match(maintenance, /id: 'task-analysis'/)
for (const view of [
  'Task Inventory', 'Task Definition', 'Resources', 'Portfolio', 'Results',
]) assert.match(component, new RegExp(view))
assert.match(component, /Reliability Program RCM/)
assert.match(component, /Failure Rate Prediction/)
assert.match(component, /prediction_rate_override_enabled/)
assert.match(component, /Create or refresh linked tasks/)
assert.match(component, /predictionLinkFilter/)
assert.match(component, /Not linked/)
assert.match(component, /Show all prediction records/)
assert.match(component, /hierarchyDepth/)
assert.match(component, /hierarchy context/)
assert.match(component, /System block/)
assert.match(component, /Piece part/)
assert.match(component, /Procedure map/)
assert.match(component, /Predecessor steps/)
assert.match(component, /definition readiness/)
assert.match(component, /analyzeMaintenanceTasksStream/)
assert.match(component, /abortRef\.current\?\.abort/)
assert.match(component, /downloadArtifact/)
assert.doesNotMatch(component, /URL\s*\.\s*createObjectURL/)
assert.doesNotMatch(component, /Publish a revision-linked snapshot downstream/)
assert.match(component, /WEEKDAYS/)
assert.match(component, /FIELD_HELP/)
assert.match(component, /data-dropdown-menu/)
assert.match(component, /document\.addEventListener\('pointerdown'/)
assert.match(component, /Uncertain duration/)
assert.match(component, /Expected duration:/)
assert.match(component, /timelineLabels/)
assert.match(component, /utilisationLabels/)
assert.match(component, /Fixed cost \(\$\/event\)/)
assert.match(component, /Loaded hourly rate \(\$\/engaged hour\)/)
assert.match(component, /Default downtime cost \(\$\/hour\)/)
assert.match(component, /fmtCurrencyInterval/)
assert.match(component, /showCostBreakdown/)
assert.match(component, /useState\(true\)/)
assert.match(component, /Portfolio cost breakdown/)
assert.match(component, /interval endpoints should/)
assert.match(component, /mta-portfolio-cost-composition/)
assert.match(component, /overtime_rate_multiplier/)
assert.match(router, /task-analysis\/analyze\/stream/)

const hmrServer = createHttpServer()
const vite = await createServer({
  root: new URL('..', import.meta.url).pathname,
  appType: 'custom',
  server: { middlewareMode: true, ws: { server: hmrServer } },
})

try {
  const project = await vite.ssrLoadModule('/src/store/project.ts')
  const extractors = await vite.ssrLoadModule('/src/store/assetExtractors.ts')
  const taskAnalysis = await vite.ssrLoadModule(
    '/src/components/Maintenance/TaskAnalysis.tsx')
  const hierarchyCandidates = taskAnalysis.predictionCandidates({
    id: 'prediction-1',
    name: 'System prediction',
    state: {
      result: null,
      blocks: [
        { id: 'assembly', name: 'Assembly', parentId: null },
        { id: 'board', name: 'Control board', parentId: 'assembly' },
      ],
      parts: [
        {
          id: 'u1', category: 'microcircuits', quantity: 1, params: {},
          name: 'Controller', parentId: 'board',
        },
        {
          id: 'f1', category: 'fuses', quantity: 1, params: {},
          name: 'Main fuse', parentId: null,
        },
      ],
    },
  })
  assert.deepEqual(
    hierarchyCandidates.map(item => [
      item.recordId, item.parentRecordId, item.hierarchyDepth,
    ]),
    [
      ['block:assembly', null, 0],
      ['block:board', 'block:assembly', 1],
      ['part:u1', 'block:board', 2],
      ['part:f1', null, 0],
    ],
  )
  project.getProjectState().modules.maintTaskAnalysis = {
    result: {
      input_sha256: 'b'.repeat(64),
      source_traceability: [],
      task_results: [{
        task_id: 'MTA-001', title: 'Replace pump', task_type: 'corrective',
        maintenance_level: 'field', status: 'approved',
        elapsed_hours: 4, labour_hours: 5,
        labour_by_role: { tech: 5 },
        resource_quantity_per_event: { pump: 1 },
        cost_per_event: {
          labour: 500, materials: 600, resource_use: 20,
          fixed: 0, travel: 0, downtime: 400, total: 1520,
        },
        step_schedule: [],
        portfolio: {
          events: { mean: 3, lower: 1, upper: 6 },
          labour_hours: { mean: 15, lower: 5, upper: 30 },
          downtime_hours: { mean: 12, lower: 4, upper: 24 },
        },
        warnings: [],
      }],
      portfolio: {
        n_simulations: 100, confidence: 0.95, seed: 42,
        jobs_generated: { mean: 3, lower: 1, upper: 6 },
        jobs_completed: { mean: 3, lower: 1, upper: 6 },
        backlog_jobs: { mean: 0, lower: 0, upper: 0 },
        late_jobs: { mean: 0.2, lower: 0, upper: 1 },
        total_cost: { mean: 4560, lower: 1520, upper: 9120 },
        cost_breakdown: {
          labour: { mean: 1500, lower: 500, upper: 3000 },
          materials: { mean: 1800, lower: 600, upper: 3600 },
          resource_use: { mean: 60, lower: 20, upper: 120 },
          fixed: { mean: 0, lower: 0, upper: 0 },
          travel: { mean: 0, lower: 0, upper: 0 },
          downtime: { mean: 1200, lower: 400, upper: 2400 },
        },
        overtime_labor_hours: { mean: 2, lower: 0, upper: 5 },
        total_downtime_hours: { mean: 12, lower: 4, upper: 24 },
        availability: { mean: 0.99, lower: 0.98, upper: 0.999 },
        resource_utilisation: {
          'personnel:tech': { mean: 0.4, lower: 0.2, upper: 0.7 },
        },
        representative_timeline: [{
          job_id: 'MTA-001:1', task_id: 'MTA-001', step_id: 'S1',
          label: 'Replace pump', start: 1, finish: 5, active: true,
        }],
      },
      warnings: [],
      methodology: { method_version: '1.0' },
      result_sha256: 'a'.repeat(64),
    },
  }
  const assets = extractors.enumerateAssets()
    .filter(asset => asset.module === 'maintTaskAnalysis')
  assert.ok(assets.some(asset =>
    asset.label === 'Maintenance Task Portfolio Summary'))
  assert.ok(assets.some(asset =>
    asset.label === 'Maintenance Task Inventory and Rollup'))
  assert.ok(assets.some(asset =>
    asset.label === 'Representative Resource-Constrained Schedule'))
  assert.ok(assets.some(asset =>
    asset.label === 'MTA Resource Utilization'))
  assert.ok(assets.some(asset =>
    asset.label === 'Maintenance Portfolio Cost Breakdown'))
  assert.ok(assets.some(asset =>
    asset.label === 'MTA Portfolio Cost Composition'))
  const summary = assets.find(asset =>
    asset.label === 'Maintenance Task Portfolio Summary').getData()
  assert.equal(
    summary.metrics.find(metric => metric.label === 'Mean cost').value,
    '$4560.0000',
  )
  assert.equal(
    summary.metrics.find(metric =>
      metric.label === 'Mean generated work').value,
    '3.0000 jobs',
  )
  const inventory = assets.find(asset =>
    asset.label === 'Maintenance Task Inventory and Rollup').getData()
  assert.ok(inventory.tableHeaders.includes('Cost / event ($)'))
  assert.equal(inventory.tableRows[0][7], '$1520.0000')
  const costBreakdown = assets.find(asset =>
    asset.label === 'Maintenance Portfolio Cost Breakdown').getData()
  assert.deepEqual(costBreakdown.tableHeaders, [
    'Cost component', 'Mean ($)', 'Lower bound ($)',
    'Upper bound ($)', 'Share of mean cost',
  ])
  assert.deepEqual(costBreakdown.tableRows[0], [
    'Labor', '$1500.0000', '$500.0000', '$3000.0000', '32.9%',
  ])
  const costComposition = assets.find(asset =>
    asset.label === 'MTA Portfolio Cost Composition').getData()
  assert.equal(costComposition.plotData[0].type, 'pie')
  assert.deepEqual(costComposition.plotData[0].labels, [
    'Labor', 'Materials and consumables', 'Renewable resource use',
    'Downtime consequence',
  ])
  const schedule = assets.find(asset =>
    asset.label === 'Representative Resource-Constrained Schedule')
  assert.deepEqual(schedule.getData().plotData[0].y, [
    'Replace pump · Occurrence 1',
  ])
  const utilization = assets.find(asset =>
    asset.label === 'MTA Resource Utilization')
  assert.deepEqual(utilization.getData().plotData[0].y, [
    'tech · Personnel',
  ])
  assert.deepEqual(utilization.getData().plotData[0].customdata, [[20, 70]])
  assert.match(
    utilization.getData().plotData[0].hovertemplate,
    /95\.0% uncertainty interval/,
  )
  assert.equal(assets.every(asset => asset.targetView === 'results'), true)
  console.log('maintenance task analysis contracts passed')
} finally {
  await vite.close()
  hmrServer.close()
}
