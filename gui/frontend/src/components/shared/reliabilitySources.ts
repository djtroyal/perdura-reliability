import { systemInputFingerprint } from '../../store/sharedSystemFingerprint.ts'
import type { SystemDefinitionModel } from '../../api/systemDefinition'
/** Pure calculation-boundary resolution. Cached editor values are never a fallback. */
import { resolveAdoptedDistribution, distributionFingerprint, validateDistributionParameters, type DistributionSourceRef } from './adoptedDistribution.ts'
import { quantityConversionFactor, quantityFromProjectUnit, type DatasetQuantity } from './datasetUnits.ts'

export type LdaDistKind = 'exponential'|'weibull'|'normal'|'lognormal'|'gamma'|'loglogistic'|'gumbel'|'beta'
export type SourceCapability = 'distribution'|'constant-rate'|'weibull-2p'
export interface SourceProject { units: string; modules: Record<string, unknown> }
export interface ReliabilitySource {
  id: string; sourceRef: DistributionSourceRef; module: 'lda'|'prediction'; moduleLabel: string
  name: string; sourceDist: string; dist: LdaDistKind; dist_params: Record<string, number>
  label: string; fingerprint: string; quantity: DatasetQuantity
  snapshot: { source: DistributionSourceRef; fingerprint: string; distribution: string
    parameters: Record<string, number>; quantity: DatasetQuantity; evaluationQuantity: DatasetQuantity; adapterRevision: 1 }
}
// These readers intentionally accept persisted module slices, then validate numerical values below.
const record = (v: unknown): Record<string, any> => v && typeof v === 'object' ? v as Record<string, any> : {}
const EMPTY = Object.freeze({})
const folioIndexes = new WeakMap<object, Map<string, any>>()
const canonicalFingerprintCache = new WeakMap<object, string>()
function canonicalFingerprint(project: SourceProject): string | undefined {
  const model = record(project.modules.systemDefinition).model
  if (!model || typeof model !== 'object' || !model.root_instance_id
    || !Array.isArray(model.instances) || !Array.isArray(model.definitions)) return undefined
  let fingerprint = canonicalFingerprintCache.get(model)
  if (!fingerprint) {
    fingerprint = systemInputFingerprint(model as SystemDefinitionModel)
    canonicalFingerprintCache.set(model, fingerprint)
  }
  return fingerprint
}
const resolutionCache = new WeakMap<object, Map<string, ReliabilitySource | Error>>()
function rememberResolution(folio:object,cache:Map<string,ReliabilitySource|Error>|undefined,key:string,value:ReliabilitySource|Error) {
  const next=cache ?? new Map<string,ReliabilitySource|Error>()
  if(next.size>=16 && !next.has(key))next.delete(next.keys().next().value!)
  next.set(key,value);resolutionCache.set(folio,next)
}
function folioIndex(module: unknown): Map<string, any> {
  const raw=record(module)
  let cached=folioIndexes.get(raw)
  if(!cached) {
    cached=new Map((Array.isArray(raw.folios)?raw.folios:[]).map((f:any)=>[f?.id,f]))
    folioIndexes.set(raw,cached)
  }
  return cached
}
export function sourceRefFromId(id: string): DistributionSourceRef {
  if (!id.startsWith('pred:')) return { module: 'lifeData', analysisId: id }
  const [analysisId, entityId] = id.slice(5).split('::')
  return { module: 'prediction', analysisId, ...(entityId ? { entityId } : {}) }
}
export function sourceId(ref: DistributionSourceRef): string {
  if(!['lifeData','prediction'].includes(ref.module) || typeof ref.analysisId!=='string' || !ref.analysisId.trim())
    return `invalid:${distributionFingerprint(ref)}`
  return ref.module === 'lifeData' ? ref.analysisId : `pred:${ref.analysisId}${ref.entityId ? `::${ref.entityId}` : ''}`
}
export function nodeSourceRef(data: Record<string, any>): DistributionSourceRef | undefined {
  const ref = data.distributionSource
  if (ref != null) {
    // Keep malformed explicit links visible to editors and fail in resolution;
    // never silently select a legacy cached link or crash property rendering.
    return typeof ref==='object' ? ref : {module:'lifeData',analysisId:''}
  }
  const id = data.ldaFolioId || data.ldaSource || data.sourceId
  return typeof id === 'string' && id ? sourceRefFromId(id) : undefined
}

