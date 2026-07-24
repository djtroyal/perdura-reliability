import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Activity,
  Anchor,
  ArrowRightLeft,
  Bell,
  BookOpen,
  Box,
  Calculator,
  CheckCircle2,
  ChevronDown,
  CirclePlay,
  CircleStop,
  CircleHelp,
  Database,
  FileText,
  GitBranch,
  GitCompare,
  GitFork,
  Link2,
  Lock,
  LogIn,
  LogOut,
  Merge,
  Move,
  Plus,
  Repeat2,
  Route,
  Ruler,
  ScanLine,
  Search,
  Send,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Stethoscope,
  Tags,
  TrendingDown,
  TrendingUp,
  Trash2,
  Unlink,
  X,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import type {
  FMEAKind,
  FMEAVocabularyDomain,
  FMEAVocabularyProfile,
  FMEAVocabularyTerm,
} from '../../api/reliabilityProgram'
import {
  applyFunctionVerb,
  classifyFunctionStatement,
  closestVocabularyValue,
  composeFunctionDefinition,
  createProjectVocabularyTerm,
  FUNCTION_RELATIONSHIPS,
  normalizeVocabulary,
  splitFunctionDefinition,
  vocabularyConflicts,
  vocabularyTerms,
} from './fmeaVocabulary'


const inputClass =
  'w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-100'

const DOMAIN_LABELS: Record<FMEAVocabularyDomain, string> = {
  function_verb: 'Function verbs',
  failure_deviation: 'Failure deviations',
  effect_level: 'Effect levels',
  prevention_control: 'Prevention controls',
  detection_control: 'Detection controls',
  verification_method: 'Verification methods',
  operating_mode: 'Operating modes',
}

const FUNCTION_VERB_ICONS: Record<string, LucideIcon> = {
  'function_verb:divide': GitFork,
  'function_verb:separate': Unlink,
  'function_verb:distribute': GitFork,
  'function_verb:combine': Merge,
  'function_verb:mix': Merge,
  'function_verb:import': LogIn,
  'function_verb:export': LogOut,
  'function_verb:transfer': ArrowRightLeft,
  'function_verb:guide': Route,
  'function_verb:join': Link2,
  'function_verb:disconnect': Unlink,
  'function_verb:actuate': Zap,
  'function_verb:increase': TrendingUp,
  'function_verb:decrease': TrendingDown,
  'function_verb:regulate': SlidersHorizontal,
  'function_verb:condition': SlidersHorizontal,
  'function_verb:permit': CirclePlay,
  'function_verb:interrupt': CircleStop,
  'function_verb:convert': Repeat2,
  'function_verb:generate': Sparkles,
  'function_verb:store': Database,
  'function_verb:supply': Send,
  'function_verb:sense': ScanLine,
  'function_verb:measure': Ruler,
  'function_verb:detect': Search,
  'function_verb:monitor': Activity,
  'function_verb:compare': GitCompare,
  'function_verb:compute': Calculator,
  'function_verb:decide': GitBranch,
  'function_verb:command': Send,
  'function_verb:indicate': Bell,
  'function_verb:record': FileText,
  'function_verb:retrieve': Database,
  'function_verb:diagnose': Stethoscope,
  'function_verb:position': Move,
  'function_verb:support': Anchor,
  'function_verb:stabilize': Anchor,
  'function_verb:secure': Lock,
  'function_verb:contain': Box,
  'function_verb:isolate': Shield,
  'function_verb:protect': ShieldCheck,
}

