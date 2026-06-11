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
import { Plus, Play, Trash2 } from 'lucide-react'
import { computeRBD, RBDResponse } from '../../api/client'
import { useModuleState, useRevision } from '../../store/project'
import LibraryPanel, { LibraryItem } from '../shared/LibraryPanel'

// --- Custom node components ---

function SourceNode({ data }: NodeProps) {
  return (
    <div className="px-3 py-2 bg-gray-800 text-white rounded text-xs font-medium shadow">
      {String(data.label || 'Source')}
      <Handle type="source" position={Position.Right} className="!bg-gray-400" />
    </div>
  )
}

function SinkNode({ data }: NodeProps) {
  return (
    <div className="px-3 py-2 bg-gray-800 text-white rounded text-xs font-medium shadow">
      <Handle type="target" position={Position.Left} className="!bg-gray-400" />
      {String(data.label || 'Sink')}
    </div>
  )
}

function ComponentNode({ data, selected }: NodeProps) {
  return (
    <div className={`px-3 py-2 bg-white border-2 rounded shadow text-xs min-w-[110px] ${
      selected ? 'border-blue-500' : 'border-gray-300'
    }`}>
      <Handle type="target" position={Position.Left} className="!bg-blue-400" />
      <div className="font-medium text-gray-800 truncate">{String(data.label || 'Component')}</div>
      <div className="text-gray-500 mt-0.5">R = {String(data.reliability ?? 0.9)}</div>
      <Handle type="source" position={Position.Right} className="!bg-blue-400" />
    </div>
  )
}

const nodeTypes = { source: SourceNode, sink: SinkNode, component: ComponentNode }

const DEFAULT_NODES: Node[] = [
  { id: 'source', type: 'source', position: { x: 50, y: 200 }, data: { label: 'Source' } },
  { id: 'sink', type: 'sink', position: { x: 600, y: 200 }, data: { label: 'Sink' } },
]

interface CanvasState { nodes: Node[]; edges: Edge[] }
const INITIAL_CANVAS: CanvasState = { nodes: DEFAULT_NODES, edges: [] }

