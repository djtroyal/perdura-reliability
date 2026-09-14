import { memo } from 'react'
import { Trash2 } from 'lucide-react'

export interface DataRow {
  key: string
  id: string
  time: string
  state: 'F' | 'S'
}

/**
 * One editable row of the Life-Data entry grid. Memoized so that editing a
 * single cell only re-renders that row (unchanged rows keep their `row`
 * reference and receive stable callbacks), instead of re-rendering the whole
 * table. Extracted from index.tsx; depends only on props (no module state).
 */
const DataGridRow = memo(function DataGridRow({ row, index, units = '', onUpdate, onRemove, onTimeKeyDown }: {
  row: DataRow
  index: number
  units?: string
  onUpdate: (idx: number, field: 'id' | 'time' | 'state', value: string) => void
  onRemove: (idx: number) => void
  onTimeKeyDown: (e: React.KeyboardEvent, idx: number) => void
}) {
  return (
    <tr className="border-t border-gray-100 group">
      <td className="px-1 py-0.5">
        <input
          type="text"
          aria-label={`ID, row ${index + 1}`}
          value={row.id}
          onChange={e => onUpdate(index, 'id', e.target.value)}
          className="w-full text-xs px-1 py-0.5 border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded font-mono text-gray-500"
          placeholder="—"
        />
      </td>
      <td className="px-1 py-0.5">
        <input
          type="text"
          aria-label={`Time${units ? ` (${units})` : ''}, row ${index + 1}`}
          inputMode="decimal"
          value={row.time}
          data-row={index}
          data-col="time"
          onChange={e => onUpdate(index, 'time', e.target.value)}
          onKeyDown={e => onTimeKeyDown(e, index)}
          className="w-full text-xs px-1 py-0.5 border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded font-mono"
          placeholder="0"
        />
      </td>
      <td className="px-1 py-0.5 text-center">
        <button
          type="button"
          aria-label={`Row ${index + 1}: ${row.state === 'F' ? 'Fail (failure); change to suspension' : 'Susp (right-censored); change to failure'}`}
          onClick={() => onUpdate(index, 'state', row.state === 'F' ? 'S' : 'F')}
          className={`min-h-6 px-1.5 py-0.5 text-xs font-semibold rounded transition-colors ${
            row.state === 'F'
              ? 'bg-red-100 text-red-700 hover:bg-red-200'
              : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
          }`}
        >{row.state === 'F' ? 'Fail' : 'Susp'}</button>
      </td>
      <td className="px-0.5 py-0.5 text-center">
        <button
          type="button" aria-label={`Delete row ${index + 1}`}
          onClick={() => onRemove(index)}
          className="perdura-icon-button text-gray-600 hover:text-red-700"
        ><Trash2 size={14} aria-hidden="true" /></button>
      </td>
    </tr>
  )
})

export default DataGridRow
