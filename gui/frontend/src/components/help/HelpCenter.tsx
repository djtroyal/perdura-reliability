import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, BookOpen, ChevronRight, Keyboard, Library, Menu, Search, X,
} from 'lucide-react'
import { useFocusTrap } from '../shared/useDialog'
import { useShortcutPalette } from '../shared/KeyboardShortcuts'
import {
  HELP_BIBLIOGRAPHY, HELP_GLOSSARY, HELP_MODULES, HELP_TOPIC_BY_ID,
  HELP_TOPICS, HELP_TOPICS_BY_MODULE,
} from './catalog'
import HelpArticle from './HelpArticle'
import { HELP_MODULE_BY_ID } from './modules'
import { searchHelp } from './search'
import type { GlossaryEntry, HelpSearchResult, HelpTopic } from './types'

const inSet = (value: string, choices: string[]) => choices.includes(value)

function topicGroup(topic: HelpTopic): { label: string; rank: number } {
  const leaf = topic.id.slice(topic.moduleId.length + 1)
  if (leaf === 'overview') return { label: 'Overview', rank: 0 }
  if (topic.moduleId === 'lifeData') {
    if (/^(weibull|exponential|normal|lognormal|gamma|loglogistic|beta|gumbel)-[123]p$/.test(leaf)) return { label: 'Distributions', rank: 20 }
    if (inSet(leaf, ['observation-individual', 'observation-frequency', 'observation-interval', 'kaplan-meier', 'nelson-aalen', 'turnbull'])) return { label: 'Observation & nonparametric methods', rank: 30 }
    if (inSet(leaf, ['weibull-mixture', 'competing-risks', 'dszi', 'defective-subpopulation', 'zero-inflated'])) return { label: 'Special models', rank: 40 }
    if (inSet(leaf, ['parametric', 'nonparametric', 'special', 'weibayes', 'cfm', 'stress-strength'])) return { label: 'Analysis modes', rank: 10 }
    return { label: 'Fit, compare & publish', rank: 50 }
  }
  if (topic.moduleId === 'alt') {
    if (leaf.startsWith('life-stress-')) return { label: 'Life–stress models', rank: 10 }
    if (leaf.startsWith('acceleration-')) return { label: 'Acceleration factors', rank: 20 }
    if (leaf.startsWith('rdt-')) return { label: 'Reliability demonstration', rank: 40 }
    if (inSet(leaf, ['expected-failure-times', 'difference-detection', 'test-simulation', 'exponential-planner', 'test-duration', 'zero-failure-sample-size', 'sprt', 'one-proportion', 'two-proportion', 'goodness-of-fit'])) return { label: 'Test planning & statistics', rank: 50 }
    if (leaf.startsWith('degradation-') || inSet(leaf, ['ess', 'hass', 'burn-in'])) return { label: 'Degradation & screening', rank: 60 }
    return { label: 'Accelerated-test workflows', rank: 30 }
  }
  if (topic.moduleId === 'prediction') {
    if (inSet(leaf, ['mil-hdbk-217f', 'telcordia-sr332', '217plus', 'fides', 'nswc-98-le1', 'eprd-2014', 'nprd-2023'])) return { label: 'Prediction standards', rank: 10 }
    return { label: 'Workflow & engineering controls', rank: 20 }
  }
  if (topic.moduleId === 'hypothesis') {
    if (inSet(leaf, ['one_sample_t', 'two_sample_t', 'paired_t'])) return { label: 'Parametric tests', rank: 20 }
    if (inSet(leaf, ['mann_whitney', 'wilcoxon_signed_rank', 'kruskal_wallis', 'friedman'])) return { label: 'Nonparametric tests', rank: 30 }
    if (inSet(leaf, ['one_way_anova', 'factorial_anova', 'rm_anova', 'mixed_anova'])) return { label: 'ANOVA', rank: 40 }
    if (inSet(leaf, ['chi_square_gof', 'chi_square_independence', 'binomial_test'])) return { label: 'Counts & proportions', rank: 50 }
    return { label: 'Choose a test', rank: 10 }
  }
  if (topic.moduleId === 'dataAnalysis') {
    if (inSet(leaf, ['summary', 'histogram', 'boxplot', 'violin', 'raincloud', 'scatter', 'correlation', 'qq', 'ecdf', 'runchart', 'frequency', 'contingency'])) return { label: 'Descriptive statistics', rank: 20 }
    if (inSet(leaf, ['linear', 'logistic', 'ridge', 'lasso', 'elastic_net', 'polynomial', 'decision_tree', 'chaid', 'random_forest', 'gradient_boosting', 'hist_gradient_boosting', 'adaboost', 'svm', 'knn', 'mlp'])) return { label: 'Candidate models', rank: 40 }
    if (inSet(leaf, ['descriptive', 'modeling'])) return { label: 'Analysis areas', rank: 10 }
    return { label: 'Regression & ML workflow', rank: 30 }
  }
  if (topic.moduleId === 'sixSigma') {
    if (leaf === 'capability') return { label: 'Process capability', rank: 10 }
    if (leaf === 'msa' || leaf.startsWith('msa_')) return { label: 'Measurement systems', rank: 20 }
    if (leaf === 'spc' || leaf.startsWith('spc_')) return { label: 'Control charts', rank: 30 }
    return { label: 'Design of experiments', rank: 40 }
  }
  if (topic.moduleId === 'warranty' && leaf !== 'workflow') return { label: 'Forecast distributions', rank: 20 }
  return { label: 'Methods & workflows', rank: 10 }
}

