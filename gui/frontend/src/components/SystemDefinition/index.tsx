import StructureTable from './StructureTable'
import SystemFunctionsEditor from './SystemFunctionsEditor'
import RequirementsVerification from './RequirementsVerification'
import { appendCompositionInstance, moveSystemSibling, reparentSystemInstance, systemHierarchyInstances, systemStructureRows } from './structureEditing'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box, Check, ChevronDown, ChevronRight, CircleAlert, ClipboardCheck, GitBranch, Layers3, Link2,
  Eye, EyeOff, Minus, Network, PanelRightClose, PanelRightOpen, Plus, RefreshCw, Send, ShieldAlert, TableProperties, Trash2, X,
} from 'lucide-react'

import {
  analyzeSystemImpact,
  generateSystemStarter,
  planSystemComposition,
  projectSystemDefinition,
  propagateSystemDefinition,
  validateSystemDefinition,
  type SystemAnalysisProfile,
  type SystemBlockDefinition,
  type SystemBlockInstance,
  type SystemDefinitionModel,
  type SystemEndpoint,
  type SystemFunctionRef,
  type SystemInterface,
  type SystemInterfaceType,
  type SystemProjectionResult,
  type SystemResource,
} from '../../api/systemDefinition'
import { useModuleState } from '../../store/project'
import { useUiPreference } from '../../store/uiPreferences'
import { useBookmarkNavigationTarget } from '../../store/bookmarks'
import { captureSharedSystemContext, useSharedSystemDefinition } from '../../store/sharedSystem'
import { createProjectSystem, systemInputFingerprint } from '../../store/sharedSystemModel'
import { createFmeaAnalysis } from '../ReliabilityProgram/fmeaModel'
import { bindFmeaAnalysis } from '../../store/sharedFmeaModel'
import type { AIAGVDAFMEAAnalysis } from '../../api/reliabilityProgram'
import { toast } from '../shared/toast'
import { distributionLabel } from '../shared/distributionLabels'
import {
  decisionStatus, hierarchyLayout, instanceLabel,
  type SystemDefinitionState,
} from './model'
import SystemBlockDiagramCanvas from './SystemBlockDiagramCanvas'
import { defaultHierarchyDiagramNodes, diagramBranchVisible, diagramBranchSelection, diagramInstanceSelected,
  setDiagramBranchVisibility, setDiagramVisibility } from './diagramProjection'
import { hierarchyIndex, interfaceBoundaryInstances } from '../shared/hierarchicalDiagram'
import { SystemInterfaceTransferEditor } from '../shared/ResourceTransferEditor'
import { effectiveSystemFunctions, syncGeneratedDescriptions } from '../../store/systemArchitecture'
import { upsertInstalledFunction, disconnectInterface, isolateInstalledOutputs } from '../../store/functionResourceFlows'
import { populateSystemInterfaceFunctions } from '../../store/interfaceFunctions'

