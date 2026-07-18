import { useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { GlossaryEntry } from './types'

interface Segment { text: string; entry?: GlossaryEntry }

function isWord(character: string | undefined): boolean {
  return Boolean(character && /[\p{L}\p{N}]/u.test(character))
}

/**
 * Aliases improve search, but not every alias is safe for automatic prose
 * linking. In particular, CV and Greek parameter symbols change meaning by
 * analysis (coefficient of variation vs cross-validation; Weibull vs Gamma β).
 * Canonical terms always link; aliases link only when they are a conventional
 * acronym or a descriptive multi-word phrase.
 */
function isSafeInlineAlias(alias: string): boolean {
  if (alias === 'CV') return false
  if (/^[A-Z][A-Z0-9-]{1,7}$/.test(alias)) return true
  return alias.length >= 6 && /[\s-]/.test(alias)
}

export function segmentGlossaryText(text: string, glossary: GlossaryEntry[]): Segment[] {
  const aliases = glossary.flatMap(entry => [
    entry.term,
    ...(entry.aliases ?? []).filter(isSafeInlineAlias),
  ]
    .filter(alias => alias.length >= 2)
    .map(alias => ({ alias, normalized: alias.toLocaleLowerCase(), entry })))
    .sort((a, b) => b.alias.length - a.alias.length)
  const lower = text.toLocaleLowerCase()
  const segments: Segment[] = []
  let cursor = 0
  while (cursor < text.length) {
    let best: { index: number; alias: string; entry: GlossaryEntry } | undefined
    for (const candidate of aliases) {
      let index = lower.indexOf(candidate.normalized, cursor)
      while (index >= 0) {
        const before = index > 0 ? text[index - 1] : undefined
        const after = text[index + candidate.alias.length]
        if (!isWord(before) && !isWord(after)) break
        index = lower.indexOf(candidate.normalized, index + 1)
      }
      if (index < 0) continue
      if (!best || index < best.index || (index === best.index && candidate.alias.length > best.alias.length)) {
        best = { index, alias: candidate.alias, entry: candidate.entry }
      }
    }
    if (!best) {
      segments.push({ text: text.slice(cursor) })
      break
    }
    if (best.index > cursor) segments.push({ text: text.slice(cursor, best.index) })
    segments.push({ text: text.slice(best.index, best.index + best.alias.length), entry: best.entry })
    cursor = best.index + best.alias.length
  }
  return segments
}

function GlossaryTerm({ text, entry }: { text: string; entry: GlossaryEntry }) {
  const id = useId()
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [locked, setLocked] = useState(false)
  const rect = open ? ref.current?.getBoundingClientRect() : undefined
  const left = rect ? Math.min(window.innerWidth - 156, Math.max(156, rect.left + rect.width / 2)) : 0
  const top = rect ? Math.min(window.innerHeight - 150, rect.bottom + 7) : 0
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => { if (!locked) setOpen(false) }}
        onFocus={() => setOpen(true)}
        onBlur={() => { setLocked(false); setOpen(false) }}
        onClick={() => { setLocked(value => !value); setOpen(true) }}
        className="inline border-b border-dotted border-blue-400 text-inherit hover:text-blue-700 focus:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300/60 rounded-sm cursor-help"
      >
        {text}
      </button>
      {open && rect && createPortal(
        <div
          id={id}
          role="tooltip"
          style={{ left, top, transform: 'translateX(-50%)' }}
          className="fixed z-[90] w-[min(19rem,calc(100vw-1.5rem))] rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left shadow-xl pointer-events-none"
        >
          <p className="text-xs font-semibold text-slate-900">{entry.term}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-600">{entry.short}</p>
          {entry.detail && <p className="mt-1.5 border-t border-slate-100 pt-1.5 text-[10px] leading-relaxed text-slate-500">{entry.detail}</p>}
          <p className="mt-1 text-[9px] text-slate-400">Click to keep this definition open.</p>
        </div>,
        document.body,
      )}
    </>
  )
}

export default function GlossaryText({ text, glossary }: { text: string; glossary: GlossaryEntry[] }) {
  const segments = useMemo(() => segmentGlossaryText(text, glossary), [text, glossary])
  return <>{segments.map((segment, index) => segment.entry
    ? <GlossaryTerm key={`${index}-${segment.entry.id}`} text={segment.text} entry={segment.entry} />
    : <span key={index}>{segment.text}</span>)}</>
}
