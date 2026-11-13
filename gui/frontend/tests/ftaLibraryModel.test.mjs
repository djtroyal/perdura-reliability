import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import {
  normalizeFtaLibrary, buildFtaReferenceIndex, collectFtaClosure, visibleFtaHierarchy,
  ftaOccurrenceKey, searchFtaLibrary, semanticFtaFingerprint, createFtaResultProvenance,
  ftaResultFreshness, findAffectedFtaTrees, invalidateFtaResults, validateFtaPlacement,
  addFtaReference, unlinkFtaReferences, moveFtaReference, deleteFtaTree,
  exportFtaClosure, remapFtaImport, sha256FtaText, normalizeFtaSemanticEdges,
} from '../src/components/FaultTree/libraryModel.ts'

const event = (id = 'event', p = 0.1) => ({ id, type: 'basic',
  position: { x: 0, y: 100 }, data: { label: id, probability: p, eventKey: id } })
const transfer = (id, target, mode = 'shared') => ({ id, type: 'transfer',
  position: { x: 50, y: 100 }, data: { transferTo: target, referenceMode: mode, label: target } })
const edge = (source, target, order = 0, role = 'input') => ({ id: `${source}-${target}`,
  source, target, data: { order, role } })
const tree = (id, refs = [], type = 'or') => ({ id, name: `Tree ${id}`, state: {
  nodes: [{ id: 'top', type, data: { label: 'Top' } }, event(),
    ...refs.map((ref, index) => transfer(`x${index}`, typeof ref === 'string' ? ref : ref.id,
      typeof ref === 'string' ? 'shared' : ref.mode))],
  edges: [edge('top', 'event'), ...refs.map((_, index) => edge('top', `x${index}`, index + 1))],
  exposureTime: '1000', engine: 'auto', confidenceLevel: '95', nSimulations: '20000', simSeed: '',
} })
const stamp = (folios, id) => folios.map(folio => folio.id !== id ? folio : { ...folio,
  state: { ...folio.state, result: { top_event_probability: 0.1 },
    resultProvenance: createFtaResultProvenance(folios, id) } })
const edit = (folios, id, updater) => folios.map(folio => folio.id === id
  ? { ...folio, state: updater(folio.state) } : folio)
const placement = (patch = {}) => ({ parentId: 'a', targetId: 'b', gateId: 'top',
  order: 1, role: 'input', transferId: 'new-transfer', edgeId: 'new-edge',
  position: { x: 90, y: 180 }, ...patch })

test('legacy normalization preserves identities, graphs and project-qualified links without a parent field', () => {
  const original = { _folioWrap: true, activeId: 'old-id', folios: [tree('old-id')] }
  const normalized = normalizeFtaLibrary(original, { byTreeId: {
    'old-id': { code: 'SYS-01', description: 'Loss of cooling', tags: ['cooling', 'cooling', ''],
      parentTreeId: 'invented', systemLinks: [{ systemModelId: 'system1', instanceId: 'pump1' }, { instanceId: 'bad' }] },
  } })
  assert.equal(normalized.activeId, 'old-id')
  assert.equal(normalized.folios[0].state, original.folios[0].state)
  assert.deepEqual(normalized.catalog.byTreeId['old-id'], { code: 'SYS-01', description: 'Loss of cooling',
    tags: ['cooling'], systemLinks: [{ systemModelId: 'system1', instanceId: 'pump1' }] })
  const legacy = normalizeFtaLibrary({ nodes: [event()], edges: [] })
  assert.equal(legacy.folios[0].id, 'f0')
  assert.deepEqual(legacy.folios[0].state.nodes, [event()])
  assert.equal(normalizeFtaLibrary(undefined).folios.length, 0)
})

test('DAG groups duplicate transfers but preserves mathematical identity mode and all parents', () => {
  const index = buildFtaReferenceIndex([tree('a', ['c', { id: 'c', mode: 'independent' }]), tree('b', ['c']), tree('c')])
  assert.deepEqual(index.roots, ['a', 'b'])
  assert.equal(index.children.get('a').length, 1)
  assert.equal(index.children.get('a')[0].references.length, 2)
  assert.deepEqual(index.children.get('a')[0].references.map(ref => ref.mode), ['shared', 'independent'])
  assert.deepEqual(index.parents.get('c').map(group => group.parentId), ['a', 'b'])
  assert.deepEqual(index.issues, [])
})