const INITIAL_STATE = createProjectSystem()
const fieldClass = 'w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs outline-hidden focus:border-blue-500'
const buttonClass = 'inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:border-blue-400 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40'
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`
const reliabilityDistributionDefaults: Record<string, Record<string, number>> = {
  exponential: { lambda: 0.001 }, weibull: { alpha: 1000, beta: 1.5 },
  normal: { mu: 1000, sigma: 200 }, lognormal: { mu: 6.9, sigma: 0.5 },
  gamma: { alpha: 2, beta: 500 }, loglogistic: { alpha: 1000, beta: 2 },
  gumbel: { mu: 1000, sigma: 200 }, beta: { alpha: 2, beta: 2 },
}

/** Fill new records without resetting any manually positioned installed block. */
function ensureMasterDiagramNodes(model: SystemDefinitionModel): SystemDefinitionModel {
  const diagram = model.diagrams[0]
  if (!diagram) return model
  const existing = new Map(diagram.nodes.flatMap(node => node.instance_id ? [[node.instance_id, node] as const] : []))
  return { ...model, diagrams: [{ ...diagram, nodes: [
    ...defaultHierarchyDiagramNodes(model).map(node => existing.get(node.instance_id ?? '') ?? node),
    ...diagram.nodes.filter(node => node.external_id),
  ] }, ...model.diagrams.slice(1)] }
}

function activeFolioUpdate(raw: unknown, update: (state: Record<string, unknown>) => Record<string, unknown>): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const record = raw as Record<string, unknown>
  if (record._folioWrap !== true || !Array.isArray(record.folios)) return update(record)
  const activeId = String(record.activeId ?? '')
  return {
    ...record,
    folios: (record.folios as Record<string, unknown>[]).map(folio =>
      String(folio.id) === activeId
        ? { ...folio, state: update((folio.state ?? {}) as Record<string, unknown>) }
        : folio),
  }
}

function activeFolioState(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {}
  const record = raw as Record<string, unknown>
  if (record._folioWrap !== true || !Array.isArray(record.folios)) return record
  const activeId = String(record.activeId ?? '')
  const folio = (record.folios as Record<string, unknown>[]).find(item =>
    String(item.id) === activeId) ?? (record.folios as Record<string, unknown>[])[0]
  return (folio?.state ?? {}) as Record<string, unknown>
}

function activeAnalysisId(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return 'default'
  const record = raw as Record<string, unknown>
  return record._folioWrap === true ? String(record.activeId ?? 'default') : 'default'
}

function typeLabel(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase())
}

function ModePicker({ model, value, onChange }: {
  model: SystemDefinitionModel
  value: string[]
  onChange: (value: string[]) => void
}) {
  if (!model.modes.length) return <div className="text-[10px] text-slate-400">Applies in all operating modes.</div>
  return <div className="flex flex-wrap gap-x-3 gap-y-1">
    {model.modes.map(mode => <label key={mode.id} className="flex items-center gap-1 text-[10px] text-slate-600">
      <input type="checkbox" checked={value.includes(mode.id)} onChange={event => onChange(event.target.checked
        ? [...value, mode.id] : value.filter(id => id !== mode.id))} />
      {mode.name}
    </label>)}
    {!value.length && <span className="text-[10px] text-slate-400">All modes</span>}
  </div>
}

function endpointKey(endpoint: SystemEndpoint): string {
  return endpoint.instance_id ? `instance:${endpoint.instance_id}` : `external:${endpoint.external_id ?? ''}`
}

function functionRefKey(ref: SystemFunctionRef): string {
  return `${ref.instance_id}::${ref.function_id}`
}

function HierarchyTree({
  model, selectedId, onSelect, onVisibilityChange, hidePieceParts = false, label = 'System hierarchy',
}: {
  model: SystemDefinitionModel
  selectedId: string
  onSelect: (id: string) => void
  onVisibilityChange?: (id: string, visible: boolean) => void
  hidePieceParts?: boolean
  label?: string
}) {
  const byParent = new Map<string, SystemBlockInstance[]>()
  for (const item of systemHierarchyInstances(model, hidePieceParts)) {
    const key = item.parent_instance_id ?? ''
    byParent.set(key, [...(byParent.get(key) ?? []), item])
  }
  const branch = (item: SystemBlockInstance, depth: number): React.ReactNode => {
    const definition = model.definitions.find(value => value.id === item.definition_id)
    const visibility = diagramBranchSelection(model, item.id)
    const contextOnly = diagramBranchVisible(model, item.id) && !diagramInstanceSelected(model, item.id)
    return <div key={item.id}>
      <div className="flex items-start gap-1"><button type="button" onClick={() => onSelect(item.id)}
        className={`flex min-w-0 flex-1 items-center gap-1 rounded px-1.5 py-1 text-left text-xs ${
          selectedId === item.id ? 'bg-blue-100 text-blue-800' : 'text-slate-700 hover:bg-slate-100'
        }`} style={{ paddingLeft: 6 + depth * 14 }}>
        <ChevronRight size={11} className={`shrink-0 ${(byParent.get(item.id)?.length ?? 0) ? 'text-slate-400' : 'invisible'}`} />
        <Box size={12} className="shrink-0 text-blue-500" />
        <span className="min-w-0 flex-1 whitespace-normal [overflow-wrap:anywhere]">{instanceLabel(model, item)}</span>
        <span className="ml-auto shrink-0 text-[9px] text-slate-600" title={definition?.classification}>L{depth + 1}</span>
      </button>
      {onVisibilityChange && item.id !== model.root_instance_id && <button type="button"
        aria-label={`Diagram visibility for ${instanceLabel(model, item)}`} aria-pressed={visibility}
        title={`${contextOnly ? 'Parent context only. ' : visibility === 'mixed' ? 'Partially selected branch. ' : ''}${visibility === true ? 'Hide' : 'Show'} this entire branch`}
        onClick={() => onVisibilityChange(item.id, visibility !== true)}
        className="mt-0.5 shrink-0 rounded p-1 text-slate-600 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">
        {visibility === 'mixed' ? <Minus size={14} className="text-blue-700" /> : visibility ? <Eye size={14} /> : <EyeOff size={14} />}
      </button>}</div>
      {(byParent.get(item.id) ?? []).map(child => branch(child, depth + 1))}
    </div>
  }
  return <div role="group" aria-label={label}>{(byParent.get('') ?? []).map(item => branch(item, 0))}</div>
}


function ArchitectureDiagram({
  model, selectedId, structureCollapsedIds, onSelect, onToggleCollapse,
}: {
  model: SystemDefinitionModel
  selectedId: string
  structureCollapsedIds: string[]
  onSelect: (id: string) => void
  onToggleCollapse: (id: string) => void
}) {
  const collapsed = new Set(structureCollapsedIds)
  const layouts = hierarchyLayout(model, collapsed)
  const byId = new Map(layouts.map(item => [item.instance_id, item]))
  const instanceById = new Map(model.instances.map(item => [item.id, item]))
  const internalRight = Math.max(760, ...layouts.map(item => item.x + item.width))
  const externalLayouts = new Map(model.externals.map((item, index) => [item.id, {
    x: internalRight + 140, y: 50 + index * 100, width: 180, height: 72,
  }]))
  const childrenByParent = new Map<string, SystemBlockInstance[]>()
  for (const instance of model.instances) {
    if (!instance.parent_instance_id) continue
    childrenByParent.set(instance.parent_instance_id, [
      ...(childrenByParent.get(instance.parent_instance_id) ?? []), instance,
    ])
  }
  const descendantCount = (instanceId: string, visited = new Set<string>()): number => {
    if (visited.has(instanceId)) return 0
    const nextVisited = new Set(visited).add(instanceId)
    return (childrenByParent.get(instanceId) ?? []).reduce((total, child) =>
      total + 1 + descendantCount(child.id, nextVisited), 0)
  }
  const visibleInstance = (instanceId?: string) => {
    let cursor = instanceId
    const visited = new Set<string>()
    while (cursor && !visited.has(cursor)) {
      if (byId.has(cursor)) return byId.get(cursor)
      visited.add(cursor)
      cursor = instanceById.get(cursor)?.parent_instance_id
    }
    return undefined
  }
  const width = Math.max(900, internalRight + (model.externals.length ? 400 : 80))
  const height = Math.max(560, ...layouts.map(item => item.y + item.height + 80),
    ...Array.from(externalLayouts.values()).map(item => item.y + item.height + 80))
  return <div className="h-full overflow-auto rounded border border-slate-200 bg-slate-50">
    <svg width={width} height={height} aria-label="System block diagram" role="img">
      <defs><marker id="system-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#64748b" /></marker></defs>
      {model.interfaces.map(item => {
        const source = item.source.instance_id
          ? visibleInstance(item.source.instance_id)
          : externalLayouts.get(item.source.external_id ?? '')
        const target = item.target.instance_id
          ? visibleInstance(item.target.instance_id)
          : externalLayouts.get(item.target.external_id ?? '')
        if (!source || !target) return null
        const x1 = source.x + source.width
        const y1 = source.y + source.height / 2
        const x2 = target.x
        const y2 = target.y + target.height / 2
        return <g key={item.id}>
          <path d={`M${x1},${y1} C${x1 + 50},${y1} ${x2 - 50},${y2} ${x2},${y2}`}
            fill="none" stroke="#64748b" strokeWidth="2"
            strokeDasharray={item.linkage === 'indirect' ? '6 4' : undefined}
            markerEnd={item.directionality === 'directed' ? 'url(#system-arrow)' : undefined} />
          <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 5}
            textAnchor="middle" fontSize="10" fill="#475569">{item.name || typeLabel(item.interface_type)}</text>
        </g>
      })}
      {model.externals.map(item => {
        const layout = externalLayouts.get(item.id)!
        return <g key={item.id}>
          <rect x={layout.x} y={layout.y} width={layout.width} height={layout.height} rx="8"
            fill="#faf5ff" stroke="#a855f7" strokeDasharray="5 3" />
          <text x={layout.x + 12} y={layout.y + 26} fontSize="12" fontWeight="600" fill="#581c87">{item.name.slice(0, 24)}</text>
          <text x={layout.x + 12} y={layout.y + 46} fontSize="9" fill="#7e22ce">External · {typeLabel(item.kind)}</text>
        </g>
      })}
      {model.instances.map(item => {
        const layout = byId.get(item.id)
        if (!layout) return null
        const definition = model.definitions.find(value => value.id === item.definition_id)
        const childCount = childrenByParent.get(item.id)?.length ?? 0
        const hiddenCount = collapsed.has(item.id) ? descendantCount(item.id) : 0
        return <g key={item.id} onClick={() => onSelect(item.id)} className="cursor-pointer">
          <rect x={layout.x} y={layout.y} width={layout.width} height={layout.height} rx="8"
            fill={selectedId === item.id ? '#dbeafe' : '#fff'}
            stroke={selectedId === item.id ? '#2563eb' : '#94a3b8'} strokeWidth={selectedId === item.id ? 2 : 1} />
          <text x={layout.x + 12} y={layout.y + 24} fontSize="12" fontWeight="600" fill="#1e293b">
            {instanceLabel(model, item).slice(0, 24)}
          </text>
          <text x={layout.x + 12} y={layout.y + 43} fontSize="9" fill="#64748b">
            {definition?.classification} · {definition?.functions.length ?? 0} functions · {definition?.failure_modes.length ?? 0} modes
          </text>
          {childCount > 0 && <g role="button" tabIndex={0}
            aria-label={`${collapsed.has(item.id) ? 'Expand' : 'Collapse'} ${instanceLabel(model, item)}`}
            onClick={event => { event.stopPropagation(); onToggleCollapse(item.id) }}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault(); event.stopPropagation(); onToggleCollapse(item.id)
              }
            }}>
            <circle cx={layout.x + layout.width - 15} cy={layout.y + 15} r="9"
              fill={collapsed.has(item.id) ? '#dbeafe' : '#f1f5f9'} stroke="#94a3b8" />
            <text x={layout.x + layout.width - 15} y={layout.y + 18.5}
              textAnchor="middle" fontSize="12" fontWeight="600" fill="#475569">
              {collapsed.has(item.id) ? '+' : '−'}
            </text>
          </g>}
          {collapsed.has(item.id) && <text x={layout.x + layout.width - 12} y={layout.y + 60}
            textAnchor="end" fontSize="9" fill="#2563eb">{hiddenCount} hidden</text>}
        </g>
      })}
    </svg>
  </div>
}

function FaultTraceDiagram({ result }: { result: NonNullable<SystemDefinitionState['propagation']> }) {
  const depth = new Map(result.nodes.map(item => [item.id, 0]))
  for (let pass = 0; pass < result.nodes.length; pass += 1) {
    let changed = false
    for (const edge of result.edges) {
      const next = Math.min(result.nodes.length, (depth.get(edge.source) ?? 0) + 1)
      if (next > (depth.get(edge.target) ?? 0)) { depth.set(edge.target, next); changed = true }
    }
    if (!changed) break
  }
  const byDepth = new Map<number, typeof result.nodes>()
  for (const node of result.nodes) {
    const column = depth.get(node.id) ?? 0
    byDepth.set(column, [...(byDepth.get(column) ?? []), node])
  }
  const position = new Map<string, { x: number; y: number }>()
  for (const [column, nodes] of byDepth) nodes.forEach((node, row) =>
    position.set(node.id, { x: 30 + column * 260, y: 30 + row * 100 }))
  const width = Math.max(760, ...Array.from(position.values()).map(item => item.x + 230))
  const height = Math.max(240, ...Array.from(position.values()).map(item => item.y + 85))
  return <div className="mb-5 overflow-auto rounded border bg-slate-50">
    <svg width={width} height={height} role="img" aria-label="Functional failure propagation graph">
      <defs><marker id="fault-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#b45309" /></marker></defs>
      {result.edges.map(edge => {
        const source = position.get(edge.source); const target = position.get(edge.target)
        if (!source || !target) return null
        return <path key={edge.id} d={`M${source.x + 210},${source.y + 34} C${source.x + 235},${source.y + 34} ${target.x - 25},${target.y + 34} ${target.x},${target.y + 34}`}
          fill="none" stroke="#b45309" strokeWidth="1.5" markerEnd="url(#fault-arrow)" />
      })}
      {result.nodes.map(node => {
        const point = position.get(node.id)!
        return <g key={node.id}>
          <rect x={point.x} y={point.y} width="210" height="68" rx="7"
            fill={node.authored ? '#fff7ed' : '#fff'} stroke={node.authored ? '#ea580c' : '#cbd5e1'} />
          <text x={point.x + 10} y={point.y + 20} fontSize="10" fontWeight="600" fill="#334155">{node.function.instance_name.slice(0, 26)}</text>
          <text x={point.x + 10} y={point.y + 37} fontSize="9" fill="#475569">{node.description.slice(0, 34)}</text>
          <text x={point.x + 10} y={point.y + 54} fontSize="8" fill="#b45309">{typeLabel(node.deviation_id)} · {node.authored ? 'authored' : 'inferred'}</text>
        </g>
      })}
    </svg>
  </div>
}

export default function SystemDefinition({ functionNavigation, interfaceNavigation }: {
  functionNavigation?: { instanceId: string; functionId: string; nonce: number }
  interfaceNavigation?: { interfaceId: string; nonce: number }
} = {}) {
  const [state, setState] = useSharedSystemDefinition()
  const bookmarkTarget = useBookmarkNavigationTarget()
  const appliedBookmark = useRef(0)
  useEffect(() => {
    if (!bookmarkTarget || bookmarkTarget.nonce === appliedBookmark.current
      || bookmarkTarget.source.module !== 'systemDefinition' || bookmarkTarget.source.view !== 'requirements') return
    appliedBookmark.current = bookmarkTarget.nonce
    setState(current => ({ ...current, view: 'requirements' }))
  }, [bookmarkTarget, setState])
  const [showPieceParts, setShowPieceParts] = useUiPreference<boolean>('systemDefinition.showPieceParts', false)
  const [editStructure, setEditStructure] = useUiPreference<boolean>('systemDefinition.editStructure', false)
  const [modelToolsOpen, setModelToolsOpen] = useState(false)
  const [diagramSelectionRequest,setDiagramSelectionRequest] = useState<{instanceId:string;requestId:number}>()
  const [interfaceSelectionRequest, setInterfaceSelectionRequest] = useState<{interfaceId:string;requestId:number}>()
  const [functionFocusRequest, setFunctionFocusRequest] = useState<{instanceId:string;functionId:string;nonce:number}>()
  const navigateFunction = useCallback((target: {instanceId:string;functionId:string}) => {
    setState(current => ({ ...current, view: 'functions', selectedInstanceId: target.instanceId }))
    setFunctionFocusRequest(current => ({ ...target, nonce: (current?.nonce ?? 0) + 1 }))
    setModelToolsOpen(false)
  }, [setState])
  const navigateInterface = useCallback((interfaceId: string) => {
    setState(current => {
      const item = current.model.interfaces.find(edge => edge.id === interfaceId)
      if (!item) return current
      let next = current.model
      const instanceIds: string[] = []
      for (const endpoint of [item.source, item.target]) {
        let instance = next.instances.find(value => value.id === endpoint.instance_id)
        const seen = new Set<string>()
        while (instance && next.definitions.find(definition => definition.id === instance?.definition_id)?.kind === 'piece_part'
            && !seen.has(instance.id)) {
          seen.add(instance.id)
          const parentId = instance.parent_instance_id
          instance = next.instances.find(value => value.id === parentId)
        }
        if (instance) {
          instanceIds.push(instance.id)
          if (instance.id !== next.root_instance_id) next = setDiagramBranchVisibility(next, instance.id, true)
        }
      }
      return { ...current, view: 'architecture', selectedInstanceId: instanceIds[0] ?? current.selectedInstanceId, model: next }
    })
    setDiagramSelectionRequest(undefined)
    setInterfaceSelectionRequest(current => ({ interfaceId, requestId: (current?.requestId ?? 0) + 1 }))
    setModelToolsOpen(false)
  }, [setState])
  useEffect(() => { if (functionNavigation) navigateFunction(functionNavigation) }, [functionNavigation, navigateFunction])
  useEffect(() => { if (interfaceNavigation) navigateInterface(interfaceNavigation.interfaceId) }, [interfaceNavigation, navigateInterface])
  const [rbdModule, setRbd] = useModuleState<unknown>('system', {})
  const [ftaModule, setFta] = useModuleState<unknown>('faultTree', {})
  const [markovModule, setMarkov] = useModuleState<unknown>('markov', {})
  const [fmeaModule, setFmea] = useModuleState<unknown>('fmea', {})
  const [predictionModule] = useModuleState<unknown>('prediction', {})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [compositionPlan, setCompositionPlan] = useState<Record<string, unknown>|null>(null)
  const [quantityStrategy, setQuantityStrategy] = useState<'grouped'|'exploded'>('grouped')
  const [projectionScopeId, setProjectionScopeId] = useState('')
  const [impactReport, setImpactReport] = useState<Record<string, unknown>[]>([])
  const model = state.model ?? INITIAL_STATE.model
  const structureCollapsedIds = state.structureCollapsedIds ?? []
  const selected = model.instances.find(item => item.id === state.selectedInstanceId)
    ?? model.instances[0]
  const selectedDefinition = model.definitions.find(item => item.id === selected?.definition_id)
  const functionOptions = useMemo(() => model.instances.flatMap(instance => {
    return effectiveSystemFunctions(model, instance.id).map(fn => ({
      key: `${instance.id}::${fn.id}`,
      ref: { instance_id: instance.id, function_id: fn.id },
      label: `${instanceLabel(model, instance)} — ${fn.description}`,
    }))
  }), [model])
  const visibleInterfaceInstances = useMemo(() => {
    const index = hierarchyIndex(model.instances)
    const nodes = new Map((model.diagrams[0]?.nodes ?? []).flatMap(node => node.instance_id ? [[node.instance_id, node] as const] : []))
    return model.instances.filter(instance => instance.id !== model.root_instance_id
      && model.definitions.find(definition => definition.id === instance.definition_id)?.kind !== 'piece_part'
      && diagramBranchVisible(model, instance.id)
      && index.ancestors(instance.id).every(id => id === model.root_instance_id || nodes.get(id)?.expanded))
  }, [model])
  const acceptedProposalIds = useMemo(() => new Set([
    ...state.decisions.filter(item => item.status === 'accepted'
      && item.fingerprint === state.propagation?.fingerprint).map(item => item.proposal_id),
    ...(state.propagation?.proposals ?? []).filter(item => item.review_required === false)
      .map(item => item.id),
  ]), [state.decisions, state.propagation])
  const acceptedPaths = useMemo(() => (state.propagation?.paths ?? []).filter(path =>
    path.edge_ids.length > 0 && [
      ...path.edge_ids.map(edgeId => state.propagation?.proposals.find(item => item.edge_id === edgeId)?.id),
      path.proposal_id,
    ].filter((id): id is string => Boolean(id)).every(id => acceptedProposalIds.has(id))),
  [state.propagation, acceptedProposalIds])

  const updateModel = (update: (value: SystemDefinitionModel) => SystemDefinitionModel) =>
    setState(current => {
      const next = update(current.model)
      if (systemInputFingerprint(next) === systemInputFingerprint(current.model)) return { ...current, model: next }
      return { ...current, model: populateSystemInterfaceFunctions(next, current.model), propagation: null }
    })

  const updateDefinition = (definitionId: string, patch: Partial<SystemBlockDefinition>) =>
    updateModel(current => ({ ...current, definitions: current.definitions.map(item =>
      item.id === definitionId ? { ...item, ...patch } : item) }))

  const changeParent = (instanceId: string, parentInstanceId: string) => setState(current => {
    const nextModel = reparentSystemInstance(current.model, instanceId, parentInstanceId)
    if (nextModel === current.model) return current
    const ancestors = new Set(systemStructureRows(nextModel).find(row => row.instance.id === instanceId)?.ancestors)
    return { ...current, model: nextModel, propagation: null,
      selectedInstanceId: instanceId,
      structureCollapsedIds: (current.structureCollapsedIds ?? []).filter(id => !ancestors.has(id)) }
  })

  const moveSibling = (instanceId: string, direction: -1 | 1) => setState(current => {
    const nextModel = moveSystemSibling(current.model, instanceId, direction, showPieceParts)
    return nextModel === current.model ? current : { ...current,
      model: nextModel, selectedInstanceId: instanceId, propagation: null }
  })

  const addProfile = (domain: 'prediction'|'reliability') => {
    if (!selectedDefinition) return
    const adapter_id = domain === 'prediction'
      ? 'prediction.mil-hdbk-217f' : 'reliability.constant-hazard'
    const profile: SystemAnalysisProfile = {
      id: uid('PROFILE'), name: domain === 'prediction' ? 'MIL-HDBK-217F' : 'Reliability model',
      domain, adapter_id, adapter_version: 1, status: 'draft', mode_ids: [],
      values: domain === 'prediction'
        ? { category: { kind: 'text', value: selectedDefinition.category } }
        : { failure_rate: { kind: 'number', value: 0, unit: 'failures/hour' } },
    }
    updateDefinition(selectedDefinition.id, {
      analysis_profiles: [...(selectedDefinition.analysis_profiles ?? []), profile],
    })
  }

  const updateProfile = (profileId: string, patch: Partial<SystemAnalysisProfile>) => {
    if (!selectedDefinition) return
    updateDefinition(selectedDefinition.id, {
      analysis_profiles: (selectedDefinition.analysis_profiles ?? []).map(item =>
        item.id === profileId ? { ...item, ...patch } : item),
    })
  }

  const addProfileParameter = (profile: SystemAnalysisProfile) => {
    const key = window.prompt('Parameter key (for example temperature_c or distribution)')
      ?.trim().replace(/\s+/g, '_')
    if (!key || profile.values[key]) return
    const raw = window.prompt('Initial value') ?? ''
    const numeric = raw.trim() !== '' && Number.isFinite(Number(raw))
    const value = numeric
      ? { kind: 'number' as const, value: Number(raw), unit: window.prompt('Unit (optional)') ?? '' }
      : { kind: 'text' as const, value: raw }
    updateProfile(profile.id, { values: { ...profile.values, [key]: value } })
  }

  const selectProfileAdapter = (profile: SystemAnalysisProfile, adapter_id: string) => {
    const values = { ...profile.values }
    if (adapter_id === 'reliability.distribution' && !values.distribution) {
      values.distribution = { kind: 'choice', value: 'weibull', option_ids: Object.keys(reliabilityDistributionDefaults) }
      Object.entries(reliabilityDistributionDefaults.weibull).forEach(([key, value]) => {
        if (!values[key]) values[key] = { kind: 'number', value, unit: '' }
      })
    }
    if (adapter_id === 'reliability.constant-hazard' && !values.failure_rate) {
      values.failure_rate = { kind: 'number', value: 0, unit: 'failures/hour' }
    }
    if (adapter_id === 'reliability.analysis-reference' && !values.analysis_id) {
      values.analysis_id = { kind: 'text', value: '' }
    }
    updateProfile(profile.id, { adapter_id, values })
  }

  const updateProfileParameter = (
    profile: SystemAnalysisProfile, key: string, raw: string,
  ) => {
    const current = profile.values[key]
    if (!current) return
    const nextValue = current.kind === 'number'
      ? { ...current, value: Number(raw) || 0 }
      : current.kind === 'boolean'
        ? { ...current, value: raw === 'true' }
        : { ...current, value: raw }
    const values = { ...profile.values, [key]: nextValue }
    if (key === 'distribution') {
      Object.entries(reliabilityDistributionDefaults[raw] ?? {}).forEach(([name, value]) => {
        if (!values[name]) values[name] = { kind: 'number', value, unit: '' }
      })
    }
    updateProfile(profile.id, { values })
  }

  const reviewComposition = async () => {
    if (!selected) return
    const isCurrent = captureSharedSystemContext()
    setBusy(true)
    try {
      const result = await planSystemComposition(model, selected.id)
      if (!isCurrent()) return
      setCompositionPlan(result)
    } catch {
      if (!isCurrent()) return
      toast.error('Could not build the reusable-definition update plan.')
    } finally { setBusy(false) }
  }

  const captureChildSlots = () => {
    if (!selected || !selectedDefinition) return
    const children = model.instances.filter(item => item.parent_instance_id === selected.id)
    if (!children.length) {
      toast.info('Add direct children before capturing a reusable composition.')
      return
    }
    const slots = children.map(child => ({
      id: child.slot_id ?? `SLOT-${child.id}`,
      definition_id: child.definition_id, name: instanceLabel(model, child),
      quantity: child.quantity,
    }))
    updateModel(current => ({
      ...current,
      definitions: current.definitions.map(item => item.id === selectedDefinition.id
        ? { ...item, child_slots: slots } : item),
      instances: current.instances.map(item => {
        const slot = children.find(child => child.id === item.id)
        const childDefinition = slot
          ? current.definitions.find(definition => definition.id === slot.definition_id)
          : undefined
        return slot ? {
          ...item, slot_id: slot.slot_id ?? `SLOT-${slot.id}`,
          origin: 'definition_slot' as const,
          definition_revision: childDefinition?.revision ?? current.revision,
        } : item
      }),
    }))
    toast.success('Direct children captured as reviewed reusable slots.')
  }

  const applyCompositionPlan = () => {
    const proposals = Array.isArray(compositionPlan?.proposals)
      ? compositionPlan.proposals as Record<string, unknown>[] : []
    if (!proposals.length) return
    if (!window.confirm(`Apply ${proposals.length} reviewed reusable-definition update(s)?`)) return
    updateModel(current => {
      let instances = [...current.instances]
      let resources = [...current.resources]
      for (const proposal of proposals) {
        if (proposal.blocked) continue
        if (proposal.action === 'add' && proposal.instance) {
          const created = proposal.instance as unknown as SystemBlockInstance
          const addedResources = Array.isArray(proposal.resources) ? proposal.resources as SystemResource[] : []
          resources = [...resources, ...addedResources.filter(item => !resources.some(existing => existing.id === item.id))]
          instances = appendCompositionInstance(instances, created, () => uid('INSTANCE'))
        } else if (proposal.action === 'update' && proposal.instance_id) {
          const changes = (proposal.changes ?? {}) as Partial<SystemBlockInstance>
          instances = instances.map(item => item.id === proposal.instance_id
            ? { ...item, ...changes } : item)
        } else if (proposal.action === 'remove' && proposal.instance_id) {
          instances = instances.filter(item => item.id !== proposal.instance_id)
        }
      }
      return { ...current, instances, resources }
    })
    setCompositionPlan(null)
    toast.success('Reviewed reusable-definition updates applied.')
  }

  const previewProjection = async (target: 'prediction'|'fmea'|'rbd'|'fta'|'markov') => {
    const isCurrent = captureSharedSystemContext()
    setBusy(true); setMessage('')
    try {
      const result = await projectSystemDefinition(model, target, {
        scope_instance_id: projectionScopeId || undefined,
        mode_id: state.selectedModeId || undefined,
        quantity_strategy: quantityStrategy,
        selected_path_ids: acceptedPaths.map(item => item.id),
        current_analysis: target === 'prediction'
          ? activeFolioState(predictionModule)
          : target === 'rbd' ? activeFolioState(rbdModule) : {},
      })
      if (!isCurrent()) return
      setState(current => ({ ...current, projectionPreview: result }))
      setMessage(result.valid
        ? `${target.toUpperCase()} projection ready for review.`
        : `${target.toUpperCase()} projection has blocking model/profile issues.`)
    } catch {
      if (!isCurrent()) return
      toast.error(`Could not preview the ${target.toUpperCase()} projection.`)
    } finally { setBusy(false) }
  }

  const checkImpact = async () => {
    const bindings = state.analysisBindings ?? []
    if (!bindings.length) return
    const isCurrent = captureSharedSystemContext()
    setBusy(true)
    try {
      const result = await analyzeSystemImpact(model, bindings)
      if (!isCurrent()) return
      setImpactReport(result.bindings)
      setMessage(result.stale
        ? `${result.stale} linked analysis binding(s) require review.`
        : 'All linked analyses match their recorded canonical inputs.')
    } catch {
      if (!isCurrent()) return
      toast.error('Could not evaluate linked-analysis impact.')
    } finally { setBusy(false) }
  }

  const addMode = () => {
    const name = window.prompt('Operating mode name')?.trim()
    if (!name) return
    const id = uid('MODE')
    updateModel(current => ({ ...current, modes: [...current.modes, { id, name, description: '' }] }))
    setState(current => ({ ...current, selectedModeId: id }))
  }

  const removeMode = () => {
    if (!state.selectedModeId) return
    const id = state.selectedModeId
    const referenced = model.instances.some(item => item.mode_ids.includes(id)
      || item.function_overrides.some(value => value.mode_ids?.includes(id))
      || item.failure_mode_overrides.some(value => value.mode_ids?.includes(id)))
      || model.definitions.some(definition => definition.functions.some(item => item.mode_ids.includes(id))
        || definition.failure_modes.some(item => item.mode_ids.includes(id)))
      || model.interfaces.some(item => item.mode_ids.includes(id) || item.transfers?.some(transfer => transfer.mode_ids.includes(id)))
      || model.function_links.some(item => item.mode_ids.includes(id))
      || model.propagation_rules.some(item => item.mode_ids.includes(id))
    if (referenced) {
      toast.error('Remove this mode from blocks, functions, interfaces, and rules before deleting it.')
      return
    }
    updateModel(current => ({ ...current, modes: current.modes.filter(item => item.id !== id) }))
    setState(current => ({ ...current, selectedModeId: '' }))
  }

  const addInstanceOf = (definition: SystemBlockDefinition, parent?: SystemBlockInstance) => {
    parent ??= model.instances.find(item => item.id === model.root_instance_id)
    const instanceId = uid('INST')
    setState(current => ({
      ...current, selectedInstanceId: instanceId, propagation: null,
      structureCollapsedIds: parent
        ? (current.structureCollapsedIds ?? []).filter(id => id !== parent.id)
        : current.structureCollapsedIds ?? [],
      model: ensureMasterDiagramNodes(isolateInstalledOutputs({
        ...current.model,
        instances: [...current.model.instances, {
          id: instanceId, definition_id: definition.id, parent_instance_id: parent?.id,
          name: definition.name, quantity: 1, reference_designators: [], mode_ids: [],
          function_overrides: [], failure_mode_overrides: [], legacy_refs: [],
          origin: 'ad_hoc', definition_revision: definition.revision ?? current.model.revision,
          properties: {}, profile_overrides: [],
        }],
      }, [instanceId])),
    }))
  }

  const addBlock = (parent?: SystemBlockInstance) => {
    parent ??= model.instances.find(item => item.id === model.root_instance_id)
    const definitionId = uid('DEF')
    const instanceId = uid('INST')
    const createdDefinition: SystemBlockDefinition = {
      id: definitionId, name: 'New block', classification: 'assembly',
      kind: 'assembly', revision: 'A',
      description: '', part_number: '', manufacturer: '', category: '',
      properties: {}, analysis_profiles: [],
      ports: [
        { id: 'input', name: 'Input', interface_type: 'information', direction: 'input', description: '', properties: {} },
        { id: 'output', name: 'Output', interface_type: 'information', direction: 'output', description: '', properties: {} },
      ], functions: [], failure_modes: [], child_slots: [],
    }
    const createdInstance: SystemBlockInstance = {
      id: instanceId, definition_id: definitionId, parent_instance_id: parent?.id,
      name: 'New block', quantity: 1, reference_designators: [], mode_ids: [],
      function_overrides: [], failure_mode_overrides: [], legacy_refs: [],
      origin: 'ad_hoc', definition_revision: 'A', properties: {}, profile_overrides: [],
    }
    setState(current => ({
      ...current, selectedInstanceId: instanceId, propagation: null,
      structureCollapsedIds: parent
        ? (current.structureCollapsedIds ?? []).filter(id => id !== parent.id)
        : current.structureCollapsedIds ?? [],
      model: ensureMasterDiagramNodes({
        ...current.model,
        definitions: [...current.model.definitions, createdDefinition],
        instances: [...current.model.instances, createdInstance],
      }),
    }))
  }

  const removeSelected = () => {
    if (!selected) return
    if (selected.id === model.root_instance_id) { toast.error('The project root cannot be deleted.'); return }
    const hasChildren = model.instances.some(item => item.parent_instance_id === selected.id)
    const referenced = model.interfaces.some(item =>
      item.source.instance_id === selected.id || item.target.instance_id === selected.id)
      || model.function_links.some(item =>
        item.source.instance_id === selected.id || item.target.instance_id === selected.id)
      || model.propagation_rules.some(item =>
        item.source?.instance_id === selected.id || item.target?.instance_id === selected.id)
    const lastInstance = !model.instances.some(item =>
      item.id !== selected.id && item.definition_id === selected.definition_id)
    const composed = lastInstance && model.definitions.some(definition =>
      definition.child_slots.some(slot => slot.definition_id === selected.definition_id))
    if (hasChildren || referenced || composed) {
      toast.error('Remove or reassign child blocks, interfaces, functional references, and type slots before deleting this instance.')
      return
    }
    if (!window.confirm('Delete this shared system item from every Prediction scenario? Independent analysis references will remain visible as broken.')) return
    updateModel(current => ({
      ...current,
      instances: current.instances.filter(item => item.id !== selected.id),
      definitions: current.instances.some(item =>
        item.id !== selected.id && item.definition_id === selected.definition_id)
        ? current.definitions
        : current.definitions.filter(item => item.id !== selected.definition_id),
      diagrams: current.diagrams.map(diagram => ({ ...diagram,
        nodes: diagram.nodes.filter(item => item.instance_id !== selected.id) })),
    }))
    setState(current => ({
      ...current, selectedInstanceId: '',
      structureCollapsedIds: (current.structureCollapsedIds ?? []).filter(id => id !== selected.id),
    }))
  }

  const addFunction = () => {
    if (!selected || !selectedDefinition) return
    const id = uid('FN')
    updateModel(current => upsertInstalledFunction(current, selected.id, {
      id, description: '', function_type: 'primary', mode_ids: [],
      definition: { role: 'transform', action: '', io: [] },
    }))
    return id
  }

  const removeFunction = (functionId: string) => {
    if (!selectedDefinition) return
    const instanceIds = new Set(model.instances.filter(item =>
      item.definition_id === selectedDefinition.id).map(item => item.id))
    const referenced = selectedDefinition.failure_modes.some(item => item.function_id === functionId) || model.interfaces.some(item =>
      (item.source.instance_id && instanceIds.has(item.source.instance_id)
        && item.source_function_ids.includes(functionId))
      || (item.target.instance_id && instanceIds.has(item.target.instance_id)
        && item.target_function_ids.includes(functionId)))
      || model.function_links.some(item =>
        (instanceIds.has(item.source.instance_id) && item.source.function_id === functionId)
        || (instanceIds.has(item.target.instance_id) && item.target.function_id === functionId))
      || model.propagation_rules.some(item =>
        (item.source && instanceIds.has(item.source.instance_id) && item.source.function_id === functionId)
        || (item.target && instanceIds.has(item.target.instance_id) && item.target.function_id === functionId))
    if (referenced) {
      toast.error('Reassign failure modes, interface mappings, dependencies, and propagation rules before deleting this function.')
      return
    }
    updateDefinition(selectedDefinition.id, {
      functions: selectedDefinition.functions.filter(item => item.id !== functionId),
      failure_modes: selectedDefinition.failure_modes.filter(item => item.function_id !== functionId),
    })
  }

  const addPort = () => {
    if (!selectedDefinition) return
    updateDefinition(selectedDefinition.id, { ports: [...selectedDefinition.ports, {
      id: uid('PORT'), name: 'New port', interface_type: 'information',
      direction: 'bidirectional', description: '', properties: {},
    }] })
  }

  const removePort = (portId: string) => {
    if (!selectedDefinition) return
    const instanceIds = new Set(model.instances.filter(item =>
      item.definition_id === selectedDefinition.id).map(item => item.id))
    if (model.interfaces.some(item =>
      (item.source.instance_id && instanceIds.has(item.source.instance_id) && item.source.port_id === portId)
      || (item.target.instance_id && instanceIds.has(item.target.instance_id) && item.target.port_id === portId))) {
      toast.error('Reassign interfaces that use this port before deleting it.')
      return
    }
    updateDefinition(selectedDefinition.id, {
      ports: selectedDefinition.ports.filter(item => item.id !== portId),
    })
  }

  const addFailureMode = () => {
    if (!selectedDefinition?.functions.length) {
      toast.info('Add a function before defining its failure modes.')
      return
    }
    updateDefinition(selectedDefinition.id, { failure_modes: [...selectedDefinition.failure_modes, {
      id: uid('FM'), function_id: selectedDefinition.functions[0].id,
      description: `No ${selectedDefinition.functions[0].description}`,
      deviation_id: 'absent', mode_ids: [],
    }] })
  }

  const addFailureModeFor = (functionId: string) => {
    if (!selectedDefinition) return
    const fn = selectedDefinition.functions.find(item => item.id === functionId)
    if (!fn) return
    updateDefinition(selectedDefinition.id, { failure_modes: [...selectedDefinition.failure_modes, {
      id: uid('FM'), function_id: fn.id, description: `No ${fn.description}`,
      deviation_id: 'absent', mode_ids: [],
    }] })
  }

  const addExternal = () => updateModel(current => ({
    ...current, externals: [...current.externals, {
      id: uid('EXT'), name: 'External actor', kind: 'other', description: '', ports: [],
    }],
  }))

  const updateInterface = (interfaceId: string, patch: Partial<SystemInterface>) =>
    updateModel(current => ({ ...current, interfaces: current.interfaces.map(item =>
      item.id === interfaceId ? { ...item, ...patch } : item) }))

  const setInterfaceEndpoint = (interfaceId: string, side: 'source'|'target', value: string) => {
    const edge = model.interfaces.find(item => item.id === interfaceId)
    if (edge?.transfers?.length) { toast.error('Remove the resource pairings before changing a connected endpoint.'); return }
    const split = value.indexOf(':'), kind = value.slice(0, split), id = value.slice(split + 1)
    const endpoint: SystemEndpoint = kind === 'external' ? { external_id: id } : { instance_id: id }
    updateInterface(interfaceId, { [side]: endpoint })
  }

  const addInterface = () => {
    const source = visibleInterfaceInstances.find(item => item.id === selected?.id) ?? visibleInterfaceInstances[0]
    const target = visibleInterfaceInstances.find(item => item.id !== source?.id && item.parent_instance_id === source?.parent_instance_id)
      ?? visibleInterfaceInstances.find(item => item.id !== source?.id)
    if (!source || !target && !model.externals.length) {
      toast.info('Show two system blocks in the diagram, or define a typed external actor, before drawing an interface.'); return
    }
    updateModel(current => ({ ...current, interfaces: [...current.interfaces, {
      id: uid('IF'), name: 'New interface', interface_type: 'information',
      source: { instance_id: source.id }, target: target ? { instance_id: target.id } : { external_id: model.externals[0].id },
      directionality: 'directed', linkage: 'direct', interface_detail: '', strength: 'unknown', nature: 'unknown', properties: {},
      flow_description: '', operating_condition: '', source_function_ids: [], target_function_ids: [], mode_ids: [], transfers: [],
    }] }))
  }

  const addFunctionLink = () => {
    if (functionOptions.length < 2) {
      toast.info('Define at least two installed functions before linking them.')
      return
    }
    updateModel(current => ({ ...current, function_links: [...current.function_links, {
      id: uid('FL'), source: (functionOptions.find(item => item.ref.instance_id === selected?.id) ?? functionOptions[0]).ref,
      target: (functionOptions.find(item => item.ref.instance_id !== selected?.id) ?? functionOptions[1]).ref,
      relationship: 'depends_on', rationale: '', mode_ids: [],
    }] }))
  }

  const addPropagationRule = () => updateModel(current => ({
    ...current, propagation_rules: [...current.propagation_rules, {
      id: uid('RULE'), action: 'pass_through',
      interface_id: current.interfaces.find(edge => edge.source.instance_id === selected?.id || edge.target.instance_id === selected?.id)?.id,
      source: functionOptions.find(item => item.ref.instance_id === selected?.id)?.ref,
      result_description: '', mode_ids: [], rationale: '',
    }],
  }))

  const runPropagation = async () => {
    const isCurrent = captureSharedSystemContext()
    setBusy(true); setMessage('')
    try {
      const validation = await validateSystemDefinition(model)
      if (!isCurrent()) return
      if (!validation.valid) {
        setMessage(`${validation.issues.filter(item => item.severity === 'error').length} model error(s) must be resolved.`)
      }
      const result = await propagateSystemDefinition(model, {
        mode_id: state.selectedModeId || undefined,
      })
      if (!isCurrent()) return
      setState(current => ({ ...current, propagation: result }))
      setMessage(result.valid
        ? `Generated ${result.paths.length} trace path(s) and ${result.proposals.length} review proposal(s).`
        : 'Propagation stopped because the model is invalid.')
    } catch (error) {
      if (!isCurrent()) return
      setMessage((error as { response?: { data?: { detail?: string } } }).response?.data?.detail
        ?? 'Could not build the fault map.')
    } finally { setBusy(false) }
  }

  const decide = (proposalIds: string[], status: 'accepted'|'rejected') => {
    if (!state.propagation) return
    const accepted = state.propagation.proposals.flatMap(proposal => {
      if (status !== 'accepted' || !proposalIds.includes(proposal.id)
          || !proposal.source_failure_mode_id || !proposal.source_node_id
          || !proposal.target_node_id || !proposal.result_deviation_id
          || typeof proposal.transition.id !== 'string') return []
      return [{
        id: `ASSERT-${proposal.id}`, source_failure_mode_id: proposal.source_failure_mode_id,
        source_node_id: proposal.source_node_id, target_node_id: proposal.target_node_id,
        transition_id: proposal.transition.id, result_deviation_id: proposal.result_deviation_id,
        status: 'accepted' as const, rationale: proposal.explanation,
        evidence_refs: [], mode_ids: state.selectedModeId ? [state.selectedModeId] : [],
        source_fingerprint: state.propagation!.fingerprint,
      }]
    })
    setState(current => ({
      ...current,
      decisions: [
        ...current.decisions.filter(item => !proposalIds.includes(item.proposal_id)),
        ...proposalIds.map(proposal_id => ({
          proposal_id, fingerprint: state.propagation!.fingerprint,
          status, decided_at: new Date().toISOString(),
        })),
      ],
      model: {
        ...current.model,
        propagation_assertions: [
          ...(current.model.propagation_assertions ?? []).filter(item =>
            !proposalIds.includes(item.id.replace(/^ASSERT-/, ''))),
          ...accepted,
        ],
      },
    }))
  }

  const generateStarter = async (target: 'rbd'|'fta'|'markov') => {
    if (!state.propagation || !acceptedPaths.length) {
      toast.info('Accept at least one complete fault path first.')
      return
    }
    const isCurrent = captureSharedSystemContext()
    setBusy(true)
    try {
      const result = await generateSystemStarter(model, target, {
        mode_id: state.selectedModeId || undefined,
        selected_path_ids: acceptedPaths.map(item => item.id),
      })
      if (!isCurrent()) return
      const setter = target === 'rbd' ? setRbd : target === 'fta' ? setFta : setMarkov
      setter((raw: unknown) => activeFolioUpdate(raw, current => ({
        ...current, pendingSystemStarter: result,
      })))
      toast.success(`${target.toUpperCase()} starter sent for review.`)
    } catch {
      if (!isCurrent()) return
      toast.error(`Could not generate the ${target.toUpperCase()} starter.`)
    } finally { setBusy(false) }
  }

  const handoffFmea = () => {
    if (!model.instances.length) return
    const acceptedEdgeIds = new Set(acceptedPaths.flatMap(item => item.edge_ids))
    const edges = (state.propagation?.edges ?? []).filter(item => acceptedEdgeIds.has(item.id))
    const nodes = new Map((state.propagation?.nodes ?? []).map(item => [item.id, item]))
    setFmea((raw: unknown) => activeFolioUpdate(raw, current => {
      const analyses = Array.isArray(current.analyses)
        ? current.analyses as AIAGVDAFMEAAnalysis[] : []
      const existing = analyses.find(item => item.id === current.activeId && item.kind !== 'pfmea')
        ?? analyses.find(item => item.kind === 'dfmea')
      const created = existing ?? { ...createFmeaAnalysis('dfmea', analyses.length + 1),
        name: `${model.name} — System FMEA` }
      const analysis = bindFmeaAnalysis(model, created)
      const functions = analysis.functions
      const functionLinks = [...analysis.function_links]
      const chains = [...analysis.failure_chains]
      const functionFor = (instanceId: string, functionId: string) => functions.find(item =>
        item.system_definition_ref?.instance_id === instanceId
        && item.system_definition_ref?.function_id === functionId)?.id
        ?? `SD-FN-${instanceId}-${functionId}`
      for (const edge of edges) {
        if (chains.some(item => item.system_definition_edge_id === edge.id)) continue
        const source = nodes.get(edge.source)
        const target = nodes.get(edge.target)
        if (!source || !target) continue
        if (!functionLinks.some(item => item.id === `SD-LINK-${edge.id}`)) functionLinks.push({
          id: `SD-LINK-${edge.id}`,
          source_function_id: functionFor(source.function.instance_id, source.function.id),
          target_function_id: functionFor(target.function.instance_id, target.function.id),
          relationship: edge.transition.kind === 'function_link'
            ? (edge.transition.relationship as 'depends_on') ?? 'depends_on' : 'provides_input',
          label: String(edge.transition.id ?? ''),
          rationale: `Accepted System Definition propagation edge ${edge.id}`,
        })
        chains.push({
          id: `SD-FC-${edge.id}`, function_id: functionFor(source.function.instance_id, source.function.id),
          effect: target.description, failure_mode: source.description,
          deviation_id: source.deviation_id,
          cause: '', effect_level: 'downstream function', effect_contexts: [],
          severity: 5, occurrence: 5, detection: 5,
          prevention_controls: '', detection_controls: '', severity_rationale: '',
          occurrence_rationale: '', detection_rationale: '', frequency_rationale: '', monitoring_rationale: '',
          actions: [], no_action_justification: '', post_severity_rationale: '',
          linked_hazard_ids: [], linked_fracas_ids: [], monitoring_system: '',
          system_response: '', safe_state: '', mitigated_effect: '',
          management_review_status: '', management_review_evidence_ids: [],
          remarks: 'Generated from an accepted System Definition path; review all placeholder ratings.',
          system_definition_edge_id: edge.id,
        })
      }
      const linked = { ...analysis, function_links: functionLinks, failure_chains: chains }
      return { ...current, activeId: linked.id,
        analyses: existing ? analyses.map(item => item.id === linked.id ? linked : item) : [...analyses, linked],
        result: null }
    }))
    toast.success(acceptedPaths.length
      ? 'FMEA linked to the project System Model. Accepted propagation paths retained for review.'
      : 'FMEA now uses the project System Model. Ratings and actions remain with the study.')
  }

  const applyProjectionPreview = () => {
    const preview = state.projectionPreview
    if (!preview?.valid) {
      toast.error('Resolve the blocking model or profile issues before applying this projection.')
      return
    }
    const target = preview.target
    const targetModule = target === 'prediction' ? predictionModule
      : target === 'rbd' ? rbdModule : target === 'fmea' ? fmeaModule
        : target === 'fta' ? ftaModule : markovModule
    const targetAnalysisId = activeAnalysisId(targetModule)
    if (target === 'prediction') {
      toast.info('Prediction scenarios already use the shared system. Select model profiles and overrides in Prediction.')
      return
    } else if (target === 'fmea') {
      handoffFmea()
    } else {
      const setter = target === 'rbd' ? setRbd : target === 'fta' ? setFta : setMarkov
      setter((raw: unknown) => activeFolioUpdate(raw, current => ({
        ...current,
        pendingSystemStarter: {
          valid: true, target, source_fingerprint: preview.binding.source_fingerprint,
          selected_path_ids: acceptedPaths.map(item => item.id),
          draft: preview.projection, issues: preview.issues,
        },
      })))
    }
    setState(current => ({
      ...current,
      analysisBindings: [
        ...(current.analysisBindings ?? []).filter(item => item.id !== preview.binding.id),
        { ...preview.binding, analysis_id: targetAnalysisId },
      ],
      projectionPreview: null,
    }))
    toast.success(`${target.toUpperCase()} linked projection applied. Canonical fields remain System Definition-owned.`)
  }

  return <div className="flex h-full min-h-0 flex-col bg-white">
    <div className="border-b px-4 py-3 text-sm font-semibold">{model.name} · Shared project system</div>
    <div className="flex flex-wrap items-center gap-1 border-b bg-slate-50 px-3 py-1.5">
      {([
        ['structure', 'Structure', TableProperties],
        ['architecture', 'Interfaces', Layers3],
        ['functions', 'Functions & Failures', Box],
        ['requirements', 'Requirements & Verification', ClipboardCheck],
        ['fault-map', 'Fault Propagation', GitBranch],
        ['integrations', 'Analyses & Impact', Send],
      ] as const).map(([id, label, Icon]) => <button key={id} type="button"
        onClick={() => setState(current => ({ ...current, view: id }))}
        className={`flex items-center gap-1 rounded px-2.5 py-1.5 text-xs ${state.view === id
          ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-200'}`}>
        <Icon size={13} /> {label}
      </button>)}
      <div className="ml-auto flex items-center gap-2">
        <label className="text-[10px] text-slate-500">Operating mode</label>
        <select aria-label="Operating mode" value={state.selectedModeId} onChange={event =>
          setState(current => ({ ...current, selectedModeId: event.target.value, propagation: null }))}
          className="rounded border px-2 py-1 text-xs">
          <option value="">All modes</option>
          {model.modes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <button type="button" onClick={addMode} title="Add operating mode" className="perdura-icon-button text-blue-700"><Plus size={14} /></button>
        <button type="button" onClick={removeMode} disabled={!state.selectedModeId}
          title="Delete selected operating mode" className="perdura-icon-button text-slate-600 disabled:opacity-30"><Trash2 size={13} /></button>
      </div>
    </div>

    {state.view === 'structure' && <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_340px]">
      <main className="overflow-auto p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div><h2 className="text-sm font-semibold text-slate-800">System structure</h2>
            <p className="mt-0.5 text-xs text-slate-500">{editStructure
              ? 'Move or reorder blocks. Children move with their parent.'
              : 'Select Edit structure to move or reorder blocks.'}</p></div>
          <div className="flex flex-wrap justify-end gap-2">
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={showPieceParts} onChange={event => setShowPieceParts(event.target.checked)} /> Show piece parts</label>
            <button type="button" onClick={() => setEditStructure(value => !value)} aria-pressed={editStructure}
              className={`${buttonClass} ${editStructure ? 'border-blue-400 bg-blue-50 text-blue-800' : ''}`}>
              {editStructure ? <Check size={12} /> : <TableProperties size={12} />}
              {editStructure ? 'Done editing structure' : 'Edit structure'}
            </button>
            <button type="button" onClick={() => addBlock(undefined)} className={buttonClass}><Plus size={12} /> Root assembly</button>
            <button type="button" onClick={() => addBlock(selected)} disabled={!selected || selectedDefinition?.kind === 'piece_part'} className={buttonClass}><Plus size={12} /> Child</button>
            <button type="button" onClick={removeSelected} disabled={!selected} aria-label="Delete selected system element" className={buttonClass}><Trash2 size={12} /></button>
          </div>
        </div>
        <StructureTable model={model} showPieceParts={showPieceParts} editing={editStructure} selectedId={selected?.id ?? ''}
          collapsedIds={structureCollapsedIds}
          onSelect={selectedInstanceId => setState(current => ({ ...current, selectedInstanceId }))}
          onToggle={instanceId => setState(current => ({
            ...current,
            structureCollapsedIds: (current.structureCollapsedIds ?? []).includes(instanceId)
              ? current.structureCollapsedIds.filter(id => id !== instanceId)
              : [...(current.structureCollapsedIds ?? []), instanceId],
          }))}
          onChangeParent={changeParent} onMove={moveSibling} />
      </main>
      <aside className="overflow-auto border-l p-4">
        <h3 className="text-xs font-semibold text-slate-700">Definition & analysis data</h3>
        {selected && selectedDefinition ? <div className="mt-3 space-y-3">
          <label className="block text-[10px] text-slate-500">Installed name<input
            value={selected.name} onChange={event => updateModel(current => ({ ...current,
              instances: current.instances.map(item => item.id === selected.id
                ? { ...item, name: event.target.value } : item),
            }))} className={`mt-1 ${fieldClass}`} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] text-slate-500">Block kind<select
              disabled={selected.id === model.root_instance_id} value={selectedDefinition.kind ?? 'component'} onChange={event => {
                const kind = event.target.value as NonNullable<SystemBlockDefinition['kind']>
                updateDefinition(selectedDefinition.id, {
                  kind, classification: kind === 'piece_part' ? 'part' : kind,
                })
              }} className={`mt-1 ${fieldClass}`}>
              {['system', 'subsystem', 'assembly', 'component', 'piece_part'].map(value =>
                <option key={value} value={value}>{typeLabel(value)}</option>)}
            </select></label>
            <label className="text-[10px] text-slate-500">Quantity<input type="number" min={1}
              disabled={selected.id === model.root_instance_id} value={selected.quantity} onChange={event => updateModel(current => ({ ...current,
                instances: current.instances.map(item => item.id === selected.id
                  ? { ...item, quantity: Math.max(1, Number(event.target.value) || 1) } : item),
              }))} className={`mt-1 ${fieldClass}`} /></label>
          </div>
          <label className="block text-[10px] text-slate-500">Definition name<input
            value={selectedDefinition.name} onChange={event => updateDefinition(selectedDefinition.id, { name: event.target.value })}
            className={`mt-1 ${fieldClass}`} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] text-slate-500">Part number<input value={selectedDefinition.part_number}
              onChange={event => updateDefinition(selectedDefinition.id, { part_number: event.target.value })}
              className={`mt-1 ${fieldClass}`} /></label>
            <label className="text-[10px] text-slate-500">Revision<input value={selectedDefinition.revision ?? 'A'}
              onChange={event => updateDefinition(selectedDefinition.id, { revision: event.target.value })}
              className={`mt-1 ${fieldClass}`} /></label>
          </div>
          <label className="block text-[10px] text-slate-500">Manufacturer<input value={selectedDefinition.manufacturer}
            onChange={event => updateDefinition(selectedDefinition.id, { manufacturer: event.target.value })}
            className={`mt-1 ${fieldClass}`} /></label>
          <label className="block text-[10px] text-slate-500">Description<textarea value={selectedDefinition.description}
            onChange={event => updateDefinition(selectedDefinition.id, { description: event.target.value })}
            className={`mt-1 min-h-16 ${fieldClass}`} /></label>
          <section className="border-t pt-3">
            <div className="flex items-center justify-between"><div>
              <div className="text-[10px] font-semibold uppercase text-slate-500">Analysis profiles</div>
              <div className="text-[9px] text-slate-400">Definition values; instances and analyses may override them.</div>
            </div><div className="flex gap-1">
              <button type="button" onClick={() => addProfile('prediction')} title="Add Prediction profile" className="rounded border px-1.5 py-1 text-[9px] text-blue-700">+ Prediction</button>
              <button type="button" onClick={() => addProfile('reliability')} title="Add reliability profile" className="rounded border px-1.5 py-1 text-[9px] text-blue-700">+ Reliability</button>
            </div></div>
            <div className="mt-2 space-y-2">{(selectedDefinition.analysis_profiles ?? []).map(profile =>
              <div key={profile.id} className="rounded border bg-slate-50 p-2">
                <div className="grid grid-cols-[1fr_82px_20px] gap-1">
                  <input value={profile.name} onChange={event => updateProfile(profile.id, { name: event.target.value })} className={fieldClass} />
                  <select value={profile.status} onChange={event => updateProfile(profile.id, { status: event.target.value as SystemAnalysisProfile['status'] })} className={fieldClass}>
                    <option value="draft">Draft</option><option value="reviewed">Reviewed</option>
                  </select>
                  <button type="button" onClick={() => updateDefinition(selectedDefinition.id, {
                    analysis_profiles: (selectedDefinition.analysis_profiles ?? []).filter(item => item.id !== profile.id),
                  })}><X size={12} /></button>
                </div>
                <select value={profile.adapter_id} onChange={event => selectProfileAdapter(profile, event.target.value)}
                  className={`mt-1 ${fieldClass}`}>
                  {profile.domain === 'prediction' ? <>
                    <option value="prediction.mil-hdbk-217f">MIL-HDBK-217F</option>
                    <option value="prediction.telcordia-sr332">Telcordia SR-332</option>
                    <option value="prediction.217plus">217Plus</option>
                    <option value="prediction.fides">FIDES</option>
                    <option value="prediction.nswc-98-le1">NSWC-98/LE1</option>
                  </> : <>
                    <option value="reliability.constant-hazard">Constant hazard</option>
                    <option value="reliability.distribution">Lifetime distribution</option>
                    <option value="reliability.analysis-reference">Analysis reference</option>
                  </>}
                </select>
                {Object.entries(profile.values).map(([key, value]) => <div key={key} className="mt-1 grid grid-cols-[92px_1fr_70px] gap-1">
                  <span className="truncate pt-1.5 text-[9px] text-slate-500">{typeLabel(key)}</span>
                  {value.kind === 'choice' && value.option_ids.length
                    ? <select value={value.value} onChange={event => updateProfileParameter(profile, key, event.target.value)} className={fieldClass}>
                      {value.option_ids.map(option => <option key={option} value={option}>{key === 'distribution' ? distributionLabel(option) : typeLabel(option)}</option>)}
                    </select>
                    : <input type={value.kind === 'number' ? 'number' : 'text'} value={String(value.value)}
                      onChange={event => updateProfileParameter(profile, key, event.target.value)} className={fieldClass} />}
                  <span className="pt-1.5 text-[9px] text-slate-400">{value.kind === 'number' ? value.unit : value.kind}</span>
                </div>)}
                <button type="button" onClick={() => addProfileParameter(profile)}
                  className="mt-1 text-[9px] font-medium text-blue-700">+ Parameter</button>
              </div>)}
            </div>
          </section>
          <section className="border-t pt-3">
            <div className="text-[10px] font-semibold uppercase text-slate-500">Reusable composition</div>
            <p className="mt-1 text-[9px] text-slate-400">Review changes between this installed subtree and its reusable child slots.</p>
            <div className="mt-2 flex flex-wrap gap-1">
              <button type="button" onClick={captureChildSlots} className={buttonClass}><Layers3 size={11} /> Capture children</button>
              <button type="button" onClick={reviewComposition} disabled={busy} className={buttonClass}><RefreshCw size={11} /> Review updates</button>
            </div>
            {compositionPlan && <div className="mt-2">
              <pre className="max-h-36 overflow-auto rounded bg-slate-900 p-2 text-[9px] text-slate-100">{JSON.stringify(compositionPlan.summary ?? compositionPlan, null, 2)}</pre>
              <button type="button" onClick={applyCompositionPlan}
                disabled={!Array.isArray(compositionPlan.proposals) || !compositionPlan.proposals.length}
                className={`mt-1 ${buttonClass}`}><Check size={11} /> Apply reviewed plan</button>
            </div>}
          </section>
        </div> : <p className="mt-3 text-xs text-slate-400">Select a block to edit.</p>}
      </aside>
    </div>}

    {state.view === 'architecture' && <div className="relative flex min-h-0 flex-1 flex-col p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs text-slate-500">Select a block or connection to inspect it.</p>
        <button id="system-model-tools-toggle" type="button" className={buttonClass}
          aria-expanded={modelToolsOpen} aria-controls="system-model-tools"
          onClick={() => setModelToolsOpen(value => !value)}>
          {modelToolsOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
          {modelToolsOpen ? 'Close model tools' : 'Edit system model'}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden"><SystemBlockDiagramCanvas model={model} selectedInstanceId={selected?.id}
        interfaceSelectionRequest={interfaceSelectionRequest}
        selectionRequest={diagramSelectionRequest?.instanceId === selected?.id ? diagramSelectionRequest : undefined}
        onSelectInstance={selectedInstanceId => setState(current => ({ ...current, selectedInstanceId }))}
        libraryContent={<div className="mb-3 border-b pb-3">
          <div className="mb-2 text-xs font-semibold text-slate-700">Installed hierarchy</div>
          <div className="mb-2 flex flex-wrap gap-1" role="group" aria-label="Hierarchy visibility">
            {([['show', 'Show all'], ['hide', 'Hide all'], ['invert', 'Invert']] as const).map(([action, label]) =>
              <button key={action} type="button" className={buttonClass}
                onClick={() => updateModel(current => setDiagramVisibility(current, action))}>{label}</button>)}
          </div>
          <HierarchyTree model={model} selectedId={selected?.id ?? ''} hidePieceParts label="Installed hierarchy"
            onVisibilityChange={(id, visible) => updateModel(current => setDiagramBranchVisibility(current, id, visible))}
            onSelect={selectedInstanceId => {
              setState(current => ({ ...current,selectedInstanceId }))
              setDiagramSelectionRequest(current => ({ instanceId:selectedInstanceId,requestId:(current?.requestId ?? 0)+1 }))
            }} />
        </div>}
        structureInspector={instanceId => {
          const instance = model.instances.find(item => item.id === instanceId)
          const definition = model.definitions.find(item => item.id === instance?.definition_id)
          return instance && definition ? <div className="space-y-2">
            <label className="block text-xs text-slate-600">Installed name<input value={instance.name}
              onChange={event => updateModel(current => ({ ...current, instances: current.instances.map(item =>
                item.id === instanceId ? { ...item, name: event.target.value } : item) }))}
              className={`mt-1 ${fieldClass}`} /></label>
            <p className="text-xs text-slate-500">{definition.name} · {typeLabel(definition.kind ?? definition.classification)}</p>
            <div className="space-y-1 border-t pt-2"><h3 className="text-xs font-semibold">Boundary interfaces</h3>
              {model.interfaces.filter(edge => (edge.source.instance_id === instanceId || edge.target.instance_id === instanceId || interfaceBoundaryInstances(model.instances, edge.source.instance_id, edge.target.instance_id).has(instanceId))).map(edge =>
                <div key={edge.id} className="rounded border p-2 text-xs"><strong>{edge.flow_description || edge.name || typeLabel(edge.interface_type)}</strong>
                  <p className="text-slate-500">{model.instances.find(item => item.id === edge.source.instance_id)?.name || model.externals.find(item => item.id === edge.source.external_id)?.name || 'Unspecified'} → {model.instances.find(item => item.id === edge.target.instance_id)?.name || model.externals.find(item => item.id === edge.target.external_id)?.name || 'Unspecified'}</p>
                  {edge.source.instance_id !== instanceId && edge.target.instance_id !== instanceId && <span className="text-blue-700">Inherited from a child endpoint</span>}
                </div>)}
            </div>
            <button type="button" className={buttonClass} onClick={() => {
              setState(current => ({ ...current, selectedInstanceId: instanceId })); setModelToolsOpen(true)
            }}>Edit definition and ports</button>
            <button type="button" className={buttonClass} onClick={() => setState(current => ({ ...current, view: 'functions', selectedInstanceId: instanceId }))}>Define functions and parent support</button>
          </div> : null
        }}
        interfaceInspector={interfaceId => <SystemInterfaceTransferEditor model={model} interfaceId={interfaceId}
          onChange={next => updateModel(() => next)} />}
        onChange={nextModel => updateModel(() => nextModel)} /></div>
      {modelToolsOpen && <div className="absolute inset-0 z-30 flex justify-end bg-slate-900/15"
        onPointerDown={event => { if (event.target === event.currentTarget) setModelToolsOpen(false) }}>
        <section id="system-model-tools" role="dialog" aria-label="System model tools"
          onKeyDown={event => { if (event.key === 'Escape') {
            setModelToolsOpen(false); document.getElementById('system-model-tools-toggle')?.focus()
          } }} className="flex h-full w-[min(760px,100%)] flex-col border-l bg-white shadow-xl">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div><h3 className="text-sm font-semibold">Edit shared system model</h3>
              <p className="text-xs text-slate-500">Changes apply to all instances and linked analyses.</p></div>
            <button type="button" autoFocus aria-label="Close model tools" className={buttonClass}
              onClick={() => { setModelToolsOpen(false); document.getElementById('system-model-tools-toggle')?.focus() }}><X size={16} /></button>
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(180px,1fr)_minmax(260px,1.5fr)]">
            <aside className="overflow-auto border-r p-2">
        <div className="mt-3 flex gap-1">
          <button type="button" onClick={() => addBlock(selected)} disabled={selectedDefinition?.kind === 'piece_part'} className={buttonClass}><Plus size={12} /> {selected ? 'Add child' : 'Add block'}</button>
          <button type="button" onClick={removeSelected} disabled={!selected} aria-label="Delete selected system element" className={buttonClass}><Trash2 size={12} /></button>
        </div>
        <div className="mt-5 border-t pt-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Reusable type library</div>
          <p className="mb-2 text-[10px] text-slate-400">Add an instance under the selected block.</p>
          <div className="space-y-1">
            {model.definitions.map(definition => <div key={definition.id} className="flex items-center gap-1 rounded border px-2 py-1">
              <div className="min-w-0 flex-1"><div className="truncate text-[10px] font-medium">{definition.name}</div>
                <div className="text-[9px] text-slate-400">{definition.classification} · {model.instances.filter(item => item.definition_id === definition.id).length} installed</div></div>
              <button type="button" onClick={() => addInstanceOf(definition, selected)} title="Install this type"
                className="text-blue-600"><Plus size={12} /></button>
            </div>)}
          </div>
        </div>
        <div className="mt-5 border-t pt-3">
          <div className="mb-2 flex items-center justify-between"><span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">External actors</span>
            <button type="button" onClick={addExternal} title="Add external actor" className="text-blue-600"><Plus size={13} /></button></div>
          {model.externals.map(external => <div key={external.id} className="mb-1 flex items-center gap-1 rounded border p-1">
            <input value={external.name} onChange={event => updateModel(current => ({ ...current,
              externals: current.externals.map(item => item.id === external.id ? { ...item, name: event.target.value } : item) }))}
              className="min-w-0 flex-1 px-1 text-[10px] outline-hidden" />
            <select value={external.kind} onChange={event => updateModel(current => ({ ...current,
              externals: current.externals.map(item => item.id === external.id
                ? { ...item, kind: event.target.value as typeof external.kind } : item) }))}
              className="w-20 border-l text-[9px]">
              {['adjacent_system', 'person', 'environment', 'other'].map(value => <option key={value} value={value}>{typeLabel(value)}</option>)}
            </select>
            <button type="button" onClick={() => {
              if (model.interfaces.some(item => item.source.external_id === external.id || item.target.external_id === external.id)) {
                toast.error('Remove interfaces to this actor before deleting it.'); return
              }
              updateModel(current => ({ ...current, externals: current.externals.filter(item => item.id !== external.id) }))
            }}><X size={11} /></button>
          </div>)}
        </div>
      </aside>
<aside id="system-block-inspector" aria-label="Block inspector" className="min-w-0 overflow-auto border-l p-3">
        <h3 className="mb-3 text-xs font-semibold text-slate-700">Block inspector</h3>
        {selected && selectedDefinition ? <div className="space-y-3">
          <label className="block text-[10px] text-slate-500">Installed name<input
            value={selected.name} onChange={event => updateModel(current => ({ ...current,
              instances: current.instances.map(item => item.id === selected.id
                ? { ...item, name: event.target.value } : item) }))} className={`mt-1 ${fieldClass}`} /></label>
          <label className="block text-[10px] text-slate-500">Definition name<input
            value={selectedDefinition.name} onChange={event => updateDefinition(selectedDefinition.id, { name: event.target.value })}
            className={`mt-1 ${fieldClass}`} /></label>
          <label className="block text-[10px] text-slate-500">Block kind<select
            disabled={selected.id === model.root_instance_id} value={selectedDefinition.kind ?? 'component'} onChange={event => {
              const kind = event.target.value as NonNullable<SystemBlockDefinition['kind']>
              updateDefinition(selectedDefinition.id, {
                kind, classification: kind === 'piece_part' ? 'part' : kind,
              })
            }} className={`mt-1 ${fieldClass}`}>
            {['system', 'subsystem', 'assembly', 'component', 'piece_part'].map(value =>
              <option key={value} value={value}>{typeLabel(value)}</option>)}
          </select></label>
          <label className="block text-[10px] text-slate-500">Description<textarea
            value={selectedDefinition.description} onChange={event => updateDefinition(selectedDefinition.id, { description: event.target.value })}
            className={`mt-1 min-h-20 ${fieldClass}`} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] text-slate-500">Quantity<input type="number" min={1}
              disabled={selected.id === model.root_instance_id} value={selected.quantity} onChange={event => updateModel(current => ({ ...current,
                instances: current.instances.map(item => item.id === selected.id
                  ? { ...item, quantity: Math.max(1, Number(event.target.value) || 1) } : item) }))}
              className={`mt-1 ${fieldClass}`} /></label>
            <label className="text-[10px] text-slate-500">Part number<input
              value={selectedDefinition.part_number} onChange={event => updateDefinition(selectedDefinition.id, { part_number: event.target.value })}
              className={`mt-1 ${fieldClass}`} /></label>
          </div>
          <div className="rounded border p-2">
            <div className="mb-2 flex items-center justify-between"><span className="text-[10px] font-medium text-slate-600">Definition ports</span>
              <button type="button" onClick={addPort} title="Add port" className="text-blue-600"><Plus size={12} /></button></div>
            <div className="space-y-1.5">{selectedDefinition.ports.map(port => <div key={port.id}
              className="grid grid-cols-[1fr_92px_88px_18px] gap-1">
              <input value={port.name} onChange={event => updateDefinition(selectedDefinition.id, {
                ports: selectedDefinition.ports.map(item => item.id === port.id ? { ...item, name: event.target.value } : item),
              })} className={fieldClass} />
              <select value={port.interface_type} onChange={event => updateDefinition(selectedDefinition.id, {
                ports: selectedDefinition.ports.map(item => item.id === port.id
                  ? { ...item, interface_type: event.target.value as SystemInterfaceType } : item),
              })} className={fieldClass}>{['physical', 'energy', 'information', 'material', 'human_machine', 'clearance'].map(value =>
                <option key={value} value={value}>{typeLabel(value)}</option>)}</select>
              <select value={port.direction} onChange={event => updateDefinition(selectedDefinition.id, {
                ports: selectedDefinition.ports.map(item => item.id === port.id
                  ? { ...item, direction: event.target.value as typeof port.direction } : item),
              })} className={fieldClass}>{['input', 'output', 'bidirectional'].map(value =>
                <option key={value} value={value}>{typeLabel(value)}</option>)}</select>
              <button type="button" onClick={() => removePort(port.id)}><X size={11} /></button>
            </div>)}</div>
          </div>
          <div><div className="mb-1 text-[10px] text-slate-500">Block mode applicability</div>
            <ModePicker model={model} value={selected.mode_ids} onChange={mode_ids => updateModel(current => ({ ...current,
              instances: current.instances.map(item => item.id === selected.id ? { ...item, mode_ids } : item),
            }))} /></div>
          <button type="button" onClick={addInterface}
            disabled={!model.instances.length || (model.instances.length < 2 && !model.externals.length)}
            className={buttonClass}><Link2 size={12} /> Add interface</button>
        </div> : <p className="text-xs text-slate-400">Select or add a block.</p>}
        <div className="mt-5 border-t pt-3">
          <div className="mb-2 text-[10px] font-semibold uppercase text-slate-500">Selected block interfaces</div>
          {!selected && <p className="text-xs text-slate-400">Select a block to inspect its interfaces.</p>}
          {selected && !model.interfaces.some(item => (item.source.instance_id === selected.id || item.target.instance_id === selected.id || interfaceBoundaryInstances(model.instances, item.source.instance_id, item.target.instance_id).has(selected.id)))
            && <p className="text-xs text-slate-400">This block has no interfaces.</p>}
          {model.interfaces.filter(item => selected && (item.source.instance_id === selected.id || item.target.instance_id === selected.id || interfaceBoundaryInstances(model.instances, item.source.instance_id, item.target.instance_id).has(selected.id))).map(item => {
            const sourceInstance = model.instances.find(value => value.id === item.source.instance_id)
            const targetInstance = model.instances.find(value => value.id === item.target.instance_id)
            const sourceDefinition = model.definitions.find(value => value.id === sourceInstance?.definition_id)
            const targetDefinition = model.definitions.find(value => value.id === targetInstance?.definition_id)
            return <div key={item.id} className="mb-3 space-y-2 rounded border p-2 text-[10px]">
              {selected && item.source.instance_id !== selected.id && item.target.instance_id !== selected.id && <p className="text-xs text-blue-700">Inherited boundary interface · {sourceInstance?.name || 'External'} → {targetInstance?.name || 'External'}</p>}
              <div className="flex gap-1"><input aria-label="Interface name" value={item.name} onChange={event => updateInterface(item.id, { name: event.target.value })}
                className={fieldClass} />
                <button type="button" title="Delete interface" onClick={() => updateModel(current => ({ ...disconnectInterface(current, item.id),
                  propagation_rules: current.propagation_rules.map(rule => rule.interface_id === item.id
                    ? { ...rule, interface_id: undefined } : rule),
                }))}><X size={12} /></button></div>
              <div className="grid grid-cols-2 gap-1">
                <label className="text-[9px] text-slate-500">Source<select disabled={Boolean(item.transfers?.length)} value={endpointKey(item.source)}
                  onChange={event => setInterfaceEndpoint(item.id, 'source', event.target.value)} className={`mt-0.5 ${fieldClass}`}>
                  {model.instances.filter(value => value.id === item.source.instance_id || visibleInterfaceInstances.some(candidate => candidate.id === value.id)).map(value => <option key={`si-${value.id}`} value={`instance:${value.id}`}>{instanceLabel(model, value)}</option>)}
                  {model.externals.map(value => <option key={`se-${value.id}`} value={`external:${value.id}`}>External: {value.name}</option>)}
                </select></label>
                <label className="text-[9px] text-slate-500">Target<select disabled={Boolean(item.transfers?.length)} value={endpointKey(item.target)}
                  onChange={event => setInterfaceEndpoint(item.id, 'target', event.target.value)} className={`mt-0.5 ${fieldClass}`}>
                  {model.instances.filter(value => value.id === item.target.instance_id || visibleInterfaceInstances.some(candidate => candidate.id === value.id)).map(value => <option key={`ti-${value.id}`} value={`instance:${value.id}`}>{instanceLabel(model, value)}</option>)}
                  {model.externals.map(value => <option key={`te-${value.id}`} value={`external:${value.id}`}>External: {value.name}</option>)}
                </select></label>
              </div>
              {(sourceDefinition || targetDefinition) && <div className="grid grid-cols-2 gap-1">
                <label className="text-[9px] text-slate-500">Source port<select disabled={!sourceDefinition || Boolean(item.transfers?.length)}
                  value={item.source.port_id ?? ''} onChange={event => updateInterface(item.id, {
                    source: { ...item.source, port_id: event.target.value },
                  })} className={`mt-0.5 ${fieldClass}`}>
                  {sourceDefinition?.ports.map(port => <option key={port.id} value={port.id}>{port.name}</option>)}
                </select></label>
                <label className="text-[9px] text-slate-500">Target port<select disabled={!targetDefinition || Boolean(item.transfers?.length)}
                  value={item.target.port_id ?? ''} onChange={event => updateInterface(item.id, {
                    target: { ...item.target, port_id: event.target.value },
                  })} className={`mt-0.5 ${fieldClass}`}>
                  {targetDefinition?.ports.map(port => <option key={port.id} value={port.id}>{port.name}</option>)}
                </select></label>
              </div>}
              <div>
                <select value={item.linkage} onChange={event => updateInterface(item.id, {
                  linkage: event.target.value as SystemInterface['linkage'],
                })} className={fieldClass}><option value="direct">Direct</option><option value="indirect">Indirect</option></select>
              </div>
              <div className="grid grid-cols-2 gap-1">
                <select value={item.strength ?? 'unknown'} onChange={event => updateInterface(item.id, {
                  strength: event.target.value as NonNullable<SystemInterface['strength']>,
                })} className={fieldClass}>
                  {['strong', 'weak', 'unknown'].map(value => <option key={value} value={value}>Strength: {typeLabel(value)}</option>)}
                </select>
                <select value={item.nature ?? 'unknown'} onChange={event => updateInterface(item.id, {
                  nature: event.target.value as NonNullable<SystemInterface['nature']>,
                })} className={fieldClass}>
                  {['required', 'incidental', 'conditional', 'unknown'].map(value => <option key={value} value={value}>Nature: {typeLabel(value)}</option>)}
                </select>
              </div>
              <SystemInterfaceTransferEditor model={model} interfaceId={item.id} onChange={next => updateModel(() => next)} />
              <ModePicker model={model} value={item.mode_ids} onChange={mode_ids => updateInterface(item.id, { mode_ids })} />
            </div>
          })}
        </div>
      </aside>
          </div>
        </section>
      </div>}
    </div>}

    {state.view === 'requirements' && <RequirementsVerification model={model} selectedInstanceId={selected?.id ?? ''}
      onChange={next => setState(current => ({ ...current, model: next }))}
      onSelectBlock={selectedInstanceId => setState(current => ({ ...current, selectedInstanceId }))}
      onNavigateBlock={selectedInstanceId => setState(current => ({ ...current, selectedInstanceId, view: 'structure' }))}
      onNavigateFunction={navigateFunction} onNavigateInterface={navigateInterface} />}

    {state.view === 'functions' && <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr]">
      <aside className="overflow-auto border-r p-2"><HierarchyTree model={model}
        selectedId={selected?.id ?? ''} onSelect={selectedInstanceId =>
          setState(current => ({ ...current, selectedInstanceId }))} /></aside>
      <main className="overflow-auto p-5">
        {selected && selectedDefinition ? <SystemFunctionsEditor key={selected.id} instance={selected} definition={selectedDefinition}
          model={model} onModelChange={next => updateModel(() => next)}
          modeId={state.selectedModeId || undefined} focusRequest={functionFocusRequest}
          onNavigateFunction={navigateFunction} onNavigateInterface={navigateInterface}
          onDefineInterface={instanceId => {
            setState(current => ({ ...current, view: 'architecture', selectedInstanceId: instanceId,
              model: setDiagramBranchVisibility(current.model, instanceId, true) }))
            setDiagramSelectionRequest(current => ({ instanceId, requestId: (current?.requestId ?? 0) + 1 }))
            setModelToolsOpen(false)
            toast.info('Draw a connection from the selected block, then pair its resource with a complementary function.')
          }}
          updateInstance={patch => updateModel(current => ({ ...current, instances: current.instances.map(item =>
            item.id === selected.id ? { ...item, ...patch } : item) }))}
          updateDefinition={patch => updateDefinition(selectedDefinition.id, patch)}
          addFunction={addFunction} removeFunction={removeFunction} addFailure={addFailureMode} addFailureFor={addFailureModeFor}
          renderModes={(value, onChange) => <ModePicker model={model} value={value} onChange={onChange} />} />
          : <p className="text-xs text-slate-500">Select a block to edit functions and failures.</p>}
        <details className="mt-7 border-t pt-4 text-xs text-slate-600"><summary className="cursor-pointer font-medium">Advanced connections and propagation</summary>
        <section className="mt-4">
          <div className="mb-3 flex items-center justify-between"><div><h3 className="text-xs font-semibold text-slate-700">Additional dependencies for {selected?.name || 'selected block'}</h3>
            <p className="text-[10px] text-slate-500">Link dependencies not covered by interfaces.</p></div>
            <button type="button" onClick={addFunctionLink} className={buttonClass}><Plus size={12} /> Link</button></div>
          <div className="space-y-2">
            {model.function_links.filter(link => !link.generated && link.relationship !== 'decomposes_to' && (link.source.instance_id === selected?.id || link.target.instance_id === selected?.id)).map(link => <div key={link.id} className="rounded border bg-slate-50 p-2">
              <div className="grid gap-2 md:grid-cols-[1fr_150px_1fr_28px]">
                <select value={functionRefKey(link.source)} onChange={event => {
                  const option = functionOptions.find(item => item.key === event.target.value)
                  if (option) updateModel(current => ({ ...current, function_links: current.function_links.map(item =>
                    item.id === link.id ? { ...item, source: option.ref } : item) }))
                }} className={fieldClass}>{functionOptions.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select>
                <select value={link.relationship} onChange={event => updateModel(current => ({ ...current,
                  function_links: current.function_links.map(item => item.id === link.id
                    ? { ...item, relationship: event.target.value as typeof link.relationship } : item),
                }))} className={fieldClass}>{['depends_on', 'provides_input', 'enables', 'monitors', 'responds_to'].map(value =>
                  <option key={value} value={value}>{typeLabel(value)}</option>)}</select>
                <select value={functionRefKey(link.target)} onChange={event => {
                  const option = functionOptions.find(item => item.key === event.target.value)
                  if (option) updateModel(current => ({ ...current, function_links: current.function_links.map(item =>
                    item.id === link.id ? { ...item, target: option.ref } : item) }))
                }} className={fieldClass}>{functionOptions.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select>
                <button type="button" onClick={() => updateModel(current => ({ ...current,
                  function_links: current.function_links.filter(item => item.id !== link.id),
                }))}><Trash2 size={13} className="text-slate-400" /></button>
              </div>
              <input value={link.rationale} onChange={event => updateModel(current => ({ ...current,
                function_links: current.function_links.map(item => item.id === link.id ? { ...item, rationale: event.target.value } : item),
              }))} placeholder="Dependency rationale" className={`mt-2 ${fieldClass}`} />
              <div className="mt-2"><ModePicker model={model} value={link.mode_ids} onChange={mode_ids => updateModel(current => ({ ...current,
                function_links: current.function_links.map(item => item.id === link.id ? { ...item, mode_ids } : item),
              }))} /></div>
            </div>)}
          </div>
        </section>
        <section className="mt-7 border-t pt-5">
          <div className="mb-3 flex items-center justify-between"><div><h3 className="text-xs font-semibold text-slate-700">Propagation rules</h3>
            <p className="text-[10px] text-slate-500">Override qualitative propagation for an interface and deviation.</p></div>
            <button type="button" onClick={addPropagationRule} className={buttonClass}><Plus size={12} /> Rule</button></div>
          <div className="space-y-2">
            {model.propagation_rules.filter(rule => rule.source?.instance_id === selected?.id || rule.target?.instance_id === selected?.id
              || model.interfaces.some(edge => edge.id === rule.interface_id && (edge.source.instance_id === selected?.id || edge.target.instance_id === selected?.id))).map(rule => <div key={rule.id} className="rounded border border-blue-100 bg-blue-50/40 p-3">
              <div className="grid gap-2 md:grid-cols-[170px_1fr_160px_28px]">
                <select value={rule.action} onChange={event => updateModel(current => ({ ...current,
                  propagation_rules: current.propagation_rules.map(item => item.id === rule.id
                    ? { ...item, action: event.target.value as typeof rule.action } : item),
                }))} className={fieldClass}>{['pass_through', 'transform', 'stop', 'terminate'].map(value =>
                  <option key={value} value={value}>{typeLabel(value)}</option>)}</select>
                <select value={rule.interface_id ?? ''} onChange={event => updateModel(current => ({ ...current,
                  propagation_rules: current.propagation_rules.map(item => item.id === rule.id
                    ? { ...item, interface_id: event.target.value || undefined } : item),
                }))} className={fieldClass}><option value="">Any transition</option>
                  {model.interfaces.map(item => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select>
                <input value={rule.source_deviation_id ?? ''} onChange={event => updateModel(current => ({ ...current,
                  propagation_rules: current.propagation_rules.map(item => item.id === rule.id
                    ? { ...item, source_deviation_id: event.target.value || undefined } : item),
                }))} placeholder="Source deviation (any)" className={fieldClass} />
                <button type="button" onClick={() => updateModel(current => ({ ...current,
                  propagation_rules: current.propagation_rules.filter(item => item.id !== rule.id),
                }))}><Trash2 size={13} className="text-slate-400" /></button>
              </div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <input value={rule.result_deviation_id ?? ''} disabled={rule.action === 'stop' || rule.action === 'terminate'}
                  onChange={event => updateModel(current => ({ ...current,
                    propagation_rules: current.propagation_rules.map(item => item.id === rule.id
                      ? { ...item, result_deviation_id: event.target.value || undefined } : item),
                  }))} placeholder="Result deviation (unchanged)" className={fieldClass} />
                <input value={rule.result_description} disabled={rule.action === 'stop' || rule.action === 'terminate'}
                  onChange={event => updateModel(current => ({ ...current,
                    propagation_rules: current.propagation_rules.map(item => item.id === rule.id
                      ? { ...item, result_description: event.target.value } : item),
                  }))} placeholder="Derived downstream failure description" className={fieldClass} />
              </div>
              <input value={rule.rationale} onChange={event => updateModel(current => ({ ...current,
                propagation_rules: current.propagation_rules.map(item => item.id === rule.id ? { ...item, rationale: event.target.value } : item),
              }))} placeholder="Explain why this propagation behavior applies" className={`mt-2 ${fieldClass}`} />
              <div className="mt-2"><ModePicker model={model} value={rule.mode_ids} onChange={mode_ids => updateModel(current => ({ ...current,
                propagation_rules: current.propagation_rules.map(item => item.id === rule.id ? { ...item, mode_ids } : item),
              }))} /></div>
            </div>)}
          </div>
        </section>
        </details>
      </main>
    </div>}

    {state.view === 'fault-map' && <div className="min-h-0 flex-1 overflow-auto p-5">
      <div className="mb-4 flex items-center gap-3">
        <button onClick={runPropagation} disabled={busy} className={buttonClass}><RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> Build fault map</button>
        {state.propagation?.valid && <>
          <button onClick={() => decide(state.propagation!.proposals.map(item => item.id), 'accepted')} className={buttonClass}><Check size={13} /> Accept all</button>
          <button onClick={() => decide(state.propagation!.proposals.map(item => item.id), 'rejected')} className={buttonClass}><X size={13} /> Reject all</button>
        </>}
        <span className="text-xs text-slate-500">{message}</span>
      </div>
      {state.propagation && <div className="mb-4 grid gap-3 md:grid-cols-4">
        {[['Paths', state.propagation.paths.length], ['Proposals', state.propagation.proposals.length],
          ['Mapped functions', state.propagation.coverage.functions_with_downstream_mapping ?? 0],
          ['Coverage gaps', (state.propagation.coverage.unmapped_function_ids?.length ?? 0)
            + (state.propagation.coverage.interfaces_without_function_mapping?.length ?? 0)]].map(([label, value]) =>
          <div key={String(label)} className="rounded border bg-slate-50 p-3"><div className="text-[10px] uppercase text-slate-500">{label}</div><div className="text-xl font-semibold">{value}</div></div>)}
      </div>}
      {state.propagation?.issues.map((issue, index) => <div key={`${issue.code}-${index}`}
        className={`mb-2 flex gap-2 rounded border px-3 py-2 text-xs ${issue.severity === 'error'
          ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
        <CircleAlert size={14} /> {issue.message}
      </div>)}
      {!!state.propagation?.nodes.length && <FaultTraceDiagram result={state.propagation} />}
      {!!state.propagation?.paths.length && <section className="mb-5">
        <h3 className="mb-2 text-xs font-semibold text-slate-700">Trace paths</h3>
        <div className="space-y-2">{state.propagation.paths.map((path, index) => {
          const proposalIds = [
            ...path.edge_ids.map(edgeId => state.propagation?.proposals.find(item => item.edge_id === edgeId)?.id),
            path.proposal_id,
          ].filter((id): id is string => Boolean(id))
          const statuses = proposalIds.map(id => decisionStatus(state, id))
          const pathStatus = proposalIds.length && statuses.every(status => status === 'accepted')
            ? 'accepted' : statuses.some(status => status === 'rejected') ? 'rejected' : 'pending'
          return <div key={path.id} className="rounded border bg-slate-50 p-3">
            <div className="flex items-center gap-3">
              <GitBranch size={14} className="text-slate-500" />
              <div className="min-w-0 flex-1"><div className="text-xs font-medium">Path {index + 1} · {path.edge_ids.length} downstream step(s)</div>
                <div className="mt-0.5 text-[10px] text-slate-500">Ends: {typeLabel(path.termination)} · {path.id}</div></div>
              <span className={`rounded px-2 py-1 text-[10px] ${pathStatus === 'accepted'
                ? 'bg-emerald-100 text-emerald-700' : pathStatus === 'rejected'
                  ? 'bg-red-100 text-red-700' : 'bg-slate-200 text-slate-600'}`}>{pathStatus}</span>
              <button type="button" disabled={!proposalIds.length} onClick={() => decide(proposalIds, 'accepted')}
                title="Accept every proposal on this path"><Check size={14} className="text-emerald-600" /></button>
              <button type="button" disabled={!proposalIds.length} onClick={() => decide(proposalIds, 'rejected')}
                title="Reject every proposal on this path"><X size={14} className="text-red-500" /></button>
            </div>
          </div>
        })}</div>
      </section>}
      {!!state.propagation?.proposals.length && <h3 className="mb-2 text-xs font-semibold text-slate-700">Propagation proposals</h3>}
      <div className="space-y-2">
        {state.propagation?.proposals.map(proposal => {
          const status = proposal.review_required === false
            ? 'accepted' : decisionStatus(state, proposal.id)
          const source = state.propagation?.nodes.find(item => item.id === proposal.source_node_id)
          const target = state.propagation?.nodes.find(item => item.id === proposal.target_node_id)
          return <div key={proposal.id} className="rounded-lg border bg-white p-3">
            <div className="flex items-start gap-3">
              <Network size={16} className="mt-0.5 text-blue-500" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-slate-800">{source?.function.instance_name}: {source?.description ?? proposal.action}</div>
                {target && <div className="mt-1 text-xs text-slate-600">→ {target.function.instance_name}: {target.description}</div>}
                <div className="mt-1 text-[10px] text-slate-400">{proposal.explanation} · {proposal.id}</div>
              </div>
              <span className={`rounded px-2 py-1 text-[10px] ${status === 'accepted' ? 'bg-emerald-100 text-emerald-700'
                : status === 'rejected' ? 'bg-red-100 text-red-700' : status === 'stale'
                  ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{status}</span>
              <button onClick={() => decide([proposal.id], 'accepted')} title="Accept"><Check size={14} className="text-emerald-600" /></button>
              <button onClick={() => decide([proposal.id], 'rejected')} title="Reject"><X size={14} className="text-red-500" /></button>
            </div>
          </div>
        })}
      </div>
    </div>}

    {state.view === 'integrations' && <div className="min-h-0 flex-1 overflow-auto p-6">
      <h2 className="text-sm font-semibold text-slate-800">Linked analyses & change impact</h2>
      <p className="mt-1 max-w-3xl text-xs text-slate-500">Preview changes before creating or updating linked analyses.</p>
      <div className="mt-3 flex items-center gap-2 text-[10px] text-slate-500">
        Scope
        <select value={projectionScopeId} onChange={event => setProjectionScopeId(event.target.value)}
          className="max-w-56 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700">
          <option value="">Entire model</option>
          {model.instances.map(item => <option key={item.id} value={item.id}>{instanceLabel(model, item)}</option>)}
        </select>
        Quantity projection
        <select value={quantityStrategy} onChange={event => setQuantityStrategy(event.target.value as 'grouped'|'exploded')}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700">
          <option value="grouped">Grouped (recommended)</option>
          <option value="exploded">Explode quantity-one pieces</option>
        </select>
        <span>Exploded projections create stable piece identities and require explicit review.</span>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <div
          className="rounded-lg border p-4 text-left hover:border-blue-400 disabled:opacity-40"><div className="font-medium">Prediction</div>
          <div className="mt-1 text-xs text-slate-500">Uses this hierarchy. Set standards and part models in Prediction.</div></div>
        <button onClick={() => previewProjection('fmea')} disabled={!model.instances.length || busy} className="rounded-lg border p-4 text-left hover:border-blue-400 disabled:opacity-40"><div className="font-medium">FMEA</div><div className="mt-1 text-xs text-slate-500">Use this system’s functions, failures, and interfaces.</div></button>
        {(['rbd', 'fta', 'markov'] as const).map(target => <button key={target}
          onClick={() => previewProjection(target)} disabled={(target !== 'rbd' && !acceptedPaths.length) || busy}
          className="rounded-lg border p-4 text-left hover:border-blue-400 disabled:opacity-40">
          <div className="font-medium">{target.toUpperCase()}</div><div className="mt-1 text-xs text-slate-500">Create a draft {target.toUpperCase()} from this system.</div>
        </button>)}
      </div>
      {message && <div className="mt-4 text-xs text-slate-600">{message}</div>}
      {state.projectionPreview && <section className="mt-5 rounded-lg border border-blue-200 bg-blue-50/40 p-4">
        <div className="flex items-start justify-between gap-4">
          <div><h3 className="text-xs font-semibold text-slate-800">{state.projectionPreview.target.toUpperCase()} projection preview</h3>
            <p className="mt-1 text-[10px] text-slate-500">Source revision {state.projectionPreview.binding.source_revision} · {state.projectionPreview.binding.quantity_strategy} quantities · review required</p></div>
          <button type="button" onClick={applyProjectionPreview} disabled={!state.projectionPreview.valid || busy}
            className={buttonClass}><Check size={12} /> Apply reviewed projection</button>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2">
          {Object.entries(state.projectionPreview.diff.summary).map(([key, value]) => <div key={key} className="rounded border bg-white p-2">
            <div className="text-[9px] uppercase text-slate-400">{key}</div><div className="text-lg font-semibold">{value}</div>
          </div>)}
        </div>
        {state.projectionPreview.issues.map((issue, index) => <div key={`${issue.code}-${index}`}
          className={`mt-2 flex gap-2 text-[10px] ${issue.severity === 'error' ? 'text-red-700' : 'text-amber-700'}`}>
          <CircleAlert size={12} /> {issue.message}
        </div>)}
      </section>}
      <section className="mt-6">
        <div className="flex items-center justify-between"><h3 className="text-xs font-semibold text-slate-700">Active model bindings</h3>
          <button type="button" onClick={checkImpact} disabled={busy || !(state.analysisBindings ?? []).length}
            className={buttonClass}><RefreshCw size={11} /> Check impact</button></div>
        <div className="mt-2 overflow-hidden rounded border">
          {(state.analysisBindings ?? []).map(binding => {
            const impact = impactReport.find(item => item.binding_id === binding.id)
            const stale = impact?.status === 'stale'
            return <div key={binding.id} className="grid grid-cols-[120px_1fr_130px] border-b px-3 py-2 text-xs last:border-b-0">
            <span className="font-medium uppercase">{binding.analysis_module}</span>
            <span className="truncate text-slate-500">{binding.scope_instance_id
              ? model.instances.find(item => item.id === binding.scope_instance_id)?.name ?? binding.scope_instance_id
              : 'Entire model'}</span>
            <span className={stale ? 'text-amber-600' : 'text-emerald-600'}>{impact
              ? stale ? `Review ${(impact.changes as unknown[]|undefined)?.length ?? 0} changes` : 'Current'
              : 'Impact not checked'}</span>
          </div>})}
          {!(state.analysisBindings ?? []).length && <div className="p-4 text-xs text-slate-400">No linked analyses yet.</div>}
        </div>
      </section>

    </div>}
  </div>
}
