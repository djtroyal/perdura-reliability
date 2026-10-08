import type { Config } from 'plotly.js'

// Read from the installed package at build time, without loading the chart
// runtime in routes that only need to prepare an exported document.
export const PLOTLY_VERSION = __PLOTLY_VERSION__
export const PLOTLY_CDN_URL = `https://cdn.plot.ly/plotly-${PLOTLY_VERSION}.min.js`

export const INTERACTIVE_PLOT_EXPORT_CONFIG = {
  responsive: true,
  scrollZoom: true,
  displaylogo: false,
  showSendToCloud: false,
  doubleClickDelay: 300,
  edits: { legendPosition: true, annotationPosition: true, annotationText: true, shapePosition: true },
  modeBarButtonsToAdd: ['drawline', 'drawrect', 'drawcircle', 'eraseshape'],
} satisfies Partial<Config>
