import { createFmeaFailureChain } from './fmeaDefaults'
import type {
  AIAGVDAFMEAAnalysis, FMEABlockDiagramNode, FMEAFailureChain, FMEAFunction,
  FMEAInterface, FMEAStructureNode, FmeaSystemBinding,
} from '../api/reliabilityProgram'
import type {
  CanonicalSystemRef, SystemBlockDefinition, SystemBlockInstance,
  SystemDefinitionModel, SystemEndpoint, SystemInterface,
} from '../api/systemDefinition'
import { upsertInstalledFunction } from './functionResourceFlows'
import { architectureDependencyScope, effectiveSystemFunctions } from './systemArchitecture'
import { defaultHierarchyDiagramNodes } from '../components/SystemDefinition/diagramProjection'
import { sha256FtaText } from '../components/FaultTree/libraryModel'
import { reparentSystemInstance } from '../components/SystemDefinition/structureEditing'
import { validateProjectSystem } from './sharedSystemModel'
import { populateFmeaInterfaceFunctions, populateSystemInterfaceFunctions } from './interfaceFunctions'
import { sharedFmeaRequirements, splitFmeaRequirements } from './sharedRequirementViews'

export type { FmeaSystemBinding } from '../api/reliabilityProgram'
export interface FmeaBindingIssue {
  code: string; message: string; structureNodeId?: string; instanceId?: string; recordId?: string
}
type Analysis = AIAGVDAFMEAAnalysis & { system_binding?: FmeaSystemBinding }
const EMPTY_PROTECTED_IDS: ReadonlySet<string> = new Set()
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const key = (instance: string, entity: string) => JSON.stringify([instance, entity])
const referenceIdentity = (ref?: CanonicalSystemRef) => ref && JSON.stringify([
  ref.system_model_id, ref.instance_id, ref.definition_id, ref.function_id, ref.failure_mode_id, ref.interface_id,
])
const applicable = (ids: string[] | undefined, mode?: string) => !mode || !ids?.length || ids.includes(mode)
const nameOf = (model: SystemDefinitionModel, instance: SystemBlockInstance) => instance.name
  || model.definitions.find(item => item.id === instance.definition_id)?.name || instance.id

/** Working references retain their targets when scope narrows; controlled history is immutable context only. */
export function collectFmeaProtectedEntityIds(state: unknown, failureFlow?: unknown): Set<string> {
  const ids = new Set<string>()
  const historical = new Set(['result', 'results', 'resultProvenance', 'canonicalDependencies',
    'revisions', 'releases', 'snapshot', 'engineering_snapshot', 'engineeringSnapshot', 'analysis_summary'])
  const analysisFields = new Set(['structure_nodes', 'functions', 'failure_chains', 'interfaces', 'block_diagram'])
  const visit = (value: unknown, field = '') => {
    if (historical.has(field)) return
    if (typeof value === 'string') { if (value) ids.add(value); return }
    if (Array.isArray(value)) { value.forEach(item => visit(item)); return }
    if (!value || typeof value !== 'object') return
    const object = value as Record<string, unknown>
    const isAnalysis = Array.isArray(object.structure_nodes) && Array.isArray(object.functions)
    for (const [key, child] of Object.entries(object)) {
      if (isAnalysis && analysisFields.has(key)) continue
      if (isAnalysis && key === 'function_links' && Array.isArray(child)) {
        // Generated source links are scaffolding, not authored evidence.
        visit(child.filter(item => !String((item as { id?: string })?.id ?? '').startsWith('SD-FLINK-')))
      } else visit(child, key)
    }
  }
  visit(state); visit(failureFlow)
  return ids
}

/** Geometry and source bookkeeping are presentation/provenance; identity and boundary membership are engineering inputs. */
export function fmeaEngineeringInputs(analyses: Analysis[]): unknown[] {
  const project = (value: unknown, field = ''): unknown => {
    if (Array.isArray(value)) return value.map(item => project(item))
    if (!value || typeof value !== 'object') return value
    const object = value as Record<string, unknown>
    if (field === 'block_diagram') return {
      version: object.version,
      nodes: (Array.isArray(object.nodes) ? object.nodes : []).map(node => {
        const block = node as Record<string, unknown>
        return project(Object.fromEntries(['id', 'kind', 'structure_node_id', 'container_parent_block_id',
          'label', 'external_kind', 'inside_boundary', 'ports'].filter(key => block[key] !== undefined).map(key => [key, block[key]])))
      }).sort((a, b) => {
        const left = String((a as { id?: string }).id), right = String((b as { id?: string }).id)
        return left < right ? -1 : left > right ? 1 : 0
      }),
    }
    const ignored = field === 'source_ref' ? new Set(['source_checksum', 'imported_at', 'analysis_name', 'source_name'])
      : field === 'system_definition_ref' ? new Set(['revision', 'checksum']) : new Set<string>()
    return Object.fromEntries(Object.keys(object).sort().filter(key => !ignored.has(key) && object[key] !== undefined)
      .map(key => [key, project(object[key], key)]))
  }
  return analyses.map(analysis => {
    const resources = new Set([...analysis.functions.flatMap(fn => fn.definition?.io.map(io => io.resource_id) ?? []),
      ...analysis.interfaces.flatMap(edge => edge.transfers?.flatMap(transfer => transfer.kind === 'flow' ? [transfer.resource_id] : []) ?? [])])
    return project({ ...analysis, resources: analysis.resources?.filter(resource => resources.has(resource.id)) })
  })
}

export function fmeaEngineeringFingerprint(analyses: Analysis[]): string {
  return sha256FtaText(JSON.stringify(fmeaEngineeringInputs(analyses)))
}

export function canonicalInstanceId(node: FMEAStructureNode, modelId?: string): string | undefined {
  const canonical = node.system_definition_ref
  if (canonical?.instance_id && (!modelId || canonical.system_model_id === modelId)) return canonical.instance_id
  return undefined
}

/** Only explicit source identities establish a binding; names and ID prefixes are not proof. */
export function canonicalFmeaBinding(model: SystemDefinitionModel, analysis: Analysis): FmeaSystemBinding | undefined {
  return analysis.system_binding
}

export function fmeaScopeInstanceIds(model: SystemDefinitionModel, analysis: Analysis): Set<string> {
  const binding = canonicalFmeaBinding(model, analysis)
  if (!binding || binding.system_model_id !== model.id) return new Set()
  const ids = new Set<string>()
  // Process steps may share equipment. Their references provide physical context,
  // never a replacement process hierarchy or an implicit whole-system study.
  if (analysis.kind === 'pfmea') {
    for (const node of analysis.structure_nodes ?? []) {
      const id = canonicalInstanceId(node, model.id)
      if (id) ids.add(id)
    }
    for (const item of [...analysis.functions ?? [], ...analysis.failure_chains ?? [], ...analysis.interfaces ?? []]) {
      const ref = item.system_definition_ref
      if (ref?.system_model_id !== model.id) continue
      if (ref.instance_id) ids.add(ref.instance_id)
      const edge = ref.interface_id && model.interfaces.find(value => value.id === ref.interface_id)
      if (edge) for (const endpoint of [edge.source, edge.target]) if (endpoint.instance_id) ids.add(endpoint.instance_id)
    }
    return ids
  }
  return architectureDependencyScope(model, { scopeInstanceId: binding.scope_instance_id,
    modeId: binding.mode_id, includedPiecePartIds: binding.included_piece_part_ids }).scopeInstanceIds
}

function scopeContext(model: SystemDefinitionModel, analysis: Analysis) {
  const binding = canonicalFmeaBinding(model, analysis), scope = fmeaScopeInstanceIds(model, analysis)
  const dependencies = architectureDependencyScope(model, { scopeInstanceId: binding?.scope_instance_id,
    modeId: binding?.mode_id, includedPiecePartIds: binding?.included_piece_part_ids })
  const instances = new Set(dependencies.instanceIds), externals = new Set<string>(dependencies.externalIds)
  const explicitInterfaces = new Set(analysis.kind === 'pfmea' ? (analysis.interfaces ?? [])
    .filter(item => item.system_definition_ref?.system_model_id === model.id).map(item => item.system_definition_ref?.interface_id) : [])
  const interfaces = model.interfaces.filter(item => applicable(item.mode_ids, binding?.mode_id)
    && (explicitInterfaces.has(item.id) || (item.source.instance_id && scope.has(item.source.instance_id)) || (item.target.instance_id && scope.has(item.target.instance_id))))
  for (const item of interfaces) for (const endpoint of [item.source, item.target]) {
    if (endpoint.instance_id) instances.add(endpoint.instance_id)
    if (endpoint.external_id) externals.add(endpoint.external_id)
  }
  const byId = new Map(model.instances.map(item => [item.id, item]))
  for (const id of [...instances]) {
    const seen = new Set<string>(); let parent = byId.get(id)?.parent_instance_id
    while (parent && !seen.has(parent)) { seen.add(parent); instances.add(parent); parent = byId.get(parent)?.parent_instance_id }
  }
  return { binding, scope, instances, interfaces, externals, dependencies }
}

