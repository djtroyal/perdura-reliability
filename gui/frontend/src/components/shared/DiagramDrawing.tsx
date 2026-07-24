import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { NodeResizer, type NodeProps, type XYPosition } from '@xyflow/react'

export type DiagramPoint = { x: number; y: number }
export type DiagramPalette = { accent: string; fill: string; text: string }
export type PencilMode = 'freehand' | 'smooth'

export const VECTOR_SHAPES = [
  { value: 'rectangle', label: 'Rectangle' },
  { value: 'rounded', label: 'Rounded rectangle' },
  { value: 'ellipse', label: 'Ellipse' },
  { value: 'diamond', label: 'Diamond' },
] as const
export type VectorShape = typeof VECTOR_SHAPES[number]['value']

/** Apply opacity to a six-digit palette fill without fading its border/text. */
export function annotationFillColor(fill: string, opacityPercent: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(fill)
  if (!match) return fill
  const value = match[1]
  const red = Number.parseInt(value.slice(0, 2), 16)
  const green = Number.parseInt(value.slice(2, 4), 16)
  const blue = Number.parseInt(value.slice(4, 6), 16)
  const opacity = Math.max(0, Math.min(1, opacityPercent / 100))
  return `rgba(${red}, ${green}, ${blue}, ${opacity})`
}

function finitePoints(value: unknown): DiagramPoint[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(point => {
    if (!point || typeof point !== 'object') return []
    const x = Number((point as { x?: unknown }).x)
    const y = Number((point as { y?: unknown }).y)
    return Number.isFinite(x) && Number.isFinite(y) ? [{ x, y }] : []
  })
}

