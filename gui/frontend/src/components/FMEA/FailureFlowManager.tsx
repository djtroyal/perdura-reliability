import { useMemo, useState } from 'react'
import {
  ArrowDown,
  Check,
  ChevronRight,
  GitBranch,
  Link2,
  Plus,
  Trash2,
  Unlink,
  X,
} from 'lucide-react'

import type {
  FMEAAnalysisRef,
  FMEAAnalysisRelation,
  FMEAFailureFlowRegistry,
  FMEAFailureRoleRef,
} from '../../api/fmea'
import {
  analysisDisplayName,
  analysisRefKey,
  applyFailureFlowProposal,
  buildFailureFlowProposals,
  detachFailureRole,
  failureRoleText,
  normalizeFailureFlowRegistry,
  sameAnalysisRef,
  type FailureFlowCommit,
  type FailureFlowProposal,
  type FMEAFlowPortfolioAnalysis,
} from './failureFlow'

const fieldClass =
  'w-full rounded border border-slate-400 bg-white px-2 py-1.5 text-xs text-slate-900 shadow-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-200'
const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

type View = 'hierarchy'|'proposals'|'links'

export default function FailureFlowManager({
  registry,
  portfolio,
  active,
  onCommit,
}: {
  registry: FMEAFailureFlowRegistry
  portfolio: FMEAFlowPortfolioAnalysis[]
  active: FMEAAnalysisRef
  onCommit: (commit: FailureFlowCommit, summary: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>('proposals')
  const proposals = useMemo(
    () => buildFailureFlowProposals(registry, portfolio, active),
    [active, portfolio, registry],
  )
  const activeEdges = registry.edges.filter(edge =>
    edge.status === 'active'
    && (sameAnalysisRef(edge.source, active)
      || sameAnalysisRef(edge.target, active)))
  const linkedStatements = new Set(activeEdges.map(edge => edge.statement_id)).size
  return <>
    <button type="button" onClick={() => setOpen(true)}
      className="inline-flex shrink-0 items-center gap-1.5 rounded border border-violet-300 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-800 shadow-sm hover:border-violet-500 hover:bg-violet-100">
      <GitBranch size={14} />
      Failure flow
      {(activeEdges.length > 0 || proposals.some(item => !item.already_linked)) &&
        <span className="rounded-full bg-white px-1.5 py-0.5 text-[9px] text-violet-700">
          {linkedStatements} linked · {
            proposals.filter(item => !item.already_linked).length} proposed
        </span>}
    </button>
    {open && <div role="dialog" aria-modal="true"
      aria-label="FMEA Failure Flow Manager"
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 p-5">
      <div className="flex h-[min(860px,92vh)] w-[min(1440px,96vw)] flex-col overflow-hidden rounded-xl border border-slate-300 bg-slate-50 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Failure Flow Manager
            </h3>
            <p className="text-[10px] text-slate-500">
              Maintain Mode → lower-level Effect and Cause → lower-level Mode
              as traceable canonical statements.
            </p>
          </div>
          <button type="button" onClick={() => setOpen(false)}
            aria-label="Close Failure Flow Manager"
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
            <X size={17} />
          </button>
        </div>
        <div className="flex border-b border-slate-200 bg-white px-3">
          {([
            ['hierarchy', 'Hierarchy'],
            ['proposals', 'Proposals'],
            ['links', 'Linked statements'],
          ] as [View, string][]).map(([id, label]) =>
            <button key={id} type="button" onClick={() => setView(id)}
              className={`border-b-2 px-4 py-2.5 text-xs font-medium ${
                view === id
                  ? 'border-violet-600 text-violet-800'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}>
              {label}
              {id === 'proposals' &&
                <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[9px]">
                  {proposals.filter(item => !item.already_linked).length}
                </span>}
            </button>)}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {view === 'hierarchy' && <HierarchyView registry={registry}
            portfolio={portfolio} active={active} onCommit={onCommit} />}
          {view === 'proposals' && <ProposalsView registry={registry}
            portfolio={portfolio} proposals={proposals}
            onCommit={onCommit} />}
          {view === 'links' && <LinksView registry={registry}
            portfolio={portfolio} active={active} onCommit={onCommit} />}
        </div>
      </div>
    </div>}
  </>
}

function HierarchyView({
  registry,
  portfolio,
  active,
  onCommit,
}: {
  registry: FMEAFailureFlowRegistry
  portfolio: FMEAFlowPortfolioAnalysis[]
  active: FMEAAnalysisRef
  onCommit: (commit: FailureFlowCommit, summary: string) => void
}) {
  const eligible = portfolio.filter(item =>
    item.analysis.kind !== 'fmea_msr')
  const [parentKey, setParentKey] = useState(analysisRefKey(active))
  const parent = eligible.find(item => analysisRefKey(item.ref) === parentKey)
    ?? eligible[0]
  const childOptions = eligible.filter(item =>
    !sameAnalysisRef(item.ref, parent?.ref ?? active)
    && item.analysis.kind === parent?.analysis.kind)
  const [childKey, setChildKey] = useState(
    analysisRefKey(childOptions[0]?.ref ?? active))
  const child = childOptions.find(item => analysisRefKey(item.ref) === childKey)
    ?? childOptions[0]
  const addRelation = () => {
    if (!parent || !child) return
    if (registry.analysis_relations.some(relation =>
      sameAnalysisRef(relation.parent, parent.ref)
      && sameAnalysisRef(relation.child, child.ref))) return
    const timestamp = new Date().toISOString()
    const next = normalizeFailureFlowRegistry(registry)
    next.analysis_relations.push({
      id: uid('FAR'),
      parent: parent.ref,
      child: child.ref,
      mappings: [],
      created_at: timestamp,
    })
    next.history.push({
      id: uid('FFE'),
      action: 'map',
      timestamp,
      summary: `Mapped ${parent.analysis.name} above ${child.analysis.name}.`,
    })
    onCommit({ registry: next, portfolio }, 'Mapped parent and child FMEA analyses.')
  }
  const related = registry.analysis_relations.filter(relation =>
    sameAnalysisRef(relation.parent, active)
    || sameAnalysisRef(relation.child, active))
  return <div className="space-y-4">
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h4 className="text-xs font-semibold text-slate-800">
        Explicit portfolio hierarchy
      </h4>
      <p className="mt-1 text-[10px] text-slate-500">
        Parent/child mappings are authoritative. Names and imported source
        references may help the analyst choose, but never create links silently.
      </p>
      <div className="mt-3 grid items-end gap-3 lg:grid-cols-[1fr_auto_1fr_auto]">
        <label className="text-[10px] font-medium text-slate-600">
          Higher-level analysis
          <select value={analysisRefKey(parent?.ref ?? active)}
            onChange={event => {
              setParentKey(event.target.value)
              const nextParent = eligible.find(item =>
                analysisRefKey(item.ref) === event.target.value)
              const nextChild = eligible.find(item =>
                !sameAnalysisRef(item.ref, nextParent?.ref ?? active)
                && item.analysis.kind === nextParent?.analysis.kind)
              setChildKey(analysisRefKey(nextChild?.ref ?? active))
            }}
            className={`mt-1 ${fieldClass}`}>
            {eligible.map(item => <option key={analysisRefKey(item.ref)}
              value={analysisRefKey(item.ref)}>
              {item.folio_name} · {item.analysis.name}
            </option>)}
          </select>
        </label>
        <ArrowDown className="mb-2 text-violet-500 lg:-rotate-90" size={18} />
        <label className="text-[10px] font-medium text-slate-600">
          Next-lower analysis
          <select value={analysisRefKey(child?.ref ?? active)}
            onChange={event => setChildKey(event.target.value)}
            className={`mt-1 ${fieldClass}`}>
            {childOptions.map(item => <option key={analysisRefKey(item.ref)}
              value={analysisRefKey(item.ref)}>
              {item.folio_name} · {item.analysis.name}
            </option>)}
          </select>
        </label>
        <button type="button" onClick={addRelation}
          disabled={!parent || !child}
          className="rounded bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-40">
          Add relationship
        </button>
      </div>
    </section>
    {related.length === 0
      ? <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-xs text-slate-500">
          No parent/child FMEA relationships involve this analysis.
        </div>
      : related.map(relation => <RelationCard key={relation.id}
          relation={relation} registry={registry} portfolio={portfolio}
          onCommit={onCommit} />)}
  </div>
}

function RelationCard({
  relation,
  registry,
  portfolio,
  onCommit,
}: {
  relation: FMEAAnalysisRelation
  registry: FMEAFailureFlowRegistry
  portfolio: FMEAFlowPortfolioAnalysis[]
  onCommit: (commit: FailureFlowCommit, summary: string) => void
}) {
  const parent = portfolio.find(item => sameAnalysisRef(item.ref, relation.parent))
  const child = portfolio.find(item => sameAnalysisRef(item.ref, relation.child))
  const [parentFunction, setParentFunction] = useState(
    parent?.analysis.functions[0]?.id ?? '')
  const [childFunction, setChildFunction] = useState(
    child?.analysis.functions[0]?.id ?? '')
  const addMapping = () => {
    if (!parentFunction || !childFunction) return
    if (relation.mappings.some(item =>
      item.parent_function_id === parentFunction
      && item.child_function_id === childFunction)) return
    const next = normalizeFailureFlowRegistry(registry)
    next.analysis_relations = next.analysis_relations.map(item =>
      item.id === relation.id
        ? {
            ...item,
            mappings: [...item.mappings, {
              id: uid('FFM'),
              parent_function_id: parentFunction,
              child_function_id: childFunction,
              parent_structure_node_id: parent?.analysis.functions.find(
                fn => fn.id === parentFunction)?.structure_node_id,
              child_structure_node_id: child?.analysis.functions.find(
                fn => fn.id === childFunction)?.structure_node_id,
            }],
          }
        : item)
    onCommit({ registry: next, portfolio }, 'Added a failure-flow function mapping.')
  }
  const activeEdges = registry.edges.filter(edge =>
    edge.status === 'active'
    && edge.analysis_relation_id === relation.id)
  const removeRelation = () => {
    if (activeEdges.length) return
    const timestamp = new Date().toISOString()
    const next = normalizeFailureFlowRegistry(registry)
    next.analysis_relations = next.analysis_relations.filter(
      item => item.id !== relation.id)
    next.history.push({
      id: uid('FFE'),
      action: 'unmap',
      timestamp,
      summary: `Removed analysis relationship ${relation.id}.`,
    })
    onCommit({ registry: next, portfolio }, 'Removed an unused FMEA hierarchy mapping.')
  }
  return <section className="rounded-lg border border-slate-200 bg-white p-4">
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-slate-800">
        <span className="truncate">{analysisDisplayName(portfolio, relation.parent)}</span>
        <ChevronRight size={14} className="shrink-0 text-violet-500" />
        <span className="truncate">{analysisDisplayName(portfolio, relation.child)}</span>
      </div>
      <button type="button" onClick={removeRelation}
        disabled={activeEdges.length > 0}
        title={activeEdges.length
          ? 'Detach the active flow links before removing this hierarchy relationship'
          : 'Remove hierarchy relationship'}
        className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-35">
        <Trash2 size={14} />
      </button>
    </div>
    <div className="mt-3 grid items-end gap-2 lg:grid-cols-[1fr_auto_1fr_auto]">
      <label className="text-[10px] text-slate-500">Higher-level function
        <select value={parentFunction}
          onChange={event => setParentFunction(event.target.value)}
          className={`mt-1 ${fieldClass}`}>
          {(parent?.analysis.functions ?? []).map(fn =>
            <option key={fn.id} value={fn.id}>{fn.description || fn.id}</option>)}
        </select>
      </label>
      <ChevronRight className="mb-2 text-slate-400" size={15} />
      <label className="text-[10px] text-slate-500">Next-lower function
        <select value={childFunction}
          onChange={event => setChildFunction(event.target.value)}
          className={`mt-1 ${fieldClass}`}>
          {(child?.analysis.functions ?? []).map(fn =>
            <option key={fn.id} value={fn.id}>{fn.description || fn.id}</option>)}
        </select>
      </label>
      <button type="button" onClick={addMapping}
        disabled={!parentFunction || !childFunction}
        className="rounded border border-violet-300 bg-violet-50 px-2.5 py-2 text-xs font-medium text-violet-800 hover:bg-violet-100 disabled:opacity-40">
        <Plus size={13} className="inline" /> Map functions
      </button>
    </div>
    <div className="mt-3 space-y-1">
      {relation.mappings.map(mapping => {
        const parentLabel = parent?.analysis.functions.find(
          fn => fn.id === mapping.parent_function_id)?.description
          || mapping.parent_function_id
        const childLabel = child?.analysis.functions.find(
          fn => fn.id === mapping.child_function_id)?.description
          || mapping.child_function_id
        const inUse = activeEdges.some(
          edge => edge.function_mapping_id === mapping.id)
        return <div key={mapping.id}
          className="flex items-center gap-2 rounded bg-slate-50 px-2 py-1.5 text-[10px] text-slate-600">
          <span className="min-w-0 flex-1 truncate">{parentLabel}</span>
          <ChevronRight size={12} className="shrink-0 text-violet-500" />
          <span className="min-w-0 flex-1 truncate">{childLabel}</span>
          <button type="button" disabled={inUse}
            onClick={() => {
              const next = normalizeFailureFlowRegistry(registry)
              next.analysis_relations = next.analysis_relations.map(item =>
                item.id === relation.id
                  ? { ...item, mappings: item.mappings.filter(
                    value => value.id !== mapping.id) }
                  : item)
              onCommit(
                { registry: next, portfolio },
                'Removed an unused function mapping.',
              )
            }}
            title={inUse ? 'Detach active links before removing mappings' : 'Remove mapping'}
            className="rounded p-1 text-slate-400 hover:text-red-600 disabled:opacity-30">
            <X size={12} />
          </button>
        </div>
      })}
      {!relation.mappings.length &&
        <p className="text-[10px] text-amber-700">
          Map at least one higher/lower function pair to generate proposals.
        </p>}
    </div>
  </section>
}

function ProposalsView({
  registry,
  portfolio,
  proposals,
  onCommit,
}: {
  registry: FMEAFailureFlowRegistry
  portfolio: FMEAFlowPortfolioAnalysis[]
  proposals: FailureFlowProposal[]
  onCommit: (commit: FailureFlowCommit, summary: string) => void
}) {
  const actionable = proposals.filter(item => !item.already_linked)
  return <div className="space-y-3">
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-[11px] text-blue-900">
      Perdura proposes only explicitly adjacent functions. Review the canonical
      wording before accepting; ratings, controls, and actions remain independent.
    </div>
    {actionable.map(proposal => <ProposalCard key={proposal.id}
      proposal={proposal} registry={registry} portfolio={portfolio}
      onCommit={onCommit} />)}
    {!actionable.length && <div
      className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
      <Check className="mx-auto mb-2 text-emerald-600" size={24} />
      <div className="text-xs font-semibold text-slate-700">
        No unresolved flow proposals
      </div>
      <p className="mt-1 text-[10px] text-slate-500">
        Add function decomposition or a portfolio hierarchy mapping to expose
        additional adjacent levels.
      </p>
    </div>}
  </div>
}

function ProposalCard({
  proposal,
  registry,
  portfolio,
  onCommit,
}: {
  proposal: FailureFlowProposal
  registry: FMEAFailureFlowRegistry
  portfolio: FMEAFlowPortfolioAnalysis[]
  onCommit: (commit: FailureFlowCommit, summary: string) => void
}) {
  const parent = portfolio.find(item => sameAnalysisRef(item.ref, proposal.parent))
  const child = portfolio.find(item => sameAnalysisRef(item.ref, proposal.child))
  const parentChain = parent?.analysis.failure_chains.find(
    item => item.id === proposal.parent_chain_id)
  const childChain = child?.analysis.failure_chains.find(
    item => item.id === proposal.child_chain_id)
  const [modeText, setModeText] = useState(
    parentChain?.failure_mode || childChain?.effect || '')
  const [causeText, setCauseText] = useState(
    parentChain?.cause || childChain?.failure_mode || '')
  if (!parent || !child || !parentChain) return null
  const conflict = Boolean(
    (childChain?.effect.trim()
      && childChain.effect.trim() !== parentChain.failure_mode.trim())
    || (childChain?.failure_mode.trim()
      && childChain.failure_mode.trim() !== parentChain.cause.trim()))
  return <section className={`rounded-lg border bg-white p-4 ${
    conflict ? 'border-amber-300' : 'border-slate-200'
  }`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="text-xs font-semibold text-slate-800">
        {parent.analysis.name}
        <ChevronRight size={13} className="mx-1 inline text-violet-500" />
        {child.analysis.name}
      </div>
      <span className="rounded bg-slate-100 px-2 py-1 text-[9px] uppercase text-slate-500">
        {proposal.source === 'portfolio_mapping'
          ? 'Portfolio mapping' : 'Function decomposition'}
      </span>
    </div>
    <div className="mt-3 grid gap-3 lg:grid-cols-2">
      <label className="rounded border border-blue-200 bg-blue-50/50 p-3 text-[10px] text-slate-600">
        Canonical statement: higher Mode = lower Effect
        <input value={modeText} onChange={event => setModeText(event.target.value)}
          className={`mt-1 ${fieldClass}`} />
        <span className="mt-1 block text-[9px] text-slate-500">
          Higher: {parentChain.failure_mode || 'blank'} · Lower: {
            childChain?.effect || 'new/blank'}
        </span>
      </label>
      <label className="rounded border border-purple-200 bg-purple-50/50 p-3 text-[10px] text-slate-600">
        Canonical statement: higher Cause = lower Mode
        <input value={causeText} onChange={event => setCauseText(event.target.value)}
          className={`mt-1 ${fieldClass}`} />
        <span className="mt-1 block text-[9px] text-slate-500">
          Higher: {parentChain.cause || 'blank'} · Lower: {
            childChain?.failure_mode || 'new/blank'}
        </span>
      </label>
    </div>
    {conflict && <p className="mt-2 text-[10px] font-medium text-amber-700">
      Existing wording differs. The values above are the canonical text that
      will replace both linked roles.
    </p>}
    <div className="mt-3 flex justify-end">
      <button type="button" disabled={!modeText.trim() || !causeText.trim()}
        onClick={() => {
          const result = applyFailureFlowProposal(
            registry, portfolio, proposal, modeText.trim(), causeText.trim())
          onCommit(
            result,
            proposal.child_chain_id
              ? 'Linked and synchronized adjacent failure records.'
              : 'Created and linked the next-lower failure record.',
          )
        }}
        className="inline-flex items-center gap-1.5 rounded bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-40">
        <Link2 size={13} />
        {proposal.child_chain_id ? 'Confirm link' : 'Create and link lower record'}
      </button>
    </div>
  </section>
}

function LinksView({
  registry,
  portfolio,
  active,
  onCommit,
}: {
  registry: FMEAFailureFlowRegistry
  portfolio: FMEAFlowPortfolioAnalysis[]
  active: FMEAAnalysisRef
  onCommit: (commit: FailureFlowCommit, summary: string) => void
}) {
  const edges = registry.edges.filter(edge =>
    edge.status === 'active'
    && (sameAnalysisRef(edge.source, active)
      || sameAnalysisRef(edge.target, active)))
  const statementById = new Map(registry.statements.map(item => [item.id, item]))
  const roleLabel = (ref: FMEAFailureRoleRef) => {
    const record = portfolio.find(item => sameAnalysisRef(item.ref, ref))
    const chain = record?.analysis.failure_chains.find(
      item => item.id === ref.chain_id)
    return {
      analysis: record?.analysis.name ?? ref.analysis_id,
      role: ref.role.replace('_', ' '),
      text: chain ? failureRoleText(chain, ref.role) : 'Missing record',
    }
  }
  return <div className="space-y-3">
    {edges.map(edge => {
      const source = roleLabel(edge.source)
      const target = roleLabel(edge.target)
      const statement = statementById.get(edge.statement_id)
      return <section key={edge.id}
        className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-800">
              {statement?.text || source.text}
            </div>
            <div className="mt-1 font-mono text-[9px] text-slate-400">
              {edge.statement_id} · version {statement?.version ?? '—'}
            </div>
          </div>
          <button type="button"
            onClick={() => {
              const result = detachFailureRole(
                registry, portfolio, edge.target)
              onCommit(result, 'Detached a failure role while preserving its text.')
            }}
            title="Detach the lower-level role from all of its active flow links"
            className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-[10px] text-slate-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700">
            <Unlink size={12} /> Detach lower role
          </button>
        </div>
        <div className="mt-3 grid items-center gap-2 lg:grid-cols-[1fr_auto_1fr]">
          <div className="rounded border border-slate-200 bg-slate-50 p-2">
            <div className="text-[9px] uppercase text-slate-400">
              {source.analysis} · {source.role}
            </div>
            <div className="mt-1 text-[11px] text-slate-700">{source.text}</div>
          </div>
          <ChevronRight size={16} className="mx-auto text-violet-500" />
          <div className="rounded border border-slate-200 bg-slate-50 p-2">
            <div className="text-[9px] uppercase text-slate-400">
              {target.analysis} · {target.role}
            </div>
            <div className="mt-1 text-[11px] text-slate-700">{target.text}</div>
          </div>
        </div>
      </section>
    })}
    {!edges.length && <div
      className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-xs text-slate-500">
      No active canonical failure links involve this analysis.
    </div>}
    {registry.history.some(event =>
      event.edge_id && edges.some(edge => edge.id === event.edge_id)) &&
      <details className="rounded-lg border border-slate-200 bg-white">
        <summary className="cursor-pointer px-4 py-3 text-xs font-semibold text-slate-700">
          Link history
        </summary>
        <div className="max-h-56 space-y-1 overflow-auto border-t border-slate-100 p-3">
          {[...registry.history].reverse().filter(event =>
            !event.edge_id || edges.some(edge => edge.id === event.edge_id))
            .slice(0, 100).map(event =>
              <div key={event.id}
                className="flex justify-between gap-3 rounded bg-slate-50 px-2 py-1.5 text-[10px] text-slate-600">
                <span>{event.summary}</span>
                <span className="shrink-0 text-slate-400">
                  {new Date(event.timestamp).toLocaleString()}
                </span>
              </div>)}
        </div>
      </details>}
  </div>
}
