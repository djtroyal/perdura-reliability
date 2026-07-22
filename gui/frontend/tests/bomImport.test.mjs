import assert from 'node:assert/strict'
import test from 'node:test'

const bom = await import('../src/components/Prediction/bomImport.ts')

test('detects common eBOM columns without assigning one source twice', () => {
  const mapping = bom.detectBomColumns([
    'Reference Designators', 'Qty', 'Manufacturer Part Number', 'Manufacturer',
    'Supplier', 'Supplier Part Number', 'Description', 'Value', 'Footprint',
  ])
  assert.equal(mapping.reference_designators, 'Reference Designators')
  assert.equal(mapping.quantity, 'Qty')
  assert.equal(mapping.part_number, 'Manufacturer Part Number')
  assert.equal(mapping.manufacturer, 'Manufacturer')
  assert.equal(mapping.supplier, undefined)
  assert.equal(mapping.supplier_part_number, 'Supplier Part Number')
  assert.equal(new Set(Object.values(mapping)).size, Object.values(mapping).length)
})

test('treats Supplier as a Manufacturer column alias', () => {
  const supplierOnly = bom.detectBomColumns(['RefDes', 'Supplier'])
  assert.equal(supplierOnly.manufacturer, 'Supplier')
  assert.equal(supplierOnly.supplier, undefined)

  const manufacturerOnly = bom.detectBomColumns(['RefDes', 'Manufacturer'])
  assert.equal(manufacturerOnly.manufacturer, 'Manufacturer')
  assert.equal(manufacturerOnly.supplier, undefined)

  const exportErrorHeaders = bom.detectBomColumns([
    'Designator', "#Column Name Error:' Supplier 1",
    "#Column Name Error:' Supplier Part Number 1",
  ])
  assert.equal(exportErrorHeaders.manufacturer, "#Column Name Error:' Supplier 1")
  assert.equal(exportErrorHeaders.supplier, undefined)
  assert.equal(exportErrorHeaders.supplier_part_number, "#Column Name Error:' Supplier Part Number 1")
})

test('normalizes a Supplier source into Manufacturer only', () => {
  const table = {
    fileName: 'supplier-only.csv', sheet: 'BOM', headerRow: 1,
    headers: ['RefDes', 'Supplier'], warnings: [],
    rows: [{ RefDes: 'U1', Supplier: 'Analog Devices' }],
  }
  const mapping = bom.detectBomColumns(table.headers)
  const [normalized] = bom.normalizeBomRows(table, mapping)
  assert.equal(normalized.values.manufacturer, 'Analog Devices')
  assert.equal(normalized.values.supplier, undefined)
})

test('combines RefDes and description evidence for a high-confidence family', () => {
  const proposal = bom.classifyBomRow({
    sourceRow: 2,
    values: { reference_designators: 'R1, R2', description: 'precision metal film resistor' },
    attributes: {},
  }, 'MIL-HDBK-217F')
  assert.equal(proposal.category, 'resistor')
  assert.equal(proposal.confidence, 'high')
  assert.ok(proposal.matchedRuleIds.includes('ref-resistor'))
  assert.ok(proposal.matchedRuleIds.includes('desc-resistor'))
})

test('description evidence can correct an ambiguous designator family', () => {
  const proposal = bom.classifyBomRow({
    sourceRow: 2,
    values: { reference_designators: 'D1', description: 'N-channel power MOSFET' },
    attributes: {},
  }, 'MIL-HDBK-217F')
  assert.equal(proposal.category, 'fet')
  assert.equal(proposal.params.fet_type, 'mosfet')
  assert.ok(proposal.conflicts.some(value => value.includes('diode')))
})

test('recognizes common abbreviated passive, connector, and IC descriptions', () => {
  const cases = [
    ['C1', 'CAP CER 4.7uF 25V X7R 1206 SMD', 'capacitor'],
    ['R1', 'RES 4.7K OHM 1% 1/10W Thick Film', 'resistor'],
    ['R2', 'ERES 47 Ohm 5% Thick Film', 'resistor'],
    ['J40', 'CONN HDR 30POS', 'connector'],
    ['P1', 'RCPT 8POS PCB', 'connector'],
    ['U4', 'Low-Dropout Linear Voltage Regulator', 'microcircuit'],
    ['U5', 'Module DC-DC Step Down Converter', 'microcircuit'],
    ['U6', 'Digital Isolator CMOS 6-CH', 'microcircuit'],
  ]
  for (const [reference_designators, description, category] of cases) {
    const proposal = bom.classifyBomRow({
      sourceRow: 2, values: { reference_designators, description }, attributes: {},
    }, 'MIL-HDBK-217F')
    assert.equal(proposal.category, category, `${reference_designators}: ${description}`)
    assert.equal(proposal.confidence, 'high', `${reference_designators}: ${description}`)
  }
})

test('specific LED and MOSFET evidence outranks generic designators', () => {
  const led = bom.classifyBomRow({
    sourceRow: 2,
    values: { reference_designators: 'D4', description: 'LED GRN DIFFUSE' },
    attributes: {},
  }, 'MIL-HDBK-217F')
  assert.equal(led.category, 'optoelectronic')
  assert.equal(led.confidence, 'high')

  const mosfet = bom.classifyBomRow({
    sourceRow: 3,
    values: { reference_designators: 'Q100', description: 'MOSFET N-CH 200V' },
    attributes: {},
  }, 'MIL-HDBK-217F')
  assert.equal(mosfet.category, 'fet')
  assert.equal(mosfet.confidence, 'high')
})

