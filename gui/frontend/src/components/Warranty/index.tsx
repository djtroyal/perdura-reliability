import { useState, useRef } from 'react'
import Plot from '../shared/ExportablePlot'
import { Play, Plus, Minus } from 'lucide-react'
import {
  convertWarrantyData, forecastWarrantyReturns,
  WarrantyConvertResponse, WarrantyForecastResponse,
} from '../../api/client'
import { useFolioState, useUnits } from '../../store/project'
import FolioBar from '../shared/FolioBar'
import InfoLabel from '../shared/InfoLabel'
import ExportResultsButton from '../shared/ExportResultsButton'

const DISTRIBUTIONS = [
  'Weibull_2P', 'Weibull_3P', 'Lognormal_2P', 'Normal_2P',
  'Exponential_1P', 'Exponential_2P', 'Gamma_2P', 'Gamma_3P',
  'Loglogistic_2P', 'Loglogistic_3P', 'Gumbel_2P', 'Beta_2P',
]

// --- Module state ---

interface WarrantyState {
  // Nevada Chart dimensions
  numRows: number
  numCols: number
  quantities: string[]        // one per row
  returns: string[][]         // returns[row][col]  (upper-triangular)
  nForecastPeriods: string
  distribution: string

  convertResult?: WarrantyConvertResponse | null
  forecastResult?: WarrantyForecastResponse | null
}

const DEFAULT_ROWS = 5
const DEFAULT_COLS = 5

function makeInitialQuantities(n: number): string[] {
  return Array.from({ length: n }, () => '')
}

function makeInitialReturns(rows: number, cols: number): string[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ''))
}

const INITIAL_STATE: WarrantyState = {
  numRows: DEFAULT_ROWS,
  numCols: DEFAULT_COLS,
  quantities: makeInitialQuantities(DEFAULT_ROWS),
  returns: makeInitialReturns(DEFAULT_ROWS, DEFAULT_COLS),
  nForecastPeriods: '3',
  distribution: 'Weibull_2P',
}

/** Cell at (row, col) is valid if return period (col+1) > ship period (row).
 *  Row 0 = ship period 0: valid cols are 0,1,2,...  (col+1 > 0 => all)
 *  Row 1 = ship period 1: valid cols are 1,2,...    (col+1 > 1 => col >= 1)
 *  Row i = ship period i: valid cols are i, i+1,... (col+1 > i => col >= i)
 */
function isCellValid(row: number, col: number): boolean {
  return col >= row
}

