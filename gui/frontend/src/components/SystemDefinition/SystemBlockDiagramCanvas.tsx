import { useMemo } from 'react'

import type {
  AIAGVDAFMEAAnalysis,
  FMEABlockDiagram,
  FMEABlockDiagramNode,
  FMEAInterface,
} from '../../api/reliabilityProgram'
import type {
  SystemBlockDefinition,
  SystemDefinitionModel,
  SystemEndpoint,
  SystemInterface,
  SystemInterfaceType,
} from '../../api/systemDefinition'
import FmeaBlockDiagramCanvas from '../ReliabilityProgram/FmeaBlockDiagramCanvas'
import { hierarchyLayout, instanceLabel } from './model'

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

function compatiblePort(
  definition: SystemBlockDefinition,
  type: SystemInterfaceType,
  direction: 'input'|'output',
) {
  return definition.ports.find(port => port.interface_type === type
    && (port.direction === direction || port.direction === 'bidirectional'))
    ?? definition.ports.find(port =>
      port.direction === direction || port.direction === 'bidirectional')
}

export default function SystemBlockDiagramCanvas({
  model,
  collapsedInstanceIds,
  onChange,
}: {
  model: SystemDefinitionModel
  collapsedInstanceIds: string[]
  onChange: (model: SystemDefinitionModel, collapsedInstanceIds: string[]) => void
}) {
  const diagram = model.diagrams[0]
  const analysis = useMemo(() => {
    const stored = new Map((diagram?.nodes ?? []).map(item => [
      item.instance_id ? nodeId(item.instance_id) : externalNodeId(item.external_id ?? ''),
      item,
    ]))
    const auto = new Map(hierarchyLayout(model, collapsedInstanceIds)
      .map(item => [nodeId(item.instance_id ?? ''), item]))
    const structureNodes = model.instances.map(instance => {
      const definition = model.definitions.find(item => item.id === instance.definition_id)
      return {
        id: instance.id, name: instanceLabel(model, instance),
        level: definition?.kind ?? definition?.classification ?? 'component',
        parent_id: instance.parent_instance_id,
        description: definition?.description ?? '', interface: '',
        element_type: 'canonical_instance',
      }
    })
    const nodes: FMEABlockDiagramNode[] = [
      ...model.instances.map(instance => {
        const position = stored.get(nodeId(instance.id)) ?? auto.get(nodeId(instance.id))
        return {
          id: nodeId(instance.id), kind: 'structure' as const,
          structure_node_id: instance.id,
          container_parent_block_id: instance.parent_instance_id
            ? nodeId(instance.parent_instance_id) : undefined,
          expanded: !collapsedInstanceIds.includes(instance.id),
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
    const functions = model.instances.flatMap(instance => {
      const definition = model.definitions.find(item => item.id === instance.definition_id)
      return (definition?.functions ?? []).map(fn => ({
        id: functionId(instance.id, fn.id), structure_node_id: instance.id,
        description: fn.description, canonical_verb_id: fn.canonical_verb_id,
        function_type: fn.function_type, operating_modes: fn.mode_ids,
        owner: '', notes: '',
      }))
    })
    const interfaces: FMEAInterface[] = model.interfaces.map(item => ({
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
        version: 2, density: densityToFmea(diagram?.density),
        boundary: diagram?.boundary ?? {
          label: model.name, x: -40, y: -40, width: 1200, height: 700,
        },
        nodes,
        viewport: diagram?.viewport ?? { x: 0, y: 0, zoom: 1 },
        snap_to_grid: diagram?.snap_to_grid ?? true,
      },
    } as unknown as AIAGVDAFMEAAnalysis
  }, [collapsedInstanceIds, diagram, model])

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

    let definitions = [...next.definitions]
    const endpoint = (
      blockId: string | undefined,
      structureId: string | undefined,
      type: SystemInterfaceType,
      direction: 'input'|'output',
    ): SystemEndpoint|null => {
      if (structureId) {
        const instance = next.instances.find(item => item.id === structureId)
        const definition = definitions.find(item => item.id === instance?.definition_id)
        if (!instance || !definition) return null
        let port = compatiblePort(definition, type, direction)
        if (!port) {
          port = {
            id: `PORT-${direction}-${type}`, name: `${direction} ${type}`,
            interface_type: type, direction, description: '', properties: {},
          }
          definitions = definitions.map(item => item.id === definition.id
            ? { ...item, ports: [...item.ports, port!] } : item)
        }
        return { instance_id: instance.id, port_id: port.id }
      }
      const externalId = blockId ? externalByNode.get(blockId) : undefined
      return externalId ? { external_id: externalId } : null
    }
    next.interfaces = nextAnalysis.interfaces.flatMap(item => {
      const source = endpoint(item.source_block_id, item.source_structure_node_id,
        item.interface_type, 'output')
      const target = endpoint(item.target_block_id, item.target_structure_node_id,
        item.interface_type, 'input')
      if (!source || !target) return []
      const sourcePrefix = source.instance_id ? `${source.instance_id}@@` : ''
      const targetPrefix = target.instance_id ? `${target.instance_id}@@` : ''
      const previous = model.interfaces.find(existing => existing.id === item.id)
      const converted: SystemInterface = {
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
      if (item.kind === 'structure' && item.structure_node_id) systemNodes.push({
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
    const updatedDiagram = {
      id: diagram?.id ?? 'diagram-1', name: diagram?.name ?? model.name,
      scope_instance_id: diagram?.scope_instance_id,
      density: densityFromFmea(nextDiagram.density),
      boundary: nextDiagram.boundary, viewport: nextDiagram.viewport,
      snap_to_grid: nextDiagram.snap_to_grid, mode_ids: diagram?.mode_ids ?? [],
      nodes: systemNodes,
    }
    next.diagrams = [updatedDiagram, ...next.diagrams.slice(1)]
    const parents = new Set(next.instances.flatMap(item => item.parent_instance_id
      ? [item.parent_instance_id] : []))
    const collapsed = nextDiagram.nodes.flatMap(item =>
      item.kind === 'structure' && item.structure_node_id
      && parents.has(item.structure_node_id) && !item.expanded
        ? [item.structure_node_id] : [])
    onChange(next, collapsed)
  }

  return <FmeaBlockDiagramCanvas analysis={analysis} update={update} />
}
