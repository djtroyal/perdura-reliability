import { getPlotMarkupForAsset, getProjectState } from './project'
import { mergePlotMarkup, splitUserMarkupFromLayout } from './plotMarkup'
import type {
  FitResponse, DistPlotData, NonparametricResponse,
  SpecialModelResponse, WeibayesResponse,
  ALTFitResponse, GrowthResponse, MCFResponse,
  WarrantyForecastResponse,
  PredictionResponse,
  DeratingResponse,
  SampleSizeResponse,
  AvailabilityResponse, MaintainabilityResponse, SparesResponse,
  AllocationResponse,
  ReplacementPolicyResponse, PMIntervalResponse, CostForecastResponse,
  AvailabilitySensitivityResponse, MarginTestResponse, ExpChiSquaredResponse,
  VirtualAgeSimulationResponse,
  BayesianRDTResponse, DifferenceDetectionResponse,
  DegradationResponse, DestructiveDegradationResponse,
} from '../api/client'
import { betaPdfCurve } from '../components/shared/stats'
import type { GenerateDesignResponse } from '../api/doe'
import type { HypothesisResult, AnovaTableRow } from '../api/hypothesis'
import type { FitRegressionResponse } from '../api/regression'
import type { ModelAsset, ModelingRun, ModelResult } from '../api/modeling'
import type {
  SummaryResponse, ColumnStats, HistogramResponse, BoxplotResponse,
  RunChartResponse, FrequencyResponse, ContingencyResponse,
} from '../api/descriptive'
import {
  computeSalientPoints, salientTrace,
  type CurveData, type CurveKey,
} from '../components/LifeData/plotOverlays'
import { listRuntimePlotAssets } from './runtimePlotAssets'

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

    const specified = folio.specResult as Any | null | undefined
    if (specified?.distribution && specified?.curves?.x?.length) {
      out.push({
        id: mkId('lda'), module: 'lifeData', moduleLabel: 'Life Data Analysis',
        group: gp, label: `${specified.distribution} Specified Model Summary`, type: 'metrics',
        getData: () => ({
          metrics: [
            { label: 'Distribution', value: specified.distribution },
            ...Object.entries(specified.params ?? {}).map(([key, value]) => ({ label: key, value: fmt(value as number) })),
            { label: 'Mean', value: fmt(specified.stats?.mean) },
            { label: 'Median', value: fmt(specified.stats?.median) },
            { label: 'Std Dev', value: fmt(specified.stats?.std) },
          ],
        }),
      })
      for (const curve of ['PDF', 'CDF', 'SF', 'HF'] as const) {
        const key = curve.toLowerCase()
        out.push({
          id: mkId('lda'), module: 'lifeData', moduleLabel: 'Life Data Analysis',
          group: gp, label: `${specified.distribution} Specified ${curve}`, type: 'plot',
          getData: () => ({
            plotData: [{
              x: specified.curves.x, y: specified.curves[key], mode: 'lines',
              name: specified.distribution, line: { color: COLORS[0], width: 2 },
            }],
            plotLayout: { ...BASE, xaxis: { title: { text: 'Time' }, gridcolor: GREY }, yaxis: { title: { text: curve }, gridcolor: GREY }, title: { text: `${specified.distribution} (specified) — ${curve}` } },
          }),
        })
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
          if (wb.curves.sf_propagated_lower && wb.curves.sf_propagated_upper) {
            plotData.push(
              { x: wb.curves.x, y: wb.curves.sf_propagated_upper, mode: 'lines', name: 'Uncertainty upper', line: { color: '#93c5fd', width: 1, dash: 'dash' } },
              { x: wb.curves.x, y: wb.curves.sf_propagated_lower, mode: 'lines', name: 'Uncertainty lower', fill: 'tonexty', fillcolor: 'rgba(147,197,253,0.2)', line: { color: '#93c5fd', width: 1, dash: 'dash' } },
            )
          }
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

    const cfm = folio.cfmResult as Any | null | undefined
    if (cfm?.modes?.length) {
      out.push({
        id: mkId('lda'), module: 'lifeData', moduleLabel: 'Life Data Analysis',
        group: gp, label: 'CFM Parameter Summary', type: 'table',
        getData: () => {
          const firstGood = cfm.modes.find((m: Any) => !m.error && Object.keys(m.params).length > 0)
          const pNames = firstGood ? Object.keys(firstGood.params).filter((k: string) => !k.endsWith('_lower') && !k.endsWith('_upper') && !k.endsWith('_se')) : []
          return {
            tableHeaders: ['Mode', 'Failures', 'Suspensions', ...pNames],
            tableRows: cfm.modes.map((m: Any) => [
              m.mode, m.n_failures, m.n_suspensions,
              ...pNames.map((p: string) => m.params[p] != null ? fmt(m.params[p]) : '—'),
            ]),
          }
        },
      })

      // R(t) query metrics
      const rt = cfm.system_reliability_at_t as Any | null | undefined
      if (rt) {
        out.push({
          id: mkId('lda'), module: 'lifeData', moduleLabel: 'Life Data Analysis',
          group: gp, label: `CFM Reliability @ t=${rt.time}`, type: 'metrics',
          getData: () => ({
            metrics: [
              { label: `System R(t=${rt.time})`, value: fmt(rt.system_reliability) },
              { label: 'System F(t)', value: fmt(rt.system_unreliability) },
              ...Object.entries(rt.mode_reliability ?? {}).map(([mode, r]) => ({
                label: `R(t) — ${mode}`, value: fmt(r as number),
              })),
            ],
          }),
        })
      }

      // Per-mode probability plots
      cfm.modes.forEach((m: Any, mi: number) => {
        if (m.error || !m.probability_plot) return
        const color = COLORS[mi % COLORS.length]
        out.push({
          id: mkId('lda'), module: 'lifeData', moduleLabel: 'Life Data Analysis',
          group: gp, label: `CFM ${m.mode} Probability Plot`, type: 'plot',
          getData: () => {
            const pp = m.probability_plot
            return {
              plotData: [
                { x: pp.scatter_x, y: pp.scatter_y, mode: 'markers', name: `${m.mode} data`, marker: { color, size: 6 } },
                { x: pp.line_x, y: pp.line_y, mode: 'lines', name: `${m.mode} fit`, line: { color, width: 2 } },
              ],
              plotLayout: { ...BASE, xaxis: { title: { text: pp.x_label }, gridcolor: GREY }, yaxis: { title: { text: pp.y_label }, gridcolor: GREY }, title: { text: `CFM ${m.mode} — Probability Plot (${m.n_failures}F, ${m.n_suspensions}S)` } },
            }
          },
        })
      })

      // System + per-mode curves (SF / CDF / PDF / HF)
      const sc = cfm.system_curves as Any | null | undefined
      if (sc?.x?.length) {
        const CFM_CURVES: { key: string; sysKey: string; modeKey: string; label: string; ytitle: string; range?: [number, number] }[] = [
          { key: 'SF', sysKey: 'system_sf', modeKey: 'mode_sf', label: 'System Reliability (SF)', ytitle: 'R(t)', range: [0, 1] },
          { key: 'CDF', sysKey: 'system_cdf', modeKey: 'mode_cdf', label: 'System Unreliability (CDF)', ytitle: 'F(t)', range: [0, 1] },
          { key: 'PDF', sysKey: 'system_pdf', modeKey: 'mode_pdf', label: 'System Density (PDF)', ytitle: 'f(t)' },
          { key: 'HF', sysKey: 'system_hf', modeKey: 'mode_hf', label: 'System Hazard (HF)', ytitle: 'h(t)' },
        ]
        for (const cv of CFM_CURVES) {
          if (!sc[cv.sysKey]?.length) continue
          out.push({
            id: mkId('lda'), module: 'lifeData', moduleLabel: 'Life Data Analysis',
            group: gp, label: `CFM ${cv.label}`, type: 'plot',
            getData: () => {
              const traces: unknown[] = [
                { x: sc.x, y: sc[cv.sysKey], mode: 'lines', name: 'System', line: { color: '#1e293b', width: 2.5 } },
              ]
              const modeCurves = sc[cv.modeKey] as Record<string, number[]> | undefined
              if (modeCurves) {
                let i = 0
                for (const [mode, y] of Object.entries(modeCurves)) {
                  traces.push({ x: sc.x, y, mode: 'lines', name: mode, line: { color: COLORS[i % COLORS.length], dash: 'dash', width: 1.5 } })
                  i++
                }
              }
              return {
                plotData: traces,
                plotLayout: { ...BASE, xaxis: { title: { text: 'Time' }, gridcolor: GREY }, yaxis: { title: { text: cv.ytitle }, ...(cv.range ? { range: cv.range } : {}), gridcolor: GREY }, title: { text: `Competing Failure Modes — ${cv.label}` } },
              }
            },
          })
        }
      }

      // Monte Carlo simulation summary
      const mc = folio.cfmMcResult as Any | null | undefined
      if (mc?.summary && Object.keys(mc.summary).length) {
        out.push({
          id: mkId('lda'), module: 'lifeData', moduleLabel: 'Life Data Analysis',
          group: gp, label: 'CFM MC Simulation Summary', type: 'table',
          getData: () => ({
            tableHeaders: ['Mode / Group ID', 'Failures', 'Suspensions', 'Mean Failure Time'],
            tableRows: Object.entries(mc.summary).map(([mode, s]: [string, Any]) => [
              mode, s.n_failures, s.n_suspensions, s.mean_failure_time != null ? fmt(s.mean_failure_time) : '—',
            ]),
          }),
        })
      }
    }

    // Stress-Strength Interference
    const ss = folio.ssResult as Any | null | undefined
    if (ss?.curves?.x?.length) {
      out.push({
        id: mkId('lda'), module: 'lifeData', moduleLabel: 'Life Data Analysis',
        group: gp, label: 'Stress-Strength Interference', type: 'plot',
        getData: () => ({
          plotData: [
            { x: ss.curves.x, y: ss.curves.stress_pdf, mode: 'lines', name: `Stress (${folio.ssStressDist ?? ''})`, line: { color: '#ef4444', width: 2 }, fill: 'tozeroy', fillcolor: 'rgba(239,68,68,0.15)' },
            { x: ss.curves.x, y: ss.curves.strength_pdf, mode: 'lines', name: `Strength (${folio.ssStrengthDist ?? ''})`, line: { color: '#3b82f6', width: 2 }, fill: 'tozeroy', fillcolor: 'rgba(59,130,246,0.15)' },
          ],
          plotLayout: { ...BASE, xaxis: { title: { text: 'Value' }, gridcolor: GREY }, yaxis: { title: { text: 'PDF' }, gridcolor: GREY }, title: { text: 'Stress-Strength Interference' }, showlegend: true },
        }),
      })
      out.push({
        id: mkId('lda'), module: 'lifeData', moduleLabel: 'Life Data Analysis',
        group: gp, label: 'Stress-Strength Summary', type: 'metrics',
        getData: () => ({
          metrics: [
            { label: 'P(failure)', value: fmt(ss.probability_of_failure) },
            { label: 'Reliability', value: fmt(ss.reliability) },
            ...(folio.ssStressDist ? [{ label: 'Stress dist', value: String(folio.ssStressDist) }] : []),
            ...(folio.ssStrengthDist ? [{ label: 'Strength dist', value: String(folio.ssStrengthDist) }] : []),
          ],
        }),
      })
    }
  }
}

// ---------------------------------------------------------------------------
// ALT
// ---------------------------------------------------------------------------

