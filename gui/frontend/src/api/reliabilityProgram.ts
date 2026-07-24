import { api } from './client'

export interface FMEAInput {
  id: string; item: string; function: string; failure_mode: string
  local_effect: string; end_effect: string; cause: string; current_controls: string
  severity: number; occurrence: number; detection: number
  recommended_action: string; action_owner: string; action_status: string
  linked_hazard_ids: string[]; linked_fracas_ids: string[]
  failure_rate?: number; mode_ratio?: number; effect_probability?: number; mission_time?: number
}
export interface HazardInput {
  id: string; title: string; description: string; cause: string
  initial_probability: 'A'|'B'|'C'|'D'|'E'|'F'; initial_severity: 'I'|'II'|'III'|'IV'
  mitigation: string; verification: string
  residual_probability: 'A'|'B'|'C'|'D'|'E'|'F'; residual_severity: 'I'|'II'|'III'|'IV'
  acceptance_status: string; acceptance_authority: string; linked_fmea_ids: string[]
}
export interface FRACASInput {
  id: string; system: string; failure_mode: string; symptom: string
  exposure_at_event?: number; root_cause: string; corrective_action: string
  status: string; action_owner: string; effectiveness_verified: boolean
  recurrence: boolean; downtime: number; linked_fmea_ids: string[]
}
export interface RequirementInput {
  id: string; statement: string; measure: string; target: string; confidence: string
  mission_profile: string; failure_definition: string; verification_method: string
  owner: string; status: string; evidence_ids: string[]
}
export interface TestabilityInput {
  id: string; description: string; weight: number; detected: boolean
  ambiguity_group_size: number; detecting_test_ids: string[]
}
export interface RCMInput {
  id: string; item: string; function: string; functional_failure: string
  failure_mode: string; consequence: string; task_type: string
  task_interval?: number; decision_status: string; rationale: string
  linked_fmea_ids: string[]
}

export type FMEAKind = 'dfmea' | 'pfmea' | 'fmea_msr'
export type ActionPriority = 'H' | 'M' | 'L'
export type FMEAVocabularyDomain =
  'function_verb' | 'failure_deviation' | 'effect_level'
  | 'prevention_control' | 'detection_control'
  | 'verification_method' | 'operating_mode'

export interface FMEAVocabularyTerm {
  id: string
  domain: FMEAVocabularyDomain
  label: string
  category: string
  definition: string
  selection_question: string
  use_when: string
  avoid_when: string
  aliases: string[]
  examples: string[]
  applicability: ('dfmea'|'pfmea'|'fmea_msr'|'all')[]
  source: string
  built_in: boolean
}

export interface FMEAVocabularyAlias {
  id: string
  term_id: string
  value: string
}

export interface FMEAVocabularyProfile {
  version: 1
  custom_terms: FMEAVocabularyTerm[]
  custom_aliases: FMEAVocabularyAlias[]
}

export interface FMEAPlanning {
  company: string; location: string; customer: string; model_program: string
  subject: string; scope: string; exclusions: string; intent: string
  timing: string; tasks: string; tools: string; team: string[]
  owner: string; confidentiality: string; start_date?: string
  revision_date?: string; assumptions: string
  foundation_source_id?: string; foundation_source_revision?: string
  foundation_checksum?: string
}

export interface FMEAStructureSourceRef {
  module: 'prediction'
  analysis_id: string
  analysis_name: string
  entity_type: 'system'|'block'|'part'
  entity_id: string
  parent_entity_id?: string
  imported_at: string
  source_checksum: string
  source_name: string
  /** Stable identity for one quantity-one projection of a grouped source part. */
  piece_key?: string
  reference_designators: string[]
  part_number?: string
  quantity?: number
  manufacturer?: string
  category?: string
}

export interface FMEAStructureNode {
  id: string; name: string; level: string; parent_id?: string
  description: string; interface: string; element_type?: string
  source_ref?: FMEAStructureSourceRef
}

