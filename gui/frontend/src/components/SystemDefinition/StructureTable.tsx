import { Box, ChevronDown, ChevronRight } from 'lucide-react'
import type { SystemDefinitionModel, SystemBlockInstance } from '../../api/systemDefinition'
import { instanceLabel } from './model'

const typeLabel = (value: string) => value.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase())

export default function StructureTable({
  model, selectedId, collapsedIds, onSelect, onToggle, onChangeParent,
}: {
  model: SystemDefinitionModel
  selectedId: string
  collapsedIds: string[]
  onSelect: (id: string) => void
  onToggle: (id: string) => void
  onChangeParent: (id: string, parentId?: string) => void
}) {
  const byParent = new Map<string, SystemBlockInstance[]>()
  const known = new Set(model.instances.map(item => item.id))
  for (const item of model.instances) {
    const parent = item.parent_instance_id && known.has(item.parent_instance_id)
      ? item.parent_instance_id : ''
    byParent.set(parent, [...(byParent.get(parent) ?? []), item])
  }
  const collapsed = new Set(collapsedIds)
  const rows: { instance: SystemBlockInstance; depth: number }[] = []
  const visited = new Set<string>()
  const visit = (instance: SystemBlockInstance, depth: number, hidden = false) => {
    if (visited.has(instance.id)) return
    visited.add(instance.id)
    if (!hidden) rows.push({ instance, depth })
    for (const child of byParent.get(instance.id) ?? []) visit(child, depth + 1, hidden || collapsed.has(instance.id))
  }
  for (const root of byParent.get('') ?? []) visit(root, 0)
  for (const item of model.instances) if (!visited.has(item.id)) visit(item, 0)
  const descendants = (id: string, found = new Set<string>()): Set<string> => {
    for (const child of byParent.get(id) ?? []) {
      if (!found.has(child.id)) { found.add(child.id); descendants(child.id, found) }
    }
    return found
  }
  return <div className="overflow-x-auto rounded border border-slate-200">
    <table className="perdura-data-table w-full min-w-[45rem] text-left text-xs">
      <caption className="sr-only">System hierarchy. Expand or collapse assemblies, select an element to edit, or change its parent.</caption>
      <thead className="bg-slate-100 text-slate-600"><tr>
        {['System element', 'Kind', 'Qty', 'Part number', 'Parent'].map(label => <th key={label} scope="col">{label}</th>)}
      </tr></thead>
      <tbody>{rows.map(({ instance, depth }) => {
        const definition = model.definitions.find(item => item.id === instance.definition_id)
        const childCount = byParent.get(instance.id)?.length ?? 0
        const excluded = descendants(instance.id).add(instance.id)
        const label = instanceLabel(model, instance)
        return <tr key={instance.id} className={`border-b last:border-b-0 ${selectedId === instance.id ? 'bg-blue-50' : 'bg-white hover:bg-slate-50'}`}>
          <th scope="row" className="font-normal">
            <div className="flex items-center gap-1" style={{ paddingLeft: depth * 22 }}>
              {childCount > 0 ? <button type="button" className="perdura-icon-button text-slate-600"
                aria-label={`${collapsed.has(instance.id) ? 'Expand' : 'Collapse'} ${label}`}
                aria-expanded={!collapsed.has(instance.id)} onClick={() => onToggle(instance.id)}>
                {collapsed.has(instance.id) ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
              </button> : <span className="w-6" aria-hidden="true" />}
              <Box size={14} aria-hidden="true" className={definition?.kind === 'piece_part' ? 'text-amber-700' : 'text-blue-700'} />
              <button type="button" className="py-1 text-left font-medium" onClick={() => onSelect(instance.id)}
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
          <td><select value={instance.parent_instance_id ?? ''} aria-label={`Parent of ${label}`}
            onChange={event => onChangeParent(instance.id, event.target.value || undefined)} className="field">
            <option value="">Top level</option>
            {model.instances.filter(item => !excluded.has(item.id)).map(item => <option key={item.id} value={item.id}>{instanceLabel(model, item)}</option>)}
          </select></td>
        </tr>
      })}</tbody>
    </table>
    {!rows.length && <p className="p-8 text-center text-xs text-slate-600">Add a top-level system block to begin.</p>}
  </div>
}
