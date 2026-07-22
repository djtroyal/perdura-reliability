import { useState } from 'react'
import Plot from '../shared/ExportablePlot'
import { Play } from 'lucide-react'
import { GenerateDesignResponse, DOEAnalyzeResponse, analyzeDesign } from '../../api/doe'
import { fmtNum } from '../shared/format'
import { inputCls } from '../shared/styles'
import { magnitudeStep } from '../shared/numericSteps'

/**
 * Analysis stage for a completed factorial experiment: enter the measured
 * response for each run, then estimate effects (Pareto with Lenth's margin,
 * half-normal), %contribution, and main-effects / interaction plots.
 */
export default function AnalyzePanel({ design, factorNames, responses, analysis, onChange }: {
  design: GenerateDesignResponse
  factorNames: string[]
  responses: string[]
  analysis: DOEAnalyzeResponse | null
  onChange: (p: { responses?: string[]; analysis?: DOEAnalyzeResponse | null }) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const n = design.runs.length
  const vals = Array.from({ length: n }, (_, i) => responses[i] ?? '')
  const filled = vals.filter(v => v.trim() !== '').length

  const setVal = (i: number, v: string) => {
    const next = vals.slice()
    next[i] = v
    onChange({ responses: next })
  }

  const run = async () => {
    setError(null)
    const y = vals.map(v => parseFloat(v))
    if (y.some(v => isNaN(v))) { setError('Enter a numeric response for every run.'); return }
    setLoading(true)
    try {
      const res = await analyzeDesign({
        factor_names: factorNames,
        runs: design.runs as Record<string, number>[],
        responses: y,
        metadata: design.metadata,
      })
      onChange({ analysis: res })
    } catch (e) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Analysis failed.')
    } finally { setLoading(false) }
  }

  const a = analysis
  return (
    <div className="rounded border border-gray-200 bg-white p-3">
      <h3 className="text-xs font-semibold text-gray-700 mb-1">Analyze Experiment</h3>
      <p className="text-[11px] text-gray-500 mb-2">
        Enter the measured response for each run. Analysis follows the generated
        design contract: factorial effects, a quadratic response surface, or a Scheffé mixture model.
        Replicate rows remain separate observations for residual and pure-error estimation.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-1.5 mb-2">
        {vals.map((v, i) => {
          const replicate = design.runs[i]?.Replicate
          return (
          <div key={i} className="flex items-center gap-1" title={replicate != null ? `Run ${i + 1}, replicate ${replicate}` : `Run ${i + 1}`}>
            <span className="w-8 text-right text-[10px] leading-tight text-gray-400">
              {i + 1}
              {replicate != null && <span className="block text-[8px] text-blue-500">R{replicate}</span>}
            </span>
            <input type="number" step={magnitudeStep(Number(v))} value={v} onChange={e => setVal(i, e.target.value)}
              className={`${inputCls} !py-0.5 !px-1 text-[11px]`}
              aria-label={`Response for run ${i + 1}${replicate != null ? `, replicate ${replicate}` : ''}`} />
          </div>
        )})}
      </div>
      <div className="flex items-center gap-2">
        <button onClick={run} disabled={loading || filled < n}
          data-shortcut-primary data-shortcut-priority="20" data-shortcut-label="Analyze experimental effects"
          title="Analyze experimental effects (Ctrl/⌘+Enter)"
          className="flex items-center gap-1 text-xs bg-blue-600 text-white rounded px-3 py-1.5 hover:bg-blue-700 disabled:opacity-40">
          <Play size={12} /> {loading ? 'Analyzing…' : 'Analyze effects'}
        </button>
        <span className="text-[10px] text-gray-400">{filled}/{n} responses entered</span>
      </div>
      {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded mt-2">{error}</p>}

      {a && (
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex items-center gap-4 text-xs text-gray-600">
            <span>R² = <b>{a.r2 != null ? a.r2.toFixed(4) : '—'}</b></span>
            {a.adj_r2 != null && <span>adj. R² = <b>{a.adj_r2.toFixed(4)}</b></span>}
            {a.saturated && <span className="text-amber-600">
              Saturated design — {a.lenth ? "factorial screening uses Lenth's method" : 'no residual-error inference available'}.
            </span>}
            {a.aliased_terms_dropped.length > 0 && (
              <span className="text-gray-400">Aliased terms dropped: {a.aliased_terms_dropped.join(', ')}</span>
            )}
          </div>

          {a.design_diagnostics && (
            <div className={`rounded border p-2 text-xs ${a.design_diagnostics.full_rank ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
              Model: <b>{a.model?.replace(/_/g, ' ')}</b> · rank {a.design_diagnostics.rank}/{a.design_diagnostics.n_parameters}
              {' '}· residual df {a.design_diagnostics.residual_df}
              {' '}· condition {a.design_diagnostics.condition_number != null ? fmtNum(a.design_diagnostics.condition_number) : 'singular'}.
              {a.design_diagnostics.blocking?.n_blocks != null && a.design_diagnostics.blocking.n_blocks > 1 && (
                <span className="block mt-1">
                  Adjusted for {a.design_diagnostics.blocking.n_blocks} nuisance blocks.
                  {a.design_diagnostics.blocking.confounded_with_treatment_model && ' Block/treatment confounding detected.'}
                </span>
              )}
            </div>
          )}

          {a.lack_of_fit && (
            <div className="rounded border border-gray-200 bg-gray-50 p-2 text-xs text-gray-700">
              <b>Lack of fit:</b> {a.lack_of_fit.status.replace(/_/g, ' ')}
              {a.lack_of_fit.p_value != null && ` · F = ${fmtNum(a.lack_of_fit.F ?? 0)}, p = ${a.lack_of_fit.p_value.toPrecision(3)}`}
              <span className="block text-[10px] text-gray-500 mt-1">
                Pure-error df {a.lack_of_fit.pure_error_df}; lack-of-fit df {a.lack_of_fit.lack_of_fit_df}. Replicated design points are required to test model form.
              </span>
            </div>
          )}

          {a.effects.length === 0 && a.terms && (
            <div className="overflow-x-auto border border-gray-200 rounded">
              <table className="w-full text-xs">
                <thead className="bg-gray-50"><tr>
                  <th className="px-2 py-1.5 text-left">Model term</th>
                  <th className="px-2 py-1.5 text-right">Coefficient</th>
                  <th className="px-2 py-1.5 text-right">SE</th>
                  <th className="px-2 py-1.5 text-right">p-value</th>
                </tr></thead>
                <tbody>{a.terms.map(term => (
                  <tr key={term.term} className="border-t border-gray-100">
                    <td className="px-2 py-1 font-mono">{term.term}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmtNum(term.coefficient)}</td>
                    <td className="px-2 py-1 text-right font-mono">{term.standard_error != null ? fmtNum(term.standard_error) : '—'}</td>
                    <td className="px-2 py-1 text-right font-mono">{term.p_value != null ? term.p_value.toPrecision(3) : '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}

          {a.stationary_point && (
            <div className={`rounded border p-3 text-xs ${a.stationary_point.inside_tested_factor_ranges ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
              <b>Stationary point:</b> {a.stationary_point.status.replace(/_/g, ' ')}
              {a.stationary_point.coordinates && (
                <span className="block mt-1">
                  {factorNames.map((name, i) => `${name}=${fmtNum(a.stationary_point!.coordinates![i])}`).join(', ')}
                  {' '}· predicted response {fmtNum(a.stationary_point.predicted_response ?? 0)}
                  {' '}· {a.stationary_point.classification}.
                </span>
              )}
              {a.stationary_point.inside_tested_factor_ranges === false && (
                <span className="block font-semibold mt-1">Outside the tested factor ranges—do not treat as a validated optimum.</span>
              )}
            </div>
          )}

          {a.mixture_optimum && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              {(['minimum', 'maximum'] as const).map(direction => {
                const optimum = a.mixture_optimum![direction]
                return <div key={direction} className="rounded border border-violet-200 bg-violet-50 p-3 text-violet-800">
                  <b className="capitalize">Predicted {direction}</b>
                  {optimum.composition && <span className="block mt-1">
                    {Object.entries(optimum.composition).map(([name, value]) => `${name}=${(100 * value).toFixed(1)}%`).join(', ')}
                    {' '}· response {fmtNum(optimum.predicted_response ?? 0)}
                  </span>}
                </div>
              })}
            </div>
          )}

          {/* Effects table */}
          {a.effects.length > 0 && <div className="overflow-x-auto border border-gray-200 rounded">
            <table className="w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium text-gray-600">Term</th>
                  <th className="px-2 py-1.5 text-right font-medium text-gray-600">Effect</th>
                  <th className="px-2 py-1.5 text-right font-medium text-gray-600">Coefficient</th>
                  <th className="px-2 py-1.5 text-right font-medium text-gray-600">% Contribution</th>
                  <th className="px-2 py-1.5 text-right font-medium text-gray-600">p-value</th>
                  <th className="px-2 py-1.5 text-center font-medium text-gray-600">Sig.</th>
                </tr>
              </thead>
              <tbody>
                {a.effects.map(e => {
                  const sig = e.p_value != null ? e.p_value < 0.05 : e.significant_lenth
                  return (
                    <tr key={e.term} className={`border-t border-gray-100 ${sig ? 'bg-amber-50' : ''}`}>
                      <td className="px-2 py-1 font-mono">{e.term}</td>
                      <td className="px-2 py-1 text-right font-mono">{fmtNum(e.effect)}</td>
                      <td className="px-2 py-1 text-right font-mono">{fmtNum(e.coefficient)}</td>
                      <td className="px-2 py-1 text-right">{e.pct_contribution.toFixed(1)}%</td>
                      <td className="px-2 py-1 text-right font-mono">{e.p_value != null ? e.p_value.toPrecision(3) : '—'}</td>
                      <td className="px-2 py-1 text-center">{sig ? '✓' : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>}

          {/* Pareto of effects + Lenth margin */}
          {a.effects.length > 0 && <div className="border border-gray-200 rounded" style={{ height: 320 }}>
            <Plot
              data={[
                { type: 'bar', orientation: 'h',
                  y: a.effects.map(e => e.term).reverse(),
                  x: a.effects.map(e => Math.abs(e.effect)).reverse(),
                  marker: { color: a.effects.map(e => (e.significant_lenth || (e.p_value != null && e.p_value < 0.05)) ? '#f59e0b' : '#94a3b8').reverse() },
                  name: '|effect|' } as Plotly.Data,
                ...(a.lenth ? [{
                  x: [a.lenth.margin_of_error, a.lenth.margin_of_error],
                  y: [a.effects[a.effects.length - 1].term, a.effects[0].term],
                  mode: 'lines', name: "Lenth ME",
                  line: { color: '#ef4444', width: 1.5, dash: 'dash' } } as Plotly.Data] : []),
              ]}
              layout={{
                title: { text: 'Pareto of Effects', font: { size: 12 } },
                xaxis: { title: { text: '|standardized effect|' }, gridcolor: '#e5e7eb' },
                yaxis: { automargin: true }, showlegend: false,
                margin: { t: 34, r: 16, b: 42, l: 70 }, paper_bgcolor: 'white', plot_bgcolor: 'white',
              } as Partial<Plotly.Layout>}
              config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler />
          </div>}

          {a.effects.length > 0 && <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Half-normal plot */}
            <div className="border border-gray-200 rounded" style={{ height: 300 }}>
              <Plot
                data={[{
                  x: a.half_normal.quantile, y: a.half_normal.abs_effect,
                  mode: 'markers+text', text: a.half_normal.term, textposition: 'top center',
                  textfont: { size: 9 }, marker: { color: '#3b82f6', size: 7 }, name: 'effects',
                } as Plotly.Data]}
                layout={{
                  title: { text: 'Half-Normal Plot of Effects', font: { size: 12 } },
                  xaxis: { title: { text: 'Half-normal quantile' }, gridcolor: '#e5e7eb' },
                  yaxis: { title: { text: '|effect|' }, gridcolor: '#e5e7eb' }, showlegend: false,
                  margin: { t: 34, r: 16, b: 42, l: 55 }, paper_bgcolor: 'white', plot_bgcolor: 'white',
                } as Partial<Plotly.Layout>}
                config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler />
            </div>

            {/* Main effects */}
            <div className="border border-gray-200 rounded" style={{ height: 300 }}>
              <Plot
                data={Object.entries(a.main_effects).map(([f, d]) => ({
                  x: d.levels, y: d.means, mode: 'lines+markers', name: f,
                } as Plotly.Data))}
                layout={{
                  title: { text: 'Main Effects (mean response by coded level)', font: { size: 12 } },
                  xaxis: { title: { text: 'Coded level' }, gridcolor: '#e5e7eb', dtick: 1 },
                  yaxis: { title: { text: 'Mean response' }, gridcolor: '#e5e7eb' },
                  margin: { t: 34, r: 16, b: 42, l: 55 }, paper_bgcolor: 'white', plot_bgcolor: 'white',
                  legend: { orientation: 'h', y: -0.3, font: { size: 10 } },
                } as Partial<Plotly.Layout>}
                config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler />
            </div>
          </div>}

          {/* Interaction plots (up to 6 pairs) */}
          {a.interactions.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {a.interactions.slice(0, 6).map(inter => (
                <div key={`${inter.factor_x}:${inter.factor_trace}`} className="border border-gray-200 rounded" style={{ height: 280 }}>
                  <Plot
                    data={inter.series.map(s => ({
                      x: inter.x_levels, y: s.means, mode: 'lines+markers',
                      name: `${inter.factor_trace} = ${s.level}`,
                    } as Plotly.Data))}
                    layout={{
                      title: { text: `Interaction: ${inter.factor_x} × ${inter.factor_trace}`, font: { size: 12 } },
                      xaxis: { title: { text: `${inter.factor_x} (coded)` }, gridcolor: '#e5e7eb', dtick: 1 },
                      yaxis: { title: { text: 'Mean response' }, gridcolor: '#e5e7eb' },
                      margin: { t: 34, r: 16, b: 42, l: 55 }, paper_bgcolor: 'white', plot_bgcolor: 'white',
                      legend: { orientation: 'h', y: -0.32, font: { size: 9 } },
                    } as Partial<Plotly.Layout>}
                    config={{ responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler />
                </div>
              ))}
            </div>
          )}
          {a.effects.length > 0 && <p className="text-[10px] text-gray-400">
            Effects are twice the coded-regression coefficients (the +1 vs −1 mean difference). Non-parallel
            interaction lines indicate an interaction. {a.lenth ? 'The dashed line is Lenth’s margin of error — bars beyond it are significant without replicates.' : ''}
          </p>}
        </div>
      )}
    </div>
  )
}
