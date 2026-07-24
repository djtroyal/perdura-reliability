import Papa from 'papaparse'

import { downloadArtifact } from '../../store/artifactExport'
import type {
  ActionPriority,
  AIAGVDAFMEAAnalysis,
  FMEABlockDiagram,
  FMEABlockDiagramNode,
  FMEAControlPlanRow,
  FMEAFailureChain,
  FMEAFunctionalRequirement,
  FMEAFunction,
  FMEAFunctionLink,
  FMEAFunctionRequirementLink,
  FMEAInterface,
  FMEAKind,
  FMEAPDiagram,
  FMEAPDiagramItem,
  FMEAStructureNode,
  FMEAStructureSourceRef,
  RequirementInput,
} from '../../api/reliabilityProgram'
import { classifyFunctionStatement } from './fmeaVocabulary'


export const FMEA_STEPS = [
  'Planning & preparation',
  'Structure analysis',
  'Function analysis',
  'Failure analysis',
  'Risk analysis',
  'Optimization',
  'Results documentation',
] as const

export const FMES_GROUP_DIMENSIONS = [
  {
    value: 'effect',
    label: 'Common effect',
    description: 'Consolidate failure modes that use the same stated effect.',
  },
  {
    value: 'effect_context',
    label: 'Effect context',
    description: 'Review effects at a stakeholder or system hierarchy level.',
  },
  {
    value: 'effect_level',
    label: 'Effect level / classification',
    description: 'Roll up chains by their controlled effect classification.',
  },
  {
    value: 'function',
    label: 'Function',
    description: 'Review the failure modes associated with each intended function.',
  },
  {
    value: 'structure',
    label: 'Structure item',
    description: 'Roll up the failure chains allocated to each system element or process step.',
  },
  {
    value: 'operating_mode',
    label: 'Operating mode',
    description: 'Review chains by the operating modes assigned to their function.',
  },
  {
    value: 'failure_mode',
    label: 'Failure mode',
    description: 'Consolidate repeated failure-mode statements across functions and causes.',
  },
  {
    value: 'cause',
    label: 'Cause / mechanism',
    description: 'Find common causes or mechanisms across failure modes.',
  },
  {
    value: 'action_priority',
    label: 'Action Priority',
    description: 'Review the initial H, M, and L Action Priority populations.',
  },
  {
    value: 'hazard',
    label: 'Linked hazard',
    description: 'Review the failure chains supporting each linked hazard.',
  },
] as const

export type FmesGroupDimension =
  typeof FMES_GROUP_DIMENSIONS[number]['value']

export type FmesChain = FMEAFailureChain & {
  action_priority?: ActionPriority
  post_action_priority?: ActionPriority|null
}

export interface FmesSummaryGroup {
  key: string
  label: string
  chains: FmesChain[]
  failure_modes: string[]
  causes: string[]
  functions: string[]
  linked_hazards: string[]
  maximum_severity: number
  highest_action_priority: ActionPriority|null
  highest_post_action_priority: ActionPriority|null
  open_actions: number
  subgroups: FmesSummaryGroup[]
}

interface FmesGroupingContext {
  functionById: Map<string, AIAGVDAFMEAAnalysis['functions'][number]>
  structureById: Map<string, AIAGVDAFMEAAnalysis['structure_nodes'][number]>
}

const fmesText = (value: unknown, fallback = 'Not specified') => {
  // This is display-text canonicalization, not an output-encoding boundary.
  // Splitting and rejoining collapses every whitespace run in one pass without
  // relying on a replacement that can itself match the sanitization pattern.
  const text = String(value ?? '').trim().split(/\s+/u).join(' ')
  return text || fallback
}

const fmesKey = (value: string) => value.toLocaleLowerCase()

const fmesUnique = (values: string[]) => {
  const unique = new Map<string, string>()
  for (const item of values) {
    const value = fmesText(item, '')
    if (!value) continue
    if (!unique.has(fmesKey(value))) unique.set(fmesKey(value), value)
  }
  return [...unique.values()].sort((a, b) => a.localeCompare(b))
}

function fmesMemberships(
  chain: FmesChain,
  dimension: FmesGroupDimension,
  context: FmesGroupingContext,
): string[] {
  const fn = chain.function_id
    ? context.functionById.get(chain.function_id)
    : undefined
  if (dimension === 'effect') return [fmesText(chain.effect)]
  if (dimension === 'effect_context') {
    const contexts = (chain.effect_contexts ?? []).map(item => {
      const level = fmesText(item.context, 'Unspecified context')
      const effect = fmesText(item.description, chain.effect)
      return `${level} · ${effect}`
    })
    return contexts.length ? fmesUnique(contexts) : [fmesText(chain.effect)]
  }
  if (dimension === 'effect_level') {
    return [fmesText(chain.effect_level)]
  }
  if (dimension === 'function') {
    return [fn
      ? fmesText(fn.description, `Unnamed function (${fn.id})`)
      : chain.function_id
        ? `Unknown function (${chain.function_id})`
        : 'No function linked']
  }
  if (dimension === 'structure') {
    const structure = fn
      ? context.structureById.get(fn.structure_node_id)
      : undefined
    return [structure
      ? fmesText(structure.name, `Unnamed structure item (${structure.id})`)
      : fn?.structure_node_id
        ? `Unknown structure item (${fn.structure_node_id})`
        : 'No structure item linked']
  }
  if (dimension === 'operating_mode') {
    const modes = fmesUnique(fn?.operating_modes ?? [])
    return modes.length ? modes : ['No operating mode assigned']
  }
  if (dimension === 'failure_mode') {
    return [fmesText(chain.failure_mode)]
  }
  if (dimension === 'cause') return [fmesText(chain.cause)]
  if (dimension === 'action_priority') {
    return [chain.action_priority
      ? `${chain.action_priority} — ${
        chain.action_priority === 'H' ? 'High'
        : chain.action_priority === 'M' ? 'Medium' : 'Low'}`
      : 'Not analyzed']
  }
  return chain.linked_hazard_ids?.length
    ? fmesUnique(chain.linked_hazard_ids)
    : ['No linked hazard']
}

const fmesPriority = (values: (ActionPriority|null|undefined)[]) => {
  const order: Record<ActionPriority, number> = { H: 3, M: 2, L: 1 }
  return values.reduce<ActionPriority|null>((highest, value) => {
    if (!value) return highest
    return !highest || order[value] > order[highest] ? value : highest
  }, null)
}

function fmesAggregate(
  key: string,
  label: string,
  chains: FmesChain[],
  context: FmesGroupingContext,
  thenBy?: FmesGroupDimension,
): FmesSummaryGroup {
  const distinctChains = [...new Map(
    chains.map(chain => [chain.id, chain]),
  ).values()]
  const functionNames = distinctChains.map(chain => {
    const fn = chain.function_id
      ? context.functionById.get(chain.function_id)
      : undefined
    return fn?.description
      ? fn.description
      : chain.function_id
        ? `Unknown function (${chain.function_id})`
        : 'No function linked'
  })
  return {
    key,
    label,
    chains: distinctChains,
    failure_modes: fmesUnique(
      distinctChains.map(chain => chain.failure_mode)),
    causes: fmesUnique(distinctChains.map(chain => chain.cause)),
    functions: fmesUnique(functionNames),
    linked_hazards: fmesUnique(
      distinctChains.flatMap(chain => chain.linked_hazard_ids ?? [])
        .filter(Boolean)),
    maximum_severity: distinctChains.reduce(
      (maximum, chain) => Math.max(maximum, chain.severity || 0), 0),
    highest_action_priority: fmesPriority(
      distinctChains.map(chain => chain.action_priority)),
    highest_post_action_priority: fmesPriority(
      distinctChains.map(chain => chain.post_action_priority)),
    open_actions: distinctChains.reduce((count, chain) =>
      count + chain.actions.filter(action =>
        !['completed', 'not_implemented'].includes(action.status)).length, 0),
    subgroups: thenBy
      ? fmesGroupChains(distinctChains, thenBy, context)
      : [],
  }
}

