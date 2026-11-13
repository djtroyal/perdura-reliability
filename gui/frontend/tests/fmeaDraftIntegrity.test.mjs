import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite'
import { closeViteTestServer, ssrOnlyVitePlugin } from './viteTestLifecycle.mjs'
const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-fmea-draft-integrity-'))
const vite = await createServer({ root: new URL('..', import.meta.url).pathname, cacheDir, appType: 'custom', plugins: [ssrOnlyVitePlugin()], server: { middlewareMode: true, ws: { server: createHttpServer() } } })
try {
 const { assertFmeaDraftIntegrity: validate } = await vite.ssrLoadModule('/src/store/fmeaDraftIntegrity.ts')
 const fmea = await vite.ssrLoadModule('/src/components/ReliabilityProgram/fmeaModel.ts')
 const shared = await vite.ssrLoadModule('/src/store/sharedSystemModel.ts')
 const project = await vite.ssrLoadModule('/src/store/project.ts')
 const draft = fmea.createFmeaAnalysis('pfmea', 1)
 validate(draft)
 const broken = change => { const next = structuredClone(draft); change(next); assert.throws(() => validate(next), /Invalid current-format/) }
 for (const field of ['structure_nodes','functions','resources','interfaces','function_links','functional_requirements','function_requirement_links','p_diagrams','failure_chains','control_plan']) broken(next => { next[field] = {} })
 broken(next => { next.planning.team = 'Engineering' })
 broken(next => { next.block_diagram.nodes = [42] })
 broken(next => { next.resources = [{ id: 'r', name: 'Resource', category: 'not-a-category' }] })
 const source = structuredClone(draft)
 source.structure_nodes = [{ id: 'step', name: 'Assembly', level: 'process', description: '', interface: '' }]
 source.resources = [{ id: 'state', name: 'Assembly state', category: 'state' }]
 source.functions = [{ id: 'fn', structure_node_id: 'step', description: '', function_type: 'primary', operating_modes: [], owner: '', notes: '',
   definition: { role: 'maintain_state', action: 'assembly integrity', io: [] } }]
 validate(source)
 const wireNulls = structuredClone(source); wireNulls.system_binding = null; wireNulls.structure_nodes[0].parent_id = null
 wireNulls.functions[0].canonical_verb_id = null; wireNulls.functions[0].system_definition_ref = null; wireNulls.functions[0].definition = null
 wireNulls.resources[0].quantity = null; wireNulls.resources[0].unit = null
 validate(wireNulls)
 for (const definition of [true, [], 'text', { role: 'provide', verb_id: '', io: 'invalid' }, { role: 'invalid', verb_id: '', io: [] },
   { role: 'provide', verb_id: '', io: [{ id: 'io', resource_id: 'missing', direction: 'output' }] },
   { role: 'provide', verb_id: '', io: [{ id: 'io', resource_id: '', direction: 'unsupported' }] }]) {
   const next = structuredClone(source); next.functions[0].definition = definition
   assert.throws(() => fmea.normalizeFmeaAnalysis(next), /Invalid current-format/)
 }
 const incomplete = structuredClone(source); incomplete.functions[0].definition = { role: 'transform', action: '', io: [{ id: 'draft-io', resource_id: '', direction: 'input' }] }
 validate(incomplete)

 const connected = structuredClone(source)
 connected.resources = [{ id: 'input-power', name: 'Power', category: 'energy' }, { id: 'output-work', name: 'Work', category: 'physical' }]
 connected.functions[0].definition = { role: 'transform', action: 'Assemble', io: [{ id: 'input', direction: 'input', resource_id: 'input-power' }, { id: 'output', direction: 'output', resource_id: 'output-work' }] }
 connected.block_diagram.nodes = [{ id: 'external', kind: 'external', label: 'Grid', x: 0, y: 0, width: 200, height: 100, inside_boundary: false,
   ports: [{ id: 'feed', name: 'Feed', interface_type: 'energy', direction: 'output', description: '', resource_id: 'input-power' }] }]
 connected.interfaces = [{ id: 'supply', name: 'Supply', interface_type: 'energy', directionality: 'directed', linkage: 'direct',
   source_block_id: 'external', target_structure_node_id: 'step', function_ids: ['fn'], requirement_ids: [], generated: true, mode_ids: [],
   transfers: [{ id: 'flow', kind: 'flow', resource_id: 'input-power', mode_ids: [], source: { kind: 'external', external_id: 'external', port_id: 'feed' },
     target: { kind: 'function', instance_id: 'step', function_id: 'fn', io_id: 'input' } }] }]
 validate(connected)
 for (const mutate of [next => { next.functions[0].definition.formula = 'x' }, next => { next.functions[0].definition.io[0].direction = 'state' },
   next => { next.functions[0].definition.io[0].unexpected = true }, next => { next.block_diagram.nodes[0].ports = 'invalid' },
   next => { next.block_diagram.nodes[0].ports[0].direction = 'in' }, next => { next.block_diagram.nodes[0].ports[0].resource_id = 'missing' },
   next => { next.block_diagram.nodes[0].ports[0].properties = { invalid: { kind: 'number', value: 'abc', unit: 'V' } } },
   next => { next.interfaces[0].generated = 'true' }, next => { next.interfaces[0].mode_ids = 'running' },
   next => { next.interfaces[0].transfers[0].source.port_id = 'missing' }, next => { next.interfaces[0].transfers[0].source.io_id = 'invented' },
   next => { next.interfaces[0].transfers[0].resource = 'extra' }, next => { next.interfaces[0].transfers[0].target.instance_id = 'other' },
   next => { next.block_diagram.nodes[0].ports.push({ ...next.block_diagram.nodes[0].ports[0], id: 'second' }) },
   next => { next.function_links = [{ id: 'invalid', source_function_id: 'fn', target_function_id: 'fn', relationship: 'depends_on', generated: 'false' }] }]) {
   const next = structuredClone(connected); mutate(next); assert.throws(() => validate(next), /Invalid current-format/)
 }
 const relation = structuredClone(connected)
 relation.functions[0].definition = { role: 'maintain_state', action: 'attachment', io: [] }
 relation.interfaces[0] = { ...relation.interfaces[0], interface_type: 'physical', directionality: 'undirected', transfers: [{ id: 'attachment', kind: 'relation', mode_ids: [],
   source: { kind: 'external', external_id: 'external' }, target: { kind: 'block', instance_id: 'step', function_id: 'fn' } }] }
 validate(relation)
 for (const change of [next => { next.interfaces[0].transfers[0].resource_id = 'input-power' }, next => { next.interfaces[0].transfers[0].target.io_id = 'input' },
   next => { next.interfaces[0].transfers[0].target.function_id = 'missing' }]) {
   const next = structuredClone(relation); change(next); assert.throws(() => validate(next), /Invalid current-format/)
 }
 const stale = structuredClone(source); stale.kind = 'dfmea'; stale.functions[0].structure_node_id = 'deleted-block'; stale.functions[0].system_definition_ref = { system_model_id: 'system', instance_id: 'deleted-block', function_id: 'fn' }
 validate(stale)
 const sheets = Object.fromEntries(fmea.functionWorkbookSheets(source).map(sheet => [sheet.name, sheet.rows]))
 const before = JSON.stringify(source)
 for (const invalid of ['true','[]','"text"','{"role":"provide","verb_id":"","io":42}']) {
   const next = structuredClone(sheets); next.Functions[0].definition = invalid
   assert.throws(() => fmea.importFunctionWorkbook(source, next), /Invalid current-format/)
   assert.equal(JSON.stringify(source), before, 'Rejected workbook never mutates destination analysis')
 }
 const malformedSheet = structuredClone(sheets); malformedSheet.Functions = { rows: [] }
 assert.throws(() => fmea.importFunctionWorkbook(source, malformedSheet), /Invalid current-format workbook sheet/)
 const modules = { systemDefinition: shared.createProjectSystem(), fmea: { analyses: [source], activeId: source.id } }
 shared.normalizeSharedSystemModules(modules)
 for (const malformed of [{ _folioWrap: true, activeId: 'x', folios: {} }, { _folioWrap: true, activeId: 'x', folios: [{ id: 'x', state: null }] },
   { _folioWrap: true, activeId: 'missing', folios: [{ id: 'x', state: { analyses: [] } }] }, {}, { analyses: {} }])
   assert.throws(() => shared.normalizeSharedSystemModules({ ...modules, fmea: malformed }), /FMEA|fmea/)
 project.newProject('Atomic import target')
 const payload = project.buildExport()
 payload.modules = modules
 project.importPayload(payload)
 const stateBefore = JSON.stringify(project.getProjectState())
 const invalid = structuredClone(payload); invalid.modules.fmea.analyses[0].functions[0].definition = true
 assert.throws(() => project.importPayload(invalid), /Invalid current-format/)
 assert.equal(JSON.stringify(project.getProjectState()), stateBefore, 'Malformed current project import is atomic')
 console.log('Current-format FMEA draft/workbook/project integrity, atomic rejection, incomplete drafts and retained canonical references passed.')
} finally { await closeViteTestServer(vite, cacheDir) }
