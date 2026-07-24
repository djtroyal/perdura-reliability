import type { PredictionPart } from '../../api/client'
import type {
  FMEAStructureNode,
  FMEAStructureSourceRef,
} from '../../api/reliabilityProgram'
import { hashCanonicalJson } from '../../store/provenance'

export interface PredictionStructureBlock {
  id: string
  name: string
  parentId?: string|null
  notes?: string
}

export interface PredictionStructureState {
  parts: PredictionPart[]
  blocks?: PredictionStructureBlock[]
}

export interface PredictionAnalysisSource {
  id: string
  name: string
  state: PredictionStructureState
}

export interface PredictionStructureEntity {
  id: string
  type: 'system'|'block'|'part'
  sourceId: string
  name: string
  parentId?: string
  depth: number
  checksum: string
  referenceDesignators: string[]
  partNumber?: string
  quantity?: number
  manufacturer?: string
  category?: string
}

export interface PredictionStructurePiece {
  key: string
  name: string
  referenceDesignators: string[]
}

export interface PredictionStructureCatalog {
  analysisId: string
  analysisName: string
  entities: PredictionStructureEntity[]
  errors: string[]
}

export type PredictionSourceStatus = 'current'|'changed'|'missing'

function normalizedPieceCount(entity: PredictionStructureEntity): number {
  const quantity = Number.isFinite(entity.quantity)
    ? Math.max(1, Math.round(entity.quantity!))
    : 1
  return Math.max(quantity, entity.referenceDesignators.length)
}

export function predictionEntityPieces(
  entity: PredictionStructureEntity,
): PredictionStructurePiece[] {
  if (entity.type !== 'part') return []
  const count = normalizedPieceCount(entity)
  if (count <= 1) return []
  const refdesPrefix = entity.referenceDesignators.join(', ')
  const fallbackIdentity = refdesPrefix && entity.name.startsWith(refdesPrefix)
    ? entity.name.slice(refdesPrefix.length).replace(/^\s*[—–-]\s*/, '')
    : entity.name
  const identity = entity.partNumber?.trim()
    || fallbackIdentity
    || entity.category?.replace(/_/g, ' ')
    || 'Unnamed part'
  const keyOccurrences = new Map<string, number>()
  return Array.from({ length: count }, (_, index) => {
    const referenceDesignator = entity.referenceDesignators[index]?.trim()
    const baseKey = referenceDesignator
      ? `refdes:${referenceDesignator}`
      : `ordinal:${index + 1}`
    const occurrence = (keyOccurrences.get(baseKey) ?? 0) + 1
    keyOccurrences.set(baseKey, occurrence)
    return {
      key: occurrence === 1 ? baseKey : `${baseKey}#${occurrence}`,
      name: referenceDesignator
        ? `${referenceDesignator} — ${identity}`
        : `${identity} · Item ${index + 1} of ${count}`,
      referenceDesignators: referenceDesignator
        ? [referenceDesignator]
        : [],
    }
  })
}

const catalogEntityCache = new WeakMap<
  PredictionStructureCatalog,
  Map<string, PredictionStructureEntity>
>()

function catalogEntities(
  catalog: PredictionStructureCatalog,
): Map<string, PredictionStructureEntity> {
  const cached = catalogEntityCache.get(catalog)
  if (cached) return cached
  const entities = new Map(catalog.entities.map(entity => [entity.id, entity]))
  catalogEntityCache.set(catalog, entities)
  return entities
}

const entityId = (type: 'system'|'block'|'part', id: string) =>
  `${type}:${id}`

function partLabel(part: PredictionPart): string {
  const refdes = (part.reference_designators ?? []).join(', ')
  const identity = part.part_number?.trim()
    || part.name?.trim()
    || part.description?.trim()
    || part.category.replace(/_/g, ' ')
  if (refdes && identity) return `${refdes} — ${identity}`
  return refdes || identity || 'Unnamed part'
}

function entitySnapshot(entity: Omit<PredictionStructureEntity, 'checksum'>) {
  return {
    id: entity.id,
    type: entity.type,
    sourceId: entity.sourceId,
    name: entity.name,
    parentId: entity.parentId ?? null,
    referenceDesignators: entity.referenceDesignators,
    partNumber: entity.partNumber ?? null,
    quantity: entity.quantity ?? null,
    manufacturer: entity.manufacturer ?? null,
    category: entity.category ?? null,
  }
}

