// Shared dataset for the combined Data Analysis module (Descriptive +
// Regression & ML). Both sub-tabs read and write the same columns/rows so a
// dataset entered once is available to every tool.

import { useModuleState } from '../../store/project'
import { GridRow } from '../DataModeling/ModelDataGrid'

export interface SharedDataset {
  columns: string[]
  rows: GridRow[]
}

export const DEFAULT_COLS = ['x1', 'x2', 'y']

export const sampleRows = (): GridRow[] => {
  const data = [
    [1, 2, 5], [2, 3, 8], [3, 1, 7], [4, 4, 11], [5, 2, 12],
    [6, 5, 14], [7, 3, 16], [8, 6, 19], [9, 1, 18], [10, 4, 22],
  ]
  return data.map(([a, b, c]) => ({ x1: String(a), x2: String(b), y: String(c) }))
}

export const INITIAL_DATASET: SharedDataset = {
  columns: DEFAULT_COLS,
  rows: sampleRows(),
}

/** Store-backed shared dataset hook used by both Data Analysis sub-tabs. */
export function useSharedDataset() {
  return useModuleState<SharedDataset>('dataAnalysisData', INITIAL_DATASET)
}

/** Extract numeric columns (header -> finite values) from the grid, dropping
 *  blank/non-numeric cells. Used by the descriptive-statistics tools. */
export function numericColumns(ds: SharedDataset): {
  headers: string[]
  columns: Record<string, number[]>
} {
  const headers = ds.columns
  const columns: Record<string, number[]> = {}
  for (const h of headers) {
    columns[h] = ds.rows
      .map(r => (r[h] ?? '').trim())
      .filter(s => s !== '')
      .map(Number)
      .filter(Number.isFinite)
  }
  return { headers, columns }
}
