import { useRef, useState, useMemo, useCallback, useEffect, useLayoutEffect, memo } from 'react'
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
const BodyRow = memo(function BodyRow({ r, position, row, columns, setCell, onKeyDown, onPaste, removeRow }: {
  r: number
  position: number
  row: GridRow
  columns: string[]
  setCell: (r: number, key: string, value: string) => void
  onKeyDown: (e: React.KeyboardEvent, r: number, c: number) => void
  onPaste: (e: React.ClipboardEvent, r: number, c: number) => void
  removeRow: (r: number) => void
}) {
  return (
    <tr data-body-row aria-rowindex={position + 2} className="border-t border-gray-100 group">
      <td className="px-1.5 py-0.5 text-gray-300 tabular-nums">{r + 1}</td>
      {columns.map((col, c) => (
        <td key={col} className="px-0.5 py-0.5">
          <input
            data-r={r} data-c={c} type="text" inputMode="text"
            aria-label={`${col}, row ${r + 1}`}
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
        <button onClick={() => removeRow(r)} aria-label={`Remove row ${r + 1}`}
          className="perdura-icon-button text-gray-600 hover:text-red-700">
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
  const orderRef = useRef(sortedIndices)
  orderRef.current = sortedIndices
  const pendingFocus = useRef<{ r: number; c: number } | null>(null)
  const [focusRequest, setFocusRequest] = useState(0)
  const focusCell = useCallback((r: number, c: number) => {
    pendingFocus.current = { r, c }
    setFocusRequest(value => value + 1)
  }, [])

  const emptyRow = useCallback((cols?: string[]): GridRow =>
    Object.fromEntries((cols ?? columnsRef.current).map(c => [c, ''])), [])

  const setCell = useCallback((r: number, key: string, value: string) =>
    onRowsChangeRef.current(
      rowsRef.current.map((row, i) => (i === r ? { ...row, [key]: value } : row))), [])

  const addRow = useCallback(() =>
    onRowsChangeRef.current([...rowsRef.current, Object.fromEntries(columnsRef.current.map(c => [c, '']))]), [])
  const removeRow = useCallback((r: number) => {
    const target = Math.max(0, Math.min(r, rowsRef.current.length - 2))
    onRowsChangeRef.current(
      rowsRef.current.length <= 1
        ? [Object.fromEntries(columnsRef.current.map(c => [c, '']))]
        : rowsRef.current.filter((_, i) => i !== r))
    focusCell(target, 0)
  }, [focusCell])

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

  const onKeyDown = useCallback((e: React.KeyboardEvent, r: number, c: number) => {
    // Tab follows native focus order and always permits leaving the grid.
    if (e.key === 'Enter') {
      e.preventDefault()
      const next = orderRef.current[orderRef.current.indexOf(r) + 1]
      const target = next ?? rowsRef.current.length
      if (next === undefined) addRow()
      focusCell(target, c)
    }
  }, [addRow, focusCell])

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
  const start = virtual ? Math.max(0, Math.floor(scrollTop / rowH) - OVERSCAN) : 0
  const end = virtual
    ? Math.min(sortedIndices.length, Math.ceil((scrollTop + viewH) / rowH) + OVERSCAN)
    : sortedIndices.length
  const padTop = start * rowH
  const padBottom = (sortedIndices.length - end) * rowH
  const visible = sortedIndices.slice(start, end)
  const nCols = columns.length + 2
  useEffect(() => {
    if (!virtual) return
    const el = scrollRef.current
    if (!el) return
    const row = el.querySelector<HTMLTableRowElement>('tbody tr[data-body-row]')
    const measure = () => {
      setViewH(el.clientHeight || 400)
      const height = row?.getBoundingClientRect().height
      if (height && height > 5) setRowH(height)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    if (row) observer.observe(row)
    return () => observer.disconnect()
  }, [virtual, visible[0]])

  useLayoutEffect(() => {
    const target = pendingFocus.current
    const scroller = scrollRef.current
    if (!target || !scroller) return
    const position = sortedIndices.indexOf(target.r)
    if (position < 0) return // An appended row may commit on the next render.
    const input = ref.current?.querySelector<HTMLInputElement>(`[data-r="${target.r}"][data-c="${target.c}"]`)
    if (!input) {
      if (virtual) {
        scroller.scrollTop = position * rowH
        setScrollTop(scroller.scrollTop)
      }
      return // Focus only after the virtual row has mounted.
    }
    const bounds = input.closest('tr')!.getBoundingClientRect()
    const viewport = scroller.getBoundingClientRect()
    const headerHeight = scroller.querySelector('thead')?.getBoundingClientRect().height ?? 0
    if (bounds.top < viewport.top + headerHeight) scroller.scrollTop -= viewport.top + headerHeight - bounds.top
    else if (bounds.bottom > viewport.bottom) scroller.scrollTop += bounds.bottom - viewport.bottom
    if (virtual) setScrollTop(scroller.scrollTop)
    pendingFocus.current = null
    input.focus({ preventScroll: true })
  }, [focusRequest, sortedIndices, virtual, rowH, start, end])

  return (
    <div ref={ref} className="border border-gray-200 rounded-lg overflow-hidden">
      <div ref={scrollRef} className="overflow-auto" style={{ maxHeight: maxBodyHeight }}
        onScroll={virtual ? (e => setScrollTop((e.target as HTMLElement).scrollTop)) : undefined}>
        <table className="perdura-data-table text-xs" aria-rowcount={rows.length + 1}>
          <caption className="sr-only">Model data. Enter moves to the next displayed row or adds a row at the end. Tab leaves the grid normally.</caption>
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr aria-rowindex={1}>
              <th className="px-1.5 py-1 text-left font-medium text-gray-400 w-7">#</th>
              {columns.map(col => (
                <th key={col} scope="col" aria-sort={sortCol === col && sortDir ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className="px-1 py-1 font-medium text-gray-500" style={{ minWidth: 144 }}>
                  <div className="flex items-center gap-0.5">
                    <input
                      defaultValue={col}
                      aria-label={`Rename column ${col}`}
                      key={col}
                      style={{ minWidth: 64 }}
                      onBlur={e => renameColumn(col, e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                      className="w-full min-w-0 text-xs font-semibold text-gray-700 bg-transparent px-1 py-0.5 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                      title="Rename column"
                    />
                    <button onClick={() => toggleSort(col)} aria-label={`Sort column ${col}`} title="Sort column"
                      className="perdura-icon-button text-gray-600 hover:text-blue-700 flex-shrink-0 text-[10px] leading-none px-0.5">
                      {sortCol === col ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                    </button>
                    {columns.length > 1 && (
                      <button onClick={() => removeColumn(col)} aria-label={`Remove column ${col}`} title="Remove column"
                        className="perdura-icon-button text-gray-600 hover:text-red-700 flex-shrink-0">
                        <X size={11} />
                      </button>
                    )}
                  </div>
                </th>
              ))}
              <th className="w-7 px-0.5">
                <button onClick={addColumn} title="Add column"
                  className="perdura-icon-button text-gray-600 hover:text-blue-700">
                  <Plus size={13} />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {padTop > 0 && <tr aria-hidden="true" style={{ height: padTop }}><td colSpan={nCols} className="!p-0" /></tr>}
            {visible.map((r, index) => (
              <BodyRow key={r} r={r} position={start + index} row={rows[r]} columns={columns}
                setCell={setCell} onKeyDown={onKeyDown} onPaste={onPaste} removeRow={removeRow} />
            ))}
            {padBottom > 0 && <tr aria-hidden="true" style={{ height: padBottom }}><td colSpan={nCols} className="!p-0" /></tr>}
          </tbody>
        </table>
      </div>
      <button onClick={() => { addRow(); focusCell(rows.length, 0) }}
        className="w-full text-[11px] text-gray-500 hover:text-blue-600 hover:bg-blue-50 py-1 border-t border-gray-100 transition-colors">
        + Add row
      </button>
    </div>
  )
}
