import { useState, useRef } from 'react'
import Plot from '../shared/ExportablePlot'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlotlyLayout = any
import { Play, Upload, Trash2 } from 'lucide-react'
import InfoLabel from '../shared/InfoLabel'
import ExportResultsButton from '../shared/ExportResultsButton'
import StaleBanner from '../shared/StaleBanner'
import { useModuleState } from '../../store/project'
import ModelDataGrid, { GridRow } from '../DataModeling/ModelDataGrid'
import GenerateColumnPanel from '../shared/GenerateColumnPanel'
import { useSharedDataset, numericColumns, INITIAL_DATASET } from '../DataAnalysis/shared'
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

type TabId = 'summary' | 'histogram' | 'boxplot' | 'violin' | 'raincloud' | 'runchart' | 'frequency' | 'contingency' | 'scatter' | 'correlation' | 'qq' | 'ecdf'

// Computed results for the server-backed tabs. Held in the module store (not
// local component state) so they survive the remount that happens when the
// user switches Analysis tabs in the Statistical Modeling folio.
interface DescriptiveResults {
  summary: SummaryResponse | null
  histogram: HistogramResponse | null
  boxplot: BoxplotResponse | null
  runchart: RunChartResponse | null
  frequency: FrequencyResponse | null
  contingency: ContingencyResponse | null
}

const EMPTY_RESULTS: DescriptiveResults = {
  summary: null, histogram: null, boxplot: null,
  runchart: null, frequency: null, contingency: null,
}

interface DescriptiveState {
  histBins: string
  freqBins: string
  freqColIdx: string
  ctRowColIdx: string
  ctColColIdx: string
  /** Column index analyzed by the single-variable plots (histogram, boxplot,
   *  run chart, QQ). */
  analyzeColIdx: string
  /** Tabs currently displayed (multi-select; at least one). */
  activeTabs: TabId[]
  /** Legacy single-tab field, migrated to activeTabs on read. */
  activeTab?: TabId
  results: DescriptiveResults
  /** Signature of the dataset when results were last computed (stale check). */
  dataSig?: string | null
}

