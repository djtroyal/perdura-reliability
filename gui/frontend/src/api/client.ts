import axios from 'axios'

// A finite timeout so a hung / unreachable backend surfaces as a clear error
// instead of spinning forever. Most endpoints respond in well under a second;
// the slowest (Fit_Everything on large data sets) still finishes within this.
export const api = axios.create({ baseURL: '/api', timeout: 60000 })

/** Monte-Carlo convergence diagnostic (running mean + 95% band vs n). */
export interface ConvergenceSeries {
  n: number[]; mean: number[]; ci_lower: number[]; ci_upper: number[]
}

// Normalize a timeout / network failure into a helpful message. We synthesize
// a `response.data.detail` so the many existing catch blocks (which read
// `err.response?.data?.detail`) surface it without any per-call-site changes.
api.interceptors.response.use(
  r => r,
  err => {
    if (!err.response) {
      const detail =
        err.code === 'ECONNABORTED' || err.message?.includes('timeout')
          ? 'The request timed out — the analysis backend may not be running. '
            + 'Start it with "bash gui/start.sh" and try again.'
          : 'Could not reach the analysis backend. Make sure it is running '
            + '(bash gui/start.sh) at http://localhost:8000.'
      err.response = { data: { detail } }
    }
    return Promise.reject(err)
  },
)

// --- Life Data ---

export interface FitRequest {
  failures: number[]
  right_censored?: number[]
  distributions_to_fit?: string[]
  method?: string
  CI?: number
}

export interface FitDiagnostics {
  converged: boolean
  optimizer: string
  success?: boolean
  status?: number
  message?: string
  objective?: number | null
  gradient_finite?: boolean | null
  gradient_norm?: number | null
  raw_gradient_norm?: number | null
  boundary_parameters?: number[]
  warnings?: string[]
  attempts?: FitDiagnostics[]
  [key: string]: unknown
}

export interface FitResult {
  Distribution: string
  AICc: number | null
  BIC: number | null
  AD: number | null
  LogLik: number | null
  // Fitting method actually used (may fall back to MLE when the requested
  // rank-regression method has no linearizing paper, e.g. Gamma/Beta).
  method?: string | null
  // Parameter point estimates plus CI fields ({name}_lower/_upper/_se)
  params?: Record<string, number | null>
  converged: boolean
  fit_eligible: boolean
  aicc_eligible: boolean
  eligibility_reasons: string[]
  diagnostics?: FitDiagnostics | FitDiagnostics[] | null
  status: 'Eligible' | 'Ineligible'
  parameter_ci_method?: string | null
  function_ci_method?: string | null
  uncertainty_warnings?: string[]
}

export interface DistPlotData {
  probability?: {
    scatter_x: number[]
    scatter_y: number[]
    line_x: number[]
    line_y: number[]
    line_x_raw?: number[]
    line_lower?: number[]
    line_upper?: number[]
    x_label: string
    y_label: string
    sub_lines?: { proportion: number; line_y: number[] }[]
  }
  curves?: {
    x: number[]
    pdf: number[]
    cdf: number[]
    sf: number[]
    hf: number[]
    sf_lower?: number[]
    sf_upper?: number[]
    cdf_lower?: number[]
    cdf_upper?: number[]
  }
  qq?: { theoretical: number[]; sample: number[] }
  pp?: { empirical: number[]; fitted: number[] }
}

export interface FitResponse {
  results: FitResult[]
  best_distribution: string | null
  CI: number
  plots: Record<string, DistPlotData>
  available_distributions: string[]
}

export const fitDistributions = (req: FitRequest) =>
  api.post<FitResponse>('/life-data/fit', req).then(r => r.data)

/** Per-distribution progress of a streaming Fit_Everything run. */
export interface FitProgress { done: number; total: number; current?: string }

// Reject with the same shape axios errors have so the existing catch blocks
// (which read err.response?.data?.detail) work unchanged.
const fitStreamError = (detail: string) =>
  Object.assign(new Error(detail), { response: { data: { detail } } })

/**
 * Run /life-data/fit with live per-distribution progress.
 *
 * Streams NDJSON from POST /life-data/fit/stream ({type:'start'|'progress'|
 * 'result'|'error'} per line) and resolves with the same FitResponse as
 * fitDistributions. Falls back to the plain endpoint if streaming is
 * unavailable. An inactivity timeout (no bytes for 60s) mirrors the axios
 * timeout, since fetch has none of its own.
 */
export async function fitDistributionsWithProgress(
  req: FitRequest,
  onProgress?: (p: FitProgress) => void,
  signal?: AbortSignal,
): Promise<FitResponse> {
  let res: Response
  try {
    res = await fetch('/api/life-data/fit/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal,
    })
  } catch (e) {
    if (signal?.aborted) throw e
    return fitDistributions(req) // network-level failure -> plain endpoint decides
  }
  if (!res.ok || !res.body) return fitDistributions(req)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let timedOut = false
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const idle = () => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      timedOut = true
      reader.cancel().catch(() => {})
    }, 60000)
  }
  try {
    idle()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      idle()
      buffer += decoder.decode(value, { stream: true })
      let nl
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        const msg = JSON.parse(line)
        if (msg.type === 'progress') {
          onProgress?.({ done: msg.done, total: msg.total, current: msg.current })
        } else if (msg.type === 'result') {
          return msg.payload as FitResponse
        } else if (msg.type === 'error') {
          throw fitStreamError(msg.detail || 'Error running analysis.')
        }
      }
    }
    throw fitStreamError(timedOut
      ? 'The request timed out — the analysis backend may not be running. '
        + 'Start it with "bash gui/start.sh" and try again.'
      : 'The analysis stream ended unexpectedly — the backend may have restarted.')
  } finally {
    clearTimeout(idleTimer)
  }
}

// /fit returns plot arrays only for the best distribution; the rest are
// fetched on demand when the user selects them in the results table.
export const fetchDistPlot = (req: {
  failures: number[]
  right_censored?: number[]
  distribution: string
  method?: string
  CI?: number
}) => api.post<{ distribution: string; plot: DistPlotData }>('/life-data/plot', req).then(r => r.data)

export interface NonparametricRequest {
  failures: number[]
  right_censored?: number[]
  method?: string
  CI?: number
}

export interface NonparametricResponse {
  method: string
  time: number[]
  SF: number[]
  CHF?: number[]
  CI_lower: number[]
  CI_upper: number[]
}

export const fitNonparametric = (req: NonparametricRequest) =>
  api.post<NonparametricResponse>('/life-data/nonparametric', req).then(r => r.data)

export const getDistributions = () =>
  api.get<{ distributions: string[] }>('/life-data/distributions').then(r => r.data)

// --- Distribution spec / Monte Carlo / folio comparison ---

export interface GenerateRequest {
  distribution: string
  params: Record<string, number>
  n: number
  seed?: number
}

export const generateSamples = (req: GenerateRequest) =>
  api.post<{ distribution: string; samples: number[] }>('/life-data/generate', req)
    .then(r => r.data)

// --- Equation-based Monte Carlo ---

export interface MCEquationVariable {
  name: string
  distribution: string
  params: Record<string, number>
}

export interface MCEquationRequest {
  variables: MCEquationVariable[]
  equation: string
  n: number
  seed?: number
}

export interface MCEquationResponse {
  samples: number[]
  n_total: number
  n_valid: number
  n_invalid: number
  stats: {
    mean: number; std: number; min: number; max: number
    p1: number; p5: number; p10: number; p25: number; p50: number
    p75: number; p90: number; p95: number; p99: number
  }
  histogram: { counts: number[]; edges: number[] }
  variables: { name: string; distribution: string; stats: { mean: number; std: number } }[]
  convergence?: ConvergenceSeries | null
}

export const generateMCEquation = (req: MCEquationRequest) =>
  api.post<MCEquationResponse>('/life-data/mc-equation', req).then(r => r.data)

export interface SpecCurvesResponse {
  distribution: string
  curves: { x: number[]; pdf: number[]; cdf: number[]; sf: number[]; hf: number[] }
  stats: { mean: number | null; median: number | null; std: number | null }
}

export const getSpecCurves = (distribution: string, params: Record<string, number>) =>
  api.post<SpecCurvesResponse>('/life-data/spec-curves', { distribution, params })
    .then(r => r.data)

export const evaluateDistribution = (
  distribution: string, params: Record<string, number>, t: number,
) =>
  api.post<{ distribution: string; t: number; sf: number; cdf: number; pdf: number; hf: number }>(
    '/life-data/evaluate', { distribution, params, t }).then(r => r.data)

export interface CalculatorResponse {
  distribution: string
  mean_life: number | null
  reliability?: number
  prob_failure?: number
  pdf?: number | null
  failure_rate?: number | null
  conditional_reliability?: number | null
  conditional_prob_failure?: number | null
  reliable_life?: number | null
  bx_life?: number | null
  bx_percent?: number
}
export const calculateMetrics = (req: {
  distribution: string; params: Record<string, number>
  mission_end?: number | null; elapsed?: number | null
  reliability_target?: number | null; bx_percent?: number | null
}) => api.post<CalculatorResponse>('/life-data/calculate', req).then(r => r.data)

export interface CompareRequest {
  folios: { name: string; failures: number[]; right_censored?: number[] }[]
  distribution: string
  CI: number
}

export interface ContourData {
  x_name: string
  y_name: string
  x: number[]
  y: number[]
  nll: (number | null)[][]
  level: number
  point: [number | null, number | null]
}

