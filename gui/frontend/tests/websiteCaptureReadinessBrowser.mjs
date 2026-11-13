import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { EMPTY_RESULT_PATTERN } from '../website/captures.mjs'
import { inspectCaptureReadiness, waitForCaptureReady } from '../website/capture-readiness.mjs'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
const capture = { id: 'readiness-regression', resultRequired: true, readiness: { minPlots: 1 } }
const options = { emptyResultPattern: EMPTY_RESULT_PATTERN, timeout: 5_000 }
const twoFrames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
const renderPlot = () => page.evaluate(() => {
  const graph = document.createElement('div')
  graph.className = 'js-plotly-plot'
  graph.style.cssText = 'width:400px;height:240px'
  graph.innerHTML = '<svg class="main-svg" width="400" height="240"><path d="M0 200 L400 0"/></svg>'
  graph._fullLayout = { width: 400, height: 240 }
  document.body.replaceChildren(graph)
})

try {
  await page.setContent('<div aria-label="Loading chart">Loading chart…</div>')
  let ready = false
  const waiting = waitForCaptureReady(page, capture, options).then(() => { ready = true })
  await twoFrames()
  assert.equal(ready, false, 'loading placeholders must not be captured')
  await renderPlot()
  await waiting
  assert.equal(ready, true, 'capture proceeds when the chart has rendered')

  await page.setContent('<div>No results yet</div>')
  const fixtureWaiting = waitForCaptureReady(page, capture, options)
  await twoFrames()
  await renderPlot()
  await fixtureWaiting

  await page.setContent('<div class="js-plotly-plot" style="width:400px;height:240px"></div>')
  await assert.rejects(waitForCaptureReady(page, capture, { ...options, timeout: 100 }), /has not rendered its chart geometry/)
  await renderPlot()
  await page.locator('.js-plotly-plot').evaluate(graph => { graph._fullLayout.width = NaN })
  await assert.rejects(waitForCaptureReady(page, capture, { ...options, timeout: 100 }), /has not rendered its chart geometry/)

  await page.setContent('<div>No results yet</div>')
  await assert.rejects(waitForCaptureReady(page, capture, { ...options, timeout: 100 }), /completed-analysis capture still shows: No results yet/)

  for (const markup of [
    '<div data-module-error="LDA">A render failed.</div>',
    '<div>LDA — something went wrong</div>',
    '<div>SOMETHING WENT WRONG</div>',
    '<div>Canvas rendering error</div>',
  ]) {
    await page.setContent(markup)
    await assert.rejects(waitForCaptureReady(page, capture, options), /application error boundary/)
  }

  await page.setContent('<div style="display:none"><div data-module-error="Hidden">Something went wrong</div><div>Loading chart…</div><div>No results yet</div></div><p>Configured diagram</p>')
  await waitForCaptureReady(page, { id: 'hidden-messages', resultRequired: false }, options)

  await page.setContent('<div class="react-flow__node" style="width:120px;height:60px;visibility:hidden">A</div>')
  const diagram = { id: 'diagram', resultRequired: false, readiness: { minDiagramNodes: 1 } }
  const diagramWaiting = waitForCaptureReady(page, diagram, options)
  await twoFrames()
  const pending = await page.evaluate(inspectCaptureReadiness, {
    id: diagram.id, ...diagram.readiness, inspectOnly: true,
  })
  assert.equal(pending.ready, false, 'unmeasured/hidden ReactFlow nodes are not ready')
  await page.locator('.react-flow__node').evaluate(node => { node.style.visibility = 'visible' })
  await diagramWaiting

  await page.setContent('<p>Results</p><img src="data:image/png;base64,not-a-png" alt="broken">')
  await assert.rejects(waitForCaptureReady(page, { id: 'broken-image', resultRequired: false }, options), /image failed to load/)
  console.log('website screenshot readiness browser regressions passed')
} finally {
  await browser.close()
}
