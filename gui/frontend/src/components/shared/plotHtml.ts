import { escapeHtmlText, jsonForInlineScript } from './htmlSafety'

// Keep aligned with the custom runtime registrations in plotly.ts. The full
// CDN runtime used by exported documents must not enable extra trace families.
export const EXPORTED_PLOT_TRACE_TYPES = [
  'scatter', 'bar', 'pie', 'box', 'violin', 'histogram', 'heatmap', 'contour',
  'scatter3d', 'sankey',
] as const

const supportedTypes = new Set<string>(EXPORTED_PLOT_TRACE_TYPES)

/** Serialize the supported figure unchanged, rejecting unsupported content. */
export function buildInteractivePlotHtml(data: unknown, layout: unknown, title: string): string {
  if (!Array.isArray(data)) throw new TypeError('Interactive HTML export requires a trace array.')
  for (const trace of data) {
    const type = trace && typeof trace === 'object' ? trace.type ?? 'scatter' : null
    if (typeof type !== 'string' || !supportedTypes.has(type)) {
      throw new Error(`Interactive HTML export does not support trace type ${String(type)}.`)
    }
  }
  if (layout && typeof layout === 'object'
      && Object.keys(layout).some(key => /^(?:map|mapbox)\d*$/.test(key))) {
    throw new Error('Interactive HTML export does not support map layouts.')
  }
  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8">',
    `<title>${escapeHtmlText(title)}</title>`,
    '<script src="https://cdn.plot.ly/plotly-3.7.0.min.js" charset="utf-8"></' + 'script>',
    '<style>html,body{margin:0;height:100%}#p{width:100vw;height:100vh}</style>',
    '</head><body><div id="p"></div><script>',
    `Plotly.newPlot("p",${jsonForInlineScript(data)},${jsonForInlineScript(layout)},${jsonForInlineScript({
      responsive: true,
      scrollZoom: true,
      displaylogo: false,
      edits: { legendPosition: true, annotationPosition: true, annotationText: true, shapePosition: true },
      modeBarButtonsToAdd: ['drawline', 'drawrect', 'drawcircle', 'eraseshape'],
    })});`,
    '</' + 'script></body></html>',
  ].join('\n')
}
