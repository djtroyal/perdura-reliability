/** Assert the identity of the application actually rendered by the browser. */
export function assertCaptureBuildIdentity(actual, expected) {
  if (!actual?.commit || !actual?.version) {
    throw new Error('The served application has no screenshot build identity. Rebuild the frontend before capturing website resources.')
  }
  if (actual.version !== expected.version || (expected.commit && actual.commit !== expected.commit)) {
    throw new Error(`Screenshot source mismatch: served ${actual.version} (${actual.commit}), expected ${expected.version} (${expected.commit ?? 'local build'}). Rebuild the frontend with the matching VITE_APP_COMMIT or GITHUB_SHA before capturing website resources.`)
  }
  return actual
}

// This function runs in the browser; keep it self-contained for Playwright.
export function inspectCaptureReadiness(options) {
  const visible = element => {
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return style.display !== 'none' && !['hidden', 'collapse'].includes(style.visibility)
      && style.opacity !== '0' && rect.width > 0 && rect.height > 0
  }
  const errors = []
  const pending = []
  const geometry = []
  const texts = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent.trim()
    if (text && node.parentElement && visible(node.parentElement)) texts.push(text)
  }
  const error = [...document.querySelectorAll('[data-module-error]')].find(visible)
  if (error) errors.push(`application error boundary: ${error.textContent.trim()}`)
  else if (texts.some(text => /something went wrong|canvas rendering error/i.test(text))) errors.push('an application error boundary is visible')

  if (options.resultRequired) {
    const empty = new RegExp(options.emptyResultPattern, 'i')
    for (const text of texts.filter(text => empty.test(text))) pending.push(`completed-analysis capture still shows: ${text}`)
  }
  for (const text of texts.filter(text => /^Loading(?: chart| plot| diagram| module)?(?:…|\.{3})?$/i.test(text))) {
    pending.push(text)
  }
  if ([...document.querySelectorAll('[aria-busy="true"], [aria-label="Loading chart"]')].some(visible)) {
    pending.push('a visible component is still loading')
  }
  if (document.fonts?.status === 'loading') pending.push('fonts are still loading')
  for (const image of [...document.images].filter(visible)) {
    if (!image.complete) pending.push(`image is still loading: ${image.getAttribute('src')}`)
    else if (image.naturalWidth === 0) errors.push(`image failed to load: ${image.getAttribute('src')}`)
  }

  const graphs = [...document.querySelectorAll('.js-plotly-plot')].filter(visible)
  if (graphs.length < (options.minPlots ?? 0)) pending.push(`expected at least ${options.minPlots} rendered plot(s); found ${graphs.length}`)
  for (const [index, graph] of graphs.entries()) {
    const bounds = graph.getBoundingClientRect()
    const surface = [...graph.querySelectorAll('.main-svg, canvas')].find(visible)
    if (!Number.isFinite(graph._fullLayout?.width) || graph._fullLayout.width <= 0
      || !Number.isFinite(graph._fullLayout?.height) || graph._fullLayout.height <= 0 || !surface) {
      pending.push(`plot ${index + 1} has not rendered its chart geometry`)
    }
    geometry.push([bounds.x, bounds.y, bounds.width, bounds.height, graph._fullLayout?.width, graph._fullLayout?.height])
  }
  const nodes = [...document.querySelectorAll('.react-flow__node')].filter(visible)
  if (nodes.length < (options.minDiagramNodes ?? 0)) pending.push(`expected at least ${options.minDiagramNodes} diagram node(s); found ${nodes.length}`)
  for (const node of nodes) {
    const bounds = node.getBoundingClientRect()
    geometry.push([bounds.x, bounds.y, bounds.width, bounds.height])
  }

  const state = { ready: errors.length === 0 && pending.length === 0, errors, pending }
  if (options.inspectOnly) return state
  if (errors.length) return state
  if (!state.ready) {
    delete window.__PERDURA_CAPTURE_SETTLED__
    return false
  }
  // Two consecutive animation frames with matching chart/canvas geometry let
  // React commit and ResizeObserver finish without a machine-dependent sleep.
  const signature = JSON.stringify(geometry)
  const previous = window.__PERDURA_CAPTURE_SETTLED__
  window.__PERDURA_CAPTURE_SETTLED__ = { id: options.id, signature }
  return previous?.id === options.id && previous.signature === signature ? state : false
}

export async function waitForCaptureReady(page, capture, { emptyResultPattern, timeout = 30_000 } = {}) {
  const options = {
    id: capture.id, resultRequired: capture.resultRequired,
    emptyResultPattern: emptyResultPattern.source, ...capture.readiness,
  }
  let handle
  try {
    handle = await page.waitForFunction(inspectCaptureReadiness, options, { polling: 'raf', timeout })
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error
    const state = await page.evaluate(inspectCaptureReadiness, { ...options, inspectOnly: true })
    throw new Error(`${capture.id}: screenshot did not become ready: ${[...state.errors, ...state.pending].join('; ') || 'chart or diagram geometry did not settle'}`, { cause: error })
  }
  const state = await handle.jsonValue()
  await handle.dispose()
  if (state.errors.length) throw new Error(`${capture.id}: ${state.errors.join('; ')}`)
}
