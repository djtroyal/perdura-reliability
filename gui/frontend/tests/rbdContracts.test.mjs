import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createServer } from 'vite'

const hmrServer = createHttpServer()
const vite = await createServer({
  root: new URL('..', import.meta.url).pathname,
  appType: 'custom',
  server: { middlewareMode: true, ws: { server: hmrServer } },
})

try {
  const project = await vite.ssrLoadModule('/src/store/project.ts')
  const extractors = await vite.ssrLoadModule('/src/store/assetExtractors.ts')
  const edgeIntegrity = await vite.ssrLoadModule('/src/components/SystemReliability/rbdEdges.ts')
  const drawing = await vite.ssrLoadModule('/src/components/shared/DiagramDrawing.tsx')
  const gesture = drawing.normalizeFreehandGesture([
    { x: 100, y: 80 }, { x: 130, y: 95 }, { x: 160, y: 85 },
  ])
  assert.ok(gesture.width >= 28 && gesture.height >= 28,
    'pencil gestures must create a selectable, resizable annotation bound')
  assert.ok(gesture.points.every(point => point.x >= 0 && point.x <= 100 && point.y >= 0 && point.y <= 100),
    'pencil points must be normalized for persistence and resizing')
  assert.match(drawing.freehandPath(gesture.points, true), / C /,
    'smoothed pencil annotations must use a gentle pass-through curve')
  assert.doesNotMatch(drawing.freehandPath(gesture.points, false), /[CQ]/,
    'freeform pencil annotations must preserve literal line segments')
  assert.ok(drawing.VECTOR_SHAPES.some(option => option.value === 'diamond'),
    'shape annotations must provide more than rectangular containers')
  assert.equal(drawing.annotationFillColor('#eff6ff', 0), 'rgba(239, 246, 255, 0)',
    'zero annotation opacity must produce no fill without hiding the outline')
  project.setModuleState('__annotationHistory', {
    _folioWrap: true,
    activeId: 'f0',
    folios: [{ id: 'f0', name: 'Analysis 1', state: { annotations: [] } }],
  })
  project.writeFolioState('__annotationHistory', 'f0', {
    annotations: [{ id: 'shape-1', data: { annotationKind: 'shape' } }],
  }, 'annotation-add-shape-1')
  project.undo()
  assert.deepEqual(
    project.getProjectState().modules.__annotationHistory.folios[0].state.annotations,
    [],
    'one global Undo must remove the annotation that was just added',
  )
  project.redo()
  const recovered = edgeIntegrity.normalizeRbdEdges([
    { id: 'same-id', source: 'source', target: 'a', sourceHandle: 'old-source' },
    { id: 'same-id', source: 'a', target: 'sink', targetHandle: 'old-target' },
    { id: '', source: 'source', target: 'b' },
  ])
  assert.equal(new Set(recovered.map(edge => edge.id)).size, recovered.length,
    'persisted duplicate RBD edge IDs must be repaired')
  assert.ok(recovered.every(edge =>
    edge.sourceHandle === 'rbd-output' && edge.targetHandle === 'rbd-input'),
  'persisted RBD connectors must be rebound to the current node handles')
  assert.equal(edgeIntegrity.nextRbdEdgeId([
    { id: 'rbd-edge-1' }, { id: 'rbd-edge-2' },
  ]), 'rbd-edge-3', 'new RBD edge IDs must be collision-free')
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
  assert.match(source, /normalizeRbdEdges\(persisted\.edges\)[\s\S]*?nextRbdEdgeId\(current\)/,
    'loaded and newly drawn RBD connectors must maintain unique render identities')
  assert.match(source, /connectionLineStyle=\{\{ stroke: '#2563eb', strokeWidth: 2\.25 \}\}/,
    'drawing a new RBD connector must provide a clearly visible preview')
  assert.match(source, /validateRBD[\s\S]*?setShowValidationIssues\(true\)/,
    'analysis must expose blocking validation issues')
  assert.match(source, /RBD_DENSITY_LEVELS = \['dense', 'compact', 'comfortable', 'spacious', 'expanded'\]/,
    'RBD blocks must support five incremental density levels')
  assert.match(source, /<Magnet size=\{12\} \/> Snap/,
    'the RBD Snap control must use the shared magnet icon')
  assert.match(source,
    /<CanvasAssetControls[\s\S]*?<LayoutGrid size=\{12\} \/> Auto Layout/,
    'RBD bookmark and snapshot icons must be the leftmost canvas actions')
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
  assert.match(source, /type: connectorStyle === 'smoothstep' \? 'adaptiveOrthogonal' : connectorStyle/,
    'every orthogonal RBD connection must use the right-angle router, including isolated sink links')
  assert.match(source, /outgoingCounts\.get\(edge\.source\)[\s\S]*?\? 'source'[\s\S]*?incomingCounts\.get\(edge\.target\)[\s\S]*?\? 'target'/,
    'branched RBD connectors must share source-side and target-side routing buses')
  assert.doesNotMatch(source, /terminalConnection|nodeTypesById/,
    'branching source and sink connectors must use the same routing rules as branching component blocks')
  assert.match(source, /layoutHorizontalGraph[\s\S]*?viewportHeight:[\s\S]*?adaptiveRoute/,
    'Auto Layout must use measured, viewport-aware ranks and adaptive connector routing')
  assert.match(source, /flex h-8 items-center gap-1 whitespace-nowrap rounded border border-slate-300[\s\S]*?Auto Layout[\s\S]*?buttonClassName="flex h-8 items-center gap-1 rounded border border-slate-300/,
    'RBD canvas and export actions must use the same 32-pixel control treatment as FTA')
  assert.match(source, /setAnnotations[\s\S]*?targetNodeId[\s\S]*?next\.x - prior\.x[\s\S]*?next\.y - prior\.y/,
    'target-linked RBD annotations must follow their block during adaptive layout')
  assert.match(source, /addShapeAnnotation[\s\S]*?annotationKind: 'shape'[\s\S]*?setPencilMode\('smooth'\)[\s\S]*?<Pencil size=\{11\} \/> Pencil[\s\S]*?PencilCanvasOverlay/,
    'RBD annotations must support persistent shapes and one gently smoothed Pencil tool')
  assert.doesNotMatch(source, /Pencil ·|setPencilMode\('freehand'\)|>Freeform</,
    'RBD must not expose obsolete pencil variants')
  assert.match(source, /VectorAnnotationNode[\s\S]*?ShapeAnnotationPalette[\s\S]*?Stroke width/,
    'RBD vector annotations must remain resizable and use the visual shape palette in Properties')
  assert.match(source, /\[100, 85, 70, 50, 30, 0\][\s\S]*?0% · No fill/,
    'RBD opacity selectors must include a zero-opacity No fill choice')
  assert.match(source, /writeFolioState\([\s\S]*?`annotation-add-\$\{annotation\.id\}`[\s\S]*?snapToGrid: false/,
    'RBD annotation additions must be atomic undo steps and pencil sampling must bypass the layout grid')
  assert.match(source, /annotations\.filter\(annotation => annotation\.selected\)[\s\S]*?selectedAnnotationIds\.add\(selectedAnnotationId\)[\s\S]*?!selectedAnnotationIds\.has\(node\.id\)/,
    'RBD marquee deletion must remove every selected annotation together')
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
  const globalCss = await readFile(new URL('../src/index.css', import.meta.url), 'utf8')
  assert.match(globalCss, /:has\(\.react-flow__handle\.connectingfrom\)[\s\S]*?\.react-flow__node:not\(:has\(\.react-flow__handle\.connectingfrom\)\)[\s\S]*?\.react-flow__handle\.connectionindicator[\s\S]*?opacity: 0\.78 !important/,
    'all System Modeling canvases must gently reveal eligible connector snap targets while excluding the source node')
  assert.match(globalCss, /animation: perdura-connector-target-pulse 1\.65s ease-in-out infinite[\s\S]*?@keyframes perdura-connector-target-pulse[\s\S]*?prefers-reduced-motion: reduce/,
    'eligible snap targets must pulse gently and respect reduced-motion preferences')

  const demo = JSON.parse(await readFile(new URL('../src/data/demoProject.json', import.meta.url), 'utf8'))
  assert.ok(demo.modules.system.folios.length >= 2,
    'Demo Project must contain another RBD analysis for the linked-analysis library')
  assert.ok(demo.modules.system.folios.some(folio => folio.state.result?.system_reliability != null),
    'at least one Demo Project subsystem must provide a reusable calculated RBD result')

  console.log('RBD workflow and report asset contracts passed')
} finally {
  await vite.close()
}
