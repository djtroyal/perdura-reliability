import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { DataRow } from './DataGridRow'

interface EntryColumn {
  key: string
  label: string
  inputLabel?: string
  placeholder?: string
  inputMode?: 'text' | 'decimal' | 'numeric'
  kind?: 'state'
  align?: 'right'
}
interface EntryRow { key: string; id: string }
interface EntryGridProps<T extends EntryRow> {
  rows: T[]
  columns: EntryColumn[]
  expanded?: boolean
  caption: string
  onChange: (rows: T[]) => void
  newRow: () => T
  hasContent: (row: T) => boolean
}
const inputClass = 'min-h-8 w-full rounded border-0 bg-transparent px-1.5 py-1 font-mono text-xs text-slate-800 outline-hidden focus:ring-2 focus:ring-inset focus:ring-blue-500'

const EditableRow = memo(function EditableRow({ row, index, placeholder, columns, onUpdate, onRemove, onEnter, onActivate }: {
  row: EntryRow
  index: number
  placeholder: boolean
  columns: EntryColumn[]
  onUpdate: (key: string, field: string, value: string) => void
  onRemove: (key: string) => void
  onEnter: (key: string, column: string) => void
  onActivate: (key: string | null) => void
}) {
  const values = row as unknown as Record<string, string>
  const rowLabel = placeholder ? 'new row' : `row ${index + 1}`
  return <tr data-entry-key={row.key} data-placeholder={placeholder || undefined}
    onFocusCapture={() => onActivate(row.key)}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onActivate(null) }}
    className={`group border-t border-slate-100 ${placeholder ? 'bg-blue-50/40' : ''}`}>
    {columns.map(column => <td key={column.key} className={`px-1 py-0.5 ${column.kind === 'state' ? 'w-20 text-center' : column.key === 'id' || column.key === 'count' ? 'w-20' : ''}`}>
      {column.kind === 'state' ? <button type="button"
        aria-label={`${placeholder ? 'New row' : `Row ${index + 1}`}: ${values[column.key] === 'F' ? 'Fail (failure); change to suspension' : 'Susp (right-censored); change to failure'}`}
        onClick={() => onUpdate(row.key, column.key, values[column.key] === 'F' ? 'S' : 'F')}
        className={`min-h-8 rounded px-2 py-1 text-xs font-semibold ${values[column.key] === 'F' ? 'bg-red-100 text-red-800 hover:bg-red-200' : 'bg-amber-100 text-amber-900 hover:bg-amber-200'}`}>
        {values[column.key] === 'F' ? 'Fail' : 'Susp'}
      </button> : <input type="text" value={values[column.key] ?? ''}
        aria-label={`${column.inputLabel ?? column.label}, ${rowLabel}`}
        data-row={index} data-col={column.key} inputMode={column.inputMode ?? 'text'}
        onChange={event => onUpdate(row.key, column.key, event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); onEnter(row.key, column.key) }
        }}
        className={`${inputClass} ${column.align === 'right' ? 'text-right' : ''}`}
        placeholder={column.placeholder ?? ''} />}
    </td>)}
    <td className="w-9 px-0.5 text-center">
      {placeholder ? <span className="sr-only">New observation; enter a value to add it.</span>
        : <button type="button" aria-label={`Delete row ${index + 1}`} onClick={() => onRemove(row.key)}
          className="perdura-icon-button text-slate-600 hover:text-red-700"><Trash2 size={14} aria-hidden="true" /></button>}
    </td>
  </tr>
})

