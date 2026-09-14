import type {
  CanonicalSystemRef,
  SystemBlockDefinition,
  SystemBlockInstance,
  SystemAnalysisBinding,
  SystemDefinitionModel,
  SystemParameterValue,
  SystemProjectionResult,
  SystemPropagationResult,
} from '../../api/systemDefinition'

export interface ProposalDecision {
  proposal_id: string
  fingerprint: string
  status: 'accepted'|'rejected'
  decided_at: string
}

export interface MigrationIssue {
  severity: 'warning'|'info'
  code: string
  message: string
  source_ref?: string
}

export interface SystemDefinitionState {
  model: SystemDefinitionModel
  selectedModeId: string
  selectedInstanceId: string
  collapsedInstanceIds: string[]
  view: 'structure'|'architecture'|'functions'|'fault-map'|'integrations'
  decisions: ProposalDecision[]
  propagation?: SystemPropagationResult|null
  analysisBindings?: SystemAnalysisBinding[]
  projectionPreview?: SystemProjectionResult|null
  migration: {
    source_schema: number
    migrated_at: string
    source_modules: string[]
    issues: MigrationIssue[]
  }
}

const safe = (value: unknown) => String(value ?? '')
  .trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

function uniqueId(prefix: string, seed: string, used: Set<string>): string {
  const base = `${prefix}-${safe(seed) || 'item'}`.slice(0, 110)
  let value = base
  let sequence = 2
  while (used.has(value)) value = `${base}-${sequence++}`
  used.add(value)
  return value
}

function uniqueByName<T extends { name: string }>(items: T[]): Map<string, T> {
  const unique = new Map<string, T>()
  const seen = new Set<string>()
  for (const item of items) {
    if (!item.name) continue
    if (seen.has(item.name)) unique.delete(item.name)
    else unique.set(item.name, item)
    seen.add(item.name)
  }
  return unique
}

export function emptySystemDefinition(name = 'System Definition', id = 'system-1'):
    SystemDefinitionState {
  return {
    model: {
      version: 2, id, name, revision: 'A', modes: [], definitions: [],
      instances: [], externals: [], interfaces: [], function_links: [],
      propagation_rules: [], propagation_assertions: [], diagrams: [{
        id: 'diagram-1', name: 'System', density: 'standard',
        boundary: { label: name, x: -40, y: -40, width: 1200, height: 700 },
        viewport: { x: 0, y: 0, zoom: 1 }, snap_to_grid: true, mode_ids: [], nodes: [],
      }],
    },
    selectedModeId: '', selectedInstanceId: '', collapsedInstanceIds: [],
    view: 'structure',
    decisions: [], propagation: null, analysisBindings: [], projectionPreview: null,
    migration: { source_schema: 7, migrated_at: '', source_modules: [], issues: [] },
  }
}

const LAYOUT_NODE_WIDTH = 180
const LAYOUT_NODE_HEIGHT = 72
const LAYOUT_COLUMN_GAP = 70
const LAYOUT_ROW_GAP = 36
const LAYOUT_ORIGIN_X = 40
const LAYOUT_ORIGIN_Y = 40

/**
 * Arrange the installed hierarchy as a non-overlapping left-to-right tree.
 * Depth controls the x coordinate; leaf slots control vertical separation;
 * parents are centered over the vertical span of their immediate children.
 */