function fmesGroupChains(
  chains: FmesChain[],
  dimension: FmesGroupDimension,
  context: FmesGroupingContext,
  thenBy?: FmesGroupDimension,
): FmesSummaryGroup[] {
  const groups = new Map<string, { label: string; chains: FmesChain[] }>()
  for (const chain of chains) {
    const memberships = fmesMemberships(chain, dimension, context)
    for (const label of memberships) {
      const key = `${dimension}:${fmesKey(label)}`
      const group = groups.get(key) ?? { label, chains: [] }
      group.chains.push(chain)
      groups.set(key, group)
    }
  }
  return [...groups.entries()]
    .map(([key, group]) =>
      fmesAggregate(key, group.label, group.chains, context, thenBy))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * Build a Failure Modes and Effects Summary without inventing equivalence
 * between differently worded engineering statements. Case and whitespace are
 * normalized, while multi-valued dimensions intentionally allow one chain to
 * appear in more than one group.
 */
export function buildFmesSummary(
  analysis: AIAGVDAFMEAAnalysis,
  groupBy: FmesGroupDimension = 'effect',
  thenBy?: FmesGroupDimension,
  chains: FmesChain[] = analysis.failure_chains,
): FmesSummaryGroup[] {
  const context: FmesGroupingContext = {
    functionById: new Map(
      analysis.functions.map(item => [item.id, item])),
    structureById: new Map(
      analysis.structure_nodes.map(item => [item.id, item])),
  }
  return fmesGroupChains(
    chains,
    groupBy,
    context,
    thenBy && thenBy !== groupBy ? thenBy : undefined,
  )
}

export const DEFAULT_PROFILE: Record<FMEAKind, string> = {
  dfmea: 'aiag_vda_dfmea_public_v1',
  pfmea: 'aiag_vda_pfmea_public_v1',
  fmea_msr: 'aiag_vda_msr_public_v1',
}

export type StructureDropPlacement = 'before'|'inside'|'after'|'root'

export function orderedStructureNodes(
  nodes: FMEAStructureNode[],
): FMEAStructureNode[] {
  const known = new Set(nodes.map(node => node.id))
  const children = new Map<string, FMEAStructureNode[]>()
  for (const node of nodes) {
    const parent = node.parent_id && known.has(node.parent_id)
      ? node.parent_id
      : ''
    children.set(parent, [...(children.get(parent) ?? []), node])
  }
  const ordered: FMEAStructureNode[] = []
  const visited = new Set<string>()
  const visit = (node: FMEAStructureNode) => {
    if (visited.has(node.id)) return
    visited.add(node.id)
    ordered.push(node)
    for (const child of children.get(node.id) ?? []) visit(child)
  }
  for (const root of children.get('') ?? []) visit(root)
  for (const node of nodes) visit(node)
  return ordered
}

export function structureNodeOrdinals(
  nodes: FMEAStructureNode[],
): Map<string, string> {
  const known = new Set(nodes.map(node => node.id))
  const children = new Map<string, FMEAStructureNode[]>()
  for (const node of nodes) {
    const parent = node.parent_id && known.has(node.parent_id)
      ? node.parent_id
      : ''
    children.set(parent, [...(children.get(parent) ?? []), node])
  }
  const result = new Map<string, string>()
  const visit = (node: FMEAStructureNode, ordinal: string) => {
    if (result.has(node.id)) return
    result.set(node.id, ordinal)
    ;(children.get(node.id) ?? []).forEach((child, index) =>
      visit(child, `${ordinal}.${index + 1}`))
  }
  let rootIndex = 0
  for (const root of children.get('') ?? []) {
    rootIndex += 1
    visit(root, String(rootIndex))
  }
  for (const node of nodes) {
    if (result.has(node.id)) continue
    rootIndex += 1
    visit(node, String(rootIndex))
  }
  return result
}

export function structureNodeDepth(
  nodes: FMEAStructureNode[],
  nodeId: string,
): number {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const visited = new Set<string>()
  let current = byId.get(nodeId)
  let depth = 0
  while (current?.parent_id && byId.has(current.parent_id)) {
    if (visited.has(current.parent_id)) return depth
    visited.add(current.parent_id)
    depth += 1
    current = byId.get(current.parent_id)
  }
  return depth
}

export function arrangeStructureNodes(
  nodes: FMEAStructureNode[],
  draggedId: string,
  targetId: string | undefined,
  placement: StructureDropPlacement,
): FMEAStructureNode[] {
  const dragged = nodes.find(node => node.id === draggedId)
  const target = targetId
    ? nodes.find(node => node.id === targetId)
    : undefined
  if (!dragged || (placement !== 'root' && !target)) return nodes
  if (target?.id === dragged.id) return nodes
  if (target) {
    const byId = new Map(nodes.map(node => [node.id, node]))
    const visited = new Set<string>()
    let ancestor = target
    while (ancestor.parent_id && byId.has(ancestor.parent_id)) {
      if (ancestor.parent_id === dragged.id) return nodes
      if (visited.has(ancestor.parent_id)) return nodes
      visited.add(ancestor.parent_id)
      ancestor = byId.get(ancestor.parent_id)!
    }
  }

  const moved: FMEAStructureNode = {
    ...dragged,
    parent_id: placement === 'root'
      ? undefined
      : placement === 'inside'
        ? target!.id
        : target!.parent_id,
  }
  const remaining = nodes.filter(node => node.id !== dragged.id)
  if (placement === 'root') return [...remaining, moved]
  const targetIndex = remaining.findIndex(node => node.id === target!.id)
  const insertAt = placement === 'before' ? targetIndex : targetIndex + 1
  remaining.splice(Math.max(0, insertAt), 0, moved)
  return remaining
}

export function indentStructureNode(
  nodes: FMEAStructureNode[],
  nodeId: string,
): FMEAStructureNode[] {
  const node = nodes.find(item => item.id === nodeId)
  if (!node) return nodes
  const siblings = nodes.filter(item =>
    (item.parent_id ?? '') === (node.parent_id ?? ''))
  const siblingIndex = siblings.findIndex(item => item.id === nodeId)
  if (siblingIndex <= 0) return nodes
  return arrangeStructureNodes(
    nodes,
    nodeId,
    siblings[siblingIndex - 1].id,
    'inside',
  )
}

export function outdentStructureNode(
  nodes: FMEAStructureNode[],
  nodeId: string,
): FMEAStructureNode[] {
  const node = nodes.find(item => item.id === nodeId)
  if (!node?.parent_id) return nodes
  return arrangeStructureNodes(nodes, nodeId, node.parent_id, 'after')
}

export function removeStructureNode(
  nodes: FMEAStructureNode[],
  nodeId: string,
): FMEAStructureNode[] {
  const node = nodes.find(item => item.id === nodeId)
  if (!node) return nodes
  return orderedStructureNodes(nodes)
    .filter(item => item.id !== nodeId)
    .map(item => item.parent_id === nodeId
      ? { ...item, parent_id: node.parent_id }
      : item)
}

const defaultAnalysisName = (kind: FMEAKind) =>
  `New ${kind === 'fmea_msr' ? 'FMEA-MSR' : kind.toUpperCase()}`

const id = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

export function defaultFmeaBlockDiagram(label = ''): FMEABlockDiagram {
  return {
    version: 2,
    density: 'comfortable',
    boundary: {
      label,
      x: 80,
      y: 80,
      width: 900,
      height: 560,
    },
    nodes: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    snap_to_grid: true,
  }
}

export function createFmeaAnalysis(
  kind: FMEAKind,
  sequence: number,
): AIAGVDAFMEAAnalysis {
  return {
    id: `${kind.toUpperCase().replace('_', '-')}-${sequence}`,
    name: defaultAnalysisName(kind),
    kind,
    revision: 'A',
    status: 'draft',
    rating_profile_id: DEFAULT_PROFILE[kind],
    planning: {
      company: '', location: '', customer: '', model_program: '',
      subject: '', scope: '', exclusions: '', intent: '', timing: '',
      tasks: '', tools: '', team: [], owner: '', confidentiality: '',
      assumptions: '',
    },
    structure_nodes: [],
    block_diagram: defaultFmeaBlockDiagram(defaultAnalysisName(kind)),
    functions: [],
    function_links: [],
    functional_requirements: [],
    function_requirement_links: [],
    interfaces: [],
    p_diagrams: [],
    failure_chains: [],
    control_plan: [],
    standalone_justification: '',
  }
}

function hasValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasValue)
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(hasValue)
  }
  return typeof value === 'string' ? value.trim().length > 0 : value != null
}