test('disconnected and legacy-alias Transfers are indexed, while missing targets remain visible issues', () => {
  const a = tree('a')
  a.state.nodes.push({ ...transfer('loose', 'b'), data: { ref_tree: 'b' } }, transfer('missing', 'gone'))
  const index = buildFtaReferenceIndex([a, tree('b')])
  assert.deepEqual(index.roots, ['a'])
  assert.equal(index.references.length, 2)
  assert.equal(index.references[0].placed, false)
  assert.ok(index.issues.some(issue => issue.code === 'UNPLACED_TRANSFER'))
  assert.ok(index.issues.some(issue => issue.code === 'MISSING_TARGET' && issue.targetId === 'gone'))
  assert.deepEqual(collectFtaClosure(index, ['a']).missingTargets, ['gone'])
  const soleTransfer = { id: 'root', name: 'Root', state: { nodes: [transfer('only', 'b')], edges: [] } }
  assert.equal(buildFtaReferenceIndex([soleTransfer, tree('b')]).references[0].placed, true)
})

test('referenced blank or multiple-root drafts invalidate all parent contexts until a causal top event exists', () => {
  const blank = { id:'b', name:'Unfinished child', state:{nodes:[],edges:[]} }
  assert.equal(ftaResultFreshness([blank],'b').status,'not-calculated','standalone blank trees are drafts')
  const parent = tree('a',['b'])
  let index = buildFtaReferenceIndex([parent,blank])
  assert.ok(index.issues.some(issue=>issue.code==='INVALID_TARGET_ROOT'&&issue.treeId==='b'))
  assert.equal(ftaResultFreshness(index,'a').status,'invalid')
  assert.equal(ftaResultFreshness(index,'b').status,'invalid')
  assert.throws(()=>createFtaResultProvenance(index,'a'),/unresolved Transfer issues/)
  index = buildFtaReferenceIndex([parent,{...blank,state:{nodes:[event('one'),event('two')],edges:[]}}])
  assert.ok(index.issues.some(issue=>issue.code==='INVALID_TARGET_ROOT'&&issue.message.includes('found 2')))
  index = buildFtaReferenceIndex([parent,{...blank,state:{nodes:[event('one')],edges:[]}}])
  assert.ok(!index.issues.some(issue=>issue.code==='INVALID_TARGET_ROOT'))
  assert.equal(ftaResultFreshness(index,'a').status,'not-calculated')
})

test('rootless cycles and their descendants are discoverable and terminate in the hierarchy', () => {
  const index = buildFtaReferenceIndex([tree('a', ['b']), tree('b', ['a', 'c']), tree('c')])
  assert.deepEqual(index.roots, [])
  assert.equal(index.cycles.length, 1)
  assert.deepEqual(new Set(index.issueRoots), new Set(['a', 'b', 'c']))
  const rows = visibleFtaHierarchy(index, { has: () => true }, { limit: 100 })
  assert.equal(rows.truncated, false)
  assert.ok(rows.rows.some(row => row.cycle && !row.hasChildren && !row.expanded))
  assert.deepEqual(new Set(collectFtaClosure(index, ['a']).treeIds), new Set(['a', 'b', 'c']))
  assert.equal(ftaResultFreshness(index, 'a').status, 'invalid')
})

test('malformed legacy diagrams and duplicate identities stay visible as repairable issues', () => {
  const malformed = { id: 'broken', name: 'Broken legacy tree', state: { nodes: [null, { id: 12 }], edges: 'bad' } }
  const duplicate = tree('duplicate')
  duplicate.state.nodes.push(event())
  const index = buildFtaReferenceIndex([malformed, duplicate])
  assert.deepEqual(index.roots, ['broken', 'duplicate'])
  assert.ok(index.issues.some(issue => issue.code === 'MALFORMED_MODEL' && issue.treeId === 'broken'))
  assert.ok(index.issues.some(issue => issue.code === 'DUPLICATE_NODE_ID' && issue.treeId === 'duplicate'))
  assert.equal(ftaResultFreshness(index, 'broken').status, 'invalid')
  assert.equal(validateFtaPlacement([malformed, tree('b')], placement({ parentId: 'broken' })).valid, false)
})