export function hierarchyLayout(
  model: SystemDefinitionModel,
  collapsedInstanceIds: Iterable<string> = [],
):
    SystemDefinitionModel['diagrams'][number]['nodes'] {
  const byParent = new Map<string, SystemBlockInstance[]>()
  const instanceIds = new Set(model.instances.map(item => item.id))
  for (const item of model.instances) {
    const validParent = item.parent_instance_id
      && item.parent_instance_id !== item.id
      && instanceIds.has(item.parent_instance_id)
    const key = validParent ? item.parent_instance_id! : ''
    byParent.set(key, [...(byParent.get(key) ?? []), item])
  }

  const collapsed = new Set(collapsedInstanceIds)
  const hidden = new Set<string>()
  const hideDescendants = (instanceId: string, visiting = new Set<string>()) => {
    if (visiting.has(instanceId)) return
    const nextVisiting = new Set(visiting).add(instanceId)
    for (const child of byParent.get(instanceId) ?? []) {
      hidden.add(child.id)
      hideDescendants(child.id, nextVisiting)
    }
  }
  for (const instanceId of collapsed) hideDescendants(instanceId)

  const positions = new Map<string, SystemDefinitionModel['diagrams'][number]['nodes'][number]>()
  const visited = new Set<string>()
  let nextLeafY = LAYOUT_ORIGIN_Y

  const place = (item: SystemBlockInstance, depth: number): number => {
    if (visited.has(item.id)) return positions.get(item.id)?.y ?? nextLeafY
    visited.add(item.id)
    const children = collapsed.has(item.id) ? [] : (byParent.get(item.id) ?? [])
      .filter(child => !hidden.has(child.id) && !visited.has(child.id))
    const childY = children.map(child => place(child, depth + 1))
    const y = childY.length
      ? (Math.min(...childY) + Math.max(...childY)) / 2
      : nextLeafY
    if (!childY.length) nextLeafY += LAYOUT_NODE_HEIGHT + LAYOUT_ROW_GAP
    positions.set(item.id, {
      instance_id: item.id,
      x: LAYOUT_ORIGIN_X + depth * (LAYOUT_NODE_WIDTH + LAYOUT_COLUMN_GAP),
      y,
      width: LAYOUT_NODE_WIDTH,
      height: LAYOUT_NODE_HEIGHT,
      expanded: false,
    })
    return y
  }

  for (const root of byParent.get('') ?? []) {
    if (!hidden.has(root.id)) place(root, 0)
  }
  // A temporarily cyclic or otherwise disconnected draft still receives a
  // safe layout; validation continues to report the underlying model issue.
  for (const item of model.instances) {
    if (!hidden.has(item.id) && !visited.has(item.id)) place(item, 0)
  }
  return model.instances.flatMap(item => {
    const position = positions.get(item.id)
    return position ? [position] : []
  })
}

export function applyHierarchyLayout(model: SystemDefinitionModel): SystemDefinitionModel {
  const nodes = hierarchyLayout(model)
  const diagrams = model.diagrams.length ? model.diagrams.map((diagram, index) =>
    index === 0 ? { ...diagram, nodes } : diagram) : [{
    id: 'diagram-1', name: 'System', nodes,
  }]
  return { ...model, diagrams }
}

type Folio = { id: string; name: string; state: Record<string, unknown> }

function foliosOf(value: unknown): Folio[] {
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  if (record._folioWrap === true && Array.isArray(record.folios)) {
    return record.folios.filter(item => item && typeof item === 'object') as Folio[]
  }
  return [{ id: 'f0', name: 'Analysis 1', state: record }]
}

function definition(
  id: string, name: string, classification: string,
  metadata: Partial<SystemBlockDefinition> = {},
): SystemBlockDefinition {
  return {
    id, name, classification,
    kind: classification === 'part' ? 'piece_part'
      : ['system', 'subsystem', 'assembly', 'component'].includes(classification)
        ? classification as SystemBlockDefinition['kind'] : 'component',
    revision: 'A', description: '', part_number: '', manufacturer: '',
    category: '', properties: {}, analysis_profiles: [],
    ports: [], functions: [], failure_modes: [], child_slots: [],
    ...metadata,
  }
}

function instance(
  id: string, definitionId: string, name: string,
  parentId?: string, legacyRefs: string[] = [],
): SystemBlockInstance {
  return {
    id, definition_id: definitionId, parent_instance_id: parentId, name,
    quantity: 1, reference_designators: [], mode_ids: [],
    function_overrides: [], failure_mode_overrides: [], legacy_refs: legacyRefs,
    origin: 'ad_hoc', definition_revision: 'A', properties: {}, profile_overrides: [],
  }
}

function ensureModes(model: SystemDefinitionModel, values: unknown): string[] {
  const ids = Array.isArray(values) ? values.map(String).filter(Boolean) : []
  for (const id of ids) {
    if (!model.modes.some(item => item.id === id)) {
      model.modes.push({ id, name: id, description: 'Migrated operating mode' })
    }
  }
  return ids
}

