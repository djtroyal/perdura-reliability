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
    scatter_counts?: number[]
    censored_times?: number[]
    censored_counts?: number[]
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
  qq?: { theoretical: number[]; sample: number[]; counts?: number[] }
  pp?: { empirical: number[]; fitted: number[]; counts?: number[] }
  interval?: {
    lower: (number | null)[]
    upper: (number | null)[]
    counts: number[]
    ids: string[]
    turnbull: TurnbullResponse
  }
}

export interface FitResponse {
  results: FitResult[]
  best_distribution: string | null
  CI: number
  plots: Record<string, DistPlotData>
  available_distributions: string[]
  observation_model?: 'individual' | 'frequency_exact' | 'interval_censored'
  n_failures?: number
  n_censored?: number
  empirical?: TurnbullResponse | null
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

export interface FrequencyLifeObservation {
  id?: string
  time: number
  state: 'F' | 'S'
  count: number
}

export interface IntervalLifeObservation {
  id?: string
  lower?: number | null
  upper?: number | null
  count: number
}

export interface GroupedLifeFitRequest {
  observation_model: 'frequency_exact' | 'interval_censored'
  frequency_observations?: FrequencyLifeObservation[]
  interval_observations?: IntervalLifeObservation[]
  distributions_to_fit?: string[]
  CI?: number
}

export interface TurnbullResponse {
  time: number[]
  cdf: number[]
  sf: number[]
  mass: number[]
  tail_mass: number
  iterations: number
  converged: boolean
  method: string
}

export const fitGroupedDistributions = (req: GroupedLifeFitRequest) =>
  api.post<FitResponse>('/life-data/grouped-fit', req).then(r => r.data)

export const fetchGroupedDistPlot = (req: GroupedLifeFitRequest & { distribution: string }) =>
  api.post<{ distribution: string; plot: DistPlotData; method: string }>(
    '/life-data/grouped-plot', req).then(r => r.data)

export const fitTurnbull = (interval_observations: IntervalLifeObservation[]) =>
  api.post<TurnbullResponse>('/life-data/turnbull', { interval_observations }).then(r => r.data)

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
  params: Record<string, number>
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
    BIC: number | null
    AD: number | null
    params: Record<string, number | null>
    contour: ContourData | null
    curves?: { x: number[]; pdf: number[]; cdf: number[]; sf: number[]; hf: number[] } | null
    pp?: { theoretical: number[]; empirical: number[] } | null
    qq?: { theoretical: number[]; empirical: number[] } | null
    converged: boolean
    fit_eligible: boolean
    aicc_eligible: boolean
    eligibility_reasons: string[]
    diagnostics?: FitDiagnostics | FitDiagnostics[] | null
  }[]
  test_status: 'valid' | 'withheld'
  test_reasons: string[]
  pooled_fit: {
    log_likelihood: number | null
    AICc: number | null
    BIC: number | null
    AD: number | null
    params: Record<string, number | null>
    converged: boolean
    fit_eligible: boolean
    aicc_eligible: boolean
    eligibility_reasons: string[]
    diagnostics?: FitDiagnostics | FitDiagnostics[] | null
  } | null
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

// Special Weibull models (mixture / competing risks / DSZI)
export interface SpecialModelRequest {
  model: string
  failures: number[]
  right_censored?: number[] | null
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
  censoring_design?: CensoringDesignRequest
}