test('does not infer motors or connectors from ambiguous designators alone', () => {
  const mountingHole = bom.classifyBomRow({
    sourceRow: 2,
    values: { reference_designators: 'M1-M10', description: 'MTG HOLE PLATED' },
    attributes: {},
  }, 'MIL-HDBK-217F')
  assert.equal(mountingHole.category, undefined)

  const testPoint = bom.classifyBomRow({
    sourceRow: 3,
    values: { reference_designators: 'P1', description: 'TEST POINT THM BLK' },
    attributes: {},
  }, 'MIL-HDBK-217F')
  assert.equal(testPoint.category, undefined)
})

test('maps the canonical family into the active standard', () => {
  const proposal = bom.classifyBomRow({
    sourceRow: 2,
    values: { reference_designators: 'C10', description: 'ceramic capacitor' },
    attributes: {},
  }, 'FIDES')
  assert.equal(proposal.category, 'passive_capacitor')
})

test('custom RE2 rules can supplement built-ins and populate capture parameters', () => {
  const profile = {
    id: 'project-rules', name: 'Project rules', revision: 1, mode: 'supplement',
    createdAt: '2026-07-21T00:00:00Z',
    rules: [{
      id: 'custom-ic-pins', label: 'Custom IC package', kind: 'component', enabled: true,
      conditions: [{ field: 'description', pattern: 'custom IC (?P<pins>\\d+)[ -]?pin', caseInsensitive: true }],
      match: 'all', weight: 500, terminal: true, family: 'ic',
      params: { pins: { value: '$<pins>', transform: 'integer' } },
    }],
  }
  assert.deepEqual(bom.validateBomRegexRule(profile.rules[0]), [])
  const proposal = bom.classifyBomRow({
    sourceRow: 2, values: { description: 'Custom IC 48-pin package' }, attributes: {},
  }, 'MIL-HDBK-217F', profile)
  assert.equal(proposal.category, 'microcircuit')
  assert.equal(proposal.params.pins, 48)
})

test('parameter actions from a losing component family cannot leak into the selected model', () => {
  const profile = {
    id: 'project-rules', name: 'Project', revision: 1, mode: 'replace', createdAt: '',
    rules: [{
      id: 'winner', label: 'Resistor evidence', kind: 'component', enabled: true,
      conditions: [{ field: 'description', pattern: 'resistor', caseInsensitive: true }],
      match: 'all', weight: 200, family: 'resistor',
      params: { style: { value: 'RN' } },
    }, {
      id: 'loser', label: 'Competing IC evidence', kind: 'component', enabled: true,
      conditions: [{ field: 'description', pattern: 'precision', caseInsensitive: true }],
      match: 'all', weight: 100, family: 'ic',
      params: { style: { value: 'not-a-resistor-style' }, device_type: { value: 'memory' } },
    }],
  }
  const proposal = bom.classifyBomRow({
    sourceRow: 2, values: { description: 'precision resistor' }, attributes: {},
  }, 'MIL-HDBK-217F', profile)
  assert.equal(proposal.category, 'resistor')
  assert.deepEqual(proposal.params, { style: 'RN' })
  assert.deepEqual(proposal.matchedRuleIds, ['winner'])
  assert.deepEqual(proposal.evidence, ['Resistor evidence'])
})

test('rejects unsupported or invalid user regex syntax', () => {
  const rule = {
    id: 'unsafe', label: 'Unsupported lookahead', kind: 'component', enabled: true,
    conditions: [{ field: 'description', pattern: '(?=a)a' }], match: 'all', weight: 100,
    family: 'ic',
  }
  assert.ok(bom.validateBomRegexRule(rule).some(message => message.includes('Invalid RE2')))
})

test('imports grouped or expanded rows but leaves automatic mappings excluded', () => {
  const table = {
    fileName: 'bom.csv', sheet: 'BOM', headerRow: 1,
    headers: ['RefDes', 'Qty', 'Description'], warnings: [],
    rows: [{ RefDes: 'R1-R3', Qty: '3', Description: 'resistor' }],
  }
  const args = {
    table,
    mapping: { reference_designators: 'RefDes', quantity: 'Qty', description: 'Description' },
    standard: 'MIL-HDBK-217F', autoMap: true,
    defaultParams: () => ({ style: 'RC' }),
  }
  const grouped = bom.buildBomImportRows({ ...args, expandRefdes: false })
  assert.equal(grouped.length, 1)
  assert.equal(grouped[0].part.quantity, 3)
  assert.deepEqual(grouped[0].part.reference_designators, ['R1', 'R2', 'R3'])
  assert.equal(grouped[0].part.bom_mapping.status, 'provisional')
  assert.equal(grouped[0].part.calculation_enabled, false)

  const expanded = bom.buildBomImportRows({ ...args, expandRefdes: true })
  assert.equal(expanded.length, 3)
  assert.ok(expanded.every(row => row.part.quantity === 1))
})

test('hashes the complete active built-in and supplemental rule definitions', async () => {
  const builtInHash = await bom.sha256BomProfile()
  assert.match(builtInHash, /^[a-f0-9]{64}$/)
  const profile = bom.createBomRegexProfile('Supplement')
  profile.rules.push({
    id: 'custom', label: 'Custom', kind: 'component', enabled: true,
    conditions: [{ field: 'description', pattern: 'custom' }], match: 'all',
    weight: 100, family: 'ic',
  })
  const customHash = await bom.sha256BomProfile(profile)
  assert.match(customHash, /^[a-f0-9]{64}$/)
  assert.notEqual(customHash, builtInHash)
})
