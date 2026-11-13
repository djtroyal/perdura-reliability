import { useEffect, useMemo, useState } from 'react'
import { inspectFmeaReadiness, type FMEAReadiness, type FMEAReadinessFinding, type FMEAStudy } from '../api/fmea'
import type { AIAGVDAFMEAAnalysis, FMEARatingProfile, RequirementInput } from '../api/reliabilityProgram'
import type { SystemDefinitionModel } from '../api/systemDefinition'
import { inspectArchitectureCompleteness, processArchitectureModel, validateArchitectureIntegrity } from './systemArchitecture'
import { fmeaSemanticFingerprint, fmeaEngineeringInputs } from './sharedFmeaModel'
import { sha256FtaText } from '../components/FaultTree/libraryModel'

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const text = (value: unknown) => typeof value === 'string' && value.trim().length > 0
const rating = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10

/** Validation is available before numerical analysis, including for incomplete drafts. */
export function evaluateFmeaReadiness(analysis: AIAGVDAFMEAAnalysis, canonical?: SystemDefinitionModel,
  profiles: FMEARatingProfile[] = [], methodProfileId = 'aiag_vda_2019_public'): FMEAReadiness {
  const findings: FMEAReadinessFinding[] = []
  const issue = (step: number, code: string, message: string, record_id = analysis.id, path?: string,
    severity: FMEAReadinessFinding['severity'] = 'error') =>
    findings.push({ step, code, message, record_id, path, severity })
  if (methodProfileId !== 'aiag_vda_2019_public') issue(1, 'method_unavailable', 'Select an enabled method profile in Methods.', analysis.id, 'method_profile_id')
  for (const field of ['subject', 'scope', 'intent'] as const) if (!text(analysis.planning[field]))
    issue(1, `missing_${field}`, `Consider adding the analysis ${field} when available.`, analysis.id, `planning.${field}`, 'warning')
  if (!analysis.planning.team.some(item => item.trim())) issue(1, 'missing_team', 'Add the analysis team when available.', analysis.id, 'planning.team', 'warning')
  const model = analysis.kind === 'pfmea' ? processArchitectureModel(analysis) : canonical
  if (analysis.kind !== 'pfmea' && (!canonical || analysis.system_binding?.system_model_id !== canonical.id))
    issue(2, 'canonical_system_required', 'Select a scope in the canonical System Model.', analysis.id, 'system_binding')
  if (!analysis.structure_nodes.length) issue(2, 'empty_structure', 'Define the study hierarchy.', analysis.id, 'structure_nodes')
  if (model) {
    const scopes = analysis.kind === 'pfmea' ? model.instances.filter(item => !item.parent_instance_id).map(item => item.id)
      : [analysis.system_binding?.scope_instance_id]
    if (analysis.kind === 'pfmea' && !scopes.length) issue(2, 'invalid_process_hierarchy', 'Define a process root and an acyclic process hierarchy.', analysis.id, 'structure_nodes')
    const structuralFindings = analysis.kind === 'pfmea' ? validateArchitectureIntegrity(model).filter(item => item.step === 2) : []
    const architectureFindings = [...structuralFindings, ...scopes.flatMap(scopeInstanceId => inspectArchitectureCompleteness(model, {
      scopeInstanceId, modeId: analysis.system_binding?.mode_id, includedPiecePartIds: analysis.system_binding?.included_piece_part_ids,
    }))]
    findings.push(...[...new Map(architectureFindings.map(item => [JSON.stringify(item), item])).values()]
      .map(item => ({ ...item, severity: 'error' as const, path: item.field })))
  }
  if (!analysis.functions.length) issue(3, 'empty_functions', 'Define structured functions for the study scope.', analysis.id, 'functions')

  const scope = new Set<string>()
  if (model?.root_instance_id) {
    const pending = [analysis.kind === 'pfmea' ? model.root_instance_id : analysis.system_binding?.scope_instance_id ?? model.root_instance_id]
    const definitions = new Map(model.definitions.map(item => [item.id, item]))
    const parts = new Set(analysis.system_binding?.included_piece_part_ids ?? [])
    for (const edge of model.interfaces) for (const end of [edge.source, edge.target]) if (end.instance_id) parts.add(end.instance_id)
    while (pending.length) {
      const id = pending.pop()!
      if (scope.has(id)) continue
      const item = model.instances.find(value => value.id === id)
      if (!item || (definitions.get(item.definition_id)?.kind === 'piece_part' && !parts.has(id))) continue
      scope.add(id); pending.push(...model.instances.filter(value => value.parent_instance_id === id).map(value => value.id))
    }
  }
  const studiedFunctions = analysis.functions.filter(fn => analysis.kind === 'pfmea'
    || !fn.system_definition_ref || scope.has(fn.system_definition_ref.instance_id ?? ''))
  for (const fn of studiedFunctions) if (!analysis.failure_chains.some(chain => chain.function_id === fn.id))
    issue(4, 'function_without_failure_coverage', 'Define a failure mode and its causes and effects for this function.', fn.id, 'failure_chains')
  if (!analysis.failure_chains.length) issue(4, 'empty_failure_chains', 'Define failure modes, causes and effects.', analysis.id, 'failure_chains')
  for (const chain of analysis.failure_chains) {
    if (!analysis.functions.some(fn => fn.id === chain.function_id)) issue(4, 'missing_failure_function', 'Select the function addressed by this failure mode.', chain.id, 'function_id')
    if (!chain.cause_function_id && !analysis.structure_nodes.some(node => node.id === chain.cause_structure_node_id)) issue(4, 'missing_cause_traceability', 'Link the cause to its source function or installed/process element.', chain.id, 'cause_structure_node_id')
    if (!chain.effect_function_id && !chain.effect_contexts?.some(effect => text(effect.context) && text(effect.description))) issue(4, 'missing_effect_traceability', 'Link the effect to its affected function or define a structured stakeholder/system effect context.', chain.id, 'effect_contexts')
    for (const field of ['cause_function_id', 'effect_function_id'] as const) if (chain[field] && !analysis.functions.some(fn => fn.id === chain[field])) issue(4, 'unknown_failure_function', 'Select an existing function.', chain.id, field)
    for (const field of ['failure_mode', 'effect', 'cause'] as const) if (!text(chain[field]))
      issue(4, `missing_${field}`, `Define the ${field.replace('_', ' ')}.`, chain.id, field)
    const axes = analysis.kind === 'fmea_msr' ? ['severity', 'frequency', 'monitoring'] as const : ['severity', 'occurrence', 'detection'] as const
    for (const axis of axes) {
      if (!rating(chain[axis])) issue(5, 'invalid_rating', `Select a valid ${axis} rating.`, chain.id, axis)
      const basis = `${axis}_rationale` as keyof typeof chain
      if (!text(chain[basis])) issue(5, 'missing_rating_rationale', `Document the basis for the ${axis} rating.`, chain.id, basis)
    }
    for (const action of chain.actions) {
      if (!text(action.description) || !text(action.owner)) issue(6, 'incomplete_action', 'Define the action and responsible owner.', action.id, 'actions')
      if (action.status === 'completed' && (!action.completion_date || !action.evidence_ids.length))
        issue(6, 'action_completion_evidence', 'Completed actions require a completion date and evidence.', action.id, 'actions')
      if (action.status === 'not_implemented' && !text(action.decision_rationale))
        issue(6, 'action_decision_rationale', 'Record the decision rationale for an action not implemented.', action.id, 'actions')
    }
  }
  const profile = profiles.find(item => item.id === analysis.rating_profile_id)
  if (!analysis.rating_profile_id || profiles.length && (!profile || !profile.approved || profile.kind !== analysis.kind))
    issue(5, 'invalid_rating_profile', 'Select an approved rating profile for this analysis kind.', analysis.id, 'rating_profile_id')
  let eligible = true
  const stages = Array.from({ length: 7 }, (_, index) => {
    const own = findings.filter(item => item.step === index + 1), complete = !own.some(item => item.severity === 'error')
    const stage = { step: index + 1, eligible, complete, findings: own }; eligible &&= complete; return stage
  })
  return { semantic_fingerprint: sha256FtaText(JSON.stringify({ analysis: fmeaEngineeringInputs([analysis])[0],
    model: model && (analysis.kind === 'pfmea' ? { ...model, diagrams: undefined } : fmeaSemanticFingerprint(model, [analysis])), profiles })), findings, stages,
    can_analyze: stages.slice(0, 5).every(item => item.complete), can_release: stages.every(item => item.complete) }
}