export interface CompareResponse {
  distribution: string
  CI: number
  param_names: string[]
  folios: {
    name: string
    n_failures: number
    n_censored: number
    log_likelihood: number | null
    AICc: number | null
    params: Record<string, number | null>
    contour: ContourData | null
    curves?: { x: number[]; pdf: number[]; cdf: number[]; sf: number[]; hf: number[] } | null
    pp?: { theoretical: number[]; empirical: number[] } | null
    qq?: { theoretical: number[]; empirical: number[] } | null
  }[]
  lr_test: {
    statistic: number
    df: number
    p_value: number
    pooled_log_likelihood: number | null
    separate_log_likelihood: number
    alpha: number
    different: boolean
  } | null
}

export const compareFolios = (req: CompareRequest) =>
  api.post<CompareResponse>('/life-data/compare', req).then(r => r.data)

// Special Weibull models (mixture / competing risks / DSZI / grouped)
export interface SpecialModelRequest {
  model: string
  failures: number[]
  right_censored?: number[] | null
  failure_quantities?: number[] | null
  right_censored_quantities?: number[] | null
  CI?: number
  n_subpopulations?: number
}
export interface SubCurve {
  eta: number; beta: number; proportion: number
  sf: number[]; pdf: number[]; cdf: number[]
}
export interface SpecialModelResponse {
  model: string
  params: { name: string; value: number; std_error?: number | null; lower_ci?: number | null; upper_ci?: number | null }[]
  loglik: number | null
  AICc: number | null
  BIC: number | null
  curves: { x: number[]; sf?: number[]; cdf?: number[]; pdf?: number[]; hf?: number[] }
  sub_curves?: SubCurve[]
  probability?: {
    scatter_x: number[]
    scatter_y: number[]
    line_x: number[]
    line_y: number[]
    line_x_raw?: number[]
    line_lower?: number[]
    line_upper?: number[]
    x_label: string
    y_label: string
    sub_lines?: { proportion: number; line_y: number[] }[]
  }
  converged: boolean
  identifiable: boolean
  fit_eligible: boolean
  aicc_eligible: boolean
  eligibility_reasons: string[]
  diagnostics?: FitDiagnostics | null
  identifiability_diagnostics?: Record<string, unknown> | null
  parameter_ci_method?: string | null
  uncertainty_warnings?: string[]
}
export const fitSpecialModel = (req: SpecialModelRequest) =>
  api.post<SpecialModelResponse>('/life-data/special', req).then(r => r.data)

// Weibayes (#15)
export interface WeibayesRequest {
  failures: number[]
  right_censored?: number[]
  beta: number
  CI?: number
  uncertainty_method?: 'fixed' | 'sensitivity' | 'bayesian'
  beta_lower?: number
  beta_upper?: number
  beta_sd?: number
  n_beta_samples?: number
  seed?: number
}
export interface WeibayesResponse {
  beta: number
  eta: number | null
  eta_lower: number | null
  eta_upper: number | null
  r: number
  n_total: number
  sum_tb: number
  CI: number
  zero_failure: boolean
  beta_assumption: 'fixed' | 'uncertain'
  uncertainty_method: 'fixed' | 'sensitivity' | 'bayesian'
  conditional_interval_method: string
  response_contract_version: number
  migration_note: string
  eta_propagated_lower: number | null
  eta_propagated_upper: number | null
  beta_uncertainty: Record<string, unknown> | null
  probability?: {
    scatter_x: number[]
    scatter_y: number[]
    line_x: number[]
    line_y: number[]
    line_x_raw?: number[]
    line_lower?: number[]
    line_upper?: number[]
    x_label: string
    y_label: string
    sub_lines?: { proportion: number; line_y: number[] }[]
  } | null
  curves: {
    x: number[]
    sf: number[]
    cdf: number[]
    pdf: number[]
    hf: number[]
    sf_lower: (number | null)[]
    sf_upper: (number | null)[]
    sf_legacy_lower_was_optimistic?: (number | null)[]
    sf_legacy_upper_was_conservative?: (number | null)[]
    sf_propagated_lower?: (number | null)[] | null
    sf_propagated_upper?: (number | null)[] | null
    cdf_lower?: (number | null)[]
    cdf_upper?: (number | null)[]
  }
}
export const fitWeibayes = (req: WeibayesRequest) =>
  api.post<WeibayesResponse>('/life-data/weibayes', req).then(r => r.data)

export interface CalibratedUncertaintyRequest {
  distribution: string
  failures: number[]
  right_censored?: number[]
  target: 'reliability' | 'quantile' | 'median' | 'mean'
  target_value?: number
  method: 'profile_likelihood' | 'parametric_bootstrap'
  CI?: number
  n_bootstrap?: number
  seed?: number
}

export interface CalibratedInterval {
  method: string
  target: string
  target_value: number | null
  estimate: number
  lower: number | null
  upper: number | null
  CI: number
  complete?: boolean
  n_requested?: number
  n_successful?: number
  success_rate?: number
  [key: string]: unknown
}

export interface CalibratedUncertaintyResponse {
  distribution: string
  interval: CalibratedInterval
  reference_interval: {
    parameter_method: string | null
    function_method: string | null
    warnings: string[]
  }
}

export const calculateCalibratedUncertainty = (req: CalibratedUncertaintyRequest) =>
  api.post<CalibratedUncertaintyResponse>('/life-data/uncertainty', req).then(r => r.data)

// --- Competing Failure Modes ---

export interface CFMItem {
  time: number
  mode: string
  state: string
}

export interface CFMRequest {
  items: CFMItem[]
  distribution: string
  method: string
  CI: number
  reliability_time?: number | null
}

export interface CFMModeResult {
  mode: string
  n_failures: number
  n_suspensions: number
  error?: string
  params: Record<string, number | null>
  gof: Record<string, number | null>
  probability_plot?: {
    scatter_x: number[]
    scatter_y: number[]
    line_x: number[]
    line_y: number[]
    line_x_raw?: number[]
    x_label: string
    y_label: string
  } | null
  curves?: {
    x: number[]
    pdf: number[]
    cdf: number[]
    sf: number[]
    hf: number[]
  } | null
}

export interface CFMResponse {
  distribution: string
  method: string
  CI: number
  modes: CFMModeResult[]
  system_curves?: {
    x: number[]
    system_sf: number[]
    system_cdf: number[]
    system_pdf?: number[]
    system_hf?: number[]
    mode_sf: Record<string, number[]>
    mode_cdf?: Record<string, number[]>
    mode_pdf?: Record<string, number[]>
    mode_hf?: Record<string, number[]>
  } | null
  system_reliability_at_t?: {
    time: number
    system_reliability: number
    system_unreliability: number
    mode_reliability: Record<string, number>
  } | null
}

export const fitCompetingFailureModes = (req: CFMRequest) =>
  api.post<CFMResponse>('/life-data/competing-failure-modes', req).then(r => r.data)

export interface CFMMonteCarloRequest {
  distribution: string
  modes: { mode: string; params: Record<string, number | null> }[]
  n_samples: number
  seed?: number | null
  time_horizon?: number | null
}

export interface CFMMonteCarloRow {
  unit: number
  time: number
  mode: string
  state: string
}

export interface CFMMonteCarloResponse {
  n_samples: number
  distribution: string
  modes: string[]
  time_horizon?: number | null
  n_censored?: number
  n_failed?: number
  rows: CFMMonteCarloRow[]
  summary: Record<string, { n_failures: number; n_suspensions: number; mean_failure_time: number | null }>
  convergence?: ConvergenceSeries | null
}

export const cfmMonteCarlo = (req: CFMMonteCarloRequest) =>
  api.post<CFMMonteCarloResponse>('/life-data/cfm-monte-carlo', req).then(r => r.data)

// --- Reliability Testing tools ---

export const oneSampleProportion = (req: { trials: number; successes: number; CI?: number }) =>
  api.post<{ proportion: number; lower: number; upper: number; trials: number; successes: number; CI: number }>(
    '/alt/one-sample-proportion', req).then(r => r.data)

export const twoProportionTest = (req: {
  trials_1: number; successes_1: number; trials_2: number; successes_2: number; CI?: number
}) => api.post<{ p1: number; p2: number; difference: number; z: number; p_value: number; different: boolean; CI: number }>(
  '/alt/two-proportion-test', req).then(r => r.data)

export const sampleSizeNoFailures = (req: {
  reliability: number; CI?: number; lifetimes?: number; weibull_shape?: number
}) => api.post<{ n: number; reliability: number; CI: number; lifetimes: number; weibull_shape: number }>(
  '/alt/sample-size-no-failures', req).then(r => r.data)

export interface SequentialSamplingResponse {
  n: number[]; acceptance_line: (number | null)[]; rejection_line: number[]
  slope: number; intercept_accept: number; intercept_reject: number
}
export const sequentialSampling = (req: {
  p1: number; p2: number; alpha?: number; beta?: number; max_samples?: number
}) => api.post<SequentialSamplingResponse>('/alt/sequential-sampling', req).then(r => r.data)

export const testPlanner = (req: {
  MTBF?: number | null; test_duration?: number | null; number_of_failures?: number | null
  CI?: number; two_sided?: boolean
}) => api.post<{ MTBF: number; test_duration: number; number_of_failures: number; CI: number }>(
  '/alt/test-planner', req).then(r => r.data)

