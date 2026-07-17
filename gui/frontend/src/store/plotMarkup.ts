import { escapeHtmlText, htmlToPlainText } from '../components/shared/htmlSafety'

export type PlotCoordinate = number | string

export interface UserPlotAnnotation {
  id: string
  text: string
  x: PlotCoordinate
  y: PlotCoordinate
  xref: string
  yref: string
  ax?: number
  ay?: number
  showArrow: boolean
  color: string
  fontSize: number
}

export interface UserPlotShape {
  id: string
  type: 'line' | 'rect' | 'circle' | 'path'
  xref: string
  yref: string
  x0?: PlotCoordinate
  x1?: PlotCoordinate
  y0?: PlotCoordinate
  y1?: PlotCoordinate
  path?: string
  color: string
  fillColor: string
  width: number
  opacity: number
}

export interface PlotMarkup {
  annotations: UserPlotAnnotation[]
  shapes: UserPlotShape[]
}

export const EMPTY_PLOT_MARKUP: PlotMarkup = Object.freeze({
  annotations: Object.freeze([]) as unknown as UserPlotAnnotation[],
  shapes: Object.freeze([]) as unknown as UserPlotShape[],
})

let markupSeq = 0
export const newPlotMarkupId = (prefix: 'note' | 'shape') =>
  `${prefix}-${Date.now().toString(36)}-${(markupSeq++).toString(36)}`

const coordinate = (value: unknown): PlotCoordinate | undefined =>
  typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof value === 'string' && value.length <= 200 ? value : undefined

const safeColor = (value: unknown, fallback: string) =>
  typeof value === 'string' && value.length <= 80 ? value : fallback

/** Accept only the serializable Plotly subset Perdura's markup tools create. */
export function sanitizePlotMarkup(value: unknown): PlotMarkup {
  if (!value || typeof value !== 'object') return EMPTY_PLOT_MARKUP
  const source = value as { annotations?: unknown; shapes?: unknown }
  const annotations: UserPlotAnnotation[] = []
  if (Array.isArray(source.annotations)) {
    for (const raw of source.annotations.slice(0, 200)) {
      if (!raw || typeof raw !== 'object') continue
      const item = raw as Record<string, unknown>
      const x = coordinate(item.x)
      const y = coordinate(item.y)
      if (x == null || y == null) continue
      annotations.push({
        id: typeof item.id === 'string' ? item.id.slice(0, 100) : newPlotMarkupId('note'),
        text: typeof item.text === 'string' ? item.text.slice(0, 2000) : '',
        x,
        y,
        xref: typeof item.xref === 'string' ? item.xref.slice(0, 20) : 'x',
        yref: typeof item.yref === 'string' ? item.yref.slice(0, 20) : 'y',
        ax: typeof item.ax === 'number' && Number.isFinite(item.ax) ? item.ax : 32,
        ay: typeof item.ay === 'number' && Number.isFinite(item.ay) ? item.ay : -32,
        showArrow: item.showArrow !== false,
        color: safeColor(item.color, '#1e3a8a'),
        fontSize: typeof item.fontSize === 'number'
          ? Math.max(8, Math.min(32, item.fontSize)) : 12,
      })
    }
  }
  const shapes: UserPlotShape[] = []
  if (Array.isArray(source.shapes)) {
    for (const raw of source.shapes.slice(0, 200)) {
      if (!raw || typeof raw !== 'object') continue
      const item = raw as Record<string, unknown>
      const type = item.type
      if (!['line', 'rect', 'circle', 'path'].includes(String(type))) continue
      const x0 = coordinate(item.x0)
      const x1 = coordinate(item.x1)
      const y0 = coordinate(item.y0)
      const y1 = coordinate(item.y1)
      const path = typeof item.path === 'string' ? item.path.slice(0, 10000) : undefined
      if (type === 'path' ? !path : [x0, x1, y0, y1].some(v => v == null)) continue
      shapes.push({
        id: typeof item.id === 'string' ? item.id.slice(0, 100) : newPlotMarkupId('shape'),
        type: type as UserPlotShape['type'],
        xref: typeof item.xref === 'string' ? item.xref.slice(0, 20) : 'x',
        yref: typeof item.yref === 'string' ? item.yref.slice(0, 20) : 'y',
        x0, x1, y0, y1, path,
        color: safeColor(item.color, '#2563eb'),
        fillColor: safeColor(item.fillColor, 'rgba(37,99,235,0.12)'),
        width: typeof item.width === 'number' ? Math.max(1, Math.min(8, item.width)) : 2,
        opacity: typeof item.opacity === 'number' ? Math.max(0.05, Math.min(1, item.opacity)) : 1,
      })
    }
  }
  return { annotations, shapes }
}

