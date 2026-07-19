import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  MarkerType,
  BackgroundVariant,
  NodeResizer,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  type NodeChange,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Plus, Play, Trash2, LayoutGrid, Copy, Clipboard, Scissors, MessageSquarePlus, Repeat2,
  Minus, AlertTriangle,
} from 'lucide-react'
import {
  computeRBD, validateRBD, RBDResponse, RBDValidationResponse,
} from '../../api/client'
import { CanvasErrorBoundary, sanitizeNodeChanges, sanitizeNodes } from '../shared/CanvasErrorBoundary'
import { useFolioState, useRevision, writeFolioState } from '../../store/project'
import FolioBar from '../shared/FolioBar'
import LibraryPanel, { LibraryItem } from '../shared/LibraryPanel'
import { computeCDF, DIST_OPTIONS, DIST_PARAMS } from '../FaultTree'
import { useReliabilitySources } from '../shared/ldaFolios'
import ExportDiagramButton from '../shared/ExportDiagramButton'
import { fitReactFlowForExport } from '../shared/exportDiagram'
import ExportResultsButton from '../shared/ExportResultsButton'
import { semanticNumericStep } from '../shared/numericSteps'
import Plot from '../shared/ExportablePlot'
import Latex from '../shared/Latex'

// --- Custom node components ---

const RBD_PALETTE: Record<string, { label: string; accent: string; fill: string; text: string }> = {
  emerald: { label: 'Emerald', accent: '#10b981', fill: '#ecfdf5', text: '#022c22' },
  teal: { label: 'Teal', accent: '#14b8a6', fill: '#f0fdfa', text: '#042f2e' },
  cyan: { label: 'Cyan', accent: '#06b6d4', fill: '#ecfeff', text: '#083344' },
  blue: { label: 'Blue', accent: '#3b82f6', fill: '#eff6ff', text: '#172554' },
  indigo: { label: 'Indigo', accent: '#6366f1', fill: '#eef2ff', text: '#1e1b4b' },
  violet: { label: 'Violet', accent: '#8b5cf6', fill: '#f5f3ff', text: '#2e1065' },
  rose: { label: 'Rose', accent: '#f43f5e', fill: '#fff1f2', text: '#4c0519' },
  red: { label: 'Red', accent: '#ef4444', fill: '#fef2f2', text: '#450a0a' },
  orange: { label: 'Orange', accent: '#f97316', fill: '#fff7ed', text: '#431407' },
  amber: { label: 'Amber', accent: '#f59e0b', fill: '#fffbeb', text: '#451a03' },
  lime: { label: 'Lime', accent: '#84cc16', fill: '#f7fee7', text: '#1a2e05' },
  slate: { label: 'Slate', accent: '#64748b', fill: '#f8fafc', text: '#0f172a' },
}

const RBD_DENSITY_LEVELS = ['dense', 'compact', 'comfortable', 'spacious', 'expanded'] as const
type RBDDensity = typeof RBD_DENSITY_LEVELS[number]
const RBD_DENSITY: Record<RBDDensity, { label: string; width: string; widthPx: number; text: string; gap: number }> = {
  dense: { label: 'Dense', width: 'w-24', widthPx: 96, text: 'text-[10px]', gap: 120 },
  compact: { label: 'Compact', width: 'w-28', widthPx: 112, text: 'text-[11px]', gap: 145 },
  comfortable: { label: 'Comfortable', width: 'w-36', widthPx: 144, text: 'text-xs', gap: 180 },
  spacious: { label: 'Spacious', width: 'w-44', widthPx: 176, text: 'text-[13px]', gap: 215 },
  expanded: { label: 'Expanded', width: 'w-52', widthPx: 208, text: 'text-sm', gap: 250 },
}

function normalizeDensity(value: unknown): RBDDensity {
  return RBD_DENSITY_LEVELS.includes(value as RBDDensity) ? value as RBDDensity : 'comfortable'
}

function componentReliabilityPreview(
  data: Record<string, unknown>,
  systemMissionTime: string,
): number | undefined {
  const distribution = String(data.distribution ?? '')
  if (!distribution || !DIST_PARAMS[distribution]) {
    const direct = Number(data.reliability)
    return Number.isFinite(direct) ? direct : undefined
  }
  const rawOverride = data.mission_time
  const hasOverride = rawOverride != null && String(rawOverride).trim() !== ''
  const time = Number(hasOverride ? rawOverride : systemMissionTime)
  if (!Number.isFinite(time) || time < 0) return undefined
  const value = 1 - computeCDF(
    distribution,
    (data.dist_params ?? {}) as Record<string, number>,
    time,
  )
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : undefined
}

function AnnotationTargetHandles() {
  const className = '!pointer-events-none !h-2 !w-2 !border-0 !bg-transparent'
  return <>
    <Handle id="annotation-target-top" type="target" position={Position.Top} isConnectable={false} className={className} />
    <Handle id="annotation-target-right" type="target" position={Position.Right} isConnectable={false} className={className} />
    <Handle id="annotation-target-bottom" type="target" position={Position.Bottom} isConnectable={false} className={className} />
    <Handle id="annotation-target-left" type="target" position={Position.Left} isConnectable={false} className={className} />
  </>
}

function SourceNode({ data, selected }: NodeProps) {
  return (
    <div className="relative flex flex-col items-center gap-1" title="Success-flow source terminal">
      <AnnotationTargetHandles />
      <div className={`h-9 w-9 rounded-full border-[5px] border-slate-700 bg-white shadow-sm ${selected ? 'ring-4 ring-blue-100' : ''}`} />
      <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-white">{String(data.label || 'Source')}</span>
      <Handle id="rbd-output" type="source" position={Position.Right} className="!h-2.5 !w-2.5 !bg-slate-600" />
    </div>
  )
}

function SinkNode({ data, selected }: NodeProps) {
  return (
    <div className="relative flex flex-col items-center gap-1" title="Success-flow sink terminal">
      <AnnotationTargetHandles />
      <Handle id="rbd-input" type="target" position={Position.Left} className="!bg-gray-400" />
      <div className={`h-9 w-9 rounded-full bg-slate-800 shadow-sm ${selected ? 'ring-4 ring-blue-100' : ''}`} />
      <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-white">{String(data.label || 'Sink')}</span>
    </div>
  )
}

function ComponentNode({ data, selected }: NodeProps) {
  const density = normalizeDensity(data.displayDensity)
  const preset = RBD_DENSITY[density]
  const palette = RBD_PALETTE[String(data.diagramColor ?? 'emerald')] ?? RBD_PALETTE.emerald
  const reliability = Number(data.computedReliability ?? data.reliability ?? 0.9)
  const issue = Boolean(data.validationIssue)
  const highlighted = Boolean(data.highlighted)
  return (
    <div className={`relative rounded-md border-2 px-3 py-2 shadow-sm ${preset.width} ${preset.text} ${
      issue ? 'ring-4 ring-rose-100' : highlighted ? 'ring-4 ring-amber-100' : selected ? 'ring-4 ring-blue-100' : ''
    }`} style={{ borderColor: issue ? '#f43f5e' : palette.accent, backgroundColor: palette.fill, color: palette.text }}>
      <AnnotationTargetHandles />
      <Handle id="rbd-input" type="target" position={Position.Left} className="!h-2.5 !w-2.5"
        style={{ backgroundColor: palette.accent }} />
      <div className="break-words text-center font-semibold">{String(data.label || 'Reliability block')}</div>
      {data.showNodeIds !== false && data.blockId != null && (
        <div className="mt-0.5 text-center font-mono text-[9px] opacity-45">{String(data.blockId)}</div>
      )}
      <div className="mt-1 text-center font-mono text-[10px] opacity-70">R = {Number.isFinite(reliability) ? reliability.toFixed(6) : '—'}</div>
      {data.description != null && String(data.description).trim() && (
        <div className="mt-1 whitespace-pre-line break-words border-t border-current/10 pt-1 text-[9px] font-normal opacity-65">
          {String(data.description)}
        </div>
      )}
      {data.ccf_group != null && String(data.ccf_group) !== '' && (
        <div className="mt-1 truncate rounded bg-white/60 px-1 text-center text-[9px] text-amber-700">
          CCF {String(data.ccf_group)} · β={String(data.ccf_beta ?? 0.1)}
        </div>
      )}
      {data.ldaSourceName != null && (
        <div className="mt-0.5 truncate text-center text-[9px] text-blue-600" title={String(data.ldaSourceName)}>
          {String(data.ldaSourceName)}
        </div>
      )}
      {data.linkedAnalysisName != null && (
        <div className="mt-1 truncate rounded bg-cyan-100/80 px-1 py-0.5 text-center text-[9px] font-medium text-cyan-800"
          title={`Linked RBD analysis: ${String(data.linkedAnalysisName)}`}>
          ↗ {String(data.linkedAnalysisName)}
        </div>
      )}
      {Number(data.mirrorCount ?? 1) > 1 && (
        <div className="mt-1 truncate rounded bg-violet-100/80 px-1 py-0.5 text-center text-[9px] font-medium text-violet-800"
          title="Every mirrored occurrence shares one logical component survival variable">
          ⧉ Mirrored · {String(data.mirrorCount)} occurrences
        </div>
      )}
      <Handle id="rbd-output" type="source" position={Position.Right} className="!h-2.5 !w-2.5"
        style={{ backgroundColor: palette.accent }} />
    </div>
  )
}

function RBDAnnotationNode({ data, selected, width, height }: NodeProps) {
  const palette = RBD_PALETTE[String(data.color ?? 'amber')] ?? RBD_PALETTE.amber
  const opacity = Math.max(0.1, Math.min(1, Number(data.fillOpacity ?? 100) / 100))
  const shape = String(data.shape ?? 'rounded')
  const shapeClass = shape === 'rectangle' ? 'rounded-none'
    : shape === 'oval' ? 'rounded-[50%] px-8' : shape === 'capsule' ? 'rounded-full px-7' : 'rounded-lg'
  return <>
    <NodeResizer isVisible={selected} minWidth={100} minHeight={44} color={palette.accent} />
    <div data-rbd-annotation title={String(data.text ?? '')}
      className={`relative overflow-hidden whitespace-pre-wrap break-words border px-3 py-2 text-[11px] leading-4 shadow-sm ${shapeClass}`}
      style={{
        width: Number(width) > 0 ? Number(width) : 192,
        height: Number(height) > 0 ? Number(height) : 64,
        borderColor: palette.accent,
        backgroundColor: palette.fill,
        color: palette.text,
        opacity,
      }}>
      {String(data.text ?? 'Diagram note')}
      {(['top', 'right', 'bottom', 'left'] as const).map(side => (
        <Handle key={side} id={`annotation-${side}`} type="source" isConnectable={false}
          position={{ top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left }[side]}
          className="!h-2 !w-2 !border-0 !bg-transparent" />
      ))}
    </div>
  </>
}

