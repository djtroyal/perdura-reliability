import Plot from 'react-plotly.js'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlotlyLayout = any
import {
  FitRegressionResponse, LinearResult, LogisticResult, PolynomialResult,
} from '../../api/regression'
import { FitResponse, ClassMetrics, RegMetrics } from '../../api/predictive'

const PLOT_BG = { paper_bgcolor: 'white', plot_bgcolor: 'white' }

export function fmt(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—'
  if (v !== 0 && (Math.abs(v) >= 1e4 || Math.abs(v) < 1e-3)) return v.toExponential(3)
  return v.toFixed(4)
}
export function pct(v: number | null | undefined): string {
  return v == null ? '—' : (v * 100).toFixed(1) + '%'
}

export function Card({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${accent ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200'}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-semibold ${accent ? 'text-blue-700' : 'text-gray-900'}`}>{value}</p>
    </div>
  )
}

function hasInference(r: FitRegressionResponse): r is LinearResult | PolynomialResult {
  return (r as LinearResult).p_values !== undefined && (r as LogisticResult).odds_ratios === undefined
}

// ---------------------------------------------------------------------------
// Classical regression detail (full inference)
// ---------------------------------------------------------------------------

export function RegressionDetail({ fit }: { fit: FitRegressionResponse }) {
  const isLogistic = fit.model === 'logistic'
  const isPoly = fit.model === 'polynomial'
  const inf = hasInference(fit) ? fit : null
  const logit = isLogistic ? (fit as LogisticResult) : null

  const names = fit.feature_names
  const coefs = fit.coefficients

  return (
    <div className="flex flex-col gap-4">
      {/* Metric cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {isLogistic ? (
          <>
            <Card label="Accuracy" value={pct(logit!.accuracy)} accent />
            <Card label="ROC AUC" value={fmt(logit!.roc?.auc)} />
            <Card label="McFadden R²" value={fmt(logit!.mcfadden_r2)} />
            <Card label="Log-likelihood" value={fmt(logit!.log_likelihood)} />
          </>
        ) : (
          <>
            <Card label="R²" value={fmt(fit.r2)} accent />
            {inf && <Card label="Adj. R²" value={fmt(inf.adj_r2)} />}
            <Card label="RMSE" value={fmt(fit.rmse)} />
            {inf?.f_stat != null && <Card label="F-stat (p)" value={`${fmt(inf.f_stat)} (${fmt(inf.f_pvalue)})`} />}
            {'alpha' in fit && <Card label="alpha" value={fmt((fit as { alpha: number }).alpha)} />}
          </>
        )}
      </div>

      {/* Coefficient table */}
      <div>
        <h4 className="text-sm font-semibold text-gray-800 mb-2">Coefficients</h4>
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-200 text-gray-600">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">Term</th>
                <th className="px-3 py-1.5 text-right font-medium">Coef.</th>
                {logit && <th className="px-3 py-1.5 text-right font-medium">Odds ratio</th>}
                {(inf || logit) && <th className="px-3 py-1.5 text-right font-medium">Std. err.</th>}
                {inf && <th className="px-3 py-1.5 text-right font-medium">t</th>}
                {logit && <th className="px-3 py-1.5 text-right font-medium">z</th>}
                {(inf || logit) && <th className="px-3 py-1.5 text-right font-medium">p-value</th>}
                {(inf || logit) && <th className="px-3 py-1.5 text-right font-medium">95% CI</th>}
              </tr>
            </thead>
            <tbody>
              {fit.intercept != null && (
                <tr className="border-b border-gray-100">
                  <td className="px-3 py-1.5 text-gray-800 italic">Intercept</td>
                  <td className="px-3 py-1.5 text-right font-mono">{fmt(fit.intercept)}</td>
                  {logit && <td className="px-3 py-1.5 text-right font-mono">—</td>}
                  {(inf || logit) && <td className="px-3 py-1.5 text-right font-mono">—</td>}
                  {inf && <td className="px-3 py-1.5 text-right font-mono">—</td>}
                  {logit && <td className="px-3 py-1.5 text-right font-mono">—</td>}
                  {(inf || logit) && <td className="px-3 py-1.5 text-right font-mono">—</td>}
                  {(inf || logit) && <td className="px-3 py-1.5 text-right font-mono">—</td>}
                </tr>
              )}
              {names.map((nm, i) => {
                const ci = inf?.conf_int?.[i] ?? logit?.conf_int?.[i]
                const p = inf?.p_values?.[i] ?? logit?.p_values?.[i]
                const se = inf?.std_errors?.[i] ?? logit?.std_errors?.[i]
                const stat = inf?.t_values?.[i] ?? logit?.z_values?.[i]
                const sig = p != null && p < 0.05
                return (
                  <tr key={nm} className="border-b border-gray-100 last:border-0">
                    <td className="px-3 py-1.5 text-gray-800">{nm}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{fmt(coefs[i])}</td>
                    {logit && <td className="px-3 py-1.5 text-right font-mono">{fmt(logit.odds_ratios?.[i])}</td>}
                    {(inf || logit) && <td className="px-3 py-1.5 text-right font-mono">{fmt(se)}</td>}
                    {inf && <td className="px-3 py-1.5 text-right font-mono">{fmt(stat)}</td>}
                    {logit && <td className="px-3 py-1.5 text-right font-mono">{fmt(stat)}</td>}
                    {(inf || logit) && (
                      <td className={`px-3 py-1.5 text-right font-mono ${sig ? 'text-green-700 font-semibold' : 'text-gray-500'}`}>
                        {fmt(p)}{sig ? ' *' : ''}
                      </td>
                    )}
                    {(inf || logit) && (
                      <td className="px-3 py-1.5 text-right font-mono text-gray-500">
                        {ci ? `[${fmt(ci[0])}, ${fmt(ci[1])}]` : '—'}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {(inf || logit) && <p className="text-[10px] text-gray-400 mt-1">* p &lt; 0.05</p>}
      </div>

      {/* Plots */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {isLogistic && logit ? (
          <>
            <PlotBox title="ROC Curve">
              <Plot
                data={[
                  { x: logit.roc.fpr, y: logit.roc.tpr, mode: 'lines', name: `AUC=${fmt(logit.roc.auc)}`, line: { color: '#3b82f6', width: 2 } } as Plotly.Data,
                  { x: [0, 1], y: [0, 1], mode: 'lines', name: 'Chance', line: { color: '#9ca3af', dash: 'dash' } } as Plotly.Data,
                ]}
                layout={{ margin: { t: 30, r: 20, b: 45, l: 50 }, xaxis: { title: { text: 'FPR' }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'TPR' }, gridcolor: '#e5e7eb' }, legend: { x: 0.5, y: 0.1, font: { size: 10 } }, ...PLOT_BG } as PlotlyLayout}
                config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler />
            </PlotBox>
            <ConfMatrix z={logit.confusion_matrix} labels={['0', '1']} />
          </>
        ) : isPoly ? (
          <PolyFitPlot fit={fit as PolynomialResult} />
        ) : (
          <ActualVsFitted fit={fit} />
        )}
        {!isLogistic && <ResidualPlot fit={fit} />}
      </div>
    </div>
  )
}

function PlotBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 320 }}>
      <div className="text-xs font-medium text-gray-600 px-3 pt-2">{title}</div>
      <div style={{ height: 'calc(100% - 24px)' }}>{children}</div>
    </div>
  )
}

function ActualVsFitted({ fit }: { fit: FitRegressionResponse }) {
  const actual = fit.fitted.map((f, i) => f + fit.residuals[i])
  const lo = Math.min(...actual, ...fit.fitted)
  const hi = Math.max(...actual, ...fit.fitted)
  return (
    <PlotBox title="Actual vs Fitted">
      <Plot
        data={[
          { x: actual, y: fit.fitted, mode: 'markers', name: 'Points', marker: { color: '#3b82f6', size: 7 } } as Plotly.Data,
          { x: [lo, hi], y: [lo, hi], mode: 'lines', name: 'Ideal', line: { color: '#16a34a', dash: 'dash' } } as Plotly.Data,
        ]}
        layout={{ margin: { t: 10, r: 20, b: 45, l: 55 }, xaxis: { title: { text: 'Actual' }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'Fitted' }, gridcolor: '#e5e7eb' }, showlegend: false, ...PLOT_BG } as PlotlyLayout}
        config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler />
    </PlotBox>
  )
}

function ResidualPlot({ fit }: { fit: FitRegressionResponse }) {
  return (
    <PlotBox title="Residuals vs Fitted">
      <Plot
        data={[
          { x: fit.fitted, y: fit.residuals, mode: 'markers', marker: { color: '#8b5cf6', size: 7 } } as Plotly.Data,
          { x: [Math.min(...fit.fitted), Math.max(...fit.fitted)], y: [0, 0], mode: 'lines', line: { color: '#9ca3af', dash: 'dash' } } as Plotly.Data,
        ]}
        layout={{ margin: { t: 10, r: 20, b: 45, l: 55 }, xaxis: { title: { text: 'Fitted' }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'Residual' }, gridcolor: '#e5e7eb' }, showlegend: false, ...PLOT_BG } as PlotlyLayout}
        config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler />
    </PlotBox>
  )
}

function PolyFitPlot({ fit }: { fit: PolynomialResult }) {
  return (
    <PlotBox title={`Polynomial fit (degree ${fit.degree})`}>
      <Plot
        data={[
          { x: fit.x_data, y: fit.y_data, mode: 'markers', name: 'Data', marker: { color: '#3b82f6', size: 7 } } as Plotly.Data,
          { x: fit.x_grid, y: fit.y_grid, mode: 'lines', name: 'Fit', line: { color: '#ef4444', width: 2 } } as Plotly.Data,
        ]}
        layout={{ margin: { t: 10, r: 20, b: 45, l: 55 }, xaxis: { title: { text: 'x' }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'y' }, gridcolor: '#e5e7eb' }, showlegend: false, ...PLOT_BG } as PlotlyLayout}
        config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler />
    </PlotBox>
  )
}

