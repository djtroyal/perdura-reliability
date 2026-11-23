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

export type FieldMode = 'mul' | 'inv' | 'mcf_wide' | 'distribution' | 'transition' | 'time_list' | 'exposure_rows' | 'repair_model' | 'system_lifecycle'
export interface FieldRule { path: string; mode: FieldMode }

export const UNIT_RULES: Record<string, FieldRule[]> = {
  // LDA observations and adopted models own explicit dataset units.
  lifeData: [],
  alt: [{ path: 'dataRows[].time', mode: 'mul' }],
  degradation: [
    { path: 'nd.rows[].time', mode: 'mul' }, { path: 'nd.relTime', mode: 'mul' },
    { path: 'dest.rows[].time', mode: 'mul' }, { path: 'dest.relTime', mode: 'mul' },
  ],
  growth: [
    { path: 'rows[]', mode: 'mul' },
    { path: 'groupedRows[].endpoint', mode: 'mul' },
    { path: 'T', mode: 'mul' },
    { path: 'predictionHorizon', mode: 'mul' },
    { path: 'mcf.text', mode: 'mcf_wide' },
    ...['currentTime', 'currentMtbf', 'targetMtbf', 'plannedAdditionalTime'].map(field => ({ path: `planning.${field}`, mode: 'mul' as const })),
    { path: 'planning.phaseDurations', mode: 'time_list' },
    { path: 'planning.unaddressedRate', mode: 'inv' },
    { path: 'planning.actions[].time', mode: 'mul' },
    { path: 'planning.actions[].rate', mode: 'inv' },
  ],
  ram: [
    { path: 'avail.mtbf', mode: 'mul' }, { path: 'avail.mttr', mode: 'mul' },
    { path: 'avail.mtbm', mode: 'mul' }, { path: 'avail.meanMaint', mode: 'mul' },
    { path: 'avail.adminDelay', mode: 'mul' }, { path: 'avail.logiDelay', mode: 'mul' },
    { path: 'spares.opHours', mode: 'mul' }, { path: 'spares.mtbf', mode: 'mul' },
    { path: 'spares.rate', mode: 'inv' },
    ...['weibullAlpha', 'leadMean', 'leadStd'].map(field => ({ path: `spares.${field}`, mode: 'mul' as const })),
    { path: 'spares.shockRate', mode: 'inv' },
    { path: 'maint', mode: 'repair_model' },
  ],
  reliabilityTestingTools: [
    { path: 'aggregateMTBF.totalExposure', mode: 'mul' }, { path: 'aggregateMTBF.exposureText', mode: 'exposure_rows' },
    { path: 'normalSummary.mean', mode: 'mul' }, { path: 'normalSummary.sd', mode: 'mul' },
    ...['goodMtbf', 'badMtbf', 'exposureHorizon', 'observedExposure'].map(field => ({ path: `sequentialSampling.${field}`, mode: 'mul' as const })),
    { path: 'sequentialSampling.failureTimes', mode: 'time_list' },
  ],
  lifeTools: [
    ...['eta', 'percentileLife', 'interval', 'cmDowntime', 'pmDowntime', 'firstAge', 'secondAge'].map(field => ({ path: field, mode: 'mul' as const })),
    { path: 'ages', mode: 'time_list' }, { path: 'durations', mode: 'time_list' },
  ],
  maintInventory: [
    { path: 'horizon', mode: 'mul' },
    ...['eta', 'lead', 'leadSd', 'age', 'entry', 'exit'].map(field => ({ path: `rows[].${field}`, mode: 'mul' as const })),
    { path: 'rows[].rate', mode: 'inv' }, { path: 'rows[].storageRate', mode: 'inv' },
  ],
  faultTree: [
    { path: 'exposureTime', mode: 'mul' }, { path: 'nodes[].data.exposure_time', mode: 'mul' },
    { path: 'nodes[].data', mode: 'distribution' },
    { path: 'lifecycle', mode: 'system_lifecycle' },
  ],
  system: [
    { path: 'missionTime', mode: 'mul' }, { path: 'nodes[].data.mission_time', mode: 'mul' },
    { path: 'nodes[].data', mode: 'distribution' },
    { path: 'lifecycle', mode: 'system_lifecycle' },
  ],
  markov: [{ path: 'tMax', mode: 'mul' }, { path: 'transitions[]', mode: 'transition' },
    { path: 'canvasEdges[].data', mode: 'transition' }],
  // Maintenance module (flat slices). Weibull α (scale) is time-valued; β is a
  // dimensionless shape and costs are money, so neither is converted.
  maintReplacement: [{ path: 'alpha', mode: 'mul' }],
  maintPMInterval: [{ path: 'alpha', mode: 'mul' }, { path: 'horizon', mode: 'mul' }],
  maintCostForecast: [
    { path: 'alpha', mode: 'mul' }, { path: 'horizon', mode: 'mul' }, { path: 'interval', mode: 'mul' },
  ],
  maintFleet: [{ path: 'alpha', mode: 'mul' }, { path: 'horizon', mode: 'mul' },
    { path: 'cohorts[].age', mode: 'mul' }, { path: 'cohorts[].entry', mode: 'mul' }, { path: 'cohorts[].exit', mode: 'mul' }],
  maintAvailability: [
    { path: 'mtbf', mode: 'mul' }, { path: 'mttr', mode: 'mul' },
    { path: 'admin', mode: 'mul' }, { path: 'logistics', mode: 'mul' },
  ],
  reliabilityAllocation: [{ path: 'missionTime', mode: 'mul' }, { path: 'targetMtbf', mode: 'mul' }],
  // Prediction's handbook rates and mission inputs explicitly use hours.
  prediction: [],
}

