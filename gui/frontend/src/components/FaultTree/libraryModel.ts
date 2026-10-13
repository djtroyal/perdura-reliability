/** Pure project-local FTA library model. Hierarchy is derived exclusively from Transfers. */
export interface FtaNode {
  id: string
  type?: string
  data?: Record<string, unknown>
  position?: { x: number; y: number }
}
export interface FtaEdge {
  id?: string
  source: string
  target: string
  data?: Record<string, unknown>
  role?: string
  order?: number
}
export interface FtaResultProvenance {
  schemaVersion: 1
  engineRevision: number
  treeId: string
  settings: { exposureTime: unknown; engine: unknown; confidenceLevel: unknown; nSimulations: unknown; simSeed: unknown }
  /** SHA-256 of canonical mathematical inputs, engine revision and full Transfer closure. */
  fingerprint: string
  treeIds: string[]
}
export interface FtaTreeState {
  nodes?: readonly FtaNode[]
  edges?: readonly FtaEdge[]
  result?: unknown
  resultProvenance?: FtaResultProvenance
  exposureTime?: unknown
  engine?: unknown
  confidenceLevel?: unknown
  nSimulations?: unknown
  simSeed?: unknown
}
export interface FtaFolio<S extends FtaTreeState = FtaTreeState> {
  id: string
  name: string
  state: S
  dirty?: boolean
}
export interface FtaSystemLink { systemModelId: string; instanceId: string }
export interface FtaTreeMetadata {
  code: string
  description: string
  tags: string[]
  systemLinks?: FtaSystemLink[]
}
export interface FtaLibraryCatalog {
  schemaVersion: 1
  byTreeId: Record<string, FtaTreeMetadata>
}
export interface FtaPlacement {
  edgeId: string
  gateId: string
  role: string
  order: number
}
export interface FtaReference {
  parentId: string
  targetId: string
  transferId: string
  mode: 'shared' | 'independent'
  placements: FtaPlacement[]
  placed: boolean
}
export interface FtaReferenceGroup {
  parentId: string
  targetId: string
  references: FtaReference[]
}
export interface FtaLibraryIssue {
  code: string
  severity: 'error' | 'warning'
  message: string
  treeId: string
  transferId?: string
  targetId?: string
  treeIds?: string[]
}
export interface FtaReferenceIndex {
  trees: Map<string, FtaFolio>
  references: FtaReference[]
  children: Map<string, FtaReferenceGroup[]>
  parents: Map<string, FtaReferenceGroup[]>
  roots: string[]
  issues: FtaLibraryIssue[]
  cycles: string[][]
  /** Trees which cannot be reached from a normal root, including cycle descendants. */
  issueRoots: string[]
}
export interface FtaHierarchyRow {
  key: string
  treeId: string
  parentId?: string
  path: string[]
  depth: number
  hasChildren: boolean
  expanded: boolean
  cycle: boolean
  repeated: boolean
  referenceCount: number
  group?: FtaReferenceGroup
  issueBranch: boolean
}
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
const text = (value: unknown): string => typeof value === 'string' ? value : ''
const constraints = new Set(['fdep', 'seq'])
export const transferTarget = (node: FtaNode): string =>
  text(node.data?.transferTo) || text(node.data?.ref_tree)
function modelNodes(state: FtaTreeState): FtaNode[] {
  const value = state.nodes
  return Array.isArray(value) ? value.filter(node => !!node && typeof node.id === 'string' && node.id) : []
}
function modelEdges(state: FtaTreeState): FtaEdge[] {
  const value = state.edges
  return Array.isArray(value) ? value.filter(edge => !!edge && typeof edge.source === 'string'
    && typeof edge.target === 'string') : []
}

/** Accept legacy raw canvases, schema 6/7 folio wrappers, or already-normalized folios. */
export function normalizeFtaLibrary(raw: unknown, rawCatalog?: unknown): {
  folios: FtaFolio[]; catalog: FtaLibraryCatalog; activeId: string | null
} {
  const wrapper = record(raw)
  const entries = Array.isArray(raw) ? raw
    : wrapper._folioWrap === true && Array.isArray(wrapper.folios) ? wrapper.folios
      : raw && typeof raw === 'object' ? [{ id: 'f0', name: 'Analysis 1', state: raw }] : []
  const folios = entries.filter(entry => typeof record(entry).id === 'string').map(entry => {
    const value = record(entry)
    return { ...value, id: text(value.id), name: text(value.name) || 'Untitled FTA',
      state: record(value.state) as FtaTreeState, dirty: Boolean(value.dirty) } as FtaFolio
  })
  const source = record(record(rawCatalog).byTreeId)
  const byTreeId: Record<string, FtaTreeMetadata> = Object.create(null)
  const usedCodes = new Set(folios.map(folio => text(record(source[folio.id]).code).trim().toLowerCase()).filter(Boolean))
  let sequence = 1
  for (const folio of folios) {
    const value = record(source[folio.id])
    let code = text(value.code).trim()
    if (!code) {
      while (usedCodes.has(`FTA-${String(sequence).padStart(3, '0')}`.toLowerCase())) sequence++
      code = `FTA-${String(sequence++).padStart(3, '0')}`
      usedCodes.add(code.toLowerCase())
    }
    const links = Array.isArray(value.systemLinks) ? value.systemLinks.map(record)
      .filter(link => text(link.systemModelId) && text(link.instanceId))
      .map(link => ({ systemModelId: text(link.systemModelId), instanceId: text(link.instanceId) })) : []
    byTreeId[folio.id] = {
      code, description: text(value.description),
      tags: Array.isArray(value.tags) ? [...new Set(value.tags.map(text).map(tag => tag.trim()).filter(Boolean))] : [],
      ...(links.length ? { systemLinks: links } : {}),
    }
  }
  const activeId = folios.some(folio => folio.id === wrapper.activeId)
    ? text(wrapper.activeId) : folios[0]?.id ?? null
  return { folios, catalog: { schemaVersion: 1, byTreeId }, activeId }
}

