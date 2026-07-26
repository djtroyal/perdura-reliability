import type {
  FMEAAnalysisRef,
  FMEAAnalysisRelation,
  FMEAFailureEndpointSnapshot,
  FMEAFailureFlowEdge,
  FMEAFailureFlowRegistry,
  FMEAFailureFlowSnapshot,
  FMEAFailureRole,
  FMEAFailureRoleRef,
  FMEAFailureStatement,
  FMEALifecycleStatus,
} from '../../api/fmea'
import type {
  AIAGVDAFMEAAnalysis,
  FMEAFailureChain,
  FMEAKind,
} from '../../api/reliabilityProgram'

export interface FMEAFlowPortfolioAnalysis {
  ref: FMEAAnalysisRef
  folio_name: string
  analysis: AIAGVDAFMEAAnalysis
  lifecycle_status: FMEALifecycleStatus
}

export interface FailureFlowProposal {
  id: string
  parent: FMEAAnalysisRef
  child: FMEAAnalysisRef
  parent_chain_id: string
  child_chain_id?: string
  parent_function_id: string
  child_function_id: string
  analysis_relation_id?: string
  mapping_id?: string
  source: 'function_decomposition'|'portfolio_mapping'
  already_linked: boolean
}

export interface FailureFlowCommit {
  registry: FMEAFailureFlowRegistry
  portfolio: FMEAFlowPortfolioAnalysis[]
}

export const EMPTY_FAILURE_FLOW_REGISTRY: FMEAFailureFlowRegistry = {
  schema_version: 1,
  statements: [],
  analysis_relations: [],
  edges: [],
  history: [],
}

const nowIso = () => new Date().toISOString()
const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export function normalizeFailureFlowRegistry(
  source?: Partial<FMEAFailureFlowRegistry>|null,
): FMEAFailureFlowRegistry {
  return {
    schema_version: 1,
    statements: Array.isArray(source?.statements)
      ? structuredClone(source.statements) : [],
    analysis_relations: Array.isArray(source?.analysis_relations)
      ? structuredClone(source.analysis_relations) : [],
    edges: Array.isArray(source?.edges) ? structuredClone(source.edges) : [],
    history: Array.isArray(source?.history)
      ? structuredClone(source.history).slice(-50000) : [],
  }
}

export const analysisRefKey = (ref: FMEAAnalysisRef) =>
  `${ref.folio_id}\u0000${ref.analysis_id}`

export const roleRefKey = (ref: FMEAFailureRoleRef) =>
  `${analysisRefKey(ref)}\u0000${ref.chain_id}\u0000${ref.role}`

export function sameAnalysisRef(a: FMEAAnalysisRef, b: FMEAAnalysisRef) {
  return a.folio_id === b.folio_id && a.analysis_id === b.analysis_id
}

const roleTextField = (role: FMEAFailureRole):
  'effect'|'failure_mode'|'cause' => role

const roleIdField = (role: FMEAFailureRole):
  'effect_statement_id'|'failure_mode_statement_id'|'cause_statement_id' =>
  role === 'effect'
    ? 'effect_statement_id'
    : role === 'failure_mode'
      ? 'failure_mode_statement_id'
      : 'cause_statement_id'

export function failureRoleStatementId(
  chain: FMEAFailureChain,
  role: FMEAFailureRole,
) {
  return chain[roleIdField(role)]
}

export function failureRoleText(
  chain: FMEAFailureChain,
  role: FMEAFailureRole,
) {
  return chain[roleTextField(role)]
}

function findPortfolioAnalysis(
  portfolio: FMEAFlowPortfolioAnalysis[],
  ref: FMEAAnalysisRef,
) {
  return portfolio.find(item => sameAnalysisRef(item.ref, ref))
}

function findChain(
  portfolio: FMEAFlowPortfolioAnalysis[],
  ref: FMEAFailureRoleRef,
) {
  return findPortfolioAnalysis(portfolio, ref)?.analysis.failure_chains.find(
    chain => chain.id === ref.chain_id)
}

function setRole(
  chain: FMEAFailureChain,
  role: FMEAFailureRole,
  statementId: string|undefined,
  text: string,
): FMEAFailureChain {
  return {
    ...chain,
    [roleTextField(role)]: text,
    [roleIdField(role)]: statementId,
  }
}