export type CensoringDesignRequest =
  | { type: 'fixed_administrative'; time: number }
  | { type: 'observed_schedule'; times: number[] }
  | {
      type: 'parametric_independent'
      distribution: 'exponential' | 'weibull' | 'lognormal' | 'uniform'
      parameters: Record<string, number>
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
  interval_status?: 'complete' | 'partial_diagnostic' | string
  n_requested?: number
  n_successful?: number
  success_rate?: number
  calibration_status?: string
  inferential_calibration_status?: string
  censoring_design_status?: string
  uncertainty_warnings?: string[]
  boundary_parameters?: string[]
  optimizer_failure_count?: number
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

export interface BootstrapProgress { done: number; total: number }

export async function calculateCalibratedUncertaintyWithProgress(
  req: CalibratedUncertaintyRequest,
  onProgress?: (progress: BootstrapProgress) => void,
  signal?: AbortSignal,
): Promise<CalibratedUncertaintyResponse> {
  let response: Response
  try {
    response = await fetch('/api/life-data/uncertainty/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    return calculateCalibratedUncertainty(req)
  }
  if (!response.ok || !response.body) return calculateCalibratedUncertainty(req)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  const resetTimeout = () => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      timedOut = true
      reader.cancel().catch(() => {})
    }, 120000)
  }
  try {
    resetTimeout()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      resetTimeout()
      buffer += decoder.decode(value, { stream: true })
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (!line) continue
        const message = JSON.parse(line)
        if (message.type === 'start') {
          onProgress?.({ done: 0, total: message.total })
        } else if (message.type === 'progress') {
          onProgress?.({ done: message.done, total: message.total })
        } else if (message.type === 'result') {
          return message.payload as CalibratedUncertaintyResponse
        } else if (message.type === 'error') {
          throw fitStreamError(message.detail || 'Calibrated interval failed.')
        }
      }
    }
    throw fitStreamError(timedOut
      ? 'The bootstrap timed out because no progress was received for two minutes.'
      : 'The bootstrap stream ended unexpectedly.')
  } finally {
    clearTimeout(idleTimer)
  }
}

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
}) => api.post<{ p1: number; p2: number; difference: number; z: number | null; p_value: number; method: 'fisher-exact' | 'pooled-z'; different: boolean; CI: number }>(
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

export async function fitALTWithProgress(
  req: ALTFitRequest,
  onProgress?: (progress: BootstrapProgress) => void,
  signal?: AbortSignal,
): Promise<ALTFitResponse> {
  let response: Response
  try {
    response = await fetch('/api/alt/fit/stream', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req), signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    return fitALT(req)
  }
  if (!response.ok || !response.body) return fitALT(req)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  const resetTimeout = () => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      timedOut = true
      reader.cancel().catch(() => {})
    }, 120000)
  }
  try {
    resetTimeout()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      resetTimeout()
      buffer += decoder.decode(value, { stream: true })
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (!line) continue
        const message = JSON.parse(line)
        if (message.type === 'start') onProgress?.({ done: 0, total: message.total })
        else if (message.type === 'progress') onProgress?.({ done: message.done, total: message.total })
        else if (message.type === 'result') return message.payload as ALTFitResponse
        else if (message.type === 'error') throw fitStreamError(message.detail || 'Error running ALT analysis.')
      }
    }
    throw fitStreamError(timedOut
      ? 'The ALT bootstrap timed out because no progress was received for two minutes.'
      : 'The ALT bootstrap stream ended unexpectedly.')
  } finally {
    clearTimeout(idleTimer)
  }
}

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
  /** Manufacturer or supplier part number; used to share derating inputs between identical parts. */
  part_number?: string
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
  parent_id?: string | null
  failure_rate_override_enabled?: boolean
  failure_rate_override_fpmh?: number | null
  nonoperating_rate_override_enabled?: boolean
  nonoperating_rate_override_fpmh?: number | null
  nonoperating_rate_source_type?: 'measured' | 'manufacturer' | 'qualification_test' | 'engineering_estimate' | 'other' | null
  nonoperating_rate_source?: string | null
  nonoperating_params?: Record<string, unknown>
  /** Source-specific operational derating inputs, including `profile`; never passed to a failure-rate constructor. */
  derating_params?: Record<string, unknown>
}

export interface PredictionBlockInput {
  id: string
  name: string
  parent_id?: string | null
  quantity?: number
  operating_fraction?: number
  environment?: string | null
  nonoperating_environment?: string | null
  nonoperating_temperature_c?: number | null
  power_cycles_per_1000_nonoperating_hours?: number | null
  notes?: string | null
  failure_rate_override_enabled?: boolean
  failure_rate_override_fpmh?: number | null
}

export interface PredictionRequest {
  environment: string
  vita_global: boolean
  parts: PredictionPart[]
  blocks?: PredictionBlockInput[]
}

export interface EquationSymbolBinding {
  /** Stable, equation-local identifier used by the trusted KaTeX annotation. */
  id: string
  /** Human-readable mathematical symbol, for example πT or λp. */
  symbol: string
  value: number | null
  available: boolean
  unit: string
  label: string
  source: 'input' | 'factor' | 'intermediate' | 'result'
  /** Present when the symbol represents a row in the factor table. */
  factor_key?: string
}

