import createPlotlyComponent from 'react-plotly.js/factory'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { escapeHtmlText, htmlToPlainText, jsonForInlineScript } from './htmlSafety'
import {
  EMPTY_PLOT_MARKUP,
  markupFromLiveLayout,
  mergePlotMarkup,
  newPlotMarkupId,
  plotMarkupEqual,
  type PlotCoordinate,
  type PlotMarkup,
  type UserPlotAnnotation,
} from '../../store/plotMarkup'
import Plotly from './plotly'

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

/** Derive a sane file base name from an explicit prop or the layout title. */
function deriveName(layout: unknown, fallback?: string): string {
  if (fallback) return fallback
  const title = (layout as { title?: unknown } | undefined)?.title
  const text = typeof title === 'string' ? title : (title as { text?: string } | undefined)?.text
  if (text) return text.replace(/[^\w .-]+/g, '').replace(/\s+/g, '_').replace(/^_+|_+$/g, '') || 'plot'
  return 'plot'
}

const ICON_SVG_DL = {
  width: 1000, height: 1000,
  path: 'M430 120 H570 V430 H720 L500 690 280 430 H430 Z M150 760 H850 V880 H150 Z',
}
const ICON_HTML = {
  width: 1000, height: 1000,
  path: 'M360 230 L150 500 L360 770 L360 640 L300 500 L360 360 Z '
      + 'M640 230 L850 500 L640 770 L640 640 L700 500 L640 360 Z '
      + 'M540 210 L620 210 L470 790 L390 790 Z',
}
const ICON_ANNOTATE = {
  width: 1000, height: 1000,
  path: 'M170 160 H830 V650 H520 L330 840 V650 H170 Z M270 280 H730 V350 H270 Z M270 420 H650 V490 H270 Z',
}
const ICON_FULLSCREEN = {
  width: 1000, height: 1000,
  path: 'M130 390 V130 H390 V220 H220 V390 Z M610 130 H870 V390 H780 V220 H610 Z M130 610 H220 V780 H390 V870 H130 Z M780 610 H870 V870 H610 V780 H780 Z',
}

const PAN_ICON = (Plotly as unknown as {
  Icons?: { pan?: { width: number; height?: number; ascent?: number; descent?: number; path: string } }
}).Icons?.pan ?? {
  width: 1000, height: 1000,
  path: 'M455 80 H545 V275 L625 195 L690 260 L545 405 V455 H595 L740 310 L805 375 L725 455 H920 V545 H725 L805 625 L740 690 L595 545 H545 V595 L690 740 L625 805 L545 725 V920 H455 V725 L375 805 L310 740 L455 595 V545 H405 L260 690 L195 625 L275 545 H80 V455 H275 L195 375 L260 310 L405 455 H455 V405 L310 260 L375 195 L455 275 Z',
}