/** Virtual final row: mounting, navigating, and sorting never add observations. */
export function ObservationEntryGrid<T extends EntryRow>(props: EntryGridProps<T>) {
  const [placeholder, setPlaceholder] = useState<T>(props.newRow)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null)
  const table = useRef<HTMLTableElement>(null)
  const visible = useMemo(() => {
    const rows = props.rows.map((row, index) => ({ row, index }))
      .filter(({ row }) => row.key === activeKey || props.hasContent(row))
    if (sort) rows.sort((a, b) => {
      const left = String((a.row as unknown as Record<string, string>)[sort.key] ?? '')
      const right = String((b.row as unknown as Record<string, string>)[sort.key] ?? '')
      const leftNumber = Number(left), rightNumber = Number(right)
      const result = left.trim() && right.trim() && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
        ? leftNumber - rightNumber : left.localeCompare(right)
      return (sort.direction === 'asc' ? result : -result) || a.index - b.index
    })
    return rows
  }, [props.rows, props.hasContent, activeKey, sort])
  const current = useRef({ props, placeholder, visible })
  current.current = { props, placeholder, visible }
  const focusCell = useCallback((key: string, column: string) => {
    // Target rows (including the virtual row) already exist. Delaying focus
    // can steal it back after a subsequent Tab or click elsewhere.
    const row = Array.from(table.current?.querySelectorAll<HTMLTableRowElement>('tr[data-entry-key]') ?? [])
      .find(element => element.dataset.entryKey === key)
    const cell = Array.from(row?.querySelectorAll<HTMLInputElement>('input[data-col]') ?? [])
      .find(element => element.dataset.col === column)
    cell?.focus()
  }, [])
  const update = useCallback((key: string, field: string, value: string) => {
    const { props: settings, placeholder: draft } = current.current
    if (key === draft.key) {
      const next = { ...draft, [field]: value }
      if (settings.hasContent(next)) {
        // Preserve the React key on promotion so typing never replaces the
        // focused input or drops its caret and partially entered value.
        setPlaceholder(settings.newRow())
        settings.onChange([...settings.rows, next])
      } else setPlaceholder(next)
    } else settings.onChange(settings.rows.map(row => row.key === key ? { ...row, [field]: value } : row))
  }, [])
  const remove = useCallback((key: string) => {
    const { props: settings, visible: entries, placeholder: draft } = current.current
    const position = entries.findIndex(({ row }) => row.key === key)
    const next = entries[position + 1]?.row ?? entries[position - 1]?.row ?? draft
    settings.onChange(settings.rows.filter(row => row.key !== key))
    focusCell(next.key, settings.columns.find(column => column.key !== 'id' && column.kind !== 'state')?.key ?? 'id')
  }, [focusCell])
  const enter = useCallback((key: string, column: string) => {
    const { visible: entries, placeholder: draft } = current.current
    const position = entries.findIndex(({ row }) => row.key === key)
    if (position < 0) return
    const next = entries[position + 1]?.row ?? draft
    focusCell(next.key, column)
  }, [focusCell])
  return <div className="overflow-hidden rounded-lg border border-slate-200">
    <div className={props.expanded ? 'max-h-[65vh] overflow-auto' : 'max-h-[25vh] overflow-auto'}>
      <table ref={table} className="perdura-data-table w-full text-xs">
        <caption className="sr-only">{props.caption} Enter moves down to the next observation. Tab moves between controls and leaves the table. The final blank row is ignored until data is entered.</caption>
        <thead className="sticky top-0 z-10 bg-slate-50"><tr>
          {props.columns.map(column => <th key={column.key} scope="col" className={`px-2 py-1.5 font-medium text-slate-600 ${column.align === 'right' ? 'text-right' : column.kind === 'state' ? 'text-center' : 'text-left'}`}
            aria-sort={sort?.key === column.key ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
            <button type="button" className="perdura-sort-button" aria-label={`Sort by ${column.label}`}
              onClick={() => setSort(previous => previous?.key !== column.key ? { key: column.key, direction: 'asc' }
                : previous.direction === 'asc' ? { key: column.key, direction: 'desc' } : null)}>
              {column.label}<span aria-hidden="true">{sort?.key === column.key ? sort.direction === 'asc' ? '▲' : '▼' : ''}</span>
            </button>
          </th>)}
          <th scope="col"><span className="sr-only">Row actions</span></th>
        </tr></thead>
        <tbody>{[...visible.map(entry => ({ ...entry, placeholder: false })), { row: placeholder, index: props.rows.length, placeholder: true }]
          .map(entry => <EditableRow key={entry.row.key} {...entry} columns={props.columns}
            onUpdate={update} onRemove={remove} onEnter={enter} onActivate={setActiveKey} />)}</tbody>
      </table>
    </div>
  </div>
}

const hasIndividualContent = (row: DataRow) => Boolean(row.id.trim() || row.time.trim())

export default function EditableLifeDataTable({ rows, units, expanded, onChange, newRow }: {
  rows: DataRow[]
  units: string
  expanded?: boolean
  onChange: (rows: DataRow[]) => void
  newRow: () => DataRow
}) {
  const columns = useMemo<EntryColumn[]>(() => [
    { key: 'id', label: 'ID', placeholder: '—' },
    { key: 'time', label: `Value (${units})`, inputLabel: `Time (${units})`, inputMode: 'decimal', placeholder: 'Enter value' },
    { key: 'state', label: 'State', kind: 'state' },
  ], [units])
  return <ObservationEntryGrid rows={rows} columns={columns} expanded={expanded} onChange={onChange}
    newRow={newRow} hasContent={hasIndividualContent} caption="Life Data observations." />
}
