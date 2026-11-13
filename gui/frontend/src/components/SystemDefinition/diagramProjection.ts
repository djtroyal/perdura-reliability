import type { SystemDefinitionModel, SystemEndpoint } from '../../api/systemDefinition'
import { hierarchyIndex } from '../shared/hierarchicalDiagram'

const diagramIndexes = new WeakMap<SystemDefinitionModel, {
  instances: Map<string, SystemDefinitionModel['instances'][number]>
  definitions: Map<string, SystemDefinitionModel['definitions'][number]>
  hidden: Set<string>
  eligible: Set<string>
  selected: Set<string>
  rendered: Set<string>
  branchStates: Map<string, boolean | 'mixed'>
}>()
const diagramIndex = (model: SystemDefinitionModel) => {
  let index = diagramIndexes.get(model)
  if (!index) {
    const definitions = new Map(model.definitions.map(item => [item.id, item]))
    const hidden = new Set(model.diagrams[0]?.hidden_instance_ids ?? [])
    const hierarchy = hierarchyIndex(model.instances)
    const eligible = new Set(model.instances.filter(item => item.id !== model.root_instance_id
      && definitions.get(item.definition_id)?.kind !== 'piece_part').map(item => item.id))
    const selected = new Set([...eligible].filter(id => !hidden.has(id)))
    const rendered = new Set(selected)
    if (model.root_instance_id) rendered.add(model.root_instance_id)
    const counts = new Map<string, { total: number; selected: number }>()
    for (const id of eligible) {
      for (const ancestor of [id, ...hierarchy.ancestors(id)]) {
        const count = counts.get(ancestor) ?? { total: 0, selected: 0 }
        count.total++; if (selected.has(id)) { count.selected++; rendered.add(ancestor) }
        counts.set(ancestor, count)
      }
    }
    index = { instances: new Map(model.instances.map(item => [item.id, item])),
      definitions, hidden, eligible, selected, rendered,
      branchStates: new Map([...counts].map(([id, count]) => [id,
        count.selected === 0 ? false : count.selected === count.total ? true : 'mixed'])) }
    diagramIndexes.set(model, index)
  }
  return index
}

/** Register every block, with nested deterministic defaults and L2 assemblies closed. */
export function defaultHierarchyDiagramNodes(model: SystemDefinitionModel): SystemDefinitionModel['diagrams'][number]['nodes'] {
  const index = hierarchyIndex(model.instances)
  const positions = new Map<string, SystemDefinitionModel['diagrams'][number]['nodes'][number]>()
  const place = (id: string, x: number, y: number) => {
    if (positions.has(id)) return
    positions.set(id, { instance_id: id, x, y, width: 180, height: 72, expanded: false })
    for (const [at, child] of (index.children.get(id) ?? []).entries()) {
      if (id === model.root_instance_id) place(child, 60 + (at % 3) * 320, 80 + Math.floor(at / 3) * 240)
      else place(child, x + 24 + (at % 2) * 216, y + 56 + Math.floor(at / 2) * 108)
    }
  }
  if (model.root_instance_id) place(model.root_instance_id, 20, 20)
  model.instances.forEach((item, at) => place(item.id, 60 + at % 3 * 320, 80 + Math.floor(at / 3) * 240))
  return model.instances.flatMap(item => positions.get(item.id) ? [positions.get(item.id)!] : [])
}

export function diagramBranchVisible(model: SystemDefinitionModel, instanceId: string): boolean {
  return diagramIndex(model).rendered.has(instanceId)
}

/** A required ancestor is drawable context, but does not select its own interfaces. */
export function diagramInstanceSelected(model: SystemDefinitionModel, instanceId: string): boolean {
  return instanceId === model.root_instance_id || diagramIndex(model).selected.has(instanceId)
}

export function diagramBranchSelection(model: SystemDefinitionModel, instanceId: string): boolean | 'mixed' {
  return diagramIndex(model).branchStates.get(instanceId) ?? false
}

function orderedHiddenIds(model: SystemDefinitionModel, hidden: Set<string>): string[] {
  const { instances } = diagramIndex(model)
  return [...model.instances.filter(item => hidden.has(item.id)).map(item => item.id),
    ...[...hidden].filter(id => !instances.has(id))]
}

/** Bulk selection is atomic; containers and collapse are derived independently. */
export function setDiagramVisibility(model: SystemDefinitionModel, action: 'show' | 'hide' | 'invert'): SystemDefinitionModel {
  const diagram = model.diagrams[0]
  if (!diagram) return model
  const { eligible } = diagramIndex(model), hidden = new Set(diagram.hidden_instance_ids ?? [])
  for (const id of eligible) {
    if (action === 'show' || (action === 'invert' && hidden.has(id))) hidden.delete(id)
    else hidden.add(id)
  }
  return { ...model, diagrams: [{ ...diagram, hidden_instance_ids: orderedHiddenIds(model, hidden) }, ...model.diagrams.slice(1)] }
}

