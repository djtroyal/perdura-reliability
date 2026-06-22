import createPlotlyComponent from 'react-plotly.js/factory'
// @ts-expect-error -- plotly.js-dist-min ships no TS declarations
import Plotly from 'plotly.js-dist-min'
import { addCapturedAsset } from '../../store/reportAssets'

const InternalPlot = createPlotlyComponent(Plotly)
type PlotProps = React.ComponentProps<typeof InternalPlot>

interface ExportablePlotProps extends PlotProps {
  /** Base filename for exports; defaults to the plot title (sanitized). */
  exportName?: string
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
const ICON_REPORT = {
  width: 1000, height: 1000,
  path: 'M250 80 H600 L750 230 V880 Q750 920 710 920 H250 Q210 920 210 880 V120 Q210 80 250 80 Z '
      + 'M580 100 V250 H730 Z M300 380 H660 V420 H300 Z M300 500 H660 V540 H300 Z M300 620 H520 V660 H300 Z',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function showCaptureToast(gd: any) {
  const container = (gd as HTMLElement)?.closest?.('.js-plotly-plot') as HTMLElement | null
  if (!container) return
  const toast = document.createElement('div')
  toast.textContent = '✓ Added to Report'
  toast.style.cssText = 'position:absolute;top:10px;left:50%;transform:translateX(-50%);background:#059669;color:white;padding:6px 16px;border-radius:8px;font-size:12px;font-weight:600;z-index:9999;opacity:0;transition:opacity 0.3s;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,0.15)'
  container.style.position = container.style.position || 'relative'
  container.appendChild(toast)
  requestAnimationFrame(() => { toast.style.opacity = '1' })
  setTimeout(() => { toast.style.opacity = '0' }, 1500)
  setTimeout(() => toast.remove(), 2000)
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
  const name = deriveName(rest.layout, exportName)
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
      {
        name: 'Add to Report',
        title: 'Send this plot to the Report Builder',
        icon: ICON_REPORT,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        click: (gd: any) => {
          if (!gd?.data) return
          addCapturedAsset({
            label: name || 'Plot',
            type: 'plot',
            plotData: JSON.parse(JSON.stringify(gd.data)),
            plotLayout: JSON.parse(JSON.stringify(gd.layout)),
          })
          showCaptureToast(gd)
        },
      },
    ]
  }

  return <InternalPlot {...rest} config={cfg} />
}