/**
 * Describe substantive content that would be lost when an FMEA sheet is
 * deleted. Generated IDs, the default title/revision/status, and the default
 * rating profile do not make a newly-created sheet "populated".
 */
export function describeFmeaContents(
  analysis: AIAGVDAFMEAAnalysis,
): string[] {
  const contents: string[] = []
  const quantity = (count: number, singular: string) =>
    `${count} ${singular}${count === 1 ? '' : 's'}`

  if (hasValue(analysis.planning)) contents.push('planning details')
  if (analysis.structure_nodes.length) {
    contents.push(quantity(analysis.structure_nodes.length, 'structure element'))
  }
  const externalDiagramBlocks = analysis.block_diagram.nodes.filter(
    item => item.kind === 'external').length
  if (externalDiagramBlocks) {
    contents.push(quantity(externalDiagramBlocks, 'external diagram block'))
  }
  if (analysis.functions.length) {
    contents.push(quantity(analysis.functions.length, 'function'))
  }
  if (analysis.functional_requirements.length) {
    contents.push(quantity(
      analysis.functional_requirements.length, 'functional requirement'))
  }
  if (analysis.interfaces.length) {
    contents.push(quantity(analysis.interfaces.length, 'interface'))
  }
  if (analysis.p_diagrams.length) {
    contents.push(quantity(analysis.p_diagrams.length, 'P-diagram'))
  }
  if (analysis.failure_chains.length) {
    contents.push(quantity(analysis.failure_chains.length, 'failure chain'))
  }
  if (analysis.control_plan.length) {
    contents.push(quantity(analysis.control_plan.length, 'Control Plan row'))
  }

  const editedMetadata =
    analysis.name.trim() !== defaultAnalysisName(analysis.kind)
    || analysis.revision.trim() !== 'A'
    || analysis.status !== 'draft'
    || (analysis.rating_profile_id ?? DEFAULT_PROFILE[analysis.kind])
      !== DEFAULT_PROFILE[analysis.kind]
    || hasValue(analysis.parent_dfmea_id)
    || hasValue(analysis.source_revision)
    || hasValue(analysis.standalone_justification)
    || hasValue(analysis.template_source_id)
    || hasValue(analysis.template_source_revision)
    || hasValue(analysis.template_source_checksum)
  if (editedMetadata) contents.push('edited sheet metadata')

  return contents
}

