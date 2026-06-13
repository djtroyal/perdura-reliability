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
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Plus, Play, Trash2, Download, LayoutGrid, Copy, Clipboard } from 'lucide-react'
import { analyzeFaultTree, FaultTreeResponse } from '../../api/client'
import ResultsTable from '../shared/ResultsTable'
import { useModuleState, useRevision } from '../../store/project'
import LibraryPanel, { LibraryItem } from '../shared/LibraryPanel'
import { CanvasErrorBoundary, sanitizeNodeChanges, sanitizeNodes } from '../shared/CanvasErrorBoundary'

// --- Distribution CDF helpers (for computing probability from distributions) ---

function normalCDF(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x) / Math.sqrt(2)
  const t = 1.0 / (1.0 + p * ax)
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax)
  return 0.5 * (1.0 + sign * y)
}

export function computeCDF(dist: string, params: Record<string, number>, t: number): number {
  if (t <= 0 && dist !== 'normal') return 0
  switch (dist) {
    case 'exponential':
      return 1 - Math.exp(-(params.lambda ?? 0.001) * t)
    case 'weibull': {
      const alpha = params.alpha ?? 1000, beta = params.beta ?? 1.5
      if (alpha <= 0 || beta <= 0) return 0
      return 1 - Math.exp(-Math.pow(t / alpha, beta))
    }
    case 'normal':
      return normalCDF((t - (params.mu ?? 1000)) / (params.sigma ?? 200))
    case 'lognormal': {
      if (t <= 0) return 0
      return normalCDF((Math.log(t) - (params.mu ?? 6.9)) / (params.sigma ?? 0.5))
    }
    default:
      return 0
  }
}

export const DIST_OPTIONS = [
  { value: '', label: 'Manual (direct probability)' },
  { value: 'exponential', label: 'Exponential' },
  { value: 'weibull', label: 'Weibull (2P)' },
  { value: 'normal', label: 'Normal' },
  { value: 'lognormal', label: 'Lognormal (2P)' },
]

export const DIST_PARAMS: Record<string, { key: string; label: string; default: number }[]> = {
  exponential: [{ key: 'lambda', label: 'Failure rate (λ)', default: 0.001 }],
  weibull: [
    { key: 'alpha', label: 'Scale (α)', default: 1000 },
    { key: 'beta', label: 'Shape (β)', default: 1.5 },
  ],
  normal: [
    { key: 'mu', label: 'Mean (μ)', default: 1000 },
    { key: 'sigma', label: 'Std dev (σ)', default: 200 },
  ],
  lognormal: [
    { key: 'mu', label: 'Log-mean (μ)', default: 6.9 },
    { key: 'sigma', label: 'Log-std (σ)', default: 0.5 },
  ],
}

// --- Gate / Event node components (traditional FTA SVG shapes) ---

function BasicEventNode({ data, selected }: NodeProps) {
  const highlighted = data.highlighted as boolean
  const desc = String(data.description || '')
  const truncDesc = desc.length > 14 ? desc.slice(0, 13) + '…' : desc
  const isMirror = data.mirror as boolean
  return (
    <div className={`relative ${selected ? 'drop-shadow-lg' : ''}`} style={{ width: 70, height: 70 }}>
      <Handle type="target" position={Position.Top} className="!bg-gray-400" style={{ top: -4 }} />
      <svg viewBox="0 0 70 70" className="w-full h-full">
        <circle cx="35" cy="35" r="30"
          fill={highlighted ? '#fef3c7' : 'white'}
          stroke={highlighted ? '#f59e0b' : selected ? '#3b82f6' : '#9ca3af'}
          strokeWidth={highlighted ? 3 : 2.5}
          strokeDasharray={isMirror ? '4 2' : undefined} />
        <text x="35" y={desc ? 26 : 32} textAnchor="middle" fill="#374151" fontSize="10" fontWeight="600">{String(data.label || 'Event')}</text>
        <text x="35" y={desc ? 39 : 45} textAnchor="middle" fill="#6b7280" fontSize="9">p={Number(data.probability ?? 0.01).toExponential(2)}</text>
        {desc && (
          <text x="35" y="52" textAnchor="middle" fill="#9ca3af" fontSize="7.5">{truncDesc}</text>
        )}
      </svg>
    </div>
  )
}

