import assert from 'node:assert/strict'
import {
  appendContributionPartNode,
  formatContributionCategory,
  prepareContributionSankey,
  prepareContributions,
  resolveContributionChartMode,
  truncateContributionLabel,
} from '../src/components/Prediction/contributionChart.ts'

const prepared = prepareContributions(
  Array.from({ length: 15 }, (_, index) => `Part ${index + 1}`),
  Array.from({ length: 15 }, (_, index) => index + 1),
)
assert.ok(prepared)
assert.equal(prepared.sourceCount, 15)
assert.equal(prepared.visibleCount, 10)
assert.equal(prepared.groupedCount, 5)
assert.equal(prepared.labels.length, 11)
assert.equal(prepared.labels[0], 'Part 15')
assert.equal(prepared.labels.at(-1), 'Remaining (5)')
assert.equal(prepared.values.at(-1), 15)
assert.equal(prepared.total, 120)
assert.ok(Math.abs(prepared.shares.reduce((sum, value) => sum + value, 0) - 1) < 1e-12)
assert.equal(prepared.cumulativeShares.at(-1), 1)
assert.deepEqual(prepared.cutoff, { mode: 'count', value: 10 })

const percentageCutoff = prepareContributions(
  ['A', 'B', 'C', 'D', 'E'],
  [40, 25, 15, 10, 10],
  { mode: 'percent', value: 80 },
)
assert.equal(percentageCutoff?.visibleCount, 3)
assert.equal(percentageCutoff?.groupedCount, 2)
assert.equal(percentageCutoff?.visibleShare, 0.8)
assert.equal(percentageCutoff?.labels.at(-1), 'Remaining (2)')
assert.equal(percentageCutoff?.values.at(-1), 20)
assert.deepEqual(percentageCutoff?.cutoff, { mode: 'percent', value: 80 })

const countCutoff = prepareContributions(
  ['A', 'B', 'C', 'D'], [4, 3, 2, 1], { mode: 'count', value: 2 },
)
assert.equal(countCutoff?.visibleCount, 2)
assert.equal(countCutoff?.groupedCount, 2)
assert.equal(countCutoff?.visibleShare, 0.7)

const duplicates = prepareContributions(
  ['Repeated part', 'Repeated part', 'Other part', 'Invalid'],
  [2, 3, 4, Number.NaN],
)
assert.deepEqual(duplicates?.labels, ['Repeated part', 'Other part'])
assert.deepEqual(duplicates?.values, [5, 4])
assert.equal(duplicates?.sourceCount, 2)

const duplicateLabelsDistinctParts = prepareContributions(
  ['PN-100', 'PN-100', 'PN-200'], [2, 3, 4],
  { mode: 'count', value: 10 }, ['part:0', 'part:1', 'part:2'],
)
assert.equal(duplicateLabelsDistinctParts?.sourceCount, 3,
  'changing the axis to part number must not merge distinct BOM contributors')
assert.deepEqual(duplicateLabelsDistinctParts?.values, [4, 3, 2])

assert.equal(resolveContributionChartMode('auto', 10), 'donut')
assert.equal(resolveContributionChartMode('auto', 11), 'pareto')
assert.equal(resolveContributionChartMode('donut', 100), 'donut')
assert.equal(resolveContributionChartMode('pareto', 1), 'pareto')
assert.equal(resolveContributionChartMode('sankey', 1), 'sankey')
assert.equal(prepareContributions(['Empty'], [0]), null)
assert.equal(truncateContributionLabel('Short label'), 'Short label')
assert.equal(truncateContributionLabel('123456789', 6), '12345…')
assert.equal(formatContributionCategory('hf_low_noise_bjt'), 'HF Low Noise BJT')
assert.equal(formatContributionCategory('gaas_microcircuit'), 'GaAs Microcircuit')
assert.equal(formatContributionCategory(''), 'Unmapped category')

const categoryHierarchy = [
  { id: 'system', label: 'System', parentId: null, value: 10, kind: 'system' },
]
appendContributionPartNode(categoryHierarchy, {
  groupBy: 'part_category', index: 0, category: 'resistor',
  label: 'R1', parentId: 'system', value: 4,
})
appendContributionPartNode(categoryHierarchy, {
  groupBy: 'part_category', index: 1, category: 'resistor',
  label: 'R2', parentId: 'system', value: 6,
})
assert.equal(categoryHierarchy.length, 2)
assert.equal(categoryHierarchy[1].kind, 'category')
assert.equal(categoryHierarchy[1].label, 'Resistor')
assert.equal(categoryHierarchy[1].value, 10,
  'category mode must aggregate sibling parts rather than repeat category labels')

const sankey = prepareContributionSankey([
  { id: 'system', label: 'System', parentId: null, value: 100, kind: 'system' },
  { id: 'block:a', label: 'Power', parentId: 'system', value: 60, kind: 'block' },
  { id: 'block:b', label: 'Control', parentId: 'system', value: 38, kind: 'block' },
  { id: 'part:tiny-1', label: 'Tiny 1', parentId: 'system', value: 1, kind: 'part' },
  { id: 'part:tiny-2', label: 'Tiny 2', parentId: 'system', value: 1, kind: 'part' },
  { id: 'part:a1', label: 'A1', parentId: 'block:a', value: 55, kind: 'part' },
  { id: 'part:a2', label: 'A2', parentId: 'block:a', value: 5, kind: 'part' },
], 2)
assert.ok(sankey)
assert.equal(sankey.total, 100)
assert.equal(sankey.cutoffPercent, 2)
assert.equal(sankey.groupedCount, 2)
assert.ok(sankey.nodeIds.includes('other:system'))
assert.equal(sankey.nodeValues[sankey.nodeIds.indexOf('other:system')], 2)
assert.equal(sankey.values.reduce((sum, value) => sum + value, 0), 160,
  'links encode each visible hierarchy level rather than a flat pie total')
assert.equal(prepareContributionSankey([], 1), null)

console.log('Prediction contribution chart contracts passed')
