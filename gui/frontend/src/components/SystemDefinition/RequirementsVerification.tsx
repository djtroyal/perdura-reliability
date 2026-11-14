import { useMemo, useState } from 'react'
import { ArrowUpRight, Check, Plus, Search, Trash2 } from 'lucide-react'
import type { CanonicalSystemRef, SystemDefinitionModel, SystemRequirement, SystemVerificationCase,
  SystemVerificationEvidence } from '../../api/systemDefinition'
import { getProjectState, useStoreVersion } from '../../store/project'
import { createSystemRequirement, createVerificationCase, evaluateSystemRequirements, reviewVerificationCase } from '../../store/systemRequirements'
import { verificationSourcesForProject } from '../../store/systemVerificationState'
import { effectiveSystemFunctions } from '../../store/systemArchitecture'
import { toast } from '../shared/toast'
import { systemStructureRows } from './structureEditing'

const field = 'w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800 focus:border-blue-500 focus:outline-2 focus:outline-blue-500'
const button = 'inline-flex items-center justify-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:border-blue-500 hover:text-blue-700 disabled:opacity-50'
const nextId = (prefix: string, records: { id: string }[]) => {
  const used = new Set(records.map(item => item.id))
  let number = 1
  while (used.has(`${prefix}-${String(number).padStart(3, '0')}`)) number++
  return `${prefix}-${String(number).padStart(3, '0')}`
}
const toggle = (values: string[], id: string) => values.includes(id) ? values.filter(value => value !== id) : [...values, id]
const label = (value: string) => value.replace(/_/g, ' ').replace(/^./, value => value.toUpperCase())
const statusColors: Record<string, string> = {
  verified: 'bg-emerald-100 text-emerald-900', passed: 'bg-emerald-100 text-emerald-900',
  failed: 'bg-red-100 text-red-900', stale: 'bg-amber-100 text-amber-900', blocked: 'bg-amber-100 text-amber-900',
}
function Status({ value }: { value: string }) {
  return <span className={`whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${statusColors[value] ?? 'bg-slate-100 text-slate-700'}`}>{label(value)}</span>
}
function TextField({ name, value, onChange, multiline = false }: {
  name: string; value: string; onChange: (value: string) => void; multiline?: boolean
}) {
  return <label className="block text-xs font-medium text-slate-700">{name}
    {multiline ? <textarea aria-label={name} rows={3} value={value} onChange={event => onChange(event.target.value)} className={`${field} mt-1`} />
      : <input aria-label={name} value={value} onChange={event => onChange(event.target.value)} className={`${field} mt-1`} />}
  </label>
}

