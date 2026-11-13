import { useId } from 'react'
import type { StructuredFunctionDefinition, SystemResource } from '../../api/systemDefinition'
import { structuredFunctionStatement } from '../../store/systemArchitecture'
import FunctionInputSuppliers, { type FunctionInputSupplier } from './FunctionInputSuppliers'
import InputResourcePicker from './InputResourcePicker'
import type { FunctionInputOption } from '../../store/functionResourceFlows'

const field = 'w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500'
const button = 'rounded border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 hover:border-blue-400 disabled:opacity-50'
const categories: SystemResource['category'][] = ['energy', 'information', 'material', 'physical', 'human_machine', 'clearance']
const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`

/** One atomic change carries the definition and its output resource metadata. */
export default function StructuredFunctionEditor({ value, resources, onChange, inputOptions, inputSuppliers, defaultInputInstanceId, disabled = false }: {
  value?: StructuredFunctionDefinition; resources: SystemResource[]
  onChange: (definition: StructuredFunctionDefinition, description: string, resources: SystemResource[]) => void
  inputOptions?: FunctionInputOption[]
  inputSuppliers?: Record<string, FunctionInputSupplier[]>
  defaultInputInstanceId?: string
  disabled?: boolean
}) {
  const id = useId()
  const definition = value ?? { role: 'transform' as const, action: '', io: [] }
  const emit = (next: StructuredFunctionDefinition, registry = resources) => onChange(next, structuredFunctionStatement(next, registry), registry)
  const inputs = definition.io.filter(io => io.direction === 'input'), output = definition.io.find(io => io.direction === 'output')
  const resource = resources.find(item => item.id === output?.resource_id)
  const options = (inputOptions ?? [])
    .filter(option => option.resource.id !== output?.resource_id)
  const updateOutput = (patch: Partial<SystemResource>) => {
    const nextResource: SystemResource = { id: resource?.id ?? newId('resource'), name: '', category: 'information', ...resource, ...patch }
    const registry = resource ? resources.map(item => item.id === resource.id ? nextResource : item) : [...resources, nextResource]
    emit({ ...definition, io: [...inputs, { id: output?.id ?? newId('io'), direction: 'output', resource_id: nextResource.id }] }, registry)
  }
  const missing = [!definition.action.trim() ? definition.role === 'maintain_state' ? 'Describe the maintained condition.' : 'Describe what this function does.' : '',
    definition.role === 'transform' && !inputs.some(io => io.resource_id) ? 'Choose an input resource.' : '',
    definition.role !== 'maintain_state' && !resource?.name.trim() ? 'Name the output resource.' : ''].filter(Boolean)
  return <fieldset disabled={disabled} className="space-y-4 disabled:opacity-60">
    <legend className="sr-only">Function definition</legend>
    <label htmlFor={`${id}-kind`} className="block max-w-xs text-xs text-slate-600">Function kind
      <select id={`${id}-kind`} value={definition.role} className={`mt-1 ${field}`} onChange={event => {
        const role = event.target.value as StructuredFunctionDefinition['role']
        emit({ ...definition, role, ...(role === 'maintain_state' ? { state_verb: definition.state_verb ?? 'maintain' } : {}),
          io: role === 'maintain_state' ? [] : role === 'source' ? definition.io.filter(io => io.direction === 'output').slice(0, 1) : definition.io })
      }}><option value="transform">Transform</option><option value="source">Source</option><option value="maintain_state">Maintain State</option></select>
    </label>
    {definition.role === 'maintain_state' ? <label className="block text-xs font-medium text-slate-700">Condition to maintain
      <input value={definition.action} onChange={event => emit({ ...definition, action: event.target.value })} className={`mt-1 ${field}`} placeholder="e.g. secure attachment" />
      <span className="mt-1 block text-xs font-normal text-slate-500">No resource inputs or outputs.</span>
    </label> : <div className="grid items-start gap-4 lg:grid-cols-[1fr_1fr_1fr]">
      <section aria-label="Function inputs" className="min-w-0 space-y-2 rounded-lg bg-slate-50 p-3">
        <h3 className="text-xs font-semibold text-slate-700">1 · Inputs</h3>
        {definition.role === 'source' ? <p className="text-xs text-slate-500">No inputs required.</p> : <>
          {inputs.map((io, index) => <div key={io.id}>
            <div className="flex items-end gap-1">
              <div className="min-w-0 flex-1"><InputResourcePicker value={io.resource_id} options={options} label={`Input ${index + 1}`}
                defaultInstanceId={defaultInputInstanceId}
                resource={resources.find(resource => resource.id === io.resource_id)}
                onChange={resource_id => emit({ ...definition, io: definition.io.map(item => item.id === io.id ? { ...item, resource_id } : item) })} /></div>
              <button type="button" className={button} aria-label={`Remove input ${index + 1}`} onClick={() => emit({ ...definition,
                io: definition.io.filter(item => item.id !== io.id) })}>×</button>
            </div>
            <FunctionInputSuppliers key={io.resource_id} suppliers={inputSuppliers?.[io.id] ?? []} id={`${id}-input-${index}-suppliers`} inputNumber={index + 1} />
          </div>)}
          <button type="button" className={button} onClick={() => emit({ ...definition, io: [...definition.io,
            { id: newId('io'), direction: 'input', resource_id: '' }] })}>Add input</button>
          {!options.length && <p className="text-xs text-slate-500">Add an output to another function or an external source first.</p>}
        </>}
      </section>
      <label className="block text-xs font-semibold text-slate-700">2 · Function
        <textarea aria-label="Function action" value={definition.action} rows={3} onChange={event => emit({ ...definition, action: event.target.value })}
          className={`mt-2 resize-y font-normal ${field}`} placeholder={definition.role === 'source' ? 'e.g. Generate electrical power' : 'e.g. Convert electrical power to rotation'} />
      </label>
      <section aria-label="Function output" className="min-w-0 space-y-2 rounded-lg bg-blue-50/60 p-3">
        <h3 className="text-xs font-semibold text-slate-700">3 · Output</h3>
        <label className="block text-xs text-slate-600">Output resource<input value={resource?.name ?? ''} onChange={event => updateOutput({ name: event.target.value })}
          className={`mt-1 ${field}`} placeholder="e.g. Shaft rotation" /></label>
        <label className="block text-xs text-slate-600">Resource category<select value={resource?.category ?? 'information'}
          onChange={event => updateOutput({ category: event.target.value as SystemResource['category'] })} className={`mt-1 ${field}`}>
          {categories.map(category => <option key={category} value={category}>{category.replace(/_/g, ' ').replace(/^./, letter => letter.toUpperCase())}</option>)}
        </select></label>
      </section>
    </div>}
    {missing.length > 0 && <p role="status" className="text-xs text-slate-600">Draft · {missing.join(' ')}</p>}
    <details className="text-xs text-slate-600"><summary className="cursor-pointer font-medium">Additional function properties</summary>
      {definition.role === 'maintain_state' ? <label className="mt-2 block max-w-xs">State action<select value={definition.state_verb ?? 'maintain'}
        onChange={event => emit({ ...definition, state_verb: event.target.value as StructuredFunctionDefinition['state_verb'] })} className={`mt-1 ${field}`}>
        {['maintain', 'secure', 'support', 'contain', 'isolate', 'protect'].map(verb => <option key={verb} value={verb}>{verb.replace(/^./, letter => letter.toUpperCase())}</option>)}
      </select></label> : <div className="mt-2 grid max-w-md grid-cols-2 gap-2">
        <label>Output quantity (optional)<input value={resource?.quantity ?? ''} onChange={event => updateOutput({ quantity: event.target.value })} className={`mt-1 ${field}`} /></label>
        <label>Output unit (optional)<input value={resource?.unit ?? ''} onChange={event => updateOutput({ unit: event.target.value })} className={`mt-1 ${field}`} /></label>
      </div>}
    </details>
  </fieldset>
}
