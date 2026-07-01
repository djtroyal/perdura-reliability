/**
 * Per-module registry of time-valued fields, used to rescale a project's data
 * when the user switches units (see `convertProjectUnits` in project.ts).
 *
 * Each rule names a path inside a module's *container* (a single folio's state,
 * or a flat module slice) and how to convert it:
 *   - 'mul' — a duration (failure time, MTBF, mission time): new = convert(v, from, to)
 *   - 'inv' — a rate per unit time (Markov transition rate, spares rate):
 *             new = convert(v, to, from)  (the reciprocal scaling)
 *
 * Paths use dot notation; a `[]` suffix iterates an array. The leaf may be an
 * array of scalars ('rows[]') or live on array objects ('rows[].time'). Numeric
 * strings and numbers are both handled, and the original type is preserved.
 */
import { convert } from './units'

export type FieldMode = 'mul' | 'inv'
export interface FieldRule { path: string; mode: FieldMode }

export const UNIT_RULES: Record<string, FieldRule[]> = {
  lifeData: [{ path: 'rows[].time', mode: 'mul' }],
  alt: [{ path: 'dataRows[].time', mode: 'mul' }],
  growth: [{ path: 'rows[]', mode: 'mul' }, { path: 'T', mode: 'mul' }],
  ram: [
    { path: 'avail.mtbf', mode: 'mul' }, { path: 'avail.mttr', mode: 'mul' },
    { path: 'avail.mtbm', mode: 'mul' }, { path: 'avail.meanMaint', mode: 'mul' },
    { path: 'avail.adminDelay', mode: 'mul' }, { path: 'avail.logiDelay', mode: 'mul' },
    { path: 'spares.opHours', mode: 'mul' }, { path: 'spares.mtbf', mode: 'mul' },
    { path: 'spares.rate', mode: 'inv' },
  ],
  markov: [{ path: 'tMax', mode: 'mul' }, { path: 'transitions[].rate', mode: 'inv' }],
  // Maintenance module (flat slices). Weibull α (scale) is time-valued; β is a
  // dimensionless shape and costs are money, so neither is converted.
  maintReplacement: [{ path: 'alpha', mode: 'mul' }],
  maintPMInterval: [{ path: 'alpha', mode: 'mul' }, { path: 'horizon', mode: 'mul' }],
  maintCostForecast: [
    { path: 'alpha', mode: 'mul' }, { path: 'horizon', mode: 'mul' }, { path: 'interval', mode: 'mul' },
  ],
  maintAvailability: [
    { path: 'mtbf', mode: 'mul' }, { path: 'mttr', mode: 'mul' },
    { path: 'admin', mode: 'mul' }, { path: 'logistics', mode: 'mul' },
  ],
  reliabilityAllocation: [{ path: 'missionTime', mode: 'mul' }, { path: 'targetMtbf', mode: 'mul' }],
  prediction: [{ path: 'missionHours', mode: 'mul' }],
}

type Transform = (v: unknown) => unknown

function makeTransform(from: string, to: string, mode: FieldMode): Transform {
  return (v: unknown) => {
    if (v == null || v === '') return v
    const isStr = typeof v === 'string'
    const n = isStr ? parseFloat(v) : (v as number)
    if (typeof n !== 'number' || !isFinite(n)) return v
    const out = mode === 'inv' ? convert(n, to, from) : convert(n, from, to)
    const formatted = parseFloat(out.toPrecision(8))   // strip float noise
    return isStr ? String(formatted) : formatted
  }
}

/** Mutate `node` in place along `segs`, applying `transform` to each leaf. */
function applyPath(node: unknown, segs: string[], transform: Transform): void {
  if (node == null || typeof node !== 'object') return
  const seg = segs[0]
  const rest = segs.slice(1)
  if (seg.endsWith('[]')) {
    const key = seg.slice(0, -2)
    const arr = (node as Record<string, unknown>)[key]
    if (!Array.isArray(arr)) return
    for (let i = 0; i < arr.length; i++) {
      if (rest.length === 0) arr[i] = transform(arr[i])     // array of scalars
      else applyPath(arr[i], rest, transform)               // array of objects
    }
  } else {
    const obj = node as Record<string, unknown>
    if (rest.length === 0) obj[seg] = transform(obj[seg])
    else applyPath(obj[seg], rest, transform)
  }
}

/** Return a converted deep copy of a module container (folio state or flat
 *  slice). Inputs are plain JSON data, so a JSON clone is safe. */
export function convertStateObject(
  obj: unknown, rules: FieldRule[], from: string, to: string,
): unknown {
  if (obj == null || typeof obj !== 'object') return obj
  const clone = JSON.parse(JSON.stringify(obj))
  for (const rule of rules) {
    applyPath(clone, rule.path.split('.'), makeTransform(from, to, rule.mode))
  }
  return clone
}