export default function Warranty() {
  const [s, setS, folios] = useFolioState<WarrantyState>('warranty', INITIAL_STATE)
  const [units] = useUnits()
  const patch = (p: Partial<WarrantyState>) => setS(prev => ({ ...prev, ...p }))

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  // --- Table manipulation ---

  const addRow = () => {
    const newRow = Array.from({ length: s.numCols }, () => '')
    patch({
      numRows: s.numRows + 1,
      quantities: [...s.quantities, ''],
      returns: [...s.returns, newRow],
    })
  }

  const removeRow = () => {
    if (s.numRows <= 1) return
    patch({
      numRows: s.numRows - 1,
      quantities: s.quantities.slice(0, -1),
      returns: s.returns.slice(0, -1),
    })
  }

  const addCol = () => {
    patch({
      numCols: s.numCols + 1,
      returns: s.returns.map(row => [...row, '']),
    })
  }

  const removeCol = () => {
    if (s.numCols <= 1) return
    patch({
      numCols: s.numCols - 1,
      returns: s.returns.map(row => row.slice(0, -1)),
    })
  }

  const updateQuantity = (row: number, value: string) => {
    const q = [...s.quantities]
    q[row] = value
    patch({ quantities: q })
  }

  const updateReturn = (row: number, col: number, value: string) => {
    const r = s.returns.map(rowArr => [...rowArr])
    r[row][col] = value
    patch({ returns: r })
  }

  // --- Build API payloads ---

  const buildPayload = () => {
    const quantities = s.quantities.map(v => {
      const n = parseFloat(v)
      return isNaN(n) ? 0 : n
    })
    const returns: (number | null)[][] = s.returns.map((row, ri) =>
      row.map((cell, ci) => {
        if (!isCellValid(ri, ci)) return null
        const n = parseFloat(cell)
        return isNaN(n) ? null : n
      }),
    )
    return { quantities, returns }
  }

  // --- Convert ---

  const runConvert = async () => {
    setError(null)
    setLoading(true)
    try {
      const payload = buildPayload()
      const res = await convertWarrantyData(payload)
      patch({ convertResult: res })
    } catch (e: unknown) {
      setError(
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        || 'Error converting warranty data.',
      )
    } finally {
      setLoading(false)
    }
  }

  // --- Forecast ---

  const runForecast = async () => {
    const nForecast = parseInt(s.nForecastPeriods, 10)
    if (isNaN(nForecast) || nForecast < 1) {
      setError('Number of forecast periods must be >= 1.')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const payload = buildPayload()
      const res = await forecastWarrantyReturns({
        ...payload,
        n_forecast_periods: nForecast,
        distribution: s.distribution,
      })
      patch({ convertResult: { failures: res.failures, right_censored: res.right_censored, n_failures: res.n_failures, n_censored: res.n_censored }, forecastResult: res })
    } catch (e: unknown) {
      setError(
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        || 'Error forecasting warranty returns.',
      )
    } finally {
      setLoading(false)
    }
  }

  // --- Style classes ---

  const inputCls = 'w-full text-xs border border-gray-300 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400'
  const labelCls = 'block text-xs font-medium text-gray-700 mb-1'
  const cellCls = 'w-24 text-xs border border-gray-300 rounded px-2 py-1 font-mono text-center focus:outline-none focus:ring-1 focus:ring-blue-400'
  const disabledCellCls = 'w-24 text-xs border border-gray-200 rounded px-2 py-1 font-mono text-center bg-gray-100 text-gray-400 cursor-not-allowed'

  // ========== LEFT PANEL ==========

  const renderLeftPanel = () => (
    <>
      <div>
        <InfoLabel tip="A matrix used to convert warranty return data into failure/censored times. Rows represent shipment lots, columns represent return periods. Only upper-triangular cells are valid (return period must exceed ship period).">Nevada Chart</InfoLabel>
        <p className="text-[10px] text-gray-500">
          Enter shipment quantities and the upper-triangular returns matrix in the main
          area on the right. Rows = ship periods, columns = return periods.
        </p>
      </div>

      {/* Row/Col controls */}
      <div className="flex gap-3">
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-500">Rows:</span>
          <button onClick={removeRow} disabled={s.numRows <= 1}
            className="p-0.5 rounded border border-gray-300 hover:bg-gray-100 disabled:opacity-30 transition-colors">
            <Minus size={10} />
          </button>
          <span className="text-xs font-mono w-4 text-center">{s.numRows}</span>
          <button onClick={addRow}
            className="p-0.5 rounded border border-gray-300 hover:bg-gray-100 transition-colors">
            <Plus size={10} />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-500">Cols:</span>
          <button onClick={removeCol} disabled={s.numCols <= 1}
            className="p-0.5 rounded border border-gray-300 hover:bg-gray-100 disabled:opacity-30 transition-colors">
            <Minus size={10} />
          </button>
          <span className="text-xs font-mono w-4 text-center">{s.numCols}</span>
          <button onClick={addCol}
            className="p-0.5 rounded border border-gray-300 hover:bg-gray-100 transition-colors">
            <Plus size={10} />
          </button>
        </div>
      </div>

      <hr className="border-gray-200" />

      {/* Forecast settings */}
      <div>
        <InfoLabel tip="Number of future time periods to predict warranty returns for, beyond the current data.">Forecast periods</InfoLabel>
        <input
          type="number"
          min="1"
          step="1"
          value={s.nForecastPeriods}
          onChange={e => patch({ nForecastPeriods: e.target.value })}
          className={inputCls}
        />
      </div>

      <div>
        <InfoLabel tip="Assumed life distribution for modeling time-to-failure from the warranty returns data.">Distribution</InfoLabel>
        <select
          value={s.distribution}
          onChange={e => patch({ distribution: e.target.value })}
          className={inputCls}
        >
          {DISTRIBUTIONS.map(d => (
            <option key={d} value={d}>{d.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>

      {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}

      {/* Action buttons */}
      <button onClick={runConvert} disabled={loading}
        className="flex items-center justify-center gap-2 border border-blue-600 text-blue-600 hover:bg-blue-50 disabled:opacity-50 text-xs font-medium py-2 rounded transition-colors">
        <Play size={12} /> {loading ? 'Working...' : 'Convert Only'}
      </button>

      <button onClick={runForecast} disabled={loading}
        className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium py-2 rounded transition-colors">
        <Play size={12} /> {loading ? 'Working...' : 'Analyze'}
      </button>
    </>
  )

  // ========== MAIN CONTENT ==========

  const convertResult = s.convertResult
  const forecastResult = s.forecastResult

  const hasResults = convertResult || forecastResult

  const renderNevadaChart = () => (
    <section data-export-ignore>
      <h3 className="text-sm font-semibold text-gray-800 mb-1">Nevada Chart</h3>
      <p className="text-[10px] text-gray-500 mb-3">
        Each ship/return period spans one unit of project time ({units.replace(/s$/, '')}).
      </p>
      <div className="overflow-auto border border-gray-200 rounded-lg bg-white inline-block max-w-full">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              <th className="px-2 py-1.5 text-[10px] text-gray-500 font-medium bg-gray-50 sticky top-0 border-b border-gray-200 text-left">
                Ship Period
              </th>
              <th className="px-2 py-1.5 text-[10px] text-gray-500 font-medium bg-gray-50 sticky top-0 border-b border-gray-200">
                Qty Shipped
              </th>
              {Array.from({ length: s.numCols }, (_, ci) => (
                <th key={ci} className="px-2 py-1.5 text-[10px] text-gray-500 font-medium bg-gray-50 sticky top-0 border-b border-gray-200">
                  Return Period {ci + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: s.numRows }, (_, ri) => (
              <tr key={ri}>
                <td className="px-2 py-1 text-gray-600 font-medium whitespace-nowrap">Lot {ri + 1}</td>
                <td className="px-1 py-1">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={s.quantities[ri]}
                    onChange={e => updateQuantity(ri, e.target.value)}
                    className={cellCls}
                    placeholder="0"
                  />
                </td>
                {Array.from({ length: s.numCols }, (_, ci) => (
                  <td key={ci} className="px-1 py-1">
                    {isCellValid(ri, ci) ? (
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={s.returns[ri][ci]}
                        onChange={e => updateReturn(ri, ci, e.target.value)}
                        className={cellCls}
                        placeholder="0"
                      />
                    ) : (
                      <input
                        disabled
                        value=""
                        className={disabledCellCls}
                        tabIndex={-1}
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )

  const renderMainContent = () => {
    return (
      <div ref={resultsRef} className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
        {hasResults && (
          <div className="flex justify-end" data-export-ignore>
            <ExportResultsButton getElement={() => resultsRef.current} baseName="warranty" title="Warranty Analysis" />
          </div>
        )}
        {/* Data entry — Nevada chart */}
        {renderNevadaChart()}

        {!hasResults && (
          <p className="text-sm text-gray-400">
            Fill in the Nevada Chart, then click Analyze in the left panel.
          </p>
        )}

        {/* Converted Data Summary */}
        {convertResult && (
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Converted Data</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card label="Failures" value={String(convertResult.n_failures)} />
              <Card label="Right-censored" value={String(convertResult.n_censored)} />
            </div>
          </section>
        )}

        {/* Fit Results */}
        {forecastResult && (
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Fit Results</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card label="Distribution" value={forecastResult.distribution.replace(/_/g, ' ')} accent />
              {Object.entries(forecastResult.params).map(([key, val]) => (
                <Card key={key} label={key} value={typeof val === 'number' ? val.toPrecision(5) : String(val)} />
              ))}
            </div>
          </section>
        )}

        {/* Forecast Table */}
        {forecastResult && forecastResult.forecast.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Forecast Table</h3>
            <div className="overflow-auto border border-gray-200 rounded-lg">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-3 py-2 font-medium text-gray-600">Ship Lot</th>
                    {forecastResult.totals.map((_, pi) => (
                      <th key={pi} className="text-right px-3 py-2 font-medium text-gray-600">
                        Forecast {pi + 1}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {forecastResult.forecast.map((row, ri) => (
                    <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-3 py-1.5 text-gray-700 font-medium">Lot {ri + 1}</td>
                      {row.map((val, ci) => (
                        <td key={ci} className="text-right px-3 py-1.5 font-mono text-gray-800">
                          {val.toFixed(2)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {/* Totals row */}
                  <tr className="bg-blue-50 border-t-2 border-blue-200 font-semibold">
                    <td className="px-3 py-2 text-blue-800">Total</td>
                    {forecastResult.totals.map((total, pi) => (
                      <td key={pi} className="text-right px-3 py-2 font-mono text-blue-800">
                        {total.toFixed(2)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Forecast Chart */}
        {forecastResult && forecastResult.totals.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Forecast Chart</h3>
            <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 400 }}>
              <Plot
                data={[
                  {
                    x: forecastResult.totals.map((_, i) => `Period ${i + 1}`),
                    y: forecastResult.totals,
                    type: 'bar',
                    marker: { color: '#3b82f6' },
                    name: 'Expected Returns',
                  } as Plotly.Data,
                ]}
                layout={{
                  xaxis: { title: { text: `Forecast Period (${units})` }, gridcolor: '#e5e7eb' },
                  yaxis: { title: { text: 'Total Expected Returns' }, gridcolor: '#e5e7eb' },
                  margin: { t: 20, r: 20, b: 50, l: 70 },
                  paper_bgcolor: 'white',
                  plot_bgcolor: 'white',
                  showlegend: false,
                } as Partial<Plotly.Layout>}
                config={{ responsive: true }}
                style={{ width: '100%', height: '100%' }}
                useResizeHandler
              />
            </div>
          </section>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <FolioBar api={folios} />
      {/* Body: left panel + main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel */}
        <div className="w-80 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-4 flex flex-col gap-3">
          {renderLeftPanel()}
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {renderMainContent()}
        </div>
      </div>
    </div>
  )
}

// --- Small shared components ---

function Card({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${accent ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200'}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-semibold ${accent ? 'text-blue-700' : 'text-gray-900'}`}>{value}</p>
    </div>
  )
}
