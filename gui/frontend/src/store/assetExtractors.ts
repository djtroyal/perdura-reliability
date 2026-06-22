import { getProjectState } from './project'
import type {
  FitResponse, DistPlotData, NonparametricResponse,
  SpecialModelResponse, WeibayesResponse,
  ALTFitResponse, GrowthResponse,
  WarrantyForecastResponse,
  PredictionResponse,
  FaultTreeResponse,
  RBDResponse, RBDImportance,
} from '../api/client'
import type { HypothesisResult, AnovaTableRow } from '../api/hypothesis'
import type { FitRegressionResponse } from '../api/regression'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const PLOT_BG = { paper_bgcolor: 'white', plot_bgcolor: 'white' }
const BASE = { ...PLOT_BG, margin: { t: 35, r: 20, b: 50, l: 60 } }
const COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899']

export interface AssetDescriptor {
  id: string
  module: string
  moduleLabel: string
  group: string
  label: string
  type: 'plot' | 'table' | 'metrics'
  getData: () => AssetData
}

export interface AssetData {
  plotData?: unknown[]
  plotLayout?: unknown
  tableHeaders?: string[]
  tableRows?: (string | number)[][]
  metrics?: { label: string; value: string }[]
}

const fmt = (v: number | null | undefined): string => {
  if (v == null || !isFinite(v)) return '—'
  if (v !== 0 && (Math.abs(v) >= 1e4 || Math.abs(v) < 1e-3)) return v.toExponential(3)
  return v.toFixed(4)
}

let idSeq = 0
const mkId = (prefix: string) => `${prefix}_${(idSeq++).toString(36)}`

// ---------------------------------------------------------------------------
// Life Data
// ---------------------------------------------------------------------------

