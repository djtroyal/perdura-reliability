import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'vite'

const hmrServer = createHttpServer()
const vite = await createServer({
  root: new URL('..', import.meta.url).pathname,
  appType: 'custom',
  server: { middlewareMode: true, hmr: { server: hmrServer } },
})

try {
  const { resolvePlotlyFactory, stripUndefinedPlotLayoutValues } = await vite.ssrLoadModule(
    '/src/components/shared/plotlyFactoryInterop.ts',
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

  const layout = stripUndefinedPlotLayoutValues({
    title: { text: 'Plot' }, xaxis: undefined, yaxis: undefined,
  })
  assert.deepEqual(layout, { title: { text: 'Plot' } })
  assert.equal('xaxis' in layout, false)
  assert.equal('yaxis' in layout, false)

  console.log('Plotly factory interop contracts passed')
} finally {
  await vite.close()
}
