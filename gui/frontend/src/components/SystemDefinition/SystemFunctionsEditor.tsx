import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { SystemBlockDefinition, SystemBlockInstance, SystemDefinitionModel, SystemFunction, SystemResource } from '../../api/systemDefinition'
import StructuredFunctionEditor from '../shared/StructuredFunctionEditor'
import ParentFunctionSupportEditor from '../shared/ParentFunctionSupportEditor'
import type { FunctionTraceNavigation } from '../shared/FunctionInputSuppliers'
import { projectFunctionInputSuppliers } from '../../store/inheritedFunctionInputs'
import { populateSystemInterfaceFunctions } from '../../store/interfaceFunctions'
import { effectiveSystemFunctions, structuredFunctionStatement } from '../../store/systemArchitecture'
import { availableFunctionInputs, reconcileFunctionResources, upsertInstalledFunction, inspectFunctionResourceConnections, updateReusableFunction } from '../../store/functionResourceFlows'

const field = 'w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs focus:border-blue-500'
const button = 'rounded border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 hover:border-blue-400'
const failureNames: Record<string, string> = { absent: 'Missing output', wrong_value_or_state: 'Incorrect output', intermittent: 'Intermittent output', insufficient: 'Insufficient output', excessive: 'Excessive output' }

/** A block's functions stay compact until the user chooses one to edit. */
export default function SystemFunctionsEditor({ instance, definition, model, onModelChange, updateInstance, updateDefinition,
  addFunction, removeFunction, renderModes, modeId, focusRequest, onNavigateFunction, onNavigateInterface }: {
  instance: SystemBlockInstance; definition: SystemBlockDefinition; model: SystemDefinitionModel
  onModelChange: (model: SystemDefinitionModel) => void
  onDefineInterface?: (instanceId: string, functionId: string) => void
  updateInstance: (patch: Partial<SystemBlockInstance>) => void
  updateDefinition: (patch: Partial<SystemBlockDefinition>) => void
  addFunction: () => string | void; removeFunction: (id: string) => void
  addFailure?: () => void; addFailureFor?: (id: string) => void
  renderModes: (value: string[], onChange: (value: string[]) => void) => ReactNode
  modeId?: string
  focusRequest?: { instanceId: string; functionId: string; nonce: number }
} & FunctionTraceNavigation) {
  const [defaults, setDefaults] = useState(false), [showDisabled, setShowDisabled] = useState(false)
  const [expandedId, setExpandedId] = useState('')
  useEffect(() => { setExpandedId(''); setDefaults(false); setShowDisabled(false) }, [instance.id])
  useEffect(() => {
    if (focusRequest?.instanceId !== instance.id) return
    setExpandedId(focusRequest.functionId); setDefaults(false); setShowDisabled(true)
    requestAnimationFrame(() => document.getElementById(`function-${focusRequest.functionId}`)?.scrollIntoView({ block: 'nearest' }))
  }, [focusRequest, instance.id])
  const inputSuppliers = useMemo(() => defaults ? undefined : projectFunctionInputSuppliers(model,
    { instanceId: instance.id, functionId: expandedId, modeId }), [model, instance.id, expandedId, modeId, defaults])
  const functionOverride = (id: string) => instance.function_overrides.find(item => item.function_id === id)
  const failureOverride = (id: string) => instance.failure_mode_overrides.find(item => item.failure_mode_id === id)
  const effective = effectiveSystemFunctions(model, instance.id)
  const functions = defaults ? definition.functions : definition.functions.flatMap(fn => {
    const active = effective.find(item => item.id === fn.id)
    return active ? [active] : showDisabled ? [{ ...fn, ...functionOverride(fn.id) }] : []
  })
  const failures = definition.failure_modes.map(mode => ({ ...mode,
    ...Object.fromEntries(Object.entries(defaults ? {} : failureOverride(mode.id) ?? {}).filter(([, value]) => value != null)) }))
  const commit = (next: SystemDefinitionModel) => onModelChange(populateSystemInterfaceFunctions(next, model))
  const changeFunction = (fn: SystemFunction, patch: Partial<SystemFunction>, resources: SystemResource[] = model.resources) => {
    if (defaults) commit(updateReusableFunction(model, definition.id, { ...fn, ...patch }, resources))
    else commit(upsertInstalledFunction(model, instance.id, { ...fn, ...patch }, { resources }))
  }
  const changeFailure = (id: string, patch: Partial<SystemBlockInstance['failure_mode_overrides'][number]>) => {
    if (defaults) {
      const { enabled: _enabled, failure_mode_id: _failureId, ...fields } = patch
      updateDefinition({ failure_modes: definition.failure_modes.map(item => item.id === id ? { ...item, ...fields } : item) })
    } else {
      const existing = failureOverride(id), next = { failure_mode_id: id, enabled: true, ...existing, ...patch }
      updateInstance({ failure_mode_overrides: existing ? instance.failure_mode_overrides.map(item => item.failure_mode_id === id ? next : item)
        : [...instance.failure_mode_overrides, next] })
    }
  }
  const addFailure = (fn: SystemFunction, deviation: string, description: string) => {
    const id = `failure-${crypto.randomUUID()}`
    commit({ ...model, definitions: model.definitions.map(block => block.id === definition.id ? { ...block,
      failure_modes: [...block.failure_modes, { id, function_id: fn.id, deviation_id: deviation, description, mode_ids: [...fn.mode_ids], default_enabled: defaults }] } : block),
      instances: model.instances.map(item => item.definition_id === definition.id && !defaults
        ? { ...item, failure_mode_overrides: [...item.failure_mode_overrides, { failure_mode_id: id, enabled: item.id === instance.id }] } : item) })
  }
  const reconciliation = useMemo(() => inspectFunctionResourceConnections(model), [model])
  return <section aria-label="Installed functions and failures" className="mx-auto max-w-6xl">
    <div className="mb-5 flex items-start justify-between gap-3">
      <h2 className="text-base font-semibold text-slate-900">{instance.name || definition.name}</h2>
      <button type="button" onClick={() => { const id = addFunction(); if (id) setExpandedId(id) }} className={button}>Add function</button>
    </div>
    {!functions.length && <p className="rounded-lg border border-dashed p-6 text-sm text-slate-600">Add a function, then choose its failure modes.</p>}
    {functions.map(fn => {
      const override = functionOverride(fn.id), enabled = defaults || (override?.enabled ?? fn.default_enabled ?? true)
      const expanded = expandedId === fn.id
      const output = model.resources.find(resource => resource.id === fn.definition?.io.find(io => io.direction === 'output')?.resource_id)
      const consumers = expanded && output ? model.instances.flatMap(item => effectiveSystemFunctions(model, item.id)
        .filter(candidate => candidate.definition?.io.some(io => io.direction === 'input' && io.resource_id === output.id))
        .map(candidate => `${item.name} › ${structuredFunctionStatement(candidate.definition, model.resources) || candidate.description}`)) : []
      const assignedFailures = failures.filter(mode => mode.function_id === fn.id && (defaults || (failureOverride(mode.id)?.enabled ?? mode.default_enabled ?? true)))
      const state = fn.definition?.role === 'maintain_state'
      const directInputs = fn.definition?.io.filter(io => io.direction === 'input').length ?? 0
      const suggestions = state ? [{ id: 'absent', label: 'Condition not maintained', description: `${fn.definition?.action || 'Required condition'} not maintained` },
        { id: 'intermittent', label: 'Condition intermittently lost', description: `${fn.definition?.action || 'Required condition'} intermittently lost` }]
        : [{ id: 'absent', label: 'Missing output', description: `No ${output?.name || 'output'}` },
          { id: 'wrong_value_or_state', label: 'Incorrect output', description: `Incorrect ${output?.name || 'output'}` },
          { id: 'intermittent', label: 'Intermittent output', description: `Intermittent ${output?.name || 'output'}` },
          ...(output?.quantity || output?.unit ? [{ id: 'insufficient', label: 'Insufficient output', description: `Insufficient ${output.name}` },
            { id: 'excessive', label: 'Excessive output', description: `Excessive ${output.name}` }] : [])]
      return <article key={fn.id} className={`mb-3 overflow-hidden rounded-xl border ${expanded ? 'border-blue-300 shadow-sm' : 'border-slate-200'}`}>
        <button type="button" aria-expanded={expanded} aria-controls={`function-${fn.id}`} onClick={() => setExpandedId(expanded ? '' : fn.id)}
          className="flex w-full items-center justify-between gap-3 bg-white px-4 py-3 text-left hover:bg-slate-50">
          <span className="min-w-0"><span className="block text-sm font-semibold text-slate-800">{structuredFunctionStatement(fn.definition, model.resources) || fn.description || 'New function'}</span>
            <span className="mt-1 block text-xs text-slate-600">{state ? 'Maintains a condition' : fn.definition?.role === 'source' ? `Source → ${output?.name || 'Output to define'}`
              : `${directInputs} ${directInputs === 1 ? 'input' : 'inputs'} → ${output?.name || 'Output to define'}`}
              {assignedFailures.length > 0 ? ` · ${assignedFailures.length} failure ${assignedFailures.length === 1 ? 'mode' : 'modes'}` : ''}{!enabled ? ' · Disabled' : ''}</span></span>
          <span aria-hidden="true" className="text-slate-600">{expanded ? '−' : '+'}</span>
        </button>
        {expanded && <div id={`function-${fn.id}`} className="space-y-4 border-t border-slate-100 p-4">
          <StructuredFunctionEditor value={fn.definition} resources={model.resources} disabled={!enabled}
            defaultInputInstanceId={instance.id}
            inputOptions={availableFunctionInputs(model, { instanceId: instance.id, functionId: fn.id })}
            inputSuppliers={inputSuppliers}
            onChange={(definition, description, resources) => changeFunction(fn, { definition, description }, resources)} />
          {output && consumers.length > 0 && <p className="text-xs text-slate-600">Output used by {consumers.join('; ')}</p>}
          {!defaults && <ParentFunctionSupportEditor model={model} instanceId={instance.id} functionId={fn.id} onChange={commit} disabled={!enabled} />}
          {reconciliation.ambiguities.filter(item => item.instanceId === instance.id && item.functionId === fn.id).map(item => <label key={item.inputKey} className="block text-xs text-amber-900">
            Choose the interface for this input<select className={`mt-1 ${field}`} value="" onChange={event => commit(reconcileFunctionResources(model,
              { routeSelections: { [item.inputKey]: event.target.value } }).model)}><option value="">Choose a route</option>
              {item.interfaceIds.map(id => <option key={id} value={id}>{model.interfaces.find(edge => edge.id === id)?.name || id}</option>)}</select>
          </label>)}
          <section aria-label="Function failures" className="space-y-2 border-t border-slate-100 pt-3">
            <h3 className="text-xs font-semibold text-slate-700">How could this function fail?</h3>
            <div className="flex flex-wrap gap-2">{suggestions.filter(item => !assignedFailures.some(mode => mode.deviation_id === item.id)).map(item =>
              <button key={item.id} type="button" disabled={!enabled} className={button} onClick={() => addFailure(fn, item.id, item.description)}>+ {item.label}</button>)}
              <button type="button" disabled={!enabled} className={button} onClick={() => addFailure(fn, 'custom', '')}>+ Custom failure</button></div>
            {assignedFailures.map(mode => <div key={mode.id} className="rounded-lg bg-amber-50/60 p-3">
              <div className="flex items-end gap-2"><label className="min-w-0 flex-1 text-xs text-slate-600">
                {state && mode.deviation_id === 'absent' ? 'Condition not maintained' : failureNames[mode.deviation_id] || 'Failure description'}
                <input aria-label="Failure description" value={mode.description} disabled={!enabled} onChange={event => changeFailure(mode.id, { description: event.target.value })} className={`mt-1 ${field}`} />
              </label><button type="button" className={button} aria-label={`Remove failure ${mode.description || 'draft'}`} onClick={() => defaults
                ? updateDefinition({ failure_modes: definition.failure_modes.filter(item => item.id !== mode.id) }) : changeFailure(mode.id, { enabled: false })}>Remove</button></div>
              <details className="mt-2 text-xs text-slate-600"><summary className="cursor-pointer">Failure mode exceptions</summary>
                {renderModes(mode.mode_ids, mode_ids => changeFailure(mode.id, { mode_ids }))}
                {defaults && <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={mode.default_enabled !== false}
                  onChange={event => updateDefinition({ failure_modes: definition.failure_modes.map(item => item.id === mode.id ? { ...item, default_enabled: event.target.checked } : item) })} />Enabled on new installations</label>}
              </details>
            </div>)}
          </section>
          <details className="border-t border-slate-100 pt-3 text-xs text-slate-600"><summary className="cursor-pointer font-medium">Advanced function settings</summary>
            <div className="mt-3 space-y-3">
              {!defaults && <label className="flex items-center gap-2"><input type="checkbox" checked={enabled} onChange={event => {
                const next = { function_id: fn.id, enabled: event.target.checked, ...override }; next.enabled = event.target.checked
                updateInstance({ function_overrides: override ? instance.function_overrides.map(item => item.function_id === fn.id ? next : item) : [...instance.function_overrides, next] })
              }} />Enabled for this block</label>}
              <label className="block max-w-xs">Function classification<select value={fn.function_type} className={`mt-1 ${field}`}
                onChange={event => changeFunction(fn, { function_type: event.target.value as SystemFunction['function_type'] })}>
                {['primary', 'supporting', 'interface', 'monitoring', 'system_response'].map(type => <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>)}</select></label>
              {renderModes(fn.mode_ids, mode_ids => changeFunction(fn, { mode_ids }))}
              {defaults && <label className="flex items-center gap-2"><input type="checkbox" checked={fn.default_enabled !== false}
                onChange={event => changeFunction(fn, { default_enabled: event.target.checked })} />Enabled on new installations</label>}
              {defaults && <button type="button" onClick={() => removeFunction(fn.id)} className={button}>Delete reusable function</button>}
            </div>
          </details>
        </div>}
      </article>
    })}
    <details className="mt-5 text-xs text-slate-600"><summary className="cursor-pointer font-medium">Advanced block settings</summary>
      <div className="mt-3 space-y-2"><label className="flex items-center gap-2"><input type="checkbox" checked={defaults} onChange={event => setDefaults(event.target.checked)} />Edit reusable definition</label>
        {defaults && <p className="text-amber-900">Applies to all instances without an override.</p>}
        <label className="flex items-center gap-2"><input type="checkbox" checked={showDisabled} onChange={event => setShowDisabled(event.target.checked)} />Show disabled functions</label></div>
    </details>
  </section>
}
