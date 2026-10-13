import { useSharedSystemDefinition } from '../../store/sharedSystem'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ComponentType, type KeyboardEvent } from 'react'
import { ChevronDown, ChevronRight, GitFork, Library, Plus, Search, X, FileText, Download, Upload, Link2, ArrowUpRight, PanelLeftClose, PanelLeftOpen, AlertTriangle } from 'lucide-react'
import { flushProjectEditors, getProjectState, useFolioState, useModuleState, useProjectIdentity, writeFtaLibrary } from '../../store/project'
import { useBookmarkNavigationTarget } from '../../store/bookmarks'
import { CURRENT_ENGINE_REVISIONS } from '../../version'
import { downloadArtifact } from '../../store/artifactExport'
import { confirmDialog, promptDialog, useFocusTrap } from '../shared/useDialog'
import { useShortcuts } from '../shared/KeyboardShortcuts'
import { toast } from '../shared/toast'
import type { SystemDefinitionState } from '../SystemDefinition/model'
import type { CanvasState } from './index'
import {
  addFtaReference, buildFtaReferenceIndex, defaultFtaInputRole, deleteFtaTree, exportFtaClosure,
  ftaOccurrenceKey, ftaResultFreshness, moveFtaReference, normalizeFtaLibrary, remapFtaImport,
  searchFtaLibrary, unlinkFtaReferences, validateFtaPlacement, visibleFtaHierarchy,
  type FtaFolio, type FtaHierarchyRow, type FtaLibraryCatalog, type FtaLibraryPackage,
  type FtaPlacementRequest, type FtaReference, type FtaReferenceIndex, type FtaTreeMetadata,
} from './libraryModel'
import ReadOnlyFaultTreeDiagram from './ReadOnlyFaultTreeDiagram'

const EMPTY_CATALOG: FtaLibraryCatalog = { schemaVersion: 1, byTreeId: {} }
const button = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50'
const primaryButton = button.replace('border-slate-300 bg-white', 'border-blue-700 bg-blue-700').replace('text-slate-700', 'text-white').replace('hover:border-slate-400 hover:bg-slate-50', 'hover:border-blue-800 hover:bg-blue-800')
const field = 'min-h-9 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600'
const statusLabels = { current: 'Current', stale: 'Recalculate', unverified: 'Historical', 'not-calculated': 'Not calculated', invalid: 'Invalid references' }
const freshId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