function mutableLifecycle(status: FMEALifecycleStatus) {
  return status === 'draft' || status === 'in_review' || status === 'approved'
}

function updateBoundRoles(
  portfolio: FMEAFlowPortfolioAnalysis[],
  statementIds: Set<string>,
  canonicalId: string,
  text: string,
) {
  return portfolio.map(item => {
    if (!mutableLifecycle(item.lifecycle_status)) return item
    let changed = false
    const failure_chains = item.analysis.failure_chains.map(chain => {
      let next = chain
      for (const role of (
        ['effect', 'failure_mode', 'cause'] as FMEAFailureRole[]
      )) {
        const currentId = failureRoleStatementId(next, role)
        if (!currentId || !statementIds.has(currentId)) continue
        next = setRole(next, role, canonicalId, text)
        changed = true
      }
      return next
    })
    return changed
      ? { ...item, analysis: { ...item.analysis, failure_chains } }
      : item
  })
}

function addEvent(
  registry: FMEAFailureFlowRegistry,
  event: Omit<FMEAFailureFlowRegistry['history'][number], 'id'|'timestamp'>,
) {
  registry.history = [...registry.history, {
    id: uid('FFE'),
    timestamp: nowIso(),
    ...event,
  }].slice(-50000)
}

export function updateFailureStatementText(
  registrySource: FMEAFailureFlowRegistry,
  portfolioSource: FMEAFlowPortfolioAnalysis[],
  ref: FMEAFailureRoleRef,
  text: string,
): FailureFlowCommit|null {
  const chain = findChain(portfolioSource, ref)
  if (!chain) return null
  const statementId = failureRoleStatementId(chain, ref.role)
  if (!statementId) return null
  const registry = normalizeFailureFlowRegistry(registrySource)
  const existing = registry.statements.find(item => item.id === statementId)
  if (!existing) return null
  const portfolio = updateBoundRoles(
    structuredClone(portfolioSource),
    new Set([statementId]),
    statementId,
    text,
  )
  registry.statements = registry.statements.map(statement =>
    statement.id === statementId
      ? {
          ...statement,
          text,
          version: statement.version + 1,
          updated_at: nowIso(),
        }
      : statement)
  addEvent(registry, {
    action: 'edit',
    statement_id: statementId,
    summary: `Updated linked failure statement from ${ref.role.replace('_', ' ')}.`,
  })
  return { registry, portfolio }
}

function emptyFailureChain(kind: FMEAKind, id: string): FMEAFailureChain {
  return {
    id,
    effect: '',
    effect_contexts: [],
    failure_mode: '',
    cause: '',
    effect_level: '',
    severity: 5,
    occurrence: kind === 'fmea_msr' ? undefined : 5,
    detection: kind === 'fmea_msr' ? undefined : 5,
    frequency: kind === 'fmea_msr' ? 5 : undefined,
    monitoring: kind === 'fmea_msr' ? 5 : undefined,
    prevention_controls: '',
    detection_controls: '',
    severity_rationale: '',
    occurrence_rationale: '',
    detection_rationale: '',
    frequency_rationale: '',
    monitoring_rationale: '',
    actions: [],
    no_action_justification: '',
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
  }
}

function nextChainId(analysis: AIAGVDAFMEAAnalysis) {
  const used = new Set(analysis.failure_chains.map(item => item.id))
  let sequence = analysis.failure_chains.length + 1
  let value = `FC-${sequence}`
  while (used.has(value)) value = `FC-${++sequence}`
  return value
}

function analysisRevision(
  portfolio: FMEAFlowPortfolioAnalysis[],
  ref: FMEAAnalysisRef,
) {
  return findPortfolioAnalysis(portfolio, ref)?.analysis.revision ?? ''
}

