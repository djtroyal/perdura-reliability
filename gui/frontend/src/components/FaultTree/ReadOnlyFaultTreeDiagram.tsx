import { useEffect, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { ReactFlow, ReactFlowProvider, useNodesInitialized, useNodesState, useReactFlow, MarkerType, type Node, type Edge } from '@xyflow/react'
import { ftaNodeTypes, ftaEdgeTypes, resolveGateIds, normalizeSemanticEdges, ANNOTATION_PALETTE } from './index'
import { adaptiveConnectorOffset } from '../shared/adaptiveDiagramLayout.mjs'
import type { FtaTreeState } from './libraryModel'
import { captureDiagramPng, captureDiagramSvg } from '../shared/exportDiagram'

const EMPTY_TREE_NAMES: Record<string, string> = {}

export interface ReadOnlyFaultTreeDiagramProps {
  state: FtaTreeState
  label?: string
  height?: number
  className?: string
  showResults?: boolean
  treeNames?: Record<string, string>
  onReady?: () => void
}

function Ready({ empty, onReady }: { empty: boolean; onReady?: () => void }) {
  const initialized = useNodesInitialized()
  const { fitView } = useReactFlow()
  useEffect(() => {
    if (!initialized && !empty) return
    let cancelled = false
    void (async () => {
      if (!empty) await fitView({ padding: 0.08, minZoom: 0.001, maxZoom: 1.4, duration: 0 })
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      if (!cancelled) onReady?.()
    })()
    return () => { cancelled = true }
  }, [initialized, empty, fitView, onReady])
  return null
}

/** Renders saved graph data without mounting an editor or changing the active folio. */
export default function ReadOnlyFaultTreeDiagram({ state, label = 'Fault tree diagram', height = 460,
  className, showResults = false, treeNames = EMPTY_TREE_NAMES, onReady }: ReadOnlyFaultTreeDiagramProps) {
  const { nodes, edges } = useMemo(() => {
    const saved = state as FtaTreeState & { annotations?: Node[]; density?: 'comfortable' | 'compact' | 'dense' | 'expanded' | 'spacious'; showNodeIds?: boolean; connectorStyle?: 'smoothstep' | 'bezier' | 'straight' }
    const result = state.result as { node_results?: { node_id: string; probability: number }[] } | undefined
    const probabilities = new Map(showResults ? (result?.node_results ?? []).map(node => [node.node_id, node.probability]) : [])
    const events = new Set(['basic', 'undeveloped', 'house', 'conditioning', 'external'])
    const graphNodes: Node[] = (state.nodes ?? []).map((node, index) => ({ ...node,
      position: node.position ?? { x: (index % 5) * 240, y: Math.floor(index / 5) * 210 }, data: node.data ?? {} }))
    const modelEdges = normalizeSemanticEdges((state.edges ?? []).map((edge, index) => ({ ...edge,
      id: edge.id ?? `report-edge-${index}`, data: { ...edge.data, role: edge.data?.role ?? edge.role,
        order: edge.data?.order ?? edge.order } })), graphNodes)
    const childCounts = new Map<string, number>(), parentCounts = new Map<string, number>(), occurrences = new Map<string, number>()
    for (const edge of modelEdges) {
      childCounts.set(edge.source, (childCounts.get(edge.source) ?? 0) + 1)
      parentCounts.set(edge.target, (parentCounts.get(edge.target) ?? 0) + 1)
    }
    for (const node of graphNodes) if (events.has(node.type ?? '') && node.type !== 'house') {
      const key = String(node.data.eventKey ?? node.id); occurrences.set(key, (occurrences.get(key) ?? 0) + 1)
    }
    const gateIds = resolveGateIds(graphNodes)
    const nodes: Node[] = [...graphNodes, ...(saved.annotations ?? [])].map(node => ({ ...node,
      data: { ...node.data, highlighted: false, computedP: probabilities.get(node.id), expandReference: false,
        ...(node.type !== 'annotation' && !events.has(node.type ?? '') ? { gateId: gateIds.get(node.id) } : {}),
        ...(node.type === 'transfer' ? { transferToName: treeNames[String(node.data.transferTo ?? node.data.ref_tree ?? '')]
          ?? String(node.data.transferTo ?? node.data.ref_tree ?? 'Unresolved target') } : {}),
        ...(events.has(node.type ?? '') && node.type !== 'house' ? { eventOccurrenceCount: occurrences.get(String(node.data.eventKey ?? node.id)) ?? 1 } : {}),
        ...(node.type === 'vote' ? { inputCount: childCounts.get(node.id) ?? 0 } : {}),
        structuralRole: node.type === 'or' && childCounts.get(node.id) === 1
          ? ((parentCounts.get(node.id) ?? 0) === 0 ? 'top' : 'intermediate') : undefined,
        displayDensity: saved.density ?? 'comfortable', showNodeIds: saved.showNodeIds ?? true },
      selected: false, draggable: false, connectable: false, selectable: false,
    }))
    const style = saved.connectorStyle ?? 'smoothstep'
    const edges: Edge[] = modelEdges.map(edge => ({ ...edge, selected: false, animated: false,
      type: style === 'smoothstep' ? childCounts.get(edge.source) === 1 ? 'straight' : 'adaptiveOrthogonal' : style,
      data: { ...edge.data, adaptiveRoute: { ...(edge.data?.adaptiveRoute as object ?? {}), orientation: 'vertical',
        trunk: 'source', offset: adaptiveConnectorOffset(saved.density ?? 'comfortable', style) } },
      markerStart: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#64748b' },
      style: { stroke: '#64748b', strokeWidth: 1.6 },
    }))
    for (const annotation of saved.annotations ?? []) {
      const target = graphNodes.find(node => node.id === String(annotation.data.targetId ?? ''))
      if (!target) continue
      const shape = String(annotation.data.shape ?? 'rounded')
      const width = Number(annotation.measured?.width ?? annotation.width) || (['oval', 'capsule'].includes(shape) ? 208 : 192)
      const height = Number(annotation.measured?.height ?? annotation.height) || (shape === 'oval' ? 96 : 64)
      const targetWidth = Number(target.measured?.width ?? target.width) || (events.has(target.type ?? '') ? 144 : 160)
      const targetHeight = Number(target.measured?.height ?? target.height) || 120
      const dx = annotation.position.x + width / 2 - target.position.x - targetWidth / 2
      const dy = annotation.position.y + height / 2 - target.position.y - targetHeight / 2
      const horizontal = Math.abs(dx) >= Math.abs(dy)
      const sourceSide = horizontal ? dx >= 0 ? 'left' : 'right' : dy >= 0 ? 'top' : 'bottom'
      const targetSide = horizontal ? dx >= 0 ? 'right' : 'left' : dy >= 0 ? 'bottom' : 'top'
      const color = (ANNOTATION_PALETTE[String(annotation.data.color ?? 'amber')] ?? ANNOTATION_PALETTE.amber).accent
      edges.push({ id: `annotation-edge:${annotation.id}`, source: annotation.id, target: target.id,
        sourceHandle: `annotation-${sourceSide}`, targetHandle: `annotation-label-${targetSide}`, type: 'straight',
        selectable: false, markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color },
        style: { stroke: color, strokeWidth: 1.25, opacity: .9, strokeDasharray: '5 4' } })
    }
    return { nodes, edges }
  }, [state, showResults, treeNames])
  // React Flow reports measured dimensions through onNodesChange even for a read-only graph.
  // Keep those measurements locally so initialization/fitView can complete.
  const [renderNodes, setRenderNodes, onNodesChange] = useNodesState(nodes)
  useEffect(() => { setRenderNodes(nodes) }, [nodes, setRenderNodes])
  return <figure className={className} aria-label={label}>
    <div style={{ height, width: '100%', background: 'white' }}>
      <ReactFlowProvider><ReactFlow nodes={renderNodes} onNodesChange={onNodesChange} edges={edges} nodeTypes={ftaNodeTypes} edgeTypes={ftaEdgeTypes}
        nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
        panOnDrag={false} zoomOnScroll={false} zoomOnPinch={false} zoomOnDoubleClick={false}
        preventScrolling={false} minZoom={0.001} proOptions={{ hideAttribution: true }}>
        <Ready empty={nodes.length === 0} onReady={onReady} />
      </ReactFlow></ReactFlowProvider>
    </div>
    <figcaption className="px-2 py-1 text-xs text-slate-600">{label}</figcaption>
  </figure>
}

