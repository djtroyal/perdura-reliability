import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  EMPTY_FAILURE_FLOW_REGISTRY,
  applyFailureFlowProposal,
  buildFailureFlowProposals,
  detachFailureRole,
  failureFlowSnapshot,
  updateFailureStatementText,
} from '../src/components/FMEA/failureFlow.ts'

const parentRef = { folio_id: 'folio-system', analysis_id: 'DFMEA-SYS' }
const childRef = { folio_id: 'folio-board', analysis_id: 'DFMEA-BOARD' }
const parent = {
  ref: parentRef,
  folio_name: 'System',
  lifecycle_status: 'draft',
  analysis: {
    id: 'DFMEA-SYS',
    name: 'System DFMEA',
    kind: 'dfmea',
    revision: 'A',
    functions: [{
      id: 'FN-SYS',
      structure_node_id: 'ST-SYS',
      description: 'Provide controlled output',
    }],
    function_links: [],
    failure_chains: [{
      id: 'FC-SYS',
      function_id: 'FN-SYS',
      effect: 'Mission unavailable',
      failure_mode: 'Controlled output unavailable',
      cause: 'Power stage does not conduct',
    }],
  },
}
const child = {
  ref: childRef,
  folio_name: 'Board',
  lifecycle_status: 'draft',
  analysis: {
    id: 'DFMEA-BOARD',
    name: 'Board DFMEA',
    kind: 'dfmea',
    revision: 'A',
    functions: [{
      id: 'FN-BOARD',
      structure_node_id: 'ST-BOARD',
      description: 'Deliver switched power',
    }],
    function_links: [],
    failure_chains: [],
  },
}
const registry = {
  ...structuredClone(EMPTY_FAILURE_FLOW_REGISTRY),
  analysis_relations: [{
    id: 'REL-1',
    parent: parentRef,
    child: childRef,
    mappings: [{
      id: 'MAP-1',
      parent_function_id: 'FN-SYS',
      child_function_id: 'FN-BOARD',
    }],
    created_at: '2026-07-26T12:00:00Z',
  }],
}

const proposals = buildFailureFlowProposals(
  registry, [parent, child], parentRef)
assert.equal(proposals.length, 1)
assert.equal(proposals[0].child_chain_id, undefined)
assert.equal(proposals[0].already_linked, false)

const linked = applyFailureFlowProposal(
  registry,
  [parent, child],
  proposals[0],
  'Controlled output unavailable',
  'Power stage does not conduct',
)
assert.equal(linked.registry.statements.length, 2)
assert.equal(linked.registry.edges.length, 2)
assert.ok(linked.registry.edges.every(
  edge => edge.function_mapping_id === 'MAP-1'))
assert.deepEqual(
  linked.registry.edges.map(edge => edge.relation).sort(),
  ['higher_cause_to_lower_mode', 'higher_mode_to_lower_effect'],
)
const linkedParent = linked.portfolio[0].analysis.failure_chains[0]
const linkedChild = linked.portfolio[1].analysis.failure_chains[0]
assert.equal(linkedChild.effect, linkedParent.failure_mode)
assert.equal(linkedChild.failure_mode, linkedParent.cause)
assert.equal(
  linkedChild.effect_statement_id,
  linkedParent.failure_mode_statement_id,
)
assert.equal(
  linkedChild.failure_mode_statement_id,
  linkedParent.cause_statement_id,
)

const edited = updateFailureStatementText(
  linked.registry,
  linked.portfolio,
  { ...parentRef, chain_id: 'FC-SYS', role: 'failure_mode' },
  'All controlled output unavailable',
)
assert.ok(edited)
assert.equal(
  edited.portfolio[1].analysis.failure_chains[0].effect,
  'All controlled output unavailable',
)
const editedStatement = edited.registry.statements.find(
  item => item.id === linkedParent.failure_mode_statement_id)
assert.equal(editedStatement.version, 2)