function ensureStatementForRoles(
  registry: FMEAFailureFlowRegistry,
  portfolioSource: FMEAFlowPortfolioAnalysis[],
  source: FMEAFailureRoleRef,
  target: FMEAFailureRoleRef,
  text: string,
): {
  registry: FMEAFailureFlowRegistry
  portfolio: FMEAFlowPortfolioAnalysis[]
  statementId: string
} {
  const sourceChain = findChain(portfolioSource, source)
  const targetChain = findChain(portfolioSource, target)
  const sourceId = sourceChain
    ? failureRoleStatementId(sourceChain, source.role) : undefined
  const targetId = targetChain
    ? failureRoleStatementId(targetChain, target.role) : undefined
  const statementId = sourceId || targetId || uid('FS')
  const mergedIds = new Set(
    [sourceId, targetId, statementId].filter(Boolean) as string[])
  let portfolio = updateBoundRoles(
    portfolioSource, mergedIds, statementId, text)
  portfolio = portfolio.map(item => {
    if (!mutableLifecycle(item.lifecycle_status)) return item
    if (!sameAnalysisRef(item.ref, source)
        && !sameAnalysisRef(item.ref, target)) return item
    let changed = false
    const failure_chains = item.analysis.failure_chains.map(chain => {
      let next = chain
      if (sameAnalysisRef(item.ref, source)
          && chain.id === source.chain_id) {
        next = setRole(next, source.role, statementId, text)
        changed = true
      }
      if (sameAnalysisRef(item.ref, target)
          && chain.id === target.chain_id) {
        next = setRole(next, target.role, statementId, text)
        changed = true
      }
      return next
    })
    return changed
      ? { ...item, analysis: { ...item.analysis, failure_chains } }
      : item
  })
  const existingStatements = registry.statements.filter(item =>
    mergedIds.has(item.id))
  const existing = existingStatements.find(item => item.id === statementId)
    ?? existingStatements.sort((a, b) => b.version - a.version)[0]
  const statement: FMEAFailureStatement = {
    id: statementId,
    text,
    version: Math.max(
      0, ...existingStatements.map(item => item.version)) + 1,
    origin: existing?.origin ?? source,
    updated_at: nowIso(),
  }
  registry.statements = [
    ...registry.statements.filter(item => !mergedIds.has(item.id)),
    statement,
  ]
  registry.edges = registry.edges.map(edge =>
    mergedIds.has(edge.statement_id)
      ? { ...edge, statement_id: statementId }
      : edge)
  registry.history = registry.history.map(event =>
    event.statement_id && mergedIds.has(event.statement_id)
      ? { ...event, statement_id: statementId }
      : event)
  if (mergedIds.size > 1) {
    addEvent(registry, {
      action: 'merge',
      statement_id: statementId,
      summary: 'Merged existing failure-statement identities after analyst reconciliation.',
    })
  }
  return { registry, portfolio, statementId }
}

function addFlowEdge(
  registry: FMEAFailureFlowRegistry,
  portfolio: FMEAFlowPortfolioAnalysis[],
  relation: FMEAFailureFlowEdge['relation'],
  source: FMEAFailureRoleRef,
  target: FMEAFailureRoleRef,
  statementId: string,
  analysisRelationId?: string,
  functionMappingId?: string,
) {
  const duplicate = registry.edges.find(edge =>
    edge.status === 'active'
    && edge.relation === relation
    && roleRefKey(edge.source) === roleRefKey(source)
    && roleRefKey(edge.target) === roleRefKey(target))
  if (duplicate) return
  const edge: FMEAFailureFlowEdge = {
    id: uid('FFL'),
    statement_id: statementId,
    relation,
    source,
    target,
    analysis_relation_id: analysisRelationId,
    function_mapping_id: functionMappingId,
    status: 'active',
    source_revision: analysisRevision(portfolio, source),
    target_revision: analysisRevision(portfolio, target),
    created_at: nowIso(),
  }
  registry.edges.push(edge)
  addEvent(registry, {
    action: 'link',
    statement_id: statementId,
    edge_id: edge.id,
    summary: relation === 'higher_mode_to_lower_effect'
      ? 'Linked higher-level failure mode to lower-level effect.'
      : 'Linked higher-level cause to lower-level failure mode.',
  })
}