function predictionStateToSystem(folio: Folio): {
  state: SystemDefinitionState
  partRefs: Map<string, CanonicalSystemRef>
  blockRefs: Map<string, CanonicalSystemRef>
} {
  const source = folio.state
  const standard = String(source.standard ?? 'MIL-HDBK-217F')
  const predictionAdapter: Record<string, string> = {
    'MIL-HDBK-217F': 'prediction.mil-hdbk-217f',
    Telcordia: 'prediction.telcordia-sr332',
    '217Plus': 'prediction.217plus', FIDES: 'prediction.fides',
    NSWC: 'prediction.nswc-98-le1', 'EPRD-2014': 'custom', 'NPRD-2023': 'custom',
  }
  const systemId = `system-prediction-${safe(folio.id) || '1'}`
  const state = emptySystemDefinition(folio.name || 'Prediction System', systemId)
  const usedDefinitions = new Set<string>()
  const usedInstances = new Set<string>()
  const rootDefinitionId = uniqueId('def', `${folio.id}-system`, usedDefinitions)
  const rootInstanceId = uniqueId('inst', `${folio.id}-system`, usedInstances)
  state.model.definitions.push(definition(rootDefinitionId, folio.name || 'System', 'system'))
  state.model.instances.push(instance(
    rootInstanceId, rootDefinitionId, folio.name || 'System', undefined,
    [`prediction:${folio.id}:system`],
  ))
  state.model.diagrams[0].nodes.push({
    instance_id: rootInstanceId, x: 80, y: 80, width: 220, height: 90, expanded: true,
  })
  const blockRefs = new Map<string, CanonicalSystemRef>()
  const blockInstances = new Map<string, string>()
  const blocks = Array.isArray(source.blocks) ? source.blocks as Record<string, unknown>[] : []
  const remaining = [...blocks]
  let guard = remaining.length + 1
  while (remaining.length && guard-- > 0) {
    const before = remaining.length
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      const block = remaining[index]
      const legacyId = String(block.id ?? `block-${index + 1}`)
      const parentLegacy = block.parentId ?? block.parent_id
      if (parentLegacy && !blockInstances.has(String(parentLegacy))) continue
      const definitionId = uniqueId('def', `${folio.id}-${legacyId}`, usedDefinitions)
      const instanceId = uniqueId('inst', `${folio.id}-${legacyId}`, usedInstances)
      const name = String(block.name ?? legacyId)
      state.model.definitions.push(definition(definitionId, name, 'subsystem', {
        description: String(block.notes ?? ''),
      }))
      state.model.instances.push({
        ...instance(instanceId, definitionId, name,
          parentLegacy ? blockInstances.get(String(parentLegacy)) : rootInstanceId,
          [`prediction:${folio.id}:block:${legacyId}`]),
        quantity: Math.max(1, Number(block.quantity ?? 1) || 1),
      })
      blockInstances.set(legacyId, instanceId)
      blockRefs.set(legacyId, { system_model_id: systemId, instance_id: instanceId, definition_id: definitionId })
      remaining.splice(index, 1)
    }
    if (remaining.length === before) break
  }
  for (const block of remaining) {
    state.migration.issues.push({
      severity: 'warning', code: 'prediction_block_parent_unresolved',
      message: `Placed '${String(block.name ?? block.id)}' at the system root because its parent could not be resolved.`,
      source_ref: `prediction:${folio.id}:block:${String(block.id)}`,
    })
  }
  const parts = Array.isArray(source.parts) ? source.parts as Record<string, unknown>[] : []
  const definitionByIdentity = new Map<string, string>()
  const partRefs = new Map<string, CanonicalSystemRef>()
  for (const [index, part] of parts.entries()) {
    const legacyId = String(part.id ?? `part-${index + 1}`)
    const identity = [part.manufacturer, part.part_number, part.category, part.name]
      .map(value => safe(value)).join('|') || legacyId
    let definitionId = definitionByIdentity.get(identity)
    if (!definitionId) {
      definitionId = uniqueId('def', `${folio.id}-${identity}`, usedDefinitions)
      definitionByIdentity.set(identity, definitionId)
      const params = part.params && typeof part.params === 'object'
        ? part.params as Record<string, unknown> : {}
      const values: Record<string, SystemParameterValue> = {
        category: { kind: 'text', value: String(part.category ?? '') },
      }
      for (const [key, value] of Object.entries(params)) {
        values[key] = typeof value === 'number'
          ? { kind: 'number', value, unit: '' }
          : { kind: 'text', value: String(value ?? '') }
      }
      if (part.environment) values.environment = {
        kind: 'text', value: String(part.environment),
      }
      state.model.definitions.push(definition(
        definitionId, String(part.name ?? part.part_number ?? part.category ?? legacyId),
        'part', {
          description: String(part.description ?? part.notes ?? ''),
          part_number: String(part.part_number ?? ''),
          manufacturer: String(part.manufacturer ?? ''),
          category: String(part.category ?? ''),
          analysis_profiles: [{
            id: `profile-${safe(standard) || 'prediction'}`,
            name: standard, domain: 'prediction',
            adapter_id: predictionAdapter[standard] ?? 'custom',
            adapter_version: 1, status: 'reviewed', mode_ids: [], values,
            source_ref: `prediction:${folio.id}:part:${legacyId}`,
          }],
        },
      ))
    }
    const instanceId = uniqueId('inst', `${folio.id}-${legacyId}`, usedInstances)
    const parentLegacy = String(part.parentId ?? part.parent_id ?? '')
    const name = String(part.name ?? part.part_number ?? part.category ?? legacyId)
    state.model.instances.push({
      ...instance(instanceId, definitionId, name,
        blockInstances.get(parentLegacy) ?? rootInstanceId,
        [`prediction:${folio.id}:part:${legacyId}`]),
      quantity: Math.max(1, Number(part.quantity ?? 1) || 1),
      reference_designators: Array.isArray(part.reference_designators)
        ? part.reference_designators.map(String) : [],
    })
    partRefs.set(legacyId, { system_model_id: systemId, instance_id: instanceId, definition_id: definitionId })
  }
  const children = new Map<string, number>()
  for (const item of state.model.instances.filter(value => value.id !== rootInstanceId)) {
    const depth = item.parent_instance_id ? (children.get(item.parent_instance_id) ?? 0) + 1 : 0
    children.set(item.id, depth)
    state.model.diagrams[0].nodes.push({
      instance_id: item.id, x: 80 + depth * 220,
      y: 80 + state.model.diagrams[0].nodes.length * 92,
      width: 180, height: 72, expanded: false,
    })
  }
  state.selectedInstanceId = rootInstanceId
  state.migration = {
    source_schema: 6, migrated_at: new Date().toISOString(),
    source_modules: ['prediction'], issues: state.migration.issues,
  }
  return { state, partRefs, blockRefs }
}

