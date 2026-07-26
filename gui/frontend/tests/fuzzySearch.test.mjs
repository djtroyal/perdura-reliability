import assert from 'node:assert/strict'

import {
  findSearchMatch,
  matchesSearchQuery,
  normalizeSearchText,
} from '../src/searchMatch.ts'

assert.equal(normalizeSearchText('  FMEA_MÉCHANISM  '), 'fmea mechanism')
assert.equal(findSearchMatch('thermal', [
  'Coefficient of thermal expansion',
])?.kind, 'exact')
assert.equal(findSearchMatch('coeffec', [
  'Coefficient of thermal expansion',
])?.kind, 'fuzzy')
assert.equal(findSearchMatch('coeffec therm expan', [
  'Coefficient of thermal expansion',
])?.kind, 'fuzzy')
assert.equal(findSearchMatch('chaff', ['Chafing'])?.kind, 'fuzzy')
assert.equal(findSearchMatch('cof', [
  'Coefficient of thermal expansion',
]), undefined)
assert.equal(findSearchMatch('xyzabc', [
  'Coefficient of thermal expansion',
]), undefined)
assert.ok(matchesSearchQuery('electr overstres', [
  'Electrical and electronic',
  'Suffers electrical overstress',
]))
assert.ok(matchesSearchQuery('electr overstres', [
  'Electrical and electronic',
  'Overstress protection',
]), 'Query tokens may match across separate descriptive fields')
assert.ok(!matchesSearchQuery('hydraulic', [
  'Software timing violation',
  'Incorrect command',
]))

console.log('Shared fuzzy-search contracts passed')
