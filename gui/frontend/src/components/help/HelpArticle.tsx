import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BookOpen, Check, ChevronDown, Copy, FlaskConical, Info, Lightbulb } from 'lucide-react'
import Latex from '../shared/Latex'
import GlossaryText from './GlossaryText'
import type {
  BibliographyEntry, GlossaryEntry, HelpBlock, HelpCitationRef, HelpSection, HelpTopic,
} from './types'

const DEPTH_LABELS: Record<HelpSection['depth'], string> = {
  practice: 'How to use it', interpretation: 'Interpretation', advanced: 'Advanced', references: 'Reference',
}

function citationsInBlock(block: HelpBlock): HelpCitationRef[] {
  return 'citations' in block ? block.citations ?? [] : []
}

function topicCitations(topic: HelpTopic): string[] {
  const ids: string[] = []
  for (const section of topic.sections) {
    for (const block of section.blocks) {
      for (const citation of citationsInBlock(block)) if (!ids.includes(citation.id)) ids.push(citation.id)
    }
  }
  return ids
}

function topicCitationLocators(topic: HelpTopic): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const section of topic.sections) for (const block of section.blocks) {
    for (const citation of citationsInBlock(block)) {
      if (!citation.locator) continue
      const values = result.get(citation.id) ?? []
      if (!values.includes(citation.locator)) values.push(citation.locator)
      result.set(citation.id, values)
    }
  }
  return result
}

function CitationChips({ citations, order }: { citations?: HelpCitationRef[]; order: string[] }) {
  if (!citations?.length) return null
  return <span className="ml-1 inline-flex flex-wrap gap-0.5 align-super">
    {citations.map((citation, index) => {
      const number = order.indexOf(citation.id) + 1
      return <a key={`${citation.id}-${index}`} href={`#help-reference-${citation.id}`}
        title={citation.locator ? `Reference ${number}: ${citation.locator}` : `Reference ${number}`}
        className="rounded bg-blue-50 px-1 text-[9px] font-semibold text-blue-700 hover:bg-blue-100">
        [{number || '?'}]
      </a>
    })}
  </span>
}

function FormattedText({ text, glossary }: { text: string; glossary: GlossaryEntry[] }) {
  const chunks = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g).filter(Boolean)
  return <>{chunks.map((chunk, index) => {
    if (chunk.startsWith('**') && chunk.endsWith('**')) {
      return <strong key={index} className="font-semibold text-slate-800"><GlossaryText text={chunk.slice(2, -2)} glossary={glossary} /></strong>
    }
    if (chunk.startsWith('`') && chunk.endsWith('`')) {
      return <code key={index} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.92em] text-slate-800">{chunk.slice(1, -1)}</code>
    }
    if (chunk.startsWith('*') && chunk.endsWith('*')) {
      return <em key={index}><GlossaryText text={chunk.slice(1, -1)} glossary={glossary} /></em>
    }
    return <GlossaryText key={index} text={chunk} glossary={glossary} />
  })}</>
}

