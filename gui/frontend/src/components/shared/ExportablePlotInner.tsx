import { useRef, useEffect, useCallback, CSSProperties, ReactNode } from 'react'
import Plotly from './plotly'

// ---------------------------------------------------------------------------
// Minimal Plotly wrapper (replaces react-plotly.js, which is CJS-only and
// incompatible with Rolldown / React 19).
// ---------------------------------------------------------------------------
type PlotlyData = unknown
type PlotlyLayout = unknown
type PlotlyConfig = unknown
type PlotlyFrame = unknown
type PlotlyGd = Record<string, unknown>

interface PlotlyWrapperProps {
  data: PlotlyData[]
  layout?: PlotlyLayout
  config?: PlotlyConfig
  frames?: PlotlyFrame[]
  revision?: number
  style?: CSSProperties
  className?: string
  useResizeHandler?: boolean
  divId?: string
  debug?: boolean
  onInitialized?: (figure: unknown, gd: PlotlyGd) => void
  onUpdate?: (figure: unknown, gd: PlotlyGd) => void
  onPurge?: (figure: unknown, gd: PlotlyGd) => void
  onError?: (err: unknown) => void
  children?: ReactNode
  // Plotly event handlers — react-plotly.js exposed every event as `on<EventName>`.
  // We forward all unknown props through, so callers can still pass `onClick`,
  // `onRelayout`, etc. The wrapper attaches them via `gd.on(...)`.
  [key: string]: unknown
}

/**
 * React component that renders a Plotly.js chart into a `<div>` ref.
 * Mirrors the react-plotly.js prop contract so existing call sites work unchanged.
 */