export const testDuration = (req: {
  MTBF_required: number; MTBF_design: number; consumer_risk?: number; producer_risk?: number
}) => api.post<{ test_duration: number; number_of_failures: number; MTBF_required: number; MTBF_design: number; consumer_risk: number; producer_risk: number }>(
  '/alt/test-duration', req).then(r => r.data)

export interface GoodnessOfFitResponse {
  statistic: number; critical_value: number; p_value: number
  hypothesis: string; CI: number; test: string; distribution: string
  bins?: number; df?: number
  requested_bins?: number
  bins_merged?: boolean
  minimum_expected_count?: number
  calibration_method: string
  n_bootstrap: number
  successful_bootstrap_refits: number
  failed_bootstrap_refits: number
  null_hypothesis: string
}
export const goodnessOfFit = (req: {
  failures: number[]; distribution?: string; test?: string; CI?: number
  bins?: number; min_expected?: number; n_bootstrap?: number; seed?: number
}) => api.post<GoodnessOfFitResponse>('/alt/goodness-of-fit', req).then(r => r.data)

// --- ALT ---

export interface ALTFitRequest {
  failures: number[]
  failure_stress: number[]
  right_censored?: number[]
  right_censored_stress?: number[]
  use_level_stress?: number
  models_to_fit?: string[]
  sort_by?: string
  uncertainty_method?: 'delta' | 'parametric_bootstrap'
  uncertainty_CI?: number
  n_bootstrap?: number
  seed?: number | null
}

export interface ALTLifeStressPlot {
  line_stress: number[]
  line_life: (number | null)[]
  scatter_stress: number[]
  scatter_life: number[]
  use_level_stress: number | null
  use_level_life: number | null
}

export interface ALTModelDetails {
  a: number | null
  b: number | null
  c: number | null
  shape: number | null
  shape_label: string | null
  use_level_stress: number | null
  life_b10: number | null
  life_b50: number | null
  life_mean: number | null
  /** Delta-method 95% CI on the use-level median life. */
  life_b50_lower?: number | null
  life_b50_upper?: number | null
  delta_interval?: ALTUseLifeInterval | null
  bootstrap_interval?: ALTUseLifeInterval | null
  stress_design?: ALTStressDesignDiagnostic | null
  physical_constraint?: { passed: boolean; expected: string; assumption: string } | null
  common_shape?: ALTCommonShapeDiagnostic | null
}

export interface ALTUseLifeInterval {
  method: string; status: string; CI: number
  requested?: number; successful?: number; failed?: number
  lower: number | null; upper: number | null; median?: number | null
  warning?: string; reason?: string; conditional_on?: string
}

export interface ALTStressDesignDiagnostic {
  stress_model: string
  n_observations: number
  n_unique_stress_combinations: number
  rank: number; required_rank: number; full_rank: boolean
  scaled_condition_number: number
  ill_conditioned: boolean
  tested_range: { minimum: number; maximum: number }[]
  use_level: null | {
    position: string | string[]
    is_extrapolation: boolean
    normalized_distance_outside_range: number | number[]
    leverage: number
    average_training_leverage: number
    leverage_ratio: number | null
  }
}

export interface ALTCommonShapeDiagnostic {
  status: string; reason?: string
  null_hypothesis?: string; statistic?: number; degrees_of_freedom?: number
  p_value?: number; reject_common_shape: boolean; calibration?: string
  interpretation?: string
}

export interface ALTModelDiagnostics {
  optimizer: FitDiagnostics | FitDiagnostics[] | null
  stress_design: ALTStressDesignDiagnostic | null
  physical_constraint: { passed: boolean; expected: string; assumption: string } | null
  common_shape: ALTCommonShapeDiagnostic | null
}

export interface ALTFitResponse {
  results: Record<string, unknown>[]
  best_model: string | null
  life_stress_plot: ALTLifeStressPlot | null
  /** Life-stress plot per fitted model, keyed by model name (the same names in
   *  the results table's "Model" column). Lets the user click through models. */
  life_stress_plots?: Record<string, ALTLifeStressPlot | null>
  /** Per-model parameters + life-at-use-stress metrics, keyed by model name. */
  model_details?: Record<string, ALTModelDetails>
  model_diagnostics?: Record<string, ALTModelDiagnostics | null>
  analysis_diagnostics?: {
    tested_stress_range: { minimum: number; maximum: number }
    use_stress: null | { stress: number; position: string; is_extrapolation: boolean; tested_minimum: number; tested_maximum: number }
    common_shape_scope: string
    physical_direction_assumption: string
    uncertainty_method_requested: string
  }
  available_models: string[]
}

export const fitALT = (req: ALTFitRequest) =>
  api.post<ALTFitResponse>('/alt/fit', req).then(r => r.data)

export const getALTModels = () =>
  api.get<{ models: string[] }>('/alt/models').then(r => r.data)

// --- Reliability Demonstration Test (sample size) ---

export interface SampleSizeRequest {
  method: 'nonparametric' | 'parametric_samples' | 'parametric_time'
  failures: number
  R: number
  CI: number
  mission_time?: number
  beta?: number
  test_time?: number
  n?: number
  options_table?: boolean
  oc_curve?: boolean
  curves?: boolean
}

export interface SampleSizeResponse {
  method: string
  failures: number
  R: number
  CI: number
  n: number | null
  test_time: number | null
  eta: number | null
  R_test: number | null
  options_table?: { f: number; n?: number | null; test_time?: number | null }[]
  oc_curve?: { R: number[]; P_accept: number[]; R_demonstrated: number; alpha: number }
  requirement_curve?: {
    R: number[]
    y_label: string
    curves: { f: number; values: (number | null)[] }[]
  }
  tradeoff_curve?: {
    test_time: number[]
    curves: { f: number; n: (number | null)[] }[]
  }
}

export const computeSampleSize = (req: SampleSizeRequest) =>
  api.post<SampleSizeResponse>('/alt/sample-size', req).then(r => r.data)

// --- Failure Rate Prediction (MIL-HDBK-217F / VITA 51.1) ---

export type PredictionParamValue = string | number | [number, number][]

export interface PredictionPart {
  category: string
  name?: string
  // free-text user notes about this part (not used in the calculation)
  notes?: string
  quantity: number
  params: Record<string, PredictionParamValue>
  // ANSI/VITA 51.1 supplement: null/undefined = inherit global, else override
  apply_vita?: boolean | null
  // Per-part environment override: null/undefined = inherit from block/global
  environment?: string | null
  // frontend-only: containing system block id (null/undefined = root level)
  parentId?: string | null
}

export interface PredictionRequest {
  environment: string
  vita_global: boolean
  parts: PredictionPart[]
}

export interface PredictionResult {
  name: string
  category: string
  quantity: number
  multiplier: number
  failure_rate: number
  total_failure_rate: number
  contribution: number
  pi_factors: Record<string, number | string | boolean>
  traceability?: {
    standard: string
    section: string
    handbook_pages: string
    model: string
    equation: string
    unit: string
  }
  calculation_steps?: {
    symbol: string
    description: string
    expression: string
    /** Model-authored display equation; preferred over parsing plain metadata. */
    expression_latex?: string
    substitution: string
    value: number | string
    unit: string
  }[]
  assumptions?: string[]
  warnings?: string[]
  vita: boolean
  // Present only when VITA 51.1 is applied: the unadjusted MIL-HDBK-217F values
  base_pi_factors?: Record<string, number | string | boolean>
  base_failure_rate?: number
  base_total_failure_rate?: number
  // Set when a part could not be computed under the selected standard (#3).
  incompatible?: boolean
  error?: string
}

export interface IncompatiblePart {
  index: number
  name: string
  category: string
  error: string
}

export interface MethodologyDisclosure {
  standard_id: string
  edition: string
  authority: string
  method_scope: string
  implementation_scope: string
  known_exclusions: string
  conformance_tier: 'verified' | 'partial' | 'screening' | 'custom'
  clause_coverage: string[]
  source: { title: string; url: string | null; access: string }
  authoritative_example_validation: {
    status: string; passed: number; total: number; note: string
  }
  reviewed_on: string
  full_conformance_claimed: boolean
  tier_definition: { label: string; meaning: string; contract_use: string }
}

export interface PredictionResponse {
  standard: string
  environment: string
  vita_global: boolean
  total_failure_rate: number
  mtbf_hours: number | null
  results: PredictionResult[]
  /** Parts that could not be computed under the selected standard (#3). */
  incompatible?: IncompatiblePart[]
  methodology: MethodologyDisclosure
  methodology_supplements?: MethodologyDisclosure[]
  warnings?: string[]
}

export const predictFailureRate = (req: PredictionRequest) =>
  api.post<PredictionResponse>('/prediction/predict', req).then(r => r.data)

export const getPredictionOptions = () =>
  api.get<{
    environments: { code: string; description: string }[]
    standards: string[]
    categories: string[]
  }>('/prediction/options').then(r => r.data)

export interface PartsCountCatalogEntry {
  key: string
  label: string
  section: string
  family: string
  quality_options: string[]
  quality_factors: Record<string, number>
  default_quality: string
  learning_factor: boolean
}

export const getPartsCountCatalog = () =>
  api.get<{
    standard: string
    method: string
    parts: PartsCountCatalogEntry[]
  }>('/prediction/parts-count-catalog').then(r => r.data)

// --- System Reliability ---

export interface RBDNode {
  id: string
  type: string
  data?: Record<string, unknown>
}

