/** Shared canonical geometry and hierarchical FMEA boundary-focus presentation. */
import assert from 'node:assert/strict'
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createServer} from 'vite'
import {chromium,expect} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {closeViteTestServer} from './viteTestLifecycle.mjs'
const root=new URL('..',import.meta.url).pathname
const flag=process.argv.indexOf('--output-dir')
const output=resolve(flag<0?join(tmpdir(),'perdura-shared-fmea-diagram'):process.argv[flag+1])
await mkdir(output,{recursive:true})
const cacheDir=await mkdtemp(join(tmpdir(),'perdura-shared-fmea-diagram-vite-'))
const entry='/__shared_fmea_diagram.tsx'
const fixture=`
import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import '/src/index.css'
import SharedFmeaDiagram from '/src/components/ReliabilityProgram/SharedFmeaDiagram'
import {createFmeaAnalysis} from '/src/components/ReliabilityProgram/fmeaModel'
import {materializeFmeaAnalysis,splitFmeaUpdate,fmeaEngineeringInputs} from '/src/store/sharedFmeaModel'
import {useUiPreference} from '/src/store/uiPreferences'
import {KeyboardShortcutProvider} from '/src/components/shared/KeyboardShortcuts'
import {ReportAssetScopeProvider} from '/src/components/shared/ReportAssetScope'
import demo from '/src/data/demoProject.json'
const initial=structuredClone(demo.modules.systemDefinition.model)
initial.version=4
// Focus interactions use a small synthetic boundary graph below. Keep its
// placement independent from the bundled example's overview composition.
const positions={
 'pump-system':[80,80], 'hydraulic-supply':[110,150], 'pump-a':[140,220],
 'pump-b':[140,330], 'b1':[460,150], 'power-connector':[490,220],
 'pressure-sensor':[730,220], 'hydraulic-voltage-monitor':[490,330],
}
initial.diagrams[0].nodes=initial.diagrams[0].nodes.map(item=>positions[item.instance_id]
 ? {...item,x:positions[item.instance_id][0],y:positions[item.instance_id][1]} : item)
const edge=initial.interfaces[0]
for(const definition of initial.definitions.filter(item=>item.kind==='piece_part')) definition.ports=[
 {id:'in',name:'Input',interface_type:edge.interface_type,direction:'input',description:'',properties:{}},
 {id:'out',name:'Output',interface_type:edge.interface_type,direction:'output',description:'',properties:{}}]
initial.interfaces=[
 {...structuredClone(edge),id:'cross-a',name:'First part supply',source:{instance_id:'demo-part-1',port_id:'out'},target:{instance_id:'pump-a',port_id:'discharge'},source_function_ids:[],target_function_ids:[]},
 {...structuredClone(edge),id:'cross-b',name:'Second part supply',source:{instance_id:'demo-part-2',port_id:'out'},target:{instance_id:'pump-a',port_id:'discharge'},source_function_ids:[],target_function_ids:[]},
 {...structuredClone(edge),id:'internal',name:'Hidden internal interface',source:{instance_id:'demo-part-1',port_id:'out'},target:{instance_id:'demo-part-2',port_id:'in'},source_function_ids:[],target_function_ids:[]},
 {...structuredClone(edge),id:'unrelated',name:'Unrelated pump interface',source:{instance_id:'pump-a',port_id:'discharge'},target:{instance_id:'pump-b',port_id:'discharge'},source_function_ids:[],target_function_ids:[]},
]
initial.interfaces.forEach(item=>{item.flow_description='';item.transfers=[]})
initial.diagrams[0].nodes.push({instance_id:'demo-part-1',x:999,y:777,width:180,height:72,expanded:false})
const study=createFmeaAnalysis('dfmea',1);study.id='focus-browser-study'
study.system_binding={version:1,system_model_id:initial.id,scope_instance_id:initial.root_instance_id}
const resourceGraph=structuredClone(initial)
resourceGraph.resources.push({id:'browser-power',name:'Browser power',category:'energy'}, {id:'browser-output',name:'Browser output',category:'energy'})
for(const [id,io] of [
 ['pump-a',[{id:'power-out',resource_id:'browser-power',direction:'output'}]],
 ['demo-part-1',[{id:'power-in',resource_id:'browser-power',direction:'input'},{id:'result-out',resource_id:'browser-output',direction:'output'}]],
 ['pump-b',[{id:'result-in',resource_id:'browser-output',direction:'input'}]],
]){
 const instance=resourceGraph.instances.find(item=>item.id===id),baseDefinition=resourceGraph.definitions.find(item=>item.id===instance.definition_id)
 instance.definition_id='browser-definition-'+id;instance.function_overrides=[];instance.failure_mode_overrides=[]
 resourceGraph.definitions.push({...structuredClone(baseDefinition),id:instance.definition_id,ports:[],failure_modes:[],functions:[
  {id:'browser-fn',description:'Browser resource transformation',function_type:'primary',mode_ids:[],definition:{role:io.some(item=>item.direction==='input')?'transform':'source',action:'Browser resource transformation',io}}
 ]})
}
const terminal=(instance_id,io_id)=>({kind:'function',instance_id,function_id:'browser-fn',io_id})
resourceGraph.interfaces=[
 {...structuredClone(edge),id:'browser-in',name:'Controller resource input',interface_type:'energy',directionality:'directed',source:{instance_id:'pump-a'},target:{instance_id:'demo-part-1'},mode_ids:[],
  transfers:[{id:'input-transfer',kind:'flow',resource_id:'browser-power',source:terminal('pump-a','power-out'),target:terminal('demo-part-1','power-in'),mode_ids:[]}]},
 {...structuredClone(edge),id:'browser-out',name:'Controller resource output',interface_type:'energy',directionality:'directed',source:{instance_id:'demo-part-1'},target:{instance_id:'pump-b'},mode_ids:[],
  transfers:[{id:'output-transfer',kind:'flow',resource_id:'browser-output',source:terminal('demo-part-1','result-out'),target:terminal('pump-b','result-in'),mode_ids:[]}]},
]
function App(){
 const [model,setModel]=useState(initial),[source,setSource]=useState(study),[writes,setWrites]=useState(0)
 const [focus,setFocus]=useUiPreference('fmea.focus:'+model.id+':'+source.id,'b1')
 const analysis=materializeFmeaAnalysis(model,source)
 window.diagramTest={snapshot:()=>({model:structuredClone(model),analysis:structuredClone(analysis),inputs:fmeaEngineeringInputs([analysis]),writes,focus}),
   loadResourceGraph:()=>{setModel(structuredClone(resourceGraph));setSource(study);setFocus('b1')},
   removeFocus:()=>setModel(current=>({...current,instances:current.instances.filter(item=>item.id!==focus),interfaces:current.interfaces.filter(item=>item.source.instance_id!==focus&&item.target.instance_id!==focus)}))}
 return <KeyboardShortcutProvider><ReportAssetScopeProvider value={{module:'fmea',moduleLabel:'FMEA'}}>
 <div className="perdura-theme flex h-screen min-h-0 flex-col p-3"><SharedFmeaDiagram analysis={analysis} model={model}
 focusInstanceId={focus} onFocusInstanceId={setFocus} fillHeight update={patch=>{
 const next=splitFmeaUpdate(model,analysis,{...analysis,...patch});setModel(next.model);setSource(next.analysis);setWrites(value=>value+1)
 }}/></div></ReportAssetScopeProvider></KeyboardShortcutProvider>
}
createRoot(document.getElementById('root')).render(<App/> )
`
const vite=await createServer({root,cacheDir,logLevel:'error',server:{host:'127.0.0.1',port:0,hmr:false},plugins:[{
 name:'shared-fmea-diagram-browser',resolveId(id){if(id===entry)return id},load(id){if(id===entry)return fixture},
 configureServer(server){server.middlewares.use('/__shared_fmea_diagram',async(req,res,next)=>{
 if(!['','/'].includes(req.url?.split('?')[0]))return next()
 res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__shared_fmea_diagram',
 '<!doctype html><html lang="en"><head><title>Shared FMEA diagram</title></head><body><div id="root"></div><script type="module" src="'+entry+'"></script></body></html>'))
 })}}]})
