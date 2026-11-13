import type { CanonicalSystemRef, SystemDefinitionIssue, SystemDefinitionModel, SystemRequirement,
  SystemVerificationCase, SystemVerificationEvidence } from '../api/systemDefinition'
import type { ArtifactSourceRecord } from './provenance'
import { canonicalJson } from './provenance'
import { sha256FtaText } from '../components/FaultTree/libraryModel'
import { effectiveSystemFunctions } from './systemArchitecture'

export type RequirementIssue = SystemDefinitionIssue & { entity_id: string }
export type VerificationStatus = 'draft'|'blocked'|'unreviewed'|'passed'|'failed'|'stale'
export type RequirementStatus = 'draft'|'unverified'|'verified'|'failed'|'stale'|'retired'
const blank = (value: unknown) => typeof value !== 'string' || !value.trim()
const sorted = <T extends {id: string}>(items: T[]) => [...items].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const without = (value: object, keys: string[]): Record<string, unknown> => Object.fromEntries(
  Object.entries(value).filter(([key]) => !keys.includes(key)))

/** Draft graph gaps are allowed; malformed persistence must not reach an editor or evaluator. */
export function assertRequirementRecordShapes(model: SystemDefinitionModel): void {
  const schemas = [
    ['requirements', ['derived_from_ids', 'allocations', 'mode_ids', 'supporting_analyses', 'evidence_ids'],
      ['id', 'statement', 'acceptance_criteria', 'unit', 'mission_profile', 'lifecycle']],
    ['verification_cases', ['requirement_ids', 'failure_chain_ids', 'evidence_link_ids', 'mode_ids'],
      ['id', 'objective', 'method', 'acceptance_criteria', 'assessment', 'outcome', 'reviewed_by', 'reviewed_at', 'reviewed_fingerprint']],
    ['verification_evidence', ['requirement_ids', 'mode_ids'], ['id', 'claim', 'locator', 'captured_at', 'source_module']],
  ] as const
  for (const [key, arrays, strings] of schemas) {
    const values: unknown = model[key]
    if (values === undefined) continue
    if (!Array.isArray(values) || values.some(value => !value || typeof value !== 'object' || Array.isArray(value)
      || arrays.some(field => !Array.isArray(value[field])) || strings.some(field => typeof value[field] !== 'string')))
      throw new Error(`Malformed System Model ${key.replace(/_/g, ' ')} records.`)
    for (const value of values) {
      for (const field of arrays) if (!['allocations', 'supporting_analyses'].includes(field) && value[field].some((id: unknown) => typeof id !== 'string'))
        throw new Error(`Malformed System Model ${key.replace(/_/g, ' ')} identities.`)
      if (key === 'requirements' && (value.supporting_analyses.some((ref: unknown) => !ref || typeof ref !== 'object'
          || typeof (ref as {module_key?:unknown}).module_key !== 'string' || typeof (ref as {analysis_id?:unknown}).analysis_id !== 'string')
        || value.allocations.some((ref: unknown) => !ref || typeof ref !== 'object'
          || typeof (ref as CanonicalSystemRef).system_model_id !== 'string')
        || !['draft', 'active', 'retired'].includes(value.lifecycle))) throw new Error('Malformed System Model requirement allocation or lifecycle.')
      if (key === 'verification_cases' && !['not_assessed', 'pass', 'fail', 'inconclusive'].includes(value.outcome))
        throw new Error('Malformed System Model verification outcome.')
    }
  }
}

export function createSystemRequirement(id: string = crypto.randomUUID()): SystemRequirement {
  return { id, statement: '', requirement_type: 'functional', measure: '', target: '', unit: '',
    acceptance_criteria: '', operating_condition: '', source: '', owner: '', confidence: '',
    verification_method: '', evidence_ids: [], special_characteristic: '', lifecycle: 'draft',
    derived_from_ids: [], allocations: [], mode_ids: [], mission_profile: '', failure_definition: '', supporting_analyses: [] }
}

export function createVerificationCase(id: string = crypto.randomUUID(), requirementId?: string): SystemVerificationCase {
  return { id, objective: '', requirement_ids: requirementId ? [requirementId] : [], failure_chain_ids: [],
    method: '', level: '', sample_size: '', acceptance_criteria: '', owner: '', status: 'planned', evidence_link_ids: [],
    mode_ids: [], outcome: 'not_assessed', assessment: '', reviewed_by: '', reviewed_at: '', reviewed_fingerprint: '', reviewed_revision: '' }
}

