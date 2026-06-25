import { useState, useRef, useMemo } from 'react'
import Plot from '../shared/ExportablePlot'
import { Play, Download, Trash2 } from 'lucide-react'
import FileUpload from '../shared/FileUpload'
import ResultsTable from '../shared/ResultsTable'
import ExportResultsButton from '../shared/ExportResultsButton'
import {
  fitALT, ALTFitResponse,
  computeSampleSize, SampleSizeRequest, SampleSizeResponse,
  computeAccelerationFactor,
} from '../../api/client'
import { useFolioState, useUnits } from '../../store/project'
import FolioBar from '../shared/FolioBar'
import { ToolTabs } from './toolkit'
import RDTTools from './RDTTools'
import { StepStress, MultiStress, HALT, MarginTest } from './ALTTestTypes'
import { ExpectedFailureTimes, DifferenceDetection, Simulation } from './TestDesignTools'
import {
  Planner, Duration, NoFailures, OneProportion, TwoProportion,
  Sequential, GoF, Degradation, ESS, HASS, BurnIn,
} from './ReliabilityTestingTools'

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
  /** Model the user clicked in the results table to view its life-stress plot
   *  (defaults to the best model when unset). */
  selectedModel?: string
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

// Acceleration-factor models: each maps test/use stress + extra params to an AF.
const AF_MODELS: Record<string, {
  label: string; stressLabel: string
  fields: { key: string; label: string; default: string }[]
}> = {
  arrhenius: { label: 'Arrhenius (temperature)', stressLabel: 'temp (°C)',
    fields: [{ key: 'Ea', label: 'Activation energy Ea (eV)', default: '0.7' }] },
  inverse_power: { label: 'Inverse Power Law (voltage/stress)', stressLabel: 'stress',
    fields: [{ key: 'n', label: 'Exponent n', default: '2' }] },
  eyring: { label: 'Eyring (temperature)', stressLabel: 'temp (°C)',
    fields: [{ key: 'A', label: 'Parameter A', default: '1' }] },
  coffin_manson: { label: 'Coffin-Manson (thermal cycling)', stressLabel: 'ΔT cycle range',
    fields: [{ key: 'n', label: 'Fatigue exponent n', default: '2' }] },
  peck: { label: 'Peck (temperature-humidity)', stressLabel: 'temp (°C)',
    fields: [
      { key: 'Ea', label: 'Activation energy Ea (eV)', default: '0.79' },
      { key: 'n', label: 'Humidity exponent n', default: '2.7' },
      { key: 'RH_test', label: 'Test RH (%)', default: '85' },
      { key: 'RH_use', label: 'Use RH (%)', default: '40' },
    ] },
  norris_landzberg: { label: 'Norris-Landzberg (solder fatigue)', stressLabel: 'ΔT cycle range',
    fields: [
      { key: 'Ea', label: 'Activation energy Ea (eV)', default: '0.122' },
      { key: 'n', label: 'ΔT exponent n', default: '1.9' },
      { key: 'm', label: 'Frequency exponent m', default: '0.333' },
      { key: 'f_test', label: 'Test freq (cycles/day)', default: '48' },
      { key: 'f_use', label: 'Use freq (cycles/day)', default: '2' },
      { key: 'Tmax_test', label: 'Test Tmax (°C)', default: '100' },
      { key: 'Tmax_use', label: 'Use Tmax (°C)', default: '60' },
    ] },
  black: { label: 'Black (electromigration)', stressLabel: 'temp (°C)',
    fields: [
      { key: 'Ea', label: 'Activation energy Ea (eV)', default: '0.7' },
      { key: 'n', label: 'Current-density exponent n', default: '2' },
      { key: 'J_test', label: 'Test current density J', default: '2' },
      { key: 'J_use', label: 'Use current density J', default: '1' },
    ] },
}

function defaultAfParams(model: string): Record<string, string> {
  return Object.fromEntries(AF_MODELS[model].fields.map(f => [f.key, f.default]))
}