function effectiveFunctions(model: SystemDefinitionModel, instance: SystemBlockInstance, mode?: string) {
  return effectiveSystemFunctions(model, instance.id, mode)
}

function effectiveFailures(model: SystemDefinitionModel, instance: SystemBlockInstance, mode?: string) {
  const definition = model.definitions.find(item => item.id === instance.definition_id)
  const functions = new Set(effectiveFunctions(model, instance, mode).map(fn => fn.id))
  return (definition?.failure_modes ?? []).flatMap(failure => {
    const override = instance.failure_mode_overrides.find(item => item.failure_mode_id === failure.id)
    const { failure_mode_id: _identity, enabled: _enabled, ...optional } = override ?? {}
    const values = Object.fromEntries(Object.entries(optional).filter(([, value]) => value != null))
    const result = { ...failure, ...values }
    return (override?.enabled ?? failure.default_enabled ?? true) === false || !functions.has(result.function_id) || !applicable(result.mode_ids, mode) ? [] : [result]
  })
}

/** A source fingerprint includes only this study's engineering scope, never layout or unrelated revision strings. */
export function fmeaSemanticFingerprint(model: SystemDefinitionModel, analyses: Analysis[]): string {
  return sha256FtaText(JSON.stringify(analyses.map(analysis => {
    const context = scopeContext(model, analysis)
    if (!context.binding) return { id: analysis.id, binding: null }
    const instances = model.instances.filter(item => context.instances.has(item.id))
    return { id: analysis.id, binding: context.binding,
      requirements: sharedFmeaRequirements(model, analysis),
      instances: instances.map(item => ({ id: item.id, definition_id: item.definition_id,
        parent_instance_id: item.parent_instance_id, name: nameOf(model, item), quantity: item.quantity,
        reference_designators: item.reference_designators, mode_ids: item.mode_ids,
        functions: effectiveFunctions(model, item, context.binding?.mode_id).filter(fn => context.dependencies.functionKeys.has(key(item.id, fn.id))),
        failures: context.scope.has(item.id) ? effectiveFailures(model, item, context.binding?.mode_id) : [],
        definition: (() => { const definition = model.definitions.find(def => def.id === item.definition_id)
          return definition && { description: definition.description, kind: definition.kind, classification: definition.classification,
            part_number: definition.part_number, manufacturer: definition.manufacturer, category: definition.category, ports: definition.ports }
        })() })),
      interfaces: context.interfaces,
      externals: model.externals.filter(item => context.externals.has(item.id)),
      resources: model.resources.filter(item => context.dependencies.resourceIds.has(item.id)),
      links: model.function_links.filter(item => context.dependencies.functionKeys.has(key(item.source.instance_id, item.source.function_id))
        && context.dependencies.functionKeys.has(key(item.target.instance_id, item.target.function_id)) && applicable(item.mode_ids, context.binding?.mode_id)),
    }
  })))
}

export function inspectFmeaBinding(model: SystemDefinitionModel, analysis: Analysis): FmeaBindingIssue[] {
  const binding = canonicalFmeaBinding(model, analysis), issues: FmeaBindingIssue[] = []
  if (!binding) {
    if (analysis.kind !== 'pfmea' && analysis.structure_nodes?.length) issues.push({ code: 'unbound_structure',
      message: 'Map this existing structure to the project System Model before enabling live system modeling.' })
    return issues
  }
  if (binding.system_model_id !== model.id) return [{ code: 'missing_system', message: 'This FMEA is bound to a different System Model.' }]
  if (binding.mode_id && !model.modes.some(mode => mode.id === binding.mode_id)) issues.push({ code: 'missing_mode',
    message: 'The selected system operating mode no longer exists. Choose an existing mode.' })
  const context = scopeContext(model, analysis)
  if (analysis.kind !== 'pfmea' && !context.scope.size) issues.push({ code: 'missing_scope', instanceId: binding.scope_instance_id,
    message: 'The FMEA scope no longer exists. Select an existing system element.' })
  const mapped = new Set<string>()
  for (const node of analysis.structure_nodes ?? []) {
    const referencedModel = node.system_definition_ref?.system_model_id
      ?? (node.source_ref?.module === 'system_definition' ? node.source_ref.analysis_id : undefined)
    if (referencedModel && referencedModel !== model.id) {
      issues.push({ code: 'missing_system', structureNodeId: node.id, message: `The system reference for “${node.name || node.id}” belongs to another System Model.` })
      continue
    }
    const id = canonicalInstanceId(node, model.id)
    if (!id) {
      if (analysis.kind !== 'pfmea') issues.push({ code: 'unmapped_structure', structureNodeId: node.id,
        message: `Map “${node.name || node.id}” to a system element or explicitly create it in the System Model.` })
      continue
    }
    if (analysis.kind !== 'pfmea' && mapped.has(id)) issues.push({ code: 'duplicate_mapping', structureNodeId: node.id, instanceId: id,
      message: 'Two structure rows map to the same installed system element.' })
    mapped.add(id)
    if (!model.instances.some(item => item.id === id)) issues.push({ code: 'missing_instance', structureNodeId: node.id, instanceId: id,
      message: `The system element for “${node.name || node.id}” was deleted. Its FMEA work is retained for reconciliation.` })
    else if (!context.instances.has(id) && analysis.kind !== 'pfmea') issues.push({ code: 'outside_scope', structureNodeId: node.id, instanceId: id,
      message: `“${node.name || node.id}” is outside the current scope. Review its retained FMEA annotations.` })
  }
  for (const item of [...analysis.functions ?? [], ...analysis.failure_chains ?? [], ...analysis.interfaces ?? []]) {
    const ref = item.system_definition_ref
    if (!ref) continue
    const instance = model.instances.find(value => value.id === ref.instance_id)
    const missing = ref.system_model_id !== model.id || (ref.instance_id && !instance)
      || (ref.function_id && (!instance || !effectiveFunctions(model, instance, binding.mode_id).some(fn => fn.id === ref.function_id)))
      || (ref.failure_mode_id && (!instance || !effectiveFailures(model, instance, binding.mode_id).some(failure => failure.id === ref.failure_mode_id)))
      || (ref.interface_id && !model.interfaces.some(edge => edge.id === ref.interface_id && applicable(edge.mode_ids, binding.mode_id)))
    if (missing) issues.push({ code: 'unavailable_reference', instanceId: ref.instance_id, recordId: item.id,
      message: `A canonical source for FMEA record ${item.id} was deleted, disabled or made inapplicable. Review its retained annotations.` })
    else if (analysis.kind !== 'pfmea' && ref.instance_id && !context.instances.has(ref.instance_id))
      issues.push({ code: 'outside_scope', instanceId: ref.instance_id,
        message: `FMEA record ${item.id} retains authored work outside the study scope. Reconcile it before analyzing the narrower scope.` })
  }
  if (analysis.kind !== 'pfmea') for (const [kind, records] of [['function', analysis.functions ?? []], ['interface', analysis.interfaces ?? []]] as const) {
    const identities = new Set<string>()
    for (const item of records) {
      const ref = item.system_definition_ref
      const identity = ref && JSON.stringify(kind === 'function'
        ? [ref.system_model_id, ref.instance_id, ref.function_id] : [ref.system_model_id, ref.interface_id])
      if (!identity) continue
      if (identities.has(identity)) issues.push({ code: `duplicate_${kind}_mapping`,
        message: `More than one authored ${kind} record references the same canonical source. Reconcile the records without discarding their annotations.` })
      identities.add(identity)
    }
  }
  return issues
}

function sourceRef(model: SystemDefinitionModel, instance: SystemBlockInstance, checksum: string, previous?: FMEAStructureNode) {
  const definition = model.definitions.find(item => item.id === instance.definition_id)!
  return { ...previous?.source_ref, module: 'system_definition' as const, analysis_id: model.id,
    analysis_name: model.name, entity_id: instance.id, source_name: nameOf(model, instance),
    parent_entity_id: instance.parent_instance_id, entity_type: definition.kind === 'piece_part' ? 'part' as const
      : instance.parent_instance_id ? 'block' as const : 'system' as const,
    imported_at: previous?.source_ref?.imported_at || 'live', source_checksum: checksum,
    reference_designators: [...instance.reference_designators], quantity: instance.quantity,
    part_number: definition.part_number || undefined, manufacturer: definition.manufacturer || undefined,
    category: definition.category || undefined }
}

function canonicalRef(model: SystemDefinitionModel, instance?: SystemBlockInstance, extra: Partial<CanonicalSystemRef> = {}): CanonicalSystemRef {
  return { system_model_id: model.id, ...(instance ? { instance_id: instance.id, definition_id: instance.definition_id } : {}), ...extra }
}

function externalBlockIdentities(model: SystemDefinitionModel, analysis: Analysis): Map<string, string> {
  const ids = new Map<string, string>()
  for (const node of analysis.block_diagram.nodes) if (node.kind === 'external' && node.id.startsWith('SD-EXT-')
    && model.externals.some(item => item.id === node.id.slice(7))) ids.set(node.id, node.id.slice(7))
  for (const edge of analysis.interfaces) {
    const original = model.interfaces.find(item => edge.system_definition_ref?.system_model_id === model.id && edge.system_definition_ref.interface_id === item.id)
    if (!original) continue
    for (const side of ['source', 'target'] as const) if (original[side].external_id && edge[`${side}_block_id`])
      ids.set(edge[`${side}_block_id`]!, original[side].external_id!)
  }
  return ids
}