export default function RequirementsVerification({ model, selectedInstanceId, onChange, onSelectBlock, onNavigateBlock, onNavigateFunction, onNavigateInterface }: {
  model: SystemDefinitionModel; selectedInstanceId: string; onChange: (model: SystemDefinitionModel) => void
  onSelectBlock: (id: string) => void
  onNavigateBlock: (id: string) => void
  onNavigateFunction: (target: { instanceId: string; functionId: string }) => void
  onNavigateInterface: (id: string) => void
}) {
  const revision = useStoreVersion()
  const sources = useMemo(() => verificationSourcesForProject(getProjectState()), [revision])
  const evaluation = useMemo(() => evaluateSystemRequirements(model, sources), [model, sources])
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState('all')
  const [selectedId, setSelectedId] = useState('')
  const [allocationBlock, setAllocationBlock] = useState(selectedInstanceId || model.root_instance_id || '')
  const [allocationFunction, setAllocationFunction] = useState('')
  const [allocationInterface, setAllocationInterface] = useState('')
  const requirements = model.requirements ?? []
  const rows = useMemo(() => systemStructureRows(model), [model])
  const filtered = requirements.filter(item => {
    const matchesText = !query || `${item.id} ${item.statement} ${item.owner}`.toLowerCase().includes(query.toLowerCase())
    if (!matchesText || scope === 'all') return matchesText
    const branch = new Set(rows.filter(row => row.instance.id === selectedInstanceId || row.ancestors.includes(selectedInstanceId)).map(row => row.instance.id))
    return item.allocations.some(ref => branch.has(ref.instance_id ?? '')
      || model.interfaces.some(edge => edge.id === ref.interface_id && [edge.source.instance_id, edge.target.instance_id].some(id => id && branch.has(id))))
  })
  const selected = filtered.find(item => item.id === selectedId) ?? filtered[0]
  const requirementResult = evaluation.requirements.find(item => item.id === selected?.id)
  const patch = (changes: Partial<SystemRequirement>) => selected && onChange({ ...model,
    requirements: requirements.map(item => item.id === selected.id ? { ...item, ...changes } : item) })
  const addRequirement = () => {
    const item = createSystemRequirement(nextId('REQ', requirements))
    if (scope === 'selected' && selectedInstanceId) item.allocations = [{ system_model_id: model.id, instance_id: selectedInstanceId }]
    setSelectedId(item.id); setQuery('')
    onChange({ ...model, requirements: [...requirements, item] })
  }
  const addAllocation = (ref: CanonicalSystemRef) => {
    if (!selected || selected.allocations.some(item => item.instance_id === ref.instance_id
      && item.function_id === ref.function_id && item.interface_id === ref.interface_id)) return
    patch({ allocations: [...selected.allocations, ref] })
  }
  const describeRef = (ref: CanonicalSystemRef) => {
    if (ref.interface_id) return model.interfaces.find(item => item.id === ref.interface_id)?.name ?? `Missing interface: ${ref.interface_id}`
    const block = model.instances.find(item => item.id === ref.instance_id)
    const fn = block && ref.function_id ? effectiveSystemFunctions(model, block.id).find(item => item.id === ref.function_id) : undefined
    return `${block?.name ?? `Missing block: ${ref.instance_id}`}${ref.function_id ? ` · ${fn?.description ?? ref.function_id}` : ''}`
  }
  const functions = effectiveSystemFunctions(model, allocationBlock)
  const cases = (model.verification_cases ?? []).filter(item => selected && item.requirement_ids.includes(selected.id))
  const canDelete = selected?.lifecycle === 'draft' && !cases.length
    && !requirements.some(item => item.derived_from_ids.includes(selected.id))
    && !(model.verification_evidence ?? []).some(item => item.requirement_ids.includes(selected.id))
  const analyses = Array.from(new Map(getProjectState().analysisRuns.map(run => [`${run.moduleKey}:${run.analysisId}`, run])).values())

  return <section aria-label="Requirements and verification" className="grid min-h-0 flex-1 grid-cols-[minmax(220px,280px)_minmax(0,1fr)] overflow-hidden">
    <aside className="flex min-h-0 flex-col gap-3 border-r bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold text-slate-800">Requirements</h2>
        <button type="button" onClick={addRequirement} className={button}><Plus size={14} /> New</button></div>
      <label className="relative"><Search size={15} className="pointer-events-none absolute left-2 top-2.5 text-slate-500" />
        <input aria-label="Search requirements" placeholder="Search requirements" value={query} onChange={event => setQuery(event.target.value)} className={`${field} pl-7`} /></label>
      <label className="text-xs font-medium text-slate-700">Scope<select aria-label="Requirement scope" className={`${field} mt-1`} value={scope} onChange={event => setScope(event.target.value)}>
        <option value="all">Whole project</option><option value="selected">Selected block and children</option>
      </select></label>
      {scope === 'selected' && <label className="text-xs font-medium text-slate-700">System block<select aria-label="Requirement scope block" value={selectedInstanceId} onChange={event => onSelectBlock(event.target.value)} className={`${field} mt-1`}>
        {rows.map(row => <option key={row.instance.id} value={row.instance.id}>{`${'· '.repeat(row.depth)}${row.instance.name}`}</option>)}
      </select></label>}
      <p className="text-xs text-slate-600">{requirements.length} total · {evaluation.requirements.filter(item => item.status === 'verified').length} verified</p>
      <div className="min-h-0 flex-1 space-y-1 overflow-auto" role="list" aria-label="System requirements">
        {filtered.map(item => <div key={item.id} role="listitem"><button type="button" aria-pressed={selected?.id === item.id} onClick={() => setSelectedId(item.id)}
          className={`w-full rounded border p-3 text-left ${selected?.id === item.id ? 'border-blue-500 bg-blue-50' : 'border-transparent bg-white hover:border-slate-300'}`}>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-1"><span className="break-all text-xs font-medium text-slate-600">{item.id}</span><Status value={evaluation.requirements.find(value => value.id === item.id)?.status ?? 'draft'} /></div>
          <p className="break-words text-sm text-slate-800">{item.statement || 'Untitled requirement'}</p>
        </button></div>)}
        {!filtered.length && <p className="p-2 text-sm text-slate-600">{requirements.length ? 'No matching requirements.' : 'Add a requirement to connect system intent, design, and verification.'}</p>}
      </div>
    </aside>
    <main className="min-w-0 overflow-auto p-5">
      {selected ? <div className="mx-auto max-w-5xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap items-center gap-2"><h2 className="break-all text-sm font-semibold text-slate-700">{selected.id}</h2><Status value={requirementResult?.status ?? 'draft'} /></div>
          <div className="flex flex-wrap items-center gap-2">{selected.lifecycle === 'draft' && <button type="button" disabled={!canDelete}
            title={canDelete ? 'Delete this unreferenced draft' : 'Referenced requirements can be retired to preserve their traceability.'}
            className={button} onClick={() => { if (canDelete) onChange({ ...model, requirements: requirements.filter(item => item.id !== selected.id) }) }}><Trash2 size={13} /> Delete draft</button>}
          <label className="text-xs text-slate-700">Lifecycle <select aria-label="Requirement lifecycle" className="ml-1 rounded border border-slate-300 bg-white px-2 py-1.5" value={selected.lifecycle} onChange={event => patch({ lifecycle: event.target.value as SystemRequirement['lifecycle'] })}>
            <option value="draft">Draft</option><option value="active">Active</option><option value="retired">Retired</option>
          </select></label></div></div>
        <TextField name="Requirement statement" value={selected.statement} onChange={statement => patch({ statement })} multiline />
        <div className="grid gap-3 md:grid-cols-3"><label className="text-xs font-medium text-slate-700">Type<select aria-label="Requirement type" value={selected.requirement_type} onChange={event => patch({ requirement_type: event.target.value as SystemRequirement['requirement_type'] })} className={`${field} mt-1`}>
          {['functional', 'performance', 'interface', 'safety', 'regulatory', 'customer', 'other'].map(type => <option key={type} value={type}>{label(type)}</option>)}
        </select></label><TextField name="Requirement owner" value={selected.owner} onChange={owner => patch({ owner })} /><TextField name="Requirement source" value={selected.source} onChange={source => patch({ source })} /></div>
        <TextField name="Requirement acceptance criteria" value={selected.acceptance_criteria} onChange={acceptance_criteria => patch({ acceptance_criteria })} multiline />
        <details className="rounded border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-medium text-slate-800">Measure and applicability</summary><div className="mt-3 space-y-3">
          <div className="grid gap-3 md:grid-cols-3"><TextField name="Measure" value={selected.measure} onChange={measure => patch({ measure })} /><TextField name="Target" value={selected.target} onChange={target => patch({ target })} /><TextField name="Unit" value={selected.unit} onChange={unit => patch({ unit })} /></div>
          <div className="grid gap-3 md:grid-cols-2"><TextField name="Mission profile" value={selected.mission_profile} onChange={mission_profile => patch({ mission_profile })} /><TextField name="Operating condition" value={selected.operating_condition} onChange={operating_condition => patch({ operating_condition })} />
            <TextField name="Failure definition" value={selected.failure_definition} onChange={failure_definition => patch({ failure_definition })} /><TextField name="Confidence" value={selected.confidence} onChange={confidence => patch({ confidence })} /></div>
          <ModeSelection model={model} values={selected.mode_ids} onChange={mode_ids => patch({ mode_ids })} legend="Requirement modes" />
        </div></details>
        <details open className="rounded border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-medium text-slate-800">System traceability <span className="font-normal text-slate-600">({selected.allocations.length})</span></summary>
          <ul className="my-3 space-y-1" aria-label="Requirement allocations">{selected.allocations.map((ref, index) => <li key={index} className="flex items-start gap-2 rounded bg-slate-50 p-2">
            <button type="button" onClick={() => ref.interface_id ? onNavigateInterface(ref.interface_id) : ref.instance_id && ref.function_id ? onNavigateFunction({ instanceId: ref.instance_id, functionId: ref.function_id }) : ref.instance_id && onNavigateBlock(ref.instance_id)} className="flex min-w-0 flex-1 items-start gap-1 text-left text-sm text-blue-800 hover:underline"><span className="break-words">{describeRef(ref)}</span><ArrowUpRight size={14} className="mt-0.5 shrink-0" /></button>
            <button type="button" aria-label={`Remove allocation ${describeRef(ref)}`} onClick={() => patch({ allocations: selected.allocations.filter((_, current) => current !== index) })} className={button}><Trash2 size={13} /></button>
          </li>)}</ul>
          <div className="grid gap-2 lg:grid-cols-[1fr_1fr_auto]"><select aria-label="Allocate to system block" className={field} value={allocationBlock} onChange={event => { setAllocationBlock(event.target.value); setAllocationFunction('') }}>
            <option value="">Choose block</option>{rows.map(row => <option key={row.instance.id} value={row.instance.id}>{`${'· '.repeat(row.depth)}${row.instance.name}`}</option>)}
          </select><select aria-label="Allocate to function" value={allocationFunction} onChange={event => setAllocationFunction(event.target.value)} className={field}>
            <option value="">Whole block</option>{functions.map(fn => <option key={fn.id} value={fn.id}>{fn.description}</option>)}
          </select><button type="button" disabled={!allocationBlock} className={button} onClick={() => addAllocation({ system_model_id: model.id, instance_id: allocationBlock, ...(allocationFunction ? { function_id: allocationFunction } : {}) })}><Plus size={13} /> Allocate</button></div>
          <details className="mt-3"><summary className="cursor-pointer text-xs font-medium text-slate-700">Interfaces, parent requirements, and analyses</summary><div className="mt-3 space-y-3">
            <div className="flex gap-2"><select aria-label="Allocate to interface" value={allocationInterface} onChange={event => setAllocationInterface(event.target.value)} className={field}><option value="">Choose interface</option>{model.interfaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
              <button type="button" disabled={!allocationInterface} className={button} onClick={() => addAllocation({ system_model_id: model.id, interface_id: allocationInterface })}><Plus size={13} /> Allocate</button></div>
            <fieldset><legend className="mb-2 text-xs font-medium text-slate-700">Derived from</legend><div className="max-h-40 space-y-2 overflow-auto">{requirements.filter(item => item.id !== selected.id).map(item => <label key={item.id} className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" checked={selected.derived_from_ids.includes(item.id)} onChange={() => patch({ derived_from_ids: toggle(selected.derived_from_ids, item.id) })} /><span>{item.id} · {item.statement || 'Untitled requirement'}</span></label>)}
              {requirements.length < 2 && <p className="text-xs text-slate-600">Add another requirement to define derivation.</p>}</div></fieldset>
            <fieldset><legend className="mb-2 text-xs font-medium text-slate-700">Supporting analyses</legend><div className="max-h-40 space-y-2 overflow-auto">{analyses.map(run => <label key={run.runId} className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" checked={selected.supporting_analyses.some(ref => ref.module_key === run.moduleKey && ref.analysis_id === run.analysisId)} onChange={() => patch({ supporting_analyses: selected.supporting_analyses.some(ref => ref.module_key === run.moduleKey && ref.analysis_id === run.analysisId)
                ? selected.supporting_analyses.filter(ref => ref.module_key !== run.moduleKey || ref.analysis_id !== run.analysisId) : [...selected.supporting_analyses, { module_key: run.moduleKey, analysis_id: run.analysisId }] })} /><span>{run.moduleLabel} · {run.analysisName}</span></label>)}
              {!analyses.length && <p className="text-xs text-slate-600">Completed project analyses will appear here.</p>}</div></fieldset>
          </div></details>
        </details>
        <div className="space-y-3"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-slate-800">Verification</h3><button type="button" className={button} onClick={() => {
          const item = createVerificationCase(nextId('VER', model.verification_cases ?? []), selected.id)
          item.acceptance_criteria = selected.acceptance_criteria; item.mode_ids = selected.mode_ids; item.owner = selected.owner
          onChange({ ...model, verification_cases: [...(model.verification_cases ?? []), item] })
        }}><Plus size={13} /> Add verification case</button></div>
          {!cases.length && <p className="text-sm text-slate-600">No verification cases yet.</p>}
          {cases.map(item => <VerificationEditor key={item.id} model={model} item={item} sources={sources}
            result={evaluation.cases.find(result => result.id === item.id)} onChange={onChange} />)}
        </div>
        {!!requirementResult?.issues.length && <details className="rounded border border-amber-300 bg-amber-50 p-3"><summary className="cursor-pointer text-sm font-medium text-amber-950">Review needs attention ({requirementResult.issues.length})</summary><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-950">{requirementResult.issues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul></details>}
      </div> : <div className="flex h-full flex-col items-center justify-center gap-3 text-center"><h2 className="text-lg font-medium text-slate-800">Connect requirements to the system</h2><p className="max-w-sm text-sm text-slate-600">Define intent, allocate it to blocks or functions, and review the supporting evidence.</p><button type="button" className={button} onClick={addRequirement}><Plus size={14} /> New requirement</button></div>}
    </main>
  </section>
}

