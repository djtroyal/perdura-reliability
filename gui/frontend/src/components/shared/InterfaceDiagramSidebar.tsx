import { PanelLeftClose, PanelLeftOpen, ChevronDown } from 'lucide-react'
import { useId, useRef, useState, type ReactNode } from 'react'
import { useUiPreference } from '../../store/uiPreferences'
import DropdownDetails from './DropdownDetails'
import { ALL_RESOURCES, UNASSIGNED_RESOURCE, INTERFACE_TYPE_OPTIONS, defaultInterfaceDiagramFilters,
  resourceFilterValue, type DiagramResourceOption, type InterfaceDiagramFilters } from './interfaceDiagramFilters'

export default function InterfaceDiagramSidebar({ filters, onChange, resources, matchingCount, totalCount, selectedBlockLabel, supportsConnections = false, children }: {
  filters: InterfaceDiagramFilters
  onChange: (value: InterfaceDiagramFilters) => void
  resources: readonly DiagramResourceOption[]
  matchingCount: number
  totalCount: number
  selectedBlockLabel?: string
  supportsConnections?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useUiPreference<boolean>('interfaceDiagram.libraryOpen', true)
  const [width, setWidth] = useUiPreference<number>('interfaceDiagram.libraryWidth', 288)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const drag = useRef<{ x: number; width: number } | null>(null)
  const [query, setQuery] = useState('')
  const resourceMenu = useRef<HTMLDetailsElement>(null)
  const paneId = useId(), resourceRadioName = useId()
  const clamp = (value: number) => Math.min(440, Math.max(240, value))
  const active = Number(filters.types.length !== INTERFACE_TYPE_OPTIONS.length)
    + Number(filters.resource !== ALL_RESOURCES) + Number(filters.onlyConnected) + Number(filters.connections !== 'all')
  const selectingPartners = supportsConnections && Boolean(selectedBlockLabel) && filters.connections !== 'all'
  const resourceLabel = filters.resource === ALL_RESOURCES ? 'All resources'
    : filters.resource === UNASSIGNED_RESOURCE ? 'No resource assigned'
      : resources.find(item => resourceFilterValue(item.id) === filters.resource)?.name ?? 'All resources'
  const counts = new Map<string, number>()
  resources.forEach(item => counts.set(item.name, (counts.get(item.name) ?? 0) + 1))
  const resourceOptions = [
    { value: ALL_RESOURCES, label: 'All resources' },
    { value: UNASSIGNED_RESOURCE, label: 'No resource assigned' },
    ...resources.map(item => ({ value: resourceFilterValue(item.id), label: (counts.get(item.name) ?? 0) > 1
      ? `${item.name} · ${item.category || 'Resource'}${item.unit ? ` · ${item.unit}` : ''} · ${item.id}` : item.name })),
  ].filter(item => !query || item.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()))

  return <>
    <aside id={paneId} aria-label="Diagram library" data-export-ignore
      style={open ? { width: clamp(dragWidth ?? width), maxWidth: '45%' } : { width: 36 }}
      className="relative min-w-0 shrink-0 overflow-y-auto border-r border-slate-200 bg-white">
      <div className={`flex items-center gap-2 ${open ? 'justify-between px-3 pt-2' : 'justify-center py-2'}`}>
        {open && <span className="text-xs font-semibold text-slate-700">Diagram display</span>}
        <button type="button" aria-label={open ? 'Hide diagram library' : 'Show diagram library'}
          title={open ? 'Hide diagram library' : 'Show diagram library'} aria-expanded={open} aria-controls={paneId}
          onClick={() => setOpen(value => !value)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-500">
          {open ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
        </button>
      </div>
      {open && <div className="min-w-0 px-3 pb-3 [overflow-wrap:anywhere]">
        <section aria-label="Diagram filters" className="mb-3 space-y-2 border-b border-slate-200 pb-3 pt-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-medium text-slate-600">Filters{active ? ` · ${active} active` : ''}</span>
            <button type="button" onClick={() => onChange(defaultInterfaceDiagramFilters())}
              disabled={!active} className="rounded px-1 py-1 text-blue-700 hover:bg-blue-50 disabled:text-slate-400">Reset filters</button>
          </div>
          <DropdownDetails className="rounded border border-slate-300 bg-white">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2 py-2 text-xs text-slate-700">
              <span>Interface types · {filters.types.length === INTERFACE_TYPE_OPTIONS.length ? 'All' : filters.types.length === 0 ? 'None' : `${filters.types.length} selected`}</span>
              <ChevronDown size={13} className="shrink-0" />
            </summary>
            <div className="border-t px-2 pb-2">
              <div className="flex gap-3 py-1 text-xs">
                <button type="button" className="rounded py-1 text-blue-700" onClick={() => onChange({ ...filters, types: INTERFACE_TYPE_OPTIONS.map(item => item.value) })}>All types</button>
                <button type="button" className="rounded py-1 text-blue-700" onClick={() => onChange({ ...filters, types: [] })}>No types</button>
              </div>
              <fieldset className="space-y-1"><legend className="sr-only">Visible interface types</legend>
                {INTERFACE_TYPE_OPTIONS.map(item => <label key={item.value} className="flex items-start gap-2 py-1 text-xs text-slate-700">
                  <input type="checkbox" className="mt-0.5 shrink-0" checked={filters.types.includes(item.value)} onChange={event => onChange({ ...filters,
                    types: event.target.checked ? [...filters.types, item.value] : filters.types.filter(value => value !== item.value) })} />
                  <span>{item.label}</span>
                </label>)}
              </fieldset>
            </div>
          </DropdownDetails>
          <DropdownDetails ref={resourceMenu} className="rounded border border-slate-300 bg-white">
            <summary className="flex cursor-pointer list-none items-start justify-between gap-2 px-2 py-2 text-xs text-slate-700">
              <span>Resource · {resourceLabel}</span><ChevronDown size={13} className="mt-0.5 shrink-0" />
            </summary>
            <div className="border-t p-2">
              <input type="search" aria-label="Find a diagram resource" placeholder="Find a resource" value={query}
                onChange={event => setQuery(event.target.value)} className="mb-2 w-full rounded border border-slate-300 px-2 py-1.5 text-xs" />
              <fieldset className="max-h-52 space-y-1 overflow-y-auto"><legend className="sr-only">Visible interface resource</legend>
                {resourceOptions.map(item => <label key={item.value} className="flex items-start gap-2 py-1 text-xs text-slate-700">
                  <input type="radio" name={resourceRadioName} className="mt-0.5 shrink-0" checked={filters.resource === item.value}
                    onChange={() => {
                      onChange({ ...filters, resource: item.value }); setQuery('')
                      if (resourceMenu.current) {
                        resourceMenu.current.open = false
                        resourceMenu.current.querySelector('summary')?.focus()
                      }
                    }} />
                  <span>{item.label}</span>
                </label>)}
                {!resourceOptions.length && <p className="py-2 text-xs text-slate-500">No matching resources.</p>}
              </fieldset>
            </div>
          </DropdownDetails>
          {supportsConnections && <><label className="block text-xs text-slate-700">Selected block connections
            <select value={filters.connections} onChange={event => onChange({ ...filters,
              connections: event.target.value as InterfaceDiagramFilters['connections'] })}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-2 text-xs">
              <option value="all">All blocks</option>
              <option value="suppliers" disabled={!selectedBlockLabel}>Input suppliers</option>
              <option value="recipients" disabled={!selectedBlockLabel}>Output recipients</option>
              <option value="both" disabled={!selectedBlockLabel}>Inputs and outputs</option>
            </select>
          </label>
          {selectedBlockLabel ? <p className="text-xs text-slate-600">For: <strong>{selectedBlockLabel}</strong>
            {filters.connections !== 'all' && <span className="block">Shows this block and its resource-flow partners, including inherited connections.</span>}</p>
            : <p className="text-xs text-slate-500">Select a block to filter its input suppliers or output recipients.</p>}</>}
          <label className="flex items-start gap-2 py-1 text-xs text-slate-700"><input type="checkbox" className="mt-0.5 shrink-0"
            checked={filters.onlyConnected || selectingPartners} disabled={selectingPartners}
            onChange={event => onChange({ ...filters, onlyConnected: event.target.checked })} />Only connected blocks</label>
          <p role="status" aria-live="polite" className="text-xs text-slate-500">{matchingCount} of {totalCount} interfaces match</p>
          {!matchingCount && active > 0 && <p className="text-xs text-slate-600">No interfaces match these filters. Reset filters to see all connections in this view.</p>}
        </section>
        {children}
      </div>}
    </aside>
    {open && <div role="separator" aria-label="Resize diagram library" aria-orientation="vertical" tabIndex={0}
      aria-valuemin={240} aria-valuemax={440} aria-valuenow={clamp(dragWidth ?? width)} aria-controls={paneId}
      className="z-10 w-1.5 shrink-0 cursor-col-resize touch-none bg-slate-100 hover:bg-blue-200 focus-visible:bg-blue-200 focus-visible:outline-2 focus-visible:outline-blue-500"
      onPointerDown={event => {
        if (event.button !== 0) return
        event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { x: event.clientX, width: clamp(width) }; setDragWidth(clamp(width))
      }}
      onPointerMove={event => { if (drag.current) setDragWidth(clamp(drag.current.width + event.clientX - drag.current.x)) }}
      onPointerUp={event => {
        if (drag.current) setWidth(clamp(drag.current.width + event.clientX - drag.current.x))
        drag.current = null; setDragWidth(null)
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onPointerCancel={() => { drag.current = null; setDragWidth(null) }}
      onKeyDown={event => {
        const next = event.key === 'ArrowLeft' ? width - 16 : event.key === 'ArrowRight' ? width + 16
          : event.key === 'Home' ? 240 : event.key === 'End' ? 440 : undefined
        if (next !== undefined) { event.preventDefault(); setWidth(clamp(next)) }
      }} />}
  </>
}