export function annotationToLayout(item: UserPlotAnnotation): Record<string, unknown> {
  return {
    x: item.x, y: item.y, xref: item.xref, yref: item.yref,
    text: escapeHtmlText(item.text).replace(/\r?\n/g, '<br>'),
    showarrow: item.showArrow,
    ax: item.ax ?? 32, ay: item.ay ?? -32,
    arrowcolor: item.color, arrowwidth: 1.5, arrowsize: 1,
    font: { color: item.color, size: item.fontSize },
    bgcolor: 'rgba(255,255,255,0.92)',
    bordercolor: item.color, borderwidth: 1, borderpad: 4,
    align: 'left', captureevents: true,
    templateitemname: `perdura-user-${item.id}`,
  }
}

export function shapeToLayout(item: UserPlotShape): Record<string, unknown> {
  return {
    type: item.type, xref: item.xref, yref: item.yref,
    x0: item.x0, x1: item.x1, y0: item.y0, y1: item.y1, path: item.path,
    line: { color: item.color, width: item.width },
    fillcolor: item.fillColor, opacity: item.opacity,
    layer: 'above', editable: true,
    name: `perdura-user-${item.id}`,
  }
}

export function mergePlotMarkup(
  layout: Partial<Plotly.Layout> | undefined,
  markup: PlotMarkup,
): Partial<Plotly.Layout> {
  return {
    ...(layout ?? {}),
    annotations: [
      ...((layout?.annotations ?? []) as Plotly.Annotations[]),
      ...markup.annotations.map(annotationToLayout),
    ] as Plotly.Annotations[],
    shapes: [
      ...((layout?.shapes ?? []) as Plotly.Shape[]),
      ...markup.shapes.map(shapeToLayout),
    ] as Plotly.Shape[],
  }
}

export function markupFromLiveLayout(
  markup: PlotMarkup,
  annotations: unknown[],
  shapes: unknown[],
  baseAnnotationCount: number,
  baseShapeCount: number,
): PlotMarkup {
  const taggedAnnotations = new Map<string, Record<string, unknown>>()
  for (const raw of annotations) {
    const live = (raw ?? {}) as Record<string, unknown>
    const tag = typeof live.templateitemname === 'string' ? live.templateitemname : ''
    if (tag.startsWith('perdura-user-')) {
      taggedAnnotations.set(tag.slice('perdura-user-'.length), live)
    }
  }
  const nextAnnotations = markup.annotations.map((item, index) => {
    const live = taggedAnnotations.get(item.id)
      ?? annotations[baseAnnotationCount + index] as Record<string, unknown> | undefined
    if (!live) return item
    return sanitizePlotMarkup({ annotations: [{
      ...item,
      x: live.x ?? item.x,
      y: live.y ?? item.y,
      ax: live.ax ?? item.ax,
      ay: live.ay ?? item.ay,
    }] }).annotations[0] ?? item
  })

  const taggedShapes = new Map<string, Record<string, unknown>>()
  for (const raw of shapes) {
    const live = (raw ?? {}) as Record<string, unknown>
    const tag = typeof live.name === 'string' ? live.name : ''
    if (tag.startsWith('perdura-user-')) {
      taggedShapes.set(tag.slice('perdura-user-'.length), live)
    }
  }
  const shapeFromLive = (
    raw: unknown,
    id: string,
    old?: UserPlotShape,
  ): UserPlotShape | undefined => {
    const live = (raw ?? {}) as Record<string, unknown>
    const line = (live.line ?? {}) as Record<string, unknown>
    return sanitizePlotMarkup({ shapes: [{
      id,
      type: live.type,
      xref: live.xref,
      yref: live.yref,
      x0: live.x0, x1: live.x1, y0: live.y0, y1: live.y1,
      path: live.path,
      color: line.color ?? old?.color,
      fillColor: live.fillcolor ?? old?.fillColor,
      width: line.width ?? old?.width,
      opacity: live.opacity ?? old?.opacity,
    }] }).shapes[0]
  }
  const nextShapes: UserPlotShape[] = []
  const hasTaggedShapes = taggedShapes.size > 0
  for (let index = 0; index < markup.shapes.length; index++) {
    const old = markup.shapes[index]
    // Once tagged shapes are present, absence means Plotly's erase tool
    // removed that user shape. The positional fallback supports old layouts
    // created before Perdura tagged its markup.
    const live = taggedShapes.get(old.id)
      ?? (!hasTaggedShapes ? shapes[baseShapeCount + index] : undefined)
    if (!live) continue
    const clean = shapeFromLive(live, old.id, old)
    if (clean) nextShapes.push(clean)
  }
  // Native draw tools append an untagged shape. It gains a stable Perdura ID
  // on this first sync and will be matched by tag on subsequent edits.
  shapes.forEach((raw, index) => {
    const live = (raw ?? {}) as Record<string, unknown>
    const tag = typeof live.name === 'string' ? live.name : ''
    const legacyEnd = baseShapeCount + (hasTaggedShapes ? 0 : markup.shapes.length)
    if (tag.startsWith('perdura-user-') || index < legacyEnd) return
    const clean = shapeFromLive(live, newPlotMarkupId('shape'))
    if (clean) nextShapes.push(clean)
  })
  return { annotations: nextAnnotations, shapes: nextShapes }
}