export function draftFmeaStudy(model: AIAGVDAFMEAAnalysis): FMEAStudy {
  return { schema_version: 4, id: model.id, lifecycle_status: 'draft', method_profile_id: 'aiag_vda_2019_public', model,
    evidence_links: [], fmeda_sources: [], fmeda_modes: [], process_steps: [], verification_plan: [], special_characteristics: [],
    review_findings: [], assignments: [], change_requests: [], library_items: [], library_instances: [], saved_views: [],
    lifecycle_history: [], revisions: [], releases: [], failure_flow: { schema_version: 1, statements: [], analysis_relations: [], edges: [], history: [], endpoints: [] } }
}

/** Immediate local feedback plus authoritative backend checks. A response can
 * only apply to the exact semantic input for which it was requested. */
export function useFmeaReadiness(analysis: AIAGVDAFMEAAnalysis | undefined, model?: SystemDefinitionModel,
  profiles: FMEARatingProfile[] = [], requirements: RequirementInput[] = [], study?: FMEAStudy) {
  const semanticKey = JSON.stringify({ analysis: analysis && fmeaEngineeringInputs([analysis])[0],
    model: model && analysis && fmeaSemanticFingerprint(model, [analysis]), profiles, requirements })
  const local = useMemo(() => analysis ? evaluateFmeaReadiness(analysis, model, profiles, study?.method_profile_id) : undefined, [semanticKey, study?.method_profile_id])
  const signature = local?.semantic_fingerprint
  const studyKey = study ? JSON.stringify({ ...study, model: undefined }) : ''
  const [verified, setVerified] = useState<{ signature: string; semanticKey: string; studyKey: string; value: FMEAReadiness }>()
  useEffect(() => {
    if (!analysis || !signature) return
    let current = true
    const timer = setTimeout(() => {
      void inspectFmeaReadiness(study ?? draftFmeaStudy(analysis), model, profiles.filter(profile => !profile.built_in), requirements)
        .then(value => { if (current) setVerified({ signature, semanticKey, studyKey, value }) }).catch(() => { /* Local draft validation remains available. Execution always verifies on the server. */ })
    }, 200)
    return () => { current = false; clearTimeout(timer) }
  }, [signature, studyKey, semanticKey])
  return verified && verified.signature === signature && verified.semanticKey === semanticKey && verified.studyKey === studyKey ? verified.value : local
}

