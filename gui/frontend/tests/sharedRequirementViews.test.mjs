import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { createSsrTestServer } from './viteTestLifecycle.mjs'

const hmrServer = createHttpServer()
const vite = await createSsrTestServer({ root: new URL('..', import.meta.url).pathname, appType: 'custom',
  server: { middlewareMode: true, ws: { server: hmrServer } } })
try {
  const shared = await vite.ssrLoadModule('/src/store/sharedSystemModel.ts')
  const fmea = await vite.ssrLoadModule('/src/store/sharedFmeaModel.ts')
  const defaults = await vite.ssrLoadModule('/src/components/ReliabilityProgram/fmeaModel.ts')
  const views = await vite.ssrLoadModule('/src/store/sharedRequirementViews.ts')
  const requirements = await vite.ssrLoadModule('/src/store/systemRequirements.ts')
  const project = await vite.ssrLoadModule('/src/store/project.ts')
  const provenance = await vite.ssrLoadModule('/src/store/provenance.ts')
  const verification = await vite.ssrLoadModule('/src/store/systemVerificationState.ts')
  const version = await vite.ssrLoadModule('/src/version.ts')
  let model = shared.createProjectSystem().model
  const root = model.instances[0]
  model.instances.push({ ...structuredClone(root), id: 'left', name: 'Left subsystem', parent_instance_id: root.id },
    { ...structuredClone(root), id: 'right', name: 'Right subsystem', parent_instance_id: root.id })
  model.requirements = [
    { ...requirements.createSystemRequirement('REQ-1'), statement: 'Provide power',
      allocations: [{ system_model_id: model.id, instance_id: 'left' }] },
    { ...requirements.createSystemRequirement('REQ-2'), statement: 'Provide cooling',
      allocations: [{ system_model_id: model.id, instance_id: 'right' }] },
  ]
  let analysis = fmea.bindFmeaAnalysis(model, defaults.createFmeaAnalysis('dfmea', 1), 'left')
  assert.deepEqual(analysis.functional_requirements.map(item => item.id), ['REQ-1'], 'Physical FMEA projects requirements in its scope')
  const edit = structuredClone(analysis)
  edit.functional_requirements[0].statement = 'Provide protected power'
  const split = fmea.splitFmeaUpdate(model, analysis, edit)
  model = split.model
  assert.equal(model.requirements[0].statement, 'Provide protected power')
  assert.equal(views.sharedProgramRequirementRows(model)[0].statement, 'Provide protected power', 'FMEA edits immediately reach Reliability Program')
  assert.equal(model.requirements[0].allocations[0].instance_id, 'left', 'Editing text retains installed identity')
  const program = { rows: { requirements: views.sharedProgramRequirementRows(model), hazards: [] }, aiagAnalyses: [] }
  const programEdit = structuredClone(program)
  programEdit.rows.requirements[0].target = '540'
  const updated = views.splitSharedRequirementState(program, programEdit, model, 'aiagAnalyses', 'reliabilityProgram')
  model = updated.model
  assert.deepEqual(updated.state.rows.requirements, [], 'Program persistence does not own a duplicate requirement')
  analysis = fmea.materializeFmeaAnalysis(model, analysis)
  assert.equal(analysis.functional_requirements[0].target, '540', 'Program edits immediately reach physical FMEA')
  const rightStudy = fmea.bindFmeaAnalysis(model, defaults.createFmeaAnalysis('dfmea', 2), 'right')
  const portfolio = { fmea: { _folioWrap: true, activeId: 'left', folios: [
    { id: 'left', state: { analyses: [analysis], result: { coverage: 1 } } },
    { id: 'right', state: { analyses: [rightStudy], result: { coverage: 1 } } }] },
    reliabilityProgram: { _folioWrap: true, activeId: 'program', folios: [{ id: 'program', state: { rows: { requirements: [] }, aiagAnalyses: [], result: { requirements: 2 } } }] },
    faultTree: { nodes: [{ id: 'event', data: { systemRef: { system_model_id: model.id, instance_id: 'left' } } }], result: { probability: 0.1 } },
    system: { result: { reliability: 0.9 } }, markov: { result: { availability: 0.9 } } }
  const requirementEdit = { ...model, requirements: model.requirements.map(item => item.id === 'REQ-1' ? { ...item, target: '545' } : item) }
  const dependencies = shared.canonicalDependencyUpdates(portfolio, { model }, { model: requirementEdit })
  assert.equal(dependencies.fmea.folios[0].dirty, true, 'Relevant physical FMEA coverage becomes stale on an authored target edit')
  assert.equal(dependencies.fmea.folios[1], portfolio.fmea.folios[1], 'Unrelated study calculations stay current')
  assert.equal(dependencies.reliabilityProgram.folios[0].dirty, true, 'Program requirement summaries become stale even without physical analyses')
  assert.equal(dependencies.faultTree, undefined)
  assert.equal(dependencies.system, undefined)
  assert.equal(dependencies.markov, undefined)
  const sharedCaseScope = { ...model, verification_cases: [{ ...requirements.createVerificationCase('CROSS-SCOPE'), requirement_ids: ['REQ-1', 'REQ-2'] }] }
  const caseDependencies = shared.canonicalDependencyUpdates(portfolio, { model }, { model: sharedCaseScope })
  assert.equal(caseDependencies.fmea.folios[0].dirty, true, 'Cross-scope case membership updates the study requirement coverage inputs')
  assert.equal(caseDependencies.system, undefined, 'Case scope does not invalidate independent reliability calculations')
  assert.deepEqual(shared.canonicalDependencyUpdates(portfolio, { model }, { model: { ...model,
    verification_cases: [{ ...requirements.createVerificationCase('metadata-only'), reviewed_by: 'Engineer', reviewed_at: '2026-11-13' }] } }), {},
    'Verification review metadata never invalidates unrelated calculations')
  const deleted = fmea.splitFmeaUpdate(model, analysis, { ...analysis, functional_requirements: [] })
  assert.deepEqual(deleted.model.requirements.map(item => item.id), ['REQ-2'], 'Deleting a visible requirement does not delete a hidden requirement')

  const linked = fmea.splitFmeaUpdate(model, analysis, { ...analysis,
    functional_requirements: [...analysis.functional_requirements, { ...views.functionalRequirementView(model.requirements[1]), target: '' }] })
  assert.ok(linked.model.requirements[1].supporting_analyses.some(ref => ref.analysis_id === analysis.id))
  assert.equal(linked.model.requirements[1].allocations[0].instance_id, 'right', 'Linking preserves existing allocation')
  assert.equal(linked.analysis.functional_requirements.length, 2, 'An explicit study association retains an out-of-scope requirement')

  const process = defaults.createFmeaAnalysis('pfmea', 1)
  process.functional_requirements = [{ ...views.functionalRequirementView(model.requirements[0]), statement: 'Torque fastener' }]
  const processEdited = { ...process, functional_requirements: [{ ...process.functional_requirements[0], statement: 'Torque fastener to 12 Nm' }] }
  const processResult = fmea.splitFmeaUpdate(model, process, processEdited)
  assert.equal(processResult.model, model, 'Process requirements never mutate the physical system')
  assert.deepEqual(fmea.materializeFmeaAnalysis(model, processEdited), processEdited)
  assert.equal(views.stripSharedRequirementProjections({ analyses: [processEdited] }, model, 'analyses', 'fmea').analyses[0], processEdited)

  const verificationCase = { ...requirements.createVerificationCase('CASE-1', 'REQ-1'), objective: 'Measure output voltage',
    failure_chain_ids: ['other-study-failure'] }
  model.verification_cases = [verificationCase]
  const localEvidence = { id: 'local-rating', target_id: 'failure', source_module: 'external', source_analysis_id: '',
    evidence_kind: 'rationale', claim: 'Detection rationale', locator: 'review.md', captured_at: '2026-11-13', stale: false }
  const source = { analyses: [analysis], governance: { [analysis.id]: { evidenceLinks: [localEvidence] }, [process.id]: {
    verificationPlan: [{ ...verificationCase, id: 'PF-CASE', status: 'passed' }], evidenceLinks: [] } } }
  source.analyses.push(process)
  const projected = views.materializeSharedRequirementState(source, model, 'analyses', 'fmea')
  assert.deepEqual(projected.governance[analysis.id].verificationPlan[0].failure_chain_ids, [], 'A study does not expose foreign failure-chain IDs')
  const changed = structuredClone(projected)
  changed.governance[analysis.id].verificationPlan[0].objective = 'Measure at rated load'
  changed.governance[analysis.id].verificationPlan[0].status = 'passed'
  const result = views.splitSharedRequirementState(projected, changed, model, 'analyses', 'fmea')
  assert.equal(result.model.verification_cases[0].objective, 'Measure at rated load')
  assert.deepEqual(result.model.verification_cases[0].failure_chain_ids, ['other-study-failure'], 'Editing filtered cases retains hidden links')
  assert.equal(result.model.verification_cases[0].status, 'in_progress', 'Legacy status edits cannot bypass engineer review')
  assert.equal(result.model.verification_cases[0].reviewed_fingerprint, '')
  assert.deepEqual(result.state.governance[analysis.id].verificationPlan, [], 'Case definitions have one persistent owner')
  assert.deepEqual(result.state.governance[analysis.id].evidenceLinks, [localEvidence], 'Rating/control evidence remains analysis-local')
  assert.equal(result.state.governance[process.id].verificationPlan[0].status, 'passed', 'Process verification remains process-scoped')
  assert.deepEqual(result.state.analyses[0].functional_requirements, [], 'Physical requirement data is a projection')
  assert.equal(result.state.analyses[1].functional_requirements[0].statement, 'Torque fastener')

  const evidenceEdit = structuredClone(projected)
  evidenceEdit.governance[analysis.id].evidenceLinks.push({ ...localEvidence, id: 'shared-evidence', target_id: 'REQ-1', evidence_kind: 'verification' })
  const evidenceResult = views.splitSharedRequirementState(projected, evidenceEdit, model, 'analyses', 'fmea')
  assert.equal(evidenceResult.model.verification_evidence[0].id, 'shared-evidence')
  assert.deepEqual(evidenceResult.model.verification_evidence[0].requirement_ids, ['REQ-1'])
  assert.deepEqual(evidenceResult.state.governance[analysis.id].evidenceLinks, [localEvidence])
  const renamed = structuredClone(evidenceResult.model)
  renamed.instances.find(item => item.id === 'left').name = 'Primary supply'
  renamed.instances.find(item => item.id === 'left').parent_instance_id = 'right'
  assert.equal(views.sharedFmeaRequirements(renamed, analysis)[0].id, 'REQ-1', 'Renaming/reparenting retains requirement identity')
  const guardedAnalysis = fmea.materializeFmeaAnalysis(evidenceResult.model, analysis)
  assert.throws(() => fmea.splitFmeaUpdate(evidenceResult.model, guardedAnalysis, { ...guardedAnalysis, functional_requirements: [] }), /Retire this requirement/,
    'Physical FMEA cannot delete a requirement with verification/evidence history')
  const guardedProgram = { rows: { requirements: views.sharedProgramRequirementRows(evidenceResult.model) }, aiagAnalyses: [] }
  assert.throws(() => views.splitSharedRequirementState(guardedProgram, { ...guardedProgram, rows: { requirements: [] } }, evidenceResult.model,
    'aiagAnalyses', 'reliabilityProgram'), /Retire this requirement/)
  const reviewedModel = { ...evidenceResult.model, verification_cases: evidenceResult.model.verification_cases.map(item => ({
    ...item, reviewed_at: '2026-11-13T00:00:00Z', reviewed_fingerprint: 'a'.repeat(64) })) }
  const reviewedView = views.materializeSharedRequirementState(evidenceResult.state, reviewedModel, 'analyses', 'fmea')
  assert.throws(() => views.splitSharedRequirementState(reviewedView, { ...reviewedView, governance: {
    ...reviewedView.governance, [analysis.id]: { ...reviewedView.governance[analysis.id], verificationPlan: [] } } },
    reviewedModel, 'analyses', 'fmea'), /Reviewed verification cases cannot be deleted/)
  const outcomeEdit = structuredClone(reviewedView)
  outcomeEdit.governance[analysis.id].verificationPlan[0].status = 'failed'
  const outcomeResult = views.splitSharedRequirementState(reviewedView, outcomeEdit, reviewedModel, 'analyses', 'fmea')
  assert.equal(outcomeResult.model.verification_cases[0].reviewed_fingerprint, 'a'.repeat(64),
    'Changing an outcome preserves prior review metadata so stale reviews cannot be erased or deleted')
  const restored = JSON.parse(JSON.stringify(evidenceResult.model))
  const restoredView = views.materializeSharedRequirementState(evidenceResult.state, restored, 'analyses', 'fmea')
  assert.equal(restoredView.governance[analysis.id].evidenceLinks.find(item => item.id === 'shared-evidence').target_id, 'REQ-1')

  project.newProject('Canonical requirement persistence')
  const systemState = { ...shared.createProjectSystem(), model: restored }
  project.writeModuleSlices({ systemDefinition: systemState, fmea: { _folioWrap: true, activeId: 'main',
    folios: [{ id: 'main', name: 'System assessment', state: evidenceResult.state }] },
    reliabilityProgram: { _folioWrap: true, activeId: 'main', folios: [{ id: 'main', name: 'Requirements', state: updated.state }] } })
  for (const moduleKey of ['fmea', 'reliabilityProgram']) {
    const exported = project.buildExport([moduleKey], true)
    assert.equal(exported.modules.systemDefinition.model.requirements[0].id, 'REQ-1', `${moduleKey} export includes canonical companion`)
    project.newProject('Reopened ' + moduleKey)
    const imported = project.importPayload(JSON.parse(JSON.stringify(exported)))
    assert.ok(imported.applied.includes(moduleKey), JSON.stringify(imported))
    assert.equal(project.getProjectState().modules.systemDefinition.model.verification_evidence[0].id, 'shared-evidence')
    project.writeModuleSlices({ fmea: { _folioWrap: true, activeId: 'main', folios: [{ id: 'main', name: 'System assessment', state: evidenceResult.state }] },
      reliabilityProgram: { _folioWrap: true, activeId: 'main', folios: [{ id: 'main', name: 'Requirements', state: updated.state }] } })
  }
  const reviewModel = structuredClone(restored)
  reviewModel.requirements[0].acceptance_criteria = 'Voltage is 540 V'
  reviewModel.verification_cases[0] = { ...reviewModel.verification_cases[0], method: 'Inspection', acceptance_criteria: 'Voltage is 540 V',
    outcome: 'pass', assessment: 'Measured output meets the criterion', evidence_link_ids: ['shared-evidence'] }
  reviewModel.verification_evidence[0] = { ...reviewModel.verification_evidence[0], source_revision: 'A', source_checksum: 'a'.repeat(64) }
  project.writeModuleSlices({ systemDefinition: { ...systemState, model: reviewModel } })
  const raw = evidenceResult.state
  const materialized = views.materializeSharedRequirementState({ ...raw, analyses: raw.analyses.map(item => fmea.materializeFmeaAnalysis(reviewModel, item)) },
    reviewModel, 'analyses', 'fmea')
  const context = project.getProjectState()
  const rawInputs = project.analysisInputSnapshot(raw, 'fmea', context)
  assert.deepEqual(project.analysisInputSnapshot(materialized, 'fmea', context), rawInputs,
    'Stored and materialized inputs produce the same analysis fingerprint')
  context.modules.fmea.folios[0].state.result = { coverage: 1 }
  context.analysisRuns = [{ runId: 'review-support', moduleKey: 'fmea', analysisId: 'main', analysisName: 'System assessment',
    inputSha256: await provenance.hashCanonicalJson(rawInputs), fingerprintSha256: 'b'.repeat(64),
    resultSha256: await provenance.hashCanonicalJson(project.extractResults(context.modules.fmea.folios[0].state)),
    engineRevision: version.engineRevisionFor('fmea') }]
  context.modules.fmea.folios[0].dirty = false // A newly completed calculation clears its input-dirty marker.
  assert.equal(verification.verificationSourcesForProject(context)[0].current, true)
  context.modules.systemDefinition = { ...systemState, model: requirements.reviewVerificationCase(reviewModel, 'CASE-1', 'Review engineer') }
  assert.equal(verification.verificationSourcesForProject(context)[0].current, true, 'An explicit verification review does not invalidate its source analysis')
  context.modules.systemDefinition.model.requirements[0].target = '550'
  assert.equal(verification.verificationSourcesForProject(context)[0].current, false, 'An actual requirement target edit invalidates coverage analysis inputs')
  console.log('Shared requirement views: cross-editor writes, scoped deletion, PFMEA isolation, review gating, persistence, and identity passed')
} finally {
  await vite.close()
  hmrServer.close()
}