function extractLifeData(modules: Record<string, unknown>, out: AssetDescriptor[]) {
  const s = modules['lifeData'] as { folios?: Any[] } | null
  if (!s?.folios) return

  for (const folio of s.folios) {
    const gp = folio.name || 'Folio'
    const fit = folio.result as FitResponse | null | undefined
    if (fit?.results?.length) {
      out.push({
        id: mkId('lda'), module: 'lifeData', moduleLabel: 'Life Data Analysis',
        group: gp, label: 'Fit Summary Table', type: 'table',
        getData: () => {
          const headers = ['Distribution', 'AICc', 'BIC', 'AD', 'LogLik']
          const rows = fit.results.map(r => [
            r.Distribution, fmt(r.AICc), fmt(r.BIC), fmt(r.AD), fmt(r.LogLik),
          ])
          return { tableHeaders: headers, tableRows: rows }
        },
      })

      const best = fit.best_distribution
      const plots = fit.plots ?? {}

      for (const distName of Object.keys(plots)) {
        const pd = plots[distName] as DistPlotData
        if (pd.probability) {
          const isBest = distName === best
          out.push({
            id: mkId('lda'), module: 'lifeData', moduleLabel: 'Life Data Analysis',
            group: gp, label: `${distName} Probability Plot${isBest ? ' ★' : ''}`, type: 'plot',
            getData: () => {
              const p = pd.probability!
              return {
                plotData: [
                  { x: p.scatter_x, y: p.scatter_y, mode: 'markers', name: 'Data', marker: { color: '#3b82f6', size: 6 } },
                  { x: p.line_x, y: p.line_y, mode: 'lines', name: distName, line: { color: '#ef4444', width: 2 } },
                ],
                plotLayout: { ...BASE, xaxis: { title: { text: p.x_label }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: p.y_label }, gridcolor: '#e5e7eb' }, title: { text: `${distName} Probability Plot` } },
              }
            },
          })
        }
        if (pd.curves) {
          for (const curve of ['SF', 'CDF', 'PDF', 'HF'] as const) {
            const key = curve.toLowerCase() as 'sf' | 'cdf' | 'pdf' | 'hf'
            if (!pd.curves[key]?.length) continue
            const isBest = distName === best
            out.push({
              id: mkId('lda'), module: 'lifeData', moduleLabel: 'Life Data Analysis',
              group: gp, label: `${distName} ${curve}${isBest ? ' ★' : ''}`, type: 'plot',
              getData: () => {
                const c = pd.curves!
                return {
                  plotData: [
                    { x: c.x, y: c[key], mode: 'lines', name: distName, line: { color: '#3b82f6', width: 2 } },
                  ],
                  plotLayout: { ...BASE, xaxis: { title: { text: 'Time' }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: curve }, gridcolor: '#e5e7eb' }, title: { text: `${distName} — ${curve}` } },
                }
              },
            })
          }
        }
      }
    }

    const np = folio.npResult as NonparametricResponse | null | undefined
    if (np?.time?.length) {
      out.push({
        id: mkId('lda'), module: 'lifeData', moduleLabel: 'Life Data Analysis',
        group: gp, label: `${np.method} Survival Plot`, type: 'plot',
        getData: () => ({
          plotData: [
            { x: np.time, y: np.SF, mode: 'lines', name: np.method, line: { color: '#3b82f6', width: 2 } },
            { x: np.time, y: np.CI_lower, mode: 'lines', name: 'Lower CI', line: { color: '#93c5fd', dash: 'dash', width: 1 } },
            { x: np.time, y: np.CI_upper, mode: 'lines', name: 'Upper CI', line: { color: '#93c5fd', dash: 'dash', width: 1 } },
          ],
          plotLayout: { ...BASE, xaxis: { title: { text: 'Time' }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'Survival Function' }, range: [0, 1], gridcolor: '#e5e7eb' }, title: { text: `${np.method} Estimator` } },
        }),
      })
    }

    const sp = folio.specialResult as SpecialModelResponse | null | undefined
    if (sp?.curves?.x?.length) {
      out.push({
        id: mkId('lda'), module: 'lifeData', moduleLabel: 'Life Data Analysis',
        group: gp, label: `${sp.model} SF Curve`, type: 'plot',
        getData: () => ({
          plotData: [
            { x: sp.curves.x, y: sp.curves.sf, mode: 'lines', name: 'SF', line: { color: '#3b82f6', width: 2 } },
          ],
          plotLayout: { ...BASE, xaxis: { title: { text: 'Time' }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'Survival' }, gridcolor: '#e5e7eb' }, title: { text: `${sp.model} Survival Function` } },
        }),
      })
    }

    const wb = folio.weibayesResult as WeibayesResponse | null | undefined
    if (wb?.curves?.x?.length) {
      out.push({
        id: mkId('lda'), module: 'lifeData', moduleLabel: 'Life Data Analysis',
        group: gp, label: `Weibayes SF (β=${fmt(wb.beta)})`, type: 'plot',
        getData: () => ({
          plotData: [
            { x: wb.curves.x, y: wb.curves.sf, mode: 'lines', name: 'SF', line: { color: '#3b82f6', width: 2 } },
          ],
          plotLayout: { ...BASE, xaxis: { title: { text: 'Time' }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'Survival' }, gridcolor: '#e5e7eb' }, title: { text: `Weibayes (β=${fmt(wb.beta)}, η=${fmt(wb.eta)})` } },
        }),
      })
    }
  }
}

// ---------------------------------------------------------------------------
// ALT
// ---------------------------------------------------------------------------

