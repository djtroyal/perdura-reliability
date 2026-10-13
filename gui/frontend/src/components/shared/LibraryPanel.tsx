import { useState } from 'react'
import { BookMarked, Plus, Trash2, Link2 } from 'lucide-react'
import { useModuleState, useUnits, useStoreVersion, getProjectState } from '../../store/project'
import { evaluateDistribution } from '../../api/client'
import { listReliabilitySources, resolveReliabilitySource, type ReliabilitySource } from './reliabilitySources'
import { quantityConversionFactor, quantityFromProjectUnit } from './datasetUnits'
import type { DistributionSourceRef } from './adoptedDistribution'

export interface LibraryItem {
  id: string; name: string; kind: 'manual'|'distribution'|'lambda'; value?: number
  distribution?: string; params?: Record<string, number>; lambdaFpmh?: number; source?: string
  sourceRef?: DistributionSourceRef; sourceId?: string; resolvedSource?: ReliabilitySource
}
export interface LibraryState { items: LibraryItem[]; missionHours: string }
const INITIAL_LIBRARY: LibraryState = { items: [], missionHours: '8760' }
export function itemSummary(item: LibraryItem): string {
  if (item.resolvedSource) return item.resolvedSource.label
  if (item.sourceRef) return 'Live project distribution'
  if (item.kind === 'manual') return `R = ${item.value}`
  if (item.kind === 'lambda') return `Manual snapshot · λ = ${item.lambdaFpmh} FPMH`
  return `Manual snapshot · ${item.distribution} (${Object.entries(item.params ?? {}).map(([k,v])=>`${k}=${Number(v.toPrecision(5))}`).join(', ')})`
}
interface Props { mode: 'reliability'|'probability'; selectedLabel: string|null; onApply: (item: LibraryItem, value: number)=>void }
const toItem = (source: ReliabilitySource): LibraryItem => ({ id: `source:${source.id}`, name: source.name,
  kind: 'distribution', sourceRef: source.sourceRef, sourceId: source.id, resolvedSource: source,
  distribution: source.sourceDist, params: source.snapshot.parameters, source: `${source.moduleLabel}: ${source.name}` })

