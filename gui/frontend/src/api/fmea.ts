import { api } from './client'
import type {
  AIAGVDAFMEAAnalysis,
  AIAGVDAFMEAResult,
  FMEARatingProfile,
  RequirementInput,
} from './reliabilityProgram'

export type {
  AIAGVDAFMEAAnalysis,
  AIAGVDAFMEAResult,
  FMEARatingProfile,
  RequirementInput,
}

export type FMEAEntityGraph = AIAGVDAFMEAAnalysis

export type FMEAFailureRole = 'effect'|'failure_mode'|'cause'

export interface FMEAAnalysisRef {
  folio_id: string
  analysis_id: string
}

export interface FMEAFailureRoleRef extends FMEAAnalysisRef {
  chain_id: string
  role: FMEAFailureRole
}

export interface FMEAFailureStatement {
  id: string
  text: string
  version: number
  origin: FMEAFailureRoleRef
  updated_at: string
}

export interface FMEAFunctionMapping {
  id: string
  parent_structure_node_id?: string
  child_structure_node_id?: string
  parent_function_id: string
  child_function_id: string
}

export interface FMEAAnalysisRelation {
  id: string
  parent: FMEAAnalysisRef
  child: FMEAAnalysisRef
  mappings: FMEAFunctionMapping[]
  created_at: string
}

export interface FMEAFailureFlowEdge {
  id: string
  statement_id: string
  relation:
    'higher_mode_to_lower_effect'|'higher_cause_to_lower_mode'
  source: FMEAFailureRoleRef
  target: FMEAFailureRoleRef
  analysis_relation_id?: string
  function_mapping_id?: string
  status: 'active'|'detached'
  source_revision: string
  target_revision: string
  created_at: string
  detached_at?: string
}

export interface FMEAFailureFlowEvent {
  id: string
  action:
    'link'|'merge'|'edit'|'detach'|'map'|'unmap'|'delete_impact'
  statement_id?: string
  edge_id?: string
  timestamp: string
  summary: string
}

export interface FMEAFailureEndpointSnapshot extends FMEAFailureRoleRef {
  statement_id?: string
  text: string
  analysis_kind: 'dfmea'|'pfmea'|'fmea_msr'
  analysis_revision: string
  lifecycle_status: FMEALifecycleStatus
  function_id?: string
  structure_node_id?: string
}

export interface FMEAFailureFlowRegistry {
  schema_version: 1
  statements: FMEAFailureStatement[]
  analysis_relations: FMEAAnalysisRelation[]
  edges: FMEAFailureFlowEdge[]
  history: FMEAFailureFlowEvent[]
}

export interface FMEAFailureFlowSnapshot extends FMEAFailureFlowRegistry {
  owner?: FMEAAnalysisRef
  endpoints: FMEAFailureEndpointSnapshot[]
}

export type FMEAMethodStatus =
  'preview_public_alignment' | 'reference_gated'

export interface FMEAMethodProfile {
  id: string
  name: string
  edition: string
  family: string
  workflow: string
  status: FMEAMethodStatus
  reference_status: string
  supported_kinds: string[]
  capabilities: string[]
  basis: string[]
  checksum: string
}

export interface FMEAEvidenceLink {
  id: string
  target_id: string
  source_module:
    'prediction'|'life_data'|'pof'|'reliability_testing'|'warranty'
    |'fracas'|'testability'|'fault_tree'|'rbd'|'markov'|'doe'
    |'msa'|'spc'|'requirements'|'external'
  source_analysis_id: string
  source_record_id?: string
  source_revision?: string
  source_checksum?: string
  evidence_kind:
    'rate'|'distribution'|'test_result'|'requirement'|'hazard'
    |'incident'|'control_effectiveness'|'diagnostic_coverage'
    |'verification'|'rationale'|'other'
  claim: string
  locator: string
  units?: string
  mission_context?: string
  captured_at: string
  stale: boolean
  stale_reason?: string
  rating_dimension?:
    'severity'|'occurrence'|'detection'|'frequency'|'monitoring'
  rating_value?: number
}

export interface FMEDASource {
  id: string
  label: string
  failure_rate_per_hour: number
  lower_rate_per_hour?: number
  upper_rate_per_hour?: number
  exposure_fraction: number
  mission_time_hours?: number
  allocation_complete: boolean
  evidence_link_ids: string[]
  notes: string
}

