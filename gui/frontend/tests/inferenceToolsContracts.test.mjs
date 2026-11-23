import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { createSsrTestServer } from './viteTestLifecycle.mjs'
const server = createHttpServer()
const vite = await createSsrTestServer({ root: new URL('..', import.meta.url).pathname, appType: 'custom', server: { middlewareMode: true, ws: { server } } })
try {
  const model = await vite.ssrLoadModule('/src/components/ALT/inferenceToolContracts.ts')
  const persistence = await vite.ssrLoadModule('/src/components/ALT/reliabilityTestingState.ts')
  assert.deepEqual(model.outcomeList('0, 1\n0 0\n'), [0,1,0,0])
  assert.throws(() => model.outcomeList('0 bad 1'), /finite number/)
  assert.throws(() => model.outcomeList('0 2'), /0.*1/)
  assert.throws(() => model.finiteInput('', 'Exposure'), /finite/)
  assert.throws(() => model.finiteInput('1e309', 'Exposure'), /finite/)
  assert.deepEqual(model.exposureRows('10, 100, .8\n2\t50\t1\n'), [
    {label:'Group 1',units:10,duration:100,duty:.8}, {label:'Group 2',units:2,duration:50,duty:1},
  ])
  assert.throws(() => model.exposureRows('2, 3'), /requires/)
  assert.throws(() => model.exposureRows('2, 3, 1.2'), /duty/)
  const state = { totalExposure:'800',result:null }
  assert.equal(model.inferenceSignature(state),model.inferenceSignature({...state,result:{mtbf:100}}))
  assert.notEqual(model.inferenceSignature(state),model.inferenceSignature({...state,totalExposure:'801'}))
  const stamped = { ...state, result: { estimate: 10, _inputSignature: model.inferenceSignature(state), _units: 'hours' } }
  assert.equal(model.inferenceResultStatus(stamped, 'hours').current, true)
  assert.equal(model.inferenceResultStatus({ ...stamped, totalExposure: '801' }, 'hours').current, false)
  assert.equal(model.inferenceResultStatus(stamped, 'days').current, false)
  assert.equal(model.inferenceResultStatus({ ...state, result: { estimate: 10 } }, 'hours').current, false)
  for (const key of ['aggregateMTBF','normalSummary','discreteProbability']) {
    assert.ok(persistence.RELIABILITY_TESTING_TOOL_KEYS.includes(key))
    const saved=persistence.updateTestingToolState({},key,state,{totalExposure:'1200',result:{estimate:10}})
    const restored=persistence.mergeTestingToolState(JSON.parse(JSON.stringify(saved)),key,{...state,sides:'two-sided'})
    assert.equal(restored.totalExposure,'1200')
    assert.equal(restored.result.estimate,10)
    assert.equal(restored.sides,'two-sided')
  }
  console.log('Inference parsing, stale-result signatures, and project-backed state passed')
} finally { await vite.close() }
