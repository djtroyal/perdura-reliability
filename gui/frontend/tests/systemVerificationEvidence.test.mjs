/** Internal verification evidence requires the exact retained analysis outputs, not merely matching inputs. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createSsrTestServer } from './viteTestLifecycle.mjs'

const hmr = createServer()
const vite = await createSsrTestServer({ root: new URL('..', import.meta.url).pathname, appType: 'custom',
  server: { middlewareMode: true, ws: { server: hmr } } })
try {
  const store = await vite.ssrLoadModule('/src/store/project.ts')
  const shared = await vite.ssrLoadModule('/src/store/sharedSystem.ts')
  const requirements = await vite.ssrLoadModule('/src/store/systemRequirements.ts')
  const { verificationSourcesForProject } = await vite.ssrLoadModule('/src/store/systemVerificationState.ts')
  const demo = JSON.parse(await readFile(new URL('../src/data/demoProject.json', import.meta.url), 'utf8'))
  const fixture = JSON.parse(await readFile(new URL('../public/website-showcase/prediction.overview.json', import.meta.url), 'utf8'))
  store.importPayload({ ...fixture, modules: { ...demo.modules, ...fixture.modules },
    engineRevisions: { ...demo.engineRevisions,
      ...Object.fromEntries(Object.keys(fixture.modules).map(key => [key, fixture.engineRevisions[key]])) } })
  const predictionSource = project => verificationSourcesForProject(project).find(item => item.moduleKey === 'prediction')
  const initial = store.getProjectState()
  const source = predictionSource(initial)
  assert.ok(source?.current, 'The genuine retained prediction fixture has current input and result hashes')
  const run = initial.analysisRuns.find(item => item.runId === source.runId)
  const model = initial.modules.systemDefinition.model
  const requirement = { ...requirements.createSystemRequirement('REQ-INTERNAL-EVIDENCE'), lifecycle: 'active',
    statement: 'The hydraulic controller prediction shall support the allocated reliability review.',
    acceptance_criteria: 'Review the retained prediction output against the design allocation.',
    allocations: [{ system_model_id: model.id, instance_id: model.root_instance_id }] }
  const verification = { ...requirements.createVerificationCase('VER-INTERNAL-EVIDENCE', requirement.id),
    objective: 'Review the retained prediction result', method: 'analysis', acceptance_criteria: requirement.acceptance_criteria,
    outcome: 'pass', assessment: 'The retained calculation output has been explicitly reviewed.', evidence_link_ids: ['EVD-INTERNAL'] }
  const evidence = { id: 'EVD-INTERNAL', target_id: verification.id, source_module: 'prediction', module_key: 'prediction',
    run_id: run.runId, source_analysis_id: run.analysisId, source_revision: String(run.engineRevision),
    source_checksum: run.fingerprintSha256, evidence_kind: 'verification', claim: 'Retained prediction output for engineering review',
    locator: `analysis:prediction/${run.analysisId}/${run.runId}`, captured_at: run.completedAt, stale: false,
    requirement_ids: [requirement.id], mode_ids: [] }
  const reviewed = requirements.reviewVerificationCase({ ...model,
    requirements: [...model.requirements, requirement], verification_cases: [...model.verification_cases, verification],
    verification_evidence: [...model.verification_evidence, evidence] }, verification.id, 'Test Engineer',
  verificationSourcesForProject(initial), '2026-11-13T15:00:00.000Z')
  shared.commitProjectSystem({ ...initial.modules.systemDefinition, model: reviewed }, 'verification-evidence-regression')
  const baseline = structuredClone(store.getProjectState())
  const caseStatus = project => requirements.evaluateSystemRequirements(project.modules.systemDefinition.model,
    verificationSourcesForProject(project)).cases.find(item => item.id === verification.id)?.status
  assert.equal(caseStatus(baseline), 'passed')

  const tampered = structuredClone(baseline)
  tampered.modules.prediction.folios[0].state.result.total_failure_rate *= 2
  assert.equal(predictionSource(tampered).current, false, 'Altered result values cannot inherit the original run fingerprint')
  assert.equal(caseStatus(tampered), 'stale')
  const missing = structuredClone(baseline)
  delete missing.modules.prediction.folios[0].state.result
  assert.equal(predictionSource(missing).current, false, 'Missing outputs cannot be current evidence')
  assert.equal(caseStatus(missing), 'stale')
  const dirty = structuredClone(baseline)
  dirty.modules.prediction.folios[0].dirty = true
  assert.equal(predictionSource(dirty).current, false, 'A dirty computation cannot serve as current evidence')
  assert.equal(caseStatus(dirty), 'stale')
  const obsoleteEngine = structuredClone(baseline)
  obsoleteEngine.analysisRuns.find(item => item.runId === run.runId).engineRevision--
  assert.equal(predictionSource(obsoleteEngine).current, false, 'A previous engine result cannot serve as current evidence')
  assert.equal(caseStatus(obsoleteEngine), 'stale')

  const fullExport = JSON.parse(JSON.stringify(store.buildExport(undefined, true)))
  store.importPayload(fullExport)
  assert.equal(predictionSource(store.getProjectState()).current, true, 'Full snapshots preserve the actual calculation evidence')
  assert.equal(caseStatus(store.getProjectState()), 'passed')
  const inputExport = JSON.parse(JSON.stringify(store.buildExport(undefined, false)))
  store.importPayload(inputExport)
  assert.equal(store.hasComputedResults(store.getProjectState().modules.prediction), false)
  assert.equal(predictionSource(store.getProjectState()).current, false, 'Inputs-only import retains history but cannot claim retained results')
  assert.equal(caseStatus(store.getProjectState()), 'stale')
  const retained = store.getProjectState().modules.systemDefinition.model.verification_cases.find(item => item.id === verification.id)
  assert.equal(retained.reviewed_by, 'Test Engineer', 'The earlier review is retained as stale history')
  assert.equal(retained.reviewed_fingerprint, reviewed.verification_cases.find(item => item.id === verification.id).reviewed_fingerprint)

  const malformed = structuredClone(reviewed)
  malformed.requirements[0].supporting_analyses = [null]
  assert.throws(() => requirements.assertRequirementRecordShapes(malformed), /Malformed/)
  console.log('system verification evidence contracts passed (genuine output, altered/missing results, dirty/engine gates, full/inputs-only persistence, malformed references)')
} finally { await vite.close(); hmr.close() }