export async function buildPredictionStructureCatalog(
  source: PredictionAnalysisSource,
): Promise<PredictionStructureCatalog> {
  const blocks = source.state.blocks ?? []
  const parts = source.state.parts ?? []
  const errors: string[] = []
  const blockIds = new Set<string>()
  for (const block of blocks) {
    const id = block.id?.trim()
    if (!id) errors.push('A system block has no stable ID.')
    else if (blockIds.has(id)) errors.push(`System block ID '${id}' is duplicated.`)
    else blockIds.add(id)
  }
  const partIds = new Set<string>()
  for (const part of parts) {
    const id = part.id?.trim()
    if (!id) errors.push('A Parts List row has no stable ID.')
    else if (partIds.has(id)) errors.push(`Part ID '${id}' is duplicated.`)
    else partIds.add(id)
  }
  for (const block of blocks) {
    if (block.parentId && !blockIds.has(block.parentId)) {
      errors.push(`System block '${block.name || block.id}' references missing parent '${block.parentId}'.`)
    }
  }
  for (const part of parts) {
    if (part.parentId && !blockIds.has(part.parentId)) {
      errors.push(`Part '${partLabel(part)}' references missing block '${part.parentId}'.`)
    }
  }
  const byBlockId = new Map(blocks.map(block => [block.id, block]))
  const resolvedBlocks = new Set<string>()
  for (const block of blocks) {
    if (resolvedBlocks.has(block.id)) continue
    const path: string[] = []
    const pathIndex = new Map<string, number>()
    let current: PredictionStructureBlock|undefined = block
    while (current && !resolvedBlocks.has(current.id)) {
      if (pathIndex.has(current.id)) {
        errors.push(`System block hierarchy contains a cycle involving '${block.name || block.id}'.`)
        break
      }
      pathIndex.set(current.id, path.length)
      path.push(current.id)
      current = current.parentId
        ? byBlockId.get(current.parentId)
        : undefined
    }
    path.forEach(id => resolvedBlocks.add(id))
  }
  if (errors.length) {
    return {
      analysisId: source.id,
      analysisName: source.name,
      entities: [],
      errors: [...new Set(errors)],
    }
  }

  const drafts: Omit<PredictionStructureEntity, 'checksum'>[] = []
  const systemId = entityId('system', 'system')
  drafts.push({
    id: systemId,
    type: 'system',
    sourceId: 'system',
    name: source.name,
    depth: 0,
    referenceDesignators: [],
  })
  const blocksByParent = new Map<string, PredictionStructureBlock[]>()
  const partsByParent = new Map<string, PredictionPart[]>()
  for (const block of blocks) {
    const key = block.parentId ?? ''
    const bucket = blocksByParent.get(key) ?? []
    bucket.push(block)
    if (!blocksByParent.has(key)) blocksByParent.set(key, bucket)
  }
  for (const part of parts) {
    const key = part.parentId ?? ''
    const bucket = partsByParent.get(key) ?? []
    bucket.push(part)
    if (!partsByParent.has(key)) partsByParent.set(key, bucket)
  }
  const walk = (parentId: string|null, parentEntityId: string, depth: number) => {
    for (const block of blocksByParent.get(parentId ?? '') ?? []) {
      const id = entityId('block', block.id)
      drafts.push({
        id,
        type: 'block',
        sourceId: block.id,
        name: block.name || 'Unnamed system block',
        parentId: parentEntityId,
        depth,
        referenceDesignators: [],
      })
      walk(block.id, id, depth + 1)
    }
    for (const part of partsByParent.get(parentId ?? '') ?? []) {
      drafts.push({
        id: entityId('part', part.id!),
        type: 'part',
        sourceId: part.id!,
        name: partLabel(part),
        parentId: parentEntityId,
        depth,
        referenceDesignators: [...(part.reference_designators ?? [])],
        partNumber: part.part_number,
        quantity: part.quantity,
        manufacturer: part.manufacturer ?? part.supplier,
        category: part.category,
      })
    }
  }
  walk(null, systemId, 1)
  const entities = await Promise.all(drafts.map(async draft => ({
    ...draft,
    checksum: await hashCanonicalJson(entitySnapshot(draft)),
  })))
  return {
    analysisId: source.id,
    analysisName: source.name,
    entities,
    errors: [],
  }
}

function ancestorsOf(
  catalog: PredictionStructureCatalog,
  id: string,
): Set<string> {
  const byId = new Map(catalog.entities.map(entity => [entity.id, entity]))
  const ancestors = new Set<string>()
  let current = byId.get(id)
  while (current?.parentId && byId.has(current.parentId)) {
    ancestors.add(current.parentId)
    current = byId.get(current.parentId)
  }
  return ancestors
}