export function hasFmeaContents(analysis: AIAGVDAFMEAAnalysis): boolean {
  return describeFmeaContents(analysis).length > 0
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stable(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0')).join('')
}

type LegacyFunction = AIAGVDAFMEAAnalysis['functions'][number] & {
  requirement?: string
  characteristic_type?: string
  specification?: string
}

type LegacyInterface = Partial<FMEAInterface> & {
  id: string
  name?: string
  interface_type?: string
}

function canonicalInterfaceType(
  value?: string,
): FMEAInterface['interface_type'] {
  if (value === 'physical' || value === 'energy' || value === 'information'
      || value === 'material' || value === 'human_machine'
      || value === 'clearance') return value
  if (value === 'mechanical') return 'physical'
  if (value === 'human') return 'human_machine'
  if (value === 'signal' || value === 'data') return 'information'
  if (value === 'environmental') return 'energy'
  return 'information'
}

/**
 * Upgrade the immediately preceding Function Analysis shape once, then return
 * only the current contract. This is intentionally a normalization boundary,
 * not a permanent dual-schema renderer.
 */
export function normalizeFmeaAnalysis(
  source: AIAGVDAFMEAAnalysis,
): AIAGVDAFMEAAnalysis {
  const analysis = structuredClone(source)
  const legacyFunctions = (analysis.functions ?? []) as unknown as LegacyFunction[]
  const functionalRequirements = [
    ...(analysis.functional_requirements ?? []),
  ]
  const requirementLinks = [
    ...(analysis.function_requirement_links ?? []),
  ]
  const usedRequirementIds = new Set(
    functionalRequirements.map(item => item.id))
  const usedLinkIds = new Set(requirementLinks.map(item => item.id))
  const blockDiagram = structuredClone(
    (analysis as AIAGVDAFMEAAnalysis & {
      block_diagram?: FMEABlockDiagram
    }).block_diagram
      ?? defaultFmeaBlockDiagram(
        analysis.planning?.subject || analysis.name,
      ),
  )
  const diagramNodeIds = new Set(blockDiagram.nodes.map(item => item.id))
  let diagramSequence = blockDiagram.nodes.length + 1
  const nextDiagramId = () => {
    let value = `BDN-${diagramSequence++}`
    while (diagramNodeIds.has(value)) value = `BDN-${diagramSequence++}`
    diagramNodeIds.add(value)
    return value
  }
  const ensureStructureBlock = (structureId: string) => {
    const existing = blockDiagram.nodes.find(item =>
      item.kind === 'structure'
      && item.structure_node_id === structureId)
    if (existing) return existing.id
    const structure = analysis.structure_nodes.find(
      item => item.id === structureId)
    const index = blockDiagram.nodes.filter(
      item => item.kind === 'structure').length
    const created = {
      id: nextDiagramId(),
      kind: 'structure' as const,
      structure_node_id: structureId,
      label: structure?.name || structureId,
      x: 150 + (index % 4) * 210,
      y: 150 + Math.floor(index / 4) * 120,
      width: 180,
      height: 72,
      inside_boundary: true,
    }
    blockDiagram.nodes.push(created)
    return created.id
  }
  const ensureExternalBlock = (label: string) => {
    const normalized = label.trim()
    const existing = blockDiagram.nodes.find(item =>
      item.kind === 'external'
      && item.label.trim().toLowerCase() === normalized.toLowerCase())
    if (existing) return existing.id
    const index = blockDiagram.nodes.filter(
      item => item.kind === 'external').length
    const created = {
      id: nextDiagramId(),
      kind: 'external' as const,
      label: normalized || 'External element',
      external_kind: 'adjacent_system' as const,
      x: 1040,
      y: 120 + index * 100,
      width: 180,
      height: 72,
      inside_boundary: false,
    }
    blockDiagram.nodes.push(created)
    return created.id
  }
  blockDiagram.nodes = blockDiagram.nodes.map(node => {
    if (node.kind !== 'structure') return {
      ...node,
      container_parent_block_id: undefined,
      expanded: false,
    }
    const structure = analysis.structure_nodes.find(
      item => item.id === node.structure_node_id)
    const container = blockDiagram.nodes.find(
      item => item.id === node.container_parent_block_id)
    const containerStructure = analysis.structure_nodes.find(
      item => item.id === container?.structure_node_id)
    const validContainer = structure
      && container?.kind === 'structure'
      && structure.parent_id === containerStructure?.id
    return {
      ...node,
      label: structure?.name ?? node.label,
      expanded: Boolean(node.expanded),
      container_parent_block_id: validContainer
        ? node.container_parent_block_id : undefined,
    }
  })
  const normalizedDiagramById = new Map(
    blockDiagram.nodes.map(node => [node.id, node]))
  const inheritedBoundaryScope = (
    node: FMEABlockDiagramNode,
    trail = new Set<string>(),
  ): boolean => {
    if (!node.container_parent_block_id || trail.has(node.id)) {
      return node.inside_boundary
    }
    const parent = normalizedDiagramById.get(node.container_parent_block_id)
    if (!parent) return node.inside_boundary
    return inheritedBoundaryScope(parent, new Set(trail).add(node.id))
  }
  blockDiagram.nodes = blockDiagram.nodes.map(node => ({
    ...node,
    inside_boundary: inheritedBoundaryScope(node),
  }))
  blockDiagram.density = [
    'dense', 'compact', 'comfortable', 'spacious', 'expanded',
  ].includes(blockDiagram.density)
    ? blockDiagram.density : 'comfortable'
  blockDiagram.version = 2
  const interfaces = ((analysis.interfaces ?? []) as unknown as LegacyInterface[])
    .map(raw => {
      const sourceBlockId = raw.source_block_id
        || (raw.source_structure_node_id
          ? ensureStructureBlock(raw.source_structure_node_id)
          : raw.external_source
            ? ensureExternalBlock(raw.external_source)
            : undefined)
      const targetBlockId = raw.target_block_id
        || (raw.target_structure_node_id
          ? ensureStructureBlock(raw.target_structure_node_id)
          : raw.external_target
            ? ensureExternalBlock(raw.external_target)
            : undefined)
      const interfaceType = canonicalInterfaceType(raw.interface_type)
      return {
        id: raw.id,
        name: raw.name ?? '',
        interface_type: interfaceType,
        source_block_id: sourceBlockId,
        target_block_id: targetBlockId,
        source_handle: raw.source_handle,
        target_handle: raw.target_handle,
        linkage: raw.linkage
          ?? (interfaceType === 'clearance' ? 'indirect' : 'direct'),
        directionality: raw.directionality
          ?? (interfaceType === 'physical' || interfaceType === 'clearance'
            ? 'undirected' : 'directed'),
        relationship_strength: raw.relationship_strength ?? 'unspecified',
        relationship_nature: raw.relationship_nature ?? 'unspecified',
        interface_detail: raw.interface_detail ?? '',
        source_structure_node_id: raw.source_structure_node_id,
        target_structure_node_id: raw.target_structure_node_id,
        external_source: raw.external_source ?? '',
        external_target: raw.external_target ?? '',
        flow_description: raw.flow_description ?? '',
        operating_condition: raw.operating_condition ?? '',
        function_ids: raw.function_ids ?? [],
        requirement_ids: raw.requirement_ids ?? [],
      } satisfies FMEAInterface
    })

  const functions = legacyFunctions.map(raw => {
    const {
      requirement = '',
      characteristic_type = '',
      specification = '',
      ...current
    } = raw
    if ([requirement, characteristic_type, specification]
      .some(value => String(value).trim())) {
      let requirementId = `FREQ-${raw.id}`
      let suffix = 2
      while (usedRequirementIds.has(requirementId)) {
        requirementId = `FREQ-${raw.id}-${suffix++}`
      }
      usedRequirementIds.add(requirementId)
      functionalRequirements.push({
        id: requirementId,
        statement: requirement || `${raw.description} requirement`,
        requirement_type: normalizeLegacyRequirementType(characteristic_type),
        measure: '',
        target: '',
        unit: '',
        acceptance_criteria: specification,
        operating_condition: '',
        source: 'Migrated from inline FMEA function requirement',
        owner: '',
        confidence: '',
        verification_method: '',
        evidence_ids: [],
        special_characteristic: characteristic_type,
      })
      let linkId = `FRC-${raw.id}`
      let linkSuffix = 2
      while (usedLinkIds.has(linkId)) linkId = `FRC-${raw.id}-${linkSuffix++}`
      usedLinkIds.add(linkId)
      requirementLinks.push({
        id: linkId,
        function_id: raw.id,
        requirement_id: requirementId,
        strength: 'strong',
        rationale: 'Migrated from the prior inline requirement.',
      })
    }
    const vocabularyMatch = classifyFunctionStatement(current.description)
    return {
      id: current.id,
      structure_node_id: current.structure_node_id,
      description: current.description,
      canonical_verb_id: current.canonical_verb_id
        ?? ((vocabularyMatch.status === 'canonical'
          || vocabularyMatch.status === 'alias')
          ? vocabularyMatch.term?.id : undefined),
      function_type: current.function_type ?? 'primary',
      operating_modes: current.operating_modes ?? [],
      owner: current.owner ?? '',
      notes: current.notes ?? '',
    }
  })
  return {
    ...analysis,
    block_diagram: blockDiagram,
    functions,
    function_links: analysis.function_links ?? [],
    functional_requirements: functionalRequirements,
    function_requirement_links: requirementLinks,
    interfaces,
    p_diagrams: analysis.p_diagrams ?? [],
  }
}

function normalizeLegacyRequirementType(
  value: string,
): FMEAFunctionalRequirement['requirement_type'] {
  const normalized = value.trim().toLowerCase()
  if (normalized.includes('process')) return 'process'
  if (normalized.includes('performance')) return 'performance'
  if (normalized.includes('interface')) return 'interface'
  if (normalized.includes('safety')) return 'safety'
  if (normalized.includes('regulat')) return 'regulatory'
  if (normalized.includes('customer')) return 'customer'
  return 'functional'
}

export function programRequirementSnapshot(requirement: RequirementInput) {
  return {
    statement: requirement.statement,
    measure: requirement.measure,
    target: requirement.target,
    confidence: requirement.confidence,
    operating_condition: requirement.mission_profile,
    acceptance_criteria: requirement.failure_definition,
    verification_method: requirement.verification_method,
    owner: requirement.owner,
    evidence_ids: requirement.evidence_ids,
  }
}

export async function synchronizeProgramRequirement(
  current: FMEAFunctionalRequirement,
  source: RequirementInput,
): Promise<FMEAFunctionalRequirement> {
  const snapshot = programRequirementSnapshot(source)
  return {
    ...current,
    ...snapshot,
    verification_method_id: undefined,
    source: `Reliability Program requirement ${source.id}`,
    linked_program_requirement_id: source.id,
    source_checksum: await sha256(snapshot),
  }
}

export async function copyFmeaFoundation(
  source: AIAGVDAFMEAAnalysis,
  sequence: number,
): Promise<AIAGVDAFMEAAnalysis> {
  const copy = structuredClone(source)
  const checksum = await sha256(source)
  copy.id = `${source.kind.toUpperCase().replace('_', '-')}-${sequence}`
  copy.name = `${source.name} — working copy`
  copy.revision = 'A'
  copy.status = 'draft'
  copy.template_source_id = source.id
  copy.template_source_revision = source.revision
  copy.template_source_checksum = checksum
  copy.planning.foundation_source_id = source.id
  copy.planning.foundation_source_revision = source.revision
  copy.planning.foundation_checksum = checksum
  copy.failure_chains = copy.failure_chains.map(chain => ({
    ...chain,
    actions: chain.actions.map(action => ({
      ...action,
      id: id('ACT'),
      status: 'open',
      completion_date: undefined,
      evidence_ids: [],
    })),
    post_severity: undefined,
    post_occurrence: undefined,
    post_detection: undefined,
    post_frequency: undefined,
    post_monitoring: undefined,
  }))
  copy.control_plan = copy.control_plan.map(row => ({
    ...row, id: id('CP'), source_revision: source.revision, stale: true,
  }))
  return copy
}

export const IMPORT_FIELDS = [
  'id', 'function_id', 'effect', 'failure_mode', 'cause', 'effect_level',
  'severity', 'occurrence', 'detection', 'frequency', 'monitoring',
  'prevention_controls', 'detection_controls', 'severity_rationale',
  'occurrence_rationale', 'detection_rationale', 'frequency_rationale',
  'monitoring_rationale', 'no_action_justification',
] as const
export type ImportField = typeof IMPORT_FIELDS[number]
export type ColumnMapping = Partial<Record<ImportField, string>>
export type FmeaWorkbookSheets = Record<string, Record<string, string>[]>

const ALIASES: Record<ImportField, RegExp[]> = {
  id: [/^id$/, /failure.*id/, /chain.*id/],
  function_id: [/function.*id/, /^function$/],
  effect: [/^effect$/, /failure.*effect/, /end.*effect/],
  failure_mode: [/failure.*mode/, /^mode$/],
  cause: [/^cause$/, /(?:failure|potential).*cause/, /mechanism/],
  effect_level: [/effect.*level/, /classification/, /special.*characteristic/],
  severity: [/^s$/, /^severity/, /sev.*rating/],
  occurrence: [/^o$/, /^occurrence/, /occ.*rating/],
  detection: [/^d$/, /^detection/, /det.*rating/],
  frequency: [/^f$/, /^frequency/, /freq.*rating/],
  monitoring: [/^m$/, /^monitoring/, /monitor.*rating/],
  prevention_controls: [/prevention.*control/, /current.*prevention/],
  detection_controls: [/detection.*control/, /current.*detection/],
  severity_rationale: [/severity.*rationale/, /severity.*basis/],
  occurrence_rationale: [/occurrence.*rationale/, /occurrence.*basis/],
  detection_rationale: [/detection.*rationale/, /detection.*basis/],
  frequency_rationale: [/frequency.*rationale/, /frequency.*basis/],
  monitoring_rationale: [/monitoring.*rationale/, /monitoring.*basis/],
  no_action_justification: [/no.*action.*justification/, /disposition.*rationale/],
}

const normalized = (value: string) =>
  value.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')

export function detectFmeaMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {}
  for (const field of IMPORT_FIELDS) {
    const match = headers.find(header =>
      ALIASES[field].some(pattern => pattern.test(normalized(header))))
    if (match) mapping[field] = match
  }
  return mapping
}

