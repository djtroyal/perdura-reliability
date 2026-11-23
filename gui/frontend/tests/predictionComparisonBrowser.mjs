import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'
import { closeViteTestServer } from './viteTestLifecycle.mjs'
const root=new URL('..',import.meta.url).pathname, cache=await mkdtemp(join(tmpdir(),'prediction-comparison-vite-'))
const output=join(tmpdir(),'perdura-prediction-comparison-browser'); await mkdir(output,{recursive:true})
const entry='/__comparison.tsx', fixture=`
import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import '/src/index.css'
import ScenarioComparison from '/src/components/Prediction/ScenarioComparison'
import {predictionScenarioFingerprint} from '/src/components/Prediction/scenarioComparisonModel'
import {systemInputFingerprint} from '/src/store/sharedSystemFingerprint'
import data from '/tests/fixtures/prediction-comparison.json'
import * as project from '/src/store/project'
await project.hydrateProjectStorage(); project.newProject('Comparison browser')
for(const f of data.folios){f.state.result.source_fingerprint=systemInputFingerprint(data.model);f.state.result.scenario_input_fingerprint=predictionScenarioFingerprint(f.state)}
function Fixture(){const[folios,setFolios]=useState(data.folios),[mounted,setMounted]=useState(true);window.comparisonTest={project,dirty:()=>setFolios(f=>f.map((item,i)=>i?item:{...item,dirty:true}))};return <div className="perdura-theme"><button onClick={()=>setMounted(x=>!x)}>Toggle view</button>{mounted&&<ScenarioComparison model={data.model} folios={folios}/>}</div>}
createRoot(document.getElementById('root')).render(<Fixture/>)`
const vite=await createServer({root,cacheDir:cache,logLevel:'error',server:{host:'127.0.0.1',port:0,hmr:false},plugins:[{name:'comparison-fixture',resolveId(id){if(id===entry)return id},load(id){if(id===entry)return fixture},configureServer(server){server.middlewares.use('/__comparison',async(req,res,next)=>{if(req.url!=='/'&&req.url!=='')return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__comparison',`<!doctype html><html lang="en"><head><title>Prediction comparison assurance</title></head><body><main id="root"></main><script type="module" src="${entry}"></script></body></html>`))})}}]})
let browser
const errors=[]
let page
try{
 await vite.listen(); browser=await chromium.launch({headless:true}); page=await browser.newPage({viewport:{width:1440,height:1050}}); page.setDefaultTimeout(90000)
 page.on('pageerror',error=>errors.push(error.message))
 await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__comparison`)
 await expect(page.getByTestId('prediction-comparison-summary')).toBeVisible({timeout:90000})
 const rate=Number((await page.getByTestId('prediction-rate-ratio').innerText()).replace(/,/g,'')), mtbf=Number(await page.getByTestId('prediction-mtbf-ratio').innerText())
 assert.ok(rate>16&&rate<20); assert.ok(Math.abs(rate*mtbf-1)<1e-6)
 await expect(page.getByText('pi_E',{exact:false}).first()).toBeVisible()
 await expect(page.getByText('Calculation provenance',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Swap A and B'}).click()
 const reversed=Number(await page.getByTestId('prediction-rate-ratio').innerText()); assert.ok(Math.abs(reversed*rate-1)<1e-6)
 await expect(page.getByLabel('Baseline A')).toHaveValue('comparison-1')
 await page.getByRole('button',{name:'Toggle view'}).click(); await page.getByRole('button',{name:'Toggle view'}).click()
 await expect(page.getByLabel('Baseline A')).toHaveValue('comparison-1')
 const selection=await page.evaluate(()=>window.comparisonTest.project.getProjectState().modules.predictionComparison)
 assert.deepEqual(selection,{baselineId:'comparison-1',candidateId:'comparison-0'})
 await page.screenshot({path:join(output,'comparison.png'),fullPage:true})
 await page.evaluate(()=>window.comparisonTest.dirty())
 await expect(page.getByRole('status')).toContainText('inputs changed')
 await expect(page.getByTestId('prediction-comparison-summary')).toHaveCount(0)
 assert.deepEqual(errors,[])
 await writeFile(join(output,'report.json'),JSON.stringify({passed:['default 217F recipes','reversible rate and MTBF ratios','factor/source presentation','project-backed pair persistence','stale calculation refusal'],rateRatio:rate,mtbfRatio:mtbf,consoleErrors:errors},null,2))
 console.log('Prediction comparison browser passed: ratios, factors, provenance, persistence and stale-result refusal')
}catch(error){await writeFile(join(output,'failure.json'),JSON.stringify({error:String(error),errors,body:await page?.locator('body').innerText().catch(()=>null)},null,2));throw error}finally{await browser?.close();await closeViteTestServer(vite,cache)}
