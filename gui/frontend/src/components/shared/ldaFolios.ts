import { useModuleActiveState } from '../../store/project'

/**
 * Shared access to fitted Life-Data folios so FTA basic events and RBD
 * components can be *defined by an LDA folio* (#4). Reads the lifeData module
 * state, finds folios with a fitted distribution, and normalizes each to the
 * { dist, dist_params } shape the FTA/RBD backends understand
 * (exponential | weibull | normal | lognormal).
 */

interface FitRow { Distribution: string; params?: Record<string, number> }
interface FolioLite {
  id: string
  name: string
  setDist?: string | null
  result?: { best_distribution: string; results: FitRow[] } | null
}
interface LdaStateLite { folios?: FolioLite[] }

export interface LdaFolioSource {
  id: string
  name: string
  sourceDist: string             // e.g. 'Weibull_2P'
  dist: 'exponential' | 'weibull' | 'normal' | 'lognormal'
  dist_params: Record<string, number>
  label: string                  // human-friendly summary
}

/** Map a fitted distribution + params to the FTA/RBD backend shape. Returns
 *  null for distributions those backends don't evaluate. */
function mapDist(sourceDist: string, p: Record<string, number>): Omit<LdaFolioSource, 'id' | 'name' | 'label'> | null {
  if (sourceDist.startsWith('Weibull')) {
    const alpha = p.alpha ?? p.eta
    const beta = p.beta
    if (alpha == null || beta == null) return null
    return { sourceDist, dist: 'weibull', dist_params: { alpha, beta } }
  }
  if (sourceDist.startsWith('Exponential')) {
    const lambda = p.Lambda ?? p.lambda
    if (lambda == null) return null
    return { sourceDist, dist: 'exponential', dist_params: { lambda } }
  }
  if (sourceDist.startsWith('Normal')) {
    if (p.mu == null || p.sigma == null) return null
    return { sourceDist, dist: 'normal', dist_params: { mu: p.mu, sigma: p.sigma } }
  }
  if (sourceDist.startsWith('Lognormal')) {
    if (p.mu == null || p.sigma == null) return null
    return { sourceDist, dist: 'lognormal', dist_params: { mu: p.mu, sigma: p.sigma } }
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
    if (!f.result) continue
    const distName = f.setDist || f.result.best_distribution
    const row = f.result.results.find(r => r.Distribution === distName)
    if (!row?.params) continue
    const mapped = mapDist(distName, row.params)
    if (!mapped) continue
    out.push({ id: f.id, name: f.name, label: summarize(mapped), ...mapped })
  }
  return out
}