export async function readFmeaFile(file: File): Promise<{
  headers: string[]
  rows: Record<string, string>[]
  sheets?: FmeaWorkbookSheets
}> {
  if (/\.xlsx$/i.test(file.name)) {
    const { default: readXlsxFile } = await import('read-excel-file/browser')
    const sheets = await readXlsxFile(await file.arrayBuffer())
    const parsedSheets: FmeaWorkbookSheets = {}
    for (const sheet of sheets) {
      const headers = (sheet.data[0] ?? []).map(
        value => String(value ?? '').trim())
      parsedSheets[sheet.sheet] = sheet.data.slice(1)
        .filter(values => values.some(value => String(value ?? '').trim()))
        .map(values => Object.fromEntries(headers.map(
          (header, index) => [header, String(values[index] ?? '').trim()])))
    }
    const first = sheets.find(sheet => sheet.sheet === 'FMEA Worksheet')
      ?? sheets[0]
    const matrix = first?.data ?? []
    const headers = (matrix[0] ?? []).map(value => String(value ?? '').trim())
    const rows = matrix.slice(1).map(values => Object.fromEntries(
      headers.map((header, index) => [header, String(values[index] ?? '').trim()])))
    return { headers, rows, sheets: parsedSheets }
  }
  const text = await file.text()
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true, skipEmptyLines: true,
  })
  if (parsed.errors.length) throw new Error(parsed.errors[0].message)
  const headers = parsed.meta.fields ?? []
  return { headers, rows: parsed.data }
}

const rating = (value: string | undefined, fallback = 5) => {
  const number = Number(value)
  return Number.isInteger(number) && number >= 1 && number <= 10
    ? number : fallback
}

export function importedFailureChains(
  rows: Record<string, string>[],
  mapping: ColumnMapping,
  kind: FMEAKind,
): FMEAFailureChain[] {
  const get = (row: Record<string, string>, field: ImportField) =>
    mapping[field] ? String(row[mapping[field]!] ?? '').trim() : ''
  return rows.filter(row => Object.values(row).some(Boolean)).map((row, index) => ({
    id: get(row, 'id') || `FC-${index + 1}`,
    function_id: get(row, 'function_id') || undefined,
    effect: get(row, 'effect'),
    effect_contexts: [],
    failure_mode: get(row, 'failure_mode'),
    cause: get(row, 'cause'),
    effect_level: get(row, 'effect_level'),
    severity: rating(get(row, 'severity')),
    occurrence: kind === 'fmea_msr' ? undefined : rating(get(row, 'occurrence')),
    detection: kind === 'fmea_msr' ? undefined : rating(get(row, 'detection')),
    frequency: kind === 'fmea_msr' ? rating(get(row, 'frequency')) : undefined,
    monitoring: kind === 'fmea_msr' ? rating(get(row, 'monitoring')) : undefined,
    prevention_controls: get(row, 'prevention_controls'),
    detection_controls: get(row, 'detection_controls'),
    severity_rationale: get(row, 'severity_rationale'),
    occurrence_rationale: get(row, 'occurrence_rationale'),
    detection_rationale: get(row, 'detection_rationale'),
    frequency_rationale: get(row, 'frequency_rationale'),
    monitoring_rationale: get(row, 'monitoring_rationale'),
    actions: [],
    no_action_justification: get(row, 'no_action_justification'),
    post_severity_rationale: '',
    linked_hazard_ids: [],
    linked_fracas_ids: [],
    monitoring_system: '',
    system_response: '',
    safe_state: '',
    mitigated_effect: '',
    management_review_status: '',
    management_review_evidence_ids: [],
    remarks: '',
  }))
}

