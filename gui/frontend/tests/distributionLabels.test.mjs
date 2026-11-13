import assert from 'node:assert/strict'
import { test } from 'node:test'
import { distributionLabel, distributionTitle } from '../src/components/shared/distributionLabels.ts'

test('distribution labels spell out parameter counts and conventional family names', () => {
  for (const [id, expected] of [
    ['Weibull_2P', 'Weibull (2-parameter)'], ['Weibull_3P', 'Weibull (3-parameter)'],
    ['Exponential_1P', 'Exponential (1-parameter)'], ['Normal_2P', 'Normal (2-parameter)'],
    ['Lognormal_3P', 'Lognormal (3-parameter)'], ['Loglogistic_2P', 'Log-logistic (2-parameter)'],
    ['Gamma_2P', 'Gamma (2-parameter)'], ['Beta_2P', 'Beta (2-parameter)'],
    ['Gumbel_2P', 'Gumbel (2-parameter)'], ['loglogistic', 'Log-logistic'],
    ['log-normal', 'Lognormal'], [' weibull ', 'Weibull'],
  ]) assert.equal(distributionLabel(id), expected)
})

test('unknown and absent distribution names have readable, safe fallbacks', () => {
  assert.equal(distributionLabel('Custom_family_4P'), 'Custom family (4-parameter)')
  assert.equal(distributionLabel('Weibull_Mixture'), 'Weibull Mixture')
  assert.equal(distributionLabel('Already friendly'), 'Already friendly')
  for (const empty of ['', ' ', undefined, null, {}, 42]) assert.equal(distributionLabel(empty), '—')
})

test('report titles format known identifiers without changing unrelated content', () => {
  assert.equal(distributionTitle('Weibull_2P Probability Plot'), 'Weibull (2-parameter) Probability Plot')
  assert.equal(distributionTitle('Loglogistic_3P (specified) — SF'), 'Log-logistic (3-parameter) (specified) — SF')
  assert.equal(distributionTitle('Weibull_Eyring — Life vs Stress'), 'Weibull Eyring — Life vs Stress')
  assert.equal(distributionTitle('Project_A_2P result'), 'Project_A_2P result')
})