/** SVG path for raw or normalized pencil points. */
export function freehandPath(value: unknown, smooth = true): string {
  const points = finitePoints(value)
  if (!points.length) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y} l 0.01 0`
  if (!smooth || points.length < 3) {
    return points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')
  }
  // A low-tension Catmull-Rom conversion rounds only the joins and still
  // passes through every captured point. Midpoint quadratic smoothing moved
  // the stroke away from the user's gesture and visibly over-corrected it.
  const tension = 0.08
  let path = `M ${points[0].x} ${points[0].y}`
  for (let index = 0; index < points.length - 1; index += 1) {
    const before = points[Math.max(0, index - 1)]
    const point = points[index]
    const next = points[index + 1]
    const after = points[Math.min(points.length - 1, index + 2)]
    const control1 = {
      x: point.x + (next.x - before.x) * tension,
      y: point.y + (next.y - before.y) * tension,
    }
    const control2 = {
      x: next.x - (after.x - point.x) * tension,
      y: next.y - (after.y - point.y) * tension,
    }
    path += ` C ${control1.x} ${control1.y} ${control2.x} ${control2.y} ${next.x} ${next.y}`
  }
  return path
}

/** Convert flow-space gesture points into a portable, resizable annotation. */
export function normalizeFreehandGesture(value: DiagramPoint[], padding = 7): {
  position: XYPosition
  width: number
  height: number
  points: DiagramPoint[]
} {
  const source = finitePoints(value)
  const points = source.length > 1 ? source : [
    source[0] ?? { x: 0, y: 0 },
    { x: (source[0]?.x ?? 0) + 0.5, y: (source[0]?.y ?? 0) + 0.5 },
  ]
  const minX = Math.min(...points.map(point => point.x))
  const maxX = Math.max(...points.map(point => point.x))
  const minY = Math.min(...points.map(point => point.y))
  const maxY = Math.max(...points.map(point => point.y))
  const width = Math.max(28, maxX - minX + padding * 2)
  const height = Math.max(28, maxY - minY + padding * 2)
  const position = { x: minX - padding, y: minY - padding }
  return {
    position,
    width,
    height,
    points: points.map(point => ({
      x: 100 * (point.x - position.x) / width,
      y: 100 * (point.y - position.y) / height,
    })),
  }
}

function ShapeGraphic({ shape, palette, opacity }: {
  shape: string
  palette: DiagramPalette
  opacity: number
}) {
  const common = {
    fill: palette.fill,
    fillOpacity: opacity,
    stroke: palette.accent,
    strokeWidth: 2,
    vectorEffect: 'non-scaling-stroke' as const,
  }
  if (shape === 'ellipse') return <ellipse cx="50" cy="50" rx="47" ry="47" {...common} />
  if (shape === 'diamond') return <polygon points="50,2 98,50 50,98 2,50" {...common} />
  return <rect x="2" y="2" width="96" height="96" rx={shape === 'rounded' ? 12 : 0} {...common} />
}

/** Compact visual selector used anywhere a diagram shape is chosen. */
export function ShapeAnnotationPalette({
  selected,
  onSelect,
  label = 'Shape',
}: {
  selected?: string
  onSelect: (shape: VectorShape) => void
  label?: string
}) {
  return (
    <div role="group" aria-label={label}>
      <div className="grid grid-cols-4 gap-1">
        {VECTOR_SHAPES.map(option => {
          const active = selected === option.value
          return (
            <button key={option.value} type="button"
              onClick={() => onSelect(option.value)}
              aria-label={option.label}
              aria-pressed={active}
              title={option.label}
              className={`flex h-9 items-center justify-center rounded border transition ${
                active
                  ? 'border-blue-400 bg-blue-50 text-blue-700 ring-1 ring-blue-200'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:bg-blue-50'
              }`}>
              <svg viewBox="0 0 40 28" className="h-6 w-8" aria-hidden>
                {option.value === 'ellipse' ? (
                  <ellipse cx="20" cy="14" rx="15" ry="10" fill="none" stroke="currentColor" strokeWidth="2" />
                ) : option.value === 'diamond' ? (
                  <polygon points="20,3 36,14 20,25 4,14" fill="none" stroke="currentColor" strokeWidth="2" />
                ) : (
                  <rect x="4" y="4" width="32" height="20" rx={option.value === 'rounded' ? 6 : 0}
                    fill="none" stroke="currentColor" strokeWidth="2" />
                )}
              </svg>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Shape/freehand content shared by all System Modeling canvases. */
export function VectorAnnotationNode({
  data,
  selected,
  width,
  height,
  palette,
  dataAttribute,
}: Pick<NodeProps, 'data' | 'selected' | 'width' | 'height'> & {
  palette: DiagramPalette
  dataAttribute: string
}) {
  const kind = String(data.annotationKind ?? 'shape')
  const actualWidth = Number(width) > 0 ? Number(width) : kind === 'freehand' ? 160 : 150
  const actualHeight = Number(height) > 0 ? Number(height) : kind === 'freehand' ? 100 : 100
  const opacity = Math.max(0, Math.min(1, Number(data.fillOpacity ?? data.opacity ?? 70) / 100))
  const attributes = { [dataAttribute]: true }
  return (
    <>
      <NodeResizer isVisible={selected} minWidth={28} minHeight={28}
        color={palette.accent} handleStyle={{ width: 8, height: 8 }} />
      <div {...attributes}
        className={`relative ${selected ? 'rounded ring-2 ring-blue-300 ring-offset-1' : ''}`}
        style={{ width: actualWidth, height: actualHeight }}
        title={kind === 'freehand' ? 'Pencil annotation' : `${String(data.shape ?? 'rectangle')} shape`}>
        <svg className="h-full w-full overflow-visible" viewBox="0 0 100 100"
          preserveAspectRatio="none" aria-hidden>
          {kind === 'freehand' ? (
            <path d={freehandPath(data.points, data.smooth !== false)}
              fill="none" stroke={palette.accent} strokeOpacity={opacity}
              strokeWidth={Math.max(1, Number(data.strokeWidth ?? 3))}
              strokeLinecap="round" strokeLinejoin={data.smooth === false ? 'miter' : 'round'}
              vectorEffect="non-scaling-stroke" />
          ) : (
            <ShapeGraphic shape={String(data.shape ?? 'rectangle')} palette={palette} opacity={opacity} />
          )}
        </svg>
      </div>
    </>
  )
}

export function PencilCanvasOverlay({
  mode,
  color,
  toFlowPosition,
  onComplete,
  onCancel,
}: {
  mode: PencilMode
  color: string
  toFlowPosition: (point: DiagramPoint) => DiagramPoint
  onComplete: (points: DiagramPoint[], mode: PencilMode) => void
  onCancel: () => void
}) {
  const [screenPoints, setScreenPoints] = useState<DiagramPoint[]>([])
  const flowPoints = useRef<DiagramPoint[]>([])
  const pointerId = useRef<number | null>(null)

  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [onCancel])

  const localPoint = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
  }
  const appendPoint = (event: ReactPointerEvent<HTMLDivElement>) => {
    const local = localPoint(event)
    const prior = screenPoints[screenPoints.length - 1]
    if (prior && Math.hypot(local.x - prior.x, local.y - prior.y) < 1.5) return
    setScreenPoints(current => [...current, local])
    flowPoints.current.push(toFlowPosition({ x: event.clientX, y: event.clientY }))
  }
  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerId.current !== event.pointerId) return
    appendPoint(event)
    event.currentTarget.releasePointerCapture(event.pointerId)
    pointerId.current = null
    const completed = [...flowPoints.current, toFlowPosition({ x: event.clientX, y: event.clientY })]
    setScreenPoints([])
    flowPoints.current = []
    onComplete(completed, mode)
  }

  return (
    <div className="absolute inset-0 z-[5] cursor-crosshair touch-none"
      data-diagram-pencil-overlay
      onPointerDown={event => {
        if (event.button !== 0) return
        pointerId.current = event.pointerId
        event.currentTarget.setPointerCapture(event.pointerId)
        const local = localPoint(event)
        setScreenPoints([local])
        flowPoints.current = [toFlowPosition({ x: event.clientX, y: event.clientY })]
      }}
      onPointerMove={event => {
        if (pointerId.current === event.pointerId) appendPoint(event)
      }}
      onPointerUp={finish}
      onPointerCancel={() => {
        pointerId.current = null
        setScreenPoints([])
        flowPoints.current = []
      }}>
      <div className="pointer-events-none absolute left-1/2 top-14 -translate-x-1/2 rounded-full border border-slate-300 bg-white/95 px-3 py-1 text-[10px] font-medium text-slate-600 shadow-sm">
        Draw on the canvas · Esc cancels
      </div>
      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
        <path d={freehandPath(screenPoints, mode === 'smooth')} fill="none" stroke={color}
          strokeWidth="3" strokeLinecap="round"
          strokeLinejoin={mode === 'smooth' ? 'round' : 'miter'} />
      </svg>
    </div>
  )
}
