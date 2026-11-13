import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Box, ChevronDown, ChevronRight } from 'lucide-react'
import type { SystemDefinitionModel, SystemBlockInstance } from '../../api/systemDefinition'
import { instanceLabel } from './model'
import { systemParentOptions, systemStructureRows } from './structureEditing'

const typeLabel = (value: string) => value.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase())

export default function StructureTable({
  model, selectedId, collapsedIds, onSelect, onToggle, onChangeParent, onMove,
  showPieceParts = false, editing = false,
}: {
  model: SystemDefinitionModel
  selectedId: string
  collapsedIds: string[]
  showPieceParts?: boolean
  editing?: boolean
  onSelect: (id: string) => void
  onToggle: (id: string) => void
  onChangeParent: (id: string, parentId: string) => void
  onMove: (id: string, direction: -1 | 1) => void
}) {
  const focusTargets = useRef(new Map<string, HTMLButtonElement>())
  const pendingFocus = useRef<{ id: string; direction?: -1 | 1 } | null>(null)
  const [announcement, setAnnouncement] = useState('')
  useLayoutEffect(() => {
    const target = pendingFocus.current
    if (target) {
      const moveButton = focusTargets.current.get(`${target.id}:move:${target.direction}`)
      const button = moveButton && !moveButton.disabled ? moveButton : focusTargets.current.get(target.id)
      button?.focus()
    }
    pendingFocus.current = null
  }, [model.instances])
  const definitions = new Map(model.definitions.map(item => [item.id, item]))
  const instances = new Map(model.instances.map(item => [item.id, item]))
  const isVisible = (item: SystemBlockInstance) => showPieceParts || definitions.get(item.definition_id)?.kind !== 'piece_part'
  const byParent = new Map<string, SystemBlockInstance[]>()
  for (const item of model.instances) {
    const parent = item.parent_instance_id && instances.has(item.parent_instance_id)
      ? item.parent_instance_id : ''
    const children = byParent.get(parent) ?? []
    children.push(item)
    byParent.set(parent, children)
  }
  const collapsed = new Set(collapsedIds)
  const rows = systemStructureRows(model).filter(row => isVisible(row.instance)
    && !row.ancestors.some(id => collapsed.has(id)))
  const parentOptions = editing ? systemParentOptions(model, selectedId) : []
  return <div className="overflow-x-auto rounded border border-slate-200">
    <p role="status" className="sr-only">{announcement}</p>
    <table className={`perdura-data-table w-full text-left text-xs ${editing ? 'min-w-[54rem]' : 'min-w-[36rem]'}`}>
      <caption className="sr-only">System hierarchy. {editing
        ? 'Select an element to change its parent, or use Move up and Move down to reorder siblings.'
        : 'Indentation shows parent relationships. Expand or collapse assemblies, or select an element to inspect.'}</caption>
      <thead className="bg-slate-100 text-slate-600"><tr>
        {['System element', 'Kind', 'Qty', 'Part number', ...(editing ? ['Parent', 'Order'] : [])].map(label => <th key={label} scope="col">{label}</th>)}
      </tr></thead>
      <tbody>{rows.map(({ instance, depth }) => {
        const definition = definitions.get(instance.definition_id)
        const childCount = (byParent.get(instance.id) ?? []).filter(isVisible).length
        const siblings = (byParent.get(instance.parent_instance_id ?? '') ?? []).filter(isVisible)
        const siblingIndex = siblings.findIndex(item => item.id === instance.id)
        const isRoot = instance.id === model.root_instance_id
        const parent = instances.get(instance.parent_instance_id ?? '')
        const label = instanceLabel(model, instance)
        return <tr key={instance.id} data-system-instance={instance.id} className={`border-b last:border-b-0 ${selectedId === instance.id ? 'bg-blue-50' : 'bg-white hover:bg-slate-50'}`}>
          <th scope="row" className="font-normal">
            <div className="flex items-center gap-1" style={{ paddingLeft: depth * 22 }}>
              {childCount > 0 ? <button type="button" className="perdura-icon-button text-slate-600"
                aria-label={`${collapsed.has(instance.id) ? 'Expand' : 'Collapse'} ${label}`}
                aria-expanded={!collapsed.has(instance.id)} onClick={() => onToggle(instance.id)}>
                {collapsed.has(instance.id) ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
              </button> : <span className="w-6" aria-hidden="true" />}
              <Box size={14} aria-hidden="true" className={definition?.kind === 'piece_part' ? 'text-amber-700' : 'text-blue-700'} />
              <button type="button" className="py-1 text-left font-medium" onClick={() => onSelect(instance.id)}
                ref={node => { if (node) focusTargets.current.set(instance.id, node); else focusTargets.current.delete(instance.id) }}
                aria-pressed={selectedId === instance.id} aria-label={`Select ${label}, level ${depth + 1}`}>
                {label}{selectedId === instance.id && <span className="sr-only">, selected</span>}
              </button>
              {instance.origin === 'definition_slot' && <span title="Installed from reusable definition" className="rounded bg-violet-100 px-1 text-xs text-violet-800">linked</span>}
              {childCount > 0 && collapsed.has(instance.id) && <span className="text-xs text-slate-600">{childCount} hidden</span>}
            </div>
          </th>
          <td className="capitalize text-slate-600">{typeLabel(definition?.kind ?? definition?.classification ?? 'component')}</td>
          <td className="tabular-nums">{instance.quantity}</td>
          <td className="text-slate-600">{definition?.part_number || '—'}</td>
          {editing && <>
            <td>{isRoot ? <span className="text-slate-500">System root</span>
              : selectedId === instance.id ? <select value={instance.parent_instance_id ?? model.root_instance_id}
                aria-label={`Parent of ${label}`} className="field max-w-72"
                title={instance.origin === 'definition_slot'
                  ? 'Changing the parent detaches this installed element from its reusable composition; its definition and subtree are retained.'
                  : 'Move this element and its subtree under another parent.'}
                onChange={event => { pendingFocus.current = { id: instance.id }; onChangeParent(instance.id, event.target.value) }}>
                {parentOptions.map(row => <option key={row.instance.id} value={row.instance.id}>
                  {[...row.ancestors, row.instance.id].map(id => instanceLabel(model, instances.get(id)!)).join(' › ')}
                  {row.instance.id === model.root_instance_id ? ' (system root)' : ''}
                </option>)}
              </select> : <button type="button" onClick={() => onSelect(instance.id)}
                className="rounded px-2 py-1.5 text-left text-blue-800 hover:bg-blue-50"
                aria-label={`Change parent of ${label}`}>
                {parent ? instanceLabel(model, parent) : '—'}
              </button>}</td>
            <td><div className="flex gap-1">{([-1, 1] as const).map(direction => {
              const word = direction === -1 ? 'up' : 'down'
              const Icon = direction === -1 ? ArrowUp : ArrowDown
              return <button key={direction} type="button" className="perdura-icon-button text-slate-700 disabled:opacity-30"
                ref={node => {
                  const key = `${instance.id}:move:${direction}`
                  if (node) focusTargets.current.set(key, node); else focusTargets.current.delete(key)
                }}
                disabled={isRoot || !siblings[siblingIndex + direction]} aria-label={`Move ${label} ${word}`}
                title={`Move ${word} among visible siblings`}
                onClick={() => {
                  pendingFocus.current = { id: instance.id, direction }
                  onMove(instance.id, direction)
                  setAnnouncement(`${label} moved ${word} among its siblings.`)
                }}><Icon size={15} aria-hidden="true" /></button>
            })}</div></td>
          </>}
        </tr>
      })}</tbody>
    </table>
    {!rows.length && <p className="p-8 text-center text-xs text-slate-600">Add a top-level system block to begin.</p>}
  </div>
}