export default function SystemReliability() {
  const [persisted, setPersisted] = useModuleState<CanvasState>('system', INITIAL_CANVAS)
  const revision = useRevision()
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(persisted.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(persisted.edges)
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [result, setResult] = useState<RBDResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Persist canvas to the project store; re-initialize after import/new project
  useEffect(() => { setPersisted({ nodes, edges }) }, [nodes, edges]) // eslint-disable-line react-hooks/exhaustive-deps
  const seenRevision = useRef(revision)
  useEffect(() => {
    if (revision !== seenRevision.current) {
      seenRevision.current = revision
      setNodes(persisted.nodes ?? DEFAULT_NODES)
      setEdges(persisted.edges ?? [])
      setSelectedNode(null)
      setResult(null)
    }
  }, [revision]) // eslint-disable-line react-hooks/exhaustive-deps

  const onConnect = useCallback(
    (connection: Connection) => setEdges(eds => addEdge({ ...connection, animated: true }, eds)),
    [setEdges]
  )

  const addComponent = () => {
    const maxId = nodes.reduce((m, n) => {
      const match = /^c(\d+)$/.exec(n.id)
      return match ? Math.max(m, parseInt(match[1], 10)) : m
    }, 2)
    const id = `c${maxId + 1}`
    const newNode: Node = {
      id,
      type: 'component',
      position: { x: 250 + Math.random() * 100, y: 100 + Math.random() * 200 },
      data: { label: `Component ${id}`, reliability: 0.9 },
    }
    setNodes(nds => [...nds, newNode])
  }

  const deleteSelected = () => {
    if (!selectedNode || selectedNode.type === 'source' || selectedNode.type === 'sink') return
    setNodes(nds => nds.filter(n => n.id !== selectedNode.id))
    setEdges(eds => eds.filter(e => e.source !== selectedNode.id && e.target !== selectedNode.id))
    setSelectedNode(null)
  }

  const updateSelectedLabel = (label: string) => {
    if (!selectedNode) return
    setNodes(nds => nds.map(n => n.id === selectedNode.id ? { ...n, data: { ...n.data, label } } : n))
    setSelectedNode(prev => prev ? { ...prev, data: { ...prev.data, label } } : null)
  }

  const updateSelectedReliability = (r: string) => {
    if (!selectedNode) return
    const val = parseFloat(r)
    const reliability = isNaN(val) ? 0.9 : Math.max(0, Math.min(1, val))
    setNodes(nds => nds.map(n => n.id === selectedNode.id ? { ...n, data: { ...n.data, reliability } } : n))
    setSelectedNode(prev => prev ? { ...prev, data: { ...prev.data, reliability } } : null)
  }

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node)
  }, [])

  const onPaneClick = useCallback(() => setSelectedNode(null), [])

  const compute = async () => {
    setError(null)
    setLoading(true)
    try {
      const apiNodes = nodes.map(n => ({
        id: n.id,
        type: n.type ?? 'component',
        data: n.data as Record<string, unknown>,
      }))
      const apiEdges = edges.map(e => ({ source: e.source, target: e.target }))
      const res = await computeRBD(apiNodes, apiEdges)
      setResult(res)
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Computation error.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-[calc(100vh-57px)]">
      {/* Left toolbar */}
      <div className="w-56 flex-shrink-0 bg-white border-r border-gray-200 p-3 flex flex-col gap-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Toolbar</p>

        <button
          onClick={addComponent}
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
        >
          <Plus size={14} /> Add Component
        </button>

        <button
          onClick={deleteSelected}
          disabled={!selectedNode || selectedNode.type === 'source' || selectedNode.type === 'sink'}
          className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 border border-red-200 rounded hover:bg-red-50 disabled:opacity-40 transition-colors"
        >
          <Trash2 size={14} /> Delete Selected
        </button>

        {selectedNode && selectedNode.type === 'component' && (
          <div className="border-t border-gray-100 pt-3 flex flex-col gap-2">
            <p className="text-xs font-medium text-gray-600">Selected: {String(selectedNode.data.label)}</p>
            <div>
              <label className="text-xs text-gray-500 mb-0.5 block">Label</label>
              <input
                value={String(selectedNode.data.label)}
                onChange={e => updateSelectedLabel(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-0.5 block">Reliability (0–1)</label>
              <input
                type="number" min="0" max="1" step="0.01"
                value={String(selectedNode.data.reliability ?? 0.9)}
                onChange={e => updateSelectedReliability(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
            {selectedNode.data.linkedTo != null && (
              <p className="text-[10px] text-gray-400">
                Linked to library: {String(selectedNode.data.linkedTo)}
              </p>
            )}
          </div>
        )}

        <LibraryPanel
          mode="reliability"
          selectedLabel={selectedNode?.type === 'component'
            ? String(selectedNode.data.label) : null}
          onApply={(item: LibraryItem, value: number) => {
            if (!selectedNode) return
            const reliability = Math.round(value * 1e6) / 1e6
            setNodes(nds => nds.map(n => n.id === selectedNode.id
              ? { ...n, data: { ...n.data, reliability, linkedTo: item.name } } : n))
            setSelectedNode(prev => prev
              ? { ...prev, data: { ...prev.data, reliability, linkedTo: item.name } } : null)
          }}
        />

        <div className="mt-auto">
          {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded mb-2">{error}</p>}
          <button
            onClick={compute}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2 rounded transition-colors"
          >
            <Play size={14} />
            {loading ? 'Computing...' : 'Compute Reliability'}
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
          <MiniMap nodeColor={n => n.type === 'component' ? '#3b82f6' : '#374151'} />
        </ReactFlow>
      </div>

      {/* Results panel */}
      {result && (
        <div className="w-64 flex-shrink-0 bg-white border-l border-gray-200 p-4 overflow-y-auto">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Results</p>

          <div className="mb-4 p-3 bg-blue-50 rounded">
            <p className="text-xs text-gray-500">System Reliability</p>
            <p className="text-2xl font-bold text-blue-700">
              {(result.system_reliability * 100).toFixed(3)}%
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Unreliability: {(result.system_unreliability * 100).toFixed(3)}%
            </p>
          </div>

          <div className="mb-4">
            <p className="text-xs font-medium text-gray-600 mb-1">Components</p>
            <div className="flex flex-col gap-1">
              {result.components.map(c => (
                <div key={c.id} className="flex justify-between text-xs">
                  <span className="text-gray-700">{c.label}</span>
                  <span className="text-gray-500">{c.reliability}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-600 mb-1">Minimal Path Sets</p>
            <div className="flex flex-col gap-1">
              {result.path_sets.map((path, i) => (
                <div key={i} className="text-xs bg-gray-50 rounded px-2 py-1 text-gray-700">
                  {path.join(' → ')}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
