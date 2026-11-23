/** Local reference search through the production HelpCenter and real PDF extractor. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'
import { closeViteTestServer } from './viteTestLifecycle.mjs'

const root = new URL('..', import.meta.url).pathname, repo = resolve(root, '../..')
const outputOption = process.argv.indexOf('--output-dir')
const output = resolve(outputOption < 0 ? join(tmpdir(), 'perdura-reference-library-browser') : process.argv[outputOption + 1])
await mkdir(output, { recursive: true })
const cache = await mkdtemp(join(tmpdir(), 'perdura-reference-library-vite-'))
const entry = '/__reference-library.tsx'
const fixture = `
import React from 'react'
import {createRoot} from 'react-dom/client'
import '/src/index.css'
import HelpCenter from '/src/components/help/HelpCenter'
import {KeyboardShortcutProvider} from '/src/components/shared/KeyboardShortcuts'
import {ReportAssetScopeProvider} from '/src/components/shared/ReportAssetScope'
import * as project from '/src/store/project'
await project.hydrateProjectStorage()
project.newProject('Lifetime tools browser fixture')
window.referenceLibraryTest={project}
createRoot(document.getElementById('root')).render(<KeyboardShortcutProvider><ReportAssetScopeProvider value={{module:'lifeTools',moduleLabel:'Lifetime Tools'}}>
<div className="perdura-theme flex h-screen flex-col"><HelpCenter open={true} onClose={()=>{}} activeModule="maintenance" contextualTopicId="maintenance.lifetime-tools"/></div></ReportAssetScopeProvider></KeyboardShortcutProvider>)
`

const vite = await createServer({ root, cacheDir: cache, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [{
  name: 'lifecycle-fixture', resolveId(id) { if (id === entry) return id }, load(id) { if (id === entry) return fixture },
  configureServer(server) {
    server.middlewares.use('/__reference-library', async (req, res, next) => {
      if (req.url !== '/' && req.url !== '') return next()
      res.setHeader('Content-Type', 'text/html')
      res.end(await server.transformIndexHtml('/__reference-library', `<!doctype html><html lang="en"><head><title>Lifecycle assurance</title></head><body><main id="root"></main><script type="module" src="${entry}"></script></body></html>`))
    })
  },
}] })
const python = process.env.PERDURA_PYTHON ?? resolve(repo, '.venv/bin/python')
const child = spawn(python, ['-u', '-c', `
import json,sys
from routers import references
print(json.dumps({'ready':True}))
for line in sys.stdin:
    p=json.loads(line)
    try:
        kind=p['kind']; body=p['body']
        if kind=='catalog': out=references.catalog()
        elif kind=='search': out=references.search(references.ReferenceSearchRequest(**body))
        else: raise ValueError(kind)
        print(json.dumps({'id':p['id'],'result':out},allow_nan=False))
    except Exception as error:
        print(json.dumps({'id':p['id'],'error':str(error)}))
`], { cwd: repo, env: { ...process.env, PYTHONPATH: join(repo, 'src') + ':' + join(repo, 'gui/backend'), MPLCONFIGDIR: join(tmpdir(), 'perdura-reference-library-mpl') },
  stdio: ['pipe', 'pipe', 'pipe'] })
let readyResolve, readyReject, sequence = 0, pythonErrors = ''
const ready = new Promise((resolveReady, rejectReady) => { readyResolve = resolveReady; readyReject = rejectReady })
const startupTimer = setTimeout(() => { readyReject(new Error('Python handler startup timed out')); child.kill() }, 90000)
const pending = new Map()
child.stderr.on('data', data => { pythonErrors = (pythonErrors + data).slice(-10000) })
child.on('error', error => { clearTimeout(startupTimer); readyReject(error) })
child.on('exit', code => {
  clearTimeout(startupTimer)
  const error = new Error(`Python handler exited (${code}): ${pythonErrors}`)
  readyReject(error)
  for (const item of pending.values()) item.reject(error)
})
createInterface({ input: child.stdout }).on('line', line => {
  let message
  try { message = JSON.parse(line) } catch { return }
  if (message.ready) { clearTimeout(startupTimer); readyResolve(); return }
  const item = pending.get(message.id)
  if (!item) return
  pending.delete(message.id); clearTimeout(item.timer)
  if (message.error) item.reject(new Error(message.error))
  else item.resolve(message.result)
})
const calculate = (kind, body) => new Promise((resolveCalculation, reject) => {
  const id = ++sequence
  const timer = setTimeout(() => { pending.delete(id); reject(new Error('Python calculation timed out')) }, 90000)
  pending.set(id, { resolve: resolveCalculation, reject, timer })
  child.stdin.write(JSON.stringify({ id, kind, body }) + '\n')
})
let browser, page
const checks = [], errors = [], requests = []
try {
  await ready
  await vite.listen()
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, reducedMotion: 'reduce' })
  page = await context.newPage()
  page.setDefaultTimeout(20000)
  page.on('pageerror', error => errors.push(error.message))
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const kind = new URL(route.request().url()).pathname.split('/').at(-1)
    const body = route.request().method() === 'GET' ? {} : route.request().postDataJSON(), request = { kind, body }
    requests.push(request)
    try {
      const result = await calculate(kind, body)
      request.result = result
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) })
    } catch (error) {
      errors.push(String(error))
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: String(error) }) })
    }
  })
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__reference-library`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.getByRole('button',{name:'Reference library',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Search local source pages'})).toBeVisible()
  const before=await page.evaluate(()=>JSON.stringify(window.referenceLibraryTest.project.getProjectState().modules))
  await expect(page.getByRole('checkbox',{name:'Search MIL-HDBK-217F Notice 2',exact:true})).toBeVisible()
  const boxes=page.getByRole('checkbox')
  for (let i=0;i<await boxes.count();i++) await boxes.nth(i).uncheck()
  await page.getByRole('checkbox',{name:'Search MIL-HDBK-217F Notice 2',exact:true}).check()
  await page.getByRole('textbox',{name:'Search reference pages'}).fill('failure rate')
  await page.getByRole('button',{name:'Search pages',exact:true}).click()
  await expect(page.getByText(/matching PDF pages for/)).toBeVisible({timeout:90000})
  const response=requests.find(r=>r.kind==='search')?.result
  assert.ok(response.results.length>0)
  assert.equal(response.documents.length,1)
  assert.match(response.results[0].sha256,/^[a-f0-9]{64}$/)
  await expect(page.getByRole('heading',{name:`MIL-HDBK-217F Notice 2 · PDF page ${response.results[0].pdf_page}`})).toBeVisible()
  await page.getByText('Verified source identity',{exact:true}).first().click()
  await expect(page.getByText(`SHA-256 ${response.results[0].sha256}`,{exact:true}).first()).toBeVisible()
  assert.equal(await page.getByRole('link',{name:'Official source record',exact:true}).first().getAttribute('href'),'https://quicksearch.dla.mil/qsDocDetails.aspx?ident_number=53939')
  await page.screenshot({path:join(output,'reference-page-search.png'),fullPage:true})
  checks.push('Production Help library searches the supplied controlled PDF and shows edition, physical page, verified hash and official source')
  await page.getByRole('button',{name:'Open Help',exact:true}).first().click()
  await expect(page.getByRole('heading',{name:'Lifetime tools',exact:true})).toBeVisible()
  assert.equal(await page.evaluate(()=>JSON.stringify(window.referenceLibraryTest.project.getProjectState().modules)),before)
  checks.push('Worked example opens contextual Help without modifying analysis state')
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, browser: browser.version(), requests: requests.length }, null, 2))
  console.log(JSON.stringify({ status: 'passed', checks, output }, null, 2))
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  await writeFile(join(output, 'report.json'), JSON.stringify({ status: 'failed', error: String(error), errors, checks, requests,
    body: await page?.locator('body').innerText().catch(() => null) }, null, 2))
  throw error
} finally {
  child.stdin.end()
  child.kill()
  await browser?.close()
  await closeViteTestServer(vite, cache)
}