export function VocabularyPicker({
  domain,
  profile,
  kind,
  selectedId,
  onSelect,
  title,
}: {
  domain: FMEAVocabularyDomain
  profile?: FMEAVocabularyProfile
  kind?: FMEAKind
  selectedId?: string
  onSelect: (term: FMEAVocabularyTerm) => void
  title?: string
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({
    left: 12, top: 12, width: 320, maxHeight: 480,
  })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const terms = useMemo(
    () => vocabularyTerms(profile, domain, kind),
    [domain, kind, profile],
  )
  const shown = terms.filter(term => {
    const needle = normalizeVocabulary(query)
    return !needle || [
      term.label, term.category, term.definition, term.selection_question,
      term.use_when, term.avoid_when, ...term.aliases, ...term.examples,
    ].some(value => normalizeVocabulary(value).includes(needle))
  })
  const categories = [...new Set(shown.map(term => term.category))]
  useEffect(() => {
    if (!open) return
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (!rect) return
      const margin = 12
      const gap = 6
      const width = Math.min(544, window.innerWidth - margin * 2)
      const maxHeight = Math.min(520, window.innerHeight - margin * 2)
      const left = Math.min(
        Math.max(margin, rect.right - width),
        window.innerWidth - width - margin,
      )
      const roomBelow = window.innerHeight - rect.bottom - margin
      const top = roomBelow >= Math.min(420, maxHeight)
        ? rect.bottom + gap
        : Math.max(margin, rect.top - maxHeight - gap)
      setPosition({ left, top, width, maxHeight })
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])
  return <div className="relative">
    <button ref={buttonRef} type="button"
      onClick={() => setOpen(value => !value)}
      aria-expanded={open}
      aria-haspopup="dialog"
      title={title ?? `Open ${DOMAIN_LABELS[domain]} dictionary`}
      aria-label={title ?? `Open ${DOMAIN_LABELS[domain]} dictionary`}
      className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded border border-slate-200 bg-white text-slate-500 hover:border-blue-300 hover:text-blue-700 [&::-webkit-details-marker]:hidden">
      <BookOpen size={13} />
    </button>
    {open && typeof document !== 'undefined' && createPortal(<>
      <div className="fixed inset-0 z-[139]"
        aria-hidden="true" onMouseDown={() => setOpen(false)} />
      <div role="dialog" aria-label={title ?? DOMAIN_LABELS[domain]}
        className="fixed z-[140] flex flex-col rounded-lg border border-slate-200 bg-white p-3 shadow-2xl"
        style={{
          left: position.left,
          top: position.top,
          width: position.width,
          maxHeight: position.maxHeight,
        }}>
        <div className="mb-2 flex shrink-0 items-start justify-between gap-2">
          <div>
            <div className="text-xs font-semibold text-slate-800">
              {title ?? DOMAIN_LABELS[domain]}
            </div>
            <p className="mt-0.5 text-[10px] leading-snug text-slate-500">
              Optional guidance. Choosing a term never prevents custom engineering language.
            </p>
          </div>
          <button type="button" onClick={() => setOpen(false)}
            aria-label="Close dictionary" className="text-slate-400 hover:text-slate-700">
            <X size={14} />
          </button>
        </div>
        <input value={query} onChange={event => setQuery(event.target.value)}
          placeholder="Search meaning, term, alias, or example…"
          className={`shrink-0 ${inputClass}`} />
        <div className="mt-2 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {categories.map(category => <section key={category}>
            <div className="sticky top-0 bg-white py-1 text-[9px] font-semibold uppercase tracking-wide text-slate-400">
              {category}
            </div>
            <div className="space-y-1">
              {shown.filter(term => term.category === category).map(term => {
                const VerbIcon = domain === 'function_verb'
                  ? FUNCTION_VERB_ICONS[term.id]
                  : undefined
                return <div key={term.id} className={`w-full rounded border p-2 text-left transition ${
                  selectedId === term.id
                    ? 'border-emerald-300 bg-emerald-50'
                    : 'border-slate-100 hover:border-blue-200 hover:bg-blue-50/40'
                }`}>
                  <button type="button" onClick={() => {
                    onSelect(term)
                    setOpen(false)
                  }} className="w-full text-left">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                        {VerbIcon && <span aria-hidden="true"
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-blue-50 text-blue-600">
                          <VerbIcon size={12} strokeWidth={1.8} />
                        </span>}
                        {term.label}
                      </span>
                      <span className="text-[9px] text-slate-400">
                        {term.built_in ? 'Perdura' : 'Project'}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[10px] leading-snug text-slate-600">
                      {term.definition}
                    </p>
                    <p className="mt-1 text-[9px] text-blue-700">
                      Ask: {term.selection_question}
                    </p>
                    {(term.aliases.length > 0 || term.examples.length > 0) &&
                      <div className="mt-1 text-[9px] text-slate-400">
                        {term.aliases.length > 0 &&
                          <>Aliases: {term.aliases.join(', ')}</>}
                        {term.aliases.length > 0 && term.examples.length > 0 && ' · '}
                        {term.examples.length > 0 &&
                          <>Example: {term.examples[0]}</>}
                      </div>}
                  </button>
                  <details className="mt-1 text-[9px] text-slate-500">
                    <summary className="cursor-pointer text-slate-400">
                      Selection boundary and source
                    </summary>
                    <div className="mt-1 space-y-0.5 border-l border-slate-200 pl-2">
                      <p><strong>Use when:</strong> {term.use_when}</p>
                      <p><strong>Avoid when:</strong> {term.avoid_when}</p>
                      <p>{term.source}</p>
                    </div>
                  </details>
                </div>
              })}
          </div>
          </section>)}
          {!shown.length && <p className="py-8 text-center text-xs text-slate-400">
            No vocabulary terms match this search.
          </p>}
        </div>
      </div>
    </>, document.body)}
  </div>
}

