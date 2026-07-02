import Plot from './ExportablePlot'

export interface ConvergenceData {
  n: number[]
  mean: number[]
  ci_lower: number[]
  ci_upper: number[]
}

/**
 * Monte-Carlo convergence diagnostic: the running mean of the estimate vs the
 * number of samples, with its 95% confidence band and the final estimate as a
 * dashed reference. A flat mean inside a narrowing band means the sample count
 * was sufficient; drift or a wide band means run more samples.
 */
export default function ConvergencePlot({ data, label, height = 260 }: {
  data: ConvergenceData | null | undefined
  label?: string
  height?: number
}) {
  if (!data || !data.n?.length) return null
  const final = data.mean[data.mean.length - 1]
  return (
    <div>
      <div className="bg-white border border-gray-200 rounded-lg" style={{ height }}>
        <Plot
          data={[
            // Band drawn as lower bound + fill-to-upper.
            { x: data.n, y: data.ci_lower, mode: 'lines', line: { width: 0 }, hoverinfo: 'skip', showlegend: false } as Plotly.Data,
            { x: data.n, y: data.ci_upper, mode: 'lines', line: { width: 0 }, fill: 'tonexty', fillcolor: 'rgba(59,130,246,0.12)', name: '95% band', hoverinfo: 'skip' } as Plotly.Data,
            { x: data.n, y: data.mean, mode: 'lines', name: 'Running mean', line: { color: '#3b82f6', width: 2 } } as Plotly.Data,
            { x: [data.n[0], data.n[data.n.length - 1]], y: [final, final], mode: 'lines', name: 'Final estimate', line: { color: '#6b7280', width: 1, dash: 'dash' } } as Plotly.Data,
          ]}
          layout={{
            title: { text: `Convergence${label ? ` — ${label}` : ''}`, font: { size: 12 } },
            xaxis: { title: { text: 'Samples (n)' }, gridcolor: '#e5e7eb' },
            yaxis: { title: { text: label ?? 'Estimate' }, gridcolor: '#e5e7eb' },
            margin: { t: 34, r: 16, b: 42, l: 60 }, paper_bgcolor: 'white', plot_bgcolor: 'white',
            legend: { orientation: 'h', y: -0.32, font: { size: 9 } },
          } as Partial<Plotly.Layout>}
          config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler
        />
      </div>
      <p className="text-[10px] text-gray-400 mt-1">
        Running mean with a 95% confidence band. A flat mean inside a narrowing band indicates the
        sample count is sufficient; drift or a wide band suggests running more samples.
      </p>
    </div>
  )
}
