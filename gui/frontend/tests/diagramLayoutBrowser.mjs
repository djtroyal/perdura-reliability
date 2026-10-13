/** Actual five-canvas layout controls, geometry and persistence regression. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'
import { closeViteTestServer } from './viteTestLifecycle.mjs'
const root = new URL('..', import.meta.url).pathname
const arg = process.argv.indexOf('--output-dir')
const output = resolve(arg < 0 ? join(tmpdir(),'perdura-diagram-layout') : process.argv[arg+1])
await mkdir(output,{recursive:true})
const cacheDir = await mkdtemp(join(tmpdir(),'perdura-diagram-layout-vite-'))
const route='/__diagram-layout.tsx'
const fixture=`
import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import '/src/index.css'
import {FaultTreeEditor} from '/src/components/FaultTree'
import RBD from '/src/components/SystemReliability'
import Markov from '/src/components/Markov'
import Fmea from '/src/components/ReliabilityProgram/FmeaBlockDiagramCanvas'
import System from '/src/components/SystemDefinition/SystemBlockDiagramCanvas'
import {createFmeaAnalysis} from '/src/components/ReliabilityProgram/fmeaModel'
import {emptySystemDefinition} from '/src/components/SystemDefinition/model'
import {KeyboardShortcutProvider} from '/src/components/shared/KeyboardShortcuts'
import {ReportAssetScopeProvider} from '/src/components/shared/ReportAssetScope'
import * as project from '/src/store/project'
const kind=new URL(location.href).searchParams.get('module')||'fta'
await project.hydrateProjectStorage()
project.newProject('Layout browser '+kind)
const basic=(id,x)=>({id,type:'basic',position:{x,y:230},data:{label:'Component '+id,description:id==='b'?'Long engineering description with several wrapped lines to measure safely':'',probability:0.1,eventKey:id}})
const fta={nodes:[{id:'g',type:'or',position:{x:250,y:20},data:{label:'Top event'}},basic('a',20),basic('b',250),basic('c',500)],
 edges:['a','b','c'].map((id,order)=>({id:'e'+id,source:'g',target:id,data:{role:'input',order}})),annotations:[],exposureTime:'1000',density:'comfortable',connectorStyle:'smoothstep',snapToGrid:false}
const rbd={nodes:[{id:'source',type:'source',position:{x:10,y:240},data:{label:'Source'}},
 ...['a','b','c'].map((id,i)=>({id,type:'component',position:{x:250,y:i*170},data:{label:'Block '+id,reliability:.9}})),
 {id:'sink',type:'sink',position:{x:650,y:240},data:{label:'Sink'}}],
 edges:['a','b','c'].flatMap(id=>[{id:'s'+id,source:'source',target:id},{id:id+'t',source:id,target:'sink'}]),annotations:[],density:'comfortable',connectorStyle:'smoothstep',missionTime:'1000'}
const markov={states:['a','b','c'].map((id,i)=>({id,name:'State '+id,state_type:i===2?'failed':'operational'})),
 transitions:[{id:'ab',from_state:'a',to_state:'b',rate:.01},{id:'bc',from_state:'b',to_state:'c',rate:.02},{id:'ca',from_state:'c',to_state:'a',rate:.03}],
 initialState:'a',positions:{a:{x:300,y:0},b:{x:600,y:300},c:{x:100,y:300}},annotations:[],density:'comfortable'}
const moduleKey=kind==='fta'?'faultTree':kind==='rbd'?'system':'markov'
if(['fta','rbd','markov'].includes(kind))project.setModuleState(moduleKey,{_folioWrap:true,activeId:'layout',folios:[{id:'layout',name:'Layout fixture',state:kind==='fta'?fta:kind==='rbd'?rbd:markov}]})
const fmea=createFmeaAnalysis('dfmea',1)
fmea.structure_nodes=['a','b','c'].map(id=>({id,name:'Assembly '+id,level:'component',description:'',interface:'',element_type:'item'}))
fmea.block_diagram.nodes=fmea.structure_nodes.map((node,i)=>({id:node.id,kind:'structure',structure_node_id:node.id,label:node.name,x:100,y:100+i*160,width:180,height:72,inside_boundary:true}))
const system=emptySystemDefinition().model
system.definitions=['a','b','c'].map(id=>({id,name:'Block '+id,kind:'component',classification:'component',revision:'A',functions:[],failure_modes:[],ports:[],parameters:[],piece_parts:[]}))
system.instances=system.definitions.map((d,i)=>({id:d.id,definition_id:d.id,name:d.name,quantity:1,mode_ids:[],parameter_values:[],x:100,y:i*160}))
system.diagrams[0].nodes=system.instances.map((n,i)=>({instance_id:n.id,x:100,y:100+i*160,width:180,height:72,expanded:false}))
function App(){const [f,setF]=useState(fmea);const [s,setS]=useState(system)
 window.diagramTest={project,snapshot:()=>kind==='fmea'?f:kind==='system'?s:project.getProjectState().modules[moduleKey].folios[0].state}
 return <KeyboardShortcutProvider><ReportAssetScopeProvider value={{module:moduleKey,moduleLabel:kind}}>
 <div className="perdura-theme flex h-screen min-h-0 flex-col">{kind==='fta'?<FaultTreeEditor/>:kind==='rbd'?<RBD/>:kind==='markov'?<Markov/>:
 kind==='fmea'?<div className="h-full w-full"><Fmea analysis={f} update={patch=>setF(old=>({...old,...patch}))}/></div>:
 <div className="h-full w-full"><System model={s} collapsedInstanceIds={[]} onChange={model=>setS(model)}/></div>}</div>
 </ReportAssetScopeProvider></KeyboardShortcutProvider>}
createRoot(document.getElementById('root')).render(<App/>)
`
const vite=await createServer({root,cacheDir,logLevel:'error',server:{host:'127.0.0.1',port:0,hmr:false},plugins:[{
 name:'diagram-layout-fixture',resolveId(id){if(id===route)return id},load(id){if(id===route)return fixture},
 configureServer(server){server.middlewares.use('/__diagram-layout',async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/'&&req.url?.split('?')[0]!=='')return next()
  res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__diagram-layout','<!doctype html><html lang="en"><head><title>Diagram layout regression</title></head><body><div id="root"></div><script type="module" src="/__diagram-layout.tsx"></script></body></html>'))
 })}
}]})
let browser
const checks=[],errors=[]
try{
 await vite.listen();browser=await chromium.launch({headless:true})
 const page=await browser.newPage({viewport:{width:1500,height:950}})
 page.on('pageerror',error=>errors.push(error.message))
 await page.route(url=>url.pathname.startsWith('/api/'),route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({valid:true,issues:[],analysis_kind:'static_coherent'})}))
 for(const kind of ['fta','rbd','markov','fmea','system']){
  await page.goto('http://127.0.0.1:'+vite.httpServer.address().port+'/__diagram-layout?module='+kind)
  const menu=page.getByLabel('Diagram layout',{exact:true})
  await menu.waitFor({timeout:90000})
  await expect.poll(()=>page.locator('.react-flow__node').count()).toBeGreaterThan(2)
  assert.ok((await page.locator('.react-flow').boundingBox()).width>500,kind+' canvas has usable width')
  const snapshot=()=>page.evaluate(()=>window.diagramTest.snapshot())
  const settledViewport=()=>page.evaluate(async()=>{
    // Layout commits before the 350–450 ms fit animation finishes. Wait for
    // actual rendered geometry to settle before inspecting or dragging nodes.
    let previous='',stable=0
    for(let frame=0;frame<120;frame++){
      await new Promise(resolve=>requestAnimationFrame(resolve))
      const current=document.querySelector('.react-flow__viewport')?.getAttribute('style') ?? ''
      stable=current===previous?stable+1:0;previous=current
      if(frame>=30&&stable>=5)return
    }
    throw new Error('Layout viewport did not settle')
  })
  const options=state=>kind==='fmea'?state.block_diagram.layoutOptions:kind==='system'?state.diagrams[0].layoutOptions:state.layoutOptions
  const geometry=state=>kind==='fmea'?state.block_diagram.nodes.map(n=>[n.id,n.x,n.y]):kind==='system'?state.diagrams[0].nodes.map(n=>[n.instance_id,n.x,n.y]):kind==='markov'?state.positions:state.nodes.map(n=>[n.id,n.position.x,n.position.y])
  const semantics=state=>kind==='fmea'?{structure:state.structure_nodes,interfaces:state.interfaces}:kind==='system'?{instances:state.instances,definitions:state.definitions,interfaces:state.interfaces}:kind==='markov'?{states:state.states,transitions:state.transitions}: {nodes:state.nodes.map(n=>({id:n.id,type:n.type,data:Object.fromEntries(Object.entries(n.data).filter(([key])=>!['displayDensity','computedP'].includes(key)))})),edges:state.edges.map(e=>({id:e.id,source:e.source,target:e.target,role:e.data?.role,order:e.data?.order}))}
  if(kind==='markov') await expect.poll(async()=>(await snapshot()).canvasNodes?.length).toBe(3)
  const before=semantics(await snapshot()),geometries=[]
  for(const mode of ['Compact','Normal','Expanded']){
   await menu.click();await page.getByRole('button',{name:mode,exact:true}).click()
   await expect.poll(async()=>options(await snapshot())?.mode).toBe(mode.toLowerCase())
   await expect(menu).toBeFocused()
   await page.evaluate(()=>document.fonts.ready)
   await settledViewport()
   const visible=await page.evaluate(()=>{
    const area=document.querySelector('.react-flow').getBoundingClientRect()
    return [...document.querySelectorAll('.react-flow__node')].every(node=>{
      const bounds=node.getBoundingClientRect()
      return bounds.left>=area.left-1&&bounds.right<=area.right+1&&bounds.top>=area.top-1&&bounds.bottom<=area.bottom+1
    })
   })
   assert.ok(visible,kind+' fitted layout keeps complete nodes in view')
   const state=await snapshot();geometries.push(geometry(state))
   assert.deepEqual(semantics(state),before,kind+' layout must not alter semantic inputs')
   await page.screenshot({path:join(output,kind+'-'+mode.toLowerCase()+'.png')})
  }
  assert.notDeepEqual(geometries[0],geometries[1],kind+' Compact/Normal distinct')
  assert.notDeepEqual(geometries[1],geometries[2],kind+' Normal/Expanded distinct')
  if(['fta','rbd','markov'].includes(kind)) {
    await page.evaluate(()=>window.diagramTest.project.undo())
    await expect.poll(async()=>options(await snapshot())?.mode).toBe('normal')
    assert.deepEqual(geometry(await snapshot()),geometries[1],kind+' one Undo restores the previous complete layout')
    await page.evaluate(()=>window.diagramTest.project.redo())
    await expect.poll(async()=>options(await snapshot())?.mode).toBe('expanded')
  }
  await menu.click()
  const eventLabel=kind==='markov'?'Preserve state order':['fmea','system'].includes(kind)?'Preserve block order':'Preserve event order'
  await expect(page.getByLabel(eventLabel,{exact:true})).toBeChecked()
  await page.getByLabel(eventLabel,{exact:true}).uncheck()
  await page.getByRole('button',{name:'Expanded',exact:true}).click()
  await expect.poll(async()=>options(await snapshot())?.preserveEventOrder).toBe(false)
  await settledViewport()
  // Move a real node, then reapply the selected preset. This verifies the
  // action changes geometry rather than merely keeping the same selected value.
  const node=page.locator('.react-flow__node[data-id="'+(kind==='system'?'system-instance:a':'a')+'"]')
  const start=await node.boundingBox()
  const beforeDrag=JSON.stringify(geometry(await snapshot()))
  await page.mouse.move(start.x+start.width/2,start.y+start.height/2)
  await page.mouse.down();await page.mouse.move(start.x+start.width/2+70,start.y+start.height/2+60,{steps:8});await page.mouse.up()
  await expect.poll(async()=>JSON.stringify(geometry(await snapshot()))).not.toBe(beforeDrag)
  const dragged=JSON.stringify(geometry(await snapshot()))
  // Reapply the already-selected preset; this must remain an actual action.
  await menu.click();await page.getByRole('button',{name:'Expanded',exact:true}).click()
  await expect(menu).toBeFocused()
  await expect.poll(async()=>JSON.stringify(geometry(await snapshot()))).not.toBe(dragged)
  await settledViewport()
  checks.push({kind,modesDistinct:true,semanticsUnchanged:true,optionsPersist:true,sameModeReapply:true})
 }
 assert.deepEqual(errors,[])
 await writeFile(join(output,'report.json'),JSON.stringify({status:'passed',checks},null,2))
 console.log('PASS five actual canvas layout menus, modes, semantics and persistence')
}catch(error){await writeFile(join(output,'failure.json'),JSON.stringify({error:String(error),errors,checks},null,2));throw error}
finally{await browser?.close();await closeViteTestServer(vite,cacheDir)}