export function FunctionStatementField({
  value,
  canonicalVerbId,
  profile,
  kind,
  targetSuggestions,
  onChange,
}: {
  value: string
  canonicalVerbId?: string
  profile?: FMEAVocabularyProfile
  kind: FMEAKind
  targetSuggestions: string[]
  onChange: (value: string, canonicalVerbId?: string) => void
}) {
  const match = classifyFunctionStatement(value, profile)
  const statement = splitFunctionDefinition(value, profile)
  const terms = vocabularyTerms(profile, 'function_verb', kind)
  const [draftRelationship, setDraftRelationship] = useState(
    statement.relationship || 'to')
  useEffect(() => {
    if (statement.relationship) setDraftRelationship(statement.relationship)
  }, [statement.relationship])
  const verbCorrectionValue = (
    match.status === 'custom'
    || match.status === 'canonical'
  )
    ? closestVocabularyValue(
        statement.verb,
        terms.flatMap(term => [term.label, ...term.aliases]),
      )
    : undefined
  const verbCorrection = verbCorrectionValue
    ? terms.find(term => [term.label, ...term.aliases].some(candidate =>
        normalizeVocabulary(candidate)
          === normalizeVocabulary(verbCorrectionValue)))
    : undefined
  const targetCorrection = closestVocabularyValue(
    statement.target,
    targetSuggestions,
  )
  const targetDetailsRef = useRef<HTMLDetailsElement>(null)
  const choose = (selected: FMEAVocabularyTerm) =>
    onChange(applyFunctionVerb(value, selected, profile), selected.id)
  const replaceAlias = () => {
    if (match.term) choose(match.term)
  }
  const changeVerb = (verb: string) => {
    if (!verb.trim()) {
      onChange('', undefined)
      return
    }
    const next = composeFunctionDefinition(
      verb, statement.what, statement.target, draftRelationship)
    const nextMatch = classifyFunctionStatement(next, profile)
    onChange(
      next,
      nextMatch.status === 'canonical' || nextMatch.status === 'alias'
        ? nextMatch.term?.id : undefined,
    )
  }
  const changeWhat = (what: string) =>
    onChange(
      composeFunctionDefinition(
        statement.verb,
        what,
        statement.target,
        draftRelationship,
      ),
      canonicalVerbId,
    )
  const changeTarget = (target: string) =>
    onChange(
      composeFunctionDefinition(
        statement.verb,
        statement.what,
        target,
        draftRelationship,
      ),
      canonicalVerbId,
    )
  const changeRelationship = (relationship: string) => {
    setDraftRelationship(relationship)
    if (statement.target) {
      onChange(
        composeFunctionDefinition(
          statement.verb,
          statement.what,
          statement.target,
          relationship,
        ),
        canonicalVerbId,
      )
    }
  }
  return <div>
    <div className="text-[11px] font-medium text-slate-600">
      Function (Verb + what + optional target)
    </div>
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      <div className="flex min-w-44 flex-1 items-center rounded-full border border-blue-300 bg-blue-50 px-2 py-1 shadow-sm transition focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
        <span className="mr-1.5 rounded-full bg-blue-600 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white">
          Verb
        </span>
        <input value={statement.verb}
          onChange={event => changeVerb(event.target.value)}
          placeholder="Regulate"
          aria-label="Function verb"
          className="min-w-0 flex-1 bg-transparent text-xs font-medium text-blue-950 outline-none placeholder:text-blue-300" />
      </div>
      <VocabularyPicker domain="function_verb" profile={profile} kind={kind}
        selectedId={canonicalVerbId} onSelect={choose}
        title="Choose a function verb" />
      <span aria-hidden="true"
        className="px-0.5 text-sm font-medium text-slate-300">+</span>
      <div className={`flex min-w-60 flex-[2] items-center rounded-full border px-2 py-1 shadow-sm transition focus-within:ring-2 ${
        statement.verb
          ? 'border-teal-300 bg-teal-50 focus-within:border-teal-500 focus-within:ring-teal-100'
          : 'border-slate-200 bg-slate-50'
      }`}>
        <input value={statement.what}
          disabled={!statement.verb}
          onChange={event => changeWhat(event.target.value)}
          placeholder={statement.verb
            ? 'coolant, pressure, status…' : 'Choose or type a Verb first'}
          aria-label="What the function acts on"
          className="min-w-0 flex-1 bg-transparent text-xs font-medium text-teal-950 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed" />
      </div>
      <select value={draftRelationship}
        disabled={!statement.verb || !statement.what}
        onChange={event => changeRelationship(event.target.value)}
        aria-label="Function relationship"
        title="Relationship between the affected item and target"
        className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[9px] font-semibold text-slate-600 outline-none hover:border-slate-300 focus:border-blue-400 disabled:cursor-not-allowed disabled:opacity-60">
        {FUNCTION_RELATIONSHIPS.map(relationship =>
          <option key={relationship} value={relationship}>
            {relationship}
          </option>)}
      </select>
      <div className={`flex min-w-60 flex-[2] items-center rounded-full border px-2 py-1 shadow-sm transition focus-within:ring-2 ${
        statement.verb && statement.what
          ? 'border-violet-300 bg-violet-50 focus-within:border-violet-500 focus-within:ring-violet-100'
          : 'border-slate-200 bg-slate-50'
      }`}>
        <input value={statement.target}
          disabled={!statement.verb || !statement.what}
          onChange={event => changeTarget(event.target.value)}
          placeholder={statement.what
            ? 'target system or free text (optional)'
            : 'Define the first What'}
          aria-label="Optional target object or system"
          className="min-w-0 flex-1 bg-transparent text-xs font-medium text-violet-950 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed" />
      </div>
      {targetSuggestions.length > 0 &&
        <details ref={targetDetailsRef} className="relative">
        <summary title="Choose a target system or object from this analysis"
          className="flex h-7 cursor-pointer list-none items-center gap-1 rounded-full border border-violet-200 bg-white px-2 text-[9px] font-medium text-violet-700 hover:border-violet-400 hover:bg-violet-50 [&::-webkit-details-marker]:hidden">
          Choose target <ChevronDown size={10} />
        </summary>
        <div className="absolute right-0 z-40 mt-1 w-72 rounded-lg border border-slate-200 bg-white p-2 shadow-xl">
          <div className="mb-1.5 text-[10px] font-semibold text-slate-700">
            Target systems and objects
          </div>
          <p className="mb-2 text-[9px] leading-snug text-slate-400">
            Select an existing structure/interface target, or type any
            appropriate target directly in the second What.
          </p>
          <div className="flex max-h-48 flex-wrap gap-1 overflow-y-auto">
            {targetSuggestions.slice(0, 20).map(target =>
              <button key={target} type="button"
                disabled={!statement.verb || !statement.what}
                onClick={() => {
                  changeTarget(target)
                  targetDetailsRef.current?.removeAttribute('open')
                }}
                className="rounded-full border border-violet-200 bg-violet-50 px-2 py-1 text-[9px] text-violet-700 hover:border-violet-400 disabled:cursor-not-allowed disabled:opacity-40">
                {target}
              </button>)}
          </div>
        </div>
      </details>}
    </div>
    {(verbCorrection || targetCorrection) &&
      <div className="mt-1 flex flex-wrap items-center gap-1 text-[9px] text-slate-500">
        <Sparkles size={10} className="text-blue-500" aria-hidden="true" />
        <span>Possible match:</span>
        {verbCorrection &&
          <button type="button" onClick={() => choose(verbCorrection)}
            title={`Use dictionary verb “${verbCorrection.label}”`}
            className="rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 font-medium text-blue-700 hover:border-blue-400">
            Use verb: {verbCorrection.label}
          </button>}
        {targetCorrection &&
          <button type="button" onClick={() => changeTarget(targetCorrection)}
            title={`Use known target “${targetCorrection}”`}
            className="rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 font-medium text-violet-700 hover:border-violet-400">
            Use target: {targetCorrection}
          </button>}
      </div>}
    {value.trim() && <div className="mt-1 flex flex-wrap items-center gap-1 text-[9px]">
      {match.status === 'canonical' && match.term &&
        <span className="flex items-center gap-1 text-emerald-700">
          <CheckCircle2 size={10} /> Canonical intent: {match.term.label}
        </span>}
      {match.status === 'alias' && match.term &&
        <button type="button" onClick={replaceAlias}
          className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700 hover:bg-blue-100">
          “{match.leading}” is an alias · prefer {match.term.label}
        </button>}
      {match.status === 'ambiguous' &&
        <span className="flex flex-wrap items-center gap-1 text-amber-700">
          <CircleHelp size={10} /> “{match.leading}” is broad. Choose:
          {match.candidates.map(term =>
            <button key={term.id} type="button" onClick={() => choose(term)}
              className="rounded border border-amber-200 bg-amber-50 px-1">
              {term.label}
            </button>)}
        </span>}
      {match.status === 'custom' &&
        <span className="text-slate-400">Custom verb retained.</span>}
    </div>}
    {canonicalVerbId && !terms.some(term => term.id === canonicalVerbId) &&
      <p className="mt-1 text-[9px] text-amber-700">
        The selected project term is unavailable; choose a current term or retain the custom wording.
      </p>}
  </div>
}

