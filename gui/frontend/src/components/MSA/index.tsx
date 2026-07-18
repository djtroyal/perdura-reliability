import { useState, useRef } from 'react'
import Plot from '../shared/ExportablePlot'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlotlyLayout = any
import { Play } from 'lucide-react'
import InfoLabel from '../shared/InfoLabel'
import ExportResultsButton from '../shared/ExportResultsButton'
import ImportCsvButton from '../shared/ImportCsvButton'
import ExampleButton from '../shared/ExampleButton'
import { useModuleState } from '../../store/project'
import { gageRR, GageRRResponse } from '../../api/msa'
import { useHelpTopic } from '../help/context'

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

interface MSAState {
  rawText: string
  tolerance: string
  multiplier: string
  method: 'anova' | 'xbar_r' | 'reml'
  topology: 'crossed' | 'nested'
  result: GageRRResponse | null
}

const INITIAL_STATE: MSAState = {
  rawText: '',
  tolerance: '',
  multiplier: '6',
  method: 'anova',
  topology: 'crossed',
  result: null,
}

// Curated crossed Gage R&R study: 10 parts × 3 operators × 2 trials. Part-to-part
// variation dominates while operator bias + repeatability give a realistic,
// non-trivial %GRR — an instructive "acceptable-to-marginal" gauge.
const EXAMPLE_RAW = `Part\tOperator\tMeasurement
1\tA\t21.12\n1\tA\t20.58\n1\tB\t21.80\n1\tB\t21.88\n1\tC\t19.82\n1\tC\t20.08
2\tA\t24.55\n2\tA\t24.37\n2\tB\t24.99\n2\tB\t24.66\n2\tC\t24.45\n2\tC\t24.41
3\tA\t30.03\n3\tA\t30.45\n3\tB\t30.69\n3\tB\t30.16\n3\tC\t29.75\n3\tC\t29.22
4\tA\t27.85\n4\tA\t27.48\n4\tB\t27.93\n4\tB\t27.73\n4\tC\t27.59\n4\tC\t27.04
5\tA\t33.83\n5\tA\t33.86\n5\tB\t34.71\n5\tB\t34.65\n5\tC\t33.77\n5\tC\t33.77
6\tA\t40.36\n6\tA\t39.34\n6\tB\t39.80\n6\tB\t39.67\n6\tC\t39.35\n6\tC\t39.55
7\tA\t44.95\n7\tA\t44.66\n7\tB\t45.17\n7\tB\t45.76\n7\tC\t44.90\n7\tC\t44.82
8\tA\t31.23\n8\tA\t31.59\n8\tB\t32.05\n8\tB\t32.09\n8\tC\t31.45\n8\tC\t31.19
9\tA\t49.27\n9\tA\t49.03\n9\tB\t49.62\n9\tB\t49.75\n9\tC\t48.02\n9\tC\t48.47
10\tA\t36.81\n10\tA\t36.74\n10\tB\t37.39\n10\tB\t38.10\n10\tC\t36.25\n10\tC\t36.99`

const EXAMPLE_STATE: Partial<MSAState> = { rawText: EXAMPLE_RAW, tolerance: '30' }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseRawText(text: string): {
  parts: string[]
  operators: string[]
  measurements: number[]
  error: string | null
} {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim())
  if (lines.length === 0) return { parts: [], operators: [], measurements: [], error: 'No data.' }

  const sep = lines[0].includes('\t') ? /\t/ : /[,;]/
  const firstCols = lines[0].split(sep).map(c => c.trim().toLowerCase())
  const hasHeader = firstCols.some(c =>
    /part|operator|measurement|meas|appraiser/i.test(c)
  )
  const dataLines = hasHeader ? lines.slice(1) : lines

  const partIdx = hasHeader
    ? firstCols.findIndex(c => /part/i.test(c))
    : 0
  const opIdx = hasHeader
    ? firstCols.findIndex(c => /operator|appraiser/i.test(c))
    : 1
  const measIdx = hasHeader
    ? firstCols.findIndex(c => /meas/i.test(c))
    : 2

  const parts: string[] = []
  const operators: string[] = []
  const measurements: number[] = []

  for (const line of dataLines) {
    const cells = line.split(sep).map(c => c.trim())
    if (cells.length < 3) continue
    const m = parseFloat(cells[measIdx >= 0 ? measIdx : 2])
    if (isNaN(m)) continue
    parts.push(cells[partIdx >= 0 ? partIdx : 0])
    operators.push(cells[opIdx >= 0 ? opIdx : 1])
    measurements.push(m)
  }

  if (parts.length === 0) {
    return { parts: [], operators: [], measurements: [], error: 'Could not parse any rows. Ensure three columns: Part, Operator, Measurement.' }
  }
  return { parts, operators, measurements, error: null }
}