function blankChain(id: string, kind: Analysis['kind'] = 'dfmea'): FMEAFailureChain {
  return { ...createFmeaFailureChain(kind, id), effect_level: 'local function',
    remarks: 'Canonical failure mode; review effects, causes, ratings and controls.' }
}

function uniqueId(base: string, occupied: Set<string>): string {
  const seed = base.length > 112 ? `${base.slice(0, 92)}-${sha256FtaText(base).slice(0, 16)}` : base
  let id = seed, suffix = 2
  while (occupied.has(id)) id = `${seed}-${suffix++}`
  occupied.add(id); return id
}

/** Reconciliation keeps the user's row identity and redirects generated context to it. */
function coalesceMappedStructures(model: SystemDefinitionModel, analysis: Analysis, protectedIds: ReadonlySet<string>): void {
  const groups = new Map<string, FMEAStructureNode[]>()
  for (const node of analysis.structure_nodes) {
    const id = canonicalInstanceId(node, model.id)
    if (id) groups.set(id, [...groups.get(id) ?? [], node])
  }
  const aliases = new Map<string, string>()
  for (const [instanceId, nodes] of groups) if (nodes.length === 2 && nodes.some(node => node.id === `SD-${instanceId}`)) {
    const generated = nodes.find(node => node.id === `SD-${instanceId}`)!
    if (generated.interface || protectedIds.has(generated.id)) continue
    const preferred = nodes.find(node => node.id !== `SD-${instanceId}`)!
    for (const node of nodes) if (node !== preferred) aliases.set(node.id, preferred.id)
  }
  if (!aliases.size) return
  const resolve = (id?: string) => id ? aliases.get(id) ?? id : undefined
  analysis.structure_nodes = analysis.structure_nodes.filter(node => !aliases.has(node.id))
    .map(node => ({ ...node, parent_id: resolve(node.parent_id) }))
  analysis.functions = analysis.functions.map(fn => ({ ...fn, structure_node_id: resolve(fn.structure_node_id)! }))
  analysis.failure_chains = analysis.failure_chains.map(chain => ({ ...chain,
    cause_structure_node_id: resolve(chain.cause_structure_node_id), effect_level_id: resolve(chain.effect_level_id) }))
  const blockAliases = new Map<string, string>()
  for (const node of analysis.block_diagram.nodes) if (node.structure_node_id && aliases.has(node.structure_node_id)) {
    const preferred = analysis.block_diagram.nodes.find(item => item.structure_node_id === resolve(node.structure_node_id))
    if (preferred) blockAliases.set(node.id, preferred.id)
  }
  analysis.block_diagram.nodes = analysis.block_diagram.nodes.filter(node => !blockAliases.has(node.id)).map(node => ({ ...node,
    structure_node_id: resolve(node.structure_node_id),
    container_parent_block_id: blockAliases.get(node.container_parent_block_id ?? '') ?? node.container_parent_block_id }))
  analysis.interfaces = analysis.interfaces.map(edge => ({ ...edge,
    source_structure_node_id: resolve(edge.source_structure_node_id), target_structure_node_id: resolve(edge.target_structure_node_id),
    source_block_id: blockAliases.get(edge.source_block_id ?? '') ?? edge.source_block_id,
    target_block_id: blockAliases.get(edge.target_block_id ?? '') ?? edge.target_block_id }))
}

function coalesceMappedEntities(model: SystemDefinitionModel, analysis: Analysis, protectedIds: ReadonlySet<string>): void {
  const functionGroups = new Map<string, FMEAFunction[]>()
  for (const fn of analysis.functions) {
    const ref = fn.system_definition_ref
    if (ref?.system_model_id === model.id && ref.instance_id && ref.function_id) {
      const id = key(ref.instance_id, ref.function_id)
      functionGroups.set(id, [...functionGroups.get(id) ?? [], fn])
    }
  }
  const aliases = new Map<string, string>()
  for (const group of functionGroups.values()) if (group.length === 2) {
    const ref = group[0].system_definition_ref!, generatedId = `SD-FN-${ref.instance_id}-${ref.function_id}`
    const generated = group.find(item => item.id === generatedId), retained = group.find(item => item.id !== generatedId)
    if (generated && retained && !generated.owner && !generated.notes && !protectedIds.has(generated.id)) aliases.set(generated.id, retained.id)
  }
  const resolve = (id?: string) => id ? aliases.get(id) ?? id : undefined
  if (aliases.size) {
    analysis.functions = analysis.functions.filter(item => !aliases.has(item.id))
    analysis.failure_chains = analysis.failure_chains.map(item => ({ ...item, function_id: resolve(item.function_id),
      effect_function_id: resolve(item.effect_function_id), cause_function_id: resolve(item.cause_function_id) }))
    analysis.function_links = analysis.function_links.map(item => ({ ...item,
      source_function_id: resolve(item.source_function_id)!, target_function_id: resolve(item.target_function_id)! }))
    analysis.function_requirement_links = analysis.function_requirement_links.map(item => ({ ...item, function_id: resolve(item.function_id)! }))
    analysis.p_diagrams = analysis.p_diagrams.map(item => ({ ...item, primary_function_id: resolve(item.primary_function_id)!,
      supporting_function_ids: [...new Set(item.supporting_function_ids.map(id => resolve(id)!))] }))
    analysis.interfaces = analysis.interfaces.map(item => ({ ...item, function_ids: [...new Set(item.function_ids.map(id => resolve(id)!))] }))
  }
  const interfaceGroups = new Map<string, FMEAInterface[]>()
  for (const edge of analysis.interfaces) {
    const ref = edge.system_definition_ref
    if (ref?.system_model_id === model.id && ref.interface_id)
      interfaceGroups.set(ref.interface_id, [...interfaceGroups.get(ref.interface_id) ?? [], edge])
  }
  const drop = new Set<string>()
  for (const [canonicalId, group] of interfaceGroups) if (group.length === 2) {
    const generated = group.find(item => item.id === `SD-IF-${canonicalId}`)
    if (generated && group.some(item => item !== generated) && !generated.requirement_ids.length
      && generated.relationship_nature === 'unspecified' && !protectedIds.has(generated.id)) drop.add(generated.id)
  }
  analysis.interfaces = analysis.interfaces.filter(item => !drop.has(item.id))
}

function pristineChain(chain: FMEAFailureChain): boolean {
  if (!chain.id.startsWith('SD-FM-') || !chain.system_definition_ref) return false
  const baseline = blankChain(chain.id, chain.frequency !== undefined ? 'fmea_msr' : 'dfmea')
  const ignore = new Set(['function_id', 'failure_mode', 'deviation_id', 'system_definition_ref', 'remarks'])
  return Object.entries(chain).every(([field, value]) => ignore.has(field)
    || equal(value, baseline[field as keyof FMEAFailureChain]) || value === undefined || value === '')
}