/** Export the live figure as a standalone, fully interactive HTML file. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function downloadHTML(gd: any, name: string) {
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
  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `${name}.html`; a.click()
  URL.revokeObjectURL(url)
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

const TOOL_BUTTON = 'rounded border border-gray-200 bg-white px-2 py-1 text-[10px] font-medium text-gray-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300'

export default function ExportablePlot({
  exportName,
  interactionRevision,
  config,
  userMarkup = EMPTY_PLOT_MARKUP,
  onUserMarkupChange,
  annotationEnabled = true,
  onRequestFullscreen,
  ...rest
}: ExportablePlotProps) {
  const name = deriveName(rest.layout, exportName)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [graphDiv, setGraphDiv] = useState<any>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [placingNote, setPlacingNote] = useState(false)
  const [placingProjection, setPlacingProjection] = useState(false)
  const [draft, setDraft] = useState<NoteDraft | null>(null)
  const [markupColor, setMarkupColor] = useState('#2563eb')
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
    return {
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
      legend: base.legend ? {
        itemclick: 'toggle', itemdoubleclick: 'toggleothers', groupclick: 'toggleitem',
        ...(base.legend as object),
      } : base.legend,
      xaxis: base.xaxis ? { automargin: true, ...(base.xaxis as object) } : base.xaxis,
      yaxis: base.yaxis ? { automargin: true, ...(base.yaxis as object) } : base.yaxis,
      newshape: {
        line: { color: markupColor, width: 2 },
        fillcolor: `${markupColor}20`, opacity: 1,
        ...(baseWithShape.newshape ?? {}),
      },
    } as Partial<Plotly.Layout>
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
    if (!placingNote && !placingProjection) return
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPlacingNote(false)
        setPlacingProjection(false)
      }
    }
    document.addEventListener('keydown', cancel)
    return () => document.removeEventListener('keydown', cancel)
  }, [placingNote, placingProjection])

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
    }
    setDraft(null)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const relayout = (updates: Record<string, unknown>) => graphDiv && (Plotly as any).relayout(graphDiv, updates)
  const setDragMode = (mode: string) => {
    relayout({ dragmode: mode, newshape: {
      line: { color: markupColor, width: 2 }, fillcolor: `${markupColor}20`, opacity: 1,
    } })
    setPaletteOpen(false)
  }

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
    const xText = typeof x === 'number' ? x.toLocaleString(undefined, { maximumSignificantDigits: 6 }) : x
    const yText = typeof y === 'number' ? y.toLocaleString(undefined, { maximumSignificantDigits: 6 }) : y
    const verticalId = newPlotMarkupId('shape')
    const horizontalId = newPlotMarkupId('shape')
    onUserMarkupChange({
      annotations: [
        ...userMarkup.annotations,
        {
          id: newPlotMarkupId('note'), text: `${xLabel} = ${xText}`,
          x, y: 0, xref, yref: `${yref} domain`,
          showArrow: false, color: markupColor, fontSize: 11,
        },
        {
          id: newPlotMarkupId('note'), text: `${yLabel} = ${yText}`,
          x: 0, y, xref: `${xref} domain`, yref,
          showArrow: false, color: markupColor, fontSize: 11,
        },
      ],
      shapes: [
        ...userMarkup.shapes,
        {
          id: verticalId, type: 'line', xref, yref: `${yref} domain`,
          x0: x, x1: x, y0: 0, y1: 1,
          color: markupColor, fillColor: 'rgba(0,0,0,0)', width: 1.5, opacity: 0.9,
        },
        {
          id: horizontalId, type: 'line', xref: `${xref} domain`, yref,
          x0: 0, x1: 1, y0: y, y1: y,
          color: markupColor, fillColor: 'rgba(0,0,0,0)', width: 1.5, opacity: 0.9,
        },
      ],
    })
    setPlacingProjection(false)
  }

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
      'select2d', 'lasso2d', 'autoScale2d', 'zoomIn2d', 'zoomOut2d', 'pan2d', 'pan3d',
      'toggleSpikelines', 'hoverClosestCartesian', 'hoverCompareCartesian',
      ...(cfg.modeBarButtonsToRemove ?? []),
    ]))
    const has3d = enhancedData.some(trace => (trace as { type?: string }).type === 'scatter3d')
    const hasPannableAxes = enhancedData.some(trace =>
      !['pie'].includes(String((trace as { type?: string }).type ?? 'scatter')))
    cfg.modeBarButtonsToAdd = [
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
        name: 'Download as SVG', title: 'Download as SVG (vector)', icon: ICON_SVG_DL,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        click: (gd: any) => (Plotly as any).downloadImage(gd, {
          format: 'svg', filename: name,
          width: gd?._fullLayout?.width, height: gd?._fullLayout?.height,
        }),
      },
      {
        name: 'Download interactive HTML', title: 'Download interactive HTML', icon: ICON_HTML,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        click: (gd: any) => downloadHTML(gd, name),
      },
    ]
  }

  const callerInitialized = rest.onInitialized
  const callerUpdate = rest.onUpdate
  const callerRelayout = rest.onRelayout
  const callerClick = rest.onClick
  const callerClickAnnotation = rest.onClickAnnotation

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
          setDraft({
            id: note.id, text: note.text,
            x: note.x, y: note.y, xref: note.xref, yref: note.yref,
            color: note.color, fontSize: note.fontSize, showArrow: note.showArrow,
          })
          setPaletteOpen(false)
        }}
      />

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
            <button type="button" className={TOOL_BUTTON} onClick={() => { setPlacingNote(true); setPlacingProjection(false); setPaletteOpen(false) }}>Text / callout</button>
            <button type="button" className={TOOL_BUTTON}
              title="Click a data line or point to draw guides and value labels at both axes"
              onClick={() => { setPlacingProjection(true); setPlacingNote(false); setPaletteOpen(false) }}>
              Axis projection
            </button>
            <button type="button" className={TOOL_BUTTON} onClick={() => setDragMode('drawline')}>Line</button>
            <button type="button" className={TOOL_BUTTON} onClick={() => setDragMode('drawrect')}>Rectangle</button>
            <button type="button" className={TOOL_BUTTON} onClick={() => setDragMode('drawcircle')}>Circle</button>
            <button type="button" className={TOOL_BUTTON} onClick={() => setDragMode('eraseshape')}>Erase shape</button>
          </div>
          {(userMarkup.annotations.length > 0 || userMarkup.shapes.length > 0) && (
            <div className="mt-3 border-t border-gray-100 pt-2">
              <p className="mb-1 text-[10px] text-gray-500">
                {userMarkup.annotations.length} note{userMarkup.annotations.length === 1 ? '' : 's'} · {userMarkup.shapes.length} shape{userMarkup.shapes.length === 1 ? '' : 's'}
              </p>
              <button type="button" className={`${TOOL_BUTTON} text-red-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700`}
                onClick={() => {
                  if (window.confirm('Clear all user annotations and shapes from this plot?')) {
                    onUserMarkupChange?.(EMPTY_PLOT_MARKUP)
                    setPaletteOpen(false)
                  }
                }}>
                Clear all markup
              </button>
            </div>
          )}
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