// ---------------------------------------------------------------------------
// ML / NN detail
// ---------------------------------------------------------------------------

const isClass = (m: ClassMetrics | RegMetrics): m is ClassMetrics =>
  (m as ClassMetrics).accuracy !== undefined

export function MLDetail({ fit }: { fit: FitResponse }) {
  const m = fit.metrics
  const classification = isClass(m)
  const fi = fit.feature_importances
    ? Object.entries(fit.feature_importances).sort((a, b) => b[1] - a[1]) : []

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {classification ? (
          <>
            <Card label="Accuracy" value={pct((m as ClassMetrics).accuracy)} accent />
            <Card label="Precision" value={pct((m as ClassMetrics).precision)} />
            <Card label="Recall" value={pct((m as ClassMetrics).recall)} />
            <Card label="F1" value={pct((m as ClassMetrics).f1)} />
            {(m as ClassMetrics).roc_auc != null && <Card label="ROC AUC" value={fmt((m as ClassMetrics).roc_auc!)} />}
          </>
        ) : (
          <>
            <Card label="R²" value={fmt((m as RegMetrics).r2)} accent />
            <Card label="RMSE" value={fmt((m as RegMetrics).rmse)} />
            <Card label="MAE" value={fmt((m as RegMetrics).mae)} />
          </>
        )}
      </div>
      <p className="text-[11px] text-gray-400">Train {fit.n_train} · Test {fit.n_test}</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {classification ? (
          <ConfMatrix z={(m as ClassMetrics).confusion_matrix} labels={(m as ClassMetrics).classes} />
        ) : (
          <MLActualVsPred fit={fit} />
        )}
        {fi.length > 0 && (
          <PlotBox title="Feature Importances">
            <Plot
              data={[{ x: fi.map(f => f[1]), y: fi.map(f => f[0]), type: 'bar', orientation: 'h', marker: { color: '#3b82f6' } } as Plotly.Data]}
              layout={{ margin: { t: 10, r: 20, b: 40, l: 90 }, xaxis: { gridcolor: '#e5e7eb' }, ...PLOT_BG } as PlotlyLayout}
              config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler />
          </PlotBox>
        )}
      </div>

      {fit.tree_text && (
        <div>
          <h4 className="text-sm font-semibold text-gray-800 mb-2">Tree Structure</h4>
          <pre className="text-[11px] bg-gray-50 border border-gray-200 rounded p-3 overflow-x-auto font-mono">{fit.tree_text}</pre>
        </div>
      )}
    </div>
  )
}

