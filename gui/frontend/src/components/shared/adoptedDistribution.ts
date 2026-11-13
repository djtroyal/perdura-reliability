import { sha256FtaText } from '../FaultTree/libraryModel.ts'
import { quantityConversionFactor, quantityFromProjectUnit, validateDatasetQuantity, type DatasetQuantity } from './datasetUnits.ts'

export type { DatasetQuantity } from './datasetUnits.ts'
export interface DistributionSourceRef { module: 'lifeData' | 'prediction'; analysisId: string; entityId?: string }
export interface FitProvenance {
  schemaVersion: 1
  observationFingerprint: string
  fitFingerprint: string
  engineRevision: number
  quantity: DatasetQuantity
}
export interface AdoptedDistribution extends FitProvenance {
  sourceKind: 'fitted' | 'specified'
  distribution: string
  parameters: Record<string, number>
  modelFingerprint: string
  adoptedAt: string
  fitStatistics?: { logLikelihood: number|null; AICc:number|null; BIC:number|null; AD:number|null }
}
export interface LifeDataModelFolio {
  id: string; name?: string; dataFormat?: string; rows?: { time: string; state: string; id?: string }[]
  frequencyRows?: { time: string; state: string; count: string; id?: string }[]
  intervalRows?: { lower: string; upper: string; count: string; id?: string }[]
  quantity?: DatasetQuantity; method?: string; ci?: number; selectedDists?: string[]
  dataSource?: string; analysisMode?: string; dataSig?: string | null; setDist?: string | null
  spec?: { distribution: string; params: Record<string, string>; mcMode?: string }
  specResult?: { distribution: string; params: Record<string, number> } | null
  result?: { results: { Distribution: string; params?: Record<string, number | null>; fit_eligible?: boolean; method?: string | null;
    LogLik?:number|null; AICc?:number|null; BIC?:number|null; AD?:number|null }[]; CI?: number } | null
  fitProvenance?: FitProvenance | null
  adoptedDistribution?: AdoptedDistribution | null
}
export interface SourceOptions { projectUnit?: string; engineRevision?: number }
export type ResolvedDistribution = {
  status: 'current'; reason: string; source: DistributionSourceRef
  model: AdoptedDistribution; fingerprint: string
} | {
  status: 'missing' | 'unconfirmed' | 'stale' | 'incompatible'
  reason: string
  source?: DistributionSourceRef
  model?: AdoptedDistribution
  fingerprint?: string
}
export interface DistributionRunSnapshot {
  source: DistributionSourceRef
  fingerprint: string
  distribution: string
  parameters: Record<string, number>
  quantity: DatasetQuantity
}
export const DISTRIBUTION_PARAMETERS: Readonly<Record<string, readonly string[]>> = {
  Weibull_2P: ['eta', 'beta'], Weibull_3P: ['eta', 'beta', 'gamma'],
  Exponential_1P: ['Lambda'], Exponential_2P: ['Lambda', 'gamma'],
  Normal_2P: ['mu', 'sigma'], Lognormal_2P: ['mu', 'sigma'], Lognormal_3P: ['mu', 'sigma', 'gamma'],
  Gamma_2P: ['alpha', 'beta'], Gamma_3P: ['alpha', 'beta', 'gamma'],
  Loglogistic_2P: ['alpha', 'beta'], Loglogistic_3P: ['alpha', 'beta', 'gamma'],
  Beta_2P: ['alpha', 'beta'], Gumbel_2P: ['mu', 'sigma'],
}
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([,v]) => v !== undefined)
    .sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
export const distributionFingerprint = (value: unknown): string => sha256FtaText(canonical(value))
const number = (raw: string, label: string): number => {
  const n = Number(raw)
  if (!raw.trim() || !Number.isFinite(n)) throw new Error(`${label} must be a finite number.`)
  return n
}
const count = (raw: string, label: string) => {
  const n = number(raw, label)
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`${label} must be a positive integer.`)
  return n
}
export type LifeObservations =
  | { observation_model: 'individual'; failures: number[]; right_censored: number[] }
  | { observation_model: 'frequency_exact'; frequency_observations: { time: number; state: 'F'|'S'; count: number }[] }
  | { observation_model: 'interval_censored'; interval_observations: { lower: number|null; upper: number|null; count: number }[] }

