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
  project.getProjectState().modules.system = {
    missionTime: '1000', density: 'comfortable', connectorStyle: 'smoothstep',
    snapToGrid: true, showNodeIds: true,
    result: {
      system_reliability: 0.9801, system_unreliability: 0.0199,
      mission_time: 1000, restricted_mean_survival_time: 913.2,
      path_sets: [['Pump A'], ['Pump B']],
      components: [
        { id: 'a', label: 'Pump A', reliability: 0.9 },
        { id: 'b', label: 'Pump B', reliability: 0.801 },
      ],
      importance: [{ id: 'a', label: 'Pump A', reliability: 0.9, Birnbaum: 0.199, Criticality: 1, RAW: 10, RRW: null, RRW_unbounded: true }],
      time_curve: [{ time: 0, reliability: 1, unreliability: 0 }, { time: 1000, reliability: 0.9801, unreliability: 0.0199 }],
      assumptions: ['Nonrepairable mission.'], warnings: ['Review shared power.'],
      computation: { engine: 'reduced_ordered_bdd', exact: true, states_evaluated: 4, variables: 2, path_enumeration_used_for_probability: false },
    },
  }

  const assets = extractors.enumerateAssets().filter(asset => asset.module === 'system')
  const labels = new Set(assets.map(asset => asset.label))
  for (const label of [
    'System Reliability', 'System Reliability vs Time', 'Success Path Sets',
    'Importance Measures', 'Birnbaum Importance', 'Assumptions and Diagnostics',
  ]) assert.ok(labels.has(label), `missing RBD report asset: ${label}`)
  const curve = assets.find(asset => asset.label === 'System Reliability vs Time').getData()
  assert.deepEqual(curve.plotData[0].x, [0, 1000])
  assert.deepEqual(curve.plotData[0].y, [1, 0.9801])

  const source = await readFile(new URL('../src/components/SystemReliability/index.tsx', import.meta.url), 'utf8')
  assert.match(source, /id="rbd-input" type="target" position=\{Position\.Left\}/,
    'normal RBD connectors must terminate at the left-side block input')
  assert.match(source, /id="rbd-output" type="source" position=\{Position\.Right\}/,
    'normal RBD connectors must leave the right-side block output')
  assert.match(source, /sourceHandle: 'rbd-output',[\s\S]*?targetHandle: 'rbd-input'/,
    'logical edges must explicitly select the success-flow ports')
  assert.match(source, /validateRBD[\s\S]*?setShowValidationIssues\(true\)/,
    'analysis must expose blocking validation issues')
  assert.match(source, /RBD_DENSITY_LEVELS = \['dense', 'compact', 'comfortable', 'spacious', 'expanded'\]/,
    'RBD blocks must support five incremental density levels')
  assert.match(source, /copySelected[\s\S]*?ids\.has\(edge\.source\) && ids\.has\(edge\.target\)/,
    'multi-block copy must preserve internal connections')
  assert.match(source, /data-rbd-project-library[\s\S]*?addAnalysisBlock/,
    'other project RBD analyses must be addable as linked subsystem blocks')
  assert.match(source, /calculateDependency[\s\S]*?await calculateDependency[\s\S]*?writeFolioState\('system'/,
    'linked RBD analyses must be calculated recursively and persisted before their parent')
  assert.doesNotMatch(source, /disabled=\{!target\.result \|\| target\.circular\}/,
    'an RBD analysis must remain addable before its first calculation')
  assert.match(source, /linkedAnalysisId[\s\S]*?STALE_RBD_REFERENCE[\s\S]*?CIRCULAR_RBD_REFERENCE|linkedAnalysisId[\s\S]*?CIRCULAR_RBD_REFERENCE[\s\S]*?STALE_RBD_REFERENCE/,
    'linked subsystem blocks must fail closed for stale and circular references')
  assert.match(source, /annotation-target-top[\s\S]*?annotation-target-right[\s\S]*?annotation-target-bottom[\s\S]*?annotation-target-left/,
    'RBD labels must expose callout targets on every side')
  assert.match(source, /NodeResizer isVisible=\{selected\}/,
    'RBD annotations must be freely resizable')
  assert.match(source, /restricted_mean_survival_time[\s\S]*?result\.time_curve/,
    'results must expose both time projection and restricted mean survival time')
  assert.match(source, /markerEnd:[\s\S]*?strokeWidth: flowing \? 3\.2 : 1\.7/,
    'selected connectors must be unmistakably highlighted')
  assert.match(source, /mirrorSelected[\s\S]*?component_key: componentKey[\s\S]*?Mirrored logical component/,
    'RBD must create true mirrored occurrences of one logical component')
  assert.match(source, /handleCanvasShortcut[\s\S]*?key === 'c'[\s\S]*?key === 'x'[\s\S]*?key === 'v'[\s\S]*?key === 'a'/,
    'RBD canvas must support the standard copy, cut, paste, and select-all shortcuts')
  assert.match(source, /event\.key === 'Delete' \|\| event\.key === 'Backspace'/,
    'RBD canvas must support keyboard deletion without relying on React Flow terminal deletion')
  assert.match(source, /blank = system[\s\S]*?placeholder=\{`System:/,
    'component life models must visibly inherit the system mission time unless overridden')
  assert.match(source, /Array\.isArray\(detail\)[\s\S]*?issue\.loc/,
    'RBD request validation must expose field-level backend details instead of a raw HTTP 422')
  assert.match(source, /displayNodes\.find\(node => node\.id === selectedNode\.id\)[\s\S]*?setSelectedNode\(current\)/,
    'the Properties pane must stay synchronized with the current diagram node')
  assert.match(source, /Block color[\s\S]*?diagramColor', undefined[\s\S]*?Reset to default/,
    'an RBD block with a custom color must offer a true reset to the default palette')
  assert.match(source, /activePathConnectorIds[\s\S]*?candidate\.source === chain\[index\][\s\S]*?candidate\.target === chain\[index \+ 1\]/,
    'RBD path selection must resolve the exact connectors in its source-to-sink chain')
  assert.match(source, /pathHighlighted[\s\S]*?animated: flowing[\s\S]*?rbd-path-connector/,
    'connectors in the selected RBD success path must be highlighted and animated')
  assert.match(source, /isolatedLinearConnection = outgoingCounts\.get\(edge\.source\) === 1[\s\S]*?incomingCounts\.get\(edge\.target\) === 1[\s\S]*?\? 'straight' : connectorStyle/,
    'isolated source, block, and sink connections must render as straight lines without routing kinks')
  assert.doesNotMatch(source, /terminalConnection|nodeTypesById/,
    'branching source and sink connectors must use the same routing rules as branching component blocks')
  assert.match(source, /centerY - nodeHeight \/ 2/,
    'Auto Layout must align unlike terminal and block heights by connector centerline')

  const exportSource = await readFile(new URL('../src/components/shared/exportDiagram.ts', import.meta.url), 'utf8')
  assert.match(exportSource, /react-flow__background[\s\S]*?react-flow__minimap[\s\S]*?react-flow__controls[\s\S]*?react-flow__panel/,
    'diagram exports must omit grids, overview maps, navigation controls, and editor panels')
  assert.match(exportSource, /fitReactFlowForExport[\s\S]*?fitView\([\s\S]*?padding: 0\.06[\s\S]*?setViewport\(viewport/,
    'diagram exports must fit and center the full model, then restore the editor viewport')
  assert.match(source, /data-export-ignore[\s\S]*?prepareExport=\{\(\) => fitReactFlowForExport\(flowInstanceRef\.current\)\}/,
    'RBD exports must remove editor overlays and use the fitted presentation viewport')

  const demo = JSON.parse(await readFile(new URL('../src/data/demoProject.json', import.meta.url), 'utf8'))
  assert.ok(demo.modules.system.folios.length >= 2,
    'Demo Project must contain another RBD analysis for the linked-analysis library')
  assert.ok(demo.modules.system.folios.some(folio => folio.state.result?.system_reliability != null),
    'at least one Demo Project subsystem must provide a reusable calculated RBD result')

  console.log('RBD workflow and report asset contracts passed')
} finally {
  await vite.close()
}
