import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { registerRuntimePlotAsset } from '../../store/runtimePlotAssets'
import { getActivePlotGroup, makePlotMarkupKey, usePlotMarkup } from '../../store/project'
import {
  cleanPlotIdentity,
  mergePlotMarkup,
  sanitizePlotMarkup,
  type PlotMarkup,
} from '../../store/plotMarkup'
import { htmlToPlainText } from './htmlSafety'
import { useReportAssetScope } from './ReportAssetScope'

// Plotly (the app's largest chunk) is deliberately NOT imported here. This
// wrapper lazy-loads the real component so the plotly-*.js chunk is fetched
// only when a chart actually mounts — modules render their data-entry UI on
// first paint without paying for it.
// The cast erases the inner component's stricter react-plotly prop type
// (which requires `layout`) so this wrapper can keep the app-wide looser
// contract where layout/config are optional.
const InnerPlot = lazy(() => import('./ExportablePlotInner')) as unknown as
  React.ComponentType<ExportablePlotProps>

// Prop shape matches react-plotly.js; typed structurally (via the ambient
// Plotly namespace, types only — no runtime import) so call sites keep their
// existing `as Plotly.Data` casts.
export interface ExportablePlotProps {
  data: Plotly.Data[]
  layout?: Partial<Plotly.Layout>
  config?: Partial<Plotly.Config>
  style?: React.CSSProperties
  useResizeHandler?: boolean
  /** Base filename for exports; defaults to the plot title (sanitized). */
  exportName?: string
  /** Changing this value resets user zoom and editable legend placement. */
  interactionRevision?: unknown
  /** Stable semantic identity within the active analysis. */
  plotId?: string
  /** Override shared markup storage (used by Report Builder plot copies). */
  plotMarkup?: PlotMarkup
  onPlotMarkupChange?: (markup: PlotMarkup) => void
  /** enabled by default; compact plots expose it only in the full-screen viewer. */
  annotationMode?: 'enabled' | 'fullscreen-only' | 'disabled'
  /** Report Builder label/group overrides for plots without a layout title. */
  reportLabel?: string
  reportGroup?: string
  reportKey?: string
  [key: string]: unknown
}

function semanticPlotId(props: ExportablePlotProps, label: string): string {
  if (props.plotId) return props.plotId
  if (props.reportKey) return props.reportKey
  if (props.exportName) return props.exportName
  if (label) return label
  const layout = props.layout as {
    xaxis?: { title?: string | { text?: string } }
    yaxis?: { title?: string | { text?: string } }
  } | undefined
  const axisText = (title: unknown) => typeof title === 'string'
    ? title : (title as { text?: string } | undefined)?.text ?? ''
  const traces = props.data.map((trace, index) => {
    const item = trace as { name?: string; type?: string }
    return `${item.type ?? 'scatter'}:${item.name ?? index}`
  }).join('|')
  return cleanPlotIdentity([
    axisText(layout?.xaxis?.title), axisText(layout?.yaxis?.title), traces,
  ].join('|')) || 'plot'
}

function fallbackPlotLabel(props: ExportablePlotProps): string {
  if (props.exportName) return props.exportName.replace(/[_-]+/g, ' ')
  if (props.reportKey) return props.reportKey.replace(/[_:.-]+/g, ' ')
  const names = Array.from(new Set(props.data.map(trace =>
    String((trace as { name?: unknown }).name ?? '').trim()).filter(Boolean)))
  if (names.length > 0) return `${names.slice(0, 2).join(' / ')} Plot`
  const x = (props.layout?.xaxis?.title as { text?: string } | undefined)?.text
  const y = (props.layout?.yaxis?.title as { text?: string } | undefined)?.text
  if (x || y) return `${y || 'Value'} vs ${x || 'Observation'}`
  return 'Interactive Plot'
}

