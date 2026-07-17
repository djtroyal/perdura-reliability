import { Plus, Trash2 } from 'lucide-react'

export interface FrequencyDataRow {
  key: string
  id: string
  time: string
  state: 'F' | 'S'
  count: string
}

export interface IntervalDataRow {
  key: string
  id: string
  lower: string
  upper: string
  count: string
}

interface FrequencyProps {
  format: 'frequency'
  rows: FrequencyDataRow[]
  units: string
  onChange: (rows: FrequencyDataRow[]) => void
  newRow: () => FrequencyDataRow
}

interface IntervalProps {
  format: 'interval'
  rows: IntervalDataRow[]
  units: string
  onChange: (rows: IntervalDataRow[]) => void
  newRow: () => IntervalDataRow
}

type Props = FrequencyProps | IntervalProps

const inputClass = 'w-full text-xs px-1 py-0.5 border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded font-mono'

export default function GroupedDataGrid(props: Props) {
  const update = (index: number, field: string, value: string) => {
    if (props.format === 'frequency') {
      props.onChange(props.rows.map((row, i) => i === index ? { ...row, [field]: value } : row))
    } else {
      props.onChange(props.rows.map((row, i) => i === index ? { ...row, [field]: value } : row))
    }
  }
  const remove = (index: number) => {
    if (props.rows.length <= 1) return
    if (props.format === 'frequency') {
      props.onChange(props.rows.filter((_, i) => i !== index))
    } else {
      props.onChange(props.rows.filter((_, i) => i !== index))
    }
  }
  const add = () => {
    if (props.format === 'frequency') {
      props.onChange([...props.rows, props.newRow()])
    } else {
      props.onChange([...props.rows, props.newRow()])
    }
  }

  return (
    <div>
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <div className="max-h-[25vh] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 sticky top-0 z-10">
              {props.format === 'frequency' ? (
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium text-gray-500 w-14">ID</th>
                  <th className="px-2 py-1.5 text-left font-medium text-gray-500">Exact time ({props.units})</th>
                  <th className="px-2 py-1.5 text-center font-medium text-gray-500 w-14">State</th>
                  <th className="px-2 py-1.5 text-right font-medium text-gray-500 w-16">Count</th>
                  <th className="w-7" />
                </tr>
              ) : (
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium text-gray-500 w-14">ID</th>
                  <th className="px-2 py-1.5 text-left font-medium text-gray-500">Lower ({props.units})</th>
                  <th className="px-2 py-1.5 text-left font-medium text-gray-500">Upper ({props.units})</th>
                  <th className="px-2 py-1.5 text-right font-medium text-gray-500 w-16">Count</th>
                  <th className="w-7" />
                </tr>
              )}
            </thead>
            <tbody>
              {props.format === 'frequency'
                ? props.rows.map((row, index) => (
                  <tr key={row.key} className="border-t border-gray-100 group">
                    <td className="px-1 py-0.5"><input value={row.id}
                      onChange={e => update(index, 'id', e.target.value)} className={inputClass} placeholder="—" /></td>
                    <td className="px-1 py-0.5"><input value={row.time} inputMode="decimal"
                      onChange={e => update(index, 'time', e.target.value)} className={inputClass} placeholder="0" /></td>
                    <td className="px-1 py-0.5 text-center">
                      <button tabIndex={-1} onClick={() => update(index, 'state', row.state === 'F' ? 'S' : 'F')}
                        className={`px-1.5 py-0.5 text-[10px] font-semibold rounded ${
                          row.state === 'F' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                        {row.state === 'F' ? 'Fail' : 'Susp'}
                      </button>
                    </td>
                    <td className="px-1 py-0.5"><input value={row.count} type="number" min="1" step="1" inputMode="numeric"
                      onChange={e => update(index, 'count', e.target.value)} className={`${inputClass} text-right`} placeholder="1" /></td>
                    <td className="px-0.5 text-center"><button onClick={() => remove(index)}
                      className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"><Trash2 size={11} /></button></td>
                  </tr>
                ))
                : props.rows.map((row, index) => (
                  <tr key={row.key} className="border-t border-gray-100 group">
                    <td className="px-1 py-0.5"><input value={row.id}
                      onChange={e => update(index, 'id', e.target.value)} className={inputClass} placeholder="—" /></td>
                    <td className="px-1 py-0.5"><input value={row.lower} inputMode="decimal"
                      onChange={e => update(index, 'lower', e.target.value)} className={inputClass} placeholder="blank = left" /></td>
                    <td className="px-1 py-0.5"><input value={row.upper} inputMode="decimal"
                      onChange={e => update(index, 'upper', e.target.value)} className={inputClass} placeholder="blank = right" /></td>
                    <td className="px-1 py-0.5"><input value={row.count} type="number" min="1" step="1" inputMode="numeric"
                      onChange={e => update(index, 'count', e.target.value)} className={`${inputClass} text-right`} placeholder="1" /></td>
                    <td className="px-0.5 text-center"><button onClick={() => remove(index)}
                      className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"><Trash2 size={11} /></button></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
      <button onClick={add}
        className="mt-1.5 flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800">
        <Plus size={11} /> Add grouped row
      </button>
      {props.format === 'interval' && (
        <p className="text-[10px] text-gray-400 mt-1">
          Finite lower and upper = interval failure; blank lower = left-censored;
          blank upper = right-censored. Bounds represent (lower, upper].
        </p>
      )}
    </div>
  )
}
