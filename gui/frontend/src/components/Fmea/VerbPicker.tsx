/**
 * VerbPicker — a searchable combobox over the mutually exclusive verb
 * dictionary. Replaces free-text verb entry: type to filter by verb, synonym,
 * attribute or plain-language definition; picking a verb auto-fills the
 * longhand form (changes/controls/creates + attribute). Traps (protects,
 * seals, measures…) surface their corrective hint with one-click redirects.
 * A "custom" escape hatch keeps free text for cases the dictionary misses.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, AlertTriangle } from 'lucide-react'
import { VERBS, VERB_CATEGORIES, VerbDef, resolveVerb, searchVerbs } from './verbs'

export interface VerbSelection {
  verb: string
  longhandOp: 'changes' | 'controls' | 'creates'
  attribute: string
}

export default function VerbPicker({ value, informing, onSelect, className }: {
  value: string
  /** Filter to informing-function verbs (subject → observer). */
  informing?: boolean
  onSelect: (sel: VerbSelection) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState<string | null>(null)  // null = show `value`
  const wrapRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) { setOpen(false); setQuery(null) }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const text = query ?? value
  const results = useMemo(() => searchVerbs(text === value ? '' : text, !!informing), [text, value, informing])
  const resolved = resolveVerb(text)

  const pick = (def: VerbDef) => {
    onSelect({ verb: def.verb, longhandOp: def.longhandOp, attribute: def.attribute })
    setOpen(false)
    setQuery(null)
  }
  const pickCustom = () => {
    onSelect({ verb: text.trim(), longhandOp: 'changes', attribute: '' })
    setOpen(false)
    setQuery(null)
  }

  // Group results by category for the dropdown
  const grouped = useMemo(() => {
    const g = new Map<number, VerbDef[]>()
    for (const v of results) {
      if (!g.has(v.category)) g.set(v.category, [])
      g.get(v.category)!.push(v)
    }
    return g
  }, [results])

  const current = resolveVerb(value)

  return (
    <div ref={wrapRef} className={`relative ${className ?? ''}`}>
      <div className="flex items-center">
        <input
          value={text}
          placeholder="verb — type to search"
          onFocus={() => setOpen(true)}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onKeyDown={e => {
            if (e.key === 'Enter' && results.length > 0 && query !== null) { e.preventDefault(); pick(results[0]) }
            if (e.key === 'Escape') { setOpen(false); setQuery(null) }
          }}
          className={`text-xs border rounded px-1.5 py-1 w-full font-mono focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white ${
            current.kind === 'trap' ? 'border-red-300' : current.kind === 'unknown' && value ? 'border-amber-300' : 'border-gray-300'
          }`}
        />
        <button type="button" tabIndex={-1} onClick={() => setOpen(o => !o)}
          className="absolute right-1 text-gray-300 hover:text-gray-500"><ChevronDown size={12} /></button>
      </div>

      {open && (
        <div ref={listRef}
          className="absolute z-40 mt-1 left-0 w-[26rem] max-w-[80vw] max-h-72 overflow-y-auto bg-white border border-gray-200 rounded shadow-lg">
          {/* Trap warning for the typed text */}
          {resolved.kind === 'trap' && (
            <div className="px-3 py-2 bg-red-50 border-b border-red-100">
              <p className="text-[11px] text-red-700 flex gap-1.5">
                <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                <span><b>&ldquo;{text.trim()}&rdquo; is not a modification.</b> {resolved.trap.hint}</span>
              </p>
              {resolved.trap.suggest.length > 0 && (
                <div className="flex gap-1.5 mt-1.5 ml-4">
                  {resolved.trap.suggest.map(sg => {
                    const def = VERBS.find(v => v.verb === sg)!
                    return (
                      <button key={sg} onClick={() => pick(def)}
                        className="text-[11px] px-2 py-0.5 rounded border border-red-200 text-red-700 hover:bg-red-100">
                        {sg}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
          {/* Synonym redirect note */}
          {resolved.kind === 'synonym' && (
            <div className="px-3 py-1.5 bg-blue-50 border-b border-blue-100 text-[11px] text-blue-700">
              &ldquo;{text.trim()}&rdquo; → canonical verb <b>{resolved.def.verb}</b> ({resolved.def.longhandOp} {resolved.def.attribute})
            </div>
          )}

          {[...grouped.entries()].map(([catId, defs]) => (
            <div key={catId}>
              <div className="px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400 sticky top-0 bg-white">
                {VERB_CATEGORIES.find(c => c.id === catId)?.name}
              </div>
              {defs.map(def => (
                <button key={def.verb} onClick={() => pick(def)}
                  title={`${def.example}${def.antiVerb ? ` · anti-function: ${def.antiVerb}` : ''}`}
                  className={`w-full text-left px-3 py-1 hover:bg-blue-50 flex items-baseline gap-2 ${def.verb === value ? 'bg-blue-50/60' : ''}`}>
                  <span className="text-xs font-mono font-medium text-gray-800 flex-shrink-0">{def.verb}</span>
                  <span className="text-[11px] text-gray-500 truncate">{def.definition}</span>
                  <span className="ml-auto text-[10px] text-gray-400 flex-shrink-0">{def.longhandOp} {def.attribute}</span>
                </button>
              ))}
            </div>
          ))}

          {results.length === 0 && resolved.kind !== 'trap' && (
            <p className="px-3 py-2 text-[11px] text-gray-400">No dictionary match.</p>
          )}

          {/* Custom escape hatch */}
          {text.trim() && resolved.kind === 'unknown' && (
            <button onClick={pickCustom}
              className="w-full text-left px-3 py-1.5 border-t border-gray-100 text-[11px] text-amber-700 hover:bg-amber-50">
              Use custom verb &ldquo;{text.trim()}&rdquo; (you&apos;ll fill the longhand attribute yourself)
            </button>
          )}
        </div>
      )}
    </div>
  )
}