test('occurrences have path identities but share the canonical analysis identity', () => {
  const index = buildFtaReferenceIndex([tree('a', ['c']), tree('b', ['c']), tree('c')])
  const expanded = new Set([ftaOccurrenceKey(['a']), ftaOccurrenceKey(['b'])])
  const { rows } = visibleFtaHierarchy(index, expanded)
  const repeated = rows.filter(row => row.treeId === 'c')
  assert.equal(repeated.length, 2)
  assert.ok(repeated.every(row => row.repeated))
  assert.notEqual(repeated[0].key, repeated[1].key)
  assert.deepEqual(repeated.map(row => row.parentId), ['a', 'b'])
})

test('500-tree chain and exponentially branching DAG use bounded lazy occurrence traversal', () => {
  const folios = Array.from({ length: 500 }, (_, index) => tree(`t${index}`, index < 499 ? [`t${index + 1}`] : []))
  const index = buildFtaReferenceIndex(folios)
  assert.equal(collectFtaClosure(index, ['t0']).treeIds.length, 500)
  const all = visibleFtaHierarchy(index, { has: () => true }, { limit: 600 })
  assert.equal(all.rows.length, 500)
  assert.equal(all.rows[499].depth, 499)
  assert.equal(all.truncated, false)
  const branching = Array.from({ length: 100 }, (_, n) => tree(`n${n}`, n < 98 ? [`n${n + 1}`, `n${n + 2}`] : []))
  const bounded = visibleFtaHierarchy(buildFtaReferenceIndex(branching), { has: () => true }, { limit: 120 })
  assert.equal(bounded.rows.length, 120)
  assert.equal(bounded.truncated, true)
  assert.equal(new Set(bounded.rows.map(row => row.key)).size, 120)
})

test('search returns each tree once using code, description and tags', () => {
  const { folios, catalog } = normalizeFtaLibrary([tree('a', ['c']), tree('b', ['c']), tree('c')], {
    byTreeId: { c: { code: 'COOL-3', description: 'Cooling supply unavailable', tags: ['pump'] } },
  })
  assert.deepEqual(searchFtaLibrary(folios, catalog, 'cool-3 pump').map(f => f.id), ['c'])
  assert.deepEqual(searchFtaLibrary(folios, catalog, 'SUPPLY').map(f => f.id), ['c'])
  const labelled = edit(folios, 'a', state => ({ ...state,
    nodes: state.nodes.map(node => node.type === 'basic' ? { ...node,
      data: { ...node.data, label: 'Hydraulic reservoir low level' } } : node) }))
  assert.deepEqual(searchFtaLibrary(labelled, catalog, 'reservoir low').map(f => f.id), ['a'])
})

test('presentation-only changes preserve exact mathematical fingerprints and current results', () => {
  const before = stamp([tree('a', ['b']), tree('b')], 'a')
  const after = edit(before, 'b', state => ({ ...state, density: 'large', annotations: [event('note')],
    nodes: state.nodes.map(node => ({ ...node, position: { x: 200, y: 200 }, selected: true,
      data: { ...node.data, label: 'Renamed', description: 'A note', diagramColor: 'blue', computedP: 0.5 } })) }))
  assert.equal(semanticFtaFingerprint(before[1].state), semanticFtaFingerprint(after[1].state))
  assert.equal(findAffectedFtaTrees(before, after).size, 0)
  assert.equal(ftaResultFreshness(after, 'a').status, 'current')
  assert.equal(invalidateFtaResults(before, after)[0], before[0])
})