function PlotlyWrapper(props: PlotlyWrapperProps) {
  const {
    data, layout, config, frames, revision, style, className,
    useResizeHandler, divId, debug, onInitialized, onUpdate, onPurge, onError,
  } = props

  const gdRef = useRef<PlotlyGd | null>(null)
  const prevPropsRef = useRef<{ data: unknown; layout: unknown; config: unknown; framesLen: number; revision?: number }>({
    data: null, layout: null, config: null, framesLen: 0,
  })
  const handlersRef = useRef<Map<string, (...args: unknown[]) => void>>(new Map())
  const unmountingRef = useRef(false)

  /** Extract figure data from the Plotly graph div. */
  const readFigure = useCallback((gd: PlotlyGd) => {
    const d = (gd as any).data
    const l = (gd as any).layout
    const td = (gd as any)._transitionData
    const f = td?._frames ?? null
    return { data: d, layout: l, frames: f }
  }, [])

  /** Callback helper that safely invokes an optional callback with the live figure. */
  const invokeCb = useCallback(
    (cb: ((figure: unknown, gd: PlotlyGd) => void) | undefined, gd: PlotlyGd) => {
      if (typeof cb === 'function') cb(readFigure(gd), gd)
    },
    [readFigure],
  )

  /** Attach event listeners for any `on<Event>` props that aren't handled above. */
  useEffect(() => {
    const gd = gdRef.current
    if (!gd || !('on' in gd) || !('removeListener' in gd)) return

    const knownKeys = new Set([
      'data', 'layout', 'config', 'frames', 'revision', 'style', 'className',
      'useResizeHandler', 'divId', 'debug', 'onInitialized', 'onUpdate',
      'onPurge', 'onError', 'children',
    ])

    const oldKeys = new Set(handlersRef.current.keys())
    const newHandlers = new Map<string, (...args: unknown[]) => void>()

    for (const key of Object.keys(props)) {
      if (!key.startsWith('on') || knownKeys.has(key)) continue
      const handler = props[key]
      if (typeof handler !== 'function') continue

      const plotlyEvent = `plotly_${key.slice(2).toLowerCase()}`

      if (!oldKeys.has(key)) {
        try {
          ;(gd as any).on(plotlyEvent, handler)
        } catch { /* ignore */ }
      }
      newHandlers.set(key, handler as (...args: unknown[]) => void)
    }

    // Remove handlers that are no longer present
    for (const key of oldKeys) {
      if (!newHandlers.has(key)) {
        const plotlyEvent = `plotly_${key.slice(2).toLowerCase()}`
        const oldHandler = handlersRef.current.get(key)
        if (oldHandler) {
          try {
            ;(gd as any).removeListener(plotlyEvent, oldHandler)
          } catch { /* ignore */ }
        }
      }
    }

    handlersRef.current = newHandlers
  })

  // Clean up event listeners on unmount
  useEffect(() => {
    return () => {
      const gd = gdRef.current
      if (!gd || !('removeListener' in gd)) return
      for (const [key, handler] of handlersRef.current) {
        const plotlyEvent = `plotly_${key.slice(2).toLowerCase()}`
        try {
          ;(gd as any).removeListener(plotlyEvent, handler)
        } catch { /* ignore */ }
      }
      handlersRef.current.clear()
    }
  }, [])

  // Main render / update effect
  useEffect(() => {
    const gd = gdRef.current
    if (!gd || unmountingRef.current) return

    const prev = prevPropsRef.current
    const framesLen = (Array.isArray(frames) ? frames.length : 0)
    const changed = !(prev.data === data && prev.layout === layout && prev.config === config && prev.framesLen === framesLen)
    const revisionChanged = revision !== prev.revision

    if (!changed && (revision === undefined || !revisionChanged)) return

    prevPropsRef.current = { data, layout, config, framesLen, revision }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let p: Promise<any> = Promise.resolve()

    p = p.then(() => {
      if (unmountingRef.current || !gdRef.current) return
      return (Plotly as any).react(
        gdRef.current as any,
        data,
        layout,
        config,
        frames ? { frames } : undefined,
      )
    }).then(() => {
      if (unmountingRef.current || !gdRef.current) return
      invokeCb(onInitialized, gdRef.current as PlotlyGd)
    }).catch((err: unknown) => {
      if (onError) onError(err)
    })

    return () => { /* cleanup if needed */ }
  }, [data, layout, config, frames, revision, onInitialized, onUpdate, onError, invokeCb])

  // Window resize handler
  useEffect(() => {
    if (!useResizeHandler) return
    const gd = gdRef.current
    if (!gd) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleResize = () => (Plotly as any).Plots?.resize(gdRef.current)
    window.addEventListener('resize', handleResize)
    handleResize()
    return () => window.removeEventListener('resize', handleResize)
  }, [useResizeHandler])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      unmountingRef.current = true
      const gd = gdRef.current
      if (!gd) return
      invokeCb(onPurge, gd)
      try {
        ;(Plotly as any).purge(gd)
      } catch { /* ignore */ }
    }
  }, [onPurge, invokeCb])

  return (
    <div
      id={divId}
      style={style}
      ref={(el: HTMLDivElement | null) => {
        gdRef.current = el as unknown as PlotlyGd
        if (debug && typeof window !== 'undefined') {
          ;(window as any).gd = el
        }
      }}
      className={className}
    />
  )
}

// ---------------------------------------------------------------------------
// ExportablePlot — adds SVG + HTML download buttons to modebar
// ---------------------------------------------------------------------------
interface ExportablePlotProps {
  data: PlotlyData[]
  layout?: PlotlyLayout
  config?: PlotlyConfig
  frames?: PlotlyFrame[]
  revision?: number
  style?: CSSProperties
  className?: string
  useResizeHandler?: boolean
  divId?: string
  debug?: boolean
  onInitialized?: (figure: unknown, gd: PlotlyGd) => void
  onUpdate?: (figure: unknown, gd: PlotlyGd) => void
  onPurge?: (figure: unknown, gd: PlotlyGd) => void
  onError?: (err: unknown) => void
  /** Base filename for exports; defaults to the plot title (sanitized). */
  exportName?: string
  [key: string]: unknown
}

