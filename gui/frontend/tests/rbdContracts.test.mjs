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
      voting_groups: [{ id: 'vote', label: 'Channel vote', k: 2, n: 3,
        member_ids: ['a', 'b', 'c'], member_labels: ['Pump A', 'Pump B', 'Pump C'] }],
      importance: [{ id: 'a', label: 'Pump A', reliability: 0.9, Birnbaum: 0.199, Criticality: 1, RAW: 10, RRW: null, RRW_unbounded: true }],
      time_curve: [{ time: 0, reliability: 1, unreliability: 0 }, { time: 1000, reliability: 0.9801, unreliability: 0.0199 }],
      assumptions: ['Nonrepairable mission.'], warnings: ['Review shared power.'],
      computation: { engine: 'reduced_ordered_bdd', exact: true, states_evaluated: 4, variables: 2, path_enumeration_used_for_probability: false },
    },
  }

  const assets = extractors.enumerateAssets().filter(asset => asset.module === 'system')
  const labels = new Set(assets.map(asset => asset.label))
  for (const label of [
    'System Reliability', 'System Reliability vs Time', 'Success Path Sets', 'K-out-of-N Voting Groups',
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
  assert.match(source, /id: 'rbd\.copy'[\s\S]*?id: 'rbd\.cut'[\s\S]*?id: 'rbd\.paste'[\s\S]*?id: 'rbd\.select-all'/,
    'RBD canvas must register the standard copy, cut, paste, and select-all shortcuts')
  assert.match(source, /id: 'rbd\.delete'[\s\S]*?key: 'Delete'[\s\S]*?key: 'Backspace'/,
    'RBD canvas must centrally register keyboard deletion without relying on React Flow terminal deletion')
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
  assert.match(source, /isolatedLinearConnection = outgoingCounts\.get\(edge\.source\) === 1[\s\S]*?incomingCounts\.get\(edge\.target\) === 1[\s\S]*?\? 'straight'[\s\S]*?'adaptiveOrthogonal'/,
    'isolated source, block, and sink connections must render as straight lines without routing kinks')
  assert.match(source, /outgoingCounts\.get\(edge\.source\)[\s\S]*?\? 'source'[\s\S]*?incomingCounts\.get\(edge\.target\)[\s\S]*?\? 'target'/,
    'branched RBD connectors must share source-side and target-side routing buses')
  assert.doesNotMatch(source, /terminalConnection|nodeTypesById/,
    'branching source and sink connectors must use the same routing rules as branching component blocks')
  assert.match(source, /layoutHorizontalGraph[\s\S]*?viewportHeight:[\s\S]*?adaptiveRoute/,
    'Auto Layout must use measured, viewport-aware ranks and adaptive connector routing')
  assert.match(source, /setAnnotations[\s\S]*?targetNodeId[\s\S]*?next\.x - prior\.x[\s\S]*?next\.y - prior\.y/,
    'target-linked RBD annotations must follow their block during adaptive layout')
  assert.match(source, /function VotingNode[\s\S]*?K-out-of-N[\s\S]*?inputCount/,
    'RBD must render an explicit k-out-of-n voting junction with n derived from its inputs')
  assert.match(source, /addVotingJunction[\s\S]*?type: 'kofn'[\s\S]*?K-of-N/,
    'the Block Library must let users add a k-out-of-n voting junction')
  assert.match(source, /Success rule[\s\S]*?Any branch succeeds \(1-of-n\)[\s\S]*?Every branch succeeds \(n-of-n\)[\s\S]*?Required branches \(k\)[\s\S]*?Incoming branches \(n\)/,
    'voting properties must expose any, threshold, and every-branch logic while deriving n')
  assert.match(source, /convertSelectedNodeType[\s\S]*?priorComponentData[\s\S]*?K-out-of-N voting junction/,
    'Properties must convert a regular block to k-out-of-n and preserve its prior block definition')
  assert.match(source, /path_edge_ids\?\.\[activePathIndex\]/,
    'threshold success scenarios must highlight every participating parallel connector')
  assert.match(source, /voting_groups\?\.map[\s\S]*?group\.k}-of-\{group\.n/,
    'RBD results must explain each configured voting group')
  assert.match(source, /convertRBDToFTA[\s\S]*?createFolioState\('faultTree'[\s\S]*?Convert to FTA/,
    'RBD must validate an exact conversion and create a separate FTA analysis')
  assert.match(source, /autoFitOnOpen: true[\s\S]*?persisted\.autoFitOnOpen[\s\S]*?requestAnimationFrame[\s\S]*?instance\.fitView/,
    'a converted FTA must auto-fit after its measured canvas has rendered')

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
