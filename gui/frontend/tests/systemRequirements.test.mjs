import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createSsrTestServer } from './viteTestLifecycle.mjs'

const vite = await createSsrTestServer({ root: new URL('..', import.meta.url).pathname, appType: 'custom', server: { middlewareMode: true } })
try {
  const core = await vite.ssrLoadModule('/src/store/systemRequirements.ts')
  const { createProjectSystem, validateProjectSystem } = await vite.ssrLoadModule('/src/store/sharedSystemModel.ts')
  const { systemInputFingerprint } = await vite.ssrLoadModule('/src/store/sharedSystemFingerprint.ts')
  const { analysisInputSnapshot } = await vite.ssrLoadModule('/src/store/project.ts')
  let model = createProjectSystem('Aircraft').model
  const root = model.instances[0], definition = model.definitions[0]
  model = { ...model, modes: [{ id: 'cruise', name: 'Cruise', description: '' }, { id: 'takeoff', name: 'Takeoff', description: '' }],
    definitions: [...model.definitions, { ...definition, id: 'propulsion-def', name: 'Propulsion', kind: 'subsystem',
      functions: [{ id: 'thrust', description: 'Provide thrust', function_type: 'primary', mode_ids: [],
        definition: {role:'source', action:'Provide thrust', io:[{id:'thrust-out',resource_id:'thrust-resource',direction:'output'}]} }] },
      { ...definition, id: 'lighting-def', name: 'Lighting', kind: 'subsystem' }],
    instances: [...model.instances, { ...root, id: 'propulsion', name: 'Propulsion', definition_id: 'propulsion-def', parent_instance_id: root.id },
      { ...root, id: 'lighting', name: 'Lighting', definition_id: 'lighting-def', parent_instance_id: root.id }],
    resources: [{ id:'thrust-resource',name:'Thrust',category:'physical',unit:'N' }] }
  const requirement = { ...core.createSystemRequirement('REQ-THRUST'), statement: 'Provide cruise thrust', lifecycle: 'active',
    acceptance_criteria: 'Measured thrust is at least 1500 N', unit: 'N', mission_profile: 'Steady cruise at reference altitude',
    allocations: [{system_model_id: model.id,instance_id:'propulsion',function_id:'thrust'}], mode_ids:['cruise'] }
  const verification = { ...core.createVerificationCase('VER-THRUST',requirement.id), objective: 'Measure cruise thrust', method: 'Test',
    acceptance_criteria: requirement.acceptance_criteria, mode_ids:['cruise'], outcome:'pass', assessment:'Recorded 1525 N; meets the criterion.', evidence_link_ids:['EV-THRUST'] }
  const evidence = { id:'EV-THRUST',target_id:verification.id,source_module:'external',source_analysis_id:'test-campaign',
    source_revision:'C',source_checksum:'a'.repeat(64),evidence_kind:'verification',claim:'1525 N measured at cruise conditions',
    locator:'test-report-12.pdf#page=7',captured_at:'2026-11-13T12:00:00.000Z',stale:false,requirement_ids:[requirement.id],
    mode_ids:['cruise'],units:'N',mission_context:requirement.mission_profile }
  model = {...model,requirements:[requirement],verification_cases:[verification],verification_evidence:[evidence]}
  const evaluate = value => core.evaluateSystemRequirements(value)
  assert.equal(evaluate(model).cases[0].status,'unreviewed','an attached file and pass selection never verify')
  assert.equal(evaluate(model).requirements[0].status,'unverified')
  assert.throws(()=>core.reviewVerificationCase(model,verification.id,''),/reviewing engineer/)
  const reviewed = core.reviewVerificationCase(model,verification.id,'A. Engineer',[],'2026-11-13T13:00:00.000Z')
  assert.equal(evaluate(reviewed).cases[0].status,'passed')
  assert.equal(evaluate(reviewed).requirements[0].status,'verified')
  const layoutOnly=structuredClone(reviewed)
  layoutOnly.diagrams=[{id:'d',name:'Drawing',nodes:[{instance_id:'propulsion',x:400,y:500,width:180,height:100,expanded:false}]}]
  layoutOnly.revision='B'
  assert.equal(evaluate(layoutOnly).cases[0].status,'passed','layout/revision labels do not invalidate engineering review')
  const unrelated=structuredClone(reviewed)
  unrelated.instances.find(item=>item.id==='lighting').quantity=4
  assert.equal(evaluate(unrelated).cases[0].status,'passed','unrelated subsystem changes are isolated')
  const rename=structuredClone(reviewed)
  rename.instances.find(item=>item.id==='propulsion').name='Forward propulsion'
  assert.equal(rename.requirements[0].allocations[0].instance_id,'propulsion')
  assert.equal(evaluate(rename).cases[0].status,'passed','display labels do not break identity')
  const moved=structuredClone(reviewed)
  moved.instances.find(item=>item.id==='propulsion').parent_instance_id='lighting'
  assert.equal(evaluate(moved).cases[0].status,'stale','moving allocated occurrence changes engineering scope')
  const changed=structuredClone(reviewed)
  changed.definitions.find(item=>item.id==='propulsion-def').functions[0].definition.action='Provide reduced thrust'
  assert.equal(evaluate(changed).cases[0].status,'stale')
  const quantityChange=structuredClone(reviewed)
  quantityChange.instances.find(item=>item.id==='propulsion').quantity=2
  assert.equal(evaluate(quantityChange).cases[0].status,'stale','installed quantity affects allocated function verification')
  const supported=structuredClone(model)
  supported.definitions.find(item=>item.id==='lighting-def').functions=[{id:'power',description:'Supply controller power',function_type:'supporting',mode_ids:[]}]
  supported.function_links=[{id:'power-support',source:{instance_id:'lighting',function_id:'power'},target:{instance_id:'propulsion',function_id:'thrust'},relationship:'provides_input',rationale:'Controller requires input power',mode_ids:[]}]
  const supportedReview=core.reviewVerificationCase(supported,verification.id,'Engineer')
  supportedReview.definitions.find(item=>item.id==='lighting-def').functions[0].description='Supply reduced controller power'
  assert.equal(evaluate(supportedReview).cases[0].status,'stale','supporting input function changes propagate to affected verification')
  const changedCriteria=structuredClone(reviewed)
  changedCriteria.requirements[0].acceptance_criteria='At least 1600 N'
  assert.equal(evaluate(changedCriteria).cases[0].status,'stale')
  for (const [field,value,code] of [['units','lbf','unit_mismatch'],['mission_context','Landing','mission_mismatch'],['mode_ids',['takeoff'],'missing_mode_coverage'],['source_checksum','','unversioned_evidence']]) {
    const mismatch=structuredClone(model);mismatch.verification_evidence[0][field]=value
    assert.ok(evaluate(mismatch).cases[0].issues.some(issue=>issue.code===code),code)
    assert.throws(()=>core.reviewVerificationCase(mismatch,verification.id,'Engineer'))
  }
  const missing=structuredClone(model);missing.requirements[0].allocations[0].instance_id='deleted'
  assert.ok(evaluate(missing).issues.some(issue=>issue.code==='broken_allocation'))
  const cycle=structuredClone(model)
  cycle.requirements.push({...requirement,id:'REQ-PARENT',derived_from_ids:[requirement.id]})
  cycle.requirements[0].derived_from_ids=['REQ-PARENT']
  assert.ok(evaluate(cycle).issues.some(issue=>issue.code==='derivation_cycle'))
  assert.throws(()=>core.reviewVerificationCase(cycle,verification.id,'Engineer'),/cycle/)
  // Graph gaps remain authorable. Structural corruption is rejected on import.
  const draft=structuredClone(model);draft.requirements=[core.createSystemRequirement('DRAFT')];draft.verification_cases=[]
  validateProjectSystem(draft)
  assert.equal(evaluate(draft).requirements[0].status,'draft')
  assert.throws(()=>validateProjectSystem({...draft,requirements:[{id:'broken'}]}),/Malformed/)
  const calculationOnly={...model,requirements:[],verification_cases:[],verification_evidence:[]}
  assert.equal(systemInputFingerprint(model),systemInputFingerprint(calculationOnly))
  assert.deepEqual(analysisInputSnapshot({model},'systemDefinition'),analysisInputSnapshot({model:calculationOnly},'systemDefinition'))
  const internal=structuredClone(model)
  internal.verification_evidence[0]={...evidence,source_module:'rbd',module_key:'system',run_id:'run1',source_analysis_id:'rbd1',source_checksum:'result-fingerprint'}
  const sources=[{runId:'run1',moduleKey:'system',analysisId:'rbd1',analysisName:'Propulsion reliability',fingerprintSha256:'result-fingerprint',inputSha256:'input',resultSha256:'result',engineRevision:1,current:true}]
  assert.throws(()=>core.reviewVerificationCase(internal,verification.id,'Engineer'),/missing, superseded/)
  const internalReview=core.reviewVerificationCase(internal,verification.id,'Engineer',sources,'2026-11-13T13:00:00.000Z')
  assert.equal(core.evaluateSystemRequirements(internalReview,sources).cases[0].status,'passed')
  assert.equal(core.evaluateSystemRequirements(internalReview,[{...sources[0],current:false}]).cases[0].status,'stale')
  const fail=structuredClone(model);fail.verification_cases[0].outcome='fail'
  assert.equal(evaluate(core.reviewVerificationCase(fail,verification.id,'Engineer')).requirements[0].status,'failed')
  const partialModes=structuredClone(reviewed);partialModes.requirements[0].mode_ids=[]
  const partialReview=core.reviewVerificationCase(partialModes,verification.id,'Engineer')
  assert.equal(evaluate(partialReview).requirements[0].status,'unverified','cruise-only review cannot verify all modes')
  const fixture={model:reviewed,sources:[],inputs:core.verificationReviewInputs(reviewed,reviewed.verification_cases[0]),fingerprint:core.verificationReviewFingerprint(reviewed,reviewed.verification_cases[0])}
  const fixturePath=new URL('../../../tests/fixtures/system_verification_contract.json',import.meta.url)
  if(process.argv.includes('--write-fixture'))await writeFile(fixturePath,JSON.stringify(fixture,null,2)+'\n')
  else assert.deepEqual(fixture,JSON.parse(await readFile(fixturePath,'utf8')),'review fingerprint must match the backend golden fixture')
  console.log('System requirements: shared identities, review gates, evidence applicability, dependency freshness, and persistence contracts passed.')
} finally { await vite.close() }
