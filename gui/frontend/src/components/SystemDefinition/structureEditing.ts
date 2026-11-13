import type { SystemBlockInstance, SystemDefinitionModel } from '../../api/systemDefinition'

export type StructureRow = { instance: SystemBlockInstance; depth: number; ancestors: string[] }

/** Instance-array order is the shared sibling order used by diagrams and Prediction. */
export function systemStructureRows(model: SystemDefinitionModel): StructureRow[] {
  const children = new Map<string, SystemBlockInstance[]>()
  for (const instance of model.instances) {
    const parent = instance.parent_instance_id ?? ''
    const siblings = children.get(parent) ?? []
    siblings.push(instance)
    children.set(parent, siblings)
  }
  const rows: StructureRow[] = [], visited = new Set<string>()
  const visit = (instance: SystemBlockInstance, ancestors: string[]) => {
    if (visited.has(instance.id)) return
    visited.add(instance.id)
    rows.push({ instance, depth: ancestors.length, ancestors })
    for (const child of children.get(instance.id) ?? []) visit(child, [...ancestors, instance.id])
  }
  for (const root of children.get('') ?? []) visit(root, [])
  // Keep malformed drafts inspectable; canonical store validation still rejects them on commit.
  for (const instance of model.instances) if (!visited.has(instance.id)) visit(instance, [])
  return rows
}

export function isPiecePart(model: SystemDefinitionModel, instance: SystemBlockInstance): boolean {
  return model.definitions.find(definition => definition.id === instance.definition_id)?.kind === 'piece_part'
}

export function systemHierarchyInstances(model: SystemDefinitionModel, hidePieceParts: boolean): SystemBlockInstance[] {
  if (!hidePieceParts) return model.instances
  const partDefinitions = new Set(model.definitions.filter(item => item.kind === 'piece_part').map(item => item.id))
  return model.instances.filter(item => !partDefinitions.has(item.definition_id))
}

export function systemParentOptions(model: SystemDefinitionModel, id: string): StructureRow[] {
  if (id === model.root_instance_id || !model.instances.some(instance => instance.id === id)) return []
  return systemStructureRows(model).filter(row => row.instance.id !== id
    && !row.ancestors.includes(id) && !isPiecePart(model, row.instance))
}

/** Move the whole installed subtree; identity, definitions and analysis links stay intact. */
export function reparentSystemInstance(model: SystemDefinitionModel, id: string, parentId: string): SystemDefinitionModel {
  const instance = model.instances.find(item => item.id === id)
  if (!instance) throw new Error('The system element no longer exists.')
  if (id === model.root_instance_id) throw new Error('The canonical System root cannot be moved.')
  if (!systemParentOptions(model, id).some(row => row.instance.id === parentId)) {
    throw new Error('Choose an existing system element outside this subtree. Piece parts cannot be parents.')
  }
  if (instance.parent_instance_id === parentId) return model
  const subtree = new Set(systemStructureRows(model)
    .filter(row => row.instance.id === id || row.ancestors.includes(id)).map(row => row.instance.id))
  const remaining = model.instances.filter(item => !subtree.has(item.id))
  const moved = model.instances.filter(item => subtree.has(item.id)).map(item => item.id === id ? {
    ...item, parent_instance_id: parentId,
    // A slot belongs to its original parent's reusable composition. Moving an
    // occurrence detaches that installation, not its shared block definition.
    ...(item.origin === 'definition_slot' || item.slot_id ? { origin: 'ad_hoc' as const, slot_id: undefined } : {}),
  } : item)
  const next = { ...model, instances: [...remaining, ...moved] }
  return { ...next, instances: systemStructureRows(next).map(row => row.instance) }
}

export function visibleSystemSiblings(model: SystemDefinitionModel, id: string, showPieceParts: boolean): SystemBlockInstance[] {
  const instance = model.instances.find(item => item.id === id)
  if (!instance || id === model.root_instance_id) return []
  return model.instances.filter(item => item.parent_instance_id === instance.parent_instance_id
    && (showPieceParts || !isPiecePart(model, item)))
}

/** Move past the next visible sibling while retaining all hidden piece parts. */
export function moveSystemSibling(model: SystemDefinitionModel, id: string, direction: -1 | 1, showPieceParts: boolean): SystemDefinitionModel {
  const siblings = visibleSystemSiblings(model, id, showPieceParts)
  const index = siblings.findIndex(item => item.id === id)
  const target = siblings[index + direction]
  if (index < 0 || !target) return model
  const instances = [...model.instances]
  const itemIndex = instances.findIndex(item => item.id === id)
  const [instance] = instances.splice(itemIndex, 1)
  const targetIndex = instances.findIndex(item => item.id === target.id)
  instances.splice(targetIndex + (direction === 1 ? 1 : 0), 0, instance)
  const next = { ...model, instances }
  return { ...next, instances: systemStructureRows(next).map(row => row.instance) }
}

/** A moved occurrence can retain the deterministic ID of its old reusable slot. */
export function appendCompositionInstance(instances: SystemBlockInstance[], proposed: SystemBlockInstance,
  newId: () => string): SystemBlockInstance[] {
  if (proposed.slot_id && instances.some(item => item.parent_instance_id === proposed.parent_instance_id
    && item.slot_id === proposed.slot_id)) return instances
  const occupied = instances.find(item => item.id === proposed.id)
  if (!occupied) return [...instances, proposed]
  if (occupied.parent_instance_id === proposed.parent_instance_id && occupied.slot_id === proposed.slot_id) return instances
  const id = newId()
  if (instances.some(item => item.id === id)) throw new Error('The new installed element requires a unique identity.')
  return [...instances, { ...proposed, id }]
}
