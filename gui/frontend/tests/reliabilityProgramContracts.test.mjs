import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'vite'

const hmrServer = createHttpServer()
const vite = await createServer({
  root: new URL('..', import.meta.url).pathname,
  appType: 'custom',
  server: { middlewareMode: true, ws: { server: hmrServer } },
})

try {
  const workspaceSource = readFileSync(new URL(
    '../src/components/ReliabilityProgram/AiagVdaWorkspace.tsx',
    import.meta.url,
  ), 'utf8')
  const programSource = readFileSync(new URL(
    '../src/components/ReliabilityProgram/index.tsx',
    import.meta.url,
  ), 'utf8')
  const recordLinkSource = readFileSync(new URL(
    '../src/components/ReliabilityProgram/RecordLinkField.tsx',
    import.meta.url,
  ), 'utf8')
  const vocabularyAidSource = readFileSync(new URL(
    '../src/components/ReliabilityProgram/FmeaVocabularyAid.tsx',
    import.meta.url,
  ), 'utf8')
  const predictionImporterSource = readFileSync(new URL(
    '../src/components/ReliabilityProgram/PredictionStructureImporter.tsx',
    import.meta.url,
  ), 'utf8')
  const blockDiagramSource = readFileSync(new URL(
    '../src/components/ReliabilityProgram/FmeaBlockDiagramCanvas.tsx',
    import.meta.url,
  ), 'utf8')
  const canvasAssetControlsSource = readFileSync(new URL(
    '../src/components/shared/CanvasAssetControls.tsx',
    import.meta.url,
  ), 'utf8')
  const exportDiagramSource = readFileSync(new URL(
    '../src/components/shared/exportDiagram.ts',
    import.meta.url,
  ), 'utf8')
  const predictionSource = readFileSync(new URL(
    '../src/components/Prediction/index.tsx',
    import.meta.url,
  ), 'utf8')
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(workspaceSource, /ReactFlow|FmeaNetwork/)
  assert.doesNotMatch(workspaceSource, /Static FMEA structure hierarchy/)
  assert.match(workspaceSource, /Interactive FMEA structure hierarchy/)
  assert.match(workspaceSource, /> Add child/)
  assert.match(workspaceSource, /> Add sibling/)
  assert.match(workspaceSource, />\s*Demote\s*</)
  assert.match(workspaceSource, />\s*Promote\s*</)
  assert.match(workspaceSource, /Expand all/)
  assert.match(workspaceSource, /Collapse all/)
  assert.match(workspaceSource, /Static FMEA function tree/)
  assert.match(workspaceSource, /Static FMEA input and interface flow/)
  assert.match(workspaceSource, /Static FMEA parameter diagram/)
  assert.match(workspaceSource, /Block diagram/)
  assert.match(blockDiagramSource, /Interface key/)
  assert.match(blockDiagramSource, /source_block_id/)
  assert.match(blockDiagramSource, /relationship_strength/)
  assert.match(blockDiagramSource, /container_parent_block_id/)
  assert.match(blockDiagramSource, /toggleStructureBlock/)
  assert.match(blockDiagramSource, /visibleRepresentative/)
  assert.match(blockDiagramSource, /projectedInterfaceGroups/)
  assert.match(blockDiagramSource, /source\.id === target\.id/)
  assert.match(blockDiagramSource, /Aggregated interfaces/)
  assert.match(blockDiagramSource, /aggregation does not rewrite interface ownership/)
  assert.match(blockDiagramSource, /interfaceIds/)
  assert.match(blockDiagramSource, /LayoutGrid/)
  assert.match(blockDiagramSource, /<Scan size=\{12\} \/> Fit/)
  assert.doesNotMatch(blockDiagramSource, /Grid2X2|<Route/)
  assert.match(blockDiagramSource, /const directedEdges =/)
  assert.match(blockDiagramSource, /const layoutRanks =/)
  assert.match(blockDiagramSource, /const layoutContainer =/)
  assert.match(blockDiagramSource, /const externalRole =/)
  assert.match(blockDiagramSource, /sourceHandle: projectedSourceHandle/)
  assert.match(blockDiagramSource, /targetHandle: projectedTargetHandle/)
  assert.match(blockDiagramSource, /barycentric sweeps reduce crossings/)
  assert.match(blockDiagramSource, /boundaryConflict/)
  assert.match(blockDiagramSource, /> Out of scope/)
  assert.doesNotMatch(blockDiagramSource, /getSmoothStepPath/)
  assert.match(blockDiagramSource, /const DENSITY_LEVELS =/)
  assert.match(blockDiagramSource, /const stepDensity =/)
  assert.match(blockDiagramSource, /Decrease diagram spacing/)
  assert.match(blockDiagramSource, /Increase diagram spacing/)
  assert.match(blockDiagramSource,
    /dense: \{ label: 'Dense', sizeScale: 0\.98, spacingScale: 0\.5 \}[\s\S]*?expanded: \{ label: 'Expanded', sizeScale: 1\.02, spacingScale: 1\.95 \}/,
    'density must emphasize spacing while preserving readable block dimensions')
  assert.match(blockDiagramSource, /<Magnet size=\{12\} \/> Snap/)
  assert.match(blockDiagramSource,
    /<CanvasAssetControls[\s\S]*?<Magnet size=\{12\} \/> Snap[\s\S]*?<div className="pointer-events-auto flex items-center gap-1 rounded-lg/,
    'bookmark and snapshot controls must stay in the upper-left canvas group')
  assert.match(canvasAssetControlsSource,
    /BookmarkAssetButton[\s\S]*?captureDiagramPng[\s\S]*?createPlotSnapshot[\s\S]*?perdura-canvas-snapshot/,
    'canvas controls must support navigation bookmarks and immutable Report Builder snapshots')
  assert.match(exportDiagramSource,
    /captureDiagramPng[\s\S]*?withVisibleEdges[\s\S]*?filter: exportFilter/,
    'canvas snapshots must use the clean fitted export path')
  assert.match(blockDiagramSource, /inside_boundary: inheritedScope/)
  assert.match(blockDiagramSource, /inside_boundary: parent\.inside_boundary/)
  assert.match(blockDiagramSource, /Inherited from \$\{selectedContainer\.label\}/)
  assert.match(blockDiagramSource, /flowProjectionKey/)
  assert.match(blockDiagramSource, /selectedNodeIdRef/)
  assert.match(blockDiagramSource, /Preserve React Flow-owned measurements/)
  assert.doesNotMatch(blockDiagramSource, /onSelectionChange=\{/)
  assert.match(blockDiagramSource, /onNodeClick=\{/)
  assert.match(blockDiagramSource, /Math\.abs\(viewport\.x - current\.viewport\.x\)/)
  assert.match(blockDiagramSource,
    /fmea-block-diagram\.delete-interface/)
  assert.match(blockDiagramSource, /Delete connector/)
  assert.match(blockDiagramSource,
    /aria-label="FMEA Block Diagram canvas"/)
  assert.match(blockDiagramSource,
    /selectedInterface\.interface_type === 'clearance'[\s\S]{0,80}linkage: 'direct'/)
  assert.match(blockDiagramSource, /defaultDirectionalityForType/)
  assert.match(blockDiagramSource,
    /type === 'physical' \|\| type === 'clearance'[\s\S]{0,80}'undirected'[\s\S]{0,80}'directed'/)
  assert.match(blockDiagramSource,
    /directionality: defaultDirectionalityForType\(type\)/)
  assert.match(blockDiagramSource,
    /<option value="undirected">Non-Directional<\/option>/)
  assert.match(workspaceSource,
    /<option value="undirected">Non-Directional<\/option>/)
  assert.doesNotMatch(blockDiagramSource, />Undirected</)
  assert.doesNotMatch(workspaceSource, />Undirected</)
  assert.match(blockDiagramSource, /childCount: children\.length/)
  assert.match(blockDiagramSource, /Expand direct children:/)
  assert.match(blockDiagramSource, /Collapse children/)
  assert.match(blockDiagramSource, /natureIndicators/)
  assert.match(blockDiagramSource,
    /strength: item\.relationship_strength/)
  assert.match(blockDiagramSource, /nature: item\.relationship_nature/)
  assert.match(blockDiagramSource,
    /Strength and nature appear as labeled connector badges/)
  assert.match(blockDiagramSource,
    /strength === 'strong'[\s\S]{0,100}strength === 'weak'/)
  assert.match(workspaceSource, /onNavigatePrediction/)
  assert.match(workspaceSource, /Open this record in Failure Rate Prediction/)
  assert.match(appSource, /predictionRecordNavigation/)
  assert.match(predictionSource, /navigationTarget\.entityId\.split\(':'\)/)
  assert.match(predictionSource, /prediction-block-row-/)
  assert.match(workspaceSource, /FunctionContextSelection/)
  assert.match(workspaceSource, /data-context-kind="function"/)
  assert.match(workspaceSource, /data-context-kind="interface"/)
  assert.match(workspaceSource, /data-context-kind="p_item"/)
  assert.match(workspaceSource, /kind: 'correlation'/)
  assert.match(workspaceSource, /aria-pressed=\{selectedStructure\}/)
  assert.match(workspaceSource, /Function analysis visualization/)
  assert.match(workspaceSource, /Expand \$\{visualLabel\} to full screen/)
  assert.match(workspaceSource, /Restore Function Analysis visualization/)
  assert.match(workspaceSource, /visualExpanded && <div/)
  assert.match(workspaceSource, /Function for \$\{chain\.id\}/)
  assert.match(workspaceSource, /Dismiss notice/)
  assert.match(workspaceSource,
    /window\.setTimeout\(\(\) => setMessage\(''\), 6000\)/)
  assert.match(workspaceSource, /Static FMEA cause, failure mode, and effect relationships/)
  assert.match(workspaceSource, /FunctionStatementField/)
  assert.match(workspaceSource, /VocabularyManager/)
  assert.match(workspaceSource,
    /view === 'terminology'[\s\S]*?<VocabularyManager/)
  assert.match(workspaceSource,
    /StepHeading number=\{4\}[\s\S]*?Add failure mode[\s\S]*?<FailureDiagram/)
  assert.match(workspaceSource, /arrangeStructureNodes/)
  assert.match(workspaceSource, /draggable/)
  assert.match(workspaceSource, /Drop here to make a top-level item/)
  assert.match(workspaceSource, /<OrdinalBadge value=\{`S\$\{structureOrdinals/)
  assert.match(workspaceSource, /<OrdinalBadge value=\{`F\$\{ordinal\}`\}/)
  assert.match(workspaceSource, /<OrdinalBadge value=\{`FC\$\{index \+ 1\}`\}/)
  assert.match(workspaceSource, /<OrdinalBadge value=\{`OPT\$\{index \+ 1\}`\}/)
  assert.match(workspaceSource, /<OrdinalBadge value=\{`OPT\$\{index \+ 1\}-A\$\{actionIndex \+ 1\}`\}/)
  assert.match(workspaceSource, /failureModeStarter/)
  assert.match(workspaceSource, /RecordLinkField label="Linked hazards"/)
  assert.match(workspaceSource, /RecordLinkField label="Linked FRACAS records"/)
  assert.match(workspaceSource, /> Add mode/)
  assert.match(workspaceSource, /> Add related case/)
  assert.match(workspaceSource, /data-failure-mode-input/)
  assert.match(workspaceSource, /Failure Modes and Effects Summary \(FMES\)/)
  assert.match(workspaceSource, /No secondary grouping/)
  assert.doesNotMatch(workspaceSource, /linked_hazard_ids\.join\(', '\)/)
  assert.doesNotMatch(workspaceSource, /linked_fracas_ids\.join\(', '\)/)
  assert.match(programSource, /type: 'record-links'/)
  assert.match(programSource, /data-program-record-id/)
  assert.match(programSource, /navigateToReference/)
  assert.match(recordLinkSource, /No \$\{recordType\} records available/)
  assert.match(recordLinkSource, /missing from this project/)
  assert.match(vocabularyAidSource, /aria-label="Function verb"/)
  assert.match(vocabularyAidSource, /aria-label="What the function acts on"/)
  assert.match(vocabularyAidSource, /aria-label="Function relationship"/)
  assert.match(vocabularyAidSource, /Possible match:/)
  assert.match(vocabularyAidSource, /Use verb:/)
  assert.match(vocabularyAidSource, /Use target:/)
  assert.match(vocabularyAidSource,
    /aria-label="Optional target object or system"/)
  assert.match(vocabularyAidSource, />\s*Verb\s*</)
  assert.match(vocabularyAidSource, /Choose target/)
  assert.match(vocabularyAidSource, /createPortal/)
  assert.match(vocabularyAidSource, /z-\[140\]/)
  assert.match(vocabularyAidSource, /getBoundingClientRect/)
  assert.match(vocabularyAidSource, /FUNCTION_VERB_ICONS/)
  assert.match(vocabularyAidSource, /<VerbIcon size=\{12\}/)
  assert.match(vocabularyAidSource, /aliasTermGroups/)
  assert.match(vocabularyAidSource, /<optgroup key=\{group\.domain\}/)
  assert.match(vocabularyAidSource, /const \[expanded, setExpanded\] = useState\(true\)/)
  assert.ok((vocabularyAidSource.match(/'function_verb:[^']+':/g) ?? [])
    .length >= 35)
  assert.match(workspaceSource, /targetSuggestions=/)
  assert.match(workspaceSource,
    /analysis\.kind !== 'pfmea' && <PredictionStructureImporter/)
  assert.match(predictionImporterSource, /Pull from Failure Rate Prediction/)
  assert.match(predictionImporterSource, /Review Prediction source changes/)
  assert.match(predictionImporterSource, /Existing managed records will not be duplicated/)
  assert.match(predictionImporterSource, /!!node\.source_ref && !!catalog/)
  assert.match(predictionImporterSource, />\s*Select All\s*</)
  assert.match(predictionImporterSource, />\s*Deselect All\s*</)
  assert.match(predictionImporterSource, />\s*Select Inverse\s*</)
  assert.match(predictionImporterSource,
    /Pull grouped quantities as individual piece parts/)
  assert.match(predictionImporterSource, /Split existing grouped parts/)
  assert.match(workspaceSource, /Split into individual parts/)
  assert.doesNotMatch(workspaceSource,
    /<OperatingModesField[\s\S]{0,350}<Field label="Owner"/)

  const project = await vite.ssrLoadModule('/src/store/project.ts')
  const extractors = await vite.ssrLoadModule('/src/store/assetExtractors.ts')
  const fmeaModel = await vite.ssrLoadModule(
    '/src/components/ReliabilityProgram/fmeaModel.ts')
  const fmeaWorkspace = await vite.ssrLoadModule(
    '/src/components/ReliabilityProgram/AiagVdaWorkspace.tsx')
  const fmeaInterop = await vite.ssrLoadModule(
    '/src/components/ReliabilityProgram/fmeaInterop.ts')
  const vocabulary = await vite.ssrLoadModule(
    '/src/components/ReliabilityProgram/fmeaVocabulary.ts')
  const predictionImport = await vite.ssrLoadModule(
    '/src/components/ReliabilityProgram/predictionStructureImport.ts')
  const predictionIdentity = await vite.ssrLoadModule(
    '/src/store/predictionIdentity.ts')
  assert.ok(vocabulary.FUNCTION_VERBS.length >= 35)
  assert.ok(vocabulary.FUNCTION_RELATIONSHIPS.length >= 12)
  assert.equal(vocabulary.closestVocabularyValue(
    'Trasnfer', ['Transfer', 'Supply']), 'Transfer')
  assert.equal(vocabulary.closestVocabularyValue(
    'heat exchnger', ['heat exchanger', 'controller']), 'heat exchanger')
  assert.equal(vocabulary.closestVocabularyValue(
    'Pump C', ['Pump A', 'Pump B']), undefined)
  assert.deepEqual(vocabulary.vocabularyConflicts(
    vocabulary.EMPTY_FMEA_VOCABULARY_PROFILE), [])
  const transferMatch = vocabulary.classifyFunctionStatement('Convey coolant')
  assert.equal(transferMatch.status, 'alias')
  assert.equal(transferMatch.term.label, 'Transfer')
  const ambiguousMatch = vocabulary.classifyFunctionStatement('Control output')
  assert.equal(ambiguousMatch.status, 'ambiguous')
  assert.deepEqual(ambiguousMatch.candidates.map(term => term.label),
    ['Regulate', 'Command', 'Actuate'])
  assert.equal(vocabulary.applyFunctionVerb(
    'Control output', ambiguousMatch.candidates[0]), 'Regulate output')
  assert.deepEqual(vocabulary.splitFunctionStatement(
    'Check against pressure limit'), {
    verb: 'Check against', object: 'pressure limit',
  })
  assert.deepEqual(vocabulary.splitFunctionDefinition(
    'Transfer coolant to heat exchanger'), {
    verb: 'Transfer', what: 'coolant', relationship: 'to',
    target: 'heat exchanger',
  })
  assert.deepEqual(vocabulary.splitFunctionDefinition(
    'Protect operator from electrical shock'), {
    verb: 'Protect', what: 'operator', relationship: 'from',
    target: 'electrical shock',
  })
  assert.equal(vocabulary.composeFunctionStatement(
    'Regulate', 'output voltage'), 'Regulate output voltage')
  assert.equal(vocabulary.composeFunctionDefinition(
    'Transfer', 'coolant', 'heat exchanger'),
  'Transfer coolant to heat exchanger')
  assert.equal(vocabulary.composeFunctionDefinition(
    'Protect', 'operator', 'electrical shock', 'from'),
  'Protect operator from electrical shock')
  const protect = vocabulary.FUNCTION_VERBS.find(
    term => term.label === 'Protect')
  assert.equal(vocabulary.applyFunctionVerb(
    'Ensure safe operation', protect), 'Protect safe operation')
  const absent = vocabulary.FAILURE_DEVIATIONS.find(
    term => term.label === 'Absent')
  assert.equal(vocabulary.failureModeStarter(
    absent, 'Supply cooling fluid'), 'No cooling fluid')
  const projectVocabulary = {
    version: 1,
    custom_terms: [],
    custom_aliases: [{
      id: 'alias-1', term_id: 'function_verb:supply', value: 'Furnish',
    }],
  }
  assert.equal(vocabulary.classifyFunctionStatement(
    'Furnish actuator power', projectVocabulary).term.label, 'Supply')
  assert.deepEqual(vocabulary.vocabularyConflicts({
    ...projectVocabulary,
    custom_aliases: [{
      id: 'alias-2', term_id: 'function_verb:transfer', value: 'Provide',
    }],
  }), ['Provide'])
  assert.deepEqual(vocabulary.vocabularyConflicts({
    ...projectVocabulary,
    custom_aliases: [{
      id: 'alias-3', term_id: 'function_verb:supply', value: 'Control',
    }],
  }), ['Control'])
  const identified = predictionIdentity.ensurePredictionPartIds([
    { category: 'resistor', quantity: 1, params: {} },
    { id: 'part-fixed', category: 'capacitor', quantity: 1, params: {} },
    { id: 'part-fixed', category: 'diode', quantity: 1, params: {} },
  ])
  assert.equal(new Set(identified.map(part => part.id)).size, 3)
  assert.equal(identified[1].id, 'part-fixed')
  assert.strictEqual(predictionIdentity.ensurePredictionPartIds(identified),
    identified)
  const predictionCatalog = await predictionImport.buildPredictionStructureCatalog({
    id: 'pred-1',
    name: 'Control board',
    state: {
      blocks: [
        { id: 'b1', name: 'Power', parentId: null },
        { id: 'b2', name: 'Regulation', parentId: 'b1' },
      ],
      parts: [
        { id: 'p1', category: 'resistor', quantity: 2,
          reference_designators: ['R1', 'R2'], part_number: 'RN55',
          manufacturer: 'Acme', params: {}, parentId: 'b2' },
        { id: 'p2', category: 'capacitor', quantity: 1,
          reference_designators: ['C1'], params: {}, parentId: null },
      ],
    },
  })
  assert.deepEqual(predictionCatalog.errors, [])
  assert.deepEqual(predictionCatalog.entities.map(entity => entity.id), [
    'system:system', 'block:b1', 'block:b2', 'part:p1', 'part:p2',
  ])
  const importedPrediction = predictionImport.importPredictionStructure(
    [], predictionCatalog, 'block:b1',
    predictionImport.defaultPredictionImportSelection(
      predictionCatalog, 'block:b1'))
  assert.deepEqual(importedPrediction.map(node => node.level), [
    'next_higher', 'focus', 'next_lower', 'next_lower',
  ])
  assert.equal(importedPrediction[2].parent_id, importedPrediction[1].id)
  assert.equal(importedPrediction[3].source_ref.part_number, 'RN55')
  const splitPrediction = predictionImport.importPredictionStructure(
    [], predictionCatalog, 'block:b1',
    predictionImport.defaultPredictionImportSelection(
      predictionCatalog, 'block:b1'),
    { splitGroupedParts: true })
  assert.equal(splitPrediction.length, 5)
  assert.deepEqual(splitPrediction.slice(3).map(node =>
    node.source_ref.reference_designators), [['R1'], ['R2']])
  assert.deepEqual(splitPrediction.slice(3).map(node =>
    node.source_ref.piece_key), ['refdes:R1', 'refdes:R2'])
  assert.ok(splitPrediction.slice(3).every(node =>
    node.source_ref.quantity === 1))
  assert.strictEqual(predictionImport.importPredictionStructure(
    splitPrediction, predictionCatalog, 'block:b1',
    new Set(predictionCatalog.entities.map(entity => entity.id)),
    { splitGroupedParts: true }),
  splitPrediction)
  const splitExistingPrediction = predictionImport.splitImportedPredictionParts(
    importedPrediction, [predictionCatalog],
    new Set([importedPrediction[3].id]))
  assert.equal(splitExistingPrediction.length, 5)
  assert.equal(splitExistingPrediction[3].id, importedPrediction[3].id)
  assert.deepEqual(splitExistingPrediction.slice(3).map(node =>
    node.source_ref.piece_key), ['refdes:R1', 'refdes:R2'])
  assert.equal(predictionImport.predictionSourceStatus(
    splitExistingPrediction[3], predictionCatalog), 'current')
  assert.strictEqual(predictionImport.importPredictionStructure(
    importedPrediction, predictionCatalog, 'block:b1',
    new Set(predictionCatalog.entities.map(entity => entity.id))),
  importedPrediction)
  const changedCatalog = await predictionImport.buildPredictionStructureCatalog({
    id: 'pred-1',
    name: 'Control board',
    state: {
      blocks: [
        { id: 'b1', name: 'Power subsystem', parentId: null },
        { id: 'b2', name: 'Regulation', parentId: 'b1' },
      ],
      parts: [
        { id: 'p2', category: 'capacitor', quantity: 1,
          reference_designators: ['C1'], params: {}, parentId: null },
      ],
    },
  })
  assert.equal(predictionImport.predictionSourceStatus(
    importedPrediction[1], changedCatalog), 'changed')
  assert.equal(predictionImport.predictionSourceStatus(
    importedPrediction[3], changedCatalog), 'missing')
  const authored = importedPrediction.map(node => ({
    ...node, description: node.id === importedPrediction[1].id
      ? 'FMEA-authored boundary' : node.description,
  }))
  const refreshed = predictionImport.refreshPredictionStructure(
    authored, [changedCatalog])
  assert.equal(refreshed[1].name, 'Power subsystem')
  assert.equal(refreshed[1].description, 'FMEA-authored boundary')
  assert.equal(refreshed[3].source_ref.entity_id, 'part:p1')
  const detached = predictionImport.detachPredictionStructure(
    refreshed, new Set([refreshed[1].id]))
  assert.equal(detached[1].source_ref, undefined)
  const invalidCatalog = await predictionImport.buildPredictionStructureCatalog({
    id: 'pred-bad',
    name: 'Invalid',
    state: {
      blocks: [
        { id: 'a', name: 'A', parentId: 'b' },
        { id: 'b', name: 'B', parentId: 'a' },
      ],
      parts: [],
    },
  })
  assert.ok(invalidCatalog.errors.some(error => /cycle/.test(error)))
  const emptyFmea = fmeaModel.createFmeaAnalysis('dfmea', 1)
  assert.equal(fmeaModel.hasFmeaContents(emptyFmea), false)
  assert.deepEqual(fmeaModel.describeFmeaContents(emptyFmea), [])
  const hierarchy = [
    { id: 'ST-A', name: 'System', level: 'next_higher',
      description: '', interface: '' },
    { id: 'ST-B', name: 'Controller', level: 'focus', parent_id: 'ST-A',
      description: '', interface: '' },
    { id: 'ST-C', name: 'Pump', level: 'next_lower', parent_id: 'ST-A',
      description: '', interface: '' },
    { id: 'ST-D', name: 'Driver', level: 'next_lower', parent_id: 'ST-B',
      description: '', interface: '' },
  ]
  assert.deepEqual(fmeaModel.orderedStructureNodes(hierarchy)
    .map(node => node.id), ['ST-A', 'ST-B', 'ST-D', 'ST-C'])
  assert.deepEqual(Object.fromEntries(
    fmeaModel.structureNodeOrdinals(hierarchy)), {
    'ST-A': '1', 'ST-B': '1.1', 'ST-D': '1.1.1', 'ST-C': '1.2',
  })
  const nestedHierarchy = fmeaModel.arrangeStructureNodes(
    hierarchy, 'ST-C', 'ST-B', 'inside')
  assert.equal(nestedHierarchy.find(node => node.id === 'ST-C').parent_id, 'ST-B')
  assert.deepEqual(fmeaModel.arrangeStructureNodes(
    hierarchy, 'ST-B', 'ST-D', 'inside'), hierarchy)
  const rootHierarchy = fmeaModel.arrangeStructureNodes(
    hierarchy, 'ST-D', undefined, 'root')
  assert.equal(rootHierarchy.find(node => node.id === 'ST-D').parent_id, undefined)
  const indentedHierarchy = fmeaModel.indentStructureNode(
    hierarchy, 'ST-C')
  assert.equal(indentedHierarchy.find(node => node.id === 'ST-C').parent_id, 'ST-B')
  assert.deepEqual(
    fmeaModel.indentStructureNode(hierarchy, 'ST-B'),
    hierarchy,
  )
  const outdentedHierarchy = fmeaModel.outdentStructureNode(
    hierarchy, 'ST-D')
  assert.equal(outdentedHierarchy.find(node => node.id === 'ST-D').parent_id, 'ST-A')
  assert.deepEqual(
    fmeaModel.outdentStructureNode(hierarchy, 'ST-A'),
    hierarchy,
  )
  const removedHierarchy = fmeaModel.removeStructureNode(
    hierarchy, 'ST-B')
  assert.equal(removedHierarchy.some(node => node.id === 'ST-B'), false)
  assert.equal(removedHierarchy.find(node => node.id === 'ST-D').parent_id, 'ST-A')
  assert.deepEqual(
    fmeaModel.orderedStructureNodes(removedHierarchy).map(node => node.id),
    ['ST-A', 'ST-D', 'ST-C'],
  )
  emptyFmea.planning.scope = 'Controller boundary'
  emptyFmea.failure_chains.push({
    id: 'FC-PROTECTED', effect: 'Loss', failure_mode: 'Open', cause: 'Crack',
    effect_contexts: [], severity: 8, occurrence: 3, detection: 4,
    prevention_controls: '', detection_controls: '', severity_rationale: '',
    occurrence_rationale: '', detection_rationale: '', actions: [],
    no_action_justification: '', post_severity_rationale: '',
    linked_hazard_ids: [], linked_fracas_ids: [], monitoring_system: '',
    system_response: '', safe_state: '', mitigated_effect: '',
    management_review_status: '', management_review_evidence_ids: [],
    remarks: '',
  })
  assert.equal(fmeaModel.hasFmeaContents(emptyFmea), true)
  assert.deepEqual(fmeaModel.describeFmeaContents(emptyFmea), [
    'planning details', '1 failure chain',
  ])
  const relatedCase = fmeaWorkspace.relatedFailureCase('dfmea', {
    ...emptyFmea.failure_chains[0],
    function_id: 'FN-1',
    effect: 'Loss of system output',
    effect_contexts: [{
      id: 'EC-SOURCE', context: 'System', description: 'Output lost',
      severity: 8,
    }],
    failure_mode: 'No output',
    cause: 'Open circuit',
    linked_hazard_ids: ['HAZ-1'],
    prevention_controls: 'Qualified interconnect',
    detection_controls: 'Continuity test',
  })
  assert.equal(relatedCase.function_id, 'FN-1')
  assert.equal(relatedCase.effect, 'Loss of system output')
  assert.equal(relatedCase.failure_mode, 'No output')
  assert.equal(relatedCase.severity, 8)
  assert.deepEqual(relatedCase.linked_hazard_ids, ['HAZ-1'])
  assert.notEqual(relatedCase.effect_contexts[0].id, 'EC-SOURCE')
  assert.equal(relatedCase.cause, '')
  assert.equal(relatedCase.prevention_controls, '')
  assert.equal(relatedCase.detection_controls, '')
  assert.equal(relatedCase.occurrence, 5)
  assert.deepEqual(relatedCase.actions, [])
  const fmesAnalysis = fmeaModel.createFmeaAnalysis('dfmea', 4)
  fmesAnalysis.structure_nodes = [{
    id: 'ST-FMES', name: 'Controller', level: 'focus',
    description: '', interface: '',
  }]
  fmesAnalysis.functions = [{
    id: 'FN-FMES', structure_node_id: 'ST-FMES',
    description: 'Provide commanded output', function_type: 'primary',
    operating_modes: ['Normal', 'Degraded'], owner: '', notes: '',
  }]
  fmesAnalysis.failure_chains = [
    {
      ...emptyFmea.failure_chains[0], id: 'FC-FMES-1',
      function_id: 'FN-FMES', effect: 'Loss of output',
      failure_mode: 'No output', cause: 'Open circuit', severity: 9,
      action_priority: 'H', post_action_priority: 'M',
      linked_hazard_ids: ['HZ-1'],
      actions: [{ id: 'ACT-1', kind: 'design', description: 'Redesign',
        owner: 'Design', status: 'open', evidence_ids: [],
        decision_rationale: '' }],
    },
    {
      ...emptyFmea.failure_chains[0], id: 'FC-FMES-2',
      function_id: 'FN-FMES', effect: '  loss   OF output ',
      failure_mode: 'Intermittent output', cause: 'Loose contact', severity: 8,
      action_priority: 'M', post_action_priority: 'L',
      linked_hazard_ids: ['HZ-1', 'HZ-2'],
    },
    {
      ...emptyFmea.failure_chains[0], id: 'FC-FMES-3',
      function_id: 'FN-FMES', effect: 'Overtemperature',
      failure_mode: 'Excess output', cause: 'Control fault', severity: 7,
      action_priority: 'L', post_action_priority: null,
      linked_hazard_ids: [],
    },
  ]
  const fmesByEffect = fmeaModel.buildFmesSummary(fmesAnalysis)
  assert.equal(fmesByEffect.length, 2)
  const lossGroup = fmesByEffect.find(group =>
    group.label === 'Loss of output')
  assert.equal(lossGroup.chains.length, 2)
  assert.equal(lossGroup.failure_modes.length, 2)
  assert.equal(lossGroup.causes.length, 2)
  assert.equal(lossGroup.maximum_severity, 9)
  assert.equal(lossGroup.highest_action_priority, 'H')
  assert.equal(lossGroup.highest_post_action_priority, 'M')
  assert.equal(lossGroup.open_actions, 1)
  const fmesByHazard = fmeaModel.buildFmesSummary(
    fmesAnalysis, 'hazard', 'failure_mode')
  assert.equal(fmesByHazard.find(group => group.label === 'HZ-1').chains.length, 2)
  assert.equal(fmesByHazard.find(group => group.label === 'HZ-2').chains.length, 1)
  assert.equal(fmesByHazard.find(
    group => group.label === 'No linked hazard').chains.length, 1)
  assert.equal(fmesByHazard.find(
    group => group.label === 'HZ-1').subgroups.length, 2)
  const classicProjection = fmeaInterop.classicRowsFromAiag(
    [fmesAnalysis], [{
      id: 'FC-FMES-1', failureRate: '1e-6', modeRatio: '0.25',
      effectProbability: '0.9', missionTime: '1000',
    }])
  assert.equal(classicProjection.length, 3)
  assert.equal(classicProjection[0].item, 'Controller')
  assert.equal(classicProjection[0].function, 'Provide commanded output')
  assert.equal(classicProjection[0].failureMode, 'No output')
  assert.equal(classicProjection[0].failureRate, '1e-6')
  const duplicateIdAnalysis = structuredClone(fmesAnalysis)
  duplicateIdAnalysis.id = 'DFMEA-DUPLICATE'
  const duplicateProjection = fmeaInterop.classicRowsFromAiag(
    [fmesAnalysis, duplicateIdAnalysis])
  assert.equal(duplicateProjection.length, 6)
  assert.equal(new Set(duplicateProjection.map(row => row.id)).size, 6)
  assert.ok(duplicateProjection.every(row => row.id.length <= 128))
  const classicOnly = {
    id: 'FM-SYNC-1', item: 'Pump controller',
    function: 'Supply motor current', failureMode: 'No current',
    localEffect: 'Motor stops', endEffect: 'Loss of pumping',
    cause: 'Open circuit', controls: 'Continuity test',
    severity: '9', occurrence: '3', detection: '4',
    action: 'Add redundant path', owner: 'Electrical', status: 'planned',
    hazardLinks: 'HZ-1', fracasLinks: 'FR-1',
    failureRate: '2e-6', modeRatio: '0.4',
    effectProbability: '1', missionTime: '500',
  }
  const generatedAiag = fmeaInterop.updateAiagFromClassicRow(
    undefined, classicOnly, [], [classicOnly])
  assert.equal(generatedAiag.length, 1)
  assert.match(generatedAiag[0].id, /^CLASSIC-SYNC/)
  assert.equal(generatedAiag[0].failure_chains[0].effect, 'Loss of pumping')
  assert.equal(generatedAiag[0].failure_chains[0].occurrence, 3)
  assert.equal(generatedAiag[0].failure_chains[0].actions[0].owner, 'Electrical')
  assert.equal(generatedAiag[0].functions[0].description,
    'Supply motor current')
  const generatedRoundTrip = fmeaInterop.classicRowsFromAiag(
    generatedAiag, [classicOnly])
  assert.equal(generatedRoundTrip[0].failureRate, '2e-6')
  assert.equal(generatedRoundTrip[0].endEffect, 'Loss of pumping')
  const msrProjection = fmeaModel.createFmeaAnalysis('fmea_msr', 9)
  msrProjection.failure_chains = [{
    ...emptyFmea.failure_chains[0],
    id: 'MSR-FC-1',
    occurrence: undefined,
    detection: undefined,
    frequency: 4,
    monitoring: 3,
  }]
  assert.deepEqual(fmeaInterop.classicRowsFromAiag([msrProjection]), [])
  assert.deepEqual(fmeaInterop.removeClassicRowFromAiag(
    classicOnly, generatedAiag), [])
  const mapping = fmeaModel.detectFmeaMapping([
    'Effect', 'Failure Mode', 'Potential Cause', 'Severity', 'Occurrence',
    'Detection', 'Current Prevention Controls',
  ])
  assert.equal(mapping.failure_mode, 'Failure Mode')
  assert.equal(mapping.cause, 'Potential Cause')
  const imported = fmeaModel.importedFailureChains([{
    Effect: 'Loss', 'Failure Mode': 'No output', 'Potential Cause': 'Open',
    Severity: '8', Occurrence: '4', Detection: '7',
    'Current Prevention Controls': 'Qualified design',
  }], mapping, 'dfmea')
  assert.equal(imported.length, 1)
  assert.equal(imported[0].severity, 8)
  assert.equal(imported[0].frequency, undefined)
  const legacy = fmeaModel.createFmeaAnalysis('dfmea', 2)
  legacy.structure_nodes.push({ id: 'ST-1', name: 'Controller', level: 'focus',
    description: '', interface: '' })
  legacy.structure_nodes.push({ id: 'ST-2', name: 'Control board',
    level: 'subsystem', parent_id: 'ST-1', description: '', interface: '' })
  legacy.block_diagram.nodes.push({
    id: 'BDN-CHILD', kind: 'structure', structure_node_id: 'ST-2',
    container_parent_block_id: 'missing-container', expanded: true,
    label: 'Control board', x: 360, y: 260, width: 180, height: 72,
    inside_boundary: true,
  })
  legacy.functions.push({
    id: 'FN-1', structure_node_id: 'ST-1', description: 'Control output',
    requirement: 'Output within tolerance', characteristic_type: 'Performance',
    specification: '±2%',
  })
  legacy.interfaces.push({
    id: 'IF-1', name: 'Command', interface_type: 'signal',
    external_source: 'Operator', external_target: '',
    target_structure_node_id: 'ST-1',
    flow_description: 'Command input', operating_condition: 'Mission',
    function_ids: [], requirement_ids: [],
  })
  const normalized = fmeaModel.normalizeFmeaAnalysis(legacy)
  assert.equal(normalized.functions[0].function_type, 'primary')
  assert.equal(normalized.functions[0].canonical_verb_id, undefined)
  assert.equal(normalized.functional_requirements[0].statement,
    'Output within tolerance')
  assert.equal(normalized.function_requirement_links[0].strength, 'strong')
  assert.equal('requirement' in normalized.functions[0], false)
  assert.equal(normalized.interfaces[0].interface_type, 'information')
  assert.equal(normalized.block_diagram.version, 2)
  assert.equal(normalized.block_diagram.nodes.length, 3)
  assert.ok(normalized.interfaces[0].source_block_id)
  assert.ok(normalized.interfaces[0].target_block_id)
  const normalizedParent = normalized.block_diagram.nodes.find(
    item => item.structure_node_id === 'ST-1')
  const normalizedChild = normalized.block_diagram.nodes.find(
    item => item.structure_node_id === 'ST-2')
  assert.equal(normalizedChild.container_parent_block_id, undefined)
  const inconsistentScope = structuredClone(normalized)
  const inconsistentParent = inconsistentScope.block_diagram.nodes.find(
    item => item.structure_node_id === 'ST-1')
  const inconsistentChild = inconsistentScope.block_diagram.nodes.find(
    item => item.structure_node_id === 'ST-2')
  inconsistentParent.inside_boundary = false
  inconsistentChild.inside_boundary = true
  inconsistentChild.container_parent_block_id = inconsistentParent.id
  assert.equal(fmeaModel.normalizeFmeaAnalysis(inconsistentScope)
    .block_diagram.nodes.find(
      item => item.structure_node_id === 'ST-2').inside_boundary, false)
  normalizedParent.expanded = false
  normalizedChild.container_parent_block_id = normalizedParent.id
  normalized.block_diagram.density = 'spacious'
  normalized.structure_nodes[0].source_ref =
    structuredClone(importedPrediction[1].source_ref)
  const workbookSheets = Object.fromEntries(
    fmeaModel.functionWorkbookSheets(normalized)
      .map(sheet => [sheet.name, sheet.rows]))
  assert.deepEqual(fmeaModel.recognizedFunctionWorkbookSheets(workbookSheets), [
    'Structure', 'Functions', 'Requirements', 'Correlations',
    'Function Links', 'Block Diagram', 'Interfaces', 'P-Diagrams',
    'Control Plan',
  ])
  const roundTrip = fmeaModel.importFunctionWorkbook(
    fmeaModel.createFmeaAnalysis('dfmea', 3), workbookSheets)
  assert.equal(roundTrip.functions[0].description, 'Control output')
  assert.equal(roundTrip.functional_requirements[0].statement,
    'Output within tolerance')
  assert.equal(roundTrip.structure_nodes[0].source_ref.entity_id, 'block:b1')
  assert.equal(roundTrip.block_diagram.version, 2)
  assert.equal(roundTrip.block_diagram.density, 'spacious')
  assert.equal(roundTrip.block_diagram.nodes.length, 3)
  assert.equal(roundTrip.block_diagram.nodes.find(
    item => item.structure_node_id === 'ST-1').expanded, false)
  assert.equal(roundTrip.block_diagram.nodes.find(
    item => item.structure_node_id === 'ST-2').container_parent_block_id,
  normalizedParent.id)
  assert.equal(roundTrip.interfaces[0].directionality, 'directed')
  assert.equal(roundTrip.failure_chains.length, 0)
  normalized.failure_chains.push({
    ...emptyFmea.failure_chains[0], id: 'FC-FUNCTION', function_id: 'FN-1',
  })
  assert.equal(fmeaModel.worksheetRows(normalized)[0].function,
    'Control output')
  assert.equal(fmeaModel.mergeControlPlanProposal(
    [{ id: 'CP-1', failure_chain_id: 'FC-1', reaction_plan: 'Stop' }],
    { id: 'CP-1', failure_chain_id: 'FC-1', reaction_plan: 'Contain' },
  )[0].reaction_plan, 'Contain')
  project.newProject('Reliability program assets')
  project.setModuleState('reliabilityProgram', {
    _folioWrap: true, activeId: 'program-a',
    folios: [{ id: 'program-a', name: 'Controller program', state: { result: {
      fmea: {
        rows: [{ id: 'FM-1', item: 'Connector', failure_mode: 'Open', end_effect: 'Loss',
          severity: 9, occurrence: 2, detection: 3, rpn: 54,
          screening_band: 'severity_override', mode_criticality: null,
          action_status: 'open' }],
        ranked_ids: ['FM-1'],
        summary: { total: 1, open_actions: 1, high_or_severity_override: 1,
          criticality_available: 0, total_mode_criticality: 0 },
        rpn_policy: { method: 'ordinal_product_screening', medium_threshold: 100,
          high_threshold: 200, severity_override: 'severity >= 9', warning: 'ordinal' },
      },
      aiag_vda_fmea: {
        analyses: [{
          id: 'DFMEA-1', name: 'Controller DFMEA', kind: 'dfmea', revision: 'A',
          status: 'in_review', planning: {},
          structure_nodes: [
            { id: 'ST-1', name: 'Controller', level: 'focus',
              description: 'Control boundary', interface: 'Signal' },
            { id: 'ST-2', name: 'Input board', level: 'subsystem',
              parent_id: 'ST-1', description: 'Command input', interface: 'Signal' },
            { id: 'ST-3', name: 'Output board', level: 'subsystem',
              parent_id: 'ST-1', description: 'Command output', interface: 'Signal' },
          ],
          block_diagram: {
            version: 2,
            boundary: { label: 'Controller', x: 40, y: 40,
              width: 600, height: 400 },
            nodes: [
              { id: 'BDN-1', kind: 'structure', structure_node_id: 'ST-1',
                label: 'Controller', x: 220, y: 160, width: 180, height: 72,
                inside_boundary: true, expanded: false },
              { id: 'BDN-2', kind: 'structure', structure_node_id: 'ST-2',
                container_parent_block_id: 'BDN-1', label: 'Input board',
                x: 250, y: 250, width: 180, height: 72,
                inside_boundary: true, expanded: false },
              { id: 'BDN-3', kind: 'structure', structure_node_id: 'ST-3',
                container_parent_block_id: 'BDN-1', label: 'Output board',
                x: 450, y: 250, width: 180, height: 72,
                inside_boundary: true, expanded: false },
              { id: 'BDX-1', kind: 'external',
                external_kind: 'adjacent_system', label: 'Operator',
                x: 0, y: 160, width: 160, height: 72,
                inside_boundary: false },
            ],
            viewport: { x: 0, y: 0, zoom: 1 },
            snap_to_grid: true,
          },
          functions: [{ id: 'FN-1', structure_node_id: 'ST-1',
            description: 'Provide output', function_type: 'primary',
            operating_modes: ['normal'], owner: 'Design', notes: '' }],
          function_links: [],
          functional_requirements: [{ id: 'FREQ-1',
            statement: 'Output shall remain available',
            requirement_type: 'performance', measure: 'Availability',
            target: '≥ 0.99', unit: '', acceptance_criteria: 'No loss',
            operating_condition: 'Mission', source: 'System requirement',
            owner: 'Systems', confidence: '90%',
            verification_method: 'System test', evidence_ids: [],
            special_characteristic: '' }],
          function_requirement_links: [{ id: 'FRC-1', function_id: 'FN-1',
            requirement_id: 'FREQ-1', strength: 'strong',
            rationale: 'Direct allocation' }],
          interfaces: [
            { id: 'IF-1', name: 'Command', interface_type: 'information',
              source_block_id: 'BDX-1', target_block_id: 'BDN-2',
              linkage: 'direct', directionality: 'directed',
              relationship_strength: 'strong',
              relationship_nature: 'beneficial', interface_detail: 'Digital',
              external_source: 'Operator', external_target: '',
              target_structure_node_id: 'ST-2',
              flow_description: 'Command signal', operating_condition: 'Mission',
              function_ids: ['FN-1'], requirement_ids: ['FREQ-1'] },
            { id: 'IF-2', name: 'Status', interface_type: 'information',
              source_block_id: 'BDX-1', target_block_id: 'BDN-3',
              linkage: 'direct', directionality: 'directed',
              relationship_strength: 'strong',
              relationship_nature: 'beneficial', interface_detail: 'Digital',
              external_source: 'Operator', external_target: '',
              target_structure_node_id: 'ST-3',
              flow_description: 'Status signal', operating_condition: 'Mission',
              function_ids: ['FN-1'], requirement_ids: ['FREQ-1'] },
            { id: 'IF-3', name: 'Board link', interface_type: 'physical',
              source_block_id: 'BDN-2', target_block_id: 'BDN-3',
              linkage: 'direct', directionality: 'undirected',
              relationship_strength: 'unspecified',
              relationship_nature: 'unspecified', interface_detail: 'Backplane',
              external_source: '', external_target: '',
              source_structure_node_id: 'ST-2',
              target_structure_node_id: 'ST-3',
              flow_description: 'Internal backplane',
              operating_condition: 'Mission',
              function_ids: ['FN-1'], requirement_ids: ['FREQ-1'] },
          ],
          p_diagrams: [{ id: 'PD-1', title: 'Output robustness',
            primary_function_id: 'FN-1', supporting_function_ids: [],
            items: [
              { id: 'PDI-1', category: 'signal_input', label: 'Command',
                description: '', requirement_ids: [] },
              { id: 'PDI-2', category: 'intended_output', label: 'Output',
                description: '', requirement_ids: ['FREQ-1'] },
              { id: 'PDI-3', category: 'control_factor', label: 'Design margin',
                description: '', requirement_ids: [] },
              { id: 'PDI-4', category: 'noise_factor', label: 'Temperature',
                description: '', requirement_ids: [] },
              { id: 'PDI-5', category: 'error_state', label: 'No output',
                description: '', requirement_ids: ['FREQ-1'] },
            ] }],
          control_plan: [], standalone_justification: '',
          rating_profile_id: 'aiag_vda_dfmea_public_v1',
          rating_profile: { id: 'aiag_vda_dfmea_public_v1', name: 'AIAG–VDA aligned DFMEA',
            version: '1.0', checksum: 'abc123', method_status: 'aligned' },
          failure_chains: [{ id: 'FC-1', function_id: 'FN-1', effect: 'Loss',
            failure_mode: 'Open', cause: 'Interconnect', severity: 8,
            occurrence: 4, detection: 7, action_priority: 'H',
            post_action_priority: null, prevention_controls: 'Qualification',
            detection_controls: 'Functional test', actions: [],
            no_action_justification: '', action_priority_meaning: 'highest' }],
          issues: [{ step: 6, code: 'high_ap_without_disposition', severity: 'error',
            record_id: 'FC-1', message: 'High Action Priority requires disposition.' }],
          step_readiness: [], finalization_ready: false, control_plan_review: [],
          function_analysis_summary: { functions: 1, primary_functions: 1,
            requirements: 1, correlations: 1, interfaces: 1, p_diagrams: 1,
            structures_with_functions: 1, structures_total: 1,
            functions_with_requirements: 1, functions_with_failure_chains: 1,
            stale_requirement_links: 0, coverage_gaps: 0 },
          function_coverage: [{ structure_node_id: 'ST-1',
            structure_name: 'Controller', level: 'focus',
            function_ids: ['FN-1'], requirement_ids: ['FREQ-1'],
            interface_ids: ['IF-1'], failure_chain_ids: ['FC-1'], gaps: [] }],
          requirement_sync: [{ requirement_id: 'FREQ-1', source_id: null,
            status: 'local', stored_checksum: null, current_checksum: null,
            differences: [] }],
          summary: { failure_chains: 1, high_action_priority: 1,
            medium_action_priority: 0, low_action_priority: 0,
            post_high_action_priority: 0, open_actions: 0, overdue_actions: 0,
            errors: 1, warnings: 0 },
          methodology: { title: 'AIAG & VDA FMEA Handbook',
            edition: 'First Edition (2019)', errata: 'Errata v2',
            implementation_status: 'AIAG-VDA aligned',
            method_version: 'perdura-aiag-vda-aligned/1',
            profile_checksum: 'abc123', rpn_calculated: false,
            interpretation: 'Action Priority directs action.' },
        }],
        summary: { analyses: 1, dfmea: 1, pfmea: 0, fmea_msr: 0,
          high_action_priority: 1, open_actions: 0,
          finalization_ready: 0, issues: 1 },
        issues: [], rating_profiles: [],
        methodology: { title: 'AIAG & VDA FMEA Handbook',
          edition: 'First Edition (2019)', errata: 'Errata v2',
          implementation_status: 'AIAG-VDA aligned',
          method_version: 'perdura-aiag-vda-aligned/1' },
      },
      hazards: { rows: [], summary: { total: 0, initial_high_or_serious: 0,
        residual_high_or_serious: 0, unaccepted: 0, worsened: 0 },
        method: 'MIL-STD-882E Table III risk assessment matrix', warning: 'ordinal' },
      fracas: { summary: { records: 1, open: 0, closed: 1,
        effectiveness_verified: 1, recurrences: 0, closure_fraction: 1,
        verification_fraction: 1, total_downtime: 0 },
        exposure_metrics: { total_exposure: 1000, event_rate: 0.001, mtbf: 1000,
          rate_lower: 0.000025, rate_upper: 0.00557, confidence_level: 0.95 },
        pareto_failure_modes: [{ name: 'Open', count: 1 }], pareto_systems: [], warning: 'exposure' },
      requirements: { rows: [], summary: { total: 0, complete_definitions: 0,
        with_evidence: 0, verification_ready: 0 }, warning: 'traceability' },
      testability: null,
      rcm: { summary: { items: 0, unresolved: 0, with_interval: 0 },
        consequences: {}, tasks: {}, unresolved_ids: [], warning: 'decision' },
      traceability: { summary: { links: 0, resolved_links: 0, unknown_references: 0,
        missing_reciprocal_links: 0, issues: 0 }, issues: [], warning: 'integrity' },
      standards_context: { status: 'standards_informed_workflow', references: ['MIL-STD-882E'] },
    } } }],
  })
  const assets = extractors.enumerateAssets().filter(asset => asset.module === 'reliabilityProgram')
  assert.ok(assets.some(asset => asset.label === 'Program Assurance Summary'))
  assert.ok(assets.some(asset => asset.label === 'FMEA and FMECA Register'))
  assert.ok(assets.some(asset => asset.label === 'AIAG–VDA FMEA Program Summary'))
  assert.ok(assets.some(asset =>
    asset.label === 'Controller DFMEA · DFMEA Function Analysis Summary'))
  assert.ok(assets.some(asset =>
    asset.label === 'Controller DFMEA · DFMEA Function Tree'))
  assert.ok(assets.some(asset =>
    asset.label === 'Controller DFMEA · DFMEA Block / Boundary Diagram'))
  const blockDiagramAsset = assets.find(asset =>
    asset.label === 'Controller DFMEA · DFMEA Block / Boundary Diagram')
  const blockDiagramData = blockDiagramAsset.getData()
  assert.equal(blockDiagramData.plotLayout.shapes.length, 4)
  const projectedInterface = blockDiagramData.plotLayout.shapes.find(
    shape => shape.type === 'line')
  assert.equal(projectedInterface.x0, 80)
  assert.equal(projectedInterface.x1, 310)
  assert.ok(blockDiagramData.plotLayout.annotations.some(annotation =>
    String(annotation.text).includes('I×2')))
  assert.ok(assets.some(asset =>
    asset.label === 'Controller DFMEA · DFMEA Function–Requirement Correlation'))
  assert.ok(assets.some(asset =>
    asset.label === 'Controller DFMEA · DFMEA Interface Register'))
  assert.ok(assets.some(asset =>
    asset.label === 'Controller DFMEA · DFMEA Function Coverage'))
  assert.ok(assets.some(asset =>
    asset.label === 'Controller DFMEA · DFMEA P-Diagram · Output robustness'))
  assert.equal(assets.find(asset =>
    asset.label === 'Controller DFMEA · DFMEA Function Tree').source?.view,
  'fmea:DFMEA-1:function:tree')
  assert.equal(assets.find(asset =>
    asset.label === 'Controller DFMEA · DFMEA Worksheet').source?.view,
  'fmea:DFMEA-1:worksheet')
  assert.ok(assets.some(asset => asset.label === 'Controller DFMEA · DFMEA Worksheet'))
  assert.ok(assets.some(asset =>
    asset.label === 'Controller DFMEA · DFMEA Failure Modes and Effects Summary'))
  const fmesAsset = assets.find(asset =>
    asset.label === 'Controller DFMEA · DFMEA Failure Modes and Effects Summary')
  assert.equal(fmesAsset.source?.view, 'fmea:DFMEA-1:documentation')
  assert.deepEqual(fmesAsset.getData().tableHeaders.slice(0, 3), [
    'Common effect', 'Distinct failure modes', 'Failure cases',
  ])
  assert.equal(fmesAsset.getData().tableRows[0][0], 'Loss')
  assert.ok(assets.some(asset => asset.label === 'FRACAS Failure Mode Pareto'))
  assert.ok(assets.every(asset => asset.source?.tab === 'reliability-program'))
  assert.ok(assets.every(asset => asset.source?.analysisId === 'program-a'))
  const summary = new Map(assets.find(asset => asset.label === 'Program Assurance Summary')
    .getData().metrics.map(metric => [metric.label, metric.value]))
  assert.equal(summary.get('Traceability links resolved'), '0/0')
  assert.equal(summary.get('Method status'), 'standards_informed_workflow')
  console.log('Reliability program persistence and report-asset contracts passed')
} finally {
  await vite.close()
  hmrServer.close()
}
