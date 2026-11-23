import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { createSsrTestServer } from './viteTestLifecycle.mjs'
const vite = await createSsrTestServer({ root: new URL('..', import.meta.url).pathname, appType: 'custom', server: { middlewareMode: true, ws: { server:createHttpServer() } } })
try {
  const tools = await vite.ssrLoadModule('/src/components/Prediction/scenarioComparisonModel.ts')
  const {systemInputFingerprint} = await vite.ssrLoadModule('/src/store/sharedSystemFingerprint.ts')
  const fixture = JSON.parse(await readFile(new URL('./fixtures/prediction-comparison.json', import.meta.url),'utf8'))
  const {model,folios} = fixture
  for (const folio of folios) {
    folio.state.result.source_fingerprint = systemInputFingerprint(model)
    folio.state.result.scenario_input_fingerprint = tools.predictionScenarioFingerprint(folio.state)
  }
  const [a,b] = folios, pair = tools.comparePredictionScenarios(model,a,b)
  assert.deepEqual(pair.reasons,[])
  assert.ok(pair.rateRatio > 16 && pair.rateRatio < 20)
  assert.ok(Math.abs(pair.rateRatio * pair.mtbfRatio - 1) < 1e-12)
  assert.equal(pair.rows.length,2)
  for (const row of pair.rows) {
    assert.deepEqual(row.factors.map(f=>f.key),['pi_E'])
    assert.equal(row.factors[0].ratio,row.id==='r1'?16:20)
  }
  assert.equal(pair.inputs[0].key,'environment')
  const reversed = tools.comparePredictionScenarios(model,b,a)
  assert.ok(Math.abs(reversed.rateRatio * pair.rateRatio - 1) < 1e-12)
  assert.ok(Math.abs(reversed.mtbfRatio * pair.mtbfRatio - 1) < 1e-12)
  assert.equal(reversed.rateDifference,-pair.rateDifference)
  assert.equal(tools.predictionScenarioFingerprint({...a.state,result:null,contributionGroupBy:'category'}),tools.predictionScenarioFingerprint(a.state))
  const reject = (alter, pattern) => {
    const copy=structuredClone(fixture); alter(copy)
    const result=tools.comparePredictionScenarios(copy.model,copy.folios[0],copy.folios[1])
    assert.ok(result.reasons.some(reason=>pattern.test(reason)),JSON.stringify(result.reasons))
    assert.equal(result.rateRatio,null); assert.deepEqual(result.rows,[])
  }
  reject(c=>{c.folios[0].dirty=true},/inputs changed/)
  reject(c=>{c.folios[0].state.partInputs.r1.params.power_stress=.8},/recipe provenance/)
  reject(c=>{delete c.folios[0].state.result.scenario_input_fingerprint},/recipe provenance/)
  reject(c=>{c.model.instances[1].quantity=11},/older shared system/)
  reject(c=>{c.folios[1].state.result.methodology.edition='Different'},/different prediction/)
  reject(c=>{c.folios[1].state.result.canonical_system_id='other'},/different or older shared system/)
  reject(c=>{c.folios[1].state.result.results[0].traceability.section='other'},/model sources/)
  reject(c=>{c.folios[1].state.result.results[0].quantity=99},/matching part/)
  reject(c=>{c.folios[1].state.result.excluded_part_count=1},/excluded/)
  reject(c=>{c.folios[1].state.result.service_rate_available=false},/calendar-hour/)
  reject(c=>{c.folios[1].state.result.results[0].part_id='missing'},/BOM identities/)
  const zero=structuredClone(a); zero.id='zero'; zero.state.result.total_failure_rate=0; zero.state.result.mtbf_hours=null
  assert.equal(tools.comparePredictionScenarios(model,zero,b).rateRatio,null)
  assert.equal(tools.comparePredictionScenarios(model,a,zero).mtbfRatio,null)
  console.log('Prediction comparison: real default 217F fixture, reversible ratios, factor attribution and 11 fail-closed provenance checks passed')
} finally { await vite.close() }
