import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useDismissiblePopover } from './useDismissiblePopover'
import { ChevronDown, X } from 'lucide-react'
import DatasetQuantityFields from './DatasetQuantityFields'
import type { DatasetQuantity } from './datasetUnits'

/** A small nonmodal editor shared by the project and dataset unit controls. */
export function UnitsDisclosure({ label, title, children }: {
  label: string; title: string; children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, width: 320 })
  const wrap = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const id = useId()
  const close = () => setOpen(false)
  const closeAndFocus = () => { close(); trigger.current?.focus() }

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const rect = wrap.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(320, window.innerWidth - 24)
      setPosition({ width, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)) - rect.left })
    }
    place()
    panel.current?.querySelector<HTMLElement>('select, input')?.focus()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])

  useDismissiblePopover({ open, onDismiss: close, elements: () => [wrap.current], trigger: () => trigger.current })

  return <div ref={wrap} className="relative shrink-0" onBlur={event => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) close()
  }} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); closeAndFocus() }
  }}>
    <button ref={trigger} type="button" aria-haspopup="dialog" aria-expanded={open}
      aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}
      onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true) } }}
      className="flex min-h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1">
      {label}<ChevronDown size={12} aria-hidden="true" />
    </button>
    {open && <div ref={panel} id={id} role="dialog" aria-label={title} style={position}
      className="absolute top-full z-[60] mt-2 space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-lg">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        <button type="button" onClick={closeAndFocus} aria-label={`Close ${title.toLowerCase()}`}
          className="flex size-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      {children(closeAndFocus)}
    </div>}
  </div>
}

export default function DatasetUnitsControl({ value, onChange, inherited = false }: {
  value: DatasetQuantity; onChange: (value: DatasetQuantity) => void; inherited?: boolean
}) {
  return <UnitsDisclosure label={`Dataset units: ${value.unit || 'Choose unit'}`} title="Dataset units">
    {() => <>
      <p className="text-xs leading-relaxed text-slate-600">{inherited
        ? 'Using the project default. Choose a quantity and unit to assign them to this dataset.'
        : 'Assigned to this dataset. Project unit changes retain this setting.'}</p>
      <DatasetQuantityFields value={value} onChange={onChange} />
      <p className="text-xs leading-relaxed text-slate-600">Describes entered values; changing this does not rescale observations. Refit after correcting units.</p>
    </>}
  </UnitsDisclosure>
}