type Transform = (v: unknown) => unknown

function makeTransform(from: string, to: string, mode: FieldMode): Transform {
  return (v: unknown) => {
    if (v == null || v === '') return v
    if (mode === 'system_lifecycle') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return v
      const data = v as Record<string, unknown>
      const settings = { ...(data.settings as Record<string, unknown> ?? {}) }
      const mul = makeTransform(from, to, 'mul')
      for (const field of ['interval', 'downtime', 'horizon', 'warmup']) settings[field] = mul(settings[field])
      const duration = (value: unknown) => {
        const d = value as { distribution: string; params: Record<string, unknown> } | undefined
        if (!d?.params) return value
        const params = { ...d.params }
        for (const field of d.distribution === 'exponential' ? ['mean'] : d.distribution === 'deterministic' ? ['value'] : d.distribution === 'weibull' ? ['alpha'] : d.distribution === 'gamma' ? ['beta'] : d.distribution === 'normal' ? ['mu', 'sigma'] : []) params[field] = mul(params[field])
        if (d.distribution === 'lognormal' && Number.isFinite(Number(params.mu))) params.mu = Number(params.mu) + Math.log(convert(1, from, to))
        return { ...d, params }
      }
      settings.policies = Object.fromEntries(Object.entries(settings.policies as Record<string, Record<string, unknown>> ?? {}).map(([key, p]) => [key, { ...p,
        pm_interval: mul(p.pm_interval), supply_lead_time: mul(p.supply_lead_time), repair: duration(p.repair), pm_duration: duration(p.pm_duration) }]))
      return { ...data, settings, modelSignature: undefined }
    }
    if (mode === 'time_list') {
      if (typeof v !== 'string') return v
      return v.split(/([\s,:;]+)/).map(token => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(token)
        ? String(convert(Number(token), from, to)) : token).join('')
    }
    if (mode === 'exposure_rows') {
      if (typeof v !== 'string') return v
      const rows = v.split(/\r?\n/).map(row => row.trim().split(/[\s,]+/))
      if (rows.some(row => row[0] && (row.length !== 3 || row.some(x => !Number.isFinite(Number(x)))))) return v
      return rows.map(row => row[0] ? [row[0], convert(Number(row[1]), from, to), row[2]].join(', ') : '').join('\n')
    }
    if (mode === 'repair_model') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return v
      const data = { ...v as Record<string, unknown> }
      const mu = data.mu
      if (typeof mu === 'string' && mu.trim() && Number.isFinite(Number(mu))) data.mu = String(Number(mu) + Math.log(convert(1, from, to)))
      data.mttr = makeTransform(from, to, 'mul')(data.mttr)
      if (typeof data.samples === 'string') data.samples = data.mode === 'frequency'
        ? data.samples.split(/\r?\n/).map(row => { const parts = row.trim().split(/[\s,]+/); return parts.length === 2 && Number.isFinite(Number(parts[0])) ? `${convert(Number(parts[0]), from, to)}, ${parts[1]}` : row }).join('\n')
        : makeTransform(from, to, 'time_list')(data.samples)
      return data
    }
    if (mode === 'transition') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return v
      const data = v as Record<string, unknown>
      return data.sourceId ? v : { ...data, rate: makeTransform(from, to, 'inv')(data.rate) }
    }
    if (mode === 'distribution') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return v
      const data = v as Record<string, unknown>
      // Live links resolve from source-owned units at the calculation boundary.
      if (data.distributionSource != null || data.ldaFolioId || data.ldaSource || data.sourceId) return v
      const distribution = String(data.distribution ?? '')
      if (!['exponential', 'weibull', 'normal', 'lognormal', 'gamma', 'loglogistic', 'gumbel', 'beta'].includes(distribution)) return v
      // Conversion cannot repair missing/invalid required inputs by inventing a model.
      const parameters = { ...(data.dist_params as Record<string, unknown> ?? {}) }
      if (distribution === 'beta' && parameters.support_scale === undefined) parameters.support_scale = 1
      const mul = makeTransform(from, to, 'mul')
      if (distribution === 'exponential') parameters.lambda = makeTransform(from, to, 'inv')(parameters.lambda)
      else if (distribution === 'lognormal') {
        const value = parameters.mu, numeric = typeof value === 'string' ? Number(value) : value
        if (typeof numeric === 'number' && Number.isFinite(numeric)) {
          const converted = numeric + Math.log(convert(1, from, to))
          parameters.mu = typeof value === 'string' ? String(converted) : converted
        }
      } else if (distribution === 'normal' || distribution === 'gumbel') {
        parameters.mu = mul(parameters.mu); parameters.sigma = mul(parameters.sigma)
      } else if (distribution === 'gamma') parameters.beta = mul(parameters.beta)
      else if (distribution === 'beta') parameters.support_scale = mul(parameters.support_scale)
      else parameters.alpha = mul(parameters.alpha)
      if (parameters.gamma !== undefined) parameters.gamma = mul(parameters.gamma)
      return { ...data, dist_params: parameters }
    }
    if (mode === 'mcf_wide') {
      if (typeof v !== 'string') return v
      const numberToken = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/
      const converted: string[] = []
      for (const raw of v.split(/\r?\n/)) {
        if (!raw.trim()) { converted.push(raw); continue }
        const parts = raw.split('|')
        if (parts.length !== 2) return v
        const eventText = parts[0].trim()
        const events = eventText ? eventText.split(/[\s,]+/).filter(Boolean) : []
        const end = parts[1].trim()
        const observations = events.map(token => token.split(':'))
        if (!observations.every(parts => parts.length <= 2 && parts.every(token => numberToken.test(token)))
          || !numberToken.test(end)) return v
        const scale = (token: string) => String(convert(Number(token), from, to))
        converted.push(`${observations.map(([time,cost]) => cost === undefined ? scale(time) : `${scale(time)}:${cost}`).join(', ')} | ${scale(end)}`)
      }
      return converted.join('\n')
    }
    const isStr = typeof v === 'string'
    if (isStr && !v.trim()) return v
    const n = isStr ? Number(v) : (v as number)
    if (typeof n !== 'number' || !isFinite(n)) return v
    const out = mode === 'inv' ? convert(n, to, from) : convert(n, from, to)
    return isStr ? String(out) : out
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