let browser,page
const errors=[],checks=[]
const node=id=>page.locator('.react-flow__node[data-id="SD-BLOCK-'+id+'"]')
const snapshot=()=>page.evaluate(()=>window.diagramTest.snapshot())
try{
 await vite.listen();browser=await chromium.launch({headless:true})
 const context=await browser.newContext({viewport:{width:1560,height:1000},reducedMotion:'reduce'})
 page=await context.newPage()
 page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(90000);page.on('pageerror',error=>errors.push(error.message))
 await page.goto('http://127.0.0.1:'+vite.httpServer.address().port+'/__shared_fmea_diagram')
 await expect(page.getByRole('combobox',{name:'Item of focus',exact:true})).toHaveValue('b1',{timeout:90000})
 await expect(node('b1')).toBeVisible();await expect(node('pump-a')).toBeVisible()
 for(const id of ['pump-b','demo-part-1','demo-part-2','demo-part-3']) await expect(node(id)).toHaveCount(0)
 await expect(page.locator('.react-flow__edge')).toHaveCount(1)
 const before=await snapshot();assert.equal(before.writes,0)
 await expect(page.getByRole('complementary',{name:'Diagram properties',exact:true})).toHaveCount(1)
 const axeCheck=async()=>{
   const result=await new AxeBuilder({page}).include('[aria-label="FMEA focus controls"]')
     .include('[aria-label="FMEA focus breadcrumb"]').include('[aria-label="Diagram properties"]')
     .include('[aria-label="Connector style"]').include('[aria-label="Toggle inspector"]')
     .withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()
   assert.deepEqual(result.violations.map(item=>({id:item.id,nodes:item.nodes.map(node=>({target:node.target,summary:node.failureSummary}))})),[])
 }
 await axeCheck()
 const inspectorToggle=page.getByRole('button',{name:'Toggle inspector',exact:true})
 await expect(inspectorToggle).toHaveCount(1)
 const stableToggle=await inspectorToggle.elementHandle()
 await inspectorToggle.focus();await page.keyboard.press('Enter')
 await expect(inspectorToggle).toHaveAttribute('aria-expanded','false')
 await expect(page.getByRole('complementary',{name:'Diagram properties',exact:true})).toHaveCount(0)
 await page.keyboard.press('Enter')
 await expect(inspectorToggle).toHaveAttribute('aria-expanded','true')
 assert.equal(await inspectorToggle.evaluate((current,original)=>current===original,stableToggle),true)
 const styleControl=page.getByRole('combobox',{name:'Connector style',exact:true})
 await expect(styleControl).toHaveValue('curved')
 for(const style of ['orthogonal','straight','curved']) {
   await styleControl.selectOption(style)
   assert.deepEqual((await snapshot()).inputs,before.inputs,'Focus connector styling cannot change calculation inputs')
   assert.equal((await snapshot()).model.diagrams[0].connectorStyle,style,'Connector presentation is shared with the master diagram')
 }
 await axeCheck()
 checks.push('One stable keyboard inspector toggle; all connector choices retain focused-study calculation inputs')
 const parts=page.getByRole('checkbox',{name:'Include piece parts in focus selector',exact:true})
 await parts.focus();await page.keyboard.press('Space');await expect(parts).toBeChecked()
 await page.keyboard.press('Space');await expect(parts).not.toBeChecked()
 await page.getByRole('searchbox',{name:'Find a system item',exact:true}).fill(before.model.instances.find(item=>item.id==='pump-a').name)
 await expect(page.getByRole('combobox',{name:'Item of focus',exact:true}).locator('option[value="pump-a"]')).toHaveCount(1)
 await page.getByRole('searchbox',{name:'Find a system item',exact:true}).fill('')
 await node('pump-a').click()
 await page.getByRole('button',{name:'Focus here',exact:true}).focus();await page.keyboard.press('Enter')
 await expect(page.getByRole('combobox',{name:'Item of focus',exact:true})).toHaveValue('pump-a')
 await page.getByRole('button',{name:'Back',exact:true}).focus();await page.keyboard.press('Enter')
 await expect(page.getByRole('combobox',{name:'Item of focus',exact:true})).toHaveValue('b1')
 assert.deepEqual((await snapshot()).inputs,before.inputs,'Keyboard focus/navigation must retain every calculation input')
 checks.push('Keyboard focus action, Back, part selector, search, exactly one inspector, and scoped WCAG AA accessibility')
 checks.push('Assembly focus rolls up two part interfaces, omits internal and unrelated links, and hides piece parts')
 const beforeInterfaceEdit=await snapshot()
 await page.locator('.react-flow__edge[data-id*="cross-a"] button').click()
 await expect(page.getByText('Aggregated interfaces',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:/First part supply/}).click()
 await expect(page.getByText(/Actual endpoints:.*Microprocessor/)).toBeVisible()
 await axeCheck()
 await page.getByRole('textbox',{name:'Interface name',exact:true}).fill('Canonical supply renamed')
 await expect.poll(async()=>(await snapshot()).model.interfaces.find(item=>item.id==='cross-a').name).toBe('Canonical supply renamed')
 let after=await snapshot()
 assert.deepEqual(JSON.parse(JSON.stringify(after.model.interfaces.find(item=>item.id==='cross-a').source)),before.model.interfaces.find(item=>item.id==='cross-a').source)
 assert.deepEqual(after.model.interfaces.find(item=>item.id==='internal'),before.model.interfaces.find(item=>item.id==='internal'))
 assert.deepEqual(after.model.diagrams,beforeInterfaceEdit.model.diagrams)
 checks.push('Bundled-interface edit updates exact canonical record and retains actual part endpoint, hidden interface, and shared geometry')
 const beforeLayout=await snapshot()
 const box=await node('b1').boundingBox()
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down()
 await page.mouse.move(box.x+box.width/2+85,box.y+box.height/2+65,{steps:8});await page.mouse.up()
 await expect.poll(async()=>page.evaluate(()=>Object.keys(localStorage).some(key=>key.includes('fmea.diagramView:')))).toBe(true)
 assert.notDeepEqual((await snapshot()).model.diagrams[0].nodes.find(node=>node.instance_id==='b1'),beforeLayout.model.diagrams[0].nodes.find(node=>node.instance_id==='b1'),'Focus drag writes master placement')
 assert.ok((await snapshot()).writes>beforeLayout.writes,'Focus drag writes canonical geometry')
 assert.deepEqual((await snapshot()).inputs,beforeLayout.inputs,'Focus layout must retain every calculation input')
 checks.push('Focused dragging updates canonical geometry without changing analytical inputs')
 await page.getByRole('checkbox',{name:'Include piece parts in focus selector',exact:true}).check()
 await page.getByRole('combobox',{name:'Item of focus',exact:true}).selectOption('demo-part-1')
 await expect(node('demo-part-1')).toBeVisible();await expect(node('demo-part-2')).toHaveCount(0)
 await expect(node('b1')).toBeVisible()
 await page.getByRole('button',{name:'Up',exact:true}).click()
 await expect(page.getByRole('combobox',{name:'Item of focus',exact:true})).toHaveValue('b1')
 await page.getByRole('button',{name:'Back',exact:true}).click()
 await expect(page.getByRole('combobox',{name:'Item of focus',exact:true})).toHaveValue('demo-part-1')
 await page.reload()
 await expect(page.getByRole('combobox',{name:'Item of focus',exact:true})).toHaveValue('demo-part-1')
 checks.push('Explicit piece-part focus, keyboard-accessible selectors, Up/Back and reload memory')
 await page.evaluate(()=>window.diagramTest.removeFocus())
 await expect(page.getByRole('combobox',{name:'Item of focus',exact:true})).toHaveValue('b1')
 checks.push('Deleted focal item falls back to nearest surviving ancestor')
 await page.evaluate(()=>window.diagramTest.loadResourceGraph())
 await expect(page.locator('.react-flow__edge')).toHaveCount(2)
 const resourceBefore=await snapshot()
 const connections=page.getByRole('combobox',{name:'Selected block connections',exact:true})
 await expect(connections.locator('option[value="suppliers"]')).toBeEnabled()
 await connections.selectOption('suppliers')
 await expect(page.locator('.react-flow__edge')).toHaveCount(1)
 await expect(page.locator('.react-flow__edge[data-id*="browser-in"]')).toHaveCount(1)
 await expect(node('pump-a')).toBeVisible();await expect(node('pump-b')).toHaveCount(0)
 await expect(node('b1')).toBeVisible()
 await connections.selectOption('recipients')
 await expect(page.locator('.react-flow__edge[data-id*="browser-out"]')).toHaveCount(1)
 await expect(node('pump-b')).toBeVisible();await expect(node('pump-a')).toHaveCount(0)
 await connections.selectOption('both')
 await expect(page.locator('.react-flow__edge')).toHaveCount(2)
 await expect(node('pump-a')).toBeVisible();await expect(node('pump-b')).toBeVisible()
 assert.deepEqual((await snapshot()).model,resourceBefore.model,'Directional focus filters cannot rewrite the canonical system or placement')
 assert.deepEqual((await snapshot()).inputs,resourceBefore.inputs,'Directional focus filters cannot change engineering inputs')
 checks.push('FMEA supplier/recipient filters use focused assembly inherited inputs and outputs, retain only matching partners, and preserve canonical data')
 await page.getByRole('button',{name:'Collapse all systems',exact:true}).click()
 await expect(page.getByRole('button',{name:'Collapse all systems',exact:true})).toBeDisabled()
 const viewKey=await page.evaluate(()=>Object.keys(localStorage).find(key=>key.includes('fmea.diagramView:')&&key.includes(':b1:all')))
 const collapsedView=await page.evaluate(key=>JSON.parse(JSON.parse(localStorage.getItem(key))),viewKey)
 assert.ok(Object.values(collapsedView.expandedByNodeId).every(value=>value===false),'Collapse all records every expanded container as closed')
 assert.deepEqual((await snapshot()).model,resourceBefore.model,'FMEA Collapse all cannot change the master diagram or architecture')
 assert.deepEqual((await snapshot()).inputs,resourceBefore.inputs,'FMEA Collapse all cannot change engineering inputs')
 await page.getByRole('combobox',{name:'Item of focus',exact:true}).selectOption('pump-a')
 await page.getByRole('combobox',{name:'Item of focus',exact:true}).selectOption('b1')
 await expect(page.getByRole('button',{name:'Collapse all systems',exact:true})).toBeDisabled()
 await expect(connections).toHaveValue('both')
 assert.deepEqual((await snapshot()).model,resourceBefore.model,'Focus round-trip retains canonical geometry')
 await axeCheck()
 checks.push('FMEA Collapse all is remembered per focus, preserves geometry and calculation inputs, and survives focus navigation')
 await page.screenshot({path:join(output,'shared-fmea-focus.png')})
 assert.deepEqual(errors,[])
 await writeFile(join(output,'browser.json'),JSON.stringify({status:'passed',checks,errors},null,2)+'\n')
 console.log('PASS shared FMEA diagram browser: '+checks.join('; '))
}catch(error){await page?.screenshot({path:join(output,'failure.png')}).catch(()=>{});await writeFile(join(output,'browser.json'),JSON.stringify({status:'failed',checks,errors,error:String(error)},null,2)+'\n');throw error
}finally{await browser?.close();await closeViteTestServer(vite,cacheDir)}
