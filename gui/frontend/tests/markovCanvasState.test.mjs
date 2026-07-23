import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { applyNodeChanges } from '@xyflow/react'
import { createServer } from 'vite'

const hmrServer = createHttpServer()
const vite = await createServer({
  root: new URL('..', import.meta.url).pathname,
  appType: 'custom',
  server: { middlewareMode: true, ws: { server: hmrServer } },
})

try {
  const {
    clampViewport, edgeToTransition, nodeToState, stateToNode, transitionToEdge,
  } = await vite.ssrLoadModule('/src/components/Markov/index.tsx')

  const state = {
    id: 's1', name: 'Operating', state_type: 'operational', description: 'Nominal state',
    dwell_model: 'erlang', dwell_shape: 3,
  }
  const baseNode = stateToNode(state, { x: 120, y: 80 }, 'teal')

  // React Flow emits a dimensions change as soon as a newly rendered custom node is
  // measured. Keeping this change in the canonical node collection is the regression
  // for the flash-then-blank failure that occurred after State Library insertion.
  const measured = applyNodeChanges([{
    type: 'dimensions', id: 's1', dimensions: { width: 156, height: 92 }, setAttributes: true,
  }], [baseNode])
  assert.equal(measured.length, 1)
  assert.deepEqual(measured[0].measured, { width: 156, height: 92 })
  assert.equal(measured[0].data.label, 'Operating')

  const selected = applyNodeChanges([{ type: 'select', id: 's1', selected: true }], measured)
  assert.equal(selected[0].selected, true)
  const moved = applyNodeChanges([{
    type: 'position', id: 's1', position: { x: 320, y: 210 }, dragging: false,
  }], selected)
  assert.deepEqual(moved[0].position, { x: 320, y: 210 })
  assert.deepEqual(nodeToState(moved[0]), state)

  const transition = {
    id: 'tr1', from_state: 's1', to_state: 's2', rate: 0.004, label: 'λ', rate_cv: 0.15,
    sourceId: 'prediction:system', sourceName: 'System prediction',
  }
  assert.deepEqual(edgeToTransition(transitionToEdge(transition)), transition)

  assert.deepEqual(clampViewport({ x: Number.NaN, y: Number.POSITIVE_INFINITY, zoom: 99 }),
    { x: 0, y: 0, zoom: 2.5 })

  console.log('Markov canonical canvas lifecycle tests passed')
} finally {
  await vite.close()
  hmrServer.close()
}
