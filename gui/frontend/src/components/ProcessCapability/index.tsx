import { useState, useRef } from 'react'
import Plot from '../shared/ExportablePlot'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlotlyLayout = any
import { Play } from 'lucide-react'
import InfoLabel from '../shared/InfoLabel'
import NumberField from '../shared/NumberField'
import DataTable from '../shared/DataTable'
import DataGenerator from '../shared/DataGenerator'
import ExportResultsButton from '../shared/ExportResultsButton'
import ExampleButton from '../shared/ExampleButton'
import { Card } from '../shared/ui'
import { useModuleState } from '../../store/project'
import { analyzeCapability, CapabilityResponse } from '../../api/capability'
import {
  InfluenceOverlay,
  InfluenceScope,
  InfluenceSource,
  InfluenceTarget,
  useInfluenceCues,
} from '../shared/InfluenceCues'

// Curated near-centred process with Cpk ≈ 1.33 against LSL 9 / USL 11 (target 10):
// a textbook "capable" process for demonstrating Cp/Cpk/Cpm and the histogram fit.
const EXAMPLE_VALUES = [
  10.05, 10.134, 9.973, 9.801, 9.923, 9.772, 10.067, 10.425, 9.912, 9.876,
  10.187, 10.15, 10.08, 9.789, 10.042, 10.245, 9.674, 9.922, 9.518, 9.689,
  9.534, 9.984, 9.695, 10.126, 10.094, 9.998, 9.345, 9.899, 10.036, 10.082,
]

interface PCState {
  rows: Record<string, string>[]
  lsl: string
  usl: string
  target: string
  subgroup: string
  stability: 'assess' | 'stable' | 'unstable' | 'not_assessed'
  bootstrapSamples: string
  result: CapabilityResponse | null
}

const INITIAL: PCState = {
  rows: Array.from({ length: 8 }, () => ({ x: '' })),
  lsl: '',
  usl: '',
  target: '',
  subgroup: '1',
  stability: 'assess',
  bootstrapSamples: '200',
  result: null,
}

export default function ProcessCapability() {
  return <InfluenceScope className="flex flex-1 overflow-hidden"><ProcessCapabilityContent /></InfluenceScope>
}

