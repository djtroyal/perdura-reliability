import { api, type MCFResponse, type ReplacementPolicyResponse, type CostForecastResponse } from './client'

export type BlockRepairModel = 'minimal' | 'perfect'
export type FleetModel = 'first_failure' | 'perfect_renewal' | 'minimal_repair'
export interface FleetCohort { id: string; count: number; age: number; entry_time: number; exit_time: number | null }
export interface FleetForecastRequest {
  dist: 'weibull' | 'exponential' | 'lognormal' | 'gamma' | 'loglogistic' | 'beta'
  dist_params: Record<string, number>; cohorts: FleetCohort[]; horizon: number; model: FleetModel
  cost_per_event: number; n_points?: number; relative_tolerance?: number; absolute_tolerance?: number
}
export interface FleetForecastResponse {
  model: FleetModel; time: number[]; expected_events: number[]; expected_events_lower: number[]; expected_events_upper: number[]
  expected_cost: number[]; expected_cost_lower: number[]; expected_cost_upper: number[]; period_events: number[]
  probability_no_events: number[]; log_probability_no_events: (number | null)[]; active_scheduled_units: number[]
  total_expected_events: number; total_expected_cost: number
  cohorts: (FleetCohort & { expected_events: number; expected_cost: number; numerical: { method: string; converged: boolean; cells: number; step: number } })[]
  numerical: { bounds: string; relative_tolerance: number; absolute_tolerance_per_item: number; maximum_count_half_width: number; converged: boolean }
  assumptions: string[]
}
export const computeFleetForecast = (request: FleetForecastRequest) => api.post<FleetForecastResponse>('/maintenance/fleet-forecast', request).then(r => r.data)
export const compareReplacementPolicies = (request: {
  cost_PM: number; cost_CM: number; weibull_alpha: number; weibull_beta: number; block_repair_model: BlockRepairModel
}) => api.post<ReplacementPolicyResponse>('/maintenance/replacement-policy', request).then(r => r.data)
export const forecastMaintenanceCost = (request: {
  policy: string; cost_PM: number; cost_CM: number; weibull_alpha: number; weibull_beta: number
  horizon: number; interval: number | null; block_repair_model: BlockRepairModel
}) => api.post<CostForecastResponse>('/maintenance/cost-forecast', request).then(r => r.data)

export interface CostMCFRecord { system_id: string; time: number; status: 'event' | 'censor'; cost?: number }
export const computeLifecycleMCF = (request: {
  data?: number[][]; observation_ends?: number[]; records?: CostMCFRecord[]; measure?: 'events' | 'cost'
  CI?: number; parametric?: boolean; interval_method?: 'log_transformed' | 'cluster_bootstrap'; bootstrap_samples?: number; seed?: number
}) => api.post<MCFResponse>('/growth/mcf', request).then(r => r.data)
