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
  const transferViews = await vite.ssrLoadModule('/src/components/FaultTree/transferViews.ts')
  const repairedTransferEdges = transferViews.restoreExpandedTransferEndpoints([
    { id: 'real-edge', source: 'parent', target: 'transfer-view:xfer:root' },
    { id: 'transfer-view:xfer:edge:internal', source: 'transfer-view:xfer:root', target: 'transfer-view:xfer:event' },
  ], [
    { id: 'parent', type: 'or' },
    { id: 'xfer', type: 'transfer' },
  ])
  assert.deepEqual(repairedTransferEdges, [
    { id: 'real-edge', source: 'parent', target: 'xfer' },
  ], 'expanded Transfer presentation endpoints must never enter the stored analysis graph')
  project.getProjectState().modules.faultTree = {
    _folioWrap: true,
    activeId: 'f0',
    folios: [{ id: 'f0', name: 'Analysis 1', state: { nodes: [], edges: [] } }],
  }
  project.writeFolioState('faultTree', 'f0', {
    nodes: [{ id: 'A', type: 'basic', position: { x: 0, y: 0 }, data: { probability: 0.1 } }],
    edges: [],
  })
  assert.equal(project.getProjectState().modules.faultTree.folios[0].state.nodes.length, 1)
  project.undo()
  assert.equal(project.getProjectState().modules.faultTree.folios[0].state.nodes.length, 0,
    'global undo must restore a debounced FTA canvas write')
  project.redo()
  assert.equal(project.getProjectState().modules.faultTree.folios[0].state.nodes.length, 1,
    'global redo must restore the FTA canvas write')

  project.getProjectState().modules.faultTree = {
    result: {
      analysis_kind: 'dynamic', top_event_probability: 0.1142073323,
      minimal_cut_sets: [], failure_conditions: [], importance: [],
      methods: { exact: 0.1142073323 },
      cut_sequences: [{
        events: ['A', 'B'], count: 0, conditional_contribution: 1,
        estimated_probability: 0.1142073323, kind: 'exact_first_entry_sequence',
      }],
      time_curve: [{ time: 0, probability: 0 }, { time: 5, probability: 0.1142073323 }],
      node_results: [
        { node_id: 'G', label: 'Loss of function', type: 'pand', probability: 0.1142073323 },
        { node_id: 'A', label: 'A', type: 'basic', probability: 0.3934693403 },
      ],
      assumptions: ['Independent exponential clocks.'],
      diagnostics: [{ severity: 'info', code: 'EXACT', message: 'Exact eligibility proven.' }],
      computation: {
        engine: { engine: 'ordered_failure_ctmc', exact: true },
        exact_engine: { engine: 'ordered_failure_ctmc', exact: true, variables: 2 },
      },
    },
  }

  const assets = extractors.enumerateAssets().filter(asset => asset.module === 'faultTree')
  const labels = new Set(assets.map(asset => asset.label))
  for (const label of [
    'Top Event', 'Exact First-Entry Sequences', 'Top-Event Probability vs Time',
    'Node Probabilities', 'Evaluation Methods', 'Assumptions and Diagnostics',
  ]) assert.ok(labels.has(label), `missing FTA report asset: ${label}`)

  const summary = assets.find(asset => asset.label === 'Top Event').getData()
  const metrics = Object.fromEntries(summary.metrics.map(item => [item.label, item.value]))
  assert.equal(metrics['Analysis class'], 'dynamic')
  assert.equal(metrics.Engine, 'ordered failure ctmc')

  const sequence = assets.find(asset => asset.label === 'Exact First-Entry Sequences').getData()
  assert.equal(sequence.tableRows[0][1], 'A → B')
  assert.equal(sequence.tableRows[0][4], 'Exact CTMC')

  const curve = assets.find(asset => asset.label === 'Top-Event Probability vs Time').getData()
  assert.deepEqual(curve.plotData[0].x, [0, 5])
  assert.deepEqual(curve.plotData[0].y, [0, 0.1142073323])

  const canvasSource = await readFile(
    new URL('../src/components/FaultTree/index.tsx', import.meta.url), 'utf8',
  )
  assert.match(canvasSource, /case 'basic':[\s\S]*?<circle cx="48" cy="35"/,
    'basic events must use the conventional circular silhouette')
  assert.match(canvasSource, /case 'undeveloped':[\s\S]*?M48 8L79 35L48 62L17 35Z/,
    'undeveloped events must use the conventional diamond silhouette')
  assert.match(canvasSource, /case 'house':[\s\S]*?M16 34L48 8L80 34V62H16Z/,
    'house events must use the conventional house silhouette')
  assert.match(canvasSource, /const andOutline = <path d="M18 58V37A30 25/,
    'AND must use a domed gate outline')
  assert.match(canvasSource, /const orOutline = <path d="M16 58Q48 46 80 58/,
    'OR must use a curved, pointed gate outline distinct from AND')
  assert.match(canvasSource, /case 'transfer':[\s\S]*?M48 9L82 59H14Z/,
    'transfer nodes must use a triangular transfer symbol')
  assert.match(canvasSource, /whitespace-pre-line break-words/,
    'diagram descriptions must preserve line breaks and wrap')
  assert.match(canvasSource, /estimatedLines >= 9[\s\S]*?text-\[7px\]/,
    'long diagram descriptions must shrink dynamically')
  assert.match(canvasSource, /selectedNode\.data\.extendedDescription/,
    'nodes must expose a persisted extended-description field')
  assert.doesNotMatch(canvasSource, /<DiagramDescription value=\{data\.extendedDescription\}/,
    'extended descriptions must remain off the diagram')
  assert.match(canvasSource, /toggleResultNodeHighlight/,
    'node and importance results must support diagram highlighting')
  assert.match(canvasSource, /result\.importance[\s\S]*?onRowClick=/,
    'importance rows must be selectable')
  assert.match(canvasSource, /data-fta-properties-pane/,
    'existing-node properties must render in the right pane')
  assert.match(canvasSource, /createPortal[\s\S]*?propertiesHost/,
    'the selected-node editor must be portalled out of the creation toolbar')
  assert.match(canvasSource, /const COMMON_NODE_TYPES = new Set\([\s\S]*?'basic'[\s\S]*?'and'[\s\S]*?'or'/,
    'the most-used event and gate types must be exposed in the Common library')
  const commonTypes = canvasSource.match(/const COMMON_NODE_TYPES = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? ''
  for (const uncommon of ['inhibit', 'spare', 'fdep']) {
    assert.doesNotMatch(commonTypes, new RegExp(`'${uncommon}'`), `${uncommon} must not be in Common`)
  }
  assert.match(canvasSource, /data-fta-node-library[\s\S]*?>Common<[\s\S]*?visiblePaletteGroups\.map/,
    'the Node Library must show Common first and the remaining labeled groups below it')
  assert.match(canvasSource, /data-fta-node-library[\s\S]*?grid grid-cols-1/,
    'the Node Library must use a single full-label column')
  assert.match(canvasSource, /aria-label="Decrease diagram label size"[\s\S]*?aria-label="Increase diagram label size"/,
    'diagram label density must use compact incremental minus/plus controls')
  assert.match(canvasSource, /DIAGRAM_DENSITY_LEVELS = \['dense', 'compact', 'comfortable', 'spacious', 'expanded'\]/,
    'diagram density must provide five ordered adjustment levels')
  assert.match(canvasSource, /stepDiagramDensity[\s\S]*?densityIndex \+ direction/,
    'each density button click must move exactly one level')
  assert.match(canvasSource, /visibleInsertionPosition[\s\S]*?screenToFlowPosition[\s\S]*?reservedWidth/,
    'new nodes must be placed in the visible viewport while reserving the Properties pane')
  assert.match(canvasSource, /const addNode[\s\S]*?position: visibleInsertionPosition[\s\S]*?const addTransferReference[\s\S]*?position: visibleInsertionPosition/,
    'palette and project-library nodes must use viewport-aware insertion')
  assert.doesNotMatch(canvasSource, />A\+?<\/button>/,
    'diagram label density must not use named size preset buttons')
  assert.doesNotMatch(canvasSource, /\['top', 'Top Event'\]|\['intermediate', 'Intermediate Event'\]/,
    'top and intermediate events must not remain selectable node types')
  assert.match(canvasSource, /case 'or':[\s\S]*?structuralRole[\s\S]*?<rect x="12" y="10"/,
    'a one-input OR must change to the inferred rectangular top/intermediate glyph')
  assert.doesNotMatch(canvasSource, /Top gate · single input|Intermediate gate · single input/,
    'inferred top/intermediate roles must not add a diagram subtitle')
  assert.doesNotMatch(canvasSource, /paletteOpen|setPaletteGroup|loadTemplate|Starter Templates/i,
    'node types must not be hidden in submenus and starter templates must not occupy the editor')
  assert.match(canvasSource, /changeSelectedNodeType[\s\S]*?Changing this node to/,
    'the Properties pane must support a guarded change of event or gate type')
  assert.match(canvasSource, /dropInputAt[\s\S]*?ordered\.splice\(sourceIndex, 1\)[\s\S]*?ordered\.splice\(targetIndex, 0, moved\)/,
    'input semantic order must support direct drag-and-drop reordering')
  assert.match(canvasSource, /onDragStart[\s\S]*?onDragOver[\s\S]*?onDrop[\s\S]*?GripVertical/,
    'ordered input rows must expose a visible drag affordance')
  assert.match(canvasSource, /const cutNode = \(\)[\s\S]*?selectedIdsForAction\(\)[\s\S]*?copyNode\(\)[\s\S]*?selectedSet/,
    'Cut must operate on the complete real-node selection')
  assert.match(canvasSource, /eventOccurrenceCounts[\s\S]*?eventOccurrenceCount:/,
    'FTA display data must count occurrences by shared event identity')
  assert.match(canvasSource, /Mirrored · \{String\(data\.eventOccurrenceCount\)\} occurrences/,
    'every mirrored event occurrence must display the shared occurrence count')
  assert.match(canvasSource, /detachRepeatedEvent[\s\S]*?eventKey: node\.id[\s\S]*?Detach this occurrence/,
    'one mirrored event occurrence must be detachable into an independent event')
  assert.match(canvasSource, /copiedEdges = edges\.filter\(edge => selectedSet\.has\(edge\.source\) && selectedSet\.has\(edge\.target\)\)/,
    'multi-node copy must retain internal connections')
  assert.match(canvasSource, /markerStart: annotation \? undefined[\s\S]*?MarkerType\.ArrowClosed/,
    'stored gate-to-input edges must draw their arrowhead at the visual gate end')
  assert.match(canvasSource, /selectedConnector[\s\S]*?'#2563eb'[\s\S]*?strokeWidth: annotation \? 1\.25 : flowingConnector \? 3\.2/,
    'selected logical connectors must receive an unmistakable visual highlight')
  assert.match(canvasSource, /selectedConnector \? 'fta-selected-connector'/,
    'selected FTA connectors must receive the reverse-flow pulse class')
  assert.match(canvasSource, /activeMCSPropagation[\s\S]*?edge\.target !== childId[\s\S]*?connectorIds\.add\(edge\.id\)/,
    'MCS highlighting must trace connectors from cut-set events toward the top event')
  assert.match(canvasSource, /nodeIds\.add\(edge\.source\)[\s\S]*?new Set\(activeMCSPropagation\.nodeIds\)/,
    'MCS highlighting must include every gate traversed on the propagation route')
  assert.match(canvasSource, /mcsConnector[\s\S]*?animated: flowingConnector[\s\S]*?'fta-mcs-connector'/,
    'MCS propagation connectors must be highlighted and animated')
  for (const style of ['smoothstep', 'bezier', 'straight']) {
    assert.match(canvasSource, new RegExp(`<option value="${style}">`),
      `missing ${style} connector rendering option`)
  }
  assert.match(canvasSource, /snapToGrid=\{snapToGrid\}[\s\S]*?BackgroundVariant\.Dots/,
    'Snap must use the same 20-unit grid represented by subtle canvas dots')
  assert.match(canvasSource, /<MiniMap pannable zoomable nodeColor=\{node =>[\s\S]*?ANNOTATION_PALETTE[\s\S]*?NODE_ACCENTS/,
    'FTA overview-map nodes must match the event, gate, annotation, and custom diagram colors')
  assert.match(canvasSource, /barycentric sweeps[\s\S]*?estimatedWrappedLines\(node\.data\.description/,
    'Auto Layout must reduce crossings and reserve height for wrapped descriptions')
  assert.match(canvasSource, /childCenters\.length % 2 === 1[\s\S]*?childCenters\[middle - 1\] \+ childCenters\[middle\]/,
    'Auto Layout must center odd/even child groups under their parent')
  assert.match(canvasSource, /connectorStyle === 'smoothstep' && childCounts\.get\(edge\.source\) === 1[\s\S]*?'straight'/,
    'one-input orthogonal branches must bypass the step router')
  assert.match(canvasSource, /data-fta-project-library[\s\S]*?addTransferReference/,
    'other project FTAs must be available from a collapsible transfer library')
  assert.match(canvasSource, /Show expanded FTA[\s\S]*?expandReference/,
    'Transfer Properties must toggle a non-destructive expanded referenced-tree view')
  assert.match(canvasSource, /onDiagramEdgesChange[\s\S]*?change\.type !== 'replace'[\s\S]*?source: modelEdge\.source, target: modelEdge\.target/,
    'expanded Transfer edge changes must retain canonical model endpoints')
  assert.match(canvasSource, /const GATE_ID_PREFIXES[\s\S]*?transfer: 'XFER'/,
    'every gate type must own a readable ID prefix')
  assert.match(canvasSource, /resolveGateIds[\s\S]*?`\^\$\{prefix\}-\\\\d\+\$`/,
    'gate IDs must normalize to a type prefix and numeric suffix')
  assert.match(canvasSource, /Gate IDs are assigned automatically and remain unique within this analysis/,
    'gate IDs must be visibly system-managed')
  assert.doesNotMatch(canvasSource, /Override the numeric portion|setGateIdIssue/,
    'users must not be able to edit event or gate IDs')
  assert.match(canvasSource, /data-fta-annotation[\s\S]*?data-fta-annotation-properties/,
    'diagram notes and callouts must have canvas and Properties implementations')
  assert.match(canvasSource, /isAnnotation: true/,
    'annotation leader edges must remain presentation-only')
  assert.match(canvasSource, /annotation-label-top[\s\S]*?annotation-label-right[\s\S]*?annotation-label-bottom[\s\S]*?annotation-label-left/,
    'target label cards must expose callout anchors on every side')
  assert.match(canvasSource, /Math\.abs\(deltaX\) >= Math\.abs\(deltaY\)[\s\S]*?sourceHandle: `annotation-\$\{sourceSide\}`[\s\S]*?targetHandle: `annotation-label-\$\{targetSide\}`/,
    'callout leaders must dynamically use opposing anchors based on relative position')
  assert.match(canvasSource, /ANNOTATION_SHAPES[\s\S]*?rounded[\s\S]*?rectangle[\s\S]*?oval[\s\S]*?capsule/,
    'annotations must offer multiple diagram shapes')
  assert.match(canvasSource, /ANNOTATION_PALETTE[\s\S]*?amber[\s\S]*?violet[\s\S]*?cyan[\s\S]*?emerald[\s\S]*?slate/,
    'annotations must offer a broad color palette')
  assert.match(canvasSource, /Diagram color[\s\S]*?Object\.entries\(ANNOTATION_PALETTE\)[\s\S]*?diagramColor/,
    'events and gates must reuse the complete annotation color palette')
  assert.match(canvasSource, /flex-nowrap[^>]*data-fta-node-color-palette[\s\S]*?flex-nowrap[^>]*data-fta-annotation-color-palette/,
    'FTA node and annotation color palettes must each remain on one row')
  assert.match(canvasSource, /accent=\{nodePalette\?\.accent\}[\s\S]*?fillColor=\{nodePalette\?\.fill\}/,
    'custom event and gate colors must reach their conventional symbols')
  assert.match(canvasSource, /ANNOTATION_OPACITIES[\s\S]*?Fill opacity/,
    'annotations must expose fill-opacity choices')
  assert.match(canvasSource, /<NodeResizer isVisible=\{selected\} minWidth=\{100\} minHeight=\{44\}/,
    'selected annotations must expose freely adjustable resize handles')
  assert.match(canvasSource, /Show event\/gate IDs on diagram/,
    'diagram IDs must have a persisted visibility toggle')
  assert.match(canvasSource, /if \(validation\?\.valid === false\)[\s\S]*?setShowValidationIssues\(true\)/,
    'Analyze must reveal model issues instead of remaining disabled')
  assert.match(canvasSource, /engine === 'simulation' && <details[\s\S]*?Simulation and confidence settings/,
    'simulation settings must only render for the Simulation engine')
  assert.match(canvasSource, /filter\(t => t\.id !== 'curve' \|\| Boolean\(result\.time_curve\?\.length\)\)/,
    'Time curve must be hidden when no valid curve is returned')
  assert.match(canvasSource, /Diagram interchange and export actions stay with the diagram/,
    'OpenPSA actions must be grouped with diagram export')
  assert.doesNotMatch(canvasSource, /Undo2|Redo2|undoGraph|redoGraph/,
    'FTA must rely on Perdura global undo/redo rather than local controls')

  const projectSource = await readFile(
    new URL('../src/store/project.ts', import.meta.url), 'utf8',
  )
  assert.match(projectSource, /function writeFolioState[\s\S]*?changeSignature\(target\.state, nextState\)/,
    'debounced canvas writes must enter field-aware global history')

  const exportButtonSource = await readFile(
    new URL('../src/components/shared/ExportDiagramButton.tsx', import.meta.url), 'utf8',
  )
  assert.match(exportButtonSource, /buttonClassName/,
    'diagram export controls must support toolbar-matched styling')
  const exportSource = await readFile(
    new URL('../src/components/shared/exportDiagram.ts', import.meta.url), 'utf8',
  )
  assert.match(exportSource, /react-flow__background[\s\S]*?react-flow__minimap[\s\S]*?react-flow__controls[\s\S]*?react-flow__panel/,
    'diagram exports must omit snap grids, overview maps, controls, and editor panels')
  assert.match(exportSource, /fitReactFlowForExport[\s\S]*?fitView\([\s\S]*?setViewport\(viewport/,
    'diagram exports must fit the complete model and restore the working viewport')
  assert.match(canvasSource, /prepareExport=\{\(\) => fitReactFlowForExport\(flowInstanceRef\.current\)\}/,
    'FTA exports must use the fitted presentation viewport')
  const stylesheet = await readFile(new URL('../src/index.css', import.meta.url), 'utf8')
  assert.match(stylesheet, /fta-selected-connector[\s\S]*?fta-mcs-connector[\s\S]*?animation-direction: reverse/,
    'selected and MCS connector pulses must travel from child toward parent')

  const demo = JSON.parse(await readFile(
    new URL('../src/data/demoProject.json', import.meta.url), 'utf8',
  ))
  const demoTrees = demo.modules.faultTree.folios
  for (const name of [
    'Example — Simple OR', 'Example — 2-of-3 Voting', 'Example — PAND Sequence',
    'Example — Cold Standby', 'Example — Functional Dependency',
  ]) assert.ok(demoTrees.some(tree => tree.name === name), `missing Demo Project FTA: ${name}`)
  assert.ok(demoTrees.every(tree => tree.state.connectorStyle && 'snapToGrid' in tree.state),
    'Demo Project trees must use the current diagram presentation schema')
  for (const tree of demoTrees) {
    assert.ok(tree.state.showNodeIds && Array.isArray(tree.state.annotations))
    const gates = tree.state.nodes.filter(node => ![
      'basic', 'undeveloped', 'house', 'conditioning', 'external',
    ].includes(node.type))
    const gateIds = gates.map(node => node.data.gateId)
    assert.ok(gateIds.every(id => /^[A-Z]+-\d+$/.test(id)), 'gate IDs must be TYPE-number only')
    assert.equal(new Set(gateIds).size, gateIds.length, 'gate IDs must be unique within an FTA')
  }

  console.log('fault-tree report asset contracts passed')
} finally {
  await vite.close()
}
