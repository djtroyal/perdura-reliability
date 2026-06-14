import { useModuleActiveState } from '../../store/project'

/**
 * Shared access to fitted Life-Data folios so FTA basic events and RBD
 * components can be *defined by an LDA folio* (#4). Reads the lifeData module
 * state, finds folios with a fitted distribution, and normalizes each to the
 * { dist, dist_params } shape the FTA/RBD `computeCDF` understands. All 13
 * parametric fitters are supported.
 */

interface FitRow { Distribution: string; params?: Record<string, number> }
interface FolioLite {
  id: string
  name: string
  setDist?: string | null
  result?: { best_distribution: string; results: FitRow[] } | null
}
interface LdaStateLite { folios?: FolioLite[] }

export type LdaDistKind =
  'exponential' | 'weibull' | 'normal' | 'lognormal' | 'gamma' | 'loglogistic' | 'gumbel' | 'beta'

export interface LdaFolioSource {
  id: string
  name: string
  sourceDist: string             // e.g. 'Weibull_2P'
  dist: LdaDistKind
  dist_params: Record<string, number>
  label: string                  // human-friendly summary
}

/** Map a fitted distribution + params to the FTA/RBD backend shape. Covers all
 *  13 parametric fitters; returns null only when required params are missing. */
function mapDist(sourceDist: string, p: Record<string, number>): Omit<LdaFolioSource, 'id' | 'name' | 'label'> | null {
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

function summarize(s: Omit<LdaFolioSource, 'id' | 'name' | 'label'>): string {
  const e = Object.entries(s.dist_params)
    .map(([k, v]) => `${k}=${Number(v).toPrecision(4)}`).join(', ')
  return `${s.sourceDist} (${e})`
}

/** Hook returning all fitted folios usable as an event/component source. */
export function useLdaFolios(): LdaFolioSource[] {
  const lda = useModuleActiveState<LdaStateLite>('lifeData', { folios: [] })
  const out: LdaFolioSource[] = []
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
    out.push({ id: f.id, name: f.name, label: summarize(mapped), ...mapped })
  }
  return out
}