export interface FMEAFunction {
  id: string; structure_node_id: string; description: string
  canonical_verb_id?: string
  function_type: 'primary'|'supporting'|'interface'|'monitoring'|'system_response'
  operating_modes: string[]; owner: string; notes: string
}

export interface FMEAFunctionLink {
  id: string; source_function_id: string; target_function_id: string
  relationship: 'decomposes_to'|'depends_on'|'provides_input'|'enables'|'monitors'|'responds_to'
  label: string; rationale: string
}

export interface FMEAFunctionalRequirement {
  id: string; statement: string
  requirement_type: 'functional'|'performance'|'interface'|'safety'|'regulatory'|'customer'|'process'|'other'
  measure: string; target: string; unit: string; acceptance_criteria: string
  operating_condition: string; source: string; owner: string; confidence: string
  verification_method: string; verification_method_id?: string
  evidence_ids: string[]
  special_characteristic: string
  linked_program_requirement_id?: string; source_checksum?: string
}

export interface FMEAFunctionRequirementLink {
  id: string; function_id: string; requirement_id: string
  strength: 'weak'|'medium'|'strong'; rationale: string
}

export interface FMEABlockDiagramNode {
  id: string
  kind: 'structure'|'external'
  structure_node_id?: string
  /** Diagram-only containment; semantic parentage remains in Structure Analysis. */
  container_parent_block_id?: string
  expanded?: boolean
  label: string
  external_kind?: 'adjacent_system'|'person'|'environment'|'other'
  x: number
  y: number
  width: number
  height: number
  inside_boundary: boolean
}

export interface FMEABlockDiagram {
  version: 2
  density: 'dense'|'compact'|'comfortable'|'spacious'|'expanded'
  boundary: {
    label: string
    x: number
    y: number
    width: number
    height: number
  }
  nodes: FMEABlockDiagramNode[]
  viewport: { x: number; y: number; zoom: number }
  snap_to_grid: boolean
}

export interface FMEAInterface {
  id: string; name: string
  interface_type:
    'physical'|'energy'|'information'|'material'|'human_machine'|'clearance'
  source_block_id?: string; target_block_id?: string
  source_handle?: string; target_handle?: string
  linkage: 'direct'|'indirect'
  directionality: 'directed'|'bidirectional'|'undirected'
  relationship_strength: 'strong'|'weak'|'unspecified'
  relationship_nature: 'beneficial'|'harmful'|'mixed'|'unspecified'
  interface_detail: string
  source_structure_node_id?: string; target_structure_node_id?: string
  external_source: string; external_target: string
  flow_description: string; operating_condition: string
  function_ids: string[]; requirement_ids: string[]
}

export interface FMEAPDiagramItem {
  id: string
  category: 'signal_input'|'intended_output'|'control_factor'|'noise_factor'|'error_state'
  label: string; description: string; requirement_ids: string[]
}

export interface FMEAPDiagram {
  id: string; title: string; primary_function_id: string
  supporting_function_ids: string[]; items: FMEAPDiagramItem[]
}

export interface FMEAAction {
  id: string; kind: 'prevention'|'detection'|'design'|'process'
  description: string; owner: string; target_date?: string
  completion_date?: string
  status: 'open'|'decision_pending'|'implementation_pending'|'completed'|'not_implemented'
  evidence_ids: string[]; decision_rationale: string
}

export interface FMEAFailureChain {
  id: string; function_id?: string
  effect: string
  effect_contexts: {
    id: string; context: string; level_id?: string
    description: string; severity: number
  }[]
  failure_mode: string; deviation_id?: string
  cause: string; effect_level: string; effect_level_id?: string
  severity: number; occurrence?: number; detection?: number
  frequency?: number; monitoring?: number
  prevention_controls: string; prevention_control_method_id?: string
  detection_controls: string; detection_control_method_id?: string
  severity_rationale: string; occurrence_rationale: string
  detection_rationale: string; frequency_rationale: string
  monitoring_rationale: string
  actions: FMEAAction[]; no_action_justification: string
  post_severity?: number; post_occurrence?: number; post_detection?: number
  post_frequency?: number; post_monitoring?: number
  post_mitigated_severity?: number
  post_severity_rationale: string
  linked_hazard_ids: string[]; linked_fracas_ids: string[]
  monitoring_system: string; system_response: string; safe_state: string
  mitigated_effect: string; mitigated_severity?: number
  response_time?: number; fault_tolerant_interval?: number
  management_review_status: string
  management_review_evidence_ids: string[]
  remarks: string
}

