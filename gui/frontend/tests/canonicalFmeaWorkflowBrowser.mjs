import assert from 'node:assert/strict'
import {mkdtemp,readFile,mkdir,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createServer} from 'vite'
import {chromium,expect} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {closeViteTestServer} from './viteTestLifecycle.mjs'
const root=new URL('..',import.meta.url).pathname,cacheDir=await mkdtemp(join(tmpdir(),'perdura-canonical-workflow-vite-'))
const outputArg=process.argv.indexOf('--output-dir'),output=outputArg<0?join(tmpdir(),'perdura-canonical-workflow'):resolve(process.argv[outputArg+1])
await mkdir(output,{recursive:true})
const aircraft=JSON.parse(await readFile(new URL('./fixtures/aircraftArchitecture.json',import.meta.url),'utf8'))
const route='/__canonical-workflow.tsx'
const fixture=`
import React from 'react';import {createRoot} from 'react-dom/client';import '/src/index.css'
import Workspace from '/src/components/ReliabilityProgram/AiagVdaWorkspace'
import {KeyboardShortcutProvider} from '/src/components/shared/KeyboardShortcuts'
import {ReportAssetScopeProvider} from '/src/components/shared/ReportAssetScope'
import * as project from '/src/store/project'
import {useSharedSystemDefinition,currentProjectSystem,commitProjectSystem} from '/src/store/sharedSystem'
import {useSharedFmeaState} from '/src/store/useSharedFmeaState'
import {bindFmeaAnalysis} from '/src/store/sharedFmeaModel'
import {createProjectSystem} from '/src/store/sharedSystemModel'
import {createFmeaFailureChain} from '/src/store/fmeaDefaults'
import {createFmeaAnalysis} from '/src/components/ReliabilityProgram/fmeaModel'
import {EMPTY_FMEA_VOCABULARY_PROFILE} from '/src/components/ReliabilityProgram/fmeaVocabulary'
await project.hydrateProjectStorage();project.newProject('Canonical workflow')
const model=${JSON.stringify(aircraft)};commitProjectSystem({...createProjectSystem('Aircraft'),model})
const analysis=bindFmeaAnalysis(model,createFmeaAnalysis('dfmea',1),'motor-controller')
const initial={analyses:[analysis],activeId:analysis.id,step:4,view:'guided'}
function App(){const [system]=useSharedSystemDefinition();const [state,set]=useSharedFmeaState('fmea',initial,'analyses')
window.workflow={createFmeaFailureChain,read:()=>state,set,system:()=>currentProjectSystem().model,changeModel:model=>commitProjectSystem({...currentProjectSystem(),model})}
return <Workspace analyses={state.analyses} systemModel={system.model} activeId={state.activeId} onActiveId={activeId=>set(s=>({...s,activeId}))}
view={state.view} onView={view=>set(s=>({...s,view}))} step={state.step} onStep={step=>set(s=>({...s,step}))}
onAnalysesChange={analyses=>set(s=>({...s,analyses}))} predictionSources={[]} programRequirements={[]} customProfiles={[]} builtInProfiles={[]}
vocabularyProfile={EMPTY_FMEA_VOCABULARY_PROFILE} hazardOptions={[]} fracasOptions={[]} onProfilesChange={()=>{}} onVocabularyProfileChange={()=>{}} onNavigateReference={()=>{}}/>}
createRoot(document.getElementById('root')).render(<KeyboardShortcutProvider><ReportAssetScopeProvider value={{module:'fmea',moduleLabel:'FMEA'}}><main className="perdura-theme h-screen"><App/></main></ReportAssetScopeProvider></KeyboardShortcutProvider>)`
const vite=await createServer({root,cacheDir,logLevel:'error',server:{host:'127.0.0.1',port:0,hmr:false},plugins:[{name:'canonical-workflow',resolveId(id){if(id===route)return id},load(id){if(id===route)return fixture},configureServer(server){server.middlewares.use('/__canonical-workflow',async(req,res,next)=>{if(!['/',''].includes(req.url?.split('?')[0]))return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__canonical-workflow','<!doctype html><html lang="en"><head><title>Canonical FMEA workflow</title></head><body><div id="root"></div><script type="module" src="/__canonical-workflow.tsx"></script></body></html>'))})}}]})
let browser;const errors=[],checks=[]
const readonlyText='This work is read-only until its prerequisites are complete.'
try{
 await vite.listen();browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1600,height:1100}});const page=await context.newPage()
 page.on('pageerror',e=>errors.push(e.message))
 await page.route(url=>url.pathname.startsWith('/api/'),route=>route.fulfill({status:503,body:'Local draft readiness only'}))
 await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__canonical-workflow`)
 await expect(page.getByText(readonlyText,{exact:false})).toHaveCount(0)
 await page.getByRole('button',{name:/Planning & preparation$/i}).click()
 await expect(page.getByLabel('Subject',{exact:true})).toBeEnabled()
 await expect(page.getByLabel('Subject',{exact:true})).toHaveValue('')
 await expect(page.getByText('Planning suggestions (optional)',{exact:true})).toBeVisible()
 await expect(page.getByText('Planning suggestions (optional)',{exact:true}).locator('..')).not.toHaveAttribute('open')
 await expect(page.getByRole('progressbar',{name:'Core planning definition complete'})).toHaveCount(0)
 await page.getByRole('button',{name:/Function analysis$/i}).click()
 await expect(page.getByText(readonlyText,{exact:false})).toHaveCount(0)
 const functionTitle=await page.evaluate(()=>window.workflow.read().analyses[0].functions.find(f=>f.system_definition_ref.instance_id==='motor-controller').description)
 await page.getByRole('button',{name:functionTitle,exact:true}).click()
 await expect(page.getByRole('group',{name:'Function definition',exact:true})).toBeVisible()
 await expect(page.getByRole('combobox',{name:'Function kind',exact:true})).toHaveValue('transform')
 checks.push('Blank optional planning fields allow structured function authoring; planning suggestions remain collapsed')
 await page.evaluate(()=>window.workflow.set(s=>{const a=s.analyses[0],fn=a.functions.find(f=>f.system_definition_ref.instance_id==='motor-controller');return {...s,step:4,analyses:[{...a,failure_chains:[{...window.workflow.createFmeaFailureChain('dfmea','FC-1'),function_id:fn.id,failure_mode:'Fails to receive supply',cause:'Open input connection',effect:'Control unavailable',cause_structure_node_id:fn.structure_node_id,effect_function_id:fn.id,effect_contexts:[],actions:[],severity:7,occurrence:3,detection:3,operating_modes:[],remarks:'Retain assessment',linked_hazard_ids:[],linked_fracas_ids:[],management_review_evidence_ids:[]}]}]}}))
 await expect.poll(()=>page.evaluate(()=>window.workflow.read().analyses[0].failure_chains.length)).toBe(1)
 await page.getByRole('button',{name:/Optimization$/i}).click()
 await expect(page.getByText(readonlyText,{exact:false})).toBeVisible()
 await page.getByRole('button',{name:'Open Step 5',exact:true}).click()
 await page.getByLabel('Severity rationale',{exact:true}).fill('Loss of propulsion control defines the effect severity.')
 await page.getByLabel('Occurrence rationale',{exact:true}).fill('Connection qualification and service evidence support the selected rating.')
 await page.getByLabel('Detection rationale',{exact:true}).fill('A continuity check detects the open input connection.')
 await page.getByRole('button',{name:/Optimization$/i}).click()
 await expect(page.getByText(readonlyText,{exact:false})).toHaveCount(0)
 checks.push('Ratings require an explicit assessment basis before optimization unlocks')
 await page.getByRole('button',{name:/Failure analysis$/i}).click()
 const parentSupport=aircraft.function_links.find(l=>l.id==='support-motor-controller').source
 await page.evaluate(parent=>{const w=window.workflow,m=structuredClone(w.system());m.instances=m.instances.map(item=>item.id===parent.instance_id?{...item,function_overrides:[...item.function_overrides.filter(o=>o.function_id!==parent.function_id),{function_id:parent.function_id,enabled:false}]}:item);w.changeModel(m)},parentSupport)
 await expect(page.getByText(readonlyText,{exact:false})).toBeVisible()
 const before=await page.evaluate(()=>JSON.stringify(window.workflow.read().analyses[0].failure_chains))
 await page.getByRole('button',{name:'Consolidated worksheet',exact:true}).click()
 await expect(page.locator('fieldset[disabled]')).toBeVisible()
 await page.evaluate(()=>window.workflow.set(s=>({...s,analyses:s.analyses.map(a=>({...a,failure_chains:a.failure_chains.map(c=>({...c,severity:10}))}))})))
 assert.equal(await page.evaluate(()=>JSON.stringify(window.workflow.read().analyses[0].failure_chains)),before)
 checks.push('Upstream invalidation retains assessment and blocks worksheet plus direct store mutations')
 await page.getByRole('button',{name:'Seven steps',exact:true}).click();await page.getByRole('button',{name:'Open Step 3',exact:true}).click()
 await expect(page.getByText('Step 3 completeness',{exact:true})).toBeVisible()
 await page.evaluate(original=>{const w=window.workflow,m=structuredClone(w.system());m.instances=m.instances.map(item=>item.id===original.id?{...item,function_overrides:original.function_overrides}:item);w.changeModel(m)},aircraft.instances.find(item=>item.id===parentSupport.instance_id))
 await page.getByRole('button',{name:/Failure analysis$/i}).click()
 await expect(page.getByText(readonlyText,{exact:false})).toHaveCount(0)
 assert.equal(await page.evaluate(()=>JSON.stringify(window.workflow.read().analyses[0].failure_chains)),before)
 checks.push('Repairing canonical support restores editing without losing downstream work')
 const axe=await new AxeBuilder({page}).include('.fmea-workspace').withTags(['wcag2a','wcag2aa']).analyze()
 assert.deepEqual(axe.violations.filter(v=>v.impact==='serious'||v.impact==='critical'),[])
 assert.deepEqual(errors,[])
 await page.screenshot({path:join(output,'canonical-fmea.png'),fullPage:true})
 await writeFile(join(output,'browser.json'),JSON.stringify({checks,errors,accessibilityViolations:axe.violations.length},null,2)+'\n')
 console.log(JSON.stringify({checks,output}))
}finally{await browser?.close();await closeViteTestServer(vite,cacheDir)}
