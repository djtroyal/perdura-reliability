import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { createSsrTestServer } from './viteTestLifecycle.mjs'
const vite=await createSsrTestServer({root:new URL('..',import.meta.url).pathname,appType:'custom',server:{middlewareMode:true,ws:{server:createHttpServer()}}})
try {
  const tools=await vite.ssrLoadModule('/src/api/lifeTools.ts')
  assert.deepEqual(tools.parseLifetimeGrid('1, 2,\n','ages'),[1,2])
  assert.deepEqual(tools.parseLifetimeGrid('0:1:.25','ages'),[0,.25,.5,.75,1])
  for(const invalid of ['2 bad 3',',','0:1:0','1:-1:1']) assert.throws(()=>tools.parseLifetimeGrid(invalid,'ages'))
  assert.throws(()=>tools.parseLifetimeGrid('0:10000:1','ages'))
  const csv=tools.survivalMatrixCsv({ages:[6.5],durations:[1],failure:[[1e-20]],survival:[[1]]},'failure','hours')
  assert.ok(csv.includes('1e-20'))
  assert.ok(csv.includes('Additional 1 hours'))
  const {api}=await vite.ssrLoadModule('/src/api/client.ts')
  let sent;api.post=async(path,body)=>{sent={path,body};return {data:{ok:true}}}
  await tools.computeInspectionPrediction({n:20,failures:0,first_age:1,second_age:2,betas:[1,2],level:.95,prior_alpha:.5,prior_beta:.5,prior_sensitivity:true})
  assert.equal(sent.path,'/life-tools/inspection-prediction')
  assert.deepEqual(sent.body.betas,[1,2]);assert.equal(sent.body.failures,0)
  console.log('Lifetime input, export and prediction contracts passed')
} finally {await vite.close()}