const nodeTypes = { source: SourceNode, sink: SinkNode, component: ComponentNode, annotation: RBDAnnotationNode }

const DEFAULT_NODES: Node[] = [
  { id: 'source', type: 'source', position: { x: 50, y: 200 }, data: { label: 'Source' } },
  { id: 'sink', type: 'sink', position: { x: 600, y: 200 }, data: { label: 'Sink' } },
]

interface CanvasState {
  nodes: Node[]
  edges: Edge[]
  annotations?: Node[]
  result?: RBDResponse | null
  missionTime?: string
  density?: RBDDensity
  connectorStyle?: 'smoothstep' | 'bezier' | 'straight'
  snapToGrid?: boolean
  showNodeIds?: boolean
}
const INITIAL_CANVAS: CanvasState = {
  nodes: DEFAULT_NODES, edges: [], annotations: [], missionTime: '1000',
  density: 'comfortable', connectorStyle: 'smoothstep', snapToGrid: false, showNodeIds: true,
}

interface RBDClipboard {
  nodes: { id: string; type: string; data: Record<string, unknown>; position: { x: number; y: number } }[]
  edges: Edge[]
}

function resolveBlockIds(nodes: Node[]): Map<string, string> {
  const resolved = new Map<string, string>()
  const used = new Set<string>()
  for (const node of nodes.filter(item => item.type === 'component')) {
    const candidate = String(node.data.blockId ?? '').toUpperCase()
    if (/^BLK-\d+$/.test(candidate) && !used.has(candidate)) {
      resolved.set(node.id, candidate); used.add(candidate)
    }
  }
  for (const node of nodes.filter(item => item.type === 'component')) {
    if (resolved.has(node.id)) continue
    let sequence = 1
    while (used.has(`BLK-${sequence}`)) sequence += 1
    const id = `BLK-${sequence}`
    resolved.set(node.id, id); used.add(id)
  }
  return resolved
}

interface RBDRequestErrorDetail {
  message: string
  issues?: RBDValidationResponse['issues']
}

function describeRBDRequestError(error: unknown): RBDRequestErrorDetail {
  const response = (error as { response?: { status?: number; data?: { detail?: unknown } } })?.response
  const detail = response?.data?.detail
  if (typeof detail === 'string') return { message: detail }
  if (Array.isArray(detail)) {
    const messages = detail.map(item => {
      const issue = item as { loc?: unknown[]; msg?: string }
      const location = (issue.loc ?? []).filter(part => part !== 'body').map(String).join(' → ')
      return `${location ? `${location}: ` : ''}${issue.msg ?? 'Invalid input.'}`
    })
    return { message: messages.join(' ') || 'The RBD request contains invalid input.' }
  }
  if (detail && typeof detail === 'object') {
    const structured = detail as { message?: unknown; issues?: RBDValidationResponse['issues'] }
    return {
      message: typeof structured.message === 'string' ? structured.message : 'RBD analysis failed.',
      issues: structured.issues,
    }
  }
  if (response?.status === 422) {
    return { message: 'The RBD request contains invalid input. Review the highlighted model fields and try again.' }
  }
  return { message: error instanceof Error ? error.message : 'RBD analysis failed.' }
}