export function worksheetRows(analysis: AIAGVDAFMEAAnalysis) {
  const functionById = new Map(
    analysis.functions.map(item => [item.id, item.description]))
  return analysis.failure_chains.map(chain => ({
    analysis_id: analysis.id,
    analysis_name: analysis.name,
    kind: analysis.kind,
    revision: analysis.revision,
    id: chain.id,
    function_id: chain.function_id ?? '',
    function: chain.function_id
      ? functionById.get(chain.function_id) ?? ''
      : '',
    effect: chain.effect,
    failure_mode: chain.failure_mode,
    cause: chain.cause,
    effect_level: chain.effect_level,
    severity: chain.severity,
    occurrence: chain.occurrence ?? '',
    detection: chain.detection ?? '',
    frequency: chain.frequency ?? '',
    monitoring: chain.monitoring ?? '',
    prevention_controls: chain.prevention_controls,
    detection_controls: chain.detection_controls,
    no_action_justification: chain.no_action_justification,
  }))
}

export async function exportFmeaCsv(analysis: AIAGVDAFMEAAnalysis) {
  const content = Papa.unparse(
    worksheetRows(analysis), { escapeFormulae: true })
  await downloadArtifact(
    content,
    `${analysis.id}.csv`,
    'text/csv;charset=utf-8',
    {
      kind: 'fmea-worksheet-csv',
      title: `${analysis.name} consolidated worksheet`,
      moduleKey: 'reliabilityProgram',
    },
  )
}

const xml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function columnName(index: number) {
  let value = index + 1
  let result = ''
  while (value) {
    value -= 1
    result = String.fromCharCode(65 + value % 26) + result
    value = Math.floor(value / 26)
  }
  return result
}

export async function exportFmeaXlsx(analysis: AIAGVDAFMEAAnalysis) {
  const workbook = functionWorkbookSheets(analysis)
  const worksheets = workbook.map(({ rows }) => {
    const headers = Object.keys(rows[0] ?? { id: '' })
    return [headers, ...rows.map(row => headers.map(header => row[header]))]
  })
  const sheetXml = (matrix: unknown[][]) => matrix.map((row, rowIndex) =>
    `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
      const ref = `${columnName(columnIndex)}${rowIndex + 1}`
      return typeof value === 'number'
        ? `<c r="${ref}"><v>${value}</v></c>`
        : `<c r="${ref}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`
    }).join('')}</row>`).join('')
  const encoder = new TextEncoder()
  const { zipSync } = await import('fflate')
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': encoder.encode(
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      workbook.map((_, index) =>
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '</Types>'),
    '_rels/.rels': encoder.encode(
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>'),
    'xl/workbook.xml': encoder.encode(
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<sheets>${workbook.map((item, index) =>
        `<sheet name="${xml(item.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': encoder.encode(
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      workbook.map((_, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('') +
      '</Relationships>'),
  }
  worksheets.forEach((matrix, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = encoder.encode(
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      `<sheetData>${sheetXml(matrix)}</sheetData></worksheet>`)
  })
  await downloadArtifact(
    zipSync(files),
    `${analysis.id}.xlsx`,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    {
      kind: 'fmea-workbook-xlsx',
      title: `${analysis.name} FMEA workbook`,
      moduleKey: 'reliabilityProgram',
    },
  )
}

type WorkbookCell = string|number|boolean|null|undefined
type WorkbookRow = Record<string, WorkbookCell>

export function functionWorkbookSheets(
  analysis: AIAGVDAFMEAAnalysis,
): { name: string; rows: WorkbookRow[] }[] {
  const jsonList = (values: string[]) => JSON.stringify(values)
  const structures: WorkbookRow[] = analysis.structure_nodes.map(item => ({
    id: item.id, name: item.name, level: item.level,
    parent_id: item.parent_id ?? '', description: item.description,
    interface: item.interface, element_type: item.element_type ?? '',
    prediction_source_ref: item.source_ref
      ? JSON.stringify(item.source_ref) : '',
  }))
  const functions: WorkbookRow[] = analysis.functions.map(item => ({
    id: item.id, structure_node_id: item.structure_node_id,
    description: item.description, function_type: item.function_type,
    operating_modes: jsonList(item.operating_modes), owner: item.owner,
    notes: item.notes,
  }))
  const requirements: WorkbookRow[] =
    analysis.functional_requirements.map(item => ({
      ...item,
      evidence_ids: jsonList(item.evidence_ids),
      linked_program_requirement_id: item.linked_program_requirement_id ?? '',
      source_checksum: item.source_checksum ?? '',
    }))
  const correlations: WorkbookRow[] =
    analysis.function_requirement_links.map(item => ({ ...item }))
  const functionLinks: WorkbookRow[] =
    analysis.function_links.map(item => ({ ...item }))
  const interfaces: WorkbookRow[] = analysis.interfaces.map(item => ({
    ...item,
    source_structure_node_id: item.source_structure_node_id ?? '',
    target_structure_node_id: item.target_structure_node_id ?? '',
    function_ids: jsonList(item.function_ids),
    requirement_ids: jsonList(item.requirement_ids),
  }))
  const blockDiagram: WorkbookRow[] = [{
    record_type: 'boundary',
    id: 'analysis-boundary',
    kind: '',
    structure_node_id: '',
    label: analysis.block_diagram.boundary.label,
    external_kind: '',
    x: analysis.block_diagram.boundary.x,
    y: analysis.block_diagram.boundary.y,
    width: analysis.block_diagram.boundary.width,
    height: analysis.block_diagram.boundary.height,
    inside_boundary: true,
    viewport_x: analysis.block_diagram.viewport.x,
    viewport_y: analysis.block_diagram.viewport.y,
    viewport_zoom: analysis.block_diagram.viewport.zoom,
    snap_to_grid: analysis.block_diagram.snap_to_grid,
    density: analysis.block_diagram.density,
  }, ...analysis.block_diagram.nodes.map(item => ({
    record_type: 'node',
    id: item.id,
    kind: item.kind,
    structure_node_id: item.structure_node_id ?? '',
    label: item.label,
    external_kind: item.external_kind ?? '',
    container_parent_block_id: item.container_parent_block_id ?? '',
    expanded: Boolean(item.expanded),
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
    inside_boundary: item.inside_boundary,
    viewport_x: '',
    viewport_y: '',
    viewport_zoom: '',
    snap_to_grid: '',
  }))]
  const pDiagrams: WorkbookRow[] = analysis.p_diagrams.flatMap(diagram => {
    const base = {
      diagram_id: diagram.id, diagram_title: diagram.title,
      primary_function_id: diagram.primary_function_id,
      supporting_function_ids: jsonList(diagram.supporting_function_ids),
    }
    return diagram.items.length
      ? diagram.items.map(item => ({
          ...base, item_id: item.id, category: item.category,
          label: item.label, description: item.description,
          requirement_ids: jsonList(item.requirement_ids),
        }))
      : [{ ...base, item_id: '', category: '', label: '', description: '',
          requirement_ids: '[]' }]
  })
  const controlPlan: WorkbookRow[] = analysis.control_plan.map(item => ({
    ...item, failure_chain_id: item.failure_chain_id ?? '',
    source_revision: item.source_revision ?? '',
  }))
  return [
    { name: 'FMEA Worksheet', rows: worksheetRows(analysis) },
    { name: 'Structure', rows: structures },
    { name: 'Functions', rows: functions },
    { name: 'Requirements', rows: requirements },
    { name: 'Correlations', rows: correlations },
    { name: 'Function Links', rows: functionLinks },
    { name: 'Block Diagram', rows: blockDiagram },
    { name: 'Interfaces', rows: interfaces },
    { name: 'P-Diagrams', rows: pDiagrams },
    { name: 'Control Plan', rows: controlPlan },
  ]
}

