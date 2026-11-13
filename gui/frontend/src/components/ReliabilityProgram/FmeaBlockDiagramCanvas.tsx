import {
  Background,
  BackgroundVariant,
  BaseEdge,
  ConnectionMode,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  NodeResizer,
  Position,
  ReactFlow,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  AlertTriangle,
  Box,
  ChevronDown,
  ChevronRight,
  Expand,
  GitBranch,
  LayoutGrid,
  Magnet,
  Maximize2,
  Minimize2,
  Minus,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Scan,
  Trash2,
  User,
  Wind,
} from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'

import type {
  AIAGVDAFMEAAnalysis,
  FMEABlockDiagramNode,
  FMEAInterface,
} from '../../api/reliabilityProgram'
import CanvasAssetControls from '../shared/CanvasAssetControls'
import DiagramLayoutMenu from '../shared/DiagramLayoutMenu'
import { normalizeLayoutOptions, layoutDensity, orderLayoutNodes, layoutLargeNestedBlocks, LAYOUT_PROFILES, type DiagramLayoutOptions } from '../shared/adaptiveDiagramLayout.mjs'
import ExportDiagramButton from '../shared/ExportDiagramButton'
import { fitReactFlowForExport } from '../shared/exportDiagram'
import { useShortcuts } from '../shared/KeyboardShortcuts'
import { DiagramFullscreenButton, useDiagramFullscreen } from '../shared/useDiagramFullscreen'
import { useUiPreference } from '../../store/uiPreferences'
import { interfaceAggregationKey } from '../shared/hierarchicalDiagram'
import { commitBlockDrag, encloseExpandedContainers, resolveExpansionCollisions } from './blockDiagramGeometry'
import { connectorAnchor, routeInterfaceConnector, type ConnectorRoute, type ConnectorStyle, type RoutingRect } from './interfaceRouting'
import InterfaceDiagramSidebar from '../shared/InterfaceDiagramSidebar'
import { ALL_RESOURCES, INTERFACE_TYPE_OPTIONS, connectedDiagramNodeIds, defaultInterfaceDiagramFilters, parseInterfaceDiagramFilters,
  diagramSelectionScope, interfaceMatchesConnections, interfaceMatchesFilters, projectInterfaceDiagramFilters,
  type DiagramResourceFlow, type DiagramResourceOption, type InterfaceDiagramFilters } from '../shared/interfaceDiagramFilters'

const BOUNDARY_ID = 'fmea-analysis-boundary'
const STRUCTURE_SELECTION_PREFIX = 'inspected-structure:'
const NO_RESOURCES: readonly DiagramResourceOption[] = []
const NO_RETAINED_STRUCTURES: readonly string[] = []
const fieldClass =
  'w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700'

const interfaceStyles: Record<FMEAInterface['interface_type'], {
  code: string
  label: string
  color: string
}> = {
  physical: { code: 'P', label: 'Physical', color: '#334155' },
  energy: { code: 'E', label: 'Energy', color: '#b91c1c' },
  information: { code: 'I', label: 'Information / data', color: '#1d4ed8' },
  material: { code: 'M', label: 'Material', color: '#047857' },
  human_machine: { code: 'H', label: 'Human-machine', color: '#7e22ce' },
  clearance: { code: 'C', label: 'Clearance / indirect', color: '#a16207' },
}

const defaultDirectionalityForType = (
  type: FMEAInterface['interface_type'],
): FMEAInterface['directionality'] =>
  type === 'physical' || type === 'clearance'
    ? 'undirected'
    : 'directed'

const externalKinds: {
  value: NonNullable<FMEABlockDiagramNode['external_kind']>
  label: string
  Icon: typeof Box
}[] = [
  { value: 'adjacent_system', label: 'Adjacent system', Icon: Box },
  { value: 'person', label: 'Person / operator', Icon: User },
  { value: 'environment', label: 'Environment', Icon: Wind },
  { value: 'other', label: 'Other external', Icon: Expand },
]

export const FMEA_EXTERNAL_CONTEXT_TARGETS = externalKinds.map(
  item => item.label,
)

const DENSITY_LEVELS = [
  'dense', 'compact', 'comfortable', 'spacious', 'expanded',
] as const
type DiagramDensity = typeof DENSITY_LEVELS[number]
const DENSITY_PRESETS: Record<DiagramDensity, {
  label: string
  sizeScale: number
  spacingScale: number
}> = {
  dense: { label: 'Dense', sizeScale: 0.98, spacingScale: 0.5 },
  compact: { label: 'Compact', sizeScale: 0.99, spacingScale: 0.72 },
  comfortable: { label: 'Comfortable', sizeScale: 1, spacingScale: 1 },
  spacious: { label: 'Spacious', sizeScale: 1.01, spacingScale: 1.45 },
  expanded: { label: 'Expanded', sizeScale: 1.02, spacingScale: 1.95 },
}

type DiagramNodeData = {
  label: string
  subtitle: string
  kind: 'structure'|'external'|'boundary'
  insideBoundary?: boolean
  externalKind?: string
  connectionEligible?: boolean
  connectionActive?: boolean
  childCount?: number
  childNames?: string
  breadcrumb?: string
  expanded?: boolean
  boundaryConflict?: boolean
  fixed?: boolean
  onToggleExpand?: () => void
  onResize?: (width: number, height: number) => void
}

type DiagramFlowNode = Node<DiagramNodeData, 'fmeaBlock'|'fmeaBoundary'>
type DiagramEdgeData = {
  color: string
  route: ConnectorRoute
  routing: { source: RoutingRect; target: RoutingRect; obstacles: RoutingRect[]; style: ConnectorStyle; lane: number }
  dashed: boolean
  code: string
  name: string
  interfaceIds: string[]
  strength: FMEAInterface['relationship_strength']
  nature: FMEAInterface['relationship_nature']
  onSelect: () => void
}
type DiagramFlowEdge = Edge<DiagramEdgeData, 'fmeaInterface'>

function DiagramBlockNode({
  data,
  selected,
}: NodeProps<DiagramFlowNode>) {
  const external = data.kind === 'external'
  const expanded = data.kind === 'structure' && Boolean(data.expanded)
  const handleClass = data.connectionActive
    ? data.connectionEligible
      ? '!h-3 !w-3 !border-blue-500 !bg-blue-200 animate-pulse'
      : '!opacity-20'
    : '!h-2.5 !w-2.5 !border-slate-400 !bg-white opacity-60 hover:opacity-100'
  return <div className={`relative h-full min-h-14 w-full rounded-lg border-2 px-3 py-2 shadow-xs transition ${
    selected
      ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-100'
      : data.boundaryConflict
        ? 'border-amber-500 bg-amber-50 ring-2 ring-amber-100'
      : expanded
        ? 'border-dashed border-blue-400 bg-blue-50/25'
      : external
        ? 'border-dashed border-violet-400 bg-violet-50'
        : data.insideBoundary
          ? 'border-slate-500 bg-white'
          : 'border-dashed border-slate-400 bg-slate-50'
  }`}>
    <NodeResizer minWidth={120} minHeight={52}
      isVisible={selected && !expanded && !data.fixed}
      onResizeEnd={(_, params) => data.onResize?.(params.width, params.height)} />
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="truncate text-xs font-semibold text-slate-800">
          {data.label || 'Unnamed block'}
        </div>
        <div title={data.breadcrumb}
          className="mt-0.5 truncate text-[9px] uppercase tracking-wide text-slate-400">
          {expanded ? 'Expanded assembly' : data.subtitle}
        </div>
      </div>
      {data.kind === 'structure' && Boolean(data.childCount) &&
        <button type="button"
          title={expanded
            ? 'Collapse direct children'
            : data.childNames
              ? `Expand direct children: ${data.childNames}`
              : 'Expand direct children'}
          aria-label={expanded
            ? `Collapse ${data.label}`
            : `Expand ${data.label}`}
          onPointerDown={event => event.stopPropagation()}
          onClick={event => {
            event.stopPropagation()
            data.onToggleExpand?.()
          }}
          className="nodrag nowheel flex shrink-0 items-center gap-0.5 rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[8px] font-medium text-blue-700 hover:border-blue-400 hover:bg-blue-100">
          {expanded ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
          {data.childCount}
        </button>}
    </div>
    {!expanded && data.kind === 'structure' && data.breadcrumb &&
      <div className="mt-1 flex items-center gap-1 truncate text-[8px] text-slate-400"
        title={data.breadcrumb}>
        <GitBranch size={8} className="shrink-0" />
        <span className="truncate">{data.breadcrumb}</span>
      </div>}
    {data.boundaryConflict &&
      <div title="This block is drawn inside the analysis boundary but is excluded from its scope."
        className="pointer-events-none absolute -bottom-2 left-2 flex items-center gap-0.5 rounded-full border border-amber-400 bg-amber-100 px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-wide text-amber-900 shadow-xs">
        <AlertTriangle size={8} /> Out of scope
      </div>}
    {[Position.Top, Position.Right, Position.Bottom, Position.Left].map(position =>
      <Handle key={position} id={String(position)} type="source"
        position={position} className={handleClass}
        style={expanded && position !== Position.Top ? position === Position.Bottom
          ? { top:32,bottom:'auto',transform:'translate(-50%, -50%)' } : { top:16 } : undefined} />)}
  </div>
}

function BoundaryNode({
  data,
  selected,
}: NodeProps<DiagramFlowNode>) {
  return <div className={`h-full w-full rounded-xl border-2 border-dashed bg-blue-50/15 ${
    selected ? 'border-blue-500' : 'border-blue-300'
  }`}>
    <NodeResizer minWidth={300} minHeight={200} isVisible={selected}
      onResizeEnd={(_, params) => data.onResize?.(params.width, params.height)} />
    <div className="inline-block rounded-br-lg rounded-tl-lg bg-blue-100/90 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
      {data.label || 'Analysis boundary'}
    </div>
  </div>
}

const nodeTypes = {
  fmeaBlock: DiagramBlockNode,
  fmeaBoundary: BoundaryNode,
}
const FMEA_BLOCK_SNAP_GRID: [number, number] = [20, 20]

const natureIndicators: Record<
  Exclude<FMEAInterface['relationship_nature'], 'unspecified'>,
  { symbol: string; label: string; className: string }
> = {
  beneficial: {
    symbol: '+',
    label: 'Beneficial',
    className: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  },
  harmful: {
    symbol: '−',
    label: 'Harmful',
    className: 'border-red-300 bg-red-50 text-red-800',
  },
  mixed: {
    symbol: '±',
    label: 'Mixed',
    className: 'border-amber-300 bg-amber-50 text-amber-900',
  },
}

function InterfaceEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  markerStart,
  markerEnd,
  style,
  selected,
  label,
}: EdgeProps<DiagramFlowEdge>) {
  const [hovered, setHovered] = useState(false)
  const route = useMemo(() => {
    if (!data) return undefined
    const source = connectorAnchor(data.routing.source, data.route.sourceSide)
    const target = connectorAnchor(data.routing.target, data.route.targetSide)
    if (Math.hypot(source.x-sourceX, source.y-sourceY) < 1
        && Math.hypot(target.x-targetX, target.y-targetY) < 1) return data.route
    return routeInterfaceConnector({ ...data.routing,
      source: { ...data.routing.source, x: data.routing.source.x+sourceX-source.x, y:data.routing.source.y+sourceY-source.y },
      target: { ...data.routing.target, x: data.routing.target.x+targetX-target.x, y:data.routing.target.y+targetY-target.y },
      sourceSide:data.route.sourceSide, targetSide:data.route.targetSide })
  }, [data, sourceX, sourceY, targetX, targetY])
  const path = route?.path ?? ''
  const labelPoint = route?.label ?? { x:sourceX,y:sourceY }
  const strength = data?.strength === 'unspecified'
    ? undefined : data?.strength
  const nature = data?.nature === 'unspecified'
    ? undefined : data?.nature
  const natureIndicator = nature ? natureIndicators[nature] : undefined
  const hasRelationshipIndicator = Boolean(strength || natureIndicator)
  const expandedLabel = selected || hovered
  const count = data?.interfaceIds.length ?? 1
  const relationshipWidth = strength === 'strong'
    ? 3 : strength === 'weak' ? 1.25 : 2
  return <>
    <BaseEdge id={id} path={path} markerStart={markerStart}
      markerEnd={markerEnd} interactionWidth={18}
      style={{
        ...style,
        stroke: data?.color,
        strokeWidth: selected ? Math.max(3.5, relationshipWidth + 1) : relationshipWidth,
        strokeDasharray: data?.dashed ? '7 5' : undefined,
      }} />
    {label && <foreignObject
      x={labelPoint.x
        - (expandedLabel ? 70 : 28)}
      y={labelPoint.y
        - (expandedLabel && hasRelationshipIndicator ? 19 : 9)}
      width={expandedLabel ? 140 : 56}
      height={expandedLabel && hasRelationshipIndicator ? 40 : 18}
      className="pointer-events-auto overflow-visible">
      <button type="button"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        onClick={event => {
          event.stopPropagation()
          data?.onSelect()
        }}
        className={`max-w-full rounded border bg-white/95 px-1 py-px text-center text-[8px] font-medium shadow-xs ${
        selected ? 'border-blue-400 text-blue-800' : 'border-slate-200 text-slate-600'
      }`} title={[
        data?.name || String(label),
        count > 1 ? `${count} underlying interfaces` : '',
        strength ? `Strength: ${strength}` : '',
        natureIndicator ? `Nature: ${natureIndicator.label}` : '',
      ].filter(Boolean).join(' · ')}>
        <div className="flex items-center justify-center gap-0.5">
          <span className="font-bold" style={{ color: data?.color }}>
            {data?.code ?? label}
          </span>
          {count > 1 && <span className="text-[7px] text-slate-500">
            ×{count}
          </span>}
          {!expandedLabel && strength &&
            <span className="text-[6px] font-bold uppercase text-slate-600">
              {strength === 'strong' ? 'S' : 'W'}
            </span>}
          {!expandedLabel && natureIndicator &&
            <span className="text-[7px] font-bold">
              {natureIndicator.symbol}
            </span>}
          {expandedLabel && <span className="min-w-0 truncate">
            {data?.name
              ? `· ${data.name}`
              : count > 1 ? `· ${count} interfaces` : ''}
          </span>}
        </div>
        {expandedLabel && hasRelationshipIndicator &&
          <div className="mt-px flex items-center justify-center gap-0.5">
          {strength && <span className={`rounded border px-0.5 text-[6px] uppercase tracking-wide ${
            strength === 'strong'
              ? 'border-slate-500 bg-slate-100 font-bold text-slate-800'
              : 'border-dashed border-slate-400 bg-white font-normal text-slate-600'
          }`}>
            {strength}
          </span>}
          {natureIndicator && <span className={`rounded border px-0.5 text-[6px] font-semibold ${
            natureIndicator.className
          }`}>
            {natureIndicator.symbol} {natureIndicator.label}
          </span>}
        </div>}
      </button>
    </foreignObject>}
  </>
}

