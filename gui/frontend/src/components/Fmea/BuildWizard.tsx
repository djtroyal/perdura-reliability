/**
 * FMEA Build Wizard — walks the analyst from a blank folio to a structured
 * model: mission (system product + job) → system objects → super-system
 * contacts → function pass (what acts on what, with the verb dictionary) →
 * harm sweep (dual-tool side effects) → review & apply. Applying merges the
 * draft into the folio; the container's normalize pass then auto-derives all
 * guide-word failure modes, links dual-tool harms, and marks swept pairs.
 */
import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import WizardShell from '../shared/WizardShell'
import VerbPicker, { VerbSelection } from './VerbPicker'
import { FmeaState, Fn, FnType, SysObject, EMPTY_REQUIREMENTS, newId } from './model'

const INPUT = 'text-xs border border-gray-300 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white'

const SUPER_SUGGESTIONS = [
  'Operator / user', 'Ambient air', 'Water / moisture', 'Dust / contaminants',
  'Adjacent system', 'Power source', 'Earth / gravity', 'Maintenance technician',
]

interface FnRow {
  tool: string          // object NAME (draft objects have no ids yet)
  product: string
  sel: VerbSelection | null
  type: FnType
}

interface Draft {
  productName: string
  jobSel: VerbSelection | null
  jobTool: string
  sysNames: string
  superChecks: boolean[]
  superExtra: string
  fnRows: FnRow[]
  harmRows: FnRow[]
}

const INITIAL_DRAFT: Draft = {
  productName: '', jobSel: null, jobTool: '', sysNames: '',
  superChecks: SUPER_SUGGESTIONS.map(() => false), superExtra: '',
  fnRows: [], harmRows: [],
}

type StepId = 'mission' | 'system' | 'super' | 'functions' | 'harms' | 'review'
const STEPS: StepId[] = ['mission', 'system', 'super', 'functions', 'harms', 'review']

const splitNames = (text: string) =>
  text.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean)