const workbookList = (value: string | undefined): string[] => {
  const text = String(value ?? '').trim()
  if (!text) return []
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) {
      return parsed.map(item => String(item).trim()).filter(Boolean)
    }
  } catch {
    // Accept ordinary delimited lists from edited third-party workbooks.
  }
  return text.split(/[|,;\n]/).map(item => item.trim()).filter(Boolean)
}

const workbookBoolean = (value: string | undefined) =>
  /^(1|true|yes|y)$/i.test(String(value ?? '').trim())

const workbookNumber = (
  value: string | undefined,
  fallback: number,
) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const workbookValue = (
  row: Record<string, string>,
  key: string,
  fallback = '',
) => String(row[key] ?? fallback).trim()

const workbookStructureSource = (
  value: string | undefined,
): FMEAStructureSourceRef|undefined => {
  const text = String(value ?? '').trim()
  if (!text) return undefined
  try {
    const parsed = JSON.parse(text) as Partial<FMEAStructureSourceRef>
    if (parsed.module !== 'prediction'
        || !parsed.analysis_id
        || !parsed.analysis_name
        || !['system', 'block', 'part'].includes(String(parsed.entity_type))
        || !parsed.entity_id
        || !parsed.imported_at
        || !/^[a-f0-9]{64}$/.test(String(parsed.source_checksum ?? ''))
        || !parsed.source_name) return undefined
    return {
      module: 'prediction',
      analysis_id: String(parsed.analysis_id),
      analysis_name: String(parsed.analysis_name),
      entity_type: parsed.entity_type as 'system'|'block'|'part',
      entity_id: String(parsed.entity_id),
      parent_entity_id: parsed.parent_entity_id
        ? String(parsed.parent_entity_id) : undefined,
      imported_at: String(parsed.imported_at),
      source_checksum: String(parsed.source_checksum),
      source_name: String(parsed.source_name),
      reference_designators: Array.isArray(parsed.reference_designators)
        ? parsed.reference_designators.map(String) : [],
      part_number: parsed.part_number ? String(parsed.part_number) : undefined,
      quantity: Number.isInteger(parsed.quantity) && Number(parsed.quantity) > 0
        ? Number(parsed.quantity) : undefined,
      manufacturer: parsed.manufacturer ? String(parsed.manufacturer) : undefined,
      category: parsed.category ? String(parsed.category) : undefined,
    }
  } catch {
    return undefined
  }
}

export const FUNCTION_WORKBOOK_SHEETS = [
  'Structure', 'Functions', 'Requirements', 'Correlations',
  'Function Links', 'Block Diagram', 'Interfaces', 'P-Diagrams', 'Control Plan',
] as const

export function recognizedFunctionWorkbookSheets(
  sheets?: FmeaWorkbookSheets,
): string[] {
  if (!sheets) return []
  return FUNCTION_WORKBOOK_SHEETS.filter(name => name in sheets)
}

/**
 * Replace only the Function Analysis sections that are explicitly present in
 * a Perdura workbook. Failure chains remain under the separate mapped import
 * flow, so a Function Analysis round-trip cannot silently overwrite risk work.
 */