export interface FtaDiagramImage { dataUrl: string; width: number; height: number; svgDataUrl: string }
export async function renderFtaDiagram(state: FtaTreeState, label: string, showResults = false,
  treeNames?: Record<string, string>): Promise<FtaDiagramImage> {
  const container = document.createElement('div')
  container.style.cssText = 'position:fixed;left:-20000px;top:0;width:1200px;background:white'
  document.body.appendChild(container)
  let fail!: (error: unknown) => void
  let ready!: () => void
  const initialized = new Promise<void>((resolve, reject) => { ready = resolve; fail = reject })
  const root = createRoot(container, { onUncaughtError: fail })
  const timer = setTimeout(() => fail(new Error(`Diagram rendering timed out: ${label}`)), 20000)
  try {
    root.render(<ReadOnlyFaultTreeDiagram state={state} label={label} height={800} showResults={showResults} treeNames={treeNames} onReady={ready} />)
    await initialized
    await document.fonts?.ready
    // Capture the inner figure: cloning the fixed offscreen host would preserve its
    // negative left coordinate and produce an empty PNG/SVG.
    const figure = container.querySelector('figure')
    if (!figure) throw new Error(`Missing rendered diagram: ${label}`)
    const image = await captureDiagramPng(figure)
    const svgDataUrl = await captureDiagramSvg(figure)
    return { ...image, svgDataUrl }
  } finally {
    clearTimeout(timer)
    root.unmount()
    container.remove()
  }
}