export function defaultFtaInputRole(type: string, index: number): string {
  if (type === 'inhibit') return index === 0 ? 'primary' : 'condition'
  if (type === 'imply') return index === 0 ? 'antecedent' : 'consequent'
  if (type === 'por') return index === 0 ? 'priority' : 'blocker'
  if (type === 'spare') return index === 0 ? 'primary' : 'spare'
  if (type === 'fdep') return index === 0 ? 'trigger' : 'dependent'
  if (type === 'seq') return 'sequence'
  return 'input'
}
/** Match FaultTreeAdvanced._default_roles: role defaults use sorted sibling rank,
 * not the stored numeric order (which may contain gaps). Original insertion
 * order breaks ties and places missing orders after ordinary explicit orders. */
export function normalizeFtaSemanticEdges<T extends FtaEdge>(rawEdges: readonly T[], graphNodes: readonly FtaNode[]) {
  const types = new Map(graphNodes.map(node => [node.id, node.type ?? '']))
  const groups = new Map<string, { edge: T; insertion: number; order?: number }[]>()
  for (const [insertion, edge] of rawEdges.entries()) {
    const value = edge.data?.order ?? edge.order
    const item = { edge, insertion, order: Number.isInteger(value) ? Number(value) : undefined }
    const group = groups.get(edge.source) ?? []
    group.push(item); groups.set(edge.source, group)
  }
  const resolved = new Map<number, { order: number; role: string }>()
  for (const group of groups.values()) {
    group.sort((left, right) => (left.order ?? 1_000_000 + left.insertion)
      - (right.order ?? 1_000_000 + right.insertion) || left.insertion - right.insertion)
    group.forEach(({ edge, insertion, order }, rank) => resolved.set(insertion, {
      order: order ?? rank,
      role: text(edge.data?.role) || text(edge.role) || defaultFtaInputRole(types.get(edge.source) ?? '', rank),
    }))
  }
  return rawEdges.map((edge, insertion) => {
    const semantic = resolved.get(insertion)!
    return { ...edge, ...semantic, data: { ...edge.data, ...semantic } }
  })
}

// Project states are immutable. Re-index only the edited canvas, not all 50,000 nodes.
const referenceFactsCache = new WeakMap<FtaTreeState, {
  transfers: FtaNode[]; roots: FtaNode[]; placements: Map<string, FtaPlacement[]>; malformed: boolean; duplicateNodeIds: string[]
}>()
function referenceFacts(state: FtaTreeState) {
  const cached = referenceFactsCache.get(state)
  if (cached) return cached
  const nodes = modelNodes(state), edges = modelEdges(state)
  const byId = new Map(nodes.map(node => [node.id, node]))
  const seenNodeIds = new Set<string>(), duplicateNodeIds = new Set<string>()
  for (const node of nodes) {
    if (seenNodeIds.has(node.id)) duplicateNodeIds.add(node.id)
    seenNodeIds.add(node.id)
  }
  const causalChildren = new Set<string>(), placements = new Map<string, FtaPlacement[]>()
  for (const edge of normalizeFtaSemanticEdges(edges, nodes)) {
    const type = byId.get(edge.source)?.type ?? ''
    if (!constraints.has(type)) causalChildren.add(edge.target)
    const placement = { edgeId: edge.id ?? '', gateId: edge.source, order: edge.order, role: edge.role }
    const list = placements.get(edge.target) ?? []
    list.push(placement); placements.set(edge.target, list)
  }
  const facts = {
    transfers: nodes.filter(node => node.type === 'transfer'), placements,
    roots: nodes.filter(node => node.type !== 'annotation' && !constraints.has(node.type ?? '')
      && !causalChildren.has(node.id)),
    malformed: (state.nodes != null && (!Array.isArray(state.nodes) || nodes.length !== state.nodes.length))
      || (state.edges != null && (!Array.isArray(state.edges) || edges.length !== state.edges.length)),
    duplicateNodeIds: [...duplicateNodeIds],
  }
  referenceFactsCache.set(state, facts)
  return facts
}

