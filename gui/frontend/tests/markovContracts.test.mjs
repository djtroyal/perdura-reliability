import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createServer } from 'vite'

const hmrServer = createHttpServer()
const vite = await createServer({
  root: new URL('..', import.meta.url).pathname,
  appType: 'custom',
  server: { middlewareMode: true, hmr: { server: hmrServer } },
})

try {
  const project = await vite.ssrLoadModule('/src/store/project.ts')
  const extractors = await vite.ssrLoadModule('/src/store/assetExtractors.ts')
  project.getProjectState().modules.markov = {
    _folioWrap: true,
    activeId: 'm1',
    folios: [{
      id: 'm1', name: 'Repairable pump', state: {
        states: [
          { id: 'up', name: 'Up', state_type: 'operational' },
          { id: 'down', name: 'Down', state_type: 'failed' },
        ],
        transitions: [],
        result: {
          states: [
            { id: 'up', name: 'Up', type: 'operational', dwell_model: 'exponential', dwell_shape: 1 },
            { id: 'down', name: 'Down', type: 'failed', dwell_model: 'exponential', dwell_shape: 1 },
          ],
          transitions: [
            { id: 'failure', from: 'up', to: 'down', rate: 0.01, rate_cv: 0.1, label: 'λ' },
            { id: 'repair', from: 'down', to: 'up', rate: 0.1, rate_cv: 0, label: 'μ' },
          ],
          transition_matrix: [[-0.01, 0.01], [0.1, -0.1]],
          steady_state: { up: 0.9090909, down: 0.0909091 },
          system_params: { availability_ss: 0.9090909, unavailability_ss: 0.0909091, mttf: 100, mtbf: 110, mut: 100, mttr: 10, failure_frequency: 0.00909, repair_frequency: 0.00909 },
          time_dependent: [
            { time: 0, state_probs: { up: 1, down: 0 }, availability: 1, reliability: 1, unavailability: 0, unreliability: 0 },
            { time: 10, state_probs: { up: 0.939, down: 0.061 }, availability: 0.939, reliability: 0.9048, unavailability: 0.061, unreliability: 0.0952 },
          ],
          model_contract: { display_name: 'Time-homogeneous CTMC', assumptions: ['Constant rates.'], warnings: [] },
          parameter_uncertainty: { metric_intervals: { availability_ss: { lower: 0.8, median: 0.91, upper: 0.96, successful: 100 } } },
          validation: { issues: [{ severity: 'warning', code: 'CHECK_RATE', message: 'Review the rate source.' }] },
        },
      },
    }],
  }

  const assets = extractors.enumerateAssets().filter(asset => asset.module === 'markov')
  assert.ok(assets.length >= 8, 'Markov must expose its complete result surface to Report Builder')
  assert.ok(assets.every(asset => asset.group === 'Repairable pump'),
    'Markov report assets must preserve independent Analysis names')
  for (const label of [
    'System Parameters', 'Steady-State Probabilities', 'Transition Definitions',
    'State Probabilities vs Time', 'Availability & Reliability vs Time',
    'Generator Matrix Q', 'Rate-Uncertainty Intervals', 'Model Contract and Diagnostics',
  ]) assert.ok(assets.some(asset => asset.label === label), `missing Markov report asset: ${label}`)

  const source = await readFile(new URL('../src/components/Markov/index.tsx', import.meta.url), 'utf8')
  assert.match(source, /useFolioState<MarkovModuleState>\('markov'/,
    'Markov must persist independent Analysis tabs')
  assert.match(source, /ReactFlow[\s\S]*?onConnect=\{onConnect\}[\s\S]*?<MiniMap pannable zoomable nodeColor=/,
    'Markov must provide an interactive state canvas whose overview map matches state colors')
  assert.match(source, /type: 'bezier'/,
    'Markov transitions must use conventional curved state-transition arcs')
  assert.match(source, /const angle = -Math\.PI \/ 2[\s\S]*?radiusX \* Math\.cos\(angle\)[\s\S]*?radiusY \* Math\.sin\(angle\)/,
    'Markov Auto Layout and examples must use a conventional radial state arrangement')
  assert.match(source, /visibleInsertionPosition[\s\S]*?const overlaps = Object\.values\(positions\)[\s\S]*?const addState/,
    'State Library actions must place a new state in a collision-free visible position')
  const addStateSource = source.match(/const addState =[\s\S]*?\n  const removeStates =/)?.[0] ?? ''
  assert.doesNotMatch(addStateSource, /fitView/,
    'State insertion must not fit an unmeasured node and corrupt the canvas viewport')
  assert.doesNotMatch(source, /\n\s+fitView snapToGrid=/,
    'an empty Markov canvas must not leave React Flow initial fitView pending until the first state is added')
  assert.match(source, /key=\{`markov-flow-\$\{folios\.activeId\}`\}[\s\S]*?zoomOnDoubleClick=\{false\}/,
    'each Markov analysis must own an isolated canvas registry and double-click must not corrupt its viewport')
  assert.match(source, /useNodesState<MarkovModelNode>\(normalized\.canvasNodes\)[\s\S]*?useEdgesState<MarkovModelEdge>\(normalized\.canvasEdges\)/,
    'Markov must keep React Flow nodes and edges as the canonical live canvas state')
  assert.match(source, /onModelNodesChange\(sanitizeNodeChanges\(modelChanges\)/,
    'Markov must preserve React Flow measurement, selection, and position lifecycle changes')
  assert.match(source, /canvasNodes: modelNodes, canvasEdges: transitionEdges[\s\S]*?viewport/,
    'Markov must persist the complete canonical canvas and its viewport')
  assert.match(source, /persisted === pendingLocalWrite\.current[\s\S]*?return/,
    'a debounced local save must not rematerialize the active canvas')
  assert.doesNotMatch(source, /useRevision/,
    'unrelated project-store revisions must not reinitialize the active Markov canvas')
  assert.match(source, /defaultViewport=\{viewport\}[\s\S]*?onMoveEnd=\{\(_, nextViewport\) => setViewport\(clampViewport\(nextViewport\)\)\}/,
    'Markov analyses must restore and continuously persist their own viewport')
  assert.match(source, /reciprocal[\s\S]*?markov-output-top[\s\S]*?markov-output-bottom/,
    'reciprocal Markov transitions must use distinct traditional arcs')
  assert.doesNotMatch(source, /<option value="smoothstep">Orthogonal/,
    'Markov must not expose process-flow orthogonal connector styling')
  assert.match(source, /Array\.from\(\{ length: count \}[\s\S]*?maximum \* index \/ \(count - 1\)/,
    'Markov transient grids must include time zero and the mission horizon')
  assert.match(source, /describeError[\s\S]*?detail && typeof detail === 'object'[\s\S]*?issues: item\.issues/,
    'structured backend errors must be split into renderable text and diagnostics')
  assert.match(source, /validateMarkov\(apiRequest\)[\s\S]*?Model diagnostics/,
    'Markov must validate continuously and expose actionable findings')
  assert.match(source, /fitReactFlowForExport\(flowRef\.current\)/,
    'Markov diagram export must center and fit the complete model')
  assert.doesNotMatch(source, /ExportResultsButton|Export PDF/,
    'Markov must not put a PDF export control in its constrained right pane')
  assert.match(source, /selectResultState[\s\S]*?selectResultTransition/,
    'state and transition result selections must highlight the diagram')

  console.log('Markov workflow and report asset contracts passed')
} finally {
  await vite.close()
  hmrServer.close()
}
