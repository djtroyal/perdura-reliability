/**
 * Failure Analysis tab — per validated function: triage the six guide-word
 * failure-mode candidates (keep with description or dismiss with reason);
 * per kept mode: build knob+setting cause chains (14 knob categories, 7 knob
 * types, AFD resource checks, terminal design-param/requirement markers),
 * bind detection controls (informing functions), preview the structural
 * effect chain, and flag mitigations.
 */
import { useState } from 'react'
import { Plus, Trash2, ChevronDown, ChevronRight, ArrowUpRight, Eye, ShieldAlert } from 'lucide-react'
import InfoLabel from '../shared/InfoLabel'
import {
  FmeaState, Fn, FailureMode, Cause, Guideword, GUIDEWORDS,
  KNOB_CATEGORIES, KNOB_TYPES, KnobCategory, KnobType,
  MITIGATION_FAMILIES, MitigationFamily, newId,
} from './model'
import { fnLabel, effectsOf, deriveFailureModes, isTriaged, causesOfMode, subCauses, severitySuggestion } from './engine'

const INPUT = 'text-xs border border-gray-300 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white'

export default function AnalysisTab({ s, patch }: {
  s: FmeaState
  patch: (p: Partial<FmeaState>) => void
}) {
  const [openFn, setOpenFn] = useState<string | null>(null)
  const [openMode, setOpenMode] = useState<string | null>(null)

  const analyzable = s.functions.filter(f => f.type !== 'harmful')

  const ensureModes = (fn: Fn) => {
    const missing = deriveFailureModes(fn, s.modes)
    if (missing.length === 0) return
    patch({
      modes: [...s.modes, ...missing.map((g): FailureMode => ({
        id: newId('fm'), fnId: fn.id, guideword: g, description: '',
        dismissed: false, dismissReason: '', harmedObjectId: null,
      }))],
    })
  }

  const updMode = (id: string, p: Partial<FailureMode>) =>
    patch({ modes: s.modes.map(m => m.id === id ? { ...m, ...p } : m) })

  const addCause = (modeId: string | null, causeId: string | null) =>
    patch({
      causes: [...s.causes, {
        id: newId('cz'), parentModeId: modeId, parentCauseId: causeId,
        objectId: null, knobCategory: 'Existence' as KnobCategory, attribute: '', setting: '',
        knobType: null, terminal: null, afdResourcesPresent: null, afdNote: '',
        contradiction: false, contradictionNote: '',
      }],
    })

  const updCause = (id: string, p: Partial<Cause>) =>
    patch({ causes: s.causes.map(c => c.id === id ? { ...c, ...p } : c) })

  const removeCause = (id: string) => {
    const doomed = new Set([id])
    let grew = true
    while (grew) {
      grew = false
      for (const c of s.causes) if (c.parentCauseId && doomed.has(c.parentCauseId) && !doomed.has(c.id)) { doomed.add(c.id); grew = true }
    }
    patch({ causes: s.causes.filter(c => !doomed.has(c.id)) })
  }

  const detFor = (modeId: string) => s.detections.find(d => d.modeId === modeId)
  const addDetection = (modeId: string) =>
    patch({
      detections: [...s.detections, {
        id: newId('det'), modeId, subject: '', observer: '', transformations: '1',
        contact: false, destructive: false, addedParts: false, periodic: false, note: '',
      }],
    })

  const flagsFor = (modeId: string) => s.mitigations.filter(f => f.modeId === modeId)
  const addFlag = (modeId: string) =>
    patch({
      mitigations: [...s.mitigations, {
        id: newId('mit'), modeId, causeId: null, family: 'idealize' as MitigationFamily, note: '',
      }],
    })

  // ---- cause node renderer (recursive one level via subCauses) ----
  const CauseNode = ({ c, depth }: { c: Cause; depth: number }) => (
    <div className="flex flex-col gap-1" style={{ marginLeft: depth * 18 }}>
      <div className="flex items-center gap-1.5 flex-wrap bg-white border border-gray-200 rounded px-2 py-1">
        <select value={c.objectId ?? ''} onChange={e => updCause(c.id, { objectId: e.target.value || null })}
          className={INPUT} title="Object whose attribute deviates">
          <option value="">(global/env)</option>
          {s.objects.map(o => <option key={o.id} value={o.id}>{o.name || '(unnamed)'}</option>)}
        </select>
        <select value={c.knobCategory} onChange={e => updCause(c.id, { knobCategory: e.target.value as KnobCategory })}
          className={INPUT} title="Knob category (Table of Knobs — the missing-cause sweep)">
          {KNOB_CATEGORIES.map(k => <option key={k} value={k}>{k}</option>)}
        </select>
        <input value={c.attribute} placeholder="attribute (knob)" onChange={e => updCause(c.id, { attribute: e.target.value })}
          className={`${INPUT} w-36`} />
        <span className="text-[10px] text-gray-400">=</span>
        <input value={c.setting} placeholder="bad setting" onChange={e => updCause(c.id, { setting: e.target.value })}
          className={`${INPUT} w-28`} />
        <select value={c.knobType ?? ''} onChange={e => updCause(c.id, { knobType: (e.target.value || null) as KnobType | null })}
          className={INPUT} title="How hard is this knob to turn?">
          <option value="">knob type…</option>
          {KNOB_TYPES.map(k => <option key={k.key} value={k.key} title={k.hint}>{k.label}</option>)}
        </select>
        <select value={c.terminal ?? ''} onChange={e => updCause(c.id, { terminal: (e.target.value || null) as Cause['terminal'] })}
          className={INPUT} title='Requirements and design parameters "are not caused by anything" — stop descending here'>
          <option value="">…caused by</option>
          <option value="designParam">terminal: design param</option>
          <option value="requirement">terminal: requirement</option>
        </select>
        <label className="flex items-center gap-1 text-[10px] text-gray-500" title="Fixing this setting worsens another attribute — a contradiction (route to separation strategies)">
          <input type="checkbox" checked={c.contradiction} onChange={e => updCause(c.id, { contradiction: e.target.checked })} />
          contradiction
        </label>
        <label className="flex items-center gap-1 text-[10px] text-gray-500" title="AFD saboteur check: are the physical resources for this cause actually present? A cause without available resources is not credible.">
          <input type="checkbox" checked={c.afdResourcesPresent === true}
            onChange={e => updCause(c.id, { afdResourcesPresent: e.target.checked ? true : null })} />
          resources present
        </label>
        {!c.terminal && (
          <button onClick={() => addCause(null, c.id)} title="Add a deeper cause (why is this attribute at this setting?)"
            className="text-gray-300 hover:text-blue-500"><Plus size={12} /></button>
        )}
        <button onClick={() => removeCause(c.id)} className="text-gray-300 hover:text-red-500"><Trash2 size={12} /></button>
      </div>
      {c.contradiction && (
        <input value={c.contradictionNote} placeholder='Contradiction: "must be A in order to…, must be B in order to…"'
          onChange={e => updCause(c.id, { contradictionNote: e.target.value })}
          className={`${INPUT} ml-4 border-violet-200`} style={{ maxWidth: 480 }} />
      )}
      {subCauses(c.id, s).map(sc => <CauseNode key={sc.id} c={sc} depth={depth + 1} />)}
    </div>
  )

  return (
    <div className="p-4 max-w-6xl flex flex-col gap-2">
      <InfoLabel tip="For every validated function, all six guide words must be triaged: kept with a concrete failure-mode description, or dismissed with a reason. Harmful functions don't appear here — they ARE failure content (the 'unintended side effect' guide word of their useful sibling).">
        Failure analysis — {analyzable.length} functions to analyze
      </InfoLabel>

      {analyzable.length === 0 && (
        <p className="text-xs text-gray-400 border border-dashed border-gray-300 rounded p-6 text-center">
          Define functions first — failure modes are derived from them, not invented.
        </p>
      )}

      {analyzable.map(fn => {
        const fnModes = s.modes.filter(m => m.fnId === fn.id)
        const open = openFn === fn.id
        const triaged = fnModes.filter(isTriaged).length
        return (
          <div key={fn.id} className="border border-gray-200 rounded bg-white">
            <div className="flex items-center gap-2 px-2 py-1.5 cursor-pointer"
              onClick={() => { setOpenFn(open ? null : fn.id); if (!open) ensureModes(fn) }}>
              {open ? <ChevronDown size={13} className="text-gray-400" /> : <ChevronRight size={13} className="text-gray-400" />}
              <span className="text-xs font-medium text-gray-800 flex-1 truncate">{fnLabel(fn, s.objects)}</span>
              <span className={`text-[10px] ${triaged === 6 ? 'text-emerald-600' : 'text-gray-400'}`}>
                {triaged}/6 guide words triaged
              </span>
            </div>

            {open && (
              <div className="border-t border-gray-100 p-3 flex flex-col gap-2">
                {GUIDEWORDS.map(gw => {
                  const mode = fnModes.find(m => m.guideword === gw.key)
                  if (!mode) return null
                  const kept = !mode.dismissed && mode.description.trim()
                  const modeOpen = openMode === mode.id
                  const chain = kept ? effectsOf(mode.id, s) : []
                  const det = detFor(mode.id)
                  return (
                    <div key={gw.key} className={`border rounded ${kept ? 'border-blue-200' : mode.dismissed ? 'border-gray-100 opacity-70' : 'border-amber-200'}`}>
                      <div className="flex items-center gap-2 px-2 py-1.5">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 w-40 flex-shrink-0" title={gw.hint}>
                          {gw.label}
                        </span>
                        {!mode.dismissed ? (
                          <input value={mode.description}
                            placeholder="Describe the concrete failure mode (or dismiss →)"
                            onChange={e => updMode(mode.id, { description: e.target.value })}
                            className={`${INPUT} flex-1`} />
                        ) : (
                          <input value={mode.dismissReason}
                            placeholder="Why is this guide word not credible here? (required)"
                            onChange={e => updMode(mode.id, { dismissReason: e.target.value })}
                            className={`${INPUT} flex-1 italic`} />
                        )}
                        {mode.guideword === 'unintended' && !mode.dismissed && (
                          <select value={mode.harmedObjectId ?? ''} onChange={e => updMode(mode.id, { harmedObjectId: e.target.value || null })}
                            className={INPUT} title="Which object is harmed by the side effect?">
                            <option value="">harmed object…</option>
                            {s.objects.map(o => <option key={o.id} value={o.id}>{o.name || '(unnamed)'}</option>)}
                          </select>
                        )}
                        <label className="flex items-center gap-1 text-[10px] text-gray-500">
                          <input type="checkbox" checked={mode.dismissed}
                            onChange={e => updMode(mode.id, { dismissed: e.target.checked })} />
                          dismiss
                        </label>
                        {kept && (
                          <button onClick={() => setOpenMode(modeOpen ? null : mode.id)}
                            className={`text-[11px] ${modeOpen ? 'text-violet-700 font-medium' : 'text-blue-600 hover:text-blue-700'}`}>
                            {modeOpen ? 'close' : `causes (${causesOfMode(mode.id, s).length}) · detection${det ? ' ✓' : ''}`}
                          </button>
                        )}
                      </div>

                      {kept && modeOpen && (
                        <div className="border-t border-gray-100 px-3 py-2 flex flex-col gap-3 bg-gray-50/60">
                          {/* Effects preview (derived, read-only) */}
                          <div className="text-[11px] text-gray-600 flex items-start gap-1.5">
                            <ArrowUpRight size={13} className="text-gray-400 flex-shrink-0 mt-0.5" />
                            <span>
                              <b>Effect chain (derived):</b>{' '}
                              {chain.length
                                ? chain.map(c => c.label).join(' → ')
                                : 'this function IS the Job Function — the effect is direct mission impact'}
                              <span className="text-gray-400"> · suggested severity {severitySuggestion(mode.id, s)}</span>
                            </span>
                          </div>

                          {/* Causes */}
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[11px] font-medium text-gray-600" title="Causes are object attributes (knobs) at bad settings, chained by causality. Sweep the 14 knob categories to catch missing causes; existence is a knob.">
                                Causes — knob + setting chains
                              </span>
                              <button onClick={() => addCause(mode.id, null)}
                                className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700">
                                <Plus size={11} /> Add cause
                              </button>
                            </div>
                            <div className="flex flex-col gap-1.5">
                              {causesOfMode(mode.id, s).map(c => <CauseNode key={c.id} c={c} depth={0} />)}
                              {causesOfMode(mode.id, s).length === 0 && (
                                <p className="text-[11px] text-gray-400">No causes yet. Ask the saboteur question: with the resources present in this system, how would you MAKE this failure happen (and hide it)?</p>
                              )}
                            </div>
                          </div>

                          {/* Detection */}
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[11px] font-medium text-gray-600" title="A detection control is an informing function: the failing parameter (subject) informs an observer through a chain of transformations. Fewer transformations, non-contact, non-destructive, continuous = more ideal.">
                                <Eye size={11} className="inline mr-1" />Detection control
                              </span>
                              {!det && (
                                <button onClick={() => addDetection(mode.id)}
                                  className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700">
                                  <Plus size={11} /> Add detection
                                </button>
                              )}
                            </div>
                            {det && (
                              <div className="flex items-center gap-1.5 flex-wrap bg-white border border-gray-200 rounded px-2 py-1">
                                <input value={det.subject} placeholder="subject (what is observed)"
                                  onChange={e => patch({ detections: s.detections.map(d => d.id === det.id ? { ...d, subject: e.target.value } : d) })}
                                  className={`${INPUT} w-44`} />
                                <span className="text-[10px] text-gray-400">informs</span>
                                <input value={det.observer} placeholder="observer"
                                  onChange={e => patch({ detections: s.detections.map(d => d.id === det.id ? { ...d, observer: e.target.value } : d) })}
                                  className={`${INPUT} w-36`} />
                                <label className="text-[10px] text-gray-500 flex items-center gap-1" title="Transformations in the measurement chain — each is a burden and a failure point of the detection itself">
                                  chain
                                  <input value={det.transformations}
                                    onChange={e => patch({ detections: s.detections.map(d => d.id === det.id ? { ...d, transformations: e.target.value } : d) })}
                                    className={`${INPUT} w-10 text-center`} />
                                </label>
                                {([['contact', 'contact'], ['destructive', 'destructive'], ['periodic', 'periodic'], ['addedParts', 'added parts']] as const).map(([k, lbl]) => (
                                  <label key={k} className="flex items-center gap-1 text-[10px] text-gray-500">
                                    <input type="checkbox" checked={det[k]}
                                      onChange={e => patch({ detections: s.detections.map(d => d.id === det.id ? { ...d, [k]: e.target.checked } : d) })} />
                                    {lbl}
                                  </label>
                                ))}
                                <button onClick={() => patch({ detections: s.detections.filter(d => d.id !== det.id) })}
                                  className="text-gray-300 hover:text-red-500 ml-auto"><Trash2 size={12} /></button>
                              </div>
                            )}
                          </div>

                          {/* Mitigation flags */}
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[11px] font-medium text-gray-600" title="V1 flags the mitigation direction (elimination / convert-to-useful / neutralize / contradiction / idealize); the guided TRIZ ladders come in a later version.">
                                <ShieldAlert size={11} className="inline mr-1" />Mitigation flags
                              </span>
                              <button onClick={() => addFlag(mode.id)}
                                className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700">
                                <Plus size={11} /> Add flag
                              </button>
                            </div>
                            <div className="flex flex-col gap-1">
                              {flagsFor(mode.id).map(f => (
                                <div key={f.id} className="flex items-center gap-1.5 bg-white border border-gray-200 rounded px-2 py-1">
                                  <select value={f.family}
                                    onChange={e => patch({ mitigations: s.mitigations.map(x => x.id === f.id ? { ...x, family: e.target.value as MitigationFamily } : x) })}
                                    className={INPUT}>
                                    {MITIGATION_FAMILIES.map(m => <option key={m.key} value={m.key} title={m.hint}>{m.label}</option>)}
                                  </select>
                                  <input value={f.note} placeholder="note / proposed action"
                                    onChange={e => patch({ mitigations: s.mitigations.map(x => x.id === f.id ? { ...x, note: e.target.value } : x) })}
                                    className={`${INPUT} flex-1`} />
                                  <button onClick={() => patch({ mitigations: s.mitigations.filter(x => x.id !== f.id) })}
                                    className="text-gray-300 hover:text-red-500"><Trash2 size={12} /></button>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
