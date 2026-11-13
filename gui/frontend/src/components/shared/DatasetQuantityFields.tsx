import { DATASET_UNITS, type DatasetQuantity, type QuantityKind } from './datasetUnits'

export default function DatasetQuantityFields({ value, onChange, label = 'Dataset' }: {
  value: DatasetQuantity; onChange: (value: DatasetQuantity) => void; label?: string
}) {
  return <fieldset className="space-y-1 text-xs"><legend className="font-medium text-slate-700">{label} quantity and unit</legend>
    <div className="grid grid-cols-2 gap-2">
      <label className="space-y-1"><span className="sr-only">{label} quantity</span><select aria-label={`${label} quantity`}
        className="field min-h-9" value={value.kind} onChange={event=>{
          const kind = event.target.value as QuantityKind
          onChange({kind,unit:kind === 'custom' ? '' : Object.keys(DATASET_UNITS[kind])[0]})
        }}>{[...Object.keys(DATASET_UNITS),'custom'].map(kind=><option key={kind} value={kind}>{kind}</option>)}</select></label>
      <label className="space-y-1"><span className="sr-only">{label} unit</span>{value.kind === 'custom'
        ? <input className="field min-h-9" aria-label={`${label} unit`} value={value.unit}
          placeholder="Exact custom unit" onChange={event=>onChange({...value,unit:event.target.value})}/>
        : <select className="field min-h-9" aria-label={`${label} unit`} value={value.unit}
          onChange={event=>onChange({...value,unit:event.target.value})}>
          {Object.keys(DATASET_UNITS[value.kind]).map(unit=><option key={unit} value={unit}>{unit}</option>)}
        </select>}</label>
    </div>
  </fieldset>
}