export function importFunctionWorkbook(
  analysis: AIAGVDAFMEAAnalysis,
  sheets: FmeaWorkbookSheets,
): AIAGVDAFMEAAnalysis {
  const next = structuredClone(analysis)
  if (sheets.Structure) {
    next.structure_nodes = sheets.Structure.map((row, index): FMEAStructureNode => ({
      id: workbookValue(row, 'id', `SE-${index + 1}`),
      name: workbookValue(row, 'name'),
      level: workbookValue(row, 'level'),
      parent_id: workbookValue(row, 'parent_id') || undefined,
      description: workbookValue(row, 'description'),
      interface: workbookValue(row, 'interface'),
      element_type: workbookValue(row, 'element_type'),
      source_ref: workbookStructureSource(row.prediction_source_ref),
    }))
  }
  if (sheets.Functions) {
    next.functions = sheets.Functions.map((row, index): FMEAFunction => {
      const description = workbookValue(row, 'description')
      const vocabularyMatch = classifyFunctionStatement(description)
      return {
        id: workbookValue(row, 'id', `FN-${index + 1}`),
        structure_node_id: workbookValue(row, 'structure_node_id'),
        description,
        canonical_verb_id:
          vocabularyMatch.status === 'canonical'
          || vocabularyMatch.status === 'alias'
            ? vocabularyMatch.term?.id : undefined,
        function_type: (workbookValue(row, 'function_type', 'primary')
          || 'primary') as FMEAFunction['function_type'],
        operating_modes: workbookList(row.operating_modes),
        owner: workbookValue(row, 'owner'),
        notes: workbookValue(row, 'notes'),
      }
    })
  }
  if (sheets.Requirements) {
    next.functional_requirements = sheets.Requirements.map(
      (row, index): FMEAFunctionalRequirement => ({
        id: workbookValue(row, 'id', `FREQ-${index + 1}`),
        statement: workbookValue(row, 'statement'),
        requirement_type: (workbookValue(
          row, 'requirement_type', 'functional')
          || 'functional') as FMEAFunctionalRequirement['requirement_type'],
        measure: workbookValue(row, 'measure'),
        target: workbookValue(row, 'target'),
        unit: workbookValue(row, 'unit'),
        acceptance_criteria: workbookValue(row, 'acceptance_criteria'),
        operating_condition: workbookValue(row, 'operating_condition'),
        source: workbookValue(row, 'source'),
        owner: workbookValue(row, 'owner'),
        confidence: workbookValue(row, 'confidence'),
        verification_method: workbookValue(row, 'verification_method'),
        verification_method_id: undefined,
        evidence_ids: workbookList(row.evidence_ids),
        special_characteristic: workbookValue(row, 'special_characteristic'),
        linked_program_requirement_id:
          workbookValue(row, 'linked_program_requirement_id') || undefined,
        source_checksum: workbookValue(row, 'source_checksum') || undefined,
      }))
  }
  if (sheets.Correlations) {
    next.function_requirement_links = sheets.Correlations.map(
      (row, index): FMEAFunctionRequirementLink => ({
        id: workbookValue(row, 'id', `FRC-${index + 1}`),
        function_id: workbookValue(row, 'function_id'),
        requirement_id: workbookValue(row, 'requirement_id'),
        strength: (workbookValue(row, 'strength', 'strong')
          || 'strong') as FMEAFunctionRequirementLink['strength'],
        rationale: workbookValue(row, 'rationale'),
      }))
  }
  if (sheets['Function Links']) {
    next.function_links = sheets['Function Links'].map(
      (row, index): FMEAFunctionLink => ({
        id: workbookValue(row, 'id', `FL-${index + 1}`),
        source_function_id: workbookValue(row, 'source_function_id'),
        target_function_id: workbookValue(row, 'target_function_id'),
        relationship: (workbookValue(row, 'relationship', 'decomposes_to')
          || 'decomposes_to') as FMEAFunctionLink['relationship'],
        label: workbookValue(row, 'label'),
        rationale: workbookValue(row, 'rationale'),
      }))
  }
  if (sheets['Block Diagram']) {
    const boundary = sheets['Block Diagram'].find(
      row => workbookValue(row, 'record_type') === 'boundary')
    const nodeRows = sheets['Block Diagram'].filter(
      row => workbookValue(row, 'record_type') === 'node')
    next.block_diagram = {
      version: 2,
      density: ([
        'dense', 'compact', 'comfortable', 'spacious', 'expanded',
      ].includes(workbookValue(boundary ?? {}, 'density'))
        ? workbookValue(boundary ?? {}, 'density')
        : 'comfortable') as FMEABlockDiagram['density'],
      boundary: {
        label: workbookValue(boundary ?? {}, 'label', next.name),
        x: workbookNumber(boundary?.x, 40),
        y: workbookNumber(boundary?.y, 40),
        width: workbookNumber(boundary?.width, 900),
        height: workbookNumber(boundary?.height, 560),
      },
      nodes: nodeRows.map((row, index): FMEABlockDiagramNode => ({
        id: workbookValue(row, 'id', `BDN-${index + 1}`),
        kind: (workbookValue(row, 'kind', 'structure')
          || 'structure') as FMEABlockDiagramNode['kind'],
        structure_node_id:
          workbookValue(row, 'structure_node_id') || undefined,
        label: workbookValue(row, 'label'),
        external_kind: (workbookValue(row, 'external_kind')
          || undefined) as FMEABlockDiagramNode['external_kind'],
        container_parent_block_id:
          workbookValue(row, 'container_parent_block_id') || undefined,
        expanded: workbookBoolean(row.expanded),
        x: workbookNumber(row.x, 80 + (index % 4) * 200),
        y: workbookNumber(row.y, 100 + Math.floor(index / 4) * 110),
        width: workbookNumber(row.width, 180),
        height: workbookNumber(row.height, 72),
        inside_boundary: workbookBoolean(row.inside_boundary),
      })),
      viewport: {
        x: workbookNumber(boundary?.viewport_x, 0),
        y: workbookNumber(boundary?.viewport_y, 0),
        zoom: workbookNumber(boundary?.viewport_zoom, 1),
      },
      snap_to_grid: boundary
        ? workbookBoolean(boundary.snap_to_grid)
        : true,
    }
  }
  if (sheets.Interfaces) {
    next.interfaces = sheets.Interfaces.map((row, index): FMEAInterface => ({
      id: workbookValue(row, 'id', `IF-${index + 1}`),
      name: workbookValue(row, 'name'),
      interface_type: (workbookValue(row, 'interface_type', 'information')
        || 'information') as FMEAInterface['interface_type'],
      source_block_id: workbookValue(row, 'source_block_id') || undefined,
      target_block_id: workbookValue(row, 'target_block_id') || undefined,
      source_handle: workbookValue(row, 'source_handle') || undefined,
      target_handle: workbookValue(row, 'target_handle') || undefined,
      linkage: (workbookValue(row, 'linkage', 'direct')
        || 'direct') as FMEAInterface['linkage'],
      directionality: (workbookValue(row, 'directionality', 'directed')
        || 'directed') as FMEAInterface['directionality'],
      relationship_strength: (workbookValue(
        row, 'relationship_strength', 'unspecified')
        || 'unspecified') as FMEAInterface['relationship_strength'],
      relationship_nature: (workbookValue(
        row, 'relationship_nature', 'unspecified')
        || 'unspecified') as FMEAInterface['relationship_nature'],
      interface_detail: workbookValue(row, 'interface_detail'),
      source_structure_node_id:
        workbookValue(row, 'source_structure_node_id') || undefined,
      target_structure_node_id:
        workbookValue(row, 'target_structure_node_id') || undefined,
      external_source: workbookValue(row, 'external_source'),
      external_target: workbookValue(row, 'external_target'),
      flow_description: workbookValue(row, 'flow_description'),
      operating_condition: workbookValue(row, 'operating_condition'),
      function_ids: workbookList(row.function_ids),
      requirement_ids: workbookList(row.requirement_ids),
    }))
  }
  if (sheets['P-Diagrams']) {
    const diagrams = new Map<string, FMEAPDiagram>()
    sheets['P-Diagrams'].forEach((row, index) => {
      const diagramId = workbookValue(row, 'diagram_id', `PD-${index + 1}`)
      const diagram = diagrams.get(diagramId) ?? {
        id: diagramId,
        title: workbookValue(row, 'diagram_title'),
        primary_function_id: workbookValue(row, 'primary_function_id'),
        supporting_function_ids: workbookList(row.supporting_function_ids),
        items: [],
      }
      const itemId = workbookValue(row, 'item_id')
      if (itemId) {
        diagram.items.push({
          id: itemId,
          category: workbookValue(
            row, 'category', 'signal_input') as FMEAPDiagramItem['category'],
          label: workbookValue(row, 'label'),
          description: workbookValue(row, 'description'),
          requirement_ids: workbookList(row.requirement_ids),
        })
      }
      diagrams.set(diagramId, diagram)
    })
    next.p_diagrams = [...diagrams.values()]
  }
  if (sheets['Control Plan']) {
    next.control_plan = sheets['Control Plan'].map(
      (row, index): FMEAControlPlanRow => ({
        id: workbookValue(row, 'id', `CP-${index + 1}`),
        failure_chain_id: workbookValue(row, 'failure_chain_id') || undefined,
        process_step: workbookValue(row, 'process_step'),
        product_characteristic: workbookValue(row, 'product_characteristic'),
        process_characteristic: workbookValue(row, 'process_characteristic'),
        specification: workbookValue(row, 'specification'),
        measurement_method: workbookValue(row, 'measurement_method'),
        sample_size: workbookValue(row, 'sample_size'),
        frequency: workbookValue(row, 'frequency'),
        control_method: workbookValue(row, 'control_method'),
        reaction_plan: workbookValue(row, 'reaction_plan'),
        responsibility: workbookValue(row, 'responsibility'),
        special_characteristic: workbookValue(row, 'special_characteristic'),
        source_revision: workbookValue(row, 'source_revision') || undefined,
        stale: workbookBoolean(row.stale),
      }))
  }
  return next
}

export function mergeControlPlanProposal(
  rows: FMEAControlPlanRow[],
  proposal: FMEAControlPlanRow,
) {
  const index = rows.findIndex(row =>
    row.failure_chain_id === proposal.failure_chain_id)
  if (index < 0) return [...rows, proposal]
  return rows.map((row, rowIndex) => rowIndex === index ? proposal : row)
}
