import { lazy, Suspense } from 'react'

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
  [key: string]: unknown
}

export default function ExportablePlot(props: ExportablePlotProps) {
  return (
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
      <InnerPlot {...props} />
    </Suspense>
  )
}