function AndGateNode({ data, selected }: NodeProps) {
  return (
    <div className={`relative ${selected ? 'drop-shadow-lg' : ''}`} style={{ width: 80, height: 80 }}>
      <Handle type="target" position={Position.Top} className="!bg-indigo-400" style={{ top: -4 }} />
      <svg viewBox="0 0 80 80" className="w-full h-full">
        <path d="M 10 50 L 10 20 Q 10 5, 40 5 Q 70 5, 70 20 L 70 50 Z"
              fill={selected ? '#4338ca' : '#4f46e5'} stroke="#312e81" strokeWidth="2" />
        <text x="40" y="35" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold">AND</text>
        <text x="40" y="48" textAnchor="middle" fill="rgba(255,255,255,0.8)" fontSize="9">{String(data.label || '')}</text>
      </svg>
      <Handle type="source" position={Position.Bottom} className="!bg-indigo-400" style={{ bottom: -4 }} />
    </div>
  )
}

function OrGateNode({ data, selected }: NodeProps) {
  return (
    <div className={`relative ${selected ? 'drop-shadow-lg' : ''}`} style={{ width: 80, height: 80 }}>
      <Handle type="target" position={Position.Top} className="!bg-orange-400" style={{ top: -4 }} />
      <svg viewBox="0 0 80 80" className="w-full h-full">
        <path d="M 10 55 Q 15 30, 40 5 Q 65 30, 70 55 Q 40 45, 10 55 Z"
              fill={selected ? '#c2410c' : '#ea580c'} stroke="#9a3412" strokeWidth="2" />
        <text x="40" y="35" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold">OR</text>
        <text x="40" y="48" textAnchor="middle" fill="rgba(255,255,255,0.8)" fontSize="9">{String(data.label || '')}</text>
      </svg>
      <Handle type="source" position={Position.Bottom} className="!bg-orange-400" style={{ bottom: -4 }} />
    </div>
  )
}

function VoteGateNode({ data, selected }: NodeProps) {
  return (
    <div className={`relative ${selected ? 'drop-shadow-lg' : ''}`} style={{ width: 80, height: 80 }}>
      <Handle type="target" position={Position.Top} className="!bg-purple-400" style={{ top: -4 }} />
      <svg viewBox="0 0 80 80" className="w-full h-full">
        <path d="M 10 50 L 10 20 Q 10 5, 40 5 Q 70 5, 70 20 L 70 50 Z"
              fill={selected ? '#7e22ce' : '#9333ea'} stroke="#581c87" strokeWidth="2" />
        <text x="40" y="30" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold">{String(data.k ?? 2)}/N</text>
        <text x="40" y="45" textAnchor="middle" fill="rgba(255,255,255,0.8)" fontSize="9">{String(data.label || '')}</text>
      </svg>
      <Handle type="source" position={Position.Bottom} className="!bg-purple-400" style={{ bottom: -4 }} />
    </div>
  )
}

function PANDGateNode({ data, selected }: NodeProps) {
  return (
    <div className={`relative ${selected ? 'drop-shadow-lg' : ''}`} style={{ width: 80, height: 80 }}>
      <Handle type="target" position={Position.Top} className="!bg-teal-400" style={{ top: -4 }} />
      <svg viewBox="0 0 80 80" className="w-full h-full">
        <path d="M 10 50 L 10 20 Q 10 5, 40 5 Q 70 5, 70 20 L 70 50 Z"
              fill={selected ? '#0f766e' : '#0d9488'} stroke="#134e4a" strokeWidth="2" />
        {/* Priority indicator triangle */}
        <polygon points="40,52 34,62 46,62" fill="rgba(255,255,255,0.6)" />
        <text x="40" y="30" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold">PAND</text>
        <text x="40" y="45" textAnchor="middle" fill="rgba(255,255,255,0.8)" fontSize="9">{String(data.label || '')}</text>
      </svg>
      <Handle type="source" position={Position.Bottom} className="!bg-teal-400" style={{ bottom: -4 }} />
    </div>
  )
}

