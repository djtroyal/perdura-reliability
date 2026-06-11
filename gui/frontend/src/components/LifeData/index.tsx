import { useState, useRef } from 'react'
import Plot from 'react-plotly.js'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlotlyLayout = any
import { Play, Download, Plus, Trash2, Upload, X, GitCompare, Dices } from 'lucide-react'
import Papa from 'papaparse'
import ResultsTable from '../shared/ResultsTable'
import {
  fitDistributions, fitNonparametric, generateSamples, getSpecCurves,
  compareFolios,
  FitResponse, NonparametricResponse, SpecCurvesResponse, CompareResponse,
} from '../../api/client'
import { useModuleState } from '../../store/project'

const ALL_DISTS = [
  'Weibull_2P','Weibull_3P','Exponential_1P','Exponential_2P',
  'Normal_2P','Lognormal_2P','Lognormal_3P',
  'Gamma_2P','Gamma_3P','Loglogistic_2P','Loglogistic_3P',
  'Beta_2P','Gumbel_2P',
]

// 2-parameter distributions support likelihood contour comparison
const TWO_P_DISTS = ['Weibull_2P','Normal_2P','Lognormal_2P','Gamma_2P',
                     'Loglogistic_2P','Beta_2P','Gumbel_2P']

const DIST_PARAM_FIELDS: Record<string, string[]> = {
  Weibull_2P: ['alpha', 'beta'], Weibull_3P: ['alpha', 'beta', 'gamma'],
  Exponential_1P: ['Lambda'], Exponential_2P: ['Lambda', 'gamma'],
  Normal_2P: ['mu', 'sigma'],
  Lognormal_2P: ['mu', 'sigma'], Lognormal_3P: ['mu', 'sigma', 'gamma'],
  Gamma_2P: ['alpha', 'beta'], Gamma_3P: ['alpha', 'beta', 'gamma'],
  Loglogistic_2P: ['alpha', 'beta'], Loglogistic_3P: ['alpha', 'beta', 'gamma'],
  Beta_2P: ['alpha', 'beta'], Gumbel_2P: ['mu', 'sigma'],
}

const PARAM_DEFAULTS: Record<string, string> = {
  alpha: '100', beta: '2', gamma: '0', mu: '100', sigma: '20', Lambda: '0.01',
}

const FOLIO_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
                      '#ec4899', '#14b8a6', '#6366f1']

const CURVE_TABS = ['PDF', 'CDF', 'SF', 'HF'] as const
type CurveTab = typeof CURVE_TABS[number]
const VIEW_TABS = ['Probability', ...CURVE_TABS] as const
type ViewTab = typeof VIEW_TABS[number]

interface DataRow {
  key: string
  id: string
  time: string
  state: 'F' | 'S'
}

interface SpecState {
  distribution: string
  params: Record<string, string>
  n: string
  seed: string
}

interface Folio {
  id: string
  name: string
  rows: DataRow[]
  method: 'MLE' | 'LS'
  ci: number
  ciText: string
  selectedDists: string[]
  analysisMode: 'parametric' | 'nonparametric'
  npMethod: 'KM' | 'NA'
  dataSource: 'table' | 'spec'
  spec: SpecState
  selectedDist?: string | null
  result?: FitResponse | null
  npResult?: NonparametricResponse | null
  specResult?: SpecCurvesResponse | null
}

interface CompareState {
  folioIds: string[]
  distribution: string
  ciText: string
  result?: CompareResponse | null
}

interface LifeDataState {
  folios: Folio[]
  activeId: string // folio id or 'compare'
  folioSeq: number
  compare: CompareState
}

let keyCounter = 0
const makeKey = () => `k${Date.now().toString(36)}${++keyCounter}`
const newRow = (): DataRow => ({ key: makeKey(), id: '', time: '', state: 'F' })

const defaultSpec = (): SpecState => ({
  distribution: 'Weibull_2P',
  params: { alpha: '100', beta: '2' },
  n: '20',
  seed: '',
})

const makeFolio = (seq: number): Folio => ({
  id: `folio${seq}`,
  name: `Folio ${seq}`,
  rows: Array.from({ length: 5 }, newRow),
  method: 'MLE',
  ci: 0.95,
  ciText: '0.95',
  selectedDists: ALL_DISTS,
  analysisMode: 'parametric',
  npMethod: 'KM',
  dataSource: 'table',
  spec: defaultSpec(),
})

const INITIAL_STATE: LifeDataState = {
  folios: [makeFolio(1)],
  activeId: 'folio1',
  folioSeq: 1,
  compare: { folioIds: [], distribution: 'Weibull_2P', ciText: '0.95' },
}

const fmt = (v: number | null | undefined) =>
  v == null ? '—'
    : (Math.abs(v) !== 0 && (Math.abs(v) >= 1e4 || Math.abs(v) < 1e-3))
      ? v.toExponential(3) : v.toFixed(4)