export function buildFtaReferenceIndex(folios: readonly FtaFolio[]): FtaReferenceIndex {
  const trees = new Map<string, FtaFolio>()
  const issues: FtaLibraryIssue[] = []
  for (const folio of folios) {
    if (trees.has(folio.id)) issues.push({ code: 'DUPLICATE_TREE_ID', severity: 'error',
      treeId: folio.id, message: `Duplicate tree identity ${folio.id}; repair the imported data.` })
    else trees.set(folio.id, folio)
  }
  const references: FtaReference[] = []
  const children = new Map<string, FtaReferenceGroup[]>()
  const parents = new Map<string, FtaReferenceGroup[]>()
  for (const [treeId, tree] of trees) {
    const facts = referenceFacts(tree.state), roots = facts.roots
    if (facts.malformed) issues.push({ code: 'MALFORMED_MODEL', severity: 'error', treeId,
      message: 'The stored diagram contains malformed nodes or connections; repair it before analysis.' })
    for (const id of facts.duplicateNodeIds) issues.push({ code: 'DUPLICATE_NODE_ID', severity: 'error', treeId,
      message: `Node identity ${id} is duplicated; repair the stored model.` })
    const grouped = new Map<string, FtaReferenceGroup>()
    const transferIds = new Set<string>()
    for (const node of facts.transfers) {
      if (transferIds.has(node.id)) issues.push({ code: 'DUPLICATE_TRANSFER_ID', severity: 'error',
        treeId, transferId: node.id, message: `Transfer identity ${node.id} is duplicated.` })
      transferIds.add(node.id)
      const targetId = transferTarget(node)
      if (!targetId) {
        issues.push({ code: 'EMPTY_TRANSFER', severity: 'error', treeId, transferId: node.id,
          message: 'Transfer has no target FTA.' })
        continue
      }
      const placements = facts.placements.get(node.id) ?? []
      const placed = placements.length > 0 || (roots.length === 1 && roots[0].id === node.id)
      const mode = node.data?.referenceMode === 'independent' ? 'independent' : 'shared'
      if (node.data?.referenceMode != null && !['shared', 'independent'].includes(text(node.data.referenceMode))) {
        issues.push({ code: 'INVALID_REFERENCE_MODE', severity: 'error', treeId, transferId: node.id,
          targetId, message: 'Transfer reference mode must be shared or independent.' })
      }
      const reference: FtaReference = { parentId: treeId, targetId, transferId: node.id, mode, placements, placed }
      references.push(reference)
      if (!placed) issues.push({ code: 'UNPLACED_TRANSFER', severity: 'warning', treeId,
        targetId, transferId: node.id, message: 'Transfer is disconnected from its parent model.' })
      if (!trees.has(targetId)) issues.push({ code: 'MISSING_TARGET', severity: 'error', treeId,
        targetId, transferId: node.id, message: `Transfer target ${targetId} is missing.` })
      const group = grouped.get(targetId) ?? { parentId: treeId, targetId, references: [] }
      group.references.push(reference)
      grouped.set(targetId, group)
    }
    children.set(treeId, [...grouped.values()])
    for (const group of grouped.values()) {
      parents.set(group.targetId, [...parents.get(group.targetId) ?? [], group])
    }
  }
  // A referenced document is expanded as one causal sub-tree by the backend.
  // Blank standalone documents remain drafts, but connecting one must expose
  // the incomplete target on both its own row and every parent's result context.
  for (const targetId of parents.keys()) {
    const target = trees.get(targetId)
    if (!target) continue
    const rootCount = referenceFacts(target.state).roots.length
    if (rootCount !== 1) issues.push({ code: 'INVALID_TARGET_ROOT', severity: 'error',
      treeId: targetId, targetId,
      message: `Referenced FTA “${target.name}” requires exactly one causal top event; found ${rootCount}. Complete or repair its draft model.`,
    })
  }
  // Tarjan components find cycles even when no root can reach them.
  const cycles: string[][] = []
  const number = new Map<string, number>(), low = new Map<string, number>()
  const stack: string[] = [], onStack = new Set<string>()
  let sequence = 0
  const visit = (id: string) => {
    number.set(id, sequence); low.set(id, sequence++)
    stack.push(id); onStack.add(id)
    for (const group of children.get(id) ?? []) {
      const target = group.targetId
      if (!trees.has(target)) continue
      if (!number.has(target)) { visit(target); low.set(id, Math.min(low.get(id)!, low.get(target)!)) }
      else if (onStack.has(target)) low.set(id, Math.min(low.get(id)!, number.get(target)!))
    }
    if (low.get(id) === number.get(id)) {
      const component: string[] = []
      let current: string
      do { current = stack.pop()!; onStack.delete(current); component.push(current) } while (current !== id)
      if (component.length > 1 || (children.get(id) ?? []).some(group => group.targetId === id)) {
        cycles.push(component)
        issues.push({ code: 'TRANSFER_CYCLE', severity: 'error', treeId: id, treeIds: component,
          message: `Transfer cycle involving ${component.map(key => trees.get(key)?.name ?? key).join(', ')}.` })
      }
    }
  }
  for (const id of trees.keys()) if (!number.has(id)) visit(id)
  const roots = [...trees.keys()].filter(id => !parents.get(id)?.length)
  const reached = new Set<string>(), pending = [...roots]
  while (pending.length) {
    const id = pending.pop()!
    if (reached.has(id)) continue
    reached.add(id)
    for (const group of children.get(id) ?? []) if (trees.has(group.targetId)) pending.push(group.targetId)
  }
  return { trees, references, children, parents, roots, issues, cycles,
    issueRoots: [...trees.keys()].filter(id => !reached.has(id)) }
}

export function collectFtaClosure(index: FtaReferenceIndex, selectedIds: readonly string[]): {
  treeIds: string[]; missingTargets: string[]; issues: FtaLibraryIssue[]
} {
  const seen = new Set<string>(), missing = new Set<string>(), pending = [...selectedIds].reverse()
  while (pending.length) {
    const id = pending.pop()!
    if (seen.has(id) || missing.has(id)) continue
    if (!index.trees.has(id)) { missing.add(id); continue }
    seen.add(id)
    for (const group of [...index.children.get(id) ?? []].reverse()) pending.push(group.targetId)
  }
  return { treeIds: [...seen], missingTargets: [...missing],
    issues: index.issues.filter(issue => seen.has(issue.treeId)) }
}

export const ftaOccurrenceKey = (path: readonly string[]): string => JSON.stringify(path)

