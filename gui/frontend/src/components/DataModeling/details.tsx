import Plot from '../shared/ExportablePlot'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlotlyLayout = any
import {
  FitRegressionResponse, LinearResult, LogisticResult, PolynomialResult,
  RegressionDiagnostics, SelectionStabilityResult,
} from '../../api/regression'
import { FitResponse, ClassMetrics, RegMetrics } from '../../api/predictive'
import { Card } from '../shared/ui'
import Latex from '../shared/Latex'

export { Card }

const PLOT_BG = { paper_bgcolor: 'white', plot_bgcolor: 'white' }

export function fmt(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—'
  if (v !== 0 && (Math.abs(v) >= 1e4 || Math.abs(v) < 1e-3)) return v.toExponential(3)
  return v.toFixed(4)
}
export function pct(v: number | null | undefined): string {
  return v == null ? '—' : (v * 100).toFixed(1) + '%'
}

function hasInference(r: FitRegressionResponse): r is LinearResult | PolynomialResult {
  return (r as LinearResult).p_values !== undefined && (r as LogisticResult).odds_ratios === undefined
}

function buildEquation(fit: FitRegressionResponse): string {
  const lhs = fit.model === 'logistic' ? String.raw`\operatorname{logit}(p)` : String.raw`\hat{y}`
  const terms: string[] = []
  if (fit.intercept != null) terms.push(latexNumber(fit.intercept))
  const isPoly = fit.model === 'polynomial'
  fit.coefficients.forEach((c, i) => {
    const abs = Math.abs(c)
    const sign = c < 0 ? ' - ' : (terms.length ? ' + ' : '')
    const label = isPoly
      ? (i === 0 ? 'x' : `x^{${i + 1}}`)
      : String.raw`\mathrm{${escapeLatex(fit.feature_names[i] ?? `x${i + 1}`)}}`
    terms.push(`${sign}${latexNumber(abs)}\,${label}`)
  })
  return `${lhs} = ${terms.join('') || '0'}`
}

function latexNumber(v: number): string {
  const rendered = fmt(v)
  const scientific = /^(-?[\d.]+)e([+-]?\d+)$/.exec(rendered)
  return scientific ? `${scientific[1]}\\times 10^{${parseInt(scientific[2], 10)}}` : rendered
}

