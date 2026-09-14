import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'vite'

const hmrServer = createHttpServer()
const vite = await createServer({
  root: new URL('..', import.meta.url).pathname,
  appType: 'custom',
  server: { middlewareMode: true, ws: { server: hmrServer } },
})

try {
  const contracts = await vite.ssrLoadModule(
    '/src/components/ALT/reliabilityTestingState.ts')

  const expectedKeys = [...contracts.RELIABILITY_TESTING_TOOL_KEYS].sort()
  assert.equal(expectedKeys.length, 18)
  assert.equal(new Set(expectedKeys).size, expectedKeys.length)

  const stepInitial = {
    rows: [], useStress: '60', result: null,
  }
  const haltInitial = {
    rows: [], stressType: 'temperature', result: null,
  }
  const stepResult = { exponent_p: 2.1, distribution_fit: { summary: { mean: 100 } } }
  const haltResult = { operating_limit: 105, destruct_limit: 125 }

  let state = {}
  state = contracts.updateTestingToolState(
    state, 'stepStress', stepInitial,
    { rows: [{ time: '120', stress: '85' }], result: stepResult },
  )
  state = contracts.updateTestingToolState(
    state, 'halt', haltInitial,
    { rows: [{ stress: '105', outcome: 'anomaly' }], result: haltResult },
  )

  // Reading a different tool and then returning to the first one must retain
  // both its inputs and computed output.
  assert.equal(
    contracts.mergeTestingToolState(state, 'halt', haltInitial).result,
    haltResult,
  )
  const restoredStep = contracts.mergeTestingToolState(
    state, 'stepStress', { ...stepInitial, distribution: 'Weibull' })
  assert.equal(restoredStep.rows[0].time, '120')
  assert.equal(restoredStep.result, stepResult)
  assert.equal(restoredStep.distribution, 'Weibull')

  const stepModel = await vite.ssrLoadModule('/src/components/ALT/stepStressState.ts')
  const inputs = {
    rows: [{ time: '120', stress: '85' }, { time: '600', status: 'right_censored' }],
    steps: [{ stress: '85', duration: '500' }, { stress: '105', duration: '500' }],
    useStress: '60', fitMode: 'joint', fixedExponent: '', confidence: '.95',
  }
  const request = stepModel.buildStepStressRequest(inputs)
  assert.equal(request.schema_version, 2)
  assert.equal(request.distribution, 'Weibull_2P')
  assert.deepEqual(request.observations, [
    { time: 120, status: 'failure', stress_at_observation: 85 },
    { time: 600, status: 'right_censored' },
  ])
  assert.equal(stepModel.isLegacyStepStressResult(stepResult), true)
  assert.equal(stepModel.isLegacyStepStressResult({ schema: 'perdura.step-stress/legacy-v1' }), true)
  assert.equal(stepModel.isLegacyStepStressResult({ schema: 'perdura.step-stress/v2' }), false)
  assert.equal(restoredStep.result, stepResult, 'Historical results remain inspectable')
  assert.throws(() => stepModel.buildStepStressRequest({ ...inputs, rows: [{ time: '120garbage' }] }), /finite number/)
  assert.throws(() => stepModel.buildStepStressRequest({ ...inputs, steps: [{ stress: '85', duration: '' }] }), /duration/)
  assert.throws(() => stepModel.buildStepStressRequest({ ...inputs, rows: [{ time: '', stress: '85' }] }), /time/)
  assert.throws(() => stepModel.buildStepStressRequest({ ...inputs, fitMode: 'fixed_exponent', fixedExponent: '' }), /Fixed exponent/)
  const fixed = stepModel.buildStepStressRequest({ ...inputs, fitMode: 'fixed_exponent', fixedExponent: '0' })
  assert.equal(fixed.fixed_exponent, 0)

  const project = await vite.ssrLoadModule('/src/store/project.ts')
  assert.equal(project.hasComputedResults(state), true)
  assert.equal(
    project.moduleSlices('alt').includes(contracts.RELIABILITY_TESTING_TOOLS_SLICE),
    true,
  )
  // Keep the registry and actual hook consumers synchronized so a newly added
  // Reliability Testing analysis cannot silently fall back to transient state.
  const sourceFiles = [
    'src/components/ALT/index.tsx',
    'src/components/ALT/ALTTestTypes.tsx',
    'src/components/ALT/RDTTools.tsx',
    'src/components/ALT/TestDesignTools.tsx',
    'src/components/ALT/ReliabilityTestingTools.tsx',
  ]
  const usedKeys = new Set()
  for (const relative of sourceFiles) {
    const source = await readFile(new URL(`../${relative}`, import.meta.url), 'utf8')
    for (const match of source.matchAll(/useTestingToolState\(\s*['"]([^'"]+)['"]/g)) {
      usedKeys.add(match[1])
    }
  }
  assert.deepEqual([...usedKeys].sort(), expectedKeys)

  // Sparse two-proportion tables use Fisher's exact test and return z=null.
  // The results view must identify that method instead of formatting null.
  const testingToolsSource = await readFile(
    new URL('../src/components/ALT/ReliabilityTestingTools.tsx', import.meta.url), 'utf8')
  assert.match(testingToolsSource, /res\.method === 'fisher-exact'/)
  assert.doesNotMatch(testingToolsSource, /res\.z\.toFixed/)

  console.log('Reliability Testing state persistence contracts passed')
} finally {
  await vite.close()
}
