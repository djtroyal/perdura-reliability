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
import type {
  SummaryResponse, ColumnStats, HistogramResponse, BoxplotResponse,
  RunChartResponse, FrequencyResponse, ContingencyResponse,
} from '../api/descriptive'
import {
  computeSalientPoints, salientTrace,
  type CurveData, type CurveKey,
} from '../components/LifeData/plotOverlays'

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

const GREY = '#e5e7eb'

/** Right-censored (suspension) times parsed from a folio's data rows. */
function folioSuspensions(folio: Any): number[] {
  const rc: number[] = []
  for (const r of folio.rows ?? []) {
    const t = parseFloat(r.time)
    if (isNaN(t) || t <= 0) continue
    if (r.state === 'S') rc.push(t)
  }
  return rc
}

/** Triangle markers along y=0 for suspension times on a curve plot. */
function suspensionMarkerTrace(rc: number[]): Record<string, unknown> | null {
  if (rc.length === 0) return null
  return {
    x: rc, y: rc.map(() => 0), mode: 'markers', type: 'scatter', name: 'Suspensions',
    marker: { color: 'rgba(107,114,128,0.3)', size: 10, symbol: 'triangle-up', line: { color: '#6b7280', width: 1.5 } },
    hovertemplate: 'Suspension: %{x}<extra></extra>',
  }
}

/** Map raw suspension times onto a probability plot's transformed x-axis. */
function probSuspensionTrace(p: Any, rc: number[]): Record<string, unknown> | null {
  if (rc.length === 0) return null
  const lineXRaw: number[] | undefined = p.line_x_raw ?? p.line_x
  const lineX: number[] | undefined = p.line_x
  if (!lineXRaw || !lineX || lineXRaw.length === 0) return null
  const px: number[] = []
  for (const t of rc) {
    let xv: number | null = null
    if (t <= lineXRaw[0]) xv = lineX[0]
    else if (t >= lineXRaw[lineXRaw.length - 1]) xv = lineX[lineX.length - 1]
    else {
      for (let i = 1; i < lineXRaw.length; i++) {
        if (t <= lineXRaw[i]) {
          const frac = (t - lineXRaw[i - 1]) / (lineXRaw[i] - lineXRaw[i - 1] || 1)
          xv = lineX[i - 1] + frac * (lineX[i] - lineX[i - 1])
          break
        }
      }
    }
    if (xv != null) px.push(xv)
  }
  if (px.length === 0) return null
  const yBottom = Math.min(...(p.scatter_y ?? []), ...(p.line_y ?? []))
  return {
    x: px, y: px.map(() => yBottom), mode: 'markers', type: 'scatter', name: 'Suspensions',
    marker: { color: 'rgba(107,114,128,0.3)', size: 10, symbol: 'triangle-up', line: { color: '#6b7280', width: 1.5 } },
    hovertemplate: 'Suspension: %{x}<extra></extra>',
  }
}

