import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'vite'
import viteConfig from '../vite.config.ts'

assert.ok(viteConfig.optimizeDeps?.include?.includes('react-plotly.js/factory'),
  'the React Plotly factory must be eagerly optimized so lazy imports do not retain an invalidated Vite hash')
assert.ok(!viteConfig.optimizeDeps?.needsInterop?.includes('react-plotly.js/factory'),
  'the public ESM Plotly factory must not be forced through legacy CommonJS interop')
assert.ok(!viteConfig.optimizeDeps?.include?.includes('plotly.js/lib/scatter3d'),
  'the large Plotly trace graph must remain lazy instead of blocking dev-server startup')
for (const dependency of ['react', 'react-dom']) {
  assert.ok(viteConfig.resolve?.dedupe?.includes(dependency),
    `${dependency} must be deduplicated across the lazy react-plotly.js factory boundary`)
}

const hmrServer = createHttpServer()
const vite = await createServer({
  root: new URL('..', import.meta.url).pathname,
  appType: 'custom',
  server: { middlewareMode: true, ws: { server: hmrServer } },
})

try {
  const { stripUndefinedPlotLayoutValues } = await vite.ssrLoadModule(
    '/src/components/shared/plotlyFactoryInterop.ts',
  )
  const { buildPlotViewResetUpdates } = await vite.ssrLoadModule(
    '/src/components/shared/plotViewReset.ts',
  )
  const { buildInteractivePlotHtml, EXPORTED_PLOT_TRACE_TYPES } = await vite.ssrLoadModule(
    '/src/components/shared/plotHtml.ts',
  )
  const { isDynamicImportLoadError, requestDynamicImportRecovery } = await vite.ssrLoadModule(
    '/src/components/shared/dynamicImportRecovery.ts',
  )
  // Exercise the installed public ESM export and create a component with the
  // injected runtime. A private factory.js import is unsupported in v4.
  const { default: createPlotlyComponent } = await import('react-plotly.js/factory')
  assert.equal(typeof createPlotlyComponent, 'function')
  const Plot = createPlotlyComponent({})
  assert.equal(Plot.$$typeof, Symbol.for('react.forward_ref'))

  assert.equal(isDynamicImportLoadError(new TypeError(
    'error loading dynamically imported module: http://localhost:5173/node_modules/.vite/deps/react-plotly__js_factory.js?v=stale',
  )), true)
  assert.equal(isDynamicImportLoadError(new Error('calculation failed')), false)
  const recoveryState = new Map()
  let reloads = 0
  const recoveryEnvironment = {
    now: () => 1_000,
    reload: () => { reloads += 1 },
    schedule: callback => callback(),
    storage: {
      getItem: key => recoveryState.get(key) ?? null,
      setItem: (key, value) => recoveryState.set(key, value),
    },
  }
  assert.equal(requestDynamicImportRecovery(
    new Error('Failed to fetch dynamically imported module: http://localhost:5173/assets/Prediction-old.js'),
    recoveryEnvironment,
  ), true)
  assert.equal(reloads, 1)

  const layout = stripUndefinedPlotLayoutValues({
    title: { text: 'Plot' }, xaxis: undefined, yaxis: undefined,
  })
  assert.deepEqual(layout, { title: { text: 'Plot' } })
  assert.equal('xaxis' in layout, false)
  assert.equal('yaxis' in layout, false)

  const reset = buildPlotViewResetUpdates({
    xaxis: { range: [2, 8] },
    yaxis: {},
    scene: { camera: { eye: { x: 1, y: 2, z: 3 } } },
    legend: { x: 0.25, y: 0.75 },
  }, {
    xaxis: {}, yaxis: {}, xaxis2: {}, scene: {}, legend: {},
  })
  assert.deepEqual(reset['xaxis.range'], [2, 8])
  assert.equal(reset['xaxis.autorange'], false)
  assert.equal(reset['yaxis.autorange'], true)
  assert.equal(reset['xaxis2.autorange'], true)
  assert.deepEqual(reset['scene.camera'], { eye: { x: 1, y: 2, z: 3 } })
  assert.equal(reset['scene.dragmode'], 'orbit')
  assert.equal(reset['legend.x'], 0.25)
  assert.equal(reset['legend.y'], 0.75)
  assert.equal(reset.dragmode, 'zoom')

  const innerSource = await import('node:fs/promises').then(fs => fs.readFile(
    new URL('../src/components/shared/ExportablePlotInner.tsx', import.meta.url), 'utf8'))
  const plotlyBundleSource = await import('node:fs/promises').then(fs => fs.readFile(
    new URL('../src/components/shared/plotly.ts', import.meta.url), 'utf8'))
  const registeredTraceImports = [...plotlyBundleSource.matchAll(
    /import \w+ from 'plotly\.js\/lib\/([^']+)'/g,
  )].map(match => match[1]).filter(name => name !== 'core').sort()
  assert.deepEqual([...EXPORTED_PLOT_TRACE_TYPES].sort(), registeredTraceImports,
    'HTML exports must support exactly the trace families present in the custom runtime')

  const exportedData = EXPORTED_PLOT_TRACE_TYPES.map(type => ({ type, name: `Trace ${type}` }))
  const exportedLayout = { title: { text: 'Test </script> figure' }, scene: { camera: { eye: { x: 2 } } } }
  const html = buildInteractivePlotHtml(exportedData, exportedLayout, '<Exported>')
  assert.ok(html.includes('<title>&lt;Exported&gt;</title>'))
  assert.ok(html.includes('https://cdn.plot.ly/plotly-3.7.0.min.js'))
  assert.ok(!html.includes('Test </script> figure'))
  const { runInNewContext } = await import('node:vm')
  let plotArguments
  runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], {
    Plotly: { newPlot: (...args) => { plotArguments = args } },
  })
  assert.deepEqual(JSON.parse(JSON.stringify(plotArguments[1])), exportedData,
    'every supported trace must survive HTML serialization unchanged')
  assert.deepEqual(JSON.parse(JSON.stringify(plotArguments[2])), exportedLayout,
    '3D camera and user layout must survive HTML serialization unchanged')
  assert.doesNotThrow(() => buildInteractivePlotHtml([{ x: [1], y: [2] }], {}, 'Default scatter'))
  for (const type of ['scattermap', 'scattermapbox', 'choroplethmap', 'densitymap', 'unknown']) {
    assert.throws(() => buildInteractivePlotHtml([{ type }], {}, 'Unsupported'),
      /does not support trace type/)
  }
  for (const key of ['map', 'map2', 'mapbox', 'mapbox3']) {
    assert.throws(() => buildInteractivePlotHtml([{ type: 'scatter' }], { [key]: {} }, 'Map layout'),
      /does not support map layouts/)
  }
  assert.match(plotlyBundleSource, /import sankey from 'plotly\.js\/lib\/sankey'/,
    'the slim Plotly bundle must include the Sankey trace used by Failure Rate Prediction')
  assert.match(plotlyBundleSource, /Plotly\.register\([\s\S]*?\bsankey\b[\s\S]*?\]\)/,
    'the Sankey trace must be registered with the shared Plotly runtime')
  assert.match(innerSource, /controlsHidden[\s\S]*?Reset plot view/,
    'plots with a hidden mode bar must expose an independent reset-view control')
  assert.match(innerSource, /RESET_ICON = PLOTLY_ICONS\?\.undo[\s\S]*?title: 'Reset plot view'/,
    'the reset-view modebar action must use the circular-arrow icon instead of Plotly\'s house')
  assert.match(innerSource, /modeBarButtonsToRemove[\s\S]*?'toImage'[\s\S]*?'resetScale2d'/,
    'Plotly\'s dedicated image and house-reset buttons must be removed')
  assert.match(innerSource, /title: 'Download plot'[\s\S]*?downloadMenuOpen[\s\S]*?PNG image[\s\S]*?SVG vector[\s\S]*?Interactive HTML/,
    'one download action must open the PNG, SVG, and interactive HTML choices')
  assert.doesNotMatch(innerSource, /name: 'Download as SVG'|name: 'Download interactive HTML'/,
    'SVG and HTML must not remain dedicated modebar buttons')
  assert.match(innerSource, /Draw a gently smoothed freehand annotation[\s\S]*?>\s*Pencil\s*</,
    'every shared Plotly annotation menu must expose the gently smoothed Pencil tool')
  assert.match(innerSource, /PlotShapeButton shape="line"[\s\S]*?shape="rectangle"[\s\S]*?shape="circle"/,
    'Plotly shape annotations must use a visual shape palette')
  assert.match(innerSource, /Existing annotations[\s\S]*?deleteMarkupItem\(selection\)[\s\S]*?Clear all annotations/,
    'Plotly markup must support selecting and deleting one item or clearing every annotation')

  const stylesheet = await import('node:fs/promises').then(fs => fs.readFile(
    new URL('../src/index.css', import.meta.url), 'utf8'))
  assert.match(stylesheet, /data-title="Reset plot view"[\s\S]*?order: -1000/,
    'reset must be ordered at the far-left edge of the modebar')
  assert.match(stylesheet, /data-title="Download plot"[\s\S]*?order: 1000/,
    'the consolidated download action must be ordered at the far-right edge')

  const lifeDataSource = await import('node:fs/promises').then(fs => fs.readFile(
    new URL('../src/components/LifeData/index.tsx', import.meta.url), 'utf8'))
  assert.match(lifeDataSource,
    /InfluenceTarget influences="lda\.confidence" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"[\s\S]*?<div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">\s*\{renderPlotPanel\(\)\}/,
    'the LDA confidence context and plot region must preserve the nested flex-height chain so Plotly does not collapse after resize')

  console.log('Plotly factory interop contracts passed')
} finally {
  await vite.close()
}
