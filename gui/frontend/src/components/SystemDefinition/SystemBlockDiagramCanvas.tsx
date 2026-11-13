import { useMemo, type ReactNode } from 'react'

import type {
  AIAGVDAFMEAAnalysis,
  FMEABlockDiagram,
  FMEABlockDiagramNode,
  FMEAInterface,
} from '../../api/reliabilityProgram'
import type {
  SystemDefinitionModel,
  SystemEndpoint,
  SystemInterface,
  SystemInterfaceType,
} from '../../api/systemDefinition'
import FmeaBlockDiagramCanvas from '../ReliabilityProgram/FmeaBlockDiagramCanvas'
import { toast } from '../shared/toast'
import { instanceLabel } from './model'
import { defaultHierarchyDiagramNodes, diagramEndpointInstance, interfacesDiagramModel, retainHiddenDiagramData } from './diagramProjection'
import { projectHierarchicalNodes } from '../shared/hierarchicalDiagram'
import { hiddenIdsAfterInterfaceEdits } from './interfaceDiagramEdits'
import { interfaceResourceFlowProjector } from '../shared/interfaceResourceFlows'

const nodeId = (instanceId: string) => `system-instance:${instanceId}`
const externalNodeId = (externalId: string) => `system-external:${externalId}`
const functionId = (instanceId: string, id: string) => `${instanceId}@@${id}`

const densityToFmea = (value?: 'compact'|'standard'|'detailed') =>
  value === 'compact' ? 'compact' as const
    : value === 'detailed' ? 'spacious' as const : 'comfortable' as const

const densityFromFmea = (value: FMEABlockDiagram['density']) =>
  value === 'dense' || value === 'compact' ? 'compact' as const
    : value === 'spacious' || value === 'expanded' ? 'detailed' as const
      : 'standard' as const

