import { api } from './client'

export type SystemInterfaceType =
  'physical'|'energy'|'information'|'material'|'human_machine'|'clearance'
export type SystemBlockKind = 'system'|'subsystem'|'assembly'|'component'|'piece_part'

export type SystemParameterValue =
  | { kind: 'number'; value: number; unit: string }
  | { kind: 'text'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'choice'; value: string; option_ids: string[] }

export interface SystemAnalysisProfile {
  id: string; name: string
  domain: 'prediction'|'reliability'|'fmea'|'rbd'|'custom'
  adapter_id: string; adapter_version: number; status: 'draft'|'reviewed'
  mode_ids: string[]; values: Record<string, SystemParameterValue>; source_ref?: string
}

export interface CanonicalSystemRef {
  system_model_id: string
  instance_id?: string
  definition_id?: string
  function_id?: string
  failure_mode_id?: string
  interface_id?: string
  revision?: string
  checksum?: string
}

export interface SystemMode {
  id: string; name: string; description: string
}

export interface SystemPort {
  id: string; name: string; interface_type: SystemInterfaceType
  direction: 'input'|'output'|'bidirectional'; description: string
  properties?: Record<string, SystemParameterValue>
}

export interface SystemFunction {
  id: string; description: string; canonical_verb_id?: string
  function_type: 'primary'|'supporting'|'interface'|'monitoring'|'system_response'
  mode_ids: string[]
  port_ids?: string[]
}

export interface SystemFailureMode {
  id: string; function_id: string; description: string
  deviation_id: string; mode_ids: string[]
}

export interface SystemBlockDefinition {
  id: string; name: string; classification: string; description: string
  kind?: SystemBlockKind; revision?: string
  part_number: string; manufacturer: string; category: string
  properties?: Record<string, SystemParameterValue>
  analysis_profiles?: SystemAnalysisProfile[]
  ports: SystemPort[]; functions: SystemFunction[]
  failure_modes: SystemFailureMode[]
  child_slots: { id: string; definition_id: string; name: string; quantity: number }[]
}

export interface SystemBlockInstance {
  id: string; definition_id: string; parent_instance_id?: string
  slot_id?: string; name: string; quantity: number
  reference_designators: string[]; mode_ids: string[]
  function_overrides: {
    function_id: string; enabled: boolean; description?: string; mode_ids?: string[]
  }[]
  failure_mode_overrides: {
    failure_mode_id: string; enabled: boolean; description?: string
    deviation_id?: string; mode_ids?: string[]
  }[]
  legacy_refs: string[]
  origin?: 'ad_hoc'|'definition_slot'; definition_revision?: string
  properties?: Record<string, SystemParameterValue>
  profile_overrides?: {
    profile_id: string; disabled: boolean; values: Record<string, SystemParameterValue>
  }[]
}

export interface SystemFunctionRef {
  instance_id: string; function_id: string
}

export interface SystemEndpoint {
  instance_id?: string; port_id?: string; external_id?: string
}

export interface SystemInterface {
  id: string; name: string; interface_type: SystemInterfaceType
  source: SystemEndpoint; target: SystemEndpoint
  directionality: 'directed'|'bidirectional'|'undirected'
  linkage: 'direct'|'indirect'; interface_detail: string
  strength?: 'strong'|'weak'|'unknown'
  nature?: 'required'|'incidental'|'conditional'|'unknown'
  flow_description: string; operating_condition: string
  source_function_ids: string[]; target_function_ids: string[]; mode_ids: string[]
  properties?: Record<string, SystemParameterValue>
}

export interface SystemPropagationAssertion {
  id: string; source_failure_mode_id: string; source_node_id: string
  target_node_id: string; transition_id: string; result_deviation_id: string
  status: 'accepted'|'rejected'|'superseded'; rationale: string
  evidence_refs: string[]; mode_ids: string[]; source_fingerprint: string
}

export interface SystemDefinitionModel {
  version: 1|2; id: string; name: string; revision: string
  modes: SystemMode[]; definitions: SystemBlockDefinition[]
  instances: SystemBlockInstance[]
  externals: { id: string; name: string; kind: 'adjacent_system'|'person'|'environment'|'other'; description: string; ports?: SystemPort[] }[]
  interfaces: SystemInterface[]
  function_links: {
    id: string; source: SystemFunctionRef; target: SystemFunctionRef
    relationship: 'decomposes_to'|'depends_on'|'provides_input'|'enables'|'monitors'|'responds_to'
    rationale: string; mode_ids: string[]
  }[]
  propagation_rules: {
    id: string; action: 'pass_through'|'transform'|'stop'|'terminate'
    interface_id?: string; source?: SystemFunctionRef; target?: SystemFunctionRef
    source_deviation_id?: string; result_deviation_id?: string
    result_description: string; mode_ids: string[]; rationale: string
  }[]
  propagation_assertions?: SystemPropagationAssertion[]
  diagrams: {
    id: string; name: string; scope_instance_id?: string
    density?: 'compact'|'standard'|'detailed'
    boundary?: { label: string; x: number; y: number; width: number; height: number }
    viewport?: { x: number; y: number; zoom: number }
    snap_to_grid?: boolean; mode_ids?: string[]
    nodes: { instance_id?: string; external_id?: string; x: number; y: number; width: number; height: number; expanded: boolean }[]
  }[]
}

