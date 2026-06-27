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
const DataGridRow = memo(function DataGridRow({ row, index, onUpdate, onRemove, onTimeKeyDown }: {
  row: DataRow
  index: number
  onUpdate: (idx: number, field: 'id' | 'time' | 'state', value: string) => void
  onRemove: (idx: number) => void
  onTimeKeyDown: (e: React.KeyboardEvent, idx: number) => void
}) {
  return (
    <tr className="border-t border-gray-100 group">
      <td className="px-1 py-0.5">
        <input
          type="text"
          value={row.id}
          onChange={e => onUpdate(index, 'id', e.target.value)}
          className="w-full text-xs px-1 py-0.5 border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded font-mono text-gray-500"
          placeholder="—"
        />
      </td>
      <td className="px-1 py-0.5">
        <input
          type="text"
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
          tabIndex={-1}
          onClick={() => onUpdate(index, 'state', row.state === 'F' ? 'S' : 'F')}
          className={`px-1.5 py-0.5 text-[10px] font-semibold rounded transition-colors ${
            row.state === 'F'
              ? 'bg-red-100 text-red-700 hover:bg-red-200'
              : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
          }`}
        >{row.state === 'F' ? 'Fail' : 'Susp'}</button>
      </td>
      <td className="px-0.5 py-0.5 text-center">
        <button
          onClick={() => onRemove(index)}
          className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
          tabIndex={-1}
        ><Trash2 size={11} /></button>
      </td>
    </tr>
  )
})

export default DataGridRow