export function descendantsOf(
  catalog: PredictionStructureCatalog,
  id: string,
): Set<string> {
  const result = new Set<string>()
  const children = new Map<string, string[]>()
  for (const entity of catalog.entities) {
    if (!entity.parentId) continue
    const bucket = children.get(entity.parentId) ?? []
    bucket.push(entity.id)
    if (!children.has(entity.parentId)) children.set(entity.parentId, bucket)
  }
  const visit = (parentId: string) => {
    for (const childId of children.get(parentId) ?? []) {
      if (result.has(childId)) continue
      result.add(childId)
      visit(childId)
    }
  }
  visit(id)
  return result
}

export function defaultPredictionImportSelection(
  catalog: PredictionStructureCatalog,
  focusId: string,
): Set<string> {
  return new Set([
    focusId,
    ...ancestorsOf(catalog, focusId),
    ...descendantsOf(catalog, focusId),
  ])
}

function sourceRef(
  catalog: PredictionStructureCatalog,
  entity: PredictionStructureEntity,
  importedAt: string,
  piece?: PredictionStructurePiece,
): FMEAStructureSourceRef {
  return {
    module: 'prediction',
    analysis_id: catalog.analysisId,
    analysis_name: catalog.analysisName,
    entity_type: entity.type,
    entity_id: entity.id,
    parent_entity_id: entity.parentId,
    imported_at: importedAt,
    source_checksum: entity.checksum,
    source_name: piece?.name ?? entity.name,
    piece_key: piece?.key,
    reference_designators: piece?.referenceDesignators
      ?? entity.referenceDesignators,
    part_number: entity.partNumber,
    quantity: piece ? 1 : entity.quantity,
    manufacturer: entity.manufacturer,
    category: entity.category,
  }
}

function projectedPredictionEntity(
  entity: PredictionStructureEntity,
  pieceKey?: string,
): PredictionStructureEntity|undefined {
  if (!pieceKey) return entity
  const piece = predictionEntityPieces(entity).find(
    item => item.key === pieceKey,
  )
  if (!piece) return undefined
  return {
    ...entity,
    name: piece.name,
    referenceDesignators: piece.referenceDesignators,
    quantity: 1,
  }
}

function sourceIdentity(entityId: string, pieceKey?: string): string {
  return `${entityId}\u0000${pieceKey ?? ''}`
}

