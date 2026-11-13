import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import type { FunctionInputOption } from '../../store/functionResourceFlows'
import type { SystemResource } from '../../api/systemDefinition'
import { useDismissiblePopover } from './useDismissiblePopover'

type Path = FunctionInputOption['path']
const choiceStyle = 'flex w-full items-center justify-between gap-3 rounded px-3 py-2 text-left text-xs text-slate-700 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600'

/** Select the source block first, then one of its function outputs. */
export default function InputResourcePicker({ value, options, onChange, label, resource, defaultInstanceId }: {
  value: string; options: FunctionInputOption[]; onChange: (resourceId: string) => void
  label: string; resource?: SystemResource; defaultInstanceId?: string
}) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false), [path, setPath] = useState<Path>([])
  const [external, setExternal] = useState(false), [externalId, setExternalId] = useState('')
  const [position, setPosition] = useState<CSSProperties>({})
  const selected = options.find(option => option.resource.id === value)
  const installed = useMemo(() => options.filter(option => option.sourceKind === 'installed'), [options])
  const externals = useMemo(() => options.filter(option => option.sourceKind === 'external'), [options])
  const commonRoot = installed[0]?.path[0]
  const rootPath = commonRoot && installed.every(option => option.path[0]?.id === commonRoot.id) ? [commonRoot] : []
  const defaultPath = useMemo(() => {
    if (!defaultInstanceId) return undefined
    for (const option of installed) {
      const index = option.path.findIndex(part => part.id === defaultInstanceId)
      if (index >= 0) return option.path.slice(0, index + 1)
    }
    // A leaf with no eligible local outputs still needs access to other suppliers.
    return undefined
  }, [installed, defaultInstanceId])
  const children = new Map<string, { id: string; label: string }>()
  const atPath = (option: FunctionInputOption) => path.every((part, index) => option.path[index]?.id === part.id)
  if (external) {
    if (!externalId) for (const option of externals) if (option.externalId)
      children.set(option.externalId, { id: option.externalId, label: option.externalLabel || 'External source' })
  } else for (const option of installed) if (atPath(option) && option.path.length > path.length) {
    const next = option.path[path.length]; children.set(next.id, next)
  }
  const childRows = [...children.values()].sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
  const localOutputs = external ? externals.filter(option => option.externalId === externalId)
    : installed.filter(option => atPath(option) && option.path.length === path.length)
  const shortLabel = (item: { id: string; label: string }) => childRows.some(other => other.id !== item.id && other.label === item.label)
    ? `${item.label} (${item.id})` : item.label
  const outputLabel = (option: FunctionInputOption) => localOutputs.some(other => other.resource.id !== option.resource.id && other.resource.name === option.resource.name)
    ? `${option.resource.name} (${option.resource.id})` : option.resource.name
  const currentExternal = externals.find(option => option.externalId === externalId)?.externalLabel
  const reset = () => { setPath(rootPath); setExternal(false); setExternalId('') }
  useDismissiblePopover({ open, onDismiss: () => setOpen(false), elements: () => [trigger.current, panel.current], trigger: () => trigger.current })
  useEffect(() => setOpen(false), [value, defaultInstanceId])
  const level = `${external}:${externalId}:${path.map(part => part.id).join('\0')}`
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>('[data-picker-choice]')?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open, level])
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const box = trigger.current?.getBoundingClientRect()
      if (!box || trigger.current?.matches(':disabled')) { setOpen(false); return }
      const width = Math.min(440, window.innerWidth - 24), below = window.innerHeight - box.bottom - 12, above = box.top - 12
      const upwards = below < 260 && above > below
      setPosition({ width, left: Math.max(12, Math.min(box.left, window.innerWidth - width - 12)),
        ...(upwards ? { bottom: window.innerHeight - box.top + 6 } : { top: box.bottom + 6 }),
        maxHeight: Math.max(120, Math.min(500, upwards ? above : below)) })
    }
    place(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open])
  const choose = (resourceId: string) => {
    // A portal does not inherit a disabled parent fieldset. Preserve its gate.
    if (resourceId !== value && !trigger.current?.matches(':disabled')) onChange(resourceId)
    setOpen(false); trigger.current?.focus({ preventScroll: true })
  }
  const name = selected?.resource.name || resource?.name || (value ? 'Unavailable resource' : 'Choose input resource')
  const source = selected?.sourceKind === 'external' ? selected.externalLabel : selected?.path[selected.path.length - 1]?.label
  return <div className="min-w-0 text-xs text-slate-600">
    <span className="block">{label}</span>
    <button ref={trigger} type="button" aria-label={label} aria-describedby={`${id}-selected`}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? `${id}-picker` : undefined}
      title={selected?.label || resource?.name || name}
      onClick={() => {
        if (open) setOpen(false)
        else { setPath(defaultPath ?? rootPath); setExternal(false); setExternalId(''); setOpen(true) }
      }}
      className="mt-1 flex w-full items-center justify-between gap-2 rounded border border-slate-300 bg-white px-2 py-1.5 text-left text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">
      <span id={`${id}-selected`} className="min-w-0 [overflow-wrap:anywhere]"><span className="block font-medium text-slate-800">{name}</span>
        {source && <span className="mt-0.5 block text-[11px] text-slate-500">{source}</span>}
        {!selected && value && <span className="mt-0.5 block text-[11px] text-slate-500">Source unavailable</span>}</span>
      <ChevronDown size={14} className="shrink-0" aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={panel} id={`${id}-picker`} role="dialog" aria-label="Choose input resource"
      style={position} className="fixed z-[1000] overflow-y-auto rounded-xl border border-slate-300 bg-white p-2 shadow-xl"
      onKeyDown={event => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        const buttons = [...panel.current?.querySelectorAll<HTMLButtonElement>('[data-picker-choice]:not(:disabled)') ?? []]
        if (!buttons.length) return
        event.preventDefault()
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : event.key === 'ArrowDown' ? (index + 1) % buttons.length : (index - 1 + buttons.length) % buttons.length
        buttons[next].focus()
      }}>
      <div className="flex items-center justify-between gap-3 px-2 py-1">
        <span className="text-xs font-semibold text-slate-800">Choose input resource</span>
        <button type="button" aria-label="Close input selection" onClick={() => { setOpen(false); trigger.current?.focus() }}
          className="rounded p-1 text-slate-600 hover:bg-slate-100"><X size={14} /></button>
      </div>
      <nav aria-label="Input source location" className="mb-2 flex flex-wrap items-center gap-1 border-b border-slate-100 px-2 pb-2 text-xs text-slate-600">
        <button type="button" onClick={reset} className="rounded py-1 text-blue-800 underline underline-offset-2">{rootPath[0]?.label || 'System'}</button>
        {external ? <><span aria-hidden="true">›</span><button type="button" onClick={() => setExternalId('')} className="rounded py-1 text-blue-800 underline underline-offset-2">External sources</button>
          {externalId && <><span aria-hidden="true">›</span><span>{currentExternal}</span></>}</>
          : path.slice(rootPath.length).map((part, index) => <span key={part.id} className="inline-flex items-center gap-1"><span aria-hidden="true">›</span>
            <button type="button" onClick={() => setPath(path.slice(0, rootPath.length + index + 1))} className="rounded py-1 text-blue-800 underline underline-offset-2">{part.label}</button></span>)}
      </nav>
      {(external || path.length > rootPath.length) && <button type="button" className="mb-1 rounded px-3 py-1 text-xs text-blue-800 hover:bg-blue-50"
        onClick={() => external ? externalId ? setExternalId('') : reset() : setPath(path.slice(0, -1))}>Back</button>}
      {childRows.length > 0 && <ul aria-label={external ? 'External sources' : 'System blocks'}>{childRows.map(child => <li key={child.id}>
        <button data-picker-choice type="button" className={choiceStyle} onClick={() => external ? setExternalId(child.id) : setPath([...path, child])}>
          <span className="min-w-0 [overflow-wrap:anywhere]">{shortLabel(child)}</span><ChevronRight size={14} className="shrink-0" aria-hidden="true" /></button>
      </li>)}</ul>}
      {!external && path.length === rootPath.length && externals.length > 0 && <button data-picker-choice type="button" className={choiceStyle}
        onClick={() => { setExternal(true); setExternalId('') }}><span>External sources</span><ChevronRight size={14} aria-hidden="true" /></button>}
      {localOutputs.length > 0 && <section aria-label="Function outputs" className={childRows.length ? 'mt-2 border-t border-slate-100 pt-2' : ''}>
        <h4 className="px-3 py-1 text-[11px] font-medium text-slate-500">{external ? 'Available resources' : 'Function outputs'}</h4>
        <ul>{localOutputs.map(option => <li key={option.resource.id}>
          <button data-picker-choice type="button" aria-label={`Use ${outputLabel(option)}`} title={option.label}
            className={choiceStyle} onClick={() => choose(option.resource.id)}>
            <span className="min-w-0 [overflow-wrap:anywhere]"><span className="block font-medium text-slate-800">{outputLabel(option)}</span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-600">{option.functionLabel}</span></span>
            {option.resource.id === value && <span className="text-[11px] text-blue-800">Selected</span>}
          </button>
        </li>)}</ul>
      </section>}
      {!childRows.length && !localOutputs.length && !(externals.length && !external && path.length === rootPath.length) &&
        <p className="px-3 py-4 text-xs text-slate-600">No available function outputs at this level.</p>}
    </div>, document.body)}
  </div>
}