function fmeaAnalysisToSystem(
  analysis: Record<string, unknown>, folioId: string,
): SystemDefinitionState {
  const analysisId = String(analysis.id ?? folioId)
  const state = emptySystemDefinition(
    String(analysis.name ?? 'FMEA System'), `system-fmea-${safe(analysisId)}`)
  const nodes = Array.isArray(analysis.structure_nodes)
    ? analysis.structure_nodes as Record<string, unknown>[] : []
  const functions = Array.isArray(analysis.functions)
    ? analysis.functions as Record<string, unknown>[] : []
  const chains = Array.isArray(analysis.failure_chains)
    ? analysis.failure_chains as Record<string, unknown>[] : []
  const usedDefinitions = new Set<string>()
  const usedInstances = new Set<string>()
  const instanceByNode = new Map<string, SystemBlockInstance>()
  for (const node of nodes) {
    const nodeId = String(node.id)
    const definitionId = uniqueId('def', `${analysisId}-${nodeId}`, usedDefinitions)
    const instanceId = uniqueId('inst', `${analysisId}-${nodeId}`, usedInstances)
    const itemDefinition = definition(
      definitionId, String(node.name || nodeId), String(node.element_type || node.level || 'component'),
      { description: String(node.description ?? ''), ports: [{
        id: 'interface', name: 'Interface', interface_type: 'information',
        direction: 'bidirectional', description: String(node.interface ?? ''),
      }] },
    )
    const itemInstance = instance(
      instanceId, definitionId, String(node.name || nodeId), undefined,
      [`fmea:${folioId}:${analysisId}:structure:${nodeId}`],
    )
    state.model.definitions.push(itemDefinition)
    state.model.instances.push(itemInstance)
    instanceByNode.set(nodeId, itemInstance)
  }
  for (const node of nodes) {
    const item = instanceByNode.get(String(node.id))
    const parent = instanceByNode.get(String(node.parent_id ?? ''))
    if (item && parent) item.parent_instance_id = parent.id
  }
  if (!state.model.instances.length) {
    const definitionId = uniqueId('def', analysisId, usedDefinitions)
    const instanceId = uniqueId('inst', analysisId, usedInstances)
    state.model.definitions.push(definition(definitionId, String(analysis.name ?? analysisId), 'system'))
    state.model.instances.push(instance(instanceId, definitionId, String(analysis.name ?? analysisId)))
  }
  for (const fn of functions) {
    const installed = instanceByNode.get(String(fn.structure_node_id))
    const owner = installed && state.model.definitions.find(item => item.id === installed.definition_id)
    if (!owner) continue
    owner.functions.push({
      id: String(fn.id), description: String(fn.description || fn.id),
      canonical_verb_id: fn.canonical_verb_id ? String(fn.canonical_verb_id) : undefined,
      function_type: (fn.function_type as SystemBlockDefinition['functions'][number]['function_type']) || 'primary',
      mode_ids: ensureModes(state.model, fn.operating_modes),
    })
  }
  for (const chain of chains) {
    const functionId = String(chain.function_id ?? '')
    const owner = state.model.definitions.find(item => item.functions.some(fn => fn.id === functionId))
    if (!owner || !functionId) continue
    owner.failure_modes.push({
      id: String(chain.id), function_id: functionId,
      description: String(chain.failure_mode || chain.id),
      deviation_id: String(chain.deviation_id || 'custom'), mode_ids: [],
    })
  }
  const blockNodes = Array.isArray((analysis.block_diagram as Record<string, unknown>|undefined)?.nodes)
    ? (analysis.block_diagram as { nodes: Record<string, unknown>[] }).nodes : []
  const diagramStructure = new Map(blockNodes.map(item => [String(item.id), String(item.structure_node_id ?? '')]))
  const interfaces = Array.isArray(analysis.interfaces)
    ? analysis.interfaces as Record<string, unknown>[] : []
  for (const item of interfaces) {
    const sourceStructure = String(item.source_structure_node_id
      ?? diagramStructure.get(String(item.source_block_id)) ?? '')
    const targetStructure = String(item.target_structure_node_id
      ?? diagramStructure.get(String(item.target_block_id)) ?? '')
    const source = instanceByNode.get(sourceStructure)
    const target = instanceByNode.get(targetStructure)
    const externalEndpoint = (labelValue: unknown, side: 'source'|'target') => {
      const label = String(labelValue ?? '').trim()
      if (!label) return undefined
      const existing = state.model.externals.find(value => value.name === label)
      if (existing) return { external_id: existing.id }
      const id = uniqueId('ext', `${analysisId}-${String(item.id)}-${side}-${label}`, usedInstances)
      state.model.externals.push({ id, name: label, kind: 'other', description: 'Migrated FMEA boundary' })
      return { external_id: id }
    }
    const sourceEndpoint = source
      ? { instance_id: source.id, port_id: 'interface' }
      : externalEndpoint(item.external_source, 'source')
    const targetEndpoint = target
      ? { instance_id: target.id, port_id: 'interface' }
      : externalEndpoint(item.external_target, 'target')
    if (!sourceEndpoint || !targetEndpoint) {
      state.migration.issues.push({
        severity: 'warning', code: 'fmea_interface_endpoint_unresolved',
        message: `Interface '${String(item.name || item.id)}' was retained in FMEA because one of its endpoints is external or unresolved.`,
      })
      continue
    }
    const linkedFunctions = Array.isArray(item.function_ids) ? item.function_ids.map(String) : []
    const sourceDefinition = source
      ? state.model.definitions.find(value => value.id === source.definition_id) : undefined
    const targetDefinition = target
      ? state.model.definitions.find(value => value.id === target.definition_id) : undefined
    state.model.interfaces.push({
      id: String(item.id), name: String(item.name ?? ''),
      interface_type: (item.interface_type as SystemDefinitionModel['interfaces'][number]['interface_type']) || 'information',
      source: sourceEndpoint,
      target: targetEndpoint,
      directionality: (item.directionality as SystemDefinitionModel['interfaces'][number]['directionality']) || 'directed',
      linkage: (item.linkage as 'direct'|'indirect') || 'direct',
      interface_detail: String(item.interface_detail ?? ''),
      flow_description: String(item.flow_description ?? ''),
      operating_condition: String(item.operating_condition ?? ''),
      source_function_ids: sourceDefinition?.functions.filter(fn => linkedFunctions.includes(fn.id)).map(fn => fn.id) ?? [],
      target_function_ids: targetDefinition?.functions.filter(fn => linkedFunctions.includes(fn.id)).map(fn => fn.id) ?? [],
      mode_ids: [],
    })
  }
  state.model.diagrams[0].nodes = state.model.instances.map((item, index) => ({
    instance_id: item.id, x: 60 + (index % 4) * 210,
    y: 60 + Math.floor(index / 4) * 110, width: 180, height: 72, expanded: false,
  }))
  state.selectedInstanceId = state.model.instances[0]?.id ?? ''
  state.migration = {
    source_schema: 6, migrated_at: new Date().toISOString(),
    source_modules: ['fmea'], issues: state.migration.issues,
  }
  return state
}