export interface RBDEdge {
  source: string
  target: string
}

export interface RBDImportance {
  id: string
  label: string
  reliability: number
  Birnbaum: number
  Criticality: number | null
  RAW: number | null
  RRW: number | null
  RRW_unbounded?: boolean
  kind?: 'component_specific' | 'common_cause_survival'
  modeled_variable_reliability?: number
}

export interface DependencyDiagnostics {
  model: 'independent' | 'beta_factor'
  assumption: string
  limitations: string
  groups: {
    group_id: string
    members: string[]
    member_count: number
    beta: number
    common_cause_probability: number
    individual_failure_probability: number
    requested_marginal_probability: number
    reconstructed_marginal_probabilities: number[]
  }[]
}

export interface RBDResponse {
  system_reliability: number
  system_unreliability: number
  path_sets: string[][]
  components: { id: string; label: string; reliability: number }[]
  importance?: RBDImportance[]
  importance_definitions?: Record<string, string>
  path_sets_truncated?: boolean
  display_path_limit?: number
  dependency_model?: DependencyDiagnostics
  assumptions?: string[]
  computation?: {
    engine: string
    exact: boolean
    states_evaluated: number
    variables: number
    path_enumeration_used_for_probability: boolean
    display_paths_returned?: number
    display_paths_truncated?: boolean
  }
}

export const computeRBD = (nodes: RBDNode[], edges: RBDEdge[]) =>
  api.post<RBDResponse>('/system/rbd', { nodes, edges }).then(r => r.data)

// --- Fault Tree ---

export interface FTNode {
  id: string
  type: string
  data: Record<string, unknown>
}

export interface FTEdge {
  source: string
  target: string
}

export interface FTCutSetFormula {
  events: string[]
  formula: string
  value: number | null
}

export interface FaultTreeResponse {
  top_event_probability: number
  minimal_cut_sets: string[][]
  importance: {
    event: string
    Birnbaum: number
    'Fussell-Vesely': number
    RAW: number | null
    RRW: number | null
  }[]
  methods?: Record<string, number | null>
  simulation?: {
    probability: number
    std_error: number
    ci_lower: number
    ci_upper: number
    n_samples: number
    top_event_count?: number
    confidence_level?: number
    interval_method?: string
    resolution_limit?: number
    zero_event_upper_bound?: number | null
  }
  formulas?: {
    boolean_expression: string
    probability_expression: string
    cut_sets: FTCutSetFormula[]
  }
  dependency_model?: DependencyDiagnostics
  assumptions?: string[]
  computation?: {
    exact_engine: {
      engine: string
      exact: boolean
      states_evaluated: number
      cache_hits: number
      variables: number
      terms: number
      max_states: number
    } | null
    minimal_cut_set_count: number
    basic_latent_event_count: number
  }
}

export interface FaultTreeGraph {
  nodes: FTNode[]
  edges: FTEdge[]
}

export interface AnalyzeFaultTreeOptions {
  exposureTime?: number | null
  methods?: string[]
  nSimulations?: number
  seed?: number | null
  trees?: Record<string, FaultTreeGraph>
  treeId?: string | null
}

export const analyzeFaultTree = (
  nodes: FTNode[], edges: FTEdge[], opts: AnalyzeFaultTreeOptions = {},
) =>
  api.post<FaultTreeResponse>('/fault-tree/analyze', {
    nodes,
    edges,
    exposure_time: opts.exposureTime ?? null,
    methods: opts.methods,
    n_simulations: opts.nSimulations,
    seed: opts.seed ?? null,
    trees: opts.trees,
    tree_id: opts.treeId ?? null,
  }).then(r => r.data)

// --- Stress-Strength Interference ---

export interface StressStrengthResponse {
  probability_of_failure: number
  reliability: number
  curves: { x: number[]; stress_pdf: number[]; strength_pdf: number[] }
}

export const computeStressStrength = (req: {
  stress_distribution: string; stress_params: Record<string, number>
  strength_distribution: string; strength_params: Record<string, number>
}) => api.post<StressStrengthResponse>('/life-data/stress-strength', req).then(r => r.data)

// --- ALT Acceleration Factor ---

export interface AccelerationFactorResponse {
  model: string
  stress_test: number
  stress_use: number
  acceleration_factor: number
}

export const computeAccelerationFactor = (req: {
  model: string; stress_test: number; stress_use: number; params: Record<string, number>
}) => api.post<AccelerationFactorResponse>('/alt/acceleration-factor', req).then(r => r.data)

export interface PassProbResponse {
  test_duration: number
  allowable_failures: number
  true_mtbf: number
  lambda: number
  p_pass: number
  oc_curve: { mtbf: number[]; p_pass: (number | null)[] } | null
}

export const computePassProbability = (req: {
  test_duration: number; allowable_failures: number; true_mtbf: number
  oc_mtbf_min?: number; oc_mtbf_max?: number; oc_points?: number
}) => api.post<PassProbResponse>('/alt/pass-probability', req).then(r => r.data)

// --- ALT test types: step-stress, HALT, margin, multi-stress ---

export interface GoF {
  AICc: number | null
  BIC: number | null
  AD: number | null
  LogLik: number | null
}

export interface DistFit {
  distribution: string
  params: Record<string, number>
  curve_x: number[]
  pdf: number[]
  cdf: number[]
  summary: { mean: number | null; median: number | null; B10: number | null; B50: number | null }
  reliability?: { time: number; R: number; F: number }
  gof?: GoF
  comparison?: ({ distribution: string } & GoF)[]
  fit_method?: string
  observation_counts?: { exact: number; interval: number; right_censored: number; total: number }
  converged?: boolean
  fit_eligible?: boolean
  aicc_eligible?: boolean
  fit_diagnostics?: FitDiagnostics
}

export interface DegradationResponse {
  paths: { unit_id: string; t: number[]; m: number[]; fit_t: number[] | null; fit_m: number[] | null }[]
  threshold: number
  threshold_direction: string
  degradation_model: string
  projected_failure_times: number[]
  distribution_fit: DistFit | null
  distribution_fit_error: string | null
  life_data_summary: {
    exact: number; interval: number; right_censored: number
    total_units_used: number; units_dropped: number
    interval_sources: { observed_threshold_crossing: number }
  }
  projection_uncertainty: {
    method: 'delta_method'; confidence_level: number
    intervals_available: number; likelihood_role: 'display_only'
  }
  unit_table: {
    unit_id: string; projected_failure: number | null
    projection_lower: number | null; projection_upper: number | null
    inspection_lower: number | null; inspection_upper: number | null
    censor_time: number | null
    life_observation: 'projected_exact' | 'interval_censored' | 'right_censored' | 'unusable'
    interval_source: 'observed_threshold_crossing' | null
    a: number | null; b: number | null; r2: number | null
  }[]
}

export const degradationAnalysis = (req: {
  unit_ids: string[]; times: number[]; measurements: number[]
  threshold: number; threshold_direction: string
  degradation_model: string; life_distribution: string
  reliability_time?: number | null
  ci?: number
}) => api.post<DegradationResponse>('/alt/degradation', req).then(r => r.data)

export interface DestructiveDegradationResponse {
  measurement_distribution: string
  degradation_model: string
  threshold: number
  threshold_direction: string
  model_params: Record<string, number>
  shape: number | null
  shape_label: string | null
  loglik: number
  scatter: { t: number[]; y: number[] }
  degradation_curve: { t: number[]; median: number[] }
  reliability_curve: { t: number[]; R: number[] }
  reliability?: { time: number; R: number; F: number }
}

export const destructiveDegradationAnalysis = (req: {
  times: number[]; measurements: number[]
  threshold: number; threshold_direction: string
  degradation_model: string; measurement_distribution: string
  reliability_time?: number | null
}) => api.post<DestructiveDegradationResponse>('/alt/degradation-destructive', req).then(r => r.data)

// --- Reliability Demonstration Testing (RDT) ---

export interface ExpChiSquaredResponse {
  metric: string; confidence: number; failures: number
  chi_squared: number; accumulated_test_time: number; implied_mttf: number
  sample_size?: number; test_time?: number
}

export const rdtExponentialChiSquared = (req: {
  metric: string; reliability?: number; demo_time?: number; mttf?: number
  confidence: number; failures: number; solve_for: string
  n?: number | null; test_time?: number | null
}) => api.post<ExpChiSquaredResponse>('/alt/rdt/exponential-chi-squared', req).then(r => r.data)

export interface BayesianRDTResponse {
  prior_source: string; E_R0: number; Var_R0: number
  alpha0: number; beta0: number; solve_for: string; failures: number
  n?: number; confidence?: number; reliability?: number
  sample_size?: number; posterior_alpha?: number; posterior_beta?: number
}

export const rdtBayesian = (req: {
  solve_for: string; reliability?: number; confidence?: number; failures: number
  n?: number | null; prior_source: string
  worst?: number | null; likely?: number | null; best?: number | null
  subsystems?: { name?: string; n: number; r: number }[] | null
}) => api.post<BayesianRDTResponse>('/alt/rdt/bayesian', req).then(r => r.data)

export interface ExpectedFailureTimesResponse {
  n: number; distribution: string; beta: number; eta: number; confidence: number
  rows: { order: number; low: number; median: number; high: number }[]
}

export const rdtExpectedFailureTimes = (req: {
  n: number; distribution: string; beta: number; eta: number; confidence: number
}) => api.post<ExpectedFailureTimesResponse>('/alt/rdt/expected-failure-times', req).then(r => r.data)

