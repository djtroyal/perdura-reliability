import { useState, useCallback, useEffect, useRef } from 'react'
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
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Plus, Play, Trash2, Download } from 'lucide-react'
import { analyzeFaultTree, FaultTreeResponse } from '../../api/client'
import ResultsTable from '../shared/ResultsTable'
import { useModuleState, useRevision } from '../../store/project'
import LibraryPanel, { LibraryItem } from '../shared/LibraryPanel'

// --- Gate / Event node components ---

const gateStyle = (color: string, selected: boolean) =>
  `px-3 py-2 rounded shadow text-xs font-medium text-white min-w-[100px] text-center ${color} ${
    selected ? 'ring-2 ring-offset-1 ring-blue-400' : ''
  }`

function BasicEventNode({ data, selected }: NodeProps) {
  return (
    <div className={`px-3 py-2 bg-white border-2 rounded-full shadow text-xs min-w-[100px] text-center ${
      selected ? 'border-blue-500' : 'border-gray-400'
    }`}>
      <Handle type="target" position={Position.Top} className="!bg-gray-400" />
      <div className="font-medium text-gray-800">{String(data.label || 'Event')}</div>
      <div className="text-gray-500 mt-0.5">p = {String(data.probability ?? 0.01)}</div>
    </div>
  )
}

function AndGateNode({ data, selected }: NodeProps) {
  return (
    <div className={gateStyle('bg-indigo-600', selected as boolean)}>
      <Handle type="target" position={Position.Top} className="!bg-indigo-300" />
      <div>AND</div>
      <div className="font-normal opacity-80 mt-0.5">{String(data.label || '')}</div>
      <Handle type="source" position={Position.Bottom} className="!bg-indigo-300" />
    </div>
  )
}

function OrGateNode({ data, selected }: NodeProps) {
  return (
    <div className={gateStyle('bg-orange-500', selected as boolean)}>
      <Handle type="target" position={Position.Top} className="!bg-orange-300" />
      <div>OR</div>
      <div className="font-normal opacity-80 mt-0.5">{String(data.label || '')}</div>
      <Handle type="source" position={Position.Bottom} className="!bg-orange-300" />
    </div>
  )
}

function VoteGateNode({ data, selected }: NodeProps) {
  return (
    <div className={gateStyle('bg-purple-600', selected as boolean)}>
      <Handle type="target" position={Position.Top} className="!bg-purple-300" />
      <div>VOTE {String(data.k ?? 2)}-of-N</div>
      <div className="font-normal opacity-80 mt-0.5">{String(data.label || '')}</div>
      <Handle type="source" position={Position.Bottom} className="!bg-purple-300" />
    </div>
  )
}

const nodeTypes = {
  basic: BasicEventNode,
  and: AndGateNode,
  or: OrGateNode,
  vote: VoteGateNode,
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
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(persisted.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(persisted.edges)
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [result, setResult] = useState<FaultTreeResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultTab, setResultTab] = useState<'mcs' | 'importance'>('mcs')

  // Persist canvas to the project store; re-initialize after import/new project
  useEffect(() => { setPersisted({ nodes, edges }) }, [nodes, edges]) // eslint-disable-line react-hooks/exhaustive-deps
  const seenRevision = useRef(revision)
  useEffect(() => {
    if (revision !== seenRevision.current) {
      seenRevision.current = revision
      setNodes(persisted.nodes ?? [])
      setEdges(persisted.edges ?? [])
      setSelectedNode(null)
      setResult(null)
    }
  }, [revision]) // eslint-disable-line react-hooks/exhaustive-deps

  const onConnect = useCallback(
    (connection: Connection) => setEdges(eds => addEdge(connection, eds)),
    [setEdges]
  )

  const addNode = (type: 'basic' | 'and' | 'or' | 'vote') => {
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

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node)
  }, [])

  const onPaneClick = useCallback(() => setSelectedNode(null), [])

  const analyze = async () => {
    if (!nodes.length) { setError('Add nodes to the fault tree first.'); return }
    setError(null)
    setLoading(true)
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

        {/* Node editor */}
        {selectedNode && (
          <div className="border-t border-gray-100 pt-2 flex flex-col gap-2">
            <p className="text-xs font-medium text-gray-600">
              Edit: <span className="capitalize">{selectedNode.type}</span>
            </p>
            <div>
              <label className="text-xs text-gray-500 block mb-0.5">Label</label>
              <input
                value={String(selectedNode.data.label ?? '')}
                onChange={e => updateData('label', e.target.value)}
                className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
            {selectedNode.type === 'basic' && (
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
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
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
                {result.minimal_cut_sets.map((mcs, i) => (
                  <div key={i} className="text-xs bg-gray-50 rounded px-2 py-1.5">
                    <span className="text-gray-400 mr-1">#{i + 1}</span>
                    <span className="text-gray-700">{mcs.join(', ')}</span>
                  </div>
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