function extractLifeData(modules: Record<string, unknown>, out: AssetDescriptor[]) {
  const s = modules['lifeData'] as { folios?: Any[] } | null
  if (!s?.folios) return

  for (const folio of s.folios) {
    const gp = folio.name || 'Folio'
    const showSalient = !!folio.showSalient
    const showSuspensions = !!folio.showSuspensions
    const rc = folioSuspensions(folio)
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
              const plotData: unknown[] = [
                { x: p.scatter_x, y: p.scatter_y, mode: 'markers', name: 'Data', marker: { color: '#3b82f6', size: 6 } },
                { x: p.line_x, y: p.line_y, mode: 'lines', name: distName, line: { color: '#ef4444', width: 2 } },
              ]
              if (showSuspensions) {
                const t = probSuspensionTrace(p, rc)
                if (t) plotData.push(t)
              }
              return {
                plotData,
                plotLayout: { ...BASE, xaxis: { title: { text: p.x_label }, gridcolor: GREY }, yaxis: { title: { text: p.y_label }, gridcolor: GREY }, title: { text: `${distName} Probability Plot` } },
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
                const plotData: unknown[] = [
                  { x: c.x, y: c[key], mode: 'lines', name: distName, line: { color: '#3b82f6', width: 2 } },
                ]
                if (showSalient) {
                  const dist = fit.results.find(r => r.Distribution === distName) as Any
                  const eta = typeof dist?.params?.eta === 'number' ? dist.params.eta : null
                  const pts = computeSalientPoints(c as CurveData, eta)
                  const t = salientTrace(pts, c as CurveData, key as CurveKey)
                  if (t) plotData.push(t)
                }
                if (showSuspensions) {
                  const t = suspensionMarkerTrace(rc)
                  if (t) plotData.push(t)
                }
                return {
                  plotData,
                  plotLayout: { ...BASE, xaxis: { title: { text: 'Time' }, gridcolor: GREY }, yaxis: { title: { text: curve }, gridcolor: GREY }, title: { text: `${distName} — ${curve}` } },
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
        getData: () => {
          const plotData: unknown[] = [
            { x: wb.curves.x, y: wb.curves.sf, mode: 'lines', name: 'SF', line: { color: '#3b82f6', width: 2 } },
          ]
          if (showSuspensions) {
            const t = suspensionMarkerTrace(rc)
            if (t) plotData.push(t)
          }
          return {
            plotData,
            plotLayout: { ...BASE, xaxis: { title: { text: 'Time' }, gridcolor: GREY }, yaxis: { title: { text: 'Survival' }, gridcolor: GREY }, title: { text: `Weibayes (β=${fmt(wb.beta)}, η=${fmt(wb.eta)})` } },
          }
        },
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

function getNumericColumnsFromDataset(ds: Any): { headers: string[]; columns: Record<string, number[]> } {
  if (!ds?.columns?.length || !ds.rows?.length) return { headers: [], columns: {} }
  const headers: string[] = ds.columns
  const columns: Record<string, number[]> = {}
  for (const h of headers) {
    columns[h] = ds.rows
      .map((r: Record<string, string>) => (r[h] ?? '').trim())
      .filter((s: string) => s !== '')
      .map(Number)
      .filter(Number.isFinite)
  }
  return { headers, columns }
}

function extractDescriptive(descState: Any, dataset: Any, group: string, out: AssetDescriptor[]) {
  const s = descState as { results?: Record<string, Any>; analyzeColIdx?: string } | null
  if (!s) return
  const r = s.results ?? {}
  const MOD = 'descriptive'
  const ML = 'Descriptive Statistics'
  const GP = group
  const GC = '#e5e7eb'

  // --- Server-backed results ---

  if (r.summary) {
    const summary = r.summary as SummaryResponse
    const colNames = Object.keys(summary)
    if (colNames.length) {
      out.push({
        id: mkId('desc'), module: MOD, moduleLabel: ML,
        group: GP, label: 'Summary Statistics', type: 'table',
        getData: () => {
          const stats: (keyof ColumnStats)[] = ['n', 'mean', 'median', 'std', 'min', 'Q1', 'Q3', 'max', 'skewness', 'kurtosis']
          const headers = ['Statistic', ...colNames]
          const rows: (string | number)[][] = stats.map(stat => [
            stat,
            ...colNames.map(c => {
              const v = summary[c]?.[stat]
              return v != null && typeof v !== 'object' ? fmt(v as number) : '—'
            }),
          ])
          return { tableHeaders: headers, tableRows: rows }
        },
      })
    }
  }

  if (r.histogram) {
    out.push({
      id: mkId('desc'), module: MOD, moduleLabel: ML,
      group: GP, label: 'Histogram', type: 'plot',
      getData: () => {
        const h = r.histogram as HistogramResponse
        const edges = h.bin_edges
        const centers = edges.slice(0, -1).map((e: number, i: number) => (e + edges[i + 1]) / 2)
        return {
          plotData: [{ x: centers, y: h.counts, type: 'bar', marker: { color: '#3b82f6' } }],
          plotLayout: { ...BASE, xaxis: { title: { text: 'Value' }, gridcolor: GC }, yaxis: { title: { text: 'Count' }, gridcolor: GC }, title: { text: 'Histogram' }, bargap: 0.05 },
        }
      },
    })
  }

  if (r.boxplot) {
    out.push({
      id: mkId('desc'), module: MOD, moduleLabel: ML,
      group: GP, label: 'Box Plot', type: 'plot',
      getData: () => {
        const b = r.boxplot as BoxplotResponse
        return {
          plotData: [{
            type: 'box', name: '',
            q1: [b.Q1], median: [b.median], q3: [b.Q3],
            lowerfence: [b.whisker_low], upperfence: [b.whisker_high],
            marker: { color: '#3b82f6' },
          }],
          plotLayout: { ...BASE, title: { text: 'Box Plot' }, yaxis: { gridcolor: GC } },
        }
      },
    })
    out.push({
      id: mkId('desc'), module: MOD, moduleLabel: ML,
      group: GP, label: 'Boxplot Summary', type: 'metrics',
      getData: () => {
        const b = r.boxplot as BoxplotResponse
        return {
          metrics: [
            { label: 'Min', value: fmt(b.min) },
            { label: 'Q1', value: fmt(b.Q1) },
            { label: 'Median', value: fmt(b.median) },
            { label: 'Q3', value: fmt(b.Q3) },
            { label: 'Max', value: fmt(b.max) },
            { label: 'IQR', value: fmt(b.iqr) },
            { label: 'Outliers', value: String(b.outliers?.length ?? 0) },
          ],
        }
      },
    })
  }

  if (r.runchart) {
    out.push({
      id: mkId('desc'), module: MOD, moduleLabel: ML,
      group: GP, label: 'Run Chart', type: 'plot',
      getData: () => {
        const rc = r.runchart as RunChartResponse
        const x = rc.sequence.map((_: number, i: number) => i + 1)
        return {
          plotData: [
            { x, y: rc.sequence, mode: 'lines+markers', name: 'Data', line: { color: '#3b82f6', width: 1.5 }, marker: { size: 4 } },
            { x: [1, rc.n], y: [rc.median, rc.median], mode: 'lines', name: 'Median', line: { color: '#ef4444', dash: 'dash', width: 1.5 } },
          ],
          plotLayout: { ...BASE, xaxis: { title: { text: 'Observation' }, gridcolor: GC }, yaxis: { title: { text: 'Value' }, gridcolor: GC }, title: { text: 'Run Chart' }, showlegend: true },
        }
      },
    })
    out.push({
      id: mkId('desc'), module: MOD, moduleLabel: ML,
      group: GP, label: 'Run Chart Summary', type: 'metrics',
      getData: () => {
        const rc = r.runchart as RunChartResponse
        return {
          metrics: [
            { label: 'N', value: String(rc.n) },
            { label: 'Median', value: fmt(rc.median) },
            { label: 'Runs', value: String(rc.n_runs) },
            { label: 'Expected Runs', value: fmt(rc.expected_runs) },
            { label: 'Longest Run', value: String(rc.longest_run) },
            { label: 'Runs Test Z', value: fmt(rc.runs_test?.z) },
            { label: 'Runs Test p', value: fmt(rc.runs_test?.p) },
          ],
        }
      },
    })
  }

  if (r.frequency) {
    const fr = r.frequency as FrequencyResponse
    out.push({
      id: mkId('desc'), module: MOD, moduleLabel: ML,
      group: GP, label: 'Frequency Table', type: 'table',
      getData: () => {
        const labels = fr.bin_labels ?? fr.labels ?? fr.counts.map((_: number, i: number) => String(i + 1))
        return {
          tableHeaders: ['Category', 'Count', 'Relative Freq', 'Cumulative Freq'],
          tableRows: labels.map((l: string, i: number) => [l, fr.counts[i], fmt(fr.relative_freq[i]), fmt(fr.cumulative_freq[i])]),
        }
      },
    })
    out.push({
      id: mkId('desc'), module: MOD, moduleLabel: ML,
      group: GP, label: 'Frequency Chart', type: 'plot',
      getData: () => {
        const labels = fr.bin_labels ?? fr.labels ?? fr.counts.map((_: number, i: number) => String(i + 1))
        return {
          plotData: [{ x: labels, y: fr.counts, type: 'bar', marker: { color: '#3b82f6' } }],
          plotLayout: { ...BASE, xaxis: { title: { text: 'Category' }, gridcolor: GC }, yaxis: { title: { text: 'Count' }, gridcolor: GC }, title: { text: 'Frequency Distribution' }, bargap: 0.1 },
        }
      },
    })
  }

  if (r.contingency) {
    const ct = r.contingency as ContingencyResponse
    out.push({
      id: mkId('desc'), module: MOD, moduleLabel: ML,
      group: GP, label: 'Contingency Table', type: 'table',
      getData: () => ({
        tableHeaders: ['', ...ct.col_labels, 'Total'],
        tableRows: [
          ...ct.observed.map((row: number[], i: number) => [ct.row_labels[i], ...row, ct.row_totals[i]]),
          ['Total', ...ct.col_totals, ct.grand_total],
        ],
      }),
    })
    out.push({
      id: mkId('desc'), module: MOD, moduleLabel: ML,
      group: GP, label: 'Chi-Square Results', type: 'metrics',
      getData: () => ({
        metrics: [
          { label: 'Chi-Square', value: fmt(ct.chi2.chi2) },
          { label: 'p-value', value: fmt(ct.chi2.p) },
          { label: 'Degrees of Freedom', value: ct.chi2.dof != null ? String(ct.chi2.dof) : '—' },
        ],
      }),
    })
  }

  // --- Client-side plots (built from the shared dataset) ---

  const { headers, columns } = getNumericColumnsFromDataset(dataset)
  if (!headers.length) return

  // Violin
  out.push({
    id: mkId('desc'), module: MOD, moduleLabel: ML,
    group: GP, label: 'Violin Plot', type: 'plot',
    getData: () => {
      const { headers: hd, columns: cols } = getNumericColumnsFromDataset(dataset)
      if (!hd.length) return {}
      return {
        plotData: hd.map((h, i) => ({
          type: 'violin', y: cols[h], name: h,
          box: { visible: true }, meanline: { visible: true },
          line: { color: COLORS[i % COLORS.length] },
        })),
        plotLayout: { ...BASE, showlegend: true, yaxis: { gridcolor: GC } },
      }
    },
  })

  // Raincloud
  out.push({
    id: mkId('desc'), module: MOD, moduleLabel: ML,
    group: GP, label: 'Raincloud Plot', type: 'plot',
    getData: () => {
      const { headers: hd, columns: cols } = getNumericColumnsFromDataset(dataset)
      if (!hd.length) return {}
      const traces: unknown[] = []
      const layout: Any = { ...BASE, showlegend: false, margin: { t: 30, r: 30, b: 50, l: 100 } }
      const n = hd.length
      hd.forEach((h, i) => {
        const vals = cols[h]
        const color = COLORS[i % COLORS.length]
        const yIdx = i === 0 ? '' : `${i + 1}`
        const gap = 0.03
        const cellH = (1 - gap * (n - 1)) / n
        const lo = i * (cellH + gap)
        const hi = lo + cellH
        layout[`yaxis${yIdx}`] = { domain: [1 - hi, 1 - lo], showticklabels: false, zeroline: false, showgrid: false, title: { text: h, font: { size: 10 } } }
        if (i === 0) layout['xaxis'] = { gridcolor: GC, title: { text: 'Value' } }
        else layout[`xaxis${i + 1}`] = { gridcolor: GC, matches: 'x', showticklabels: i === n - 1 }
        traces.push({ type: 'violin', x: vals, side: 'positive', line: { color, width: 1 }, meanline: { visible: true }, width: 1.8, points: false, scalemode: 'width', yaxis: `y${yIdx}`, name: h, showlegend: false })
        traces.push({ type: 'box', x: vals, marker: { color, size: 2 }, line: { color, width: 1 }, boxpoints: false, width: 0.12, yaxis: `y${yIdx}`, showlegend: false, name: h })
        const jy = vals.map(() => -0.3 + (Math.random() - 0.5) * 0.2)
        traces.push({ type: 'scatter', mode: 'markers', x: vals, y: jy, yaxis: `y${yIdx}`, marker: { color, size: 3, opacity: 0.4 }, showlegend: false, name: h })
      })
      return { plotData: traces, plotLayout: layout }
    },
  })

  // Scatter Matrix (first 6 columns)
  if (headers.length >= 2) {
    out.push({
      id: mkId('desc'), module: MOD, moduleLabel: ML,
      group: GP, label: 'Scatter Matrix', type: 'plot',
      getData: () => {
        const { headers: hd, columns: cols } = getNumericColumnsFromDataset(dataset)
        if (hd.length < 2) return {}
        const dims = hd.slice(0, 6)
        const traces: unknown[] = []
        const n = dims.length
        for (let rr = 0; rr < n; rr++) {
          for (let c = 0; c < n; c++) {
            if (rr === c) {
              traces.push({ type: 'histogram', x: cols[dims[c]], xaxis: `x${c + 1}`, yaxis: `y${rr + 1}`, marker: { color: COLORS[c % COLORS.length], opacity: 0.6 }, showlegend: false, nbinsx: 15 })
            } else {
              traces.push({ type: 'scatter', mode: 'markers', x: cols[dims[c]], y: cols[dims[rr]], xaxis: `x${c + 1}`, yaxis: `y${rr + 1}`, marker: { color: COLORS[c % COLORS.length], size: 4, opacity: 0.6 }, showlegend: false })
            }
          }
        }
        const gap = 0.04
        const cellSize = (1 - gap * (n - 1)) / n
        const layout: Any = { ...BASE, margin: { t: 30, r: 30, b: 40, l: 40 }, showlegend: false }
        for (let i = 0; i < n; i++) {
          const lo = i * (cellSize + gap)
          const hi = lo + cellSize
          layout[`xaxis${i + 1}`] = { domain: [lo, hi], gridcolor: GC, tickfont: { size: 8 } }
          layout[`yaxis${i + 1}`] = { domain: [1 - hi, 1 - lo], title: { text: dims[i], font: { size: 9 } }, gridcolor: GC, tickfont: { size: 8 } }
        }
        return { plotData: traces, plotLayout: layout }
      },
    })
  }

  // Correlation Heatmap
  if (headers.length >= 2) {
    out.push({
      id: mkId('desc'), module: MOD, moduleLabel: ML,
      group: GP, label: 'Correlation Heatmap', type: 'plot',
      getData: () => {
        const { headers: hd, columns: cols } = getNumericColumnsFromDataset(dataset)
        if (hd.length < 2) return {}
        const n = hd.length
        const matrix: number[][] = []
        for (let i = 0; i < n; i++) {
          const row: number[] = []
          for (let j = 0; j < n; j++) {
            const xi = cols[hd[i]], xj = cols[hd[j]]
            const len = Math.min(xi.length, xj.length)
            const xm = xi.slice(0, len).reduce((a, b) => a + b, 0) / len
            const ym = xj.slice(0, len).reduce((a, b) => a + b, 0) / len
            let num = 0, dx = 0, dy = 0
            for (let k = 0; k < len; k++) { num += (xi[k] - xm) * (xj[k] - ym); dx += (xi[k] - xm) ** 2; dy += (xj[k] - ym) ** 2 }
            row.push(dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : i === j ? 1 : 0)
          }
          matrix.push(row)
        }
        return {
          plotData: [{
            type: 'heatmap', z: matrix, x: hd, y: hd,
            colorscale: [[0, '#2563eb'], [0.5, '#ffffff'], [1, '#dc2626']], zmin: -1, zmax: 1,
            text: matrix.map(row => row.map(v => v.toFixed(2))), texttemplate: '%{text}', showscale: true,
          }],
          plotLayout: { ...BASE, margin: { t: 30, r: 20, b: 80, l: 80 }, xaxis: { tickangle: -30 }, yaxis: { autorange: 'reversed' } },
        }
      },
    })
  }

  // QQ Plot
  {
    const analyzeIdx = parseInt(s.analyzeColIdx ?? '0', 10) || 0
    const analyzeHeader = headers[analyzeIdx] ?? headers[0]
    if (analyzeHeader && columns[analyzeHeader]?.length >= 2) {
      out.push({
        id: mkId('desc'), module: MOD, moduleLabel: ML,
        group: GP, label: `QQ Plot (${analyzeHeader})`, type: 'plot',
        getData: () => {
          const fresh = getNumericColumnsFromDataset(dataset)
          const col = fresh.headers[analyzeIdx] ?? fresh.headers[0]
          const vals = [...(fresh.columns[col] ?? [])].sort((a, b) => a - b)
          const n = vals.length
          if (n < 2) return {}
          const mean = vals.reduce((a, b) => a + b, 0) / n
          const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1))
          const invNorm = (p: number) => {
            const a1 = -3.969683028665376e1, a2 = 2.209460984245205e2, a3 = -2.759285104469687e2
            const a4 = 1.383577518672690e2, a5 = -3.066479806614716e1, a6 = 2.506628277459239e0
            const b1 = -5.447609879822406e1, b2 = 1.615858368580409e2, b3 = -1.556989798598866e2
            const b4 = 6.680131188771972e1, b5 = -1.328068155288572e1
            const c1 = -7.784894002430293e-3, c2 = -3.223964580411365e-1, c3 = -2.400758277161838e0
            const c4 = -2.549732539343734e0, c5 = 4.374664141464968e0, c6 = 2.938163982698783e0
            const d1 = 7.784695709041462e-3, d2 = 3.224671290700398e-1, d3 = 2.445134137142996e0, d4 = 3.754408661907416e0
            const pLow = 0.02425, pHigh = 1 - pLow
            let q: number
            if (p < pLow) { const qq = Math.sqrt(-2 * Math.log(p)); q = (((((c1 * qq + c2) * qq + c3) * qq + c4) * qq + c5) * qq + c6) / ((((d1 * qq + d2) * qq + d3) * qq + d4) * qq + 1) }
            else if (p <= pHigh) { const qq = p - 0.5; const rr = qq * qq; q = (((((a1 * rr + a2) * rr + a3) * rr + a4) * rr + a5) * rr + a6) * qq / (((((b1 * rr + b2) * rr + b3) * rr + b4) * rr + b5) * rr + 1) }
            else { const qq = Math.sqrt(-2 * Math.log(1 - p)); q = -(((((c1 * qq + c2) * qq + c3) * qq + c4) * qq + c5) * qq + c6) / ((((d1 * qq + d2) * qq + d3) * qq + d4) * qq + 1) }
            return q
          }
          const theoretical = vals.map((_, i) => invNorm((i + 0.5) / n))
          const standardized = std > 0 ? vals.map(v => (v - mean) / std) : vals
          const lo = Math.min(...theoretical, ...standardized)
          const hi = Math.max(...theoretical, ...standardized)
          return {
            plotData: [
              { x: theoretical, y: standardized, mode: 'markers', name: 'Data', marker: { color: '#3b82f6', size: 6 } },
              { x: [lo, hi], y: [lo, hi], mode: 'lines', name: 'Reference', line: { color: '#ef4444', dash: 'dash' } },
            ],
            plotLayout: { ...BASE, xaxis: { title: { text: 'Theoretical quantiles' }, gridcolor: GC }, yaxis: { title: { text: 'Sample quantiles' }, gridcolor: GC }, title: { text: `Normal QQ Plot — ${col}` }, showlegend: true },
          }
        },
      })
    }
  }

  // ECDF
  out.push({
    id: mkId('desc'), module: MOD, moduleLabel: ML,
    group: GP, label: 'ECDF', type: 'plot',
    getData: () => {
      const { headers: hd, columns: cols } = getNumericColumnsFromDataset(dataset)
      if (!hd.length) return {}
      const traces = hd.map((h, idx) => {
        const sorted = [...cols[h]].sort((a, b) => a - b)
        const n = sorted.length
        const yy = sorted.map((_, i) => (i + 1) / n)
        return { x: sorted, y: yy, mode: 'lines', name: h, line: { color: COLORS[idx % COLORS.length], width: 2, shape: 'hv' } }
      })
      return {
        plotData: traces,
        plotLayout: { ...BASE, xaxis: { title: { text: 'Value' }, gridcolor: GC }, yaxis: { title: { text: 'Cumulative probability' }, gridcolor: GC, range: [0, 1.02] }, title: { text: 'ECDF' }, showlegend: true },
      }
    },
  })
}

// ---------------------------------------------------------------------------
// Statistical Modeling — Regression & ML
// ---------------------------------------------------------------------------

function extractDataModeling(dmState: Any, group: string, out: AssetDescriptor[]) {
  const s = dmState as { fitted?: Any[] } | null
  if (!s?.fitted?.length) return
  const GP = group
  for (const model of s.fitted) {
    const reg = model.reg as FitRegressionResponse | null | undefined
    const ml = model.ml as Any | null | undefined
    const name = model.name || model.id || 'Model'

    if (reg) {
      const isPoly = reg.model === 'polynomial'
      const isLogistic = reg.model === 'logistic'

      out.push({
        id: mkId('dm'), module: 'dataModeling', moduleLabel: 'Regression & ML',
        group: GP, label: `${name} — Coefficients`, type: 'table',
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
          group: GP, label: `${name} — Actual vs Fitted`, type: 'plot',
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
          group: GP, label: `${name} — Residuals`, type: 'plot',
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
          group: GP, label: `${name} — ROC Curve`, type: 'plot',
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
          group: GP, label: `${name} — Fit Curve`, type: 'plot',
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
          group: GP, label: `${name} — Feature Importance`, type: 'plot',
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
// Statistical Modeling — iterate every Analysis tab (folio)
// ---------------------------------------------------------------------------

function extractStatisticalModeling(modules: Record<string, unknown>, out: AssetDescriptor[]) {
  const folioState = modules['dataAnalysisFolios'] as {
    analyses?: { id: string; name: string }[]
    activeId?: string
    snapshots?: Record<string, { data?: Any; descriptive?: Any; modeling?: Any }>
  } | null

  const liveDesc = modules['descriptive']
  const liveDM = modules['dataModeling']
  const liveData = modules['dataAnalysisData']

  // No analysis-tab system present: fall back to the live state under a single group.
  if (!folioState?.analyses?.length) {
    extractDescriptive(liveDesc, liveData, 'Analysis 1', out)
    extractDataModeling(liveDM, 'Analysis 1', out)
    return
  }

  for (const a of folioState.analyses) {
    const isActive = a.id === folioState.activeId
    const snap = folioState.snapshots?.[a.id]
    const descState = isActive ? liveDesc : snap?.descriptive
    const dmState = isActive ? liveDM : snap?.modeling
    const dataset = isActive ? liveData : snap?.data
    extractDescriptive(descState, dataset, a.name, out)
    extractDataModeling(dmState, a.name, out)
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function enumerateAssets(): AssetDescriptor[] {
  idSeq = 0
  const state = getProjectState()
  const m = state.modules
  const out: AssetDescriptor[] = []
  extractLifeData(m, out)
  extractALT(m, out)
  extractGrowth(m, out)
  extractWarranty(m, out)
  extractPrediction(m, out)
  extractHypothesis(m, out)
  extractStatisticalModeling(m, out)
  extractFTA(m, out)
  extractRBD(m, out)
  extractPoF(m, out)
  extractSixSigma(m, out)
  return out
}