/** Exact positive-scale transformations; location and shape are never discarded. */
export function mapSourceDistribution(name: string, p: Record<string, number>, scale = 1): { dist: LdaDistKind; dist_params: Record<string, number> } {
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Invalid distribution unit conversion.')
  p=validateDistributionParameters(name,p)
  if(p.gamma!=null && p.gamma<0) throw new Error('Lifetime model location must be nonnegative.')
  const positive = (key: string, fallback?: string) => {
    const v = p[key] ?? (fallback ? p[fallback] : undefined)
    if (!Number.isFinite(v) || v <= 0) throw new Error(`Invalid ${key} in adopted ${name}.`)
    return v
  }
  const finite = (key: string, defaultValue?: number) => {
    const v = p[key] ?? defaultValue
    if (v === undefined || !Number.isFinite(v)) throw new Error(`Invalid ${key} in adopted ${name}.`)
    return v
  }
  const gamma = () => finite('gamma', 0) * scale
  if (name.startsWith('Weibull')) return { dist: 'weibull', dist_params: { alpha: positive('alpha','eta')*scale, beta: positive('beta'), gamma: gamma() } }
  if (name.startsWith('Exponential')) return { dist: 'exponential', dist_params: { lambda: positive('Lambda','lambda')/scale, gamma: gamma() } }
  if (name.startsWith('Lognormal')) return { dist: 'lognormal', dist_params: { mu: finite('mu')+Math.log(scale), sigma: positive('sigma'), gamma: gamma() } }
  if (name.startsWith('Normal')) return { dist: 'normal', dist_params: { mu: finite('mu')*scale, sigma: positive('sigma')*scale } }
  if (name.startsWith('Gamma')) return { dist: 'gamma', dist_params: { alpha: positive('alpha'), beta: positive('beta')*scale, gamma: gamma() } }
  if (name.startsWith('Loglogistic')) return { dist: 'loglogistic', dist_params: { alpha: positive('alpha')*scale, beta: positive('beta'), gamma: gamma() } }
  if (name.startsWith('Gumbel')) return { dist: 'gumbel', dist_params: { mu: finite('mu')*scale, sigma: positive('sigma')*scale } }
  if (name.startsWith('Beta')) return { dist: 'beta', dist_params: { alpha: positive('alpha'), beta: positive('beta'), support_scale: scale } }
  throw new Error(`The adopted ${name} model is unsupported by this calculation.`)
}

