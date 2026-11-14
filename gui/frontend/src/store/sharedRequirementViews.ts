import type { AIAGVDAFMEAAnalysis, FMEAFunctionalRequirement, RequirementInput } from '../api/reliabilityProgram'
import type { FMEAEvidenceLink, FMEAVerificationPlanRow } from '../api/fmea'
import type { SystemDefinitionModel, SystemRequirement, SystemVerificationCase, SystemVerificationEvidence } from '../api/systemDefinition'
import type { ArtifactSourceRecord } from './provenance'
import { architectureDependencyScope } from './systemArchitecture'
import { createSystemRequirement, createVerificationCase, evaluateSystemRequirements } from './systemRequirements'

type Analysis = AIAGVDAFMEAAnalysis
type Row = Record<string, string | boolean>
type Governance = Record<string, unknown> & { verificationPlan?: FMEAVerificationPlanRow[]; evidenceLinks?: FMEAEvidenceLink[] }
type ViewState = { rows?: Record<string, Row[]>; governance?: Record<string, Governance>; [key: string]: unknown }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const csv = (value: unknown) => String(value ?? '').split(',').map(item => item.trim()).filter(Boolean)
const text = (value: unknown) => String(value ?? '')
const physical = (model: SystemDefinitionModel, analysis: Analysis) => analysis.kind !== 'pfmea'
  && analysis.system_binding?.system_model_id === model.id

function assertRequirementDeletion(model: SystemDefinitionModel, id: string) {
  const item = model.requirements?.find(value => value.id === id)
  if (!item) return
  if (item.lifecycle !== 'draft' || item.evidence_ids.length
    || model.requirements?.some(value => value.derived_from_ids.includes(id))
    || model.verification_cases?.some(value => value.requirement_ids.includes(id))
    || model.verification_evidence?.some(value => value.target_id === id || value.requirement_ids.includes(id)))
    throw new Error('Retire this requirement to preserve its verification and traceability history.')
}

/** API views contain only contract fields, never a second editable canonical record. */
export function functionalRequirementView(item: SystemRequirement): FMEAFunctionalRequirement {
  return { id: item.id, statement: item.statement, requirement_type: item.requirement_type,
    measure: item.measure, target: item.target, unit: item.unit, acceptance_criteria: item.acceptance_criteria,
    operating_condition: item.operating_condition, source: item.source, owner: item.owner, confidence: item.confidence,
    verification_method: item.verification_method, verification_method_id: item.verification_method_id,
    evidence_ids: [...item.evidence_ids], special_characteristic: item.special_characteristic }
}

export function sharedFmeaRequirements(model: SystemDefinitionModel, analysis: Analysis): FMEAFunctionalRequirement[] {
  if (!physical(model, analysis)) return analysis.functional_requirements ?? []
  const scope = architectureDependencyScope(model, { scopeInstanceId: analysis.system_binding?.scope_instance_id,
    modeId: analysis.system_binding?.mode_id, includedPiecePartIds: analysis.system_binding?.included_piece_part_ids }).scopeInstanceIds
  const retained = new Set((analysis.function_requirement_links ?? []).map(link => link.requirement_id))
  for (const edge of analysis.interfaces ?? []) for (const id of edge.requirement_ids ?? []) retained.add(id)
  const requirements = model.requirements ?? []
  const visible = new Set(requirements.filter(item => retained.has(item.id)
    || item.supporting_analyses.some(ref => ref.analysis_id === analysis.id)
    || !item.allocations.length
    || item.allocations.some(ref => ref.system_model_id === model.id && (
      ref.instance_id ? scope.has(ref.instance_id) : ref.interface_id
        ? model.interfaces.some(edge => edge.id === ref.interface_id && [edge.source.instance_id, edge.target.instance_id].some(id => id && scope.has(id)))
        : ref.definition_id ? model.instances.some(instance => instance.definition_id === ref.definition_id && scope.has(instance.id)) : true)))
    .map(item => item.id))
  // A shared verification can cover several allocated items. Keep its requirement
  // context visible so the FMEA API never receives dangling cross-study links.
  let changed = true
  while (changed) {
    changed = false
    for (const item of model.verification_cases ?? []) if (item.requirement_ids.some(id => visible.has(id)))
      for (const id of item.requirement_ids) if (!visible.has(id)) { visible.add(id); changed = true }
  }
  return requirements.filter(item => visible.has(item.id)).map(functionalRequirementView)
}

