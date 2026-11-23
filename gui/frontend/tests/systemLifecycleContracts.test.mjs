/** Source and maintenance-task contracts use actual production helpers. */
import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSsrTestServer, closeViteTestServer } from './viteTestLifecycle.mjs'
const root = new URL('..', import.meta.url).pathname, cacheDir = await mkdtemp(join(tmpdir(), 'perdura-system-contracts-'))
const hmrServer = createHttpServer()
const vite = await createSsrTestServer({ root, cacheDir, logLevel: 'error', server: { middlewareMode: true, ws: { server: hmrServer } }, appType: 'custom' })
try {
  const { importSystemRepairTask, systemTaskSourceIssue } = await vite.ssrLoadModule('/src/components/shared/systemTaskImport.ts')
  const { systemDiagramSignature, resolveLifecycleDiagram, lifecycleSourceStatus, lifecycleSettingsSignature } = await vite.ssrLoadModule('/src/components/shared/systemLifecycleSource.ts')
  const { initialLifecycleSettings } = await vite.ssrLoadModule('/src/api/systemTools.ts')
  const task = { id: 'repair', title: 'Replace controller', revision: 'B', status: 'approved', task_type: 'corrective', takes_asset_out_of_service: true, affected_asset_count: 1,
    steps: [{ id: 'replace', predecessor_step_ids: [], execution_probability: 1, resources: [], duration: { mode: 'fixed', fixed_hours: 2 }, personnel: [{ role_id: 'electrical', headcount: 2, engagement_fraction: 1 }] }] }
  const catalog = { tasks: [task], personnel: [{ id: 'electrical', available_headcount: 3, weekly_shifts: [], planned_outages: [] }], resources: [] }
  const imported = importSystemRepairTask(catalog, 'repair', 'days')
  assert.equal(imported.policy.repair.params.value, 2 / 24)
  assert.equal(imported.policy.crew_demand, 2)
  assert.equal(imported.capacity, 3)
  assert.equal(systemTaskSourceIssue(catalog, { c: imported.policy }, 'days'), null)
  const updated = structuredClone(catalog); updated.tasks[0].revision = 'C'
  assert.match(systemTaskSourceIssue(updated, { c: imported.policy }, 'days'), /changed/)
  for (const mutate of [c => c.tasks[0].steps.push(structuredClone(c.tasks[0].steps[0])), c => c.tasks[0].steps[0].predecessor_step_ids = ['earlier'],
    c => c.tasks[0].steps[0].execution_probability = .5, c => c.tasks[0].steps[0].resources = [{ resource_id: 'tool', quantity: 1 }],
    c => c.personnel[0].weekly_shifts = [{ weekday: 0, start_hour: 8, end_hour: 16 }], c => c.tasks[0].steps[0].duration.mode = 'uncertain']) {
    const invalid = structuredClone(catalog); mutate(invalid)
    assert.throws(() => importSystemRepairTask(invalid, 'repair', 'days'))
  }
  const state = { nodes: [{ id: 's', type: 'source', data: {} }, { id: 'c', type: 'component', position: { x: 0, y: 0 }, data: { label: 'Controller', distribution: 'exponential', dist_params: { lambda: .001 } } }, { id: 'z', type: 'sink', data: {} }],
    edges: [{ id: 'a', source: 's', target: 'c' }, { id: 'b', source: 'c', target: 'z' }], missionTime: '1000', lifecycle: { settings: initialLifecycleSettings() } }
  const project = { units: 'hours', modules: { maintTaskAnalysis: catalog } }
  state.lifecycle.inputSignature = lifecycleSettingsSignature(state.lifecycle.settings)
  state.lifecycle.modelSignature = systemDiagramSignature(resolveLifecycleDiagram(project, 'rbd', state))
  assert.equal(lifecycleSourceStatus(project, 'rbd', state).current, true)
  state.lifecycle.settings.horizon = 2000
  assert.equal(lifecycleSourceStatus(project, 'rbd', state).current, false)
  state.lifecycle.inputSignature = lifecycleSettingsSignature(state.lifecycle.settings)
  state.nodes[1].position.x = 999; state.nodes[1].data.label = 'Renamed presentation'
  assert.equal(lifecycleSourceStatus(project, 'rbd', state).current, true)
  state.nodes[1].data.dist_params.lambda = .002
  assert.equal(lifecycleSourceStatus(project, 'rbd', state).current, false)
  state.nodes[1].data.dist_params.lambda = .001
  state.lifecycle.settings.policies = { c: importSystemRepairTask(catalog, 'repair', 'hours').policy }
  state.lifecycle.inputSignature = lifecycleSettingsSignature(state.lifecycle.settings)
  assert.equal(lifecycleSourceStatus(project, 'rbd', state).current, true)
  project.modules.maintTaskAnalysis = updated
  assert.equal(lifecycleSourceStatus(project, 'rbd', state).current, false)
  console.log('System lifecycle source and maintenance-task import contracts passed')
} finally { await closeViteTestServer(vite, cacheDir, hmrServer) }
