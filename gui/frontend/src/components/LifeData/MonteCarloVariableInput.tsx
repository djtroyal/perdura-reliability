import DatasetQuantityFields from '../shared/DatasetQuantityFields'
import {DISTRIBUTION_PARAMETERS,resolveAdoptedDistribution,type LifeDataModelFolio,type SourceOptions} from '../shared/adoptedDistribution'
import type {DatasetQuantity} from '../shared/datasetUnits'
import {resolveMcVariable,type MCVariable} from './monteCarloModel'

export default function MonteCarloVariableInput({value,onChange,onRemove,canRemove,folios,options,quantity}:{
 value:MCVariable;onChange:(value:MCVariable)=>void;onRemove:()=>void;canRemove:boolean;
 folios:readonly LifeDataModelFolio[];options:SourceOptions;quantity:DatasetQuantity;
}){
 let resolved:ReturnType<typeof resolveMcVariable>|undefined,error=''
 try{resolved=resolveMcVariable(value,folios,quantity,options)}catch(e){error=e instanceof Error?e.message:'Invalid variable.'}
 const linked=!!value.distributionSource
 return <fieldset data-mc-variable={value.id} className="rounded border border-slate-200 bg-slate-50 p-3 space-y-2">
  <legend className="px-1 text-sm font-semibold">Variable {value.name}</legend>
  <div className="flex items-end gap-2"><label className="flex-1 text-xs text-slate-700">Variable name
   <input className="field mt-1 min-h-9 font-mono" aria-label={`Variable ${value.name} name`} value={value.name} onChange={e=>onChange({...value,name:e.target.value})}/>
  </label><button type="button" className="min-h-9 rounded border border-red-300 px-2 text-xs text-red-800 disabled:opacity-50" disabled={!canRemove} onClick={onRemove}>Remove</button></div>
  <label className="block text-xs text-slate-700">Variable source<select className="field mt-1 min-h-9" aria-label={`Variable ${value.name} source`}
   value={value.distributionSource?.analysisId ?? ''} onChange={e=>onChange(e.target.value?{...value,distributionSource:{module:'lifeData',analysisId:e.target.value}}
    :{...value,distributionSource:undefined,params:linked?{}:value.params})}>
   <option value="">Manual parameters</option>{folios.map(f=>{const source=resolveAdoptedDistribution(f,options);return <option key={f.id} value={f.id}>{f.name ?? f.id} — {source.status==='current'?source.model.distribution:source.status}</option>})}
  </select></label>
  {linked?<>
   {resolved&&<div className="rounded bg-blue-50 p-2 text-xs text-blue-900" role="status"><p className="font-semibold">Live adopted {resolved.distribution}</p>
    <p className="break-words font-mono">{Object.entries(resolved.parameters).map(([key,value])=>`${key}=${value}`).join(', ')}</p><p>{resolved.quantity.kind} · {resolved.quantity.unit}</p>
    <button type="button" className="mt-2 min-h-9 rounded border border-blue-700 px-2" onClick={()=>onChange({...value,distributionSource:undefined,
     distribution:resolved!.distribution,params:Object.fromEntries(Object.entries(resolved!.parameters).map(([key,value])=>[key,String(value)])),quantity:resolved!.quantity})}>Detach as manual copy</button>
   </div>}
  </>:<>
   <label className="block text-xs text-slate-700">Distribution<select className="field mt-1 min-h-9" aria-label={`Variable ${value.name} distribution`} value={value.distribution}
    onChange={e=>onChange({...value,distribution:e.target.value,params:{}})}>{Object.keys(DISTRIBUTION_PARAMETERS).map(d=><option key={d} value={d}>{d}</option>)}</select></label>
   <div className="grid grid-cols-2 gap-2">{(DISTRIBUTION_PARAMETERS[value.distribution]??[]).map(p=><label key={p} className="text-xs text-slate-700">{p}
    <input className="field mt-1 min-h-9" aria-label={`Variable ${value.name} ${p}`} inputMode="decimal" value={value.params[p]??''} onChange={e=>onChange({...value,params:{...value.params,[p]:e.target.value}})}/></label>)}</div>
   <DatasetQuantityFields label={`Variable ${value.name}`} value={value.quantity??quantity} onChange={q=>onChange({...value,quantity:q})}/>
  </>}
  {error&&<p className="text-xs text-amber-900">{error}</p>}
 </fieldset>
}