const fmt = (v: number | null | undefined, d = 4): string => {
  if (v == null) return '—'
  if (Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-4 && v !== 0)) return v.toExponential(3)
  return v.toFixed(d)
}

const fmtPct = (v: number | null | undefined): string => {
  if (v == null) return '—'
  return v.toFixed(2) + '%'
}

const fmtP = (v: number | null | undefined): string => {
  if (v == null) return '—'
  if (v < 0.0001) return '<0.0001'
  return v.toFixed(4)
}

// ---------------------------------------------------------------------------
// Verdict helper
// ---------------------------------------------------------------------------

function GrrVerdict({ pct }: { pct: number | null | undefined }) {
  if (pct == null) return null
  let color = 'text-green-700 bg-green-50 border-green-200'
  let label = 'Acceptable (< 10%)'
  if (pct >= 10 && pct < 30) {
    color = 'text-yellow-700 bg-yellow-50 border-yellow-200'
    label = 'Marginal (10–30%)'
  } else if (pct >= 30) {
    color = 'text-red-700 bg-red-50 border-red-200'
    label = 'Unacceptable (≥ 30%)'
  }
  return (
    <div className={`rounded border px-3 py-2 text-sm font-semibold ${color}`}>
      GRR %StudyVar: {fmtPct(pct)} — {label}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Variance Components table
// ---------------------------------------------------------------------------

function VarCompTable({ comps, hasTol }: {
  comps: GageRRResponse['variance_components']
  hasTol: boolean
}) {
  const ORDER = ['GRR', 'Repeatability', 'Reproducibility', 'Operator', 'Interaction', 'Part-to-Part', 'Total']
  const rows = ORDER.map(k => ({ key: k, ...comps[k] })).filter(r => r.variance != null || r.stdev != null)
  const indented = new Set(['Repeatability', 'Reproducibility', 'Operator', 'Interaction'])

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-50 text-gray-600">
            <th className="text-left px-2 py-1 border border-gray-200 font-medium">Component</th>
            <th className="text-right px-2 py-1 border border-gray-200 font-medium">VarComp</th>
            <th className="text-right px-2 py-1 border border-gray-200 font-medium">%Contrib</th>
            <th className="text-right px-2 py-1 border border-gray-200 font-medium">StdDev</th>
            <th className="text-right px-2 py-1 border border-gray-200 font-medium">Variance CI</th>
            <th className="text-right px-2 py-1 border border-gray-200 font-medium">StudyVar</th>
            <th className="text-right px-2 py-1 border border-gray-200 font-medium">%StudyVar</th>
            {hasTol && <th className="text-right px-2 py-1 border border-gray-200 font-medium">%Tolerance</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key} className="hover:bg-gray-50">
              <td className={`px-2 py-1 border border-gray-200 font-medium ${indented.has(r.key) ? 'pl-5 text-gray-600' : 'text-gray-800'}`}>
                {r.key}
              </td>
              <td className="text-right px-2 py-1 border border-gray-200 font-mono">{fmt(r.variance, 6)}</td>
              <td className="text-right px-2 py-1 border border-gray-200 font-mono">{fmtPct(r.pct_contribution)}</td>
              <td className="text-right px-2 py-1 border border-gray-200 font-mono">{fmt(r.stdev, 5)}</td>
              <td className="text-right px-2 py-1 border border-gray-200 font-mono">
                {r.variance_ci ? `[${fmt(r.variance_ci[0], 5)}, ${fmt(r.variance_ci[1], 5)}]` : '—'}
              </td>
              <td className="text-right px-2 py-1 border border-gray-200 font-mono">{fmt(r.study_var, 5)}</td>
              <td className="text-right px-2 py-1 border border-gray-200 font-mono">{fmtPct(r.pct_study_var)}</td>
              {hasTol && (
                <td className="text-right px-2 py-1 border border-gray-200 font-mono">{fmtPct(r.pct_tolerance)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ANOVA Table
// ---------------------------------------------------------------------------

function AnovaTable({ rows }: { rows: { source: string; SS: number | null; df: number | null; MS: number | null; F: number | null; p: number | null }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-50 text-gray-600">
            <th className="text-left px-2 py-1 border border-gray-200 font-medium">Source</th>
            <th className="text-right px-2 py-1 border border-gray-200 font-medium">SS</th>
            <th className="text-right px-2 py-1 border border-gray-200 font-medium">df</th>
            <th className="text-right px-2 py-1 border border-gray-200 font-medium">MS</th>
            <th className="text-right px-2 py-1 border border-gray-200 font-medium">F</th>
            <th className="text-right px-2 py-1 border border-gray-200 font-medium">p</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={`hover:bg-gray-50 ${r.source === 'Total' ? 'font-semibold bg-gray-50' : ''}`}>
              <td className="px-2 py-1 border border-gray-200">{r.source}</td>
              <td className="text-right px-2 py-1 border border-gray-200 font-mono">{fmt(r.SS)}</td>
              <td className="text-right px-2 py-1 border border-gray-200 font-mono">{r.df ?? '—'}</td>
              <td className="text-right px-2 py-1 border border-gray-200 font-mono">{fmt(r.MS)}</td>
              <td className="text-right px-2 py-1 border border-gray-200 font-mono">{fmt(r.F)}</td>
              <td className="text-right px-2 py-1 border border-gray-200 font-mono">{fmtP(r.p)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Plot helpers
// ---------------------------------------------------------------------------

const COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6']

const PLOT_LAYOUT_BASE: PlotlyLayout = {
  paper_bgcolor: 'white',
  plot_bgcolor: 'white',
  margin: { t: 30, r: 10, b: 50, l: 60 },
  font: { size: 11 },
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function MSA() {
  const [state, setState] = useModuleState<MSAState>('msa', INITIAL_STATE)
  useHelpTopic(`sixSigma.msa_${state.method}`, 10)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const setField = <K extends keyof MSAState>(k: K, v: MSAState[K]) =>
    setState(s => ({ ...s, [k]: v }))

  const run = async () => {
    const { parts, operators, measurements, error: parseErr } = parseRawText(state.rawText)
    if (parseErr) { setError(parseErr); return }

    const tol = state.tolerance.trim() ? parseFloat(state.tolerance) : undefined
    const mult = parseFloat(state.multiplier) || 6.0

    setError(null)
    setLoading(true)
    try {
      const res = await gageRR({
        parts,
        operators,
        measurements,
        tolerance: tol,
        study_var_multiplier: mult,
        method: state.method,
        topology: state.topology ?? 'crossed',
      })
      setField('result', res)
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Analysis failed.')
    } finally {
      setLoading(false)
    }
  }

  const result = state.result
  const comps = result?.variance_components ?? {}
  const hasTol = !!(result && comps['GRR']?.pct_tolerance != null)
  const grr = comps['GRR']

  // ------------------------------------------------------------------
  // Build Plotly traces
  // ------------------------------------------------------------------

  // 1) Components of Variation bar chart
  const compVarTraces = (() => {
    if (!result) return []
    const compKeys = ['GRR', 'Repeatability', 'Reproducibility', 'Part-to-Part']
    const labels = compKeys.filter(k => comps[k])

    const metrics: { name: string; values: (number | null)[] }[] = [
      { name: '%Contribution', values: labels.map(k => comps[k]?.pct_contribution ?? null) },
      { name: '%StudyVar', values: labels.map(k => comps[k]?.pct_study_var ?? null) },
    ]
    if (hasTol) {
      metrics.push({ name: '%Tolerance', values: labels.map(k => comps[k]?.pct_tolerance ?? null) })
    }

    return metrics.map((m, i) => ({
      type: 'bar',
      name: m.name,
      x: labels,
      y: m.values,
      marker: { color: COLORS[i] },
    }))
  })()

  // 2) Measurement by Part (box per part, all operators combined)
  const measByPartTraces = (() => {
    if (!result) return []
    const { per_cell_means, unique_parts } = result
    const byPart: Record<string, number[]> = {}
    for (const p of unique_parts) byPart[p] = []
    for (const cell of Object.values(per_cell_means)) {
      if (byPart[cell.part]) byPart[cell.part].push(...cell.measurements)
    }
    return unique_parts.map((p, i) => ({
      type: 'box',
      name: String(p),
      y: byPart[p],
      marker: { color: COLORS[i % COLORS.length] },
      boxpoints: 'all',
      jitter: 0.3,
      pointpos: 0,
    }))
  })()

  // 3) Measurement by Operator (box per operator, all parts combined)
  const measByOpTraces = (() => {
    if (!result) return []
    const { per_cell_means, unique_operators } = result
    const byOp: Record<string, number[]> = {}
    for (const o of unique_operators) byOp[o] = []
    for (const cell of Object.values(per_cell_means)) {
      if (byOp[cell.operator]) byOp[cell.operator].push(...cell.measurements)
    }
    return unique_operators.map((o, i) => ({
      type: 'box',
      name: String(o),
      y: byOp[o],
      marker: { color: COLORS[i % COLORS.length] },
      boxpoints: 'all',
      jitter: 0.3,
      pointpos: 0,
    }))
  })()

  // 4) Part × Operator interaction (mean by part, one line per operator)
  const interactionTraces = (() => {
    if (!result) return []
    const { per_cell_means, unique_parts, unique_operators } = result
    return unique_operators.map((o, i) => {
      const ys = unique_parts.map(p => {
        const key = `${p}|${o}`
        return per_cell_means[key]?.mean ?? null
      })
      return {
        type: 'scatter',
        mode: 'lines+markers',
        name: String(o),
        x: unique_parts.map(String),
        y: ys,
        line: { color: COLORS[i % COLORS.length], width: 2 },
        marker: { color: COLORS[i % COLORS.length], size: 6 },
      }
    })
  })()

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <div className="flex h-full">
      {/* -------- Left sidebar -------- */}
      <div className="w-80 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-4 flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-800 mb-1">Gage R&amp;R (MSA)</h2>
          <p className="text-[10px] text-gray-500 leading-relaxed">
            Crossed study: paste data with three columns — Part, Operator, Measurement. First row may be a header.
            Supports tab, comma, or semicolon delimiters.
          </p>
        </div>

        {/* Data entry */}
        <div>
          <div className="flex items-center justify-between">
            <InfoLabel tip="Paste a table with columns Part, Operator, Measurement. Headers auto-detected. Supports tab/comma/semicolon separators.">
              Data (Part / Operator / Measurement)
            </InfoLabel>
            <div className="flex items-center gap-2">
              <ExampleButton hasData={state.rawText.trim().length > 0}
                onLoad={() => setState(prev => ({ ...prev, ...EXAMPLE_STATE, result: null }))} />
              <ImportCsvButton onImport={r => setField('rawText', r.text)} title="Load Part/Operator/Measurement data from a CSV/TSV file" />
            </div>
          </div>
          <textarea
            className="w-full h-48 text-xs font-mono border border-gray-300 rounded px-2 py-1.5 resize-y focus:outline-none focus:ring-1 focus:ring-blue-400"
            value={state.rawText}
            onChange={e => setField('rawText', e.target.value)}
            spellCheck={false}
            placeholder={'Part\tOperator\tMeasurement\n1\tA\t0.29\n1\tA\t0.41\n...'}
          />
        </div>

        {/* Tolerance */}
        <div>
          <InfoLabel tip="Process tolerance (USL − LSL). If provided, %Tolerance column is computed. Leave blank to omit.">
            Tolerance (USL − LSL) — optional
          </InfoLabel>
          <input
            type="text"
            className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
            value={state.tolerance}
            onChange={e => setField('tolerance', e.target.value)}
            placeholder="e.g. 0.1"
          />
        </div>

        {/* Study var multiplier */}
        <div>
          <InfoLabel tip="Number of standard deviations for the Study Variation window. AIAG standard is 6 (±3σ covers 99.73%); some organisations use 5.15.">
            Study Var Multiplier
          </InfoLabel>
          <input
            type="text"
            className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
            value={state.multiplier}
            onChange={e => setField('multiplier', e.target.value)}
            placeholder="6"
          />
        </div>

        {/* Method */}
        <div>
          <InfoLabel tip="ANOVA and Xbar-R require a complete balanced crossed design. REML supports unequal replication, incomplete crossed cells, and nested studies while reporting convergence and component intervals.">
            Method
          </InfoLabel>
          <select
            className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
            value={state.method}
            onChange={e => setField('method', e.target.value as MSAState['method'])}
          >
            <option value="anova">ANOVA</option>
            <option value="xbar_r">Average &amp; Range (Xbar-R)</option>
            <option value="reml">REML variance components</option>
          </select>
        </div>

        <div>
          <InfoLabel tip="Crossed: the same parts are measured by multiple operators. Nested: each operator measures a different set of parts (parts nested within operator).">
            Study topology
          </InfoLabel>
          <select
            className="w-full text-xs border border-gray-300 rounded px-2 py-1.5"
            value={state.topology ?? 'crossed'}
            onChange={e => setField('topology', e.target.value as MSAState['topology'])}
          >
            <option value="crossed">Crossed</option>
            <option value="nested">Nested (parts within operator)</option>
          </select>
          {state.topology === 'nested' && state.method !== 'reml' && (
            <p className="text-[10px] text-amber-700 mt-1">Nested studies require REML.</p>
          )}
        </div>

        {/* Run button */}
        <button
          onClick={run}
          disabled={loading}
          className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2 rounded transition-colors"
        >
          <Play size={14} />
          {loading ? 'Analyzing…' : 'Run Gage R&R'}
        </button>

        {error && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">
            {error}
          </div>
        )}

        {/* Summary snippet */}
        {result && (
          <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded p-3 flex flex-col gap-1">
            <div className="flex justify-between">
              <span className="text-gray-500">Method</span>
              <span className="font-mono font-medium">{result.method}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Parts</span>
              <span className="font-mono font-medium">{result.n_parts}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Operators</span>
              <span className="font-mono font-medium">{result.n_operators}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Replicates</span>
              <span className="font-mono font-medium">{result.n_replicates ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">NDC</span>
              <span className="font-mono font-medium">{result.ndc}</span>
            </div>
            {result.pooled != null && (
              <div className="flex justify-between">
                <span className="text-gray-500">Interaction pooled</span>
                <span className="font-mono font-medium">{result.pooled ? 'Yes' : 'No'}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* -------- Main content -------- */}
      <div className="flex-1 overflow-auto p-4 flex flex-col gap-6">
        {!result && (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            Paste your data on the left and click Run Gage R&amp;R.
          </div>
        )}

        {result && (
          <div ref={resultsRef}>
            <div className="flex justify-end mb-3">
              <ExportResultsButton getElement={() => resultsRef.current} baseName="msa" />
            </div>
            {/* Assessment */}
            {result.design_diagnostics && (
              <div className={`mb-3 rounded border p-3 text-xs ${result.result_quality === 'validated_design'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
                <p className="font-semibold">
                  {result.design_diagnostics.topology} design — {result.result_quality?.replace(/_/g, ' ')}
                </p>
                <p className="mt-1">
                  {result.design_diagnostics.complete ? 'Complete' : `${result.design_diagnostics.missing_cells.length} missing cell(s)`};{' '}
                  {result.design_diagnostics.balanced ? 'balanced' : 'unbalanced'}; replicates {result.design_diagnostics.replicates_min}–{result.design_diagnostics.replicates_max}.
                </p>
                {result.optimizer && <p className="mt-1">REML optimizer: {result.optimizer.success ? 'converged' : 'not converged'} ({result.optimizer.successful_starts}/{result.optimizer.total_starts} starts).</p>}
                {!!result.boundary_components?.length && <p className="mt-1">Boundary components: {result.boundary_components.join(', ')}.</p>}
                {!!result.truncation_diagnostics?.length && <p className="mt-1">Negative method-of-moments estimates were truncated: {result.truncation_diagnostics.map(d => d.component).join(', ')}.</p>}
              </div>
            )}
            <GrrVerdict pct={grr?.pct_study_var} />

            <div className="grid grid-cols-3 gap-3">
              <div className="bg-blue-50 border border-blue-200 rounded p-3 text-center">
                <p className="text-[10px] text-blue-500 uppercase tracking-wide">GRR %StudyVar</p>
                <p className="text-xl font-bold text-blue-700 mt-1">{fmtPct(grr?.pct_study_var)}</p>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded p-3 text-center">
                <p className="text-[10px] text-gray-500 uppercase tracking-wide">%Contribution</p>
                <p className="text-xl font-bold text-gray-700 mt-1">{fmtPct(grr?.pct_contribution)}</p>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded p-3 text-center">
                <p className="text-[10px] text-gray-500 uppercase tracking-wide">NDC</p>
                <p className="text-xl font-bold text-gray-700 mt-1">{result.ndc}</p>
              </div>
            </div>

            {/* Variance components table */}
            <section>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Variance Components</h3>
              <VarCompTable comps={comps} hasTol={hasTol} />
            </section>

            {/* ANOVA table (method=anova only) */}
            {result.anova_table && result.anova_table.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">
                  ANOVA Table
                  {result.pooled && (
                    <span className="ml-2 text-[10px] font-normal text-yellow-600 bg-yellow-50 border border-yellow-200 rounded px-1.5 py-0.5">
                      Interaction pooled (p &gt; {result.alpha_pool})
                    </span>
                  )}
                </h3>
                <AnovaTable rows={result.anova_table} />
              </section>
            )}

            {/* Plots grid */}
            <section>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Gage R&amp;R Plots</h3>
              <div className="grid grid-cols-2 gap-4">

                {/* Components of Variation */}
                <div className="bg-white border border-gray-200 rounded p-2">
                  <p className="text-xs text-gray-500 mb-1 font-medium">Components of Variation</p>
                  <Plot
                    data={compVarTraces as PlotlyLayout}
                    layout={{
                      ...PLOT_LAYOUT_BASE,
                      barmode: 'group',
                      xaxis: { gridcolor: '#e5e7eb' },
                      yaxis: { title: { text: '%' }, gridcolor: '#e5e7eb' },
                      legend: { x: 0, y: 1.15, orientation: 'h' },
                      height: 260,
                    }}
                    config={{ displayModeBar: false, responsive: true }}
                    style={{ width: '100%' }}
                  />
                </div>

                {/* Part × Operator Interaction */}
                <div className="bg-white border border-gray-200 rounded p-2">
                  <p className="text-xs text-gray-500 mb-1 font-medium">Part × Operator Interaction</p>
                  <Plot
                    data={interactionTraces as PlotlyLayout}
                    layout={{
                      ...PLOT_LAYOUT_BASE,
                      xaxis: { title: { text: 'Part' }, gridcolor: '#e5e7eb' },
                      yaxis: { title: { text: 'Mean Measurement' }, gridcolor: '#e5e7eb' },
                      legend: { x: 1, y: 0.5, xanchor: 'left' },
                      height: 260,
                    }}
                    config={{ displayModeBar: false, responsive: true }}
                    style={{ width: '100%' }}
                  />
                </div>

                {/* Measurement by Part */}
                <div className="bg-white border border-gray-200 rounded p-2">
                  <p className="text-xs text-gray-500 mb-1 font-medium">Measurement by Part</p>
                  <Plot
                    data={measByPartTraces as PlotlyLayout}
                    layout={{
                      ...PLOT_LAYOUT_BASE,
                      xaxis: { title: { text: 'Part' }, gridcolor: '#e5e7eb' },
                      yaxis: { title: { text: 'Measurement' }, gridcolor: '#e5e7eb' },
                      showlegend: false,
                      height: 260,
                    }}
                    config={{ displayModeBar: false, responsive: true }}
                    style={{ width: '100%' }}
                  />
                </div>

                {/* Measurement by Operator */}
                <div className="bg-white border border-gray-200 rounded p-2">
                  <p className="text-xs text-gray-500 mb-1 font-medium">Measurement by Operator</p>
                  <Plot
                    data={measByOpTraces as PlotlyLayout}
                    layout={{
                      ...PLOT_LAYOUT_BASE,
                      xaxis: { title: { text: 'Operator' }, gridcolor: '#e5e7eb' },
                      yaxis: { title: { text: 'Measurement' }, gridcolor: '#e5e7eb' },
                      showlegend: false,
                      height: 260,
                    }}
                    config={{ displayModeBar: false, responsive: true }}
                    style={{ width: '100%' }}
                  />
                </div>

              </div>
            </section>

            {/* Xbar-R specifics */}
            {result.method === 'Xbar-R' && (
              <section>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Average &amp; Range Constants</h3>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  {[
                    ['R̄ (avg range)', fmt(result.R_bar)],
                    ['Rp (parts range)', fmt(result.Rp)],
                    ['X̄ diff (operators)', fmt(result.Xbar_diff)],
                    ['K1', fmt(result.K1)],
                    ['K2', fmt(result.K2)],
                    ['K3', fmt(result.K3)],
                  ].map(([label, val]) => (
                    <div key={label} className="bg-gray-50 border border-gray-200 rounded p-2">
                      <p className="text-gray-500">{label}</p>
                      <p className="font-mono font-semibold">{val}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