/** Reference identity is independent of names and diagram positions. Function IDs are occurrence-qualified. */
function allocationIssues(model: SystemDefinitionModel, ref: CanonicalSystemRef): string[] {
  const messages: string[] = []
  if (ref.system_model_id !== model.id) messages.push('Allocation belongs to a different System Model.')
  const instance = model.instances.find(item => item.id === ref.instance_id)
  const definition = model.definitions.find(item => item.id === (ref.definition_id ?? instance?.definition_id))
  if (!ref.instance_id && !ref.definition_id && !ref.interface_id) messages.push('Choose an installed block, function, or interface.')
  if (ref.instance_id && !instance) messages.push('Allocated system block no longer exists.')
  if (ref.definition_id && !definition) messages.push('Allocated block definition no longer exists.')
  if (ref.instance_id && ref.definition_id && instance?.definition_id !== ref.definition_id)
    messages.push('Allocated block and definition do not match.')
  if (ref.function_id && (!instance || !effectiveSystemFunctions(model, instance.id).some(fn => fn.id === ref.function_id)))
    messages.push('Allocated installed function no longer exists or is disabled.')
  if (ref.failure_mode_id) {
    const failure = definition?.failure_modes.find(item => item.id === ref.failure_mode_id)
    const override = instance?.failure_mode_overrides.find(item => item.failure_mode_id === ref.failure_mode_id)
    if (!failure || (override?.enabled ?? failure.default_enabled ?? true) === false)
      messages.push('Allocated failure mode no longer exists or is disabled.')
  }
  if (ref.interface_id && !model.interfaces.some(item => item.id === ref.interface_id)) messages.push('Allocated interface no longer exists.')
  return messages
}

