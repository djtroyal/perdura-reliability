import DatasetQuantityFields from '../shared/DatasetQuantityFields'
import { DISTRIBUTION_PARAMETERS, resolveAdoptedDistribution, type LifeDataModelFolio, type SourceOptions } from '../shared/adoptedDistribution'
import type { DatasetQuantity } from '../shared/datasetUnits'
import type { StressStrengthInput } from './stressStrengthModel'

export default function StressStrengthInputs({ label, value, onChange, folios, options, quantity, groups }: {
  label:string; value:StressStrengthInput; onChange:(value:StressStrengthInput)=>void
  folios:readonly LifeDataModelFolio[]; options:SourceOptions; quantity:DatasetQuantity; groups:string[]
}) {
  const selected = value.source ? folios.find(f=>f.id===value.source?.analysisId) : undefined
  const resolved = resolveAdoptedDistribution(selected,options)
  const distribution = value.distribution ?? 'Normal_2P'
  return <fieldset className="space-y-2 rounded border border-slate-200 p-3"><legend className="px-1 text-sm font-semibold text-slate-800">{label}</legend>
    <label className="block text-xs text-slate-700">{label} source
      <select className="field mt-1 min-h-9" aria-label={`${label} source`} value={value.mode}
        onChange={event=>onChange({...value,mode:event.target.value as StressStrengthInput['mode'],distribution,
          quantity:value.quantity ?? quantity})}>
        <option value="dataset">Project dataset</option><option value="manual">Manual parameters</option><option value="group">Fit data by ID group</option>
      </select>
    </label>
    {value.mode === 'dataset' ? <>
      <label className="block text-xs text-slate-700">{label} dataset<select className="field mt-1 min-h-9" aria-label={`${label} dataset`}
        value={value.source?.analysisId ?? ''} onChange={event=>onChange({...value,source:event.target.value ? {module:'lifeData',analysisId:event.target.value} : undefined})}>
        <option value="">Choose dataset…</option>{folios.map(f=>{
          const source=resolveAdoptedDistribution(f,options)
          return <option key={f.id} value={f.id}>{f.name ?? f.id} — {source.status === 'current' ? source.model.distribution : source.status}</option>
        })}
      </select></label>
      {resolved.status === 'current' ? <div className="rounded bg-blue-50 p-2 text-xs text-blue-900" role="status">
        <p className="font-semibold">Live adopted {resolved.model.distribution}</p>
        <p className="break-words font-mono">{Object.entries(resolved.model.parameters).map(([k,v])=>`${k}=${v}`).join(', ')}</p>
        <p>{resolved.model.quantity.kind} · {resolved.model.quantity.unit}</p>
        <button type="button" className="mt-2 min-h-9 rounded border border-blue-700 px-2 text-blue-800" onClick={()=>onChange({mode:'manual',
          distribution:resolved.model.distribution,parameters:Object.fromEntries(Object.entries(resolved.model.parameters).map(([k,v])=>[k,String(v)])),quantity:resolved.model.quantity})}>Detach as manual copy</button>
      </div> : <p className="text-xs text-amber-800">{resolved.reason}</p>}
    </> : <>
      <label className="block text-xs text-slate-700">{label} distribution<select className="field mt-1 min-h-9" aria-label={`${label} distribution`}
        value={distribution} onChange={event=>onChange({...value,distribution:event.target.value,parameters:{}})}>
        {Object.keys(DISTRIBUTION_PARAMETERS).map(d=><option key={d} value={d}>{d}</option>)}
      </select></label>
      {value.mode === 'group' ? <>
        <label className="block text-xs text-slate-700">{label} ID group<select className="field mt-1 min-h-9" aria-label={`${label} ID group`}
          value={value.groupId ?? ''} onChange={event=>onChange({...value,groupId:event.target.value})}>
          <option value="">Choose group…</option>{groups.map(id=><option key={id} value={id}>{id}</option>)}
        </select></label><p className="text-xs text-slate-600">Fits only this group, using {quantity.unit}. The dataset’s adopted model is unchanged.</p>
      </> : <>
        <div className="grid grid-cols-2 gap-2">{(DISTRIBUTION_PARAMETERS[distribution] ?? []).map(parameter=><label key={parameter} className="text-xs text-slate-700">{parameter}
          <input className="field mt-1 min-h-9" aria-label={`${label} ${parameter}`} inputMode="decimal" value={value.parameters?.[parameter] ?? ''}
            onChange={event=>onChange({...value,distribution,parameters:{...value.parameters,[parameter]:event.target.value}})}/></label>)}</div>
        <DatasetQuantityFields label={label} value={value.quantity ?? quantity} onChange={q=>onChange({...value,distribution,quantity:q})}/>
      </>}
    </>}
  </fieldset>
}