function addFmeaSemantics(
  state: SystemDefinitionState, analysis: Record<string, unknown>,
): void {
  const nodes = Array.isArray(analysis.structure_nodes)
    ? analysis.structure_nodes as Record<string, unknown>[] : []
  const functions = Array.isArray(analysis.functions)
    ? analysis.functions as Record<string, unknown>[] : []
  const failures = Array.isArray(analysis.failure_chains)
    ? analysis.failure_chains as Record<string, unknown>[] : []
  const instancesByLegacy = new Map<string, SystemBlockInstance>()
  for (const item of state.model.instances) {
    for (const ref of item.legacy_refs) instancesByLegacy.set(ref, item)
  }
  const definitionByInstance = new Map(state.model.instances.map(item => [item.id,
    state.model.definitions.find(value => value.id === item.definition_id)!]))
  const localNodeToInstance = new Map<string, SystemBlockInstance>()
  for (const node of nodes) {
    const sourceRef = node.source_ref as Record<string, unknown>|undefined
    const identity = sourceRef
      ? `prediction:${String(sourceRef.analysis_id)}:${String(sourceRef.entity_type)}:${String(sourceRef.entity_id)}`
      : ''
    const found = instancesByLegacy.get(identity)
    if (found) localNodeToInstance.set(String(node.id), found)
  }
  for (const fn of functions) {
    const installed = localNodeToInstance.get(String(fn.structure_node_id))
    const target = installed ? definitionByInstance.get(installed.id) : undefined
    if (!target || target.functions.some(item => item.id === String(fn.id))) continue
    target.functions.push({
      id: String(fn.id), description: String(fn.description || fn.id),
      canonical_verb_id: fn.canonical_verb_id ? String(fn.canonical_verb_id) : undefined,
      function_type: (fn.function_type as SystemBlockDefinition['functions'][number]['function_type']) || 'primary',
      mode_ids: ensureModes(state.model, fn.operating_modes),
    })
  }
  for (const chain of failures) {
    const functionId = String(chain.function_id ?? '')
    const owner = state.model.definitions.find(item =>
      item.functions.some(fn => fn.id === functionId))
    if (!owner || owner.failure_modes.some(item => item.id === String(chain.id))) continue
    owner.failure_modes.push({
      id: String(chain.id), function_id: functionId,
      description: String(chain.failure_mode || chain.id),
      deviation_id: String(chain.deviation_id || 'custom'), mode_ids: [],
    })
  }
}

