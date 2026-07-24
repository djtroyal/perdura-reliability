import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'vite'

const hmrServer = createHttpServer()
const vite = await createServer({
  root: new URL('..', import.meta.url).pathname,
  appType: 'custom',
  server: { middlewareMode: true, ws: { server: hmrServer } },
})

const methodology = {
  standard_id: 'MIL-HDBK-217F', edition: 'Notice 2', authority: 'DoD',
  method_scope: '', implementation_scope: '', known_exclusions: '',
  conformance_tier: 'verified', clause_coverage: [],
  source: { title: '', url: null, access: '' },
  authoritative_example_validation: { status: 'passed', passed: 1, total: 1, note: '' },
  reviewed_on: '2026-07-18', full_conformance_claimed: false,
  tier_definition: { label: '', meaning: '', contract_use: '' },
}

const supportedPart = {
  name: 'R1', category: 'resistor', quantity: 2, multiplier: 1,
  failure_rate: 0.65, total_failure_rate: 1.3, contribution: 1,
  pi_factors: {}, vita: false, parent_id: 'power',
  operating_failure_rate_fpmh: 2,
  nonoperating_failure_rate_fpmh: 0.2,
  service_failure_rate_fpmh: 0.65,
  service_rate_available: true,
  effective_operating_fraction: 0.25,
  system_contribution_failure_rate: 1.3,
  traceability: {
    standard: 'MIL-HDBK-217F', section: '§9.1', handbook_pages: '',
    model: 'Resistor', equation: '', unit: 'FPMH',
    result_context: 'Conditional handbook planning estimate.',
  },
  nonoperating_calculation: {
    status: 'supported', source: 'RADC-TR-85-91', model: 'fixed resistor',
    failure_rate: 0.2, traceability: {
      standard: 'RADC-TR-85-91', report_section: '5.2.7', handbook_pages: '',
      model: 'fixed resistor', equation: '', unit: 'FPMH',
    },
  },
}

const block = {
  id: 'power', name: 'Power board', parent_id: null, quantity: 1,
  operating_fraction: 0.25, effective_operating_fraction: 0.25,
  operating_environment: 'GF', nonoperating_environment: 'GB',
  nonoperating_temperature_c: 25,
  power_cycles_per_1000_nonoperating_hours: 1,
  operating_handbook_subtotal_failure_rate: 4,
  handbook_subtotal_failure_rate: 4, rolled_up_failure_rate: 1.3,
  service_rate_available: true, rate_time_basis: 'calendar_hours',
  failure_rate_override_enabled: false, override_applied: false,
  failure_rate: 1.3, service_failure_rate_fpmh: 1.3,
  total_failure_rate: 1.3, system_expanded_failure_rate: 1.3,
  system_contribution_failure_rate: 1.3, included_in_system_total: true,
  contribution: 1, descendant_part_indices: [0],
}

const deratingResult = {
  standard: 'RADC-TR-84-254', derating_level: 'II',
  summary: { ok: 1, exceeds: 0, not_evaluated: 2 },
  methodology,
  results: [{
    name: 'R1', category: 'resistor', family: 'fixed_resistor',
    subtype: 'power_wirewound', selected_level: 'II',
    overall_status: 'not_evaluated',
    coverage: { evaluated: 1, required: 2, complete: false },
    message: 'One required criterion could not be evaluated.',
    assumptions: ['Rated power applies at the stated ambient temperature.'],
    warnings: ['Rated voltage was not supplied.'],
    traceability: { standard: 'RADC-TR-84-254', section: 'Table 8' },
    derating: [{
      rule_id: 'RADC84254-T8-POWER', parameter: 'power_stress_ratio',
      description: 'Applied-to-rated power ratio', unit: 'ratio',
      actual_value: 0.4, allowable_value: 0.5, comparison: '<=', margin: 0.1,
      formula: 'P_{applied}/P_{rated} \\le 0.5',
      substitution: '4 W / 10 W = 0.4 \\le 0.5',
      source: {
        title: 'RADC-TR-84-254', section: 'Table 8',
        printed_pages: '18–19', pdf_pages: '26–27',
      },
      notes: ['Temperature derating is evaluated separately.'],
      status: 'ok', message: null,
    }, {
      rule_id: 'RADC84254-T8-VOLTAGE', parameter: 'voltage_stress_ratio',
      description: 'Applied-to-rated voltage ratio', unit: 'ratio',
      actual_value: null, allowable_value: 0.8, comparison: '<=', margin: null,
      formula: 'V_{applied}/V_{rated} \\le 0.8', substitution: null,
      source: { title: 'RADC-TR-84-254', section: 'Table 8' },
      notes: [], status: 'not_evaluated', message: 'Rated voltage is required.',
    }],
  }, {
    name: 'F1', category: 'filter', family: 'saw_filter',
    subtype: 'surface_acoustic_wave', selected_level: null,
    overall_status: 'not_evaluated',
    coverage: { evaluated: 0, required: 1, complete: false },
    message: 'No automatic absolute-power check is defined for this SAW case.',
    assumptions: [], warnings: [], traceability: {
      standard: 'RADC-TR-84-254', section: 'Table 10',
    },
    derating: [],
  }],
}

