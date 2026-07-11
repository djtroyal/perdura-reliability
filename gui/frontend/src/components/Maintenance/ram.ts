import type {
  AvailabilityResponse, MaintainabilityResponse, SparesResponse,
} from '../../api/client'

// Shared persisted state for the availability/maintainability/spares tools,
// which were relocated here from the former RAM module. The store slice key
// stays 'ram' so existing saved projects, unit-conversion rules and Report
// Builder assets keep working unchanged.

export interface AvailState {
  mtbf: string; mttr: string; mtbm: string; meanMaint: string
  adminDelay: string; logiDelay: string; result: AvailabilityResponse | null
}
export interface MaintState {
  mode: 'lognormal' | 'data'; mu: string; sigma: string; samples: string
  percentile: string; result: MaintainabilityResponse | null
}
export interface SparesState {
  quantity: string; opHours: string; dutyCycle: string
  basis: 'mtbf' | 'rate'; mtbf: string; rate: string; confidence: string
  model: 'poisson' | 'negative_binomial' | 'renewal_pipeline'
  dispersion: string; renewalBasis: 'exponential' | 'weibull'
  weibullAlpha: string; weibullBeta: string
  leadMean: string; leadStd: string; shockRate: string; shockSize: string
  simulations: string; seed: string
  result: SparesResponse | null
}
export interface RamState { avail: AvailState; maint: MaintState; spares: SparesState }

export const INITIAL: RamState = {
  avail: { mtbf: '', mttr: '', mtbm: '', meanMaint: '', adminDelay: '0', logiDelay: '0', result: null },
  maint: { mode: 'lognormal', mu: '', sigma: '', samples: '', percentile: '0.95', result: null },
  spares: {
    quantity: '', opHours: '8760', dutyCycle: '1', basis: 'mtbf', mtbf: '', rate: '', confidence: '0.95',
    model: 'poisson', dispersion: '10', renewalBasis: 'exponential',
    weibullAlpha: '', weibullBeta: '', leadMean: '720', leadStd: '168',
    shockRate: '0', shockSize: '2', simulations: '5000', seed: '42', result: null,
  },
}

/** Parse a possibly-blank numeric string to a number or null.
 *
 * Optional input is intentional: persisted projects can predate a newly
 * introduced field. Callers merge current defaults, but this keeps schema
 * migrations from becoming a render-time TypeError if a field is missed.
 */
export const pf = (v?: string | null): number | null => {
  if (v == null) return null
  const t = v.trim()
  if (t === '') return null
  const n = parseFloat(t)
  return isNaN(n) ? null : n
}