export function resolveReliabilitySource(project: SourceProject, refOrId: DistributionSourceRef|string,
  capability: SourceCapability = 'distribution'): ReliabilitySource {
  const ref = typeof refOrId === 'string' ? sourceRefFromId(refOrId) : refOrId
  if(!ref || !['lifeData','prediction'].includes(ref.module) || typeof ref.analysisId!=='string' || !ref.analysisId.trim())
    throw new Error('The saved distribution source reference is malformed.')
  if(ref.module==='lifeData' && ref.entityId)throw new Error('Life Data sources reference a whole dataset, not an entity.')
  const sourceModule=record(project.modules[ref.module] ?? EMPTY)
  const sourceFolio=ref.module==='prediction' && !sourceModule._folioWrap
    ? ref.analysisId==='f0' ? sourceModule : undefined : folioIndex(sourceModule).get(ref.analysisId)
  const cacheKey=JSON.stringify([project.units,capability,ref.entityId ?? '',
    ref.module==='prediction' ? canonicalFingerprint(project) ?? 'unverified' : ''])
  const cache=sourceFolio && typeof sourceFolio==='object' ? resolutionCache.get(sourceFolio) : undefined
  const cached=cache?.get(cacheKey)
  if(cached instanceof Error) throw cached
  if(cached) return cached
  try {
    const result=resolveSourceUncached(project,ref,capability)
    if(sourceFolio)rememberResolution(sourceFolio,cache,cacheKey,result)
    return result
  } catch(error) {
    if(sourceFolio && error instanceof Error)rememberResolution(sourceFolio,cache,cacheKey,error)
    throw error
  }
}
function resolveSourceUncached(project: SourceProject, ref:DistributionSourceRef, capability:SourceCapability):ReliabilitySource {
  const evaluationQuantity = quantityFromProjectUnit(project.units)
  let name: string, distribution: string, parameters: Record<string, number>, quantity: DatasetQuantity, fingerprint: string
  if (ref.module === 'lifeData') {
    const folio = folioIndex(project.modules.lifeData).get(ref.analysisId)
    const resolved = resolveAdoptedDistribution(folio, { projectUnit: project.units })
    if (resolved.status !== 'current') throw new Error(`${folio?.name ?? 'LDA dataset'}: ${resolved.reason}`)
    name = folio.name; distribution = resolved.model.distribution; parameters = resolved.model.parameters
    quantity = resolved.model.quantity; fingerprint = resolved.fingerprint
    if (!['time','cycles','distance'].includes(quantity.kind)) throw new Error(`${name}: a ${quantity.kind} dataset cannot define a lifetime model.`)
  } else {
    const raw = record(project.modules.prediction)
    const folio = raw._folioWrap ? folioIndex(raw).get(ref.analysisId)
      : ref.analysisId === 'f0' ? { name: 'Prediction', state: raw } : undefined
    const result = folio?.state?.result
    const canonical = canonicalFingerprint(project)
    if (!canonical || typeof result?.source_fingerprint !== 'string' || result.source_fingerprint !== canonical)
      throw new Error(`${folio?.name ?? 'Prediction'}: shared-system result provenance is missing or changed; calculate current prediction results before using this source.`)
    if (!result || folio.dirty || folio.state.sourceStale
      || (folio.state.sourceSystemFingerprint && result.source_fingerprint!==folio.state.sourceSystemFingerprint))
      throw new Error(`${folio?.name ?? 'Prediction'}: calculate current prediction results before using this source.`)
    let rate = result.total_failure_rate
    name = folio.name
    if (ref.entityId) {
      const [kind, id] = ref.entityId.split(':')
      if(!['block','part'].includes(kind) || !id) throw new Error('The referenced Prediction item is malformed.')
      const entry = kind === 'block' ? result.blocks?.find((b: any) => b.id === id)
        : result.results?.find((p: any) => p.id === id || p.part_id === id)
      if (!entry || entry.error || entry.excluded || entry.incompatible || entry.service_rate_available!==true
        || (kind==='block' && !entry.override_applied && (entry.descendant_part_indices ?? []).some((index:number)=>{
          const part=result.results?.[index];return !part || part.incompatible || part.excluded || part.service_rate_available===false
        }))) throw new Error('The referenced Prediction item is unavailable or incomplete.')
      rate = entry.total_failure_rate; name = `${name} — ${entry.name ?? id}`
    } else if(result.service_rate_available!==true || result.excluded_part_count>0 || result.incompatible?.length)
      throw new Error(`${name}: an incomplete prediction total cannot define a source distribution.`)
    if (!Number.isFinite(rate) || rate <= 0) throw new Error(`${name}: a positive, complete predicted rate is required.`)
    distribution = 'Exponential_1P'; parameters = { Lambda: rate/1e6 }; quantity = { kind: 'time', unit: 'hours' }
    fingerprint = distributionFingerprint([ref, rate, result.source_fingerprint ?? result.result_context ?? ''])
  }
  const mapped = mapSourceDistribution(distribution, parameters, quantityConversionFactor(quantity, evaluationQuantity))
  if(Object.entries(mapped.dist_params).some(([key,value])=>!Number.isFinite(value)
    || (!['mu','gamma'].includes(key) && value<=0)))throw new Error(`${name}: converted model parameters are outside the supported numerical range.`)
  if (capability === 'constant-rate' && (mapped.dist !== 'exponential' || (mapped.dist_params.gamma ?? 0) !== 0))
    throw new Error(`${name}: constant-rate transitions require an exponential model with zero location.`)
  if (capability === 'weibull-2p' && (mapped.dist !== 'weibull' || (mapped.dist_params.gamma ?? 0) !== 0))
    throw new Error(`${name}: this maintenance calculation requires a Weibull model with zero location.`)
  const module = ref.module === 'lifeData' ? 'lda' : 'prediction'
  return { id: sourceId(ref), sourceRef: ref, module, moduleLabel: module === 'lda' ? 'Life Data' : 'Prediction',
    name, sourceDist: distribution, ...mapped, quantity: evaluationQuantity,
    fingerprint: distributionFingerprint([fingerprint,evaluationQuantity,mapped]),
    label: `${distribution} (${Object.entries(mapped.dist_params).map(([k,v])=>`${k}=${Number(v.toPrecision(5))}`).join(', ')}) · ${project.units}`,
    snapshot: { source: ref, fingerprint, distribution, parameters: {...parameters}, quantity, evaluationQuantity, adapterRevision: 1 } }
}
export function listReliabilitySources(project: SourceProject, capability: SourceCapability = 'distribution', includeEntities = false): ReliabilitySource[] {
  const lifeFolios=record(project.modules.lifeData).folios
  const refs: DistributionSourceRef[] = (Array.isArray(lifeFolios)?lifeFolios:[]).map((f: any)=>({module:'lifeData',analysisId:f.id}))
  const prediction = record(project.modules.prediction)
  for (const f of prediction._folioWrap ? Array.isArray(prediction.folios)?prediction.folios:[] : prediction.result ? [{id:'f0',state:prediction}] : []) {
    refs.push({module:'prediction',analysisId:f.id})
    if (includeEntities) {
      for (const part of f.state?.result?.results ?? []) if (part.part_id || part.id)
        refs.push({ module:'prediction', analysisId:f.id, entityId:`part:${part.part_id || part.id}` })
      for (const block of f.state?.result?.blocks ?? [])
        refs.push({ module:'prediction', analysisId:f.id, entityId:`block:${block.id}` })
    }
  }
  return refs.flatMap(ref=>{try{return [resolveReliabilitySource(project,ref,capability)]}catch{return []}})
}
export function resolveLinkedNodes<T extends {id: string; data: Record<string, any>}>(project: SourceProject, nodes: T[]): T[] {
  return nodes.map(node=>{
    if (node.data.systemReferenceBroken) throw new Error(`${node.data.label ?? node.id}: its system item was deleted. Relink or detach before calculating.`)
    const ref=nodeSourceRef(node.data)
    if (!ref) return node
    const source=resolveReliabilitySource(project,ref)
    return {...node,data:{...node.data,distributionSource:ref,sourceError:undefined,distribution:source.dist,dist_params:source.dist_params,
      sourceSnapshot:source.snapshot,sourceFingerprint:source.fingerprint}}
  })
}
export interface SourceDependencies { refs: Map<string,DistributionSourceRef>; issues: string[] }
const referenceCache=new WeakMap<object,SourceDependencies>()
const skippedKeys=new Set(['result','ssResult','historicalResult','sourceSnapshot','resultProvenance','sourceSnapshots',
  'ssProvenance','mcRunProvenance','adoptedCurves','fitProvenance','adoptedDistribution','params','dist_params'])