export function applyFailureFlowProposal(
  registrySource: FMEAFailureFlowRegistry,
  portfolioSource: FMEAFlowPortfolioAnalysis[],
  proposal: FailureFlowProposal,
  canonicalModeText: string,
  canonicalCauseText: string,
): FailureFlowCommit {
  const registry = normalizeFailureFlowRegistry(registrySource)
  let portfolio = structuredClone(portfolioSource)
  const parentRecord = findPortfolioAnalysis(portfolio, proposal.parent)
  const childRecord = findPortfolioAnalysis(portfolio, proposal.child)
  if (!parentRecord || !childRecord) {
    throw new Error('The mapped parent or child FMEA is no longer available.')
  }
  const parentChain = parentRecord.analysis.failure_chains.find(
    item => item.id === proposal.parent_chain_id)
  if (!parentChain) throw new Error('The parent failure chain is no longer available.')

  let childChainId = proposal.child_chain_id
  if (!childChainId) {
    childChainId = nextChainId(childRecord.analysis)
    const created = {
      ...emptyFailureChain(childRecord.analysis.kind, childChainId),
      function_id: proposal.child_function_id,
      effect: canonicalModeText,
      failure_mode: canonicalCauseText,
    }
    portfolio = portfolio.map(item =>
      sameAnalysisRef(item.ref, proposal.child)
        ? {
            ...item,
            analysis: {
              ...item.analysis,
              failure_chains: [...item.analysis.failure_chains, created],
            },
          }
        : item)
  }

  const modeSource: FMEAFailureRoleRef = {
    ...proposal.parent,
    chain_id: proposal.parent_chain_id,
    role: 'failure_mode',
  }
  const effectTarget: FMEAFailureRoleRef = {
    ...proposal.child,
    chain_id: childChainId,
    role: 'effect',
  }
  const modeLink = ensureStatementForRoles(
    registry, portfolio, modeSource, effectTarget, canonicalModeText)
  portfolio = modeLink.portfolio
  addFlowEdge(
    registry, portfolio, 'higher_mode_to_lower_effect',
    modeSource, effectTarget, modeLink.statementId,
    proposal.analysis_relation_id, proposal.mapping_id,
  )

  const causeSource: FMEAFailureRoleRef = {
    ...proposal.parent,
    chain_id: proposal.parent_chain_id,
    role: 'cause',
  }
  const modeTarget: FMEAFailureRoleRef = {
    ...proposal.child,
    chain_id: childChainId,
    role: 'failure_mode',
  }
  const causeLink = ensureStatementForRoles(
    registry, portfolio, causeSource, modeTarget, canonicalCauseText)
  portfolio = causeLink.portfolio
  addFlowEdge(
    registry, portfolio, 'higher_cause_to_lower_mode',
    causeSource, modeTarget, causeLink.statementId,
    proposal.analysis_relation_id, proposal.mapping_id,
  )

  // Preserve local functional allocation when both levels are in one FMEA.
  if (sameAnalysisRef(proposal.parent, proposal.child)) {
    portfolio = portfolio.map(item => {
      if (!sameAnalysisRef(item.ref, proposal.parent)) return item
      return {
        ...item,
        analysis: {
          ...item.analysis,
          failure_chains: item.analysis.failure_chains.map(chain => {
            if (chain.id === proposal.parent_chain_id) {
              return { ...chain, cause_function_id: proposal.child_function_id }
            }
            if (chain.id === childChainId) {
              return { ...chain, effect_function_id: proposal.parent_function_id }
            }
            return chain
          }),
        },
      }
    })
  }
  return { registry, portfolio }
}

function relationMatchesActive(
  relation: FMEAAnalysisRelation,
  active: FMEAAnalysisRef,
) {
  return sameAnalysisRef(relation.parent, active)
    || sameAnalysisRef(relation.child, active)
}

function edgeExistsForProposal(
  registry: FMEAFailureFlowRegistry,
  proposal: Omit<FailureFlowProposal, 'already_linked'>,
) {
  if (!proposal.child_chain_id) return false
  const expected = [
    {
      relation: 'higher_mode_to_lower_effect',
      sourceRole: 'failure_mode',
      targetRole: 'effect',
    },
    {
      relation: 'higher_cause_to_lower_mode',
      sourceRole: 'cause',
      targetRole: 'failure_mode',
    },
  ] as const
  return expected.every(item => registry.edges.some(edge =>
    edge.status === 'active'
    && edge.relation === item.relation
    && roleRefKey(edge.source) === roleRefKey({
      ...proposal.parent,
      chain_id: proposal.parent_chain_id,
      role: item.sourceRole,
    })
    && roleRefKey(edge.target) === roleRefKey({
      ...proposal.child,
      chain_id: proposal.child_chain_id!,
      role: item.targetRole,
    })))
}