export const plotMarkupEqual = (a: PlotMarkup, b: PlotMarkup) =>
  JSON.stringify(a) === JSON.stringify(b)

/** Separate previously merged Perdura markup from an asset's analytical layout. */
export function splitUserMarkupFromLayout(layout: unknown): {
  layout: Record<string, unknown>
  markup: PlotMarkup
} {
  const source = layout && typeof layout === 'object'
    ? layout as Record<string, unknown> : {}
  const annotations = Array.isArray(source.annotations) ? source.annotations : []
  const shapes = Array.isArray(source.shapes) ? source.shapes : []
  const userAnnotations: UserPlotAnnotation[] = []
  const baseAnnotations: unknown[] = []
  for (const raw of annotations) {
    const item = (raw ?? {}) as Record<string, unknown>
    const tag = typeof item.templateitemname === 'string' ? item.templateitemname : ''
    if (!tag.startsWith('perdura-user-')) { baseAnnotations.push(raw); continue }
    const font = (item.font ?? {}) as Record<string, unknown>
    const clean = sanitizePlotMarkup({ annotations: [{
      id: tag.slice('perdura-user-'.length),
      text: htmlToPlainText(String(item.text ?? '').replace(/<br\s*\/?>/gi, '\n')),
      x: item.x, y: item.y, xref: item.xref, yref: item.yref,
      ax: item.ax, ay: item.ay, showArrow: item.showarrow,
      color: font.color ?? item.arrowcolor, fontSize: font.size,
    }] }).annotations[0]
    if (clean) userAnnotations.push(clean)
  }
  const userShapes: UserPlotShape[] = []
  const baseShapes: unknown[] = []
  for (const raw of shapes) {
    const item = (raw ?? {}) as Record<string, unknown>
    const tag = typeof item.name === 'string' ? item.name : ''
    if (!tag.startsWith('perdura-user-')) { baseShapes.push(raw); continue }
    const line = (item.line ?? {}) as Record<string, unknown>
    const clean = sanitizePlotMarkup({ shapes: [{
      id: tag.slice('perdura-user-'.length),
      type: item.type, xref: item.xref, yref: item.yref,
      x0: item.x0, x1: item.x1, y0: item.y0, y1: item.y1, path: item.path,
      color: line.color, fillColor: item.fillcolor, width: line.width, opacity: item.opacity,
    }] }).shapes[0]
    if (clean) userShapes.push(clean)
  }
  return {
    layout: { ...source, annotations: baseAnnotations, shapes: baseShapes },
    markup: { annotations: userAnnotations, shapes: userShapes },
  }
}