function rbdFolioToSystem(folio: Folio): SystemDefinitionState|null {
  const nodes = Array.isArray(folio.state.nodes)
    ? (folio.state.nodes as Record<string, unknown>[]).filter(item => item.type === 'component')
    : []
  if (!nodes.length) return null
  const state = emptySystemDefinition(folio.name || 'RBD System', `system-rbd-${safe(folio.id)}`)
  const rootDefinitionId = `def-rbd-${safe(folio.id)}-system`
  const rootInstanceId = `inst-rbd-${safe(folio.id)}-system`
  state.model.definitions.push(definition(rootDefinitionId, folio.name || 'RBD System', 'system'))
  state.model.instances.push(instance(rootInstanceId, rootDefinitionId, folio.name || 'RBD System'))
  const usedDefinitions = new Set([rootDefinitionId])
  const usedInstances = new Set([rootInstanceId])
  for (const [index, node] of nodes.entries()) {
    const data = (node.data ?? {}) as Record<string, unknown>
    const nodeId = String(node.id ?? index + 1)
    const name = String(data.label ?? nodeId)
    const definitionId = uniqueId('def', `${folio.id}-${name}`, usedDefinitions)
    const instanceId = uniqueId('inst', `${folio.id}-${nodeId}`, usedInstances)
    state.model.definitions.push(definition(definitionId, name, 'component'))
    state.model.instances.push(instance(
      instanceId, definitionId, name, rootInstanceId,
      [`rbd:${folio.id}:component:${nodeId}`],
    ))
  }
  state.model.diagrams[0].nodes = state.model.instances.map((item, index) => ({
    instance_id: item.id, x: 60 + (index % 4) * 210,
    y: 60 + Math.floor(index / 4) * 110, width: 180, height: 72, expanded: false,
  }))
  state.selectedInstanceId = rootInstanceId
  state.migration = {
    source_schema: 6, migrated_at: new Date().toISOString(),
    source_modules: ['rbd'], issues: [{
      severity: 'info', code: 'rbd_topology_preserved_as_overlay',
      message: 'RBD components seeded canonical blocks; success-path topology remains RBD-owned.',
    }],
  }
  return state
}