export interface DifferenceDetectionResponse {
  metric: string; confidence: number
  design1_beta: number; design2_beta: number
  values: number[]; test_times: number[]
  matrix: number[][]
  details: Record<string, {
    test_time: number
    design1: { value: number; lower: number; upper: number }
    design2: { value: number; lower: number; upper: number }
  }>
}

export const rdtDifferenceDetection = (req: {
  metric: string; confidence: number
  design1_beta: number; design1_n: number
  design2_beta: number; design2_n: number
  metric_min: number; metric_max: number; metric_increment: number
  test_times: number[]
}) => api.post<DifferenceDetectionResponse>('/alt/rdt/difference-detection-matrix', req).then(r => r.data)

export interface TestSimulationResponse {
  metric: string; n_valid: number; num_simulations: number
  mean: number; median: number; std: number; p5: number; p95: number
  prob_meet_target: number | null; target_value: number | null
  histogram: { counts: number[]; edges: number[] }
  convergence?: ConvergenceSeries | null
}

export const testSimulation = (req: {
  distribution: string; beta: number; eta: number; n: number
  test_duration?: number | null; num_simulations: number
  metric: string; target_time: number; target_value?: number | null
  seed?: number | null
}) => api.post<TestSimulationResponse>('/alt/test-simulation', req).then(r => r.data)

export interface StepStressResponse {
  exponent_p: number
  ref_stress: number
  equivalent_times: number[]
  step_exposure: {
    stress: number; duration: number; raw_start: number; raw_end: number
    acceleration_factor: number; equivalent_start: number; equivalent_end: number
  }[]
  distribution_fit: DistFit
  cumulative_plot: { time: number[]; cum_fraction: number[]; step_boundaries: number[] }
  use_level_stress: number | null
}

export const stepStressAnalysis = (req: {
  failure_times: number[]; stress_at_failure: number[]
  steps: { stress: number; duration: number }[]
  use_level_stress?: number | null; distribution: string
}) => api.post<StepStressResponse>('/alt/step-stress', req).then(r => r.data)

export interface HALTResponse {
  stress_type: string
  operating_limit: number | null
  destruct_limit: number | null
  spec_min: number | null
  spec_max: number | null
  operating_margin: number | null
  destruct_margin: number | null
  capability_plot: { levels: number[]; outcomes: string[] }
}

export const haltAnalysis = (req: {
  stress_levels: number[]; outcomes: string[]; stress_type: string
  spec_min?: number | null; spec_max?: number | null
}) => api.post<HALTResponse>('/alt/halt', req).then(r => r.data)

export interface MarginTestResponse {
  acceleration_factor: number
  equivalent_time_at_spec: number
  demonstrated_reliability: number
  reliability_lower_bound: number
  confidence: number
  mtbf_at_spec: number | null
  margin_ratio: number | null
}

export const marginTestAnalysis = (req: {
  n_units: number; n_failures: number; test_duration: number
  test_stress: number; spec_stress: number
  acceleration_factor?: number | null; confidence: number
}) => api.post<MarginTestResponse>('/alt/margin-test', req).then(r => r.data)

export interface MultiStressResponse {
  stress1_label: string
  stress2_label: string
  combo_table: { stress1: number; stress2: number; n: number; median_life: number; mean_life: number }[]
  scatter: { stress1: number[]; stress2: number[]; life: number[] }
  regression_coeffs: number[] | null
  use_level_life: number | null
  stress1_use: number | null
  stress2_use: number | null
  fit_eligible: boolean
  eligibility_reasons: string[]
  design_diagnostics: { rank: number; required_rank: number; full_rank: boolean; scaled_condition_number: number; n_unique_stress_combinations: number }
  physical_constraint: {
    passed: boolean
    stress1: { direction: string; coefficient: number; passed: boolean }
    stress2: { direction: string; coefficient: number; passed: boolean }
  }
  common_dispersion: { status: string; test?: string; p_value?: number; reject_common_dispersion: boolean; interpretation?: string; reason?: string }
  use_stress_diagnostics: null | {
    positions: string[]; inside_tested_convex_hull: boolean; is_extrapolation: boolean
    leverage: number; average_training_leverage: number; leverage_ratio: number
    tested_ranges: { minimum: number; maximum: number }[]
  }
  use_life_interval: ALTUseLifeInterval | null
  result_quality: string
}

export const multiStressAnalysis = (req: {
  failure_times: number[]; stress1: number[]; stress2: number[]
  stress1_use?: number | null; stress2_use?: number | null
  stress1_label: string; stress2_label: string
  stress1_direction?: 'increasing_damage' | 'decreasing_damage'
  stress2_direction?: 'increasing_damage' | 'decreasing_damage'
  CI?: number; n_bootstrap?: number; seed?: number | null
}) => api.post<MultiStressResponse>('/alt/multi-stress', req).then(r => r.data)

// --- Stress screening: ESS / HASS / Burn-in ---

export interface ESSResponse {
  screening_type: string
  screening_strength: number
  required: number | null
  required_label: string
  detected_defect_fraction: number
  residual_defect_fraction: number
  curve: { x: number[]; y: number[]; x_label: string; target: number }
}

export const essAnalysis = (req: {
  defect_rate: number; target_screening_strength: number; screening_type: string
  temp_range?: number | null; ramp_rate?: number | null; num_cycles?: number | null
  dwell_time?: number | null; grms?: number | null; vib_duration?: number | null
}) => api.post<ESSResponse>('/alt/ess', req).then(r => r.data)

export interface HASSResponse {
  precipitation_screen: {
    temp_low: number; temp_high: number; delta_t: number; vibration: number
    required_cycles: number | null; screening_strength: number
  }
  detection_screen: {
    temp_low: number; temp_high: number; delta_t: number; vibration: number
    duration: number; probability_of_detection: number
  }
  stress_levels: { operating: number[]; precipitation: number[]; destruct: number[] }
}

export const hassAnalysis = (req: {
  op_temp_low: number; op_temp_high: number
  destruct_temp_low: number; destruct_temp_high: number
  op_vib: number; destruct_vib: number
  target_precip_ss: number; detection_duration: number; use_mtbf: number
}) => api.post<HASSResponse>('/alt/hass', req).then(r => r.data)

export interface BurnInResponse {
  effective_burn_in_time: number
  survival_probability: number
  expected_failures: number
  post_burn_in_mean_residual_life: number
  post_burn_in_mtbf: number
  reliability_plot: { time: number[]; before: number[]; after: number[] }
  hazard_plot: { time: number[]; before: number[]; after: number[] }
}

export const burnInAnalysis = (req: {
  duration: number; beta: number; eta: number; n_units: number
  temperature?: number | null; acceleration_factor: number; use_temperature?: number | null
}) => api.post<BurnInResponse>('/alt/burn-in', req).then(r => r.data)

// --- Physics of Failure ---

export interface PoFUncertaintySpec {
  relative_sd: Record<string, number>
  samples?: number
  confidence?: number
  seed?: number | null
}

export interface PoFRequestOptions { uncertainty?: PoFUncertaintySpec | null }

export interface PoFAnalysisContract {
  result_quality: 'deterministic_only' | 'uncertainty_propagated'
  deterministic: Record<string, number>
  uncertainty: null | {
    method: string
    confidence: number
    requested_draws: number
    accepted_draws: number
    rejected_draws: number
    input_relative_sd: Record<string, number>
    sampling: string
    metrics: Record<string, {
      mean: number; median: number; standard_deviation: number
      lower: number; upper: number; valid_draws: number
    }>
  }
  units: Record<string, string>
  validity: { status: string; assumptions: string[]; warnings: string[] }
}

export interface SNCurveResponse {
  A: number; b: number; r_squared: number | null; endurance_limit: number
  b_se?: number | null; b_lower?: number | null; b_upper?: number | null
  extrapolation_warning?: string | null
  curve: { n: number[]; s: number[] }
  prediction: { cycles: number | null; stress: number | null } | null
  analysis: PoFAnalysisContract
}

export const computeSNCurve = (req: PoFRequestOptions & {
  stress_amplitude: number[]; cycles_to_failure: number[]
  stress_query?: number | null; life_query?: number | null
}) => api.post<SNCurveResponse>('/pof/sn-curve', req).then(r => r.data)

export interface StressStrainResponse {
  stress: number[]; strain_elastic: number[]; strain_plastic: number[]; strain_total: number[]
  E: number; K: number; n: number
  max_total_strain: number
  analysis: PoFAnalysisContract
}

export const computeStressStrain = (req: PoFRequestOptions & {
  E: number; K?: number; n?: number; sigma_y?: number | null; max_stress?: number | null
}) => api.post<StressStrainResponse>('/pof/stress-strain', req).then(r => r.data)

export interface CreepResponse {
  lmp: number; temperature_K: number; time_to_rupture: number; time_unit: string
  time_to_rupture_hours: number | null
  curve: { temperature_C: number[]; time: number[]; time_unit: string; time_hours: number[] | null }
  analysis: PoFAnalysisContract
}

export const computeCreepLife = (req: PoFRequestOptions & {
  temperature_C?: number; stress_MPa?: number; C?: number; lmp_coeffs?: number[]; time_unit?: string
}) => api.post<CreepResponse>('/pof/creep-life', req).then(r => r.data)

