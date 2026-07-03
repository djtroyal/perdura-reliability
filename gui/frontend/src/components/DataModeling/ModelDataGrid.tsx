import { useRef, useState, useMemo, useCallback, useEffect, memo } from 'react'
import { Trash2, Plus, X } from 'lucide-react'

export type GridRow = Record<string, string>

// Windowing kicks in above this row count; below it every row renders (keeps
// small grids simple and the DOM identical to before).
const VIRTUALIZE_THRESHOLD = 150
const OVERSCAN = 12

/**
 * One body row, memoized so a keystroke in one cell doesn't re-render the
 * other rows: `setCell` replaces only the edited row object, all other rows
 * keep their identity, and the callbacks are ref-stable.
 */
const BodyRow = memo(function BodyRow({ r, row, columns, setCell, onKeyDown, onPaste, removeRow }: {
  r: number
  row: GridRow
  columns: string[]
  setCell: (r: number, key: string, value: string) => void
  onKeyDown: (e: React.KeyboardEvent, r: number, c: number) => void
  onPaste: (e: React.ClipboardEvent, r: number, c: number) => void
  removeRow: (r: number) => void
}) {
  return (
    <tr data-body-row className="border-t border-gray-100 group">
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
  )
})

/**
 * Spreadsheet-style data grid with editable column headers, add/remove of
 * both rows and columns, and tab/enter navigation + multi-cell paste. State
 * (columns + rows) lives in the parent. Bodies beyond ~150 rows are
 * windowed: only the visible slice (plus overscan) is mounted.
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
  const scrollRef = useRef<HTMLDivElement>(null)
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc' | null>(null)

  // Latest props behind refs so the row callbacks stay identity-stable
  // (otherwise they would invalidate every memoized row on each render).
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const columnsRef = useRef(columns)
  columnsRef.current = columns
  const onRowsChangeRef = useRef(onRowsChange)
  onRowsChangeRef.current = onRowsChange

  const toggleSort = (col: string) => {
    if (sortCol !== col) { setSortCol(col); setSortDir('asc') }
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

  const emptyRow = useCallback((cols?: string[]): GridRow =>
    Object.fromEntries((cols ?? columnsRef.current).map(c => [c, ''])), [])

  const setCell = useCallback((r: number, key: string, value: string) =>
    onRowsChangeRef.current(
      rowsRef.current.map((row, i) => (i === r ? { ...row, [key]: value } : row))), [])

  const addRow = useCallback(() =>
    onRowsChangeRef.current([...rowsRef.current, Object.fromEntries(columnsRef.current.map(c => [c, '']))]), [])
  const removeRow = useCallback((r: number) =>
    onRowsChangeRef.current(
      rowsRef.current.length <= 1
        ? [Object.fromEntries(columnsRef.current.map(c => [c, '']))]
        : rowsRef.current.filter((_, i) => i !== r)), [])

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

  const onKeyDown = useCallback((e: React.KeyboardEvent, r: number, c: number) => {
    const lastCol = c === columnsRef.current.length - 1
    const lastRow = r === rowsRef.current.length - 1
    if (e.key === 'Tab' && !e.shiftKey && lastCol && lastRow) {
      e.preventDefault(); addRow(); focusCell(r + 1, 0)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (lastRow) addRow()
      focusCell(r + 1, c)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onPaste = useCallback((e: React.ClipboardEvent, startR: number, startC: number) => {
    const text = e.clipboardData.getData('text/plain')
    if (!text || (!text.includes('\n') && !text.includes('\t') && !text.includes(','))) return
    e.preventDefault()
    const columnsNow = columnsRef.current
    const lines = text.replace(/\r/g, '').split('\n').filter(l => l.length > 0)
    const matrix = lines.map(l => l.split(l.includes('\t') ? '\t' : ',').map(s => s.trim()))
    const next = rowsRef.current.map(row => ({ ...row }))
    matrix.forEach((cells, ri) => {
      const r = startR + ri
      while (next.length <= r) next.push(Object.fromEntries(columnsNow.map(c => [c, ''])))
      cells.forEach((val, ci) => {
        const col = columnsNow[startC + ci]
        if (col) next[r][col] = val
      })
    })
    onRowsChangeRef.current(next)
  }, [])

  // --- Windowing state (active only for large grids) ---
  const virtual = sortedIndices.length > VIRTUALIZE_THRESHOLD
  const [scrollTop, setScrollTop] = useState(0)
  const [viewH, setViewH] = useState(400)
  const [rowH, setRowH] = useState(25)
  useEffect(() => {
    if (!virtual) return
    const el = scrollRef.current
    if (el) setViewH(el.clientHeight || 400)
    const tr = el?.querySelector<HTMLTableRowElement>('tbody tr[data-body-row]')
    const h = tr?.getBoundingClientRect().height
    if (h && h > 5 && Math.abs(h - rowH) > 0.5) setRowH(h)
  }, [virtual, sortedIndices.length, rowH])

  const start = virtual ? Math.max(0, Math.floor(scrollTop / rowH) - OVERSCAN) : 0
  const end = virtual
    ? Math.min(sortedIndices.length, Math.ceil((scrollTop + viewH) / rowH) + OVERSCAN)
    : sortedIndices.length
  const padTop = start * rowH
  const padBottom = (sortedIndices.length - end) * rowH
  const visible = sortedIndices.slice(start, end)
  const nCols = columns.length + 2

  return (
    <div ref={ref} className="border border-gray-200 rounded-lg overflow-hidden">
      <div ref={scrollRef} className="overflow-auto" style={{ maxHeight: maxBodyHeight }}
        onScroll={virtual ? (e => setScrollTop((e.target as HTMLElement).scrollTop)) : undefined}>
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
                    <button tabIndex={-1} onClick={() => toggleSort(col)} title="Sort column"
                      className="text-gray-400 hover:text-blue-600 flex-shrink-0 text-[10px] leading-none px-0.5">
                      {sortCol === col ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                    </button>
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
            {padTop > 0 && <tr style={{ height: padTop }}><td colSpan={nCols} /></tr>}
            {visible.map(r => (
              <BodyRow key={r} r={r} row={rows[r]} columns={columns}
                setCell={setCell} onKeyDown={onKeyDown} onPaste={onPaste} removeRow={removeRow} />
            ))}
            {padBottom > 0 && <tr style={{ height: padBottom }}><td colSpan={nCols} /></tr>}
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