export function importPredictionStructure(
  currentNodes: FMEAStructureNode[],
  catalog: PredictionStructureCatalog,
  focusId: string,
  selectedIds: Set<string>,
  options: { splitGroupedParts?: boolean } = {},
): FMEAStructureNode[] {
  if (catalog.errors.length) return currentNodes
  const byId = new Map(catalog.entities.map(entity => [entity.id, entity]))
  const establishedFocus = currentNodes.find(node =>
    node.level === 'focus'
    && node.source_ref?.module === 'prediction'
    && node.source_ref.analysis_id === catalog.analysisId)?.source_ref?.entity_id
  const effectiveFocusId = establishedFocus && byId.has(establishedFocus)
    ? establishedFocus : focusId
  const focus = byId.get(effectiveFocusId)
  if (!focus || (focus.type !== 'system' && focus.type !== 'block')) {
    return currentNodes
  }
  const focusDescendants = descendantsOf(catalog, effectiveFocusId)
  const included = new Set([
    effectiveFocusId,
    ...ancestorsOf(catalog, effectiveFocusId),
    ...[...selectedIds].filter(id =>
      id === effectiveFocusId
      || focusDescendants.has(id)),
  ])
  const existingNodes = currentNodes
    .filter(node => node.source_ref?.module === 'prediction'
      && node.source_ref.analysis_id === catalog.analysisId)
  const existingIdentities = new Set(existingNodes.map(node =>
    sourceIdentity(
      node.source_ref!.entity_id,
      node.source_ref!.piece_key,
    )))
  const existingByEntity = new Map<string, FMEAStructureNode[]>()
  for (const node of existingNodes) {
    const entityId = node.source_ref!.entity_id
    existingByEntity.set(entityId, [
      ...(existingByEntity.get(entityId) ?? []),
      node,
    ])
  }
  const nodes = [...currentNodes]
  const usedLocalIds = new Set(currentNodes.map(node => node.id))
  let localSequence = currentNodes.length + 1
  const nextLocalId = () => {
    let id = `ST-${localSequence++}`
    while (usedLocalIds.has(id)) id = `ST-${localSequence++}`
    usedLocalIds.add(id)
    return id
  }
  const localId = new Map(existingNodes.map(node => [
    node.source_ref!.entity_id,
    node.id,
  ]))
  const ancestorIds = ancestorsOf(catalog, effectiveFocusId)
  const importedAt = new Date().toISOString()
  const nearestIncludedParent = (entity: PredictionStructureEntity) => {
    let parentId = entity.parentId
    while (parentId && !included.has(parentId)) parentId = byId.get(parentId)?.parentId
    return parentId ? localId.get(parentId) : undefined
  }
  for (const entity of catalog.entities) {
    if (!included.has(entity.id)) continue
    const existingForEntity = existingByEntity.get(entity.id) ?? []
    const pieces = options.splitGroupedParts
      ? predictionEntityPieces(entity)
      : []
    if (entity.type !== 'part' || !pieces.length) {
      if (existingForEntity.length) continue
      const id = nextLocalId()
      localId.set(entity.id, id)
      nodes.push({
        id,
        name: entity.name,
        level: entity.id === effectiveFocusId
          ? 'focus'
          : ancestorIds.has(entity.id) ? 'next_higher' : 'next_lower',
        parent_id: nearestIncludedParent(entity),
        description: '',
        interface: '',
        source_ref: sourceRef(catalog, entity, importedAt),
      })
      continue
    }
    // A grouped record is split explicitly so existing function allocations
    // retain a deterministic local target instead of being duplicated here.
    if (existingForEntity.some(node => !node.source_ref?.piece_key)) continue
    for (const piece of pieces) {
      if (existingIdentities.has(sourceIdentity(entity.id, piece.key))) continue
      nodes.push({
        id: nextLocalId(),
        name: piece.name,
        level: 'next_lower',
        parent_id: nearestIncludedParent(entity),
        description: '',
        interface: '',
        source_ref: sourceRef(catalog, entity, importedAt, piece),
      })
    }
  }
  return nodes.length === currentNodes.length ? currentNodes : nodes
}

export function predictionImportableItemCount(
  currentNodes: FMEAStructureNode[],
  catalog: PredictionStructureCatalog,
  selectedIds: Set<string>,
  splitGroupedParts: boolean,
): number {
  const existingByEntity = new Map<string, FMEAStructureNode[]>()
  for (const node of currentNodes) {
    const ref = node.source_ref
    if (!ref || ref.analysis_id !== catalog.analysisId) continue
    existingByEntity.set(ref.entity_id, [
      ...(existingByEntity.get(ref.entity_id) ?? []),
      node,
    ])
  }
  return catalog.entities.reduce((total, entity) => {
    if (!selectedIds.has(entity.id)) return total
    const existing = existingByEntity.get(entity.id) ?? []
    const pieces = splitGroupedParts
      ? predictionEntityPieces(entity)
      : []
    if (!pieces.length) return total + (existing.length ? 0 : 1)
    if (existing.some(node => !node.source_ref?.piece_key)) return total
    const existingPieceKeys = new Set(existing.map(
      node => node.source_ref?.piece_key,
    ))
    return total + pieces.filter(
      piece => !existingPieceKeys.has(piece.key),
    ).length
  }, 0)
}

export function canSplitImportedPredictionPart(
  node: FMEAStructureNode,
  catalog?: PredictionStructureCatalog,
): boolean {
  const ref = node.source_ref
  if (!ref || ref.entity_type !== 'part' || ref.piece_key || !catalog
      || catalog.analysisId !== ref.analysis_id) return false
  const entity = catalogEntities(catalog).get(ref.entity_id)
  return !!entity && predictionEntityPieces(entity).length > 1
}