export interface FMEDAFailureMode {
  id: string
  source_id: string
  description: string
  mode_fraction: number
  classification:
    'safe'|'no_effect'|'single_point'|'residual'
    |'multiple_point_detected'|'multiple_point_latent'
  diagnostic_coverage: number
  dependent_failure_fraction: number
  common_cause_group_id?: string
  diagnostic_interval_hours?: number
  proof_test_interval_hours?: number
  evidence_link_ids: string[]
  notes: string
}

export interface FMEAProcessStep {
  id: string
  sequence: number
  name: string
  step_type: 'operation'|'inspection'|'transport'|'storage'|'delay'
  structure_node_id?: string
  predecessor_ids: string[]
  product_characteristic: string
  process_characteristic: string
  notes: string
}

export interface FMEAVerificationPlanRow {
  id: string
  objective: string
  requirement_ids: string[]
  failure_chain_ids: string[]
  method: string
  level: string
  sample_size: string
  acceptance_criteria: string
  owner: string
  planned_date?: string
  status: 'planned'|'in_progress'|'passed'|'failed'|'blocked'
  evidence_link_ids: string[]
}

export interface FMEASpecialCharacteristic {
  id: string
  symbol: string
  name: string
  classification: string
  requirement_ids: string[]
  failure_chain_ids: string[]
  process_step_ids: string[]
  control_plan_row_ids: string[]
  status: 'proposed'|'approved'|'retired'
  rationale: string
}

export interface FMEAAttestation {
  id: string
  role: 'author'|'reviewer'|'approver'
  name: string
  decision: 'prepared'|'approved'|'rejected'
  statement: string
  timestamp: string
  identity_assurance: 'named_local'|'authenticated_hosted'
  identity_provider?: string
  identity_subject?: string
}

export interface FMEARevisionRecord {
  id: string
  revision: string
  created_at: string
  created_by: string
  change_summary: string
  content_sha256: string
  parent_sha256?: string
  snapshot: Record<string, unknown>
}

export interface FMEAReleaseRecord {
  id: string
  study_id: string
  revision: string
  lifecycle_status: 'released'
  method_profile_id: string
  released_at: string
  content_sha256: string
  manifest_sha256: string
  software_version: string
  software_commit: string
  profile_checksum?: string
  assurance: 'named_local'|'authenticated_hosted'
  attestations: FMEAAttestation[]
  lifecycle_event: FMEALifecycleEvent
  findings: Record<string, unknown>[]
  method_profile?: Record<string, unknown>
  rating_profile: Record<string, unknown>
  engineering_snapshot: Record<string, unknown>
  analysis_summary: Record<string, unknown>
  requirements_sha256: string
}

export interface FMEAReviewFinding {
  id: string
  target_id: string
  severity: 'info'|'warning'|'error'|'critical'
  title: string
  description: string
  status: 'open'|'in_progress'|'closed'|'accepted'
  owner: string
  due_date?: string
  disposition: string
}

export interface FMEAAssignment {
  id: string
  target_id: string
  assignee: string
  task: string
  due_date?: string
  status: 'open'|'in_progress'|'completed'|'cancelled'
}

export interface FMEAChangeRequest {
  id: string
  title: string
  rationale: string
  affected_ids: string[]
  assignment_id?: string
  status: 'proposed'|'accepted'|'implemented'|'rejected'|'withdrawn'
  requested_by: string
  requested_at: string
  disposition: string
}

export interface FMEASavedView {
  id: string
  name: string
  projection:
    'worksheet'|'fmes'|'process_flow'|'verification'|'control_plan'
    |'fmeda'|'evidence'|'issues'
  filters: Record<string, unknown>
  sort: Record<string, unknown>[]
  visible_columns: string[]
  pinned_columns: string[]
  density: 'compact'|'comfortable'|'expanded'
}

export interface FMEALibraryItem {
  id: string
  name: string
  kind:
    'foundation'|'family'|'component'|'function'|'failure_pattern'
    |'process_pattern'
  version: string
  status: 'draft'|'released'|'superseded'|'retired'
  description: string
  tags: string[]
  applicability: Record<string, unknown>
  content: Record<string, unknown[]>
  checksum?: string
  derived_from_id?: string
}