/** The same validated numbers feed the API and fingerprints; display IDs/blank rows do not. */
export function extractLifeObservations(f: LifeDataModelFolio, groupId?: string): LifeObservations {
  const format = f.dataFormat ?? 'individual'
  if (groupId != null && format !== 'individual') throw new Error('ID-group fitting requires individual observations.')
  if (format === 'individual') {
    const failures: number[] = [], right_censored: number[] = []
    for (const [i,r] of (f.rows ?? []).entries()) {
      if (groupId != null && r.id?.trim() !== groupId) continue
      if (!r.time.trim()) {
        if(r.id?.trim()) throw new Error(`Row ${i+1} needs an observation value.`)
        continue
      }
      const t = number(r.time, `Row ${i+1} value`)
      if (t <= 0) throw new Error(`Row ${i+1} value must be greater than zero.`)
      if (r.state !== 'F' && r.state !== 'S') throw new Error(`Row ${i+1} needs an F or S state.`)
      ;(r.state === 'F' ? failures : right_censored).push(t)
    }
    return { observation_model: 'individual', failures: failures.sort((a,b)=>a-b), right_censored: right_censored.sort((a,b)=>a-b) }
  }
  if (format === 'frequency') {
    for(const [i,row] of (f.frequencyRows ?? []).entries()) {
      if(!row.time.trim() && (row.id?.trim() || (row.count.trim() && Number(row.count)!==1))) throw new Error(`Frequency row ${i+1} needs an observation value.`)
    }
    const values = (f.frequencyRows ?? []).filter(r=>r.time.trim()).map((r,i)=>{
      const time = number(r.time, `Frequency row ${i+1} value`)
      if (time <= 0) throw new Error(`Frequency row ${i+1} value must be greater than zero.`)
      if (r.state !== 'F' && r.state !== 'S') throw new Error(`Frequency row ${i+1} needs an F or S state.`)
      return { time, state: r.state as 'F'|'S', count: count(r.count, `Frequency row ${i+1} count`) }
    })
    return { observation_model: 'frequency_exact', frequency_observations: values.sort((a,b)=>a.time-b.time || (a.state < b.state ? -1 : a.state > b.state ? 1 : a.count-b.count)) }
  }
  if (format !== 'interval') throw new Error('Unsupported observation format.')
  for(const [i,row] of (f.intervalRows ?? []).entries()) {
    if(!row.lower.trim() && !row.upper.trim() && (row.id?.trim() || (row.count.trim() && Number(row.count)!==1))) throw new Error(`Interval row ${i+1} needs at least one bound.`)
  }
  const values = (f.intervalRows ?? []).filter(r=>r.lower.trim() || r.upper.trim()).map((r,i)=>{
    const lower = r.lower.trim() ? number(r.lower, `Interval row ${i+1} lower bound`) : null
    const upper = r.upper.trim() ? number(r.upper, `Interval row ${i+1} upper bound`) : null
    if ((lower != null && lower < 0) || (upper != null && upper <= 0) || (lower != null && upper != null && lower >= upper)) {
      throw new Error(`Interval row ${i+1} requires nonnegative lower < positive upper.`)
    }
    return { lower, upper, count: count(r.count, `Interval row ${i+1} count`) }
  })
  return { observation_model: 'interval_censored', interval_observations: values.sort((a,b)=>(a.lower ?? -Infinity)-(b.lower ?? -Infinity) || (a.upper ?? Infinity)-(b.upper ?? Infinity) || a.count-b.count) }
}
export function folioQuantity(f: LifeDataModelFolio, options: SourceOptions = {}): DatasetQuantity {
  return validateDatasetQuantity(f.quantity ?? quantityFromProjectUnit(options.projectUnit))
}
/** Common-family tests fit comparable observations in one explicit unit. */
export function lifeDataComparisonObservations(folios: readonly LifeDataModelFolio[], options: SourceOptions = {}) {
  if(!folios.length) throw new Error('Select datasets to compare.')
  const quantity=folioQuantity(folios[0],options)
  return {quantity,folios:folios.map(f=>{
    const observations=extractLifeObservations(f)
    if(observations.observation_model!=='individual') throw new Error(`Dataset "${f.name ?? f.id}" uses grouped observations. The common-family test requires individual observations.`)
    const scale=quantityConversionFactor(folioQuantity(f,options),quantity)
    return {id:f.id,name:f.name ?? f.id,failures:observations.failures.map(value=>value*scale),
      right_censored:observations.right_censored.map(value=>value*scale)}
  })}
}
export function lifeDataObservationSignature(f: LifeDataModelFolio, _options: SourceOptions = {}): string {
  return distributionFingerprint(extractLifeObservations(f))
}
export function fitInputFingerprint(f: LifeDataModelFolio, options: SourceOptions = {}): string {
  return distributionFingerprint({ observations: f.dataSource === 'spec' ? null : extractLifeObservations(f),
    spec: f.dataSource === 'spec' ? { distribution: f.spec?.distribution,
      parameters: validateDistributionParameters(f.spec?.distribution ?? '', f.spec?.params ?? {}) } : null,
    method: f.dataSource === 'spec' ? 'specified' : (f.dataFormat ?? 'individual') === 'individual' ? f.method ?? 'MLE' : 'MLE',
    confidence: f.ci ?? .95, quantity: folioQuantity(f,options), engineRevision: options.engineRevision ?? 2 })
}
const specifiedFingerprint = (f:LifeDataModelFolio) => distributionFingerprint({distribution:f.spec?.distribution,
  parameters:validateDistributionParameters(f.spec?.distribution ?? '',f.spec?.params ?? {})})
