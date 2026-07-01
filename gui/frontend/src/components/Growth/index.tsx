import { useState, useRef, useMemo } from 'react'
import Plot from '../shared/ExportablePlot'
import { Play, Trash2 } from 'lucide-react'
import { fitGrowth, GrowthResponse } from '../../api/client'
import { useModuleActiveState, useFolioState, useUnits } from '../../store/project'
import InfoLabel from '../shared/InfoLabel'
import FolioBar from '../shared/FolioBar'
import RepairableTools from './RepairableTools'
import ExportResultsButton from '../shared/ExportResultsButton'
import ExampleButton from '../shared/ExampleButton'
import { Card } from '../shared/ui'
import { inputCls, labelCls } from '../shared/styles'

type GrowthView = 'growth' | 'replacement' | 'rocof' | 'mcf'

const GROWTH_VIEWS: { id: GrowthView; label: string }[] = [
  { id: 'growth', label: 'Growth Models' },
  { id: 'replacement', label: 'Optimal Replacement' },
  { id: 'rocof', label: 'ROCOF' },
  { id: 'mcf', label: 'Mean Cumulative Function' },
]

type GrowthModel = 'crow-amsaa' | 'duane'

interface GrowthState {
  model: GrowthModel
  source: 'manual' | 'folio'
  folioId: string
  times: string          // legacy comma-separated (kept for migration)
  rows?: string[]        // tabular cumulative failure-time entries
  T: string
  result?: GrowthResponse | null
}

const INITIAL_STATE: GrowthState = {
  model: 'crow-amsaa',
  source: 'manual',
  folioId: '',
  times: '',
  rows: ['', '', '', '', ''],
  T: '',
}

// A classic reliability-growth dataset: cumulative failure times from a
// test-analyze-fix programme, total test time 1000. Fits a Crow-AMSAA power law
// with growth (beta < 1). Loaded by the "Load example" button.
const EXAMPLE_STATE: GrowthState = {
  model: 'crow-amsaa',
  source: 'manual',
  folioId: '',
  times: '',
  rows: ['12', '45', '89', '132', '200', '290', '410', '570', '720', '900'],
  T: '1000',
}

// Minimal shape of the Life Data module slice we read folio times from
interface FolioLite {
  id: string
  name: string
  rows: { time: string; state: 'F' | 'S' }[]
}
interface LifeDataLite { folios: FolioLite[] }

/** Failure times of a folio (state F), sorted ascending as cumulative ages. */
const folioTimes = (f: FolioLite | undefined) =>
  (f?.rows ?? [])
    .filter(r => r.state === 'F' && r.time.trim() !== '')
    .map(r => parseFloat(r.time))
    .filter(n => !isNaN(n))
    .sort((a, b) => a - b)