test('probability and reference identity changes invalidate every transitive parent, never siblings', () => {
  let before = [tree('a', ['c']), tree('b', ['c']), tree('c'), tree('unrelated')]
  for (const id of ['a', 'b', 'c', 'unrelated']) before = stamp(before, id)
  const after = edit(before, 'c', state => ({ ...state,
    nodes: state.nodes.map(node => node.type !== 'basic' ? node : { ...node, data: { ...node.data, probability: 0.2 } }) }))
  assert.deepEqual(findAffectedFtaTrees(before, after), new Set(['c', 'a', 'b']))
  const cleared = invalidateFtaResults(before, after)
  for (const id of ['a', 'b', 'c']) {
    const folio = cleared.find(item => item.id === id)
    assert.equal(folio.state.result, before.find(item => item.id === id).state.result,
      'historical results remain inspectable after invalidation')
    assert.equal(folio.state.resultProvenance, before.find(item => item.id === id).state.resultProvenance)
    assert.equal(folio.dirty, true)
    assert.equal(ftaResultFreshness(cleared, id).status, 'stale')
  }
  assert.equal(cleared[3], before[3])
  const independent = edit(before, 'a', state => ({ ...state,
    nodes: state.nodes.map(node => node.type === 'transfer' ? { ...node,
      data: { ...node.data, referenceMode: 'independent' } } : node) }))
  assert.equal(ftaResultFreshness(independent, 'a').status, 'stale')
})

test('parent freshness records parent settings, not child standalone mission settings', () => {
  let before = stamp([tree('a', ['b']), tree('b')], 'a')
  before = stamp(before, 'b')
  const after = edit(before, 'b', state => ({ ...state, exposureTime: '2000' }))
  assert.deepEqual(findAffectedFtaTrees(before, after), new Set(['b']))
  assert.equal(ftaResultFreshness(after, 'a').status, 'current')
  assert.equal(ftaResultFreshness(after, 'b').status, 'stale')
  assert.equal(before[0].state.resultProvenance.treeId, 'a')
  assert.equal(before[0].state.resultProvenance.settings.exposureTime, '1000')
  assert.equal(ftaResultFreshness(before, 'a', 2).status, 'stale', 'engine revision changes require recalculation')
  assert.equal(before[0].state.resultProvenance.fingerprint.length, 64)
})

test('legacy results are unverified, and deleting a reference target invalidates old ancestors', () => {
  const before = [tree('a', ['b']), tree('b')]
  before[0].state.result = { top_event_probability: 0.1 }
  assert.equal(ftaResultFreshness(before, 'a').status, 'unverified')
  const removed = before.filter(folio => folio.id !== 'b')
  assert.deepEqual(findAffectedFtaTrees(before, removed), new Set(['b', 'a']))
  assert.equal(ftaResultFreshness(removed, 'a').status, 'invalid')
})

test('historical result provenance survives repeated invalidation while live computed node annotations are cleared', () => {
  const before = stamp([tree('a')], 'a')
  const after = edit(before, 'a', state => ({ ...state, nodes: state.nodes.map(node => ({
    ...node, data: { ...node.data, probability: 0.3, computedP: 0.3 },
  })) }))
  const invalidated = invalidateFtaResults(before, after)
  assert.equal(invalidated[0].state.result, before[0].state.result)
  assert.equal(invalidated[0].state.resultProvenance, before[0].state.resultProvenance)
  assert.ok(invalidated[0].state.nodes.every(node => node.data.computedP === undefined))
  const editedAgain = edit(invalidated, 'a', state => ({ ...state, exposureTime: '5' }))
  assert.equal(invalidateFtaResults(invalidated, editedAgain)[0].dirty, true)
})

test('add placement is explicit, immutable, cycle safe and records selected independent mode', () => {
  const before = [tree('a'), tree('b')], frozen = JSON.stringify(before)
  const after = addFtaReference(before, placement({ mode: 'independent' }))
  assert.equal(JSON.stringify(before), frozen)
  assert.equal(after[0].state.nodes.at(-1).data.referenceMode, 'independent')
  assert.deepEqual(buildFtaReferenceIndex(after).roots, ['a'])
  assert.equal(validateFtaPlacement(after, placement({ parentId: 'b', targetId: 'a' })).valid, false)
  assert.throws(() => addFtaReference(before, placement({ gateId: 'missing' })), /existing compatible parent gate/)
  assert.throws(() => addFtaReference(before, placement({ order: 9 })), /position/)
  assert.throws(() => addFtaReference(before, placement({ transferId: 'event' })), /identity/)
})