function escapeLatex(value: string): string {
  return value.replace(/\\/g, String.raw`\backslash `)
    .replace(/([{}_$%&#])/g, String.raw`\$1`)
    .replace(/\^/g, String.raw`\char` + '94 ')
    .replace(/~/g, String.raw`\char` + '126 ')
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
  const ciPct = Math.round((fit.CI ?? 0.95) * 100)
  const classMap = logit?.class_mapping
  const stability = (fit as { selection_stability?: SelectionStabilityResult }).selection_stability

  return (
    <div className="flex flex-col gap-4">
      {'converged' in fit && fit.converged === false && (
        <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {fit.convergence_warning ?? 'The iterative solver did not converge; treat this fit as diagnostic only.'}
        </p>
      )}
      {/* Class encoding note for label-encoded string targets */}
      {classMap && (
        <p className="text-[11px] text-gray-600 bg-gray-50 border border-gray-200 rounded px-3 py-1.5">
          Target encoded: <span className="font-mono">0 = {classMap['0']}</span>,{' '}
          <span className="font-mono">1 = {classMap['1']}</span>. Coefficients model the
          probability of class&nbsp;1 (<span className="font-medium">{classMap['1']}</span>).
        </p>
      )}
      {/* Fitted equation */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5">
        <p className="text-[10px] text-gray-500 mb-0.5 font-medium">Fitted Equation</p>
        <Latex block className="text-sm text-gray-800 overflow-x-auto py-0.5">{buildEquation(fit)}</Latex>
      </div>

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

      {stability && (
        <div className={`rounded-lg border p-3 space-y-2 ${
          stability.support_eligible && stability.convergence.all_fits_converged
            ? 'border-violet-200 bg-violet-50/40'
            : 'border-amber-300 bg-amber-50/60'
        }`}>
          <div>
            <h4 className="text-sm font-semibold text-violet-900">Path-calibrated selection stability</h4>
            <p className="text-[10px] text-violet-700">
              {stability.reproducibility.n_pairs} complementary half-sample pairs · stable at{' '}
              {Math.round(stability.selection_threshold * 100)}%. This is a separate support
              selector over a penalty path—not a stability assessment of the full-sample alpha fit
              whose coefficients appear below.
            </p>
            <p className="text-[10px] text-violet-700 mt-1">
              Operating lambda {fmt(stability.operating_point.chosen_lambda)} · empirical q{' '}
              {fmt(stability.operating_point.empirical_mean_selected_per_half_sample_q)} / budget{' '}
              {fmt(stability.operating_point.q_budget)} · plug-in PFER diagnostic{' '}
              {fmt(stability.selection_size_control.plug_in_pfer_diagnostic)} (target ≤{' '}
              {fmt(stability.selection_size_control.plug_in_pfer_target)}).
              {' '}The diagnostic is not a formal false-selection bound.
            </p>
          </div>
          {!stability.convergence.all_fits_converged && (
            <p className="rounded border border-amber-300 bg-amber-100 px-2 py-1 text-[10px] text-amber-900">
              Diagnostic only: {stability.convergence.converged_fits} of{' '}
              {stability.convergence.total_fits} base fits converged. Stable classifications and
              green highlighting are withheld.
            </p>
          )}
          {!stability.operating_point.q_budget_met && (
            <p className="rounded border border-amber-300 bg-amber-100 px-2 py-1 text-[10px] text-amber-900">
              Diagnostic only: the supplied penalty path did not contain an operating point within
              the q budget. Stable classifications are withheld.
            </p>
          )}
          <div className="overflow-x-auto rounded border border-violet-100 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-violet-50 text-violet-800"><tr>
                <th className="px-3 py-1.5 text-left font-medium">Feature</th>
                <th className="px-3 py-1.5 text-right font-medium">Selection frequency at operating lambda</th>
                <th className="px-3 py-1.5 text-center font-medium">Stable</th>
              </tr></thead>
              <tbody>
                {stability.feature_names.map((name, index) => {
                  const probability = stability.selection_probabilities[index] ?? 0
                  const selected = stability.support_eligible
                    && stability.convergence.all_fits_converged
                    && stability.selected_indices.includes(index)
                  return (
                    <tr key={name} className={`border-t border-violet-100 ${selected ? 'bg-green-50/60' : ''}`}>
                      <td className="px-3 py-1.5 text-gray-800">{name}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{(100 * probability).toFixed(1)}%</td>
                      <td className={`px-3 py-1.5 text-center font-medium ${selected ? 'text-green-700' : 'text-gray-400'}`}>
                        {stability.support_eligible && stability.convergence.all_fits_converged
                          ? (selected ? 'Yes' : 'No') : 'Diagnostic'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
                {(inf || logit) && <th className="px-3 py-1.5 text-right font-medium">{ciPct}% CI</th>}
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

      {/* Plain-English interpretation */}
      <div className="bg-blue-50 border border-blue-100 rounded p-3">
        <p className="text-xs font-semibold text-blue-800 mb-1">Interpretation</p>
        <ul className="text-[11px] text-gray-700 leading-snug list-disc pl-4 space-y-0.5">
          {regressionInterpretation(fit, { inf: !!inf, logit, isPoly, names, coefs }).map((n, i) => <li key={i}>{n}</li>)}
        </ul>
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
        {!isLogistic && fit.diagnostics && <QQPlot diag={fit.diagnostics} />}
        {!isLogistic && fit.diagnostics && <StdResidualPlot diag={fit.diagnostics} />}
      </div>
      {!isLogistic && fit.diagnostics && <DiagnosticsCaption diag={fit.diagnostics} />}
    </div>
  )
}

/** Plain-English, data-driven interpretation of a regression/logistic fit. */
function regressionInterpretation(
  fit: FitRegressionResponse,
  ctx: { inf: boolean; logit: LogisticResult | null; isPoly: boolean; names: string[]; coefs: number[] },
): string[] {
  const out: string[] = []
  const { logit, names, coefs } = ctx
  if (logit) {
    out.push(`The model classifies correctly ${pct(logit.accuracy)} of the time (training accuracy).`)
    if (logit.roc?.auc != null) {
      const auc = logit.roc.auc
      const q = auc >= 0.9 ? 'excellent' : auc >= 0.8 ? 'good' : auc >= 0.7 ? 'fair' : 'weak'
      out.push(`ROC AUC of ${fmt(auc)} indicates ${q} separation between the two classes.`)
    }
    // Most influential predictor by |coefficient|.
    if (names.length) {
      let k = 0
      for (let i = 1; i < coefs.length; i++) if (Math.abs(coefs[i]) > Math.abs(coefs[k])) k = i
      const dir = coefs[k] >= 0 ? 'increases' : 'decreases'
      const or = logit.odds_ratios?.[k]
      out.push(`"${names[k]}" has the largest effect: higher values ${dir} the odds of the positive class${or != null ? ` (odds ratio ≈ ${fmt(or)})` : ''}.`)
    }
    const sig = names.filter((_, i) => (logit.p_values?.[i] ?? 1) < 0.05)
    out.push(sig.length
      ? `Statistically significant predictor(s) (p < 0.05): ${sig.join(', ')}.`
      : 'No predictor is statistically significant at the 0.05 level — interpret coefficients with caution.')
    return out
  }
  // Linear / ridge / lasso / polynomial.
  const r2 = fit.r2
  if (r2 != null) {
    const q = r2 >= 0.9 ? 'most' : r2 >= 0.5 ? 'a substantial portion of' : r2 >= 0.25 ? 'some of' : 'little of'
    out.push(`The model explains ${q} the variation in the target (R² = ${fmt(r2)}).`)
  }
  if (ctx.inf && names.length) {
    const linf = fit as LinearResult
    let k = 0
    for (let i = 1; i < coefs.length; i++) if (Math.abs(coefs[i]) > Math.abs(coefs[k])) k = i
    const dir = coefs[k] >= 0 ? 'increases' : 'decreases'
    out.push(`A one-unit rise in "${names[k]}" ${dir} the predicted target by about ${fmt(Math.abs(coefs[k]))}, holding others fixed.`)
    const sig = names.filter((_, i) => (linf.p_values?.[i] ?? 1) < 0.05)
    out.push(sig.length
      ? `Significant predictor(s) (p < 0.05): ${sig.join(', ')}.`
      : 'No predictor reaches significance at the 0.05 level on this sample.')
  } else {
    out.push('Regularized fit (ridge/lasso): coefficients are shrunk for stability; inference p-values are not reported.')
  }
  out.push('Check the residual plot — a random, patternless scatter supports the model assumptions.')
  return out
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

function QQPlot({ diag }: { diag: RegressionDiagnostics }) {
  const t = diag.qq.theoretical
  const s = diag.qq.sample
  const lo = Math.min(...t, ...s)
  const hi = Math.max(...t, ...s)
  return (
    <PlotBox title="Normal Q-Q (standardized residuals)">
      <Plot
        data={[
          { x: t, y: s, mode: 'markers', name: 'Residuals', marker: { color: '#3b82f6', size: 7 } } as Plotly.Data,
          { x: [lo, hi], y: [lo, hi], mode: 'lines', name: 'Normal', line: { color: '#9ca3af', dash: 'dash' } } as Plotly.Data,
        ]}
        layout={{ margin: { t: 10, r: 20, b: 45, l: 55 }, xaxis: { title: { text: 'Theoretical quantile' }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'Sample quantile' }, gridcolor: '#e5e7eb' }, showlegend: false, ...PLOT_BG } as PlotlyLayout}
        config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler />
    </PlotBox>
  )
}

function StdResidualPlot({ diag }: { diag: RegressionDiagnostics }) {
  const xr = [Math.min(...diag.fitted), Math.max(...diag.fitted)]
  const studentized = diag.leverage != null
  return (
    <PlotBox title={studentized ? 'Studentized Residuals vs Fitted' : 'Standardized Residuals vs Fitted'}>
      <Plot
        data={[
          { x: diag.fitted, y: diag.std_residuals, mode: 'markers',
            marker: { color: diag.std_residuals.map(r => Math.abs(r) > 2 ? '#ef4444' : '#8b5cf6'), size: 7 } } as Plotly.Data,
          { x: xr, y: [0, 0], mode: 'lines', line: { color: '#9ca3af', dash: 'dash' } } as Plotly.Data,
          { x: xr, y: [2, 2], mode: 'lines', line: { color: '#f59e0b', dash: 'dot', width: 1 } } as Plotly.Data,
          { x: xr, y: [-2, -2], mode: 'lines', line: { color: '#f59e0b', dash: 'dot', width: 1 } } as Plotly.Data,
        ]}
        layout={{ margin: { t: 10, r: 20, b: 45, l: 55 }, xaxis: { title: { text: 'Fitted' }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: studentized ? 'Studentized residual' : 'Standardized residual' }, gridcolor: '#e5e7eb' }, showlegend: false, ...PLOT_BG } as PlotlyLayout}
        config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler />
    </PlotBox>
  )
}

function DiagnosticsCaption({ diag }: { diag: RegressionDiagnostics }) {
  const notes: string[] = []
  if (diag.condition_warning) {
    notes.push(`${diag.condition_warning}${diag.condition_number != null ? ` Condition number = ${fmt(diag.condition_number)}.` : ''}`)
  }
  if (diag.shapiro_p != null) {
    notes.push(diag.shapiro_p < 0.05
      ? `Shapiro-Wilk p = ${fmt(diag.shapiro_p)} — residuals depart from normality; p-values and CIs are approximate.`
      : `Shapiro-Wilk p = ${fmt(diag.shapiro_p)} — no evidence against normal residuals.`)
  }
  if (diag.durbin_watson != null) {
    const dw = diag.durbin_watson
    notes.push(`Durbin-Watson = ${fmt(dw)}${dw < 1.5 ? ' (possible positive autocorrelation if rows are in time order)' : dw > 2.5 ? ' (possible negative autocorrelation if rows are in time order)' : ''}.`)
  }
  const nOut = diag.std_residuals.filter(r => Math.abs(r) > 2).length
  if (nOut > 0) notes.push(`${nOut} point(s) beyond ±2 standardized residuals (highlighted in red).`)
  if (diag.cooks_d != null) {
    const maxD = Math.max(...diag.cooks_d)
    if (maxD > 1) notes.push(`Max Cook's distance = ${fmt(maxD)} > 1 — at least one point is highly influential.`)
  }
  if (!notes.length) return null
  return (
    <div className="bg-gray-50 border border-gray-200 rounded p-3">
      <p className="text-xs font-semibold text-gray-700 mb-1">Residual Diagnostics</p>
      <ul className="text-[11px] text-gray-600 leading-snug list-disc pl-4 space-y-0.5">
        {notes.map((n, i) => <li key={i}>{n}</li>)}
      </ul>
    </div>
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
            <Card label="Balanced accuracy" value={pct((m as ClassMetrics).balanced_accuracy)} />
            {(m as ClassMetrics).roc_auc != null && <Card label="ROC AUC" value={fmt((m as ClassMetrics).roc_auc!)} />}
            {(m as ClassMetrics).calibration?.brier_score != null && <Card label="Brier score" value={fmt((m as ClassMetrics).calibration.brier_score)} />}
            {(m as ClassMetrics).calibration?.expected_calibration_error != null && <Card label="Calibration error" value={fmt((m as ClassMetrics).calibration.expected_calibration_error)} />}
          </>
        ) : (
          <>
            <Card label="R²" value={fmt((m as RegMetrics).r2)} accent />
            <Card label="RMSE" value={fmt((m as RegMetrics).rmse)} />
            <Card label="MAE" value={fmt((m as RegMetrics).mae)} />
          </>
        )}
      </div>
      <div className="text-[11px] text-gray-500 leading-snug">
        <p>Train {fit.n_train} · Test {fit.n_test} · {fit.validation?.strategy ?? 'holdout'} validation · metrics and plots use holdout rows</p>
        {fit.preprocessing && <p>{fit.preprocessing.categorical_encoding}; {fit.preprocessing.numeric_scaling}.</p>}
      </div>
      {fit.fit_diagnostics && !fit.fit_diagnostics.converged && (
        <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Solver did not converge. {fit.fit_diagnostics.warnings.join(' ')} Treat metrics as provisional.
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {classification ? (
          <ConfMatrix z={(m as ClassMetrics).confusion_matrix} labels={(m as ClassMetrics).classes} />
        ) : (
          <MLActualVsPred fit={fit} />
        )}
        {classification && (m as ClassMetrics).calibration?.available
          && (m as ClassMetrics).calibration.predicted_probability.length > 0 && (
          <PlotBox title="Probability Calibration">
            <Plot
              data={[
                { x: (m as ClassMetrics).calibration.predicted_probability, y: (m as ClassMetrics).calibration.observed_frequency,
                  mode: 'lines+markers', name: 'Model', line: { color: '#3b82f6', width: 2 } } as Plotly.Data,
                { x: [0, 1], y: [0, 1], mode: 'lines', name: 'Perfect calibration', line: { color: '#9ca3af', dash: 'dash' } } as Plotly.Data,
              ]}
              layout={{ margin: { t: 10, r: 20, b: 45, l: 55 }, xaxis: { title: { text: 'Mean predicted probability' }, range: [0, 1], gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'Observed frequency' }, range: [0, 1], gridcolor: '#e5e7eb' }, ...PLOT_BG } as PlotlyLayout}
              config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler />
          </PlotBox>
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
