import { useModuleActiveState, useModuleState } from '../../store/project'

/**
 * Shared access to reliability *sources* that can define an FTA basic event,
 * an RBD component, or a Markov transition rate (#4). Two source modules are
 * supported, both normalized to the same { dist, dist_params } shape that the
 * FTA/RBD `computeCDF` and the backend `_compute_probability` understand:
 *
 *  - Life Data folios — any of the 13 parametric fitters' fitted distributions.
 *  - Failure-Rate Prediction folios — the predicted total failure rate, mapped
 *    to an exponential distribution (constant rate).
 *
 * Reads are live (computed at render time) so editing a source folio updates
 * everything linked to it on the next analysis run.
 */

interface FitRow { Distribution: string; params?: Record<string, number> }
interface FolioLite {
  id: string
  name: string
  setDist?: string | null
  result?: { best_distribution: string | null; results: FitRow[] } | null
}
interface LdaStateLite { folios?: FolioLite[] }

// Prediction module is folio-wrapped; each folio's state holds a computed result
// with the predicted total failure rate in failures-per-million-hours (FPMH).
interface PredFolioLite { id: string; name: string; state?: { result?: { total_failure_rate?: number; mtbf_hours?: number | null } | null } }
interface PredStateLite { folios?: PredFolioLite[] }

export type LdaDistKind =
  'exponential' | 'weibull' | 'normal' | 'lognormal' | 'gamma' | 'loglogistic' | 'gumbel' | 'beta'

export type SourceModule = 'lda' | 'prediction'

export interface ReliabilitySource {
  id: string                     // unique across modules (prediction ids are 'pred:<folio>')
  module: SourceModule
  moduleLabel: string            // 'Life Data' | 'Prediction' — for grouping in pickers
  name: string
  sourceDist: string             // e.g. 'Weibull_2P' or 'Predicted (exponential)'
  dist: LdaDistKind
  dist_params: Record<string, number>
  label: string                  // human-friendly summary
}

// Back-compat alias — existing FTA/RBD code refers to LdaFolioSource.
export type LdaFolioSource = ReliabilitySource

interface MappedDist { sourceDist: string; dist: LdaDistKind; dist_params: Record<string, number> }

/** Map a fitted distribution + params to the FTA/RBD backend shape. Covers all
 *  13 parametric fitters; returns null only when required params are missing. */
function mapDist(sourceDist: string, p: Record<string, number>): MappedDist | null {
  const g = p.gamma                                  // location (3P fits)
  const withGamma = (d: Record<string, number>) => g != null ? { ...d, gamma: g } : d

  if (sourceDist.startsWith('Weibull')) {
    const alpha = p.alpha ?? p.eta
    const beta = p.beta
    if (alpha == null || beta == null) return null
    return { sourceDist, dist: 'weibull', dist_params: withGamma({ alpha, beta }) }
  }
  if (sourceDist.startsWith('Exponential')) {
    const lambda = p.Lambda ?? p.lambda
    if (lambda == null) return null
    return { sourceDist, dist: 'exponential', dist_params: withGamma({ lambda }) }
  }
  if (sourceDist.startsWith('Lognormal')) {
    if (p.mu == null || p.sigma == null) return null
    return { sourceDist, dist: 'lognormal', dist_params: withGamma({ mu: p.mu, sigma: p.sigma }) }
  }
  if (sourceDist.startsWith('Normal')) {
    if (p.mu == null || p.sigma == null) return null
    return { sourceDist, dist: 'normal', dist_params: { mu: p.mu, sigma: p.sigma } }
  }
  if (sourceDist.startsWith('Gamma')) {
    if (p.alpha == null || p.beta == null) return null
    return { sourceDist, dist: 'gamma', dist_params: withGamma({ alpha: p.alpha, beta: p.beta }) }
  }
  if (sourceDist.startsWith('Loglogistic')) {
    if (p.alpha == null || p.beta == null) return null
    return { sourceDist, dist: 'loglogistic', dist_params: withGamma({ alpha: p.alpha, beta: p.beta }) }
  }
  if (sourceDist.startsWith('Gumbel')) {
    if (p.mu == null || p.sigma == null) return null
    return { sourceDist, dist: 'gumbel', dist_params: { mu: p.mu, sigma: p.sigma } }
  }
  if (sourceDist.startsWith('Beta')) {
    if (p.alpha == null || p.beta == null) return null
    return { sourceDist, dist: 'beta', dist_params: { alpha: p.alpha, beta: p.beta } }
  }
  return null
}

function summarize(s: { sourceDist: string; dist_params: Record<string, number> }): string {
  const e = Object.entries(s.dist_params)
    .map(([k, v]) => `${k}=${Number(v).toPrecision(4)}`).join(', ')
  return `${s.sourceDist} (${e})`
}

/** Fitted Life-Data folios usable as a source. */
function ldaSources(lda: LdaStateLite): ReliabilitySource[] {
  const out: ReliabilitySource[] = []
  for (const f of lda.folios ?? []) {
    if (!f.result || !Array.isArray(f.result.results)) continue
    // Prefer the user-pinned distribution, else the best fit; fall back to the
    // first result row that actually carries fitted parameters.
    const distName = f.setDist || f.result.best_distribution
    let row = f.result.results.find(r => r.Distribution === distName)
    if (!row?.params) row = f.result.results.find(r => r.params)
    if (!row?.params) continue
    const mapped = mapDist(row.Distribution, row.params)
    if (!mapped) continue
    out.push({ id: f.id, module: 'lda', moduleLabel: 'Life Data', name: f.name, label: summarize(mapped), ...mapped })
  }
  return out
}

/** Failure-rate Prediction folios → exponential (constant-rate) sources.
 *  The predicted total failure rate is in FPMH, so λ (per hour) = FPMH / 1e6. */
function predictionSources(pred: PredStateLite): ReliabilitySource[] {
  const out: ReliabilitySource[] = []
  for (const f of pred.folios ?? []) {
    const fpmh = f.state?.result?.total_failure_rate
    if (fpmh == null || !(fpmh > 0)) continue
    const lambda = fpmh / 1e6
    const params = { lambda }
    out.push({
      id: `pred:${f.id}`, module: 'prediction', moduleLabel: 'Prediction', name: f.name,
      sourceDist: 'Predicted (exponential)', dist: 'exponential', dist_params: params,
      label: `λ=${lambda.toPrecision(4)} /hr`,
    })
  }
  return out
}

/** Hook returning every reliability source (Life Data + Prediction folios). */
export function useReliabilitySources(): ReliabilitySource[] {
  const lda = useModuleActiveState<LdaStateLite>('lifeData', { folios: [] })
  const pred = useModuleState<PredStateLite>('prediction', { folios: [] })[0]
  return [...ldaSources(lda), ...predictionSources(pred ?? { folios: [] })]
}

/** Back-compat hook: only the Life-Data sources. */
export function useLdaFolios(): ReliabilitySource[] {
  const lda = useModuleActiveState<LdaStateLite>('lifeData', { folios: [] })
  return ldaSources(lda)
}