export interface DamageResponse {
  damage_fractions: number[]; total_damage: number
  remaining_life_fraction: number; failed: boolean
  nonlinear_damage: null | {
    model: string; damage: number; damage_path: number[]; reverse_order_damage: number
    sequence_effect: number; damage_exponents: number[]; failed: boolean; sequence_sensitive: boolean
  }
  model_comparison: { model: string; damage: number; failed: boolean; sequence_sensitive: boolean }[]
  analysis: PoFAnalysisContract
}

export const computeLinearDamage = (req: PoFRequestOptions & {
  stress_levels: number[]; cycles_applied: number[]; cycles_to_failure: number[]
  damage_exponents?: number[] | null
}) => api.post<DamageResponse>('/pof/linear-damage', req).then(r => r.data)

export interface FractureResponse {
  K_I: number; K_Ic: number; critical: boolean; critical_crack_length: number
  crack_growth_curve?: { a: number[]; cycles: number[] } | null
  cycles_to_critical?: number | null
  growth_critical_crack_length?: number | null
  cyclic_max_stress?: number | null
  plane_stress_plastic_zone?: number | null
  lefm_screen_passed?: boolean | null
  crack_growth_models?: Record<string, {
    cycles_to_critical: number
    curve: { a: number[]; cycles: number[] }
    C: number; m: number; gamma?: number; R?: number
  }> | null
  analysis: PoFAnalysisContract
}

export const computeFracture = (req: PoFRequestOptions & {
  sigma?: number; a?: number; Y?: number; K_Ic?: number
  C?: number; m?: number; a_initial?: number | null; delta_sigma?: number | null
  stress_ratio?: number | null
  walker_C?: number | null; walker_m?: number | null; walker_gamma?: number
  forman_C?: number | null; forman_m?: number | null
  yield_strength?: number | null; remaining_ligament?: number | null
}) => api.post<FractureResponse>('/pof/fracture', req).then(r => r.data)

export interface CoffinMansonResponse {
  transition_reversals: number; transition_cycles: number; transition_strain: number
  curve: {
    reversals: number[]; strain_elastic: number[]
    strain_plastic: number[]; strain_total: number[]
  }
  prediction: { strain_amplitude: number; reversals: number; cycles: number } | null
  analysis: PoFAnalysisContract
}

export const computeCoffinManson = (req: PoFRequestOptions & {
  E: number; sigma_f: number; b?: number; epsilon_f?: number; c?: number
  strain_query?: number | null
}) => api.post<CoffinMansonResponse>('/pof/coffin-manson', req).then(r => r.data)

export interface NorrisLandzbergResponse {
  acceleration_factor: number
  factor_dT: number; factor_frequency: number; factor_temperature: number
  T_max_use_K: number; T_max_test_K: number
  cycles_field?: number | null
  analysis: PoFAnalysisContract
}

export const computeNorrisLandzberg = (req: PoFRequestOptions & {
  dT_use?: number; dT_test?: number; f_use?: number; f_test?: number
  T_max_use?: number; T_max_test?: number; n?: number; m?: number; Ea?: number
  cycles_test?: number | null
}) => api.post<NorrisLandzbergResponse>('/pof/norris-landzberg', req).then(r => r.data)

export interface ElectromigrationResponse {
  mttf: number; time_unit: string; mttf_hours: number | null
  temperature_K: number
  curve_temperature: { temperature_C: number[]; mttf: number[]; mttf_hours: number[] | null }
  curve_current_density: { J: number[]; mttf: number[]; mttf_hours: number[] | null }
  analysis: PoFAnalysisContract
}

export const computeElectromigration = (req: PoFRequestOptions & {
  A?: number; J?: number; n?: number; Ea?: number; T?: number; time_unit?: string
}) => api.post<ElectromigrationResponse>('/pof/electromigration', req).then(r => r.data)

export interface PeckResponse {
  ttf_test: number; time_unit: string; ttf_test_hours: number | null
  temperature_K: number
  acceleration_factor?: number | null
  ttf_use?: number | null
  ttf_use_hours?: number | null
  curve: { RH: number[]; ttf: number[]; ttf_hours: number[] | null }
  analysis: PoFAnalysisContract
}

export const computePeck = (req: PoFRequestOptions & {
  A?: number; RH?: number; n?: number; Ea?: number; T?: number
  RH_use?: number | null; T_use?: number | null; time_unit?: string
}) => api.post<PeckResponse>('/pof/peck', req).then(r => r.data)

export interface ArrheniusResponse {
  acceleration_factor: number
  T_use_K: number; T_test_K: number
  life_use_hours?: number | null
  life_use?: number | null; life_unit?: string
  curve: { T_test_C: number[]; af: number[] }
  analysis: PoFAnalysisContract
}

export const computeArrhenius = (req: PoFRequestOptions & {
  Ea?: number; T_use?: number; T_test?: number; life_test?: number | null; life_unit?: string
}) => api.post<ArrheniusResponse>('/pof/arrhenius', req).then(r => r.data)

export interface EyringResponse {
  acceleration_factor: number
  T_use_K: number; T_test_K: number
  life_use_hours?: number | null
  life_use?: number | null; life_unit?: string
  curve: { T_test_C: number[]; af: number[] }
  analysis: PoFAnalysisContract
}

export const computeEyring = (req: PoFRequestOptions & {
  Ea?: number; T_use?: number; T_test?: number; n?: number; life_test?: number | null; life_unit?: string
}) => api.post<EyringResponse>('/pof/eyring', req).then(r => r.data)

export interface HallbergPeckResponse {
  acceleration_factor: number
  factor_humidity: number; factor_temperature: number
  T_use_K: number; T_test_K: number
  life_use_hours?: number | null
  life_use?: number | null; life_unit?: string
  curve: { RH_use: number[]; af: number[] }
  analysis: PoFAnalysisContract
}

export const computeHallbergPeck = (req: PoFRequestOptions & {
  Ea?: number; n?: number; RH_use?: number; RH_test?: number
  T_use?: number; T_test?: number; life_test?: number | null; life_unit?: string
}) => api.post<HallbergPeckResponse>('/pof/hallberg-peck', req).then(r => r.data)

export interface TDDBResponse {
  model: string
  acceleration_factor: number
  factor_field: number; factor_temperature: number
  T_use_K: number; T_test_K: number
  life_use_hours?: number | null
  life_use?: number | null; life_unit?: string
  curve: { E_use: number[]; af: number[] }
  analysis: PoFAnalysisContract
}

export const computeTDDB = (req: PoFRequestOptions & {
  model?: string; gamma?: number; Ea?: number; E_use?: number; E_test?: number
  T_use?: number; T_test?: number; life_test?: number | null; life_unit?: string
}) => api.post<TDDBResponse>('/pof/tddb', req).then(r => r.data)

export interface MeanStressResponse {
  method: string
  factor_of_safety: number
  safe: boolean
  Se: number
  strength_label: string
  strength_intercept: number
  operating_point: { sigma_m: number; sigma_a: number }
  failure_line: { sigma_m: number[]; sigma_a: number[] }
  model_comparison: { method: string; factor_of_safety: number; safe: boolean; strength_label: string; strength_intercept: number }[]
  failure_lines: Record<string, { sigma_m: number[]; sigma_a: number[] }>
  analysis: PoFAnalysisContract
}

export const computeMeanStress = (req: PoFRequestOptions & {
  method?: string; sigma_a?: number; sigma_m?: number
  Se?: number; Su?: number; Sy?: number
}) => api.post<MeanStressResponse>('/pof/mean-stress', req).then(r => r.data)

// --- Reliability Growth ---

export interface GrowthRequest {
  times: number[]
  T?: number | null
  model: string
}

export interface GrowthResponse {
  model: string
  beta?: number
  Lambda?: number
  alpha?: number
  A?: number
  r_squared?: number | null
  CvM?: number | null
  cvm_critical?: number
  fit_acceptable?: boolean
  beta_lower?: number | null
  beta_upper?: number | null
  mtbf_cumulative_lower?: number | null
  mtbf_cumulative_upper?: number | null
  mtbf_instantaneous_lower?: number | null
  mtbf_instantaneous_upper?: number | null
  ci_level?: number
  valid_growth_regime?: boolean
  regime_warning?: string | null
  interpretation?: { trend: string; detail: string }
  growth_rate: number
  mtbf_instantaneous: number | null
  mtbf_cumulative: number
  n_failures: number
  T: number
  failure_terminated?: boolean
  scatter: { t: number[]; n: number[] }
  model_curve: { t: number[]; n: number[] }
  mtbf_curve: { t: number[]; cumulative: number[]; instantaneous: (number | null)[] }
}

export const fitGrowth = (req: GrowthRequest) =>
  api.post<GrowthResponse>('/growth/fit', req).then(r => r.data)

// Optimal replacement time
export interface OptimalReplacementResponse {
  optimal_replacement_time: number | null
  min_cost: number
  corrective_only_cost_rate: number
  cost_PM_per_unit_time: number
  time: number[]
  cost: (number | null)[]
  q: number
  decision: 'preventive_replacement' | 'run_to_failure'
  finite_optimum: boolean
  decision_reason: string
  boundary_minimum: boolean
  search_expanded: boolean
  requested_t_max: number
  evaluated_t_max: number
}
export const optimalReplacementTime = (req: {
  cost_PM: number; cost_CM: number; weibull_alpha: number; weibull_beta: number; q: number
}) => api.post<OptimalReplacementResponse>('/growth/optimal-replacement', req).then(r => r.data)

