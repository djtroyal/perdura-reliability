import { emptySystemDefinition, type SystemDefinitionState } from '../components/SystemDefinition/model'
import type { SystemBlockDefinition, SystemBlockInstance, SystemDefinitionModel } from '../api/systemDefinition'
import type { PredictionPart } from '../api/client'
import { systemInputFingerprint } from './sharedSystemFingerprint'
export { systemInputFingerprint } from './sharedSystemFingerprint'

export interface SharedPredictionBlock {
  id: string; name: string; parentId: string | null; quantity?: number
  system_ref?: unknown; operatingFraction?: number; environment?: unknown
}
export interface PredictionView {
  parts: PredictionPart[]; blocks: SharedPredictionBlock[]; blockSeq: number
  standard?: string
}
export interface PredictionScenario {
  scenarioVersion: 1
  partInputs: Record<string, Record<string, unknown>>
  blockInputs: Record<string, Record<string, unknown>>
  [key: string]: unknown
}
const partFields = ['name', 'part_number', 'manufacturer', 'supplier', 'supplier_part_number',
  'description', 'value', 'package_or_footprint'] as const
const occurrenceFields = ['bom_source', 'bom_attributes', 'population_status'] as const
const sharedPartKeys = new Set<string>(['id', 'parentId', 'quantity', 'reference_designators', 'system_ref',
  'linked_system_definition', ...partFields, ...occurrenceFields])
const sharedBlockKeys = new Set(['id', 'name', 'parentId', 'quantity', 'system_ref', 'linked_system_definition'])
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {}
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
const predictionAdapters: Record<string, string> = {
  'MIL-HDBK-217F': 'prediction.mil-hdbk-217f', Telcordia: 'prediction.telcordia-sr332',
  '217Plus': 'prediction.217plus', FIDES: 'prediction.fides', NSWC: 'prediction.nswc-98-le1',
  'EPRD-2014': 'custom', 'NPRD-2023': 'custom',
}

export function createProjectSystem(name = 'Project system'): SystemDefinitionState {
  const state = emptySystemDefinition(name, 'project-system')
  const definition: SystemBlockDefinition = { id: 'project-root-definition', name, kind: 'system',
    classification: 'system', revision: 'A', description: '', part_number: '', manufacturer: '', category: '',
    ports: [], functions: [], failure_modes: [], child_slots: [], analysis_profiles: [], properties: {} }
  const root: SystemBlockInstance = { id: 'project-root', name, definition_id: definition.id, quantity: 1,
    reference_designators: [], mode_ids: [], function_overrides: [], failure_mode_overrides: [], legacy_refs: [] }
  return { ...state, selectedInstanceId: root.id, model: { ...state.model,
    root_instance_id: root.id, definitions: [definition], instances: [root] } }
}

export function validateProjectSystem(model: SystemDefinitionModel): void {
  const byId = new Map(model.instances.map(item => [item.id, item]))
  const definitions = new Map(model.definitions.map(item => [item.id, item]))
  if (byId.size !== model.instances.length || definitions.size !== model.definitions.length)
    throw new Error('System instance and definition identities must be unique.')
  const roots = model.instances.filter(item => !item.parent_instance_id)
  if (roots.length !== 1 || roots[0].id !== model.root_instance_id || roots[0].quantity !== 1
      || definitions.get(roots[0].definition_id)?.kind !== 'system')
    throw new Error('The project requires exactly one System root with quantity one.')
  for (const instance of model.instances) {
    if (!instance.id || !definitions.has(instance.definition_id) || !Number.isInteger(instance.quantity) || instance.quantity < 1)
      throw new Error('Every system item needs a valid identity, definition and positive integer quantity.')
    const visited = new Set([instance.id])
    let parentId = instance.parent_instance_id
    while (parentId) {
      const parent = byId.get(parentId)
      if (!parent || visited.has(parentId)) throw new Error('System parents must exist and cannot form a cycle.')
      if (definitions.get(parent.definition_id)?.kind === 'piece_part') throw new Error('Piece parts cannot contain other system items.')
      visited.add(parentId); parentId = parent.parent_instance_id
    }
  }
}