export default function SystemBlockDiagramCanvas({
  model,
  onChange,
  onSelectInstance,
  selectedInstanceId,
  selectionRequest,
  interfaceSelectionRequest,
  libraryContent,
  structureInspector,
  interfaceInspector,
}: {
  model: SystemDefinitionModel
  onChange: (model: SystemDefinitionModel) => void
  onSelectInstance?: (instanceId: string) => void
  selectedInstanceId?: string
  selectionRequest?: { instanceId: string; requestId: number }
  interfaceSelectionRequest?: { interfaceId: string; requestId: number }
  libraryContent?: ReactNode
  structureInspector?: (instanceId: string) => ReactNode
  interfaceInspector?: (interfaceId: string) => ReactNode
}) {
  const diagram = model.diagrams[0]
  const visibleModel = useMemo(() => interfacesDiagramModel(model), [model])
  const analysis = useMemo(() => {
    const stored = new Map((diagram?.nodes ?? []).map(item => [
      item.instance_id ? nodeId(item.instance_id) : externalNodeId(item.external_id ?? ''),
      item,
    ]))
    const auto = new Map(defaultHierarchyDiagramNodes(model)
      .map(item => [nodeId(item.instance_id ?? ''), item]))
    const structureNodes = visibleModel.instances.map(instance => {
      const definition = model.definitions.find(item => item.id === instance.definition_id)
      return {
        id: instance.id, name: instanceLabel(model, instance),
        level: definition?.kind ?? definition?.classification ?? 'component',
        parent_id: instance.parent_instance_id,
        description: definition?.description ?? '', interface: '',
        element_type: 'canonical_instance',
      }
    })
    const visibleParents = new Set(visibleModel.instances.flatMap(instance => instance.parent_instance_id
      ? [instance.parent_instance_id] : []))
    const nodes: FMEABlockDiagramNode[] = [
      ...visibleModel.instances.map(instance => {
        const position = stored.get(nodeId(instance.id)) ?? auto.get(nodeId(instance.id))
        return {
          id: nodeId(instance.id), kind: 'structure' as const,
          structure_node_id: instance.id,
          container_parent_block_id: instance.parent_instance_id
            ? nodeId(instance.parent_instance_id) : undefined,
          expanded: visibleParents.has(instance.id) && Boolean(position?.expanded),
          label: instanceLabel(model, instance),
          x: position?.x ?? 80, y: position?.y ?? 80,
          width: position?.width ?? 180, height: position?.height ?? 72,
          inside_boundary: true,
        }
      }),
      ...model.externals.map((external, index) => {
        const position = stored.get(externalNodeId(external.id))
        return {
          id: externalNodeId(external.id), kind: 'external' as const,
          external_kind: external.kind, label: external.name,
          x: position?.x ?? 1040, y: position?.y ?? 80 + index * 100,
          width: position?.width ?? 180, height: position?.height ?? 72,
          inside_boundary: false,
        }
      }),
    ]
    // The canvas itself is the top system boundary. Keep an endpoint card
    // only when a real interface terminates at the system; never lose that
    // interface or rewrite the installed hierarchy to obtain this view.
    const rootId = model.root_instance_id
    const rootHasInterfaces = rootId && visibleModel.interfaces.some(item =>
      item.source.instance_id === rootId || item.target.instance_id === rootId)
    const rootBlockId = rootId ? nodeId(rootId) : undefined
    const displayNodes = projectHierarchicalNodes(nodes, { rootBlockId, rootEndpointRequired: Boolean(rootHasInterfaces) })
    const functions = visibleModel.instances.flatMap(instance => {
      const definition = model.definitions.find(item => item.id === instance.definition_id)
      return (definition?.functions ?? []).map(fn => ({
        id: functionId(instance.id, fn.id), structure_node_id: instance.id,
        description: fn.description, canonical_verb_id: fn.canonical_verb_id,
        function_type: fn.function_type, operating_modes: fn.mode_ids,
        owner: '', notes: '',
      }))
    })
    const interfaces: FMEAInterface[] = visibleModel.interfaces.map(item => ({
      id: item.id, name: item.name, interface_type: item.interface_type,
      source_block_id: item.source.instance_id
        ? nodeId(item.source.instance_id) : externalNodeId(item.source.external_id ?? ''),
      target_block_id: item.target.instance_id
        ? nodeId(item.target.instance_id) : externalNodeId(item.target.external_id ?? ''),
      source_structure_node_id: item.source.instance_id,
      target_structure_node_id: item.target.instance_id,
      linkage: item.linkage, directionality: item.directionality,
      relationship_strength: item.strength === 'strong' || item.strength === 'weak'
        ? item.strength : 'unspecified',
      relationship_nature: 'unspecified', interface_detail: item.interface_detail,
      external_source: model.externals.find(external =>
        external.id === item.source.external_id)?.name ?? '',
      external_target: model.externals.find(external =>
        external.id === item.target.external_id)?.name ?? '',
      flow_description: item.flow_description,
      operating_condition: item.operating_condition,
      function_ids: [
        ...item.source_function_ids.map(id => item.source.instance_id
          ? functionId(item.source.instance_id, id) : ''),
        ...item.target_function_ids.map(id => item.target.instance_id
          ? functionId(item.target.instance_id, id) : ''),
      ].filter(Boolean),
      requirement_ids: [],
    }))
    return {
      id: model.id, name: model.name, kind: 'dfmea',
      structure_nodes: structureNodes, functions, functional_requirements: [],
      interfaces,
      block_diagram: {
        version: 2, density: diagram?.layoutOptions?.mode === 'expanded' ? 'expanded' : densityToFmea(diagram?.density),
        layoutOptions: diagram?.layoutOptions,
        connectorStyle: diagram?.connectorStyle,
        boundary: diagram?.boundary ?? {
          label: model.name, x: -40, y: -40, width: 1200, height: 700,
        },
        nodes: displayNodes,
        viewport: diagram?.viewport ?? { x: 0, y: 0, zoom: 1 },
        snap_to_grid: diagram?.snap_to_grid ?? true,
      },
    } as unknown as AIAGVDAFMEAAnalysis
  }, [diagram, model, visibleModel])
  const interfaceEndpoints = useMemo(() => Object.fromEntries(visibleModel.interfaces.map(item => [item.id, {
    source: item.source.instance_id ? nodeId(diagramEndpointInstance(model, item.source) ?? '')
      : externalNodeId(item.source.external_id ?? ''),
    target: item.target.instance_id ? nodeId(diagramEndpointInstance(model, item.target) ?? '')
      : externalNodeId(item.target.external_id ?? ''),
  }])), [model, visibleModel])
  const interfaceResourceFlows = useMemo(() => {
    const project = interfaceResourceFlowProjector(model)
    return Object.fromEntries(visibleModel.interfaces.map(item => [item.id, project(item, interfaceEndpoints[item.id])]))
  }, [model, visibleModel.interfaces, interfaceEndpoints])
  const interfaceResourceIds = useMemo(() => Object.fromEntries(Object.entries(interfaceResourceFlows)
    .map(([id, flows]) => [id, [...new Set(flows.map(flow => flow.resourceId))]])), [interfaceResourceFlows])

  const update = (patch: Partial<AIAGVDAFMEAAnalysis>) => {
    const nextAnalysis = { ...analysis, ...patch }
    const nextDiagram = nextAnalysis.block_diagram
    const next = structuredClone(model)
    const externalNodes = nextDiagram.nodes.filter(item => item.kind === 'external')
    const externalByNode = new Map(externalNodes.map(item => {
      const existingId = item.id.startsWith('system-external:')
        ? item.id.slice('system-external:'.length) : item.id
      return [item.id, existingId]
    }))
    next.externals = externalNodes.map(item => {
      const id = externalByNode.get(item.id)!
      const existing = model.externals.find(external => external.id === id)
      return {
        id, name: item.label,
        kind: item.external_kind ?? existing?.kind ?? 'other',
        description: existing?.description ?? '', ports: existing?.ports ?? [],
      }
    })

    const definitions = next.definitions
    const endpoint = (
      blockId: string | undefined,
      structureId: string | undefined,
      type: SystemInterfaceType,
      original?: SystemEndpoint,
    ): SystemEndpoint|null => {
      if (structureId) {
        const instance = next.instances.find(item => item.id === structureId)
        const definition = definitions.find(item => item.id === instance?.definition_id)
        if (!instance || !definition) return null
        // Drawing handles select blocks, not engineering ports. Preserve an authored
        // terminal when valid; structured I/O pairing supplies the actual resource path.
        const port = original?.instance_id === instance.id && original.port_id
          ? definition.ports.find(item => item.id === original.port_id && item.interface_type === type)
          : undefined
        return { instance_id: instance.id, ...(port ? { port_id: port.id } : {}) }
      }
      const externalId = blockId ? externalByNode.get(blockId) : undefined
      if (!externalId) return null
      const port = original?.external_id === externalId && original.port_id
        ? next.externals.find(item => item.id === externalId)?.ports?.find(item =>
          item.id === original.port_id && item.interface_type === type)
        : undefined
      return { external_id: externalId, ...(port ? { port_id: port.id } : {}) }
    }
    next.interfaces = nextAnalysis.interfaces.flatMap(item => {
      const previous = model.interfaces.find(existing => existing.id === item.id)
      const source = endpoint(item.source_block_id, item.source_structure_node_id,
        item.interface_type, previous?.source)
      const target = endpoint(item.target_block_id, item.target_structure_node_id,
        item.interface_type, previous?.target)
      if (!source || !target) return []
      const sourcePrefix = source.instance_id ? `${source.instance_id}@@` : ''
      const targetPrefix = target.instance_id ? `${target.instance_id}@@` : ''
      const converted: SystemInterface = {
        ...previous,
        id: item.id, name: item.name, interface_type: item.interface_type,
        source, target, linkage: item.linkage, directionality: item.directionality,
        strength: item.relationship_strength === 'strong' || item.relationship_strength === 'weak'
          ? item.relationship_strength : previous?.strength ?? 'unknown',
        nature: previous?.nature ?? 'unknown',
        interface_detail: item.interface_detail,
        flow_description: item.flow_description,
        operating_condition: item.operating_condition,
        source_function_ids: sourcePrefix ? item.function_ids.filter(id =>
          id.startsWith(sourcePrefix)).map(id => id.slice(sourcePrefix.length)) : [],
        target_function_ids: targetPrefix ? item.function_ids.filter(id =>
          id.startsWith(targetPrefix)).map(id => id.slice(targetPrefix.length)) : [],
        mode_ids: previous?.mode_ids ?? [], properties: previous?.properties ?? {},
      }
      return [converted]
    })
    next.definitions = definitions
    const systemNodes: SystemDefinitionModel['diagrams'][number]['nodes'] = []
    for (const item of nextDiagram.nodes) {
      if (item.kind === 'structure' && item.structure_node_id && item.structure_node_id !== model.root_instance_id) systemNodes.push({
        instance_id: item.structure_node_id,
        x: item.x, y: item.y, width: item.width, height: item.height,
        expanded: Boolean(item.expanded),
      })
      if (item.kind === 'external') systemNodes.push({
        external_id: externalByNode.get(item.id),
        x: item.x, y: item.y, width: item.width, height: item.height,
        expanded: false,
      })
    }
    // Root endpoint card geometry is a view projection, not a replacement
    // for the shared full-system arrangement used by other modules.
    const originalRoot = diagram?.nodes.find(item => item.instance_id === model.root_instance_id)
    if (originalRoot) systemNodes.push(originalRoot)
    const updatedDiagram = {
      id: diagram?.id ?? 'diagram-1', name: diagram?.name ?? model.name,
      scope_instance_id: diagram?.scope_instance_id,
      density: densityFromFmea(nextDiagram.density),
      layoutOptions: nextDiagram.layoutOptions,
      connectorStyle: nextDiagram.connectorStyle,
      boundary: nextDiagram.boundary, viewport: nextDiagram.viewport,
      snap_to_grid: nextDiagram.snap_to_grid, mode_ids: diagram?.mode_ids ?? [],
      hidden_instance_ids: hiddenIdsAfterInterfaceEdits(model, next.interfaces),
      nodes: systemNodes,
    }
    next.diagrams = [updatedDiagram, ...next.diagrams.slice(1)]
    try {
      onChange(retainHiddenDiagramData(model, next, visibleModel))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the Interfaces diagram.')
    }
  }

  return <FmeaBlockDiagramCanvas analysis={analysis} update={update} fillHeight allowCanonicalEditing
    displayPreferenceKey={`system:${model.id}`} resourceOptions={model.resources}
    hasExpandedSystems={Boolean(diagram?.nodes.some(item => item.instance_id && item.instance_id !== model.root_instance_id && item.expanded))}
    onCollapseAllSystems={() => onChange({ ...model, diagrams: model.diagrams.map((item, index) => index === 0
      ? { ...item, nodes: item.nodes.map(node => node.instance_id && node.instance_id !== model.root_instance_id && node.expanded
        ? { ...node, expanded: false } : node) } : item) })}
    findingNavigation={interfaceSelectionRequest && { record_id: interfaceSelectionRequest.interfaceId, requestId: interfaceSelectionRequest.requestId }}
    hideAnalysisBoundary implicitRootStructureId={model.root_instance_id}
    interfaceEndpoints={interfaceEndpoints} interfaceResourceIds={interfaceResourceIds} interfaceResourceFlows={interfaceResourceFlows} interfaceInspector={interfaceInspector}
    initialSelectedStructureId={selectedInstanceId}
    onStructureSelect={onSelectInstance} libraryContent={libraryContent}
    structureSelection={selectionRequest && { structureId:selectionRequest.instanceId,requestId:selectionRequest.requestId }}
    hideCreationTools={Boolean(libraryContent)} structureInspector={structureInspector} />
}