test('ordered-gate insertion preserves existing roles and relative order with unique explicit positions', () => {
  const a = tree('a', ['c'], 'por')
  a.state.edges[0].data = { order: 5, role: 'priority' }
  a.state.edges[1].data = { order: 9, role: 'blocker' }
  const before = [a, tree('b'), tree('c')]
  assert.equal(validateFtaPlacement(before, placement()).valid, false)
  assert.equal(validateFtaPlacement(before, placement({ role: 'priority' })).valid, false)
  const after = addFtaReference(before, placement({ role: 'blocker', order: 1 }))
  assert.deepEqual(after[0].state.edges.map(e => [e.target, e.data.order, e.data.role]), [
    ['event', 0, 'priority'], ['new-transfer', 1, 'blocker'], ['x0', 2, 'blocker'],
  ])
  const unlinked = unlinkFtaReferences(after, 'a', ['new-transfer'])
  assert.deepEqual(unlinked[0].state.edges.map(e => [e.target, e.data.order, e.data.role]), [
    ['event', 0, 'priority'], ['x0', 1, 'blocker'],
  ])
})

test('unsupported dynamic Transfer slots, event parents and full fixed-arity gates are rejected', () => {
  for (const type of ['spare', 'seq', 'basic', 'not']) {
    assert.equal(validateFtaPlacement([tree('a', [], type), tree('b')], placement()).valid, false, type)
  }
  const fdep = tree('a', [], 'fdep')
  fdep.state.edges[0].data.role = 'dependent'
  assert.equal(validateFtaPlacement([fdep, tree('b')], placement({ role: 'dependent' })).valid, false)
  assert.equal(validateFtaPlacement([fdep, tree('b')], placement({ role: 'trigger' })).valid, true)
  assert.equal(validateFtaPlacement([tree('a', ['c'], 'xor'), tree('b'), tree('c')], placement()).valid, false)
})

test('unlink selects concrete duplicates, never deletes children or silently replaces semantic roles', () => {
  const a = tree('a', ['b', 'b'], 'por')
  a.state.edges[0].data.role = 'blocker'
  a.state.edges[1].data.role = 'priority'
  a.state.edges[2].data.role = 'blocker'
  const after = unlinkFtaReferences([a, tree('b')], 'a', ['x0'])
  const index = buildFtaReferenceIndex(after)
  assert.equal(index.references.length, 1)
  assert.equal(index.references[0].transferId, 'x1')
  assert.equal(index.trees.has('b'), true)
  assert.deepEqual(after[0].state.edges.map(e => e.data.role), ['blocker', 'blocker'])
})

test('move is atomic on failure, preserves reference mode and affects only the selected Transfer', () => {
  const before = [tree('a', [{ id: 'c', mode: 'independent' }, 'c']), tree('b'), tree('c')]
  const snapshot = JSON.stringify(before)
  const request = { ...placement({ parentId: 'b' }), sourceParentId: 'a', sourceTransferId: 'x0' }
  const after = moveFtaReference(before, request)
  assert.equal(buildFtaReferenceIndex(after).children.get('a')[0].references.length, 1)
  assert.equal(buildFtaReferenceIndex(after).children.get('b')[0].references[0].mode, 'independent')
  assert.equal(JSON.stringify(before), snapshot)
  assert.throws(() => moveFtaReference(before, { ...request, parentId: 'c' }), /cycle/)
  assert.equal(JSON.stringify(before), snapshot)
})

test('delete blocks incoming references and never recursively deletes referenced children', () => {
  const before = [tree('a', ['b']), tree('b')]
  assert.throws(() => deleteFtaTree(before, 'b'), /Unlink incoming/)
  const after = deleteFtaTree(before, 'a')
  assert.deepEqual(after.map(folio => folio.id), ['b'])
  assert.deepEqual(buildFtaReferenceIndex(after).roots, ['b'])
})