const edgeTypes = { fmeaInterface: InterfaceEdge }

const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

function endpointPatch(
  node: FMEABlockDiagramNode,
  side: 'source'|'target',
): Partial<FMEAInterface> {
  if (side === 'source') {
    return node.kind === 'structure'
      ? {
          source_structure_node_id: node.structure_node_id,
          external_source: '',
        }
      : {
          source_structure_node_id: undefined,
          external_source: node.label,
        }
  }
  return node.kind === 'structure'
    ? {
        target_structure_node_id: node.structure_node_id,
        external_target: '',
      }
    : {
        target_structure_node_id: undefined,
        external_target: node.label,
      }
}

export default function FmeaBlockDiagramCanvas({
  analysis,
  update,
  findingNavigation,
  fillHeight = false,
  allowCanonicalEditing = false,
  focusView = false,
  hideCreationTools = false,
  hideAnalysisBoundary = false,
  implicitRootStructureId,
  interfaceEndpoints,
  interfaceDescriptions,
  interfaceResourceIds,
  interfaceResourceFlows,
  initialSelectedStructureId,
  onCollapseAllSystems,
  hasExpandedSystems,
  interfaceInspector,
  libraryContent,
  hiddenStructureIds,
  onStructureSelect,
  structureSelection,
  onStructureFocus,
  canFocusStructure,
  structureInspector,
  assetTargetView,
  displayPreferenceKey,
  resourceOptions = NO_RESOURCES,
  retainedStructureIds = NO_RETAINED_STRUCTURES,
}: {
  analysis: AIAGVDAFMEAAnalysis
  update: (patch: Partial<AIAGVDAFMEAAnalysis>) => void
  fillHeight?: boolean
  allowCanonicalEditing?: boolean
  focusView?: boolean
  hideCreationTools?: boolean
  hideAnalysisBoundary?: boolean
  implicitRootStructureId?: string
  /** Rendering endpoints only. Inspector edits always target original records. */
  interfaceEndpoints?: Record<string, { source: string; target: string }>
  interfaceDescriptions?: Record<string, string>
  interfaceResourceIds?: Record<string, string[]>
  interfaceResourceFlows?: Record<string, DiagramResourceFlow[]>
  initialSelectedStructureId?: string
  onCollapseAllSystems?: () => void
  hasExpandedSystems?: boolean
  interfaceInspector?: (interfaceId: string) => ReactNode
  libraryContent?: ReactNode
  hiddenStructureIds?: ReadonlySet<string>
  onStructureSelect?: (structureId: string) => void
  structureSelection?: { structureId: string; requestId: number }
  onStructureFocus?: (structureId: string) => void
  canFocusStructure?: (structureId: string) => boolean
  structureInspector?: (structureId: string) => ReactNode
  assetTargetView?: string
  displayPreferenceKey?: string
  resourceOptions?: readonly DiagramResourceOption[]
  /** Keep the active FMEA focus in view even when no interfaces match. */
  retainedStructureIds?: readonly string[]
  findingNavigation?: {
    requestId: number
    record_id?: string
  }|null
}) {
  const diagram = analysis.block_diagram
  const layoutInterfaces = useMemo(() => interfaceEndpoints
    ? analysis.interfaces.flatMap(item => interfaceEndpoints[item.id]
      ? [{ ...item, source_block_id: interfaceEndpoints[item.id].source,
          target_block_id: interfaceEndpoints[item.id].target }] : [])
    : analysis.interfaces, [analysis.interfaces, interfaceEndpoints])
  const density = DENSITY_LEVELS.includes(diagram.density)
    ? diagram.density : 'comfortable'
  const densityPreset = DENSITY_PRESETS[density]
  const layoutOptions = normalizeLayoutOptions(diagram.layoutOptions, density)
  const [selectedNodeId, setSelectedNodeId] = useState('')
  // Keep the connection anchor while inspecting an edge or clicking canvas space.
  const [connectionSelection, setConnectionSelection] = useState<{nodeId?:string;structureId?:string}>({ structureId: initialSelectedStructureId })
  useEffect(() => {
    if (initialSelectedStructureId) setConnectionSelection({ structureId: initialSelectedStructureId })
  }, [initialSelectedStructureId])
  const [selectedInterfaceId, setSelectedInterfaceId] = useState('')
  const [selectedInterfaceGroupId, setSelectedInterfaceGroupId] = useState('')
  const [connectingFromId, setConnectingFromId] = useState('')
  const [flowNodes, setFlowNodes] = useState<DiagramFlowNode[]>([])
  const liveFlowNodes = useRef<DiagramFlowNode[]>([])
  const dragMoved = useRef(false)
  const [inspectorOpen, setInspectorOpen] = useUiPreference<boolean>('interfaceDiagram.propertiesOpen', true)
  const [filterJson, setFilterJson] = useUiPreference<string>(`interfaceDiagram.filters:${displayPreferenceKey ?? analysis.id}`, '')
  const filters = useMemo(() => parseInterfaceDiagramFilters(filterJson, resourceOptions), [filterJson, resourceOptions])
  const changeFilters = (value: InterfaceDiagramFilters) => setFilterJson(JSON.stringify(value))
  const inspectorId = useId()
  const inspectorToggle = useRef<HTMLButtonElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const flowRef = useRef<ReactFlowInstance<DiagramFlowNode, DiagramFlowEdge>|null>(null)
  const fullscreen = useDiagramFullscreen('System interface diagram', () => flowRef.current)
  const diagramRef = useRef(diagram)
  const updateRef = useRef(update)
  const selectedNodeIdRef = useRef(selectedNodeId)
  const lastStructureSelection = useRef(structureSelection?.requestId)
  const lastFindingNavigation = useRef('')
  const pendingInterfaceFit = useRef('')
  diagramRef.current = diagram
  updateRef.current = update
  selectedNodeIdRef.current = selectedNodeId

  const structureById = useMemo(
    () => new Map(analysis.structure_nodes.map(node => [node.id, node])),
    [analysis.structure_nodes],
  )
  const diagramById = useMemo(
    () => new Map(diagram.nodes.map(node => [node.id, node])),
    [diagram.nodes],
  )
  const connectionNode = connectionSelection.nodeId ? diagramById.get(connectionSelection.nodeId) : undefined
  const connectionStructure = structureById.get(connectionSelection.structureId ?? connectionNode?.structure_node_id ?? '')
  const selectedBlockLabel = connectionStructure?.name ?? connectionNode?.label
  const selectedScope = useMemo(() => selectedBlockLabel
    ? diagramSelectionScope(diagram.nodes, analysis.structure_nodes, connectionSelection) : undefined,
  [diagram.nodes, analysis.structure_nodes, connectionSelection, selectedBlockLabel])
  const directionalFilterActive = Boolean(interfaceResourceFlows && selectedScope && filters.connections !== 'all')
  const filterProjection = useMemo(() => projectInterfaceDiagramFilters(analysis.interfaces, diagram.nodes,
    filters, interfaceResourceIds, interfaceEndpoints, interfaceResourceFlows, interfaceResourceFlows ? selectedScope : undefined),
  [analysis.interfaces, diagram.nodes, filters, interfaceResourceIds, interfaceEndpoints, interfaceResourceFlows, selectedScope])
  const matchingInterfaceIds = useMemo(() => new Set(filterProjection.matching.map(value => value.item.id)), [filterProjection])
  const renderNodeIds = useMemo(() => filters.onlyConnected || directionalFilterActive
    ? connectedDiagramNodeIds(diagram.nodes, filterProjection.matching,
      [...retainedStructureIds, ...(directionalFilterActive && connectionStructure ? [connectionStructure.id] : [])],
      directionalFilterActive && connectionNode ? [connectionNode.id] : [])
    : new Set(diagram.nodes.map(node => node.id)),
  [diagram.nodes, filterProjection, filters.onlyConnected, retainedStructureIds, directionalFilterActive, connectionNode, connectionStructure])
  const renderNodes = useMemo(() => diagram.nodes.filter(node => renderNodeIds.has(node.id)), [diagram.nodes, renderNodeIds])
  const revealInterface = (item: FMEAInterface) => {
    const excludedDirection = directionalFilterActive && !interfaceMatchesConnections(interfaceResourceFlows?.[item.id] ?? [], filters, selectedScope)
    if (excludedDirection || !interfaceMatchesFilters(item, interfaceResourceIds?.[item.id] ?? [], filters)) changeFilters({ ...filters,
      types: filters.types.includes(item.interface_type) ? filters.types : [...filters.types, item.interface_type],
      resource: ALL_RESOURCES,
      connections: excludedDirection ? 'all' : filters.connections,
    })
  }
  useEffect(() => {
    const recordId = findingNavigation?.record_id
    if (!recordId) return
    const requestKey = JSON.stringify([findingNavigation?.requestId, recordId])
    if (lastFindingNavigation.current === requestKey) return
    setInspectorOpen(true)
    if (diagramById.has(recordId)) {
      lastFindingNavigation.current = requestKey
      if (!renderNodeIds.has(recordId)) changeFilters({ ...filters, onlyConnected: false })
      setSelectedNodeId(recordId)
      if (recordId !== BOUNDARY_ID) setConnectionSelection({ nodeId: recordId })
      setSelectedInterfaceId('')
      setSelectedInterfaceGroupId('')
      window.requestAnimationFrame(() => {
        void flowRef.current?.fitView({
          nodes: [{ id: recordId }],
          duration: 300,
          maxZoom: 1.25,
          padding: 0.8,
        })
      })
      return
    }
    if (analysis.interfaces.some(item => item.id === recordId)) {
      lastFindingNavigation.current = requestKey
      pendingInterfaceFit.current = recordId
      revealInterface(analysis.interfaces.find(item => item.id === recordId)!)
      setSelectedNodeId('')
      setSelectedInterfaceId(recordId)
      setSelectedInterfaceGroupId('')
    }
  }, [
    analysis.interfaces,
    diagramById,
    findingNavigation?.record_id,
    findingNavigation?.requestId,
  ])
  const structureBlockByStructureId = useMemo(
    () => new Map(diagram.nodes.flatMap(node =>
      node.kind === 'structure' && node.structure_node_id
        ? [[node.structure_node_id, node] as const] : [])),
    [diagram.nodes],
  )
  useEffect(() => {
    if (!structureSelection || !structureById.has(structureSelection.structureId)) return
    const block = structureBlockByStructureId.get(structureSelection.structureId)
    const id = block?.id ?? `${STRUCTURE_SELECTION_PREFIX}${structureSelection.structureId}`
    setSelectedNodeId(id)
    setConnectionSelection({ structureId: structureSelection.structureId })
    setSelectedInterfaceId('')
    setSelectedInterfaceGroupId('')
    // Restoring this view may replay its retained selection. Only a new user
    // selection opens the inspector; tab changes retain the saved toggle.
    if (lastStructureSelection.current !== structureSelection.requestId) {
      setInspectorOpen(true)
      if (block && !renderNodeIds.has(block.id) && !directionalFilterActive) changeFilters({ ...filters, onlyConnected: false })
    }
    lastStructureSelection.current = structureSelection.requestId
    const nodes = liveFlowNodes.current.map(node => ({ ...node,selected:node.id === id }))
    liveFlowNodes.current = nodes
    setFlowNodes(nodes)
    // This is an explicit hierarchy-selection event. Geometry and canonical
    // model changes must not replay it or displace an interface selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureSelection?.requestId,structureSelection?.structureId])

  const containedChildrenByBlockId = useMemo(() => {
    const result = new Map<string, FMEABlockDiagramNode[]>()
    for (const node of renderNodes) {
      if (!node.container_parent_block_id
          || !diagramById.has(node.container_parent_block_id)) continue
      result.set(node.container_parent_block_id, [
        ...(result.get(node.container_parent_block_id) ?? []),
        node,
      ])
    }
    return result
  }, [renderNodes, diagramById])
  const projectedSizeById = useMemo(() => {
    const result = new Map<string, { width: number; height: number }>()
    const measure = (id: string, trail = new Set<string>()) => {
      const existing = result.get(id)
      if (existing) return existing
      const node = diagramById.get(id)
      if (!node || trail.has(id)) return { width: 180, height: 72 }
      const children = containedChildrenByBlockId.get(id) ?? []
      if (!node.expanded || !children.length) {
        const size = {
          width: node.width * densityPreset.sizeScale,
          height: node.height * densityPreset.sizeScale,
        }
        result.set(id, size)
        return size
      }
      const nextTrail = new Set(trail).add(id)
      let right = node.x + node.width * densityPreset.sizeScale
      let bottom = node.y + node.height * densityPreset.sizeScale
      for (const child of children) {
        const childSize = measure(child.id, nextTrail)
        right = Math.max(
          right,
          child.x + childSize.width + 20 * densityPreset.spacingScale,
        )
        bottom = Math.max(
          bottom,
          child.y + childSize.height + 20 * densityPreset.spacingScale,
        )
      }
      const size = {
        width: Math.max(
          node.width * densityPreset.sizeScale,
          right - node.x,
        ),
        height: Math.max(
          node.height * densityPreset.sizeScale,
          bottom - node.y,
        ),
      }
      result.set(id, size)
      return size
    }
    renderNodes.forEach(node => measure(node.id))
    return result
  }, [
    containedChildrenByBlockId,
    densityPreset.sizeScale,
    densityPreset.spacingScale,
    renderNodes,
    diagramById,
  ])
  const visibleBlockIds = useMemo(() => {
    const visible = new Set<string>()
    for (const node of renderNodes) {
      const visited = new Set<string>()
      let current = node
      let hidden = false
      while (current.container_parent_block_id) {
        if (visited.has(current.id)) {
          hidden = true
          break
        }
        visited.add(current.id)
        const parent = diagramById.get(current.container_parent_block_id)
        if (!parent) break
        if (!parent.expanded) {
          hidden = true
          break
        }
        current = parent
      }
      if (!hidden) visible.add(node.id)
    }
    return visible
  }, [renderNodes, diagramById])

  const structureBreadcrumb = (structureId?: string) => {
    if (!structureId) return ''
    const names: string[] = []
    const visited = new Set<string>()
    let parentId = structureById.get(structureId)?.parent_id
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId)
      const parent = structureById.get(parentId)
      if (!parent) break
      names.unshift(parent.name || parent.id)
      parentId = parent.parent_id
    }
    return names.join(' › ')
  }

  const structureIndenture = (structureId?: string) => {
    let depth = 1, parent = structureById.get(structureId ?? '')?.parent_id
    const visited = new Set<string>()
    while (parent && !visited.has(parent)) {
      visited.add(parent); depth++; parent = structureById.get(parent)?.parent_id
    }
    return depth
  }

  const commitNodeSize = (id: string, width: number, height: number) => {
    const currentDiagram = diagramRef.current
    if (id === BOUNDARY_ID) {
      updateRef.current({ block_diagram: {
        ...currentDiagram,
        boundary: { ...currentDiagram.boundary, width, height },
      } })
      return
    }
    updateRef.current({ block_diagram: {
      ...currentDiagram,
      nodes: currentDiagram.nodes.map(node =>
        node.id === id ? { ...node, width, height } : node),
    } })
  }

  const toggleStructureBlock = (blockId: string) => {
    const parent = diagramById.get(blockId)
    const structure = parent?.structure_node_id
      ? structureById.get(parent.structure_node_id) : undefined
    if (!parent || parent.kind !== 'structure' || !structure) return
    setSelectedNodeId(parent.id)
    setSelectedInterfaceId('')
    setSelectedInterfaceGroupId('')
    if (parent.expanded) {
      update({ block_diagram: {
        ...diagram,
        nodes: diagram.nodes.map(node =>
          node.id === blockId ? { ...node, expanded: false } : node),
      } })
      return
    }
    const children = analysis.structure_nodes.filter(
      item => item.parent_id === structure.id)
    if (!children.length) return
    const nextNodes = [...diagram.nodes]
    const childBlocks = children.map(child => {
      const existingIndex = nextNodes.findIndex(node =>
        node.kind === 'structure'
        && node.structure_node_id === child.id)
      if (existingIndex >= 0) return {
        index: existingIndex,
        node: nextNodes[existingIndex],
        created: false,
      }
      const created: FMEABlockDiagramNode = {
        id: newId('BDN'),
        kind: 'structure',
        structure_node_id: child.id,
        container_parent_block_id: parent.id,
        expanded: false,
        label: child.name || child.id,
        x: parent.x,
        y: parent.y,
        width: 180,
        height: 72,
        inside_boundary: parent.inside_boundary,
      }
      nextNodes.push(created)
      return { index: nextNodes.length - 1, node: created, created: true }
    })
    // Reopening an assembly must retain its manual layout. Place only blocks
    // introduced by this expansion, below any already-positioned children.
    const added = childBlocks.filter(child => child.created)
    const columns = Math.max(1, Math.ceil(Math.sqrt(added.length)))
    let rowY = parent.y + 46
    for (const child of childBlocks.filter(child => !child.created)) {
      nextNodes[child.index] = { ...child.node, container_parent_block_id: parent.id,
        inside_boundary: parent.inside_boundary }
      rowY = Math.max(rowY, child.node.y + (projectedSizeById.get(child.node.id)?.height ?? child.node.height) + 20)
    }
    for (let start = 0; start < added.length; start += columns) {
      const row = added.slice(start, start + columns)
      let columnX = parent.x + 20
      let rowHeight = 0
      for (const child of row) {
        const size = projectedSizeById.get(child.node.id)
          ?? { width: child.node.width, height: child.node.height }
        nextNodes[child.index] = {
          ...child.node,
          container_parent_block_id: parent.id,
          inside_boundary: parent.inside_boundary,
          x: columnX,
          y: rowY,
        }
        columnX += size.width + 20
        rowHeight = Math.max(rowHeight, size.height)
      }
      rowY += rowHeight + 20
    }
    const parentIndex = nextNodes.findIndex(node => node.id === blockId)
    nextNodes[parentIndex] = { ...nextNodes[parentIndex], expanded: true }
    update({ block_diagram: resolveExpansionCollisions(encloseExpandedContainers(
      { ...diagram, nodes: nextNodes }, 20 * densityPreset.spacingScale,
    ), blockId, 20 * densityPreset.spacingScale, densityPreset.sizeScale) })
  }

  // Keep persisted diagram geometry and React Flow's transient node state on
  // separate tracks. Rebuilding every node in response to selectedNodeId made
  // insertion unstable: React Flow reported the new selection while this
  // effect replaced its nodes, which could repeatedly clear/reapply selection.
  // This key changes only when model-owned render data changes.
  const flowProjectionKey = JSON.stringify({
    boundary: diagram.boundary,
    density,
    nodes: renderNodes,
    structures: analysis.structure_nodes.map(node => ({
      id: node.id,
      name: node.name,
      level: node.level,
      parentId: node.parent_id,
    })),
    connectingFromId, hideAnalysisBoundary, implicitRootStructureId,
  })

  useEffect(() => {
    const source = diagramById.get(connectingFromId)
    const projected: DiagramFlowNode[] = hideAnalysisBoundary ? [] : [{
      id: BOUNDARY_ID,
      type: 'fmeaBoundary',
      position: { x: diagram.boundary.x, y: diagram.boundary.y },
      style: {
        width: diagram.boundary.width,
        height: diagram.boundary.height,
        zIndex: -10,
      },
      data: {
        label: diagram.boundary.label,
        subtitle: '',
        kind: 'boundary',
        onResize: (width, height) =>
          commitNodeSize(BOUNDARY_ID, width, height),
      },
    }]
    const ordered: FMEABlockDiagramNode[] = []
    const visit = (node: FMEABlockDiagramNode, trail = new Set<string>()) => {
      if (!visibleBlockIds.has(node.id) || trail.has(node.id)) return
      ordered.push(node)
      const nextTrail = new Set(trail).add(node.id)
      for (const child of containedChildrenByBlockId.get(node.id) ?? []) {
        visit(child, nextTrail)
      }
    }
    for (const node of diagram.nodes) {
      if (!node.container_parent_block_id
          || !diagramById.has(node.container_parent_block_id)) {
        visit(node)
      }
    }
    for (const node of diagram.nodes) {
      if (!ordered.some(item => item.id === node.id)) visit(node)
    }
    projected.push(...ordered.map(node => {
      const structure = node.structure_node_id
        ? structureById.get(node.structure_node_id)
        : undefined
      const implicitRoot = structure?.id === implicitRootStructureId
      const children = structure && !implicitRoot
        ? analysis.structure_nodes.filter(item =>
          item.parent_id === structure.id && !hiddenStructureIds?.has(item.id)
          && (!(filters.onlyConnected || directionalFilterActive) || renderNodeIds.has(structureBlockByStructureId.get(item.id)?.id ?? '')))
        : []
      const eligible = !!source && node.id !== source.id
        && (source.kind === 'structure' || node.kind === 'structure')
      const parent = node.container_parent_block_id
        ? diagramById.get(node.container_parent_block_id) : undefined
      const size = projectedSizeById.get(node.id)
        ?? { width: node.width, height: node.height }
      const centerX = node.x + size.width / 2
      const centerY = node.y + size.height / 2
      const physicallyInsideBoundary =
        centerX >= diagram.boundary.x
        && centerX <= diagram.boundary.x + diagram.boundary.width
        && centerY >= diagram.boundary.y
        && centerY <= diagram.boundary.y + diagram.boundary.height
      return {
        id: node.id,
        type: 'fmeaBlock' as const,
        draggable: !implicitRoot,
        position: parent?.expanded
          ? { x: node.x - parent.x, y: node.y - parent.y }
          : { x: node.x, y: node.y },
        parentId: parent?.expanded ? parent.id : undefined,
        // React Flow grows the container while dragging instead of clamping
        // its children to a tightly packed collapsed/expanded layout.
        extent: undefined,
        expandParent: Boolean(parent?.expanded),
        width: size.width,
        height: size.height,
        style: {
          width: size.width,
          height: size.height,
          zIndex: node.expanded ? 0 : 2,
        },
        data: {
          label: structure?.name ?? node.label,
          fixed: implicitRoot,
          subtitle: implicitRoot ? 'L1 · System boundary endpoint' : node.kind === 'structure'
            ? `L${structureIndenture(node.structure_node_id)} · ${structure?.level.replace(/_/g, ' ') ?? 'Missing structure record'}`
            : node.external_kind?.replace(/_/g, ' ') ?? 'External',
          kind: node.kind,
          insideBoundary: node.inside_boundary,
          externalKind: node.external_kind,
          childCount: children.length,
          childNames: children.map(child =>
            child.name || child.id).join(', '),
          breadcrumb: structureBreadcrumb(node.structure_node_id),
          expanded: Boolean(node.expanded),
          boundaryConflict: !hideAnalysisBoundary && !node.inside_boundary && physicallyInsideBoundary,
          onToggleExpand: () => toggleStructureBlock(node.id),
          connectionActive: !!connectingFromId,
          connectionEligible: eligible,
          onResize: (width: number, height: number) =>
            commitNodeSize(
              node.id,
              width / densityPreset.sizeScale,
              height / densityPreset.sizeScale,
            ),
        },
      }
    }))
    const currentById = new Map(liveFlowNodes.current.map(node => [node.id, node]))
    const next = projected.map(node => {
      const existing = currentById.get(node.id)
      return {
        // Preserve React Flow-owned measurements and interaction state while
        // replacing model-owned geometry and display data.
        ...existing,
        ...node,
        selected: selectedNodeIdRef.current
          ? selectedNodeIdRef.current === node.id
          : Boolean(existing?.selected),
      }
    })
    liveFlowNodes.current = next
    setFlowNodes(next)
  // flowProjectionKey covers the persisted geometry, structure labels, and
  // connection state used by this projection. Selection is deliberately not
  // a dependency; React Flow owns it between model revisions.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowProjectionKey])

  const visibleRepresentative = (blockId: string) => {
    let current = diagramById.get(blockId)
    if (!current) return undefined
    const visited = new Set<string>()
    let representative = current
    while (current.container_parent_block_id
        && !visited.has(current.id)) {
      visited.add(current.id)
      const parent = diagramById.get(current.container_parent_block_id)
      if (!parent) break
      if (!parent.expanded) representative = parent
      current = parent
    }
    return visibleBlockIds.has(representative.id)
      ? representative : undefined
  }
  const projectedInterfaceGroups = useMemo(() => {
    const groups = new Map<string, {
      id: string
      source: FMEABlockDiagramNode
      target: FMEABlockDiagramNode
      items: FMEAInterface[]
    }>()
    for (const { item } of filterProjection.matching) {
      const endpoints = interfaceEndpoints?.[item.id]
      if (interfaceEndpoints && !endpoints) continue
      const sourceId = endpoints?.source ?? item.source_block_id
      const targetId = endpoints?.target ?? item.target_block_id
      if (!sourceId || !targetId) continue
      const source = visibleRepresentative(sourceId)
      const target = visibleRepresentative(targetId)
      if (!source || !target || source.id === target.id) continue
      const key = interfaceAggregationKey(source.id, target.id, item, interfaceResourceIds?.[item.id])
      const existing = groups.get(key)
      if (existing) existing.items.push(item)
      else groups.set(key, {
        id: key,
        source,
        target,
        items: [item],
      })
    }
    const result = [...groups.values()]
    for (const group of result) {
      group.items.sort((left, right) => left.id.localeCompare(right.id))
      group.id = group.items.length === 1
        ? group.items[0].id
        : `IFG-${group.items.map(item => item.id).join('-')}`
    }
    return result
  // visibleRepresentative is a pure projection over these dependencies.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterProjection, diagram.nodes, visibleBlockIds, interfaceEndpoints, interfaceResourceIds])
  const projectedGroupsByEndpoint = useMemo(() => {
    const result = new Map<string, typeof projectedInterfaceGroups>()
    for (const group of projectedInterfaceGroups) {
      const key = [group.source.id, group.target.id]
        .sort().join('\u0000')
      result.set(key, [...(result.get(key) ?? []), group])
    }
    for (const groups of result.values()) {
      groups.sort((left, right) => left.id.localeCompare(right.id))
    }
    return result
  }, [projectedInterfaceGroups])

  const routingObstacles = useMemo(() => diagram.nodes.filter(node => visibleBlockIds.has(node.id))
    .map(node => ({ id:node.id,x:node.x,y:node.y,
      width:projectedSizeById.get(node.id)?.width ?? node.width,
      height:node.expanded ? 32 : projectedSizeById.get(node.id)?.height ?? node.height })),
  [diagram.nodes,visibleBlockIds,projectedSizeById])

  const routedEdges = useMemo<DiagramFlowEdge[]>(() =>
    projectedInterfaceGroups.map(group => {
      const item = group.items[0]
      const style = interfaceStyles[item.interface_type]
      const endpointKey = [group.source.id, group.target.id]
        .sort().join('\u0000')
      const siblings = projectedGroupsByEndpoint.get(endpointKey) ?? [group]
      const index = siblings.findIndex(value => value.id === group.id)
      const offset = (index - (siblings.length - 1) / 2) * LAYOUT_PROFILES[layoutOptions.mode].corridor * 0.45
      const marker = {
        type: MarkerType.ArrowClosed,
        color: style.color,
        width: 14,
        height: 14,
      }
      const interfaceIds = group.items.map(value => value.id)
      const names = [...new Set(group.items.map(value =>
        value.name.trim()).filter(Boolean))]
      const name = names.length === 1
        ? names[0]
        : group.items.length > 1
          ? `${group.items.length} interfaces`
          : ''
      const select = () => {
        setSelectedNodeId('')
        setSelectedInterfaceId(interfaceIds.length === 1
          ? interfaceIds[0] : '')
        setSelectedInterfaceGroupId(
          interfaceIds.length > 1 ? group.id : '')
      }
      const sourceSize = projectedSizeById.get(group.source.id)
        ?? { width: group.source.width, height: group.source.height }
      const targetSize = projectedSizeById.get(group.target.id)
        ?? { width: group.target.width, height: group.target.height }
      const routing = {
        source: { id:group.source.id,x:group.source.x,y:group.source.y,width:sourceSize.width,
          height:group.source.expanded ? 32 : sourceSize.height },
        target: { id:group.target.id,x:group.target.x,y:group.target.y,width:targetSize.width,
          height:group.target.expanded ? 32 : targetSize.height },
        obstacles: routingObstacles,
        style: diagram.connectorStyle ?? 'curved' as ConnectorStyle,
        lane: offset,
      }
      const route = routeInterfaceConnector(routing)
      return {
        id: group.id,
        type: 'fmeaInterface',
        source: group.source.id,
        target: group.target.id,
        // Attachment sides follow the current geometry. Persisted handle IDs
        // describe where a connector was drawn, but become misleading after
        // Auto Layout or hierarchy expansion moves either endpoint.
        sourceHandle: route.sourceSide,
        targetHandle: route.targetSide,
        label: style.code,
        markerEnd: item.directionality === 'undirected' ? undefined : marker,
        markerStart: item.directionality === 'bidirectional'
          ? marker : undefined,
        data: {
          color: style.color,
          code: style.code,
          name,
          interfaceIds,
          route, routing,
          dashed: item.linkage === 'indirect'
            || item.interface_type === 'clearance',
          strength: item.relationship_strength,
          nature: item.relationship_nature,
          onSelect: select,
        },
      }
    }), [
      projectedGroupsByEndpoint,
      projectedInterfaceGroups, layoutOptions.mode,
      projectedSizeById, routingObstacles, diagram.connectorStyle,
    ])
  // Selection changes only paint. Reusing routes avoids a graph-wide obstacle
  // search on every inspector click or keyboard selection.
  const flowEdges = useMemo<DiagramFlowEdge[]>(() => routedEdges.map(edge => ({ ...edge,
    selected: Boolean(edge.data?.interfaceIds.includes(selectedInterfaceId)) || selectedInterfaceGroupId === edge.id,
  })), [routedEdges,selectedInterfaceId,selectedInterfaceGroupId])
  const previousFilterJson = useRef(filterJson)
  const previousSelectedInterface = useRef<{ id: string; signature: string; filters: string } | null>(null)
  useEffect(() => {
    if (previousFilterJson.current === filterJson) return
    previousFilterJson.current = filterJson
    if (selectedInterfaceId && !matchingInterfaceIds.has(selectedInterfaceId)) setSelectedInterfaceId('')
    if (selectedInterfaceGroupId && !projectedInterfaceGroups.some(group => group.id === selectedInterfaceGroupId)) setSelectedInterfaceGroupId('')
    if (selectedNodeId && diagramById.has(selectedNodeId) && !renderNodeIds.has(selectedNodeId)) setSelectedNodeId('')
  }, [filterJson, matchingInterfaceIds, projectedInterfaceGroups, renderNodeIds, diagramById,
    selectedInterfaceId, selectedInterfaceGroupId, selectedNodeId])
  useEffect(() => {
    const selected = analysis.interfaces.find(item => item.id === selectedInterfaceId)
    const signature = selected ? JSON.stringify([selected.interface_type, interfaceResourceIds?.[selected.id] ?? [], interfaceResourceFlows?.[selected.id] ?? []]) : ''
    const previous = previousSelectedInterface.current
    previousSelectedInterface.current = { id: selectedInterfaceId, signature, filters: filterJson }
    // Editing an open canonical transfer inspector must not make that record
    // disappear. Explicit filter changes still clear hidden selections above.
    if (selected && previous?.id === selected.id && previous.signature !== signature && previous.filters === filterJson)
      revealInterface(selected)
    // revealInterface reads this render's filter state; the signature prevents
    // reapplying a preference in response to unrelated canonical changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis.interfaces, interfaceResourceIds, interfaceResourceFlows, selectedInterfaceId, filterJson])
  useEffect(() => {
    const group = projectedInterfaceGroups.find(item => item.items.some(value => value.id === pendingInterfaceFit.current))
    if (!group) return
    pendingInterfaceFit.current = ''
    window.requestAnimationFrame(() => {
      void flowRef.current?.fitView({ nodes: [{ id: group.source.id }, { id: group.target.id }], padding: 0.3, maxZoom: 1.25, duration: 300 })
    })
  }, [projectedInterfaceGroups, findingNavigation?.requestId])

  const updateDiagramNode = (
    id: string,
    patch: Partial<FMEABlockDiagramNode>,
  ) => {
    const inheritedScope = patch.inside_boundary
    const descendants = new Set<string>()
    if (inheritedScope != null) {
      const visit = (parentId: string) => {
        for (const child of diagram.nodes.filter(item =>
          item.container_parent_block_id === parentId)) {
          if (descendants.has(child.id)) continue
          descendants.add(child.id)
          visit(child.id)
        }
      }
      visit(id)
    }
    const nextNodes = diagram.nodes.map(node => {
      if (node.id === id) return { ...node, ...patch }
      return descendants.has(node.id)
        ? { ...node, inside_boundary: inheritedScope as boolean }
        : node
    })
    let interfaces = analysis.interfaces
    if ('label' in patch) {
      const updated = nextNodes.find(node => node.id === id)
      if (updated?.kind === 'external') {
        interfaces = interfaces.map(item => ({
          ...item,
          ...(item.source_block_id === id
            ? { external_source: updated.label } : {}),
          ...(item.target_block_id === id
            ? { external_target: updated.label } : {}),
        }))
      }
    }
    update({
      block_diagram: { ...diagram, nodes: nextNodes },
      interfaces,
    })
  }

  const addStructureBlock = (structureId: string) => {
    if (filters.onlyConnected) changeFilters({ ...filters, onlyConnected: false })
    const nextNodes = [...diagram.nodes]
    const byStructure = new Map(nextNodes.flatMap(node => node.structure_node_id ? [[node.structure_node_id, node] as const] : []))
    const requested = structureById.get(structureId)
    if (!requested) return
    const register = (id: string, ancestors = new Set<string>()): FMEABlockDiagramNode | undefined => {
      if (byStructure.has(id)) return byStructure.get(id)
      if (ancestors.has(id)) return undefined
      const structure = structureById.get(id)
      if (!structure) return undefined
      const parent = structure.parent_id ? register(structure.parent_id, new Set(ancestors).add(id)) : undefined
      if (structure.parent_id && !parent) return undefined
      const siblings = nextNodes.filter(node => node.container_parent_block_id === parent?.id)
      const created: FMEABlockDiagramNode = {
        id: newId('BDN'), kind: 'structure', structure_node_id: id,
        container_parent_block_id: parent?.id, expanded: false,
        label: structure.name || id,
        x: (parent?.x ?? diagram.boundary.x + 46) + 24 + siblings.length % 2 * 216,
        y: (parent?.y ?? diagram.boundary.y + 24) + 56 + Math.floor(siblings.length / 2) * 108,
        width: 180, height: 72, inside_boundary: parent?.inside_boundary
          ?? (structure.level !== 'next_higher' && structure.level !== 'interface'),
      }
      byStructure.set(id, created); nextNodes.push(created)
      return created
    }
    const created = register(structureId)
    if (!created) return
    // An assembly includes its entire hierarchy, even while its child blocks are closed.
    const pending = [structureId], visited = new Set<string>()
    for (let at = 0; at < pending.length; at++) {
      const id = pending[at]
      if (visited.has(id)) continue
      visited.add(id); register(id)
      pending.push(...analysis.structure_nodes.filter(item => item.parent_id === id).map(item => item.id))
    }
    let parent = requested.parent_id
    const ancestorIds = new Set<string>()
    while (parent && !ancestorIds.has(parent)) {
      ancestorIds.add(parent); parent = structureById.get(parent)?.parent_id
    }
    update({ block_diagram: { ...diagram, nodes: nextNodes.map(node => node.structure_node_id && ancestorIds.has(node.structure_node_id)
      ? { ...node, expanded: true } : node) } })
    setSelectedNodeId(created.id)
  }

  const addExternalBlock = (
    externalKind: NonNullable<FMEABlockDiagramNode['external_kind']>,
  ) => {
    if (filters.onlyConnected) changeFilters({ ...filters, onlyConnected: false })
    const count = diagram.nodes.filter(node => node.kind === 'external').length
    const label = externalKinds.find(item => item.value === externalKind)?.label
      ?? 'External element'
    const created: FMEABlockDiagramNode = {
      id: newId('BDX'),
      kind: 'external',
      external_kind: externalKind,
      label,
      x: diagram.boundary.x + diagram.boundary.width + 80,
      y: diagram.boundary.y + 50 + count * 100,
      width: 180,
      height: 72,
      inside_boundary: false,
    }
    update({ block_diagram: {
      ...diagram,
      nodes: [...diagram.nodes, created],
    } })
    setSelectedNodeId(created.id)
  }

  const isValidConnection = (connection: Connection) => {
    if (!connection.source || !connection.target
        || connection.source === connection.target) return false
    const source = diagramById.get(connection.source)
    const target = diagramById.get(connection.target)
    return !!source && !!target
      && (source.kind === 'structure' || target.kind === 'structure')
  }

  const connect = (connection: Connection) => {
    if (!isValidConnection(connection)) return
    const source = diagramById.get(connection.source!)!
    const target = diagramById.get(connection.target!)!
    const created: FMEAInterface = {
      id: newId('IF'),
      name: '',
      interface_type: 'information',
      source_block_id: source.id,
      target_block_id: target.id,
      source_handle: connection.sourceHandle ?? undefined,
      target_handle: connection.targetHandle ?? undefined,
      linkage: 'direct',
      directionality: 'directed',
      relationship_strength: 'unspecified',
      relationship_nature: 'unspecified',
      interface_detail: '',
      ...endpointPatch(source, 'source'),
      ...endpointPatch(target, 'target'),
      external_source: source.kind === 'external' ? source.label : '',
      external_target: target.kind === 'external' ? target.label : '',
      flow_description: '',
      operating_condition: '',
      function_ids: [],
      requirement_ids: [],
    }
    update({ interfaces: [...analysis.interfaces, created] })
    revealInterface(created)
    setSelectedInterfaceId(created.id)
    setSelectedInterfaceGroupId('')
    setSelectedNodeId('')
    setInspectorOpen(true)
  }

  const changeInterface = (patch: Partial<FMEAInterface>) => {
    if (selectedInterface?.system_definition_ref && !allowCanonicalEditing) return
    if (selectedInterface) revealInterface({ ...selectedInterface, ...patch })
    update({ interfaces: analysis.interfaces.map(item =>
      item.id === selectedInterfaceId ? { ...item, ...patch } : item) })
  }

  const removeInterface = (item: FMEAInterface) => {
    if (item.system_definition_ref && !allowCanonicalEditing) return
    if ((item.function_ids.length || item.requirement_ids.length)
        && !window.confirm(
          `Delete interface "${item.name || item.id}"?\n\n`
          + 'Its function and requirement links will also be removed.',
        )) return
    update({ interfaces: analysis.interfaces.filter(value => value.id !== item.id) })
    setSelectedInterfaceId('')
    setSelectedInterfaceGroupId('')
  }

  const canvasFocused = () =>
    Boolean(wrapperRef.current?.contains(document.activeElement))
  useShortcuts([{
    id: 'fmea-block-diagram.delete-interface',
    label: 'Delete selected connector',
    category: 'FMEA Block Diagram',
    bindings: [{ key: 'Delete' }, { key: 'Backspace' }],
    scope: 'canvas',
    keyWhen: canvasFocused,
    enabled: Boolean(selectedInterfaceId),
    disabledReason: 'Select a connector in the FMEA Block Diagram first.',
    handler: () => {
      const item = analysis.interfaces.find(
        value => value.id === selectedInterfaceId)
      if (item) removeInterface(item)
    },
  }])

  const removeDiagramNode = (node: FMEABlockDiagramNode) => {
    const removed = new Set<string>(), pending = [node.id]
    for (let at = 0; at < pending.length; at++) {
      const id = pending[at]
      if (removed.has(id)) continue
      removed.add(id)
      pending.push(...diagram.nodes.filter(item => item.container_parent_block_id === id).map(item => item.id))
    }
    const connected = analysis.interfaces.filter(item => removed.has(item.source_block_id ?? '') || removed.has(item.target_block_id ?? ''))
    if ((connected.length || removed.size > 1) && !window.confirm(
      `Remove "${node.label}" and its ${removed.size - 1} contained blocks from the diagram?\n\n`
      + `${connected.length} connected interface records will be removed. Structure records remain available.`,
    )) return
    update({ block_diagram: { ...diagram, nodes: diagram.nodes.filter(item => !removed.has(item.id)) },
      interfaces: analysis.interfaces.filter(item => !connected.some(edge => edge.id === item.id)),
    })
    setSelectedNodeId('')
  }

  const autoLayout = (options: DiagramLayoutOptions = layoutOptions) => {
    const selectedDensity = layoutDensity(options.mode)
    const layoutPreset = DENSITY_PRESETS[selectedDensity]
    const profile = LAYOUT_PROFILES[options.mode]
    if (diagram.nodes.length > 500 || analysis.interfaces.length > 2000) {
      const parents = new Set(diagram.nodes.map(node => node.container_parent_block_id))
      const placed = layoutLargeNestedBlocks(diagram.nodes.map(node => ({
        id: node.id, x: node.x, y: node.y, width: node.width, height: node.height,
        parentId: node.container_parent_block_id, expanded: node.expanded,
        insideBoundary: node.inside_boundary, kind: parents.has(node.id) ? 'gate' : 'event',
      })), diagram.boundary, options)
      update({ block_diagram: { ...diagram, density: selectedDensity, layoutOptions: options,
        boundary: placed.boundary, nodes: diagram.nodes.map(node => ({ ...node, ...placed.positions[node.id] })) } })
      window.requestAnimationFrame(() => { void flowRef.current?.fitView({ padding: 0.14, duration: 350 }) })
      return
    }
    const sizeScale = layoutPreset.sizeScale
    const spacingScale = layoutPreset.spacingScale
    const next = diagram.nodes.map(node => ({ ...node }))
    const visualById = new Map(diagram.nodes.map(node => [node.id, node]))
    const indexById = new Map(next.map((node, index) => [node.id, index]))
    const nodeFor = (id: string) => {
      const index = indexById.get(id)
      return index == null ? undefined : next[index]
    }
    const childIds = new Map<string, string[]>()
    next.forEach(node => {
      if (node.container_parent_block_id) childIds.set(node.container_parent_block_id,
        [...(childIds.get(node.container_parent_block_id) ?? []), node.id])
    })
    const childrenOf = (parentId: string) => (childIds.get(parentId) ?? []).map(id => nodeFor(id)!)
    const descendants = (rootId: string) => {
      const result = new Set<string>()
      const stack = [rootId]
      while (stack.length) for (const child of childrenOf(stack.pop()!)) {
        if (result.has(child.id) || child.id === rootId) continue
        result.add(child.id); stack.push(child.id)
      }
      return result
    }
    const moveBranch = (node: FMEABlockDiagramNode, x: number, y: number) => {
      const dx = x - node.x
      const dy = y - node.y
      const branch = descendants(node.id)
      for (const id of new Set([node.id, ...branch])) {
        const index = indexById.get(id)
        if (index == null) continue
        next[index] = {
          ...next[index],
          x: next[index].x + dx,
          y: next[index].y + dy,
        }
      }
    }
    const branchSize = (
      id: string,
      trail = new Set<string>(),
    ): { width: number; height: number } => {
      const node = nodeFor(id)
      if (!node || trail.has(id)) return { width: 180, height: 72 }
      const children = childrenOf(id)
      if (!node.expanded || !children.length) {
        return {
          width: node.width * sizeScale,
          height: node.height * sizeScale,
        }
      }
      const nextTrail = new Set(trail).add(id)
      let right = node.x + node.width * sizeScale
      let bottom = node.y + node.height * sizeScale
      for (const child of children) {
        const childSize = branchSize(child.id, nextTrail)
        right = Math.max(
          right,
          child.x + childSize.width + 20 * spacingScale,
        )
        bottom = Math.max(
          bottom,
          child.y + childSize.height + 20 * spacingScale,
        )
      }
      return {
        width: Math.max(node.width * sizeScale, right - node.x),
        height: Math.max(node.height * sizeScale, bottom - node.y),
      }
    }
    const rootOf = (id?: string) => {
      let current = id ? nodeFor(id) : undefined
      const visited = new Set<string>()
      while (current?.container_parent_block_id
          && !visited.has(current.id)) {
        visited.add(current.id)
        const parent = nodeFor(current.container_parent_block_id)
        if (!parent) break
        current = parent
      }
      return current
    }
    const directChildUnder = (parentId: string, endpointId?: string) => {
      let current = endpointId ? nodeFor(endpointId) : undefined
      const visited = new Set<string>()
      while (current?.container_parent_block_id
          && !visited.has(current.id)) {
        visited.add(current.id)
        if (current.container_parent_block_id === parentId) return current
        current = nodeFor(current.container_parent_block_id)
      }
      return undefined
    }
    const directedEdges = (
      ids: string[],
      project: (endpointId?: string) => FMEABlockDiagramNode|undefined,
    ) => {
      const allowed = new Set(ids)
      const keys = new Set<string>()
      const result: Array<[string, string]> = []
      for (const item of layoutInterfaces) {
        if (item.directionality !== 'directed') continue
        const source = project(item.source_block_id)
        const target = project(item.target_block_id)
        if (!source || !target || source.id === target.id
            || !allowed.has(source.id) || !allowed.has(target.id)) continue
        const key = `${source.id}\u0000${target.id}`
        if (keys.has(key)) continue
        keys.add(key)
        result.push([source.id, target.id])
      }
      return result
    }
    const layoutRanks = (ids: string[], edges: Array<[string, string]>) => {
      const rank = new Map(ids.map(id => [id, 0]))
      if (!edges.length) {
        let columns = Math.max(1, Math.ceil(Math.sqrt(ids.length)))
        if (options.optimizeLabelGeometry && ids.length <= 500) {
          let best = Infinity
          for (let count = 1; count <= Math.min(12, ids.length); count++) {
            const rows = Math.ceil(ids.length / count)
            let width = 0, height = 0
            for (let start = 0; start < ids.length; start += rows) {
              const sizes = ids.slice(start, start + rows).map(id => branchSize(id))
              width += Math.max(...sizes.map(size => size.width)) + (start ? profile.layerGap : 0)
              height = Math.max(height, sizes.reduce((sum, size) => sum + size.height, 0) + profile.nodeGap * (sizes.length - 1))
            }
            const cost = width * height + 0.3 * (width - height) ** 2
            if (cost < best) { best = cost; columns = count }
          }
        }
        const rows = Math.max(1, Math.ceil(ids.length / columns))
        ids.forEach((id, index) => rank.set(id, Math.floor(index / rows)))
        return rank
      }
      const incoming = new Map(ids.map(id => [id, 0]))
      const outgoing = new Map(ids.map(id => [id, [] as string[]]))
      for (const [source, target] of edges) {
        outgoing.get(source)?.push(target)
        incoming.set(target, (incoming.get(target) ?? 0) + 1)
      }
      const queue = ids.filter(id => incoming.get(id) === 0)
        .sort((left, right) => left.localeCompare(right))
      const visited = new Set<string>()
      while (queue.length) {
        const source = queue.shift() as string
        visited.add(source)
        for (const target of outgoing.get(source) ?? []) {
          rank.set(target, Math.max(
            rank.get(target) ?? 0,
            (rank.get(source) ?? 0) + 1,
          ))
          incoming.set(target, (incoming.get(target) ?? 1) - 1)
          if (incoming.get(target) === 0) {
            queue.push(target)
            queue.sort((left, right) => left.localeCompare(right))
          }
        }
      }
      // Cycles and bidirectional subsystems should remain compact instead of
      // producing ever-increasing ranks. Place unresolved peers together in
      // the nearest established column.
      const fallbackRank = Math.max(0, ...rank.values())
      ids.filter(id => !visited.has(id)).forEach(id =>
        rank.set(id, fallbackRank))
      return rank
    }
    const rankedColumns = (
      ids: string[],
      edges: Array<[string, string]>,
      orderScore?: (id: string) => number|undefined,
    ) => {
      const ranks = layoutRanks(ids, edges)
      const columns = new Map<number, string[]>()
      for (const id of ids) {
        const rank = ranks.get(id) ?? 0
        columns.set(rank, [...(columns.get(rank) ?? []), id])
      }
      return [...columns.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, column]) => orderLayoutNodes(column.map(id => {
          const node = visualById.get(id)!
          return { id, x: node.x, y: node.y, width: node.width, height: node.height,
            kind: childrenOf(id).length ? 'gate' as const : 'event' as const }
        }), options, true, id => orderScore?.(id) ?? visualById.get(id)?.y ?? 0).map(node => node.id))
    }
    const columnMetrics = (columns: string[][], gapX: number, gapY: number) => ({
      width: columns.reduce((sum, column, index) =>
        sum + Math.max(...column.map(id => branchSize(id).width), 0)
        + (index ? gapX : 0), 0),
      height: Math.max(0, ...columns.map(column =>
        column.reduce((sum, id, index) =>
          sum + branchSize(id).height + (index ? gapY : 0), 0))),
    })
    const placeColumns = (
      columns: string[][],
      startX: number,
      startY: number,
      availableHeight: number,
      gapX: number,
      gapY: number,
    ) => {
      let x = startX
      for (const column of columns) {
        const sizes = column.map(id => branchSize(id))
        const height = sizes.reduce((sum, size, index) =>
          sum + size.height + (index ? gapY : 0), 0)
        let y = startY + Math.max(0, (availableHeight - height) / 2)
        column.forEach((id, index) => {
          const node = nodeFor(id)
          if (!node) return
          moveBranch(node, x, y)
          y += sizes[index].height + gapY
        })
        x += Math.max(...sizes.map(size => size.width), 0) + gapX
      }
    }
    const layoutContainer = (
      parentId: string,
      trail = new Set<string>(),
      alignCrossAssembly = false,
    ) => {
      const parent = nodeFor(parentId)
      if (!parent || trail.has(parentId)) return
      const children = childrenOf(parentId)
      const nextTrail = new Set(trail).add(parentId)

      if (!parent.expanded || !children.length) return
      const ids = children.map(child => child.id)
      const edges = directedEdges(
        ids,
        endpointId => directChildUnder(parentId, endpointId),
      )
      const incoming = new Set<string>()
      const outgoing = new Set<string>()
      const neighborY = new Map<string, number[]>()
      for (const item of analysis.interfaces) {
        const sourceChild = directChildUnder(parentId, item.source_block_id)
        const targetChild = directChildUnder(parentId, item.target_block_id)
        if (sourceChild && !targetChild) outgoing.add(sourceChild.id)
        if (targetChild && !sourceChild) incoming.add(targetChild.id)
        if (!alignCrossAssembly) continue
        if (sourceChild && sourceChild.id !== targetChild?.id) {
          const counterpart = nodeFor(item.target_block_id ?? '')
          if (counterpart) neighborY.set(sourceChild.id, [
            ...(neighborY.get(sourceChild.id) ?? []),
            counterpart.y + branchSize(counterpart.id).height / 2,
          ])
        }
        if (targetChild && targetChild.id !== sourceChild?.id) {
          const counterpart = nodeFor(item.source_block_id ?? '')
          if (counterpart) neighborY.set(targetChild.id, [
            ...(neighborY.get(targetChild.id) ?? []),
            counterpart.y + branchSize(counterpart.id).height / 2,
          ])
        }
      }
      const score = (id: string) => {
        const values = neighborY.get(id)
        return values?.length
          ? values.reduce((sum, value) => sum + value, 0) / values.length
          : undefined
      }
      let columns = rankedColumns(ids, edges, score)
      if (!edges.length && (incoming.size || outgoing.size)) {
        const inputs = ids.filter(id =>
          incoming.has(id) && !outgoing.has(id))
        const through = ids.filter(id =>
          (incoming.has(id) && outgoing.has(id))
          || (!incoming.has(id) && !outgoing.has(id)))
        const outputs = ids.filter(id =>
          outgoing.has(id) && !incoming.has(id))
        columns = [inputs, through, outputs]
          .filter(column => column.length)
          .map(column => orderLayoutNodes(column.map(id => {
            const node = visualById.get(id)!
            return { id, x: node.x, y: node.y, width: node.width, height: node.height,
              kind: childrenOf(id).length ? 'gate' as const : 'event' as const }
          }), options, true, score).map(node => node.id))
      }
      const childGapX = profile.layerGap
      const childGapY = profile.nodeGap
      const metrics = columnMetrics(columns, childGapX, childGapY)
      placeColumns(
        columns,
        parent.x + 24 * spacingScale,
        parent.y + 52 * spacingScale,
        metrics.height,
        childGapX,
        childGapY,
      )
    }
    const roots = next.filter(node =>
      !node.container_parent_block_id
      || !indexById.has(node.container_parent_block_id))
    const visitedContainers = new Set<string>()
    const containerOrder: string[] = []
    const stack = roots.map(node => ({ id: node.id, done: false }))
    while (stack.length) {
      const entry = stack.pop()!
      if (entry.done) { containerOrder.push(entry.id); continue }
      if (visitedContainers.has(entry.id)) continue
      visitedContainers.add(entry.id); stack.push({ id: entry.id, done: true })
      childrenOf(entry.id).forEach(child => stack.push({ id: child.id, done: false }))
    }
    containerOrder.forEach(id => layoutContainer(id))
    const inside = roots.filter(node => node.inside_boundary)
    const outside = roots.filter(node => !node.inside_boundary)
    const insideIds = inside.map(node => node.id)
    const insideEdges = directedEdges(
      insideIds,
      endpointId => rootOf(endpointId),
    )
    const insideColumns = rankedColumns(insideIds, insideEdges)
    const rootGapX = profile.layerGap
    const rootGapY = profile.nodeGap
    const insideMetrics = columnMetrics(insideColumns, rootGapX, rootGapY)
    const horizontalPadding = 55 * spacingScale
    const topPadding = 70 * spacingScale
    const bottomPadding = 40 * spacingScale
    const nextBoundary = {
      ...diagram.boundary,
      width: Math.max(
        300,
        insideMetrics.width + horizontalPadding * 2,
      ),
      height: Math.max(
        200,
        insideMetrics.height + topPadding + bottomPadding,
      ),
    }
    placeColumns(
      insideColumns,
      nextBoundary.x + horizontalPadding,
      nextBoundary.y + topPadding,
      nextBoundary.height - topPadding - bottomPadding,
      rootGapX,
      rootGapY,
    )
    const externalRole = (node: FMEABlockDiagramNode) => {
      if (node.external_kind === 'environment') return 'top'
      let source = 0
      let target = 0
      for (const item of analysis.interfaces) {
        if (rootOf(item.source_block_id)?.id === node.id) source += 1
        if (rootOf(item.target_block_id)?.id === node.id) target += 1
      }
      if (source > target) return 'left'
      if (target > source) return 'right'
      const center = node.x + branchSize(node.id).width / 2
      return center < nextBoundary.x + nextBoundary.width / 2
        ? 'left' : 'right'
    }
    const top = outside.filter(node => externalRole(node) === 'top')
    const left = outside.filter(node => externalRole(node) === 'left')
    const right = outside.filter(node => externalRole(node) === 'right')
    const externalConnectionCoordinate = (
      node: FMEABlockDiagramNode,
      axis: 'x'|'y',
    ) => {
      const values: number[] = []
      for (const item of analysis.interfaces) {
        const sourceRoot = rootOf(item.source_block_id)
        const targetRoot = rootOf(item.target_block_id)
        const counterpartId = sourceRoot?.id === node.id
          ? item.target_block_id
          : targetRoot?.id === node.id
            ? item.source_block_id : undefined
        const counterpart = nodeFor(counterpartId ?? '')
        if (!counterpart) continue
        const size = branchSize(counterpart.id)
        values.push(axis === 'x'
          ? counterpart.x + size.width / 2
          : counterpart.y + size.height / 2)
      }
      return values.length
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : axis === 'x' ? node.x : node.y
    }
    const sortOutside = () => {
      left.sort((a, b) =>
        externalConnectionCoordinate(a, 'y')
          - externalConnectionCoordinate(b, 'y'))
      right.sort((a, b) =>
        externalConnectionCoordinate(a, 'y')
          - externalConnectionCoordinate(b, 'y'))
      top.sort((a, b) =>
        externalConnectionCoordinate(a, 'x')
          - externalConnectionCoordinate(b, 'x'))
    }
    const placeVertical = (
      nodes: FMEABlockDiagramNode[],
      side: 'left'|'right',
    ) => {
      const gap = 28 * spacingScale
      const total = nodes.reduce((sum, node, index) =>
        sum + branchSize(node.id).height + (index ? gap : 0), 0)
      let y = nextBoundary.y
        + Math.max(0, (nextBoundary.height - total) / 2)
      for (const node of nodes) {
        const size = branchSize(node.id)
        moveBranch(
          node,
          side === 'left'
            ? nextBoundary.x - size.width - 70 * spacingScale
            : nextBoundary.x + nextBoundary.width + 70 * spacingScale,
          y,
        )
        y += size.height + gap
      }
    }
    const placeOutside = () => {
      placeVertical(left, 'left')
      placeVertical(right, 'right')
      let topX = nextBoundary.x + 35 * spacingScale
      for (const node of top) {
        const size = branchSize(node.id)
        moveBranch(
          node,
          topX,
          nextBoundary.y - size.height - 60 * spacingScale,
        )
        topX += size.width + 35 * spacingScale
      }
    }
    sortOutside()
    placeOutside()
    // Reorder children against the stable neighboring assembly/context
    // positions, then make one final outside pass against the updated child
    // endpoints. These two inexpensive barycentric sweeps reduce crossings
    // without replacing the familiar curved interface style.
    if (next.length <= 500 && analysis.interfaces.length <= 2000) containerOrder.forEach(id => layoutContainer(id, new Set<string>(), true))
    sortOutside()
    placeOutside()
    update({ block_diagram: {
      ...diagram,
      density: selectedDensity,
      layoutOptions: options,
      boundary: nextBoundary,
      nodes: next,
    } })
    window.requestAnimationFrame(() => {
      void flowRef.current?.fitView({ padding: 0.14, duration: 350 })
    })
  }


  const selectedDiagramNode = diagramById.get(selectedNodeId)
  const selectedStructureOnly = selectedNodeId.startsWith(STRUCTURE_SELECTION_PREFIX)
    ? selectedNodeId.slice(STRUCTURE_SELECTION_PREFIX.length) : undefined
  const selectedInterface = analysis.interfaces.find(
    item => item.id === selectedInterfaceId)
  const selectedInterfaceGroup = projectedInterfaceGroups.find(
    group => group.id === selectedInterfaceGroupId)
  const selectedStructure = selectedDiagramNode?.structure_node_id
    ? structureById.get(selectedDiagramNode.structure_node_id) : undefined
  const selectedContainer = selectedDiagramNode?.container_parent_block_id
    ? diagramById.get(selectedDiagramNode.container_parent_block_id)
    : undefined
  const selectedChildCount = selectedStructure
    ? analysis.structure_nodes.filter(
      item => item.parent_id === selectedStructure.id).length
    : 0
  const selectedSize = selectedDiagramNode
    ? projectedSizeById.get(selectedDiagramNode.id)
      ?? {
        width: selectedDiagramNode.width,
        height: selectedDiagramNode.height,
      }
    : undefined
  const selectedBoundaryConflict = Boolean(
    selectedDiagramNode
    && selectedSize
    && !selectedDiagramNode.inside_boundary
    && selectedDiagramNode.x + selectedSize.width / 2 >= diagram.boundary.x
    && selectedDiagramNode.x + selectedSize.width / 2
      <= diagram.boundary.x + diagram.boundary.width
    && selectedDiagramNode.y + selectedSize.height / 2 >= diagram.boundary.y
    && selectedDiagramNode.y + selectedSize.height / 2
      <= diagram.boundary.y + diagram.boundary.height,
  )
  const unusedStructures = analysis.structure_nodes.filter(structure =>
    !hiddenStructureIds?.has(structure.id) && !diagram.nodes.some(node => node.kind === 'structure'
      && node.structure_node_id === structure.id))

  const canvas = <div className={`flex min-h-0 flex-1 ${
    fullscreen.expanded || fillHeight ? 'h-full' : 'h-[680px]'
  }`}>
    <InterfaceDiagramSidebar filters={filters} onChange={changeFilters} resources={resourceOptions}
      supportsConnections={Boolean(interfaceResourceFlows)} selectedBlockLabel={selectedBlockLabel}
      matchingCount={filterProjection.matching.length} totalCount={filterProjection.eligible.length}>
      {libraryContent}
      {!focusView && !hideCreationTools && <>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        Structure blocks
      </div>
      <div className="space-y-1">
        {unusedStructures.map(structure =>
          <button key={structure.id} type="button"
            onClick={() => addStructureBlock(structure.id)}
            className="flex w-full items-center gap-1.5 rounded border border-slate-200 px-2 py-1.5 text-left text-[10px] text-slate-700 hover:border-blue-300 hover:bg-blue-50">
            <Plus size={10} className="shrink-0 text-blue-600" />
            <span className="min-w-0 flex-1">
              <span className="block whitespace-normal [overflow-wrap:anywhere]">
                {structure.name || 'Unnamed block'}
              </span>
              <span className="block whitespace-normal text-[9px] text-slate-500"
                title={structureBreadcrumb(structure.id)}>
                {structureBreadcrumb(structure.id)
                  || structure.level.replace(/_/g, ' ')}
              </span>
            </span>
          </button>)}
        {!unusedStructures.length && <div className="rounded bg-slate-50 px-2 py-2 text-[10px] text-slate-400">
          Every structure block is on the canvas.
        </div>}
      </div>
      <div className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        External context
      </div>
      <div className="space-y-1">
        {externalKinds.map(({ value, label, Icon }) =>
          <button key={value} type="button" onClick={() => addExternalBlock(value)}
            className="flex w-full items-center gap-1.5 rounded border border-violet-200 px-2 py-1.5 text-left text-[10px] text-violet-700 hover:bg-violet-50">
            <Icon size={11} /> {label}
          </button>)}
      </div>
      {!hideAnalysisBoundary && <button type="button" onClick={() => {
        setInspectorOpen(true)
        setSelectedNodeId(BOUNDARY_ID)
        setSelectedInterfaceId('')
        setSelectedInterfaceGroupId('')
        const next = liveFlowNodes.current.map(node => ({
          ...node,
          selected: node.id === BOUNDARY_ID,
        }))
        liveFlowNodes.current = next
        setFlowNodes(next)
      }} className="mt-3 flex w-full items-center gap-1.5 rounded border border-blue-200 px-2 py-1.5 text-left text-[10px] text-blue-700 hover:bg-blue-50">
        <Maximize2 size={11} /> Edit analysis boundary
      </button>}
      </>}
      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-2">
        <div className="text-[10px] font-semibold text-slate-600">Interface key</div>
        <div className="mt-1.5 space-y-1">
          {Object.values(interfaceStyles).map(style =>
            <div key={style.code} className="flex items-center gap-1 text-[9px] text-slate-500">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border bg-white font-bold"
                style={{ color: style.color }}>{style.code}</span>
              {style.label}
            </div>)}
        </div>
        <div className="mt-2 text-[9px] leading-relaxed text-slate-400">
          Solid: direct · Dashed: indirect/clearance · Arrowheads show flow.
          Strength and nature appear as labeled connector badges.
        </div>
      </div>
    </InterfaceDiagramSidebar>
    <div ref={wrapperRef} tabIndex={0} aria-label="FMEA Block Diagram canvas"
      className="relative min-w-0 flex-1 bg-slate-50 outline-hidden">
      <div className="absolute left-2 right-2 top-2 z-20 flex items-center justify-between gap-2"
        data-export-ignore>
        <div className="pointer-events-auto flex items-center gap-1 rounded-lg bg-white/95 p-1 shadow-xs">
          <CanvasAssetControls getElement={() => wrapperRef.current}
            prepareCapture={() => fitReactFlowForExport(
              flowRef.current as unknown as ReactFlowInstance,
            )}
            label={`${analysis.name} Block / Boundary Diagram`}
            group={analysis.name}
            analysisName={analysis.name}
            targetView={assetTargetView ?? `fmea:${encodeURIComponent(analysis.id)}:structure:block_diagram`} />
          <DiagramLayoutMenu value={layoutOptions} onApply={autoLayout}
            onChange={options => update({ block_diagram: { ...diagram, layoutOptions: options } })}
            gateLabel="Preserve assembly order" eventLabel="Preserve block order" />
          <button type="button" aria-label="Collapse all systems" title="Collapse all expanded systems"
            disabled={!(hasExpandedSystems ?? diagram.nodes.some(node => node.kind === 'structure' && node.expanded))}
            onClick={onCollapseAllSystems ?? (() => update({ block_diagram: { ...diagram, nodes: diagram.nodes.map(node =>
              node.kind === 'structure' && node.expanded ? { ...node, expanded: false } : node) } }))}
            className="flex h-8 w-8 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 hover:bg-blue-50 disabled:opacity-40">
            <Minimize2 size={14} />
          </button>
          <label className="flex h-8 items-center gap-1 px-1 text-[10px] text-slate-600">
            Connectors
            <select aria-label="Connector style" value={diagram.connectorStyle ?? 'curved'}
              onChange={event => update({ block_diagram:{ ...diagram,connectorStyle:event.target.value as ConnectorStyle } })}
              className="rounded border border-slate-200 bg-white px-1 py-1 text-[10px] text-slate-700">
              <option value="orthogonal">Orthogonal</option><option value="curved">Curved</option><option value="straight">Straight</option>
            </select>
          </label>
          <button type="button" onClick={() => update({ block_diagram: {
            ...diagram,
            snap_to_grid: !diagram.snap_to_grid,
          } })} className={`flex h-8 items-center gap-1 rounded border px-2 text-[10px] ${
            diagram.snap_to_grid
              ? 'border-blue-300 bg-blue-50 text-blue-700'
              : 'border-slate-200 text-slate-600'
          }`}>
            <Magnet size={12} /> Snap
          </button>
        </div>
        <div className="pointer-events-auto flex items-center gap-1 rounded-lg bg-white/95 p-1 shadow-xs">
          <button ref={inspectorToggle} type="button"
            aria-label="Toggle inspector"
            aria-expanded={inspectorOpen} aria-controls={inspectorOpen ? inspectorId : undefined}
            title={inspectorOpen ? 'Hide diagram properties' : 'Show diagram properties'}
            onClick={() => setInspectorOpen(value => !value)}
            className="flex h-8 w-8 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 hover:bg-blue-50">
            {inspectorOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
          </button>
          <button type="button" onClick={() =>
            void flowRef.current?.fitView({ padding: 0.14, duration: 300 })}
            title="Fit the complete diagram in view"
            className="flex h-8 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[10px] text-slate-600 hover:bg-slate-50">
            <Scan size={12} /> Fit
          </button>
          <ExportDiagramButton getElement={() => wrapperRef.current}
            baseName={`${analysis.name}-block-boundary-diagram`}
            prepareExport={() => fitReactFlowForExport(
              flowRef.current as unknown as ReactFlowInstance,
            )}
            buttonClassName="flex h-8 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[10px] text-slate-600 hover:bg-slate-50" />
          <DiagramFullscreenButton controls={fullscreen} />
        </div>
      </div>
      <ReactFlow nodes={flowNodes} edges={flowEdges}
        nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        minZoom={0.1}
        onInit={instance => { flowRef.current = instance }}
        onNodesChange={changes => {
          const next = applyNodeChanges(changes, liveFlowNodes.current)
          liveFlowNodes.current = next
          setFlowNodes(next)
        }}
        nodeDragThreshold={0}
        onNodeDragStart={() => { dragMoved.current = false }}
        onNodeDrag={() => { dragMoved.current = true }}
        onNodeDragStop={(_, flowNode, draggedNodes) => {
          // Starting at pointer-down preserves the grab offset even for fast
          // drags. A plain selection click must not write diagram geometry.
          if (!dragMoved.current) return
          dragMoved.current = false
          if (flowNode.id === BOUNDARY_ID) {
            update({ block_diagram: {
              ...diagram,
              boundary: {
                ...diagram.boundary,
                x: flowNode.position.x,
                y: flowNode.position.y,
              },
            } })
            return
          }
          // The stop event carries the final drag position even when React
          // has not rendered the last controlled onNodesChange yet.
          const released = new Map(draggedNodes.map(node => [node.id, node]))
          released.set(flowNode.id, flowNode)
          const finalNodes = liveFlowNodes.current.map(node => {
            const final = released.get(node.id)
            return final ? { ...node, position: node.expandParent && node.parentId
              ? { x: Math.max(0, final.position.x), y: Math.max(0, final.position.y) }
              : final.position } : node
          })
          update({ block_diagram: commitBlockDrag(
            diagramRef.current, finalNodes, flowNode.id,
            20 * densityPreset.spacingScale,
          ) })
        }}
        onConnect={connect} isValidConnection={candidate =>
          isValidConnection(candidate as Connection)}
        onConnectStart={(_, params) =>
          setConnectingFromId(params.nodeId ?? '')}
        onConnectEnd={() => setConnectingFromId('')}
        onNodeClick={(_, node) => {
          wrapperRef.current?.focus({ preventScroll: true })
          setSelectedNodeId(node.id)
          if (node.id !== BOUNDARY_ID) setConnectionSelection({ nodeId: node.id })
          setSelectedInterfaceId('')
          setSelectedInterfaceGroupId('')
          const structureId = diagramById.get(node.id)?.structure_node_id
          if (structureId) onStructureSelect?.(structureId)
        }}
        onNodeDoubleClick={(_, node) => {
          const structureId = diagramById.get(node.id)?.structure_node_id
          if (structureId && (!canFocusStructure || canFocusStructure(structureId))) onStructureFocus?.(structureId)
        }}
        onEdgeClick={(_, edge) => {
          wrapperRef.current?.focus({ preventScroll: true })
          setSelectedNodeId('')
          const interfaceIds = edge.data?.interfaceIds ?? [edge.id]
          setSelectedInterfaceId(interfaceIds.length === 1
            ? interfaceIds[0] : '')
          setSelectedInterfaceGroupId(interfaceIds.length > 1 ? edge.id : '')
        }}
        onPaneClick={() => {
          setSelectedNodeId('')
          setSelectedInterfaceId('')
          setSelectedInterfaceGroupId('')
        }}
        defaultViewport={diagram.viewport}
        onMoveEnd={(_, viewport) => {
          const current = diagramRef.current
          if (Math.abs(viewport.x - current.viewport.x) < 0.001
              && Math.abs(viewport.y - current.viewport.y) < 0.001
              && Math.abs(viewport.zoom - current.viewport.zoom) < 0.00001) return
          update({ block_diagram: {
            ...current,
            viewport: {
              x: viewport.x,
              y: viewport.y,
              zoom: viewport.zoom,
            },
          } })
        }}
        connectionMode={ConnectionMode.Loose}
        connectionLineStyle={{ stroke: '#2563eb', strokeWidth: 2 }}
        snapToGrid={diagram.snap_to_grid} snapGrid={FMEA_BLOCK_SNAP_GRID}
        selectionOnDrag multiSelectionKeyCode="Shift" deleteKeyCode={null}>
        <Background variant={BackgroundVariant.Dots}
          color={diagram.snap_to_grid ? '#94a3b8' : '#cbd5e1'}
          gap={20} size={diagram.snap_to_grid ? 1.2 : 0.7} />
        <Controls />
        <MiniMap pannable zoomable nodeColor={node =>
          node.id === BOUNDARY_ID ? '#dbeafe'
            : node.data.kind === 'external' ? '#8b5cf6' : '#475569'} />
      </ReactFlow>
      {(filters.types.length !== INTERFACE_TYPE_OPTIONS.length || filters.resource !== ALL_RESOURCES || filters.onlyConnected || filters.connections !== 'all') && <div
        data-export-ignore className="pointer-events-auto absolute bottom-3 left-14 z-10 flex max-w-[70%] flex-wrap items-center gap-2 rounded border border-blue-200 bg-white/95 px-2 py-1 text-xs text-slate-700 shadow-xs">
        <span>{filterProjection.matching.length} of {filterProjection.eligible.length} interfaces match</span>
        <button type="button" onClick={() => changeFilters(defaultInterfaceDiagramFilters())}
          className="rounded px-1 py-1 text-blue-700 hover:bg-blue-50">Clear diagram filters</button>
      </div>}
    </div>
    {inspectorOpen && <aside id={inspectorId} aria-label="Diagram properties"
      data-fmea-record-id={
        selectedDiagramNode?.id ?? selectedInterface?.id ?? undefined}
      className="w-64 shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-3"
      data-export-ignore>
      {selectedStructureOnly && structureInspector && <div className="space-y-3">
        <h3 className="text-xs font-semibold text-slate-700">Block properties</h3>
        {structureInspector(selectedStructureOnly)}
        {selectedStructureOnly === implicitRootStructureId && <p className="text-xs text-slate-500">
          The canvas represents this system’s boundary.</p>}
      </div>}
      {selectedDiagramNode && <>
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold text-slate-700">Block properties</div>
          {!focusView && !(allowCanonicalEditing && selectedDiagramNode.kind === 'structure') && <button type="button" onClick={() => removeDiagramNode(selectedDiagramNode)}
            title="Remove from diagram"
            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600">
            <Trash2 size={13} />
          </button>}
        </div>
        <div className="mt-3 space-y-3">
          {selectedDiagramNode.kind === 'external'
            ? <>
                <label className="block text-[10px] text-slate-500">Label
                  <input value={selectedDiagramNode.label}
                    onChange={event => updateDiagramNode(
                      selectedDiagramNode.id,
                      { label: event.target.value },
                    )} className={`mt-1 ${fieldClass}`} />
                </label>
                <label className="block text-[10px] text-slate-500">External type
                  <select value={selectedDiagramNode.external_kind ?? 'other'}
                    onChange={event => updateDiagramNode(
                      selectedDiagramNode.id,
                      { external_kind: event.target.value as
                        NonNullable<FMEABlockDiagramNode['external_kind']> },
                    )} className={`mt-1 ${fieldClass}`}>
                    {externalKinds.map(item =>
                      <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
              </>
            : structureInspector && selectedDiagramNode.structure_node_id
              ? structureInspector(selectedDiagramNode.structure_node_id)
              : <div className="rounded bg-slate-50 px-2 py-2">
                <div className="text-xs font-medium text-slate-700">
                  {structureById.get(selectedDiagramNode.structure_node_id ?? '')?.name
                    || 'Missing structure record'}
                </div>
                <div className="mt-0.5 text-[9px] text-slate-400">
                  {allowCanonicalEditing ? 'Shared project system item' : 'Managed by the Structure Hierarchy'}
                </div>
              </div>}
          {selectedDiagramNode.structure_node_id && onStructureFocus && <button type="button"
            disabled={canFocusStructure && !canFocusStructure(selectedDiagramNode.structure_node_id)}
            title={canFocusStructure && !canFocusStructure(selectedDiagramNode.structure_node_id)
              ? 'Outside this study scope. Change the study scope to focus here.' : 'Show interfaces crossing this item’s boundary'}
            onClick={() => onStructureFocus(selectedDiagramNode.structure_node_id!)}
            className="w-full rounded border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs font-medium text-blue-700 disabled:opacity-40">
            Focus here
          </button>}
          {!focusView && <>
          <label className={`flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-[10px] ${
            selectedBoundaryConflict
              ? 'border-amber-300 bg-amber-50 font-medium text-amber-900'
              : 'border-slate-200 text-slate-600'
          }`}>
            <span>
              Inside analysis boundary
              {selectedContainer &&
                <span className="ml-1 text-[8px] font-normal text-slate-400">
                  inherited
                </span>}
            </span>
            <input type="checkbox" checked={selectedDiagramNode.inside_boundary}
              disabled={Boolean(selectedContainer)}
              title={selectedContainer
                ? `Inherited from ${selectedContainer.label}`
                : 'Set analysis-boundary scope for this block and its children'}
              onChange={event => updateDiagramNode(
                selectedDiagramNode.id,
                { inside_boundary: event.target.checked },
              )} />
          </label>
          {selectedBoundaryConflict &&
            <p className="flex items-start gap-1 rounded bg-amber-50 px-2 py-1.5 text-[9px] leading-relaxed text-amber-800">
              <AlertTriangle size={10} className="mt-0.5 shrink-0" />
              This block is drawn inside the boundary but excluded from the
              analysis scope. Check the box or move it outside the boundary.
            </p>}
          {selectedDiagramNode.kind === 'structure'
              && selectedChildCount > 0 &&
            <button type="button"
              onClick={() => toggleStructureBlock(selectedDiagramNode.id)}
              className="flex w-full items-center justify-between gap-2 rounded border border-blue-200 bg-blue-50 px-2 py-1.5 text-[10px] font-medium text-blue-700 hover:bg-blue-100">
              <span className="flex items-center gap-1">
                <GitBranch size={11} />
                {selectedDiagramNode.expanded
                  ? 'Collapse children' : 'Expand children'}
              </span>
              <span>{selectedChildCount}</span>
            </button>}
          </>}
        </div>
      </>}
      {selectedNodeId === BOUNDARY_ID && <>
        <div className="text-xs font-semibold text-slate-700">
          Analysis boundary
        </div>
        <label className="mt-3 block text-[10px] text-slate-500">Boundary label
          <input value={diagram.boundary.label}
            onChange={event => update({ block_diagram: {
              ...diagram,
              boundary: { ...diagram.boundary, label: event.target.value },
            } })} className={`mt-1 ${fieldClass}`} />
        </label>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
          Place items controlled by the analysis team inside this boundary.
          Keep adjacent systems, people, and environmental context outside.
        </p>
      </>}
      {selectedInterfaceGroup && <>
        <div className="text-xs font-semibold text-slate-700">
          Aggregated interfaces
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
          {selectedInterfaceGroup.items.length} child interfaces are projected
          through this collapsed parent. Select an underlying record to inspect
          or edit it; aggregation does not rewrite interface ownership.
        </p>
        <div className="mt-3 space-y-1">
          {selectedInterfaceGroup.items.map(item => {
            const style = interfaceStyles[item.interface_type]
            return <button key={item.id} type="button" onClick={() => {
              setSelectedInterfaceId(item.id)
              setSelectedInterfaceGroupId('')
            }} className="flex w-full items-center gap-2 rounded border border-slate-200 px-2 py-1.5 text-left text-[10px] hover:border-blue-300 hover:bg-blue-50">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border bg-white font-bold"
                style={{ color: style.color }}>
                {style.code}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-slate-700">
                  {item.name || item.id}
                </span>
                <span className="block truncate text-[8px] text-slate-400">
                  {interfaceDescriptions?.[item.id] || item.flow_description || 'Flow not described'}
                </span>
              </span>
            </button>
          })}
        </div>
      </>}
      {selectedInterface && <>
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold text-slate-700">
            Interface properties
          </div>
          <button type="button" disabled={Boolean(selectedInterface.system_definition_ref) && !allowCanonicalEditing} onClick={() => removeInterface(selectedInterface)}
            title={selectedInterface.system_definition_ref && !allowCanonicalEditing ? 'Edit or remove this interface in System Definition' : 'Delete interface'}
            className="flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-[10px] font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40">
            <Trash2 size={11} /> Delete connector
          </button>
        </div>
        {selectedInterface.system_definition_ref && <div className="mt-3 rounded border border-violet-200 bg-violet-50 p-2 text-[10px] text-violet-800">
          {allowCanonicalEditing ? 'Shared project interface. Changes apply in System Modeling and linked analyses.'
            : 'Canonical interface semantics and function mappings are managed in System Definition.'}
        </div>}
        {interfaceDescriptions?.[selectedInterface.id] && <p className="mt-2 rounded bg-slate-50 p-2 text-xs text-slate-600">
          {interfaceDescriptions[selectedInterface.id]}
        </p>}
        {interfaceInspector ? <div className="mt-3">{interfaceInspector(selectedInterface.id)}</div>
        : <fieldset disabled={Boolean(selectedInterface.system_definition_ref) && !allowCanonicalEditing} className="mt-3 space-y-2.5 disabled:opacity-70">
          <label className="block text-[10px] text-slate-500">Interface name
            <input value={selectedInterface.name}
              onChange={event => changeInterface({ name: event.target.value })}
              className={`mt-1 ${fieldClass}`} />
          </label>
          <label className="block text-[10px] text-slate-500">Interface type
            <select value={selectedInterface.interface_type}
              onChange={event => {
                const type = event.target.value as FMEAInterface['interface_type']
                changeInterface({
                  interface_type: type,
                  directionality: defaultDirectionalityForType(type),
                  ...(type === 'clearance'
                    ? { linkage: 'indirect' }
                    : selectedInterface.interface_type === 'clearance'
                      ? { linkage: 'direct' }
                    : {}),
                })
              }} className={`mt-1 ${fieldClass}`}>
              {Object.entries(interfaceStyles).map(([value, style]) =>
                <option key={value} value={value}>
                  {style.code} · {style.label}
                </option>)}
            </select>
          </label>
          <label className="block text-[10px] text-slate-500">Detailed subtype
            <input value={selectedInterface.interface_detail}
              placeholder="e.g., bolted, CAN bus, coolant"
              onChange={event =>
                changeInterface({ interface_detail: event.target.value })}
              className={`mt-1 ${fieldClass}`} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[10px] text-slate-500">Linkage
              <select value={selectedInterface.linkage}
                onChange={event => changeInterface({
                  linkage: event.target.value as FMEAInterface['linkage'],
                })} className={`mt-1 ${fieldClass}`}>
                <option value="direct">Direct · solid</option>
                <option value="indirect">Indirect · dashed</option>
              </select>
            </label>
            <label className="block text-[10px] text-slate-500">Direction
              <select value={selectedInterface.directionality}
                onChange={event => changeInterface({
                  directionality: event.target.value as
                    FMEAInterface['directionality'],
                })} className={`mt-1 ${fieldClass}`}>
                <option value="directed">Directed</option>
                <option value="bidirectional">Bidirectional</option>
                <option value="undirected">Non-Directional</option>
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[10px] text-slate-500">Strength
              <select value={selectedInterface.relationship_strength}
                onChange={event => changeInterface({
                  relationship_strength: event.target.value as
                    FMEAInterface['relationship_strength'],
                })} className={`mt-1 ${fieldClass}`}>
                <option value="unspecified">Unspecified</option>
                <option value="strong">Strong</option>
                <option value="weak">Weak</option>
              </select>
            </label>
            <label className="block text-[10px] text-slate-500">Nature
              <select value={selectedInterface.relationship_nature}
                onChange={event => changeInterface({
                  relationship_nature: event.target.value as
                    FMEAInterface['relationship_nature'],
                })} className={`mt-1 ${fieldClass}`}>
                <option value="unspecified">Unspecified</option>
                <option value="beneficial">Beneficial</option>
                <option value="harmful">Harmful</option>
                <option value="mixed">Mixed</option>
              </select>
            </label>
          </div>
          <label className="block text-[10px] text-slate-500">What crosses the interface
            <textarea value={selectedInterface.flow_description}
              onChange={event =>
                changeInterface({ flow_description: event.target.value })}
              className={`mt-1 min-h-16 ${fieldClass}`} />
          </label>
          <label className="block text-[10px] text-slate-500">Operating condition
            <input value={selectedInterface.operating_condition}
              onChange={event =>
                changeInterface({ operating_condition: event.target.value })}
              className={`mt-1 ${fieldClass}`} />
          </label>
          <details className="rounded border border-slate-200">
            <summary className="cursor-pointer px-2 py-1.5 text-[10px] font-medium text-slate-600">
              Linked functions ({selectedInterface.function_ids.length})
            </summary>
            <div className="max-h-36 space-y-1 overflow-y-auto border-t p-2">
              {analysis.functions.filter(item => !selectedInterface.system_definition_ref
                || item.structure_node_id === selectedInterface.source_structure_node_id
                || item.structure_node_id === selectedInterface.target_structure_node_id).map(item =>
                <label key={item.id}
                  className="flex items-start gap-1.5 text-[10px] text-slate-600">
                  <input type="checkbox"
                    checked={selectedInterface.function_ids.includes(item.id)}
                    onChange={() => changeInterface({
                      function_ids: selectedInterface.function_ids.includes(item.id)
                        ? selectedInterface.function_ids.filter(id => id !== item.id)
                        : [...selectedInterface.function_ids, item.id],
                    })} />
                  <span>{item.description || item.id}</span>
                </label>)}
            </div>
          </details>
          <details className="rounded border border-slate-200">
            <summary className="cursor-pointer px-2 py-1.5 text-[10px] font-medium text-slate-600">
              Linked requirements ({selectedInterface.requirement_ids.length})
            </summary>
            <div className="max-h-36 space-y-1 overflow-y-auto border-t p-2">
              {analysis.functional_requirements.map(item =>
                <label key={item.id}
                  className="flex items-start gap-1.5 text-[10px] text-slate-600">
                  <input type="checkbox"
                    checked={selectedInterface.requirement_ids.includes(item.id)}
                    onChange={() => changeInterface({
                      requirement_ids: selectedInterface.requirement_ids.includes(item.id)
                        ? selectedInterface.requirement_ids.filter(id => id !== item.id)
                        : [...selectedInterface.requirement_ids, item.id],
                    })} />
                  <span>{item.statement || item.id}</span>
                </label>)}
            </div>
          </details>
        </fieldset>}
      </>}
      {!selectedDiagramNode && !selectedStructureOnly && selectedNodeId !== BOUNDARY_ID
        && !selectedInterface && !selectedInterfaceGroup && <div
          className="flex h-full min-h-48 items-center justify-center text-center text-[11px] leading-relaxed text-slate-400">
          Select a block, boundary, or interface connector to edit it.
          Drag between block connection points to define an interface.
        </div>}
    </aside>}
  </div>

  return <div {...fullscreen.containerProps}
    className={`${fullscreen.containerProps.className} flex-col ${fullscreen.expanded
      ? '' : `${fillHeight ? 'h-full ' : ''}overflow-hidden rounded-xl border border-slate-200 bg-white`}`}>
    {canvas}
  </div>
}