/** Only the allocated engineering scope participates; presentation and unrelated blocks do not. */
function allocatedInputs(model: SystemDefinitionModel, allocations: CanonicalSystemRef[]) {
  const instanceIds = new Set<string>(), functionKeys = new Set<string>(), interfaceIds = new Set<string>()
  const definitionIds = new Set<string>(), resourceIds = new Set<string>()
  for (const ref of allocations) {
    if (ref.interface_id) interfaceIds.add(ref.interface_id)
    if (ref.instance_id && ref.function_id) functionKeys.add(`${ref.instance_id}::${ref.function_id}`)
    else if (ref.instance_id) instanceIds.add(ref.instance_id)
    else if (ref.definition_id) definitionIds.add(ref.definition_id)
  }
  // Installed descendants implement an allocated block requirement. This is traceability,
  // not an inferred reliability topology or automatic claim of satisfaction.
  let changed = true
  while (changed) {
    changed = false
    for (const item of model.instances) if ((instanceIds.has(item.parent_instance_id ?? '') || definitionIds.has(item.definition_id)) && !instanceIds.has(item.id)) {
      instanceIds.add(item.id); changed = true
    }
  }
  const installedFunctions = model.instances.flatMap(item => effectiveSystemFunctions(model, item.id).map(fn => ({ item, fn })))
  for (const { item, fn } of installedFunctions) if (instanceIds.has(item.id)) functionKeys.add(`${item.id}::${fn.id}`)
  for (const edge of model.interfaces) if (interfaceIds.has(edge.id)) {
    if (edge.source.instance_id) edge.source_function_ids.forEach(id => functionKeys.add(`${edge.source.instance_id}::${id}`))
    if (edge.target.instance_id) edge.target_function_ids.forEach(id => functionKeys.add(`${edge.target.instance_id}::${id}`))
    for (const transfer of edge.transfers ?? []) if (transfer.kind === 'flow') {
      for (const endpoint of [transfer.source, transfer.target]) if (endpoint.kind === 'function') functionKeys.add(`${endpoint.instance_id}::${endpoint.function_id}`)
    }
  }
  // Follow implementation support and input producers, rather than unrelated consumers.
  changed = true
  const addFunction = (instanceId: string, functionId: string) => {
    const key = `${instanceId}::${functionId}`
    if (!functionKeys.has(key)) { functionKeys.add(key); changed = true }
  }
  while (changed) {
    changed = false
    for (const link of model.function_links) {
      if (functionKeys.has(`${link.source.instance_id}::${link.source.function_id}`)
        && ['decomposes_to', 'depends_on', 'monitors', 'responds_to'].includes(link.relationship))
        addFunction(link.target.instance_id, link.target.function_id)
      if (functionKeys.has(`${link.target.instance_id}::${link.target.function_id}`)
        && ['provides_input', 'enables'].includes(link.relationship)) addFunction(link.source.instance_id, link.source.function_id)
    }
    for (const edge of model.interfaces) for (const transfer of edge.transfers ?? []) {
      if (transfer.kind === 'flow' && transfer.source.kind === 'function' && transfer.target.kind === 'function'
        && functionKeys.has(`${transfer.target.instance_id}::${transfer.target.function_id}`))
        addFunction(transfer.source.instance_id, transfer.source.function_id)
    }
  }
  const functions = installedFunctions.flatMap(({item, fn}) => {
    if (!functionKeys.has(`${item.id}::${fn.id}`)) return []
    fn.definition?.io.forEach(io => resourceIds.add(io.resource_id))
    const definition = model.definitions.find(value => value.id === item.definition_id)
    return [{ id: `${item.id}::${fn.id}`, instance_id: item.id, definition_id: item.definition_id,
      parent_instance_id: item.parent_instance_id ?? null, quantity: item.quantity, mode_ids: item.mode_ids ?? [], properties: item.properties ?? {},
      profile_overrides: item.profile_overrides ?? [], definition_properties: definition?.properties ?? {},
      analysis_profiles: definition?.analysis_profiles ?? [], function: fn }]
  })
  const selectedFunctionKeys = new Set(functions.map(fn => fn.id))
  const interfaces = model.interfaces.filter(edge => interfaceIds.has(edge.id)
    || instanceIds.has(edge.source.instance_id ?? '') || instanceIds.has(edge.target.instance_id ?? '')
    || edge.source_function_ids.some(id => selectedFunctionKeys.has(`${edge.source.instance_id}::${id}`))
    || edge.target_function_ids.some(id => selectedFunctionKeys.has(`${edge.target.instance_id}::${id}`)))
  interfaces.forEach(edge => edge.transfers?.forEach(transfer => { if (transfer.kind === 'flow') resourceIds.add(transfer.resource_id) }))
  const externalIds = new Set(interfaces.flatMap(edge => [edge.source.external_id, edge.target.external_id].filter(Boolean)))
  const instances = model.instances.filter(item => instanceIds.has(item.id))
  instances.forEach(item => definitionIds.add(item.definition_id))
  return { instances: sorted(instances).map(item => without(item, ['name', 'source_metadata', 'legacy_refs'])),
    definitions: sorted(model.definitions.filter(item => definitionIds.has(item.id))).map(item => without(item, ['name', 'revision'])),
    functions: sorted(functions), interfaces: sorted(interfaces),
    resources: sorted(model.resources.filter(item => resourceIds.has(item.id))),
    externals: sorted(model.externals.filter(item => externalIds.has(item.id))),
    function_links: sorted(model.function_links.filter(link => selectedFunctionKeys.has(`${link.source.instance_id}::${link.source.function_id}`)
      || selectedFunctionKeys.has(`${link.target.instance_id}::${link.target.function_id}`))) }
}

function requirementClosure(model: SystemDefinitionModel, ids: string[]): SystemRequirement[] {
  const byId = new Map((model.requirements ?? []).map(item => [item.id, item]))
  const pending = [...ids], seen = new Set<string>(), result: SystemRequirement[] = []
  while (pending.length) {
    const id = pending.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    const item = byId.get(id)
    if (item) { result.push(item); pending.push(...item.derived_from_ids) }
  }
  return sorted(result)
}