/** Only generated scaffolding may disappear when scope narrows; authored analysis work is retained. */
function pruneUnannotatedContext(model: SystemDefinitionModel, analysis: Analysis, context: ReturnType<typeof scopeContext>,
  protectedIds: ReadonlySet<string>): void {
  if (analysis.kind === 'pfmea') return
  const effectiveByInstance = new Map(model.instances.filter(instance => context.instances.has(instance.id))
    .map(instance => [instance.id, new Set(effectiveFunctions(model, instance, context.binding?.mode_id).map(fn => fn.id))]))
  const retainedFunctions = new Set<string>()
  const retainedStructures = new Set<string>()
  for (const chain of analysis.failure_chains) if (protectedIds.has(chain.id) || !pristineChain(chain)) {
    for (const id of [chain.function_id, chain.effect_function_id, chain.cause_function_id]) if (id) retainedFunctions.add(id)
    for (const id of [chain.cause_structure_node_id, chain.effect_level_id]) if (id) retainedStructures.add(id)
    if (chain.system_definition_ref?.instance_id) for (const node of analysis.structure_nodes)
      if (canonicalInstanceId(node, model.id) === chain.system_definition_ref.instance_id) retainedStructures.add(node.id)
  }
  for (const node of analysis.block_diagram.nodes) if (protectedIds.has(node.id) && node.structure_node_id)
    retainedStructures.add(node.structure_node_id)
  for (const edge of analysis.interfaces) if (protectedIds.has(edge.id) || !edge.system_definition_ref
    || !edge.id.startsWith('SD-IF-') || edge.requirement_ids.length || edge.relationship_nature !== 'unspecified') {
    edge.function_ids.forEach(id => retainedFunctions.add(id))
    for (const id of [edge.source_structure_node_id, edge.target_structure_node_id]) if (id) retainedStructures.add(id)
  }
  for (const fn of analysis.functions) {
    const ref = fn.system_definition_ref
    if (protectedIds.has(fn.id) || !ref || !fn.id.startsWith('SD-FN-') || fn.owner || fn.notes
      || analysis.function_requirement_links.some(link => link.function_id === fn.id)
      || analysis.p_diagrams.some(diagram => diagram.primary_function_id === fn.id || diagram.supporting_function_ids.includes(fn.id))
      || analysis.failure_chains.some(chain => chain.function_id === fn.id && !pristineChain(chain))
      || analysis.function_links.some(link => !link.id.startsWith('SD-FLINK-') && (link.source_function_id === fn.id || link.target_function_id === fn.id)))
      retainedFunctions.add(fn.id)
  }
  const droppedFunctions = new Set(analysis.functions.filter(fn => fn.system_definition_ref?.system_model_id === model.id
    && fn.system_definition_ref.instance_id && (!context.dependencies.functionKeys.has(key(fn.system_definition_ref.instance_id, fn.system_definition_ref.function_id ?? ''))
      || (context.binding?.mode_id && model.instances.some(instance => instance.id === fn.system_definition_ref?.instance_id)
        && !effectiveByInstance.get(fn.system_definition_ref.instance_id)?.has(fn.system_definition_ref.function_id ?? '')))
    && !retainedFunctions.has(fn.id)).map(fn => fn.id))
  analysis.functions = analysis.functions.filter(fn => !droppedFunctions.has(fn.id))
  analysis.failure_chains = analysis.failure_chains.filter(chain => protectedIds.has(chain.id)
    || !chain.function_id || !droppedFunctions.has(chain.function_id) || !pristineChain(chain))
  if (context.binding?.mode_id) analysis.failure_chains = analysis.failure_chains.filter(chain => {
    const ref = chain.system_definition_ref, instance = model.instances.find(item => item.id === ref?.instance_id)
    return protectedIds.has(chain.id) || !instance || !ref?.failure_mode_id || !pristineChain(chain)
      || effectiveFailures(model, instance, context.binding?.mode_id).some(failure => failure.id === ref.failure_mode_id)
  })
  analysis.function_links = analysis.function_links.filter(link => !link.id.startsWith('SD-FLINK-')
    || (!droppedFunctions.has(link.source_function_id) && !droppedFunctions.has(link.target_function_id)))
  const incidentInterfaces = new Set(context.interfaces.map(item => item.id))
  analysis.interfaces = analysis.interfaces.filter(edge => protectedIds.has(edge.id) || !edge.system_definition_ref?.interface_id
    || incidentInterfaces.has(edge.system_definition_ref.interface_id) || !model.interfaces.some(item => item.id === edge.system_definition_ref?.interface_id)
    || !edge.id.startsWith('SD-IF-') || edge.requirement_ids.length || edge.relationship_nature !== 'unspecified')
  const droppedStructures = new Set(analysis.structure_nodes.filter(node => {
    const id = canonicalInstanceId(node, model.id)
    return id && !protectedIds.has(node.id) && !retainedStructures.has(node.id)
      && model.instances.some(item => item.id === id) && !context.instances.has(id)
      && node.id === `SD-${id}` && !node.interface
      && !analysis.functions.some(fn => fn.structure_node_id === node.id)
      && !analysis.interfaces.some(edge => edge.source_structure_node_id === node.id || edge.target_structure_node_id === node.id)
  }).map(node => node.id))
  const structuresById = new Map(analysis.structure_nodes.map(node => [node.id, node]))
  for (const node of analysis.structure_nodes.filter(item => !droppedStructures.has(item.id))) {
    const seen = new Set<string>(); let parent = node.parent_id
    while (parent && !seen.has(parent)) { seen.add(parent); droppedStructures.delete(parent); parent = structuresById.get(parent)?.parent_id }
  }
  analysis.structure_nodes = analysis.structure_nodes.filter(node => !droppedStructures.has(node.id))
  analysis.block_diagram.nodes = analysis.block_diagram.nodes.filter(node => !node.structure_node_id || !droppedStructures.has(node.structure_node_id))
}