export function normalizeSharedSystemModules(modules: Record<string, unknown>): Record<string, unknown> {
  const source = record(modules.systemDefinition === undefined ? createProjectSystem() : modules.systemDefinition)
  if (source._folioWrap || !source.model) throw new Error('This project requires one canonical System Definition, not System Definition folios.')
  const model = source.model as SystemDefinitionModel
  validateProjectSystem(model)
  if (modules.prediction !== undefined) {
    const raw = record(modules.prediction)
    if (raw._folioWrap && (!Array.isArray(raw.folios) || !raw.folios.length))
      throw new Error('Prediction requires at least one scenario with a valid identity.')
    const folios = raw._folioWrap ? raw.folios as unknown[] : [{ state: raw }]
    if (raw._folioWrap) {
      const ids = folios.map(value => record(value).id)
      if (ids.some(id => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length)
        throw new Error('Prediction scenario identities must be unique nonempty strings.')
      if (typeof raw.activeId !== 'string' || !ids.includes(raw.activeId))
        throw new Error('Prediction active scenario must reference an existing scenario identity.')
    }
    const definitions = new Map(model.definitions.map(item => [item.id, item]))
    const partIds = new Set(model.instances.filter(item => definitions.get(item.definition_id)?.kind === 'piece_part').map(item => item.id))
    const blockIds = new Set(model.instances.filter(item => item.id !== model.root_instance_id && !partIds.has(item.id)).map(item => item.id))
    for (const folio of folios) {
      const scenario = record(record(folio).state)
      if (scenario.scenarioVersion !== 1 || 'parts' in scenario || 'blocks' in scenario
          || !scenario.partInputs || !scenario.blockInputs || typeof scenario.partInputs !== 'object'
          || typeof scenario.blockInputs !== 'object' || Array.isArray(scenario.partInputs) || Array.isArray(scenario.blockInputs)
          || [...Object.values(scenario.partInputs), ...Object.values(scenario.blockInputs)].some(value =>
            !value || typeof value !== 'object' || Array.isArray(value)))
        throw new Error('Prediction requires shared-system scenario format version 1. Copied legacy hierarchies cannot be imported into this project format.')
      if (Object.keys(record(scenario.partInputs)).some(id => !partIds.has(id))
          || Object.keys(record(scenario.blockInputs)).some(id => !blockIds.has(id)))
        throw new Error('Prediction scenario inputs reference missing system items or the wrong item kind.')
    }
  }
  return modules.systemDefinition === undefined ? { ...modules, systemDefinition: source } : modules
}


export function emptyPredictionScenario(initial: PredictionView): PredictionScenario {
  const { parts: _, blocks: _blocks, blockSeq: _seq, ...settings } = initial
  return { ...settings, scenarioVersion: 1, partInputs: {}, blockInputs: {} }
}

export function materializePrediction<T extends PredictionView>(system: SystemDefinitionState,
  scenario: PredictionScenario, initial: T): T {
  const model = system.model
  const definitions = new Map(model.definitions.map(item => [item.id, item]))
  const parts: PredictionPart[] = [], blocks: SharedPredictionBlock[] = []
  for (const instance of model.instances) {
    if (instance.id === model.root_instance_id) continue
    const definition = definitions.get(instance.definition_id)!
    const parentId = instance.parent_instance_id === model.root_instance_id ? null : instance.parent_instance_id ?? null
    const system_ref = { system_model_id: model.id, instance_id: instance.id, definition_id: definition.id }
    if (definition.kind !== 'piece_part') {
      blocks.push({ operatingFraction: 1, environment: null, ...scenario.blockInputs?.[instance.id],
        id: instance.id, name: instance.name || definition.name, parentId, quantity: instance.quantity, system_ref })
      continue
    }
    const local = scenario.partInputs?.[instance.id] ?? {}
    const profile = definition.analysis_profiles?.find(item => item.id === local.profileId
      && item.domain === 'prediction' && item.adapter_id === predictionAdapters[String(scenario.standard ?? initial.standard)])
    const override = instance.profile_overrides?.find(item => item.profile_id === profile?.id)
    const applicable = profile && !override?.disabled && (!profile.mode_ids?.length || !scenario.modeId || profile.mode_ids.includes(String(scenario.modeId)))
    const values = Object.fromEntries(Object.entries(applicable ? { ...profile.values, ...override?.values } : {}).map(([key, value]) => [key, value.value]))
    const { category, environment, ...profileParams } = values
    const selectedCategory = String(local.category ?? category ?? '')
    parts.push({ category: selectedCategory,
      calculation_enabled: Boolean(selectedCategory),
      ...(selectedCategory ? {} : { calculation_exclusion_reason: 'Choose and confirm a prediction model for this scenario.',
        bom_mapping: { status: 'unmapped', source: 'manual' } }),
      environment, ...local, params: { ...profileParams, ...record(local.params) },
      ...Object.fromEntries(partFields.map(key => [key, definition.part_metadata?.[key]]).filter(([, value]) => value !== undefined)),
      ...Object.fromEntries(occurrenceFields.map(key => [key, instance.source_metadata?.[key]]).filter(([, value]) => value !== undefined)),
      ...(!selectedCategory || (local.profileId && !applicable) || instance.source_metadata?.population_status === 'dnp'
        ? { calculation_enabled: false, calculation_exclusion_reason: !applicable && local.profileId
          ? 'Selected profile is missing, incompatible, disabled or inapplicable.'
          : instance.source_metadata?.population_status === 'dnp' ? 'Not populated' : 'Choose and confirm a prediction model for this scenario.' } : {}),
      id: instance.id, name: instance.name || definition.name, part_number: definition.part_number,
      manufacturer: definition.manufacturer, description: definition.description,
      parentId, quantity: instance.quantity, reference_designators: instance.reference_designators, system_ref,
    } as PredictionPart)
  }
  return { ...initial, ...scenario, parts, blocks,
    blockSeq: Math.max(0, ...blocks.map(block => Number(/^b(\d+)$/.exec(block.id)?.[1] ?? 0))),
  } as T
}

export function canonicalDependencyUpdates(modules: Record<string, unknown>, before: SystemDefinitionState,
  after: SystemDefinitionState): Record<string, unknown> {
  if (systemInputFingerprint(before.model) === systemInputFingerprint(after.model)) return {}
  const updates: Record<string, unknown> = {}
  const instances = new Map(after.model.instances.map(item => [item.id, item]))
  const definitions = new Map(after.model.definitions.map(item => [item.id, item]))
  const oldInstances = new Map(before.model.instances.map(item => [item.id, item]))
  const oldDefinitions = new Map(before.model.definitions.map(item => [item.id, item]))
  for (const moduleKey of ['faultTree', 'system', 'fmea', 'markov']) {
    const raw = record(modules[moduleKey])
    const updateState = (value: unknown) => {
      let changed = false
      const broken: string[] = []
      const visit = (node: unknown): unknown => {
        if (Array.isArray(node)) return node.map(visit)
        if (!node || typeof node !== 'object') return node
        const source = node as Record<string, unknown>, reference = record(source.systemRef ?? source.system_ref ?? source.system_definition_ref)
        let next = source
        if (reference.system_model_id === before.model.id) {
          const id = String(reference.instance_id ?? '')
          const instance = instances.get(id)
          const definition = definitions.get(String(reference.definition_id || instance?.definition_id || ''))
          const missing = (id && !instance) ? id
            : reference.definition_id && !definition ? `definition:${reference.definition_id}`
            : reference.function_id && !definition?.functions.some(item => item.id === reference.function_id) ? `function:${reference.function_id}`
            : reference.failure_mode_id && !definition?.failure_modes.some(item => item.id === reference.failure_mode_id) ? `failure:${reference.failure_mode_id}`
            : reference.interface_id && !after.model.interfaces.some(item => item.id === reference.interface_id) ? `interface:${reference.interface_id}` : null
          if (missing) { changed = true; broken.push(String(missing)); next = { ...source, systemReferenceBroken: true } }
          else if (source.systemReferenceBroken || (instance && (!same(instance, oldInstances.get(id))
              || !same(definitions.get(instance.definition_id), oldDefinitions.get(instance.definition_id))))
              || (reference.interface_id && !same(after.model.interfaces.find(item => item.id === reference.interface_id),
                before.model.interfaces.find(item => item.id === reference.interface_id)))) {
            changed = true
            const name = instance?.name || definition?.name
            next = { ...source, systemReferenceBroken: false, ...(name && 'label' in source ? { label: name } : name && 'name' in source ? { name } : {}) }
          }
        }
        const output: Record<string, unknown> = { ...next }
        for (const [key, child] of Object.entries(next)) {
          if (!['result', 'results', 'resultProvenance', 'canonicalDependencies'].includes(key)) output[key] = visit(child)
        }
        return output
      }
      const next = visit(value)
      return changed ? { ...record(next), canonicalDependencies: { status: broken.length ? 'broken' : 'stale',
        missingInstanceIds: [...new Set(broken)], message: broken.length
          ? 'Shared system items were deleted. Relink, remove or detach these references before recalculating.'
          : 'Shared system inputs changed. Review linked inputs and recalculate.' } } : value
    }
    if (raw._folioWrap && Array.isArray(raw.folios)) {
      let changed = false
      const folios = raw.folios.map(value => {
        const folio = record(value), next = updateState(folio.state)
        if (next === folio.state) return value
        changed = true; return { ...folio, state: next, dirty: true }
      })
      if (changed) updates[moduleKey] = { ...raw, folios }
    } else if (Object.keys(raw).length) {
      const next = updateState(raw)
      if (next !== raw) updates[moduleKey] = next
    }
  }
  return updates
}

/** Split a view edit into canonical physical data and scenario-owned model inputs. */
export function splitPredictionUpdate<T extends PredictionView>(system: SystemDefinitionState,
  scenario: PredictionScenario, next: T): { system: SystemDefinitionState; scenario: PredictionScenario } {
  const model = system.model, previous = materializePrediction(system, scenario, next)
  const oldParts = new Map(previous.parts.map(part => [part.id, part]))
  const instances = new Map(model.instances.map(item => [item.id, item]))
  const definitions = new Map(model.definitions.map(item => [item.id, item]))
  const desired = new Set([model.root_instance_id!])
  const partInputs: PredictionScenario['partInputs'] = {}, blockInputs: PredictionScenario['blockInputs'] = {}
  const install = (id: string, name: string, parentId: string | null, quantity: number, kind: 'assembly' | 'piece_part') => {
    if (!id || desired.has(id)) throw new Error('Shared system items require unique identities.')
    desired.add(id)
    let instance = instances.get(id)
    let definition = instance ? definitions.get(instance.definition_id)! : undefined
    if (!instance) {
      const definitionId = `definition-${id}`
      definition = { id: definitionId, name, kind, classification: kind, description: '', part_number: '', manufacturer: '',
        category: '', ports: [], functions: [], failure_modes: [], child_slots: [], properties: {}, analysis_profiles: [] }
      instance = { id, name, definition_id: definitionId, quantity, parent_instance_id: parentId ?? model.root_instance_id,
        reference_designators: [], mode_ids: [], function_overrides: [], failure_mode_overrides: [], legacy_refs: [] }
      definitions.set(definitionId, definition)
    }
    if ((definition!.kind === 'piece_part') !== (kind === 'piece_part')) throw new Error('System item kind changed; refresh the editor before changing its hierarchy.')
    const candidate = { ...instance, name, quantity, parent_instance_id: parentId ?? model.root_instance_id }
    if (!same(candidate, instance)) instance = candidate
    instances.set(id, instance)
    return { instance, definition: definition! }
  }
  for (const block of next.blocks) {
    const { instance } = install(block.id, block.name, block.parentId, block.quantity ?? 1, 'assembly')
    blockInputs[instance.id] = Object.fromEntries(Object.entries(block).filter(([key]) => !sharedBlockKeys.has(key)))
  }
  for (const part of next.parts) {
    const { instance, definition } = install(String(part.id ?? ''), String(part.name ?? part.part_number ?? 'Piece part'),
      part.parentId ?? null, part.quantity ?? 1, 'piece_part')
    const prior = oldParts.get(part.id)
    if (!prior || partFields.some(key => !same(part[key], prior[key]))) {
      const metadata = { ...definition.part_metadata }
      for (const key of partFields) if (!['name', 'part_number', 'manufacturer', 'description'].includes(key)) metadata[key] = part[key]
      definitions.set(definition.id, { ...definition, part_number: part.part_number ?? '', manufacturer: part.manufacturer ?? '',
        description: part.description ?? '', part_metadata: metadata })
    }
    if (!prior || !same(part.reference_designators, prior.reference_designators)
        || occurrenceFields.some(key => !same(part[key], prior[key]))) {
      instances.set(instance.id, { ...instance, reference_designators: part.reference_designators ?? [],
        source_metadata: Object.fromEntries(occurrenceFields.map(key => [key, part[key]])) })
    }
    const local = { ...scenario.partInputs?.[instance.id] }
    if (scenario.standard !== next.standard) {
      for (const key of Object.keys(local)) delete local[key]
      Object.assign(local, Object.fromEntries(Object.entries(part).filter(([key]) => !sharedPartKeys.has(key) && key !== 'profileId')))
    } else if (prior && part.profileId !== prior.profileId) {
      local.profileId = part.profileId
      for (const key of ['category', 'params', 'environment', 'bom_mapping', 'calculation_enabled', 'calculation_exclusion_reason']) delete local[key]
    } else {
      for (const [key, value] of Object.entries(part)) {
        if (sharedPartKeys.has(key) || (prior && same(value, (prior as unknown as Record<string, unknown>)[key]))) continue
        if (key === 'params' && prior) {
          const parameters = { ...record(local.params) }
          for (const name of new Set([...Object.keys(part.params), ...Object.keys(prior.params)])) {
            if (!same(part.params[name], prior.params[name])) {
              if (part.params[name] === undefined) delete parameters[name]
              else parameters[name] = part.params[name]
            }
          }
          local.params = parameters
        } else if (value === undefined) delete local[key]
        else local[key] = value
      }
    }
    partInputs[instance.id] = local
  }
  const nextInstances = [...instances.values()].filter(item => desired.has(item.id))
  const removed = model.instances.filter(item => !desired.has(item.id))
  if (removed.some(item => model.interfaces.some(edge => edge.source.instance_id === item.id || edge.target.instance_id === item.id)
      || model.function_links.some(edge => edge.source.instance_id === item.id || edge.target.instance_id === item.id)
      || model.propagation_rules.some(edge => edge.source?.instance_id === item.id || edge.target?.instance_id === item.id)))
    throw new Error('Remove or reassign System Definition interfaces and functional links before deleting their items.')
  const nextModel = { ...model, definitions: [...definitions.values()], instances: nextInstances,
    diagrams: removed.length ? model.diagrams.map(diagram => ({ ...diagram,
      nodes: diagram.nodes.filter(node => !node.instance_id || desired.has(node.instance_id)) })) : model.diagrams }
  validateProjectSystem(nextModel)
  const unchanged = same(model, nextModel)
  const { parts: _, blocks: _blocks, blockSeq: _seq, ...settings } = next
  return { system: unchanged ? system : { ...system, model: nextModel, propagation: null },
    scenario: { ...settings, scenarioVersion: 1, partInputs, blockInputs } }
}


export function pruneScenarioInputs(model: SystemDefinitionModel, scenario: PredictionScenario): PredictionScenario {
  const definitions = new Map(model.definitions.map(item => [item.id, item]))
  const partIds = new Set(model.instances.filter(item => definitions.get(item.definition_id)?.kind === 'piece_part').map(item => item.id))
  const blockIds = new Set(model.instances.filter(item => item.id !== model.root_instance_id && !partIds.has(item.id)).map(item => item.id))
  return { ...scenario, partInputs: Object.fromEntries(Object.entries(scenario.partInputs ?? {}).filter(([id]) => partIds.has(id))),
    blockInputs: Object.fromEntries(Object.entries(scenario.blockInputs ?? {}).filter(([id]) => blockIds.has(id))) }
}


/** Persist only fields a result callback actually changed, never derived defaults. */
export function mergePredictionResultUpdate<T extends PredictionView>(scenario: PredictionScenario, before: T, after: T): PredictionScenario {
  const next = { ...scenario }
  for (const [key, value] of Object.entries(after)) {
    if (['parts', 'blocks', 'blockSeq'].includes(key) || same(value, (before as unknown as Record<string, unknown>)[key])) continue
    next[key] = value
  }
  return next
}


/** Resolve current qualified references, so removing/detaching a broken link can recover. */
export function brokenSystemReferences(value: unknown, model: SystemDefinitionModel): string[] {
  const instances = new Map(model.instances.map(item => [item.id, item]))
  const definitions = new Map(model.definitions.map(item => [item.id, item]))
  const missing = new Set<string>()
  const visit = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(visit); return }
    if (!node || typeof node !== 'object') return
    const source = node as Record<string, unknown>, ref = record(source.systemRef ?? source.system_ref ?? source.system_definition_ref)
    if (Object.keys(ref).length) {
      const instance = instances.get(String(ref.instance_id ?? ''))
      const definition = definitions.get(String(ref.definition_id ?? instance?.definition_id ?? ''))
      if (ref.system_model_id !== model.id) missing.add(`system:${ref.system_model_id}`)
      else if (ref.instance_id && !instance) missing.add(`instance:${ref.instance_id}`)
      else if (ref.definition_id && !definition) missing.add(`definition:${ref.definition_id}`)
      else if (ref.function_id && !definition?.functions.some(item => item.id === ref.function_id)) missing.add(`function:${ref.function_id}`)
      else if (ref.failure_mode_id && !definition?.failure_modes.some(item => item.id === ref.failure_mode_id)) missing.add(`failure:${ref.failure_mode_id}`)
      else if (ref.interface_id && !model.interfaces.some(item => item.id === ref.interface_id)) missing.add(`interface:${ref.interface_id}`)
    }
    for (const [key, child] of Object.entries(source)) if (!['result', 'results', 'resultProvenance', 'canonicalDependencies'].includes(key)) visit(child)
  }
  visit(value)
  return [...missing]
}