/** Derive a sane file base name from an explicit prop or the layout title. */
function deriveName(layout: unknown, fallback?: string): string {
  if (fallback) return fallback
  const title = (layout as { title?: unknown } | undefined)?.title
  const text = typeof title === 'string' ? title : (title as { text?: string } | undefined)?.text
  if (text) return text.replace(/[^\w .-]+/g, '').replace(/\s+/g, '_').replace(/^_+|_+$/g, '') || 'plot'
  return 'plot'
}

// Custom modebar icons (simple filled paths in a 1000×1000 box) so the SVG and
// HTML download buttons read clearly and never depend on internal Plotly icons.
const ICON_SVG_DL = {
  width: 1000, height: 1000,
  // a down-arrow dropping into a tray = "download (vector)"
  path: 'M430 120 H570 V430 H720 L500 690 280 430 H430 Z M150 760 H850 V880 H150 Z',
}
const ICON_HTML = {
  width: 1000, height: 1000,
  // a "</>" code glyph = "interactive HTML"
  path: 'M360 230 L150 500 L360 770 L360 640 L300 500 L360 360 Z '
      + 'M640 230 L850 500 L640 770 L640 640 L700 500 L640 360 Z '
      + 'M540 210 L620 210 L470 790 L390 790 Z',
}

/** Export the live figure as a standalone, fully interactive HTML file. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function downloadHTML(gd: any, name: string) {
  if (!gd?.data) return
  const html = [
    '<!DOCTYPE html><html><head><meta charset="utf-8">',
    `<title>${name}</title>`,
    '<script src="https://cdn.plot.ly/plotly-2.35.0.min.js" charset="utf-8"></' + 'script>',
    '<style>html,body{margin:0;height:100%}#p{width:100vw;height:100vh}</style>',
    '</head><body><div id="p"></div><script>',
    `Plotly.newPlot("p",${JSON.stringify(gd.data)},${JSON.stringify(gd.layout)},{responsive:true});`,
    '</' + 'script></body></html>',
  ].join('\n')
  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `${name}.html`; a.click()
  URL.revokeObjectURL(url)
}

/**
 * Drop-in replacement for `react-plotly.js`'s default export that augments the
 * native Plotly modebar (top-right, single row) with SVG-vector and interactive
 * HTML download buttons. The built-in camera button still handles PNG. Plots
 * that explicitly opt out of the modebar (`displayModeBar: false`) are left
 * untouched.
 */
export default function ExportablePlot({ exportName, config, ...rest }: ExportablePlotProps) {
  const name = deriveName((rest as any).layout, exportName)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cfg: any = { ...(config ?? {}) }

  if (cfg.displayModeBar !== false) {
    cfg.displaylogo = false
    cfg.toImageButtonOptions = {
      format: 'png', filename: name, scale: 2, ...(cfg.toImageButtonOptions ?? {}),
    }
    // Keep the bar compact: box-zoom (drag), pan and reset, plus PNG/SVG/HTML.
    // The zoom in/out (+/-) and autoscale buttons are intentionally dropped —
    // clicking the magnifier just arms box-zoom drag mode. The CSS keeps
    // everything on one row.
    cfg.modeBarButtonsToRemove = [
      'select2d', 'lasso2d', 'autoScale2d', 'zoomIn2d', 'zoomOut2d',
      'toggleSpikelines', 'hoverClosestCartesian', 'hoverCompareCartesian',
      ...(cfg.modeBarButtonsToRemove ?? []),
    ]
    cfg.modeBarButtonsToAdd = [
      ...(cfg.modeBarButtonsToAdd ?? []),
      {
        name: 'Download as SVG',
        title: 'Download as SVG (vector)',
        icon: ICON_SVG_DL,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        click: (gd: any) => (Plotly as any).downloadImage(gd, {
          format: 'svg', filename: name,
          width: gd?._fullLayout?.width, height: gd?._fullLayout?.height,
        }),
      },
      {
        name: 'Download interactive HTML',
        title: 'Download interactive HTML',
        icon: ICON_HTML,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        click: (gd: any) => downloadHTML(gd, name),
      },
    ]
  }

  return <PlotlyWrapper {...rest} config={cfg} />
}
