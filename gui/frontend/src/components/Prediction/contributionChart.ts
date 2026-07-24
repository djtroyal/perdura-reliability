export const CONTRIBUTION_DETAIL_LIMIT = 10
export const DEFAULT_CONTRIBUTION_PERCENT = 80

export const DEFAULT_SANKEY_CUTOFF_PERCENT = 1

export type ContributionChartPreference = 'auto' | 'pareto' | 'donut' | 'sankey'
export type ContributionChartMode = Exclude<ContributionChartPreference, 'auto'>
export type ContributionCutoffMode = 'count' | 'percent'
export type ContributionGroupBy =
  'reference_designator' | 'part_number' | 'part_category'

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

export type ContributionHierarchyKind =
  'system' | 'block' | 'block_override' | 'part' | 'category' | 'other'

export interface ContributionHierarchyNode {
  id: string
  label: string
  parentId: string | null
  value: number
  kind: Exclude<ContributionHierarchyKind, 'other'>
}

export interface PreparedContributionSankey {
  labels: string[]
  nodeIds: string[]
  nodeKinds: ContributionHierarchyKind[]
  nodeValues: number[]
  nodeShares: number[]
  sources: number[]
  targets: number[]
  values: number[]
  linkShares: number[]
  total: number
  cutoffPercent: number
  groupedCount: number
}

const CATEGORY_ACRONYMS: Record<string, string> = {
  bjt: 'BJT',
  cmos: 'CMOS',
  co2: 'CO₂',
  esd: 'ESD',
  fet: 'FET',
  gaas: 'GaAs',
  hf: 'HF',
  ic: 'IC',
  mems: 'MEMS',
  nprd: 'NPRD',
  pth: 'PTH',
  saw: 'SAW',
  scr: 'SCR',
  ss: 'SS',
  vhsic: 'VHSIC',
  vlsi: 'VLSI',
}

/** Turn a stored category key into a compact, human-readable chart label. */
export function formatContributionCategory(category: unknown): string {
  const key = String(category ?? '').trim()
  if (!key) return 'Unmapped category'
  return key
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(token => CATEGORY_ACRONYMS[token.toLowerCase()]
      ?? `${token.charAt(0).toUpperCase()}${token.slice(1).toLowerCase()}`)
    .join(' ')
}

/** Stable key used when category contributions intentionally aggregate. */
export function contributionCategoryKey(category: unknown): string {
  return String(category ?? '').trim().toLowerCase() || 'unmapped'
}

/**
 * Append a part leaf to a contribution hierarchy. Category mode combines
 * sibling parts of the same category while RefDes and part-number modes retain
 * one auditable leaf per input line.
 */