const snapshot = failureFlowSnapshot(
  edited.registry, parentRef, edited.portfolio)
assert.equal(snapshot.owner.analysis_id, 'DFMEA-SYS')
assert.equal(snapshot.edges.length, 2)
assert.equal(snapshot.endpoints.length, 4)

const detached = detachFailureRole(
  edited.registry,
  edited.portfolio,
  {
    ...childRef,
    chain_id: edited.portfolio[1].analysis.failure_chains[0].id,
    role: 'effect',
  },
)
assert.equal(
  detached.registry.edges.filter(edge => edge.status === 'detached').length,
  1,
)
assert.notEqual(
  detached.portfolio[1].analysis.failure_chains[0].effect_statement_id,
  detached.portfolio[0].analysis.failure_chains[0].failure_mode_statement_id,
)

const mergeParent = structuredClone(parent)
const mergeChild = structuredClone(child)
mergeParent.analysis.failure_chains[0].failure_mode_statement_id = 'FS-PARENT-M'
mergeParent.analysis.failure_chains[0].cause_statement_id = 'FS-PARENT-C'
mergeChild.analysis.failure_chains = [{
  id: 'FC-BOARD',
  function_id: 'FN-BOARD',
  effect: 'Controlled output unavailable',
  effect_statement_id: 'FS-CHILD-E',
  failure_mode: 'Power stage does not conduct',
  failure_mode_statement_id: 'FS-CHILD-M',
  cause: '',
}]
const mergeRegistry = {
  ...structuredClone(registry),
  statements: [
    ['FS-PARENT-M', mergeParent.analysis.failure_chains[0].failure_mode,
      { ...parentRef, chain_id: 'FC-SYS', role: 'failure_mode' }],
    ['FS-PARENT-C', mergeParent.analysis.failure_chains[0].cause,
      { ...parentRef, chain_id: 'FC-SYS', role: 'cause' }],
    ['FS-CHILD-E', mergeChild.analysis.failure_chains[0].effect,
      { ...childRef, chain_id: 'FC-BOARD', role: 'effect' }],
    ['FS-CHILD-M', mergeChild.analysis.failure_chains[0].failure_mode,
      { ...childRef, chain_id: 'FC-BOARD', role: 'failure_mode' }],
  ].map(([id, text, origin]) => ({
    id, text, origin, version: 1, updated_at: '2026-07-26T12:00:00Z',
  })),
  edges: [{
    id: 'EDGE-OLD',
    statement_id: 'FS-CHILD-E',
    relation: 'higher_mode_to_lower_effect',
    source: { ...parentRef, chain_id: 'OLD', role: 'failure_mode' },
    target: { ...childRef, chain_id: 'FC-BOARD', role: 'effect' },
    status: 'detached',
    source_revision: 'A',
    target_revision: 'A',
    created_at: '2026-07-26T12:00:00Z',
  }],
}
const merged = applyFailureFlowProposal(
  mergeRegistry,
  [mergeParent, mergeChild],
  { ...proposals[0], child_chain_id: 'FC-BOARD' },
  'Controlled output unavailable',
  'Power stage does not conduct',
)
const survivingStatementIds = new Set(
  merged.registry.statements.map(item => item.id))
assert.ok(merged.registry.edges.every(
  edge => survivingStatementIds.has(edge.statement_id)),
  'merging canonical identities must rewrite existing edges')
assert.ok(!survivingStatementIds.has('FS-CHILD-E'))
assert.ok(!survivingStatementIds.has('FS-CHILD-M'))

const demo = JSON.parse(await readFile(
  new URL('../src/data/demoProject.json', import.meta.url), 'utf8'))
assert.equal(demo.modules.fmeaFailureFlow.edges.length, 2)
assert.ok(demo.modules.fmea.folios[0].state.analyses[0].function_links.some(
  link => link.relationship === 'decomposes_to'))

console.log('FMEA failure-flow contracts passed')