const phaseForField: Record<string, number> = { planning: 1, structure_nodes: 2, system_binding: 1,
  functions: 3, resources: 3, function_links: 3, functional_requirements: 3, function_requirement_links: 3,
  interfaces: 2, p_diagrams: 3, failure_chains: 4, control_plan: 6, status: 7 }
const ratingFields = new Set(['severity', 'occurrence', 'detection', 'frequency', 'monitoring', 'severity_rationale',
  'occurrence_rationale', 'detection_rationale', 'frequency_rationale', 'monitoring_rationale', 'prevention_controls', 'detection_controls'])
/** Guard mutation paths as well as disabled controls and alternative views. */
export function assertFmeaEditAllowed(before: AIAGVDAFMEAAnalysis, next: AIAGVDAFMEAAnalysis, model?: SystemDefinitionModel, methodProfileId?: string) {
  const readiness = evaluateFmeaReadiness(before, model, [], methodProfileId)
  const requirePhase = (phase: number) => {
    if (!readiness.stages[phase - 1].eligible) {
      const finding = readiness.findings.find(item => item.step < phase && item.severity === 'error')!
      throw new Error(`Complete Step ${finding.step} first: ${finding.message}`)
    }
  }
  for (const [field, phase] of Object.entries(phaseForField)) {
    if (equal(before[field as keyof AIAGVDAFMEAAnalysis], next[field as keyof AIAGVDAFMEAAnalysis])) continue
    if (field === 'status' && next.status === 'draft') continue
    requirePhase(phase)
    if (field !== 'failure_chains') continue
    for (const chain of next.failure_chains) {
      const prior = before.failure_chains.find(item => item.id === chain.id)
      if (!prior) continue
      for (const key of Object.keys(chain)) if (!equal(chain[key as keyof typeof chain], prior[key as keyof typeof chain])) {
        if (ratingFields.has(key)) requirePhase(5)
        if (key === 'actions' || key.startsWith('post_') || key === 'no_action_justification') requirePhase(6)
      }
    }
  }
}