test('portable exports contain complete shared closure once; imports remap targets and retain original historical context', () => {
  let before = [tree('a', ['c', { id: 'c', mode: 'independent' }]), tree('b', ['c']), tree('c'), tree('other')]
  before = stamp(before, 'a')
  const normalized = normalizeFtaLibrary(before, { byTreeId: { c: { code: 'C', description: 'Child', tags: [],
    systemLinks: [{ systemModelId: 'system-1', instanceId: 'pump-1' }] } } })
  const payload = exportFtaClosure(before, normalized.catalog, ['a', 'b'])
  assert.deepEqual(new Set(payload.folios.map(folio => folio.id)), new Set(['a', 'b', 'c']))
  assert.equal(payload.folios.filter(folio => folio.id === 'c').length, 1)
  const imported = remapFtaImport(payload, before, id => `import-${id}`, { existingCatalog: normalized.catalog })
  assert.deepEqual(imported.rootTreeIds, ['import-a', 'import-b'])
  assert.ok(buildFtaReferenceIndex(imported.folios).references.every(ref => ref.targetId === 'import-c'))
  assert.deepEqual(buildFtaReferenceIndex(imported.folios).children.get('import-a')[0].references.map(ref => ref.mode),
    ['shared', 'independent'])
  const importedRoot = imported.folios.find(folio => folio.id === 'import-a')
  assert.deepEqual(importedRoot.state.result, before[0].state.result)
  assert.deepEqual(importedRoot.state.resultProvenance, before[0].state.resultProvenance)
  assert.equal(importedRoot.state.resultProvenance.treeId, 'a', 'never rewrite the historical calculation context')
  assert.equal(importedRoot.dirty, true)
  assert.equal(imported.catalog.byTreeId['import-c'].code, 'C-2')
  assert.equal(imported.catalog.byTreeId['import-c'].systemLinks, undefined)
  assert.equal(imported.unresolvedSystemLinks.length, 1)
  assert.equal(payload.catalog.byTreeId.c.systemLinks.length, 1, 'import must not mutate package')
  assert.throws(() => remapFtaImport(payload, before, id => id), /unique/)
})

test('broken, cyclic or unrelated package contents fail closed instead of dropping dependencies', () => {
  const broken = [tree('a', ['gone'])], catalog = normalizeFtaLibrary(broken).catalog
  assert.throws(() => exportFtaClosure(broken, catalog, ['a']), /missing targets/)
  const valid = [tree('a'), tree('b')], packageData = exportFtaClosure(valid, normalizeFtaLibrary(valid).catalog, ['a'])
  assert.throws(() => remapFtaImport({ ...packageData, folios: valid }, [], id => `new-${id}`), /exactly/)
  assert.throws(() => remapFtaImport({ ...packageData, folios: [{ id: 'a', state: {} }] }, [], id => id), /malformed/)
})

test('automatic and imported reference codes avoid case-insensitive collisions', () => {
  const current = normalizeFtaLibrary([tree('a'),tree('b')], {byTreeId:{
    a:{code:'fta-001',description:'Existing lower-case code',tags:[]},
  }})
  assert.equal(current.catalog.byTreeId.a.code,'fta-001')
  assert.equal(current.catalog.byTreeId.b.code,'FTA-002')
  const source = normalizeFtaLibrary([tree('incoming')], {byTreeId:{
    incoming:{code:'FTA-001',description:'Imported upper-case code',tags:[]},
  }})
  const imported = remapFtaImport(exportFtaClosure(source.folios,source.catalog,['incoming']),
    current.folios,id=>`new-${id}`,{existingCatalog:current.catalog})
  assert.equal(imported.catalog.byTreeId['new-incoming'].code,'FTA-001-2')
})

test('immutable-state caches avoid reading untouched 50,000-node canvases again after warmup', () => {
  let reads = 0
  const folios = Array.from({ length: 500 }, (_, id) => {
    const nodes = Array.from({ length: 100 }, (_, nodeId) => event(String(nodeId)))
    return { id: `t${id}`, name: `Tree ${id}`, state: {
      get nodes() { reads++; return nodes }, edges: [],
    } }
  })
  buildFtaReferenceIndex(folios)
  for (const folio of folios) semanticFtaFingerprint(folio.state)
  const beforeReads = reads
  const after = folios.map((folio, i) => i === 0 ? { ...folio, state: {
    nodes: [event('0', 0.3)], edges: [],
  } } : folio)
  assert.deepEqual(findAffectedFtaTrees(folios, after), new Set(['t0']))
  assert.ok(reads - beforeReads <= 1, 'unchanged immutable canvases should use cached graph/reference facts')
  assert.equal(findAffectedFtaTrees(folios, folios).size, 0)
})

