import { useRef } from 'react'
import { Trash2, Plus, X } from 'lucide-react'

export type GridRow = Record<string, string>

/**
 * Spreadsheet-style data grid with editable column headers, add/remove of
 * both rows and columns, and tab/enter navigation + multi-cell paste. State
 * (columns + rows) lives in the parent.
 */
export default function ModelDataGrid({
  columns, rows, onColumnsChange, onRowsChange, maxBodyHeight = '34vh',
}: {
  columns: string[]
  rows: GridRow[]
  onColumnsChange: (cols: string[], rows: GridRow[]) => void
  onRowsChange: (rows: GridRow[]) => void
  maxBodyHeight?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const emptyRow = (cols = columns): GridRow => Object.fromEntries(cols.map(c => [c, '']))

  const setCell = (r: number, key: string, value: string) =>
    onRowsChange(rows.map((row, i) => (i === r ? { ...row, [key]: value } : row)))

  const addRow = () => onRowsChange([...rows, emptyRow()])
  const removeRow = (r: number) =>
    onRowsChange(rows.length <= 1 ? [emptyRow()] : rows.filter((_, i) => i !== r))

  const uniqueName = (base: string) => {
    let name = base
    let k = 1
    while (columns.includes(name)) { name = `${base}${k}`; k += 1 }
    return name
  }

  const addColumn = () => {
    const name = uniqueName(`x${columns.length + 1}`)
    const cols = [...columns, name]
    onColumnsChange(cols, rows.map(r => ({ ...r, [name]: '' })))
  }

  const removeColumn = (col: string) => {
    if (columns.length <= 1) return
    const cols = columns.filter(c => c !== col)
    onColumnsChange(cols, rows.map(r => {
      const { [col]: _drop, ...rest } = r
      return rest
    }))
  }

  const renameColumn = (oldName: string, raw: string) => {
    const next = raw.trim()
    if (next === '' || next === oldName) return
    if (columns.includes(next)) return // keep names unique
    const cols = columns.map(c => (c === oldName ? next : c))
    onColumnsChange(cols, rows.map(r => {
      const { [oldName]: val, ...rest } = r
      return { ...rest, [next]: val ?? '' }
    }))
  }

  const focusCell = (r: number, c: number) => {
    setTimeout(() => {
      ref.current?.querySelector<HTMLInputElement>(`[data-r="${r}"][data-c="${c}"]`)?.focus()
    }, 0)
  }

  const onKeyDown = (e: React.KeyboardEvent, r: number, c: number) => {
    const lastCol = c === columns.length - 1
    const lastRow = r === rows.length - 1
    if (e.key === 'Tab' && !e.shiftKey && lastCol && lastRow) {
      e.preventDefault(); addRow(); focusCell(r + 1, 0)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (lastRow) addRow()
      focusCell(r + 1, c)
    }
  }

  const onPaste = (e: React.ClipboardEvent, startR: number, startC: number) => {
    const text = e.clipboardData.getData('text/plain')
    if (!text || (!text.includes('\n') && !text.includes('\t') && !text.includes(','))) return
    e.preventDefault()
    const lines = text.replace(/\r/g, '').split('\n').filter(l => l.length > 0)
    const matrix = lines.map(l => l.split(l.includes('\t') ? '\t' : ',').map(s => s.trim()))
    const next = rows.map(row => ({ ...row }))
    matrix.forEach((cells, ri) => {
      const r = startR + ri
      while (next.length <= r) next.push(emptyRow())
      cells.forEach((val, ci) => {
        const col = columns[startC + ci]
        if (col) next[r][col] = val
      })
    })
    onRowsChange(next)
  }

  return (
    <div ref={ref} className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="overflow-auto" style={{ maxHeight: maxBodyHeight }}>
        <table className="text-xs">
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr>
              <th className="px-1.5 py-1 text-left font-medium text-gray-400 w-7">#</th>
              {columns.map(col => (
                <th key={col} className="px-1 py-1 font-medium text-gray-500" style={{ minWidth: 72 }}>
                  <div className="flex items-center gap-0.5">
                    <input
                      defaultValue={col}
                      key={col}
                      onBlur={e => renameColumn(col, e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                      className="w-full min-w-0 text-xs font-semibold text-gray-700 bg-transparent px-1 py-0.5 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                      title="Rename column"
                    />
                    {columns.length > 1 && (
                      <button tabIndex={-1} onClick={() => removeColumn(col)} title="Remove column"
                        className="text-gray-300 hover:text-red-500 flex-shrink-0">
                        <X size={11} />
                      </button>
                    )}
                  </div>
                </th>
              ))}
              <th className="w-7 px-0.5">
                <button onClick={addColumn} title="Add column"
                  className="text-gray-400 hover:text-blue-600">
                  <Plus size={13} />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className="border-t border-gray-100 group">
                <td className="px-1.5 py-0.5 text-gray-300 tabular-nums">{r + 1}</td>
                {columns.map((col, c) => (
                  <td key={col} className="px-0.5 py-0.5">
                    <input
                      data-r={r} data-c={c} type="text" inputMode="text"
                      value={row[col] ?? ''}
                      onChange={e => setCell(r, col, e.target.value)}
                      onKeyDown={e => onKeyDown(e, r, c)}
                      onPaste={e => onPaste(e, r, c)}
                      className="w-full text-xs px-1 py-0.5 border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded font-mono"
                      style={{ minWidth: 64 }}
                    />
                  </td>
                ))}
                <td className="px-0.5 text-center">
                  <button tabIndex={-1} onClick={() => removeRow(r)}
                    className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100">
                    <Trash2 size={11} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={addRow}
        className="w-full text-[11px] text-gray-500 hover:text-blue-600 hover:bg-blue-50 py-1 border-t border-gray-100 transition-colors">
        + Add row
      </button>
    </div>
  )
}