/** Refresh source-owned fields while preserving FMEA identities and risk/governance annotations. */
export function materializeFmeaAnalysis(model: SystemDefinitionModel, source: Analysis,
  protectedIds: ReadonlySet<string> = EMPTY_PROTECTED_IDS): Analysis {
  // PFMEA owns its process graph. Equipment links are references, and editing the
  // separate physical-system diagram uses a dedicated DFMEA-shaped projection.
  if (source.kind === 'pfmea') return source
  const binding = canonicalFmeaBinding(model, source)
  if (!binding || binding.system_model_id !== model.id || !model.instances.some(item => item.id === binding.scope_instance_id)) return source
  const analysis = structuredClone({ ...source, structure_nodes: source.structure_nodes ?? [], functions: source.functions ?? [],
    failure_chains: source.failure_chains ?? [], interfaces: source.interfaces ?? [], function_links: source.function_links ?? [],
    function_requirement_links: source.function_requirement_links ?? [], functional_requirements: sharedFmeaRequirements(model, source),
    p_diagrams: source.p_diagrams ?? [], control_plan: source.control_plan ?? [],
    block_diagram: source.block_diagram ?? { version: 2, density: 'comfortable', boundary: { label: source.name, x: -40, y: -40, width: 1200, height: 700 },
      nodes: [], viewport: { x: 0, y: 0, zoom: 1 }, snap_to_grid: true },
  }), context = scopeContext(model, source)
  analysis.system_binding = { ...binding }
  coalesceMappedStructures(model, analysis, protectedIds)
  coalesceMappedEntities(model, analysis, protectedIds)
  pruneUnannotatedContext(model, analysis, context, protectedIds)
  const checksum = fmeaSemanticFingerprint(model, [analysis])
  const structures = new Map(analysis.structure_nodes.flatMap(item => {
    const id = canonicalInstanceId(item, model.id); return id ? [[id, item] as const] : []
  }))
  const structureIds = new Set(analysis.structure_nodes.map(item => item.id))
  const physicalInstances = model.instances.filter(item => context.instances.has(item.id)
    && (analysis.kind !== 'pfmea' || structures.has(item.id)))
  for (const instance of physicalInstances) if (!structures.has(instance.id)) {
    structures.set(instance.id, { id: uniqueId(`SD-${instance.id}`, structureIds), name: '', level: '', description: '', interface: '' })
  }
  const refreshed = physicalInstances.map(instance => {
    const previous = structures.get(instance.id)!, definition = model.definitions.find(item => item.id === instance.definition_id)!
    const value = { ...previous, name: nameOf(model, instance), level: definition.kind ?? definition.classification,
      parent_id: analysis.kind === 'pfmea' ? previous.parent_id : structures.get(instance.parent_instance_id ?? '')?.id,
      description: definition.description, element_type: 'canonical_instance', source_ref: sourceRef(model, instance, checksum, previous),
      system_definition_ref: canonicalRef(model, instance) }
    structures.set(instance.id, value); return value
  })
  // Retain unmapped, deleted and formerly scoped records until the user reconciles their work.
  const refreshedIds = new Set(refreshed.map(item => item.id))
  analysis.structure_nodes = [...refreshed, ...analysis.structure_nodes.filter(item => !refreshedIds.has(item.id))]

  const functions = new Map<string, FMEAFunction>()
  for (const item of analysis.functions) { const ref = item.system_definition_ref
    if (ref?.system_model_id === model.id && ref.instance_id && ref.function_id && !functions.has(key(ref.instance_id, ref.function_id)))
      functions.set(key(ref.instance_id, ref.function_id), item) }
  const functionIds = new Set(analysis.functions.map(item => item.id))
  const chains = new Map<string, FMEAFailureChain[]>()
  for (const item of analysis.failure_chains) { const ref = item.system_definition_ref
    if (ref?.system_model_id === model.id && ref.instance_id && ref.failure_mode_id) {
      const identity = key(ref.instance_id, ref.failure_mode_id); chains.set(identity, [...chains.get(identity) ?? [], item])
    } }
  const chainIds = new Set(analysis.failure_chains.map(item => item.id))
  for (const instance of physicalInstances) {
    for (const fn of effectiveFunctions(model, instance, binding.mode_id).filter(fn => context.dependencies.functionKeys.has(key(instance.id, fn.id)))) {
      const identity = key(instance.id, fn.id), existing = functions.get(identity)
      if (analysis.kind === 'pfmea' && !existing) continue
      const value: FMEAFunction = { owner: '', notes: '', ...existing,
        id: existing?.id ?? uniqueId(`SD-FN-${instance.id}-${fn.id}`, functionIds),
        structure_node_id: structures.get(instance.id)!.id, description: fn.description,
        canonical_verb_id: fn.canonical_verb_id, function_type: fn.function_type, operating_modes: [...fn.mode_ids],
        definition: fn.definition ? structuredClone(fn.definition) : undefined,
        system_definition_ref: canonicalRef(model, instance, { function_id: fn.id }) }
      functions.set(identity, value)
      const at = analysis.functions.findIndex(item => item.id === value.id)
      if (at < 0) analysis.functions.push(value); else analysis.functions[at] = value
      // Authored duplicate mappings require reconciliation, but both rows still
      // display the actual source semantics without losing their own annotations.
      analysis.functions = analysis.functions.map(item => item.id !== value.id
        && item.system_definition_ref?.system_model_id === model.id && item.system_definition_ref.instance_id === instance.id
        && item.system_definition_ref.function_id === fn.id ? { ...item,
          structure_node_id: value.structure_node_id, description: value.description, canonical_verb_id: value.canonical_verb_id,
          definition: value.definition, function_type: value.function_type, operating_modes: value.operating_modes, system_definition_ref: value.system_definition_ref } : item)
    }
    for (const failure of context.scope.has(instance.id) ? effectiveFailures(model, instance, binding.mode_id) : []) {
      const fn = functions.get(key(instance.id, failure.function_id)); if (!fn) continue
      const existing = chains.get(key(instance.id, failure.id))
      if (analysis.kind === 'pfmea' && !existing) continue
      for (const previous of existing ?? [blankChain(uniqueId(`SD-FM-${instance.id}-${failure.id}`, chainIds), analysis.kind)]) {
        const value = { ...previous, function_id: fn.id, failure_mode: failure.description, deviation_id: failure.deviation_id,
          system_definition_ref: canonicalRef(model, instance, { function_id: failure.function_id, failure_mode_id: failure.id }) }
        const at = analysis.failure_chains.findIndex(item => item.id === value.id)
        if (at < 0) analysis.failure_chains.push(value); else analysis.failure_chains[at] = value
      }
    }
  }

  analysis.resources = structuredClone(model.resources)
  const diagram = model.diagrams[0], oldNodes = analysis.block_diagram.nodes
  const fallbackNodes = defaultHierarchyDiagramNodes(model)
  const blocks = new Map(oldNodes.filter(item => item.structure_node_id).map(item => [item.structure_node_id!, item]))
  const diagramIds = new Set(oldNodes.map(item => item.id)), instanceBlocks = new Map<string, FMEABlockDiagramNode>()
  physicalInstances.forEach((instance, index) => {
    const structure = structures.get(instance.id)!, previous = blocks.get(structure.id)
    const position = analysis.kind === 'pfmea' ? undefined : diagram?.nodes.find(item => item.instance_id === instance.id) ?? fallbackNodes.find(item => item.instance_id === instance.id)
    instanceBlocks.set(instance.id, { ...previous, id: previous?.id ?? uniqueId(`SD-BLOCK-${instance.id}`, diagramIds),
      kind: 'structure', structure_node_id: structure.id, label: structure.name,
      x: position?.x ?? previous?.x ?? 80 + index % 4 * 230, y: position?.y ?? previous?.y ?? 80 + Math.floor(index / 4) * 150,
      width: position?.width ?? previous?.width ?? 180, height: position?.height ?? previous?.height ?? 72,
      expanded: position?.expanded ?? previous?.expanded ?? false, inside_boundary: true })
  })
  for (const instance of physicalInstances) { const block = instanceBlocks.get(instance.id)!
    if (analysis.kind !== 'pfmea') block.container_parent_block_id = instanceBlocks.get(instance.parent_instance_id ?? '')?.id }
  const externalBlocks = new Map<string, FMEABlockDiagramNode>()
  const previousExternalIds = externalBlockIdentities(model, analysis)
  for (const [index, external] of model.externals.entries()) {
    if (!context.externals.has(external.id) && binding.scope_instance_id !== model.root_instance_id) continue
    const previous = oldNodes.find(item => item.kind === 'external' && previousExternalIds.get(item.id) === external.id)
    if (analysis.kind === 'pfmea' && !previous) continue
    const position = analysis.kind === 'pfmea' ? undefined : diagram?.nodes.find(item => item.external_id === external.id)
    externalBlocks.set(external.id, { ...previous, id: previous?.id ?? uniqueId(`SD-EXT-${external.id}`, diagramIds),
      kind: 'external', label: external.name, external_kind: external.kind, ports: structuredClone(external.ports ?? []), inside_boundary: false,
      x: position?.x ?? previous?.x ?? 1040, y: position?.y ?? previous?.y ?? 80 + index * 110,
      width: position?.width ?? previous?.width ?? 180, height: position?.height ?? previous?.height ?? 72,
      expanded: false })
  }
  const activeBlocks = [...instanceBlocks.values(), ...externalBlocks.values()], activeBlockIds = new Set(activeBlocks.map(item => item.id))
  analysis.block_diagram = { ...analysis.block_diagram,
    connectorStyle: diagram?.connectorStyle ?? analysis.block_diagram.connectorStyle ?? 'curved',
    density: analysis.kind === 'pfmea' ? analysis.block_diagram.density : diagram?.layoutOptions?.mode === 'expanded' ? 'expanded' : diagram?.density === 'compact' ? 'compact'
      : diagram?.density === 'detailed' ? 'spacious' : diagram?.density ? 'comfortable' : analysis.block_diagram.density,
    ...(analysis.kind !== 'pfmea' && diagram?.layoutOptions ? { layoutOptions: diagram.layoutOptions } : {}),
    boundary: analysis.kind !== 'pfmea' && diagram?.boundary ? { ...diagram.boundary } : analysis.block_diagram.boundary,
    snap_to_grid: analysis.kind !== 'pfmea' ? diagram?.snap_to_grid ?? analysis.block_diagram.snap_to_grid : analysis.block_diagram.snap_to_grid,
    // Focus/viewport remains local; geometry and containment are shared.
    nodes: [...activeBlocks, ...oldNodes.filter(item => !activeBlockIds.has(item.id))] }
  const interfaceIds = new Set(analysis.interfaces.map(item => item.id))
  for (const item of context.interfaces) {
    const previous = analysis.interfaces.find(edge => edge.system_definition_ref?.system_model_id === model.id
      && edge.system_definition_ref.interface_id === item.id)
    if (analysis.kind === 'pfmea' && !previous) continue
    const sourceNode = item.source.instance_id ? instanceBlocks.get(item.source.instance_id) : externalBlocks.get(item.source.external_id ?? '')
    const targetNode = item.target.instance_id ? instanceBlocks.get(item.target.instance_id) : externalBlocks.get(item.target.external_id ?? '')
    if (!sourceNode || !targetNode) continue
    const value: FMEAInterface = { requirement_ids: [], relationship_nature: 'unspecified', ...previous,
      id: previous?.id ?? uniqueId(`SD-IF-${item.id}`, interfaceIds), name: item.name, interface_type: item.interface_type,
      source_block_id: sourceNode.id, target_block_id: targetNode.id,
      source_structure_node_id: sourceNode.structure_node_id, target_structure_node_id: targetNode.structure_node_id,
      linkage: item.linkage, directionality: item.directionality,
      relationship_strength: item.strength === 'strong' || item.strength === 'weak' ? item.strength : 'unspecified',
      interface_detail: item.interface_detail, external_source: item.source.external_id ? sourceNode.label : '',
      external_target: item.target.external_id ? targetNode.label : '', flow_description: item.flow_description,
      operating_condition: item.operating_condition, transfers: structuredClone(item.transfers ?? []), mode_ids: [...item.mode_ids],
      ...(item.generated !== undefined ? { generated: item.generated } : {}),
      function_ids: [
        ...item.source_function_ids.map(id => functions.get(key(item.source.instance_id ?? '', id))?.id),
        ...item.target_function_ids.map(id => functions.get(key(item.target.instance_id ?? '', id))?.id),
      ].filter((id): id is string => Boolean(id)), system_definition_ref: canonicalRef(model, undefined, { interface_id: item.id }) }
    const at = analysis.interfaces.findIndex(edge => edge.id === value.id)
    if (at < 0) analysis.interfaces.push(value); else analysis.interfaces[at] = value
    analysis.interfaces = analysis.interfaces.map(edge => edge.id !== value.id
      && edge.system_definition_ref?.system_model_id === model.id && edge.system_definition_ref.interface_id === item.id
      ? { ...value, id: edge.id, requirement_ids: edge.requirement_ids, relationship_nature: edge.relationship_nature,
        source_handle: edge.source_handle, target_handle: edge.target_handle } : edge)
  }
  for (const link of model.function_links.filter(item => applicable(item.mode_ids, binding.mode_id))) {
    const sourceFn = functions.get(key(link.source.instance_id, link.source.function_id)), targetFn = functions.get(key(link.target.instance_id, link.target.function_id))
    if (!sourceFn || !targetFn) continue
    const id = `SD-FLINK-${link.id}`, previous = analysis.function_links.find(item => item.id === id)
    const value = { ...previous, id, source_function_id: sourceFn.id, target_function_id: targetFn.id,
      relationship: link.relationship, label: previous?.label ?? '', rationale: link.rationale, mode_ids: link.mode_ids,
      ...(link.generated !== undefined ? { generated: link.generated } : {}) }
    analysis.function_links = [...analysis.function_links.filter(item => item.id !== id), value]
  }
  return analysis
}

export function bindFmeaAnalysis(model: SystemDefinitionModel, analysis: Analysis, scopeId = model.root_instance_id,
  protectedIds: ReadonlySet<string> = EMPTY_PROTECTED_IDS): Analysis {
  if (!scopeId || !model.instances.some(item => item.id === scopeId)) throw new Error('Choose an existing installed system element for this FMEA.')
  const existing = canonicalFmeaBinding(model, analysis)
  if (existing && existing.system_model_id !== model.id) throw new Error('Reconcile the existing System Model binding before switching systems.')
  return materializeFmeaAnalysis(model, { ...analysis, system_binding: {
    version: 1, system_model_id: model.id, scope_instance_id: scopeId, ...(existing?.mode_id ? { mode_id: existing.mode_id } : {}),
  } }, protectedIds)
}