export function VocabularyTaggedField({
  label,
  value,
  semanticId,
  domain,
  profile,
  kind,
  multiline = false,
  placeholder,
  fillWhenBlank = true,
  onChange,
}: {
  label: string
  value: string
  semanticId?: string
  domain: FMEAVocabularyDomain
  profile?: FMEAVocabularyProfile
  kind: FMEAKind
  multiline?: boolean
  placeholder?: string
  fillWhenBlank?: boolean
  onChange: (value: string, semanticId?: string) => void
}) {
  const selected = vocabularyTerms(profile, domain, kind)
    .find(term => term.id === semanticId)
  return <div>
    <div className="text-[11px] font-medium text-slate-600">{label}</div>
    <div className="mt-1 flex items-start gap-1">
      {multiline
        ? <textarea value={value} onChange={event =>
            onChange(event.target.value, semanticId)}
            placeholder={placeholder}
            className={`${inputClass} min-h-16 resize-y`} />
        : <input value={value} onChange={event =>
            onChange(event.target.value, semanticId)}
            placeholder={placeholder} className={inputClass} />}
      <VocabularyPicker domain={domain} profile={profile} kind={kind}
        selectedId={semanticId} onSelect={term =>
          onChange(!value.trim() && fillWhenBlank ? term.label : value, term.id)} />
    </div>
    {selected && <div className="mt-1 flex items-center gap-1 text-[9px] text-blue-700">
      <Tags size={9} /> {selected.label}
      <button type="button" title="Remove semantic tag"
        onClick={() => onChange(value, undefined)}
        className="text-slate-400 hover:text-red-500"><X size={9} /></button>
      <span className="text-slate-400">· {selected.definition}</span>
    </div>}
    {semanticId && !selected &&
      <div className="mt-1 flex items-center gap-1 text-[9px] text-amber-700">
        The selected project term is unavailable.
        <button type="button" onClick={() => onChange(value, undefined)}
          className="underline">Remove stale tag</button>
      </div>}
  </div>
}

