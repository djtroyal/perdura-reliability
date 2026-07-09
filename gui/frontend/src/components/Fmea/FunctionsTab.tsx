/**
 * Functions tab — the grammar-validated function graph. Every function is
 * Tool →(modification)→ Product with live validation against the six tests
 * (suspect verbs, physicality, longhand attribute…). The interaction-sweep
 * matrix drives completeness: every object pair must be consciously reviewed
 * for functions (useful, harmful or informing) or left empty on purpose.
 */
import { useState } from 'react'
import { Plus, Trash2, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, Grid2x2 } from 'lucide-react'
import InfoLabel from '../shared/InfoLabel'
import { FmeaState, Fn, FnType, LonghandOp, EMPTY_REQUIREMENTS, newId } from './model'
import { validateFunction, fnLabel } from './engine'
import VerbPicker from './VerbPicker'

const INPUT = 'text-xs border border-gray-300 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white'
const TYPE_BADGE: Record<FnType, string> = {
  useful: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  harmful: 'bg-red-50 text-red-700 border-red-200',
  informing: 'bg-blue-50 text-blue-700 border-blue-200',
}

export default function FunctionsTab({ s, patch }: {
  s: FmeaState
  patch: (p: Partial<FmeaState>) => void
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [showMatrix, setShowMatrix] = useState(false)

  const upd = (id: string, p: Partial<Fn>) =>
    patch({ functions: s.functions.map(f => f.id === id ? { ...f, ...p } : f) })

  const add = (toolId: string | null = null, productId?: string) => {
    const id = newId('fn')
    patch({
      functions: [...s.functions, {
        id, toolId, productId: productId ?? (s.objects[0]?.id ?? ''), verb: '',
        longhandOp: 'changes', attribute: '', type: 'useful', parentFnId: null,
        requirements: { ...EMPTY_REQUIREMENTS }, rationale: '',
      }],
    })
    setOpenId(id)
  }

  const remove = (id: string) =>
    patch({
      functions: s.functions.filter(f => f.id !== id).map(f => f.parentFnId === id ? { ...f, parentFnId: null } : f),
      modes: s.modes.filter(m => m.fnId !== id),
    })

  const pairKey = (a: string, b: string) => [a, b].sort().join('|')
  const toggleSwept = (a: string, b: string) => {
    const k = pairKey(a, b)
    patch({
      sweptPairs: s.sweptPairs.includes(k)
        ? s.sweptPairs.filter(x => x !== k)
        : [...s.sweptPairs, k],
    })
  }
  const fnsBetween = (a: string, b: string) =>
    s.functions.filter(f =>
      (f.toolId === a && f.productId === b) || (f.toolId === b && f.productId === a))

  const objName = (id: string | null) => s.objects.find(o => o.id === id)?.name || '(unnamed)'

  return (
    <div className="p-4 max-w-5xl flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <InfoLabel tip="Each function is Tool → modification → Product, where the modification must physically change or control an attribute of the product. The arrow is causality. Informing functions run subject → observer (the measured thing informs the observer).">
          Functions ({s.functions.length})
        </InfoLabel>
        <div className="flex items-center gap-3">
          <button onClick={() => setShowMatrix(v => !v)}
            className={`flex items-center gap-1 text-xs ${showMatrix ? 'text-violet-700' : 'text-gray-500 hover:text-gray-700'}`}
            title="Pairwise interaction sweep — review every object pair for functions">
            <Grid2x2 size={13} /> Interaction sweep
          </button>
          <button onClick={() => add()}
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
            disabled={s.objects.length === 0}>
            <Plus size={13} /> Add function
          </button>
        </div>
      </div>

      {s.objects.length === 0 && (
        <p className="text-xs text-gray-400 border border-dashed border-gray-300 rounded p-6 text-center">
          Define the system structure first — functions link the objects you declared there.
        </p>
      )}

      {/* ---- Interaction sweep matrix ---- */}
      {showMatrix && s.objects.length >= 2 && (
        <div className="border border-violet-200 bg-violet-50/40 rounded p-3 overflow-x-auto">
          <p className="text-[11px] text-gray-600 mb-2">
            Consider every pair of objects one at a time: do they interact (useful, harmful or informing)?
            Click a cell to add a function for the pair; check the box to mark the pair consciously reviewed.
            Completeness of the function list comes from finishing this sweep.
          </p>
          <table className="text-[11px]">
            <thead>
              <tr>
                <th></th>
                {s.objects.map(o => (
                  <th key={o.id} className="px-1.5 py-1 font-medium text-gray-600 max-w-24 truncate">{o.name || '?'}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.objects.map((a, i) => (
                <tr key={a.id}>
                  <th className="px-1.5 py-1 font-medium text-gray-600 text-left max-w-32 truncate">{a.name || '?'}</th>
                  {s.objects.map((b, j) => {
                    if (j <= i) return <td key={b.id} className="bg-gray-100/60" />
                    const fns = fnsBetween(a.id, b.id)
                    const swept = s.sweptPairs.includes(pairKey(a.id, b.id))
                    return (
                      <td key={b.id} className={`border border-violet-100 px-1 py-0.5 text-center ${swept ? 'bg-emerald-50' : 'bg-white'}`}>
                        <div className="flex items-center gap-1 justify-center">
                          <button onClick={() => add(a.id, b.id)} title={`Add function: ${a.name} → ${b.name}`}
                            className={`${fns.length ? 'text-blue-600 font-semibold' : 'text-gray-300 hover:text-blue-500'}`}>
                            {fns.length || '+'}
                          </button>
                          <input type="checkbox" checked={swept} onChange={() => toggleSwept(a.id, b.id)}
                            title="Pair consciously reviewed" className="scale-90" />
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- Function list ---- */}
      <div className="flex flex-col gap-1.5">
        {s.functions.map(fn => {
          const issues = validateFunction(fn, s.objects)
          const errors = issues.filter(i => i.severity === 'error')
          const open = openId === fn.id
          return (
            <div key={fn.id} className={`border rounded ${errors.length ? 'border-red-200' : 'border-gray-200'} bg-white`}>
              <div className="flex items-center gap-2 px-2 py-1.5 cursor-pointer"
                onClick={() => setOpenId(open ? null : fn.id)}>
                {open ? <ChevronDown size={13} className="text-gray-400" /> : <ChevronRight size={13} className="text-gray-400" />}
                <span className="text-xs font-medium text-gray-800 flex-1 truncate">
                  {fnLabel(fn, s.objects)}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${TYPE_BADGE[fn.type]}`}>{fn.type}</span>
                {errors.length
                  ? <span title={errors.map(e => e.message).join('\n')}><AlertTriangle size={13} className="text-red-500" /></span>
                  : <span title="Grammar valid"><CheckCircle2 size={13} className="text-emerald-500" /></span>}
                <button tabIndex={-1} onClick={e => { e.stopPropagation(); remove(fn.id) }}
                  className="text-gray-300 hover:text-red-500"><Trash2 size={12} /></button>
              </div>

              {open && (
                <div className="border-t border-gray-100 p-3 flex flex-col gap-2.5">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-0.5">Tool (acting object)</label>
                      <select value={fn.toolId ?? ''} onChange={e => upd(fn.id, { toolId: e.target.value || null })} className={`${INPUT} w-full`}>
                        <option value="">— none yet —</option>
                        {s.objects.map(o => <option key={o.id} value={o.id}>{o.name || '(unnamed)'}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-0.5" title="Pick from the mutually exclusive verb dictionary — the longhand attribute fills itself. Type synonyms freely (warms → heats); trap verbs (protects, seals…) redirect to real modifications.">Modification (verb)</label>
                      <VerbPicker
                        value={fn.verb}
                        informing={fn.type === 'informing'}
                        onSelect={sel => upd(fn.id, {
                          verb: sel.verb,
                          longhandOp: sel.longhandOp,
                          // keep a user-customized attribute if the pick has none (custom verb)
                          attribute: sel.attribute || fn.attribute,
                        })}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-0.5">{fn.type === 'informing' ? 'Observer (informed)' : 'Product (object acted on)'}</label>
                      <select value={fn.productId} onChange={e => upd(fn.id, { productId: e.target.value })} className={`${INPUT} w-full`}>
                        {s.objects.map(o => <option key={o.id} value={o.id}>{o.name || '(unnamed)'}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-0.5">Type</label>
                      <select value={fn.type} onChange={e => upd(fn.id, { type: e.target.value as FnType })} className={`${INPUT} w-full`}>
                        <option value="useful">Useful</option>
                        <option value="harmful">Harmful</option>
                        <option value="informing">Informing (measurement)</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-0.5" title="The longhand form disambiguates the verb: what attribute of the product physically changes?">Longhand</label>
                      <select value={fn.longhandOp} onChange={e => upd(fn.id, { longhandOp: e.target.value as LonghandOp })} className={`${INPUT} w-full`}>
                        <option value="changes">changes…</option>
                        <option value="controls">controls…</option>
                        <option value="creates">creates…</option>
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-[10px] text-gray-500 mb-0.5">…attribute of the product</label>
                      <input value={fn.attribute} placeholder="temperature / position / wall thickness"
                        onChange={e => upd(fn.id, { attribute: e.target.value })} className={`${INPUT} w-full`} />
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-0.5" title="Which higher-level function does this one serve? The top function with no parent is the Job Function — where effects terminate.">Serves function</label>
                      <select value={fn.parentFnId ?? ''} onChange={e => upd(fn.id, { parentFnId: e.target.value || null })} className={`${INPUT} w-full`}>
                        <option value="">— none (Job Function) —</option>
                        {s.functions.filter(f => f.id !== fn.id).map(f => (
                          <option key={f.id} value={f.id}>{fnLabel(f, s.objects)}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Requirements drawer */}
                  <details className="text-xs">
                    <summary className="cursor-pointer text-[11px] text-gray-500 hover:text-gray-700">
                      Requirements — the axes on which delivery can fail (level, timing, duty cycle…)
                    </summary>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
                      {([
                        ['level', 'Target level', 'e.g. 0.5 mm/hr'],
                        ['metric', 'Metric', 'e.g. corrosion rate'],
                        ['band', 'Acceptable band', 'e.g. ±10%'],
                        ['duration', 'Duration', 'e.g. < 24 h'],
                        ['sequence', 'Sequence position', 'e.g. after preheat'],
                        ['dutyCycle', 'Duty cycle', 'e.g. continuous'],
                        ['zeroCondition', 'Must NOT act when…', 'e.g. during loading'],
                      ] as const).map(([key, label, ph]) => (
                        <div key={key}>
                          <label className="block text-[10px] text-gray-500 mb-0.5">{label}</label>
                          <input value={fn.requirements[key]} placeholder={ph}
                            onChange={e => upd(fn.id, { requirements: { ...fn.requirements, [key]: e.target.value } })}
                            className={`${INPUT} w-full`} />
                        </div>
                      ))}
                    </div>
                  </details>

                  {/* Validation issues */}
                  {issues.length > 0 && (
                    <div className="flex flex-col gap-1">
                      {issues.map((i, idx) => (
                        <p key={idx} className={`text-[11px] flex gap-1.5 ${i.severity === 'error' ? 'text-red-600' : 'text-amber-600'}`}>
                          <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                          <span><b>Test {i.test}:</b> {i.message}</span>
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
