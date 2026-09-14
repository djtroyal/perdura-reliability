import { useState, useMemo } from 'react'

interface Column {
  key: string
  label: string
  format?: (v: unknown) => string
}

interface Props {
  columns: Column[]
  rows: Record<string, unknown>[]
  highlightFirst?: boolean
  onRowClick?: (row: Record<string, unknown>) => void
  selectedRow?: string
  rowKey?: string
  sortable?: boolean
  rowClassName?: (row: Record<string, unknown>) => string
  rowTitle?: (row: Record<string, unknown>) => string | undefined
}

const fmt = (v: unknown): string => {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number') return isFinite(v) ? v.toPrecision(5) : '∞'
  return String(v)
}

function compare(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (typeof a === 'number' && typeof b === 'number') {
    if (!isFinite(a) && !isFinite(b)) return 0
    if (!isFinite(a)) return 1
    if (!isFinite(b)) return -1
    return a - b
  }
  return String(a).localeCompare(String(b))
}

export default function ResultsTable({
  columns, rows, highlightFirst = true, onRowClick, selectedRow, rowKey,
  sortable = false, rowClassName, rowTitle,
}: Props) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortAsc, setSortAsc] = useState(true)

  const sorted = useMemo(() => {
    if (!sortable || !sortKey) return rows
    const col = sortKey
    const dir = sortAsc ? 1 : -1
    return [...rows].sort((a, b) => dir * compare(a[col], b[col]))
  }, [rows, sortKey, sortAsc, sortable])

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      if (!sortAsc) { setSortKey(null); setSortAsc(true) } // 3rd click resets
      else setSortAsc(false)
    } else {
      setSortKey(key); setSortAsc(true)
    }
  }

  if (!rows.length) return null

  return (
    <div className="overflow-x-auto rounded border border-gray-200">
      <table className="perdura-data-table w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            {columns.map(col => (
              <th
                key={col.key}
                scope="col"
                aria-sort={sortable ? (sortKey === col.key ? (sortAsc ? 'ascending' : 'descending') : 'none') : undefined}
                className={`px-3 py-2 text-left font-medium text-gray-600 whitespace-nowrap select-none ${
                  sortable ? 'cursor-pointer hover:text-blue-600' : ''
                }`}
              >
                {sortable ? <button type="button" className="perdura-sort-button" aria-label={`Sort by ${col.label}`} onClick={() => toggleSort(col.key)}>
                  {col.label}{sortKey === col.key && <span className="ml-1" aria-hidden="true">{sortAsc ? '▲' : '▼'}</span>}
                </button> : col.label}
              </th>
            ))}
            {onRowClick && <th scope="col" className="px-3 py-2 text-left">Selection</th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => {
            const key = rowKey ? String(row[rowKey]) : String(i)
            const isSelected = selectedRow === key
            const isFirst = highlightFirst && i === 0 && !sortKey
            const customClass = rowClassName?.(row)
            return (
              <tr
                key={key}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                title={rowTitle?.(row)}
                className={`border-b border-gray-100 last:border-0 transition-colors ${
                  customClass || (isSelected ? 'bg-blue-50' :
                  isFirst ? 'bg-green-50' : 'bg-white')
                } ${onRowClick ? 'cursor-pointer hover:bg-gray-50' : ''}`}
              >
                {columns.map(col => (
                  <td key={col.key} className="px-3 py-2 text-gray-800 whitespace-nowrap">
                    {col.format ? col.format(row[col.key]) : fmt(row[col.key])}
                  </td>
                ))}
                {onRowClick && <td className="px-3 py-2">
                  <button type="button" aria-pressed={isSelected}
                    aria-label={`Select ${String(row[rowKey ?? columns[0]?.key] ?? `row ${i + 1}`)}`}
                    className="secondary-button" onClick={event => { event.stopPropagation(); onRowClick(row) }}>
                    {isSelected ? 'Selected' : 'Select'}
                  </button>
                </td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
