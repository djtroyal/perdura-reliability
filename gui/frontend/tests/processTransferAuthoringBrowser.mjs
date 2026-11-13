import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'
import { closeViteTestServer } from './viteTestLifecycle.mjs'

const outputArgument = process.argv.indexOf('--output-dir')
const output = outputArgument < 0 ? join(tmpdir(), 'perdura-process-transfer-authoring') : resolve(process.argv[outputArgument + 1])
await mkdir(output, { recursive: true })
const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-process-transfer-vite-'))
const route = '/__process_transfer_fixture.tsx'
const fixture = `
import React,{useState} from 'react'; import {createRoot} from 'react-dom/client'; import '/src/index.css'
import {FmeaTransferEditor} from '/src/components/ReliabilityProgram/StructuredFmeaAuthoring'
import StructuredFunctionEditor from '/src/components/shared/StructuredFunctionEditor'
import {createFmeaAnalysis} from '/src/components/ReliabilityProgram/fmeaModel'
import {assertFmeaDraftIntegrity} from '/src/store/fmeaDraftIntegrity'
import {assertFmeaEditAllowed} from '/src/store/fmeaReadiness'
import {processArchitectureModel,effectiveSystemFunctions} from '/src/store/systemArchitecture'
import {availableFunctionInputs,upsertInstalledFunction} from '/src/store/functionResourceFlows'
import {applyProcessArchitecture} from '/src/store/interfaceFunctions'
function initial(){const a=createFmeaAnalysis('pfmea',1)
a.id='process-study';a.resources=[{id:'product',name:'Installed connector',category:'material'}]
a.structure_nodes=[{id:'process',name:'Assembly',level:'process_item',description:'',interface:''},{id:'step',name:'Install connector',level:'process_step',parent_id:'process',description:'',interface:''}]
const base={function_type:'primary',operating_modes:[],owner:'',notes:''}
a.functions=[{...base,id:'root-function',structure_node_id:'process',description:'Maintain assembly readiness',definition:{role:'maintain_state',action:'assembly readiness',io:[]}},
{...base,id:'step-function',structure_node_id:'step',description:'Install connector',definition:{role:'transform',action:'Install connector',io:[{id:'product-output',resource_id:'product',direction:'output'}]}}]
a.block_diagram.nodes=[{id:'actor',kind:'external',label:'Operator',external_kind:'human',x:0,y:80,width:200,height:80,inside_boundary:false,ports:[]},{id:'step-block',kind:'structure',structure_node_id:'step',label:'Install connector',x:320,y:80,width:200,height:80,inside_boundary:true}]
a.interfaces=[{id:'exchange',name:'Operator command',interface_type:'information',directionality:'directed',linkage:'direct',source_block_id:'actor',target_block_id:'step-block',target_structure_node_id:'step',external_source:'Operator',external_target:'',function_ids:[],requirement_ids:[],transfers:[],flow_description:'',interface_detail:'',operating_condition:'',relationship_strength:'unspecified',relationship_nature:'unspecified'}]
return a}
function Fixture(){const[a,set]=useState(()=>JSON.parse(localStorage.getItem('process-fixture')||'null')||initial());window.processStudy=a
const update=patch=>{const next={...a,...patch};assertFmeaEditAllowed(a,next);assertFmeaDraftIntegrity(next);localStorage.setItem('process-fixture',JSON.stringify(next));set(next)}
const model=processArchitectureModel(a),fn=effectiveSystemFunctions(model,'step')[0]
return <main className="max-w-5xl p-5 space-y-5"><h1>Process interface authoring</h1>
<section aria-label="Process interface"><FmeaTransferEditor analysis={a} interfaceId={a.interfaces[0].id} update={update}/></section>
<section aria-label="Process function"><StructuredFunctionEditor value={fn.definition} resources={model.resources} defaultInputInstanceId="step" inputOptions={availableFunctionInputs(model,{instanceId:'step',functionId:fn.id})}
onChange={(definition,description,resources)=>update(applyProcessArchitecture(a,upsertInstalledFunction(model,'step',{...fn,definition,description},{resources})))}/></section>
<button onClick={()=>{const next=initial();next.interfaces=[{...next.interfaces[0],id:'relation',name:'Fixture attachment',interface_type:'physical',directionality:'undirected'}];set(next);localStorage.setItem('process-fixture',JSON.stringify(next))}}>New physical relation</button></main>}
createRoot(document.getElementById('root')).render(<Fixture/>);
`
const vite = await createServer({ root: new URL('..', import.meta.url).pathname, cacheDir,
  server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'process-transfer-fixture',
    resolveId(id) { if (id === route) return id }, load(id) { if (id === route) return fixture },
    configureServer(server) { server.middlewares.use('/__process_transfer', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml('/__process_transfer',
        `<!doctype html><html lang="en"><head><title>Process transfer authoring</title></head><body><div id="root"></div><script type="module" src="${route}"></script></body></html>`))
    }) },
  }],
})
let browser
const checks = [], errors = []
try {
  await vite.listen(); browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1000, height: 1100 } })
  page.on('pageerror', error => errors.push(error.message))
  const url = `http://127.0.0.1:${vite.httpServer.address().port}/__process_transfer`
  await page.goto(url)
  const connection = page.getByRole('region', { name: 'Process interface' }), fn = page.getByRole('region', { name: 'Process function' })
  await expect(connection.getByRole('button', { name: 'Confirm resource pairing' })).toBeDisabled({ timeout: 90000 })
  await connection.getByText('Define an external source', { exact: true }).click()
  await connection.getByLabel('Output resource', { exact: true }).fill('Assembly command')
  await connection.getByRole('button', { name: 'Add external output' }).click()
  let study = await page.evaluate(() => window.processStudy)
  assert.equal(study.interfaces[0].transfers.length, 0, 'External output authoring does not invent a consumer')
  const external = study.block_diagram.nodes.find(item => item.id === 'actor'), terminal = external.ports[0]
  assert.ok(terminal.resource_id); assert.equal(terminal.direction, 'output')
  checks.push('The canonical PFMEA adapter persists a typed external output and its owned resource before any consumer exists')
  await fn.getByRole('button', { name: 'Add input', exact: true }).click()
  await fn.getByRole('button', { name: 'Input 1', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Choose input resource', exact: true })
  await picker.getByRole('button', { name: 'External sources', exact: true }).click()
  await picker.getByRole('button', { name: 'Operator', exact: true }).click()
  await picker.getByRole('button', { name: 'Use Assembly command', exact: true }).click()
  await expect(picker).toBeHidden()
  await expect(fn.getByRole('button', { name: 'Input 1', exact: true })).toContainText('Assembly command')
  await fn.getByLabel('Function action').click()
  study = await page.evaluate(() => window.processStudy)
  assert.equal(study.interfaces[0].transfers.length, 1)
  const transfer = study.interfaces[0].transfers[0]
  assert.equal(transfer.resource_id, terminal.resource_id); assert.equal(transfer.source.external_id, 'actor'); assert.equal(transfer.source.port_id, terminal.id)
  assert.equal(transfer.target.instance_id, 'step')
  assert.equal(study.functions.find(item => item.id === 'step-function').definition.io.filter(io => io.direction === 'output').length, 1)
  checks.push('Choosing the external source as a process input automatically creates the exact typed resource transfer without a receive-only function')
  await page.reload(); await expect(connection.getByRole('button', { name: 'Remove connection' })).toHaveCount(1)
  assert.deepEqual(await page.evaluate(() => window.processStudy), JSON.parse(JSON.stringify(study)))
  checks.push('Reload preserves the external terminal, resource, function I/O, and transfer identities')
  await connection.getByRole('button', { name: 'Remove connection', exact: true }).click()
  study = await page.evaluate(() => window.processStudy)
  assert.equal(study.interfaces[0].transfers.length, 0)
  assert.equal(study.functions.find(item => item.id === 'step-function').definition.io.find(io => io.direction === 'input').resource_id, '')
  checks.push('Removing a process connection clears its input binding rather than silently recreating the transfer')
  await page.getByRole('button', { name: 'New physical relation' }).click()
  await expect(connection.getByRole('button', { name: 'Connect physical relation' })).toBeEnabled()
  await connection.getByRole('button', { name: 'Connect physical relation' }).click()
  study = await page.evaluate(() => window.processStudy)
  assert.equal(study.interfaces[0].transfers[0].kind, 'relation')
  assert.equal(study.interfaces[0].transfers[0].resource_id, undefined)
  assert.equal(study.interfaces[0].transfers[0].target.kind, 'block')
  assert.equal(study.resources.length, 1); assert.equal(study.functions.length, 2)
  checks.push('A physical relation binds an actor and process block without fabricating resources or functions')
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, errors }, null, 2) + '\n')
  console.log(`PASS process transfer authoring: ${checks.length} browser checks; ${output}`)
} finally { await browser?.close(); await closeViteTestServer(vite, cacheDir) }