function replaceInstance(model: SystemDefinitionModel, instance: SystemBlockInstance) {
  model.instances = model.instances.map(item => item.id === instance.id ? instance : item)
}

function patchFunctionOverride(model: SystemDefinitionModel, instanceId: string, functionId: string,
  patch: Partial<SystemBlockInstance['function_overrides'][number]>) {
  const instance = model.instances.find(item => item.id === instanceId)
  if (!instance) throw new Error('The linked system element no longer exists.')
  const previous = instance.function_overrides.find(item => item.function_id === functionId)
  replaceInstance(model, { ...instance, function_overrides: [...instance.function_overrides.filter(item => item.function_id !== functionId),
    { function_id: functionId, enabled: true, ...previous, ...patch }] })
}
function patchFailureOverride(model: SystemDefinitionModel, instanceId: string, failureId: string,
  patch: Partial<SystemBlockInstance['failure_mode_overrides'][number]>) {
  const instance = model.instances.find(item => item.id === instanceId)
  if (!instance) throw new Error('The linked system element no longer exists.')
  const previous = instance.failure_mode_overrides.find(item => item.failure_mode_id === failureId)
  replaceInstance(model, { ...instance, failure_mode_overrides: [...instance.failure_mode_overrides.filter(item => item.failure_mode_id !== failureId),
    { failure_mode_id: failureId, enabled: true, ...previous, ...patch }] })
}