function ModeSelection({ model, values, onChange, legend }: { model: SystemDefinitionModel; values: string[]; onChange: (values: string[]) => void; legend: string }) {
  return <fieldset><legend className="mb-2 text-xs font-medium text-slate-700">{legend} <span className="font-normal">(none selected means all)</span></legend><div className="flex flex-wrap gap-3">{model.modes.map(mode => <label key={mode.id} className="flex items-center gap-1.5 text-sm text-slate-700"><input type="checkbox" checked={values.includes(mode.id)} onChange={() => onChange(toggle(values, mode.id))} />{mode.name}</label>)}</div></fieldset>
}

function VerificationEditor({ model, item, result, sources, onChange }: {
  model: SystemDefinitionModel; item: SystemVerificationCase; onChange: (model: SystemDefinitionModel) => void
  sources: ReturnType<typeof verificationSourcesForProject>
  result: ReturnType<typeof evaluateSystemRequirements>['cases'][number] | undefined
}) {
  const [reviewer, setReviewer] = useState(item.reviewed_by)
  const [expanded, setExpanded] = useState(!item.objective)
  const [sourceRun, setSourceRun] = useState('external')
  const patch = (changes: Partial<SystemVerificationCase>) => onChange({ ...model,
    verification_cases: (model.verification_cases ?? []).map(value => value.id === item.id ? { ...value, ...changes } : value) })
  const evidence = (model.verification_evidence ?? []).filter(value => item.evidence_link_ids.includes(value.id))
  const availableEvidence = (model.verification_evidence ?? []).filter(value => !item.evidence_link_ids.includes(value.id)
    && value.requirement_ids.some(id => item.requirement_ids.includes(id)))
  const runs = getProjectState().analysisRuns.filter(run => sources.some(source => source.runId === run.runId && source.current))
  const addEvidence = () => {
    const existing = availableEvidence.find(value => `evidence:${value.id}` === sourceRun)
    if (existing) {
      patch({ evidence_link_ids: [...item.evidence_link_ids, existing.id] })
      setSourceRun('external')
      return
    }
    const run = runs.find(value => value.runId === sourceRun)
    const requirement = model.requirements?.find(value => item.requirement_ids.includes(value.id))
    const next: SystemVerificationEvidence = { id: nextId('EVD', model.verification_evidence ?? []), target_id: item.id, source_module: run ? 'requirements' : 'external',
      source_analysis_id: run?.analysisId ?? '', source_revision: run ? String(run.engineRevision) : '', source_checksum: run?.fingerprintSha256 ?? '',
      evidence_kind: 'verification', claim: '', locator: run ? `analysis:${run.moduleKey}/${run.analysisId}/${run.runId}` : '',
      captured_at: new Date().toISOString(), stale: false, requirement_ids: [...item.requirement_ids], mode_ids: [...item.mode_ids],
      units: requirement?.unit ?? '', mission_context: requirement?.mission_profile ?? '',
      ...(run ? { run_id: run.runId, module_key: run.moduleKey } : {}) }
    onChange({ ...model, verification_evidence: [...(model.verification_evidence ?? []), next],
      verification_cases: (model.verification_cases ?? []).map(value => value.id === item.id ? { ...value, evidence_link_ids: [...value.evidence_link_ids, next.id] } : value) })
  }
  const patchEvidence = (id: string, changes: Partial<SystemVerificationEvidence>) => onChange({ ...model,
    verification_evidence: (model.verification_evidence ?? []).map(value => value.id === id ? { ...value, ...changes } : value) })
  return <details className="rounded border border-slate-300 bg-white p-3" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary className="cursor-pointer text-sm font-medium text-slate-800"><span className="mr-2">{item.objective || 'New verification case'}</span><Status value={result?.status ?? 'draft'} /></summary>
    <div className="mt-4 space-y-3" role="group" aria-label={`Verification case ${item.id}`}>
      <p className="break-all text-xs text-slate-500">{item.id}</p>
      <TextField name="Verification objective" value={item.objective} onChange={objective => patch({ objective })} />
      <div className="grid gap-3 md:grid-cols-3"><label className="text-xs font-medium text-slate-700">Method<select aria-label="Verification method" value={item.method} onChange={event => patch({ method: event.target.value })} className={`${field} mt-1`}><option value="">Choose method</option>{['analysis', 'test', 'inspection', 'demonstration'].map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label>
        <TextField name="Verification owner" value={item.owner} onChange={owner => patch({ owner })} /><TextField name="Verification level" value={item.level} onChange={level => patch({ level })} /></div>
      <TextField name="Verification acceptance criteria" value={item.acceptance_criteria} onChange={acceptance_criteria => patch({ acceptance_criteria })} multiline />
      <details><summary className="cursor-pointer text-xs font-medium text-slate-700">Case scope and schedule</summary><div className="mt-3 space-y-3">
        <fieldset><legend className="mb-2 text-xs font-medium text-slate-700">Requirements covered</legend>{(model.requirements ?? []).map(requirement => <label key={requirement.id} className="mb-2 flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" checked={item.requirement_ids.includes(requirement.id)} onChange={() => patch({ requirement_ids: toggle(item.requirement_ids, requirement.id) })} /><span>{requirement.id} · {requirement.statement || 'Untitled requirement'}</span></label>)}</fieldset>
        <ModeSelection model={model} values={item.mode_ids} onChange={mode_ids => patch({ mode_ids })} legend="Verification modes" />
        <div className="grid gap-3 md:grid-cols-2"><TextField name="Sample size" value={item.sample_size} onChange={sample_size => patch({ sample_size })} /><label className="text-xs font-medium text-slate-700">Planned date<input aria-label="Planned verification date" type="date" value={item.planned_date ?? ''} onChange={event => patch({ planned_date: event.target.value })} className={`${field} mt-1`} /></label></div>
      </div></details>
      <fieldset className="space-y-3 rounded bg-slate-50 p-3"><legend className="text-xs font-semibold text-slate-700">Evidence</legend>
        {evidence.map(record => <details key={record.id} open className="rounded border border-slate-200 bg-white p-3"><summary className="cursor-pointer text-sm font-medium text-slate-800">{record.claim || (record.run_id ? 'Analysis evidence' : 'External evidence')}</summary><div className="mt-3 space-y-3">
          <TextField name="Evidence claim" value={record.claim} onChange={claim => patchEvidence(record.id, { claim })} multiline />
          {record.run_id ? <p className="break-all text-xs text-slate-600">Analysis run {record.run_id} · {sources.some(source => source.runId === record.run_id && source.current) ? 'Current' : 'Changed or unavailable'}</p>
            : <><TextField name="Evidence location" value={record.locator} onChange={locator => patchEvidence(record.id, { locator })} /><div className="grid gap-3 md:grid-cols-2"><TextField name="Evidence revision" value={record.source_revision ?? ''} onChange={source_revision => patchEvidence(record.id, { source_revision })} /><TextField name="Evidence checksum" value={record.source_checksum ?? ''} onChange={source_checksum => patchEvidence(record.id, { source_checksum })} /></div></>}
          <div className="grid gap-3 md:grid-cols-2"><TextField name="Evidence units" value={record.units ?? ''} onChange={units => patchEvidence(record.id, { units })} /><TextField name="Evidence mission context" value={record.mission_context ?? ''} onChange={mission_context => patchEvidence(record.id, { mission_context })} /></div>
          <ModeSelection model={model} values={record.mode_ids} onChange={mode_ids => patchEvidence(record.id, { mode_ids })} legend="Evidence modes" />
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={record.stale} onChange={event => patchEvidence(record.id, { stale: event.target.checked })} />Evidence withdrawn or superseded</label>
          <button type="button" className={button} onClick={() => patch({ evidence_link_ids: item.evidence_link_ids.filter(id => id !== record.id) })}><Trash2 size={13} /> Detach evidence</button>
        </div></details>)}
        <div className="flex gap-2"><select aria-label="Evidence source" className={field} value={sourceRun} onChange={event => setSourceRun(event.target.value)}><option value="external">External document or test record</option>
          {!!availableEvidence.length && <optgroup label="Existing project evidence">{availableEvidence.map(value => <option key={value.id} value={`evidence:${value.id}`}>{value.id} · {value.claim || value.locator || 'Untitled evidence'}</option>)}</optgroup>}
          {!!runs.length && <optgroup label="Current analysis runs">{runs.map(run => <option key={run.runId} value={run.runId}>{run.moduleLabel} · {run.analysisName} · {new Date(run.completedAt).toLocaleString()}</option>)}</optgroup>}
        </select><button type="button" onClick={addEvidence} className={`${button} shrink-0`}><Plus size={13} /> Add evidence</button></div>
      </fieldset>
      <div className="grid gap-3 md:grid-cols-2"><label className="text-xs font-medium text-slate-700">Assessment outcome<select aria-label="Assessment outcome" value={item.outcome} onChange={event => patch({ outcome: event.target.value as SystemVerificationCase['outcome'] })} className={`${field} mt-1`}><option value="not_assessed">Not assessed</option><option value="pass">Pass</option><option value="fail">Fail</option><option value="inconclusive">Inconclusive</option></select></label>
        <TextField name="Reviewing engineer" value={reviewer} onChange={setReviewer} /></div>
      <TextField name="Evidence assessment" value={item.assessment} onChange={assessment => patch({ assessment })} multiline />
      <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-slate-600">{item.reviewed_at ? `Reviewed by ${item.reviewed_by} · ${new Date(item.reviewed_at).toLocaleString()} · revision ${item.reviewed_revision}` : 'Review confirms the criteria and evidence for this case.'}</span>
        {!item.reviewed_at && !item.reviewed_fingerprint && <button type="button" className={button}
          onClick={() => onChange({ ...model, verification_cases: (model.verification_cases ?? []).filter(value => value.id !== item.id) })}><Trash2 size={13} /> Delete case</button>}
        <button type="button" className={`${button} border-blue-400 text-blue-800`} onClick={() => {
          try { onChange(reviewVerificationCase(model, item.id, reviewer, verificationSourcesForProject(getProjectState()), new Date().toISOString())); toast.success('Verification review recorded.') }
          catch (error) { toast.error(error instanceof Error ? error.message : 'Verification review could not be recorded.') }
        }}><Check size={14} /> Record review</button></div>
      {!!result?.issues.length && <details className="rounded border border-amber-200 bg-amber-50 p-3"><summary className="cursor-pointer text-sm font-medium text-amber-950">Review needs attention ({result.issues.length})</summary><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-950" aria-label="Verification review findings">{result.issues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul></details>}
    </div>
  </details>
}