/** Reusable project source picker. Applying an adopted model retains its live reference. */
export default function LibraryPanel({ mode, selectedLabel, onApply }: Props) {
  const [lib,setLib] = useModuleState<LibraryState>('library',INITIAL_LIBRARY)
  const [units] = useUnits()
  useStoreVersion()
  const sources = listReliabilitySources(getProjectState(), 'distribution', true)
  const [open,setOpen] = useState(false), [adding,setAdding] = useState(false)
  const [name,setName] = useState(''), [value,setValue] = useState('0.95'), [sourceId,setSourceId] = useState('')
  const [error,setError] = useState(''), [busy,setBusy] = useState(false)
  const add = () => {
    try {
      const source = sourceId ? resolveReliabilitySource(getProjectState(),sourceId) : null
      const probability = Number(value)
      if (!source && (!name.trim() || !Number.isFinite(probability) || probability < 0 || probability > 1))
        throw new Error('Enter a name and reliability between 0 and 1.')
      const item: LibraryItem = source ? { ...toItem(source), name: name.trim() || source.name }
        : { id:'', name:name.trim(), kind:'manual', value:probability }
      item.id = `lib-${crypto.randomUUID()}`
      delete item.resolvedSource // live data are resolved anew; never persist a cached source as authority
      setLib(current=>({...current,items:[...current.items,item]}));setAdding(false);setName('');setError('')
    } catch(cause) { setError((cause as Error).message) }
  }
  const apply = async (item: LibraryItem) => {
    setError('');setBusy(true)
    const project = getProjectState(), t = Number(lib.missionHours)
    try {
      if(item.kind!=='manual'&&(!Number.isFinite(t)||t<=0))throw new Error('Enter a positive mission time.')
      const resolved = item.sourceRef ? resolveReliabilitySource(project,item.sourceRef) : null
      let reliability: number
      if(resolved) {
        const sourceTime=t*quantityConversionFactor(quantityFromProjectUnit(units),resolved.snapshot.quantity)
        reliability=(await evaluateDistribution(resolved.snapshot.distribution,resolved.snapshot.parameters,sourceTime)).sf
        const now=getProjectState()
        if(now.identity.projectId!==project.identity.projectId||now.revision!==project.revision
          ||resolveReliabilitySource(now,item.sourceRef!).fingerprint!==resolved.fingerprint)
          throw new Error('The source changed while evaluating. Apply the current model again.')
      } else if(item.kind==='manual') reliability=item.value!
      else if(item.kind==='lambda') {
        const hours=t*quantityConversionFactor(quantityFromProjectUnit(units),{kind:'time',unit:'hours'})
        reliability=Math.exp(-item.lambdaFpmh!*hours/1e6)
      } else reliability=(await evaluateDistribution(item.distribution!,item.params!,t)).sf
      onApply(resolved?{...item,...toItem(resolved),id:item.id,name:item.name}:item,mode==='reliability'?reliability:1-reliability)
    } catch(cause) { setError((cause as Error).message || 'Evaluation failed.') } finally { setBusy(false) }
  }
  const card = (item: LibraryItem, removable = false) => {
    let current=item, unavailable=''
    if(item.sourceRef)try{current={...item,resolvedSource:resolveReliabilitySource(getProjectState(),item.sourceRef)}}catch(cause){unavailable=(cause as Error).message}
    return <div key={item.id} className="rounded-lg border border-slate-200 bg-white p-2">
      <div className="flex items-center gap-2"><span className="min-w-0 flex-1 break-words text-xs font-medium text-slate-800">{item.name}</span>
        {removable&&<button type="button" aria-label={`Remove ${item.name}`} className="mini-button" onClick={()=>setLib(v=>({...v,items:v.items.filter(i=>i.id!==item.id)}))}><Trash2 size={14}/></button>}</div>
      <p className={`mt-1 break-words text-[11px] ${unavailable?'text-red-700':'text-slate-600'}`}>{unavailable||itemSummary(current)}</p>
      <button type="button" disabled={!selectedLabel||busy||Boolean(unavailable)} onClick={()=>void apply(current)} className="mini-button mt-2 min-h-8 w-full justify-center" title={selectedLabel?`Apply to ${selectedLabel}`:'Select a component or basic event'}><Link2 size={13}/>{item.sourceRef?'Link model':'Apply value'}</button>
    </div>
  }
  return <section className="border-t border-slate-200 pt-3" aria-label="Component and event sources">
    <button type="button" aria-expanded={open} onClick={()=>setOpen(v=>!v)} className="flex min-h-9 w-full items-center gap-2 text-xs font-semibold text-slate-700"><BookMarked size={15}/>Library ({lib.items.length+sources.length})<span className="ml-auto">{open?'▾':'▸'}</span></button>
    {open&&<div className="mt-2 space-y-3">
      <label className="block text-xs text-slate-700">Preview mission time ({units})<input className="field mt-1" inputMode="decimal" value={lib.missionHours} onChange={e=>setLib(v=>({...v,missionHours:e.target.value}))}/></label>
      <p className="text-[11px] text-slate-600">Linked models use the diagram's mission time when calculated.</p>
      <div className="max-h-80 space-y-2 overflow-y-auto">
        {lib.items.map(item=>card(item,true))}
        {(['lda','prediction'] as const).map(module=><div key={module} className="space-y-2"><h4 className="pt-2 text-xs font-semibold text-slate-700">{module==='lda'?'Adopted LDA distributions':'Prediction scenarios and items'}</h4>{sources.filter(s=>s.module===module).map(s=>card(toItem(s)))}</div>)}
        {!sources.length&&<p className="text-xs text-slate-600">Set a dataset distribution in LDA or calculate a Prediction scenario to create a compatible live source.</p>}
      </div>
      {adding?<div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-2">
        <label className="block text-xs">Source<select className="field mt-1" value={sourceId} onChange={e=>setSourceId(e.target.value)}><option value="">Manual reliability</option>{sources.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="block text-xs">Name<input className="field mt-1" value={name} onChange={e=>setName(e.target.value)}/></label>
        {!sourceId&&<label className="block text-xs">Reliability<input className="field mt-1" type="number" min="0" max="1" step="any" value={value} onChange={e=>setValue(e.target.value)}/></label>}
        <div className="flex gap-2"><button className="primary-button" type="button" onClick={add}>Save item</button><button className="mini-button" type="button" onClick={()=>setAdding(false)}>Cancel</button></div>
      </div>:<button className="mini-button" type="button" onClick={()=>setAdding(true)}><Plus size={14}/>Add custom item</button>}
      {error&&<p role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}
    </div>}
  </section>
}
