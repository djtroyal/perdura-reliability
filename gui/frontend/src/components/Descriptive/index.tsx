import { useState, useRef } from 'react'
import Plot from 'react-plotly.js'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlotlyLayout = any
import { Play, Upload } from 'lucide-react'
import InfoLabel from '../shared/InfoLabel'
import ExportResultsButton from '../shared/ExportResultsButton'
import { useModuleState } from '../../store/project'
import ModelDataGrid, { GridRow } from '../DataModeling/ModelDataGrid'
import { useSharedDataset, numericColumns } from '../DataAnalysis/shared'
import {
  getSummaryStatistics,
  getFrequencyTable,
  getRunChart,
  getBoxplot,
  getHistogram,
  getContingencyTable,
  SummaryResponse,
  FrequencyResponse,
  RunChartResponse,
  BoxplotResponse,
  HistogramResponse,
  ContingencyResponse,
} from '../../api/descriptive'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabId = 'summary' | 'histogram' | 'boxplot' | 'runchart' | 'frequency' | 'contingency'

interface DescriptiveState {
  histBins: string
  freqBins: string
  freqColIdx: string
  ctRowColIdx: string
  ctColColIdx: string
  activeTab: TabId
}

const INITIAL_STATE: DescriptiveState = {
  histBins: '',
  freqBins: '',
  freqColIdx: '0',
  ctRowColIdx: '0',
  ctColColIdx: '1',
  activeTab: 'summary',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TABS: { id: TabId; label: string }[] = [
  { id: 'summary', label: 'Summary' },
  { id: 'histogram', label: 'Histogram' },
  { id: 'boxplot', label: 'Boxplot' },
  { id: 'runchart', label: 'Run Chart' },
  { id: 'frequency', label: 'Frequency' },
  { id: 'contingency', label: 'Contingency' },
]

const PLOT_LAYOUT_BASE: PlotlyLayout = {
  paper_bgcolor: 'white',
  plot_bgcolor: 'white',
  margin: { t: 30, r: 20, b: 50, l: 60 },
  font: { size: 11 },
}

const GRID_COLOR = '#e5e7eb'

/** Build a plain-English interpretation of a column's summary statistics. */
function summaryInterpretation(st: import('../../api/descriptive').ColumnStats): string[] {
  const notes: string[] = []
  const { mean, median, std, skewness, kurtosis, coefficient_of_variation: cv, normality } = st
  // Central tendency / skew from mean-vs-median and the skewness coefficient.
  if (skewness != null) {
    const dir = skewness > 0 ? 'right (a long upper tail)' : 'left (a long lower tail)'
    if (Math.abs(skewness) < 0.5) notes.push('The distribution is approximately symmetric.')
    else if (Math.abs(skewness) < 1) notes.push(`The distribution is moderately skewed to the ${dir}.`)
    else notes.push(`The distribution is strongly skewed to the ${dir}; the median is a more robust center than the mean.`)
  } else if (mean != null && median != null && std) {
    if (Math.abs(mean - median) > 0.5 * std) notes.push('Mean and median differ noticeably, suggesting skew or outliers.')
  }
  // Spread.
  if (cv != null && Number.isFinite(cv)) {
    const cvPct = Math.abs(cv) * 100
    if (cvPct < 15) notes.push(`Low relative variability (CV ≈ ${cvPct.toFixed(0)}%): values cluster tightly around the mean.`)
    else if (cvPct > 50) notes.push(`High relative variability (CV ≈ ${cvPct.toFixed(0)}%): values are widely dispersed.`)
  }
  // Tails.
  if (kurtosis != null) {
    if (kurtosis > 1) notes.push('Heavy tails / sharp peak (excess kurtosis > 1): outliers are more likely than under a normal model.')
    else if (kurtosis < -1) notes.push('Light tails / flat shape (excess kurtosis < −1).')
  }
  // Normality.
  if (normality && normality.p != null) {
    notes.push(normality.p < 0.05
      ? `The ${normality.test} test rejects normality (p = ${normality.p.toExponential(2)}); prefer non-parametric or robust methods.`
      : `The ${normality.test} test does not reject normality (p = ${normality.p.toFixed(3)}); a normal model is reasonable.`)
  }
  if (notes.length === 0) notes.push('No notable departures from a typical, symmetric spread were detected.')
  return notes
}

const fmt = (v: number | null | undefined): string =>
  v == null ? '—'
    : Math.abs(v) === 0 ? '0'
    : (Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0))
      ? v.toExponential(4)
      : v.toFixed(4)

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatRow({ label, value, tip }: { label: string; value: string; tip?: string }) {
  return (
    <div className="flex justify-between border-b border-gray-100 last:border-0 py-0.5">
      <span className="text-gray-500 flex items-center gap-1">
        {label}
        {tip && (
          <span className="text-[10px] text-gray-400 cursor-help" title={tip}>[?]</span>
        )}
      </span>
      <span className="text-gray-800 font-semibold font-mono">{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Descriptive() {
  const [state, setState] = useModuleState<DescriptiveState>('descriptive', INITIAL_STATE)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  // Results
  const [summaryRes, setSummaryRes] = useState<SummaryResponse | null>(null)
  const [histRes, setHistRes] = useState<HistogramResponse | null>(null)
  const [boxRes, setBoxRes] = useState<BoxplotResponse | null>(null)
  const [runRes, setRunRes] = useState<RunChartResponse | null>(null)
  const [freqRes, setFreqRes] = useState<FrequencyResponse | null>(null)
  const [ctRes, setCtRes] = useState<ContingencyResponse | null>(null)

  const [data, setData] = useSharedDataset()
  const fileRef = useRef<HTMLInputElement>(null)

  const patch = (p: Partial<DescriptiveState>) => setState(s => ({ ...s, ...p }))

  const { headers, columns } = numericColumns(data)
  const hasData = headers.length > 0 && Object.values(columns).some(c => c.length > 0)

  const clearResults = () => {
    setSummaryRes(null); setHistRes(null); setBoxRes(null)
    setRunRes(null); setFreqRes(null); setCtRes(null)
  }

  const importCSV = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result).replace(/\r/g, '').trim()
      const lines = text.split('\n').filter(l => l.trim() !== '')
      if (lines.length < 2) { setError('CSV needs a header row and at least one data row.'); return }
      const sep = lines[0].includes('\t') ? '\t' : ','
      const cols = lines[0].split(sep).map(c => c.trim()).filter(c => c !== '')
      const rows: GridRow[] = lines.slice(1).map(line => {
        const cells = line.split(sep)
        return Object.fromEntries(cols.map((c, i) => [c, (cells[i] ?? '').trim()]))
      })
      setData({ columns: cols, rows })
      clearResults(); setError(null)
    }
    reader.readAsText(file)
  }

  // ---------------------------------------------------------------------------
  // Run analysis
  // ---------------------------------------------------------------------------

  const run = async () => {
    if (!hasData) { setError('Paste data with a header row first.'); return }
    setError(null)
    setLoading(true)
    try {
      const tab = state.activeTab
      if (tab === 'summary') {
        const res = await getSummaryStatistics({ columns })
        setSummaryRes(res)
      } else if (tab === 'histogram') {
        const col = headers[0]
        const vals = columns[col] ?? []
        const bins = state.histBins ? parseInt(state.histBins, 10) : undefined
        const res = await getHistogram({ values: vals, bins })
        setHistRes(res)
      } else if (tab === 'boxplot') {
        const col = headers[0]
        const vals = columns[col] ?? []
        const res = await getBoxplot({ values: vals })
        setBoxRes(res)
      } else if (tab === 'runchart') {
        const col = headers[0]
        const vals = columns[col] ?? []
        const res = await getRunChart({ values: vals })
        setRunRes(res)
      } else if (tab === 'frequency') {
        const idx = Math.max(0, Math.min(headers.length - 1, parseInt(state.freqColIdx, 10) || 0))
        const col = headers[idx]
        const vals = columns[col] ?? []
        const bins = state.freqBins ? parseInt(state.freqBins, 10) : undefined
        const res = await getFrequencyTable({ values: vals, bins })
        setFreqRes(res)
      } else if (tab === 'contingency') {
        const ri = Math.max(0, Math.min(headers.length - 1, parseInt(state.ctRowColIdx, 10) || 0))
        const ci = Math.max(0, Math.min(headers.length - 1, parseInt(state.ctColColIdx, 10) || 1))
        if (ri === ci) { setError('Row and column must be different.'); setLoading(false); return }
        const rowCol = headers[ri]
        const colCol = headers[ci]
        const rowVals = columns[rowCol] ?? []
        const colVals = columns[colCol] ?? []
        if (rowVals.length !== colVals.length) {
          setError('Row and column must have the same number of valid values.')
          setLoading(false); return
        }
        const res = await getContingencyTable({
          row_values: rowVals,
          col_values: colVals,
        })
        setCtRes(res)
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err.response?.data?.detail ?? 'An error occurred.')
    } finally {
      setLoading(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Plot data builders
  // ---------------------------------------------------------------------------

  const histPlotData = (() => {
    if (!histRes) return []
    const edges = histRes.bin_edges
    const counts = histRes.counts
    const x = edges.slice(0, -1).map((e, i) => (e + edges[i + 1]) / 2)
    return [{
      type: 'bar' as const,
      x,
      y: counts,
      width: edges.slice(0, -1).map((e, i) => edges[i + 1] - e),
      marker: { color: '#3b82f6', line: { color: '#fff', width: 1 } },
      name: 'Count',
    }]
  })()

  const histLayout: PlotlyLayout = {
    ...PLOT_LAYOUT_BASE,
    xaxis: { title: { text: headers[0] ?? 'Value' }, gridcolor: GRID_COLOR },
    yaxis: { title: { text: 'Count' }, gridcolor: GRID_COLOR },
  }

  const boxPlotData = (() => {
    if (!boxRes) return []
    return [{
      type: 'box' as const,
      q1: [boxRes.Q1],
      median: [boxRes.median],
      q3: [boxRes.Q3],
      lowerfence: [boxRes.whisker_low],
      upperfence: [boxRes.whisker_high],
      mean: [boxRes.median],
      y: [...[boxRes.min, boxRes.Q1, boxRes.median, boxRes.Q3, boxRes.max], ...boxRes.outliers],
      boxpoints: false as const,
      marker: { color: '#3b82f6' },
      name: headers[0] ?? 'Value',
    }]
  })()

  const boxLayout: PlotlyLayout = {
    ...PLOT_LAYOUT_BASE,
    yaxis: { title: { text: headers[0] ?? 'Value' }, gridcolor: GRID_COLOR },
  }

  const runPlotData = (() => {
    if (!runRes) return []
    const x = Array.from({ length: runRes.sequence.length }, (_, i) => i + 1)
    return [
      {
        x,
        y: runRes.sequence,
        mode: 'lines+markers' as const,
        name: 'Value',
        line: { color: '#3b82f6', width: 1.5 },
        marker: { size: 5, color: '#3b82f6' },
      },
      {
        x: [1, runRes.sequence.length],
        y: [runRes.median, runRes.median],
        mode: 'lines' as const,
        name: 'Median',
        line: { color: '#ef4444', dash: 'dash' as const, width: 1.5 },
      },
    ]
  })()

  const runLayout: PlotlyLayout = {
    ...PLOT_LAYOUT_BASE,
    xaxis: { title: { text: 'Observation' }, gridcolor: GRID_COLOR },
    yaxis: { title: { text: headers[0] ?? 'Value' }, gridcolor: GRID_COLOR },
    showlegend: true,
  }

  const freqPlotData = (() => {
    if (!freqRes) return []
    const labels = freqRes.labels ?? freqRes.bin_labels ?? []
    return [{
      type: 'bar' as const,
      x: labels,
      y: freqRes.counts,
      marker: { color: '#3b82f6' },
      name: 'Count',
    }]
  })()

  const freqLayout: PlotlyLayout = {
    ...PLOT_LAYOUT_BASE,
    xaxis: { title: { text: 'Value' }, gridcolor: GRID_COLOR },
    yaxis: { title: { text: 'Count' }, gridcolor: GRID_COLOR },
  }

  // ---------------------------------------------------------------------------
  // Left panel sections
  // ---------------------------------------------------------------------------

  const leftPanel = (
    <div className="w-80 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-4 flex flex-col gap-4">
      <div>
        <div className="flex items-center justify-between mb-1">
          <InfoLabel tip="Each column is a variable; rows are observations. Edit headers, paste from a spreadsheet, or import a CSV. This dataset is shared with the Regression & ML tab.">
            Dataset
          </InfoLabel>
          <div className="flex items-center gap-1">
            <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) importCSV(f); e.target.value = '' }} />
            <button onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 border border-gray-300 rounded hover:bg-gray-50">
              <Upload size={10} /> CSV
            </button>
          </div>
        </div>
        <ModelDataGrid columns={data.columns} rows={data.rows}
          onColumnsChange={(cols, rows) => { setData({ columns: cols, rows }); clearResults() }}
          onRowsChange={rows => { setData({ columns: data.columns, rows }); clearResults() }} />
        {hasData && (
          <p className="text-[10px] text-gray-400 mt-0.5">
            {headers.length} column{headers.length !== 1 ? 's' : ''}: {headers.join(', ')} &mdash; {Object.values(columns)[0]?.length ?? 0} numeric rows
          </p>
        )}
      </div>

      {/* Tab-specific options */}
      {state.activeTab === 'histogram' && (
        <div>
          <InfoLabel tip="Number of bins. Leave blank to use the Freedman-Diaconis rule.">Bins (optional)</InfoLabel>
          <input
            type="text"
            className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
            placeholder="auto"
            value={state.histBins}
            onChange={e => patch({ histBins: e.target.value })}
          />
        </div>
      )}

      {state.activeTab === 'frequency' && (
        <>
          <div>
            <InfoLabel tip="Which column to tabulate.">Column</InfoLabel>
            <select
              className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
              value={state.freqColIdx}
              onChange={e => patch({ freqColIdx: e.target.value })}
            >
              {headers.map((h, i) => <option key={i} value={String(i)}>{h}</option>)}
            </select>
          </div>
          <div>
            <InfoLabel tip="Number of bins for numeric data. Leave blank to use value-count mode (discrete).">Bins (optional, numeric only)</InfoLabel>
            <input
              type="text"
              className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="discrete (no bins)"
              value={state.freqBins}
              onChange={e => patch({ freqBins: e.target.value })}
            />
          </div>
        </>
      )}

      {state.activeTab === 'contingency' && headers.length >= 2 && (
        <>
          <div>
            <InfoLabel tip="Column to use as table rows.">Row column</InfoLabel>
            <select
              className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
              value={state.ctRowColIdx}
              onChange={e => patch({ ctRowColIdx: e.target.value })}
            >
              {headers.map((h, i) => <option key={i} value={String(i)}>{h}</option>)}
            </select>
          </div>
          <div>
            <InfoLabel tip="Column to use as table columns.">Column column</InfoLabel>
            <select
              className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
              value={state.ctColColIdx}
              onChange={e => patch({ ctColColIdx: e.target.value })}
            >
              {headers.map((h, i) => <option key={i} value={String(i)}>{h}</option>)}
            </select>
          </div>
        </>
      )}

      <button
        onClick={run}
        disabled={loading || !hasData}
        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2 rounded flex items-center justify-center gap-2 transition-colors"
      >
        <Play size={13} />
        {loading ? 'Computing...' : 'Analyze'}
      </button>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{error}</p>
      )}
    </div>
  )

  // ---------------------------------------------------------------------------
  // Tab bar
  // ---------------------------------------------------------------------------

  const tabBar = (
    <div className="flex gap-0 border-b border-gray-200 bg-white px-4">
      {TABS.map(t => (
        <button
          key={t.id}
          onClick={() => patch({ activeTab: t.id })}
          className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
            state.activeTab === t.id
              ? 'border-blue-600 text-blue-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )

  // ---------------------------------------------------------------------------
  // Tab content
  // ---------------------------------------------------------------------------

  const summaryContent = (
    <div className="p-4">
      {!summaryRes && (
        <p className="text-sm text-gray-400 mt-8 text-center">
          Paste data and click Analyze to see statistics for each column.
        </p>
      )}
      {summaryRes && (
        <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-4">
          {Object.entries(summaryRes).map(([col, st]) => (
            <div key={col} className="border border-gray-200 rounded p-3 bg-white shadow-sm">
              <h3 className="text-sm font-semibold text-gray-800 mb-2 truncate" title={col}>{col}</h3>
              {st.error ? (
                <p className="text-xs text-red-500">{st.error}</p>
              ) : (
                <div className="text-xs space-y-0">
                  <StatRow label="n" value={String(st.n)} />
                  <StatRow label="Mean" value={fmt(st.mean)} />
                  <StatRow label="Trimmed mean (5%)" value={fmt(st.trimmed_mean)} />
                  <StatRow label="Median" value={fmt(st.median)} />
                  <StatRow label="Mode" value={fmt(st.mode)} />
                  <StatRow label="Std (sample)" value={fmt(st.std)} />
                  <StatRow label="Variance (sample)" value={fmt(st.variance)} />
                  <StatRow label="SEM" value={fmt(st.sem)} tip="Standard error of the mean" />
                  <StatRow label="CV" value={fmt(st.coefficient_of_variation)} tip="Coefficient of variation = std/mean" />
                  <StatRow label="MAD" value={fmt(st.MAD)} tip="Median absolute deviation" />
                  <StatRow label="Min" value={fmt(st.min)} />
                  <StatRow label="Max" value={fmt(st.max)} />
                  <StatRow label="Range" value={fmt(st.range)} />
                  <StatRow label="Sum" value={fmt(st.sum)} />
                  <StatRow label="Q1" value={fmt(st.Q1)} />
                  <StatRow label="Q2 / Median" value={fmt(st.Q2)} />
                  <StatRow label="Q3" value={fmt(st.Q3)} />
                  <StatRow label="IQR" value={fmt(st.IQR)} />
                  <StatRow label="P5" value={fmt(st.p5)} />
                  <StatRow label="P10" value={fmt(st.p10)} />
                  <StatRow label="P90" value={fmt(st.p90)} />
                  <StatRow label="P95" value={fmt(st.p95)} />
                  <StatRow label="Skewness" value={fmt(st.skewness)} />
                  <StatRow label="Kurtosis (excess)" value={fmt(st.kurtosis)} />
                  {st.normality && (
                    <div className="mt-1.5 pt-1.5 border-t border-gray-100">
                      <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Normality ({st.normality.test})</p>
                      <StatRow label="Stat" value={fmt(st.normality.stat)} />
                      {st.normality.p != null
                        ? <StatRow label="p-value" value={fmt(st.normality.p)} />
                        : <StatRow label="Critical (5%)" value={fmt(st.normality.critical_5pct ?? null)} />
                      }
                    </div>
                  )}
                  <div className="mt-1.5 pt-1.5 border-t border-gray-100">
                    <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Interpretation</p>
                    <ul className="text-[11px] text-gray-600 leading-snug list-disc pl-4 space-y-0.5">
                      {summaryInterpretation(st).map((n, i) => <li key={i}>{n}</li>)}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )

  const histContent = (
    <div className="p-4 flex flex-col gap-4">
      {!histRes && (
        <p className="text-sm text-gray-400 mt-8 text-center">
          Select a column and click Analyze to see the histogram.
        </p>
      )}
      {histRes && (
        <>
          <p className="text-xs text-gray-500">Column: <strong>{headers[0]}</strong> &mdash; {histRes.counts.reduce((a, b) => a + b, 0)} values, {histRes.counts.length} bins</p>
          <Plot
            data={histPlotData}
            layout={histLayout}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%', height: 380 }}
          />
        </>
      )}
    </div>
  )

  const boxContent = (
    <div className="p-4 flex flex-col gap-4">
      {!boxRes && (
        <p className="text-sm text-gray-400 mt-8 text-center">
          Click Analyze to compute boxplot statistics for the first column.
        </p>
      )}
      {boxRes && (
        <div className="flex gap-4 flex-wrap">
          <div className="flex-1 min-w-56">
            <Plot
              data={boxPlotData}
              layout={boxLayout}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: '100%', height: 380 }}
            />
          </div>
          <div className="w-56 flex-shrink-0 border border-gray-200 rounded p-3 bg-white shadow-sm text-xs">
            <h3 className="text-sm font-semibold text-gray-800 mb-2">Statistics</h3>
            <StatRow label="Min" value={fmt(boxRes.min)} />
            <StatRow label="Q1" value={fmt(boxRes.Q1)} />
            <StatRow label="Median" value={fmt(boxRes.median)} />
            <StatRow label="Q3" value={fmt(boxRes.Q3)} />
            <StatRow label="Max" value={fmt(boxRes.max)} />
            <StatRow label="IQR" value={fmt(boxRes.iqr)} />
            <StatRow label="Whisker low" value={fmt(boxRes.whisker_low)} />
            <StatRow label="Whisker high" value={fmt(boxRes.whisker_high)} />
            <div className="mt-1.5 pt-1.5 border-t border-gray-100">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">
                Outliers ({boxRes.outliers.length})
              </p>
              {boxRes.outliers.length === 0
                ? <p className="text-gray-400">None</p>
                : <p className="font-mono break-all">{boxRes.outliers.map(v => fmt(v)).join(', ')}</p>
              }
            </div>
          </div>
        </div>
      )}
    </div>
  )

  const runContent = (
    <div className="p-4 flex flex-col gap-4">
      {!runRes && (
        <p className="text-sm text-gray-400 mt-8 text-center">
          Click Analyze to compute run chart statistics for the first column.
        </p>
      )}
      {runRes && (
        <>
          <div className="flex gap-3 flex-wrap text-xs">
            <div className="border border-gray-200 rounded p-3 bg-white shadow-sm min-w-40">
              <h3 className="text-sm font-semibold text-gray-800 mb-2">Run Chart</h3>
              <StatRow label="n" value={String(runRes.n)} />
              <StatRow label="Median" value={fmt(runRes.median)} />
              <StatRow label="n above" value={String(runRes.n_above)} />
              <StatRow label="n below" value={String(runRes.n_below)} />
              <StatRow label="Runs" value={String(runRes.n_runs)} />
              <StatRow label="Expected runs" value={fmt(runRes.expected_runs)} />
              <StatRow label="Longest run" value={String(runRes.longest_run)} />
            </div>
            <div className="border border-gray-200 rounded p-3 bg-white shadow-sm min-w-40">
              <h3 className="text-sm font-semibold text-gray-800 mb-2">Wald-Wolfowitz Test</h3>
              <StatRow label="z" value={fmt(runRes.runs_test.z)} />
              <StatRow label="p-value" value={fmt(runRes.runs_test.p)} />
              {runRes.runs_test.p != null && (
                <p className="text-[10px] text-gray-500 mt-1">
                  {runRes.runs_test.p < 0.05
                    ? 'Significant: non-random pattern detected (p < 0.05).'
                    : 'No significant non-randomness detected (p ≥ 0.05).'}
                </p>
              )}
            </div>
          </div>
          <Plot
            data={runPlotData}
            layout={runLayout}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%', height: 340 }}
          />
        </>
      )}
    </div>
  )

  const freqContent = (
    <div className="p-4 flex flex-col gap-4">
      {!freqRes && (
        <p className="text-sm text-gray-400 mt-8 text-center">
          Select a column and click Analyze to build the frequency table.
        </p>
      )}
      {freqRes && (
        <div className="flex gap-4 flex-wrap">
          <div className="flex-1 min-w-72">
            <Plot
              data={freqPlotData}
              layout={freqLayout}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: '100%', height: 300 }}
            />
          </div>
          <div className="flex-1 min-w-72 overflow-x-auto">
            <table className="text-xs w-full border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-600 text-left">
                  <th className="border border-gray-200 px-2 py-1">Value / Bin</th>
                  <th className="border border-gray-200 px-2 py-1 text-right">Count</th>
                  <th className="border border-gray-200 px-2 py-1 text-right">Rel. freq</th>
                  <th className="border border-gray-200 px-2 py-1 text-right">Cum. freq</th>
                </tr>
              </thead>
              <tbody>
                {(freqRes.labels ?? freqRes.bin_labels ?? []).map((label, i) => (
                  <tr key={i} className="odd:bg-white even:bg-gray-50">
                    <td className="border border-gray-200 px-2 py-0.5 font-mono">{label}</td>
                    <td className="border border-gray-200 px-2 py-0.5 text-right">{freqRes.counts[i]}</td>
                    <td className="border border-gray-200 px-2 py-0.5 text-right">{fmt(freqRes.relative_freq[i])}</td>
                    <td className="border border-gray-200 px-2 py-0.5 text-right">{fmt(freqRes.cumulative_freq[i])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )

  const ctContent = (
    <div className="p-4 flex flex-col gap-4">
      {headers.length < 2 && (
        <p className="text-sm text-gray-400 mt-8 text-center">
          Paste data with at least two columns to use the contingency table.
        </p>
      )}
      {headers.length >= 2 && !ctRes && (
        <p className="text-sm text-gray-400 mt-8 text-center">
          Select row/column variables and click Analyze.
        </p>
      )}
      {ctRes && (
        <div className="flex flex-col gap-4">
          {/* Chi-square result */}
          <div className="border border-gray-200 rounded p-3 bg-white shadow-sm text-xs w-fit">
            <h3 className="text-sm font-semibold text-gray-800 mb-2">Chi-Square Independence Test</h3>
            <StatRow label="χ²" value={fmt(ctRes.chi2.chi2)} />
            <StatRow label="p-value" value={fmt(ctRes.chi2.p)} />
            <StatRow label="DOF" value={ctRes.chi2.dof != null ? String(ctRes.chi2.dof) : '—'} />
            {ctRes.chi2.p != null && (
              <p className="text-[10px] text-gray-500 mt-1">
                {ctRes.chi2.p < 0.05
                  ? 'Variables appear dependent (p < 0.05).'
                  : 'No significant association detected (p ≥ 0.05).'}
              </p>
            )}
            {ctRes.chi2.error && <p className="text-red-500 text-[10px]">{ctRes.chi2.error}</p>}
          </div>

          {/* Observed table */}
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-1">Observed counts</p>
            <div className="overflow-x-auto">
              <table className="text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="border border-gray-200 px-2 py-1 text-gray-500">Row \ Col</th>
                    {ctRes.col_labels.map(c => (
                      <th key={c} className="border border-gray-200 px-2 py-1 font-semibold text-gray-700">{c}</th>
                    ))}
                    <th className="border border-gray-200 px-2 py-1 text-gray-500">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {ctRes.row_labels.map((r, ri) => (
                    <tr key={r} className="odd:bg-white even:bg-gray-50">
                      <td className="border border-gray-200 px-2 py-0.5 font-semibold text-gray-700">{r}</td>
                      {ctRes.observed[ri].map((v, ci) => (
                        <td key={ci} className="border border-gray-200 px-2 py-0.5 text-right">{v}</td>
                      ))}
                      <td className="border border-gray-200 px-2 py-0.5 text-right font-semibold">{ctRes.row_totals[ri]}</td>
                    </tr>
                  ))}
                  <tr className="bg-gray-100">
                    <td className="border border-gray-200 px-2 py-0.5 font-semibold text-gray-500">Total</td>
                    {ctRes.col_totals.map((v, ci) => (
                      <td key={ci} className="border border-gray-200 px-2 py-0.5 text-right font-semibold">{v}</td>
                    ))}
                    <td className="border border-gray-200 px-2 py-0.5 text-right font-bold">{ctRes.grand_total}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Expected table */}
          {ctRes.expected.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-1">Expected counts (under H₀)</p>
              <div className="overflow-x-auto">
                <table className="text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="border border-gray-200 px-2 py-1 text-gray-500">Row \ Col</th>
                      {ctRes.col_labels.map(c => (
                        <th key={c} className="border border-gray-200 px-2 py-1 font-semibold text-gray-700">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ctRes.row_labels.map((r, ri) => (
                      <tr key={r} className="odd:bg-white even:bg-gray-50">
                        <td className="border border-gray-200 px-2 py-0.5 font-semibold text-gray-700">{r}</td>
                        {(ctRes.expected[ri] ?? []).map((v, ci) => (
                          <td key={ci} className="border border-gray-200 px-2 py-0.5 text-right font-mono">{fmt(v)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )

  // ---------------------------------------------------------------------------
  // Tab routing
  // ---------------------------------------------------------------------------

  const tabContent: Record<TabId, JSX.Element> = {
    summary: summaryContent,
    histogram: histContent,
    boxplot: boxContent,
    runchart: runContent,
    frequency: freqContent,
    contingency: ctContent,
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex h-[calc(100vh-57px)]">
      {leftPanel}
      <div className="flex-1 overflow-auto flex flex-col">
        <div className="flex items-center">
          <div className="flex-1">{tabBar}</div>
          <div className="pr-4">
            <ExportResultsButton getElement={() => resultsRef.current} baseName="descriptive" />
          </div>
        </div>
        <div ref={resultsRef} className="flex-1 overflow-auto">
          {tabContent[state.activeTab]}
        </div>
      </div>
    </div>
  )
}
