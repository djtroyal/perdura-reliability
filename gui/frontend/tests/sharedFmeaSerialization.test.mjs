import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite'
import { closeViteTestServer, ssrOnlyVitePlugin } from './viteTestLifecycle.mjs'

const hmrServer = createHttpServer()
const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-fmea-serialization-'))
const vite = await createServer({ root: new URL('..', import.meta.url).pathname,
  cacheDir, plugins: [ssrOnlyVitePlugin()], appType: 'custom',
  server: { middlewareMode: true, ws: { server: hmrServer } } })
try {
  const editor = await vite.ssrLoadModule('/src/components/ReliabilityProgram/fmeaModel.ts')
  const shared = await vite.ssrLoadModule('/src/store/sharedFmeaModel.ts')
  const system = await vite.ssrLoadModule('/src/store/sharedSystemModel.ts')
  const project = await vite.ssrLoadModule('/src/store/project.ts')
  const reports = await vite.ssrLoadModule('/src/store/assetExtractors.ts')
  const state = system.createProjectSystem('Plant'), model = state.model
  model.resources = [{ id: 'pressure', name: 'pressure', category: 'material' }]
  const definition = { id: 'pump', name: 'Pump', kind: 'component', classification: 'component',
    description: 'Pressure supply', part_number: '', manufacturer: '', category: '',
    ports: [{ id: 'out', name: 'Outlet', interface_type: 'material', direction: 'output', description: '' }],
    functions: [{ id: 'supply', description: 'Supply pressure', function_type: 'primary', canonical_verb_id: 'function_verb:supply', mode_ids: [], definition: { role: 'source', action: 'Supply pressure', io: [{ id: 'pressure-out', resource_id: 'pressure', direction: 'output' }] } }],
    failure_modes: [{ id: 'no-pressure', function_id: 'supply', description: 'No pressure', deviation_id: 'absent', mode_ids: [] }],
    child_slots: [] }
  model.definitions.push(definition)
  model.instances.push({ id: 'pump-1', definition_id: definition.id, name: 'Pump 1', quantity: 1,
    parent_instance_id: model.root_instance_id, reference_designators: [], mode_ids: [],
    function_overrides: [], failure_mode_overrides: [], legacy_refs: [] })
  model.externals.push({ id: 'reservoir', name: 'Reservoir', kind: 'adjacent_system', description: '', ports: [{ id: 'in', name: 'Pressure input', interface_type: 'material', direction: 'input', description: '' }] })
  model.interfaces.push({ id: 'outlet', name: 'Pressure outlet', interface_type: 'material',
    source: { instance_id: 'pump-1', port_id: 'out' }, target: { external_id: 'reservoir', port_id: 'in' },
    directionality: 'directed', linkage: 'direct', interface_detail: '', flow_description: 'pressure', transfers: [{ id: 'pressure-transfer', resource_id: 'pressure', kind: 'flow', mode_ids: [], source: { kind: 'function', instance_id: 'pump-1', function_id: 'supply', io_id: 'pressure-out' }, target: { kind: 'external', external_id: 'reservoir', port_id: 'in' } }],
    operating_condition: '', source_function_ids: ['supply'], target_function_ids: [], mode_ids: [] })
  model.modes = [{id:'running',name:'Running',description:''}]
  model.interfaces[0].mode_ids = ['running']; model.interfaces[0].generated = true
  const analysis = shared.bindFmeaAnalysis(model, editor.createFmeaAnalysis('dfmea', 1))
  analysis.failure_chains[0].severity = 9
  analysis.failure_chains[0].remarks = 'Retain engineering assessment'
  analysis.functions[0].owner = 'Engineering'
  const original = structuredClone(analysis)
  const normalized = editor.normalizeFmeaAnalysis(JSON.parse(JSON.stringify(analysis)))
  assert.deepEqual(normalized.system_binding, analysis.system_binding)
  for (const field of ['structure_nodes', 'functions', 'interfaces', 'failure_chains']) {
    assert.ok(analysis[field].length, `${field} fixture must cover linked records`)
    assert.deepEqual(normalized[field].map(row => row.system_definition_ref), analysis[field].map(row => row.system_definition_ref),
      `normalization preserves ${field} canonical identities`)
  }
  const sheets = Object.fromEntries(editor.functionWorkbookSheets(analysis).map(sheet => [sheet.name,
    sheet.rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value == null ? '' : String(value)])))]))
  const destination = structuredClone(analysis)
  destination.id = 'DFMEA-COPY'
  delete destination.system_binding
  for (const field of ['structure_nodes', 'functions', 'interfaces', 'failure_chains'])
    for (const row of destination[field]) delete row.system_definition_ref
  const imported = editor.importFunctionWorkbook(destination, sheets)
  assert.deepEqual(JSON.parse(JSON.stringify(imported.system_binding)), analysis.system_binding, 'a new folio retains the workbook system scope')
  for (const field of ['structure_nodes', 'functions', 'interfaces', 'failure_chains'])
    assert.deepEqual(imported[field].map(row => row.system_definition_ref), analysis[field].map(row => row.system_definition_ref),
      `workbook preserves ${field} canonical identities`)
  assert.equal(imported.functions[0].definition.action, 'Supply pressure')
  assert.deepEqual(JSON.parse(JSON.stringify(imported.resources)), analysis.resources)
  assert.deepEqual(imported.functions[0].definition, analysis.functions[0].definition)
  assert.deepEqual(imported.interfaces[0].transfers, analysis.interfaces[0].transfers)
  assert.deepEqual(imported.interfaces[0].mode_ids, ['running'])
  assert.equal(imported.interfaces[0].generated, true)
  assert.deepEqual(imported.block_diagram.nodes.find(node=>node.kind==='external').ports, model.externals[0].ports,
    'Canonical external terminal definitions survive materialization and workbook export')
  const metadataEdit = structuredClone(analysis)
  metadataEdit.block_diagram.nodes.find(node=>node.kind==='external').ports[0].name='Qualified pressure terminal'
  metadataEdit.interfaces[0].mode_ids=[];metadataEdit.interfaces[0].generated=false
  const metadataWrite = shared.splitFmeaUpdate(model,analysis,metadataEdit)
  assert.equal(metadataWrite.model.externals[0].ports[0].name,'Qualified pressure terminal')
  assert.deepEqual(metadataWrite.model.interfaces[0].mode_ids,[])
  assert.equal(metadataWrite.model.interfaces[0].generated,false)

  assert.equal(imported.failure_chains[0].severity, 9)
  assert.equal(imported.failure_chains[0].remarks, 'Retain engineering assessment')
  assert.deepEqual(analysis, original, 'normalization and workbook export/import never mutate their input')
  for (const invalid of ['null', '{', '{"version":2}', '{"version":1,"system_model_id":"","scope_instance_id":"root"}'])
    assert.throws(() => editor.importFunctionWorkbook(analysis,
      { 'Perdura Format': sheets['Perdura Format'], Resources: sheets.Resources, 'System Binding': [{ system_binding: invalid }] }), /Invalid System Binding/)
  assert.throws(() => editor.importFunctionWorkbook(destination, { 'Perdura Format': sheets['Perdura Format'], Resources: sheets.Resources, 'System Binding': [
    { analysis_id: 'other', system_binding: JSON.stringify(analysis.system_binding) },
    { analysis_id: 'another', system_binding: JSON.stringify(analysis.system_binding) },
  ] }), /unambiguous System Binding/)
  const pumpNode = analysis.structure_nodes.find(node => node.system_definition_ref?.instance_id === 'pump-1')
  assert.ok(pumpNode)
  assert.equal(editor.outdentStructureNode(analysis.structure_nodes, pumpNode.id).find(node => node.id === pumpNode.id).parent_id,
    undefined, 'canonical hierarchy changes can be handed to the shared model transaction')
  assert.equal(editor.removeStructureNode(analysis.structure_nodes, pumpNode.id).some(node => node.id === pumpNode.id), false)
  const snapshots = analysis.structure_nodes.map(node => node.id === pumpNode.id
    ? { ...node, source_ref: { ...node.source_ref, module: 'prediction' } } : node)
  assert.equal(editor.outdentStructureNode(snapshots, pumpNode.id), snapshots)
  assert.equal(editor.removeStructureNode(snapshots, pumpNode.id), snapshots,
    'legacy Prediction snapshots retain source ownership protection')

  const evaluated = { ...structuredClone(analysis), summary: { failure_chains: 1,
    high_action_priority: 1, medium_action_priority: 0, open_actions: 0, errors: 0, warnings: 0 } }
  const result = { core: { summary: { analyses: 1 } }, studies: [{ analysis: evaluated,
    release_ready: false, content_sha256: 'a'.repeat(64), findings: [],
    failure_flow: { active_links: 0, mapped_analyses: 0, statements: 0 },
    fmeda: { rows: [], sources: [] },
    projections: { process_steps: [], verification_plan: [], special_characteristics: [] } }] }
  const historical = JSON.stringify(result)
  const fingerprint = shared.fmeaSemanticFingerprint(model, [analysis])
  project.newProject('Shared FMEA report serialization')
  const put = (currentModel, overrides = {}) => project.writeModuleSlices({ systemDefinition: { ...state, model: currentModel },
    fmea: { _folioWrap: true, activeId: 'folio', folios: [{ id: 'folio', name: 'Pump assessment',
      state: { analyses: [analysis], result, sourceSystemFingerprint: fingerprint, ...overrides } }] } })
  const assets = () => reports.enumerateAssets().filter(asset => asset.module === 'fmea')
  const summary = rows => rows.find(asset => asset.label === 'FMEA Portfolio Summary')
  put(model)
  assert.equal(summary(assets()).source.resultStatus, 'current')
  const layout = structuredClone(model)
  layout.revision = 'Layout-only revision'
  layout.diagrams = [{ id: 'drawing', name: 'Changed layout', nodes: [] }]
  put(layout)
  assert.equal(summary(assets()).source.resultStatus, 'current', 'layout and revision do not stale calculations')
  const renamed = structuredClone(model)
  renamed.instances.find(item => item.id === 'pump-1').name = 'Updated pump'
  renamed.definitions.find(item => item.id === 'pump').functions[0].definition.action = 'Supply revised pressure'
  put(renamed)
  const changed = assets()
  assert.equal(summary(changed).source.resultStatus, 'stale')
  assert.match(summary(changed).getData().metrics[0].value, /historical calculation/)
  const structure = changed.find(asset => asset.label.endsWith('Current Shared Structure'))
  assert.equal(structure.source.resultStatus, 'current')
  assert.ok(structure.getData().tableRows.some(row => row.includes('Updated pump')))
  const functions = changed.find(asset => asset.label.endsWith('Current Shared Functions'))
  assert.ok(functions.getData().tableRows.some(row => row.includes('Supply revised pressure')))
  assert.equal(JSON.stringify(result), historical, 'current report views must not rewrite evaluated/released snapshots')
  assert.deepEqual(analysis, original, 'current report views must not rewrite saved engineering annotations')
  put(model, { sourceSystemFingerprint: undefined, canonicalDependencies: { status: 'stale', message: 'Legacy shared inputs changed' } })
  assert.equal(summary(assets()).source.resultStatus, 'stale', 'legacy results honor dependency tracking without a saved fingerprint')
  put(model, { result: null })
  assert.equal(assets().find(asset => asset.label === 'Shared FMEA Source Status').source.resultStatus, 'not-calculated')
  assert.ok(assets().some(asset => asset.label.endsWith('Current Shared Functions')), 'current engineering views are available before analysis')
  const missing = structuredClone(model)
  missing.instances = missing.instances.filter(item => item.id !== 'pump-1')
  put(missing)
  assert.equal(summary(assets()).source.resultStatus, 'invalid')
  assert.ok(!assets().some(asset => asset.label.endsWith('Current Shared Structure')), 'broken sources cannot masquerade as current engineering views')
  console.log('Shared FMEA API-facing normalization, workbook identities and report freshness contracts passed.')
} finally {
  await closeViteTestServer(vite, cacheDir, hmrServer)
}