test('synchronous SHA-256 matches standard known answers and independent crypto implementation', () => {
  assert.equal(sha256FtaText(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  assert.equal(sha256FtaText('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.equal(sha256FtaText('a'.repeat(1_000_000)), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0')
  for (const input of ['été 🌲 μ失效 \ud800', '可靠性'.repeat(150),
    ...Array.from({ length: 260 }, (_, count) => 'abcXYZ0123456789'.repeat(20).slice(0, count))]) {
    assert.equal(sha256FtaText(input), createHash('sha256').update(input, 'utf8').digest('hex'))
  }
})

test('500-tree closure provenance stays bounded and has a fixed-size request fingerprint', () => {
  const folios = Array.from({ length: 500 }, (_, id) => tree(`t${id}`, id < 499 ? [`t${id + 1}`] : []))
  const provenance = createFtaResultProvenance(folios, 't0', 4)
  assert.equal(provenance.fingerprint.length, 64)
  assert.equal(provenance.engineRevision, 4)
  assert.equal(provenance.treeIds.length, 500)
  assert.ok(JSON.stringify(provenance).length < 5000, 'store only IDs and digests, not repeated serialized canvas graphs')
})


test('gapped and missing edge orders infer roles by backend sorted sibling rank', () => {
  const nodes = [{ id: 'por', type: 'por', data: {} }, event('a'), event('b')]
  const edges = [{ source: 'por', target: 'a', order: 5 }, { source: 'por', target: 'b', order: 10 }]
  const normalized = normalizeFtaSemanticEdges(edges, nodes)
  assert.deepEqual(normalized.map(edge => [edge.target, edge.order, edge.role]), [['a', 5, 'priority'], ['b', 10, 'blocker']])
  assert.deepEqual(normalizeFtaSemanticEdges(normalized, nodes), normalized, 'semantic normalization is idempotent')
  const original = { nodes, edges }
  const bad = { nodes, edges: [{ ...edges[0], role: 'blocker' }, edges[1]] }
  assert.notEqual(semanticFtaFingerprint(original), semanticFtaFingerprint(bad),
    'explicitly replacing an inferred priority role must invalidate the old numerical context')
  const folios = stamp([{ id: 'por-tree', name: 'POR', state: original }], 'por-tree')
  const changed = edit(folios, 'por-tree', () => ({ ...bad, result: folios[0].state.result,
    resultProvenance: folios[0].state.resultProvenance }))
  assert.equal(ftaResultFreshness(changed, 'por-tree').status, 'stale')
  assert.deepEqual(normalizeFtaSemanticEdges([...edges].reverse(), nodes).map(edge => [edge.target, edge.role]),
    [['b', 'blocker'], ['a', 'priority']], 'explicit order overrides array order')
  const mixed = normalizeFtaSemanticEdges([{ source: 'por', target: 'b' }, { source: 'por', target: 'a', data: { order: 7 } }], nodes)
  assert.deepEqual(mixed.map(edge => [edge.target, edge.order, edge.role]), [['b', 1, 'blocker'], ['a', 7, 'priority']],
    'missing order ranks after ordinary explicit order, as the backend does')
  const tied = normalizeFtaSemanticEdges([{ source: 'por', target: 'b', order: 7 }, { source: 'por', target: 'a', order: 7 }], nodes)
  assert.deepEqual(tied.map(edge => edge.role), ['priority', 'blocker'], 'array insertion breaks explicit-order ties')
  const explicit = normalizeFtaSemanticEdges([{ source: 'por', target: 'a', order: 5, role: 'priority' }], nodes)[0]
  assert.equal(explicit.data.order, 5)
  assert.equal(explicit.data.role, 'priority', 'legacy top-level aliases are retained in canonical edge data')
})