export default function LifeData() {
  const [state, setState] = useModuleState<LifeDataState>('lifeData', INITIAL_STATE)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Single-screen plot view: probability plot or a distribution curve
  const [view, setView] = useState<ViewTab>('Probability')

  const fileRef = useRef<HTMLInputElement>(null)
  const tableRef = useRef<HTMLDivElement>(null)

  const folio = state.folios.find(f => f.id === state.activeId) ?? state.folios[0]
  const isCompare = state.activeId === 'compare'

  const setFolio = (id: string, patch: Partial<Folio> | ((f: Folio) => Partial<Folio>)) =>
    setState(s => ({
      ...s,
      folios: s.folios.map(f => f.id === id
        ? { ...f, ...(typeof patch === 'function' ? patch(f) : patch) } : f),
    }))

  const patchActive = (patch: Partial<Folio> | ((f: Folio) => Partial<Folio>)) =>
    setFolio(folio.id, patch)

  // --- folio tab management ---

  const addFolio = () => {
    setState(s => {
      const seq = s.folioSeq + 1
      const f = makeFolio(seq)
      return { ...s, folios: [...s.folios, f], activeId: f.id, folioSeq: seq }
    })
    setError(null)
  }

  const closeFolio = (id: string) => {
    setState(s => {
      if (s.folios.length <= 1) return s
      const folios = s.folios.filter(f => f.id !== id)
      return {
        ...s,
        folios,
        activeId: s.activeId === id ? folios[0].id : s.activeId,
        compare: { ...s.compare, folioIds: s.compare.folioIds.filter(x => x !== id) },
      }
    })
  }

  const renameFolio = (id: string) => {
    const f = state.folios.find(x => x.id === id)
    if (!f) return
    const name = window.prompt('Folio name:', f.name)
    if (name?.trim()) setFolio(id, { name: name.trim() })
  }

  // --- data table ---

  const updateRow = (idx: number, field: 'id' | 'time' | 'state', value: string) =>
    patchActive(f => ({
      rows: f.rows.map((r, i) => i === idx ? { ...r, [field]: value } : r),
    }))

  const addRow = () => patchActive(f => ({ rows: [...f.rows, newRow()] }))

  const removeRow = (idx: number) =>
    patchActive(f => f.rows.length <= 1 ? {} : { rows: f.rows.filter((_, i) => i !== idx) })

  // Tab on the last row's Time cell appends a new row (state defaults to F)
  const handleTimeKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key === 'Tab' && !e.shiftKey && idx === folio.rows.length - 1) {
      e.preventDefault()
      addRow()
      setTimeout(() => {
        tableRef.current
          ?.querySelector<HTMLInputElement>(`[data-row="${idx + 1}"][data-col="time"]`)
          ?.focus()
      }, 0)
    }
  }

  const loadRows = (data: DataRow[]) => {
    const padded = data.length < 3
      ? [...data, ...Array.from({ length: 3 - data.length }, newRow)]
      : data
    patchActive({ rows: padded, dataSource: 'table' })
  }

  const handleCSV = (file: File) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: ({ data }) => {
        const keys = Object.keys(data[0] || {})
        const timeKey = keys.find(k => /value|time|t|failure/i.test(k)) || keys[0]
        const typeKey = keys.find(k => /type|status|state|cens/i.test(k))
        const idKey = keys.find(k => /^id$|^name$|^unit$|^sn$|^serial/i.test(k))
        const imported: DataRow[] = []
        for (const row of data) {
          const val = row[timeKey]?.trim()
          if (!val || isNaN(parseFloat(val))) continue
          const rawType = typeKey ? row[typeKey]?.trim().toUpperCase() : 'F'
          const st: 'F' | 'S' = (rawType === 'S' || rawType === 'C' || rawType === '0') ? 'S' : 'F'
          imported.push({ key: makeKey(), id: idKey ? row[idKey]?.trim() ?? '' : '', time: val, state: st })
        }
        if (imported.length > 0) loadRows(imported)
      },
    })
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text/plain').trim()
    if (!text) return
    const lines = text.split(/\r?\n/).filter(l => l.trim())
    if (lines.length < 2) return
    const sep = lines[0].includes('\t') ? '\t' : ','
    const cols = lines[0].split(sep).map(c => c.trim().toLowerCase())
    const hasHeader = cols.some(c => /time|value|state|type|id|failure/i.test(c))
    const dataLines = hasHeader ? lines.slice(1) : lines
    if (dataLines.length === 0) return

    const timeIdx = hasHeader ? cols.findIndex(c => /time|value|t|failure/.test(c)) : 0
    const stateIdx = hasHeader ? cols.findIndex(c => /state|type|status|cens/.test(c)) : -1
    const idIdx = hasHeader ? cols.findIndex(c => /^id$|^name$|^unit$|^sn$|^serial/.test(c)) : -1

    const parsed: DataRow[] = []
    for (const line of dataLines) {
      const cells = line.split(sep).map(c => c.trim())
      const val = cells[timeIdx >= 0 ? timeIdx : 0]
      if (!val || isNaN(parseFloat(val))) continue
      const rawState = stateIdx >= 0 ? cells[stateIdx]?.toUpperCase() : 'F'
      const st: 'F' | 'S' = (rawState === 'S' || rawState === 'C' || rawState === '0') ? 'S' : 'F'
      parsed.push({ key: makeKey(), id: idIdx >= 0 ? cells[idIdx] ?? '' : '', time: val, state: st })
    }
    if (parsed.length > 0) {
      e.preventDefault()
      loadRows(parsed)
    }
  }

  const folioData = (f: Folio) => {
    const failures: number[] = []
    const rc: number[] = []
    for (const r of f.rows) {
      const t = parseFloat(r.time)
      if (isNaN(t) || t <= 0) continue
      if (r.state === 'S') rc.push(t)
      else failures.push(t)
    }
    return { failures, rc }
  }

  // --- analysis actions ---

  const run = async () => {
    const { failures, rc } = folioData(folio)
    if (failures.length < 2) {
      setError('Enter at least 2 failure times.')
      return
    }
    setError(null)
    setLoading(true)
    try {
      if (folio.analysisMode === 'parametric') {
        const res = await fitDistributions({
          failures,
          right_censored: rc.length ? rc : undefined,
          distributions_to_fit: folio.selectedDists.length < ALL_DISTS.length
            ? folio.selectedDists : undefined,
          method: folio.method,
          CI: folio.ci,
        })
        patchActive({ result: res, selectedDist: res.best_distribution, specResult: null, npResult: null })
        setView('Probability')
      } else {
        const res = await fitNonparametric({
          failures,
          right_censored: rc.length ? rc : undefined,
          method: folio.npMethod,
        })
        patchActive({ npResult: res, specResult: null, result: null })
      }
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error running analysis.')
    } finally {
      setLoading(false)
    }
  }

  const specParamsNumeric = (): Record<string, number> | null => {
    const out: Record<string, number> = {}
    for (const p of DIST_PARAM_FIELDS[folio.spec.distribution]) {
      const v = parseFloat(folio.spec.params[p] ?? '')
      if (isNaN(v)) { setError(`Invalid value for ${p}.`); return null }
      out[p] = v
    }
    return out
  }

  const showSpecModel = async () => {
    const params = specParamsNumeric()
    if (!params) return
    setError(null)
    setLoading(true)
    try {
      const res = await getSpecCurves(folio.spec.distribution, params)
      patchActive({ specResult: res, result: null, npResult: null })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error computing model.')
    } finally {
      setLoading(false)
    }
  }

  const generateMonteCarlo = async () => {
    const params = specParamsNumeric()
    if (!params) return
    const n = parseInt(folio.spec.n, 10)
    if (isNaN(n) || n < 2 || n > 10000) { setError('Sample count must be 2–10000.'); return }
    const seed = parseInt(folio.spec.seed, 10)
    setError(null)
    setLoading(true)
    try {
      const res = await generateSamples({
        distribution: folio.spec.distribution,
        params, n,
        seed: isNaN(seed) ? undefined : seed,
      })
      patchActive({
        rows: res.samples.map(s => ({
          key: makeKey(), id: '', time: String(s), state: 'F' as const,
        })),
        dataSource: 'table',
      })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error generating samples.')
    } finally {
      setLoading(false)
    }
  }

  const runCompare = async () => {
    const ci = parseFloat(state.compare.ciText)
    if (isNaN(ci) || ci <= 0 || ci >= 1) { setError('CI must be between 0 and 1.'); return }
    const selected = state.folios.filter(f => state.compare.folioIds.includes(f.id))
    if (selected.length < 2) { setError('Select at least 2 folios to compare.'); return }
    const payload = []
    for (const f of selected) {
      const { failures, rc } = folioData(f)
      if (failures.length < 2) {
        setError(`Folio "${f.name}" needs at least 2 failure times.`)
        return
      }
      payload.push({ name: f.name, failures, right_censored: rc.length ? rc : undefined })
    }
    setError(null)
    setLoading(true)
    try {
      const res = await compareFolios({
        folios: payload,
        distribution: state.compare.distribution,
        CI: ci,
      })
      setState(s => ({ ...s, compare: { ...s.compare, result: res } }))
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error comparing folios.')
    } finally {
      setLoading(false)
    }
  }

  const downloadCSV = () => {
    const res = folio.result
    if (!res) return
    const header = 'Distribution,AICc,BIC,AD,LogLik\n'
    const lines = res.results.map(r =>
      `${r.Distribution},${r.AICc ?? ''},${r.BIC ?? ''},${r.AD ?? ''},${r.LogLik}`
    ).join('\n')
    const blob = new Blob([header + lines], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${folio.name}_fit_results.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  // --- plot builders (active folio) ---

  const fitResult = folio.result
  const ciPct = Math.round((fitResult?.CI ?? folio.ci) * 100)
  const activeDist = folio.selectedDist ?? fitResult?.best_distribution ?? ''
  const activePlot = fitResult?.plots?.[activeDist]

  const probPlotData = (() => {
    if (!activePlot?.probability) return []
    const p = activePlot.probability
    const traces: Record<string, unknown>[] = []
    if (p.line_upper && p.line_lower) {
      traces.push({ x: p.line_x, y: p.line_upper, mode: 'lines', line: { width: 0 },
        showlegend: false, hoverinfo: 'skip' })
      traces.push({ x: p.line_x, y: p.line_lower, mode: 'lines', name: `${ciPct}% CI`,
        fill: 'tonexty', fillcolor: 'rgba(239,68,68,0.15)', line: { width: 0 }, hoverinfo: 'skip' })
    }
    traces.push({ x: p.scatter_x, y: p.scatter_y, mode: 'markers', name: 'Data',
      marker: { color: '#3b82f6', size: 6 } })
    traces.push({ x: p.line_x, y: p.line_y, mode: 'lines', name: 'Fitted',
      line: { color: '#ef4444', width: 2 } })
    return traces
  })()

  const probLayout = activePlot?.probability ? {
    xaxis: { title: { text: activePlot.probability.x_label }, gridcolor: '#e5e7eb' },
    yaxis: { title: { text: activePlot.probability.y_label }, gridcolor: '#e5e7eb' },
    margin: { t: 30, r: 20, b: 50, l: 60 },
    paper_bgcolor: 'white', plot_bgcolor: 'white',
    showlegend: true, legend: { x: 0.02, y: 0.98 },
  } : {}

  const curveTab: CurveTab = view === 'Probability' ? 'CDF' : view
  const curveKey = curveTab.toLowerCase() as 'pdf' | 'cdf' | 'sf' | 'hf'
  const curveSource = folio.specResult?.curves ?? activePlot?.curves
  const curvePlotData = (() => {
    if (!curveSource) return []
    const c = curveSource
    const dyn = c as unknown as Record<string, number[] | undefined>
    const traces: Record<string, unknown>[] = []
    const lower = dyn[`${curveKey}_lower`]
    const upper = dyn[`${curveKey}_upper`]
    if ((curveKey === 'sf' || curveKey === 'cdf') && lower && upper) {
      traces.push({ x: c.x, y: upper, mode: 'lines', line: { width: 0 },
        showlegend: false, hoverinfo: 'skip' })
      traces.push({ x: c.x, y: lower, mode: 'lines', name: `${ciPct}% CI`,
        fill: 'tonexty', fillcolor: 'rgba(59,130,246,0.15)', line: { width: 0 }, hoverinfo: 'skip' })
    }
    traces.push({
      x: c.x, y: dyn[curveKey], mode: 'lines',
      line: { color: '#3b82f6', width: 2 }, name: curveTab,
    })
    return traces
  })()

  const curveLayout: PlotlyLayout = {
    xaxis: { title: { text: 'Time' }, gridcolor: '#e5e7eb' },
    yaxis: { title: { text: curveTab }, gridcolor: '#e5e7eb' },
    margin: { t: 30, r: 20, b: 50, l: 60 },
    paper_bgcolor: 'white', plot_bgcolor: 'white',
  }

  const npResult = folio.npResult
  const npPlotData = (() => {
    if (!npResult) return []
    const isKM = npResult.method === 'Kaplan-Meier'
    const yKey = isKM ? 'SF' : 'CHF'
    const yLabel = isKM ? 'Survival Function' : 'Cumulative Hazard'
    return [
      {
        x: npResult.time, y: npResult[yKey as keyof typeof npResult] as number[],
        mode: 'lines', name: yLabel, line: { color: '#3b82f6', width: 2, shape: 'hv' as const },
      },
      {
        x: npResult.time, y: npResult.CI_upper,
        mode: 'lines', name: '95% CI Upper',
        line: { color: '#93c5fd', width: 1, dash: 'dash' as const, shape: 'hv' as const },
      },
      {
        x: npResult.time, y: npResult.CI_lower,
        mode: 'lines', name: '95% CI Lower', fill: 'tonexty' as const,
        fillcolor: 'rgba(147,197,253,0.2)',
        line: { color: '#93c5fd', width: 1, dash: 'dash' as const, shape: 'hv' as const },
      },
    ]
  })()

  const tableColumns = [
    { key: 'Distribution', label: 'Distribution' },
    { key: 'AICc', label: 'AICc' },
    { key: 'BIC', label: 'BIC' },
    { key: 'AD', label: 'AD' },
    { key: 'LogLik', label: 'Log-Lik' },
  ]

  const PARAM_NAMES = ['alpha', 'beta', 'gamma', 'mu', 'sigma', 'Lambda']
  const selectedParams = (() => {
    if (!fitResult) return null
    const row = fitResult.results.find(r => r.Distribution === activeDist)
    if (!row?.params) return null
    const p = row.params
    const prows = PARAM_NAMES.filter(n => p[n] != null).map(n => ({
      name: n,
      value: p[n] as number,
      se: (p[`${n}_se`] ?? null) as number | null,
      lower: (p[`${n}_lower`] ?? null) as number | null,
      upper: (p[`${n}_upper`] ?? null) as number | null,
    }))
    return { dist: row.Distribution, rows: prows }
  })()

  // --- compare plot ---

  const compareResult = state.compare.result
  const contourData = (() => {
    if (!compareResult) return []
    const traces: Record<string, unknown>[] = []
    compareResult.folios.forEach((f, i) => {
      const color = FOLIO_COLORS[i % FOLIO_COLORS.length]
      if (!f.contour) return
      traces.push({
        type: 'contour',
        x: f.contour.x, y: f.contour.y, z: f.contour.nll,
        contours: { start: f.contour.level, end: f.contour.level, size: 1,
                    coloring: 'lines' },
        showscale: false,
        line: { color, width: 2 },
        name: f.name,
        showlegend: true,
        hoverinfo: 'skip',
      })
      if (f.contour.point[0] != null) {
        traces.push({
          type: 'scatter',
          x: [f.contour.point[0]], y: [f.contour.point[1]],
          mode: 'markers', marker: { color, size: 9, symbol: 'x' },
          name: `${f.name} MLE`, showlegend: false,
          hovertemplate: `${f.name}<br>${f.contour.x_name}=%{x:.4g}<br>${f.contour.y_name}=%{y:.4g}<extra></extra>`,
        })
      }
    })
    return traces
  })()
  const contourAxes = compareResult?.folios.find(f => f.contour)?.contour

  // ==========================================================================

  return (
    <div className="flex flex-col h-[calc(100vh-57px)]">
      {/* Folio tab bar */}
      <div className="bg-white border-b border-gray-200 px-4 pt-1.5 flex items-end gap-1">
        {state.folios.map(f => (
          <div key={f.id}
            onClick={() => { setState(s => ({ ...s, activeId: f.id })); setError(null) }}
            onDoubleClick={() => renameFolio(f.id)}
            className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-t border border-b-0 cursor-pointer select-none transition-colors ${
              state.activeId === f.id
                ? 'bg-gray-50 border-gray-300 text-blue-700 font-medium'
                : 'bg-white border-transparent text-gray-500 hover:text-gray-700'
            }`}
            title="Double-click to rename"
          >
            {f.name}
            {state.folios.length > 1 && (
              <button
                onClick={e => { e.stopPropagation(); closeFolio(f.id) }}
                className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"
              ><X size={11} /></button>
            )}
          </div>
        ))}
        <button onClick={addFolio} title="New folio"
          className="px-2 py-1.5 text-gray-400 hover:text-blue-600">
          <Plus size={14} />
        </button>
        <div className="flex-1" />
        <button
          onClick={() => { setState(s => ({ ...s, activeId: 'compare' })); setError(null) }}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-t border border-b-0 transition-colors ${
            isCompare
              ? 'bg-gray-50 border-gray-300 text-blue-700 font-medium'
              : 'bg-white border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <GitCompare size={12} /> Compare Folios
        </button>
      </div>

      {isCompare ? (
        /* ================= Compare view ================= */
        <div className="flex flex-1 overflow-hidden">
          <div className="w-80 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-4 flex flex-col gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Folios to compare</label>
              <div className="flex flex-col gap-1">
                {state.folios.map(f => {
                  const { failures, rc } = folioData(f)
                  return (
                    <label key={f.id} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                      <input type="checkbox"
                        checked={state.compare.folioIds.includes(f.id)}
                        onChange={() => setState(s => ({
                          ...s,
                          compare: {
                            ...s.compare,
                            folioIds: s.compare.folioIds.includes(f.id)
                              ? s.compare.folioIds.filter(x => x !== f.id)
                              : [...s.compare.folioIds, f.id],
                          },
                        }))}
                        className="rounded text-blue-600" />
                      {f.name}
                      <span className="text-gray-400">({failures.length}F {rc.length}S)</span>
                    </label>
                  )
                })}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Distribution</label>
              <select
                value={state.compare.distribution}
                onChange={e => setState(s => ({ ...s, compare: { ...s.compare, distribution: e.target.value } }))}
                className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                {TWO_P_DISTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <p className="text-[10px] text-gray-400 mt-1">
                2-parameter distributions support likelihood contour plots.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Confidence level</label>
              <input type="text" value={state.compare.ciText}
                onChange={e => setState(s => ({ ...s, compare: { ...s.compare, ciText: e.target.value } }))}
                className="w-20 text-xs border border-gray-300 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>

            {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}

            <button onClick={runCompare} disabled={loading}
              className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2 rounded transition-colors">
              <GitCompare size={14} />
              {loading ? 'Comparing...' : 'Run Comparison'}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {compareResult ? (
              <>
                {/* LR test */}
                {compareResult.lr_test && (
                  <div className={`rounded-lg border p-4 mb-6 ${
                    compareResult.lr_test.different
                      ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
                    <p className="text-sm font-semibold text-gray-800">
                      Likelihood-Ratio Test — {compareResult.lr_test.different
                        ? 'datasets are statistically DIFFERENT'
                        : 'no significant difference detected'}
                    </p>
                    <p className="text-xs text-gray-600 mt-1">
                      Common {compareResult.distribution} model vs separate models:
                      χ² = {compareResult.lr_test.statistic} (df = {compareResult.lr_test.df}),
                      p-value = {compareResult.lr_test.p_value}
                      {' '}{compareResult.lr_test.different ? '<' : '≥'} α = {compareResult.lr_test.alpha}
                    </p>
                  </div>
                )}

                {/* Parameter table */}
                <h3 className="text-sm font-semibold text-gray-700 mb-2">
                  Fitted Parameters ({compareResult.distribution}, {Math.round(compareResult.CI * 100)}% CI)
                </h3>
                <div className="overflow-x-auto border border-gray-200 rounded-lg mb-6">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Folio</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">n (F/S)</th>
                        {compareResult.param_names.map(p => (
                          <th key={p} className="px-3 py-2 text-right font-medium text-gray-600">
                            {p} [CI]
                          </th>
                        ))}
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Log-Lik</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">AICc</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compareResult.folios.map((f, i) => (
                        <tr key={f.name} className="border-t border-gray-100">
                          <td className="px-3 py-1.5 font-medium" style={{ color: FOLIO_COLORS[i % FOLIO_COLORS.length] }}>
                            {f.name}
                          </td>
                          <td className="px-3 py-1.5 text-right">{f.n_failures}/{f.n_censored}</td>
                          {compareResult.param_names.map(p => (
                            <td key={p} className="px-3 py-1.5 text-right font-mono">
                              {fmt(f.params[p])}
                              <span className="text-gray-400">
                                {' '}[{fmt(f.params[`${p}_lower`])}, {fmt(f.params[`${p}_upper`])}]
                              </span>
                            </td>
                          ))}
                          <td className="px-3 py-1.5 text-right font-mono">{fmt(f.log_likelihood)}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{fmt(f.AICc)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Contour plot */}
                {contourData.length > 0 && contourAxes && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">
                      Likelihood Contours ({Math.round(compareResult.CI * 100)}% joint confidence regions)
                    </h3>
                    <p className="text-xs text-gray-400 mb-2">
                      Overlapping regions suggest the datasets could share the same parameters.
                    </p>
                    <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 480 }}>
                      <Plot
                        data={contourData as Plotly.Data[]}
                        layout={{
                          xaxis: { title: { text: contourAxes.x_name }, gridcolor: '#e5e7eb' },
                          yaxis: { title: { text: contourAxes.y_name }, gridcolor: '#e5e7eb' },
                          margin: { t: 20, r: 20, b: 50, l: 60 },
                          paper_bgcolor: 'white', plot_bgcolor: 'white',
                          showlegend: true, legend: { x: 0.02, y: 0.98, font: { size: 11 } },
                        } as any}
                        config={{ responsive: true }}
                        style={{ width: '100%', height: '100%' }}
                        useResizeHandler
                      />
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400">
                <div className="text-center">
                  <p className="text-lg font-medium">Folio Comparison</p>
                  <p className="text-sm mt-1">Select 2+ folios, then run statistical comparison with contour plots</p>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ================= Folio view ================= */
        <div className="flex flex-1 overflow-hidden">
          {/* Left panel */}
          <div className="w-80 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto p-4 flex flex-col gap-4">
            <div className="flex gap-2">
              <button
                onClick={() => patchActive({ analysisMode: 'parametric' })}
                className={`flex-1 py-1.5 text-xs rounded font-medium border transition-colors ${
                  folio.analysisMode === 'parametric' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'
                }`}
              >Parametric</button>
              <button
                onClick={() => patchActive({ analysisMode: 'nonparametric' })}
                className={`flex-1 py-1.5 text-xs rounded font-medium border transition-colors ${
                  folio.analysisMode === 'nonparametric' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'
                }`}
              >Non-Parametric</button>
            </div>

            {/* Data source toggle */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Data source</label>
              <div className="flex gap-2">
                <button onClick={() => patchActive({ dataSource: 'table' })}
                  className={`flex-1 py-1 text-xs rounded border transition-colors ${
                    folio.dataSource === 'table' ? 'bg-gray-700 text-white border-gray-700' : 'border-gray-300 text-gray-600'
                  }`}>Data table</button>
                <button onClick={() => patchActive({ dataSource: 'spec' })}
                  className={`flex-1 py-1 text-xs rounded border transition-colors ${
                    folio.dataSource === 'spec' ? 'bg-gray-700 text-white border-gray-700' : 'border-gray-300 text-gray-600'
                  }`}>Distribution spec</button>
              </div>
            </div>

            {folio.dataSource === 'table' ? (
              <>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-dashed border-gray-300 rounded hover:border-blue-400 hover:bg-blue-50 transition-colors text-gray-600"
                  >
                    <Upload size={12} /> Import CSV
                  </button>
                  <input ref={fileRef} type="file" accept=".csv" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleCSV(f); e.target.value = '' }} />
                  <span className="text-[10px] text-gray-400">or paste data below</span>
                </div>

                {/* Data table */}
                <div onPaste={handlePaste} ref={tableRef}>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-gray-700">Life Data</label>
                    <span className="text-[10px] text-gray-400">
                      {(() => { const { failures, rc } = folioData(folio); return `${failures.length}F ${rc.length}S` })()}
                    </span>
                  </div>
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-2 py-1.5 text-left font-medium text-gray-500 w-16">ID</th>
                          <th className="px-2 py-1.5 text-left font-medium text-gray-500">Time</th>
                          <th className="px-2 py-1.5 text-center font-medium text-gray-500 w-14">State</th>
                          <th className="w-7"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {folio.rows.map((row, i) => (
                          <tr key={row.key} className="border-t border-gray-100 group">
                            <td className="px-1 py-0.5">
                              <input
                                type="text"
                                value={row.id}
                                onChange={e => updateRow(i, 'id', e.target.value)}
                                className="w-full text-xs px-1 py-0.5 border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded font-mono text-gray-500"
                                placeholder="—"
                              />
                            </td>
                            <td className="px-1 py-0.5">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={row.time}
                                data-row={i}
                                data-col="time"
                                onChange={e => updateRow(i, 'time', e.target.value)}
                                onKeyDown={e => handleTimeKeyDown(e, i)}
                                className="w-full text-xs px-1 py-0.5 border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded font-mono"
                                placeholder="0"
                              />
                            </td>
                            <td className="px-1 py-0.5 text-center">
                              <button
                                tabIndex={-1}
                                onClick={() => updateRow(i, 'state', row.state === 'F' ? 'S' : 'F')}
                                className={`px-1.5 py-0.5 text-[10px] font-semibold rounded transition-colors ${
                                  row.state === 'F'
                                    ? 'bg-red-100 text-red-700 hover:bg-red-200'
                                    : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                                }`}
                              >{row.state === 'F' ? 'Fail' : 'Susp'}</button>
                            </td>
                            <td className="px-0.5 py-0.5 text-center">
                              <button
                                onClick={() => removeRow(i)}
                                className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                tabIndex={-1}
                              ><Trash2 size={11} /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between mt-1.5">
                    <button onClick={addRow}
                      className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 transition-colors">
                      <Plus size={11} /> Add row
                    </button>
                    <span className="text-[10px] text-gray-300">Tab in last Time cell adds a row</span>
                  </div>
                </div>
              </>
            ) : (
              /* Distribution spec input */
              <div className="flex flex-col gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Distribution</label>
                  <select
                    value={folio.spec.distribution}
                    onChange={e => {
                      const d = e.target.value
                      patchActive(f => ({
                        spec: {
                          ...f.spec,
                          distribution: d,
                          params: Object.fromEntries(DIST_PARAM_FIELDS[d].map(p =>
                            [p, f.spec.params[p] ?? PARAM_DEFAULTS[p]])),
                        },
                      }))
                    }}
                    className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  >
                    {ALL_DISTS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {DIST_PARAM_FIELDS[folio.spec.distribution].map(p => (
                    <div key={p}>
                      <label className="block text-xs font-medium text-gray-700 mb-1">{p}</label>
                      <input type="text" inputMode="decimal"
                        value={folio.spec.params[p] ?? ''}
                        onChange={e => patchActive(f => ({
                          spec: { ...f.spec, params: { ...f.spec.params, [p]: e.target.value } },
                        }))}
                        className="w-full text-xs border border-gray-300 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    </div>
                  ))}
                </div>

                <button onClick={showSpecModel} disabled={loading}
                  className="flex items-center justify-center gap-2 border border-blue-600 text-blue-600 hover:bg-blue-50 disabled:opacity-50 text-xs font-medium py-1.5 rounded transition-colors">
                  <Play size={12} /> Show model (no data)
                </button>

                <hr className="border-gray-200" />

                <p className="text-xs font-semibold text-gray-800">Monte Carlo simulation</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Samples (n)</label>
                    <input type="text" inputMode="numeric" value={folio.spec.n}
                      onChange={e => patchActive(f => ({ spec: { ...f.spec, n: e.target.value } }))}
                      className="w-full text-xs border border-gray-300 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Seed <span className="text-gray-400">(optional)</span>
                    </label>
                    <input type="text" inputMode="numeric" value={folio.spec.seed}
                      onChange={e => patchActive(f => ({ spec: { ...f.spec, seed: e.target.value } }))}
                      className="w-full text-xs border border-gray-300 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </div>
                </div>
                <button onClick={generateMonteCarlo} disabled={loading}
                  className="flex items-center justify-center gap-2 border border-emerald-600 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 text-xs font-medium py-1.5 rounded transition-colors">
                  <Dices size={12} /> Generate data into table
                </button>
              </div>
            )}

            {folio.analysisMode === 'parametric' ? (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Method</label>
                  <div className="flex gap-2">
                    {(['MLE', 'LS'] as const).map(m => (
                      <button key={m} onClick={() => patchActive({ method: m })}
                        className={`flex-1 py-1 text-xs rounded border transition-colors ${
                          folio.method === m ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'
                        }`}>{m}</button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Confidence level</label>
                  <div className="flex gap-2 items-center">
                    <input
                      type="text"
                      value={folio.ciText}
                      onChange={e => patchActive({ ciText: e.target.value })}
                      onBlur={() => {
                        const v = parseFloat(folio.ciText)
                        if (!isNaN(v) && v > 0 && v < 1) patchActive({ ci: v })
                        else patchActive({ ciText: String(folio.ci) })
                      }}
                      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                      className="w-16 text-xs border border-gray-300 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                    <div className="flex gap-1">
                      {([0.90, 0.95, 0.99] as const).map(c => (
                        <button key={c} onClick={() => patchActive({ ci: c, ciText: String(c) })}
                          className={`px-2 py-1 text-[10px] rounded border transition-colors ${
                            folio.ci === c ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-500'
                          }`}>{Math.round(c * 100)}%</button>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-gray-700">Distributions</label>
                    <div className="flex gap-1">
                      <button onClick={() => patchActive({ selectedDists: ALL_DISTS })}
                        className="text-xs text-blue-600 hover:underline">All</button>
                      <span className="text-gray-300">|</span>
                      <button onClick={() => patchActive({ selectedDists: [] })}
                        className="text-xs text-gray-500 hover:underline">None</button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 max-h-52 overflow-y-auto">
                    {ALL_DISTS.map(d => (
                      <label key={d} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                        <input type="checkbox" checked={folio.selectedDists.includes(d)}
                          onChange={() => patchActive(f => ({
                            selectedDists: f.selectedDists.includes(d)
                              ? f.selectedDists.filter(x => x !== d)
                              : [...f.selectedDists, d],
                          }))}
                          className="rounded text-blue-600" />
                        {d}
                      </label>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Estimator</label>
                <div className="flex gap-2">
                  {(['KM', 'NA'] as const).map(m => (
                    <button key={m} onClick={() => patchActive({ npMethod: m })}
                      className={`flex-1 py-1 text-xs rounded border transition-colors ${
                        folio.npMethod === m ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'
                      }`}>
                      {m === 'KM' ? 'Kaplan-Meier' : 'Nelson-Aalen'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}

            <button
              onClick={run}
              disabled={loading}
              className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2 rounded transition-colors"
            >
              <Play size={14} />
              {loading ? 'Running...' : 'Run Analysis'}
            </button>
          </div>

          {/* Main content */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {/* Spec model (no data) — curves only */}
            {folio.specResult && !fitResult && (
              <div className="flex-1 overflow-y-auto p-6">
                <div className="grid grid-cols-3 gap-3 mb-4 max-w-xl">
                  <div className="rounded-lg border bg-white border-gray-200 p-3">
                    <p className="text-xs text-gray-500">Mean</p>
                    <p className="text-lg font-semibold text-gray-900">{fmt(folio.specResult.stats.mean)}</p>
                  </div>
                  <div className="rounded-lg border bg-white border-gray-200 p-3">
                    <p className="text-xs text-gray-500">Median</p>
                    <p className="text-lg font-semibold text-gray-900">{fmt(folio.specResult.stats.median)}</p>
                  </div>
                  <div className="rounded-lg border bg-white border-gray-200 p-3">
                    <p className="text-xs text-gray-500">Std Dev</p>
                    <p className="text-lg font-semibold text-gray-900">{fmt(folio.specResult.stats.std)}</p>
                  </div>
                </div>
                <div className="flex gap-1 mb-2">
                  {CURVE_TABS.map(t => (
                    <button key={t} onClick={() => setView(t)}
                      className={`px-3 py-1 text-xs rounded border transition-colors ${
                        curveTab === t ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'
                      }`}>{t}</button>
                  ))}
                </div>
                <div className="bg-white border border-gray-200 rounded-lg" style={{ height: 420 }}>
                  <Plot
                    data={curvePlotData as Plotly.Data[]}
                    layout={{ ...curveLayout, title: { text: `${folio.specResult.distribution} (specified) — ${curveTab}` } } as any}
                    config={{ responsive: true }}
                    style={{ width: '100%', height: '100%' }}
                    useResizeHandler
                  />
                </div>
              </div>
            )}

            {fitResult && (
              <>
                <div className="flex-1 overflow-hidden flex">
                  {/* Results table */}
                  <div className="w-80 flex-shrink-0 border-r border-gray-200 overflow-y-auto p-3">
                    <p className="text-xs font-medium text-gray-500 mb-2">
                      Fit Results — best: <span className="text-green-700 font-semibold">{fitResult.best_distribution}</span>
                    </p>
                    <ResultsTable
                      columns={tableColumns}
                      rows={fitResult.results as unknown as Record<string, unknown>[]}
                      rowKey="Distribution"
                      selectedRow={activeDist}
                      onRowClick={row => patchActive({ selectedDist: row.Distribution as string })}
                    />

                    {selectedParams && selectedParams.rows.length > 0 && (
                      <div className="mt-4">
                        <p className="text-xs font-medium text-gray-500 mb-2">
                          Parameters — <span className="font-semibold text-gray-700">{selectedParams.dist}</span>
                          <span className="text-gray-400"> ({ciPct}% CI)</span>
                        </p>
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            <tr className="text-gray-500 border-b border-gray-200">
                              <th className="text-left py-1 font-medium">Param</th>
                              <th className="text-right py-1 font-medium">Value</th>
                              <th className="text-right py-1 font-medium">SE</th>
                              <th className="text-right py-1 font-medium">Lower</th>
                              <th className="text-right py-1 font-medium">Upper</th>
                            </tr>
                          </thead>
                          <tbody className="font-mono">
                            {selectedParams.rows.map(r => (
                              <tr key={r.name} className="border-b border-gray-100">
                                <td className="py-1 text-gray-700">{r.name}</td>
                                <td className="py-1 text-right">{fmt(r.value)}</td>
                                <td className="py-1 text-right text-gray-500">{fmt(r.se)}</td>
                                <td className="py-1 text-right text-gray-500">{fmt(r.lower)}</td>
                                <td className="py-1 text-right text-gray-500">{fmt(r.upper)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Plot area — single screen with view toggle */}
                  <div className="flex-1 p-4 overflow-auto">
                    <div className="flex flex-col h-full gap-3">
                      <div className="flex items-center gap-1">
                        {VIEW_TABS.map(t => (
                          <button key={t} onClick={() => setView(t)}
                            className={`px-3 py-1 text-xs rounded border transition-colors ${
                              view === t ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'
                            }`}>{t === 'Probability' ? 'Probability Plot' : t}</button>
                        ))}
                        <div className="ml-auto">
                          <button onClick={downloadCSV}
                            className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 border border-gray-200 px-2 py-1 rounded">
                            <Download size={12} /> Export CSV
                          </button>
                        </div>
                      </div>
                      {view === 'Probability' ? (
                        probPlotData.length > 0 && (
                          <Plot
                            data={probPlotData as Plotly.Data[]}
                            layout={{ ...probLayout, title: { text: `${activeDist} Probability Plot` } } as any}
                            config={{ responsive: true, displayModeBar: true }}
                            style={{ width: '100%', flex: 1 }}
                            useResizeHandler
                          />
                        )
                      ) : (
                        curvePlotData.length > 0 && (
                          <Plot
                            data={curvePlotData as Plotly.Data[]}
                            layout={{ ...curveLayout, title: { text: `${activeDist} — ${curveTab}` } } as any}
                            config={{ responsive: true }}
                            style={{ width: '100%', flex: 1 }}
                            useResizeHandler
                          />
                        )
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}

            {npResult && !fitResult && !folio.specResult && (
              <div className="flex-1 p-4">
                <Plot
                  data={npPlotData as Plotly.Data[]}
                  layout={{
                    title: { text: `${npResult.method} Estimate` },
                    xaxis: { title: { text: 'Time' }, gridcolor: '#e5e7eb' },
                    yaxis: { title: { text: npResult.method === 'Kaplan-Meier' ? 'Survival Probability' : 'Cumulative Hazard' }, gridcolor: '#e5e7eb' },
                    margin: { t: 40, r: 20, b: 50, l: 60 },
                    paper_bgcolor: 'white', plot_bgcolor: 'white',
                  } as any}
                  config={{ responsive: true }}
                  style={{ width: '100%', height: '90%' }}
                  useResizeHandler
                />
              </div>
            )}

            {!fitResult && !npResult && !folio.specResult && (
              <div className="flex-1 flex items-center justify-center text-gray-400">
                <div className="text-center">
                  <p className="text-lg font-medium">No results yet — {folio.name}</p>
                  <p className="text-sm mt-1">Enter failure times (or specify a distribution) and click Run Analysis</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
