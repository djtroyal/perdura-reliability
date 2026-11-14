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

export interface SystemDefinitionState {
  model: SystemDefinitionModel
  selectedModeId: string
  selectedInstanceId: string
  structureCollapsedIds: string[]
  view: 'structure'|'architecture'|'functions'|'requirements'|'fault-map'|'integrations'
  decisions: ProposalDecision[]
  propagation?: SystemPropagationResult|null
  analysisBindings?: SystemAnalysisBinding[]
  projectionPreview?: SystemProjectionResult|null

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
      version: 4, id, name, revision: 'A', modes: [], resources: [], definitions: [],
      instances: [], externals: [], interfaces: [], function_links: [],
      propagation_rules: [], propagation_assertions: [], diagrams: [{
        id: 'diagram-1', name: 'System', density: 'standard',
        boundary: { label: name, x: -40, y: -40, width: 1200, height: 700 },
        viewport: { x: 0, y: 0, zoom: 1 }, snap_to_grid: true, mode_ids: [], hidden_instance_ids: [], nodes: [],
      }],
    },
    selectedModeId: '', selectedInstanceId: '', structureCollapsedIds: [],
    view: 'structure',
    decisions: [], propagation: null, analysisBindings: [], projectionPreview: null,
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
