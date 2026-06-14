import { useState, useRef } from 'react'
import Plot from 'react-plotly.js'
import { Play, Download, Trash2 } from 'lucide-react'
import FileUpload from '../shared/FileUpload'
import ResultsTable from '../shared/ResultsTable'
import {
  fitALT, ALTFitResponse,
  computeSampleSize, SampleSizeRequest, SampleSizeResponse,
  computeAccelerationFactor,
} from '../../api/client'
import { useFolioState, useUnits } from '../../store/project'
import FolioBar from '../shared/FolioBar'
import ReliabilityTestingTools from './ReliabilityTestingTools'

const ALL_MODELS = [
  'Weibull_Exponential','Weibull_Eyring','Weibull_Power',
  'Normal_Exponential','Normal_Eyring','Normal_Power',
  'Lognormal_Exponential','Lognormal_Eyring','Lognormal_Power',
  'Exponential_Exponential','Exponential_Eyring','Exponential_Power',
]

const CI_LEVELS = [0.99, 0.98, 0.95, 0.90, 0.85, 0.80, 0.75, 0.70, 0.65, 0.60, 0.55, 0.50]

interface ALTRow { time: string; stress: string }

interface ALTState {
  mode: 'fitting' | 'planner' | 'accel'
  failureText: string          // legacy (kept for migration)
  stressText: string           // legacy (kept for migration)
  dataRows?: ALTRow[]          // tabular failure-time + stress entries
  useLevelStress: string
  selectedModels: string[]
  sortBy: string
  result?: ALTFitResponse | null
  psNonParam: boolean
  psFailures: number
  psR: string
  psCI: number
  psMission: string
  psBeta: string
  psTestTime: string
  psN: string
  psAF: string
  psTable: boolean
  psOC: boolean
  psResult?: SampleSizeResponse | null
}

const INITIAL_ALT: ALTState = {
  mode: 'fitting',
  failureText: '',
  stressText: '',
  dataRows: Array.from({ length: 5 }, () => ({ time: '', stress: '' })),
  useLevelStress: '',
  selectedModels: ALL_MODELS,
  sortBy: 'AICc',
  psNonParam: true,
  psFailures: 0,
  psR: '0.80',
  psCI: 0.90,
  psMission: '2000',
  psBeta: '2.0',
  psTestTime: '1500',
  psN: '',
  psAF: '1',
  psTable: true,
  psOC: true,
}