function Status({ index, treeId }: { index: FtaReferenceIndex; treeId: string }) {
  const status = ftaResultFreshness(index, treeId, CURRENT_ENGINE_REVISIONS.faultTree)
  return <span title={status.reason} className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${
    status.status === 'current' ? 'bg-emerald-50 text-emerald-800' : status.status === 'invalid'
      ? 'bg-red-50 text-red-800' : status.status === 'stale' || status.status === 'unverified'
        ? 'bg-amber-50 text-amber-900' : 'bg-slate-100 text-slate-600'}`}>{statusLabels[status.status]}</span>
}

/** A flattened, windowed ARIA tree. Navigation follows visible occurrences, identity follows trees. */
function Hierarchy({ index, catalog, selectedId, onSelect, onOpen, query = '', selectedPath }: {
  index: FtaReferenceIndex; catalog: FtaLibraryCatalog; selectedId: string
  onSelect: (id: string, path: string[]) => void; onOpen: (id: string) => void; query?: string; selectedPath?: string[]
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [limit, setLimit] = useState(500)
  const [scrollTop, setScrollTop] = useState(0)
  const [focusedKey, setFocusedKey] = useState('')
  const host = useRef<HTMLDivElement>(null)
  const prefix = useId()
  const typed = useRef({ text: '', at: 0 })
  const matches = useMemo(() => query.trim() ? searchFtaLibrary([...index.trees.values()], catalog, query) : null, [index, catalog, query])
  const hierarchy = useMemo(() => visibleFtaHierarchy(index, expanded, { limit }), [index, expanded, limit])
  const rows = useMemo<FtaHierarchyRow[]>(() => matches ? matches.map(tree => ({ key: ftaOccurrenceKey([tree.id]), treeId: tree.id,
    path: [tree.id], depth: 0, hasChildren: false, expanded: false, cycle: false, repeated: (index.parents.get(tree.id)?.length ?? 0) > 1,
    referenceCount: 0, issueBranch: false })) : hierarchy.rows, [matches, hierarchy, index])
  const focusedIndex = Math.max(0, rows.findIndex(row => row.key === focusedKey))
  const focused = rows[focusedIndex]
  const selectedKey = rows.find(row => row.treeId === selectedId && (!selectedPath || row.key === ftaOccurrenceKey(selectedPath)))?.key ?? rows.find(row => row.treeId === selectedId)?.key
  const rowHeight = 56
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 4)
  const end = Math.min(rows.length, start + 32)
  const rendered = Array.from(new Set([...Array.from({ length: Math.max(0, end - start) }, (_, i) => i + start), ...(focused ? [focusedIndex] : [])])).sort((a, b) => a - b)
  const rowId = (row: FtaHierarchyRow) => `${prefix}-${encodeURIComponent(row.key)}`
  const focusRow = (position: number) => {
    const next = rows[Math.max(0, Math.min(rows.length - 1, position))]
    if (!next) return
    setFocusedKey(next.key)
    const top = rows.indexOf(next) * rowHeight
    if (host.current && (top < host.current.scrollTop || top + rowHeight > host.current.scrollTop + host.current.clientHeight)) {
      host.current.scrollTop = Math.max(0, top - host.current.clientHeight / 2)
    }
  }
  const toggle = (row: FtaHierarchyRow) => setExpanded(previous => {
    const next = new Set(previous)
    if (next.has(row.key)) next.delete(row.key); else next.add(row.key)
    return next
  })
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!focused) return
    let handled = true
    if (event.key === 'ArrowDown') focusRow(focusedIndex + 1)
    else if (event.key === 'ArrowUp') focusRow(focusedIndex - 1)
    else if (event.key === 'Home') focusRow(0)
    else if (event.key === 'End') focusRow(rows.length - 1)
    else if (event.key === 'ArrowRight') {
      if (focused.hasChildren && !focused.expanded) toggle(focused)
      else if (focused.expanded) focusRow(focusedIndex + 1)
    } else if (event.key === 'ArrowLeft') {
      if (focused.expanded) toggle(focused)
      else if (focused.path.length > 1) focusRow(rows.findIndex(row => row.key === ftaOccurrenceKey(focused.path.slice(0, -1))))
    } else if (event.key === 'Enter') onOpen(focused.treeId)
    else if (event.key === ' ') onSelect(focused.treeId, focused.path)
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now()
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + event.key.toLowerCase(), at: now }
      const offset = rows.slice(focusedIndex + 1).concat(rows.slice(0, focusedIndex + 1)).find(row =>
        (index.trees.get(row.treeId)?.name ?? '').toLowerCase().startsWith(typed.current.text))
      if (offset) focusRow(rows.indexOf(offset))
    } else handled = false
    if (handled) event.preventDefault()
  }
  useEffect(() => { if (host.current) host.current.scrollTop = 0; setScrollTop(0) }, [query])
  return <div className="flex min-h-0 flex-1 flex-col">
    {matches && <p className="px-3 py-2 text-xs text-slate-600" role="status">{matches.length} matching trees · each tree listed once</p>}
    <div ref={host} role="tree" aria-label="Fault tree hierarchy" tabIndex={0}
      aria-activedescendant={focused ? rowId(focused) : undefined}
      onKeyDown={keyDown} onScroll={event => setScrollTop(event.currentTarget.scrollTop)}
      className="min-h-36 flex-1 overflow-auto focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-blue-600">
      <div role="none" style={{ height: rows.length * rowHeight, minHeight: 48, position: 'relative' }}>
        {rendered.map(i => {
          const row = rows[i], tree = index.trees.get(row.treeId)
          const siblings = row.parentId ? index.children.get(row.parentId) ?? [] : null
          const levelSiblings = siblings ? siblings.map(item => item.targetId) : [...index.roots, ...index.issueRoots]
          return <div key={row.key} id={rowId(row)} role="treeitem" aria-level={row.depth + 1}
            aria-posinset={matches ? i + 1 : Math.max(1, levelSiblings.indexOf(row.treeId) + 1)} aria-setsize={matches ? rows.length : levelSiblings.length}
            aria-selected={selectedKey === row.key} aria-expanded={row.hasChildren ? row.expanded : undefined}
            title={row.path.map(id => index.trees.get(id)?.name ?? id).join(' › ')}
            onClick={() => { setFocusedKey(row.key); onSelect(row.treeId, row.path); host.current?.focus() }}
            onDoubleClick={() => tree && onOpen(tree.id)}
            className={`absolute flex w-full cursor-pointer items-center gap-1 border-b border-slate-100 pr-3 text-sm ${selectedKey === row.key ? 'bg-blue-50 text-blue-900' : 'text-slate-800 hover:bg-slate-50'} ${row.key === focused?.key ? 'outline-1 -outline-offset-2 outline-blue-400' : ''}`}
            style={{ height: rowHeight, top: i * rowHeight, paddingLeft: 8 + Math.min(row.depth, 12) * 16 }}>
            <button type="button" tabIndex={-1} aria-label={`${row.expanded ? 'Collapse' : 'Expand'} ${tree?.name ?? row.treeId}`}
              disabled={!row.hasChildren} onClick={event => { event.stopPropagation(); setFocusedKey(row.key); toggle(row); host.current?.focus() }}
              className="flex h-8 w-7 shrink-0 items-center justify-center rounded hover:bg-blue-100 disabled:invisible">
              {row.expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
            <div className="min-w-0 flex-1"><div className="truncate font-medium">{tree?.name ?? 'Missing tree'}</div>
              <div className="mt-0.5 flex gap-2 truncate text-xs text-slate-600"><span>{!matches && row.path.map((id, level) => level === 0 ? [...index.roots, ...index.issueRoots].indexOf(id) + 1 : (index.children.get(row.path[level - 1]) ?? []).findIndex(child => child.targetId === id) + 1).join('.')} · {catalog.byTreeId[row.treeId]?.code ?? row.treeId}</span>
                {row.repeated && <span>Repeated · {index.parents.get(row.treeId)?.length} parents</span>}
                {row.referenceCount > 1 && <span>{row.referenceCount} Transfers</span>}
                {(row.issueBranch || row.cycle || !tree) && <span className="font-medium text-red-700">Issue</span>}
              </div>
            </div>
          </div>
        })}
        {!rows.length && <p className="p-4 text-sm text-slate-600">No matching fault trees.</p>}
      </div>
    </div>
    {!matches && hierarchy.truncated && <button type="button" className={`${button} m-2`} disabled={limit >= 10000} onClick={() => setLimit(value => Math.min(value + 500, 10000))}>
      {limit >= 10000 ? 'Collapse branches or search to explore more' : 'Show more hierarchy rows'}
    </button>}
    <p className="border-t border-slate-200 px-3 py-2 text-xs leading-5 text-slate-600">Arrow keys navigate · Space selects · Enter opens</p>
  </div>
}

interface PlacementIntent { parentId: string; targetId?: string; create?: boolean; moving?: FtaReference }
function PlacementDialog({ intent, folios, catalog, initial, onClose, onCommit }: {
  intent: PlacementIntent; folios: FtaFolio[]; catalog: FtaLibraryCatalog; initial: CanvasState
  onClose: () => void; onCommit: (folios: FtaFolio[], catalog: FtaLibraryCatalog, targetId: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, true, onClose)
  const [parentId, setParentId] = useState(intent.parentId)
  const [targetId, setTargetId] = useState(intent.targetId ?? intent.moving?.targetId ?? '')
  const [name, setName] = useState('')
  const [gateId, setGateId] = useState('')
  const [order, setOrder] = useState(0)
  const [role, setRole] = useState('input')
  const [mode, setMode] = useState<'shared' | 'independent'>(intent.moving?.mode ?? 'shared')
  const [position, setPosition] = useState({ x: 220, y: 260 })
  const [message, setMessage] = useState('')
  const [ids] = useState(() => ({ tree: freshId('fta'), transfer: freshId('transfer'), edge: freshId('fta-edge') }))
  const parent = folios.find(tree => tree.id === parentId)
  const parentNodes = Array.isArray(parent?.state.nodes) ? parent.state.nodes : []
  const parentEdges = Array.isArray(parent?.state.edges) ? parent.state.edges : []
  const gates = parentNodes.filter(node => node && ['and', 'or', 'vote', 'cardinality', 'xor', 'not', 'nand', 'nor', 'iff', 'imply', 'inhibit', 'pand', 'por', 'fdep'].includes(node.type ?? ''))
  const gate = gates.find(node => node.id === gateId)
  const inputs = parentEdges.filter(edge => edge?.source === gateId)
  const roles = gate?.type === 'inhibit' ? ['primary', 'condition'] : gate?.type === 'imply' ? ['antecedent', 'consequent']
    : gate?.type === 'por' ? ['priority', 'blocker'] : gate?.type === 'fdep' ? ['trigger'] : ['input']
  const chooseGate = (id: string) => {
    setGateId(id)
    const node = gates.find(item => item.id === id)
    const count = parentEdges.filter(edge => edge?.source === id).length
    setOrder(count); setRole(defaultFtaInputRole(node?.type ?? '', count))
    setPosition({ x: (node?.position?.x ?? 220) + count * 180, y: (node?.position?.y ?? 120) + 180 })
  }
  const commit = () => {
    try {
      const childId = intent.create ? ids.tree : targetId
      if (intent.create && !name.trim()) throw new Error('Enter a name for the new child tree.')
      const draft = intent.create ? [...folios, { id: childId, name: name.trim(), state: { ...initial, nodes: [], edges: [] } }] : folios
      const request: FtaPlacementRequest = { parentId, targetId: childId, gateId, order, role, mode,
        transferId: ids.transfer, edgeId: ids.edge, position }
      const next = intent.moving ? moveFtaReference(draft, { ...request,
        sourceParentId: intent.moving.parentId, sourceTransferId: intent.moving.transferId }) : addFtaReference(draft, request)
      onCommit(next, normalizeFtaLibrary(next, catalog).catalog, childId)
    } catch (error) { setMessage(errorMessage(error)) }
  }
  const previewDraft = intent.create ? [...folios, { id: ids.tree, name: name || 'New child', state: initial }] : folios
  const validation = !intent.moving && gateId && (intent.create || targetId) ? validateFtaPlacement(previewDraft, {
    parentId, targetId: intent.create ? ids.tree : targetId, gateId, order, role, mode,
    transferId: ids.transfer, edgeId: ids.edge, position,
  }) : null
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="fta-placement-title" className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
      <div className="flex items-start justify-between gap-4"><div><h2 id="fta-placement-title" className="text-lg font-semibold text-slate-900">{intent.moving ? 'Move Transfer reference' : intent.create ? 'Create child fault tree' : 'Reference an existing tree'}</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">Choose the parent gate and connection explicitly. This changes the parent’s analytical model.</p></div>
        <button type="button" className={button} onClick={onClose} aria-label="Close placement dialog"><X size={16} /></button></div>
      <div className="mt-5 space-y-4">
        {intent.moving && <label className="block text-sm font-medium text-slate-700">Destination parent<select className={`${field} mt-1`} value={parentId} onChange={event => { setParentId(event.target.value); setGateId('') }}>{folios.map(tree => <option key={tree.id} value={tree.id}>{catalog.byTreeId[tree.id]?.code} · {tree.name}</option>)}</select></label>}
        {intent.create ? <label className="block text-sm font-medium text-slate-700">Child tree name<input autoFocus className={`${field} mt-1`} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Loss of cooling" /></label>
          : <label className="block text-sm font-medium text-slate-700">Referenced tree<select className={`${field} mt-1`} value={targetId} disabled={!!intent.moving} onChange={event => setTargetId(event.target.value)}><option value="">Select a fault tree…</option>{folios.filter(tree => tree.id !== parentId).map(tree => <option key={tree.id} value={tree.id}>{catalog.byTreeId[tree.id]?.code} · {tree.name}</option>)}</select></label>}
        <label className="block text-sm font-medium text-slate-700">Parent gate in {parent?.name}<select className={`${field} mt-1`} value={gateId} onChange={event => chooseGate(event.target.value)}><option value="">Select a compatible gate…</option>{gates.map(node => <option key={node.id} value={node.id}>{String(node.data?.label ?? node.id)} · {node.type?.toUpperCase()}</option>)}</select></label>
        {!gates.length && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Open the parent editor and add a compatible gate before placing this reference.</p>}
        <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-medium text-slate-700">Input position<select className={`${field} mt-1`} value={order} onChange={event => setOrder(Number(event.target.value))}>{Array.from({ length: inputs.length + 1 }, (_, i) => <option key={i} value={i}>{i + 1}{i === inputs.length ? ' · last' : ''}</option>)}</select></label>
          <label className="block text-sm font-medium text-slate-700">Input role<select className={`${field} mt-1`} value={role} onChange={event => setRole(event.target.value)}>{roles.map(value => <option key={value} value={value}>{value}</option>)}</select></label></div>
        <label className="block text-sm font-medium text-slate-700">Event identity<select className={`${field} mt-1`} value={mode} disabled={!!intent.moving} onChange={event => setMode(event.target.value as typeof mode)}><option value="shared">Shared events</option><option value="independent">Independent instance</option></select></label>
        <p className="text-xs leading-5 text-slate-600">Shared events retain dependence when this tree is referenced again. Independent instances model separate events. Moving preserves the existing mode and input roles.</p>
        <div className="grid grid-cols-2 gap-3">{(['x', 'y'] as const).map(axis => <label key={axis} className="text-sm font-medium text-slate-700">Canvas {axis.toUpperCase()}<input type="number" className={`${field} mt-1`} value={position[axis]} onChange={event => setPosition(previous => ({ ...previous, [axis]: Number(event.target.value) }))} /></label>)}</div>
        {(message || validation && !validation.valid) && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{message || validation?.issues.map(issue => issue.message).join(' ')}</p>}
        {intent.create && <p className="text-sm text-slate-600">The child starts as a blank draft. Complete it before calculating the parent.</p>}
        {intent.moving && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">This removes Transfer {intent.moving.transferId} from {folios.find(tree => tree.id === intent.moving?.parentId)?.name}. Required inputs may need repair; other references remain in place.</p>}
      </div>
      <div className="mt-6 flex justify-end gap-2"><button type="button" className={button} onClick={onClose}>Cancel</button><button type="button" className={primaryButton} disabled={!gateId || (!intent.create && !targetId) || !!validation && !validation.valid} onClick={commit}>{intent.moving ? 'Move reference' : intent.create ? 'Create and connect' : 'Add reference'}</button></div>
    </div>
  </div>
}

function TreeMetadata({ tree, metadata, systems, onSave }: {
  tree: FtaFolio; metadata: FtaTreeMetadata; systems: { id: string; name: string; state: SystemDefinitionState }[]
  onSave: (name: string, metadata: FtaTreeMetadata) => void
}) {
  const [name, setName] = useState(tree.name)
  const [code, setCode] = useState(metadata.code)
  const [description, setDescription] = useState(metadata.description)
  const [tags, setTags] = useState(metadata.tags.join(', '))
  const [links, setLinks] = useState(metadata.systemLinks ?? [])
  const [choice, setChoice] = useState('')
  return <form onSubmit={event => { event.preventDefault(); onSave(name.trim(), { code: code.trim(), description, tags: tags.split(',').map(tag => tag.trim()).filter(Boolean), systemLinks: links }) }} className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-[1fr_140px]"><label className="text-sm font-medium text-slate-700">Tree name<input required className={`${field} mt-1`} value={name} onChange={event => setName(event.target.value)} /></label><label className="text-sm font-medium text-slate-700">Reference code<input required maxLength={128} className={`${field} mt-1`} value={code} onChange={event => setCode(event.target.value)} /></label></div>
    <label className="block text-sm font-medium text-slate-700">Description<textarea className={`${field} mt-1 min-h-24`} value={description} onChange={event => setDescription(event.target.value)} /></label>
    <label className="block text-sm font-medium text-slate-700">Tags <span className="font-normal">(comma separated)</span><input className={`${field} mt-1`} value={tags} onChange={event => setTags(event.target.value)} /></label>
    <div><label className="block text-sm font-medium text-slate-700">System Definition association<select className={`${field} mt-1`} value={choice} onChange={event => setChoice(event.target.value)}><option value="">Choose an optional system item…</option>{systems.flatMap(system => (system.state.model?.instances ?? []).map(item => <option key={`${system.id}:${item.id}`} value={JSON.stringify([system.id, item.id])}>{system.name} › {item.name || item.id}</option>))}</select></label>
      <button type="button" className={`${button} mt-2`} disabled={!choice} onClick={() => { const [systemModelId, instanceId] = JSON.parse(choice) as string[]; setLinks(previous => previous.some(link => link.systemModelId === systemModelId && link.instanceId === instanceId) ? previous : [...previous, { systemModelId, instanceId }]); setChoice('') }}><Link2 size={14} /> Associate item</button>
      <ul className="mt-2 space-y-2">{links.map(link => { const system = systems.find(item => item.id === link.systemModelId); const item = system?.state.model?.instances.find(instance => instance.id === link.instanceId); return <li key={`${link.systemModelId}:${link.instanceId}`} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700"><span>{system?.name ?? 'Missing system'} › {item?.name || `Missing item (${link.instanceId})`}</span><button type="button" className={button} aria-label={`Remove association ${item?.name ?? link.instanceId}`} onClick={() => setLinks(previous => previous.filter(value => value !== link))}><X size={14} /></button></li> })}</ul>
    </div>
    <button type="submit" className={button}>Save details</button>
  </form>
}

export default function LibraryWorkspace({ initial, Editor, onNavigate }: {
  initial: CanvasState; Editor: ComponentType<{ onNavigate?: (target: 'rbd') => void; onLibrary: () => void }>
  onNavigate?: (target: 'rbd') => void
}) {
  const [, , api] = useFolioState('faultTree', initial)
  const [rawCatalog] = useModuleState('faultTreeCatalog', EMPTY_CATALOG)
  const [identity] = useProjectIdentity()
  const [sharedSystem] = useSharedSystemDefinition()
  const systems = [{ id: sharedSystem.model.id, name: sharedSystem.model.name, state: sharedSystem }]
  const normalized = useMemo(() => normalizeFtaLibrary(api.folios, rawCatalog), [api.folios, rawCatalog])
  const { folios, catalog } = normalized
  const index = useMemo(() => buildFtaReferenceIndex(folios), [folios])
  const [view, setView] = useState<'library' | 'editor'>('library')
  const [tabs, setTabs] = useState<string[]>([])
  const [selectedId, setSelectedId] = useState(api.activeId)
  const [path, setPath] = useState<string[]>([api.activeId])
  const [query, setQuery] = useState('')
  const [register, setRegister] = useState(false)
  const [filter, setFilter] = useState('all')
  const [selectedTrees, setSelectedTrees] = useState<Set<string>>(() => new Set())
  const [sidebar, setSidebar] = useState(false)
  const [intent, setIntent] = useState<PlacementIntent | null>(null)
  const [busy, setBusy] = useState('')
  const [reportScope, setReportScope] = useState<'tree' | 'branch' | 'selected' | 'all'>('branch')
  const fileInput = useRef<HTMLInputElement>(null)
  const bookmark = useBookmarkNavigationTarget()
  const appliedBookmark = useRef(0)
  const projectRef = useRef(identity.projectId)
  const selected = index.trees.get(selectedId) ?? folios[0]
  const malformedTrees = useMemo(() => new Set(index.issues
    .filter(issue => ['MALFORMED_MODEL', 'DUPLICATE_NODE_ID', 'DUPLICATE_TREE_ID'].includes(issue.code))
    .map(issue => issue.treeId)), [index])
  const open = useCallback((id: string) => {
    if (!api.folios.some(tree => tree.id === id)) return
    if (malformedTrees.has(id)) {
      setSelectedId(id); setView('library')
      toast.error('This tree has malformed model data. Review its library issues and export the models for repair.')
      return
    }
    flushProjectEditors()
    api.select(id)
    setTabs(previous => previous.includes(id) ? previous : [...previous, id])
    setSelectedId(id); setView('editor')
  }, [api, malformedTrees])
  const showLibrary = useCallback(() => { flushProjectEditors(); setView('library') }, [])
  useEffect(() => {
    if (projectRef.current !== identity.projectId) {
      projectRef.current = identity.projectId; setTabs([]); setView('library'); setSelectedId(api.activeId); setPath([api.activeId]); setSelectedTrees(new Set()); setIntent(null)
    }
  }, [identity.projectId, api.activeId])
  useEffect(() => {
    if (!bookmark || bookmark.nonce === appliedBookmark.current || bookmark.source.module !== 'faultTree' || !bookmark.source.analysisId) return
    if (!index.trees.has(bookmark.source.analysisId)) return
    appliedBookmark.current = bookmark.nonce; open(bookmark.source.analysisId)
  }, [bookmark, index, open])
  useEffect(() => {
    if (!index.trees.has(selectedId) && folios[0]) { setSelectedId(folios[0].id); setPath([folios[0].id]) }
  }, [index, selectedId, folios])
  const commit = (next: FtaFolio[], nextCatalog: FtaLibraryCatalog, activeId: string, label: string) => {
    writeFtaLibrary(next, nextCatalog, activeId, label)
    setSelectedId(activeId)
  }
  const readCurrentLibrary = (expected: { identity: { projectId: string }; revision: number }) => {
    const project = getProjectState()
    if (project.identity.projectId !== expected.identity.projectId || project.revision !== expected.revision) {
      throw new Error('The project changed while this action was open. Review the current library and try again.')
    }
    return normalizeFtaLibrary(project.modules.faultTree ?? api.folios, project.modules.faultTreeCatalog)
  }
  const createRoot = async () => {
    showLibrary()
    const expected = getProjectState()
    const name = await promptDialog({ title: 'New root fault tree', label: 'Tree name', placeholder: 'e.g. Loss of system function', confirmLabel: 'Create tree' })
    if (!name?.trim()) return
    const current = readCurrentLibrary(expected)
    const id = freshId('fta'), next = [...current.folios, { id, name: name.trim(), state: { ...initial, nodes: [], edges: [] } }]
    commit(next, normalizeFtaLibrary(next, current.catalog).catalog, id, 'Create root')
    setTabs(previous => [...previous, id]); setView('editor'); setPath([id])
  }
  const closeTab = (id: string) => {
    flushProjectEditors()
    const remaining = tabs.filter(tab => tab !== id && index.trees.has(tab))
    setTabs(remaining)
    if (api.activeId === id) {
      if (remaining.length) {
        const nextId = remaining[remaining.length - 1]
        api.select(nextId); setSelectedId(nextId); setPath([nextId])
      } else setView('library')
    }
  }
  useShortcuts([
    { id: 'fta.new', label: 'New fault tree', category: 'Analysis', scope: 'module', bindings: [{ key: 'n', alt: true }], handler: () => { void act(createRoot) } },
    { id: 'fta.library', label: 'Open FTA Library', category: 'Analysis', scope: 'module', handler: showLibrary },
    { id: 'fta.close', label: 'Close tree tab', category: 'Analysis', scope: 'module', enabled: view === 'editor', handler: () => closeTab(api.activeId) },
  ])
  const act = async (action: () => void | Promise<void>) => { try { await action() } catch (error) { toast.error(errorMessage(error)) } }
  const deleteTree = async () => {
    if (!selected) return
    if (index.parents.get(selected.id)?.length) { toast.error('Remove incoming Transfer references before deleting this tree. The Used by list identifies them.'); return }
    const expected = getProjectState()
    if (!await confirmDialog({ title: `Delete “${selected.name}”?`, body: 'This deletes the tree document. Referenced children are retained. Undo restores the operation.', confirmLabel: 'Delete tree', tone: 'danger' })) return
    const current = readCurrentLibrary(expected)
    let next = deleteFtaTree(current.folios, selected.id)
    if (!next.length) next = [{ id: freshId('fta'), name: 'Untitled fault tree', state: { ...initial, nodes: [], edges: [] } }]
    commit(next, normalizeFtaLibrary(next, current.catalog).catalog, next[0].id, 'Delete tree')
    setTabs(previous => previous.filter(id => id !== selected.id)); setPath([next[0].id])
  }
  const unlink = async (reference: FtaReference) => {
    const expected = getProjectState()
    if (!await confirmDialog({ title: 'Remove Transfer reference?', body: `Remove ${reference.transferId} from “${index.trees.get(reference.parentId)?.name}”. The referenced tree stays in the library. Required gate inputs may need repair.`, confirmLabel: 'Remove reference' })) return
    const current = readCurrentLibrary(expected)
    commit(unlinkFtaReferences(current.folios, reference.parentId, [reference.transferId]), current.catalog, selected!.id, 'Remove reference')
  }
  const saveMetadata = (name: string, metadata: FtaTreeMetadata) => {
    if (!selected || !name || !metadata.code) { toast.error('Name and reference code are required.'); return }
    if (Object.entries(catalog.byTreeId).some(([id, value]) => id !== selected.id && value.code.toLowerCase() === metadata.code.toLowerCase())) { toast.error('Reference codes must be unique within the project.'); return }
    commit(folios.map(tree => tree.id === selected.id ? { ...tree, name } : tree), { ...catalog, byTreeId: { ...catalog.byTreeId, [selected.id]: metadata } }, selected.id, 'Edit tree details')
    toast.success('Tree details saved.')
  }
  const runReport = async (download: boolean) => {
    flushProjectEditors()
    const ids = reportScope === 'selected' ? [...selectedTrees] : selected ? [selected.id] : []
    if (reportScope !== 'all' && !ids.length) { toast.error('Select at least one tree in the register.'); return }
    setBusy(download ? 'Preparing package…' : 'Preparing report…')
    try {
      const project = getProjectState()
      const current = normalizeFtaLibrary(project.modules.faultTree ?? api.folios, project.modules.faultTreeCatalog)
      const options = { folios: current.folios, catalog: current.catalog, treeIds: ids, scope: reportScope, units: project.units }
      const { addFtaLibraryToReport, downloadFtaLibraryPackage } = await import('./libraryReports')
      const latestProject = getProjectState()
      if (latestProject.identity.projectId !== project.identity.projectId || latestProject.modules !== project.modules || latestProject.units !== project.units) {
        throw new Error('The project changed while preparing the report. Try again with the current library.')
      }
      if (download) {
        const result = await downloadFtaLibraryPackage(options, progress => setBusy(`${progress.label} · ${progress.done}/${progress.total}`))
        if (result.complete) toast.success(`Exported ${result.trees} unique fault trees.`)
        else toast.error(`Package is incomplete: ${result.failedAssets.length} assets failed. See its manifest.`)
      } else { await addFtaLibraryToReport(options); toast.success('FTA package added as a new report in Report Builder.') }
    } catch (error) { toast.error(errorMessage(error)) } finally { setBusy('') }
  }
  const importTrees = async (file: File) => {
    const expected = getProjectState()
    const payload = JSON.parse(await file.text()) as FtaLibraryPackage
    const current = readCurrentLibrary(expected)
    const imported = remapFtaImport(payload, current.folios, () => freshId('fta'), { existingCatalog: current.catalog })
    const next = [...current.folios, ...imported.folios]
    const nextCatalog = { ...current.catalog, byTreeId: { ...current.catalog.byTreeId, ...imported.catalog.byTreeId } }
    commit(next, nextCatalog, imported.rootTreeIds[0], 'Import tree closure'); setPath([imported.rootTreeIds[0]])
    toast.success(`Imported ${imported.folios.length} trees.${imported.unresolvedSystemLinks.length ? ' External system associations require reassignment.' : ''}`)
  }
  const visibleTrees = useMemo(() => searchFtaLibrary(folios, catalog, query).filter(tree => filter === 'all' || ftaResultFreshness(index, tree.id, CURRENT_ENGINE_REVISIONS.faultTree).status === filter), [folios, catalog, query, filter, index])
  const [registerLimit, setRegisterLimit] = useState(100)
  const select = (id: string, nextPath: string[]) => { setSelectedId(id); setPath(nextPath) }
  const treeNames = useMemo(() => Object.fromEntries(folios.map(tree => [tree.id, `${catalog.byTreeId[tree.id]?.code ?? tree.id} · ${tree.name}`])), [folios, catalog])
  const heading = selected ? catalog.byTreeId[selected.id]?.code : 'Library'
  return <div data-fta-workspace className="flex min-h-0 flex-1 flex-col bg-slate-50 text-slate-900">
    <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center gap-2"><Library size={20} className="text-blue-700" aria-hidden="true" /><h1 className="text-base font-semibold">FTA Library</h1><span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{folios.length} trees</span></div>
      <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-1" role="group" aria-label="FTA workspace view">
        <button type="button" aria-pressed={view === 'library'} onClick={showLibrary} className={`min-h-8 rounded-md px-3 text-sm ${view === 'library' ? 'bg-white font-semibold text-blue-700 shadow-xs' : 'text-slate-600'}`}>Library</button>
        <button type="button" aria-pressed={view === 'editor'} onClick={() => open(selected?.id ?? api.activeId)} className={`min-h-8 rounded-md px-3 text-sm ${view === 'editor' ? 'bg-white font-semibold text-blue-700 shadow-xs' : 'text-slate-600'}`}>Editor</button>
      </div>
      <button type="button" className={`${button} ml-auto`} onClick={() => void act(createRoot)}><Plus size={16} /> New root tree</button>
    </header>
    {tabs.some(id => index.trees.has(id)) && <div role="toolbar" aria-label="Open fault trees" className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-1">
      {tabs.filter(id => index.trees.has(id)).map(id => <div key={id} className={`flex shrink-0 items-center rounded-lg ${view === 'editor' && api.activeId === id ? 'bg-blue-50 text-blue-800' : 'text-slate-600'}`}>
        <button type="button" aria-pressed={view === 'editor' && api.activeId === id} className="min-h-9 max-w-60 truncate px-3 text-sm" onClick={() => open(id)}>{index.trees.get(id)?.name}</button>
        <button type="button" className="flex h-8 w-8 items-center justify-center rounded hover:bg-slate-100" aria-label={`Close tab ${index.trees.get(id)?.name}`} title="Close tab; keep tree in library" onClick={() => closeTab(id)}><X size={14} /></button>
      </div>)}
    </div>}
    {view === 'editor' ? <div className="flex min-h-0 flex-1">
      <div className={`flex shrink-0 flex-col border-r border-slate-200 bg-white ${sidebar ? 'w-72' : 'w-10'}`}>
        <button type="button" className="flex h-10 items-center justify-center gap-2 text-sm text-slate-600 hover:bg-slate-50" aria-label={sidebar ? 'Collapse library navigator' : 'Show library navigator'} aria-expanded={sidebar} onClick={() => setSidebar(value => !value)}>{sidebar ? <><PanelLeftClose size={17} /> Tree navigator</> : <PanelLeftOpen size={17} />}</button>
        {sidebar && <Hierarchy index={index} catalog={catalog} selectedId={api.activeId} onSelect={select} onOpen={open} />}
      </div>
      <Editor key={`${identity.projectId}:${api.activeId}`} onNavigate={onNavigate} onLibrary={showLibrary} />
    </div> : <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <aside aria-label="Browse fault trees" className="flex max-h-[45vh] min-h-52 shrink-0 flex-col border-b border-slate-200 bg-white lg:max-h-none lg:w-80 lg:border-r lg:border-b-0 xl:w-96">
        <div className="space-y-3 border-b border-slate-200 p-3"><label className="relative block"><span className="sr-only">Search FTA Library</span><Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><input className={`${field} pl-9`} placeholder="Search trees, codes, tags, events…" value={query} onChange={event => setQuery(event.target.value)} /></label>
          <div className="flex gap-2"><button type="button" className={`${button} flex-1`} aria-pressed={!register} onClick={() => setRegister(false)}>Hierarchy</button><button type="button" className={`${button} flex-1`} aria-pressed={register} onClick={() => setRegister(true)}>Register</button></div>
        </div>
        {register ? <div className="min-h-0 flex-1 overflow-auto p-3"><label className="text-xs font-medium text-slate-600">Result status<select className={`${field} my-2`} value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All statuses</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <div className="mb-2 flex items-center justify-between text-xs text-slate-600"><span>{visibleTrees.length} trees · {selectedTrees.size} selected</span><button type="button" className="min-h-8 px-2 text-blue-700" onClick={() => setSelectedTrees(new Set(visibleTrees.map(tree => tree.id)))}>Select matching</button></div>
          {visibleTrees.slice(0, registerLimit).map(tree => <div key={tree.id} className={`mb-1 flex items-center gap-2 rounded-lg border p-2 ${selectedId === tree.id ? 'border-blue-200 bg-blue-50' : 'border-slate-200'}`}><input type="checkbox" aria-label={`Select ${tree.name} for report`} className="h-5 w-5" checked={selectedTrees.has(tree.id)} onChange={event => setSelectedTrees(previous => { const next = new Set(previous); if (event.target.checked) next.add(tree.id); else next.delete(tree.id); return next })} /><button type="button" className="min-w-0 flex-1 text-left" onClick={() => select(tree.id, [tree.id])}><span className="block truncate text-sm font-medium">{tree.name}</span><span className="text-xs text-slate-600">{catalog.byTreeId[tree.id]?.code}</span></button><Status index={index} treeId={tree.id} /></div>)}
          {visibleTrees.length > registerLimit && <button type="button" className={button} onClick={() => setRegisterLimit(value => value + 100)}>Show 100 more</button>}
        </div> : <Hierarchy index={index} catalog={catalog} selectedId={selectedId} onSelect={select} onOpen={open} query={query} selectedPath={path} />}
      </aside>
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 lg:p-6">
        {selected && <div className="mx-auto max-w-5xl space-y-5">
          <nav aria-label="Fault tree ancestry" className="flex flex-wrap items-center gap-1 text-xs text-slate-600">{path.map((id, i) => <span key={`${id}:${i}`} className="inline-flex items-center gap-1">{i > 0 && <ChevronRight size={13} />}<button type="button" className="min-h-8 rounded px-1 hover:bg-white hover:text-blue-700" onClick={() => select(id, path.slice(0, i + 1))}>{catalog.byTreeId[id]?.code ?? id}</button></span>)}</nav>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold tracking-wide text-blue-700">{heading}</p><h2 className="mt-1 text-xl font-semibold">{selected.name}</h2><div className="mt-2 flex flex-wrap items-center gap-2"><Status index={index} treeId={selected.id} /><span className="text-xs text-slate-600">{selected.state.nodes?.length ?? 0} nodes · {index.children.get(selected.id)?.length ?? 0} referenced trees · {index.parents.get(selected.id)?.length ?? 0} parents</span></div></div>
              <button type="button" className={primaryButton} onClick={() => open(selected.id)}><ArrowUpRight size={16} /> Open editor</button></div>
            <div className="mt-4 flex flex-wrap gap-2"><button type="button" className={button} onClick={() => setIntent({ parentId: selected.id, create: true })}><Plus size={15} /> Create child</button><button type="button" className={button} onClick={() => setIntent({ parentId: selected.id })}><GitFork size={15} /> Reference existing</button><button type="button" className={button} onClick={() => void act(async () => {
              const payload = exportFtaClosure(folios, catalog, [selected.id]); await downloadArtifact(JSON.stringify(payload, null, 2), `${catalog.byTreeId[selected.id].code}-models.json`, 'application/json', { kind: 'fta-model-package', moduleKey: 'faultTree', analysisId: selected.id })
            })}><Download size={15} /> Export models</button><button type="button" className={`${button} text-red-700`} onClick={() => void act(deleteTree)}>Delete tree</button></div>
          </section>
          {index.issues.length > 0 && <details className="rounded-xl border border-amber-200 bg-amber-50 p-4"><summary className="cursor-pointer text-sm font-medium text-amber-900"><AlertTriangle size={16} className="mr-2 inline" />{index.issues.length} library reference issues</summary><ul className="mt-3 space-y-2">{index.issues.map((issue, i) => <li key={i} className="text-sm text-amber-900"><button type="button" className="min-h-8 underline" onClick={() => select(issue.treeId, [issue.treeId])}>{index.trees.get(issue.treeId)?.name ?? issue.treeId}</button>: {issue.message}</li>)}</ul></details>}
          <section aria-label="Selected fault tree preview" className="overflow-hidden rounded-xl border border-slate-200 bg-white">{malformedTrees.has(selected.id)
            ? <p role="status" className="p-5 text-sm text-amber-900">Preview unavailable: this tree contains malformed model data. Its original data is preserved; review the library issues before repairing it.</p>
            : <ReadOnlyFaultTreeDiagram state={selected.state} label={`${selected.name} preview`} height={300} treeNames={treeNames} />}</section>
          <div className="grid items-start gap-5 xl:grid-cols-2">
            <section className="rounded-xl border border-slate-200 bg-white p-5"><h3 className="mb-4 text-base font-semibold">Tree details</h3><TreeMetadata key={`${selected.id}:${selected.name}:${JSON.stringify(catalog.byTreeId[selected.id])}`} tree={selected} metadata={catalog.byTreeId[selected.id]} systems={systems} onSave={saveMetadata} /></section>
            <div className="space-y-5"><section className="rounded-xl border border-slate-200 bg-white p-5"><h3 className="text-base font-semibold">References and use</h3><p className="mt-1 text-xs leading-5 text-slate-600">Every appearance opens the same document. Changes to it affect all referencing parents.</p>
              {(['Used by', 'References'] as const).map(direction => { const refs = direction === 'Used by' ? index.parents.get(selected.id) ?? [] : index.children.get(selected.id) ?? []; return <div key={direction} className="mt-4"><h4 className="text-sm font-semibold text-slate-700">{direction}</h4>{!refs.length && <p className="mt-1 text-sm text-slate-500">{direction === 'Used by' ? 'Root tree · no referencing parents.' : 'No referenced trees.'}</p>}{refs.map(group => <div key={`${group.parentId}:${group.targetId}`} className="mt-2 rounded-lg border border-slate-200 p-3"><button type="button" className="min-h-8 text-left text-sm font-medium text-blue-700 hover:underline" onClick={() => select(direction === 'Used by' ? group.parentId : group.targetId, direction === 'Used by' ? [group.parentId] : [...path, group.targetId])}>{catalog.byTreeId[direction === 'Used by' ? group.parentId : group.targetId]?.code} · {index.trees.get(direction === 'Used by' ? group.parentId : group.targetId)?.name ?? 'Missing tree'}</button>{group.references.map(reference => <div key={reference.transferId} className="mt-2 border-t border-slate-100 pt-2"><p className="break-all text-xs text-slate-600">{reference.transferId} · {reference.mode === 'shared' ? 'Shared events' : 'Independent instance'}{!reference.placed ? ' · Unplaced' : ''}</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" className={button} onClick={() => setIntent({ parentId: reference.parentId, moving: reference })}>Move</button><button type="button" className={button} onClick={() => void act(() => unlink(reference))}>Remove reference</button></div></div>)}</div>)}</div> })}
            </section>
            <section className="rounded-xl border border-slate-200 bg-white p-5"><h3 className="text-base font-semibold">Reports and packages</h3><p className="mt-1 text-sm leading-6 text-slate-600">An indentured register and each unique tree’s diagram, documentation, and verified results. Referenced models are included once.</p><label className="mt-3 block text-sm font-medium text-slate-700">Include<select className={`${field} mt-1`} value={reportScope} onChange={event => setReportScope(event.target.value as typeof reportScope)}><option value="tree">This tree and required references</option><option value="branch">This branch</option><option value="selected">Selected register trees ({selectedTrees.size})</option><option value="all">Entire project library</option></select></label>
              <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={button} disabled={!!busy} onClick={() => void runReport(false)}><FileText size={15} /> Add to reports</button><button type="button" className={button} disabled={!!busy} onClick={() => void runReport(true)}><Download size={15} /> Download package</button></div>{busy && <p role="status" className="mt-3 text-sm text-blue-700">{busy}</p>}
            </section></div>
          </div>
          <div className="flex justify-end"><input ref={fileInput} type="file" accept=".json,application/json" className="hidden" aria-label="Import FTA model package" onChange={event => { const file = event.target.files?.[0]; if (file) void act(() => importTrees(file)); event.target.value = '' }} /><button type="button" className={button} onClick={() => fileInput.current?.click()}><Upload size={16} /> Import tree models</button></div>
        </div>}
      </main>
    </div>}
    {intent && <PlacementDialog intent={intent} folios={folios} catalog={catalog} initial={initial} onClose={() => setIntent(null)} onCommit={(next, nextCatalog, targetId) => { commit(next, nextCatalog, targetId, intent.moving ? 'Move reference' : 'Add child reference'); setIntent(null); setPath([intent.parentId, targetId]); toast.success('Reference saved. Parent results require recalculation.') }} />}
  </div>
}
