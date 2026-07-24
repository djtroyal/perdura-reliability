import { Camera } from 'lucide-react'
import { useMemo, useState } from 'react'

import { resolveAssetDescriptor } from '../../store/bookmarks'
import {
  getActiveAnalysisId,
  getActivePlotGroup,
  NAV_MAP,
} from '../../store/project'
import {
  createPlotSnapshot,
  storePlotSnapshot,
} from '../../store/plotSnapshots'
import { makeAssetKey, type AssetDescriptor } from '../../store/reportAssets'
import { BookmarkAssetButton } from './BookmarkControls'
import {
  captureDiagramPng,
  type DiagramExportPreparation,
} from './exportDiagram'
import { useReportAssetScope } from './ReportAssetScope'
import { toast } from './toast'

export default function CanvasAssetControls({
  getElement,
  prepareCapture,
  label,
  group,
  analysisId,
  analysisName,
  targetView,
  className = '',
}: {
  getElement: () => HTMLElement|null
  prepareCapture?: DiagramExportPreparation
  label: string
  group?: string
  analysisId?: string
  analysisName?: string
  targetView?: string
  className?: string
}) {
  const scope = useReportAssetScope()
  const [busy, setBusy] = useState(false)
  const moduleKey = scope?.module ?? 'unscoped'
  const moduleLabel = scope?.moduleLabel ?? 'Analysis'
  const resolvedAnalysisId =
    analysisId ?? getActiveAnalysisId(moduleKey)
  const resolvedAnalysisName =
    analysisName ?? group ?? getActivePlotGroup(moduleKey) ?? 'Default'
  const resolvedGroup = group ?? resolvedAnalysisName
  const asset = useMemo<AssetDescriptor>(() => {
    const id = makeAssetKey(
      moduleKey,
      moduleLabel,
      resolvedAnalysisId,
      'plot',
      label,
    )
    const location = NAV_MAP[moduleKey] ?? { tab: 'dashboard' }
    return resolveAssetDescriptor({
      id,
      module: moduleKey,
      moduleLabel,
      group: resolvedGroup,
      label,
      type: 'plot',
      targetView,
      source: {
        module: moduleKey,
        tab: location.tab,
        sub: location.sub,
        analysisId: resolvedAnalysisId,
        view: targetView,
        analysisName: resolvedAnalysisName,
        assetKey: id,
      },
      getData: () => ({ plotData: [], plotLayout: {} }),
    })
  }, [
    label,
    moduleKey,
    moduleLabel,
    resolvedAnalysisId,
    resolvedAnalysisName,
    resolvedGroup,
    targetView,
  ])

  const capture = async () => {
    if (busy) return
    setBusy(true)
    try {
      const image = await captureDiagramPng(getElement(), prepareCapture)
      const snapshot = await createPlotSnapshot({
        name: label,
        plotData: [],
        plotLayout: {
          title: { text: label, font: { size: 14 } },
          margin: { l: 8, r: 8, t: 38, b: 8 },
          xaxis: { visible: false, fixedrange: true, range: [0, 1] },
          yaxis: { visible: false, fixedrange: true, range: [0, 1] },
          images: [{
            source: image.dataUrl,
            xref: 'paper',
            yref: 'paper',
            x: 0,
            y: 1,
            sizex: 1,
            sizey: 1,
            sizing: 'contain',
            xanchor: 'left',
            yanchor: 'top',
            layer: 'above',
          }],
          meta: {
            kind: 'perdura-canvas-snapshot',
            sourceWidth: image.width,
            sourceHeight: image.height,
          },
          showlegend: false,
          paper_bgcolor: '#ffffff',
          plot_bgcolor: '#ffffff',
        },
        source: {
          module: moduleKey,
          moduleLabel,
          analysisId: resolvedAnalysisId,
          analysisName: resolvedAnalysisName,
          plotId: `canvas:${label}`,
          assetKey: asset.id,
        },
      })
      storePlotSnapshot(snapshot)
      toast.success(`Saved “${label}” to Report Builder snapshots.`)
    } catch (error) {
      const message = error instanceof Error
        ? error.message : 'The canvas could not be captured.'
      toast.error(`Canvas snapshot failed: ${message}`)
    } finally {
      setBusy(false)
    }
  }

  if (!scope || moduleKey === 'dashboard' || moduleKey === 'reportBuilder') {
    return null
  }
  return <>
    <BookmarkAssetButton asset={asset}
      className={`h-8 w-8 justify-center border border-slate-200 bg-white ${className}`} />
    <button type="button" onClick={() => void capture()} disabled={busy}
      title="Save the current canvas view to Report Builder snapshots"
      aria-label={`Save snapshot of ${label} to Report Builder`}
      className={`inline-flex h-8 w-8 items-center justify-center rounded border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-violet-50 hover:text-violet-700 disabled:opacity-50 ${className}`}>
      <Camera size={13} />
    </button>
  </>
}