export function OperatingModesField({
  values,
  profile,
  kind,
  onChange,
}: {
  values: string[]
  profile?: FMEAVocabularyProfile
  kind: FMEAKind
  onChange: (values: string[]) => void
}) {
  return <div>
    <div className="text-[11px] font-medium text-slate-600">Operating modes</div>
    <div className="mt-1 flex items-start gap-1">
      <input value={values.join(', ')} onChange={event =>
        onChange(event.target.value.split(',')
          .map(value => value.trim()).filter(Boolean))}
        placeholder="Comma-separated modes" className={inputClass} />
      <VocabularyPicker domain="operating_mode" profile={profile} kind={kind}
        onSelect={term => {
          if (!values.some(value =>
            normalizeVocabulary(value) === normalizeVocabulary(term.label))) {
            onChange([...values, term.label])
          }
        }} />
    </div>
    {values.length > 0 && <div className="mt-1 flex flex-wrap gap-1">
      {values.map(value => <span key={value}
        className="flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-600">
        {value}
        <button type="button" onClick={() =>
          onChange(values.filter(item => item !== value))}
          aria-label={`Remove ${value}`}><X size={8} /></button>
      </span>)}
    </div>}
  </div>
}

export function VocabularyManager({
  profile,
  onChange,
}: {
  profile: FMEAVocabularyProfile
  onChange: (profile: FMEAVocabularyProfile) => void
}) {
  const [domain, setDomain] = useState<FMEAVocabularyDomain>('function_verb')
  const [label, setLabel] = useState('')
  const [definition, setDefinition] = useState('')
  const [aliases, setAliases] = useState('')
  const [aliasTarget, setAliasTarget] = useState('')
  const [aliasValue, setAliasValue] = useState('')
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(true)
  const allTerms = vocabularyTerms(profile)
  const aliasTermGroups = (
    Object.keys(DOMAIN_LABELS) as FMEAVocabularyDomain[]
  ).map(value => ({
    domain: value,
    terms: allTerms
      .filter(term => term.domain === value)
      .sort((left, right) =>
        left.category.localeCompare(right.category)
        || left.label.localeCompare(right.label)),
  })).filter(group => group.terms.length)

  const commit = (candidate: FMEAVocabularyProfile, success: () => void) => {
    const conflicts = vocabularyConflicts(candidate)
    if (conflicts.length) {
      setError(`Term or alias already belongs to another meaning: ${conflicts.join(', ')}`)
      return
    }
    setError('')
    onChange(candidate)
    success()
  }
  const addTerm = () => {
    if (!label.trim() || !definition.trim()) {
      setError('A project term needs both a preferred label and a precise definition.')
      return
    }
    const created = createProjectVocabularyTerm({
      domain,
      label,
      category: 'Project terms',
      definition,
      aliases: aliases.split(','),
    })
    commit({ ...profile, custom_terms: [...profile.custom_terms, created] }, () => {
      setLabel('')
      setDefinition('')
      setAliases('')
    })
  }
  const addAlias = () => {
    if (!aliasTarget || !aliasValue.trim()) {
      setError('Choose a preferred term and enter the project alias.')
      return
    }
    if (allTerms.find(term => term.id === aliasTarget)?.aliases.some(
      value => normalizeVocabulary(value) === normalizeVocabulary(aliasValue))) {
      setError('That alias already belongs to the selected preferred term.')
      return
    }
    commit({
      ...profile,
      custom_aliases: [...profile.custom_aliases, {
        id: `alias:${Date.now().toString(36)}-${Math.random()
          .toString(36).slice(2, 7)}`,
        term_id: aliasTarget,
        value: aliasValue.trim(),
      }],
    }, () => setAliasValue(''))
  }

  return <details open={expanded}
    onToggle={event => setExpanded(event.currentTarget.open)}
    className="rounded-lg border border-slate-200 bg-white">
    <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 [&::-webkit-details-marker]:hidden">
      <span className="flex items-center gap-2 text-xs font-medium text-slate-700">
        <BookOpen size={13} className="text-blue-600" />
        Project terminology
        <span className="font-normal text-slate-400">
          {profile.custom_terms.length} term(s) · {profile.custom_aliases.length} alias(es)
        </span>
      </span>
      <ChevronDown size={13} className="text-slate-400" />
    </summary>
    <div className="space-y-4 border-t border-slate-100 p-3">
      <p className="text-[10px] leading-relaxed text-slate-500">
        Built-in meanings remain fixed. Add a project-specific preferred term,
        or map local language to an existing meaning. These aids are advisory
        and are saved with the project.
      </p>
      <section>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          Add an alias to a preferred term
        </div>
        <div className="grid gap-2 md:grid-cols-[minmax(180px,1fr)_minmax(160px,1fr)_auto]">
          <select value={aliasTarget} onChange={event =>
            setAliasTarget(event.target.value)} className={inputClass}>
            <option value="">Preferred term…</option>
            {aliasTermGroups.map(group =>
              <optgroup key={group.domain}
                label={DOMAIN_LABELS[group.domain]}>
                {group.terms.map(term =>
                  <option key={term.id} value={term.id}>
                    {term.category} · {term.label}
                  </option>)}
              </optgroup>)}
          </select>
          <input value={aliasValue} onChange={event =>
            setAliasValue(event.target.value)}
            placeholder="Project alias" className={inputClass} />
          <button type="button" onClick={addAlias}
            className="flex items-center justify-center gap-1 rounded border border-blue-300 px-3 py-1.5 text-xs text-blue-700">
            <Plus size={12} /> Add alias
          </button>
        </div>
      </section>
      <section>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          Add a project term
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <select value={domain} onChange={event =>
            setDomain(event.target.value as FMEAVocabularyDomain)}
            className={inputClass}>
            {(Object.keys(DOMAIN_LABELS) as FMEAVocabularyDomain[])
              .map(value => <option key={value} value={value}>
                {DOMAIN_LABELS[value]}
              </option>)}
          </select>
          <input value={label} onChange={event => setLabel(event.target.value)}
            placeholder="Preferred term" className={inputClass} />
          <input value={definition} onChange={event =>
            setDefinition(event.target.value)}
            placeholder="Precise meaning and selection boundary"
            className={inputClass} />
          <input value={aliases} onChange={event => setAliases(event.target.value)}
            placeholder="Aliases (comma-separated)" className={inputClass} />
        </div>
        <button type="button" onClick={addTerm}
          className="mt-2 flex items-center gap-1 rounded border border-blue-300 px-3 py-1.5 text-xs text-blue-700">
          <Plus size={12} /> Add project term
        </button>
      </section>
      {error && <p role="alert"
        className="rounded border border-red-200 bg-red-50 p-2 text-[10px] text-red-700">
        {error}
      </p>}
      {(profile.custom_terms.length > 0 || profile.custom_aliases.length > 0) &&
        <section>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Project additions
          </div>
          <div className="divide-y rounded border border-slate-100">
            {profile.custom_terms.map(term => <div key={term.id}
              className="flex items-start justify-between gap-2 p-2 text-[10px]">
              <div><strong>{term.label}</strong>
                <span className="text-slate-400"> · {DOMAIN_LABELS[term.domain]}</span>
                <p className="text-slate-500">{term.definition}</p></div>
              <button type="button" title="Delete project term" onClick={() =>
                onChange({
                  ...profile,
                  custom_terms: profile.custom_terms.filter(item => item.id !== term.id),
                  custom_aliases: profile.custom_aliases.filter(
                    alias => alias.term_id !== term.id),
                })} className="text-slate-300 hover:text-red-500">
                <Trash2 size={12} />
              </button>
            </div>)}
            {profile.custom_aliases.map(alias => {
              const target = allTerms.find(term => term.id === alias.term_id)
              return <div key={alias.id}
                className="flex items-center justify-between gap-2 p-2 text-[10px]">
                <span>“{alias.value}” → <strong>{target?.label ?? 'Unknown term'}</strong></span>
                <button type="button" title="Delete project alias" onClick={() =>
                  onChange({
                    ...profile,
                    custom_aliases: profile.custom_aliases.filter(
                      item => item.id !== alias.id),
                  })} className="text-slate-300 hover:text-red-500">
                  <Trash2 size={12} />
                </button>
              </div>
            })}
          </div>
        </section>}
    </div>
  </details>
}