const noDependencies:SourceDependencies={refs:new Map(),issues:[]}
function mergeDependencies(into:SourceDependencies, from:SourceDependencies) {
  for(const [id,ref]of from.refs)into.refs.set(id,ref)
  for(const issue of from.issues)if(!into.issues.includes(issue))into.issues.push(issue)
}
/** Immutable object caches let a changed tree reuse every unchanged node. */
export function linkedSourceDependencies(value:unknown):SourceDependencies {
  if(!value || typeof value!=='object')return noDependencies
  const cached=referenceCache.get(value)
  if(cached)return cached
  const dependencies:SourceDependencies={refs:new Map(),issues:[]}
  referenceCache.set(value,dependencies)
  if(Array.isArray(value))for(const child of value)mergeDependencies(dependencies,linkedSourceDependencies(child))
  else {
    const obj=record(value)
    try {const ref=nodeSourceRef(obj);if(ref)dependencies.refs.set(sourceId(ref),ref)}
    catch(error){dependencies.issues.push((error as Error).message)}
    if(typeof obj.srcId==='string' && obj.srcId)dependencies.refs.set(obj.srcId,sourceRefFromId(obj.srcId))
    for(const [key,child]of Object.entries(obj))if(!skippedKeys.has(key))mergeDependencies(dependencies,linkedSourceDependencies(child))
  }
  return dependencies
}
export function resolvedSourceDependencies(project:SourceProject, dependencies:SourceDependencies):{fingerprint:string;issues:string[]} {
  const issues=[...dependencies.issues]
  const values=[...dependencies.refs].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([id,ref])=>{
    try{return[id,resolveReliabilitySource(project,ref).fingerprint]}
    catch(error){issues.push(error instanceof Error?error.message:'Unavailable source');return[id,'unavailable']}
  })
  return {fingerprint:distributionFingerprint(dependencies.issues.length ? {sources:values,issues:dependencies.issues} : values),issues}
}
export function linkedSourcesFingerprint(project:SourceProject,value:unknown):string {
  return resolvedSourceDependencies(project,linkedSourceDependencies(value)).fingerprint
}