function extractALT(modules: Record<string, unknown>, out: AssetDescriptor[]) {
  const folio = extractFolioResult<{ result?: ALTFitResponse | null; psResult?: SampleSizeResponse | null }>(modules, 'alt')
  for (const { gp, st } of folio) {
    const r = st.result
    if (r) {
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
      if (r.model_details && Object.keys(r.model_details).length) {
        const md = r.model_details
        out.push({
          id: mkId('alt'), module: 'alt', moduleLabel: 'Reliability Testing',
          group: gp, label: 'Model Details (parameters & life at use stress)', type: 'table',
          getData: () => ({
            tableHeaders: ['Model', 'a', 'b', 'c', 'Shape', 'B10', 'B50 (median)', 'Mean'],
            tableRows: Object.entries(md).map(([name, d]) => [
              name, fmt(d.a), fmt(d.b), fmt(d.c), fmt(d.shape),
              fmt(d.life_b10), fmt(d.life_b50), fmt(d.life_mean),
            ]),
          }),
        })
      }
      const bestLifeStressPlot = r.best_model ? r.life_stress_plots?.[r.best_model] : null
      if (bestLifeStressPlot) {
        const p = bestLifeStressPlot
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
    const ps = st.psResult
    if (ps) {
      out.push({
        id: mkId('alt'), module: 'alt', moduleLabel: 'Reliability Testing',
        group: gp, label: 'Sample Size / Test Planner', type: 'metrics',
        getData: () => ({
          metrics: [
            { label: 'Method', value: ps.method },
            { label: 'Required n', value: ps.n != null ? String(ps.n) : '—' },
            { label: 'Test Time', value: ps.test_time != null ? fmt(ps.test_time) : '—' },
            { label: 'Reliability (R)', value: fmt(ps.R) },
            { label: 'Confidence', value: `${Math.round(ps.CI * 100)}%` },
            { label: 'Allowable Failures', value: String(ps.failures) },
            ...(ps.eta != null ? [{ label: 'Weibull η', value: fmt(ps.eta) }] : []),
          ],
        }),
      })
      if (ps.oc_curve) {
        const oc = ps.oc_curve
        out.push({
          id: mkId('alt'), module: 'alt', moduleLabel: 'Reliability Testing',
          group: gp, label: 'OC Curve', type: 'plot',
          getData: () => ({
            plotData: [
              { x: oc.R, y: oc.P_accept, mode: 'lines', name: 'P(accept)', line: { color: '#3b82f6', width: 2 } },
              { x: [oc.R_demonstrated, oc.R_demonstrated], y: [0, 1], mode: 'lines', name: `R = ${oc.R_demonstrated.toFixed(4)}`, line: { color: '#ef4444', width: 1.5, dash: 'dash' } },
            ],
            plotLayout: { ...BASE, xaxis: { title: { text: 'True Reliability' }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'P(accept)' }, range: [0, 1], gridcolor: '#e5e7eb' }, title: { text: 'Operating Characteristic Curve' } },
          }),
        })
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Growth
// ---------------------------------------------------------------------------

function appendMCFAssets(group: string, result: MCFResponse, out: AssetDescriptor[]) {
  const np = result.nonparametric
  const boundsAvailable = np.interval_point_available.some(Boolean)
  out.push({
    id: mkId('mcf'), module: 'growth', moduleLabel: 'Reliability Growth',
    group, label: 'Mean Cumulative Function', type: 'plot',
    getData: () => ({
      plotData: [
        ...(boundsAvailable ? [
          {
            x: np.time, y: np.MCF_upper, mode: 'lines', name: `Upper ${fmt(100 * np.CI)}%`,
            line: { width: 0 }, showlegend: false,
          },
          {
            x: np.time, y: np.MCF_lower, mode: 'lines', name: 'MCF interval',
            fill: 'tonexty', fillcolor: 'rgba(59,130,246,0.12)', line: { width: 0 },
          },
        ] : []),
        {
          x: np.time, y: np.MCF, mode: 'lines+markers', name: 'Non-parametric MCF',
          line: { color: '#3b82f6', width: 2, shape: 'hv' }, marker: { size: 5 },
        },
        ...(result.parametric ? [{
          x: result.parametric.time, y: result.parametric.MCF,
          mode: 'lines', name: 'Power-law MCF',
          line: { color: '#ef4444', width: 2, dash: 'dash' },
        }] : []),
      ],
      plotLayout: {
        ...BASE,
        xaxis: { title: { text: 'Time' }, gridcolor: '#e5e7eb' },
        yaxis: { title: { text: 'Mean cumulative recurrences' }, gridcolor: '#e5e7eb', rangemode: 'tozero' },
        title: { text: 'Mean Cumulative Function' },
      },
    }),
  })
  out.push({
    id: mkId('mcf'), module: 'growth', moduleLabel: 'Reliability Growth',
    group, label: 'MCF Point Estimates and Interval Availability', type: 'table',
    getData: () => ({
      tableHeaders: [
        'Time', 'MCF', 'Lower', 'Upper', 'Std. error', 'At risk', 'Events',
        'Interval available', 'Sparse tail', 'Valid bootstrap replicates',
      ],
      tableRows: np.time.map((time, index) => [
        fmt(time), fmt(np.MCF[index]), fmt(np.MCF_lower[index]),
        fmt(np.MCF_upper[index]), fmt(np.standard_error[index]),
        np.at_risk[index], np.events_at_time[index],
        np.interval_point_available[index] ? 'Yes' : 'No',
        np.sparse_tail[index] ? 'Yes' : 'No',
        np.bootstrap ? `${np.bootstrap.valid_replicates[index]} / ${np.bootstrap.samples}` : '—',
      ]),
    }),
  })
  out.push({
    id: mkId('mcf'), module: 'growth', moduleLabel: 'Reliability Growth',
    group, label: 'MCF Summary', type: 'metrics',
    getData: () => ({
      metrics: [
        { label: 'Systems', value: String(np.n_systems) },
        { label: 'Events', value: String(np.n_events) },
        { label: 'Confidence Level', value: fmt(np.CI) },
        { label: 'Variance Method', value: np.variance_method },
        { label: 'Interval Method', value: np.interval_method },
        { label: 'Interval Status', value: np.interval_status },
        { label: 'Interval Reason', value: np.interval_reason ?? '—' },
        { label: 'Data Contract', value: np.data_contract },
        { label: 'Descriptive Shape', value: result.trend.trend },
        { label: 'Shape Method', value: `${result.trend.method} (not inferential)` },
        { label: 'Shape Detail', value: result.trend.detail },
        { label: 'Assumptions', value: result.assumptions.join(' | ') },
      ],
    }),
  })
  if (result.parametric) {
    const par = result.parametric
    out.push({
      id: mkId('mcf'), module: 'growth', moduleLabel: 'Reliability Growth',
      group, label: 'MCF Power-law Fit', type: 'metrics',
      getData: () => ({
        metrics: [
          { label: 'Beta', value: fmt(par.beta) },
          { label: 'Beta Lower', value: fmt(par.beta_lower) },
          { label: 'Beta Upper', value: fmt(par.beta_upper) },
          { label: 'Beta Interval Method', value: par.beta_interval_method },
          { label: 'Lambda', value: fmt(par.Lambda) },
          { label: 'log Lambda', value: fmt(par.log_Lambda) },
          { label: 'Alpha', value: fmt(par.alpha) },
          { label: 'Endpoint Time', value: fmt(par.endpoint_time) },
          { label: 'Endpoint MCF', value: fmt(par.endpoint_MCF) },
          { label: 'Endpoint MCF Lower', value: fmt(par.endpoint_MCF_lower) },
          { label: 'Endpoint MCF Upper', value: fmt(par.endpoint_MCF_upper) },
          { label: 'Endpoint Interval Method', value: par.endpoint_MCF_interval_method },
          { label: 'Fit Status', value: par.converged ? 'Converged' : 'Not converged' },
          { label: 'Interval Status', value: par.interval_status },
          { label: 'Optimizer', value: par.optimizer },
          { label: 'Descriptive log-log R²', value: fmt(par.r_squared) },
        ],
      }),
    })
  }
}

function extractGrowth(modules: Record<string, unknown>, out: AssetDescriptor[]) {
  const folio = extractFolioResult<{
    result?: GrowthResponse | null
    mcf?: { result?: MCFResponse | null }
  }>(modules, 'growth')
  for (const { gp, st } of folio) {
    if (st.mcf?.result) appendMCFAssets(gp, st.mcf.result, out)
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
    if (r.intensity_curve && r.interval_context) {
      out.push({
        id: mkId('grw'), module: 'growth', moduleLabel: 'Reliability Growth',
        group: gp, label: 'Observed vs Fitted Failure Intensity', type: 'plot',
        getData: () => {
          const context = r.interval_context!
          const midpoints = context.interval_start.map(
            (start, i) => (start + context.interval_end[i]) / 2,
          )
          return {
            plotData: [
              {
                x: r.intensity_curve!.t, y: r.intensity_curve!.instantaneous,
                mode: 'lines', name: 'Fitted instantaneous intensity',
                line: { color: '#2563eb', width: 2 },
              },
              {
                x: midpoints, y: context.observed_average_intensity,
                mode: 'markers', name: 'Observed interval intensity',
                marker: { color: '#ef4444', size: 8 },
              },
              {
                x: midpoints, y: context.fitted_average_intensity,
                mode: 'markers', name: 'Fitted interval average',
                marker: { color: '#10b981', size: 8, symbol: 'diamond-open' },
              },
            ],
            plotLayout: {
              ...BASE,
              xaxis: { title: { text: 'Time' }, gridcolor: '#e5e7eb' },
              yaxis: { title: { text: 'Failures per unit time' }, gridcolor: '#e5e7eb', rangemode: 'tozero' },
              title: { text: 'Observed vs Fitted Failure Intensity' },
            },
          }
        },
      })
      out.push({
        id: mkId('grw'), module: 'growth', moduleLabel: 'Reliability Growth',
        group: gp, label: 'Interval Counts and Intensities', type: 'table',
        getData: () => ({
          tableHeaders: ['Start', 'End', 'Observed failures', 'Expected failures', 'Observed avg. intensity', 'Fitted avg. intensity'],
          tableRows: r.interval_context!.interval_start.map((start, i) => [
            fmt(start),
            fmt(r.interval_context!.interval_end[i]),
            r.interval_context!.observed_count[i],
            fmt(r.interval_context!.expected_count[i]),
            fmt(r.interval_context!.observed_average_intensity[i]),
            fmt(r.interval_context!.fitted_average_intensity[i]),
          ]),
        }),
      })
    }
    if (r.parameter_sets) {
      out.push({
        id: mkId('grw'), module: 'growth', moduleLabel: 'Reliability Growth',
        group: gp, label: 'Point-estimator Comparison', type: 'table',
        getData: () => ({
          tableHeaders: ['Estimator', 'Reported', 'Beta', 'Lambda', 'log Lambda', 'Growth rate', 'Intensity at T', 'Instantaneous MTBF', 'Cumulative MTBF'],
          tableRows: ([
            ['mle', 'Raw maximum likelihood', r.parameter_sets!.mle],
            ['modified_mle', 'Bias-corrected / modified MLE', r.parameter_sets!.modified_mle],
          ] as const).filter(([, , values]) => values != null).map(([key, label, values]) => [
            label,
            r.parameter_sets!.selected === key ? 'Yes' : 'No',
            fmt(values?.beta),
            fmt(values?.Lambda),
            fmt(values?.log_Lambda),
            fmt(values?.growth_rate),
            fmt(values?.instantaneous_failure_intensity_at_T),
            fmt(values?.instantaneous_mtbf_at_T),
            fmt(values?.cumulative_mtbf_at_T),
          ]),
        }),
      })
    }
    if (r.confidence) {
      out.push({
        id: mkId('grw'), module: 'growth', moduleLabel: 'Reliability Growth',
        group: gp, label: 'Uncertainty Intervals', type: 'table',
        getData: () => ({
          tableHeaders: ['Quantity', 'Reported estimate', 'Reported estimate basis', 'Interval reference estimate', 'Interval reference basis', 'Lower', 'Upper', 'Confidence', 'Method', 'Coverage status', 'Warning'],
          tableRows: Object.entries(r.confidence!.intervals).map(([key, interval]) => [
            key.split('_').join(' '),
            fmt(interval.estimate),
            interval.reported_estimate_basis ?? '—',
            fmt(interval.interval_reference_estimate),
            interval.interval_reference_basis ?? '—',
            interval.available ? fmt(interval.lower) : 'Unavailable',
            interval.available ? fmt(interval.upper) : 'Unavailable',
            `${fmt(100 * r.confidence!.level)}%`,
            interval.method ?? 'Unavailable',
            interval.coverage_status ?? interval.status ?? '—',
            interval.warning ?? '—',
          ]),
        }),
      })
      if (r.confidence.one_sided_bounds
        && Object.keys(r.confidence.one_sided_bounds).length > 0) {
        out.push({
          id: mkId('grw'), module: 'growth', moduleLabel: 'Reliability Growth',
          group: gp, label: 'One-sided Confidence Bounds', type: 'table',
          getData: () => ({
            tableHeaders: ['Quantity', 'Side', 'Bound', 'Confidence', 'Reported estimate', 'Reported basis', 'Bound reference estimate', 'Bound reference basis', 'Method', 'Coverage status'],
            tableRows: Object.values(r.confidence!.one_sided_bounds!).map(bound => [
              bound.quantity.split('_').join(' '),
              bound.side,
              bound.available ? fmt(bound.bound) : 'Unavailable',
              bound.confidence_level == null
                ? 'Unavailable'
                : `${fmt(100 * bound.confidence_level)}%`,
              fmt(bound.estimate),
              bound.reported_estimate_basis ?? '—',
              fmt(bound.interval_reference_estimate),
              bound.interval_reference_basis ?? '—',
              bound.method ?? 'Unavailable',
              bound.coverage_status ?? bound.status ?? '—',
            ]),
          }),
        })
      }
    }
    if (r.expected_vs_observed) {
      out.push({
        id: mkId('grw'), module: 'growth', moduleLabel: 'Reliability Growth',
        group: gp, label: 'Observed vs Expected Cumulative Failures', type: 'table',
        getData: () => ({
          tableHeaders: ['Time', 'Observed cumulative failures', 'Expected cumulative failures'],
          tableRows: r.expected_vs_observed!.time.map((time, i) => [
            fmt(time),
            r.expected_vs_observed!.observed_cumulative[i],
            fmt(r.expected_vs_observed!.expected_cumulative[i]),
          ]),
        }),
      })
    }
    if (r.goodness_of_fit?.pooled_intervals?.length) {
      out.push({
        id: mkId('grw'), module: 'growth', moduleLabel: 'Reliability Growth',
        group: gp, label: 'Grouped GOF Pooled Intervals', type: 'table',
        getData: () => ({
          tableHeaders: ['Start', 'End', 'Observed failures', 'Expected failures'],
          tableRows: r.goodness_of_fit!.pooled_intervals!.map(interval => [
            fmt(interval.start), fmt(interval.end), interval.observed,
            fmt(interval.expected),
          ]),
        }),
      })
    }
    if (r.trend_test) {
      out.push({
        id: mkId('grw'), module: 'growth', moduleLabel: 'Reliability Growth',
        group: gp, label: 'Power-law Process Trend Test', type: 'metrics',
        getData: () => ({
          metrics: [
            { label: 'Method', value: r.trend_test!.method },
            { label: 'Null Hypothesis', value: r.trend_test!.null_hypothesis ?? '—' },
            { label: 'Available', value: r.trend_test!.available ? 'Yes' : 'No' },
            { label: 'Decision', value: r.trend_test!.decision_text ?? '—' },
            { label: 'Statistic', value: fmt(r.trend_test!.statistic) },
            { label: 'Degrees of Freedom', value: fmt(r.trend_test!.degrees_of_freedom) },
            { label: 'Significance', value: fmt(r.trend_test!.significance) },
            { label: 'Two-sided p-value', value: fmt(r.trend_test!.p_value_two_sided) },
            { label: 'Improving p-value', value: fmt(r.trend_test!.p_value_improving) },
            { label: 'Worsening p-value', value: fmt(r.trend_test!.p_value_worsening) },
            { label: 'Observed Direction', value: r.trend_test!.observed_direction ?? '—' },
            { label: 'Direction Shape', value: fmt(r.trend_test!.shape_for_direction) },
            { label: 'Direction Estimator', value: r.trend_test!.direction_estimator ?? '—' },
            { label: 'Direction Basis', value: r.trend_test!.direction_basis ?? '—' },
          ],
        }),
      })
    }
    if (r.grouped_final_interval) {
      out.push({
        id: mkId('grw'), module: 'growth', moduleLabel: 'Reliability Growth',
        group: gp, label: 'Grouped Final-Interval Estimate', type: 'metrics',
        getData: () => {
          const interval = r.grouped_final_interval!
          const mtbfBounds = interval.target_profile.average_mtbf_interval
          const intensityBounds = interval.target_profile.average_failure_intensity_interval
          const handbookMtbf = interval.handbook_approximate.average_mtbf_interval
          const handbookIntensity = interval.handbook_approximate
            .average_failure_intensity_interval
          const handbookLowerBound = interval.handbook_approximate
            .average_mtbf_one_sided_lower_bound
          return {
            metrics: [
              { label: 'Interval', value: `(${fmt(interval.start)}, ${fmt(interval.end)}]` },
              { label: 'Observed Failures', value: String(interval.observed_failures) },
              { label: 'Expected Failures', value: fmt(interval.expected_failures) },
              { label: 'Average Failure Intensity', value: fmt(interval.average_failure_intensity) },
              { label: 'Target-profile Intensity Lower', value: fmt(intensityBounds?.lower) },
              { label: 'Target-profile Intensity Upper', value: fmt(intensityBounds?.upper) },
              { label: 'Average MTBF', value: fmt(interval.average_mtbf) },
              { label: 'Target-profile MTBF Lower', value: fmt(mtbfBounds?.lower) },
              { label: 'Target-profile MTBF Upper', value: fmt(mtbfBounds?.upper) },
              { label: 'Confidence Level', value: `${fmt(100 * interval.confidence_level)}%` },
              { label: 'Target-profile Method', value: mtbfBounds?.method ?? 'Unavailable' },
              { label: 'Target-profile Coverage Status', value: mtbfBounds?.coverage_status ?? mtbfBounds?.status ?? 'Unavailable' },
              { label: 'Handbook-approx. Intensity Lower', value: fmt(handbookIntensity?.lower) },
              { label: 'Handbook-approx. Intensity Upper', value: fmt(handbookIntensity?.upper) },
              { label: 'Handbook-approx. MTBF Lower', value: fmt(handbookMtbf?.lower) },
              { label: 'Handbook-approx. MTBF Upper', value: fmt(handbookMtbf?.upper) },
              { label: 'Handbook-approx. Method', value: handbookMtbf?.method ?? 'Unavailable' },
              { label: 'Handbook-approx. Coverage Status', value: handbookMtbf?.coverage_status ?? handbookMtbf?.status ?? 'Unavailable' },
              { label: 'Handbook One-sided MTBF Lower Bound', value: fmt(handbookLowerBound?.bound) },
              { label: 'Handbook One-sided Bound Confidence', value: handbookLowerBound?.confidence_level == null ? 'Unavailable' : `${fmt(100 * handbookLowerBound.confidence_level)}%` },
              { label: 'Handbook One-sided Bound Method', value: handbookLowerBound?.method ?? 'Unavailable' },
            ],
          }
        },
      })
    }
    out.push({
      id: mkId('grw'), module: 'growth', moduleLabel: 'Reliability Growth',
      group: gp, label: 'Growth Summary', type: 'metrics',
      getData: () => ({
        metrics: [
          { label: 'Model', value: r.model },
          { label: 'Data Mode', value: r.data_mode ?? 'exact' },
          { label: 'Termination', value: r.termination ?? '—' },
          { label: 'Reported Estimator', value: r.estimator ?? '—' },
          { label: 'Beta', value: fmt(r.beta) },
          { label: 'Lambda', value: fmt(r.Lambda) },
          { label: 'log Lambda', value: fmt(r.log_Lambda) },
          { label: 'Scale Representable', value: r.scale_representable === false ? 'No' : 'Yes' },
          { label: 'Growth Rate', value: fmt(r.growth_rate) },
          { label: 'Instantaneous Intensity at T', value: fmt(r.instantaneous_failure_intensity) },
          { label: 'MTBF (instantaneous)', value: fmt(r.mtbf_instantaneous) },
          { label: 'MTBF (cumulative)', value: fmt(r.mtbf_cumulative) },
          ...(r.data_mode === 'grouped' && (r.grouped_final_interval
            || r.interval_context?.fitted_average_intensity.length)
            ? (() => {
              const values = r.interval_context?.fitted_average_intensity ?? []
              const intensity = r.grouped_final_interval?.average_failure_intensity
                ?? values[values.length - 1]
              return [
                { label: 'Final-interval Average Intensity', value: fmt(intensity) },
                { label: 'Final-interval Average MTBF', value: fmt(
                  r.grouped_final_interval?.average_mtbf
                    ?? (intensity > 0 ? 1 / intensity : null)) },
              ]
            })()
            : []),
          { label: 'Total Failures', value: String(r.n_failures) },
          { label: 'Total Test Time', value: fmt(r.T) },
          { label: 'Confidence Level', value: fmt(r.confidence?.level) },
          { label: 'GOF Method', value: r.goodness_of_fit?.method ?? '—' },
          { label: 'GOF Decision', value: r.goodness_of_fit?.decision_text ?? '—' },
          { label: 'GOF Significance', value: fmt(r.goodness_of_fit?.significance) },
          { label: 'GOF Statistic', value: fmt(r.goodness_of_fit?.statistic) },
          { label: 'GOF Critical Value', value: fmt(r.goodness_of_fit?.critical_value) },
          { label: 'GOF p-value', value: fmt(r.goodness_of_fit?.p_value) },
          { label: 'GOF Bias-corrected Beta', value: fmt(r.goodness_of_fit?.shape_used) },
          { label: 'GOF Expected-count Rule', value: r.goodness_of_fit?.expected_count_rule ?? '—' },
          { label: 'Trend Test', value: r.trend_test?.decision_text ?? '—' },
          { label: 'Warnings', value: r.diagnostics?.warnings.join(' | ') || 'None' },
        ],
      }),
    })
    if (r.prediction) {
      out.push({
        id: mkId('grw'), module: 'growth', moduleLabel: 'Reliability Growth',
        group: gp, label: 'Conditional Process Projection', type: 'metrics',
        getData: () => ({
          metrics: [
            { label: 'Model', value: r.prediction!.model },
            { label: 'Uncertainty Scope', value: r.prediction!.uncertainty_scope },
            { label: 'Parameter Uncertainty Included', value: r.prediction!.parameter_uncertainty_included ? 'Yes' : 'No' },
            { label: 'Future Event Order', value: String(r.prediction!.future_event?.order ?? '—') },
            { label: 'Event-time Quantile Probability', value: fmt(r.prediction!.future_event?.quantile_probability) },
            { label: 'Future Event Absolute Time', value: fmt(r.prediction!.future_event?.absolute_time) },
            { label: 'Elapsed Time after T', value: fmt(r.prediction!.future_event?.elapsed_time_after_T) },
            { label: 'Projection Horizon', value: fmt(r.prediction!.horizon?.elapsed_time) },
            { label: 'Expected Future Failures', value: fmt(r.prediction!.horizon?.expected_failures) },
            { label: 'Probability of No Failures', value: fmt(r.prediction!.horizon?.probability_no_failures) },
            { label: 'Process-count Interval', value: r.prediction!.horizon?.failure_count_prediction_interval
              ? `[${r.prediction!.horizon.failure_count_prediction_interval.lower}, ${r.prediction!.horizon.failure_count_prediction_interval.upper}]`
              : '—' },
          ],
        }),
      })
    }
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
// Availability & Spares (RAM)
// ---------------------------------------------------------------------------

function extractRAM(modules: Record<string, unknown>, out: AssetDescriptor[]) {
  const ram = modules['ram'] as {
    avail?: { mtbf?: string; mtbm?: string; result?: AvailabilityResponse | null }
    maint?: { result?: MaintainabilityResponse | null }
    spares?: { result?: SparesResponse | null }
  } | null
  if (!ram) return
  const ML = 'Availability & Spares'
  const pct = (v: number | null | undefined) => v == null ? '—' : `${(v * 100).toFixed(3)}%`

  // Availability
  const av = ram.avail
  if (av?.result) {
    const r = av.result
    out.push({
      id: mkId('ram'), module: 'ram', moduleLabel: ML, group: 'Availability',
      label: 'Availability Metrics', type: 'metrics',
      getData: () => ({
        metrics: [
          { label: 'Inherent (Ai)', value: pct(r.inherent) },
          { label: 'Achieved (Aa)', value: pct(r.achieved) },
          { label: 'Operational (Ao)', value: pct(r.operational) },
          { label: 'Mean down time (MDT)', value: fmt(r.mean_down_time) },
          { label: 'Repair (MTTR)', value: fmt(r.downtime_breakdown?.repair) },
          { label: 'Admin delay', value: fmt(r.downtime_breakdown?.admin_delay) },
          { label: 'Logistics delay', value: fmt(r.downtime_breakdown?.logistics_delay) },
        ],
      }),
    })
    const uptime = parseFloat(av.mtbm || av.mtbf || '')
    const d = r.downtime_breakdown
    const admin = d?.admin_delay ?? 0
    const logi = d?.logistics_delay ?? 0
    if (r.mean_down_time != null && isFinite(uptime) && (admin > 0 || logi > 0)) {
      out.push({
        id: mkId('ram'), module: 'ram', moduleLabel: ML, group: 'Availability',
        label: 'Downtime Breakdown', type: 'plot',
        getData: () => ({
          plotData: [
            { x: [uptime], y: ['Mean cycle'], type: 'bar', orientation: 'h', name: 'Uptime', marker: { color: '#10b981' } },
            { x: [d?.repair ?? 0], y: ['Mean cycle'], type: 'bar', orientation: 'h', name: 'Repair', marker: { color: '#ef4444' } },
            { x: [admin], y: ['Mean cycle'], type: 'bar', orientation: 'h', name: 'Admin delay', marker: { color: '#f59e0b' } },
            { x: [logi], y: ['Mean cycle'], type: 'bar', orientation: 'h', name: 'Logistics delay', marker: { color: '#3b82f6' } },
          ],
          plotLayout: { ...BASE, barmode: 'stack', xaxis: { title: { text: 'Time' }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: '' } }, title: { text: 'Where availability is lost' } },
        }),
      })
    }
  }

  // Maintainability
  const mt = ram.maint
  if (mt?.result) {
    const r = mt.result
    out.push({
      id: mkId('ram'), module: 'ram', moduleLabel: ML, group: 'Maintainability',
      label: 'Maintainability Metrics', type: 'metrics',
      getData: () => ({
        metrics: [
          { label: 'Mct (mean corrective time)', value: fmt(r.mct) },
          { label: `Mmax (${Math.round(r.percentile * 100)}th pct)`, value: fmt(r.mmax) },
          { label: 'Median repair time', value: fmt(r.median) },
          { label: 'μ (log-location)', value: fmt(r.mu) },
          { label: 'σ (log-scale)', value: fmt(r.sigma) },
        ],
      }),
    })
    if (r.curve?.time?.length) {
      out.push({
        id: mkId('ram'), module: 'ram', moduleLabel: ML, group: 'Maintainability',
        label: 'Repair-time Survival', type: 'plot',
        getData: () => ({
          plotData: [{ x: r.curve.time, y: r.curve.sf, mode: 'lines', name: 'P(T > t)', line: { color: '#8b5cf6', width: 2 } }],
          plotLayout: { ...BASE, xaxis: { title: { text: 'Repair time' }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'P(T > t)' }, range: [0, 1], gridcolor: '#e5e7eb' }, title: { text: 'Probability a repair exceeds time t' } },
        }),
      })
    }
  }

  // Spares
  const sp = ram.spares
  if (sp?.result) {
    const r = sp.result
    out.push({
      id: mkId('ram'), module: 'ram', moduleLabel: ML, group: 'Spares',
      label: 'Spares Metrics', type: 'metrics',
      getData: () => ({
        metrics: [
          { label: 'Required spares', value: String(r.required_spares) },
          { label: 'Expected demand', value: fmt(r.expected_demand) },
          { label: 'Achieved protection', value: `${(r.achieved_protection * 100).toFixed(2)}%` },
          { label: 'Target confidence', value: `${(r.confidence * 100).toFixed(2)}%` },
        ],
      }),
    })
    if (r.curve?.stock_level?.length) {
      out.push({
        id: mkId('ram'), module: 'ram', moduleLabel: ML, group: 'Spares',
        label: 'Protection vs Stock', type: 'plot',
        getData: () => ({
          plotData: [
            { x: r.curve.stock_level, y: r.curve.protection, type: 'bar', name: 'P(no stockout)', marker: { color: '#10b981' } },
            { x: [r.required_spares, r.required_spares], y: [0, 1], mode: 'lines', name: `required = ${r.required_spares}`, line: { color: '#ef4444', width: 2, dash: 'dot' } },
          ],
          plotLayout: { ...BASE, xaxis: { title: { text: 'Spares stocked' }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'P(no stockout)' }, range: [0, 1], gridcolor: '#e5e7eb' }, title: { text: 'Spares Protection Level' } },
        }),
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Reliability Allocation
// ---------------------------------------------------------------------------

function extractReliabilityAllocation(modules: Record<string, unknown>, out: AssetDescriptor[]) {
  const folio = extractFolioResult<{ result?: AllocationResponse | null }>(modules, 'reliabilityAllocation')
  for (const { gp, st } of folio) {
    const r = st.result
    if (!r) continue
    const ML = 'Reliability Allocation'
    out.push({
      id: mkId('alloc'), module: 'reliabilityAllocation', moduleLabel: ML,
      group: gp, label: 'Allocation Summary', type: 'metrics',
      getData: () => ({
        metrics: [
          { label: 'Method', value: r.method },
          { label: 'Target system reliability', value: fmt(r.system_reliability) },
          { label: 'Product of allocations', value: fmt(r.achieved_reliability) },
          { label: 'Meets target', value: r.achieved_reliability >= r.system_reliability - 1e-6 ? 'Yes' : 'No' },
        ],
      }),
    })
    out.push({
      id: mkId('alloc'), module: 'reliabilityAllocation', moduleLabel: ML,
      group: gp, label: 'Allocated Targets', type: 'table',
      getData: () => ({
        tableHeaders: ['Subsystem', 'Allocated reliability', 'Failure rate', 'MTBF'],
        tableRows: r.allocations.map(a => [
          a.name, a.reliability.toFixed(5),
          a.failure_rate == null ? '—' : a.failure_rate.toExponential(3),
          a.mtbf == null ? '—' : fmt(a.mtbf),
        ]),
      }),
    })
    out.push({
      id: mkId('alloc'), module: 'reliabilityAllocation', moduleLabel: ML,
      group: gp, label: 'Allocated Reliability', type: 'plot',
      getData: () => ({
        plotData: [{ x: r.allocations.map(a => a.name), y: r.allocations.map(a => a.reliability), type: 'bar', marker: { color: '#3b82f6' } }],
        plotLayout: { ...BASE, yaxis: { title: { text: 'Allocated reliability' }, range: [0, 1], gridcolor: '#e5e7eb' }, title: { text: 'Allocated Reliability by Subsystem' } },
      }),
    })
  }
}

// ---------------------------------------------------------------------------
// Prediction
// ---------------------------------------------------------------------------

function extractPrediction(modules: Record<string, unknown>, out: AssetDescriptor[]) {
  const folio = extractFolioResult<{
    result?: PredictionResponse | null
    deratingResult?: DeratingResponse | null
    parts?: Any[]
    blocks?: {
      id: string; name: string; parentId: string | null
      quantity?: number; operatingFraction?: number
      environment?: string | null; nonoperatingEnvironment?: string | null
      nonoperatingTemperatureC?: number | null
      powerCyclesPer1000NonoperatingHours?: number | null
      failureRateOverrideEnabled?: boolean
    }[]
    missionHours?: string
    contributionScope?: 'system' | 'blocks'
    contributionBlockIds?: string[]
  }>(modules, 'prediction')
  for (const { gp, st } of folio) {
    const derating = st.deratingResult
    if (derating) {
      const formatValue = (value: number | boolean | string | null | undefined) => {
        if (value == null) return '—'
        if (typeof value === 'number') return fmt(value)
        if (typeof value === 'boolean') return value ? 'Yes' : 'No'
        return value
      }
      const formatSource = (source: DeratingResponse['results'][number]['derating'][number]['source']) => {
        if (!source) return '—'
        const pages = source.printed_pages
          ? `printed ${source.printed_pages}`
          : source.pdf_pages ? `PDF ${source.pdf_pages}` : null
        const parts = [source.title, source.section, pages].filter(Boolean)
        return parts.length ? parts.join(' — ') : '—'
      }
      const checkCount = derating.results.reduce(
        (total, part) => total + part.derating.length, 0,
      )
      const evaluatedCount = derating.results.reduce(
        (total, part) => total + part.coverage.evaluated, 0,
      )
      const requiredCount = derating.results.reduce(
        (total, part) => total + part.coverage.required, 0,
      )

      out.push({
        id: mkId('pred_derating'), module: 'prediction', moduleLabel: 'Failure Rate Prediction',
        group: gp, label: 'Derating Summary', type: 'metrics',
        getData: () => ({
          metrics: [
            { label: 'Profile', value: derating.standard },
            { label: 'Selected level', value: derating.derating_level ?? 'Not applicable' },
            { label: 'Parts assessed', value: String(derating.results.length) },
            { label: 'Checks', value: String(checkCount) },
            { label: 'Required checks evaluated', value: `${evaluatedCount} of ${requiredCount}` },
            { label: 'Within limits', value: String(derating.summary.ok) },
            { label: 'Exceeds limits', value: String(derating.summary.exceeds) },
            { label: 'Not evaluated', value: String(derating.summary.not_evaluated) },
          ],
        }),
      })

      out.push({
        id: mkId('pred_derating'), module: 'prediction', moduleLabel: 'Failure Rate Prediction',
        group: gp, label: 'Derating Checks', type: 'table',
        getData: () => ({
          tableHeaders: [
            'Part', 'Family', 'Subtype', 'Selected level', 'Part status', 'Coverage',
            'Rule', 'Parameter', 'Description', 'Actual', 'Comparison',
            'Allowable', 'Unit', 'Margin', 'Check status', 'Formula',
            'Substitution', 'Source', 'Notes', 'Message',
          ],
          tableRows: derating.results.flatMap(part => {
            const partColumns = [
              part.name,
              part.family ?? part.category,
              part.subtype ?? '—',
              part.selected_level ?? 'Not applicable',
              part.overall_status,
              `${part.coverage.evaluated} of ${part.coverage.required}`,
            ]
            if (!part.derating.length) {
              return [[
                ...partColumns,
                '—', '—', 'No check records were emitted.', '—', '—',
                '—', '—', '—', part.overall_status, '—', '—', '—', '—',
                part.message ?? 'No check records were emitted.',
              ]]
            }
            return part.derating.map(check => [
              ...partColumns,
              check.rule_id ?? '—',
              check.parameter,
              check.description,
              formatValue(check.actual_value),
              check.comparison ?? '—',
              formatValue(check.selected_limit ?? check.allowable_value),
              check.unit || '—',
              formatValue(check.margin),
              check.status,
              check.formula ?? '—',
              check.substitution ?? '—',
              formatSource(check.source),
              check.notes?.join('; ') || '—',
              check.message ?? '—',
            ])
          }),
        }),
      })

      const guidanceRows = derating.results.flatMap(part => [
        ...(part.assumptions ?? []).map(value => [part.name, 'Assumption', value]),
        ...(part.warnings ?? []).map(value => [part.name, 'Warning', value]),
      ])
      if (guidanceRows.length) {
        out.push({
          id: mkId('pred_derating'), module: 'prediction', moduleLabel: 'Failure Rate Prediction',
          group: gp, label: 'Derating Assumptions and Warnings', type: 'table',
          getData: () => ({
            tableHeaders: ['Part', 'Type', 'Detail'],
            tableRows: guidanceRows,
          }),
        })
      }
    }

    const r = st.result
    if (!r) continue
    const parts = r.results.filter(p => !p.incompatible)
    const nonoperatingStatus = (part: PredictionResponse['results'][number]) => {
      const status = part.nonoperating_calculation?.status
      if (status === 'supported') return 'RADC model'
      if (status === 'user_override') return 'Nonoperating override'
      if (status === 'unavailable') return 'Unavailable'
      return 'Not required'
    }
    const nonoperatingProvenance = (part: PredictionResponse['results'][number]) => {
      const calculation = part.nonoperating_calculation
      if (!calculation) return '—'
      const values = [calculation.source, calculation.model]
        .filter((value): value is string => Boolean(value))
      return values.length ? values.join(' — ') : (calculation.reason ?? '—')
    }
    const rootOperatingRate = r.results.reduce((total, part) => {
      if (part.incompatible || part.parent_id != null) return total
      return total + (part.operating_failure_rate_fpmh ?? part.failure_rate ?? 0) * part.quantity
    }, 0) + (r.blocks ?? []).reduce((total, block) => {
      if (block.parent_id != null) return total
      return total + block.operating_handbook_subtotal_failure_rate * block.quantity
    }, 0)
    const systemServiceRate = r.service_failure_rate_fpmh ?? r.total_failure_rate
    if (parts.length || r.blocks?.length) {
      if (parts.length) {
      out.push({
        id: mkId('pred'), module: 'prediction', moduleLabel: 'Failure Rate Prediction',
        group: gp, label: 'Parts Summary Table', type: 'table',
        getData: () => ({
          tableHeaders: [
            'Part', 'Category', 'Qty', 'Operating λ (FPMH)',
            'Nonoperating λ (FPMH)', 'Service-life λ (FPMH)',
            'Nonoperating status', 'System service λ (FPMH)', 'Override',
          ],
          tableRows: parts.map(p => [
            p.name, p.category, p.quantity,
            fmt(p.operating_failure_rate_fpmh ?? p.operating_calculated_failure_rate),
            fmt(p.nonoperating_failure_rate_fpmh),
            fmt(p.service_failure_rate_fpmh ?? p.failure_rate),
            nonoperatingStatus(p),
            fmt(p.system_contribution_failure_rate ?? p.total_failure_rate),
            p.override_applied ? 'Final rate' : p.nonoperating_calculation?.status === 'user_override'
              ? 'Nonoperating rate' : 'No',
          ]),
        }),
      })
      out.push({
        id: mkId('pred'), module: 'prediction', moduleLabel: 'Failure Rate Prediction',
        group: gp, label: 'Nonoperating Model Traceability', type: 'table',
        getData: () => ({
          tableHeaders: ['Part', 'Status', 'Source and model', 'Source type', 'Section or reason'],
          tableRows: parts.map(part => {
            const calculation = part.nonoperating_calculation
            const trace = calculation?.traceability as Any
            return [
              part.name,
              nonoperatingStatus(part),
              nonoperatingProvenance(part),
              calculation?.source_type ?? '—',
              trace?.section ?? trace?.report_section ?? calculation?.reason ?? '—',
            ]
          }),
        }),
      })
      }
      const inputParts = st.parts ?? []
      const blocks = st.blocks ?? []
      if (r.blocks?.length) {
        out.push({
          id: mkId('pred'), module: 'prediction', moduleLabel: 'Failure Rate Prediction',
          group: gp, label: 'System Block Summary', type: 'table',
          getData: () => ({
            tableHeaders: [
              'Block', 'Qty', 'Operating fraction', 'Operating env',
              'Nonoperating env', 'Operating subtotal λ (FPMH)',
              'Service-life λ (FPMH)', 'Status', 'Override',
            ],
            tableRows: r.blocks!.map(block => [
              block.name, block.quantity,
              r.standard === 'FIDES' ? 'N/A' : `${(block.effective_operating_fraction * 100).toFixed(1)}%`,
              r.standard === 'FIDES' ? 'N/A' : block.operating_environment,
              r.standard === 'FIDES' ? 'N/A' : block.nonoperating_environment ?? '—',
              fmt(block.operating_handbook_subtotal_failure_rate),
              fmt(block.service_failure_rate_fpmh ?? block.failure_rate),
              block.override_applied ? 'Final rate override'
                : block.service_rate_available ? 'Available' : 'Unavailable',
              block.override_applied ? 'Yes' : 'No',
            ]),
          }),
        })
      }
      const blockById = new Map(blocks.map(block => [block.id, block]))
      const blockResultById = new Map((r.blocks ?? []).map(block => [block.id, block]))
      const scope = st.contributionScope === 'blocks' && blocks.length > 0 ? 'blocks' : 'system'
      const selectedIds = (st.contributionBlockIds ?? []).filter(id => blockById.has(id))
      const selectedSet = new Set(selectedIds)
      const roots = selectedIds.filter(id => {
        let parentId = blockById.get(id)?.parentId ?? null
        const seen = new Set<string>()
        while (parentId && !seen.has(parentId)) {
          if (selectedSet.has(parentId)) return false
          seen.add(parentId)
          parentId = blockById.get(parentId)?.parentId ?? null
        }
        return true
      })
      const slices = new Map<string, number>()
      const inputPartLabel = (index: number) => inputParts[index]?.name || r.results[index]?.name || `Part ${index + 1}`
      const addSlice = (label: string, value: number | null | undefined) => {
        if (value != null && value > 0) slices.set(label, (slices.get(label) ?? 0) + value)
      }
      if (scope === 'system') {
        r.results.forEach((row, index) => {
          if (row.incompatible || (inputParts[index]?.parentId ?? null) !== null) return
          addSlice(inputPartLabel(index), row.system_contribution_failure_rate ?? row.total_failure_rate)
        })
        ;(r.blocks ?? []).filter(block => block.parent_id == null)
          .forEach(block => addSlice(block.name, block.system_contribution_failure_rate))
      } else {
        roots.forEach(rootId => {
          const root = blockResultById.get(rootId)
          if (!root) return
          const prefix = roots.length > 1 ? `${root.name} / ` : ''
          const systemScale = root.failure_rate != null && root.failure_rate > 0
            && root.system_expanded_failure_rate != null
            ? root.system_expanded_failure_rate / root.failure_rate : 1
          if (root.override_applied) {
            addSlice(`${prefix}${root.name} override`, root.system_expanded_failure_rate)
            return
          }
          r.results.forEach((row, index) => {
            if (row.incompatible || (inputParts[index]?.parentId ?? null) !== rootId) return
            const lineRate = row.line_total_failure_rate ?? row.total_failure_rate
            addSlice(`${prefix}${inputPartLabel(index)}`,
              lineRate == null ? null : lineRate * systemScale)
          })
          ;(r.blocks ?? []).filter(block => block.parent_id === rootId)
            .forEach(block => addSlice(`${prefix}${block.name}`,
              block.total_failure_rate == null ? null : block.total_failure_rate * systemScale))
        })
      }
      /* Legacy projects without backend block rows still receive a useful pie. */
      if (slices.size === 0 && !(r.blocks?.length)) r.results.forEach((row, index) => {
        if (row.incompatible || row.total_failure_rate == null || row.total_failure_rate <= 0) return
        if (scope === 'system') {
          addSlice(inputPartLabel(index), row.total_failure_rate)
          return
        }
        const partParent = inputParts[index]?.parentId ?? null
        let rootId: string | null = null
        let cursor = partParent
        const seen = new Set<string>()
        while (cursor && !seen.has(cursor)) {
          if (roots.includes(cursor)) { rootId = cursor; break }
          seen.add(cursor)
          cursor = blockById.get(cursor)?.parentId ?? null
        }
        if (!rootId) return
        let localLabel = inputPartLabel(index)
        if (partParent && partParent !== rootId) {
          let childId = partParent
          let parentId = blockById.get(childId)?.parentId ?? null
          while (parentId && parentId !== rootId) {
            childId = parentId
            parentId = blockById.get(childId)?.parentId ?? null
          }
          localLabel = blockById.get(childId)?.name ?? localLabel
        }
        const rootName = blockById.get(rootId)?.name ?? rootId
        const label = roots.length > 1 ? `${rootName} / ${localLabel}` : localLabel
        addSlice(label, row.total_failure_rate)
      })
      if (slices.size > 0) {
        const labels = [...slices.keys()]
        const values = [...slices.values()]
        out.push({
          id: mkId('pred'), module: 'prediction', moduleLabel: 'Failure Rate Prediction',
          group: gp, label: scope === 'blocks' ? 'Selected Block Failure Rate Contribution' : 'System Failure Rate Contribution', type: 'plot',
          getData: () => ({
            plotData: [{ labels, values, type: 'pie', textinfo: 'label+percent' }],
            plotLayout: { ...BASE, title: { text: scope === 'blocks' ? 'Selected Block Failure Rate Contribution' : 'System Failure Rate Contribution' } },
          }),
        })
      }
    }
    if (r.service_rate_available !== false && systemServiceRate != null && systemServiceRate > 0) {
      const mission = Math.max(parseFloat(st.missionHours ?? '') || 8760, 1)
      const time = Array.from({ length: 201 }, (_, index) => mission * 2 * index / 200)
      out.push({
        id: mkId('pred'), module: 'prediction', moduleLabel: 'Failure Rate Prediction',
        group: gp, label: 'System Reliability vs Time', type: 'plot',
        getData: () => ({
          plotData: [{ x: time, y: time.map(value => Math.exp(-systemServiceRate * value / 1e6)), mode: 'lines', name: 'Service-life R(t)', line: { color: COLORS[0], width: 2 } }],
          plotLayout: { ...BASE, xaxis: { title: { text: 'Calendar time (hours)' }, gridcolor: GREY }, yaxis: { title: { text: 'Reliability R(t)' }, range: [0, 1.02], gridcolor: GREY }, title: { text: 'Service-Life System Reliability vs Calendar Time' } },
        }),
      })
    }
    out.push({
      id: mkId('pred'), module: 'prediction', moduleLabel: 'Failure Rate Prediction',
      group: gp, label: 'System Summary', type: 'metrics',
      getData: () => ({
        metrics: [
          { label: 'Operating handbook system λ (FPMH)', value: fmt(rootOperatingRate) },
          { label: 'Service-life system λ (FPMH)', value: fmt(systemServiceRate) },
          { label: 'Service-rate status', value: r.service_rate_available === false ? 'Unavailable' : 'Available' },
          { label: 'Rate time basis', value: r.rate_time_basis === 'calendar_hours' ? 'Calendar hours' : 'Operating hours' },
          { label: 'Mean calendar time between failures (hours)', value: fmt(r.mtbf_hours) },
          { label: 'Parts', value: String(r.results.length) },
          { label: 'Operating environment', value: r.environment },
          { label: 'Result context', value: parts.find(part => part.traceability?.result_context)
            ?.traceability?.result_context ?? 'Conditional handbook planning estimate; not an observed field rate.' },
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
  const s = dmState as { fitted?: Any[]; run?: ModelingRun | null; finalized?: ModelAsset | null; assets?: ModelAsset[] } | null
  if (!s) return
  const GP = group

  if (s.run) extractModelingWorkflow(s.run, GP, out)
  const modelAssets = [...(s.assets ?? []), ...(s.finalized ? [s.finalized] : [])]
    .filter((asset, index, values) => values.findIndex(item => item.asset_id === asset.asset_id) === index)
  for (const asset of modelAssets) extractModelAsset(asset, GP, out)

  // Legacy pre-workflow results remain available to Report Builder.
  for (const model of s.fitted ?? []) {
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

function extractModelingWorkflow(run: ModelingRun, group: string, out: AssetDescriptor[]) {
  const eligible = run.models.filter(model => model.status === 'eligible')
  const metricKeys = [...new Set([
    run.selection_metric,
    ...(run.task === 'regression'
      ? ['rmse', 'mae', 'median_absolute_error', 'r2']
      : ['balanced_accuracy', 'accuracy', 'f1_macro', 'roc_auc', 'average_precision', 'log_loss', 'brier_score']),
  ])]

  out.push({
    id: mkId('dm2'), module: 'dataModeling', moduleLabel: 'Regression & ML',
    group, label: 'Nested Validation Leaderboard', type: 'table',
    getData: () => ({
      tableHeaders: ['Rank', 'Model', 'Status', ...metricKeys.map(key => key.replace(/_/g, ' ')), 'Runtime (s)'],
      tableRows: [...run.models].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999)).map(model => [
        model.rank ?? '—', model.label, model.status,
        ...metricKeys.map(key => fmt(model.metrics?.[key]?.value)),
        fmt(model.runtime_seconds),
      ]),
    }),
  })

  out.push({
    id: mkId('dm2'), module: 'dataModeling', moduleLabel: 'Regression & ML',
    group, label: 'Data Readiness Summary', type: 'metrics',
    getData: () => ({ metrics: [
      { label: 'Original rows', value: String(run.readiness.n_rows_original) },
      { label: 'Eligible rows', value: String(run.readiness.n_rows_eligible) },
      { label: 'Numeric predictors', value: String(run.readiness.numeric_features.length) },
      { label: 'Categorical predictors', value: String(run.readiness.categorical_features.length) },
      { label: 'Duplicate rows', value: String(run.readiness.duplicate_rows) },
      { label: 'Leakage warnings', value: String(run.readiness.leakage_warnings.length) },
      { label: 'Validation structure', value: String(run.validation.strategy) },
      { label: 'Selection metric', value: run.selection_metric },
    ] }),
  })

  if (eligible.length) {
    out.push({
      id: mkId('dm2'), module: 'dataModeling', moduleLabel: 'Regression & ML',
      group, label: 'Outer-Fold Model Stability', type: 'plot',
      getData: () => ({
        plotData: eligible.map((model, index) => ({
          x: model.folds.map(fold => fold.fold),
          y: model.folds.map(fold => fold.metrics[run.selection_metric]),
          mode: 'lines+markers', type: 'scatter', name: model.label,
          line: { color: COLORS[index % COLORS.length], width: 2 },
        })),
        plotLayout: {
          ...BASE, title: { text: 'Outer-Fold Model Stability' },
          xaxis: { title: { text: 'Outer fold' }, gridcolor: GREY, dtick: 1 },
          yaxis: { title: { text: run.selection_metric.replace(/_/g, ' ') }, gridcolor: GREY },
        },
      }),
    })
  }

  for (const model of eligible) extractWorkflowModel(model, run, group, out)

}

function extractModelAsset(asset: ModelAsset, group: string, out: AssetDescriptor[]) {
  out.push({
    id: mkId('dm2'), module: 'dataModeling', moduleLabel: 'Regression & ML',
    group, label: `${asset.model_label} — Finalized Model Card`, type: 'metrics',
    getData: () => ({ metrics: [
      { label: 'Asset ID', value: asset.asset_id },
      { label: 'Model', value: asset.model_label },
      { label: 'Target', value: asset.schema.target },
      { label: 'Selection metric', value: asset.selection_metric },
      ...(asset.task === 'classification' ? [
        { label: 'Decision threshold', value: asset.threshold == null ? 'Estimator default' : fmt(asset.threshold) },
        { label: 'Calibration', value: String(asset.calibration_state?.method ?? 'none') },
      ] : []),
      { label: 'Artifact', value: asset.artifact.kind },
      { label: 'Executable', value: asset.artifact.available ? 'Yes' : 'No' },
      { label: 'Dataset fingerprint', value: asset.schema.dataset_fingerprint },
      { label: 'Created', value: asset.created_at },
    ] }),
  })
}

function extractWorkflowModel(model: ModelResult, run: ModelingRun, group: string,
                              out: AssetDescriptor[]) {
  const prefix = model.label
  out.push({
    id: mkId('dm2'), module: 'dataModeling', moduleLabel: 'Regression & ML',
    group, label: `${prefix} — Validated Metrics`, type: 'table',
    getData: () => ({
      tableHeaders: ['Metric', 'Estimate', `${Math.round((Object.values(model.metrics)[0]?.confidence ?? 0.95) * 100)}% lower`, 'Upper'],
      tableRows: Object.entries(model.metrics).map(([name, metric]) => [
        name.replace(/_/g, ' '), fmt(metric.value), fmt(metric.lower), fmt(metric.upper),
      ]),
    }),
  })

  const observed = model.diagnostics.observed_predicted
  if (observed) {
    out.push({
      id: mkId('dm2'), module: 'dataModeling', moduleLabel: 'Regression & ML',
      group, label: `${prefix} — Out-of-Sample Observed vs Predicted`, type: 'plot',
      getData: () => {
        const lo = Math.min(...observed.observed, ...observed.predicted)
        const hi = Math.max(...observed.observed, ...observed.predicted)
        return {
          plotData: [
            { x: observed.observed, y: observed.predicted, mode: 'markers', name: 'Outer-fold predictions', marker: { color: '#3b82f6', size: 7 } },
            { x: [lo, hi], y: [lo, hi], mode: 'lines', name: 'Ideal', line: { color: '#10b981', dash: 'dash' } },
          ],
          plotLayout: { ...BASE, title: { text: `${prefix} — Observed vs Predicted` }, xaxis: { title: { text: 'Observed' }, gridcolor: GREY }, yaxis: { title: { text: 'Out-of-sample predicted' }, gridcolor: GREY } },
        }
      },
    })
  }

  const residuals = model.diagnostics.residuals
  if (residuals) {
    out.push({
      id: mkId('dm2'), module: 'dataModeling', moduleLabel: 'Regression & ML',
      group, label: `${prefix} — Held-Out Residuals`, type: 'plot',
      getData: () => ({
        plotData: [
          { x: residuals.predicted, y: residuals.residual, mode: 'markers', marker: { color: '#8b5cf6', size: 7 } },
          { x: [Math.min(...residuals.predicted), Math.max(...residuals.predicted)], y: [0, 0], mode: 'lines', line: { color: '#9ca3af', dash: 'dash' } },
        ],
        plotLayout: { ...BASE, title: { text: `${prefix} — Held-Out Residuals` }, showlegend: false, xaxis: { title: { text: 'Predicted' }, gridcolor: GREY }, yaxis: { title: { text: 'Residual' }, gridcolor: GREY } },
      }),
    })
  }

  const confusion = model.diagnostics.confusion_matrix
  if (confusion) {
    out.push({
      id: mkId('dm2'), module: 'dataModeling', moduleLabel: 'Regression & ML',
      group, label: `${prefix} — Confusion Matrix`, type: 'plot',
      getData: () => ({
        plotData: [{ z: confusion.raw, x: confusion.labels, y: confusion.labels, type: 'heatmap', colorscale: 'Blues', text: confusion.raw.map(row => row.map(String)), texttemplate: '%{text}' }],
        plotLayout: { ...BASE, title: { text: `${prefix} — Confusion Matrix` }, xaxis: { title: { text: 'Predicted' } }, yaxis: { title: { text: 'Actual' }, autorange: 'reversed' } },
      }),
    })
  }

  const curves: [string, { x: number[]; y: number[]; xLabel: string; yLabel: string } | null][] = [
    ['ROC Curve', model.diagnostics.roc ? { x: model.diagnostics.roc.fpr, y: model.diagnostics.roc.tpr, xLabel: 'False-positive rate', yLabel: 'True-positive rate' } : null],
    ['Precision–Recall Curve', model.diagnostics.precision_recall ? { x: model.diagnostics.precision_recall.recall, y: model.diagnostics.precision_recall.precision, xLabel: 'Recall', yLabel: 'Precision' } : null],
    ['Reliability Diagram', model.diagnostics.calibration ? { x: model.diagnostics.calibration.mean_probability, y: model.diagnostics.calibration.observed_frequency, xLabel: 'Mean predicted probability', yLabel: 'Observed frequency' } : null],
  ]
  for (const [label, curve] of curves) {
    if (!curve) continue
    out.push({
      id: mkId('dm2'), module: 'dataModeling', moduleLabel: 'Regression & ML',
      group, label: `${prefix} — ${label}`, type: 'plot',
      getData: () => ({
        plotData: [
          { x: curve.x, y: curve.y, mode: 'lines+markers', line: { color: '#3b82f6', width: 2 }, name: prefix },
          ...(label === 'ROC Curve' || label === 'Reliability Diagram' ? [{ x: [0, 1], y: [0, 1], mode: 'lines', name: 'Reference', line: { color: '#9ca3af', dash: 'dash' } }] : []),
        ],
        plotLayout: { ...BASE, title: { text: `${prefix} — ${label}` }, xaxis: { title: { text: curve.xLabel }, gridcolor: GREY }, yaxis: { title: { text: curve.yLabel }, gridcolor: GREY } },
      }),
    })
  }

  const thresholdFolds = model.folds.filter(fold => fold.threshold_detail?.curve?.length)
  if (thresholdFolds.length) {
    const metric = thresholdFolds[0].threshold_detail?.metric ?? run.selection_metric
    out.push({
      id: mkId('dm2'), module: 'dataModeling', moduleLabel: 'Regression & ML',
      group, label: `${prefix} — Decision Threshold Sensitivity`, type: 'plot',
      getData: () => ({
        plotData: thresholdFolds.map((fold, index) => ({
          x: fold.threshold_detail!.curve.map(point => point.threshold),
          y: fold.threshold_detail!.curve.map(point => point.selection_value),
          mode: 'lines', name: `Outer fold ${fold.fold}`,
          line: { color: COLORS[index % COLORS.length], width: 1.5 },
        })),
        plotLayout: {
          ...BASE, title: { text: `${prefix} — Decision Threshold Sensitivity` },
          xaxis: { title: { text: 'Decision threshold' }, range: [0, 1], gridcolor: GREY },
          yaxis: { title: { text: metric.replace(/_/g, ' ') }, gridcolor: GREY },
          shapes: model.threshold == null ? [] : [{ type: 'line', xref: 'x', yref: 'paper', x0: model.threshold, x1: model.threshold, y0: 0, y1: 1, line: { color: '#dc2626', dash: 'dash', width: 2 } }],
        },
      }),
    })
  }

  const importance = model.permutation_importance
  if (importance?.mean?.length) {
    const values = importance.feature_names.map((name, index) => ({ name, mean: importance.mean[index], std: importance.std[index] })).sort((a, b) => a.mean - b.mean)
    out.push({
      id: mkId('dm2'), module: 'dataModeling', moduleLabel: 'Regression & ML',
      group, label: `${prefix} — Held-Out Permutation Importance`, type: 'plot',
      getData: () => ({
        plotData: [{ x: values.map(value => value.mean), y: values.map(value => value.name), type: 'bar', orientation: 'h', marker: { color: '#3b82f6' }, error_x: { type: 'data', array: values.map(value => value.std), color: '#64748b' } }],
        plotLayout: { ...BASE, margin: { ...BASE.margin, l: 115 }, title: { text: `${prefix} — Permutation Importance` }, xaxis: { title: { text: 'Held-out score decrease' }, gridcolor: GREY } },
      }),
    })
  }

  for (const dependence of model.partial_dependence ?? []) {
    if (!dependence.grid?.length || !dependence.average?.length) continue
    out.push({
      id: mkId('dm2'), module: 'dataModeling', moduleLabel: 'Regression & ML',
      group, label: `${prefix} — Partial Dependence — ${dependence.feature}`, type: 'plot',
      getData: () => ({
        plotData: [
          ...(dependence.individual ?? []).slice(0, 30).map(values => ({ x: dependence.grid, y: values, mode: 'lines', showlegend: false, line: { color: 'rgba(147,197,253,.25)', width: 1 } })),
          { x: dependence.grid, y: dependence.average, mode: 'lines', name: 'Average', line: { color: '#ef4444', width: 3 } },
        ],
        plotLayout: { ...BASE, title: { text: `${prefix} — Partial Dependence — ${dependence.feature}` }, xaxis: { title: { text: dependence.feature }, gridcolor: GREY }, yaxis: { title: { text: 'Model response' }, gridcolor: GREY } },
      }),
    })
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
    if (r.histogram?.bin_centers?.length) {
      out.push({
        id: mkId('ss'), module: 'sixSigma', moduleLabel: 'Six Sigma',
        group: 'Process Capability', label: 'Process Capability Histogram', type: 'plot',
        getData: () => {
          const sigma = r.std_within
          const lo = r.min - 3 * sigma
          const hi = r.max + 3 * sigma
          const x = Array.from({ length: 121 }, (_, index) => lo + (hi - lo) * index / 120)
          const scale = r.n * r.histogram.bin_width
          const density = x.map((value: number) => Math.exp(-0.5 * ((value - r.mean) / sigma) ** 2) / (sigma * Math.sqrt(2 * Math.PI)) * scale)
          const specShape = (value: number, color: string, dash = 'solid') => ({
            type: 'line', x0: value, x1: value, yref: 'paper', y0: 0, y1: 1,
            line: { color, width: 2, dash },
          })
          return {
            plotData: [
              { x: r.histogram.bin_centers, y: r.histogram.counts, type: 'bar', name: 'Observed', marker: { color: '#93c5fd', line: { color: COLORS[0], width: 1 } } },
              { x, y: density, mode: 'lines', name: 'Normal (within)', line: { color: '#1d4ed8', width: 2 } },
            ],
            plotLayout: {
              ...BASE, bargap: 0.02,
              xaxis: { title: { text: 'Value' }, gridcolor: GREY },
              yaxis: { title: { text: 'Frequency' }, gridcolor: GREY },
              title: { text: 'Process Capability Histogram' },
              shapes: [
                ...(r.lsl != null ? [specShape(r.lsl, '#ef4444')] : []),
                ...(r.usl != null ? [specShape(r.usl, '#ef4444')] : []),
                ...(r.target != null ? [specShape(r.target, '#10b981', 'dash')] : []),
              ],
            },
          }
        },
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Measurement System Analysis (Gage R&R)
// ---------------------------------------------------------------------------

function extractMSA(modules: Record<string, unknown>, out: AssetDescriptor[]) {
  const s = modules['msa'] as { result?: Any } | null
  const r = s?.result
  if (!r?.variance_components) return
  const MOD = 'msa', ML = 'Measurement System Analysis', GP = 'Gage R&R'
  const sources = Object.entries(r.variance_components as Record<string, Any>)

  out.push({
    id: mkId('msa'), module: MOD, moduleLabel: ML,
    group: GP, label: 'Variance Components', type: 'table',
    getData: () => ({
      tableHeaders: ['Source', 'Variance', '% Contribution', 'StdDev', 'Study Var', '% Study Var', '% Tolerance'],
      tableRows: sources.map(([src, v]) => [
        src, fmt(v.variance), fmt(v.pct_contribution), fmt(v.stdev), fmt(v.study_var), fmt(v.pct_study_var), fmt(v.pct_tolerance),
      ]),
    }),
  })

  if (r.per_cell_means && r.unique_parts?.length && r.unique_operators?.length) {
    const cells = Object.values(r.per_cell_means as Record<string, Any>)
    out.push({
      id: mkId('msa'), module: MOD, moduleLabel: ML,
      group: GP, label: 'Part × Operator Interaction', type: 'plot',
      getData: () => ({
        plotData: (r.unique_operators as string[]).map((operator, index) => ({
          x: (r.unique_parts as string[]).map(String),
          y: (r.unique_parts as string[]).map(part => r.per_cell_means[`${part}|${operator}`]?.mean ?? null),
          type: 'scatter', mode: 'lines+markers', name: String(operator),
          line: { color: COLORS[index % COLORS.length], width: 2 },
          marker: { color: COLORS[index % COLORS.length], size: 6 },
        })),
        plotLayout: { ...BASE, xaxis: { title: { text: 'Part' }, gridcolor: GREY }, yaxis: { title: { text: 'Mean Measurement' }, gridcolor: GREY }, title: { text: 'Part × Operator Interaction' }, showlegend: true },
      }),
    })
    out.push({
      id: mkId('msa'), module: MOD, moduleLabel: ML,
      group: GP, label: 'Measurement by Part', type: 'plot',
      getData: () => ({
        plotData: (r.unique_parts as string[]).map((part, index) => ({
          type: 'box', name: String(part),
          y: cells.filter(cell => cell.part === part).flatMap(cell => cell.measurements ?? []),
          marker: { color: COLORS[index % COLORS.length] }, boxpoints: 'all', jitter: 0.3, pointpos: 0,
        })),
        plotLayout: { ...BASE, xaxis: { title: { text: 'Part' }, gridcolor: GREY }, yaxis: { title: { text: 'Measurement' }, gridcolor: GREY }, title: { text: 'Measurement by Part' }, showlegend: false },
      }),
    })
    out.push({
      id: mkId('msa'), module: MOD, moduleLabel: ML,
      group: GP, label: 'Measurement by Operator', type: 'plot',
      getData: () => ({
        plotData: (r.unique_operators as string[]).map((operator, index) => ({
          type: 'box', name: String(operator),
          y: cells.filter(cell => cell.operator === operator).flatMap(cell => cell.measurements ?? []),
          marker: { color: COLORS[index % COLORS.length] }, boxpoints: 'all', jitter: 0.3, pointpos: 0,
        })),
        plotLayout: { ...BASE, xaxis: { title: { text: 'Operator' }, gridcolor: GREY }, yaxis: { title: { text: 'Measurement' }, gridcolor: GREY }, title: { text: 'Measurement by Operator' }, showlegend: false },
      }),
    })
  }

  out.push({
    id: mkId('msa'), module: MOD, moduleLabel: ML,
    group: GP, label: 'Components of Variation', type: 'plot',
    getData: () => {
      const labels = sources.map(([src]) => src)
      return {
        plotData: [
          { x: labels, y: sources.map(([, v]) => v.pct_contribution ?? 0), type: 'bar', name: '% Contribution', marker: { color: '#3b82f6' } },
          { x: labels, y: sources.map(([, v]) => v.pct_study_var ?? 0), type: 'bar', name: '% Study Var', marker: { color: '#10b981' } },
          ...(sources.some(([, v]) => v.pct_tolerance != null)
            ? [{ x: labels, y: sources.map(([, v]) => v.pct_tolerance ?? null), type: 'bar', name: '% Tolerance', marker: { color: '#f59e0b' } }]
            : []),
        ],
        plotLayout: { ...BASE, margin: { ...BASE.margin, b: 90 }, xaxis: { tickangle: -20 }, yaxis: { title: { text: 'Percent' }, gridcolor: GREY }, title: { text: 'Components of Variation' }, barmode: 'group', showlegend: true },
      }
    },
  })

  out.push({
    id: mkId('msa'), module: MOD, moduleLabel: ML,
    group: GP, label: 'Gage R&R Summary', type: 'metrics',
    getData: () => ({
      metrics: [
        { label: 'Method', value: String(r.method ?? '—') },
        { label: 'NDC', value: String(r.ndc ?? '—') },
        { label: 'Parts', value: String(r.n_parts ?? '—') },
        { label: 'Operators', value: String(r.n_operators ?? '—') },
        ...(r.n_replicates != null ? [{ label: 'Replicates', value: String(r.n_replicates) }] : []),
        { label: 'Grand Mean', value: fmt(r.grand_mean) },
      ],
    }),
  })

  if (r.anova_table?.length) {
    out.push({
      id: mkId('msa'), module: MOD, moduleLabel: ML,
      group: GP, label: 'ANOVA Table', type: 'table',
      getData: () => ({
        tableHeaders: ['Source', 'SS', 'df', 'MS', 'F', 'p'],
        tableRows: (r.anova_table as Any[]).map(a => [a.source, fmt(a.SS), String(a.df ?? '—'), fmt(a.MS), fmt(a.F), fmt(a.p)]),
      }),
    })
  }
}

// ---------------------------------------------------------------------------
// SPC — Control Charts
// ---------------------------------------------------------------------------

function extractSPC(modules: Record<string, unknown>, out: AssetDescriptor[]) {
  const s = modules['sixSigma.spc'] as { result?: Any } | null
  const r = s?.result
  if (!r?.subcharts?.length) return
  const MOD = 'sixSigma', ML = 'Six Sigma', GP = `Control Chart (${r.chart ?? ''})`

  for (const sc of r.subcharts as Any[]) {
    const n = sc.points?.length ?? 0
    if (!n) continue
    const x = sc.labels?.length === n ? sc.labels : sc.indices ?? sc.points.map((_: number, i: number) => i + 1)
    const asArr = (v: number | number[]) => Array.isArray(v) ? v : sc.points.map(() => v)
    out.push({
      id: mkId('spc'), module: MOD, moduleLabel: ML,
      group: GP, label: `${sc.name} Chart`, type: 'plot',
      getData: () => {
        const viol = (sc.violations ?? []) as Any[]
        const violSet = new Set(viol.map(v => v.index))
        return {
          plotData: [
            { x, y: sc.points, mode: 'lines+markers', name: sc.name, line: { color: '#3b82f6', width: 1.5 }, marker: { size: 5 } },
            { x, y: asArr(sc.cl), mode: 'lines', name: 'CL', line: { color: '#10b981', width: 1.5 } },
            { x, y: asArr(sc.ucl), mode: 'lines', name: 'UCL', line: { color: '#ef4444', dash: 'dash', width: 1.5 } },
            { x, y: asArr(sc.lcl), mode: 'lines', name: 'LCL', line: { color: '#ef4444', dash: 'dash', width: 1.5 } },
            ...(violSet.size ? [{
              x: sc.points.map((_: number, i: number) => violSet.has(i) ? x[i] : null).filter((v: Any) => v != null),
              y: sc.points.filter((_: number, i: number) => violSet.has(i)),
              mode: 'markers', name: 'Violation', marker: { color: '#dc2626', size: 9, symbol: 'circle-open', line: { width: 2 } },
            }] : []),
          ],
          plotLayout: { ...BASE, xaxis: { title: { text: 'Observation' }, gridcolor: GREY }, yaxis: { title: { text: sc.name }, gridcolor: GREY }, title: { text: `${sc.name} Control Chart` }, showlegend: true },
        }
      },
    })
  }

  const allViol = (r.subcharts as Any[]).flatMap(sc => (sc.violations ?? []).map((v: Any) => ({ ...v, chart: sc.name })))
  if (allViol.length) {
    out.push({
      id: mkId('spc'), module: MOD, moduleLabel: ML,
      group: GP, label: 'Control Chart Violations', type: 'table',
      getData: () => ({
        tableHeaders: ['Chart', 'Point', 'Value', 'Rule', 'Description'],
        tableRows: allViol.map(v => [v.chart, v.index + 1, fmt(v.value), v.rule, v.description]),
      }),
    })
  }
}

// ---------------------------------------------------------------------------
// Design of Experiments
// ---------------------------------------------------------------------------

function extractDOE(modules: Record<string, unknown>, out: AssetDescriptor[]) {
  const s = modules['doe'] as { result?: GenerateDesignResponse | null } | null
  const r = s?.result
  if (!r?.runs?.length) return
  const MOD = 'doe', ML = 'Design of Experiments', GP = 'DOE'

  // Design matrix table
  const allCols = Object.keys(r.columns)
  const displayCols = allCols.filter(c => !c.endsWith('_real'))
  const headers = displayCols.length ? displayCols : allCols
  out.push({
    id: mkId('doe'), module: MOD, moduleLabel: ML,
    group: GP, label: 'Design Matrix', type: 'table',
    getData: () => ({
      tableHeaders: ['Run', ...headers],
      tableRows: r.runs.map((run, i) => [i + 1, ...headers.map(h => run[h] != null ? String(run[h]) : '—')]),
    }),
  })

  // Design space plot (2D scatter for 2 factors, 3D for 3+)
  const factors = allCols.filter(c => !c.endsWith('_real') && c !== 'Run' && c !== 'run' && c !== 'Block' && c !== 'Replicate')
  if (factors.length >= 2) {
    out.push({
      id: mkId('doe'), module: MOD, moduleLabel: ML,
      group: GP, label: 'Design Space', type: 'plot',
      getData: () => {
        const xVals = r.runs.map(run => Number(run[factors[0]]))
        const yVals = r.runs.map(run => Number(run[factors[1]]))
        const labels = r.runs.map((_, i) => String(i + 1))
        if (factors.length >= 3) {
          const zVals = r.runs.map(run => Number(run[factors[2]]))
          return {
            plotData: [{
              x: xVals, y: yVals, z: zVals, mode: 'markers+text', type: 'scatter3d',
              text: labels, textposition: 'top center', textfont: { size: 8 },
              marker: { color: '#3b82f6', size: 6 },
            }],
            plotLayout: {
              ...PLOT_BG, margin: { t: 35, r: 20, b: 30, l: 30 },
              scene: { xaxis: { title: { text: factors[0] } }, yaxis: { title: { text: factors[1] } }, zaxis: { title: { text: factors[2] } } },
              title: { text: 'Design Space (3D)' },
            },
          }
        }
        return {
          plotData: [{
            x: xVals, y: yVals, mode: 'markers+text', type: 'scatter',
            text: labels, textposition: 'top right', textfont: { size: 9 },
            marker: { color: '#3b82f6', size: 10 },
          }],
          plotLayout: { ...BASE, xaxis: { title: { text: factors[0] }, gridcolor: GREY }, yaxis: { title: { text: factors[1] }, gridcolor: GREY }, title: { text: 'Design Space' } },
        }
      },
    })
  }

  // Metadata metrics
  const meta = r.metadata ?? {}
  out.push({
    id: mkId('doe'), module: MOD, moduleLabel: ML,
    group: GP, label: 'Design Summary', type: 'metrics',
    getData: () => ({
      metrics: [
        { label: 'Design Type', value: String(meta.design_type ?? '—') },
        { label: 'Runs', value: String(meta.run_count ?? r.runs.length) },
        ...(meta.replicates != null ? [{ label: 'Replicates per Point', value: String(meta.replicates) }] : []),
        { label: 'Factors', value: String(meta.k ?? factors.length) },
        ...(meta.center_points != null ? [{ label: 'Center Points', value: String(meta.center_points) }] : []),
        ...(meta.resolution != null ? [{ label: 'Resolution', value: String(meta.resolution) }] : []),
      ],
    }),
  })
}

// ---------------------------------------------------------------------------
// Markov Analysis
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// System Modeling — RBD
// ---------------------------------------------------------------------------

function extractRBD(modules: Record<string, unknown>, out: AssetDescriptor[]) {
  const folio = extractFolioResult<{ result?: Any }>(modules, 'system')
  for (const { gp, st } of folio) {
    const r = st.result
    if (!r) continue
    const ML = 'Reliability Block Diagram'
    out.push({
      id: mkId('rbd'), module: 'system', moduleLabel: ML, group: gp,
      label: 'System Reliability', type: 'metrics',
      getData: () => ({
        metrics: [
          { label: 'System reliability', value: fmt(r.system_reliability) },
          { label: 'System unreliability', value: fmt(r.system_unreliability) },
          { label: 'Path sets', value: String((r.path_sets ?? []).length) },
          ...(r.mission_time != null ? [{ label: 'Mission time', value: fmt(r.mission_time) }] : []),
          ...(r.restricted_mean_survival_time != null
            ? [{ label: 'Restricted mean survival time', value: fmt(r.restricted_mean_survival_time) }] : []),
          ...(r.computation?.engine ? [{ label: 'Engine', value: String(r.computation.engine).replace(/_/g, ' ') }] : []),
        ],
      }),
    })
    if (r.time_curve?.length) {
      out.push({
        id: mkId('rbd'), module: 'system', moduleLabel: ML, group: gp,
        label: 'System Reliability vs Time', type: 'plot',
        getData: () => ({
          plotData: [{
            x: r.time_curve.map((point: Any) => point.time),
            y: r.time_curve.map((point: Any) => point.reliability),
            type: 'scatter', mode: 'lines', name: 'System reliability',
            line: { color: '#2563eb', width: 3 },
          }],
          plotLayout: {
            ...BASE,
            xaxis: { title: { text: 'Mission time' }, gridcolor: GREY },
            yaxis: { title: { text: 'Reliability R(t)' }, range: [0, 1.02], gridcolor: GREY },
            title: { text: 'RBD System Reliability vs Time' },
          },
        }),
      })
    }
    if (r.path_sets?.length) {
      out.push({
        id: mkId('rbd'), module: 'system', moduleLabel: ML, group: gp,
        label: 'Success Path Sets', type: 'table',
        getData: () => ({
          tableHeaders: ['Path', 'Reliability blocks'],
          tableRows: r.path_sets.map((path: string[], index: number) => [
            `P${index + 1}`, path.join(' → '),
          ]),
        }),
      })
    }
    if (r.importance?.length) {
      out.push({
        id: mkId('rbd'), module: 'system', moduleLabel: ML, group: gp,
        label: 'Importance Measures', type: 'table',
        getData: () => ({
          tableHeaders: ['Component', 'Reliability', 'Birnbaum', 'Criticality', 'RAW', 'RRW'],
          tableRows: r.importance.map((c: Any) => [
            c.label, fmt(c.reliability), fmt(c.Birnbaum), c.Criticality == null ? '—' : fmt(c.Criticality),
            c.RAW == null ? '—' : fmt(c.RAW), c.RRW == null ? (c.RRW_unbounded ? '∞' : '—') : fmt(c.RRW),
          ]),
        }),
      })
      out.push({
        id: mkId('rbd'), module: 'system', moduleLabel: ML, group: gp,
        label: 'Birnbaum Importance', type: 'plot',
        getData: () => ({
          plotData: [{ x: r.importance.map((c: Any) => c.label), y: r.importance.map((c: Any) => c.Birnbaum), type: 'bar', marker: { color: '#3b82f6' } }],
          plotLayout: { ...BASE, yaxis: { title: { text: 'Birnbaum importance' }, gridcolor: '#e5e7eb' }, title: { text: 'Component Importance (Birnbaum)' } },
        }),
      })
    }
    const guidance = [
      ...(r.assumptions ?? []).map((message: string) => ['Assumption', message]),
      ...(r.warnings ?? []).map((message: string) => ['Warning', message]),
      ...(r.time_curve_unavailable_reason ? [['Time curve', r.time_curve_unavailable_reason]] : []),
    ]
    if (guidance.length) {
      out.push({
        id: mkId('rbd'), module: 'system', moduleLabel: ML, group: gp,
        label: 'Assumptions and Diagnostics', type: 'table',
        getData: () => ({ tableHeaders: ['Type', 'Detail'], tableRows: guidance }),
      })
    }
  }
}

// ---------------------------------------------------------------------------
// System Modeling — Fault Tree
// ---------------------------------------------------------------------------

function extractFaultTree(modules: Record<string, unknown>, out: AssetDescriptor[]) {
  const folio = extractFolioResult<{ result?: Any }>(modules, 'faultTree')
  for (const { gp, st } of folio) {
    const r = st.result
    if (!r) continue
    const ML = 'Fault Tree Analysis'
    out.push({
      id: mkId('fta'), module: 'faultTree', moduleLabel: ML, group: gp,
      label: 'Top Event', type: 'metrics',
      getData: () => ({
        metrics: [
          { label: 'Top-event probability', value: fmt(r.top_event_probability) },
          { label: 'Analysis class', value: String(r.analysis_kind ?? 'static_coherent').replace(/_/g, ' ') },
          { label: 'Engine', value: String(r.computation?.engine?.engine ?? r.computation?.exact_engine?.engine ?? '—').replace(/_/g, ' ') },
          ...(r.analysis_kind === 'static_coherent'
            ? [{ label: 'Minimal cut sets', value: String((r.minimal_cut_sets ?? []).length) }]
            : r.analysis_kind === 'static_noncoherent'
              ? [{ label: 'Failure conditions', value: String((r.failure_conditions ?? []).length) }]
              : [{ label: 'First-entry / observed sequences', value: String((r.cut_sequences ?? []).length) }]),
          ...(r.simulation ? [{ label: 'Monte-Carlo probability', value: fmt(r.simulation.probability) }] : []),
          ...(r.simulation ? [{ label: `${fmt((r.simulation.confidence_level ?? 0.95) * 100)}% interval`, value: `[${fmt(r.simulation.ci_lower)}, ${fmt(r.simulation.ci_upper)}]` }] : []),
        ],
      }),
    })
    if (r.importance?.length) {
      out.push({
        id: mkId('fta'), module: 'faultTree', moduleLabel: ML, group: gp,
        label: 'Importance Measures', type: 'table',
        getData: () => ({
          tableHeaders: ['Event', 'Birnbaum', 'Fussell-Vesely', 'RAW', 'RRW'],
          tableRows: r.importance.map((e: Any) => [
            e.event, fmt(e.Birnbaum), fmt(e['Fussell-Vesely']),
            e.RAW == null ? '—' : fmt(e.RAW), e.RRW == null ? '—' : fmt(e.RRW),
          ]),
        }),
      })
    }
    if (r.minimal_cut_sets?.length) {
      out.push({
        id: mkId('fta'), module: 'faultTree', moduleLabel: ML, group: gp,
        label: 'Minimal Cut Sets', type: 'table',
        getData: () => ({
          tableHeaders: ['#', 'Order', 'Events'],
          tableRows: r.minimal_cut_sets.map((cs: string[], i: number) => [String(i + 1), String(cs.length), cs.join(', ')]),
        }),
      })
    }
    if (r.failure_conditions?.length) {
      out.push({
        id: mkId('fta'), module: 'faultTree', moduleLabel: ML, group: gp,
        label: 'Disjoint Failure Conditions', type: 'table',
        getData: () => ({
          tableHeaders: ['#', 'Order', 'Required failed', 'Required successful', 'Probability mass'],
          tableRows: r.failure_conditions.map((condition: Any, i: number) => [
            String(i + 1), String(condition.order),
            (condition.required_failed ?? []).join(', ') || 'None',
            (condition.required_successful ?? []).join(', ') || 'None',
            fmt(condition.probability),
          ]),
        }),
      })
    }
    if (r.cut_sequences?.length) {
      out.push({
        id: mkId('fta'), module: 'faultTree', moduleLabel: ML, group: gp,
        label: r.computation?.exact_engine?.exact ? 'Exact First-Entry Sequences' : 'Observed Failure Sequences',
        type: 'table',
        getData: () => ({
          tableHeaders: ['#', 'Sequence', 'Probability contribution', 'Share of top event', 'Basis'],
          tableRows: r.cut_sequences.map((sequence: Any, i: number) => [
            String(i + 1), (sequence.events ?? []).join(' → ') || 'Immediate condition',
            fmt(sequence.estimated_probability), fmt(sequence.conditional_contribution),
            sequence.kind === 'exact_first_entry_sequence'
              ? 'Exact CTMC' : `${sequence.count ?? 0} simulated top-event trials`,
          ]),
        }),
      })
    }
    if (r.time_curve?.length) {
      out.push({
        id: mkId('fta'), module: 'faultTree', moduleLabel: ML, group: gp,
        label: 'Top-Event Probability vs Time', type: 'plot',
        getData: () => ({
          plotData: [{
            x: r.time_curve.map((point: Any) => point.time),
            y: r.time_curve.map((point: Any) => point.probability),
            type: 'scatter', mode: 'lines', name: 'P(TOP)',
            line: { color: '#dc2626', width: 2.5 },
          }],
          plotLayout: {
            ...BASE, title: { text: 'Top-Event Probability vs Time' },
            xaxis: { title: { text: 'Mission time' }, gridcolor: GREY },
            yaxis: { title: { text: 'Probability' }, range: [0, 1], gridcolor: GREY },
          },
        }),
      })
    }
    if (r.node_results?.length) {
      out.push({
        id: mkId('fta'), module: 'faultTree', moduleLabel: ML, group: gp,
        label: 'Node Probabilities', type: 'table',
        getData: () => ({
          tableHeaders: ['Node', 'Type', 'Probability'],
          tableRows: [...r.node_results]
            .sort((left: Any, right: Any) => Number(right.probability) - Number(left.probability))
            .map((node: Any) => [node.label, String(node.type).toUpperCase(), fmt(node.probability)]),
        }),
      })
    }
    if (r.methods && Object.keys(r.methods).length) {
      out.push({
        id: mkId('fta'), module: 'faultTree', moduleLabel: ML, group: gp,
        label: 'Evaluation Methods', type: 'table',
        getData: () => ({
          tableHeaders: ['Method', 'Top-event probability'],
          tableRows: Object.entries(r.methods).map(([method, value]) => [
            method.replace(/_/g, ' '), value == null ? 'Unavailable' : fmt(Number(value)),
          ]),
        }),
      })
    }
    if (r.assumptions?.length || r.diagnostics?.length) {
      out.push({
        id: mkId('fta'), module: 'faultTree', moduleLabel: ML, group: gp,
        label: 'Assumptions and Diagnostics', type: 'table',
        getData: () => ({
          tableHeaders: ['Type', 'Code', 'Statement'],
          tableRows: [
            ...(r.assumptions ?? []).map((statement: string) => ['Assumption', '—', statement]),
            ...(r.diagnostics ?? []).map((item: Any) => [item.severity ?? 'Diagnostic', item.code ?? '—', item.message]),
          ],
        }),
      })
    }
  }
}

// ---------------------------------------------------------------------------
// System Modeling — Markov
// ---------------------------------------------------------------------------

function extractMarkov(modules: Record<string, unknown>, out: AssetDescriptor[]) {
  const folios = extractFolioResult<{ result?: Any }>(modules, 'markov')
  for (const { gp, st } of folios) {
    const r = st.result
    if (!r) continue
    const ML = 'Markov Analysis'
    const sp = r.system_params ?? {}
    out.push({
      id: mkId('mkv'), module: 'markov', moduleLabel: ML, group: gp,
      label: 'System Parameters', type: 'metrics',
      getData: () => ({
        metrics: [
          { label: 'Selected state model', value: r.model_contract?.display_name ?? 'Time-homogeneous CTMC' },
          { label: 'Steady-state availability', value: fmt(sp.availability_ss) },
          { label: 'Steady-state unavailability', value: fmt(sp.unavailability_ss) },
          { label: 'MTTF', value: fmt(sp.mttf) },
          { label: 'MTBF', value: fmt(sp.mtbf) },
          { label: 'Mean up time (MUT)', value: fmt(sp.mut) },
          { label: 'MTTR', value: fmt(sp.mttr) },
          { label: 'Failure frequency', value: fmt(sp.failure_frequency) },
          { label: 'Repair frequency', value: fmt(sp.repair_frequency) },
        ],
      }),
    })
    if (r.steady_state && r.states?.length) {
      out.push({
        id: mkId('mkv'), module: 'markov', moduleLabel: ML, group: gp,
        label: 'Steady-State Probabilities', type: 'table',
        getData: () => ({
          tableHeaders: ['State ID', 'State', 'Type', 'Dwell model', 'Probability'],
          tableRows: r.states.map((state: Any) => [
            state.id, state.name, state.type,
            state.dwell_model === 'erlang' ? `Erlang (k=${state.dwell_shape})` : 'Exponential',
            fmt(r.steady_state[state.id]),
          ]),
        }),
      })
    }
    if (r.transitions?.length) {
      out.push({
        id: mkId('mkv'), module: 'markov', moduleLabel: ML, group: gp,
        label: 'Transition Definitions', type: 'table',
        getData: () => ({
          tableHeaders: ['ID', 'From', 'To', 'Rate', 'Rate CV', 'Label'],
          tableRows: r.transitions.map((transition: Any) => [
            transition.id ?? '—', transition.from, transition.to,
            fmt(transition.rate), fmt(transition.rate_cv), transition.label || '—',
          ]),
        }),
      })
    }
    if (r.time_dependent?.length) {
      const td = r.time_dependent as Any[]
      out.push({
        id: mkId('mkv'), module: 'markov', moduleLabel: ML, group: gp,
        label: 'State Probabilities vs Time', type: 'plot',
        getData: () => ({
          plotData: r.states.map((state: Any, index: number) => ({
            x: td.map(entry => entry.time), y: td.map(entry => entry.state_probs[state.id] ?? 0),
            mode: 'lines', name: state.name, line: { color: COLORS[index % COLORS.length], width: 2 },
          })),
          plotLayout: { ...BASE, xaxis: { title: { text: 'Time' }, gridcolor: GREY }, yaxis: { title: { text: 'State probability' }, range: [0, 1], gridcolor: GREY }, title: { text: 'Markov State Probabilities' } },
        }),
      })
      out.push({
        id: mkId('mkv'), module: 'markov', moduleLabel: ML, group: gp,
        label: 'Availability & Reliability vs Time', type: 'plot',
        getData: () => ({
          plotData: [
            { x: td.map(entry => entry.time), y: td.map(entry => entry.availability), mode: 'lines', name: 'Availability', line: { color: '#10b981', width: 2 } },
            { x: td.map(entry => entry.time), y: td.map(entry => entry.reliability), mode: 'lines', name: 'Reliability', line: { color: '#2563eb', width: 2 } },
            { x: td.map(entry => entry.time), y: td.map(entry => entry.unavailability), mode: 'lines', name: 'Unavailability', line: { color: '#ef4444', width: 1.5, dash: 'dot' } },
            ...(r.ctmc_baseline?.time_dependent?.length ? [
              { x: r.ctmc_baseline.time_dependent.map((entry: Any) => entry.time), y: r.ctmc_baseline.time_dependent.map((entry: Any) => entry.availability), mode: 'lines', name: 'CTMC baseline availability', line: { color: '#64748b', width: 1, dash: 'dash' } },
            ] : []),
          ],
          plotLayout: { ...BASE, xaxis: { title: { text: 'Time' }, gridcolor: GREY }, yaxis: { title: { text: 'Probability' }, range: [0, 1], gridcolor: GREY }, title: { text: 'Markov Availability & Reliability' } },
        }),
      })
    }
    if (r.transition_matrix?.length) {
      out.push({
        id: mkId('mkv'), module: 'markov', moduleLabel: ML, group: gp,
        label: 'Generator Matrix Q', type: 'table',
        getData: () => ({
          tableHeaders: ['Source / destination', ...r.states.map((state: Any) => state.name)],
          tableRows: r.transition_matrix.map((row: number[], index: number) => [
            r.states[index]?.name ?? `State ${index + 1}`, ...row.map(value => fmt(value)),
          ]),
        }),
      })
    }
    if (r.parameter_uncertainty?.metric_intervals) {
      out.push({
        id: mkId('mkv'), module: 'markov', moduleLabel: ML, group: gp,
        label: 'Rate-Uncertainty Intervals', type: 'table',
        getData: () => ({
          tableHeaders: ['Metric', 'Lower', 'Median', 'Upper', 'Successful draws'],
          tableRows: Object.entries(r.parameter_uncertainty.metric_intervals).map(([key, interval]: [string, Any]) => [
            key.replace(/_/g, ' '), fmt(interval.lower), fmt(interval.median), fmt(interval.upper), interval.successful,
          ]),
        }),
      })
    }
    const diagnostics = [
      ...(r.model_contract?.assumptions ?? []).map((message: string) => ['Assumption', '—', message]),
      ...(r.model_contract?.warnings ?? []).map((message: string) => ['Warning', 'MODEL_CONTRACT', message]),
      ...(r.validation?.issues ?? []).map((issue: Any) => [issue.severity, issue.code, issue.message]),
    ]
    if (diagnostics.length) {
      out.push({
        id: mkId('mkv'), module: 'markov', moduleLabel: ML, group: gp,
        label: 'Model Contract and Diagnostics', type: 'table',
        getData: () => ({ tableHeaders: ['Type', 'Code', 'Statement'], tableRows: diagnostics }),
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Reliability Testing — session tools (RDT, test design, margin)
// ---------------------------------------------------------------------------

const RT = 'Reliability Testing'

function extractMarginTest(modules: Record<string, unknown>, out: AssetDescriptor[]) {
  const r = (modules['marginTest'] as { result?: MarginTestResponse | null } | null)?.result
  if (!r) return
  out.push({
    id: mkId('mt'), module: 'marginTest', moduleLabel: RT, group: 'Margin Test',
    label: 'Margin Test Results', type: 'metrics',
    getData: () => ({
      metrics: [
        { label: 'Demonstrated reliability', value: fmt(r.demonstrated_reliability) },
        { label: `Lower bound (${Math.round(r.confidence * 100)}%)`, value: fmt(r.reliability_lower_bound) },
        { label: 'Equivalent time at spec', value: fmt(r.equivalent_time_at_spec) },
        { label: 'MTBF at spec', value: r.mtbf_at_spec == null ? '—' : fmt(r.mtbf_at_spec) },
        { label: 'Acceleration factor', value: fmt(r.acceleration_factor) },
        { label: 'Margin ratio', value: r.margin_ratio == null ? '—' : fmt(r.margin_ratio) },
      ],
    }),
  })
}

function extractExpChiSquared(modules: Record<string, unknown>, out: AssetDescriptor[]) {
  const r = (modules['expChiSquared'] as { result?: ExpChiSquaredResponse | null } | null)?.result
  if (!r) return
  out.push({
    id: mkId('ecs'), module: 'expChiSquared', moduleLabel: RT, group: 'Exponential Chi-Squared',
    label: 'Chi-Squared Demonstration', type: 'metrics',
    getData: () => ({
      metrics: [
        { label: 'Accumulated test time', value: fmt(r.accumulated_test_time) },
        { label: 'Chi-squared', value: fmt(r.chi_squared) },
        { label: 'Implied MTTF', value: fmt(r.implied_mttf) },
        { label: 'Confidence', value: `${Math.round(r.confidence * 100)}%` },
        { label: 'Allowable failures', value: String(r.failures) },
        ...(r.sample_size != null ? [{ label: 'Sample size', value: String(r.sample_size) }] : []),
        ...(r.test_time != null ? [{ label: 'Test time per unit', value: fmt(r.test_time) }] : []),
      ],
    }),
  })
}

function extractBayesianRDT(modules: Record<string, unknown>, out: AssetDescriptor[]) {
  const r = (modules['rdtBayesian'] as { result?: BayesianRDTResponse | null } | null)?.result
  if (!r) return
  out.push({
    id: mkId('brt'), module: 'rdtBayesian', moduleLabel: RT, group: 'Bayesian RDT',
    label: 'Bayesian Demonstration', type: 'metrics',
    getData: () => ({
      metrics: [
        ...(r.sample_size != null ? [{ label: 'Required sample size', value: String(r.sample_size) }] : []),
        ...(r.reliability != null ? [{ label: 'Demonstrated reliability', value: fmt(r.reliability) }] : []),
        ...(r.confidence != null ? [{ label: 'Confidence', value: `${(r.confidence * 100).toFixed(2)}%` }] : []),
        { label: 'Prior source', value: r.prior_source },
        { label: 'E(R₀)', value: fmt(r.E_R0) },
        { label: 'α₀ / β₀', value: `${fmt(r.alpha0)} / ${fmt(r.beta0)}` },
        ...(r.posterior_alpha != null && r.posterior_beta != null
          ? [{ label: 'Posterior α / β', value: `${fmt(r.posterior_alpha)} / ${fmt(r.posterior_beta)}` }] : []),
      ],
    }),
  })
  out.push({
    id: mkId('brt'), module: 'rdtBayesian', moduleLabel: RT, group: 'Bayesian RDT',
    label: 'Beta Prior / Posterior', type: 'plot',
    getData: () => {
      const prior = betaPdfCurve(r.alpha0, r.beta0)
      const hasPost = r.posterior_alpha != null && r.posterior_beta != null
      const post = hasPost ? betaPdfCurve(r.posterior_alpha!, r.posterior_beta!) : null
      const ymax = Math.max(...prior.y, ...(post ? post.y : [0])) * 1.05
      const data: Record<string, unknown>[] = [
        { x: prior.x, y: prior.y, mode: 'lines', name: 'Prior', line: { color: COLORS[0], width: 2 } },
        ...(post ? [{ x: post.x, y: post.y, mode: 'lines', name: 'Posterior', line: { color: COLORS[1], width: 2 } }] : []),
        { x: [r.E_R0, r.E_R0], y: [0, ymax], mode: 'lines', name: `E(R₀)=${r.E_R0.toFixed(3)}`, line: { color: '#9ca3af', width: 1.5, dash: 'dot' } },
      ]
      return { plotData: data, plotLayout: { ...BASE, xaxis: { title: { text: 'Reliability R' }, range: [0, 1] }, yaxis: { title: { text: 'Density' }, rangemode: 'tozero' }, title: { text: 'Reliability belief (Beta)' } } }
    },
  })
}

function extractDifferenceDetection(modules: Record<string, unknown>, out: AssetDescriptor[]) {
  const r = (modules['differenceDetection'] as { result?: DifferenceDetectionResponse | null } | null)?.result
  if (!r) return
  out.push({
    id: mkId('dd'), module: 'differenceDetection', moduleLabel: RT, group: 'Difference Detection',
    label: 'Detectable Test Time', type: 'plot',
    getData: () => {
      const z = r.matrix.map(row => row.map(v => (v > 0 ? v : null)))
      const text = r.matrix.map(row => row.map(v => (v > 0 ? fmt(v) : '')))
      return {
        plotData: [{
          type: 'heatmap', x: r.values, y: r.values, z, text, texttemplate: '%{text}',
          textfont: { size: 10 }, colorscale: 'YlGnBu', reversescale: true, hoverongaps: false,
          colorbar: { title: { text: 'Detect time' }, thickness: 12 },
        }],
        plotLayout: { ...BASE, xaxis: { title: { text: 'Design 1 metric' }, type: 'category' }, yaxis: { title: { text: 'Design 2 metric' }, type: 'category' }, title: { text: 'Shortest detectable test duration' } },
      }
    },
  })
}

// ---------------------------------------------------------------------------
// Maintenance — replacement policy, PM interval, cost forecast, availability
// ---------------------------------------------------------------------------

function extractMaintenance(modules: Record<string, unknown>, out: AssetDescriptor[]) {
  const ML = 'Maintenance'

  const virtualAge = (modules['maintVirtualAge'] as { result?: VirtualAgeSimulationResponse | null } | null)?.result
  if (virtualAge) {
    out.push({
      id: mkId('mva'), module: 'maintVirtualAge', moduleLabel: ML, group: 'Virtual Age',
      label: 'Virtual-Age Simulation Summary', type: 'metrics',
      getData: () => ({ metrics: [
        { label: 'Simulations', value: virtualAge.n_simulations.toLocaleString() },
        { label: 'Mean failures', value: fmt(virtualAge.failures.mean) },
        { label: 'Mean preventive actions', value: fmt(virtualAge.preventive_actions.mean) },
        { label: 'Mean total cost', value: fmt(virtualAge.total_cost.mean) },
        { label: 'Mean availability', value: fmt(virtualAge.availability.mean) },
      ] }),
    })
    out.push({
      id: mkId('mva'), module: 'maintVirtualAge', moduleLabel: ML, group: 'Virtual Age',
      label: 'Finite-Horizon Failure Burden', type: 'plot',
      getData: () => ({
        plotData: [
          { x: virtualAge.curve.time, y: virtualAge.curve.upper_cumulative_failures, mode: 'lines', line: { width: 0 }, showlegend: false },
          { x: virtualAge.curve.time, y: virtualAge.curve.lower_cumulative_failures, mode: 'lines', name: `${(virtualAge.CI * 100).toFixed(0)}% simulation interval`, fill: 'tonexty', fillcolor: 'rgba(245,158,11,0.14)', line: { width: 0 } },
          { x: virtualAge.curve.time, y: virtualAge.curve.mean_cumulative_failures, mode: 'lines', name: 'Mean cumulative failures', line: { color: '#d97706', width: 2 } },
        ],
        plotLayout: { ...BASE, xaxis: { title: { text: 'Calendar time' }, gridcolor: GREY }, yaxis: { title: { text: 'Cumulative failures' }, gridcolor: GREY }, title: { text: 'Finite-Horizon Failure Burden' } },
      }),
    })
  }

  const rp = (modules['maintReplacement'] as { result?: ReplacementPolicyResponse | null } | null)?.result
  if (rp) {
    out.push({
      id: mkId('mrp'), module: 'maintReplacement', moduleLabel: ML, group: 'Replacement Policy',
      label: 'Age vs Block Policy', type: 'metrics',
      getData: () => ({
        metrics: [
          { label: 'Recommended policy', value: rp.cheaper_policy === 'age' ? 'Age replacement' : rp.cheaper_policy === 'block' ? 'Block replacement' : 'Run to failure' },
          { label: 'Age optimal interval', value: rp.age.optimal_time == null ? 'Run to failure' : fmt(rp.age.optimal_time) },
          { label: 'Age cost/unit time', value: fmt(rp.age.min_cost) },
          { label: 'Block optimal interval', value: rp.block.optimal_time == null ? 'Run to failure' : fmt(rp.block.optimal_time) },
          { label: 'Block cost/unit time', value: fmt(rp.block.min_cost) },
          { label: 'Corrective-only cost rate', value: fmt(rp.corrective_only_cost) },
        ],
      }),
    })
    out.push({
      id: mkId('mrp'), module: 'maintReplacement', moduleLabel: ML, group: 'Replacement Policy',
      label: 'Age vs Block Cost Curves', type: 'plot',
      getData: () => ({
        plotData: [
          { x: rp.age.time, y: rp.age.cost, mode: 'lines', name: 'Age', line: { color: COLORS[0], width: 2 } },
          { x: rp.block.time, y: rp.block.cost, mode: 'lines', name: 'Block', line: { color: '#f59e0b', width: 2 } },
          ...(rp.age.optimal_time == null ? [] : [{ x: [rp.age.optimal_time], y: [rp.age.min_cost], mode: 'markers', name: 'Age optimum', marker: { color: COLORS[0], size: 10, symbol: 'star' } }]),
          ...(rp.block.optimal_time == null ? [] : [{ x: [rp.block.optimal_time], y: [rp.block.min_cost], mode: 'markers', name: 'Block optimum', marker: { color: '#f59e0b', size: 10, symbol: 'star' } }]),
        ],
        plotLayout: { ...BASE, xaxis: { title: { text: 'Replacement interval' }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'Cost per unit time' }, gridcolor: '#e5e7eb' }, title: { text: 'Cost per Unit Time vs Replacement Interval' } },
      }),
    })
  }

  const pm = (modules['maintPMInterval'] as { result?: PMIntervalResponse | null } | null)?.result
  if (pm) {
    out.push({
      id: mkId('mpm'), module: 'maintPMInterval', moduleLabel: ML, group: 'PM Interval',
      label: 'PM Interval (MFOP)', type: 'metrics',
      getData: () => ({
        metrics: [
          { label: 'Target reliability', value: `${(pm.target_reliability * 100).toFixed(0)}%` },
          { label: 'PM interval', value: fmt(pm.pm_interval) },
          { label: 'PM actions over horizon', value: String(pm.n_pm) },
          { label: 'MTTF', value: fmt(pm.mttf) },
        ],
      }),
    })
    out.push({
      id: mkId('mpm'), module: 'maintPMInterval', moduleLabel: ML, group: 'PM Interval',
      label: 'Reliability with Preventive Maintenance', type: 'plot',
      getData: () => ({
        plotData: [
          { x: pm.curve.time, y: pm.curve.reliability_pm, mode: 'lines', name: 'With PM', line: { color: '#10b981', width: 2 } },
          { x: pm.curve.time, y: pm.curve.reliability_none, mode: 'lines', name: 'No maintenance', line: { color: '#9ca3af', width: 1.5, dash: 'dot' } },
        ],
        plotLayout: { ...BASE, xaxis: { title: { text: 'Time' }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'Reliability R(t)' }, gridcolor: '#e5e7eb' }, title: { text: 'Reliability with Preventive Maintenance' } },
      }),
    })
  }

  const cf = (modules['maintCostForecast'] as { result?: CostForecastResponse | null } | null)?.result
  if (cf) {
    out.push({
      id: mkId('mcf'), module: 'maintCostForecast', moduleLabel: ML, group: 'Cost Forecast',
      label: 'Maintenance Cost Forecast', type: 'metrics',
      getData: () => ({
        metrics: [
          { label: 'Policy', value: cf.policy },
          { label: 'Total cost', value: fmt(cf.total_cost) },
          { label: 'Expected PM events', value: fmt(cf.expected_pm) },
          { label: 'Expected CM events', value: fmt(cf.expected_cm) },
        ],
      }),
    })
    out.push({
      id: mkId('mcf'), module: 'maintCostForecast', moduleLabel: ML, group: 'Cost Forecast',
      label: 'Cumulative Maintenance Cost', type: 'plot',
      getData: () => ({
        plotData: [
          { x: cf.time, y: cf.cumulative_cost, mode: 'lines', name: 'Cumulative cost', line: { color: '#6366f1', width: 2 } },
        ],
        plotLayout: { ...BASE, xaxis: { title: { text: 'Time' }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'Cumulative cost' }, gridcolor: '#e5e7eb' }, title: { text: 'Cumulative Maintenance Cost over the Horizon' } },
      }),
    })
  }

  const av = (modules['maintAvailability'] as { result?: AvailabilitySensitivityResponse | null } | null)?.result
  if (av) {
    out.push({
      id: mkId('mav'), module: 'maintAvailability', moduleLabel: ML, group: 'Availability Sensitivity',
      label: 'Availability Sensitivity', type: 'metrics',
      getData: () => ({
        metrics: [
          { label: 'Operational availability', value: `${(av.baseline_availability * 100).toFixed(3)}%` },
          { label: 'Mean down time', value: fmt(av.mean_down_time) },
          { label: 'Most sensitive driver', value: av.tornado[0]?.driver ?? '—' },
          ...(av.solve ? [{ label: `Required MTTR for ${(av.solve.target_availability * 100).toFixed(1)}%`, value: av.solve.achievable ? fmt(av.solve.required_mttr) : 'not achievable' }] : []),
        ],
      }),
    })
    out.push({
      id: mkId('mav'), module: 'maintAvailability', moduleLabel: ML, group: 'Availability Sensitivity',
      label: 'Availability Tornado', type: 'plot',
      getData: () => ({
        plotData: [
          { type: 'bar', orientation: 'h', x: av.tornado.map(d => d.range), y: av.tornado.map(d => d.driver), marker: { color: '#0ea5e9' } },
        ],
        plotLayout: { ...BASE, xaxis: { title: { text: 'Availability swing (range)' }, gridcolor: '#e5e7eb' }, yaxis: { automargin: true }, title: { text: 'Availability Sensitivity' } },
      }),
    })
  }
}

// ---------------------------------------------------------------------------
// Human Reliability Analysis (HRA)
// ---------------------------------------------------------------------------

const HRA_METHODS: { slice: string; label: string }[] = [
  { slice: 'hraTherp', label: 'THERP' }, { slice: 'hraHeart', label: 'HEART' },
  { slice: 'hraSparH', label: 'SPAR-H' }, { slice: 'hraCream', label: 'CREAM' },
  { slice: 'hraCreamExt', label: 'CREAM Extended' },
  { slice: 'hraSlim', label: 'SLIM-MAUD' }, { slice: 'hraAtheana', label: 'EFC Elicitation Screen' },
  { slice: 'hraJhedi', label: 'Category-Factor Screen' }, { slice: 'hraSherpa', label: 'Error-Mode Screen' },
  { slice: 'hraMermos', label: 'Mission-Scenario Screen' },
]

function extractHRA(modules: Record<string, unknown>, out: AssetDescriptor[]) {
  const ML = 'Human Reliability Analysis'
  const heps: { label: string; hep: number }[] = []

  for (const m of HRA_METHODS) {
    const r = (modules[m.slice] as { result?: { hep?: number } | null } | null)?.result
    const hep = r?.hep
    if (typeof hep !== 'number') continue
    heps.push({ label: m.label, hep })
    out.push({
      id: mkId('hra'), module: m.slice, moduleLabel: ML, group: m.label,
      label: `${m.label} HEP`, type: 'metrics',
      getData: () => ({ metrics: [{ label: `${m.label} human error probability`, value: fmt(hep) }] }),
    })
  }

  if (heps.length >= 2) {
    out.push({
      id: mkId('hra'), module: 'hra', moduleLabel: ML, group: 'Comparison',
      label: 'HEP by Method', type: 'plot',
      getData: () => ({
        plotData: [{ type: 'bar', x: heps.map(h => h.label), y: heps.map(h => h.hep), marker: { color: COLORS[0] } }],
        plotLayout: { ...BASE, xaxis: { title: { text: '' }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'HEP' }, type: 'log', gridcolor: '#e5e7eb' }, title: { text: 'Human Error Probability by Method' } },
      }),
    })
  }
}

// ---------------------------------------------------------------------------
// Degradation
// ---------------------------------------------------------------------------

function extractDegradation(modules: Record<string, unknown>, out: AssetDescriptor[]) {
  const deg = modules['degradation'] as {
    nd?: { result?: DegradationResponse | null }
    dest?: { result?: DestructiveDegradationResponse | null }
  } | null
  if (!deg) return
  const ML = 'Degradation'

  const nd = deg.nd?.result
  if (nd) {
    const fit = nd.distribution_fit
    if (fit) {
      out.push({
        id: mkId('deg'), module: 'degradation', moduleLabel: ML, group: 'Non-Destructive',
        label: 'Projected Life Summary', type: 'metrics',
        getData: () => ({
          metrics: [
            { label: 'Distribution', value: fit.distribution },
            { label: 'Mean life', value: fmt(fit.summary?.mean) },
            { label: 'B50 (median)', value: fmt(fit.summary?.B50) },
            { label: 'B10 life', value: fmt(fit.summary?.B10) },
          ],
        }),
      })
      if (fit.curve_x?.length && fit.cdf?.length) {
        out.push({
          id: mkId('deg'), module: 'degradation', moduleLabel: ML, group: 'Non-Destructive',
          label: 'Projected Failure-Time Distribution', type: 'plot',
          getData: () => ({
            plotData: [{ x: fit.curve_x, y: fit.cdf, mode: 'lines', name: 'CDF', line: { color: COLORS[0], width: 2 } }],
            plotLayout: { ...BASE, xaxis: { title: { text: 'Time to failure' }, gridcolor: GREY }, yaxis: { title: { text: 'Unreliability' }, range: [0, 1], gridcolor: GREY }, title: { text: 'Projected Failure-Time Distribution (CDF)' } },
          }),
        })
      }
    }
    out.push({
      id: mkId('deg'), module: 'degradation', moduleLabel: ML, group: 'Non-Destructive',
      label: 'Degradation Paths', type: 'plot',
      getData: () => {
        const traces: Record<string, unknown>[] = []
        nd.paths.forEach((p, i) => {
          const c = COLORS[i % COLORS.length]
          traces.push({ x: p.t, y: p.m, mode: 'markers', name: p.unit_id, marker: { color: c, size: 6 } })
          if (p.fit_t && p.fit_m) traces.push({ x: p.fit_t, y: p.fit_m, mode: 'lines', line: { color: c, width: 1.5, dash: 'dot' }, showlegend: false })
        })
        const allT = nd.paths.flatMap(p => [...p.t, ...(p.fit_t ?? [])])
        traces.push({ x: [Math.min(...allT), Math.max(...allT)], y: [nd.threshold, nd.threshold], mode: 'lines', name: 'Threshold', line: { color: '#9ca3af', width: 1.5, dash: 'dash' } })
        return { plotData: traces, plotLayout: { ...BASE, xaxis: { title: { text: 'Time' }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'Measurement' }, gridcolor: '#e5e7eb' }, title: { text: 'Degradation Paths' } } }
      },
    })
  }

  const dest = deg.dest?.result
  if (dest) {
    out.push({
      id: mkId('deg'), module: 'degradation', moduleLabel: ML, group: 'Destructive',
      label: 'Degradation vs Time', type: 'plot',
      getData: () => ({
        plotData: [
          { x: dest.scatter.t, y: dest.scatter.y, mode: 'markers', name: 'Measurements', marker: { color: COLORS[0], size: 5, opacity: 0.6 } },
          { x: dest.degradation_curve.t, y: dest.degradation_curve.median, mode: 'lines', name: 'Median path', line: { color: COLORS[2], width: 2 } },
          { x: [Math.min(...dest.scatter.t), Math.max(...dest.degradation_curve.t)], y: [dest.threshold, dest.threshold], mode: 'lines', name: 'Critical level', line: { color: '#ef4444', width: 1.5, dash: 'dash' } },
        ],
        plotLayout: { ...BASE, xaxis: { title: { text: 'Time' }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'Measurement' }, gridcolor: '#e5e7eb' }, title: { text: 'Destructive Degradation' } },
      }),
    })
    out.push({
      id: mkId('deg'), module: 'degradation', moduleLabel: ML, group: 'Destructive',
      label: 'Reliability vs Time', type: 'plot',
      getData: () => ({
        plotData: [{ x: dest.reliability_curve.t, y: dest.reliability_curve.R, mode: 'lines', name: 'R(t)', line: { color: COLORS[0], width: 2 } }],
        plotLayout: { ...BASE, xaxis: { title: { text: 'Time' }, gridcolor: '#e5e7eb' }, yaxis: { title: { text: 'Reliability' }, range: [0, 1], gridcolor: '#e5e7eb' }, title: { text: 'Reliability vs Time' } },
      }),
    })
    if (dest.distribution_comparison?.length) {
      out.push({
        id: mkId('deg'), module: 'degradation', moduleLabel: ML, group: 'Destructive',
        label: 'Measurement Distribution Ranking', type: 'table',
        getData: () => ({
          tableHeaders: ['Distribution', 'AICc', 'AIC', 'BIC', 'LogLik', 'Status'],
          tableRows: dest.distribution_comparison!.map(row => [
            row.distribution, fmt(row.AICc), fmt(row.AIC), fmt(row.BIC), fmt(row.LogLik), row.status,
          ]),
        }),
      })
    }
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
      st: (f.state != null ? { ...f, ...f.state } : f) as T,
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
  extractRAM(m, out)
  extractReliabilityAllocation(m, out)
  extractRBD(m, out)
  extractFaultTree(m, out)
  extractMarkov(m, out)
  extractMarginTest(m, out)
  extractExpChiSquared(m, out)
  extractBayesianRDT(m, out)
  extractDifferenceDetection(m, out)
  extractMaintenance(m, out)
  extractHRA(m, out)
  extractDegradation(m, out)
  extractPrediction(m, out)
  extractHypothesis(m, out)
  extractStatisticalModeling(m, out)
  extractDOE(m, out)
  extractPoF(m, out)
  extractSixSigma(m, out)
  extractMSA(m, out)
  extractSPC(m, out)
  const normalizedLabel = (label: string) => label.toLowerCase()
    .replace(/\bbest\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
  const assetIdentity = (moduleLabel: string, group: string, label: string) =>
    `${moduleLabel}|${group}|${normalizedLabel(label)}`
  for (const runtime of listRuntimePlotAssets()) {
    const identity = assetIdentity(runtime.moduleLabel, runtime.group, runtime.label)
    const descriptor: AssetDescriptor = {
      id: runtime.id,
      module: runtime.module,
      moduleLabel: runtime.moduleLabel,
      group: runtime.group,
      label: runtime.label,
      type: 'plot',
      getData: () => ({ plotData: runtime.plotData, plotLayout: runtime.plotLayout }),
    }
    const existingIndex = out.findIndex(asset =>
      assetIdentity(asset.moduleLabel, asset.group, asset.label) === identity)
    if (existingIndex >= 0) out[existingIndex] = descriptor
    else out.push(descriptor)
  }
  // Manual extractors also cover analyses that are not currently mounted.
  // Overlay their saved user markup at read time so Report Builder and ZIP
  // exports match what the user last annotated in the source module.
  for (const asset of out) {
    if (asset.type !== 'plot') continue
    const originalGetData = asset.getData
    asset.getData = () => {
      const data = originalGetData()
      const separated = splitUserMarkupFromLayout(data.plotLayout)
      const saved = getPlotMarkupForAsset(asset.module, asset.group, asset.label)
      // Runtime assets already contain the markup visible in their mounted
      // source plot. Prefer an exact saved lookup when available; otherwise
      // retain that embedded copy. Splitting first prevents duplicate guides
      // or notes when both paths resolve the same plot.
      const markup = saved.annotations.length || saved.shapes.length
        ? saved : separated.markup
      return {
        ...data,
        plotLayout: mergePlotMarkup(
          separated.layout as Partial<Plotly.Layout>,
          markup,
        ),
      }
    }
  }
  return out
}
