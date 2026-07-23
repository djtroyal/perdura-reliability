import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'vite'
import viteConfig from '../vite.config.ts'

assert.ok(viteConfig.optimizeDeps?.include?.includes('react-plotly.js/factory'),
  'the React Plotly factory must be eagerly optimized so lazy imports do not retain an invalidated Vite hash')
assert.ok(viteConfig.optimizeDeps?.needsInterop?.includes('react-plotly.js/factory'),
  'the CommonJS Plotly factory interop shape must be fixed before the first lazy plot request')
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
  const { resolvePlotlyFactory, stripUndefinedPlotLayoutValues } = await vite.ssrLoadModule(
    '/src/components/shared/plotlyFactoryInterop.ts',
  )
  const { buildPlotViewResetUpdates } = await vite.ssrLoadModule(
    '/src/components/shared/plotViewReset.ts',
  )
  const { isDynamicImportLoadError, requestDynamicImportRecovery } = await vite.ssrLoadModule(
    '/src/components/shared/dynamicImportRecovery.ts',
  )
  const direct = value => value

  assert.equal(resolvePlotlyFactory(direct), direct)
  assert.equal(resolvePlotlyFactory({ default: direct }), direct)
  assert.equal(resolvePlotlyFactory({ default: { default: direct } }), direct)
  assert.throws(
    () => resolvePlotlyFactory({ default: {} }),
    /factory export is not callable/,
  )

  // Exercise the package's real CommonJS export shape, not just fixtures.
  const require = createRequire(import.meta.url)
  const packageFactory = require('react-plotly.js/factory.js')
  assert.equal(typeof packageFactory.default, 'function')
  assert.equal(resolvePlotlyFactory(packageFactory), packageFactory.default)

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

  const stylesheet = await import('node:fs/promises').then(fs => fs.readFile(
    new URL('../src/index.css', import.meta.url), 'utf8'))
  assert.match(stylesheet, /data-title="Reset plot view"[\s\S]*?order: -1000/,
    'reset must be ordered at the far-left edge of the modebar')
  assert.match(stylesheet, /data-title="Download plot"[\s\S]*?order: 1000/,
    'the consolidated download action must be ordered at the far-right edge')

  const lifeDataSource = await import('node:fs/promises').then(fs => fs.readFile(
    new URL('../src/components/LifeData/index.tsx', import.meta.url), 'utf8'))
  assert.match(lifeDataSource,
    /InfluenceTarget influences="lda\.confidence" className="flex min-h-0 min-w-0 flex-1 overflow-hidden"/,
    'the LDA plot highlight wrapper must preserve the flex-height chain so Plotly does not collapse after resize')

  console.log('Plotly factory interop contracts passed')
} finally {
  await vite.close()
}