function MLActualVsPred({ fit }: { fit: FitResponse }) {
  const actual = fit.actual.map(Number)
  const pred = fit.predictions.map(Number)
  const lo = Math.min(...actual, ...pred)
  const hi = Math.max(...actual, ...pred)
  return (
    <PlotBox title="Actual vs Predicted">
      <Plot
        data={[
          { x: actual, y: pred, mode: 'markers', marker: { color: '#3b82f6', size: 7 } } as Plotly.Data,
          { x: [lo, hi], y: [lo, hi], mode: 'lines', line: { color: '#16a34a', dash: 'dash' } } as Plotly.Data,
        ]}
        layout={{ margin: { t: 10, r: 20, b: 45, l: 55 }, xaxis: { title: { text: 'Actual' }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'Predicted' }, gridcolor: '#e5e7eb' }, showlegend: false, ...PLOT_BG } as PlotlyLayout}
        config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler />
    </PlotBox>
  )
}

function ConfMatrix({ z, labels }: { z: number[][]; labels: string[] }) {
  return (
    <PlotBox title="Confusion Matrix">
      <Plot
        data={[{
          z, x: labels, y: labels, type: 'heatmap', colorscale: 'Blues', showscale: true,
          text: z.map(row => row.map(String)), texttemplate: '%{text}',
          hovertemplate: 'pred %{x}<br>actual %{y}<br>%{z}<extra></extra>',
        } as unknown as Plotly.Data]}
        layout={{ margin: { t: 10, r: 20, b: 45, l: 55 }, xaxis: { title: { text: 'Predicted' } }, yaxis: { title: { text: 'Actual' }, autorange: 'reversed' }, ...PLOT_BG } as PlotlyLayout}
        config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler />
    </PlotBox>
  )
}