function XORGateNode({ data, selected }: NodeProps) {
  return (
    <div className={`relative ${selected ? 'drop-shadow-lg' : ''}`} style={{ width: 80, height: 80 }}>
      <Handle type="target" position={Position.Top} className="!bg-rose-400" style={{ top: -4 }} />
      <svg viewBox="0 0 80 80" className="w-full h-full">
        <path d="M 10 55 Q 15 30, 40 5 Q 65 30, 70 55 Q 40 45, 10 55 Z"
              fill={selected ? '#be123c' : '#e11d48'} stroke="#9f1239" strokeWidth="2" />
        <text x="40" y="35" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold">XOR</text>
        <text x="40" y="48" textAnchor="middle" fill="rgba(255,255,255,0.8)" fontSize="9">{String(data.label || '')}</text>
      </svg>
      <Handle type="source" position={Position.Bottom} className="!bg-rose-400" style={{ bottom: -4 }} />
    </div>
  )
}

function NOTGateNode({ data, selected }: NodeProps) {
  return (
    <div className={`relative ${selected ? 'drop-shadow-lg' : ''}`} style={{ width: 80, height: 80 }}>
      <Handle type="target" position={Position.Top} className="!bg-slate-400" style={{ top: -4 }} />
      <svg viewBox="0 0 80 80" className="w-full h-full">
        {/* Inverter triangle pointing down */}
        <polygon points="40,5 10,60 70,60"
                 fill={selected ? '#334155' : '#475569'} stroke="#1e293b" strokeWidth="2" />
        {/* Small circle at the bottom for NOT symbol */}
        <circle cx="40" cy="65" r="5" fill="none" stroke="#1e293b" strokeWidth="2" />
        <text x="40" y="35" textAnchor="middle" fill="white" fontSize="11" fontWeight="bold">NOT</text>
        <text x="40" y="50" textAnchor="middle" fill="rgba(255,255,255,0.8)" fontSize="9">{String(data.label || '')}</text>
      </svg>
      <Handle type="source" position={Position.Bottom} className="!bg-slate-400" style={{ bottom: -4 }} />
    </div>
  )
}

function TransferGateNode({ data, selected }: NodeProps) {
  return (
    <div className={`relative ${selected ? 'drop-shadow-lg' : ''}`} style={{ width: 80, height: 80 }}>
      <Handle type="target" position={Position.Top} className="!bg-cyan-400" style={{ top: -4 }} />
      <svg viewBox="0 0 80 80" className="w-full h-full">
        {/* Triangle pointing right */}
        <polygon points="10,10 70,40 10,70"
                 fill={selected ? '#0e7490' : '#0891b2'} stroke="#155e75" strokeWidth="2" />
        <text x="35" y="43" textAnchor="middle" fill="white" fontSize="11" fontWeight="bold">XFER</text>
      </svg>
      <Handle type="source" position={Position.Bottom} className="!bg-cyan-400" style={{ bottom: -4 }} />
    </div>
  )
}

const nodeTypes = {
  basic: BasicEventNode,
  and: AndGateNode,
  or: OrGateNode,
  vote: VoteGateNode,
  pand: PANDGateNode,
  xor: XORGateNode,
  not: NOTGateNode,
  transfer: TransferGateNode,
}

const importanceCols = [
  { key: 'event', label: 'Event' },
  { key: 'Birnbaum', label: 'Birnbaum' },
  { key: 'Fussell-Vesely', label: 'FV' },
  { key: 'RAW', label: 'RAW' },
  { key: 'RRW', label: 'RRW' },
]

interface CanvasState { nodes: Node[]; edges: Edge[] }
const INITIAL_CANVAS: CanvasState = { nodes: [], edges: [] }

