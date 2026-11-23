import { api, type GrowthPlanResponse } from './client'

export type Sides = 'two-sided' | 'lower' | 'upper'
export type TerminalRule = 'inconclusive' | 'likelihood_ratio'
export interface ExposureRow { label: string; units: number; duration: number; duty: number }
export interface MTBFRequest {
  failures: number; confidence: number; termination: 'time' | 'failure'; sides: Sides
  total_exposure?: number; exposure_rows?: ExposureRow[]
}
export interface MTBFResponse extends Omit<MTBFRequest, 'total_exposure' | 'exposure_rows'> {
  total_exposure: number; exposure_rows: (ExposureRow & { exposure: number })[]
  mtbf_estimate: number | null; rate_estimate: number; mtbf_lower: number; mtbf_upper: number | null
  rate_lower: number; rate_upper: number | null; method: string; unbounded_point_estimate: boolean; assumptions: string[]
}
export interface BinomialRequest { trials: number; count: number; confidence: number; sides: Sides; orientation: 'success' | 'defect'; method: 'exact' | 'wilson' }
export interface BinomialResponse extends Omit<BinomialRequest, 'method'> {
  estimate: number; lower: number; upper: number; method: string
  reliability_estimate: number; reliability_lower: number; reliability_upper: number; assumptions: string[]
}
export interface NormalRequest { mean: number; standard_deviation: number; sample_size: number; confidence: number; sides: Sides; sigma_known: boolean }
export interface NormalResponse extends Omit<NormalRequest, 'sigma_known'> {
  lower: number | null; upper: number | null; standard_error: number; critical_value: number
  degrees_of_freedom: number | null; method: string; assumptions: string[]
}
export interface DiscreteRequest {
  sample_size: number; probability: number; model: 'binomial' | 'hypergeometric'; lot_size?: number; lot_defects?: number
  event: 'at_most' | 'at_least' | 'exactly' | 'between'; threshold: number; upper?: number; good_quality?: number; bad_quality?: number
}
export interface DiscreteResponse {
  probability: number; probability_accept: number; mean_defects: number; assumptions: string[]
  table: { defects: number[]; pmf: number[]; cdf: number[]; sf: number[]; complete_support: boolean }
  oc_curve: { fraction_defective: number[]; probability_accept: number[] }
  risk_points: { quality: string; requested_fraction_defective: number; fraction_defective: number; risk: number; probability_accept: number }[]
}
export interface SequentialRequest {
  alpha: number; beta: number; horizon: number; terminal_rule: TerminalRule
  good_probability?: number; bad_probability?: number; outcomes?: number[]
  good_mtbf?: number; bad_mtbf?: number; failure_times?: number[]; observed_exposure?: number; simulations?: number; seed?: number
}
export interface SequentialResponse {
  model: 'bernoulli' | 'exponential'; good_value: number; bad_value: number; alpha: number; beta: number; horizon: number
  decision: string; stopping_time: number | null; ignored_observations: number; terminal_rule: TerminalRule
  boundaries: { samples?: number; time?: number; accept_at_most?: number | null; reject_at_least?: number | null; accept_boundary: number | null; reject_boundary: number }[]
  trace: { samples?: number; time?: number; defects?: number; failures?: number; log_likelihood_ratio: number; decision: string }[]
  oc_curve: { true_value: number; probability_accept: number; probability_reject: number; probability_inconclusive: number; expected_duration: number; accept_interval?: number[]; duration_interval?: number[] }[]
  operating_characteristics_method: string; assumptions: string[]
  risk_check: { nominal_producer_risk: number; nominal_consumer_risk: number; achieved_producer_risk: number; achieved_consumer_risk: number; inconclusive_at_good: number; inconclusive_at_bad: number }
}
export interface PhaseRow { phase: number; start_time: number; end_time: number; duration: number; start_mtbf: number; end_mtbf: number; average_mtbf: number; expected_failures: number; cumulative_expected_failures: number; basis: string }
export interface PhaseGrowthResponse extends GrowthPlanResponse {
  baseline: { basis: string; entered_mtbf: number; instantaneous_mtbf: number; conversion: string; provenance: string }
  phase_table: PhaseRow[]
}
const post = <T>(route: string, request: unknown) => api.post<T>(`/inference-tools/${route}`, request).then(r => r.data)
export const calculateMTBFInterval = (r: MTBFRequest) => post<MTBFResponse>('mtbf-interval', r)
export const calculateBinomialInterval = (r: BinomialRequest) => post<BinomialResponse>('binomial-interval', r)
export const calculateNormalInterval = (r: NormalRequest) => post<NormalResponse>('normal-mean-interval', r)
export const calculateDiscreteProbability = (r: DiscreteRequest) => post<DiscreteResponse>('discrete-probability', r)
export const calculateSequentialPlan = (model: 'bernoulli' | 'exponential', r: SequentialRequest) => post<SequentialResponse>(`${model}-sprt`, r)
export const calculatePhaseGrowth = (r: Record<string, unknown>) => post<PhaseGrowthResponse>('growth-plan', r)