function bestChildChain(
  chains: FMEAFailureChain[],
  parentChain: FMEAFailureChain,
) {
  const normalize = (value: string) =>
    value.trim().toLocaleLowerCase().replace(/\s+/g, ' ')
  return chains.find(chain =>
    normalize(chain.effect) === normalize(parentChain.failure_mode)
    && normalize(chain.failure_mode) === normalize(parentChain.cause))
    ?? chains.find(chain =>
      normalize(chain.effect) === normalize(parentChain.failure_mode))
    ?? chains[0]
}

export function buildFailureFlowProposals(
  registry: FMEAFailureFlowRegistry,
  portfolio: FMEAFlowPortfolioAnalysis[],
  active: FMEAAnalysisRef,
): FailureFlowProposal[] {
  const raw: Omit<FailureFlowProposal, 'already_linked'>[] = []
  const pushMapping = (
    parent: FMEAFlowPortfolioAnalysis,
    child: FMEAFlowPortfolioAnalysis,
    parentFunctionId: string,
    childFunctionId: string,
    source: FailureFlowProposal['source'],
    relationId?: string,
    mappingId?: string,
  ) => {
    const parentChains = parent.analysis.failure_chains.filter(
      chain => chain.function_id === parentFunctionId
        && (chain.failure_mode.trim() || chain.cause.trim()))
    const childChains = child.analysis.failure_chains.filter(
      chain => chain.function_id === childFunctionId)
    for (const parentChain of parentChains) {
      const childChain = bestChildChain(childChains, parentChain)
      raw.push({
        id: [
          analysisRefKey(parent.ref), parentChain.id,
          analysisRefKey(child.ref), childFunctionId,
        ].join('::'),
        parent: parent.ref,
        child: child.ref,
        parent_chain_id: parentChain.id,
        child_chain_id: childChain?.id,
        parent_function_id: parentFunctionId,
        child_function_id: childFunctionId,
        analysis_relation_id: relationId,
        mapping_id: mappingId,
        source,
      })
    }
  }

  for (const item of portfolio) {
    if (!sameAnalysisRef(item.ref, active)) continue
    for (const link of item.analysis.function_links) {
      if (link.relationship !== 'decomposes_to') continue
      pushMapping(
        item, item, link.source_function_id, link.target_function_id,
        'function_decomposition',
      )
    }
  }
  for (const relation of registry.analysis_relations) {
    if (!relationMatchesActive(relation, active)) continue
    const parent = findPortfolioAnalysis(portfolio, relation.parent)
    const child = findPortfolioAnalysis(portfolio, relation.child)
    if (!parent || !child) continue
    for (const mapping of relation.mappings) {
      pushMapping(
        parent, child,
        mapping.parent_function_id, mapping.child_function_id,
        'portfolio_mapping', relation.id, mapping.id,
      )
    }
  }
  const unique = new Map(raw.map(proposal => [proposal.id, proposal]))
  return [...unique.values()].map(proposal => ({
    ...proposal,
    already_linked: edgeExistsForProposal(registry, proposal),
  }))
}

export function detachFailureRole(
  registrySource: FMEAFailureFlowRegistry,
  portfolioSource: FMEAFlowPortfolioAnalysis[],
  ref: FMEAFailureRoleRef,
): FailureFlowCommit {
  const registry = normalizeFailureFlowRegistry(registrySource)
  const chain = findChain(portfolioSource, ref)
  if (!chain) throw new Error('The linked failure role is no longer available.')
  const currentStatementId = failureRoleStatementId(chain, ref.role)
  const text = failureRoleText(chain, ref.role)
  const timestamp = nowIso()
  const detachedEdges = registry.edges.filter(edge =>
    edge.status === 'active'
    && (
      roleRefKey(edge.source) === roleRefKey(ref)
      || roleRefKey(edge.target) === roleRefKey(ref)
    ))
  registry.edges = registry.edges.map(edge =>
    detachedEdges.some(item => item.id === edge.id)
      ? { ...edge, status: 'detached', detached_at: timestamp }
      : edge)
  const statementId = uid('FS')
  let portfolio = structuredClone(portfolioSource)
  portfolio = portfolio.map(item => {
    if (!sameAnalysisRef(item.ref, ref)) return item
    return {
      ...item,
      analysis: {
        ...item.analysis,
        failure_chains: item.analysis.failure_chains.map(itemChain =>
          itemChain.id === ref.chain_id
            ? setRole(itemChain, ref.role, statementId, text)
            : itemChain),
      },
    }
  })
  registry.statements.push({
    id: statementId,
    text,
    version: 1,
    origin: ref,
    updated_at: timestamp,
  })
  addEvent(registry, {
    action: 'detach',
    statement_id: currentStatementId,
    summary: `Detached ${ref.role.replace('_', ' ')} from ${detachedEdges.length} flow link(s).`,
  })
  return { registry, portfolio }
}

