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
  Minus,
  Minimize2,
  Plus,
  Scan,
  Trash2,
  User,
  Wind,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import type {
  AIAGVDAFMEAAnalysis,
  FMEABlockDiagramNode,
  FMEAInterface,
} from '../../api/reliabilityProgram'
import CanvasAssetControls from '../shared/CanvasAssetControls'
import ExportDiagramButton from '../shared/ExportDiagramButton'
import { fitReactFlowForExport } from '../shared/exportDiagram'
import { useShortcuts } from '../shared/KeyboardShortcuts'

const BOUNDARY_ID = 'fmea-analysis-boundary'
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
  onToggleExpand?: () => void
  onResize?: (width: number, height: number) => void
}

type DiagramFlowNode = Node<DiagramNodeData, 'fmeaBlock'|'fmeaBoundary'>
type DiagramEdgeData = {
  color: string
  offset: number
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
  return <div className={`relative h-full min-h-14 w-full rounded-lg border-2 px-3 py-2 shadow-sm transition ${
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
      isVisible={selected && !expanded}
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
        className="pointer-events-none absolute -bottom-2 left-2 flex items-center gap-0.5 rounded-full border border-amber-400 bg-amber-100 px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-wide text-amber-900 shadow-sm">
        <AlertTriangle size={8} /> Out of scope
      </div>}
    {[Position.Top, Position.Right, Position.Bottom, Position.Left].map(position =>
      <Handle key={position} id={String(position)} type="source"
        position={position} className={handleClass} />)}
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
  const dx = targetX - sourceX
  const dy = targetY - sourceY
  const length = Math.max(1, Math.hypot(dx, dy))
  const nx = -dy / length
  const ny = dx / length
  const offset = data?.offset ?? 0
  const c1x = sourceX + dx / 3 + nx * offset
  const c1y = sourceY + dy / 3 + ny * offset
  const c2x = sourceX + 2 * dx / 3 + nx * offset
  const c2y = sourceY + 2 * dy / 3 + ny * offset
  const path =
    `M ${sourceX},${sourceY} C ${c1x},${c1y} ${c2x},${c2y} ${targetX},${targetY}`
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
      x={(sourceX + targetX) / 2 + nx * offset
        - (expandedLabel ? 70 : 28)}
      y={(sourceY + targetY) / 2 + ny * offset
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
        className={`max-w-full rounded border bg-white/95 px-1 py-px text-center text-[8px] font-medium shadow-sm ${
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
}: {
  analysis: AIAGVDAFMEAAnalysis
  update: (patch: Partial<AIAGVDAFMEAAnalysis>) => void
}) {
  const diagram = analysis.block_diagram
  const density = DENSITY_LEVELS.includes(diagram.density)
    ? diagram.density : 'comfortable'
  const densityPreset = DENSITY_PRESETS[density]
  const densityIndex = DENSITY_LEVELS.indexOf(density)
  const [selectedNodeId, setSelectedNodeId] = useState('')
  const [selectedInterfaceId, setSelectedInterfaceId] = useState('')
  const [selectedInterfaceGroupId, setSelectedInterfaceGroupId] = useState('')
  const [connectingFromId, setConnectingFromId] = useState('')
  const [fullscreen, setFullscreen] = useState(false)
  const [flowNodes, setFlowNodes] = useState<DiagramFlowNode[]>([])
  const wrapperRef = useRef<HTMLDivElement>(null)
  const flowRef = useRef<ReactFlowInstance<DiagramFlowNode, DiagramFlowEdge>|null>(null)
  const diagramRef = useRef(diagram)
  const updateRef = useRef(update)
  const selectedNodeIdRef = useRef(selectedNodeId)
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
  const structureBlockByStructureId = useMemo(
    () => new Map(diagram.nodes.flatMap(node =>
      node.kind === 'structure' && node.structure_node_id
        ? [[node.structure_node_id, node] as const] : [])),
    [diagram.nodes],
  )
  const containedChildrenByBlockId = useMemo(() => {
    const result = new Map<string, FMEABlockDiagramNode[]>()
    for (const node of diagram.nodes) {
      if (!node.container_parent_block_id
          || !diagramById.has(node.container_parent_block_id)) continue
      result.set(node.container_parent_block_id, [
        ...(result.get(node.container_parent_block_id) ?? []),
        node,
      ])
    }
    return result
  }, [diagram.nodes, diagramById])
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
    diagram.nodes.forEach(node => measure(node.id))
    return result
  }, [
    containedChildrenByBlockId,
    densityPreset.sizeScale,
    densityPreset.spacingScale,
    diagram.nodes,
    diagramById,
  ])
  const visibleBlockIds = useMemo(() => {
    const visible = new Set<string>()
    for (const node of diagram.nodes) {
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
  }, [diagram.nodes, diagramById])

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
      return { index: nextNodes.length - 1, node: created }
    })
    const columns = Math.max(1, Math.ceil(Math.sqrt(childBlocks.length)))
    let rowY = parent.y + 46
    for (let start = 0; start < childBlocks.length; start += columns) {
      const row = childBlocks.slice(start, start + columns)
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
    update({ block_diagram: { ...diagram, nodes: nextNodes } })
  }

  // Keep persisted diagram geometry and React Flow's transient node state on
  // separate tracks. Rebuilding every node in response to selectedNodeId made
  // insertion unstable: React Flow reported the new selection while this
  // effect replaced its nodes, which could repeatedly clear/reapply selection.
  // This key changes only when model-owned render data changes.
  const flowProjectionKey = JSON.stringify({
    boundary: diagram.boundary,
    density,
    nodes: diagram.nodes,
    structures: analysis.structure_nodes.map(node => ({
      id: node.id,
      name: node.name,
      level: node.level,
      parentId: node.parent_id,
    })),
    connectingFromId,
  })

  useEffect(() => {
    const source = diagramById.get(connectingFromId)
    const projected: DiagramFlowNode[] = [{
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
      const children = structure
        ? analysis.structure_nodes.filter(item =>
          item.parent_id === structure.id)
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
        position: parent?.expanded
          ? { x: node.x - parent.x, y: node.y - parent.y }
          : { x: node.x, y: node.y },
        parentId: parent?.expanded ? parent.id : undefined,
        extent: parent?.expanded ? 'parent' as const : undefined,
        expandParent: false,
        style: {
          width: size.width,
          height: size.height,
          zIndex: node.expanded ? 0 : 2,
        },
        data: {
          label: structure?.name ?? node.label,
          subtitle: node.kind === 'structure'
            ? structure?.level.replace(/_/g, ' ') ?? 'Missing structure record'
            : node.external_kind?.replace(/_/g, ' ') ?? 'External',
          kind: node.kind,
          insideBoundary: node.inside_boundary,
          externalKind: node.external_kind,
          childCount: children.length,
          childNames: children.map(child =>
            child.name || child.id).join(', '),
          breadcrumb: structureBreadcrumb(node.structure_node_id),
          expanded: Boolean(node.expanded),
          boundaryConflict: !node.inside_boundary && physicallyInsideBoundary,
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
    setFlowNodes(current => {
      const currentById = new Map(current.map(node => [node.id, node]))
      return projected.map(node => {
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
    })
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
    for (const item of analysis.interfaces) {
      if (!item.source_block_id || !item.target_block_id) continue
      const source = visibleRepresentative(item.source_block_id)
      const target = visibleRepresentative(item.target_block_id)
      if (!source || !target || source.id === target.id) continue
      const key = [
        source.id,
        target.id,
        item.interface_type,
        item.linkage,
        item.directionality,
        item.relationship_strength,
        item.relationship_nature,
      ].join('\u0000')
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
  }, [analysis.interfaces, diagram.nodes, visibleBlockIds])
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

  const flowEdges = useMemo<DiagramFlowEdge[]>(() =>
    projectedInterfaceGroups.map(group => {
      const item = group.items[0]
      const style = interfaceStyles[item.interface_type]
      const endpointKey = [group.source.id, group.target.id]
        .sort().join('\u0000')
      const siblings = projectedGroupsByEndpoint.get(endpointKey) ?? [group]
      const index = siblings.findIndex(value => value.id === group.id)
      const offset = (index - (siblings.length - 1) / 2) * 18
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
      const dx = (group.target.x + targetSize.width / 2)
        - (group.source.x + sourceSize.width / 2)
      const dy = (group.target.y + targetSize.height / 2)
        - (group.source.y + sourceSize.height / 2)
      const horizontal = Math.abs(dx) >= Math.abs(dy)
      const projectedSourceHandle = horizontal
        ? String(dx >= 0 ? Position.Right : Position.Left)
        : String(dy >= 0 ? Position.Bottom : Position.Top)
      const projectedTargetHandle = horizontal
        ? String(dx >= 0 ? Position.Left : Position.Right)
        : String(dy >= 0 ? Position.Top : Position.Bottom)
      return {
        id: group.id,
        type: 'fmeaInterface',
        source: group.source.id,
        target: group.target.id,
        // Attachment sides follow the current geometry. Persisted handle IDs
        // describe where a connector was drawn, but become misleading after
        // Auto Layout or hierarchy expansion moves either endpoint.
        sourceHandle: projectedSourceHandle,
        targetHandle: projectedTargetHandle,
        selected: interfaceIds.includes(selectedInterfaceId)
          || selectedInterfaceGroupId === group.id,
        label: style.code,
        markerEnd: item.directionality === 'undirected' ? undefined : marker,
        markerStart: item.directionality === 'bidirectional'
          ? marker : undefined,
        data: {
          color: style.color,
          code: style.code,
          name,
          interfaceIds,
          offset,
          dashed: item.linkage === 'indirect'
            || item.interface_type === 'clearance',
          strength: item.relationship_strength,
          nature: item.relationship_nature,
          onSelect: select,
        },
      }
    }), [
      projectedGroupsByEndpoint,
      projectedInterfaceGroups,
      projectedSizeById,
      selectedInterfaceGroupId,
      selectedInterfaceId,
    ])

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
    if (diagram.nodes.some(node =>
      node.kind === 'structure' && node.structure_node_id === structureId)) return
    const index = diagram.nodes.filter(node => node.inside_boundary).length
    const structure = structureById.get(structureId)
    const created: FMEABlockDiagramNode = {
      id: newId('BDN'),
      kind: 'structure',
      structure_node_id: structureId,
      label: structure?.name ?? structureId,
      x: diagram.boundary.x + 70 + (index % 4) * 205,
      y: diagram.boundary.y + 80 + Math.floor(index / 4) * 115,
      width: 180,
      height: 72,
      inside_boundary: structure?.level !== 'next_higher'
        && structure?.level !== 'interface',
    }
    update({ block_diagram: {
      ...diagram,
      nodes: [...diagram.nodes, created],
    } })
    setSelectedNodeId(created.id)
  }

  const addExternalBlock = (
    externalKind: NonNullable<FMEABlockDiagramNode['external_kind']>,
  ) => {
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
    setSelectedInterfaceId(created.id)
    setSelectedInterfaceGroupId('')
    setSelectedNodeId('')
  }

  const changeInterface = (patch: Partial<FMEAInterface>) => {
    update({ interfaces: analysis.interfaces.map(item =>
      item.id === selectedInterfaceId ? { ...item, ...patch } : item) })
  }

  const removeInterface = (item: FMEAInterface) => {
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
    const connected = analysis.interfaces.filter(item =>
      item.source_block_id === node.id || item.target_block_id === node.id)
    const containedCount = containedChildrenByBlockId.get(node.id)?.length ?? 0
    if ((connected.length || containedCount) && !window.confirm(
      `Remove "${node.label}" from the diagram?\n\n`
      + (connected.length
        ? `${connected.length} connected interface record${
          connected.length === 1 ? '' : 's'} will also be deleted. `
        : '')
      + 'The Structure Hierarchy record will be retained. '
      + (containedCount > 0
        ? 'Contained children will remain as standalone diagram blocks.'
        : ''),
    )) return
    update({
      block_diagram: {
        ...diagram,
        nodes: diagram.nodes
          .filter(item => item.id !== node.id)
          .map(item => item.container_parent_block_id === node.id
            ? { ...item, container_parent_block_id: undefined }
            : item),
      },
      interfaces: analysis.interfaces.filter(item =>
        item.source_block_id !== node.id && item.target_block_id !== node.id),
    })
    setSelectedNodeId('')
  }

  const autoLayout = (layoutDensity: DiagramDensity = density) => {
    const layoutPreset = DENSITY_PRESETS[layoutDensity]
    const sizeScale = layoutPreset.sizeScale
    const spacingScale = layoutPreset.spacingScale
    const next = diagram.nodes.map(node => ({ ...node }))
    const indexById = new Map(next.map((node, index) => [node.id, index]))
    const nodeFor = (id: string) => {
      const index = indexById.get(id)
      return index == null ? undefined : next[index]
    }
    const childrenOf = (parentId: string) => next.filter(
      item => item.container_parent_block_id === parentId)
    const descendants = (rootId: string) => {
      const result = new Set<string>()
      const visit = (id: string) => {
        for (const child of childrenOf(id)) {
          if (result.has(child.id)) continue
          result.add(child.id)
          visit(child.id)
        }
      }
      visit(rootId)
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
      for (const item of analysis.interfaces) {
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
        const columns = Math.max(1, Math.ceil(Math.sqrt(ids.length)))
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
        .map(([, column]) => column.sort((left, right) => {
          const leftNode = nodeFor(left)
          const rightNode = nodeFor(right)
          const leftScore = orderScore?.(left)
          const rightScore = orderScore?.(right)
          return (leftScore ?? leftNode?.y ?? 0)
            - (rightScore ?? rightNode?.y ?? 0)
            || left.localeCompare(right)
        }))
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
      children.forEach(child =>
        layoutContainer(child.id, nextTrail, alignCrossAssembly))
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
          .map(column => column.sort((left, right) =>
            (score(left) ?? nodeFor(left)?.y ?? 0)
              - (score(right) ?? nodeFor(right)?.y ?? 0)
            || left.localeCompare(right)))
      }
      const childGapX = 28 * spacingScale
      const childGapY = 22 * spacingScale
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
    roots.forEach(root => layoutContainer(root.id))
    const inside = roots.filter(node => node.inside_boundary)
    const outside = roots.filter(node => !node.inside_boundary)
    const insideIds = inside.map(node => node.id)
    const insideEdges = directedEdges(
      insideIds,
      endpointId => rootOf(endpointId),
    )
    const insideColumns = rankedColumns(insideIds, insideEdges)
    const rootGapX = 56 * spacingScale
    const rootGapY = 38 * spacingScale
    const insideMetrics = columnMetrics(insideColumns, rootGapX, rootGapY)
    const horizontalPadding = 55 * spacingScale
    const topPadding = 70 * spacingScale
    const bottomPadding = 40 * spacingScale
    const nextBoundary = {
      ...diagram.boundary,
      width: Math.max(
        diagram.boundary.width,
        insideMetrics.width + horizontalPadding * 2,
      ),
      height: Math.max(
        diagram.boundary.height,
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
    roots.forEach(root => layoutContainer(root.id, new Set<string>(), true))
    sortOutside()
    placeOutside()
    update({ block_diagram: {
      ...diagram,
      density: layoutDensity,
      boundary: nextBoundary,
      nodes: next,
    } })
    window.requestAnimationFrame(() => {
      void flowRef.current?.fitView({ padding: 0.14, duration: 350 })
    })
  }
  const stepDensity = (direction: -1|1) => {
    const nextIndex = Math.max(
      0,
      Math.min(DENSITY_LEVELS.length - 1, densityIndex + direction),
    )
    if (nextIndex === densityIndex) return
    autoLayout(DENSITY_LEVELS[nextIndex])
  }

  const selectedDiagramNode = diagramById.get(selectedNodeId)
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
    !diagram.nodes.some(node => node.kind === 'structure'
      && node.structure_node_id === structure.id))

  const canvas = <div className={`flex min-h-0 flex-1 ${
    fullscreen ? 'h-full' : 'h-[680px]'
  }`}>
    <aside className="w-52 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-2"
      data-export-ignore>
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
              <span className="block truncate">
                {structure.name || 'Unnamed block'}
              </span>
              <span className="block truncate text-[8px] text-slate-400"
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
      <button type="button" onClick={() => {
        setSelectedNodeId(BOUNDARY_ID)
        setSelectedInterfaceId('')
        setSelectedInterfaceGroupId('')
        setFlowNodes(current => current.map(node => ({
          ...node,
          selected: node.id === BOUNDARY_ID,
        })))
      }} className="mt-3 flex w-full items-center gap-1.5 rounded border border-blue-200 px-2 py-1.5 text-left text-[10px] text-blue-700 hover:bg-blue-50">
        <Maximize2 size={11} /> Edit analysis boundary
      </button>
      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-2">
        <div className="text-[10px] font-semibold text-slate-600">Interface key</div>
        <div className="mt-1.5 grid grid-cols-2 gap-1">
          {Object.values(interfaceStyles).map(style =>
            <div key={style.code} className="flex items-center gap-1 text-[9px] text-slate-500">
              <span className="flex h-4 w-4 items-center justify-center rounded border bg-white font-bold"
                style={{ color: style.color }}>{style.code}</span>
              {style.label}
            </div>)}
        </div>
        <div className="mt-2 text-[9px] leading-relaxed text-slate-400">
          Solid: direct · Dashed: indirect/clearance · Arrowheads show flow.
          Strength and nature appear as labeled connector badges.
        </div>
      </div>
    </aside>
    <div ref={wrapperRef} tabIndex={0} aria-label="FMEA Block Diagram canvas"
      className="relative min-w-0 flex-1 bg-slate-50 outline-none">
      <div className="absolute left-2 right-2 top-2 z-20 flex items-center justify-between gap-2"
        data-export-ignore>
        <div className="pointer-events-auto flex items-center gap-1 rounded-lg bg-white/95 p-1 shadow-sm">
          <CanvasAssetControls getElement={() => wrapperRef.current}
            prepareCapture={() => fitReactFlowForExport(
              flowRef.current as unknown as ReactFlowInstance,
            )}
            label={`${analysis.name} Block / Boundary Diagram`}
            group={analysis.name}
            analysisName={analysis.name}
            targetView={`fmea:${encodeURIComponent(analysis.id)}:structure:block_diagram`} />
          <button type="button" onClick={() => autoLayout()}
            className="flex h-8 items-center gap-1 rounded border border-slate-200 px-2 text-[10px] text-slate-600 hover:bg-slate-50">
            <LayoutGrid size={12} /> Auto Layout
          </button>
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
        <div className="pointer-events-auto flex items-center gap-1 rounded-lg bg-white/95 p-1 shadow-sm">
          <div className="flex h-8 items-center rounded border border-slate-200 bg-white p-0.5"
            title={`Diagram density: ${densityPreset.label} (${densityIndex + 1} of ${DENSITY_LEVELS.length}). Primarily adjusts layout spacing, with only a subtle block-size change.`}>
            <button type="button" onClick={() => stepDensity(-1)}
              disabled={densityIndex === 0}
              aria-label="Decrease diagram spacing"
              className="flex h-6 w-6 items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300">
              <Minus size={11} />
            </button>
            <button type="button" onClick={() => stepDensity(1)}
              disabled={densityIndex === DENSITY_LEVELS.length - 1}
              aria-label="Increase diagram spacing"
              className="flex h-6 w-6 items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300">
              <Plus size={11} />
            </button>
          </div>
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
          <button type="button" onClick={() => setFullscreen(value => !value)}
            title={fullscreen ? 'Restore diagram' : 'Expand diagram to full screen'}
            aria-label={fullscreen ? 'Restore diagram' : 'Expand diagram to full screen'}
            className="flex h-8 w-8 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 hover:bg-blue-50 hover:text-blue-700">
            {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      </div>
      <ReactFlow nodes={flowNodes} edges={flowEdges}
        nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        onInit={instance => { flowRef.current = instance }}
        onNodesChange={changes =>
          setFlowNodes(current => applyNodeChanges(changes, current))}
        onNodeDragStop={(_, flowNode) => {
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
          const node = diagramById.get(flowNode.id)
          if (!node) return
          const container = node.container_parent_block_id
            ? diagramById.get(node.container_parent_block_id) : undefined
          const nextX = container?.expanded
            ? container.x + flowNode.position.x : flowNode.position.x
          const nextY = container?.expanded
            ? container.y + flowNode.position.y : flowNode.position.y
          const size = projectedSizeById.get(node.id)
            ?? { width: node.width, height: node.height }
          const centerX = nextX + size.width / 2
          const centerY = nextY + size.height / 2
          const geometricallyInside = centerX >= diagram.boundary.x
            && centerX <= diagram.boundary.x + diagram.boundary.width
            && centerY >= diagram.boundary.y
            && centerY <= diagram.boundary.y + diagram.boundary.height
          const inside = container
            ? container.inside_boundary : geometricallyInside
          const dx = nextX - node.x
          const dy = nextY - node.y
          const descendants = new Set<string>()
          const visit = (parentId: string) => {
            for (const child of diagram.nodes.filter(item =>
              item.container_parent_block_id === parentId)) {
              if (descendants.has(child.id)) continue
              descendants.add(child.id)
              visit(child.id)
            }
          }
          visit(node.id)
          update({ block_diagram: {
            ...diagram,
            nodes: diagram.nodes.map(item => {
              if (item.id === node.id) return {
                ...item,
                x: nextX,
                y: nextY,
                inside_boundary: inside,
              }
              return descendants.has(item.id)
                ? {
                    ...item,
                    x: item.x + dx,
                    y: item.y + dy,
                    inside_boundary: inside,
                  }
                : item
            }),
          } })
        }}
        onConnect={connect} isValidConnection={candidate =>
          isValidConnection(candidate as Connection)}
        onConnectStart={(_, params) =>
          setConnectingFromId(params.nodeId ?? '')}
        onConnectEnd={() => setConnectingFromId('')}
        onNodeClick={(_, node) => {
          wrapperRef.current?.focus({ preventScroll: true })
          setSelectedNodeId(node.id)
          setSelectedInterfaceId('')
          setSelectedInterfaceGroupId('')
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
        snapToGrid={diagram.snap_to_grid} snapGrid={[20, 20]}
        selectionOnDrag multiSelectionKeyCode="Shift" deleteKeyCode={null}>
        <Background variant={BackgroundVariant.Dots}
          color={diagram.snap_to_grid ? '#94a3b8' : '#cbd5e1'}
          gap={20} size={diagram.snap_to_grid ? 1.2 : 0.7} />
        <Controls />
        <MiniMap pannable zoomable nodeColor={node =>
          node.id === BOUNDARY_ID ? '#dbeafe'
            : node.data.kind === 'external' ? '#8b5cf6' : '#475569'} />
      </ReactFlow>
    </div>
    <aside className="w-72 shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-3"
      data-export-ignore>
      {selectedDiagramNode && <>
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold text-slate-700">Block properties</div>
          <button type="button" onClick={() => removeDiagramNode(selectedDiagramNode)}
            title="Remove from diagram"
            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600">
            <Trash2 size={13} />
          </button>
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
            : <div className="rounded bg-slate-50 px-2 py-2">
                <div className="text-xs font-medium text-slate-700">
                  {structureById.get(selectedDiagramNode.structure_node_id ?? '')?.name
                    || 'Missing structure record'}
                </div>
                <div className="mt-0.5 text-[9px] text-slate-400">
                  Managed by the Structure Hierarchy
                </div>
              </div>}
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
                  {item.flow_description || 'Flow not described'}
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
          <button type="button" onClick={() => removeInterface(selectedInterface)}
            title="Delete interface"
            className="flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-[10px] font-medium text-red-600 hover:bg-red-50">
            <Trash2 size={11} /> Delete connector
          </button>
        </div>
        <div className="mt-3 space-y-2.5">
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
              {analysis.functions.map(item =>
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
        </div>
      </>}
      {!selectedDiagramNode && selectedNodeId !== BOUNDARY_ID
        && !selectedInterface && !selectedInterfaceGroup && <div
          className="flex h-full min-h-48 items-center justify-center text-center text-[11px] leading-relaxed text-slate-400">
          Select a block, boundary, or interface connector to edit it.
          Drag between block connection points to define an interface.
        </div>}
    </aside>
  </div>

  return <div className={fullscreen
    ? 'fixed inset-0 z-[120] flex flex-col bg-white'
    : 'overflow-hidden rounded-xl border border-slate-200 bg-white'}>
    {fullscreen && <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
      <div>
        <div className="text-sm font-semibold text-slate-800">
          {analysis.name} · Block/Boundary Diagram
        </div>
        <div className="text-[10px] text-slate-400">
          Draw connectors to create auditable FMEA Interface records.
        </div>
      </div>
      <button type="button" onClick={() => setFullscreen(false)}
        className="flex items-center gap-1 rounded border border-slate-200 px-3 py-1.5 text-xs text-slate-600">
        <Minimize2 size={13} /> Restore
      </button>
    </div>}
    {canvas}
  </div>
}