function AccelFactorCalc() {
  const [units] = useUnits()
  const [afModel, setAfModel] = useState('arrhenius')
  const [afStressTest, setAfStressTest] = useState('125')
  const [afStressUse, setAfStressUse] = useState('40')
  const [afEa, setAfEa] = useState('0.7')
  const [afN, setAfN] = useState('2')
  const [afA, setAfA] = useState('1')
  const [afResult, setAfResult] = useState<{ acceleration_factor: number } | null>(null)
  const [afLoading, setAfLoading] = useState(false)
  const [afError, setAfError] = useState<string | null>(null)

  const runAF = async () => {
    setAfError(null)
    setAfLoading(true)
    const params: Record<string, number> = {}
    if (afModel === 'arrhenius') params.Ea = parseFloat(afEa)
    else if (afModel === 'inverse_power') params.n = parseFloat(afN)
    else if (afModel === 'eyring') params.A = parseFloat(afA)
    try {
      const res = await computeAccelerationFactor({
        model: afModel,
        stress_test: parseFloat(afStressTest),
        stress_use: parseFloat(afStressUse),
        params,
      })
      setAfResult(res)
    } catch (e: unknown) {
      setAfError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error.')
    } finally {
      setAfLoading(false)
    }
  }

  return (
    <>
      <p className="text-xs text-gray-500">
        Compute the acceleration factor between test and use conditions.
      </p>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Model</label>
        <select value={afModel} onChange={e => { setAfModel(e.target.value); setAfResult(null) }}
          className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400">
          <option value="arrhenius">Arrhenius (temperature)</option>
          <option value="inverse_power">Inverse Power Law (voltage/stress)</option>
          <option value="eyring">Eyring (temperature)</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            {afModel === 'inverse_power' ? 'Test stress' : 'Test temp (°C)'}
          </label>
          <input type="number" step="any" value={afStressTest}
            onChange={e => setAfStressTest(e.target.value)}
            className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            {afModel === 'inverse_power' ? 'Use stress' : 'Use temp (°C)'}
          </label>
          <input type="number" step="any" value={afStressUse}
            onChange={e => setAfStressUse(e.target.value)}
            className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400" />
        </div>
      </div>
      {afModel === 'arrhenius' && (
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Activation energy Ea (eV)</label>
          <input type="number" step="0.01" value={afEa} onChange={e => setAfEa(e.target.value)}
            className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400" />
        </div>
      )}
      {afModel === 'inverse_power' && (
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Exponent n</label>
          <input type="number" step="0.1" value={afN} onChange={e => setAfN(e.target.value)}
            className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400" />
        </div>
      )}
      {afModel === 'eyring' && (
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Parameter A</label>
          <input type="number" step="0.1" value={afA} onChange={e => setAfA(e.target.value)}
            className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400" />
        </div>
      )}
      {afError && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{afError}</p>}
      <button onClick={runAF} disabled={afLoading}
        className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium py-2 rounded transition-colors">
        <Play size={12} /> {afLoading ? 'Computing...' : 'Compute AF'}
      </button>
      {afResult && (
        <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
          <p className="text-xs text-gray-500">Acceleration Factor</p>
          <p className="text-2xl font-bold text-blue-700">{afResult.acceleration_factor.toLocaleString()}</p>
          <p className="text-[10px] text-gray-400 mt-1">
            1 {units.replace(/s$/, '')} at test = {afResult.acceleration_factor.toFixed(1)} {units} at use conditions
          </p>
        </div>
      )}
    </>
  )
}