export interface PredictionResult {
  name: string
  category: string
  quantity: number
  multiplier: number
  failure_rate: number | null
  total_failure_rate: number | null
  contribution: number
  pi_factors: Record<string, number | string | boolean>
  /** Input-to-calculation relationships resolved against this exact result. */
  parameter_impacts?: Record<string, {
    direct_factor_keys: string[]
    downstream_factor_keys: string[]
    direct_step_indices: number[]
    downstream_step_indices: number[]
  }>
  traceability?: {
    standard: string
    section: string
    handbook_pages: string
    model: string
    equation: string
    unit: string
    /** Interpretation boundary carried with every handbook result. */
    result_context?: string
    quality_basis?: string
    model_mapping?: {
      requested_model: string
      effective_model: string
      source: string
    }
    source_adjustments?: {
      locator: string
      printed_value: number
      adopted_value: number
      active: boolean
      printed_literal_metallization_fpmh: number
      adopted_metallization_fpmh: number
      printed_literal_total_fpmh: number
      adopted_total_fpmh: number
      rationale: string
    }[]
    symbol_bindings?: EquationSymbolBinding[]
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
    symbol_bindings?: EquationSymbolBinding[]
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
  parent_id?: string | null
  operating_environment?: string
  nonoperating_environment?: string | null
  nonoperating_temperature_c?: number | null
  power_cycles_per_1000_nonoperating_hours?: number | null
  effective_operating_fraction?: number
  operating_failure_rate_fpmh?: number
  nonoperating_failure_rate_fpmh?: number | null
  service_failure_rate_fpmh?: number | null
  rate_time_basis?: 'calendar_hours'
  service_rate_available?: boolean
  operating_calculated_failure_rate?: number
  nonoperating_calculated_failure_rate?: number | null
  calculated_failure_rate?: number | null
  calculated_total_failure_rate?: number | null
  line_total_failure_rate?: number | null
  block_quantity_multiplier?: number
  system_expanded_failure_rate?: number | null
  system_contribution_failure_rate?: number | null
  included_in_system_total?: boolean
  superseded_by_block_id?: string | null
  failure_rate_override_enabled?: boolean
  failure_rate_override_fpmh?: number | null
  override_applied?: boolean
  nonoperating_calculation?: {
    status: 'supported' | 'user_override' | 'unavailable' | 'not_required'
    source?: string
    source_type?: string
    model?: string
    reason?: string
    failure_rate: number | null
    factors?: Record<string, number | string | boolean>
    inputs?: Record<string, unknown>
    traceability?: PredictionResult['traceability']
    steps?: PredictionResult['calculation_steps']
    assumptions?: string[]
    warnings?: string[]
  }
}

export interface PredictionBlockResult {
  id: string
  name: string
  parent_id?: string | null
  notes?: string | null
  quantity: number
  operating_fraction: number
  effective_operating_fraction: number
  operating_environment: string
  nonoperating_environment?: string | null
  nonoperating_temperature_c?: number | null
  power_cycles_per_1000_nonoperating_hours?: number | null
  operating_handbook_subtotal_failure_rate: number
  handbook_subtotal_failure_rate: number
  rolled_up_failure_rate: number | null
  service_rate_available: boolean
  rate_time_basis: 'calendar_hours'
  failure_rate_override_enabled: boolean
  failure_rate_override_fpmh?: number | null
  override_applied: boolean
  failure_rate: number | null
  service_failure_rate_fpmh: number | null
  total_failure_rate: number | null
  system_expanded_failure_rate: number | null
  system_contribution_failure_rate: number | null
  included_in_system_total: boolean
  superseded_by_block_id?: string | null
  contribution: number
  descendant_part_indices: number[]
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
  conformance_tier: 'verified' | 'partial' | 'screening' | 'custom' | 'unavailable'
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
  total_failure_rate: number | null
  service_failure_rate_fpmh?: number | null
  service_rate_available?: boolean
  rate_time_basis?: 'calendar_hours'
  mtbf_hours: number | null
  results: PredictionResult[]
  blocks?: PredictionBlockResult[]
  /** Parts that could not be computed under the selected standard (#3). */
  incompatible?: IncompatiblePart[]
  methodology: MethodologyDisclosure
  methodology_supplements?: MethodologyDisclosure[]
  warnings?: string[]
  result_context?: string
}

export const predictFailureRate = (req: PredictionRequest) =>
  api.post<PredictionResponse>('/prediction/predict', req).then(r => r.data)

export const getPredictionOptions = () =>
  api.get<{
    environments: { code: string; description: string }[]
    nonoperating_environments: { code: string; description: string }[]
    nonoperating_models: Record<string, {
      section: string
      required_parameters: string[]
      conditional_parameters?: Record<string, string>
      choices?: Record<string, string[]>
    }>
    nonoperating_automatic_models: Record<string, {
      model: string
      input_keys: string[]
    }>
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
  id?: string
  source: string
  target: string
}

export interface RBDValidationIssue {
  severity: 'error' | 'warning'
  code: string
  message: string
  node_id?: string
  edge_id?: string
}

export interface RBDValidationResponse {
  valid: boolean
  issues: RBDValidationIssue[]
  summary: { nodes: number; components: number; connections: number }
}

export interface RBDImportance {
  id: string
  node_ids?: string[]
  occurrences?: number
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
  path_node_ids?: string[][]
  components: { id: string; component_key?: string; mirrored?: boolean; label: string; reliability: number }[]
  importance?: RBDImportance[]
  importance_definitions?: Record<string, string>
  path_sets_truncated?: boolean
  display_path_limit?: number
  dependency_model?: DependencyDiagnostics
  assumptions?: string[]
  warnings?: string[]
  mission_time?: number | null
  time_curve?: { time: number; reliability: number; unreliability: number }[]
  time_curve_unavailable_reason?: string | null
  restricted_mean_survival_time?: number | null
  formulas?: { label: string; latex: string; description: string }[]
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

export const computeRBD = (
  nodes: RBDNode[], edges: RBDEdge[], options?: { mission_time?: number; time_points?: number },
) => api.post<RBDResponse>('/system/rbd', { nodes, edges, ...options }).then(r => r.data)

export const validateRBD = (
  nodes: RBDNode[], edges: RBDEdge[], options?: { mission_time?: number; time_points?: number },
) => api.post<RBDValidationResponse>('/system/rbd/validate', { nodes, edges, ...options }).then(r => r.data)

// --- Fault Tree ---

export interface FTNode {
  id: string
  type: string
  data: Record<string, unknown>
}

export interface FTEdge {
  id?: string
  source: string
  target: string
  role?: string
  order?: number
}

export interface FTCutSetFormula {
  events: string[]
  formula: string
  formula_latex?: string
  value: number | null
}

export interface FaultTreeResponse {
  schema_version?: number
  analysis_kind?: 'static_coherent' | 'static_noncoherent' | 'dynamic'
  top_event_probability: number
  minimal_cut_sets: string[][]
  failure_conditions?: {
    required_failed: string[]
    required_successful: string[]
    order: number
    probability: number
    kind: string
  }[]
  cut_sequences?: {
    events: string[]
    count: number
    state_count?: number
    conditional_contribution: number
    estimated_probability: number
    kind: string
  }[]
  importance: {
    event_key?: string
    event: string
    probability?: number
    Birnbaum: number
    Criticality?: number | null
    'Fussell-Vesely': number | null
    RAW: number | null
    RRW: number | null
    coherent_interpretation?: boolean
  }[]
  importance_eligibility?: {
    available: boolean
    coherent_interpretation?: boolean
    reason?: string | null
  }
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
    boolean_expression_latex?: string
    probability_expression: string
    probability_expression_latex?: string
    cut_sets: FTCutSetFormula[]
  }
  time_curve?: { time: number; probability: number }[]
  time_grid?: number[]
  node_results?: {
    node_id: string
    label: string
    type: string
    probability: number
    curve?: number[]
  }[]
  diagnostics?: { severity: string; code: string; message: string; node_id?: string }[]
  dependency_model?: DependencyDiagnostics
  assumptions?: string[]
  computation?: {
    engine?: Record<string, unknown> | null
    exact_engine: {
      engine: string
      exact: boolean
      states_evaluated?: number
      cache_hits?: number
      variables: number
      terms?: number
      max_states?: number
      max_nodes?: number
      nodes_created?: number
      nodes_reachable?: number
    } | null
    minimal_cut_set_count: number
    basic_latent_event_count?: number
    basic_event_count?: number
    qualitative_condition_count?: number
    qualitative_display_truncated?: boolean
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
  engine?: 'auto' | 'exact' | 'simulation'
  confidenceLevel?: number
  timeGrid?: number[]
  maxBddNodes?: number
  maxDynamicStates?: number
}

const faultTreePayload = (
  nodes: FTNode[], edges: FTEdge[], opts: AnalyzeFaultTreeOptions,
) => ({
  nodes,
  edges,
  exposure_time: opts.exposureTime ?? null,
  methods: opts.methods,
  n_simulations: opts.nSimulations,
  seed: opts.seed ?? null,
  trees: opts.trees,
  tree_id: opts.treeId ?? null,
  engine: opts.engine ?? 'auto',
  confidence_level: opts.confidenceLevel ?? 0.95,
  time_grid: opts.timeGrid,
  max_bdd_nodes: opts.maxBddNodes,
  max_dynamic_states: opts.maxDynamicStates,
})

export const analyzeFaultTree = (
  nodes: FTNode[], edges: FTEdge[], opts: AnalyzeFaultTreeOptions = {},
) =>
  api.post<FaultTreeResponse>('/fault-tree/analyze', faultTreePayload(nodes, edges, opts))
    .then(r => r.data)

export interface FaultTreeProgress {
  done: number
  total: number
}

export async function analyzeFaultTreeStream(
  nodes: FTNode[], edges: FTEdge[], opts: AnalyzeFaultTreeOptions = {},
  onProgress?: (progress: FaultTreeProgress) => void,
  signal?: AbortSignal,
): Promise<FaultTreeResponse> {
  const response = await fetch('/api/fault-tree/analyze/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(faultTreePayload(nodes, edges, opts)),
    signal,
  })
  if (!response.ok || !response.body) {
    throw new Error(`Fault-tree analysis failed (${response.status}).`)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: FaultTreeResponse | null = null
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      const message = JSON.parse(line) as {
        type: string; done?: number; total?: number
        result?: FaultTreeResponse
        detail?: string | { message?: string }
      }
      if (message.type === 'progress' && message.done != null && message.total != null) {
        onProgress?.({ done: message.done, total: message.total })
      } else if (message.type === 'result' && message.result) {
        result = message.result
      } else if (message.type === 'error') {
        throw new Error(typeof message.detail === 'string'
          ? message.detail : message.detail?.message || 'Fault-tree analysis failed.')
      }
    }
  }
  if (!result) throw new Error('The fault-tree analysis stream ended without a result.')
  return result
}