function verificationReviewBasis(model: SystemDefinitionModel, item: SystemVerificationCase) {
  const requirements = requirementClosure(model, item.requirement_ids)
  const modeIds = new Set([...item.mode_ids, ...requirements.flatMap(req => req.mode_ids)])
  return { schema: 'perdura-verification-review/1', system_model_id: model.id,
    case: without(item, ['status', 'planned_date', 'reviewed_by', 'reviewed_at', 'reviewed_fingerprint', 'reviewed_revision']),
    requirements: requirements.map(req => without(req, ['source_checksum', 'linked_program_requirement_id'])),
    evidence: sorted((model.verification_evidence ?? []).filter(evidence => item.evidence_link_ids.includes(evidence.id))),
    modes: sorted(model.modes.filter(mode => !modeIds.size || modeIds.has(mode.id))) }
}

/** Exported for cross-language contract fixtures. Never hash review metadata into itself. */
export function verificationReviewInputs(model: SystemDefinitionModel, item: SystemVerificationCase) {
  const requirements = requirementClosure(model, item.requirement_ids)
  return { ...verificationReviewBasis(model, item), architecture: allocatedInputs(model, requirements.flatMap(req => req.allocations)) }
}

const reviewFingerprints = new Map<string, string>()
function verificationArchitectureSignature(model: SystemDefinitionModel): string {
  return sha256FtaText(canonicalJson({ id: model.id, instances: model.instances, definitions: model.definitions,
    interfaces: model.interfaces, function_links: model.function_links, resources: model.resources, externals: model.externals }))
}

export function verificationReviewFingerprint(model: SystemDefinitionModel, item: SystemVerificationCase,
  architectureSignature = verificationArchitectureSignature(model)): string {
  const basis = verificationReviewBasis(model, item)
  // Rehash actual values rather than trusting reference equality: imported or mutated
  // objects cannot reuse an obsolete decision. Only the expensive scoped projection
  // is cached; evidence currentness and all readiness checks are evaluated every time.
  const key = sha256FtaText(canonicalJson({ architectureSignature, basis }))
  const cached = reviewFingerprints.get(key)
  if (cached) return cached
  const requirements = requirementClosure(model, item.requirement_ids)
  const fingerprint = sha256FtaText(canonicalJson({ ...basis, architecture: allocatedInputs(model, requirements.flatMap(req => req.allocations)) }))
  if (reviewFingerprints.size >= 1024) reviewFingerprints.delete(reviewFingerprints.keys().next().value!)
  reviewFingerprints.set(key, fingerprint)
  return fingerprint
}