export function failureFlowSnapshot(
  registrySource: FMEAFailureFlowRegistry,
  owner: FMEAAnalysisRef,
  portfolio: FMEAFlowPortfolioAnalysis[],
): FMEAFailureFlowSnapshot {
  const registry = normalizeFailureFlowRegistry(registrySource)
  const ownerEdges = registry.edges.filter(edge =>
    sameAnalysisRef(edge.source, owner) || sameAnalysisRef(edge.target, owner))
  const statementIds = new Set(ownerEdges.map(edge => edge.statement_id))
  // A canonical statement can span more than two adjacent levels. Capture its
  // complete link set so a controlled revision retains the full provenance
  // chain instead of only the edge touching the current analysis.
  const relevantEdges = registry.edges.filter(edge =>
    statementIds.has(edge.statement_id))
  const relationIds = new Set(
    relevantEdges.map(edge => edge.analysis_relation_id).filter(Boolean))
  const relevantRelations = registry.analysis_relations.filter(relation =>
    relationIds.has(relation.id)
    || sameAnalysisRef(relation.parent, owner)
    || sameAnalysisRef(relation.child, owner))
  const relevantStatements = registry.statements.filter(statement =>
    statementIds.has(statement.id))
  const endpointRefs = new Map<string, FMEAFailureRoleRef>()
  for (const edge of relevantEdges) {
    endpointRefs.set(roleRefKey(edge.source), edge.source)
    endpointRefs.set(roleRefKey(edge.target), edge.target)
  }
  for (const statement of relevantStatements) {
    endpointRefs.set(roleRefKey(statement.origin), statement.origin)
  }
  const endpoints: FMEAFailureEndpointSnapshot[] = []
  for (const ref of endpointRefs.values()) {
    const record = findPortfolioAnalysis(portfolio, ref)
    const chain = record?.analysis.failure_chains.find(
      item => item.id === ref.chain_id)
    if (!record || !chain) continue
    const functionId = ref.role === 'effect'
      ? chain.effect_function_id
      : ref.role === 'cause'
        ? chain.cause_function_id
        : chain.function_id
    endpoints.push({
      ...ref,
      statement_id: failureRoleStatementId(chain, ref.role),
      text: failureRoleText(chain, ref.role),
      analysis_kind: record.analysis.kind,
      analysis_revision: record.analysis.revision,
      lifecycle_status: record.lifecycle_status,
      function_id: functionId,
      structure_node_id: functionId
        ? record.analysis.functions.find(item => item.id === functionId)
          ?.structure_node_id
        : ref.role === 'cause' ? chain.cause_structure_node_id : undefined,
    })
  }
  const edgeIds = new Set(relevantEdges.map(edge => edge.id))
  return {
    schema_version: 1,
    owner,
    statements: relevantStatements,
    analysis_relations: relevantRelations,
    edges: relevantEdges,
    history: registry.history.filter(event =>
      (event.edge_id && edgeIds.has(event.edge_id))
      || (event.statement_id && statementIds.has(event.statement_id))),
    endpoints,
  }
}

export function analysisDisplayName(
  portfolio: FMEAFlowPortfolioAnalysis[],
  ref: FMEAAnalysisRef,
) {
  const item = findPortfolioAnalysis(portfolio, ref)
  return item
    ? `${item.folio_name} · ${item.analysis.name}`
    : `${ref.folio_id} · ${ref.analysis_id}`
}
