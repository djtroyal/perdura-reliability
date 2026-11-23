import { api, type MarkovStateInput, type MarkovTransitionInput } from './client'

export interface SystemDiagram {
  kind: 'rbd' | 'fta'
  nodes: { id: string; type: string; data: Record<string, unknown> }[]
  edges: { id?: string; source: string; target: string; role?: string; order?: number }[]
  mission_time: number
  overrides?: Record<string, boolean>
  source_signature?: string
}
export interface DurationModel {
  distribution: 'exponential' | 'weibull' | 'lognormal' | 'gamma' | 'normal' | 'deterministic'
  params: Record<string, number>
  condition_positive?: boolean
}
export interface ComponentPolicy {
  crew_demand?: number; crew_role_id?: string | null; task_source?: { task_id: string; revision: string; signature: string; title: string } | null
  repair: DurationModel; pm_interval: number | null; pm_duration: DurationModel
  defer_repair: boolean; repair_yield: number; spares: number | null; supply_lead_time: number
}
export const defaultComponentPolicy = (): ComponentPolicy => ({
  crew_demand: 1, repair: { distribution: 'exponential', params: { mean: 10 } }, pm_interval: null,
  pm_duration: { distribution: 'deterministic', params: { value: 1 } },
  defer_repair: false, repair_yield: 1, spares: null, supply_lead_time: 0,
})
export interface LifecycleSettings {
  interval: number; policy: 'scheduled' | 'age'; downtime: number; include_mttf: boolean
  horizon: number; warmup: number; replications: number; repair_crews: number
  clock: 'calendar' | 'operating'; seed: number; confidence: number; condition_positive_lifetimes: boolean
  policies: Record<string, ComponentPolicy>; override_keys?: string[]; overrides: Record<string, boolean>
}
export const initialLifecycleSettings = (): LifecycleSettings => ({ interval: 1000, policy: 'scheduled', downtime: 0,
  include_mttf: true, horizon: 1000, warmup: 0, replications: 500, repair_crews: 1, clock: 'calendar', seed: 42,
  confidence: .95, condition_positive_lifetimes: false, policies: {}, overrides: {} })
interface Provenance { input_sha256: string; source_signature: string; method_version: string }
export interface RenewalResult extends Provenance {
  reliability: number; failure_probability: number; restricted_mean: number; mttf: number | null; mttf_status: string
  mean_operating_time_per_failure: number | null; mean_calendar_time_per_failure: number | null
  failure_frequency_per_calendar_time: number; availability: number; policy: string
  curve: { time: number; reliability: number; density: number | null; hazard: number | null }[]; assumptions: string[]
  numerical: { method: string; restricted_mean_error_estimate: number; mttf_error_estimate: number | null; note: string }
}
export interface StateResult extends Provenance {
  evaluated_overrides: Record<string, boolean>
  keys: string[]; labels: Record<string, string>; coherent: boolean; probability_sum: number; success_probability: number
  rows: { id: number; working: Record<string, boolean>; success: boolean; probability: number }[]
  csv: string; python_expression: string | null; state_id_rule: string
}
export interface MeanInterval { mean: number; lower: number; upper: number; method: string }
export interface SimulationResult extends Provenance {
  analysis_basis: string; availability: MeanInterval; critical_failures: MeanInterval; system_outages: MeanInterval
  component_failures: MeanInterval; crew_utilization: MeanInterval; mean_queue_wait_per_started_job: MeanInterval
  mean_operating_time_per_critical_failure: number | null; mean_calendar_time_per_critical_failure: number | null
  operating_time_per_critical_failure_interval: { lower: number; upper: number; method: string } | null
  critical_failure_count: number; events_processed: number; event_log_truncated: boolean; assumptions: string[]
  curve: { time: number; availability: number; uninterrupted_success: number }[]
  events: { time: number; event: string; component: string; system_up: boolean; crews_busy: number; queue_length: number; stock: number | null; measurement_window: boolean }[]
  components: { id: string; label: string; failures: number; restorations: number }[]
}
export interface LifecycleState {
  settings: LifecycleSettings; modelSignature?: string; inputSignature?: string
  renewalResult?: RenewalResult; stateResult?: StateResult; simulationResult?: SimulationResult
}
export interface RedundancyRequest {
  mode: 'active' | 'standby'; required: number; total: number; failure_rate: number; repair_rate: number
  repair_crews: number; failure_rates?: number[]; repair_rates?: number[]; dormant_rate: number; coverage: number
  switching: 'independent' | 'common'; switch_repair_rate: number; mission_time: number
}
export interface RedundancyResult extends Provenance {
  states: MarkovStateInput[]; transitions: MarkovTransitionInput[]; initial_probabilities: Record<string, number>
  assumptions: string[]; no_repair_reference: { reliability: number; mttf: number | null; basis?: string } | null
}
export const buildRedundancy = (request: RedundancyRequest) => api.post<RedundancyResult>('/system-tools/redundancy', request).then(r => r.data)
export const analyzeSystemRenewal = (diagram: SystemDiagram, s: LifecycleSettings) => api.post<RenewalResult>('/system-tools/renewal', {
  diagram, interval: s.interval, policy: s.policy, downtime: s.downtime, include_mttf: s.include_mttf,
}).then(r => r.data)
export const analyzeSystemStates = (diagram: SystemDiagram) => api.post<StateResult>('/system-tools/states', { diagram }).then(r => r.data)
export const simulateSystem = (diagram: SystemDiagram, s: LifecycleSettings) => api.post<SimulationResult>('/system-tools/simulate', {
  diagram, policies: s.policies, horizon: s.horizon, warmup: s.warmup, replications: s.replications,
  repair_crews: s.repair_crews, clock: s.clock, seed: s.seed, confidence: s.confidence,
  condition_positive_lifetimes: s.condition_positive_lifetimes,
}).then(r => r.data)