/** Upgrade an already-canonical v1 folio without changing authored IDs. */
export function upgradeSystemDefinitionState(value: SystemDefinitionState): SystemDefinitionState {
  const model = structuredClone(value.model)
  model.version = 2
  model.propagation_assertions ??= []
  model.definitions = model.definitions.map(item => ({
    ...item,
    kind: item.kind ?? (item.classification === 'part' ? 'piece_part'
      : ['system', 'subsystem', 'assembly', 'component'].includes(item.classification)
        ? item.classification as SystemBlockDefinition['kind'] : 'component'),
    revision: item.revision ?? model.revision,
    properties: item.properties ?? {}, analysis_profiles: item.analysis_profiles ?? [],
    ports: item.ports.map(port => ({ ...port, properties: port.properties ?? {} })),
    functions: item.functions.map(fn => ({ ...fn, port_ids: fn.port_ids ?? [] })),
  }))
  model.instances = model.instances.map(item => ({
    ...item, origin: item.origin ?? 'ad_hoc', definition_revision: item.definition_revision ?? '',
    properties: item.properties ?? {}, profile_overrides: item.profile_overrides ?? [],
  }))
  model.externals = model.externals.map(item => ({ ...item, ports: item.ports ?? [] }))
  model.interfaces = model.interfaces.map(item => ({
    ...item, strength: item.strength ?? 'unknown', nature: item.nature ?? 'unknown',
    properties: item.properties ?? {},
  }))
  model.diagrams = model.diagrams.map(diagram => ({
    ...diagram, density: diagram.density ?? 'standard',
    boundary: diagram.boundary ?? {
      label: model.name, x: -40, y: -40, width: 1200, height: 700,
    },
    viewport: diagram.viewport ?? { x: 0, y: 0, zoom: 1 },
    snap_to_grid: diagram.snap_to_grid ?? true, mode_ids: diagram.mode_ids ?? [],
  }))
  return {
    ...value, model,
    view: value.view ?? 'structure', analysisBindings: value.analysisBindings ?? [],
    projectionPreview: value.projectionPreview ?? null,
  }
}

function upgradeExistingSystemDefinition(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  const record = structuredClone(value) as Record<string, unknown>
  if (record._folioWrap === true && Array.isArray(record.folios)) {
    record.folios = (record.folios as Record<string, unknown>[]).map(folio => ({
      ...folio,
      state: upgradeSystemDefinitionState(folio.state as unknown as SystemDefinitionState),
    }))
    return record
  }
  return upgradeSystemDefinitionState(record as unknown as SystemDefinitionState)
}

function existingSystemDefinitionIsV2(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (record._folioWrap === true && Array.isArray(record.folios)) {
    return (record.folios as Record<string, unknown>[]).every(folio =>
      Number(((folio.state as Record<string, unknown>|undefined)?.model as
        Record<string, unknown>|undefined)?.version) >= 2)
  }
  return Number((record.model as Record<string, unknown>|undefined)?.version) >= 2
}

/**
 * Upgrade schema-6 module data into the canonical architecture slice. The
 * migration is deliberately exact-ID based and idempotent; it never fuzzy
 * merges engineering records.
 */
