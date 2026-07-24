import plotlyFactoryModule from 'react-plotly.js/factory'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { escapeHtmlText, htmlToPlainText, jsonForInlineScript } from './htmlSafety'
import {
  appendAxisProjectionMarkup,
  EMPTY_PLOT_MARKUP,
  markupFromLiveLayout,
  mergePlotMarkup,
  newPlotMarkupId,
  plotMarkupEqual,
  smoothedPlotPath,
  type PlotCoordinate,
  type PlotMarkup,
  type PlotPathPoint,
  type UserPlotAnnotation,
} from '../../store/plotMarkup'
import Plotly from './plotly'
import {
  resolvePlotlyFactory,
  stripUndefinedPlotLayoutValues,
} from './plotlyFactoryInterop'
import { buildPlotViewResetUpdates } from './plotViewReset'
import { downloadArtifact, downloadDataUrlArtifact } from '../../store/artifactExport'
import { toast } from './toast'

const createPlotlyComponent = resolvePlotlyFactory<typeof plotlyFactoryModule>(plotlyFactoryModule)
const InternalPlot = createPlotlyComponent(Plotly)
type PlotProps = React.ComponentProps<typeof InternalPlot>

interface ExportablePlotProps extends PlotProps {
  /** Base filename for exports; defaults to the plot title (sanitized). */
  exportName?: string
  /** Changing this value resets user zoom and editable legend placement. */
  interactionRevision?: unknown
  userMarkup?: PlotMarkup
  onUserMarkupChange?: (markup: PlotMarkup) => void
  annotationEnabled?: boolean
  onRequestFullscreen?: () => void
  provenanceModuleKey?: string
  onCaptureSnapshot?: (figure: { plotData: unknown[]; plotLayout: unknown }) => void | Promise<void>
  snapshotRequest?: number
}

interface NoteDraft {
  id?: string
  x: PlotCoordinate
  y: PlotCoordinate
  xref: string
  yref: string
  text: string
  color: string
  fontSize: number
  showArrow: boolean
}

type MarkupSelection = {
  kind: 'annotation' | 'shape'
  id: string
}

/** Derive a sane file base name from an explicit prop or the layout title. */
function deriveName(layout: unknown, fallback?: string): string {
  if (fallback) return fallback
  const title = (layout as { title?: unknown } | undefined)?.title
  const text = typeof title === 'string' ? title : (title as { text?: string } | undefined)?.text
  if (text) return text.replace(/[^\w .-]+/g, '').replace(/\s+/g, '_').replace(/^_+|_+$/g, '') || 'plot'
  return 'plot'
}

const ICON_DOWNLOAD = {
  width: 1000, height: 1000,
  path: 'M430 120 H570 V430 H720 L500 690 280 430 H430 Z M150 760 H850 V880 H150 Z',
}
const ICON_ANNOTATE = {
  width: 1000, height: 1000,
  path: 'M170 160 H830 V650 H520 L330 840 V650 H170 Z M270 280 H730 V350 H270 Z M270 420 H650 V490 H270 Z',
}
const ICON_FULLSCREEN = {
  width: 1000, height: 1000,
  path: 'M130 390 V130 H390 V220 H220 V390 Z M610 130 H870 V390 H780 V220 H610 Z M130 610 H220 V780 H390 V870 H130 Z M780 610 H870 V870 H610 V780 H780 Z',
}
type PlotlyModeBarIcon = {
  width: number
  height?: number
  ascent?: number
  descent?: number
  path: string
  transform?: string
}

const PLOTLY_ICONS = (Plotly as unknown as {
  Icons?: { pan?: PlotlyModeBarIcon; undo?: PlotlyModeBarIcon }
}).Icons

const RESET_ICON = PLOTLY_ICONS?.undo ?? {
  width: 857.1, height: 1000,
  path: 'm857 350q0-87-34-166t-91-137-137-92-166-34q-96 0-183 41t-147 114q-4 6-4 13t5 11l76 77q6 5 14 5 9-1 13-7 41-53 100-82t126-29q58 0 110 23t92 61 61 91 22 111-22 111-61 91-92 61-110 23q-55 0-105-20t-90-57l77-77q17-16 8-38-10-23-33-23h-250q-15 0-25 11t-11 25v250q0 24 22 33 22 10 39-8l72-72q60 57 137 88t159 31q87 0 166-34t137-92 91-137 34-166z',
  transform: 'matrix(1 0 0 -1 0 850)',
}

const PAN_ICON = PLOTLY_ICONS?.pan ?? {
  width: 1000, height: 1000,
  path: 'M455 80 H545 V275 L625 195 L690 260 L545 405 V455 H595 L740 310 L805 375 L725 455 H920 V545 H725 L805 625 L740 690 L595 545 H545 V595 L690 740 L625 805 L545 725 V920 H455 V725 L375 805 L310 740 L455 595 V545 H405 L260 690 L195 625 L275 545 H80 V455 H275 L195 375 L260 310 L405 455 H455 V405 L310 260 L375 195 L455 275 Z',
}

