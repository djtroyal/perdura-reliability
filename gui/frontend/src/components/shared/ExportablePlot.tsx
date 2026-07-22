import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Camera } from 'lucide-react'
import { registerRuntimePlotAsset } from '../../store/runtimePlotAssets'
import {
  getActiveAnalysisId, getActivePlotGroup, makePlotMarkupKey, usePlotMarkup,
} from '../../store/project'
import {
  cleanPlotIdentity,
  mergePlotMarkup,
  sanitizePlotMarkup,
  type PlotMarkup,
} from '../../store/plotMarkup'
import { htmlToPlainText } from './htmlSafety'
import { useReportAssetScope } from './ReportAssetScope'
import { makeAssetKey } from '../../store/reportAssets'
import { BookmarkAssetButton } from './BookmarkControls'
import { resolveAssetDescriptor } from '../../store/bookmarks'
import { createPlotSnapshot, storePlotSnapshot } from '../../store/plotSnapshots'
import { toast } from './toast'
import { requestDynamicImportRecovery } from './dynamicImportRecovery'

// Plotly (the app's largest chunk) is deliberately NOT imported here. This
// wrapper lazy-loads the real component so the plotly-*.js chunk is fetched
// only when a chart actually mounts — modules render their data-entry UI on
// first paint without paying for it.
// The cast erases the inner component's stricter react-plotly prop type
// (which requires `layout`) so this wrapper can keep the app-wide looser
// contract where layout/config are optional.
interface CapturedPlotFigure { plotData: unknown[]; plotLayout: unknown }
interface InnerPlotExtras {
  onCaptureSnapshot?: (figure: CapturedPlotFigure) => void | Promise<void>
  snapshotRequest?: number
}
const InnerPlot = lazy(async () => {
  try {
    return await import('./ExportablePlotInner')
  } catch (error) {
    if (requestDynamicImportRecovery(error)) {
      // Keep Suspense's loading state visible until the guarded reload begins.
      return await new Promise<never>(() => undefined)
    }
    throw error
  }
}) as unknown as
  React.ComponentType<ExportablePlotProps & InnerPlotExtras>

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
  const assetGroup = reportGroup || (scope ? getActivePlotGroup(scope.module) : null) || 'Generated Plots'
  const bookmarkEligible = !!scope && scope.module !== 'dashboard' && scope.module !== 'reportBuilder'
  const sourceModule = scope?.module ?? 'unscoped'
  const sourceModuleLabel = scope?.moduleLabel ?? 'Analysis'
  const sourceAnalysisId = getActiveAnalysisId(sourceModule)
  const sourceAssetKey = makeAssetKey(
    sourceModule, sourceModuleLabel, sourceAnalysisId, 'plot', label,
  )
  const assetKey = bookmarkEligible ? sourceAssetKey : ''
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
  const bookmarkAsset = useMemo(() => resolveAssetDescriptor({
    id: assetKey,
    module: scope?.module ?? 'unscoped',
    moduleLabel: scope?.moduleLabel ?? 'Analysis',
    group: assetGroup,
    label,
    type: 'plot',
    getData: () => ({ plotData: props.data as unknown[], plotLayout: mergedLayout }),
  }), [assetGroup, assetKey, label, mergedLayout, props.data, scope?.module, scope?.moduleLabel])
  const compact = props.config?.displayModeBar === false || props.config?.staticPlot === true
  const effectiveAnnotationMode = annotationMode
    ?? (compact ? 'fullscreen-only' : 'enabled')
  const hiddenInteractiveControls = props.config?.displayModeBar === false
    && props.config?.staticPlot !== true
  const [fullscreen, setFullscreen] = useState(false)
  const [snapshotRequest, setSnapshotRequest] = useState(0)
  const [fullscreenSnapshotRequest, setFullscreenSnapshotRequest] = useState(0)
  const captureSnapshot = useCallback(async (figure: CapturedPlotFigure) => {
    try {
      const snapshot = await createPlotSnapshot({
        name: label,
        plotData: figure.plotData,
        plotLayout: figure.plotLayout,
        source: {
          module: sourceModule,
          moduleLabel: sourceModuleLabel,
          analysisId: sourceAnalysisId,
          analysisName: assetGroup,
          plotId: identity,
          assetKey: sourceAssetKey,
        },
      })
      storePlotSnapshot(snapshot)
      toast.success(`Saved “${snapshot.name}” to Report Builder snapshots.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The plot could not be serialized.'
      toast.error(`Plot snapshot failed: ${message}`)
    }
  }, [assetGroup, identity, label, sourceAnalysisId, sourceAssetKey, sourceModule, sourceModuleLabel])

  useEffect(() => {
    if (!fullscreen) {
      if (fullscreenSnapshotRequest !== 0) setFullscreenSnapshotRequest(0)
      return
    }
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false)
    }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [fullscreen, fullscreenSnapshotRequest])

  useEffect(() => {
    if (!scope || scope.module === 'dashboard' || scope.module === 'reportBuilder' || !label) return
    registerRuntimePlotAsset({
      key: reportKey ?? persistentKey,
      module: scope.module,
      moduleLabel: scope.moduleLabel,
      group: assetGroup,
      label,
      plotData: props.data as unknown[],
      plotLayout: mergedLayout,
    })
  }, [scope, label, assetGroup, reportKey, persistentKey, props.data, mergedLayout])

  return (
    <>
    <div className="group relative" data-report-asset-key={bookmarkAsset.id || undefined} style={{
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
        provenanceModuleKey={scope?.module}
        userMarkup={markup}
        onUserMarkupChange={setMarkup}
        annotationEnabled={effectiveAnnotationMode === 'enabled'}
        onRequestFullscreen={() => setFullscreen(true)}
        onCaptureSnapshot={captureSnapshot}
        snapshotRequest={snapshotRequest}
      />
      <div data-perdura-plot-tools data-export-ignore
        className="absolute left-2 top-2 z-10 flex items-center gap-1 rounded bg-white/90 p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {bookmarkEligible && scope && assetKey && (
          <BookmarkAssetButton asset={bookmarkAsset} />
        )}
        <button type="button" onClick={() => setSnapshotRequest(value => value + 1)}
          title="Save snapshot to Report Builder" aria-label={`Save snapshot of ${label} to Report Builder`}
          className="inline-flex items-center rounded p-1 text-gray-400 transition-colors hover:bg-violet-50 hover:text-violet-700">
          <Camera size={13} />
        </button>
      </div>
      {compact && effectiveAnnotationMode !== 'disabled' && (
        <button type="button" onClick={() => setFullscreen(true)}
          title="Open full-screen interactive plot"
          aria-label="Open full-screen interactive plot"
          className={`group absolute right-2 ${hiddenInteractiveControls ? 'top-10' : 'top-2'} z-10 rounded border border-gray-200 bg-white/90 px-2 py-1 text-[10px] font-medium text-gray-500 opacity-0 shadow-sm transition-opacity hover:text-blue-700 group-hover:opacity-100 focus:opacity-100`}>
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
          <button type="button" onClick={() => setFullscreenSnapshotRequest(value => value + 1)}
            className="inline-flex items-center gap-1.5 rounded border border-violet-200 px-3 py-1 text-xs text-violet-700 hover:bg-violet-50"
            title="Save the current full-screen view to Report Builder">
            <Camera size={12} /> Snapshot
          </button>
          <button type="button" onClick={() => setFullscreen(false)}
            className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50">
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 p-2">
          <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-gray-400">Loading plot…</div>}>
            <InnerPlot
              {...plotProps}
              provenanceModuleKey={scope?.module}
              layout={{ ...(plotProps.layout ?? {}), autosize: true }}
              config={{ ...(plotProps.config ?? {}), staticPlot: false, displayModeBar: true, responsive: true }}
              style={{ width: '100%', height: '100%' }}
              useResizeHandler
              userMarkup={markup}
              onUserMarkupChange={setMarkup}
              annotationEnabled={effectiveAnnotationMode !== 'disabled'}
              onCaptureSnapshot={captureSnapshot}
              snapshotRequest={fullscreenSnapshotRequest}
            />
          </Suspense>
        </div>
      </div>
    )}
    </>
  )
}