export interface FMEAControlPlanRow {
  id: string; failure_chain_id?: string; process_step: string
  product_characteristic: string; process_characteristic: string
  specification: string; measurement_method: string; sample_size: string
  frequency: string; control_method: string; reaction_plan: string
  responsibility: string; special_characteristic: string
  source_revision?: string; stale: boolean
}

export interface FMEARatingCriterion {
  rating: number; label: string; description: string
}

export interface FMEARatingProfile {
  id: string; name: string; version: string; kind: FMEAKind
  built_in: boolean; approved: boolean; approved_by?: string
  approved_date?: string; method_status: string
  rating_axes: Record<string, FMEARatingCriterion[]>
  ap_model: 'aiag_vda_sod_2019'|'aiag_vda_sfm_2019'
  checksum?: string
}

export interface AIAGVDAFMEAAnalysis {
  id: string; name: string; kind: FMEAKind; revision: string
  status: 'draft'|'in_review'|'finalized'
  rating_profile_id?: string; planning: FMEAPlanning
  structure_nodes: FMEAStructureNode[]; functions: FMEAFunction[]
  block_diagram: FMEABlockDiagram
  function_links: FMEAFunctionLink[]
  functional_requirements: FMEAFunctionalRequirement[]
  function_requirement_links: FMEAFunctionRequirementLink[]
  interfaces: FMEAInterface[]
  p_diagrams: FMEAPDiagram[]
  failure_chains: FMEAFailureChain[]; control_plan: FMEAControlPlanRow[]
  parent_dfmea_id?: string; source_revision?: string
  standalone_justification: string
  template_source_id?: string; template_source_revision?: string
  template_source_checksum?: string
}

export interface FMEAIssue {
  step: number; code: string; severity: 'error'|'warning'
  record_id?: string; field?: string; message: string; analysis_id?: string
}

export interface AIAGVDAFMEAResult extends AIAGVDAFMEAAnalysis {
  failure_chains: (FMEAFailureChain & {
    action_priority: ActionPriority; post_action_priority: ActionPriority|null
    action_priority_meaning: string; action_priority_severity: number
  })[]
  rating_profile: Pick<FMEARatingProfile, 'id'|'name'|'version'|'checksum'|'method_status'>
  issues: FMEAIssue[]
  step_readiness: { step: number; ready: boolean; errors: number; warnings: number }[]
  finalization_ready: boolean
  control_plan_review: {
    failure_chain_id: string; status: 'missing'|'different'|'in_sync'
    differences: { field: string; current: string; proposed: string }[]
    proposal: FMEAControlPlanRow
  }[]
  function_analysis_summary: {
    functions: number; primary_functions: number; requirements: number
    correlations: number; interfaces: number; p_diagrams: number
    structures_with_functions: number; structures_total: number
    functions_with_requirements: number; functions_with_failure_chains: number
    stale_requirement_links: number; coverage_gaps: number
  }
  function_coverage: {
    structure_node_id: string; structure_name: string; level: string
    function_ids: string[]; requirement_ids: string[]
    interface_ids: string[]; failure_chain_ids: string[]; gaps: string[]
  }[]
  requirement_sync: {
    requirement_id: string; source_id: string|null
    status: 'local'|'in_sync'|'stale'|'missing_source'|'unbaselined'
    stored_checksum: string|null; current_checksum: string|null
    differences: { field: string; snapshot: unknown; source: unknown }[]
  }[]
  summary: {
    failure_chains: number; high_action_priority: number
    medium_action_priority: number; low_action_priority: number
    post_high_action_priority: number; open_actions: number
    overdue_actions: number; errors: number; warnings: number
  }
  methodology: {
    title: string; edition: string; errata: string
    implementation_status: string; method_version: string
    profile_checksum?: string; rpn_calculated: false; interpretation: string
  }
}