export interface FMEALibraryInstance {
  id: string
  library_item_id: string
  library_version: string
  library_checksum: string
  id_map: Record<string, string>
  instantiated_at: string
  status: 'current'|'update_available'|'detached'
}

export interface FMEALifecycleEvent {
  id: string
  from_status: FMEALifecycleStatus
  to_status: FMEALifecycleStatus
  actor: string
  rationale: string
  timestamp: string
  attestations: FMEAAttestation[]
}

export type FMEALifecycleStatus =
  'draft'|'in_review'|'approved'|'released'|'superseded'|'retired'

export interface FMEAStudy {
  schema_version: 2
  id: string
  lifecycle_status: FMEALifecycleStatus
  method_profile_id: string
  model: FMEAEntityGraph
  evidence_links: FMEAEvidenceLink[]
  fmeda_sources: FMEDASource[]
  fmeda_modes: FMEDAFailureMode[]
  process_steps: FMEAProcessStep[]
  verification_plan: FMEAVerificationPlanRow[]
  special_characteristics: FMEASpecialCharacteristic[]
  review_findings: FMEAReviewFinding[]
  assignments: FMEAAssignment[]
  change_requests: FMEAChangeRequest[]
  library_items: FMEALibraryItem[]
  library_instances: FMEALibraryInstance[]
  saved_views: FMEASavedView[]
  lifecycle_history: FMEALifecycleEvent[]
  revisions: FMEARevisionRecord[]
  releases: FMEAReleaseRecord[]
  failure_flow: FMEAFailureFlowSnapshot
}

export interface FMEDAResult {
  sources: FMEDASource[]
  rows: (FMEDAFailureMode & {
    source_rate_per_hour: number
    mode_rate_per_hour: number
    mode_rate_lower_per_hour: number
    mode_rate_upper_per_hour: number
    detected_rate_per_hour: number
    residual_rate_per_hour: number
    latent_unavailability_approx: number|null
    detection_latency_unavailability_approx: number|null
  })[]
  totals: Record<string, number>
  metrics: {
    safe_failure_fraction: number|null
    diagnostic_coverage: number|null
    single_point_fault_metric: number|null
    latent_fault_metric: number|null
    residual_rate_per_hour: number|null
    mission_residual_probability: number|null
  }
  uncertainty: {
    lower_totals: Record<string, number>
    upper_totals: Record<string, number>
    residual_rate_lower_per_hour: number
    residual_rate_upper_per_hour: number
  }
  allocation_by_source: Record<string, number>
  residual_sensitivity: {
    source_id: string
    residual_rate_per_hour: number
    residual_share: number
  }[]
  common_cause_groups: {
    group_id: string
    residual_rate_per_hour: number
  }[]
  issues: FMEAGovernanceFinding[]
  interpretation: string
}

export interface FMEAGovernanceFinding {
  code: string
  severity: 'error'|'warning'
  record_id?: string
  message: string
}

export interface FMEAStudyResult {
  study_id: string
  method_profile_id: string
  content_sha256: string
  analysis: AIAGVDAFMEAResult
  evidence_findings: FMEAGovernanceFinding[]
  flowdown_findings: FMEAGovernanceFinding[]
  governance_findings: FMEAGovernanceFinding[]
  failure_flow_findings: FMEAGovernanceFinding[]
  failure_flow: {
    statements: number
    active_links: number
    detached_links: number
    mapped_analyses: number
    coverage_gaps: number
  }
  failure_flow_snapshot: FMEAFailureFlowSnapshot
  fmeda: FMEDAResult
  projections: {
    evidence_links: FMEAEvidenceLink[]
    process_steps: FMEAProcessStep[]
    verification_plan: FMEAVerificationPlanRow[]
    special_characteristics: FMEASpecialCharacteristic[]
    review_findings: FMEAReviewFinding[]
    change_requests: FMEAChangeRequest[]
    library_instances: FMEALibraryInstance[]
  }
  findings: FMEAGovernanceFinding[]
  issue_index: (FMEAGovernanceFinding & {
    category: string
    target_id: string
  })[]
  release_ready: boolean
}

export interface FMEAAnalysisResponse {
  studies: FMEAStudyResult[]
  core: {
    analyses: AIAGVDAFMEAResult[]
    summary: Record<string, number>
    issues: Record<string, unknown>[]
    rating_profiles: FMEARatingProfile[]
    methodology: Record<string, unknown>
  }
  method_profiles: FMEAMethodProfile[]
}

