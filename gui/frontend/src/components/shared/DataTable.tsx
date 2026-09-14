import { useRef, useState, useMemo } from 'react'
import { Trash2 } from 'lucide-react'

export interface DataColumn {
  key: string
  label: string
  type?: 'number' | 'text' | 'select'
  options?: { value: string; label: string }[]
  width?: string
  placeholder?: string
}

/**
 * Generic spreadsheet-style data entry table (#10). Harmonizes data entry
 * across modules: Tab leaves the final cell normally; Enter appends a row,
 * multi-cell paste fills downward/rightward from the focused cell, and rows
 * can be added/removed. State lives in the parent (`rows` + `onChange`).
 */
export default function DataTable({
  columns, rows, onChange, minRows = 1, showRowNumbers = true, maxBodyHeight = '40vh',
}: {
  columns: DataColumn[]
  rows: Record<string, string>[]
  onChange: (rows: Record<string, string>[]) => void
  minRows?: number
  showRowNumbers?: boolean
  maxBodyHeight?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc' | null>(null)

  const toggleSort = (key: string) => {
    if (sortCol !== key) { setSortCol(key); setSortDir('asc') }
    else if (sortDir === 'asc') setSortDir('desc')
    else { setSortCol(null); setSortDir(null) }
  }

  const sortedIndices = useMemo(() => {
    const indices = rows.map((_, i) => i)
    if (!sortCol || !sortDir) return indices
    return indices.sort((a, b) => {
      const va = rows[a][sortCol] ?? ''
      const vb = rows[b][sortCol] ?? ''
      const na = parseFloat(va), nb = parseFloat(vb)
      const cmp = (!isNaN(na) && !isNaN(nb)) ? na - nb : va.localeCompare(vb)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rows, sortCol, sortDir])

  const emptyRow = (): Record<string, string> =>
    Object.fromEntries(columns.map(c => [c.key, '']))

  const setCell = (r: number, key: string, value: string) => {
    const next = rows.map((row, i) => i === r ? { ...row, [key]: value } : row)
    onChange(next)
  }

  const addRow = () => onChange([...rows, emptyRow()])

  const removeRow = (r: number) => {
    if (rows.length <= minRows) { onChange(rows.map((row, i) => i === r ? emptyRow() : row)); return }
    onChange(rows.filter((_, i) => i !== r))
  }

  const focusCell = (r: number, c: number) => {
    setTimeout(() => {
      ref.current?.querySelector<HTMLInputElement | HTMLSelectElement>(
        `[data-r="${r}"][data-c="${c}"]`)?.focus()
    }, 0)
  }

  const onKeyDown = (e: React.KeyboardEvent, r: number, c: number) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const position = sortedIndices.indexOf(r)
      const nextRow = sortedIndices[position + 1]
      if (nextRow === undefined) addRow()
      focusCell(nextRow ?? rows.length, c)
    }
  }

  const onPaste = (e: React.ClipboardEvent, startR: number, startC: number) => {
    const text = e.clipboardData.getData('text/plain')
    if (!text || (!text.includes('\n') && !text.includes('\t') && !text.includes(','))) return
    e.preventDefault()
    const lines = text.replace(/\r/g, '').split('\n').filter(l => l.length > 0)
    const matrix = lines.map(l => l.split(l.includes('\t') ? '\t' : ',').map(s => s.trim()))
    const next = [...rows.map(row => ({ ...row }))]
    matrix.forEach((cells, ri) => {
      const r = startR + ri
      while (next.length <= r) next.push(emptyRow())
      cells.forEach((val, ci) => {
        const col = columns[startC + ci]
        if (col) next[r][col.key] = val
      })
    })
    onChange(next)
  }

  return (
    <div ref={ref} className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="overflow-y-auto" style={{ maxHeight: maxBodyHeight }}>
        <table className="perdura-data-table w-full text-xs">
          <caption className="sr-only">Editable data. Tab moves between controls. Enter moves down or adds a row at the end. Use Add row to append data.</caption>
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr>
              {showRowNumbers && <th className="px-2 py-1.5 text-left font-medium text-gray-400 w-8">#</th>}
              {columns.map(col => (
                <th key={col.key} scope="col" aria-sort={sortCol === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className="px-2 py-1.5 text-left font-medium text-gray-600" style={{ width: col.width }}>
                  <button type="button" className="perdura-sort-button" onClick={() => toggleSort(col.key)} aria-label={`Sort by ${col.label}`}>
                    {col.label} <span aria-hidden="true">{sortCol === col.key ? (sortDir === 'asc' ? '▲' : '▼') : ''}</span>
                  </button>
                </th>
              ))}
              <th scope="col" className="w-7"><span className="sr-only">Row actions</span></th>
            </tr>
          </thead>
          <tbody>
            {sortedIndices.map(r => {
              const row = rows[r]
              return (
              <tr key={r} className="border-t border-gray-100 group">
                {showRowNumbers && <td className="px-2 py-0.5 text-gray-300 tabular-nums">{r + 1}</td>}
                {columns.map((col, c) => (
                  <td key={col.key} className="px-1 py-0.5">
                    {col.type === 'select' ? (
                      <select data-r={r} data-c={c} aria-label={`${col.label}, row ${r + 1}`}
                        value={row[col.key] ?? ''}
                        onChange={e => setCell(r, col.key, e.target.value)}
                        onKeyDown={e => onKeyDown(e, r, c)}
                        className="w-full text-xs px-1 py-0.5 border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded">
                        {(col.options ?? []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : (
                      <input data-r={r} data-c={c} aria-label={`${col.label}, row ${r + 1}`}
                        type="text"
                        inputMode={col.type === 'number' ? 'decimal' : 'text'}
                        value={row[col.key] ?? ''}
                        placeholder={col.placeholder}
                        onChange={e => setCell(r, col.key, e.target.value)}
                        onKeyDown={e => onKeyDown(e, r, c)}
                        onPaste={e => onPaste(e, r, c)}
                        className="w-full text-xs px-1 py-0.5 border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded font-mono" />
                    )}
                  </td>
                ))}
                <td className="px-1 py-0.5 text-center">
                  <button type="button" onClick={() => {
                    removeRow(r)
                    focusCell(rows.length <= minRows ? r : Math.max(0, Math.min(r, rows.length - 2)), 0)
                  }} aria-label={`${rows.length <= minRows ? 'Clear' : 'Delete'} row ${r + 1}`}
                    className="perdura-icon-button text-gray-600 hover:text-red-700">
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <button type="button" onClick={() => { addRow(); focusCell(rows.length, 0) }}
        className="w-full text-[11px] text-gray-500 hover:text-blue-600 hover:bg-blue-50 py-1 border-t border-gray-100 transition-colors">
        + Add row
      </button>
    </div>
  )
}
