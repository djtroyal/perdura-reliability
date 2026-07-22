export const CONTRIBUTION_DETAIL_LIMIT = 10
export const DEFAULT_CONTRIBUTION_PERCENT = 80

export type ContributionChartPreference = 'auto' | 'pareto' | 'donut'
export type ContributionChartMode = Exclude<ContributionChartPreference, 'auto'>
export type ContributionCutoffMode = 'count' | 'percent'

export interface ContributionCutoff {
  mode: ContributionCutoffMode
  value: number
}

export interface PreparedContributions {
  labels: string[]
  values: number[]
  shares: number[]
  cumulativeShares: number[]
  sourceCount: number
  visibleCount: number
  groupedCount: number
  visibleShare: number
  cutoff: ContributionCutoff
  total: number
}

/**
 * Sort contribution values for legibility and, for large systems, preserve the
 * requested number of contributors, or enough contributors to reach a target
 * cumulative share, while combining the long tail into one auditable
 * remainder. Values and percentages always reconcile to the ungrouped total.
 */
export function prepareContributions(
  labels: string[],
  values: number[],
  cutoff: ContributionCutoff = { mode: 'count', value: CONTRIBUTION_DETAIL_LIMIT },
  contributorKeys?: string[],
): PreparedContributions | null {
  const byKey = new Map<string, { label: string; value: number; firstIndex: number }>()
  const length = Math.min(labels.length, values.length)
  for (let index = 0; index < length; index += 1) {
    const value = Number(values[index])
    if (!Number.isFinite(value) || value <= 0) continue
    const label = labels[index]?.trim() || `Contributor ${index + 1}`
    // A stable identity keeps an axis-label preference from changing the
    // contribution grouping (for example, two BOM lines with the same P/N).
    // Callers that omit keys retain the established label aggregation.
    const key = contributorKeys?.[index]?.trim() || label
    const existing = byKey.get(key)
    byKey.set(key, {
      label: existing?.label ?? label,
      value: (existing?.value ?? 0) + value,
      firstIndex: existing?.firstIndex ?? index,
    })
  }

  const entries = [...byKey.values()]
    .sort((a, b) => b.value - a.value || a.firstIndex - b.firstIndex)
  if (entries.length === 0) return null

  const sourceCount = entries.length
  const total = entries.reduce((sum, item) => sum + item.value, 0)
  const requestedValue = Number.isFinite(cutoff.value) ? cutoff.value : cutoff.mode === 'percent'
    ? DEFAULT_CONTRIBUTION_PERCENT
    : CONTRIBUTION_DETAIL_LIMIT
  const normalizedCutoff: ContributionCutoff = cutoff.mode === 'percent'
    ? { mode: 'percent', value: Math.min(100, Math.max(1, requestedValue)) }
    : { mode: 'count', value: Math.max(1, Math.floor(requestedValue)) }
  let visibleCount: number
  if (normalizedCutoff.mode === 'percent') {
    const target = normalizedCutoff.value / 100
    let running = 0
    visibleCount = 0
    while (visibleCount < entries.length && running / total < target) {
      running += entries[visibleCount].value
      visibleCount += 1
    }
  } else {
    visibleCount = Math.min(entries.length, normalizedCutoff.value)
  }

  const visible = entries.slice(0, visibleCount)
  const visibleTotal = visible.reduce((sum, item) => sum + item.value, 0)
  const remainder = entries.slice(visibleCount)
  if (remainder.length > 0) {
    visible.push({
      label: `Remaining (${remainder.length})`,
      value: remainder.reduce((sum, item) => sum + item.value, 0),
      firstIndex: Number.MAX_SAFE_INTEGER,
    })
  }

  let cumulative = 0
  const shares = visible.map(item => item.value / total)
  const cumulativeShares = shares.map(share => {
    cumulative += share
    return cumulative
  })
  if (cumulativeShares.length > 0) cumulativeShares[cumulativeShares.length - 1] = 1

  return {
    labels: visible.map(item => item.label),
    values: visible.map(item => item.value),
    shares,
    cumulativeShares,
    sourceCount,
    visibleCount,
    groupedCount: remainder.length,
    visibleShare: visibleTotal / total,
    cutoff: normalizedCutoff,
    total,
  }
}

export function resolveContributionChartMode(
  preference: ContributionChartPreference,
  contributorCount: number,
): ContributionChartMode {
  if (preference !== 'auto') return preference
  return contributorCount > CONTRIBUTION_DETAIL_LIMIT ? 'pareto' : 'donut'
}

export function truncateContributionLabel(label: string, maxLength = 42): string {
  return label.length > maxLength ? `${label.slice(0, maxLength - 1)}…` : label
}
