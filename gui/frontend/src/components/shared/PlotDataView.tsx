import { useMemo, useState } from 'react'
import { htmlToPlainText } from './htmlSafety'

interface DataRows { columns: string[]; length: number; row: (index: number) => unknown[] }
const values = (value: unknown): ArrayLike<unknown> => Array.isArray(value) || (ArrayBuffer.isView(value) && !(value instanceof DataView))
  ? value as ArrayLike<unknown> : []
const display = (value: unknown): string => value == null ? '—'
  : typeof value === 'object' ? JSON.stringify(value) : htmlToPlainText(String(value))

function axisLabel(trace: Record<string, unknown>, layout: Partial<Plotly.Layout> | undefined, axis: string): string {
  const config = layout as Record<string, unknown> | undefined
  const usesScene = typeof trace.scene === 'string' || ['scatter3d', 'surface', 'mesh3d', 'cone', 'streamtube', 'volume', 'isosurface'].includes(String(trace.type))
  const scene = (usesScene ? config?.[String(trace.scene ?? 'scene')] : undefined) as Record<string, unknown> | undefined
  const ref = String(trace[`${axis}axis`] ?? axis)
  const axisConfig = (scene?.[`${axis}axis`] ?? config?.[ref.replace(axis, `${axis}axis`)]) as { title?: unknown } | undefined
  const title = axisConfig?.title
  const text = typeof title === 'string' ? title : (title as { text?: string } | undefined)?.text
  return text ? `${axis.toUpperCase()} — ${htmlToPlainText(text)}` : axis.toUpperCase()
}

/** Expose the supplied figure data without estimating values from pixels. */
function dataRows(trace: Record<string, unknown>, layout?: Partial<Plotly.Layout>): DataRows | null {
  if (trace.type === 'sankey') {
    const link = (trace.link ?? {}) as Record<string, unknown>
    const labels = values((trace.node as Record<string, unknown> | undefined)?.label)
    const source = values(link.source), target = values(link.target), weight = values(link.value)
    return { columns: ['Source', 'Target', trace.valuesuffix ? `Value (${htmlToPlainText(String(trace.valuesuffix)).trim()})` : 'Value'], length: weight.length,
      row: i => [labels[Number(source[i])] ?? source[i], labels[Number(target[i])] ?? target[i], weight[i]] }
  }
  const z = values(trace.z)
  if (z.length && (Array.isArray(z[0]) || ArrayBuffer.isView(z[0]))) {
    const x = values(trace.x), y = values(trace.y)
    let width = 0
    for (let i = 0; i < z.length; i++) width = Math.max(width, values(z[i]).length)
    return { columns: [x.length ? axisLabel(trace, layout, 'x') : 'Column index (zero-based)', y.length ? axisLabel(trace, layout, 'y') : 'Row index (zero-based)', axisLabel(trace, layout, 'z')], length: width * z.length,
      row: i => { const r = Math.floor(i / width), c = i % width
        return [values(x[r]).length ? values(x[r])[c] : x[c] ?? c, values(y[r]).length ? values(y[r])[c] : y[r] ?? r, values(z[r])[c]] } }
  }
  const keys = ['labels', 'values', 'x', 'y', 'z', 'text', 'ids'].filter(key => values(trace[key]).length)
  if (!keys.length) return null
  const arrays = keys.map(key => values(trace[key]))
  const errorColumns: { label: string; get: (index: number) => unknown }[] = []
  for (const axis of ['x', 'y', 'z']) {
    const error = trace[`error_${axis}`] as Record<string, unknown> | undefined
    if (!error) continue
    const type = String(error.type ?? ('array' in error ? 'data' : 'percent'))
    const visible = error.visible ?? (error.array !== undefined || error.value !== undefined || type === 'sqrt')
    const symmetric = error.symmetric ?? !(type === 'data' ? 'arrayminus' in error : 'valueminus' in error)
    const directions = symmetric ? ['±'] : ['+', '−']
    for (const direction of directions) {
      const minus = direction === '−'
      errorColumns.push({ label: `${axis.toUpperCase()} error ${direction} (${type}${visible === false ? ', hidden' : ''})`,
        get: i => type === 'data' ? values(error[minus ? 'arrayminus' : 'array'])[i]
          : type === 'percent' ? `${error[minus ? 'valueminus' : 'value'] ?? 10}%`
          : type === 'constant' ? error[minus ? 'valueminus' : 'value'] ?? 10
          : type === 'sqrt' ? 'Square-root rule' : 'See supplied error configuration' })
    }
  }
  return { columns: [...keys.map(key => ['x', 'y', 'z'].includes(key) ? axisLabel(trace, layout, key) : key.toUpperCase()), ...errorColumns.map(column => column.label)],
    length: Math.max(...arrays.map(array => array.length)),
    row: i => [...arrays.map(array => array[i]), ...errorColumns.map(column => column.get(i))] }
}

function SeriesTable({ trace, index, layout }: { trace: Plotly.Data; index: number; layout?: Partial<Plotly.Layout> }) {
  const source = trace as unknown as Record<string, unknown>
  const data = useMemo(() => dataRows(source, layout), [source, layout])
  const [page, setPage] = useState(0)
  const name = htmlToPlainText(String(source.name ?? `Series ${index + 1}`))
  if (!data) return <p className="py-2">{name}: no tabular values are supplied for this trace. Consult the analysis results and exported model.</p>
  const last = Math.max(0, Math.ceil(data.length / 50) - 1)
  const current = Math.min(page, last), start = current * 50, end = Math.min(start + 50, data.length)
  return <section className="my-3">
    <div className="flex flex-wrap items-center gap-2">
      <h4 className="font-semibold">{name}</h4>
      <span role="status">{data.length ? `${start + 1}–${end} of ${data.length} values` : 'No values'}</span>
      {last > 0 && <>
        <button type="button" className="secondary-button" disabled={current === 0} aria-label={`Previous values for ${name}`} onClick={() => setPage(current - 1)}>Previous</button>
        <button type="button" className="secondary-button" disabled={current === last} aria-label={`Next values for ${name}`} onClick={() => setPage(current + 1)}>Next</button>
      </>}
    </div>
    <div className="overflow-x-auto">
      <table className="perdura-data-table w-full text-left">
        <caption className="sr-only">{name} supplied chart values</caption>
        <thead><tr><th scope="col">Point</th>{data.columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead>
        <tbody>{Array.from({ length: end - start }, (_, offset) => {
          const i = start + offset
          return <tr key={i}><th scope="row">{i + 1}</th>{data.row(i).map((value, c) => <td key={c} className="tabular-nums">{display(value)}</td>)}</tr>
        })}</tbody>
      </table>
    </div>
  </section>
}

export default function PlotDataView({ data, label, description, layout }: { data: Plotly.Data[]; label: string; description?: string; layout?: Partial<Plotly.Layout> }) {
  const [open, setOpen] = useState(false)
  return <details data-export-ignore className="perdura-chart-data rounded border px-2 py-1 text-xs"
    onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer py-1">View data and description: {label}</summary>
    {open && <div>
      <p className="py-2">{description || `${label}. ${data.length} data series. Values below are the data supplied to the chart; calculated bins and other visual transformations may differ.`}</p>
      <p>Tables show supplied values, including configured uncertainty where present. Error lengths are relative to each point; percent values are percentages, not absolute bounds. Calculated bins, smoothing, aggregation and other visual transformations may differ from these inputs.</p>
      {data.map((trace, index) => <SeriesTable key={`${index}:${String(trace.name ?? '')}`} trace={trace} index={index} layout={layout} />)}
    </div>}
  </details>
}