/** Delete/patch only records that were present in this editor's original projection. */
export function splitFmeaRequirements(model: SystemDefinitionModel, before: Analysis, next: Analysis,
  moduleKey = 'fmea'): SystemDefinitionModel {
  if (!physical(model, next) || same(before.functional_requirements, next.functional_requirements)) return model
  const previous = new Map((before.functional_requirements ?? []).map(item => [item.id, item]))
  const requested = new Map((next.functional_requirements ?? []).map(item => [item.id, item]))
  if (requested.size !== (next.functional_requirements ?? []).length || [...requested.keys()].some(id => !id.trim()))
    throw new Error('Requirement IDs must be nonempty and unique.')
  for (const id of previous.keys()) if (!requested.has(id)) assertRequirementDeletion(model, id)
  const requirements = (model.requirements ?? []).filter(item => !previous.has(item.id) || requested.has(item.id))
  for (const item of requested.values()) {
    if (same(previous.get(item.id), item)) continue
    const at = requirements.findIndex(value => value.id === item.id)
    const prior = at < 0 ? createSystemRequirement(item.id) : requirements[at]
    const { linked_program_requirement_id: _link, source_checksum: _checksum, ...fields } = item
    const association = { module_key: moduleKey, analysis_id: next.id }
    const value: SystemRequirement = { ...prior, ...(at >= 0 && !previous.has(item.id) ? {} : fields), supporting_analyses:
      prior.supporting_analyses.some(ref => ref.analysis_id === next.id && ref.module_key === moduleKey)
        ? prior.supporting_analyses : [...prior.supporting_analyses, association] }
    if (at < 0) requirements.push(value); else requirements[at] = value
  }
  return { ...model, requirements }
}

export function sharedProgramRequirementRows(model: SystemDefinitionModel): Row[] {
  return (model.requirements ?? []).map(item => ({ id: item.id, statement: item.statement, measure: item.measure,
    target: item.target, confidence: item.confidence, missionProfile: item.mission_profile,
    failureDefinition: item.failure_definition, verification: item.verification_method, owner: item.owner,
    status: item.lifecycle, evidence: item.evidence_ids.join(', ') }))
}

export function sharedProgramRequirementInputs(model: SystemDefinitionModel, sources?: ArtifactSourceRecord[]): RequirementInput[] {
  const evaluated = new Map(evaluateSystemRequirements(model, sources).requirements.map(item => [item.id, item.status]))
  return (model.requirements ?? []).map(item => ({ id: item.id, statement: item.statement, measure: item.measure,
    target: item.target, confidence: item.confidence, mission_profile: item.mission_profile,
    failure_definition: item.failure_definition, verification_method: item.verification_method, owner: item.owner,
    status: evaluated.get(item.id) === 'verified' ? 'verified' : item.lifecycle === 'active' ? 'approved' : item.lifecycle,
    evidence_ids: [...item.evidence_ids] }))
}

/** Authored inputs used by coverage calculations, without reviewed outcomes or evidence freshness.
 * Keeping this projection pure prevents a verification decision from invalidating its own analysis run. */
export function sharedRequirementCalculationInputs<T extends object>(value: T, model: SystemDefinitionModel,
  moduleKey: 'fmea'|'reliabilityProgram'): T {
  const source = value as ViewState, next = { ...source }
  const analysesKey = moduleKey === 'fmea' ? 'analyses' : 'aiagAnalyses'
  if (Array.isArray(source[analysesKey])) next[analysesKey] = (source[analysesKey] as Analysis[]).map(item =>
    physical(model, item) ? { ...item, functional_requirements: sharedFmeaRequirements(model, item) } : item)
  if (moduleKey === 'reliabilityProgram') next.rows = { ...source.rows, requirements: sharedProgramRequirementRows(model) }
  return next as T
}

function splitProgramRows(model: SystemDefinitionModel, before: Row[], requested: Row[]): SystemDefinitionModel {
  if (same(before, requested)) return model
  const previous = new Map(before.map(item => [text(item.id), item]))
  const ids = new Set(requested.map(item => text(item.id)))
  if (ids.size !== requested.length || [...ids].some(id => !id.trim())) throw new Error('Requirement IDs must be nonempty and unique.')
  for (const id of previous.keys()) if (!ids.has(id)) assertRequirementDeletion(model, id)
  const requirements = (model.requirements ?? []).filter(item => !previous.has(item.id) || ids.has(item.id))
  for (const row of requested) {
    if (same(previous.get(text(row.id)), row)) continue
    const at = requirements.findIndex(item => item.id === row.id)
    const prior = at < 0 ? createSystemRequirement(text(row.id)) : requirements[at]
    const item = { ...prior, statement: text(row.statement), measure: text(row.measure), target: text(row.target),
      confidence: text(row.confidence), mission_profile: text(row.missionProfile), failure_definition: text(row.failureDefinition),
      verification_method: text(row.verification), owner: text(row.owner), evidence_ids: csv(row.evidence),
      lifecycle: (['draft', 'active', 'retired'].includes(text(row.status)) ? row.status : prior.lifecycle) as SystemRequirement['lifecycle'] }
    if (at < 0) requirements.push(item); else requirements[at] = item
  }
  return { ...model, requirements }
}