function HelpBlockView({ block, glossary, citationOrder }: {
  block: HelpBlock; glossary: GlossaryEntry[]; citationOrder: string[]
}) {
  if (block.type === 'paragraph') return (
    <p className="text-sm leading-6 text-slate-600">
      <FormattedText text={block.text} glossary={glossary} />
      <CitationChips citations={block.citations} order={citationOrder} />
    </p>
  )
  if (block.type === 'list') {
    const Tag = block.ordered ? 'ol' : 'ul'
    return <div><Tag className={`${block.ordered ? 'list-decimal' : 'list-disc'} ml-5 space-y-1.5 text-sm leading-6 text-slate-600`}>
      {block.items.map((item, index) => <li key={index}><FormattedText text={item} glossary={glossary} /></li>)}
    </Tag><CitationChips citations={block.citations} order={citationOrder} /></div>
  }
  if (block.type === 'callout') {
    const style = {
      info: ['border-blue-200 bg-blue-50/70 text-blue-950', Info],
      tip: ['border-emerald-200 bg-emerald-50/70 text-emerald-950', Lightbulb],
      caution: ['border-amber-200 bg-amber-50/80 text-amber-950', AlertTriangle],
      important: ['border-violet-200 bg-violet-50/70 text-violet-950', BookOpen],
    }[block.tone] as [string, typeof Info]
    const Icon = style[1]
    return <div className={`rounded-lg border px-3 py-2.5 ${style[0]}`}>
      <div className="flex gap-2"><Icon size={15} className="mt-0.5 flex-shrink-0" /><div>
        {block.title && <p className="text-xs font-semibold">{block.title}</p>}
        <p className="text-xs leading-5"><FormattedText text={block.text} glossary={glossary} />
          <CitationChips citations={block.citations} order={citationOrder} /></p>
      </div></div>
    </div>
  }
  if (block.type === 'equation') return <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50/70">
    <div className="flex items-center justify-between border-b border-slate-200 px-3 py-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{block.label ?? 'Equation'}</p>
      <CitationChips citations={block.citations} order={citationOrder} />
    </div>
    <div className="overflow-x-auto px-4 py-4 text-center text-slate-900"><Latex block>{block.latex}</Latex></div>
    {(block.explanation || block.symbols?.length) && <div className="border-t border-slate-200 bg-white px-3 py-2.5">
      {block.explanation && <p className="text-xs leading-5 text-slate-600"><FormattedText text={block.explanation} glossary={glossary} /></p>}
      {!!block.symbols?.length && <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {block.symbols.map(symbol => <div key={symbol.symbol} className="flex gap-2 text-[11px]">
          <dt className="min-w-12 font-mono font-semibold text-slate-800">{symbol.symbol}</dt>
          <dd className="text-slate-600"><FormattedText text={symbol.meaning} glossary={glossary} />{symbol.unit ? ` (${symbol.unit})` : ''}</dd>
        </div>)}
      </dl>}
    </div>}
  </div>
  if (block.type === 'example') return <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
    <div className="flex items-center gap-2"><FlaskConical size={15} className="text-emerald-700" />
      <h4 className="text-xs font-semibold text-emerald-950">{block.title}</h4></div>
    <p className="mt-2 text-xs leading-5 text-slate-600"><FormattedText text={block.scenario} glossary={glossary} /></p>
    <ol className="mt-2 ml-5 list-decimal space-y-1 text-xs leading-5 text-slate-600">
      {block.steps.map((step, index) => <li key={index}><FormattedText text={step} glossary={glossary} /></li>)}
    </ol>
    <p className="mt-2 rounded bg-white/80 px-2 py-1.5 text-xs font-medium text-slate-800"><span className="text-emerald-700">Result:</span>{' '}<FormattedText text={block.result} glossary={glossary} /></p>
    {block.caution && <p className="mt-2 text-[11px] leading-4 text-amber-800"><strong>Caution:</strong>{' '}<FormattedText text={block.caution} glossary={glossary} /></p>}
  </div>
  if (block.type === 'code') return <HelpCodeBlockView block={block} citationOrder={citationOrder} />
  return <div className="overflow-x-auto rounded-lg border border-slate-200">
    <table className="w-full min-w-max text-left text-xs">
      {block.caption && <caption className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-medium text-slate-700">{block.caption}</caption>}
      <thead className="bg-slate-50 text-slate-600"><tr>
      {block.columns.map(column => <th key={column} className="border-b border-slate-200 px-3 py-2 font-semibold">{column}</th>)}
    </tr></thead><tbody>{block.rows.map((row, index) => <tr key={index} className="border-b border-slate-100 last:border-0">
      {row.map((cell, cellIndex) => <td key={cellIndex} className="px-3 py-2 text-slate-600"><FormattedText text={cell} glossary={glossary} /></td>)}
    </tr>)}</tbody></table>
  </div>
}

function HelpCodeBlockView({ block, citationOrder }: {
  block: Extract<HelpBlock, { type: 'code' }>; citationOrder: string[]
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(block.code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }
  return <div className="overflow-hidden rounded-lg border border-slate-700 bg-slate-950 text-slate-100">
    <div className="flex items-center justify-between gap-3 border-b border-slate-700 px-3 py-1.5">
      <div className="min-w-0">
        {block.caption && <span className="block truncate text-[10px] font-medium text-slate-300">{block.caption}</span>}
        {block.language && <span className="text-[9px] uppercase tracking-wide text-slate-500">{block.language}</span>}
      </div>
      <div className="flex items-center gap-2">
        <CitationChips citations={block.citations} order={citationOrder} />
        <button type="button" onClick={() => void copy()}
          className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-800 hover:text-white"
          aria-label="Copy code">
          {copied ? <Check size={12} /> : <Copy size={12} />}{copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
    <pre className="overflow-x-auto p-3 text-[11px] leading-5"><code>{block.code}</code></pre>
  </div>
}

function ArticleSection({ section, glossary, citationOrder, reveal }: {
  section: HelpSection; glossary: GlossaryEntry[]; citationOrder: string[]; reveal: boolean
}) {
  const [open, setOpen] = useState(Boolean(section.defaultOpen))
  useEffect(() => { if (reveal) setOpen(true) }, [reveal])
  return <section id={`help-section-${section.id}`} className="scroll-mt-24 rounded-xl border border-slate-200 bg-white">
    <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open}
      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 rounded-xl">
      <div><p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">{DEPTH_LABELS[section.depth]}</p>
        <h3 className="mt-0.5 text-sm font-semibold text-slate-800">{section.title}</h3></div>
      <ChevronDown size={16} className={`flex-shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div className="space-y-3 border-t border-slate-100 px-4 py-4">
      {section.blocks.map((block, index) => <HelpBlockView key={index} block={block} glossary={glossary} citationOrder={citationOrder} />)}
    </div>}
  </section>
}

export default function HelpArticle({ topic, glossary, bibliography, revealSectionId }: {
  topic: HelpTopic
  glossary: GlossaryEntry[]
  bibliography: BibliographyEntry[]
  revealSectionId?: string
}) {
  const citationOrder = useMemo(() => topicCitations(topic), [topic])
  const citationLocators = useMemo(() => topicCitationLocators(topic), [topic])
  const bibliographyById = useMemo(() => new Map(bibliography.map(entry => [entry.id, entry])), [bibliography])
  const basics = [
    ['When to use it', topic.basics.useWhen], ['Inputs', topic.basics.inputs],
    ['Outputs', topic.basics.outputs], ['Key assumptions', topic.basics.assumptions],
  ] as const
  return <article className="mx-auto w-full max-w-4xl pb-16">
    <header className="border-b border-slate-200 pb-5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-600">Start here</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">{topic.title}</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600"><FormattedText text={topic.summary} glossary={glossary} /></p>
      {topic.reviewed && <p className="mt-2 text-[10px] text-slate-400">Reviewed for Perdura {__APP_VERSION__} · {topic.reviewed}</p>}
    </header>

    <section className="py-5">
      <p className="text-sm leading-6 text-slate-700"><FormattedText text={topic.basics.purpose} glossary={glossary} /></p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {basics.filter(([, items]) => items?.length).map(([label, items]) => <div key={label} className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
          <h2 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</h2>
          <ul className="mt-1.5 space-y-1 text-xs leading-5 text-slate-600">
            {items?.map((item, index) => <li key={index} className="flex gap-1.5"><span className="text-blue-400">•</span><span><FormattedText text={item} glossary={glossary} /></span></li>)}
          </ul>
        </div>)}
      </div>
    </section>

    <div className="space-y-3">
      {topic.sections.map(section => <ArticleSection key={`${topic.id}:${section.id}`} section={section}
        glossary={glossary} citationOrder={citationOrder} reveal={section.id === revealSectionId} />)}
    </div>

    {!!citationOrder.length && <section className="mt-7 border-t border-slate-200 pt-5">
      <h2 className="text-sm font-semibold text-slate-800">References</h2>
      <ol className="mt-3 space-y-3">
        {citationOrder.map((id, index) => {
          const entry = bibliographyById.get(id)
          if (!entry) return <li key={id} id={`help-reference-${id}`} className="text-xs text-red-700">[{index + 1}] Missing bibliography entry: {id}</li>
          return <li key={id} id={`help-reference-${id}`} className="scroll-mt-24 text-xs leading-5 text-slate-600">
            <span className="mr-1 font-semibold text-slate-800">[{index + 1}]</span>
            {entry.author}. {entry.title}{entry.edition ? `, ${entry.edition}` : ''}{entry.year ? ` (${entry.year})` : ''}.
            {entry.url && entry.publicAccess && <> <a href={entry.url} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline decoration-blue-300 hover:text-blue-900">Open public source</a>.</>}
            {entry.note && <span className="ml-1 text-slate-500">{entry.note}</span>}
            {!!citationLocators.get(id)?.length && <span className="ml-1 text-slate-500">Locator: {citationLocators.get(id)?.join('; ')}.</span>}
          </li>
        })}
      </ol>
    </section>}
  </article>
}