export interface FaultTreeValidationResponse {
  valid: boolean
  issues: { code: string; message: string; node_id?: string; edge_id?: string }[]
  analysis_kind?: 'static_coherent' | 'static_noncoherent' | 'dynamic' | null
  root_id?: string
  event_count?: number
}

export const validateFaultTree = (
  nodes: FTNode[], edges: FTEdge[], opts: AnalyzeFaultTreeOptions = {},
) => api.post<FaultTreeValidationResponse>(
  '/fault-tree/validate', faultTreePayload(nodes, edges, opts),
).then(r => r.data)

export interface OpenPSAWarning {
  severity: string
  code: string
  message: string
  node_id?: string
}

export interface OpenPSAImportResponse {
  schema_version: number
  format: string
  tree_name: string
  top_event: string
  root_id: string
  nodes: (FTNode & { position?: { x: number; y: number } })[]
  edges: FTEdge[]
  warnings: OpenPSAWarning[]
  available_trees: string[]
  candidate_top_events: string[]
}

export interface OpenPSAExportResponse {
  schema_version: number
  format: string
  tree_name: string
  top_event: string
  xml: string
  warnings: OpenPSAWarning[]
}

export const importOpenPSAFaultTree = (
  xml: string, treeName?: string, topEvent?: string,
) => api.post<OpenPSAImportResponse>('/fault-tree/openpsa/import', {
  xml, tree_name: treeName || null, top_event: topEvent || null,
}).then(r => r.data)