export function evaluateSystemRequirements(model: SystemDefinitionModel, sources: ArtifactSourceRecord[] = []) {
  const requirements = model.requirements ?? [], cases = model.verification_cases ?? [], evidence = model.verification_evidence ?? []
  const architectureSignature = verificationArchitectureSignature(model)
  const issues: RequirementIssue[] = []
  const add = (entity_id: string, code: string, message: string, severity: 'error'|'warning' = 'error') =>
    issues.push({ entity_id, code, message, severity })
  const seenIdentities = new Set<string>()
  for (const [name, items] of [['Requirement', requirements], ['Verification case', cases], ['Evidence', evidence]] as const) {
    for (const item of items) {
      if (blank(item.id) || seenIdentities.has(item.id)) add(item.id, 'duplicate_identity', `${name} identities must be nonempty and unique across requirements, cases, and evidence.`)
      seenIdentities.add(item.id)
    }
  }
  const byId = new Map(requirements.map(req => [req.id, req])), modeIds = new Set(model.modes.map(mode => mode.id))
  const checkModes = (item: {id: string; mode_ids: string[]}) => {
    if (item.mode_ids.some(id => !modeIds.has(id))) add(item.id, 'missing_mode', 'An operating mode no longer exists.')
  }
  for (const req of requirements) {
    checkModes(req)
    if (blank(req.statement)) add(req.id, 'missing_statement', 'Define the requirement statement.')
    if (blank(req.acceptance_criteria)) add(req.id, 'missing_criteria', 'Define measurable acceptance criteria.')
    if (!req.allocations.length) add(req.id, 'missing_allocation', 'Allocate the requirement to a system block, function, or interface.')
    req.allocations.forEach(ref => allocationIssues(model, ref).forEach(message => add(req.id, 'broken_allocation', message)))
    if (req.evidence_ids.some(id => !evidence.some(entry => entry.id === id)))
      add(req.id, 'missing_evidence', 'A requirement evidence record no longer exists.')
    for (const id of req.derived_from_ids) if (!byId.has(id)) add(req.id, 'missing_parent_requirement', 'A parent requirement no longer exists.')
    const pending = [...req.derived_from_ids], visited = new Set<string>()
    while (pending.length) {
      const id = pending.pop()!
      if (id === req.id) { add(req.id, 'derivation_cycle', 'Requirement derivation contains a cycle.'); break }
      if (visited.has(id)) continue
      visited.add(id); pending.push(...(byId.get(id)?.derived_from_ids ?? []))
    }
    if (req.requirement_type === 'process') add(req.id, 'process_scope', 'Process requirements belong to the PFMEA process.')
  }
  for (const entry of evidence) {
    checkModes(entry)
    if (entry.requirement_ids.some(id => !byId.has(id))) add(entry.id, 'evidence_missing_requirement', 'Evidence references a missing requirement.')
  }
  const caseResults = cases.map(item => {
    checkModes(item)
    const local: RequirementIssue[] = []
    const fail = (code: string, message: string) => local.push({ entity_id: item.id, code, message, severity: 'error' })
    if (!item.requirement_ids.length) fail('missing_requirement', 'Choose a requirement to verify.')
    const linked = item.requirement_ids.flatMap(id => { const req = byId.get(id)
      if (!req) fail('missing_requirement', 'A linked requirement no longer exists.')
      return req ? [req] : [] })
    for (const req of requirementClosure(model, item.requirement_ids)) {
      if (req.lifecycle === 'retired') fail('retired_requirement', 'A linked or parent requirement is retired.')
      issues.filter(issue => issue.entity_id === req.id && issue.severity === 'error')
        .forEach(issue => fail(issue.code, `${req.id}: ${issue.message}`))
    }
    if (blank(item.objective)) fail('missing_objective', 'Define the verification objective.')
    if (blank(item.method)) fail('missing_method', 'Choose a verification method.')
    if (blank(item.acceptance_criteria)) fail('missing_criteria', 'Define the verification acceptance criteria.')
    if (blank(item.assessment)) fail('missing_assessment', 'Record how the evidence meets or fails the acceptance criteria.')
    if (!['pass', 'fail'].includes(item.outcome)) fail('missing_outcome', 'Record a pass or fail assessment; an inconclusive result remains unverified.')
    const attached = item.evidence_link_ids.flatMap(id => {
      const entry = evidence.find(value => value.id === id)
      if (!entry) fail('missing_evidence', 'An evidence record no longer exists.')
      return entry ? [entry] : []
    })
    if (!attached.length) fail('missing_evidence', 'Add applicable evidence before recording a review.')
    for (const entry of attached) {
      issues.filter(issue => issue.entity_id === entry.id).forEach(issue => fail(issue.code, issue.message))
      if (entry.stale) fail('stale_evidence', entry.stale_reason || 'Evidence was marked stale.')
      if (blank(entry.claim) || blank(entry.locator) || blank(entry.captured_at) || !Number.isFinite(Date.parse(entry.captured_at)))
        fail('incomplete_evidence', 'Evidence needs a claim, locator, and valid capture date.')
      if (!entry.requirement_ids.some(id => item.requirement_ids.includes(id))) fail('inapplicable_evidence', 'Evidence does not support a requirement in this case.')
      if (entry.source_module === 'external') {
        if (blank(entry.source_revision) || !/^[a-f0-9]{64}$/.test(entry.source_checksum ?? ''))
          fail('unversioned_evidence', 'External evidence needs its source revision and SHA-256 checksum.')
      } else {
        const source = sources.find(value => value.runId === entry.run_id && value.moduleKey === entry.module_key
          && value.analysisId === entry.source_analysis_id)
        if (!source || !source.current || source.fingerprintSha256 !== entry.source_checksum)
          fail('stale_evidence', 'The linked analysis run is missing, superseded, or its calculation inputs changed.')
      }
    }
    for (const req of linked) {
      const requiredModes = item.mode_ids.length ? item.mode_ids : req.mode_ids.length ? req.mode_ids : [...modeIds]
      if (req.mode_ids.length && item.mode_ids.some(id => !req.mode_ids.includes(id))) fail('inapplicable_mode', 'Verification includes a mode outside the requirement applicability.')
      const applicable = attached.filter(entry => entry.requirement_ids.includes(req.id))
      if (!applicable.length) fail('missing_evidence_coverage', `${req.id}: no evidence supports this requirement.`)
      const compatible = applicable.filter(entry => (!req.unit || entry.units?.trim() === req.unit.trim())
        && (!req.mission_profile || entry.mission_context?.trim() === req.mission_profile.trim()))
      if (applicable.length && !compatible.length) fail('missing_evidence_coverage', `${req.id}: no evidence matches both the units and mission context.`)
      for (const mode of requiredModes) if (!compatible.some(entry => !entry.mode_ids.length || entry.mode_ids.includes(mode)))
        fail('missing_mode_coverage', `${req.id}: evidence does not cover every verification mode.`)
      if (req.unit && !applicable.some(entry => entry.units?.trim() === req.unit.trim())) fail('unit_mismatch', `${req.id}: evidence units must match the requirement units.`)
      if (req.mission_profile && !applicable.some(entry => entry.mission_context?.trim() === req.mission_profile.trim()))
        fail('mission_mismatch', `${req.id}: evidence must identify the requirement mission context.`)
    }
    const fingerprint = verificationReviewFingerprint(model, item, architectureSignature)
    const reviewed = Boolean(item.reviewed_fingerprint && item.reviewed_by.trim() && !blank(item.reviewed_revision)
      && Number.isFinite(Date.parse(item.reviewed_at)))
    let status: VerificationStatus = 'unreviewed'
    if (reviewed && (item.reviewed_fingerprint !== fingerprint || local.some(issue => issue.code === 'stale_evidence'))) status = 'stale'
    else if (local.length || issues.some(issue => issue.entity_id === item.id)) status = blank(item.objective) ? 'draft' : 'blocked'
    else if (reviewed) status = item.outcome === 'pass' ? 'passed' : 'failed'
    issues.push(...local)
    return { id: item.id, status, issues: [...issues.filter(issue => issue.entity_id === item.id)], fingerprint }
  })
  const requirementResults = requirements.map(req => {
    const linked = caseResults.filter(item => cases.find(value => value.id === item.id)?.requirement_ids.includes(req.id))
    const ownIssues = issues.filter(issue => issue.entity_id === req.id)
    const modes = req.mode_ids.length ? req.mode_ids : [...modeIds]
    const passed = linked.filter(item => item.status === 'passed')
    const covered = modes.every(id => passed.some(item => {
      const verification = cases.find(value => value.id === item.id)!
      return !verification.mode_ids.length || verification.mode_ids.includes(id)
    }))
    let status: RequirementStatus = req.lifecycle === 'retired' ? 'retired' : req.lifecycle === 'draft' ? 'draft' : 'unverified'
    if (req.lifecycle !== 'retired') {
      if (linked.some(item => item.status === 'failed')) status = 'failed'
      else if (linked.some(item => item.status === 'stale')) status = 'stale'
      else if (!ownIssues.length && linked.length && passed.length === linked.length && covered) status = 'verified'
    }
    return { id: req.id, status, issues: ownIssues, case_ids: linked.map(item => item.id) }
  })
  return { issues, requirements: requirementResults, cases: caseResults }
}

/** Recording an outcome is separate from an engineer's review. Evidence never verifies by attachment. */
export function reviewVerificationCase(model: SystemDefinitionModel, caseId: string, reviewer: string,
  sources: ArtifactSourceRecord[] = [], now = new Date().toISOString()): SystemDefinitionModel {
  if (blank(reviewer)) throw new Error('Enter the reviewing engineer’s name.')
  if (!Number.isFinite(Date.parse(now))) throw new Error('A valid review date is required.')
  const evaluation = evaluateSystemRequirements(model, sources).cases.find(item => item.id === caseId)
  if (!evaluation) throw new Error('Verification case no longer exists.')
  if (evaluation.issues.length) throw new Error(evaluation.issues[0].message)
  return { ...model, verification_cases: (model.verification_cases ?? []).map(item => item.id !== caseId ? item : {
    ...item, status: item.outcome === 'pass' ? 'passed' : 'failed', reviewed_by: reviewer.trim(), reviewed_at: now,
    reviewed_fingerprint: evaluation.fingerprint, reviewed_revision: model.revision }) }
}