function extractALT(modules: Record<string, unknown>, out: AssetDescriptor[]) {
  const folio = extractFolioResult<{ result?: ALTFitResponse | null }>(modules, 'alt')
  for (const { gp, st } of folio) {
    const r = st.result
    if (!r) continue
    if (r.results?.length) {
      out.push({
        id: mkId('alt'), module: 'alt', moduleLabel: 'Reliability Testing',
        group: gp, label: 'ALT Fit Summary', type: 'table',
        getData: () => {
          const keys = Object.keys(r.results[0] ?? {})
          return { tableHeaders: keys, tableRows: r.results.map(row => keys.map(k => String(row[k] ?? '—'))) }
        },
      })
    }
    if (r.life_stress_plot) {
      const p = r.life_stress_plot
      out.push({
        id: mkId('alt'), module: 'alt', moduleLabel: 'Reliability Testing',
        group: gp, label: 'Life-Stress Plot', type: 'plot',
        getData: () => ({
          plotData: [
            { x: p.scatter_stress, y: p.scatter_life, mode: 'markers', name: 'Data', marker: { color: '#3b82f6', size: 7 } },
            { x: p.line_stress, y: p.line_life, mode: 'lines', name: r.best_model, line: { color: '#ef4444', width: 2 } },
          ],
          plotLayout: { ...BASE, xaxis: { title: { text: 'Stress' }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'Life' }, type: 'log', gridcolor: '#e5e7eb' }, title: { text: 'Life-Stress Relationship' } },
        }),
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Growth
// ---------------------------------------------------------------------------

function extractGrowth(modules: Record<string, unknown>, out: AssetDescriptor[]) {
  const folio = extractFolioResult<{ result?: GrowthResponse | null }>(modules, 'growth')
  for (const { gp, st } of folio) {
    const r = st.result
    if (!r) continue
    out.push({
      id: mkId('grw'), module: 'growth', moduleLabel: 'Reliability Growth',
      group: gp, label: 'Cumulative Failures', type: 'plot',
      getData: () => ({
        plotData: [
          { x: r.scatter.t, y: r.scatter.n, mode: 'markers', name: 'Observed', marker: { color: '#3b82f6', size: 6 } },
          { x: r.model_curve.t, y: r.model_curve.n, mode: 'lines', name: 'Model', line: { color: '#ef4444', width: 2 } },
        ],
        plotLayout: { ...BASE, xaxis: { title: { text: 'Time' }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'Cumulative Failures' }, gridcolor: '#e5e7eb' }, title: { text: 'Cumulative Failures vs Time' } },
      }),
    })
    out.push({
      id: mkId('grw'), module: 'growth', moduleLabel: 'Reliability Growth',
      group: gp, label: 'MTBF vs Time', type: 'plot',
      getData: () => ({
        plotData: [
          { x: r.mtbf_curve.t, y: r.mtbf_curve.cumulative, mode: 'lines', name: 'Cumulative', line: { color: '#3b82f6', width: 2 } },
          { x: r.mtbf_curve.t, y: r.mtbf_curve.instantaneous, mode: 'lines', name: 'Instantaneous', line: { color: '#10b981', width: 2, dash: 'dash' } },
        ],
        plotLayout: { ...BASE, xaxis: { title: { text: 'Time' }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'MTBF' }, gridcolor: '#e5e7eb' }, title: { text: 'MTBF vs Time' } },
      }),
    })
    out.push({
      id: mkId('grw'), module: 'growth', moduleLabel: 'Reliability Growth',
      group: gp, label: 'Growth Summary', type: 'metrics',
      getData: () => ({
        metrics: [
          { label: 'Model', value: r.model },
          { label: 'Growth Rate', value: fmt(r.growth_rate) },
          { label: 'MTBF (instantaneous)', value: fmt(r.mtbf_instantaneous) },
          { label: 'MTBF (cumulative)', value: fmt(r.mtbf_cumulative) },
          { label: 'Total Failures', value: String(r.n_failures) },
        ],
      }),
    })
  }
}

// ---------------------------------------------------------------------------
// Warranty
// ---------------------------------------------------------------------------

function extractWarranty(modules: Record<string, unknown>, out: AssetDescriptor[]) {
  const folio = extractFolioResult<{ forecastResult?: WarrantyForecastResponse | null }>(modules, 'warranty')
  for (const { gp, st } of folio) {
    const f = st.forecastResult
    if (!f) continue
    out.push({
      id: mkId('war'), module: 'warranty', moduleLabel: 'Warranty Analysis',
      group: gp, label: 'Forecast Bar Chart', type: 'plot',
      getData: () => ({
        plotData: [
          { x: f.totals.map((_, i) => `Period ${i + 1}`), y: f.totals, type: 'bar', marker: { color: '#3b82f6' } },
        ],
        plotLayout: { ...BASE, xaxis: { title: { text: 'Forecast Period' } }, yaxis: { title: { text: 'Expected Returns' }, gridcolor: '#e5e7eb' }, title: { text: 'Warranty Return Forecast' } },
      }),
    })
    out.push({
      id: mkId('war'), module: 'warranty', moduleLabel: 'Warranty Analysis',
      group: gp, label: 'Forecast Summary', type: 'metrics',
      getData: () => ({
        metrics: [
          { label: 'Distribution', value: f.distribution },
          ...Object.entries(f.params).map(([k, v]) => ({ label: k, value: fmt(v) })),
          { label: 'Total Forecasted Returns', value: fmt(f.totals.reduce((a, b) => a + b, 0)) },
        ],
      }),
    })
  }
}

// ---------------------------------------------------------------------------
// Prediction
// ---------------------------------------------------------------------------

function extractPrediction(modules: Record<string, unknown>, out: AssetDescriptor[]) {
  const folio = extractFolioResult<{ result?: PredictionResponse | null }>(modules, 'prediction')
  for (const { gp, st } of folio) {
    const r = st.result
    if (!r) continue
    const parts = r.results.filter(p => !p.incompatible)
    if (parts.length) {
      out.push({
        id: mkId('pred'), module: 'prediction', moduleLabel: 'Failure Rate Prediction',
        group: gp, label: 'Parts Summary Table', type: 'table',
        getData: () => ({
          tableHeaders: ['Part', 'Category', 'Qty', 'λ (FPMH)', 'Total λ', 'Contribution'],
          tableRows: parts.map(p => [p.name, p.category, p.quantity, fmt(p.failure_rate), fmt(p.total_failure_rate), `${(p.contribution * 100).toFixed(1)}%`]),
        }),
      })
      out.push({
        id: mkId('pred'), module: 'prediction', moduleLabel: 'Failure Rate Prediction',
        group: gp, label: 'Contribution Chart', type: 'plot',
        getData: () => {
          const top = [...parts].sort((a, b) => b.contribution - a.contribution).slice(0, 10)
          return {
            plotData: [{ labels: top.map(p => p.name), values: top.map(p => p.contribution), type: 'pie', hole: 0.4 }],
            plotLayout: { ...BASE, title: { text: 'Failure Rate Contribution' } },
          }
        },
      })
    }
    out.push({
      id: mkId('pred'), module: 'prediction', moduleLabel: 'Failure Rate Prediction',
      group: gp, label: 'System Summary', type: 'metrics',
      getData: () => ({
        metrics: [
          { label: 'System λ (FPMH)', value: fmt(r.total_failure_rate) },
          { label: 'MTBF (hours)', value: fmt(r.mtbf_hours) },
          { label: 'Parts', value: String(r.results.length) },
          { label: 'Environment', value: r.environment },
        ],
      }),
    })
  }
}

// ---------------------------------------------------------------------------
// Hypothesis Testing
// ---------------------------------------------------------------------------

function extractHypothesis(modules: Record<string, unknown>, out: AssetDescriptor[]) {
  const s = modules['hypothesis'] as { result?: HypothesisResult | null } | null
  const r = s?.result
  if (!r) return
  out.push({
    id: mkId('hyp'), module: 'hypothesis', moduleLabel: 'Hypothesis Tests',
    group: 'Test', label: `${r.test} Result`, type: 'table',
    getData: () => {
      const rows: (string | number)[][] = [
        ['Test', r.test],
        ['Statistic', fmt(r.statistic)],
        ['p-value', fmt(r.p_value)],
        ['α', fmt(r.alpha)],
        ['Reject H₀', r.reject_null ? 'Yes' : 'No'],
      ]
      if (r.effect_size != null) rows.push(['Effect size', fmt(r.effect_size)])
      return { tableHeaders: ['Measure', 'Value'], tableRows: rows }
    },
  })
  if (r.anova_table?.length) {
    out.push({
      id: mkId('hyp'), module: 'hypothesis', moduleLabel: 'Hypothesis Tests',
      group: 'Test', label: 'ANOVA Table', type: 'table',
      getData: () => {
        const at = r.anova_table as AnovaTableRow[]
        return {
          tableHeaders: ['Source', 'SS', 'df', 'MS', 'F', 'p-value'],
          tableRows: at.map(a => [a.source, fmt(a.SS), String(a.df ?? '—'), fmt(a.MS), fmt(a.F), fmt(a.p_value)]),
        }
      },
    })
  }
}

// ---------------------------------------------------------------------------
// Fault Tree Analysis
// ---------------------------------------------------------------------------

function extractFTA(modules: Record<string, unknown>, out: AssetDescriptor[]) {
  const folio = extractFolioResult<{ result?: FaultTreeResponse | null; nodes?: Any[] }>(modules, 'faultTree')
  for (const { gp, st } of folio) {
    const r = st.result
    if (!r) continue
    out.push({
      id: mkId('fta'), module: 'faultTree', moduleLabel: 'Fault Tree Analysis',
      group: gp, label: 'Top Event & Cut Sets', type: 'metrics',
      getData: () => ({
        metrics: [
          { label: 'Top Event Probability', value: fmt(r.top_event_probability) },
          { label: 'Minimal Cut Sets', value: String(r.minimal_cut_sets.length) },
          ...(r.simulation ? [
            { label: 'Simulation P', value: fmt(r.simulation.probability) },
            { label: 'Simulation CI', value: `[${fmt(r.simulation.ci_lower)}, ${fmt(r.simulation.ci_upper)}]` },
          ] : []),
        ],
      }),
    })
    if (r.importance?.length) {
      out.push({
        id: mkId('fta'), module: 'faultTree', moduleLabel: 'Fault Tree Analysis',
        group: gp, label: 'Importance Measures', type: 'table',
        getData: () => ({
          tableHeaders: ['Event', 'Birnbaum', 'Fussell-Vesely', 'RAW', 'RRW'],
          tableRows: r.importance.map(i => [
            i.event, fmt(i.Birnbaum), fmt(i['Fussell-Vesely']), fmt(i.RAW), fmt(i.RRW),
          ]),
        }),
      })
    }
    if (r.minimal_cut_sets?.length) {
      out.push({
        id: mkId('fta'), module: 'faultTree', moduleLabel: 'Fault Tree Analysis',
        group: gp, label: 'Minimal Cut Sets', type: 'table',
        getData: () => ({
          tableHeaders: ['Cut Set #', 'Events', 'Order'],
          tableRows: r.minimal_cut_sets.map((cs, i) => [
            i + 1, cs.join(', '), cs.length,
          ]),
        }),
      })
    }
  }
}

// ---------------------------------------------------------------------------
// System Reliability (RBD)
// ---------------------------------------------------------------------------

function extractRBD(modules: Record<string, unknown>, out: AssetDescriptor[]) {
  const folio = extractFolioResult<{ result?: RBDResponse | null }>(modules, 'system')
  for (const { gp, st } of folio) {
    const r = st.result
    if (!r) continue
    out.push({
      id: mkId('rbd'), module: 'system', moduleLabel: 'System Reliability',
      group: gp, label: 'System Summary', type: 'metrics',
      getData: () => ({
        metrics: [
          { label: 'System Reliability', value: fmt(r.system_reliability) },
          { label: 'System Unreliability', value: fmt(r.system_unreliability) },
          { label: 'Path Sets', value: String(r.path_sets.length) },
          { label: 'Components', value: String(r.components.length) },
        ],
      }),
    })
    if (r.importance?.length) {
      out.push({
        id: mkId('rbd'), module: 'system', moduleLabel: 'System Reliability',
        group: gp, label: 'Component Importance', type: 'table',
        getData: () => ({
          tableHeaders: ['Component', 'R', 'Birnbaum', 'Criticality', 'RAW', 'RRW'],
          tableRows: (r.importance as RBDImportance[]).map(i => [
            i.label, fmt(i.reliability), fmt(i.Birnbaum), fmt(i.Criticality), fmt(i.RAW), fmt(i.RRW),
          ]),
        }),
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Statistical Modeling — Descriptive
// ---------------------------------------------------------------------------

function extractDescriptive(modules: Record<string, unknown>, out: AssetDescriptor[]) {
  const s = modules['descriptive'] as { results?: Record<string, Any> } | null
  if (!s?.results) return
  const r = s.results

  if (r.summary) {
    out.push({
      id: mkId('desc'), module: 'descriptive', moduleLabel: 'Descriptive Statistics',
      group: 'Descriptive', label: 'Summary Statistics', type: 'table',
      getData: () => {
        const sm = r.summary as Record<string, Any>
        if (Array.isArray(sm)) {
          const keys = Object.keys(sm[0] || {})
          return { tableHeaders: keys, tableRows: sm.map((row: Any) => keys.map(k => String(row[k] ?? '—'))) }
        }
        const entries = Object.entries(sm).filter(([, v]) => v != null && typeof v !== 'object')
        return { tableHeaders: ['Statistic', 'Value'], tableRows: entries.map(([k, v]) => [k, fmt(v as number)]) }
      },
    })
  }

  if (r.histogram) {
    out.push({
      id: mkId('desc'), module: 'descriptive', moduleLabel: 'Descriptive Statistics',
      group: 'Descriptive', label: 'Histogram', type: 'plot',
      getData: () => {
        const h = r.histogram as { bins?: number[]; counts?: number[]; values?: number[] }
        if (h.bins && h.counts) {
          return {
            plotData: [{ x: h.bins.slice(0, -1), y: h.counts, type: 'bar', marker: { color: '#3b82f6' } }],
            plotLayout: { ...BASE, xaxis: { title: { text: 'Value' }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'Count' }, gridcolor: '#e5e7eb' }, title: { text: 'Histogram' }, bargap: 0.05 },
          }
        }
        if (h.values) {
          return {
            plotData: [{ x: h.values, type: 'histogram', marker: { color: '#3b82f6' } }],
            plotLayout: { ...BASE, xaxis: { title: { text: 'Value' }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'Count' }, gridcolor: '#e5e7eb' }, title: { text: 'Histogram' } },
          }
        }
        return {}
      },
    })
  }

  if (r.boxplot) {
    out.push({
      id: mkId('desc'), module: 'descriptive', moduleLabel: 'Descriptive Statistics',
      group: 'Descriptive', label: 'Box Plot', type: 'plot',
      getData: () => {
        const b = r.boxplot as Any
        const vals = b.data || b.values || b.y
        if (Array.isArray(vals)) {
          return {
            plotData: [{ y: vals, type: 'box', name: '', marker: { color: '#3b82f6' } }],
            plotLayout: { ...BASE, title: { text: 'Box Plot' } },
          }
        }
        return {}
      },
    })
  }
}

// ---------------------------------------------------------------------------
// Statistical Modeling — Regression & ML
// ---------------------------------------------------------------------------

function extractDataModeling(modules: Record<string, unknown>, out: AssetDescriptor[]) {
  const s = modules['dataModeling'] as { fitted?: Any[] } | null
  if (!s?.fitted?.length) return
  for (const model of s.fitted) {
    const reg = model.reg as FitRegressionResponse | null | undefined
    const ml = model.ml as Any | null | undefined
    const name = model.name || model.id || 'Model'

    if (reg) {
      const isPoly = reg.model === 'polynomial'
      const isLogistic = reg.model === 'logistic'

      out.push({
        id: mkId('dm'), module: 'dataModeling', moduleLabel: 'Regression & ML',
        group: 'Models', label: `${name} — Coefficients`, type: 'table',
        getData: () => ({
          tableHeaders: ['Term', 'Coefficient', ...(reg.r2 != null ? ['R²', 'RMSE'] : [])],
          tableRows: [
            ...(reg.intercept != null ? [['Intercept', fmt(reg.intercept)]] : []),
            ...reg.feature_names.map((fn: string, i: number) => [fn, fmt(reg.coefficients[i])]),
          ] as (string | number)[][],
        }),
      })

      if (!isLogistic) {
        out.push({
          id: mkId('dm'), module: 'dataModeling', moduleLabel: 'Regression & ML',
          group: 'Models', label: `${name} — Actual vs Fitted`, type: 'plot',
          getData: () => {
            const actual = reg.fitted.map((f: number, i: number) => f + reg.residuals[i])
            const lo = Math.min(...actual, ...reg.fitted)
            const hi = Math.max(...actual, ...reg.fitted)
            return {
              plotData: [
                { x: actual, y: reg.fitted, mode: 'markers', name: 'Points', marker: { color: '#3b82f6', size: 6 } },
                { x: [lo, hi], y: [lo, hi], mode: 'lines', name: 'Ideal', line: { color: '#10b981', dash: 'dash' } },
              ],
              plotLayout: { ...BASE, xaxis: { title: { text: 'Actual' }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'Fitted' }, gridcolor: '#e5e7eb' }, title: { text: `${name} — Actual vs Fitted` }, showlegend: false },
            }
          },
        })
        out.push({
          id: mkId('dm'), module: 'dataModeling', moduleLabel: 'Regression & ML',
          group: 'Models', label: `${name} — Residuals`, type: 'plot',
          getData: () => ({
            plotData: [
              { x: reg.fitted, y: reg.residuals, mode: 'markers', marker: { color: '#8b5cf6', size: 6 } },
              { x: [Math.min(...reg.fitted), Math.max(...reg.fitted)], y: [0, 0], mode: 'lines', line: { color: '#9ca3af', dash: 'dash' } },
            ],
            plotLayout: { ...BASE, xaxis: { title: { text: 'Fitted' }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'Residual' }, gridcolor: '#e5e7eb' }, title: { text: `${name} — Residuals` }, showlegend: false },
          }),
        })
      }

      if (isLogistic && (reg as Any).roc) {
        const roc = (reg as Any).roc as { fpr: number[]; tpr: number[]; auc: number }
        out.push({
          id: mkId('dm'), module: 'dataModeling', moduleLabel: 'Regression & ML',
          group: 'Models', label: `${name} — ROC Curve`, type: 'plot',
          getData: () => ({
            plotData: [
              { x: roc.fpr, y: roc.tpr, mode: 'lines', name: `AUC=${roc.auc.toFixed(3)}`, line: { color: '#3b82f6', width: 2 } },
              { x: [0, 1], y: [0, 1], mode: 'lines', name: 'Chance', line: { color: '#9ca3af', dash: 'dash' } },
            ],
            plotLayout: { ...BASE, xaxis: { title: { text: 'FPR' }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'TPR' }, gridcolor: '#e5e7eb' }, title: { text: `${name} — ROC Curve` } },
          }),
        })
      }

      if (isPoly && (reg as Any).x_grid) {
        const poly = reg as Any
        out.push({
          id: mkId('dm'), module: 'dataModeling', moduleLabel: 'Regression & ML',
          group: 'Models', label: `${name} — Fit Curve`, type: 'plot',
          getData: () => ({
            plotData: [
              { x: poly.x_data, y: poly.y_data, mode: 'markers', name: 'Data', marker: { color: '#3b82f6', size: 6 } },
              { x: poly.x_grid, y: poly.y_grid, mode: 'lines', name: 'Fit', line: { color: '#ef4444', width: 2 } },
            ],
            plotLayout: { ...BASE, xaxis: { title: { text: 'x' }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'y' }, gridcolor: '#e5e7eb' }, title: { text: `Polynomial Fit (degree ${poly.degree})` }, showlegend: false },
          }),
        })
      }
    }

    if (ml) {
      const fi = ml.feature_importances
        ? Object.entries(ml.feature_importances as Record<string, number>).sort((a, b) => b[1] - a[1])
        : []
      if (fi.length) {
        out.push({
          id: mkId('dm'), module: 'dataModeling', moduleLabel: 'Regression & ML',
          group: 'Models', label: `${name} — Feature Importance`, type: 'plot',
          getData: () => ({
            plotData: [{ x: fi.map(f => f[1]), y: fi.map(f => f[0]), type: 'bar', orientation: 'h', marker: { color: '#3b82f6' } }],
            plotLayout: { ...BASE, margin: { ...BASE.margin, l: 100 }, xaxis: { gridcolor: '#e5e7eb' }, title: { text: `${name} — Feature Importance` } },
          }),
        })
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Physics of Failure
// ---------------------------------------------------------------------------

function extractPoF(modules: Record<string, unknown>, out: AssetDescriptor[]) {
  const folio = extractFolioResult<Record<string, Any>>(modules, 'pof')
  for (const { gp, st } of folio) {
    const snr = st.snResult as { A?: number; b?: number; r_squared?: number; curve?: { n: number[]; s: number[] } } | null
    if (snr?.curve?.n?.length) {
      out.push({
        id: mkId('pof'), module: 'pof', moduleLabel: 'Physics of Failure',
        group: gp, label: 'S-N Curve', type: 'plot',
        getData: () => ({
          plotData: [{ x: snr.curve!.n, y: snr.curve!.s, mode: 'lines', name: 'S-N', line: { color: '#3b82f6', width: 2 } }],
          plotLayout: { ...BASE, xaxis: { title: { text: 'Cycles (N)' }, type: 'log', gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'Stress (S)' }, type: 'log', gridcolor: '#e5e7eb' }, title: { text: 'S-N Curve' } },
        }),
      })
    }

    const frr = st.frResult as { crack_growth_curve?: { a: number[]; cycles: number[] } } | null
    if (frr?.crack_growth_curve?.a?.length) {
      out.push({
        id: mkId('pof'), module: 'pof', moduleLabel: 'Physics of Failure',
        group: gp, label: 'Crack Growth Curve', type: 'plot',
        getData: () => ({
          plotData: [{ x: frr.crack_growth_curve!.cycles, y: frr.crack_growth_curve!.a, mode: 'lines', name: 'Crack', line: { color: '#ef4444', width: 2 } }],
          plotLayout: { ...BASE, xaxis: { title: { text: 'Cycles' }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'Crack Length' }, gridcolor: '#e5e7eb' }, title: { text: 'Crack Growth (Paris Law)' } },
        }),
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Six Sigma sub-modules
// ---------------------------------------------------------------------------

function extractSixSigma(modules: Record<string, unknown>, out: AssetDescriptor[]) {
  const cap = modules['sixSigma.capability'] as { result?: Any } | null
  if (cap?.result) {
    const r = cap.result
    out.push({
      id: mkId('ss'), module: 'sixSigma', moduleLabel: 'Six Sigma',
      group: 'Process Capability', label: 'Capability Indices', type: 'metrics',
      getData: () => ({
        metrics: [
          { label: 'Cp', value: fmt(r.Cp) },
          { label: 'Cpk', value: fmt(r.Cpk) },
          { label: 'Pp', value: fmt(r.Pp) },
          { label: 'Ppk', value: fmt(r.Ppk) },
          { label: 'Mean', value: fmt(r.mean) },
        ],
      }),
    })
  }
}

// ---------------------------------------------------------------------------
// Folio state helper
// ---------------------------------------------------------------------------

function extractFolioResult<T>(modules: Record<string, unknown>, key: string): { gp: string; st: T }[] {
  const s = modules[key] as Any
  if (!s) return []
  if (s.folios && Array.isArray(s.folios)) {
    return s.folios.map((f: Any) => ({
      gp: f.name || 'Folio',
      st: f as T,
    }))
  }
  return [{ gp: 'Default', st: s as T }]
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function enumerateAssets(): AssetDescriptor[] {
  const state = getProjectState()
  const m = state.modules
  const out: AssetDescriptor[] = []
  extractLifeData(m, out)
  extractALT(m, out)
  extractGrowth(m, out)
  extractWarranty(m, out)
  extractPrediction(m, out)
  extractHypothesis(m, out)
  extractDescriptive(m, out)
  extractDataModeling(m, out)
  extractFTA(m, out)
  extractRBD(m, out)
  extractPoF(m, out)
  extractSixSigma(m, out)
  return out
}