// Keep only recent graph closures: undo history can retain many old wrappers.
const graphDependencyCache=new Map<object,Map<string,SourceDependencies>>()
const graphEntryCache=new WeakMap<object,Map<string,any>>()
const graphTargetCache=new WeakMap<object,{faultTree:string[];system:string[]}>()
const closureMemo=new Map<string,{direct:string;children:SourceDependencies[];value:SourceDependencies}>()
/** Source closures depend on definitions, never on a child result's freshness. */
export function analysisSourceDependencies(project:SourceProject,moduleKey:string,analysisId:string,activeState?:unknown):SourceDependencies {
  const raw=record(project.modules[moduleKey])
  let cache=activeState ? undefined : graphDependencyCache.get(raw)
  const keyFor=(id:string)=>`${moduleKey}\0${id}`
  const previous=cache?.get(keyFor(analysisId));if(previous)return previous
  if(!cache){cache=new Map();if(!activeState){
    if(graphDependencyCache.size>=4)graphDependencyCache.delete(graphDependencyCache.keys().next().value!)
    graphDependencyCache.set(raw,cache)
  }}
  let entries=graphEntryCache.get(raw)
  if(!entries){entries=new Map((Array.isArray(raw.folios)?raw.folios:[]).map((f:any)=>[f.id,f.state]));graphEntryCache.set(raw,entries)}
  if(activeState){entries=new Map(entries);entries.set(analysisId,activeState)}
  const visit=(id:string,path:Set<string>):SourceDependencies=>{
    if(path.has(id))return {refs:new Map(),issues:[`Referenced analysis cycle at ${id}.`]}
    const known=cache!.get(keyFor(id));if(known)return known
    const state=entries.get(id)
    if(!state)return {refs:new Map(),issues:[`Referenced analysis ${id} is missing.`]}
    const own=linkedSourceDependencies(state), children:SourceDependencies[]=[]
    const nextPath=new Set(path);nextPath.add(id)
    if((moduleKey==='faultTree'||moduleKey==='system') && Array.isArray(state.nodes)) {
      let targets=graphTargetCache.get(state.nodes)
      if(!targets){targets={faultTree:[],system:[]};for(const node of state.nodes){
        const fta=node?.data?.transferTo||node?.data?.ref_tree,rbd=node?.data?.linkedAnalysisId
        if(fta)targets.faultTree.push(String(fta));if(rbd)targets.system.push(String(rbd))
      }graphTargetCache.set(state.nodes,targets)}
      for(const target of targets[moduleKey])children.push(visit(target,nextPath))
    }
    const direct=JSON.stringify([[...own.refs.keys()].sort(),own.issues]),memoKey=keyFor(id),memo=closureMemo.get(memoKey)
    if(memo?.direct===direct && children.length===memo.children.length && children.every((child,index)=>child===memo.children[index])){
      cache!.set(keyFor(id),memo.value);return memo.value
    }
    const deps:SourceDependencies={refs:new Map(),issues:[]};mergeDependencies(deps,own)
    for(const child of children)mergeDependencies(deps,child)
    if(closureMemo.size>=2000&&!closureMemo.has(memoKey))closureMemo.delete(closureMemo.keys().next().value!)
    closureMemo.set(memoKey,{direct,children,value:deps})
    cache!.set(keyFor(id),deps)
    return deps
  }
  return visit(analysisId,new Set())
}
export function analysisSourceFingerprint(project:SourceProject,moduleKey:string,analysisId:string,activeState?:unknown):string {
  return resolvedSourceDependencies(project,analysisSourceDependencies(project,moduleKey,analysisId,activeState)).fingerprint
}