export interface FMEASemanticChange {
  path: string
  change: 'added'|'removed'|'modified'
  before: unknown
  after: unknown
}

export const getFmeaMethodProfiles = () =>
  api.get<FMEAMethodProfile[]>('/fmea/method-profiles')
    .then(response => response.data)

export const analyzeFmeaStudies = (
  studies: FMEAStudy[],
  ratingProfiles: FMEARatingProfile[],
  programRequirements: RequirementInput[],
) => api.post<FMEAAnalysisResponse>('/fmea/analyze', {
  studies,
  rating_profiles: ratingProfiles,
  program_requirements: programRequirements,
}).then(response => response.data)

export const createFmeaRevision = (
  study: FMEAStudy,
  createdBy: string,
  changeSummary: string,
) => api.post<FMEARevisionRecord>('/fmea/revisions', {
  study,
  created_by: createdBy,
  change_summary: changeSummary,
}).then(response => response.data)

export const diffFmeaStudies = (before: FMEAStudy, after: FMEAStudy) =>
  api.post<{ changes: FMEASemanticChange[]; count: number }>('/fmea/diff', {
    before,
    after,
  }).then(response => response.data)

export const createFmeaRelease = (
  study: FMEAStudy,
  ratingProfiles: FMEARatingProfile[],
  programRequirements: RequirementInput[],
  softwareVersion: string,
  softwareCommit: string,
  attestations: FMEAAttestation[],
) => api.post<FMEAReleaseRecord>('/fmea/releases', {
  study,
  rating_profiles: ratingProfiles,
  program_requirements: programRequirements,
  software_version: softwareVersion,
  software_commit: softwareCommit,
  attestations,
}).then(response => response.data)

export const verifyFmeaRelease = (
  study: FMEAStudy,
  release: FMEAReleaseRecord,
) => api.post<{
  valid: boolean
  content_matches: boolean
  manifest_matches: boolean
  study_matches: boolean
  content_sha256: string
  manifest_sha256: string
  snapshot_matches: boolean
}>('/fmea/releases/verify', { study, release })
  .then(response => response.data)

export const transitionFmeaLifecycle = (
  study: FMEAStudy,
  targetStatus: FMEALifecycleStatus,
  actor: string,
  rationale: string,
  attestations: FMEAAttestation[] = [],
) => api.post<FMEAStudy>('/fmea/lifecycle/transition', {
  study,
  target_status: targetStatus,
  actor,
  rationale,
  attestations,
}).then(response => response.data)

export interface FMEASourceRecord {
  source_module: string
  source_analysis_id: string
  source_record_id?: string
  source_revision?: string
  source_checksum?: string
}

export const inspectFmeaEvidenceImpact = (
  study: FMEAStudy,
  sourceRecords: FMEASourceRecord[],
) => api.post<{
  stale_links: {
    evidence_link_id: string
    target_id: string
    reason: string
    captured_checksum?: string
    current_checksum?: string
  }[]
  affected_target_ids: string[]
  count: number
}>('/fmea/evidence/impact', {
  study,
  source_records: sourceRecords,
}).then(response => response.data)

export const prepareFmeaLibraryItem = (item: FMEALibraryItem) =>
  api.post<FMEALibraryItem>('/fmea/library/prepare', { item })
    .then(response => response.data)

export const instantiateFmeaLibraryItem = (
  study: FMEAStudy,
  item: FMEALibraryItem,
  instanceId: string,
) => api.post<{
  study: FMEAStudy
  instance: FMEALibraryInstance
  patch: Record<string, unknown[]>
}>('/fmea/library/instantiate', {
  study,
  item,
  instance_id: instanceId,
}).then(response => response.data)

export interface FMEASuggestion {
  id: string
  kind: 'rating_proposal'|'missing_basis'
  target_id: string
  path: string
  current_value: unknown
  proposed_value: unknown
  rationale: string
  evidence_link_ids: string[]
  confidence: 'source_explicit'|'rule'
  requires_acceptance: true
}

export const getFmeaSuggestions = (study: FMEAStudy) =>
  api.post<{
    suggestions: FMEASuggestion[]
    count: number
    applied: false
    policy: string
  }>('/fmea/suggestions', {
    study,
    provider: 'local_rules',
    consent_to_external_processing: false,
  }).then(response => response.data)
