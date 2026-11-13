import type { SystemDefinitionModel, SystemInterface } from '../../api/systemDefinition'

/** Explicitly drawing/retargeting a connector selects its endpoint blocks only.
 * Required ancestor containers must not swallow a newly authored connection. */
export function hiddenIdsAfterInterfaceEdits(model: SystemDefinitionModel, interfaces: readonly SystemInterface[]): string[] {
  const originals = new Map(model.interfaces.map(item => [item.id, item]))
  const instances = new Map(model.instances.map(item => [item.id, item]))
  const definitions = new Map(model.definitions.map(item => [item.id, item]))
  const reveal = new Set<string>()
  for (const item of interfaces) {
    const before = originals.get(item.id)
    const retargeted = !before || (['source', 'target'] as const).some(side =>
      before[side].instance_id !== item[side].instance_id || before[side].external_id !== item[side].external_id)
    if (!retargeted) continue
    for (const endpoint of [item.source, item.target]) {
      let instance = instances.get(endpoint.instance_id ?? '')
      const visited = new Set<string>()
      while (instance && definitions.get(instance.definition_id)?.kind === 'piece_part' && !visited.has(instance.id)) {
        visited.add(instance.id); instance = instances.get(instance.parent_instance_id ?? '')
      }
      if (instance && instance.id !== model.root_instance_id) reveal.add(instance.id)
    }
  }
  return (model.diagrams[0]?.hidden_instance_ids ?? []).filter(id => !reveal.has(id))
}
