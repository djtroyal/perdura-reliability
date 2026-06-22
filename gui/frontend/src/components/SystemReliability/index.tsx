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
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Plus, Play, Trash2, LayoutGrid } from 'lucide-react'
import { computeRBD, RBDResponse } from '../../api/client'
import { CanvasErrorBoundary, sanitizeNodeChanges, sanitizeNodes } from '../shared/CanvasErrorBoundary'
import { useFolioState, useRevision } from '../../store/project'
import FolioBar from '../shared/FolioBar'
import LibraryPanel, { LibraryItem } from '../shared/LibraryPanel'
import { computeCDF, DIST_OPTIONS, DIST_PARAMS } from '../FaultTree'
import { useLdaFolios } from '../shared/ldaFolios'
import ExportDiagramButton from '../shared/ExportDiagramButton'
import ExportResultsButton from '../shared/ExportResultsButton'

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
      {data.ldaSourceName != null && (
        <div className="text-[10px] text-blue-500 mt-0.5 truncate" title={String(data.ldaSourceName)}>
          {String(data.ldaSourceName)}
        </div>
      )}
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
  const [persisted, setPersisted, folios] = useFolioState<CanvasState>('system', INITIAL_CANVAS)
  const revision = useRevision()
  const ldaFolios = useLdaFolios()
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(sanitizeNodes(persisted.nodes ?? []))
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(persisted.edges)
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [result, setResult] = useState<RBDResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Persist canvas to the project store, debounced. Writing on every drag-move
  // event triggered a store emit (and a full re-render of every subscriber) on
  // each pixel of movement; under rapid dragging this re-render storm could
  // corrupt the canvas and blank the page. Debouncing coalesces a drag into a
  // single write once motion settles, with a flush on unmount so nothing is lost.
  const latest = useRef({ nodes, edges })
  latest.current = { nodes, edges }
  const persistTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const flowWrapperRef = useRef<HTMLDivElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current)
    persistTimer.current = setTimeout(() => setPersisted(latest.current), 250)
  }, [nodes, edges]) // eslint-disable-line react-hooks/exhaustive-deps
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
      setEdges(persisted.edges ?? [])
      setSelectedNode(null)
      setResult(null)
    }
  }, [revision, folios.activeId]) // eslint-disable-line react-hooks/exhaustive-deps

  const onConnect = useCallback(
    (connection: Connection) => setEdges(eds => addEdge({ ...connection, animated: true }, eds)),
    [setEdges]
  )

  const onNodesChangeWrapped = useCallback(
    (changes: NodeChange[]) => onNodesChange(sanitizeNodeChanges(changes)),
    [onNodesChange],
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

  const autoLayout = () => {
    // Build adjacency from edges
    const adj = new Map<string, string[]>()
    edges.forEach(e => {
      adj.set(e.source, [...(adj.get(e.source) ?? []), e.target])
    })

    // BFS from source to assign layers (longest path)
    const layers = new Map<string, number>()
    const queue = ['source']
    layers.set('source', 0)
    while (queue.length > 0) {
      const cur = queue.shift()!
      for (const next of (adj.get(cur) ?? [])) {
        const newLayer = layers.get(cur)! + 1
        if (!layers.has(next) || layers.get(next)! < newLayer) {
          layers.set(next, newLayer)
          queue.push(next)
        }
      }
    }

    // Force sink to the rightmost layer
    const maxLayer = Math.max(...layers.values(), 1)
    layers.set('sink', maxLayer)

    // Assign layer 0 to any unvisited nodes
    nodes.forEach(n => { if (!layers.has(n.id)) layers.set(n.id, 0) })

    // Group nodes by layer
    const byLayer = new Map<number, string[]>()
    layers.forEach((layer, id) => {
      byLayer.set(layer, [...(byLayer.get(layer) ?? []), id])
    })

    const xGap = 200, yGap = 120, startX = 50, startY = 50
    setNodes(nds => nds.map(n => {
      const layer = layers.get(n.id) ?? 0
      const nodesInLayer = byLayer.get(layer) ?? [n.id]
      const idx = nodesInLayer.indexOf(n.id)
      return {
        ...n,
        position: {
          x: startX + layer * xGap,
          y: startY + idx * yGap,
        },
      }
    }))
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

  const updateSelectedDataMulti = (updates: Record<string, unknown>) => {
    if (!selectedNode) return
    setNodes(nds => nds.map(n =>
      n.id === selectedNode.id ? { ...n, data: { ...n.data, ...updates } } : n
    ))
    setSelectedNode(prev => prev ? { ...prev, data: { ...prev.data, ...updates } } : null)
  }

  const updateSelectedData = (key: string, value: unknown) => {
    updateSelectedDataMulti({ [key]: value })
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
    <div className="flex flex-col h-full">
      <FolioBar api={folios} />
      <div className="flex flex-1 overflow-hidden">
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
          onClick={autoLayout}
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
        >
          <LayoutGrid size={14} /> Auto Layout
        </button>

        <ExportDiagramButton getElement={() => flowWrapperRef.current} baseName="rbd" />

        <button
          onClick={deleteSelected}
          disabled={!selectedNode || selectedNode.type === 'source' || selectedNode.type === 'sink'}
          className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 border border-red-200 rounded hover:bg-red-50 disabled:opacity-40 transition-colors"
        >
          <Trash2 size={14} /> Delete Selected
        </button>

        {selectedNode && selectedNode.type === 'component' && (() => {
          const dist = String(selectedNode.data.distribution ?? '')
          const distParams = (selectedNode.data.dist_params ?? {}) as Record<string, number>
          const missionTime = Number(selectedNode.data.mission_time ?? 1000)
          const computedR = dist ? 1 - computeCDF(dist, distParams, missionTime) : null
          return (
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
                <label className="text-xs text-gray-500 mb-0.5 block">Reliability source</label>
                <select
                  value={String(selectedNode.data.ldaSource ?? '')}
                  disabled={ldaFolios.length === 0}
                  onChange={e => {
                    const srcId = e.target.value
                    if (!srcId) {
                      updateSelectedDataMulti({ ldaSource: undefined, ldaSourceName: undefined })
                    } else {
                      const src = ldaFolios.find(f => f.id === srcId)
                      if (src) {
                        updateSelectedDataMulti({
                          distribution: src.dist,
                          dist_params: src.dist_params,
                          ldaSource: src.id,
                          ldaSourceName: src.name,
                          mission_time: missionTime,
                        })
                      }
                    }
                  }}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50 disabled:text-gray-400"
                >
                  <option value="">Manual / distribution</option>
                  {ldaFolios.map(src => (
                    <option key={src.id} value={src.id}>{src.name} — {src.label}</option>
                  ))}
                </select>
                {ldaFolios.length === 0 && (
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    Fit a distribution in Life Data Analysis to link a folio here.
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-0.5 block flex items-center gap-1"
                  title="Choose 'Manual' to type a reliability directly, or pick a life distribution and enter its parameters + a mission time — the component reliability is then R(t) = 1 − CDF(t).">
                  Reliability model
                </label>
                <select
                  value={dist}
                  onChange={e => {
                    const d = e.target.value
                    if (d && DIST_PARAMS[d]) {
                      const defaults: Record<string, number> = {}
                      DIST_PARAMS[d].forEach(p => { defaults[p.key] = p.default })
                      const r = 1 - computeCDF(d, defaults, missionTime)
                      updateSelectedDataMulti({ distribution: d, dist_params: defaults, reliability: Math.max(0, Math.min(1, r)) })
                    } else {
                      updateSelectedDataMulti({ distribution: undefined, dist_params: undefined })
                    }
                  }}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                >
                  {DIST_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>
                      {o.value ? o.label : 'Manual (direct reliability)'}
                    </option>
                  ))}
                </select>
              </div>
              {dist && DIST_PARAMS[dist] ? (
                <>
                  {DIST_PARAMS[dist].map(p => (
                    <div key={p.key}>
                      <label className="text-xs text-gray-500 mb-0.5 block">{p.label}</label>
                      <input
                        type="number" step="any"
                        value={distParams[p.key] ?? p.default}
                        onChange={e => {
                          const newParams = { ...distParams, [p.key]: parseFloat(e.target.value) || 0 }
                          const r = 1 - computeCDF(dist, newParams, missionTime)
                          updateSelectedDataMulti({ dist_params: newParams, reliability: Math.max(0, Math.min(1, r)) })
                        }}
                        className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </div>
                  ))}
                  <div>
                    <label className="text-xs text-gray-500 mb-0.5 block"
                      title="The operating time at which to evaluate this component's reliability R(t) from its distribution.">
                      Mission time
                    </label>
                    <input
                      type="number" step="any" min="0"
                      value={missionTime}
                      onChange={e => {
                        const t = parseFloat(e.target.value) || 0
                        const r = 1 - computeCDF(dist, distParams, t)
                        updateSelectedDataMulti({ mission_time: t, reliability: Math.max(0, Math.min(1, r)) })
                      }}
                      className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                  </div>
                  <div className="bg-blue-50 rounded px-2 py-1.5">
                    <span className="text-[10px] text-gray-500">Computed reliability: </span>
                    <span className="text-xs font-mono font-semibold text-blue-700">
                      {computedR != null ? computedR.toFixed(6) : '—'}
                    </span>
                  </div>
                </>
              ) : (
                <div>
                  <label className="text-xs text-gray-500 mb-0.5 block"
                    title="Probability (0–1) that this component survives the mission. Used directly in the series/parallel/k-of-n network reliability computation.">
                    Reliability (0–1)
                  </label>
                  <input
                    type="number" min="0" max="1" step="0.01"
                    value={String(selectedNode.data.reliability ?? 0.9)}
                    onChange={e => updateSelectedReliability(e.target.value)}
                    className="w-full text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>
              )}
              {selectedNode.data.linkedTo != null && (
                <p className="text-[10px] text-gray-400">
                  Linked to library: {String(selectedNode.data.linkedTo)}
                </p>
              )}
            </div>
          )
        })()}

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
      <CanvasErrorBoundary onReset={autoLayout}>
        <div ref={flowWrapperRef} className="flex-1 relative">
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
            <MiniMap nodeColor={n => n.type === 'component' ? '#3b82f6' : '#374151'} />
          </ReactFlow>
        </div>
      </CanvasErrorBoundary>

      {/* Results panel */}
      {result && (
        <div ref={resultsRef} className="w-64 flex-shrink-0 bg-white border-l border-gray-200 p-4 overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Results</p>
            <ExportResultsButton getElement={() => resultsRef.current} baseName="system-reliability" />
          </div>

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

          <div className="mb-4">
            <p className="text-xs font-medium text-gray-600 mb-1">Minimal Path Sets</p>
            <div className="flex flex-col gap-1">
              {result.path_sets.map((path, i) => (
                <div key={i} className="text-xs bg-gray-50 rounded px-2 py-1 text-gray-700">
                  {path.join(' → ')}
                </div>
              ))}
            </div>
          </div>

          {result.importance && result.importance.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-600 mb-1">Importance Measures</p>
              <div className="overflow-x-auto">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="border-b border-gray-200 text-gray-500">
                      <th className="py-1 text-left font-medium">Component</th>
                      <th className="py-1 text-right font-medium">Birnbaum</th>
                      <th className="py-1 text-right font-medium">Crit.</th>
                      <th className="py-1 text-right font-medium">RAW</th>
                      <th className="py-1 text-right font-medium">RRW</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {result.importance.map(im => (
                      <tr key={im.id} className="border-b border-gray-100">
                        <td className="py-1 text-gray-700 font-sans">{im.label}</td>
                        <td className="py-1 text-right">{im.Birnbaum.toFixed(4)}</td>
                        <td className="py-1 text-right">{im.Criticality.toFixed(4)}</td>
                        <td className="py-1 text-right">{im.RAW != null ? im.RAW.toFixed(2) : '—'}</td>
                        <td className="py-1 text-right">{im.RRW != null ? im.RRW.toFixed(2) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  )
}
