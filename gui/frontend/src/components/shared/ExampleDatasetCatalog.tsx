import { useEffect, useMemo, useRef, useState } from 'react'
import { Database, ExternalLink, Search, X } from 'lucide-react'
import {
  EXAMPLE_DATASETS, ExampleDataset, NIST_DATASET_CATALOG,
} from '../../data/exampleDatasets'
import { MODULE_LABELS } from '../../store/project'
import { useFocusTrap } from './useDialog'

interface Props {
  open: boolean
  activeModule: string
  onClose: () => void
  onImport: (entry: ExampleDataset) => Promise<boolean>
}

const ALL = 'all'

export default function ExampleDatasetCatalog({ open, activeModule, onClose, onImport }: Props) {
  const [query, setQuery] = useState('')
  const [moduleFilter, setModuleFilter] = useState(activeModule)
  const [categoryFilter, setCategoryFilter] = useState(ALL)
  const [busyId, setBusyId] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef, open, onClose)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setModuleFilter(activeModule)
    setCategoryFilter(ALL)
    setBusyId(null)
  }, [open, activeModule])

  const modules = useMemo(() => Array.from(new Map(
    EXAMPLE_DATASETS.map(entry => [entry.targetModule, entry.targetLabel]),
  ).entries()), [])
  const categories = useMemo(() => Array.from(new Set(EXAMPLE_DATASETS.map(entry => entry.category))).sort(), [])

  const entries = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return EXAMPLE_DATASETS.filter(entry => {
      if (moduleFilter !== ALL && entry.targetModule !== moduleFilter) return false
      if (categoryFilter !== ALL && entry.category !== categoryFilter) return false
      if (!needle) return true
      return [
        entry.title, entry.description, entry.subtool, entry.category,
        entry.source.filename, entry.source.title, ...entry.variables,
      ].some(value => value.toLowerCase().includes(needle))
    })
  }, [query, moduleFilter, categoryFilter])

  const importEntry = async (entry: ExampleDataset) => {
    setBusyId(entry.id)
    try {
      if (await onImport(entry)) onClose()
    } finally {
      setBusyId(null)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/35 p-4"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="example-dataset-title"
        className="flex max-h-[88vh] w-[64rem] max-w-[96vw] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
          <div>
            <h2 id="example-dataset-title" className="flex items-center gap-2 text-base font-semibold text-gray-800">
              <Database size={17} className="text-blue-600" /> Example datasets
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              Curated official NIST Dataplot cases, converted to current Perdura module inputs.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close example dataset catalog"
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            <X size={17} />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2 border-b border-gray-100 bg-gray-50/70 px-5 py-3 md:grid-cols-[1fr_13rem_11rem]">
          <label className="relative">
            <span className="sr-only">Search example datasets</span>
            <Search size={14} className="pointer-events-none absolute left-2.5 top-2 text-gray-400" />
            <input autoFocus value={query} onChange={event => setQuery(event.target.value)}
              placeholder="Search datasets, variables, or source files…"
              className="w-full rounded border border-gray-300 bg-white py-1.5 pl-8 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
          </label>
          <label>
            <span className="sr-only">Filter by module</span>
            <select value={moduleFilter} onChange={event => setModuleFilter(event.target.value)}
              className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
              <option value={ALL}>All supported modules</option>
              {modules.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Filter by category</span>
            <select value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}
              className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
              <option value={ALL}>All categories</option>
              {categories.map(category => <option key={category} value={category}>{category}</option>)}
            </select>
          </label>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {entries.length === 0 ? (
            <div className="flex min-h-52 flex-col items-center justify-center text-center text-gray-400">
              <Database size={30} className="mb-2 text-gray-300" />
              <p className="text-sm font-medium text-gray-500">No matching example datasets</p>
              {moduleFilter === activeModule && (
                <>
                  <p className="mt-1 max-w-md text-xs">
                    No NIST table maps safely to {MODULE_LABELS[activeModule] ?? activeModule} without inventing or discarding required structure.
                  </p>
                  <button onClick={() => setModuleFilter(ALL)} className="mt-3 text-xs font-medium text-blue-600 hover:text-blue-800">
                    Show all supported modules
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {entries.map(entry => (
                <article key={entry.id} className="flex flex-col rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-blue-700">
                          {entry.category}
                        </span>
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[9px] text-gray-600">{entry.subtool}</span>
                      </div>
                      <h3 className="mt-2 text-sm font-semibold text-gray-800">{entry.title}</h3>
                    </div>
                    <button onClick={() => void importEntry(entry)} disabled={busyId != null}
                      className="flex-shrink-0 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                      {busyId === entry.id ? 'Importing…' : 'Import'}
                    </button>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-gray-600">{entry.description}</p>
                  <dl className="mt-3 grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1 text-[10px]">
                    <dt className="text-gray-400">Destination</dt>
                    <dd className="text-gray-700">{entry.targetLabel} · {entry.subtool}</dd>
                    <dt className="text-gray-400">Data</dt>
                    <dd className="text-gray-700">{entry.rowCount} rows · {entry.variables.join(', ')}</dd>
                    {(entry.targetModule === 'lifeData' || entry.targetSlices.includes('degradation')) && <>
                      <dt className="text-gray-400">Time basis</dt>
                      <dd className="text-gray-700">{entry.units}</dd>
                    </>}
                    <dt className="text-gray-400">NIST source</dt>
                    <dd>
                      <a href={entry.source.url} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800">
                        {entry.source.filename} <ExternalLink size={9} />
                      </a>
                    </dd>
                  </dl>
                  <details className="mt-3 rounded border border-gray-100 bg-gray-50 px-2 py-1.5 text-[10px] text-gray-600">
                    <summary className="cursor-pointer font-medium text-gray-600">Conversion notes</summary>
                    <p className="mt-1 leading-relaxed">{entry.transformation}</p>
                    <p className="mt-1 break-all text-[9px] text-gray-400">Raw SHA-256: {entry.source.rawSha256}</p>
                  </details>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-gray-200 bg-gray-50 px-5 py-2.5 text-[10px] text-gray-500">
          <span>{entries.length} of {EXAMPLE_DATASETS.length} examples shown</span>
          <a href={NIST_DATASET_CATALOG.sourcePage} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800">
            NIST Dataplot dataset index <ExternalLink size={9} />
          </a>
        </div>
      </div>
    </div>
  )
}