/** Revealing a child opens its ancestor path without explicitly selecting its parents. */
export function setDiagramBranchVisibility(model: SystemDefinitionModel, instanceId: string, visible: boolean): SystemDefinitionModel {
  const diagram = model.diagrams[0]
  if (!diagram || !model.instances.some(item => item.id === instanceId)) return model
  const index = hierarchyIndex(model.instances), branch = index.subtree(instanceId)
  const ancestors = index.ancestors(instanceId)
  const hidden = new Set(diagram.hidden_instance_ids ?? [])
  const { eligible } = diagramIndex(model)
  for (const id of branch) if (eligible.has(id)) visible ? hidden.delete(id) : hidden.add(id)
  const existing = new Map(diagram.nodes.flatMap(node => node.instance_id ? [[node.instance_id, node] as const] : []))
  const nodes = [...defaultHierarchyDiagramNodes(model).map(node => existing.get(node.instance_id ?? '') ?? node),
    ...diagram.nodes.filter(node => node.external_id)]
  return { ...model, diagrams: [{ ...diagram,
    hidden_instance_ids: orderedHiddenIds(model, hidden),
    nodes: nodes.map(node => visible && node.instance_id && ancestors.includes(node.instance_id)
      ? { ...node, expanded: true } : node),
  }, ...model.diagrams.slice(1)] }
}

export function diagramEndpointInstance(model: SystemDefinitionModel, endpoint: SystemEndpoint): string | undefined {
  if (!endpoint.instance_id) return undefined
  const index = hierarchyIndex(model.instances)
  const { definitions, instances } = diagramIndex(model)
  let instance = instances.get(endpoint.instance_id)
  const seen = new Set<string>()
  while (instance && definitions.get(instance.definition_id)?.kind === 'piece_part' && !seen.has(instance.id)) {
    seen.add(instance.id)
    instance = instances.get(index.byId.get(instance.id)?.parent_instance_id ?? '')
  }
  return instance && diagramInstanceSelected(model, instance.id) ? instance.id : undefined
}

/** Interfaces describe the system architecture; piece parts remain in its data. */
export function interfacesDiagramModel(model: SystemDefinitionModel): SystemDefinitionModel {
  const pieceParts = new Set(model.definitions.filter(item => item.kind === 'piece_part').map(item => item.id))
  const instances = model.instances.filter(item => !pieceParts.has(item.definition_id) && diagramBranchVisible(model, item.id))
  const instanceIds = new Set(instances.map(item => item.id))
  const externalIds = new Set(model.externals.map(item => item.id))
  const visibleEndpoint = (endpoint: SystemEndpoint) => endpoint.instance_id
    ? instanceIds.has(diagramEndpointInstance(model, endpoint) ?? '') : externalIds.has(endpoint.external_id ?? '')
  return {
    ...model, instances,
    interfaces: model.interfaces.filter(item => visibleEndpoint(item.source) && visibleEndpoint(item.target)),
    diagrams: model.diagrams.map(diagram => ({ ...diagram, nodes: diagram.nodes.filter(item => item.instance_id
      ? instanceIds.has(item.instance_id) : externalIds.has(item.external_id ?? '')) })),
  }
}

/** Merge a filtered editor's changes without treating hidden records as deleted. */
export function retainHiddenDiagramData(
  original: SystemDefinitionModel,
  edited: SystemDefinitionModel,
  visible: SystemDefinitionModel,
): SystemDefinitionModel {
  const visibleInterfaces = new Set(visible.interfaces.map(item => item.id))
  const hiddenInterfaces = original.interfaces.filter(item => !visibleInterfaces.has(item.id))
  const originalExternals = new Set(original.externals.map(item => item.id))
  const editedExternals = new Set(edited.externals.map(item => item.id))
  if (hiddenInterfaces.some(item => [item.source, item.target].some(endpoint => endpoint.external_id
    && originalExternals.has(endpoint.external_id) && !editedExternals.has(endpoint.external_id)))) {
    throw new Error('This actor is connected to interfaces hidden from this diagram. Remove those interfaces before deleting the actor.')
  }
  const replacements = new Map(edited.interfaces.map(item => [item.id, item]))
  const originalIds = new Set(original.interfaces.map(item => item.id))
  const interfaces = original.interfaces.flatMap(item => !visibleInterfaces.has(item.id)
    ? [item] : replacements.has(item.id) ? [replacements.get(item.id)!] : [])
  interfaces.push(...edited.interfaces.filter(item => !originalIds.has(item.id)))

  const visibleInstances = new Set(visible.instances.map(item => item.id))
  const visibleExternals = new Set(visible.externals.map(item => item.id))
  const hiddenNodes = (original.diagrams[0]?.nodes ?? []).filter(item => item.instance_id
    ? !visibleInstances.has(item.instance_id) : !visibleExternals.has(item.external_id ?? ''))
  const nodeKey = (item: SystemDefinitionModel['diagrams'][number]['nodes'][number]) => item.instance_id
    ? `instance:${item.instance_id}` : `external:${item.external_id ?? ''}`
  const hiddenNodeKeys = new Set(hiddenNodes.map(nodeKey))
  const originalNodes = original.diagrams[0]?.nodes ?? []
  const originalNodeKeys = new Set(originalNodes.map(nodeKey))
  return {
    ...edited, interfaces,
    diagrams: edited.diagrams.map((diagram, index) => {
      if (index !== 0) return diagram
      const merged = [...diagram.nodes.filter(item => !hiddenNodeKeys.has(nodeKey(item))), ...hiddenNodes]
      const nodes = new Map(merged.map(item => [nodeKey(item), item]))
      return { ...diagram, nodes: [
        ...originalNodes.flatMap(item => nodes.has(nodeKey(item)) ? [nodes.get(nodeKey(item))!] : []),
        ...merged.filter(item => !originalNodeKeys.has(nodeKey(item))),
      ] }
    }),
  }
}
