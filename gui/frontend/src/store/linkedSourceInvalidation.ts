import { analysisSourceDependencies, linkedSourceDependencies, resolvedSourceDependencies, nodeSourceRef,
  resolveReliabilitySource, type SourceProject, type SourceDependencies } from '../components/shared/reliabilitySources.ts'

type State = Record<string, any>
const object = (value: unknown): State => value && typeof value === 'object' ? value as State : {}
const keys=['faultTree','system','markov','maintReplacement','maintCostForecast','maintPMInterval']
const stateCache=new WeakMap<object,{key:string;epoch:string;dependencies:SourceDependencies;value:State}>()
let previous:{units:string;lifeData:unknown;prediction:unknown;systemDefinition:unknown;slices:unknown[]}|undefined
const hasOutput=(state:State)=>state.result!=null || state.ssResult!=null

/** Immutable identities make unrelated emits O(number of module slices), not O(nodes). */
export function reconcileLinkedSources(project:SourceProject):Record<string,unknown> {
  const modules=project.modules
  const slices=keys.map(key=>modules[key])
  if(previous && previous.units===project.units && previous.lifeData===modules.lifeData
    && previous.prediction===modules.prediction && previous.systemDefinition===modules.systemDefinition && slices.every((slice,index)=>slice===previous!.slices[index]))return modules
  const all:SourceDependencies={refs:new Map(),issues:[]}
  for(const slice of slices){const dependencies=linkedSourceDependencies(slice);for(const [id,ref]of dependencies.refs)all.refs.set(id,ref)}
  // Preview choices and source renames do not change this semantic epoch.
  const environment=resolvedSourceDependencies(project,all)
  const epoch=environment.fingerprint+JSON.stringify(environment.issues)
  let nextModules=modules
  const reconcile=(input:State,dependencies:SourceDependencies):State=>{
    const cached=stateCache.get(input)
    if(cached?.epoch===epoch && cached.dependencies===dependencies)return cached.value
    const resolved=resolvedSourceDependencies(project,dependencies)
    const cacheKey=epoch+resolved.fingerprint+resolved.issues.join('\n')
    if(cached?.key===cacheKey){stateCache.set(input,{...cached,epoch,dependencies});return cached.value}
    const direct=linkedSourceDependencies(input)
    let state=input
    const failures=[...resolved.issues]
    if(direct.refs.size || direct.issues.length) {
      const updateItems=(items:unknown,transition:boolean)=>{
        if(!Array.isArray(items))return items
        return items.map((item:State)=>{
          const data=transition?item:object(item?.data)
          let ref
          try {ref=nodeSourceRef(data)} catch(error){failures.push((error as Error).message);return item}
          if(!ref)return item
          let updated:State
          try {
            const source=resolveReliabilitySource(project,ref,transition?'constant-rate':'distribution')
            updated={...data,distributionSource:ref,sourceFingerprint:source.fingerprint,sourceSnapshot:source.snapshot,sourceError:undefined,
              ...(transition?{rate:source.dist_params.lambda}:{distribution:source.dist,dist_params:source.dist_params})}
          } catch(error) {
            const reason=(error as Error).message;failures.push(reason)
            updated={...data,sourceFingerprint:'unavailable',sourceError:reason}
          }
          if(JSON.stringify(data)===JSON.stringify(updated))return item
          return transition?updated:{...item,data:updated}
        })
      }
      for(const [field,transition]of [['nodes',false],['transitions',true]] as const){
        const current=input[field], updated=updateItems(current,transition)
        if(Array.isArray(current)&&Array.isArray(updated)&&updated.some((item,index)=>item!==current[index]))state={...state,[field]:updated}
      }
      if(input.srcId||input.sourceId)try{resolveReliabilitySource(project,String(input.srcId||input.sourceId),input.srcId?'distribution':'weibull-2p')}
      catch(error){failures.push((error as Error).message)}
    }
    const tracked=dependencies.refs.size>0 || dependencies.issues.length>0 || typeof input.sourceInputFingerprint==='string'
      || typeof input.result?._sourceFingerprint==='string'
    if(tracked){
      const stale=Boolean(hasOutput(state) && (failures.length || state.result?._sourceFingerprint!==resolved.fingerprint))
      const reason=failures[0] || (stale?'A linked dataset or referenced analysis changed since calculation.':'')
      if(state.sourceInputFingerprint!==resolved.fingerprint || state.sourceStale!==stale || state.sourceStaleReason!==reason)
        state={...state,sourceInputFingerprint:resolved.fingerprint,sourceStale:stale,sourceStaleReason:reason}
    }
    const entry={key:cacheKey,epoch,dependencies,value:state}
    stateCache.set(input,entry);stateCache.set(state,entry)
    return state
  }
  for(const key of keys){
    if(!modules[key])continue
    const raw=object(modules[key])
    let updated=raw
    if(raw._folioWrap && Array.isArray(raw.folios)){
      const folios=raw.folios.map((folio:State)=>{
        const state=reconcile(object(folio.state),analysisSourceDependencies(project,key,folio.id))
        // Never erase a pre-existing local dirty flag or any historical output.
        // A genuine recalculation clears local dirty through the store writer.
        const dirty=Boolean(folio.dirty || state.sourceStale)
        return state===folio.state && dirty===Boolean(folio.dirty)?folio:{...folio,state,dirty}
      })
      if(folios.some((folio:State,index:number)=>folio!==raw.folios[index]))updated={...raw,folios}
    }else updated=reconcile(raw,linkedSourceDependencies(raw))
    if(updated!==raw)nextModules={...nextModules,[key]:updated}
  }
  previous={units:project.units,lifeData:nextModules.lifeData,prediction:nextModules.prediction,systemDefinition:nextModules.systemDefinition,slices:keys.map(key=>nextModules[key])}
  return nextModules
}
