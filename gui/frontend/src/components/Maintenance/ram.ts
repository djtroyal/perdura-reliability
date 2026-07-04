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
  result: SparesResponse | null
}
export interface RamState { avail: AvailState; maint: MaintState; spares: SparesState }

export const INITIAL: RamState = {
  avail: { mtbf: '', mttr: '', mtbm: '', meanMaint: '', adminDelay: '0', logiDelay: '0', result: null },
  maint: { mode: 'lognormal', mu: '', sigma: '', samples: '', percentile: '0.95', result: null },
  spares: { quantity: '', opHours: '8760', dutyCycle: '1', basis: 'mtbf', mtbf: '', rate: '', confidence: '0.95', result: null },
}

/** Parse a possibly-blank numeric string to a number or null. */
export const pf = (v: string): number | null => {
  const t = v.trim()
  if (t === '') return null
  const n = parseFloat(t)
  return isNaN(n) ? null : n
}