export default function SystemReliability() {
  const [persisted, setPersisted, folios] = useFolioState<CanvasState>('system', INITIAL_CANVAS)
  const revision = useRevision()
  const ldaFolios = useReliabilitySources()
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(sanitizeNodes(persisted.nodes ?? []))
  const [annotations, setAnnotations, onAnnotationsChange] = useNodesState<Node>(
    sanitizeNodes(persisted.annotations ?? []),
  )
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(persisted.edges)
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([])
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null)
  const [result, setResult] = useState<RBDResponse | null>(persisted.result ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validation, setValidation] = useState<RBDValidationResponse | null>(null)
  const [showValidationIssues, setShowValidationIssues] = useState(false)
  const [rightPaneMode, setRightPaneMode] = useState<'properties' | 'results'>('results')
  const [resultTab, setResultTab] = useState<'overview' | 'curve' | 'paths' | 'importance' | 'formulas' | 'method'>('overview')
  const [clipboard, setClipboard] = useState<RBDClipboard | null>(null)
  const [missionTime, setMissionTime] = useState(persisted.missionTime ?? '1000')
  const [density, setDensity] = useState<RBDDensity>(normalizeDensity(persisted.density))
  const [connectorStyle, setConnectorStyle] = useState<'smoothstep' | 'bezier' | 'straight'>(persisted.connectorStyle ?? 'smoothstep')
  const [snapToGrid, setSnapToGrid] = useState(Boolean(persisted.snapToGrid))
  const [showNodeIds, setShowNodeIds] = useState(persisted.showNodeIds !== false)
  const [highlightedNodeIds, setHighlightedNodeIds] = useState<string[]>([])
  const [activePathIndex, setActivePathIndex] = useState<number | null>(null)

  // Persist canvas to the project store, debounced. Writing on every drag-move
  // event triggered a store emit (and a full re-render of every subscriber) on
  // each pixel of movement; under rapid dragging this re-render storm could
  // corrupt the canvas and blank the page. Debouncing coalesces a drag into a
  // single write once motion settles, with a flush on unmount so nothing is lost.
  const latest = useRef<CanvasState>({
    nodes, edges, annotations, result, missionTime, density, connectorStyle, snapToGrid, showNodeIds,
  })
  latest.current = {
    nodes, edges, annotations, result, missionTime, density, connectorStyle, snapToGrid, showNodeIds,
  }
  const persistTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const flowWrapperRef = useRef<HTMLDivElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const flowInstanceRef = useRef<ReactFlowInstance<Node, Edge> | null>(null)
  const insertionSequenceRef = useRef(0)
  useEffect(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current)
    persistTimer.current = setTimeout(() => setPersisted(latest.current), 250)
  }, [nodes, edges, annotations, result, missionTime, density, connectorStyle, snapToGrid, showNodeIds]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    if (persistTimer.current) clearTimeout(persistTimer.current)
    setPersisted(latest.current)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const seenRevision = useRef(revision)
  const seenFolio = useRef(folios.activeId)
  useEffect(() => {
    if (revision !== seenRevision.current || folios.activeId !== seenFolio.current) {
      seenRevision.current = revision
      seenFolio.current = folios.activeId
      // Discard any pending debounced write so it cannot land in the newly
      // selected folio (it belonged to the previous one).
      if (persistTimer.current) clearTimeout(persistTimer.current)
      setNodes(sanitizeNodes(persisted.nodes ?? DEFAULT_NODES))
      setAnnotations(sanitizeNodes(persisted.annotations ?? []))
      setEdges(persisted.edges ?? [])
      setSelectedNode(null)
      setSelectedNodeIds([])
      setSelectedEdgeIds([])
      setSelectedAnnotationId(null)
      setActivePathIndex(null)
      setResult(persisted.result ?? null)
      setMissionTime(persisted.missionTime ?? '1000')
      setDensity(normalizeDensity(persisted.density))
      setConnectorStyle(persisted.connectorStyle ?? 'smoothstep')
      setSnapToGrid(Boolean(persisted.snapToGrid))
      setShowNodeIds(persisted.showNodeIds !== false)
      setRightPaneMode('results')
    }
  }, [revision, folios.activeId]) // eslint-disable-line react-hooks/exhaustive-deps

  const transferTargets = useMemo(() => {
    const references = new Map(folios.folios.map(folio => {
      const state = folio.state as CanvasState | undefined
      return [folio.id, (state?.nodes ?? []).map(node => String(node.data.linkedAnalysisId ?? '')).filter(Boolean)]
    }))
    const reachesActive = (start: string, visited = new Set<string>()): boolean => {
      if (start === folios.activeId) return true
      if (visited.has(start)) return false
      visited.add(start)
      return (references.get(start) ?? []).some(next => reachesActive(next, visited))
    }
    return folios.folios.filter(folio => folio.id !== folios.activeId).map(folio => {
      const state = folio.state as CanvasState | undefined
      return {
        id: folio.id, name: folio.name, result: state?.result ?? null,
        dirty: Boolean(folio.dirty), circular: reachesActive(folio.id), state,
      }
    })
  }, [folios.folios, folios.activeId])
  const materializedNodes = useMemo(() => nodes.map(node => {
    const linkedId = String(node.data.linkedAnalysisId ?? '')
    if (!linkedId) return node
    const target = transferTargets.find(item => item.id === linkedId)
    if (!target?.result) return node
    return {
      ...node,
      data: {
        ...node.data,
        reliability: target.result.system_reliability,
        linkedAnalysisName: target.name,
        linkedAnalysisMissionTime: target.result.mission_time,
        linkedAnalysisDirty: target.dirty,
      },
    }
  }), [nodes, transferTargets])
  const linkedReferenceIssues = useMemo<RBDValidationResponse['issues']>(() => {
    const issues: RBDValidationResponse['issues'] = []
    for (const node of nodes) {
      const linkedId = String(node.data.linkedAnalysisId ?? '')
      if (!linkedId) continue
      const target = transferTargets.find(item => item.id === linkedId)
      if (!target) issues.push({ severity: 'error', code: 'MISSING_RBD_REFERENCE', node_id: node.id,
        message: `Linked RBD analysis ${String(node.data.linkedAnalysisName ?? linkedId)} no longer exists.` })
      else if (target.circular) issues.push({ severity: 'error', code: 'CIRCULAR_RBD_REFERENCE', node_id: node.id,
        message: `Linking ${target.name} creates a circular analysis dependency.` })
      else if (!target.result) issues.push({ severity: 'warning', code: 'UNEVALUATED_RBD_REFERENCE', node_id: node.id,
        message: `Linked RBD analysis ${target.name} will be calculated automatically with this model.` })
      else if (target.dirty) issues.push({ severity: 'warning', code: 'STALE_RBD_REFERENCE', node_id: node.id,
        message: `Linked RBD analysis ${target.name} will be recalculated automatically because its inputs changed.` })
    }
    return issues
  }, [nodes, transferTargets])
  const resolvedBlockIds = useMemo(() => resolveBlockIds(nodes), [nodes])
  const mirrorCounts = useMemo(() => {
    const counts = new Map<string, number>()
    nodes.filter(node => node.type === 'component').forEach(node => {
      const key = String(node.data.component_key ?? node.id)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    })
    return counts
  }, [nodes])
  const selectedAnnotation = annotations.find(node => node.id === selectedAnnotationId) ?? null
  const componentReliabilities = useMemo(() => new Map(
    (result?.components ?? []).map(component => [component.id, component.reliability]),
  ), [result])
  const validationNodeIds = useMemo(() => new Set(
    (validation?.issues ?? []).filter(issue => issue.severity === 'error' && issue.node_id)
      .map(issue => issue.node_id as string),
  ), [validation])

  const displayNodes = useMemo(() => [
    ...materializedNodes.map(node => ({
      ...node,
      data: {
        ...node.data,
        ...(node.type === 'component' ? { blockId: resolvedBlockIds.get(node.id) } : {}),
        ...(node.type === 'component' ? {
          component_key: String(node.data.component_key ?? node.id),
          mirrorCount: mirrorCounts.get(String(node.data.component_key ?? node.id)) ?? 1,
        } : {}),
        displayDensity: density,
        showNodeIds,
        computedReliability: componentReliabilities.get(node.id)
          ?? componentReliabilityPreview(node.data as Record<string, unknown>, missionTime),
        validationIssue: validationNodeIds.has(node.id),
        highlighted: highlightedNodeIds.includes(node.id),
      },
    })),
    ...annotations,
  ], [materializedNodes, annotations, resolvedBlockIds, mirrorCounts, density, showNodeIds, componentReliabilities, validationNodeIds, highlightedNodeIds, missionTime])

  const annotationEdges = useMemo<Edge[]>(() => annotations.flatMap(annotation => {
    const targetId = String(annotation.data.targetNodeId ?? '')
    const target = nodes.find(node => node.id === targetId)
    if (!target) return []
    const annotationCenter = {
      x: annotation.position.x + Number(annotation.width ?? 192) / 2,
      y: annotation.position.y + Number(annotation.height ?? 64) / 2,
    }
    const targetWidth = target.type === 'component' ? RBD_DENSITY[density].widthPx : 48
    const targetCenter = { x: target.position.x + targetWidth / 2, y: target.position.y + 30 }
    const dx = targetCenter.x - annotationCenter.x
    const dy = targetCenter.y - annotationCenter.y
    const horizontal = Math.abs(dx) >= Math.abs(dy)
    const sourceSide = horizontal ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'bottom' : 'top')
    const targetSide = horizontal ? (dx >= 0 ? 'left' : 'right') : (dy >= 0 ? 'top' : 'bottom')
    const palette = RBD_PALETTE[String(annotation.data.color ?? 'amber')] ?? RBD_PALETTE.amber
    return [{
      id: `annotation-edge:${annotation.id}`,
      source: annotation.id,
      target: target.id,
      sourceHandle: `annotation-${sourceSide}`,
      targetHandle: `annotation-target-${targetSide}`,
      type: 'straight',
      selectable: false,
      focusable: false,
      data: { isAnnotation: true },
      markerEnd: { type: MarkerType.ArrowClosed, width: 13, height: 13, color: palette.accent },
      style: {
        stroke: palette.accent,
        strokeWidth: 1.3,
        strokeDasharray: '5 4',
        opacity: Math.max(0.1, Math.min(1, Number(annotation.data.fillOpacity ?? 100) / 100)),
      },
    }]
  }), [annotations, nodes, density])

  const activePathConnectorIds = useMemo(() => {
    const ids = new Set<string>()
    if (activePathIndex == null || !result) return ids
    const componentIds = result.path_node_ids?.[activePathIndex]
      ?? nodes.filter(node => result.path_sets[activePathIndex]?.includes(String(node.data.label)))
        .map(node => node.id)
    const source = nodes.find(node => node.type === 'source')?.id
    const sink = nodes.find(node => node.type === 'sink')?.id
    if (!source || !sink) return ids
    const chain = [source, ...componentIds, sink]
    for (let index = 0; index < chain.length - 1; index += 1) {
      const edge = edges.find(candidate =>
        candidate.source === chain[index] && candidate.target === chain[index + 1])
      if (edge) ids.add(edge.id)
    }
    return ids
  }, [activePathIndex, result, nodes, edges])

  const displayEdges = useMemo(() => {
    const outgoingCounts = new Map<string, number>()
    const incomingCounts = new Map<string, number>()
    for (const edge of edges) {
      outgoingCounts.set(edge.source, (outgoingCounts.get(edge.source) ?? 0) + 1)
      incomingCounts.set(edge.target, (incomingCounts.get(edge.target) ?? 0) + 1)
    }
    return [
      ...edges.map(edge => {
        const selected = Boolean(edge.selected)
        const pathHighlighted = activePathConnectorIds.has(edge.id)
        const flowing = selected || pathHighlighted
        const stroke = selected ? '#2563eb' : pathHighlighted ? '#f59e0b' : '#64748b'
        const isolatedLinearConnection = outgoingCounts.get(edge.source) === 1
          && incomingCounts.get(edge.target) === 1
        return {
          ...edge,
          sourceHandle: 'rbd-output',
          targetHandle: 'rbd-input',
          type: connectorStyle === 'smoothstep' && isolatedLinearConnection
            ? 'straight' : connectorStyle,
          interactionWidth: 24,
          animated: flowing,
          className: [edge.className, pathHighlighted ? 'rbd-path-connector' : '']
            .filter(Boolean).join(' '),
          markerEnd: {
            type: MarkerType.ArrowClosed, width: flowing ? 20 : 16,
            height: flowing ? 20 : 16, color: stroke,
          },
          style: {
            ...edge.style,
            stroke,
            strokeWidth: flowing ? 3.2 : 1.7,
            ...(selected ? { filter: 'drop-shadow(0 0 2px rgba(37, 99, 235, 0.5))' } : {}),
            ...(pathHighlighted && !selected
              ? { filter: 'drop-shadow(0 0 2px rgba(245, 158, 11, 0.6))' } : {}),
          },
        }
      }),
      ...annotationEdges,
    ]
  }, [edges, annotationEdges, connectorStyle, activePathConnectorIds, nodes])

  // React Flow selection callbacks carry the node snapshot from the click.
  // Keep Properties bound to the current persisted/materialized node so a
  // subsequent field edit, mirror update, or linked-analysis refresh appears
  // immediately instead of leaving the original click snapshot on screen.
  useEffect(() => {
    if (!selectedNode || selectedNode.type === 'annotation') return
    const current = displayNodes.find(node => node.id === selectedNode.id)
    if (current) setSelectedNode(current)
  }, [displayNodes, selectedNode?.id])

  const invalidateResult = useCallback(() => {
    setResult(null)
    setHighlightedNodeIds([])
    setActivePathIndex(null)
  }, [])

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return
    const source = nodes.find(node => node.id === connection.source)
    const target = nodes.find(node => node.id === connection.target)
    if (!source || !target || source.type === 'sink' || target.type === 'source') return
    if (edges.some(edge => edge.source === connection.source && edge.target === connection.target)) return
    invalidateResult()
    setEdges(current => addEdge({ ...connection, id: `rbd-edge-${Date.now()}` }, current))
  }, [nodes, edges, setEdges, invalidateResult])

  const onNodesChangeWrapped = useCallback((changes: NodeChange[]) => {
    const annotationIds = new Set(annotations.map(node => node.id))
    const annotationChanges = changes.filter(change => 'id' in change && annotationIds.has(change.id))
    const modelChanges = changes.filter(change => !('id' in change) || !annotationIds.has(change.id))
    if (modelChanges.length) onNodesChange(sanitizeNodeChanges(modelChanges))
    if (annotationChanges.length) onAnnotationsChange(sanitizeNodeChanges(annotationChanges))
  }, [annotations, onNodesChange, onAnnotationsChange])

  const nextComponentId = useCallback(() => {
    let sequence = 1
    const used = new Set(nodes.map(node => node.id))
    while (used.has(`c${sequence}`)) sequence += 1
    return `c${sequence}`
  }, [nodes])

  const visibleInsertionPoint = useCallback((offset = 0) => {
    const wrapper = flowWrapperRef.current
    const instance = flowInstanceRef.current
    if (!wrapper || !instance) return { x: 260 + offset * 18, y: 160 + offset * 18 }
    const rect = wrapper.getBoundingClientRect()
    return instance.screenToFlowPosition({
      x: rect.left + rect.width * 0.52 + offset * 14,
      y: rect.top + rect.height * 0.48 + offset * 14,
    })
  }, [])

  const addComponent = () => {
    const id = nextComponentId()
    const sequence = insertionSequenceRef.current++ % 5
    const newNode: Node = {
      id,
      type: 'component',
      position: visibleInsertionPoint(sequence),
      data: {
        label: `Reliability block ${resolvedBlockIds.size + 1}`,
        description: '', reliability: 0.9,
      },
    }
    invalidateResult()
    setNodes(current => [...current, newNode])
    setSelectedNode(newNode)
    setSelectedNodeIds([id])
    setSelectedAnnotationId(null)
    setRightPaneMode('properties')
  }

  const addAnalysisBlock = (target: { id: string; name: string; result: RBDResponse | null; dirty: boolean; circular: boolean }) => {
    if (target.circular) return
    const id = nextComponentId()
    const sequence = insertionSequenceRef.current++ % 5
    const newNode: Node = {
      id, type: 'component', position: visibleInsertionPoint(sequence),
      data: {
        label: target.name,
        description: 'Linked subsystem reliability from another RBD analysis in this project.',
        diagramColor: 'cyan',
        reliability: target.result?.system_reliability ?? 1,
        linkedAnalysisId: target.id,
        linkedAnalysisName: target.name,
        linkedAnalysisMissionTime: target.result?.mission_time,
        linkedAnalysisDirty: target.dirty,
      },
    }
    invalidateResult()
    setNodes(current => [...current, newNode])
    setSelectedNode(newNode); setSelectedNodeIds([id]); setSelectedAnnotationId(null)
    setRightPaneMode('properties')
  }

  const autoLayout = () => {
    const modelIds = new Set(nodes.map(node => node.id))
    const outgoing = new Map<string, string[]>()
    const incoming = new Map<string, string[]>()
    nodes.forEach(node => { outgoing.set(node.id, []); incoming.set(node.id, []) })
    edges.forEach(edge => {
      if (!modelIds.has(edge.source) || !modelIds.has(edge.target)) return
      outgoing.get(edge.source)?.push(edge.target)
      incoming.get(edge.target)?.push(edge.source)
    })
    const indegree = new Map(nodes.map(node => [node.id, incoming.get(node.id)?.length ?? 0]))
    const queue = nodes.filter(node => (indegree.get(node.id) ?? 0) === 0)
      .map(node => node.id).sort((a, b) => a === 'source' ? -1 : b === 'source' ? 1 : a.localeCompare(b))
    const order: string[] = []
    while (queue.length) {
      const current = queue.shift() as string
      order.push(current)
      for (const child of outgoing.get(current) ?? []) {
        indegree.set(child, (indegree.get(child) ?? 1) - 1)
        if (indegree.get(child) === 0) queue.push(child)
      }
    }
    const rank = new Map<string, number>([['source', 0]])
    for (const id of order) {
      const parents = incoming.get(id) ?? []
      if (id !== 'source') rank.set(id, parents.length ? Math.max(...parents.map(parent => rank.get(parent) ?? 0)) + 1 : 0)
    }
    nodes.forEach(node => { if (!rank.has(node.id)) rank.set(node.id, 0) })
    const maxComponentRank = Math.max(1, ...nodes.filter(node => node.type === 'component').map(node => rank.get(node.id) ?? 1))
    rank.set('sink', maxComponentRank + 1)
    const layers = new Map<number, string[]>()
    nodes.forEach(node => {
      const layer = rank.get(node.id) ?? 0
      layers.set(layer, [...(layers.get(layer) ?? []), node.id])
    })
    for (let pass = 0; pass < 4; pass += 1) {
      for (const layer of [...layers.keys()].sort((a, b) => a - b)) {
        const ids = layers.get(layer) ?? []
        ids.sort((a, b) => {
          const score = (id: string) => {
            const parents = incoming.get(id) ?? []
            if (!parents.length) return nodes.find(node => node.id === id)?.position.y ?? 0
            return parents.reduce((sum, parent) => {
              const parentLayer = layers.get(rank.get(parent) ?? 0) ?? []
              return sum + Math.max(0, parentLayer.indexOf(parent))
            }, 0) / parents.length
          }
          return score(a) - score(b)
        })
      }
    }
    const xGap = RBD_DENSITY[density].gap
    const yGap = Math.max(105, RBD_DENSITY[density].widthPx * 0.62)
    const maxRows = Math.max(1, ...[...layers.values()].map(items => items.length))
    setNodes(current => current.map(node => {
      const layer = rank.get(node.id) ?? 0
      const layerNodes = layers.get(layer) ?? [node.id]
      const index = layerNodes.indexOf(node.id)
      const measuredHeight = Number(node.measured?.height ?? node.height)
      const estimatedHeight = node.type === 'component'
        ? 52 + (String(node.data.description ?? '').trim() ? 28 : 0)
          + (node.data.linkedAnalysisName ? 18 : 0) + (Number(node.data.mirrorCount ?? 1) > 1 ? 18 : 0)
        : 58
      const nodeHeight = measuredHeight > 0 ? measuredHeight : estimatedHeight
      const centerY = 110 + ((maxRows - layerNodes.length) * yGap) / 2 + index * yGap
      return {
        ...node,
        position: {
          x: 70 + layer * xGap,
          // React Flow positions nodes by their top edge. Centering unlike
          // heights on one lane keeps Source → Block → Sink handles exactly
          // horizontal instead of introducing a small visual slope or kink.
          y: centerY - nodeHeight / 2,
        },
      }
    }))
    window.setTimeout(() => flowInstanceRef.current?.fitView({ padding: 0.18, duration: 350 }), 30)
  }

  const deleteSelected = () => {
    if (selectedAnnotationId) {
      setAnnotations(current => current.filter(node => node.id !== selectedAnnotationId))
      setSelectedAnnotationId(null)
      setSelectedEdgeIds([])
      return
    }
    const removable = new Set(selectedNodeIds.filter(id => {
      const node = nodes.find(item => item.id === id)
      return node?.type === 'component'
    }))
    if (!removable.size && !selectedEdgeIds.length) return
    invalidateResult()
    setNodes(current => current.filter(node => !removable.has(node.id)))
    const removableEdges = new Set(selectedEdgeIds)
    setEdges(current => current.filter(edge => !removableEdges.has(edge.id)
      && !removable.has(edge.source) && !removable.has(edge.target)))
    setSelectedNode(null)
    setSelectedNodeIds([])
    setSelectedEdgeIds([])
  }

  const copySelected = useCallback((cut = false) => {
    const selected = nodes.filter(node => selectedNodeIds.includes(node.id) && node.type === 'component')
    if (!selected.length) return
    const ids = new Set(selected.map(node => node.id))
    setClipboard({
      nodes: selected.map(node => ({ id: node.id, type: node.type ?? 'component', data: { ...node.data }, position: { ...node.position } })),
      edges: edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)).map(edge => ({ ...edge })),
    })
    if (cut) {
      invalidateResult()
      setNodes(current => current.filter(node => !ids.has(node.id)))
      setEdges(current => current.filter(edge => !ids.has(edge.source) && !ids.has(edge.target)))
      setSelectedNode(null); setSelectedNodeIds([])
    }
  }, [nodes, edges, selectedNodeIds, setNodes, setEdges, invalidateResult])

  const pasteClipboard = useCallback(() => {
    if (!clipboard?.nodes.length) return
    const existing = new Set(nodes.map(node => node.id))
    const mapping = new Map<string, string>()
    const pasted = clipboard.nodes.map((node, index) => {
      let sequence = 1
      while (existing.has(`c${sequence}`)) sequence += 1
      const id = `c${sequence}`; existing.add(id); mapping.set(node.id, id)
      return {
        ...node, id, selected: true,
        position: { x: node.position.x + 35, y: node.position.y + 35 + index * 2 },
        data: {
          ...node.data, blockId: undefined, component_key: undefined, mirroredFrom: undefined,
          label: `${String(node.data.label ?? 'Block')} copy`,
        },
      } as Node
    })
    const pastedEdges = clipboard.edges.map((edge, index) => ({
      ...edge, id: `rbd-edge-${Date.now()}-${index}`,
      source: mapping.get(edge.source) as string, target: mapping.get(edge.target) as string,
    }))
    invalidateResult()
    setNodes(current => [...current.map(node => ({ ...node, selected: false })), ...pasted])
    setEdges(current => [...current, ...pastedEdges])
    setSelectedNodeIds(pasted.map(node => node.id)); setSelectedNode(pasted[0] ?? null)
    setRightPaneMode('properties')
  }, [clipboard, nodes, setNodes, setEdges, invalidateResult])

  const mirrorSelected = useCallback(() => {
    if (!selectedNode || selectedNode.type !== 'component' || selectedNodeIds.length !== 1) return
    const id = nextComponentId()
    const componentKey = String(selectedNode.data.component_key ?? selectedNode.id)
    const mirrored: Node = {
      ...selectedNode,
      id,
      position: visibleInsertionPoint(insertionSequenceRef.current++ % 5),
      selected: true,
      data: {
        ...selectedNode.data,
        blockId: undefined,
        component_key: componentKey,
        mirroredFrom: componentKey,
      },
    }
    invalidateResult()
    setNodes(current => [
      ...current.map(node => {
        const key = String(node.data.component_key ?? node.id)
        return { ...node, selected: false, data: key === componentKey
          ? { ...node.data, component_key: componentKey } : node.data }
      }),
      mirrored,
    ])
    setSelectedNode(mirrored); setSelectedNodeIds([id]); setSelectedAnnotationId(null)
    setRightPaneMode('properties')
  }, [selectedNode, selectedNodeIds, nextComponentId, visibleInsertionPoint, invalidateResult, setNodes])

  const detachSelectedMirror = useCallback(() => {
    if (!selectedNode || selectedNode.type !== 'component') return
    const previousKey = String(selectedNode.data.component_key ?? selectedNode.id)
    if ((mirrorCounts.get(previousKey) ?? 1) <= 1) return
    const independentKey = selectedNode.id === previousKey
      ? `independent:${selectedNode.id}:${Date.now()}` : selectedNode.id
    invalidateResult()
    setNodes(current => current.map(node => node.id === selectedNode.id ? {
      ...node,
      data: { ...node.data, component_key: independentKey, mirroredFrom: undefined },
    } : node))
    setSelectedNode(previous => previous ? {
      ...previous,
      data: { ...previous.data, component_key: independentKey, mirroredFrom: undefined },
    } : null)
  }, [selectedNode, mirrorCounts, invalidateResult, setNodes])

  const addAnnotation = (targetNodeId?: string) => {
    const id = `rbd-annotation-${Date.now()}`
    const newNode: Node = {
      id, type: 'annotation', position: visibleInsertionPoint(1),
      width: 192, height: 64,
      data: { text: 'Diagram note', color: 'amber', shape: 'rounded', fillOpacity: 90, targetNodeId },
    }
    setAnnotations(current => [...current, newNode])
    setSelectedAnnotationId(id); setSelectedNode(null); setSelectedNodeIds([]); setRightPaneMode('properties')
  }

  const updateSelectedLabel = (label: string) => {
    if (!selectedNode) return
    invalidateResult()
    const componentKey = String(selectedNode.data.component_key ?? selectedNode.id)
    setNodes(nds => nds.map(n => String(n.data.component_key ?? n.id) === componentKey
      ? { ...n, data: { ...n.data, label } } : n))
    setSelectedNode(prev => prev ? { ...prev, data: { ...prev.data, label } } : null)
  }

  const updateSelectedReliability = (r: string) => {
    if (!selectedNode) return
    invalidateResult()
    const val = parseFloat(r)
    const reliability = isNaN(val) ? 0.9 : Math.max(0, Math.min(1, val))
    const componentKey = String(selectedNode.data.component_key ?? selectedNode.id)
    setNodes(nds => nds.map(n => String(n.data.component_key ?? n.id) === componentKey
      ? { ...n, data: { ...n.data, reliability } } : n))
    setSelectedNode(prev => prev ? { ...prev, data: { ...prev.data, reliability } } : null)
  }

  const updateSelectedDataMulti = (updates: Record<string, unknown>) => {
    if (!selectedNode) return
    invalidateResult()
    const componentKey = String(selectedNode.data.component_key ?? selectedNode.id)
    setNodes(nds => nds.map(n =>
      String(n.data.component_key ?? n.id) === componentKey
        ? { ...n, data: { ...n.data, component_key: componentKey, ...updates } } : n
    ))
    setSelectedNode(prev => prev ? { ...prev, data: { ...prev.data, ...updates } } : null)
  }

  const updateSelectedData = (key: string, value: unknown) => {
    updateSelectedDataMulti({ [key]: value })
  }

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setActivePathIndex(null)
    setHighlightedNodeIds([])
    if (node.type === 'annotation') {
      setSelectedAnnotationId(node.id); setSelectedNode(null); setSelectedNodeIds([])
    } else {
      setSelectedNode(node); setSelectedNodeIds([node.id]); setSelectedAnnotationId(null)
    }
    setSelectedEdgeIds([])
    setRightPaneMode('properties')
  }, [])

  const onPaneClick = useCallback(() => {
    setSelectedNode(null); setSelectedNodeIds([]); setSelectedEdgeIds([]); setSelectedAnnotationId(null); setHighlightedNodeIds([]); setActivePathIndex(null)
  }, [])

  useEffect(() => {
    const handleCanvasShortcut = (event: KeyboardEvent) => {
      const canvas = flowWrapperRef.current
      if (!canvas?.contains(document.activeElement)) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      const modifier = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      const hasRemovableSelection = Boolean(selectedAnnotationId) || selectedEdgeIds.length > 0 || selectedNodeIds.some(id =>
        nodes.find(node => node.id === id)?.type === 'component')
      if ((event.key === 'Delete' || event.key === 'Backspace') && hasRemovableSelection) {
        event.preventDefault(); deleteSelected(); return
      }
      if (event.key === 'Escape') {
        event.preventDefault(); onPaneClick();
        setNodes(current => current.map(node => ({ ...node, selected: false })))
        setAnnotations(current => current.map(node => ({ ...node, selected: false })))
        setEdges(current => current.map(edge => ({ ...edge, selected: false })))
        return
      }
      if (!modifier) return
      if (key === 'c' && selectedNodeIds.length) { event.preventDefault(); copySelected(false); return }
      if (key === 'x' && selectedNodeIds.length) { event.preventDefault(); copySelected(true); return }
      if (key === 'v' && clipboard) { event.preventDefault(); pasteClipboard(); return }
      if (key === 'a') {
        event.preventDefault()
        const selectable = nodes.filter(node => node.type === 'component')
        const ids = selectable.map(node => node.id)
        setNodes(current => current.map(node => ({ ...node, selected: node.type === 'component' })))
        setSelectedNodeIds(ids); setSelectedNode(selectable[0] ?? null); setSelectedAnnotationId(null)
        return
      }
      if (event.shiftKey && key === 'm' && selectedNode?.type === 'component' && selectedNodeIds.length === 1) {
        event.preventDefault(); mirrorSelected(); return
      }
      if (event.shiftKey && key === 'l') { event.preventDefault(); autoLayout() }
    }
    window.addEventListener('keydown', handleCanvasShortcut)
    return () => window.removeEventListener('keydown', handleCanvasShortcut)
  }, [nodes, annotations, selectedNode, selectedNodeIds, selectedEdgeIds, selectedAnnotationId, clipboard,
    copySelected, pasteClipboard, mirrorSelected, onPaneClick])

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const mission = Number(missionTime)
        const checked = await validateRBD(
          materializedNodes.map(node => ({ id: node.id, type: node.type ?? 'component', data: node.data as Record<string, unknown> })),
          edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target })),
          Number.isFinite(mission) && mission > 0 ? { mission_time: mission } : undefined,
        )
        const linkedBlocking = linkedReferenceIssues.some(issue => issue.severity === 'error')
        setValidation(linkedReferenceIssues.length ? {
          ...checked, valid: checked.valid && !linkedBlocking,
          issues: [...linkedReferenceIssues, ...checked.issues],
        } : checked)
      } catch { setValidation(null) }
    }, 300)
    return () => window.clearTimeout(timer)
  }, [materializedNodes, edges, missionTime, linkedReferenceIssues])

  const compute = async () => {
    setError(null)
    setLoading(true)
    try {
      const resultCache = new Map<string, RBDResponse>()
      const calculateDependency = async (analysisId: string, trail: string[]): Promise<RBDResponse> => {
        const cached = resultCache.get(analysisId)
        if (cached) return cached
        if (trail.includes(analysisId)) throw new Error(`Circular RBD analysis reference: ${[...trail, analysisId].join(' → ')}`)
        const folio = folios.folios.find(item => item.id === analysisId)
        const state = folio?.state as CanvasState | undefined
        if (!folio || !state) throw new Error(`Linked RBD analysis ${analysisId} no longer exists.`)
        const resolvedNodes = []
        for (const node of state.nodes ?? []) {
          const linkedId = String(node.data.linkedAnalysisId ?? '')
          if (!linkedId) { resolvedNodes.push(node); continue }
          const dependency = await calculateDependency(linkedId, [...trail, analysisId])
          resolvedNodes.push({ ...node, data: {
            ...node.data, reliability: dependency.system_reliability,
            distribution: undefined, dist_params: undefined, mission_time: undefined,
          } })
        }
        const dependencyMission = Number(state.missionTime)
        let dependencyResult: RBDResponse
        try {
          dependencyResult = await computeRBD(
            resolvedNodes.map(node => ({ id: node.id, type: node.type ?? 'component', data: node.data as Record<string, unknown> })),
            (state.edges ?? []).map(edge => ({ id: edge.id, source: edge.source, target: edge.target })),
            Number.isFinite(dependencyMission) && dependencyMission > 0
              ? { mission_time: dependencyMission, time_points: 101 } : undefined,
          )
        } catch (error: unknown) {
          const described = describeRBDRequestError(error)
          const findings = described.issues?.length
            ? ` ${described.issues.map(issue => issue.message).join(' ')}` : ''
          throw new Error(`Linked RBD analysis “${folio.name}” could not be calculated: ${described.message}${findings}`)
        }
        resultCache.set(analysisId, dependencyResult)
        writeFolioState('system', analysisId, { ...state, result: dependencyResult })
        return dependencyResult
      }

      const recursivelyMaterializedNodes = []
      for (const node of nodes) {
        const linkedId = String(node.data.linkedAnalysisId ?? '')
        if (!linkedId) { recursivelyMaterializedNodes.push(node); continue }
        const dependency = await calculateDependency(linkedId, [folios.activeId])
        recursivelyMaterializedNodes.push({ ...node, data: {
          ...node.data, reliability: dependency.system_reliability,
          linkedAnalysisMissionTime: dependency.mission_time,
          linkedAnalysisDirty: false,
          distribution: undefined, dist_params: undefined, mission_time: undefined,
        } })
      }
      const apiNodes = recursivelyMaterializedNodes.map(n => ({
        id: n.id,
        type: n.type ?? 'component',
        data: n.data as Record<string, unknown>,
      }))
      const apiEdges = edges.map(e => ({ id: e.id, source: e.source, target: e.target }))
      const mission = Number(missionTime)
      const options = Number.isFinite(mission) && mission > 0 ? { mission_time: mission, time_points: 101 } : undefined
      const checked = await validateRBD(apiNodes, apiEdges, options)
      const currentLinkedIssues = linkedReferenceIssues.filter(issue => issue.severity === 'error')
      const combined = currentLinkedIssues.length ? {
        ...checked, valid: false, issues: [...currentLinkedIssues, ...checked.issues],
      } : checked
      setValidation(combined)
      if (!combined.valid) {
        setShowValidationIssues(true)
        setError(`Resolve ${combined.issues.filter(issue => issue.severity === 'error').length} model issue(s) before analysis.`)
        return
      }
      const res = await computeRBD(apiNodes, apiEdges, options)
      setResult(res)
      setRightPaneMode('results')
      setResultTab('overview')
      setPersisted({ ...latest.current, result: res })
    } catch (e: unknown) {
      const described = describeRBDRequestError(e)
      if (described.issues) {
        setValidation({ valid: false, issues: described.issues, summary: { nodes: nodes.length, components: nodes.filter(n => n.type === 'component').length, connections: edges.length } })
        setShowValidationIssues(true)
      }
      setError(described.message)
    } finally {
      setLoading(false)
    }
  }

  const componentProperties = selectedNode?.type === 'component' ? (() => {
    const dist = String(selectedNode.data.distribution ?? '')
    const distParams = (selectedNode.data.dist_params ?? {}) as Record<string, number>
    const hasMissionTimeOverride = selectedNode.data.mission_time != null
      && String(selectedNode.data.mission_time).trim() !== ''
    const inheritedMissionTime = Number(missionTime)
    const componentMissionTime = hasMissionTimeOverride
      ? Number(selectedNode.data.mission_time)
      : inheritedMissionTime
    const computedR = dist && Number.isFinite(componentMissionTime) && componentMissionTime >= 0
      ? 1 - computeCDF(dist, distParams, componentMissionTime) : null
    const linkedTarget = transferTargets.find(target => target.id === String(selectedNode.data.linkedAnalysisId ?? ''))
    const componentKey = String(selectedNode.data.component_key ?? selectedNode.id)
    const mirrorCount = mirrorCounts.get(componentKey) ?? 1
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Reliability block</p>
              <p className="font-mono text-xs text-slate-600">{resolvedBlockIds.get(selectedNode.id)}</p>
            </div>
            <button onClick={deleteSelected} className="mini-button !border-rose-200 !text-rose-600"><Trash2 size={12} /> Delete</button>
          </div>
        </div>
        {mirrorCount > 1 && <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-[11px] text-violet-800">
          <p className="font-semibold">Mirrored logical component · {mirrorCount} occurrences</p>
          <p className="mt-1 leading-4">All occurrences reuse one survival variable and share edits. This preserves dependence when the same physical item appears on more than one success path.</p>
          <button className="mini-button mt-2" onClick={detachSelectedMirror}>Make this occurrence independent</button>
        </div>}
        <label className="block text-xs text-slate-600">Label
          <input className="field mt-1" value={String(selectedNode.data.label ?? '')}
            onChange={event => updateSelectedLabel(event.target.value)} />
        </label>
        <label className="block text-xs text-slate-600">Description
          <textarea className="field mt-1 min-h-16 resize-y" value={String(selectedNode.data.description ?? '')}
            onChange={event => updateSelectedData('description', event.target.value)} />
        </label>
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="text-xs text-slate-600">Block color</p>
            {String(selectedNode.data.diagramColor ?? '')
              && String(selectedNode.data.diagramColor) !== 'emerald' && (
              <button type="button" onClick={() => updateSelectedData('diagramColor', undefined)}
                className="text-[9px] font-medium text-slate-500 hover:text-blue-600">
                Reset to default
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(RBD_PALETTE).map(([key, palette]) => (
              <button key={key} type="button" title={palette.label}
                aria-label={`${palette.label} block color`}
                onClick={() => updateSelectedData('diagramColor', key === 'emerald' ? undefined : key)}
                className={`h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 ${
                  String(selectedNode.data.diagramColor ?? 'emerald') === key ? 'border-slate-800 ring-2 ring-slate-200' : 'border-white'
                }`} style={{ backgroundColor: palette.accent }} />
            ))}
          </div>
        </div>
        {linkedTarget ? (
          <div className={`rounded-lg border p-3 ${linkedTarget.result && !linkedTarget.dirty
            ? 'border-cyan-200 bg-cyan-50' : 'border-amber-200 bg-amber-50'}`}>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-cyan-700">Linked RBD analysis</p>
            <p className="mt-1 text-xs font-semibold text-slate-800">{linkedTarget.name}</p>
            {linkedTarget.result ? <p className="mt-1 text-[11px] text-slate-600">
              Latest system reliability: <span className="font-mono font-semibold">{linkedTarget.result.system_reliability.toFixed(6)}</span>
              {linkedTarget.result.mission_time != null ? ` at t = ${linkedTarget.result.mission_time}` : ''}
            </p> : <p className="mt-1 text-[11px] text-amber-700">Run the referenced analysis before using this block.</p>}
            {linkedTarget.dirty && <p className="mt-1 text-[10px] text-amber-700">Referenced inputs changed; this dependency will be recalculated automatically during analysis.</p>}
            <button className="mini-button mt-2" onClick={() => updateSelectedDataMulti({
              linkedAnalysisId: undefined, linkedAnalysisName: undefined,
              linkedAnalysisMissionTime: undefined, linkedAnalysisDirty: undefined,
              reliability: linkedTarget.result?.system_reliability ?? selectedNode.data.reliability,
            })}>Detach and keep snapshot</button>
          </div>
        ) : <>
        <div className="border-t border-slate-100 pt-3">
          <label className="block text-xs text-slate-600">Reliability source
            <select className="field mt-1" value={String(selectedNode.data.ldaSource ?? '')}
              onChange={event => {
                const source = ldaFolios.find(item => item.id === event.target.value)
                if (!source) updateSelectedDataMulti({ ldaSource: undefined, ldaSourceName: undefined })
                else updateSelectedDataMulti({
                  distribution: source.dist, dist_params: source.dist_params, ldaSource: source.id,
                  ldaSourceName: `${source.name} (${source.moduleLabel})`,
                })
              }}>
              <option value="">Manual / distribution</option>
              {ldaFolios.map(source => <option key={source.id} value={source.id}>{source.name} — {source.label}</option>)}
            </select>
          </label>
        </div>
        <label className="block text-xs text-slate-600">Reliability model
          <select className="field mt-1" value={dist} onChange={event => {
            const distribution = event.target.value
            if (!distribution || !DIST_PARAMS[distribution]) {
              updateSelectedDataMulti({ distribution: undefined, dist_params: undefined })
              return
            }
            const defaults = Object.fromEntries(DIST_PARAMS[distribution].map(parameter => [parameter.key, parameter.default]))
            updateSelectedDataMulti({ distribution, dist_params: defaults,
              reliability: Math.max(0, Math.min(1, 1 - computeCDF(distribution, defaults, componentMissionTime))) })
          }}>
            {DIST_OPTIONS.map(option => <option key={option.value} value={option.value}>
              {option.value ? option.label : 'Manual (direct reliability)'}
            </option>)}
          </select>
        </label>
        {dist && DIST_PARAMS[dist] ? (
          <div className="grid grid-cols-2 gap-2">
            {DIST_PARAMS[dist].map(parameter => (
              <label key={parameter.key} className="text-[11px] text-slate-500">{parameter.label}
                <input className="field mt-1" type="number"
                  step={semanticNumericStep(parameter.label, Number(distParams[parameter.key] ?? parameter.default))}
                  value={distParams[parameter.key] ?? parameter.default} onChange={event => {
                    const nextParams = { ...distParams, [parameter.key]: Number(event.target.value) }
                    updateSelectedDataMulti({ dist_params: nextParams,
                      reliability: Math.max(0, Math.min(1, 1 - computeCDF(dist, nextParams, componentMissionTime))) })
                  }} />
              </label>
            ))}
            <label className="text-[11px] text-slate-500">Component mission time <span className="text-slate-400">— blank = system</span>
              <input className="field mt-1" type="number" min="0"
                step={semanticNumericStep('Mission time', componentMissionTime || 1000)}
                value={hasMissionTimeOverride ? String(selectedNode.data.mission_time) : ''}
                placeholder={`System: ${missionTime || 'not set'}`}
                onChange={event => {
                  const raw = event.target.value
                  const time = raw.trim() === '' ? inheritedMissionTime : Number(raw)
                  const reliability = Number.isFinite(time)
                    ? Math.max(0, Math.min(1, 1 - computeCDF(dist, distParams, time)))
                    : selectedNode.data.reliability
                  updateSelectedDataMulti({
                    mission_time: raw.trim() === '' ? undefined : Number(raw), reliability,
                  })
                }} />
              <span className="mt-1 block text-[10px] text-slate-400">
                {hasMissionTimeOverride
                  ? `Using component exposure ${componentMissionTime} at system mission ${missionTime || 'not set'}.`
                  : `Inherited from system mission time: ${missionTime || 'not set'}.`}
              </span>
            </label>
            <div className="flex items-end rounded bg-blue-50 px-2 py-1.5 text-[11px] text-blue-800">
              R(t) = {computedR == null ? '—' : computedR.toFixed(6)}
            </div>
          </div>
        ) : (
          <label className="block text-xs text-slate-600">Mission reliability (0–1)
            <input className="field mt-1" type="number" min="0" max="1" step="0.01"
              value={String(selectedNode.data.reliability ?? 0.9)}
              onChange={event => updateSelectedReliability(event.target.value)} />
          </label>
        )}
        </>}
        <div className="border-t border-slate-100 pt-3">
          <label className="block text-xs text-slate-600">Dependency model
            <select className="field mt-1" value={String(selectedNode.data.ccf_group ?? '') ? 'beta_factor' : 'independent'}
              onChange={event => updateSelectedDataMulti(event.target.value === 'beta_factor'
                ? { ccf_group: 'CCF-1', ccf_beta: 0.1 } : { ccf_group: undefined, ccf_beta: undefined })}>
              <option value="independent">Independent</option>
              <option value="beta_factor">Beta-factor common cause</option>
            </select>
          </label>
          {String(selectedNode.data.ccf_group ?? '') && <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-[11px] text-slate-500">CCF group
              <input className="field mt-1" value={String(selectedNode.data.ccf_group ?? '')}
                onChange={event => updateSelectedData('ccf_group', event.target.value)} />
            </label>
            <label className="text-[11px] text-slate-500">Beta
              <input className="field mt-1" type="number" min="0" max="1" step="0.01"
                value={String(selectedNode.data.ccf_beta ?? 0.1)}
                onChange={event => updateSelectedData('ccf_beta', Number(event.target.value))} />
            </label>
          </div>}
        </div>
      </div>
    )
  })() : null

  const annotationProperties = selectedAnnotation ? (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-700">Diagram annotation</p>
        <button onClick={deleteSelected} className="mini-button !border-rose-200 !text-rose-600"><Trash2 size={12} /> Delete</button>
      </div>
      <label className="block text-xs text-slate-600">Text
        <textarea className="field mt-1 min-h-24 resize-y" value={String(selectedAnnotation.data.text ?? '')}
          onChange={event => setAnnotations(current => current.map(node => node.id === selectedAnnotation.id
            ? { ...node, data: { ...node.data, text: event.target.value } } : node))} />
      </label>
      <label className="block text-xs text-slate-600">Callout target
        <select className="field mt-1" value={String(selectedAnnotation.data.targetNodeId ?? '')}
          onChange={event => setAnnotations(current => current.map(node => node.id === selectedAnnotation.id
            ? { ...node, data: { ...node.data, targetNodeId: event.target.value || undefined } } : node))}>
          <option value="">None — standalone note</option>
          {nodes.map(node => <option key={node.id} value={node.id}>{String(node.data.label ?? node.id)}</option>)}
        </select>
      </label>
      <div>
        <p className="mb-1 text-xs text-slate-600">Color</p>
        <div className="flex flex-wrap gap-1.5">{Object.entries(RBD_PALETTE).map(([key, palette]) => (
          <button key={key} title={palette.label} aria-label={`${palette.label} annotation color`}
            onClick={() => setAnnotations(current => current.map(node => node.id === selectedAnnotation.id
              ? { ...node, data: { ...node.data, color: key } } : node))}
            className={`h-6 w-6 rounded-full border-2 ${String(selectedAnnotation.data.color ?? 'amber') === key ? 'border-slate-800 ring-2 ring-slate-200' : 'border-white'}`}
            style={{ backgroundColor: palette.accent }} />
        ))}</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-slate-600">Shape
          <select className="field mt-1" value={String(selectedAnnotation.data.shape ?? 'rounded')}
            onChange={event => setAnnotations(current => current.map(node => node.id === selectedAnnotation.id
              ? { ...node, data: { ...node.data, shape: event.target.value } } : node))}>
            <option value="rounded">Rounded</option><option value="rectangle">Rectangle</option>
            <option value="oval">Oval</option><option value="capsule">Capsule</option>
          </select>
        </label>
        <label className="text-xs text-slate-600">Opacity
          <select className="field mt-1" value={Number(selectedAnnotation.data.fillOpacity ?? 90)}
            onChange={event => setAnnotations(current => current.map(node => node.id === selectedAnnotation.id
              ? { ...node, data: { ...node.data, fillOpacity: Number(event.target.value) } } : node))}>
            {[100, 85, 70, 50, 30].map(value => <option key={value} value={value}>{value}%</option>)}
          </select>
        </label>
      </div>
      <p className="text-[10px] leading-4 text-slate-400">Drag the resize handles on the selected annotation. A callout leader automatically follows its nearest side.</p>
    </div>
  ) : null

  const modernView = (
    <div className="flex min-h-0 flex-1 flex-col">
      <FolioBar api={folios} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="flex w-60 flex-shrink-0 flex-col border-r border-slate-200 bg-white">
          <div className="border-b border-slate-100 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div><p className="text-xs font-semibold text-slate-700">Block Library</p><p className="text-[10px] text-slate-400">Success-path building blocks</p></div>
              <div className="flex items-center gap-1" title={`Block size: ${RBD_DENSITY[density].label}`}>
                <button className="mini-button !px-1" aria-label="Decrease block size" disabled={density === 'dense'}
                  onClick={() => setDensity(RBD_DENSITY_LEVELS[Math.max(0, RBD_DENSITY_LEVELS.indexOf(density) - 1)])}><Minus size={12} /></button>
                <button className="mini-button !px-1" aria-label="Increase block size" disabled={density === 'expanded'}
                  onClick={() => setDensity(RBD_DENSITY_LEVELS[Math.min(RBD_DENSITY_LEVELS.length - 1, RBD_DENSITY_LEVELS.indexOf(density) + 1)])}><Plus size={12} /></button>
              </div>
            </div>
            <button onClick={addComponent} className="primary-button w-full"><Plus size={14} /> Add reliability block</button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <LibraryPanel mode="reliability" selectedLabel={selectedNode?.type === 'component' ? String(selectedNode.data.label) : null}
              onApply={(item: LibraryItem, value: number) => {
                if (!selectedNode || selectedNode.type !== 'component') return
                updateSelectedDataMulti({ reliability: Math.round(value * 1e6) / 1e6, linkedTo: item.name })
              }} />
            {transferTargets.length > 0 && (
              <details className="mt-3 rounded-lg border border-cyan-200 bg-cyan-50/60" data-rbd-project-library>
                <summary className="flex cursor-pointer list-none items-center justify-between px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-cyan-800 marker:hidden">
                  <span>Project RBD analyses</span>
                  <span className="rounded-full bg-white px-1.5 py-0.5 text-[9px] font-medium ring-1 ring-cyan-200">{transferTargets.length}</span>
                </summary>
                <div className="space-y-1 border-t border-cyan-200 p-1.5">
                  <p className="px-1 text-[9px] leading-tight text-cyan-700">Add another analysis as a linked subsystem block. Its latest system reliability is inherited automatically.</p>
                  {transferTargets.map(target => (
                    <button key={target.id} onClick={() => addAnalysisBlock(target)} disabled={target.circular}
                      title={target.circular ? `Cannot link ${target.name}: circular analysis dependency`
                        : target.result ? `Add linked RBD block for ${target.name}` : `Add ${target.name}; it will calculate recursively when analyzed`}
                      className="flex min-h-9 w-full items-center gap-2 rounded border border-cyan-200 bg-white px-2 py-1.5 text-left text-[10px] text-cyan-900 hover:border-cyan-400 hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-50">
                      <span className="flex h-5 w-8 shrink-0 items-center justify-center rounded border border-cyan-500 bg-cyan-50 font-mono text-[8px]">RBD</span>
                      <span className="min-w-0 flex-1"><span className="block truncate font-medium">{target.name}</span>
                        <span className="block truncate text-[9px] text-cyan-600">{target.result
                          ? `Rsys = ${target.result.system_reliability.toFixed(6)}${target.dirty ? ' · recalculates automatically' : ''}${target.circular ? ' · circular' : ''}`
                          : 'Calculates automatically when used'}</span></span>
                    </button>
                  ))}
                </div>
              </details>
            )}
          </div>
          <div className="border-t border-slate-100 p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Analysis setup</p>
            <label className="block text-xs text-slate-600">System mission time
              <input className="field mt-1" type="number" min="0" value={missionTime}
                step={semanticNumericStep('Mission time', Number(missionTime) || 1000)} onChange={event => { setMissionTime(event.target.value); invalidateResult() }} />
            </label>
            <label className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-600">
              Show block IDs
              <input type="checkbox" checked={showNodeIds} onChange={event => setShowNodeIds(event.target.checked)} />
            </label>
            <button type="button" onClick={() => setShowValidationIssues(value => !value)}
              className={`mt-3 flex w-full items-center justify-between rounded border px-2 py-1.5 text-[11px] ${
                validation?.valid ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'
              }`}>
              <span>{validation?.valid ? 'Model ready' : `${validation?.issues.filter(issue => issue.severity === 'error').length ?? '—'} model issue(s)`}</span>
              <AlertTriangle size={12} />
            </button>
            {error && <p className="mt-2 rounded bg-rose-50 p-2 text-[11px] text-rose-700">{error}</p>}
            <button onClick={compute} disabled={loading} className="primary-button mt-3 w-full py-2">
              <Play size={14} /> {loading ? 'Analyzing…' : 'Analyze RBD'}
            </button>
          </div>
        </aside>

        <CanvasErrorBoundary onReset={autoLayout}>
          <div ref={flowWrapperRef} data-rbd-canvas tabIndex={0}
            onPointerDown={event => {
              const target = event.target as HTMLElement
              if (!target.closest('button, input, textarea, select, [contenteditable="true"]')) event.currentTarget.focus()
            }}
            className="relative min-w-0 flex-1 bg-slate-50 focus:outline-none">
            <div className="absolute left-3 right-3 top-3 z-10 flex flex-wrap items-center justify-between gap-2 pointer-events-none" data-export-ignore>
              <div className="pointer-events-auto flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white/95 p-1 shadow-sm backdrop-blur">
                <button className="mini-button" onClick={autoLayout} title="Optimize success-flow layout"><LayoutGrid size={12} /> Auto Layout</button>
                <button className="mini-button" onClick={() => copySelected(false)} disabled={!selectedNodeIds.length}><Copy size={12} /> Copy</button>
                <button className="mini-button" onClick={() => copySelected(true)} disabled={!selectedNodeIds.length}><Scissors size={12} /> Cut</button>
                <button className="mini-button" onClick={pasteClipboard} disabled={!clipboard}><Clipboard size={12} /> Paste</button>
                <button className="mini-button" onClick={mirrorSelected} disabled={selectedNode?.type !== 'component' || selectedNodeIds.length !== 1}
                  title="Add another occurrence of the same logical component (Ctrl/Cmd+Shift+M)"><Repeat2 size={12} /> Mirror</button>
                <button className="mini-button" onClick={() => addAnnotation(selectedNode?.id)}><MessageSquarePlus size={12} /> Annotate</button>
                <button className={`mini-button ${snapToGrid ? '!border-blue-300 !bg-blue-50 !text-blue-700' : ''}`}
                  onClick={() => setSnapToGrid(value => !value)}><LayoutGrid size={12} /> Snap</button>
                <select aria-label="Connector style" className="rounded border border-slate-300 bg-white px-1.5 py-1 text-[10px] text-slate-600"
                  value={connectorStyle} onChange={event => setConnectorStyle(event.target.value as typeof connectorStyle)}>
                  <option value="smoothstep">Orthogonal</option><option value="bezier">Curved</option><option value="straight">Straight</option>
                </select>
                <button className="mini-button !border-rose-200 !text-rose-600" onClick={deleteSelected}
                  disabled={!selectedAnnotationId && !selectedEdgeIds.length && !selectedNodeIds.some(id => nodes.find(node => node.id === id)?.type === 'component')}>
                  <Trash2 size={12} /> Delete
                </button>
              </div>
              <div className="pointer-events-auto"><ExportDiagramButton getElement={() => flowWrapperRef.current} baseName="rbd"
                prepareExport={() => fitReactFlowForExport(flowInstanceRef.current)} /></div>
            </div>
            <ReactFlow nodes={displayNodes} edges={displayEdges} nodeTypes={nodeTypes}
              onInit={instance => { flowInstanceRef.current = instance }}
              onNodesChange={onNodesChangeWrapped}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={onNodeClick}
              onPaneClick={onPaneClick}
              onSelectionChange={({ nodes: selected, edges: selectedEdges }) => {
                if (selected.length || selectedEdges.length) {
                  setActivePathIndex(null)
                  setHighlightedNodeIds([])
                }
                const selectedAnnotations = selected.filter(node => node.type === 'annotation')
                const selectedModelNodes = selected.filter(node => node.type !== 'annotation')
                setSelectedAnnotationId(selectedAnnotations[0]?.id ?? null)
                setSelectedNodeIds(selectedModelNodes.map(node => node.id))
                setSelectedEdgeIds(selectedEdges.filter(edge => !String(edge.id).startsWith('annotation-edge:')).map(edge => edge.id))
                setSelectedNode(selectedModelNodes[0] ?? null)
              }}
              fitView snapToGrid={snapToGrid} snapGrid={[20, 20]} selectionOnDrag multiSelectionKeyCode="Shift"
              deleteKeyCode={null}>
              {snapToGrid && <Background variant={BackgroundVariant.Dots} color="#94a3b8" gap={20} size={1.2} />}
              {!snapToGrid && <Background color="#e2e8f0" gap={24} />}
              <Controls />
              <MiniMap pannable zoomable nodeColor={node => node.type === 'component'
                ? (RBD_PALETTE[String(node.data.diagramColor ?? 'emerald')] ?? RBD_PALETTE.emerald).accent : '#475569'} />
            </ReactFlow>
            {showValidationIssues && validation && (
              <div className="absolute bottom-4 left-4 z-20 max-h-64 w-[min(30rem,calc(100%-2rem))] overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 shadow-xl" data-export-ignore>
                <div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold text-slate-700">Model diagnostics</p>
                  <button className="text-xs text-slate-400 hover:text-slate-700" onClick={() => setShowValidationIssues(false)}>Close</button></div>
                <div className="space-y-1.5">{validation.issues.length ? validation.issues.map((issue, index) => (
                  <button key={`${issue.code}-${index}`} className={`block w-full rounded border px-2 py-1.5 text-left text-[11px] ${issue.severity === 'error' ? 'border-rose-100 bg-rose-50 text-rose-700' : 'border-amber-100 bg-amber-50 text-amber-700'}`}
                    onClick={() => {
                      if (!issue.node_id) return
                      setActivePathIndex(null); setHighlightedNodeIds([issue.node_id]); flowInstanceRef.current?.fitView({ nodes: [{ id: issue.node_id }], padding: 0.8, duration: 300 })
                    }}><span className="font-semibold">{issue.code.replace(/_/g, ' ')}</span> — {issue.message}</button>
                )) : <p className="text-[11px] text-emerald-700">No model issues detected.</p>}</div>
              </div>
            )}
          </div>
        </CanvasErrorBoundary>

        {(selectedNode || selectedAnnotation || result) && (
          <aside ref={resultsRef} className="flex w-[25rem] flex-shrink-0 flex-col border-l border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
              <div className="flex rounded-md bg-slate-100 p-0.5">
                <button className={`rounded px-3 py-1 text-xs ${rightPaneMode === 'properties' ? 'bg-white font-medium text-slate-800 shadow-sm' : 'text-slate-500'}`}
                  disabled={!selectedNode && !selectedAnnotation} onClick={() => setRightPaneMode('properties')}>Properties</button>
                <button className={`rounded px-3 py-1 text-xs ${rightPaneMode === 'results' ? 'bg-white font-medium text-slate-800 shadow-sm' : 'text-slate-500'}`}
                  disabled={!result} onClick={() => setRightPaneMode('results')}>Results</button>
              </div>
              {rightPaneMode === 'results' && result && <ExportResultsButton getElement={() => resultsRef.current} baseName="system-reliability" />}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {rightPaneMode === 'properties' ? (componentProperties ?? annotationProperties ?? (
                <div className="rounded bg-slate-50 p-3 text-xs text-slate-500">Source and sink terminals define success-flow boundaries and cannot be deleted.</div>
              )) : result && (
                <div>
                  <div className="mb-3 grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-blue-50 p-3"><p className="text-[10px] uppercase tracking-wide text-blue-500">System reliability</p><p className="text-xl font-bold text-blue-800">{(result.system_reliability * 100).toFixed(4)}%</p></div>
                    <div className="rounded-lg bg-rose-50 p-3"><p className="text-[10px] uppercase tracking-wide text-rose-500">Unreliability</p><p className="text-xl font-bold text-rose-800">{(result.system_unreliability * 100).toFixed(4)}%</p></div>
                  </div>
                  <div className="mb-3 flex flex-wrap gap-1 border-b border-slate-100 pb-2">
                    {(['overview', 'curve', 'paths', 'importance', 'formulas', 'method'] as const).map(tab => (
                      <button key={tab} onClick={() => setResultTab(tab)} className={`rounded px-2 py-1 text-[10px] capitalize ${resultTab === tab ? 'bg-blue-100 font-semibold text-blue-700' : 'text-slate-500 hover:bg-slate-50'}`}>{tab}</button>
                    ))}
                  </div>
                  {resultTab === 'overview' && <div className="space-y-3 text-xs">
                    {result.mission_time != null && <div className="rounded border border-slate-200 p-2"><span className="text-slate-500">Evaluated at </span><span className="font-mono font-semibold">t = {result.mission_time}</span></div>}
                    {result.restricted_mean_survival_time != null && <div className="rounded border border-slate-200 p-2"><span className="text-slate-500">Restricted mean survival time </span><span className="font-mono font-semibold">{result.restricted_mean_survival_time.toFixed(4)}</span></div>}
                    <div><p className="mb-1 font-semibold text-slate-700">Block reliabilities</p>{result.components.map(component => (
                      <button key={component.id} className="flex w-full justify-between rounded px-2 py-1 text-left hover:bg-amber-50" onClick={() => { setActivePathIndex(null); setHighlightedNodeIds([component.id]) }}>
                        <span>{component.label}</span><span className="font-mono text-slate-500">{component.reliability.toFixed(6)}</span>
                      </button>
                    ))}</div>
                    {result.warnings?.map(warning => <p key={warning} className="rounded border border-amber-200 bg-amber-50 p-2 text-amber-800">{warning}</p>)}
                  </div>}
                  {resultTab === 'curve' && <div>
                    {result.time_curve?.length ? <div className="h-80 rounded border border-slate-200">
                      <Plot data={[{ x: result.time_curve.map(point => point.time), y: result.time_curve.map(point => point.reliability), type: 'scatter', mode: 'lines', name: 'System reliability', line: { color: '#2563eb', width: 3 } }]}
                        layout={{ margin: { t: 25, r: 20, b: 50, l: 55 }, hovermode: 'x unified', xaxis: { title: { text: 'Mission time' }, gridcolor: '#e2e8f0' }, yaxis: { title: { text: 'Reliability' }, range: [0, 1.02], gridcolor: '#e2e8f0' }, showlegend: false }}
                        config={{ responsive: true, scrollZoom: true }} style={{ width: '100%', height: '100%' }} useResizeHandler />
                    </div> : <p className="rounded bg-slate-50 p-3 text-xs text-slate-500">{result.time_curve_unavailable_reason}</p>}
                  </div>}
                  {resultTab === 'paths' && <div className="space-y-1.5">
                    {result.path_sets_truncated && <p className="rounded bg-amber-50 p-2 text-[10px] text-amber-700">Showing the first {result.display_path_limit?.toLocaleString()} paths. Probability remains exact.</p>}
                    {result.path_sets.map((path, index) => <button key={index} className={`block w-full rounded border px-2 py-2 text-left text-xs ${activePathIndex === index ? 'border-amber-400 bg-amber-50 ring-1 ring-amber-200' : 'border-slate-200 hover:border-amber-300 hover:bg-amber-50'}`}
                      onClick={() => {
                        if (activePathIndex === index) {
                          setActivePathIndex(null); setHighlightedNodeIds([]); return
                        }
                        const nodeIds = result.path_node_ids?.[index]
                          ?? nodes.filter(node => path.includes(String(node.data.label))).map(node => node.id)
                        setActivePathIndex(index); setHighlightedNodeIds(nodeIds)
                      }}>
                      <span className="mr-2 font-mono text-[10px] text-slate-400">P{index + 1}</span>{path.join(' → ')}
                    </button>)}
                  </div>}
                  {resultTab === 'importance' && <div className="overflow-x-auto"><table className="w-full text-[10px]"><thead><tr className="border-b text-slate-500"><th className="py-1 text-left">Variable</th><th className="text-right">Birnbaum</th><th className="text-right">Criticality</th><th className="text-right">RAW</th><th className="text-right">RRW</th></tr></thead><tbody>{result.importance?.map(item => (
                    <tr key={item.id} className="cursor-pointer border-b border-slate-100 hover:bg-amber-50" onClick={() => { if (item.kind !== 'common_cause_survival') { setActivePathIndex(null); setHighlightedNodeIds(item.node_ids ?? [item.id]) } }}><td className="py-1.5">{item.label}{Number(item.occurrences ?? 1) > 1 ? ` ×${item.occurrences}` : ''}</td><td className="text-right font-mono">{item.Birnbaum.toFixed(4)}</td><td className="text-right font-mono">{item.Criticality?.toFixed(4) ?? '—'}</td><td className="text-right font-mono">{item.RAW?.toFixed(2) ?? '—'}</td><td className="text-right font-mono">{item.RRW_unbounded ? '∞' : item.RRW?.toFixed(2) ?? '—'}</td></tr>
                  ))}</tbody></table></div>}
                  {resultTab === 'formulas' && <div className="space-y-3">{result.formulas?.map(formula => <div key={formula.label} className="rounded border border-slate-200 p-3"><p className="mb-2 text-xs font-semibold text-slate-700">{formula.label}</p><div className="overflow-x-auto rounded bg-slate-50 p-2 text-center"><Latex block>{formula.latex}</Latex></div><p className="mt-2 text-[11px] text-slate-500">{formula.description}</p></div>)}</div>}
                  {resultTab === 'method' && <div className="space-y-3 text-xs text-slate-600">
                    <div className="rounded border border-blue-100 bg-blue-50 p-3"><p className="font-semibold text-blue-800">Exact network evaluation</p><p className="mt-1 text-[11px] leading-4">{result.computation?.engine ?? 'ROBDD'} evaluated {result.computation?.states_evaluated.toLocaleString() ?? '—'} reduced states. Displayed paths are explanatory and are not used to compute probability.</p></div>
                    <div><p className="font-semibold text-slate-700">Dependency model</p><p className="mt-1 text-[11px] leading-4">{result.dependency_model?.assumption}</p></div>
                    {result.assumptions?.map(assumption => <p key={assumption} className="rounded bg-slate-50 p-2 text-[11px]">{assumption}</p>)}
                  </div>}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  )

  return modernView
}
