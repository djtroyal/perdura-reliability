import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow, Background, Controls, MiniMap, Handle, Position, MarkerType,
  BackgroundVariant, NodeResizer, useEdgesState, useNodesState,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange,
  type FitViewOptions, type NodeProps, type ReactFlowInstance, type Viewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Activity, AlertTriangle, BarChart3, Clipboard, Copy, Info,
  LayoutGrid, MessageSquarePlus, Minus, Play, Plus, Scissors, Settings,
  Table, Trash2,
} from 'lucide-react'
import {
  analyzeMarkov, getMarkovExample, validateMarkov,
  type MarkovResponse, type MarkovStateInput, type MarkovTransitionInput,
  type MarkovValidationIssue, type MarkovValidationResponse,
} from '../../api/client'
import { useFolioState, writeFolioState } from '../../store/project'
import { useReliabilitySources } from '../shared/ldaFolios'
import { CanvasErrorBoundary, sanitizeNodeChanges, sanitizeNodes } from '../shared/CanvasErrorBoundary'
import ExportDiagramButton from '../shared/ExportDiagramButton'
import { fitReactFlowForExport } from '../shared/exportDiagram'
import FolioBar from '../shared/FolioBar'
import Latex from '../shared/Latex'
import NumberField from '../shared/NumberField'
import Plot from '../shared/ExportablePlot'

const STATE_STYLE: Record<string, { label: string; accent: string; fill: string; text: string }> = {
  operational: { label: 'Operational', accent: '#10b981', fill: '#ecfdf5', text: '#064e3b' },
  degraded: { label: 'Degraded', accent: '#f59e0b', fill: '#fffbeb', text: '#78350f' },
  failed: { label: 'Failed', accent: '#ef4444', fill: '#fef2f2', text: '#7f1d1d' },
}

const MARKOV_PALETTE: Record<string, { label: string; accent: string; fill: string; text: string }> = {
  emerald: { label: 'Emerald', accent: '#10b981', fill: '#ecfdf5', text: '#064e3b' },
  teal: { label: 'Teal', accent: '#14b8a6', fill: '#f0fdfa', text: '#134e4a' },
  cyan: { label: 'Cyan', accent: '#06b6d4', fill: '#ecfeff', text: '#164e63' },
  blue: { label: 'Blue', accent: '#3b82f6', fill: '#eff6ff', text: '#1e3a8a' },
  indigo: { label: 'Indigo', accent: '#6366f1', fill: '#eef2ff', text: '#312e81' },
  violet: { label: 'Violet', accent: '#8b5cf6', fill: '#f5f3ff', text: '#4c1d95' },
  rose: { label: 'Rose', accent: '#f43f5e', fill: '#fff1f2', text: '#881337' },
  red: { label: 'Red', accent: '#ef4444', fill: '#fef2f2', text: '#7f1d1d' },
  orange: { label: 'Orange', accent: '#f97316', fill: '#fff7ed', text: '#7c2d12' },
  amber: { label: 'Amber', accent: '#f59e0b', fill: '#fffbeb', text: '#78350f' },
  lime: { label: 'Lime', accent: '#84cc16', fill: '#f7fee7', text: '#365314' },
  slate: { label: 'Slate', accent: '#64748b', fill: '#f8fafc', text: '#334155' },
}

const DENSITY_LEVELS = ['compact', 'comfortable', 'spacious'] as const
type Density = typeof DENSITY_LEVELS[number]
const DENSITY: Record<Density, { width: number; className: string; title: string }> = {
  compact: { width: 128, className: 'w-32', title: 'Compact' },
  comfortable: { width: 156, className: 'w-[156px]', title: 'Comfortable' },
  spacious: { width: 188, className: 'w-[188px]', title: 'Spacious' },
}

const EXAMPLES = [
  { key: 'simple_repairable', label: 'Simple Repairable (2-state)' },
  { key: 'standby_redundancy', label: 'Standby Redundancy (1+1)' },
  { key: 'tmr', label: 'Triple Modular Redundancy' },
]

interface MarkovModuleState {
  states: MarkovStateInput[]
  transitions: MarkovTransitionInput[]
  canvasNodes?: Node[]
  canvasEdges?: Edge[]
  positions?: Record<string, { x: number; y: number }>
  annotations?: Node[]
  stateColors?: Record<string, string>
  viewport?: Viewport
  tMax: number
  nPoints: number
  initialState: string
  uncertaintySamples: number
  uncertaintyCI: number
  uncertaintySeed: number
  result: MarkovResponse | null
  nextStateId: number
  nextTransitionId?: number
  density?: Density
  snapToGrid?: boolean
}

const INITIAL_MARKOV: MarkovModuleState = {
  states: [], transitions: [], canvasNodes: [], canvasEdges: [], positions: {}, annotations: [], stateColors: {},
  viewport: { x: 0, y: 0, zoom: 1 },
  tMax: 10000, nPoints: 101, initialState: '', uncertaintySamples: 500,
  uncertaintyCI: 0.95, uncertaintySeed: 42, result: null,
  nextStateId: 1, nextTransitionId: 1, density: 'comfortable',
  snapToGrid: false,
}

interface MarkovNodeData extends Record<string, unknown> {
  stateId: string
  label: string
  stateType: MarkovStateInput['state_type']
  description: string
  dwellModel: NonNullable<MarkovStateInput['dwell_model']>
  dwellShape: number
  diagramColor?: string
}

interface MarkovEdgeData extends Record<string, unknown> {
  rate: number
  symbol: string
  rateCv: number
  sourceId?: string
  sourceName?: string
}

type MarkovModelNode = Node<MarkovNodeData, 'markovState'>
type MarkovModelEdge = Edge<MarkovEdgeData>

export function clampViewport(viewport?: Partial<Viewport>): Viewport {
  const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return {
    x: Math.max(-10000, Math.min(10000, finite(viewport?.x, 0))),
    y: Math.max(-10000, Math.min(10000, finite(viewport?.y, 0))),
    zoom: Math.max(0.25, Math.min(2.5, finite(viewport?.zoom, 1))),
  }
}

export function stateToNode(
  state: MarkovStateInput,
  position: { x: number; y: number },
  diagramColor?: string,
): MarkovModelNode {
  return {
    id: state.id,
    type: 'markovState',
    position,
    data: {
      stateId: state.id,
      label: state.name,
      stateType: state.state_type,
      description: state.description ?? '',
      dwellModel: state.dwell_model ?? 'exponential',
      dwellShape: state.dwell_shape ?? 1,
      diagramColor,
    },
  }
}

export function nodeToState(node: MarkovModelNode): MarkovStateInput {
  return {
    id: node.id,
    name: String(node.data.label ?? node.id),
    state_type: node.data.stateType,
    description: String(node.data.description ?? ''),
    dwell_model: node.data.dwellModel,
    dwell_shape: Number(node.data.dwellShape ?? 1),
  }
}

export function transitionToEdge(transition: MarkovTransitionInput): MarkovModelEdge {
  return {
    id: String(transition.id),
    source: transition.from_state,
    target: transition.to_state,
    type: 'bezier',
    data: {
      rate: Number(transition.rate),
      symbol: transition.label ?? '',
      rateCv: transition.rate_cv ?? 0,
      sourceId: transition.sourceId,
      sourceName: transition.sourceName,
    },
  }
}

export function edgeToTransition(edge: MarkovModelEdge): MarkovTransitionInput {
  return {
    id: edge.id,
    from_state: edge.source,
    to_state: edge.target,
    rate: Number(edge.data?.rate ?? 0),
    label: String(edge.data?.symbol ?? ''),
    rate_cv: Number(edge.data?.rateCv ?? 0),
    sourceId: edge.data?.sourceId,
    sourceName: edge.data?.sourceName,
  }
}

function formatMetric(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (value !== 0 && (Math.abs(value) >= 1e4 || Math.abs(value) < 1e-3)) return value.toExponential(4)
  return value.toFixed(6)
}

function nextNumericId(prefix: string, existing: Iterable<string>, start = 1): [string, number] {
  const used = new Set(existing)
  let sequence = Math.max(1, start)
  while (used.has(`${prefix}${sequence}`)) sequence += 1
  return [`${prefix}${sequence}`, sequence + 1]
}

function ensureTransitionIds(transitions: MarkovTransitionInput[]): MarkovTransitionInput[] {
  const used = new Set<string>()
  return transitions.map((transition, index) => {
    let id = String(transition.id ?? '')
    if (!id || used.has(id)) {
      let sequence = index + 1
      while (used.has(`tr${sequence}`)) sequence += 1
      id = `tr${sequence}`
    }
    used.add(id)
    return { ...transition, id }
  })
}

function layoutStates(
  states: MarkovStateInput[], transitions: MarkovTransitionInput[], initialState?: string,
): Record<string, { x: number; y: number }> {
  if (!states.length) return {}
  // Markov state diagrams conventionally emphasize cyclic state relationships,
  // so arrange states radially instead of borrowing a left-to-right process-flow
  // hierarchy. Put the initial state first at the top of models with 3+ states.
  const initialId = initialState && states.some(state => state.id === initialState)
    ? initialState : states[0].id
  const ordered = [
    states.find(state => state.id === initialId) as MarkovStateInput,
    ...states.filter(state => state.id !== initialId),
  ]
  const positions: Record<string, { x: number; y: number }> = {}
  if (ordered.length === 1) {
    positions[ordered[0].id] = { x: 320, y: 240 }
    return positions
  }
  if (ordered.length === 2) {
    positions[ordered[0].id] = { x: 180, y: 240 }
    positions[ordered[1].id] = { x: 500, y: 240 }
    return positions
  }
  const center = { x: 390, y: 300 }
  const radiusX = Math.max(220, 70 * ordered.length)
  const radiusY = Math.max(180, 48 * ordered.length)
  ordered.forEach((state, index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / ordered.length
    positions[state.id] = {
      x: center.x + radiusX * Math.cos(angle),
      y: center.y + radiusY * Math.sin(angle),
    }
  })
  return positions
}

