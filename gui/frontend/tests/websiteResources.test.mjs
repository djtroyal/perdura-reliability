import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { captures, validateCaptureRegistry, WEBSITE_RESOURCE_SCHEMA } from '../website/captures.mjs'
import {
  isTransientCaptureContextError, withTransientCaptureRetry,
} from '../website/capture-retry.mjs'
import {
  CAPTURE_API_CONTRACT, captureServerIdentity, VERSION_ENDPOINT_PATTERN,
} from '../website/server-compatibility-fixture.mjs'

assert.equal(WEBSITE_RESOURCE_SCHEMA, 'perdura.website-resources/v1')
assert.deepEqual(validateCaptureRegistry(captures), [])
assert.ok(captures.length >= 80, `expected comprehensive submodule coverage; found ${captures.length}`)

const modules = new Set(captures.map(capture => capture.module))
for (const module of [
  'dashboard', 'life-data', 'alt', 'system-modeling', 'allocation', 'prediction',
  'pof', 'growth', 'maintenance', 'hra', 'warranty', 'hypothesis',
  'data-analysis', 'six-sigma', 'report-builder',
]) assert.ok(modules.has(module), `missing primary module: ${module}`)

const requiredSubmodules = [
  'life-data.special', 'life-data.weibayes', 'life-data.cfm', 'life-data.compare',
  'rdt.chi-squared', 'test.goodness-of-fit', 'degradation.destructive',
  'system.rbd', 'system.fta', 'system.markov', 'allocation.overview',
  'pof.eyring', 'pof.norris-landzberg', 'pof.tddb', 'pof.fracture',
  'growth.rocof', 'maintenance.virtual-age', 'hra.therp', 'hra.mermos',
  'modeling.workflow', 'six-sigma.doe', 'report-builder.overview',
]
const ids = new Set(captures.map(capture => capture.id))
for (const id of requiredSubmodules) assert.ok(ids.has(id), `missing capture: ${id}`)

const legacyFiles = [
  'alt-halt.png', 'alt-life-stress.png', 'alt-step-sequential-stress.png',
  'alt-test-design-and-planning-expected-failure-times.png', 'failure-rate-prediction.png',
  'hra-cream-extended.png', 'hra-cream.png', 'hra-overview.png', 'hra-spar-h.png',
  'hypothesis-tests-anova.png', 'hypothesis-tests-parametric.png', 'lda-non-param.png',
  'lda-parametric.png', 'lda-s-s.png', 'maintenance-avail-sensitivity.png',
  'maintenance-availability.png', 'maintenance-maintainability.png', 'maintenance-pm-interval.png',
  'maintenance-spares.png', 'pof-arrhenius.png', 'pof-coffin-manson.png',
  'pof-electromigration.png', 'pof-mean-stress-correction.png', 'pof-s-n-curve.png',
  'reliability-degradation-and-screening-burn-in-design.png',
  'reliability-degradation-and-screening-destructive.png',
  'reliability-degradation-and-screening-ess.png',
  'reliability-degradation-and-screening-hass.png',
  'reliability-degradation-and-screening-non-destructive.png',
  'reliability-growth-duane.png', 'reliability-growth-mcf.png',
  'reliability-testing-rdt-non-parametric-bayesian.png',
  'reliability-testing-rdt-parametric-binomial.png',
  'reliability-testing-test-design-and-planning-difference-detection-matrix.png',
  'reliability-testing-test-design-and-planning-sequential-sampling.png',
  'reliability-testing-test-design-and-planning-simulation.png', 'report-builder.png',
  'six-sigma-msa.png', 'six-sigma-process-capability.png', 'six-sigma-spc.png',
  'statistical-modeling-descriptive-boxplot-violin.png',
  'statistical-modeling-descriptive-correlation-qq-plot.png',
  'statistical-modeling-descriptive-ecdf-run-chart.png',
  'statistical-modeling-descriptive-raincloud-scatter-matrix.png',
  'system-modeling-fta.png', 'system-modeling-markov-analysis.png',
  'system-modeling-rbd.png', 'warranty-analysis.png',
]
const files = new Set(captures.map(capture => capture.file))
for (const file of legacyFiles) assert.ok(files.has(file), `legacy website filename is unregistered: ${file}`)

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'website-showcase')
const compatibilitySource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'api', 'serverCompatibility.ts'),
  'utf8',
)
const frontendContract = compatibilitySource.match(/export const FRONTEND_API_CONTRACT = (\d+)/)?.[1]
assert.equal(String(CAPTURE_API_CONTRACT), frontendContract, 'capture API contract must match the frontend')
const fixtureIndex = JSON.parse(readFileSync(resolve(fixtureDir, 'index.json'), 'utf8'))
assert.equal(fixtureIndex.schema, 'perdura.website-showcase-fixtures/v1')
const indexedFixtures = new Map(fixtureIndex.captures.map(record => [record.id, record]))
for (const capture of captures.filter(item => item.resultRequired)) {
  const record = indexedFixtures.get(capture.id)
  assert.ok(record, `missing completed-analysis fixture index entry: ${capture.id}`)
  assert.ok(record.modules.length > 0, `fixture has no persisted modules: ${capture.id}`)
  assert.ok(existsSync(resolve(fixtureDir, `${capture.id}.json`)), `missing fixture file: ${capture.id}`)
  if (capture.fixtureId) {
    assert.ok(indexedFixtures.has(capture.fixtureId), `shared fixture is not indexed: ${capture.fixtureId}`)
    assert.ok(existsSync(resolve(fixtureDir, `${capture.fixtureId}.json`)), `shared fixture file is missing: ${capture.fixtureId}`)
  }
}
assert.equal(indexedFixtures.size, captures.filter(item => item.resultRequired).length)

assert.equal(VERSION_ENDPOINT_PATTERN.test('http://127.0.0.1:4173/api/v1/version'), true)
assert.equal(VERSION_ENDPOINT_PATTERN.test(
  'http://127.0.0.1:4173/api/v1/version?client_api_contract=1&cache_bust=123',
), true)
const captureIdentity = captureServerIdentity('0.7.0')
assert.equal(captureIdentity.api_contract, CAPTURE_API_CONTRACT)
assert.equal(captureIdentity.minimum_client_api_contract, CAPTURE_API_CONTRACT)
assert.equal(captureIdentity.maximum_client_api_contract, CAPTURE_API_CONTRACT)
assert.equal(captureIdentity.commit, 'dev', 'capture identity must not trigger a refresh notice')

assert.equal(isTransientCaptureContextError(new Error('Execution context was destroyed, most likely because of a navigation.')), true)
assert.equal(isTransientCaptureContextError(new Error('completed-analysis fixture did not load')), false)

let attempts = 0
const retries = []
const recovered = await withTransientCaptureRetry(async attempt => {
  attempts += 1
  if (attempt < 3) throw new Error('page.evaluate: Execution context was destroyed')
  return 'captured'
}, { onRetry: details => retries.push(details) })
assert.equal(recovered, 'captured')
assert.equal(attempts, 3)
assert.deepEqual(retries.map(item => [item.attempt, item.nextAttempt]), [[1, 2], [2, 3]])

let nonTransientAttempts = 0
await assert.rejects(
  withTransientCaptureRetry(async () => {
    nonTransientAttempts += 1
    throw new Error('fixture is invalid')
  }),
  /fixture is invalid/,
)
assert.equal(nonTransientAttempts, 1)

console.log(`website-resource contracts passed (${captures.length} captures)`)