export function createFitProvenance(f: LifeDataModelFolio, options: SourceOptions = {}): FitProvenance {
  return { schemaVersion: 1, observationFingerprint: f.dataSource === 'spec' ? specifiedFingerprint(f) : lifeDataObservationSignature(f),
    fitFingerprint: fitInputFingerprint(f, options), engineRevision: options.engineRevision ?? 2, quantity: folioQuantity(f,options) }
}
export function validateDistributionParameters(distribution: string, values: Record<string, unknown>): Record<string, number> {
  const fields = DISTRIBUTION_PARAMETERS[distribution]
  if (!fields) throw new Error(`Unsupported distribution: ${distribution}.`)
  return Object.fromEntries(fields.map(field=>{
    const raw = values[field] ?? (field === 'eta' ? values.alpha : undefined)
    if (raw == null || (typeof raw === 'string' && !raw.trim())) throw new Error(`Missing ${distribution} parameter ${field}.`)
    if (typeof raw !== 'number' && typeof raw !== 'string') throw new Error(`Invalid ${distribution} parameter ${field}.`)
    const value = Number(raw)
    if (!Number.isFinite(value) || (!['mu','gamma'].includes(field) && value <= 0)
      || (field==='gamma' && value<0)) throw new Error(`Invalid ${distribution} parameter ${field}.`)
    return [field,value]
  }))
}
/** Legacy signatures may be verified, but missing provenance is never treated as proof. */
export function isLifeDataObservationCurrent(f: LifeDataModelFolio): boolean {
  try {
    if (!f.dataSig) return false
    const format = f.dataFormat ?? 'individual'
    const observations = format === 'frequency' ? f.frequencyRows ?? [] : format === 'interval' ? f.intervalRows ?? []
      : (f.rows ?? []).map(r=>({t:r.time,s:r.state}))
    return f.dataSig === lifeDataObservationSignature(f) || f.dataSig === JSON.stringify({format,observations})
      || (format === 'individual' && f.dataSig === JSON.stringify(observations))
  } catch { return false }
}
export function isLifeDataFitCurrent(f: LifeDataModelFolio, options: SourceOptions = {}): boolean {
  try {
    if (f.fitProvenance) return f.fitProvenance.engineRevision === (options.engineRevision ?? 2)
      && f.fitProvenance.observationFingerprint === (f.dataSource === 'spec' ? specifiedFingerprint(f) : lifeDataObservationSignature(f))
      && canonical(f.fitProvenance.quantity) === canonical(folioQuantity(f,options))
    if (f.dataSource === 'spec') return !!f.specResult && f.spec?.mcMode !== 'equation'
      && f.specResult.distribution === f.spec?.distribution
      && canonical(validateDistributionParameters(f.spec.distribution, f.spec.params)) === canonical(validateDistributionParameters(f.specResult.distribution,f.specResult.params))
    if (!f.result || !f.dataSig) return false
    return isLifeDataObservationCurrent(f)
  } catch { return false }
}
export function adoptDistribution(f: LifeDataModelFolio, distribution: string, options: SourceOptions = {}): AdoptedDistribution {
  if (!isLifeDataFitCurrent(f,options)) throw new Error('Refit the current dataset and settings before adopting a distribution.')
  let parameters: Record<string, number>
  if (f.dataSource === 'spec') {
    if (distribution !== f.spec?.distribution || f.spec.mcMode === 'equation') throw new Error('Show the specified model before adopting it.')
    parameters = validateDistributionParameters(distribution,f.spec.params)
  } else {
    const row = f.result?.results.find(row=>row.Distribution === distribution)
    if (!row?.fit_eligible) throw new Error('Only an eligible fit can be adopted.')
    parameters = validateDistributionParameters(distribution,row.params ?? {})
  }
  const provenance = f.fitProvenance ?? createFitProvenance({...f,ci:f.result?.CI ?? f.ci,
    method:f.result?.results.find(row=>row.Distribution===distribution)?.method ?? f.method},options)
  const sourceKind: AdoptedDistribution['sourceKind'] = f.dataSource === 'spec' ? 'specified' : 'fitted'
  const row=f.result?.results.find(row=>row.Distribution===distribution)
  const fitStatistics=sourceKind==='fitted' ? {logLikelihood:row?.LogLik ?? null,AICc:row?.AICc ?? null,BIC:row?.BIC ?? null,AD:row?.AD ?? null} : undefined
  const contents={...provenance,sourceKind,distribution,parameters,fitStatistics}
  return { ...contents,modelFingerprint:distributionFingerprint(contents),adoptedAt:new Date().toISOString() }
}
export function resolveAdoptedDistribution(f: LifeDataModelFolio | undefined, options: SourceOptions = {}): ResolvedDistribution {
  if (!f) return {status:'missing',reason:'The source dataset is missing.'}
  const source: DistributionSourceRef = {module:'lifeData',analysisId:f.id}
  const model = f.adoptedDistribution
  if (!model) return {status:'unconfirmed',reason:'Set a dataset distribution in Life Data first.',source}
  try {
    if (model.schemaVersion !== 1 || !['fitted','specified'].includes(model.sourceKind)) throw new Error('Unsupported adopted model provenance.')
    validateDistributionParameters(model.distribution, model.parameters)
    validateDatasetQuantity(model.quantity)
    const observationFingerprint = model.sourceKind === 'specified' ? specifiedFingerprint(f) : lifeDataObservationSignature(f)
    if (model.engineRevision !== (options.engineRevision ?? 2) || model.observationFingerprint !== observationFingerprint
        || canonical(model.quantity) !== canonical(folioQuantity(f,options))) {
      return {status:'stale',reason:'The source observations, units, or analysis engine changed. Refit and adopt a current model.',source,model}
    }
    const {adoptedAt: _date, modelFingerprint, ...contents} = model
    if (distributionFingerprint(contents) !== modelFingerprint) return {status:'incompatible',reason:'The saved adopted model is malformed or its provenance does not match.',source,model}
    return {status:'current',reason:'Current adopted dataset model.',source,model,fingerprint:model.modelFingerprint}
  } catch(e) { return {status:'incompatible',reason:e instanceof Error ? e.message : 'Invalid source model.',source,model} }
}
export function resolveDistributionSource(folios: readonly LifeDataModelFolio[], ref: DistributionSourceRef, options: SourceOptions = {}): ResolvedDistribution {
  if (ref.module !== 'lifeData') return {status:'incompatible',reason:'Unsupported distribution source module.'}
  return resolveAdoptedDistribution(folios.find(f=>f.id===ref.analysisId),options)
}
export function distributionRunSnapshot(resolved: ResolvedDistribution): DistributionRunSnapshot {
  if (resolved.status !== 'current' || !resolved.model || !resolved.source || !resolved.fingerprint) throw new Error(resolved.reason)
  return {source:resolved.source,fingerprint:resolved.fingerprint,distribution:resolved.model.distribution,
    parameters:{...resolved.model.parameters},quantity:{...resolved.model.quantity}}
}