// ROCOF (rate of occurrence of failures) + Laplace trend test
export interface ROCOFResponse {
  U: number
  z_crit: number
  p_value: number
  CI: number
  n_failures: number
  test_end: number
  failure_terminated: boolean
  trend: string
  ROCOF: number | null
  Lambda_hat: number | null
  Beta_hat: number | null
}
export const computeROCOF = (req: {
  times_between_failures?: number[] | null
  failure_times?: number[] | null
  test_end?: number | null
  CI?: number
}) => api.post<ROCOFResponse>('/growth/rocof', req).then(r => r.data)

// Mean Cumulative Function
export interface MCFResponse {
  nonparametric: {
    time: number[]; MCF: number[]; MCF_lower: number[]; MCF_upper: number[]
    variance: number[]; standard_error: number[]; at_risk: number[]
    events_at_time: number[]; CI: number
    variance_method: string; interval_method: string
    n_systems: number; n_events: number
    sparse_tail: boolean[]; tail_warning: string | null
    bootstrap: {
      samples: number; lower: number[]; upper: number[]
      standard_error: number[]; valid_replicates: number[]
      resampling_unit: string
    } | null
  }
  parametric: {
    alpha: number; beta: number; r_squared: number
    time: number[]; MCF: number[]; CI: number
  } | null
  trend?: { trend: string; detail: string }
}
export const computeMCF = (req: {
  data: number[][]; observation_ends: number[]; CI?: number; parametric?: boolean
  interval_method?: 'log_transformed' | 'cluster_bootstrap'
  bootstrap_samples?: number; seed?: number | null
}) =>
  api.post<MCFResponse>('/growth/mcf', req).then(r => r.data)

// ── Maintenance ──────────────────────────────────────────────────────────────

// Age vs block replacement-policy comparison
export interface PolicyResult {
  optimal_time: number | null
  min_cost: number
  pm_per_time: number | null
  cm_per_time: number | null
  time: number[]
  cost: (number | null)[]
  decision: 'preventive_replacement' | 'run_to_failure'
  finite_optimum: boolean
  decision_reason: string
  boundary_minimum: boolean
  search_expanded: boolean
}
export interface ReplacementPolicyResponse {
  age: PolicyResult
  block: PolicyResult
  corrective_only_cost: number
  mttf: number
  cheaper_policy: 'age' | 'block' | 'corrective'
  recommendation: string
  analysis_basis?: string
  maintenance_assumptions?: Record<string, string>
}
export const computeReplacementPolicy = (req: {
  cost_PM: number; cost_CM: number; weibull_alpha: number; weibull_beta: number
}) => api.post<ReplacementPolicyResponse>('/maintenance/replacement-policy', req).then(r => r.data)

// PM interval for a reliability target (MFOP)
export interface PMIntervalResponse {
  pm_interval: number
  target_reliability: number
  n_pm: number
  horizon: number
  mttf: number
  curve: { time: number[]; reliability_pm: number[]; reliability_none: number[] }
  analysis_basis?: string
  assumption_note?: string
}
export const computePMInterval = (req: {
  dist: string; dist_params: Record<string, number>
  target_reliability: number; horizon: number
}) => api.post<PMIntervalResponse>('/maintenance/pm-interval', req).then(r => r.data)

// Maintenance cost forecast over a horizon
export interface CostForecastResponse {
  policy: string
  interval: number | null
  expected_pm: number
  expected_cm: number
  total_cost: number
  cost_rate: number
  mttf: number
  time: number[]
  cumulative_cost: number[]
  analysis_basis?: string
  finite_horizon_transients_modeled?: boolean
  assumption_note?: string
}
export const computeCostForecast = (req: {
  policy: string; cost_PM: number; cost_CM: number
  weibull_alpha: number; weibull_beta: number; horizon: number; interval?: number | null
}) => api.post<CostForecastResponse>('/maintenance/cost-forecast', req).then(r => r.data)

export interface SimulationSummary {
  mean: number
  median: number
  lower: number
  upper: number
}
export interface VirtualAgeSimulationResponse {
  model: 'kijima_type_ii_virtual_age'
  analysis_basis: 'finite_horizon_monte_carlo'
  horizon: number
  repair_effectiveness: number
  preventive_effectiveness: number
  n_simulations: number
  CI: number
  failures: SimulationSummary
  preventive_actions: SimulationSummary
  total_cost: SimulationSummary
  availability: SimulationSummary
  downtime: SimulationSummary
  curve: {
    time: number[]
    mean_cumulative_failures: number[]
    lower_cumulative_failures: number[]
    upper_cumulative_failures: number[]
  }
  assumptions: string[]
}
export const simulateVirtualAgeMaintenance = (req: {
  weibull_alpha: number; weibull_beta: number; horizon: number
  preventive_interval?: number | null
  repair_effectiveness: number; preventive_effectiveness?: number | null
  cost_CM?: number; cost_PM?: number
  corrective_downtime?: number; preventive_downtime?: number
  n_simulations?: number; CI?: number; seed?: number | null
}) => api.post<VirtualAgeSimulationResponse>('/maintenance/virtual-age-simulation', req).then(r => r.data)

// Availability sensitivity (tornado + solve-for-target)
export interface AvailabilitySensitivityResponse {
  baseline_availability: number
  mean_down_time: number
  swing_pct: number
  tornado: { driver: string; low: number; high: number; range: number }[]
  solve: {
    target_availability: number
    max_down_time: number
    required_mttr: number
    achievable: boolean
  } | null
}
export const computeAvailabilitySensitivity = (req: {
  mtbf: number; mttr: number; admin_delay: number; logistics_delay: number
  swing_pct?: number; target_availability?: number | null
}) => api.post<AvailabilitySensitivityResponse>('/maintenance/availability-sensitivity', req).then(r => r.data)

// --- Warranty Analysis ---

export interface WarrantyConvertResponse {
  failures: number[]
  right_censored: number[]
  n_failures: number
  n_censored: number
  interval_failures?: { lower: number; upper: number; count: number; ship_lot: number; return_period: number }[]
  right_censored_groups?: { time: number; count: number; ship_lot: number }[]
  observation_model?: string
  legacy_exact_age_expansion_available?: boolean
  migration_note?: string
}

export interface WarrantyForecastRequest {
  quantities: number[]
  returns: (number | null)[][]
  n_forecast_periods: number
  distribution?: string
  fit_method?: string
  CI?: number
  n_parameter_draws?: number
  seed?: number
}

export interface WarrantyForecastResponse {
  distribution: string
  params: Record<string, number>
  n_failures: number
  n_censored: number
  forecast: number[][]
  totals: number[]
  failures: number[]
  right_censored: number[]
  interval_failures: { lower: number; upper: number; count: number; ship_lot: number; return_period: number }[]
  right_censored_groups: { time: number; count: number; ship_lot: number }[]
  observation_model: string
  legacy_exact_age_expansion_available: boolean
  migration_note: string
  fit: {
    method: string
    log_likelihood: number
    AIC: number
    BIC: number
    converged: boolean
    optimizer_message: string
    successful_starts: number
    parameter_interval_method: string
  }
  forecast_interval: {
    status: string
    method: string
    CI?: number
    requested?: number
    successful?: number
    lower?: number[]
    median?: number[]
    upper?: number[]
    conditional_on?: string
    excludes?: string
    reason?: string
  }
}

export const forecastWarrantyReturns = (req: WarrantyForecastRequest) =>
  api.post<WarrantyForecastResponse>('/warranty/forecast', req).then(r => r.data)


// --- Markov Chain Analysis ---

export interface MarkovStateInput {
  id: string
  name: string
  state_type: 'operational' | 'degraded' | 'failed'
  description: string
  /** Public-state holding-time model. Missing means exponential for old projects. */
  dwell_model?: 'exponential' | 'erlang'
  /** Erlang phase count; the effective shape is one for exponential states. */
  dwell_shape?: number
}

export interface MarkovTransitionInput {
  from_state: string
  to_state: string
  rate: number
  label: string
  /** Coefficient of variation for input-rate uncertainty propagation. */
  rate_cv?: number
  /** Optional cross-module link: the rate was pulled from a reliability source
   *  (a fitted exponential / predicted failure rate). UI-only; ignored by the API. */
  sourceId?: string
  sourceName?: string
}

export interface MarkovRequest {
  states: MarkovStateInput[]
  transitions: MarkovTransitionInput[]
  times?: number[]
  initial_state?: string
  uncertainty_samples?: number
  uncertainty_ci?: number
  uncertainty_seed?: number
}

export interface MarkovSystemParams {
  availability_ss: number | null
  unavailability_ss: number | null
  mttf: number | null
  mtbf: number | null
  mut: number | null
  mttr: number | null
  failure_frequency: number | null
  repair_frequency: number | null
}

export interface MarkovMetricInterval {
  lower: number
  median: number
  upper: number
  successful: number
}

export interface MarkovParameterUncertainty {
  status: 'complete' | 'partial' | 'disabled' | 'not_requested'
  method?: string
  interpretation?: string
  reason?: string
  CI?: number
  requested_samples?: number
  successful_samples?: number
  seed?: number | null
  mission_time?: number | null
  metric_intervals?: Record<string, MarkovMetricInterval>
  rate_intervals?: {
    transition_index: number
    from: string
    to: string
    input_mean: number
    input_cv: number
    lower: number
    median: number
    upper: number
  }[]
  warnings: string[]
}

