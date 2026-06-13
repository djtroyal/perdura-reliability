import React from 'react'
import type { Node, NodeChange } from '@xyflow/react'

/**
 * Error boundary wrapping ReactFlow canvases.
 * Catches rendering crashes (usually from extreme/NaN node positions)
 * and shows a recovery UI instead of blanking the screen.
 */
export class CanvasErrorBoundary extends React.Component<
  { children: React.ReactNode; onReset: () => void },
  { hasError: boolean }
> {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-center">
            <p className="text-sm font-medium text-gray-700">Canvas rendering error</p>
            <p className="text-xs text-gray-500 mt-1">A node may have been moved to an invalid position.</p>
            <button
              onClick={() => { this.setState({ hasError: false }); this.props.onReset() }}
              className="mt-3 px-4 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Reset Layout
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

const POS_MIN = -5000
const POS_MAX = 10000

function clampNum(v: number | undefined): number {
  if (v == null || !isFinite(v)) return 0
  return Math.max(POS_MIN, Math.min(POS_MAX, v))
}

/**
 * Sanitize node position changes before passing them to ReactFlow's
 * onNodesChange. Clamps positions to [POS_MIN, POS_MAX] and replaces
 * NaN/undefined/Infinity with 0 — the main crash vector.
 */
/**
 * Sanitize persisted node positions on load — ensures no NaN/Infinity
 * values survive a localStorage round-trip.
 */
export function sanitizeNodes(nodes: Node[]): Node[] {
  return nodes.map(n => ({
    ...n,
    position: { x: clampNum(n.position?.x), y: clampNum(n.position?.y) },
  }))
}

export function sanitizeNodeChanges(changes: NodeChange[]): NodeChange[] {
  return changes.map(c => {
    if (c.type === 'position') {
      const pos = (c as { position?: { x: number; y: number } }).position
      if (pos) {
        return { ...c, position: { x: clampNum(pos.x), y: clampNum(pos.y) } }
      }
    }
    return c
  })
}
