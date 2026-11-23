import { useMemo } from 'react'
import { ObservationEntryGrid } from './EditableLifeDataTable'

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
  kind?: 'interval' | 'exact'
}

interface FrequencyProps {
  format: 'frequency'
  rows: FrequencyDataRow[]
  units: string
  expanded?: boolean
  onChange: (rows: FrequencyDataRow[]) => void
  newRow: () => FrequencyDataRow
}

interface IntervalProps {
  format: 'interval'
  rows: IntervalDataRow[]
  units: string
  expanded?: boolean
  onChange: (rows: IntervalDataRow[]) => void
  newRow: () => IntervalDataRow
}

const hasCount = (count: string) => Boolean(count.trim()) && Number(count) !== 1
const hasFrequencyContent = (row: FrequencyDataRow) => Boolean(row.id.trim() || row.time.trim() || hasCount(row.count))
const hasIntervalContent = (row: IntervalDataRow) => Boolean(row.id.trim() || row.lower.trim() || row.upper.trim() || hasCount(row.count))

export default function GroupedDataGrid(props: FrequencyProps | IntervalProps) {
  const frequencyColumns = useMemo(() => [
    { key: 'id', label: 'ID', placeholder: '—' },
    { key: 'time', label: `Exact time (${props.units})`, inputMode: 'decimal' as const, placeholder: 'Enter value' },
    { key: 'state', label: 'State', kind: 'state' as const },
    { key: 'count', label: 'Count', inputMode: 'numeric' as const, placeholder: '1', align: 'right' as const },
  ], [props.units])
  const intervalColumns = useMemo(() => [
    { key: 'id', label: 'ID', placeholder: '—' },
    { key: 'kind', label: 'Observation', options: [{value:'interval',label:'Range'}, {value:'exact',label:'Exact'}] },
    { key: 'lower', label: `Time / lower (${props.units})`, inputMode: 'decimal' as const, placeholder: 'time or lower' },
    { key: 'upper', label: `Upper (${props.units})`, inputMode: 'decimal' as const, placeholder: 'blank = right',
      disabledWhen: (values: Record<string,string>) => values.kind === 'exact' },
    { key: 'count', label: 'Count', inputMode: 'numeric' as const, placeholder: '1', align: 'right' as const },
  ], [props.units])
  return <div>
    {props.format === 'frequency'
      ? <ObservationEntryGrid key="frequency" {...props} columns={frequencyColumns}
        hasContent={hasFrequencyContent} caption="Frequency Life Data observations." />
      : <ObservationEntryGrid key="interval" {...props} columns={intervalColumns}
        onChange={rows => props.onChange(rows.map(row => row.kind === 'exact' ? {...row,upper:''} : row))}
        hasContent={hasIntervalContent} caption="Mixed and interval Life Data observations." />}
    {props.format === 'interval' && <p className="mt-2 text-xs leading-5 text-slate-600">
      Exact failures use Time. For ranges, blank lower means left-censored;
      blank upper means right-censored. Bounds represent (lower, upper].
    </p>}
  </div>
}