function stateStyle(type: string, custom?: string) {
  return (custom ? MARKOV_PALETTE[custom] : undefined) ?? STATE_STYLE[type] ?? STATE_STYLE.operational
}

function TargetHandles() {
  const cls = '!pointer-events-none !h-2 !w-2 !border-0 !bg-transparent'
  return <>
    <Handle id="annotation-top" type="target" position={Position.Top} isConnectable={false} className={cls} />
    <Handle id="annotation-right" type="target" position={Position.Right} isConnectable={false} className={cls} />
    <Handle id="annotation-bottom" type="target" position={Position.Bottom} isConnectable={false} className={cls} />
    <Handle id="annotation-left" type="target" position={Position.Left} isConnectable={false} className={cls} />
  </>
}

function MarkovStateNode({ data, selected }: NodeProps) {
  const style = stateStyle(String(data.stateType ?? 'operational'), String(data.diagramColor ?? ''))
  const density = (DENSITY_LEVELS.includes(data.density as Density) ? data.density : 'comfortable') as Density
  const missionProbability = Number(data.missionProbability)
  const steadyProbability = Number(data.steadyProbability)
  return (
    <div className={`group relative ${DENSITY[density].className} rounded-xl border-2 px-3 py-2 shadow-sm transition-shadow ${
      data.highlighted ? 'ring-4 ring-amber-200' : selected ? 'ring-4 ring-blue-200' : ''
    }`} style={{ borderColor: style.accent, backgroundColor: style.fill, color: style.text }}>
      <TargetHandles />
      <Handle id="markov-input-left" type="target" position={Position.Left}
        className="!h-3 !w-3" style={{ backgroundColor: style.accent, top: '43%' }} />
      <Handle id="markov-output-right" type="source" position={Position.Right}
        className="!h-3 !w-3" style={{ backgroundColor: style.accent, top: '57%' }} />
      <Handle id="markov-output-left" type="source" position={Position.Left}
        className="!h-2 !w-2 !opacity-0" style={{ backgroundColor: style.accent, top: '57%' }} />
      <Handle id="markov-input-right" type="target" position={Position.Right}
        className="!h-2 !w-2 !opacity-0" style={{ backgroundColor: style.accent, top: '43%' }} />
      <Handle id="markov-output-top" type="source" position={Position.Top}
        className="!h-2 !w-2 !opacity-0" style={{ backgroundColor: style.accent, left: '57%' }} />
      <Handle id="markov-input-top" type="target" position={Position.Top}
        className="!h-2 !w-2 !opacity-0" style={{ backgroundColor: style.accent, left: '43%' }} />
      <Handle id="markov-output-bottom" type="source" position={Position.Bottom}
        className="!h-2 !w-2 !opacity-0" style={{ backgroundColor: style.accent, left: '43%' }} />
      <Handle id="markov-input-bottom" type="target" position={Position.Bottom}
        className="!h-2 !w-2 !opacity-0" style={{ backgroundColor: style.accent, left: '57%' }} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold">{String(data.label ?? 'State')}</p>
          <p className="mt-0.5 text-[9px] font-medium uppercase tracking-wide opacity-70">
            {STATE_STYLE[String(data.stateType)]?.label ?? String(data.stateType)}
          </p>
        </div>
        {Boolean(data.initial) && <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[8px] font-bold" title="Initial state">t₀</span>}
      </div>
      {String(data.description ?? '').trim() && (
        <p className="mt-1 line-clamp-2 whitespace-pre-line border-t pt-1 text-[9px] leading-3 opacity-75" style={{ borderColor: `${style.accent}35` }}>
          {String(data.description)}
        </p>
      )}
      <div className="mt-1 flex items-center justify-between gap-2 border-t pt-1 font-mono text-[9px]" style={{ borderColor: `${style.accent}35` }}>
        <span>ID {String(data.stateId)}</span>
        {Number.isFinite(missionProbability) ? <span>P(t) {(missionProbability * 100).toFixed(2)}%</span>
          : Number.isFinite(steadyProbability) ? <span>π {(steadyProbability * 100).toFixed(2)}%</span> : null}
      </div>
      {String(data.dwellModel) === 'erlang' && (
        <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full border bg-white px-1.5 py-0.5 text-[8px] font-medium shadow-sm" style={{ borderColor: style.accent }}>
          Erlang k={String(data.dwellShape)}
        </span>
      )}
    </div>
  )
}

function MarkovAnnotationNode({ data, selected, width, height }: NodeProps) {
  const palette = MARKOV_PALETTE[String(data.color ?? 'amber')] ?? MARKOV_PALETTE.amber
  const opacity = Math.max(0.15, Math.min(1, Number(data.opacity ?? 90) / 100))
  const rounded = String(data.shape ?? 'rounded') === 'oval' ? 'rounded-[50%] px-7'
    : String(data.shape ?? 'rounded') === 'rectangle' ? 'rounded-none' : 'rounded-lg'
  return (
    <div className={`relative flex h-full min-h-14 w-full min-w-28 items-center justify-center border px-3 py-2 text-center text-[10px] shadow-sm ${rounded} ${selected ? 'ring-2 ring-blue-300' : ''}`}
      style={{ width, height, borderColor: palette.accent, backgroundColor: palette.fill, color: palette.text, opacity }}>
      <NodeResizer isVisible={selected} minWidth={112} minHeight={56} lineClassName="!border-blue-400" handleClassName="!h-2 !w-2 !border-blue-500 !bg-white" />
      <Handle id="annotation-top" type="source" position={Position.Top} isConnectable={false} className="!h-2 !w-2 !border-0 !bg-transparent" />
      <Handle id="annotation-right" type="source" position={Position.Right} isConnectable={false} className="!h-2 !w-2 !border-0 !bg-transparent" />
      <Handle id="annotation-bottom" type="source" position={Position.Bottom} isConnectable={false} className="!h-2 !w-2 !border-0 !bg-transparent" />
      <Handle id="annotation-left" type="source" position={Position.Left} isConnectable={false} className="!h-2 !w-2 !border-0 !bg-transparent" />
      <span className="whitespace-pre-wrap break-words">{String(data.text ?? 'Diagram note')}</span>
    </div>
  )
}

const NODE_TYPES = { markovState: MarkovStateNode, markovAnnotation: MarkovAnnotationNode }

function annotationEdge(annotation: Node, stateNodes: Node[]): Edge[] {
  const targetId = String(annotation.data.targetId ?? '')
  const target = stateNodes.find(node => node.id === targetId)
  if (!target) return []
  const ax = annotation.position.x + Number(annotation.width ?? 180) / 2
  const ay = annotation.position.y + Number(annotation.height ?? 64) / 2
  const tx = target.position.x + 78
  const ty = target.position.y + 48
  const horizontal = Math.abs(ax - tx) >= Math.abs(ay - ty)
  const sourceSide = horizontal ? (ax > tx ? 'left' : 'right') : (ay > ty ? 'top' : 'bottom')
  const targetSide = horizontal ? (ax > tx ? 'right' : 'left') : (ay > ty ? 'bottom' : 'top')
  const palette = MARKOV_PALETTE[String(annotation.data.color ?? 'amber')] ?? MARKOV_PALETTE.amber
  return [{
    id: `annotation-edge:${annotation.id}`, source: annotation.id, target: target.id,
    sourceHandle: `annotation-${sourceSide}`, targetHandle: `annotation-${targetSide}`,
    type: 'straight', selectable: false, focusable: false,
    markerEnd: { type: MarkerType.ArrowClosed, width: 13, height: 13, color: palette.accent },
    style: { stroke: palette.accent, strokeWidth: 1.2, strokeDasharray: '5 4' },
  }]
}

function describeError(error: unknown): { message: string; issues?: MarkovValidationIssue[] } {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (Array.isArray(detail)) {
    return { message: detail.map(issue => {
      const item = issue as { loc?: (string | number)[]; msg?: string }
      return `${item.loc?.slice(1).join(' → ') || 'Input'}: ${item.msg ?? 'invalid value'}`
    }).join(' ') }
  }
  if (detail && typeof detail === 'object') {
    const item = detail as { message?: string; issues?: MarkovValidationIssue[] }
    return { message: item.message ?? 'Analysis failed.', issues: item.issues }
  }
  return { message: typeof detail === 'string' ? detail : error instanceof Error ? error.message : 'Analysis failed.' }
}

export default function Markov() {
  const [persisted, setPersisted, folios] = useFolioState<MarkovModuleState>('markov', INITIAL_MARKOV)
  const normalized = useMemo(() => {
    const states = persisted.states ?? []
    const transitions = ensureTransitionIds(persisted.transitions ?? [])
    const positions = persisted.positions && Object.keys(persisted.positions).length
      ? persisted.positions : layoutStates(states, transitions, persisted.initialState)
    const persistedNodes = sanitizeNodes(persisted.canvasNodes ?? []) as MarkovModelNode[]
    const nodeIds = new Set(persistedNodes.map(node => node.id))
    const canvasNodes = persistedNodes.length === states.length && states.every(state => nodeIds.has(state.id))
      ? persistedNodes
      : states.map((state, index) => stateToNode(
        state,
        positions[state.id] ?? { x: 100 + (index % 3) * 230, y: 100 + Math.floor(index / 3) * 150 },
        persisted.stateColors?.[state.id],
      ))
    const persistedEdges = (persisted.canvasEdges ?? []) as MarkovModelEdge[]
    const edgeIds = new Set(persistedEdges.map(edge => edge.id))
    const canvasEdges = persistedEdges.length === transitions.length
        && transitions.every(transition => edgeIds.has(String(transition.id)))
      ? persistedEdges
      : transitions.map(transitionToEdge)
    return {
      ...INITIAL_MARKOV, ...persisted, states, transitions, positions,
      canvasNodes, canvasEdges,
      annotations: sanitizeNodes(persisted.annotations ?? []),
      stateColors: persisted.stateColors ?? {},
      viewport: clampViewport(persisted.viewport),
    }
  }, [persisted])
  const [modelNodes, setModelNodes, onModelNodesChange] = useNodesState<MarkovModelNode>(normalized.canvasNodes)
  const [transitionEdges, setTransitionEdges, onTransitionEdgesChange] = useEdgesState<MarkovModelEdge>(normalized.canvasEdges)
  const [annotations, setAnnotations, onAnnotationsChange] = useNodesState<Node>(normalized.annotations)
  const [tMax, setTMax] = useState(normalized.tMax)
  const [nPoints, setNPoints] = useState(normalized.nPoints)
  const [initialState, setInitialState] = useState(normalized.initialState)
  const [uncertaintySamples, setUncertaintySamples] = useState(normalized.uncertaintySamples)
  const [uncertaintyCI, setUncertaintyCI] = useState(normalized.uncertaintyCI)
  const [uncertaintySeed, setUncertaintySeed] = useState(normalized.uncertaintySeed)
  const [result, setResult] = useState<MarkovResponse | null>(normalized.result)
  const [nextStateId, setNextStateId] = useState(normalized.nextStateId)
  const [nextTransitionId, setNextTransitionId] = useState(normalized.nextTransitionId ?? 1)
  const [density, setDensity] = useState<Density>(normalized.density ?? 'comfortable')
  const [snapToGrid, setSnapToGrid] = useState(Boolean(normalized.snapToGrid))
  const [viewport, setViewport] = useState<Viewport>(clampViewport(normalized.viewport))
  const [validation, setValidation] = useState<MarkovValidationResponse | null>(null)
  const [showValidation, setShowValidation] = useState(false)
  const [selectedStateIds, setSelectedStateIds] = useState<string[]>([])
  const [selectedTransitionId, setSelectedTransitionId] = useState<string | null>(null)
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null)
  const [highlightedStateIds, setHighlightedStateIds] = useState<string[]>([])
  const [highlightedTransitionId, setHighlightedTransitionId] = useState<string | null>(null)
  const [rightMode, setRightMode] = useState<'properties' | 'results'>('results')
  const [resultTab, setResultTab] = useState<'summary' | 'curves' | 'states' | 'matrix' | 'method'>('summary')
  const [clipboard, setClipboard] = useState<{ states: MarkovStateInput[]; transitions: MarkovTransitionInput[]; positions: Record<string, { x: number; y: number }> } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const flowRef = useRef<ReactFlowInstance<Node, Edge> | null>(null)
  const flowWrapperRef = useRef<HTMLDivElement>(null)
  const ownerFolio = useRef(folios.activeId)
  const persistTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pendingLocalWrite = useRef<MarkovModuleState | null>(null)
  const insertionSequence = useRef(0)

  const fitViewAndRemember = useCallback((options?: FitViewOptions) => {
    const instance = flowRef.current
    if (!instance) return
    void instance.fitView(options).then(() => setViewport(clampViewport(instance.getViewport())))
  }, [])

  const states = useMemo(() => modelNodes.map(nodeToState), [modelNodes])
  const transitions = useMemo(() => transitionEdges.map(edgeToTransition), [transitionEdges])
  const positions = useMemo(() => Object.fromEntries(modelNodes.map(node => [node.id, node.position])), [modelNodes])
  const stateColors = useMemo(() => Object.fromEntries(modelNodes.flatMap(node =>
    node.data.diagramColor ? [[node.id, node.data.diagramColor]] : [])), [modelNodes])

  const snapshot = useMemo<MarkovModuleState>(() => ({
    states, transitions, canvasNodes: modelNodes, canvasEdges: transitionEdges,
    positions, annotations, stateColors, viewport, tMax, nPoints, initialState,
    uncertaintySamples, uncertaintyCI, uncertaintySeed, result, nextStateId,
    nextTransitionId, density, snapToGrid,
  }), [states, transitions, modelNodes, transitionEdges, positions, annotations, stateColors, viewport, tMax, nPoints, initialState,
    uncertaintySamples, uncertaintyCI, uncertaintySeed, result, nextStateId,
    nextTransitionId, density, snapToGrid])
  const latest = useRef(snapshot)
  latest.current = snapshot
  useEffect(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current)
    persistTimer.current = setTimeout(() => {
      pendingLocalWrite.current = latest.current
      setPersisted(latest.current)
    }, 250)
  }, [snapshot])
  useEffect(() => () => {
    if (persistTimer.current) clearTimeout(persistTimer.current)
    setPersisted(latest.current)
  }, [])

  const seenFolio = useRef(folios.activeId)
  useEffect(() => {
    const folioChanged = seenFolio.current !== folios.activeId
    if (!folioChanged && persisted === pendingLocalWrite.current) {
      pendingLocalWrite.current = null
      return
    }
    if (persistTimer.current) clearTimeout(persistTimer.current)
    if (folioChanged && ownerFolio.current !== folios.activeId) {
      writeFolioState('markov', ownerFolio.current, latest.current)
    }
    seenFolio.current = folios.activeId; ownerFolio.current = folios.activeId
    setModelNodes(normalized.canvasNodes); setTransitionEdges(normalized.canvasEdges)
    setAnnotations(normalized.annotations)
    setTMax(normalized.tMax); setNPoints(normalized.nPoints); setInitialState(normalized.initialState)
    setUncertaintySamples(normalized.uncertaintySamples); setUncertaintyCI(normalized.uncertaintyCI)
    setUncertaintySeed(normalized.uncertaintySeed); setResult(normalized.result)
    setNextStateId(normalized.nextStateId); setNextTransitionId(normalized.nextTransitionId ?? 1)
    setDensity(normalized.density ?? 'comfortable')
    const restoredViewport = clampViewport(normalized.viewport)
    setViewport(restoredViewport)
    if (!folioChanged) void flowRef.current?.setViewport(restoredViewport)
    setSnapToGrid(Boolean(normalized.snapToGrid)); setSelectedStateIds([]); setSelectedTransitionId(null)
    setSelectedAnnotationId(null); setHighlightedStateIds([]); setHighlightedTransitionId(null)
    setRightMode(normalized.result ? 'results' : 'properties'); setError('')
  }, [persisted, folios.activeId, normalized])

  const rateSources = useReliabilitySources().filter(source => source.dist === 'exponential')
  const invalidate = useCallback(() => { setResult(null); setError(''); setHighlightedStateIds([]); setHighlightedTransitionId(null) }, [])
  const changeStates = useCallback((updater: (current: MarkovStateInput[]) => MarkovStateInput[]) => {
    setModelNodes(current => {
      const existing = new Map(current.map(node => [node.id, node]))
      return updater(current.map(nodeToState)).map((state, index) => {
        const node = existing.get(state.id)
        const replacement = stateToNode(state, node?.position ?? { x: 100 + (index % 3) * 230, y: 100 + Math.floor(index / 3) * 150 }, node?.data.diagramColor)
        return node ? { ...node, data: replacement.data } : replacement
      })
    })
    invalidate()
  }, [setModelNodes, invalidate])
  const changeTransitions = useCallback((updater: (current: MarkovTransitionInput[]) => MarkovTransitionInput[]) => {
    setTransitionEdges(current => updater(current.map(edgeToTransition)).map(transitionToEdge))
    invalidate()
  }, [setTransitionEdges, invalidate])
  const setStateDiagramColor = useCallback((id: string, color?: string) => {
    setModelNodes(current => current.map(node => node.id === id
      ? { ...node, data: { ...node.data, diagramColor: color } }
      : node))
  }, [setModelNodes])

  const times = useMemo(() => {
    const count = Math.max(2, Math.min(2000, Math.round(nPoints || 101)))
    const maximum = Math.max(0, Number(tMax) || 0)
    return Array.from({ length: count }, (_, index) => maximum * index / (count - 1))
  }, [tMax, nPoints])
  const apiRequest = useMemo(() => ({
    states: states.map(state => ({
      id: state.id, name: state.name, state_type: state.state_type,
      description: state.description ?? '', dwell_model: state.dwell_model ?? 'exponential' as const,
      dwell_shape: state.dwell_model === 'erlang' ? Math.max(2, state.dwell_shape ?? 2) : 1,
    })),
    transitions: transitions.map(transition => ({
      id: transition.id, from_state: transition.from_state, to_state: transition.to_state,
      rate: transition.rate, label: transition.label ?? '', rate_cv: transition.rate_cv ?? 0,
    })),
    times, initial_state: initialState || undefined, uncertainty_samples: uncertaintySamples,
    uncertainty_ci: uncertaintyCI, uncertainty_seed: uncertaintySeed,
  }), [states, transitions, times, initialState, uncertaintySamples, uncertaintyCI, uncertaintySeed])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void validateMarkov(apiRequest).then(setValidation).catch(cause => {
        const described = describeError(cause)
        setValidation({ valid: false, issues: described.issues ?? [{ severity: 'error', code: 'INPUT_CONTRACT', message: described.message }],
          summary: { states: states.length, transitions: transitions.length, up_states: 0, failed_states: 0, initial_state: initialState || null } })
      })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [apiRequest, states.length, transitions.length, initialState])

  const endpoint = result?.time_dependent?.[result.time_dependent.length - 1]
  const displayStateNodes = useMemo<Node[]>(() => modelNodes.map(node => ({
    ...node,
    data: {
      ...node.data,
      initial: (initialState || modelNodes[0]?.id) === node.id,
      steadyProbability: result?.steady_state?.[node.id],
      missionProbability: endpoint?.state_probs[node.id],
      density,
      highlighted: highlightedStateIds.includes(node.id),
    },
    selected: selectedStateIds.includes(node.id),
  })), [modelNodes, initialState, result, endpoint, density, highlightedStateIds, selectedStateIds])

  const renderedTransitionEdges = useMemo<Edge[]>(() => transitionEdges.map(edge => {
    const transition = edgeToTransition(edge)
    const selected = selectedTransitionId === edge.id
    const highlighted = highlightedTransitionId === edge.id
    const stroke = selected ? '#2563eb' : highlighted ? '#f59e0b' : '#64748b'
    const sourcePosition = modelNodes.find(node => node.id === edge.source)?.position ?? { x: 0, y: 0 }
    const targetPosition = modelNodes.find(node => node.id === edge.target)?.position ?? { x: 1, y: 0 }
    const dx = targetPosition.x - sourcePosition.x
    const dy = targetPosition.y - sourcePosition.y
    const reciprocal = transitionEdges.some(candidate =>
      candidate.id !== edge.id && candidate.source === edge.target && candidate.target === edge.source)
    let sourceHandle: string
    let targetHandle: string
    if (reciprocal && Math.abs(dx) >= Math.abs(dy)) {
      const upperArc = transition.from_state.localeCompare(transition.to_state) < 0
      sourceHandle = upperArc ? 'markov-output-top' : 'markov-output-bottom'
      targetHandle = upperArc ? 'markov-input-top' : 'markov-input-bottom'
    } else if (reciprocal) {
      const leftArc = transition.from_state.localeCompare(transition.to_state) < 0
      sourceHandle = leftArc ? 'markov-output-left' : 'markov-output-right'
      targetHandle = leftArc ? 'markov-input-left' : 'markov-input-right'
    } else if (Math.abs(dx) >= Math.abs(dy)) {
      sourceHandle = dx >= 0 ? 'markov-output-right' : 'markov-output-left'
      targetHandle = dx >= 0 ? 'markov-input-left' : 'markov-input-right'
    } else {
      sourceHandle = dy >= 0 ? 'markov-output-bottom' : 'markov-output-top'
      targetHandle = dy >= 0 ? 'markov-input-top' : 'markov-input-bottom'
    }
    return {
      ...edge,
      sourceHandle, targetHandle, type: 'bezier', pathOptions: { curvature: reciprocal ? 0.42 : 0.28 },
      label: `${transition.label ? `${transition.label} = ` : ''}${formatMetric(transition.rate)}`,
      labelStyle: { fontSize: 10, fontWeight: 600, fill: '#334155' },
      labelBgStyle: { fill: '#ffffff', fillOpacity: 0.92 }, labelBgPadding: [5, 3], labelBgBorderRadius: 5,
      markerEnd: { type: MarkerType.ArrowClosed, width: selected || highlighted ? 20 : 16, height: selected || highlighted ? 20 : 16, color: stroke },
      style: { stroke, strokeWidth: selected || highlighted ? 3 : 1.7 }, animated: selected || highlighted,
      interactionWidth: 24, selected,
    }
  }), [transitionEdges, modelNodes, selectedTransitionId, highlightedTransitionId])
  const displayNodes = useMemo(() => [...displayStateNodes, ...annotations.map(annotation => ({
    ...annotation, selected: annotation.id === selectedAnnotationId,
  }))], [displayStateNodes, annotations, selectedAnnotationId])
  const displayEdges = useMemo(() => [
    ...renderedTransitionEdges, ...annotations.flatMap(annotation => annotationEdge(annotation, displayStateNodes)),
  ], [renderedTransitionEdges, annotations, displayStateNodes])

  const visibleCenter = () => {
    const bounds = flowWrapperRef.current?.getBoundingClientRect()
    const instance = flowRef.current
    if (!bounds || !instance) return { x: 180, y: 140 }
    return instance.screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 })
  }
  const visibleInsertionPosition = () => {
    const center = visibleCenter()
    const offsets = [
      [0, 0], [190, 0], [-190, 0], [0, 145], [0, -145],
      [190, 145], [-190, 145], [190, -145], [-190, -145],
      [300, 0], [-300, 0], [0, 250], [0, -250],
    ] as const
    const start = insertionSequence.current++ % offsets.length
    for (let step = 0; step < offsets.length; step += 1) {
      const offset = offsets[(start + step) % offsets.length]
      const candidate = {
        x: center.x + offset[0] - DENSITY[density].width / 2,
        y: center.y + offset[1] - 45,
      }
      const overlaps = Object.values(positions).some(position =>
        Math.abs(position.x - candidate.x) < DENSITY[density].width + 45
        && Math.abs(position.y - candidate.y) < 115)
      if (!overlaps) return candidate
    }
    return {
      x: center.x + insertionSequence.current * 24 - DENSITY[density].width / 2,
      y: center.y + insertionSequence.current * 24 - 45,
    }
  }
  const addState = (stateType: MarkovStateInput['state_type']) => {
    const [id, next] = nextNumericId('s', states.map(state => state.id), nextStateId)
    const position = visibleInsertionPosition()
    const state: MarkovStateInput = { id, name: `${STATE_STYLE[stateType].label} ${id}`, state_type: stateType, description: '', dwell_model: 'exponential', dwell_shape: 1 }
    setNextStateId(next)
    setModelNodes(current => [...current, stateToNode(state, position)])
    invalidate()
    if (!states.length) setInitialState(id)
    setSelectedStateIds([id]); setSelectedTransitionId(null); setSelectedAnnotationId(null); setRightMode('properties')
  }
  const removeStates = (ids: string[]) => {
    const selected = new Set(ids)
    setModelNodes(current => current.filter(node => !selected.has(node.id)))
    setTransitionEdges(current => current.filter(edge => !selected.has(edge.source) && !selected.has(edge.target)))
    invalidate()
    if (selected.has(initialState)) setInitialState(states.find(state => !selected.has(state.id))?.id ?? '')
    setSelectedStateIds([])
  }
  const addTransition = (from = states[0]?.id, to = states[1]?.id) => {
    if (!from || !to || from === to) return
    const [id, next] = nextNumericId('tr', transitions.map(transition => String(transition.id)), nextTransitionId)
    setNextTransitionId(next)
    setTransitionEdges(current => [...current, transitionToEdge({ id, from_state: from, to_state: to, rate: 0.001, label: '', rate_cv: 0 })])
    invalidate()
    setSelectedTransitionId(id); setSelectedStateIds([]); setRightMode('properties')
  }
  const deleteSelected = () => {
    if (selectedAnnotationId) { setAnnotations(current => current.filter(node => node.id !== selectedAnnotationId)); setSelectedAnnotationId(null); return }
    if (selectedTransitionId) { setTransitionEdges(current => current.filter(edge => edge.id !== selectedTransitionId)); invalidate(); setSelectedTransitionId(null); return }
    if (selectedStateIds.length) removeStates(selectedStateIds)
  }

  const autoLayout = () => {
    const layout = layoutStates(states, transitions, initialState)
    setModelNodes(current => current.map(node => ({ ...node, position: layout[node.id] ?? node.position })))
    window.setTimeout(() => fitViewAndRemember({ padding: 0.18, duration: 350 }), 30)
  }
  const addAnnotation = (targetId?: string) => {
    const center = visibleCenter()
    let sequence = annotations.length + 1
    while (annotations.some(node => node.id === `markov-note-${sequence}`)) sequence += 1
    const target = targetId ? positions[targetId] : undefined
    const annotation: Node = {
      id: `markov-note-${sequence}`, type: 'markovAnnotation',
      position: target ? { x: target.x + 220, y: target.y } : { x: center.x - 90, y: center.y - 32 },
      width: 180, height: 64, data: { text: targetId ? `Note for ${states.find(state => state.id === targetId)?.name ?? targetId}` : 'Diagram note', targetId, color: 'amber', opacity: 90, shape: 'rounded' },
    }
    setAnnotations(current => [...current, annotation]); setSelectedAnnotationId(annotation.id)
    setSelectedStateIds([]); setSelectedTransitionId(null); setRightMode('properties')
  }

  const onNodesChange = (changes: NodeChange<Node>[]) => {
    const modelIds = new Set(modelNodes.map(node => node.id))
    const annotationIds = new Set(annotations.map(node => node.id))
    const changeId = (change: NodeChange<Node>) => change.type === 'add' || change.type === 'replace'
      ? change.item.id : change.id
    const modelChanges = changes.filter(change => modelIds.has(changeId(change)))
    const annotationChanges = changes.filter(change => annotationIds.has(changeId(change)))
    if (modelChanges.length) onModelNodesChange(sanitizeNodeChanges(modelChanges) as NodeChange<MarkovModelNode>[])
    if (annotationChanges.length) onAnnotationsChange(sanitizeNodeChanges(annotationChanges))
    const removed = new Set(modelChanges.filter(change => change.type === 'remove').map(change => change.id))
    if (removed.size) {
      setTransitionEdges(current => current.filter(edge => !removed.has(edge.source) && !removed.has(edge.target)))
      if (removed.has(initialState)) setInitialState(modelNodes.find(node => !removed.has(node.id))?.id ?? '')
      invalidate()
    }
  }
  const onEdgesChange = (changes: EdgeChange<Edge>[]) => {
    const edgeIds = new Set(transitionEdges.map(edge => edge.id))
    const changeId = (change: EdgeChange<Edge>) => change.type === 'add' || change.type === 'replace'
      ? change.item.id : change.id
    const modelChanges = changes.filter(change => edgeIds.has(changeId(change))) as EdgeChange<MarkovModelEdge>[]
    if (modelChanges.length) onTransitionEdgesChange(modelChanges)
    for (const change of changes) {
      if (change.type === 'select' && edgeIds.has(change.id)) {
        setSelectedTransitionId(change.selected ? change.id : null)
      }
    }
  }
  const onConnect = (connection: Connection) => {
    if (connection.source && connection.target) addTransition(connection.source, connection.target)
  }

  const copySelected = (cut = false) => {
    const ids = new Set(selectedStateIds)
    if (!ids.size) return
    setClipboard({
      states: states.filter(state => ids.has(state.id)),
      transitions: transitions.filter(transition => ids.has(transition.from_state) && ids.has(transition.to_state)),
      positions: Object.fromEntries([...ids].map(id => [id, positions[id] ?? { x: 0, y: 0 }])),
    })
    if (cut) removeStates([...ids])
  }
  const paste = () => {
    if (!clipboard?.states.length) return
    const idMap = new Map<string, string>()
    let stateSequence = nextStateId
    const newStates = clipboard.states.map(source => {
      const [id, next] = nextNumericId('s', [...states.map(state => state.id), ...idMap.values()], stateSequence)
      stateSequence = next; idMap.set(source.id, id)
      return { ...source, id, name: `${source.name} copy` }
    })
    let transitionSequence = nextTransitionId
    const newTransitions = clipboard.transitions.map(source => {
      const [id, next] = nextNumericId('tr', [...transitions.map(item => String(item.id))], transitionSequence)
      transitionSequence = next
      return { ...source, id, from_state: idMap.get(source.from_state) as string, to_state: idMap.get(source.to_state) as string }
    })
    const newPositions = Object.fromEntries(clipboard.states.map(source => {
      const position = clipboard.positions[source.id] ?? { x: 0, y: 0 }
      return [idMap.get(source.id) as string, { x: position.x + 36, y: position.y + 36 }]
    }))
    setNextStateId(stateSequence); setNextTransitionId(transitionSequence)
    setModelNodes(current => [...current, ...newStates.map(state => stateToNode(state, newPositions[state.id]))])
    setTransitionEdges(current => [...current, ...newTransitions.map(transitionToEdge)])
    invalidate(); setSelectedStateIds(newStates.map(state => state.id))
  }

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!flowWrapperRef.current?.contains(document.activeElement)) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      const modifier = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      if ((event.key === 'Delete' || event.key === 'Backspace') && (selectedStateIds.length || selectedTransitionId || selectedAnnotationId)) { event.preventDefault(); deleteSelected(); return }
      if (event.key === 'Escape') { setSelectedStateIds([]); setSelectedTransitionId(null); setSelectedAnnotationId(null); setHighlightedStateIds([]); setHighlightedTransitionId(null); return }
      if (!modifier) return
      if (key === 'c') { event.preventDefault(); copySelected(false) }
      else if (key === 'x') { event.preventDefault(); copySelected(true) }
      else if (key === 'v') { event.preventDefault(); paste() }
      else if (key === 'a') { event.preventDefault(); setSelectedStateIds(states.map(state => state.id)) }
      else if (event.shiftKey && key === 'l') { event.preventDefault(); autoLayout() }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [states, selectedStateIds, selectedTransitionId, selectedAnnotationId, clipboard, transitions, positions])

  const loadExample = async (key: string) => {
    try {
      const example = await getMarkovExample(key)
      const nextStates = example.states.map(state => ({
        id: state.id, name: state.name, state_type: state.type as MarkovStateInput['state_type'],
        description: state.description, dwell_model: state.dwell_model as MarkovStateInput['dwell_model'], dwell_shape: state.dwell_shape,
      }))
      const nextTransitions = ensureTransitionIds(example.transitions.map(transition => ({
        id: transition.id, from_state: transition.from, to_state: transition.to, rate: transition.rate,
        label: transition.label, rate_cv: transition.rate_cv,
      })))
      const layout = layoutStates(nextStates, nextTransitions, nextStates[0]?.id)
      setModelNodes(nextStates.map((state, index) => stateToNode(
        state, layout[state.id] ?? { x: 100 + (index % 3) * 230, y: 100 + Math.floor(index / 3) * 150 },
      )))
      setTransitionEdges(nextTransitions.map(transitionToEdge)); setInitialState(nextStates[0]?.id ?? '')
      setAnnotations([]); setResult(null); setError('')
      setSelectedStateIds([]); setSelectedTransitionId(null); setSelectedAnnotationId(null)
      setNextStateId(nextStates.length + 1); setNextTransitionId(nextTransitions.length + 1)
      window.setTimeout(() => fitViewAndRemember({ padding: 0.18, duration: 350 }), 30)
    } catch (cause) { setError(describeError(cause).message) }
  }
  const analyze = async () => {
    if (validation?.valid === false) { setShowValidation(true); setError(`Resolve ${validation.issues.filter(issue => issue.severity === 'error').length} model issue(s) before analysis.`); return }
    setLoading(true); setError(''); setHighlightedStateIds([]); setHighlightedTransitionId(null)
    try {
      const response = await analyzeMarkov(apiRequest)
      setResult(response); setValidation(response.validation ?? validation); setRightMode('results'); setResultTab('summary')
    } catch (cause) {
      const described = describeError(cause)
      if (described.issues) setValidation(current => ({ ...(current ?? { summary: { states: states.length, transitions: transitions.length, up_states: 0, failed_states: 0, initial_state: initialState || null } }), valid: false, issues: described.issues as MarkovValidationIssue[] }))
      setError(described.message); setShowValidation(Boolean(described.issues))
    } finally { setLoading(false) }
  }

  const selectedState = states.find(state => selectedStateIds[0] === state.id) ?? null
  const selectedTransition = transitions.find(transition => transition.id === selectedTransitionId) ?? null
  const selectedAnnotation = annotations.find(annotation => annotation.id === selectedAnnotationId) ?? null
  const sp = result?.system_params
  const probPlot = result?.time_dependent?.length ? states.map(state => ({
    x: result.time_dependent?.map(row => row.time), y: result.time_dependent?.map(row => row.state_probs[state.id] ?? 0),
    type: 'scatter' as const, mode: 'lines' as const, name: state.name,
    line: { color: stateStyle(state.state_type, stateColors[state.id]).accent, width: highlightedStateIds.includes(state.id) ? 4 : 2 },
  })) : []
  const availabilityPlot = result?.time_dependent?.length ? [
    { x: result.time_dependent.map(row => row.time), y: result.time_dependent.map(row => row.availability), type: 'scatter' as const, mode: 'lines' as const, name: 'Availability A(t)', line: { color: '#10b981', width: 2.5 } },
    { x: result.time_dependent.map(row => row.time), y: result.time_dependent.map(row => row.reliability), type: 'scatter' as const, mode: 'lines' as const, name: 'Reliability R(t)', line: { color: '#2563eb', width: 2.5 } },
    { x: result.time_dependent.map(row => row.time), y: result.time_dependent.map(row => row.unavailability), type: 'scatter' as const, mode: 'lines' as const, name: 'Unavailability U(t)', line: { color: '#ef4444', dash: 'dot' as const } },
    ...(result.ctmc_baseline?.time_dependent?.length ? [
      { x: result.ctmc_baseline.time_dependent.map(row => row.time), y: result.ctmc_baseline.time_dependent.map(row => row.availability), type: 'scatter' as const, mode: 'lines' as const, name: 'CTMC baseline A(t)', line: { color: '#64748b', dash: 'dash' as const } },
    ] : []),
  ] : []

  const selectResultState = (id: string) => {
    setHighlightedStateIds(current => current.length === 1 && current[0] === id ? [] : [id]); setHighlightedTransitionId(null)
    const position = positions[id]
    if (position) fitViewAndRemember({ nodes: [{ id }], padding: 0.8, duration: 300 })
  }
  const selectResultTransition = (id: string) => {
    setHighlightedTransitionId(current => current === id ? null : id); setHighlightedStateIds([])
  }

  const validationBadge = (
    <button type="button" onClick={() => setShowValidation(value => !value)}
      className={`flex w-full items-center justify-between rounded border px-2 py-1.5 text-[11px] ${validation?.valid ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
      <span>{validation?.valid ? `Model ready · ${validation.issues.filter(issue => issue.severity === 'warning').length} warning(s)`
        : `${validation?.issues.filter(issue => issue.severity === 'error').length ?? '—'} model issue(s)`}</span><AlertTriangle size={12} />
    </button>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FolioBar api={folios} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white">
          <div className="border-b border-slate-100 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div><p className="text-xs font-semibold text-slate-700">State Library</p><p className="text-[10px] text-slate-400">Add public system states</p></div>
              <div className="flex items-center gap-0.5 rounded border border-slate-200 p-0.5" title={`State size: ${DENSITY[density].title}`}>
                <button className="mini-button !px-1" disabled={density === DENSITY_LEVELS[0]} onClick={() => setDensity(DENSITY_LEVELS[Math.max(0, DENSITY_LEVELS.indexOf(density) - 1)])}><Minus size={11} /></button>
                <button className="mini-button !px-1" disabled={density === DENSITY_LEVELS[DENSITY_LEVELS.length - 1]} onClick={() => setDensity(DENSITY_LEVELS[Math.min(DENSITY_LEVELS.length - 1, DENSITY_LEVELS.indexOf(density) + 1)])}><Plus size={11} /></button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-1">
              {(['operational', 'degraded', 'failed'] as const).map(type => (
                <button key={type} type="button" onClick={() => addState(type)} className="flex items-center gap-2 rounded border px-2 py-1.5 text-left text-[11px] hover:shadow-sm"
                  style={{ borderColor: STATE_STYLE[type].accent, backgroundColor: STATE_STYLE[type].fill, color: STATE_STYLE[type].text }}>
                  <span className="h-3 w-3 rounded-full border-2" style={{ borderColor: STATE_STYLE[type].accent }} />
                  <span className="font-medium">{STATE_STYLE[type].label}</span><Plus size={11} className="ml-auto" />
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <details className="rounded-lg border border-slate-200 bg-slate-50">
              <summary className="cursor-pointer px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-600">Example models</summary>
              <div className="space-y-1 border-t border-slate-200 p-1.5">
                {EXAMPLES.map(example => <button key={example.key} onClick={() => void loadExample(example.key)} className="block w-full rounded bg-white px-2 py-1.5 text-left text-[10px] text-slate-700 ring-1 ring-slate-200 hover:bg-blue-50">{example.label}</button>)}
              </div>
            </details>
            <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 p-2 text-[10px] leading-4 text-blue-800">
              Connect a state’s right handle to another state’s left handle. Select any state or transition to edit its model in Properties.
            </div>
          </div>
          <div className="space-y-2 border-t border-slate-100 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Analysis setup</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] text-slate-600">Mission horizon
                <NumberField value={String(tMax)} onChange={value => { setTMax(Math.max(0, Number(value) || 0)); invalidate() }} min={0} className="mt-1 !py-1 !text-[11px]" />
              </label>
              <label className="text-[10px] text-slate-600">Time points
                <NumberField value={String(nPoints)} onChange={value => { setNPoints(Math.max(2, Math.min(2000, parseInt(value) || 101))); invalidate() }} min={2} max={2000} step={10} className="mt-1 !py-1 !text-[11px]" />
              </label>
            </div>
            <label className="block text-[10px] text-slate-600">Initial state
              <select className="field mt-1 !py-1 !text-[11px]" value={initialState} onChange={event => { setInitialState(event.target.value); invalidate() }}>
                <option value="">First state ({states[0]?.name ?? 'none'})</option>
                {states.map(state => <option key={state.id} value={state.id}>{state.name}</option>)}
              </select>
            </label>
            <details className="rounded border border-slate-200 bg-slate-50">
              <summary className="cursor-pointer px-2 py-1.5 text-[10px] font-medium text-slate-600">Rate uncertainty</summary>
              <div className="grid grid-cols-3 gap-1 border-t border-slate-200 p-2">
                <label className="text-[9px] text-slate-500">Samples<NumberField value={String(uncertaintySamples)} onChange={value => { setUncertaintySamples(Math.max(0, Math.min(5000, parseInt(value) || 0))); invalidate() }} min={0} max={5000} step={100} className="mt-0.5 !px-1 !py-0.5 !text-[9px]" /></label>
                <label className="text-[9px] text-slate-500">Interval %<NumberField value={String(uncertaintyCI * 100)} onChange={value => { setUncertaintyCI(Math.max(0.01, Math.min(0.999, (parseFloat(value) || 95) / 100))); invalidate() }} min={1} max={99.9} className="mt-0.5 !px-1 !py-0.5 !text-[9px]" /></label>
                <label className="text-[9px] text-slate-500">Seed<NumberField value={String(uncertaintySeed)} onChange={value => { setUncertaintySeed(parseInt(value) || 0); invalidate() }} className="mt-0.5 !px-1 !py-0.5 !text-[9px]" /></label>
              </div>
            </details>
            {validationBadge}
            {error && <p className="rounded bg-rose-50 p-2 text-[10px] text-rose-700">{error}</p>}
            {loading && <div className="overflow-hidden rounded-full bg-slate-200" role="progressbar"><div className="h-1.5 w-2/3 animate-pulse rounded-full bg-blue-600" /></div>}
            <button onClick={() => void analyze()} disabled={loading || !states.length} className="primary-button w-full py-2"><Play size={13} /> {loading ? 'Solving model…' : 'Analyze Markov Model'}</button>
          </div>
        </aside>

        <CanvasErrorBoundary onReset={autoLayout}>
          <div ref={flowWrapperRef} tabIndex={0} className="relative min-w-0 flex-1 bg-slate-50 focus:outline-none"
            onPointerDown={event => { if (!(event.target as HTMLElement).closest('button,input,textarea,select')) event.currentTarget.focus() }}>
            <div className="absolute left-3 right-3 top-3 z-10 flex items-center justify-between gap-2 pointer-events-none" data-export-ignore>
              <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-slate-200 bg-white/95 p-1 shadow-sm backdrop-blur">
                <button className="mini-button" onClick={autoLayout}><LayoutGrid size={12} /> Auto Layout</button>
                <button className="mini-button" onClick={() => copySelected(false)} disabled={!selectedStateIds.length}><Copy size={12} /> Copy</button>
                <button className="mini-button" onClick={() => copySelected(true)} disabled={!selectedStateIds.length}><Scissors size={12} /> Cut</button>
                <button className="mini-button" onClick={paste} disabled={!clipboard}><Clipboard size={12} /> Paste</button>
                <button className="mini-button" onClick={() => addAnnotation(selectedState?.id)}><MessageSquarePlus size={12} /> Annotate</button>
                <button className={`mini-button ${snapToGrid ? '!border-blue-300 !bg-blue-50 !text-blue-700' : ''}`} onClick={() => setSnapToGrid(value => !value)}><LayoutGrid size={12} /> Snap</button>
                <button className="mini-button !border-rose-200 !text-rose-600" onClick={deleteSelected} disabled={!selectedStateIds.length && !selectedTransitionId && !selectedAnnotationId}><Trash2 size={12} /> Delete</button>
              </div>
              <div className="pointer-events-auto"><ExportDiagramButton getElement={() => flowWrapperRef.current} baseName="markov-state-model" prepareExport={() => fitReactFlowForExport(flowRef.current)} /></div>
            </div>
            <ReactFlow key={`markov-flow-${folios.activeId}`} nodes={displayNodes} edges={displayEdges} nodeTypes={NODE_TYPES}
              defaultViewport={viewport} minZoom={0.25} maxZoom={2.5}
              onInit={instance => { flowRef.current = instance }} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
              onMoveEnd={(_, nextViewport) => setViewport(clampViewport(nextViewport))}
              onConnect={onConnect} onNodeClick={(_, node) => {
                if (node.type === 'markovAnnotation') { setSelectedAnnotationId(node.id); setSelectedStateIds([]) }
                else { setSelectedStateIds([node.id]); setSelectedAnnotationId(null) }
                setSelectedTransitionId(null); setHighlightedStateIds([]); setHighlightedTransitionId(null); setRightMode('properties')
              }} onEdgeClick={(_, edge) => {
                if (String(edge.id).startsWith('annotation-edge:')) return
                setSelectedTransitionId(edge.id); setSelectedStateIds([]); setSelectedAnnotationId(null); setRightMode('properties')
              }} onPaneClick={() => { setSelectedStateIds([]); setSelectedTransitionId(null); setSelectedAnnotationId(null); if (result) setRightMode('results') }}
              onSelectionChange={({ nodes: selected }) => { const ids = selected.filter(node => node.type === 'markovState').map(node => node.id); if (ids.length) setSelectedStateIds(ids) }}
              zoomOnDoubleClick={false} snapToGrid={snapToGrid} snapGrid={[20, 20]} selectionOnDrag multiSelectionKeyCode="Shift" deleteKeyCode={null}>
              {snapToGrid ? <Background variant={BackgroundVariant.Dots} color="#94a3b8" gap={20} size={1.2} /> : <Background color="#e2e8f0" gap={24} />}
              <Controls />
              <MiniMap pannable zoomable nodeColor={node => {
                if (node.type === 'markovAnnotation') return (MARKOV_PALETTE[String(node.data.color ?? 'amber')] ?? MARKOV_PALETTE.amber).accent
                return stateStyle(String(node.data.stateType ?? 'operational'), String(node.data.diagramColor ?? '')).accent
              }} />
            </ReactFlow>
            {showValidation && validation && <div className="absolute bottom-4 left-4 z-20 max-h-64 w-[min(32rem,calc(100%-2rem))] overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 shadow-xl" data-export-ignore>
              <div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold text-slate-700">Model diagnostics</p><button className="text-xs text-slate-400" onClick={() => setShowValidation(false)}>Close</button></div>
              <div className="space-y-1">{validation.issues.length ? validation.issues.map((issue, index) => <button key={`${issue.code}-${index}`} className={`block w-full rounded border px-2 py-1.5 text-left text-[10px] ${issue.severity === 'error' ? 'border-rose-100 bg-rose-50 text-rose-700' : 'border-amber-100 bg-amber-50 text-amber-700'}`} onClick={() => {
                if (issue.state_id && states.some(state => state.id === issue.state_id)) { setHighlightedStateIds([issue.state_id]); fitViewAndRemember({ nodes: [{ id: issue.state_id }], padding: 0.8, duration: 300 }) }
                if (issue.transition_id) setHighlightedTransitionId(issue.transition_id)
              }}><span className="font-semibold">{issue.code.replace(/_/g, ' ')}</span> — {issue.message}</button>) : <p className="text-[10px] text-emerald-700">No findings.</p>}</div>
            </div>}
          </div>
        </CanvasErrorBoundary>

        <aside className="flex w-[26rem] shrink-0 flex-col border-l border-slate-200 bg-white">
          <div className="grid grid-cols-2 gap-1 border-b border-slate-200 bg-slate-50 p-2">
            <button disabled={!selectedState && !selectedTransition && !selectedAnnotation} onClick={() => setRightMode('properties')} className={`rounded px-2 py-1.5 text-xs font-semibold disabled:opacity-35 ${rightMode === 'properties' ? 'bg-white text-blue-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-500'}`}>Properties</button>
            <button disabled={!result} onClick={() => setRightMode('results')} className={`rounded px-2 py-1.5 text-xs font-semibold disabled:opacity-35 ${rightMode === 'results' ? 'bg-white text-blue-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-500'}`}>Analysis Results</button>
          </div>

          {rightMode === 'properties' && <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {selectedState && <div className="space-y-3">
              <div className="flex items-center justify-between"><div><p className="text-xs font-semibold text-slate-700">State properties</p><p className="font-mono text-[9px] text-slate-400">{selectedState.id}</p></div><button className="mini-button !border-rose-200 !text-rose-600" onClick={() => removeStates([selectedState.id])}><Trash2 size={11} /> Delete</button></div>
              <label className="block text-xs text-slate-600">Name<input className="field mt-1" value={selectedState.name} onChange={event => changeStates(current => current.map(state => state.id === selectedState.id ? { ...state, name: event.target.value } : state))} /></label>
              <label className="block text-xs text-slate-600">State classification<select className="field mt-1" value={selectedState.state_type} onChange={event => changeStates(current => current.map(state => state.id === selectedState.id ? { ...state, state_type: event.target.value as MarkovStateInput['state_type'] } : state))}>{Object.entries(STATE_STYLE).map(([key, style]) => <option key={key} value={key}>{style.label}</option>)}</select></label>
              <label className="block text-xs text-slate-600">Description<textarea className="field mt-1 min-h-20 resize-y" value={selectedState.description} onChange={event => changeStates(current => current.map(state => state.id === selectedState.id ? { ...state, description: event.target.value } : state))} /></label>
              <div className="rounded border border-slate-200 bg-slate-50 p-2">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Holding-time model</p>
                <select className="field" value={selectedState.dwell_model ?? 'exponential'} onChange={event => changeStates(current => current.map(state => state.id === selectedState.id ? { ...state, dwell_model: event.target.value as MarkovStateInput['dwell_model'], dwell_shape: event.target.value === 'erlang' ? Math.max(2, state.dwell_shape ?? 2) : 1 } : state))}><option value="exponential">Exponential · memoryless CTMC</option><option value="erlang">Erlang phase-type</option></select>
                {selectedState.dwell_model === 'erlang' && <label className="mt-2 block text-[10px] text-slate-600">Erlang phases k<NumberField value={String(selectedState.dwell_shape ?? 2)} onChange={value => changeStates(current => current.map(state => state.id === selectedState.id ? { ...state, dwell_shape: Math.max(2, Math.min(20, parseInt(value) || 2)) } : state))} min={2} max={20} step={1} className="mt-1" /></label>}
              </div>
              <label className="flex items-center justify-between rounded border border-slate-200 px-2 py-2 text-xs text-slate-600">Initial state<input type="radio" checked={(initialState || states[0]?.id) === selectedState.id} onChange={() => { setInitialState(selectedState.id); invalidate() }} /></label>
              <div><div className="mb-1 flex items-center justify-between"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Diagram color</p>{stateColors[selectedState.id] && <button className="text-[10px] text-blue-600" onClick={() => setStateDiagramColor(selectedState.id)}>Reset to state type</button>}</div><div className="flex flex-nowrap gap-1">{Object.entries(MARKOV_PALETTE).map(([key, palette]) => <button key={key} onClick={() => setStateDiagramColor(selectedState.id, key)} className={`h-5 w-5 rounded-full border-2 ${stateColors[selectedState.id] === key ? 'border-slate-800 ring-2 ring-slate-200' : 'border-white'}`} style={{ backgroundColor: palette.accent }} title={palette.label} />)}</div></div>
            </div>}
            {selectedTransition && <div className="space-y-3">
              <div className="flex items-center justify-between"><div><p className="text-xs font-semibold text-slate-700">Transition properties</p><p className="font-mono text-[9px] text-slate-400">{selectedTransition.id}</p></div><button className="mini-button !border-rose-200 !text-rose-600" onClick={() => { changeTransitions(current => current.filter(item => item.id !== selectedTransition.id)); setSelectedTransitionId(null) }}><Trash2 size={11} /> Delete</button></div>
              <div className="grid grid-cols-2 gap-2"><label className="text-xs text-slate-600">From<select className="field mt-1" value={selectedTransition.from_state} onChange={event => changeTransitions(current => current.map(item => item.id === selectedTransition.id ? { ...item, from_state: event.target.value } : item))}>{states.map(state => <option key={state.id} value={state.id}>{state.name}</option>)}</select></label><label className="text-xs text-slate-600">To<select className="field mt-1" value={selectedTransition.to_state} onChange={event => changeTransitions(current => current.map(item => item.id === selectedTransition.id ? { ...item, to_state: event.target.value } : item))}>{states.map(state => <option key={state.id} value={state.id}>{state.name}</option>)}</select></label></div>
              <label className="block text-xs text-slate-600">Rate<NumberField value={String(selectedTransition.rate)} onChange={value => changeTransitions(current => current.map(item => item.id === selectedTransition.id ? { ...item, rate: Math.max(0, parseFloat(value) || 0), sourceId: undefined, sourceName: undefined } : item))} min={0} step={0.001} className="mt-1" /></label>
              <label className="block text-xs text-slate-600">Symbol / label<input className="field mt-1" value={selectedTransition.label} placeholder="λ, μ, ..." onChange={event => changeTransitions(current => current.map(item => item.id === selectedTransition.id ? { ...item, label: event.target.value } : item))} /></label>
              <label className="block text-xs text-slate-600">Rate uncertainty CV (%)<NumberField value={String((selectedTransition.rate_cv ?? 0) * 100)} onChange={value => changeTransitions(current => current.map(item => item.id === selectedTransition.id ? { ...item, rate_cv: Math.max(0, parseFloat(value) || 0) / 100 } : item))} min={0} max={1000} step={1} className="mt-1" /></label>
              {rateSources.length > 0 && <label className="block text-xs text-slate-600">Rate source<select className="field mt-1" value={selectedTransition.sourceId ?? ''} onChange={event => {
                const source = rateSources.find(item => item.id === event.target.value)
                changeTransitions(current => current.map(item => item.id === selectedTransition.id ? source ? { ...item, rate: source.dist_params.lambda, sourceId: source.id, sourceName: `${source.name} (${source.moduleLabel})`, label: item.label || 'λ' } : { ...item, sourceId: undefined, sourceName: undefined } : item))
              }}><option value="">Manual rate</option>{rateSources.map(source => <option key={source.id} value={source.id}>{source.name} — {source.label}</option>)}</select></label>}
              <p className="rounded bg-blue-50 p-2 text-[10px] leading-4 text-blue-700">Rates use one consistent reciprocal-time unit. Parallel transitions between the same states are summed in Q.</p>
            </div>}
            {selectedAnnotation && <div className="space-y-3">
              <div className="flex items-center justify-between"><p className="text-xs font-semibold text-slate-700">Diagram annotation</p><button className="mini-button !border-rose-200 !text-rose-600" onClick={() => { setAnnotations(current => current.filter(node => node.id !== selectedAnnotation.id)); setSelectedAnnotationId(null) }}><Trash2 size={11} /> Delete</button></div>
              <label className="block text-xs text-slate-600">Text<textarea className="field mt-1 min-h-20" value={String(selectedAnnotation.data.text ?? '')} onChange={event => setAnnotations(current => current.map(node => node.id === selectedAnnotation.id ? { ...node, data: { ...node.data, text: event.target.value } } : node))} /></label>
              <label className="block text-xs text-slate-600">Callout target<select className="field mt-1" value={String(selectedAnnotation.data.targetId ?? '')} onChange={event => setAnnotations(current => current.map(node => node.id === selectedAnnotation.id ? { ...node, data: { ...node.data, targetId: event.target.value || undefined } } : node))}><option value="">None · note only</option>{states.map(state => <option key={state.id} value={state.id}>{state.name}</option>)}</select></label>
              <div className="grid grid-cols-2 gap-2"><label className="text-xs text-slate-600">Shape<select className="field mt-1" value={String(selectedAnnotation.data.shape ?? 'rounded')} onChange={event => setAnnotations(current => current.map(node => node.id === selectedAnnotation.id ? { ...node, data: { ...node.data, shape: event.target.value } } : node))}><option value="rounded">Rounded</option><option value="rectangle">Rectangle</option><option value="oval">Oval</option></select></label><label className="text-xs text-slate-600">Opacity<select className="field mt-1" value={Number(selectedAnnotation.data.opacity ?? 90)} onChange={event => setAnnotations(current => current.map(node => node.id === selectedAnnotation.id ? { ...node, data: { ...node.data, opacity: Number(event.target.value) } } : node))}>{[100, 90, 75, 50, 30].map(value => <option key={value} value={value}>{value}%</option>)}</select></label></div>
              <div className="flex flex-nowrap gap-1">{Object.entries(MARKOV_PALETTE).map(([key, palette]) => <button key={key} onClick={() => setAnnotations(current => current.map(node => node.id === selectedAnnotation.id ? { ...node, data: { ...node.data, color: key } } : node))} className={`h-5 w-5 rounded-full border-2 ${selectedAnnotation.data.color === key ? 'border-slate-800' : 'border-white'}`} style={{ backgroundColor: palette.accent }} title={palette.label} />)}</div>
            </div>}
            {!selectedState && !selectedTransition && !selectedAnnotation && <div className="flex h-full items-center justify-center text-center text-xs text-slate-400"><div><Info size={22} className="mx-auto mb-2" />Select a state, transition, or annotation.</div></div>}
          </div>}

          {rightMode === 'results' && <div className="flex min-h-0 flex-1 flex-col">
            {!result ? <div className="flex h-full items-center justify-center text-center text-xs text-slate-400"><div><Info size={22} className="mx-auto mb-2" />Analyze a valid state model to see results.</div></div> : <>
              <div className="flex items-center border-b border-slate-200 bg-slate-50 px-1 pt-1">
                {([['summary', 'Summary', Activity], ['curves', 'Curves', BarChart3], ['states', 'States', Table], ['matrix', 'Matrix', Table], ['method', 'Method', Settings]] as const).map(([key, label, Icon]) => <button key={key} onClick={() => setResultTab(key)} className={`flex flex-1 items-center justify-center gap-1 border-b-2 px-1 py-2 text-[10px] ${resultTab === key ? 'border-blue-600 font-semibold text-blue-700' : 'border-transparent text-slate-500'}`}><Icon size={11} /> {label}</button>)}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {resultTab === 'summary' && sp && <div className="space-y-3">
                  <div className="rounded border border-blue-200 bg-blue-50 p-2"><p className="text-[11px] font-semibold text-blue-800">{result.model_contract.display_name}</p><p className="mt-0.5 text-[9px] leading-4 text-blue-700">{result.model_contract.dwell_time_interpretation}</p></div>
                  <div className="grid grid-cols-2 gap-2">{[
                    ['Availability A∞', sp.availability_ss], ['Unavailability U∞', sp.unavailability_ss], ['MTTF', sp.mttf], ['MTBF', sp.mtbf], ['Mean up time', sp.mut], ['MTTR', sp.mttr], ['Failure frequency', sp.failure_frequency], ['Repair frequency', sp.repair_frequency],
                  ].map(([label, value]) => <div key={String(label)} className="rounded border border-slate-200 p-2"><p className="text-[9px] uppercase tracking-wide text-slate-400">{String(label)}</p><p className="mt-1 font-mono text-xs font-semibold text-slate-700">{formatMetric(value as number | null)}</p></div>)}</div>
                  {result.steady_state && <div><p className="mb-1 text-xs font-semibold text-slate-700">Steady-state probabilities</p><div className="space-y-1">{states.map(state => { const probability = result.steady_state?.[state.id]; if (probability == null) return null; const style = stateStyle(state.state_type, stateColors[state.id]); return <button key={state.id} onClick={() => selectResultState(state.id)} className={`flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left text-[10px] ${highlightedStateIds.includes(state.id) ? 'border-amber-400 bg-amber-50' : 'border-slate-100'}`}><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: style.accent }} /><span className="min-w-0 flex-1 truncate">{state.name}</span><span className="font-mono">{(probability * 100).toFixed(4)}%</span></button> })}</div></div>}
                  {result.parameter_uncertainty?.metric_intervals && <div><p className="mb-1 text-xs font-semibold text-slate-700">Propagated rate uncertainty</p><table className="w-full text-[9px]"><thead><tr className="bg-slate-50"><th className="px-1 py-1 text-left">Metric</th><th className="px-1 py-1 text-right">Lower</th><th className="px-1 py-1 text-right">Median</th><th className="px-1 py-1 text-right">Upper</th></tr></thead><tbody>{Object.entries(result.parameter_uncertainty.metric_intervals).map(([key, interval]) => <tr key={key} className="border-t border-slate-100"><td className="px-1 py-1">{key.replace(/_/g, ' ')}</td><td className="px-1 py-1 text-right font-mono">{formatMetric(interval.lower)}</td><td className="px-1 py-1 text-right font-mono">{formatMetric(interval.median)}</td><td className="px-1 py-1 text-right font-mono">{formatMetric(interval.upper)}</td></tr>)}</tbody></table></div>}
                </div>}
                {resultTab === 'curves' && <div className="space-y-4"><div><p className="mb-1 text-xs font-semibold text-slate-700">State occupancy probabilities</p>{probPlot.length ? <div className="h-72 rounded border border-slate-200"><Plot data={probPlot} layout={{ margin: { t: 20, r: 15, b: 45, l: 55 }, xaxis: { title: { text: 'Time' }, gridcolor: '#e2e8f0' }, yaxis: { title: { text: 'P(state at t)' }, range: [0, 1.02], gridcolor: '#e2e8f0' }, legend: { orientation: 'h', y: -0.22 }, hovermode: 'x unified' }} config={{ responsive: true, scrollZoom: true }} style={{ width: '100%', height: '100%' }} /></div> : <p className="text-xs text-slate-400">No transient results.</p>}</div><div><p className="mb-1 text-xs font-semibold text-slate-700">Availability and reliability</p>{availabilityPlot.length ? <div className="h-72 rounded border border-slate-200"><Plot data={availabilityPlot} layout={{ margin: { t: 20, r: 15, b: 45, l: 55 }, xaxis: { title: { text: 'Time' }, gridcolor: '#e2e8f0' }, yaxis: { title: { text: 'Probability' }, range: [0, 1.02], gridcolor: '#e2e8f0' }, legend: { orientation: 'h', y: -0.22 }, hovermode: 'x unified' }} config={{ responsive: true, scrollZoom: true }} style={{ width: '100%', height: '100%' }} /></div> : null}</div></div>}
                {resultTab === 'states' && <div className="space-y-4"><div><p className="mb-1 text-xs font-semibold text-slate-700">States</p><div className="space-y-1">{result.states.map(state => <button key={state.id} onClick={() => selectResultState(state.id)} className={`grid w-full grid-cols-[1fr_auto_auto] items-center gap-2 rounded border px-2 py-1.5 text-left text-[10px] ${highlightedStateIds.includes(state.id) ? 'border-amber-400 bg-amber-50' : 'border-slate-100'}`}><span className="truncate">{state.name}</span><span className="capitalize text-slate-500">{state.type}</span><span className="font-mono">{result.steady_state ? formatMetric(result.steady_state[state.id]) : '—'}</span></button>)}</div></div><div><p className="mb-1 text-xs font-semibold text-slate-700">Transitions</p><div className="space-y-1">{result.transitions.map(transition => <button key={transition.id} onClick={() => selectResultTransition(transition.id)} className={`grid w-full grid-cols-[1fr_auto] gap-2 rounded border px-2 py-1.5 text-left text-[10px] ${highlightedTransitionId === transition.id ? 'border-amber-400 bg-amber-50' : 'border-slate-100'}`}><span className="truncate">{states.find(state => state.id === transition.from)?.name ?? transition.from} → {states.find(state => state.id === transition.to)?.name ?? transition.to}</span><span className="font-mono">{formatMetric(transition.rate)}</span></button>)}</div></div></div>}
                {resultTab === 'matrix' && <div><p className="mb-2 text-xs font-semibold text-slate-700">{result.phase_type.status === 'applied' ? 'Input-rate CTMC reference generator Q' : 'Infinitesimal generator Q'}</p><div className="h-64"><Plot data={[{ z: result.transition_matrix, x: result.states.map(state => state.name), y: result.states.map(state => state.name), type: 'heatmap', colorscale: 'RdBu', reversescale: true, hovertemplate: '%{y} → %{x}<br>Q=%{z:.6g}<extra></extra>' }]} layout={{ margin: { t: 15, r: 20, b: 70, l: 80 }, xaxis: { title: { text: 'Destination state' } }, yaxis: { title: { text: 'Source state' }, autorange: 'reversed' } }} config={{ responsive: true, scrollZoom: true }} style={{ width: '100%', height: '100%' }} /></div>{result.phase_type.matrix_note && <p className="mt-2 rounded bg-violet-50 p-2 text-[9px] leading-4 text-violet-700">{result.phase_type.matrix_note}</p>}</div>}
                {resultTab === 'method' && <div className="space-y-3"><div><p className="text-xs font-semibold text-slate-700">Model contract</p><ul className="mt-1 list-disc space-y-1 pl-4 text-[10px] leading-4 text-slate-600">{result.model_contract.assumptions.map((assumption, index) => <li key={index}>{assumption}</li>)}</ul></div>{result.model_contract.warnings.map((warning, index) => <p key={index} className="rounded bg-amber-50 p-2 text-[10px] text-amber-700">{warning}</p>)}<div className="rounded border border-slate-200 p-2"><p className="mb-1 text-[10px] font-semibold text-slate-700">Governing equations</p><Latex block>{String.raw`\mathbf{p}(t)=\mathbf{p}(0)e^{Qt}`}</Latex><Latex block>{String.raw`Q_{ii}=-\sum_{j\ne i}Q_{ij}`}</Latex><Latex block>{String.raw`A(t)=\sum_{i\in\mathcal{U}}p_i(t)`}</Latex></div>{result.validation?.issues.length ? <div><p className="text-xs font-semibold text-slate-700">Analysis diagnostics</p>{result.validation.issues.map((issue, index) => <p key={index} className="mt-1 text-[10px] text-slate-600"><span className="font-semibold">{issue.code.replace(/_/g, ' ')}</span> — {issue.message}</p>)}</div> : null}</div>}
              </div>
            </>}
          </div>}
        </aside>
      </div>
    </div>
  )
}