function ProcessCapabilityContent() {
  const [s, setS] = useModuleState<PCState>('sixSigma.capability', INITIAL)
  const { active } = useInfluenceCues()
  const patch = (p: Partial<PCState>) => setS(prev => ({ ...prev, ...p }))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const values = () =>
    s.rows.map(r => parseFloat(r.x)).filter(v => !isNaN(v))

  const fillGenerated = (vals: number[]) =>
    patch({ rows: vals.map(v => ({ x: String(v) })), result: null })

  const run = async () => {
    const data = values()
    if (data.length < 2) { setError('Enter at least 2 data points.'); return }
    if (!s.lsl.trim() && !s.usl.trim()) {
      setError('Provide at least one specification limit (LSL or USL).'); return
    }
    setError(null); setLoading(true)
    try {
      const res = await analyzeCapability({
        data,
        lsl: s.lsl.trim() ? parseFloat(s.lsl) : null,
        usl: s.usl.trim() ? parseFloat(s.usl) : null,
        target: s.target.trim() ? parseFloat(s.target) : null,
        subgroup_size: Math.max(1, parseInt(s.subgroup, 10) || 1),
        stability_status: s.stability ?? 'assess',
        bootstrap_samples: Math.max(0, parseInt(s.bootstrapSamples, 10) || 0),
      })
      patch({ result: res })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        || 'Error computing capability.')
    } finally { setLoading(false) }
  }

  const r = s.result

  // Fitted normal curve for the histogram overlay
  const normalCurve = (resp: CapabilityResponse, sigma: number) => {
    const lo = resp.min - 3 * sigma
    const hi = resp.max + 3 * sigma
    const xs: number[] = []
    const ys: number[] = []
    const steps = 120
    const scale = resp.n * resp.histogram.bin_width
    for (let i = 0; i <= steps; i++) {
      const x = lo + (hi - lo) * (i / steps)
      const pdf = Math.exp(-0.5 * ((x - resp.mean) / sigma) ** 2) / (sigma * Math.sqrt(2 * Math.PI))
      xs.push(x); ys.push(pdf * scale)
    }
    return { xs, ys }
  }

  return (
    <>
      {/* Left panel */}
      <div className="w-80 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-4 flex flex-col gap-3">
        <div>
          <div className="flex items-center justify-between">
            <InfoLabel tip="One numeric measurement per row, in collection order so within-subgroup variation is estimated correctly.">
              Measurements <span className="text-gray-400">({values().length})</span>
            </InfoLabel>
            <ExampleButton hasData={values().length > 0}
              onLoad={() => patch({
                rows: EXAMPLE_VALUES.map(v => ({ x: String(v) })),
                lsl: '9', usl: '11', target: '10', subgroup: '1', result: null,
              })} />
          </div>
          <DataTable
            columns={[{ key: 'x', label: 'Value', type: 'number', placeholder: '0' }]}
            rows={s.rows}
            onChange={rows => patch({ rows, result: null })}
            minRows={1}
          />
        </div>

        <DataGenerator defaultDist="normal" onGenerate={fillGenerated}
          label="Generate sample data" />

        <div className="grid grid-cols-2 gap-2">
          <InfluenceSource influence="capability.lsl" className="-m-1 p-1">
            <InfoLabel tip="Lower spec limit (leave blank for a one-sided upper spec).">LSL</InfoLabel>
            <NumberField value={s.lsl} onChange={v => patch({ lsl: v, result: null })}
              className="w-full" placeholder="optional" />
          </InfluenceSource>
          <InfluenceSource influence="capability.usl" className="-m-1 p-1">
            <InfoLabel tip="Upper spec limit (leave blank for a one-sided lower spec).">USL</InfoLabel>
            <NumberField value={s.usl} onChange={v => patch({ usl: v, result: null })}
              className="w-full" placeholder="optional" />
          </InfluenceSource>
          <InfluenceSource influence="capability.target" className="-m-1 p-1">
            <InfoLabel tip="Target / nominal value. Enables Cpm when both spec limits are given.">Target</InfoLabel>
            <NumberField value={s.target} onChange={v => patch({ target: v, result: null })}
              className="w-full" placeholder="optional" />
          </InfluenceSource>
          <div>
            <InfoLabel tip="Rational subgroup size. 1 uses the average moving range; >1 uses average subgroup range.">Subgroup size</InfoLabel>
            <NumberField value={s.subgroup} min={1} step={1}
              onChange={v => patch({ subgroup: v, result: null })} className="w-full" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <InfluenceSource influence="capability.stability" className="-m-1 p-1">
            <InfoLabel tip="Interpret capability together with process stability. Assess runs a Phase-I I-MR or Xbar-R check; supplied status is recorded explicitly.">
              Stability status
            </InfoLabel>
            <select value={s.stability ?? 'assess'}
              onChange={e => patch({ stability: e.target.value as PCState['stability'], result: null })}
              className="w-full text-xs border border-gray-300 rounded px-2 py-1.5">
              <option value="assess">Assess from data</option>
              <option value="stable">Stable (supplied)</option>
              <option value="unstable">Unstable</option>
              <option value="not_assessed">Not assessed</option>
            </select>
          </InfluenceSource>
          <InfluenceSource influence="capability.bootstrap" className="-m-1 p-1">
            <InfoLabel tip="Resamples used for nonnormal Ppk sensitivity intervals. Set 0 to skip bootstrap intervals.">
              Bootstrap samples
            </InfoLabel>
            <NumberField value={s.bootstrapSamples ?? '200'} min={0} max={5000} step={50}
              onChange={v => patch({ bootstrapSamples: v, result: null })} className="w-full" />
          </InfluenceSource>
        </div>

        {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}

        <button onClick={run} disabled={loading}
          data-shortcut-primary data-shortcut-label="Analyze process capability"
          title="Analyze process capability (Ctrl/⌘+Enter)"
          className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium py-2 rounded transition-colors">
          <Play size={12} /> {loading ? 'Computing...' : 'Analyze'}
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        {!r ? (
          <div className="h-full flex items-center justify-center text-gray-400">
            <div className="text-center">
              <p className="text-lg font-medium">No results yet</p>
              <p className="text-sm mt-1">Enter measurements and specification limits, then Analyze</p>
            </div>
          </div>
        ) : (
          <div ref={resultsRef} className="p-6">
            <div className="flex justify-end mb-3">
              <ExportResultsButton getElement={() => resultsRef.current} baseName="process-capability" />
            </div>
            {/* Indices cards */}
            <InfluenceTarget influences="capability.stability" className="mb-4">
            <div className={`p-3 rounded-lg border text-xs ${r.decision_grade
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-800'}`}>
              <p className="font-semibold">
                {r.decision_grade ? 'Capability decision qualified' : 'Capability decision withheld'}
                {' '}— stability {r.stability.status.replace('_', ' ')}
              </p>
              <p className="mt-1">{r.decision_note}</p>
              {r.stability.signals.length > 0 && (
                <p className="mt-1">{r.stability.signals.length} control-chart signal(s) require investigation.</p>
              )}
            </div>
            </InfluenceTarget>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Capability Indices</h3>
            {r.normality_warning && r.normality_note && (
              <div className="mb-3 p-3 rounded-lg border bg-amber-50 border-amber-200 text-amber-800 text-xs leading-snug">
                {r.normality_note}
              </div>
            )}
            {r.non_normal && (
              <div className="mb-4 p-3 rounded-lg border bg-white border-gray-200">
                <h4 className="text-xs font-semibold text-gray-700 mb-2">
                  Non-Normal Capability — {r.non_normal.method}
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-2">
                  <Card label="Pp (percentile)" value={fmt(r.non_normal.Pp)}
                    tip="(USL − LSL) / (P99.865 − P0.135) using empirical quantiles" />
                  <Card label="Ppk (percentile)" value={fmt(r.non_normal.Ppk)} accent
                    tip="min of (USL − median)/(P99.865 − median) and (median − LSL)/(median − P0.135)" />
                  <Card label="Median" value={fmt(r.non_normal.median)} />
                  <Card label="P0.135 / P99.865" value={`${fmt(r.non_normal.p0135)} / ${fmt(r.non_normal.p99865)}`}
                    tip="Empirical quantiles replacing the normal ±3-sigma points" />
                </div>
                {r.non_normal.boxcox && (
                  <p className="text-[11px] text-gray-600">
                    Box-Cox suggestion: λ ≈ {fmt(r.non_normal.boxcox.lambda)} (use{' '}
                    <span className="font-mono">{r.non_normal.boxcox.transform}</span>).
                    {r.non_normal.boxcox.restores_normality
                      ? ' The transformed data pass the Shapiro-Wilk test — re-analyze on the transformed scale with transformed spec limits for normal-model indices.'
                      : ' The transformed data still fail normality — prefer the percentile indices above.'}
                  </p>
                )}
                {r.non_normal.note && (
                  <p className="text-[11px] text-gray-400 mt-1">{r.non_normal.note}</p>
                )}
                {r.non_normal.sensitivity && (
                  <InfluenceTarget influences="capability.bootstrap" className="mt-3 overflow-x-auto" rounded="rounded">
                    <p className="text-[11px] font-medium text-gray-700 mb-1">
                      Method sensitivity (Ppk range {fmt(r.non_normal.sensitivity.Ppk_min)}–{fmt(r.non_normal.sensitivity.Ppk_max)})
                    </p>
                    <table className="w-full text-[11px] border-collapse">
                      <thead><tr className="bg-gray-50">
                        <th className="text-left border border-gray-200 px-2 py-1">Method</th>
                        <th className="text-right border border-gray-200 px-2 py-1">Ppk</th>
                        <th className="text-right border border-gray-200 px-2 py-1">Bootstrap CI</th>
                      </tr></thead>
                      <tbody>{r.non_normal.sensitivity.methods.map(method => (
                        <tr key={method.id}>
                          <td className="border border-gray-200 px-2 py-1">{method.label}</td>
                          <td className="border border-gray-200 px-2 py-1 text-right font-mono">{fmt(method.Ppk)}</td>
                          <td className="border border-gray-200 px-2 py-1 text-right font-mono">
                            {method.Ppk_bootstrap_ci ? `[${fmt(method.Ppk_bootstrap_ci[0])}, ${fmt(method.Ppk_bootstrap_ci[1])}]` : '—'}
                          </td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </InfluenceTarget>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <InfluenceTarget influences={['capability.lsl', 'capability.usl']}><Card label="Cp" value={fmt(r.Cp)} tip="Potential capability (within sigma)" /></InfluenceTarget>
              <InfluenceTarget influences={['capability.lsl', 'capability.usl']}><Card label="Cpk" value={fmt(r.Cpk)} accent tip="Actual capability (within sigma)" /></InfluenceTarget>
              <InfluenceTarget influences={['capability.lsl', 'capability.usl']}><Card label={r.Pp_lower != null && r.Pp_upper != null ? `Pp  [${fmt(r.Pp_lower)}, ${fmt(r.Pp_upper)}]` : 'Pp'}
                value={fmt(r.Pp)}
                tip="Overall potential performance; the bracket is the exact chi-square 95% CI (overall sigma, df = n−1)." /></InfluenceTarget>
              <InfluenceTarget influences={['capability.lsl', 'capability.usl']}><Card label={r.Ppk_lower != null && r.Ppk_upper != null ? `Ppk  [${fmt(r.Ppk_lower)}, ${fmt(r.Ppk_upper)}]` : 'Ppk'}
                value={fmt(r.Ppk)}
                tip="Overall actual performance; the bracket is the Bissell 95% CI — narrow only with enough data." /></InfluenceTarget>
              <InfluenceTarget influences="capability.lsl"><Card label="Cpl" value={fmt(r.Cpl)} /></InfluenceTarget>
              <InfluenceTarget influences="capability.usl"><Card label="Cpu" value={fmt(r.Cpu)} /></InfluenceTarget>
              <InfluenceTarget influences="capability.target"><Card label="Cpm" value={fmt(r.Cpm)} tip="Taguchi index (uses target)" /></InfluenceTarget>
              <Card label="Z.bench" value={fmt(r.Z_bench)} tip="Benchmark sigma level (within)" />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <Card label="Mean" value={fmt(r.mean)} />
              <Card label="StdDev (within)" value={fmt(r.std_within)} />
              <Card label="StdDev (overall)" value={fmt(r.std_overall)} />
              <Card label="Normality p" value={fmt(r.normality.p_value)}
                tip={r.normality.normal ? 'Data appear normal (p >= 0.05)' : 'Data may not be normal (p < 0.05)'} />
            </div>

            {/* Histogram with spec lines + normal curve */}
            <div className="bg-white border border-gray-200 rounded-lg mb-6" style={{ height: 420 }}>
              <Plot
                data={[
                  {
                    x: r.histogram.bin_centers,
                    y: r.histogram.counts,
                    type: 'bar',
                    name: 'Observed',
                    marker: { color: '#93c5fd', line: { color: '#3b82f6', width: 1 } },
                  } as Plotly.Data,
                  {
                    ...(() => { const c = normalCurve(r, r.std_within); return { x: c.xs, y: c.ys } })(),
                    mode: 'lines', name: 'Normal (within)',
                    line: { color: '#1d4ed8', width: 2 },
                  } as Plotly.Data,
                ]}
                layout={{
                  title: { text: 'Process Capability Histogram', font: { size: 13 } },
                  bargap: 0.02,
                  xaxis: { title: { text: 'Value' }, gridcolor: '#e5e7eb' },
                  yaxis: { title: { text: 'Frequency' }, gridcolor: '#e5e7eb' },
                  margin: { t: 40, r: 20, b: 50, l: 60 },
                  paper_bgcolor: 'white', plot_bgcolor: 'white',
                  legend: { x: 0.02, y: 0.98, font: { size: 10 } },
                  shapes: [
                    ...(r.lsl != null ? [specLine(r.lsl, '#ef4444', undefined, active === 'capability.lsl')] : []),
                    ...(r.usl != null ? [specLine(r.usl, '#ef4444', undefined, active === 'capability.usl')] : []),
                    ...(r.target != null ? [specLine(r.target, '#10b981', 'dash', active === 'capability.target')] : []),
                  ],
                  annotations: [
                    ...(r.lsl != null ? [specAnno(r.lsl, 'LSL', '#ef4444', active === 'capability.lsl')] : []),
                    ...(r.usl != null ? [specAnno(r.usl, 'USL', '#ef4444', active === 'capability.usl')] : []),
                    ...(r.target != null ? [specAnno(r.target, 'Target', '#10b981', active === 'capability.target')] : []),
                  ],
                } as PlotlyLayout}
                config={{ responsive: true }}
                style={{ width: '100%', height: '100%' }}
                useResizeHandler
              />
            </div>

            {/* DPMO / ppm table */}
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Defect Rates (DPMO / PPM)</h3>
            <div className="overflow-x-auto rounded border border-gray-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-gray-600">
                    <th className="px-3 py-2 text-left font-medium">Source</th>
                    <th className="relative px-3 py-2 text-right font-medium"><InfluenceOverlay influences="capability.lsl" />Below LSL</th>
                    <th className="relative px-3 py-2 text-right font-medium"><InfluenceOverlay influences="capability.usl" />Above USL</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <Ppm label="Within (normal model)" d={r.ppm_within} />
                  <Ppm label="Overall (normal model)" d={r.ppm_overall} />
                  <Ppm label="Observed (empirical)" d={r.observed} />
                </tbody>
              </table>
            </div>

            {/* Interpretation panel */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-6">
              <p className="text-xs font-medium text-blue-800 mb-1">Interpretation</p>
              <ul className="text-xs text-blue-700 list-disc list-inside space-y-0.5">
                {r.Cpk != null && (
                  <li>
                    Cpk = {fmt(r.Cpk)} —{' '}
                    {r.Cpk < 1.0 ? 'the process is NOT capable. A significant portion of output will fall outside specification limits.' :
                     r.Cpk < 1.33 ? 'the process is marginally capable. It meets minimum requirements but has little safety margin.' :
                     r.Cpk < 1.67 ? 'the process is capable. It produces output well within specification limits.' :
                     'the process is highly capable (excellent). Very little output will be out of spec.'}
                  </li>
                )}
                {r.Cp != null && r.Cpk != null && (
                  <li>
                    {Math.abs(r.Cp - r.Cpk) < 0.1
                      ? 'Cp and Cpk are similar, indicating the process is well centered between the specification limits.'
                      : `Cp (${fmt(r.Cp)}) is notably higher than Cpk (${fmt(r.Cpk)}), indicating the process is off-center. Shifting the mean toward the target could improve capability.`}
                  </li>
                )}
                {r.ppm_within.total != null && (
                  <li>
                    The estimated defect rate is {r.ppm_within.total.toFixed(1)} PPM (parts per million),
                    meaning roughly {r.ppm_within.total < 1 ? 'fewer than 1 in a million' :
                      r.ppm_within.total < 100 ? `${r.ppm_within.total.toFixed(0)} in every million` :
                      r.ppm_within.total < 10000 ? `${(r.ppm_within.total / 1000).toFixed(1)} in every thousand` :
                      `${(r.ppm_within.total / 10000).toFixed(1)}% of`} units produced would be defective.
                  </li>
                )}
              </ul>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

function specLine(x: number, color: string, dash?: string, active = false) {
  return {
    type: 'line', x0: x, x1: x, yref: 'paper', y0: 0, y1: 1,
    line: { color, width: active ? 4 : 2, dash: dash ?? 'solid' },
  }
}
function specAnno(x: number, text: string, color: string, active = false) {
  return {
    x, yref: 'paper', y: 1, text, showarrow: false,
    font: { size: active ? 12 : 10, color, weight: active ? 700 : 400 }, yanchor: 'bottom',
  }
}

function fmt(v: number | null | undefined): string {
  if (v == null) return '--'
  if (Math.abs(v) >= 1000 || (v !== 0 && Math.abs(v) < 0.001)) return v.toExponential(2)
  return v.toFixed(3)
}

function Ppm({ label, d }: { label: string; d: { below_lsl: number | null; above_usl: number | null; total: number | null } }) {
  const f = (v: number | null) => v == null ? '--' : v.toFixed(1)
  return (
    <tr className="border-b border-gray-100 last:border-0">
      <td className="px-3 py-2 text-gray-800">{label}</td>
      <td className="relative px-3 py-2 text-right font-mono"><InfluenceOverlay influences="capability.lsl" />{f(d.below_lsl)}</td>
      <td className="relative px-3 py-2 text-right font-mono"><InfluenceOverlay influences="capability.usl" />{f(d.above_usl)}</td>
      <td className="px-3 py-2 text-right font-mono font-semibold">{f(d.total)}</td>
    </tr>
  )
}