export interface ReliabilityProgramRequest {
  fmea: FMEAInput[]; hazards: HazardInput[]; fracas: FRACASInput[]
  requirements: RequirementInput[]; testability_faults: TestabilityInput[]; rcm: RCMInput[]
  fmea_analyses: AIAGVDAFMEAAnalysis[]; rating_profiles: FMEARatingProfile[]
  total_exposure?: number; CI: number; isolation_threshold: number
  medium_rpn: number; high_rpn: number
}

export interface ReliabilityProgramResponse {
  fmea: {
    rows: (FMEAInput & { rpn: number; screening_band: string; mode_criticality: number | null })[]
    ranked_ids: string[]
    summary: { total: number; open_actions: number; high_or_severity_override: number; criticality_available: number; total_mode_criticality: number }
    rpn_policy: { method: string; medium_threshold: number; high_threshold: number; severity_override: string; warning: string }
  }
  aiag_vda_fmea: {
    analyses: AIAGVDAFMEAResult[]
    summary: {
      analyses: number; dfmea: number; pfmea: number; fmea_msr: number
      high_action_priority: number; open_actions: number
      finalization_ready: number; issues: number
    }
    issues: FMEAIssue[]; rating_profiles: FMEARatingProfile[]
    methodology: {
      title: string; edition: string; errata: string
      implementation_status: string; method_version: string
    }
  }
  hazards: {
    rows: (HazardInput & { initial_risk: RiskCell; residual_risk: RiskCell; risk_reduced: boolean; risk_worsened: boolean })[]
    summary: { total: number; initial_high_or_serious: number; residual_high_or_serious: number; unaccepted: number; worsened: number }
    method: string; warning: string
  }
  fracas: {
    summary: { records: number; open: number; closed: number; effectiveness_verified: number; recurrences: number; closure_fraction: number | null; verification_fraction: number | null; total_downtime: number }
    exposure_metrics: { total_exposure: number | null; event_rate: number | null; mtbf: number | null; rate_lower: number | null; rate_upper: number | null; confidence_level: number }
    pareto_failure_modes: { name: string; count: number }[]
    pareto_systems: { name: string; count: number }[]
    warning: string
  }
  requirements: { rows: { id: string; missing_fields: string[]; evidence_count: number; status: string; verification_ready: boolean }[]; summary: { total: number; complete_definitions: number; with_evidence: number; verification_ready: number }; warning: string }
  testability: { rows: (TestabilityInput & { isolation_eligible: boolean })[]; summary: { faults: number; total_weight: number; fraction_faults_detected: number; fraction_faults_isolated: number; isolation_threshold: number; undetected_fault_ids: string[] }; method: string; warning: string } | null
  rcm: { summary: { items: number; unresolved: number; with_interval: number }; consequences: Record<string, number>; tasks: Record<string, number>; unresolved_ids: string[]; warning: string }
  traceability: {
    summary: { links: number; resolved_links: number; unknown_references: number; missing_reciprocal_links: number; issues: number }
    issues: { code: string; source_id: string; field: string; target_id: string; expected_record_type?: string; expected_reciprocal_field?: string }[]
    warning: string
  }
  standards_context: { status: string; references: string[] }
}

interface RiskCell { probability: string; severity: string; risk_index: number; risk_level: string }

export const analyzeReliabilityProgram = (request: ReliabilityProgramRequest) =>
  api.post<ReliabilityProgramResponse>('/reliability-program/analyze', request).then(response => response.data)

export const getFmeaRatingProfiles = () =>
  api.get<FMEARatingProfile[]>('/reliability-program/fmea/rating-profiles')
    .then(response => response.data)