function AccelFactorCalc() {
  const [units] = useUnits()
  const [afModel, setAfModel] = useState('arrhenius')
  const [afStressTest, setAfStressTest] = useState('125')
  const [afStressUse, setAfStressUse] = useState('40')
  const [afParams, setAfParams] = useState<Record<string, string>>(defaultAfParams('arrhenius'))
  const [afResult, setAfResult] = useState<{ acceleration_factor: number } | null>(null)
  const [afLoading, setAfLoading] = useState(false)
  const [afError, setAfError] = useState<string | null>(null)

  const selectModel = (m: string) => {
    setAfModel(m)
    setAfParams(defaultAfParams(m))
    setAfResult(null)
  }

  const runAF = async () => {
    setAfError(null)
    setAfLoading(true)
    const params: Record<string, number> = {}
    for (const f of AF_MODELS[afModel].fields) params[f.key] = parseFloat(afParams[f.key])
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
        <select value={afModel} onChange={e => selectModel(e.target.value)}
          className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400">
          {Object.entries(AF_MODELS).map(([k, m]) => (
            <option key={k} value={k}>{m.label}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Test {AF_MODELS[afModel].stressLabel}
          </label>
          <input type="number" step="any" value={afStressTest}
            onChange={e => setAfStressTest(e.target.value)}
            className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Use {AF_MODELS[afModel].stressLabel}
          </label>
          <input type="number" step="any" value={afStressUse}
            onChange={e => setAfStressUse(e.target.value)}
            className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {AF_MODELS[afModel].fields.map(f => (
          <div key={f.key}>
            <label className="block text-[11px] font-medium text-gray-700 mb-1">{f.label}</label>
            <input type="number" step="any" value={afParams[f.key] ?? ''}
              onChange={e => setAfParams(p => ({ ...p, [f.key]: e.target.value }))}
              className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400" />
          </div>
        ))}
      </div>
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
  const resultsRef = useRef<HTMLDivElement>(null)

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
  // Model whose life-stress plot is shown: the user's selection (when it's a
  // model in the current results), otherwise the best model.
  const activeModel =
    (s.selectedModel && result?.results?.some(r => r.Model === s.selectedModel)
      ? s.selectedModel
      : result?.best_model) ?? ''
  const setSelectedModel = (m: string) => patch({ selectedModel: m })
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
  const [topView, setTopView] = useState<'alt' | 'rdt' | 'design' | 'degradation'>('alt')
  const [altTab, setAltTab] = useState<'model' | 'accel' | 'step' | 'multi' | 'halt' | 'margin'>('model')
  const tableRef = useRef<HTMLDivElement>(null)

  // Sort state for the data table (display-only)
  const [altSortCol, setAltSortCol] = useState<string | null>(null)
  const [altSortDir, setAltSortDir] = useState<'asc' | 'desc' | null>(null)
  const toggleAltSort = (col: string) => {
    if (altSortCol !== col) { setAltSortCol(col); setAltSortDir('asc') }
    else if (altSortDir === 'asc') setAltSortDir('desc')
    else { setAltSortCol(null); setAltSortDir(null) }
  }

  // Rows: migrate from legacy comma-separated failure/stress text if present.
  const dataRows: ALTRow[] = s.dataRows ?? (() => {
    const f = failureText.split(/[\s,\n]+/).filter(Boolean)
    const st = stressText.split(/[\s,\n]+/).filter(Boolean)
    const n = Math.max(f.length, st.length, 5)
    return Array.from({ length: n }, (_, i) => ({ time: f[i] ?? '', stress: st[i] ?? '' }))
  })()

  const altSortedIndices = useMemo(() => {
    const indices = dataRows.map((_, i) => i)
    if (!altSortCol || !altSortDir) return indices
    return indices.sort((a, b) => {
      const va = dataRows[a][altSortCol as keyof ALTRow] ?? ''
      const vb = dataRows[b][altSortCol as keyof ALTRow] ?? ''
      const na = parseFloat(va), nb = parseFloat(vb)
      const cmp = (!isNaN(na) && !isNaN(nb)) ? na - nb : va.localeCompare(vb)
      return altSortDir === 'asc' ? cmp : -cmp
    })
  }, [dataRows, altSortCol, altSortDir])

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
      patch({ result: res, selectedModel: undefined })
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
    // Show the plot for the model the user selected in the results table. When
    // the per-model map is present, key into it directly (a model that failed to
    // fit simply has no plot); only fall back to the single best-model plot for
    // responses that predate the per-model map.
    const p = result?.life_stress_plots
      ? result.life_stress_plots[activeModel]
      : result?.life_stress_plot
    if (!p) return []
    // Keep x/y aligned: drop only the (stress, life) pairs whose life is null.
    const linePairs = p.line_stress
      .map((s, i) => [s, p.line_life[i]] as const)
      .filter(([, l]) => l != null)
    const traces: Plotly.Data[] = [
      {
        x: linePairs.map(([s]) => s) as Plotly.Datum[],
        y: linePairs.map(([, l]) => l) as Plotly.Datum[],
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
    <div className="flex flex-col h-full">
      <FolioBar api={folios} />
      {/* Top-level view switcher */}
      <div className="flex items-stretch gap-1 bg-white border-b border-gray-200 px-3">
        {([['alt', 'Accelerated Life Testing'], ['rdt', 'Reliability Demonstration (RDT)'], ['design', 'Test Design & Planning'], ['degradation', 'Degradation & Screening']] as const).map(([v, lbl]) => (
          <button
            key={v}
            onClick={() => setTopView(v)}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              topView === v ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >{lbl}</button>
        ))}
      </div>

      {topView === 'rdt' ? (
        <RDTTools />
      ) : topView === 'design' ? (
        <ToolTabs tools={[
          { id: 'expected', label: 'Expected Failure Times', render: () => <ExpectedFailureTimes /> },
          { id: 'difference', label: 'Difference Detection Matrix', render: () => <DifferenceDetection /> },
          { id: 'simulation', label: 'Simulation', render: () => <Simulation /> },
          { id: 'exp-planner', label: 'Exponential Test Planner', render: () => <Planner /> },
          { id: 'duration', label: 'Test Duration', render: () => <Duration /> },
          { id: 'no-failures', label: 'Zero-Failure Sample Size', render: () => <NoFailures /> },
          { id: 'sequential', label: 'Sequential Sampling', render: () => <Sequential /> },
          { id: 'one-proportion', label: 'One-Sample Proportion', render: () => <OneProportion /> },
          { id: 'two-proportion', label: 'Two-Proportion Test', render: () => <TwoProportion /> },
          { id: 'gof', label: 'Goodness of Fit', render: () => <GoF /> },
        ]} />
      ) : topView === 'degradation' ? (
        <ToolTabs tools={[
          { id: 'degradation', label: 'Degradation Testing', render: () => <Degradation /> },
          { id: 'ess', label: 'ESS Screening', render: () => <ESS /> },
          { id: 'hass', label: 'HASS Screening', render: () => <HASS /> },
          { id: 'burn-in', label: 'Burn-In Design', render: () => <BurnIn /> },
        ]} />
      ) : (
      <div className="flex flex-col flex-1 min-h-0">
      {/* ALT sub-navigation */}
      <div className="flex items-stretch gap-1 bg-gray-50 border-b border-gray-200 px-3 overflow-x-auto">
        {([['model', 'Life-Stress Model'], ['accel', 'Acceleration Factor'], ['step', 'Step / Sequential Stress'], ['multi', 'Multi-Stress'], ['halt', 'HALT'], ['margin', 'Margin Test']] as const).map(([v, lbl]) => (
          <button key={v}
            onClick={() => { setAltTab(v); if (v === 'model') setMode('fitting'); if (v === 'accel') setMode('accel') }}
            className={`px-3 py-1.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
              altTab === v ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>{lbl}</button>
        ))}
      </div>
      {altTab === 'step' ? <StepStress /> :
       altTab === 'multi' ? <MultiStress /> :
       altTab === 'halt' ? <HALT /> :
       altTab === 'margin' ? <MarginTest /> : (
      <div className="flex flex-1 min-h-0">
      {/* Left panel */}
      <div className="w-72 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-4 flex flex-col gap-4">
        {altTab === 'accel' ? (<AccelFactorCalc />) : (<>
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
                    <th className="px-2 py-1 text-left font-medium text-gray-500 select-none cursor-pointer hover:text-blue-600"
                      onClick={() => toggleAltSort('time')}>Time ({units}) {altSortCol === 'time' ? <span className="text-[10px]">{altSortDir === 'asc' ? '▲' : '▼'}</span> : ''}</th>
                    <th className="px-2 py-1 text-left font-medium text-gray-500 select-none cursor-pointer hover:text-blue-600"
                      onClick={() => toggleAltSort('stress')}>Stress {altSortCol === 'stress' ? <span className="text-[10px]">{altSortDir === 'asc' ? '▲' : '▼'}</span> : ''}</th>
                    <th className="w-7"></th>
                  </tr>
                </thead>
                <tbody>
                  {altSortedIndices.map(i => {
                    const row = dataRows[i]
                    return (
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
        </>)}
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {mode === 'fitting' ? (
          result ? (
            <div ref={resultsRef} className="flex-1 overflow-hidden flex flex-col">
              <div className="flex justify-end">
                <ExportResultsButton getElement={() => resultsRef.current} baseName="alt" />
              </div>
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
                  <p className="text-[11px] text-gray-400 mb-2">Click a model to view its life-stress fit.</p>
                  <ResultsTable
                    columns={tableColumns}
                    rows={result.results as Record<string, unknown>[]}
                    rowKey="Model"
                    selectedRow={activeModel}
                    onRowClick={row => setSelectedModel(String(row.Model))}
                    sortable
                  />
                </div>
                <div className="flex-1 p-4">
                  {lifePlotData.length > 0 ? (
                    <Plot
                      data={lifePlotData}
                      layout={{
                        title: `${activeModel} — Life vs Stress`,
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
                      No life-stress plot available.
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <p className="text-lg font-medium">No results yet</p>
                <p className="text-sm mt-1">Enter failure times + stresses and click Run</p>
              </div>
            </div>
          )
        ) : (
          /* Acceleration Factor renders its own inputs + result in the left panel */
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <p className="text-lg font-medium">Acceleration Factor Calculator</p>
              <p className="text-sm mt-1">Enter the model parameters on the left and click Calculate</p>
            </div>
          </div>
        )
        }
      </div>
      </div>
      )}
      </div>
      )}
    </div>
  )
}
