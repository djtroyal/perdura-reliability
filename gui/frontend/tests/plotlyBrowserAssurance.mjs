import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : fallback
}
const baseUrl = option('--base-url', 'http://127.0.0.1:4173')
const output = resolve(option('--output-dir', 'plotly-browser-assurance'))
const plotlyVersion = JSON.parse(await readFile(`${frontend}/node_modules/plotly.js/package.json`, 'utf8')).version
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] })
const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, acceptDownloads: true })
await context.addInitScript(() => {
  try { localStorage.setItem('perdura-assurance-export-enabled', 'false') } catch { /* opaque test documents */ }
})
const results = []
let activeScenario
let activePage
try {
  for (const scenario of [
    { id: 'cartesian', module: 'prediction', fixture: 'prediction.overview', tabs: [], trace: 'bar' },
    { id: 'scatter3d', module: 'alt', fixture: 'alt.multi-stress', tabs: ['alt', 'multi'], trace: 'scatter3d' },
    { id: 'sankey', module: 'prediction', fixture: 'prediction.overview', tabs: [], trace: 'sankey' },
  ]) {
    const page = await context.newPage()
    const errors = []
    const consoleErrors = []
    activePage = page
    activeScenario = { scenario: scenario.id, errors, consoleErrors }
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 1000))
    })
    // The Vite preview lacks the backend's CSP. Retain the same restriction
    // on image-data fetching in both environments so export regressions recur.
    await page.route(url => url.origin === new URL(baseUrl).origin && url.pathname === '/', async route => {
      const response = await route.fetch()
      const headers = response.headers()
      headers['content-security-policy'] ??= "connect-src 'self'; img-src 'self' data: blob:"
      await route.fulfill({ response, headers })
    })
    await page.route('**/api/**', route => {
      // This isolates plotting from calculation availability while retaining
      // the application's normal compatibility negotiation and input handling.
      if (new URL(route.request().url()).pathname === '/api/v1/version') {
        const headers = route.request().headers()
        const contract = Number(headers['x-perdura-client-api-contract'])
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
          version: headers['x-perdura-client-version'],
          api_contract: contract,
          minimum_client_api_contract: contract,
          maximum_client_api_contract: contract,
        }) })
      }
      return route.abort()
    })
    await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost).*/, route => route.abort())
    await page.goto(`${baseUrl}/?perduraShowcase=1&perduraSeedShowcase=1&module=${scenario.module}`, { waitUntil: 'domcontentloaded' })
    await page.locator('[data-perdura-showcase="ready"]').waitFor({ timeout: 60000 })
    const saved = JSON.parse(await readFile(`${frontend}/public/website-showcase/${scenario.fixture}.json`, 'utf8'))
    if (scenario.module === 'prediction') {
      const slice = saved.modules.prediction
      const analysis = slice._folioWrap ? slice.folios.find(folio => folio.id === slice.activeId).state : slice
      analysis.contributionChartMode = scenario.trace === 'sankey' ? 'sankey' : 'pareto'
    }
    // ALT and Prediction retain the fixture's calculation-engine revision.
    // Preserve metadata so stale outputs still follow normal invalidation.
    await page.route('**/website-showcase/smoke.json', route => route.fulfill({
      contentType: 'application/json', body: JSON.stringify(saved),
    }))
    assert.equal(await page.evaluate(() => window.__PERDURA_LOAD_SHOWCASE__('smoke')), true)
    for (const tab of scenario.tabs) {
      await page.locator(`[data-tab-id="${tab}"]:visible`).last().click()
    }
    await page.waitForFunction(trace => [...document.querySelectorAll('.js-plotly-plot')]
      .some(graph => graph._fullLayout && graph.data?.some(item => (item.type || 'scatter') === trace)), scenario.trace, { timeout: 60000 })
    const graphs = page.locator('.js-plotly-plot')
    let graph
    for (let index = 0; index < await graphs.count(); index++) {
      const candidate = graphs.nth(index)
      if (await candidate.evaluate((node, trace) => node.data.some(item => (item.type || 'scatter') === trace), scenario.trace)) {
        graph = candidate
        break
      }
    }
    assert.ok(graph)
    await graph.scrollIntoViewIfNeeded()
    if (scenario.trace === 'scatter3d') {
      await expect.poll(() => graph.locator('canvas').count()).toBeGreaterThan(0)
    }
    if (scenario.trace === 'sankey') {
      await expect.poll(() => graph.locator('.sankey-node').count()).toBeGreaterThan(0)
    }
    const figure = await graph.evaluate(node => ({
      types: node.data.map(item => item.type || 'scatter'), width: node._fullLayout.width,
      height: node._fullLayout.height, canvases: node.querySelectorAll('canvas').length,
      points: node.data.reduce((count, trace) => count + (trace.x?.length || trace.node?.label?.length || 0), 0),
    }))
    assert.ok(figure.width > 100 && figure.height > 100 && figure.points > 0)
    if (scenario.trace === 'scatter3d') assert.ok(figure.canvases > 0)
    await page.setViewportSize({ width: 1360, height: 1100 })
    await expect.poll(() => graph.evaluate(node => node._fullLayout.width)).toBeLessThan(figure.width)
    await page.setViewportSize({ width: 1600, height: 1100 })
    await expect.poll(() => graph.evaluate(node => node._fullLayout.width)).toBe(figure.width)
    const interactions = ['resize']
    const note = 'Browser assurance note'
    if (scenario.id === 'cartesian') {
      await graph.scrollIntoViewIfNeeded()
      const geometry = await graph.evaluate(node => ({
        range: node._fullLayout.xaxis.range,
        ...node._fullLayout._size,
      }))
      const box = await graph.boundingBox()
      await page.screenshot({ path: `${output}/${scenario.id}-before-interaction.png` })
      await page.mouse.move(box.x + geometry.l + geometry.w * 0.2, box.y + geometry.t + geometry.h * 0.2)
      await page.mouse.down()
      await page.mouse.move(box.x + geometry.l + geometry.w * 0.7, box.y + geometry.t + geometry.h * 0.7, { steps: 10 })
      await page.mouse.up()
      await expect.poll(() => graph.evaluate(node => node._fullLayout.xaxis.range)).not.toEqual(geometry.range)
      await graph.locator('[data-title="Reset plot view"]').click({ force: true })
      await expect.poll(() => graph.evaluate(node => node._fullLayout.xaxis.range)).toEqual(geometry.range)
      await graph.locator('[data-title="Annotate plot"]').click({ force: true })
      await page.getByRole('button', { name: 'Text / callout', exact: true }).click()
      await page.mouse.click(box.x + geometry.l + geometry.w * 0.4, box.y + geometry.t + geometry.h * 0.4)
      const dialog = page.getByRole('dialog', { name: 'Add plot note', exact: true })
      await dialog.getByPlaceholder('Type an observation or callout…').fill(note)
      await dialog.getByRole('button', { name: 'Save', exact: true }).click()
      await expect.poll(() => graph.evaluate((node, text) =>
        node._fullLayout.annotations.some(item => item.text === text), note)).toBe(true)
      await graph.locator('[data-title="Reset plot view"]').click({ force: true })
      await expect.poll(() => graph.evaluate((node, text) =>
        node._fullLayout.annotations.some(item => item.text === text), note)).toBe(true)
      interactions.push('drag zoom', 'reset view', 'add note', 'reset preserves note')
    }
    await graph.screenshot({ path: `${output}/${scenario.id}.png` })
    const downloads = []
    for (const format of ['svg', 'html']) {
      await graph.locator('[data-title="Download plot"]').click({ force: true })
      const downloading = page.waitForEvent('download', { timeout: 45000 })
      await page.getByRole('menuitem', { name: format === 'svg' ? /SVG vector/ : /Interactive HTML/ }).click()
      const download = await downloading
      assert.equal(await download.failure(), null)
      const path = `${output}/${scenario.id}.${format}`
      await download.saveAs(path)
      const content = await readFile(path, 'utf8')
      assert.ok(content.length > 1000)
      assert.match(content, format === 'svg' ? /<svg\b/ : /Plotly\.newPlot/)
      if (scenario.id === 'cartesian') assert.ok(content.includes(note), 'downloads must preserve user annotations')
      if (format === 'html') {
        assert.ok(content.includes(`plotly-${plotlyVersion}.min.js`), 'HTML must load the installed Plotly version')
        const reloaded = await context.newPage()
        const exportErrors = []
        reloaded.on('pageerror', error => exportErrors.push(error.message))
        await reloaded.route('https://cdn.plot.ly/**', async route => route.fulfill({
          contentType: 'text/javascript', body: await readFile(`${frontend}/node_modules/plotly.js/dist/plotly.min.js`),
        }))
        await reloaded.setContent(content, { waitUntil: 'load' })
        await reloaded.waitForFunction(trace => document.getElementById('p')?._fullData
          ?.some(item => item.type === trace), scenario.trace, { timeout: 45000 })
        assert.deepEqual(exportErrors, [], 'downloaded HTML must execute without uncaught errors')
        await reloaded.close()
      }
      downloads.push({ format, path, bytes: Buffer.byteLength(content) })
    }
    assert.deepEqual(errors, [], `${scenario.id} must not cause uncaught browser errors`)
    results.push({ plotlyVersion, scenario: scenario.id, status: 'passed', figure, interactions, downloads, errors })
    console.log(JSON.stringify(results.at(-1)))
    await page.close()
  }
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: `${output}/failure.png` }).catch(() => {})
  }
  results.push({ status: 'failed', ...activeScenario, error: error.stack })
  throw error
} finally {
  await writeFile(`${output}/report.json`, `${JSON.stringify(results, null, 2)}\n`)
  await browser.close()
}