/** Export the live figure as a standalone, fully interactive HTML file. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function downloadHTML(gd: any, name: string, moduleKey?: string) {
  if (!gd?.data) return
  const html = [
    '<!DOCTYPE html><html><head><meta charset="utf-8">',
    `<title>${escapeHtmlText(name)}</title>`,
    '<script src="https://cdn.plot.ly/plotly-3.7.0.min.js" charset="utf-8"></' + 'script>',
    '<style>html,body{margin:0;height:100%}#p{width:100vw;height:100vh}</style>',
    '</head><body><div id="p"></div><script>',
    `Plotly.newPlot("p",${jsonForInlineScript(gd.data)},${jsonForInlineScript(gd.layout)},${jsonForInlineScript({
      responsive: true,
      scrollZoom: true,
      displaylogo: false,
      edits: { legendPosition: true, annotationPosition: true, annotationText: true, shapePosition: true },
      modeBarButtonsToAdd: ['drawline', 'drawrect', 'drawcircle', 'eraseshape'],
    })});`,
    '</' + 'script></body></html>',
  ].join('\n')
  await downloadArtifact(html, `${name}.html`, 'text/html', {
    kind: 'interactive-plot', title: name, moduleKey,
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function eventCoordinates(gd: any, event: MouseEvent): Pick<NoteDraft, 'x' | 'y' | 'xref' | 'yref'> | null {
  const full = gd?._fullLayout
  if (!full) return null
  const rect = gd.getBoundingClientRect()
  const size = full._size
  if (!size) return null
  const px = event.clientX - rect.left - size.l
  const py = event.clientY - rect.top - size.t
  if (px < 0 || py < 0 || px > size.w || py > size.h) return null
  const paperX = px / size.w
  const paperY = 1 - py / size.h
  const cartesianPlots = Object.values(full._plots ?? {}) as Array<{
    xaxis?: { _id?: string; domain?: number[]; p2d?: (pixel: number) => PlotCoordinate }
    yaxis?: { _id?: string; domain?: number[]; p2d?: (pixel: number) => PlotCoordinate }
  }>
  if (cartesianPlots.length === 0 && full.xaxis?.p2d && full.yaxis?.p2d) {
    cartesianPlots.push({ xaxis: full.xaxis, yaxis: full.yaxis })
  }
  for (const subplot of cartesianPlots) {
    const xaxis = subplot.xaxis
    const yaxis = subplot.yaxis
    const xd = xaxis?.domain ?? [0, 1]
    const yd = yaxis?.domain ?? [0, 1]
    if (!xaxis?.p2d || !yaxis?.p2d
        || paperX < xd[0] || paperX > xd[1]
        || paperY < yd[0] || paperY > yd[1]) continue
    const localX = px - xd[0] * size.w
    const localY = py - (1 - yd[1]) * size.h
    return {
      x: xaxis.p2d(localX), y: yaxis.p2d(localY),
      xref: xaxis._id || 'x', yref: yaxis._id || 'y',
    }
  }
  return {
    x: Math.max(0, Math.min(1, paperX)),
    y: Math.max(0, Math.min(1, paperY)),
    xref: 'paper', yref: 'paper',
  }
}

function paperCoordinates(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gd: any,
  event: MouseEvent,
): (PlotPathPoint & { xref: 'paper'; yref: 'paper' }) | null {
  const full = gd?._fullLayout
  const size = full?._size
  if (!size) return null
  const rect = gd.getBoundingClientRect()
  const x = (event.clientX - rect.left - size.l) / size.w
  const y = 1 - (event.clientY - rect.top - size.t) / size.h
  if (x < 0 || x > 1 || y < 0 || y > 1) return null
  return { x, y, xref: 'paper', yref: 'paper' }
}

type PencilCoordinate = PlotPathPoint & { xref: string; yref: string }

function PlotPencilOverlay({
  graphDiv,
  color,
  onComplete,
  onCancel,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  graphDiv: any
  color: string
  onComplete: (points: PencilCoordinate[]) => void
  onCancel: () => void
}) {
  const [screenPoints, setScreenPoints] = useState<PlotPathPoint[]>([])
  const screenPointsRef = useRef<PlotPathPoint[]>([])
  const plotPointsRef = useRef<PencilCoordinate[]>([])
  const pointerId = useRef<number | null>(null)

  const appendPoint = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const screen = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
    const previous = screenPointsRef.current[screenPointsRef.current.length - 1]
    if (previous && Math.hypot(screen.x - previous.x, screen.y - previous.y) < 1.5) return false

    const mapped = eventCoordinates(graphDiv, event.nativeEvent)
    const first = plotPointsRef.current[0]
    const numeric = mapped && typeof mapped.x === 'number' && Number.isFinite(mapped.x)
      && typeof mapped.y === 'number' && Number.isFinite(mapped.y)
      ? { x: mapped.x, y: mapped.y, xref: mapped.xref, yref: mapped.yref }
      : paperCoordinates(graphDiv, event.nativeEvent)
    if (!numeric || (first && (numeric.xref !== first.xref || numeric.yref !== first.yref))) return false

    screenPointsRef.current = [...screenPointsRef.current, screen]
    plotPointsRef.current = [...plotPointsRef.current, numeric]
    setScreenPoints(screenPointsRef.current)
    return true
  }

  const reset = () => {
    screenPointsRef.current = []
    plotPointsRef.current = []
    setScreenPoints([])
    pointerId.current = null
  }

  const finish = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointerId.current !== event.pointerId) return
    appendPoint(event)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    const completed = plotPointsRef.current
    reset()
    if (completed.length > 1) onComplete(completed)
    else onCancel()
  }

  return (
    <div
      data-perdura-plot-pencil-overlay
      className="absolute inset-0 z-20 cursor-crosshair touch-none"
      onPointerDown={event => {
        if (event.button !== 0 || !appendPoint(event)) return
        pointerId.current = event.pointerId
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={event => {
        if (pointerId.current === event.pointerId) appendPoint(event)
      }}
      onPointerUp={finish}
      onPointerCancel={() => {
        reset()
        onCancel()
      }}
    >
      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
        <path d={smoothedPlotPath(screenPoints)} fill="none" stroke={color} strokeWidth={3}
          strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

const TOOL_BUTTON = 'rounded border border-gray-200 bg-white px-2 py-1 text-[10px] font-medium text-gray-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300'

function PlotShapeButton({
  shape,
  label,
  onClick,
}: {
  shape: 'line' | 'rectangle' | 'circle'
  label: string
  onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label}
      className="flex h-10 w-12 items-center justify-center rounded border border-gray-200 bg-white text-gray-600 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300">
      <svg viewBox="0 0 40 28" className="h-7 w-9" aria-hidden>
        {shape === 'line' ? (
          <path d="M 5 23 L 35 5" fill="none" stroke="currentColor" strokeWidth="2" />
        ) : shape === 'circle' ? (
          <ellipse cx="20" cy="14" rx="14" ry="10" fill="none" stroke="currentColor" strokeWidth="2" />
        ) : (
          <rect x="5" y="5" width="30" height="18" fill="none" stroke="currentColor" strokeWidth="2" />
        )}
      </svg>
    </button>
  )
}

export default function ExportablePlot({
  exportName,
  interactionRevision,
  config,
  userMarkup = EMPTY_PLOT_MARKUP,
  onUserMarkupChange,
  annotationEnabled = true,
  onRequestFullscreen,
  provenanceModuleKey,
  onCaptureSnapshot,
  snapshotRequest = 0,
  ...rest
}: ExportablePlotProps) {
  const name = deriveName(rest.layout, exportName)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [graphDiv, setGraphDiv] = useState<any>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [placingNote, setPlacingNote] = useState(false)
  const [placingProjection, setPlacingProjection] = useState(false)
  const [placingPencil, setPlacingPencil] = useState(false)
  const [draft, setDraft] = useState<NoteDraft | null>(null)
  const [selectedMarkup, setSelectedMarkup] = useState<MarkupSelection | null>(null)
  const [markupColor, setMarkupColor] = useState('#2563eb')
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false)
  const appliedSnapshotRequest = useRef(0)
  const baseAnnotationCount = rest.layout?.annotations?.length ?? 0
  const baseShapeCount = rest.layout?.shapes?.length ?? 0

  const enhancedData = useMemo(() => rest.data.map(trace => {
    const item = trace as Plotly.Data & {
      hovertemplate?: string
      hoverinfo?: string
      line?: { width?: number }
      showlegend?: boolean
      name?: string
      type?: string
      mode?: string
    }
    if (item.hovertemplate != null || item.hoverinfo != null) return trace
    if (item.line?.width === 0 && item.showlegend === false
        && !String(item.mode ?? 'lines').includes('markers')) {
      return { ...item, hoverinfo: 'skip' } as Plotly.Data
    }
    const extra = item.name ? `<extra>${escapeHtmlText(item.name)}</extra>` : '<extra></extra>'
    if (item.type === 'pie') {
      return { ...item, hovertemplate: '%{label}<br>Value: %{value}<br>%{percent}' + extra } as Plotly.Data
    }
    if (item.type === 'heatmap' || item.type === 'contour') {
      return { ...item, hovertemplate: 'x: %{x}<br>y: %{y}<br>value: %{z:.6g}' + extra } as Plotly.Data
    }
    if (item.type === 'bar' || item.type === 'histogram') {
      return { ...item, hovertemplate: 'x: %{x}<br>y: %{y:.6g}' + extra } as Plotly.Data
    }
    if (!item.type || item.type === 'scatter') {
      return { ...item, hovertemplate: 'x: %{x}<br>y: %{y:.6g}' + extra } as Plotly.Data
    }
    return trace
  }), [rest.data])

  const revisionSource = interactionRevision ?? rest.revision ?? 'mounted-chart'
  const revisionRef = useState({ source: revisionSource, sequence: 0 })[0]
  if (!Object.is(revisionRef.source, revisionSource)) {
    revisionRef.source = revisionSource
    revisionRef.sequence += 1
  }
  const generatedUiRevision = `perdura-chart-${revisionRef.sequence}`

  const layout = useMemo(() => {
    const merged = mergePlotMarkup(rest.layout, userMarkup)
    const base = merged.uirevision == null ? {
      ...merged,
      uirevision: generatedUiRevision,
      editrevision: merged.editrevision ?? generatedUiRevision,
    } : merged
    const baseWithShape = base as Partial<Plotly.Layout> & { newshape?: Record<string, unknown> }
    const comparableLineCount = enhancedData.filter(trace => {
      const item = trace as { type?: string; mode?: string }
      return (!item.type || item.type === 'scatter')
        && String(item.mode ?? 'lines').includes('lines')
        && !String(item.mode ?? '').includes('markers')
    }).length
    return stripUndefinedPlotLayoutValues({
      ...base,
      paper_bgcolor: base.paper_bgcolor ?? 'white',
      plot_bgcolor: base.plot_bgcolor ?? 'white',
      font: { color: '#374151', size: 11, ...(base.font ?? {}) },
      hoverlabel: {
        bgcolor: 'white', bordercolor: '#cbd5e1', font: { color: '#111827', size: 11 },
        ...(base.hoverlabel ?? {}),
      },
      hovermode: base.hovermode ?? (comparableLineCount >= 2 ? 'x unified' : 'closest'),
      hoverdistance: base.hoverdistance ?? 20,
      spikedistance: (base as Partial<Plotly.Layout> & { spikedistance?: number }).spikedistance ?? -1,
      ...(base.legend ? { legend: {
        itemclick: 'toggle', itemdoubleclick: 'toggleothers', groupclick: 'toggleitem',
        ...(base.legend as object),
      } } : {}),
      ...(base.xaxis ? { xaxis: { automargin: true, ...(base.xaxis as object) } } : {}),
      ...(base.yaxis ? { yaxis: { automargin: true, ...(base.yaxis as object) } } : {}),
      newshape: {
        line: { color: markupColor, width: 2 },
        fillcolor: `${markupColor}20`, opacity: 1,
        ...(baseWithShape.newshape ?? {}),
      },
    } as Partial<Plotly.Layout>)
  }, [rest.layout, userMarkup, generatedUiRevision, markupColor, enhancedData])

  const syncLiveMarkup = useCallback(() => {
    if (!graphDiv || !onUserMarkupChange) return
    const next = markupFromLiveLayout(
      userMarkup,
      Array.isArray(graphDiv.layout?.annotations) ? graphDiv.layout.annotations : [],
      Array.isArray(graphDiv.layout?.shapes) ? graphDiv.layout.shapes : [],
      baseAnnotationCount,
      baseShapeCount,
    )
    if (!plotMarkupEqual(next, userMarkup)) onUserMarkupChange(next)
  }, [graphDiv, onUserMarkupChange, userMarkup, baseAnnotationCount, baseShapeCount])

  useEffect(() => {
    if (!placingNote && !placingProjection && !placingPencil) return
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPlacingNote(false)
        setPlacingProjection(false)
        setPlacingPencil(false)
      }
    }
    document.addEventListener('keydown', cancel)
    return () => document.removeEventListener('keydown', cancel)
  }, [placingNote, placingProjection, placingPencil])

  useEffect(() => {
    if (!downloadMenuOpen) return
    const dismiss = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('[data-perdura-download-menu]')) return
      setDownloadMenuOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDownloadMenuOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [downloadMenuOpen])

  const saveDraft = () => {
    if (!draft || !draft.text.trim() || !onUserMarkupChange) return
    const note: UserPlotAnnotation = {
      id: draft.id ?? newPlotMarkupId('note'),
      text: draft.text.trim(),
      x: draft.x, y: draft.y, xref: draft.xref, yref: draft.yref,
      ax: 32, ay: -32, showArrow: draft.showArrow,
      color: draft.color, fontSize: draft.fontSize,
    }
    onUserMarkupChange({
      ...userMarkup,
      annotations: draft.id
        ? userMarkup.annotations.map(item => item.id === draft.id ? { ...item, ...note } : item)
        : [...userMarkup.annotations, note],
    })
    setDraft(null)
  }

  const deleteDraft = () => {
    if (draft?.id && onUserMarkupChange) {
      onUserMarkupChange({
        ...userMarkup,
        annotations: userMarkup.annotations.filter(item => item.id !== draft.id),
      })
      setSelectedMarkup(current => current?.id === draft.id ? null : current)
    }
    setDraft(null)
  }

  const deleteMarkupItem = (selection: MarkupSelection) => {
    if (!onUserMarkupChange) return
    onUserMarkupChange(selection.kind === 'annotation'
      ? {
          ...userMarkup,
          annotations: userMarkup.annotations.filter(item => item.id !== selection.id),
        }
      : {
          ...userMarkup,
          shapes: userMarkup.shapes.filter(item => item.id !== selection.id),
        })
    setSelectedMarkup(current =>
      current?.kind === selection.kind && current.id === selection.id ? null : current)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const relayout = (updates: Record<string, unknown>) => graphDiv && (Plotly as any).relayout(graphDiv, updates)
  const setDragMode = (mode: string) => {
    relayout({ dragmode: mode, newshape: {
      line: { color: markupColor, width: 2 }, fillcolor: `${markupColor}20`, opacity: 1,
    } })
    setPaletteOpen(false)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resetGraphView = (gd: any) => {
    if (!gd) return
    setPlacingNote(false)
    setPlacingProjection(false)
    setPlacingPencil(false)
    setPaletteOpen(false)
    setDownloadMenuOpen(false)
    const updates = buildPlotViewResetUpdates(rest.layout, gd._fullLayout)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void (Plotly as any).relayout(gd, updates)
  }
  const resetView = () => resetGraphView(graphDiv)

  const downloadPlot = (format: 'png' | 'svg' | 'html') => {
    if (!graphDiv) return
    setDownloadMenuOpen(false)
    if (format === 'html') {
      void downloadHTML(graphDiv, name, provenanceModuleKey)
      return
    }
    const configured = config?.toImageButtonOptions ?? {}
    const imageOptions = {
      filename: name,
      ...(format === 'png' ? { scale: 2 } : {}),
      ...configured,
      format,
      width: configured.width ?? graphDiv?._fullLayout?.width,
      height: configured.height ?? graphDiv?._fullLayout?.height,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void (Plotly as any).toImage(graphDiv, imageOptions).then((dataUrl: string) =>
      downloadDataUrlArtifact(
        dataUrl,
        `${name}.${format}`,
        format === 'svg' ? 'image/svg+xml' : 'image/png',
        { kind: 'plot-image', title: name, moduleKey: provenanceModuleKey },
      ))
  }

  // Capture Plotly's public graph JSON rather than React props. This includes
  // the user's current trace visibility, zoom ranges, legend position, scene
  // camera, and moved annotations while stripping private runtime fields.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const capturePlotSnapshot = async (gd: any = graphDiv) => {
    if (!gd || !onCaptureSnapshot) return
    setPaletteOpen(false)
    setDownloadMenuOpen(false)
    const graphJson = (Plotly as unknown as {
      Plots?: { graphJson?: (...args: unknown[]) => unknown }
    }).Plots?.graphJson
    if (!graphJson) throw new Error('Plot serialization is unavailable.')
    const figure = graphJson(gd, false, 'keepdata', 'object') as {
      data?: unknown
      layout?: unknown
    }
    if (!Array.isArray(figure?.data)) throw new Error('The chart did not provide serializable trace data.')
    await onCaptureSnapshot({
      plotData: figure.data,
      plotLayout: figure.layout ?? {},
    })
  }

  useEffect(() => {
    if (!graphDiv || snapshotRequest <= 0 || snapshotRequest === appliedSnapshotRequest.current) return
    appliedSnapshotRequest.current = snapshotRequest
    void capturePlotSnapshot().catch(error => {
      const message = error instanceof Error ? error.message : 'The plot could not be serialized.'
      toast.error(`Plot snapshot failed: ${message}`)
    })
    // graphDiv is intentionally included: a request issued while the lazy plot
    // is mounting is fulfilled as soon as its live Plotly element is available.
  }, [snapshotRequest, graphDiv])

  const addAxisProjection = (event: Plotly.PlotMouseEvent) => {
    if (!onUserMarkupChange) return
    const point = event.points?.[0] as (Plotly.PlotDatum & {
      xaxis?: { _id?: string; title?: { text?: string } }
      yaxis?: { _id?: string; title?: { text?: string } }
    }) | undefined
    const x = point?.x
    const y = point?.y
    if ((typeof x !== 'number' && typeof x !== 'string')
        || (typeof y !== 'number' && typeof y !== 'string')) return
    const xref = point?.xaxis?._id || 'x'
    const yref = point?.yaxis?._id || 'y'
    const xLabel = htmlToPlainText(point?.xaxis?.title?.text || '') || 'x'
    const yLabel = htmlToPlainText(point?.yaxis?.title?.text || '') || 'y'
    onUserMarkupChange(appendAxisProjectionMarkup(userMarkup, {
      x, y, xref, yref, xLabel, yLabel, color: markupColor,
    }))
    setPlacingProjection(false)
  }

  const resettableView = enhancedData.some(trace =>
    String((trace as { type?: string }).type ?? 'scatter') !== 'pie')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cfg: any = { ...(config ?? {}) }
  if (cfg.scrollZoom == null) cfg.scrollZoom = true
  cfg.displaylogo = false
  cfg.edits = {
    ...(cfg.edits ?? {}),
    legendPosition: cfg.edits?.legendPosition ?? true,
    annotationPosition: annotationEnabled,
    shapePosition: annotationEnabled,
  }

  if (cfg.displayModeBar !== false) {
    cfg.toImageButtonOptions = {
      format: 'png', filename: name, scale: 2, ...(cfg.toImageButtonOptions ?? {}),
    }
    cfg.modeBarButtonsToRemove = Array.from(new Set([
      'toImage',
      'resetScale2d', 'resetViews', 'resetCameraDefault3d', 'resetCameraLastSave3d',
      'resetGeo', 'resetViewMapbox', 'resetViewMap', 'resetViewSankey',
      'select2d', 'lasso2d', 'autoScale2d', 'zoomIn2d', 'zoomOut2d', 'pan2d', 'pan3d',
      'toggleSpikelines', 'hoverClosestCartesian', 'hoverCompareCartesian',
      ...(cfg.modeBarButtonsToRemove ?? []),
    ]))
    const has3d = enhancedData.some(trace => (trace as { type?: string }).type === 'scatter3d')
    const hasPannableAxes = enhancedData.some(trace =>
      !['pie'].includes(String((trace as { type?: string }).type ?? 'scatter')))
    cfg.modeBarButtonsToAdd = [
      ...(resettableView ? [{
        name: 'perdura-reset-view', title: 'Reset plot view', icon: RESET_ICON,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        click: (gd: any) => resetGraphView(gd),
      }] : []),
      ...(cfg.modeBarButtonsToAdd ?? []),
      ...(hasPannableAxes ? [{
        name: 'perdura-pan', title: 'Pan plot', icon: PAN_ICON,
        attr: has3d ? 'scene.dragmode' : 'dragmode', val: 'pan',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        click: (gd: any) => (Plotly as any).relayout(gd, {
          [has3d ? 'scene.dragmode' : 'dragmode']: 'pan',
        }),
      }] : []),
      ...(annotationEnabled ? [{
        name: 'Annotate plot', title: 'Annotate plot', icon: ICON_ANNOTATE,
        click: () => setPaletteOpen(value => !value),
      }] : []),
      ...(onRequestFullscreen ? [{
        name: 'Full-screen plot', title: 'Open full-screen plot', icon: ICON_FULLSCREEN,
        click: onRequestFullscreen,
      }] : []),
      {
        name: 'perdura-download', title: 'Download plot', icon: ICON_DOWNLOAD,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        click: (gd: any) => {
          setGraphDiv(gd)
          setPaletteOpen(false)
          setDownloadMenuOpen(true)
        },
      },
    ]
  }

  const callerInitialized = rest.onInitialized
  const callerUpdate = rest.onUpdate
  const callerRelayout = rest.onRelayout
  const callerClick = rest.onClick
  const callerClickAnnotation = rest.onClickAnnotation
  const controlsHidden = cfg.displayModeBar === false && cfg.staticPlot !== true

  return (
    <div className={`relative ${placingNote ? 'cursor-crosshair ring-2 ring-inset ring-blue-300' : ''}`}
      style={{ width: rest.style?.width ?? '100%', height: rest.style?.height, minHeight: rest.style?.minHeight }}>
      <InternalPlot
        {...rest}
        data={enhancedData}
        layout={layout}
        config={cfg}
        onInitialized={(figure, gd) => {
          setGraphDiv(gd)
          callerInitialized?.(figure, gd)
        }}
        onUpdate={(figure, gd) => {
          setGraphDiv(gd)
          callerUpdate?.(figure, gd)
        }}
        onRelayout={event => {
          callerRelayout?.(event)
          window.setTimeout(syncLiveMarkup, 0)
        }}
        onClick={event => {
          callerClick?.(event)
          if (placingProjection) addAxisProjection(event)
        }}
        onClickAnnotation={event => {
          callerClickAnnotation?.(event)
          const index = event.index - baseAnnotationCount
          const note = userMarkup.annotations[index]
          if (!note) return
          setSelectedMarkup({ kind: 'annotation', id: note.id })
          setDraft({
            id: note.id, text: note.text,
            x: note.x, y: note.y, xref: note.xref, yref: note.yref,
            color: note.color, fontSize: note.fontSize, showArrow: note.showArrow,
          })
          setPaletteOpen(false)
        }}
      />

      {downloadMenuOpen && graphDiv && (
        <div data-perdura-download-menu data-perdura-plot-tools data-export-ignore
          role="menu" aria-label="Download plot format"
          className="absolute right-2 top-10 z-30 w-44 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-xl">
          <p className="border-b border-gray-100 px-3 py-1.5 text-[9px] font-semibold uppercase tracking-wide text-gray-400">
            Download plot
          </p>
          {([
            ['png', 'PNG image', 'Raster · 2× resolution'],
            ['svg', 'SVG vector', 'Scalable for documents'],
            ['html', 'Interactive HTML', 'Standalone interactive plot'],
          ] as const).map(([format, label, detail]) => (
            <button key={format} type="button" role="menuitem"
              onClick={() => downloadPlot(format)}
              className="block w-full px-3 py-2 text-left hover:bg-blue-50 focus:bg-blue-50 focus:outline-none">
              <span className="flex items-center justify-between gap-2 text-[11px] font-medium text-gray-700">
                {label}<span className="font-mono text-[9px] uppercase text-blue-600">.{format}</span>
              </span>
              <span className="mt-0.5 block text-[9px] text-gray-400">{detail}</span>
            </button>
          ))}
        </div>
      )}

      {controlsHidden && resettableView && (
        <button
          type="button"
          data-perdura-plot-tools
          onClick={resetView}
          disabled={!graphDiv}
          title="Reset plot view"
          aria-label="Reset plot view"
          className="absolute left-2 top-10 z-10 flex h-7 w-7 items-center justify-center rounded border border-gray-200 bg-white/90 text-gray-500 opacity-75 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 hover:opacity-100 focus:opacity-100 disabled:opacity-30"
        >
          <RotateCcw size={13} />
        </button>
      )}

      {placingNote && (
        <button
          type="button"
          aria-label="Place plot text callout"
          title="Click inside the plotting area to place the callout"
          className="absolute inset-0 z-20 cursor-crosshair border-0 bg-transparent p-0"
          onClick={event => {
            if (!graphDiv) return
            const coords = eventCoordinates(graphDiv, event.nativeEvent)
            if (!coords) return
            setDraft({
              ...coords,
              text: '',
              color: markupColor,
              fontSize: 12,
              showArrow: true,
            })
            setPlacingNote(false)
          }}
        />
      )}

      {placingPencil && graphDiv && (
        <PlotPencilOverlay
          graphDiv={graphDiv}
          color={markupColor}
          onCancel={() => setPlacingPencil(false)}
          onComplete={points => {
            const path = smoothedPlotPath(points)
            if (path && onUserMarkupChange) {
              onUserMarkupChange({
                ...userMarkup,
                shapes: [...userMarkup.shapes, {
                  id: newPlotMarkupId('shape'),
                  type: 'path',
                  xref: points[0].xref,
                  yref: points[0].yref,
                  path,
                  color: markupColor,
                  fillColor: 'rgba(0,0,0,0)',
                  width: 3,
                  opacity: 1,
                }],
              })
            }
            setPlacingPencil(false)
          }}
        />
      )}

      {placingProjection && (
        <div data-perdura-plot-tools className="pointer-events-none absolute left-1/2 top-2 z-30 -translate-x-1/2 rounded bg-blue-700 px-3 py-1.5 text-[11px] font-medium text-white shadow-lg">
          Click a data line or point to project its x and y values to the axes · Esc to cancel
        </div>
      )}

      {placingNote && (
        <div data-perdura-plot-tools className="pointer-events-none absolute left-1/2 top-2 z-30 -translate-x-1/2 rounded bg-blue-700 px-3 py-1.5 text-[11px] font-medium text-white shadow-lg">
          Click the plot to place the note · Esc to cancel
        </div>
      )}

      {placingPencil && (
        <div data-perdura-plot-tools className="pointer-events-none absolute left-1/2 top-2 z-30 -translate-x-1/2 rounded bg-blue-700 px-3 py-1.5 text-[11px] font-medium text-white shadow-lg">
          Draw on the plot · Esc to cancel
        </div>
      )}

      {paletteOpen && annotationEnabled && (
        <div data-perdura-plot-tools className="absolute right-2 top-10 z-30 w-64 rounded-lg border border-gray-200 bg-white p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-800">Plot tools</p>
            <button type="button" onClick={() => setPaletteOpen(false)} aria-label="Close plot tools"
              className="rounded px-1.5 text-sm text-gray-400 hover:bg-gray-100 hover:text-gray-700">×</button>
          </div>
          <div className="mb-1 flex items-center justify-between">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-400">Markup</p>
            <label className="flex items-center gap-1 text-[9px] text-gray-500">
              Color
              <input type="color" value={markupColor} onChange={event => setMarkupColor(event.target.value)}
                className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0" aria-label="Markup color" />
            </label>
          </div>
          <div className="flex flex-wrap gap-1">
            <button type="button" className={TOOL_BUTTON} onClick={() => { setPlacingNote(true); setPlacingProjection(false); setPlacingPencil(false); setPaletteOpen(false) }}>Text / callout</button>
            <button type="button" className={TOOL_BUTTON}
              title="Click a data line or point to draw guides and value labels at both axes"
              onClick={() => { setPlacingProjection(true); setPlacingNote(false); setPlacingPencil(false); setPaletteOpen(false) }}>
              Axis projection
            </button>
            <button type="button" className={TOOL_BUTTON}
              title="Draw a gently smoothed freehand annotation"
              onClick={() => {
                setPlacingPencil(true)
                setPlacingNote(false)
                setPlacingProjection(false)
                relayout({ dragmode: 'zoom' })
                setPaletteOpen(false)
              }}>
              Pencil
            </button>
          </div>
          <p className="mb-1 mt-2 text-[9px] font-semibold uppercase tracking-wide text-gray-400">Shapes</p>
          <div className="flex gap-1" role="group" aria-label="Plot shape annotations">
            <PlotShapeButton shape="line" label="Line" onClick={() => setDragMode('drawline')} />
            <PlotShapeButton shape="rectangle" label="Rectangle" onClick={() => setDragMode('drawrect')} />
            <PlotShapeButton shape="circle" label="Circle" onClick={() => setDragMode('drawcircle')} />
            <button type="button" className={TOOL_BUTTON} onClick={() => setDragMode('eraseshape')}>Erase</button>
          </div>
          {(userMarkup.annotations.length > 0 || userMarkup.shapes.length > 0) && (
            <div className="mt-3 border-t border-gray-100 pt-2">
              <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-gray-400">
                Existing annotations
              </p>
              <div className="max-h-36 space-y-1 overflow-y-auto pr-0.5">
                {userMarkup.annotations.map((item, index) => {
                  const selection: MarkupSelection = { kind: 'annotation', id: item.id }
                  const selected = selectedMarkup?.kind === selection.kind && selectedMarkup.id === item.id
                  const text = htmlToPlainText(item.text).trim() || `Text note ${index + 1}`
                  return (
                    <div key={`annotation-${item.id}`}
                      className={`flex items-center gap-1 rounded border p-1 ${
                        selected ? 'border-blue-400 bg-blue-50' : 'border-gray-100 bg-gray-50'
                      }`}>
                      <button type="button" aria-pressed={selected}
                        title={`Select ${text}`}
                        onClick={() => setSelectedMarkup(selection)}
                        className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left text-[10px] text-gray-600 hover:bg-white">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-white shadow-sm"
                          style={{ backgroundColor: item.color }} aria-hidden />
                        <span className="truncate">{text}</span>
                      </button>
                      <button type="button" title={`Edit ${text}`} aria-label={`Edit ${text}`}
                        onClick={() => {
                          setSelectedMarkup(selection)
                          setDraft({
                            id: item.id, text: item.text,
                            x: item.x, y: item.y, xref: item.xref, yref: item.yref,
                            color: item.color, fontSize: item.fontSize, showArrow: item.showArrow,
                          })
                          setPaletteOpen(false)
                        }}
                        className="rounded px-1 py-0.5 text-[9px] text-blue-600 hover:bg-blue-100">
                        Edit
                      </button>
                      <button type="button" title={`Delete ${text}`} aria-label={`Delete ${text}`}
                        onClick={() => deleteMarkupItem(selection)}
                        className="flex h-5 w-5 items-center justify-center rounded text-sm leading-none text-red-500 hover:bg-red-50 hover:text-red-700">
                        ×
                      </button>
                    </div>
                  )
                })}
                {userMarkup.shapes.map((item, index) => {
                  const selection: MarkupSelection = { kind: 'shape', id: item.id }
                  const selected = selectedMarkup?.kind === selection.kind && selectedMarkup.id === item.id
                  const kind = item.type === 'path' ? 'Pencil stroke'
                    : item.type === 'rect' ? 'Rectangle'
                      : item.type === 'circle' ? 'Circle' : 'Line'
                  const label = `${kind} ${index + 1}`
                  return (
                    <div key={`shape-${item.id}`}
                      className={`flex items-center gap-1 rounded border p-1 ${
                        selected ? 'border-blue-400 bg-blue-50' : 'border-gray-100 bg-gray-50'
                      }`}>
                      <button type="button" aria-pressed={selected}
                        title={`Select ${label}`}
                        onClick={() => setSelectedMarkup(selection)}
                        className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left text-[10px] text-gray-600 hover:bg-white">
                        <span className="h-0 w-4 shrink-0 border-t-2" style={{ borderColor: item.color }} aria-hidden />
                        <span className="truncate">{label}</span>
                      </button>
                      <button type="button" title={`Delete ${label}`} aria-label={`Delete ${label}`}
                        onClick={() => deleteMarkupItem(selection)}
                        className="flex h-5 w-5 items-center justify-center rounded text-sm leading-none text-red-500 hover:bg-red-50 hover:text-red-700">
                        ×
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          <div className="mt-3 border-t border-gray-100 pt-2">
            {(userMarkup.annotations.length > 0 || userMarkup.shapes.length > 0) && (
              <p className="mb-1 text-[10px] text-gray-500">
                {userMarkup.annotations.length} note{userMarkup.annotations.length === 1 ? '' : 's'} · {userMarkup.shapes.length} shape{userMarkup.shapes.length === 1 ? '' : 's'}
              </p>
            )}
            <button type="button"
              disabled={userMarkup.annotations.length === 0 && userMarkup.shapes.length === 0}
              className={`${TOOL_BUTTON} text-red-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-white disabled:text-gray-300`}
              onClick={() => {
                if (window.confirm('Clear all text, projections, shapes, and pencil annotations from this plot?')) {
                  onUserMarkupChange?.(EMPTY_PLOT_MARKUP)
                  setSelectedMarkup(null)
                  setPaletteOpen(false)
                }
              }}>
              Clear all annotations
            </button>
          </div>
        </div>
      )}

      {draft && (
        <div data-perdura-plot-tools className="absolute left-1/2 top-12 z-40 w-72 -translate-x-1/2 rounded-lg border border-blue-200 bg-white p-3 shadow-xl"
          role="dialog" aria-label={draft.id ? 'Edit plot note' : 'Add plot note'}>
          <label className="block text-[10px] font-semibold text-gray-600">{draft.id ? 'Edit note' : 'New note'}</label>
          <textarea autoFocus rows={3} value={draft.text}
            onChange={event => setDraft({ ...draft, text: event.target.value })}
            onKeyDown={event => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') saveDraft()
              if (event.key === 'Escape') setDraft(null)
            }}
            placeholder="Type an observation or callout…"
            className="mt-1 w-full resize-y rounded border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300" />
          <div className="mt-2 flex items-center gap-3 text-[10px] text-gray-600">
            <label className="flex items-center gap-1">Color
              <input type="color" value={draft.color}
                onChange={event => setDraft({ ...draft, color: event.target.value })}
                className="h-5 w-6 border-0 bg-transparent p-0" />
            </label>
            <label className="flex items-center gap-1">Size
              <input type="number" min={8} max={32} value={draft.fontSize}
                onChange={event => setDraft({ ...draft, fontSize: Math.max(8, Math.min(32, Number(event.target.value) || 12)) })}
                className="w-12 rounded border border-gray-300 px-1 py-0.5" />
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={draft.showArrow}
                onChange={event => setDraft({ ...draft, showArrow: event.target.checked })} /> Arrow
            </label>
          </div>
          <div className="mt-3 flex items-center gap-2">
            {draft.id && <button type="button" onClick={deleteDraft} className="text-[10px] font-medium text-red-600 hover:text-red-800">Delete</button>}
            <span className="flex-1" />
            <button type="button" onClick={() => setDraft(null)} className="rounded px-2 py-1 text-[10px] text-gray-500 hover:bg-gray-100">Cancel</button>
            <button type="button" onClick={saveDraft} disabled={!draft.text.trim()}
              className="rounded bg-blue-600 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-blue-700 disabled:opacity-40">Save</button>
          </div>
        </div>
      )}
    </div>
  )
}
