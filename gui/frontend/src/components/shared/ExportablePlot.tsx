import createPlotlyComponent from 'react-plotly.js/factory'
// @ts-expect-error -- plotly.js-dist-min ships no TS declarations
import Plotly from 'plotly.js-dist-min'

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
  const Icons = (Plotly as any).Icons
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cfg: any = { ...(config ?? {}) }

  if (cfg.displayModeBar !== false) {
    cfg.toImageButtonOptions = {
      format: 'png', filename: name, scale: 2, ...(cfg.toImageButtonOptions ?? {}),
    }
    cfg.modeBarButtonsToAdd = [
      ...(cfg.modeBarButtonsToAdd ?? []),
      {
        name: 'Download as SVG',
        title: 'Download as SVG (vector)',
        icon: Icons.disk,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        click: (gd: any) => (Plotly as any).downloadImage(gd, {
          format: 'svg', filename: name,
          width: gd?._fullLayout?.width, height: gd?._fullLayout?.height,
        }),
      },
      {
        name: 'Download interactive HTML',
        title: 'Download interactive HTML',
        icon: Icons.newplotlylogo ?? Icons.disk,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        click: (gd: any) => downloadHTML(gd, name),
      },
    ]
  }

  return <InternalPlot {...rest} config={cfg} />
}