/** Bounded, lazy traversal: an exponentially branching DAG never unfolds eagerly. */
export function visibleFtaHierarchy(index: FtaReferenceIndex, expanded: ReadonlySet<string>,
  options: { limit?: number; includeIssues?: boolean } = {}): { rows: FtaHierarchyRow[]; truncated: boolean } {
  const limit = Math.max(1, Math.min(10000, options.limit ?? 500))
  const rows: FtaHierarchyRow[] = []
  const roots = [...index.roots.map(treeId => ({ treeId, issueBranch: false })),
    ...(options.includeIssues === false ? [] : index.issueRoots.map(treeId => ({ treeId, issueBranch: true })))]
  const pending: { path: string[]; group?: FtaReferenceGroup; issueBranch: boolean }[] = roots.reverse()
    .map(root => ({ path: [root.treeId], issueBranch: root.issueBranch }))
  while (pending.length && rows.length < limit) {
    const item = pending.pop()!, treeId = item.path[item.path.length - 1]
    const key = ftaOccurrenceKey(item.path)
    const cycle = item.path.slice(0, -1).includes(treeId)
    const children = index.children.get(treeId) ?? []
    const isExpanded = expanded.has(key) && !cycle
    rows.push({ key, treeId, parentId: item.group?.parentId, path: item.path,
      depth: item.path.length - 1, cycle, hasChildren: children.length > 0 && !cycle,
      expanded: isExpanded, repeated: (index.parents.get(treeId)?.length ?? 0) > 1,
      referenceCount: item.group?.references.length ?? 0, group: item.group, issueBranch: item.issueBranch })
    if (isExpanded) for (const group of [...children].reverse()) {
      pending.push({ path: [...item.path, group.targetId], group, issueBranch: item.issueBranch })
    }
  }
  return { rows, truncated: pending.length > 0 }
}

/** Unique-tree search avoids multiplying results by the number of DAG paths. */
const nodeSearchCache = new WeakMap<FtaTreeState, string>()
export function searchFtaLibrary(folios: readonly FtaFolio[], catalog: FtaLibraryCatalog, query: string): FtaFolio[] {
  const terms = query.normalize('NFKD').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  return folios.filter(folio => {
    const meta = catalog.byTreeId[folio.id]
    let nodeLabels = nodeSearchCache.get(folio.state)
    if (nodeLabels === undefined) {
      nodeLabels = modelNodes(folio.state).map(node => text(node.data?.label)).join(' ')
        .normalize('NFKD').toLocaleLowerCase()
      nodeSearchCache.set(folio.state, nodeLabels)
    }
    const haystack = [folio.name, folio.id, meta?.code, meta?.description, ...meta?.tags ?? [], nodeLabels]
      .join(' ').normalize('NFKD').toLocaleLowerCase()
    return terms.every(term => haystack.includes(term))
  })
}

const presentationFields = new Set([
  'label', 'description', 'extendedDescription', 'gateId', 'transferToName', 'expandReference',
  'displayDensity', 'diagramColor', 'showNodeIds', 'highlighted', 'computedP', 'structuralRole',
  'inputCount', 'mirror', 'virtualTransferOwner', 'virtualSourceId',
])
const graphInputCache = new WeakMap<FtaTreeState, { nodes: unknown[]; edges: unknown[] }>()
const graphSignatureCache = new WeakMap<FtaTreeState, string>()
const semanticSignatureCache = new WeakMap<FtaTreeState, string>()
/** SHA-256 (FIPS 180-4 sections 5/6.2). Synchronous because store selectors cannot await WebCrypto.
 * Tests compare known vectors, every padding boundary and Unicode against node:crypto.
 * This hashes public model inputs; no secret-key/authentication use is implied. */
