import { useRef } from 'react'
import { LayoutGrid } from 'lucide-react'
import type { DiagramLayoutOptions } from './adaptiveDiagramLayout.mjs'

/** Native disclosure/actions allow reapplying the selected preset and provide
 * standard keyboard focus without an incomplete custom menu implementation. */
export default function DiagramLayoutMenu({ value, onChange, onApply, gateLabel = 'Preserve gate order', eventLabel = 'Preserve event order' }: {
  value: DiagramLayoutOptions
  onChange: (value: DiagramLayoutOptions) => void
  onApply: (value: DiagramLayoutOptions) => void
  gateLabel?: string | null
  eventLabel?: string
}) {
  const ref = useRef<HTMLDetailsElement>(null)
  const apply = (mode: DiagramLayoutOptions['mode']) => {
    const next = { ...value, mode }
    onApply(next)
    if (ref.current) { ref.current.open = false; ref.current.querySelector('summary')?.focus() }
  }
  return <details ref={ref} className="relative" onKeyDown={event => {
    if (event.key === 'Escape' && ref.current?.open) {
      event.preventDefault(); ref.current.open = false; ref.current.querySelector('summary')?.focus()
    }
  }}>
    <summary className="flex h-8 cursor-pointer list-none items-center gap-1 whitespace-nowrap rounded border border-slate-300 bg-white px-2 text-[10px] font-medium text-slate-700 hover:bg-slate-50" aria-label="Diagram layout">
      <LayoutGrid size={12} /> Layout: {value.mode === 'normal' ? 'Normal' : value.mode === 'compact' ? 'Compact' : 'Expanded'}
    </summary>
    <div className="absolute left-0 top-full z-50 mt-1 min-w-60 rounded border border-slate-300 bg-white p-2 text-xs text-slate-800 shadow-lg">
      <p className="mb-1 text-[11px] text-slate-600">Apply layout (also reapplies the current mode)</p>
      <div className="mb-2 flex gap-1">
        {(['compact', 'normal', 'expanded'] as const).map(mode => <button key={mode} type="button"
          aria-pressed={value.mode === mode} onClick={() => apply(mode)}
          className={`min-h-8 rounded border px-2 ${value.mode === mode ? 'border-blue-600 bg-blue-50' : 'border-slate-300 hover:bg-slate-50'}`}>
          {mode[0].toUpperCase() + mode.slice(1)}
        </button>)}
      </div>
      {gateLabel && <label className="flex min-h-8 items-center gap-2"><input type="checkbox" checked={value.preserveGateOrder}
        onChange={event => onChange({ ...value, preserveGateOrder: event.target.checked })} />{gateLabel}</label>}
      <label className="flex min-h-8 items-center gap-2"><input type="checkbox" checked={value.preserveEventOrder}
        onChange={event => onChange({ ...value, preserveEventOrder: event.target.checked })} />{eventLabel}</label>
      <label className="flex min-h-8 items-center gap-2"><input type="checkbox" checked={value.optimizeLabelGeometry}
        onChange={event => onChange({ ...value, optimizeLabelGeometry: event.target.checked })} />Optimize label geometry</label>
      <p className="mt-1 max-w-64 text-[10px] text-slate-600">Preserves visual order. Apply a mode to arrange the diagram. Model input order and logic stay unchanged.</p>
    </div>
  </details>
}