export const exportOpenPSAFaultTree = (
  nodes: FTNode[], edges: FTEdge[], treeName: string,
) => api.post<OpenPSAExportResponse>('/fault-tree/openpsa/export', {
  nodes, edges, tree_name: treeName,
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
  analysis_method: 'per_unit_delta' | 'hierarchical_nlme'
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
    interval_sources: Record<string, number>
    longitudinal_measurements?: number
    likelihood?: string
  }
  projection_uncertainty: {
    method: 'delta_method' | 'hierarchical_parametric_bootstrap'; confidence_level: number
    intervals_available: number; likelihood_role: 'display_only' | 'no_separate_life_likelihood'
  }
  hierarchical_fit?: {
    model: 'linear' | 'exponential'
    response_scale: string
    population_parameters: {
      mean_intercept: number
      mean_log_slope: number
      median_slope_magnitude: number
    }
    random_effects: {
      sd_intercept: number
      sd_log_slope: number
      correlation: number
      covariance: number[][]
    }
    residual_sigma: number
    converged: boolean
    fit_eligible: boolean
    inference_status: 'eligible' | 'diagnostic_only'
    log_likelihood: number
    log_likelihood_data_scale: number
    log_likelihood_response_scale: number
    log_likelihood_standardized: number
    likelihood_scale: 'raw_measurement'
    likelihood_jacobians: {
      response_standardization: number
      log_transform: number
    }
    AIC: number
    BIC: number
    BIC_sample_size: { value: number; unit: 'independent_units' }
    life_distribution: {
      type: 'induced_first_passage'
      summary: { mean: number | null; B10: number | null; B50: number | null }
      quantiles: { B1: number | null; B10: number | null; B50: number | null; B90: number | null }
      curve_x: number[]
      cdf: number[]
      survival: number[]
      reliability: { time: number; R: number; F: number } | null
      n_monte_carlo: number
    }
    uncertainty: {
      method: 'parametric_bootstrap'
      confidence_level: number
      parameter_intervals: Record<string, [number, number] | null>
      summary_intervals: Record<string, [number, number] | null>
      reliability_interval: [number, number] | null
      diagnostics: {
        requested: number; successful: number; failed: number
        status: string; seed: number | null
        warnings?: string[]
        minimum_accepted_refits?: number
        refit_outcomes?: Record<string, number>
      }
    }
    diagnostics: Record<string, unknown>
  } | null
  unit_table: {
    unit_id: string; projected_failure: number | null
    projection_lower: number | null; projection_upper: number | null
    inspection_lower: number | null; inspection_upper: number | null
    censor_time: number | null
    life_observation: 'projected_exact' | 'interval_censored' | 'right_censored' | 'joint_longitudinal_measurements' | 'unusable'
    interval_source: 'observed_threshold_crossing' | 'observed_threshold_crossing_display_only' | null
    a: number | null; b: number | null; r2: number | null
  }[]
}