/** Translate an edit of the complete working graph. Records absent from the original view are never deleted. */
export function splitFmeaUpdate(sourceModel: SystemDefinitionModel, before: Analysis, requested: Analysis,
  protectedIds: ReadonlySet<string> = EMPTY_PROTECTED_IDS, moduleKey = 'fmea'): { model: SystemDefinitionModel; analysis: Analysis } {
  if (requested.kind === 'pfmea') return { model: sourceModel, analysis: populateFmeaInterfaceFunctions(requested, before) }
  const binding = canonicalFmeaBinding(sourceModel, requested) ?? canonicalFmeaBinding(sourceModel, before)
  if (!binding) return { model: sourceModel, analysis: populateFmeaInterfaceFunctions(requested, before) }
  if (binding.system_model_id !== sourceModel.id) throw new Error('This FMEA is linked to another System Model.')
  let model = structuredClone(sourceModel)
  const next = structuredClone(requested); next.system_binding = binding
  const beforeBinding = canonicalFmeaBinding(sourceModel, before)
  const scopeChanged = Boolean(beforeBinding && !equal(beforeBinding, binding))
  // Choosing another study scope/mode is a projection operation, never a command
  // to remove omitted system items or erase counterpart function allocations.
  if (scopeChanged) {
    // A caller may have already projected the requested scope. Restore working
    // records before pruning so governance references can protect their targets.
    const merge = <T extends { id: string }>(current: T[], previous: T[]): T[] => [
      ...current, ...previous.filter(item => !current.some(value => value.id === item.id)),
    ]
    next.structure_nodes = merge(next.structure_nodes, before.structure_nodes)
    next.functions = merge(next.functions, before.functions)
    next.failure_chains = merge(next.failure_chains, before.failure_chains)
    next.interfaces = merge(next.interfaces, before.interfaces)
    next.function_links = merge(next.function_links, before.function_links)
    next.block_diagram.nodes = merge(next.block_diagram.nodes, before.block_diagram.nodes)
    return { model: sourceModel, analysis: materializeFmeaAnalysis(sourceModel, next, protectedIds) }
  }
  const sourceChecksum = fmeaSemanticFingerprint(sourceModel, [next])
  const beforeStructures = new Map(before.structure_nodes.map(item => [item.id, item]))
  const structureMap = new Map(next.structure_nodes.flatMap(item => {
    const id = canonicalInstanceId(item, model.id) ?? canonicalInstanceId(beforeStructures.get(item.id) ?? item, model.id)
    return id ? [[item.id, id] as const] : []
  }))
  const occupiedInstances = new Set(model.instances.map(item => item.id)), occupiedDefinitions = new Set(model.definitions.map(item => item.id))
  // New FMEA physical items join the shared system. Old unlinked structures require explicit reconciliation.
  if (next.kind !== 'pfmea') for (const node of next.structure_nodes) if (!structureMap.has(node.id)
    && (!beforeStructures.has(node.id) || node.element_type === 'canonical_new')) {
    const id = uniqueId(`FMEA-${next.id}-${node.id}`, occupiedInstances), definitionId = uniqueId(`DEF-${id}`, occupiedDefinitions)
    const definition: SystemBlockDefinition = { id: definitionId, name: node.name || 'System element', kind: 'component',
      classification: node.level || 'component', revision: 'A', description: node.description, part_number: '', manufacturer: '', category: '',
      ports: [], functions: [], failure_modes: [], child_slots: [], properties: {}, analysis_profiles: [] }
    const instance: SystemBlockInstance = { id, definition_id: definitionId, name: node.name || 'System element', quantity: 1,
      parent_instance_id: binding.scope_instance_id, mode_ids: [], reference_designators: [], function_overrides: [], failure_mode_overrides: [], legacy_refs: [], origin: 'ad_hoc' }
    model.definitions.push(definition); model.instances.push(instance); structureMap.set(node.id, id)
    node.source_ref = sourceRef(model, instance, sourceChecksum, node)
  }
  for (const node of next.structure_nodes) {
    const id = structureMap.get(node.id), previous = beforeStructures.get(node.id)
    const instance = model.instances.find(item => item.id === id)
    if (!instance) continue
    const remapped = previous && canonicalInstanceId(previous, model.id) !== canonicalInstanceId(node, model.id)
      && Boolean(canonicalInstanceId(node, model.id))
    if (remapped) {
      node.source_ref = sourceRef(model, instance, sourceChecksum, node)
      node.system_definition_ref = canonicalRef(model, instance)
      continue
    }
    if (previous && canonicalInstanceId(previous, model.id) && node.description !== previous.description) {
      const definition = model.definitions.find(item => item.id === instance.definition_id)!
      definition.description = node.description
    }
    if (previous && canonicalInstanceId(previous, model.id) && node.level !== previous.level) {
      const definition = model.definitions.find(item => item.id === instance.definition_id)!
      definition.classification = node.level
      if (['system', 'subsystem', 'assembly', 'component', 'piece_part'].includes(node.level))
        definition.kind = node.level as SystemBlockDefinition['kind']
    }
    if (previous && canonicalInstanceId(previous, model.id) && node.name !== previous.name) replaceInstance(model, { ...instance, name: node.name })
    if (next.kind !== 'pfmea' && ((!previous && structureMap.has(node.id)) || node.element_type === 'canonical_new' || node.parent_id !== previous?.parent_id)) {
      const parentId = node.parent_id ? structureMap.get(node.parent_id) : model.root_instance_id
      if (id === model.root_instance_id) { if (node.parent_id) throw new Error('The canonical System root cannot be moved.') }
      else if (!parentId) throw new Error('Map the new parent to a canonical system element before moving this item.')
      else model = reparentSystemInstance(model, id!, parentId)
    }
    const current = model.instances.find(item => item.id === id)!
    node.source_ref = sourceRef(model, current, sourceChecksum, node)
    node.system_definition_ref = canonicalRef(model, current)
  }
  const representedInstances = new Set(structureMap.values())
  const removed = new Set((scopeChanged ? [] : before.structure_nodes).filter(item => !next.structure_nodes.some(node => node.id === item.id)
    && !representedInstances.has(canonicalInstanceId(item, model.id) ?? ''))
    .map(item => canonicalInstanceId(item, model.id)).filter((id): id is string => Boolean(id)))
  if (removed.has(model.root_instance_id ?? '')) throw new Error('The canonical System root cannot be deleted.')
  if (model.instances.some(item => item.parent_instance_id && removed.has(item.parent_instance_id) && !removed.has(item.id)))
    throw new Error('This item has other installed children. Move or explicitly remove them before deleting its parent.')
  const removedInterfaceIds = new Set((scopeChanged ? [] : before.interfaces).filter(item => !next.interfaces.some(edge => edge.id === item.id))
    .map(item => item.system_definition_ref?.interface_id).filter((id): id is string => Boolean(id)
      && !next.interfaces.some(item => item.system_definition_ref?.system_model_id === model.id && item.system_definition_ref.interface_id === id)))
  if (model.interfaces.some(item => (removed.has(item.source.instance_id ?? '') || removed.has(item.target.instance_id ?? '')) && !removedInterfaceIds.has(item.id)))
    throw new Error('Remove or reconnect the system interfaces before deleting their connected item.')
  model.instances = model.instances.filter(item => !removed.has(item.id))
  model.interfaces = model.interfaces.filter(item => !removedInterfaceIds.has(item.id))
  model.function_links = model.function_links.filter(item => !removed.has(item.source.instance_id) && !removed.has(item.target.instance_id))
  model.propagation_rules = model.propagation_rules.filter(item => !removed.has(item.source?.instance_id ?? '') && !removed.has(item.target?.instance_id ?? '')
    && !removedInterfaceIds.has(item.interface_id ?? ''))
  // Reorder only the occurrences represented in the edit; all hidden records retain their slots.
  const liveInstances = new Set(model.instances.map(item => item.id))
  const ordered = next.structure_nodes.map(item => structureMap.get(item.id)).filter((id): id is string => Boolean(id && liveInstances.has(id)))
  const seen = new Set<string>(); const order = ordered.filter(id => !seen.has(id) && Boolean(seen.add(id)))
  const byId = new Map(model.instances.map(item => [item.id, item])); let cursor = 0
  model.instances = model.instances.map(item => seen.has(item.id) ? byId.get(order[cursor++])! : item)

  if (!equal(before.resources, next.resources)) model.resources = structuredClone(next.resources)
  const beforeFunctions = new Map(before.functions.map(item => [item.id, item]))
  for (const fn of next.functions) {
    const previous = beforeFunctions.get(fn.id), ref = fn.system_definition_ref ?? previous?.system_definition_ref
    if (ref?.system_model_id === model.id && ref.instance_id && ref.function_id) {
      fn.system_definition_ref = ref
      if (removed.has(ref.instance_id)) continue
      if (previous && referenceIdentity(previous.system_definition_ref) !== referenceIdentity(ref)) continue
      const instance = model.instances.find(item => item.id === ref.instance_id)
      if (!model.definitions.find(item => item.id === instance?.definition_id)?.functions.some(item => item.id === ref.function_id)) continue
      if (previous) {
        if (fn.structure_node_id !== previous.structure_node_id)
          throw new Error('A linked function belongs to its installed system element. Change its allocation in System Modeling.')
        if (!equal(fn.definition, previous.definition) || fn.description !== previous.description
          || !equal(fn.operating_modes, previous.operating_modes) || fn.function_type !== previous.function_type) {
          model = upsertInstalledFunction(model, ref.instance_id, {
            id: ref.function_id, definition: fn.definition, description: fn.description,
            function_type: fn.function_type, mode_ids: fn.operating_modes,
          })
        }
      }
    } else if ((!previous || next.structure_nodes.find(item => item.id === fn.structure_node_id)?.element_type === 'canonical_new') && next.kind !== 'pfmea') {
      const instance = model.instances.find(item => item.id === structureMap.get(fn.structure_node_id))
      const definition = model.definitions.find(item => item.id === instance?.definition_id)
      if (!instance || !definition) continue
      const id = uniqueId(`FMEA-FN-${fn.id}`, new Set(definition.functions.map(item => item.id)))
      definition.functions.push({ id, default_enabled: false, description: fn.description || 'New function', function_type: fn.function_type,
        canonical_verb_id: fn.canonical_verb_id, mode_ids: fn.operating_modes, definition: fn.definition })
      // Authoring a new installed function must not activate it in another reuse of the definition.
      for (const other of model.instances.filter(item => item.definition_id === definition.id && item.id !== instance.id))
        patchFunctionOverride(model, other.id, id, { enabled: false })
      patchFunctionOverride(model, instance.id, id, { enabled: true, ...(!fn.description ? { description: '' } : {}) })
      fn.system_definition_ref = canonicalRef(model, instance, { function_id: id })
    }
  }
  for (const fn of (scopeChanged ? [] : before.functions).filter(item => !next.functions.some(value => value.id === item.id))) {
    const ref = fn.system_definition_ref
    const instance = model.instances.find(item => item.id === ref?.instance_id)
    if (ref?.system_model_id === model.id && ref.instance_id && ref.function_id && !removed.has(ref.instance_id)
      && model.definitions.find(item => item.id === instance?.definition_id)?.functions.some(item => item.id === ref.function_id)
      && !next.functions.some(item => referenceIdentity(item.system_definition_ref) === referenceIdentity(ref)))
      patchFunctionOverride(model, ref.instance_id, ref.function_id, { enabled: false })
  }
  const beforeChains = new Map(before.failure_chains.map(item => [item.id, item]))
  for (const chain of next.failure_chains) {
    const previous = beforeChains.get(chain.id), ref = chain.system_definition_ref ?? previous?.system_definition_ref
    if (!previous && !ref && next.kind !== 'pfmea') {
      const fnRef = next.functions.find(fn => fn.id === chain.function_id)?.system_definition_ref
      const instance = model.instances.find(item => item.id === fnRef?.instance_id)
      const definition = model.definitions.find(item => item.id === instance?.definition_id)
      if (instance && definition && fnRef?.function_id) {
        const id = uniqueId(`FMEA-FM-${chain.id}`, new Set(definition.failure_modes.map(item => item.id)))
        definition.failure_modes.push({ id, function_id: fnRef.function_id, default_enabled: false,
          description: chain.failure_mode, deviation_id: chain.deviation_id || 'custom', mode_ids: [] })
        patchFailureOverride(model, instance.id, id, { enabled: true })
        chain.system_definition_ref = canonicalRef(model, instance, { function_id: fnRef.function_id, failure_mode_id: id })
      }
      continue
    }
    if (ref?.system_model_id !== model.id || !ref.instance_id || !ref.failure_mode_id) continue
    chain.system_definition_ref = ref
    if (removed.has(ref.instance_id)) continue
    if (previous && referenceIdentity(previous.system_definition_ref) !== referenceIdentity(ref)) continue
    const instance = model.instances.find(item => item.id === ref.instance_id)
    if (!model.definitions.find(item => item.id === instance?.definition_id)?.failure_modes.some(item => item.id === ref.failure_mode_id)) continue
    if (!previous) continue
    const patch: Partial<SystemBlockInstance['failure_mode_overrides'][number]> = {}
    if (chain.failure_mode !== previous.failure_mode) patch.description = chain.failure_mode
    if (chain.deviation_id !== previous.deviation_id) patch.deviation_id = chain.deviation_id ?? ''
    if (chain.function_id !== previous.function_id) {
      const fnRef = next.functions.find(item => item.id === chain.function_id)?.system_definition_ref
      if (fnRef?.instance_id !== ref.instance_id || !fnRef.function_id) throw new Error('A canonical failure mode must belong to a function of its installed system element.')
      Object.assign(patch, { function_id: fnRef.function_id }); chain.system_definition_ref = { ...ref, function_id: fnRef.function_id }
    }
    if (Object.keys(patch).length) patchFailureOverride(model, ref.instance_id, ref.failure_mode_id, patch)
  }
  for (const chain of (scopeChanged ? [] : before.failure_chains).filter(item => !next.failure_chains.some(value => value.id === item.id))) {
    const ref = chain.system_definition_ref
    const instance = model.instances.find(item => item.id === ref?.instance_id)
    if (ref?.system_model_id === model.id && ref.instance_id && ref.failure_mode_id && !removed.has(ref.instance_id)
      && model.definitions.find(item => item.id === instance?.definition_id)?.failure_modes.some(item => item.id === ref.failure_mode_id)
      && !next.failure_chains.some(item => item.system_definition_ref?.instance_id === ref.instance_id && item.system_definition_ref?.failure_mode_id === ref.failure_mode_id))
      patchFailureOverride(model, ref.instance_id, ref.failure_mode_id, { enabled: false })
  }

  const removedLinks = new Set((scopeChanged ? [] : before.function_links).filter(link => link.id.startsWith('SD-FLINK-')
    && !next.function_links.some(item => item.id === link.id)).map(link => link.id.slice('SD-FLINK-'.length)))
  model.function_links = model.function_links.filter(link => !removedLinks.has(link.id))
  for (const link of next.function_links) {
    const previous = before.function_links.find(item => item.id === link.id)
    const original = link.id.startsWith('SD-FLINK-') ? model.function_links.find(item => item.id === link.id.slice('SD-FLINK-'.length)) : undefined
    if (previous && (!original || equal(previous, link))) continue
    const source = next.functions.find(fn => fn.id === link.source_function_id)?.system_definition_ref
    const target = next.functions.find(fn => fn.id === link.target_function_id)?.system_definition_ref
    if (!source?.instance_id || !source.function_id || !target?.instance_id || !target.function_id) continue
    const id = original?.id ?? uniqueId(`FMEA-LINK-${next.id}-${link.id}`, new Set(model.function_links.map(item => item.id)))
    const value = { ...original, id, source: { instance_id: source.instance_id, function_id: source.function_id },
      target: { instance_id: target.instance_id, function_id: target.function_id },
      relationship: link.relationship, rationale: link.rationale, mode_ids: link.mode_ids ?? original?.mode_ids ?? [],
      ...(link.generated !== undefined ? { generated: link.generated } : {}) }
    const at = model.function_links.findIndex(item => item.id === id)
    if (at < 0) model.function_links.push(value); else model.function_links[at] = value
    link.id = `SD-FLINK-${id}`
  }

  const externalIds = new Set(model.externals.map(item => item.id)), externalByBlock = new Map<string, string>()
  const previousExternalIds = externalBlockIdentities(sourceModel, before)
  const deletedExternals = new Set((scopeChanged ? [] : before.block_diagram.nodes).filter(node => node.kind === 'external'
    && !next.block_diagram.nodes.some(item => item.id === node.id)).flatMap(node => previousExternalIds.get(node.id) ? [previousExternalIds.get(node.id)!] : []))
  if (model.interfaces.some(item => deletedExternals.has(item.source.external_id ?? '') || deletedExternals.has(item.target.external_id ?? '')))
    throw new Error('Remove or reconnect an external actor’s interfaces before deleting it.')
  model.externals = model.externals.filter(item => !deletedExternals.has(item.id))
  for (const node of next.block_diagram.nodes.filter(item => item.kind === 'external')) {
    const previous = before.block_diagram.nodes.find(item => item.id === node.id)
    const known = previousExternalIds.get(node.id) ?? (node.id.startsWith('SD-EXT-') ? node.id.slice(7) : undefined)
    let external = model.externals.find(item => item.id === known)
    if (!external && !previous) {
      external = { id: uniqueId(`FMEA-EXT-${next.id}-${node.id}`, externalIds), name: node.label, kind: node.external_kind ?? 'other', description: '', ports: structuredClone(node.ports ?? []) }
      model.externals.push(external)
      // The stable canonical external ID is encoded in the diagram block identity.
      const oldId = node.id; node.id = `SD-EXT-${external.id}`
      next.interfaces = next.interfaces.map(item => ({ ...item,
        source_block_id: item.source_block_id === oldId ? node.id : item.source_block_id,
        target_block_id: item.target_block_id === oldId ? node.id : item.target_block_id }))
    }
    if (!external) continue
    if (previous && !equal(node.ports, previous.ports)) external.ports = structuredClone(node.ports ?? [])
    externalByBlock.set(node.id, external.id)
    if (previous && (node.label !== previous.label || node.external_kind !== previous.external_kind)) {
      external.name = node.label; external.kind = node.external_kind ?? external.kind
    }
  }
  const endpoint = (item: FMEAInterface, side: 'source'|'target', existing?: SystemEndpoint): SystemEndpoint => {
    const blockId = item[`${side}_block_id`], block = next.block_diagram.nodes.find(node => node.id === blockId)
    const structureId = item[`${side}_structure_node_id`] ?? block?.structure_node_id
    const instanceId = structureId ? structureMap.get(structureId) : undefined
    if (instanceId) {
      const instance = model.instances.find(value => value.id === instanceId), definition = model.definitions.find(value => value.id === instance?.definition_id)
      if (!definition) throw new Error('Map the interface endpoint to an installed system element.')
      if (existing?.instance_id === instanceId && (!existing.port_id || definition.ports.some(port => port.id === existing.port_id && port.interface_type === item.interface_type))) return { ...existing }
      return { instance_id: instanceId }

    }
    const externalId = externalByBlock.get(blockId ?? '')
    if (!externalId) throw new Error('An interface must connect two mapped physical elements or external actors.')
    return existing?.external_id === externalId ? { ...existing } : { external_id: externalId }
  }
  for (const edge of next.interfaces) {
    const previous = before.interfaces.find(item => item.id === edge.id), ref = edge.system_definition_ref ?? previous?.system_definition_ref
    const canonical = model.interfaces.find(item => item.id === ref?.interface_id && ref?.system_model_id === model.id)
    if (previous && referenceIdentity(previous.system_definition_ref) !== referenceIdentity(ref)) continue
    if (canonical && !previous) continue
    if (previous && !canonical) continue
    const sharedInterfaceFields = ['name', 'interface_type', 'source_block_id', 'target_block_id', 'source_structure_node_id',
      'target_structure_node_id', 'linkage', 'directionality', 'relationship_strength', 'interface_detail', 'flow_description',
      'operating_condition', 'function_ids', 'transfers', 'mode_ids', 'generated'] as const
    if (previous && sharedInterfaceFields.every(field => equal(previous[field], edge[field]))) continue
    const source = endpoint(edge, 'source', canonical?.source), target = endpoint(edge, 'target', canonical?.target)
    const ids = edge.function_ids.map(id => next.functions.find(item => item.id === id)?.system_definition_ref)
    if ((!previous || !equal(previous.function_ids, edge.function_ids)) && ids.some(ref => !ref?.function_id
      || ![source.instance_id, target.instance_id].includes(ref.instance_id)))
      throw new Error('Link a physical interface to canonical functions belonging to its connected system elements.')
    const id = canonical?.id ?? uniqueId(`FMEA-IF-${next.id}-${edge.id}`, new Set(model.interfaces.map(item => item.id)))
    const updated: SystemInterface = { ...canonical, id, name: edge.name, interface_type: edge.interface_type,
      source, target, directionality: edge.directionality, linkage: edge.linkage, interface_detail: edge.interface_detail,
      strength: edge.relationship_strength === 'unspecified' ? 'unknown' : edge.relationship_strength,
      nature: canonical?.nature ?? 'unknown', flow_description: edge.flow_description, operating_condition: edge.operating_condition,
      source_function_ids: ids.filter(value => value?.instance_id === source.instance_id && value?.function_id).map(value => value!.function_id!),
      target_function_ids: ids.filter(value => value?.instance_id === target.instance_id && value?.function_id).map(value => value!.function_id!),
      mode_ids: edge.mode_ids ?? canonical?.mode_ids ?? [], properties: canonical?.properties ?? {}, transfers: edge.transfers ?? [],
      ...(edge.generated !== undefined ? { generated: edge.generated } : {}) }
    // Cross-boundary functions omitted from this study still belong to the physical interface.
    if (previous && equal(previous.function_ids, edge.function_ids) && canonical) {
      if (source.instance_id === canonical.source.instance_id) updated.source_function_ids = canonical.source_function_ids
      if (target.instance_id === canonical.target.instance_id) updated.target_function_ids = canonical.target_function_ids
    }
    const at = model.interfaces.findIndex(item => item.id === id)
    if (at < 0) model.interfaces.push(updated); else model.interfaces[at] = updated
    edge.system_definition_ref = canonicalRef(model, undefined, { interface_id: id })
  }

  const diagram = model.diagrams[0], geometry = [...diagram?.nodes ?? []]
  for (const node of next.kind === 'pfmea' ? [] : next.block_diagram.nodes) {
    const instanceId = node.structure_node_id ? structureMap.get(node.structure_node_id) : undefined
    const externalId = externalByBlock.get(node.id)
    if (!instanceId && !externalId) continue
    if (instanceId && !liveInstances.has(instanceId)) continue
    const old = before.block_diagram.nodes.find(item => item.id === node.id)
    if (old && ['x', 'y', 'width', 'height', 'expanded'].every(field => equal(node[field as keyof typeof node], old[field as keyof typeof old]))) continue
    if (![node.x, node.y, node.width, node.height].every(Number.isFinite) || node.width <= 0 || node.height <= 0) throw new Error('Diagram geometry must have finite coordinates and positive dimensions.')
    const at = geometry.findIndex(item => instanceId ? item.instance_id === instanceId : item.external_id === externalId)
    const value = { ...(at < 0 ? {} : geometry[at]), ...(instanceId ? { instance_id: instanceId } : { external_id: externalId }),
      x: node.x, y: node.y, width: node.width, height: node.height, expanded: Boolean(node.expanded) }
    if (at < 0) geometry.push(value); else geometry[at] = value
  }
  const nextDiagram = { ...diagram, id: diagram?.id ?? 'diagram-1', name: diagram?.name ?? model.name,
    nodes: geometry.filter(item => (!item.instance_id || !removed.has(item.instance_id))
      && (!item.external_id || !deletedExternals.has(item.external_id))) }
  if (next.kind !== 'pfmea' && !equal(before.block_diagram.boundary, next.block_diagram.boundary)) nextDiagram.boundary = next.block_diagram.boundary
  if (next.kind !== 'pfmea' && before.block_diagram.density !== next.block_diagram.density) nextDiagram.density = ['dense', 'compact'].includes(next.block_diagram.density)
    ? 'compact' : ['spacious', 'expanded'].includes(next.block_diagram.density) ? 'detailed' : 'standard'
  if (next.kind !== 'pfmea' && !equal(before.block_diagram.layoutOptions, next.block_diagram.layoutOptions)) nextDiagram.layoutOptions = next.block_diagram.layoutOptions
  if (next.kind !== 'pfmea' && before.block_diagram.snap_to_grid !== next.block_diagram.snap_to_grid) nextDiagram.snap_to_grid = next.block_diagram.snap_to_grid
  if (next.kind !== 'pfmea' && before.block_diagram.connectorStyle !== next.block_diagram.connectorStyle) nextDiagram.connectorStyle = next.block_diagram.connectorStyle
  model.diagrams = [nextDiagram, ...model.diagrams.slice(1)]
  model = populateSystemInterfaceFunctions(model, sourceModel)
  model = splitFmeaRequirements(model, before, next, moduleKey)
  validateProjectSystem(model)
  return { model: equal(model, sourceModel) ? sourceModel : model, analysis: materializeFmeaAnalysis(model, next, protectedIds) }
}
