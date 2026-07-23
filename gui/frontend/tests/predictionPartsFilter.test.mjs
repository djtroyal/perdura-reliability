import assert from 'node:assert/strict'
import {
  partMatchesFilter,
  partsFilterIsActive,
} from '../src/components/Prediction/partsFilter.ts'

const basePart = {
  name: 'R12', reference_designators: ['R12', 'R13'], part_number: 'ABC-100',
  manufacturer: 'Acme Devices', supplier: 'Preferred Supply',
  description: 'Precision resistor', value: '10 kOhm', package_or_footprint: '0805',
  category: 'resistor', params: {}, quantity: 2,
}
const filter = (overrides = {}) => ({ query: '', category: 'all', status: 'all', ...overrides })

assert.equal(partMatchesFilter(basePart, undefined, filter({ query: 'abc-100' }), 'Fixed Resistor'), true)
assert.equal(partMatchesFilter(basePart, undefined, filter({ query: 'preferred supply' }), 'Fixed Resistor'), true)
assert.equal(partMatchesFilter(basePart, undefined, filter({ query: 'fixed resistor' }), 'Fixed Resistor'), true)
assert.equal(partMatchesFilter(basePart, undefined, filter({ query: 'capacitor' }), 'Fixed Resistor'), false)
assert.equal(partMatchesFilter(basePart, undefined, filter({ category: 'resistor' }), 'Fixed Resistor'), true)
assert.equal(partMatchesFilter(basePart, undefined, filter({ category: 'capacitor' }), 'Fixed Resistor'), false)

assert.equal(partMatchesFilter(basePart, { incompatible: true }, filter({ status: 'errors' }), 'Fixed Resistor'), true)
assert.equal(partMatchesFilter(basePart, { error: 'bad input', excluded: true }, filter({ status: 'errors' }), 'Fixed Resistor'), false)
assert.equal(partMatchesFilter({ ...basePart, bom_mapping: { status: 'provisional' } }, undefined,
  filter({ status: 'review' }), 'Fixed Resistor'), true)
assert.equal(partMatchesFilter({ ...basePart, calculation_enabled: false }, undefined,
  filter({ status: 'disabled' }), 'Fixed Resistor'), true)
assert.equal(partMatchesFilter(basePart, { warnings: ['Check rating'] },
  filter({ status: 'warnings' }), 'Fixed Resistor'), true)
assert.equal(partMatchesFilter({ ...basePart, failure_rate_override_enabled: true }, undefined,
  filter({ status: 'overrides' }), 'Fixed Resistor'), true)
assert.equal(partMatchesFilter(basePart, undefined, filter({ status: 'uncomputed' }), 'Fixed Resistor'), true)
assert.equal(partMatchesFilter(basePart, { failure_rate: 0.1 }, filter({ status: 'uncomputed' }), 'Fixed Resistor'), false)

assert.equal(partsFilterIsActive(filter()), false)
assert.equal(partsFilterIsActive(filter({ query: 'R12' })), true)
assert.equal(partsFilterIsActive(filter({ status: 'errors' })), true)

console.log('Prediction Parts List filter contracts passed')
