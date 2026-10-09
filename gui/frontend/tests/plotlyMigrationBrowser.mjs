import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync, zipSync } from 'fflate'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import { closeViteTestServer } from './viteTestLifecycle.mjs'

// Mount real production components against the installed slim Plotly runtime.
// The fixture API exists only in this test server, never in application builds.
const root = fileURLToPath(new URL('..', import.meta.url))
const index = process.argv.indexOf('--output-dir')
const output = resolve(index < 0 ? join(tmpdir(), 'perdura-plotly-migration') : process.argv[index + 1])
await mkdir(output, { recursive: true })
const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-plotly-vite-'))
const route = '/__plotly-migration.tsx'
const fixture = `
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '/src/index.css'
import Plotly from '/src/components/shared/plotly'
import ExportablePlot from '/src/components/shared/ExportablePlot'
import ReportBuilder from '/src/components/ReportBuilder'
import { ReportAssetScopeProvider } from '/src/components/shared/ReportAssetScope'
import { capturePlotFigure, plotFigureJson } from '/src/components/shared/plotFigure'
import { buildInteractivePlotHtml } from '/src/components/shared/plotHtml'
import { mergePlotMarkup } from '/src/store/plotMarkup'
import * as project from '/src/store/project'
import { setAssuranceExportEnabled } from '/src/store/artifactExport'
import { exportProjectZip } from '/src/store/exportZip'

const fixtures = {
  scatter: [
    {type:'scatter', name:'Measured', x:new Float64Array([1,2,3]), y:new Float64Array([1e-8,2e-8,3e-8])},
    {type:'scatter', name:'Fit', x:[1,2,3], y:[1.1e-8,2.1e-8,3.1e-8]},
  ],
  bar:[{type:'bar',x:['A','B','C'],y:[1,2,3]}],
  pie:[{type:'pie',labels:['A','B','C'],values:[1,2,3]}],
  box:[{type:'box',y:[1,2,3,4,5]}],
  violin:[{type:'violin',y:[1,2,3,4,5]}],
  histogram:[{type:'histogram',x:[1,1,2,3,3,4]}],
  heatmap:[{type:'heatmap',z:[[1,2,3],[2,3,4],[3,4,5]]}],
  contour:[{type:'contour',z:[[1,2,3],[2,3,4],[3,4,5]]}],
  scatter3d:[{type:'scatter3d',mode:'markers',x:[1,2,3],y:[3,2,1],z:[2,3,4]}],
  sankey:[{type:'sankey',node:{label:['System','A','B'],sort:'input'},link:{source:[0,0],target:[1,2],value:[3,2],sort:'input'}}],
}
const frames = [{name:'reference',data:[{y:[1e-8,2e-8,3e-8]}],traces:[0]}]
project.newProject('Plotly migration evidence')
project.setModuleState('prediction', {
  _folioWrap:true, activeId:'reviewed-pump-assembly',
  folios:[{id:'reviewed-pump-assembly',name:'Reviewed pump assembly',state:{}}],
})
setAssuranceExportEnabled(false)
function Fixture() {
  const [type, setType] = useState('scatter')
  const [responsive, setResponsive] = useState(true)
  const [report, setReport] = useState(false)
  window.migration = { Plotly, project, capturePlotFigure, plotFigureJson, buildInteractivePlotHtml,
    mergePlotMarkup, exportProjectZip, setAssuranceExportEnabled, fixtures,
    showReport: () => {
      const snapshot = project.getProjectState().modules.reportBuilder.plotSnapshots.at(-1)
      project.setModuleState('reportBuilder', {
        ...project.getProjectState().modules.reportBuilder,
        activeReportId:'migration-report',
        reports:[{id:'migration-report',title:'Migration report',blocks:[{
          id:'reviewed-plot',type:'plot',label:snapshot.name,sourceKind:'snapshot',
          plotData:snapshot.plotData,plotLayout:snapshot.plotLayout,plotMarkup:snapshot.plotMarkup,
        }]}],
      })
      setReport(true)
    },
  }
  return <main className="perdura-theme p-4"><h1>Plotly migration regression</h1>
    <label>Trace family<select aria-label="Trace family" value={type} onChange={e=>setType(e.target.value)}>
      {Object.keys(fixtures).map(name=><option key={name}>{name}</option>)}
    </select></label>
    <label><input aria-label="Responsive" type="checkbox" checked={responsive} onChange={e=>setResponsive(e.target.checked)}/>Responsive</label>
    <div id="chart-container" style={{width:900,height:450}}>
      <ReportAssetScopeProvider value={{module:'prediction',moduleLabel:'Prediction'}}>
        <ExportablePlot key={type} plotId="migration" reportKey="migration-current" exportName="migration"
          frames={type === 'scatter' ? frames : undefined}
          data={fixtures[type]} layout={{title:{text:'Reviewed reliability'},autosize:true,margin:{l:70,r:40,t:60,b:60}}}
          style={{width:'100%',height:'100%'}} config={responsive ? undefined : {responsive:false}}/>
      </ReportAssetScopeProvider>
    </div>
    {report && <section aria-label="Report"><ReportBuilder/></section>}
  </main>
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`
const vite = await createServer({ root, cacheDir, logLevel: 'error',
  optimizeDeps: { entries: ['index.html', 'src/components/shared/ExportablePlotInner.tsx'] },
  server: { host: '127.0.0.1', port: 0 }, plugins: [{
    name: 'plotly-migration-fixture',
    resolveId(id) { if (id === route) return id },
    load(id) { if (id === route) return fixture },
    configureServer(server) {
      server.middlewares.use('/__plotly-migration', async (req, res, next) => {
        if (req.url !== '/' && req.url !== '') return next()
        res.setHeader('Content-Type', 'text/html')
        res.end(await server.transformIndexHtml('/__plotly-migration', '<!doctype html><html lang="en"><head><title>Plotly migration</title></head><body><div id="root"></div><script type="module" src="/__plotly-migration.tsx"></script></body></html>'))
      })
    },
  }],
})
let browser
const errors = []
const checks = []
try {
  await vite.listen()
  browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] })
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__plotly-migration`, { waitUntil: 'domcontentloaded' })
  const graph = page.locator('#chart-container .js-plotly-plot')
  const ready = type => expect.poll(() => graph.evaluate(node => node._fullData?.[0]?.type), { timeout: 60000 }).toBe(type)
  for (const type of ['scatter', 'bar', 'pie', 'box', 'violin', 'histogram', 'heatmap', 'contour', 'scatter3d', 'sankey']) {
    await page.getByLabel('Trace family').selectOption(type)
    await ready(type)
    const state = await graph.evaluate(node => ({ width:node._fullLayout.width,height:node._fullLayout.height,
      cloud:node._context.showSendToCloud,responsive:node._context.responsive,delay:node._context.doubleClickDelay }))
    assert.ok(state.width > 100 && state.height > 100)
    assert.equal(state.cloud, false)
    assert.equal(state.responsive, true)
    assert.equal(state.delay, 300)
    if (type === 'scatter3d' || type === 'sankey') {
      if (type === 'scatter3d') await graph.evaluate(node=>window.migration.Plotly.relayout(node, {
        'scene.camera':{eye:{x:1.8,y:1.4,z:0.9},center:{x:0,y:0,z:0},up:{x:0,y:0,z:1}},
      }))
      const exported = JSON.parse((await download('json',type)).bytes)
      assert.equal(exported.data[0].type,type)
      if (type === 'scatter3d') assert.deepEqual(exported.layout.scene.camera.eye,{x:1.8,y:1.4,z:0.9})
      else {
        assert.equal(exported.data[0].node.sort,'input')
        assert.equal(exported.data[0].link.sort,'input')
        assert.deepEqual(exported.data[0].link.value,[3,2])
      }
      await page.evaluate(async figure => {
        const target=document.createElement('div')
        target.style.cssText='width:600px;height:350px'
        document.body.appendChild(target)
        await window.migration.Plotly.newPlot(target,figure.data,figure.layout,{showSendToCloud:false})
        if(target._fullData[0].type !== figure.data[0].type) throw Error('JSON roundtrip changed trace family')
        window.migration.Plotly.purge(target)
        target.remove()
      },exported)
    }
  }
  checks.push('all ten registered trace families render through the production wrapper')

  await page.getByLabel('Trace family').selectOption('scatter')
  await ready('scatter')
  const width = await graph.evaluate(node => node._fullLayout.width)
  await page.locator('#chart-container').evaluate(node => { node.style.width = '650px' })
  await expect.poll(() => graph.evaluate(node => node._fullLayout.width)).toBeLessThan(width)
  await page.locator('#chart-container').evaluate(node => { node.style.display = 'none'; node.style.width = '800px' })
  await page.locator('#chart-container').evaluate(node => { node.style.display = '' })
  await expect.poll(() => graph.evaluate(node => node._fullLayout.width)).toBe(800)
  await page.getByLabel('Responsive', { exact:true }).uncheck()
  await expect.poll(() => graph.evaluate(node => node._context.responsive)).toBe(false)
  await page.locator('#chart-container').evaluate(node => { node.style.width = '700px' })
  await page.waitForTimeout(250)
  assert.equal(await graph.evaluate(node => node._fullLayout.width), 800)
  await page.getByLabel('Responsive', { exact:true }).check()
  await page.locator('#chart-container').evaluate(node => { node.style.width = '850px' })
  await expect.poll(() => graph.evaluate(node => node._fullLayout.width)).toBe(850)
  checks.push('container-only resize, hidden-to-visible resize, explicit opt-out')

  await graph.evaluate(async node => {
    const p = window.migration.Plotly
    await p.restyle(node, { visible:'legendonly' }, [0])
    await p.relayout(node, {
      'legend.x':0.3,'legend.y':0.7,
      annotations:[{name:'perdura-user-reviewed',text:'Reviewed μ failure rate',x:2,y:2e-8,showarrow:true}],
      shapes:[{name:'perdura-user-threshold',type:'line',x0:1,x1:3,y0:2e-8,y1:2e-8,line:{color:'#2563eb',width:2}}],
    })
  })
  // Drive a user zoom, which Plotly records for uirevision preservation.
  // A programmatic relayout does not have the same controlled-React semantics.
  const geometry = await graph.evaluate(node => ({range:node._fullLayout.xaxis.range,...node._fullLayout._size}))
  const box = await graph.boundingBox()
  await page.mouse.move(box.x+geometry.l+geometry.w*0.2,box.y+geometry.t+geometry.h*0.2)
  await page.mouse.down()
  await page.mouse.move(box.x+geometry.l+geometry.w*0.8,box.y+geometry.t+geometry.h*0.8,{steps:10})
  await page.mouse.up()
  await expect.poll(() => graph.evaluate(node=>node._fullLayout.xaxis.range)).not.toEqual(geometry.range)
  const reviewedRange = await graph.evaluate(node=>node._fullLayout.xaxis.range)
  await page.getByRole('button', { name:'Save snapshot of Reviewed reliability to Report Builder',exact:true }).click({force:true})
  await expect.poll(() => page.evaluate(() => window.migration.project.getProjectState().modules.reportBuilder?.plotSnapshots?.length ?? 0)).toBe(1)
  const snapshot = await page.evaluate(() => window.migration.project.getProjectState().modules.reportBuilder.plotSnapshots[0])
  assert.deepEqual(await graph.evaluate(node=>node._fullLayout.xaxis.range),reviewedRange,
    'requesting a snapshot must preserve the live reviewed view')
  assert.equal(snapshot.plotData[0].visible,'legendonly')
  assert.equal(snapshot.source.analysisId,'reviewed-pump-assembly')
  assert.deepEqual(snapshot.plotData[0].x,[1,2,3])
  assert.deepEqual(snapshot.plotLayout.xaxis.range,reviewedRange)
  assert.equal(snapshot.plotMarkup.annotations[0].text,'Reviewed μ failure rate')
  assert.equal(snapshot.plotMarkup.shapes[0].id,'threshold')
  assert.equal(snapshot.plotLayout.legend.x,0.3)
  checks.push('real v4 live serialization and immutable snapshot capture')

  async function download(format, prefix = '') {
    await graph.locator('[data-title="Download plot"]').click({force:true})
    const pending = page.waitForEvent('download',{timeout:60000})
    await page.getByRole('menuitem',{name:{json:/Plot JSON/,png:/PNG image/,svg:/SVG vector/,html:/Interactive HTML/}[format]}).click()
    const result = await pending
    assert.equal(await result.failure(),null)
    const path = join(output,(prefix ? `${prefix}-` : '')+result.suggestedFilename())
    await result.saveAs(path)
    return {path,bytes:await readFile(path)}
  }
  await graph.evaluate(async node => {
    await window.migration.Plotly.addFrames(node,[{name:'reference',data:[{y:[1e-8,2e-8,3e-8]}],traces:[0]}])
  })
  const jsonDownload = await download('json')
  const json = JSON.parse(jsonDownload.bytes)
  const installed = JSON.parse(await readFile(join(root,'node_modules/plotly.js/package.json'),'utf8')).version
  assert.equal(json.version,installed)
  assert.deepEqual(json.data[0].x,[1,2,3])
  assert.deepEqual(json.data[0].y,[1e-8,2e-8,3e-8])
  assert.deepEqual(json.layout.xaxis.range,reviewedRange)
  assert.equal(json.frames[0].name,'reference')
  assert.equal(json.config,undefined)
  assert.ok(!jsonDownload.bytes.includes('"_fullLayout"'))
  await page.evaluate(async ({figure,reviewedRange}) => {
    const target = document.createElement('div')
    target.style.cssText='width:500px;height:300px'
    document.body.appendChild(target)
    await window.migration.Plotly.newPlot(target,figure.data,figure.layout,{showSendToCloud:false})
    await window.migration.Plotly.addFrames(target,figure.frames)
    if (target.data[0].visible !== 'legendonly' || JSON.stringify(target.layout.xaxis.range) !== JSON.stringify(reviewedRange)) throw Error('Figure roundtrip changed the reviewed view')
    window.migration.Plotly.purge(target)
    target.remove()
  },{figure:json,reviewedRange})
  await page.evaluate(() => window.migration.setAssuranceExportEnabled(true))
  const wrapped = await download('json')
  const archive = unzipSync(wrapped.bytes)
  const manifest = JSON.parse(Buffer.from(archive['migration.json.perdura.json']))
  assert.equal(manifest.schema,'perdura.artifact-manifest/v1')
  assert.equal(manifest.export.kind,'plot-json')
  assert.equal(manifest.export.moduleKey,'prediction')
  assert.equal(manifest.export.analysisId,'reviewed-pump-assembly')
  assert.equal(manifest.artifact.sha256,createHash('sha256').update(archive['migration.json']).digest('hex'))
  assert.deepEqual(JSON.parse(Buffer.from(archive['migration.json'])),json)
  const verifier = resolve(root,'../../tools/verify_perdura_artifact.py')
  execFileSync('python3',[verifier,wrapped.path])
  archive['migration.json'] = new TextEncoder().encode('{}')
  const tampered = join(output,'tampered.perdura.zip')
  await writeFile(tampered,zipSync(archive))
  assert.notEqual(spawnSync('python3',[verifier,tampered]).status,0)
  await page.evaluate(() => window.migration.setAssuranceExportEnabled(false))
  checks.push('raw JSON roundtrip; provenance ZIP, checksum, verifier and tamper rejection')

  for (const format of ['png','svg','html']) {
    const exported = await download(format)
    assert.ok(exported.bytes.length > 1000)
    if (format === 'png') assert.equal(exported.bytes.subarray(1,4).toString(),'PNG')
    if (format === 'svg') assert.ok(exported.bytes.includes('<svg'))
    if (format === 'html') {
      assert.ok(exported.bytes.includes(`plotly-${installed}.min.js`))
      assert.ok(exported.bytes.includes('"showSendToCloud":false'))
    }
  }
  await page.evaluate(() => window.migration.showReport())
  const report = page.getByRole('region',{name:'Report',exact:true})
  await expect(report.locator('.js-plotly-plot')).toHaveCount(1)
  await expect.poll(() => report.locator('.js-plotly-plot').evaluate(node => node._fullLayout?.annotations?.some(item=>item.text==='Reviewed μ failure rate'))).toBe(true)
  for (const format of ['HTML','PDF']) {
    const pending = page.waitForEvent('download',{timeout:60000})
    await report.getByRole('button',{name:format,exact:true}).click()
    const result = await pending
    assert.equal(await result.failure(),null)
    const path = join(output,result.suggestedFilename())
    await result.saveAs(path)
    const bytes = await readFile(path)
    if (format === 'HTML') {
      assert.ok(bytes.includes(`plotly-${installed}.min.js`))
      assert.ok(bytes.includes('"showSendToCloud":false'))
      assert.ok(bytes.includes('Reviewed μ failure rate'))
    } else assert.equal(bytes.subarray(0,4).toString(),'%PDF')
  }
  const zipPending = page.waitForEvent('download',{timeout:60000})
  const zipResult = await page.evaluate(() => window.migration.exportProjectZip())
  assert.equal(zipResult.skipped,0)
  const zipDownload = await zipPending
  const zipPath = join(output,zipDownload.suggestedFilename())
  await zipDownload.saveAs(zipPath)
  const assets = unzipSync(await readFile(zipPath))
  const htmlAssets = Object.entries(assets).filter(([name])=>name.endsWith('.html'))
  assert.ok(htmlAssets.length > 0)
  for (const [,bytes] of htmlAssets) {
    assert.ok(Buffer.from(bytes).includes(`plotly-${installed}.min.js`))
    assert.ok(Buffer.from(bytes).includes('"showSendToCloud":false'))
  }
  assert.ok(Object.keys(assets).some(name=>name.endsWith('.png')))
  assert.ok(Object.keys(assets).some(name=>name.endsWith('.svg')))
  checks.push('PNG/SVG/HTML exports, restored report, report HTML/PDF and project asset ZIP')
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({status:'passed',plotlyVersion:installed,checks}))
} catch (error) {
  errors.push(error.stack)
  throw error
} finally {
  await writeFile(join(output,'report.json'),JSON.stringify({status:errors.length?'failed':'passed',checks,errors},null,2)+'\n')
  await browser?.close()
  await closeViteTestServer(vite,cacheDir)
}