export default function BuildWizard({ open, onClose, state, onApply }: {
  open: boolean
  onClose: () => void
  state: FmeaState
  onApply: (p: { objects: SysObject[]; functions: Fn[] }) => void
}) {
  const [d, setD] = useState<Draft>(INITIAL_DRAFT)
  const [stepIdx, setStepIdx] = useState(0)
  if (!open) return null

  const set = (p: Partial<Draft>) => setD(prev => ({ ...prev, ...p }))
  const step = STEPS[Math.min(stepIdx, STEPS.length - 1)]

  // Draft object roster (names) — recomputed live from the inputs.
  const sysNames = splitNames(d.sysNames)
  const superNames = [
    ...SUPER_SUGGESTIONS.filter((_, i) => d.superChecks[i]),
    ...splitNames(d.superExtra),
  ]
  const allNames = [
    ...(d.productName.trim() ? [d.productName.trim()] : []),
    ...sysNames, ...superNames,
    ...state.objects.map(o => o.name).filter(Boolean),   // existing folio objects usable too
  ].filter((n, i, a) => a.indexOf(n) === i)

  const canNext =
    step === 'mission' ? d.productName.trim().length > 0 && d.jobSel !== null
    : step === 'system' ? sysNames.length > 0
    : true

  const addFnRow = (rows: 'fnRows' | 'harmRows') =>
    set({ [rows]: [...d[rows], { tool: sysNames[0] ?? '', product: d.productName.trim(), sel: null, type: rows === 'harmRows' ? 'harmful' : 'useful' }] } as Partial<Draft>)

  const updRow = (rows: 'fnRows' | 'harmRows', i: number, p: Partial<FnRow>) =>
    set({ [rows]: d[rows].map((r, j) => j === i ? { ...r, ...p } : r) } as Partial<Draft>)

  const delRow = (rows: 'fnRows' | 'harmRows', i: number) =>
    set({ [rows]: d[rows].filter((_, j) => j !== i) } as Partial<Draft>)

  const validFnRows = d.fnRows.filter(r => r.tool && r.product && r.sel)
  const validHarmRows = d.harmRows.filter(r => r.tool && r.product && r.sel)

  // ---- Apply: build objects + functions, dedupe against existing state ----
  const apply = () => {
    const existingByName = new Map(state.objects.map(o => [o.name.trim().toLowerCase(), o]))
    const created = new Map<string, SysObject>()
    const objId = (name: string, kind: SysObject['kind'], isProduct = false): string => {
      const key = name.trim().toLowerCase()
      const existing = existingByName.get(key)
      if (existing) return existing.id
      const already = created.get(key)
      if (already) return already.id
      const obj: SysObject = { id: newId('obj'), name: name.trim(), parentId: null, kind, isSystemProduct: isProduct, virtual: false, notes: '' }
      created.set(key, obj)
      return obj.id
    }

    const productId = objId(d.productName, 'superSystem', !state.objects.some(o => o.isSystemProduct))
    for (const n of sysNames) objId(n, 'system')
    for (const n of superNames) objId(n, 'superSystem')

    const functions: Fn[] = []
    // Job Function — the top of the effect-propagation walk.
    const jobFnId = newId('fn')
    functions.push({
      id: jobFnId,
      toolId: d.jobTool ? objId(d.jobTool, 'system') : null,
      productId,
      verb: d.jobSel!.verb, longhandOp: d.jobSel!.longhandOp, attribute: d.jobSel!.attribute,
      type: 'useful', parentFnId: null,
      requirements: { ...EMPTY_REQUIREMENTS },
      rationale: 'Job Function — what the system exists to do.',
    })
    for (const r of validFnRows) {
      const isJobDuplicate = r.tool === d.jobTool && r.product === d.productName.trim() && r.sel!.verb === d.jobSel!.verb
      if (isJobDuplicate) continue
      functions.push({
        id: newId('fn'),
        toolId: objId(r.tool, 'system'),
        productId: objId(r.product, r.product === d.productName.trim() ? 'superSystem' : 'system'),
        verb: r.sel!.verb, longhandOp: r.sel!.longhandOp, attribute: r.sel!.attribute,
        type: r.type,
        // Useful functions serve the Job Function by default — wiring the effect walk.
        parentFnId: r.type === 'useful' ? jobFnId : null,
        requirements: { ...EMPTY_REQUIREMENTS },
        rationale: '',
      })
    }
    for (const r of validHarmRows) {
      functions.push({
        id: newId('fn'),
        toolId: objId(r.tool, 'system'),
        productId: objId(r.product, 'system'),
        verb: r.sel!.verb, longhandOp: r.sel!.longhandOp, attribute: r.sel!.attribute,
        type: 'harmful', parentFnId: null,
        requirements: { ...EMPTY_REQUIREMENTS },
        rationale: 'Dual-tool side effect identified in the harm sweep.',
      })
    }

    onApply({ objects: [...created.values()], functions })
    setD(INITIAL_DRAFT)
    setStepIdx(0)
  }

  const FnRowEditor = ({ rows, informingAllowed }: { rows: 'fnRows' | 'harmRows'; informingAllowed: boolean }) => (
    <div className="flex flex-col gap-1.5">
      {d[rows].map((r, i) => (
        <div key={i} className="flex items-center gap-1.5 bg-white border border-gray-200 rounded px-2 py-1.5">
          <select value={r.tool} onChange={e => updRow(rows, i, { tool: e.target.value })} className={INPUT}>
            <option value="">tool…</option>
            {allNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <VerbPicker
            value={r.sel?.verb ?? ''}
            informing={r.type === 'informing'}
            onSelect={sel => updRow(rows, i, { sel })}
            className="w-40"
          />
          <select value={r.product} onChange={e => updRow(rows, i, { product: e.target.value })} className={INPUT}>
            <option value="">{rows === 'harmRows' ? 'harmed object…' : 'product…'}</option>
            {allNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          {informingAllowed && (
            <select value={r.type} onChange={e => updRow(rows, i, { type: e.target.value as FnType, sel: null })} className={INPUT}>
              <option value="useful">useful</option>
              <option value="informing">informing</option>
            </select>
          )}
          {r.sel && <span className="text-[10px] text-gray-400 truncate">{r.sel.longhandOp} {r.sel.attribute}</span>}
          <button onClick={() => delRow(rows, i)} className="text-gray-300 hover:text-red-500 ml-auto"><Trash2 size={12} /></button>
        </div>
      ))}
      <button onClick={() => addFnRow(rows)}
        className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 self-start">
        <Plus size={11} /> Add {rows === 'harmRows' ? 'harm' : 'function'}
      </button>
    </div>
  )

  return (
    <WizardShell
      open={open}
      onClose={onClose}
      title="FMEA build wizard"
      stepCount={STEPS.length}
      stepIdx={stepIdx}
      isFinal={step === 'review'}
      canNext={canNext}
      onBack={() => setStepIdx(i => i - 1)}
      onNext={() => canNext && setStepIdx(i => i + 1)}
      onRestart={() => { setD(INITIAL_DRAFT); setStepIdx(0) }}
      onApply={apply}
      applyLabel="Apply & derive failure modes"
    >
      {step === 'mission' && (
        <>
          <p className="text-xs text-gray-600">What does this system exist to modify, and how? (the Job Function)</p>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-gray-500">The system</span>
            <VerbPicker value={d.jobSel?.verb ?? ''} onSelect={sel => set({ jobSel: sel })} className="w-44" />
            <input value={d.productName} placeholder="the system product (e.g. Test cubes)"
              onChange={e => set({ productName: e.target.value })} className={`${INPUT} w-52`} />
          </div>
          {d.jobSel && (
            <p className="text-[11px] text-gray-500">
              Longhand: the system <b>{d.jobSel.longhandOp} {d.jobSel.attribute}</b> of <b>{d.productName || '…'}</b>.
            </p>
          )}
          <p className="text-[11px] text-gray-400 leading-relaxed">
            Think of the one external thing the whole design is hired to change — a lawn mower&apos;s
            product is the grass, a corrosion lab&apos;s product is the test cubes. It is usually
            OUTSIDE your design authority.
          </p>
        </>
      )}

      {step === 'system' && (
        <>
          <p className="text-xs text-gray-600">List the objects of the system — the parts under your design authority.</p>
          <textarea value={d.sysNames} rows={5} spellCheck={false}
            placeholder={'One per line (or comma-separated):\nAcid\nPan\nOven'}
            onChange={e => set({ sysNames: e.target.value })}
            className={`${INPUT} w-full font-mono resize-y`} />
          {sysNames.length > 0 && (
            <p className="text-[11px] text-gray-500">{sysNames.length} objects: {sysNames.join(', ')}</p>
          )}
        </>
      )}

      {step === 'super' && (
        <>
          <p className="text-xs text-gray-600 mb-1">
            Which super-system elements does the design touch? (things you do NOT control — where the
            severest harms land)
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {SUPER_SUGGESTIONS.map((label, i) => (
              <label key={label} className="flex items-center gap-2 text-xs text-gray-700 bg-white border border-gray-200 rounded px-2 py-1.5 cursor-pointer">
                <input type="checkbox" checked={d.superChecks[i]}
                  onChange={e => set({ superChecks: d.superChecks.map((c, j) => j === i ? e.target.checked : c) })} />
                {label}
              </label>
            ))}
          </div>
          <input value={d.superExtra} placeholder="others (comma-separated)"
            onChange={e => set({ superExtra: e.target.value })} className={`${INPUT} w-full`} />
        </>
      )}

      {step === 'functions' && (
        <>
          <p className="text-xs text-gray-600">
            The function pass: for each object, what does it act on? Pick the verb from the
            dictionary — the physical attribute fills itself.
          </p>
          <div className="flex items-center gap-2 flex-wrap text-[11px] text-gray-500">
            Which object delivers the Job Function ({d.jobSel?.verb} {d.productName})?
            <select value={d.jobTool} onChange={e => set({ jobTool: e.target.value })} className={INPUT}>
              <option value="">— not sure yet —</option>
              {sysNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <FnRowEditor rows="fnRows" informingAllowed={true} />
          <p className="text-[11px] text-gray-400">
            Include informing functions too (gauges, sensors, inspections) — they become the FMEA&apos;s
            detection controls. Object pairs you connect here are automatically marked as swept.
          </p>
        </>
      )}

      {step === 'harms' && (
        <>
          <p className="text-xs text-gray-600">
            The harm sweep (dual-tool principle): a tool that delivers a useful function very often
            harms something else at the same time. Does any tool above also harm an object?
          </p>
          <FnRowEditor rows="harmRows" informingAllowed={false} />
          <p className="text-[11px] text-gray-400">
            Each harm is auto-linked to its useful sibling as an &ldquo;unintended side effect&rdquo;
            failure mode — the acid that corrodes your test cubes is the same acid eating the pan.
          </p>
        </>
      )}

      {step === 'review' && (
        <>
          <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-xs text-gray-700 flex flex-col gap-1">
            <p><b>{d.productName.trim() || '—'}</b> — system product; Job Function: <b>{d.jobSel?.verb}</b> ({d.jobSel?.longhandOp} {d.jobSel?.attribute}){d.jobTool ? ` delivered by ${d.jobTool}` : ''}</p>
            <p>{sysNames.length} system objects · {superNames.length} super-system contacts</p>
            <p>{validFnRows.length + 1} functions · {validHarmRows.length} harms</p>
            <p className="text-violet-700">{(validFnRows.filter(r => r.type !== 'informing').length + 1) * 6} failure-mode candidates will be derived automatically (6 guide words × function).</p>
          </div>
          <p className="text-[11px] text-gray-400">
            Applying merges this into the current analysis (existing objects with the same name are
            reused) and opens Failure Analysis with every guide word ready to triage. Nothing is
            overwritten.
          </p>
        </>
      )}
    </WizardShell>
  )
}