function initialTopic(moduleId: string, contextualTopicId?: string | null): HelpTopic {
  const contextual = contextualTopicId ? HELP_TOPIC_BY_ID.get(contextualTopicId) : undefined
  if (contextual?.moduleId === moduleId) return contextual
  const module = HELP_MODULE_BY_ID.get(moduleId) ?? HELP_MODULES[0]
  return HELP_TOPIC_BY_ID.get(module.overviewTopicId)
    ?? HELP_TOPICS_BY_MODULE.get(module.id)?.[0]
    ?? HELP_TOPICS[0]
}

function SearchResults({ results, onSelect }: {
  results: HelpSearchResult[]
  onSelect: (result: HelpSearchResult) => void
}) {
  if (!results.length) return <div className="mx-auto max-w-xl py-20 text-center">
    <p className="sr-only" role="status" aria-live="polite">No matching Help topics</p>
    <Search size={28} className="mx-auto text-slate-300" />
    <h2 className="mt-3 text-sm font-semibold text-slate-700">No matching Help topics</h2>
    <p className="mt-1 text-xs text-slate-500">Try a method name, acronym, model, input, output, or engineering concept.</p>
  </div>
  return <div className="mx-auto max-w-3xl pb-12">
    <p className="sr-only" role="status" aria-live="polite">{results.length} Help search results</p>
    <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{results.length} best matches</p>
    <div className="space-y-2">{results.map(result => <button key={result.id} type="button"
      onClick={() => onSelect(result)}
      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-left hover:border-blue-300 hover:bg-blue-50/30 focus:outline-none focus:ring-2 focus:ring-blue-300">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-sm font-semibold text-slate-800">{result.title}</p>
          <p className="mt-0.5 text-[10px] font-medium text-blue-600">{result.breadcrumb}</p></div>
        <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${result.kind === 'glossary' ? 'bg-violet-50 text-violet-700' : 'bg-slate-100 text-slate-500'}`}>{result.kind}</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-600">{result.snippet}</p>
    </button>)}</div>
  </div>
}

function GlossaryIndex({ onSelect }: { onSelect: (entry: GlossaryEntry) => void }) {
  const entries = [...HELP_GLOSSARY].sort((a, b) => a.term.localeCompare(b.term))
  return <section className="mx-auto max-w-4xl pb-16">
    <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-600">Reference</p>
    <h1 className="mt-1 text-2xl font-semibold text-slate-950">Glossary A–Z</h1>
    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Browse concise definitions used throughout Perdura. The same definitions appear in context when you hover or focus a dotted term in an article.</p>
    <div className="mt-6 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {entries.map(entry => <button key={entry.id} type="button" onClick={() => onSelect(entry)}
        className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left hover:border-violet-300 hover:bg-violet-50/30 focus:outline-none focus:ring-2 focus:ring-violet-300">
        <span className="text-xs font-semibold text-slate-800">{entry.term}</span>
        <span className="mt-1 line-clamp-2 block text-[11px] leading-4 text-slate-500">{entry.short}</span>
      </button>)}
    </div>
  </section>
}

function GlossaryDetail({ entry, onTopic }: { entry: GlossaryEntry; onTopic: (id: string) => void }) {
  const refs = (entry.citations ?? []).map(citation => HELP_BIBLIOGRAPHY.find(item => item.id === citation.id)).filter(Boolean)
  return <article className="mx-auto max-w-3xl pb-16">
    <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-600">Glossary</p>
    <h1 className="mt-1 text-2xl font-semibold text-slate-950">{entry.term}</h1>
    {!!entry.aliases?.length && <p className="mt-1 text-xs text-slate-400">Also: {entry.aliases.join(', ')}</p>}
    <p className="mt-5 text-base leading-7 text-slate-700">{entry.short}</p>
    {entry.detail && <p className="mt-4 text-sm leading-6 text-slate-600">{entry.detail}</p>}
    {!!entry.relatedTopics?.length && <section className="mt-7 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <h2 className="text-xs font-semibold text-slate-700">Related Help topics</h2>
      <div className="mt-2 flex flex-wrap gap-2">{entry.relatedTopics.map(id => {
        const topic = HELP_TOPIC_BY_ID.get(id)
        return topic && <button key={id} type="button" onClick={() => onTopic(id)} className="rounded-full border border-blue-200 bg-white px-2.5 py-1 text-xs text-blue-700 hover:bg-blue-50">{topic.title}</button>
      })}</div>
    </section>}
    {!!refs.length && <section className="mt-7 border-t border-slate-200 pt-5"><h2 className="text-sm font-semibold text-slate-800">References</h2>
      <ul className="mt-2 space-y-2">{refs.map(entry => entry && <li key={entry.id} className="text-xs leading-5 text-slate-600">{entry.author}. {entry.title}{entry.year ? ` (${entry.year})` : ''}.
        {entry.url && entry.publicAccess && <> <a href={entry.url} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">Open public source</a>.</>}</li>)}</ul>
    </section>}
  </article>
}

export default function HelpCenter({ open, onClose, activeModule, contextualTopicId }: {
  open: boolean
  onClose: () => void
  activeModule: string
  contextualTopicId?: string | null
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const { openPalette } = useShortcutPalette()
  useFocusTrap(panelRef, open, onClose)
  const starting = initialTopic(activeModule, contextualTopicId)
  const [selectedModule, setSelectedModule] = useState(starting.moduleId)
  const [topicId, setTopicId] = useState(starting.id)
  const [glossaryId, setGlossaryId] = useState<string | null>(null)
  const [revealSectionId, setRevealSectionId] = useState<string | undefined>()
  const [query, setQuery] = useState('')
  const [mobileNav, setMobileNav] = useState(false)

  useEffect(() => {
    if (!open) return
    const next = initialTopic(activeModule, contextualTopicId)
    setSelectedModule(next.moduleId)
    setTopicId(next.id)
    setGlossaryId(null)
    setRevealSectionId(undefined)
    setQuery('')
    setMobileNav(false)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [open, activeModule, contextualTopicId])

  useEffect(() => {
    if (!open) return
    const focusSearch = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return
      event.preventDefault()
      searchRef.current?.focus()
      searchRef.current?.select()
    }
    document.addEventListener('keydown', focusSearch)
    return () => document.removeEventListener('keydown', focusSearch)
  }, [open])

  const selectedTopic = HELP_TOPIC_BY_ID.get(topicId) ?? starting
  const glossaryView = glossaryId !== null
  const selectedGlossary = glossaryId ? HELP_GLOSSARY.find(entry => entry.id === glossaryId) : undefined
  const moduleTopics = HELP_TOPICS_BY_MODULE.get(selectedModule) ?? []
  const topicGroups = useMemo(() => {
    const groups = new Map<string, { label: string; rank: number; topics: HelpTopic[] }>()
    for (const topic of moduleTopics) {
      const metadata = topicGroup(topic)
      const key = `${metadata.rank}:${metadata.label}`
      const group = groups.get(key) ?? { ...metadata, topics: [] }
      group.topics.push(topic)
      groups.set(key, group)
    }
    return [...groups.values()].sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label))
  }, [moduleTopics])
  const results = useMemo(
    () => searchHelp(query, HELP_TOPICS, HELP_GLOSSARY, HELP_MODULES, activeModule),
    [query, activeModule],
  )

  const chooseTopic = (id: string, sectionId?: string) => {
    const topic = HELP_TOPIC_BY_ID.get(id)
    if (!topic) return
    setSelectedModule(topic.moduleId)
    setTopicId(id)
    setGlossaryId(null)
    setRevealSectionId(sectionId)
    setQuery('')
    setMobileNav(false)
    requestAnimationFrame(() => {
      if (sectionId) document.getElementById(`help-section-${sectionId}`)?.scrollIntoView({ block: 'start' })
      else panelRef.current?.querySelector('main')?.scrollTo({ top: 0 })
    })
  }
  const chooseSearch = (result: HelpSearchResult) => {
    if (result.kind === 'glossary') {
      setGlossaryId(result.id.replace('glossary:', ''))
      setQuery('')
      setRevealSectionId(undefined)
      setMobileNav(false)
      requestAnimationFrame(() => panelRef.current?.querySelector('main')?.scrollTo({ top: 0 }))
      return
    }
    if (result.topicId) chooseTopic(result.topicId, result.sectionId)
  }
  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => {
      const activeTopic = [...(panelRef.current?.querySelectorAll<HTMLElement>('[data-help-topic]') ?? [])]
        .find(element => element.dataset.helpTopic === topicId)
      activeTopic?.scrollIntoView({ block: 'nearest' })
    })
  }, [open, topicId, selectedModule, mobileNav])
  if (!open) return null

  return <div className="fixed inset-0 z-[70] flex items-center justify-center p-0 sm:p-3 lg:p-6" role="dialog" aria-modal="true" aria-labelledby="help-center-title">
    <div className="absolute inset-0 bg-slate-950/45 backdrop-blur-[1px]" onClick={onClose} />
    <div ref={panelRef} className="relative flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl sm:h-[min(94vh,980px)] sm:max-w-[1440px] sm:rounded-2xl sm:border sm:border-slate-200">
      <header className="z-20 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-3 py-2.5 sm:px-5">
        <button type="button" onClick={() => setMobileNav(value => !value)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden" aria-label="Toggle Help navigation"><Menu size={18} /></button>
        <div className="hidden min-w-48 sm:block"><p className="text-[9px] font-semibold uppercase tracking-wider text-blue-600">Perdura user manual</p>
          <h1 id="help-center-title" className="text-sm font-semibold text-slate-900">Help Center</h1></div>
        <div className="relative min-w-0 flex-1 sm:max-w-2xl">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input ref={searchRef} type="search" value={query} onChange={event => setQuery(event.target.value)}
            placeholder="Search methods, terms, equations, inputs…" aria-label="Search all Help"
            className="w-full rounded-lg border border-slate-300 bg-slate-50 py-2 pl-9 pr-8 text-sm text-slate-800 outline-none focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-200 md:pr-24" />
          {query && <button type="button" onClick={() => { setQuery(''); searchRef.current?.focus() }} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700"><X size={13} /></button>}
          {!query && <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-slate-200 bg-white px-1.5 py-0.5 font-sans text-[9px] text-slate-400 md:block">Ctrl/⌘ K</kbd>}
        </div>
        <span className="hidden rounded-full bg-blue-50 px-2 py-1 text-[10px] font-medium text-blue-700 xl:block">For this screen: {HELP_MODULE_BY_ID.get(activeModule)?.shortTitle ?? HELP_MODULE_BY_ID.get(activeModule)?.title ?? activeModule}</span>
        <button type="button" onClick={() => { onClose(); requestAnimationFrame(() => openPalette('shortcuts')) }}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
          title="Show the contextual keyboard shortcut reference (?)">
          <Keyboard size={14} /> <span className="hidden md:inline">Keyboard shortcuts</span>
        </button>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close Help"><X size={19} /></button>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <aside className={`${mobileNav ? 'flex' : 'hidden'} absolute inset-y-0 left-0 z-20 w-[min(21rem,88vw)] flex-col border-r border-slate-200 bg-white shadow-xl lg:static lg:flex lg:w-72 lg:shadow-none`} aria-label="Help topics">
          <div className="border-b border-slate-200 p-2.5"><label htmlFor="help-module-select" className="block px-2 pb-1.5 text-[9px] font-semibold uppercase tracking-wider text-slate-400">Modules</label>
            <select id="help-module-select" value={selectedModule} onChange={event => {
              const id = event.target.value
              setSelectedModule(id)
              const module = HELP_MODULE_BY_ID.get(id)
              if (module) chooseTopic(module.overviewTopicId)
            }} className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-medium text-slate-700">
              {HELP_MODULES.map(module => <option key={module.id} value={module.id}>{module.title}</option>)}
            </select>
          </div>
          <nav className="min-h-0 flex-1 overflow-y-auto p-2.5">
            <p className="px-2 pb-1.5 text-[9px] font-semibold uppercase tracking-wider text-slate-400">Topics</p>
            <div>{topicGroups.map(group => <section key={`${group.rank}:${group.label}`} className="mt-3 first:mt-0">
              <p className="sticky top-0 z-[1] bg-white/95 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-slate-400 backdrop-blur-sm">{group.label}</p>
              <div className="space-y-0.5">{group.topics.map(topic => <button key={topic.id} type="button" data-help-topic={topic.id} onClick={() => chooseTopic(topic.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs ${topic.id === selectedTopic.id && !glossaryView ? 'bg-blue-50 font-semibold text-blue-800' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}>
                <span>{topic.title}</span>{topic.id === selectedTopic.id && !glossaryView && <ChevronRight size={13} />}
              </button>)}</div>
            </section>)}</div>
          </nav>
          <div className="border-t border-slate-200 p-2.5">
            <button type="button" onClick={() => { setGlossaryId(''); setQuery(''); setMobileNav(false) }}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium ${glossaryView ? 'bg-violet-50 text-violet-800' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}>
              <Library size={13} /> Glossary A–Z
            </button>
            <p className="mt-2 px-2 text-[10px] leading-4 text-slate-400">Scientific references identify the edition and, where provided, the applicable locator; public sources open in a new tab.</p>
          </div>
        </aside>

        {mobileNav && <button type="button" aria-label="Close Help navigation" onClick={() => setMobileNav(false)} className="absolute inset-0 z-10 bg-slate-950/20 lg:hidden" />}

        <main className="min-w-0 flex-1 overflow-y-auto bg-slate-50/60 px-4 py-5 sm:px-7 lg:px-10">
          {query ? <SearchResults results={results} onSelect={chooseSearch} />
            : glossaryView ? selectedGlossary
              ? <GlossaryDetail entry={selectedGlossary} onTopic={chooseTopic} />
              : <GlossaryIndex onSelect={entry => setGlossaryId(entry.id)} />
              : <><div className="mx-auto mb-4 flex max-w-4xl items-center gap-1.5 text-[10px] text-slate-400">
                <BookOpen size={11} /><span>{HELP_MODULE_BY_ID.get(selectedTopic.moduleId)?.title}</span><ChevronRight size={10} /><span className="text-slate-600">{selectedTopic.title}</span>
                {selectedTopic.id !== initialTopic(activeModule, contextualTopicId).id && <button type="button" onClick={() => chooseTopic(initialTopic(activeModule, contextualTopicId).id)} className="ml-auto hidden items-center gap-1 text-blue-600 hover:text-blue-800 sm:flex"><ArrowLeft size={11} /> Current screen</button>}
              </div><HelpArticle topic={selectedTopic} glossary={HELP_GLOSSARY} bibliography={HELP_BIBLIOGRAPHY} revealSectionId={revealSectionId} /></>}
        </main>

        {!query && !glossaryView && <aside className="hidden w-56 flex-shrink-0 overflow-y-auto border-l border-slate-200 bg-white px-4 py-5 xl:block" aria-label="On this page">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">On this page</p>
          <a href="#" onClick={event => { event.preventDefault(); panelRef.current?.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' }) }} className="mt-2 block text-xs font-medium text-slate-700 hover:text-blue-700">Start here</a>
          <div className="mt-2 space-y-1.5">{selectedTopic.sections.map(section => <a key={section.id} href={`#help-section-${section.id}`}
            onClick={() => setRevealSectionId(section.id)} className="block text-[11px] leading-4 text-slate-500 hover:text-blue-700">{section.title}</a>)}</div>
        </aside>}
      </div>
    </div>
  </div>
}