export default function Growth() {
  const [s, setS, folios] = useFolioState<GrowthState>('growth', INITIAL_STATE)
  const patch = (p: Partial<GrowthState>) => setS(prev => ({ ...prev, ...p }))
  const lifeData = useModuleActiveState<LifeDataLite>('lifeData', { folios: [] })
  const [units] = useUnits()
  const tableRef = useRef<HTMLDivElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<GrowthView>('growth')

  // Sort state for the data table (display-only)
  const [grSortDir, setGrSortDir] = useState<'asc' | 'desc' | null>(null)
  const toggleGrSort = () => {
    if (grSortDir === null) setGrSortDir('asc')
    else if (grSortDir === 'asc') setGrSortDir('desc')
    else setGrSortDir(null)
  }

  // Rows: migrate from legacy comma-separated `times` if present.
  const rows: string[] = s.rows
    ?? (s.times.trim() ? s.times.split(/[\s,\n]+/).filter(Boolean) : ['', '', '', '', ''])

  const grSortedIndices = useMemo(() => {
    const indices = rows.map((_, i) => i)
    if (!grSortDir) return indices
    return indices.sort((a, b) => {
      const na = parseFloat(rows[a]), nb = parseFloat(rows[b])
      const cmp = (!isNaN(na) && !isNaN(nb)) ? na - nb : rows[a].localeCompare(rows[b])
      return grSortDir === 'asc' ? cmp : -cmp
    })
  }, [rows, grSortDir])

  const setRows = (next: string[]) => patch({ rows: next, result: null })
  const updateRow = (idx: number, val: string) =>
    setRows(rows.map((r, i) => i === idx ? val : r))
  const addRow = () => setRows([...rows, ''])
  const removeRow = (idx: number) =>
    setRows(rows.length <= 1 ? [''] : rows.filter((_, i) => i !== idx))
  const handleRowKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key === 'Tab' && !e.shiftKey && idx === rows.length - 1) {
      e.preventDefault()
      setRows([...rows, ''])
      setTimeout(() => {
        tableRef.current
          ?.querySelector<HTMLInputElement>(`[data-row="${idx + 1}"]`)
          ?.focus()
      }, 0)
    }
  }
  const rowsToNumbers = () =>
    rows.map(r => parseFloat(r)).filter(n => !isNaN(n))

  const foliosWithData = lifeData.folios.filter(f => folioTimes(f).length > 0)
  const selectedFolio = lifeData.folios.find(f => f.id === s.folioId)

  const runAnalysis = async () => {
    const times = s.source === 'folio'
      ? folioTimes(selectedFolio)
      : rowsToNumbers()
    if (s.source === 'folio' && !selectedFolio) {
      setError('Select a Life Data folio.'); return
    }
    if (times.length < 3) {
      setError(s.source === 'folio'
        ? 'The selected folio needs at least 3 failure times.'
        : 'Enter at least 3 cumulative failure times.'); return
    }
    if (new Set(times).size !== times.length) {
      setError('Failure times must be distinct (strictly increasing cumulative ages).'); return
    }
    setError(null); setLoading(true)
    try {
      const res = await fitGrowth({
        times,
        T: s.T.trim() ? parseFloat(s.T) : null,
        model: s.model,
      })
      patch({ result: res })
    } catch (e: unknown) {
      setError(
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        || 'Error fitting growth model.',
      )
    } finally { setLoading(false) }
  }

  // --- Results ---
  const r = s.result

  return (
    <div className="flex flex-col h-full">
      <FolioBar api={folios} />
      {/* Sub-tab navigation for the repairable-systems tools */}
      <div className="flex items-stretch gap-1 bg-white border-b border-gray-200 px-3">
        {GROWTH_VIEWS.map(v => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              view === v.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >{v.label}</button>
        ))}
      </div>

      {view !== 'growth' ? (
        <RepairableTools tool={view} />
      ) : (
      /* Body: left panel + main content */
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel */}
        <div className="w-80 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-4 flex flex-col gap-3">
          {/* Model selection */}
          <div>
            <InfoLabel tip="Crow-AMSAA fits a non-homogeneous Poisson process (power law) by maximum likelihood — the standard for tracking reliability growth during test-analyze-fix. Duane is the older graphical/regression method on log-log cumulative MTBF.">Model</InfoLabel>
            <select
              value={s.model}
              onChange={e => patch({ model: e.target.value as GrowthModel })}
              className={inputCls}
            >
              <option value="crow-amsaa">Crow-AMSAA (NHPP)</option>
              <option value="duane">Duane</option>
            </select>
          </div>

          {/* Data source */}
          <div>
            <InfoLabel tip="Enter cumulative failure times manually, or pull them from a Life Data Analysis folio (its state-F failure times are used as cumulative system ages).">Failure times source</InfoLabel>
            <div className="flex gap-2">
              {([['manual', 'Manual entry'], ['folio', 'LDA folio']] as const).map(([v, lbl]) => (
                <button key={v} onClick={() => patch({ source: v })}
                  className={`flex-1 py-1 text-xs rounded border transition-colors ${
                    s.source === v ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'
                  }`}>{lbl}</button>
              ))}
            </div>
          </div>

          {s.source === 'manual' ? (
            <div>
              <div className="flex items-center justify-between">
                <label className={labelCls}>
                  Cumulative failure times <span className="text-gray-400">({rowsToNumbers().length} entries)</span>
                </label>
                <ExampleButton
                  hasData={(s.rows ?? []).some(r => r.trim() !== '') || s.T.trim() !== ''}
                  onLoad={() => setS(EXAMPLE_STATE)}
                />
              </div>
              <div ref={tableRef} className="border border-gray-200 rounded overflow-hidden">
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-2 py-1 text-left font-medium text-gray-500 w-8">#</th>
                        <th className="px-2 py-1 text-left font-medium text-gray-500 select-none cursor-pointer hover:text-blue-600"
                          onClick={toggleGrSort}>Time ({units}) {grSortDir ? <span className="text-[10px]">{grSortDir === 'asc' ? '▲' : '▼'}</span> : ''}</th>
                        <th className="w-7"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {grSortedIndices.map(i => {
                        const row = rows[i]
                        return (
                        <tr key={i} className="border-t border-gray-100 group">
                          <td className="px-2 py-0.5 text-gray-400 font-mono">{i + 1}</td>
                          <td className="px-1 py-0.5">
                            <input
                              type="number" step="any"
                              data-row={i}
                              value={row}
                              onChange={e => updateRow(i, e.target.value)}
                              onKeyDown={e => handleRowKeyDown(e, i)}
                              className="w-full text-xs border border-transparent hover:border-gray-200 focus:border-blue-400 rounded px-1 py-0.5 font-mono focus:outline-none"
                              placeholder="0"
                            />
                          </td>
                          <td className="px-1 py-0.5 text-center">
                            <button onClick={() => removeRow(i)}
                              className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Trash2 size={11} />
                            </button>
                          </td>
                        </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <button onClick={addRow}
                  className="w-full text-[11px] text-blue-600 hover:bg-blue-50 py-1 border-t border-gray-100">
                  + Add row
                </button>
              </div>
              <p className="text-[10px] text-gray-400 mt-1">
                Tab in the last cell adds a row. Enter strictly increasing cumulative system ages.
              </p>
            </div>
          ) : (
            <div>
              <label className={labelCls}>Life Data folio</label>
              {foliosWithData.length === 0 ? (
                <p className="text-xs text-gray-400 border border-dashed border-gray-300 rounded p-2">
                  No folios with failure data. Enter data in the Life Data Analysis module first.
                </p>
              ) : (
                <select
                  value={s.folioId}
                  onChange={e => patch({ folioId: e.target.value })}
                  className={inputCls}
                >
                  <option value="">Select a folio...</option>
                  {foliosWithData.map(f => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({folioTimes(f).length} failures)
                    </option>
                  ))}
                </select>
              )}
              {selectedFolio && (
                <p className="text-[10px] text-gray-500 mt-1">
                  Failure times (state F) are used sorted ascending as cumulative system ages.
                  Suspensions are ignored.
                </p>
              )}
            </div>
          )}

          {/* Total test time */}
          <div>
            <InfoLabel tip="Total accumulated test time at the end of the program. If the test was time-terminated, enter it here; if blank, the last failure time is used (failure-terminated).">
              T (total test time) <span className="text-gray-400">(optional)</span>
            </InfoLabel>
            <input
              type="number"
              step="any"
              value={s.T}
              onChange={e => patch({ T: e.target.value })}
              className={inputCls}
              placeholder="If blank, uses last failure time"
            />
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}

          <button
            onClick={runAnalysis}
            disabled={loading}
            className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium py-2 rounded transition-colors"
          >
            <Play size={12} /> {loading ? 'Computing...' : 'Analyze'}
          </button>
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {!r ? (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <p className="text-lg font-medium">No results yet</p>
                <p className="text-sm mt-1">Enter cumulative failure times and click Analyze</p>
              </div>
            </div>
          ) : (
            <div ref={resultsRef} className="flex-1 overflow-y-auto p-6">
              <div className="flex justify-end">
                <ExportResultsButton getElement={() => resultsRef.current} baseName="growth" />
              </div>
              {/* Results summary */}
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-800 mb-3">
                  {r.model === 'crow-amsaa' ? 'Crow-AMSAA' : 'Duane'} Model Results
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {r.model === 'crow-amsaa' ? (
                    <>
                      <Card label="Beta (shape)" value={fmt(r.beta)} />
                      <Card label="Lambda (scale)" value={fmtSci(r.Lambda)} />
                      <Card label="Growth rate" value={fmt(r.growth_rate)} />
                      <Card label={`MTBF (instantaneous, ${units})`} value={fmtNum(r.mtbf_instantaneous)} accent />
                    </>
                  ) : (
                    <>
                      <Card label="Alpha (growth rate)" value={fmt(r.alpha)} />
                      <Card label="A (intercept)" value={fmtSci(r.A)} />
                      <Card label="R-squared" value={fmtR2(r.r_squared)} />
                      <Card label={`MTBF (instantaneous, ${units})`} value={fmtNum(r.mtbf_instantaneous)} accent />
                    </>
                  )}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                  <Card label={`MTBF (cumulative, ${units})`} value={fmtNum(r.mtbf_cumulative)} />
                  <Card label="Total failures" value={String(r.n_failures)} />
                  <Card label={`Total test time (T, ${units})`} value={fmtNum(r.T)} />
                  {r.CvM != null && <Card label="CvM statistic" value={fmt(r.CvM)} />}
                </div>
              </div>

              {/* Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Cumulative failures plot */}
                <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 400 }}>
                  <Plot
                    data={[
                      {
                        x: r.scatter.t,
                        y: r.scatter.n,
                        mode: 'markers',
                        name: 'Observed',
                        marker: { color: '#ef4444', size: 7 },
                      } as Plotly.Data,
                      {
                        x: r.model_curve.t,
                        y: r.model_curve.n,
                        mode: 'lines',
                        name: 'Fitted model',
                        line: { color: '#3b82f6', width: 2 },
                      } as Plotly.Data,
                    ]}
                    layout={{
                      title: { text: 'Cumulative Failures', font: { size: 13 } },
                      xaxis: { title: { text: `Time (${units})` }, gridcolor: '#e5e7eb' },
                      yaxis: { title: { text: 'Cumulative Failures' }, gridcolor: '#e5e7eb' },
                      margin: { t: 40, r: 20, b: 50, l: 60 },
                      paper_bgcolor: 'white', plot_bgcolor: 'white',
                      legend: { x: 0.02, y: 0.98, font: { size: 10 } },
                      showlegend: true,
                    } as Partial<Plotly.Layout>}
                    config={{ responsive: true }}
                    style={{ width: '100%', height: '100%' }}
                    useResizeHandler
                  />
                </div>

                {/* MTBF plot */}
                <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 400 }}>
                  <Plot
                    data={[
                      {
                        x: r.mtbf_curve.t,
                        y: r.mtbf_curve.cumulative,
                        mode: 'lines',
                        name: 'Cumulative MTBF',
                        line: { color: '#3b82f6', width: 2 },
                      } as Plotly.Data,
                      {
                        x: r.mtbf_curve.t,
                        y: r.mtbf_curve.instantaneous,
                        mode: 'lines',
                        name: 'Instantaneous MTBF',
                        line: { color: '#10b981', width: 2, dash: 'dash' },
                      } as Plotly.Data,
                    ]}
                    layout={{
                      title: { text: 'MTBF vs Time', font: { size: 13 } },
                      xaxis: { title: { text: `Time (${units})` }, gridcolor: '#e5e7eb' },
                      yaxis: { title: { text: `MTBF (${units})` }, gridcolor: '#e5e7eb' },
                      margin: { t: 40, r: 20, b: 50, l: 60 },
                      paper_bgcolor: 'white', plot_bgcolor: 'white',
                      legend: { x: 0.02, y: 0.98, font: { size: 10 } },
                      showlegend: true,
                    } as Partial<Plotly.Layout>}
                    config={{ responsive: true }}
                    style={{ width: '100%', height: '100%' }}
                    useResizeHandler
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  )
}

// --- Formatting helpers ---

function fmt(v: number | undefined | null): string {
  if (v == null) return '--'
  return v.toFixed(4)
}

function fmtSci(v: number | undefined | null): string {
  if (v == null) return '--'
  return v.toExponential(4)
}

function fmtNum(v: number | undefined | null): string {
  if (v == null) return '--'
  return v.toFixed(2)
}

function fmtR2(v: number | undefined | null): string {
  if (v == null) return '--'
  return v.toFixed(4)
}