const caseFields = (item: SystemVerificationCase, status: FMEAVerificationPlanRow['status']): FMEAVerificationPlanRow => ({
  id: item.id, objective: item.objective, requirement_ids: [...item.requirement_ids], failure_chain_ids: [...item.failure_chain_ids],
  method: item.method, level: item.level, sample_size: item.sample_size, acceptance_criteria: item.acceptance_criteria,
  owner: item.owner, planned_date: item.planned_date, status, evidence_link_ids: [...item.evidence_link_ids],
})
const evidenceFields = (item: SystemVerificationEvidence): FMEAEvidenceLink => {
  const { requirement_ids: _requirements, mode_ids: _modes, run_id: _run, module_key: _module, ...fields } = item
  return fields
}
function relevantCases(model: SystemDefinitionModel, analysis: Analysis) {
  const ids = new Set(sharedFmeaRequirements(model, analysis).map(item => item.id))
  return (model.verification_cases ?? []).filter(item => !item.requirement_ids.length || item.requirement_ids.some(id => ids.has(id)))
}
function relevantEvidence(model: SystemDefinitionModel, analysis: Analysis) {
  const ids = new Set(sharedFmeaRequirements(model, analysis).map(item => item.id))
  const linked = new Set(relevantCases(model, analysis).flatMap(item => item.evidence_link_ids))
  return (model.verification_evidence ?? []).filter(item => linked.has(item.id) || item.requirement_ids.some(id => ids.has(id)))
}

export function materializeSharedRequirementState<T extends object>(value: T, model: SystemDefinitionModel,
  analysesKey: keyof T, moduleKey: 'fmea'|'reliabilityProgram', sources?: ArtifactSourceRecord[]): T {
  const source = value as ViewState, next = { ...source }
  if (moduleKey === 'reliabilityProgram') next.rows = { ...source.rows, requirements: sharedProgramRequirementRows(model) }
  const analyses = (value[analysesKey] ?? []) as Analysis[]
  if (source.governance || analyses.some(item => physical(model, item))) {
    const statuses = new Map(evaluateSystemRequirements(model, sources).cases.map(item => [item.id, item.status]))
    next.governance = { ...source.governance }
    for (const analysis of analyses) if (physical(model, analysis)) {
      const local = source.governance?.[analysis.id] ?? {}
      const failureIds = new Set(analysis.failure_chains.map(item => item.id))
      const cases = relevantCases(model, analysis).map(item => ({ ...caseFields(item,
        statuses.get(item.id) === 'passed' ? 'passed' : statuses.get(item.id) === 'failed' ? 'failed'
          : statuses.get(item.id) === 'blocked' || statuses.get(item.id) === 'stale' ? 'blocked'
            : item.status === 'planned' ? 'planned' : 'in_progress'),
        failure_chain_ids: item.failure_chain_ids.filter(id => failureIds.has(id)) }))
      const sharedEvidence = relevantEvidence(model, analysis).map(evidenceFields)
      const evidenceIds = new Set(sharedEvidence.map(item => item.id))
      next.governance[analysis.id] = { ...local, verificationPlan: cases,
        evidenceLinks: [...(local.evidenceLinks ?? []).filter(item => !evidenceIds.has(item.id)), ...sharedEvidence] }
    }
  }
  return next as T
}

