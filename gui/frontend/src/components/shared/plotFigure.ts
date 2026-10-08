import { PLOTLY_VERSION } from './plotRuntime'

export interface SerializedPlotFigure {
  data: unknown[]
  layout: unknown
  frames?: unknown[]
}

/** Capture the reviewed live figure, stripping Plotly's private runtime state.
 * Keep this boundary shared by snapshots and JSON downloads: React props do
 * not contain the user's current zoom, legend position or trace visibility. */
export function capturePlotFigure(runtime: unknown, graph: unknown): SerializedPlotFigure {
  const graphJson = (runtime as {
    Plots?: { graphJson?: (graph: unknown, dataOnly: boolean, output: 'object') => unknown }
  }).Plots?.graphJson
  if (!graphJson) throw new Error('Plot serialization is unavailable.')
  // Plotly 4 removed the old "keepdata" mode argument.
  const figure = graphJson(graph, false, 'object') as Partial<SerializedPlotFigure> | null
  if (!figure || !Array.isArray(figure.data)) {
    throw new Error('The chart did not provide serializable trace data.')
  }
  return {
    data: figure.data,
    layout: figure.layout ?? {},
    ...(Array.isArray(figure.frames) ? { frames: figure.frames } : {}),
  }
}

export function plotFigureJson(figure: SerializedPlotFigure): string {
  return JSON.stringify({ ...figure, version: PLOTLY_VERSION }, null, 2) + '\n'
}
