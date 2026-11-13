import { useMemo, useState } from 'react'
import { ArrowUpRight, Boxes, Link2, Plus, Search, X } from 'lucide-react'

export interface RbdLibraryAnalysis {
  id: string
  name: string
  current: boolean
  circular: boolean
  stale: boolean
  staleReason?: string
  reliability?: number
  missionTime?: number
  blockCount: number
  votingCount: number
  connectionCount: number
  searchText: string
}

export default function RbdAnalysisLibrary({ analyses, units, onOpen, onInsert, onCreate }: {
  analyses: RbdLibraryAnalysis[]
  units: string
  onOpen: (id: string) => void
  onInsert: (id: string) => void
  onCreate: () => void
}) {
  const [query, setQuery] = useState('')
  const matches = useMemo(() => {
    const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
    return analyses.filter(analysis => terms.every(term =>
      `${analysis.name} ${analysis.searchText}`.toLocaleLowerCase().includes(term)))
  }, [analyses, query])
  return <section aria-label="Project RBD analyses" data-rbd-project-library className="space-y-3">
    <div className="flex items-start justify-between gap-2">
      <div><h3 className="text-sm font-semibold text-slate-900">Project RBD analyses</h3>
        <p className="mt-1 text-xs leading-5 text-slate-600">Open a diagram or reuse it as a linked subsystem.</p></div>
      <button type="button" onClick={onCreate} aria-label="Create RBD analysis"
        className="shrink-0 rounded-lg border border-slate-300 bg-white p-2 text-slate-700 hover:border-blue-400 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
        <Plus size={16} aria-hidden="true" />
      </button>
    </div>
    <div className="relative">
      <Search size={15} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-3 text-slate-500" />
      <input aria-label="Search project RBD analyses" placeholder="Search names or blocks…" value={query}
        onChange={event => setQuery(event.target.value)}
        className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-8 pr-8 text-xs text-slate-800 outline-hidden placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
      {query && <button type="button" aria-label="Clear RBD analysis search" onClick={() => setQuery('')}
        className="absolute right-1 top-1 rounded p-2 text-slate-600 hover:bg-slate-100"><X size={14} /></button>}
    </div>
    <p role="status" className="text-xs text-slate-600">{query ? `${matches.length} of ${analyses.length}` : analyses.length} {analyses.length === 1 ? 'analysis' : 'analyses'}</p>
    <div className="space-y-3">
      {matches.map(analysis => {
        const calculated = analysis.reliability != null && Number.isFinite(analysis.reliability)
        const insertReason = analysis.current ? 'An analysis cannot contain itself.'
          : analysis.circular ? 'This analysis already references the current diagram. Inserting it would create a circular dependency.' : ''
        return <article key={analysis.id} aria-label={analysis.name}
          className={`rounded-xl border bg-white p-3 ${analysis.current ? 'border-blue-300 ring-1 ring-blue-100' : 'border-slate-200'}`}>
          <div className="flex items-start gap-2">
            <span className="rounded-lg bg-cyan-50 p-2 text-cyan-800"><Boxes size={17} aria-hidden="true" /></span>
            <div className="min-w-0 flex-1"><h4 className="break-words text-sm font-semibold leading-5 text-slate-900">{analysis.name}</h4>
              <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-medium">
                {analysis.current && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-800">Current</span>}
                <span className={`rounded px-1.5 py-0.5 ${analysis.stale ? 'bg-amber-50 text-amber-900' : calculated ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                  {analysis.stale ? 'Recalculate' : calculated ? 'Calculated' : 'Not calculated'}</span>
              </div>
            </div>
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-600">{analysis.blockCount} {analysis.blockCount === 1 ? 'block' : 'blocks'}
            {analysis.votingCount > 0 ? ` · ${analysis.votingCount} voting ${analysis.votingCount === 1 ? 'junction' : 'junctions'}` : ''}
            {` · ${analysis.connectionCount} ${analysis.connectionCount === 1 ? 'connection' : 'connections'}`}</p>
          {calculated && <p className={`mt-1 text-xs ${analysis.stale ? 'text-amber-900' : 'text-slate-700'}`}>
            {analysis.stale ? 'Previous R' : 'R'} = <span className="font-semibold tabular-nums">{analysis.reliability!.toPrecision(6)}</span>
            {analysis.missionTime != null && Number.isFinite(analysis.missionTime) ? ` at ${analysis.missionTime.toLocaleString()} ${units}` : ''}
          </p>}
          {analysis.stale && <p className="mt-2 text-xs leading-5 text-amber-900">{analysis.staleReason || 'Inputs have changed since the last calculation.'}</p>}
          {analysis.circular && !analysis.current && <p className="mt-2 text-xs leading-5 text-amber-900">Circular link blocked. You can still open this diagram.</p>}
          <div className="mt-3 space-y-2">
            <button type="button" onClick={() => onOpen(analysis.id)} disabled={analysis.current}
              aria-label={`Open analysis ${analysis.name}`}
              className="flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 text-xs font-medium text-slate-800 hover:border-blue-400 hover:bg-blue-50 disabled:cursor-default disabled:bg-slate-50 disabled:text-slate-500">
              <ArrowUpRight size={14} aria-hidden="true" />{analysis.current ? 'Currently open' : 'Open analysis'}
            </button>
            <button type="button" onClick={() => onInsert(analysis.id)} disabled={Boolean(insertReason)}
              aria-label={`Insert linked subsystem ${analysis.name}`} title={insertReason || 'The subsystem is recalculated with this diagram when analyzed.'}
              className="flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-cyan-200 bg-cyan-50 px-2 text-xs font-medium text-cyan-900 hover:border-cyan-400 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-500">
              <Link2 size={14} aria-hidden="true" />Insert linked subsystem
            </button>
          </div>
        </article>
      })}
      {!matches.length && <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center">
        <Boxes size={24} aria-hidden="true" className="mx-auto text-slate-500" />
        <p className="mt-2 text-sm font-medium text-slate-800">{query ? 'No matching analyses' : 'Create your first RBD analysis'}</p>
        <p className="mt-1 text-xs leading-5 text-slate-600">{query ? 'Try another analysis name or block label.' : 'Build a success path, then reuse it in other system diagrams.'}</p>
        <button type="button" onClick={query ? () => setQuery('') : onCreate}
          className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-blue-50">
          {query ? 'Clear search' : 'Create analysis'}</button>
      </div>}
    </div>
  </section>
}