export default function ExportablePlot(props: ExportablePlotProps) {
  const scope = useReportAssetScope()
  const {
    reportLabel, reportGroup, reportKey, plotId: _plotId,
    plotMarkup: providedMarkup, onPlotMarkupChange: providedMarkupChange,
    annotationMode, ...plotProps
  } = props
  const title = props.layout?.title
  const titleText = typeof title === 'string'
    ? title
    : (title as { text?: string } | undefined)?.text
  const label = htmlToPlainText(reportLabel || titleText || fallbackPlotLabel(props))
  const identity = useMemo(
    () => semanticPlotId(props, label),
    // Plot identity is deliberately semantic, not data-dependent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.plotId, reportKey, props.exportName, label],
  )
  const [storedMarkup, setStoredMarkup] = usePlotMarkup(scope?.module ?? 'unscoped', identity)
  const persistentKey = makePlotMarkupKey(scope?.module ?? 'unscoped', identity)
  const markup = providedMarkup == null
    ? storedMarkup : sanitizePlotMarkup(providedMarkup)
  const setMarkup = providedMarkupChange ?? setStoredMarkup
  const mergedLayout = useMemo(
    () => mergePlotMarkup(props.layout, markup),
    [props.layout, markup],
  )
  const compact = props.config?.displayModeBar === false || props.config?.staticPlot === true
  const effectiveAnnotationMode = annotationMode
    ?? (compact ? 'fullscreen-only' : 'enabled')
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    if (!fullscreen) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false)
    }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [fullscreen])

  useEffect(() => {
    if (!scope || scope.module === 'dashboard' || scope.module === 'reportBuilder' || !label) return
    registerRuntimePlotAsset({
      key: reportKey ?? persistentKey,
      module: scope.module,
      moduleLabel: scope.moduleLabel,
      group: reportGroup || getActivePlotGroup(scope.module) || 'Generated Plots',
      label,
      plotData: props.data as unknown[],
      plotLayout: mergedLayout,
    })
  }, [scope, label, reportGroup, reportKey, persistentKey, props.data, mergedLayout])

  return (
    <>
    <div className="group relative" style={{
      width: props.style?.width ?? '100%',
      height: props.style?.height,
      minHeight: props.style?.minHeight,
    }}>
    <Suspense
      fallback={
        <div
          style={props.style}
          className="flex items-center justify-center text-xs text-gray-300"
          aria-label="Loading chart"
        >
          Loading chart…
        </div>
      }
    >
      <InnerPlot
        {...plotProps}
        userMarkup={markup}
        onUserMarkupChange={setMarkup}
        annotationEnabled={effectiveAnnotationMode === 'enabled'}
        onRequestFullscreen={() => setFullscreen(true)}
      />
      {compact && effectiveAnnotationMode !== 'disabled' && (
        <button type="button" onClick={() => setFullscreen(true)}
          title="Open full-screen interactive plot"
          aria-label="Open full-screen interactive plot"
          className="group absolute right-2 top-2 z-10 rounded border border-gray-200 bg-white/90 px-2 py-1 text-[10px] font-medium text-gray-500 opacity-0 shadow-sm transition-opacity hover:text-blue-700 group-hover:opacity-100 focus:opacity-100">
          Full screen
        </button>
      )}
    </Suspense>
    </div>
    {fullscreen && (
      <div className="fixed inset-0 z-[100] flex flex-col bg-white" role="dialog" aria-modal="true"
        aria-label={`${label || 'Plot'} full-screen viewer`}>
        <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-2">
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-800">{label || 'Interactive plot'}</p>
          <p className="hidden text-[10px] text-gray-400 sm:block">Wheel to zoom · drag legend · Annotate to add markup</p>
          <button type="button" onClick={() => setFullscreen(false)}
            className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50">
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 p-2">
          <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-gray-400">Loading plot…</div>}>
            <InnerPlot
              {...plotProps}
              layout={{ ...(plotProps.layout ?? {}), autosize: true }}
              config={{ ...(plotProps.config ?? {}), staticPlot: false, displayModeBar: true, responsive: true }}
              style={{ width: '100%', height: '100%' }}
              useResizeHandler
              userMarkup={markup}
              onUserMarkupChange={setMarkup}
              annotationEnabled={effectiveAnnotationMode !== 'disabled'}
            />
          </Suspense>
        </div>
      </div>
    )}
    </>
  )
}