export const degradationAnalysis = (req: {
  unit_ids: string[]; times: number[]; measurements: number[]
  threshold: number; threshold_direction: string
  degradation_model: string; life_distribution: string
  reliability_time?: number | null
  ci?: number
  analysis_method?: 'per_unit_delta' | 'hierarchical_nlme'
  n_monte_carlo?: number
  n_bootstrap?: number
  seed?: number | null
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
  converged?: boolean
  fit_eligible?: boolean
  fit_diagnostics?: FitDiagnostics
  gof?: { AIC: number; AICc: number | null; BIC: number; LogLik: number }
  measurement_distribution_selection?: 'AICc' | 'AIC'
  distribution_comparison?: {
    distribution: string
    AIC: number | null
    AICc: number | null
    BIC: number | null
    LogLik: number | null
    fit_eligible: boolean
    status: 'Eligible' | 'Ineligible'
    reason?: string
  }[]
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
      lower: number; upper: number; valid_draws: number; plot_samples: number[]
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
  model: 'crow-amsaa' | 'crow_amsaa' | 'duane'
  data_mode?: 'exact' | 'grouped'
  termination: 'time' | 'failure'
  estimator?: 'mle' | 'modified_mle'
  CI?: number
  gof_significance?: number
  grouped_endpoints?: number[]
  grouped_counts?: number[]
  prediction_horizon?: number | null
  prediction_failure_count?: number
  prediction_probability?: number
}

export interface GrowthInterval {
  estimate?: number | null
  reported_estimate_basis?: string | null
  interval_reference_estimate?: number | null
  interval_reference_basis?: string | null
  lower?: number | null
  upper?: number | null
  method?: string | null
  available?: boolean
  status?: string | null
  coverage_status?: string | null
  warning?: string | null
}

export interface GrowthOneSidedBound {
  quantity: string
  side: 'lower' | 'upper'
  bound?: number | null
  confidence_level?: number | null
  method?: string | null
  available?: boolean
  status?: string | null
  coverage_status?: string | null
  estimate?: number | null
  reported_estimate_basis?: string | null
  interval_reference_estimate?: number | null
  interval_reference_basis?: string | null
}

export interface GrowthPooledInterval {
  start: number
  end: number
  observed: number
  expected: number
}

export interface GrowthGoodnessOfFit {
  available: boolean
  method: string
  statistic?: number | null
  critical_value?: number | null
  p_value?: number | null
  degrees_of_freedom?: number | null
  significance: number
  decision: 'reject' | 'fail_to_reject' | 'unavailable'
  decision_text: string
  effective_event_count?: number
  shape_used?: number | null
  critical_value_method?: string
  expected_count_rule?: string | null
  pooled_intervals?: GrowthPooledInterval[] | null
}

export interface GrowthTrendTest {
  available: boolean
  method: string
  null_hypothesis?: string
  statistic?: number | null
  degrees_of_freedom?: number | null
  significance?: number
  significance_role?: string
  p_value_improving?: number | null
  p_value_worsening?: number | null
  p_value_two_sided?: number | null
  directional_p_value?: number | null
  shape_for_direction?: number | null
  direction_estimator?: string
  direction_basis?: string
  observed_direction?: string
  decision?: 'reject' | 'fail_to_reject' | 'unavailable'
  decision_text?: string
}

export interface GrowthProjection {
  model: string
  uncertainty_scope: string
  parameter_uncertainty_included: boolean
  future_event?: {
    order: number
    quantile_probability: number
    absolute_time: number
    elapsed_time_after_T: number
  }
  horizon?: {
    elapsed_time: number
    end_time: number
    expected_failures: number
    probability_no_failures: number
    failure_count_prediction_interval?: {
      level: number
      lower: number
      upper: number
      method: string
    }
  } | null
}

export interface GrowthResponse {
  model: string
  data_mode?: 'exact' | 'grouped'
  termination?: 'time' | 'failure' | null
  estimator?: 'mle' | 'modified_mle'
  estimator_label?: string
  beta?: number
  Lambda?: number | null
  log_Lambda?: number | null
  scale_representable?: boolean
  beta_mle?: number | null
  Lambda_mle?: number | null
  beta_bias_corrected?: number | null
  Lambda_bias_corrected?: number | null
  parameter_sets?: {
    selected: 'mle' | 'modified_mle'
    curves_use: 'mle' | 'modified_mle'
    mle: GrowthParameterSnapshot | null
    modified_mle: GrowthParameterSnapshot | null
  }
  alpha?: number
  A?: number
  r_squared?: number | null
  confidence?: {
    level: number
    alpha?: number
    intervals: Record<string, GrowthInterval>
    one_sided_bounds?: Record<string, GrowthOneSidedBound>
    available_parameters?: string[]
    warnings?: string[]
  }
  goodness_of_fit?: GrowthGoodnessOfFit
  trend_test?: GrowthTrendTest
  diagnostics?: { warnings: string[] }
  methods?: Record<string, string | null>
  valid_growth_regime?: boolean
  regime_warning?: string | null
  interpretation?: { trend: string; detail: string }
  growth_rate: number
  instantaneous_failure_intensity?: number | null
  mtbf_instantaneous: number | null
  mtbf_cumulative: number
  n_failures: number
  T: number
  scatter: { t: number[]; n: number[] }
  model_curve: { t: number[]; n: number[] }
  mtbf_curve: { t: number[]; cumulative: number[]; instantaneous: (number | null)[] }
  intensity_curve?: { t: number[]; instantaneous: number[] }
  expected_vs_observed?: {
    time: number[]
    observed_cumulative: number[]
    expected_cumulative: number[]
  }
  interval_context?: {
    interval_start: number[]
    interval_end: number[]
    observed_count: number[]
    expected_count: number[]
    observed_average_intensity: number[]
    fitted_average_intensity: number[]
  }
  grouped_final_interval?: {
    start: number
    end: number
    observed_failures: number
    expected_failures: number
    average_failure_intensity: number
    average_mtbf: number
    confidence_level: number
    target_profile: {
      average_failure_intensity_interval?: GrowthInterval | null
      average_mtbf_interval?: GrowthInterval | null
    }
    handbook_approximate: {
      average_failure_intensity_interval?: GrowthInterval | null
      average_mtbf_interval?: GrowthInterval | null
      average_mtbf_one_sided_lower_bound?: GrowthOneSidedBound | null
    }
  } | null
  prediction?: GrowthProjection | null
}

export interface GrowthParameterSnapshot {
  beta: number
  Lambda: number | null
  log_Lambda?: number | null
  scale_representable?: boolean
  growth_rate: number
  instantaneous_failure_intensity_at_T: number
  instantaneous_mtbf_at_T: number
  cumulative_mtbf_at_T: number
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
export interface MCFAnalysisStatus {
  nonparametric_estimate: 'available'
  nonparametric_interval: 'available' | 'partially_unavailable' | 'unavailable'
  parametric_fit: 'available' | 'not_requested'
  parametric_interval: 'asymptotic_profile_likelihood' | 'partially_unavailable' | 'not_requested'
}

export interface MCFTrendSummary {
  trend: 'improving' | 'constant' | 'worsening'
  detail: string
  method: string
  inferential: false
}

export interface MCFResponse {
  nonparametric: {
    time: number[]; MCF: number[]
    MCF_lower: (number | null)[]; MCF_upper: (number | null)[]
    variance: (number | null)[]; standard_error: (number | null)[]; at_risk: number[]
    events_at_time: number[]; CI: number
    variance_method: string; interval_method: string
    n_systems: number; n_events: number
    variance_available: boolean
    interval_available: boolean
    interval_point_available: boolean[]
    interval_status: 'available' | 'partially_unavailable' | 'unavailable'
    interval_reason: string | null
    tail_risk_threshold: number
    sparse_tail: boolean[]; tail_warning: string | null
    data_contract: string
    bootstrap: {
      samples: number; seed: number | null
      lower: (number | null)[]; upper: (number | null)[]
      standard_error: (number | null)[]; valid_replicates: number[]
      minimum_valid_replicates: number; point_available: boolean[]
      interval_status: 'available' | 'partially_unavailable' | 'unavailable'
      interval_reason: string | null
      resampling_unit: string
    } | null
  }
  parametric: {
    alpha: number; log_alpha: number; beta: number
    Lambda: number; log_Lambda: number
    profile_score: number; optimizer: string; converged: boolean
    beta_lower: number | null; beta_upper: number | null
    beta_interval_method: string
    endpoint_time: number; endpoint_MCF: number
    endpoint_MCF_lower: number | null; endpoint_MCF_upper: number | null
    endpoint_MCF_interval_method: string
    Lambda_interval_method: string; alpha_interval_method: string
    interval_status: 'asymptotic_profile_likelihood' | 'partially_unavailable'
    r_squared: number | null
    time: number[]; MCF: number[]; CI: number
  } | null
  trend: MCFTrendSummary
  status: MCFAnalysisStatus
  assumptions: string[]
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
  n_failures: number
  n_censored: number
  interval_failures?: { lower: number; upper: number; count: number; ship_lot: number; return_period: number }[]
  right_censored_groups?: { time: number; count: number; ship_lot: number }[]
  observation_model?: string
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
  interval_failures: { lower: number; upper: number; count: number; ship_lot: number; return_period: number }[]
  right_censored_groups: { time: number; count: number; ship_lot: number }[]
  observation_model: string
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
  id?: string
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
  transitions: { id: string; from: string; to: string; rate: number; label: string; rate_cv: number }[]
  transition_matrix: number[][]
  steady_state: Record<string, number> | null
  system_params: MarkovSystemParams
  time_dependent?: MarkovTimeDependentEntry[]
  model_contract: MarkovModelContract
  phase_type: MarkovPhaseTypeInfo
  parameter_uncertainty: MarkovParameterUncertainty
  validation?: MarkovValidationResponse
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
  transitions: { id: string; from: string; to: string; rate: number; label: string; rate_cv: number }[]
}

export interface MarkovValidationIssue {
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
  state_id?: string
  transition_id?: string
}

export interface MarkovValidationResponse {
  valid: boolean
  issues: MarkovValidationIssue[]
  summary: {
    states: number
    transitions: number
    up_states: number
    failed_states: number
    initial_state: string | null
  }
}

export const analyzeMarkov = (req: MarkovRequest) =>
  api.post<MarkovResponse>('/markov/analyze', req).then(r => r.data)

export const validateMarkov = (req: MarkovRequest) =>
  api.post<MarkovValidationResponse>('/markov/validate', req).then(r => r.data)

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
  blocks?: PredictionBlockInput[]
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
  rule_id?: string
  parameter: string
  description: string
  unit: string
  actual_value: number | boolean | string | null
  allowable_value?: number | boolean | string | null
  rated_value?: number | null
  stress_ratio?: number | null
  comparison?: '<=' | '<' | '>=' | '>' | '=' | string
  margin?: number | null
  formula?: string | null
  substitution?: string | null
  source?: { section?: string; title?: string; printed_pages?: string; pdf_pages?: string } | null
  notes?: string[]
  level_I?: number | null
  level_II?: number | null
  level_III?: number | null
  selected_level?: 'I' | 'II' | 'III' | null
  selected_limit?: number | boolean | string | null
  status: 'ok' | 'exceeds' | 'not_evaluated'
  derating_level?: string | null
  message: string | null
}

export interface DeratingPartResult {
  name: string
  category: string
  family?: string | null
  subtype?: string | null
  selected_level?: 'I' | 'II' | 'III' | null
  derating: DeratingResult[]
  overall_status: 'ok' | 'exceeds' | 'not_evaluated'
  coverage: { evaluated: number; required: number; complete: boolean }
  message: string | null
  assumptions?: string[]
  warnings?: string[]
  traceability?: Record<string, unknown> | null
  input_resolution?: {
    family: string
    family_source: 'automatic' | 'explicit'
    inherited_fields: string[]
    explicit_fields: string[]
    ignored_profile?: string | null
  } | null
}

export interface DeratingResponse {
  standard: string
  derating_level: string | null
  summary: { ok: number; exceeds: number; not_evaluated: number }
  results: DeratingPartResult[]
  methodology: MethodologyDisclosure
}

export interface DeratingStandard {
  key: string
  name: string
  description: string
  available?: boolean
  reason?: string
  level_mode?: 'none' | 'manual_three_level'
  historical?: boolean
  canceled?: boolean
  profile_schema?: DeratingProfileSchema | null
  conformance_tier?: MethodologyDisclosure['conformance_tier']
  conformance_label?: string
  methodology?: MethodologyDisclosure
}

export interface DeratingProfileField {
  key: string
  label: string
  type: 'number' | 'select' | 'boolean' | 'text'
  required?: boolean
  options?: string[]
  unit?: string
  help?: string
  required_when?: string
  min?: number
  max?: number
  step?: number
  default?: unknown
}

export interface DeratingProfileFamily {
  key: string
  label: string
  category_hints?: string[]
  fields: DeratingProfileField[]
  source?: string
  executable?: boolean
  reason?: string
  guidance?: string[]
}

export interface DeratingProfileSchema {
  families: DeratingProfileFamily[]
  automatic_mapping?: {
    family_rules: {
      family: string
      category: string
      when?: Record<string, (string | number | boolean)[]>
      values?: Record<string, unknown>
    }[]
    field_rules: Record<string, Record<string, {
      keys: string[]
      transform?: 'identity' | 'product' | 'ratio_to_percent'
      value_map?: Record<string, unknown>
    }>>
  }
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
  derating_level: string | null = null,
  standard: string = 'MIL-STD-975M',
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
  operating_fraction: number
  nonoperating_environment?: string | null
  nonoperating_temperature_c?: number | null
  power_cycles_per_1000_nonoperating_hours?: number | null
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
  system_failure_rate: number | null
  service_rate_available?: boolean
  rate_time_basis?: 'calendar_hours'
  system_mtbf: number | null
  mission_reliability: number | null
  mission_unreliability: number | null
  phases: MissionPhaseInput[]
  part_results: {
    name: string
    category: string
    quantity: number
    mission_failure_rate: number | null
    service_rate_available?: boolean
    phases: {
      phase_name: string
      duration: number
      environment: string
      temperature: number
      operating_fraction: number
      nonoperating_environment?: string | null
      nonoperating_temperature_c?: number | null
      power_cycles_per_1000_nonoperating_hours?: number | null
      operating_failure_rate_fpmh: number
      nonoperating_failure_rate_fpmh?: number | null
      service_failure_rate_fpmh: number | null
      failure_rate: number | null
      nonoperating_calculation?: PredictionResult['nonoperating_calculation']
      fraction: number
      weighted_contribution: number | null
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