export function appendContributionPartNode(
  hierarchy: ContributionHierarchyNode[],
  input: {
    groupBy: ContributionGroupBy
    index: number
    category: unknown
    label: string
    parentId: string
    value: number
  },
): void {
  if (!Number.isFinite(input.value) || input.value <= 0) return
  if (input.groupBy !== 'part_category') {
    hierarchy.push({
      id: `part:${input.index}`,
      label: input.label,
      parentId: input.parentId,
      value: input.value,
      kind: 'part',
    })
    return
  }
  const categoryKey = contributionCategoryKey(input.category)
  const id = `${input.parentId}:category:${categoryKey}`
  const existing = hierarchy.find(node => node.id === id)
  if (existing) {
    existing.value += input.value
    return
  }
  hierarchy.push({
    id,
    label: formatContributionCategory(input.category),
    parentId: input.parentId,
    value: input.value,
    kind: 'category',
  })
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

/**
 * Convert a failure-rate hierarchy into a Plotly Sankey contract. The cutoff
 * is an individual branch's percentage of the selected scope total, not a
 * cumulative Pareto target. Small sibling branches are combined beneath their
 * immediate parent, so every displayed parent flow remains traceable and the
 * system total is preserved.
 */
export function prepareContributionSankey(
  input: ContributionHierarchyNode[],
  cutoffPercent = DEFAULT_SANKEY_CUTOFF_PERCENT,
): PreparedContributionSankey | null {
  const byId = new Map<string, ContributionHierarchyNode>()
  input.forEach((node, index) => {
    const value = Number(node.value)
    if (!node.id || byId.has(node.id) || !Number.isFinite(value) || value <= 0) return
    byId.set(node.id, {
      ...node,
      label: node.label.trim() || `Contributor ${index + 1}`,
      value,
    })
  })
  if (byId.size === 0) return null

  const roots = [...byId.values()].filter(node =>
    node.parentId == null || !byId.has(node.parentId))
  const total = roots.reduce((sum, node) => sum + node.value, 0)
  if (!(total > 0)) return null
  const normalizedCutoff = Number.isFinite(cutoffPercent)
    ? Math.min(100, Math.max(0, cutoffPercent))
    : DEFAULT_SANKEY_CUTOFF_PERCENT
  const children = new Map<string, ContributionHierarchyNode[]>()
  for (const node of byId.values()) {
    if (!node.parentId || !byId.has(node.parentId)) continue
    children.set(node.parentId, [...(children.get(node.parentId) ?? []), node])
  }
  children.forEach(items => items.sort((left, right) =>
    right.value - left.value || left.label.localeCompare(right.label)))

  const labels: string[] = []
  const nodeIds: string[] = []
  const nodeKinds: ContributionHierarchyKind[] = []
  const nodeValues: number[] = []
  const nodeShares: number[] = []
  const sources: number[] = []
  const targets: number[] = []
  const values: number[] = []
  const linkShares: number[] = []
  const indexById = new Map<string, number>()
  let groupedCount = 0

  const addNode = (
    id: string,
    label: string,
    value: number,
    kind: ContributionHierarchyKind,
  ) => {
    const existing = indexById.get(id)
    if (existing != null) return existing
    const index = labels.length
    indexById.set(id, index)
    labels.push(label)
    nodeIds.push(id)
    nodeKinds.push(kind)
    nodeValues.push(value)
    nodeShares.push(value / total)
    return index
  }
  const addLink = (source: number, target: number, value: number) => {
    sources.push(source)
    targets.push(target)
    values.push(value)
    linkShares.push(value / total)
  }
  const visited = new Set<string>()
  const visit = (parent: ContributionHierarchyNode) => {
    if (visited.has(parent.id)) return
    visited.add(parent.id)
    const parentIndex = addNode(
      parent.id, parent.label, parent.value, parent.kind)
    const candidates = (children.get(parent.id) ?? [])
      .filter(node => !visited.has(node.id))
    const visible = candidates.filter(node =>
      normalizedCutoff === 0 || node.value / total * 100 >= normalizedCutoff)
    const grouped = candidates.filter(node => !visible.includes(node))
    for (const child of visible) {
      const childIndex = addNode(
        child.id, child.label, child.value, child.kind)
      addLink(parentIndex, childIndex, child.value)
      visit(child)
    }
    if (grouped.length > 0) {
      const groupedValue = grouped.reduce((sum, node) => sum + node.value, 0)
      const otherId = `other:${parent.id}`
      const otherIndex = addNode(
        otherId, `Other (${grouped.length})`, groupedValue, 'other')
      addLink(parentIndex, otherIndex, groupedValue)
      groupedCount += grouped.length
    }
  }
  roots.sort((left, right) =>
    right.value - left.value || left.label.localeCompare(right.label))
  roots.forEach(visit)

  return {
    labels,
    nodeIds,
    nodeKinds,
    nodeValues,
    nodeShares,
    sources,
    targets,
    values,
    linkShares,
    total,
    cutoffPercent: normalizedCutoff,
    groupedCount,
  }
}

export function truncateContributionLabel(label: string, maxLength = 42): string {
  return label.length > maxLength ? `${label.slice(0, maxLength - 1)}…` : label
}
