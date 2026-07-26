import React from 'react'
import type { Node, NodeChange } from '@xyflow/react'

/**
 * Error boundary wrapping ReactFlow canvases.
 * Catches rendering crashes (usually from extreme/NaN node positions)
 * and shows a recovery UI instead of blanking the screen.
 */
export class CanvasErrorBoundary extends React.Component<
  { children: React.ReactNode; onReset: () => void; resetKey?: string | number },
  { hasError: boolean; detail: string }
> {
  state = { hasError: false, detail: '' }
  static getDerivedStateFromError(error: unknown) {
    return {
      hasError: true,
      detail: error instanceof Error ? error.message : 'Unknown canvas rendering failure',
    }
  }
  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    // Preserve the actual exception in diagnostics. The prior blanket
    // “invalid position” message hid unrelated renderer and node-data faults.
    console.error('Perdura canvas rendering failure', error, info.componentStack)
  }
  componentDidUpdate(previous: Readonly<{ resetKey?: string | number }>) {
    if (this.state.hasError && previous.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, detail: '' })
    }
  }
  private repair = () => {
    this.props.onReset()
    // Let the parent's repaired node state land before remounting React Flow;
    // clearing the boundary first can immediately throw on the same bad frame.
    requestAnimationFrame(() => this.setState({ hasError: false, detail: '' }))
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="max-w-md text-center">
            <p className="text-sm font-medium text-gray-700">Canvas rendering error</p>
            <p className="mt-1 text-xs text-gray-500">
              The diagram could not be rendered. Repair its saved geometry and refit the layout.
            </p>
            {this.state.detail && (
              <details className="mt-2 rounded border border-gray-200 bg-white px-2 py-1 text-left">
                <summary className="cursor-pointer text-[10px] font-medium text-gray-600">
                  Technical detail
                </summary>
                <code className="mt-1 block break-words text-[9px] text-gray-500">
                  {this.state.detail}
                </code>
              </details>
            )}
            <button
              onClick={this.repair}
              className="mt-3 px-4 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Repair and fit layout
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

function clampNum(v: unknown): number {
  const numeric = Number(v)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(POS_MIN, Math.min(POS_MAX, numeric))
}

function positiveGeometry(v: unknown): number | undefined {
  const numeric = Number(v)
  return Number.isFinite(numeric) && numeric > 0 && numeric <= POS_MAX
    ? numeric : undefined
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
export function sanitizeNodes(nodes: unknown): Node[] {
  if (!Array.isArray(nodes)) return []
  const ids = new Set<string>()
  const candidates = nodes.flatMap(value => {
    if (!value || typeof value !== 'object') return []
    const raw = value as Partial<Node> & {
      measured?: { width?: unknown; height?: unknown }
      width?: unknown
      height?: unknown
      parentId?: unknown
    }
    const id = String(raw.id ?? '').trim()
    if (!id || ids.has(id)) return []
    ids.add(id)
    const measuredWidth = positiveGeometry(raw.measured?.width)
    const measuredHeight = positiveGeometry(raw.measured?.height)
    const width = positiveGeometry(raw.width)
    const height = positiveGeometry(raw.height)
    return [{
      ...raw,
      id,
      data: raw.data && typeof raw.data === 'object' ? raw.data : {},
      position: {
        x: clampNum(raw.position?.x),
        y: clampNum(raw.position?.y),
      },
      ...(width == null ? { width: undefined } : { width }),
      ...(height == null ? { height: undefined } : { height }),
      ...(measuredWidth == null && measuredHeight == null
        ? { measured: undefined }
        : { measured: { width: measuredWidth, height: measuredHeight } }),
    } as Node]
  })
  // A stale self/missing parent reference can make React Flow's coordinate
  // resolver recurse or produce non-finite absolute positions.
  return candidates.map(node => {
    const parentId = String(node.parentId ?? '')
    return !parentId || parentId === node.id || !ids.has(parentId)
      ? { ...node, parentId: undefined }
      : node
  })
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