try {
  const project = await vite.ssrLoadModule('/src/store/project.ts')
  const extractors = await vite.ssrLoadModule('/src/store/assetExtractors.ts')
  project.getProjectState().modules.prediction = {
    missionHours: '1000', contributionScope: 'system',
    parts: [{
      name: 'R1', parentId: 'power', quantity: 2, category: 'resistor',
      reference_designators: ['R1', 'R2'], part_number: 'PN-100',
      manufacturer: 'Example Components', supplier: 'Example Distributor',
      supplier_part_number: 'SUP-100', description: 'Precision resistor',
      value: '10 kOhm', package_or_footprint: '0805', population_status: 'fitted',
      bom_source: { file_name: 'board.xlsx', sheet: 'BOM', source_row: 12 },
      bom_mapping: {
        status: 'confirmed', source: 'auto', confidence: 'high',
        rule_profile_id: 'builtin-perdura', rule_profile_revision: 1,
        rule_profile_sha256: 'abc123',
      },
    }],
    blocks: [{ id: 'power', name: 'Power board', parentId: null, operatingFraction: 0.25 }],
    deratingResult,
    result: {
      standard: 'MIL-HDBK-217F', environment: 'GF', vita_global: false,
      total_failure_rate: 1.3, service_failure_rate_fpmh: 1.3,
      service_rate_available: true, rate_time_basis: 'calendar_hours',
      mtbf_hours: 769230.8, results: [supportedPart], blocks: [block], methodology,
    },
  }

  const assets = extractors.enumerateAssets()
    .filter(asset => asset.module === 'prediction')
  const named = label => assets.find(asset => asset.label === label)

  const bomTrace = named('Imported BOM Mapping Traceability')?.getData()
  assert.ok(bomTrace)
  assert.equal(bomTrace.tableRows.length, 1)
  assert.equal(bomTrace.tableRows[0][0], 'R1, R2')
  assert.equal(bomTrace.tableRows[0][2], 'PN-100')
  assert.equal(bomTrace.tableRows[0][11], 'confirmed')
  assert.equal(bomTrace.tableRows[0][15], 'abc123')
  assert.equal(bomTrace.tableRows[0][16], 'board.xlsx')
  assert.equal(bomTrace.tableRows[0][17], 'BOM')
  assert.equal(bomTrace.tableRows[0][18], 12)

  const deratingSummary = named('Derating Summary')?.getData()
  assert.ok(deratingSummary)
  const deratingSummaryMap = Object.fromEntries(
    deratingSummary.metrics.map(row => [row.label, row.value]),
  )
  assert.equal(deratingSummaryMap.Profile, 'RADC-TR-84-254')
  assert.equal(deratingSummaryMap['Selected level'], 'II')
  assert.equal(deratingSummaryMap['Required checks evaluated'], '1 of 3')

  const deratingChecks = named('Derating Checks')?.getData()
  assert.ok(deratingChecks)
  assert.equal(deratingChecks.tableRows.length, 3)
  const selectedLevelColumn = deratingChecks.tableHeaders.indexOf('Selected level')
  const formulaColumn = deratingChecks.tableHeaders.indexOf('Formula')
  const substitutionColumn = deratingChecks.tableHeaders.indexOf('Substitution')
  const sourceColumn = deratingChecks.tableHeaders.indexOf('Source')
  assert.equal(deratingChecks.tableRows[0][formulaColumn], 'P_{applied}/P_{rated} \\le 0.5')
  assert.match(String(deratingChecks.tableRows[0][substitutionColumn]), /4 W \/ 10 W/)
  assert.match(String(deratingChecks.tableRows[0][sourceColumn]), /Table 8/)
  assert.match(String(deratingChecks.tableRows[0][sourceColumn]), /printed 18–19/)
  assert.equal(deratingChecks.tableRows[0][selectedLevelColumn], 'II')
  const zeroCheckRow = deratingChecks.tableRows.find(row => row[0] === 'F1')
  assert.ok(zeroCheckRow, 'a part with zero emitted checks must remain reportable')
  assert.equal(zeroCheckRow[1], 'saw_filter')
  assert.equal(zeroCheckRow[selectedLevelColumn], 'Not applicable')
  assert.equal(zeroCheckRow[deratingChecks.tableHeaders.indexOf('Part status')], 'not_evaluated')
  assert.equal(zeroCheckRow[deratingChecks.tableHeaders.indexOf('Coverage')], '0 of 1')
  assert.match(String(zeroCheckRow[deratingChecks.tableHeaders.indexOf('Message')]),
    /No automatic absolute-power check/)

  const deratingGuidance = named('Derating Assumptions and Warnings')?.getData()
  assert.ok(deratingGuidance)
  assert.deepEqual(deratingGuidance.tableRows, [
    ['R1', 'Assumption', 'Rated power applies at the stated ambient temperature.'],
    ['R1', 'Warning', 'Rated voltage was not supplied.'],
  ])

  const parts = named('Parts Summary Table')?.getData()
  assert.ok(parts)
  assert.deepEqual(parts.tableHeaders, [
    'Part', 'Category', 'Qty', 'Operating λ (FPMH)',
    'Nonoperating λ (FPMH)', 'Service-life λ (FPMH)',
    'Nonoperating status', 'System service λ (FPMH)', 'Override',
  ])
  assert.equal(parts.tableRows[0][3], '2.0000')
  assert.equal(parts.tableRows[0][4], '0.2000')
  assert.equal(parts.tableRows[0][5], '0.6500')
  assert.equal(parts.tableRows[0][6], 'RADC model')

  const trace = named('Nonoperating Model Traceability')?.getData()
  assert.ok(trace)
  assert.match(String(trace.tableRows[0][2]), /RADC-TR-85-91/)
  assert.equal(trace.tableRows[0][4], '5.2.7')

  const blocks = named('System Block Summary')?.getData()
  assert.ok(blocks)
  assert.ok(blocks.tableHeaders.includes('Operating fraction'))
  assert.ok(blocks.tableHeaders.includes('Nonoperating env'))
  assert.ok(!blocks.tableHeaders.some(header => /duty|dormant/i.test(header)))

  const summary = named('System Summary')?.getData()
  assert.ok(summary)
  const summaryMap = Object.fromEntries(summary.metrics.map(row => [row.label, row.value]))
  assert.equal(summaryMap['Operating handbook system λ (FPMH)'], '4.0000')
  assert.equal(summaryMap['Service-life system λ (FPMH)'], '1.3000')
  assert.equal(summaryMap['Rate time basis'], 'Calendar hours')

  const reliability = named('System Reliability vs Time')?.getData()
  assert.ok(reliability)
  assert.equal(reliability.plotLayout.xaxis.title.text, 'Calendar time (hours)')
  assert.equal(reliability.plotData[0].name, 'Service-life R(t)')

  const compactContribution = named('System Failure Rate Contribution')?.getData()
  assert.ok(compactContribution)
  assert.equal(compactContribution.plotData[0].type, 'pie')

  const largeParts = Array.from({ length: 12 }, (_, index) => ({
    name: `Part ${index + 1}`, parentId: null, quantity: 1, category: 'resistor',
  }))
  project.getProjectState().modules.prediction = {
    missionHours: '1000', contributionScope: 'system', contributionChartMode: 'auto',
    contributionCutoffMode: 'count', contributionTopCount: 6,
    parts: largeParts, blocks: [],
    result: {
      standard: 'MIL-HDBK-217F', environment: 'GF', vita_global: false,
      total_failure_rate: 78, service_failure_rate_fpmh: 78,
      service_rate_available: true, rate_time_basis: 'calendar_hours',
      mtbf_hours: 1_000_000 / 78, methodology,
      results: largeParts.map((part, index) => ({
        ...supportedPart,
        name: part.name,
        parent_id: null,
        failure_rate: index + 1,
        total_failure_rate: index + 1,
        line_total_failure_rate: index + 1,
        system_contribution_failure_rate: index + 1,
      })),
      blocks: [],
    },
  }
  const largeContribution = extractors.enumerateAssets()
    .find(asset => asset.module === 'prediction' && asset.label === 'System Failure Rate Contribution')
    ?.getData()
  assert.ok(largeContribution)
  assert.equal(largeContribution.plotData[0].type, 'bar')
  assert.equal(largeContribution.plotData[1].name, 'Cumulative share')
  assert.equal(largeContribution.plotData[0].y.at(-1), 'Remaining (6)')
  assert.equal(largeContribution.plotData[0].x.at(-1), 21)
  assert.equal(largeContribution.plotData[1].x.at(-1), 100)

  project.getProjectState().modules.prediction = {
    ...project.getProjectState().modules.prediction,
    contributionChartMode: 'donut',
    contributionLabelBy: 'part_category',
  }
  const categoryContribution = extractors.enumerateAssets()
    .find(asset => asset.module === 'prediction'
      && asset.label === 'System Failure Rate Contribution')
    ?.getData()
  assert.ok(categoryContribution)
  assert.deepEqual(categoryContribution.plotData[0].labels, ['Resistor'])
  assert.deepEqual(categoryContribution.plotData[0].values, [78],
    'report assets must aggregate same-category part contributions')

  project.getProjectState().modules.prediction = {
    ...project.getProjectState().modules.prediction,
    contributionChartMode: 'sankey',
    contributionLabelBy: 'reference_designator',
    contributionSankeyCutoffPercent: 10,
  }
  const sankeyContribution = extractors.enumerateAssets()
    .find(asset => asset.module === 'prediction'
      && asset.label === 'System Failure Rate Contribution')
    ?.getData()
  assert.ok(sankeyContribution)
  assert.equal(sankeyContribution.plotData[0].type, 'sankey')
  assert.ok(sankeyContribution.plotData[0].node.label.includes('Other (7)'))
  const otherIndex = sankeyContribution.plotData[0].node.label.indexOf('Other (7)')
  const otherLink = sankeyContribution.plotData[0].link.target.indexOf(otherIndex)
  assert.equal(sankeyContribution.plotData[0].link.value[otherLink], 28)

  project.getProjectState().modules.prediction = {
    result: {
      standard: 'MIL-HDBK-217F', environment: 'GF', vita_global: false,
      total_failure_rate: null, service_failure_rate_fpmh: null,
      service_rate_available: false, rate_time_basis: 'calendar_hours',
      mtbf_hours: null, methodology,
      results: [{
        ...supportedPart, parent_id: null, failure_rate: null,
        total_failure_rate: null, service_failure_rate_fpmh: null,
        service_rate_available: false, system_contribution_failure_rate: null,
        nonoperating_failure_rate_fpmh: null,
        nonoperating_calculation: {
          status: 'unavailable', source: 'RADC-TR-85-91', failure_rate: null,
          reason: 'No exact report family maps to this technology.',
        },
      }],
    },
  }
  const unavailableAssets = extractors.enumerateAssets()
    .filter(asset => asset.module === 'prediction')
  const unavailableSummary = unavailableAssets.find(asset => asset.label === 'System Summary')?.getData()
  assert.equal(unavailableSummary.metrics.find(row => row.label === 'Service-rate status')?.value,
    'Unavailable')
  assert.ok(!unavailableAssets.some(asset => asset.label === 'System Reliability vs Time'),
    'an unavailable service rate must not produce a reliability curve')

  project.getProjectState().modules.prediction = {
    result: null,
    deratingResult,
  }
  const deratingOnlyAssets = extractors.enumerateAssets()
    .filter(asset => asset.module === 'prediction')
  assert.ok(deratingOnlyAssets.some(asset => asset.label === 'Derating Summary'))
  assert.ok(deratingOnlyAssets.some(asset => asset.label === 'Derating Checks'))
  assert.ok(deratingOnlyAssets.some(asset => asset.label === 'Derating Assumptions and Warnings'))
  assert.ok(!deratingOnlyAssets.some(asset => asset.label === 'Parts Summary Table'),
    'derating assets must not depend on a failure-rate result')

  console.log('prediction report asset contracts passed')
} finally {
  await vite.close()
}
