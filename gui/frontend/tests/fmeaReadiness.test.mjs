import assert from 'node:assert/strict'
import { readFile, mkdtemp } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite'
import { closeViteTestServer, ssrOnlyVitePlugin } from './viteTestLifecycle.mjs'
const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-fmea-readiness-'))
const vite = await createServer({ root: new URL('..', import.meta.url).pathname, cacheDir,
  appType: 'custom', plugins: [ssrOnlyVitePlugin()], server: { middlewareMode: true, ws: { server: createHttpServer() } } })
try {
  const { evaluateFmeaReadiness: check, assertFmeaEditAllowed: guard } = await vite.ssrLoadModule('/src/store/fmeaReadiness.ts')
  const { bindFmeaAnalysis, materializeFmeaAnalysis, fmeaSemanticFingerprint } = await vite.ssrLoadModule('/src/store/sharedFmeaModel.ts')
  const { createFmeaAnalysis } = await vite.ssrLoadModule('/src/components/ReliabilityProgram/fmeaModel.ts')
  const fixture = JSON.parse(await readFile(new URL('./fixtures/aircraftArchitecture.json', import.meta.url), 'utf8'))
  const model = structuredClone(fixture)
  let analysis = bindFmeaAnalysis(model, createFmeaAnalysis('dfmea', 1), 'motor-controller')
  const findings = check(analysis, model)
  assert.equal(findings.stages[0].eligible, true)
  assert.equal(findings.stages[0].complete, true, 'Optional planning details do not block progression')
  assert.equal(findings.stages[1].eligible, true)
  assert(findings.findings.filter(item => item.step === 1).every(item => item.severity === 'warning'))
  assert.doesNotThrow(() => guard(analysis, {...analysis, functions: []}, model))
  assert.throws(() => guard(analysis, {...analysis, functions: []}, model, 'disabled_method'), /Complete Step 1/,
    'Method prerequisites remain mandatory')
  analysis.planning = {...analysis.planning, subject: 'Motor controller', scope: 'Control propulsion motor', intent: 'Assess loss of control', team: ['Systems engineer']}
  assert.equal(check(analysis, model).stages[3].eligible, true)
  assert.equal(analysis.functions.length, 4, 'Scope includes exact boundary counterpart and ancestor support functions')
  const fn = analysis.functions.find(fn => fn.system_definition_ref.instance_id === 'motor-controller')
  const chain = {actions: [], effect_contexts: [], severity: 5, occurrence: 5, detection: 5, id: 'failure-1', function_id: fn.id, failure_mode: 'Fails to receive supply', cause: 'Input connection open', effect: 'Control unavailable',
    cause_structure_node_id: fn.structure_node_id, effect_function_id: fn.id}
  analysis.failure_chains = [chain]
  assert.equal(check(analysis, model).stages[4].eligible, true, 'Only studied function needs failure coverage')
  assert.equal(check(analysis, model).stages[4].complete, false, 'Default ratings without an assessment basis cannot complete risk analysis')
  assert.equal(check(analysis, model).can_analyze, false)
  assert.equal(check(analysis, model).can_release, false)
  assert.deepEqual(check(analysis, model).findings.filter(item => item.code === 'missing_rating_rationale').map(item => item.path),
    ['severity_rationale', 'occurrence_rationale', 'detection_rationale'])
  const assessed = structuredClone(analysis)
  Object.assign(assessed.failure_chains[0], {severity_rationale: 'Loss of the propulsion control function.', occurrence_rationale: 'Connection qualification and service evidence.', detection_rationale: 'Continuity checks detect an open connection.'})
  assert.equal(check(assessed, model).stages[4].complete, true)
  const unplanned = structuredClone(assessed)
  unplanned.planning = {...unplanned.planning, subject: '', scope: '', intent: '', team: []}
  assert.equal(check(unplanned, model).can_analyze, true, 'An assessed model can be calculated without administrative planning fields')
  assert.equal(check(unplanned, model).can_release, true, 'Planning suggestions do not become release blockers')
  const msr = {...assessed, kind: 'fmea_msr', failure_chains: [{...assessed.failure_chains[0], frequency: 5, monitoring: 5}]}
  assert.deepEqual(check(msr, model).findings.filter(item => item.code === 'missing_rating_rationale').map(item => item.path),
    ['frequency_rationale', 'monitoring_rationale'], 'MSR requires its own frequency and monitoring assessment basis')
  const changed = structuredClone(model)
  changed.function_links = changed.function_links.filter(link => link.id !== 'support-motor-controller')
  const invalidated = materializeFmeaAnalysis(changed, analysis)
  assert.equal(invalidated.failure_chains.length, 1, 'Upstream changes retain risk work')
  assert.equal(check(invalidated, changed).stages[3].eligible, false)
  assert.throws(() => guard(invalidated, {...invalidated, failure_chains: [{...chain, severity: 9}]}, changed), /Complete Step 3/)
  const moved = structuredClone(changed); moved.diagrams[0].nodes[0].x += 500
  assert.doesNotThrow(() => guard(invalidated, {...invalidated, block_diagram: {...invalidated.block_diagram, viewport: {x: 100, y: 40, zoom: 1.2}}}, moved))
  assert.equal(fmeaSemanticFingerprint(model, [analysis]), fmeaSemanticFingerprint({...model, diagrams: []}, [analysis]))
  const resourceChange = structuredClone(model); resourceChange.resources[0].name += ' revised'
  assert.notEqual(fmeaSemanticFingerprint(model, [analysis]), fmeaSemanticFingerprint(resourceChange, [analysis]))
  const unrelated = structuredClone(model); unrelated.definitions.find(def => def.id === 'esps-definition').functions.push({id:'irrelevant',description:'',function_type:'primary',mode_ids:[]})
  assert.equal(fmeaSemanticFingerprint(model, [analysis]), fmeaSemanticFingerprint(unrelated, [analysis]))
  const trace = structuredClone(analysis); trace.failure_chains[0].cause_structure_node_id = undefined; trace.failure_chains[0].effect_function_id = undefined
  assert(check(trace, model).findings.some(finding => finding.code === 'missing_cause_traceability'))
  assert(check(trace, model).findings.some(finding => finding.code === 'missing_effect_traceability'))
  const process = createFmeaAnalysis('pfmea', 1)
  process.planning = structuredClone(analysis.planning)
  process.resources = [{ id: 'ready', name: 'Process readiness', category: 'state' }]
  process.structure_nodes = [{ id: 'first', name: 'First operation', level: 'process', description: '', interface: '' },
    { id: 'second', name: 'Second operation', level: 'process', description: '', interface: '' }]
  process.functions = [{ id: 'first-fn', structure_node_id: 'first', description: 'Regulate Process readiness', function_type: 'primary', operating_modes: [], owner: '', notes: '',
    definition: { role: 'maintain_state', action: 'process readiness', io: [] } },
    { id: 'second-fn', structure_node_id: 'second', description: '', function_type: 'primary', operating_modes: [], owner: '', notes: '' }]
  assert(check(process).findings.some(item => item.step === 3 && item.record_id === 'second-fn'), 'An incomplete second independent process root blocks progression')
  process.functions[1].definition = structuredClone(process.functions[0].definition)
  assert.equal(check(process).stages[3].eligible, true, 'Every independent process root is included without inventing a physical parent')
  console.log('FMEA prerequisite eligibility, read-only invalidation, scoped traceability and semantic freshness passed.')
} finally { await closeViteTestServer(vite, cacheDir) }