export function splitImportedPredictionParts(
  currentNodes: FMEAStructureNode[],
  catalogs: PredictionStructureCatalog[],
  nodeIds?: Set<string>,
): FMEAStructureNode[] {
  const catalogByAnalysis = new Map(catalogs.map(
    catalog => [catalog.analysisId, catalog],
  ))
  const usedLocalIds = new Set(currentNodes.map(node => node.id))
  let localSequence = currentNodes.length + 1
  const nextLocalId = () => {
    let id = `ST-${localSequence++}`
    while (usedLocalIds.has(id)) id = `ST-${localSequence++}`
    usedLocalIds.add(id)
    return id
  }
  let changed = false
  const importedAt = new Date().toISOString()
  const result: FMEAStructureNode[] = []
  for (const node of currentNodes) {
    if (nodeIds && !nodeIds.has(node.id)) {
      result.push(node)
      continue
    }
    const ref = node.source_ref
    const catalog = ref
      ? catalogByAnalysis.get(ref.analysis_id)
      : undefined
    if (!canSplitImportedPredictionPart(node, catalog)) {
      result.push(node)
      continue
    }
    const entity = catalogEntities(catalog!).get(ref!.entity_id)!
    const pieces = predictionEntityPieces(entity)
    changed = true
    pieces.forEach((piece, index) => {
      result.push({
        ...node,
        id: index === 0 ? node.id : nextLocalId(),
        name: piece.name,
        source_ref: sourceRef(catalog!, entity, importedAt, piece),
      })
    })
  }
  return changed ? result : currentNodes
}

export function predictionSourceStatus(
  node: FMEAStructureNode,
  catalog?: PredictionStructureCatalog,
): PredictionSourceStatus|undefined {
  const ref = node.source_ref
  if (!ref) return undefined
  if (!catalog || catalog.analysisId !== ref.analysis_id) return 'missing'
  const entity = catalogEntities(catalog).get(ref.entity_id)
  if (!entity) return 'missing'
  if (!projectedPredictionEntity(entity, ref.piece_key)) return 'missing'
  return entity.checksum === ref.source_checksum
    && catalog.analysisName === ref.analysis_name
    ? 'current' : 'changed'
}

export function predictionSourceEntity(
  node: FMEAStructureNode,
  catalog?: PredictionStructureCatalog,
): PredictionStructureEntity|undefined {
  const ref = node.source_ref
  if (!ref || !catalog || catalog.analysisId !== ref.analysis_id) {
    return undefined
  }
  const entity = catalogEntities(catalog).get(ref.entity_id)
  return entity
    ? projectedPredictionEntity(entity, ref.piece_key)
    : undefined
}

export function refreshPredictionStructure(
  currentNodes: FMEAStructureNode[],
  catalogs: PredictionStructureCatalog[],
  nodeIds?: Set<string>,
): FMEAStructureNode[] {
  const catalogByAnalysis = new Map(catalogs.map(item => [item.analysisId, item]))
  const entitiesByAnalysis = new Map(catalogs.map(item => [
    item.analysisId, catalogEntities(item),
  ]))
  const localBySource = new Map(currentNodes
    .filter(node => node.source_ref)
    .map(node => [
      `${node.source_ref!.analysis_id}:${node.source_ref!.entity_id}`,
      node.id,
    ]))
  return currentNodes.map(node => {
    const ref = node.source_ref
    if (!ref || (nodeIds && !nodeIds.has(node.id))) return node
    const catalog = catalogByAnalysis.get(ref.analysis_id)
    const sourceEntity = entitiesByAnalysis.get(ref.analysis_id)?.get(ref.entity_id)
    const entity = sourceEntity
      ? projectedPredictionEntity(sourceEntity, ref.piece_key)
      : undefined
    if (!catalog || !sourceEntity || !entity) return node
    const linkedParent = sourceEntity.parentId
      ? localBySource.get(`${ref.analysis_id}:${sourceEntity.parentId}`)
      : undefined
    // Do not silently flatten a linked node when its new source parent has not
    // been imported yet. It remains stale until that parent is pulled.
    if (sourceEntity.parentId && !linkedParent) return node
    return {
      ...node,
      name: entity.name,
      parent_id: linkedParent,
      source_ref: sourceRef(
        catalog,
        sourceEntity,
        new Date().toISOString(),
        ref.piece_key
          ? predictionEntityPieces(sourceEntity).find(
            piece => piece.key === ref.piece_key,
          )
          : undefined,
      ),
    }
  })
}

export function detachPredictionStructure(
  currentNodes: FMEAStructureNode[],
  nodeIds: Set<string>,
): FMEAStructureNode[] {
  const detached = new Set(nodeIds)
  let changed = true
  while (changed) {
    changed = false
    for (const node of currentNodes) {
      if (!node.parent_id || !detached.has(node.parent_id)
          || detached.has(node.id)) continue
      detached.add(node.id)
      changed = true
    }
  }
  return currentNodes.map(node => detached.has(node.id)
    ? { ...node, source_ref: undefined }
    : node)
}