export interface SystemAnalysisBinding {
  id: string; system_model_id: string
  analysis_module: 'prediction'|'fmea'|'rbd'|'fta'|'markov'; analysis_id: string
  scope_instance_id?: string; mode_id?: string
  quantity_strategy: 'grouped'|'exploded'; source_revision: string
  source_fingerprint: string
  entity_checksums: { entity_type: string; entity_id: string; checksum: string }[]
  analysis_overrides: Record<string, unknown>
}

export interface SystemDefinitionIssue {
  severity: 'error'|'warning'; code: string; message: string; path?: string
}

export interface SystemPropagationResult {
  valid: boolean; fingerprint: string; issues: SystemDefinitionIssue[]
  nodes: {
    id: string; kind: string; deviation_id: string; description: string; authored: boolean
    function: SystemFunction & { key: string; instance_id: string; instance_name: string; definition_id: string }
  }[]
  edges: {
    id: string; source: string; target: string; proposal_id: string
    rule_id?: string; transition: Record<string, unknown>
  }[]
  paths: {
    id: string; source_failure_mode_id: string; edge_ids: string[]
    terminated: boolean; termination: string; proposal_id?: string
  }[]
  proposals: {
    id: string; action: string; source_node_id?: string; target_node_id?: string
    edge_id?: string; rule_id?: string; explanation: string; review_required?: boolean
    source_failure_mode_id?: string; result_deviation_id?: string
    accepted_assertion_id?: string; evidence_refs?: string[]
    transition: Record<string, unknown>
  }[]
  coverage: {
    source_failure_modes?: number; functions_total?: number
    functions_with_downstream_mapping?: number; unmapped_function_ids?: string[]
    interfaces_without_function_mapping?: string[]; truncated?: boolean
    reviewed_proposals?: number; unreviewed_proposals?: number
  }
}

export interface SystemProjectionResult {
  valid: boolean; target: 'prediction'|'fmea'|'rbd'|'fta'|'markov'
  issues: SystemDefinitionIssue[]; projection: Record<string, unknown>
  diff: {
    add: Record<string, unknown>[]; update: Record<string, unknown>[]
    remove: Record<string, unknown>[]; conflicts: Record<string, unknown>[]
    summary: { add: number; update: number; remove: number; conflicts: number }
  }
  binding: SystemAnalysisBinding; review_required: boolean
}

export interface SystemStarterResult {
  valid: boolean; target: 'rbd'|'fta'|'markov'; source_fingerprint: string
  selected_path_ids: string[]; draft: Record<string, unknown>
  issues: SystemDefinitionIssue[]
}

export const validateSystemDefinition = (model: SystemDefinitionModel) =>
  api.post<{ valid: boolean; issues: SystemDefinitionIssue[]; summary: Record<string, number> }>(
    '/system-definition/validate', { model }).then(response => response.data)

export const upgradeSystemDefinition = (model: SystemDefinitionModel) =>
  api.post<SystemDefinitionModel>('/system-definition/upgrade', { model })
    .then(response => response.data)

export const getSystemProfileAdapters = () =>
  api.get<{ version: number; adapters: {
    id: string; domain: string; name: string; version: number; required: string[]
  }[] }>('/system-definition/profile-adapters').then(response => response.data)

export const resolveSystemProfile = (
  model: SystemDefinitionModel, instance_id: string, profile_id: string,
  options: { mode_id?: string; analysis_overrides?: Record<string, SystemParameterValue> } = {},
) => api.post<Record<string, unknown>>('/system-definition/resolve-profile', {
  model, instance_id, profile_id, ...options,
}).then(response => response.data)

export const planSystemComposition = (model: SystemDefinitionModel, instance_id: string) =>
  api.post<Record<string, unknown>>('/system-definition/composition-plan', { model, instance_id })
    .then(response => response.data)

export const propagateSystemDefinition = (
  model: SystemDefinitionModel, options: {
    mode_id?: string; source_failure_mode_ids?: string[]; max_paths?: number; max_depth?: number
  } = {},
) => api.post<SystemPropagationResult>('/system-definition/propagate', {
  model, ...options,
}).then(response => response.data)

export const projectSystemDefinition = (
  model: SystemDefinitionModel,
  target: 'prediction'|'fmea'|'rbd'|'fta'|'markov',
  options: {
    scope_instance_id?: string; mode_id?: string
    quantity_strategy?: 'grouped'|'exploded'; selected_path_ids?: string[]
    current_analysis?: Record<string, unknown>
  } = {},
) => api.post<SystemProjectionResult>('/system-definition/project', {
  model, target, ...options,
}).then(response => response.data)

export const analyzeSystemImpact = (
  model: SystemDefinitionModel, bindings: SystemAnalysisBinding[],
) => api.post<{ model_id: string; stale: number; bindings: Record<string, unknown>[] }>(
  '/system-definition/impact', { model, bindings },
).then(response => response.data)

export const generateSystemStarter = (
  model: SystemDefinitionModel,
  target: 'rbd'|'fta'|'markov',
  options: {
    mode_id?: string; source_failure_mode_ids?: string[]
    selected_path_ids?: string[]; max_paths?: number; max_depth?: number
  } = {},
) => api.post<SystemStarterResult>('/system-definition/generate-starter', {
  model, target, ...options,
}).then(response => response.data)