export function splitSharedRequirementState<T extends object>(beforeValue: T, requestedValue: T, sourceModel: SystemDefinitionModel,
  analysesKey: keyof T, moduleKey: 'fmea'|'reliabilityProgram'): { model: SystemDefinitionModel; state: T } {
  const before = beforeValue as ViewState, next = requestedValue as ViewState
  let model = moduleKey === 'reliabilityProgram' ? splitProgramRows(sourceModel,
    before.rows?.requirements ?? [], next.rows?.requirements ?? []) : sourceModel
  const analyses = (requestedValue[analysesKey] ?? []) as Analysis[]
  for (const analysis of analyses) if (physical(model, analysis)) {
    const previous = before.governance?.[analysis.id] ?? {}, requested = next.governance?.[analysis.id] ?? {}
    if (!same(previous.verificationPlan, requested.verificationPlan)) {
      const visible = new Map((previous.verificationPlan ?? []).map(item => [item.id, item]))
      const ids = new Set((requested.verificationPlan ?? []).map(item => item.id))
      for (const item of model.verification_cases ?? []) if (visible.has(item.id) && !ids.has(item.id)
        && (item.reviewed_at || item.reviewed_fingerprint))
        throw new Error('Reviewed verification cases cannot be deleted; retain the review history.')
      const cases = (model.verification_cases ?? []).filter(item => !visible.has(item.id) || ids.has(item.id))
      for (const row of requested.verificationPlan ?? []) {
        if (same(visible.get(row.id), row)) continue
        const at = cases.findIndex(item => item.id === row.id), prior = at < 0 ? undefined : cases[at]
        const visibleFailures = new Set(visible.get(row.id)?.failure_chain_ids ?? [])
        const hiddenFailures = prior?.failure_chain_ids.filter(id => !visibleFailures.has(id)) ?? []
        const assessmentChanged = row.status !== visible.get(row.id)?.status && ['passed', 'failed'].includes(row.status)
        const item: SystemVerificationCase = { ...createVerificationCase(row.id), ...prior, ...row,
          failure_chain_ids: [...new Set([...hiddenFailures, ...row.failure_chain_ids])],
          status: row.status === 'passed' || row.status === 'failed' ? 'in_progress' : row.status,
          ...(assessmentChanged ? { outcome: row.status === 'passed' ? 'pass' as const : 'fail' as const } : {}) }
        if (at < 0) cases.push(item); else cases[at] = item
      }
      model = { ...model, verification_cases: cases }
    }
    if (!same(previous.evidenceLinks, requested.evidenceLinks)) {
      const requirements = new Set((model.requirements ?? []).map(item => item.id))
      const linkedIds = new Set((model.verification_cases ?? []).flatMap(item => item.evidence_link_ids))
      const canonicalIds = new Set((model.verification_evidence ?? []).map(item => item.id))
      const shared = (requested.evidenceLinks ?? []).filter(item => requirements.has(item.target_id) || linkedIds.has(item.id) || canonicalIds.has(item.id))
      const visible = new Map((previous.evidenceLinks ?? []).filter(item => canonicalIds.has(item.id)).map(item => [item.id, item]))
      const ids = new Set(shared.map(item => item.id))
      const evidence = (model.verification_evidence ?? []).filter(item => !visible.has(item.id) || ids.has(item.id))
      for (const row of shared) {
        if (same(visible.get(row.id), row)) continue
        const at = evidence.findIndex(item => item.id === row.id), prior = at < 0 ? undefined : evidence[at]
        const item: SystemVerificationEvidence = { requirement_ids: requirements.has(row.target_id) ? [row.target_id] : [], mode_ids: [], ...prior, ...row }
        if (at < 0) evidence.push(item); else evidence[at] = item
      }
      model = { ...model, verification_evidence: evidence }
    }
  }
  return { model, state: stripSharedRequirementProjections(requestedValue, model, analysesKey, moduleKey) }
}

/** Persistent FMEA data owns correlations and local process data, not canonical copies. */
export function stripSharedRequirementProjections<T extends object>(value: T, model: SystemDefinitionModel,
  analysesKey: keyof T, moduleKey: 'fmea'|'reliabilityProgram'): T {
  const source = value as ViewState, next = { ...source }
  if (moduleKey === 'reliabilityProgram' && source.rows) next.rows = { ...source.rows, requirements: [] }
  const analyses = (value[analysesKey] ?? []) as Analysis[]
  next[analysesKey as string] = analyses.map(item => physical(model, item) ? { ...item, functional_requirements: [] } : item)
  if (source.governance) {
    const canonicalEvidence = new Set((model.verification_evidence ?? []).map(item => item.id))
    next.governance = { ...source.governance }
    for (const analysis of analyses) if (physical(model, analysis) && source.governance[analysis.id]) {
      const governance = source.governance[analysis.id]
      next.governance[analysis.id] = { ...governance, verificationPlan: [],
        evidenceLinks: (governance.evidenceLinks ?? []).filter(item => !canonicalEvidence.has(item.id)) }
    }
  }
  return next as T
}