export default function FaultTreePage() {
  const [persisted, setPersisted] = useModuleState<CanvasState>('faultTree', INITIAL_CANVAS)
  const revision = useRevision()
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(sanitizeNodes(persisted.nodes ?? []))
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(persisted.edges)
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [result, setResult] = useState<FaultTreeResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultTab, setResultTab] = useState<'mcs' | 'importance'>('mcs')
  const [activeMCS, setActiveMCS] = useState<number | null>(null)
  const [clipboard, setClipboard] = useState<Record<string, unknown> | null>(null)

  // Compute which node IDs should be highlighted based on the selected MCS
  const highlightedNodes = useMemo<Set<string>>(() => {
    if (activeMCS == null || !result) return new Set<string>()
    return new Set(result.minimal_cut_sets[activeMCS] ?? [])
  }, [activeMCS, result])

  // Propagate highlighting data into nodes so custom node components can access it
  useEffect(() => {
    setNodes(nds => nds.map(n => {
      const isHighlighted = highlightedNodes.has(n.id)
      if ((n.data.highlighted as boolean) === isHighlighted) return n
      return { ...n, data: { ...n.data, highlighted: isHighlighted } }
    }))
  }, [highlightedNodes]) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist canvas to the project store; re-initialize after import/new project
  useEffect(() => { setPersisted({ nodes, edges }) }, [nodes, edges]) // eslint-disable-line react-hooks/exhaustive-deps
  const seenRevision = useRef(revision)
  useEffect(() => {
    if (revision !== seenRevision.current) {
      seenRevision.current = revision
      setNodes(sanitizeNodes(persisted.nodes ?? []))
      setEdges(persisted.edges ?? [])
      setSelectedNode(null)
      setResult(null)
      setActiveMCS(null)
    }
  }, [revision]) // eslint-disable-line react-hooks/exhaustive-deps

  const onConnect = useCallback(
    (connection: Connection) => setEdges(eds => addEdge(connection, eds)),
    [setEdges]
  )

  const onNodesChangeWrapped = useCallback(
    (changes: NodeChange[]) => onNodesChange(sanitizeNodeChanges(changes)),
    [onNodesChange],
  )

  const addNode = (type: 'basic' | 'and' | 'or' | 'vote' | 'pand' | 'xor' | 'not' | 'transfer') => {
    const maxId = nodes.reduce((m, n) => {
      const match = /^n(\d+)$/.exec(n.id)
      return match ? Math.max(m, parseInt(match[1], 10)) : m
    }, 0)
    const id = `n${maxId + 1}`
    const defaults: Record<string, unknown> = { label: `${type.toUpperCase()}_${id}` }
    if (type === 'basic') defaults.probability = 0.01
    if (type === 'vote') defaults.k = 2
    const newNode: Node = {
      id,
      type,
      position: { x: 200 + Math.random() * 200, y: 100 + Math.random() * 200 },
      data: defaults,
    }
    setNodes(nds => [...nds, newNode])
  }

  const copyNode = () => {
    if (!selectedNode || selectedNode.type !== 'basic') return
    setClipboard({ ...selectedNode.data })
  }

  const pasteAsMirror = () => {
    if (!clipboard) return
    const maxId = nodes.reduce((m, n) => {
      const match = /^n(\d+)$/.exec(n.id)
      return match ? Math.max(m, parseInt(match[1], 10)) : m
    }, 0)
    const id = `n${maxId + 1}`
    const newNode: Node = {
      id,
      type: 'basic',
      position: { x: 200 + Math.random() * 200, y: 100 + Math.random() * 200 },
      data: { ...clipboard, mirror: true },
    }
    setNodes(nds => [...nds, newNode])
  }

  const autoLayout = () => {
    // Find children: edges go from parent (source) to child (target)
    const children = new Map<string, string[]>()
    const hasParent = new Set<string>()
    edges.forEach(e => {
      children.set(e.source, [...(children.get(e.source) ?? []), e.target])
      hasParent.add(e.target)
    })

    // Find root(s) - nodes with no parent
    const roots = nodes.filter(n => !hasParent.has(n.id)).map(n => n.id)
    if (roots.length === 0) return

    // BFS to assign layers (top-down)
    const layers = new Map<string, number>()
    const queue = [...roots]
    roots.forEach(r => layers.set(r, 0))
    while (queue.length > 0) {
      const cur = queue.shift()!
      for (const child of (children.get(cur) ?? [])) {
        const newLayer = layers.get(cur)! + 1
        if (!layers.has(child) || layers.get(child)! < newLayer) {
          layers.set(child, newLayer)
          queue.push(child)
        }
      }
    }

    // Position nodes not connected to any root
    nodes.forEach(n => { if (!layers.has(n.id)) layers.set(n.id, 0) })

    // Group nodes by layer
    const byLayer = new Map<number, string[]>()
    layers.forEach((layer, id) => {
      byLayer.set(layer, [...(byLayer.get(layer) ?? []), id])
    })

    const xGap = 160, yGap = 140, startY = 50
    setNodes(nds => nds.map(n => {
      const layer = layers.get(n.id) ?? 0
      const nodesInLayer = byLayer.get(layer) ?? [n.id]
      const idx = nodesInLayer.indexOf(n.id)
      const totalWidth = (nodesInLayer.length - 1) * xGap
      return {
        ...n,
        position: {
          x: 400 - totalWidth / 2 + idx * xGap,
          y: startY + layer * yGap,
        },
      }
    }))
  }

  const deleteSelected = () => {
    if (!selectedNode) return
    setNodes(nds => nds.filter(n => n.id !== selectedNode.id))
    setEdges(eds => eds.filter(e => e.source !== selectedNode.id && e.target !== selectedNode.id))
    setSelectedNode(null)
  }

  const updateData = (key: string, value: unknown) => {
    if (!selectedNode) return
    setNodes(nds => nds.map(n =>
      n.id === selectedNode.id ? { ...n, data: { ...n.data, [key]: value } } : n
    ))
    setSelectedNode(prev => prev ? { ...prev, data: { ...prev.data, [key]: value } } : null)
  }

  const updateDataMulti = (updates: Record<string, unknown>) => {
    if (!selectedNode) return
    setNodes(nds => nds.map(n =>
      n.id === selectedNode.id ? { ...n, data: { ...n.data, ...updates } } : n
    ))
    setSelectedNode(prev => prev ? { ...prev, data: { ...prev.data, ...updates } } : null)
  }

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node)
  }, [])

  const onPaneClick = useCallback(() => setSelectedNode(null), [])

  const analyze = async () => {
    if (!nodes.length) { setError('Add nodes to the fault tree first.'); return }
    setError(null)
    setLoading(true)
    setActiveMCS(null)
    try {
      const apiNodes = nodes.map(n => ({
        id: n.id,
        type: n.type ?? 'basic',
        data: n.data as Record<string, unknown>,
      }))
      const apiEdges = edges.map(e => ({ source: e.source, target: e.target }))
      const res = await analyzeFaultTree(apiNodes, apiEdges)
      setResult(res)
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Analysis error.')
    } finally {
      setLoading(false)
    }
  }

  const downloadMCS = () => {
    if (!result) return
    const rows = result.minimal_cut_sets.map((mcs, i) => `${i + 1},"${mcs.join(', ')}"`)
    const blob = new Blob([`Order,Events\n${rows.join('\n')}`], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'minimal_cut_sets.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex h-[calc(100vh-57px)]">
      {/* Left toolbar */}
      <div className="w-56 flex-shrink-0 bg-white border-r border-gray-200 p-3 flex flex-col gap-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Add Node</p>

        {([
          { type: 'basic', label: 'Basic Event', color: 'border-gray-400 text-gray-700' },
          { type: 'and', label: 'AND Gate', color: 'border-indigo-400 text-indigo-700' },
          { type: 'or', label: 'OR Gate', color: 'border-orange-400 text-orange-700' },
          { type: 'vote', label: 'VOTE Gate', color: 'border-purple-400 text-purple-700' },
          { type: 'pand', label: 'PAND Gate', color: 'border-teal-400 text-teal-700' },
          { type: 'xor', label: 'XOR Gate', color: 'border-rose-400 text-rose-700' },
          { type: 'not', label: 'NOT Gate', color: 'border-slate-400 text-slate-700' },
          { type: 'transfer', label: 'Transfer', color: 'border-cyan-400 text-cyan-700' },
        ] as const).map(({ type, label, color }) => (
          <button
            key={type}
            onClick={() => addNode(type)}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs border rounded hover:bg-gray-50 transition-colors ${color}`}
          >
            <Plus size={12} /> {label}
          </button>
        ))}

        <div className="border-t border-gray-100 my-1" />

        <button
          onClick={deleteSelected}
          disabled={!selectedNode}
          className="flex items-center gap-2 px-3 py-1.5 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50 disabled:opacity-40 transition-colors"
        >
          <Trash2 size={12} /> Delete Selected
        </button>

        <div className="flex gap-1">
          <button
            onClick={copyNode}
            disabled={!selectedNode || selectedNode.type !== 'basic'}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs text-gray-700 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40 transition-colors"
            title="Copy basic event"
          >
            <Copy size={12} /> Copy
          </button>
          <button
            onClick={pasteAsMirror}
            disabled={!clipboard}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs text-amber-700 border border-amber-300 rounded hover:bg-amber-50 disabled:opacity-40 transition-colors"
            title="Paste as mirror/repeated event"
          >
            <Clipboard size={12} /> Mirror
          </button>
        </div>

        <button
          onClick={autoLayout}
          className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
        >
          <LayoutGrid size={12} /> Auto Layout
        </button>

        {/* Node editor */}
        {selectedNode && (
          <div className="border-t border-gray-100 pt-2 flex flex-col gap-2">
            <p className="text-xs font-medium text-gray-600">
              Edit: <span className="capitalize">{selectedNode.type}</span>
              <span className="text-gray-400 ml-1 font-normal">({selectedNode.id})</span>
            </p>
            <div>
              <label className="text-xs text-gray-500 block mb-0.5">Label / ID</label>
              <input
                value={String(selectedNode.data.label ?? '')}
                onChange={e => updateData('label', e.target.value)}
                className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-0.5">Description</label>
              <textarea
                rows={2}
                value={String(selectedNode.data.description ?? '')}
                onChange={e => updateData('description', e.target.value)}
                placeholder="Optional description..."
                className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
              />
            </div>
            {selectedNode.type === 'basic' && (() => {
              const dist = String(selectedNode.data.distribution ?? '')
              const distParams = (selectedNode.data.dist_params ?? {}) as Record<string, number>
              const exposureTime = Number(selectedNode.data.exposure_time ?? 1000)
              const computedProb = dist ? computeCDF(dist, distParams, exposureTime) : null
              return (
                <>
                  <div>
                    <label className="text-xs text-gray-500 block mb-0.5">Failure model</label>
                    <select
                      value={dist}
                      onChange={e => {
                        const d = e.target.value
                        if (d && DIST_PARAMS[d]) {
                          const defaults: Record<string, number> = {}
                          DIST_PARAMS[d].forEach(p => { defaults[p.key] = p.default })
                          const prob = computeCDF(d, defaults, exposureTime)
                          updateDataMulti({ distribution: d, dist_params: defaults, probability: Math.min(1, Math.max(0, prob)) })
                        } else {
                          updateDataMulti({ distribution: undefined, dist_params: undefined })
                        }
                      }}
                      className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    >
                      {DIST_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  {dist && DIST_PARAMS[dist] ? (
                    <>
                      {DIST_PARAMS[dist].map(p => (
                        <div key={p.key}>
                          <label className="text-xs text-gray-500 block mb-0.5">{p.label}</label>
                          <input
                            type="number" step="any"
                            value={distParams[p.key] ?? p.default}
                            onChange={e => {
                              const newParams = { ...distParams, [p.key]: parseFloat(e.target.value) || 0 }
                              const prob = computeCDF(dist, newParams, exposureTime)
                              updateDataMulti({ dist_params: newParams, probability: Math.min(1, Math.max(0, prob)) })
                            }}
                            className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                          />
                        </div>
                      ))}
                      <div>
                        <label className="text-xs text-gray-500 block mb-0.5">Exposure time</label>
                        <input
                          type="number" step="any" min="0"
                          value={exposureTime}
                          onChange={e => {
                            const t = parseFloat(e.target.value) || 0
                            const prob = computeCDF(dist, distParams, t)
                            updateDataMulti({ exposure_time: t, probability: Math.min(1, Math.max(0, prob)) })
                          }}
                          className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                      </div>
                      <div className="bg-blue-50 rounded px-2 py-1.5">
                        <span className="text-[10px] text-gray-500">Computed probability: </span>
                        <span className="text-xs font-mono font-semibold text-blue-700">
                          {computedProb != null ? computedProb.toExponential(4) : '—'}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div>
                      <label className="text-xs text-gray-500 block mb-0.5">Probability</label>
                      <input
                        type="number" min="0" max="1" step="0.001"
                        value={String(selectedNode.data.probability ?? 0.01)}
                        onChange={e => updateData('probability', parseFloat(e.target.value))}
                        className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </div>
                  )}
                </>
              )
            })()}
            {selectedNode.type === 'vote' && (
              <div>
                <label className="text-xs text-gray-500 block mb-0.5">k (votes required)</label>
                <input
                  type="number" min="1" step="1"
                  value={String(selectedNode.data.k ?? 2)}
                  onChange={e => updateData('k', parseInt(e.target.value))}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>
            )}
            {selectedNode.data.linkedTo != null && (
              <p className="text-[10px] text-gray-400">
                Linked to library: {String(selectedNode.data.linkedTo)}
              </p>
            )}
          </div>
        )}

        <LibraryPanel
          mode="probability"
          selectedLabel={selectedNode?.type === 'basic'
            ? String(selectedNode.data.label ?? selectedNode.id) : null}
          onApply={(item: LibraryItem, value: number) => {
            if (!selectedNode) return
            const probability = Math.round(value * 1e8) / 1e8
            setNodes(nds => nds.map(n => n.id === selectedNode.id
              ? { ...n, data: { ...n.data, probability, linkedTo: item.name } } : n))
            setSelectedNode(prev => prev
              ? { ...prev, data: { ...prev.data, probability, linkedTo: item.name } } : null)
          }}
        />

        <div className="mt-auto">
          <p className="text-xs text-gray-400 mb-2 leading-tight">
            Connect gate → child by dragging from bottom handle to top handle.
          </p>
          {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded mb-2">{error}</p>}
          <button
            onClick={analyze}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium py-2 rounded transition-colors"
          >
            <Play size={12} />
            {loading ? 'Analyzing...' : 'Analyze Fault Tree'}
          </button>
        </div>
      </div>

      {/* Canvas */}
      <CanvasErrorBoundary onReset={autoLayout}>
        <div className="flex-1 relative">
          {result && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-white/90 backdrop-blur border border-red-200 rounded-lg shadow-lg px-4 py-2 flex items-center gap-3">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Top Event</span>
              <span className="text-lg font-bold text-red-600">{result.top_event_probability.toExponential(4)}</span>
            </div>
          )}
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChangeWrapped}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            fitView
            deleteKeyCode="Delete"
          >
            <Background color="#e5e7eb" gap={20} />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>
      </CanvasErrorBoundary>

      {/* Results panel */}
      {result && (
        <div className="w-72 flex-shrink-0 bg-white border-l border-gray-200 flex flex-col overflow-hidden">
          <div className="p-3 border-b border-gray-100">
            <p className="text-xs text-gray-500">Top Event Probability</p>
            <p className="text-2xl font-bold text-red-600">
              {result.top_event_probability.toExponential(4)}
            </p>
          </div>

          <div className="flex border-b border-gray-100">
            {([
              { id: 'mcs', label: `MCS (${result.minimal_cut_sets.length})` },
              { id: 'importance', label: 'Importance' },
            ] as const).map(t => (
              <button
                key={t.id}
                onClick={() => setResultTab(t.id)}
                className={`flex-1 py-2 text-xs font-medium border-b-2 transition-colors ${
                  resultTab === t.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500'
                }`}
              >{t.label}</button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {resultTab === 'mcs' && (
              <div className="flex flex-col gap-1">
                <p className="text-[10px] text-gray-400 mb-1">Click a cut set to highlight its events on the diagram.</p>
                {result.minimal_cut_sets.map((mcs, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveMCS(prev => prev === i ? null : i)}
                    className={`text-xs rounded px-2 py-1.5 text-left transition-colors ${
                      activeMCS === i
                        ? 'bg-amber-100 ring-1 ring-amber-400 text-amber-900'
                        : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <span className={`mr-1 ${activeMCS === i ? 'text-amber-500' : 'text-gray-400'}`}>#{i + 1}</span>
                    {mcs.join(', ')}
                  </button>
                ))}
              </div>
            )}
            {resultTab === 'importance' && (
              <ResultsTable
                columns={importanceCols}
                rows={result.importance as Record<string, unknown>[]}
                rowKey="event"
              />
            )}
          </div>

          <div className="p-2 border-t border-gray-100">
            <button onClick={downloadMCS}
              className="w-full flex items-center justify-center gap-1 text-xs text-gray-500 hover:text-blue-600 border border-gray-200 py-1.5 rounded">
              <Download size={11} /> Export MCS
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
