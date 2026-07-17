import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'vite'

// Vite creates its HMR transport even in middleware mode. Supplying an
// unbound HTTP server keeps this contract test network-free in sandboxes.
const hmrServer = createHttpServer()
const vite = await createServer({
  root: new URL('..', import.meta.url).pathname,
  appType: 'custom',
  server: { middlewareMode: true, hmr: { server: hmrServer } },
})

try {
  const markup = await vite.ssrLoadModule('/src/store/plotMarkup.ts')

  const clean = markup.sanitizePlotMarkup({
    annotations: [{
      id: 'n1', text: '<script>unsafe</script>', x: 2, y: 3,
      xref: 'x', yref: 'y', showArrow: true, color: '#123456', fontSize: 99,
    }],
    shapes: [{
      id: 's1', type: 'rect', xref: 'x', yref: 'y',
      x0: 1, x1: 2, y0: 3, y1: 4,
      color: '#2563eb', fillColor: 'rgba(37,99,235,.1)', width: 2, opacity: 1,
    }],
  })
  assert.equal(clean.annotations.length, 1)
  assert.equal(clean.annotations[0].fontSize, 32)
  assert.equal(clean.shapes.length, 1)

  const baseAnnotation = { text: 'Analytical limit', x: 1, y: 1 }
  const baseShape = { type: 'line', x0: 0, x1: 1, y0: 0, y1: 1 }
  const merged = markup.mergePlotMarkup(
    { annotations: [baseAnnotation], shapes: [baseShape] }, clean)
  assert.equal(merged.annotations.length, 2)
  assert.equal(merged.shapes.length, 2)
  assert.equal(merged.annotations[0], baseAnnotation)
  assert.match(merged.annotations[1].text, /&lt;script&gt;/)

  const split = markup.splitUserMarkupFromLayout(merged)
  assert.equal(split.layout.annotations.length, 1)
  assert.equal(split.layout.shapes.length, 1)
  assert.equal(split.markup.annotations[0].id, 'n1')
  assert.equal(split.markup.shapes[0].id, 's1')

  const moved = markup.markupFromLiveLayout(
    clean,
    [baseAnnotation, { ...merged.annotations[1], x: 9, y: 8 }],
    [baseShape, { ...merged.shapes[1], x1: 7 }],
    1,
    1,
  )
  assert.equal(moved.annotations[0].x, 9)
  assert.equal(moved.shapes[0].x1, 7)

  // Shape identity is tag-based: erasing an analytical/base shape must not
  // accidentally erase or re-index the user's shape beside it.
  const baseErased = markup.markupFromLiveLayout(
    clean,
    [baseAnnotation, merged.annotations[1]],
    [merged.shapes[1]],
    1,
    1,
  )
  assert.equal(baseErased.shapes.length, 1)
  assert.equal(baseErased.shapes[0].id, 's1')

  const userErased = markup.markupFromLiveLayout(
    clean,
    [baseAnnotation, merged.annotations[1]],
    [baseShape],
    1,
    1,
  )
  assert.equal(userErased.shapes.length, 0)

  const nativeDraw = markup.markupFromLiveLayout(
    clean,
    [baseAnnotation, merged.annotations[1]],
    [baseShape, merged.shapes[1], {
      type: 'line', xref: 'x', yref: 'y',
      x0: 2, x1: 4, y0: 1, y1: 5,
      line: { color: '#ef4444', width: 2 },
    }],
    1,
    1,
  )
  assert.equal(nativeDraw.shapes.length, 2)

  const rejected = markup.sanitizePlotMarkup({
    annotations: [{ text: 'missing coordinates' }],
    shapes: [{ type: 'rect', x0: 1 }],
  })
  assert.deepEqual(rejected, { annotations: [], shapes: [] })

  console.log('plot markup contracts passed')
} finally {
  await vite.close()
}
