import { api } from './client'

export interface InventoryItem {
  part_number: string; source_ids: string[]; quantity: number; failure_rate: number; duty_cycle: number
  model: 'poisson' | 'negative_binomial' | 'weibull'; dispersion: number; weibull_alpha: number | null; weibull_beta: number | null
  initial_stock: number; unit_cost: number; repair_probability: number; include_pipeline: boolean
  lead_mean: number; lead_sd: number; storage_failure_rate: number
  cohorts: { count: number; age: number; entry: number; exit: number | null }[]
}
export interface InventoryRequest {
  items: InventoryItem[]; mode: 'period' | 'lifetime'; horizon: number; service_probability: number
  target: 'per_part' | 'joint'; dependence: 'independent' | 'unspecified'; simulations: number; seed: number
  source_fingerprint: string; units: string
  allocation: 'equal_risk' | 'minimum_cost'; maximum_stock: number
}
export interface InventoryResult {
  mode: string; purchase_quantity: number; purchase_cost: number
  joint_protection: number | null; joint_protection_lower_bound: number; joint_method: string
  allocation: string; simulation_uncertainty: boolean; source_fingerprint: string; input_fingerprint: string; units: string
  joint_protection_interval?: { lower: number; upper: number; confidence: number; method: string } | null
  rows: { part_number: string; quantity: number; source_ids: string[]; initial_stock: number; unit_cost: number
    required_stock: number; purchase_quantity: number; purchase_cost: number; achieved_protection: number
    service_target: number | null; expected_demand?: number; expected_condemnations?: number; method: string
    stock_interval?: { lower: number; upper: number | null; method: string } | null
    protection_interval?: { lower: number; upper: number; method: string } | null
    simulation_trials: number; assumptions: string[] }[]
}
export const planInventory = (input: InventoryRequest) => api.post<InventoryResult>('/inventory/plan', input).then(r => r.data)
