export type DistributionInputKind =
  | 'one_group'
  | 'two_groups'
  | 'k_groups'
  | 'gof'
  | 'table'
  | 'binomial'
  | 'factorial_anova'
  | 'rm_anova'
  | 'mixed_anova'

export interface DistributionOverviewState {
  dataText: string
  groupAText: string
  groupBText: string
  kGroupsText: string
  factorialTableText: string
  factorialResponse: string
  factorialFactors: string
  rmTableText: string
  mixedTableText: string
  mixedBetween: string
  mixedWithin: string
  mixedValue: string
}

export interface DistributionOverviewGroup {
  label: string
  values: number[]
}

export function parseLines(text: string): number[] {
  return text.split(/[\n,\s]+/)
    .map(value => parseFloat(value.trim()))
    .filter(Number.isFinite)
}

export function parseKGroups(text: string): number[][] {
  return text.split(/\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.split(/[\s,]+/).map(parseFloat).filter(Number.isFinite))
}

export function parseTable(text: string): number[][] {
  return text.split(/\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.split(/[\s,\t]+/).map(parseFloat).filter(Number.isFinite))
}

/** Parse a simple CSV/TSV table with a header row. */
export function parseCsvTable(text: string): {
  headers: string[]
  rows: Record<string, string>[]
} {
  const lines = text.split(/\n/).map(line => line.trim()).filter(Boolean)
  if (lines.length < 2) return { headers: [], rows: [] }
  const separator = lines[0].includes('\t') ? '\t' : ','
  const headers = lines[0].split(separator).map(header => header.trim())
  const rows = lines.slice(1).map(line => {
    const cells = line.split(separator).map(cell => cell.trim())
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']))
  })
  return { headers, rows }
}

function groupedRows(
  rows: Record<string, string>[],
  valueColumn: string,
  groupColumns: string[],
): DistributionOverviewGroup[] {
  const groups = new Map<string, number[]>()
  for (const row of rows) {
    const value = parseFloat(row[valueColumn] ?? '')
    if (!Number.isFinite(value)) continue
    const label = groupColumns
      .map(column => `${column}=${row[column] || 'Unspecified'}`)
      .join(' · ') || valueColumn
    const values = groups.get(label) ?? []
    values.push(value)
    groups.set(label, values)
  }
  return Array.from(groups, ([label, values]) => ({ label, values }))
}

/** Convert every sample-valued Hypothesis input layout into Plotly box groups. */
export function buildDistributionOverview(
  kind: DistributionInputKind,
  state: DistributionOverviewState,
): DistributionOverviewGroup[] {
  if (kind === 'one_group') {
    const values = parseLines(state.dataText)
    return values.length ? [{ label: 'Sample', values }] : []
  }
  if (kind === 'two_groups') {
    return [
      { label: 'Group A', values: parseLines(state.groupAText) },
      { label: 'Group B', values: parseLines(state.groupBText) },
    ].filter(group => group.values.length > 0)
  }
  if (kind === 'k_groups') {
    return parseKGroups(state.kGroupsText)
      .filter(values => values.length > 0)
      .map((values, index) => ({ label: `Group ${index + 1}`, values }))
  }
  if (kind === 'factorial_anova') {
    const { headers, rows } = parseCsvTable(state.factorialTableText)
    const valueColumn = state.factorialResponse.trim() || headers[0] || ''
    const factorColumns = state.factorialFactors.split(',')
      .map(column => column.trim())
      .filter(column => column && headers.includes(column))
    return valueColumn && headers.includes(valueColumn)
      ? groupedRows(rows, valueColumn, factorColumns)
      : []
  }
  if (kind === 'rm_anova') {
    const rows = parseTable(state.rmTableText)
    const conditionCount = Math.max(0, ...rows.map(row => row.length))
    return Array.from({ length: conditionCount }, (_, index) => ({
      label: `Condition ${index + 1}`,
      values: rows.map(row => row[index]).filter(Number.isFinite),
    })).filter(group => group.values.length > 0)
  }
  if (kind === 'mixed_anova') {
    const { headers, rows } = parseCsvTable(state.mixedTableText)
    const valueColumn = state.mixedValue.trim() || 'value'
    const groupColumns = [state.mixedBetween.trim(), state.mixedWithin.trim()]
      .filter(column => column && headers.includes(column))
    return headers.includes(valueColumn)
      ? groupedRows(rows, valueColumn, groupColumns)
      : []
  }
  return []
}