const INITIAL_STATE: DescriptiveState = {
  histBins: '',
  freqBins: '',
  freqColIdx: '0',
  ctRowColIdx: '0',
  ctColColIdx: '1',
  analyzeColIdx: '0',
  activeTabs: ['summary'],
  results: EMPTY_RESULTS,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TABS: { id: TabId; label: string }[] = [
  { id: 'summary', label: 'Summary' },
  { id: 'histogram', label: 'Histogram' },
  { id: 'boxplot', label: 'Boxplot' },
  { id: 'violin', label: 'Violin' },
  { id: 'raincloud', label: 'Raincloud' },
  { id: 'scatter', label: 'Scatter Matrix' },
  { id: 'correlation', label: 'Correlation' },
  { id: 'qq', label: 'QQ Plot' },
  { id: 'ecdf', label: 'ECDF' },
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

  // Store-backed results (survive Analysis-tab remounts). Aliased to the old
  // *Res names so the existing render code is unchanged.
  const results = state.results ?? EMPTY_RESULTS
  const summaryRes = results.summary
  const histRes = results.histogram
  const boxRes = results.boxplot
  const runRes = results.runchart
  const freqRes = results.frequency
  const ctRes = results.contingency

  const [data, setData] = useSharedDataset()
  const fileRef = useRef<HTMLInputElement>(null)

  const patch = (p: Partial<DescriptiveState>) => setState(s => ({ ...s, ...p }))
  const setResults = (p: Partial<DescriptiveResults>) =>
    setState(s => ({ ...s, results: { ...(s.results ?? EMPTY_RESULTS), ...p } }))

  // Currently displayed tabs (multi-select). Migrate the legacy single field.
  const activeTabs: TabId[] = (state.activeTabs && state.activeTabs.length)
    ? state.activeTabs
    : [state.activeTab ?? 'summary']

  const toggleTab = (id: TabId, additive: boolean) => {
    if (!additive) { patch({ activeTabs: [id] }); return }
    const has = activeTabs.includes(id)
    let next = has ? activeTabs.filter(t => t !== id) : [...activeTabs, id]
    if (next.length === 0) next = [id]
    patch({ activeTabs: next })
  }

  const { headers, columns } = numericColumns(data)
  const hasData = headers.length > 0 && Object.values(columns).some(c => c.length > 0)

  // Column driving the single-variable plots (histogram, boxplot, run chart, QQ).
  const analyzeIdx = Math.max(0, Math.min(headers.length - 1, parseInt(state.analyzeColIdx, 10) || 0))
  const analyzeHeader = headers[analyzeIdx] ?? 'Value'

  // Staleness: did the dataset change since results were last computed?
  const dataSig = JSON.stringify(data)
  const hasAnyResult = Object.values(results).some(v => v != null)
  const isStale = hasAnyResult && state.dataSig != null && state.dataSig !== dataSig

  const clearResults = () => setState(s => ({ ...s, results: EMPTY_RESULTS, dataSig: null }))

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

  // Tabs whose output is computed on the server (the rest are client-side
  // plots that render directly from the dataset and need no "Analyze" step).
  const SERVER_TABS: TabId[] = ['summary', 'histogram', 'boxplot', 'runchart', 'frequency', 'contingency']

  const run = async () => {
    if (!hasData) { setError('Paste data with a header row first.'); return }
    setError(null)
    setLoading(true)
    const out: Partial<DescriptiveResults> = {}
    const issues: string[] = []
    try {
      for (const tab of activeTabs) {
        if (tab === 'summary') {
          out.summary = await getSummaryStatistics({ columns })
        } else if (tab === 'histogram') {
          const vals = columns[analyzeHeader] ?? []
          const bins = state.histBins ? parseInt(state.histBins, 10) : undefined
          out.histogram = await getHistogram({ values: vals, bins })
        } else if (tab === 'boxplot') {
          const vals = columns[analyzeHeader] ?? []
          out.boxplot = await getBoxplot({ values: vals })
        } else if (tab === 'runchart') {
          const vals = columns[analyzeHeader] ?? []
          out.runchart = await getRunChart({ values: vals })
        } else if (tab === 'frequency') {
          const idx = Math.max(0, Math.min(headers.length - 1, parseInt(state.freqColIdx, 10) || 0))
          const vals = columns[headers[idx]] ?? []
          const bins = state.freqBins ? parseInt(state.freqBins, 10) : undefined
          out.frequency = await getFrequencyTable({ values: vals, bins })
        } else if (tab === 'contingency') {
          const ri = Math.max(0, Math.min(headers.length - 1, parseInt(state.ctRowColIdx, 10) || 0))
          const ci = Math.max(0, Math.min(headers.length - 1, parseInt(state.ctColColIdx, 10) || 1))
          if (ri === ci) { issues.push('Contingency: row and column must be different.'); continue }
          const rowVals = columns[headers[ri]] ?? []
          const colVals = columns[headers[ci]] ?? []
          if (rowVals.length !== colVals.length) {
            issues.push('Contingency: row and column must have the same number of valid values.')
            continue
          }
          out.contingency = await getContingencyTable({ row_values: rowVals, col_values: colVals })
        }
      }
      if (Object.keys(out).length > 0) {
        setState(s => ({ ...s, results: { ...(s.results ?? EMPTY_RESULTS), ...out }, dataSig }))
      }
      setError(issues.length > 0 ? issues.join(' ') : null)
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
    xaxis: { title: { text: analyzeHeader }, gridcolor: GRID_COLOR },
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
      name: analyzeHeader,
    }]
  })()

  const boxLayout: PlotlyLayout = {
    ...PLOT_LAYOUT_BASE,
    yaxis: { title: { text: analyzeHeader }, gridcolor: GRID_COLOR },
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
    yaxis: { title: { text: analyzeHeader }, gridcolor: GRID_COLOR },
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
            <button onClick={() => {
              if (window.confirm('Clear the dataset? This will reset all data.')) {
                setData(INITIAL_DATASET); clearResults()
              }
            }}
              title="Clear dataset"
              className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 border border-gray-300 rounded hover:bg-gray-50 text-gray-500 hover:text-red-600">
              <Trash2 size={10} />
            </button>
          </div>
        </div>
        <ModelDataGrid columns={data.columns} rows={data.rows}
          onColumnsChange={(cols, rows) => setData({ columns: cols, rows })}
          onRowsChange={rows => setData({ columns: data.columns, rows })} />
        {hasData && (
          <p className="text-[10px] text-gray-400 mt-0.5">
            {headers.length} column{headers.length !== 1 ? 's' : ''}: {headers.join(', ')} &mdash; {Object.values(columns)[0]?.length ?? 0} numeric rows
          </p>
        )}
      </div>

      <GenerateColumnPanel columns={data.columns} rows={data.rows}
        setData={d => setData(d)} onError={setError} />

      {/* Tab-specific options */}
      {activeTabs.some(t => (['histogram', 'boxplot', 'runchart', 'qq'] as TabId[]).includes(t)) && headers.length > 0 && (
        <div>
          <InfoLabel tip="Which column the histogram, boxplot, run chart and QQ plot analyze.">Variable to analyze</InfoLabel>
          <select
            className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
            value={String(analyzeIdx)}
            onChange={e => setState(s => ({
              ...s,
              analyzeColIdx: e.target.value,
              // Clear single-variable results so stale labels don't linger; re-run to refresh.
              results: { ...(s.results ?? EMPTY_RESULTS), histogram: null, boxplot: null, runchart: null },
            }))}
          >
            {headers.map((h, i) => <option key={i} value={String(i)}>{h}</option>)}
          </select>
        </div>
      )}

      {activeTabs.includes('histogram') && (
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

      {activeTabs.includes('frequency') && (
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

      {activeTabs.includes('contingency') && headers.length >= 2 && (
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
        disabled={loading || !hasData || !activeTabs.some(t => SERVER_TABS.includes(t))}
        title={activeTabs.some(t => SERVER_TABS.includes(t))
          ? 'Compute results for the selected server-backed tabs'
          : 'The selected plots render directly from the data — no analysis step needed'}
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
    <div className="flex flex-wrap gap-0 border-b border-gray-200 bg-white px-4"
      title="Click a tab to view it. Ctrl/⌘-click to show several plots at once.">
      {TABS.map(t => (
        <button
          key={t.id}
          onClick={e => toggleTab(t.id, e.ctrlKey || e.metaKey)}
          className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
            activeTabs.includes(t.id)
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
          <p className="text-xs text-gray-500">Column: <strong>{analyzeHeader}</strong> &mdash; {histRes.counts.reduce((a, b) => a + b, 0)} values, {histRes.counts.length} bins</p>
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
          Select a column and click Analyze to compute boxplot statistics.
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
          Select a column and click Analyze to compute run chart statistics.
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
  // Client-side plot tabs (no backend call needed)
  // ---------------------------------------------------------------------------

  const COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16']

  const violinContent = (() => {
    if (!hasData) return <p className="text-sm text-gray-400 mt-8 text-center p-4">Paste data to see violin plots.</p>
    const traces = headers.map((h, i) => ({
      type: 'violin' as const,
      y: columns[h],
      name: h,
      box: { visible: true },
      meanline: { visible: true },
      line: { color: COLORS[i % COLORS.length] },
    }))
    return (
      <div className="p-4">
        <Plot data={traces as Plotly.Data[]}
          layout={{ ...PLOT_LAYOUT_BASE, showlegend: true, yaxis: { gridcolor: GRID_COLOR } } as PlotlyLayout}
          config={{ responsive: true }} style={{ width: '100%', height: 450 }} useResizeHandler />
      </div>
    )
  })()

  const raincloudContent = (() => {
    if (!hasData) return <p className="text-sm text-gray-400 mt-8 text-center p-4">Paste data to see raincloud plots.</p>
    const subTraces: Plotly.Data[] = []
    const n = headers.length
    const layout: PlotlyLayout = { ...PLOT_LAYOUT_BASE, showlegend: false, margin: { t: 30, r: 30, b: 50, l: 100 } }
    headers.forEach((h, i) => {
      const vals = columns[h]
      const color = COLORS[i % COLORS.length]
      const yIdx = i === 0 ? '' : `${i + 1}`
      const gap = 0.03
      const cellH = (1 - gap * (n - 1)) / n
      const lo = i * (cellH + gap)
      const hi = lo + cellH
      layout[`yaxis${yIdx}`] = {
        domain: [1 - hi, 1 - lo], showticklabels: false, zeroline: false, showgrid: false,
        title: { text: h, font: { size: 10 } },
      }
      if (i === 0) layout['xaxis'] = { gridcolor: GRID_COLOR, title: { text: 'Value' } }
      else layout[`xaxis${i + 1}`] = { gridcolor: GRID_COLOR, matches: 'x', showticklabels: i === n - 1 }
      subTraces.push({
        type: 'violin', x: vals, side: 'positive', line: { color, width: 1 },
        meanline: { visible: true }, width: 1.8, points: false, scalemode: 'width',
        yaxis: `y${yIdx}`, name: h, showlegend: false,
      } as unknown as Plotly.Data)
      subTraces.push({
        type: 'box', x: vals, marker: { color, size: 2 }, line: { color, width: 1 },
        boxpoints: false, width: 0.12, yaxis: `y${yIdx}`, showlegend: false, name: h,
      } as unknown as Plotly.Data)
      const jy = vals.map(() => -0.3 + (Math.random() - 0.5) * 0.2)
      subTraces.push({
        type: 'scatter', mode: 'markers', x: vals, y: jy,
        yaxis: `y${yIdx}`, marker: { color, size: 3, opacity: 0.4 },
        showlegend: false, name: h, hovertemplate: `${h}: %{x}<extra></extra>`,
      } as unknown as Plotly.Data)
    })
    return (
      <div className="p-4">
        <Plot data={subTraces} layout={layout}
          config={{ responsive: true }} style={{ width: '100%', height: Math.max(400, n * 140) }} useResizeHandler />
      </div>
    )
  })()

  const scatterContent = (() => {
    if (headers.length < 2) return <p className="text-sm text-gray-400 mt-8 text-center p-4">Need at least 2 numeric columns for a scatter matrix.</p>
    const dims = headers.slice(0, 6)
    const traces: Plotly.Data[] = []
    for (let r = 0; r < dims.length; r++) {
      for (let c = 0; c < dims.length; c++) {
        if (r === c) {
          traces.push({
            type: 'histogram', x: columns[dims[c]], xaxis: `x${c + 1}`, yaxis: `y${r + 1}`,
            marker: { color: COLORS[c % COLORS.length], opacity: 0.6 }, showlegend: false, nbinsx: 15,
          } as unknown as Plotly.Data)
        } else {
          traces.push({
            type: 'scatter', mode: 'markers', x: columns[dims[c]], y: columns[dims[r]],
            xaxis: `x${c + 1}`, yaxis: `y${r + 1}`,
            marker: { color: COLORS[c % COLORS.length], size: 4, opacity: 0.6 }, showlegend: false,
          } as unknown as Plotly.Data)
        }
      }
    }
    const n = dims.length
    const gap = 0.04
    const cellSize = (1 - gap * (n - 1)) / n
    const layout: PlotlyLayout = { ...PLOT_LAYOUT_BASE, margin: { t: 30, r: 30, b: 40, l: 40 }, showlegend: false }
    for (let i = 0; i < n; i++) {
      const lo = i * (cellSize + gap)
      const hi = lo + cellSize
      layout[`xaxis${i + 1}`] = { domain: [lo, hi], title: i === n - 1 ? { text: dims[i], font: { size: 9 } } : undefined, gridcolor: GRID_COLOR, tickfont: { size: 8 } }
      layout[`yaxis${i + 1}`] = { domain: [1 - hi, 1 - lo], title: i === 0 ? { text: dims[i], font: { size: 9 } } : undefined, gridcolor: GRID_COLOR, tickfont: { size: 8 } }
    }
    // axis labels on the diagonal
    for (let i = 0; i < n; i++) {
      layout[`yaxis${i + 1}`].title = { text: dims[i], font: { size: 9 } }
    }
    return (
      <div className="p-4">
        {headers.length > 6 && <p className="text-[10px] text-gray-400 mb-1">Showing first 6 columns.</p>}
        <Plot data={traces} layout={layout} config={{ responsive: true }} style={{ width: '100%', height: Math.max(500, n * 130) }} useResizeHandler />
      </div>
    )
  })()

  const correlationContent = (() => {
    if (headers.length < 2) return <p className="text-sm text-gray-400 mt-8 text-center p-4">Need at least 2 numeric columns for a correlation heatmap.</p>
    const cols = headers
    const n = cols.length
    const matrix: number[][] = []
    for (let i = 0; i < n; i++) {
      const row: number[] = []
      for (let j = 0; j < n; j++) {
        const xi = columns[cols[i]], xj = columns[cols[j]]
        const len = Math.min(xi.length, xj.length)
        const xm = xi.slice(0, len).reduce((a, b) => a + b, 0) / len
        const ym = xj.slice(0, len).reduce((a, b) => a + b, 0) / len
        let num = 0, dx = 0, dy = 0
        for (let k = 0; k < len; k++) { num += (xi[k] - xm) * (xj[k] - ym); dx += (xi[k] - xm) ** 2; dy += (xj[k] - ym) ** 2 }
        row.push(dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : i === j ? 1 : 0)
      }
      matrix.push(row)
    }
    return (
      <div className="p-4">
        <Plot data={[{
          type: 'heatmap', z: matrix, x: cols, y: cols,
          colorscale: [[0, '#2563eb'], [0.5, '#ffffff'], [1, '#dc2626']], zmin: -1, zmax: 1,
          text: matrix.map(row => row.map(v => v.toFixed(2))), texttemplate: '%{text}', showscale: true,
          hovertemplate: '%{x} vs %{y}: r = %{z:.3f}<extra></extra>',
        } as unknown as Plotly.Data]}
          layout={{ ...PLOT_LAYOUT_BASE, margin: { t: 30, r: 20, b: 80, l: 80 }, xaxis: { tickangle: -30 }, yaxis: { autorange: 'reversed' as const } } as PlotlyLayout}
          config={{ responsive: true }} style={{ width: '100%', height: Math.max(400, n * 50 + 100) }} useResizeHandler />
      </div>
    )
  })()

  const qqContent = (() => {
    if (!hasData) return <p className="text-sm text-gray-400 mt-8 text-center p-4">Paste data to see QQ plots.</p>
    const col = analyzeHeader
    const vals = [...columns[col]].sort((a, b) => a - b)
    const n = vals.length
    const mean = vals.reduce((a, b) => a + b, 0) / n
    const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1))
    // Normal quantiles (using approximation of inverse normal)
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
      else if (p <= pHigh) { const qq = p - 0.5; const r = qq * qq; q = (((((a1 * r + a2) * r + a3) * r + a4) * r + a5) * r + a6) * qq / (((((b1 * r + b2) * r + b3) * r + b4) * r + b5) * r + 1) }
      else { const qq = Math.sqrt(-2 * Math.log(1 - p)); q = -(((((c1 * qq + c2) * qq + c3) * qq + c4) * qq + c5) * qq + c6) / ((((d1 * qq + d2) * qq + d3) * qq + d4) * qq + 1) }
      return q
    }
    const theoretical = vals.map((_, i) => invNorm((i + 0.5) / n))
    const standardized = std > 0 ? vals.map(v => (v - mean) / std) : vals
    const lo = Math.min(...theoretical, ...standardized)
    const hi = Math.max(...theoretical, ...standardized)
    return (
      <div className="p-4">
        <p className="text-xs text-gray-500 mb-2">QQ plot for <strong>{col}</strong> against the normal distribution. Points along the diagonal indicate normality.</p>
        <Plot data={[
          { x: theoretical, y: standardized, mode: 'markers', name: 'Data', marker: { color: '#3b82f6', size: 6 } } as Plotly.Data,
          { x: [lo, hi], y: [lo, hi], mode: 'lines', name: 'Reference', line: { color: '#ef4444', dash: 'dash' } } as Plotly.Data,
        ]}
          layout={{ ...PLOT_LAYOUT_BASE, xaxis: { title: { text: 'Theoretical quantiles' }, gridcolor: GRID_COLOR }, yaxis: { title: { text: 'Sample quantiles (standardized)' }, gridcolor: GRID_COLOR }, showlegend: true } as PlotlyLayout}
          config={{ responsive: true }} style={{ width: '100%', height: 420 }} useResizeHandler />
      </div>
    )
  })()

  const ecdfContent = (() => {
    if (!hasData) return <p className="text-sm text-gray-400 mt-8 text-center p-4">Paste data to see ECDF plots.</p>
    const traces = headers.map((h, idx) => {
      const sorted = [...columns[h]].sort((a, b) => a - b)
      const n = sorted.length
      const yy = sorted.map((_, i) => (i + 1) / n)
      return { x: sorted, y: yy, mode: 'lines' as const, name: h, line: { color: COLORS[idx % COLORS.length], width: 2, shape: 'hv' as const } }
    })
    return (
      <div className="p-4">
        <Plot data={traces as Plotly.Data[]}
          layout={{ ...PLOT_LAYOUT_BASE, xaxis: { title: { text: 'Value' }, gridcolor: GRID_COLOR }, yaxis: { title: { text: 'Cumulative probability' }, gridcolor: GRID_COLOR, range: [0, 1.02] }, showlegend: true } as PlotlyLayout}
          config={{ responsive: true }} style={{ width: '100%', height: 420 }} useResizeHandler />
      </div>
    )
  })()

  // ---------------------------------------------------------------------------
  // Tab routing
  // ---------------------------------------------------------------------------

  const tabContent: Record<TabId, JSX.Element> = {
    summary: summaryContent,
    histogram: histContent,
    boxplot: boxContent,
    violin: violinContent,
    raincloud: raincloudContent,
    scatter: scatterContent,
    correlation: correlationContent,
    qq: qqContent,
    ecdf: ecdfContent,
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
          <div className="flex-1 min-w-0">{tabBar}</div>
          <div className="pr-4 flex items-center gap-3 flex-shrink-0">
            <span className="text-[10px] text-gray-400 whitespace-nowrap select-none hidden lg:inline">
              Ctrl/⌘-click tabs to show several plots
            </span>
            <ExportResultsButton getElement={() => resultsRef.current} baseName="descriptive" />
          </div>
        </div>
        <div ref={resultsRef} className="flex-1 overflow-auto">
          <StaleBanner show={isStale} onRerun={run} rerunLabel={loading ? 'Computing…' : 'Re-run'} />
          {TABS.filter(t => activeTabs.includes(t.id)).map(t => (
            <div key={t.id}>
              {activeTabs.length > 1 && (
                <div className="px-4 pt-3 pb-1 text-xs font-semibold text-gray-700 border-b border-gray-100 bg-gray-50/60">
                  {t.label}
                </div>
              )}
              {tabContent[t.id]}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