export default function ALT() {
  const [s, setS, folios] = useFolioState<ALTState>('alt', INITIAL_ALT)
  const [units] = useUnits()
  const {
    mode, failureText, stressText, useLevelStress, selectedModels, sortBy,
    psNonParam, psFailures, psR, psCI, psMission, psBeta, psTestTime, psN, psAF,
    psTable, psOC,
  } = s
  const result = s.result ?? null
  const psResult = s.psResult ?? null

  const patch = (p: Partial<ALTState>) => setS(prev => ({ ...prev, ...p }))
  const setMode = (v: ALTState['mode']) => patch({ mode: v })
  const setUseLevelStress = (v: string) => patch({ useLevelStress: v })
  const setSelectedModels = (v: string[] | ((prev: string[]) => string[])) =>
    setS(prev => ({
      ...prev,
      selectedModels: typeof v === 'function' ? v(prev.selectedModels) : v,
    }))
  const setSortBy = (v: string) => patch({ sortBy: v })
  const setResult = (v: ALTFitResponse | null) => patch({ result: v })
  const setPsNonParam = (v: boolean) => patch({ psNonParam: v })
  const setPsFailures = (v: number) => patch({ psFailures: v })
  const setPsR = (v: string) => patch({ psR: v })
  const setPsCI = (v: number) => patch({ psCI: v })
  const setPsMission = (v: string) => patch({ psMission: v })
  const setPsBeta = (v: string) => patch({ psBeta: v })
  const setPsTestTime = (v: string) => patch({ psTestTime: v })
  const setPsN = (v: string) => patch({ psN: v })
  const setPsAF = (v: string) => patch({ psAF: v })
  const setPsTable = (v: boolean) => patch({ psTable: v })
  const setPsOC = (v: boolean) => patch({ psOC: v })
  const setPsResult = (v: SampleSizeResponse | null) => patch({ psResult: v })

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Top-level view: Accelerated Life Testing (life-stress fitting/planning) vs
  // the Reliability Testing tool suite.
  const [topView, setTopView] = useState<'alt' | 'testing'>('alt')
  const tableRef = useRef<HTMLDivElement>(null)

  // Rows: migrate from legacy comma-separated failure/stress text if present.
  const dataRows: ALTRow[] = s.dataRows ?? (() => {
    const f = failureText.split(/[\s,\n]+/).filter(Boolean)
    const st = stressText.split(/[\s,\n]+/).filter(Boolean)
    const n = Math.max(f.length, st.length, 5)
    return Array.from({ length: n }, (_, i) => ({ time: f[i] ?? '', stress: st[i] ?? '' }))
  })()

  const setRows = (next: ALTRow[]) => patch({ dataRows: next, result: null })
  const updateRow = (idx: number, field: keyof ALTRow, val: string) =>
    setRows(dataRows.map((r, i) => i === idx ? { ...r, [field]: val } : r))
  const addRow = () => setRows([...dataRows, { time: '', stress: '' }])
  const removeRow = (idx: number) =>
    setRows(dataRows.length <= 1 ? [{ time: '', stress: '' }] : dataRows.filter((_, i) => i !== idx))
  const handleRowKeyDown = (e: React.KeyboardEvent, idx: number, col: keyof ALTRow) => {
    if (e.key === 'Tab' && !e.shiftKey && col === 'stress' && idx === dataRows.length - 1) {
      e.preventDefault()
      setRows([...dataRows, { time: '', stress: '' }])
      setTimeout(() => {
        tableRef.current
          ?.querySelector<HTMLInputElement>(`[data-row="${idx + 1}"][data-col="time"]`)
          ?.focus()
      }, 0)
    }
  }

  const handleCSV = (failures: number[]) => {
    setRows(failures.map(f => ({ time: String(f), stress: '' })))
  }

  const toggleModel = (m: string) =>
    setSelectedModels(prev =>
      prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m])

  const run = async () => {
    // Only rows with both a valid time and stress are used.
    const paired = dataRows
      .map(r => ({ t: parseFloat(r.time), s: parseFloat(r.stress) }))
      .filter(r => !isNaN(r.t) && !isNaN(r.s))
    const failures = paired.map(r => r.t)
    const stresses = paired.map(r => r.s)
    if (failures.length < 4) { setError('At least 4 paired failure time + stress rows required.'); return }
    const useLevel = parseFloat(useLevelStress)
    setError(null)
    setLoading(true)
    try {
      const res = await fitALT({
        failures,
        failure_stress: stresses,
        use_level_stress: isNaN(useLevel) ? undefined : useLevel,
        models_to_fit: selectedModels.length < ALL_MODELS.length ? selectedModels : undefined,
        sort_by: sortBy,
      })
      setResult(res)
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error running ALT analysis.')
    } finally {
      setLoading(false)
    }
  }

  const runPlanner = async () => {
    const R = parseFloat(psR)
    if (isNaN(R) || R <= 0 || R >= 1) { setError('Reliability must be between 0 and 1.'); return }

    // Infer the method: non-parametric checkbox = Method 1; otherwise
    // 2A (solve samples) if test time is given, 2B (solve test time) if
    // sample size is given.
    let method: SampleSizeRequest['method'] = 'nonparametric'
    const testTime = parseFloat(psTestTime)
    const nSamples = parseInt(psN, 10)
    const hasTestTime = psTestTime.trim() !== '' && !isNaN(testTime)
    const hasN = psN.trim() !== '' && !isNaN(nSamples)
    const mission = parseFloat(psMission)
    const beta = parseFloat(psBeta)

    const af = parseFloat(psAF)

    if (!psNonParam) {
      if (isNaN(af) || af <= 0) { setError('Acceleration factor must be positive.'); return }
      if (isNaN(mission) || mission <= 0 || isNaN(beta) || beta <= 0) {
        setError('Mission time and Weibull β must be positive.'); return
      }
      if (hasTestTime === hasN) {
        setError('Fill exactly one of "Available test time" (solves samples) '
          + 'or "Sample size n" (solves test time).')
        return
      }
      if (hasTestTime) {
        if (testTime <= 0) { setError('Available test time must be positive.'); return }
        method = 'parametric_samples'
      } else {
        if (nSamples < psFailures + 1) {
          setError('Sample size n must be an integer ≥ failures + 1.'); return
        }
        method = 'parametric_time'
      }
    }

    setError(null)
    setLoading(true)
    try {
      const res = await computeSampleSize({
        method,
        failures: psFailures,
        R, CI: psCI,
        mission_time: psNonParam ? undefined : mission,
        beta: psNonParam ? undefined : beta,
        test_time: method === 'parametric_samples' ? testTime * af : undefined,
        n: method === 'parametric_time' ? nSamples : undefined,
        options_table: psTable,
        oc_curve: psOC,
      })
      setPsResult(res)
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error computing sample size.')
    } finally {
      setLoading(false)
    }
  }

  const downloadCSV = () => {
    if (!result) return
    const keys = Object.keys(result.results[0] || {})
    const header = keys.join(',') + '\n'
    const rows = result.results.map(r => keys.map(k => r[k] ?? '').join(',')).join('\n')
    const blob = new Blob([header + rows], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'alt_results.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const lifePlotData = (() => {
    if (!result?.life_stress_plot) return []
    const p = result.life_stress_plot
    const traces: Plotly.Data[] = [
      {
        x: p.line_stress as Plotly.Datum[],
        y: p.line_life.filter(Boolean) as Plotly.Datum[],
        mode: 'lines', name: 'Life-Stress model',
        line: { color: '#3b82f6', width: 2 },
      } as Plotly.Data,
      {
        x: p.scatter_stress as Plotly.Datum[],
        y: p.scatter_life as Plotly.Datum[],
        mode: 'markers', name: 'Observed median life',
        marker: { color: '#ef4444', size: 8, symbol: 'circle' },
      } as Plotly.Data,
    ]
    if (p.use_level_stress && p.use_level_life) {
      traces.push({
        x: [p.use_level_stress, p.use_level_stress] as Plotly.Datum[],
        y: [0, p.use_level_life] as Plotly.Datum[],
        mode: 'lines', name: `Use level (S=${p.use_level_stress})`,
        line: { color: '#10b981', width: 1.5, dash: 'dot' },
      } as Plotly.Data)
    }
    return traces
  })()

  const tableColumns = (result?.results[0]
    ? Object.keys(result.results[0]).map(k => ({ key: k, label: k }))
    : [])

  const ocPlotData = (() => {
    if (!psResult?.oc_curve) return []
    const oc = psResult.oc_curve
    const traces: Record<string, unknown>[] = [
      { x: oc.R, y: oc.P_accept, mode: 'lines', name: 'P(pass test)',
        line: { color: '#3b82f6', width: 2 } },
      { x: [oc.R_demonstrated, oc.R_demonstrated], y: [0, 1], mode: 'lines',
        name: `Demonstrated R = ${oc.R_demonstrated.toFixed(4)}`,
        line: { color: '#ef4444', width: 1.5, dash: 'dash' } },
      { x: [oc.R[0], 1], y: [oc.alpha, oc.alpha], mode: 'lines',
        name: `α = ${oc.alpha.toFixed(2)} (consumer risk)`,
        line: { color: '#9ca3af', width: 1, dash: 'dot' } },
    ]
    return traces
  })()

  const psSummaryCards = (() => {
    if (!psResult) return []
    const cards: { label: string; value: string; accent?: boolean }[] = []
    if (psResult.method === 'parametric_time') {
      cards.push({ label: 'Required test time per unit', value: `${psResult.test_time?.toLocaleString()} ${units}`, accent: true })
      cards.push({ label: 'Sample size (given)', value: `${psResult.n}` })
    } else {
      cards.push({ label: 'Required sample size (n)', value: `${psResult.n}`, accent: true })
    }
    const afVal = parseFloat(psAF)
    if (!isNaN(afVal) && afVal !== 1) cards.push({ label: 'Acceleration factor (AF)', value: `${afVal}` })
    if (psResult.eta != null) cards.push({ label: 'Weibull η (char. life)', value: `${psResult.eta.toLocaleString()} ${units}` })
    if (psResult.R_test != null) cards.push({ label: 'Reliability demonstrated at test time', value: psResult.R_test.toFixed(4) })
    cards.push({ label: 'Allowable failures (f)', value: `${psResult.failures}` })
    cards.push({ label: 'Confidence level', value: `${Math.round(psResult.CI * 100)}%` })
    return cards
  })()

  return (
    <div className="flex flex-col h-[calc(100vh-57px)]">
      <FolioBar api={folios} />
      {/* Top-level view switcher */}
      <div className="flex items-stretch gap-1 bg-white border-b border-gray-200 px-3">
        {([['alt', 'Accelerated Life Testing'], ['testing', 'Reliability Testing']] as const).map(([v, lbl]) => (
          <button
            key={v}
            onClick={() => setTopView(v)}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              topView === v ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >{lbl}</button>
        ))}
      </div>

      {topView === 'testing' ? (
        <ReliabilityTestingTools />
      ) : (
      <div className="flex flex-1 min-h-0">
      {/* Left panel */}
      <div className="w-72 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-4 flex flex-col gap-4">
        <div className="flex gap-2">
          <button
            onClick={() => setMode('fitting')}
            className={`flex-1 py-1.5 text-xs rounded font-medium border transition-colors ${
              mode === 'fitting' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'
            }`}
          >Model Fitting</button>
          <button
            onClick={() => setMode('planner')}
            className={`flex-1 py-1.5 text-xs rounded font-medium border transition-colors ${
              mode === 'planner' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'
            }`}
          >Test Planner</button>
          <button
            onClick={() => setMode('accel')}
            className={`flex-1 py-1.5 text-xs rounded font-medium border transition-colors ${
              mode === 'accel' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'
            }`}
          >Accel. Factor</button>
        </div>

        {mode === 'accel' ? (<AccelFactorCalc />) : mode === 'fitting' ? (<>
        <FileUpload onData={handleCSV} label="Upload CSV (columns: value, type[F/S])" />

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Failure data <span className="text-gray-400">({dataRows.filter(r => r.time.trim() && r.stress.trim()).length} pairs)</span>
          </label>
          <div ref={tableRef} className="border border-gray-200 rounded overflow-hidden">
            <div className="max-h-60 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-2 py-1 text-left font-medium text-gray-500 w-7">#</th>
                    <th className="px-2 py-1 text-left font-medium text-gray-500">Time ({units})</th>
                    <th className="px-2 py-1 text-left font-medium text-gray-500">Stress</th>
                    <th className="w-7"></th>
                  </tr>
                </thead>
                <tbody>
                  {dataRows.map((row, i) => (
                    <tr key={i} className="border-t border-gray-100 group">
                      <td className="px-2 py-0.5 text-gray-400 font-mono">{i + 1}</td>
                      <td className="px-1 py-0.5">
                        <input
                          type="number" step="any"
                          data-row={i} data-col="time"
                          value={row.time}
                          onChange={e => updateRow(i, 'time', e.target.value)}
                          className="w-full text-xs border border-transparent hover:border-gray-200 focus:border-blue-400 rounded px-1 py-0.5 font-mono focus:outline-none"
                          placeholder="1000"
                        />
                      </td>
                      <td className="px-1 py-0.5">
                        <input
                          type="number" step="any"
                          data-row={i} data-col="stress"
                          value={row.stress}
                          onChange={e => updateRow(i, 'stress', e.target.value)}
                          onKeyDown={e => handleRowKeyDown(e, i, 'stress')}
                          className="w-full text-xs border border-transparent hover:border-gray-200 focus:border-blue-400 rounded px-1 py-0.5 font-mono focus:outline-none"
                          placeholder="350"
                        />
                      </td>
                      <td className="px-1 py-0.5 text-center">
                        <button onClick={() => removeRow(i)}
                          className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Trash2 size={11} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button onClick={addRow}
              className="w-full text-[11px] text-blue-600 hover:bg-blue-50 py-1 border-t border-gray-100">
              + Add row
            </button>
          </div>
          <p className="text-[10px] text-gray-400 mt-1">
            Tab in the last Stress cell adds a row. Each row pairs a failure time with its stress level.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1"
            title="The stress level the product actually operates at (e.g. use temperature or voltage). When given, the fitted life-stress model is extrapolated to this level to predict field life and draw the use-level line.">
            Use-level stress <span className="text-gray-400">(optional)</span>
          </label>
          <input
            type="number"
            value={useLevelStress}
            onChange={e => setUseLevelStress(e.target.value)}
            className="w-full text-sm border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
            placeholder="e.g. 300"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Sort by</label>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="AICc">AICc</option>
            <option value="BIC">BIC</option>
          </select>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-gray-700">Models</label>
            <div className="flex gap-1">
              <button onClick={() => setSelectedModels(ALL_MODELS)} className="text-xs text-blue-600 hover:underline">All</button>
              <span className="text-gray-300">|</span>
              <button onClick={() => setSelectedModels([])} className="text-xs text-gray-500 hover:underline">None</button>
            </div>
          </div>
          <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
            {ALL_MODELS.map(m => (
              <label key={m} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                <input type="checkbox" checked={selectedModels.includes(m)}
                  onChange={() => toggleModel(m)} className="rounded text-blue-600" />
                {m}
              </label>
            ))}
          </div>
        </div>

        {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}

        <button
          onClick={run}
          disabled={loading}
          className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2 rounded transition-colors"
        >
          <Play size={14} />
          {loading ? 'Running...' : 'Run ALT Analysis'}
        </button>
        </>) : (<>
        {/* Planner sidebar — single consolidated screen */}
        <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer border border-gray-200 rounded px-3 py-2 bg-gray-50">
          <input type="checkbox" checked={psNonParam}
            onChange={e => setPsNonParam(e.target.checked)}
            className="rounded text-blue-600" />
          <span>
            <span className="font-medium block">Non-parametric (Method 1)</span>
            <span className="text-[10px] text-gray-500">Solve sample size from the binomial equation only</span>
          </span>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Allowable failures (f)</label>
            <select value={psFailures} onChange={e => setPsFailures(Number(e.target.value))}
              className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400">
              {Array.from({ length: 16 }, (_, i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Confidence level</label>
            <select value={psCI} onChange={e => setPsCI(Number(e.target.value))}
              className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400">
              {CI_LEVELS.map(c => <option key={c} value={c}>{Math.round(c * 100)}%</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1"
            title="The reliability you must demonstrate at the stated confidence level (e.g. R = 0.90 means 90% of units survive the mission). Drives the required sample size or test time.">
            Reliability requirement (R)
          </label>
          <input type="text" value={psR} onChange={e => setPsR(e.target.value)}
            className="w-full text-sm border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
            placeholder="0.80" />
        </div>

        {!psNonParam && (<>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Mission time</label>
              <input type="text" value={psMission} onChange={e => setPsMission(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                placeholder="2000" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Weibull β</label>
              <input type="text" value={psBeta} onChange={e => setPsBeta(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                placeholder="2.0" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1"
              title="Ratio of life at use conditions to life at test conditions. The required test time per unit is divided by AF, so a higher AF means a shorter accelerated test demonstrates the same reliability.">
              Acceleration factor (AF)
            </label>
            <input type="text" value={psAF} onChange={e => setPsAF(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="1.0" />
            <p className="text-[10px] text-gray-400 mt-0.5">
              Effective test time = AF × actual test time
            </p>
          </div>

          <div className="border border-gray-200 rounded p-2 flex flex-col gap-2">
            <p className="text-[10px] text-gray-500">
              Fill <span className="font-medium">one</span> of the following —
              the other is solved for:
            </p>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Available test time <span className="text-gray-400">(solves samples — 2A)</span>
              </label>
              <input type="text" value={psTestTime} onChange={e => setPsTestTime(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                placeholder="e.g. 1500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Sample size (n) <span className="text-gray-400">(solves test time — 2B)</span>
              </label>
              <input type="text" value={psN} onChange={e => setPsN(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                placeholder="e.g. 19" />
            </div>
          </div>
        </>)}

        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
            <input type="checkbox" checked={psTable} onChange={e => setPsTable(e.target.checked)} className="rounded text-blue-600" />
            Show options table (f = 0…15)
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
            <input type="checkbox" checked={psOC} onChange={e => setPsOC(e.target.checked)} className="rounded text-blue-600" />
            Show OC curve
          </label>
        </div>

        {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}

        <button
          onClick={runPlanner}
          disabled={loading}
          className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2 rounded transition-colors"
        >
          <Play size={14} />
          {loading ? 'Computing...' : 'Calculate'}
        </button>
        </>)}
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {mode === 'fitting' ? (
          result ? (
            <>
              <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between">
                <p className="text-sm text-gray-600">
                  Best model: <span className="font-semibold text-green-700">{result.best_model}</span>
                </p>
                <button onClick={downloadCSV}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 border border-gray-200 px-2 py-1 rounded">
                  <Download size={12} /> Export CSV
                </button>
              </div>
              <div className="flex-1 overflow-hidden flex">
                <div className="w-96 flex-shrink-0 border-r border-gray-200 overflow-y-auto p-3">
                  <ResultsTable
                    columns={tableColumns}
                    rows={result.results as Record<string, unknown>[]}
                    rowKey="Model"
                  />
                </div>
                <div className="flex-1 p-4">
                  {lifePlotData.length > 0 ? (
                    <Plot
                      data={lifePlotData}
                      layout={{
                        title: `${result.best_model} — Life vs Stress`,
                        xaxis: { title: { text: 'Stress' }, gridcolor: '#e5e7eb' },
                        yaxis: { title: { text: `Characteristic Life (${units})` }, gridcolor: '#e5e7eb' },
                        margin: { t: 40, r: 20, b: 50, l: 70 },
                        paper_bgcolor: 'white', plot_bgcolor: 'white',
                      } as any}
                      config={{ responsive: true }}
                      style={{ width: '100%', height: '100%' }}
                      useResizeHandler
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                      No life-stress plot available (set a use-level stress for full plot)
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <p className="text-lg font-medium">No results yet</p>
                <p className="text-sm mt-1">Enter failure times + stresses and click Run</p>
              </div>
            </div>
          )
        ) : (
          /* Planner results area */
          psResult ? (
            <div className="flex-1 overflow-y-auto p-6">
              {/* Summary cards */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
                {psSummaryCards.map(c => (
                  <div key={c.label} className={`rounded-lg border p-3 ${c.accent ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200'}`}>
                    <p className="text-xs text-gray-500">{c.label}</p>
                    <p className={`text-lg font-semibold ${c.accent ? 'text-blue-700' : 'text-gray-900'}`}>{c.value}</p>
                  </div>
                ))}
              </div>

              {/* Options table */}
              {psResult.options_table && (
                <div className="mb-6">
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Options Table (f = 0…15)</h3>
                  <div className="overflow-x-auto border border-gray-200 rounded-lg">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Failures (f)</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">
                            {psResult.method === 'parametric_time' ? 'Test Time' : 'Sample Size (n)'}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {psResult.options_table.map((row, i) => (
                          <tr key={i} className={`border-t border-gray-100 ${row.f === psResult.failures ? 'bg-blue-50 font-semibold' : ''}`}>
                            <td className="px-3 py-1.5">{row.f}</td>
                            <td className="px-3 py-1.5">
                              {psResult.method === 'parametric_time'
                                ? (row.test_time != null ? row.test_time.toLocaleString() : '—')
                                : (row.n != null ? row.n : '—')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* OC Curve */}
              {psResult.oc_curve && ocPlotData.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Operating Characteristic Curve</h3>
                  <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 350 }}>
                    <Plot
                      data={ocPlotData as Plotly.Data[]}
                      layout={{
                        xaxis: { title: { text: 'True Reliability' }, range: [0.5, 1], gridcolor: '#e5e7eb' },
                        yaxis: { title: { text: 'P(pass test)' }, range: [0, 1.05], gridcolor: '#e5e7eb' },
                        margin: { t: 20, r: 20, b: 50, l: 60 },
                        paper_bgcolor: 'white', plot_bgcolor: 'white',
                        legend: { x: 0.02, y: 0.98, font: { size: 10 } },
                        showlegend: true,
                      } as any}
                      config={{ responsive: true }}
                      style={{ width: '100%', height: '100%' }}
                      useResizeHandler
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <p className="text-lg font-medium">Reliability Demonstration Test Planner</p>
                <p className="text-sm mt-1">Configure parameters and click Calculate</p>
              </div>
            </div>
          )
        )}
      </div>
      </div>
      )}
    </div>
  )
}
