import { useState } from 'react'
import InfoLabel from './InfoLabel'
import DataGenerator from './DataGenerator'
import { buildFormula } from './columnFormula'
import { GridRow } from '../DataModeling/ModelDataGrid'

interface Dataset { columns: string[]; rows: GridRow[] }

/**
 * Shared "Generate column" panel used by both Statistical Modeling sub-tabs
 * (Descriptive Statistics and Regression & ML). Fills a chosen column either
 * from a formula over the other columns (e.g. `x1 * 2`, `sqrt(x1) + log(x2)`)
 * or with random draws from a distribution. Operates on the shared dataset.
 */
export default function GenerateColumnPanel({
  columns, rows, setData, onError, defaultDist = 'normal',
}: {
  columns: string[]
  rows: GridRow[]
  setData: (d: Dataset) => void
  onError?: (msg: string | null) => void
  defaultDist?: string
}) {
  const [genCol, setGenCol] = useState(columns[0] ?? '')
  const [genFormula, setGenFormula] = useState('')

  // Keep the selected column valid as columns change.
  const col = columns.includes(genCol) ? genCol : (columns[0] ?? '')

  const inputCls = 'w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400'

  const fillColumn = (vals: number[]) => {
    const newRows = rows.map((r, i) => ({ ...r, [col]: i < vals.length ? String(vals[i]) : (r[col] ?? '') }))
    while (newRows.length < vals.length) {
      const idx = newRows.length
      newRows.push(Object.fromEntries(columns.map(c => [c, c === col ? String(vals[idx]) : ''])))
    }
    setData({ columns, rows: newRows })
  }

  const applyFormula = () => {
    const formula = genFormula.trim()
    if (!formula) { onError?.('Enter a formula, e.g. x1 * 2'); return }
    const otherCols = columns.filter(c => c !== col)
    let evaluator: (vals: number[]) => number
    try {
      evaluator = buildFormula(formula, otherCols)
    } catch (e) {
      onError?.((e as Error).message); return
    }
    onError?.(null)
    const newRows = rows.map(r => {
      const args = otherCols.map(c => Number((r[c] ?? '').trim()))
      let out = ''
      if (args.every(Number.isFinite)) {
        const v = evaluator(args)
        if (Number.isFinite(v)) out = String(Number(v.toFixed(6)))
      }
      return { ...r, [col]: out }
    })
    setData({ columns, rows: newRows })
  }

  if (columns.length === 0) return null

  return (
    <div>
      <InfoLabel tip="Fill a column either with random draws from a distribution, or with a formula computed from the other columns (e.g. x1 * 2, sqrt(x1) + log(x2)).">Generate column</InfoLabel>
      <div className="flex gap-2 items-center mb-2">
        <select value={col} onChange={e => setGenCol(e.target.value)} className={inputCls}>
          {columns.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="flex gap-1.5 items-center mb-2">
        <span className="text-xs font-mono text-gray-500 whitespace-nowrap">{col} =</span>
        <input type="text" value={genFormula} placeholder="e.g. x1 * 2"
          onChange={e => setGenFormula(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') applyFormula() }}
          className="flex-1 text-xs border border-gray-300 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400" />
        <button onClick={applyFormula}
          className="text-xs px-2 py-1.5 border border-blue-600 text-blue-700 rounded hover:bg-blue-50 whitespace-nowrap">
          Apply
        </button>
      </div>
      <p className="text-[10px] text-gray-400 mb-2">
        Formula uses other columns + math (sqrt, log, exp, sin, pow, min, max, pi…). Or draw randomly:
      </p>
      <DataGenerator defaultDist={defaultDist} onGenerate={fillColumn}
        label={`Generate "${col}"`} />
    </div>
  )
}
