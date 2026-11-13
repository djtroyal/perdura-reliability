import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite'
import { closeViteTestServer, ssrOnlyVitePlugin } from './viteTestLifecycle.mjs'

const cacheDir = await mkdtemp(join(tmpdir(), 'perdura-system-hierarchy-'))
const hmrServer = createHttpServer()
const vite = await createServer({ root: new URL('..', import.meta.url).pathname, cacheDir,
  logLevel: 'error', appType: 'custom', server: { middlewareMode: true, ws: { server: hmrServer } },
  plugins: [ssrOnlyVitePlugin()] })
try {
  const { defaultHierarchyDiagramNodes, interfacesDiagramModel, setDiagramBranchVisibility, diagramBranchVisible,
    diagramInstanceSelected, diagramBranchSelection, setDiagramVisibility, retainHiddenDiagramData } =
    await vite.ssrLoadModule('/src/components/SystemDefinition/diagramProjection.ts')
  const { projectFmeaDiagram, mergeFmeaDiagramPatch } =
    await vite.ssrLoadModule('/src/components/ReliabilityProgram/fmeaDiagramProjection.ts')
  const { interfaceBoundaryInstances, interfaceAggregationKey } = await vite.ssrLoadModule('/src/components/shared/hierarchicalDiagram.ts')
  const instances = [
    ['aircraft', undefined], ['propulsion', 'aircraft'], ['esps', 'aircraft'], ['actuation', 'aircraft'],
    ['motor', 'propulsion'], ['controller', 'propulsion'], ['sensor', 'propulsion'],
    ['board', 'controller'], ['part', 'board'],
  ].map(([id, parent_instance_id]) => ({ id, parent_instance_id, name: id, definition_id: id,
    mode_ids: [], function_overrides: [], failure_mode_overrides: [] }))
  const resources = ['electricity', 'conditioned-electricity', 'torque', 'actuation', 'signal', 'thrust']
    .map(id => ({ id, name: id, category: id === 'signal' ? 'information' : 'energy' }))
  const fn = (id, inputs, output) => ({ id, description: id, function_type: 'primary', mode_ids: [],
    definition: { role: inputs.length ? 'transform' : 'source', action: id,
      io: [...inputs.map(resource_id => ({ id: `${resource_id}-input`, resource_id, direction: 'input' })),
        { id: `${output}-output`, resource_id: output, direction: 'output' }] } })
  const functions = {
    esps: [fn('power-supply', [], 'electricity'), fn('signal-source', [], 'signal')],
    controller: [fn('control', ['electricity'], 'conditioned-electricity')],
    motor: [fn('motor', ['conditioned-electricity'], 'torque')],
    actuation: [fn('actuate', ['electricity'], 'actuation')],
    propulsion: [fn('propel', ['signal'], 'thrust')],
  }
  const edge = (id, source, target, resource_id) => {
    const sourceFunction = functions[source].find(item => item.definition.io.some(io => io.direction === 'output' && io.resource_id === resource_id))
    const targetFunction = functions[target].find(item => item.definition.io.some(io => io.direction === 'input' && io.resource_id === resource_id))
    return { id, source: { instance_id: source }, target: { instance_id: target },
      directionality: 'directed', interface_type: resources.find(resource => resource.id === resource_id).category, mode_ids: [],
      transfers: [{ id: `${id}-transfer`, kind: 'flow', resource_id, mode_ids: [],
        source: { kind: 'function', instance_id: source, function_id: sourceFunction.id, io_id: `${resource_id}-output` },
        target: { kind: 'function', instance_id: target, function_id: targetFunction.id, io_id: `${resource_id}-input` } }],
      source_function_ids: [sourceFunction.id], target_function_ids: [targetFunction.id] }
  }
  const model = { id: 'aircraft-model', root_instance_id: 'aircraft', instances,
    resources, modes: [{ id: 'run', name: 'Run' }],
    definitions: instances.map(item => ({ id: item.id, kind: item.id === 'part' ? 'piece_part' : 'assembly',
      ports: [], functions: functions[item.id] ?? [], failure_modes: [] })),
    externals: [], interfaces: [edge('power', 'esps', 'controller', 'electricity'),
      edge('motor-power', 'controller', 'motor', 'conditioned-electricity'), edge('other', 'esps', 'actuation', 'electricity')],
    diagrams: [{ id: 'master', hidden_instance_ids: [], nodes: [] }] }
  model.diagrams[0].nodes = defaultHierarchyDiagramNodes(model)
  model.diagrams[0].nodes.find(item => item.instance_id === 'controller').x = 431
  model.diagrams[0].nodes.find(item => item.instance_id === 'controller').y = 282
  const original = structuredClone(model)
  assert.equal(model.diagrams[0].nodes.length, instances.length, 'Assemblies register all nested descendants immediately')
  assert.ok(model.diagrams[0].nodes.every(node => !node.expanded), 'Every L2 assembly and child starts closed')
  const hidden = setDiagramBranchVisibility(model, 'propulsion', false)
  assert.ok(!diagramBranchVisible(hidden, 'controller') && !diagramBranchVisible(hidden, 'board'))
  assert.ok(!interfacesDiagramModel(hidden).interfaces.some(item => item.id === 'power'))
  assert.deepEqual(hidden.interfaces, model.interfaces, 'Hidden interfaces remain canonical records')
  const revealed = setDiagramBranchVisibility(hidden, 'controller', true)
  assert.ok(diagramBranchVisible(revealed, 'controller') && diagramBranchVisible(revealed, 'board'))
  assert.ok(!diagramBranchVisible(revealed, 'motor'), 'Revealing one branch keeps sibling branches hidden')
  assert.ok(revealed.diagrams[0].nodes.find(item => item.instance_id === 'propulsion').expanded)
  assert.equal(revealed.diagrams[0].nodes.find(item => item.instance_id === 'controller').x, 431, 'Visibility preserves manual placement')
  assert.ok(diagramBranchVisible(revealed, 'propulsion'), 'A selected descendant retains its ancestor container')
  assert.equal(diagramInstanceSelected(revealed, 'propulsion'), false, 'Ancestor context is not an implicit selection')
  assert.equal(diagramBranchSelection(revealed, 'propulsion'), 'mixed')
  assert.equal(diagramBranchSelection(revealed, 'controller'), true)
  const contextInterface = { ...revealed, interfaces: [...revealed.interfaces, edge('parent-only', 'esps', 'propulsion', 'signal')] }
  assert.ok(!interfacesDiagramModel(contextInterface).interfaces.some(item => item.id === 'parent-only'), 'Context-only ancestors do not expose their own interfaces')
  assert.ok(interfacesDiagramModel(contextInterface).interfaces.some(item => item.id === 'power'), 'Context containers retain selected descendants and their interfaces')
  const inverted = setDiagramVisibility(contextInterface, 'invert')
  for (const item of instances.filter(item => !['aircraft', 'part'].includes(item.id))) {
    assert.notEqual(diagramInstanceSelected(inverted, item.id), diagramInstanceSelected(contextInterface, item.id), 'Every eligible explicit selection is complemented')
  }
  assert.deepEqual(inverted.diagrams[0].nodes, contextInterface.diagrams[0].nodes, 'Inversion never changes placement or collapse')
  assert.deepEqual(setDiagramVisibility(inverted, 'invert'), contextInterface, 'Double inversion restores the original diagram selection')
  const emptySelection = setDiagramVisibility(contextInterface, 'hide')
  assert.deepEqual(interfacesDiagramModel(emptySelection).instances.map(item => item.id), ['aircraft'], 'Hide all keeps the implicit root only')
  assert.equal(interfacesDiagramModel(emptySelection).interfaces.length, 0)
  const fullSelection = setDiagramVisibility(emptySelection, 'show')
  assert.equal(interfacesDiagramModel(fullSelection).instances.length, instances.length - 1, 'Show all continues excluding piece parts')
  const visibleContext = interfacesDiagramModel(contextInterface)
  const editedContext = { ...visibleContext, interfaces: visibleContext.interfaces.map(item => item.id === 'power' ? { ...item, name: 'Renamed power' } : item) }
  const retained = retainHiddenDiagramData(contextInterface, editedContext, visibleContext)
  assert.ok(retained.interfaces.some(item => item.id === 'parent-only'), 'Editing a visible interface retains context-only parent interfaces')
  assert.deepEqual(retained.diagrams[0].nodes, contextInterface.diagrams[0].nodes, 'Selection projection edits preserve hidden coordinates')
  assert.deepEqual([...interfaceBoundaryInstances(instances, 'esps', 'controller')].sort(), ['controller', 'esps', 'propulsion'])
  assert.ok(!interfaceBoundaryInstances(instances, 'controller', 'motor').has('propulsion'), 'Internal connections do not cross the parent boundary')
  const transfer = { interface_type: 'energy', linkage: 'direct', directionality: 'directed', relationship_strength: 'strong', relationship_nature: 'beneficial' }
  assert.notEqual(interfaceAggregationKey('esps', 'propulsion', transfer, ['power']), interfaceAggregationKey('esps', 'propulsion', transfer, ['heat']), 'Distinct resources must not be bundled')
  assert.notEqual(interfaceAggregationKey('esps', 'propulsion', transfer, ['power']), interfaceAggregationKey('propulsion', 'esps', transfer, ['power']), 'Opposite flows remain distinct')
  assert.equal(interfaceAggregationKey('esps', 'propulsion', { ...transfer, directionality: 'bidirectional' }, ['heat', 'power']), interfaceAggregationKey('propulsion', 'esps', { ...transfer, directionality: 'bidirectional' }, ['power', 'heat']), 'Symmetric connections group deterministically regardless of authored endpoint/resource order')
  const structures = instances.map(item => ({ id: `S-${item.id}`, name: item.name,
    parent_id: item.parent_instance_id && `S-${item.parent_instance_id}`,
    system_definition_ref: { system_model_id: model.id, instance_id: item.id } }))
  const nodes = model.diagrams[0].nodes.map(node => ({ ...node, id: `B-${node.instance_id}`,
    kind: 'structure', label: node.instance_id, structure_node_id: `S-${node.instance_id}`, inside_boundary: true,
    container_parent_block_id: instances.find(item => item.id === node.instance_id).parent_instance_id
      ? `B-${instances.find(item => item.id === node.instance_id).parent_instance_id}` : undefined }))
  const analysis = { id: 'fmea', system_binding: { system_model_id: model.id, scope_instance_id: 'aircraft' },
    structure_nodes: structures, interfaces: model.interfaces.map(item => ({ ...item, id: `I-${item.id}`,
      source_block_id: `B-${item.source.instance_id}`, target_block_id: `B-${item.target.instance_id}`,
      system_definition_ref: { system_model_id: model.id, interface_id: item.id } })),
    block_diagram: { nodes, viewport: { x: 0, y: 0, zoom: 1 }, boundary: { x: 0, y: 0, width: 1200, height: 700 } } }
  const focused = projectFmeaDiagram(model, analysis, 'controller')
  assert.deepEqual(Object.keys(focused.interfaceEndpoints).sort(), ['I-motor-power', 'I-power'])
  assert.deepEqual(focused.interfaceEndpoints['I-power'], { source: 'B-esps', target: 'B-controller' }, 'Actual child endpoints remain intact')
  const projected = new Map(focused.analysis.block_diagram.nodes.map(node => [node.id, node]))
  assert.ok(!projected.has('B-aircraft') && !projected.has('B-actuation'), 'Implicit root and unrelated sibling are absent')
  assert.equal(projected.get('B-controller').container_parent_block_id, 'B-propulsion', 'L3 stays nested within its L2 parent')
  assert.equal(projected.get('B-propulsion').expanded, true)
  assert.equal(projected.get('B-controller').expanded, false)
  assert.equal(projected.get('B-controller').x, 431, 'Focus uses master placement')
  assert.deepEqual(focused.interfaceResourceIds['I-power'], ['electricity'])
  const propulsion = projectFmeaDiagram(model, analysis, 'propulsion')
  assert.deepEqual(Object.keys(propulsion.interfaceEndpoints), ['I-power'], 'Parent inherits boundary connection once')
  assert.equal(propulsion.internalInterfaceCount, 1)
  assert.equal(propulsion.interfaceEndpoints['I-power'].target, 'B-controller', 'Collapsed rollup never retargets the real edge')
  const moved = { ...focused.analysis.block_diagram, viewport: { x: 22, y: 34, zoom: 0.8 },
    nodes: focused.analysis.block_diagram.nodes.map(node => node.id === 'B-controller' ? { ...node, x: 615, expanded: true } : node) }
  const patch = mergeFmeaDiagramPatch(analysis, focused, { block_diagram: moved })
  assert.equal(patch.block_diagram.nodes.find(node => node.id === 'B-controller').x, 615, 'Focused dragging updates shared geometry')
  assert.equal(patch.block_diagram.nodes.find(node => node.id === 'B-controller').expanded, false, 'Focus expansion never changes master expansion')
  assert.deepEqual(patch.block_diagram.viewport, analysis.block_diagram.viewport, 'Viewport remains view-specific')
  assert.ok(patch.block_diagram.nodes.some(node => node.id === 'B-actuation'), 'Filtered writes retain omitted blocks')
  const reopened = projectFmeaDiagram(model, analysis, 'controller', { expandedByNodeId: { 'B-controller': true } })
  assert.equal(reopened.analysis.block_diagram.nodes.find(node => node.id === 'B-controller').expanded, true)
  const summarized = projectFmeaDiagram(model, analysis, 'controller', { expandedByNodeId: { 'B-propulsion': false } })
  assert.equal(summarized.analysis.block_diagram.nodes.find(node => node.id === 'B-propulsion').expanded, false, 'Users can collapse an ancestor in a focus view without changing placement or analysis scope')
  assert.deepEqual(model, original, 'Projection never mutates canonical data')
  console.log('PASS Canonical hierarchy: recursive registration, branch visibility, ancestor containment, inherited boundaries, scoped focus and shared geometry')
} finally { await closeViteTestServer(vite, cacheDir, hmrServer) }