export function sha256FtaText(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64)
  padded.set(bytes); padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor(bytes.length / 0x20000000))
  view.setUint32(padded.length - 4, (bytes.length * 8) >>> 0)
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]
  const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
  const w = new Uint32Array(64)
  const rotate = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits))
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2]
      w[i] = w[i - 16] + (rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3))
        + w[i - 7] + (rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10))
    }
    let [a, b, c, d, e, f, g, h] = hash
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25))
        + ((e & f) ^ (~e & g)) + k[i] + w[i]) >>> 0
      const t2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22))
        + ((a & b) ^ (a & c) ^ (b & c))) >>> 0
      h = g; g = f; f = e; e = (d + t1) >>> 0
      d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    const result = [a, b, c, d, e, f, g, h]
    for (let i = 0; i < 8; i++) hash[i] = (hash[i] + result[i]) >>> 0
  }
  return hash.map(value => value.toString(16).padStart(8, '0')).join('')
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter(key => record(value)[key] !== undefined)
      .map(key => `${JSON.stringify(key)}:${canonical(record(value)[key])}`).join(',')}}`
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return JSON.stringify(String(value))
  return JSON.stringify(value) ?? 'null'
}
function graphInputs(state: FtaTreeState) {
  const cached = graphInputCache.get(state)
  if (cached) return cached
  const nodes = modelNodes(state).filter(node => node.type !== 'annotation')
  const edges = normalizeFtaSemanticEdges(modelEdges(state), nodes).map(edge => ({
    source: edge.source, target: edge.target, order: edge.order, role: edge.role,
  })).sort((a, b) => (canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0))
  const graph = { nodes: nodes.map(node => {
    const data = Object.fromEntries(Object.entries(node.data ?? {})
      .filter(([key]) => !presentationFields.has(key)))
    if (node.type === 'transfer') {
      data.transferTo = transferTarget(node)
      data.referenceMode = node.data?.referenceMode ?? 'shared'
      delete data.ref_tree
    }
    return { id: node.id, type: node.type ?? 'basic', data }
  }).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), edges }
  graphInputCache.set(state, graph)
  return graph
}
function graphSignature(state: FtaTreeState): string {
  const cached = graphSignatureCache.get(state)
  if (cached !== undefined) return cached
  const signature = sha256FtaText(canonical(graphInputs(state)))
  graphSignatureCache.set(state, signature)
  return signature
}
function analysisSettings(state: FtaTreeState) {
  return { exposureTime: state.exposureTime ?? '1000', engine: state.engine ?? 'auto',
    confidenceLevel: state.confidenceLevel ?? '95', nSimulations: state.nSimulations ?? '20000',
    simSeed: state.simSeed ?? '' }
}
export function semanticFtaFingerprint(state: FtaTreeState): string {
  const cached = semanticSignatureCache.get(state)
  if (cached !== undefined) return cached
  const signature = sha256FtaText(canonical({ graph: graphSignature(state), settings: analysisSettings(state) }))
  semanticSignatureCache.set(state, signature)
  return signature
}
function asIndex(value: FtaReferenceIndex | readonly FtaFolio[]): FtaReferenceIndex {
  return Array.isArray(value) ? buildFtaReferenceIndex(value) : value as FtaReferenceIndex
}

/** Child analysis settings do not apply when its graph is evaluated under a parent's context. */
export function createFtaResultProvenance(value: FtaReferenceIndex | readonly FtaFolio[], treeId: string,
  engineRevision = 1): FtaResultProvenance {
  if (!Number.isInteger(engineRevision) || engineRevision < 1) throw new Error('A valid FTA engine revision is required.')
  const index = asIndex(value)
  const root = index.trees.get(treeId)
  if (!root) throw new Error(`Unknown FTA ${treeId}.`)
  const closure = collectFtaClosure(index, [treeId])
  if (closure.missingTargets.length || closure.issues.some(issue => issue.severity === 'error')) {
    throw new Error('Cannot certify results for an FTA with unresolved Transfer issues.')
  }
  const treeIds = [...closure.treeIds].sort()
  return { schemaVersion: 1, engineRevision, treeId, settings: analysisSettings(root.state), treeIds,
    fingerprint: sha256FtaText(canonical({
    engineRevision, rootId: treeId, settings: analysisSettings(root.state),
    trees: treeIds.map(id => ({ id, graph: graphSignature(index.trees.get(id)!.state) })),
  })) }
}
export type FtaResultStatus = 'current' | 'stale' | 'unverified' | 'not-calculated' | 'invalid'
export function ftaResultFreshness(value: FtaReferenceIndex | readonly FtaFolio[], treeId: string,
  engineRevision = 1): {
  status: FtaResultStatus; reason: string
} {
  const index = asIndex(value), folio = index.trees.get(treeId)
  if (!folio) return { status: 'invalid', reason: 'The tree is missing.' }
  const closure = collectFtaClosure(index, [treeId])
  if (closure.missingTargets.length || closure.issues.some(issue => issue.severity === 'error')) {
    return { status: 'invalid', reason: 'Resolve Transfer errors before calculating this tree.' }
  }
  if (folio.dirty) return { status: 'stale', reason: 'Inputs or referenced trees changed; recalculate.' }
  if (folio.state.result == null) return { status: 'not-calculated', reason: 'No calculation is recorded.' }
  if (!folio.state.resultProvenance || folio.state.resultProvenance.schemaVersion !== 1) {
    return { status: 'unverified', reason: 'Legacy results have no verified dependency context; recalculate.' }
  }
  const current = createFtaResultProvenance(index, treeId, engineRevision)
  const recorded = folio.state.resultProvenance
  return current.fingerprint === recorded.fingerprint && recorded.treeId === treeId
    && recorded.engineRevision === engineRevision && canonical(current.treeIds) === canonical(recorded.treeIds)
    && canonical(current.settings) === canonical(recorded.settings)
    ? { status: 'current', reason: 'Results match this tree and its complete reference context.' }
    : { status: 'stale', reason: 'The recorded calculation used different inputs or references; recalculate.' }
}

/** Propagate graph changes over BOTH old and new incoming references, including deleted edges/trees. */
export function findAffectedFtaTrees(before: readonly FtaFolio[], after: readonly FtaFolio[]): Set<string> {
  if (before === after || (before.length === after.length
    && before.every((folio, index) => folio === after[index]))) return new Set()
  const oldIndex = buildFtaReferenceIndex(before), newIndex = buildFtaReferenceIndex(after)
  const affected = new Set<string>(), propagate: string[] = []
  for (const id of new Set([...oldIndex.trees.keys(), ...newIndex.trees.keys()])) {
    const oldTree = oldIndex.trees.get(id), newTree = newIndex.trees.get(id)
    if (oldTree?.state === newTree?.state) continue
    if (!oldTree || !newTree || graphSignature(oldTree.state) !== graphSignature(newTree.state)) {
      affected.add(id); propagate.push(id)
    } else if (canonical(analysisSettings(oldTree.state)) !== canonical(analysisSettings(newTree.state))) {
      affected.add(id)
    }
  }
  const traversed = new Set<string>()
  while (propagate.length) {
    const id = propagate.pop()!
    if (traversed.has(id)) continue
    traversed.add(id)
    for (const parent of [...oldIndex.parents.get(id) ?? [], ...newIndex.parents.get(id) ?? []]) {
      affected.add(parent.parentId); propagate.push(parent.parentId)
    }
  }
  return affected
}
export function invalidateFtaResults<T extends FtaFolio>(before: readonly FtaFolio[], after: readonly T[]): T[] {
  const affected = findAffectedFtaTrees(before, after)
  const prior = new Map(before.map(folio => [folio.id, folio]))
  return after.map(folio => {
    if (!affected.has(folio.id)) return folio
    const hadResult = folio.state.result != null || prior.get(folio.id)?.state.result != null || prior.get(folio.id)?.dirty
    const hasAnnotations = folio.state.nodes?.some(node => node.data?.computedP != null)
    if (!hadResult && !hasAnnotations && !folio.dirty && !folio.state.resultProvenance) return folio
    return { ...folio, dirty: Boolean(hadResult || folio.dirty), state: {
      ...folio.state,
      ...(hasAnnotations ? { nodes: folio.state.nodes!.map(node => {
        if (node.data?.computedP == null) return node
        const data = { ...node.data }; delete data.computedP
        return { ...node, data }
      }) } : {}),
    } }
  })
}

export interface FtaPlacementRequest {
  parentId: string
  targetId: string
  gateId: string
  /** Explicit zero-based position among the gate's inputs. Never derived from canvas coordinates. */
  order: number
  role?: string
  mode?: 'shared' | 'independent'
  transferId: string
  edgeId: string
  position: { x: number; y: number }
  nodeData?: Record<string, unknown>
}
export class FtaLibraryError extends Error {
  issues: FtaLibraryIssue[]
  constructor(issues: FtaLibraryIssue[]) {
    super(issues.map(issue => issue.message).join(' '))
    this.name = 'FtaLibraryError'
    this.issues = issues
  }
}
function sortedInputs(state: FtaTreeState, gateId: string): FtaEdge[] {
  return normalizeFtaSemanticEdges(modelEdges(state), modelNodes(state))
    .filter(edge => edge.source === gateId).sort((left, right) => left.order - right.order)
}
export function validateFtaPlacement(folios: readonly FtaFolio[], request: FtaPlacementRequest): {
  valid: boolean; issues: FtaLibraryIssue[]
} {
  const index = buildFtaReferenceIndex(folios), issues: FtaLibraryIssue[] = []
  const parent = index.trees.get(request.parentId), target = index.trees.get(request.targetId)
  const fail = (code: string, message: string) => issues.push({ code, message, severity: 'error',
    treeId: request.parentId, targetId: request.targetId, transferId: request.transferId })
  if (!parent) fail('UNKNOWN_PARENT', 'The parent FTA no longer exists.')
  if (!target) fail('MISSING_TARGET', 'The target FTA no longer exists.')
  if (!parent || !target) return { valid: false, issues }
  if (index.issues.some(issue => issue.treeId === request.parentId
    && ['MALFORMED_MODEL', 'DUPLICATE_NODE_ID', 'DUPLICATE_TREE_ID'].includes(issue.code))) {
    fail('MALFORMED_MODEL', 'Repair the parent model’s identities and connections before adding references.')
    return { valid: false, issues }
  }
  if (collectFtaClosure(index, [request.targetId]).treeIds.includes(request.parentId)) {
    fail('TRANSFER_CYCLE', 'This reference would create a Transfer cycle.')
  }
  if (!request.transferId || (parent.state.nodes ?? []).some(node => node.id === request.transferId)) {
    fail('DUPLICATE_TRANSFER_ID', 'Choose a new, nonempty Transfer node identity.')
  }
  if (!request.edgeId || (parent.state.edges ?? []).some(edge => edge.id === request.edgeId)) {
    fail('DUPLICATE_EDGE_ID', 'Choose a new, nonempty connection identity.')
  }
  if (!Number.isFinite(request.position?.x) || !Number.isFinite(request.position?.y)) {
    fail('INVALID_POSITION', 'Choose a finite canvas position for the Transfer.')
  }
  if (request.mode != null && !['shared', 'independent'].includes(request.mode)) {
    fail('INVALID_REFERENCE_MODE', 'Choose shared events or an independent instance.')
  }
  const gate = parent.state.nodes?.find(node => node.id === request.gateId)
  const type = gate?.type ?? ''
  const gateTypes = new Set(['and', 'or', 'vote', 'cardinality', 'xor', 'not', 'nand', 'nor',
    'iff', 'imply', 'inhibit', 'pand', 'por', 'spare', 'fdep', 'seq'])
  if (!gate || !gateTypes.has(type)) {
    fail('INVALID_PARENT_GATE', 'Select an existing compatible parent gate; no gate is inferred.')
    return { valid: false, issues }
  }
  const inputs = sortedInputs(parent.state, gate.id)
  if (!Number.isInteger(request.order) || request.order < 0 || request.order > inputs.length) {
    fail('INVALID_INPUT_ORDER', 'Choose a position among the gate’s existing inputs.')
  }
  const allowedRoles: Record<string, string[]> = {
    inhibit: ['primary', 'condition'], imply: ['antecedent', 'consequent'],
    por: ['priority', 'blocker'], fdep: ['trigger'],
  }
  const role = request.role ?? 'input'
  if (type === 'spare' || type === 'seq') {
    fail('DYNAMIC_CONSTRAINT_INPUT', `${type.toUpperCase()} requires direct event inputs and cannot accept a Transfer.`)
  } else if (allowedRoles[type] && !allowedRoles[type].includes(role)) {
    fail('INPUT_ROLES', `Choose an explicit ${allowedRoles[type].join(' or ')} role for this Transfer.`)
  } else if (!allowedRoles[type] && role !== 'input') {
    fail('INPUT_ROLES', 'This gate uses ordinary input connections.')
  }
  const maximum = type === 'not' ? 1 : ['xor', 'iff', 'imply', 'inhibit'].includes(type) ? 2 : Infinity
  if (inputs.length >= maximum) fail('GATE_ARITY', `${type.toUpperCase()} already has its maximum ${maximum} inputs.`)
  const uniqueRoles = ['primary', 'condition', 'antecedent', 'consequent', 'priority', 'trigger']
  if (uniqueRoles.includes(role) && inputs.some(edge => edge.role === role)) {
    fail('INPUT_ROLES', `${type.toUpperCase()} already has a ${role} input; roles are never reassigned implicitly.`)
  }
  return { valid: issues.length === 0, issues }
}
/** Dense order numbers preserve relative ordering AND stored semantic roles. */
function renumberInputs(edges: readonly FtaEdge[], nodes: readonly FtaNode[], gateIds: ReadonlySet<string>): FtaEdge[] {
  const replacements = new Map<FtaEdge, FtaEdge>()
  const normalized = normalizeFtaSemanticEdges(edges, nodes)
  for (const gateId of gateIds) {
    const ordered = normalized.map((edge, index) => ({ edge, original: edges[index] }))
      .filter(item => item.edge.source === gateId).sort((a, b) => a.edge.order - b.edge.order)
    ordered.forEach(({ edge, original }, order) => replacements.set(original, {
      ...edge, order, data: { ...edge.data, order },
    }))
  }
  return edges.map(edge => replacements.get(edge) ?? edge)
}

function addReferenceDraft(folios: readonly FtaFolio[], request: FtaPlacementRequest): FtaFolio[] {
  const validation = validateFtaPlacement(folios, request)
  if (!validation.valid) throw new FtaLibraryError(validation.issues)
  const parent = folios.find(folio => folio.id === request.parentId)!
  const target = folios.find(folio => folio.id === request.targetId)!
  const ordered = sortedInputs(parent.state, request.gateId).map((edge, index) => ({
    ...edge, data: { ...edge.data,
      role: edge.role, order: index },
  }))
  const role = request.role ?? 'input'
  ordered.splice(request.order, 0, { id: request.edgeId, source: request.gateId, target: request.transferId,
    data: { role, order: request.order } })
  const nextEdges = ordered.map((edge, order) => ({ ...edge,
    role: text(edge.data?.role), order, data: { ...edge.data, order },
  }))
  const node: FtaNode = { id: request.transferId, type: 'transfer', position: { ...request.position },
    data: { ...request.nodeData, label: request.nodeData?.label ?? target.name,
      transferTo: target.id, transferToName: target.name, referenceMode: request.mode ?? 'shared' } }
  delete node.data!.ref_tree
  const next = folios.map(folio => folio.id !== parent.id ? folio : { ...folio, state: {
    ...folio.state, nodes: [...folio.state.nodes ?? [], node],
    edges: [...(folio.state.edges ?? []).filter(edge => edge.source !== request.gateId), ...nextEdges],
  } })
  return next
}
export function addFtaReference(folios: readonly FtaFolio[], request: FtaPlacementRequest): FtaFolio[] {
  return invalidateFtaResults(folios, addReferenceDraft(folios, request))
}

function unlinkReferenceDraft(folios: readonly FtaFolio[], parentId: string, transferIds: readonly string[]): FtaFolio[] {
  const parent = folios.find(folio => folio.id === parentId)
  const selected = new Set(transferIds)
  if (!parent || !selected.size || [...selected].some(id =>
    !parent.state.nodes?.some(node => node.id === id && node.type === 'transfer'))) {
    throw new Error('Select existing Transfer nodes to unlink.')
  }
  const nodes = (parent.state.nodes ?? []).filter(node => !selected.has(node.id))
  const affectedGates = new Set((parent.state.edges ?? []).filter(edge => selected.has(edge.target)).map(edge => edge.source))
  // Resolve inferred roles before removing a sibling, so remaining inputs never acquire its role.
  const priorEdges = normalizeFtaSemanticEdges(parent.state.edges ?? [], parent.state.nodes ?? [])
  const edges = renumberInputs(priorEdges.filter(edge =>
    !selected.has(edge.source) && !selected.has(edge.target)), nodes, affectedGates)
  return folios.map(folio => folio.id !== parentId ? folio : {
    ...folio, state: { ...folio.state, nodes, edges },
  })
}
export function unlinkFtaReferences(folios: readonly FtaFolio[], parentId: string, transferIds: readonly string[]): FtaFolio[] {
  return invalidateFtaResults(folios, unlinkReferenceDraft(folios, parentId, transferIds))
}

export interface FtaMoveReferenceRequest extends Omit<FtaPlacementRequest, 'targetId' | 'mode' | 'nodeData'> {
  sourceParentId: string
  sourceTransferId: string
}
export function moveFtaReference(folios: readonly FtaFolio[], request: FtaMoveReferenceRequest): FtaFolio[] {
  const source = folios.find(folio => folio.id === request.sourceParentId)
  const node = source?.state.nodes?.find(item => item.id === request.sourceTransferId && item.type === 'transfer')
  if (!node) throw new Error('The Transfer to move no longer exists.')
  // Intermediate values are pure and never committed; a rejected placement changes nothing.
  const removed = unlinkReferenceDraft(folios, request.sourceParentId, [request.sourceTransferId])
  const added = addReferenceDraft(removed, { ...request, targetId: transferTarget(node), nodeData: node.data,
    mode: node.data?.referenceMode === 'independent' ? 'independent' : 'shared' })
  return invalidateFtaResults(folios, added)
}

export function deleteFtaTree(folios: readonly FtaFolio[], treeId: string): FtaFolio[] {
  const index = buildFtaReferenceIndex(folios)
  if (!index.trees.has(treeId)) throw new Error('The tree no longer exists.')
  if (index.parents.get(treeId)?.length) throw new Error('Unlink incoming Transfers before deleting this FTA.')
  return invalidateFtaResults(folios, folios.filter(folio => folio.id !== treeId))
}

export interface FtaLibraryPackage {
  schema: 'perdura.fta-library/v1'
  rootTreeIds: string[]
  folios: FtaFolio[]
  catalog: FtaLibraryCatalog
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** Portable model interchange always includes the full closure, each physical tree exactly once. */
export function exportFtaClosure(folios: readonly FtaFolio[], catalog: FtaLibraryCatalog,
  selectedIds: readonly string[]): FtaLibraryPackage {
  if (!selectedIds.length) throw new Error('Select at least one FTA to export.')
  const index = buildFtaReferenceIndex(folios), closure = collectFtaClosure(index, selectedIds)
  if (closure.missingTargets.length || closure.issues.some(issue => issue.severity === 'error')) {
    throw new Error('Resolve missing targets, duplicate identities, and Transfer cycles before exporting a model package.')
  }
  return clone({ schema: 'perdura.fta-library/v1', rootTreeIds: [...new Set(selectedIds)],
    folios: closure.treeIds.map(id => index.trees.get(id)!),
    catalog: normalizeFtaLibrary(closure.treeIds.map(id => index.trees.get(id)!), catalog).catalog })
}

export function remapFtaImport(payload: FtaLibraryPackage, existing: readonly FtaFolio[],
  makeTreeId: (sourceId: string) => string,
  options: { existingCatalog?: FtaLibraryCatalog; preserveSystemLinks?: boolean } = {}): {
  folios: FtaFolio[]; catalog: FtaLibraryCatalog; rootTreeIds: string[];
  idMap: Map<string, string>; unresolvedSystemLinks: { treeId: string; links: FtaSystemLink[] }[]
} {
  if (!payload || payload.schema !== 'perdura.fta-library/v1' || !Array.isArray(payload.folios)
    || !Array.isArray(payload.rootTreeIds) || !payload.rootTreeIds.length) {
    throw new Error('Not a supported FTA library package.')
  }
  if (payload.folios.some(folio => !folio || typeof folio.id !== 'string' || !folio.id
    || !folio.state || !Array.isArray(folio.state.nodes) || !Array.isArray(folio.state.edges)
    || folio.state.nodes.some(node => !node || typeof node.id !== 'string')
    || folio.state.edges.some(edge => !edge || typeof edge.source !== 'string' || typeof edge.target !== 'string'))) {
    throw new Error('The FTA package contains malformed models.')
  }
  const normalized = normalizeFtaLibrary(payload.folios, payload.catalog)
  const index = buildFtaReferenceIndex(normalized.folios), closure = collectFtaClosure(index, payload.rootTreeIds)
  if (closure.missingTargets.length || index.issues.some(issue => issue.severity === 'error')
    || closure.treeIds.length !== normalized.folios.length) {
    throw new Error('The FTA package must contain exactly its complete, valid reference closure.')
  }
  const usedIds = new Set(existing.map(folio => folio.id)), idMap = new Map<string, string>()
  for (const folio of normalized.folios) {
    const id = makeTreeId(folio.id)
    if (!id || usedIds.has(id)) throw new Error('Imported FTA identities must be nonempty and unique.')
    usedIds.add(id); idMap.set(folio.id, id)
  }
  const byTreeId: Record<string, FtaTreeMetadata> = Object.create(null)
  const usedCodes = new Set(Object.values(options.existingCatalog?.byTreeId ?? {}).map(meta => meta.code.toLowerCase()))
  const unresolvedSystemLinks: { treeId: string; links: FtaSystemLink[] }[] = []
  const imported = normalized.folios.map(folio => {
    const copy = clone(folio), id = idMap.get(folio.id)!
    const metadata = clone(normalized.catalog.byTreeId[folio.id])
    const baseCode = metadata.code
    let suffix = 2
    while (usedCodes.has(metadata.code.toLowerCase())) metadata.code = `${baseCode}-${suffix++}`
    usedCodes.add(metadata.code.toLowerCase())
    if (metadata.systemLinks?.length && !options.preserveSystemLinks) {
      unresolvedSystemLinks.push({ treeId: id, links: metadata.systemLinks })
      delete metadata.systemLinks
    }
    byTreeId[id] = metadata
    return { ...copy, id, dirty: Boolean(copy.dirty || copy.state.result != null), state: {
      // The old calculation remains a historical snapshot of its ORIGINAL identities/context.
      // Never relabel its provenance as the newly imported tree or present it as current.
      ...copy.state,
      nodes: copy.state.nodes!.map(node => {
        const data = { ...node.data }; delete data.computedP
        if (node.type === 'transfer') {
          data.transferTo = idMap.get(transferTarget(node))!
          delete data.ref_tree
        }
        return { ...node, data }
      }),
    } }
  })
  return { folios: imported, catalog: { schemaVersion: 1, byTreeId },
    rootTreeIds: payload.rootTreeIds.map(id => idMap.get(id)!), idMap, unresolvedSystemLinks }
}
