import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  adoptDistribution, createFitProvenance, distributionRunSnapshot,
  extractLifeObservations, fitInputFingerprint, isLifeDataFitCurrent,
  lifeDataObservationSignature, resolveAdoptedDistribution,
} from '../src/components/shared/adoptedDistribution.ts'

const options = { projectUnit: 'hours', engineRevision: 3 }
const interval = rows => ({ id: 'mixed', dataFormat: 'interval', intervalRows: rows })
const row = values => ({ id: '', lower: '', upper: '', count: '1', ...values })
const fitted = () => {
  const folio = { id: 'precision', dataFormat: 'individual', dataSource: 'table',
    method: 'MLE', rankMethod: 'benard', ci: .95,
    rows: [1e6, 2e6, 3e6, 4e6].map(time => ({ time: String(time), state: 'F' })),
    result: { CI: .95, results: [{ Distribution: 'Exponential_1P', fit_eligible: true,
      method: 'MLE', rank_method: 'benard', params: { Lambda: 4e-7 } }] },
  }
  folio.dataSig = lifeDataObservationSignature(folio)
  folio.fitProvenance = createFitProvenance(folio, options)
  return folio
}

test('mixed extraction preserves exact densities, all censoring kinds and integer counts', () => {
  const input = interval([
    row({ kind: 'exact', lower: '2.5', count: '3' }),
    row({ lower: '4', upper: '7', count: '2' }),
    row({ upper: '3' }),
    row({ lower: '8', count: '4' }),
    row({ kind: 'exact' }), // placeholder is not an event
  ])
  const observations = extractLifeObservations(input)
  assert.equal(observations.observation_model, 'mixed')
  assert.equal(observations.mixed_observations.length, 4)
  const byKind = Object.fromEntries(observations.mixed_observations.map(item => [item.kind, item]))
  assert.deepEqual(byKind.failure, { kind: 'failure', time: 2.5, count: 3 })
  assert.deepEqual(byKind.interval_censored, { kind: 'interval_censored', lower: 4, upper: 7, count: 2 })
  assert.deepEqual(byKind.left_censored, { kind: 'left_censored', upper: 3, count: 1 })
  assert.deepEqual(byKind.right_censored, { kind: 'right_censored', time: 8, count: 4 })
  assert.equal(lifeDataObservationSignature(input), lifeDataObservationSignature({
    ...input, intervalRows: input.intervalRows.toReversed().map(item => ({
      ...item, key: 'new-key', id: '',
      lower: item.lower ? ` ${Number(item.lower).toExponential()} ` : '',
    })),
  }))
})

test('an exact failure cannot silently become an interval or left-censored event', () => {
  for (const invalid of [
    row({ kind: 'exact', lower: '', upper: '5' }),
    row({ kind: 'exact', lower: '5', upper: '5' }),
    row({ kind: 'exact', lower: '0' }),
    row({ kind: 'exact', lower: 'Infinity' }),
  ]) assert.throws(() => extractLifeObservations(interval([invalid])))
  assert.throws(() => extractLifeObservations(interval([row({ lower: '5', upper: '5' })])))
  assert.throws(() => extractLifeObservations(interval([row({ kind: 'exact', lower: '3', count: '1.5' })])))
  assert.throws(() => extractLifeObservations(interval([row({ kind: 'exact', count: '3' })])))
})

test('interval-only studies keep their existing contract and exact-kind changes invalidate observations', () => {
  const base = interval([row({ lower: '2', upper: '4' }), row({ lower: '5' })])
  assert.deepEqual(extractLifeObservations(base), {
    observation_model: 'interval_censored', interval_observations: [
      { lower: 2, upper: 4, count: 1 }, { lower: 5, upper: null, count: 1 },
    ],
  })
  const exact = { ...base, intervalRows: [base.intervalRows[0], { ...base.intervalRows[1], kind: 'exact' }] }
  assert.notEqual(lifeDataObservationSignature(base), lifeDataObservationSignature(exact))
})

test('all rank schemes are fingerprinted separately from the unchanged observations', () => {
  const base = fitted()
  const methods = ['benard', 'exact_median', 'mean', 'hazen', 'blom', 'kaplan_meier']
  const fingerprints = methods.map(rankMethod => fitInputFingerprint({ ...base, rankMethod }, options))
  assert.equal(new Set(fingerprints).size, methods.length)
  for (const rankMethod of methods) {
    assert.equal(lifeDataObservationSignature({ ...base, rankMethod }), base.dataSig)
  }
  assert.equal(createFitProvenance(base).engineRevision, 3)
})

test('changing rank settings makes the candidate fit stale without changing the adopted model', () => {
  const base = fitted()
  base.adoptedDistribution = adoptDistribution(base, 'Exponential_1P', options)
  assert.equal(isLifeDataFitCurrent(base, options), true)
  const exploring = { ...base, rankMethod: 'hazen' }
  assert.equal(isLifeDataFitCurrent(exploring, options), false)
  const adopted = resolveAdoptedDistribution(exploring, options)
  assert.equal(adopted.status, 'current')
  assert.equal(adopted.model.parameters.Lambda, 4e-7)
  assert.throws(() => adoptDistribution(exploring, 'Exponential_1P', options), /Refit/)
})

test('small positive fitted parameters survive adoption, JSON persistence and linked snapshots', () => {
  const base = fitted()
  base.adoptedDistribution = adoptDistribution(base, 'Exponential_1P', options)
  const restored = JSON.parse(JSON.stringify(base))
  const resolved = resolveAdoptedDistribution(restored, options)
  assert.equal(resolved.status, 'current')
  assert.equal(resolved.model.parameters.Lambda, 4e-7)
  assert.equal(distributionRunSnapshot(resolved).parameters.Lambda, 4e-7)
  assert.equal(Math.exp(-resolved.model.parameters.Lambda * 1e6), Math.exp(-.4))
})