export interface MarkovModelContract {
  contract_version: number
  selected_model: 'time_homogeneous_ctmc' | 'erlang_phase_type'
  display_name: string
  assumptions: string[]
  dwell_time_interpretation: string
  uncertainty_interpretation: string
  warnings: string[]
  rate_uncertainty_status?: string
}

export interface MarkovPhaseTypeInfo {
  status: 'applied' | 'not_applied'
  family: string
  reason?: string
  mean_preserving?: boolean
  expanded_state_count: number
  public_state_count: number
  state_mapping?: Record<string, string[]>
  state_dwell_models?: {
    state_id: string
    requested_model: string
    requested_shape: number
    effective_shape: number
    total_exit_rate: number
    mean_dwell_time: number | null
    dwell_time_cv: number | null
    absorbing: boolean
  }[]
  solver?: string
  matrix_note?: string
}

export interface MarkovTimeDependentEntry {
  time: number
  state_probs: Record<string, number>
  availability: number
  unavailability: number
  reliability: number
  unreliability: number
}

export interface MarkovResponse {
  states: { id: string; name: string; type: string; description: string; dwell_model: string; dwell_shape: number }[]
  transitions: { from: string; to: string; rate: number; label: string; rate_cv: number }[]
  transition_matrix: number[][]
  steady_state: Record<string, number> | null
  system_params: MarkovSystemParams
  time_dependent?: MarkovTimeDependentEntry[]
  model_contract: MarkovModelContract
  phase_type: MarkovPhaseTypeInfo
  parameter_uncertainty: MarkovParameterUncertainty
  ctmc_baseline?: {
    model: string
    system_params: MarkovSystemParams
    steady_state: Record<string, number> | null
    time_dependent?: MarkovTimeDependentEntry[] | null
    comparison_note: string
  }
}

export interface MarkovExampleInfo {
  name: string
  description: string
  states: { id: string; name: string; type: string; description: string; dwell_model: string; dwell_shape: number }[]
  transitions: { from: string; to: string; rate: number; label: string; rate_cv: number }[]
}

export const analyzeMarkov = (req: MarkovRequest) =>
  api.post<MarkovResponse>('/markov/analyze', req).then(r => r.data)

export const getMarkovExamples = () =>
  api.get<Record<string, { name: string; description: string; default_params: Record<string, number> }>>('/markov/examples').then(r => r.data)

export const getMarkovExample = (modelId: string) =>
  api.get<MarkovExampleInfo>(`/markov/examples/${modelId}`).then(r => r.data)


// --- Multi-Standard Prediction ---

export interface MultiStandardPredictionRequest {
  standard: string
  environment: string
  vita_global: boolean
  parts: PredictionPart[]
  process_grade?: number
  process_score?: number
  part_manufacturing?: string
}

export const predictMultiStandard = (req: MultiStandardPredictionRequest) =>
  api.post<PredictionResponse>('/prediction/predict-standard', req).then(r => r.data)

export const getPredictionStandards = () =>
  api.get<Record<string, {
    name: string; description: string; categories: string[]
    conformance_tier: MethodologyDisclosure['conformance_tier']
    conformance_label: string
    methodology: MethodologyDisclosure
  }>>('/prediction/standards').then(r => r.data)


// --- Derating Analysis ---

export interface DeratingResult {
  parameter: string
  description: string
  actual_value: number | null
  rated_value: number | null
  stress_ratio: number | null
  level_I: number
  level_II: number
  level_III: number
  status: 'ok' | 'warning' | 'exceeds'
  derating_level: string
}

export interface DeratingPartResult {
  name: string
  category: string
  derating: DeratingResult[]
  overall_status: 'ok' | 'warning' | 'exceeds'
}

export interface DeratingResponse {
  standard: string
  derating_level: string
  summary: { ok: number; warning: number; exceeds: number }
  results: DeratingPartResult[]
  methodology: MethodologyDisclosure
}

export interface DeratingStandard {
  key: string
  name: string
  description: string
  conformance_tier?: MethodologyDisclosure['conformance_tier']
  conformance_label?: string
  methodology?: MethodologyDisclosure
}

export interface CustomDeratingRule {
  param: string
  desc: string
  unit: string
  level_I: number
  level_II: number
  level_III: number
  rated?: number
}

export const getDeratingStandards = () =>
  api.get<DeratingStandard[]>('/prediction/derating-standards').then(r => r.data)

export const analyzeDerating = (
  parts: PredictionPart[],
  derating_level: string = 'II',
  standard: string = 'MIL-STD-975',
  custom_rules?: Record<string, CustomDeratingRule[]>,
) =>
  api.post<DeratingResponse>('/prediction/derating', {
    parts,
    derating_level,
    standard,
    custom_rules: custom_rules ?? null,
  }).then(r => r.data)


// --- Mission Profile ---

export interface MissionPhaseInput {
  name: string
  duration: number
  environment: string
  temperature: number
  operating: boolean
  duty_cycle: number
  description: string
}

export interface MissionProfilePredictionRequest {
  profile_name: string
  phases: MissionPhaseInput[]
  parts: PredictionPart[]
  standard: string
  vita_global?: boolean
}

export interface MissionProfileResponse {
  standard: string
  profile_name: string
  total_duration: number
  system_failure_rate: number
  system_mtbf: number | null
  mission_reliability: number
  mission_unreliability: number
  phases: MissionPhaseInput[]
  part_results: {
    name: string
    category: string
    quantity: number
    mission_failure_rate: number
    phases: {
      phase_name: string
      duration: number
      environment: string
      temperature: number
      operating: boolean
      duty_cycle: number
      failure_rate: number
      fraction: number
      weighted_contribution: number
      pi_factors: Record<string, number | string | boolean>
      error?: string | null
    }[]
  }[]
  methodology: MethodologyDisclosure
  methodology_supplements?: MethodologyDisclosure[]
  warnings?: string[]
}

export const predictMissionProfile = (req: MissionProfilePredictionRequest) =>
  api.post<MissionProfileResponse>('/prediction/mission-profile', req).then(r => r.data)

export const getMissionProfiles = () =>
  api.get<Record<string, { name: string; total_duration: number; n_phases: number; phases: MissionPhaseInput[] }>>('/prediction/mission-profiles').then(r => r.data)

// --- RAM (Availability / Maintainability / Spares) ---

export interface AvailabilityRequest {
  mtbf?: number | null
  mttr?: number | null
  mtbm?: number | null
  mean_maint_time?: number | null
  admin_delay?: number
  logistics_delay?: number
}

export interface AvailabilityResponse {
  inherent?: number | null
  achieved?: number | null
  operational?: number | null
  mean_down_time?: number | null
  downtime_breakdown: { repair: number | null; admin_delay: number | null; logistics_delay: number | null }
  analysis_basis?: string
  assumption_note?: string
}

export const computeAvailability = (req: AvailabilityRequest) =>
  api.post<AvailabilityResponse>('/ram/availability', req).then(r => r.data)

export interface MaintainabilityRequest {
  mode: 'lognormal' | 'data'
  mu?: number | null
  sigma?: number | null
  samples?: number[] | null
  percentile?: number
}

export interface MaintainabilityResponse {
  mu: number
  sigma: number
  mct: number
  mmax: number
  median: number
  percentile: number
  fitted?: { mu: number; sigma: number } | null
  curve: { time: number[]; sf: number[] }
}

export const computeMaintainability = (req: MaintainabilityRequest) =>
  api.post<MaintainabilityResponse>('/ram/maintainability', req).then(r => r.data)

export interface SparesRequest {
  quantity: number
  op_hours: number
  duty_cycle?: number
  mtbf?: number | null
  failure_rate?: number | null
  confidence: number
  max_spares?: number
  model?: 'poisson' | 'negative_binomial' | 'renewal_pipeline'
  dispersion?: number
  weibull_alpha?: number | null
  weibull_beta?: number | null
  replenishment_lead_time_mean?: number
  replenishment_lead_time_std?: number
  common_shock_rate?: number
  common_shock_size?: number
  n_simulations?: number
  seed?: number | null
}

export interface SparesResponse {
  model: string
  analysis_basis: string
  expected_demand: number
  demand_variance: number
  required_spares: number
  required_spares_interval?: { lower: number; upper: number; method: string } | null
  achieved_protection: number
  confidence: number
  mean_peak_outstanding?: number
  n_simulations?: number
  assumptions: string[]
  curve: {
    stock_level: number[]; protection: number[]
    protection_lower: number[] | null; protection_upper: number[] | null
  }
}

export const computeSpares = (req: SparesRequest) =>
  api.post<SparesResponse>('/ram/spares', req).then(r => r.data)

// --- Reliability Allocation ---

export interface AllocationSubsystem {
  name?: string
  failure_rate?: number | null
  complexity?: number | null
  importance?: number | null
  difficulty?: number | null
}

export interface AllocationRequest {
  method: 'equal' | 'arinc' | 'agree' | 'feasibility'
  target_reliability?: number | null
  target_mtbf?: number | null
  mission_time: number
  subsystems: AllocationSubsystem[]
}

export interface AllocationRow {
  name: string
  reliability: number
  failure_rate: number | null
  mtbf: number | null
}

export interface AllocationResponse {
  method: string
  system_reliability: number
  mission_time: number
  allocations: AllocationRow[]
  achieved_reliability: number
}

export const computeAllocation = (req: AllocationRequest) =>
  api.post<AllocationResponse>('/allocation/allocate', req).then(r => r.data)