export function migrateSystemDefinitionModules(
  input: Record<string, unknown>,
): Record<string, unknown> {
  if (input.systemDefinition !== undefined) return existingSystemDefinitionIsV2(
    input.systemDefinition) ? input : {
      ...input, systemDefinition: upgradeExistingSystemDefinition(input.systemDefinition),
    }
  if (!['prediction', 'fmea', 'system', 'faultTree', 'markov']
      .some(key => input[key] !== undefined)) return input
  const modules = structuredClone(input)
  const predictionFolios = foliosOf(modules.prediction)
  const systemFolios: { id: string; name: string; state: SystemDefinitionState }[] = []
  const byPredictionAnalysis = new Map<string, SystemDefinitionState>()
  for (const folio of predictionFolios) {
    if (!Array.isArray(folio.state.blocks) && !Array.isArray(folio.state.parts)) continue
    const migrated = predictionStateToSystem(folio)
    byPredictionAnalysis.set(folio.id, migrated.state)
    systemFolios.push({ id: `sd-${folio.id}`, name: folio.name, state: migrated.state })
    const parts = Array.isArray(folio.state.parts)
      ? folio.state.parts as Record<string, unknown>[] : []
    const blocks = Array.isArray(folio.state.blocks)
      ? folio.state.blocks as Record<string, unknown>[] : []
    for (const part of parts) {
      const ref = migrated.partRefs.get(String(part.id))
      if (ref) part.system_ref = ref
    }
    for (const block of blocks) {
      const ref = migrated.blockRefs.get(String(block.id))
      if (ref) block.system_ref = ref
    }
  }
  const fmeaFolios = foliosOf(modules.fmea)
  for (const folio of fmeaFolios) {
    const analyses = Array.isArray(folio.state.analyses)
      ? folio.state.analyses as Record<string, unknown>[] : []
    for (const analysis of analyses) {
      const predictionAnalysis = (analysis.structure_nodes as Record<string, unknown>[]|undefined)
        ?.map(node => node.source_ref as Record<string, unknown>|undefined)
        .find(Boolean)?.analysis_id
      const target = predictionAnalysis
        ? byPredictionAnalysis.get(String(predictionAnalysis)) : undefined
      if (target) {
        addFmeaSemantics(target, analysis)
        if (!target.migration.source_modules.includes('fmea')) {
          target.migration.source_modules.push('fmea')
        }
      } else {
        const migrated = fmeaAnalysisToSystem(analysis, folio.id)
        systemFolios.push({
          id: `sd-fmea-${safe(String(analysis.id ?? folio.id))}`,
          name: String(analysis.name ?? folio.name), state: migrated,
        })
      }
    }
  }
  if (!systemFolios.length) {
    for (const folio of foliosOf(modules.system)) {
      const migrated = rbdFolioToSystem(folio)
      if (migrated) systemFolios.push({
        id: `sd-rbd-${folio.id}`, name: folio.name, state: migrated,
      })
    }
  }
  if (!systemFolios.length) {
    systemFolios.push({ id: 'sd-f0', name: 'System 1', state: emptySystemDefinition() })
  }
  const canonicalInstances = systemFolios.flatMap(folio => folio.state.model.instances.map(item => ({
    model: folio.state.model, instance: item,
    name: safe(instanceLabel(folio.state.model, item)),
  })))
  const uniqueInstanceByName = uniqueByName(canonicalInstances)
  for (const folio of foliosOf(modules.system)) {
    const nodes = Array.isArray(folio.state.nodes)
      ? folio.state.nodes as Record<string, unknown>[] : []
    for (const node of nodes) {
      if (node.type !== 'component') continue
      const data = (node.data ?? {}) as Record<string, unknown>
      const match = uniqueInstanceByName.get(safe(data.label))
      if (match) data.systemRef = {
        system_model_id: match.model.id, instance_id: match.instance.id,
        definition_id: match.instance.definition_id,
      } satisfies CanonicalSystemRef
    }
  }
  const canonicalFailures = systemFolios.flatMap(folio => folio.state.model.instances.flatMap(installed => {
    const owner = folio.state.model.definitions.find(item => item.id === installed.definition_id)
    return (owner?.failure_modes ?? []).map(failure => ({
      model: folio.state.model, instance: installed, failure,
      name: safe(failure.description),
    }))
  }))
  const uniqueFailureByName = uniqueByName(canonicalFailures)
  for (const folio of foliosOf(modules.faultTree)) {
    const nodes = Array.isArray(folio.state.nodes)
      ? folio.state.nodes as Record<string, unknown>[] : []
    for (const node of nodes) {
      const data = (node.data ?? {}) as Record<string, unknown>
      const match = uniqueFailureByName.get(safe(data.label))
      if (match) data.systemRef = {
        system_model_id: match.model.id, instance_id: match.instance.id,
        definition_id: match.instance.definition_id,
        failure_mode_id: match.failure.id,
      } satisfies CanonicalSystemRef
    }
  }
  for (const folio of foliosOf(modules.markov)) {
    const states = Array.isArray(folio.state.states)
      ? folio.state.states as Record<string, unknown>[] : []
    for (const item of states) {
      const instanceMatch = uniqueInstanceByName.get(safe(item.name))
      const failureMatch = uniqueFailureByName.get(safe(item.name))
      const match = failureMatch ?? instanceMatch
      if (!match) continue
      item.systemRef = failureMatch ? {
        system_model_id: failureMatch.model.id, instance_id: failureMatch.instance.id,
        definition_id: failureMatch.instance.definition_id,
        failure_mode_id: failureMatch.failure.id,
      } : {
        system_model_id: instanceMatch!.model.id, instance_id: instanceMatch!.instance.id,
        definition_id: instanceMatch!.instance.definition_id,
      }
    }
  }
  modules.systemDefinition = {
    _folioWrap: true, activeId: systemFolios[0].id, folios: systemFolios,
  }
  return modules
}

export function instanceLabel(model: SystemDefinitionModel, item: SystemBlockInstance): string {
  return item.name || model.definitions.find(value => value.id === item.definition_id)?.name || item.id
}

export function decisionStatus(
  state: SystemDefinitionState, proposalId: string,
): 'accepted'|'rejected'|'stale'|'pending' {
  const decision = state.decisions.find(item => item.proposal_id === proposalId)
  if (!decision) return 'pending'
  return decision.fingerprint === state.propagation?.fingerprint
    ? decision.status : 'stale'
}
